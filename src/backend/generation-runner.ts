import type {
  ConnectionProfileDTO,
  GenerationRequestDTO,
  LlmMessageDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import {
  buildActiveSwipePatch,
  buildDryRunInput,
  type ChatMessageWithRole,
  type DryRunResultWithRequestMessages,
  findLastAssistantMessage,
  formatGuidanceText,
  injectGuidanceMessage,
  isAssistantMessage,
  normalizeMessageSwipes,
  resolveEffectiveModelAndProvider,
  stitchContinueContent,
  stripRejectedSwipeAssistantTurn,
} from "./prompt-builder";
import type { SettingsStore } from "./settings-store";
import type {
  ActionRunResult,
  ActiveRunState,
  BackendPushEvent,
  GuidedActionId,
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
}

interface StreamMessageResult {
  messageId?: string;
  swipeId?: number;
  finalText: string;
  aborted: boolean;
  hasOutput: boolean;
}

const STREAM_FLUSH_INTERVAL_MS = 90;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class GuidedGenerationRunner {
  private readonly activeRuns = new Map<string, InternalRun>();
  private readonly pendingUsers = new Set<string>();

  constructor(
    private readonly spindle: SpindleAPI,
    private readonly store: SettingsStore,
    private readonly emitFrontend: (event: BackendPushEvent, userId?: string) => void,
  ) {}

  private userKey(userId?: string): string {
    return userId && userId.length > 0 ? userId : "__default__";
  }

  getActiveRun(userId?: string): ActiveRunState | null {
    const run = this.activeRuns.get(this.userKey(userId));
    return run ? { ...run.state } : null;
  }

  abortCurrent(userId?: string, runId?: string): boolean {
    const run = this.activeRuns.get(this.userKey(userId));
    if (!run) return false;
    if (runId && run.state.runId !== runId) return false;
    run.controller.abort();
    return true;
  }

  async run(input: RunActionInput, userId?: string): Promise<ActionRunResult> {
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error(
        "A Guided Generations action is already running. Stop it before starting another.",
      );
    }

    this.assertRequiredPermissions(input.actionId);
    this.pendingUsers.add(key);

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

      const chatId = await this.resolveChatId(input.chatId, userId);
      runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const controller = new AbortController();

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

      if (
        input.actionId === "guided_regenerate" &&
        config.presetId &&
        this.spindle.permissions.has("presets")
      ) {
        const preset = await this.spindle.presets.get(config.presetId, userId);
        if (!preset) {
          throw new Error(
            "Selected preset for Guided Regenerate no longer exists. Choose another in Settings.",
          );
        }
      }

      let targetAssistantId: string | null = null;
      if (input.actionId === "guided_continue" || input.actionId === "guided_swipe") {
        const preTarget = await this.requireLastAssistantMessage(chatId);
        targetAssistantId = preTarget.id;
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
      if (input.actionId === "guided_regenerate") {
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
      }

      let dryRunResult: DryRunResultWithRequestMessages;
      try {
        dryRunResult = (await this.spindle.generate.dryRun(
          dryRunInput,
          userId,
        )) as DryRunResultWithRequestMessages;
      } catch (error) {
        if (regeneratedSnapshot) {
          await this.restoreTrailingAssistant(chatId, regeneratedSnapshot);
        }
        throw error;
      }

      if (controller.signal.aborted) {
        if (regeneratedSnapshot) {
          await this.restoreTrailingAssistant(chatId, regeneratedSnapshot);
        }
        return {
          runId,
          actionId: input.actionId,
          chatId,
          aborted: true,
          text: "",
        };
      }

      const { model, provider } = resolveEffectiveModelAndProvider({
        configuredModel: config.model,
        connectionModel: resolvedConnection?.model,
        connectionProvider: resolvedConnection?.provider,
        dryRunModel: dryRunResult.model,
        dryRunProvider: dryRunResult.provider,
      });

      const guidanceText = formatGuidanceText(config.instructionTemplate, input.inputText, {
        allowTemplateWithoutInput: input.actionId === "guided_impersonate",
      });

      const rawAssembled = dryRunResult.request_messages ?? dryRunResult.messages;
      const assembledMessages =
        input.actionId === "guided_swipe"
          ? stripRejectedSwipeAssistantTurn(rawAssembled, targetAssistantId)
          : rawAssembled;

      const messages: LlmMessageDTO[] = injectGuidanceMessage(
        assembledMessages,
        guidanceText,
        config.injectionRole,
        { actionId: input.actionId },
      );

      const rawInput: GenerationRequestWithSignal = {
        type: "raw",
        messages,
        parameters: dryRunResult.parameters,
        ...(connectionId ? { connection_id: connectionId } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(userId ? { userId } : {}),
        signal: controller.signal,
      };

      switch (input.actionId) {
        case "guided_response":
        case "guided_regenerate":
          return await this.executeAssistantResponse(
            input.actionId,
            runId,
            chatId,
            rawInput,
            controller.signal,
            regeneratedSnapshot,
          );
        case "guided_continue":
          return await this.executeGuidedContinue(
            runId,
            chatId,
            targetAssistantId!,
            rawInput,
            controller.signal,
          );
        case "guided_swipe":
          return await this.executeGuidedSwipe(
            runId,
            chatId,
            targetAssistantId!,
            rawInput,
            controller.signal,
          );
        case "guided_impersonate":
          return await this.executeImpersonate(
            runId,
            chatId,
            rawInput,
            controller.signal,
            userId,
          );
        default: {
          const exhaustive: never = input.actionId;
          throw new Error(`Unsupported Guided Generations action: ${String(exhaustive)}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitFrontend({ type: "gg:status", error: message, run: null }, userId);
      throw error;
    } finally {
      this.pendingUsers.delete(key);
      if (runId && this.activeRuns.get(key)?.state.runId === runId) {
        this.activeRuns.delete(key);
        this.emitStatus(userId);
      }
    }
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

  private async resolveChatId(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<string> {
    if (requestedChatId) {
      const chat = await this.spindle.chats.get(requestedChatId, userId);
      if (!chat) {
        throw new Error("The requested chat is no longer available.");
      }
      return chat.id;
    }
    const active = await this.spindle.chats.getActive(userId);
    if (!active) {
      throw new Error("Open a chat before running a Guided Generations action.");
    }
    return active.id;
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

  private cloneMessageSnapshot(message: ChatMessageWithRole): ChatMessageWithRole {
    return {
      ...message,
      swipes: Array.isArray(message.swipes) ? [...message.swipes] : [],
      swipe_dates: Array.isArray(message.swipe_dates) ? [...message.swipe_dates] : [],
      extra: message.extra ? { ...message.extra } : {},
      ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
    };
  }

  private async restoreTrailingAssistant(
    chatId: string,
    snapshot: ChatMessageWithRole,
  ): Promise<void> {
    try {
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
      const rawReasoning = snapshot.extra?.reasoning;
      const rawDuration = snapshot.extra?.reasoning_duration;
      const hasReasoning =
        typeof rawReasoning === "string" || typeof rawDuration === "number";

      if (hasMultipleSwipes || hasSwipeDates || hasReasoning) {
        const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(snapshot);
        await this.spindle.chat.updateMessage(chatId, restored.id, {
          content: snapshot.content ?? swipes[activeIndex] ?? "",
          swipes,
          swipe_id: activeIndex,
          swipe_dates: swipeDates,
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
    } catch (restoreError) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed restoring regenerated message: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
      );
    }
  }

  private async executeAssistantResponse(
    actionId: "guided_response" | "guided_regenerate",
    runId: string,
    chatId: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    regeneratedSnapshot: ChatMessageWithRole | null,
  ): Promise<ActionRunResult> {
    let createdMessageId: string | undefined;

    try {
      const streamRes = await this.streamIntoMessage(
        chatId,
        rawInput,
        signal,
        async () => {
          const created = await this.spindle.chat.appendMessage(
            chatId,
            { role: "assistant", content: "" },
            { triggerGeneration: false },
          );
          createdMessageId = created.id;
          return {
            messageId: created.id,
            swipes: [""],
            swipeIndex: 0,
            swipeDates: [Math.floor(Date.now() / 1000)],
            baseText: "",
          };
        },
      );

      if (!streamRes.hasOutput && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(chatId, regeneratedSnapshot);
      }

      return {
        runId,
        actionId,
        chatId,
        aborted: streamRes.aborted,
        ...(streamRes.messageId ? { messageId: streamRes.messageId, swipeId: 0 } : {}),
        text: streamRes.finalText,
      };
    } catch (error) {
      if (!createdMessageId && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(chatId, regeneratedSnapshot);
      }
      throw error;
    }
  }

  private async executeGuidedContinue(
    runId: string,
    chatId: string,
    targetId: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
  ): Promise<ActionRunResult> {
    const initial = await this.readTargetMessageOrThrow(chatId, targetId);
    const initialNormalized = normalizeMessageSwipes(initial);
    const initialBaseText =
      initialNormalized.swipes[initialNormalized.activeIndex] ?? initial.content ?? "";

    const streamRes = await this.streamIntoMessage(
      chatId,
      rawInput,
      signal,
      async () => {
        const latest = await this.readTargetMessageOrThrow(chatId, targetId);
        const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(latest);
        return {
          messageId: latest.id,
          swipes,
          swipeIndex: activeIndex,
          swipeDates,
          baseText: swipes[activeIndex] ?? latest.content ?? "",
        };
      },
      async (current) => this.refreshSwipeTarget(chatId, current),
    );

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
    targetId: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
  ): Promise<ActionRunResult> {
    const streamRes = await this.streamIntoMessage(
      chatId,
      rawInput,
      signal,
      async () => {
        const latest = await this.readTargetMessageOrThrow(chatId, targetId);
        const { swipes, swipeDates } = normalizeMessageSwipes(latest);
        const newSwipeIndex = swipes.length;
        return {
          messageId: latest.id,
          swipes: [...swipes, ""],
          swipeIndex: newSwipeIndex,
          swipeDates: [...swipeDates, Math.floor(Date.now() / 1000)],
          baseText: "",
        };
      },
      async (current) => this.refreshSwipeTarget(chatId, current),
    );

    return {
      runId,
      actionId: "guided_swipe",
      chatId,
      aborted: streamRes.aborted,
      messageId: streamRes.messageId ?? targetId,
      ...(streamRes.swipeId !== undefined ? { swipeId: streamRes.swipeId } : {}),
      text: streamRes.finalText,
    };
  }

  private async executeImpersonate(
    runId: string,
    chatId: string,
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
    userId?: string,
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
  ): Promise<StreamMessageResult> {
    let deltaText = "";
    let reasoningText = "";
    let aborted = false;
    let lastFlushAt = 0;
    let flushChain: Promise<void> = Promise.resolve();
    let lastFlushError: unknown = null;
    let target: StreamTargetState | null = null;

    const buildMergedContent = (baseText: string) =>
      baseText ? stitchContinueContent(baseText, deltaText) : deltaText;

    const enqueuePatchFlush = (
      targetSnapshot: StreamTargetState,
      swallowError: boolean,
    ) => {
      const mergedContent = buildMergedContent(targetSnapshot.baseText);
      const patch = buildActiveSwipePatch({
        swipes: targetSnapshot.swipes,
        swipeIndex: targetSnapshot.swipeIndex,
        content: mergedContent,
        swipeDates: targetSnapshot.swipeDates,
        ...(reasoningText ? { reasoningText } : {}),
      });

      flushChain = flushChain
        .catch(() => undefined)
        .then(async () => {
          try {
            await this.spindle.chat.updateMessage(
              chatId,
              targetSnapshot.messageId,
              patch,
            );
            lastFlushError = null;
          } catch (err) {
            if (!swallowError) {
              lastFlushError = err;
            }
          }
        });
    };

    const maybeFlush = (force: boolean) => {
      if (!target) return;
      const now = Date.now();
      if (!force && now - lastFlushAt < STREAM_FLUSH_INTERVAL_MS) return;
      lastFlushAt = now;
      enqueuePatchFlush(target, false);
    };

    const ensureInitializedOnOutput = async () => {
      if (target) return;
      if (deltaText.length === 0 && reasoningText.length === 0) return;
      target = await ensureTarget();
    };

    try {
      for await (const chunk of this.spindle.generate.rawStream(rawInput)) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        if (chunk.type === "token") {
          deltaText += chunk.token;
          await ensureInitializedOnOutput();
          maybeFlush(false);
        } else if (chunk.type === "reasoning") {
          reasoningText += chunk.token;
          await ensureInitializedOnOutput();
          maybeFlush(false);
        } else if (chunk.type === "done") {
          if (chunk.content) deltaText = chunk.content;
          if (chunk.reasoning) reasoningText = chunk.reasoning;
          await ensureInitializedOnOutput();
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        aborted = true;
      } else {
        if (target && (deltaText.length > 0 || reasoningText.length > 0)) {
          enqueuePatchFlush(target, true);
        }
        await flushChain.catch(() => undefined);
        throw error;
      }
    }

    const hasOutput = deltaText.length > 0 || reasoningText.length > 0;
    if (!hasOutput || !target) {
      await flushChain.catch(() => undefined);
      return {
        finalText: "",
        aborted,
        hasOutput: false,
      };
    }

    if (refreshTarget) {
      await flushChain;
      target = await refreshTarget(target);
    }

    enqueuePatchFlush(target, false);
    await flushChain;

    if (lastFlushError && !aborted) {
      throw lastFlushError;
    }

    const finalText = buildMergedContent(target.baseText);
    return {
      messageId: target.messageId,
      swipeId: target.swipeIndex,
      finalText,
      aborted,
      hasOutput: true,
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
      if (normalized.swipes.length > current.swipeIndex) {
        return {
          ...current,
          swipes: normalized.swipes,
          swipeDates: normalized.swipeDates,
        };
      }
      return current;
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
    const fallback = findLastAssistantMessage(messages);
    if (!fallback) {
      throw new Error("No assistant message found in this chat to continue or swipe.");
    }
    return fallback;
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
