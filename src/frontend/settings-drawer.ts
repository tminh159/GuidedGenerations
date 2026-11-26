import type {
  SpindleConnectionRef,
  SpindleDrawerTabHandle,
  SpindleFrontendContext,
  SpindleModelComboboxHandle,
  SpindleNumericInputHandle,
  SpindleSelectOption,
} from "lumiverse-spindle-types";
import {
  ACTION_METADATA,
  DEFAULT_APPLY_REGEX,
  DEFAULT_BUTTON_ORDER,
  DEFAULT_GUIDANCE_DEPTH,
  DEFAULT_SCENE_ADAPT_TEMPLATE,
  DEFAULT_SCENE_BRIDGE_TEMPLATE,
  DEFAULT_SCENE_CONTEXT_TURNS,
  DEFAULT_SCENE_READINESS_TAG,
  DEFAULT_SCENE_STEERING_TEMPLATE,
  DEFAULT_SCENE_SUMMARY_TEMPLATE,
  GUIDANCE_POSITION_OPTIONS,
  GUIDED_ACTION_ORDER,
  GUIDED_SCENE_CONTEXT_MODE_OPTIONS,
  GUIDED_SCENE_METADATA,
  SCENE_GUIDANCE_POSITION_OPTIONS,
  TOOLBAR_OPTION_LABELS,
  TOOLBAR_PLACEMENT_OPTIONS,
  normalizeButtonOrder,
  normalizeGuidanceDepth,
  normalizeGuidancePosition,
  normalizeGuidedSceneConfig,
  normalizeSceneContextMode,
  normalizeSceneContextTurns,
  normalizeSceneGuidancePosition,
  normalizeSceneReadinessTag,
  normalizeToolbarPlacement,
} from "../shared/defaults";
import type {
  ActiveRunState,
  ArmedSceneState,
  ConnectionOptionSummary,
  ExtensionBootstrapView,
  GuidanceInjectionRole,
  GuidancePosition,
  GuidedActionId,
  GuidedGenerationsSettings,
  GuidedSceneChatContext,
  GuidedSceneConfig,
  GuidedSceneContextMode,
  PresetOptionSummary,
  RecoveryEntry,
  SceneGuidancePosition,
  ToolbarOptionId,
  ToolbarPlacement,
} from "../shared/types";
import {
  mountExpandableTextArea,
  type ExpandableTextAreaHandle,
} from "./expandable-textarea";
import {
  DRAWER_NAV_ICONS,
  DRAWER_TAB_ICON_SVG,
  TOOLBAR_ICONS,
} from "./icons";
import { formatRecoverySnippet } from "./recovery-store";
import { GuidedScenePanel, type ScenePanelCallbacks } from "./scene-panel";

interface DestroyableHandle {
  destroy(): void;
}

export type DrawerNavTab = "basic" | "advanced";
export type AdvancedSubTab = "guided_scene";

export interface SaveSettingsOptions {
  rebuildDrawer?: boolean;
}

export interface SettingsDrawerHandlers {
  onRefresh(): void;
  onSaveSettings(next: GuidedGenerationsSettings, options?: SaveSettingsOptions): Promise<void>;
  onRestoreEntry(entry: RecoveryEntry): void;
  onClearRecovery(): Promise<void>;
  onActiveViewChange?(tab: DrawerNavTab, subTab: AdvancedSubTab): void;
  scene?: ScenePanelCallbacks;
}

export interface RenderDrawerOptions {
  force?: boolean;
}

interface PendingFocusRestore {
  optionId: ToolbarOptionId;
  button: "up" | "down";
}

interface PendingGeneralFocusRestore {
  focusKey?: string;
  tagName?: string;
  ariaLabel?: string;
}

interface DebouncedEntry {
  timer: ReturnType<typeof setTimeout>;
  flush: () => void;
}

interface RecoverySectionUi {
  setBadge: (nextText: string, muted?: boolean) => void;
  countLabel: HTMLSpanElement;
  clearBtn: HTMLButtonElement;
  body: HTMLDivElement;
  listEl: HTMLDivElement | null;
  entries: readonly RecoveryEntry[];
  maxEntries: number;
  recoveryCount: number;
}

interface AdvancedSubTabDef {
  id: AdvancedSubTab;
  label: string;
  iconSvg: string;
}

const ADVANCED_SUB_TABS: readonly AdvancedSubTabDef[] = [
  {
    id: "guided_scene",
    label: "Guided Scene",
    iconSvg: DRAWER_NAV_ICONS.scene,
  },
];

const ROLE_SELECT_OPTIONS: SpindleSelectOption[] = [
  { value: "system", label: "System" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
];

const TOOLBAR_PLACEMENT_SELECT_OPTIONS: SpindleSelectOption[] =
  TOOLBAR_PLACEMENT_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    sublabel: opt.sublabel,
  }));

const GUIDANCE_POSITION_SELECT_OPTIONS: SpindleSelectOption[] =
  GUIDANCE_POSITION_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    sublabel: opt.sublabel,
  }));

const SCENE_GUIDANCE_POSITION_SELECT_OPTIONS: SpindleSelectOption[] =
  SCENE_GUIDANCE_POSITION_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    sublabel: opt.sublabel,
  }));

const SCENE_CONTEXT_MODE_SELECT_OPTIONS: SpindleSelectOption[] =
  GUIDED_SCENE_CONTEXT_MODE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    sublabel: opt.sublabel,
  }));

export class SettingsDrawerController {
  private readonly tab: SpindleDrawerTabHandle;
  private handles: DestroyableHandle[] = [];
  private expandableTextAreas = new Set<ExpandableTextAreaHandle>();
  private currentSettings: GuidedGenerationsSettings | null = null;
  private expandedSections = new Set<string>();
  private debounceTimers = new Map<string, DebouncedEntry>();
  private orderStateTags = new Map<ToolbarOptionId, HTMLSpanElement>();

  // Persistent Media Localizer-style drawer shell (survives settings re-renders)
  private shellEl: HTMLDivElement | null = null;
  private navEl: HTMLElement | null = null;
  private navButtons = new Map<DrawerNavTab, HTMLButtonElement>();
  private navArmedDotEl: HTMLSpanElement | null = null;
  private subNavButtons = new Map<AdvancedSubTab, HTMLButtonElement>();
  private subNavArmedDotEl: HTMLSpanElement | null = null;
  private stickyNoticeSlotEl: HTMLDivElement | null = null;
  private bodyScrollEl: HTMLDivElement | null = null;
  private basicViewEl: HTMLDivElement | null = null;
  private advancedViewEl: HTMLDivElement | null = null;
  private basicHostEl: HTMLDivElement | null = null;
  private sceneWorkbenchHostEl: HTMLDivElement | null = null;
  private sceneSettingsHostEl: HTMLDivElement | null = null;

  private activeTab: DrawerNavTab = "basic";
  private activeAdvancedSubTab: AdvancedSubTab = "guided_scene";

  // Live Guided Scene workbench state (persists independently of settings re-renders)
  private scenePanel: GuidedScenePanel | null = null;
  private armedScene: ArmedSceneState | null = null;
  private sceneContext: GuidedSceneChatContext | null = null;
  private sceneContextError: string | null = null;
  private sceneLoading = false;
  private sceneActiveRun: ActiveRunState | null = null;

  private rootEl: HTMLDivElement | null = null;
  private noticeEl: HTMLDivElement | null = null;
  private recoveryUi: RecoverySectionUi | null = null;
  private pendingView: ExtensionBootstrapView | null = null;
  private pendingFocusRestore: PendingFocusRestore | null = null;
  private pendingGeneralFocusRestore: PendingGeneralFocusRestore | null = null;
  private pointerActiveInDrawer = false;
  private pointerReleaseCleanup: (() => void) | null = null;
  private pointerFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingViewFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private tabConnectionCleanups = new Set<() => void>();
  private noticeText = "";
  private noticeKind: "info" | "warn" | "error" = "info";
  private recoveryBusy = false;
  private destroyed = false;
  private readonly onFocusOut: (event: FocusEvent) => void;
  private readonly onPointerDownInDrawer: () => void;

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private readonly handlers: SettingsDrawerHandlers,
  ) {
    this.tab = ctx.ui.registerDrawerTab({
      id: "guided-generations-settings",
      title: "Guided Generations",
      shortName: "Guided",
      description:
        "Configure input-bar guided action buttons, per-option API profiles & presets, and Guided Scene transitions.",
      keywords: [
        "guided",
        "scene",
        "greeting",
        "steering",
        "continue",
        "regenerate",
        "swipe",
        "impersonate",
        "recovery",
        "preset",
        "profile",
      ],
      iconSvg: DRAWER_TAB_ICON_SVG,
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
      if (this.destroyed || this.pointerActiveInDrawer) return;
      this.pointerActiveInDrawer = true;
      clearPointerTracking();

      if (typeof document === "undefined") {
        this.pointerActiveInDrawer = false;
        return;
      }
      const win = typeof window !== "undefined" ? window : document.defaultView;

      const finishPointer = () => {
        clearPointerTracking();
        // Wait one macrotask so the browser's click event fires before any pendingView re-render.
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

    this.onFocusOut = (event: FocusEvent) => {
      if (this.destroyed) return;
      const nextTarget = event.relatedTarget as Node | null;
      if (this.debounceTimers.size > 0 && nextTarget !== event.target) {
        this.flushPendingSaves();
      }
      const stillInsideEditable =
        isElementNode(nextTarget) &&
        this.isInsideSettingsRegions(nextTarget) &&
        isEditableElement(nextTarget);
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

  getTabId(): string {
    return this.tab.tabId;
  }

  activate(): void {
    if (this.destroyed) return;
    try {
      this.tab.activate?.();
    } catch {
      // Ignore if host mock does not implement activate
    }
  }

  getActiveTab(): DrawerNavTab {
    return this.activeTab;
  }

  getActiveAdvancedSubTab(): AdvancedSubTab {
    return this.activeAdvancedSubTab;
  }

  isShowingGuidedScene(): boolean {
    return (
      this.activeTab === "advanced" &&
      this.activeAdvancedSubTab === "guided_scene"
    );
  }

  setActiveTab(tab: DrawerNavTab): void {
    if (this.destroyed) return;
    const changed = this.activeTab !== tab;
    this.activeTab = tab;
    if (this.shellEl) {
      this.syncActiveViewVisibility();
    }
    if (tab === "advanced" && this.activeAdvancedSubTab === "guided_scene") {
      this.ensureScenePanelMounted();
    }
    if (changed) {
      this.handlers.onActiveViewChange?.(this.activeTab, this.activeAdvancedSubTab);
    }
  }

  setActiveAdvancedSubTab(subTab: AdvancedSubTab): void {
    if (this.destroyed) return;
    const changed = this.activeAdvancedSubTab !== subTab;
    this.activeAdvancedSubTab = subTab;
    if (this.shellEl) {
      this.syncActiveViewVisibility();
    }
    if (this.activeTab === "advanced" && subTab === "guided_scene") {
      this.ensureScenePanelMounted();
    }
    if (changed && this.activeTab === "advanced") {
      this.handlers.onActiveViewChange?.(this.activeTab, this.activeAdvancedSubTab);
    }
  }

  openGuidedScene(): void {
    if (this.destroyed) return;
    const wasShowing = this.isShowingGuidedScene();
    this.activeTab = "advanced";
    this.activeAdvancedSubTab = "guided_scene";
    this.ensureShellMounted();
    this.syncActiveViewVisibility();
    this.ensureScenePanelMounted();
    if (!wasShowing) {
      this.handlers.onActiveViewChange?.("advanced", "guided_scene");
    }
  }

  setArmedScene(armed: ArmedSceneState | null, chatId?: string | null): void {
    if (this.destroyed) return;
    this.armedScene = armed;
    this.syncArmedNavDots();
    const effectiveChatId = chatId ?? armed?.chatId ?? this.sceneContext?.chatId ?? null;
    if (effectiveChatId) {
      this.scenePanel?.setArmedState(effectiveChatId, armed);
    }
  }

  setSceneContext(
    context: GuidedSceneChatContext | null,
    error: string | null = null,
  ): void {
    if (this.destroyed) return;
    this.sceneContext = context;
    this.sceneContextError = error;
    if (context && context.armedScene !== undefined) {
      this.armedScene = context.armedScene ?? null;
      this.syncArmedNavDots();
    }
    this.scenePanel?.setContext(context, { error });
  }

  setSceneLoading(loading: boolean): void {
    if (this.destroyed) return;
    this.sceneLoading = loading;
    this.scenePanel?.setLoading(loading);
  }

  setSceneActiveRun(run: ActiveRunState | null, isOtherBusy = false): void {
    if (this.destroyed) return;
    this.sceneActiveRun = run;
    this.scenePanel?.setActiveRun(run, isOtherBusy);
  }

  syncSettings(nextSettings: GuidedGenerationsSettings): void {
    if (this.destroyed) return;
    this.currentSettings = nextSettings;
    if (this.pendingView) {
      this.pendingView = { ...this.pendingView, settings: nextSettings };
    }
    this.scenePanel?.setSettings(nextSettings);
  }

  private ensureShellMounted(): void {
    if (this.shellEl && this.tab.root.contains(this.shellEl)) return;

    const shell = document.createElement("div");
    shell.className = "gg-drawer-root";

    // Top-level segmented navigation bar: Basic | Advanced
    const nav = document.createElement("nav");
    nav.className = "gg-drawer-nav";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Guided Generations Views");

    const topNavOrder: readonly DrawerNavTab[] = ["basic", "advanced"];
    this.navButtons.clear();
    const makeTopNavBtn = (
      tab: DrawerNavTab,
      label: string,
      iconSvg: string,
      withArmedDot = false,
    ): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `gg-nav-tab-${tab}`;
      btn.className = "gg-drawer-nav-btn";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", `gg-nav-panel-${tab}`);
      btn.setAttribute("data-gg-nav", tab);
      btn.dataset.ggFocusKey = `nav:${tab}`;

      const icon = document.createElement("span");
      icon.className = "gg-nav-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = iconSvg;

      const text = document.createElement("span");
      text.textContent = label;

      btn.append(icon, text);

      if (withArmedDot) {
        const dot = document.createElement("span");
        dot.className = "gg-nav-armed-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.style.display = "none";
        btn.append(dot);
        this.navArmedDotEl = dot;
      }

      btn.addEventListener("click", () => {
        this.flushPendingSaves();
        this.setActiveTab(tab);
      });
      this.navButtons.set(tab, btn);
      return btn;
    };

    nav.append(
      makeTopNavBtn("basic", "Basic", DRAWER_NAV_ICONS.basic, false),
      makeTopNavBtn("advanced", "Advanced", DRAWER_NAV_ICONS.advanced, true),
    );
    nav.addEventListener("keydown", (event) => {
      const idx = topNavOrder.indexOf(this.activeTab);
      let nextIdx = -1;
      if (event.key === "ArrowRight") nextIdx = (idx + 1) % topNavOrder.length;
      else if (event.key === "ArrowLeft")
        nextIdx = (idx - 1 + topNavOrder.length) % topNavOrder.length;
      else if (event.key === "Home") nextIdx = 0;
      else if (event.key === "End") nextIdx = topNavOrder.length - 1;
      if (nextIdx === -1) return;
      event.preventDefault();
      const targetTab = topNavOrder[nextIdx]!;
      this.flushPendingSaves();
      this.setActiveTab(targetTab);
      this.navButtons.get(targetTab)?.focus();
    });

    const stickyNoticeSlot = document.createElement("div");
    stickyNoticeSlot.className = "gg-drawer-sticky-slot";

    const bodyScroll = document.createElement("div");
    bodyScroll.className = "gg-drawer-body";

    // Basic view (all original Guided Generations settings & recovery)
    const basicView = document.createElement("div");
    basicView.id = "gg-nav-panel-basic";
    basicView.className = "gg-drawer-view gg-view-basic";
    basicView.setAttribute("role", "tabpanel");
    basicView.setAttribute("aria-labelledby", "gg-nav-tab-basic");
    basicView.setAttribute("data-gg-view", "basic");

    const basicHost = document.createElement("div");
    basicView.append(basicHost);

    // Advanced view (sub-tab strip + Guided Scene workbench + collapsible Guided Scene Settings)
    const advancedView = document.createElement("div");
    advancedView.id = "gg-nav-panel-advanced";
    advancedView.className = "gg-drawer-view gg-view-advanced";
    advancedView.setAttribute("role", "tabpanel");
    advancedView.setAttribute("aria-labelledby", "gg-nav-tab-advanced");
    advancedView.setAttribute("data-gg-view", "advanced");

    const subNav = document.createElement("div");
    subNav.className = "gg-subnav";
    subNav.setAttribute("role", "tablist");
    subNav.setAttribute("aria-label", "Advanced Guided Features");

    this.subNavButtons.clear();
    for (const def of ADVANCED_SUB_TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `gg-subnav-tab-${def.id}`;
      btn.className = "gg-subnav-btn";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", `gg-subnav-panel-${def.id}`);
      btn.setAttribute("data-gg-subnav", def.id);
      btn.dataset.ggFocusKey = `subnav:${def.id}`;

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.style.display = "inline-flex";
      icon.innerHTML = def.iconSvg;

      const text = document.createElement("span");
      text.textContent = def.label;
      btn.append(icon, text);

      if (def.id === "guided_scene") {
        const dot = document.createElement("span");
        dot.className = "gg-nav-armed-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.style.display = "none";
        btn.append(dot);
        this.subNavArmedDotEl = dot;
      }

      btn.addEventListener("click", () => {
        this.flushPendingSaves();
        this.setActiveAdvancedSubTab(def.id);
      });
      this.subNavButtons.set(def.id, btn);
      subNav.append(btn);
    }
    subNav.addEventListener("keydown", (event) => {
      if (ADVANCED_SUB_TABS.length === 0) return;
      const idx = ADVANCED_SUB_TABS.findIndex(
        (d) => d.id === this.activeAdvancedSubTab,
      );
      let nextIdx = -1;
      if (event.key === "ArrowRight")
        nextIdx = (idx + 1) % ADVANCED_SUB_TABS.length;
      else if (event.key === "ArrowLeft")
        nextIdx =
          (idx - 1 + ADVANCED_SUB_TABS.length) % ADVANCED_SUB_TABS.length;
      else if (event.key === "Home") nextIdx = 0;
      else if (event.key === "End") nextIdx = ADVANCED_SUB_TABS.length - 1;
      if (nextIdx === -1) return;
      event.preventDefault();
      const targetSub = ADVANCED_SUB_TABS[nextIdx]!.id;
      this.flushPendingSaves();
      this.setActiveAdvancedSubTab(targetSub);
      this.subNavButtons.get(targetSub)?.focus();
    });

    const sceneSubView = document.createElement("div");
    sceneSubView.id = "gg-subnav-panel-guided_scene";
    sceneSubView.className = "gg-drawer-view gg-subview-scene";
    sceneSubView.setAttribute("role", "tabpanel");
    sceneSubView.setAttribute("aria-labelledby", "gg-subnav-tab-guided_scene");
    sceneSubView.setAttribute("data-gg-subview", "guided_scene");

    const sceneWorkbenchHost = document.createElement("div");
    sceneWorkbenchHost.className = "gg-scene-workbench-host";

    const sceneSettingsHost = document.createElement("div");
    sceneSettingsHost.className = "gg-scene-settings-host";

    sceneSubView.append(sceneWorkbenchHost, sceneSettingsHost);
    advancedView.append(subNav, sceneSubView);

    bodyScroll.append(basicView, advancedView);
    shell.append(nav, stickyNoticeSlot, bodyScroll);

    this.shellEl = shell;
    this.navEl = nav;
    this.stickyNoticeSlotEl = stickyNoticeSlot;
    this.bodyScrollEl = bodyScroll;
    this.basicViewEl = basicView;
    this.advancedViewEl = advancedView;
    this.basicHostEl = basicHost;
    this.sceneWorkbenchHostEl = sceneWorkbenchHost;
    this.sceneSettingsHostEl = sceneSettingsHost;

    this.tab.root.replaceChildren(shell);
    if (this.scenePanel) {
      this.sceneWorkbenchHostEl.replaceChildren(this.scenePanel.getElement());
    }
    this.syncActiveViewVisibility();
    this.syncArmedNavDots();
    this.syncNoticeElement();
  }

  private ensureScenePanelMounted(): void {
    if (this.destroyed || !this.handlers.scene) return;
    this.ensureShellMounted();
    if (!this.sceneWorkbenchHostEl) return;

    if (this.scenePanel) {
      if (this.scenePanel.getElement().parentElement !== this.sceneWorkbenchHostEl) {
        this.sceneWorkbenchHostEl.replaceChildren(this.scenePanel.getElement());
      }
      return;
    }

    this.scenePanel = new GuidedScenePanel(this.ctx, this.handlers.scene);
    this.sceneWorkbenchHostEl.replaceChildren(this.scenePanel.getElement());
    if (this.currentSettings) {
      this.scenePanel.setSettings(this.currentSettings);
    }
    this.scenePanel.setActiveRun(this.sceneActiveRun);
    this.scenePanel.setLoading(this.sceneLoading);
    if (this.sceneContext || this.sceneContextError) {
      this.scenePanel.setContext(this.sceneContext, {
        error: this.sceneContextError,
      });
    } else if (this.armedScene) {
      this.scenePanel.setArmedState(this.armedScene.chatId, this.armedScene);
    }
  }

  private syncActiveViewVisibility(): void {
    for (const [tab, btn] of this.navButtons.entries()) {
      const isActive = tab === this.activeTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    }
    for (const [subTab, btn] of this.subNavButtons.entries()) {
      const isActive = subTab === this.activeAdvancedSubTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    }
    if (this.basicViewEl) {
      this.basicViewEl.classList.toggle("is-hidden", this.activeTab !== "basic");
    }
    if (this.advancedViewEl) {
      this.advancedViewEl.classList.toggle(
        "is-hidden",
        this.activeTab !== "advanced",
      );
    }
  }

  private syncArmedNavDots(): void {
    const armed = this.armedScene;
    const isPaused = armed?.status === "paused";
    const applyDot = (dot: HTMLSpanElement | null) => {
      if (!dot) return;
      if (!armed) {
        dot.style.display = "none";
        dot.classList.remove("is-paused");
        return;
      }
      dot.style.display = "";
      dot.classList.toggle("is-paused", isPaused);
    };
    applyDot(this.navArmedDotEl);
    applyDot(this.subNavArmedDotEl);
  }

  private scheduleDeferredPendingViewFlush(): void {
    if (this.destroyed || this.pendingViewFlushTimer !== null) return;
    this.pendingViewFlushTimer = setTimeout(() => {
      this.pendingViewFlushTimer = null;
      this.flushPendingViewIfIdle();
    }, 0);
  }

  private flushPendingViewIfIdle(): void {
    if (this.destroyed || this.pointerActiveInDrawer) return;
    if (this.pendingView && !this.isEditingDrawerInput()) {
      const next: ExtensionBootstrapView = this.currentSettings
        ? { ...this.pendingView, settings: this.currentSettings }
        : this.pendingView;
      this.pendingView = null;
      this.render(next, { force: true });
    }
  }

  onActivate(handler: () => void): () => void {
    return this.tab.onActivate(handler);
  }

  isTabConnected(): boolean {
    if (this.destroyed) return false;
    if (this.tab.root?.isConnected) return true;
    try {
      const location = this.ctx.ui?.getTabLocation?.(this.tab.tabId);
      if (location && location.kind !== "main-drawer") {
        return true;
      }
    } catch {
      // Ignore missing or inactive getTabLocation on older hosts or mocks
    }
    try {
      const drawerState = this.ctx.ui?.events?.getDrawerState?.();
      if (drawerState?.open && drawerState.tabId === this.tab.tabId) {
        return true;
      }
    } catch {
      // Ignore missing or inactive ui.events on older hosts or mocks
    }
    return false;
  }

  observeTabConnection(onConnected: () => void): () => void {
    if (this.destroyed || typeof IntersectionObserver !== "function") {
      return () => {};
    }
    let active = true;
    const disconnect = () => {
      if (!active) return;
      active = false;
      this.tabConnectionCleanups.delete(disconnect);
      observer.disconnect();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active || this.destroyed) {
          disconnect();
          return;
        }
        if (
          entries.some((entry) => entry.isIntersecting) ||
          this.isTabConnected()
        ) {
          disconnect();
          onConnected();
        }
      },
      { threshold: 0 },
    );
    this.tabConnectionCleanups.add(disconnect);
    observer.observe(this.tab.root);
    return disconnect;
  }

  setNotice(text: string, kind: "info" | "warn" | "error" = "info"): void {
    this.noticeText = text;
    this.noticeKind = kind;
    this.syncNoticeElement();
  }

  private syncNoticeElement(): void {
    if (this.destroyed || !this.stickyNoticeSlotEl) return;
    if (!this.noticeText) {
      this.noticeEl?.remove();
      this.noticeEl = null;
      return;
    }

    if (!this.noticeEl) {
      this.noticeEl = document.createElement("div");
      this.stickyNoticeSlotEl.append(this.noticeEl);
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

  setRecoveryBusy(busy: boolean): void {
    if (this.destroyed) return;
    this.recoveryBusy = busy;
    if (!this.recoveryUi) return;
    this.recoveryUi.clearBtn.disabled = busy || this.recoveryUi.recoveryCount === 0;
    if (this.recoveryUi.listEl) {
      for (const btn of this.recoveryUi.listEl.querySelectorAll<HTMLButtonElement>("button")) {
        btn.disabled = busy;
      }
    }
  }

  updateRecovery(
    recovery: readonly RecoveryEntry[],
    settings?: GuidedGenerationsSettings,
  ): void {
    if (this.destroyed) return;
    if (this.pendingView) {
      this.pendingView = {
        ...this.pendingView,
        recovery: [...recovery],
      };
    }
    if (!this.recoveryUi) return;
    const maxEntries =
      settings?.inputRecovery.maxEntries ??
      this.currentSettings?.inputRecovery.maxEntries ??
      10;
    this.recoveryUi.maxEntries = maxEntries;
    this.recoveryUi.recoveryCount = recovery.length;
    this.recoveryUi.setBadge(
      recovery.length > 0 ? String(recovery.length) : "",
      recovery.length === 0,
    );
    this.recoveryUi.countLabel.textContent =
      recovery.length > 0
        ? `Saved inputs (${recovery.length}/${maxEntries}):`
        : "No saved inputs yet.";
    this.recoveryUi.clearBtn.disabled = this.recoveryBusy || recovery.length === 0;
    this.syncRecoveryList(recovery);
  }

  private isInsideSettingsRegions(node: Node | null): boolean {
    if (!node) return false;
    return Boolean(
      (this.basicHostEl && this.basicHostEl.contains(node)) ||
        (this.sceneSettingsHostEl && this.sceneSettingsHostEl.contains(node)),
    );
  }

  private isEditingDrawerInput(): boolean {
    if (this.debounceTimers.size > 0) return true;
    for (const ta of this.expandableTextAreas) {
      if (ta.isModalOpen()) return true;
    }
    const selector =
      '[aria-expanded="true"]:not(.gg-card-header):not(.gg-sub-disclosure-btn), [role="listbox"]';
    if (
      (this.basicHostEl && this.basicHostEl.querySelector(selector) !== null) ||
      (this.sceneSettingsHostEl &&
        this.sceneSettingsHostEl.querySelector(selector) !== null)
    ) {
      return true;
    }
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return Boolean(
      isElementNode(active) &&
        this.isInsideSettingsRegions(active) &&
        isEditableElement(active),
    );
  }

  private captureOrderButtonFocus(): void {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!isElementNode(active) || !this.isInsideSettingsRegions(active)) {
      return;
    }
    if (!this.pendingFocusRestore && active.tagName === "BUTTON") {
      const btn = active as HTMLButtonElement;
      const moveDir = btn.dataset.ggMove;
      if (moveDir === "up" || moveDir === "down") {
        const row = btn.closest("[data-gg-order-id]");
        const optionId = row?.getAttribute("data-gg-order-id") as ToolbarOptionId | null;
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
          ariaLabel,
        };
      }
    }
  }

  render(view: ExtensionBootstrapView | null, options?: RenderDrawerOptions): void {
    if (this.destroyed) return;

    if (
      !options?.force &&
      this.rootEl !== null &&
      this.currentSettings !== null &&
      this.isEditingDrawerInput()
    ) {
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
    this.currentSettings = effectiveView?.settings ?? null;

    this.ensureShellMounted();

    if (effectiveView?.settings) {
      this.scenePanel?.setSettings(effectiveView.settings);
    }
    if (this.isShowingGuidedScene()) {
      this.ensureScenePanelMounted();
    }

    const root = document.createElement("div");
    root.className = "gg-drawer";
    this.rootEl = root;
    this.basicHostEl!.replaceChildren(root);
    this.sceneSettingsHostEl!.replaceChildren();

    const header = document.createElement("header");
    header.className = "gg-header";

    const titleWrap = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = "Guided Generations";
    const sub = document.createElement("p");
    sub.className = "gg-muted";
    sub.textContent =
      "Enabled options appear on the composer action bar. Each option uses its own connection profile, model, and preset without altering your active chat.";
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
      this.restoreCapturedFocus(this.shellEl!);
      return;
    }

    const missingPerms: string[] = [];
    if (!effectiveView.permissions.generation) missingPerms.push("generation");
    if (!effectiveView.permissions.chats) missingPerms.push("chats");
    if (!effectiveView.permissions.chat_mutation) missingPerms.push("chat_mutation");
    if (!effectiveView.permissions.presets) missingPerms.push("presets");

    if (missingPerms.length > 0) {
      const warn = document.createElement("div");
      warn.className = "gg-notice is-warn";
      warn.setAttribute("role", "alert");
      warn.setAttribute("aria-live", "assertive");
      warn.textContent = `Missing extension permissions (${missingPerms.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`;
      root.append(warn);
    }

    const missingFeaturePerms: string[] = [];
    const degradedNotes: string[] = [];
    if (effectiveView.permissions.interceptor === false) {
      missingFeaturePerms.push("interceptor");
      degradedNotes.push(
        "preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement",
      );
    }
    if (effectiveView.permissions.regex_scripts === false) {
      missingFeaturePerms.push("regex_scripts");
      degradedNotes.push(
        "Lumiverse regex scripts are skipped on guidance prompts and generated/impersonated outputs",
      );
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

    // Basic tab sections
    this.renderToolbarLayoutSection(root, effectiveView.settings);

    for (const actionId of GUIDED_ACTION_ORDER) {
      this.renderActionSection(
        root,
        effectiveView.settings,
        actionId,
        effectiveView.connections,
        connectionOptions,
        presetOptions,
        ROLE_SELECT_OPTIONS,
      );
    }

    this.renderRecoverySection(root, effectiveView.settings, effectiveView.recovery);

    // Advanced -> Guided Scene collapsible profile & prompt settings section
    this.renderGuidedSceneSettingsSection(
      this.sceneSettingsHostEl!,
      effectiveView.settings,
      effectiveView.connections,
      connectionOptions,
      presetOptions,
    );

    this.restoreCapturedFocus(this.shellEl!);
  }

  private restoreCapturedFocus(root: HTMLElement): void {
    if (this.pendingFocusRestore) {
      const restore = this.pendingFocusRestore;
      this.pendingFocusRestore = null;
      this.pendingGeneralFocusRestore = null;
      const targetRow = root.querySelector<HTMLElement>(
        `[data-gg-order-id="${restore.optionId}"]`,
      );
      const preferred = targetRow?.querySelector<HTMLButtonElement>(
        `button[data-gg-move="${restore.button}"]`,
      );
      const fallback = targetRow?.querySelector<HTMLButtonElement>(
        `button[data-gg-move="${restore.button === "up" ? "down" : "up"}"]`,
      );
      const targetBtn =
        preferred && !preferred.disabled
          ? preferred
          : fallback && !fallback.disabled
            ? fallback
            : null;
      targetBtn?.focus();
      return;
    }

    if (this.pendingGeneralFocusRestore) {
      const restore = this.pendingGeneralFocusRestore;
      this.pendingGeneralFocusRestore = null;
      let target: HTMLElement | null = null;
      if (restore.focusKey) {
        target = findElementByAttribute(root, "data-gg-focus-key", restore.focusKey);
      }
      if (!target && restore.ariaLabel) {
        target = findElementByAttribute(
          root,
          "aria-label",
          restore.ariaLabel,
          restore.tagName,
        );
      }
      if (target && !(target as HTMLButtonElement).disabled) {
        target.focus();
      }
    }
  }

  private createCheckboxRow(options: {
    label: string;
    checked: boolean;
    ariaLabel: string;
    onChange: (checked: boolean) => void;
    focusKey?: string;
  }): { row: HTMLDivElement; checkbox: HTMLInputElement } {
    const row = document.createElement("div");
    row.className = "gg-checkbox-row";

    const label = document.createElement("label");
    label.className = "gg-checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "gg-checkbox";
    checkbox.checked = options.checked;
    checkbox.setAttribute("aria-label", options.ariaLabel);
    if (options.focusKey) {
      checkbox.dataset.ggFocusKey = options.focusKey;
    }
    checkbox.addEventListener("change", () => {
      options.onChange(checkbox.checked);
    });

    const text = document.createElement("span");
    text.textContent = options.label;

    label.append(checkbox, text);
    row.append(label);
    return { row, checkbox };
  }

  private createCollapsibleCard(
    parent: HTMLElement,
    sectionId: string,
    title: string,
    badgeText: string | undefined,
    badgeMuted = false,
    onToggle?: (expanded: boolean) => void,
  ): {
    body: HTMLDivElement;
    setBadge(nextText: string, muted?: boolean): void;
  } {
    const card = document.createElement("section");
    card.className = "gg-card";
    card.dataset.ggSectionId = sectionId;
    if (this.expandedSections.has(sectionId)) {
      card.classList.add("is-expanded");
    }

    const headerBtn = document.createElement("button");
    headerBtn.type = "button";
    headerBtn.className = "gg-card-header";
    headerBtn.dataset.ggFocusKey = `card-header:${sectionId}`;
    headerBtn.setAttribute(
      "aria-expanded",
      String(this.expandedSections.has(sectionId)),
    );

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

    // Keep card-body attached in DOM even when collapsed so host Spindle
    // component mounts inside stay alive and never get pruned by MutationObserver.
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
      if (nextExpanded) this.expandedSections.add(sectionId);
      else this.expandedSections.delete(sectionId);
      onToggle?.(nextExpanded);
    });

    card.append(headerBtn, bodyWrap);
    parent.append(card);

    return {
      body,
      setBadge(nextText: string, muted = false) {
        badge.textContent = nextText;
        badge.className = `gg-card-badge${muted ? " is-muted" : ""}`;
        badge.style.display = nextText ? "" : "none";
      },
    };
  }

  private renderToolbarLayoutSection(
    parent: HTMLElement,
    settings: GuidedGenerationsSettings,
  ): void {
    const placement = normalizeToolbarPlacement(settings.toolbarPlacement);
    const placementMeta =
      TOOLBAR_PLACEMENT_OPTIONS.find((opt) => opt.value === placement) ??
      TOOLBAR_PLACEMENT_OPTIONS[0]!;

    const card = this.createCollapsibleCard(
      parent,
      "toolbar_layout",
      "Toolbar Position & Order",
      placementMeta.shortLabel,
      false,
    );
    const body = card.body;

    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent =
      "Choose where the Guided Generations buttons appear on the composer bar and customize their left-to-right order.";
    body.append(desc);

    const saveLayout = (
      patch: Partial<Pick<GuidedGenerationsSettings, "toolbarPlacement" | "buttonOrder">>,
      options: SaveSettingsOptions,
    ) => {
      const base = this.currentSettings ?? settings;
      const next: GuidedGenerationsSettings = {
        ...base,
        ...patch,
      };
      this.currentSettings = next;
      if (patch.toolbarPlacement !== undefined) {
        const nextMeta = TOOLBAR_PLACEMENT_OPTIONS.find(
          (opt) => opt.value === patch.toolbarPlacement,
        );
        if (nextMeta) card.setBadge(nextMeta.shortLabel, false);
      }
      void this.handlers.onSaveSettings(next, options);
    };

    const placementField = createFieldContainer("Bar Placement");
    body.append(placementField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(placementField.slot, {
        options: TOOLBAR_PLACEMENT_SELECT_OPTIONS,
        value: placement,
        ariaLabel: "Toolbar Bar Placement",
        onChange: (val) => {
          saveLayout(
            { toolbarPlacement: normalizeToolbarPlacement(val) },
            { rebuildDrawer: false },
          );
        },
      }),
    );

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

      const labelText = TOOLBAR_OPTION_LABELS[optionId];
      const isVisible =
        optionId === "input_recovery"
          ? settings.inputRecovery.enabled
          : optionId === "guided_scene"
            ? Boolean(settings.guidedScene?.enabled)
            : Boolean(settings.actions[optionId]?.enabled);

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

      const moveOption = (delta: -1 | 1) => {
        const targetIndex = index + delta;
        if (targetIndex < 0 || targetIndex >= currentOrder.length) return;
        this.flushPendingSaves();
        const reordered: ToolbarOptionId[] = [...currentOrder];
        const [moved] = reordered.splice(index, 1);
        if (!moved) return;
        reordered.splice(targetIndex, 0, moved);
        const preferredBtn: "up" | "down" =
          delta === -1
            ? targetIndex === 0
              ? "down"
              : "up"
            : targetIndex === reordered.length - 1
              ? "up"
              : "down";
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
      saveLayout(
        {
          toolbarPlacement: "after_native" satisfies ToolbarPlacement,
          buttonOrder: [...DEFAULT_BUTTON_ORDER],
        },
        { rebuildDrawer: true },
      );
    });
    resetWrap.append(resetHint, resetBtn);

    orderField.slot.append(orderList);
    body.append(orderField.wrap, resetWrap);
  }

  private renderActionSection(
    parent: HTMLElement,
    settings: GuidedGenerationsSettings,
    actionId: GuidedActionId,
    connections: readonly ConnectionOptionSummary[],
    connectionOptions: SpindleSelectOption[],
    presetOptions: SpindleSelectOption[],
    roleOptions: SpindleSelectOption[],
  ): void {
    const meta = ACTION_METADATA[actionId];
    const cfg = settings.actions[actionId];
    let currentConnectionId: string | null = cfg.connectionId;
    let modelConnectionBound = this.expandedSections.has(actionId);
    let modelHandle: SpindleModelComboboxHandle | null = null;

    const card = this.createCollapsibleCard(
      parent,
      actionId,
      meta.label,
      cfg.enabled ? "Visible" : "Hidden",
      !cfg.enabled,
      (expanded) => {
        if (expanded && !modelConnectionBound) {
          modelConnectionBound = true;
          modelHandle?.update({
            connection: buildModelConnectionRef(currentConnectionId),
          });
        }
      },
    );
    const body = card.body;

    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent = meta.description;
    body.append(desc);

    const savePatch = (
      patch: Partial<typeof cfg>,
      options: SaveSettingsOptions = { rebuildDrawer: false },
    ) => {
      const base = this.currentSettings ?? settings;
      const next: GuidedGenerationsSettings = {
        ...base,
        actions: {
          ...base.actions,
          [actionId]: {
            ...base.actions[actionId],
            ...patch,
          },
        },
      };
      this.currentSettings = next;
      if (patch.enabled !== undefined) {
        card.setBadge(
          patch.enabled ? "Visible" : "Hidden",
          !patch.enabled,
        );
        this.updateOrderStateTag(actionId, patch.enabled);
      }
      void this.handlers.onSaveSettings(next, options);
    };

    // Enable button checkbox (Media Localizer tick box)
    body.append(
      this.createCheckboxRow({
        label: "Show button on input bar",
        checked: cfg.enabled,
        ariaLabel: `Show ${meta.label} button on input bar`,
        focusKey: `${actionId}:enabled`,
        onChange: (checked) => savePatch({ enabled: checked }, { rebuildDrawer: false }),
      }).row,
    );

    // Clear composer input checkbox
    body.append(
      this.createCheckboxRow({
        label: "Clear input bar when triggered",
        checked: cfg.clearInputOnRun,
        ariaLabel: `Clear input bar when running ${meta.label}`,
        focusKey: `${actionId}:clearInputOnRun`,
        onChange: (checked) => savePatch({ clearInputOnRun: checked }),
      }).row,
    );

    // Per-action Lumiverse regex scripts checkbox
    body.append(
      this.createCheckboxRow({
        label: "Apply Lumiverse regex scripts",
        checked: cfg.applyRegex ?? DEFAULT_APPLY_REGEX,
        ariaLabel: `Apply Lumiverse regex scripts for ${meta.label}`,
        focusKey: `${actionId}:applyRegex`,
        onChange: (checked) => savePatch({ applyRegex: checked }),
      }).row,
    );

    const activeConnectionId = getActiveConnectionId(this.ctx);

    // API Connection Profile select
    const connField = createFieldContainer("API Connection Profile");
    body.append(connField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(connField.slot, {
        options: connectionOptions,
        value: cfg.connectionId ?? "",
        ariaLabel: `${meta.label} API Connection Profile`,
        onChange: (val) => {
          const nextConnectionId = val || null;
          currentConnectionId = nextConnectionId;
          savePatch({ connectionId: nextConnectionId });
          modelHandle?.update(
            modelConnectionBound
              ? {
                  connection: buildModelConnectionRef(nextConnectionId),
                  placeholder: buildModelPlaceholder(nextConnectionId, connections, activeConnectionId),
                }
              : {
                  placeholder: buildModelPlaceholder(nextConnectionId, connections, activeConnectionId),
                },
          );
        },
      }),
    );

    // Per-action Model select/input (blank = use selected connection's current model)
    const modelFieldId = `gg-${actionId}-model`;
    const modelField = createFieldContainer(
      "Model (blank = connection profile model)",
      modelFieldId,
    );
    body.append(modelField.wrap);
    if (typeof this.ctx.components.mountModelCombobox === "function") {
      modelHandle = this.ctx.components.mountModelCombobox(modelField.slot, {
        value: cfg.model ?? "",
        connection: modelConnectionBound
          ? buildModelConnectionRef(currentConnectionId)
          : undefined,
        appearance: "standard",
        autoRefreshOnFocus: true,
        placeholder: buildModelPlaceholder(currentConnectionId, connections, activeConnectionId),
        onChange: (value) => {
          this.scheduleDebouncedSave(`${actionId}:model`, () => {
            savePatch({ model: value.trim() || null });
          });
        },
      });
      this.attachSlotInputAttributes(modelField.slot, modelFieldId, `${meta.label} Model`);
      this.handles.push(modelHandle);
    }

    // Preset select
    const presetField = createFieldContainer("Preset");
    body.append(presetField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(presetField.slot, {
        options: presetOptions,
        value: cfg.presetId ?? "",
        ariaLabel: `${meta.label} Preset`,
        onChange: (val) => savePatch({ presetId: val || null }),
      }),
    );

    // Guidance injection role
    const roleField = createFieldContainer("Guidance Injection Role");
    body.append(roleField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(roleField.slot, {
        options: roleOptions,
        value: cfg.injectionRole,
        ariaLabel: `${meta.label} Guidance Injection Role`,
        onChange: (val) =>
          savePatch({ injectionRole: val as GuidanceInjectionRole }),
      }),
    );

    // Guidance position & conditional In-history depth
    const initialPosition = normalizeGuidancePosition(cfg.guidancePosition);
    const initialDepth = normalizeGuidanceDepth(cfg.guidanceDepth);
    let depthControl: { setDisabled: (disabled: boolean) => void } | null = null;

    const depthFieldId = `gg-${actionId}-guidance-depth`;
    const depthField = createFieldContainer("In-History Depth (0–999)", depthFieldId);
    const syncDepthFieldState = (pos: GuidancePosition) => {
      const isInHistory = pos === "in_history";
      depthField.wrap.style.display = isInHistory ? "" : "none";
      depthControl?.setDisabled(!isInHistory);
    };

    const positionField = createFieldContainer("Guidance Position");
    body.append(positionField.wrap, depthField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(positionField.slot, {
        options: GUIDANCE_POSITION_SELECT_OPTIONS,
        value: initialPosition,
        ariaLabel: `${meta.label} Guidance Position`,
        onChange: (val) => {
          const nextPosition = normalizeGuidancePosition(val);
          savePatch({ guidancePosition: nextPosition });
          syncDepthFieldState(nextPosition);
        },
      }),
    );

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
      },
    });
    syncDepthFieldState(initialPosition);

    // Instruction template (debounced so typing never disrupts focus or floods storage)
    const templateField = createFieldContainer(
      "Guidance Template (supports {{input}} and Lumiverse macros like {{char}}, {{user}}; leave blank for raw input)",
    );
    body.append(templateField.wrap);
    const templateHandle = mountExpandableTextArea(this.ctx, templateField.slot, {
      value: cfg.instructionTemplate,
      rows: 2,
      placeholder: "{{input}}",
      ariaLabel: `${meta.label} Guidance Template`,
      expandTitle: `${meta.label} — Guidance Template`,
      onChange: (value) => {
        this.scheduleDebouncedSave(`${actionId}:template`, () => {
          savePatch({ instructionTemplate: value });
        });
      },
      onModalStateChange: (open) => {
        if (!open) {
          this.flushPendingSaves();
          queueMicrotask(() => {
            this.flushPendingViewIfIdle();
          });
        }
      },
    });
    this.expandableTextAreas.add(templateHandle);
    this.handles.push(templateHandle);
  }

  private renderGuidedSceneSettingsSection(
    parent: HTMLElement,
    settings: GuidedGenerationsSettings,
    connections: readonly ConnectionOptionSummary[],
    connectionOptions: SpindleSelectOption[],
    presetOptions: SpindleSelectOption[],
  ): void {
    const cfg = normalizeGuidedSceneConfig(settings.guidedScene);
    const sectionId = "guided_scene";
    let currentConnectionId: string | null = cfg.connectionId;
    let modelConnectionBound = this.expandedSections.has(sectionId);
    let modelHandle: SpindleModelComboboxHandle | null = null;

    const card = this.createCollapsibleCard(
      parent,
      sectionId,
      "Guided Scene Settings",
      cfg.enabled ? "Visible" : "Hidden",
      !cfg.enabled,
      (expanded) => {
        if (expanded && !modelConnectionBound) {
          modelConnectionBound = true;
          modelHandle?.update({
            connection: buildModelConnectionRef(currentConnectionId),
          });
        }
      },
    );
    const body = card.body;

    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent = GUIDED_SCENE_METADATA.description;
    body.append(desc);

    const saveScenePatch = (
      patch: Partial<GuidedSceneConfig>,
      options: SaveSettingsOptions = { rebuildDrawer: false },
    ) => {
      const base = this.currentSettings ?? settings;
      const baseScene = normalizeGuidedSceneConfig(base.guidedScene);
      const next: GuidedGenerationsSettings = {
        ...base,
        guidedScene: {
          ...baseScene,
          ...patch,
        },
      };
      this.currentSettings = next;
      if (patch.enabled !== undefined) {
        card.setBadge(patch.enabled ? "Visible" : "Hidden", !patch.enabled);
        this.updateOrderStateTag("guided_scene", patch.enabled);
      }
      this.scenePanel?.setSettings(next);
      void this.handlers.onSaveSettings(next, options);
    };

    // Show button on input bar
    body.append(
      this.createCheckboxRow({
        label: "Show button on input bar",
        checked: cfg.enabled,
        ariaLabel: "Show Guided Scene button on input bar",
        focusKey: "guided_scene:enabled",
        onChange: (checked) => saveScenePatch({ enabled: checked }),
      }).row,
    );

    // Apply Lumiverse regex scripts
    body.append(
      this.createCheckboxRow({
        label: "Apply Lumiverse regex scripts",
        checked: cfg.applyRegex ?? DEFAULT_APPLY_REGEX,
        ariaLabel: "Apply Lumiverse regex scripts for Guided Scene",
        focusKey: "guided_scene:applyRegex",
        onChange: (checked) => saveScenePatch({ applyRegex: checked }),
      }).row,
    );

    const activeConnectionId = getActiveConnectionId(this.ctx);

    // API Connection Profile
    const connField = createFieldContainer("API Connection Profile");
    body.append(connField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(connField.slot, {
        options: connectionOptions,
        value: cfg.connectionId ?? "",
        ariaLabel: "Guided Scene API Connection Profile",
        onChange: (val) => {
          const nextConnectionId = val || null;
          currentConnectionId = nextConnectionId;
          saveScenePatch({ connectionId: nextConnectionId });
          modelHandle?.update(
            modelConnectionBound
              ? {
                  connection: buildModelConnectionRef(nextConnectionId),
                  placeholder: buildModelPlaceholder(
                    nextConnectionId,
                    connections,
                    activeConnectionId,
                  ),
                }
              : {
                  placeholder: buildModelPlaceholder(
                    nextConnectionId,
                    connections,
                    activeConnectionId,
                  ),
                },
          );
        },
      }),
    );

    // Model combobox
    const modelFieldId = "gg-guided_scene-model";
    const modelField = createFieldContainer(
      "Model (blank = connection profile model)",
      modelFieldId,
    );
    body.append(modelField.wrap);
    if (typeof this.ctx.components.mountModelCombobox === "function") {
      modelHandle = this.ctx.components.mountModelCombobox(modelField.slot, {
        value: cfg.model ?? "",
        connection: modelConnectionBound
          ? buildModelConnectionRef(currentConnectionId)
          : undefined,
        appearance: "standard",
        autoRefreshOnFocus: true,
        placeholder: buildModelPlaceholder(
          currentConnectionId,
          connections,
          activeConnectionId,
        ),
        onChange: (value) => {
          this.scheduleDebouncedSave("guided_scene:model", () => {
            saveScenePatch({ model: value.trim() || null });
          });
        },
      });
      this.attachSlotInputAttributes(
        modelField.slot,
        modelFieldId,
        "Guided Scene Model",
      );
      this.handles.push(modelHandle);
    }

    // Preset
    const presetField = createFieldContainer("Preset");
    body.append(presetField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(presetField.slot, {
        options: presetOptions,
        value: cfg.presetId ?? "",
        ariaLabel: "Guided Scene Preset",
        onChange: (val) => saveScenePatch({ presetId: val || null }),
      }),
    );

    // Rewrite Context Mode & conditional Last N turns
    const initialContextMode = normalizeSceneContextMode(cfg.contextMode);
    const initialContextTurns = normalizeSceneContextTurns(cfg.contextTurns);
    let turnsControl: { setDisabled: (disabled: boolean) => void } | null = null;

    const turnsFieldId = "gg-guided_scene-context-turns";
    const turnsField = createFieldContainer(
      "Recent Context Turns (1–200)",
      turnsFieldId,
    );
    const syncTurnsState = (mode: GuidedSceneContextMode) => {
      const isLightweight = mode === "lightweight";
      turnsField.wrap.style.display = isLightweight ? "" : "none";
      turnsControl?.setDisabled(!isLightweight);
    };

    const contextModeField = createFieldContainer("Rewrite Context Mode");
    body.append(contextModeField.wrap, turnsField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(contextModeField.slot, {
        options: SCENE_CONTEXT_MODE_SELECT_OPTIONS,
        value: initialContextMode,
        ariaLabel: "Guided Scene Rewrite Context Mode",
        onChange: (val) => {
          const nextMode = normalizeSceneContextMode(val);
          saveScenePatch({ contextMode: nextMode });
          syncTurnsState(nextMode);
        },
      }),
    );

    turnsControl = this.mountBoundedIntegerField({
      slot: turnsField.slot,
      fieldId: turnsFieldId,
      ariaLabel: "Guided Scene Recent Context Turns",
      debounceKey: "guided_scene:contextTurns",
      min: 1,
      max: 200,
      defaultValue: DEFAULT_SCENE_CONTEXT_TURNS,
      placeholder: String(DEFAULT_SCENE_CONTEXT_TURNS),
      initialValue: initialContextTurns,
      disabled: initialContextMode !== "lightweight",
      onCommit: (contextTurns) => {
        saveScenePatch({ contextTurns });
      },
    });
    syncTurnsState(initialContextMode);

    // Steering Injection Role
    const roleField = createFieldContainer("Steering Injection Role");
    body.append(roleField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(roleField.slot, {
        options: ROLE_SELECT_OPTIONS,
        value: cfg.injectionRole,
        ariaLabel: "Guided Scene Steering Injection Role",
        onChange: (val) =>
          saveScenePatch({ injectionRole: val as GuidanceInjectionRole }),
      }),
    );

    // Steering Guidance Position (all 4 GG positions + append_last_user OOC) & conditional depth
    const initialPos = normalizeSceneGuidancePosition(cfg.guidancePosition);
    const initialDepth = normalizeGuidanceDepth(cfg.guidanceDepth);
    let depthControl: { setDisabled: (disabled: boolean) => void } | null = null;

    const depthFieldId = "gg-guided_scene-guidance-depth";
    const depthField = createFieldContainer(
      "In-History Depth (0–999)",
      depthFieldId,
    );
    const syncDepthState = (pos: SceneGuidancePosition) => {
      const isInHistory = pos === "in_history";
      depthField.wrap.style.display = isInHistory ? "" : "none";
      depthControl?.setDisabled(!isInHistory);
    };

    const posField = createFieldContainer("Steering Guidance Position");
    body.append(posField.wrap, depthField.wrap);
    this.handles.push(
      this.ctx.components.mountSelect(posField.slot, {
        options: SCENE_GUIDANCE_POSITION_SELECT_OPTIONS,
        value: initialPos,
        ariaLabel: "Guided Scene Steering Guidance Position",
        onChange: (val) => {
          const nextPos = normalizeSceneGuidancePosition(val);
          saveScenePatch({ guidancePosition: nextPos });
          syncDepthState(nextPos);
        },
      }),
    );

    depthControl = this.mountBoundedIntegerField({
      slot: depthField.slot,
      fieldId: depthFieldId,
      ariaLabel: "Guided Scene In-history depth",
      debounceKey: "guided_scene:depth",
      min: 0,
      max: 999,
      defaultValue: DEFAULT_GUIDANCE_DEPTH,
      placeholder: "0",
      initialValue: initialDepth,
      disabled: initialPos !== "in_history",
      onCommit: (guidanceDepth) => {
        saveScenePatch({ guidanceDepth });
      },
    });
    syncDepthState(initialPos);

    // Collapsible Prompt Templates & Readiness Tag sub-disclosure
    const promptsKey = "guided_scene:prompts";
    const disclosure = document.createElement("div");
    disclosure.className = "gg-sub-disclosure";
    if (this.expandedSections.has(promptsKey)) {
      disclosure.classList.add("is-expanded");
    }

    const disclosureBodyId = "gg-sub-disclosure-body-guided_scene-prompts";
    const disclosureBtn = document.createElement("button");
    disclosureBtn.type = "button";
    disclosureBtn.className = "gg-sub-disclosure-btn";
    disclosureBtn.dataset.ggFocusKey = "guided_scene:prompts-toggle";
    disclosureBtn.setAttribute(
      "aria-expanded",
      String(this.expandedSections.has(promptsKey)),
    );
    disclosureBtn.setAttribute("aria-controls", disclosureBodyId);

    const disclosureLeft = document.createElement("span");
    disclosureLeft.style.display = "inline-flex";
    disclosureLeft.style.alignItems = "center";
    disclosureLeft.style.gap = "5px";
    const disclosureChev = document.createElement("span");
    disclosureChev.setAttribute("aria-hidden", "true");
    disclosureChev.textContent = this.expandedSections.has(promptsKey) ? "▾" : "▸";
    const disclosureTitle = document.createElement("span");
    disclosureTitle.textContent = "Prompt Templates & Readiness Tag";
    disclosureLeft.append(disclosureChev, disclosureTitle);
    disclosureBtn.append(disclosureLeft);

    const disclosureBody = document.createElement("div");
    disclosureBody.id = disclosureBodyId;
    disclosureBody.className = "gg-sub-disclosure-body";

    disclosureBtn.addEventListener("click", () => {
      const nextExpanded = !disclosure.classList.contains("is-expanded");
      disclosure.classList.toggle("is-expanded", nextExpanded);
      disclosureBtn.setAttribute("aria-expanded", String(nextExpanded));
      disclosureChev.textContent = nextExpanded ? "▾" : "▸";
      if (nextExpanded) this.expandedSections.add(promptsKey);
      else this.expandedSections.delete(promptsKey);
    });

    // Readiness Tag input
    const tagFieldId = "gg-guided_scene-readiness-tag";
    const tagField = createFieldContainer(
      "Readiness Tag (emitted as <tag/> in Multi-Turn steering)",
      tagFieldId,
    );
    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.id = tagFieldId;
    tagInput.className = "gg-input-sm";
    tagInput.value = cfg.readinessTag;
    tagInput.placeholder = DEFAULT_SCENE_READINESS_TAG;
    tagInput.setAttribute("aria-label", "Guided Scene Readiness Tag");
    tagInput.addEventListener("input", () => {
      this.scheduleDebouncedSave("guided_scene:readinessTag", () => {
        saveScenePatch({
          readinessTag: normalizeSceneReadinessTag(tagInput.value),
        });
      });
    });
    tagInput.addEventListener("blur", () => {
      const normalized = normalizeSceneReadinessTag(tagInput.value);
      tagInput.value = normalized;
    });
    tagField.slot.append(tagInput);
    disclosureBody.append(tagField.wrap);

    const templateSpecs: Array<{
      key: "steeringTemplate" | "adaptTemplate" | "summaryTemplate" | "bridgeTemplate";
      label: string;
      expandTitle: string;
      ariaLabel: string;
      value: string;
    }> = [
      {
        key: "steeringTemplate",
        label: "Steering Directive Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{readinessTag}})",
        expandTitle: "Steering Directive Template",
        ariaLabel: "Guided Scene Steering Directive Template",
        value: cfg.steeringTemplate,
      },
      {
        key: "adaptTemplate",
        label: "Context Adapt Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{customDirection}})",
        expandTitle: "Context Adapt Template",
        ariaLabel: "Guided Scene Context Adapt Template",
        value: cfg.adaptTemplate,
      },
      {
        key: "summaryTemplate",
        label: "Summary Rewrite Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{customDirection}})",
        expandTitle: "Summary Rewrite Template",
        ariaLabel: "Guided Scene Summary Rewrite Template",
        value: cfg.summaryTemplate,
      },
      {
        key: "bridgeTemplate",
        label: "In-Scene Bridge Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{customDirection}})",
        expandTitle: "In-Scene Bridge Template",
        ariaLabel: "Guided Scene In-Scene Bridge Template",
        value: cfg.bridgeTemplate,
      },
    ];

    for (const spec of templateSpecs) {
      const field = createFieldContainer(spec.label);
      disclosureBody.append(field.wrap);
      const promptHandle = mountExpandableTextArea(this.ctx, field.slot, {
        value: spec.value,
        rows: 3,
        ariaLabel: spec.ariaLabel,
        expandTitle: spec.expandTitle,
        onChange: (value) => {
          this.scheduleDebouncedSave(`guided_scene:${spec.key}`, () => {
            saveScenePatch({ [spec.key]: value });
          });
        },
        onModalStateChange: (open) => {
          if (!open) {
            this.flushPendingSaves();
            queueMicrotask(() => {
              this.flushPendingViewIfIdle();
            });
          }
        },
      });
      this.expandableTextAreas.add(promptHandle);
      this.handles.push(promptHandle);
    }

    const resetRow = document.createElement("div");
    resetRow.className = "gg-row";
    const resetHint = document.createElement("span");
    resetHint.className = "gg-muted";
    resetHint.textContent = "Restore default Guided Scene prompts & tag";
    const resetPromptsBtn = document.createElement("button");
    resetPromptsBtn.type = "button";
    resetPromptsBtn.className = "gg-btn-sm";
    resetPromptsBtn.dataset.ggFocusKey = "reset-scene-prompts";
    resetPromptsBtn.textContent = "Reset Prompts";
    resetPromptsBtn.addEventListener("click", () => {
      this.flushPendingSaves();
      saveScenePatch(
        {
          readinessTag: DEFAULT_SCENE_READINESS_TAG,
          steeringTemplate: DEFAULT_SCENE_STEERING_TEMPLATE,
          adaptTemplate: DEFAULT_SCENE_ADAPT_TEMPLATE,
          summaryTemplate: DEFAULT_SCENE_SUMMARY_TEMPLATE,
          bridgeTemplate: DEFAULT_SCENE_BRIDGE_TEMPLATE,
        },
        { rebuildDrawer: true },
      );
    });
    resetRow.append(resetHint, resetPromptsBtn);
    disclosureBody.append(resetRow);

    disclosure.append(disclosureBtn, disclosureBody);
    body.append(disclosure);
  }

  private mountBoundedIntegerField(options: {
    slot: HTMLElement;
    fieldId: string;
    ariaLabel: string;
    debounceKey: string;
    min: number;
    max: number;
    defaultValue: number;
    placeholder: string;
    initialValue: number;
    disabled?: boolean;
    onCommit: (normalized: number) => void;
  }): { setDisabled: (disabled: boolean) => void } {
    const clamp = (raw: unknown): number => {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.max(options.min, Math.min(options.max, Math.floor(raw)));
      }
      return Math.max(
        options.min,
        Math.min(options.max, Math.floor(options.defaultValue)),
      );
    };

    let currentValue = clamp(options.initialValue);
    let hasEmptyDraft = false;
    let syncingUi = false;
    let handle: SpindleNumericInputHandle | null = null;
    let fallbackInput: HTMLInputElement | null = null;

    const commitInput = (rawNumber: number | null) => {
      if (syncingUi) return;
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
        onChange: commitInput,
      });
      this.attachSlotInputAttributes(options.slot, options.fieldId, options.ariaLabel);
      options.slot.addEventListener("focusout", (event) => {
        const nextTarget = (event as FocusEvent).relatedTarget as Node | null;
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
      setDisabled: (disabled: boolean) => {
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
      },
    };
  }

  private updateOrderStateTag(optionId: ToolbarOptionId, visible: boolean): void {
    const tag = this.orderStateTags.get(optionId);
    if (tag) {
      tag.textContent = visible ? "Visible" : "Hidden";
    }
  }

  private renderRecoverySection(
    parent: HTMLElement,
    settings: GuidedGenerationsSettings,
    recovery: readonly RecoveryEntry[],
  ): void {
    const card = this.createCollapsibleCard(
      parent,
      "input_recovery",
      "Input Recovery",
      recovery.length > 0 ? String(recovery.length) : undefined,
      recovery.length === 0,
    );
    const body = card.body;

    const desc = document.createElement("p");
    desc.className = "gg-muted";
    desc.textContent =
      "Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click. When no saved inputs exist, clicking Input Recovery clears the current input.";
    body.append(desc);

    body.append(
      this.createCheckboxRow({
        label: "Enable Input Recovery & toolbar button",
        checked: settings.inputRecovery.enabled,
        ariaLabel: "Show Input Recovery button on input bar",
        focusKey: "input_recovery:enabled",
        onChange: (checked) => {
          const base = this.currentSettings ?? settings;
          const next: GuidedGenerationsSettings = {
            ...base,
            inputRecovery: { ...base.inputRecovery, enabled: checked },
          };
          this.currentSettings = next;
          this.updateOrderStateTag("input_recovery", checked);
          void this.handlers.onSaveSettings(next, { rebuildDrawer: false });
        },
      }).row,
    );

    const maxEntriesFieldId = "gg-recovery-max-entries";
    const maxEntriesField = createFieldContainer(
      "Max saved drafts (1–50)",
      maxEntriesFieldId,
    );
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
        const next: GuidedGenerationsSettings = {
          ...base,
          inputRecovery: { ...base.inputRecovery, maxEntries },
        };
        this.currentSettings = next;
        if (this.recoveryUi) {
          this.recoveryUi.maxEntries = maxEntries;
          this.recoveryUi.countLabel.textContent =
            this.recoveryUi.recoveryCount > 0
              ? `Saved inputs (${this.recoveryUi.recoveryCount}/${maxEntries}):`
              : "No saved inputs yet.";
        }
        void this.handlers.onSaveSettings(next, { rebuildDrawer: false });
      },
    });

    const controlsRow = document.createElement("div");
    controlsRow.className = "gg-row";
    const countLabel = document.createElement("span");
    countLabel.className = "gg-muted";
    countLabel.textContent =
      recovery.length > 0
        ? `Saved inputs (${recovery.length}/${settings.inputRecovery.maxEntries}):`
        : "No saved inputs yet.";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "gg-btn-sm";
    clearBtn.dataset.ggFocusKey = "clear-recovery";
    clearBtn.textContent = "Clear History";
    clearBtn.disabled = this.recoveryBusy || recovery.length === 0;
    clearBtn.addEventListener("click", () => {
      void this.handlers.onClearRecovery();
    });

    controlsRow.append(countLabel, clearBtn);
    body.append(controlsRow);

    this.recoveryUi = {
      setBadge: card.setBadge,
      countLabel,
      clearBtn,
      body,
      listEl: null,
      entries: [],
      maxEntries: settings.inputRecovery.maxEntries,
      recoveryCount: recovery.length,
    };

    this.syncRecoveryList(recovery);
  }

  private syncRecoveryList(recovery: readonly RecoveryEntry[]): void {
    const ui = this.recoveryUi;
    if (!ui) return;

    if (recovery.length === 0) {
      ui.entries = [];
      if (ui.listEl) {
        ui.listEl.remove();
        ui.listEl = null;
      }
      return;
    }

    if (
      ui.listEl &&
      ui.entries.length === recovery.length &&
      ui.entries.every((prev, idx) => {
        const next = recovery[idx]!;
        return (
          prev.id === next.id &&
          prev.text === next.text &&
          prev.actionId === next.actionId
        );
      })
    ) {
      return;
    }

    ui.entries = [...recovery];

    let list = ui.listEl;
    if (!list) {
      list = document.createElement("div");
      list.className = "gg-recovery-list";
      list.addEventListener("click", (event) => {
        const target = event.target as Element | null;
        const btn = target?.closest<HTMLButtonElement>("button[data-gg-recovery-index]");
        if (!btn || btn.disabled) return;
        const idx = Number(btn.dataset.ggRecoveryIndex);
        const entry = Number.isInteger(idx) ? this.recoveryUi?.entries[idx] : undefined;
        if (entry) {
          this.handlers.onRestoreEntry(entry);
        }
      });
      ui.listEl = list;
      ui.body.append(list);
    }

    const fragment = document.createDocumentFragment();
    recovery.forEach((entry, index) => {
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
      restoreBtn.dataset.ggRecoveryIndex = String(index);
      restoreBtn.textContent = "Restore";
      restoreBtn.disabled = this.recoveryBusy;
      restoreBtn.setAttribute(
        "aria-label",
        `Restore ${actionLabel} draft: ${formatRecoverySnippet(entry.text, 40)}`,
      );

      row.append(meta, restoreBtn);
      fragment.append(row);
    });

    list.replaceChildren(fragment);
  }

  private attachSlotInputAttributes(
    slot: HTMLElement,
    fieldId: string,
    ariaLabel: string,
  ): void {
    const apply = (): boolean => {
      const input = slot.querySelector("input");
      if (!input) return false;
      if (!input.id) input.id = fieldId;
      if (!input.getAttribute("aria-label")) {
        input.setAttribute("aria-label", ariaLabel);
      }
      return true;
    };

    if (apply() || typeof MutationObserver !== "function") return;

    const observer = new MutationObserver(() => {
      if (apply()) {
        observer.disconnect();
      }
    });
    observer.observe(slot, { childList: true, subtree: true });
    this.handles.push({
      destroy: () => observer.disconnect(),
    });
  }

  private scheduleDebouncedSave(key: string, fn: () => void, delayMs = 250): void {
    const prev = this.debounceTimers.get(key);
    if (prev) clearTimeout(prev.timer);
    const flush = () => {
      if (this.destroyed) return;
      fn();
    };
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      flush();
      this.flushPendingViewIfIdle();
    }, delayMs);
    this.debounceTimers.set(key, { timer, flush });
  }

  flushPendingSaves(): void {
    if (this.destroyed || this.debounceTimers.size === 0) return;
    const entries = Array.from(this.debounceTimers.entries());
    this.debounceTimers.clear();
    for (const [, entry] of entries) {
      clearTimeout(entry.timer);
      entry.flush();
    }
  }

  private flushPendingSaveKey(key: string): void {
    if (this.destroyed) return;
    const entry = this.debounceTimers.get(key);
    if (!entry) return;
    this.debounceTimers.delete(key);
    clearTimeout(entry.timer);
    entry.flush();
  }

  private cancelPendingSaveKey(key: string): void {
    const entry = this.debounceTimers.get(key);
    if (!entry) return;
    this.debounceTimers.delete(key);
    clearTimeout(entry.timer);
  }

  private cancelPendingSaves(): void {
    for (const entry of this.debounceTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.debounceTimers.clear();
  }

  private clearComponentHandles(): void {
    this.expandableTextAreas.clear();
    for (const handle of this.handles) {
      handle.destroy();
    }
    this.handles = [];
  }

  destroy(): void {
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
    for (const cleanup of [...this.tabConnectionCleanups]) {
      cleanup();
    }
    this.tabConnectionCleanups.clear();
    this.scenePanel?.destroy();
    this.scenePanel = null;
    this.shellEl = null;
    this.navEl = null;
    this.navButtons.clear();
    this.navArmedDotEl = null;
    this.subNavButtons.clear();
    this.subNavArmedDotEl = null;
    this.stickyNoticeSlotEl = null;
    this.bodyScrollEl = null;
    this.basicViewEl = null;
    this.advancedViewEl = null;
    this.basicHostEl = null;
    this.sceneWorkbenchHostEl = null;
    this.sceneSettingsHostEl = null;
    this.rootEl = null;
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

function isElementNode(value: unknown): value is Element {
  return Boolean(value && typeof value === "object" && (value as Node).nodeType === 1);
}

const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
]);

function isEditableElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "INPUT") {
    const inputType = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }
  if (
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  ) {
    return true;
  }
  if (
    el.classList.contains("gg-card-header") ||
    el.classList.contains("gg-sub-disclosure-btn") ||
    el.classList.contains("gg-drawer-nav-btn") ||
    el.classList.contains("gg-subnav-btn") ||
    el.classList.contains("gg-segmented-btn")
  ) {
    return false;
  }
  const role = el.getAttribute("role");
  if (role === "combobox" || role === "listbox" || role === "option") {
    return true;
  }
  if (el.getAttribute("aria-expanded") === "true") {
    return true;
  }
  return Boolean(
    el.closest?.(
      '[role="combobox"], [role="listbox"], [role="option"], [aria-expanded="true"]:not(.gg-card-header):not(.gg-sub-disclosure-btn)',
    ),
  );
}

function isClickableInside(root: Element, node: Node | null): boolean {
  if (!isElementNode(node) || !root.contains(node)) return false;
  return Boolean(
    node.closest(
      'button, input[type="checkbox"], label, [role="button"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], summary, a[href]',
    ),
  );
}

function escapeCssAttrValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function findElementByAttribute(
  root: HTMLElement,
  attrName: string,
  attrValue: string,
  tagName?: string,
): HTMLElement | null {
  const tag = tagName ? tagName.toLowerCase() : "";
  try {
    const escaped = escapeCssAttrValue(attrValue);
    return root.querySelector<HTMLElement>(`${tag}[${attrName}="${escaped}"]`);
  } catch {
    for (const el of root.querySelectorAll<HTMLElement>(`${tag}[${attrName}]`)) {
      if (el.getAttribute(attrName) === attrValue) {
        return el;
      }
    }
    return null;
  }
}

function getActiveConnectionId(ctx: SpindleFrontendContext): string | null {
  const conns = (
    ctx as SpindleFrontendContext & {
      connections?: { getActive?(): { activeProfileId?: string | null } };
    }
  ).connections;
  return conns?.getActive?.()?.activeProfileId ?? null;
}

function buildModelConnectionRef(connectionId: string | null): SpindleConnectionRef {
  return connectionId ? { kind: "llm", id: connectionId } : { kind: "llm" };
}

function buildModelPlaceholder(
  configuredConnectionId: string | null,
  connections: readonly ConnectionOptionSummary[],
  activeConnectionId: string | null,
): string {
  const target = configuredConnectionId
    ? connections.find((c) => c.id === configuredConnectionId)
    : (activeConnectionId ? connections.find((c) => c.id === activeConnectionId) : undefined) ??
      connections.find((c) => c.isDefault) ??
      connections[0];
  const currentModel = target?.model?.trim();
  return currentModel
    ? `Use connection model (${currentModel})`
    : "Leave blank for connection model";
}

let fieldLabelSeq = 0;

function createFieldContainer(
  labelText: string,
  fieldId?: string,
): {
  wrap: HTMLDivElement;
  slot: HTMLDivElement;
  label: HTMLLabelElement;
} {
  const wrap = document.createElement("div");
  wrap.className = "gg-field";
  const label = document.createElement("label");
  label.className = "gg-field-label";
  label.id = `gg-field-label-${++fieldLabelSeq}`;
  if (fieldId) label.htmlFor = fieldId;
  label.textContent = labelText;
  const slot = document.createElement("div");
  wrap.append(label, slot);
  return { wrap, slot, label };
}

function buildConnectionOptions(
  connections: readonly ConnectionOptionSummary[],
): SpindleSelectOption[] {
  return [
    {
      value: "",
      label: "Use Active Connection",
      sublabel: "Inherits whichever connection profile is currently active",
    },
    ...connections.map((conn) => ({
      value: conn.id,
      label: conn.name,
      sublabel: conn.model ? `${conn.provider} · ${conn.model}` : conn.provider,
    })),
  ];
}

function buildPresetOptions(
  presets: readonly PresetOptionSummary[],
): SpindleSelectOption[] {
  return [
    {
      value: "",
      label: "Use Active Preset",
      sublabel: "Inherits the active chat or connection preset",
    },
    ...presets.map((preset) => ({
      value: preset.id,
      label: preset.name,
    })),
  ];
}
