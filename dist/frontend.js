// src/frontend/chat-head.ts
var STORAGE_POS_KEY = "gg:chatHeadsPos";
var NATIVE_STORAGE_POS_KEY = "lumiverse:chatHeadsPos";
var DEFAULT_POS = { xPct: 94, yPct: 22 };
var DRAG_THRESHOLD_PX = 6;
var HEAD_SIZE_PX = 48;
var HEAD_GAP_PX = 10;
var ROOT_PAD_PX = 6;
var VIEWPORT_PAD_PX = 12;
var NATIVE_COLLISION_GAP_PX = 8;
var SUPPRESS_CLICK_FALLBACK_MS = 350;
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function clamp(value, min, max) {
  if (!Number.isFinite(value))
    return min;
  if (min > max)
    return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}
function clampPct(value, min = 2, max = 98) {
  return clamp(value, min, max);
}
function isThenable(value) {
  return Boolean(value) && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
function extractChatIdFromEventPayload(rawPayload) {
  if (!isRecord(rawPayload))
    return null;
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
function computeInitials(label) {
  const cleaned = label.trim();
  if (!cleaned)
    return "GG";
  const words = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}
function buildDefaultAvatarUrl(characterId) {
  return `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?thumb=1`;
}
function sanitizeAvatarUrl(raw) {
  if (typeof raw !== "string")
    return;
  const trimmed = raw.trim();
  if (!trimmed)
    return;
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
  } catch {}
  return;
}
function boxesOverlap(a, b, gap = 0) {
  return !(a.right + gap <= b.left || a.left >= b.right + gap || a.bottom + gap <= b.top || a.top >= b.bottom + gap);
}

class ChatHeadController {
  ctx;
  heads = new Map;
  characterCache = new Map;
  pendingCharacterFetches = new Set;
  disposers = [];
  rootEl = null;
  resizeCleanup = null;
  dragCleanup = null;
  suppressClickTimer = null;
  suppressNextClick = false;
  pos;
  destroyed = false;
  constructor(ctx) {
    this.ctx = ctx;
    this.pos = this.loadPosition();
    if (typeof this.ctx.events?.on === "function") {
      try {
        this.disposers.push(this.ctx.events.on("CHAT_DELETED", (payload) => {
          this.onChatDeleted(extractChatIdFromEventPayload(payload));
        }));
      } catch {}
    }
  }
  syncRuns(runs, activeChatId) {
    if (this.destroyed)
      return;
    const currentActiveChatId = activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();
    if (currentActiveChatId) {
      const activeHead = this.heads.get(currentActiveChatId);
      if (activeHead?.status === "completed") {
        this.heads.delete(currentActiveChatId);
      }
    }
    const incomingByChat = new Map;
    for (const rawRun of runs) {
      const run = rawRun;
      if (run && typeof run.chatId === "string" && run.chatId.length > 0) {
        incomingByChat.set(run.chatId, run);
      }
    }
    for (const [chatId, existing] of [...this.heads.entries()]) {
      if (existing.status === "completed")
        continue;
      if (!incomingByChat.has(chatId)) {
        this.heads.delete(chatId);
      }
    }
    for (const [, run] of incomingByChat.entries()) {
      this.upsertFromActiveRun(run, currentActiveChatId);
    }
    this.render(currentActiveChatId);
  }
  handleStatusEvent(event, activeChatId) {
    if (this.destroyed)
      return;
    const currentActiveChatId = activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();
    const eventChatId = typeof event.chatId === "string" && event.chatId.length > 0 ? event.chatId : undefined;
    const run = event.run ?? null;
    const hasTerminalSignal = Boolean(event.done) || Boolean(event.aborted) || Boolean(event.error);
    if (eventChatId && (hasTerminalSignal || !run || run.chatId !== eventChatId)) {
      this.finalizeChatRun(eventChatId, {
        aborted: Boolean(event.aborted),
        hasError: Boolean(event.error)
      }, currentActiveChatId);
    }
    if (run && typeof run.chatId === "string" && run.chatId.length > 0) {
      if (!hasTerminalSignal || eventChatId !== undefined && run.chatId !== eventChatId) {
        this.upsertFromActiveRun(run, currentActiveChatId);
      } else if (!eventChatId && hasTerminalSignal) {
        this.finalizeChatRun(run.chatId, {
          aborted: Boolean(event.aborted),
          hasError: Boolean(event.error)
        }, currentActiveChatId);
      }
    } else if (!eventChatId) {
      for (const [chatId, entry] of [...this.heads.entries()]) {
        if (entry.status === "running" || entry.status === "streaming") {
          this.finalizeChatRun(chatId, {
            aborted: Boolean(event.aborted),
            hasError: Boolean(event.error)
          }, currentActiveChatId);
        }
      }
    }
    this.render(currentActiveChatId);
  }
  onChatChanged(activeChatId) {
    if (this.destroyed)
      return;
    const currentActiveChatId = activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();
    if (currentActiveChatId) {
      const existing = this.heads.get(currentActiveChatId);
      if (existing?.status === "completed") {
        this.heads.delete(currentActiveChatId);
      }
    }
    this.render(currentActiveChatId);
  }
  onChatDeleted(chatId) {
    if (this.destroyed || !chatId)
      return;
    if (this.heads.delete(chatId)) {
      this.render();
    }
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.clearDragSession();
    this.clearResizeListener();
    this.clearSuppressClickTimer();
    this.suppressNextClick = false;
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {}
    }
    this.disposers.length = 0;
    this.heads.clear();
    this.pendingCharacterFetches.clear();
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
  }
  upsertFromActiveRun(run, currentActiveChatId) {
    const existing = this.heads.get(run.chatId);
    const activeChatMeta = currentActiveChatId === run.chatId ? this.safeGetActiveChat() : null;
    const characterId = (typeof run.characterId === "string" && run.characterId.length > 0 ? run.characterId : undefined) ?? existing?.characterId ?? (typeof activeChatMeta?.characterId === "string" && activeChatMeta.characterId.length > 0 ? activeChatMeta.characterId : undefined);
    const cached = characterId ? this.characterCache.get(characterId) : undefined;
    const characterName = (typeof run.characterName === "string" && run.characterName.trim().length > 0 ? run.characterName.trim() : undefined) ?? existing?.characterName ?? cached?.name;
    const avatarUrl = sanitizeAvatarUrl(run.avatarUrl) ?? sanitizeAvatarUrl(existing?.avatarUrl) ?? sanitizeAvatarUrl(cached?.avatarUrl) ?? (characterId ? buildDefaultAvatarUrl(characterId) : undefined);
    const status = run.hasContentOutput ? "streaming" : "running";
    const nextEntry = {
      chatId: run.chatId,
      runId: run.runId,
      status,
      startedAt: run.startedAt,
      ...characterId ? { characterId } : {},
      ...characterName ? { characterName } : {},
      ...avatarUrl ? { avatarUrl } : {},
      ...existing?.avatarFailed && existing.avatarUrl === avatarUrl ? { avatarFailed: true } : {}
    };
    this.heads.set(run.chatId, nextEntry);
    if (characterId && !characterName && !this.characterCache.has(characterId)) {
      this.resolveCharacterMeta(run.chatId, characterId);
    }
  }
  finalizeChatRun(chatId, outcome, currentActiveChatId) {
    const existing = this.heads.get(chatId);
    if (outcome.aborted || outcome.hasError || currentActiveChatId === chatId) {
      this.heads.delete(chatId);
      return;
    }
    if (existing) {
      this.heads.set(chatId, {
        ...existing,
        status: "completed"
      });
    } else {
      this.heads.set(chatId, {
        chatId,
        runId: `gg-completed-${chatId}`,
        status: "completed",
        startedAt: Date.now()
      });
    }
  }
  async resolveCharacterMeta(chatId, characterId) {
    if (this.destroyed || !characterId)
      return;
    if (this.pendingCharacterFetches.has(characterId) || this.characterCache.has(characterId)) {
      return;
    }
    const charactersApi = this.ctx.characters;
    if (typeof charactersApi?.get !== "function")
      return;
    this.pendingCharacterFetches.add(characterId);
    try {
      const raw = await Promise.resolve(charactersApi.get(characterId));
      if (this.destroyed)
        return;
      if (!isRecord(raw)) {
        this.characterCache.set(characterId, {});
        return;
      }
      const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : undefined;
      const defaultAvatar = buildDefaultAvatarUrl(characterId);
      const customAvatar = sanitizeAvatarUrl(raw.avatarUrl) ?? sanitizeAvatarUrl(raw.avatar_url);
      const safeAvatar = customAvatar ?? defaultAvatar;
      this.characterCache.set(characterId, {
        ...name ? { name } : {},
        avatarUrl: safeAvatar
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
        this.characterCache.set(characterId, {});
      }
    } finally {
      this.pendingCharacterFetches.delete(characterId);
    }
  }
  render(activeChatId) {
    if (this.destroyed)
      return;
    if (typeof document === "undefined" || !document.body)
      return;
    const currentActiveChatId = activeChatId !== undefined ? activeChatId : this.safeGetActiveChatId();
    const visibleEntries = [];
    for (const entry of this.heads.values()) {
      if (entry.chatId === currentActiveChatId)
        continue;
      if (this.hasNativeChatHead(entry.chatId))
        continue;
      visibleEntries.push(entry);
    }
    if (visibleEntries.length === 0) {
      this.clearDragSession();
      this.clearResizeListener();
      if (this.rootEl) {
        this.rootEl.remove();
        this.rootEl = null;
      }
      return;
    }
    if (!this.rootEl) {
      this.rootEl = document.createElement("div");
      this.rootEl.className = "gg-chat-heads-root";
      this.rootEl.setAttribute("data-gg-chat-heads-root", "true");
      this.attachDragHandlers(this.rootEl);
      this.ensureResizeListener();
    }
    const items = visibleEntries.map((entry) => this.buildHeadItem(entry));
    this.rootEl.replaceChildren(...items);
    this.applyRootPosition(this.rootEl, visibleEntries.length);
    if (!this.rootEl.isConnected) {
      document.body.append(this.rootEl);
    }
  }
  buildHeadItem(entry) {
    const item = document.createElement("div");
    item.className = "gg-chat-head-item";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gg-chat-head";
    if (entry.status === "running" || entry.status === "streaming") {
      btn.classList.add("is-running");
    }
    if (entry.status === "streaming") {
      btn.classList.add("is-streaming");
    }
    if (entry.status === "completed") {
      btn.classList.add("is-completed");
    }
    btn.setAttribute("data-gg-chat-head", "true");
    btn.setAttribute("data-chat-id", entry.chatId);
    btn.setAttribute("data-status", entry.status);
    const displayName = entry.characterName || entry.chatId;
    const statusDescription = entry.status === "completed" ? "Generation completed — click to open chat" : entry.status === "streaming" ? "Streaming response in background — click to open chat" : "Generating response in background — click to open chat";
    const fullLabel = `${displayName}: ${statusDescription}`;
    btn.setAttribute("aria-label", fullLabel);
    btn.title = fullLabel;
    const effectiveAvatarUrl = sanitizeAvatarUrl(entry.avatarUrl) ?? (entry.characterId ? buildDefaultAvatarUrl(entry.characterId) : undefined);
    if (effectiveAvatarUrl && !entry.avatarFailed) {
      const img = document.createElement("img");
      img.className = "gg-chat-head-avatar";
      img.src = effectiveAvatarUrl;
      img.alt = displayName;
      img.draggable = false;
      img.addEventListener("error", () => {
        if (this.destroyed)
          return;
        const current = this.heads.get(entry.chatId);
        if (current) {
          current.avatarFailed = true;
        }
        if (img.isConnected) {
          const initials = document.createElement("span");
          initials.className = "gg-chat-head-initials";
          initials.textContent = computeInitials(displayName);
          img.replaceWith(initials);
        }
      });
      btn.append(img);
    } else {
      const initials = document.createElement("span");
      initials.className = "gg-chat-head-initials";
      initials.textContent = computeInitials(displayName);
      btn.append(initials);
    }
    const badge = document.createElement("span");
    badge.className = "gg-chat-head-badge";
    badge.setAttribute("aria-hidden", "true");
    btn.append(badge);
    if (entry.status === "completed") {
      const pip = document.createElement("span");
      pip.className = "gg-chat-head-pip";
      pip.setAttribute("aria-hidden", "true");
      btn.append(pip);
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.dismissCompletedHead(entry.chatId);
      });
    }
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        this.clearSuppressClickTimer();
        return;
      }
      this.navigateToChat(entry.chatId, () => {
        if (this.destroyed)
          return;
        const latest = this.heads.get(entry.chatId);
        if (latest?.status === "completed") {
          this.heads.delete(entry.chatId);
          this.render();
        }
      });
    });
    item.append(btn);
    if (entry.status === "completed") {
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
    }
    return item;
  }
  dismissCompletedHead(chatId) {
    if (this.destroyed)
      return;
    const entry = this.heads.get(chatId);
    if (entry?.status === "completed") {
      this.heads.delete(chatId);
      this.render();
    }
  }
  isNativeChatHeadElement(el) {
    if (el.hasAttribute("data-gg-chat-head"))
      return false;
    if (el.closest("[data-gg-chat-heads-root]"))
      return false;
    if (el.hasAttribute("data-head-idx"))
      return true;
    if (el.hasAttribute("data-chat-head"))
      return true;
    const parent = el.parentElement;
    if (parent && parent.parentElement === document.body) {
      const cls = typeof parent.className === "string" ? parent.className : "";
      if (parent.querySelector("[data-head-idx]") !== null || /ChatHeads/i.test(cls)) {
        return true;
      }
    }
    return false;
  }
  hasNativeChatHead(chatId) {
    if (typeof document === "undefined" || !document.body)
      return false;
    const candidates = document.body.querySelectorAll("[data-chat-id]");
    for (const el of candidates) {
      if (el.getAttribute("data-chat-id") === chatId && this.isNativeChatHeadElement(el)) {
        return true;
      }
    }
    return false;
  }
  findNativeChatHeadsContainer() {
    if (typeof document === "undefined" || !document.body)
      return null;
    const firstHead = document.body.querySelector("[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head])");
    if (!firstHead || firstHead.closest("[data-gg-chat-heads-root]")) {
      return null;
    }
    const parent = firstHead.parentElement;
    if (!parent || parent === document.body)
      return firstHead;
    return parent;
  }
  getViewportSize() {
    const win = typeof window !== "undefined" ? window : typeof document !== "undefined" ? document.defaultView : null;
    const vw = win && typeof win.innerWidth === "number" && win.innerWidth > 0 ? win.innerWidth : (typeof document !== "undefined" ? document.documentElement?.clientWidth : 0) || 1024;
    const vh = win && typeof win.innerHeight === "number" && win.innerHeight > 0 ? win.innerHeight : (typeof document !== "undefined" ? document.documentElement?.clientHeight : 0) || 768;
    return { vw, vh };
  }
  getStackDimensions(headCount, vh) {
    const count = Math.max(1, headCount);
    const rawWidth = HEAD_SIZE_PX + ROOT_PAD_PX * 2;
    const rawHeight = count * HEAD_SIZE_PX + Math.max(0, count - 1) * HEAD_GAP_PX + ROOT_PAD_PX * 2;
    const maxHeight = Math.max(HEAD_SIZE_PX + ROOT_PAD_PX * 2, vh - VIEWPORT_PAD_PX * 2);
    return {
      width: rawWidth,
      height: Math.min(rawHeight, maxHeight)
    };
  }
  clampCenterPos(pos, headCount) {
    const { vw, vh } = this.getViewportSize();
    const { width, height } = this.getStackDimensions(headCount, vh);
    const minX = VIEWPORT_PAD_PX + width / 2;
    const maxX = vw - VIEWPORT_PAD_PX - width / 2;
    const minY = VIEWPORT_PAD_PX + height / 2;
    const maxY = vh - VIEWPORT_PAD_PX - height / 2;
    const cx = clamp(pos.xPct / 100 * vw, minX, maxX);
    const cy = clamp(pos.yPct / 100 * vh, minY, maxY);
    return {
      xPct: cx / vw * 100,
      yPct: cy / vh * 100
    };
  }
  resolveNativeBounds(container, vw, vh) {
    try {
      const rect = container.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      }
    } catch {}
    const nativeHeads = container.querySelectorAll("[data-head-idx], [data-chat-head]");
    const nativeCount = Math.max(1, nativeHeads.length);
    const isRow = container.style?.flexDirection === "row";
    const estWidth = isRow ? nativeCount * HEAD_SIZE_PX + Math.max(0, nativeCount - 1) * 8 + 12 : HEAD_SIZE_PX + 12;
    const estHeight = isRow ? HEAD_SIZE_PX + 12 : nativeCount * HEAD_SIZE_PX + Math.max(0, nativeCount - 1) * 8 + 12;
    const styleLeft = parseFloat(container.style?.left ?? "");
    const styleTop = parseFloat(container.style?.top ?? "");
    if (Number.isFinite(styleLeft) && Number.isFinite(styleTop) && styleLeft >= 0 && styleTop >= 0) {
      return {
        left: styleLeft,
        top: styleTop,
        right: styleLeft + estWidth,
        bottom: styleTop + estHeight
      };
    }
    const stored = this.readNativeStoredPosition();
    if (stored) {
      let left;
      let top;
      if (stored.xPct < 0 || stored.yPct < 0) {
        left = vw - estWidth - VIEWPORT_PAD_PX;
        top = Math.round((vh - estHeight) / 2);
      } else if (stored.xPct <= 1 && stored.yPct <= 1) {
        left = clamp(stored.xPct * vw, VIEWPORT_PAD_PX, vw - estWidth - VIEWPORT_PAD_PX);
        top = clamp(stored.yPct * vh, VIEWPORT_PAD_PX, vh - estHeight - VIEWPORT_PAD_PX);
      } else {
        left = clamp(stored.xPct / 100 * vw, VIEWPORT_PAD_PX, vw - estWidth - VIEWPORT_PAD_PX);
        top = clamp(stored.yPct / 100 * vh, VIEWPORT_PAD_PX, vh - estHeight - VIEWPORT_PAD_PX);
      }
      return {
        left,
        top,
        right: left + estWidth,
        bottom: top + estHeight
      };
    }
    const defaultLeft = vw - estWidth - VIEWPORT_PAD_PX;
    const defaultTop = Math.round((vh - estHeight) / 2);
    return {
      left: defaultLeft,
      top: defaultTop,
      right: defaultLeft + estWidth,
      bottom: defaultTop + estHeight
    };
  }
  readNativeStoredPosition() {
    try {
      const storage = this.getStorage();
      const raw = storage?.getItem(NATIVE_STORAGE_POS_KEY);
      if (!raw)
        return null;
      const parsed = JSON.parse(raw);
      if (isRecord(parsed) && typeof parsed.xPct === "number" && Number.isFinite(parsed.xPct) && typeof parsed.yPct === "number" && Number.isFinite(parsed.yPct)) {
        return { xPct: parsed.xPct, yPct: parsed.yPct };
      }
    } catch {}
    return null;
  }
  attachDragHandlers(root) {
    root.addEventListener("click", () => {
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        this.clearSuppressClickTimer();
      }
    });
    root.addEventListener("pointerdown", (event) => {
      if (this.destroyed)
        return;
      if (event.pointerType === "mouse" && event.button !== 0)
        return;
      if (typeof document === "undefined")
        return;
      const target = event.target;
      if (target?.closest?.("[data-gg-chat-head-dismiss]")) {
        return;
      }
      this.clearSuppressClickTimer();
      this.suppressNextClick = false;
      this.clearDragSession();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const startPos = { ...this.pos };
      let moved = false;
      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId)
          return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          moved = true;
          this.suppressNextClick = true;
          try {
            root.setPointerCapture?.(pointerId);
          } catch {}
        }
        if (!moved)
          return;
        const { vw, vh } = this.getViewportSize();
        const visibleCount = this.rootEl?.children.length || this.heads.size || 1;
        this.pos = this.clampCenterPos({
          xPct: startPos.xPct + dx / vw * 100,
          yPct: startPos.yPct + dy / vh * 100
        }, visibleCount);
        if (this.rootEl) {
          this.applyRootPosition(this.rootEl, visibleCount, { avoidNative: false });
        }
      };
      const finishDrag = () => {
        try {
          if (root.hasPointerCapture?.(pointerId)) {
            root.releasePointerCapture?.(pointerId);
          }
        } catch {}
        this.clearDragSession();
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
      const onPointerEnd = (endEvent) => {
        if (endEvent.pointerId !== pointerId)
          return;
        finishDrag();
      };
      const onWindowBlur = () => {
        finishDrag();
      };
      const win = typeof window !== "undefined" ? window : document.defaultView;
      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerEnd, true);
      document.addEventListener("pointercancel", onPointerEnd, true);
      root.addEventListener("lostpointercapture", onPointerEnd);
      win?.addEventListener("blur", onWindowBlur);
      this.dragCleanup = () => {
        document.removeEventListener("pointermove", onPointerMove, true);
        document.removeEventListener("pointerup", onPointerEnd, true);
        document.removeEventListener("pointercancel", onPointerEnd, true);
        root.removeEventListener("lostpointercapture", onPointerEnd);
        win?.removeEventListener("blur", onWindowBlur);
      };
    });
  }
  clearDragSession() {
    if (this.dragCleanup) {
      const cleanup = this.dragCleanup;
      this.dragCleanup = null;
      cleanup();
    }
  }
  clearSuppressClickTimer() {
    if (this.suppressClickTimer !== null) {
      clearTimeout(this.suppressClickTimer);
      this.suppressClickTimer = null;
    }
  }
  ensureResizeListener() {
    if (this.resizeCleanup)
      return;
    const win = typeof window !== "undefined" ? window : typeof document !== "undefined" ? document.defaultView : null;
    if (!win)
      return;
    const onResize = () => {
      if (this.destroyed || !this.rootEl)
        return;
      const count = this.rootEl.children.length || this.heads.size || 1;
      this.applyRootPosition(this.rootEl, count);
    };
    win.addEventListener("resize", onResize);
    this.resizeCleanup = () => {
      win.removeEventListener("resize", onResize);
    };
  }
  clearResizeListener() {
    if (this.resizeCleanup) {
      const cleanup = this.resizeCleanup;
      this.resizeCleanup = null;
      cleanup();
    }
  }
  applyRootPosition(root, headCount = this.heads.size || 1, options = {}) {
    const { vw, vh } = this.getViewportSize();
    const { width, height } = this.getStackDimensions(headCount, vh);
    const clamped = this.clampCenterPos(this.pos, headCount);
    let cx = clamped.xPct / 100 * vw;
    let cy = clamped.yPct / 100 * vh;
    if (options.avoidNative !== false) {
      const nativeContainer = this.findNativeChatHeadsContainer();
      const nativeBox = nativeContainer ? this.resolveNativeBounds(nativeContainer, vw, vh) : null;
      if (nativeBox) {
        const minX = VIEWPORT_PAD_PX + width / 2;
        const maxX = vw - VIEWPORT_PAD_PX - width / 2;
        const minY = VIEWPORT_PAD_PX + height / 2;
        const maxY = vh - VIEWPORT_PAD_PX - height / 2;
        const ggBox = {
          left: cx - width / 2,
          top: cy - height / 2,
          right: cx + width / 2,
          bottom: cy + height / 2
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
    const finalXPct = clampPct(cx / vw * 100, 0, 100);
    const finalYPct = clampPct(cy / vh * 100, 0, 100);
    root.style.left = `${finalXPct}%`;
    root.style.top = `${finalYPct}%`;
  }
  getStorage() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      return null;
    }
  }
  loadPosition() {
    try {
      const raw = this.getStorage()?.getItem(STORAGE_POS_KEY);
      if (!raw)
        return { ...DEFAULT_POS };
      const parsed = JSON.parse(raw);
      if (isRecord(parsed) && typeof parsed.xPct === "number" && Number.isFinite(parsed.xPct) && typeof parsed.yPct === "number" && Number.isFinite(parsed.yPct)) {
        return {
          xPct: clampPct(parsed.xPct),
          yPct: clampPct(parsed.yPct)
        };
      }
    } catch {}
    return { ...DEFAULT_POS };
  }
  savePosition(pos) {
    try {
      this.getStorage()?.setItem(STORAGE_POS_KEY, JSON.stringify(pos));
    } catch {}
  }
  navigateToChat(chatId, onSuccess) {
    try {
      const surfaces = this.ctx.host?.surfaces;
      if (surfaces && typeof surfaces.invoke === "function") {
        const result = surfaces.invoke({ kind: "route", id: "/chat/:chatId" }, { chatId });
        if (isThenable(result)) {
          Promise.resolve(result).then(() => {
            onSuccess?.();
          }, () => {
            if (this.fallbackHistoryNavigate(chatId)) {
              onSuccess?.();
            }
          });
          return;
        }
        onSuccess?.();
        return;
      }
    } catch {}
    if (this.fallbackHistoryNavigate(chatId)) {
      onSuccess?.();
    }
  }
  fallbackHistoryNavigate(chatId) {
    try {
      const win = typeof window !== "undefined" ? window : typeof document !== "undefined" ? document.defaultView : null;
      if (win?.history && typeof win.history.pushState === "function") {
        win.history.pushState(null, "", `/chat/${encodeURIComponent(chatId)}`);
        const PopStateCtor = win.PopStateEvent ?? (typeof PopStateEvent !== "undefined" ? PopStateEvent : Event);
        win.dispatchEvent(new PopStateCtor("popstate"));
        return true;
      }
    } catch {}
    return false;
  }
  safeGetActiveChat() {
    try {
      return this.ctx.getActiveChat?.() ?? null;
    } catch {
      return null;
    }
  }
  safeGetActiveChatId() {
    return this.safeGetActiveChat()?.chatId ?? null;
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
var DEFAULT_GUIDANCE_POSITION = "before_post_history";
var DEFAULT_GUIDANCE_DEPTH = 0;
var DEFAULT_APPLY_REGEX = true;
var GUIDANCE_POSITION_OPTIONS = [
  {
    value: "before_post_history",
    label: "Before Post-History (after chat history)",
    shortLabel: "Before Post-History",
    sublabel: "Places guidance right after chat history and before post-history preset blocks."
  },
  {
    value: "in_history",
    label: "In History (at depth)",
    shortLabel: "In History",
    sublabel: "Splices guidance inside chat history N messages back from the end."
  },
  {
    value: "pre_history",
    label: "Pre-History (before chat history)",
    shortLabel: "Pre-History",
    sublabel: "Places guidance after pre-history system prompts and before the first chat turn."
  },
  {
    value: "post_history",
    label: "Post-History (end of prompt)",
    shortLabel: "Post-History",
    sublabel: "Appends guidance at the very end of the assembled prompt (before any trailing prefill)."
  }
];
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
var TOOLBAR_PLACEMENT_OPTIONS = [
  {
    value: "after_native",
    label: "Inline (after native buttons)",
    shortLabel: "Inline",
    sublabel: "Sits directly next to Home, Regenerate, Continue, etc."
  },
  {
    value: "before_native",
    label: "Left side (before native buttons)",
    shortLabel: "Left",
    sublabel: "Placed at the start of the composer top action bar"
  },
  {
    value: "right",
    label: "Right side (top bar)",
    shortLabel: "Right",
    sublabel: "Aligned to the right side of the composer top action bar"
  },
  {
    value: "below_bar",
    label: "Separate row (below native buttons)",
    shortLabel: "New row",
    sublabel: "Shown on the dedicated extension toolbar row underneath"
  }
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
var ACTION_METADATA = {
  guided_response: {
    id: "guided_response",
    label: "Guided Response",
    shortLabel: "Response",
    description: "Steer the next AI reply using your composer text as temporary guidance without adding a user message.",
    tooltip: "Guided Response — steer next AI reply without sending a user message"
  },
  guided_continue: {
    id: "guided_continue",
    label: "Guided Continue",
    shortLabel: "Continue",
    description: "Continue the last AI message using optional guidance text and this option's profile & preset.",
    tooltip: "Guided Continue — continue last AI message (guided if input present)"
  },
  guided_regenerate: {
    id: "guided_regenerate",
    label: "Guided Regenerate",
    shortLabel: "Regenerate",
    description: "Replace the last AI message with a fresh regenerated reply using optional guidance text and this option's profile & preset.",
    tooltip: "Guided Regenerate — regenerate last AI reply (guided if input present)"
  },
  guided_swipe: {
    id: "guided_swipe",
    label: "Guided Swipe",
    shortLabel: "Swipe",
    description: "Generate a new swipe on the last AI message steered by your guidance text.",
    tooltip: "Guided Swipe — create a steered new swipe on the last AI message"
  },
  guided_impersonate: {
    id: "guided_impersonate",
    label: "Impersonation",
    shortLabel: "Impersonate",
    description: "Generate a user reply into the composer input box using your configured preset and optional outline.",
    tooltip: "Impersonate — draft user message into input box"
  }
};

// src/frontend/icons.ts
var DRAWER_TAB_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
var STOP_ICON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`;
var TOOLBAR_ICONS = {
  guided_response: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>`,
  guided_continue: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,
  guided_regenerate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
  guided_swipe: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  guided_impersonate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  input_recovery: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`
};
var CONTINUE_MENU_ICONS = {
  remove_last_continue: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>`,
  regenerate_last_continue: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`
};
var RECOVERY_MENU_ICONS = {
  history: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
  clear_history: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`
};

// src/frontend/recovery-store.ts
function formatRecoverySnippet(text, maxLength = 68) {
  const safeMax = Number.isFinite(maxLength) ? Math.max(4, Math.floor(maxLength)) : 60;
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= safeMax)
    return singleLine;
  return `${singleLine.slice(0, safeMax - 1)}…`;
}
function pickRecoveryEntry(entries, preferredId) {
  if (entries.length === 0)
    return null;
  if (preferredId) {
    return entries.find((item) => item.id === preferredId) ?? entries[0] ?? null;
  }
  return entries[0] ?? null;
}

// src/frontend/input-toolbar.ts
var HOST_CLASSES = [
  "gg-actions-host",
  "gg-actions-host--row",
  "is-before-native",
  "is-right"
];
var HOLD_DURATION_MS = 450;
var HOLD_MOVE_TOLERANCE_PX = 10;
var MENU_DISMISS_GRACE_MS = 150;
var PRE_RELEASE_SUPPRESS_FALLBACK_MS = 3000;
var POST_RELEASE_SUPPRESS_MS = 0;
var POST_RELEASE_MAX_WINDOW_MS = 250;

class InputToolbarController {
  ctx;
  handlers;
  actionsMountRoot;
  toolbarMountRoot = null;
  toolbarEl;
  buttons = [];
  activeActionId = null;
  activeHoldCancel = null;
  suppressNextHoldClick = false;
  suppressHoldClickActionId = null;
  suppressHoldClickUntil = 0;
  clearSuppressHoldClickTimer = null;
  holdReleaseCleanup = null;
  postHoldCleanup = null;
  continueMenu = null;
  latestRecovery = [];
  destroyed = false;
  onKeyDown;
  onFocusIn;
  constructor(ctx, handlers) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.actionsMountRoot = ctx.ui.mount("chat_actions");
    this.actionsMountRoot.classList.add("gg-actions-host");
    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "gg-toolbar";
    this.toolbarEl.setAttribute("role", "toolbar");
    this.toolbarEl.setAttribute("aria-label", "Guided Generations actions");
    this.onKeyDown = (event) => {
      this.handleToolbarKeyDown(event);
    };
    this.onFocusIn = (event) => {
      const target = event.target;
      if (!target || target.tagName !== "BUTTON" || target.disabled) {
        return;
      }
      const action = target.getAttribute("data-gg-action");
      if (action) {
        this.activeActionId = action;
        this.applyRovingTabIndex();
      }
    };
    this.toolbarEl.addEventListener("keydown", this.onKeyDown);
    this.toolbarEl.addEventListener("focusin", this.onFocusIn);
    this.actionsMountRoot.replaceChildren(this.toolbarEl);
  }
  render(state) {
    if (this.destroyed)
      return;
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    const focusedActionId = activeEl && this.toolbarEl.contains(activeEl) ? activeEl.getAttribute?.("data-gg-action") : null;
    this.closeContinueMenu({ restoreFocus: false });
    this.clearActiveHold();
    this.latestRecovery = state.recovery;
    const buttons = [];
    const order = normalizeButtonOrder(state.settings.buttonOrder);
    for (const optionId of order) {
      const btn = optionId === "input_recovery" ? this.buildRecoveryButton(state) : this.buildActionButton(optionId, state);
      if (btn)
        buttons.push(btn);
    }
    this.buttons = buttons;
    this.toolbarEl.replaceChildren(...buttons);
    this.applyRovingTabIndex();
    const visible = buttons.length > 0;
    const placement = normalizeToolbarPlacement(state.settings.toolbarPlacement);
    this.applyPlacement(placement, visible);
    if (focusedActionId) {
      const matchingBtn = this.buttons.find((btn) => !btn.disabled && btn.getAttribute("data-gg-action") === focusedActionId);
      if (matchingBtn) {
        this.activeActionId = focusedActionId;
        this.applyRovingTabIndex();
        matchingBtn.focus();
      }
    }
  }
  applyRovingTabIndex() {
    const enabled = this.buttons.filter((btn) => !btn.disabled);
    if (enabled.length === 0) {
      for (const btn of this.buttons)
        btn.tabIndex = -1;
      return;
    }
    const activeBtn = (this.activeActionId ? enabled.find((btn) => btn.getAttribute("data-gg-action") === this.activeActionId) : undefined) ?? enabled[0];
    this.activeActionId = activeBtn.getAttribute("data-gg-action") ?? null;
    for (const btn of this.buttons) {
      btn.tabIndex = btn === activeBtn ? 0 : -1;
    }
  }
  handleToolbarKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey)
      return;
    const key = event.key;
    if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") {
      return;
    }
    const enabled = this.buttons.filter((btn) => !btn.disabled);
    if (enabled.length === 0)
      return;
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    let currentIndex = enabled.findIndex((btn) => btn === activeElement);
    if (currentIndex === -1) {
      currentIndex = enabled.findIndex((btn) => btn.tabIndex === 0);
    }
    if (currentIndex === -1)
      currentIndex = 0;
    let nextIndex = currentIndex;
    if (key === "ArrowRight" || key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % enabled.length;
    } else if (key === "ArrowLeft" || key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    } else if (key === "Home") {
      nextIndex = 0;
    } else if (key === "End") {
      nextIndex = enabled.length - 1;
    }
    const nextBtn = enabled[nextIndex];
    event.preventDefault();
    this.activeActionId = nextBtn.getAttribute("data-gg-action") ?? null;
    this.applyRovingTabIndex();
    nextBtn.focus();
  }
  buildActionButton(actionId, state) {
    const config = state.settings.actions[actionId];
    if (!config?.enabled)
      return null;
    const meta = ACTION_METADATA[actionId];
    const isThisRunning = state.activeRun?.actionId === actionId;
    const isOtherRunning = Boolean(state.activeRun) && !isThisRunning;
    const disabled = !state.hasActiveChat || isOtherRunning;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gg-btn";
    if (isThisRunning)
      btn.classList.add("is-running");
    if (disabled)
      btn.classList.add("is-dimmed");
    btn.disabled = disabled;
    btn.setAttribute("data-gg-action", actionId);
    btn.setAttribute("aria-label", isThisRunning ? `Stop ${meta.label}` : meta.label);
    if (actionId === "guided_swipe" && !isThisRunning) {
      btn.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
      btn.title = "Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";
    } else if (actionId === "guided_continue" && !isThisRunning) {
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-keyshortcuts", "Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");
      btn.title = "Guided Continue — click to continue, hold for continue options";
    } else {
      btn.title = isThisRunning ? `Stop ${meta.label}` : meta.tooltip;
    }
    btn.innerHTML = isThisRunning ? STOP_ICON_SVG : TOOLBAR_ICONS[actionId];
    if (actionId === "guided_swipe") {
      this.attachSwipeHoldHandlers(btn, state, isThisRunning, disabled);
    } else if (actionId === "guided_continue") {
      this.attachContinueHoldHandlers(btn, state, isThisRunning, disabled);
    } else {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isThisRunning && state.activeRun) {
          this.handlers.onAbortAction(state.activeRun.runId);
        } else {
          this.handlers.onTriggerAction(actionId);
        }
      });
    }
    return btn;
  }
  clearActiveHold() {
    if (this.activeHoldCancel) {
      const cancel = this.activeHoldCancel;
      this.activeHoldCancel = null;
      cancel();
    }
  }
  clearPostHoldClickSuppression() {
    this.suppressNextHoldClick = false;
    this.suppressHoldClickActionId = null;
    this.suppressHoldClickUntil = 0;
    if (this.clearSuppressHoldClickTimer !== null) {
      clearTimeout(this.clearSuppressHoldClickTimer);
      this.clearSuppressHoldClickTimer = null;
    }
    if (this.holdReleaseCleanup) {
      const cleanup = this.holdReleaseCleanup;
      this.holdReleaseCleanup = null;
      cleanup();
    }
    if (this.postHoldCleanup) {
      const onCleanup = this.postHoldCleanup;
      this.postHoldCleanup = null;
      onCleanup();
    }
  }
  isHoldClickSuppressed(targetBtn) {
    if (!this.suppressNextHoldClick)
      return false;
    if (this.suppressHoldClickUntil > 0 && Date.now() > this.suppressHoldClickUntil) {
      this.clearPostHoldClickSuppression();
      return false;
    }
    if (targetBtn && this.suppressHoldClickActionId !== null) {
      const actionId = targetBtn.getAttribute("data-gg-action");
      if (actionId !== this.suppressHoldClickActionId) {
        return false;
      }
    }
    return true;
  }
  armPostHoldClickSuppression(targetBtn, onSuppressionCleared) {
    this.clearPostHoldClickSuppression();
    this.suppressNextHoldClick = true;
    this.suppressHoldClickActionId = targetBtn.getAttribute("data-gg-action");
    this.suppressHoldClickUntil = Date.now() + PRE_RELEASE_SUPPRESS_FALLBACK_MS;
    this.postHoldCleanup = onSuppressionCleared ?? null;
    if (typeof document === "undefined")
      return;
    const win = typeof window !== "undefined" ? window : document.defaultView;
    const cleanupListeners = () => {
      document.removeEventListener("pointerup", onRelease, true);
      document.removeEventListener("pointercancel", onRelease, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      win?.removeEventListener("blur", onAbortSuppression);
      if (this.holdReleaseCleanup === cleanupListeners) {
        this.holdReleaseCleanup = null;
      }
    };
    const onAbortSuppression = () => {
      this.clearPostHoldClickSuppression();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        this.clearPostHoldClickSuppression();
      }
    };
    const onRelease = (event) => {
      cleanupListeners();
      if (this.clearSuppressHoldClickTimer !== null) {
        clearTimeout(this.clearSuppressHoldClickTimer);
      }
      const suppressWindowMs = event.type === "pointercancel" || event.pointerType === "mouse" ? POST_RELEASE_SUPPRESS_MS : POST_RELEASE_MAX_WINDOW_MS;
      this.suppressHoldClickUntil = Date.now() + suppressWindowMs;
      this.clearSuppressHoldClickTimer = setTimeout(() => {
        this.clearSuppressHoldClickTimer = null;
        this.clearPostHoldClickSuppression();
      }, suppressWindowMs);
    };
    this.holdReleaseCleanup = cleanupListeners;
    document.addEventListener("pointerup", onRelease, true);
    document.addEventListener("pointercancel", onRelease, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    win?.addEventListener("blur", onAbortSuppression);
    this.clearSuppressHoldClickTimer = setTimeout(() => {
      this.clearSuppressHoldClickTimer = null;
      this.clearPostHoldClickSuppression();
    }, PRE_RELEASE_SUPPRESS_FALLBACK_MS);
  }
  attachLongPressHandlers(btn, state, isThisRunning, disabled, options) {
    const hold = {
      timer: undefined,
      x: 0,
      y: 0,
      fired: false
    };
    const doc = typeof document !== "undefined" ? document : null;
    const win = typeof window !== "undefined" ? window : doc?.defaultView ?? null;
    let holdListenersAttached = false;
    const detachHoldCancelListeners = () => {
      if (!holdListenersAttached)
        return;
      holdListenersAttached = false;
      win?.removeEventListener("blur", cancelHold);
      doc?.removeEventListener("visibilitychange", cancelHold);
    };
    const attachHoldCancelListeners = () => {
      if (holdListenersAttached)
        return;
      holdListenersAttached = true;
      win?.addEventListener("blur", cancelHold);
      doc?.addEventListener("visibilitychange", cancelHold);
    };
    const cancelHold = () => {
      detachHoldCancelListeners();
      if (hold.timer !== undefined) {
        clearTimeout(hold.timer);
        hold.timer = undefined;
      }
      btn.classList.remove("is-holding");
      if (this.activeHoldCancel === cancelHold) {
        this.activeHoldCancel = null;
      }
    };
    btn.addEventListener("pointerdown", (event) => {
      if (disabled || state.activeRun)
        return;
      if (!event.isPrimary)
        return;
      if (event.pointerType === "mouse" && event.button !== 0)
        return;
      this.clearActiveHold();
      this.clearPostHoldClickSuppression();
      cancelHold();
      hold.fired = false;
      hold.x = event.clientX;
      hold.y = event.clientY;
      btn.classList.add("is-holding");
      this.activeHoldCancel = cancelHold;
      attachHoldCancelListeners();
      hold.timer = setTimeout(() => {
        hold.timer = undefined;
        detachHoldCancelListeners();
        btn.classList.remove("is-holding");
        if (this.activeHoldCancel === cancelHold) {
          this.activeHoldCancel = null;
        }
        hold.fired = true;
        this.armPostHoldClickSuppression(btn, () => {
          hold.fired = false;
        });
        options.onHold();
      }, HOLD_DURATION_MS);
    });
    btn.addEventListener("pointermove", (event) => {
      if (hold.timer === undefined)
        return;
      const dx = event.clientX - hold.x;
      const dy = event.clientY - hold.y;
      if (Math.hypot(dx, dy) > HOLD_MOVE_TOLERANCE_PX) {
        cancelHold();
      }
    });
    btn.addEventListener("pointerup", cancelHold);
    btn.addEventListener("pointercancel", cancelHold);
    btn.addEventListener("pointerleave", cancelHold);
    btn.addEventListener("contextmenu", (event) => {
      if (hold.timer !== undefined || hold.fired || this.isHoldClickSuppressed(btn)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    btn.addEventListener("click", (event) => {
      if (hold.fired || this.isHoldClickSuppressed(btn)) {
        hold.fired = false;
        this.clearPostHoldClickSuppression();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (isThisRunning && state.activeRun) {
        this.handlers.onAbortAction(state.activeRun.runId);
      } else {
        options.onClick(event);
      }
    });
    btn.addEventListener("keydown", (event) => {
      if (disabled || isThisRunning || state.activeRun)
        return;
      if (options.onShortcutKeyDown(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }
  attachSwipeHoldHandlers(btn, state, isThisRunning, disabled) {
    this.attachLongPressHandlers(btn, state, isThisRunning, disabled, {
      onClick: (event) => {
        this.handlers.onTriggerAction("guided_swipe", {
          backgroundSwipe: Boolean(event.ctrlKey || event.metaKey)
        });
      },
      onHold: () => {
        this.handlers.onTriggerAction("guided_swipe", { backgroundSwipe: true });
      },
      onShortcutKeyDown: (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.key === " ")) {
          this.handlers.onTriggerAction("guided_swipe", { backgroundSwipe: true });
          return true;
        }
        return false;
      }
    });
  }
  attachContinueHoldHandlers(btn, state, isThisRunning, disabled) {
    this.attachLongPressHandlers(btn, state, isThisRunning, disabled, {
      onClick: (event) => {
        if (this.continueMenu !== null && this.continueMenu.anchorBtn === btn) {
          this.closeContinueMenu({ restoreFocus: true });
          return;
        }
        this.closeContinueMenu({ restoreFocus: false });
        if (event.ctrlKey || event.metaKey) {
          this.openContinueMenu(btn);
          return;
        }
        this.handlers.onTriggerAction("guided_continue");
      },
      onHold: () => {
        this.openContinueMenu(btn);
      },
      onShortcutKeyDown: (event) => {
        if (event.shiftKey && event.key === "F10" || event.altKey && event.key === "ArrowUp" || (event.ctrlKey || event.metaKey) && event.key === "Enter") {
          this.openContinueMenu(btn);
          return true;
        }
        return false;
      }
    });
  }
  openContinueMenu(anchorBtn) {
    if (this.destroyed || typeof document === "undefined" || !document.body)
      return;
    this.closeContinueMenu({ restoreFocus: false });
    const menuEl = document.createElement("div");
    menuEl.className = "gg-dropup-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-label", "Guided Continue options");
    const menuDefs = [
      {
        id: "remove_last_continue",
        label: "Remove the last continue",
        icon: CONTINUE_MENU_ICONS.remove_last_continue,
        onSelect: () => this.handlers.onRemoveLastContinue()
      },
      {
        id: "regenerate_last_continue",
        label: "Regenerate last continue",
        icon: CONTINUE_MENU_ICONS.regenerate_last_continue,
        onSelect: () => this.handlers.onRegenerateLastContinue()
      }
    ];
    const items = [];
    for (const def of menuDefs) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "gg-dropup-item";
      itemBtn.setAttribute("role", "menuitem");
      itemBtn.setAttribute("data-gg-menu-action", def.id);
      itemBtn.tabIndex = -1;
      itemBtn.innerHTML = `${def.icon}<span>${def.label}</span>`;
      itemBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: false });
        def.onSelect();
      });
      items.push(itemBtn);
      menuEl.append(itemBtn);
    }
    document.body.append(menuEl);
    anchorBtn.setAttribute("aria-expanded", "true");
    this.positionContinueMenu(menuEl, anchorBtn);
    const openedAt = Date.now();
    const onMenuKeyDown = (event) => {
      const activeIdx = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % items.length;
        items[nextIdx]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const nextIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
        items[nextIdx]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        items[items.length - 1]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      }
    };
    const onDocumentKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      }
    };
    const onOutsidePointerDown = (event) => {
      if (Date.now() - openedAt < MENU_DISMISS_GRACE_MS)
        return;
      const target = event.target;
      if (target && (menuEl.contains(target) || target === anchorBtn || anchorBtn.contains(target))) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };
    const onOutsideClick = (event) => {
      if (this.isHoldClickSuppressed(anchorBtn))
        return;
      if (Date.now() - openedAt < MENU_DISMISS_GRACE_MS)
        return;
      const target = event.target;
      if (target && (menuEl.contains(target) || target === anchorBtn || anchorBtn.contains(target))) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };
    const onViewportResize = () => {
      this.closeContinueMenu({ restoreFocus: false });
    };
    const onViewportScroll = (event) => {
      const target = event.target;
      if (target && menuEl.contains(target))
        return;
      this.closeContinueMenu({ restoreFocus: false });
    };
    const win = typeof window !== "undefined" ? window : document.defaultView;
    menuEl.addEventListener("keydown", onMenuKeyDown);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    document.addEventListener("click", onOutsideClick, true);
    document.addEventListener("scroll", onViewportScroll, true);
    if (win) {
      win.addEventListener("resize", onViewportResize);
      win.addEventListener("scroll", onViewportScroll, true);
    }
    const cleanup = () => {
      menuEl.removeEventListener("keydown", onMenuKeyDown);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      document.removeEventListener("click", onOutsideClick, true);
      document.removeEventListener("scroll", onViewportScroll, true);
      if (win) {
        win.removeEventListener("resize", onViewportResize);
        win.removeEventListener("scroll", onViewportScroll, true);
      }
      menuEl.remove();
    };
    this.continueMenu = { menuEl, anchorBtn, items, cleanup };
    items[0]?.focus();
  }
  positionContinueMenu(menuEl, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const win = typeof window !== "undefined" ? window : document.defaultView;
    const getStyle = typeof getComputedStyle === "function" ? getComputedStyle : win?.getComputedStyle?.bind(win);
    const bodyStyle = getStyle && document.body ? getStyle(document.body) : null;
    const zoomVal = bodyStyle ? parseFloat(bodyStyle.zoom) : NaN;
    const scaleProp = bodyStyle && typeof bodyStyle.getPropertyValue === "function" ? parseFloat(bodyStyle.getPropertyValue("scale")) : NaN;
    const varScale = bodyStyle && typeof bodyStyle.getPropertyValue === "function" ? parseFloat(bodyStyle.getPropertyValue("--lumiverse-ui-scale")) : NaN;
    const uiScale = Number.isFinite(zoomVal) && zoomVal > 0 && zoomVal !== 1 ? zoomVal : Number.isFinite(scaleProp) && scaleProp > 0 && scaleProp !== 1 ? scaleProp : Number.isFinite(varScale) && varScale > 0 && varScale !== 1 ? varScale : 1;
    const vw = win && typeof win.innerWidth === "number" ? win.innerWidth : document.documentElement?.clientWidth || 1024;
    const vh = win && typeof win.innerHeight === "number" ? win.innerHeight : document.documentElement?.clientHeight || 768;
    menuEl.style.maxHeight = "";
    menuEl.style.overflowY = "";
    const historyListEl = menuEl.querySelector(".gg-dropup-history-list");
    if (historyListEl) {
      historyListEl.style.maxHeight = "";
    }
    const menuWidth = menuEl.offsetWidth * uiScale;
    const menuHeight = menuEl.offsetHeight * uiScale;
    const gapPx = 6;
    const edgePadding = 8;
    const maxLeft = Math.max(edgePadding, vw - menuWidth - edgePadding);
    const clampedLeft = Math.max(edgePadding, Math.min(rect.left, maxLeft));
    menuEl.style.left = `${clampedLeft / uiScale}px`;
    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    const neededHeight = menuHeight + gapPx * uiScale + edgePadding;
    let availableViewportPx;
    if (spaceAbove < neededHeight && spaceBelow > spaceAbove) {
      const topCss = Math.max(edgePadding / uiScale, rect.bottom / uiScale + gapPx);
      menuEl.style.top = `${topCss}px`;
      menuEl.style.bottom = "";
      availableViewportPx = Math.max(0, vh - topCss * uiScale - edgePadding);
    } else {
      menuEl.style.bottom = `${(vh - rect.top) / uiScale + gapPx}px`;
      menuEl.style.top = "";
      availableViewportPx = Math.max(0, spaceAbove - gapPx * uiScale - edgePadding);
    }
    const maxMenuHeightCss = Math.max(0, Math.floor(availableViewportPx / uiScale));
    menuEl.style.maxHeight = `${maxMenuHeightCss}px`;
    menuEl.style.overflowY = "auto";
    if (historyListEl) {
      const headerEl = menuEl.querySelector(".gg-dropup-header");
      const chromeHeightCss = historyListEl.offsetHeight > 0 && menuEl.offsetHeight >= historyListEl.offsetHeight ? menuEl.offsetHeight - historyListEl.offsetHeight : (headerEl?.offsetHeight || 32) + 12;
      const listMaxCss = Math.min(220, Math.max(0, maxMenuHeightCss - chromeHeightCss));
      historyListEl.style.maxHeight = `${listMaxCss}px`;
    }
  }
  closeContinueMenu(options) {
    const session = this.continueMenu;
    if (!session)
      return;
    this.continueMenu = null;
    session.anchorBtn.setAttribute("aria-expanded", "false");
    session.cleanup();
    if (options.restoreFocus && session.anchorBtn.isConnected && !session.anchorBtn.disabled) {
      session.anchorBtn.focus();
    }
  }
  buildRecoveryButton(state) {
    if (!state.settings.inputRecovery.enabled)
      return null;
    const hasRecovery = state.recovery.length > 0;
    const disabled = Boolean(state.activeRun);
    const latestPreview = state.recovery[0]?.text ? ` ("${state.recovery[0].text.replace(/\s+/g, " ").trim().slice(0, 48)}")` : "";
    const recoverBtn = document.createElement("button");
    recoverBtn.type = "button";
    recoverBtn.className = "gg-btn";
    if (disabled)
      recoverBtn.classList.add("is-dimmed");
    recoverBtn.disabled = disabled;
    recoverBtn.setAttribute("data-gg-action", "input_recovery");
    recoverBtn.setAttribute("aria-label", hasRecovery ? "Restore last input" : "Clear current input");
    if (!disabled) {
      recoverBtn.setAttribute("aria-haspopup", "menu");
      recoverBtn.setAttribute("aria-expanded", "false");
      recoverBtn.setAttribute("aria-keyshortcuts", "Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");
    }
    recoverBtn.title = hasRecovery ? `Restore last cleared input${latestPreview}` : "Input Recovery — clear current input";
    recoverBtn.innerHTML = TOOLBAR_ICONS.input_recovery;
    this.attachRecoveryHoldHandlers(recoverBtn, state, disabled);
    return recoverBtn;
  }
  attachRecoveryHoldHandlers(btn, state, disabled) {
    this.attachLongPressHandlers(btn, state, false, disabled, {
      onClick: (event) => {
        if (this.continueMenu !== null && this.continueMenu.anchorBtn === btn) {
          this.closeContinueMenu({ restoreFocus: true });
          return;
        }
        this.closeContinueMenu({ restoreFocus: false });
        if (event.ctrlKey || event.metaKey) {
          this.openRecoveryMenu(btn);
          return;
        }
        this.handlers.onRestoreLatest();
      },
      onHold: () => {
        this.openRecoveryMenu(btn);
      },
      onShortcutKeyDown: (event) => {
        if (event.shiftKey && event.key === "F10" || event.altKey && event.key === "ArrowUp" || (event.ctrlKey || event.metaKey) && event.key === "Enter") {
          this.openRecoveryMenu(btn);
          return true;
        }
        return false;
      }
    });
  }
  openRecoveryMenu(anchorBtn) {
    if (this.destroyed || typeof document === "undefined" || !document.body)
      return;
    this.closeContinueMenu({ restoreFocus: false });
    const menuEl = document.createElement("div");
    menuEl.className = "gg-dropup-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-label", "Input Recovery options");
    const items = [];
    let inHistoryView = false;
    const renderRootOptions = () => {
      inHistoryView = false;
      items.length = 0;
      menuEl.replaceChildren();
      menuEl.setAttribute("aria-label", "Input Recovery options");
      const isHistoryEmpty = this.latestRecovery.length === 0;
      const menuDefs = [
        {
          id: "history",
          label: "History",
          icon: RECOVERY_MENU_ICONS.history,
          disabled: false,
          onSelect: () => {
            renderHistoryView();
          }
        },
        {
          id: "clear_history",
          label: "Clear History",
          icon: RECOVERY_MENU_ICONS.clear_history,
          disabled: isHistoryEmpty,
          onSelect: () => {
            if (this.latestRecovery.length === 0)
              return;
            this.closeContinueMenu({ restoreFocus: false });
            this.handlers.onClearRecovery?.();
          }
        }
      ];
      for (const def of menuDefs) {
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = "gg-dropup-item";
        itemBtn.setAttribute("role", "menuitem");
        itemBtn.setAttribute("data-gg-menu-action", def.id);
        itemBtn.tabIndex = -1;
        if (def.disabled) {
          itemBtn.disabled = true;
          itemBtn.setAttribute("aria-disabled", "true");
          itemBtn.style.opacity = "0.45";
          itemBtn.style.cursor = "not-allowed";
        }
        itemBtn.innerHTML = `${def.icon}<span>${def.label}</span>`;
        itemBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (def.disabled)
            return;
          def.onSelect();
        });
        items.push(itemBtn);
        menuEl.append(itemBtn);
      }
      if (menuEl.isConnected) {
        this.positionContinueMenu(menuEl, anchorBtn);
        items[0]?.focus();
      }
    };
    const renderHistoryView = () => {
      inHistoryView = true;
      items.length = 0;
      menuEl.replaceChildren();
      menuEl.setAttribute("aria-label", "Input Recovery History");
      const header = document.createElement("div");
      header.className = "gg-dropup-header";
      header.style.flexShrink = "0";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "gg-dropup-back";
      backBtn.setAttribute("data-gg-menu-action", "back");
      backBtn.setAttribute("aria-label", "Back to Input Recovery options");
      backBtn.setAttribute("aria-keyshortcuts", "ArrowLeft Backspace");
      backBtn.tabIndex = -1;
      backBtn.textContent = "← Back";
      backBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        renderRootOptions();
      });
      const title = document.createElement("span");
      title.className = "gg-dropup-title";
      title.textContent = `History (${this.latestRecovery.length})`;
      header.append(backBtn, title);
      menuEl.append(header);
      items.push(backBtn);
      const listEl = document.createElement("div");
      listEl.className = "gg-dropup-history-list";
      listEl.style.minHeight = "0";
      if (this.latestRecovery.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "gg-dropup-empty";
        emptyEl.setAttribute("role", "status");
        emptyEl.textContent = "No saved inputs yet.";
        listEl.append(emptyEl);
        menuEl.append(listEl);
      } else {
        for (const entry of this.latestRecovery) {
          const actionLabel = ACTION_METADATA[entry.actionId]?.label ?? entry.actionId;
          const snippetText = formatRecoverySnippet(entry.text, 56);
          const itemBtn = document.createElement("button");
          itemBtn.type = "button";
          itemBtn.className = "gg-dropup-item gg-dropup-history-item";
          itemBtn.setAttribute("role", "menuitem");
          itemBtn.setAttribute("data-gg-menu-action", "restore_recovery_entry");
          itemBtn.setAttribute("data-gg-recovery-id", entry.id);
          itemBtn.setAttribute("aria-label", `Restore ${actionLabel} draft: ${formatRecoverySnippet(entry.text, 40)}`);
          itemBtn.title = entry.text;
          itemBtn.tabIndex = -1;
          const tagSpan = document.createElement("span");
          tagSpan.className = "gg-dropup-history-tag";
          tagSpan.textContent = actionLabel;
          const snippetSpan = document.createElement("span");
          snippetSpan.className = "gg-dropup-history-snippet";
          snippetSpan.textContent = snippetText;
          itemBtn.append(tagSpan, snippetSpan);
          itemBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.closeContinueMenu({ restoreFocus: false });
            if (this.handlers.onRestoreEntry) {
              this.handlers.onRestoreEntry(entry);
            } else {
              this.handlers.onRestoreLatest();
            }
          });
          items.push(itemBtn);
          listEl.append(itemBtn);
        }
        menuEl.append(listEl);
      }
      if (menuEl.isConnected) {
        this.positionContinueMenu(menuEl, anchorBtn);
        const initialFocusItem = this.latestRecovery.length > 0 ? items[1] ?? items[0] : items[0];
        initialFocusItem?.focus();
      }
    };
    renderRootOptions();
    document.body.append(menuEl);
    anchorBtn.setAttribute("aria-expanded", "true");
    this.positionContinueMenu(menuEl, anchorBtn);
    const openedAt = Date.now();
    const onMenuKeyDown = (event) => {
      const focusable = items.filter((el) => !el.disabled);
      const activeIdx = focusable.indexOf(document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        if (focusable.length === 0)
          return;
        const nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % focusable.length;
        focusable[nextIdx]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (focusable.length === 0)
          return;
        const nextIdx = activeIdx <= 0 ? focusable.length - 1 : activeIdx - 1;
        focusable[nextIdx]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        focusable[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        focusable[focusable.length - 1]?.focus();
      } else if (inHistoryView && (event.key === "ArrowLeft" || event.key === "Backspace")) {
        event.preventDefault();
        event.stopPropagation();
        renderRootOptions();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      }
    };
    const onDocumentKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      }
    };
    const onOutsidePointerDown = (event) => {
      if (Date.now() - openedAt < MENU_DISMISS_GRACE_MS)
        return;
      const target = event.target;
      if (target && (menuEl.contains(target) || target === anchorBtn || anchorBtn.contains(target))) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };
    const onOutsideClick = (event) => {
      if (this.isHoldClickSuppressed(anchorBtn))
        return;
      if (Date.now() - openedAt < MENU_DISMISS_GRACE_MS)
        return;
      const target = event.target;
      if (target && (menuEl.contains(target) || target === anchorBtn || anchorBtn.contains(target))) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };
    const onViewportResize = () => {
      this.closeContinueMenu({ restoreFocus: false });
    };
    const onViewportScroll = (event) => {
      const target = event.target;
      if (target && menuEl.contains(target))
        return;
      this.closeContinueMenu({ restoreFocus: false });
    };
    const win = typeof window !== "undefined" ? window : document.defaultView;
    menuEl.addEventListener("keydown", onMenuKeyDown);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    document.addEventListener("click", onOutsideClick, true);
    document.addEventListener("scroll", onViewportScroll, true);
    if (win) {
      win.addEventListener("resize", onViewportResize);
      win.addEventListener("scroll", onViewportScroll, true);
    }
    const cleanup = () => {
      menuEl.removeEventListener("keydown", onMenuKeyDown);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      document.removeEventListener("click", onOutsideClick, true);
      document.removeEventListener("scroll", onViewportScroll, true);
      if (win) {
        win.removeEventListener("resize", onViewportResize);
        win.removeEventListener("scroll", onViewportScroll, true);
      }
      menuEl.remove();
    };
    this.continueMenu = { menuEl, anchorBtn, items, cleanup };
    items[0]?.focus();
  }
  applyPlacement(placement, visible) {
    this.toolbarEl.style.display = visible ? "inline-flex" : "none";
    if (placement === "below_bar") {
      if (!this.toolbarMountRoot) {
        this.toolbarMountRoot = this.ctx.ui.mount("chat_toolbar");
      }
      this.resetHostElement(this.actionsMountRoot, true);
      this.toolbarMountRoot.classList.remove(...HOST_CLASSES);
      this.toolbarMountRoot.classList.add("gg-actions-host--row");
      this.toolbarMountRoot.style.display = visible ? "flex" : "none";
      if (this.toolbarEl.parentElement !== this.toolbarMountRoot) {
        this.toolbarMountRoot.replaceChildren(this.toolbarEl);
      }
      return;
    }
    if (this.toolbarMountRoot) {
      this.resetHostElement(this.toolbarMountRoot, true);
    }
    this.actionsMountRoot.classList.remove(...HOST_CLASSES);
    this.actionsMountRoot.classList.add("gg-actions-host");
    if (placement === "before_native") {
      this.actionsMountRoot.classList.add("is-before-native");
    } else if (placement === "right") {
      this.actionsMountRoot.classList.add("is-right");
    }
    this.actionsMountRoot.style.display = visible ? "inline-flex" : "none";
    if (this.toolbarEl.parentElement !== this.actionsMountRoot) {
      this.actionsMountRoot.replaceChildren(this.toolbarEl);
    }
  }
  resetHostElement(el, clearChildren) {
    el.classList.remove(...HOST_CLASSES);
    el.style.display = "none";
    if (clearChildren)
      el.replaceChildren();
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.closeContinueMenu({ restoreFocus: false });
    this.clearActiveHold();
    this.clearPostHoldClickSuppression();
    this.toolbarEl.removeEventListener("keydown", this.onKeyDown);
    this.toolbarEl.removeEventListener("focusin", this.onFocusIn);
    this.buttons = [];
    this.activeActionId = null;
    this.toolbarEl.replaceChildren();
    this.resetHostElement(this.actionsMountRoot, true);
    if (this.toolbarMountRoot) {
      this.resetHostElement(this.toolbarMountRoot, true);
    }
  }
}

// src/frontend/pill-metrics.ts
var MESSAGE_READ_LIMIT = 50;
var WIDER_MESSAGE_READ_LIMIT = 200;
var RETRY_DELAYS_MS = [0, 50, 150];
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function extractMessageList(page) {
  const rawList = Array.isArray(page) ? page : isRecord2(page) && Array.isArray(page.data) ? page.data : isRecord2(page) && Array.isArray(page.items) ? page.items : [];
  const result = [];
  for (const item of rawList) {
    if (isRecord2(item) && typeof item.id === "string") {
      result.push(item);
    }
  }
  return result;
}
function isPageTruncated(page, messageCount, limit) {
  if (messageCount >= limit)
    return true;
  if (isRecord2(page) && typeof page.total === "number" && page.total > messageCount) {
    return true;
  }
  return false;
}
function isPermanentError(error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const upper = message.toUpperCase();
  return upper.includes("PERMISSION_DENIED") || upper.includes("SPINDLE_FRONTEND_INACTIVE") || upper.includes("STALE_GENERATION") || upper.includes("NOT FOUND") || upper.includes("404") || upper.includes("403") || upper.includes("401");
}

class PillMetricsController {
  ctx;
  pending = new Map;
  scheduledKeys = new Set;
  inFlightByMessage = new Map;
  retryTimers = new Map;
  nextRevision = 0;
  destroyed = false;
  constructor(ctx) {
    this.ctx = ctx;
  }
  makeKey(chatId, messageId, swipeId) {
    return `${chatId}:${messageId}:${swipeId}`;
  }
  handleMetricsEvent(event) {
    if (this.destroyed)
      return;
    if (typeof event.chatId !== "string" || !event.chatId || typeof event.messageId !== "string" || !event.messageId || typeof event.swipeId !== "number" || !Number.isInteger(event.swipeId) || event.swipeId < 0) {
      return;
    }
    if (event.tokenCount === undefined && event.generationMetrics === undefined) {
      return;
    }
    const key = this.makeKey(event.chatId, event.messageId, event.swipeId);
    const existing = this.pending.get(key);
    const entry = {
      key,
      chatId: event.chatId,
      messageId: event.messageId,
      swipeId: event.swipeId,
      tokenCount: event.tokenCount !== undefined ? event.tokenCount : existing?.tokenCount,
      generationMetrics: event.generationMetrics !== undefined ? event.generationMetrics : existing?.generationMetrics,
      latestFallback: existing?.latestFallback ?? null,
      revision: ++this.nextRevision,
      attempts: 0
    };
    this.pending.set(key, entry);
    this.clearRetryTimer(key);
    this.enqueueFlush(key);
  }
  onMessageEvent(rawPayload) {
    if (this.destroyed || this.pending.size === 0)
      return;
    const payload = isRecord2(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord2(payload.message) ? payload.message : null;
    const messageId = typeof msg?.id === "string" ? msg.id : typeof payload?.messageId === "string" ? payload.messageId : null;
    if (!messageId)
      return;
    const chatId = typeof payload?.chatId === "string" ? payload.chatId : typeof msg?.chat_id === "string" ? msg.chat_id : null;
    const action = typeof payload?.action === "string" ? payload.action : null;
    const deletedSwipeId = action === "deleted" && typeof payload?.swipeId === "number" ? payload.swipeId : null;
    const activeSwipeId = typeof msg?.swipe_id === "number" ? msg.swipe_id : action !== "deleted" && typeof payload?.swipeId === "number" ? payload.swipeId : undefined;
    const eventFallback = msg && typeof msg.id === "string" ? msg : null;
    if (deletedSwipeId !== null) {
      const shifted = [];
      for (const [key, entry] of [...this.pending.entries()]) {
        if (entry.messageId !== messageId)
          continue;
        if (chatId && entry.chatId !== chatId)
          continue;
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
            revision: ++this.nextRevision
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
      if (entry.messageId !== messageId)
        continue;
      if (chatId && entry.chatId !== chatId)
        continue;
      if (activeSwipeId !== undefined && activeSwipeId !== entry.swipeId) {
        continue;
      }
      entry.attempts = 0;
      this.enqueueFlush(key, eventFallback);
    }
  }
  onChatChanged(chatId) {
    if (this.destroyed || this.pending.size === 0)
      return;
    const targetChatId = typeof chatId === "string" && chatId.length > 0 ? chatId : this.safeGetActiveChatId();
    if (!targetChatId)
      return;
    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.chatId !== targetChatId)
        continue;
      entry.attempts = 0;
      this.enqueueFlush(key);
    }
  }
  onChatDeleted(chatId) {
    if (this.destroyed || !chatId || this.pending.size === 0)
      return;
    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.chatId !== chatId)
        continue;
      this.pending.delete(key);
      this.scheduledKeys.delete(key);
      this.clearRetryTimer(key);
    }
  }
  onMessageDeleted(rawPayload) {
    if (this.destroyed || this.pending.size === 0)
      return;
    const payload = isRecord2(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord2(payload.message) ? payload.message : null;
    const messageId = typeof msg?.id === "string" ? msg.id : typeof payload?.messageId === "string" ? payload.messageId : typeof payload?.id === "string" ? payload.id : null;
    if (!messageId)
      return;
    const chatId = typeof payload?.chatId === "string" ? payload.chatId : typeof payload?.chat_id === "string" ? payload.chat_id : typeof msg?.chat_id === "string" ? msg.chat_id : null;
    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.messageId !== messageId)
        continue;
      if (chatId && entry.chatId !== chatId)
        continue;
      this.pending.delete(key);
      this.scheduledKeys.delete(key);
      this.clearRetryTimer(key);
    }
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.pending.clear();
    this.scheduledKeys.clear();
    this.inFlightByMessage.clear();
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }
  enqueueFlush(key, eventFallback = null) {
    if (this.destroyed)
      return;
    const entry = this.pending.get(key);
    if (!entry)
      return;
    if (eventFallback !== null) {
      entry.latestFallback = eventFallback;
    }
    if (this.scheduledKeys.has(key))
      return;
    this.scheduledKeys.add(key);
    const msgKey = `${entry.chatId}:${entry.messageId}`;
    const prev = this.inFlightByMessage.get(msgKey) ?? Promise.resolve();
    const run = prev.catch(() => {
      return;
    }).then(async () => {
      this.scheduledKeys.delete(key);
      if (this.destroyed)
        return;
      await this.flushKey(key, eventFallback);
    }).catch(() => {
      return;
    }).finally(() => {
      if (this.inFlightByMessage.get(msgKey) === run) {
        this.inFlightByMessage.delete(msgKey);
      }
    });
    this.inFlightByMessage.set(msgKey, run);
  }
  async flushKey(key, eventFallback) {
    if (this.destroyed)
      return;
    const current = this.pending.get(key);
    if (!current)
      return;
    const snapshot = { ...current };
    const resolvedFallback = snapshot.latestFallback ?? eventFallback;
    const updateMessage = this.resolveUpdateMessage();
    if (!updateMessage) {
      this.deleteIfSameRevision(key, snapshot.revision);
      return;
    }
    let target = null;
    const getMessages = this.resolveGetMessages();
    if (getMessages) {
      let page;
      try {
        page = await getMessages(snapshot.chatId, {
          limit: MESSAGE_READ_LIMIT,
          tail: true
        });
      } catch (error) {
        if (this.destroyed)
          return;
        this.handleFlushFailure(key, snapshot, error);
        return;
      }
      if (this.destroyed)
        return;
      const messages = extractMessageList(page);
      target = messages.find((m) => m.id === snapshot.messageId) ?? null;
      if (!target) {
        const truncated = isPageTruncated(page, messages.length, MESSAGE_READ_LIMIT);
        if (!truncated) {
          this.deleteIfSameRevision(key, snapshot.revision);
          return;
        }
        const getSingleMessage = this.resolveGetSingleMessage();
        if (getSingleMessage) {
          try {
            const single = await getSingleMessage(snapshot.messageId);
            if (this.destroyed)
              return;
            if (isRecord2(single) && typeof single.id === "string" && single.id === snapshot.messageId && (typeof single.chat_id !== "string" || single.chat_id === snapshot.chatId)) {
              target = single;
            }
          } catch {}
        }
        if (!target && truncated) {
          try {
            const widerPage = await getMessages(snapshot.chatId, {
              limit: WIDER_MESSAGE_READ_LIMIT,
              tail: true
            });
            if (this.destroyed)
              return;
            const widerMessages = extractMessageList(widerPage);
            target = widerMessages.find((m) => m.id === snapshot.messageId) ?? null;
            if (!target && !isPageTruncated(widerPage, widerMessages.length, WIDER_MESSAGE_READ_LIMIT)) {
              this.deleteIfSameRevision(key, snapshot.revision);
              return;
            }
          } catch (error) {
            if (this.destroyed)
              return;
            this.handleFlushFailure(key, snapshot, error);
            return;
          }
        }
        if (!target) {
          return;
        }
      }
    } else if (resolvedFallback && resolvedFallback.id === snapshot.messageId) {
      target = resolvedFallback;
    } else {
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
      return;
    }
    const nextExtra = {
      ...isRecord2(target.extra) ? target.extra : {}
    };
    if (snapshot.tokenCount !== undefined) {
      nextExtra.tokenCount = snapshot.tokenCount;
    }
    if (snapshot.generationMetrics !== undefined) {
      nextExtra.generationMetrics = snapshot.generationMetrics;
    }
    try {
      await updateMessage(snapshot.chatId, snapshot.messageId, {
        extra: nextExtra
      });
    } catch (error) {
      if (this.destroyed)
        return;
      this.handleFlushFailure(key, snapshot, error);
      return;
    }
    if (this.destroyed)
      return;
    this.deleteIfSameRevision(key, snapshot.revision);
  }
  handleFlushFailure(key, snapshot, error) {
    const current = this.pending.get(key);
    if (!current || current.revision !== snapshot.revision) {
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
  deleteIfSameRevision(key, revision) {
    const current = this.pending.get(key);
    if (current && current.revision === revision) {
      this.pending.delete(key);
    }
  }
  scheduleRetry(key, delayMs) {
    if (this.destroyed || this.retryTimers.has(key))
      return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(key);
      if (this.destroyed)
        return;
      this.enqueueFlush(key);
    }, delayMs);
    this.retryTimers.set(key, timer);
  }
  clearRetryTimer(key) {
    const timer = this.retryTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.retryTimers.delete(key);
    }
  }
  resolveGetMessages() {
    try {
      const domainChats = this.ctx.domain?.chats;
      if (typeof domainChats?.getMessages === "function") {
        return domainChats.getMessages.bind(domainChats);
      }
      const chats = this.ctx.chats;
      if (typeof chats?.getMessages === "function") {
        return chats.getMessages.bind(chats);
      }
    } catch {}
    return null;
  }
  resolveGetSingleMessage() {
    try {
      const messagesApi = this.ctx.messages;
      if (typeof messagesApi?.get === "function") {
        return messagesApi.get.bind(messagesApi);
      }
    } catch {}
    return null;
  }
  resolveUpdateMessage() {
    try {
      const chats = this.ctx.chats;
      if (typeof chats?.updateMessage === "function") {
        return chats.updateMessage.bind(chats);
      }
    } catch {}
    return null;
  }
  safeGetActiveChatId() {
    try {
      return this.ctx.getActiveChat?.().chatId ?? null;
    } catch {
      return null;
    }
  }
}

// src/frontend/settings-drawer.ts
class SettingsDrawerController {
  ctx;
  handlers;
  tab;
  handles = [];
  currentSettings = null;
  expandedSections = new Set;
  debounceTimers = new Map;
  orderStateTags = new Map;
  rootEl = null;
  headerEl = null;
  noticeEl = null;
  recoveryUi = null;
  pendingView = null;
  pendingFocusRestore = null;
  pendingGeneralFocusRestore = null;
  pointerActiveInDrawer = false;
  pointerReleaseCleanup = null;
  pointerFallbackTimer = null;
  pendingViewFlushTimer = null;
  noticeText = "";
  noticeKind = "info";
  recoveryBusy = false;
  destroyed = false;
  onFocusOut;
  onPointerDownInDrawer;
  constructor(ctx, handlers) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.tab = ctx.ui.registerDrawerTab({
      id: "guided-generations-settings",
      title: "Guided Generations",
      shortName: "Guided",
      description: "Configure input-bar guided action buttons and per-option API connection profiles & presets.",
      keywords: [
        "guided",
        "continue",
        "regenerate",
        "swipe",
        "impersonate",
        "recovery",
        "preset",
        "profile"
      ],
      iconSvg: DRAWER_TAB_ICON_SVG
    });
    const clearPointerTracking = () => {
      if (this.pointerFallbackTimer !== null) {
        clearTimeout(this.pointerFallbackTimer);
        this.pointerFallbackTimer = null;
      }
      if (this.pointerReleaseCleanup) {
        const cleanup = this.pointerReleaseCleanup;
        this.pointerReleaseCleanup = null;
        cleanup();
      }
    };
    this.onPointerDownInDrawer = () => {
      if (this.destroyed || this.pointerActiveInDrawer)
        return;
      this.pointerActiveInDrawer = true;
      clearPointerTracking();
      if (typeof document === "undefined") {
        this.pointerActiveInDrawer = false;
        return;
      }
      const win = typeof window !== "undefined" ? window : document.defaultView;
      const finishPointer = () => {
        clearPointerTracking();
        if (this.pendingViewFlushTimer !== null) {
          clearTimeout(this.pendingViewFlushTimer);
        }
        this.pendingViewFlushTimer = setTimeout(() => {
          this.pendingViewFlushTimer = null;
          this.pointerActiveInDrawer = false;
          this.flushPendingViewIfIdle();
        }, 0);
      };
      const onWindowBlur = () => {
        clearPointerTracking();
        this.pointerActiveInDrawer = false;
        this.flushPendingViewIfIdle();
      };
      document.addEventListener("pointerup", finishPointer, true);
      document.addEventListener("pointercancel", finishPointer, true);
      document.addEventListener("mouseup", finishPointer, true);
      win?.addEventListener("blur", onWindowBlur);
      this.pointerReleaseCleanup = () => {
        document.removeEventListener("pointerup", finishPointer, true);
        document.removeEventListener("pointercancel", finishPointer, true);
        document.removeEventListener("mouseup", finishPointer, true);
        win?.removeEventListener("blur", onWindowBlur);
      };
      this.pointerFallbackTimer = setTimeout(() => {
        clearPointerTracking();
        this.pointerActiveInDrawer = false;
        this.flushPendingViewIfIdle();
      }, 3000);
    };
    this.onFocusOut = (event) => {
      if (this.destroyed)
        return;
      const nextTarget = event.relatedTarget;
      if (this.debounceTimers.size > 0 && nextTarget !== event.target) {
        this.flushPendingSaves();
      }
      const stillInsideEditable = isElementNode(nextTarget) && this.tab.root.contains(nextTarget) && isEditableElement(nextTarget);
      if (!stillInsideEditable && this.pendingView) {
        if (this.pointerActiveInDrawer || isClickableInside(this.tab.root, nextTarget)) {
          if (!this.pointerActiveInDrawer) {
            this.scheduleDeferredPendingViewFlush();
          }
        } else {
          queueMicrotask(() => {
            this.flushPendingViewIfIdle();
          });
        }
      }
    };
    this.tab.root.addEventListener("pointerdown", this.onPointerDownInDrawer);
    this.tab.root.addEventListener("mousedown", this.onPointerDownInDrawer);
    this.tab.root.addEventListener("focusout", this.onFocusOut);
  }
  scheduleDeferredPendingViewFlush() {
    if (this.destroyed || this.pendingViewFlushTimer !== null)
      return;
    this.pendingViewFlushTimer = setTimeout(() => {
      this.pendingViewFlushTimer = null;
      this.flushPendingViewIfIdle();
    }, 0);
  }
  flushPendingViewIfIdle() {
    if (this.destroyed || this.pointerActiveInDrawer)
      return;
    if (this.pendingView && !this.isEditingDrawerInput()) {
      const next = this.currentSettings ? { ...this.pendingView, settings: this.currentSettings } : this.pendingView;
      this.pendingView = null;
      this.render(next, { force: true });
    }
  }
  onActivate(handler) {
    return this.tab.onActivate(handler);
  }
  setNotice(text, kind = "info") {
    this.noticeText = text;
    this.noticeKind = kind;
    this.syncNoticeElement();
  }
  syncNoticeElement() {
    if (this.destroyed || !this.rootEl || !this.headerEl)
      return;
    if (!this.noticeText) {
      this.noticeEl?.remove();
      this.noticeEl = null;
      return;
    }
    if (!this.noticeEl) {
      this.noticeEl = document.createElement("div");
      this.headerEl.after(this.noticeEl);
    }
    this.noticeEl.className = `gg-notice${this.noticeKind === "error" ? " is-error" : this.noticeKind === "warn" ? " is-warn" : ""}`;
    if (this.noticeKind === "error" || this.noticeKind === "warn") {
      this.noticeEl.setAttribute("role", "alert");
      this.noticeEl.setAttribute("aria-live", "assertive");
    } else {
      this.noticeEl.setAttribute("role", "status");
      this.noticeEl.setAttribute("aria-live", "polite");
    }
    this.noticeEl.textContent = this.noticeText;
  }
  setRecoveryBusy(busy) {
    if (this.destroyed)
      return;
    this.recoveryBusy = busy;
    if (!this.recoveryUi)
      return;
    this.recoveryUi.clearBtn.disabled = busy || this.recoveryUi.recoveryCount === 0;
    if (this.recoveryUi.listEl) {
      for (const btn of this.recoveryUi.listEl.querySelectorAll("button")) {
        btn.disabled = busy;
      }
    }
  }
  updateRecovery(recovery, settings) {
    if (this.destroyed)
      return;
    if (this.pendingView) {
      this.pendingView = {
        ...this.pendingView,
        recovery: [...recovery]
      };
    }
    if (!this.recoveryUi)
      return;
    const maxEntries = settings?.inputRecovery.maxEntries ?? this.currentSettings?.inputRecovery.maxEntries ?? 10;
    this.recoveryUi.maxEntries = maxEntries;
    this.recoveryUi.recoveryCount = recovery.length;
    this.recoveryUi.setBadge(recovery.length > 0 ? String(recovery.length) : "", recovery.length === 0);
    this.recoveryUi.countLabel.textContent = recovery.length > 0 ? `Saved inputs (${recovery.length}/${maxEntries}):` : "No saved inputs yet.";
    this.recoveryUi.clearBtn.disabled = this.recoveryBusy || recovery.length === 0;
    this.syncRecoveryList(recovery);
  }
  isEditingDrawerInput() {
    if (this.debounceTimers.size > 0)
      return true;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return Boolean(isElementNode(active) && this.tab.root.contains(active) && isEditableElement(active));
  }
  captureOrderButtonFocus() {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!isElementNode(active) || !this.tab.root.contains(active)) {
      return;
    }
    if (!this.pendingFocusRestore && active.tagName === "BUTTON") {
      const btn = active;
      const moveDir = btn.dataset.ggMove;
      if (moveDir === "up" || moveDir === "down") {
        const row = btn.closest("[data-gg-order-id]");
        const optionId = row?.getAttribute("data-gg-order-id");
        if (optionId) {
          this.pendingFocusRestore = { optionId, button: moveDir };
          return;
        }
      }
    }
    if (!this.pendingFocusRestore && !this.pendingGeneralFocusRestore) {
      const focusKey = active.getAttribute("data-gg-focus-key") ?? undefined;
      const ariaLabel = active.getAttribute("aria-label") ?? undefined;
      if (focusKey || ariaLabel) {
        this.pendingGeneralFocusRestore = {
          focusKey,
          tagName: active.tagName,
          ariaLabel
        };
      }
    }
  }
  render(view, options) {
    if (this.destroyed)
      return;
    if (!options?.force && this.rootEl !== null && this.currentSettings !== null && this.isEditingDrawerInput()) {
      if (view) {
        this.pendingView = view;
        this.updateRecovery(view.recovery, view.settings);
      }
      return;
    }
    this.pendingView = null;
    if (this.pendingViewFlushTimer !== null) {
      clearTimeout(this.pendingViewFlushTimer);
      this.pendingViewFlushTimer = null;
    }
    this.captureOrderButtonFocus();
    let effectiveView = view;
    if (options?.force && this.debounceTimers.size > 0) {
      this.flushPendingSaves();
      if (effectiveView && this.currentSettings) {
        effectiveView = { ...effectiveView, settings: this.currentSettings };
      }
    } else {
      this.cancelPendingSaves();
    }
    this.clearComponentHandles();
    this.orderStateTags.clear();
    this.recoveryUi = null;
    this.noticeEl = null;
    this.currentSettings = effectiveView?.settings ?? null;
    const root = document.createElement("div");
    root.className = "gg-drawer";
    this.rootEl = root;
    this.tab.root.replaceChildren(root);
    const header = document.createElement("header");
    header.className = "gg-header";
    this.headerEl = header;
    const titleWrap = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = "Guided Generations";
    const sub = document.createElement("p");
    sub.className = "gg-muted";
    sub.textContent = "Enabled options appear on the composer's top action bar alongside native buttons. Each option uses its own connection profile, model, and preset without modifying your active chat.";
    titleWrap.append(h2, sub);
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "gg-btn-sm";
    refreshBtn.dataset.ggFocusKey = "refresh";
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", () => {
      this.flushPendingSaves();
      this.handlers.onRefresh();
    });
    header.append(titleWrap, refreshBtn);
    root.append(header);
    this.syncNoticeElement();
    if (!effectiveView) {
      const loading = document.createElement("p");
      loading.className = "gg-muted";
      loading.textContent = "Loading Guided Generations settings…";
      root.append(loading);
      this.restoreCapturedFocus(root);
      return;
    }
    const missingPerms = [];
    if (!effectiveView.permissions.generation)
      missingPerms.push("generation");
    if (!effectiveView.permissions.chats)
      missingPerms.push("chats");
    if (!effectiveView.permissions.chat_mutation)
      missingPerms.push("chat_mutation");
    if (!effectiveView.permissions.presets)
      missingPerms.push("presets");
    if (missingPerms.length > 0) {
      const warn = document.createElement("div");
      warn.className = "gg-notice is-warn";
      warn.setAttribute("role", "alert");
      warn.setAttribute("aria-live", "assertive");
      warn.textContent = `Missing extension permissions (${missingPerms.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`;
      root.append(warn);
    }
    const missingFeaturePerms = [];
    const degradedNotes = [];
    if (effectiveView.permissions.interceptor === false) {
      missingFeaturePerms.push("interceptor");
      degradedNotes.push("preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement");
    }
    if (effectiveView.permissions.regex_scripts === false) {
      missingFeaturePerms.push("regex_scripts");
      degradedNotes.push("Lumiverse regex scripts are skipped on guidance prompts and generated/impersonated outputs");
    }
    if (missingFeaturePerms.length > 0) {
      const featureWarn = document.createElement("div");
      featureWarn.className = "gg-notice is-warn";
      featureWarn.setAttribute("role", "alert");
      featureWarn.setAttribute("aria-live", "assertive");
      featureWarn.textContent = `Optional permissions not granted (${missingFeaturePerms.join(", ")}): ${degradedNotes.join("; ")}. Grant them in Extension Manager for full functionality.`;
      root.append(featureWarn);
    }
    if (effectiveView.catalogWarnings && effectiveView.catalogWarnings.length > 0) {
      const catalogWarn = document.createElement("div");
      catalogWarn.className = "gg-notice is-warn";
      catalogWarn.setAttribute("role", "alert");
      catalogWarn.setAttribute("aria-live", "assertive");
      catalogWarn.textContent = effectiveView.catalogWarnings.join(" ");
      root.append(catalogWarn);
    }
    const connectionOptions = buildConnectionOptions(effectiveView.connections);
    const presetOptions = buildPresetOptions(effectiveView.presets);
    const roleOptions = [
      { value: "system", label: "System" },
      { value: "user", label: "User" },
      { value: "assistant", label: "Assistant" }
    ];
    this.renderToolbarLayoutSection(root, effectiveView.settings);
    for (const actionId of GUIDED_ACTION_ORDER) {
      this.renderActionSection(root, effectiveView.settings, actionId, effectiveView.connections, connectionOptions, presetOptions, roleOptions);
    }
    this.renderRecoverySection(root, effectiveView.settings, effectiveView.recovery);
    this.restoreCapturedFocus(root);
  }
  restoreCapturedFocus(root) {
    if (this.pendingFocusRestore) {
      const restore = this.pendingFocusRestore;
      this.pendingFocusRestore = null;
      this.pendingGeneralFocusRestore = null;
      const targetRow = root.querySelector(`[data-gg-order-id="${restore.optionId}"]`);
      const preferred = targetRow?.querySelector(`button[data-gg-move="${restore.button}"]`);
      const fallback = targetRow?.querySelector(`button[data-gg-move="${restore.button === "up" ? "down" : "up"}"]`);
      const targetBtn = preferred && !preferred.disabled ? preferred : fallback && !fallback.disabled ? fallback : null;
      targetBtn?.focus();
      return;
    }
    if (this.pendingGeneralFocusRestore) {
      const restore = this.pendingGeneralFocusRestore;
      this.pendingGeneralFocusRestore = null;
      let target = null;
      if (restore.focusKey) {
        target = findElementByAttribute(root, "data-gg-focus-key", restore.focusKey);
      }
      if (!target && restore.ariaLabel) {
        target = findElementByAttribute(root, "aria-label", restore.ariaLabel, restore.tagName);
      }
      if (target && !target.disabled) {
        target.focus();
      }
    }
  }
  createCollapsibleCard(parent, sectionId, title, badgeText, badgeMuted = false) {
    const card = document.createElement("section");
    card.className = "gg-card";
    if (this.expandedSections.has(sectionId)) {
      card.classList.add("is-expanded");
    }
    const headerBtn = document.createElement("button");
    headerBtn.type = "button";
    headerBtn.className = "gg-card-header";
    headerBtn.dataset.ggFocusKey = `card-header:${sectionId}`;
    headerBtn.setAttribute("aria-expanded", String(this.expandedSections.has(sectionId)));
    const left = document.createElement("span");
    left.className = "gg-card-header-left";
    const chevron = document.createElement("span");
    chevron.className = "gg-card-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▸";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    left.append(chevron, titleEl);
    const badge = document.createElement("span");
    badge.className = `gg-card-badge${badgeMuted ? " is-muted" : ""}`;
    if (badgeText !== undefined) {
      badge.textContent = badgeText;
    } else {
      badge.style.display = "none";
    }
    headerBtn.append(left, badge);
    const bodyWrap = document.createElement("div");
    bodyWrap.className = "gg-card-body-wrap";
    const bodyId = `gg-card-body-${sectionId}`;
    bodyWrap.id = bodyId;
    headerBtn.setAttribute("aria-controls", bodyId);
    const body = document.createElement("div");
    body.className = "gg-section-body";
    bodyWrap.append(body);
    headerBtn.addEventListener("click", () => {
      const nextExpanded = !card.classList.contains("is-expanded");
      card.classList.toggle("is-expanded", nextExpanded);
      headerBtn.setAttribute("aria-expanded", String(nextExpanded));
      if (nextExpanded)
        this.expandedSections.add(sectionId);
      else
        this.expandedSections.delete(sectionId);
    });
    card.append(headerBtn, bodyWrap);
    parent.append(card);
    return {
      body,
      setBadge(nextText, muted = false) {
        badge.textContent = nextText;
        badge.className = `gg-card-badge${muted ? " is-muted" : ""}`;
        badge.style.display = nextText ? "" : "none";
      }
    };
  }
  renderToolbarLayoutSection(parent, settings) {
    const placement = normalizeToolbarPlacement(settings.toolbarPlacement);
    const placementMeta = TOOLBAR_PLACEMENT_OPTIONS.find((opt) => opt.value === placement) ?? TOOLBAR_PLACEMENT_OPTIONS[0];
    const card = this.createCollapsibleCard(parent, "toolbar_layout", "Toolbar Position & Order", placementMeta.shortLabel, false);
    const body = card.body;
    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent = "Choose where the Guided Generations buttons appear on the composer bar and customize their left-to-right order.";
    body.append(desc);
    const saveLayout = (patch, options) => {
      const base = this.currentSettings ?? settings;
      const next = {
        ...base,
        ...patch
      };
      this.currentSettings = next;
      if (patch.toolbarPlacement !== undefined) {
        const nextMeta = TOOLBAR_PLACEMENT_OPTIONS.find((opt) => opt.value === patch.toolbarPlacement);
        if (nextMeta)
          card.setBadge(nextMeta.shortLabel, false);
      }
      this.handlers.onSaveSettings(next, options);
    };
    const placementField = createFieldContainer("Bar Placement");
    body.append(placementField.wrap);
    this.handles.push(this.ctx.components.mountSelect(placementField.slot, {
      options: TOOLBAR_PLACEMENT_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        sublabel: opt.sublabel
      })),
      value: placement,
      ariaLabel: "Toolbar Bar Placement",
      onChange: (val) => {
        saveLayout({ toolbarPlacement: normalizeToolbarPlacement(val) }, { rebuildDrawer: false });
      }
    }));
    const orderField = createFieldContainer("Button Order (left to right)");
    const orderList = document.createElement("div");
    orderList.className = "gg-order-list";
    const currentOrder = normalizeButtonOrder(settings.buttonOrder);
    currentOrder.forEach((optionId, index) => {
      const row = document.createElement("div");
      row.className = "gg-order-item";
      row.setAttribute("data-gg-order-id", optionId);
      const left = document.createElement("div");
      left.className = "gg-order-item-left";
      const icon = document.createElement("span");
      icon.className = "gg-order-item-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = TOOLBAR_ICONS[optionId];
      const labelText = optionId === "input_recovery" ? "Input Recovery" : ACTION_METADATA[optionId].label;
      const isVisible = optionId === "input_recovery" ? settings.inputRecovery.enabled : Boolean(settings.actions[optionId]?.enabled);
      const labelWrap = document.createElement("span");
      labelWrap.className = "gg-order-item-label";
      labelWrap.textContent = labelText;
      const stateTag = document.createElement("span");
      stateTag.className = "gg-order-item-state";
      stateTag.textContent = isVisible ? "Visible" : "Hidden";
      this.orderStateTags.set(optionId, stateTag);
      left.append(icon, labelWrap, stateTag);
      const controls = document.createElement("div");
      controls.className = "gg-order-item-controls";
      const moveOption = (delta) => {
        const targetIndex = index + delta;
        if (targetIndex < 0 || targetIndex >= currentOrder.length)
          return;
        this.flushPendingSaves();
        const reordered = [...currentOrder];
        const [moved] = reordered.splice(index, 1);
        if (!moved)
          return;
        reordered.splice(targetIndex, 0, moved);
        const preferredBtn = delta === -1 ? targetIndex === 0 ? "down" : "up" : targetIndex === reordered.length - 1 ? "up" : "down";
        this.pendingFocusRestore = { optionId: moved, button: preferredBtn };
        saveLayout({ buttonOrder: reordered }, { rebuildDrawer: true });
      };
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "gg-icon-btn-sm";
      upBtn.dataset.ggMove = "up";
      upBtn.textContent = "↑";
      upBtn.title = `Move ${labelText} left / up`;
      upBtn.setAttribute("aria-label", `Move ${labelText} up`);
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveOption(-1));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "gg-icon-btn-sm";
      downBtn.dataset.ggMove = "down";
      downBtn.textContent = "↓";
      downBtn.title = `Move ${labelText} right / down`;
      downBtn.setAttribute("aria-label", `Move ${labelText} down`);
      downBtn.disabled = index === currentOrder.length - 1;
      downBtn.addEventListener("click", () => moveOption(1));
      controls.append(upBtn, downBtn);
      row.append(left, controls);
      orderList.append(row);
    });
    const resetWrap = document.createElement("div");
    resetWrap.className = "gg-row";
    const resetHint = document.createElement("span");
    resetHint.className = "gg-muted";
    resetHint.textContent = "Restore default button order & alignment";
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "gg-btn-sm";
    resetBtn.dataset.ggFocusKey = "reset-layout";
    resetBtn.textContent = "Reset layout";
    resetBtn.addEventListener("click", () => {
      this.flushPendingSaves();
      saveLayout({
        toolbarPlacement: "after_native",
        buttonOrder: [...DEFAULT_BUTTON_ORDER]
      }, { rebuildDrawer: true });
    });
    resetWrap.append(resetHint, resetBtn);
    orderField.slot.append(orderList);
    body.append(orderField.wrap, resetWrap);
  }
  renderActionSection(parent, settings, actionId, connections, connectionOptions, presetOptions, roleOptions) {
    const meta = ACTION_METADATA[actionId];
    const cfg = settings.actions[actionId];
    const card = this.createCollapsibleCard(parent, actionId, meta.label, cfg.enabled ? "Visible" : "Hidden", !cfg.enabled);
    const body = card.body;
    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent = meta.description;
    body.append(desc);
    const savePatch = (patch, options = { rebuildDrawer: false }) => {
      const base = this.currentSettings ?? settings;
      const next = {
        ...base,
        actions: {
          ...base.actions,
          [actionId]: {
            ...base.actions[actionId],
            ...patch
          }
        }
      };
      this.currentSettings = next;
      if (patch.enabled !== undefined) {
        card.setBadge(patch.enabled ? "Visible" : "Hidden", !patch.enabled);
        this.updateOrderStateTag(actionId, patch.enabled);
      }
      this.handlers.onSaveSettings(next, options);
    };
    const enableRow = document.createElement("div");
    enableRow.className = "gg-row";
    const enableLabel = document.createElement("span");
    enableLabel.className = "gg-field-label";
    enableLabel.textContent = "Show button on input bar";
    const enableSlot = document.createElement("div");
    enableRow.append(enableLabel, enableSlot);
    body.append(enableRow);
    this.handles.push(this.ctx.components.mountSwitch(enableSlot, {
      checked: cfg.enabled,
      size: "sm",
      ariaLabel: `Show ${meta.label} button on input bar`,
      onChange: (checked) => savePatch({ enabled: checked }, { rebuildDrawer: false })
    }));
    const clearRow = document.createElement("div");
    clearRow.className = "gg-row";
    const clearLabel = document.createElement("span");
    clearLabel.className = "gg-field-label";
    clearLabel.textContent = "Clear input bar when triggered";
    const clearSlot = document.createElement("div");
    clearRow.append(clearLabel, clearSlot);
    body.append(clearRow);
    this.handles.push(this.ctx.components.mountSwitch(clearSlot, {
      checked: cfg.clearInputOnRun,
      size: "sm",
      ariaLabel: `Clear input bar when running ${meta.label}`,
      onChange: (checked) => savePatch({ clearInputOnRun: checked })
    }));
    const regexRow = document.createElement("div");
    regexRow.className = "gg-row";
    const regexLabel = document.createElement("span");
    regexLabel.className = "gg-field-label";
    regexLabel.textContent = "Apply Lumiverse regex scripts";
    const regexSlot = document.createElement("div");
    regexRow.append(regexLabel, regexSlot);
    body.append(regexRow);
    this.handles.push(this.ctx.components.mountSwitch(regexSlot, {
      checked: cfg.applyRegex ?? DEFAULT_APPLY_REGEX,
      size: "sm",
      ariaLabel: `Apply Lumiverse regex scripts for ${meta.label}`,
      onChange: (checked) => savePatch({ applyRegex: checked })
    }));
    const activeConnectionId = getActiveConnectionId(this.ctx);
    let modelHandle = null;
    const connField = createFieldContainer("API Connection Profile");
    body.append(connField.wrap);
    this.handles.push(this.ctx.components.mountSelect(connField.slot, {
      options: connectionOptions,
      value: cfg.connectionId ?? "",
      ariaLabel: `${meta.label} API Connection Profile`,
      onChange: (val) => {
        const nextConnectionId = val || null;
        savePatch({ connectionId: nextConnectionId });
        modelHandle?.update({
          connection: buildModelConnectionRef(nextConnectionId),
          placeholder: buildModelPlaceholder(nextConnectionId, connections, activeConnectionId)
        });
      }
    }));
    const modelFieldId = `gg-${actionId}-model`;
    const modelField = createFieldContainer("Model (blank = connection profile model)", modelFieldId);
    body.append(modelField.wrap);
    if (typeof this.ctx.components.mountModelCombobox === "function") {
      modelHandle = this.ctx.components.mountModelCombobox(modelField.slot, {
        value: cfg.model ?? "",
        connection: buildModelConnectionRef(cfg.connectionId),
        appearance: "standard",
        autoRefreshOnFocus: true,
        placeholder: buildModelPlaceholder(cfg.connectionId, connections, activeConnectionId),
        onChange: (value) => {
          this.scheduleDebouncedSave(`${actionId}:model`, () => {
            savePatch({ model: value.trim() || null });
          });
        }
      });
      this.attachSlotInputAttributes(modelField.slot, modelFieldId, `${meta.label} Model`);
      this.handles.push(modelHandle);
    }
    const presetField = createFieldContainer("Preset");
    body.append(presetField.wrap);
    this.handles.push(this.ctx.components.mountSelect(presetField.slot, {
      options: presetOptions,
      value: cfg.presetId ?? "",
      ariaLabel: `${meta.label} Preset`,
      onChange: (val) => savePatch({ presetId: val || null })
    }));
    const roleField = createFieldContainer("Guidance Injection Role");
    body.append(roleField.wrap);
    this.handles.push(this.ctx.components.mountSelect(roleField.slot, {
      options: roleOptions,
      value: cfg.injectionRole,
      ariaLabel: `${meta.label} Guidance Injection Role`,
      onChange: (val) => savePatch({ injectionRole: val })
    }));
    const initialPosition = normalizeGuidancePosition(cfg.guidancePosition);
    const initialDepth = normalizeGuidanceDepth(cfg.guidanceDepth);
    let depthControl = null;
    const depthFieldId = `gg-${actionId}-guidance-depth`;
    const depthField = createFieldContainer("In-History Depth (0–999)", depthFieldId);
    const syncDepthFieldState = (pos) => {
      const isInHistory = pos === "in_history";
      depthField.wrap.style.display = isInHistory ? "" : "none";
      depthControl?.setDisabled(!isInHistory);
    };
    const positionField = createFieldContainer("Guidance Position");
    body.append(positionField.wrap, depthField.wrap);
    this.handles.push(this.ctx.components.mountSelect(positionField.slot, {
      options: GUIDANCE_POSITION_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        sublabel: opt.sublabel
      })),
      value: initialPosition,
      ariaLabel: `${meta.label} Guidance Position`,
      onChange: (val) => {
        const nextPosition = normalizeGuidancePosition(val);
        savePatch({ guidancePosition: nextPosition });
        syncDepthFieldState(nextPosition);
      }
    }));
    depthControl = this.mountBoundedIntegerField({
      slot: depthField.slot,
      fieldId: depthFieldId,
      ariaLabel: `${meta.label} In-history depth`,
      debounceKey: `${actionId}:depth`,
      min: 0,
      max: 999,
      defaultValue: DEFAULT_GUIDANCE_DEPTH,
      placeholder: "0",
      initialValue: initialDepth,
      disabled: initialPosition !== "in_history",
      onCommit: (guidanceDepth) => {
        savePatch({ guidanceDepth });
      }
    });
    syncDepthFieldState(initialPosition);
    const templateField = createFieldContainer("Guidance Template (supports {{input}} and Lumiverse macros like {{char}}, {{user}}; leave blank for raw input)");
    body.append(templateField.wrap);
    this.handles.push(this.ctx.components.mountTextArea(templateField.slot, {
      value: cfg.instructionTemplate,
      rows: 2,
      placeholder: "{{input}}",
      ariaLabel: `${meta.label} Guidance Template`,
      onChange: (value) => {
        this.scheduleDebouncedSave(`${actionId}:template`, () => {
          savePatch({ instructionTemplate: value });
        });
      }
    }));
  }
  mountBoundedIntegerField(options) {
    const clamp = (raw) => {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.max(options.min, Math.min(options.max, Math.floor(raw)));
      }
      return Math.max(options.min, Math.min(options.max, Math.floor(options.defaultValue)));
    };
    let currentValue = clamp(options.initialValue);
    let hasEmptyDraft = false;
    let syncingUi = false;
    let handle = null;
    let fallbackInput = null;
    const commitInput = (rawNumber) => {
      if (syncingUi)
        return;
      if (rawNumber === null) {
        hasEmptyDraft = true;
        this.cancelPendingSaveKey(options.debounceKey);
        return;
      }
      hasEmptyDraft = false;
      const normalized = clamp(rawNumber);
      currentValue = normalized;
      this.scheduleDebouncedSave(options.debounceKey, () => {
        options.onCommit(normalized);
      });
    };
    if (typeof this.ctx.components.mountNumericInput === "function") {
      handle = this.ctx.components.mountNumericInput(options.slot, {
        value: currentValue,
        min: options.min,
        max: options.max,
        step: 1,
        integer: true,
        allowEmpty: true,
        placeholder: options.placeholder,
        disabled: Boolean(options.disabled),
        ariaLabel: options.ariaLabel,
        onChange: commitInput
      });
      this.attachSlotInputAttributes(options.slot, options.fieldId, options.ariaLabel);
      options.slot.addEventListener("focusout", (event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget && options.slot.contains(nextTarget)) {
          return;
        }
        if (hasEmptyDraft || handle?.getValue() === null) {
          hasEmptyDraft = false;
          const fallbackVal = clamp(options.defaultValue);
          if (fallbackVal !== currentValue) {
            currentValue = fallbackVal;
            options.onCommit(fallbackVal);
          }
        } else {
          this.flushPendingSaveKey(options.debounceKey);
        }
        if (handle && handle.getValue() !== currentValue) {
          syncingUi = true;
          try {
            handle.update({ value: currentValue });
          } finally {
            syncingUi = false;
          }
        }
      });
      this.handles.push(handle);
    } else {
      const input = document.createElement("input");
      input.type = "number";
      input.id = options.fieldId;
      input.className = "gg-input-sm";
      input.min = String(options.min);
      input.max = String(options.max);
      input.step = "1";
      input.placeholder = options.placeholder;
      input.value = String(currentValue);
      input.disabled = Boolean(options.disabled);
      input.setAttribute("aria-label", options.ariaLabel);
      input.addEventListener("input", () => {
        const raw = input.value.trim();
        const parsed = raw === "" ? null : Number(raw);
        commitInput(parsed !== null && Number.isFinite(parsed) ? parsed : null);
      });
      input.addEventListener("blur", () => {
        if (hasEmptyDraft || input.value.trim() === "") {
          hasEmptyDraft = false;
          const fallbackVal = clamp(options.defaultValue);
          if (fallbackVal !== currentValue) {
            currentValue = fallbackVal;
            options.onCommit(fallbackVal);
          }
        } else {
          this.flushPendingSaveKey(options.debounceKey);
        }
        input.value = String(currentValue);
      });
      fallbackInput = input;
      options.slot.append(input);
    }
    return {
      setDisabled: (disabled) => {
        if (handle) {
          syncingUi = true;
          try {
            handle.update({ disabled });
          } finally {
            syncingUi = false;
          }
        }
        if (fallbackInput) {
          fallbackInput.disabled = disabled;
        }
      }
    };
  }
  updateOrderStateTag(optionId, visible) {
    const tag = this.orderStateTags.get(optionId);
    if (tag) {
      tag.textContent = visible ? "Visible" : "Hidden";
    }
  }
  renderRecoverySection(parent, settings, recovery) {
    const card = this.createCollapsibleCard(parent, "input_recovery", "Input Recovery", recovery.length > 0 ? String(recovery.length) : undefined, recovery.length === 0);
    const body = card.body;
    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent = "Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click. When no saved inputs exist, clicking Input Recovery clears the current input.";
    body.append(desc);
    const enableRow = document.createElement("div");
    enableRow.className = "gg-row";
    const enableLabel = document.createElement("span");
    enableLabel.className = "gg-field-label";
    enableLabel.textContent = "Enable Input Recovery & toolbar button";
    const enableSlot = document.createElement("div");
    enableRow.append(enableLabel, enableSlot);
    body.append(enableRow);
    this.handles.push(this.ctx.components.mountSwitch(enableSlot, {
      checked: settings.inputRecovery.enabled,
      size: "sm",
      ariaLabel: "Show Input Recovery button on input bar",
      onChange: (checked) => {
        const base = this.currentSettings ?? settings;
        const next = {
          ...base,
          inputRecovery: { ...base.inputRecovery, enabled: checked }
        };
        this.currentSettings = next;
        this.updateOrderStateTag("input_recovery", checked);
        this.handlers.onSaveSettings(next, { rebuildDrawer: false });
      }
    }));
    const maxEntriesFieldId = "gg-recovery-max-entries";
    const maxEntriesField = createFieldContainer("Max saved drafts (1–50)", maxEntriesFieldId);
    body.append(maxEntriesField.wrap);
    this.mountBoundedIntegerField({
      slot: maxEntriesField.slot,
      fieldId: maxEntriesFieldId,
      ariaLabel: "Max saved drafts",
      debounceKey: "recovery:maxEntries",
      min: 1,
      max: 50,
      defaultValue: 10,
      placeholder: "10",
      initialValue: settings.inputRecovery.maxEntries,
      onCommit: (maxEntries) => {
        const base = this.currentSettings ?? settings;
        const next = {
          ...base,
          inputRecovery: { ...base.inputRecovery, maxEntries }
        };
        this.currentSettings = next;
        if (this.recoveryUi) {
          this.recoveryUi.maxEntries = maxEntries;
          this.recoveryUi.countLabel.textContent = this.recoveryUi.recoveryCount > 0 ? `Saved inputs (${this.recoveryUi.recoveryCount}/${maxEntries}):` : "No saved inputs yet.";
        }
        this.handlers.onSaveSettings(next, { rebuildDrawer: false });
      }
    });
    const controlsRow = document.createElement("div");
    controlsRow.className = "gg-row";
    const countLabel = document.createElement("span");
    countLabel.className = "gg-muted";
    countLabel.textContent = recovery.length > 0 ? `Saved inputs (${recovery.length}/${settings.inputRecovery.maxEntries}):` : "No saved inputs yet.";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "gg-btn-sm";
    clearBtn.dataset.ggFocusKey = "clear-recovery";
    clearBtn.textContent = "Clear History";
    clearBtn.disabled = this.recoveryBusy || recovery.length === 0;
    clearBtn.addEventListener("click", () => {
      this.handlers.onClearRecovery();
    });
    controlsRow.append(countLabel, clearBtn);
    body.append(controlsRow);
    this.recoveryUi = {
      setBadge: card.setBadge,
      countLabel,
      clearBtn,
      body,
      listEl: null,
      maxEntries: settings.inputRecovery.maxEntries,
      recoveryCount: recovery.length
    };
    this.syncRecoveryList(recovery);
  }
  syncRecoveryList(recovery) {
    if (!this.recoveryUi)
      return;
    if (this.recoveryUi.listEl) {
      this.recoveryUi.listEl.remove();
      this.recoveryUi.listEl = null;
    }
    if (recovery.length === 0)
      return;
    const list = document.createElement("div");
    list.className = "gg-recovery-list";
    for (const entry of recovery) {
      const row = document.createElement("div");
      row.className = "gg-recovery-item";
      const meta = document.createElement("div");
      meta.className = "gg-recovery-meta";
      const actionLabel = ACTION_METADATA[entry.actionId]?.label ?? entry.actionId;
      const tag = document.createElement("span");
      tag.className = "gg-recovery-tag";
      tag.textContent = actionLabel;
      const snippet = document.createElement("span");
      snippet.className = "gg-recovery-snippet";
      snippet.textContent = formatRecoverySnippet(entry.text);
      snippet.title = entry.text;
      meta.append(tag, snippet);
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "gg-btn-sm";
      restoreBtn.textContent = "Restore";
      restoreBtn.disabled = this.recoveryBusy;
      restoreBtn.setAttribute("aria-label", `Restore ${actionLabel} draft: ${formatRecoverySnippet(entry.text, 40)}`);
      restoreBtn.addEventListener("click", () => this.handlers.onRestoreEntry(entry));
      row.append(meta, restoreBtn);
      list.append(row);
    }
    this.recoveryUi.listEl = list;
    this.recoveryUi.body.append(list);
  }
  attachSlotInputAttributes(slot, fieldId, ariaLabel) {
    const apply = () => {
      const input = slot.querySelector("input");
      if (!input)
        return false;
      if (!input.id)
        input.id = fieldId;
      if (!input.getAttribute("aria-label")) {
        input.setAttribute("aria-label", ariaLabel);
      }
      return true;
    };
    if (apply() || typeof MutationObserver !== "function")
      return;
    const observer = new MutationObserver(() => {
      if (apply()) {
        observer.disconnect();
      }
    });
    observer.observe(slot, { childList: true, subtree: true });
    this.handles.push({
      destroy: () => observer.disconnect()
    });
  }
  scheduleDebouncedSave(key, fn, delayMs = 250) {
    const prev = this.debounceTimers.get(key);
    if (prev)
      clearTimeout(prev.timer);
    const flush = () => {
      if (this.destroyed)
        return;
      fn();
    };
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      flush();
      this.flushPendingViewIfIdle();
    }, delayMs);
    this.debounceTimers.set(key, { timer, flush });
  }
  flushPendingSaves() {
    if (this.destroyed || this.debounceTimers.size === 0)
      return;
    const entries = Array.from(this.debounceTimers.entries());
    this.debounceTimers.clear();
    for (const [, entry] of entries) {
      clearTimeout(entry.timer);
      entry.flush();
    }
  }
  flushPendingSaveKey(key) {
    if (this.destroyed)
      return;
    const entry = this.debounceTimers.get(key);
    if (!entry)
      return;
    this.debounceTimers.delete(key);
    clearTimeout(entry.timer);
    entry.flush();
  }
  cancelPendingSaveKey(key) {
    const entry = this.debounceTimers.get(key);
    if (!entry)
      return;
    this.debounceTimers.delete(key);
    clearTimeout(entry.timer);
  }
  cancelPendingSaves() {
    for (const entry of this.debounceTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.debounceTimers.clear();
  }
  clearComponentHandles() {
    for (const handle of this.handles) {
      handle.destroy();
    }
    this.handles = [];
  }
  destroy() {
    this.flushPendingSaves();
    this.destroyed = true;
    this.pendingView = null;
    this.pendingFocusRestore = null;
    this.pendingGeneralFocusRestore = null;
    this.pointerActiveInDrawer = false;
    if (this.pointerFallbackTimer !== null) {
      clearTimeout(this.pointerFallbackTimer);
      this.pointerFallbackTimer = null;
    }
    if (this.pendingViewFlushTimer !== null) {
      clearTimeout(this.pendingViewFlushTimer);
      this.pendingViewFlushTimer = null;
    }
    if (this.pointerReleaseCleanup) {
      const cleanup = this.pointerReleaseCleanup;
      this.pointerReleaseCleanup = null;
      cleanup();
    }
    this.rootEl = null;
    this.headerEl = null;
    this.noticeEl = null;
    this.recoveryUi = null;
    this.orderStateTags.clear();
    this.tab.root.removeEventListener("pointerdown", this.onPointerDownInDrawer);
    this.tab.root.removeEventListener("mousedown", this.onPointerDownInDrawer);
    this.tab.root.removeEventListener("focusout", this.onFocusOut);
    this.cancelPendingSaves();
    this.clearComponentHandles();
    this.tab.root.replaceChildren();
    this.tab.destroy();
  }
}
function isElementNode(value) {
  return Boolean(value && typeof value === "object" && value.nodeType === 1);
}
function isEditableElement(el) {
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
function isClickableInside(root, node) {
  if (!isElementNode(node) || !root.contains(node))
    return false;
  return Boolean(node.closest('button, [role="button"], [role="switch"], [role="menuitem"], [role="option"], summary, a[href]'));
}
function findElementByAttribute(root, attrName, attrValue, tagName) {
  const selector = tagName ? tagName.toLowerCase() : "*";
  for (const el of root.querySelectorAll(selector)) {
    if (el.getAttribute(attrName) === attrValue) {
      return el;
    }
  }
  return null;
}
function getActiveConnectionId(ctx) {
  const conns = ctx.connections;
  return conns?.getActive?.()?.activeProfileId ?? null;
}
function buildModelConnectionRef(connectionId) {
  return connectionId ? { kind: "llm", id: connectionId } : { kind: "llm" };
}
function buildModelPlaceholder(configuredConnectionId, connections, activeConnectionId) {
  const target = configuredConnectionId ? connections.find((c) => c.id === configuredConnectionId) : (activeConnectionId ? connections.find((c) => c.id === activeConnectionId) : undefined) ?? connections.find((c) => c.isDefault) ?? connections[0];
  const currentModel = target?.model?.trim();
  return currentModel ? `Use connection model (${currentModel})` : "Leave blank for connection model";
}
var fieldLabelSeq = 0;
function createFieldContainer(labelText, fieldId) {
  const wrap = document.createElement("div");
  wrap.className = "gg-field";
  const label = document.createElement("label");
  label.className = "gg-field-label";
  label.id = `gg-field-label-${++fieldLabelSeq}`;
  if (fieldId)
    label.htmlFor = fieldId;
  label.textContent = labelText;
  const slot = document.createElement("div");
  wrap.append(label, slot);
  return { wrap, slot, label };
}
function buildConnectionOptions(connections) {
  return [
    {
      value: "",
      label: "Use Active Connection",
      sublabel: "Inherits whichever connection profile is currently active"
    },
    ...connections.map((conn) => ({
      value: conn.id,
      label: conn.name,
      sublabel: conn.model ? `${conn.provider} · ${conn.model}` : conn.provider
    }))
  ];
}
function buildPresetOptions(presets) {
  return [
    {
      value: "",
      label: "Use Active Preset",
      sublabel: "Inherits the active chat or connection preset"
    },
    ...presets.map((preset) => ({
      value: preset.id,
      label: preset.name
    }))
  ];
}

// src/frontend/streaming-indicator.ts
var INDICATOR_ACTIONS = new Set([
  "guided_response",
  "guided_regenerate",
  "guided_swipe",
  "guided_continue"
]);
var INDICATOR_HTML_BEFORE = '<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';
var INDICATOR_HTML_AFTER = '<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';
var MAX_RAF_RETRIES = 30;
var MAX_RUN_STATE_CACHE = 32;
function isRecord3(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class StreamingIndicatorController {
  ctx;
  disposers = [];
  runStateById = new Map;
  currentRun = null;
  viewedSwipeId = undefined;
  swipeInitialized = false;
  contentSeen = false;
  mountedEl = null;
  mountedTarget = null;
  mountedPosition = null;
  rafId = null;
  rafTimerId = null;
  rafRetries = 0;
  retryMode = null;
  destroyed = false;
  constructor(ctx) {
    this.ctx = ctx;
    if (typeof this.ctx.events?.on === "function") {
      const handleChatEvent = () => {
        if (!this.destroyed) {
          this.rafRetries = 0;
          this.syncCurrent();
        }
      };
      this.disposers.push(this.ctx.events.on("MESSAGE_SWIPED", (rawPayload) => {
        this.onMessageEvent(rawPayload, "MESSAGE_SWIPED");
      }), this.ctx.events.on("MESSAGE_EDITED", (rawPayload) => {
        this.onMessageEvent(rawPayload, "MESSAGE_EDITED");
      }), this.ctx.events.on("MESSAGE_SENT", (rawPayload) => {
        this.onMessageEvent(rawPayload, "MESSAGE_SENT");
      }), this.ctx.events.on("CHAT_CHANGED", handleChatEvent), this.ctx.events.on("CHAT_SWITCHED", handleChatEvent));
    }
  }
  sync(run) {
    if (this.destroyed)
      return;
    const prevRun = this.currentRun;
    if (prevRun) {
      this.saveRunState(prevRun.runId);
    }
    const runIdentityChanged = prevRun?.runId !== run?.runId || prevRun?.messageId !== run?.messageId || prevRun?.actionId !== run?.actionId;
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
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.resetRetry();
    this.unmount();
    this.currentRun = null;
    this.runStateById.clear();
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {}
    }
    this.disposers.length = 0;
  }
  saveRunState(runId) {
    if (!runId)
      return;
    if (this.runStateById.has(runId)) {
      this.runStateById.delete(runId);
    }
    this.runStateById.set(runId, {
      viewedSwipeId: this.viewedSwipeId,
      swipeInitialized: this.swipeInitialized,
      contentSeen: this.contentSeen
    });
    if (this.runStateById.size > MAX_RUN_STATE_CACHE) {
      const oldestKey = this.runStateById.keys().next().value;
      if (oldestKey !== undefined) {
        this.runStateById.delete(oldestKey);
      }
    }
  }
  onMessageEvent(rawPayload, eventType) {
    if (this.destroyed || !this.currentRun?.messageId)
      return;
    const payload = isRecord3(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord3(payload.message) ? payload.message : null;
    const eventMessageId = typeof msg?.id === "string" ? msg.id : typeof payload?.messageId === "string" ? payload.messageId : undefined;
    if (eventMessageId === this.currentRun.messageId) {
      const nextSwipeId = typeof msg?.swipe_id === "number" ? msg.swipe_id : typeof payload?.swipeId === "number" ? payload.swipeId : undefined;
      if (nextSwipeId !== undefined) {
        this.viewedSwipeId = nextSwipeId;
        this.swipeInitialized = true;
      }
      const hasText = typeof msg?.content === "string" && msg.content.length > 0;
      if (hasText && (this.currentRun.swipeId == null || this.viewedSwipeId === this.currentRun.swipeId || this.viewedSwipeId === undefined)) {
        this.contentSeen = true;
      }
      this.saveRunState(this.currentRun.runId);
      if (eventType === "MESSAGE_SWIPED" || this.retryMode === "content") {
        this.rafRetries = 0;
      }
    }
    this.syncCurrent();
  }
  syncCurrent() {
    if (this.destroyed)
      return;
    const run = this.currentRun;
    if (!this.shouldDisplay(run)) {
      this.resetRetry();
      this.unmount();
      return;
    }
    if (typeof this.ctx.dom?.findMessageElement !== "function" || typeof this.ctx.dom?.inject !== "function") {
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
    if (this.mountedEl && this.mountedTarget === target.element && this.mountedPosition === target.position && this.isMountedAt(this.mountedEl, target.element, target.position)) {
      if (!target.isMessageContent && expectMessageContent) {
        this.ensureRetryMode("content");
        this.scheduleRetry();
      } else {
        this.resetRetry();
      }
      return;
    }
    this.unmount();
    const html = target.isMessageContent ? INDICATOR_HTML_AFTER : INDICATOR_HTML_BEFORE;
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
  shouldDisplay(run) {
    if (!run || this.destroyed)
      return false;
    if (!INDICATOR_ACTIONS.has(run.actionId))
      return false;
    if (typeof run.messageId !== "string" || run.messageId.length === 0) {
      return false;
    }
    const activeChatId = this.safeGetActiveChatId();
    if (!activeChatId || run.chatId !== activeChatId)
      return false;
    if (run.actionId === "guided_swipe") {
      if (typeof run.swipeId !== "number" || this.viewedSwipeId !== run.swipeId) {
        return false;
      }
    } else if (run.swipeId != null && this.viewedSwipeId !== run.swipeId) {
      return false;
    }
    return true;
  }
  safeGetActiveChatId() {
    try {
      return this.ctx.getActiveChat?.().chatId ?? null;
    } catch {
      return null;
    }
  }
  isMountedAt(el, target, position) {
    if (position === "afterend") {
      return target.parentNode !== null && target.nextElementSibling === el;
    }
    if (position === "beforebegin") {
      return target.parentNode !== null && target.previousElementSibling === el;
    }
    return target.contains(el);
  }
  resolveTarget(messageId, actionId) {
    if (typeof this.ctx.dom?.findMessageElement !== "function")
      return null;
    const row = this.ctx.dom.findMessageElement(messageId);
    if (!row)
      return null;
    const messageContent = row.querySelector('[data-component="MessageContent"]');
    if (messageContent) {
      return {
        element: messageContent,
        position: "afterend",
        isMessageContent: true
      };
    }
    if (actionId === "guided_continue") {
      return this.resolveContinueFallbackTarget(row);
    }
    const mountBefore = row.querySelector('[data-spindle-mount="message_body_before"]');
    if (mountBefore) {
      return {
        element: mountBefore,
        position: "beforeend",
        isMessageContent: false
      };
    }
    const mountAfter = row.querySelector('[data-spindle-mount="message_body_after"]');
    if (mountAfter) {
      return {
        element: mountAfter,
        position: "beforeend",
        isMessageContent: false
      };
    }
    const bubbleFallback = row.querySelector('[data-component="BubbleMessage"] > div > div:last-child');
    if (bubbleFallback) {
      return {
        element: bubbleFallback,
        position: "beforeend",
        isMessageContent: false
      };
    }
    if (typeof row.matches === "function" && row.matches('[data-component="BubbleMessage"]')) {
      const el = row.firstElementChild?.lastElementChild;
      return el ? { element: el, position: "beforeend", isMessageContent: false } : null;
    }
    const minimalFallback = row.querySelector('[data-component="MinimalMessage"] > div');
    if (minimalFallback) {
      return {
        element: minimalFallback,
        position: "beforeend",
        isMessageContent: false
      };
    }
    if (typeof row.matches === "function" && row.matches('[data-component="MinimalMessage"]')) {
      const el = row.firstElementChild;
      return el ? { element: el, position: "beforeend", isMessageContent: false } : null;
    }
    return null;
  }
  resolveContinueFallbackTarget(row) {
    const mountAfter = row.querySelector('[data-spindle-mount="message_body_after"]');
    if (mountAfter) {
      return {
        element: mountAfter,
        position: "beforeend",
        isMessageContent: false
      };
    }
    const mountBefore = row.querySelector('[data-spindle-mount="message_body_before"]');
    if (mountBefore) {
      return {
        element: mountBefore,
        position: "beforeend",
        isMessageContent: false
      };
    }
    const bubbleContent = row.querySelector('[data-component="BubbleMessage"] [class*="content"]');
    if (bubbleContent) {
      return {
        element: bubbleContent,
        position: "beforeend",
        isMessageContent: false
      };
    }
    if (typeof row.matches === "function" && row.matches('[data-component="BubbleMessage"]')) {
      const ownContent = row.querySelector('[class*="content"]') ?? row.firstElementChild?.lastElementChild;
      if (ownContent) {
        return {
          element: ownContent,
          position: "beforeend",
          isMessageContent: false
        };
      }
    }
    const bubbleFallback = row.querySelector('[data-component="BubbleMessage"] > div > div:last-child');
    if (bubbleFallback) {
      return {
        element: bubbleFallback,
        position: "beforeend",
        isMessageContent: false
      };
    }
    const minimalFallback = row.querySelector('[data-component="MinimalMessage"] > div');
    if (minimalFallback) {
      return {
        element: minimalFallback,
        position: "beforeend",
        isMessageContent: false
      };
    }
    if (typeof row.matches === "function" && row.matches('[data-component="MinimalMessage"]') && row.firstElementChild) {
      return {
        element: row.firstElementChild,
        position: "beforeend",
        isMessageContent: false
      };
    }
    return { element: row, position: "beforeend", isMessageContent: false };
  }
  ensureRetryMode(mode) {
    if (this.retryMode !== mode) {
      this.cancelRetry();
      this.rafRetries = 0;
      this.retryMode = mode;
    }
  }
  resetRetry() {
    this.cancelRetry();
    this.rafRetries = 0;
    this.retryMode = null;
  }
  unmount() {
    const el = this.mountedEl;
    this.mountedEl = null;
    this.mountedTarget = null;
    this.mountedPosition = null;
    if (!el)
      return;
    try {
      if (typeof this.ctx.dom?.uninject === "function") {
        this.ctx.dom.uninject(el);
      } else {
        el.remove();
      }
    } catch {}
  }
  scheduleRetry() {
    if (this.destroyed || this.rafId !== null || this.rafTimerId !== null) {
      return;
    }
    if (this.rafRetries >= MAX_RAF_RETRIES)
      return;
    this.rafRetries += 1;
    const raf = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame.bind(globalThis) : undefined;
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
  cancelRetry() {
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

// src/frontend/styles.ts
var GUIDED_GENERATIONS_CSS = `
.gg-actions-host {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
}

.gg-actions-host.is-before-native {
  order: -1;
}

.gg-actions-host.is-right {
  margin-left: auto;
}

.gg-actions-host--row {
  display: flex;
  align-items: center;
  max-width: 100%;
  flex-wrap: wrap;
}

.gg-actions-host .gg-toolbar,
.gg-actions-host--row .gg-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  flex-wrap: nowrap;
}

.gg-actions-host--row .gg-toolbar {
  flex-wrap: wrap;
}

.gg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, rgba(230, 230, 240, 0.45));
  cursor: pointer;
  transition:
    color var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    transform 90ms ease;
}

.gg-btn:hover:not(:disabled) {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(230, 230, 240, 0.92));
}

.gg-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.gg-btn.is-holding {
  background: rgba(139, 92, 246, 0.22);
  color: var(--lumiverse-primary, #c4b5fd);
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35);
  transform: scale(0.92);
}

.gg-btn.is-running {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
  animation: gg-pulse 1.3s ease-in-out infinite;
}

.gg-btn.is-dimmed,
.gg-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.gg-btn svg {
  width: 14px;
  height: 14px;
  pointer-events: none;
  display: block;
}

@media (max-width: 768px) {
  .gg-btn {
    width: 28px;
  }
}

@keyframes gg-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.35); }
  50% { box-shadow: 0 0 0 4px rgba(248, 113, 113, 0); }
}

/* Settings Drawer */
.gg-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font-size: 13px;
}

.gg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.gg-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.gg-muted {
  margin: 4px 0 0;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.68)));
  font-size: 12px;
  line-height: 1.4;
}

.gg-notice {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(59, 130, 246, 0.38);
  background: rgba(59, 130, 246, 0.12);
  font-size: 12px;
  line-height: 1.4;
}

.gg-notice.is-error {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}

.gg-notice.is-warn {
  border-color: rgba(245, 158, 11, 0.48);
  background: rgba(245, 158, 11, 0.14);
  color: #fde68a;
}

.gg-section-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
}

.gg-card {
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  overflow: visible;
}

.gg-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
}

.gg-card-header:hover {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.06));
}

.gg-card-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.gg-card-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  transition: transform 140ms ease;
  opacity: 0.72;
}

.gg-card.is-expanded .gg-card-chevron {
  transform: rotate(90deg);
}

.gg-card-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.16);
  color: var(--lumiverse-primary, #c4b5fd);
}

.gg-card-badge.is-muted {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
}

.gg-card-body-wrap {
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
}

.gg-card:not(.is-expanded) .gg-card-body-wrap {
  display: none;
}

.gg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.gg-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gg-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-secondary, rgba(229, 231, 235, 0.85)));
}

.gg-btn-sm {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.16)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.08)));
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gg-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--surface-hover, rgba(255, 255, 255, 0.15)));
}

.gg-btn-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-input-sm {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.16)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.06)));
  color: inherit;
  font: inherit;
  font-size: 12.5px;
}

.gg-input-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-recovery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-recovery-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  background: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16));
}

.gg-recovery-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.gg-recovery-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-recovery-snippet {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  background: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16));
}

.gg-order-item-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.gg-order-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.78)));
}

.gg-order-item-icon svg {
  width: 14px;
  height: 14px;
  display: block;
}

.gg-order-item-label {
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-item-state {
  font-size: 10.5px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.55)));
}

.gg-order-item-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.gg-icon-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.14)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.06)));
  color: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.gg-icon-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--surface-hover, rgba(255, 255, 255, 0.14)));
}

.gg-icon-btn-sm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Guided Continue Drop-Up Menu (portaled to document.body) */
.gg-dropup-menu {
  position: fixed;
  z-index: 11000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 210px;
  max-width: calc((100vw - 16px) / var(--lumiverse-ui-scale, 1));
  padding: 4px;
  border-radius: var(--lcs-radius-md, 10px);
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.14)));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
}

.gg-dropup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.gg-dropup-item:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
}

.gg-dropup-item:focus-visible {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  outline: 2px solid var(--lumiverse-primary, var(--accent-primary, #8b5cf6));
  outline-offset: -2px;
}

.gg-dropup-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  pointer-events: none;
  display: block;
  color: var(--lumiverse-primary, var(--accent-primary, currentColor));
}

.gg-dropup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  margin-bottom: 2px;
}

.gg-dropup-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.75)));
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
}

.gg-dropup-back:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
}

.gg-dropup-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
  padding-right: 4px;
}

.gg-dropup-history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-dropup-history-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 220px;
  max-width: 300px;
}

.gg-dropup-history-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-dropup-history-snippet {
  font-size: 12.5px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-dropup-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
  text-align: center;
}


/* Streaming Indicator */
.gg-streaming-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.gg-streaming-indicator--after {
  margin-top: 4px;
}

.gg-streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  animation: gg-streaming-bounce 1.2s ease-in-out infinite;
}

.gg-streaming-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.gg-streaming-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes gg-streaming-bounce {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

/* Floating Chat Heads */
.gg-chat-heads-root {
  position: fixed;
  z-index: 10950;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 6px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  scrollbar-width: none;
  transform: translate(-50%, -50%);
  user-select: none;
  touch-action: none;
}

.gg-chat-heads-root::-webkit-scrollbar {
  display: none;
}

.gg-chat-head-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gg-chat-head-dismiss {
  position: absolute;
  top: -4px;
  left: -4px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.25));
  background: var(--lumiverse-bg-deep, #18181f);
  color: var(--lumiverse-text, #e5e7eb);
  font-size: 11px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
  z-index: 1;
}

.gg-chat-head-item:hover .gg-chat-head-dismiss,
.gg-chat-head-item:focus-within .gg-chat-head-dismiss {
  opacity: 1;
  transform: scale(1);
}

.gg-chat-head-dismiss:hover {
  background: var(--lumiverse-danger, #ef4444);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

.gg-chat-head {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  transition:
    transform 140ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.gg-chat-head:hover {
  transform: scale(1.06);
}

.gg-chat-head:active {
  transform: scale(0.96);
}

.gg-chat-head.is-running {
  border-color: var(--lumiverse-warning, #f59e0b);
  box-shadow:
    0 0 0 3px rgba(245, 158, 11, 0.24),
    0 8px 24px rgba(0, 0, 0, 0.45);
  animation: gg-chat-head-pulse 1.5s ease-in-out infinite;
}

.gg-chat-head.is-streaming {
  border-color: var(--lumiverse-primary, #8b5cf6);
  box-shadow:
    0 0 0 3px rgba(139, 92, 246, 0.28),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-completed {
  border-color: var(--lumiverse-success, #22c55e);
  box-shadow:
    0 0 0 3px rgba(34, 197, 94, 0.3),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
  display: block;
}

.gg-chat-head-initials {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--lumiverse-text, #e5e7eb);
  pointer-events: none;
}

.gg-chat-head-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-warning, #f59e0b);
  pointer-events: none;
}

.gg-chat-head.is-streaming .gg-chat-head-badge {
  background: var(--lumiverse-primary, #8b5cf6);
}

.gg-chat-head.is-completed .gg-chat-head-badge {
  background: var(--lumiverse-success, #22c55e);
}

.gg-chat-head-pip {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-danger, #ef4444);
  pointer-events: none;
}

@keyframes gg-chat-head-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 2px rgba(139, 92, 246, 0.22),
      0 8px 24px rgba(0, 0, 0, 0.45);
  }
  50% {
    box-shadow:
      0 0 0 6px rgba(139, 92, 246, 0.08),
      0 8px 24px rgba(0, 0, 0, 0.45);
  }
}
`;

// src/frontend.ts
function isRecord4(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function areJsonValuesEqual(a, b) {
  if (Object.is(a, b))
    return true;
  if (typeof a !== typeof b || a === null || b === null)
    return false;
  if (typeof a !== "object")
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0;i < a.length; i += 1) {
      if (!areJsonValuesEqual(a[i], b[i]))
        return false;
    }
    return true;
  }
  const recA = a;
  const recB = b;
  const keysA = Object.keys(recA);
  const keysB = Object.keys(recB);
  if (keysA.length !== keysB.length)
    return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(recB, key))
      return false;
    if (!areJsonValuesEqual(recA[key], recB[key]))
      return false;
  }
  return true;
}
function extractChatIdFromPayload(rawPayload) {
  if (!isRecord4(rawPayload))
    return null;
  if (typeof rawPayload.chatId === "string" && rawPayload.chatId) {
    return rawPayload.chatId;
  }
  if (isRecord4(rawPayload.chat) && typeof rawPayload.chat.id === "string") {
    return rawPayload.chat.id;
  }
  return null;
}
function extractDeletedChatIdFromPayload(rawPayload) {
  const fromChat = extractChatIdFromPayload(rawPayload);
  if (fromChat)
    return fromChat;
  if (isRecord4(rawPayload) && typeof rawPayload.id === "string" && rawPayload.id) {
    return rawPayload.id;
  }
  return null;
}
function mapConnectionProfiles(next, profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0)
    return next;
  return {
    ...next,
    connections: profiles.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider ?? "",
      model: c.model ?? "",
      isDefault: Boolean(c.is_default)
    }))
  };
}
async function withFrontendConnectionFallback(next, ctx) {
  if (next.connections.length > 0 || !ctx.connections?.list)
    return next;
  try {
    const raw = ctx.connections.list();
    if (raw && typeof raw.then === "function") {
      const profiles = await raw;
      return mapConnectionProfiles(next, profiles);
    }
    return mapConnectionProfiles(next, raw);
  } catch {
    return next;
  }
}
function setup(rawCtx) {
  const ctx = rawCtx;
  const removeStyle = ctx.dom.addStyle(GUIDED_GENERATIONS_CSS);
  const disposers = [];
  let destroyed = false;
  let seq = 0;
  let bootstrapSeq = 0;
  let settingsRevision = 0;
  let statusSeq = 0;
  let globalClearSeq = 0;
  let isPreChatLaunching = false;
  const launchingChats = new Set;
  let view = null;
  let activeRun = null;
  const activeRunsByChat = new Map;
  const chatStatusSeq = new Map;
  const pendingImpersonateDrafts = new Map;
  const IMPERSONATE_DRAFT_RETRY_DELAYS_MS = [0, 20, 50, 100, 200];
  let impersonateDraftRetryTimer;
  let impersonateDraftRetryChatId = null;
  let impersonateDraftRetryAttempt = 0;
  let noticeTimer;
  let composerAlertMount = null;
  try {
    composerAlertMount = ctx.ui.mount("chat_composer_above");
  } catch {
    composerAlertMount = null;
  }
  function getActiveRunForChat(chatId) {
    if (!chatId)
      return null;
    return activeRunsByChat.get(chatId) ?? (activeRun?.chatId === chatId ? activeRun : null);
  }
  function isChatBusy(chatId) {
    if (!chatId)
      return false;
    return Boolean(getActiveRunForChat(chatId)) || launchingChats.has(chatId);
  }
  function syncPrimaryActiveRun() {
    const currentChatId = ctx.getActiveChat().chatId;
    if (currentChatId && activeRunsByChat.has(currentChatId)) {
      activeRun = activeRunsByChat.get(currentChatId);
      return;
    }
    let latest = null;
    for (const run of activeRunsByChat.values()) {
      if (!latest || run.startedAt >= latest.startedAt) {
        latest = run;
      }
    }
    activeRun = latest;
  }
  function clearImpersonateDraftRetry() {
    if (impersonateDraftRetryTimer !== undefined) {
      clearTimeout(impersonateDraftRetryTimer);
      impersonateDraftRetryTimer = undefined;
    }
    impersonateDraftRetryChatId = null;
    impersonateDraftRetryAttempt = 0;
  }
  function scheduleImpersonateDraftRetry(chatId) {
    if (destroyed)
      return;
    if (impersonateDraftRetryChatId !== chatId) {
      clearImpersonateDraftRetry();
      impersonateDraftRetryChatId = chatId;
      impersonateDraftRetryAttempt = 0;
    }
    if (impersonateDraftRetryTimer !== undefined)
      return;
    const delayMs = IMPERSONATE_DRAFT_RETRY_DELAYS_MS[impersonateDraftRetryAttempt];
    if (delayMs === undefined)
      return;
    impersonateDraftRetryAttempt += 1;
    impersonateDraftRetryTimer = setTimeout(() => {
      impersonateDraftRetryTimer = undefined;
      if (destroyed)
        return;
      applyPendingImpersonateDraft(chatId, { fromRetry: true });
    }, delayMs);
  }
  function applyPendingImpersonateDraft(chatId, options = {}) {
    if (destroyed || !chatId)
      return;
    const draft = pendingImpersonateDrafts.get(chatId);
    if (draft === undefined) {
      if (impersonateDraftRetryChatId === chatId) {
        clearImpersonateDraftRetry();
      }
      return;
    }
    const state = safeGetComposerState();
    const activeChatId = ctx.getActiveChat().chatId;
    if (activeChatId !== chatId) {
      if (impersonateDraftRetryChatId === chatId) {
        clearImpersonateDraftRetry();
      }
      return;
    }
    if (!isComposerAvailable(state) || state.chatId !== chatId) {
      if (!options.fromRetry) {
        clearImpersonateDraftRetry();
      }
      scheduleImpersonateDraftRetry(chatId);
      return;
    }
    clearImpersonateDraftRetry();
    if (state.text.trim().length > 0) {
      return;
    }
    if (safeSetComposerText(draft)) {
      pendingImpersonateDrafts.delete(chatId);
      safeFocusComposer();
    }
  }
  function safeGetComposerState() {
    if (destroyed)
      return null;
    try {
      return ctx.composer?.getState?.() ?? null;
    } catch {
      return null;
    }
  }
  function isComposerAvailable(state) {
    return Boolean(state) && state.mounted !== false;
  }
  function safeSetComposerText(text) {
    if (destroyed)
      return false;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state))
      return false;
    try {
      ctx.composer.setText(text);
      return true;
    } catch {
      return false;
    }
  }
  function safeFocusComposer() {
    if (destroyed)
      return false;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state))
      return false;
    try {
      ctx.composer.focus();
      return true;
    } catch {
      return false;
    }
  }
  const pending = new Map;
  function rpc(action, input, timeoutMs = 30000) {
    if (destroyed)
      return Promise.reject(new Error("Extension unloaded."));
    const requestId = `gg-${++seq}-${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out waiting for ${action}.`));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: (value) => resolve(value),
        reject,
        timer
      });
      ctx.sendToBackend({
        type: "gg:rpc",
        requestId,
        action,
        input
      });
    });
  }
  function showBanner(text, kind = "info", ephemeralMs = 5000) {
    if (destroyed)
      return;
    drawer.setNotice(text, kind);
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    if (composerAlertMount) {
      if (!text) {
        composerAlertMount.replaceChildren();
      } else {
        const banner = document.createElement("div");
        banner.className = `gg-notice${kind === "error" ? " is-error" : kind === "warn" ? " is-warn" : ""}`;
        if (kind === "error" || kind === "warn") {
          banner.setAttribute("role", "alert");
          banner.setAttribute("aria-live", "assertive");
        } else {
          banner.setAttribute("role", "status");
          banner.setAttribute("aria-live", "polite");
        }
        banner.style.margin = "4px 12px";
        banner.textContent = text;
        composerAlertMount.replaceChildren(banner);
      }
    }
    if (text && ephemeralMs > 0) {
      noticeTimer = setTimeout(() => {
        noticeTimer = undefined;
        if (destroyed)
          return;
        drawer.setNotice("", "info");
        composerAlertMount?.replaceChildren();
      }, ephemeralMs);
    }
  }
  function clearBanner() {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    if (destroyed)
      return;
    drawer.setNotice("", "info");
    composerAlertMount?.replaceChildren();
  }
  function syncRecoveryBusy() {
    if (destroyed)
      return;
    const { chatId } = ctx.getActiveChat();
    drawer.setRecoveryBusy(isChatBusy(chatId));
  }
  function renderToolbar() {
    if (destroyed || !view)
      return;
    const { chatId } = ctx.getActiveChat();
    toolbar.render({
      settings: view.settings,
      activeRun: getActiveRunForChat(chatId),
      recovery: view.recovery,
      hasActiveChat: Boolean(chatId)
    });
    syncRecoveryBusy();
  }
  async function refresh(options = {}) {
    if (destroyed)
      return;
    const myBootstrapSeq = ++bootstrapSeq;
    const startSettingsRevision = settingsRevision;
    const startStatusSeq = statusSeq;
    try {
      const rawNext = await rpc("get_bootstrap");
      if (destroyed || myBootstrapSeq !== bootstrapSeq)
        return;
      const next = await withFrontendConnectionFallback(rawNext, ctx);
      if (destroyed || myBootstrapSeq !== bootstrapSeq)
        return;
      const resolvedSettings = view && settingsRevision !== startSettingsRevision ? view.settings : next.settings;
      const bootstrapRunsByChat = new Map;
      const bootstrapRuns = next.activeRuns;
      if (Array.isArray(bootstrapRuns)) {
        for (const r of bootstrapRuns) {
          if (r && typeof r.chatId === "string" && r.chatId.length > 0) {
            bootstrapRunsByChat.set(r.chatId, r);
          }
        }
      }
      if (next.activeRun && typeof next.activeRun.chatId === "string" && next.activeRun.chatId.length > 0) {
        bootstrapRunsByChat.set(next.activeRun.chatId, next.activeRun);
      }
      if (statusSeq === startStatusSeq) {
        activeRunsByChat.clear();
        for (const [chatId, run] of bootstrapRunsByChat.entries()) {
          activeRunsByChat.set(chatId, run);
        }
      } else if (globalClearSeq <= startStatusSeq) {
        for (const chatId of [...activeRunsByChat.keys()]) {
          if ((chatStatusSeq.get(chatId) ?? 0) <= startStatusSeq) {
            const refreshedRun = bootstrapRunsByChat.get(chatId);
            if (refreshedRun) {
              activeRunsByChat.set(chatId, refreshedRun);
            } else {
              activeRunsByChat.delete(chatId);
            }
          }
        }
        for (const [chatId, run] of bootstrapRunsByChat.entries()) {
          if (!activeRunsByChat.has(chatId) && (chatStatusSeq.get(chatId) ?? 0) <= startStatusSeq) {
            activeRunsByChat.set(chatId, run);
          }
        }
      }
      syncPrimaryActiveRun();
      const resolvedActiveRun = activeRun;
      const mergedNext = {
        ...next,
        settings: resolvedSettings,
        activeRun: resolvedActiveRun
      };
      const coreUnchanged = Boolean(options.onlyIfChanged) && view !== null && JSON.stringify({
        settings: view.settings,
        connections: view.connections,
        presets: view.presets,
        permissions: view.permissions,
        catalogWarnings: view.catalogWarnings ?? []
      }) === JSON.stringify({
        settings: mergedNext.settings,
        connections: mergedNext.connections,
        presets: mergedNext.presets,
        permissions: mergedNext.permissions,
        catalogWarnings: mergedNext.catalogWarnings ?? []
      });
      const recoveryUnchanged = Boolean(options.onlyIfChanged) && view !== null && JSON.stringify(view.recovery) === JSON.stringify(mergedNext.recovery);
      view = mergedNext;
      activeRun = resolvedActiveRun;
      const currentChatId = ctx.getActiveChat().chatId;
      indicator.sync(getActiveRunForChat(currentChatId));
      chatHeads.syncRuns(activeRunsByChat.values(), currentChatId);
      if (!coreUnchanged) {
        drawer.render(view);
      } else if (!recoveryUnchanged) {
        drawer.updateRecovery(view.recovery, view.settings);
      }
      renderToolbar();
    } catch (error) {
      if (destroyed)
        return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "error");
    }
  }
  async function triggerAction(actionId, options) {
    if (destroyed || isPreChatLaunching)
      return;
    const preChatId = ctx.getActiveChat().chatId;
    if (preChatId && (getActiveRunForChat(preChatId) || launchingChats.has(preChatId))) {
      return;
    }
    isPreChatLaunching = true;
    let lockedChatId = preChatId;
    if (lockedChatId) {
      launchingChats.add(lockedChatId);
      syncRecoveryBusy();
    }
    try {
      if (!view)
        await refresh();
      isPreChatLaunching = false;
      if (destroyed || !view)
        return;
      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before triggering a guided action.", "warn");
        return;
      }
      if (lockedChatId !== chatId) {
        if (lockedChatId) {
          launchingChats.delete(lockedChatId);
        }
        if (launchingChats.has(chatId))
          return;
        lockedChatId = chatId;
        launchingChats.add(lockedChatId);
        syncRecoveryBusy();
      }
      if (getActiveRunForChat(chatId))
        return;
      const state = safeGetComposerState();
      if (!isComposerAvailable(state)) {
        showBanner("Composer is unavailable right now. Open the message input bar and try again.", "warn");
        return;
      }
      if (state.chatId !== null && state.chatId !== chatId) {
        showBanner("Active chat changed; please try again.", "warn");
        return;
      }
      const inputText = state.text;
      const config = view.settings.actions[actionId];
      if (actionId === "guided_response" && !inputText.trim()) {
        showBanner("Type guidance in the input box before clicking Guided Response.", "warn");
        safeFocusComposer();
        return;
      }
      clearBanner();
      pendingImpersonateDrafts.delete(chatId);
      const shouldClear = Boolean(inputText.trim()) && (config.clearInputOnRun || actionId === "guided_impersonate");
      if (shouldClear && !safeSetComposerText("")) {
        showBanner("Composer is unavailable right now.", "warn");
        return;
      }
      const activeConnectionId = ctx.connections?.getActive?.()?.activeProfileId ?? null;
      const payload = {
        actionId,
        chatId,
        activeConnectionId,
        inputText,
        ...actionId === "guided_swipe" && options?.backgroundSwipe ? { backgroundSwipe: true } : {}
      };
      try {
        await rpc("run_action", payload, 300000);
        if (destroyed)
          return;
      } catch (error) {
        if (destroyed)
          return;
        if (shouldClear && !getActiveRunForChat(chatId)) {
          const currentComposer = safeGetComposerState();
          const activeChatId = ctx.getActiveChat().chatId;
          if (isComposerAvailable(currentComposer) && currentComposer.chatId === chatId && activeChatId === chatId && !currentComposer.text) {
            safeSetComposerText(inputText);
          }
        }
        const msg = error instanceof Error ? error.message : String(error);
        showBanner(msg, "error", 7000);
      }
    } finally {
      isPreChatLaunching = false;
      if (lockedChatId) {
        launchingChats.delete(lockedChatId);
      }
      syncRecoveryBusy();
    }
  }
  function restoreRecoveryEntry(entry) {
    const activeChatId = ctx.getActiveChat().chatId;
    if (destroyed || !view)
      return;
    if (isChatBusy(activeChatId)) {
      showBanner("Wait for the active guided generation to finish before restoring input.", "warn");
      return;
    }
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner("Composer is unavailable right now — cannot restore input.", "warn");
      return;
    }
    if (state.chatId !== null && state.chatId !== activeChatId) {
      showBanner("Active chat changed; please try again.", "warn");
      return;
    }
    if (!safeSetComposerText(entry.text)) {
      showBanner("Composer is unavailable right now — cannot restore input.", "warn");
      return;
    }
    safeFocusComposer();
    clearBanner();
  }
  function clearCurrentInput() {
    const activeChatId = ctx.getActiveChat().chatId;
    if (destroyed || !view || isChatBusy(activeChatId)) {
      return;
    }
    if (!view.settings.inputRecovery.enabled)
      return;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner("Composer is unavailable right now — cannot clear input.", "warn");
      return;
    }
    if (state.chatId !== null && state.chatId !== activeChatId) {
      showBanner("Active chat changed; please try again.", "warn");
      return;
    }
    if (!state.text) {
      safeFocusComposer();
      clearBanner();
      return;
    }
    if (!safeSetComposerText("")) {
      showBanner("Composer is unavailable right now — cannot clear input.", "warn");
      return;
    }
    safeFocusComposer();
    clearBanner();
  }
  async function removeLastContinue() {
    if (destroyed || isPreChatLaunching)
      return;
    const { chatId } = ctx.getActiveChat();
    if (!chatId) {
      showBanner("Open a chat before removing the last continue.", "warn");
      return;
    }
    if (isChatBusy(chatId))
      return;
    launchingChats.add(chatId);
    syncRecoveryBusy();
    pendingImpersonateDrafts.delete(chatId);
    try {
      clearBanner();
      await rpc("remove_last_continue", { chatId });
    } catch (error) {
      if (destroyed)
        return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "warn", 7000);
    } finally {
      launchingChats.delete(chatId);
      syncRecoveryBusy();
    }
  }
  async function regenerateLastContinue() {
    if (destroyed || isPreChatLaunching)
      return;
    const { chatId } = ctx.getActiveChat();
    if (!chatId) {
      showBanner("Open a chat before regenerating the last continue.", "warn");
      return;
    }
    if (isChatBusy(chatId))
      return;
    launchingChats.add(chatId);
    syncRecoveryBusy();
    pendingImpersonateDrafts.delete(chatId);
    try {
      clearBanner();
      const activeConnectionId = ctx.connections?.getActive?.()?.activeProfileId ?? null;
      const payload = {
        chatId,
        activeConnectionId
      };
      await rpc("regenerate_last_continue", payload, 300000);
    } catch (error) {
      if (destroyed)
        return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "error", 7000);
    } finally {
      launchingChats.delete(chatId);
      syncRecoveryBusy();
    }
  }
  async function clearRecoveryHistory() {
    const activeChatId = ctx.getActiveChat().chatId;
    if (destroyed)
      return;
    if (isChatBusy(activeChatId)) {
      showBanner("Wait for the active guided generation to finish before clearing input recovery history.", "warn");
      return;
    }
    try {
      const recovery = await rpc("clear_recovery");
      if (destroyed)
        return;
      if (view) {
        view = { ...view, recovery };
        renderToolbar();
        drawer.updateRecovery(view.recovery, view.settings);
      }
    } catch (error) {
      if (destroyed)
        return;
      showBanner(error instanceof Error ? error.message : String(error), "error");
    }
  }
  const indicator = new StreamingIndicatorController(ctx);
  const chatHeads = new ChatHeadController(ctx);
  const pillMetrics = new PillMetricsController(ctx);
  const toolbar = new InputToolbarController(ctx, {
    onTriggerAction: (actionId, options) => {
      triggerAction(actionId, options);
    },
    onAbortAction: (runId) => {
      if (destroyed)
        return;
      rpc("abort_action", { runId }).catch(() => {
        return;
      });
    },
    onRestoreLatest: () => {
      const activeChatId = ctx.getActiveChat().chatId;
      if (destroyed || !view || isChatBusy(activeChatId)) {
        return;
      }
      const latest = pickRecoveryEntry(view.recovery);
      if (latest) {
        restoreRecoveryEntry(latest);
      } else {
        clearCurrentInput();
      }
    },
    onRestoreEntry: (entry) => {
      restoreRecoveryEntry(entry);
    },
    onClearRecovery: () => {
      clearRecoveryHistory();
    },
    onRemoveLastContinue: () => {
      removeLastContinue();
    },
    onRegenerateLastContinue: () => {
      regenerateLastContinue();
    }
  });
  const drawer = new SettingsDrawerController(ctx, {
    onRefresh: () => {
      if (destroyed)
        return;
      clearBanner();
      refresh();
    },
    onSaveSettings: async (nextSettings, options) => {
      if (destroyed || !view)
        return;
      const rev = ++settingsRevision;
      view = { ...view, settings: nextSettings };
      renderToolbar();
      if (options?.rebuildDrawer)
        drawer.render(view, { force: true });
      try {
        const saved = await rpc("save_settings", nextSettings);
        if (destroyed || !view || rev !== settingsRevision)
          return;
        const settingsUnchanged = areJsonValuesEqual(saved, view.settings);
        view = { ...view, settings: saved };
        if (!settingsUnchanged) {
          renderToolbar();
          if (options?.rebuildDrawer)
            drawer.render(view);
        }
      } catch (error) {
        if (destroyed)
          return;
        showBanner(`Failed saving settings: ${error instanceof Error ? error.message : String(error)}`, "error");
        if (rev === settingsRevision) {
          refresh();
        }
      }
    },
    onRestoreEntry: (entry) => restoreRecoveryEntry(entry),
    onClearRecovery: () => clearRecoveryHistory()
  });
  function handleActiveChatChanged(metricsChatId) {
    if (destroyed)
      return;
    const activeChatId = ctx.getActiveChat().chatId;
    clearImpersonateDraftRetry();
    syncPrimaryActiveRun();
    indicator.sync(getActiveRunForChat(activeChatId));
    chatHeads.onChatChanged(activeChatId);
    renderToolbar();
    applyPendingImpersonateDraft(activeChatId);
    pillMetrics.onChatChanged(metricsChatId !== undefined ? metricsChatId : activeChatId);
  }
  disposers.push(drawer.onActivate(() => {
    if (!destroyed)
      refresh({ onlyIfChanged: true });
  }));
  disposers.push(ctx.onBackendMessage((rawPayload) => {
    if (destroyed)
      return;
    const msg = isRecord4(rawPayload) ? rawPayload : {};
    if (msg.type === "gg:reply" && typeof msg.requestId === "string") {
      const waiter = pending.get(msg.requestId);
      if (!waiter)
        return;
      pending.delete(msg.requestId);
      clearTimeout(waiter.timer);
      if (typeof msg.error === "string" && msg.error) {
        waiter.reject(new Error(msg.error));
      } else {
        waiter.resolve(msg.result);
      }
      return;
    }
    const event = msg;
    switch (event.type) {
      case "gg:status": {
        statusSeq += 1;
        const eventChatId = typeof event.chatId === "string" && event.chatId.length > 0 ? event.chatId : undefined;
        const hasTerminalSignal = Boolean(event.done) || Boolean(event.aborted) || Boolean(event.error);
        const prevEventChatRun = eventChatId ? activeRunsByChat.get(eventChatId) : undefined;
        const prevRunChatRun = event.run ? activeRunsByChat.get(event.run.chatId) : undefined;
        if (event.run) {
          if (eventChatId && event.run.chatId !== eventChatId && hasTerminalSignal) {
            activeRunsByChat.delete(eventChatId);
            chatStatusSeq.set(eventChatId, statusSeq);
            if (prevEventChatRun !== undefined && prevEventChatRun.actionId !== "guided_impersonate" || event.aborted || event.error) {
              pendingImpersonateDrafts.delete(eventChatId);
            }
          }
          if (!hasTerminalSignal || eventChatId !== undefined && event.run.chatId !== eventChatId) {
            if (prevRunChatRun?.runId !== event.run.runId) {
              pendingImpersonateDrafts.delete(event.run.chatId);
            }
            activeRunsByChat.set(event.run.chatId, event.run);
            chatStatusSeq.set(event.run.chatId, statusSeq);
          } else {
            activeRunsByChat.delete(event.run.chatId);
            chatStatusSeq.set(event.run.chatId, statusSeq);
            if (event.run.actionId !== "guided_impersonate" || event.aborted || event.error) {
              pendingImpersonateDrafts.delete(event.run.chatId);
            }
          }
        } else if (eventChatId) {
          activeRunsByChat.delete(eventChatId);
          chatStatusSeq.set(eventChatId, statusSeq);
          if (prevEventChatRun !== undefined && prevEventChatRun.actionId !== "guided_impersonate" || event.aborted || event.error) {
            pendingImpersonateDrafts.delete(eventChatId);
          }
        } else {
          activeRunsByChat.clear();
          globalClearSeq = statusSeq;
          if (hasTerminalSignal) {
            pendingImpersonateDrafts.clear();
          }
        }
        syncPrimaryActiveRun();
        if (view) {
          view = {
            ...view,
            activeRun
          };
        }
        const activeChatId = ctx.getActiveChat().chatId;
        indicator.sync(getActiveRunForChat(activeChatId));
        chatHeads.handleStatusEvent(event, activeChatId);
        renderToolbar();
        if (event.error) {
          showBanner(event.error, "error", 7000);
        }
        return;
      }
      case "gg:impersonate-chunk": {
        if (typeof event.text === "string") {
          const rawChatId = event.chatId;
          const chunkChatId = typeof rawChatId === "string" ? rawChatId : null;
          const expectedChatId = chunkChatId ?? (activeRunsByChat.size === 1 ? Array.from(activeRunsByChat.values())[0].chatId : activeRun?.chatId ?? null);
          const state = safeGetComposerState();
          const activeChatId = ctx.getActiveChat().chatId;
          if (expectedChatId !== null && expectedChatId !== activeChatId) {
            if (event.done && !event.aborted && event.text.length > 0) {
              pendingImpersonateDrafts.set(expectedChatId, event.text);
            }
            return;
          }
          if (!isComposerAvailable(state) || !activeChatId || state.chatId !== activeChatId) {
            if (event.done && !event.aborted && event.text.length > 0 && expectedChatId) {
              pendingImpersonateDrafts.set(expectedChatId, event.text);
              if (expectedChatId === activeChatId) {
                applyPendingImpersonateDraft(activeChatId);
              }
            }
            return;
          }
          if (safeSetComposerText(event.text)) {
            pendingImpersonateDrafts.delete(activeChatId);
            if (event.done) {
              safeFocusComposer();
            }
          } else if (event.done && !event.aborted && event.text.length > 0) {
            pendingImpersonateDrafts.set(activeChatId, event.text);
          }
        }
        return;
      }
      case "gg:recovery-updated": {
        if (view && Array.isArray(event.recovery)) {
          view = { ...view, recovery: event.recovery };
          renderToolbar();
          drawer.updateRecovery(view.recovery, view.settings);
        }
        return;
      }
      case "gg:changed": {
        refresh({ onlyIfChanged: true });
        return;
      }
      case "gg:generation_metrics": {
        if (typeof event.chatId === "string" && typeof event.messageId === "string" && typeof event.swipeId === "number") {
          pillMetrics.handleMetricsEvent(event);
        }
        return;
      }
    }
  }));
  disposers.push(ctx.events.on("CHAT_SWITCHED", (payload) => {
    handleActiveChatChanged(extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId);
  }));
  disposers.push(ctx.events.on("CHAT_CHANGED", (payload) => {
    handleActiveChatChanged(extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId);
  }));
  disposers.push(ctx.events.on("CHAT_DELETED", (payload) => {
    if (destroyed)
      return;
    const deletedChatId = extractDeletedChatIdFromPayload(payload);
    if (!deletedChatId)
      return;
    statusSeq += 1;
    chatStatusSeq.set(deletedChatId, statusSeq);
    activeRunsByChat.delete(deletedChatId);
    pendingImpersonateDrafts.delete(deletedChatId);
    if (impersonateDraftRetryChatId === deletedChatId) {
      clearImpersonateDraftRetry();
    }
    launchingChats.delete(deletedChatId);
    syncPrimaryActiveRun();
    const activeChatId = ctx.getActiveChat().chatId;
    indicator.sync(getActiveRunForChat(activeChatId));
    chatHeads.onChatDeleted(deletedChatId);
    pillMetrics.onChatDeleted(deletedChatId);
    renderToolbar();
  }));
  disposers.push(ctx.events.on("MESSAGE_SWIPED", (payload) => {
    if (!destroyed)
      pillMetrics.onMessageEvent(payload);
  }));
  disposers.push(ctx.events.on("MESSAGE_EDITED", (payload) => {
    if (!destroyed)
      pillMetrics.onMessageEvent(payload);
  }));
  disposers.push(ctx.events.on("MESSAGE_DELETED", (payload) => {
    if (!destroyed)
      pillMetrics.onMessageDeleted(payload);
  }));
  if (ctx.connections?.subscribe) {
    disposers.push(ctx.connections.subscribe(() => {
      if (!destroyed)
        refresh({ onlyIfChanged: true });
    }));
  }
  let stateSubscribed = false;
  try {
    if (ctx.state) {
      disposers.push(ctx.state.subscribe("chat.active", () => {
        handleActiveChatChanged();
      }));
      stateSubscribed = true;
    }
  } catch {}
  if (!stateSubscribed) {
    let lastChatId = ctx.getActiveChat().chatId;
    const poll = setInterval(() => {
      if (destroyed)
        return;
      const nextChatId = ctx.getActiveChat().chatId;
      if (nextChatId !== lastChatId) {
        lastChatId = nextChatId;
        handleActiveChatChanged(nextChatId);
      }
    }, 600);
    disposers.push(() => clearInterval(poll));
  }
  ctx.ready();
  refresh();
  return () => {
    try {
      drawer.flushPendingSaves();
    } catch {}
    destroyed = true;
    clearImpersonateDraftRetry();
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {}
    }
    disposers.length = 0;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Guided Generations unloaded."));
    }
    pending.clear();
    launchingChats.clear();
    activeRunsByChat.clear();
    chatStatusSeq.clear();
    pendingImpersonateDrafts.clear();
    try {
      pillMetrics.destroy();
    } catch {}
    try {
      chatHeads.destroy();
    } catch {}
    try {
      indicator.destroy();
    } catch {}
    try {
      toolbar.destroy();
    } catch {}
    try {
      drawer.destroy();
    } catch {}
    try {
      composerAlertMount?.replaceChildren();
    } catch {}
    try {
      removeStyle();
    } catch {}
  };
}
export {
  setup
};
