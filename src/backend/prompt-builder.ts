import type {
  ChatMessageDTO,
  DryRunRequestDTO,
  DryRunResultDTO,
  LlmMessageDTO,
} from "lumiverse-spindle-types";
import type { GuidanceInjectionRole, GuidedActionConfig, GuidedActionId } from "../shared/types";

export interface DryRunRequestWithOverride extends DryRunRequestDTO {
  forcePresetId?: boolean;
  includeRequestMessages?: boolean;
}

export interface DryRunResultWithRequestMessages extends DryRunResultDTO {
  request_messages?: LlmMessageDTO[];
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

/**
 * Injects guidance cleanly into an assembled LLM message list.
 * When the prompt ends with an assistant message (continuation target or prefill),
 * or (for guided_continue) an assistant message followed by trailing system
 * continue-nudge blocks, guidance is inserted immediately before that assistant turn
 * so prefill / continuation boundaries remain intact.
 */
export function injectGuidanceMessage(
  messages: readonly LlmMessageDTO[],
  guidanceText: string | null,
  role: GuidanceInjectionRole,
  options: { actionId?: GuidedActionId } = {},
): LlmMessageDTO[] {
  const copy = messages.map((msg) => ({ ...msg }));
  if (!guidanceText || !guidanceText.trim()) {
    return copy;
  }

  const injected: LlmMessageDTO = {
    role,
    content: guidanceText.trim(),
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

/**
 * Removes the rejected trailing assistant message from an assembled swipe prompt
 * so the old swipe text never acts as an assistant prefill for the replacement.
 */
export function stripRejectedSwipeAssistantTurn(
  messages: readonly LlmMessageDTO[],
  targetMessageId?: string | null,
): LlmMessageDTO[] {
  if (targetMessageId && messages.some((msg) => msg.sourceMessageId === targetMessageId)) {
    return messages
      .filter((msg) => msg.sourceMessageId !== targetMessageId)
      .map((msg) => ({ ...msg }));
  }

  const copy = messages.map((msg) => ({ ...msg }));
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    const msg = copy[i];
    if (!msg) continue;
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

/**
 * Produces an updateMessage patch targeting an existing swipe index
 * (used by Guided Response on index 0 and Guided Continue on activeIndex).
 */
export function buildActiveSwipePatch(args: {
  swipes: readonly string[];
  swipeIndex: number;
  content: string;
  swipeDates?: readonly number[];
  reasoningText?: string;
}): MessageSwipePatch {
  const updatedSwipes = [...args.swipes];
  while (updatedSwipes.length <= args.swipeIndex) {
    updatedSwipes.push("");
  }
  updatedSwipes[args.swipeIndex] = args.content;

  return {
    content: args.content,
    swipes: updatedSwipes,
    swipe_id: args.swipeIndex,
    ...(args.swipeDates ? { swipe_dates: [...args.swipeDates] } : {}),
    ...(args.reasoningText !== undefined ? { reasoning: { text: args.reasoningText } } : {}),
  };
}

