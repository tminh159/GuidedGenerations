// @bun
// src/backend/prompt-builder.ts
function formatGuidanceText(template, rawInput, options = {}) {
  const input = rawInput.trim();
  const cleanTemplate = template.trim();
  if (!input) {
    if (options.allowTemplateWithoutInput && cleanTemplate && !cleanTemplate.includes("{{input}}")) {
      return cleanTemplate;
    }
    return null;
  }
  if (!cleanTemplate) {
    return input;
  }
  if (cleanTemplate.includes("{{input}}")) {
    return cleanTemplate.replaceAll("{{input}}", () => input).trim();
  }
  return `${cleanTemplate}
${input}`;
}
function injectGuidanceMessage(messages, guidanceText, role, options = {}) {
  const copy = messages.map((msg) => ({ ...msg }));
  if (!guidanceText || !guidanceText.trim()) {
    return copy;
  }
  const injected = {
    role,
    content: guidanceText.trim()
  };
  if (copy.length > 0 && copy[copy.length - 1]?.role === "assistant") {
    copy.splice(copy.length - 1, 0, injected);
    return copy;
  }
  if (options.actionId === "guided_continue" && copy.length > 0) {
    let idx = copy.length - 1;
    while (idx >= 0 && copy[idx]?.role === "system") {
      idx -= 1;
    }
    if (idx >= 0 && idx < copy.length - 1 && copy[idx]?.role === "assistant") {
      copy.splice(idx, 0, injected);
      return copy;
    }
  }
  copy.push(injected);
  return copy;
}
function stripRejectedSwipeAssistantTurn(messages, targetMessageId) {
  if (targetMessageId && messages.some((msg) => msg.sourceMessageId === targetMessageId)) {
    return messages.filter((msg) => msg.sourceMessageId !== targetMessageId).map((msg) => ({ ...msg }));
  }
  const copy = messages.map((msg) => ({ ...msg }));
  for (let i = copy.length - 1;i >= 0; i -= 1) {
    const msg = copy[i];
    if (!msg)
      continue;
    if (msg.role === "user") {
      break;
    }
    if (msg.role === "assistant") {
      copy.splice(i, 1);
      break;
    }
  }
  return copy;
}
function buildDryRunInput(args) {
  const generationTypeMap = {
    guided_response: "normal",
    guided_continue: "continue",
    guided_regenerate: "regenerate",
    guided_swipe: "swipe",
    guided_impersonate: "impersonate"
  };
  const connectionId = args.config.connectionId || args.activeConnectionId || undefined;
  const presetId = args.config.presetId || undefined;
  return {
    chatId: args.chatId,
    ...connectionId ? { connectionId } : {},
    ...presetId ? { presetId, forcePresetId: true } : {},
    generationType: generationTypeMap[args.actionId],
    includeRequestMessages: true
  };
}
function resolveEffectiveModelAndProvider(args) {
  const model = args.configuredModel?.trim() || args.connectionModel?.trim() || args.dryRunModel?.trim() || undefined;
  const provider = args.connectionProvider?.trim() || args.dryRunProvider?.trim() || undefined;
  return {
    ...model ? { model } : {},
    ...provider ? { provider } : {}
  };
}
function isAssistantMessage(msg) {
  if (!msg)
    return false;
  if (typeof msg.role === "string" && msg.role.length > 0) {
    return msg.role === "assistant";
  }
  return !msg.is_user;
}
function findLastAssistantMessage(messages) {
  for (let i = messages.length - 1;i >= 0; i -= 1) {
    const msg = messages[i];
    if (isAssistantMessage(msg)) {
      return msg ?? null;
    }
  }
  return null;
}
function normalizeMessageSwipes(message) {
  const swipes = Array.isArray(message.swipes) && message.swipes.length > 0 ? [...message.swipes] : [message.content ?? ""];
  const rawIndex = typeof message.swipe_id === "number" && Number.isFinite(message.swipe_id) ? Math.floor(message.swipe_id) : 0;
  const activeIndex = Math.max(0, Math.min(rawIndex, swipes.length - 1));
  const fallbackDate = Math.floor(Date.now() / 1000);
  const swipeDates = Array.isArray(message.swipe_dates) && message.swipe_dates.length === swipes.length ? message.swipe_dates.map((d) => typeof d === "number" && Number.isFinite(d) ? d : fallbackDate) : swipes.map((_, idx) => Array.isArray(message.swipe_dates) && typeof message.swipe_dates[idx] === "number" && Number.isFinite(message.swipe_dates[idx]) ? message.swipe_dates[idx] : fallbackDate);
  return { swipes, swipeDates, activeIndex };
}
function stitchContinueContent(baseContent, delta) {
  if (!delta)
    return baseContent;
  if (!baseContent)
    return delta;
  const endsWithWhitespace = /\s$/.test(baseContent);
  const startsWithWhitespace = /^\s/.test(delta);
  const startsWithPunctuation = /^[,.;:!?'"\u2019\u201D\)\]\-\u2014\u2026]/.test(delta);
  if (endsWithWhitespace || startsWithWhitespace || startsWithPunctuation) {
    return baseContent + delta;
  }
  return `${baseContent} ${delta}`;
}
function buildActiveSwipePatch(args) {
  const updatedSwipes = [...args.swipes];
  while (updatedSwipes.length <= args.swipeIndex) {
    updatedSwipes.push("");
  }
  updatedSwipes[args.swipeIndex] = args.content;
  return {
    content: args.content,
    swipes: updatedSwipes,
    swipe_id: args.swipeIndex,
    ...args.swipeDates ? { swipe_dates: [...args.swipeDates] } : {},
    ...args.reasoningText !== undefined ? { reasoning: { text: args.reasoningText } } : {}
  };
}

// src/backend/generation-runner.ts
var STREAM_FLUSH_INTERVAL_MS = 90;
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

class GuidedGenerationRunner {
  spindle;
  store;
  emitFrontend;
  activeRuns = new Map;
  pendingUsers = new Set;
  constructor(spindle2, store, emitFrontend) {
    this.spindle = spindle2;
    this.store = store;
    this.emitFrontend = emitFrontend;
  }
  userKey(userId) {
    return userId && userId.length > 0 ? userId : "__default__";
  }
  getActiveRun(userId) {
    const run = this.activeRuns.get(this.userKey(userId));
    return run ? { ...run.state } : null;
  }
  abortCurrent(userId, runId) {
    const run = this.activeRuns.get(this.userKey(userId));
    if (!run)
      return false;
    if (runId && run.state.runId !== runId)
      return false;
    run.controller.abort();
    return true;
  }
  async run(input, userId) {
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error("A Guided Generations action is already running. Stop it before starting another.");
    }
    this.assertRequiredPermissions(input.actionId);
    this.pendingUsers.add(key);
    let runId;
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
      const controller = new AbortController;
      this.activeRuns.set(key, {
        state: {
          runId,
          actionId: input.actionId,
          chatId,
          startedAt: Date.now()
        },
        controller
      });
      this.pendingUsers.delete(key);
      this.emitStatus(userId);
      if (trimmedInput && settings.inputRecovery.enabled) {
        const recovery = await this.store.pushRecovery({
          text: input.inputText,
          actionId: input.actionId,
          chatId
        }, userId);
        this.emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
      }
      const resolvedConnection = await this.resolveConnection(config.connectionId, input.activeConnectionId, userId);
      const connectionId = resolvedConnection?.id;
      if (input.actionId === "guided_regenerate" && config.presetId && this.spindle.permissions.has("presets")) {
        const preset = await this.spindle.presets.get(config.presetId, userId);
        if (!preset) {
          throw new Error("Selected preset for Guided Regenerate no longer exists. Choose another in Settings.");
        }
      }
      let targetAssistantId = null;
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
          text: ""
        };
      }
      const dryRunInput = buildDryRunInput({
        chatId,
        actionId: input.actionId,
        config,
        activeConnectionId: connectionId
      });
      let regeneratedSnapshot = null;
      if (input.actionId === "guided_regenerate") {
        const trailingAssistant = await this.findTrailingAssistantMessage(chatId);
        if (controller.signal.aborted) {
          return {
            runId,
            actionId: input.actionId,
            chatId,
            aborted: true,
            text: ""
          };
        }
        if (trailingAssistant) {
          regeneratedSnapshot = this.cloneMessageSnapshot(trailingAssistant);
          await this.spindle.chat.deleteMessage(chatId, trailingAssistant.id);
        }
      }
      let dryRunResult;
      try {
        dryRunResult = await this.spindle.generate.dryRun(dryRunInput, userId);
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
          text: ""
        };
      }
      const { model, provider } = resolveEffectiveModelAndProvider({
        configuredModel: config.model,
        connectionModel: resolvedConnection?.model,
        connectionProvider: resolvedConnection?.provider,
        dryRunModel: dryRunResult.model,
        dryRunProvider: dryRunResult.provider
      });
      const guidanceText = formatGuidanceText(config.instructionTemplate, input.inputText, {
        allowTemplateWithoutInput: input.actionId === "guided_impersonate"
      });
      const rawAssembled = dryRunResult.request_messages ?? dryRunResult.messages;
      const assembledMessages = input.actionId === "guided_swipe" ? stripRejectedSwipeAssistantTurn(rawAssembled, targetAssistantId) : rawAssembled;
      const messages = injectGuidanceMessage(assembledMessages, guidanceText, config.injectionRole, { actionId: input.actionId });
      const rawInput = {
        type: "raw",
        messages,
        parameters: dryRunResult.parameters,
        ...connectionId ? { connection_id: connectionId } : {},
        ...provider ? { provider } : {},
        ...model ? { model } : {},
        ...userId ? { userId } : {},
        signal: controller.signal
      };
      switch (input.actionId) {
        case "guided_response":
        case "guided_regenerate":
          return await this.executeAssistantResponse(input.actionId, runId, chatId, rawInput, controller.signal, regeneratedSnapshot);
        case "guided_continue":
          return await this.executeGuidedContinue(runId, chatId, targetAssistantId, rawInput, controller.signal);
        case "guided_swipe":
          return await this.executeGuidedSwipe(runId, chatId, targetAssistantId, rawInput, controller.signal);
        case "guided_impersonate":
          return await this.executeImpersonate(runId, chatId, rawInput, controller.signal, userId);
        default: {
          const exhaustive = input.actionId;
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
  assertRequiredPermissions(actionId) {
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
  async resolveChatId(requestedChatId, userId) {
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
  async resolveConnection(configuredConnectionId, activeConnectionId, userId) {
    const connections = await this.spindle.connections.list(userId);
    if (configuredConnectionId) {
      const found = connections.find((c) => c.id === configuredConnectionId);
      if (!found) {
        throw new Error("Selected API connection profile for this action no longer exists. Choose another in Settings.");
      }
      return found;
    }
    if (activeConnectionId) {
      const active = connections.find((c) => c.id === activeConnectionId);
      if (active)
        return active;
    }
    return connections.find((c) => c.is_default) ?? connections[0];
  }
  cloneMessageSnapshot(message) {
    return {
      ...message,
      swipes: Array.isArray(message.swipes) ? [...message.swipes] : [],
      swipe_dates: Array.isArray(message.swipe_dates) ? [...message.swipe_dates] : [],
      extra: message.extra ? { ...message.extra } : {},
      ...message.metadata ? { metadata: { ...message.metadata } } : {}
    };
  }
  async restoreTrailingAssistant(chatId, snapshot) {
    try {
      const restored = await this.spindle.chat.appendMessage(chatId, {
        role: "assistant",
        content: snapshot.content ?? "",
        ...snapshot.metadata ? { metadata: snapshot.metadata } : {}
      }, { triggerGeneration: false });
      const hasMultipleSwipes = Array.isArray(snapshot.swipes) && snapshot.swipes.length > 1;
      const hasSwipeDates = Array.isArray(snapshot.swipe_dates) && snapshot.swipe_dates.length > 0;
      const rawReasoning = snapshot.extra?.reasoning;
      const rawDuration = snapshot.extra?.reasoning_duration;
      const hasReasoning = typeof rawReasoning === "string" || typeof rawDuration === "number";
      if (hasMultipleSwipes || hasSwipeDates || hasReasoning) {
        const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(snapshot);
        await this.spindle.chat.updateMessage(chatId, restored.id, {
          content: snapshot.content ?? swipes[activeIndex] ?? "",
          swipes,
          swipe_id: activeIndex,
          swipe_dates: swipeDates,
          ...hasReasoning ? {
            reasoning: {
              ...typeof rawReasoning === "string" ? { text: rawReasoning } : {},
              ...typeof rawDuration === "number" ? { duration: rawDuration } : {}
            }
          } : {}
        });
      }
    } catch (restoreError) {
      this.spindle.log.warn(`[GuidedGenerations] Failed restoring regenerated message: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
  }
  async executeAssistantResponse(actionId, runId, chatId, rawInput, signal, regeneratedSnapshot) {
    let createdMessageId;
    try {
      const streamRes = await this.streamIntoMessage(chatId, rawInput, signal, async () => {
        const created = await this.spindle.chat.appendMessage(chatId, { role: "assistant", content: "" }, { triggerGeneration: false });
        createdMessageId = created.id;
        return {
          messageId: created.id,
          swipes: [""],
          swipeIndex: 0,
          swipeDates: [Math.floor(Date.now() / 1000)],
          baseText: ""
        };
      });
      if (!streamRes.hasOutput && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(chatId, regeneratedSnapshot);
      }
      return {
        runId,
        actionId,
        chatId,
        aborted: streamRes.aborted,
        ...streamRes.messageId ? { messageId: streamRes.messageId, swipeId: 0 } : {},
        text: streamRes.finalText
      };
    } catch (error) {
      if (!createdMessageId && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(chatId, regeneratedSnapshot);
      }
      throw error;
    }
  }
  async executeGuidedContinue(runId, chatId, targetId, rawInput, signal) {
    const initial = await this.readTargetMessageOrThrow(chatId, targetId);
    const initialNormalized = normalizeMessageSwipes(initial);
    const initialBaseText = initialNormalized.swipes[initialNormalized.activeIndex] ?? initial.content ?? "";
    const streamRes = await this.streamIntoMessage(chatId, rawInput, signal, async () => {
      const latest = await this.readTargetMessageOrThrow(chatId, targetId);
      const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(latest);
      return {
        messageId: latest.id,
        swipes,
        swipeIndex: activeIndex,
        swipeDates,
        baseText: swipes[activeIndex] ?? latest.content ?? ""
      };
    }, async (current) => this.refreshSwipeTarget(chatId, current));
    return {
      runId,
      actionId: "guided_continue",
      chatId,
      aborted: streamRes.aborted,
      messageId: streamRes.messageId ?? initial.id,
      swipeId: streamRes.swipeId ?? initialNormalized.activeIndex,
      text: streamRes.hasOutput ? streamRes.finalText : initialBaseText
    };
  }
  async executeGuidedSwipe(runId, chatId, targetId, rawInput, signal) {
    const streamRes = await this.streamIntoMessage(chatId, rawInput, signal, async () => {
      const latest = await this.readTargetMessageOrThrow(chatId, targetId);
      const { swipes, swipeDates } = normalizeMessageSwipes(latest);
      const newSwipeIndex = swipes.length;
      return {
        messageId: latest.id,
        swipes: [...swipes, ""],
        swipeIndex: newSwipeIndex,
        swipeDates: [...swipeDates, Math.floor(Date.now() / 1000)],
        baseText: ""
      };
    }, async (current) => this.refreshSwipeTarget(chatId, current));
    return {
      runId,
      actionId: "guided_swipe",
      chatId,
      aborted: streamRes.aborted,
      messageId: streamRes.messageId ?? targetId,
      ...streamRes.swipeId !== undefined ? { swipeId: streamRes.swipeId } : {},
      text: streamRes.finalText
    };
  }
  async executeImpersonate(runId, chatId, rawInput, signal, userId) {
    if (signal.aborted) {
      this.emitFrontend({ type: "gg:impersonate-chunk", chatId, text: "", done: true, aborted: true }, userId);
      return {
        runId,
        actionId: "guided_impersonate",
        chatId,
        aborted: true,
        text: ""
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
            this.emitFrontend({ type: "gg:impersonate-chunk", chatId, text: generated, done: false }, userId);
          }
        } else if (chunk.type === "done") {
          if (chunk.content)
            generated = chunk.content;
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        aborted = true;
      } else {
        throw error;
      }
    }
    this.emitFrontend({ type: "gg:impersonate-chunk", chatId, text: generated, done: true, aborted }, userId);
    return {
      runId,
      actionId: "guided_impersonate",
      chatId,
      aborted,
      text: generated
    };
  }
  async streamIntoMessage(chatId, rawInput, signal, ensureTarget, refreshTarget) {
    let deltaText = "";
    let reasoningText = "";
    let aborted = false;
    let lastFlushAt = 0;
    let flushChain = Promise.resolve();
    let lastFlushError = null;
    let target = null;
    const buildMergedContent = (baseText) => baseText ? stitchContinueContent(baseText, deltaText) : deltaText;
    const enqueuePatchFlush = (targetSnapshot, swallowError) => {
      const mergedContent = buildMergedContent(targetSnapshot.baseText);
      const patch = buildActiveSwipePatch({
        swipes: targetSnapshot.swipes,
        swipeIndex: targetSnapshot.swipeIndex,
        content: mergedContent,
        swipeDates: targetSnapshot.swipeDates,
        ...reasoningText ? { reasoningText } : {}
      });
      flushChain = flushChain.catch(() => {
        return;
      }).then(async () => {
        try {
          await this.spindle.chat.updateMessage(chatId, targetSnapshot.messageId, patch);
          lastFlushError = null;
        } catch (err) {
          if (!swallowError) {
            lastFlushError = err;
          }
        }
      });
    };
    const maybeFlush = (force) => {
      if (!target)
        return;
      const now = Date.now();
      if (!force && now - lastFlushAt < STREAM_FLUSH_INTERVAL_MS)
        return;
      lastFlushAt = now;
      enqueuePatchFlush(target, false);
    };
    const ensureInitializedOnOutput = async () => {
      if (target)
        return;
      if (deltaText.length === 0 && reasoningText.length === 0)
        return;
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
          if (chunk.content)
            deltaText = chunk.content;
          if (chunk.reasoning)
            reasoningText = chunk.reasoning;
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
        await flushChain.catch(() => {
          return;
        });
        throw error;
      }
    }
    const hasOutput = deltaText.length > 0 || reasoningText.length > 0;
    if (!hasOutput || !target) {
      await flushChain.catch(() => {
        return;
      });
      return {
        finalText: "",
        aborted,
        hasOutput: false
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
      hasOutput: true
    };
  }
  async refreshSwipeTarget(chatId, current) {
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      const latest = messages.find((m) => m.id === current.messageId);
      if (!latest)
        return current;
      const normalized = normalizeMessageSwipes(latest);
      if (normalized.swipes.length > current.swipeIndex) {
        return {
          ...current,
          swipes: normalized.swipes,
          swipeDates: normalized.swipeDates
        };
      }
      return current;
    } catch {
      return current;
    }
  }
  async readTargetMessageOrThrow(chatId, targetId) {
    const messages = await this.spindle.chat.getMessages(chatId);
    const byId = messages.find((m) => m.id === targetId && isAssistantMessage(m));
    if (byId)
      return byId;
    const fallback = findLastAssistantMessage(messages);
    if (!fallback) {
      throw new Error("No assistant message found in this chat to continue or swipe.");
    }
    return fallback;
  }
  async findTrailingAssistantMessage(chatId) {
    const messages = await this.spindle.chat.getMessages(chatId);
    const last = messages[messages.length - 1];
    return isAssistantMessage(last) ? last ?? null : null;
  }
  async requireLastAssistantMessage(chatId) {
    const messages = await this.spindle.chat.getMessages(chatId);
    const target = findLastAssistantMessage(messages);
    if (!target) {
      throw new Error("No assistant message found in this chat to continue or swipe.");
    }
    return target;
  }
  emitStatus(userId) {
    this.emitFrontend({ type: "gg:status", run: this.getActiveRun(userId) }, userId);
  }
}

// src/shared/defaults.ts
var GUIDED_ACTION_ORDER = [
  "guided_response",
  "guided_continue",
  "guided_regenerate",
  "guided_swipe",
  "guided_impersonate"
];
var DEFAULT_TOOLBAR_PLACEMENT = "after_native";
var DEFAULT_BUTTON_ORDER = [
  ...GUIDED_ACTION_ORDER,
  "input_recovery"
];
function isGuidedActionId(value) {
  return typeof value === "string" && GUIDED_ACTION_ORDER.includes(value);
}
function isToolbarOptionId(value) {
  return value === "input_recovery" || isGuidedActionId(value);
}
function normalizeToolbarPlacement(value) {
  if (value === "after_native" || value === "before_native" || value === "right" || value === "below_bar") {
    return value;
  }
  return DEFAULT_TOOLBAR_PLACEMENT;
}
function normalizeButtonOrder(raw) {
  const result = [];
  const seen = new Set;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isToolbarOptionId(entry) || seen.has(entry))
        continue;
      seen.add(entry);
      result.push(entry);
    }
  }
  for (const fallbackId of DEFAULT_BUTTON_ORDER) {
    if (!seen.has(fallbackId)) {
      seen.add(fallbackId);
      result.push(fallbackId);
    }
  }
  return result;
}
var DEFAULT_ACTION_CONFIGS = {
  guided_response: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[OOC Guidance for the next response: {{input}}]",
    clearInputOnRun: true
  },
  guided_continue: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[OOC Continuation Guidance \u2014 continue seamlessly from the current ending: {{input}}]",
    clearInputOnRun: true
  },
  guided_regenerate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[OOC Guidance for regenerating this response: {{input}}]",
    clearInputOnRun: true
  },
  guided_swipe: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[OOC Guidance for this alternative response: {{input}}]",
    clearInputOnRun: true
  },
  guided_impersonate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[Write the user's next message following this outline: {{input}}]",
    clearInputOnRun: true
  }
};
function createDefaultSettings() {
  return {
    version: 1,
    toolbarPlacement: DEFAULT_TOOLBAR_PLACEMENT,
    buttonOrder: [...DEFAULT_BUTTON_ORDER],
    actions: {
      guided_response: { ...DEFAULT_ACTION_CONFIGS.guided_response },
      guided_continue: { ...DEFAULT_ACTION_CONFIGS.guided_continue },
      guided_regenerate: { ...DEFAULT_ACTION_CONFIGS.guided_regenerate },
      guided_swipe: { ...DEFAULT_ACTION_CONFIGS.guided_swipe },
      guided_impersonate: { ...DEFAULT_ACTION_CONFIGS.guided_impersonate }
    },
    inputRecovery: {
      enabled: true,
      maxEntries: 10
    }
  };
}

// src/backend/settings-store.ts
var SETTINGS_FILE = "settings.json";
var RECOVERY_FILE = "recovery.json";
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeRole(value, fallback) {
  return value === "system" || value === "user" || value === "assistant" ? value : fallback;
}
function normalizeOptionalId(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function normalizeActionConfig(raw, fallback) {
  const record = isRecord(raw) ? raw : {};
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    connectionId: normalizeOptionalId(record.connectionId),
    model: normalizeOptionalId(record.model),
    presetId: normalizeOptionalId(record.presetId),
    injectionRole: normalizeRole(record.injectionRole, fallback.injectionRole),
    instructionTemplate: typeof record.instructionTemplate === "string" ? record.instructionTemplate : fallback.instructionTemplate,
    clearInputOnRun: typeof record.clearInputOnRun === "boolean" ? record.clearInputOnRun : fallback.clearInputOnRun
  };
}
function normalizeSettings(raw) {
  const defaults = createDefaultSettings();
  const root = isRecord(raw) ? raw : {};
  const rawActions = isRecord(root.actions) ? root.actions : {};
  const rawRecovery = isRecord(root.inputRecovery) ? root.inputRecovery : {};
  const actions = { ...defaults.actions };
  for (const actionId of GUIDED_ACTION_ORDER) {
    actions[actionId] = normalizeActionConfig(rawActions[actionId], defaults.actions[actionId]);
  }
  const maxEntriesRaw = typeof rawRecovery.maxEntries === "number" && Number.isFinite(rawRecovery.maxEntries) ? rawRecovery.maxEntries : defaults.inputRecovery.maxEntries;
  const maxEntries = Math.max(1, Math.min(50, Math.floor(maxEntriesRaw)));
  return {
    version: 1,
    toolbarPlacement: normalizeToolbarPlacement(root.toolbarPlacement),
    buttonOrder: normalizeButtonOrder(root.buttonOrder),
    actions,
    inputRecovery: {
      enabled: typeof rawRecovery.enabled === "boolean" ? rawRecovery.enabled : defaults.inputRecovery.enabled,
      maxEntries
    }
  };
}
function normalizeRecoveryList(raw, maxEntries) {
  if (!Array.isArray(raw))
    return [];
  const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 10;
  const validIds = new Set(GUIDED_ACTION_ORDER);
  const result = [];
  for (const item of raw) {
    if (!isRecord(item))
      continue;
    if (typeof item.text !== "string" || !item.text.trim())
      continue;
    if (typeof item.id !== "string" || !item.id)
      continue;
    const actionId = validIds.has(item.actionId) ? item.actionId : "guided_response";
    result.push({
      id: item.id,
      text: item.text,
      actionId,
      chatId: typeof item.chatId === "string" && item.chatId ? item.chatId : null,
      createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    });
    if (result.length >= limit)
      break;
  }
  return result;
}
function appendRecoveryEntry(entries, next, maxEntries) {
  const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 10;
  const text = next.text;
  if (!text.trim())
    return [...entries].slice(0, limit);
  if (entries[0]?.text === text) {
    return [...entries].slice(0, limit);
  }
  const entry = {
    id: next.id ?? `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    actionId: next.actionId,
    chatId: next.chatId ?? null,
    createdAt: next.createdAt ?? Date.now()
  };
  return [entry, ...entries].slice(0, limit);
}

class SettingsStore {
  spindle;
  settingsCache = new Map;
  recoveryCache = new Map;
  writeQueues = new Map;
  constructor(spindle2) {
    this.spindle = spindle2;
  }
  userKey(userId) {
    return userId && userId.length > 0 ? userId : "__default__";
  }
  cloneSettings(settings) {
    const actions = { ...settings.actions };
    for (const actionId of GUIDED_ACTION_ORDER) {
      actions[actionId] = { ...settings.actions[actionId] };
    }
    return {
      ...settings,
      buttonOrder: [...settings.buttonOrder],
      actions,
      inputRecovery: { ...settings.inputRecovery }
    };
  }
  enqueueUserWrite(userId, task) {
    const key = this.userKey(userId);
    const prev = this.writeQueues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {
      return;
    }).then(task);
    const tail = next.catch(() => {
      return;
    });
    this.writeQueues.set(key, tail);
    tail.finally(() => {
      if (this.writeQueues.get(key) === tail) {
        this.writeQueues.delete(key);
      }
    });
    return next;
  }
  async getSettings(userId) {
    const key = this.userKey(userId);
    const cached = this.settingsCache.get(key);
    if (cached)
      return this.cloneSettings(cached);
    try {
      if (await this.spindle.userStorage.exists(SETTINGS_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(SETTINGS_FILE, userId);
        const parsed = normalizeSettings(JSON.parse(raw));
        this.settingsCache.set(key, parsed);
        return this.cloneSettings(parsed);
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading settings, using defaults: ${error instanceof Error ? error.message : String(error)}`);
      return createDefaultSettings();
    }
    const defaults = createDefaultSettings();
    this.settingsCache.set(key, defaults);
    return this.cloneSettings(defaults);
  }
  async saveSettings(next, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const key = this.userKey(userId);
      const normalized = normalizeSettings(next);
      await this.spindle.userStorage.write(SETTINGS_FILE, JSON.stringify(normalized, null, 2), userId);
      this.settingsCache.set(key, normalized);
      const currentRecovery = await this.readRecoveryUnlocked(userId, normalized.inputRecovery.maxEntries);
      if (currentRecovery.length > normalized.inputRecovery.maxEntries) {
        await this.writeRecoveryUnlocked(currentRecovery.slice(0, normalized.inputRecovery.maxEntries), userId);
      }
      return this.cloneSettings(normalized);
    });
  }
  async getRecovery(userId) {
    const settings = await this.getSettings(userId);
    return this.readRecoveryUnlocked(userId, settings.inputRecovery.maxEntries);
  }
  async pushRecovery(input, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const settings = await this.getSettings(userId);
      const current = await this.readRecoveryUnlocked(userId, settings.inputRecovery.maxEntries);
      if (!settings.inputRecovery.enabled) {
        return current;
      }
      const updated = appendRecoveryEntry(current, input, settings.inputRecovery.maxEntries);
      await this.writeRecoveryUnlocked(updated, userId);
      return [...updated];
    });
  }
  async clearRecovery(userId) {
    return this.enqueueUserWrite(userId, async () => {
      await this.writeRecoveryUnlocked([], userId);
      return [];
    });
  }
  async readRecoveryUnlocked(userId, maxEntries) {
    const key = this.userKey(userId);
    const cached = this.recoveryCache.get(key);
    if (cached)
      return [...cached.slice(0, maxEntries)];
    try {
      if (await this.spindle.userStorage.exists(RECOVERY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(RECOVERY_FILE, userId);
        const parsed = normalizeRecoveryList(JSON.parse(raw), maxEntries);
        this.recoveryCache.set(key, parsed);
        return [...parsed];
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading recovery history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    this.recoveryCache.set(key, []);
    return [];
  }
  async writeRecoveryUnlocked(entries, userId) {
    await this.spindle.userStorage.write(RECOVERY_FILE, JSON.stringify(entries, null, 2), userId);
    this.recoveryCache.set(this.userKey(userId), [...entries]);
  }
  async listConnections(userId) {
    const { items } = await this.fetchConnections(userId);
    return items;
  }
  async listPresets(userId) {
    const { items } = await this.fetchPresets(userId);
    return items;
  }
  async loadCatalogs(userId) {
    const [connRes, presetRes] = await Promise.all([
      this.fetchConnections(userId),
      this.fetchPresets(userId)
    ]);
    const warnings = [connRes.warning, presetRes.warning].filter((w) => Boolean(w));
    return {
      connections: connRes.items,
      presets: presetRes.items,
      warnings
    };
  }
  async fetchCatalog(permission, label, loader) {
    if (!this.spindle.permissions.has(permission))
      return { items: [] };
    try {
      return { items: await loader() };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.spindle.log.warn(`[GuidedGenerations] Unable to list ${label}: ${detail}`);
      return { items: [], warning: `Unable to load ${label}: ${detail}` };
    }
  }
  fetchConnections(userId) {
    return this.fetchCatalog("generation", "connection profiles", async () => {
      const items = await this.spindle.connections.list(userId);
      return items.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        model: c.model,
        isDefault: Boolean(c.is_default)
      }));
    });
  }
  fetchPresets(userId) {
    return this.fetchCatalog("presets", "presets", async () => {
      const res = await this.spindle.presets.list({ limit: 200, userId });
      return res.data.map((p) => ({
        id: p.id,
        name: p.name
      }));
    });
  }
}

// src/backend.ts
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asRpcRequest(payload) {
  if (!isRecord2(payload))
    return null;
  if (payload.type !== "gg:rpc")
    return null;
  if (typeof payload.requestId !== "string" || typeof payload.action !== "string")
    return null;
  return payload;
}
function parseRunActionInput(raw) {
  const record = isRecord2(raw) ? raw : {};
  if (!isGuidedActionId(record.actionId)) {
    throw new Error("Invalid Guided Generations action id.");
  }
  return {
    actionId: record.actionId,
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    activeConnectionId: typeof record.activeConnectionId === "string" ? record.activeConnectionId : null,
    inputText: typeof record.inputText === "string" ? record.inputText : ""
  };
}
function registerBackend(api) {
  const store = new SettingsStore(api);
  function emitFrontend(event, userId) {
    api.sendToFrontend(event, userId);
  }
  const runner = new GuidedGenerationRunner(api, store, emitFrontend);
  async function buildBootstrapView(userId) {
    const [settings, catalogs, recovery] = await Promise.all([
      store.getSettings(userId),
      store.loadCatalogs(userId),
      store.getRecovery(userId)
    ]);
    return {
      settings,
      connections: catalogs.connections,
      presets: catalogs.presets,
      recovery,
      activeRun: runner.getActiveRun(userId),
      permissions: {
        generation: api.permissions.has("generation"),
        chats: api.permissions.has("chats"),
        chat_mutation: api.permissions.has("chat_mutation"),
        presets: api.permissions.has("presets")
      },
      ...catalogs.warnings.length > 0 ? { catalogWarnings: catalogs.warnings } : {}
    };
  }
  async function handleRpc(req, userId) {
    const reply = (result, error) => {
      const envelope = {
        type: "gg:reply",
        requestId: req.requestId,
        ...error !== undefined ? { error } : { result }
      };
      api.sendToFrontend(envelope, userId);
    };
    try {
      switch (req.action) {
        case "get_bootstrap": {
          reply(await buildBootstrapView(userId));
          return;
        }
        case "save_settings": {
          const saved = await store.saveSettings(req.input, userId);
          reply(saved);
          return;
        }
        case "run_action": {
          const parsed = parseRunActionInput(req.input);
          const result = await runner.run(parsed, userId);
          reply(result);
          return;
        }
        case "abort_action": {
          const record = isRecord2(req.input) ? req.input : {};
          const aborted = runner.abortCurrent(userId, typeof record.runId === "string" ? record.runId : undefined);
          reply({ aborted });
          return;
        }
        case "push_recovery": {
          const record = isRecord2(req.input) ? req.input : {};
          const text = typeof record.text === "string" ? record.text : "";
          const actionId = isGuidedActionId(record.actionId) ? record.actionId : "guided_response";
          const settings = await store.getSettings(userId);
          if (!settings.inputRecovery.enabled) {
            reply(await store.getRecovery(userId));
            return;
          }
          const recovery = await store.pushRecovery({
            text,
            actionId,
            chatId: typeof record.chatId === "string" ? record.chatId : null
          }, userId);
          emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
          reply(recovery);
          return;
        }
        case "restore_recovery": {
          const recovery = await store.getRecovery(userId);
          const record = isRecord2(req.input) ? req.input : {};
          const targetId = typeof record.id === "string" && record.id ? record.id : null;
          const entry = targetId ? recovery.find((item) => item.id === targetId) ?? null : recovery[0] ?? null;
          reply(entry);
          return;
        }
        case "clear_recovery": {
          const recovery = await store.clearRecovery(userId);
          emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
          reply(recovery);
          return;
        }
        default:
          throw new Error(`Unsupported action: ${String(req.action)}`);
      }
    } catch (error) {
      reply(undefined, error instanceof Error ? error.message : String(error));
    }
  }
  api.onFrontendMessage((payload, userId) => {
    const req = asRpcRequest(payload);
    if (!req)
      return;
    handleRpc(req, userId);
  });
  api.permissions.onChanged(() => {
    emitFrontend({ type: "gg:changed", reason: "permissions" });
  });
  for (const eventName of ["CHAT_SWITCHED", "CHAT_CHANGED"]) {
    api.on(eventName, (_payload, userId) => {
      emitFrontend({ type: "gg:changed", reason: eventName.toLowerCase() }, userId);
    });
  }
  return { store, runner, handleRpc, buildBootstrapView };
}
if (typeof spindle !== "undefined") {
  registerBackend(spindle);
}
export {
  registerBackend
};
