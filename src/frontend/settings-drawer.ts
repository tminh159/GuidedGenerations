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
  GUIDANCE_POSITION_OPTIONS,
  GUIDED_ACTION_ORDER,
  TOOLBAR_PLACEMENT_OPTIONS,
  normalizeButtonOrder,
  normalizeGuidanceDepth,
  normalizeGuidancePosition,
  normalizeToolbarPlacement,
} from "../shared/defaults";
import type {
  ConnectionOptionSummary,
  ExtensionBootstrapView,
  GuidanceInjectionRole,
  GuidancePosition,
  GuidedActionId,
  GuidedGenerationsSettings,
  PresetOptionSummary,
  RecoveryEntry,
  ToolbarOptionId,
  ToolbarPlacement,
} from "../shared/types";
import { DRAWER_TAB_ICON_SVG, TOOLBAR_ICONS } from "./icons";
import { formatRecoverySnippet } from "./recovery-store";

interface DestroyableHandle {
  destroy(): void;
}

export interface SaveSettingsOptions {
  rebuildDrawer?: boolean;
}

export interface SettingsDrawerHandlers {
  onRefresh(): void;
  onSaveSettings(next: GuidedGenerationsSettings, options?: SaveSettingsOptions): Promise<void>;
  onRestoreEntry(entry: RecoveryEntry): void;
  onClearRecovery(): Promise<void>;
}

export interface RenderDrawerOptions {
  force?: boolean;
}

interface PendingFocusRestore {
  optionId: ToolbarOptionId;
  button: "up" | "down";
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
  maxEntries: number;
  recoveryCount: number;
}

export class SettingsDrawerController {
  private readonly tab: SpindleDrawerTabHandle;
  private handles: DestroyableHandle[] = [];
  private currentSettings: GuidedGenerationsSettings | null = null;
  private expandedSections = new Set<string>();
  private debounceTimers = new Map<string, DebouncedEntry>();
  private orderStateTags = new Map<ToolbarOptionId, HTMLSpanElement>();
  private rootEl: HTMLDivElement | null = null;
  private headerEl: HTMLElement | null = null;
  private noticeEl: HTMLDivElement | null = null;
  private recoveryUi: RecoverySectionUi | null = null;
  private pendingView: ExtensionBootstrapView | null = null;
  private pendingFocusRestore: PendingFocusRestore | null = null;
  private noticeText = "";
  private noticeKind: "info" | "warn" | "error" = "info";
  private destroyed = false;
  private readonly onFocusOut: (event: FocusEvent) => void;

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private readonly handlers: SettingsDrawerHandlers,
  ) {
    this.tab = ctx.ui.registerDrawerTab({
      id: "guided-generations-settings",
      title: "Guided Generations",
      shortName: "Guided",
      description:
        "Configure input-bar guided action buttons and per-option API connection profiles & presets.",
      keywords: [
        "guided",
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

    this.onFocusOut = (event: FocusEvent) => {
      if (this.destroyed) return;
      const nextTarget = event.relatedTarget as Node | null;
      const stillInsideEditable =
        isElementNode(nextTarget) &&
        this.tab.root.contains(nextTarget) &&
        isEditableElement(nextTarget);
      if (!stillInsideEditable) {
        if (this.debounceTimers.size > 0) {
          this.flushPendingSaves();
        }
        queueMicrotask(() => {
          if (this.destroyed) return;
          if (this.pendingView && !this.isEditingDrawerInput()) {
            const next: ExtensionBootstrapView = this.currentSettings
              ? { ...this.pendingView, settings: this.currentSettings }
              : this.pendingView;
            this.pendingView = null;
            this.render(next, { force: true });
          }
        });
      }
    };
    this.tab.root.addEventListener("focusout", this.onFocusOut);
  }

  onActivate(handler: () => void): () => void {
    return this.tab.onActivate(handler);
  }

  setNotice(text: string, kind: "info" | "warn" | "error" = "info"): void {
    this.noticeText = text;
    this.noticeKind = kind;
    this.syncNoticeElement();
  }

  private syncNoticeElement(): void {
    if (this.destroyed || !this.rootEl || !this.headerEl) return;
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

  updateRecovery(
    recovery: readonly RecoveryEntry[],
    settings?: GuidedGenerationsSettings,
  ): void {
    if (this.destroyed || !this.recoveryUi) return;
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
    this.recoveryUi.clearBtn.disabled = recovery.length === 0;
    this.syncRecoveryList(recovery);
  }

  private isEditingDrawerInput(): boolean {
    if (this.debounceTimers.size > 0) return true;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return Boolean(
      isElementNode(active) &&
        this.tab.root.contains(active) &&
        isEditableElement(active),
    );
  }

  private captureOrderButtonFocus(): void {
    if (this.pendingFocusRestore) return;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (!isElementNode(active) || active.tagName !== "BUTTON" || !this.tab.root.contains(active)) {
      return;
    }
    const btn = active as HTMLButtonElement;
    const moveDir = btn.dataset.ggMove;
    if (moveDir !== "up" && moveDir !== "down") return;
    const row = btn.closest("[data-gg-order-id]");
    const optionId = row?.getAttribute("data-gg-order-id") as ToolbarOptionId | null;
    if (optionId) {
      this.pendingFocusRestore = { optionId, button: moveDir };
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
    sub.textContent =
      "Enabled options appear on the composer's top action bar alongside native buttons. Each option uses its own connection profile, model, and preset without modifying your active chat.";
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

    const missingPerms: string[] = [];
    if (!view.permissions.generation) missingPerms.push("generation");
    if (!view.permissions.chats) missingPerms.push("chats");
    if (!view.permissions.chat_mutation) missingPerms.push("chat_mutation");
    if (!view.permissions.presets) missingPerms.push("presets");

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
    if (view.permissions.interceptor === false) {
      missingFeaturePerms.push("interceptor");
      degradedNotes.push(
        "preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement",
      );
    }
    if (view.permissions.regex_scripts === false) {
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
    const roleOptions: SpindleSelectOption[] = [
      { value: "system", label: "System" },
      { value: "user", label: "User" },
      { value: "assistant", label: "Assistant" },
    ];

    this.renderToolbarLayoutSection(root, view.settings);

    for (const actionId of GUIDED_ACTION_ORDER) {
      this.renderActionSection(
        root,
        view.settings,
        actionId,
        view.connections,
        connectionOptions,
        presetOptions,
        roleOptions,
      );
    }

    this.renderRecoverySection(root, view.settings, view.recovery);

    if (this.pendingFocusRestore) {
      const restore = this.pendingFocusRestore;
      this.pendingFocusRestore = null;
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
    }
  }

  private createCollapsibleCard(
    parent: HTMLElement,
    sectionId: string,
    title: string,
    badgeText: string | undefined,
    badgeMuted = false,
  ): {
    body: HTMLDivElement;
    setBadge(nextText: string, muted?: boolean): void;
  } {
    const card = document.createElement("section");
    card.className = "gg-card";
    if (this.expandedSections.has(sectionId)) {
      card.classList.add("is-expanded");
    }

    const headerBtn = document.createElement("button");
    headerBtn.type = "button";
    headerBtn.className = "gg-card-header";
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
        options: TOOLBAR_PLACEMENT_OPTIONS.map((opt) => ({
          value: opt.value,
          label: opt.label,
          sublabel: opt.sublabel,
        })),
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

      const labelText =
        optionId === "input_recovery" ? "Input Recovery" : ACTION_METADATA[optionId].label;
      const isVisible =
        optionId === "input_recovery"
          ? settings.inputRecovery.enabled
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

    const card = this.createCollapsibleCard(
      parent,
      actionId,
      meta.label,
      cfg.enabled ? "Visible" : "Hidden",
      !cfg.enabled,
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

    // Enable button toggle
    const enableRow = document.createElement("div");
    enableRow.className = "gg-row";
    const enableLabel = document.createElement("span");
    enableLabel.className = "gg-field-label";
    enableLabel.textContent = "Show button on input bar";
    const enableSlot = document.createElement("div");
    enableRow.append(enableLabel, enableSlot);
    body.append(enableRow);

    this.handles.push(
      this.ctx.components.mountSwitch(enableSlot, {
        checked: cfg.enabled,
        size: "sm",
        ariaLabel: `Show ${meta.label} button on input bar`,
        onChange: (checked) => savePatch({ enabled: checked }, { rebuildDrawer: false }),
      }),
    );

    // Clear composer input toggle
    const clearRow = document.createElement("div");
    clearRow.className = "gg-row";
    const clearLabel = document.createElement("span");
    clearLabel.className = "gg-field-label";
    clearLabel.textContent = "Clear input bar when triggered";
    const clearSlot = document.createElement("div");
    clearRow.append(clearLabel, clearSlot);
    body.append(clearRow);

    this.handles.push(
      this.ctx.components.mountSwitch(clearSlot, {
        checked: cfg.clearInputOnRun,
        size: "sm",
        ariaLabel: `Clear input bar when running ${meta.label}`,
        onChange: (checked) => savePatch({ clearInputOnRun: checked }),
      }),
    );

    // Per-action Lumiverse regex scripts toggle
    const regexRow = document.createElement("div");
    regexRow.className = "gg-row";
    const regexLabel = document.createElement("span");
    regexLabel.className = "gg-field-label";
    regexLabel.textContent = "Apply Lumiverse regex scripts";
    const regexSlot = document.createElement("div");
    regexRow.append(regexLabel, regexSlot);
    body.append(regexRow);

    this.handles.push(
      this.ctx.components.mountSwitch(regexSlot, {
        checked: cfg.applyRegex ?? DEFAULT_APPLY_REGEX,
        size: "sm",
        ariaLabel: `Apply Lumiverse regex scripts for ${meta.label}`,
        onChange: (checked) => savePatch({ applyRegex: checked }),
      }),
    );

    const activeConnectionId = getActiveConnectionId(this.ctx);
    let modelHandle: SpindleModelComboboxHandle | null = null;

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
          savePatch({ connectionId: nextConnectionId });
          modelHandle?.update({
            connection: buildModelConnectionRef(nextConnectionId),
            placeholder: buildModelPlaceholder(nextConnectionId, connections, activeConnectionId),
          });
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
        connection: buildModelConnectionRef(cfg.connectionId),
        appearance: "standard",
        autoRefreshOnFocus: true,
        placeholder: buildModelPlaceholder(cfg.connectionId, connections, activeConnectionId),
        onChange: (value) => {
          this.scheduleDebouncedSave(`${actionId}:model`, () => {
            savePatch({ model: value.trim() || null });
          });
        },
      });
      const comboboxInput = modelField.slot.querySelector("input");
      if (comboboxInput) {
        if (!comboboxInput.id) comboboxInput.id = modelFieldId;
        if (!comboboxInput.getAttribute("aria-label")) {
          comboboxInput.setAttribute("aria-label", `${meta.label} Model`);
        }
      }
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
        options: GUIDANCE_POSITION_OPTIONS.map((opt) => ({
          value: opt.value,
          label: opt.label,
          sublabel: opt.sublabel,
        })),
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
    this.handles.push(
      this.ctx.components.mountTextArea(templateField.slot, {
        value: cfg.instructionTemplate,
        rows: 2,
        placeholder: "{{input}}",
        ariaLabel: `${meta.label} Guidance Template`,
        onChange: (value) => {
          this.scheduleDebouncedSave(`${actionId}:template`, () => {
            savePatch({ instructionTemplate: value });
          });
        },
      }),
    );
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
    let syncingUi = false;
    let handle: SpindleNumericInputHandle | null = null;
    let fallbackInput: HTMLInputElement | null = null;

    const commitInput = (rawNumber: number | null) => {
      if (syncingUi) return;
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
        onChange: commitInput,
      });
      const mountedInput = options.slot.querySelector("input");
      if (mountedInput) {
        if (!mountedInput.id) mountedInput.id = options.fieldId;
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

    const enableRow = document.createElement("div");
    enableRow.className = "gg-row";
    const enableLabel = document.createElement("span");
    enableLabel.className = "gg-field-label";
    enableLabel.textContent = "Enable Input Recovery & toolbar button";
    const enableSlot = document.createElement("div");
    enableRow.append(enableLabel, enableSlot);
    body.append(enableRow);

    this.handles.push(
      this.ctx.components.mountSwitch(enableSlot, {
        checked: settings.inputRecovery.enabled,
        size: "sm",
        ariaLabel: "Show Input Recovery button on input bar",
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
      }),
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
    clearBtn.textContent = "Clear History";
    clearBtn.disabled = recovery.length === 0;
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
      maxEntries: settings.inputRecovery.maxEntries,
      recoveryCount: recovery.length,
    };

    this.syncRecoveryList(recovery);
  }

  private syncRecoveryList(recovery: readonly RecoveryEntry[]): void {
    if (!this.recoveryUi) return;
    if (this.recoveryUi.listEl) {
      this.recoveryUi.listEl.remove();
      this.recoveryUi.listEl = null;
    }

    if (recovery.length === 0) return;

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
      restoreBtn.setAttribute(
        "aria-label",
        `Restore ${actionLabel} draft: ${formatRecoverySnippet(entry.text, 40)}`,
      );
      restoreBtn.addEventListener("click", () => this.handlers.onRestoreEntry(entry));

      row.append(meta, restoreBtn);
      list.append(row);
    }

    this.recoveryUi.listEl = list;
    this.recoveryUi.body.append(list);
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
      if (this.pendingView && !this.isEditingDrawerInput()) {
        const next: ExtensionBootstrapView = this.currentSettings
          ? { ...this.pendingView, settings: this.currentSettings }
          : this.pendingView;
        this.pendingView = null;
        this.render(next, { force: true });
      }
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

  private cancelPendingSaves(): void {
    for (const entry of this.debounceTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.debounceTimers.clear();
  }

  private clearComponentHandles(): void {
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

function isElementNode(value: unknown): value is Element {
  return Boolean(value && typeof value === "object" && (value as Node).nodeType === 1);
}

function isEditableElement(el: Element): boolean {
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
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
