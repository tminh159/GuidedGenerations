import type {
  ConnectionProfileDTO,
  GenerationRequestDTO,
  GenerationResponseDTO,
  InterceptorDisposer,
  MessageSwipedPayloadDTO,
  PromptBlockSnapshotDTO,
  RegexScriptDTO,
  SpindleAPI,
  SwipeEditedPayloadDTO,
} from "lumiverse-spindle-types";
import {
  type AssembledLlmMessageDTO,
  buildActiveSwipePatch,
  buildBackgroundSwipePatch,
  buildDryRunInput,
  buildPresetContextMetadata,
  type ChatMessageWithRole,
  collapseMessagesToSingleRole,
  computeEffectiveGuidanceDepth,
  type DryRunResultWithRequestMessages,
  extractSwipeReasoning,
  findLastAssistantMessage,
  formatGuidanceText,
  hasNonEmptyLlmContent,
  hasPresetContextForSwipe,
  injectGuidanceMessage,
  isAssistantMessage,
  mapInjectionRoleToRegexPlacement,
  mergeConsecutiveSameRoleMessages,
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
  healFormattingArtifacts,
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

interface PendingRun {
  controller?: AbortController;
  chatId?: string;
}

interface PendingDryRunCapture {
  userId?: string;
  generationType: string;
  presetId?: string | null;
  capturedMessages?: AssembledLlmMessageDTO[];
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
  isTargetDeleted?(): boolean;
  getTargetSwipeState?(): {
    swipeIndex: number;
    swipes: string[];
    swipeDates: number[];
  };
  setTriggerFlush?(trigger: () => void): void;
  onFinalizing?(): void;
}

interface GuidedSwipeSession {
  targetAssistantId: string;
  readonly initialSwipeId: number;
  readonly newSwipeIndex: number;
  readonly swipes: string[];
  readonly swipeDates: number[];
  readonly initialExtra: Record<string, unknown>;
  readonly initialMetadata?: Record<string, unknown>;
  getTargetSwipeIndex(): number;
  isTargetDeleted(): boolean;
  getCurrentViewedSwipeId(): number;
  setCurrentViewedSwipeId(id: number): void;
  getSwipeEventSeq(): number;
  syncFromLatestMessage(latest: ChatMessageWithRole): void;
  markSlotCreated(): void;
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
  baseText?: string;
}) => Promise<{ deltaText: string; reasoningText: string; finalText?: string }>;

const STREAM_FLUSH_INTERVAL_MS = 120;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Reads `parameters.samplerOverrides.streaming` from an already-fetched preset
 * without issuing extra RPC calls.
 */
function extractPresetStreamingOverride(
  preset: { parameters?: Record<string, unknown> } | null | undefined,
): boolean | undefined {
  const overrides = preset?.parameters?.samplerOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return undefined;
  }
  const streaming = (overrides as { streaming?: unknown }).streaming;
  return typeof streaming === "boolean" ? streaming : undefined;
}

/**
 * Determines whether streaming is enabled (`_streaming !== false`) and returns
 * a sanitized request whose shallow-cloned `parameters` omits `_streaming`.
 */
function prepareOutboundGenerationInput(rawInput: GenerationRequestWithSignal): {
  wasStreaming: boolean;
  outboundInput: GenerationRequestWithSignal;
} {
  const params = rawInput.parameters;
  const wasStreaming = params?._streaming !== false;
  if (!params) {
    return { wasStreaming, outboundInput: rawInput };
  }
  const { _streaming: _omitted, ...sanitizedParameters } = params;
  return {
    wasStreaming,
    outboundInput: {
      ...rawInput,
      parameters: sanitizedParameters,
    },
  };
}

/**
 * Narrows the `unknown` result of `spindle.generate.raw()` safely.
 */
function asGenerationResponse(raw: unknown): Partial<GenerationResponseDTO> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Partial<GenerationResponseDTO>;
}

export class GuidedGenerationRunner {
  private readonly activeRuns = new Map<string, Map<string, InternalRun>>();
  private readonly pendingUsers = new Map<string, PendingRun[]>();
  private interceptorDisposer: InterceptorDisposer | null = null;
  private readonly pendingDryRunCaptures = new Map<string, PendingDryRunCapture>();
  private readonly chatDryRunQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly spindle: SpindleAPI,
    private readonly store: SettingsStore,
    private readonly emitFrontend: (event: BackendPushEvent, userId?: string) => void,
  ) {}

  dispose(): void {
    for (const userRuns of this.activeRuns.values()) {
      for (const run of userRuns.values()) {
        run.controller.abort();
      }
      userRuns.clear();
    }
    this.activeRuns.clear();

    for (const pendingList of this.pendingUsers.values()) {
      for (const pending of pendingList) {
        pending.controller?.abort();
      }
    }
    this.pendingUsers.clear();
    this.pendingDryRunCaptures.clear();
    this.chatDryRunQueues.clear();

    if (this.interceptorDisposer) {
      this.interceptorDisposer();
      this.interceptorDisposer = null;
    }
  }

  syncInterceptorRegistration(): void {
    if (!this.spindle.permissions?.has?.("interceptor")) {
      if (this.interceptorDisposer) {
        this.interceptorDisposer();
        this.interceptorDisposer = null;
      }
      return;
    }
    this.ensureInterceptorRegistered();
  }

  private ensureInterceptorRegistered(): void {
    if (!this.spindle.permissions?.has?.("interceptor")) {
      if (this.interceptorDisposer) {
        this.interceptorDisposer();
        this.interceptorDisposer = null;
      }
      return;
    }
    if (this.interceptorDisposer) return;
    if (typeof this.spindle.registerInterceptor !== "function") return;

    try {
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
          const matchesUser =
            !pending.userId || !context.userId || context.userId === pending.userId;
          const matchesGenType =
            !pending.generationType ||
            !context.generationType ||
            context.generationType === pending.generationType;
          const matchesPreset =
            !pending.presetId || context.presetId === pending.presetId;
          if (matchesUser && matchesGenType && matchesPreset) {
            pending.capturedMessages = messages.map((m) => ({
              ...(m as AssembledLlmMessageDTO),
            }));
          }
        }
        return messages;
      });
    } catch {
      this.interceptorDisposer = null;
    }
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
      const capture: PendingDryRunCapture = {
        userId,
        generationType: dryRunInput.generationType ?? "normal",
        presetId: dryRunInput.presetId ?? null,
      };
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

  private setActiveRun(key: string, run: InternalRun): void {
    let userRuns = this.activeRuns.get(key);
    if (!userRuns) {
      userRuns = new Map<string, InternalRun>();
      this.activeRuns.set(key, userRuns);
    }
    userRuns.set(run.state.runId, run);
  }

  private deleteActiveRun(key: string, runId: string): boolean {
    const userRuns = this.activeRuns.get(key);
    if (!userRuns || !userRuns.has(runId)) return false;
    userRuns.delete(runId);
    if (userRuns.size === 0) {
      this.activeRuns.delete(key);
    }
    return true;
  }

  private addPendingRun(key: string, entry: PendingRun): void {
    const list = this.pendingUsers.get(key);
    if (list) {
      list.push(entry);
    } else {
      this.pendingUsers.set(key, [entry]);
    }
  }

  private removePendingRun(key: string, entry: PendingRun): void {
    const list = this.pendingUsers.get(key);
    if (!list) return;
    const idx = list.indexOf(entry);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
    if (list.length === 0) {
      this.pendingUsers.delete(key);
    }
  }

  private isChatBusy(
    key: string,
    chatId?: string | null,
    excludePending?: PendingRun,
  ): boolean {
    const trimmed = typeof chatId === "string" && chatId.trim().length > 0 ? chatId.trim() : null;
    const userRuns = this.activeRuns.get(key);
    if (trimmed && userRuns) {
      for (const run of userRuns.values()) {
        if (run.state.chatId === trimmed) return true;
      }
    }
    const pendingList = this.pendingUsers.get(key);
    if (pendingList && pendingList.length > 0) {
      for (const pending of pendingList) {
        if (pending === excludePending) continue;
        if (trimmed) {
          if (pending.chatId === trimmed || !pending.chatId) return true;
        } else {
          if (!pending.chatId) return true;
        }
      }
    }
    return false;
  }

  getActiveRuns(userId?: string): ActiveRunState[] {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    if (!userRuns || userRuns.size === 0) return [];
    return Array.from(userRuns.values(), (run) => ({ ...run.state }));
  }

  getActiveRun(userId?: string, chatId?: string): ActiveRunState | null {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    if (!userRuns || userRuns.size === 0) return null;
    if (typeof chatId === "string" && chatId.length > 0) {
      for (const run of userRuns.values()) {
        if (run.state.chatId === chatId) {
          return { ...run.state };
        }
      }
      return null;
    }
    const runs = Array.from(userRuns.values());
    const latest = runs[runs.length - 1];
    return latest ? { ...latest.state } : null;
  }

  private updateActiveRunState(
    userId: string | undefined,
    runId: string,
    patch: Partial<ActiveRunState>,
  ): void {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    const active = userRuns?.get(runId);
    if (!active) {
      return;
    }
    active.state = {
      ...active.state,
      ...patch,
    };
    this.emitStatus(userId, runId);
  }

  abortCurrent(userId?: string, runId?: string, chatId?: string): boolean {
    const key = this.userKey(userId);
    const userRuns = this.activeRuns.get(key);
    const trimmedChatId =
      typeof chatId === "string" && chatId.trim().length > 0 ? chatId.trim() : undefined;
    if (runId) {
      const run = userRuns?.get(runId);
      if (!run) return false;
      run.controller.abort();
      return true;
    }
    if (userRuns && userRuns.size > 0) {
      const runs = Array.from(userRuns.values());
      const targetRun = trimmedChatId
        ? [...runs].reverse().find((run) => run.state.chatId === trimmedChatId)
        : runs[runs.length - 1];
      if (targetRun) {
        targetRun.controller.abort();
        return true;
      }
    }
    const pendingList = this.pendingUsers.get(key);
    if (pendingList && pendingList.length > 0) {
      const abortablePending = pendingList.filter((entry) => Boolean(entry.controller));
      const reversedPending = [...abortablePending].reverse();
      const targetPending = trimmedChatId
        ? reversedPending.find((entry) => entry.chatId === trimmedChatId) ??
          reversedPending.find((entry) => entry.chatId === undefined)
        : abortablePending[abortablePending.length - 1];
      if (targetPending?.controller) {
        targetPending.controller.abort();
        return true;
      }
    }
    return false;
  }

  async run(input: RunActionInput, userId?: string): Promise<ActionRunResult> {
    const key = this.userKey(userId);
    const requestedChatId =
      typeof input.chatId === "string" && input.chatId.trim().length > 0
        ? input.chatId.trim()
        : null;
    if (this.isChatBusy(key, requestedChatId)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before starting another.",
      );
    }

    this.assertRequiredPermissions(input.actionId);
    const controller = new AbortController();
    const pendingEntry: PendingRun = {
      controller,
      ...(requestedChatId ? { chatId: requestedChatId } : {}),
    };
    this.addPendingRun(key, pendingEntry);

    let runId: string | undefined;
    let resolvedChatId: string | undefined;
    let wasAborted = false;
    let emitErrorStatus = true;

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

      const { chatId, characterId, characterName, avatarUrl } = await this.resolveChatContext(
        requestedChatId,
        userId,
      );
      resolvedChatId = chatId;
      pendingEntry.chatId = chatId;
      if (this.isChatBusy(key, chatId, pendingEntry)) {
        emitErrorStatus = false;
        throw new Error(
          "A Guided Generations action is already running. Stop it before starting another.",
        );
      }

      runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      if (controller.signal.aborted) {
        wasAborted = true;
        return {
          runId,
          actionId: input.actionId,
          chatId,
          aborted: true,
          text: "",
        };
      }

      this.setActiveRun(key, {
        state: {
          runId,
          actionId: input.actionId,
          chatId,
          startedAt: Date.now(),
          ...(characterId ? { characterId } : {}),
          ...(characterName ? { characterName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        controller,
      });
      this.removePendingRun(key, pendingEntry);
      this.emitStatus(userId, runId);

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

      let preverifiedPreset:
        | { id: string; name?: string; parameters?: Record<string, unknown> }
        | null
        | undefined;
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
      let targetSwipeIsBlank = false;
      if (input.actionId === "guided_continue" || input.actionId === "guided_swipe") {
        preTargetMessage = await this.requireLastAssistantMessage(chatId);
        targetAssistantId = preTargetMessage.id;
        if (input.actionId === "guided_swipe") {
          const preNorm = normalizeMessageSwipes(preTargetMessage);
          const activeSwipeText =
            preNorm.swipes[preNorm.activeIndex] ?? preTargetMessage.content ?? "";
          targetSwipeIsBlank = activeSwipeText.trim().length === 0;
        }
      }

      if (controller.signal.aborted) {
        wasAborted = true;
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
      let pendingBlankSlotCreate = false;
      let pendingSwipeSlotWrite: (() => Promise<void>) | null = null;

      const activeRunId = runId;
      const createBlankAssistantSlot = async () => {
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
        this.updateActiveRunState(userId, activeRunId, {
          messageId: created.id,
          swipeId: 0,
        });
      };

      try {
        if (input.actionId === "guided_response") {
          // Defer creating the blank slot until after dryRun so Lumiverse's
          // stripEmptyTextParts never drops it before interceptor capture and
          // depth >= 1 blocks assemble at the right turn.
          pendingBlankSlotCreate = true;
        } else if (input.actionId === "guided_regenerate") {
          const trailingAssistant = await this.findTrailingAssistantMessage(chatId);
          if (controller.signal.aborted) {
            wasAborted = true;
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
            wasAborted = true;
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
          pendingBlankSlotCreate = true;
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
          const session = this.createGuidedSwipeSession(chatId, preTargetMessage, userId, {
            onTargetSwipeIndexChanged: (swipeId) => {
              this.updateActiveRunState(userId, activeRunId, { swipeId });
            },
            onTargetDeleted: () => {
              controller.abort();
            },
          });
          swipeSession = session;
          // Defer writing/blanking the swipe slot until after dryRun so
          // Lumiverse's stripEmptyTextParts does not drop targetAssistantId
          // before interceptor capture and depth >= 1 blocks assemble cleanly.
          pendingSwipeSlotWrite = async () => {
            const latestTarget = await this.readTargetMessageOrThrow(
              chatId,
              session.targetAssistantId,
            );
            session.syncFromLatestMessage(latestTarget);
            const metadata = resolvedPresetId
              ? buildPresetContextMetadata(
                  latestTarget.metadata,
                  session.newSwipeIndex,
                  resolvedPresetId,
                )
              : undefined;
            const seqBeforeWrite = session.getSwipeEventSeq();
            if (!backgroundSwipe) {
              await this.spindle.chat.updateMessage(
                chatId,
                session.targetAssistantId,
                buildActiveSwipePatch({
                  swipes: session.swipes,
                  swipeIndex: session.newSwipeIndex,
                  content: "",
                  swipeDates: session.swipeDates,
                  ...(metadata ? { metadata } : {}),
                  skipChunkRebuild: true,
                }),
              );
              if (
                session.getSwipeEventSeq() === seqBeforeWrite &&
                session.getCurrentViewedSwipeId() === session.initialSwipeId
              ) {
                session.setCurrentViewedSwipeId(session.newSwipeIndex);
              }
            } else {
              await this.spindle.chat.updateMessage(
                chatId,
                session.targetAssistantId,
                buildBackgroundSwipePatch({
                  swipes: session.swipes,
                  swipeIndex: session.newSwipeIndex,
                  content: "",
                  swipeDates: session.swipeDates,
                  ...(metadata ? { metadata } : {}),
                }),
              );
            }
            session.markSlotCreated();
            this.updateActiveRunState(userId, activeRunId, {
              messageId: session.targetAssistantId,
              swipeId: session.newSwipeIndex,
              backgroundSwipe,
            });
          };
        }

        const dryRunCapture = await this.runDryRunWithCapture(chatId, dryRunInput, userId);
        const dryRunResult = dryRunCapture.result;
        const capturedMessages = dryRunCapture.capturedMessages;

        if (controller.signal.aborted) {
          wasAborted = true;
          if (regeneratedSnapshot) {
            await this.restoreTrailingAssistant(
              chatId,
              regeneratedSnapshot,
              undefined,
              userId,
            );
          }
          return {
            runId,
            actionId: input.actionId,
            chatId,
            aborted: true,
            text: "",
          };
        }

        if (pendingBlankSlotCreate) {
          await createBlankAssistantSlot();
        } else if (pendingSwipeSlotWrite) {
          await pendingSwipeSlotWrite();
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
          resolvedPresetId,
          presetStreaming: presetContext.presetStreaming,
          dryRunResult,
          capturedMessages,
          signal: controller.signal,
          createdMessageId,
          targetAssistantId,
          skipBlankAssistantStrip: pendingBlankSlotCreate,
          targetSwipeIsBlank,
        });

        let result: ActionRunResult;
        switch (input.actionId) {
          case "guided_response":
          case "guided_regenerate":
            handoffToAssistantExecution = true;
            result = await this.executeAssistantResponse(
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
            break;
          case "guided_continue":
            result = await this.executeGuidedContinue(
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
            break;
          case "guided_swipe":
            handoffToAssistantExecution = true;
            result = await this.executeGuidedSwipe(
              runId,
              chatId,
              swipeSession!,
              rawInput,
              controller.signal,
              transformResponseOutput,
              userId,
              metricsPreset,
            );
            break;
          case "guided_impersonate":
            result = await this.executeImpersonate(
              runId,
              chatId,
              rawInput,
              controller.signal,
              userId,
              transformImpersonateOutput,
            );
            break;
          default: {
            const exhaustive: never = input.actionId;
            throw new Error(`Unsupported Guided Generations action: ${String(exhaustive)}`);
          }
        }
        wasAborted = result.aborted;
        return result;
      } catch (error) {
        if (!handoffToAssistantExecution) {
          if (regeneratedSnapshot) {
            await this.restoreTrailingAssistant(
              chatId,
              regeneratedSnapshot,
              createdMessageId,
              userId,
            );
          } else if (input.actionId === "guided_response" && createdMessageId) {
            await this.spindle.chat.deleteMessage(chatId, createdMessageId).catch(() => undefined);
          } else if (input.actionId === "guided_swipe" && swipeSession) {
            await this.rollbackUnstartedSwipeSlot(chatId, swipeSession);
          }
        }
        throw error;
      } finally {
        swipeSession?.dispose();
      }
    } catch (error) {
      if (runId) {
        this.deleteActiveRun(key, runId);
      }
      if (emitErrorStatus) {
        const message = error instanceof Error ? error.message : String(error);
        const errorChatId = resolvedChatId ?? requestedChatId ?? undefined;
        this.emitFrontend(
          {
            type: "gg:status",
            error: message,
            run: this.getActiveRun(userId),
            ...(errorChatId ? { chatId: errorChatId } : {}),
          },
          userId,
        );
      }
      throw error;
    } finally {
      this.removePendingRun(key, pendingEntry);
      if (runId && this.deleteActiveRun(key, runId)) {
        if (controller.signal.aborted) {
          wasAborted = true;
        }
        this.emitFrontend(
          {
            type: "gg:status",
            run: this.getActiveRun(userId),
            ...(resolvedChatId ? { chatId: resolvedChatId } : {}),
            done: !wasAborted,
            aborted: wasAborted,
          },
          userId,
        );
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
    const requestedChatId =
      typeof input.chatId === "string" && input.chatId.trim().length > 0
        ? input.chatId.trim()
        : null;
    if (this.isChatBusy(key, requestedChatId)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before removing a continue.",
      );
    }

    const pendingEntry: PendingRun = {
      ...(requestedChatId ? { chatId: requestedChatId } : {}),
    };
    this.addPendingRun(key, pendingEntry);
    try {
      const { chatId } = await this.resolveChatContext(requestedChatId, userId);
      pendingEntry.chatId = chatId;
      if (this.isChatBusy(key, chatId, pendingEntry)) {
        throw new Error(
          "A Guided Generations action is already running. Stop it before removing a continue.",
        );
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
      this.removePendingRun(key, pendingEntry);
    }
  }

  async regenerateLastContinue(
    input: RegenerateContinueInput = {},
    userId?: string,
  ): Promise<ActionRunResult> {
    const key = this.userKey(userId);
    const requestedChatId =
      typeof input.chatId === "string" && input.chatId.trim().length > 0
        ? input.chatId.trim()
        : null;
    if (this.isChatBusy(key, requestedChatId)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before starting another.",
      );
    }

    this.assertRequiredPermissions("guided_continue");
    const controller = new AbortController();
    const pendingEntry: PendingRun = {
      controller,
      ...(requestedChatId ? { chatId: requestedChatId } : {}),
    };
    this.addPendingRun(key, pendingEntry);

    let runId: string | undefined;
    let resolvedChatId: string | undefined;
    let wasAborted = false;
    let emitErrorStatus = true;

    try {
      const settings = await this.store.getSettings(userId);
      const config = settings.actions.guided_continue;
      if (!config.enabled) {
        throw new Error("Guided Generations action 'guided_continue' is disabled in Settings.");
      }

      const { chatId, characterId, characterName, avatarUrl } = await this.resolveChatContext(
        requestedChatId,
        userId,
      );
      resolvedChatId = chatId;
      pendingEntry.chatId = chatId;
      if (this.isChatBusy(key, chatId, pendingEntry)) {
        emitErrorStatus = false;
        throw new Error(
          "A Guided Generations action is already running. Stop it before starting another.",
        );
      }
      if (controller.signal.aborted) {
        wasAborted = true;
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
        wasAborted = true;
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

      this.setActiveRun(key, {
        state: {
          runId: activeRunId,
          actionId: "guided_continue",
          chatId,
          startedAt: Date.now(),
          ...(characterId ? { characterId } : {}),
          ...(characterName ? { characterName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        controller,
      });
      this.removePendingRun(key, pendingEntry);
      this.emitStatus(userId, activeRunId);
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
        wasAborted = true;
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
      let didCommitHistory = false;
      try {
        const dryRunInput = buildDryRunInput({
          chatId,
          actionId: "guided_continue",
          config,
          activeConnectionId: connectionId,
        });
        const dryRunCapture = await this.runDryRunWithCapture(chatId, dryRunInput, userId);

        if (controller.signal.aborted) {
          wasAborted = true;
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
          resolvedPresetId,
          presetStreaming: presetContext.presetStreaming,
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
            didCommitHistory = true;
          },
          () => {
            this.updateActiveRunState(userId, activeRunId, { hasContentOutput: true });
          },
        );

        if (!streamRes.hasOutput) {
          wasAborted = streamRes.aborted;
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
        didCommitHistory = true;

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

        wasAborted = streamRes.aborted;
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
        if (!hadStreamOutput || !didCommitHistory) {
          await this.restorePreRegenMessage(chatId, preRegen);
        }
        throw error;
      }
    } catch (error) {
      if (runId) {
        this.deleteActiveRun(key, runId);
      }
      if (emitErrorStatus) {
        const message = error instanceof Error ? error.message : String(error);
        const errorChatId = resolvedChatId ?? requestedChatId ?? undefined;
        this.emitFrontend(
          {
            type: "gg:status",
            error: message,
            run: this.getActiveRun(userId),
            ...(errorChatId ? { chatId: errorChatId } : {}),
          },
          userId,
        );
      }
      throw error;
    } finally {
      this.removePendingRun(key, pendingEntry);
      if (runId && this.deleteActiveRun(key, runId)) {
        if (controller.signal.aborted) {
          wasAborted = true;
        }
        this.emitFrontend(
          {
            type: "gg:status",
            run: this.getActiveRun(userId),
            ...(resolvedChatId ? { chatId: resolvedChatId } : {}),
            done: !wasAborted,
            aborted: wasAborted,
          },
          userId,
        );
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
    resolvedPresetId?: string | null;
    presetStreaming?: boolean;
    dryRunResult: DryRunResultWithRequestMessages;
    capturedMessages?: AssembledLlmMessageDTO[];
    signal: AbortSignal;
    createdMessageId?: string;
    targetAssistantId?: string | null;
    skipBlankAssistantStrip?: boolean;
    targetSwipeIsBlank?: boolean;
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
      resolvedPresetId,
      presetStreaming,
      dryRunResult,
      capturedMessages,
      signal,
      createdMessageId,
      targetAssistantId,
      skipBlankAssistantStrip,
      targetSwipeIsBlank,
    } = args;

    const { model, provider } = resolveEffectiveModelAndProvider({
      configuredModel: config.model,
      connectionModel: resolvedConnection?.model,
      connectionProvider: resolvedConnection?.provider,
      dryRunModel: dryRunResult.model,
      dryRunProvider: dryRunResult.provider,
    });

    const {
      messages: rawAssembled,
      reapplyRoleMerge,
      applyEmptyFilter,
      collapseToSingleRole,
    } = this.mergeDryRunAndCapturedMessages(dryRunResult, capturedMessages);
    let isChatHistory = resolveChatHistoryFlags(rawAssembled, {
      breakdown: dryRunResult.breakdown,
    });

    if (!isChatHistory) {
      const effectivePresetId =
        config.presetId ?? resolvedPresetId ?? resolvedConnection?.preset_id ?? null;
      const presetBlocks = await this.fetchPresetBlocksFallback(effectivePresetId, userId);
      if (presetBlocks && presetBlocks.length > 0) {
        isChatHistory = resolveChatHistoryFlags(rawAssembled, {
          breakdown: dryRunResult.breakdown,
          presetBlocks,
        });
      }
    }

    let assembledMessages = rawAssembled;
    if (
      !skipBlankAssistantStrip &&
      (actionId === "guided_response" || actionId === "guided_regenerate")
    ) {
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
        ...(targetSwipeIsBlank ? [{ requireBlankFallback: true }] : []),
      );
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    }

    if (applyEmptyFilter) {
      const keptMessages: AssembledLlmMessageDTO[] = [];
      const hasAlignedFlags =
        Array.isArray(isChatHistory) && isChatHistory.length === assembledMessages.length;
      const keptFlags: boolean[] | undefined = hasAlignedFlags ? [] : undefined;
      for (let i = 0; i < assembledMessages.length; i += 1) {
        const msg = assembledMessages[i]!;
        if (hasNonEmptyLlmContent(msg)) {
          keptMessages.push(msg);
          if (keptFlags) {
            keptFlags.push(Boolean(isChatHistory![i]));
          }
        }
      }
      assembledMessages = keptMessages;
      if (keptFlags) {
        isChatHistory = keptFlags;
      }
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
    const postProcessedMessages = reapplyRoleMerge
      ? mergeConsecutiveSameRoleMessages(injectedMessages)
      : injectedMessages;
    const filteredMessages = applyEmptyFilter
      ? postProcessedMessages.filter(hasNonEmptyLlmContent)
      : postProcessedMessages;
    const collapsedMessages = collapseToSingleRole
      ? collapseMessagesToSingleRole(filteredMessages, collapseToSingleRole)
      : filteredMessages;
    const messages = stripInternalMessageMarkers(collapsedMessages);

    const transformResponseOutput: OutputTransformer | undefined = config.applyRegex
      ? async ({ deltaText, reasoningText, baseText }) => {
          if (baseText) {
            const regexedDelta = await applyRegexScripts(
              deltaText,
              responseScripts,
              "ai_output",
              0,
              { resolveMacros },
            );
            const healedFinal = healFormattingArtifacts(
              stitchContinueContent(baseText, regexedDelta),
            );
            const processedReasoning =
              reasoningText.length > 0
                ? await applyRegexScripts(reasoningText, responseScripts, "reasoning", 0, {
                    resolveMacros,
                  })
                : reasoningText;
            return {
              deltaText: regexedDelta,
              reasoningText: processedReasoning,
              finalText: healedFinal,
            };
          }

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

    const rawParams = dryRunResult.parameters;
    const parameters =
      presetStreaming === false && rawParams?._streaming === undefined
        ? { ...(rawParams ?? {}), _streaming: false }
        : rawParams;

    const rawInput: GenerationRequestWithSignal = {
      type: "raw",
      messages,
      parameters,
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
  ): Promise<{
    chatId: string;
    characterId?: string;
    characterName?: string;
    avatarUrl?: string;
  }> {
    let chat: { id: string; character_id?: string | null } | null = null;
    if (requestedChatId) {
      chat = await this.spindle.chats.get(requestedChatId, userId);
      if (!chat) {
        throw new Error("The requested chat is no longer available.");
      }
    } else {
      chat = await this.spindle.chats.getActive(userId);
      if (!chat) {
        throw new Error("Open a chat before running a Guided Generations action.");
      }
    }

    const characterId =
      typeof chat.character_id === "string" && chat.character_id
        ? chat.character_id
        : undefined;
    let characterName: string | undefined;
    const avatarUrl = characterId
      ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?thumb=1`
      : undefined;

    if (characterId && this.spindle.permissions?.has?.("characters")) {
      const charactersApi = this.spindle.characters;
      if (typeof charactersApi?.get === "function") {
        try {
          const character = await charactersApi.get(characterId, userId);
          if (typeof character?.name === "string" && character.name.trim().length > 0) {
            characterName = character.name.trim();
          }
        } catch {
          // Best-effort character lookup; ignore if permission or API is unavailable.
        }
      }
    }

    return {
      chatId: chat.id,
      ...(characterId ? { characterId } : {}),
      ...(characterName ? { characterName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }

  private mergeDryRunAndCapturedMessages(
    dryRunResult: DryRunResultWithRequestMessages,
    capturedMessages?: AssembledLlmMessageDTO[],
  ): {
    messages: AssembledLlmMessageDTO[];
    reapplyRoleMerge: boolean;
    applyEmptyFilter: boolean;
    collapseToSingleRole?: "system" | "user";
  } {
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
        const copyFlagsFromCapture = (
          msg: AssembledLlmMessageDTO,
          cap: AssembledLlmMessageDTO,
        ): AssembledLlmMessageDTO => ({
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
        });

        if (capturedMessages.length === requestMessages.length) {
          return {
            messages: requestMessages.map((msg, idx) =>
              copyFlagsFromCapture(msg, capturedMessages[idx]!),
            ),
            reapplyRoleMerge: false,
            applyEmptyFilter: false,
          };
        }

        // Reconcile capturedMessages against request_messages when Lumiverse's
        // hasNonEmptyContent filter pruned empty turns (such as assistant(""))
        // after interceptor capture, without merging consecutive roles.
        const filteredIndices: number[] = [];
        for (let i = 0; i < capturedMessages.length; i += 1) {
          if (hasNonEmptyLlmContent(capturedMessages[i]!)) {
            filteredIndices.push(i);
          }
        }
        const matchesFilteredCapture =
          filteredIndices.length === requestMessages.length &&
          filteredIndices.every(
            (capIdx, reqIdx) =>
              capturedMessages[capIdx]!.role === requestMessages[reqIdx]!.role,
          );
        if (matchesFilteredCapture) {
          const reqIdxByCapIdx = new Map<number, number>();
          filteredIndices.forEach((capIdx, reqIdx) => {
            reqIdxByCapIdx.set(capIdx, reqIdx);
          });
          const reconstructed = capturedMessages.map((cap, capIdx) => {
            const reqIdx = reqIdxByCapIdx.get(capIdx);
            if (reqIdx === undefined) {
              return { ...cap };
            }
            const req = requestMessages[reqIdx]!;
            return copyFlagsFromCapture(
              {
                ...cap,
                role: req.role,
                content: req.content,
                ...(req.name !== undefined ? { name: req.name } : {}),
                ...(req.partial !== undefined ? { partial: req.partial } : {}),
              },
              cap,
            );
          });
          return {
            messages: reconstructed,
            reapplyRoleMerge: false,
            applyEmptyFilter: true,
          };
        }

        const mergedFilteredCapture = mergeConsecutiveSameRoleMessages(capturedMessages).filter(
          hasNonEmptyLlmContent,
        );
        const didMergeConsecutiveRoles =
          capturedMessages.length > requestMessages.length &&
          mergedFilteredCapture.length === requestMessages.length &&
          mergedFilteredCapture.every((msg, idx) => msg.role === requestMessages[idx]?.role);
        if (didMergeConsecutiveRoles) {
          return {
            messages: capturedMessages,
            reapplyRoleMerge: true,
            applyEmptyFilter: true,
          };
        }

        const singleCollapsedRole =
          requestMessages.length === 1 &&
          capturedMessages.length > 1 &&
          !reqHasMetadata &&
          (requestMessages[0]?.role === "system" || requestMessages[0]?.role === "user")
            ? (requestMessages[0]!.role as "system" | "user")
            : undefined;
        if (singleCollapsedRole) {
          return {
            messages: capturedMessages,
            reapplyRoleMerge: false,
            applyEmptyFilter: true,
            collapseToSingleRole: singleCollapsedRole,
          };
        }
        if (!reqHasMetadata) {
          return {
            messages: capturedMessages,
            reapplyRoleMerge: false,
            applyEmptyFilter: true,
          };
        }
      }
      return {
        messages: requestMessages,
        reapplyRoleMerge: false,
        applyEmptyFilter: false,
      };
    }

    if (capturedMessages && capturedMessages.length > 0) {
      return {
        messages: capturedMessages,
        reapplyRoleMerge: false,
        applyEmptyFilter: false,
      };
    }

    return {
      messages: dryRunResult.messages,
      reapplyRoleMerge: false,
      applyEmptyFilter: false,
    };
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
    preverifiedPreset?: { id: string; name?: string; parameters?: Record<string, unknown> } | null,
  ): Promise<{ presetId: string | null; presetName?: string; presetStreaming?: boolean }> {
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
        const presetStreaming = extractPresetStreamingOverride(preverifiedPreset);
        return {
          presetId: trimmedConfigured,
          ...(name ? { presetName: name } : {}),
          ...(presetStreaming !== undefined ? { presetStreaming } : {}),
        };
      }
      if (typeof this.spindle.presets?.get === "function") {
        try {
          const preset = await this.spindle.presets.get(trimmedConfigured, userId);
          if (!preset) return { presetId: null };
          const name =
            typeof preset.name === "string" && preset.name.trim()
              ? preset.name.trim()
              : undefined;
          const presetStreaming = extractPresetStreamingOverride(preset);
          return {
            presetId: trimmedConfigured,
            ...(name ? { presetName: name } : {}),
            ...(presetStreaming !== undefined ? { presetStreaming } : {}),
          };
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
    sessionUserId?: string,
    callbacks?: {
      onTargetSwipeIndexChanged?: (swipeId: number) => void;
      onTargetDeleted?: () => void;
    },
  ): GuidedSwipeSession {
    const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(targetMessage);
    let initialSwipeId = activeIndex;
    let targetSwipeIndex = swipes.length;
    let targetDeleted = false;
    let slotCreated = false;
    let slotSwipes = [...swipes, ""];
    let slotSwipeDates = [...swipeDates, Math.floor(Date.now() / 1000)];
    let initialExtra = targetMessage.extra ? this.cloneRecord(targetMessage.extra) : {};
    let initialMetadata = targetMessage.metadata
      ? this.cloneRecord(targetMessage.metadata)
      : undefined;
    let currentViewedSwipeId = activeIndex;
    let swipeEventSeq = 0;
    let finalizing = false;
    let triggerFlush: (() => void) | null = null;

    const swipeDisposer = this.spindle.on?.("MESSAGE_SWIPED", (payload, eventUserId) => {
      if (sessionUserId && eventUserId && eventUserId !== sessionUserId) {
        return;
      }
      const event = payload as MessageSwipedPayloadDTO | undefined;
      if (!event || event.chatId !== chatId || event.message?.id !== targetMessage.id) {
        return;
      }

      if (event.action === "deleted" && typeof event.swipeId === "number" && Number.isFinite(event.swipeId)) {
        const deletedIdx = Math.floor(event.swipeId);
        if (deletedIdx < initialSwipeId) {
          initialSwipeId = Math.max(0, initialSwipeId - 1);
        }
        if (deletedIdx < targetSwipeIndex) {
          if (slotCreated && deletedIdx >= 0 && deletedIdx < slotSwipes.length) {
            slotSwipes.splice(deletedIdx, 1);
            slotSwipeDates.splice(deletedIdx, 1);
          }
          targetSwipeIndex = Math.max(0, targetSwipeIndex - 1);
          if (slotCreated) {
            callbacks?.onTargetSwipeIndexChanged?.(targetSwipeIndex);
          }
        } else if (slotCreated && deletedIdx === targetSwipeIndex) {
          targetDeleted = true;
          callbacks?.onTargetDeleted?.();
        }
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
        !targetDeleted &&
        nextSwipeId === targetSwipeIndex &&
        previousViewed !== targetSwipeIndex
      ) {
        triggerFlush?.();
      }
    });

    const swipeEditedDisposer = this.spindle.on?.("SWIPE_EDITED", (payload, eventUserId) => {
      if (sessionUserId && eventUserId && eventUserId !== sessionUserId) {
        return;
      }
      const event = payload as SwipeEditedPayloadDTO | undefined;
      if (!event || event.chatId !== chatId || event.message?.id !== targetMessage.id) {
        return;
      }
      if (typeof event.message?.swipe_id === "number" && Number.isFinite(event.message.swipe_id)) {
        swipeEventSeq += 1;
        currentViewedSwipeId = Math.floor(event.message.swipe_id);
      }
    });

    return {
      targetAssistantId: targetMessage.id,
      get initialSwipeId() {
        return initialSwipeId;
      },
      get newSwipeIndex() {
        return targetSwipeIndex;
      },
      get swipes() {
        return slotSwipes;
      },
      get swipeDates() {
        return slotSwipeDates;
      },
      get initialExtra() {
        return initialExtra;
      },
      get initialMetadata() {
        return initialMetadata;
      },
      getTargetSwipeIndex: () => targetSwipeIndex,
      isTargetDeleted: () => targetDeleted,
      getCurrentViewedSwipeId: () => currentViewedSwipeId,
      setCurrentViewedSwipeId: (id: number) => {
        currentViewedSwipeId = id;
      },
      getSwipeEventSeq: () => swipeEventSeq,
      syncFromLatestMessage: (latest: ChatMessageWithRole) => {
        const latestNorm = normalizeMessageSwipes(latest);
        const hadEvents = swipeEventSeq > 0;
        initialSwipeId = latestNorm.activeIndex;
        if (!hadEvents) {
          currentViewedSwipeId = latestNorm.activeIndex;
        }
        targetSwipeIndex = latestNorm.swipes.length;
        slotSwipes = [...latestNorm.swipes, ""];
        slotSwipeDates = [...latestNorm.swipeDates, Math.floor(Date.now() / 1000)];
        initialExtra = latest.extra ? this.cloneRecord(latest.extra) : {};
        initialMetadata = latest.metadata ? this.cloneRecord(latest.metadata) : undefined;
      },
      markSlotCreated: () => {
        slotCreated = true;
      },
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
        if (typeof swipeEditedDisposer === "function") {
          swipeEditedDisposer();
        }
      },
    };
  }

  private async rollbackUnstartedSwipeSlot(
    chatId: string,
    swipeSession: GuidedSwipeSession,
  ): Promise<void> {
    if (swipeSession.isTargetDeleted()) return;
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      const current = messages.find((m) => m.id === swipeSession.targetAssistantId);
      if (!current) return;
      const normalized = normalizeMessageSwipes(current);
      const targetIdx = swipeSession.getTargetSwipeIndex();
      if (targetIdx < 0 || targetIdx >= normalized.swipes.length) return;
      if ((normalized.swipes[targetIdx] ?? "") !== "") return;

      const nextSwipes = [
        ...normalized.swipes.slice(0, targetIdx),
        ...normalized.swipes.slice(targetIdx + 1),
      ];
      if (nextSwipes.length === 0) return;
      const nextDates = [
        ...normalized.swipeDates.slice(0, targetIdx),
        ...normalized.swipeDates.slice(targetIdx + 1),
      ];
      const restoredSwipeId = Math.max(
        0,
        Math.min(swipeSession.initialSwipeId, nextSwipes.length - 1),
      );
      await this.spindle.chat.updateMessage(chatId, swipeSession.targetAssistantId, {
        content: nextSwipes[restoredSwipeId] ?? "",
        swipes: nextSwipes,
        swipe_id: restoredSwipeId,
        swipe_dates: nextDates,
        metadata: swipeSession.initialMetadata ?? {},
        skipChunkRebuild: true,
      });
    } catch {
      // Best-effort rollback of unstarted swipe slot.
    }
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
      const validDuration =
        typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration >= 0
          ? rawDuration
          : undefined;
      const hasReasoning =
        typeof rawReasoning === "string" || validDuration !== undefined;

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
        const patch = {
          content: snapshot.content ?? swipes[activeIndex] ?? "",
          swipes,
          swipe_id: activeIndex,
          swipe_dates: swipeDates,
          ...(swipeReasoning
            ? { swipe_reasoning: swipeReasoning }
            : hasReasoning
              ? {
                  reasoning: {
                    ...(typeof rawReasoning === "string" ? { text: rawReasoning } : {}),
                    ...(validDuration !== undefined ? { duration: validDuration } : {}),
                  },
                }
              : {}),
        } as Parameters<SpindleAPI["chat"]["updateMessage"]>[2];
        await this.spindle.chat.updateMessage(chatId, restored.id, patch);
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
          metadata: preRegen.metadata ?? {},
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
          swipeIndex: swipeSession.getTargetSwipeIndex(),
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
        if (swipeSession.isTargetDeleted()) {
          return current;
        }
        const nextCurrent: StreamTargetState = {
          ...current,
          swipeIndex: swipeSession.getTargetSwipeIndex(),
        };
        const seqBeforeRead = swipeSession.getSwipeEventSeq();
        const refreshed = await this.refreshSwipeTarget(
          chatId,
          nextCurrent,
          () => swipeSession.isTargetDeleted(),
        );
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
          !swipeSession.isTargetDeleted() &&
          swipeSession.getCurrentViewedSwipeId() === swipeSession.getTargetSwipeIndex(),
        isTargetDeleted: () => swipeSession.isTargetDeleted(),
        getTargetSwipeState: () => ({
          swipeIndex: swipeSession.getTargetSwipeIndex(),
          swipes: swipeSession.swipes,
          swipeDates: swipeSession.swipeDates,
        }),
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
    const { wasStreaming, outboundInput } = prepareOutboundGenerationInput(rawInput);

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
        if (wasStreaming) {
          for await (const chunk of this.spindle.generate.rawStream(outboundInput)) {
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
        } else {
          const rawResponse = await this.spindle.generate.raw(outboundInput);
          if (signal.aborted) {
            aborted = true;
          } else {
            const response = asGenerationResponse(rawResponse);
            if (typeof response.content === "string") {
              generated = response.content;
            }
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
    let finalOverrideText: string | null = null;
    let forceReasoningPatch = false;
    let reasoningStartedAt: number | undefined;
    let reasoningEndedAt: number | undefined;
    let aborted = false;
    let lastFlushAt = 0;
    let flushChain: Promise<void> = Promise.resolve();
    let lastFlushError: unknown = null;
    let target: StreamTargetState | null = null;
    let notifiedFirstOutput = false;
    let notifiedFirstContent = false;

    const buildMergedContent = (baseText: string) =>
      finalOverrideText !== null
        ? finalOverrideText
        : baseText
          ? stitchContinueContent(baseText, deltaText)
          : deltaText;

    const getReasoningDurationPatch = (
      baseText: string,
      includeReasoning: boolean,
    ): { reasoningDuration?: number | null } => {
      if (!includeReasoning) {
        return {};
      }
      if (reasoningText.length === 0) {
        return baseText.length > 0 || forceReasoningPatch
          ? { reasoningDuration: null }
          : {};
      }
      if (reasoningStartedAt !== undefined && reasoningEndedAt !== undefined) {
        return { reasoningDuration: Math.max(0, reasoningEndedAt - reasoningStartedAt) };
      }
      return baseText.length > 0 ? { reasoningDuration: null } : {};
    };

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
      if (swipeOptions?.isTargetDeleted?.()) {
        return;
      }
      const liveSwipeState = swipeOptions?.getTargetSwipeState?.();
      const effectiveSnapshot = liveSwipeState
        ? {
            ...targetSnapshot,
            swipeIndex: liveSwipeState.swipeIndex,
            swipes: liveSwipeState.swipes,
            swipeDates: liveSwipeState.swipeDates,
          }
        : targetSnapshot;
      const mergedContent = buildMergedContent(effectiveSnapshot.baseText);
      const includeReasoning = Boolean(reasoningText || forceReasoningPatch);
      const patch = buildActiveSwipePatch({
        swipes: effectiveSnapshot.swipes,
        swipeIndex: effectiveSnapshot.swipeIndex,
        content: mergedContent,
        swipeDates: effectiveSnapshot.swipeDates,
        ...(includeReasoning
          ? {
              reasoningText,
              ...getReasoningDurationPatch(effectiveSnapshot.baseText, includeReasoning),
            }
          : {}),
        ...(options.skipChunkRebuild !== undefined
          ? { skipChunkRebuild: options.skipChunkRebuild }
          : {}),
      });

      flushChain = flushChain
        .catch(() => undefined)
        .then(async () => {
          if (swipeOptions?.isTargetDeleted?.()) {
            return;
          }
          if (
            options.checkStillViewingMidstream &&
            swipeOptions &&
            !swipeOptions.isViewingTargetSwipe()
          ) {
            return;
          }
          await runUpdatePatch(effectiveSnapshot.messageId, patch, swallowError);
        });
    };

    const enqueueFinalFlush = (
      targetSnapshot: StreamTargetState,
      swallowError: boolean,
    ) => {
      if (swipeOptions?.isTargetDeleted?.()) {
        return;
      }
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
          if (swipeOptions.isTargetDeleted?.()) {
            return;
          }
          const isViewingTarget = swipeOptions.isViewingTargetSwipe();
          if (isViewingTarget) {
            const includeActiveReasoning = Boolean(capturedReasoning || capturedForceReasoning);
            const patch = buildActiveSwipePatch({
              swipes: targetSnapshot.swipes,
              swipeIndex: targetSnapshot.swipeIndex,
              content: capturedDelta,
              swipeDates: targetSnapshot.swipeDates,
              ...(includeActiveReasoning
                ? {
                    reasoningText: capturedReasoning,
                    ...getReasoningDurationPatch(targetSnapshot.baseText, includeActiveReasoning),
                  }
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
          const durationPatch = getReasoningDurationPatch(
            targetSnapshot.baseText,
            includeReasoning,
          );
          const bgReasoningDuration =
            typeof durationPatch.reasoningDuration === "number" &&
            durationPatch.reasoningDuration > 0
              ? durationPatch.reasoningDuration
              : undefined;

          const patch = buildBackgroundSwipePatch({
            swipes: targetSnapshot.swipes,
            swipeIndex: targetSnapshot.swipeIndex,
            content: capturedDelta,
            swipeDates: targetSnapshot.swipeDates,
            ...(includeReasoning
              ? {
                  reasoningText: capturedReasoning,
                  ...(bgReasoningDuration !== undefined
                    ? { reasoningDuration: bgReasoningDuration }
                    : {}),
                  clearReasoningSlot: capturedForceReasoning && capturedReasoning.length === 0,
                  existingExtra: targetSnapshot.latestExtra,
                  existingActiveSwipeId: targetSnapshot.latestSwipeId,
                }
              : {}),
          }) as unknown as Parameters<SpindleAPI["chat"]["updateMessage"]>[2];
          await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
        });
    };

    const maybeFlush = (force: boolean) => {
      if (!target) return;
      if (swipeOptions?.isTargetDeleted?.()) return;
      if (swipeOptions && !swipeOptions.isViewingTargetSwipe()) return;
      const liveSwipeState = swipeOptions?.getTargetSwipeState?.();
      if (liveSwipeState) {
        target = {
          ...target,
          swipeIndex: liveSwipeState.swipeIndex,
          swipes: liveSwipeState.swipes,
          swipeDates: liveSwipeState.swipeDates,
        };
      }
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
      if (!target) {
        target = await ensureTarget();
      }
      if (!notifiedFirstOutput) {
        notifiedFirstOutput = true;
        onFirstOutput?.();
      }
      if (!notifiedFirstContent && deltaText.length > 0) {
        notifiedFirstContent = true;
        onFirstContent?.();
      }
    };

    const { wasStreaming, outboundInput } = prepareOutboundGenerationInput(rawInput);
    let streamingStartedAt = Date.now();
    let firstTokenAt: number | undefined;
    let firstContentTokenAt: number | undefined;
    let lastProviderContentAt: number | undefined;
    let responseStoppedAt: number | undefined;
    let completedAt: number | undefined;
    let streamUsage: GenerationUsageInput | undefined;

    try {
      if (wasStreaming) {
        const stream = this.spindle.generate.rawStream(outboundInput);
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
            if (reasoningStartedAt === undefined) {
              reasoningStartedAt = receivedAt;
            }
            reasoningEndedAt = receivedAt;
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
      } else if (signal.aborted) {
        aborted = true;
      } else {
        streamingStartedAt = Date.now();
        const rawResponse = await this.spindle.generate.raw(outboundInput);
        if (signal.aborted) {
          aborted = true;
        } else {
          const response = asGenerationResponse(rawResponse);
          if (typeof response.content === "string" && response.content.length > 0) {
            deltaText = response.content;
          }
          if (typeof response.reasoning === "string" && response.reasoning.length > 0) {
            reasoningText = response.reasoning;
          }
          if (
            response.usage &&
            typeof response.usage === "object" &&
            !Array.isArray(response.usage)
          ) {
            streamUsage = response.usage as GenerationUsageInput;
          }
          await ensureInitializedOnOutput();
          responseStoppedAt = Date.now();
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        aborted = true;
      } else {
        swipeOptions?.onFinalizing?.();
        if (
          target &&
          !swipeOptions?.isTargetDeleted?.() &&
          (deltaText.length > 0 || reasoningText.length > 0)
        ) {
          await flushChain.catch(() => undefined);
          if (refreshTarget && !swipeOptions?.isTargetDeleted?.()) {
            target = await refreshTarget(target).catch(() => target!);
          }
          if (!swipeOptions?.isTargetDeleted?.()) {
            enqueueFinalFlush(target, false);
          }
          await flushChain.catch(() => undefined);
          if (!lastFlushError && !swipeOptions?.isTargetDeleted?.() && onPartialErrorCommit) {
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
    let resolvedTarget = target as StreamTargetState | null;
    if (!hasOutput || !resolvedTarget || swipeOptions?.isTargetDeleted?.()) {
      await flushChain.catch(() => undefined);
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted: aborted || signal.aborted || Boolean(swipeOptions?.isTargetDeleted?.()),
        hasOutput: false,
      };
    }

    if (transformOutput) {
      const hadReasoning = reasoningText.length > 0;
      const transformed = await transformOutput({
        deltaText,
        reasoningText,
        ...(resolvedTarget.baseText ? { baseText: resolvedTarget.baseText } : {}),
      });
      deltaText = transformed.deltaText;
      reasoningText = transformed.reasoningText;
      if (typeof transformed.finalText === "string") {
        finalOverrideText = transformed.finalText;
      }
      if (hadReasoning && reasoningText.length === 0) {
        forceReasoningPatch = true;
      }
    }

    if (swipeOptions?.isTargetDeleted?.()) {
      await flushChain.catch(() => undefined);
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted: true,
        hasOutput: false,
      };
    }

    if (refreshTarget) {
      await flushChain;
      resolvedTarget = await refreshTarget(resolvedTarget);
      target = resolvedTarget;
    }

    if (swipeOptions?.isTargetDeleted?.()) {
      await flushChain.catch(() => undefined);
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted: true,
        hasOutput: false,
      };
    }

    enqueueFinalFlush(resolvedTarget, false);
    await flushChain;

    if (lastFlushError) {
      throw lastFlushError;
    }

    if (!aborted && !signal.aborted) {
      completedAt = Date.now();
    } else if (signal.aborted) {
      aborted = true;
    }

    const finalText = buildMergedContent(resolvedTarget.baseText);
    return {
      messageId: resolvedTarget.messageId,
      swipeId: resolvedTarget.swipeIndex,
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
    isTargetDeleted?: () => boolean,
  ): Promise<StreamTargetState> {
    if (isTargetDeleted?.()) {
      return current;
    }
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      if (isTargetDeleted?.()) {
        return current;
      }
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

  private emitStatus(userId?: string, runId?: string): void {
    const key = this.userKey(userId);
    const active = runId ? this.activeRuns.get(key)?.get(runId)?.state : undefined;
    const run = active ? { ...active } : this.getActiveRun(userId);
    this.emitFrontend(
      {
        type: "gg:status",
        run,
        ...(run?.chatId ? { chatId: run.chatId } : {}),
      },
      userId,
    );
  }
}
