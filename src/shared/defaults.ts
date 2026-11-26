import type {
  GuidanceInjectionRole,
  GuidancePosition,
  GuidedActionConfig,
  GuidedActionId,
  GuidedGenerationsSettings,
  GuidedSceneAdjustmentMode,
  GuidedSceneArmedPacing,
  GuidedSceneConfig,
  GuidedSceneContextMode,
  GuidedSceneDelivery,
  GuidedSceneDropTarget,
  GuidedScenePacing,
  RunActionId,
  SceneGuidancePosition,
  ToolbarOptionId,
  ToolbarPlacement,
} from "./types";

export const GUIDED_ACTION_ORDER: readonly GuidedActionId[] = [
  "guided_response",
  "guided_continue",
  "guided_regenerate",
  "guided_swipe",
  "guided_impersonate",
] as const;

export const DEFAULT_TOOLBAR_PLACEMENT: ToolbarPlacement = "after_native";

export const DEFAULT_GUIDANCE_POSITION: GuidancePosition = "before_post_history";

export const DEFAULT_GUIDANCE_DEPTH = 0;

export const DEFAULT_APPLY_REGEX = true;

export const GUIDANCE_POSITION_OPTIONS: ReadonlyArray<{
  value: GuidancePosition;
  label: string;
  shortLabel: string;
  sublabel: string;
}> = [
  {
    value: "before_post_history",
    label: "Before Post-History (after chat history)",
    shortLabel: "Before Post-History",
    sublabel: "Places guidance right after chat history and before post-history preset blocks.",
  },
  {
    value: "in_history",
    label: "In History (at depth)",
    shortLabel: "In History",
    sublabel: "Splices guidance inside chat history N messages back from the end.",
  },
  {
    value: "pre_history",
    label: "Pre-History (before chat history)",
    shortLabel: "Pre-History",
    sublabel: "Places guidance after pre-history system prompts and before the first chat turn.",
  },
  {
    value: "post_history",
    label: "Post-History (end of prompt)",
    shortLabel: "Post-History",
    sublabel: "Appends guidance at the very end of the assembled prompt (before any trailing prefill).",
  },
];

export function normalizeGuidancePosition(
  value: unknown,
  fallback: GuidancePosition = DEFAULT_GUIDANCE_POSITION,
): GuidancePosition {
  if (
    value === "before_post_history" ||
    value === "in_history" ||
    value === "pre_history" ||
    value === "post_history"
  ) {
    return value;
  }
  return fallback;
}

export function normalizeGuidanceDepth(
  value: unknown,
  fallback: number = DEFAULT_GUIDANCE_DEPTH,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(999, Math.floor(value)));
  }
  return Math.max(0, Math.min(999, Math.floor(fallback)));
}

export const DEFAULT_BUTTON_ORDER: readonly ToolbarOptionId[] = [
  ...GUIDED_ACTION_ORDER,
  "guided_scene",
  "input_recovery",
] as const;

export const TOOLBAR_PLACEMENT_OPTIONS: ReadonlyArray<{
  value: ToolbarPlacement;
  label: string;
  shortLabel: string;
  sublabel: string;
}> = [
  {
    value: "after_native",
    label: "Inline (after native buttons)",
    shortLabel: "Inline",
    sublabel: "Sits directly next to Home, Regenerate, Continue, etc.",
  },
  {
    value: "before_native",
    label: "Left side (before native buttons)",
    shortLabel: "Left",
    sublabel: "Placed at the start of the composer top action bar",
  },
  {
    value: "right",
    label: "Right side (top bar)",
    shortLabel: "Right",
    sublabel: "Aligned to the right side of the composer top action bar",
  },
  {
    value: "below_bar",
    label: "Separate row (below native buttons)",
    shortLabel: "New row",
    sublabel: "Shown on the dedicated extension toolbar row underneath",
  },
];

export function isGuidedActionId(value: unknown): value is GuidedActionId {
  return typeof value === "string" && (GUIDED_ACTION_ORDER as readonly string[]).includes(value);
}

export function isRunActionId(value: unknown): value is RunActionId {
  return value === "guided_scene" || isGuidedActionId(value);
}

export function isToolbarOptionId(value: unknown): value is ToolbarOptionId {
  return value === "input_recovery" || value === "guided_scene" || isGuidedActionId(value);
}

export function normalizeToolbarPlacement(value: unknown): ToolbarPlacement {
  if (
    value === "after_native" ||
    value === "before_native" ||
    value === "right" ||
    value === "below_bar"
  ) {
    return value;
  }
  return DEFAULT_TOOLBAR_PLACEMENT;
}

export function normalizeButtonOrder(raw: unknown): ToolbarOptionId[] {
  const result: ToolbarOptionId[] = [];
  const seen = new Set<ToolbarOptionId>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isToolbarOptionId(entry) || seen.has(entry)) continue;
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

export interface ActionMetadata {
  id: GuidedActionId;
  label: string;
  shortLabel: string;
  description: string;
  tooltip: string;
}

export const ACTION_METADATA: Record<GuidedActionId, ActionMetadata> = {
  guided_response: {
    id: "guided_response",
    label: "Guided Response",
    shortLabel: "Response",
    description:
      "Steer the next AI reply using your composer text as temporary guidance without adding a user message.",
    tooltip: "Guided Response — steer next AI reply without sending a user message",
  },
  guided_continue: {
    id: "guided_continue",
    label: "Guided Continue",
    shortLabel: "Continue",
    description:
      "Continue the last AI message using optional guidance text and this option's profile & preset.",
    tooltip: "Guided Continue — continue last AI message (guided if input present)",
  },
  guided_regenerate: {
    id: "guided_regenerate",
    label: "Guided Regenerate",
    shortLabel: "Regenerate",
    description:
      "Replace the last AI message with a fresh regenerated reply using optional guidance text and this option's profile & preset.",
    tooltip: "Guided Regenerate — regenerate last AI reply (guided if input present)",
  },
  guided_swipe: {
    id: "guided_swipe",
    label: "Guided Swipe",
    shortLabel: "Swipe",
    description:
      "Generate a new swipe on the last AI message steered by your guidance text.",
    tooltip: "Guided Swipe — create a steered new swipe on the last AI message",
  },
  guided_impersonate: {
    id: "guided_impersonate",
    label: "Impersonation",
    shortLabel: "Impersonate",
    description:
      "Generate a user reply into the composer input box using your configured preset and optional outline.",
    tooltip: "Impersonate — draft user message into input box",
  },
};

export const DEFAULT_ACTION_CONFIGS: Record<GuidedActionId, GuidedActionConfig> = {
  guided_response: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Guidance for the next response: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX,
  },
  guided_continue: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate:
      "[OOC Continuation Guidance — continue seamlessly from the current ending: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX,
  },
  guided_regenerate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Guidance for regenerating this response: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX,
  },
  guided_swipe: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[OOC Guidance for this alternative response: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX,
  },
  guided_impersonate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    guidancePosition: DEFAULT_GUIDANCE_POSITION,
    guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
    instructionTemplate: "[Write the user's next message following this outline: {{input}}]",
    clearInputOnRun: true,
    applyRegex: DEFAULT_APPLY_REGEX,
  },
};

export const GUIDED_SCENE_METADATA = {
  id: "guided_scene" as const,
  label: "Guided Scene",
  shortLabel: "Scene",
  description:
    "Jump or steer mid-chat into any character/group greeting or custom scene with optional adaptation and media preservation.",
  tooltip: "Guided Scene — open Scene workbench (hold when armed for quick actions)",
} as const;

export const TOOLBAR_OPTION_LABELS: Record<ToolbarOptionId, string> = {
  guided_response: ACTION_METADATA.guided_response.label,
  guided_continue: ACTION_METADATA.guided_continue.label,
  guided_regenerate: ACTION_METADATA.guided_regenerate.label,
  guided_swipe: ACTION_METADATA.guided_swipe.label,
  guided_impersonate: ACTION_METADATA.guided_impersonate.label,
  guided_scene: GUIDED_SCENE_METADATA.label,
  input_recovery: "Input Recovery",
};

export const SCENE_GUIDANCE_POSITION_OPTIONS: ReadonlyArray<{
  value: SceneGuidancePosition;
  label: string;
  shortLabel: string;
  sublabel: string;
}> = [
  ...GUIDANCE_POSITION_OPTIONS,
  {
    value: "append_last_user",
    label: "Append to Last User Message (OOC)",
    shortLabel: "Append Last User",
    sublabel:
      "Appends an OOC note to the latest user message in chat history (falls back to Before Post-History if the last turn is not a user message).",
  },
];

export const GUIDED_SCENE_PACING_OPTIONS: ReadonlyArray<{
  value: GuidedScenePacing;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "drop_now",
    label: "Drop Now",
    shortLabel: "Drop Now",
    description: "Insert the scene immediately as a new AI message or swipe.",
  },
  {
    value: "next_turn",
    label: "Next Turn",
    shortLabel: "Next Turn",
    description: "Steer the AI's very next reply to the doorstep, then drop the scene right after.",
  },
  {
    value: "multi_turn",
    label: "Multi-Turn",
    shortLabel: "Multi-Turn",
    description: "Gently steer across turns until the narrative reaches the doorstep, then drop.",
  },
];

export const GUIDED_SCENE_DELIVERY_OPTIONS: ReadonlyArray<{
  value: GuidedSceneDelivery;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "cut",
    label: "Hard Cut",
    shortLabel: "Hard Cut",
    description: "Jump straight into the new scene with no transition filler.",
  },
  {
    value: "time_skip",
    label: "Time Skip",
    shortLabel: "Time Skip",
    description: "Bridge forward cleanly across elapsed time into the target scene.",
  },
  {
    value: "bridge",
    label: "In-Scene Bridge",
    shortLabel: "Bridge",
    description: "Lead directly from the current moment into the target scene.",
  },
];

export const GUIDED_SCENE_ADJUSTMENT_OPTIONS: ReadonlyArray<{
  value: GuidedSceneAdjustmentMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "verbatim",
    label: "Verbatim",
    shortLabel: "Verbatim",
    description: "Use the selected greeting prose verbatim (with macro resolution).",
  },
  {
    value: "context_adapt",
    label: "Context Adapt",
    shortLabel: "Context Adapt",
    description: "Keep the greeting's voice and beats while adapting continuity to the chat.",
  },
  {
    value: "summary_rewrite",
    label: "Summary Rewrite",
    shortLabel: "Summary Rewrite",
    description: "Use the greeting as a premise and write a fresh scene rooted in the chat.",
  },
];

export const GUIDED_SCENE_DROP_TARGET_OPTIONS: ReadonlyArray<{
  value: GuidedSceneDropTarget;
  label: string;
  shortLabel: string;
}> = [
  { value: "new_message", label: "New AI Message", shortLabel: "New Message" },
  { value: "new_swipe", label: "New Swipe", shortLabel: "New Swipe" },
];

export const GUIDED_SCENE_CONTEXT_MODE_OPTIONS: ReadonlyArray<{
  value: GuidedSceneContextMode;
  label: string;
  shortLabel: string;
  sublabel: string;
}> = [
  {
    value: "lightweight",
    label: "Lightweight (Character + Persona + Recent Turns)",
    shortLabel: "Lightweight",
    sublabel: "Fast, faithful scene adaptation without preset jailbreaks pushing past the opening.",
  },
  {
    value: "full_preset",
    label: "Full Preset Assembly (Lorebooks + Preset + History)",
    shortLabel: "Full Preset",
    sublabel: "Assembles the full configured preset stack, lorebooks, and chat history.",
  },
];

export const DEFAULT_SCENE_CONTEXT_TURNS = 20;
export const DEFAULT_SCENE_READINESS_TAG = "scene-ready";

export const DEFAULT_SCENE_STEERING_TEMPLATE =
  "[OOC Scene Direction: Steer the roleplay naturally toward the upcoming scene setup below without quoting, copying, or preemptively playing out the scene itself.\n{{pacing_instruction}}\n{{delivery_instruction}}{{transition_note}}\nUpcoming scene premise (for direction only — do not spoil or reproduce):\n{{target_scene}}\n{{readiness_instruction}}]";

export const DEFAULT_SCENE_ADAPT_TEMPLATE =
  "Adapt the target scene opening below so it follows seamlessly from the ongoing conversation while preserving its voice, tone, formatting, and core beats. Resolve continuity with prior events naturally without repeating what just happened.{{delivery_guidance}}{{custom_direction}}{{media_instructions}}\nOutput ONLY the adapted scene prose with no meta-commentary.";

export const DEFAULT_SCENE_SUMMARY_TEMPLATE =
  "Use the target scene below as a premise and structural inspiration to write a fresh scene entry grounded deeply in the current conversation, character dynamics, and established history. Do not feel bound to its exact phrasing, but fulfill its core situation and mood.{{delivery_guidance}}{{custom_direction}}{{media_instructions}}\nOutput ONLY the new scene prose with no meta-commentary.";

export const DEFAULT_SCENE_BRIDGE_TEMPLATE =
  "Write ONLY a brief, atmospheric transition (1 to 3 sentences) bridging the end of the current conversation into the upcoming scene opening below. Do NOT rewrite, quote, or continue past the upcoming scene—it will appear verbatim immediately after your bridge.{{delivery_guidance}}{{custom_direction}}\nOutput ONLY the short bridge prose with no meta-commentary or scene divider.";

export const DEFAULT_GUIDED_SCENE_CONFIG: GuidedSceneConfig = {
  enabled: true,
  connectionId: null,
  model: null,
  presetId: null,
  contextMode: "lightweight",
  contextTurns: DEFAULT_SCENE_CONTEXT_TURNS,
  injectionRole: "system",
  guidancePosition: DEFAULT_GUIDANCE_POSITION,
  guidanceDepth: DEFAULT_GUIDANCE_DEPTH,
  keepMediaIntact: true,
  applyRegex: DEFAULT_APPLY_REGEX,
  pacing: "drop_now",
  delivery: "time_skip",
  adjustmentMode: "verbatim",
  dropTarget: "new_message",
  steeringTemplate: DEFAULT_SCENE_STEERING_TEMPLATE,
  adaptTemplate: DEFAULT_SCENE_ADAPT_TEMPLATE,
  summaryTemplate: DEFAULT_SCENE_SUMMARY_TEMPLATE,
  bridgeTemplate: DEFAULT_SCENE_BRIDGE_TEMPLATE,
  readinessTag: DEFAULT_SCENE_READINESS_TAG,
};

export function createDefaultGuidedSceneConfig(): GuidedSceneConfig {
  return { ...DEFAULT_GUIDED_SCENE_CONFIG };
}

export function normalizeSceneGuidancePosition(
  value: unknown,
  fallback: SceneGuidancePosition = DEFAULT_GUIDANCE_POSITION,
): SceneGuidancePosition {
  if (
    value === "before_post_history" ||
    value === "in_history" ||
    value === "pre_history" ||
    value === "post_history" ||
    value === "append_last_user"
  ) {
    return value;
  }
  return fallback;
}

export function normalizeScenePacing(
  value: unknown,
  fallback: GuidedScenePacing = DEFAULT_GUIDED_SCENE_CONFIG.pacing,
): GuidedScenePacing {
  if (value === "drop_now" || value === "next_turn" || value === "multi_turn") {
    return value;
  }
  return fallback;
}

export function normalizeSceneArmedPacing(
  value: unknown,
  fallback: GuidedSceneArmedPacing = "next_turn",
): GuidedSceneArmedPacing {
  if (value === "next_turn" || value === "multi_turn") {
    return value;
  }
  return fallback;
}

export function normalizeSceneDelivery(
  value: unknown,
  fallback: GuidedSceneDelivery = DEFAULT_GUIDED_SCENE_CONFIG.delivery,
): GuidedSceneDelivery {
  if (value === "cut" || value === "time_skip" || value === "bridge") {
    return value;
  }
  return fallback;
}

export function normalizeSceneAdjustmentMode(
  value: unknown,
  fallback: GuidedSceneAdjustmentMode = DEFAULT_GUIDED_SCENE_CONFIG.adjustmentMode,
): GuidedSceneAdjustmentMode {
  if (value === "verbatim" || value === "context_adapt" || value === "summary_rewrite") {
    return value;
  }
  return fallback;
}

export function normalizeSceneDropTarget(
  value: unknown,
  fallback: GuidedSceneDropTarget = DEFAULT_GUIDED_SCENE_CONFIG.dropTarget,
): GuidedSceneDropTarget {
  if (value === "new_message" || value === "new_swipe") {
    return value;
  }
  return fallback;
}

export function normalizeSceneContextMode(
  value: unknown,
  fallback: GuidedSceneContextMode = DEFAULT_GUIDED_SCENE_CONFIG.contextMode,
): GuidedSceneContextMode {
  if (value === "lightweight" || value === "full_preset") {
    return value;
  }
  return fallback;
}

export function normalizeSceneContextTurns(
  value: unknown,
  fallback: number = DEFAULT_SCENE_CONTEXT_TURNS,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(200, Math.floor(value)));
  }
  return Math.max(1, Math.min(200, Math.floor(fallback)));
}

const VALID_TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;

export function normalizeSceneReadinessTag(
  value: unknown,
  fallback: string = DEFAULT_SCENE_READINESS_TAG,
): string {
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/^<\/?\s*/, "").replace(/\s*\/?>$/, "").trim();
    if (VALID_TAG_NAME_RE.test(cleaned)) {
      return cleaned;
    }
  }
  return VALID_TAG_NAME_RE.test(fallback) ? fallback : DEFAULT_SCENE_READINESS_TAG;
}

export function normalizeGuidedSceneConfig(
  raw: unknown,
  fallback: GuidedSceneConfig = DEFAULT_GUIDED_SCENE_CONFIG,
): GuidedSceneConfig {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const normalizeOptionalId = (val: unknown): string | null =>
    typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
  const normalizeRole = (
    val: unknown,
    fb: GuidanceInjectionRole,
  ): GuidanceInjectionRole =>
    val === "system" || val === "user" || val === "assistant" ? val : fb;

  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    connectionId:
      "connectionId" in record ? normalizeOptionalId(record.connectionId) : fallback.connectionId,
    model: "model" in record ? normalizeOptionalId(record.model) : fallback.model,
    presetId: "presetId" in record ? normalizeOptionalId(record.presetId) : fallback.presetId,
    contextMode: normalizeSceneContextMode(record.contextMode, fallback.contextMode),
    contextTurns: normalizeSceneContextTurns(record.contextTurns, fallback.contextTurns),
    injectionRole: normalizeRole(record.injectionRole, fallback.injectionRole),
    guidancePosition: normalizeSceneGuidancePosition(
      record.guidancePosition,
      fallback.guidancePosition,
    ),
    guidanceDepth: normalizeGuidanceDepth(record.guidanceDepth, fallback.guidanceDepth),
    keepMediaIntact:
      typeof record.keepMediaIntact === "boolean"
        ? record.keepMediaIntact
        : fallback.keepMediaIntact,
    applyRegex: typeof record.applyRegex === "boolean" ? record.applyRegex : fallback.applyRegex,
    pacing: normalizeScenePacing(record.pacing, fallback.pacing),
    delivery: normalizeSceneDelivery(record.delivery, fallback.delivery),
    adjustmentMode: normalizeSceneAdjustmentMode(record.adjustmentMode, fallback.adjustmentMode),
    dropTarget: normalizeSceneDropTarget(record.dropTarget, fallback.dropTarget),
    steeringTemplate:
      typeof record.steeringTemplate === "string"
        ? record.steeringTemplate
        : fallback.steeringTemplate,
    adaptTemplate:
      typeof record.adaptTemplate === "string" ? record.adaptTemplate : fallback.adaptTemplate,
    summaryTemplate:
      typeof record.summaryTemplate === "string"
        ? record.summaryTemplate
        : fallback.summaryTemplate,
    bridgeTemplate:
      typeof record.bridgeTemplate === "string" ? record.bridgeTemplate : fallback.bridgeTemplate,
    readinessTag: normalizeSceneReadinessTag(record.readinessTag, fallback.readinessTag),
  };
}

export function createDefaultSettings(): GuidedGenerationsSettings {
  return {
    version: 1,
    toolbarPlacement: DEFAULT_TOOLBAR_PLACEMENT,
    buttonOrder: [...DEFAULT_BUTTON_ORDER],
    actions: {
      guided_response: { ...DEFAULT_ACTION_CONFIGS.guided_response },
      guided_continue: { ...DEFAULT_ACTION_CONFIGS.guided_continue },
      guided_regenerate: { ...DEFAULT_ACTION_CONFIGS.guided_regenerate },
      guided_swipe: { ...DEFAULT_ACTION_CONFIGS.guided_swipe },
      guided_impersonate: { ...DEFAULT_ACTION_CONFIGS.guided_impersonate },
    },
    inputRecovery: {
      enabled: true,
      maxEntries: 10,
    },
    guidedScene: createDefaultGuidedSceneConfig(),
  };
}

