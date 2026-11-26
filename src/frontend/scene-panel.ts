import type {
  SpindleFrontendContext,
  SpindleSelectHandle,
  SpindleSelectOption,
} from "lumiverse-spindle-types";
import {
  normalizeSceneAdjustmentMode,
  normalizeSceneDelivery,
  normalizeSceneDropTarget,
  normalizeScenePacing,
} from "../shared/defaults";
import type {
  ActiveRunState,
  ArmedSceneState,
  ArmSceneInput,
  DropSceneNowInput,
  DropSceneNowResult,
  GuidedGenerationsSettings,
  GuidedSceneAdjustmentMode,
  GuidedSceneChatContext,
  GuidedSceneConfig,
  GuidedSceneDelivery,
  GuidedSceneDraftBaseInput,
  GuidedSceneDropTarget,
  GuidedSceneGreetingOption,
  GuidedSceneGreetingSource,
  GuidedScenePacing,
  PreviewSceneDraftInput,
  PreviewSceneDraftResult,
  UpdateArmedSceneInput,
} from "../shared/types";
import {
  mountExpandableTextArea,
  type ExpandableTextAreaHandle,
} from "./expandable-textarea";
import { DRAWER_NAV_ICONS } from "./icons";

export const CUSTOM_GREETING_VALUE = "__gg_custom_empty__";

export interface ScenePanelCallbacks {
  onRefreshContext(): Promise<void>;
  onSaveSceneConfigPatch(patch: Partial<GuidedSceneConfig>): Promise<void>;
  onPreviewDraft(input: PreviewSceneDraftInput): Promise<PreviewSceneDraftResult>;
  onAbortRun(runId: string): void;
  onDropSceneNow(input: DropSceneNowInput): Promise<DropSceneNowResult>;
  onArmScene(input: ArmSceneInput): Promise<ArmedSceneState | null>;
  onUpdateArmedScene(input: UpdateArmedSceneInput): Promise<ArmedSceneState | null>;
  onPauseScene(chatId: string): Promise<ArmedSceneState | null>;
  onResumeScene(chatId: string): Promise<ArmedSceneState | null>;
  onDropNextTurn(chatId: string): Promise<ArmedSceneState | null>;
  onCancelScene(chatId: string): Promise<void>;
  onCancelPreview?(chatId: string): void | Promise<void>;
  getActiveConnectionId(): string | null;
}

const PACING_SELECT_OPTIONS: SpindleSelectOption[] = [
  { value: "drop_now", label: "Drop Now", sublabel: "Insert scene immediately" },
  { value: "next_turn", label: "Next Turn", sublabel: "Bridge & drop on next turn" },
  { value: "multi_turn", label: "Multi-Turn", sublabel: "Steer across turns until ready" },
];

const DELIVERY_SELECT_OPTIONS: SpindleSelectOption[] = [
  { value: "cut", label: "Hard Cut", sublabel: "Jump directly into the scene" },
  { value: "time_skip", label: "Time Skip", sublabel: "Brief time-skip lead-in" },
  { value: "bridge", label: "In-Scene Bridge", sublabel: "Smooth narrative bridge" },
];

const ADJUSTMENT_SELECT_OPTIONS: SpindleSelectOption[] = [
  { value: "verbatim", label: "Verbatim", sublabel: "Use text as-is" },
  { value: "context_adapt", label: "Context Adapt", sublabel: "Adapt details to chat history" },
  { value: "summary_rewrite", label: "Summary Rewrite", sublabel: "Rewrite around current arc" },
];

function buildDropTargetSelectOptions(canSwipe: boolean): SpindleSelectOption[] {
  return [
    { value: "new_message", label: "New Message" },
    {
      value: "new_swipe",
      label: "New Swipe",
      disabled: !canSwipe,
      sublabel: canSwipe
        ? "Swipe on last assistant message"
        : "Last message is not assistant",
    },
  ];
}

function formatSnippet(text: string, maxLen = 56): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return "(empty)";
  return singleLine.length > maxLen
    ? `${singleLine.slice(0, maxLen - 1)}…`
    : singleLine;
}

function buildGreetingSelectOptions(
  context: GuidedSceneChatContext,
): SpindleSelectOption[] {
  const cardOptions: SpindleSelectOption[] = context.greetings.map((opt) => {
    const baseLabel = context.isGroup
      ? `${opt.characterName} · Greeting #${opt.greetingIndex + 1}`
      : `Greeting #${opt.greetingIndex + 1}`;
    const metaParts: string[] = [];
    if (opt.isOpening) metaParts.push("Opened chat");
    if (opt.hasMedia) metaParts.push("Media");
    metaParts.push(opt.preview || formatSnippet(opt.text, 52));
    return {
      value: opt.key,
      label: baseLabel,
      sublabel: metaParts.join(" · "),
      ...(context.isGroup ? { group: opt.characterName } : {}),
    };
  });

  cardOptions.push({
    value: CUSTOM_GREETING_VALUE,
    label: "Custom",
    sublabel: "Write or paste a custom scene in the preview box",
  });

  return cardOptions;
}

function buildSpeakerSelectOptions(
  context: GuidedSceneChatContext,
): SpindleSelectOption[] {
  return context.members.map((m) => ({
    value: m.id,
    label: m.name,
  }));
}

function describeArmedTarget(
  armed: ArmedSceneState,
  context: GuidedSceneChatContext | null,
): string {
  if (armed.greetingLabel?.trim()) {
    return armed.greetingLabel.trim();
  }
  if (armed.greetingSource === "custom") {
    return "Custom Scene";
  }
  const matched = context?.greetings.find((g) => g.key === armed.selectedGreetingKey);
  if (matched) {
    return context?.isGroup
      ? `${matched.characterName} #${matched.greetingIndex + 1}`
      : `Greeting #${matched.greetingIndex + 1}`;
  }
  return "Greeting";
}

function createCompactSelectField(
  labelText: string,
  extraClass?: string,
): { wrap: HTMLDivElement; slot: HTMLDivElement } {
  const wrap = document.createElement("div");
  wrap.className = extraClass ? `gg-field ${extraClass}` : "gg-field";
  const label = document.createElement("span");
  label.className = "gg-scene-compact-label";
  label.textContent = labelText;
  const slot = document.createElement("div");
  wrap.append(label, slot);
  return { wrap, slot };
}

export class GuidedScenePanel {
  private readonly root: HTMLDivElement;
  private context: GuidedSceneChatContext | null = null;
  private settings: GuidedGenerationsSettings | null = null;
  private activeRun: ActiveRunState | null = null;
  private isOtherBusy = false;
  private loading = false;
  private readonly busyChatIds = new Set<string>();
  private previewBusy = false;
  private previewSeq = 0;
  private localError: string | null = null;
  private destroyed = false;

  // Ephemeral staging state (hydrated from armedScene when armed, else settings.guidedScene sticky defaults)
  private hydratedChatId: string | null = null;
  private hydratedArmedAt: number | null = null;
  private greetingSource: GuidedSceneGreetingSource = "card";
  private selectedGreetingKey = "";
  private customText = "";
  private speakerCharacterId: string | null = null;
  private pacing: GuidedScenePacing = "drop_now";
  private dropTarget: GuidedSceneDropTarget = "new_message";
  private delivery: GuidedSceneDelivery = "time_skip";
  private transitionNote = "";
  private adjustmentMode: GuidedSceneAdjustmentMode = "verbatim";
  private customDirection = "";
  private keepMediaIntact = true;
  private previewText = "";
  private draftLocked = false;

  // Persistent DOM refs (preserved across background updates for focus/caret stability)
  private bannerEl: HTMLDivElement;
  private bannerTitleText: HTMLSpanElement;
  private bannerBadgeEl: HTMLSpanElement;
  private bannerPauseBtn: HTMLButtonElement;
  private bannerDropNextBtn: HTMLButtonElement;
  private bannerDropNowBtn: HTMLButtonElement;
  private bannerCancelBtn: HTMLButtonElement;

  private errorEl: HTMLDivElement;
  private emptyEl: HTMLDivElement;
  private emptyTextEl: HTMLDivElement;
  private workbenchEl: HTMLDivElement;

  private greetingSelectSlot: HTMLDivElement;
  private greetingSelectHandle: SpindleSelectHandle | null = null;
  private lastGreetingOptionsSig = "";
  private greetingBadgesEl: HTMLDivElement;

  private speakerRowEl: HTMLDivElement;
  private speakerSelectSlot: HTMLDivElement;
  private speakerSelectHandle: SpindleSelectHandle | null = null;
  private lastSpeakerOptionsSig = "";

  private pacingSelectSlot: HTMLDivElement;
  private pacingSelectHandle: SpindleSelectHandle | null = null;
  private deliverySelectSlot: HTMLDivElement;
  private deliverySelectHandle: SpindleSelectHandle | null = null;
  private adjustmentFieldWrap: HTMLDivElement;
  private adjustmentSelectSlot: HTMLDivElement;
  private adjustmentSelectHandle: SpindleSelectHandle | null = null;
  private dropTargetFieldWrap: HTMLDivElement;
  private dropTargetSelectSlot: HTMLDivElement;
  private dropTargetSelectHandle: SpindleSelectHandle | null = null;
  private lastDropTargetCanSwipe: boolean | null = null;

  private transitionNoteInput: HTMLInputElement;
  private customDirectionRowEl: HTMLDivElement;
  private customDirectionInput: HTMLInputElement;

  private keepMediaCheckbox: HTMLInputElement;
  private previewStatusBadge: HTMLSpanElement;
  private previewDraftBtn: HTMLButtonElement;
  private previewResetBtn: HTMLButtonElement;
  private previewSlot: HTMLDivElement;
  private previewTextAreaHandle: ExpandableTextAreaHandle | null = null;
  private lastPreviewPlaceholder = "";
  private lastPreviewDisabled = false;

  private primaryBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private refreshBtn: HTMLButtonElement;

  constructor(
    private readonly ctx: SpindleFrontendContext,
    private readonly callbacks: ScenePanelCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "gg-scene-panel";

    // Sticky Armed Banner
    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "gg-armed-banner";
    this.bannerEl.style.display = "none";
    this.bannerEl.setAttribute("role", "status");
    this.bannerEl.setAttribute("aria-live", "polite");

    const bannerTop = document.createElement("div");
    bannerTop.className = "gg-armed-banner-top";
    const bannerTitle = document.createElement("span");
    bannerTitle.className = "gg-armed-banner-title";
    const dot = document.createElement("span");
    dot.className = "gg-armed-dot";
    dot.setAttribute("aria-hidden", "true");
    this.bannerTitleText = document.createElement("span");
    bannerTitle.append(dot, this.bannerTitleText);

    this.bannerBadgeEl = document.createElement("span");
    this.bannerBadgeEl.className = "gg-badge is-info";
    bannerTop.append(bannerTitle, this.bannerBadgeEl);

    const bannerActions = document.createElement("div");
    bannerActions.className = "gg-armed-banner-actions";

    this.bannerPauseBtn = document.createElement("button");
    this.bannerPauseBtn.type = "button";
    this.bannerPauseBtn.className = "gg-btn-sm is-xs";
    this.bannerPauseBtn.dataset.ggSceneBanner = "toggle-pause";
    this.bannerPauseBtn.textContent = "Pause";
    this.bannerPauseBtn.addEventListener("click", () => {
      void this.handleTogglePause();
    });

    this.bannerDropNextBtn = document.createElement("button");
    this.bannerDropNextBtn.type = "button";
    this.bannerDropNextBtn.className = "gg-btn-sm is-xs";
    this.bannerDropNextBtn.dataset.ggSceneBanner = "drop-next";
    this.bannerDropNextBtn.textContent = "Drop Next";
    this.bannerDropNextBtn.addEventListener("click", () => {
      void this.handleDropNextTurn();
    });

    this.bannerDropNowBtn = document.createElement("button");
    this.bannerDropNowBtn.type = "button";
    this.bannerDropNowBtn.className = "gg-btn-sm is-xs is-primary";
    this.bannerDropNowBtn.dataset.ggSceneBanner = "drop-now";
    this.bannerDropNowBtn.textContent = "Drop Now";
    this.bannerDropNowBtn.addEventListener("click", () => {
      void this.handleBannerDropNow();
    });

    this.bannerCancelBtn = document.createElement("button");
    this.bannerCancelBtn.type = "button";
    this.bannerCancelBtn.className = "gg-btn-sm is-xs is-danger";
    this.bannerCancelBtn.dataset.ggSceneBanner = "cancel";
    this.bannerCancelBtn.textContent = "Cancel";
    this.bannerCancelBtn.addEventListener("click", () => {
      void this.handleCancelSteering();
    });

    bannerActions.append(
      this.bannerPauseBtn,
      this.bannerDropNextBtn,
      this.bannerDropNowBtn,
      this.bannerCancelBtn,
    );
    this.bannerEl.append(bannerTop, bannerActions);

    // Inline error notice (attached only when localError is non-empty)
    this.errorEl = document.createElement("div");
    this.errorEl.className = "gg-notice is-error";
    this.errorEl.setAttribute("role", "alert");

    // Empty / loading state
    this.emptyEl = document.createElement("div");
    this.emptyEl.className = "gg-scene-empty";
    const emptyIcon = document.createElement("div");
    emptyIcon.className = "gg-scene-empty-icon";
    emptyIcon.setAttribute("aria-hidden", "true");
    emptyIcon.innerHTML = DRAWER_NAV_ICONS.scene;
    this.emptyTextEl = document.createElement("div");
    this.emptyTextEl.textContent =
      "Open a character or group chat to stage or steer a Guided Scene.";
    this.emptyEl.append(emptyIcon, this.emptyTextEl);

    // Compact workbench container
    this.workbenchEl = document.createElement("div");
    this.workbenchEl.className = "gg-drawer-view";
    this.workbenchEl.style.display = "none";

    // === Section 1: Greeting (+ optional Group Speaker) ===
    const secGreeting = document.createElement("section");
    secGreeting.className = "gg-section";
    secGreeting.dataset.ggSceneSection = "greeting";

    const secGreetingTitle = document.createElement("div");
    secGreetingTitle.className = "gg-section-title";

    const secGreetingLeft = document.createElement("div");
    secGreetingLeft.className = "gg-scene-header-badges";
    const secGreetingLabel = document.createElement("span");
    secGreetingLabel.textContent = "Greeting";
    this.greetingBadgesEl = document.createElement("div");
    this.greetingBadgesEl.className = "gg-scene-header-badges";
    secGreetingLeft.append(secGreetingLabel, this.greetingBadgesEl);

    this.refreshBtn = document.createElement("button");
    this.refreshBtn.type = "button";
    this.refreshBtn.className = "gg-btn-sm is-xs";
    this.refreshBtn.dataset.ggSceneAction = "refresh";
    this.refreshBtn.textContent = "Refresh";
    this.refreshBtn.addEventListener("click", () => {
      void this.callbacks.onRefreshContext();
    });
    secGreetingTitle.append(secGreetingLeft, this.refreshBtn);

    this.greetingSelectSlot = document.createElement("div");

    const speakerField = createCompactSelectField("Speaker");
    this.speakerRowEl = speakerField.wrap;
    this.speakerRowEl.style.display = "none";
    this.speakerSelectSlot = speakerField.slot;

    secGreeting.append(secGreetingTitle, this.greetingSelectSlot, this.speakerRowEl);

    // === Section 2: Compact 2-Column Options Grid (Pacing, Delivery, Adjustment, Drop As) ===
    const secOptions = document.createElement("section");
    secOptions.className = "gg-section";
    secOptions.dataset.ggSceneSection = "options";

    const optionsGrid = document.createElement("div");
    optionsGrid.className = "gg-scene-grid-2";

    const pacingField = createCompactSelectField("Pacing");
    this.pacingSelectSlot = pacingField.slot;

    const deliveryField = createCompactSelectField("Delivery");
    this.deliverySelectSlot = deliveryField.slot;

    const adjustmentField = createCompactSelectField("Adjustment");
    this.adjustmentFieldWrap = adjustmentField.wrap;
    this.adjustmentSelectSlot = adjustmentField.slot;

    const dropTargetField = createCompactSelectField("Drop As");
    this.dropTargetFieldWrap = dropTargetField.wrap;
    this.dropTargetSelectSlot = dropTargetField.slot;

    optionsGrid.append(
      pacingField.wrap,
      deliveryField.wrap,
      adjustmentField.wrap,
      dropTargetField.wrap,
    );

    this.transitionNoteInput = document.createElement("input");
    this.transitionNoteInput.type = "text";
    this.transitionNoteInput.className = "gg-input-sm";
    this.transitionNoteInput.placeholder = "Transition note (optional)";
    this.transitionNoteInput.setAttribute("aria-label", "Transition note");
    this.transitionNoteInput.dataset.ggSceneField = "transition-note";
    this.transitionNoteInput.addEventListener("input", () => {
      this.transitionNote = this.transitionNoteInput.value;
    });

    this.customDirectionRowEl = document.createElement("div");
    this.customDirectionRowEl.className = "gg-field";
    this.customDirectionInput = document.createElement("input");
    this.customDirectionInput.type = "text";
    this.customDirectionInput.className = "gg-input-sm";
    this.customDirectionInput.placeholder = "Custom direction (optional)";
    this.customDirectionInput.setAttribute("aria-label", "Custom direction");
    this.customDirectionInput.dataset.ggSceneField = "custom-direction";
    this.customDirectionInput.addEventListener("input", () => {
      this.customDirection = this.customDirectionInput.value;
    });
    this.customDirectionRowEl.append(this.customDirectionInput);

    secOptions.append(
      optionsGrid,
      this.transitionNoteInput,
      this.customDirectionRowEl,
    );

    // === Section 3: Staging Preview + Canonical Keep Media Intact Checkbox ===
    const secPreview = document.createElement("section");
    secPreview.className = "gg-section";
    secPreview.dataset.ggSceneSection = "preview";

    // Single canonical Keep media intact tick box
    const keepMediaRow = document.createElement("div");
    keepMediaRow.className = "gg-checkbox-row is-compact";
    const keepMediaLabel = document.createElement("label");
    keepMediaLabel.className = "gg-checkbox-label";
    this.keepMediaCheckbox = document.createElement("input");
    this.keepMediaCheckbox.type = "checkbox";
    this.keepMediaCheckbox.className = "gg-checkbox";
    this.keepMediaCheckbox.checked = this.keepMediaIntact;
    this.keepMediaCheckbox.setAttribute(
      "aria-label",
      "Keep media intact in Guided Scene",
    );
    this.keepMediaCheckbox.addEventListener("change", () => {
      this.keepMediaIntact = this.keepMediaCheckbox.checked;
      void this.callbacks.onSaveSceneConfigPatch({
        keepMediaIntact: this.keepMediaIntact,
      });
    });
    const keepMediaText = document.createElement("span");
    keepMediaText.textContent = "Keep media intact";
    keepMediaLabel.append(this.keepMediaCheckbox, keepMediaText);
    keepMediaRow.append(keepMediaLabel);

    const previewBar = document.createElement("div");
    previewBar.className = "gg-scene-preview-bar";

    const previewTitleGroup = document.createElement("div");
    previewTitleGroup.className = "gg-scene-preview-title-group";
    const previewLabel = document.createElement("span");
    previewLabel.className = "gg-field-label";
    previewLabel.textContent = "Staging Preview";
    this.previewStatusBadge = document.createElement("span");
    this.previewStatusBadge.className = "gg-badge";
    this.previewStatusBadge.dataset.ggSceneStatus = "preview";
    previewTitleGroup.append(previewLabel, this.previewStatusBadge);

    const previewActions = document.createElement("div");
    previewActions.className = "gg-scene-preview-actions";

    this.previewDraftBtn = document.createElement("button");
    this.previewDraftBtn.type = "button";
    this.previewDraftBtn.className = "gg-btn-sm is-xs";
    this.previewDraftBtn.dataset.ggSceneAction = "preview-draft";
    this.previewDraftBtn.textContent = "Preview Draft";
    this.previewDraftBtn.addEventListener("click", () => {
      void this.handlePreviewDraft();
    });

    this.previewResetBtn = document.createElement("button");
    this.previewResetBtn.type = "button";
    this.previewResetBtn.className = "gg-btn-sm is-xs";
    this.previewResetBtn.dataset.ggSceneAction = "reset-preview";
    this.previewResetBtn.textContent = "Reset";
    this.previewResetBtn.addEventListener("click", () => {
      this.handleResetPreview();
    });

    previewActions.append(this.previewDraftBtn, this.previewResetBtn);
    previewBar.append(previewTitleGroup, previewActions);

    this.previewSlot = document.createElement("div");
    this.previewSlot.dataset.ggSceneField = "preview-slot";

    secPreview.append(keepMediaRow, previewBar, this.previewSlot);

    // === Primary Action Footer ===
    const footer = document.createElement("div");
    footer.className = "gg-scene-footer";

    this.primaryBtn = document.createElement("button");
    this.primaryBtn.type = "button";
    this.primaryBtn.className = "gg-scene-primary-btn";
    this.primaryBtn.dataset.ggSceneAction = "primary";
    this.primaryBtn.addEventListener("click", () => {
      void this.handlePrimaryAction();
    });

    this.stopBtn = document.createElement("button");
    this.stopBtn.type = "button";
    this.stopBtn.className = "gg-scene-stop-btn";
    this.stopBtn.dataset.ggSceneAction = "stop";
    this.stopBtn.textContent = "Stop Guided Scene";
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => {
      if (this.activeRun?.actionId === "guided_scene") {
        this.callbacks.onAbortRun(this.activeRun.runId);
      }
    });

    footer.append(this.primaryBtn, this.stopBtn);

    this.workbenchEl.append(secGreeting, secOptions, secPreview, footer);
    this.root.append(this.bannerEl, this.emptyEl, this.workbenchEl);

    this.mountOptionSelects();
    this.mountPreviewTextArea();
  }

  private mountPreviewTextArea(): void {
    const initialPlaceholder = "Select a greeting to stage…";
    this.lastPreviewPlaceholder = initialPlaceholder;
    this.lastPreviewDisabled = false;

    this.previewTextAreaHandle = mountExpandableTextArea(
      this.ctx,
      this.previewSlot,
      {
        value: this.previewText,
        rows: 5,
        placeholder: initialPlaceholder,
        ariaLabel: "Scene staging preview",
        className: "gg-scene-preview-ta",
        disabled: false,
        expandTitle: "Staging Preview",
        onChange: (value) => {
          this.applyPreviewInput(value);
        },
        getStatusBadge: () => ({
          text: this.previewStatusBadge.textContent ?? "",
          className: this.previewStatusBadge.className,
        }),
        getExtraActions: () => {
          const isLlmMode = this.adjustmentMode !== "verbatim";
          const hasSourceText = this.getEffectiveSourceText().trim().length > 0;
          const isStreamingScene = this.activeRun?.actionId === "guided_scene";
          const isActionBusy = this.isActionBusyFor();
          const previewDisabled =
            !hasSourceText ||
            isActionBusy ||
            isStreamingScene ||
            this.isOtherBusy;
          const resetLabel = isLlmMode ? "Unlock dynamic adapt" : "Reset";
          return [
            {
              id: "preview-draft",
              label: "Preview Draft",
              ...(this.previewBusy
                ? {
                    html: `<span class="gg-spinner" aria-hidden="true"></span><span>Cancel Preview</span>`,
                  }
                : {}),
              disabled: this.previewBusy ? false : previewDisabled,
              hidden: !isLlmMode,
              onClick: () => {
                void this.handlePreviewDraft();
              },
            },
            {
              id: "reset-preview",
              label: resetLabel,
              disabled: this.previewBusy || isActionBusy,
              hidden: !this.draftLocked,
              onClick: () => {
                this.handleResetPreview();
              },
            },
          ];
        },
      },
    );
  }

  private mountOptionSelects(): void {
    if (typeof this.ctx.components?.mountSelect !== "function") return;

    this.pacingSelectHandle = this.ctx.components.mountSelect(
      this.pacingSelectSlot,
      {
        options: PACING_SELECT_OPTIONS,
        value: this.pacing,
        ariaLabel: "Scene Pacing",
        onChange: (val) => {
          const nextPacing = normalizeScenePacing(val);
          if (nextPacing === this.pacing) return;
          this.pacing = nextPacing;
          this.syncUi();
          void this.callbacks.onSaveSceneConfigPatch({ pacing: nextPacing });
        },
      },
    );

    this.deliverySelectHandle = this.ctx.components.mountSelect(
      this.deliverySelectSlot,
      {
        options: DELIVERY_SELECT_OPTIONS,
        value: this.delivery,
        ariaLabel: "Scene Delivery",
        onChange: (val) => {
          const nextDelivery = normalizeSceneDelivery(val);
          if (nextDelivery === this.delivery) return;
          this.delivery = nextDelivery;
          this.syncUi();
          void this.callbacks.onSaveSceneConfigPatch({ delivery: nextDelivery });
        },
      },
    );

    this.adjustmentSelectHandle = this.ctx.components.mountSelect(
      this.adjustmentSelectSlot,
      {
        options: ADJUSTMENT_SELECT_OPTIONS,
        value: this.adjustmentMode,
        ariaLabel: "Scene Final Adjustment",
        onChange: (val) => {
          const nextMode = normalizeSceneAdjustmentMode(val);
          if (nextMode === this.adjustmentMode) return;
          this.adjustmentMode = nextMode;
          if (nextMode === "verbatim" && !this.draftLocked) {
            this.syncPreviewFromSource(true);
          }
          this.syncUi();
          void this.callbacks.onSaveSceneConfigPatch({ adjustmentMode: nextMode });
        },
      },
    );
  }

  private syncDropTargetSelect(canSwipe: boolean): void {
    if (typeof this.ctx.components?.mountSelect !== "function") return;
    if (!canSwipe && this.dropTarget === "new_swipe") {
      this.dropTarget = "new_message";
    }
    const options = buildDropTargetSelectOptions(canSwipe);
    if (!this.dropTargetSelectHandle) {
      this.lastDropTargetCanSwipe = canSwipe;
      this.dropTargetSelectHandle = this.ctx.components.mountSelect(
        this.dropTargetSelectSlot,
        {
          options,
          value: this.dropTarget,
          ariaLabel: "Scene Drop Target",
          onChange: (val) => {
            const nextTarget = normalizeSceneDropTarget(val);
            if (nextTarget === "new_swipe" && this.context?.canSwipeLastAssistant === false) {
              this.dropTarget = "new_message";
              this.dropTargetSelectHandle?.update({ value: "new_message" });
              return;
            }
            if (nextTarget === this.dropTarget) return;
            this.dropTarget = nextTarget;
            this.syncUi();
            void this.callbacks.onSaveSceneConfigPatch({ dropTarget: nextTarget });
          },
        },
      );
      return;
    }

    if (this.lastDropTargetCanSwipe !== canSwipe) {
      this.lastDropTargetCanSwipe = canSwipe;
      this.dropTargetSelectHandle.update({ options, value: this.dropTarget });
    } else {
      this.dropTargetSelectHandle.update({ value: this.dropTarget });
    }
  }

  private applyPreviewInput(val: string): void {
    if (this.greetingSource === "custom") {
      if (this.draftLocked) {
        // Hand-editing a locked preview draft preserves customText for Unlock.
        this.previewText = val;
      } else {
        // Authoring Empty (Custom) keeps draftLocked=false so Context Adapt / Summary Rewrite still runs!
        this.customText = val;
        this.previewText = val;
      }
    } else {
      this.previewText = val;
      const raw = this.getSelectedGreeting()?.text ?? "";
      this.draftLocked =
        this.adjustmentMode !== "verbatim" ? true : val !== raw;
    }

    this.syncPreviewStatusAndButtons();
    this.syncPrimaryFooter();
  }

  private isActionBusyFor(
    chatId: string | null | undefined = this.context?.chatId,
  ): boolean {
    return Boolean(chatId && this.busyChatIds.has(chatId));
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  setLoading(loading: boolean): void {
    if (this.destroyed) return;
    this.loading = loading;
    this.syncUi();
  }

  setSettings(settings: GuidedGenerationsSettings): void {
    if (this.destroyed) return;
    this.settings = settings;
    const cfg = settings.guidedScene;
    if (cfg) {
      if (!this.context?.armedScene) {
        this.keepMediaIntact = Boolean(cfg.keepMediaIntact);
        this.keepMediaCheckbox.checked = this.keepMediaIntact;
        if (this.hydratedChatId === null) {
          this.pacing = normalizeScenePacing(cfg.pacing);
          this.delivery = normalizeSceneDelivery(cfg.delivery);
          this.adjustmentMode = normalizeSceneAdjustmentMode(cfg.adjustmentMode);
          this.dropTarget = normalizeSceneDropTarget(cfg.dropTarget);
        }
      }
    }
    this.syncUi();
  }

  setActiveRun(run: ActiveRunState | null, isOtherBusy = false): void {
    if (this.destroyed) return;
    this.activeRun = run;
    this.isOtherBusy =
      isOtherBusy || Boolean(run && run.actionId !== "guided_scene");
    this.syncUi();
  }

  setArmedState(chatId: string, armedScene: ArmedSceneState | null): void {
    if (this.destroyed || !this.context || this.context.chatId !== chatId) return;
    const prevArmedAt = this.context.armedScene?.armedAt ?? null;
    this.context = { ...this.context, armedScene };
    if (armedScene && !this.isEditingField()) {
      if (armedScene.armedAt !== prevArmedAt) {
        this.hydrateFromArmed(armedScene);
      } else {
        this.pacing = armedScene.pacing;
      }
    } else if (!armedScene) {
      this.hydratedArmedAt = null;
    }
    this.syncUi();
  }

  setContext(
    context: GuidedSceneChatContext | null,
    options?: { error?: string | null },
  ): void {
    if (this.destroyed) return;
    this.loading = false;
    this.localError = options?.error ?? null;
    const prevChatId = this.hydratedChatId;
    const nextChatId = context?.chatId ?? null;
    this.context = context;

    if (!context || !nextChatId) {
      this.previewTextAreaHandle?.dismissModal();
      this.previewBusy = false;
      this.previewSeq += 1;
      this.hydratedChatId = null;
      this.hydratedArmedAt = null;
      this.syncUi();
      return;
    }

    const chatChanged = prevChatId !== nextChatId;
    if (chatChanged) {
      this.previewTextAreaHandle?.dismissModal();
      this.hydratedChatId = nextChatId;
      this.hydratedArmedAt = null;
      this.previewBusy = false;
      this.previewSeq += 1;
      this.hydrateForChat(context);
    } else if (
      context.armedScene &&
      context.armedScene.armedAt !== this.hydratedArmedAt &&
      !this.isEditingField()
    ) {
      this.hydrateFromArmed(context.armedScene);
    } else if (
      this.greetingSource === "card" &&
      !context.greetings.some((g) => g.key === this.selectedGreetingKey)
    ) {
      if (context.greetings.length > 0) {
        this.selectedGreetingKey = this.pickDefaultGreetingKey(context);
        if (!this.draftLocked) {
          this.syncPreviewFromSelectedGreeting();
        }
      } else {
        this.greetingSource = "custom";
        this.selectedGreetingKey = "";
      }
    }

    this.syncUi();
  }

  private hydrateForChat(context: GuidedSceneChatContext): void {
    if (context.armedScene) {
      this.hydrateFromArmed(context.armedScene);
      return;
    }

    const cfg = this.settings?.guidedScene;
    this.pacing = normalizeScenePacing(cfg?.pacing, "drop_now");
    this.delivery = normalizeSceneDelivery(cfg?.delivery, "time_skip");
    this.adjustmentMode = normalizeSceneAdjustmentMode(
      cfg?.adjustmentMode,
      "verbatim",
    );
    this.dropTarget = normalizeSceneDropTarget(cfg?.dropTarget, "new_message");
    this.keepMediaIntact = Boolean(cfg?.keepMediaIntact ?? true);

    this.greetingSource = context.greetings.length > 0 ? "card" : "custom";
    this.selectedGreetingKey = this.pickDefaultGreetingKey(context);
    const selected = this.getSelectedGreeting();
    this.customText = "";
    this.speakerCharacterId =
      selected?.characterId ??
      context.members[0]?.id ??
      context.primaryCharacterId ??
      null;
    this.transitionNote = "";
    this.customDirection = "";
    this.draftLocked = false;
    this.previewText = selected?.text ?? "";

    this.syncInputValuesIfUnfocused(true);
  }

  private hydrateFromArmed(armed: ArmedSceneState): void {
    this.hydratedArmedAt = armed.armedAt;
    this.greetingSource = armed.greetingSource === "custom" ? "custom" : "card";
    if (this.greetingSource === "card" && this.context) {
      const match = this.context.greetings.find(
        (g) => g.key === armed.selectedGreetingKey,
      );
      this.selectedGreetingKey = match?.key ?? this.pickDefaultGreetingKey(this.context);
    } else {
      this.selectedGreetingKey = "";
    }
    this.customText =
      this.greetingSource === "custom" ? armed.rawGreetingText ?? "" : "";
    this.speakerCharacterId =
      armed.speakerCharacterId ?? this.context?.primaryCharacterId ?? null;
    this.pacing = armed.pacing;
    this.delivery = normalizeSceneDelivery(armed.delivery, "time_skip");
    this.transitionNote = armed.transitionNote ?? "";
    this.adjustmentMode = normalizeSceneAdjustmentMode(
      armed.adjustmentMode,
      "verbatim",
    );
    this.customDirection = armed.customDirection ?? "";
    this.keepMediaIntact =
      armed.keepMediaIntact ?? Boolean(this.settings?.guidedScene?.keepMediaIntact ?? true);
    this.draftLocked = Boolean(armed.draftLocked);
    this.previewText =
      armed.draftLocked && armed.lockedDraftText
        ? armed.lockedDraftText
        : this.greetingSource === "custom"
          ? this.customText
          : armed.rawGreetingText || this.getSelectedGreeting()?.text || "";

    this.syncInputValuesIfUnfocused(false);
  }

  private pickDefaultGreetingKey(context: GuidedSceneChatContext): string {
    if (context.greetings.length === 0) return "";
    const nonOpening = context.greetings.find((g) => !g.isOpening);
    return (nonOpening ?? context.greetings[0]!).key;
  }

  private getSelectedGreeting(): GuidedSceneGreetingOption | null {
    if (!this.context || this.context.greetings.length === 0) return null;
    return (
      this.context.greetings.find((g) => g.key === this.selectedGreetingKey) ??
      this.context.greetings[0] ??
      null
    );
  }

  private isPreviewFocused(): boolean {
    return Boolean(this.previewTextAreaHandle?.isFocused());
  }

  private isEditingField(): boolean {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return (
      this.isPreviewFocused() ||
      Boolean(this.previewTextAreaHandle?.isModalOpen()) ||
      active === this.transitionNoteInput ||
      active === this.customDirectionInput
    );
  }

  private syncInputValuesIfUnfocused(force: boolean): void {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (force || active !== this.transitionNoteInput) {
      this.transitionNoteInput.value = this.transitionNote;
    }
    if (force || active !== this.customDirectionInput) {
      this.customDirectionInput.value = this.customDirection;
    }
    this.syncPreviewTextareaValue(this.getDisplayPreviewText(), force);
  }

  private syncPreviewTextareaValue(nextValue: string, force = false): void {
    if (!force && this.isPreviewFocused()) {
      return;
    }
    if (
      this.previewTextAreaHandle &&
      this.previewTextAreaHandle.getValue() !== nextValue
    ) {
      this.previewTextAreaHandle.update({ value: nextValue });
    }
  }

  private syncPreviewFromSelectedGreeting(): void {
    const selected = this.getSelectedGreeting();
    this.previewText = selected?.text ?? "";
    this.syncPreviewTextareaValue(this.previewText, true);
  }

  private syncPreviewFromSource(force = false): void {
    if (this.greetingSource === "custom") {
      this.previewText = this.customText;
      this.syncPreviewTextareaValue(this.customText, force);
    } else {
      const selected = this.getSelectedGreeting();
      this.previewText = selected?.text ?? "";
      this.syncPreviewTextareaValue(this.previewText, force);
    }
  }

  private getDisplayPreviewText(): string {
    if (this.draftLocked) return this.previewText;
    if (this.greetingSource === "custom") return this.customText;
    return this.getSelectedGreeting()?.text ?? this.previewText;
  }

  private getEffectiveSourceText(): string {
    if (this.greetingSource === "custom") return this.customText;
    return this.getSelectedGreeting()?.text ?? "";
  }

  private buildDraftBase(): GuidedSceneDraftBaseInput {
    const selected = this.getSelectedGreeting();
    const isCard = this.greetingSource === "card";
    const resolvedSpeakerId = this.context?.isGroup
      ? this.speakerCharacterId ?? selected?.characterId ?? this.context?.primaryCharacterId ?? null
      : this.context?.primaryCharacterId ?? null;
    const resolvedSpeakerName =
      this.context?.members.find((m) => m.id === resolvedSpeakerId)?.name ??
      selected?.characterName ??
      this.context?.primaryCharacterName ??
      null;
    const greetingLabel = isCard
      ? selected
        ? this.context?.isGroup
          ? `${selected.characterName} · Greeting #${selected.greetingIndex + 1}`
          : `Greeting #${selected.greetingIndex + 1}`
        : "Greeting"
      : "Custom Scene";

    return {
      chatId: this.context?.chatId ?? null,
      activeConnectionId: this.callbacks.getActiveConnectionId(),
      delivery: this.delivery,
      adjustmentMode: this.adjustmentMode,
      greetingSource: this.greetingSource,
      selectedGreetingKey: isCard ? selected?.key ?? null : null,
      greetingLabel,
      rawGreetingText: isCard ? selected?.text ?? "" : this.customText,
      speakerCharacterId: resolvedSpeakerId,
      speakerCharacterName: resolvedSpeakerName,
      transitionNote: this.transitionNote.trim(),
      customDirection: this.customDirection.trim(),
      keepMediaIntact: this.keepMediaIntact,
    };
  }

  private syncUi(): void {
    if (this.destroyed) return;

    // Inline error (attached only when non-empty)
    if (this.localError) {
      this.errorEl.textContent = this.localError;
      if (this.errorEl.parentElement !== this.root) {
        this.bannerEl.after(this.errorEl);
      }
    } else {
      this.errorEl.textContent = "";
      this.errorEl.remove();
    }

    const ctx = this.context;
    if (!ctx || !ctx.chatId) {
      this.bannerEl.style.display = "none";
      this.workbenchEl.style.display = "none";
      this.emptyEl.style.display = "";
      this.emptyTextEl.textContent = this.loading
        ? "Loading scene context…"
        : "Open a character or group chat to stage or steer a Guided Scene.";
      return;
    }

    this.emptyEl.style.display = "none";
    this.workbenchEl.style.display = "";

    const armed = ctx.armedScene;
    const isStreamingScene = this.activeRun?.actionId === "guided_scene";
    const isActionBusy = Boolean(ctx.chatId && this.busyChatIds.has(ctx.chatId));
    const controlsBusy = isActionBusy || isStreamingScene || this.isOtherBusy;

    // Sticky Armed Banner
    if (armed) {
      const isPaused = armed.status === "paused";
      const targetLabel = describeArmedTarget(armed, ctx);
      this.bannerEl.style.display = "";
      this.bannerEl.classList.toggle("is-paused", isPaused);
      this.bannerTitleText.textContent = isPaused
        ? `Paused · ${targetLabel}`
        : `Steering → ${targetLabel}`;
      this.bannerBadgeEl.className = `gg-badge ${isPaused ? "is-warn" : "is-info"}`;
      this.bannerBadgeEl.textContent =
        armed.pacing === "next_turn"
          ? "Next Turn"
          : armed.turnsSteered && armed.turnsSteered > 0
            ? `Turn ${armed.turnsSteered}`
            : "Multi-Turn";
      this.bannerPauseBtn.textContent = isPaused ? "Resume" : "Pause";
      this.bannerPauseBtn.disabled = controlsBusy;
      this.bannerDropNextBtn.disabled =
        controlsBusy || (!isPaused && armed.pacing === "next_turn");
      this.bannerDropNowBtn.disabled = controlsBusy;
      this.bannerCancelBtn.disabled = controlsBusy;
    } else {
      this.bannerEl.style.display = "none";
    }

    // Section 1: Greeting + Speaker
    this.refreshBtn.disabled = this.loading || isActionBusy;
    this.syncGreetingSelect(ctx);
    this.syncGreetingBadges();
    this.syncSpeakerSelect(ctx);

    // Section 2: Compact 2-Column Options Dropdowns
    this.pacingSelectHandle?.update({ value: this.pacing });
    this.deliverySelectHandle?.update({ value: this.delivery });
    this.adjustmentSelectHandle?.update({ value: this.adjustmentMode });

    const showDropTarget = this.pacing === "drop_now";
    this.dropTargetFieldWrap.style.display = showDropTarget ? "" : "none";
    this.adjustmentFieldWrap.classList.toggle("is-span-2", !showDropTarget);
    const canSwipe = ctx.canSwipeLastAssistant !== false;
    this.syncDropTargetSelect(canSwipe);

    this.customDirectionRowEl.style.display =
      this.adjustmentMode === "verbatim" ? "none" : "";

    // Section 3: Keep Media + Preview (native mountTextArea provides built-in Expand Editor modal)
    this.keepMediaCheckbox.checked = this.keepMediaIntact;
    const placeholder =
      this.greetingSource === "custom"
        ? "Write or paste your custom scene opening here…"
        : "Select a greeting to stage…";
    const previewDisabled = this.previewBusy || isActionBusy || isStreamingScene;

    if (
      placeholder !== this.lastPreviewPlaceholder ||
      previewDisabled !== this.lastPreviewDisabled
    ) {
      this.lastPreviewPlaceholder = placeholder;
      this.lastPreviewDisabled = previewDisabled;
      this.previewTextAreaHandle?.update({
        placeholder,
        disabled: previewDisabled,
      });
    }

    this.syncPreviewTextareaValue(this.getDisplayPreviewText(), false);
    this.syncPreviewStatusAndButtons();
    this.syncPrimaryFooter();
  }

  private syncGreetingSelect(ctx: GuidedSceneChatContext): void {
    const options = buildGreetingSelectOptions(ctx);
    const sig = options
      .map((o) => `${o.value}\0${o.label}\0${o.sublabel ?? ""}\0${o.group ?? ""}`)
      .join("\n");
    const effectiveValue =
      this.greetingSource === "custom"
        ? CUSTOM_GREETING_VALUE
        : this.selectedGreetingKey || CUSTOM_GREETING_VALUE;

    if (!this.greetingSelectHandle && typeof this.ctx.components?.mountSelect === "function") {
      this.lastGreetingOptionsSig = sig;
      this.greetingSelectHandle = this.ctx.components.mountSelect(
        this.greetingSelectSlot,
        {
          options,
          value: effectiveValue,
          ariaLabel: "Scene Greeting",
          onChange: (val) => {
            if (val === CUSTOM_GREETING_VALUE) {
              this.greetingSource = "custom";
              this.selectedGreetingKey = "";
              this.customText = "";
              this.previewText = "";
              this.draftLocked = false;
              this.syncPreviewTextareaValue("", true);
              this.syncUi();
              return;
            }
            this.greetingSource = "card";
            this.selectedGreetingKey = val;
            const chosen = this.getSelectedGreeting();
            if (this.context?.isGroup && chosen) {
              this.speakerCharacterId = chosen.characterId;
              this.speakerSelectHandle?.update({ value: chosen.characterId });
            }
            this.draftLocked = false;
            this.syncPreviewFromSelectedGreeting();
            this.syncUi();
          },
        },
      );
      return;
    }

    if (this.greetingSelectHandle) {
      if (sig !== this.lastGreetingOptionsSig) {
        this.lastGreetingOptionsSig = sig;
        this.greetingSelectHandle.update({
          options,
          value: effectiveValue,
        });
      } else {
        this.greetingSelectHandle.update({ value: effectiveValue });
      }
    }
  }

  private syncGreetingBadges(): void {
    this.greetingBadgesEl.replaceChildren();
    if (this.greetingSource !== "card") return;
    const selected = this.getSelectedGreeting();
    if (!selected) return;

    if (selected.isOpening) {
      const badge = document.createElement("span");
      badge.className = "gg-badge is-info";
      badge.textContent = "Opened chat";
      this.greetingBadgesEl.append(badge);
    }
    if (selected.hasMedia) {
      const badge = document.createElement("span");
      badge.className = "gg-badge";
      badge.textContent = "Has media";
      this.greetingBadgesEl.append(badge);
    }
  }

  private syncSpeakerSelect(ctx: GuidedSceneChatContext): void {
    const showSpeaker = ctx.isGroup && ctx.members.length > 0;
    this.speakerRowEl.style.display = showSpeaker ? "" : "none";
    if (!showSpeaker) return;

    const options = buildSpeakerSelectOptions(ctx);
    const sig = options.map((o) => `${o.value}\0${o.label}`).join("\n");
    const effectiveSpeaker = this.speakerCharacterId ?? ctx.members[0]?.id ?? "";

    if (!this.speakerSelectHandle && typeof this.ctx.components?.mountSelect === "function") {
      this.lastSpeakerOptionsSig = sig;
      this.speakerSelectHandle = this.ctx.components.mountSelect(
        this.speakerSelectSlot,
        {
          options,
          value: effectiveSpeaker,
          ariaLabel: "Scene Speaker",
          onChange: (val) => {
            this.speakerCharacterId = val || null;
          },
        },
      );
      return;
    }

    if (this.speakerSelectHandle) {
      if (sig !== this.lastSpeakerOptionsSig) {
        this.lastSpeakerOptionsSig = sig;
        this.speakerSelectHandle.update({ options, value: effectiveSpeaker });
      } else {
        this.speakerSelectHandle.update({ value: effectiveSpeaker });
      }
    }
  }

  private syncPreviewStatusAndButtons(): void {
    const isLlmMode = this.adjustmentMode !== "verbatim";
    const hasSourceText = this.getEffectiveSourceText().trim().length > 0;
    const isStreamingScene = this.activeRun?.actionId === "guided_scene";

    let badgeClass = "gg-badge";
    let badgeText = "Verbatim";
    if (!isLlmMode) {
      badgeClass = this.draftLocked ? "gg-badge is-info" : "gg-badge";
      badgeText = this.draftLocked ? "Edited verbatim" : "Verbatim";
    } else if (this.draftLocked) {
      badgeClass = "gg-badge is-info";
      badgeText = "Locked draft";
    } else if (this.pacing !== "drop_now") {
      badgeClass = "gg-badge is-success";
      badgeText = "Adapts at drop time";
    } else {
      badgeClass = "gg-badge";
      badgeText = "Adapts on drop";
    }

    this.previewStatusBadge.className = badgeClass;
    this.previewStatusBadge.textContent = badgeText;

    const isActionBusy = this.isActionBusyFor();
    const previewDisabled =
      !hasSourceText || isActionBusy || isStreamingScene || this.isOtherBusy;
    const showReset = this.draftLocked;
    const resetLabel = isLlmMode ? "Unlock dynamic adapt" : "Reset";
    const resetDisabled = this.previewBusy || isActionBusy;

    this.previewDraftBtn.style.display = isLlmMode ? "" : "none";
    if (this.previewBusy) {
      this.previewDraftBtn.disabled = false;
      this.previewDraftBtn.innerHTML = `<span class="gg-spinner" aria-hidden="true"></span><span>Cancel Preview</span>`;
    } else {
      this.previewDraftBtn.disabled = previewDisabled;
      this.previewDraftBtn.textContent = "Preview Draft";
    }

    this.previewResetBtn.style.display = showReset ? "" : "none";
    this.previewResetBtn.textContent = resetLabel;
    this.previewResetBtn.disabled = resetDisabled;

    this.previewTextAreaHandle?.syncChrome();
  }

  private syncPrimaryFooter(): void {
    const isStreamingScene = this.activeRun?.actionId === "guided_scene";
    if (isStreamingScene) {
      this.primaryBtn.style.display = "none";
      this.stopBtn.style.display = "";
      return;
    }

    this.stopBtn.style.display = "none";
    this.primaryBtn.style.display = "";

    const armed = this.context?.armedScene ?? null;
    if (this.pacing === "drop_now") {
      this.primaryBtn.textContent = "Drop Scene";
    } else if (armed) {
      this.primaryBtn.textContent = "Update Steering";
    } else if (this.pacing === "next_turn") {
      this.primaryBtn.textContent = "Arm Next-Turn";
    } else {
      this.primaryBtn.textContent = "Start Steering";
    }

    const effectiveText = this.draftLocked
      ? this.previewText.trim()
      : this.getEffectiveSourceText().trim();
    const isActionBusy = this.isActionBusyFor();
    this.primaryBtn.disabled =
      !this.context?.chatId ||
      !effectiveText ||
      isActionBusy ||
      this.previewBusy ||
      this.isOtherBusy;
  }

  private async handlePreviewDraft(): Promise<void> {
    const requestChatId = this.context?.chatId;
    if (this.destroyed || !requestChatId) return;
    if (this.previewBusy) {
      this.previewSeq += 1;
      this.previewBusy = false;
      this.syncUi();
      void this.callbacks.onCancelPreview?.(requestChatId);
      return;
    }

    const mySeq = ++this.previewSeq;
    this.previewBusy = true;
    this.localError = null;
    this.syncUi();

    try {
      const result = await this.callbacks.onPreviewDraft(this.buildDraftBase());
      if (this.destroyed || mySeq !== this.previewSeq) return;
      this.previewBusy = false;
      if (!result.aborted && typeof result.text === "string") {
        this.previewText = result.text;
        this.draftLocked = true;
        this.syncPreviewTextareaValue(result.text, true);
      }
      this.syncUi();
    } catch (err) {
      if (this.destroyed || mySeq !== this.previewSeq) return;
      this.previewBusy = false;
      this.localError = err instanceof Error ? err.message : String(err);
      this.syncUi();
    }
  }

  private handleResetPreview(): void {
    this.draftLocked = false;
    this.syncPreviewFromSource(true);
    this.syncUi();
  }

  private async handlePrimaryAction(): Promise<void> {
    const requestChatId = this.context?.chatId;
    if (this.destroyed || !requestChatId || this.busyChatIds.has(requestChatId)) {
      return;
    }
    this.busyChatIds.add(requestChatId);
    this.localError = null;
    this.syncUi();

    try {
      const base = this.buildDraftBase();
      const lockedText = this.draftLocked ? this.previewText : null;
      if (this.pacing === "drop_now") {
        const canSwipe = this.context!.canSwipeLastAssistant !== false;
        const dropTarget: GuidedSceneDropTarget =
          this.dropTarget === "new_swipe" && canSwipe
            ? "new_swipe"
            : "new_message";
        await this.callbacks.onDropSceneNow({
          ...base,
          dropTarget,
          lockedDraftText: lockedText,
          previewText: lockedText,
          draftLocked: this.draftLocked,
        });
      } else if (this.context!.armedScene) {
        const updated = await this.callbacks.onUpdateArmedScene({
          ...base,
          pacing: this.pacing,
          lockedDraftText: lockedText,
          previewText: lockedText,
          draftLocked: this.draftLocked,
        });
        if (!this.destroyed && this.context?.chatId === requestChatId) {
          this.context = { ...this.context, armedScene: updated };
          this.hydratedArmedAt = updated?.armedAt ?? null;
        }
      } else {
        const armed = await this.callbacks.onArmScene({
          ...base,
          pacing: this.pacing,
          lockedDraftText: lockedText,
          previewText: lockedText,
          draftLocked: this.draftLocked,
        });
        if (!this.destroyed && this.context?.chatId === requestChatId) {
          this.context = { ...this.context, armedScene: armed };
          this.hydratedArmedAt = armed?.armedAt ?? null;
        }
      }
    } catch (err) {
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.localError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.busyChatIds.delete(requestChatId);
      if (!this.destroyed) {
        this.syncUi();
      }
    }
  }

  private async handleTogglePause(): Promise<void> {
    const requestChatId = this.context?.chatId;
    const armed = this.context?.armedScene ?? null;
    if (
      this.destroyed ||
      !requestChatId ||
      !armed ||
      this.busyChatIds.has(requestChatId)
    ) {
      return;
    }
    this.busyChatIds.add(requestChatId);
    this.localError = null;
    this.syncUi();
    try {
      const nextArmed =
        armed.status === "paused"
          ? await this.callbacks.onResumeScene(requestChatId)
          : await this.callbacks.onPauseScene(requestChatId);
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.context = { ...this.context, armedScene: nextArmed };
      }
    } catch (err) {
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.localError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.busyChatIds.delete(requestChatId);
      if (!this.destroyed) {
        this.syncUi();
      }
    }
  }

  private async handleDropNextTurn(): Promise<void> {
    const requestChatId = this.context?.chatId;
    const armed = this.context?.armedScene ?? null;
    if (
      this.destroyed ||
      !requestChatId ||
      !armed ||
      this.busyChatIds.has(requestChatId)
    ) {
      return;
    }
    this.busyChatIds.add(requestChatId);
    this.localError = null;
    this.syncUi();
    try {
      const nextArmed = await this.callbacks.onDropNextTurn(requestChatId);
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.context = { ...this.context, armedScene: nextArmed };
        if (nextArmed) {
          this.pacing = nextArmed.pacing;
        }
      }
    } catch (err) {
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.localError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.busyChatIds.delete(requestChatId);
      if (!this.destroyed) {
        this.syncUi();
      }
    }
  }

  private async handleBannerDropNow(): Promise<void> {
    const requestChatId = this.context?.chatId;
    const armed = this.context?.armedScene ?? null;
    if (
      this.destroyed ||
      !requestChatId ||
      !armed ||
      this.busyChatIds.has(requestChatId)
    ) {
      return;
    }
    this.busyChatIds.add(requestChatId);
    this.localError = null;
    this.syncUi();
    try {
      await this.callbacks.onDropSceneNow({
        chatId: requestChatId,
        greetingSource: armed.greetingSource,
        selectedGreetingKey: armed.selectedGreetingKey ?? null,
        greetingLabel: armed.greetingLabel,
        rawGreetingText: armed.rawGreetingText,
        speakerCharacterId: armed.speakerCharacterId ?? null,
        speakerCharacterName: armed.speakerCharacterName ?? null,
        delivery: armed.delivery,
        transitionNote: armed.transitionNote,
        adjustmentMode: armed.adjustmentMode,
        customDirection: armed.customDirection,
        keepMediaIntact:
          armed.keepMediaIntact ??
          this.settings?.guidedScene?.keepMediaIntact ??
          true,
        draftLocked: armed.draftLocked,
        lockedDraftText: armed.lockedDraftText,
        previewText: armed.lockedDraftText ?? undefined,
        dropTarget: "new_message",
        activeConnectionId: this.callbacks.getActiveConnectionId(),
      });
    } catch (err) {
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.localError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.busyChatIds.delete(requestChatId);
      if (!this.destroyed) {
        this.syncUi();
      }
    }
  }

  private async handleCancelSteering(): Promise<void> {
    const requestChatId = this.context?.chatId;
    if (this.destroyed || !requestChatId || this.busyChatIds.has(requestChatId)) {
      return;
    }
    this.busyChatIds.add(requestChatId);
    this.localError = null;
    this.syncUi();
    try {
      await this.callbacks.onCancelScene(requestChatId);
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.context = { ...this.context, armedScene: null };
        this.hydratedArmedAt = null;
      }
    } catch (err) {
      if (!this.destroyed && this.context?.chatId === requestChatId) {
        this.localError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.busyChatIds.delete(requestChatId);
      if (!this.destroyed) {
        this.syncUi();
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.busyChatIds.clear();
    this.previewSeq += 1;
    this.previewTextAreaHandle?.destroy();
    this.previewTextAreaHandle = null;
    this.greetingSelectHandle?.destroy();
    this.greetingSelectHandle = null;
    this.speakerSelectHandle?.destroy();
    this.speakerSelectHandle = null;
    this.pacingSelectHandle?.destroy();
    this.pacingSelectHandle = null;
    this.deliverySelectHandle?.destroy();
    this.deliverySelectHandle = null;
    this.adjustmentSelectHandle?.destroy();
    this.adjustmentSelectHandle = null;
    this.dropTargetSelectHandle?.destroy();
    this.dropTargetSelectHandle = null;
    this.root.remove();
  }
}
