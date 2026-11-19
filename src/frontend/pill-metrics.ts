import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type {
  BackendPushEvent,
  NativeGenerationMetrics,
} from "../shared/types";

export type GenerationMetricsEvent = Extract<
  BackendPushEvent,
  { type: "gg:generation_metrics" }
>;

interface HostMessageShape {
  id: string;
  chat_id?: string;
  swipe_id?: number;
  extra?: Record<string, unknown> | null;
}

type GetMessagesFn = (
  chatId: string,
  options?: { limit?: number; tail?: boolean },
) => Promise<unknown>;

type GetSingleMessageFn = (messageId: string) => Promise<unknown>;

type UpdateMessageFn = (
  chatId: string,
  messageId: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

interface PendingMetricsEntry {
  key: string;
  chatId: string;
  messageId: string;
  swipeId: number;
  tokenCount?: number | null;
  generationMetrics?: NativeGenerationMetrics | null;
  latestFallback?: HostMessageShape | null;
  revision: number;
  attempts: number;
}

const MESSAGE_READ_LIMIT = 50;
const WIDER_MESSAGE_READ_LIMIT = 200;
const RETRY_DELAYS_MS = [0, 50, 150] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractMessageList(page: unknown): HostMessageShape[] {
  const rawList = Array.isArray(page)
    ? page
    : isRecord(page) && Array.isArray(page.data)
      ? page.data
      : isRecord(page) && Array.isArray(page.items)
        ? page.items
        : [];
  const result: HostMessageShape[] = [];
  for (const item of rawList) {
    if (isRecord(item) && typeof item.id === "string") {
      result.push(item as unknown as HostMessageShape);
    }
  }
  return result;
}

function isPageTruncated(page: unknown, messageCount: number, limit: number): boolean {
  if (messageCount >= limit) return true;
  if (isRecord(page) && typeof page.total === "number" && page.total > messageCount) {
    return true;
  }
  return false;
}

function isPermanentError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const upper = message.toUpperCase();
  return (
    upper.includes("PERMISSION_DENIED") ||
    upper.includes("SPINDLE_FRONTEND_INACTIVE") ||
    upper.includes("STALE_GENERATION") ||
    upper.includes("NOT FOUND") ||
    upper.includes("404") ||
    upper.includes("403") ||
    upper.includes("401")
  );
}

/**
 * Persists backend-computed `tokenCount` and `generationMetrics` onto the
 * target message's `extra` via `ctx.chats.updateMessage(chatId, messageId, { extra })`
 * so Lumiverse's native `MetaPill` and tooltip render without extra DOM hacks.
 *
 * Writes are strictly gated on `target.swipe_id === entry.swipeId` because the
 * host REST PUT route folds top-level `extra.tokenCount` / `extra.generationMetrics`
 * into the currently active swipe slot. Background-swipe metrics stay queued
 * until `MESSAGE_SWIPED` / `MESSAGE_EDITED` / `CHAT_CHANGED` reveals the target swipe.
 */
export class PillMetricsController {
  private readonly pending = new Map<string, PendingMetricsEntry>();
  private readonly scheduledKeys = new Set<string>();
  private readonly inFlightByMessage = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextRevision = 0;
  private destroyed = false;

  constructor(private readonly ctx: SpindleFrontendContext) {}

  private makeKey(chatId: string, messageId: string, swipeId: number): string {
    return `${chatId}:${messageId}:${swipeId}`;
  }

  handleMetricsEvent(event: GenerationMetricsEvent): void {
    if (this.destroyed) return;
    if (
      typeof event.chatId !== "string" ||
      !event.chatId ||
      typeof event.messageId !== "string" ||
      !event.messageId ||
      typeof event.swipeId !== "number" ||
      !Number.isInteger(event.swipeId) ||
      event.swipeId < 0
    ) {
      return;
    }
    if (
      event.tokenCount === undefined &&
      event.generationMetrics === undefined
    ) {
      return;
    }

    const key = this.makeKey(event.chatId, event.messageId, event.swipeId);
    const existing = this.pending.get(key);
    const entry: PendingMetricsEntry = {
      key,
      chatId: event.chatId,
      messageId: event.messageId,
      swipeId: event.swipeId,
      tokenCount:
        event.tokenCount !== undefined
          ? event.tokenCount
          : existing?.tokenCount,
      generationMetrics:
        event.generationMetrics !== undefined
          ? event.generationMetrics
          : existing?.generationMetrics,
      latestFallback: existing?.latestFallback ?? null,
      revision: ++this.nextRevision,
      attempts: 0,
    };
    this.pending.set(key, entry);
    this.clearRetryTimer(key);
    this.enqueueFlush(key);
  }

  onMessageEvent(rawPayload: unknown): void {
    if (this.destroyed || this.pending.size === 0) return;

    const payload = isRecord(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord(payload.message) ? payload.message : null;
    const messageId =
      typeof msg?.id === "string"
        ? msg.id
        : typeof payload?.messageId === "string"
          ? payload.messageId
          : null;
    if (!messageId) return;

    const chatId =
      typeof payload?.chatId === "string"
        ? payload.chatId
        : typeof msg?.chat_id === "string"
          ? msg.chat_id
          : null;

    const action = typeof payload?.action === "string" ? payload.action : null;
    const deletedSwipeId =
      action === "deleted" && typeof payload?.swipeId === "number"
        ? payload.swipeId
        : null;
    const activeSwipeId =
      typeof msg?.swipe_id === "number"
        ? msg.swipe_id
        : action !== "deleted" && typeof payload?.swipeId === "number"
          ? payload.swipeId
          : undefined;

    const eventFallback: HostMessageShape | null =
      msg && typeof msg.id === "string"
        ? (msg as unknown as HostMessageShape)
        : null;

    if (deletedSwipeId !== null) {
      const shifted: PendingMetricsEntry[] = [];
      for (const [key, entry] of [...this.pending.entries()]) {
        if (entry.messageId !== messageId) continue;
        if (chatId && entry.chatId !== chatId) continue;

        if (entry.swipeId === deletedSwipeId) {
          this.pending.delete(key);
          this.scheduledKeys.delete(key);
          this.clearRetryTimer(key);
        } else if (entry.swipeId > deletedSwipeId) {
          this.pending.delete(key);
          this.scheduledKeys.delete(key);
          this.clearRetryTimer(key);
          const nextSwipeId = entry.swipeId - 1;
          shifted.push({
            ...entry,
            swipeId: nextSwipeId,
            latestFallback: null,
            key: this.makeKey(entry.chatId, entry.messageId, nextSwipeId),
            revision: ++this.nextRevision,
          });
        }
      }

      for (const entry of shifted) {
        const existing = this.pending.get(entry.key);
        if (!existing || entry.revision > existing.revision) {
          this.scheduledKeys.delete(entry.key);
          this.clearRetryTimer(entry.key);
          this.pending.set(entry.key, entry);
        }
      }
    }

    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.messageId !== messageId) continue;
      if (chatId && entry.chatId !== chatId) continue;

      if (activeSwipeId !== undefined && activeSwipeId !== entry.swipeId) {
        if (eventFallback !== null) {
          entry.latestFallback = eventFallback;
        }
        continue;
      }

      entry.attempts = 0;
      this.enqueueFlush(key, eventFallback);
    }
  }

  onChatChanged(chatId?: string | null): void {
    if (this.destroyed || this.pending.size === 0) return;
    const targetChatId =
      typeof chatId === "string" && chatId.length > 0
        ? chatId
        : this.safeGetActiveChatId();
    if (!targetChatId) return;

    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.chatId !== targetChatId) continue;
      if (
        entry.latestFallback &&
        typeof entry.latestFallback.swipe_id === "number" &&
        entry.latestFallback.swipe_id !== entry.swipeId
      ) {
        continue;
      }
      entry.attempts = 0;
      this.enqueueFlush(key);
    }
  }

  onChatDeleted(chatId: string | null | undefined): void {
    if (this.destroyed || !chatId || this.pending.size === 0) return;
    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.chatId !== chatId) continue;
      this.pending.delete(key);
      this.scheduledKeys.delete(key);
      this.clearRetryTimer(key);
    }
  }

  onMessageDeleted(rawPayload: unknown): void {
    if (this.destroyed || this.pending.size === 0) return;

    const payload = isRecord(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord(payload.message) ? payload.message : null;
    const messageId =
      typeof msg?.id === "string"
        ? msg.id
        : typeof payload?.messageId === "string"
          ? payload.messageId
          : typeof payload?.id === "string"
            ? payload.id
            : null;
    if (!messageId) return;

    const chatId =
      typeof payload?.chatId === "string"
        ? payload.chatId
        : typeof payload?.chat_id === "string"
          ? payload.chat_id
          : typeof msg?.chat_id === "string"
            ? msg.chat_id
            : null;

    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.messageId !== messageId) continue;
      if (chatId && entry.chatId !== chatId) continue;
      this.pending.delete(key);
      this.scheduledKeys.delete(key);
      this.clearRetryTimer(key);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pending.clear();
    this.scheduledKeys.clear();
    this.inFlightByMessage.clear();
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }

  private enqueueFlush(
    key: string,
    eventFallback: HostMessageShape | null = null,
  ): void {
    if (this.destroyed) return;
    const entry = this.pending.get(key);
    if (!entry) return;
    if (eventFallback !== null) {
      entry.latestFallback = eventFallback;
    }
    if (this.scheduledKeys.has(key)) return;
    this.scheduledKeys.add(key);

    const msgKey = `${entry.chatId}:${entry.messageId}`;
    const prev = this.inFlightByMessage.get(msgKey) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async () => {
        this.scheduledKeys.delete(key);
        if (this.destroyed) return;
        await this.flushKey(key, eventFallback);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.inFlightByMessage.get(msgKey) === run) {
          this.inFlightByMessage.delete(msgKey);
        }
      });
    this.inFlightByMessage.set(msgKey, run);
  }

  private async flushKey(
    key: string,
    eventFallback: HostMessageShape | null,
  ): Promise<void> {
    if (this.destroyed) return;
    const current = this.pending.get(key);
    if (!current) return;
    // Snapshot by value so concurrent deletedSwipeId shifts cannot mutate fields in-flight.
    const snapshot: PendingMetricsEntry = { ...current };
    const resolvedFallback = snapshot.latestFallback ?? eventFallback;

    const updateMessage = this.resolveUpdateMessage();
    if (!updateMessage) {
      this.deleteIfSameRevision(key, snapshot.revision);
      return;
    }

    let target: HostMessageShape | null = null;
    const getMessages = this.resolveGetMessages();

    if (getMessages) {
      let page: unknown;
      try {
        page = await getMessages(snapshot.chatId, {
          limit: MESSAGE_READ_LIMIT,
          tail: true,
        });
      } catch (error) {
        if (this.destroyed) return;
        this.handleFlushFailure(key, snapshot, error);
        return;
      }
      if (this.destroyed) return;

      const messages = extractMessageList(page);
      target = messages.find((m) => m.id === snapshot.messageId) ?? null;

      if (!target) {
        const truncated = isPageTruncated(page, messages.length, MESSAGE_READ_LIMIT);
        if (!truncated) {
          // Full tail/chat was returned and message is absent -> deleted cleanly.
          this.deleteIfSameRevision(key, snapshot.revision);
          return;
        }

        const getSingleMessage = this.resolveGetSingleMessage();
        if (getSingleMessage) {
          try {
            const single = await getSingleMessage(snapshot.messageId);
            if (this.destroyed) return;
            if (
              isRecord(single) &&
              typeof single.id === "string" &&
              single.id === snapshot.messageId &&
              (typeof single.chat_id !== "string" || single.chat_id === snapshot.chatId)
            ) {
              target = single as unknown as HostMessageShape;
            }
          } catch {
            // Fall through to wider tail / fallback check
          }
        }

        if (!target && truncated) {
          try {
            const widerPage = await getMessages(snapshot.chatId, {
              limit: WIDER_MESSAGE_READ_LIMIT,
              tail: true,
            });
            if (this.destroyed) return;
            const widerMessages = extractMessageList(widerPage);
            target = widerMessages.find((m) => m.id === snapshot.messageId) ?? null;
            if (
              !target &&
              !isPageTruncated(widerPage, widerMessages.length, WIDER_MESSAGE_READ_LIMIT)
            ) {
              this.deleteIfSameRevision(key, snapshot.revision);
              return;
            }
          } catch (error) {
            if (this.destroyed) return;
            this.handleFlushFailure(key, snapshot, error);
            return;
          }
        }

        if (!target) {
          // Tail read was truncated (or single-message read failed); keep queued for next event.
          return;
        }
      }
    } else if (resolvedFallback && resolvedFallback.id === snapshot.messageId) {
      target = resolvedFallback;
    } else {
      // Cannot verify swipe_id without getMessages or event message payload.
      return;
    }

    const latestBeforeWrite = this.pending.get(key);
    if (!latestBeforeWrite || latestBeforeWrite.revision !== snapshot.revision) {
      return;
    }

    if (typeof target.swipe_id !== "number") {
      return;
    }
    if (target.swipe_id !== snapshot.swipeId) {
      // User is currently viewing a different swipe; cache latest known swipe and keep queued until swiped back.
      latestBeforeWrite.latestFallback = target;
      return;
    }

    const nextExtra: Record<string, unknown> = {
      ...(isRecord(target.extra) ? target.extra : {}),
    };
    if (snapshot.tokenCount !== undefined) {
      nextExtra.tokenCount = snapshot.tokenCount;
    }
    if (snapshot.generationMetrics !== undefined) {
      nextExtra.generationMetrics = snapshot.generationMetrics;
    }

    try {
      await updateMessage(snapshot.chatId, snapshot.messageId, {
        extra: nextExtra,
      });
    } catch (error) {
      if (this.destroyed) return;
      this.handleFlushFailure(key, snapshot, error);
      return;
    }

    if (this.destroyed) return;
    this.deleteIfSameRevision(key, snapshot.revision);
  }

  private handleFlushFailure(
    key: string,
    snapshot: PendingMetricsEntry,
    error: unknown,
  ): void {
    const current = this.pending.get(key);
    if (!current || current.revision !== snapshot.revision) {
      // Newer update or swipe-index shift arrived while in flight; let the newer flush handle it.
      return;
    }
    if (isPermanentError(error) || snapshot.attempts >= RETRY_DELAYS_MS.length) {
      this.pending.delete(key);
      return;
    }
    const delayMs = RETRY_DELAYS_MS[snapshot.attempts] ?? 150;
    current.attempts = snapshot.attempts + 1;
    this.scheduleRetry(key, delayMs);
  }

  private deleteIfSameRevision(key: string, revision: number): void {
    const current = this.pending.get(key);
    if (current && current.revision === revision) {
      this.pending.delete(key);
    }
  }

  private scheduleRetry(key: string, delayMs: number): void {
    if (this.destroyed || this.retryTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(key);
      if (this.destroyed) return;
      this.enqueueFlush(key);
    }, delayMs);
    this.retryTimers.set(key, timer);
  }

  private clearRetryTimer(key: string): void {
    const timer = this.retryTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.retryTimers.delete(key);
    }
  }

  private resolveGetMessages(): GetMessagesFn | null {
    try {
      const domainChats = (
        this.ctx as unknown as {
          domain?: { chats?: { getMessages?: GetMessagesFn } };
        }
      ).domain?.chats;
      if (typeof domainChats?.getMessages === "function") {
        return domainChats.getMessages.bind(domainChats);
      }
      const chats = this.ctx.chats as unknown as
        | { getMessages?: GetMessagesFn }
        | undefined;
      if (typeof chats?.getMessages === "function") {
        return chats.getMessages.bind(chats);
      }
    } catch {
      // Host context may be inactive
    }
    return null;
  }

  private resolveGetSingleMessage(): GetSingleMessageFn | null {
    try {
      const messagesApi = this.ctx.messages as unknown as
        | { get?: GetSingleMessageFn }
        | undefined;
      if (typeof messagesApi?.get === "function") {
        return messagesApi.get.bind(messagesApi);
      }
    } catch {
      // Host context may be inactive
    }
    return null;
  }

  private resolveUpdateMessage(): UpdateMessageFn | null {
    try {
      const chats = this.ctx.chats as unknown as
        | { updateMessage?: UpdateMessageFn }
        | undefined;
      if (typeof chats?.updateMessage === "function") {
        return chats.updateMessage.bind(chats);
      }
    } catch {
      // Host context may be inactive
    }
    return null;
  }

  private safeGetActiveChatId(): string | null {
    try {
      return this.ctx.getActiveChat?.().chatId ?? null;
    } catch {
      return null;
    }
  }
}
