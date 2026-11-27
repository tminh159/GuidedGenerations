import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { ActiveRunState, RunActionId } from "../shared/types";

const INDICATOR_ACTIONS = new Set<RunActionId>([
  "guided_response",
  "guided_regenerate",
  "guided_swipe",
  "guided_continue",
  "guided_scene",
]);

const STREAM_AFTER_OPTIMISTIC_ACTIONS = new Set<RunActionId>([
  "guided_response",
  "guided_regenerate",
  "guided_scene",
]);

const LATEST_ROW_OPTIMISTIC_ACTIONS = new Set<RunActionId>([
  "guided_continue",
]);

const INDICATOR_HTML_BEFORE =
  '<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';

const INDICATOR_HTML_AFTER =
  '<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';

const INDICATOR_HTML_OPTIMISTIC =
  '<div class="gg-streaming-indicator gg-streaming-indicator--optimistic" data-gg-optimistic-indicator="true" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';

const FAST_RAF_RETRIES = 2;
const MAX_RETRY_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 32;
const MAX_BACKOFF_MS = 500;
const MAX_RUN_STATE_CACHE = 32;

interface ResolvedIndicatorTarget {
  row: Element;
  element: Element;
  position: InsertPosition;
  isMessageContent: boolean;
}

type DisplayPlan =
  | { kind: "none" }
  | { kind: "stream_after" }
  | {
      kind: "row";
      messageId: string;
      actionId: RunActionId;
      allowStreamAfterFallback: boolean;
      retryRowIfMissing: boolean;
    };

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
  private mountedIsMessageContent: boolean | null = null;
  private mountedMessageId: string | null = null;
  private streamAfterMount: Element | null = null;
  private optimisticStreamEl: Element | null = null;
  private rafId: number | null = null;
  private rafTimerId: ReturnType<typeof setTimeout> | null = null;
  private rowObserver: MutationObserver | null = null;
  private observedRow: Element | null = null;
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

    this.syncCurrent();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resetRetry();
    this.unmount();
    this.streamAfterMount = null;
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

    if (
      eventMessageId !== undefined &&
      eventMessageId !== this.currentRun.messageId
    ) {
      return;
    }

    if (eventMessageId === this.currentRun.messageId) {
      const prevViewedSwipeId = this.viewedSwipeId;
      const prevSwipeInitialized = this.swipeInitialized;
      const prevContentSeen = this.contentSeen;

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

      if (
        this.viewedSwipeId !== prevViewedSwipeId ||
        this.swipeInitialized !== prevSwipeInitialized ||
        this.contentSeen !== prevContentSeen
      ) {
        this.saveRunState(this.currentRun.runId);
      }

      if (eventType === "MESSAGE_SWIPED") {
        this.rafRetries = 0;
      }
    }

    this.syncCurrent();
  }

  private syncCurrent(): void {
    if (this.destroyed) return;
    const run = this.currentRun;
    const plan = this.resolveDisplayPlan(run);
    if (plan.kind === "none") {
      this.resetRetry();
      this.unmount();
      return;
    }

    if (plan.kind === "stream_after") {
      this.resetRetry();
      this.unmountRow();
      this.mountOptimisticStreamAfter();
      return;
    }

    if (
      typeof this.ctx.dom?.findMessageElement !== "function" ||
      typeof this.ctx.dom?.inject !== "function"
    ) {
      if (plan.allowStreamAfterFallback) {
        this.mountOptimisticStreamAfter();
      }
      return;
    }

    if (
      this.mountedEl &&
      this.mountedTarget &&
      this.mountedPosition &&
      this.mountedIsMessageContent === true &&
      this.mountedMessageId === plan.messageId &&
      this.mountedEl.isConnected &&
      this.mountedTarget.isConnected &&
      this.isMountedAt(this.mountedEl, this.mountedTarget, this.mountedPosition)
    ) {
      this.unmountOptimisticStreamAfter();
      this.resetRetry();
      return;
    }

    const target = this.resolveTarget(plan.messageId, plan.actionId);
    if (!target) {
      this.unmountRow();
      if (plan.allowStreamAfterFallback) {
        this.mountOptimisticStreamAfter();
      } else {
        this.unmountOptimisticStreamAfter();
      }
      if (plan.retryRowIfMissing) {
        this.ensureRetryMode("row");
        this.scheduleRetry();
      } else {
        this.resetRetry();
      }
      return;
    }

    const expectMessageContent = Boolean(run?.hasContentOutput || this.contentSeen);

    this.unmountOptimisticStreamAfter();

    if (
      this.mountedEl &&
      this.mountedTarget === target.element &&
      this.mountedPosition === target.position &&
      this.mountedIsMessageContent === target.isMessageContent &&
      this.mountedMessageId === plan.messageId &&
      this.isMountedAt(this.mountedEl, target.element, target.position)
    ) {
      if (!target.isMessageContent && expectMessageContent) {
        this.ensureRetryMode("content");
        this.scheduleRetry(target.row);
      } else {
        this.resetRetry();
      }
      return;
    }

    this.unmountRow();
    const html = target.isMessageContent
      ? INDICATOR_HTML_AFTER
      : INDICATOR_HTML_BEFORE;
    this.mountedEl = this.ctx.dom.inject(target.element, html, target.position);
    this.mountedTarget = target.element;
    this.mountedPosition = target.position;
    this.mountedIsMessageContent = target.isMessageContent;
    this.mountedMessageId = plan.messageId;

    if (!target.isMessageContent && expectMessageContent) {
      this.ensureRetryMode("content");
      this.scheduleRetry(target.row);
    } else {
      this.resetRetry();
    }
  }

  private resolveDisplayPlan(run: ActiveRunState | null): DisplayPlan {
    if (!run || this.destroyed) return { kind: "none" };
    if (!INDICATOR_ACTIONS.has(run.actionId)) return { kind: "none" };

    const activeChatId = this.safeGetActiveChatId();
    if (!activeChatId || run.chatId !== activeChatId) return { kind: "none" };

    const hasConfirmedMessageId =
      typeof run.messageId === "string" && run.messageId.length > 0;

    if (hasConfirmedMessageId) {
      if (run.actionId === "guided_swipe") {
        if (typeof run.swipeId !== "number" || this.viewedSwipeId !== run.swipeId) {
          return { kind: "none" };
        }
      } else if (run.swipeId != null && this.viewedSwipeId !== run.swipeId) {
        return { kind: "none" };
      }

      return {
        kind: "row",
        messageId: run.messageId!,
        actionId: run.actionId,
        allowStreamAfterFallback: STREAM_AFTER_OPTIMISTIC_ACTIONS.has(run.actionId),
        retryRowIfMissing: true,
      };
    }

    // Optimistic phase (before backend confirms run.messageId):
    // Never show an optimistic indicator for guided_swipe (foreground or background) —
    // the new swipe page has not been created yet, so attaching below the current
    // swipe's MessageContent makes foreground swipe look like guided_continue.
    if (run.actionId === "guided_swipe") {
      return { kind: "none" };
    }

    if (STREAM_AFTER_OPTIMISTIC_ACTIONS.has(run.actionId)) {
      return { kind: "stream_after" };
    }

    if (LATEST_ROW_OPTIMISTIC_ACTIONS.has(run.actionId)) {
      if (typeof this.ctx.messages?.getLatestMessageId === "function") {
        const latestMessageId = this.safeGetLatestMessageId();
        if (!latestMessageId) {
          return { kind: "none" };
        }
        return {
          kind: "row",
          messageId: latestMessageId,
          actionId: run.actionId,
          allowStreamAfterFallback: true,
          retryRowIfMissing: false,
        };
      }
      // Graceful fallback on hosts without ctx.messages.getLatestMessageId()
      return { kind: "stream_after" };
    }

    return { kind: "none" };
  }

  private safeGetLatestMessageId(): string | null {
    try {
      const id = this.ctx.messages?.getLatestMessageId?.();
      return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  }

  private getStreamAfterMount(): Element | null {
    if (this.destroyed) return null;
    if (this.streamAfterMount) return this.streamAfterMount;
    if (typeof this.ctx.ui?.mount !== "function") return null;
    try {
      this.streamAfterMount = this.ctx.ui.mount("chat_stream_after");
      return this.streamAfterMount;
    } catch {
      return null;
    }
  }

  private mountOptimisticStreamAfter(): void {
    if (this.destroyed) return;
    const container = this.getStreamAfterMount();
    if (!container) return;
    if (
      this.optimisticStreamEl &&
      this.optimisticStreamEl.parentNode === container
    ) {
      return;
    }
    this.unmountOptimisticStreamAfter();
    if (typeof document === "undefined") return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = INDICATOR_HTML_OPTIMISTIC;
    const el = wrapper.firstElementChild;
    if (!el) return;
    container.append(el);
    this.optimisticStreamEl = el;
  }

  private unmountOptimisticStreamAfter(): void {
    const el = this.optimisticStreamEl;
    this.optimisticStreamEl = null;
    if (!el) return;
    try {
      el.remove();
    } catch {
      // Host DOM may already be torn down
    }
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
    actionId: RunActionId,
  ): ResolvedIndicatorTarget | null {
    if (typeof this.ctx.dom?.findMessageElement !== "function") return null;
    const row = this.ctx.dom.findMessageElement(messageId);
    if (!row) return null;

    const messageContent = row.querySelector('[data-component="MessageContent"]');
    if (messageContent) {
      return {
        row,
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
        row,
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
        row,
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
        row,
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
        ? { row, element: el, position: "beforeend", isMessageContent: false }
        : null;
    }

    const minimalFallback = row.querySelector(
      '[data-component="MinimalMessage"] > div',
    );
    if (minimalFallback) {
      return {
        row,
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
        ? { row, element: el, position: "beforeend", isMessageContent: false }
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
        row,
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
        row,
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
        row,
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
          row,
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
        row,
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
        row,
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
        row,
        element: row.firstElementChild,
        position: "beforeend",
        isMessageContent: false,
      };
    }

    return { row, element: row, position: "beforeend", isMessageContent: false };
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

  private unmountRow(): void {
    const el = this.mountedEl;
    this.mountedEl = null;
    this.mountedTarget = null;
    this.mountedPosition = null;
    this.mountedIsMessageContent = null;
    this.mountedMessageId = null;
    this.disconnectRowObserver();
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

  private unmount(): void {
    this.unmountRow();
    this.unmountOptimisticStreamAfter();
  }

  private scheduleRetry(row?: Element | null): void {
    if (this.destroyed || this.rafId !== null || this.rafTimerId !== null) {
      return;
    }

    if (this.rowObserver !== null) {
      if (row && this.observedRow === row) {
        return;
      }
      this.disconnectRowObserver();
    }

    if (this.rafRetries < FAST_RAF_RETRIES) {
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
      return;
    }

    if (
      this.retryMode === "content" &&
      row &&
      typeof globalThis.MutationObserver === "function"
    ) {
      const observer = new globalThis.MutationObserver((mutations) => {
        if (this.destroyed || this.retryMode !== "content") {
          this.disconnectRowObserver();
          return;
        }
        let hasElementAddition = false;
        for (const mutation of mutations) {
          for (let i = 0; i < mutation.addedNodes.length; i += 1) {
            if (mutation.addedNodes[i]?.nodeType === 1) {
              hasElementAddition = true;
              break;
            }
          }
          if (hasElementAddition) break;
        }
        if (hasElementAddition) {
          this.syncCurrent();
        }
      });
      observer.observe(row, { childList: true, subtree: true });
      this.rowObserver = observer;
      this.observedRow = row;
      return;
    }

    if (this.rafRetries >= MAX_RETRY_ATTEMPTS) return;
    const backoffStep = this.rafRetries - FAST_RAF_RETRIES;
    this.rafRetries += 1;
    const delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** backoffStep);
    this.rafTimerId = setTimeout(() => {
      this.rafTimerId = null;
      if (!this.destroyed) {
        this.syncCurrent();
      }
    }, delayMs);
  }

  private disconnectRowObserver(): void {
    if (this.rowObserver) {
      try {
        this.rowObserver.disconnect();
      } catch {
        // Ignore teardown errors
      }
      this.rowObserver = null;
    }
    this.observedRow = null;
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
    this.disconnectRowObserver();
  }
}
