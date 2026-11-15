// @bun
// src/shared/defaults.ts
var GUIDED_ACTION_ORDER = [
  "guided_response",
  "guided_continue",
  "guided_regenerate",
  "guided_swipe",
  "guided_impersonate"
];
var DEFAULT_TOOLBAR_PLACEMENT = "after_native";
var DEFAULT_GUIDANCE_POSITION = "before_post_history";
var DEFAULT_GUIDANCE_DEPTH = 0;
var DEFAULT_APPLY_REGEX = true;
function normalizeGuidancePosition(value, fallback = DEFAULT_GUIDANCE_POSITION) {
  if (value === "before_post_history" || value === "in_history" || value === "pre_history" || value === "post_history") {
    return value;
  }
  return fallback;
}
function normalizeGuidanceDepth(value, fallback = DEFAULT_GUIDANCE_DEPTH) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(999, Math.floor(value)));
  }
  return Math.max(0, Math.min(999, Math.floor(fallback)));
}
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
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Guidance for the next response: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX
  },
  guided_continue: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Continuation Guidance \u2014 continue seamlessly from the current ending: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX
  },
  guided_regenerate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Guidance for regenerating this response: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX
  },
  guided_swipe: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Guidance for this alternative response: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX
  },
  guided_impersonate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[Write the user's next message following this outline: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX
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

// src/backend/prompt-builder.ts
function getMessageSourceId(msg) {
  if (typeof msg.sourceMessageId === "string" && msg.sourceMessageId.length > 0) {
    return msg.sourceMessageId;
  }
  if (typeof msg.__sourceMessageId === "string" && msg.__sourceMessageId.length > 0) {
    return msg.__sourceMessageId;
  }
  return;
}
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
function isPartialAssistantPrefill(msg) {
  return Boolean(msg && msg.role === "assistant" && msg.partial === true);
}
function mapPromptBlockRole(role) {
  if (role === "user" || role === "user_append")
    return "user";
  if (role === "assistant" || role === "assistant_append")
    return "assistant";
  return "system";
}
function mapInjectionRoleToRegexPlacement(role) {
  if (role === "user")
    return "user_input";
  if (role === "assistant")
    return "ai_output";
  return "world_info";
}
function computeEffectiveGuidanceDepth(guidancePosition, guidanceDepth, isChatHistory) {
  if (guidancePosition === "in_history") {
    return normalizeGuidanceDepth(guidanceDepth, 0);
  }
  if (guidancePosition === "pre_history" && Array.isArray(isChatHistory)) {
    return isChatHistory.filter(Boolean).length;
  }
  return 0;
}
function resolveChatHistoryFlags(messages, options = {}) {
  if (messages.length === 0)
    return;
  if (messages.some((m) => typeof m.__isChatHistory === "boolean" || typeof m.__chatHistorySource === "boolean")) {
    return messages.map((m) => Boolean(m.__isChatHistory ?? m.__chatHistorySource));
  }
  if (Array.isArray(options.breakdown) && options.breakdown.length > 0) {
    const historyEntry = options.breakdown.find((entry) => (entry.type === "chat_history" || entry.marker === "chat_history" || entry.marker === "chatHistory") && typeof entry.firstMessageIndex === "number" && typeof entry.messageCount === "number" && entry.messageCount >= 0);
    if (historyEntry) {
      const start = Math.max(0, historyEntry.firstMessageIndex);
      const end = Math.min(messages.length, start + historyEntry.messageCount);
      return messages.map((_, idx) => idx >= start && idx < end);
    }
  }
  if (Array.isArray(options.presetBlocks) && options.presetBlocks.length > 0) {
    const isContentBlock = (block) => block.enabled && block.marker !== "category" && block.marker !== "chat_history" && block.marker !== "chatHistory" && (!block.marker || typeof block.content === "string" && block.content.trim().length > 0);
    const preBlocks = options.presetBlocks.filter((b) => b.position === "pre_history" && isContentBlock(b));
    const postBlocks = options.presetBlocks.filter((b) => b.position === "post_history" && isContentBlock(b));
    if (preBlocks.length > 0 || postBlocks.length > 0) {
      let preEnd = 0;
      for (const block of preBlocks) {
        if (preEnd >= messages.length)
          break;
        const expectedRole = mapPromptBlockRole(block.role);
        if (messages[preEnd]?.role === expectedRole) {
          preEnd += 1;
        }
      }
      let postStart = messages.length;
      if (postStart > preEnd && isPartialAssistantPrefill(messages[postStart - 1])) {
        postStart -= 1;
      }
      for (let i = postBlocks.length - 1;i >= 0; i -= 1) {
        if (postStart <= preEnd)
          break;
        const expectedRole = mapPromptBlockRole(postBlocks[i].role);
        if (messages[postStart - 1]?.role === expectedRole) {
          postStart -= 1;
        }
      }
      if (preEnd > 0 || postStart < messages.length) {
        return messages.map((_, idx) => idx >= preEnd && idx < postStart);
      }
    }
  }
  if (messages.some((m) => Boolean(getMessageSourceId(m)))) {
    return messages.map((m) => Boolean(getMessageSourceId(m)));
  }
  return;
}
function stripInternalMessageMarkers(messages) {
  return messages.map((msg) => {
    const {
      __isChatHistory: _isHistory,
      __isWorldInfoEntry: _isWi,
      __chatHistorySource: _chatHistorySource,
      __worldInfoSource: _worldInfoSource,
      __sourceMessageId: _sourceMessageId,
      __sourceIndexInChat: _sourceIndexInChat,
      ...rest
    } = msg;
    return rest;
  });
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
  const position = normalizeGuidancePosition(options.guidancePosition, "before_post_history");
  const depth = normalizeGuidanceDepth(options.guidanceDepth, 0);
  const hasHistoryFlags = Array.isArray(options.isChatHistory) && options.isChatHistory.length === copy.length;
  const historyIndices = [];
  if (hasHistoryFlags) {
    for (let i = 0;i < options.isChatHistory.length; i += 1) {
      if (options.isChatHistory[i]) {
        historyIndices.push(i);
      }
    }
  }
  const findFallbackContinueAssistantIndex = () => {
    if (copy.length === 0)
      return -1;
    if (copy[copy.length - 1]?.role === "assistant") {
      return copy.length - 1;
    }
    if (options.actionId === "guided_continue") {
      let idx = copy.length - 1;
      while (idx >= 0 && copy[idx]?.role === "system") {
        idx -= 1;
      }
      if (idx >= 0 && idx < copy.length - 1 && copy[idx]?.role === "assistant") {
        return idx;
      }
    }
    return -1;
  };
  const findHistoryContinueAssistantIndex = () => {
    for (let i = historyIndices.length - 1;i >= 0; i -= 1) {
      const idx = historyIndices[i];
      const roleAtIdx = copy[idx]?.role;
      if (roleAtIdx === "assistant") {
        return idx;
      }
      if (roleAtIdx === "user") {
        return -1;
      }
    }
    return -1;
  };
  let insertIndex = copy.length;
  switch (position) {
    case "pre_history": {
      if (hasHistoryFlags) {
        insertIndex = historyIndices.length > 0 ? historyIndices[0] : 0;
      } else {
        const firstTurnIdx = copy.findIndex((m) => m.role === "user" || m.role === "assistant");
        insertIndex = firstTurnIdx >= 0 ? firstTurnIdx : 0;
      }
      break;
    }
    case "before_post_history": {
      if (hasHistoryFlags) {
        if (historyIndices.length > 0) {
          const lastHistoryIdx = historyIndices[historyIndices.length - 1];
          if (options.actionId === "guided_continue") {
            const continueIdx = findHistoryContinueAssistantIndex();
            const fallbackIdx = continueIdx >= 0 ? continueIdx : findFallbackContinueAssistantIndex();
            insertIndex = fallbackIdx >= 0 ? fallbackIdx : lastHistoryIdx + 1;
          } else {
            insertIndex = lastHistoryIdx + 1;
          }
        } else {
          insertIndex = copy.length > 0 && copy[copy.length - 1]?.role === "assistant" ? copy.length - 1 : copy.length;
        }
      } else {
        const continueIdx = findFallbackContinueAssistantIndex();
        insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
      }
      break;
    }
    case "in_history": {
      if (hasHistoryFlags) {
        if (historyIndices.length > 0) {
          const lastHistoryIdx = historyIndices[historyIndices.length - 1];
          if (depth === 0) {
            if (options.actionId === "guided_continue") {
              const continueIdx = findHistoryContinueAssistantIndex();
              const fallbackIdx = continueIdx >= 0 ? continueIdx : findFallbackContinueAssistantIndex();
              insertIndex = fallbackIdx >= 0 ? fallbackIdx : lastHistoryIdx + 1;
            } else {
              insertIndex = lastHistoryIdx + 1;
            }
          } else {
            const clampedOffset = Math.max(0, historyIndices.length - depth);
            insertIndex = historyIndices[clampedOffset];
          }
        } else {
          insertIndex = copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1]) ? copy.length - 1 : copy.length;
        }
      } else if (depth === 0) {
        const continueIdx = findFallbackContinueAssistantIndex();
        insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
      } else {
        const endBound = copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1]) ? copy.length - 1 : copy.length;
        insertIndex = Math.max(0, endBound - depth);
      }
      break;
    }
    case "post_history": {
      if (copy.length > 0 && (isPartialAssistantPrefill(copy[copy.length - 1]) || options.actionId === "guided_continue" && copy[copy.length - 1]?.role === "assistant")) {
        insertIndex = copy.length - 1;
      } else {
        insertIndex = copy.length;
      }
      break;
    }
  }
  copy.splice(insertIndex, 0, injected);
  return copy;
}
function stripRejectedSwipeAssistantTurnWithHistory(messages, targetMessageId, isChatHistory) {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;
  if (targetMessageId && messages.some((msg) => getMessageSourceId(msg) === targetMessageId)) {
    const nextMessages = [];
    const nextFlags = [];
    for (let i = 0;i < messages.length; i += 1) {
      const msg = messages[i];
      if (getMessageSourceId(msg) === targetMessageId)
        continue;
      nextMessages.push({ ...msg });
      if (hasFlags)
        nextFlags.push(Boolean(isChatHistory[i]));
    }
    return {
      messages: nextMessages,
      ...hasFlags ? { isChatHistory: nextFlags } : {}
    };
  }
  const copy = messages.map((msg) => ({ ...msg }));
  const nextFlags = hasFlags ? [...isChatHistory] : undefined;
  for (let i = copy.length - 1;i >= 0; i -= 1) {
    const msg = copy[i];
    if (!msg)
      continue;
    if (msg.role === "user") {
      break;
    }
    if (msg.role === "assistant") {
      copy.splice(i, 1);
      if (nextFlags)
        nextFlags.splice(i, 1);
      break;
    }
  }
  return {
    messages: copy,
    ...nextFlags ? { isChatHistory: nextFlags } : {}
  };
}
function isBlankLlmContent(content) {
  if (typeof content === "string") {
    return content.trim().length === 0;
  }
  if (Array.isArray(content)) {
    return content.every((part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length === 0);
  }
  return false;
}
function stripCreatedBlankAssistantTurnWithHistory(messages, createdMessageId, isChatHistory) {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;
  if (createdMessageId && messages.some((msg) => getMessageSourceId(msg) === createdMessageId)) {
    const nextMessages = [];
    const nextFlags = [];
    for (let i = 0;i < messages.length; i += 1) {
      const msg = messages[i];
      if (getMessageSourceId(msg) === createdMessageId)
        continue;
      nextMessages.push({ ...msg });
      if (hasFlags)
        nextFlags.push(Boolean(isChatHistory[i]));
    }
    return {
      messages: nextMessages,
      ...hasFlags ? { isChatHistory: nextFlags } : {}
    };
  }
  const copy = messages.map((msg) => ({ ...msg }));
  const nextFlags = hasFlags ? [...isChatHistory] : undefined;
  for (let i = copy.length - 1;i >= 0; i -= 1) {
    const msg = copy[i];
    if (!msg)
      continue;
    if (hasFlags && !nextFlags[i]) {
      continue;
    }
    if (msg.role === "user") {
      break;
    }
    if (msg.role === "assistant") {
      if (msg.partial) {
        continue;
      }
      if (isBlankLlmContent(msg.content)) {
        copy.splice(i, 1);
        if (nextFlags)
          nextFlags.splice(i, 1);
      }
      break;
    }
  }
  return {
    messages: copy,
    ...nextFlags ? { isChatHistory: nextFlags } : {}
  };
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
function buildUpdatedSwipesArray(swipes, swipeIndex, content) {
  const updatedSwipes = [...swipes];
  while (updatedSwipes.length <= swipeIndex) {
    updatedSwipes.push("");
  }
  updatedSwipes[swipeIndex] = content;
  return updatedSwipes;
}
function resolveExistingSwipeReasoningSlot(index, existingExtra, existingActiveSwipeId) {
  const bySwipe = Array.isArray(existingExtra?.reasoningBySwipe) ? existingExtra.reasoningBySwipe : undefined;
  const durBySwipe = Array.isArray(existingExtra?.reasoningDurationBySwipe) ? existingExtra.reasoningDurationBySwipe : undefined;
  let rawText = bySwipe ? bySwipe[index] : undefined;
  let rawDur = durBySwipe ? durBySwipe[index] : undefined;
  if (existingActiveSwipeId !== undefined && index === existingActiveSwipeId) {
    if (rawText === undefined && typeof existingExtra?.reasoning === "string") {
      rawText = existingExtra.reasoning;
    }
    const dur = existingExtra?.reasoningDuration ?? existingExtra?.reasoning_duration;
    if (rawDur === undefined && typeof dur === "number") {
      rawDur = dur;
    }
  }
  const text = typeof rawText === "string" ? rawText : null;
  const duration = typeof rawDur === "number" && Number.isFinite(rawDur) && rawDur >= 0 ? rawDur : undefined;
  if (text === null && duration === undefined) {
    return null;
  }
  return {
    text,
    ...duration !== undefined ? { duration } : {}
  };
}
function extractSwipeReasoning(message, swipeIndex) {
  if (!Number.isFinite(swipeIndex)) {
    return { text: null, duration: null };
  }
  const extra = message.extra;
  const { activeIndex } = normalizeMessageSwipes(message);
  const idx = Math.max(0, Math.floor(swipeIndex));
  const bySwipe = Array.isArray(extra?.reasoningBySwipe) ? extra.reasoningBySwipe : undefined;
  const durBySwipe = Array.isArray(extra?.reasoningDurationBySwipe) ? extra.reasoningDurationBySwipe : undefined;
  let rawText = bySwipe && idx < bySwipe.length ? bySwipe[idx] : undefined;
  let rawDur = durBySwipe && idx < durBySwipe.length ? durBySwipe[idx] : undefined;
  if (idx === activeIndex) {
    if (rawText === undefined) {
      rawText = extra?.reasoning;
    }
    if (rawDur === undefined) {
      rawDur = extra?.reasoningDuration ?? extra?.reasoning_duration;
    }
  }
  const text = typeof rawText === "string" ? rawText : null;
  const duration = typeof rawDur === "number" && Number.isFinite(rawDur) && rawDur >= 0 ? rawDur : null;
  return { text, duration };
}
function hasPresetContextForSwipe(metadata, swipeIndex) {
  if (!Number.isFinite(swipeIndex))
    return false;
  const contexts = metadata?.preset_contexts;
  if (!Array.isArray(contexts))
    return false;
  const idx = Math.max(0, Math.floor(swipeIndex));
  const entry = contexts[idx];
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    return false;
  const presetId = entry.preset_id;
  return typeof presetId === "string" && presetId.trim().length > 0;
}
function buildPresetContextMetadata(existingMetadata, swipeIndex, presetId) {
  if (!Number.isFinite(swipeIndex)) {
    return { ...existingMetadata ?? {} };
  }
  const idx = Math.max(0, Math.floor(swipeIndex));
  const rawContexts = Array.isArray(existingMetadata?.preset_contexts) ? existingMetadata.preset_contexts : [];
  const nextContexts = rawContexts.map((entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : null);
  while (nextContexts.length <= idx) {
    nextContexts.push(null);
  }
  nextContexts[idx] = { preset_id: presetId };
  return {
    ...existingMetadata ?? {},
    preset_contexts: nextContexts
  };
}
function buildActiveSwipePatch(args) {
  const updatedSwipes = buildUpdatedSwipesArray(args.swipes, args.swipeIndex, args.content);
  const hasReasoningText = args.reasoningText !== undefined;
  const hasReasoningDuration = args.reasoningDuration !== undefined;
  const reasoning = hasReasoningText || hasReasoningDuration ? {
    ...hasReasoningText ? { text: args.reasoningText } : {},
    ...hasReasoningDuration ? { duration: args.reasoningDuration } : {}
  } : undefined;
  return {
    content: args.content,
    swipes: updatedSwipes,
    swipe_id: args.swipeIndex,
    ...args.swipeDates ? { swipe_dates: [...args.swipeDates] } : {},
    ...reasoning ? { reasoning } : {},
    ...args.metadata ? { metadata: args.metadata } : {},
    ...args.skipChunkRebuild !== undefined ? { skipChunkRebuild: args.skipChunkRebuild } : {}
  };
}
function buildBackgroundSwipePatch(args) {
  const updatedSwipes = buildUpdatedSwipesArray(args.swipes, args.swipeIndex, args.content);
  const hasNewReasoning = typeof args.reasoningText === "string" && args.reasoningText.length > 0;
  const shouldWriteSwipeReasoning = hasNewReasoning || Boolean(args.clearReasoningSlot);
  let swipeReasoning;
  if (shouldWriteSwipeReasoning) {
    swipeReasoning = updatedSwipes.map((_, idx) => {
      if (idx === args.swipeIndex) {
        return hasNewReasoning ? { text: args.reasoningText } : null;
      }
      return resolveExistingSwipeReasoningSlot(idx, args.existingExtra, args.existingActiveSwipeId);
    });
  }
  return {
    swipes: updatedSwipes,
    ...args.swipeDates ? { swipe_dates: [...args.swipeDates] } : {},
    ...swipeReasoning ? { swipe_reasoning: swipeReasoning } : {},
    ...args.metadata ? { metadata: args.metadata } : {},
    skipChunkRebuild: true
  };
}

// src/backend/regex-processor.ts
var MAX_REGEX_MATCHES = 5000;
function findTopLevelMacroTokens(input) {
  const tokens = [];
  let depth = 0;
  let tokenStart = -1;
  for (let i = 0;i < input.length; ) {
    if (input[i] === "{" && input[i + 1] === "{") {
      if (depth === 0) {
        tokenStart = i;
      }
      depth += 1;
      i += 2;
      continue;
    }
    if (input[i] === "}" && input[i + 1] === "}" && depth > 0) {
      depth -= 1;
      i += 2;
      if (depth === 0 && tokenStart >= 0) {
        tokens.push({
          start: tokenStart,
          end: i,
          value: input.slice(tokenStart, i)
        });
        tokenStart = -1;
      }
      continue;
    }
    i += 1;
  }
  return tokens;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function joinSections(first, second) {
  if (!first)
    return second;
  if (!second)
    return first;
  if (first.endsWith(`
`) || second.startsWith(`
`)) {
    return first + second;
  }
  return `${first}
${second}`;
}
function extractMatchActions(script) {
  const actions = new Set;
  const raw = script.metadata?.match_actions ?? script.actions;
  const addIfValid = (item) => {
    if (item === "move_top" || item === "move_bottom" || item === "repeat_back") {
      actions.add(item);
    }
  };
  if (typeof raw === "string") {
    addIfValid(raw);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        addIfValid(item);
      } else if (item && typeof item === "object") {
        const typeVal = item.type ?? item.action;
        addIfValid(typeVal);
      }
    }
  } else if (raw && typeof raw === "object") {
    const obj = raw;
    if (obj.move_top === true)
      actions.add("move_top");
    if (obj.move_bottom === true)
      actions.add("move_bottom");
    if (obj.repeat_back === true)
      actions.add("repeat_back");
  }
  return actions;
}
async function resolveFindRegex(findRegex, mode, resolveMacros) {
  if (!resolveMacros || mode === "none") {
    return findRegex;
  }
  if (mode === "escaped") {
    const tokens = findTopLevelMacroTokens(findRegex);
    if (tokens.length === 0) {
      return findRegex;
    }
    let lastIndex = 0;
    let out = "";
    for (const token of tokens) {
      out += findRegex.slice(lastIndex, token.start);
      const resolved = await resolveMacros(token.value);
      out += escapeRegExp(resolved);
      lastIndex = token.end;
    }
    out += findRegex.slice(lastIndex);
    return out;
  }
  return resolveMacros(findRegex);
}
async function resolveEscapedReplaceTemplate(replaceString, resolveMacros) {
  if (!resolveMacros || !replaceString.includes("{{")) {
    return replaceString;
  }
  const tokens = findTopLevelMacroTokens(replaceString);
  if (tokens.length === 0) {
    return replaceString;
  }
  let lastIndex = 0;
  let out = "";
  for (const token of tokens) {
    out += replaceString.slice(lastIndex, token.start);
    if (token.value === "{{match}}") {
      out += "{{match}}";
    } else {
      const resolved = await resolveMacros(token.value);
      out += resolved.replace(/\$/g, "$$$$");
    }
    lastIndex = token.end;
  }
  out += replaceString.slice(lastIndex);
  return out;
}
function expandReplacementTemplate(template, match, trimmedMatch, fullText) {
  const withMatch = template.includes("{{match}}") ? template.replaceAll("{{match}}", () => trimmedMatch) : template;
  return withMatch.replace(/\$(?:\$|&|`|'|<([^>]+)>|(\d{1,2}))/g, (token, groupName, groupNum) => {
    if (token === "$$")
      return "$";
    if (token === "$&")
      return match[0];
    if (token === "$`")
      return fullText.slice(0, match.index);
    if (token === "$'")
      return fullText.slice(match.index + match[0].length);
    if (groupName !== undefined) {
      return match.groups?.[groupName] ?? "";
    }
    if (groupNum !== undefined) {
      const idx = Number.parseInt(groupNum, 10);
      if (idx >= 1 && idx < match.length) {
        return match[idx] ?? "";
      }
      return token;
    }
    return token;
  });
}
async function fetchActiveRegexScripts(spindle2, options) {
  if (!spindle2.permissions?.has?.("regex_scripts")) {
    return [];
  }
  const regexApi = spindle2.regex_scripts;
  if (!regexApi || typeof regexApi.getActive !== "function") {
    return [];
  }
  try {
    const scripts = await regexApi.getActive({
      target: options.target,
      ...options.characterId ? { characterId: options.characterId } : {},
      ...options.chatId ? { chatId: options.chatId } : {},
      ...options.userId ? { userId: options.userId } : {}
    });
    return Array.isArray(scripts) ? scripts : [];
  } catch (error) {
    spindle2.log?.warn?.(`[GuidedGenerations] Failed fetching active regex scripts (${options.target}): ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
async function applyRegexScripts(text, scripts, placement, depth, options = {}) {
  if (!scripts || scripts.length === 0) {
    return text;
  }
  let current = text;
  for (const script of scripts) {
    if (!script || script.disabled)
      continue;
    if (!Array.isArray(script.placement) || !script.placement.includes(placement)) {
      continue;
    }
    if (typeof script.min_depth === "number" && Number.isFinite(script.min_depth) && depth < script.min_depth) {
      continue;
    }
    if (typeof script.max_depth === "number" && Number.isFinite(script.max_depth) && depth > script.max_depth) {
      continue;
    }
    if (!script.find_regex) {
      continue;
    }
    const resolvedFindRegex = await resolveFindRegex(script.find_regex, script.substitute_macros, options.resolveMacros);
    let regex;
    try {
      regex = new RegExp(resolvedFindRegex, script.flags ?? "");
    } catch {
      continue;
    }
    const baseReplaceTemplate = script.substitute_macros === "escaped" ? await resolveEscapedReplaceTemplate(script.replace_string ?? "", options.resolveMacros) : script.replace_string ?? "";
    const actions = extractMatchActions(script);
    const moveTop = actions.has("move_top");
    const moveBottom = actions.has("move_bottom");
    const repeatBack = actions.has("repeat_back");
    const trimStrings = Array.isArray(script.trim_strings) ? script.trim_strings : [];
    const matches = [];
    let execResult;
    while ((execResult = regex.exec(current)) !== null) {
      let trimmedMatch = execResult[0];
      for (const trim of trimStrings) {
        if (typeof trim === "string" && trim.length > 0) {
          trimmedMatch = trimmedMatch.split(trim).join("");
        }
      }
      let replacement = expandReplacementTemplate(baseReplaceTemplate, execResult, trimmedMatch, current);
      if ((script.substitute_macros === "raw" || script.substitute_macros === "after") && options.resolveMacros) {
        replacement = await options.resolveMacros(replacement);
      }
      const movedValue = replacement.length > 0 ? replacement : trimmedMatch;
      matches.push({
        index: execResult.index,
        length: execResult[0].length,
        replacement,
        movedValue
      });
      if (matches.length >= MAX_REGEX_MATCHES) {
        break;
      }
      if (!regex.global && !regex.sticky) {
        break;
      }
      if (execResult[0].length === 0) {
        if (regex.lastIndex >= current.length) {
          break;
        }
        const cp = current.codePointAt(regex.lastIndex);
        regex.lastIndex += cp !== undefined && cp > 65535 ? 2 : 1;
      }
    }
    if (matches.length === 0) {
      continue;
    }
    let rebuilt = "";
    let cursor = 0;
    const movedChunks = [];
    for (const m of matches) {
      rebuilt += current.slice(cursor, m.index);
      if (moveTop || moveBottom) {
        if (repeatBack) {
          rebuilt += m.replacement;
        }
        if (m.movedValue) {
          movedChunks.push(m.movedValue);
        }
      } else {
        rebuilt += m.replacement;
        if (repeatBack && m.movedValue) {
          movedChunks.push(m.movedValue);
        }
      }
      cursor = m.index + m.length;
    }
    rebuilt += current.slice(cursor);
    if (moveTop && movedChunks.length > 0) {
      rebuilt = joinSections(movedChunks.join(`
`), rebuilt);
    }
    if ((moveBottom || repeatBack) && movedChunks.length > 0) {
      rebuilt = joinSections(rebuilt, movedChunks.join(`
`));
    }
    for (const trim of trimStrings) {
      if (typeof trim === "string" && trim.length > 0) {
        while (rebuilt.includes(trim)) {
          rebuilt = rebuilt.replaceAll(trim, "");
        }
      }
    }
    current = rebuilt;
  }
  return current;
}
function healFontTagsAndAttributes(prose) {
  let out = prose.replace(/<font\b([^>]*)>/gi, (_full, attrs) => {
    let fixed = attrs.replace(/(\bcolor\s*=\s*)(["'])([^"'\s>]+)(?=\s+[a-zA-Z_-]+\s*=|\s*$)/gi, "$1$2$3$2");
    fixed = fixed.replace(/(\bcolor\s*=\s*)(["'])([^"'=>]+)$/i, "$1$2$3$2");
    return `<font${fixed}>`;
  });
  out = out.replace(/(["\u201C])(<font\b[^>]*>)([^<\n]*?)(["\u201D])(<\/font>)/gi, (_m, openQ, openTag, inner, closeQ, closeTag) => {
    const pairs = openQ === '"' && closeQ === '"' || openQ === "\u201C" && (closeQ === "\u201D" || closeQ === '"');
    return pairs ? `${openQ}${openTag}${inner}${closeTag}${closeQ}` : _m;
  });
  out = out.replace(/(<font\b[^>]*>)(["\u201C])([^<\n]*?)(<\/font>)(["\u201D])/gi, (_m, openTag, openQ, inner, closeTag, closeQ) => {
    const pairs = openQ === '"' && closeQ === '"' || openQ === "\u201C" && (closeQ === "\u201D" || closeQ === '"');
    return pairs ? `${openTag}${openQ}${inner}${closeQ}${closeTag}` : _m;
  });
  out = out.replace(/(<font\b[^>]*>)[ \t]*((?:["\u201C])[^<\n]*?(?:["\u201D]))[ \t]*(<\/font>)/gi, "$1$2$3");
  const fontTokenRe = /(<\/?font\b[^>]*>|\n\n)/gi;
  const closeInsertOffsets = [];
  let openStack = [];
  let tokenMatch;
  const findLineEnd = (fromIndex) => {
    const nl = out.indexOf(`
`, fromIndex);
    return nl === -1 ? out.length : nl;
  };
  while ((tokenMatch = fontTokenRe.exec(out)) !== null) {
    const token = tokenMatch[0];
    if (token === `

`) {
      while (openStack.length > 0) {
        const entry = openStack.pop();
        closeInsertOffsets.push(Math.min(entry.lineEndOffset, tokenMatch.index));
      }
      continue;
    }
    if (/^<\/font/i.test(token)) {
      if (openStack.length > 0) {
        openStack.pop();
      }
    } else if (!/\/>$/.test(token)) {
      while (openStack.length > 0 && openStack[openStack.length - 1].lineEndOffset < tokenMatch.index) {
        const prev = openStack.pop();
        closeInsertOffsets.push(prev.lineEndOffset);
      }
      openStack.push({
        endOffset: tokenMatch.index + token.length,
        lineEndOffset: findLineEnd(tokenMatch.index + token.length)
      });
    }
  }
  while (openStack.length > 0) {
    openStack.pop();
    closeInsertOffsets.push(out.length);
  }
  if (closeInsertOffsets.length > 0) {
    closeInsertOffsets.sort((a, b) => a - b);
    let rebuilt = "";
    let cursor = 0;
    for (const offset of closeInsertOffsets) {
      rebuilt += out.slice(cursor, offset) + "</font>";
      cursor = offset;
    }
    rebuilt += out.slice(cursor);
    out = rebuilt;
  }
  return out;
}
function trimInnerWhitespaceInPairs(line, openChar, closeChar) {
  const positions = [];
  let inTag = false;
  for (let i = 0;i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">" && inTag) {
      inTag = false;
      continue;
    }
    if (!inTag && ch === openChar && (i === 0 || line[i - 1] !== "\\")) {
      positions.push(i);
    }
  }
  if (openChar === closeChar) {
    if (positions.length < 2 || positions.length % 2 !== 0) {
      return line;
    }
    let out = "";
    let cursor = 0;
    for (let i = 0;i < positions.length; i += 2) {
      const start = positions[i];
      const end = positions[i + 1];
      const inner = line.slice(start + 1, end);
      const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
      out += line.slice(cursor, start + 1);
      out += trimmed.length > 0 ? trimmed : inner;
      out += closeChar;
      cursor = end + 1;
    }
    out += line.slice(cursor);
    return out;
  }
  return line;
}
function trimEmphasisOnLine(line) {
  let out = line;
  out = out.replace(/(^|[^\S\r\n]|[\(\["'\u201C\u2018>])(\*{2,3})[ \t]+([^\n]*?\S)[ \t]*\2(?=$|[\s.,!?;:'"\u201D\u2019\)\]<])/g, (full, prefix, marker, inner) => inner.includes(marker) ? full : `${prefix}${marker}${inner}${marker}`);
  out = out.replace(/(^|[^\S\r\n]|[\(\["'\u201C\u2018>])(\*{2,3})(\S[^\n]*?)[ \t]+\2(?=$|[\s.,!?;:'"\u201D\u2019\)\]<])/g, (full, prefix, marker, inner) => inner.includes(marker) ? full : `${prefix}${marker}${inner}${marker}`);
  out = out.replace(/(^|[^\w_\\])__[ \t]+([^_\n]*?\S)[ \t]*__(?!\w|_)/g, "$1__$2__");
  out = out.replace(/(^|[^\w_\\])__(\S[^_\n]*?)[ \t]+__(?!\w|_)/g, "$1__$2__");
  const singleStarIndices = [];
  for (let i = 0;i < out.length; i += 1) {
    if (out[i] === "*" && out[i - 1] !== "*" && out[i + 1] !== "*" && out[i - 1] !== "\\") {
      singleStarIndices.push(i);
    }
  }
  const isBulletWithOddStars = /^[ \t]*\*[ \t]+/.test(out) && singleStarIndices.length % 2 === 1;
  if (!isBulletWithOddStars && singleStarIndices.length >= 2) {
    out = out.replace(/(^|[^\w*\\])\*[ \t]+([^*\n]*?\S)[ \t]*\*(?!\*)/g, (full, prefix, inner, offset) => {
      const before = out.slice(0, offset + prefix.length);
      const afterStart = offset + full.length;
      const after = out.slice(afterStart);
      if (/\d\s+$/.test(before) && /^\s+\d/.test(after) && /^\d+$/.test(inner.trim())) {
        return full;
      }
      return `${prefix}*${inner}*`;
    });
    out = out.replace(/(^|[^\w*\\])\*([^\s*\n][^*\n]*?)[ \t]+\*(?!\*)/g, "$1*$2*");
  }
  out = out.replace(/(^|[^\w_\\])_[ \t]+([^_\n]*?\S)[ \t]*_(?!\w|_)/g, "$1_$2_");
  out = out.replace(/(^|[^\w_\\])_([^\s_\n][^_\n]*?)[ \t]+_(?!\w|_)/g, "$1_$2_");
  return out;
}
function healProseSegment(prose) {
  let out = healFontTagsAndAttributes(prose);
  out = out.replace(/\u201C[ \t]*([^\u201D\n]*?\S)[ \t]*\u201D/g, "\u201C$1\u201D");
  out = out.replace(/\u2018[ \t]*([^\u2019\n]*?\S)[ \t]*\u2019/g, "\u2018$1\u2019");
  const lines = out.split(`
`);
  for (let i = 0;i < lines.length; i += 1) {
    let line = lines[i];
    line = trimInnerWhitespaceInPairs(line, '"', '"');
    line = trimEmphasisOnLine(line);
    lines[i] = line;
  }
  return lines.join(`
`);
}
function healFormattingArtifacts(text) {
  if (!text || typeof text !== "string") {
    return text;
  }
  const protectedRe = /(```[\s\S]*?```|~~~[\s\S]*?~~~|<json\b[^>]*>[\s\S]*?<\/json>|(`+)[^\n]*?\2)/gi;
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = protectedRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result += healProseSegment(text.slice(lastIndex, match.index));
    }
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    result += healProseSegment(text.slice(lastIndex));
  }
  return result;
}
async function processResponseOutput(options) {
  const processedContent = healFormattingArtifacts(await applyRegexScripts(options.content, options.scripts, "ai_output", 0, {
    resolveMacros: options.resolveMacros
  }));
  let processedReasoning = options.reasoning;
  if (typeof options.reasoning === "string" && options.reasoning.length > 0) {
    processedReasoning = healFormattingArtifacts(await applyRegexScripts(options.reasoning, options.scripts, "reasoning", 0, {
      resolveMacros: options.resolveMacros
    }));
  }
  return {
    content: processedContent,
    ...processedReasoning !== undefined ? { reasoning: processedReasoning } : {}
  };
}

// src/backend/generation-metrics.ts
function resolveGenerationTokenCounts(providerCompletionTokenCount, calculatedTokenCounts = {}, options = {}) {
  const flooredProviderCount = typeof providerCompletionTokenCount === "number" && Number.isFinite(providerCompletionTokenCount) && providerCompletionTokenCount > 0 ? Math.floor(providerCompletionTokenCount) : undefined;
  const normalizedProviderCount = flooredProviderCount != null && flooredProviderCount > 0 ? flooredProviderCount : undefined;
  const details = options.providerRaw?.completion_tokens_details ?? options.providerRaw?.output_tokens_details ?? options.usageDetailsContainer?.completion_tokens_details ?? options.usageDetailsContainer?.output_tokens_details;
  const reasoningTokenCount = typeof details === "object" && details !== null ? details.reasoning_tokens ?? details.thinking_tokens : undefined;
  let providerResponseTokenCount;
  if (!options.hasDelimitedReasoning) {
    if (normalizedProviderCount != null && typeof reasoningTokenCount === "number" && Number.isInteger(reasoningTokenCount) && reasoningTokenCount >= 0 && reasoningTokenCount <= normalizedProviderCount) {
      providerResponseTokenCount = normalizedProviderCount - reasoningTokenCount;
    } else if (!options.hasReasoning && reasoningTokenCount == null) {
      providerResponseTokenCount = normalizedProviderCount;
    }
  }
  return {
    messageTokenCount: normalizedProviderCount ?? calculatedTokenCounts.messageTokenCount,
    responseTokenCount: providerResponseTokenCount ?? calculatedTokenCounts.responseTokenCount
  };
}
function calculateGenerationTimingMetrics(source, responseTokenCount, observedAt = Date.now()) {
  const wasStreaming = source.wasStreaming ?? true;
  const streamStart = source.streamingStartedAt;
  const responseEndedAt = source.completedAt ?? observedAt;
  const durationMs = streamStart ? Math.max(0, responseEndedAt - streamStart) : 0;
  let ttft;
  let tps;
  if (wasStreaming && streamStart) {
    if (source.firstTokenAt != null) {
      ttft = Math.max(0, source.firstTokenAt - streamStart);
    }
    if (source.firstContentTokenAt != null && source.responseStoppedAt != null && responseTokenCount && responseTokenCount > 1) {
      const responseDurationSec = (source.responseStoppedAt - source.firstContentTokenAt) / 1000;
      if (responseDurationSec > 0) {
        tps = Math.round(responseTokenCount / responseDurationSec * 10) / 10;
      }
    }
  }
  return {
    durationMs,
    wasStreaming,
    ...ttft != null ? { ttft } : {},
    ...tps != null ? { tps } : {}
  };
}
async function safeCountTokens(spindle2, text, options) {
  if (!text || text.length === 0) {
    return;
  }
  const countText = spindle2.tokens?.countText;
  if (typeof countText !== "function") {
    return;
  }
  const dtoOptions = {
    ...options?.model ? { model: options.model } : {},
    ...options?.userId ? { userId: options.userId } : {}
  };
  try {
    const result = await countText.call(spindle2.tokens, text, Object.keys(dtoOptions).length > 0 ? dtoOptions : undefined);
    if (typeof result?.total_tokens === "number" && Number.isFinite(result.total_tokens) && result.total_tokens > 0) {
      const floored = Math.floor(result.total_tokens);
      return floored > 0 ? floored : undefined;
    }
    return;
  } catch {
    return;
  }
}
async function resolvePresetNameSafe(spindle2, presetId, userId) {
  const trimmedId = typeof presetId === "string" ? presetId.trim() : "";
  if (!trimmedId) {
    return;
  }
  if (spindle2.permissions?.has && !spindle2.permissions.has("presets")) {
    return;
  }
  const getPreset = spindle2.presets?.get;
  if (typeof getPreset !== "function") {
    return;
  }
  try {
    const preset = await getPreset.call(spindle2.presets, trimmedId, userId);
    const name = typeof preset?.name === "string" ? preset.name.trim() : "";
    return name || undefined;
  } catch {
    return;
  }
}
async function buildGenerationMetricsPayload(args) {
  const wasStreaming = args.timingSource.wasStreaming ?? true;
  const countOptions = {
    ...args.model ? { model: args.model } : {},
    ...args.userId ? { userId: args.userId } : {}
  };
  let resolvedTokenCount;
  let responseTokenCount;
  if (args.isContinue) {
    const calculatedMessageTokenCount = args.finalText.length > 0 ? await safeCountTokens(args.spindle, args.finalText, countOptions) : undefined;
    let calculatedResponseTokenCount;
    if (wasStreaming && /\S/.test(args.rawDeltaText)) {
      if (args.rawDeltaText === args.finalText) {
        calculatedResponseTokenCount = calculatedMessageTokenCount;
      } else {
        calculatedResponseTokenCount = await safeCountTokens(args.spindle, args.rawDeltaText, countOptions);
      }
    }
    resolvedTokenCount = calculatedMessageTokenCount;
    responseTokenCount = calculatedResponseTokenCount;
  } else {
    const tokenCountOptions = {
      hasReasoning: args.hasReasoning,
      hasDelimitedReasoning: args.hasDelimitedReasoning,
      providerRaw: args.usage?.provider_raw,
      usageDetailsContainer: args.usage
    };
    const providerTokenCounts = resolveGenerationTokenCounts(args.usage?.completion_tokens, undefined, tokenCountOptions);
    let calculatedMessageTokenCount;
    if (providerTokenCounts.messageTokenCount == null && args.finalText.length > 0) {
      calculatedMessageTokenCount = await safeCountTokens(args.spindle, args.finalText, countOptions);
    }
    let calculatedResponseTokenCount;
    if (wasStreaming && providerTokenCounts.responseTokenCount == null && /\S/.test(args.rawDeltaText)) {
      if (providerTokenCounts.messageTokenCount == null && args.rawDeltaText === args.finalText) {
        calculatedResponseTokenCount = calculatedMessageTokenCount;
      } else {
        calculatedResponseTokenCount = await safeCountTokens(args.spindle, args.rawDeltaText, countOptions);
      }
    }
    const resolved = resolveGenerationTokenCounts(args.usage?.completion_tokens, {
      messageTokenCount: calculatedMessageTokenCount,
      responseTokenCount: calculatedResponseTokenCount
    }, tokenCountOptions);
    resolvedTokenCount = resolved.messageTokenCount;
    responseTokenCount = resolved.responseTokenCount;
  }
  const timingMetrics = calculateGenerationTimingMetrics(args.timingSource, responseTokenCount);
  const normalizedPresetId = typeof args.presetId === "string" && args.presetId.trim() ? args.presetId.trim() : undefined;
  const resolvedPresetName = (typeof args.presetName === "string" && args.presetName.trim() ? args.presetName.trim() : undefined) ?? (normalizedPresetId ? await resolvePresetNameSafe(args.spindle, normalizedPresetId, args.userId) : undefined);
  const generationMetrics = {
    ...timingMetrics,
    ...args.model ? { model: args.model } : {},
    ...args.provider ? { provider: args.provider } : {},
    ...normalizedPresetId ? { presetId: normalizedPresetId } : {},
    ...resolvedPresetName ? { presetName: resolvedPresetName } : {}
  };
  return {
    ...resolvedTokenCount != null ? { tokenCount: resolvedTokenCount } : {},
    generationMetrics
  };
}

// src/backend/generation-runner.ts
var STREAM_FLUSH_INTERVAL_MS = 120;
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

class GuidedGenerationRunner {
  spindle;
  store;
  emitFrontend;
  activeRuns = new Map;
  pendingUsers = new Map;
  interceptorDisposer = null;
  pendingDryRunCaptures = new Map;
  chatDryRunQueues = new Map;
  constructor(spindle2, store, emitFrontend) {
    this.spindle = spindle2;
    this.store = store;
    this.emitFrontend = emitFrontend;
  }
  dispose() {
    if (this.interceptorDisposer) {
      this.interceptorDisposer();
      this.interceptorDisposer = null;
    }
  }
  ensureInterceptorRegistered() {
    if (this.interceptorDisposer)
      return;
    if (!this.spindle.permissions?.has?.("interceptor"))
      return;
    if (typeof this.spindle.registerInterceptor !== "function")
      return;
    this.interceptorDisposer = this.spindle.registerInterceptor(async (messages, context) => {
      if (this.spindle.permissions?.has && !this.spindle.permissions.has("interceptor")) {
        return messages;
      }
      const isDryRun = Boolean(context.dryRun || context.isDryRun);
      if (!isDryRun) {
        return messages;
      }
      const pending = this.pendingDryRunCaptures.get(context.chatId);
      if (pending) {
        pending.capturedMessages = messages.map((m) => ({
          ...m
        }));
      }
      return messages;
    });
  }
  enqueueChatDryRun(chatId, task) {
    const prev = this.chatDryRunQueues.get(chatId) ?? Promise.resolve();
    const next = prev.catch(() => {
      return;
    }).then(task);
    const tail = next.catch(() => {
      return;
    });
    this.chatDryRunQueues.set(chatId, tail);
    tail.finally(() => {
      if (this.chatDryRunQueues.get(chatId) === tail) {
        this.chatDryRunQueues.delete(chatId);
      }
    });
    return next;
  }
  async runDryRunWithCapture(chatId, dryRunInput, userId) {
    return this.enqueueChatDryRun(chatId, async () => {
      this.ensureInterceptorRegistered();
      const capture = {};
      this.pendingDryRunCaptures.set(chatId, capture);
      try {
        const result = await this.spindle.generate.dryRun(dryRunInput, userId);
        return { result, capturedMessages: capture.capturedMessages };
      } finally {
        if (this.pendingDryRunCaptures.get(chatId) === capture) {
          this.pendingDryRunCaptures.delete(chatId);
        }
      }
    });
  }
  userKey(userId) {
    return userId && userId.length > 0 ? userId : "__default__";
  }
  getActiveRun(userId) {
    const run = this.activeRuns.get(this.userKey(userId));
    return run ? { ...run.state } : null;
  }
  updateActiveRunState(userId, runId, patch) {
    const active = this.activeRuns.get(this.userKey(userId));
    if (!active || active.state.runId !== runId) {
      return;
    }
    active.state = {
      ...active.state,
      ...patch
    };
    this.emitStatus(userId);
  }
  abortCurrent(userId, runId) {
    const key = this.userKey(userId);
    const run = this.activeRuns.get(key);
    if (run) {
      if (runId && run.state.runId !== runId)
        return false;
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
  async run(input, userId) {
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error("A Guided Generations action is already running. Stop it before starting another.");
    }
    this.assertRequiredPermissions(input.actionId);
    const controller = new AbortController;
    this.pendingUsers.set(key, controller);
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
      const { chatId, characterId } = await this.resolveChatContext(input.chatId, userId);
      runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      if (controller.signal.aborted) {
        return {
          runId,
          actionId: input.actionId,
          chatId,
          aborted: true,
          text: ""
        };
      }
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
      let preverifiedPreset;
      if (input.actionId === "guided_regenerate" && config.presetId && this.spindle.permissions.has("presets")) {
        preverifiedPreset = await this.spindle.presets.get(config.presetId, userId);
        if (!preverifiedPreset) {
          throw new Error("Selected preset for Guided Regenerate no longer exists. Choose another in Settings.");
        }
      }
      const presetContext = input.actionId !== "guided_impersonate" ? await this.resolvePresetContext(config.presetId, chatId, userId, preverifiedPreset) : { presetId: null };
      const resolvedPresetId = presetContext.presetId;
      const metricsPreset = this.resolveMetricsPresetContext(presetContext, config.presetId, resolvedConnection);
      let targetAssistantId = null;
      let preTargetMessage = null;
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
      let createdMessageId;
      let createdSwipeDates;
      let swipeSession = null;
      let handoffToAssistantExecution = false;
      try {
        if (input.actionId === "guided_response") {
          const metadata = resolvedPresetId ? buildPresetContextMetadata(undefined, 0, resolvedPresetId) : undefined;
          const created = await this.spindle.chat.appendMessage(chatId, {
            role: "assistant",
            content: "",
            ...metadata ? { metadata } : {}
          }, { triggerGeneration: false });
          createdMessageId = created.id;
          createdSwipeDates = [Math.floor(Date.now() / 1000)];
          this.updateActiveRunState(userId, runId, {
            messageId: created.id,
            swipeId: 0
          });
        } else if (input.actionId === "guided_regenerate") {
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
          if (controller.signal.aborted) {
            if (regeneratedSnapshot) {
              await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, undefined, userId);
            }
            return {
              runId,
              actionId: input.actionId,
              chatId,
              aborted: true,
              text: ""
            };
          }
          const metadata = resolvedPresetId ? buildPresetContextMetadata(undefined, 0, resolvedPresetId) : undefined;
          const created = await this.spindle.chat.appendMessage(chatId, {
            role: "assistant",
            content: "",
            ...metadata ? { metadata } : {}
          }, { triggerGeneration: false });
          createdMessageId = created.id;
          createdSwipeDates = [Math.floor(Date.now() / 1000)];
          this.updateActiveRunState(userId, runId, {
            messageId: created.id,
            swipeId: 0
          });
        } else if (input.actionId === "guided_continue" && preTargetMessage) {
          const { activeIndex } = normalizeMessageSwipes(preTargetMessage);
          this.updateActiveRunState(userId, runId, {
            messageId: preTargetMessage.id,
            swipeId: activeIndex
          });
          if (resolvedPresetId && !hasPresetContextForSwipe(preTargetMessage.metadata, activeIndex)) {
            const metadata = buildPresetContextMetadata(preTargetMessage.metadata, activeIndex, resolvedPresetId);
            await this.spindle.chat.updateMessage(chatId, preTargetMessage.id, {
              metadata,
              skipChunkRebuild: true
            });
          }
        } else if (input.actionId === "guided_swipe" && preTargetMessage) {
          const backgroundSwipe = input.backgroundSwipe === true;
          swipeSession = this.createGuidedSwipeSession(chatId, preTargetMessage);
          const metadata = resolvedPresetId ? buildPresetContextMetadata(preTargetMessage.metadata, swipeSession.newSwipeIndex, resolvedPresetId) : undefined;
          const seqBeforeWrite = swipeSession.getSwipeEventSeq();
          if (!backgroundSwipe) {
            await this.spindle.chat.updateMessage(chatId, swipeSession.targetAssistantId, buildActiveSwipePatch({
              swipes: swipeSession.swipes,
              swipeIndex: swipeSession.newSwipeIndex,
              content: "",
              swipeDates: swipeSession.swipeDates,
              ...metadata ? { metadata } : {},
              skipChunkRebuild: true
            }));
            if (swipeSession.getSwipeEventSeq() === seqBeforeWrite && swipeSession.getCurrentViewedSwipeId() === swipeSession.initialSwipeId) {
              swipeSession.setCurrentViewedSwipeId(swipeSession.newSwipeIndex);
            }
          } else {
            await this.spindle.chat.updateMessage(chatId, swipeSession.targetAssistantId, buildBackgroundSwipePatch({
              swipes: swipeSession.swipes,
              swipeIndex: swipeSession.newSwipeIndex,
              content: "",
              swipeDates: swipeSession.swipeDates,
              ...metadata ? { metadata } : {}
            }));
          }
          this.updateActiveRunState(userId, runId, {
            messageId: swipeSession.targetAssistantId,
            swipeId: swipeSession.newSwipeIndex,
            backgroundSwipe
          });
        }
        const dryRunCapture = await this.runDryRunWithCapture(chatId, dryRunInput, userId);
        const dryRunResult = dryRunCapture.result;
        const capturedMessages = dryRunCapture.capturedMessages;
        if (controller.signal.aborted) {
          if (regeneratedSnapshot) {
            await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, createdMessageId, userId);
          }
          return {
            runId,
            actionId: input.actionId,
            chatId,
            aborted: true,
            ...input.actionId === "guided_response" && createdMessageId ? { messageId: createdMessageId, swipeId: 0 } : input.actionId === "guided_swipe" && swipeSession ? { messageId: swipeSession.targetAssistantId, swipeId: swipeSession.newSwipeIndex } : {},
            text: ""
          };
        }
        const {
          rawInput,
          transformResponseOutput,
          transformImpersonateOutput
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
          targetAssistantId
        });
        switch (input.actionId) {
          case "guided_response":
          case "guided_regenerate":
            handoffToAssistantExecution = true;
            return await this.executeAssistantResponse(input.actionId, runId, chatId, createdMessageId, createdSwipeDates, rawInput, controller.signal, regeneratedSnapshot, transformResponseOutput, userId, metricsPreset);
          case "guided_continue":
            return await this.executeGuidedContinue(runId, chatId, targetAssistantId, input.inputText, rawInput, controller.signal, userId, transformResponseOutput, metricsPreset);
          case "guided_swipe":
            return await this.executeGuidedSwipe(runId, chatId, swipeSession, rawInput, controller.signal, transformResponseOutput, userId, metricsPreset);
          case "guided_impersonate":
            return await this.executeImpersonate(runId, chatId, rawInput, controller.signal, userId, transformImpersonateOutput);
          default: {
            const exhaustive = input.actionId;
            throw new Error(`Unsupported Guided Generations action: ${String(exhaustive)}`);
          }
        }
      } catch (error) {
        if (!handoffToAssistantExecution && regeneratedSnapshot) {
          await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, createdMessageId, userId);
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
  async removeLastContinue(input = {}, userId) {
    if (!this.spindle.permissions.has("chats")) {
      throw new Error("Missing required 'chats' permission for Guided Generations.");
    }
    if (!this.spindle.permissions.has("chat_mutation")) {
      throw new Error("Missing required 'chat_mutation' permission for Guided Generations.");
    }
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error("A Guided Generations action is already running. Stop it before removing a continue.");
    }
    const pendingController = new AbortController;
    this.pendingUsers.set(key, pendingController);
    try {
      const { chatId } = await this.resolveChatContext(input.chatId, userId);
      const target = await this.requireLastAssistantMessage(chatId);
      const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(target);
      const currentText = swipes[activeIndex] ?? target.content ?? "";
      const entry = await this.store.peekContinueEntry(chatId, target.id, activeIndex, userId);
      if (!entry) {
        throw new Error("No continue history found for the current swipe.");
      }
      const isCompatibleText = currentText === entry.resultText || entry.baseText.length > 0 && currentText.startsWith(entry.baseText);
      if (!isCompatibleText) {
        throw new Error("The message was edited after the last continue; cannot safely remove it.");
      }
      await this.spindle.chat.updateMessage(chatId, target.id, buildActiveSwipePatch({
        swipes,
        swipeIndex: activeIndex,
        content: entry.baseText,
        swipeDates,
        reasoningText: entry.baseReasoning,
        reasoningDuration: entry.baseReasoningDuration,
        skipChunkRebuild: false
      }));
      await this.store.popContinueEntry(chatId, target.id, activeIndex, entry.id, userId);
      const restoredTokenCount = entry.baseText.length > 0 ? await safeCountTokens(this.spindle, entry.baseText, userId ? { userId } : undefined) : undefined;
      this.emitFrontend({
        type: "gg:generation_metrics",
        chatId,
        messageId: target.id,
        swipeId: activeIndex,
        tokenCount: restoredTokenCount ?? null,
        generationMetrics: null
      }, userId);
      return {
        removed: true,
        messageId: target.id,
        swipeIndex: activeIndex,
        text: entry.baseText
      };
    } finally {
      if (this.pendingUsers.get(key) === pendingController) {
        this.pendingUsers.delete(key);
      }
    }
  }
  async regenerateLastContinue(input = {}, userId) {
    const key = this.userKey(userId);
    if (this.activeRuns.has(key) || this.pendingUsers.has(key)) {
      throw new Error("A Guided Generations action is already running. Stop it before starting another.");
    }
    this.assertRequiredPermissions("guided_continue");
    const controller = new AbortController;
    this.pendingUsers.set(key, controller);
    let runId;
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
          text: ""
        };
      }
      const target = await this.requireLastAssistantMessage(chatId);
      const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(target);
      const currentText = swipes[activeIndex] ?? target.content ?? "";
      const entry = await this.store.peekContinueEntry(chatId, target.id, activeIndex, userId);
      if (!entry) {
        throw new Error("No continue history found for the current swipe.");
      }
      const isCompatibleText = currentText === entry.resultText || entry.baseText.length > 0 && currentText.startsWith(entry.baseText);
      if (!isCompatibleText) {
        throw new Error("The message was edited after the last continue; cannot safely regenerate it.");
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
          text: currentText
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
        metadata: target.metadata ? this.cloneRecord(target.metadata) : undefined
      };
      const activeRunId = runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this.activeRuns.set(key, {
        state: {
          runId: activeRunId,
          actionId: "guided_continue",
          chatId,
          startedAt: Date.now()
        },
        controller
      });
      this.pendingUsers.delete(key);
      this.emitStatus(userId);
      this.updateActiveRunState(userId, activeRunId, {
        messageId: target.id,
        swipeId: activeIndex
      });
      const resolvedConnection = await this.resolveConnection(config.connectionId, input.activeConnectionId, userId);
      const connectionId = resolvedConnection?.id;
      const presetContext = await this.resolvePresetContext(config.presetId, chatId, userId);
      const resolvedPresetId = presetContext.presetId;
      const metricsPreset = this.resolveMetricsPresetContext(presetContext, config.presetId, resolvedConnection);
      if (controller.signal.aborted) {
        return {
          runId,
          actionId: "guided_continue",
          chatId,
          aborted: true,
          messageId: preRegen.messageId,
          swipeId: preRegen.swipeIndex,
          text: preRegen.text
        };
      }
      const metadata = resolvedPresetId && !hasPresetContextForSwipe(target.metadata, activeIndex) ? buildPresetContextMetadata(target.metadata, activeIndex, resolvedPresetId) : undefined;
      await this.spindle.chat.updateMessage(chatId, target.id, buildActiveSwipePatch({
        swipes,
        swipeIndex: activeIndex,
        content: entry.baseText,
        swipeDates,
        reasoningText: entry.baseReasoning,
        reasoningDuration: entry.baseReasoningDuration,
        ...metadata ? { metadata } : {},
        skipChunkRebuild: true
      }));
      let hadStreamOutput = false;
      try {
        const dryRunInput = buildDryRunInput({
          chatId,
          actionId: "guided_continue",
          config,
          activeConnectionId: connectionId
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
            text: preRegen.text
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
          targetAssistantId: target.id
        });
        const streamRes = await this.streamIntoMessage(chatId, rawInput, controller.signal, async () => {
          const latest = await this.readTargetMessageOrThrow(chatId, target.id);
          const latestNorm = normalizeMessageSwipes(latest);
          return {
            messageId: latest.id,
            swipes: latestNorm.swipes,
            swipeIndex: activeIndex,
            swipeDates: latestNorm.swipeDates,
            baseText: entry.baseText
          };
        }, async (current) => this.refreshSwipeTarget(chatId, current), transformResponseOutput, undefined, () => {
          hadStreamOutput = true;
        }, async ({ finalText }) => {
          await this.store.replaceTopContinueEntry(chatId, target.id, activeIndex, entry.id, {
            chatId,
            messageId: target.id,
            swipeIndex: activeIndex,
            baseText: entry.baseText,
            resultText: finalText,
            baseReasoning: entry.baseReasoning,
            baseReasoningDuration: entry.baseReasoningDuration,
            inputText: entry.inputText
          }, userId);
        }, () => {
          this.updateActiveRunState(userId, activeRunId, { hasContentOutput: true });
        });
        if (!streamRes.hasOutput) {
          await this.restorePreRegenMessage(chatId, preRegen);
          return {
            runId,
            actionId: "guided_continue",
            chatId,
            aborted: streamRes.aborted,
            messageId: preRegen.messageId,
            swipeId: preRegen.swipeIndex,
            text: preRegen.text
          };
        }
        await this.store.replaceTopContinueEntry(chatId, target.id, activeIndex, entry.id, {
          chatId,
          messageId: target.id,
          swipeIndex: activeIndex,
          baseText: entry.baseText,
          resultText: streamRes.finalText,
          baseReasoning: entry.baseReasoning,
          baseReasoningDuration: entry.baseReasoningDuration,
          inputText: entry.inputText
        }, userId);
        await this.emitMetricsForCompletedStream({
          chatId,
          userId,
          streamRes,
          isContinue: true,
          model: rawInput.model,
          provider: rawInput.provider,
          presetId: metricsPreset.presetId,
          presetName: metricsPreset.presetName
        });
        return {
          runId,
          actionId: "guided_continue",
          chatId,
          aborted: streamRes.aborted,
          messageId: streamRes.messageId ?? target.id,
          swipeId: streamRes.swipeId ?? activeIndex,
          text: streamRes.finalText
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
  async prepareRawGenerationInput(args) {
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
      targetAssistantId
    } = args;
    const { model, provider } = resolveEffectiveModelAndProvider({
      configuredModel: config.model,
      connectionModel: resolvedConnection?.model,
      connectionProvider: resolvedConnection?.provider,
      dryRunModel: dryRunResult.model,
      dryRunProvider: dryRunResult.provider
    });
    const rawAssembled = this.mergeDryRunAndCapturedMessages(dryRunResult, capturedMessages);
    let isChatHistory = resolveChatHistoryFlags(rawAssembled, {
      breakdown: dryRunResult.breakdown
    });
    if (!isChatHistory) {
      const effectivePresetId = config.presetId ?? resolvedConnection?.preset_id ?? null;
      const presetBlocks = await this.fetchPresetBlocksFallback(effectivePresetId, userId);
      if (presetBlocks && presetBlocks.length > 0) {
        isChatHistory = resolveChatHistoryFlags(rawAssembled, {
          breakdown: dryRunResult.breakdown,
          presetBlocks
        });
      }
    }
    let assembledMessages = rawAssembled;
    if (actionId === "guided_response" || actionId === "guided_regenerate") {
      const stripped = stripCreatedBlankAssistantTurnWithHistory(rawAssembled, createdMessageId, isChatHistory);
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    } else if (actionId === "guided_swipe") {
      const stripped = stripRejectedSwipeAssistantTurnWithHistory(rawAssembled, targetAssistantId, isChatHistory);
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    }
    const resolveMacros = this.createRegexMacroResolver(chatId, characterId, userId);
    const resolvedTemplate = await this.resolveInstructionTemplate(config.instructionTemplate, { chatId, characterId, userId });
    let guidanceText = formatGuidanceText(resolvedTemplate, inputText, {
      allowTemplateWithoutInput: actionId === "guided_impersonate"
    });
    let responseScripts = [];
    if (config.applyRegex) {
      const [promptScripts, fetchedResponseScripts] = await Promise.all([
        guidanceText !== null ? fetchActiveRegexScripts(this.spindle, {
          target: "prompt",
          characterId,
          chatId,
          userId
        }) : Promise.resolve([]),
        fetchActiveRegexScripts(this.spindle, {
          target: "response",
          characterId,
          chatId,
          userId
        })
      ]);
      responseScripts = fetchedResponseScripts;
      if (guidanceText !== null && promptScripts.length > 0) {
        const effectiveDepth = computeEffectiveGuidanceDepth(config.guidancePosition, config.guidanceDepth, isChatHistory);
        const placement = mapInjectionRoleToRegexPlacement(config.injectionRole);
        guidanceText = await applyRegexScripts(guidanceText, promptScripts, placement, effectiveDepth, { resolveMacros });
      }
    }
    const injectedMessages = injectGuidanceMessage(assembledMessages, guidanceText, config.injectionRole, {
      actionId,
      guidancePosition: config.guidancePosition,
      guidanceDepth: config.guidanceDepth,
      isChatHistory
    });
    const messages = stripInternalMessageMarkers(injectedMessages);
    const transformResponseOutput = config.applyRegex ? async ({ deltaText, reasoningText }) => {
      const processed = await processResponseOutput({
        content: deltaText,
        ...reasoningText ? { reasoning: reasoningText } : {},
        scripts: responseScripts,
        resolveMacros
      });
      return {
        deltaText: processed.content,
        reasoningText: processed.reasoning ?? reasoningText
      };
    } : undefined;
    const transformImpersonateOutput = config.applyRegex ? async (rawText) => {
      const processed = await processResponseOutput({
        content: rawText,
        scripts: responseScripts,
        resolveMacros
      });
      return processed.content;
    } : undefined;
    const rawInput = {
      type: "raw",
      messages,
      parameters: dryRunResult.parameters,
      ...connectionId ? { connection_id: connectionId } : {},
      ...provider ? { provider } : {},
      ...model ? { model } : {},
      ...userId ? { userId } : {},
      signal
    };
    return {
      rawInput,
      transformResponseOutput,
      transformImpersonateOutput
    };
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
  async resolveChatContext(requestedChatId, userId) {
    if (requestedChatId) {
      const chat = await this.spindle.chats.get(requestedChatId, userId);
      if (!chat) {
        throw new Error("The requested chat is no longer available.");
      }
      return {
        chatId: chat.id,
        ...typeof chat.character_id === "string" && chat.character_id ? { characterId: chat.character_id } : {}
      };
    }
    const active = await this.spindle.chats.getActive(userId);
    if (!active) {
      throw new Error("Open a chat before running a Guided Generations action.");
    }
    return {
      chatId: active.id,
      ...typeof active.character_id === "string" && active.character_id ? { characterId: active.character_id } : {}
    };
  }
  mergeDryRunAndCapturedMessages(dryRunResult, capturedMessages) {
    const requestMessages = dryRunResult.request_messages;
    if (Array.isArray(requestMessages)) {
      const reqHasMetadata = requestMessages.some((m) => typeof m.__isChatHistory === "boolean" || typeof m.__chatHistorySource === "boolean" || typeof m.sourceMessageId === "string" && m.sourceMessageId.length > 0 || typeof m.__sourceMessageId === "string" && m.__sourceMessageId.length > 0);
      if (capturedMessages && capturedMessages.length > 0) {
        if (capturedMessages.length === requestMessages.length) {
          return requestMessages.map((msg, idx) => {
            const cap = capturedMessages[idx];
            return {
              ...msg,
              ...msg.__isChatHistory === undefined && cap.__isChatHistory !== undefined ? { __isChatHistory: cap.__isChatHistory } : {},
              ...msg.__isWorldInfoEntry === undefined && cap.__isWorldInfoEntry !== undefined ? { __isWorldInfoEntry: cap.__isWorldInfoEntry } : {},
              ...msg.__chatHistorySource === undefined && cap.__chatHistorySource !== undefined ? { __chatHistorySource: cap.__chatHistorySource } : {},
              ...msg.__worldInfoSource === undefined && cap.__worldInfoSource !== undefined ? { __worldInfoSource: cap.__worldInfoSource } : {},
              ...msg.sourceMessageId === undefined && cap.sourceMessageId !== undefined ? { sourceMessageId: cap.sourceMessageId } : {},
              ...msg.__sourceMessageId === undefined && cap.__sourceMessageId !== undefined ? { __sourceMessageId: cap.__sourceMessageId } : {},
              ...msg.sourceIndexInChat === undefined && cap.sourceIndexInChat !== undefined ? { sourceIndexInChat: cap.sourceIndexInChat } : {},
              ...msg.__sourceIndexInChat === undefined && cap.__sourceIndexInChat !== undefined ? { __sourceIndexInChat: cap.__sourceIndexInChat } : {}
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
  async fetchPresetBlocksFallback(presetId, userId) {
    if (!presetId || !this.spindle.permissions?.has?.("presets")) {
      return;
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
      return;
    }
    return;
  }
  createRegexMacroResolver(chatId, characterId, userId) {
    const macrosApi = this.spindle.macros;
    if (!macrosApi || typeof macrosApi.resolve !== "function") {
      return;
    }
    return async (macroInput) => {
      try {
        const res = await macrosApi.resolve(macroInput, {
          chatId,
          ...characterId ? { characterId } : {},
          ...userId ? { userId } : {},
          commit: false
        });
        return typeof res?.text === "string" ? res.text : macroInput;
      } catch {
        return macroInput;
      }
    };
  }
  async resolveInstructionTemplate(template, ctx) {
    if (!template || !template.trim())
      return template;
    const macrosApi = this.spindle.macros;
    if (!macrosApi || typeof macrosApi.resolve !== "function") {
      return template;
    }
    const INPUT_PLACEHOLDER = "__GG_INPUT_PLACEHOLDER_7F3A9C__";
    const hasInputToken = template.includes("{{input}}");
    const safeTemplate = hasInputToken ? template.replaceAll("{{input}}", INPUT_PLACEHOLDER) : template;
    try {
      const res = await macrosApi.resolve(safeTemplate, {
        chatId: ctx.chatId,
        ...ctx.characterId ? { characterId: ctx.characterId } : {},
        ...ctx.userId ? { userId: ctx.userId } : {},
        commit: false
      });
      const resolvedText = typeof res?.text === "string" ? res.text : safeTemplate;
      return hasInputToken ? resolvedText.replaceAll(INPUT_PLACEHOLDER, "{{input}}") : resolvedText;
    } catch (error) {
      this.spindle.log?.warn?.(`[GuidedGenerations] Failed resolving template macros: ${error instanceof Error ? error.message : String(error)}`);
      return template;
    }
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
  async resolvePresetContext(configuredPresetId, chatId, userId, preverifiedPreset) {
    if (!this.spindle.permissions?.has?.("presets")) {
      return { presetId: null };
    }
    const trimmedConfigured = typeof configuredPresetId === "string" ? configuredPresetId.trim() : "";
    if (trimmedConfigured) {
      if (preverifiedPreset !== undefined) {
        if (!preverifiedPreset)
          return { presetId: null };
        const name = typeof preverifiedPreset.name === "string" && preverifiedPreset.name.trim() ? preverifiedPreset.name.trim() : undefined;
        return { presetId: trimmedConfigured, ...name ? { presetName: name } : {} };
      }
      if (typeof this.spindle.presets?.get === "function") {
        try {
          const preset = await this.spindle.presets.get(trimmedConfigured, userId);
          if (!preset)
            return { presetId: null };
          const name = typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : undefined;
          return { presetId: trimmedConfigured, ...name ? { presetName: name } : {} };
        } catch {
          return { presetId: null };
        }
      }
      return { presetId: null };
    }
    const getActive = this.spindle.presets?.getActive;
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
  resolveMetricsPresetContext(presetContext, configuredPresetId, resolvedConnection) {
    if (presetContext.presetId) {
      return presetContext;
    }
    const hasConfigured = typeof configuredPresetId === "string" && configuredPresetId.trim().length > 0;
    const hasGetActive = typeof this.spindle.presets?.getActive === "function";
    if (!hasConfigured && !hasGetActive) {
      const connPresetId = typeof resolvedConnection?.preset_id === "string" ? resolvedConnection.preset_id.trim() : "";
      if (connPresetId) {
        return { presetId: connPresetId };
      }
    }
    return presetContext;
  }
  async emitMetricsForCompletedStream(args) {
    const { streamRes } = args;
    if (streamRes.aborted || !streamRes.hasOutput || !streamRes.messageId || streamRes.swipeId == null || !streamRes.timingSource) {
      return;
    }
    try {
      const hasDelimitedReasoning = !streamRes.hasReasoning && /<(?:think|thinking)\b[\s\S]*?<\/(?:think|thinking)>/i.test(streamRes.rawDeltaText);
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
        presetName: args.presetName
      });
      if (tokenCount != null || generationMetrics != null) {
        this.emitFrontend({
          type: "gg:generation_metrics",
          chatId: args.chatId,
          messageId: streamRes.messageId,
          swipeId: streamRes.swipeId,
          ...tokenCount != null ? { tokenCount } : {},
          ...generationMetrics != null ? { generationMetrics } : {}
        }, args.userId);
      }
    } catch (err) {
      this.spindle.log?.warn?.(`[GuidedGenerations] Failed emitting generation metrics: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  createGuidedSwipeSession(chatId, targetMessage) {
    const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(targetMessage);
    const newSwipeIndex = swipes.length;
    const slotSwipes = [...swipes, ""];
    const slotSwipeDates = [...swipeDates, Math.floor(Date.now() / 1000)];
    let currentViewedSwipeId = activeIndex;
    let swipeEventSeq = 0;
    let finalizing = false;
    let triggerFlush = null;
    const swipeDisposer = this.spindle.on?.("MESSAGE_SWIPED", (payload) => {
      const event = payload;
      if (!event || event.chatId !== chatId || event.message?.id !== targetMessage.id) {
        return;
      }
      const nextSwipeId = typeof event.message?.swipe_id === "number" && Number.isFinite(event.message.swipe_id) ? Math.floor(event.message.swipe_id) : typeof event.swipeId === "number" && Number.isFinite(event.swipeId) ? Math.floor(event.swipeId) : undefined;
      if (nextSwipeId === undefined)
        return;
      swipeEventSeq += 1;
      const previousViewed = currentViewedSwipeId;
      currentViewedSwipeId = nextSwipeId;
      if (!finalizing && nextSwipeId === newSwipeIndex && previousViewed !== newSwipeIndex) {
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
      setCurrentViewedSwipeId: (id) => {
        currentViewedSwipeId = id;
      },
      getSwipeEventSeq: () => swipeEventSeq,
      setTriggerFlush: (trigger) => {
        triggerFlush = trigger;
      },
      setFinalizing: (value) => {
        finalizing = value;
      },
      dispose: () => {
        if (typeof swipeDisposer === "function") {
          swipeDisposer();
        }
      }
    };
  }
  cloneRecord(record) {
    try {
      return structuredClone(record);
    } catch {
      const cloned = {};
      for (const [k, v] of Object.entries(record)) {
        cloned[k] = Array.isArray(v) ? v.map((item) => item && typeof item === "object" ? { ...item } : item) : v && typeof v === "object" ? { ...v } : v;
      }
      return cloned;
    }
  }
  cloneMessageSnapshot(message) {
    return {
      ...message,
      swipes: Array.isArray(message.swipes) ? [...message.swipes] : [],
      swipe_dates: Array.isArray(message.swipe_dates) ? [...message.swipe_dates] : [],
      extra: message.extra ? this.cloneRecord(message.extra) : {},
      ...message.metadata ? { metadata: this.cloneRecord(message.metadata) } : {}
    };
  }
  async restoreTrailingAssistant(chatId, snapshot, emptyCreatedMessageId, userId) {
    try {
      if (emptyCreatedMessageId) {
        try {
          await this.spindle.chat.deleteMessage(chatId, emptyCreatedMessageId);
        } catch {}
      }
      const restored = await this.spindle.chat.appendMessage(chatId, {
        role: "assistant",
        content: snapshot.content ?? "",
        ...snapshot.metadata ? { metadata: snapshot.metadata } : {}
      }, { triggerGeneration: false });
      const hasMultipleSwipes = Array.isArray(snapshot.swipes) && snapshot.swipes.length > 1;
      const hasSwipeDates = Array.isArray(snapshot.swipe_dates) && snapshot.swipe_dates.length > 0;
      const hasPerSwipeReasoning = Array.isArray(snapshot.extra?.reasoningBySwipe) || Array.isArray(snapshot.extra?.reasoningDurationBySwipe);
      const rawReasoning = snapshot.extra?.reasoning;
      const rawDuration = snapshot.extra?.reasoningDuration ?? snapshot.extra?.reasoning_duration;
      const hasReasoning = typeof rawReasoning === "string" || typeof rawDuration === "number";
      if (hasMultipleSwipes || hasSwipeDates || hasPerSwipeReasoning || hasReasoning) {
        const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(snapshot);
        const swipeReasoning = hasPerSwipeReasoning ? swipes.map((_, idx) => {
          const r = extractSwipeReasoning(snapshot, idx);
          return r.text !== null || r.duration !== null ? {
            text: r.text,
            ...r.duration !== null ? { duration: r.duration } : {}
          } : null;
        }) : undefined;
        await this.spindle.chat.updateMessage(chatId, restored.id, {
          content: snapshot.content ?? swipes[activeIndex] ?? "",
          swipes,
          swipe_id: activeIndex,
          swipe_dates: swipeDates,
          ...swipeReasoning ? { swipe_reasoning: swipeReasoning } : {},
          ...hasReasoning ? {
            reasoning: {
              ...typeof rawReasoning === "string" ? { text: rawReasoning } : {},
              ...typeof rawDuration === "number" ? { duration: rawDuration } : {}
            }
          } : {}
        });
      }
      await this.store.rebindContinueHistoryMessageId(chatId, snapshot.id, restored.id, userId);
    } catch (restoreError) {
      this.spindle.log.warn(`[GuidedGenerations] Failed restoring regenerated message: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
  }
  async restorePreRegenMessage(chatId, preRegen) {
    try {
      const latest = await this.spindle.chat.getMessages(chatId).then((msgs) => msgs.find((m) => m.id === preRegen.messageId)).catch(() => {
        return;
      });
      const normalized = latest ? normalizeMessageSwipes(latest) : null;
      const swipes = normalized && normalized.swipes.length > preRegen.swipeIndex ? normalized.swipes : preRegen.swipes;
      const swipeDates = normalized && normalized.swipeDates.length > preRegen.swipeIndex ? normalized.swipeDates : preRegen.swipeDates;
      await this.spindle.chat.updateMessage(chatId, preRegen.messageId, buildActiveSwipePatch({
        swipes,
        swipeIndex: preRegen.swipeIndex,
        content: preRegen.text,
        swipeDates,
        reasoningText: preRegen.reasoning,
        reasoningDuration: preRegen.reasoningDuration,
        ...preRegen.metadata !== undefined ? { metadata: preRegen.metadata } : {},
        skipChunkRebuild: false
      }));
    } catch (restoreError) {
      this.spindle.log.warn(`[GuidedGenerations] Failed restoring pre-regenerate continue message: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
  }
  async executeAssistantResponse(actionId, runId, chatId, createdMessageId, createdSwipeDates, rawInput, signal, regeneratedSnapshot, transformOutput, userId, metricsPreset) {
    let hadStreamOutput = false;
    try {
      const streamRes = await this.streamIntoMessage(chatId, rawInput, signal, async () => ({
        messageId: createdMessageId,
        swipes: [""],
        swipeIndex: 0,
        swipeDates: createdSwipeDates,
        baseText: ""
      }), undefined, transformOutput, undefined, () => {
        hadStreamOutput = true;
      }, undefined, () => {
        this.updateActiveRunState(userId, runId, { hasContentOutput: true });
      });
      let restoredOriginal = false;
      if (!streamRes.hasOutput && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, createdMessageId, userId);
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
          presetName: metricsPreset?.presetName
        });
      }
      return {
        runId,
        actionId,
        chatId,
        aborted: streamRes.aborted,
        ...restoredOriginal ? {} : { messageId: createdMessageId, swipeId: 0 },
        text: streamRes.finalText
      };
    } catch (error) {
      if (!hadStreamOutput && regeneratedSnapshot) {
        await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, createdMessageId, userId);
      }
      throw error;
    }
  }
  async executeGuidedContinue(runId, chatId, targetId, inputText, rawInput, signal, userId, transformOutput, metricsPreset) {
    const initial = await this.readTargetMessageOrThrow(chatId, targetId);
    const initialNormalized = normalizeMessageSwipes(initial);
    const initialBaseText = initialNormalized.swipes[initialNormalized.activeIndex] ?? initial.content ?? "";
    const initialReasoning = extractSwipeReasoning(initial, initialNormalized.activeIndex);
    const capturedSnapshot = {
      messageId: initial.id,
      swipeIndex: initialNormalized.activeIndex,
      baseText: initialBaseText,
      baseReasoning: initialReasoning.text,
      baseReasoningDuration: initialReasoning.duration
    };
    const baseTarget = {
      messageId: initial.id,
      swipes: initialNormalized.swipes,
      swipeIndex: initialNormalized.activeIndex,
      swipeDates: initialNormalized.swipeDates,
      baseText: initialBaseText
    };
    const recordHistory = async (resultText) => {
      await this.store.pushContinueEntry({
        chatId,
        messageId: capturedSnapshot.messageId,
        swipeIndex: capturedSnapshot.swipeIndex,
        baseText: capturedSnapshot.baseText,
        resultText,
        baseReasoning: capturedSnapshot.baseReasoning,
        baseReasoningDuration: capturedSnapshot.baseReasoningDuration,
        inputText
      }, userId);
    };
    const streamRes = await this.streamIntoMessage(chatId, rawInput, signal, async () => {
      const latest = await this.readTargetMessageOrThrow(chatId, targetId);
      const latestNorm = normalizeMessageSwipes(latest);
      const swipes = latestNorm.swipes.length > baseTarget.swipeIndex ? latestNorm.swipes : [
        ...latestNorm.swipes,
        ...baseTarget.swipes.slice(latestNorm.swipes.length)
      ];
      const swipeDates = latestNorm.swipeDates.length > baseTarget.swipeIndex ? latestNorm.swipeDates : [
        ...latestNorm.swipeDates,
        ...baseTarget.swipeDates.slice(latestNorm.swipeDates.length)
      ];
      return {
        ...baseTarget,
        messageId: latest.id,
        swipes,
        swipeDates
      };
    }, async (current) => this.refreshSwipeTarget(chatId, current), transformOutput, undefined, undefined, async ({ finalText }) => {
      await recordHistory(finalText);
    }, () => {
      this.updateActiveRunState(userId, runId, { hasContentOutput: true });
    });
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
      presetName: metricsPreset?.presetName
    });
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
  async executeGuidedSwipe(runId, chatId, swipeSession, rawInput, signal, transformOutput, userId, metricsPreset) {
    const streamRes = await this.streamIntoMessage(chatId, rawInput, signal, async () => {
      const baseTarget = {
        messageId: swipeSession.targetAssistantId,
        swipes: swipeSession.swipes,
        swipeIndex: swipeSession.newSwipeIndex,
        swipeDates: swipeSession.swipeDates,
        baseText: "",
        latestSwipeId: swipeSession.getCurrentViewedSwipeId(),
        latestExtra: swipeSession.initialExtra
      };
      const seqBeforeRead = swipeSession.getSwipeEventSeq();
      const refreshed = await this.refreshSwipeTarget(chatId, baseTarget);
      if (swipeSession.getSwipeEventSeq() === seqBeforeRead && refreshed.latestSwipeId !== undefined) {
        swipeSession.setCurrentViewedSwipeId(refreshed.latestSwipeId);
      }
      return refreshed;
    }, async (current) => {
      const seqBeforeRead = swipeSession.getSwipeEventSeq();
      const refreshed = await this.refreshSwipeTarget(chatId, current);
      if (swipeSession.getSwipeEventSeq() === seqBeforeRead && refreshed.latestSwipeId !== undefined) {
        swipeSession.setCurrentViewedSwipeId(refreshed.latestSwipeId);
      }
      return refreshed;
    }, transformOutput, {
      isViewingTargetSwipe: () => swipeSession.getCurrentViewedSwipeId() === swipeSession.newSwipeIndex,
      setTriggerFlush: (trigger) => {
        swipeSession.setTriggerFlush(trigger);
      },
      onFinalizing: () => {
        swipeSession.setFinalizing(true);
      }
    }, undefined, undefined, () => {
      this.updateActiveRunState(userId, runId, { hasContentOutput: true });
    });
    await this.emitMetricsForCompletedStream({
      chatId,
      userId,
      streamRes,
      isContinue: false,
      model: rawInput.model,
      provider: rawInput.provider,
      presetId: metricsPreset?.presetId,
      presetName: metricsPreset?.presetName
    });
    return {
      runId,
      actionId: "guided_swipe",
      chatId,
      aborted: streamRes.aborted,
      messageId: streamRes.messageId ?? swipeSession.targetAssistantId,
      swipeId: streamRes.swipeId ?? swipeSession.newSwipeIndex,
      text: streamRes.finalText
    };
  }
  async executeImpersonate(runId, chatId, rawInput, signal, userId, transformOutput) {
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
      if (generated.length > 0 && transformOutput) {
        generated = await transformOutput(generated);
      }
    } catch (error) {
      this.emitFrontend({ type: "gg:impersonate-chunk", chatId, text: generated, done: true, aborted: true }, userId);
      throw error;
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
  async streamIntoMessage(chatId, rawInput, signal, ensureTarget, refreshTarget, transformOutput, swipeOptions, onFirstOutput, onPartialErrorCommit, onFirstContent) {
    let deltaText = "";
    let reasoningText = "";
    let forceReasoningPatch = false;
    let aborted = false;
    let lastFlushAt = 0;
    let flushChain = Promise.resolve();
    let lastFlushError = null;
    let target = null;
    let notifiedFirstOutput = false;
    let notifiedFirstContent = false;
    const buildMergedContent = (baseText) => baseText ? stitchContinueContent(baseText, deltaText) : deltaText;
    const runUpdatePatch = async (messageId, patch, swallowError) => {
      try {
        await this.spindle.chat.updateMessage(chatId, messageId, patch);
        lastFlushError = null;
      } catch (err) {
        if (!swallowError) {
          lastFlushError = err;
        }
      }
    };
    const enqueuePatchFlush = (targetSnapshot, swallowError, options = {}) => {
      const mergedContent = buildMergedContent(targetSnapshot.baseText);
      const patch = buildActiveSwipePatch({
        swipes: targetSnapshot.swipes,
        swipeIndex: targetSnapshot.swipeIndex,
        content: mergedContent,
        swipeDates: targetSnapshot.swipeDates,
        ...reasoningText || forceReasoningPatch ? { reasoningText } : {},
        ...options.skipChunkRebuild !== undefined ? { skipChunkRebuild: options.skipChunkRebuild } : {}
      });
      flushChain = flushChain.catch(() => {
        return;
      }).then(async () => {
        if (options.checkStillViewingMidstream && swipeOptions && !swipeOptions.isViewingTargetSwipe()) {
          return;
        }
        await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
      });
    };
    const enqueueFinalFlush = (targetSnapshot, swallowError) => {
      if (!swipeOptions) {
        enqueuePatchFlush(targetSnapshot, swallowError, {
          skipChunkRebuild: false
        });
        return;
      }
      const capturedDelta = buildMergedContent(targetSnapshot.baseText);
      const capturedReasoning = reasoningText;
      const capturedForceReasoning = forceReasoningPatch;
      flushChain = flushChain.catch(() => {
        return;
      }).then(async () => {
        const isViewingTarget = swipeOptions.isViewingTargetSwipe();
        if (isViewingTarget) {
          const patch = buildActiveSwipePatch({
            swipes: targetSnapshot.swipes,
            swipeIndex: targetSnapshot.swipeIndex,
            content: capturedDelta,
            swipeDates: targetSnapshot.swipeDates,
            ...capturedReasoning || capturedForceReasoning ? { reasoningText: capturedReasoning } : {},
            skipChunkRebuild: false
          });
          await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
          return;
        }
        const existingBySwipe = targetSnapshot.latestExtra?.reasoningBySwipe;
        const hadStoredSlotReasoning = Array.isArray(existingBySwipe) && existingBySwipe[targetSnapshot.swipeIndex] != null;
        const includeReasoning = capturedReasoning.length > 0 || capturedForceReasoning && hadStoredSlotReasoning;
        const patch = buildBackgroundSwipePatch({
          swipes: targetSnapshot.swipes,
          swipeIndex: targetSnapshot.swipeIndex,
          content: capturedDelta,
          swipeDates: targetSnapshot.swipeDates,
          ...includeReasoning ? {
            reasoningText: capturedReasoning,
            clearReasoningSlot: capturedForceReasoning && capturedReasoning.length === 0,
            existingExtra: targetSnapshot.latestExtra,
            existingActiveSwipeId: targetSnapshot.latestSwipeId
          } : {}
        });
        await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
      });
    };
    const maybeFlush = (force) => {
      if (!target)
        return;
      if (swipeOptions && !swipeOptions.isViewingTargetSwipe())
        return;
      const now = Date.now();
      if (!force && now - lastFlushAt < STREAM_FLUSH_INTERVAL_MS)
        return;
      lastFlushAt = now;
      enqueuePatchFlush(target, false, {
        skipChunkRebuild: true,
        checkStillViewingMidstream: Boolean(swipeOptions)
      });
    };
    swipeOptions?.setTriggerFlush?.(() => maybeFlush(true));
    const ensureInitializedOnOutput = async () => {
      if (deltaText.length === 0 && reasoningText.length === 0)
        return;
      if (!notifiedFirstOutput) {
        notifiedFirstOutput = true;
        onFirstOutput?.();
      }
      if (!notifiedFirstContent && deltaText.length > 0) {
        notifiedFirstContent = true;
        onFirstContent?.();
      }
      if (target)
        return;
      target = await ensureTarget();
    };
    const wasStreaming = rawInput.parameters?._streaming !== false;
    let streamingStartedAt = Date.now();
    let firstTokenAt;
    let firstContentTokenAt;
    let lastProviderContentAt;
    let responseStoppedAt;
    let completedAt;
    let streamUsage;
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
          if (chunk.content)
            deltaText = chunk.content;
          if (chunk.reasoning)
            reasoningText = chunk.reasoning;
          if (chunk.usage) {
            streamUsage = chunk.usage;
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
          await flushChain.catch(() => {
            return;
          });
          if (refreshTarget) {
            target = await refreshTarget(target).catch(() => target);
          }
          enqueueFinalFlush(target, true);
          await flushChain.catch(() => {
            return;
          });
          if (onPartialErrorCommit) {
            await Promise.resolve(onPartialErrorCommit({
              messageId: target.messageId,
              swipeId: target.swipeIndex,
              finalText: buildMergedContent(target.baseText)
            })).catch(() => {
              return;
            });
          }
        } else {
          await flushChain.catch(() => {
            return;
          });
        }
        throw error;
      }
    }
    swipeOptions?.onFinalizing?.();
    const rawDeltaText = deltaText;
    const hasReasoning = reasoningText.length > 0;
    const hasOutput = deltaText.length > 0 || reasoningText.length > 0;
    if (!hasOutput || !target) {
      await flushChain.catch(() => {
        return;
      });
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted,
        hasOutput: false
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
      ...streamUsage ? { usage: streamUsage } : {},
      timingSource: {
        streamingStartedAt,
        ...firstTokenAt !== undefined ? { firstTokenAt } : {},
        ...firstContentTokenAt !== undefined ? { firstContentTokenAt } : {},
        ...responseStoppedAt !== undefined ? { responseStoppedAt } : {},
        ...completedAt !== undefined ? { completedAt } : {},
        wasStreaming
      }
    };
  }
  async refreshSwipeTarget(chatId, current) {
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      const latest = messages.find((m) => m.id === current.messageId);
      if (!latest)
        return current;
      const normalized = normalizeMessageSwipes(latest);
      const swipes = normalized.swipes.length > current.swipeIndex ? normalized.swipes : [...normalized.swipes, ...current.swipes.slice(normalized.swipes.length)];
      const swipeDates = normalized.swipeDates.length > current.swipeIndex ? normalized.swipeDates : [
        ...normalized.swipeDates,
        ...current.swipeDates.slice(normalized.swipeDates.length)
      ];
      return {
        ...current,
        swipes,
        swipeDates,
        latestSwipeId: normalized.activeIndex,
        latestExtra: latest.extra ? this.cloneRecord(latest.extra) : {}
      };
    } catch {
      return current;
    }
  }
  async readTargetMessageOrThrow(chatId, targetId) {
    const messages = await this.spindle.chat.getMessages(chatId);
    const byId = messages.find((m) => m.id === targetId && isAssistantMessage(m));
    if (byId)
      return byId;
    throw new Error("Target assistant message is no longer available in this chat.");
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

// src/backend/settings-store.ts
var SETTINGS_FILE = "settings.json";
var RECOVERY_FILE = "recovery.json";
var CONTINUE_HISTORY_FILE = "continue-history.json";
var MAX_CONTINUE_ENTRIES = 50;
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
    guidancePosition: normalizeGuidancePosition(record.guidancePosition, fallback.guidancePosition),
    guidanceDepth: normalizeGuidanceDepth(record.guidanceDepth, fallback.guidanceDepth),
    instructionTemplate: typeof record.instructionTemplate === "string" ? record.instructionTemplate : fallback.instructionTemplate,
    clearInputOnRun: typeof record.clearInputOnRun === "boolean" ? record.clearInputOnRun : fallback.clearInputOnRun,
    applyRegex: typeof record.applyRegex === "boolean" ? record.applyRegex : fallback.applyRegex
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
function createContinueEntry(input) {
  const safeSwipeIndex = typeof input.swipeIndex === "number" && Number.isFinite(input.swipeIndex) ? Math.max(0, Math.floor(input.swipeIndex)) : 0;
  return {
    id: input.id ?? `cont-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    chatId: input.chatId,
    messageId: input.messageId,
    swipeIndex: safeSwipeIndex,
    baseText: input.baseText,
    resultText: input.resultText,
    baseReasoning: typeof input.baseReasoning === "string" ? input.baseReasoning : null,
    baseReasoningDuration: typeof input.baseReasoningDuration === "number" && Number.isFinite(input.baseReasoningDuration) && input.baseReasoningDuration >= 0 ? input.baseReasoningDuration : null,
    inputText: input.inputText,
    createdAt: typeof input.createdAt === "number" && Number.isFinite(input.createdAt) ? input.createdAt : Date.now()
  };
}
function normalizeContinueHistoryList(raw, maxEntries = MAX_CONTINUE_ENTRIES) {
  if (!Array.isArray(raw))
    return [];
  const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : MAX_CONTINUE_ENTRIES;
  const result = [];
  for (const item of raw) {
    if (!isRecord(item))
      continue;
    if (typeof item.id !== "string" || !item.id)
      continue;
    if (typeof item.chatId !== "string" || !item.chatId)
      continue;
    if (typeof item.messageId !== "string" || !item.messageId)
      continue;
    if (typeof item.swipeIndex !== "number" || !Number.isInteger(item.swipeIndex) || item.swipeIndex < 0) {
      continue;
    }
    if (typeof item.baseText !== "string")
      continue;
    if (typeof item.resultText !== "string")
      continue;
    result.push({
      id: item.id,
      chatId: item.chatId,
      messageId: item.messageId,
      swipeIndex: item.swipeIndex,
      baseText: item.baseText,
      resultText: item.resultText,
      baseReasoning: typeof item.baseReasoning === "string" ? item.baseReasoning : null,
      baseReasoningDuration: typeof item.baseReasoningDuration === "number" && Number.isFinite(item.baseReasoningDuration) && item.baseReasoningDuration >= 0 ? item.baseReasoningDuration : null,
      inputText: typeof item.inputText === "string" ? item.inputText : "",
      createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    });
    if (result.length >= limit)
      break;
  }
  return result;
}

class SettingsStore {
  spindle;
  settingsCache = new Map;
  recoveryCache = new Map;
  continueHistoryCache = new Map;
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
  async waitForPendingWrites(key) {
    let pending = this.writeQueues.get(key);
    while (pending) {
      await pending.catch(() => {
        return;
      });
      const nextPending = this.writeQueues.get(key);
      if (nextPending === pending)
        break;
      pending = nextPending;
    }
  }
  async getSettings(userId) {
    return this.getSettingsUnlocked(userId, false);
  }
  async getSettingsUnlocked(userId, skipWriteWait = false) {
    const key = this.userKey(userId);
    const cached = this.settingsCache.get(key);
    if (cached)
      return this.cloneSettings(cached);
    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.settingsCache.get(key);
      if (rechecked)
        return this.cloneSettings(rechecked);
    }
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
  async saveSettingsWithMeta(next, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const key = this.userKey(userId);
      const normalized = normalizeSettings(next);
      await this.spindle.userStorage.write(SETTINGS_FILE, JSON.stringify(normalized, null, 2), userId);
      this.settingsCache.set(key, normalized);
      const currentRecovery = await this.readRawRecoveryUnlocked(userId, true);
      const recoveryPruned = currentRecovery.length > normalized.inputRecovery.maxEntries;
      const trimmed = currentRecovery.slice(0, normalized.inputRecovery.maxEntries);
      if (recoveryPruned) {
        await this.writeRecoveryUnlocked(trimmed, userId);
      }
      this.recoveryCache.set(key, trimmed.map((e) => ({ ...e })));
      return {
        settings: this.cloneSettings(normalized),
        recoveryPruned,
        recovery: trimmed.map((e) => ({ ...e }))
      };
    });
  }
  async saveSettings(next, userId) {
    const { settings } = await this.saveSettingsWithMeta(next, userId);
    return settings;
  }
  async getRecovery(userId) {
    const settings = await this.getSettings(userId);
    return this.readRecoveryUnlocked(userId, settings.inputRecovery.maxEntries, false);
  }
  async pushRecovery(input, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const settings = await this.getSettingsUnlocked(userId, true);
      const current = await this.readRecoveryUnlocked(userId, settings.inputRecovery.maxEntries, true);
      if (!settings.inputRecovery.enabled) {
        return current;
      }
      const updated = appendRecoveryEntry(current, input, settings.inputRecovery.maxEntries);
      await this.writeRecoveryUnlocked(updated, userId);
      return updated.map((e) => ({ ...e }));
    });
  }
  async clearRecovery(userId) {
    return this.enqueueUserWrite(userId, async () => {
      await this.writeRecoveryUnlocked([], userId);
      return [];
    });
  }
  async readRawRecoveryUnlocked(userId, skipWriteWait = false) {
    const key = this.userKey(userId);
    const cached = this.recoveryCache.get(key);
    if (cached)
      return cached.map((e) => ({ ...e }));
    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.recoveryCache.get(key);
      if (rechecked)
        return rechecked.map((e) => ({ ...e }));
    }
    try {
      if (await this.spindle.userStorage.exists(RECOVERY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(RECOVERY_FILE, userId);
        const parsed = normalizeRecoveryList(JSON.parse(raw), 50);
        this.recoveryCache.set(key, parsed.map((e) => ({ ...e })));
        return parsed.map((e) => ({ ...e }));
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading recovery history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    this.recoveryCache.set(key, []);
    return [];
  }
  async readRecoveryUnlocked(userId, maxEntries, skipWriteWait = false) {
    const key = this.userKey(userId);
    const cached = this.recoveryCache.get(key);
    if (cached)
      return cached.slice(0, maxEntries).map((e) => ({ ...e }));
    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.recoveryCache.get(key);
      if (rechecked)
        return rechecked.slice(0, maxEntries).map((e) => ({ ...e }));
    }
    try {
      if (await this.spindle.userStorage.exists(RECOVERY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(RECOVERY_FILE, userId);
        const parsed = normalizeRecoveryList(JSON.parse(raw), maxEntries);
        this.recoveryCache.set(key, parsed.map((e) => ({ ...e })));
        return parsed.map((e) => ({ ...e }));
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
    this.recoveryCache.set(this.userKey(userId), entries.map((e) => ({ ...e })));
  }
  async getContinueHistory(userId) {
    const entries = await this.readContinueHistoryUnlocked(userId, false);
    return entries.map((entry) => ({ ...entry }));
  }
  async pushContinueEntry(input, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      const entry = createContinueEntry(input);
      const updated = [entry, ...current].slice(0, MAX_CONTINUE_ENTRIES);
      await this.writeContinueHistoryUnlocked(updated, userId);
      return { ...entry };
    });
  }
  async peekContinueEntry(chatId, messageId, swipeIndex, userId) {
    const current = await this.readContinueHistoryUnlocked(userId, false);
    const match = current.find((entry) => entry.chatId === chatId && entry.messageId === messageId && entry.swipeIndex === swipeIndex);
    return match ? { ...match } : null;
  }
  async popContinueEntry(chatId, messageId, swipeIndex, expectedId, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      const idx = current.findIndex((entry) => entry.chatId === chatId && entry.messageId === messageId && entry.swipeIndex === swipeIndex);
      if (idx < 0)
        return null;
      const target = current[idx];
      if (expectedId !== undefined && target.id !== expectedId) {
        return null;
      }
      const updated = [...current.slice(0, idx), ...current.slice(idx + 1)];
      await this.writeContinueHistoryUnlocked(updated, userId);
      return { ...target };
    });
  }
  async replaceTopContinueEntry(chatId, messageId, swipeIndex, expectedId, nextEntry, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      const created = createContinueEntry(nextEntry);
      const idx = current.findIndex((entry) => entry.chatId === chatId && entry.messageId === messageId && entry.swipeIndex === swipeIndex);
      const shouldReplace = idx >= 0 && (expectedId === undefined || current[idx].id === expectedId);
      const withoutOld = shouldReplace ? [...current.slice(0, idx), ...current.slice(idx + 1)] : current;
      const updated = [created, ...withoutOld].slice(0, MAX_CONTINUE_ENTRIES);
      await this.writeContinueHistoryUnlocked(updated, userId);
      return { ...created };
    });
  }
  async rebindContinueHistoryMessageId(chatId, oldMessageId, newMessageId, userId) {
    if (!chatId || !oldMessageId || !newMessageId || oldMessageId === newMessageId) {
      return;
    }
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      let changed = false;
      const updated = current.map((entry) => {
        if (entry.chatId === chatId && entry.messageId === oldMessageId) {
          changed = true;
          return { ...entry, messageId: newMessageId };
        }
        return entry;
      });
      if (changed) {
        await this.writeContinueHistoryUnlocked(updated, userId);
      }
    });
  }
  async readContinueHistoryUnlocked(userId, skipWriteWait = false) {
    const key = this.userKey(userId);
    const cached = this.continueHistoryCache.get(key);
    if (cached)
      return cached.map((entry) => ({ ...entry }));
    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.continueHistoryCache.get(key);
      if (rechecked)
        return rechecked.map((entry) => ({ ...entry }));
    }
    try {
      if (await this.spindle.userStorage.exists(CONTINUE_HISTORY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(CONTINUE_HISTORY_FILE, userId);
        const parsed = normalizeContinueHistoryList(JSON.parse(raw), MAX_CONTINUE_ENTRIES);
        this.continueHistoryCache.set(key, parsed.map((entry) => ({ ...entry })));
        return parsed.map((entry) => ({ ...entry }));
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading continue history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    this.continueHistoryCache.set(key, []);
    return [];
  }
  async writeContinueHistoryUnlocked(entries, userId) {
    await this.spindle.userStorage.write(CONTINUE_HISTORY_FILE, JSON.stringify(entries, null, 2), userId);
    this.continueHistoryCache.set(this.userKey(userId), entries.map((entry) => ({ ...entry })));
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
    inputText: typeof record.inputText === "string" ? record.inputText : "",
    backgroundSwipe: record.backgroundSwipe === true
  };
}
function parseRegenerateContinueInput(raw) {
  const record = isRecord2(raw) ? raw : {};
  return {
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    activeConnectionId: typeof record.activeConnectionId === "string" ? record.activeConnectionId : null
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
        presets: api.permissions.has("presets"),
        regex_scripts: api.permissions.has("regex_scripts"),
        interceptor: api.permissions.has("interceptor")
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
          const { settings, recoveryPruned, recovery } = await store.saveSettingsWithMeta(req.input, userId);
          if (recoveryPruned) {
            emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
          }
          reply(settings);
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
          if (!text.trim()) {
            reply(await store.getRecovery(userId));
            return;
          }
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
        case "remove_last_continue": {
          const record = isRecord2(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          const result = await runner.removeLastContinue({ chatId }, userId);
          reply(result);
          return;
        }
        case "regenerate_last_continue": {
          const parsed = parseRegenerateContinueInput(req.input);
          const result = await runner.regenerateLastContinue(parsed, userId);
          reply(result);
          return;
        }
        default:
          throw new Error(`Unsupported action: ${String(req.action)}`);
      }
    } catch (error) {
      reply(undefined, error instanceof Error ? error.message : String(error));
    }
  }
  const disposers = [];
  disposers.push(api.onFrontendMessage((payload, userId) => {
    const req = asRpcRequest(payload);
    if (!req)
      return;
    handleRpc(req, userId);
  }));
  disposers.push(api.permissions.onChanged((arg1, arg2) => {
    const userId = typeof arg1 === "string" && arg1.length > 0 ? arg1 : typeof arg2 === "string" && arg2.length > 0 ? arg2 : isRecord2(arg1) && typeof arg1.userId === "string" && arg1.userId.length > 0 ? arg1.userId : undefined;
    emitFrontend({ type: "gg:changed", reason: "permissions" }, userId);
  }));
  for (const eventName of ["CHAT_SWITCHED", "CHAT_CHANGED"]) {
    disposers.push(api.on(eventName, (_payload, userId) => {
      emitFrontend({ type: "gg:changed", reason: eventName.toLowerCase() }, userId);
    }));
  }
  return {
    store,
    runner,
    handleRpc,
    buildBootstrapView,
    dispose: () => {
      runner.dispose();
      for (const d of disposers.splice(0)) {
        if (typeof d === "function")
          d();
      }
    }
  };
}
if (typeof spindle !== "undefined") {
  registerBackend(spindle);
}
export {
  registerBackend
};
