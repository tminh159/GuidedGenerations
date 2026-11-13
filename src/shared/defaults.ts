import type {
  GuidedActionConfig,
  GuidedActionId,
  GuidedGenerationsSettings,
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

export const DEFAULT_BUTTON_ORDER: readonly ToolbarOptionId[] = [
  ...GUIDED_ACTION_ORDER,
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

export function isToolbarOptionId(value: unknown): value is ToolbarOptionId {
  return value === "input_recovery" || isGuidedActionId(value);
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
    instructionTemplate: "[OOC Guidance for the next response: {{input}}]",
    clearInputOnRun: true,
  },
  guided_continue: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate:
      "[OOC Continuation Guidance — continue seamlessly from the current ending: {{input}}]",
    clearInputOnRun: true,
  },
  guided_regenerate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[OOC Guidance for regenerating this response: {{input}}]",
    clearInputOnRun: true,
  },
  guided_swipe: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[OOC Guidance for this alternative response: {{input}}]",
    clearInputOnRun: true,
  },
  guided_impersonate: {
    enabled: true,
    connectionId: null,
    model: null,
    presetId: null,
    injectionRole: "system",
    instructionTemplate: "[Write the user's next message following this outline: {{input}}]",
    clearInputOnRun: true,
  },
};

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
  };
}

