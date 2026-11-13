// src/shared/defaults.ts
var GUIDED_ACTION_ORDER = [
  "guided_response",
  "guided_continue",
  "guided_regenerate",
  "guided_swipe",
  "guided_impersonate"
];
var DEFAULT_TOOLBAR_PLACEMENT = "after_native";
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

// src/frontend/input-toolbar.ts
var HOST_CLASSES = [
  "gg-actions-host",
  "gg-actions-host--row",
  "is-before-native",
  "is-right"
];

class InputToolbarController {
  ctx;
  handlers;
  actionsMountRoot;
  toolbarMountRoot = null;
  toolbarEl;
  buttons = [];
  activeActionId = null;
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
    btn.title = isThisRunning ? `Stop ${meta.label}` : meta.tooltip;
    btn.innerHTML = isThisRunning ? STOP_ICON_SVG : TOOLBAR_ICONS[actionId];
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isThisRunning && state.activeRun) {
        this.handlers.onAbortAction(state.activeRun.runId);
      } else {
        this.handlers.onTriggerAction(actionId);
      }
    });
    return btn;
  }
  buildRecoveryButton(state) {
    if (!state.settings.inputRecovery.enabled)
      return null;
    const hasRecovery = state.recovery.length > 0;
    const disabled = !hasRecovery || Boolean(state.activeRun);
    const latestPreview = state.recovery[0]?.text ? ` ("${state.recovery[0].text.replace(/\s+/g, " ").trim().slice(0, 48)}")` : "";
    const recoverBtn = document.createElement("button");
    recoverBtn.type = "button";
    recoverBtn.className = "gg-btn";
    if (disabled)
      recoverBtn.classList.add("is-dimmed");
    recoverBtn.disabled = disabled;
    recoverBtn.setAttribute("data-gg-action", "input_recovery");
    recoverBtn.setAttribute("aria-label", "Restore last input");
    recoverBtn.title = hasRecovery ? `Restore last cleared input${latestPreview}` : "Input Recovery — no saved input yet";
    recoverBtn.innerHTML = TOOLBAR_ICONS.input_recovery;
    recoverBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onRestoreLatest();
    });
    return recoverBtn;
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

// src/frontend/recovery-store.ts
function formatRecoverySnippet(text, maxLength = 68) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength)
    return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
}
function pickRecoveryEntry(entries, preferredId) {
  if (entries.length === 0)
    return null;
  if (preferredId) {
    return entries.find((item) => item.id === preferredId) ?? entries[0] ?? null;
  }
  return entries[0] ?? null;
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
  noticeText = "";
  noticeKind = "info";
  destroyed = false;
  onFocusOut;
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
    this.onFocusOut = (event) => {
      if (this.destroyed)
        return;
      const nextTarget = event.relatedTarget;
      const stillInsideEditable = isElementNode(nextTarget) && this.tab.root.contains(nextTarget) && isEditableElement(nextTarget);
      if (!stillInsideEditable) {
        if (this.debounceTimers.size > 0) {
          this.flushPendingSaves();
        }
        queueMicrotask(() => {
          if (this.destroyed)
            return;
          if (this.pendingView && !this.isEditingDrawerInput()) {
            const next = this.pendingView;
            this.pendingView = null;
            this.render(next, { force: true });
          }
        });
      }
    };
    this.tab.root.addEventListener("focusout", this.onFocusOut);
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
  updateRecovery(recovery, settings) {
    if (this.destroyed || !this.recoveryUi)
      return;
    const maxEntries = settings?.inputRecovery.maxEntries ?? this.currentSettings?.inputRecovery.maxEntries ?? 10;
    this.recoveryUi.maxEntries = maxEntries;
    this.recoveryUi.setBadge(recovery.length > 0 ? String(recovery.length) : "", recovery.length === 0);
    this.recoveryUi.countLabel.textContent = recovery.length > 0 ? `Saved inputs (${recovery.length}/${maxEntries}):` : "No saved inputs yet.";
    this.recoveryUi.clearBtn.disabled = recovery.length === 0;
    this.syncRecoveryList(recovery);
  }
  isEditingDrawerInput() {
    if (this.debounceTimers.size > 0)
      return true;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return Boolean(isElementNode(active) && this.tab.root.contains(active) && isEditableElement(active));
  }
  captureOrderButtonFocus() {
    if (this.pendingFocusRestore)
      return;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!isElementNode(active) || active.tagName !== "BUTTON" || !this.tab.root.contains(active)) {
      return;
    }
    const btn = active;
    const moveDir = btn.dataset.ggMove;
    if (moveDir !== "up" && moveDir !== "down")
      return;
    const row = btn.closest("[data-gg-order-id]");
    const optionId = row?.getAttribute("data-gg-order-id");
    if (optionId) {
      this.pendingFocusRestore = { optionId, button: moveDir };
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
    this.captureOrderButtonFocus();
    this.cancelPendingSaves();
    this.clearComponentHandles();
    this.orderStateTags.clear();
    this.recoveryUi = null;
    this.noticeEl = null;
    this.currentSettings = view?.settings ?? null;
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
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", () => {
      this.flushPendingSaves();
      this.handlers.onRefresh();
    });
    header.append(titleWrap, refreshBtn);
    root.append(header);
    this.syncNoticeElement();
    if (!view) {
      const loading = document.createElement("p");
      loading.className = "gg-muted";
      loading.textContent = "Loading Guided Generations settings…";
      root.append(loading);
      return;
    }
    const missingPerms = [];
    if (!view.permissions.generation)
      missingPerms.push("generation");
    if (!view.permissions.chats)
      missingPerms.push("chats");
    if (!view.permissions.chat_mutation)
      missingPerms.push("chat_mutation");
    if (!view.permissions.presets)
      missingPerms.push("presets");
    if (missingPerms.length > 0) {
      const warn = document.createElement("div");
      warn.className = "gg-notice is-warn";
      warn.setAttribute("role", "alert");
      warn.setAttribute("aria-live", "assertive");
      warn.textContent = `Missing extension permissions (${missingPerms.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`;
      root.append(warn);
    }
    if (view.catalogWarnings && view.catalogWarnings.length > 0) {
      const catalogWarn = document.createElement("div");
      catalogWarn.className = "gg-notice is-warn";
      catalogWarn.setAttribute("role", "alert");
      catalogWarn.setAttribute("aria-live", "assertive");
      catalogWarn.textContent = view.catalogWarnings.join(" ");
      root.append(catalogWarn);
    }
    const connectionOptions = buildConnectionOptions(view.connections);
    const presetOptions = buildPresetOptions(view.presets);
    const roleOptions = [
      { value: "system", label: "System" },
      { value: "user", label: "User" },
      { value: "assistant", label: "Assistant" }
    ];
    this.renderToolbarLayoutSection(root, view.settings);
    for (const actionId of GUIDED_ACTION_ORDER) {
      this.renderActionSection(root, view.settings, actionId, view.connections, connectionOptions, presetOptions, roleOptions);
    }
    this.renderRecoverySection(root, view.settings, view.recovery);
    if (this.pendingFocusRestore) {
      const restore = this.pendingFocusRestore;
      this.pendingFocusRestore = null;
      const targetRow = root.querySelector(`[data-gg-order-id="${restore.optionId}"]`);
      const preferred = targetRow?.querySelector(`button[data-gg-move="${restore.button}"]`);
      const fallback = targetRow?.querySelector(`button[data-gg-move="${restore.button === "up" ? "down" : "up"}"]`);
      const targetBtn = preferred && !preferred.disabled ? preferred : fallback && !fallback.disabled ? fallback : null;
      targetBtn?.focus();
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
      const comboboxInput = modelField.slot.querySelector("input");
      if (comboboxInput) {
        if (!comboboxInput.id)
          comboboxInput.id = modelFieldId;
        if (!comboboxInput.getAttribute("aria-label")) {
          comboboxInput.setAttribute("aria-label", `${meta.label} Model`);
        }
      }
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
    const templateField = createFieldContainer("Guidance Template (supports {{input}}; leave blank for raw input)");
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
    desc.textContent = "Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click.";
    body.append(desc);
    const enableRow = document.createElement("div");
    enableRow.className = "gg-row";
    const enableLabel = document.createElement("span");
    enableLabel.className = "gg-field-label";
    enableLabel.textContent = "Show Restore button on input bar";
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
    const controlsRow = document.createElement("div");
    controlsRow.className = "gg-row";
    const countLabel = document.createElement("span");
    countLabel.className = "gg-muted";
    countLabel.textContent = recovery.length > 0 ? `Saved inputs (${recovery.length}/${settings.inputRecovery.maxEntries}):` : "No saved inputs yet.";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "gg-btn-sm";
    clearBtn.textContent = "Clear History";
    clearBtn.disabled = recovery.length === 0;
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
      maxEntries: settings.inputRecovery.maxEntries
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
      restoreBtn.setAttribute("aria-label", `Restore ${actionLabel} draft: ${formatRecoverySnippet(entry.text, 40)}`);
      restoreBtn.addEventListener("click", () => this.handlers.onRestoreEntry(entry));
      row.append(meta, restoreBtn);
      list.append(row);
    }
    this.recoveryUi.listEl = list;
    this.recoveryUi.body.append(list);
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
      if (this.pendingView && !this.isEditingDrawerInput()) {
        const next = this.pendingView;
        this.pendingView = null;
        this.render(next, { force: true });
      }
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
    this.rootEl = null;
    this.headerEl = null;
    this.noticeEl = null;
    this.recoveryUi = null;
    this.orderStateTags.clear();
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
  color: var(--text-primary, #e5e7eb);
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
  color: var(--text-secondary, rgba(229, 231, 235, 0.68));
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
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary, rgba(229, 231, 235, 0.65));
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
  color: var(--text-secondary, rgba(229, 231, 235, 0.85));
}

.gg-btn-sm {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.16));
  background: var(--surface-elevated, rgba(255, 255, 255, 0.08));
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gg-btn-sm:hover:not(:disabled) {
  background: var(--surface-hover, rgba(255, 255, 255, 0.15));
}

.gg-btn-sm:disabled {
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
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  background: rgba(0, 0, 0, 0.16);
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
  color: var(--text-secondary, rgba(229, 231, 235, 0.6));
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
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  background: rgba(0, 0, 0, 0.16);
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
  color: var(--text-secondary, rgba(229, 231, 235, 0.78));
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
  color: var(--text-secondary, rgba(229, 231, 235, 0.55));
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
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.14));
  background: var(--surface-elevated, rgba(255, 255, 255, 0.06));
  color: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.gg-icon-btn-sm:hover:not(:disabled) {
  background: var(--surface-hover, rgba(255, 255, 255, 0.14));
}

.gg-icon-btn-sm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
`;

// src/frontend.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function withFrontendConnectionFallback(next, ctx) {
  if (next.connections.length > 0 || !ctx.connections?.list)
    return next;
  try {
    const profiles = ctx.connections.list();
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
  let isLaunching = false;
  let view = null;
  let activeRun = null;
  let noticeTimer;
  let composerAlertMount = null;
  try {
    composerAlertMount = ctx.ui.mount("chat_composer_above");
  } catch {
    composerAlertMount = null;
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
  function renderToolbar() {
    if (destroyed || !view)
      return;
    const { chatId } = ctx.getActiveChat();
    toolbar.render({
      settings: view.settings,
      activeRun,
      recovery: view.recovery,
      hasActiveChat: Boolean(chatId)
    });
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
      const next = withFrontendConnectionFallback(rawNext, ctx);
      const resolvedSettings = view && settingsRevision !== startSettingsRevision ? view.settings : next.settings;
      const resolvedActiveRun = statusSeq !== startStatusSeq ? activeRun : next.activeRun;
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
  async function triggerAction(actionId) {
    if (destroyed || activeRun || isLaunching)
      return;
    isLaunching = true;
    try {
      if (!view)
        await refresh();
      if (destroyed || !view || activeRun)
        return;
      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before triggering a guided action.", "warn");
        return;
      }
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
        inputText
      };
      try {
        await rpc("run_action", payload, 300000);
        if (destroyed)
          return;
      } catch (error) {
        if (destroyed)
          return;
        if (shouldClear && !activeRun) {
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
      isLaunching = false;
    }
  }
  function restoreRecoveryEntry(entry) {
    if (destroyed)
      return;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner("Composer is unavailable right now — cannot restore input.", "warn");
      return;
    }
    if (!safeSetComposerText(entry.text)) {
      showBanner("Composer is unavailable right now — cannot restore input.", "warn");
      return;
    }
    safeFocusComposer();
    clearBanner();
  }
  const toolbar = new InputToolbarController(ctx, {
    onTriggerAction: (actionId) => {
      triggerAction(actionId);
    },
    onAbortAction: (runId) => {
      if (destroyed)
        return;
      rpc("abort_action", { runId }).catch(() => {
        return;
      });
    },
    onRestoreLatest: () => {
      if (destroyed || !view)
        return;
      const latest = pickRecoveryEntry(view.recovery);
      if (latest)
        restoreRecoveryEntry(latest);
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
        view = { ...view, settings: saved };
        renderToolbar();
        if (options?.rebuildDrawer)
          drawer.render(view, { force: true });
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
    onClearRecovery: async () => {
      if (destroyed)
        return;
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
  });
  disposers.push(drawer.onActivate(() => {
    if (!destroyed)
      refresh({ onlyIfChanged: true });
  }));
  disposers.push(ctx.onBackendMessage((rawPayload) => {
    if (destroyed)
      return;
    const msg = isRecord(rawPayload) ? rawPayload : {};
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
        activeRun = event.run ?? null;
        if (view)
          view = { ...view, activeRun };
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
          const expectedChatId = chunkChatId ?? activeRun?.chatId ?? null;
          const state = safeGetComposerState();
          const activeChatId = ctx.getActiveChat().chatId;
          if (!isComposerAvailable(state) || !activeChatId || state.chatId !== activeChatId || expectedChatId !== null && expectedChatId !== activeChatId) {
            return;
          }
          if (safeSetComposerText(event.text) && event.done) {
            safeFocusComposer();
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
    }
  }));
  disposers.push(ctx.events.on("CHAT_SWITCHED", () => {
    if (!destroyed)
      renderToolbar();
  }));
  disposers.push(ctx.events.on("CHAT_CHANGED", () => {
    if (!destroyed)
      renderToolbar();
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
        if (!destroyed)
          renderToolbar();
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
        renderToolbar();
      }
    }, 600);
    disposers.push(() => clearInterval(poll));
  }
  ctx.ready();
  refresh();
  return () => {
    destroyed = true;
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    for (const dispose of disposers)
      dispose();
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Guided Generations unloaded."));
    }
    pending.clear();
    toolbar.destroy();
    drawer.destroy();
    composerAlertMount?.replaceChildren();
    removeStyle();
  };
}
export {
  setup
};
