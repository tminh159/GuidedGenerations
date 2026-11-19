import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { ActiveRunState, BackendPushEvent } from "../shared/types";

export type ChatHeadStatus = "running" | "streaming" | "completed";

type RunWithCharacterMeta = ActiveRunState & {
  characterId?: string;
  characterName?: string;
  avatarUrl?: string;
};

export type StatusPushEvent = Extract<BackendPushEvent, { type: "gg:status" }>;

interface ChatHeadEntry {
  chatId: string;
  runId: string;
  status: ChatHeadStatus;
  startedAt: number;
  characterId?: string;
  characterName?: string;
  avatarUrl?: string;
  avatarFailed?: boolean;
}

interface StoredChatHeadPos {
  xPct: number;
  yPct: number;
}

interface CachedCharacterMeta {
  name?: string;
  avatarUrl?: string;
}

interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface HeadItemRefs {
  item: HTMLDivElement;
  btn: HTMLButtonElement;
  badge: HTMLSpanElement;
  img: HTMLImageElement | null;
  initials: HTMLSpanElement | null;
  pip: HTMLSpanElement | null;
  dismissBtn: HTMLButtonElement | null;
  lastStatus?: ChatHeadStatus;
  lastDisplayName?: string;
  lastLabel?: string;
  lastAvatarUrl?: string;
  lastAvatarFailed?: boolean;
}

const STORAGE_POS_KEY = "gg:chatHeadsPos";
const NATIVE_STORAGE_POS_KEY = "lumiverse:chatHeadsPos";
const DEFAULT_POS: StoredChatHeadPos = { xPct: 94, yPct: 22 };
const DRAG_THRESHOLD_PX = 6;
const HOLD_DISMISS_MS = 450;
const HEAD_SIZE_PX = 48;
const HEAD_GAP_PX = 10;
const ROOT_PAD_PX = 6;
const VIEWPORT_PAD_PX = 12;
const NATIVE_COLLISION_GAP_PX = 8;
const SUPPRESS_CLICK_FALLBACK_MS = 350;
const MAX_CHARACTER_CACHE_ENTRIES = 200;
const NATIVE_HEAD_SCAN_SELECTOR =
  "[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head]), body > * > [data-chat-id]:not([data-gg-chat-head])";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (min > max) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

function clampPct(value: number, min = 2, max = 98): number {
  return clamp(value, min, max);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    Boolean(value) &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function extractChatIdFromEventPayload(rawPayload: unknown): string | null {
  if (!isRecord(rawPayload)) return null;
  if (typeof rawPayload.chatId === "string" && rawPayload.chatId) {
    return rawPayload.chatId;
  }
  if (typeof rawPayload.id === "string" && rawPayload.id) {
    return rawPayload.id;
  }
  if (isRecord(rawPayload.chat) && typeof rawPayload.chat.id === "string" && rawPayload.chat.id) {
    return rawPayload.chat.id;
  }
  return null;
}

function computeInitials(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return "GG";
  const words = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function buildDefaultAvatarUrl(characterId: string): string {
  return `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?thumb=1`;
}

/**
 * Allows only relative root paths (`/api/...`, excluding protocol-relative `//...`),
 * `http:` / `https:` URLs, or `data:image/*` URIs.
 */
function sanitizeAvatarUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  if (/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // Reject malformed URLs or unsafe schemes
  }
  return undefined;
}

function boxesOverlap(a: RectBox, b: RectBox, gap = 0): boolean {
  return !(
    a.right + gap <= b.left ||
    a.left >= b.right + gap ||
    a.bottom + gap <= b.top ||
    a.top >= b.bottom + gap
  );
}

/**
 * Renders floating Chat Head bubbles portaled to `document.body` when a
 * Guided Generations run is active in a background chat or has completed
 * while the user is viewing another chat.
 */
export class ChatHeadController {
  private readonly heads = new Map<string, ChatHeadEntry>();
  private readonly headItemRefs = new Map<string, HeadItemRefs>();
  private readonly characterCache = new Map<string, CachedCharacterMeta>();
  private readonly pendingCharacterFetches = new Set<string>();
  private readonly disposers: Array<() => void> = [];
  private rootEl: HTMLDivElement | null = null;
  private resizeCleanup: (() => void) | null = null;
  private dragCleanup: (() => void) | null = null;
  private suppressClickTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressNextClick = false;
  private isDragging = false;
  private pos: StoredChatHeadPos;
  private destroyed = false;

  constructor(private readonly ctx: SpindleFrontendContext) {
    this.pos = this.loadPosition();
    if (typeof this.ctx.events?.on === "function") {
      try {
        this.disposers.push(
          this.ctx.events.on("CHAT_DELETED", (payload) => {
            this.onChatDeleted(extractChatIdFromEventPayload(payload));
          }),
        );
      } catch {
        // Ignore host event subscription errors
      }
    }
  }

  syncRuns(
    runs: Iterable<ActiveRunState>,
    activeChatId?: string | null,
  ): void {
    if (this.destroyed) return;
    const currentActiveChatId =
      activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();

    if (currentActiveChatId) {
      const activeHead = this.heads.get(currentActiveChatId);
      if (activeHead?.status === "completed") {
        this.heads.delete(currentActiveChatId);
      }
    }

    const incomingByChat = new Map<string, RunWithCharacterMeta>();
    for (const rawRun of runs) {
      const run = rawRun as RunWithCharacterMeta;
      if (run && typeof run.chatId === "string" && run.chatId.length > 0) {
        incomingByChat.set(run.chatId, run);
      }
    }

    for (const [chatId, existing] of [...this.heads.entries()]) {
      if (existing.status === "completed") continue;
      if (!incomingByChat.has(chatId)) {
        this.heads.delete(chatId);
      }
    }

    for (const [, run] of incomingByChat.entries()) {
      this.upsertFromActiveRun(run, currentActiveChatId);
    }

    this.render(currentActiveChatId);
  }

  handleStatusEvent(
    event: StatusPushEvent,
    activeChatId?: string | null,
  ): void {
    if (this.destroyed) return;
    const currentActiveChatId =
      activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();

    const eventChatId =
      typeof event.chatId === "string" && event.chatId.length > 0
        ? event.chatId
        : undefined;
    const run = (event.run ?? null) as RunWithCharacterMeta | null;
    const hasTerminalSignal =
      Boolean(event.done) || Boolean(event.aborted) || Boolean(event.error);

    if (
      eventChatId &&
      (hasTerminalSignal || !run || run.chatId !== eventChatId)
    ) {
      this.finalizeChatRun(
        eventChatId,
        {
          aborted: Boolean(event.aborted),
          hasError: Boolean(event.error),
        },
        currentActiveChatId,
      );
    }

    if (run && typeof run.chatId === "string" && run.chatId.length > 0) {
      if (!hasTerminalSignal || (eventChatId !== undefined && run.chatId !== eventChatId)) {
        this.upsertFromActiveRun(run, currentActiveChatId);
      } else if (!eventChatId && hasTerminalSignal) {
        this.finalizeChatRun(
          run.chatId,
          {
            aborted: Boolean(event.aborted),
            hasError: Boolean(event.error),
          },
          currentActiveChatId,
        );
      }
    } else if (!eventChatId) {
      for (const [chatId, entry] of [...this.heads.entries()]) {
        if (entry.status === "running" || entry.status === "streaming") {
          this.finalizeChatRun(
            chatId,
            {
              aborted: Boolean(event.aborted),
              hasError: Boolean(event.error),
            },
            currentActiveChatId,
          );
        }
      }
    }

    this.render(currentActiveChatId);
  }

  onChatChanged(activeChatId?: string | null): void {
    if (this.destroyed) return;
    const currentActiveChatId =
      activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();

    if (currentActiveChatId) {
      const existing = this.heads.get(currentActiveChatId);
      if (existing?.status === "completed") {
        this.heads.delete(currentActiveChatId);
      }
    }

    this.render(currentActiveChatId);
  }

  onChatDeleted(chatId: string | null | undefined): void {
    if (this.destroyed || !chatId) return;
    if (this.heads.delete(chatId)) {
      this.render();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearDragSession();
    this.clearResizeListener();
    this.clearSuppressClickTimer();
    this.suppressNextClick = false;
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {
        // Ignore teardown errors
      }
    }
    this.disposers.length = 0;
    this.heads.clear();
    this.headItemRefs.clear();
    this.characterCache.clear();
    this.pendingCharacterFetches.clear();
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
  }

  private getCachedCharacter(characterId: string): CachedCharacterMeta | undefined {
    const cached = this.characterCache.get(characterId);
    if (cached !== undefined) {
      // Refresh LRU recency
      this.characterCache.delete(characterId);
      this.characterCache.set(characterId, cached);
    }
    return cached;
  }

  private setCachedCharacter(
    characterId: string,
    meta: CachedCharacterMeta,
  ): void {
    if (this.characterCache.has(characterId)) {
      this.characterCache.delete(characterId);
    } else if (this.characterCache.size >= MAX_CHARACTER_CACHE_ENTRIES) {
      const oldestKey = this.characterCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.characterCache.delete(oldestKey);
      }
    }
    this.characterCache.set(characterId, meta);
  }

  private upsertFromActiveRun(
    run: RunWithCharacterMeta,
    currentActiveChatId: string | null,
  ): void {
    const existing = this.heads.get(run.chatId);
    const activeChatMeta =
      currentActiveChatId === run.chatId ? this.safeGetActiveChat() : null;
    const characterId =
      (typeof run.characterId === "string" && run.characterId.length > 0
        ? run.characterId
        : undefined) ??
      existing?.characterId ??
      (typeof activeChatMeta?.characterId === "string" &&
      activeChatMeta.characterId.length > 0
        ? activeChatMeta.characterId
        : undefined);

    const cached = characterId ? this.getCachedCharacter(characterId) : undefined;
    const characterName =
      (typeof run.characterName === "string" && run.characterName.trim().length > 0
        ? run.characterName.trim()
        : undefined) ??
      existing?.characterName ??
      cached?.name;

    const avatarUrl =
      sanitizeAvatarUrl(run.avatarUrl) ??
      sanitizeAvatarUrl(existing?.avatarUrl) ??
      sanitizeAvatarUrl(cached?.avatarUrl) ??
      (characterId ? buildDefaultAvatarUrl(characterId) : undefined);

    const status: ChatHeadStatus = run.hasContentOutput ? "streaming" : "running";

    const nextEntry: ChatHeadEntry = {
      chatId: run.chatId,
      runId: run.runId,
      status,
      startedAt: run.startedAt,
      ...(characterId ? { characterId } : {}),
      ...(characterName ? { characterName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(existing?.avatarFailed && existing.avatarUrl === avatarUrl
        ? { avatarFailed: true }
        : {}),
    };

    this.heads.set(run.chatId, nextEntry);

    if (characterId && !characterName && !this.characterCache.has(characterId)) {
      void this.resolveCharacterMeta(run.chatId, characterId);
    }
  }

  private finalizeChatRun(
    chatId: string,
    outcome: { aborted: boolean; hasError: boolean },
    currentActiveChatId: string | null,
  ): void {
    const existing = this.heads.get(chatId);
    if (
      outcome.aborted ||
      outcome.hasError ||
      currentActiveChatId === chatId
    ) {
      this.heads.delete(chatId);
      return;
    }

    if (existing) {
      this.heads.set(chatId, {
        ...existing,
        status: "completed",
      });
    } else {
      this.heads.set(chatId, {
        chatId,
        runId: `gg-completed-${chatId}`,
        status: "completed",
        startedAt: Date.now(),
      });
    }
  }

  private async resolveCharacterMeta(
    chatId: string,
    characterId: string,
  ): Promise<void> {
    if (this.destroyed || !characterId) return;
    if (
      this.pendingCharacterFetches.has(characterId) ||
      this.characterCache.has(characterId)
    ) {
      return;
    }

    const charactersApi = (
      this.ctx as unknown as {
        characters?: {
          get?: (id: string) => unknown;
        };
      }
    ).characters;
    if (typeof charactersApi?.get !== "function") return;

    this.pendingCharacterFetches.add(characterId);
    try {
      const raw = await Promise.resolve(charactersApi.get(characterId));
      if (this.destroyed) return;
      if (!isRecord(raw)) {
        this.setCachedCharacter(characterId, {});
        return;
      }

      const name =
        typeof raw.name === "string" && raw.name.trim().length > 0
          ? raw.name.trim()
          : undefined;
      const defaultAvatar = buildDefaultAvatarUrl(characterId);
      const customAvatar =
        sanitizeAvatarUrl(raw.avatarUrl) ?? sanitizeAvatarUrl(raw.avatar_url);
      const safeAvatar = customAvatar ?? defaultAvatar;

      this.setCachedCharacter(characterId, {
        ...(name ? { name } : {}),
        avatarUrl: safeAvatar,
      });

      const entry = this.heads.get(chatId);
      if (entry && entry.characterId === characterId) {
        let changed = false;
        if (name && !entry.characterName) {
          entry.characterName = name;
          changed = true;
        }
        if (customAvatar && (!entry.avatarUrl || entry.avatarUrl === defaultAvatar)) {
          if (entry.avatarUrl !== customAvatar) {
            entry.avatarUrl = customAvatar;
            delete entry.avatarFailed;
            changed = true;
          }
        } else if (safeAvatar && !entry.avatarUrl) {
          entry.avatarUrl = safeAvatar;
          changed = true;
        }
        if (changed) {
          this.render();
        }
      }
    } catch {
      if (!this.destroyed) {
        this.setCachedCharacter(characterId, {});
      }
    } finally {
      this.pendingCharacterFetches.delete(characterId);
    }
  }

  private render(activeChatId?: string | null): void {
    if (this.destroyed) return;
    if (typeof document === "undefined" || !document.body) return;

    const currentActiveChatId =
      activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();

    const { nativeChatIds, nativeContainer } =
      this.heads.size > 0
        ? this.scanNativeChatHeads()
        : { nativeChatIds: new Set<string>(), nativeContainer: null };

    const visibleEntries: ChatHeadEntry[] = [];
    for (const entry of this.heads.values()) {
      if (entry.chatId === currentActiveChatId) continue;
      if (nativeChatIds.has(entry.chatId)) continue;
      visibleEntries.push(entry);
    }

    if (visibleEntries.length === 0) {
      this.clearDragSession();
      this.clearResizeListener();
      this.headItemRefs.clear();
      if (this.rootEl) {
        this.rootEl.remove();
        this.rootEl = null;
      }
      return;
    }

    const avoidNative = !this.isDragging;
    const viewport = this.getViewportSize();
    const preReadNativeBox =
      avoidNative && nativeContainer
        ? this.resolveNativeBounds(nativeContainer, viewport.vw, viewport.vh)
        : null;

    if (!this.rootEl) {
      this.rootEl = document.createElement("div");
      this.rootEl.className = "gg-chat-heads-root";
      this.rootEl.setAttribute("data-gg-chat-heads-root", "true");
      this.attachDragHandlers(this.rootEl);
      this.ensureResizeListener();
    }

    const visibleIds = new Set(visibleEntries.map((entry) => entry.chatId));
    for (const [chatId, refs] of [...this.headItemRefs.entries()]) {
      if (!visibleIds.has(chatId)) {
        refs.item.remove();
        this.headItemRefs.delete(chatId);
      }
    }

    for (let i = 0; i < visibleEntries.length; i += 1) {
      const entry = visibleEntries[i]!;
      let refs = this.headItemRefs.get(entry.chatId);
      if (refs) {
        this.updateHeadItem(refs, entry);
      } else {
        refs = this.buildHeadItem(entry);
        this.headItemRefs.set(entry.chatId, refs);
      }
      if (this.rootEl.children[i] !== refs.item) {
        this.rootEl.insertBefore(refs.item, this.rootEl.children[i] ?? null);
      }
    }

    this.applyRootPosition(this.rootEl, visibleEntries.length, {
      avoidNative,
      nativeBox: preReadNativeBox,
      viewport,
    });

    if (!this.rootEl.isConnected) {
      document.body.append(this.rootEl);
    }
  }

  private buildHeadItem(entry: ChatHeadEntry): HeadItemRefs {
    const chatId = entry.chatId;
    const item = document.createElement("div");
    item.className = "gg-chat-head-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gg-chat-head";
    btn.setAttribute("data-gg-chat-head", "true");
    btn.setAttribute("data-chat-id", chatId);

    const badge = document.createElement("span");
    badge.className = "gg-chat-head-badge";
    badge.setAttribute("aria-hidden", "true");
    btn.append(badge);

    btn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isDragging && this.heads.get(chatId)?.status === "completed") {
        this.dismissCompletedHead(chatId);
      }
    });

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        this.clearSuppressClickTimer();
        return;
      }
      this.navigateToChat(chatId, () => {
        if (this.destroyed) return;
        const latest = this.heads.get(chatId);
        if (latest?.status === "completed") {
          this.heads.delete(chatId);
          this.render();
        }
      });
    });

    item.append(btn);
    const refs: HeadItemRefs = {
      item,
      btn,
      badge,
      img: null,
      initials: null,
      pip: null,
      dismissBtn: null,
    };
    this.updateHeadItem(refs, entry);
    return refs;
  }

  private updateHeadItem(refs: HeadItemRefs, entry: ChatHeadEntry): void {
    const { item, btn, badge } = refs;

    if (refs.lastStatus !== entry.status) {
      btn.classList.toggle(
        "is-running",
        entry.status === "running" || entry.status === "streaming",
      );
      btn.classList.toggle("is-streaming", entry.status === "streaming");
      btn.classList.toggle("is-completed", entry.status === "completed");
      btn.setAttribute("data-status", entry.status);
    }

    const displayName = entry.characterName || entry.chatId;
    const statusDescription =
      entry.status === "completed"
        ? "Generation completed — click to open chat"
        : entry.status === "streaming"
          ? "Streaming response in background — click to open chat"
          : "Generating response in background — click to open chat";
    const fullLabel = `${displayName}: ${statusDescription}`;
    if (refs.lastLabel !== fullLabel) {
      btn.setAttribute("aria-label", fullLabel);
      btn.title = fullLabel;
      refs.lastLabel = fullLabel;
    }

    const effectiveAvatarUrl =
      entry.avatarUrl ??
      (entry.characterId ? buildDefaultAvatarUrl(entry.characterId) : undefined);
    const avatarFailed = Boolean(entry.avatarFailed);

    if (
      refs.lastAvatarUrl !== effectiveAvatarUrl ||
      refs.lastAvatarFailed !== avatarFailed ||
      refs.lastDisplayName !== displayName ||
      (!refs.img && !refs.initials)
    ) {
      if (effectiveAvatarUrl && !avatarFailed) {
        if (refs.initials) {
          refs.initials.remove();
          refs.initials = null;
        }
        if (refs.img) {
          if (refs.img.getAttribute("src") !== effectiveAvatarUrl) {
            refs.img.src = effectiveAvatarUrl;
          }
          refs.img.alt = displayName;
        } else {
          const img = document.createElement("img");
          img.className = "gg-chat-head-avatar";
          img.src = effectiveAvatarUrl;
          img.alt = displayName;
          img.draggable = false;
          img.addEventListener("error", () => {
            if (this.destroyed) return;
            const current = this.heads.get(entry.chatId);
            if (current) {
              current.avatarFailed = true;
            }
            if (img.isConnected) {
              const latestName =
                this.heads.get(entry.chatId)?.characterName || entry.chatId;
              const initials = document.createElement("span");
              initials.className = "gg-chat-head-initials";
              initials.textContent = computeInitials(latestName);
              img.replaceWith(initials);
              const latestRefs = this.headItemRefs.get(entry.chatId);
              if (latestRefs && latestRefs.img === img) {
                latestRefs.img = null;
                latestRefs.initials = initials;
                latestRefs.lastAvatarFailed = true;
              }
            }
          });
          btn.insertBefore(img, badge);
          refs.img = img;
        }
      } else {
        if (refs.img) {
          refs.img.remove();
          refs.img = null;
        }
        const initialsText = computeInitials(displayName);
        if (refs.initials) {
          refs.initials.textContent = initialsText;
        } else {
          const initials = document.createElement("span");
          initials.className = "gg-chat-head-initials";
          initials.textContent = initialsText;
          btn.insertBefore(initials, badge);
          refs.initials = initials;
        }
      }
      refs.lastAvatarUrl = effectiveAvatarUrl;
      refs.lastAvatarFailed = avatarFailed;
    }

    if (entry.status === "completed") {
      if (!refs.pip) {
        const pip = document.createElement("span");
        pip.className = "gg-chat-head-pip";
        pip.setAttribute("aria-hidden", "true");
        btn.append(pip);
        refs.pip = pip;
      }
    } else if (refs.pip) {
      refs.pip.remove();
      refs.pip = null;
    }

    if (entry.status === "completed") {
      if (refs.dismissBtn) {
        if (refs.lastDisplayName !== displayName) {
          refs.dismissBtn.setAttribute("aria-label", `Dismiss ${displayName}`);
        }
      } else {
        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "gg-chat-head-dismiss";
        dismissBtn.setAttribute("data-gg-chat-head-dismiss", "true");
        dismissBtn.setAttribute("aria-label", `Dismiss ${displayName}`);
        dismissBtn.title = "Dismiss";
        dismissBtn.textContent = "×";
        dismissBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.dismissCompletedHead(entry.chatId);
        });
        item.append(dismissBtn);
        refs.dismissBtn = dismissBtn;
      }
    } else if (refs.dismissBtn) {
      refs.dismissBtn.remove();
      refs.dismissBtn = null;
    }

    refs.lastStatus = entry.status;
    refs.lastDisplayName = displayName;
  }

  private dismissCompletedHead(chatId: string): void {
    if (this.destroyed) return;
    const entry = this.heads.get(chatId);
    if (entry?.status === "completed") {
      this.heads.delete(chatId);
      this.render();
    }
  }

  private scanNativeChatHeads(): {
    nativeChatIds: Set<string>;
    nativeContainer: HTMLElement | null;
  } {
    const nativeChatIds = new Set<string>();
    let nativeContainer: HTMLElement | null = null;
    if (typeof document === "undefined" || !document.body) {
      return { nativeChatIds, nativeContainer };
    }

    const candidates = document.body.querySelectorAll(NATIVE_HEAD_SCAN_SELECTOR);
    const parentIsNative = new Map<Element, boolean>();

    for (const el of candidates) {
      if (el.hasAttribute("data-gg-chat-head")) continue;
      if (this.rootEl?.contains(el) || el.closest("[data-gg-chat-heads-root]")) {
        continue;
      }

      const chatId = el.getAttribute("data-chat-id");
      if (!chatId) continue;

      const isDirectNative =
        el.hasAttribute("data-head-idx") || el.hasAttribute("data-chat-head");

      if (isDirectNative) {
        nativeChatIds.add(chatId);
        if (!nativeContainer) {
          const parent = el.parentElement;
          nativeContainer =
            !parent || parent === document.body ? (el as HTMLElement) : parent;
        }
        continue;
      }

      const parent = el.parentElement;
      if (parent && parent.parentElement === document.body) {
        let isNative = parentIsNative.get(parent);
        if (isNative === undefined) {
          const cls = typeof parent.className === "string" ? parent.className : "";
          isNative =
            /ChatHeads/i.test(cls) || parent.querySelector("[data-head-idx]") !== null;
          parentIsNative.set(parent, isNative);
        }
        if (isNative) {
          nativeChatIds.add(chatId);
        }
      }
    }

    return { nativeChatIds, nativeContainer };
  }

  private findNativeChatHeadsContainer(): HTMLElement | null {
    return this.scanNativeChatHeads().nativeContainer;
  }

  private getViewportSize(): { vw: number; vh: number } {
    const win =
      typeof window !== "undefined"
        ? window
        : typeof document !== "undefined"
          ? document.defaultView
          : null;
    const vw =
      win && typeof win.innerWidth === "number" && win.innerWidth > 0
        ? win.innerWidth
        : (typeof document !== "undefined" ? document.documentElement?.clientWidth : 0) || 1024;
    const vh =
      win && typeof win.innerHeight === "number" && win.innerHeight > 0
        ? win.innerHeight
        : (typeof document !== "undefined" ? document.documentElement?.clientHeight : 0) || 768;
    return { vw, vh };
  }

  private getStackDimensions(
    headCount: number,
    vh: number,
  ): { width: number; height: number } {
    const count = Math.max(1, headCount);
    const rawWidth = HEAD_SIZE_PX + ROOT_PAD_PX * 2;
    const rawHeight =
      count * HEAD_SIZE_PX +
      Math.max(0, count - 1) * HEAD_GAP_PX +
      ROOT_PAD_PX * 2;
    const maxHeight = Math.max(HEAD_SIZE_PX + ROOT_PAD_PX * 2, vh - VIEWPORT_PAD_PX * 2);
    return {
      width: rawWidth,
      height: Math.min(rawHeight, maxHeight),
    };
  }

  private clampCenterPos(
    pos: StoredChatHeadPos,
    headCount: number,
    viewport?: { vw: number; vh: number },
  ): StoredChatHeadPos {
    const { vw, vh } = viewport ?? this.getViewportSize();
    const { width, height } = this.getStackDimensions(headCount, vh);
    const minX = VIEWPORT_PAD_PX + width / 2;
    const maxX = vw - VIEWPORT_PAD_PX - width / 2;
    const minY = VIEWPORT_PAD_PX + height / 2;
    const maxY = vh - VIEWPORT_PAD_PX - height / 2;
    const cx = clamp((pos.xPct / 100) * vw, minX, maxX);
    const cy = clamp((pos.yPct / 100) * vh, minY, maxY);
    return {
      xPct: (cx / vw) * 100,
      yPct: (cy / vh) * 100,
    };
  }

  private resolveNativeBounds(
    container: HTMLElement,
    vw: number,
    vh: number,
  ): RectBox | null {
    try {
      const rect = container.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }
    } catch {
      // Ignore layout measurement failures
    }

    const nativeHeads = container.querySelectorAll(
      "[data-head-idx], [data-chat-head]",
    );
    const nativeCount = Math.max(1, nativeHeads.length);
    const isRow = container.style?.flexDirection === "row";
    const estWidth = isRow
      ? nativeCount * HEAD_SIZE_PX + Math.max(0, nativeCount - 1) * 8 + 12
      : HEAD_SIZE_PX + 12;
    const estHeight = isRow
      ? HEAD_SIZE_PX + 12
      : nativeCount * HEAD_SIZE_PX + Math.max(0, nativeCount - 1) * 8 + 12;

    const styleLeft = parseFloat(container.style?.left ?? "");
    const styleTop = parseFloat(container.style?.top ?? "");
    if (Number.isFinite(styleLeft) && Number.isFinite(styleTop) && styleLeft >= 0 && styleTop >= 0) {
      return {
        left: styleLeft,
        top: styleTop,
        right: styleLeft + estWidth,
        bottom: styleTop + estHeight,
      };
    }

    const stored = this.readNativeStoredPosition();
    if (stored) {
      let left: number;
      let top: number;
      if (stored.xPct < 0 || stored.yPct < 0) {
        left = vw - estWidth - VIEWPORT_PAD_PX;
        top = Math.round((vh - estHeight) / 2);
      } else if (stored.xPct <= 1 && stored.yPct <= 1) {
        left = clamp(stored.xPct * vw, VIEWPORT_PAD_PX, vw - estWidth - VIEWPORT_PAD_PX);
        top = clamp(stored.yPct * vh, VIEWPORT_PAD_PX, vh - estHeight - VIEWPORT_PAD_PX);
      } else {
        left = clamp((stored.xPct / 100) * vw, VIEWPORT_PAD_PX, vw - estWidth - VIEWPORT_PAD_PX);
        top = clamp((stored.yPct / 100) * vh, VIEWPORT_PAD_PX, vh - estHeight - VIEWPORT_PAD_PX);
      }
      return {
        left,
        top,
        right: left + estWidth,
        bottom: top + estHeight,
      };
    }

    const defaultLeft = vw - estWidth - VIEWPORT_PAD_PX;
    const defaultTop = Math.round((vh - estHeight) / 2);
    return {
      left: defaultLeft,
      top: defaultTop,
      right: defaultLeft + estWidth,
      bottom: defaultTop + estHeight,
    };
  }

  private readNativeStoredPosition(): StoredChatHeadPos | null {
    try {
      const storage = this.getStorage();
      const raw = storage?.getItem(NATIVE_STORAGE_POS_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        isRecord(parsed) &&
        typeof parsed.xPct === "number" &&
        Number.isFinite(parsed.xPct) &&
        typeof parsed.yPct === "number" &&
        Number.isFinite(parsed.yPct)
      ) {
        return { xPct: parsed.xPct, yPct: parsed.yPct };
      }
    } catch {
      // Ignore storage access errors
    }
    return null;
  }

  private attachDragHandlers(root: HTMLDivElement): void {
    root.addEventListener("click", () => {
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        this.clearSuppressClickTimer();
      }
    });

    root.addEventListener("pointerdown", (event: PointerEvent) => {
      if (this.destroyed) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (typeof document === "undefined") return;
      const target = event.target as Element | null;
      if (target?.closest?.("[data-gg-chat-head-dismiss]")) {
        return;
      }
      if (this.isDragging) {
        return;
      }

      this.clearSuppressClickTimer();
      this.suppressNextClick = false;
      this.clearDragSession();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const dragViewport = this.getViewportSize();
      const dragVisibleCount = this.rootEl?.children.length || this.heads.size || 1;
      const styleLeftPct = parseFloat(root.style.left);
      const styleTopPct = parseFloat(root.style.top);
      const startPos =
        Number.isFinite(styleLeftPct) && Number.isFinite(styleTopPct)
          ? { xPct: styleLeftPct, yPct: styleTopPct }
          : this.clampCenterPos(this.pos, dragVisibleCount, dragViewport);
      let moved = false;
      let finished = false;
      let holdDismissTimer: ReturnType<typeof setTimeout> | null = null;
      let dragRafId: number | null = null;
      let pendingDx = 0;
      let pendingDy = 0;
      let hasPendingMove = false;

      const clearHoldDismissTimer = () => {
        if (holdDismissTimer !== null) {
          clearTimeout(holdDismissTimer);
          holdDismissTimer = null;
        }
      };

      const cancelDragRaf = () => {
        if (dragRafId !== null) {
          if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(dragRafId);
          }
          dragRafId = null;
        }
      };

      const applyPendingDragMove = () => {
        if (!hasPendingMove || this.destroyed) return;
        hasPendingMove = false;
        this.pos = this.clampCenterPos(
          {
            xPct: startPos.xPct + (pendingDx / dragViewport.vw) * 100,
            yPct: startPos.yPct + (pendingDy / dragViewport.vh) * 100,
          },
          dragVisibleCount,
          dragViewport,
        );
        if (this.rootEl) {
          this.applyRootPosition(this.rootEl, dragVisibleCount, {
            avoidNative: false,
            viewport: dragViewport,
          });
        }
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          moved = true;
          clearHoldDismissTimer();
          this.isDragging = true;
          this.suppressNextClick = true;
          root.classList.add("is-dragging");
          try {
            root.setPointerCapture?.(pointerId);
          } catch {
            // Synthetic events or non-active pointers may throw
          }
        }
        if (!moved) return;

        pendingDx = dx;
        pendingDy = dy;
        hasPendingMove = true;

        if (typeof requestAnimationFrame === "function") {
          if (dragRafId === null) {
            dragRafId = requestAnimationFrame(() => {
              dragRafId = null;
              if (finished || this.destroyed) return;
              applyPendingDragMove();
            });
          }
        } else {
          applyPendingDragMove();
        }
      };

      const finishDrag = () => {
        if (finished) return;
        finished = true;
        clearHoldDismissTimer();
        cancelDragRaf();
        if (moved && hasPendingMove) {
          applyPendingDragMove();
        }
        this.clearDragSession();
        root.classList.remove("is-dragging");
        try {
          if (root.hasPointerCapture?.(pointerId)) {
            root.releasePointerCapture?.(pointerId);
          }
        } catch {
          // Ignore release errors
        }
        if (moved) {
          this.savePosition(this.pos);
          if (this.rootEl) {
            const visibleCount = this.rootEl.children.length || this.heads.size || 1;
            this.applyRootPosition(this.rootEl, visibleCount);
          }
          this.clearSuppressClickTimer();
          this.suppressClickTimer = setTimeout(() => {
            this.suppressClickTimer = null;
            this.suppressNextClick = false;
          }, SUPPRESS_CLICK_FALLBACK_MS);
        }
      };

      const touchedHeadBtn = target?.closest?.("[data-gg-chat-head]") as HTMLElement | null;
      const touchedChatId = touchedHeadBtn?.getAttribute("data-chat-id") ?? null;
      if (
        event.pointerType === "touch" &&
        touchedChatId &&
        this.heads.get(touchedChatId)?.status === "completed"
      ) {
        holdDismissTimer = setTimeout(() => {
          holdDismissTimer = null;
          if (moved || finished || this.destroyed) return;
          if (this.heads.get(touchedChatId)?.status !== "completed") return;
          this.suppressNextClick = true;
          this.clearSuppressClickTimer();
          this.suppressClickTimer = setTimeout(() => {
            this.suppressClickTimer = null;
            this.suppressNextClick = false;
          }, SUPPRESS_CLICK_FALLBACK_MS);
          finishDrag();
          this.dismissCompletedHead(touchedChatId);
        }, HOLD_DISMISS_MS);
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        finishDrag();
      };

      const onLostPointerCapture = (lostEvent: PointerEvent) => {
        if (lostEvent.pointerId !== pointerId) return;
        // Transferring implicit touch capture from a child button to root fires a
        // bubbling lostpointercapture on the child; only end drag if root lost capture.
        if (lostEvent.target !== root) return;
        finishDrag();
      };

      const onWindowBlur = () => {
        finishDrag();
      };

      const onTouchMove = (touchEvent: TouchEvent) => {
        if (moved && touchEvent.cancelable) {
          touchEvent.preventDefault();
        }
      };

      const win =
        typeof window !== "undefined" ? window : document.defaultView;

      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerEnd, true);
      document.addEventListener("pointercancel", onPointerEnd, true);
      if (event.pointerType === "touch") {
        document.addEventListener("touchmove", onTouchMove, {
          capture: true,
          passive: false,
        });
      }
      root.addEventListener("lostpointercapture", onLostPointerCapture);
      win?.addEventListener("blur", onWindowBlur);

      this.dragCleanup = () => {
        clearHoldDismissTimer();
        cancelDragRaf();
        document.removeEventListener("pointermove", onPointerMove, true);
        document.removeEventListener("pointerup", onPointerEnd, true);
        document.removeEventListener("pointercancel", onPointerEnd, true);
        if (event.pointerType === "touch") {
          document.removeEventListener("touchmove", onTouchMove, true);
        }
        root.removeEventListener("lostpointercapture", onLostPointerCapture);
        win?.removeEventListener("blur", onWindowBlur);
      };
    });
  }

  private clearDragSession(): void {
    this.isDragging = false;
    this.rootEl?.classList.remove("is-dragging");
    if (this.dragCleanup) {
      const cleanup = this.dragCleanup;
      this.dragCleanup = null;
      cleanup();
    }
  }

  private clearSuppressClickTimer(): void {
    if (this.suppressClickTimer !== null) {
      clearTimeout(this.suppressClickTimer);
      this.suppressClickTimer = null;
    }
  }

  private ensureResizeListener(): void {
    if (this.resizeCleanup) return;
    const win =
      typeof window !== "undefined"
        ? window
        : typeof document !== "undefined"
          ? document.defaultView
          : null;
    if (!win) return;
    let resizeRafId: number | null = null;
    const flushResize = () => {
      if (this.destroyed || !this.rootEl) return;
      const count = this.rootEl.children.length || this.heads.size || 1;
      this.applyRootPosition(this.rootEl, count, {
        avoidNative: !this.isDragging,
      });
    };
    const onResize = () => {
      if (this.destroyed || !this.rootEl) return;
      if (typeof requestAnimationFrame === "function") {
        if (resizeRafId !== null) return;
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          flushResize();
        });
      } else {
        flushResize();
      }
    };
    win.addEventListener("resize", onResize);
    this.resizeCleanup = () => {
      if (resizeRafId !== null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(resizeRafId);
        }
        resizeRafId = null;
      }
      win.removeEventListener("resize", onResize);
    };
  }

  private clearResizeListener(): void {
    if (this.resizeCleanup) {
      const cleanup = this.resizeCleanup;
      this.resizeCleanup = null;
      cleanup();
    }
  }

  private applyRootPosition(
    root: HTMLDivElement,
    headCount = this.heads.size || 1,
    options: {
      avoidNative?: boolean;
      nativeBox?: RectBox | null;
      viewport?: { vw: number; vh: number };
    } = {},
  ): void {
    const viewport = options.viewport ?? this.getViewportSize();
    const { vw, vh } = viewport;
    const { width, height } = this.getStackDimensions(headCount, vh);
    const clamped = this.clampCenterPos(this.pos, headCount, viewport);

    let cx = (clamped.xPct / 100) * vw;
    let cy = (clamped.yPct / 100) * vh;

    if (options.avoidNative !== false) {
      const nativeBox =
        options.nativeBox !== undefined
          ? options.nativeBox
          : (() => {
              const nativeContainer = this.findNativeChatHeadsContainer();
              return nativeContainer
                ? this.resolveNativeBounds(nativeContainer, vw, vh)
                : null;
            })();
      if (nativeBox) {
        const minX = VIEWPORT_PAD_PX + width / 2;
        const maxX = vw - VIEWPORT_PAD_PX - width / 2;
        const minY = VIEWPORT_PAD_PX + height / 2;
        const maxY = vh - VIEWPORT_PAD_PX - height / 2;

        const ggBox: RectBox = {
          left: cx - width / 2,
          top: cy - height / 2,
          right: cx + width / 2,
          bottom: cy + height / 2,
        };

        if (boxesOverlap(ggBox, nativeBox, NATIVE_COLLISION_GAP_PX)) {
          const belowCy = nativeBox.bottom + NATIVE_COLLISION_GAP_PX + height / 2;
          const aboveCy = nativeBox.top - NATIVE_COLLISION_GAP_PX - height / 2;
          const leftCx = nativeBox.left - NATIVE_COLLISION_GAP_PX - width / 2;
          const rightCx = nativeBox.right + NATIVE_COLLISION_GAP_PX + width / 2;

          if (belowCy >= minY && belowCy <= maxY) {
            cy = belowCy;
          } else if (aboveCy >= minY && aboveCy <= maxY) {
            cy = aboveCy;
          } else if (leftCx >= minX && leftCx <= maxX) {
            cx = leftCx;
          } else if (rightCx >= minX && rightCx <= maxX) {
            cx = rightCx;
          }
        }
      }
    }

    const finalXPct = clampPct((cx / vw) * 100, 0, 100);
    const finalYPct = clampPct((cy / vh) * 100, 0, 100);
    root.style.left = `${finalXPct}%`;
    root.style.top = `${finalYPct}%`;
  }

  private getStorage(): Storage | null {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    } catch {
      return null;
    }
  }

  private loadPosition(): StoredChatHeadPos {
    try {
      const raw = this.getStorage()?.getItem(STORAGE_POS_KEY);
      if (!raw) return { ...DEFAULT_POS };
      const parsed: unknown = JSON.parse(raw);
      if (
        isRecord(parsed) &&
        typeof parsed.xPct === "number" &&
        Number.isFinite(parsed.xPct) &&
        typeof parsed.yPct === "number" &&
        Number.isFinite(parsed.yPct)
      ) {
        return {
          xPct: clampPct(parsed.xPct),
          yPct: clampPct(parsed.yPct),
        };
      }
    } catch {
      // Ignore storage access errors
    }
    return { ...DEFAULT_POS };
  }

  private savePosition(pos: StoredChatHeadPos): void {
    try {
      this.getStorage()?.setItem(STORAGE_POS_KEY, JSON.stringify(pos));
    } catch {
      // Ignore storage write errors
    }
  }

  private navigateToChat(chatId: string, onSuccess?: () => void): void {
    try {
      const surfaces = (
        this.ctx as unknown as {
          host?: {
            surfaces?: {
              invoke?: (
                ref: { kind: string; id: string },
                params: { chatId: string },
              ) => unknown;
            };
          };
        }
      ).host?.surfaces;
      if (surfaces && typeof surfaces.invoke === "function") {
        const result = surfaces.invoke(
          { kind: "route", id: "/chat/:chatId" },
          { chatId },
        );
        if (isThenable(result)) {
          Promise.resolve(result).then(
            () => {
              onSuccess?.();
            },
            () => {
              if (this.fallbackHistoryNavigate(chatId)) {
                onSuccess?.();
              }
            },
          );
          return;
        }
        onSuccess?.();
        return;
      }
    } catch {
      // Fall through to history fallback
    }

    if (this.fallbackHistoryNavigate(chatId)) {
      onSuccess?.();
    }
  }

  private fallbackHistoryNavigate(chatId: string): boolean {
    try {
      const win =
        typeof window !== "undefined"
          ? window
          : typeof document !== "undefined"
            ? document.defaultView
            : null;
      if (win?.history && typeof win.history.pushState === "function") {
        win.history.pushState(null, "", `/chat/${encodeURIComponent(chatId)}`);
        const PopStateCtor =
          win.PopStateEvent ??
          (typeof PopStateEvent !== "undefined" ? PopStateEvent : Event);
        win.dispatchEvent(new PopStateCtor("popstate"));
        return true;
      }
    } catch {
      // Ignore fallback navigation errors
    }
    return false;
  }

  private safeGetActiveChat(): { chatId: string | null; characterId?: string | null } | null {
    try {
      return (
        (this.ctx.getActiveChat?.() as {
          chatId: string | null;
          characterId?: string | null;
        }) ?? null
      );
    } catch {
      return null;
    }
  }

  private safeGetActiveChatId(): string | null {
    return this.safeGetActiveChat()?.chatId ?? null;
  }
}
