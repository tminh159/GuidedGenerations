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
      ...rest
    } = msg;
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

  let insertIndex = copy.length;

  switch (position) {
    case "pre_history": {
      if (hasHistoryFlags) {
        insertIndex = historyIndices.length > 0 ? historyIndices[0]! : 0;
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
            const continueIdx = findHistoryContinueAssistantIndex();
            const fallbackIdx =
              continueIdx >= 0 ? continueIdx : findFallbackContinueAssistantIndex();
            insertIndex = fallbackIdx >= 0 ? fallbackIdx : lastHistoryIdx + 1;
          } else {
            insertIndex = lastHistoryIdx + 1;
          }
        } else {
          insertIndex =
            copy.length > 0 && copy[copy.length - 1]?.role === "assistant"
              ? copy.length - 1
              : copy.length;
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
          if (depth === 0) {
            if (options.actionId === "guided_continue") {
              const continueIdx = findHistoryContinueAssistantIndex();
              const fallbackIdx =
                continueIdx >= 0 ? continueIdx : findFallbackContinueAssistantIndex();
              insertIndex = fallbackIdx >= 0 ? fallbackIdx : lastHistoryIdx + 1;
            } else {
              insertIndex = lastHistoryIdx + 1;
            }
          } else {
            const clampedOffset = Math.max(0, historyIndices.length - depth);
            insertIndex = historyIndices[clampedOffset]!;
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
          copy.length > 0 && isPartialAssistantPrefill(copy[copy.length - 1])
            ? copy.length - 1
            : copy.length;
        insertIndex = Math.max(0, endBound - depth);
      }
      break;
    }

    case "post_history": {
      if (
        copy.length > 0 &&
        (isPartialAssistantPrefill(copy[copy.length - 1]) ||
          (options.actionId === "guided_continue" && copy[copy.length - 1]?.role === "assistant"))
      ) {
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

/**
 * Removes the rejected trailing assistant message from an assembled swipe prompt
 * along with its matching `isChatHistory` entry if provided.
 */
export function stripRejectedSwipeAssistantTurnWithHistory(
  messages: readonly AssembledLlmMessageDTO[],
  targetMessageId?: string | null,
  isChatHistory?: readonly boolean[],
): { messages: AssembledLlmMessageDTO[]; isChatHistory?: boolean[] } {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;

  if (targetMessageId && messages.some((msg) => getMessageSourceId(msg) === targetMessageId)) {
    const nextMessages: AssembledLlmMessageDTO[] = [];
    const nextFlags: boolean[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i]!;
      if (getMessageSourceId(msg) === targetMessageId) continue;
      nextMessages.push({ ...msg });
      if (hasFlags) nextFlags.push(Boolean(isChatHistory![i]));
    }
    return {
      messages: nextMessages,
      ...(hasFlags ? { isChatHistory: nextFlags } : {}),
    };
  }

  const copy = messages.map((msg) => ({ ...msg }));
  const nextFlags = hasFlags ? [...isChatHistory!] : undefined;
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    const msg = copy[i];
    if (!msg) continue;
    if (msg.role === "user") {
      break;
    }
    if (msg.role === "assistant") {
      copy.splice(i, 1);
      if (nextFlags) nextFlags.splice(i, 1);
      break;
    }
  }
  return {
    messages: copy,
    ...(nextFlags ? { isChatHistory: nextFlags } : {}),
  };
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
 * dry-run prompt (matched by `sourceMessageId` or trailing blank chat-history assistant turn)
 * along with its matching `isChatHistory` entry if provided.
 */
export function stripCreatedBlankAssistantTurnWithHistory(
  messages: readonly AssembledLlmMessageDTO[],
  createdMessageId?: string | null,
  isChatHistory?: readonly boolean[],
): { messages: AssembledLlmMessageDTO[]; isChatHistory?: boolean[] } {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;

  if (createdMessageId && messages.some((msg) => getMessageSourceId(msg) === createdMessageId)) {
    const nextMessages: AssembledLlmMessageDTO[] = [];
    const nextFlags: boolean[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i]!;
      if (getMessageSourceId(msg) === createdMessageId) continue;
      nextMessages.push({ ...msg });
      if (hasFlags) nextFlags.push(Boolean(isChatHistory![i]));
    }
    return {
      messages: nextMessages,
      ...(hasFlags ? { isChatHistory: nextFlags } : {}),
    };
  }

  const copy = messages.map((msg) => ({ ...msg }));
  const nextFlags = hasFlags ? [...isChatHistory!] : undefined;
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    const msg = copy[i];
    if (!msg) continue;
    if (hasFlags && !nextFlags![i]) {
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
        if (nextFlags) nextFlags.splice(i, 1);
      }
      break;
    }
  }
  return {
    messages: copy,
    ...(nextFlags ? { isChatHistory: nextFlags } : {}),
  };
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

/**
 * Combines base message text with streamed continuation output without
 * collapsing intentional spacing or introducing double gaps at join boundaries.
 */
export function stitchContinueContent(baseContent: string, delta: string): string {
  if (!delta) return baseContent;
  if (!baseContent) return delta;

  const endsWithWhitespace = /\s$/.test(baseContent);
  const startsWithWhitespace = /^\s/.test(delta);
  const startsWithPunctuation = /^[,.;:!?'"’”\)\]\-—…]/.test(delta);

  if (endsWithWhitespace || startsWithWhitespace || startsWithPunctuation) {
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
  nextContexts[idx] = { preset_id: presetId };
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
  clearReasoningSlot?: boolean;
  existingExtra?: Record<string, unknown>;
  existingActiveSwipeId?: number;
  metadata?: Record<string, unknown>;
}): BackgroundSwipePatch {
  const updatedSwipes = buildUpdatedSwipesArray(args.swipes, args.swipeIndex, args.content);

  const hasNewReasoning =
    typeof args.reasoningText === "string" && args.reasoningText.length > 0;
  const shouldWriteSwipeReasoning = hasNewReasoning || Boolean(args.clearReasoningSlot);

  let swipeReasoning: SwipeReasoningSlot[] | undefined;
  if (shouldWriteSwipeReasoning) {
    swipeReasoning = updatedSwipes.map((_, idx) => {
      if (idx === args.swipeIndex) {
        return hasNewReasoning ? { text: args.reasoningText! } : null;
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

