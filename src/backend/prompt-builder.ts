import type {
  AssemblyBreakdownEntryDTO,
  ChatMessageDTO,
  DryRunRequestDTO,
  DryRunResultDTO,
  LlmMessageDTO,
  PromptBlockRoleDTO,
  PromptBlockSnapshotDTO,
  RegexPlacementDTO,
} from "lumiverse-spindle-types";
import {
  normalizeGuidanceDepth,
  normalizeGuidancePosition,
} from "../shared/defaults";
import type {
  GuidanceInjectionRole,
  GuidancePosition,
  GuidedActionConfig,
  GuidedActionId,
} from "../shared/types";

export interface AssembledLlmMessageDTO extends LlmMessageDTO {
  __isWorldInfoEntry?: boolean;
  __chatHistorySource?: boolean;
  __worldInfoSource?: boolean;
  __sourceMessageId?: string;
  __sourceIndexInChat?: number;
  __sourceMessageMetadata?: unknown;
  __continueNudge?: boolean;
  __contextAnchorProtected?: boolean;
  __preserveDisplayReasoningDelimiters?: boolean;
  __cortexHistorySummary?: unknown;
  __runtimeWorldInfoPlacementId?: string;
  partial?: boolean;
}

export function getMessageSourceId(msg: AssembledLlmMessageDTO): string | undefined {
  if (typeof msg.sourceMessageId === "string" && msg.sourceMessageId.length > 0) {
    return msg.sourceMessageId;
  }
  if (typeof msg.__sourceMessageId === "string" && msg.__sourceMessageId.length > 0) {
    return msg.__sourceMessageId;
  }
  return undefined;
}

export interface DryRunRequestWithOverride extends DryRunRequestDTO {
  forcePresetId?: boolean;
  includeRequestMessages?: boolean;
}

export interface DryRunResultWithRequestMessages extends DryRunResultDTO {
  request_messages?: AssembledLlmMessageDTO[];
}

export interface InjectGuidanceOptions {
  actionId?: GuidedActionId;
  guidancePosition?: GuidancePosition;
  guidanceDepth?: number;
  isChatHistory?: readonly boolean[];
}

export type ChatMessageWithRole = ChatMessageDTO & {
  role?: "system" | "user" | "assistant" | string;
  metadata?: Record<string, unknown>;
};

export interface MessageSwipePatch {
  content: string;
  swipes: string[];
  swipe_id: number;
  swipe_dates?: number[];
  reasoning?: {
    text?: string | null;
    duration?: number | null;
  };
  metadata?: Record<string, unknown>;
  skipChunkRebuild?: boolean;
}

export type SwipeReasoningSlot = {
  text: string | null;
  duration?: number | null;
} | null;

export interface BackgroundSwipePatch {
  swipes: string[];
  swipe_dates?: number[];
  swipe_reasoning?: SwipeReasoningSlot[];
  metadata?: Record<string, unknown>;
  skipChunkRebuild: true;
}

/**
 * Formats user-entered guidance with the action's template.
 * Returns null when nothing should be injected into the prompt stack.
 */
export function formatGuidanceText(
  template: string,
  rawInput: string,
  options: { allowTemplateWithoutInput?: boolean } = {},
): string | null {
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

  return `${cleanTemplate}\n${input}`;
}

function isPartialAssistantPrefill(msg: AssembledLlmMessageDTO | undefined): boolean {
  return Boolean(msg && msg.role === "assistant" && msg.partial === true);
}

function mapPromptBlockRole(role: PromptBlockRoleDTO): LlmMessageDTO["role"] {
  if (role === "user" || role === "user_append") return "user";
  if (role === "assistant" || role === "assistant_append") return "assistant";
  return "system";
}

/**
 * Maps Guided Generations' injection role to Lumiverse's prompt-regex placement.
 */
export function mapInjectionRoleToRegexPlacement(
  role: GuidanceInjectionRole,
): RegexPlacementDTO {
  if (role === "user") return "user_input";
  if (role === "assistant") return "ai_output";
  return "world_info";
}

/**
 * Computes the effective prompt depth at which guidance will be injected,
 * used when evaluating prompt-target regex scripts' `min_depth`/`max_depth`.
 */
export function computeEffectiveGuidanceDepth(
  guidancePosition: GuidancePosition,
  guidanceDepth: number,
  isChatHistory?: readonly boolean[],
): number {
  if (guidancePosition === "in_history") {
    return normalizeGuidanceDepth(guidanceDepth, 0);
  }
  if (guidancePosition === "pre_history" && Array.isArray(isChatHistory)) {
    return isChatHistory.filter(Boolean).length;
  }
  return 0;
}

/**
 * Resolves per-message `__isChatHistory` flags from assembled messages, falling back
 * to `dryRun.breakdown` or preset prompt blocks (`presets.blocks.list` / `presets.get`).
 */
export function resolveChatHistoryFlags(
  messages: readonly AssembledLlmMessageDTO[],
  options: {
    breakdown?: readonly AssemblyBreakdownEntryDTO[];
    presetBlocks?: readonly PromptBlockSnapshotDTO[];
  } = {},
): boolean[] | undefined {
  if (messages.length === 0) return undefined;

  if (
    messages.some(
      (m) => typeof m.__isChatHistory === "boolean" || typeof m.__chatHistorySource === "boolean",
    )
  ) {
    return messages.map((m) => Boolean(m.__isChatHistory ?? m.__chatHistorySource));
  }

  if (Array.isArray(options.breakdown) && options.breakdown.length > 0) {
    const historyEntry = options.breakdown.find(
      (entry) =>
        (entry.type === "chat_history" ||
          entry.marker === "chat_history" ||
          entry.marker === "chatHistory") &&
        typeof entry.firstMessageIndex === "number" &&
        typeof entry.messageCount === "number" &&
        entry.messageCount >= 0,
    );
    if (historyEntry) {
      const start = Math.max(0, historyEntry.firstMessageIndex!);
      const end = Math.min(messages.length, start + historyEntry.messageCount!);
      return messages.map((_, idx) => idx >= start && idx < end);
    }
  }

  if (Array.isArray(options.presetBlocks) && options.presetBlocks.length > 0) {
    const isContentBlock = (block: PromptBlockSnapshotDTO) =>
      block.enabled &&
      block.marker !== "category" &&
      block.marker !== "chat_history" &&
      block.marker !== "chatHistory" &&
      (!block.marker || (typeof block.content === "string" && block.content.trim().length > 0));

    const preBlocks = options.presetBlocks.filter(
      (b) => b.position === "pre_history" && isContentBlock(b),
    );
    const postBlocks = options.presetBlocks.filter(
      (b) => b.position === "post_history" && isContentBlock(b),
    );

    if (preBlocks.length > 0 || postBlocks.length > 0) {
      let preEnd = 0;
      for (const block of preBlocks) {
        if (preEnd >= messages.length) break;
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
      for (let i = postBlocks.length - 1; i >= 0; i -= 1) {
        if (postStart <= preEnd) break;
        const expectedRole = mapPromptBlockRole(postBlocks[i]!.role);
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

  return undefined;
}

/**
 * Strips internal host/interceptor metadata flags before sending messages to `rawStream`.
 */
export function stripInternalMessageMarkers(
  messages: readonly AssembledLlmMessageDTO[],
): LlmMessageDTO[] {
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
    } = msg as AssembledLlmMessageDTO & {
      sourceMessageMetadata?: unknown;
    };
    return rest;
  });
}

/**
 * Injects guidance cleanly into an assembled LLM message list using the configured
 * `guidancePosition` and `guidanceDepth` (with `isChatHistory` boundaries when known).
 */
export function injectGuidanceMessage(
  messages: readonly AssembledLlmMessageDTO[],
  guidanceText: string | null,
  role: GuidanceInjectionRole,
  options: InjectGuidanceOptions = {},
): AssembledLlmMessageDTO[] {
  const copy = messages.map((msg) => ({ ...msg }));
  if (!guidanceText || !guidanceText.trim()) {
    return copy;
  }

  const injected: AssembledLlmMessageDTO = {
    role,
    content: guidanceText.trim(),
  };

  const position = normalizeGuidancePosition(options.guidancePosition, "before_post_history");
  const depth = normalizeGuidanceDepth(options.guidanceDepth, 0);
  const hasHistoryFlags =
    Array.isArray(options.isChatHistory) && options.isChatHistory.length === copy.length;

  const historyIndices: number[] = [];
  if (hasHistoryFlags) {
    for (let i = 0; i < options.isChatHistory!.length; i += 1) {
      if (options.isChatHistory![i]) {
        historyIndices.push(i);
      }
    }
  }

  const findFallbackContinueAssistantIndex = (): number => {
    if (copy.length === 0) return -1;
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

  const findHistoryContinueAssistantIndex = (): number => {
    for (let i = historyIndices.length - 1; i >= 0; i -= 1) {
      const idx = historyIndices[i]!;
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

  const findMovedContinueAssistantIndex = (afterIdx: number): number => {
    if (options.actionId !== "guided_continue") return -1;
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
          insertIndex = historyIndices[0]!;
        } else if (options.actionId === "guided_continue") {
          const firstTurnIdx = copy.findIndex(
            (m) => m.role === "user" || m.role === "assistant",
          );
          insertIndex = firstTurnIdx >= 0 ? firstTurnIdx : 0;
        } else {
          insertIndex = 0;
        }
      } else {
        const firstTurnIdx = copy.findIndex(
          (m) => m.role === "user" || m.role === "assistant",
        );
        insertIndex = firstTurnIdx >= 0 ? firstTurnIdx : 0;
      }
      break;
    }

    case "before_post_history": {
      if (hasHistoryFlags) {
        if (historyIndices.length > 0) {
          const lastHistoryIdx = historyIndices[historyIndices.length - 1]!;
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
          const lastHistoryIdx = historyIndices[historyIndices.length - 1]!;
          const movedContinueIdx =
            options.actionId === "guided_continue"
              ? findMovedContinueAssistantIndex(lastHistoryIdx)
              : -1;
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
              insertIndex = historyIndices[clampedOffset]!;
            }
          } else {
            const clampedOffset = Math.max(0, historyIndices.length - depth);
            insertIndex = historyIndices[clampedOffset]!;
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
          insertIndex =
            copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1])
              ? copy.length - 1
              : copy.length;
        }
      } else if (depth === 0) {
        const continueIdx = findFallbackContinueAssistantIndex();
        insertIndex = continueIdx >= 0 ? continueIdx : copy.length;
      } else {
        const endBound =
          options.actionId === "guided_continue"
            ? (() => {
                const continueIdx = findFallbackContinueAssistantIndex();
                return continueIdx >= 0 ? continueIdx : copy.length;
              })()
            : copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1])
              ? copy.length - 1
              : copy.length;
        insertIndex = Math.max(0, endBound - depth);
      }
      break;
    }

    case "post_history": {
      if (options.actionId === "guided_continue") {
        if (hasHistoryFlags && historyIndices.length > 0) {
          const lastHistoryIdx = historyIndices[historyIndices.length - 1]!;
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

function isWorldInfoMessage(msg: AssembledLlmMessageDTO): boolean {
  return Boolean(msg.__isWorldInfoEntry || msg.__worldInfoSource);
}

function getLlmMessageTextContent(content: LlmMessageDTO["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  return "";
}

function mergeMessageContents(
  prev: LlmMessageDTO["content"],
  curr: LlmMessageDTO["content"],
): LlmMessageDTO["content"] {
  if (typeof prev === "string" && typeof curr === "string") {
    return `${prev}\n\n${curr}`;
  }
  const hasNonText = (content: LlmMessageDTO["content"]): boolean =>
    Array.isArray(content) && content.some((part) => part.type !== "text");
  if (!hasNonText(prev) && !hasNonText(curr)) {
    return `${getLlmMessageTextContent(prev)}\n\n${getLlmMessageTextContent(curr)}`;
  }
  const toParts = (content: LlmMessageDTO["content"]) =>
    typeof content === "string"
      ? content.length > 0
        ? [{ type: "text" as const, text: content }]
        : []
      : content;
  const prevParts = toParts(prev);
  const currParts = toParts(curr);
  return [
    ...prevParts,
    ...(prevParts.length > 0 && currParts.length > 0
      ? [{ type: "text" as const, text: "\n\n" }]
      : []),
    ...currParts,
  ];
}

/**
 * Mirrors Lumiverse's `hasNonEmptyContent` filter in `generate.service.ts`
 * so `mergeDryRunAndCapturedMessages` can reconcile `capturedMessages` against
 * `dryRun.request_messages` after empty-turn pruning.
 */
export function hasNonEmptyLlmContent(msg: AssembledLlmMessageDTO): boolean {
  if (typeof msg.content === "string") {
    return msg.content.trim().length > 0 || (msg.role === "assistant" && msg.partial === true);
  }
  if (Array.isArray(msg.content)) {
    return msg.content.length > 0;
  }
  return true;
}

/**
 * Mirrors Lumiverse's `applyPostProcessing` consecutive same-role merging
 * (`merge` / `semi` / `strict` modes) after unmerged capture processing.
 */
export function mergeConsecutiveSameRoleMessages(
  messages: readonly AssembledLlmMessageDTO[],
): AssembledLlmMessageDTO[] {
  const merged: AssembledLlmMessageDTO[] = [];
  for (const rawMsg of messages) {
    const msg = { ...rawMsg };
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      const mergedCacheControl = prev.cache_control ?? msg.cache_control;
      const mergedThoughtSignature = prev.thought_signature ?? msg.thought_signature;
      const mergedReasoningContent =
        prev.reasoning_content && msg.reasoning_content
          ? `${prev.reasoning_content}\n\n${msg.reasoning_content}`
          : (prev.reasoning_content ?? msg.reasoning_content);
      const mergedThinkingBlocks =
        prev.thinking_blocks && msg.thinking_blocks
          ? [...prev.thinking_blocks, ...msg.thinking_blocks]
          : (prev.thinking_blocks ?? msg.thinking_blocks);
      const mergedReasoningDetails =
        prev.reasoning_details && msg.reasoning_details
          ? [...prev.reasoning_details, ...msg.reasoning_details]
          : (prev.reasoning_details ?? msg.reasoning_details);

      merged[merged.length - 1] = {
        ...prev,
        content: mergeMessageContents(prev.content, msg.content),
        ...(msg.partial === true ? { partial: true } : {}),
        ...(mergedCacheControl !== undefined ? { cache_control: mergedCacheControl } : {}),
        ...(mergedThoughtSignature !== undefined
          ? { thought_signature: mergedThoughtSignature }
          : {}),
        ...(mergedReasoningContent !== undefined
          ? { reasoning_content: mergedReasoningContent }
          : {}),
        ...(mergedThinkingBlocks !== undefined ? { thinking_blocks: mergedThinkingBlocks } : {}),
        ...(mergedReasoningDetails !== undefined
          ? { reasoning_details: mergedReasoningDetails }
          : {}),
      };
    } else {
      merged.push(msg);
    }
  }
  return merged;
}

/**
 * Collapses all assembled messages into a single `system` or `user` message,
 * matching Lumiverse's `applyPostProcessing("single")` (`role: "system"`) and
 * `collapseToSingleUserMessage` (`role: "user"`).
 */
export function collapseMessagesToSingleRole(
  messages: readonly AssembledLlmMessageDTO[],
  role: "system" | "user",
): AssembledLlmMessageDTO[] {
  if (messages.length === 0) {
    return [];
  }
  if (messages.length === 1) {
    return [{ ...messages[0]!, role }];
  }

  const textChunks: string[] = [];
  const mediaParts: Exclude<
    Extract<LlmMessageDTO["content"], readonly unknown[]>[number],
    { type: "text" }
  >[] = [];

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

  const collapsed = textChunks.join("\n\n");
  if (mediaParts.length > 0) {
    const parts: Extract<LlmMessageDTO["content"], readonly unknown[]> = [
      ...(collapsed ? [{ type: "text" as const, text: collapsed }] : []),
      ...mediaParts,
    ];
    return [{ role, content: parts }];
  }
  return [{ role, content: collapsed }];
}

export interface MergedDryRunMessagesResult {
  messages: AssembledLlmMessageDTO[];
  reapplyRoleMerge: boolean;
  applyEmptyFilter: boolean;
  collapseToSingleRole?: "system" | "user";
}

/**
 * Reconciles `dryRunResult.request_messages` against pre-post-processing
 * `capturedMessages` from the interceptor so callers preserve per-message
 * metadata and detect whether Lumiverse applied empty filtering, consecutive
 * same-role merging, or single-role collapsing.
 */
export function mergeDryRunAndCapturedMessages(
  dryRunResult: DryRunResultWithRequestMessages,
  capturedMessages?: AssembledLlmMessageDTO[],
): MergedDryRunMessagesResult {
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

      const mergedFilteredCapture = mergeConsecutiveSameRoleMessages(
        capturedMessages.filter(hasNonEmptyLlmContent),
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

/**
 * Removes the trailing chat-history turn at `targetIdx` and unshifts any
 * depth-inserted (`depth >= 1`) non-chat-history blocks one history turn earlier
 * so they remain at the same depth as when the trailing assistant turn is excluded
 * natively before prompt assembly.
 */
function removeTrailingHistoryTurnAndUnshiftDepth(
  messages: readonly AssembledLlmMessageDTO[],
  isChatHistory: readonly boolean[],
  targetIdx: number,
): { messages: AssembledLlmMessageDTO[]; isChatHistory: boolean[] } {
  const historyIndices: number[] = [];
  for (let i = 0; i < isChatHistory.length; i += 1) {
    if (isChatHistory[i]) {
      historyIndices.push(i);
    }
  }

  const lastHistoryPos = historyIndices.length - 1;
  if (lastHistoryPos < 1 || historyIndices[lastHistoryPos] !== targetIdx) {
    const nextMessages: AssembledLlmMessageDTO[] = [];
    const nextFlags: boolean[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      if (i === targetIdx) continue;
      nextMessages.push({ ...messages[i]! });
      nextFlags.push(Boolean(isChatHistory[i]));
    }
    return { messages: nextMessages, isChatHistory: nextFlags };
  }

  const h0 = historyIndices[0]!;
  const h1 = historyIndices[1]!;
  const hk = targetIdx;

  const nextMessages: AssembledLlmMessageDTO[] = [];
  const nextFlags: boolean[] = [];
  const pushItem = (idx: number, flag: boolean) => {
    nextMessages.push({ ...messages[idx]! });
    nextFlags.push(flag);
  };

  // Preserve blocks originally before the first chat-history turn (`depth >= k + 1`, pre_history).
  for (let i = 0; i < h0; i += 1) {
    pushItem(i, false);
  }

  // Gap 1 (`h0 .. h1`): non-WI blocks were inserted by depth = k and shift before `h0`,
  // while standalone WI entries (`anAfter` / `emAfter`) remain anchored right after `h0`.
  const gap1KeepAfterH0: number[] = [];
  for (let i = h0 + 1; i < h1; i += 1) {
    if (isWorldInfoMessage(messages[i]!)) {
      gap1KeepAfterH0.push(i);
    } else {
      pushItem(i, false);
    }
  }

  pushItem(h0, true);
  for (const idx of gap1KeepAfterH0) {
    pushItem(idx, false);
  }

  // Gap j (`2 <= j <= k`, i.e. `h_{j-1} .. h_j`): all non-history blocks move to Gap j - 1
  // (immediately before `h_{j-1}`), and `h_k` (`targetIdx`) is omitted.
  for (let j = 2; j <= lastHistoryPos; j += 1) {
    const prevH = historyIndices[j - 1]!;
    const currH = historyIndices[j]!;
    for (let i = prevH + 1; i < currH; i += 1) {
      pushItem(i, false);
    }
    pushItem(prevH, true);
  }

  // Keep post-target messages (`depth = 0`, `before_post_history`, `post_history`, prefill) in place.
  for (let i = hk + 1; i < messages.length; i += 1) {
    pushItem(i, false);
  }

  return { messages: nextMessages, isChatHistory: nextFlags };
}

function stripTrailingAssistantTurnWithHistory(
  messages: readonly AssembledLlmMessageDTO[],
  matchId: string | null | undefined,
  isChatHistory: readonly boolean[] | undefined,
  options: { requireBlankFallback: boolean },
): { messages: AssembledLlmMessageDTO[]; isChatHistory?: boolean[] } {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;

  if (matchId) {
    const matchingIndices: number[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      if (getMessageSourceId(messages[i]!) === matchId) {
        matchingIndices.push(i);
      }
    }
    if (matchingIndices.length === 1) {
      const targetIdx = matchingIndices[0]!;
      if (hasFlags) {
        return removeTrailingHistoryTurnAndUnshiftDepth(messages, isChatHistory!, targetIdx);
      }
      return {
        messages: messages
          .filter((_, idx) => idx !== targetIdx)
          .map((msg) => ({ ...msg })),
      };
    }
    if (matchingIndices.length > 1) {
      const matchSet = new Set(matchingIndices);
      const nextMessages: AssembledLlmMessageDTO[] = [];
      const nextFlags: boolean[] = [];
      for (let i = 0; i < messages.length; i += 1) {
        if (matchSet.has(i)) continue;
        nextMessages.push({ ...messages[i]! });
        if (hasFlags) nextFlags.push(Boolean(isChatHistory![i]));
      }
      return {
        messages: nextMessages,
        ...(hasFlags ? { isChatHistory: nextFlags } : {}),
      };
    }
  }

  let targetIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (hasFlags && !isChatHistory![i]) {
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
      ...(hasFlags ? { isChatHistory: [...isChatHistory!] } : {}),
    };
  }

  if (hasFlags) {
    return removeTrailingHistoryTurnAndUnshiftDepth(messages, isChatHistory!, targetIdx);
  }

  return {
    messages: messages
      .filter((_, idx) => idx !== targetIdx)
      .map((msg) => ({ ...msg })),
  };
}

/**
 * Removes the rejected trailing assistant message from an assembled swipe prompt
 * (unshifting any `depth >= 1` non-history blocks) along with its matching `isChatHistory` entry if provided.
 */
export function stripRejectedSwipeAssistantTurnWithHistory(
  messages: readonly AssembledLlmMessageDTO[],
  targetMessageId?: string | null,
  isChatHistory?: readonly boolean[],
  options?: { requireBlankFallback?: boolean },
): { messages: AssembledLlmMessageDTO[]; isChatHistory?: boolean[] } {
  return stripTrailingAssistantTurnWithHistory(messages, targetMessageId, isChatHistory, {
    requireBlankFallback: options?.requireBlankFallback ?? false,
  });
}

/**
 * Removes the rejected trailing assistant message from an assembled swipe prompt
 * so the old swipe text never acts as an assistant prefill for the replacement.
 */
export function stripRejectedSwipeAssistantTurn(
  messages: readonly LlmMessageDTO[],
  targetMessageId?: string | null,
): LlmMessageDTO[] {
  return stripRejectedSwipeAssistantTurnWithHistory(messages, targetMessageId).messages;
}

function isBlankLlmContent(content: LlmMessageDTO["content"]): boolean {
  if (typeof content === "string") {
    return content.trim().length === 0;
  }
  if (Array.isArray(content)) {
    return content.every(
      (part) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length === 0,
    );
  }
  return false;
}

/**
 * Removes an eagerly created blank assistant placeholder message from an assembled
 * dry-run prompt (matched by `sourceMessageId` or trailing blank chat-history assistant turn,
 * unshifting any `depth >= 1` non-history blocks) along with its matching `isChatHistory` entry if provided.
 */
export function stripCreatedBlankAssistantTurnWithHistory(
  messages: readonly AssembledLlmMessageDTO[],
  createdMessageId?: string | null,
  isChatHistory?: readonly boolean[],
): { messages: AssembledLlmMessageDTO[]; isChatHistory?: boolean[] } {
  return stripTrailingAssistantTurnWithHistory(messages, createdMessageId, isChatHistory, {
    requireBlankFallback: true,
  });
}

/**
 * Resolves effective dry-run request parameters for an action without mutating
 * the user's global active connection or preset.
 */
export function buildDryRunInput(args: {
  chatId: string;
  actionId: GuidedActionId;
  config: GuidedActionConfig;
  activeConnectionId?: string | null;
}): DryRunRequestWithOverride {
  const generationTypeMap: Record<GuidedActionId, string> = {
    guided_response: "normal",
    guided_continue: "continue",
    guided_regenerate: "regenerate",
    guided_swipe: "swipe",
    guided_impersonate: "impersonate",
  };

  const connectionId = args.config.connectionId || args.activeConnectionId || undefined;
  const presetId = args.config.presetId || undefined;

  return {
    chatId: args.chatId,
    ...(connectionId ? { connectionId } : {}),
    ...(presetId ? { presetId, forcePresetId: true } : {}),
    generationType: generationTypeMap[args.actionId],
    includeRequestMessages: true,
  };
}

/**
 * Resolves the effective model and provider for a raw stream call.
 * When `configuredModel` is blank, falls back to the connection profile's
 * current model, then to the dry-run resolved model.
 */
export function resolveEffectiveModelAndProvider(args: {
  configuredModel?: string | null;
  connectionModel?: string | null;
  connectionProvider?: string | null;
  dryRunModel?: string | null;
  dryRunProvider?: string | null;
}): { model?: string; provider?: string } {
  const model =
    args.configuredModel?.trim() ||
    args.connectionModel?.trim() ||
    args.dryRunModel?.trim() ||
    undefined;
  const provider =
    args.connectionProvider?.trim() ||
    args.dryRunProvider?.trim() ||
    undefined;

  return {
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
  };
}

/**
 * Determines whether a chat message represents an assistant turn, checking normalized
 * `role` when present and falling back to `!is_user`.
 */
export function isAssistantMessage(msg: ChatMessageWithRole | undefined | null): boolean {
  if (!msg) return false;
  if (typeof msg.role === "string" && msg.role.length > 0) {
    return msg.role === "assistant";
  }
  return !msg.is_user;
}

/**
 * Picks the target assistant message for Guided Continue / Guided Swipe.
 */
export function findLastAssistantMessage(
  messages: readonly ChatMessageWithRole[],
): ChatMessageWithRole | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (isAssistantMessage(msg)) {
      return msg ?? null;
    }
  }
  return null;
}

/**
 * Reads the currently selected swipe array and index for a message,
 * normalizing empty swipe arrays safely.
 */
export function normalizeMessageSwipes(message: ChatMessageDTO): {
  swipes: string[];
  swipeDates: number[];
  activeIndex: number;
} {
  const swipes =
    Array.isArray(message.swipes) && message.swipes.length > 0
      ? [...message.swipes]
      : [message.content ?? ""];
  const rawIndex =
    typeof message.swipe_id === "number" && Number.isFinite(message.swipe_id)
      ? Math.floor(message.swipe_id)
      : 0;
  const activeIndex = Math.max(0, Math.min(rawIndex, swipes.length - 1));
  const fallbackDate = Math.floor(Date.now() / 1000);
  const swipeDates =
    Array.isArray(message.swipe_dates) && message.swipe_dates.length === swipes.length
      ? message.swipe_dates.map((d) =>
          typeof d === "number" && Number.isFinite(d) ? d : fallbackDate,
        )
      : swipes.map((_, idx) =>
          Array.isArray(message.swipe_dates) &&
          typeof message.swipe_dates[idx] === "number" &&
          Number.isFinite(message.swipe_dates[idx])
            ? message.swipe_dates[idx]
            : fallbackDate,
        );

  return { swipes, swipeDates, activeIndex };
}

const TRAILING_WHITESPACE_RE = /\s$/;
const TRAILING_OPENING_DELIM_RE = /[(\[{“‘—–-]$/;
const TRAILING_QUOTED_OPEN_RE = /(?:^|[\s(\[>])["'*_]$/;
const LEADING_WHITESPACE_RE = /^\s/;
const LEADING_PUNCTUATION_RE = /^[,.;:!?'"’”\)\]\-—…]/;

/**
 * Combines base message text with streamed continuation output without
 * collapsing intentional spacing or introducing double gaps at join boundaries.
 */
export function stitchContinueContent(baseContent: string, delta: string): string {
  if (!delta) return baseContent;
  if (!baseContent) return delta;

  const tail = baseContent.length > 2 ? baseContent.slice(-2) : baseContent;
  const head = delta[0]!;

  if (
    TRAILING_WHITESPACE_RE.test(tail) ||
    TRAILING_OPENING_DELIM_RE.test(tail) ||
    TRAILING_QUOTED_OPEN_RE.test(tail) ||
    LEADING_WHITESPACE_RE.test(head) ||
    LEADING_PUNCTUATION_RE.test(head)
  ) {
    return baseContent + delta;
  }

  return `${baseContent} ${delta}`;
}

function buildUpdatedSwipesArray(
  swipes: readonly string[],
  swipeIndex: number,
  content: string,
): string[] {
  const updatedSwipes = [...swipes];
  while (updatedSwipes.length <= swipeIndex) {
    updatedSwipes.push("");
  }
  updatedSwipes[swipeIndex] = content;
  return updatedSwipes;
}

function resolveExistingSwipeReasoningSlot(
  index: number,
  existingExtra: Record<string, unknown> | undefined,
  existingActiveSwipeId: number | undefined,
): SwipeReasoningSlot {
  const bySwipe = Array.isArray(existingExtra?.reasoningBySwipe)
    ? (existingExtra.reasoningBySwipe as unknown[])
    : undefined;
  const durBySwipe = Array.isArray(existingExtra?.reasoningDurationBySwipe)
    ? (existingExtra.reasoningDurationBySwipe as unknown[])
    : undefined;

  let rawText: unknown = bySwipe ? bySwipe[index] : undefined;
  let rawDur: unknown = durBySwipe ? durBySwipe[index] : undefined;

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
  const duration =
    typeof rawDur === "number" && Number.isFinite(rawDur) && rawDur >= 0
      ? rawDur
      : undefined;

  if (text === null && duration === undefined) {
    return null;
  }
  return {
    text,
    ...(duration !== undefined ? { duration } : {}),
  };
}

/**
 * Extracts stored reasoning text and duration for `swipeIndex` from a message's `extra` bag,
 * checking per-swipe arrays first and falling back to top-level `reasoning` /
 * `reasoningDuration` / `reasoning_duration` when `swipeIndex` matches the active swipe.
 */
export function extractSwipeReasoning(
  message: ChatMessageDTO,
  swipeIndex: number,
): { text: string | null; duration: number | null } {
  if (!Number.isFinite(swipeIndex)) {
    return { text: null, duration: null };
  }
  const extra = message.extra as Record<string, unknown> | undefined;
  const { activeIndex } = normalizeMessageSwipes(message);
  const idx = Math.max(0, Math.floor(swipeIndex));

  const bySwipe = Array.isArray(extra?.reasoningBySwipe)
    ? (extra.reasoningBySwipe as unknown[])
    : undefined;
  const durBySwipe = Array.isArray(extra?.reasoningDurationBySwipe)
    ? (extra.reasoningDurationBySwipe as unknown[])
    : undefined;

  let rawText: unknown =
    bySwipe && idx < bySwipe.length ? bySwipe[idx] : undefined;
  let rawDur: unknown =
    durBySwipe && idx < durBySwipe.length ? durBySwipe[idx] : undefined;

  if (idx === activeIndex) {
    if (rawText === undefined) {
      rawText = extra?.reasoning;
    }
    if (rawDur === undefined) {
      rawDur = extra?.reasoningDuration ?? extra?.reasoning_duration;
    }
  }

  const text = typeof rawText === "string" ? rawText : null;
  const duration =
    typeof rawDur === "number" && Number.isFinite(rawDur) && rawDur >= 0
      ? rawDur
      : null;

  return { text, duration };
}

/**
 * Returns true if `metadata.preset_contexts[swipeIndex].preset_id` already holds
 * a non-empty string preset identifier.
 */
export function hasPresetContextForSwipe(
  metadata: Record<string, unknown> | undefined,
  swipeIndex: number,
): boolean {
  if (!Number.isFinite(swipeIndex)) return false;
  const contexts = metadata?.preset_contexts;
  if (!Array.isArray(contexts)) return false;
  const idx = Math.max(0, Math.floor(swipeIndex));
  const entry = contexts[idx];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const presetId = (entry as { preset_id?: unknown }).preset_id;
  return typeof presetId === "string" && presetId.trim().length > 0;
}

/**
 * Merges `existingMetadata` and sets `preset_contexts[swipeIndex] = { preset_id }`
 * (padding intermediate slots with `null`) so Lumiverse's `useDisplayRegex`
 * preserves settled display frames across append-only flushes without flickering.
 */
export function buildPresetContextMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  swipeIndex: number,
  presetId: string,
): Record<string, unknown> {
  if (!Number.isFinite(swipeIndex)) {
    return { ...(existingMetadata ?? {}) };
  }
  const idx = Math.max(0, Math.floor(swipeIndex));
  const rawContexts = Array.isArray(existingMetadata?.preset_contexts)
    ? existingMetadata.preset_contexts
    : [];
  const nextContexts: Array<Record<string, unknown> | null> = rawContexts.map((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? { ...(entry as Record<string, unknown>) }
      : null,
  );
  while (nextContexts.length <= idx) {
    nextContexts.push(null);
  }
  const existingEntry = nextContexts[idx];
  nextContexts[idx] = {
    ...(existingEntry ?? {}),
    preset_id: presetId,
  };
  return {
    ...(existingMetadata ?? {}),
    preset_contexts: nextContexts,
  };
}

/**
 * Produces an updateMessage patch targeting an existing swipe index
 * (used by Guided Response on index 0, Guided Continue on activeIndex,
 * and active-swipe updates during Guided Swipe).
 */
export function buildActiveSwipePatch(args: {
  swipes: readonly string[];
  swipeIndex: number;
  content: string;
  swipeDates?: readonly number[];
  reasoningText?: string | null;
  reasoningDuration?: number | null;
  metadata?: Record<string, unknown>;
  skipChunkRebuild?: boolean;
}): MessageSwipePatch {
  const updatedSwipes = buildUpdatedSwipesArray(args.swipes, args.swipeIndex, args.content);
  const hasReasoningText = args.reasoningText !== undefined;
  const hasReasoningDuration = args.reasoningDuration !== undefined;
  const reasoning =
    hasReasoningText || hasReasoningDuration
      ? {
          ...(hasReasoningText ? { text: args.reasoningText } : {}),
          ...(hasReasoningDuration ? { duration: args.reasoningDuration } : {}),
        }
      : undefined;

  return {
    content: args.content,
    swipes: updatedSwipes,
    swipe_id: args.swipeIndex,
    ...(args.swipeDates ? { swipe_dates: [...args.swipeDates] } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.skipChunkRebuild !== undefined ? { skipChunkRebuild: args.skipChunkRebuild } : {}),
  };
}

/**
 * Produces an updateMessage patch that writes a background swipe slot without
 * modifying `content`, `swipe_id`, or top-level `reasoning` on the viewed swipe.
 */
export function buildBackgroundSwipePatch(args: {
  swipes: readonly string[];
  swipeIndex: number;
  content: string;
  swipeDates?: readonly number[];
  reasoningText?: string;
  reasoningDuration?: number | null;
  clearReasoningSlot?: boolean;
  existingExtra?: Record<string, unknown>;
  existingActiveSwipeId?: number;
  metadata?: Record<string, unknown>;
}): BackgroundSwipePatch {
  const updatedSwipes = buildUpdatedSwipesArray(args.swipes, args.swipeIndex, args.content);

  const hasNewReasoning =
    typeof args.reasoningText === "string" && args.reasoningText.length > 0;
  const validDuration =
    typeof args.reasoningDuration === "number" &&
    Number.isFinite(args.reasoningDuration) &&
    args.reasoningDuration >= 0
      ? args.reasoningDuration
      : undefined;
  const shouldWriteSwipeReasoning = hasNewReasoning || Boolean(args.clearReasoningSlot);

  let swipeReasoning: SwipeReasoningSlot[] | undefined;
  if (shouldWriteSwipeReasoning) {
    swipeReasoning = updatedSwipes.map((_, idx) => {
      if (idx === args.swipeIndex) {
        return hasNewReasoning
          ? {
              text: args.reasoningText!,
              ...(validDuration !== undefined ? { duration: validDuration } : {}),
            }
          : null;
      }
      return resolveExistingSwipeReasoningSlot(
        idx,
        args.existingExtra,
        args.existingActiveSwipeId,
      );
    });
  }

  return {
    swipes: updatedSwipes,
    ...(args.swipeDates ? { swipe_dates: [...args.swipeDates] } : {}),
    ...(swipeReasoning ? { swipe_reasoning: swipeReasoning } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
    skipChunkRebuild: true,
  };
}

