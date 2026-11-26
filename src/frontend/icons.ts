import type { ToolbarOptionId } from "../shared/types";

function strokeIcon(body: string, strokeWidth = "1.85"): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const REFRESH_ICON_SVG = strokeIcon(
  '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
);

const SCENE_ICON_BODY =
  '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 10h16"/><path d="m10 4-2 6"/><path d="m16 4-2 6"/>';

export const DRAWER_TAB_ICON_SVG = strokeIcon(
  '<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  "1.8",
);

export const DRAWER_NAV_ICONS = {
  basic: strokeIcon(
    '<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2"/>',
    "1.8",
  ),
  advanced: strokeIcon(
    '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    "1.8",
  ),
  scene: strokeIcon(SCENE_ICON_BODY, "1.8"),
} as const;

export const STOP_ICON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`;

export const TOOLBAR_ICONS: Record<ToolbarOptionId, string> = {
  // Guided Response: compass / steer
  guided_response: strokeIcon('<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/>'),
  // Guided Continue: step-forward arrows
  guided_continue: strokeIcon(
    '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  ),
  // Guided Regenerate: clockwise refresh (matches Lumiverse native Regenerate icon)
  guided_regenerate: REFRESH_ICON_SVG,
  // Guided Swipe: right chevron (matches Lumiverse native Swipe next icon)
  guided_swipe: strokeIcon('<path d="m9 18 6-6-6-6"/>'),
  // Impersonate: user pen / persona draft
  guided_impersonate: strokeIcon(
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  ),
  // Guided Scene: clapperboard / scene jump
  guided_scene: strokeIcon(SCENE_ICON_BODY),
  // Input Recovery: counter-clockwise restore arrow
  input_recovery: strokeIcon(
    '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  ),
};

export const CONTINUE_MENU_ICONS = {
  // Remove the last continue: step-back / undo arrow
  remove_last_continue: strokeIcon(
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  ),
  // Regenerate last continue: clockwise refresh/reroll arrow
  regenerate_last_continue: REFRESH_ICON_SVG,
} as const;

export const RECOVERY_MENU_ICONS = {
  // History: clock with counter-clockwise arrow
  history: strokeIcon(
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  ),
  // Clear History: trash can
  clear_history: strokeIcon(
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  ),
} as const;

export const SCENE_MENU_ICONS = {
  drop_next_turn: strokeIcon(
    '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  ),
  drop_now: strokeIcon('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  pause: strokeIcon(
    '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  ),
  resume: strokeIcon('<polygon points="6 4 20 12 6 20 6 4"/>'),
  cancel: strokeIcon(
    '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  ),
} as const;
