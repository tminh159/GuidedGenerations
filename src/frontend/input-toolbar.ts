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
import { STOP_ICON_SVG, TOOLBAR_ICONS } from "./icons";

export interface InputToolbarHandlers {
  onTriggerAction(actionId: GuidedActionId): void;
  onAbortAction(runId: string): void;
  onRestoreLatest(): void;
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

export class InputToolbarController {
  private readonly actionsMountRoot: Element;
  private toolbarMountRoot: Element | null = null;
  private readonly toolbarEl: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private activeActionId: ToolbarOptionId | null = null;
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

  private buildRecoveryButton(state: ToolbarRenderState): HTMLButtonElement | null {
    if (!state.settings.inputRecovery.enabled) return null;

    const hasRecovery = state.recovery.length > 0;
    const disabled = !hasRecovery || Boolean(state.activeRun);
    const latestPreview = state.recovery[0]?.text
      ? ` ("${state.recovery[0].text.replace(/\s+/g, " ").trim().slice(0, 48)}")`
      : "";

    const recoverBtn = document.createElement("button");
    recoverBtn.type = "button";
    recoverBtn.className = "gg-btn";
    if (disabled) recoverBtn.classList.add("is-dimmed");
    recoverBtn.disabled = disabled;
    recoverBtn.setAttribute("data-gg-action", "input_recovery");
    recoverBtn.setAttribute("aria-label", "Restore last input");
    recoverBtn.title = hasRecovery
      ? `Restore last cleared input${latestPreview}`
      : "Input Recovery — no saved input yet";
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

