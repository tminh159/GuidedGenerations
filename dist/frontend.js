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
  clearSuppressHoldClickTimer = null;
  holdReleaseCleanup = null;
  postHoldCleanup = null;
  continueMenu = null;
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
    this.closeContinueMenu({ restoreFocus: false });
    this.clearActiveHold();
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
  armPostHoldClickSuppression(onSuppressionCleared) {
    this.clearPostHoldClickSuppression();
    this.suppressNextHoldClick = true;
    this.postHoldCleanup = onSuppressionCleared ?? null;
    if (typeof document === "undefined")
      return;
    const cleanupListeners = () => {
      document.removeEventListener("pointerup", onRelease, true);
      document.removeEventListener("pointercancel", onRelease, true);
      if (this.holdReleaseCleanup === cleanupListeners) {
        this.holdReleaseCleanup = null;
      }
    };
    const onRelease = () => {
      cleanupListeners();
      if (this.clearSuppressHoldClickTimer !== null) {
        clearTimeout(this.clearSuppressHoldClickTimer);
      }
      this.clearSuppressHoldClickTimer = setTimeout(() => {
        this.clearSuppressHoldClickTimer = null;
        this.suppressNextHoldClick = false;
        const onCleanup = this.postHoldCleanup;
        this.postHoldCleanup = null;
        onCleanup?.();
      }, 0);
    };
    this.holdReleaseCleanup = cleanupListeners;
    document.addEventListener("pointerup", onRelease, true);
    document.addEventListener("pointercancel", onRelease, true);
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
        this.armPostHoldClickSuppression(() => {
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
      if (hold.timer !== undefined || hold.fired || this.suppressNextHoldClick) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    btn.addEventListener("click", (event) => {
      if (hold.fired || this.suppressNextHoldClick) {
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
        if (this.continueMenu !== null) {
          this.closeContinueMenu({ restoreFocus: true });
          return;
        }
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
    if (typeof document === "undefined" || !document.body)
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
      if (this.suppressNextHoldClick)
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
    if (spaceAbove < neededHeight && spaceBelow > spaceAbove) {
      menuEl.style.top = `${Math.max(edgePadding / uiScale, rect.bottom / uiScale + gapPx)}px`;
      menuEl.style.bottom = "";
    } else {
      menuEl.style.bottom = `${(vh - rect.top) / uiScale + gapPx}px`;
      menuEl.style.top = "";
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
    recoverBtn.title = hasRecovery ? `Restore last cleared input${latestPreview}` : "Input Recovery — clear current input";
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
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function extractMessageList(page) {
  const rawList = Array.isArray(page) ? page : isRecord(page) && Array.isArray(page.data) ? page.data : isRecord(page) && Array.isArray(page.items) ? page.items : [];
  const result = [];
  for (const item of rawList) {
    if (isRecord(item) && typeof item.id === "string") {
      result.push(item);
    }
  }
  return result;
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
    const payload = isRecord(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord(payload.message) ? payload.message : null;
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
          entry.swipeId -= 1;
          entry.latestFallback = null;
          entry.key = this.makeKey(entry.chatId, entry.messageId, entry.swipeId);
          shifted.push(entry);
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
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.pending.clear();
    this.scheduledKeys.clear();
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
    const snapshot = this.pending.get(key);
    if (!snapshot)
      return;
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
        if (resolvedFallback && resolvedFallback.id === snapshot.messageId && messages.length >= MESSAGE_READ_LIMIT) {
          target = resolvedFallback;
        } else {
          this.deleteIfSameRevision(key, snapshot.revision);
          return;
        }
      }
    } else if (resolvedFallback && resolvedFallback.id === snapshot.messageId) {
      target = resolvedFallback;
    } else {
      return;
    }
    if (typeof target.swipe_id !== "number") {
      return;
    }
    if (target.swipe_id !== snapshot.swipeId) {
      return;
    }
    const nextExtra = {
      ...isRecord(target.extra) ? target.extra : {}
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
    if (isPermanentError(error) || snapshot.attempts >= 1) {
      this.pending.delete(key);
      return;
    }
    current.attempts = snapshot.attempts + 1;
    this.scheduleRetry(key);
  }
  deleteIfSameRevision(key, revision) {
    const current = this.pending.get(key);
    if (current && current.revision === revision) {
      this.pending.delete(key);
    }
  }
  scheduleRetry(key) {
    if (this.destroyed || this.retryTimers.has(key))
      return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(key);
      if (this.destroyed)
        return;
      this.enqueueFlush(key);
    }, 0);
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
            const next = this.currentSettings ? { ...this.pendingView, settings: this.currentSettings } : this.pendingView;
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
    this.recoveryUi.recoveryCount = recovery.length;
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
    const missingFeaturePerms = [];
    const degradedNotes = [];
    if (view.permissions.interceptor === false) {
      missingFeaturePerms.push("interceptor");
      degradedNotes.push("preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement");
    }
    if (view.permissions.regex_scripts === false) {
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
    let syncingUi = false;
    let handle = null;
    let fallbackInput = null;
    const commitInput = (rawNumber) => {
      if (syncingUi)
        return;
      const normalized = clamp(rawNumber === null ? options.defaultValue : rawNumber);
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
      const mountedInput = options.slot.querySelector("input");
      if (mountedInput) {
        if (!mountedInput.id)
          mountedInput.id = options.fieldId;
        if (!mountedInput.getAttribute("aria-label")) {
          mountedInput.setAttribute("aria-label", options.ariaLabel);
        }
      }
      options.slot.addEventListener("focusout", () => {
        this.flushPendingSaveKey(options.debounceKey);
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
        this.flushPendingSaveKey(options.debounceKey);
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
        const next = this.currentSettings ? { ...this.pendingView, settings: this.currentSettings } : this.pendingView;
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
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class StreamingIndicatorController {
  ctx;
  disposers = [];
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
      const handleMessageEvent = (rawPayload) => {
        this.onMessageEvent(rawPayload);
      };
      const handleChatEvent = () => {
        if (!this.destroyed) {
          this.syncCurrent();
        }
      };
      this.disposers.push(this.ctx.events.on("MESSAGE_SWIPED", handleMessageEvent), this.ctx.events.on("MESSAGE_EDITED", handleMessageEvent), this.ctx.events.on("MESSAGE_SENT", handleMessageEvent), this.ctx.events.on("CHAT_CHANGED", handleChatEvent), this.ctx.events.on("CHAT_SWITCHED", handleChatEvent));
    }
  }
  sync(run) {
    if (this.destroyed)
      return;
    const prevRun = this.currentRun;
    const runIdentityChanged = prevRun?.runId !== run?.runId || prevRun?.messageId !== run?.messageId || prevRun?.actionId !== run?.actionId;
    if (prevRun?.runId !== run?.runId) {
      this.contentSeen = false;
      this.viewedSwipeId = undefined;
      this.swipeInitialized = false;
      this.resetRetry();
    } else if (prevRun?.messageId !== run?.messageId) {
      this.resetRetry();
    }
    this.currentRun = run;
    if (run && !this.swipeInitialized && run.swipeId !== undefined) {
      this.viewedSwipeId = run.backgroundSwipe ? undefined : run.swipeId;
      this.swipeInitialized = true;
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
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {}
    }
    this.disposers.length = 0;
  }
  onMessageEvent(rawPayload) {
    if (this.destroyed || !this.currentRun?.messageId)
      return;
    const payload = isRecord2(rawPayload) ? rawPayload : null;
    const msg = payload && isRecord2(payload.message) ? payload.message : null;
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
      if (this.mountedEl === null) {
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
`;

// src/frontend.ts
function isRecord3(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function extractChatIdFromPayload(rawPayload) {
  if (!isRecord3(rawPayload))
    return null;
  if (typeof rawPayload.chatId === "string" && rawPayload.chatId) {
    return rawPayload.chatId;
  }
  if (isRecord3(rawPayload.chat) && typeof rawPayload.chat.id === "string") {
    return rawPayload.chat.id;
  }
  return null;
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
      indicator.sync(activeRun);
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
  function clearCurrentInput() {
    if (destroyed || !view || activeRun)
      return;
    if (!view.settings.inputRecovery.enabled)
      return;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner("Composer is unavailable right now — cannot clear input.", "warn");
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
    if (destroyed || activeRun || isLaunching)
      return;
    isLaunching = true;
    try {
      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before removing the last continue.", "warn");
        return;
      }
      clearBanner();
      await rpc("remove_last_continue", { chatId });
    } catch (error) {
      if (destroyed)
        return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "warn", 7000);
    } finally {
      isLaunching = false;
    }
  }
  async function regenerateLastContinue() {
    if (destroyed || activeRun || isLaunching)
      return;
    isLaunching = true;
    try {
      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before regenerating the last continue.", "warn");
        return;
      }
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
      isLaunching = false;
    }
  }
  const indicator = new StreamingIndicatorController(ctx);
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
      if (destroyed || !view || activeRun)
        return;
      const latest = pickRecoveryEntry(view.recovery);
      if (latest) {
        restoreRecoveryEntry(latest);
      } else {
        clearCurrentInput();
      }
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
    const msg = isRecord3(rawPayload) ? rawPayload : {};
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
        indicator.sync(activeRun);
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
      case "gg:generation_metrics": {
        if (typeof event.chatId === "string" && typeof event.messageId === "string" && typeof event.swipeId === "number") {
          pillMetrics.handleMetricsEvent(event);
        }
        return;
      }
    }
  }));
  disposers.push(ctx.events.on("CHAT_SWITCHED", (payload) => {
    if (destroyed)
      return;
    renderToolbar();
    pillMetrics.onChatChanged(extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId);
  }));
  disposers.push(ctx.events.on("CHAT_CHANGED", (payload) => {
    if (destroyed)
      return;
    renderToolbar();
    pillMetrics.onChatChanged(extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId);
  }));
  disposers.push(ctx.events.on("MESSAGE_SWIPED", (payload) => {
    if (!destroyed)
      pillMetrics.onMessageEvent(payload);
  }));
  disposers.push(ctx.events.on("MESSAGE_EDITED", (payload) => {
    if (!destroyed)
      pillMetrics.onMessageEvent(payload);
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
        if (!destroyed) {
          indicator.sync(activeRun);
          renderToolbar();
        }
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
        indicator.sync(activeRun);
        renderToolbar();
      }
    }, 600);
    disposers.push(() => clearInterval(poll));
  }
  ctx.ready();
  refresh();
  return () => {
    drawer.flushPendingSaves();
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
    pillMetrics.destroy();
    indicator.destroy();
    toolbar.destroy();
    drawer.destroy();
    composerAlertMount?.replaceChildren();
    removeStyle();
  };
}
export {
  setup
};
