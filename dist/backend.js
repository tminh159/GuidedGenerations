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
        } else {
          break;
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
        } else {
          break;
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
      __sourceMessageMetadata: _sourceMetaUnderscore,
      __continueNudge: _continueNudge,
      __contextAnchorProtected: _contextAnchorProtected,
      __preserveDisplayReasoningDelimiters: _preserveReasoningDelims,
      __cortexHistorySummary: _cortexHistorySummary,
      __runtimeWorldInfoPlacementId: _runtimeWiPlacementId,
      sourceMessageId: _sourceId,
      sourceIndexInChat: _sourceIdx,
      sourceMessageMetadata: _sourceMeta,
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
  const findMovedContinueAssistantIndex = (afterIdx) => {
    if (options.actionId !== "guided_continue")
      return -1;
    let idx = copy.length - 1;
    while (idx > afterIdx && copy[idx]?.role === "system") {
      idx -= 1;
    }
    if (idx > afterIdx && copy[idx]?.role === "assistant") {
      return idx;
    }
    return -1;
  };
  let insertIndex = copy.length;
  switch (position) {
    case "pre_history": {
      if (hasHistoryFlags) {
        if (historyIndices.length > 0) {
          insertIndex = historyIndices[0];
        } else if (options.actionId === "guided_continue") {
          const firstTurnIdx = copy.findIndex((m) => m.role === "user" || m.role === "assistant");
          insertIndex = firstTurnIdx >= 0 ? firstTurnIdx : 0;
        } else {
          insertIndex = 0;
        }
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
            const movedContinueIdx = findMovedContinueAssistantIndex(lastHistoryIdx);
            if (movedContinueIdx >= 0) {
              insertIndex = lastHistoryIdx + 1;
            } else {
              const continueIdx = findHistoryContinueAssistantIndex();
              insertIndex = continueIdx >= 0 ? continueIdx : lastHistoryIdx + 1;
            }
          } else {
            insertIndex = lastHistoryIdx + 1;
          }
        } else {
          const continueIdx = findFallbackContinueAssistantIndex();
          insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
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
          const movedContinueIdx = options.actionId === "guided_continue" ? findMovedContinueAssistantIndex(lastHistoryIdx) : -1;
          if (depth === 0) {
            if (options.actionId === "guided_continue") {
              if (movedContinueIdx >= 0) {
                insertIndex = lastHistoryIdx + 1;
              } else {
                const continueIdx = findHistoryContinueAssistantIndex();
                insertIndex = continueIdx >= 0 ? continueIdx : lastHistoryIdx + 1;
              }
            } else {
              insertIndex = lastHistoryIdx + 1;
            }
          } else if (movedContinueIdx >= 0) {
            if (depth === 1) {
              insertIndex = lastHistoryIdx + 1;
            } else {
              const clampedOffset = Math.max(0, historyIndices.length - (depth - 1));
              insertIndex = historyIndices[clampedOffset];
            }
          } else {
            const clampedOffset = Math.max(0, historyIndices.length - depth);
            insertIndex = historyIndices[clampedOffset];
          }
        } else if (options.actionId === "guided_continue") {
          const continueIdx = findFallbackContinueAssistantIndex();
          if (depth === 0) {
            insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
          } else {
            const endBound = continueIdx >= 0 ? continueIdx : copy.length;
            insertIndex = Math.max(0, endBound - depth);
          }
        } else {
          insertIndex = copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1]) ? copy.length - 1 : copy.length;
        }
      } else if (depth === 0) {
        const continueIdx = findFallbackContinueAssistantIndex();
        insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
      } else {
        const endBound = options.actionId === "guided_continue" ? (() => {
          const continueIdx = findFallbackContinueAssistantIndex();
          return continueIdx >= 0 ? continueIdx : copy.length;
        })() : copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1]) ? copy.length - 1 : copy.length;
        insertIndex = Math.max(0, endBound - depth);
      }
      break;
    }
    case "post_history": {
      if (options.actionId === "guided_continue") {
        if (hasHistoryFlags && historyIndices.length > 0) {
          const lastHistoryIdx = historyIndices[historyIndices.length - 1];
          const movedContinueIdx = findMovedContinueAssistantIndex(lastHistoryIdx);
          if (movedContinueIdx >= 0) {
            insertIndex = movedContinueIdx;
          } else if (copy.length > 0 && copy[copy.length - 1]?.role === "assistant") {
            insertIndex = copy.length - 1;
          } else {
            insertIndex = copy.length;
          }
        } else {
          const continueIdx = findFallbackContinueAssistantIndex();
          insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
        }
      } else if (copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1])) {
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
function isWorldInfoMessage(msg) {
  return Boolean(msg.__isWorldInfoEntry || msg.__worldInfoSource);
}
function getLlmMessageTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.type === "text" ? part.text : "").join("");
  }
  return "";
}
function mergeMessageContents(prev, curr) {
  if (typeof prev === "string" && typeof curr === "string") {
    return `${prev}

${curr}`;
  }
  const hasNonText = (content) => Array.isArray(content) && content.some((part) => part.type !== "text");
  if (!hasNonText(prev) && !hasNonText(curr)) {
    return `${getLlmMessageTextContent(prev)}

${getLlmMessageTextContent(curr)}`;
  }
  const toParts = (content) => typeof content === "string" ? content.length > 0 ? [{ type: "text", text: content }] : [] : content;
  const prevParts = toParts(prev);
  const currParts = toParts(curr);
  return [
    ...prevParts,
    ...prevParts.length > 0 && currParts.length > 0 ? [{ type: "text", text: `

` }] : [],
    ...currParts
  ];
}
function hasNonEmptyLlmContent(msg) {
  if (typeof msg.content === "string") {
    return msg.content.trim().length > 0 || msg.role === "assistant" && msg.partial === true;
  }
  if (Array.isArray(msg.content)) {
    return msg.content.length > 0;
  }
  return true;
}
function mergeConsecutiveSameRoleMessages(messages) {
  const merged = [];
  for (const rawMsg of messages) {
    const msg = { ...rawMsg };
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      merged[merged.length - 1] = {
        ...prev,
        content: mergeMessageContents(prev.content, msg.content),
        ...msg.partial === true ? { partial: true } : {}
      };
    } else {
      merged.push(msg);
    }
  }
  return merged;
}
function collapseMessagesToSingleRole(messages, role) {
  if (messages.length <= 1) {
    return messages.map((msg) => ({ ...msg }));
  }
  const textChunks = [];
  const mediaParts = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      if (msg.content) {
        textChunks.push(msg.content);
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          if (part.text) {
            textChunks.push(part.text);
          }
        } else {
          mediaParts.push(part);
        }
      }
    }
  }
  const collapsed = textChunks.join(`

`);
  if (mediaParts.length > 0) {
    const parts = [
      ...collapsed ? [{ type: "text", text: collapsed }] : [],
      ...mediaParts
    ];
    return [{ role, content: parts }];
  }
  return [{ role, content: collapsed }];
}
function removeTrailingHistoryTurnAndUnshiftDepth(messages, isChatHistory, targetIdx) {
  const historyIndices = [];
  for (let i = 0;i < isChatHistory.length; i += 1) {
    if (isChatHistory[i]) {
      historyIndices.push(i);
    }
  }
  const lastHistoryPos = historyIndices.length - 1;
  if (lastHistoryPos < 1 || historyIndices[lastHistoryPos] !== targetIdx) {
    const nextMessages = [];
    const nextFlags = [];
    for (let i = 0;i < messages.length; i += 1) {
      if (i === targetIdx)
        continue;
      nextMessages.push({ ...messages[i] });
      nextFlags.push(Boolean(isChatHistory[i]));
    }
    return { messages: nextMessages, isChatHistory: nextFlags };
  }
  const h0 = historyIndices[0];
  const h1 = historyIndices[1];
  const hk = targetIdx;
  const nextMessages = [];
  const nextFlags = [];
  const pushItem = (idx, flag) => {
    nextMessages.push({ ...messages[idx] });
    nextFlags.push(flag);
  };
  for (let i = 0;i < h0; i += 1) {
    pushItem(i, false);
  }
  const gap1KeepAfterH0 = [];
  for (let i = h0 + 1;i < h1; i += 1) {
    if (isWorldInfoMessage(messages[i])) {
      gap1KeepAfterH0.push(i);
    } else {
      pushItem(i, false);
    }
  }
  pushItem(h0, true);
  for (const idx of gap1KeepAfterH0) {
    pushItem(idx, false);
  }
  for (let j = 2;j <= lastHistoryPos; j += 1) {
    const prevH = historyIndices[j - 1];
    const currH = historyIndices[j];
    for (let i = prevH + 1;i < currH; i += 1) {
      pushItem(i, false);
    }
    pushItem(prevH, true);
  }
  for (let i = hk + 1;i < messages.length; i += 1) {
    pushItem(i, false);
  }
  return { messages: nextMessages, isChatHistory: nextFlags };
}
function stripTrailingAssistantTurnWithHistory(messages, matchId, isChatHistory, options) {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;
  if (matchId) {
    const matchingIndices = [];
    for (let i = 0;i < messages.length; i += 1) {
      if (getMessageSourceId(messages[i]) === matchId) {
        matchingIndices.push(i);
      }
    }
    if (matchingIndices.length === 1) {
      const targetIdx = matchingIndices[0];
      if (hasFlags) {
        return removeTrailingHistoryTurnAndUnshiftDepth(messages, isChatHistory, targetIdx);
      }
      return {
        messages: messages.filter((_, idx) => idx !== targetIdx).map((msg) => ({ ...msg }))
      };
    }
    if (matchingIndices.length > 1) {
      const matchSet = new Set(matchingIndices);
      const nextMessages = [];
      const nextFlags = [];
      for (let i = 0;i < messages.length; i += 1) {
        if (matchSet.has(i))
          continue;
        nextMessages.push({ ...messages[i] });
        if (hasFlags)
          nextFlags.push(Boolean(isChatHistory[i]));
      }
      return {
        messages: nextMessages,
        ...hasFlags ? { isChatHistory: nextFlags } : {}
      };
    }
  }
  let targetIdx = -1;
  for (let i = messages.length - 1;i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg)
      continue;
    if (hasFlags && !isChatHistory[i]) {
      continue;
    }
    if (msg.role === "user") {
      break;
    }
    if (msg.role === "assistant") {
      if (msg.partial) {
        continue;
      }
      const candidateSourceId = getMessageSourceId(msg);
      if (matchId && candidateSourceId && candidateSourceId !== matchId) {
        break;
      }
      if (!options.requireBlankFallback || isBlankLlmContent(msg.content)) {
        targetIdx = i;
      }
      break;
    }
  }
  if (targetIdx === -1) {
    return {
      messages: messages.map((msg) => ({ ...msg })),
      ...hasFlags ? { isChatHistory: [...isChatHistory] } : {}
    };
  }
  if (hasFlags) {
    return removeTrailingHistoryTurnAndUnshiftDepth(messages, isChatHistory, targetIdx);
  }
  return {
    messages: messages.filter((_, idx) => idx !== targetIdx).map((msg) => ({ ...msg }))
  };
}
function stripRejectedSwipeAssistantTurnWithHistory(messages, targetMessageId, isChatHistory, options) {
  return stripTrailingAssistantTurnWithHistory(messages, targetMessageId, isChatHistory, {
    requireBlankFallback: options?.requireBlankFallback ?? false
  });
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
  return stripTrailingAssistantTurnWithHistory(messages, createdMessageId, isChatHistory, {
    requireBlankFallback: true
  });
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
  const endsWithOpeningDelimiter = /[(\[{\u201C\u2018\u2014\u2013-]$/.test(baseContent) || /(?:^|[\s(\[>])["'*_]$/.test(baseContent);
  const startsWithWhitespace = /^\s/.test(delta);
  const startsWithPunctuation = /^[,.;:!?'"\u2019\u201D\)\]\-\u2014\u2026]/.test(delta);
  if (endsWithWhitespace || endsWithOpeningDelimiter || startsWithWhitespace || startsWithPunctuation) {
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
  const existingEntry = nextContexts[idx];
  nextContexts[idx] = {
    ...existingEntry ?? {},
    preset_id: presetId
  };
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
  const validDuration = typeof args.reasoningDuration === "number" && Number.isFinite(args.reasoningDuration) && args.reasoningDuration >= 0 ? args.reasoningDuration : undefined;
  const shouldWriteSwipeReasoning = hasNewReasoning || Boolean(args.clearReasoningSlot);
  let swipeReasoning;
  if (shouldWriteSwipeReasoning) {
    swipeReasoning = updatedSwipes.map((_, idx) => {
      if (idx === args.swipeIndex) {
        return hasNewReasoning ? {
          text: args.reasoningText,
          ...validDuration !== undefined ? { duration: validDuration } : {}
        } : null;
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
var MAX_REGEX_PATTERN_LENGTH = 50000;
var REGEX_SCRIPT_TIME_BUDGET_MS = 500;
var VALID_REGEX_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);
function countPrecedingBackslashes(input, index) {
  let count = 0;
  for (let i = index - 1;i >= 0 && input[i] === "\\"; i -= 1) {
    count += 1;
  }
  return count;
}
function parseMacroTagHeader(tagText) {
  let pos = 2;
  const len = tagText.length - 2;
  while (pos < len && (tagText[pos] === " " || tagText[pos] === "\t"))
    pos += 1;
  let isClose = false;
  while (pos < len) {
    const ch = tagText[pos];
    if (ch === "!" || ch === "?" || ch === "~" || ch === ">" || ch === "#") {
      pos += 1;
    } else if (ch === "/") {
      isClose = true;
      pos += 1;
    } else {
      break;
    }
  }
  while (pos < len && (tagText[pos] === " " || tagText[pos] === "\t"))
    pos += 1;
  const idStart = pos;
  while (pos < len && /[a-zA-Z0-9_-]/.test(tagText[pos]))
    pos += 1;
  const name = pos > idStart ? tagText.slice(idStart, pos).toLowerCase() : "";
  return { name, isClose };
}
function findClosingMacroTagIndex(tags, startIdx, name) {
  let depth = 0;
  for (let i = startIdx;i < tags.length; i += 1) {
    const tag = tags[i];
    if (tag.name !== name)
      continue;
    if (tag.isClose) {
      if (depth === 0)
        return i;
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return -1;
}
function findTopLevelMacroTokens(input) {
  const rawTags = [];
  let depth = 0;
  let tokenStart = -1;
  for (let i = 0;i < input.length; ) {
    const ch = input[i];
    if ((ch === "{" || ch === "}") && countPrecedingBackslashes(input, i) % 2 === 1) {
      i += 1;
      continue;
    }
    if (ch === "{" && input[i + 1] === "{") {
      if (depth === 0) {
        tokenStart = i;
      }
      depth += 1;
      i += 2;
      continue;
    }
    if (ch === "}" && input[i + 1] === "}" && depth > 0) {
      depth -= 1;
      i += 2;
      if (depth === 0 && tokenStart >= 0) {
        const tagText = input.slice(tokenStart, i);
        const { name, isClose } = parseMacroTagHeader(tagText);
        rawTags.push({
          start: tokenStart,
          end: i,
          name,
          isClose
        });
        tokenStart = -1;
      }
      continue;
    }
    i += 1;
  }
  if (rawTags.length === 0) {
    return [];
  }
  const tokens = [];
  for (let i = 0;i < rawTags.length; ) {
    const tag = rawTags[i];
    if (!tag.isClose && tag.name) {
      const closingIdx = findClosingMacroTagIndex(rawTags, i + 1, tag.name);
      if (closingIdx >= 0) {
        const end = rawTags[closingIdx].end;
        tokens.push({
          start: tag.start,
          end,
          value: input.slice(tag.start, end)
        });
        i = closingIdx + 1;
        continue;
      }
    }
    tokens.push({
      start: tag.start,
      end: tag.end,
      value: input.slice(tag.start, tag.end)
    });
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
function validateFlags(flags) {
  const seen = new Set;
  for (const ch of flags) {
    if (!VALID_REGEX_FLAGS.has(ch) || seen.has(ch)) {
      return false;
    }
    seen.add(ch);
  }
  return true;
}
function hasOverlappingAlternationBranches(branches, hasEmptyBranch, hasCharClassOrShorthandOverlap) {
  if (hasEmptyBranch || hasCharClassOrShorthandOverlap)
    return true;
  for (let i = 0;i < branches.length; i += 1) {
    const a = branches[i];
    if (!a)
      return true;
    for (let j = i + 1;j < branches.length; j += 1) {
      const b = branches[j];
      if (!b)
        return true;
      if (a.startsWith(b) || b.startsWith(a)) {
        return true;
      }
    }
  }
  return false;
}
function isLikelyCatastrophicRegex(pattern) {
  const createFrame = () => ({
    hasInnerQuantifier: false,
    hasWildcard: false,
    hasAlternation: false,
    hasOptionalElement: false,
    mandatoryCount: 0,
    branches: [],
    currentBranchPrefix: "",
    currentBranchOpen: true,
    hasEmptyBranch: false,
    classLikeBranches: 0
  });
  const stack = [createFrame()];
  let inCharClass = false;
  let lastWasQuantifiableAtom = false;
  let lastWasWildcard = false;
  let lastAtomIsUnboundedQuantifiedWildcard = false;
  const readQuantifier = (idx) => {
    if (idx >= pattern.length)
      return null;
    const ch = pattern[idx];
    if (ch === "*") {
      const end = pattern[idx + 1] === "?" || pattern[idx + 1] === "+" ? idx + 2 : idx + 1;
      return { end, min: 0, maxMoreThanOne: true, unbounded: true };
    }
    if (ch === "+") {
      const end = pattern[idx + 1] === "?" || pattern[idx + 1] === "+" ? idx + 2 : idx + 1;
      return { end, min: 1, maxMoreThanOne: true, unbounded: true };
    }
    if (ch === "?") {
      const end = pattern[idx + 1] === "?" || pattern[idx + 1] === "+" ? idx + 2 : idx + 1;
      return { end, min: 0, maxMoreThanOne: false, unbounded: false };
    }
    if (ch === "{") {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(idx));
      if (!m)
        return null;
      const min = Number.parseInt(m[1], 10);
      const maxStr = m[2];
      const max = maxStr === undefined ? min : maxStr === "" ? Number.POSITIVE_INFINITY : Number.parseInt(maxStr, 10);
      let end = idx + m[0].length;
      if (pattern[end] === "?" || pattern[end] === "+")
        end += 1;
      return {
        end,
        min,
        maxMoreThanOne: max > 1,
        unbounded: maxStr === ""
      };
    }
    return null;
  };
  for (let i = 0;i < pattern.length; ) {
    const ch = pattern[i];
    const top = stack[stack.length - 1];
    if (ch === "\\") {
      if (i + 1 >= pattern.length)
        break;
      const esc = pattern[i + 1];
      let advance = 2;
      if ((esc === "k" || esc === "p" || esc === "P") && pattern[i + 2] === "<") {
        const close = pattern.indexOf(">", i + 3);
        if (close >= 0)
          advance = close - i + 1;
      } else if ((esc === "p" || esc === "P" || esc === "u") && pattern[i + 2] === "{") {
        const close = pattern.indexOf("}", i + 3);
        if (close >= 0)
          advance = close - i + 1;
      }
      i += advance;
      if (!inCharClass) {
        const isAnchor = esc === "b" || esc === "B";
        lastWasQuantifiableAtom = !isAnchor;
        lastWasWildcard = false;
        if (!isAnchor) {
          top.mandatoryCount += 1;
          lastAtomIsUnboundedQuantifiedWildcard = false;
          if (esc === "w" || esc === "W" || esc === "d" || esc === "D" || esc === "s" || esc === "S" || esc === "p" || esc === "P") {
            if (top.currentBranchOpen && top.currentBranchPrefix.length === 0) {
              top.classLikeBranches += 1;
            }
            top.currentBranchOpen = false;
          } else if (top.currentBranchOpen && top.currentBranchPrefix.length < 16) {
            top.currentBranchPrefix += esc;
          }
        }
      }
      continue;
    }
    if (inCharClass) {
      if (ch === "]") {
        inCharClass = false;
        lastWasQuantifiableAtom = true;
        lastWasWildcard = false;
        top.mandatoryCount += 1;
        if (top.currentBranchOpen && top.currentBranchPrefix.length === 0) {
          top.classLikeBranches += 1;
        }
        top.currentBranchOpen = false;
      }
      i += 1;
      continue;
    }
    if (ch === "[") {
      inCharClass = true;
      const rest = pattern.slice(i);
      const isWildClass = /^\[(?:\\s\\S|\\S\\s|\\d\\D|\\D\\d|\\w\\W|\\W\\w)\]/.test(rest);
      lastWasWildcard = isWildClass;
      if (isWildClass)
        top.hasWildcard = true;
      i += 1;
      continue;
    }
    if (ch === "(") {
      let skip = 1;
      if (pattern[i + 1] === "?") {
        if (pattern[i + 2] === "#") {
          const close = pattern.indexOf(")", i + 3);
          i = close >= 0 ? close + 1 : pattern.length;
          continue;
        }
        if (pattern[i + 2] === "<" && (pattern[i + 3] === "=" || pattern[i + 3] === "!")) {
          skip = 4;
        } else if (pattern[i + 2] === "<") {
          const gt = pattern.indexOf(">", i + 3);
          skip = gt >= 0 ? gt - i + 1 : 2;
        } else if (pattern[i + 2] === ":" || pattern[i + 2] === "=" || pattern[i + 2] === "!") {
          skip = 3;
        }
      }
      top.currentBranchOpen = false;
      stack.push(createFrame());
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      i += skip;
      continue;
    }
    if (ch === ")") {
      const closed = stack.length > 1 ? stack.pop() : null;
      const parent = stack[stack.length - 1];
      if (closed) {
        if (closed.currentBranchPrefix.length === 0 && closed.mandatoryCount === 0) {
          closed.hasEmptyBranch = true;
        } else if (closed.currentBranchPrefix.length > 0) {
          closed.branches.push(closed.currentBranchPrefix);
        }
        if (closed.hasInnerQuantifier)
          parent.hasInnerQuantifier = true;
        if (closed.hasWildcard)
          parent.hasWildcard = true;
        if (closed.mandatoryCount > 0)
          parent.mandatoryCount += 1;
      }
      lastWasQuantifiableAtom = true;
      lastWasWildcard = false;
      i += 1;
      const q = readQuantifier(i);
      if (q) {
        if (closed && q.maxMoreThanOne) {
          if (closed.hasInnerQuantifier && (q.unbounded || closed.hasWildcard || closed.hasOptionalElement || closed.mandatoryCount <= 1)) {
            return true;
          }
          if (closed.hasAlternation && (closed.hasOptionalElement || closed.hasWildcard || hasOverlappingAlternationBranches(closed.branches, closed.hasEmptyBranch, closed.classLikeBranches > 1))) {
            return true;
          }
        }
        if (q.min === 0) {
          parent.hasOptionalElement = true;
          if (closed && closed.mandatoryCount > 0) {
            parent.mandatoryCount = Math.max(0, parent.mandatoryCount - 1);
          }
        }
        if (q.maxMoreThanOne) {
          parent.hasInnerQuantifier = true;
        }
        lastWasQuantifiableAtom = false;
        i = q.end;
      }
      continue;
    }
    if (ch === "|") {
      top.hasAlternation = true;
      if (top.currentBranchPrefix.length === 0 && top.currentBranchOpen) {
        top.hasEmptyBranch = true;
      } else if (top.currentBranchPrefix.length > 0) {
        top.branches.push(top.currentBranchPrefix);
      }
      top.currentBranchPrefix = "";
      top.currentBranchOpen = true;
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      i += 1;
      continue;
    }
    const q = readQuantifier(i);
    if (q && lastWasQuantifiableAtom) {
      if (q.min === 0) {
        top.hasOptionalElement = true;
        top.mandatoryCount = Math.max(0, top.mandatoryCount - 1);
      }
      if (q.maxMoreThanOne) {
        top.hasInnerQuantifier = true;
      }
      if (lastWasWildcard && q.unbounded) {
        if (lastAtomIsUnboundedQuantifiedWildcard) {
          return true;
        }
        lastAtomIsUnboundedQuantifiedWildcard = true;
      } else {
        lastAtomIsUnboundedQuantifiedWildcard = false;
      }
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      i = q.end;
      continue;
    }
    if (ch === "^" || ch === "$") {
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      i += 1;
      continue;
    }
    if (ch === ".") {
      top.hasWildcard = true;
      lastWasWildcard = true;
      top.currentBranchOpen = false;
    } else {
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      if (top.currentBranchOpen && top.currentBranchPrefix.length < 16) {
        top.currentBranchPrefix += ch;
      }
    }
    top.mandatoryCount += 1;
    lastWasQuantifiableAtom = true;
    i += 1;
  }
  return false;
}
var ESCAPABLE_LITERAL_CHARS = new Set("\\^$.*+?()[]{}|/");
function getRequiredTerminalLiteral(pattern) {
  let suffix = "";
  let depth = 0;
  let inCharacterClass = false;
  for (let i = 0;i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      const escaped = pattern[i + 1];
      if (escaped === undefined)
        return null;
      i += 1;
      if (inCharacterClass)
        continue;
      if (ESCAPABLE_LITERAL_CHARS.has(escaped)) {
        suffix += escaped;
      } else {
        suffix = "";
        if ((escaped === "k" || escaped === "p" || escaped === "P") && pattern[i + 1] === "<") {
          const close = pattern.indexOf(">", i + 2);
          if (close >= 0)
            i = close;
        } else if ((escaped === "p" || escaped === "P" || escaped === "u") && pattern[i + 1] === "{") {
          const close = pattern.indexOf("}", i + 2);
          if (close >= 0)
            i = close;
        } else if (escaped === "u") {
          i = Math.min(pattern.length - 1, i + 4);
        } else if (escaped === "x") {
          i = Math.min(pattern.length - 1, i + 2);
        } else if (escaped === "c") {
          i = Math.min(pattern.length - 1, i + 1);
        } else if (/\d/.test(escaped)) {
          while (/\d/.test(pattern[i + 1] ?? ""))
            i += 1;
        }
      }
      continue;
    }
    if (inCharacterClass) {
      if (char === "]")
        inCharacterClass = false;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      suffix = "";
      continue;
    }
    if (char === "(") {
      depth += 1;
      suffix = "";
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      suffix = "";
      continue;
    }
    if (char === "|") {
      if (depth === 0)
        return null;
      suffix = "";
      continue;
    }
    if (".*+?^${}".includes(char)) {
      suffix = "";
      continue;
    }
    suffix += char;
  }
  return suffix.length >= 4 ? suffix : null;
}
function getRegexSearchEnd(input, pattern, flags, replacementTemplate) {
  if (flags.includes("y") || replacementTemplate.includes("$'"))
    return input.length;
  const terminal = getRequiredTerminalLiteral(pattern);
  if (!terminal)
    return input.length;
  let index = -1;
  if (!flags.includes("i")) {
    index = input.lastIndexOf(terminal);
  } else {
    const unicodeFlag = flags.includes("v") ? "v" : flags.includes("u") ? "u" : "";
    const guard = new RegExp(escapeRegExp(terminal), `gi${unicodeFlag}`);
    let match;
    while ((match = guard.exec(input)) !== null) {
      index = match.index;
    }
  }
  return index < 0 ? 0 : index + terminal.length;
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
  return template.replace(/\{\{match\}\}|\$(?:\$|&|`|'|<([^>]+)>|(\d{1,2}))/g, (token, groupName, groupNum) => {
    if (token === "{{match}}")
      return trimmedMatch;
    if (token === "$$")
      return "$";
    if (token === "$&")
      return match[0];
    if (token === "$`")
      return fullText.slice(0, match.index);
    if (token === "$'")
      return fullText.slice(match.index + match[0].length);
    if (groupName !== undefined) {
      if (match.groups && Object.prototype.hasOwnProperty.call(match.groups, groupName)) {
        return match.groups[groupName] ?? "";
      }
      return token;
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
function applyTrimStrings(result, trimStrings) {
  for (const trim of trimStrings) {
    if (typeof trim === "string" && trim.length > 0) {
      while (result.includes(trim)) {
        result = result.replaceAll(trim, "");
      }
    }
  }
  return result;
}
function trimMatchStrings(rawMatch, trimStrings) {
  let trimmed = rawMatch;
  for (const trim of trimStrings) {
    if (typeof trim === "string" && trim.length > 0) {
      trimmed = trimmed.split(trim).join("");
    }
  }
  return trimmed;
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
    if (script.metadata && typeof script.metadata === "object" && script.metadata.regex_evidence?.quarantined === true) {
      continue;
    }
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
    const flags = typeof script.flags === "string" ? script.flags : "";
    if (!validateFlags(flags)) {
      continue;
    }
    const resolvedFindRegex = await resolveFindRegex(script.find_regex, script.substitute_macros, options.resolveMacros);
    if (resolvedFindRegex.length > MAX_REGEX_PATTERN_LENGTH || isLikelyCatastrophicRegex(resolvedFindRegex)) {
      continue;
    }
    const actions = extractMatchActions(script);
    const moveTop = actions.has("move_top");
    const moveBottom = actions.has("move_bottom");
    const repeatBack = actions.has("repeat_back");
    const effectiveFlags = moveTop || moveBottom ? flags.replaceAll("g", "") : flags;
    let regex;
    try {
      regex = new RegExp(resolvedFindRegex, effectiveFlags);
    } catch {
      continue;
    }
    const baseReplaceTemplate = script.substitute_macros === "escaped" ? await resolveEscapedReplaceTemplate(script.replace_string ?? "", options.resolveMacros) : script.replace_string ?? "";
    const trimStrings = Array.isArray(script.trim_strings) ? script.trim_strings : [];
    const searchEnd = getRegexSearchEnd(current, resolvedFindRegex, effectiveFlags, baseReplaceTemplate);
    const searchInput = searchEnd === current.length ? current : current.slice(0, searchEnd);
    const searchTail = searchEnd === current.length ? "" : current.slice(searchEnd);
    const matches = [];
    let timedOut = false;
    const startedAt = Date.now();
    if (searchEnd > 0 || current.length === 0) {
      let execResult;
      while ((execResult = regex.exec(searchInput)) !== null) {
        const trimmedMatch = trimMatchStrings(execResult[0], trimStrings);
        let replacement = expandReplacementTemplate(baseReplaceTemplate, execResult, trimmedMatch, current);
        if (script.substitute_macros === "raw" && options.resolveMacros) {
          replacement = await options.resolveMacros(replacement);
        }
        const movedValue = replacement.length > 0 ? replacement : trimmedMatch;
        matches.push({
          index: execResult.index,
          length: execResult[0].length,
          replacement,
          movedValue
        });
        if (Date.now() - startedAt > REGEX_SCRIPT_TIME_BUDGET_MS) {
          timedOut = true;
          break;
        }
        if (matches.length >= MAX_REGEX_MATCHES) {
          break;
        }
        if (!regex.global && !regex.sticky) {
          break;
        }
        if (execResult[0].length === 0) {
          if (regex.lastIndex >= searchInput.length) {
            break;
          }
          const cp = searchInput.codePointAt(regex.lastIndex);
          regex.lastIndex += cp !== undefined && cp > 65535 ? 2 : 1;
        }
      }
    }
    if (timedOut) {
      continue;
    }
    if (matches.length === 0) {
      if (repeatBack && options.previousContent !== undefined) {
        let priorRegex = null;
        try {
          priorRegex = new RegExp(resolvedFindRegex, effectiveFlags);
        } catch {
          priorRegex = null;
        }
        const priorExec = priorRegex ? priorRegex.exec(options.previousContent) : null;
        if (priorExec) {
          const repeatRawMatch = script.metadata?.repeat_raw_match === true;
          const repeatPosition = typeof script.metadata?.repeat_position === "string" ? script.metadata.repeat_position : (script.replace_string ?? "").split(" ", 2)[1];
          let piece;
          if (repeatRawMatch) {
            piece = priorExec[0];
          } else {
            const trimmedPrior = trimMatchStrings(priorExec[0], trimStrings);
            piece = expandReplacementTemplate(baseReplaceTemplate, priorExec, trimmedPrior, options.previousContent);
            if ((script.substitute_macros === "raw" || script.substitute_macros === "after") && options.resolveMacros) {
              piece = await options.resolveMacros(piece);
            }
          }
          let repeated = current;
          if (!repeatPosition || repeatPosition === "end") {
            repeated = current + piece;
          } else if (repeatPosition === "start") {
            repeated = piece + current;
          } else if (repeatPosition === "end_nl") {
            repeated = `${current}
${piece}`;
          } else if (repeatPosition === "start_nl") {
            repeated = `${piece}
${current}`;
          }
          current = applyTrimStrings(repeated, trimStrings);
        }
      }
      if (script.substitute_macros === "after" && options.resolveMacros) {
        current = await options.resolveMacros(current);
      }
      continue;
    }
    if (moveTop || moveBottom) {
      const m = matches[0];
      const remainder = searchInput.slice(0, m.index) + searchInput.slice(m.index + m.length) + searchTail;
      let moved = m.movedValue;
      if (script.substitute_macros === "after" && options.resolveMacros) {
        moved = await options.resolveMacros(moved);
      }
      let next = moveTop ? joinSections(moved, remainder) : joinSections(remainder, moved);
      if (repeatBack && options.previousContent === undefined && moved) {
        next = joinSections(next, moved);
      }
      current = applyTrimStrings(next, trimStrings);
      continue;
    }
    let rebuilt = "";
    let cursor = 0;
    const movedChunks = [];
    for (const m of matches) {
      rebuilt += searchInput.slice(cursor, m.index);
      rebuilt += m.replacement;
      if (repeatBack && options.previousContent === undefined && m.movedValue) {
        movedChunks.push(m.movedValue);
      }
      cursor = m.index + m.length;
    }
    rebuilt += searchInput.slice(cursor) + searchTail;
    if (script.substitute_macros === "after" && options.resolveMacros) {
      rebuilt = await options.resolveMacros(rebuilt);
    }
    if (repeatBack && options.previousContent === undefined && movedChunks.length > 0) {
      rebuilt = joinSections(rebuilt, movedChunks.join(`
`));
    }
    current = applyTrimStrings(rebuilt, trimStrings);
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
  const fontTokenRe = /(<\/?font\b[^>]*>|\r?\n\r?\n)/gi;
  const closeInsertOffsets = [];
  const openStack = [];
  let tokenMatch;
  const findLineEnd = (fromIndex) => {
    const nl = out.indexOf(`
`, fromIndex);
    if (nl === -1)
      return out.length;
    return nl > fromIndex && out[nl - 1] === "\r" ? nl - 1 : nl;
  };
  while ((tokenMatch = fontTokenRe.exec(out)) !== null) {
    const token = tokenMatch[0];
    if (token === `

` || token === `\r
\r
` || /^\r?\n\r?\n$/.test(token)) {
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
var OPEN_BOUNDARY_RE = /[\s([{"'\u201C\u2018\u00AB>\u2014\u2013-]/;
var CLOSE_BOUNDARY_RE = /[\s)\]},.!?:;"'\u201D\u2019\u00BB<\u2014\u2013-]/;
var HAS_ALNUM_RE = /[\p{L}\p{N}]/u;
function findHtmlTagSpansOnLine(line) {
  const spans = [];
  for (let i = 0;i < line.length; i += 1) {
    if (line[i] !== "<")
      continue;
    const next = line[i + 1];
    if (!next || !/[a-zA-Z!?/]/.test(next))
      continue;
    let attrQuote = null;
    let closedAt = -1;
    for (let j = i + 1;j < line.length; j += 1) {
      const ch = line[j];
      if (attrQuote) {
        if (ch === attrQuote && countPrecedingBackslashes(line, j) % 2 === 0) {
          attrQuote = null;
        }
      } else if (ch === '"' || ch === "'") {
        attrQuote = ch;
      } else if (ch === ">") {
        closedAt = j + 1;
        break;
      }
    }
    if (closedAt > i) {
      spans.push({ start: i, end: closedAt });
      i = closedAt - 1;
    }
  }
  return spans;
}
function isInsideSpans(index, spans) {
  for (const span of spans) {
    if (index < span.start)
      return false;
    if (index < span.end)
      return true;
  }
  return false;
}
function applyTextEdits(line, edits) {
  if (edits.length === 0)
    return line;
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor)
      continue;
    out += line.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + line.slice(cursor);
}
function trimInnerWhitespaceInPairs(line, openChar, closeChar, tagSpans = findHtmlTagSpansOnLine(line)) {
  const edits = [];
  let openEnd = -1;
  for (let i = 0;i < line.length; i += 1) {
    const ch = line[i];
    if (ch !== openChar && ch !== closeChar)
      continue;
    if (isInsideSpans(i, tagSpans))
      continue;
    if (countPrecedingBackslashes(line, i) % 2 === 1)
      continue;
    const canOpen = i === 0 || OPEN_BOUNDARY_RE.test(line[i - 1]);
    const canClose = i + 1 === line.length || CLOSE_BOUNDARY_RE.test(line[i + 1]);
    if (openChar === closeChar) {
      if (openEnd === -1) {
        if (canOpen) {
          openEnd = i + 1;
        }
      } else if (canClose) {
        const inner = line.slice(openEnd, i);
        const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
        if (trimmed !== inner && trimmed.length > 0 && HAS_ALNUM_RE.test(trimmed)) {
          edits.push({ start: openEnd, end: i, replacement: trimmed });
        }
        openEnd = -1;
      }
    } else {
      if (ch === openChar) {
        if (canOpen) {
          openEnd = i + 1;
        }
      } else if (ch === closeChar && openEnd !== -1 && canClose) {
        const inner = line.slice(openEnd, i);
        const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
        if (trimmed !== inner && trimmed.length > 0 && HAS_ALNUM_RE.test(trimmed)) {
          edits.push({ start: openEnd, end: i, replacement: trimmed });
        }
        openEnd = -1;
      }
    }
  }
  return applyTextEdits(line, edits);
}
function trimDelimiterOnLine(line, delimiter, tagSpans) {
  let out = line;
  let currentTagSpans = tagSpans;
  for (const size of [3, 2, 1]) {
    if (out !== line) {
      currentTagSpans = findHtmlTagSpansOnLine(out);
    }
    const runs = [];
    for (let i = 0;i < out.length; ) {
      if (out[i] !== delimiter) {
        i += 1;
        continue;
      }
      if (isInsideSpans(i, currentTagSpans) || countPrecedingBackslashes(out, i) % 2 === 1) {
        while (i < out.length && out[i] === delimiter)
          i += 1;
        continue;
      }
      const runStart = i;
      while (i < out.length && out[i] === delimiter)
        i += 1;
      const runEnd = i;
      if (runEnd - runStart !== size)
        continue;
      const canOpen = runStart === 0 || OPEN_BOUNDARY_RE.test(out[runStart - 1]);
      const canClose = runEnd === out.length || CLOSE_BOUNDARY_RE.test(out[runEnd]);
      let isMath = false;
      if (delimiter === "*" && (size === 1 || size === 2)) {
        const hasLeftMath = /[\d)][ \t]+$/.test(out.slice(0, runStart));
        const hasRightMath = /^[ \t]+[\d(]/.test(out.slice(runEnd));
        isMath = hasLeftMath && hasRightMath;
      }
      runs.push({ start: runStart, end: runEnd, canOpen, canClose, isMath });
    }
    const nonMathRuns = runs.filter((r) => !r.isMath);
    if (nonMathRuns.length < 2)
      continue;
    if (delimiter === "*" && size === 1 && /^[ \t]*\*(?!\*)[ \t]+/.test(out) && nonMathRuns.length % 2 === 1) {
      continue;
    }
    const marker = delimiter.repeat(size);
    const edits = [];
    let openRun = null;
    for (const run of nonMathRuns) {
      if (!openRun) {
        if (run.canOpen) {
          openRun = run;
        }
        continue;
      }
      if (run.canClose) {
        const inner = out.slice(openRun.end, run.start);
        const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
        const safeInner = trimmed !== inner && trimmed.length > 0 && HAS_ALNUM_RE.test(trimmed) && !trimmed.startsWith(delimiter) && !trimmed.endsWith(delimiter) && !trimmed.includes(marker) && (size > 1 || !inner.includes(delimiter));
        if (safeInner) {
          edits.push({ start: openRun.end, end: run.start, replacement: trimmed });
        }
        openRun = null;
      } else if (run.canOpen) {
        openRun = run;
      }
    }
    out = applyTextEdits(out, edits);
  }
  return out;
}
function trimEmphasisOnLine(line, tagSpans = findHtmlTagSpansOnLine(line)) {
  let out = trimDelimiterOnLine(line, "*", tagSpans);
  const nextSpans = out === line ? tagSpans : findHtmlTagSpansOnLine(out);
  out = trimDelimiterOnLine(out, "_", nextSpans);
  return out;
}
function healProseSegment(prose) {
  const out = healFontTagsAndAttributes(prose);
  const lines = out.split(`
`);
  for (let i = 0;i < lines.length; i += 1) {
    let line = lines[i];
    for (let pass = 0;pass < 2; pass += 1) {
      let next = trimEmphasisOnLine(line);
      const tagSpans = findHtmlTagSpansOnLine(next);
      next = trimInnerWhitespaceInPairs(next, '"', '"', tagSpans);
      next = trimInnerWhitespaceInPairs(next, "\u201C", "\u201D", tagSpans);
      next = trimInnerWhitespaceInPairs(next, "\u2018", "\u2019", tagSpans);
      if (next === line)
        break;
      line = next;
    }
    lines[i] = line;
  }
  return lines.join(`
`);
}
function findFencedCodeSpans(text) {
  const fenceLines = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf(`
`, pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    const m = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (m) {
      const fence = m[1];
      const info = m[2];
      fenceLines.push({
        lineStart: pos,
        lineEnd,
        fenceChar: fence[0],
        fenceLen: fence.length,
        isCloserOnly: /^[ \t]*$/.test(info),
        infoHasBacktick: fence[0] === "`" && info.includes("`")
      });
    }
    if (nl === -1)
      break;
    pos = nl + 1;
  }
  const spans = [];
  for (let i = 0;i < fenceLines.length; i += 1) {
    const open = fenceLines[i];
    if (open.infoHasBacktick)
      continue;
    for (let j = i + 1;j < fenceLines.length; j += 1) {
      const close = fenceLines[j];
      if (close.isCloserOnly && close.fenceChar === open.fenceChar && close.fenceLen >= open.fenceLen) {
        spans.push({ start: open.lineStart, end: close.lineEnd });
        i = j;
        break;
      }
    }
  }
  return spans;
}
var JSON_OPEN_TAG_RE = /<json(?:\s[^>]*)?>/gi;
var JSON_TAG_AT_RE = /<\/?json(?:\s[^>]*)?>/iy;
var JSON_START_RE = /[ \t\n\r]*[-0-9"[{tfn]/y;
var MAX_REJECTED_JSON_CANDIDATES = 256;
function indexOfJsonTagOutsideStrings(text, from, limit) {
  let inString = false;
  for (let i = from;i < limit; i += 1) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 92)
        i += 1;
      else if (ch === 34)
        inString = false;
    } else if (ch === 34) {
      inString = true;
    } else if (ch === 60) {
      JSON_TAG_AT_RE.lastIndex = i;
      const m = JSON_TAG_AT_RE.exec(text);
      if (m && i + m[0].length <= limit)
        return i;
    }
  }
  return -1;
}
function findJsonBlockSpans(text, from, to) {
  const spans = [];
  let rejected = 0;
  const findOpen = (start) => {
    JSON_OPEN_TAG_RE.lastIndex = start;
    const m = JSON_OPEN_TAG_RE.exec(text);
    if (!m || m.index + m[0].length > to)
      return null;
    return { start: m.index, end: m.index + m[0].length };
  };
  let open = findOpen(from);
  while (open) {
    const innerStart = open.end;
    const tagIdx = indexOfJsonTagOutsideStrings(text, innerStart, to);
    if (tagIdx >= 0 && text.charCodeAt(tagIdx + 1) !== 47) {
      open = findOpen(tagIdx);
      continue;
    }
    let validBlockEnd = -1;
    if (tagIdx >= 0) {
      JSON_TAG_AT_RE.lastIndex = tagIdx;
      const closeTag = JSON_TAG_AT_RE.exec(text);
      if (closeTag && closeTag[0].toLowerCase() === "</json>") {
        JSON_START_RE.lastIndex = innerStart;
        if (JSON_START_RE.test(text)) {
          try {
            JSON.parse(text.slice(innerStart, tagIdx));
            validBlockEnd = tagIdx + closeTag[0].length;
          } catch {
            validBlockEnd = -1;
          }
        }
      }
    }
    if (validBlockEnd >= 0) {
      spans.push({ start: open.start, end: validBlockEnd });
      open = findOpen(validBlockEnd);
    } else if (++rejected === MAX_REJECTED_JSON_CANDIDATES) {
      return { spans, stoppedAt: open.start };
    } else {
      open = findOpen(innerStart);
    }
  }
  return { spans, stoppedAt: to };
}
function healInlineBackticksAndProse(segment) {
  const runs = [];
  const byLen = new Map;
  for (let i = 0;i < segment.length; ) {
    if (segment[i] !== "`") {
      i += 1;
      continue;
    }
    const start = i;
    while (i < segment.length && segment[i] === "`")
      i += 1;
    const len = i - start;
    const runIdx = runs.length;
    runs.push({ start, end: i, len });
    let list = byLen.get(len);
    if (!list) {
      list = [];
      byLen.set(len, list);
    }
    list.push(runIdx);
  }
  if (runs.length < 2) {
    return healProseSegment(segment);
  }
  const lenCursors = new Map;
  let result = "";
  let textCursor = 0;
  for (let rIdx = 0;rIdx < runs.length; rIdx += 1) {
    const open = runs[rIdx];
    if (open.start < textCursor)
      continue;
    const list = byLen.get(open.len);
    let ptr = lenCursors.get(open.len) ?? 0;
    while (ptr < list.length && list[ptr] <= rIdx) {
      ptr += 1;
    }
    lenCursors.set(open.len, ptr);
    if (ptr >= list.length)
      continue;
    const closeIdx = list[ptr];
    const close = runs[closeIdx];
    if (open.start > textCursor) {
      result += healProseSegment(segment.slice(textCursor, open.start));
    }
    result += segment.slice(open.start, close.end);
    textCursor = close.end;
    lenCursors.set(open.len, ptr + 1);
    rIdx = closeIdx;
  }
  if (textCursor < segment.length) {
    result += healProseSegment(segment.slice(textCursor));
  }
  return result;
}
function healOutsideJsonBlocks(text, from, to) {
  const { spans, stoppedAt } = findJsonBlockSpans(text, from, to);
  let result = "";
  let cursor = from;
  for (const span of spans) {
    if (span.start > cursor) {
      result += healInlineBackticksAndProse(text.slice(cursor, span.start));
    }
    result += text.slice(span.start, span.end);
    cursor = span.end;
  }
  if (stoppedAt > cursor) {
    result += healInlineBackticksAndProse(text.slice(cursor, stoppedAt));
  }
  if (stoppedAt < to) {
    result += text.slice(stoppedAt, to);
  }
  return result;
}
function healFormattingArtifacts(text) {
  if (!text || typeof text !== "string") {
    return text;
  }
  const fencedSpans = findFencedCodeSpans(text);
  let result = "";
  let lastIndex = 0;
  for (const span of fencedSpans) {
    if (span.start > lastIndex) {
      result += healOutsideJsonBlocks(text, lastIndex, span.start);
    }
    result += text.slice(span.start, span.end);
    lastIndex = span.end;
  }
  if (lastIndex < text.length) {
    result += healOutsideJsonBlocks(text, lastIndex, text.length);
  }
  return result;
}
async function processResponseOutput(options) {
  const processedContent = healFormattingArtifacts(await applyRegexScripts(options.content, options.scripts, "ai_output", 0, {
    resolveMacros: options.resolveMacros,
    ...options.previousContent !== undefined ? { previousContent: options.previousContent } : {}
  }));
  let processedReasoning = options.reasoning;
  if (typeof options.reasoning === "string" && options.reasoning.length > 0) {
    processedReasoning = await applyRegexScripts(options.reasoning, options.scripts, "reasoning", 0, {
      resolveMacros: options.resolveMacros,
      ...options.previousContent !== undefined ? { previousContent: options.previousContent } : {}
    });
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
function extractPresetStreamingOverride(preset) {
  const overrides = preset?.parameters?.samplerOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return;
  }
  const streaming = overrides.streaming;
  return typeof streaming === "boolean" ? streaming : undefined;
}
function prepareOutboundGenerationInput(rawInput) {
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
      parameters: sanitizedParameters
    }
  };
}
function asGenerationResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw;
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
  syncInterceptorRegistration() {
    if (!this.spindle.permissions?.has?.("interceptor")) {
      if (this.interceptorDisposer) {
        this.interceptorDisposer();
        this.interceptorDisposer = null;
      }
      return;
    }
    this.ensureInterceptorRegistered();
  }
  ensureInterceptorRegistered() {
    if (!this.spindle.permissions?.has?.("interceptor")) {
      if (this.interceptorDisposer) {
        this.interceptorDisposer();
        this.interceptorDisposer = null;
      }
      return;
    }
    if (this.interceptorDisposer)
      return;
    if (typeof this.spindle.registerInterceptor !== "function")
      return;
    try {
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
          const matchesUser = !pending.userId || !context.userId || context.userId === pending.userId;
          const matchesGenType = !pending.generationType || !context.generationType || context.generationType === pending.generationType;
          const matchesPreset = !pending.presetId || context.presetId === pending.presetId;
          if (matchesUser && matchesGenType && matchesPreset) {
            pending.capturedMessages = messages.map((m) => ({
              ...m
            }));
          }
        }
        return messages;
      });
    } catch {
      this.interceptorDisposer = null;
    }
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
      const capture = {
        userId,
        generationType: dryRunInput.generationType ?? "normal",
        presetId: dryRunInput.presetId ?? null
      };
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
  setActiveRun(key, run) {
    let userRuns = this.activeRuns.get(key);
    if (!userRuns) {
      userRuns = new Map;
      this.activeRuns.set(key, userRuns);
    }
    userRuns.set(run.state.runId, run);
  }
  deleteActiveRun(key, runId) {
    const userRuns = this.activeRuns.get(key);
    if (!userRuns || !userRuns.has(runId))
      return false;
    userRuns.delete(runId);
    if (userRuns.size === 0) {
      this.activeRuns.delete(key);
    }
    return true;
  }
  addPendingRun(key, entry) {
    const list = this.pendingUsers.get(key);
    if (list) {
      list.push(entry);
    } else {
      this.pendingUsers.set(key, [entry]);
    }
  }
  removePendingRun(key, entry) {
    const list = this.pendingUsers.get(key);
    if (!list)
      return;
    const idx = list.indexOf(entry);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
    if (list.length === 0) {
      this.pendingUsers.delete(key);
    }
  }
  isChatBusy(key, chatId, excludePending) {
    const trimmed = typeof chatId === "string" && chatId.trim().length > 0 ? chatId.trim() : null;
    const userRuns = this.activeRuns.get(key);
    if (trimmed && userRuns) {
      for (const run of userRuns.values()) {
        if (run.state.chatId === trimmed)
          return true;
      }
    }
    const pendingList = this.pendingUsers.get(key);
    if (pendingList && pendingList.length > 0) {
      for (const pending of pendingList) {
        if (pending === excludePending)
          continue;
        if (trimmed) {
          if (pending.chatId === trimmed || !pending.chatId)
            return true;
        } else {
          if (!pending.chatId)
            return true;
        }
      }
    }
    return false;
  }
  getActiveRuns(userId) {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    if (!userRuns || userRuns.size === 0)
      return [];
    return Array.from(userRuns.values(), (run) => ({ ...run.state }));
  }
  getActiveRun(userId, chatId) {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    if (!userRuns || userRuns.size === 0)
      return null;
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
  updateActiveRunState(userId, runId, patch) {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    const active = userRuns?.get(runId);
    if (!active) {
      return;
    }
    active.state = {
      ...active.state,
      ...patch
    };
    this.emitStatus(userId, runId);
  }
  abortCurrent(userId, runId, chatId) {
    const key = this.userKey(userId);
    const userRuns = this.activeRuns.get(key);
    const trimmedChatId = typeof chatId === "string" && chatId.trim().length > 0 ? chatId.trim() : undefined;
    if (runId) {
      const run = userRuns?.get(runId);
      if (!run)
        return false;
      run.controller.abort();
      return true;
    }
    if (userRuns && userRuns.size > 0) {
      const runs = Array.from(userRuns.values());
      const targetRun = trimmedChatId ? [...runs].reverse().find((run) => run.state.chatId === trimmedChatId) : runs[runs.length - 1];
      if (targetRun) {
        targetRun.controller.abort();
        return true;
      }
    }
    const pendingList = this.pendingUsers.get(key);
    if (pendingList && pendingList.length > 0) {
      const abortablePending = pendingList.filter((entry) => Boolean(entry.controller));
      const reversedPending = [...abortablePending].reverse();
      const targetPending = trimmedChatId ? reversedPending.find((entry) => entry.chatId === trimmedChatId) ?? reversedPending.find((entry) => entry.chatId === undefined) : abortablePending[abortablePending.length - 1];
      if (targetPending?.controller) {
        targetPending.controller.abort();
        return true;
      }
    }
    return false;
  }
  async run(input, userId) {
    const key = this.userKey(userId);
    const requestedChatId = typeof input.chatId === "string" && input.chatId.trim().length > 0 ? input.chatId.trim() : null;
    if (this.isChatBusy(key, requestedChatId)) {
      throw new Error("A Guided Generations action is already running. Stop it before starting another.");
    }
    this.assertRequiredPermissions(input.actionId);
    const controller = new AbortController;
    const pendingEntry = {
      controller,
      ...requestedChatId ? { chatId: requestedChatId } : {}
    };
    this.addPendingRun(key, pendingEntry);
    let runId;
    let resolvedChatId;
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
      const { chatId, characterId, characterName, avatarUrl } = await this.resolveChatContext(requestedChatId, userId);
      resolvedChatId = chatId;
      pendingEntry.chatId = chatId;
      if (this.isChatBusy(key, chatId, pendingEntry)) {
        emitErrorStatus = false;
        throw new Error("A Guided Generations action is already running. Stop it before starting another.");
      }
      runId = `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      if (controller.signal.aborted) {
        wasAborted = true;
        return {
          runId,
          actionId: input.actionId,
          chatId,
          aborted: true,
          text: ""
        };
      }
      this.setActiveRun(key, {
        state: {
          runId,
          actionId: input.actionId,
          chatId,
          startedAt: Date.now(),
          ...characterId ? { characterId } : {},
          ...characterName ? { characterName } : {},
          ...avatarUrl ? { avatarUrl } : {}
        },
        controller
      });
      this.removePendingRun(key, pendingEntry);
      this.emitStatus(userId, runId);
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
      let targetSwipeIsBlank = false;
      if (input.actionId === "guided_continue" || input.actionId === "guided_swipe") {
        preTargetMessage = await this.requireLastAssistantMessage(chatId);
        targetAssistantId = preTargetMessage.id;
        if (input.actionId === "guided_swipe") {
          const preNorm = normalizeMessageSwipes(preTargetMessage);
          const activeSwipeText = preNorm.swipes[preNorm.activeIndex] ?? preTargetMessage.content ?? "";
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
      let pendingBlankSlotCreate = false;
      let pendingSwipeSlotWrite = null;
      const activeRunId = runId;
      const createBlankAssistantSlot = async () => {
        const metadata = resolvedPresetId ? buildPresetContextMetadata(undefined, 0, resolvedPresetId) : undefined;
        const created = await this.spindle.chat.appendMessage(chatId, {
          role: "assistant",
          content: "",
          ...metadata ? { metadata } : {}
        }, { triggerGeneration: false });
        createdMessageId = created.id;
        createdSwipeDates = [Math.floor(Date.now() / 1000)];
        this.updateActiveRunState(userId, activeRunId, {
          messageId: created.id,
          swipeId: 0
        });
      };
      try {
        if (input.actionId === "guided_response") {
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
              text: ""
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
              text: ""
            };
          }
          pendingBlankSlotCreate = true;
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
          const session = this.createGuidedSwipeSession(chatId, preTargetMessage, userId, {
            onTargetSwipeIndexChanged: (swipeId) => {
              this.updateActiveRunState(userId, activeRunId, { swipeId });
            },
            onTargetDeleted: () => {
              controller.abort();
            }
          });
          swipeSession = session;
          pendingSwipeSlotWrite = async () => {
            const latestTarget = await this.readTargetMessageOrThrow(chatId, session.targetAssistantId);
            session.syncFromLatestMessage(latestTarget);
            const metadata = resolvedPresetId ? buildPresetContextMetadata(latestTarget.metadata, session.newSwipeIndex, resolvedPresetId) : undefined;
            const seqBeforeWrite = session.getSwipeEventSeq();
            if (!backgroundSwipe) {
              await this.spindle.chat.updateMessage(chatId, session.targetAssistantId, buildActiveSwipePatch({
                swipes: session.swipes,
                swipeIndex: session.newSwipeIndex,
                content: "",
                swipeDates: session.swipeDates,
                ...metadata ? { metadata } : {},
                skipChunkRebuild: true
              }));
              if (session.getSwipeEventSeq() === seqBeforeWrite && session.getCurrentViewedSwipeId() === session.initialSwipeId) {
                session.setCurrentViewedSwipeId(session.newSwipeIndex);
              }
            } else {
              await this.spindle.chat.updateMessage(chatId, session.targetAssistantId, buildBackgroundSwipePatch({
                swipes: session.swipes,
                swipeIndex: session.newSwipeIndex,
                content: "",
                swipeDates: session.swipeDates,
                ...metadata ? { metadata } : {}
              }));
            }
            session.markSlotCreated();
            this.updateActiveRunState(userId, activeRunId, {
              messageId: session.targetAssistantId,
              swipeId: session.newSwipeIndex,
              backgroundSwipe
            });
          };
        }
        const dryRunCapture = await this.runDryRunWithCapture(chatId, dryRunInput, userId);
        const dryRunResult = dryRunCapture.result;
        const capturedMessages = dryRunCapture.capturedMessages;
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
            text: ""
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
          resolvedPresetId,
          presetStreaming: presetContext.presetStreaming,
          dryRunResult,
          capturedMessages,
          signal: controller.signal,
          createdMessageId,
          targetAssistantId,
          skipBlankAssistantStrip: pendingBlankSlotCreate,
          targetSwipeIsBlank
        });
        let result;
        switch (input.actionId) {
          case "guided_response":
          case "guided_regenerate":
            handoffToAssistantExecution = true;
            result = await this.executeAssistantResponse(input.actionId, runId, chatId, createdMessageId, createdSwipeDates, rawInput, controller.signal, regeneratedSnapshot, transformResponseOutput, userId, metricsPreset);
            break;
          case "guided_continue":
            result = await this.executeGuidedContinue(runId, chatId, targetAssistantId, input.inputText, rawInput, controller.signal, userId, transformResponseOutput, metricsPreset);
            break;
          case "guided_swipe":
            handoffToAssistantExecution = true;
            result = await this.executeGuidedSwipe(runId, chatId, swipeSession, rawInput, controller.signal, transformResponseOutput, userId, metricsPreset);
            break;
          case "guided_impersonate":
            result = await this.executeImpersonate(runId, chatId, rawInput, controller.signal, userId, transformImpersonateOutput);
            break;
          default: {
            const exhaustive = input.actionId;
            throw new Error(`Unsupported Guided Generations action: ${String(exhaustive)}`);
          }
        }
        wasAborted = result.aborted;
        return result;
      } catch (error) {
        if (!handoffToAssistantExecution) {
          if (regeneratedSnapshot) {
            await this.restoreTrailingAssistant(chatId, regeneratedSnapshot, createdMessageId, userId);
          } else if (input.actionId === "guided_response" && createdMessageId) {
            await this.spindle.chat.deleteMessage(chatId, createdMessageId).catch(() => {
              return;
            });
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
        this.emitFrontend({
          type: "gg:status",
          error: message,
          run: this.getActiveRun(userId),
          ...errorChatId ? { chatId: errorChatId } : {}
        }, userId);
      }
      throw error;
    } finally {
      this.removePendingRun(key, pendingEntry);
      if (runId && this.deleteActiveRun(key, runId)) {
        if (controller.signal.aborted) {
          wasAborted = true;
        }
        this.emitFrontend({
          type: "gg:status",
          run: this.getActiveRun(userId),
          ...resolvedChatId ? { chatId: resolvedChatId } : {},
          done: !wasAborted,
          aborted: wasAborted
        }, userId);
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
    const requestedChatId = typeof input.chatId === "string" && input.chatId.trim().length > 0 ? input.chatId.trim() : null;
    if (this.isChatBusy(key, requestedChatId)) {
      throw new Error("A Guided Generations action is already running. Stop it before removing a continue.");
    }
    const pendingEntry = {
      ...requestedChatId ? { chatId: requestedChatId } : {}
    };
    this.addPendingRun(key, pendingEntry);
    try {
      const { chatId } = await this.resolveChatContext(requestedChatId, userId);
      pendingEntry.chatId = chatId;
      if (this.isChatBusy(key, chatId, pendingEntry)) {
        throw new Error("A Guided Generations action is already running. Stop it before removing a continue.");
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
      this.removePendingRun(key, pendingEntry);
    }
  }
  async regenerateLastContinue(input = {}, userId) {
    const key = this.userKey(userId);
    const requestedChatId = typeof input.chatId === "string" && input.chatId.trim().length > 0 ? input.chatId.trim() : null;
    if (this.isChatBusy(key, requestedChatId)) {
      throw new Error("A Guided Generations action is already running. Stop it before starting another.");
    }
    this.assertRequiredPermissions("guided_continue");
    const controller = new AbortController;
    const pendingEntry = {
      controller,
      ...requestedChatId ? { chatId: requestedChatId } : {}
    };
    this.addPendingRun(key, pendingEntry);
    let runId;
    let resolvedChatId;
    let wasAborted = false;
    let emitErrorStatus = true;
    try {
      const settings = await this.store.getSettings(userId);
      const config = settings.actions.guided_continue;
      if (!config.enabled) {
        throw new Error("Guided Generations action 'guided_continue' is disabled in Settings.");
      }
      const { chatId, characterId, characterName, avatarUrl } = await this.resolveChatContext(requestedChatId, userId);
      resolvedChatId = chatId;
      pendingEntry.chatId = chatId;
      if (this.isChatBusy(key, chatId, pendingEntry)) {
        emitErrorStatus = false;
        throw new Error("A Guided Generations action is already running. Stop it before starting another.");
      }
      if (controller.signal.aborted) {
        wasAborted = true;
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
        wasAborted = true;
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
      this.setActiveRun(key, {
        state: {
          runId: activeRunId,
          actionId: "guided_continue",
          chatId,
          startedAt: Date.now(),
          ...characterId ? { characterId } : {},
          ...characterName ? { characterName } : {},
          ...avatarUrl ? { avatarUrl } : {}
        },
        controller
      });
      this.removePendingRun(key, pendingEntry);
      this.emitStatus(userId, activeRunId);
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
        wasAborted = true;
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
      let didCommitHistory = false;
      try {
        const dryRunInput = buildDryRunInput({
          chatId,
          actionId: "guided_continue",
          config,
          activeConnectionId: connectionId
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
          resolvedPresetId,
          presetStreaming: presetContext.presetStreaming,
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
          didCommitHistory = true;
        }, () => {
          this.updateActiveRunState(userId, activeRunId, { hasContentOutput: true });
        });
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
        didCommitHistory = true;
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
        wasAborted = streamRes.aborted;
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
        this.emitFrontend({
          type: "gg:status",
          error: message,
          run: this.getActiveRun(userId),
          ...errorChatId ? { chatId: errorChatId } : {}
        }, userId);
      }
      throw error;
    } finally {
      this.removePendingRun(key, pendingEntry);
      if (runId && this.deleteActiveRun(key, runId)) {
        if (controller.signal.aborted) {
          wasAborted = true;
        }
        this.emitFrontend({
          type: "gg:status",
          run: this.getActiveRun(userId),
          ...resolvedChatId ? { chatId: resolvedChatId } : {},
          done: !wasAborted,
          aborted: wasAborted
        }, userId);
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
      resolvedPresetId,
      presetStreaming,
      dryRunResult,
      capturedMessages,
      signal,
      createdMessageId,
      targetAssistantId,
      skipBlankAssistantStrip,
      targetSwipeIsBlank
    } = args;
    const { model, provider } = resolveEffectiveModelAndProvider({
      configuredModel: config.model,
      connectionModel: resolvedConnection?.model,
      connectionProvider: resolvedConnection?.provider,
      dryRunModel: dryRunResult.model,
      dryRunProvider: dryRunResult.provider
    });
    const {
      messages: rawAssembled,
      reapplyRoleMerge,
      applyEmptyFilter,
      collapseToSingleRole
    } = this.mergeDryRunAndCapturedMessages(dryRunResult, capturedMessages);
    let isChatHistory = resolveChatHistoryFlags(rawAssembled, {
      breakdown: dryRunResult.breakdown
    });
    if (!isChatHistory) {
      const effectivePresetId = config.presetId ?? resolvedPresetId ?? resolvedConnection?.preset_id ?? null;
      const presetBlocks = await this.fetchPresetBlocksFallback(effectivePresetId, userId);
      if (presetBlocks && presetBlocks.length > 0) {
        isChatHistory = resolveChatHistoryFlags(rawAssembled, {
          breakdown: dryRunResult.breakdown,
          presetBlocks
        });
      }
    }
    let assembledMessages = rawAssembled;
    if (!skipBlankAssistantStrip && (actionId === "guided_response" || actionId === "guided_regenerate")) {
      const stripped = stripCreatedBlankAssistantTurnWithHistory(rawAssembled, createdMessageId, isChatHistory);
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    } else if (actionId === "guided_swipe") {
      const stripped = stripRejectedSwipeAssistantTurnWithHistory(rawAssembled, targetAssistantId, isChatHistory, ...targetSwipeIsBlank ? [{ requireBlankFallback: true }] : []);
      assembledMessages = stripped.messages;
      isChatHistory = stripped.isChatHistory;
    }
    if (applyEmptyFilter) {
      const keptMessages = [];
      const hasAlignedFlags = Array.isArray(isChatHistory) && isChatHistory.length === assembledMessages.length;
      const keptFlags = hasAlignedFlags ? [] : undefined;
      for (let i = 0;i < assembledMessages.length; i += 1) {
        const msg = assembledMessages[i];
        if (hasNonEmptyLlmContent(msg)) {
          keptMessages.push(msg);
          if (keptFlags) {
            keptFlags.push(Boolean(isChatHistory[i]));
          }
        }
      }
      assembledMessages = keptMessages;
      if (keptFlags) {
        isChatHistory = keptFlags;
      }
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
    const postProcessedMessages = reapplyRoleMerge ? mergeConsecutiveSameRoleMessages(injectedMessages) : injectedMessages;
    const filteredMessages = applyEmptyFilter ? postProcessedMessages.filter(hasNonEmptyLlmContent) : postProcessedMessages;
    const collapsedMessages = collapseToSingleRole ? collapseMessagesToSingleRole(filteredMessages, collapseToSingleRole) : filteredMessages;
    const messages = stripInternalMessageMarkers(collapsedMessages);
    const transformResponseOutput = config.applyRegex ? async ({ deltaText, reasoningText, baseText }) => {
      if (baseText) {
        const regexedDelta = await applyRegexScripts(deltaText, responseScripts, "ai_output", 0, { resolveMacros });
        const healedFinal = healFormattingArtifacts(stitchContinueContent(baseText, regexedDelta));
        const processedReasoning = reasoningText.length > 0 ? await applyRegexScripts(reasoningText, responseScripts, "reasoning", 0, {
          resolveMacros
        }) : reasoningText;
        return {
          deltaText: regexedDelta,
          reasoningText: processedReasoning,
          finalText: healedFinal
        };
      }
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
    const rawParams = dryRunResult.parameters;
    const parameters = presetStreaming === false && rawParams?._streaming === undefined ? { ...rawParams ?? {}, _streaming: false } : rawParams;
    const rawInput = {
      type: "raw",
      messages,
      parameters,
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
    let chat = null;
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
    const characterId = typeof chat.character_id === "string" && chat.character_id ? chat.character_id : undefined;
    let characterName;
    const avatarUrl = characterId ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?thumb=1` : undefined;
    if (characterId && this.spindle.permissions?.has?.("characters")) {
      const charactersApi = this.spindle.characters;
      if (typeof charactersApi?.get === "function") {
        try {
          const character = await charactersApi.get(characterId, userId);
          if (typeof character?.name === "string" && character.name.trim().length > 0) {
            characterName = character.name.trim();
          }
        } catch {}
      }
    }
    return {
      chatId: chat.id,
      ...characterId ? { characterId } : {},
      ...characterName ? { characterName } : {},
      ...avatarUrl ? { avatarUrl } : {}
    };
  }
  mergeDryRunAndCapturedMessages(dryRunResult, capturedMessages) {
    const requestMessages = dryRunResult.request_messages;
    if (Array.isArray(requestMessages)) {
      const reqHasMetadata = requestMessages.some((m) => typeof m.__isChatHistory === "boolean" || typeof m.__chatHistorySource === "boolean" || typeof m.sourceMessageId === "string" && m.sourceMessageId.length > 0 || typeof m.__sourceMessageId === "string" && m.__sourceMessageId.length > 0);
      if (capturedMessages && capturedMessages.length > 0) {
        const copyFlagsFromCapture = (msg, cap) => ({
          ...msg,
          ...msg.__isChatHistory === undefined && cap.__isChatHistory !== undefined ? { __isChatHistory: cap.__isChatHistory } : {},
          ...msg.__isWorldInfoEntry === undefined && cap.__isWorldInfoEntry !== undefined ? { __isWorldInfoEntry: cap.__isWorldInfoEntry } : {},
          ...msg.__chatHistorySource === undefined && cap.__chatHistorySource !== undefined ? { __chatHistorySource: cap.__chatHistorySource } : {},
          ...msg.__worldInfoSource === undefined && cap.__worldInfoSource !== undefined ? { __worldInfoSource: cap.__worldInfoSource } : {},
          ...msg.sourceMessageId === undefined && cap.sourceMessageId !== undefined ? { sourceMessageId: cap.sourceMessageId } : {},
          ...msg.__sourceMessageId === undefined && cap.__sourceMessageId !== undefined ? { __sourceMessageId: cap.__sourceMessageId } : {},
          ...msg.sourceIndexInChat === undefined && cap.sourceIndexInChat !== undefined ? { sourceIndexInChat: cap.sourceIndexInChat } : {},
          ...msg.__sourceIndexInChat === undefined && cap.__sourceIndexInChat !== undefined ? { __sourceIndexInChat: cap.__sourceIndexInChat } : {}
        });
        if (capturedMessages.length === requestMessages.length) {
          return {
            messages: requestMessages.map((msg, idx) => copyFlagsFromCapture(msg, capturedMessages[idx])),
            reapplyRoleMerge: false,
            applyEmptyFilter: false
          };
        }
        const filteredIndices = [];
        for (let i = 0;i < capturedMessages.length; i += 1) {
          if (hasNonEmptyLlmContent(capturedMessages[i])) {
            filteredIndices.push(i);
          }
        }
        const matchesFilteredCapture = filteredIndices.length === requestMessages.length && filteredIndices.every((capIdx, reqIdx) => capturedMessages[capIdx].role === requestMessages[reqIdx].role);
        if (matchesFilteredCapture) {
          const reqIdxByCapIdx = new Map;
          filteredIndices.forEach((capIdx, reqIdx) => {
            reqIdxByCapIdx.set(capIdx, reqIdx);
          });
          const reconstructed = capturedMessages.map((cap, capIdx) => {
            const reqIdx = reqIdxByCapIdx.get(capIdx);
            if (reqIdx === undefined) {
              return { ...cap };
            }
            const req = requestMessages[reqIdx];
            return copyFlagsFromCapture({
              ...cap,
              role: req.role,
              content: req.content,
              ...req.name !== undefined ? { name: req.name } : {},
              ...req.partial !== undefined ? { partial: req.partial } : {}
            }, cap);
          });
          return {
            messages: reconstructed,
            reapplyRoleMerge: false,
            applyEmptyFilter: true
          };
        }
        const mergedFilteredCapture = mergeConsecutiveSameRoleMessages(capturedMessages).filter(hasNonEmptyLlmContent);
        const didMergeConsecutiveRoles = capturedMessages.length > requestMessages.length && mergedFilteredCapture.length === requestMessages.length && mergedFilteredCapture.every((msg, idx) => msg.role === requestMessages[idx]?.role);
        if (didMergeConsecutiveRoles) {
          return {
            messages: capturedMessages,
            reapplyRoleMerge: true,
            applyEmptyFilter: true
          };
        }
        const singleCollapsedRole = requestMessages.length === 1 && capturedMessages.length > 1 && !reqHasMetadata && (requestMessages[0]?.role === "system" || requestMessages[0]?.role === "user") ? requestMessages[0].role : undefined;
        if (singleCollapsedRole) {
          return {
            messages: capturedMessages,
            reapplyRoleMerge: false,
            applyEmptyFilter: true,
            collapseToSingleRole: singleCollapsedRole
          };
        }
        if (!reqHasMetadata) {
          return {
            messages: capturedMessages,
            reapplyRoleMerge: false,
            applyEmptyFilter: true
          };
        }
      }
      return {
        messages: requestMessages,
        reapplyRoleMerge: false,
        applyEmptyFilter: false
      };
    }
    if (capturedMessages && capturedMessages.length > 0) {
      return {
        messages: capturedMessages,
        reapplyRoleMerge: false,
        applyEmptyFilter: false
      };
    }
    return {
      messages: dryRunResult.messages,
      reapplyRoleMerge: false,
      applyEmptyFilter: false
    };
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
        const presetStreaming = extractPresetStreamingOverride(preverifiedPreset);
        return {
          presetId: trimmedConfigured,
          ...name ? { presetName: name } : {},
          ...presetStreaming !== undefined ? { presetStreaming } : {}
        };
      }
      if (typeof this.spindle.presets?.get === "function") {
        try {
          const preset = await this.spindle.presets.get(trimmedConfigured, userId);
          if (!preset)
            return { presetId: null };
          const name = typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : undefined;
          const presetStreaming = extractPresetStreamingOverride(preset);
          return {
            presetId: trimmedConfigured,
            ...name ? { presetName: name } : {},
            ...presetStreaming !== undefined ? { presetStreaming } : {}
          };
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
  createGuidedSwipeSession(chatId, targetMessage, sessionUserId, callbacks) {
    const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(targetMessage);
    let initialSwipeId = activeIndex;
    let targetSwipeIndex = swipes.length;
    let targetDeleted = false;
    let slotCreated = false;
    let slotSwipes = [...swipes, ""];
    let slotSwipeDates = [...swipeDates, Math.floor(Date.now() / 1000)];
    let initialExtra = targetMessage.extra ? this.cloneRecord(targetMessage.extra) : {};
    let initialMetadata = targetMessage.metadata ? this.cloneRecord(targetMessage.metadata) : undefined;
    let currentViewedSwipeId = activeIndex;
    let swipeEventSeq = 0;
    let finalizing = false;
    let triggerFlush = null;
    const swipeDisposer = this.spindle.on?.("MESSAGE_SWIPED", (payload, eventUserId) => {
      if (sessionUserId && eventUserId && eventUserId !== sessionUserId) {
        return;
      }
      const event = payload;
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
      const nextSwipeId = typeof event.message?.swipe_id === "number" && Number.isFinite(event.message.swipe_id) ? Math.floor(event.message.swipe_id) : typeof event.swipeId === "number" && Number.isFinite(event.swipeId) ? Math.floor(event.swipeId) : undefined;
      if (nextSwipeId === undefined)
        return;
      swipeEventSeq += 1;
      const previousViewed = currentViewedSwipeId;
      currentViewedSwipeId = nextSwipeId;
      if (!finalizing && !targetDeleted && nextSwipeId === targetSwipeIndex && previousViewed !== targetSwipeIndex) {
        triggerFlush?.();
      }
    });
    const swipeEditedDisposer = this.spindle.on?.("SWIPE_EDITED", (payload, eventUserId) => {
      if (sessionUserId && eventUserId && eventUserId !== sessionUserId) {
        return;
      }
      const event = payload;
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
      setCurrentViewedSwipeId: (id) => {
        currentViewedSwipeId = id;
      },
      getSwipeEventSeq: () => swipeEventSeq,
      syncFromLatestMessage: (latest) => {
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
        if (typeof swipeEditedDisposer === "function") {
          swipeEditedDisposer();
        }
      }
    };
  }
  async rollbackUnstartedSwipeSlot(chatId, swipeSession) {
    if (swipeSession.isTargetDeleted())
      return;
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      const current = messages.find((m) => m.id === swipeSession.targetAssistantId);
      if (!current)
        return;
      const normalized = normalizeMessageSwipes(current);
      const targetIdx = swipeSession.getTargetSwipeIndex();
      if (targetIdx < 0 || targetIdx >= normalized.swipes.length)
        return;
      if ((normalized.swipes[targetIdx] ?? "") !== "")
        return;
      const nextSwipes = [
        ...normalized.swipes.slice(0, targetIdx),
        ...normalized.swipes.slice(targetIdx + 1)
      ];
      if (nextSwipes.length === 0)
        return;
      const nextDates = [
        ...normalized.swipeDates.slice(0, targetIdx),
        ...normalized.swipeDates.slice(targetIdx + 1)
      ];
      const restoredSwipeId = Math.max(0, Math.min(swipeSession.initialSwipeId, nextSwipes.length - 1));
      await this.spindle.chat.updateMessage(chatId, swipeSession.targetAssistantId, {
        content: nextSwipes[restoredSwipeId] ?? "",
        swipes: nextSwipes,
        swipe_id: restoredSwipeId,
        swipe_dates: nextDates,
        metadata: swipeSession.initialMetadata ?? {},
        skipChunkRebuild: true
      });
    } catch {}
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
      const validDuration = typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : undefined;
      const hasReasoning = typeof rawReasoning === "string" || validDuration !== undefined;
      if (hasMultipleSwipes || hasSwipeDates || hasPerSwipeReasoning || hasReasoning) {
        const { swipes, swipeDates, activeIndex } = normalizeMessageSwipes(snapshot);
        const swipeReasoning = hasPerSwipeReasoning ? swipes.map((_, idx) => {
          const r = extractSwipeReasoning(snapshot, idx);
          return r.text !== null || r.duration !== null ? {
            text: r.text,
            ...r.duration !== null ? { duration: r.duration } : {}
          } : null;
        }) : undefined;
        const patch = {
          content: snapshot.content ?? swipes[activeIndex] ?? "",
          swipes,
          swipe_id: activeIndex,
          swipe_dates: swipeDates,
          ...swipeReasoning ? { swipe_reasoning: swipeReasoning } : hasReasoning ? {
            reasoning: {
              ...typeof rawReasoning === "string" ? { text: rawReasoning } : {},
              ...validDuration !== undefined ? { duration: validDuration } : {}
            }
          } : {}
        };
        await this.spindle.chat.updateMessage(chatId, restored.id, patch);
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
        metadata: preRegen.metadata ?? {},
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
        swipeIndex: swipeSession.getTargetSwipeIndex(),
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
      if (swipeSession.isTargetDeleted()) {
        return current;
      }
      const nextCurrent = {
        ...current,
        swipeIndex: swipeSession.getTargetSwipeIndex()
      };
      const seqBeforeRead = swipeSession.getSwipeEventSeq();
      const refreshed = await this.refreshSwipeTarget(chatId, nextCurrent, () => swipeSession.isTargetDeleted());
      if (swipeSession.getSwipeEventSeq() === seqBeforeRead && refreshed.latestSwipeId !== undefined) {
        swipeSession.setCurrentViewedSwipeId(refreshed.latestSwipeId);
      }
      return refreshed;
    }, transformOutput, {
      isViewingTargetSwipe: () => !swipeSession.isTargetDeleted() && swipeSession.getCurrentViewedSwipeId() === swipeSession.getTargetSwipeIndex(),
      isTargetDeleted: () => swipeSession.isTargetDeleted(),
      getTargetSwipeState: () => ({
        swipeIndex: swipeSession.getTargetSwipeIndex(),
        swipes: swipeSession.swipes,
        swipeDates: swipeSession.swipeDates
      }),
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
    const { wasStreaming, outboundInput } = prepareOutboundGenerationInput(rawInput);
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
                this.emitFrontend({ type: "gg:impersonate-chunk", chatId, text: generated, done: false }, userId);
              }
            } else if (chunk.type === "done") {
              if (chunk.content)
                generated = chunk.content;
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
    let finalOverrideText = null;
    let forceReasoningPatch = false;
    let reasoningStartedAt;
    let reasoningEndedAt;
    let aborted = false;
    let lastFlushAt = 0;
    let flushChain = Promise.resolve();
    let lastFlushError = null;
    let target = null;
    let notifiedFirstOutput = false;
    let notifiedFirstContent = false;
    const buildMergedContent = (baseText) => finalOverrideText !== null ? finalOverrideText : baseText ? stitchContinueContent(baseText, deltaText) : deltaText;
    const getReasoningDurationPatch = (baseText, includeReasoning) => {
      if (!includeReasoning) {
        return {};
      }
      if (reasoningText.length === 0) {
        return baseText.length > 0 || forceReasoningPatch ? { reasoningDuration: null } : {};
      }
      if (reasoningStartedAt !== undefined && reasoningEndedAt !== undefined) {
        return { reasoningDuration: Math.max(0, reasoningEndedAt - reasoningStartedAt) };
      }
      return baseText.length > 0 ? { reasoningDuration: null } : {};
    };
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
      if (swipeOptions?.isTargetDeleted?.()) {
        return;
      }
      const liveSwipeState = swipeOptions?.getTargetSwipeState?.();
      const effectiveSnapshot = liveSwipeState ? {
        ...targetSnapshot,
        swipeIndex: liveSwipeState.swipeIndex,
        swipes: liveSwipeState.swipes,
        swipeDates: liveSwipeState.swipeDates
      } : targetSnapshot;
      const mergedContent = buildMergedContent(effectiveSnapshot.baseText);
      const includeReasoning = Boolean(reasoningText || forceReasoningPatch);
      const patch = buildActiveSwipePatch({
        swipes: effectiveSnapshot.swipes,
        swipeIndex: effectiveSnapshot.swipeIndex,
        content: mergedContent,
        swipeDates: effectiveSnapshot.swipeDates,
        ...includeReasoning ? {
          reasoningText,
          ...getReasoningDurationPatch(effectiveSnapshot.baseText, includeReasoning)
        } : {},
        ...options.skipChunkRebuild !== undefined ? { skipChunkRebuild: options.skipChunkRebuild } : {}
      });
      flushChain = flushChain.catch(() => {
        return;
      }).then(async () => {
        if (swipeOptions?.isTargetDeleted?.()) {
          return;
        }
        if (options.checkStillViewingMidstream && swipeOptions && !swipeOptions.isViewingTargetSwipe()) {
          return;
        }
        await runUpdatePatch(effectiveSnapshot.messageId, patch, swallowError);
      });
    };
    const enqueueFinalFlush = (targetSnapshot, swallowError) => {
      if (swipeOptions?.isTargetDeleted?.()) {
        return;
      }
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
            ...includeActiveReasoning ? {
              reasoningText: capturedReasoning,
              ...getReasoningDurationPatch(targetSnapshot.baseText, includeActiveReasoning)
            } : {},
            skipChunkRebuild: false
          });
          await runUpdatePatch(targetSnapshot.messageId, patch, swallowError);
          return;
        }
        const existingBySwipe = targetSnapshot.latestExtra?.reasoningBySwipe;
        const hadStoredSlotReasoning = Array.isArray(existingBySwipe) && existingBySwipe[targetSnapshot.swipeIndex] != null;
        const includeReasoning = capturedReasoning.length > 0 || capturedForceReasoning && hadStoredSlotReasoning;
        const durationPatch = getReasoningDurationPatch(targetSnapshot.baseText, includeReasoning);
        const bgReasoningDuration = typeof durationPatch.reasoningDuration === "number" && durationPatch.reasoningDuration > 0 ? durationPatch.reasoningDuration : undefined;
        const patch = buildBackgroundSwipePatch({
          swipes: targetSnapshot.swipes,
          swipeIndex: targetSnapshot.swipeIndex,
          content: capturedDelta,
          swipeDates: targetSnapshot.swipeDates,
          ...includeReasoning ? {
            reasoningText: capturedReasoning,
            ...bgReasoningDuration !== undefined ? { reasoningDuration: bgReasoningDuration } : {},
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
      if (swipeOptions?.isTargetDeleted?.())
        return;
      if (swipeOptions && !swipeOptions.isViewingTargetSwipe())
        return;
      const liveSwipeState = swipeOptions?.getTargetSwipeState?.();
      if (liveSwipeState) {
        target = {
          ...target,
          swipeIndex: liveSwipeState.swipeIndex,
          swipes: liveSwipeState.swipes,
          swipeDates: liveSwipeState.swipeDates
        };
      }
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
    let firstTokenAt;
    let firstContentTokenAt;
    let lastProviderContentAt;
    let responseStoppedAt;
    let completedAt;
    let streamUsage;
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
          if (response.usage && typeof response.usage === "object" && !Array.isArray(response.usage)) {
            streamUsage = response.usage;
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
        if (target && !swipeOptions?.isTargetDeleted?.() && (deltaText.length > 0 || reasoningText.length > 0)) {
          await flushChain.catch(() => {
            return;
          });
          if (refreshTarget && !swipeOptions?.isTargetDeleted?.()) {
            target = await refreshTarget(target).catch(() => target);
          }
          if (!swipeOptions?.isTargetDeleted?.()) {
            enqueueFinalFlush(target, false);
          }
          await flushChain.catch(() => {
            return;
          });
          if (!lastFlushError && !swipeOptions?.isTargetDeleted?.() && onPartialErrorCommit) {
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
    let resolvedTarget = target;
    if (!hasOutput || !resolvedTarget || swipeOptions?.isTargetDeleted?.()) {
      await flushChain.catch(() => {
        return;
      });
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted: aborted || signal.aborted || Boolean(swipeOptions?.isTargetDeleted?.()),
        hasOutput: false
      };
    }
    if (transformOutput) {
      const hadReasoning = reasoningText.length > 0;
      const transformed = await transformOutput({
        deltaText,
        reasoningText,
        ...resolvedTarget.baseText ? { baseText: resolvedTarget.baseText } : {}
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
      await flushChain.catch(() => {
        return;
      });
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted: true,
        hasOutput: false
      };
    }
    if (refreshTarget) {
      await flushChain;
      resolvedTarget = await refreshTarget(resolvedTarget);
      target = resolvedTarget;
    }
    if (swipeOptions?.isTargetDeleted?.()) {
      await flushChain.catch(() => {
        return;
      });
      return {
        finalText: "",
        rawDeltaText,
        hasReasoning,
        aborted: true,
        hasOutput: false
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
  async refreshSwipeTarget(chatId, current, isTargetDeleted) {
    if (isTargetDeleted?.()) {
      return current;
    }
    try {
      const messages = await this.spindle.chat.getMessages(chatId);
      if (isTargetDeleted?.()) {
        return current;
      }
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
  emitStatus(userId, runId) {
    const key = this.userKey(userId);
    const active = runId ? this.activeRuns.get(key)?.get(runId)?.state : undefined;
    const run = active ? { ...active } : this.getActiveRun(userId);
    this.emitFrontend({
      type: "gg:status",
      run,
      ...run?.chatId ? { chatId: run.chatId } : {}
    }, userId);
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
  const trimmedChatId = typeof next.chatId === "string" && next.chatId.trim().length > 0 ? next.chatId.trim() : null;
  const entry = {
    id: next.id ?? `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    actionId: next.actionId,
    chatId: trimmedChatId,
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
  settingsVersions = new Map;
  recoveryVersions = new Map;
  continueVersions = new Map;
  writeQueues = new Map;
  constructor(spindle2) {
    this.spindle = spindle2;
  }
  bumpVersion(versions, key) {
    versions.set(key, (versions.get(key) ?? 0) + 1);
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
    const versionBeforeRead = this.settingsVersions.get(key) ?? 0;
    let resolved;
    try {
      if (await this.spindle.userStorage.exists(SETTINGS_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(SETTINGS_FILE, userId);
        resolved = normalizeSettings(JSON.parse(raw));
      } else {
        resolved = createDefaultSettings();
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading settings, using defaults: ${error instanceof Error ? error.message : String(error)}`);
      return createDefaultSettings();
    }
    if (!skipWriteWait && this.writeQueues.has(key)) {
      await this.waitForPendingWrites(key);
    }
    const concurrentCached = this.settingsCache.get(key);
    if (concurrentCached) {
      return this.cloneSettings(concurrentCached);
    }
    if ((this.settingsVersions.get(key) ?? 0) === versionBeforeRead) {
      this.settingsCache.set(key, resolved);
    }
    return this.cloneSettings(resolved);
  }
  async saveSettingsWithMeta(next, userId) {
    return this.enqueueUserWrite(userId, async () => {
      const key = this.userKey(userId);
      const normalized = normalizeSettings(next);
      await this.spindle.userStorage.write(SETTINGS_FILE, JSON.stringify(normalized, null, 2), userId);
      this.settingsCache.set(key, normalized);
      this.bumpVersion(this.settingsVersions, key);
      const currentRecovery = await this.readRawRecoveryUnlocked(userId, true);
      const recoveryPruned = currentRecovery.length > normalized.inputRecovery.maxEntries;
      const trimmed = currentRecovery.slice(0, normalized.inputRecovery.maxEntries);
      if (recoveryPruned) {
        await this.writeRecoveryUnlocked(trimmed, userId);
      }
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
    const versionBeforeRead = this.recoveryVersions.get(key) ?? 0;
    let parsed;
    try {
      if (await this.spindle.userStorage.exists(RECOVERY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(RECOVERY_FILE, userId);
        parsed = normalizeRecoveryList(JSON.parse(raw), 50);
      } else {
        parsed = [];
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading recovery history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    if (!skipWriteWait && this.writeQueues.has(key)) {
      await this.waitForPendingWrites(key);
    }
    const concurrentCached = this.recoveryCache.get(key);
    if (concurrentCached) {
      return concurrentCached.map((e) => ({ ...e }));
    }
    if ((this.recoveryVersions.get(key) ?? 0) === versionBeforeRead) {
      this.recoveryCache.set(key, parsed.map((e) => ({ ...e })));
    }
    return parsed.map((e) => ({ ...e }));
  }
  async readRecoveryUnlocked(userId, maxEntries, skipWriteWait = false) {
    const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 10;
    const all = await this.readRawRecoveryUnlocked(userId, skipWriteWait);
    return all.slice(0, limit);
  }
  async writeRecoveryUnlocked(entries, userId) {
    const key = this.userKey(userId);
    await this.spindle.userStorage.write(RECOVERY_FILE, JSON.stringify(entries, null, 2), userId);
    this.recoveryCache.set(key, entries.map((e) => ({ ...e })));
    this.bumpVersion(this.recoveryVersions, key);
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
    const versionBeforeRead = this.continueVersions.get(key) ?? 0;
    let parsed;
    try {
      if (await this.spindle.userStorage.exists(CONTINUE_HISTORY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(CONTINUE_HISTORY_FILE, userId);
        parsed = normalizeContinueHistoryList(JSON.parse(raw), MAX_CONTINUE_ENTRIES);
      } else {
        parsed = [];
      }
    } catch (error) {
      this.spindle.log.warn(`[GuidedGenerations] Failed reading continue history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    if (!skipWriteWait && this.writeQueues.has(key)) {
      await this.waitForPendingWrites(key);
    }
    const concurrentCached = this.continueHistoryCache.get(key);
    if (concurrentCached) {
      return concurrentCached.map((entry) => ({ ...entry }));
    }
    if ((this.continueVersions.get(key) ?? 0) === versionBeforeRead) {
      this.continueHistoryCache.set(key, parsed.map((entry) => ({ ...entry })));
    }
    return parsed.map((entry) => ({ ...entry }));
  }
  async writeContinueHistoryUnlocked(entries, userId) {
    const key = this.userKey(userId);
    await this.spindle.userStorage.write(CONTINUE_HISTORY_FILE, JSON.stringify(entries, null, 2), userId);
    this.continueHistoryCache.set(key, entries.map((entry) => ({ ...entry })));
    this.bumpVersion(this.continueVersions, key);
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
  runner.syncInterceptorRegistration();
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
      activeRuns: runner.getActiveRuns(userId),
      permissions: {
        generation: api.permissions.has("generation"),
        chats: api.permissions.has("chats"),
        chat_mutation: api.permissions.has("chat_mutation"),
        characters: api.permissions.has("characters"),
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
          if (!isRecord2(req.input)) {
            throw new Error("Invalid settings payload: expected an object.");
          }
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
          const runId = typeof record.runId === "string" && record.runId.trim().length > 0 ? record.runId.trim() : undefined;
          const chatId = typeof record.chatId === "string" && record.chatId.trim().length > 0 ? record.chatId.trim() : undefined;
          const aborted = runner.abortCurrent(userId, runId, chatId);
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
          const rawChatId = typeof record.chatId === "string" ? record.chatId.trim() : "";
          const recovery = await store.pushRecovery({
            text,
            actionId,
            chatId: rawChatId.length > 0 ? rawChatId : null
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
    runner.syncInterceptorRegistration();
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
