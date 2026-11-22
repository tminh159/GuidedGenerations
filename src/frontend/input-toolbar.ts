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
import {
  CONTINUE_MENU_ICONS,
  RECOVERY_MENU_ICONS,
  STOP_ICON_SVG,
  TOOLBAR_ICONS,
} from "./icons";
import { formatRecoverySnippet } from "./recovery-store";

export interface InputToolbarHandlers {
  onTriggerAction(
    actionId: GuidedActionId,
    options?: { backgroundSwipe?: boolean },
  ): void;
  onAbortAction(runId: string): void;
  onRestoreLatest(): void;
  onRestoreEntry?(entry: RecoveryEntry): void;
  onClearRecovery?(): void;
  onRemoveLastContinue(): void;
  onRegenerateLastContinue(): void;
}

export interface ToolbarRenderState {
  settings: GuidedGenerationsSettings;
  activeRun: ActiveRunState | null;
  isBusy?: boolean;
  recovery: readonly RecoveryEntry[];
  hasActiveChat: boolean;
  chatId?: string | null;
}

interface ToolbarRenderSignature {
  placement: ToolbarPlacement;
  order: readonly ToolbarOptionId[];
  enabledMask: number;
  hasActiveChat: boolean;
  hasActiveRun: boolean;
  isBusy: boolean;
  activeRunId: string | null;
  activeRunActionId: GuidedActionId | null;
  hasRecovery: boolean;
  latestRecoveryPreview: string;
}

function formatLatestRecoveryPreview(recovery: readonly RecoveryEntry[]): string {
  return recovery[0]?.text
    ? ` ("${recovery[0].text.replace(/\s+/g, " ").trim().slice(0, 48)}")`
    : "";
}

function buildToolbarRenderSignature(
  state: ToolbarRenderState,
): ToolbarRenderSignature {
  const placement = normalizeToolbarPlacement(state.settings.toolbarPlacement);
  const order = normalizeButtonOrder(state.settings.buttonOrder);
  let enabledMask = 0;
  if (state.settings.actions.guided_response?.enabled) enabledMask |= 1 << 0;
  if (state.settings.actions.guided_continue?.enabled) enabledMask |= 1 << 1;
  if (state.settings.actions.guided_regenerate?.enabled) enabledMask |= 1 << 2;
  if (state.settings.actions.guided_swipe?.enabled) enabledMask |= 1 << 3;
  if (state.settings.actions.guided_impersonate?.enabled) enabledMask |= 1 << 4;
  if (state.settings.inputRecovery.enabled) enabledMask |= 1 << 5;

  const recoveryEnabled = Boolean(state.settings.inputRecovery.enabled);
  const hasRecovery = recoveryEnabled && state.recovery.length > 0;

  return {
    placement,
    order,
    enabledMask,
    hasActiveChat: Boolean(state.hasActiveChat),
    hasActiveRun: Boolean(state.activeRun),
    isBusy: Boolean(state.isBusy || state.activeRun),
    activeRunId: state.activeRun?.runId ?? null,
    activeRunActionId: state.activeRun?.actionId ?? null,
    hasRecovery,
    latestRecoveryPreview: hasRecovery
      ? formatLatestRecoveryPreview(state.recovery)
      : "",
  };
}

function areCoreToolbarSignaturesEqual(
  a: ToolbarRenderSignature,
  b: ToolbarRenderSignature,
): boolean {
  if (
    a.placement !== b.placement ||
    a.enabledMask !== b.enabledMask ||
    a.hasActiveChat !== b.hasActiveChat ||
    a.hasActiveRun !== b.hasActiveRun ||
    a.isBusy !== b.isBusy ||
    a.activeRunId !== b.activeRunId ||
    a.activeRunActionId !== b.activeRunActionId ||
    a.order.length !== b.order.length
  ) {
    return false;
  }
  for (let i = 0; i < a.order.length; i += 1) {
    if (a.order[i] !== b.order[i]) return false;
  }
  return true;
}

function areToolbarSignaturesEqual(
  a: ToolbarRenderSignature,
  b: ToolbarRenderSignature,
): boolean {
  return (
    areCoreToolbarSignaturesEqual(a, b) &&
    a.hasRecovery === b.hasRecovery &&
    a.latestRecoveryPreview === b.latestRecoveryPreview
  );
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
const PRE_RELEASE_SUPPRESS_FALLBACK_MS = 3000;
const POST_RELEASE_SUPPRESS_MS = 0;
const POST_RELEASE_MAX_WINDOW_MS = 250;

interface ContinueMenuSession {
  kind: "continue" | "recovery";
  menuEl: HTMLDivElement;
  anchorBtn: HTMLButtonElement;
  items: HTMLButtonElement[];
  cleanup: () => void;
  refreshRecovery?: () => void;
}

interface ToolbarButtonEntry {
  btn: HTMLButtonElement;
  iconKey: string;
}

export class InputToolbarController {
  private readonly actionsMountRoot: Element;
  private toolbarMountRoot: Element | null = null;
  private readonly toolbarEl: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private buttonPool = new Map<ToolbarOptionId, ToolbarButtonEntry>();
  private latestState: ToolbarRenderState | null = null;
  private activeActionId: ToolbarOptionId | null = null;
  private activeHoldCancel: (() => void) | null = null;
  private suppressNextHoldClick = false;
  private suppressHoldClickActionId: string | null = null;
  private suppressHoldClickUntil = 0;
  private clearSuppressHoldClickTimer: ReturnType<typeof setTimeout> | null = null;
  private holdReleaseCleanup: (() => void) | null = null;
  private postHoldCleanup: (() => void) | null = null;
  private continueMenu: ContinueMenuSession | null = null;
  private latestRecovery: readonly RecoveryEntry[] = [];
  private lastRenderSignature: ToolbarRenderSignature | null = null;
  private lastChatId: string | null | undefined = undefined;
  private destroyed = false;
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
    if (this.destroyed) return;

    this.latestState = state;

    const chatChanged =
      state.chatId !== undefined &&
      this.lastChatId !== undefined &&
      state.chatId !== this.lastChatId;
    if (state.chatId !== undefined) {
      this.lastChatId = state.chatId;
    }

    const nextSignature = buildToolbarRenderSignature(state);
    const targetMount =
      nextSignature.placement === "below_bar"
        ? this.toolbarMountRoot
        : this.actionsMountRoot;
    const isAttachedToTarget =
      targetMount !== null &&
      this.toolbarEl.parentElement === targetMount &&
      this.toolbarEl.childElementCount === this.buttons.length;

    if (
      this.lastRenderSignature !== null &&
      isAttachedToTarget &&
      areToolbarSignaturesEqual(this.lastRenderSignature, nextSignature)
    ) {
      this.latestRecovery = state.recovery;
      if (chatChanged) {
        this.closeContinueMenu({ restoreFocus: false });
        this.clearActiveHold();
      } else if (this.continueMenu?.kind === "recovery") {
        this.continueMenu.refreshRecovery?.();
      }
      return;
    }

    const preserveRecoveryMenu =
      !chatChanged &&
      this.continueMenu?.kind === "recovery" &&
      this.lastRenderSignature !== null &&
      isAttachedToTarget &&
      areCoreToolbarSignaturesEqual(this.lastRenderSignature, nextSignature);

    if (!preserveRecoveryMenu) {
      this.closeContinueMenu({ restoreFocus: false });
      this.clearActiveHold();
    }
    this.latestRecovery = state.recovery;

    const visibleIds: ToolbarOptionId[] = [];
    for (const optionId of nextSignature.order) {
      const enabled =
        optionId === "input_recovery"
          ? Boolean(state.settings.inputRecovery.enabled)
          : Boolean(state.settings.actions[optionId]?.enabled);
      if (enabled) visibleIds.push(optionId);
    }

    const canUpdateInPlace =
      this.buttons.length === visibleIds.length &&
      this.toolbarEl.childElementCount === visibleIds.length &&
      this.buttons.every(
        (btn, index) => btn.getAttribute("data-gg-action") === visibleIds[index],
      );

    if (canUpdateInPlace) {
      for (const optionId of visibleIds) {
        const entry = this.buttonPool.get(optionId);
        if (entry) {
          this.syncOptionButton(entry, optionId, state);
        }
      }
      this.applyRovingTabIndex();
      this.applyPlacement(nextSignature.placement, visibleIds.length > 0);
      this.lastRenderSignature = nextSignature;
      if (preserveRecoveryMenu) {
        this.continueMenu?.refreshRecovery?.();
      }
      return;
    }

    if (preserveRecoveryMenu) {
      this.closeContinueMenu({ restoreFocus: false });
      this.clearActiveHold();
    }

    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    const focusedActionId =
      activeEl && this.toolbarEl.contains(activeEl)
        ? ((activeEl as Element).getAttribute?.("data-gg-action") as ToolbarOptionId | null)
        : null;

    const buttons: HTMLButtonElement[] = [];
    for (const optionId of visibleIds) {
      const entry = this.getOrCreateOptionButton(optionId);
      this.syncOptionButton(entry, optionId, state);
      buttons.push(entry.btn);
    }

    this.buttons = buttons;
    this.toolbarEl.replaceChildren(...buttons);

    const matchingBtn = focusedActionId
      ? this.buttons.find(
          (btn) => !btn.disabled && btn.getAttribute("data-gg-action") === focusedActionId,
        )
      : undefined;
    if (matchingBtn && focusedActionId) {
      this.activeActionId = focusedActionId;
    }
    this.applyRovingTabIndex();

    const visible = buttons.length > 0;
    this.applyPlacement(nextSignature.placement, visible);
    this.lastRenderSignature = nextSignature;

    if (matchingBtn) {
      matchingBtn.focus();
    }
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

  private getOrCreateOptionButton(optionId: ToolbarOptionId): ToolbarButtonEntry {
    const existing = this.buttonPool.get(optionId);
    if (existing) return existing;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gg-btn";
    btn.setAttribute("data-gg-action", optionId);

    const entry: ToolbarButtonEntry = { btn, iconKey: "" };
    if (optionId === "input_recovery") {
      entry.iconKey = "input_recovery";
      btn.innerHTML = TOOLBAR_ICONS.input_recovery;
      this.attachRecoveryHoldHandlers(btn);
    } else if (optionId === "guided_swipe") {
      this.attachSwipeHoldHandlers(btn);
    } else if (optionId === "guided_continue") {
      this.attachContinueHoldHandlers(btn);
    } else {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const activeRun = this.latestState?.activeRun;
        if (activeRun?.actionId === optionId) {
          this.handlers.onAbortAction(activeRun.runId);
        } else {
          this.handlers.onTriggerAction(optionId);
        }
      });
    }

    this.buttonPool.set(optionId, entry);
    return entry;
  }

  private syncOptionButton(
    entry: ToolbarButtonEntry,
    optionId: ToolbarOptionId,
    state: ToolbarRenderState,
  ): void {
    if (optionId === "input_recovery") {
      this.syncRecoveryButton(entry, state);
      return;
    }
    this.syncActionButton(entry, optionId, state);
  }

  private syncActionButton(
    entry: ToolbarButtonEntry,
    actionId: GuidedActionId,
    state: ToolbarRenderState,
  ): void {
    const { btn } = entry;
    const meta = ACTION_METADATA[actionId];
    const isThisRunning = state.activeRun?.actionId === actionId;
    const isOtherRunning = Boolean(state.activeRun) && !isThisRunning;
    const isBusyWithoutRun = Boolean(state.isBusy) && !state.activeRun;
    const disabled = !state.hasActiveChat || isOtherRunning || isBusyWithoutRun;

    btn.classList.toggle("is-running", isThisRunning);
    btn.classList.toggle("is-dimmed", disabled);
    btn.disabled = disabled;
    btn.setAttribute("aria-label", isThisRunning ? `Stop ${meta.label}` : meta.label);

    if (actionId === "guided_swipe" && !isThisRunning) {
      btn.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
      btn.removeAttribute("aria-haspopup");
      btn.removeAttribute("aria-expanded");
      btn.title =
        "Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";
    } else if (actionId === "guided_continue" && !isThisRunning) {
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-keyshortcuts", "Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");
      btn.title = "Guided Continue — click to continue, hold for continue options";
    } else {
      btn.removeAttribute("aria-keyshortcuts");
      btn.removeAttribute("aria-haspopup");
      btn.removeAttribute("aria-expanded");
      btn.title = isThisRunning ? `Stop ${meta.label}` : meta.tooltip;
    }

    const nextIconKey = isThisRunning ? "stop" : actionId;
    if (entry.iconKey !== nextIconKey) {
      entry.iconKey = nextIconKey;
      btn.innerHTML = isThisRunning ? STOP_ICON_SVG : TOOLBAR_ICONS[actionId];
    }
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

  private isHoldClickSuppressed(targetBtn?: HTMLButtonElement): boolean {
    if (!this.suppressNextHoldClick) return false;
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

  private armPostHoldClickSuppression(
    targetBtn: HTMLButtonElement,
    onSuppressionCleared?: () => void,
  ): void {
    this.clearPostHoldClickSuppression();
    this.suppressNextHoldClick = true;
    this.suppressHoldClickActionId = targetBtn.getAttribute("data-gg-action");
    this.suppressHoldClickUntil = Date.now() + PRE_RELEASE_SUPPRESS_FALLBACK_MS;
    this.postHoldCleanup = onSuppressionCleared ?? null;

    if (typeof document === "undefined") return;
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

    const onRelease = (event: PointerEvent) => {
      cleanupListeners();
      if (this.clearSuppressHoldClickTimer !== null) {
        clearTimeout(this.clearSuppressHoldClickTimer);
      }
      const suppressWindowMs =
        event.type === "pointercancel" || event.pointerType === "mouse"
          ? POST_RELEASE_SUPPRESS_MS
          : POST_RELEASE_MAX_WINDOW_MS;
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

  private attachLongPressHandlers(
    btn: HTMLButtonElement,
    actionId: ToolbarOptionId,
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
      if (btn.disabled || this.latestState?.activeRun || this.latestState?.isBusy) return;
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
        this.armPostHoldClickSuppression(btn, () => {
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
    btn.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      cancelHold();
    });

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
      const activeRun = this.latestState?.activeRun;
      if (actionId !== "input_recovery" && activeRun?.actionId === actionId) {
        this.handlers.onAbortAction(activeRun.runId);
      } else {
        options.onClick(event);
      }
    });

    btn.addEventListener("keydown", (event) => {
      if (btn.disabled || this.latestState?.activeRun || this.latestState?.isBusy) return;
      if (options.onShortcutKeyDown(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  private attachSwipeHoldHandlers(btn: HTMLButtonElement): void {
    this.attachLongPressHandlers(btn, "guided_swipe", {
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

  private attachContinueHoldHandlers(btn: HTMLButtonElement): void {
    this.attachLongPressHandlers(btn, "guided_continue", {
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
    if (this.destroyed || typeof document === "undefined" || !document.body) return;
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
    const initialAnchorRect = this.positionContinueMenu(menuEl, anchorBtn);

    const cleanup = this.attachDropupMenuLifecycle({
      menuEl,
      anchorBtn,
      items,
      initialAnchorRect,
    });

    this.continueMenu = { kind: "continue", menuEl, anchorBtn, items, cleanup };
    items[0]?.focus();
  }

  private attachDropupMenuLifecycle(options: {
    menuEl: HTMLDivElement;
    anchorBtn: HTMLButtonElement;
    items: HTMLButtonElement[];
    initialAnchorRect: DOMRect;
    onBackKey?: () => boolean;
  }): () => void {
    const { menuEl, anchorBtn, items, initialAnchorRect, onBackKey } = options;
    const openedAt = Date.now();

    const onMenuKeyDown = (event: KeyboardEvent) => {
      const focusable = items.filter((el) => !el.disabled);
      const activeIdx = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        if (focusable.length === 0) return;
        const nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % focusable.length;
        focusable[nextIdx]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (focusable.length === 0) return;
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
      } else if (
        onBackKey &&
        (event.key === "ArrowLeft" || event.key === "Backspace") &&
        onBackKey()
      ) {
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === "Escape" || event.key === "Tab") {
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
      if (this.isHoldClickSuppressed(anchorBtn)) return;
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

    const win = typeof window !== "undefined" ? window : document.defaultView;
    const visualVp = win?.visualViewport ?? null;
    let lastVw = win?.innerWidth;
    let lastVh = win?.innerHeight;
    let lastAnchorRect = initialAnchorRect;
    let resizeRafId: number | null = null;

    const anchorPositionChanged = (): boolean => {
      if (!anchorBtn.isConnected) return true;
      const nextRect = anchorBtn.getBoundingClientRect();
      return (
        Math.abs(nextRect.left - lastAnchorRect.left) > 0.5 ||
        Math.abs(nextRect.top - lastAnchorRect.top) > 0.5 ||
        Math.abs(nextRect.right - lastAnchorRect.right) > 0.5 ||
        Math.abs(nextRect.bottom - lastAnchorRect.bottom) > 0.5
      );
    };

    const scheduleReposition = () => {
      if (typeof requestAnimationFrame === "function") {
        if (resizeRafId !== null) return;
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          if (this.destroyed || !anchorBtn.isConnected || anchorBtn.disabled || !menuEl.isConnected) {
            return;
          }
          lastAnchorRect = this.positionContinueMenu(menuEl, anchorBtn);
        });
      } else {
        lastAnchorRect = this.positionContinueMenu(menuEl, anchorBtn);
      }
    };

    const handleViewportResize = (fromVisualViewport: boolean) => {
      if (!anchorBtn.isConnected || anchorBtn.disabled || !menuEl.isConnected) {
        this.closeContinueMenu({ restoreFocus: false });
        return;
      }
      const nextVw = win?.innerWidth;
      const nextVh = win?.innerHeight;
      const dimensionsChanged = nextVw !== lastVw || nextVh !== lastVh;
      lastVw = nextVw;
      lastVh = nextVh;
      if (!fromVisualViewport && !visualVp && !dimensionsChanged) {
        this.closeContinueMenu({ restoreFocus: false });
        return;
      }
      scheduleReposition();
    };

    const onViewportResize = () => {
      handleViewportResize(false);
    };

    const onVisualViewportResize = () => {
      handleViewportResize(true);
    };

    const onViewportScroll = (event: Event) => {
      const target = event.target as EventTarget | null;
      if (
        target &&
        typeof (target as Node).nodeType === "number" &&
        menuEl.contains(target as Node)
      ) {
        return;
      }
      const isRootScroll =
        target === null ||
        target === document ||
        target === win ||
        target === document.documentElement ||
        target === document.body;
      const targetContainsAnchor =
        target !== null &&
        typeof (target as Node).contains === "function" &&
        (target as Node).contains(anchorBtn);

      if (!isRootScroll && !targetContainsAnchor && !anchorPositionChanged()) {
        return;
      }
      this.closeContinueMenu({ restoreFocus: false });
    };

    menuEl.addEventListener("keydown", onMenuKeyDown);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    document.addEventListener("click", onOutsideClick, true);
    document.addEventListener("scroll", onViewportScroll, { capture: true, passive: true });
    win?.addEventListener("resize", onViewportResize);
    visualVp?.addEventListener("resize", onVisualViewportResize);

    return () => {
      if (resizeRafId !== null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(resizeRafId);
        }
        resizeRafId = null;
      }
      menuEl.removeEventListener("keydown", onMenuKeyDown);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      document.removeEventListener("click", onOutsideClick, true);
      document.removeEventListener("scroll", onViewportScroll, { capture: true });
      win?.removeEventListener("resize", onViewportResize);
      visualVp?.removeEventListener("resize", onVisualViewportResize);
      menuEl.remove();
    };
  }

  private positionContinueMenu(menuEl: HTMLDivElement, anchorBtn: HTMLButtonElement): DOMRect {
    const historyListEl = menuEl.querySelector<HTMLElement>(".gg-dropup-history-list");
    const headerEl = historyListEl
      ? menuEl.querySelector<HTMLElement>(".gg-dropup-header")
      : null;

    // Reset any prior height constraints before measuring natural dimensions.
    if (menuEl.style.maxHeight) menuEl.style.maxHeight = "";
    if (menuEl.style.overflowY) menuEl.style.overflowY = "";
    if (historyListEl && historyListEl.style.maxHeight) {
      historyListEl.style.maxHeight = "";
    }

    // Batch all DOM/layout reads before writing styles to avoid forced synchronous reflows.
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
    const rawVw =
      win && typeof win.innerWidth === "number"
        ? win.innerWidth
        : document.documentElement?.clientWidth || 1024;
    const rawVh =
      win && typeof win.innerHeight === "number"
        ? win.innerHeight
        : document.documentElement?.clientHeight || 768;
    const visualVp = win?.visualViewport;
    const vw =
      visualVp &&
      typeof visualVp.width === "number" &&
      Number.isFinite(visualVp.width) &&
      visualVp.width > 0 &&
      visualVp.width < rawVw
        ? visualVp.width
        : rawVw;
    const vh =
      visualVp &&
      typeof visualVp.height === "number" &&
      Number.isFinite(visualVp.height) &&
      visualVp.height > 0 &&
      visualVp.height < rawVh
        ? visualVp.height
        : rawVh;

    const rawMenuWidth = menuEl.offsetWidth;
    const rawMenuHeight = menuEl.offsetHeight;
    const rawHistoryListHeight = historyListEl ? historyListEl.offsetHeight : 0;
    const rawHeaderHeight = headerEl ? headerEl.offsetHeight : 0;

    // Compute layout coordinates purely in JS.
    const menuWidth = rawMenuWidth * uiScale;
    const menuHeight = rawMenuHeight * uiScale;
    const gapPx = 6;
    const edgePadding = 8;

    const maxLeft = Math.max(edgePadding, vw - menuWidth - edgePadding);
    const clampedLeft = Math.max(edgePadding, Math.min(rect.left, maxLeft));

    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    const neededHeight = menuHeight + gapPx * uiScale + edgePadding;
    const flipBelow = spaceAbove < neededHeight && spaceBelow > spaceAbove;

    let topCss = "";
    let bottomCss = "";
    let availableViewportPx: number;
    if (flipBelow) {
      const topVal = Math.max(edgePadding / uiScale, rect.bottom / uiScale + gapPx);
      topCss = `${topVal}px`;
      availableViewportPx = Math.max(0, vh - topVal * uiScale - edgePadding);
    } else {
      bottomCss = `${(vh - rect.top) / uiScale + gapPx}px`;
      availableViewportPx = Math.max(0, spaceAbove - gapPx * uiScale - edgePadding);
    }

    const maxMenuHeightCss = Math.max(0, Math.floor(availableViewportPx / uiScale));
    let listMaxCss: number | null = null;
    if (historyListEl) {
      const chromeHeightCss =
        rawHistoryListHeight > 0 && rawMenuHeight >= rawHistoryListHeight
          ? rawMenuHeight - rawHistoryListHeight
          : (rawHeaderHeight || 32) + 12;
      listMaxCss = Math.min(220, Math.max(0, maxMenuHeightCss - chromeHeightCss));
    }

    // Batch all style writes together.
    menuEl.style.left = `${clampedLeft / uiScale}px`;
    menuEl.style.top = topCss;
    menuEl.style.bottom = bottomCss;
    menuEl.style.maxHeight = `${maxMenuHeightCss}px`;
    menuEl.style.overflowY = "auto";
    if (historyListEl && listMaxCss !== null) {
      historyListEl.style.maxHeight = `${listMaxCss}px`;
    }
    return rect;
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

  private syncRecoveryButton(
    entry: ToolbarButtonEntry,
    state: ToolbarRenderState,
  ): void {
    const { btn } = entry;
    const hasRecovery = state.recovery.length > 0;
    const disabled = Boolean(state.activeRun || state.isBusy);
    const latestPreview = formatLatestRecoveryPreview(state.recovery);
    const isRecoveryMenuOpen =
      this.continueMenu?.kind === "recovery" && this.continueMenu.anchorBtn === btn;

    btn.classList.toggle("is-dimmed", disabled);
    btn.disabled = disabled;
    btn.setAttribute(
      "aria-label",
      hasRecovery ? "Restore last input" : "Clear current input",
    );
    if (!disabled) {
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", isRecoveryMenuOpen ? "true" : "false");
      btn.setAttribute(
        "aria-keyshortcuts",
        "Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter",
      );
    } else {
      btn.removeAttribute("aria-haspopup");
      btn.removeAttribute("aria-expanded");
      btn.removeAttribute("aria-keyshortcuts");
    }
    btn.title = hasRecovery
      ? `Restore last cleared input${latestPreview}`
      : "Input Recovery — clear current input";
  }

  private attachRecoveryHoldHandlers(btn: HTMLButtonElement): void {
    this.attachLongPressHandlers(btn, "input_recovery", {
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
        if (
          (event.shiftKey && event.key === "F10") ||
          (event.altKey && event.key === "ArrowUp") ||
          ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        ) {
          this.openRecoveryMenu(btn);
          return true;
        }
        return false;
      },
    });
  }

  private openRecoveryMenu(anchorBtn: HTMLButtonElement): void {
    if (this.destroyed || typeof document === "undefined" || !document.body) return;
    this.closeContinueMenu({ restoreFocus: false });

    const menuEl = document.createElement("div");
    menuEl.className = "gg-dropup-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-label", "Input Recovery options");

    const items: HTMLButtonElement[] = [];
    let inHistoryView = false;

    const snapshotRecovery = () =>
      this.latestRecovery.map((entry) => ({
        id: entry.id,
        text: entry.text,
        actionId: entry.actionId,
      }));
    let renderedRecovery = snapshotRecovery();

    const hasRecoveryChanged = (): boolean => {
      if (renderedRecovery.length !== this.latestRecovery.length) return true;
      for (let i = 0; i < renderedRecovery.length; i += 1) {
        const prev = renderedRecovery[i]!;
        const next = this.latestRecovery[i]!;
        if (
          prev.id !== next.id ||
          prev.text !== next.text ||
          prev.actionId !== next.actionId
        ) {
          return true;
        }
      }
      return false;
    };

    const renderRootOptions = (focusFirst = true) => {
      inHistoryView = false;
      renderedRecovery = snapshotRecovery();
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
          },
        },
        {
          id: "clear_history",
          label: "Clear History",
          icon: RECOVERY_MENU_ICONS.clear_history,
          disabled: isHistoryEmpty,
          onSelect: () => {
            if (this.latestRecovery.length === 0) return;
            this.closeContinueMenu({ restoreFocus: false });
            this.handlers.onClearRecovery?.();
          },
        },
      ] as const;

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
          if (def.disabled) return;
          def.onSelect();
        });
        items.push(itemBtn);
        menuEl.append(itemBtn);
      }

      if (menuEl.isConnected) {
        this.positionContinueMenu(menuEl, anchorBtn);
        if (focusFirst) {
          items[0]?.focus();
        }
      }
    };

    const renderHistoryView = (focusInitial = true) => {
      inHistoryView = true;
      renderedRecovery = snapshotRecovery();
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
          itemBtn.setAttribute(
            "aria-label",
            `Restore ${actionLabel} draft: ${formatRecoverySnippet(entry.text, 40)}`,
          );
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
        if (focusInitial) {
          const initialFocusItem = this.latestRecovery.length > 0 ? items[1] ?? items[0] : items[0];
          initialFocusItem?.focus();
        }
      }
    };

    const refreshRecovery = () => {
      if (!hasRecoveryChanged()) return;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      const hadFocusInMenu = Boolean(active && menuEl.contains(active));
      const focusedRecoveryId = hadFocusInMenu
        ? (active as Element).getAttribute?.("data-gg-recovery-id")
        : null;
      const focusedMenuAction = hadFocusInMenu
        ? (active as Element).getAttribute?.("data-gg-menu-action")
        : null;

      if (inHistoryView) {
        renderHistoryView(false);
      } else {
        renderRootOptions(false);
      }

      if (hadFocusInMenu) {
        const nextFocus =
          (focusedRecoveryId
            ? items.find(
                (el) =>
                  !el.disabled &&
                  el.getAttribute("data-gg-recovery-id") === focusedRecoveryId,
              )
            : undefined) ??
          (focusedMenuAction
            ? items.find(
                (el) =>
                  !el.disabled &&
                  el.getAttribute("data-gg-menu-action") === focusedMenuAction,
              )
            : undefined) ??
          items.find((el) => !el.disabled);
        nextFocus?.focus();
      }
    };

    renderRootOptions();
    document.body.append(menuEl);
    anchorBtn.setAttribute("aria-expanded", "true");
    const initialAnchorRect = this.positionContinueMenu(menuEl, anchorBtn);

    const cleanup = this.attachDropupMenuLifecycle({
      menuEl,
      anchorBtn,
      items,
      initialAnchorRect,
      onBackKey: () => {
        if (!inHistoryView) return false;
        renderRootOptions();
        return true;
      },
    });

    this.continueMenu = {
      kind: "recovery",
      menuEl,
      anchorBtn,
      items,
      cleanup,
      refreshRecovery,
    };
    items[0]?.focus();
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
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeContinueMenu({ restoreFocus: false });
    this.clearActiveHold();
    this.clearPostHoldClickSuppression();
    this.toolbarEl.removeEventListener("keydown", this.onKeyDown);
    this.toolbarEl.removeEventListener("focusin", this.onFocusIn);
    this.buttons = [];
    this.buttonPool.clear();
    this.latestState = null;
    this.activeActionId = null;
    this.lastRenderSignature = null;
    this.lastChatId = undefined;
    this.toolbarEl.replaceChildren();
    this.resetHostElement(this.actionsMountRoot, true);
    if (this.toolbarMountRoot) {
      this.resetHostElement(this.toolbarMountRoot, true);
    }
  }
}

