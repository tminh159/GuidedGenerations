import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  ACTION_METADATA,
  normalizeButtonOrder,
  normalizeToolbarPlacement,
} from "../shared/defaults";
import type {
  ActiveRunState,
  GuidedActionId,
  GuidedGenerationsSettings,
  RecoveryEntry,
  ToolbarOptionId,
  ToolbarPlacement,
} from "../shared/types";
import { CONTINUE_MENU_ICONS, STOP_ICON_SVG, TOOLBAR_ICONS } from "./icons";

export interface InputToolbarHandlers {
  onTriggerAction(
    actionId: GuidedActionId,
    options?: { backgroundSwipe?: boolean },
  ): void;
  onAbortAction(runId: string): void;
  onRestoreLatest(): void;
  onRemoveLastContinue(): void;
  onRegenerateLastContinue(): void;
}

export interface ToolbarRenderState {
  settings: GuidedGenerationsSettings;
  activeRun: ActiveRunState | null;
  recovery: readonly RecoveryEntry[];
  hasActiveChat: boolean;
}

const HOST_CLASSES = [
  "gg-actions-host",
  "gg-actions-host--row",
  "is-before-native",
  "is-right",
] as const;

const HOLD_DURATION_MS = 450;
const HOLD_MOVE_TOLERANCE_PX = 10;
const MENU_DISMISS_GRACE_MS = 150;

interface ContinueMenuSession {
  menuEl: HTMLDivElement;
  anchorBtn: HTMLButtonElement;
  items: HTMLButtonElement[];
  cleanup: () => void;
}

export class InputToolbarController {
  private readonly actionsMountRoot: Element;
  private toolbarMountRoot: Element | null = null;
  private readonly toolbarEl: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private activeActionId: ToolbarOptionId | null = null;
  private activeHoldCancel: (() => void) | null = null;
  private suppressNextHoldClick = false;
  private clearSuppressHoldClickTimer: ReturnType<typeof setTimeout> | null = null;
  private holdReleaseCleanup: (() => void) | null = null;
  private postHoldCleanup: (() => void) | null = null;
  private continueMenu: ContinueMenuSession | null = null;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onFocusIn: (event: FocusEvent) => void;

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private readonly handlers: InputToolbarHandlers,
  ) {
    this.actionsMountRoot = ctx.ui.mount("chat_actions");
    this.actionsMountRoot.classList.add("gg-actions-host");
    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "gg-toolbar";
    this.toolbarEl.setAttribute("role", "toolbar");
    this.toolbarEl.setAttribute("aria-label", "Guided Generations actions");

    this.onKeyDown = (event: KeyboardEvent) => {
      this.handleToolbarKeyDown(event);
    };
    this.onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.tagName !== "BUTTON" || (target as HTMLButtonElement).disabled) {
        return;
      }
      const action = target.getAttribute("data-gg-action") as ToolbarOptionId | null;
      if (action) {
        this.activeActionId = action;
        this.applyRovingTabIndex();
      }
    };
    this.toolbarEl.addEventListener("keydown", this.onKeyDown);
    this.toolbarEl.addEventListener("focusin", this.onFocusIn);

    this.actionsMountRoot.replaceChildren(this.toolbarEl);
  }

  render(state: ToolbarRenderState): void {
    this.closeContinueMenu({ restoreFocus: false });
    this.clearActiveHold();
    const buttons: HTMLButtonElement[] = [];
    const order = normalizeButtonOrder(state.settings.buttonOrder);

    for (const optionId of order) {
      const btn =
        optionId === "input_recovery"
          ? this.buildRecoveryButton(state)
          : this.buildActionButton(optionId, state);
      if (btn) buttons.push(btn);
    }

    this.buttons = buttons;
    this.toolbarEl.replaceChildren(...buttons);
    this.applyRovingTabIndex();

    const visible = buttons.length > 0;
    const placement = normalizeToolbarPlacement(state.settings.toolbarPlacement);
    this.applyPlacement(placement, visible);
  }

  private applyRovingTabIndex(): void {
    const enabled = this.buttons.filter((btn) => !btn.disabled);
    if (enabled.length === 0) {
      for (const btn of this.buttons) btn.tabIndex = -1;
      return;
    }

    const activeBtn =
      (this.activeActionId
        ? enabled.find((btn) => btn.getAttribute("data-gg-action") === this.activeActionId)
        : undefined) ?? enabled[0]!;

    this.activeActionId =
      (activeBtn.getAttribute("data-gg-action") as ToolbarOptionId | null) ?? null;

    for (const btn of this.buttons) {
      btn.tabIndex = btn === activeBtn ? 0 : -1;
    }
  }

  private handleToolbarKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (
      key !== "ArrowRight" &&
      key !== "ArrowLeft" &&
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End"
    ) {
      return;
    }

    const enabled = this.buttons.filter((btn) => !btn.disabled);
    if (enabled.length === 0) return;

    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    let currentIndex = enabled.findIndex((btn) => btn === activeElement);
    if (currentIndex === -1) {
      currentIndex = enabled.findIndex((btn) => btn.tabIndex === 0);
    }
    if (currentIndex === -1) currentIndex = 0;

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

    const nextBtn = enabled[nextIndex]!;
    event.preventDefault();
    this.activeActionId =
      (nextBtn.getAttribute("data-gg-action") as ToolbarOptionId | null) ?? null;
    this.applyRovingTabIndex();
    nextBtn.focus();
  }

  private buildActionButton(
    actionId: GuidedActionId,
    state: ToolbarRenderState,
  ): HTMLButtonElement | null {
    const config = state.settings.actions[actionId];
    if (!config?.enabled) return null;

    const meta = ACTION_METADATA[actionId];
    const isThisRunning = state.activeRun?.actionId === actionId;
    const isOtherRunning = Boolean(state.activeRun) && !isThisRunning;
    const disabled = !state.hasActiveChat || isOtherRunning;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gg-btn";
    if (isThisRunning) btn.classList.add("is-running");
    if (disabled) btn.classList.add("is-dimmed");
    btn.disabled = disabled;
    btn.setAttribute("data-gg-action", actionId);
    btn.setAttribute("aria-label", isThisRunning ? `Stop ${meta.label}` : meta.label);
    if (actionId === "guided_swipe" && !isThisRunning) {
      btn.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
      btn.title =
        "Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";
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

  private clearActiveHold(): void {
    if (this.activeHoldCancel) {
      const cancel = this.activeHoldCancel;
      this.activeHoldCancel = null;
      cancel();
    }
  }

  private clearPostHoldClickSuppression(): void {
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

  private armPostHoldClickSuppression(onSuppressionCleared?: () => void): void {
    this.clearPostHoldClickSuppression();
    this.suppressNextHoldClick = true;
    this.postHoldCleanup = onSuppressionCleared ?? null;

    if (typeof document === "undefined") return;

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

  private attachLongPressHandlers(
    btn: HTMLButtonElement,
    state: ToolbarRenderState,
    isThisRunning: boolean,
    disabled: boolean,
    options: {
      onClick: (event: MouseEvent) => void;
      onHold: () => void;
      onShortcutKeyDown: (event: KeyboardEvent) => boolean;
    },
  ): void {
    const hold: {
      timer: ReturnType<typeof setTimeout> | undefined;
      x: number;
      y: number;
      fired: boolean;
    } = {
      timer: undefined,
      x: 0,
      y: 0,
      fired: false,
    };

    const doc = typeof document !== "undefined" ? document : null;
    const win =
      typeof window !== "undefined" ? window : (doc?.defaultView ?? null);
    let holdListenersAttached = false;

    const detachHoldCancelListeners = () => {
      if (!holdListenersAttached) return;
      holdListenersAttached = false;
      win?.removeEventListener("blur", cancelHold);
      doc?.removeEventListener("visibilitychange", cancelHold);
    };

    const attachHoldCancelListeners = () => {
      if (holdListenersAttached) return;
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
      if (disabled || state.activeRun) return;
      if (!event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

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
      if (hold.timer === undefined) return;
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
      if (disabled || isThisRunning || state.activeRun) return;
      if (options.onShortcutKeyDown(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  private attachSwipeHoldHandlers(
    btn: HTMLButtonElement,
    state: ToolbarRenderState,
    isThisRunning: boolean,
    disabled: boolean,
  ): void {
    this.attachLongPressHandlers(btn, state, isThisRunning, disabled, {
      onClick: (event) => {
        this.handlers.onTriggerAction("guided_swipe", {
          backgroundSwipe: Boolean(event.ctrlKey || event.metaKey),
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
      },
    });
  }

  private attachContinueHoldHandlers(
    btn: HTMLButtonElement,
    state: ToolbarRenderState,
    isThisRunning: boolean,
    disabled: boolean,
  ): void {
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
        if (
          (event.shiftKey && event.key === "F10") ||
          (event.altKey && event.key === "ArrowUp") ||
          ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        ) {
          this.openContinueMenu(btn);
          return true;
        }
        return false;
      },
    });
  }

  private openContinueMenu(anchorBtn: HTMLButtonElement): void {
    if (typeof document === "undefined" || !document.body) return;
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
        onSelect: () => this.handlers.onRemoveLastContinue(),
      },
      {
        id: "regenerate_last_continue",
        label: "Regenerate last continue",
        icon: CONTINUE_MENU_ICONS.regenerate_last_continue,
        onSelect: () => this.handlers.onRegenerateLastContinue(),
      },
    ] as const;

    const items: HTMLButtonElement[] = [];
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

    const onMenuKeyDown = (event: KeyboardEvent) => {
      const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
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

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeContinueMenu({ restoreFocus: true });
      }
    };

    const onOutsidePointerDown = (event: Event) => {
      if (Date.now() - openedAt < MENU_DISMISS_GRACE_MS) return;
      const target = event.target as Node | null;
      if (
        target &&
        (menuEl.contains(target) || target === anchorBtn || anchorBtn.contains(target))
      ) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };

    const onOutsideClick = (event: Event) => {
      if (this.suppressNextHoldClick) return;
      if (Date.now() - openedAt < MENU_DISMISS_GRACE_MS) return;
      const target = event.target as Node | null;
      if (target && (menuEl.contains(target) || target === anchorBtn || anchorBtn.contains(target))) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };

    const onViewportResize = () => {
      this.closeContinueMenu({ restoreFocus: false });
    };

    const onViewportScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && menuEl.contains(target)) return;
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

  private positionContinueMenu(menuEl: HTMLDivElement, anchorBtn: HTMLButtonElement): void {
    const rect = anchorBtn.getBoundingClientRect();
    const win = typeof window !== "undefined" ? window : document.defaultView;
    const getStyle =
      typeof getComputedStyle === "function"
        ? getComputedStyle
        : win?.getComputedStyle?.bind(win);
    const bodyStyle = getStyle && document.body ? getStyle(document.body) : null;
    const zoomVal = bodyStyle ? parseFloat(bodyStyle.zoom) : NaN;
    const scaleProp =
      bodyStyle && typeof bodyStyle.getPropertyValue === "function"
        ? parseFloat(bodyStyle.getPropertyValue("scale"))
        : NaN;
    const varScale =
      bodyStyle && typeof bodyStyle.getPropertyValue === "function"
        ? parseFloat(bodyStyle.getPropertyValue("--lumiverse-ui-scale"))
        : NaN;
    const uiScale =
      Number.isFinite(zoomVal) && zoomVal > 0 && zoomVal !== 1
        ? zoomVal
        : Number.isFinite(scaleProp) && scaleProp > 0 && scaleProp !== 1
          ? scaleProp
          : Number.isFinite(varScale) && varScale > 0 && varScale !== 1
            ? varScale
            : 1;
    const vw =
      win && typeof win.innerWidth === "number"
        ? win.innerWidth
        : document.documentElement?.clientWidth || 1024;
    const vh =
      win && typeof win.innerHeight === "number"
        ? win.innerHeight
        : document.documentElement?.clientHeight || 768;

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

  private closeContinueMenu(options: { restoreFocus: boolean }): void {
    const session = this.continueMenu;
    if (!session) return;
    this.continueMenu = null;
    session.anchorBtn.setAttribute("aria-expanded", "false");
    session.cleanup();
    if (
      options.restoreFocus &&
      session.anchorBtn.isConnected &&
      !session.anchorBtn.disabled
    ) {
      session.anchorBtn.focus();
    }
  }

  private buildRecoveryButton(state: ToolbarRenderState): HTMLButtonElement | null {
    if (!state.settings.inputRecovery.enabled) return null;

    const hasRecovery = state.recovery.length > 0;
    const disabled = Boolean(state.activeRun);
    const latestPreview = state.recovery[0]?.text
      ? ` ("${state.recovery[0].text.replace(/\s+/g, " ").trim().slice(0, 48)}")`
      : "";

    const recoverBtn = document.createElement("button");
    recoverBtn.type = "button";
    recoverBtn.className = "gg-btn";
    if (disabled) recoverBtn.classList.add("is-dimmed");
    recoverBtn.disabled = disabled;
    recoverBtn.setAttribute("data-gg-action", "input_recovery");
    recoverBtn.setAttribute(
      "aria-label",
      hasRecovery ? "Restore last input" : "Clear current input",
    );
    recoverBtn.title = hasRecovery
      ? `Restore last cleared input${latestPreview}`
      : "Input Recovery — clear current input";
    recoverBtn.innerHTML = TOOLBAR_ICONS.input_recovery;

    recoverBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onRestoreLatest();
    });

    return recoverBtn;
  }

  private applyPlacement(placement: ToolbarPlacement, visible: boolean): void {
    this.toolbarEl.style.display = visible ? "inline-flex" : "none";

    if (placement === "below_bar") {
      if (!this.toolbarMountRoot) {
        this.toolbarMountRoot = this.ctx.ui.mount("chat_toolbar");
      }
      this.resetHostElement(this.actionsMountRoot, true);
      this.toolbarMountRoot.classList.remove(...HOST_CLASSES);
      this.toolbarMountRoot.classList.add("gg-actions-host--row");
      (this.toolbarMountRoot as HTMLElement).style.display = visible ? "flex" : "none";
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
    (this.actionsMountRoot as HTMLElement).style.display = visible ? "inline-flex" : "none";
    if (this.toolbarEl.parentElement !== this.actionsMountRoot) {
      this.actionsMountRoot.replaceChildren(this.toolbarEl);
    }
  }

  private resetHostElement(el: Element, clearChildren: boolean): void {
    el.classList.remove(...HOST_CLASSES);
    (el as HTMLElement).style.display = "none";
    if (clearChildren) el.replaceChildren();
  }

  destroy(): void {
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

