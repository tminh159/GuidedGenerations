import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { ActiveRunState, GuidedActionId } from "../shared/types";

const INDICATOR_ACTIONS = new Set<GuidedActionId>([
  "guided_response",
  "guided_regenerate",
  "guided_swipe",
  "guided_continue",
]);

const INDICATOR_HTML_BEFORE =
  '<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';

const INDICATOR_HTML_AFTER =
  '<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';

const MAX_RAF_RETRIES = 30;
const MAX_RUN_STATE_CACHE = 32;

interface ResolvedIndicatorTarget {
  element: Element;
  position: InsertPosition;
  isMessageContent: boolean;
}

interface PerRunIndicatorState {
  viewedSwipeId: number | undefined;
  swipeInitialized: boolean;
  contentSeen: boolean;
}

type MessageEventKind = "MESSAGE_SWIPED" | "MESSAGE_EDITED" | "MESSAGE_SENT";

type RetryMode = "row" | "content" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Displays Lumiverse-style three-dot streaming indicator inside the target
 * message card while a guided generation run is active.
 */
export class StreamingIndicatorController {
  private readonly disposers: Array<() => void> = [];
  private readonly runStateById = new Map<string, PerRunIndicatorState>();
  private currentRun: ActiveRunState | null = null;
  private viewedSwipeId: number | undefined = undefined;
  private swipeInitialized = false;
  private contentSeen = false;
  private mountedEl: Element | null = null;
  private mountedTarget: Element | null = null;
  private mountedPosition: InsertPosition | null = null;
  private rafId: number | null = null;
  private rafTimerId: ReturnType<typeof setTimeout> | null = null;
  private rafRetries = 0;
  private retryMode: RetryMode = null;
  private destroyed = false;

  constructor(private readonly ctx: SpindleFrontendContext) {
    if (typeof this.ctx.events?.on === "function") {
      const handleChatEvent = () => {
        if (!this.destroyed) {
          this.rafRetries = 0;
          this.syncCurrent();
        }
      };

      this.disposers.push(
        this.ctx.events.on("MESSAGE_SWIPED", (rawPayload) => {
          this.onMessageEvent(rawPayload, "MESSAGE_SWIPED");
        }),
        this.ctx.events.on("MESSAGE_EDITED", (rawPayload) => {
          this.onMessageEvent(rawPayload, "MESSAGE_EDITED");
        }),
        this.ctx.events.on("MESSAGE_SENT", (rawPayload) => {
          this.onMessageEvent(rawPayload, "MESSAGE_SENT");
        }),
        this.ctx.events.on("CHAT_CHANGED", handleChatEvent),
        this.ctx.events.on("CHAT_SWITCHED", handleChatEvent),
      );
    }
  }

  sync(run: ActiveRunState | null): void {
    if (this.destroyed) return;

    const prevRun = this.currentRun;
    if (prevRun) {
      this.saveRunState(prevRun.runId);
    }

    const runIdentityChanged =
      prevRun?.runId !== run?.runId ||
      prevRun?.messageId !== run?.messageId ||
      prevRun?.actionId !== run?.actionId;

    if (prevRun?.runId !== run?.runId) {
      const cached = run ? this.runStateById.get(run.runId) : undefined;
      if (cached) {
        this.contentSeen = cached.contentSeen;
        this.viewedSwipeId = cached.viewedSwipeId;
        this.swipeInitialized = cached.swipeInitialized;
      } else {
        this.contentSeen = false;
        this.viewedSwipeId = undefined;
        this.swipeInitialized = false;
      }
      this.resetRetry();
    } else if (prevRun?.messageId !== run?.messageId) {
      this.resetRetry();
    }

    this.currentRun = run;

    if (run && !this.swipeInitialized && run.swipeId !== undefined) {
      this.viewedSwipeId = run.backgroundSwipe ? undefined : run.swipeId;
      this.swipeInitialized = true;
    }
    if (run) {
      this.saveRunState(run.runId);
    }

    if (runIdentityChanged) {
      this.unmount();
    }

    this.syncCurrent();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resetRetry();
    this.unmount();
    this.currentRun = null;
    this.runStateById.clear();
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {
        // Ignore teardown errors from host event bus
      }
    }
    this.disposers.length = 0;
  }

  private saveRunState(runId: string): void {
    if (!runId) return;
    if (this.runStateById.has(runId)) {
      this.runStateById.delete(runId);
    }
    this.runStateById.set(runId, {
      viewedSwipeId: this.viewedSwipeId,
      swipeInitialized: this.swipeInitialized,
      contentSeen: this.contentSeen,
    });
    if (this.runStateById.size > MAX_RUN_STATE_CACHE) {
      const oldestKey = this.runStateById.keys().next().value;
      if (oldestKey !== undefined) {
        this.runStateById.delete(oldestKey);
      }
    }
  }

  private onMessageEvent(
    rawPayload: unknown,
    eventType: MessageEventKind,
  ): void {
    if (this.destroyed || !this.currentRun?.messageId) return;

    const payload = isRecord(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord(payload.message) ? payload.message : null;
    const eventMessageId =
      typeof msg?.id === "string"
        ? msg.id
        : typeof payload?.messageId === "string"
          ? payload.messageId
          : undefined;

    if (eventMessageId === this.currentRun.messageId) {
      const nextSwipeId =
        typeof msg?.swipe_id === "number"
          ? msg.swipe_id
          : typeof payload?.swipeId === "number"
            ? payload.swipeId
            : undefined;
      if (nextSwipeId !== undefined) {
        this.viewedSwipeId = nextSwipeId;
        this.swipeInitialized = true;
      }

      const hasText = typeof msg?.content === "string" && msg.content.length > 0;
      if (
        hasText &&
        (this.currentRun.swipeId == null ||
          this.viewedSwipeId === this.currentRun.swipeId ||
          this.viewedSwipeId === undefined)
      ) {
        this.contentSeen = true;
      }

      this.saveRunState(this.currentRun.runId);

      if (eventType === "MESSAGE_SWIPED" || this.retryMode === "content") {
        this.rafRetries = 0;
      }
    }

    this.syncCurrent();
  }

  private syncCurrent(): void {
    if (this.destroyed) return;
    const run = this.currentRun;
    if (!this.shouldDisplay(run)) {
      this.resetRetry();
      this.unmount();
      return;
    }

    if (
      typeof this.ctx.dom?.findMessageElement !== "function" ||
      typeof this.ctx.dom?.inject !== "function"
    ) {
      return;
    }

    const target = this.resolveTarget(run.messageId, run.actionId);
    if (!target) {
      this.unmount();
      this.ensureRetryMode("row");
      this.scheduleRetry();
      return;
    }

    const expectMessageContent = Boolean(run.hasContentOutput || this.contentSeen);

    if (
      this.mountedEl &&
      this.mountedTarget === target.element &&
      this.mountedPosition === target.position &&
      this.isMountedAt(this.mountedEl, target.element, target.position)
    ) {
      if (!target.isMessageContent && expectMessageContent) {
        this.ensureRetryMode("content");
        this.scheduleRetry();
      } else {
        this.resetRetry();
      }
      return;
    }

    this.unmount();
    const html = target.isMessageContent
      ? INDICATOR_HTML_AFTER
      : INDICATOR_HTML_BEFORE;
    this.mountedEl = this.ctx.dom.inject(target.element, html, target.position);
    this.mountedTarget = target.element;
    this.mountedPosition = target.position;

    if (!target.isMessageContent && expectMessageContent) {
      this.ensureRetryMode("content");
      this.scheduleRetry();
    } else {
      this.resetRetry();
    }
  }

  private shouldDisplay(
    run: ActiveRunState | null,
  ): run is ActiveRunState & { messageId: string } {
    if (!run || this.destroyed) return false;
    if (!INDICATOR_ACTIONS.has(run.actionId)) return false;
    if (typeof run.messageId !== "string" || run.messageId.length === 0) {
      return false;
    }

    const activeChatId = this.safeGetActiveChatId();
    if (!activeChatId || run.chatId !== activeChatId) return false;

    if (run.actionId === "guided_swipe") {
      if (typeof run.swipeId !== "number" || this.viewedSwipeId !== run.swipeId) {
        return false;
      }
    } else if (run.swipeId != null && this.viewedSwipeId !== run.swipeId) {
      return false;
    }

    return true;
  }

  private safeGetActiveChatId(): string | null {
    try {
      return this.ctx.getActiveChat?.().chatId ?? null;
    } catch {
      return null;
    }
  }

  private isMountedAt(
    el: Element,
    target: Element,
    position: InsertPosition,
  ): boolean {
    if (position === "afterend") {
      return target.parentNode !== null && target.nextElementSibling === el;
    }
    if (position === "beforebegin") {
      return target.parentNode !== null && target.previousElementSibling === el;
    }
    return target.contains(el);
  }

  private resolveTarget(
    messageId: string,
    actionId: GuidedActionId,
  ): ResolvedIndicatorTarget | null {
    if (typeof this.ctx.dom?.findMessageElement !== "function") return null;
    const row = this.ctx.dom.findMessageElement(messageId);
    if (!row) return null;

    const messageContent = row.querySelector('[data-component="MessageContent"]');
    if (messageContent) {
      return {
        element: messageContent,
        position: "afterend",
        isMessageContent: true,
      };
    }

    if (actionId === "guided_continue") {
      return this.resolveContinueFallbackTarget(row);
    }

    const mountBefore = row.querySelector(
      '[data-spindle-mount="message_body_before"]',
    );
    if (mountBefore) {
      return {
        element: mountBefore,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    const mountAfter = row.querySelector(
      '[data-spindle-mount="message_body_after"]',
    );
    if (mountAfter) {
      return {
        element: mountAfter,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    const bubbleFallback = row.querySelector(
      '[data-component="BubbleMessage"] > div > div:last-child',
    );
    if (bubbleFallback) {
      return {
        element: bubbleFallback,
        position: "beforeend",
        isMessageContent: false,
      };
    }
    if (
      typeof row.matches === "function" &&
      row.matches('[data-component="BubbleMessage"]')
    ) {
      const el = row.firstElementChild?.lastElementChild;
      return el
        ? { element: el, position: "beforeend", isMessageContent: false }
        : null;
    }

    const minimalFallback = row.querySelector(
      '[data-component="MinimalMessage"] > div',
    );
    if (minimalFallback) {
      return {
        element: minimalFallback,
        position: "beforeend",
        isMessageContent: false,
      };
    }
    if (
      typeof row.matches === "function" &&
      row.matches('[data-component="MinimalMessage"]')
    ) {
      const el = row.firstElementChild;
      return el
        ? { element: el, position: "beforeend", isMessageContent: false }
        : null;
    }

    return null;
  }

  private resolveContinueFallbackTarget(row: Element): ResolvedIndicatorTarget {
    const mountAfter = row.querySelector(
      '[data-spindle-mount="message_body_after"]',
    );
    if (mountAfter) {
      return {
        element: mountAfter,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    const mountBefore = row.querySelector(
      '[data-spindle-mount="message_body_before"]',
    );
    if (mountBefore) {
      return {
        element: mountBefore,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    const bubbleContent = row.querySelector(
      '[data-component="BubbleMessage"] [class*="content"]',
    );
    if (bubbleContent) {
      return {
        element: bubbleContent,
        position: "beforeend",
        isMessageContent: false,
      };
    }
    if (
      typeof row.matches === "function" &&
      row.matches('[data-component="BubbleMessage"]')
    ) {
      const ownContent =
        row.querySelector('[class*="content"]') ??
        row.firstElementChild?.lastElementChild;
      if (ownContent) {
        return {
          element: ownContent,
          position: "beforeend",
          isMessageContent: false,
        };
      }
    }
    const bubbleFallback = row.querySelector(
      '[data-component="BubbleMessage"] > div > div:last-child',
    );
    if (bubbleFallback) {
      return {
        element: bubbleFallback,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    const minimalFallback = row.querySelector(
      '[data-component="MinimalMessage"] > div',
    );
    if (minimalFallback) {
      return {
        element: minimalFallback,
        position: "beforeend",
        isMessageContent: false,
      };
    }
    if (
      typeof row.matches === "function" &&
      row.matches('[data-component="MinimalMessage"]') &&
      row.firstElementChild
    ) {
      return {
        element: row.firstElementChild,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    return { element: row, position: "beforeend", isMessageContent: false };
  }

  private ensureRetryMode(mode: Exclude<RetryMode, null>): void {
    if (this.retryMode !== mode) {
      this.cancelRetry();
      this.rafRetries = 0;
      this.retryMode = mode;
    }
  }

  private resetRetry(): void {
    this.cancelRetry();
    this.rafRetries = 0;
    this.retryMode = null;
  }

  private unmount(): void {
    const el = this.mountedEl;
    this.mountedEl = null;
    this.mountedTarget = null;
    this.mountedPosition = null;
    if (!el) return;
    try {
      if (typeof this.ctx.dom?.uninject === "function") {
        this.ctx.dom.uninject(el);
      } else {
        el.remove();
      }
    } catch {
      // Host DOM may already be torn down
    }
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.rafId !== null || this.rafTimerId !== null) {
      return;
    }
    if (this.rafRetries >= MAX_RAF_RETRIES) return;
    this.rafRetries += 1;

    const raf =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : undefined;
    if (raf) {
      this.rafId = raf(() => {
        this.rafId = null;
        if (!this.destroyed) {
          this.syncCurrent();
        }
      });
    } else {
      this.rafTimerId = setTimeout(() => {
        this.rafTimerId = null;
        if (!this.destroyed) {
          this.syncCurrent();
        }
      }, 16);
    }
  }

  private cancelRetry(): void {
    if (this.rafId !== null) {
      if (typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
    if (this.rafTimerId !== null) {
      clearTimeout(this.rafTimerId);
      this.rafTimerId = null;
    }
  }
}
