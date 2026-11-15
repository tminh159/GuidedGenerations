import type {
  ConnectionProfileDTO,
  GenerationRequestDTO,
  InterceptorDisposer,
  MessageSwipedPayloadDTO,
  PromptBlockSnapshotDTO,
  RegexScriptDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import {
  type AssembledLlmMessageDTO,
  buildActiveSwipePatch,
  buildBackgroundSwipePatch,
  buildDryRunInput,
  buildPresetContextMetadata,
  type ChatMessageWithRole,
  computeEffectiveGuidanceDepth,
  type DryRunResultWithRequestMessages,
  extractSwipeReasoning,
  findLastAssistantMessage,
  formatGuidanceText,
  hasPresetContextForSwipe,
  injectGuidanceMessage,
  isAssistantMessage,
  mapInjectionRoleToRegexPlacement,
  normalizeMessageSwipes,
  resolveChatHistoryFlags,
  resolveEffectiveModelAndProvider,
  stitchContinueContent,
  stripCreatedBlankAssistantTurnWithHistory,
  stripInternalMessageMarkers,
  stripRejectedSwipeAssistantTurnWithHistory,
} from "./prompt-builder";
import {
  applyRegexScripts,
  fetchActiveRegexScripts,
  processResponseOutput,
} from "./regex-processor";
import {
  buildGenerationMetricsPayload,
  type GenerationTimingSource,
  type GenerationUsageInput,
  safeCountTokens,
} from "./generation-metrics";
import type { SettingsStore } from "./settings-store";
import type {
  ActionRunResult,
  ActiveRunState,
  BackendPushEvent,
  GuidedActionConfig,
  GuidedActionId,
  RegenerateContinueInput,
  RemoveContinueResult,
  RunActionInput,
} from "../shared/types";

interface GenerationRequestWithSignal extends GenerationRequestDTO {
  provider?: string;
  model?: string;
  signal?: AbortSignal;
}

interface InternalRun {
  state: ActiveRunState;
  controller: AbortController;
}

interface StreamTargetState {
  messageId: string;
  swipes: string[];
  swipeIndex: number;
  swipeDates: number[];
  baseText: string;
  latestSwipeId?: number;
  latestExtra?: Record<string, unknown>;
}

interface SwipeStreamOptions {
  isViewingTargetSwipe(): boolean;
  setTriggerFlush?(trigger: () => void): void;
  onFinalizing?(): void;
}

interface GuidedSwipeSession {
  targetAssistantId: string;
  initialSwipeId: number;
  newSwipeIndex: number;
  swipes: string[];
  swipeDates: number[];
  initialExtra: Record<string, unknown>;
  getCurrentViewedSwipeId(): number;
  setCurrentViewedSwipeId(id: number): void;
  getSwipeEventSeq(): number;
  setTriggerFlush(trigger: (() => void) | null): void;
  setFinalizing(finalizing: boolean): void;
  dispose(): void;
}

interface StreamMessageResult {
  messageId?: string;
  swipeId?: number;
  finalText: string;
  rawDeltaText: string;
  hasReasoning: boolean;
  aborted: boolean;
  hasOutput: boolean;
  usage?: GenerationUsageInput;
  timingSource?: GenerationTimingSource;
}

type OutputTransformer = (raw: {
  deltaText: string;
  reasoningText: string;
}) => Promise<{ deltaText: string; reasoningText: string }>;

const STREAM_FLUSH_INTERVAL_MS = 120;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class GuidedGenerationRunner {
  private readonly activeRuns = new Map<string, InternalRun>();
  private readonly pendingUsers = new Map<string, AbortController>();
  private interceptorDisposer: InterceptorDisposer | null = null;
  private readonly pendingDryRunCaptures = new Map<
    string,
    { capturedMessages?: AssembledLlmMessageDTO[] }
  >();
  private readonly chatDryRunQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly spindle: SpindleAPI,
    private readonly store: SettingsStore,
    private readonly emitFrontend: (event: BackendPushEvent, userId?: string) => void,
  ) {}

  dispose(): void {
    if (this.interceptorDisposer) {
      this.interceptorDisposer();
      this.interceptorDisposer = null;
    }
  }

  private ensureInterceptorRegistered(): void {
    if (this.interceptorDisposer) return;
    if (!this.spindle.permissions?.has?.("interceptor")) return;
    if (typeof this.spindle.registerInterceptor !== "function") return;

    this.interceptorDisposer = this.spindle.registerInterceptor(async (messages, context) => {
      if (this.spindle.permissions?.has && !this.spindle.permissions.has("interceptor")) {
        return messages;
      }
      const isDryRun = Boolean(
        (context as { dryRun?: boolean }).dryRun || context.isDryRun,
      );
      if (!isDryRun) {
        return messages;
      }
      const pending = this.pendingDryRunCaptures.get(context.chatId);
      if (pending) {
        pending.capturedMessages = messages.map((m) => ({
          ...(m as AssembledLlmMessageDTO),
        }));
      }
      return messages;
    });
  }

  private enqueueChatDryRun<T>(chatId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chatDryRunQueues.get(chatId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    this.chatDryRunQueues.set(chatId, tail);
    void tail.finally(() => {
      if (this.chatDryRunQueues.get(chatId) === tail) {
        this.chatDryRunQueues.delete(chatId);
      }
    });
    return next;
  }

  private async runDryRunWithCapture(
    chatId: string,
    dryRunInput: ReturnType<typeof buildDryRunInput>,
    userId?: string,
  ): Promise<{
    result: DryRunResultWithRequestMessages;
    capturedMessages?: AssembledLlmMessageDTO[];
  }> {
    return this.enqueueChatDryRun(chatId, async () => {
      this.ensureInterceptorRegistered();
      const capture: { capturedMessages?: AssembledLlmMessageDTO[] } = {};
      this.pendingDryRunCaptures.set(chatId, capture);
      try {
        const result = (await this.spindle.generate.dryRun(
          dryRunInput,
          userId,
        )) as DryRunResultWithRequestMessages;
        return { result, capturedMessages: capture.capturedMessages };
      } finally {
        if (this.pendingDryRunCaptures.get(chatId) === capture) {
          this.pendingDryRunCaptures.delete(chatId);
        }
      }
    });
  }

  private userKey(userId?: string): string {
    return userId && userId.length > 0 ? userId : "__default__";
  }

  getActiveRun(userId?: string): ActiveRunState | null {
    const run = this.activeRuns.get(this.userKey(userId));
    return run ? { ...run.state } : null;
  }

  private updateActiveRunState(
    userId: string | undefined,
    runId: string,
    patch: Partial<ActiveRunState>,
  ): void {
    const active = this.activeRuns.get(this.userKey(userId));
    if (!active || active.state.runId !== runId) {
      return;
    }
    active.state = {
      ...active.state,
      ...patch,
    };
    this.emitStatus(userId);
  }

  abortCurrent(userId?: string, runId?: string): boolean {
    const key = this.userKey(userId);
    const run = this.activeRuns.get(key);
    if (run) {
      if (runId && run.state.runId !== runId) return false;
      run.controller.abort();
      return true;
    }
    if (!runId) {
      const pendingController = this.pendingUsers.get(key);
      if (pendingController) {
        pendingController.abort();
        return true;
      }
    }
    return false;
  }

  async run(input: RunActionInput, userId?: string): Promise<ActionRunResult> {
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before starting another.",
      );
    }

    this.assertRequiredPermissions(input.actionId);
    const controller = new AbortController();
    this.pendingUsers.set(key, controller);

    let runId: string | undefined;

    try {
      const settings = await this.store.getSettings(userId);
      const config = settings.actions[input.actionId];
      if (!config.enabled) {
        throw new Error(`Guided Generations action '${input.actionId}' is disabled in Settings.`);
      }

      const trimmedInput = input.inputText.trim();
      if (input.actionId === "guided_response" && !trimmedInput) {
        throw new Error("Enter guidance in the composer before running Guided Response.");
      }

      const { chatId, characterId } = await this.resolveChatContext(input.chatId, userId);
      runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      if (controller.signal.aborted) {
        return {
          runId,
          actionId: input.actionId,
          chatId,
          aborted: true,
          text: "",
        };
      }

      this.activeRuns.set(key, {
        state: {
          runId,
          actionId: input.actionId,
          chatId,
          startedAt: Date.now(),
        },
        controller,
      });
      this.pendingUsers.delete(key);
      this.emitStatus(userId);

      if (trimmedInput && settings.inputRecovery.enabled) {
        const recovery = await this.store.pushRecovery(
          {
            text: input.inputText,
            actionId: input.actionId,
            chatId,
          },
          userId,
        );
        this.emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
      }

      const resolvedConnection = await this.resolveConnection(
        config.connectionId,
        input.activeConnectionId,
        userId,
      );
      const connectionId = resolvedConnection?.id;

      let preverifiedPreset: { id: string; name?: string } | null | undefined;
      if (
        input.actionId === "guided_regenerate" &&
        config.presetId &&
        this.spindle.permissions.has("presets")
      ) {
        preverifiedPreset = await this.spindle.presets.get(config.presetId, userId);
        if (!preverifiedPreset) {
          throw new Error(
            "Selected preset for Guided Regenerate no longer exists. Choose another in Settings.",
          );
        }
      }

      const presetContext =
        input.actionId !== "guided_impersonate"
          ? await this.resolvePresetContext(
              config.presetId,
              chatId,
              userId,
              preverifiedPreset,
            )
          : { presetId: null };
      const resolvedPresetId = presetContext.presetId;
      const metricsPreset = this.resolveMetricsPresetContext(
        presetContext,
        config.presetId,
        resolvedConnection,
      );

      let targetAssistantId: string | null = null;
      let preTargetMessage: ChatMessageWithRole | null = null;
      if (input.actionId === "guided_continue" || input.actionId === "guided_swipe") {
        preTargetMessage = await this.requireLastAssistantMessage(chatId);
        targetAssistantId = preTargetMessage.id;
      }

      if (controller.signal.aborted) {
        return {
          runId,
          actionId: input.actionId,
          chatId,
          aborted: true,
          text: "",
        };
      }

      const dryRunInput = buildDryRunInput({
        chatId,
        actionId: input.actionId,
        config,
        activeConnectionId: connectionId,
      });

      let regeneratedSnapshot: ChatMessageWithRole | null = null;
      let createdMessageId: string | undefined;
      let createdSwipeDates: number[] | undefined;
      let swipeSession: GuidedSwipeSession | null = null;
      let handoffToAssistantExecution = false;

      try {
        if (input.actionId === "guided_response") {
          const metadata = resolvedPresetId
            ? buildPresetContextMetadata(undefined, 0, resolvedPresetId)
            : undefined;
          const created = await this.spindle.chat.appendMessage(
            chatId,
            {
              role: "assistant",
              content: "",
              ...(metadata ? { metadata } : {}),
            },
            { triggerGeneration: false },
          );
          createdMessageId = created.id;
          createdSwipeDates = [Math.floor(Date.now() / 1000)];
          this.updateActiveRunState(userId, runId, {
            messageId: created.id,
            swipeId: 0,
          });
        } else if (input.actionId === "guided_regenerate") {
          const trailingAssistant = await this.findTrailingAssistantMessage(chatId);
          if (controller.signal.aborted) {
            return {
              runId,
              actionId: input.actionId,
              chatId,
              aborted: true,
              text: "",
            };
          }
          if (trailingAssistant) {
            regeneratedSnapshot = this.cloneMessageSnapshot(trailingAssistant);
            await this.spindle.chat.deleteMessage(chatId, trailingAssistant.id);
          }
          if (controller.signal.aborted) {
            if (regeneratedSnapshot) {
              await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, undefined, userId);
            }
            return {
              runId,
              actionId: input.actionId,
              chatId,
              aborted: true,
              text: "",
            };
          }
          const metadata = resolvedPresetId
            ? buildPresetContextMetadata(undefined, 0, resolvedPresetId)
            : undefined;
          const created = await this.spindle.chat.appendMessage(
            chatId,
            {
              role: "assistant",
              content: "",
              ...(metadata ? { metadata } : {}),
            },
            { triggerGeneration: false },
          );
          createdMessageId = created.id;
          createdSwipeDates = [Math.floor(Date.now() / 1000)];
          this.updateActiveRunState(userId, runId, {
            messageId: created.id,
            swipeId: 0,
          });
        } else if (input.actionId === "guided_continue" && preTargetMessage) {
          const { activeIndex } = normalizeMessageSwipes(preTargetMessage);
          this.updateActiveRunState(userId, runId, {
            messageId: preTargetMessage.id,
            swipeId: activeIndex,
          });
          if (
            resolvedPresetId &&
            !hasPresetContextForSwipe(preTargetMessage.metadata, activeIndex)
          ) {
            const metadata = buildPresetContextMetadata(
              preTargetMessage.metadata,
              activeIndex,
              resolvedPresetId,
            );
            await this.spindle.chat.updateMessage(chatId, preTargetMessage.id, {
              metadata,
              skipChunkRebuild: true,
            });
          }
        } else if (input.actionId === "guided_swipe" && preTargetMessage) {
          const backgroundSwipe = input.backgroundSwipe === true;
          swipeSession = this.createGuidedSwipeSession(chatId, preTargetMessage);
          const metadata = resolvedPresetId
            ? buildPresetContextMetadata(
                preTargetMessage.metadata,
                swipeSession.newSwipeIndex,
                resolvedPresetId,
              )
            : undefined;
          const seqBeforeWrite = swipeSession.getSwipeEventSeq();
          if (!backgroundSwipe) {
            await this.spindle.chat.updateMessage(
              chatId,
              swipeSession.targetAssistantId,
              buildActiveSwipePatch({
                swipes: swipeSession.swipes,
                swipeIndex: swipeSession.newSwipeIndex,
                content: "",
                swipeDates: swipeSession.swipeDates,
                ...(metadata ? { metadata } : {}),
                skipChunkRebuild: true,
              }),
            );
            if (
              swipeSession.getSwipeEventSeq() === seqBeforeWrite &&
              swipeSession.getCurrentViewedSwipeId() === swipeSession.initialSwipeId
            ) {
              swipeSession.setCurrentViewedSwipeId(swipeSession.newSwipeIndex);
            }
          } else {
            await this.spindle.chat.updateMessage(
              chatId,
              swipeSession.targetAssistantId,
              buildBackgroundSwipePatch({
                swipes: swipeSession.swipes,
                swipeIndex: swipeSession.newSwipeIndex,
                content: "",
                swipeDates: swipeSession.swipeDates,
                ...(metadata ? { metadata } : {}),
              }),
            );
          }
          this.updateActiveRunState(userId, runId, {
            messageId: swipeSession.targetAssistantId,
            swipeId: swipeSession.newSwipeIndex,
            backgroundSwipe,
          });
        }

        const dryRunCapture = await this.runDryRunWithCapture(chatId, dryRunInput, userId);
        const dryRunResult = dryRunCapture.result;
        const capturedMessages = dryRunCapture.capturedMessages;

        if (controller.signal.aborted) {
          if (regeneratedSnapshot) {
            await this.restoreTrailingAssistant(
              chatId,
              regeneratedSnapshot,
              createdMessageId,
              userId,
            );
          }
          return {
            runId,
            actionId: input.actionId,
            chatId,
            aborted: true,
            ...(input.actionId === "guided_response" && createdMessageId
              ? { messageId: createdMessageId, swipeId: 0 }
              : input.actionId === "guided_swipe" && swipeSession
                ? { messageId: swipeSession.targetAssistantId, swipeId: swipeSession.newSwipeIndex }
                : {}),
            text: "",
          };
        }

        const {
          rawInput,
          transformResponseOutput,
          transformImpersonateOutput,
        } = await this.prepareRawGenerationInput({
          actionId: input.actionId,
          chatId,
          characterId,
          userId,
          config,
          inputText: input.inputText,
          connectionId,
          resolvedConnection,
          dryRunResult,
          capturedMessages,
          signal: controller.signal,
          createdMessageId,
          targetAssistantId,
        });

        switch (input.actionId) {
          case "guided_response":
          case "guided_regenerate":
            handoffToAssistantExecution = true;
            return await this.executeAssistantResponse(
              input.actionId,
              runId,
              chatId,
              createdMessageId!,
              createdSwipeDates!,
              rawInput,
              controller.signal,
              regeneratedSnapshot,
              transformResponseOutput,
              userId,
              metricsPreset,
            );
          case "guided_continue":
            return await this.executeGuidedContinue(
              runId,
              chatId,
              targetAssistantId!,
              input.inputText,
              rawInput,
              controller.signal,
              userId,
              transformResponseOutput,
              metricsPreset,
            );
          case "guided_swipe":
            return await this.executeGuidedSwipe(
              runId,
              chatId,
              swipeSession!,
              rawInput,
              controller.signal,
              transformResponseOutput,
              userId,
              metricsPreset,
            );
          case "guided_impersonate":
            return await this.executeImpersonate(
              runId,
              chatId,
              rawInput,
              controller.signal,
              userId,
              transformImpersonateOutput,
            );
          default: {
            const exhaustive: never = input.actionId;
            throw new Error(`Unsupported Guided Generations action: ${String(exhaustive)}`);
          }
        }
      } catch (error) {
        if (!handoffToAssistantExecution && regeneratedSnapshot) {
          await this.restoreTrailingAssistant(
            chatId,
            regeneratedSnapshot,
            createdMessageId,
            userId,
          );
        }
        throw error;
      } finally {
        swipeSession?.dispose();
      }
    } catch (error) {
      if (runId && this.activeRuns.get(key)?.state.runId === runId) {
        this.activeRuns.delete(key);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emitFrontend({ type: "gg:status", error: message, run: null }, userId);
      throw error;
    } finally {
      if (this.pendingUsers.get(key) === controller) {
        this.pendingUsers.delete(key);
      }
      if (runId && this.activeRuns.get(key)?.state.runId === runId) {
        this.activeRuns.delete(key);
        this.emitStatus(userId);
      }
    }
  }

  async removeLastContinue(
    input: { chatId?: string | null } = {},
    userId?: string,
  ): Promise<RemoveContinueResult> {
    if (!this.spindle.permissions.has("chats")) {
      throw new Error("Missing required 'chats' permission for Guided Generations.");
    }
    if (!this.spindle.permissions.has("chat_mutation")) {
      throw new Error("Missing required 'chat_mutation' permission for Guided Generations.");
    }

    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before removing a continue.",
      );
    }

    const pendingController = new AbortController();
    this.pendingUsers.set(key, pendingController);
    try {
      const { chatId } = await this.resolveChatContext(input.chatId, userId);
      const target = await this.requireLastAssistantMessage(chatId);
      const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(target);
      const currentText = swipes[activeIndex] ?? target.content ?? "";

      const entry = await this.store.peekContinueEntry(
        chatId,
        target.id,
        activeIndex,
        userId,
      );
      if (!entry) {
        throw new Error("No continue history found for the current swipe.");
      }

      const isCompatibleText =
        currentText === entry.resultText ||
        (entry.baseText.length > 0 && currentText.startsWith(entry.baseText));
      if (!isCompatibleText) {
        throw new Error(
          "The message was edited after the last continue; cannot safely remove it.",
        );
      }

      await this.spindle.chat.updateMessage(
        chatId,
        target.id,
        buildActiveSwipePatch({
          swipes,
          swipeIndex: activeIndex,
          content: entry.baseText,
          swipeDates,
          reasoningText: entry.baseReasoning,
          reasoningDuration: entry.baseReasoningDuration,
          skipChunkRebuild: false,
        }),
      );

      await this.store.popContinueEntry(
        chatId,
        target.id,
        activeIndex,
        entry.id,
        userId,
      );

      const restoredTokenCount =
        entry.baseText.length > 0
          ? await safeCountTokens(
              this.spindle,
              entry.baseText,
              userId ? { userId } : undefined,
            )
          : undefined;

      this.emitFrontend(
        {
          type: "gg:generation_metrics",
          chatId,
          messageId: target.id,
          swipeId: activeIndex,
          tokenCount: restoredTokenCount ?? null,
          generationMetrics: null,
        },
        userId,
      );

      return {
        removed: true,
        messageId: target.id,
        swipeIndex: activeIndex,
        text: entry.baseText,
      };
    } finally {
      if (this.pendingUsers.get(key) === pendingController) {
        this.pendingUsers.delete(key);
      }
    }
  }

  async regenerateLastContinue(
    input: RegenerateContinueInput = {},
    userId?: string,
  ): Promise<ActionRunResult> {
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before starting another.",
      );
    }

    this.assertRequiredPermissions("guided_continue");
    const controller = new AbortController();
    this.pendingUsers.set(key, controller);

    let runId: string | undefined;

    try {
      const settings = await this.store.getSettings(userId);
      const config = settings.actions.guided_continue;
      if (!config.enabled) {
        throw new Error("Guided Generations action 'guided_continue' is disabled in Settings.");
      }

      const { chatId, characterId } = await this.resolveChatContext(input.chatId, userId);
      if (controller.signal.aborted) {
        const earlyRunId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        return {
          runId: earlyRunId,
          actionId: "guided_continue",
          chatId,
          aborted: true,
          text: "",
        };
      }

      const target = await this.requireLastAssistantMessage(chatId);
      const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(target);
      const currentText = swipes[activeIndex] ?? target.content ?? "";

      const entry = await this.store.peekContinueEntry(
        chatId,
        target.id,
        activeIndex,
        userId,
      );
      if (!entry) {
        throw new Error("No continue history found for the current swipe.");
      }

      const isCompatibleText =
        currentText === entry.resultText ||
        (entry.baseText.length > 0 && currentText.startsWith(entry.baseText));
      if (!isCompatibleText) {
        throw new Error(
          "The message was edited after the last continue; cannot safely regenerate it.",
        );
      }

      if (controller.signal.aborted) {
        const earlyRunId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        return {
          runId: earlyRunId,
          actionId: "guided_continue",
          chatId,
          aborted: true,
          messageId: target.id,
          swipeId: activeIndex,
          text: currentText,
        };
      }

      const currentReasoning = extractSwipeReasoning(target, activeIndex);
      const preRegen = {
        messageId: target.id,
        swipeIndex: activeIndex,
        swipes: [...swipes],
        swipeDates: [...swipeDates],
        text: currentText,
        reasoning: currentReasoning.text,
        reasoningDuration: currentReasoning.duration,
        metadata: target.metadata ? this.cloneRecord(target.metadata) : undefined,
      };

      const activeRunId = (runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);

      this.activeRuns.set(key, {
        state: {
          runId: activeRunId,
          actionId: "guided_continue",
          chatId,
          startedAt: Date.now(),
        },
        controller,
      });
      this.pendingUsers.delete(key);
      this.emitStatus(userId);
      this.updateActiveRunState(userId, activeRunId, {
        messageId: target.id,
        swipeId: activeIndex,
      });

      const resolvedConnection = await this.resolveConnection(
        config.connectionId,
        input.activeConnectionId,
        userId,
      );
      const connectionId = resolvedConnection?.id;
      const presetContext = await this.resolvePresetContext(
        config.presetId,
        chatId,
        userId,
      );
      const resolvedPresetId = presetContext.presetId;
      const metricsPreset = this.resolveMetricsPresetContext(
        presetContext,
        config.presetId,
        resolvedConnection,
      );

      if (controller.signal.aborted) {
        return {
          runId,
          actionId: "guided_continue",
          chatId,
          aborted: true,
          messageId: preRegen.messageId,
          swipeId: preRegen.swipeIndex,
          text: preRegen.text,
        };
      }

      const metadata =
        resolvedPresetId && !hasPresetContextForSwipe(target.metadata, activeIndex)
          ? buildPresetContextMetadata(target.metadata, activeIndex, resolvedPresetId)
          : undefined;

      await this.spindle.chat.updateMessage(
        chatId,
        target.id,
        buildActiveSwipePatch({
          swipes,
          swipeIndex: activeIndex,
          content: entry.baseText,
          swipeDates,
          reasoningText: entry.baseReasoning,
          reasoningDuration: entry.baseReasoningDuration,
          ...(metadata ? { metadata } : {}),
          skipChunkRebuild: true,
        }),
      );

      let hadStreamOutput = false;
      try {
        const dryRunInput = buildDryRunInput({
          chatId,
          actionId: "guided_continue",
          config,
          activeConnectionId: connectionId,
        });
        const dryRunCapture = await this.runDryRunWithCapture(chatId, dryRunInput, userId);

        if (controller.signal.aborted) {
          await this.restorePreRegenMessage(chatId, preRegen);
          return {
            runId,
            actionId: "guided_continue",
            chatId,
            aborted: true,
            messageId: preRegen.messageId,
            swipeId: preRegen.swipeIndex,
            text: preRegen.text,
          };
        }

        const { rawInput, transformResponseOutput } = await this.prepareRawGenerationInput({
          actionId: "guided_continue",
          chatId,
          characterId,
          userId,
          config,
          inputText: entry.inputText,
          connectionId,
          resolvedConnection,
          dryRunResult: dryRunCapture.result,
          capturedMessages: dryRunCapture.capturedMessages,
          signal: controller.signal,
          targetAssistantId: target.id,
        });

        const streamRes = await this.streamIntoMessage(
          chatId,
          rawInput,
          controller.signal,
          async () => {
            const latest = await this.readTargetMessageOrThrow(chatId, target.id);
            const latestNorm = normalizeMessageSwipes(latest);
            return {
              messageId: latest.id,
              swipes: latestNorm.swipes,
              swipeIndex: activeIndex,
              swipeDates: latestNorm.swipeDates,
              baseText: entry.baseText,
            };
          },
          async (current) => this.refreshSwipeTarget(chatId, current),
          transformResponseOutput,
          undefined,
          () => {
            hadStreamOutput = true;
          },
          async ({ finalText }) => {
            await this.store.replaceTopContinueEntry(
              chatId,
              target.id,
              activeIndex,
              entry.id,
              {
                chatId,
                messageId: target.id,
                swipeIndex: activeIndex,
                baseText: entry.baseText,
                resultText: finalText,
                baseReasoning: entry.baseReasoning,
                baseReasoningDuration: entry.baseReasoningDuration,
                inputText: entry.inputText,
              },
              userId,
            );
          },
          () => {
            this.updateActiveRunState(userId, activeRunId, { hasContentOutput: true });
          },
        );

        if (!streamRes.hasOutput) {
          await this.restorePreRegenMessage(chatId, preRegen);
          return {
            runId,
            actionId: "guided_continue",
            chatId,
            aborted: streamRes.aborted,
            messageId: preRegen.messageId,
            swipeId: preRegen.swipeIndex,
            text: preRegen.text,
          };
        }

        await this.store.replaceTopContinueEntry(
          chatId,
          target.id,
          activeIndex,
          entry.id,
          {
            chatId,
            messageId: target.id,
            swipeIndex: activeIndex,
            baseText: entry.baseText,
            resultText: streamRes.finalText,
            baseReasoning: entry.baseReasoning,
            baseReasoningDuration: entry.baseReasoningDuration,
            inputText: entry.inputText,
          },
          userId,
        );

        await this.emitMetricsForCompletedStream({
          chatId,
          userId,
          streamRes,
          isContinue: true,
          model: rawInput.model,
          provider: rawInput.provider,
          presetId: metricsPreset.presetId,
          presetName: metricsPreset.presetName,
        });

        return {
          runId,
          actionId: "guided_continue",
          chatId,
          aborted: streamRes.aborted,
          messageId: streamRes.messageId ?? target.id,
          swipeId: streamRes.swipeId ?? activeIndex,
          text: streamRes.finalText,
        };
      } catch (error) {
        if (!hadStreamOutput) {
          await this.restorePreRegenMessage(chatId, preRegen);
        }
        throw error;
      }
    } catch (error) {
      if (runId && this.activeRuns.get(key)?.state.runId === runId) {
        this.activeRuns.delete(key);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emitFrontend({ type: "gg:status", error: message, run: null }, userId);
      throw error;
    } finally {
      if (this.pendingUsers.get(key) === controller) {
        this.pendingUsers.delete(key);
      }
      if (runId && this.activeRuns.get(key)?.state.runId === runId) {
        this.activeRuns.delete(key);
        this.emitStatus(userId);
      }
    }
  }

  private async prepareRawGenerationInput(args: {
    actionId: GuidedActionId;
    chatId: string;
    characterId?: string;
    userId?: string;
    config: GuidedActionConfig;
    inputText: string;
    connectionId?: string;
    resolvedConnection?: ConnectionProfileDTO;
    dryRunResult: DryRunResultWithRequestMessages;
    capturedMessages?: AssembledLlmMessageDTO[];
    signal: AbortSignal;
    createdMessageId?: string;
    targetAssistantId?: string | null;
  }): Promise<{
    rawInput: GenerationRequestWithSignal;
    transformResponseOutput?: OutputTransformer;
    transformImpersonateOutput?: (rawText: string) => Promise<string>;
  }> {
    const {
      actionId,
      chatId,
      characterId,
      userId,
      config,
      inputText,
      connectionId,
      resolvedConnection,
      dryRunResult,
      capturedMessages,
      signal,
      createdMessageId,
      targetAssistantId,
    } = args;

    const { model, provider } = resolveEffectiveModelAndProvider({
      configuredModel: config.model,
      connectionModel: resolvedConnection?.model,
      connectionProvider: resolvedConnection?.provider,
      dryRunModel: dryRunResult.model,
      dryRunProvider: dryRunResult.provider,
    });

    const rawAssembled = this.mergeDryRunAndCapturedMessages(dryRunResult, capturedMessages);
    let isChatHistory = resolveChatHistoryFlags(rawAssembled, {
      breakdown: dryRunResult.breakdown,
    });

    if (!isChatHistory) {
      const effectivePresetId = config.presetId ?? resolvedConnection?.preset_id ?? null;
      const presetBlocks = await this.fetchPresetBlocksFallback(effectivePresetId, userId);
      if (presetBlocks && presetBlocks.length > 0) {
        isChatHistory = resolveChatHistoryFlags(rawAssembled, {
          breakdown: dryRunResult.breakdown,
          presetBlocks,
        });
      }
    }

    let assembledMessages = rawAssembled;
    if (actionId === "guided_response" || actionId === "guided_regenerate") {
      const stripped = stripCreatedBlankAssistantTurnWithHistory(
        rawAssembled,
        createdMessageId,
        isChatHistory,
      );
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    } else if (actionId === "guided_swipe") {
      const stripped = stripRejectedSwipeAssistantTurnWithHistory(
        rawAssembled,
        targetAssistantId,
        isChatHistory,
      );
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    }

    const resolveMacros = this.createRegexMacroResolver(chatId, characterId, userId);

    const resolvedTemplate = await this.resolveInstructionTemplate(
      config.instructionTemplate,
      { chatId, characterId, userId },
    );

    let guidanceText = formatGuidanceText(resolvedTemplate, inputText, {
      allowTemplateWithoutInput: actionId === "guided_impersonate",
    });

    let responseScripts: RegexScriptDTO[] = [];
    if (config.applyRegex) {
      const [promptScripts, fetchedResponseScripts] = await Promise.all([
        guidanceText !== null
          ? fetchActiveRegexScripts(this.spindle, {
              target: "prompt",
              characterId,
              chatId,
              userId,
            })
          : Promise.resolve([] as RegexScriptDTO[]),
        fetchActiveRegexScripts(this.spindle, {
          target: "response",
          characterId,
          chatId,
          userId,
        }),
      ]);
      responseScripts = fetchedResponseScripts;

      if (guidanceText !== null && promptScripts.length > 0) {
        const effectiveDepth = computeEffectiveGuidanceDepth(
          config.guidancePosition,
          config.guidanceDepth,
          isChatHistory,
        );
        const placement = mapInjectionRoleToRegexPlacement(config.injectionRole);
        guidanceText = await applyRegexScripts(
          guidanceText,
          promptScripts,
          placement,
          effectiveDepth,
          { resolveMacros },
        );
      }
    }

    const injectedMessages = injectGuidanceMessage(
      assembledMessages,
      guidanceText,
      config.injectionRole,
      {
        actionId,
        guidancePosition: config.guidancePosition,
        guidanceDepth: config.guidanceDepth,
        isChatHistory,
      },
    );
    const messages = stripInternalMessageMarkers(injectedMessages);

    const transformResponseOutput: OutputTransformer | undefined = config.applyRegex
      ? async ({ deltaText, reasoningText }) => {
          const processed = await processResponseOutput({
            content: deltaText,
            ...(reasoningText ? { reasoning: reasoningText } : {}),
            scripts: responseScripts,
            resolveMacros,
          });
          return {
            deltaText: processed.content,
            reasoningText: processed.reasoning ?? reasoningText,
          };
        }
      : undefined;

    const transformImpersonateOutput = config.applyRegex
      ? async (rawText: string) => {
          const processed = await processResponseOutput({
            content: rawText,
            scripts: responseScripts,
            resolveMacros,
          });
          return processed.content;
        }
      : undefined;

    const rawInput: GenerationRequestWithSignal = {
      type: "raw",
      messages,
      parameters: dryRunResult.parameters,
      ...(connectionId ? { connection_id: connectionId } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(userId ? { userId } : {}),
      signal,
    };

    return {
      rawInput,
      transformResponseOutput,
      transformImpersonateOutput,
    };
  }

  private assertRequiredPermissions(actionId: GuidedActionId): void {
    if (!this.spindle.permissions.has("generation")) {
      throw new Error("Missing required 'generation' permission for Guided Generations.");
    }
    if (!this.spindle.permissions.has("chats")) {
      throw new Error("Missing required 'chats' permission for Guided Generations.");
    }
    if (actionId !== "guided_impersonate" && !this.spindle.permissions.has("chat_mutation")) {
      throw new Error("Missing required 'chat_mutation' permission for Guided Generations.");
    }
  }

  private async resolveChatContext(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<{ chatId: string; characterId?: string }> {
    if (requestedChatId) {
      const chat = await this.spindle.chats.get(requestedChatId, userId);
      if (!chat) {
        throw new Error("The requested chat is no longer available.");
      }
      return {
        chatId: chat.id,
        ...(typeof chat.character_id === "string" && chat.character_id
          ? { characterId: chat.character_id }
          : {}),
      };
    }
    const active = await this.spindle.chats.getActive(userId);
    if (!active) {
      throw new Error("Open a chat before running a Guided Generations action.");
    }
    return {
      chatId: active.id,
      ...(typeof active.character_id === "string" && active.character_id
        ? { characterId: active.character_id }
        : {}),
    };
  }

  private mergeDryRunAndCapturedMessages(
    dryRunResult: DryRunResultWithRequestMessages,
    capturedMessages?: AssembledLlmMessageDTO[],
  ): AssembledLlmMessageDTO[] {
    const requestMessages = dryRunResult.request_messages;
    if (Array.isArray(requestMessages)) {
      const reqHasMetadata = requestMessages.some(
        (m) =>
          typeof m.__isChatHistory === "boolean" ||
          typeof m.__chatHistorySource === "boolean" ||
          (typeof m.sourceMessageId === "string" && m.sourceMessageId.length > 0) ||
          (typeof m.__sourceMessageId === "string" && m.__sourceMessageId.length > 0),
      );
      if (capturedMessages && capturedMessages.length > 0) {
        if (capturedMessages.length === requestMessages.length) {
          return requestMessages.map((msg, idx) => {
            const cap = capturedMessages[idx]!;
            return {
              ...msg,
              ...(msg.__isChatHistory === undefined && cap.__isChatHistory !== undefined
                ? { __isChatHistory: cap.__isChatHistory }
                : {}),
              ...(msg.__isWorldInfoEntry === undefined && cap.__isWorldInfoEntry !== undefined
                ? { __isWorldInfoEntry: cap.__isWorldInfoEntry }
                : {}),
              ...(msg.__chatHistorySource === undefined && cap.__chatHistorySource !== undefined
                ? { __chatHistorySource: cap.__chatHistorySource }
                : {}),
              ...(msg.__worldInfoSource === undefined && cap.__worldInfoSource !== undefined
                ? { __worldInfoSource: cap.__worldInfoSource }
                : {}),
              ...(msg.sourceMessageId === undefined && cap.sourceMessageId !== undefined
                ? { sourceMessageId: cap.sourceMessageId }
                : {}),
              ...(msg.__sourceMessageId === undefined && cap.__sourceMessageId !== undefined
                ? { __sourceMessageId: cap.__sourceMessageId }
                : {}),
              ...(msg.sourceIndexInChat === undefined && cap.sourceIndexInChat !== undefined
                ? { sourceIndexInChat: cap.sourceIndexInChat }
                : {}),
              ...(msg.__sourceIndexInChat === undefined && cap.__sourceIndexInChat !== undefined
                ? { __sourceIndexInChat: cap.__sourceIndexInChat }
                : {}),
            };
          });
        }
        if (!reqHasMetadata) {
          return capturedMessages;
        }
      }
      return requestMessages;
    }

    if (capturedMessages && capturedMessages.length > 0) {
      return capturedMessages;
    }

    return dryRunResult.messages;
  }

  private async fetchPresetBlocksFallback(
    presetId: string | null,
    userId?: string,
  ): Promise<PromptBlockSnapshotDTO[] | undefined> {
    if (!presetId || !this.spindle.permissions?.has?.("presets")) {
      return undefined;
    }
    try {
      const blocksApi = this.spindle.presets?.blocks;
      if (blocksApi && typeof blocksApi.list === "function") {
        const blocks = await blocksApi.list(presetId, userId);
        if (Array.isArray(blocks) && blocks.length > 0) {
          return blocks;
        }
      }
      if (typeof this.spindle.presets?.get === "function") {
        const preset = await this.spindle.presets.get(presetId, userId);
        if (preset && Array.isArray(preset.prompt_order) && preset.prompt_order.length > 0) {
          return preset.prompt_order;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private createRegexMacroResolver(
    chatId: string,
    characterId?: string,
    userId?: string,
  ): ((input: string) => Promise<string>) | undefined {
    const macrosApi = (this.spindle as { macros?: SpindleAPI["macros"] }).macros;
    if (!macrosApi || typeof macrosApi.resolve !== "function") {
      return undefined;
    }
    return async (macroInput: string): Promise<string> => {
      try {
        const res = await macrosApi.resolve(macroInput, {
          chatId,
          ...(characterId ? { characterId } : {}),
          ...(userId ? { userId } : {}),
          commit: false,
        });
        return typeof res?.text === "string" ? res.text : macroInput;
      } catch {
        return macroInput;
      }
    };
  }

  private async resolveInstructionTemplate(
    template: string,
    ctx: { chatId: string; characterId?: string; userId?: string },
  ): Promise<string> {
    if (!template || !template.trim()) return template;
    const macrosApi = (this.spindle as { macros?: SpindleAPI["macros"] }).macros;
    if (!macrosApi || typeof macrosApi.resolve !== "function") {
      return template;
    }

    const INPUT_PLACEHOLDER = "__GG_INPUT_PLACEHOLDER_7F3A9C__";
    const hasInputToken = template.includes("{{input}}");
    const safeTemplate = hasInputToken
      ? template.replaceAll("{{input}}", INPUT_PLACEHOLDER)
      : template;

    try {
      const res = await macrosApi.resolve(safeTemplate, {
        chatId: ctx.chatId,
        ...(ctx.characterId ? { characterId: ctx.characterId } : {}),
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        commit: false,
      });
      const resolvedText = typeof res?.text === "string" ? res.text : safeTemplate;
      return hasInputToken
        ? resolvedText.replaceAll(INPUT_PLACEHOLDER, "{{input}}")
        : resolvedText;
    } catch (error) {
      this.spindle.log?.warn?.(
        `[GuidedGenerations] Failed resolving template macros: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return template;
    }
  }

  private async resolveConnection(
    configuredConnectionId: string | null,
    activeConnectionId?: string | null,
    userId?: string,
  ): Promise<ConnectionProfileDTO | undefined> {
    const connections = await this.spindle.connections.list(userId);
    if (configuredConnectionId) {
      const found = connections.find((c) => c.id === configuredConnectionId);
      if (!found) {
        throw new Error(
          "Selected API connection profile for this action no longer exists. Choose another in Settings.",
        );
      }
      return found;
    }

    if (activeConnectionId) {
      const active = connections.find((c) => c.id === activeConnectionId);
      if (active) return active;
    }

    return connections.find((c) => c.is_default) ?? connections[0];
  }

  private async resolvePresetContext(
    configuredPresetId: string | null,
    chatId: string,
    userId?: string,
    preverifiedPreset?: { id: string; name?: string } | null,
  ): Promise<{ presetId: string | null; presetName?: string }> {
    if (!this.spindle.permissions?.has?.("presets")) {
      return { presetId: null };
    }

    const trimmedConfigured =
      typeof configuredPresetId === "string" ? configuredPresetId.trim() : "";
    if (trimmedConfigured) {
      if (preverifiedPreset !== undefined) {
        if (!preverifiedPreset) return { presetId: null };
        const name =
          typeof preverifiedPreset.name === "string" && preverifiedPreset.name.trim()
            ? preverifiedPreset.name.trim()
            : undefined;
        return { presetId: trimmedConfigured, ...(name ? { presetName: name } : {}) };
      }
      if (typeof this.spindle.presets?.get === "function") {
        try {
          const preset = await this.spindle.presets.get(trimmedConfigured, userId);
          if (!preset) return { presetId: null };
          const name =
            typeof preset.name === "string" && preset.name.trim()
              ? preset.name.trim()
              : undefined;
          return { presetId: trimmedConfigured, ...(name ? { presetName: name } : {}) };
        } catch {
          return { presetId: null };
        }
      }
      return { presetId: null };
    }

    const getActive = (
      this.spindle.presets as unknown as {
        getActive?: (
          chatId?: string,
          userId?: string,
        ) => Promise<{ preset_id?: string | null } | null>;
      }
    )?.getActive;
    if (typeof getActive === "function") {
      try {
        const res = await getActive.call(this.spindle.presets, chatId, userId);
        const activeId = typeof res?.preset_id === "string" ? res.preset_id.trim() : "";
        return { presetId: activeId.length > 0 ? activeId : null };
      } catch {
        return { presetId: null };
      }
    }

    return { presetId: null };
  }

  private resolveMetricsPresetContext(
    presetContext: { presetId: string | null; presetName?: string },
    configuredPresetId: string | null,
    resolvedConnection?: ConnectionProfileDTO,
  ): { presetId: string | null; presetName?: string } {
    if (presetContext.presetId) {
      return presetContext;
    }
    const hasConfigured =
      typeof configuredPresetId === "string" && configuredPresetId.trim().length > 0;
    const hasGetActive =
      typeof (this.spindle.presets as unknown as { getActive?: unknown })?.getActive ===
      "function";
    if (!hasConfigured && !hasGetActive) {
      const connPresetId =
        typeof resolvedConnection?.preset_id === "string"
          ? resolvedConnection.preset_id.trim()
          : "";
      if (connPresetId) {
        return { presetId: connPresetId };
      }
    }
    return presetContext;
  }

  private async emitMetricsForCompletedStream(args: {
    chatId: string;
    userId?: string;
    streamRes: StreamMessageResult;
    isContinue?: boolean;
    model?: string;
    provider?: string;
    presetId?: string | null;
    presetName?: string;
  }): Promise<void> {
    const { streamRes } = args;
    if (
      streamRes.aborted ||
      !streamRes.hasOutput ||
      !streamRes.messageId ||
      streamRes.swipeId == null ||
      !streamRes.timingSource
    ) {
      return;
    }

    try {
      const hasDelimitedReasoning =
        !streamRes.hasReasoning &&
        /<(?:think|thinking)\b[\s\S]*?<\/(?:think|thinking)>/i.test(streamRes.rawDeltaText);

      const { tokenCount, generationMetrics } = await buildGenerationMetricsPayload({
        spindle: this.spindle,
        userId: args.userId,
        isContinue: args.isContinue,
        finalText: streamRes.finalText,
        rawDeltaText: streamRes.rawDeltaText,
        hasReasoning: streamRes.hasReasoning,
        hasDelimitedReasoning,
        usage: streamRes.usage,
        timingSource: streamRes.timingSource,
        model: args.model,
        provider: args.provider,
        presetId: args.presetId,
        presetName: args.presetName,
      });

      if (tokenCount != null || generationMetrics != null) {
        this.emitFrontend(
          {
            type: "gg:generation_metrics",
            chatId: args.chatId,
            messageId: streamRes.messageId,
            swipeId: streamRes.swipeId,
            ...(tokenCount != null ? { tokenCount } : {}),
            ...(generationMetrics != null ? { generationMetrics } : {}),
          },
          args.userId,
        );
      }
    } catch (err) {
      this.spindle.log?.warn?.(
        `[GuidedGenerations] Failed emitting generation metrics: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private createGuidedSwipeSession(
    chatId: string,
    targetMessage: ChatMessageWithRole,
  ): GuidedSwipeSession {
    const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(targetMessage);
    const newSwipeIndex = swipes.length;
    const slotSwipes = [...swipes, ""];
    const slotSwipeDates = [...swipeDates, Math.floor(Date.now() / 1000)];
    let currentViewedSwipeId = activeIndex;
    let swipeEventSeq = 0;
    let finalizing = false;
    let triggerFlush: (() => void) | null = null;

    const swipeDisposer = this.spindle.on?.("MESSAGE_SWIPED", (payload) => {
      const event = payload as MessageSwipedPayloadDTO | undefined;
      if (!event || event.chatId !== chatId || event.message?.id !== targetMessage.id) {
        return;
      }
      const nextSwipeId =
        typeof event.message?.swipe_id === "number" && Number.isFinite(event.message.swipe_id)
          ? Math.floor(event.message.swipe_id)
          : typeof event.swipeId === "number" && Number.isFinite(event.swipeId)
            ? Math.floor(event.swipeId)
            : undefined;
      if (nextSwipeId === undefined) return;

      swipeEventSeq += 1;
      const previousViewed = currentViewedSwipeId;
      currentViewedSwipeId = nextSwipeId;

      if (
        !finalizing &&
        nextSwipeId === newSwipeIndex &&
        previousViewed !== newSwipeIndex
      ) {
        triggerFlush?.();
      }
    });

    return {
      targetAssistantId: targetMessage.id,
      initialSwipeId: activeIndex,
      newSwipeIndex,
      swipes: slotSwipes,
      swipeDates: slotSwipeDates,
      initialExtra: targetMessage.extra ? this.cloneRecord(targetMessage.extra) : {},
      getCurrentViewedSwipeId: () => currentViewedSwipeId,
      setCurrentViewedSwipeId: (id: number) => {
        currentViewedSwipeId = id;
      },
      getSwipeEventSeq: () => swipeEventSeq,
      setTriggerFlush: (trigger: (() => void) | null) => {
        triggerFlush = trigger;
      },
      setFinalizing: (value: boolean) => {
        finalizing = value;
      },
      dispose: () => {
        if (typeof swipeDisposer === "function") {
          swipeDisposer();
        }
      },
    };
  }

  private cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
    try {
      return structuredClone(record);
    } catch {
      const cloned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) {
        cloned[k] = Array.isArray(v)
          ? v.map((item) =>
              item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : item,
            )
          : v && typeof v === "object"
            ? { ...(v as Record<string, unknown>) }
            : v;
      }
      return cloned;
    }
  }

  private cloneMessageSnapshot(message: ChatMessageWithRole): ChatMessageWithRole {
    return {
      ...message,
      swipes: Array.isArray(message.swipes) ? [...message.swipes] : [],
      swipe_dates: Array.isArray(message.swipe_dates) ? [...message.swipe_dates] : [],
      extra: message.extra ? this.cloneRecord(message.extra) : {},
      ...(message.metadata ? { metadata: this.cloneRecord(message.metadata) } : {}),
    };
  }

  private async restoreTrailingAssistant(
    chatId: string,
    snapshot: ChatMessageWithRole,
    emptyCreatedMessageId?: string,
    userId?: string,
  ): Promise<void> {
    try {
      if (emptyCreatedMessageId) {
        try {
          await this.spindle.chat.deleteMessage(chatId, emptyCreatedMessageId);
        } catch {
          // Best-effort cleanup of empty pre-created slot before restoring snapshot.
        }
      }

      const restored = await this.spindle.chat.appendMessage(
        chatId,
        {
          role: "assistant",
          content: snapshot.content ?? "",
          ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
        },
        { triggerGeneration: false },
      );

      const hasMultipleSwipes = Array.isArray(snapshot.swipes) && snapshot.swipes.length > 1;
      const hasSwipeDates =
        Array.isArray(snapshot.swipe_dates) && snapshot.swipe_dates.length > 0;
      const hasPerSwipeReasoning =
        Array.isArray(snapshot.extra?.reasoningBySwipe) ||
        Array.isArray(snapshot.extra?.reasoningDurationBySwipe);
      const rawReasoning = snapshot.extra?.reasoning;
      const rawDuration =
        snapshot.extra?.reasoningDuration ?? snapshot.extra?.reasoning_duration;
      const hasReasoning =
        typeof rawReasoning === "string" || typeof rawDuration === "number";

      if (hasMultipleSwipes || hasSwipeDates || hasPerSwipeReasoning || hasReasoning) {
        const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(snapshot);
        const swipeReasoning = hasPerSwipeReasoning
          ? swipes.map((_, idx) => {
              const r = extractSwipeReasoning(snapshot, idx);
              return r.text !== null || r.duration !== null
                ? {
                    text: r.text,
                    ...(r.duration !== null ? { duration: r.duration } : {}),
                  }
                : null;
            })
          : undefined;
        await this.spindle.chat.updateMessage(chatId, restored.id, {
          content: snapshot.content ?? swipes[activeIndex] ?? "",
          swipes,
          swipe_id: activeIndex,
          swipe_dates: swipeDates,
          ...(swipeReasoning ? { swipe_reasoning: swipeReasoning } : {}),
          ...(hasReasoning
            ? {
                reasoning: {
                  ...(typeof rawReasoning === "string" ? { text: rawReasoning } : {}),
                  ...(typeof rawDuration === "number" ? { duration: rawDuration } : {}),
                },
              }
            : {}),
        });
      }

      await this.store.rebindContinueHistoryMessageId(
        chatId,
        snapshot.id,
        restored.id,
        userId,
      );
    } catch (restoreError) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed restoring regenerated message: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
      );
    }
  }

  private async restorePreRegenMessage(
    chatId: string,
    preRegen: {
      messageId: string;
      swipeIndex: number;
      swipes: string[];
      swipeDates: number[];
      text: string;
      reasoning: string | null;
      reasoningDuration: number | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      const latest = await this.spindle.chat
        .getMessages(chatId)
        .then((msgs) => msgs.find((m) => m.id === preRegen.messageId))
        .catch(() => undefined);
      const normalized = latest ? normalizeMessageSwipes(latest) : null;
      const swipes =
        normalized && normalized.swipes.length > preRegen.swipeIndex
          ? normalized.swipes
          : preRegen.swipes;
      const swipeDates =
        normalized && normalized.swipeDates.length > preRegen.swipeIndex
          ? normalized.swipeDates
          : preRegen.swipeDates;

      await this.spindle.chat.updateMessage(
        chatId,
        preRegen.messageId,
        buildActiveSwipePatch({
          swipes,
          swipeIndex: preRegen.swipeIndex,
          content: preRegen.text,
          swipeDates,
          reasoningText: preRegen.reasoning,
          reasoningDuration: preRegen.reasoningDuration,
          ...(preRegen.metadata !== undefined ? { metadata: preRegen.metadata } : {}),
          skipChunkRebuild: false,
        }),
      );
    } catch (restoreError) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed restoring pre-regenerate continue message: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
      );
    }
  }

  private async executeAssistantResponse(
    actionId: "guided_response" | "guided_regenerate",
    runId: string,
    chatId: string,
    createdMessageId: string,
    createdSwipeDates: number[],
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    regeneratedSnapshot: ChatMessageWithRole | null,
    transformOutput?: OutputTransformer,
    userId?: string,
    metricsPreset?: { presetId: string | null; presetName?: string },
  ): Promise<ActionRunResult> {
    let hadStreamOutput = false;

    try {
      const streamRes = await this.streamIntoMessage(
        chatId,
        rawInput,
        signal,
        async () => ({
          messageId: createdMessageId,
          swipes: [""],
          swipeIndex: 0,
          swipeDates: createdSwipeDates,
          baseText: "",
        }),
        undefined,
        transformOutput,
        undefined,
        () => {
          hadStreamOutput = true;
        },
        undefined,
        () => {
          this.updateActiveRunState(userId, runId, { hasContentOutput: true });
        },
      );

      let restoredOriginal = false;
      if (!streamRes.hasOutput && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(
          chatId,
          regeneratedSnapshot,
          createdMessageId,
          userId,
        );
        restoredOriginal = true;
      }

      if (!restoredOriginal) {
        await this.emitMetricsForCompletedStream({
          chatId,
          userId,
          streamRes,
          isContinue: false,
          model: rawInput.model,
          provider: rawInput.provider,
          presetId: metricsPreset?.presetId,
          presetName: metricsPreset?.presetName,
        });
      }

      return {
        runId,
        actionId,
        chatId,
        aborted: streamRes.aborted,
        ...(restoredOriginal ? {} : { messageId: createdMessageId, swipeId: 0 }),
        text: streamRes.finalText,
      };
    } catch (error) {
      if (!hadStreamOutput && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(
          chatId,
          regeneratedSnapshot,
          createdMessageId,
          userId,
        );
      }
      throw error;
    }
  }

  private async executeGuidedContinue(
    runId: string,
    chatId: string,
    targetId: string,
    inputText: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    userId?: string,
    transformOutput?: OutputTransformer,
    metricsPreset?: { presetId: string | null; presetName?: string },
  ): Promise<ActionRunResult> {
    const initial = await this.readTargetMessageOrThrow(chatId, targetId);
    const initialNormalized = normalizeMessageSwipes(initial);
    const initialBaseText =
      initialNormalized.swipes[initialNormalized.activeIndex] ?? initial.content ?? "";
    const initialReasoning = extractSwipeReasoning(initial, initialNormalized.activeIndex);

    const capturedSnapshot = {
      messageId: initial.id,
      swipeIndex: initialNormalized.activeIndex,
      baseText: initialBaseText,
      baseReasoning: initialReasoning.text,
      baseReasoningDuration: initialReasoning.duration,
    };

    const baseTarget: StreamTargetState = {
      messageId: initial.id,
      swipes: initialNormalized.swipes,
      swipeIndex: initialNormalized.activeIndex,
      swipeDates: initialNormalized.swipeDates,
      baseText: initialBaseText,
    };

    const recordHistory = async (resultText: string) => {
      await this.store.pushContinueEntry(
        {
          chatId,
          messageId: capturedSnapshot.messageId,
          swipeIndex: capturedSnapshot.swipeIndex,
          baseText: capturedSnapshot.baseText,
          resultText,
          baseReasoning: capturedSnapshot.baseReasoning,
          baseReasoningDuration: capturedSnapshot.baseReasoningDuration,
          inputText,
        },
        userId,
      );
    };

    const streamRes = await this.streamIntoMessage(
      chatId,
      rawInput,
      signal,
      async () => {
        const latest = await this.readTargetMessageOrThrow(chatId, targetId);
        const latestNorm = normalizeMessageSwipes(latest);
        const swipes =
          latestNorm.swipes.length > baseTarget.swipeIndex
            ? latestNorm.swipes
            : [
                ...latestNorm.swipes,
                ...baseTarget.swipes.slice(latestNorm.swipes.length),
              ];
        const swipeDates =
          latestNorm.swipeDates.length > baseTarget.swipeIndex
            ? latestNorm.swipeDates
            : [
                ...latestNorm.swipeDates,
                ...baseTarget.swipeDates.slice(latestNorm.swipeDates.length),
              ];
        return {
          ...baseTarget,
          messageId: latest.id,
          swipes,
          swipeDates,
        };
      },
      async (current) => this.refreshSwipeTarget(chatId, current),
      transformOutput,
      undefined,
      undefined,
      async ({ finalText }) => {
        await recordHistory(finalText);
      },
      () => {
        this.updateActiveRunState(userId, runId, { hasContentOutput: true });
      },
    );

    if (streamRes.hasOutput) {
      await recordHistory(streamRes.finalText);
    }

    await this.emitMetricsForCompletedStream({
      chatId,
      userId,
      streamRes,
      isContinue: true,
      model: rawInput.model,
      provider: rawInput.provider,
      presetId: metricsPreset?.presetId,
      presetName: metricsPreset?.presetName,
    });

    return {
      runId,
      actionId: "guided_continue",
      chatId,
      aborted: streamRes.aborted,
      messageId: streamRes.messageId ?? initial.id,
      swipeId: streamRes.swipeId ?? initialNormalized.activeIndex,
      text: streamRes.hasOutput ? streamRes.finalText : initialBaseText,
    };
  }

  private async executeGuidedSwipe(
    runId: string,
    chatId: string,
    swipeSession: GuidedSwipeSession,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    transformOutput?: OutputTransformer,
    userId?: string,
    metricsPreset?: { presetId: string | null; presetName?: string },
  ): Promise<ActionRunResult> {
    const streamRes = await this.streamIntoMessage(
      chatId,
      rawInput,
      signal,
      async () => {
        const baseTarget: StreamTargetState = {
          messageId: swipeSession.targetAssistantId,
          swipes: swipeSession.swipes,
          swipeIndex: swipeSession.newSwipeIndex,
          swipeDates: swipeSession.swipeDates,
          baseText: "",
          latestSwipeId: swipeSession.getCurrentViewedSwipeId(),
          latestExtra: swipeSession.initialExtra,
        };
        const seqBeforeRead = swipeSession.getSwipeEventSeq();
        const refreshed = await this.refreshSwipeTarget(chatId, baseTarget);
        if (
          swipeSession.getSwipeEventSeq() === seqBeforeRead &&
          refreshed.latestSwipeId !== undefined
        ) {
          swipeSession.setCurrentViewedSwipeId(refreshed.latestSwipeId);
        }
        return refreshed;
      },
      async (current) => {
        const seqBeforeRead = swipeSession.getSwipeEventSeq();
        const refreshed = await this.refreshSwipeTarget(chatId, current);
        if (
          swipeSession.getSwipeEventSeq() === seqBeforeRead &&
          refreshed.latestSwipeId !== undefined
        ) {
          swipeSession.setCurrentViewedSwipeId(refreshed.latestSwipeId);
        }
        return refreshed;
      },
      transformOutput,
      {
        isViewingTargetSwipe: () =>
          swipeSession.getCurrentViewedSwipeId() === swipeSession.newSwipeIndex,
        setTriggerFlush: (trigger) => {
          swipeSession.setTriggerFlush(trigger);
        },
        onFinalizing: () => {
          swipeSession.setFinalizing(true);
        },
      },
      undefined,
      undefined,
      () => {
        this.updateActiveRunState(userId, runId, { hasContentOutput: true });
      },
    );

    await this.emitMetricsForCompletedStream({
      chatId,
      userId,
      streamRes,
      isContinue: false,
      model: rawInput.model,
      provider: rawInput.provider,
      presetId: metricsPreset?.presetId,
      presetName: metricsPreset?.presetName,
    });

    return {
      runId,
      actionId: "guided_swipe",
      chatId,
      aborted: streamRes.aborted,
      messageId: streamRes.messageId ?? swipeSession.targetAssistantId,
      swipeId: streamRes.swipeId ?? swipeSession.newSwipeIndex,
      text: streamRes.finalText,
    };
  }

  private async executeImpersonate(
    runId: string,
    chatId: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    userId?: string,
    transformOutput?: (rawText: string) => Promise<string>,
  ): Promise<ActionRunResult> {
    if (signal.aborted) {
      this.emitFrontend(
        { type: "gg:impersonate-chunk", chatId, text: "", done: true, aborted: true },
        userId,
      );
      return {
        runId,
        actionId: "guided_impersonate",
        chatId,
        aborted: true,
        text: "",
      };
    }

    let generated = "";
    let lastEmitAt = 0;
    let aborted = false;

    try {
      try {
        for await (const chunk of this.spindle.generate.rawStream(rawInput)) {
          if (signal.aborted) {
            aborted = true;
            break;
          }
          if (chunk.type === "token") {
            generated += chunk.token;
            const now = Date.now();
            if (now - lastEmitAt >= STREAM_FLUSH_INTERVAL_MS) {
              lastEmitAt = now;
              this.emitFrontend(
                { type: "gg:impersonate-chunk", chatId, text: generated, done: false },
                userId,
              );
            }
          } else if (chunk.type === "done") {
            if (chunk.content) generated = chunk.content;
          }
        }
      } catch (error) {
        if (isAbortError(error) || signal.aborted) {
          aborted = true;
        } else {
          throw error;
        }
      }

      if (generated.length > 0 && transformOutput) {
        generated = await transformOutput(generated);
      }
    } catch (error) {
      this.emitFrontend(
        { type: "gg:impersonate-chunk", chatId, text: generated, done: true, aborted: true },
        userId,
      );
      throw error;
    }

    this.emitFrontend(
      { type: "gg:impersonate-chunk", chatId, text: generated, done: true, aborted },
      userId,
    );

    return {
      runId,
      actionId: "guided_impersonate",
      chatId,
      aborted,
      text: generated,
    };
  }

  private async streamIntoMessage(
    chatId: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    ensureTarget: () => Promise<StreamTargetState>,
    refreshTarget?: (current: StreamTargetState) => Promise<StreamTargetState>,
    transformOutput?: OutputTransformer,
    swipeOptions?: SwipeStreamOptions,
    onFirstOutput?: () => void,
    onPartialErrorCommit?: (info: {
      messageId: string;
      swipeId: number;
      finalText: string;
    }) => Promise<void> | void,
    onFirstContent?: () => void,
  ): Promise<StreamMessageResult> {
    let deltaText = "";
    let reasoningText = "";
    let forceReasoningPatch = false;
    let aborted = false;
    let lastFlushAt = 0;
    let flushChain: Promise<void> = Promise.resolve();
    let lastFlushError: unknown = null;
    let target: StreamTargetState | null = null;
    let notifiedFirstOutput = false;
    let notifiedFirstContent = false;

    const buildMergedContent = (baseText: string) =>
      baseText ? stitchContinueContent(baseText, deltaText) : deltaText;

    const runUpdatePatch = async (
      messageId: string,
      patch: Parameters<SpindleAPI["chat"]["updateMessage"]>[2],
      swallowError: boolean,
    ) => {
      try {
        await this.spindle.chat.updateMessage(chatId, messageId, patch);
        lastFlushError = null;
      } catch (err) {
        if (!swallowError) {
          lastFlushError = err;
        }
      }
    };

    const enqueuePatchFlush = (
      targetSnapshot: StreamTargetState,
      swallowError: boolean,
      options: {
        skipChunkRebuild?: boolean;
        checkStillViewingMidstream?: boolean;
      } = {},
    ) => {
      const mergedContent = buildMergedContent(targetSnapshot.baseText);
      const patch = buildActiveSwipePatch({
        swipes: targetSnapshot.swipes,
        swipeIndex: targetSnapshot.swipeIndex,
        content: mergedContent,
        swipeDates: targetSnapshot.swipeDates,
        ...(reasoningText || forceReasoningPatch ? { reasoningText } : {}),
        ...(options.skipChunkRebuild !== undefined
          ? { skipChunkRebuild: options.skipChunkRebuild }
          : {}),
      });

      flushChain = flushChain
        .catch(() => undefined)
        .then(async () => {
          if (
            options.checkStillViewingMidstream &&
            swipeOptions &&
            !swipeOptions.isViewingTargetSwipe()
          ) {
            return;
          }
          await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
        });
    };

    const enqueueFinalFlush = (
      targetSnapshot: StreamTargetState,
      swallowError: boolean,
    ) => {
      if (!swipeOptions) {
        enqueuePatchFlush(targetSnapshot, swallowError, {
          skipChunkRebuild: false,
        });
        return;
      }

      const capturedDelta = buildMergedContent(targetSnapshot.baseText);
      const capturedReasoning = reasoningText;
      const capturedForceReasoning = forceReasoningPatch;

      flushChain = flushChain
        .catch(() => undefined)
        .then(async () => {
          const isViewingTarget = swipeOptions.isViewingTargetSwipe();
          if (isViewingTarget) {
            const patch = buildActiveSwipePatch({
              swipes: targetSnapshot.swipes,
              swipeIndex: targetSnapshot.swipeIndex,
              content: capturedDelta,
              swipeDates: targetSnapshot.swipeDates,
              ...(capturedReasoning || capturedForceReasoning
                ? { reasoningText: capturedReasoning }
                : {}),
              skipChunkRebuild: false,
            });
            await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
            return;
          }

          const existingBySwipe = targetSnapshot.latestExtra?.reasoningBySwipe;
          const hadStoredSlotReasoning =
            Array.isArray(existingBySwipe) &&
            existingBySwipe[targetSnapshot.swipeIndex] != null;
          const includeReasoning =
            capturedReasoning.length > 0 ||
            (capturedForceReasoning && hadStoredSlotReasoning);

          const patch = buildBackgroundSwipePatch({
            swipes: targetSnapshot.swipes,
            swipeIndex: targetSnapshot.swipeIndex,
            content: capturedDelta,
            swipeDates: targetSnapshot.swipeDates,
            ...(includeReasoning
              ? {
                  reasoningText: capturedReasoning,
                  clearReasoningSlot: capturedForceReasoning && capturedReasoning.length === 0,
                  existingExtra: targetSnapshot.latestExtra,
                  existingActiveSwipeId: targetSnapshot.latestSwipeId,
                }
              : {}),
          });
          await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
        });
    };

    const maybeFlush = (force: boolean) => {
      if (!target) return;
      if (swipeOptions && !swipeOptions.isViewingTargetSwipe()) return;
      const now = Date.now();
      if (!force && now - lastFlushAt < STREAM_FLUSH_INTERVAL_MS) return;
      lastFlushAt = now;
      enqueuePatchFlush(target, false, {
        skipChunkRebuild: true,
        checkStillViewingMidstream: Boolean(swipeOptions),
      });
    };

    swipeOptions?.setTriggerFlush?.(() => maybeFlush(true));

    const ensureInitializedOnOutput = async () => {
      if (deltaText.length === 0 && reasoningText.length === 0) return;
      if (!notifiedFirstOutput) {
        notifiedFirstOutput = true;
        onFirstOutput?.();
      }
      if (!notifiedFirstContent && deltaText.length > 0) {
        notifiedFirstContent = true;
        onFirstContent?.();
      }
      if (target) return;
      target = await ensureTarget();
    };

    const wasStreaming = rawInput.parameters?._streaming !== false;
    let streamingStartedAt = Date.now();
    let firstTokenAt: number | undefined;
    let firstContentTokenAt: number | undefined;
    let lastProviderContentAt: number | undefined;
    let responseStoppedAt: number | undefined;
    let completedAt: number | undefined;
    let streamUsage: GenerationUsageInput | undefined;

    try {
      const stream = this.spindle.generate.rawStream(rawInput);
      streamingStartedAt = Date.now();
      for await (const chunk of stream) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        if (chunk.type === "token") {
          const receivedAt = Date.now();
          if (chunk.token.length > 0) {
            if (firstTokenAt === undefined) {
              firstTokenAt = receivedAt;
            }
            if (firstContentTokenAt === undefined && /\S/.test(chunk.token)) {
              firstContentTokenAt = receivedAt;
            }
          }
          lastProviderContentAt = receivedAt;
          deltaText += chunk.token;
          await ensureInitializedOnOutput();
          maybeFlush(false);
        } else if (chunk.type === "reasoning") {
          const receivedAt = Date.now();
          if (chunk.token.length > 0 && firstTokenAt === undefined) {
            firstTokenAt = receivedAt;
          }
          reasoningText += chunk.token;
          await ensureInitializedOnOutput();
          maybeFlush(false);
        } else if (chunk.type === "done") {
          if (chunk.content) deltaText = chunk.content;
          if (chunk.reasoning) reasoningText = chunk.reasoning;
          if (chunk.usage) {
            streamUsage = chunk.usage as GenerationUsageInput;
          }
          await ensureInitializedOnOutput();
        }
      }
      if (!aborted && !signal.aborted) {
        responseStoppedAt = Math.max(Date.now(), lastProviderContentAt ?? 0);
      } else if (signal.aborted) {
        aborted = true;
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        aborted = true;
      } else {
        swipeOptions?.onFinalizing?.();
        if (target && (deltaText.length > 0 || reasoningText.length > 0)) {
          await flushChain.catch(() => undefined);
          if (refreshTarget) {
            target = await refreshTarget(target).catch(() => target!);
          }
          enqueueFinalFlush(target, true);
          await flushChain.catch(() => undefined);
          if (onPartialErrorCommit) {
            await Promise.resolve(
              onPartialErrorCommit({
                messageId: target.messageId,
                swipeId: target.swipeIndex,
                finalText: buildMergedContent(target.baseText),
              }),
            ).catch(() => undefined);
          }
        } else {
          await flushChain.catch(() => undefined);
        }
        throw error;
      }
    }

    swipeOptions?.onFinalizing?.();

    const rawDeltaText = deltaText;
    const hasReasoning = reasoningText.length > 0;
    const hasOutput = deltaText.length > 0 || reasoningText.length > 0;
    if (!hasOutput || !target) {
      await flushChain.catch(() => undefined);
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted,
        hasOutput: false,
      };
    }

    if (transformOutput) {
      const hadReasoning = reasoningText.length > 0;
      const transformed = await transformOutput({ deltaText, reasoningText });
      deltaText = transformed.deltaText;
      reasoningText = transformed.reasoningText;
      if (hadReasoning && reasoningText.length === 0) {
        forceReasoningPatch = true;
      }
    }

    if (refreshTarget) {
      await flushChain;
      target = await refreshTarget(target);
    }

    enqueueFinalFlush(target, false);
    await flushChain;

    if (lastFlushError && !aborted) {
      throw lastFlushError;
    }

    if (!aborted && !signal.aborted) {
      completedAt = Date.now();
    } else if (signal.aborted) {
      aborted = true;
    }

    const finalText = buildMergedContent(target.baseText);
    return {
      messageId: target.messageId,
      swipeId: target.swipeIndex,
      finalText,
      rawDeltaText,
      hasReasoning,
      aborted,
      hasOutput: true,
      ...(streamUsage ? { usage: streamUsage } : {}),
      timingSource: {
        streamingStartedAt,
        ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
        ...(firstContentTokenAt !== undefined ? { firstContentTokenAt } : {}),
        ...(responseStoppedAt !== undefined ? { responseStoppedAt } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        wasStreaming,
      },
    };
  }

  private async refreshSwipeTarget(
    chatId: string,
    current: StreamTargetState,
  ): Promise<StreamTargetState> {
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      const latest = messages.find((m) => m.id === current.messageId);
      if (!latest) return current;
      const normalized = normalizeMessageSwipes(latest);
      const swipes =
        normalized.swipes.length > current.swipeIndex
          ? normalized.swipes
          : [...normalized.swipes, ...current.swipes.slice(normalized.swipes.length)];
      const swipeDates =
        normalized.swipeDates.length > current.swipeIndex
          ? normalized.swipeDates
          : [
              ...normalized.swipeDates,
              ...current.swipeDates.slice(normalized.swipeDates.length),
            ];
      return {
        ...current,
        swipes,
        swipeDates,
        latestSwipeId: normalized.activeIndex,
        latestExtra: latest.extra ? this.cloneRecord(latest.extra) : {},
      };
    } catch {
      return current;
    }
  }

  private async readTargetMessageOrThrow(
    chatId: string,
    targetId: string,
  ): Promise<ChatMessageWithRole> {
    const messages = await this.spindle.chat.getMessages(chatId);
    const byId = messages.find((m) => m.id === targetId && isAssistantMessage(m));
    if (byId) return byId;
    throw new Error("Target assistant message is no longer available in this chat.");
  }

  private async findTrailingAssistantMessage(
    chatId: string,
  ): Promise<ChatMessageWithRole | null> {
    const messages = await this.spindle.chat.getMessages(chatId);
    const last = messages[messages.length - 1];
    return isAssistantMessage(last) ? (last ?? null) : null;
  }

  private async requireLastAssistantMessage(
    chatId: string,
  ): Promise<ChatMessageWithRole> {
    const messages = await this.spindle.chat.getMessages(chatId);
    const target = findLastAssistantMessage(messages);
    if (!target) {
      throw new Error("No assistant message found in this chat to continue or swipe.");
    }
    return target;
  }

  private emitStatus(userId?: string): void {
    this.emitFrontend(
      { type: "gg:status", run: this.getActiveRun(userId) },
      userId,
    );
  }
}
