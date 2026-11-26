export const GUIDED_GENERATIONS_CSS = `
/* Input Toolbar Host & Buttons */
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
  position: relative;
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
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  transition:
    color var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    box-shadow var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
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
  background: var(--lumiverse-primary-020, rgba(139, 92, 246, 0.22));
  color: var(--lumiverse-primary, #c4b5fd);
  box-shadow: 0 0 0 2px var(--lumiverse-primary-050, rgba(139, 92, 246, 0.35));
  transform: scale(0.92);
}

.gg-btn.is-running {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.2));
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
  box-shadow: 0 0 0 1px var(--lumiverse-danger-050, rgba(248, 113, 113, 0.35));
}

.gg-btn.is-armed {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  color: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 0 1px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
}

.gg-btn.is-armed::after {
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 5px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.65));
  pointer-events: none;
}

.gg-btn.is-armed.is-paused {
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.14));
  color: var(--lumiverse-warning-text, var(--lumiverse-warning, #f59e0b));
  box-shadow: 0 0 0 1px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.4));
}

.gg-btn.is-armed.is-paused::after {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 5px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.55));
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

/* Unified Minimalist Borderless Drawer (Media Localizer Aesthetic) */
[data-spindle-drawer-tab]:has(> .gg-drawer-root) {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.gg-drawer-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--lumiverse-text, var(--text-primary, rgba(255, 255, 255, 0.92)));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
  line-height: 1.4;
  overflow: visible;
}

.gg-drawer-root :focus-visible {
  outline: 1.5px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  outline-offset: 1px;
}

.gg-drawer-root input[type="checkbox"] {
  accent-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
}

/* Thin Custom Scrollbars (5px Media Localizer style) */
.gg-drawer-body,
.gg-recovery-list,
.gg-scene-preview-ta {
  scrollbar-width: thin;
  scrollbar-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22)) transparent;
}

.gg-drawer-body::-webkit-scrollbar,
.gg-recovery-list::-webkit-scrollbar,
.gg-scene-preview-ta::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

.gg-drawer-body::-webkit-scrollbar-track,
.gg-recovery-list::-webkit-scrollbar-track,
.gg-scene-preview-ta::-webkit-scrollbar-track {
  background: transparent;
}

.gg-drawer-body::-webkit-scrollbar-thumb,
.gg-recovery-list::-webkit-scrollbar-thumb,
.gg-scene-preview-ta::-webkit-scrollbar-thumb {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-radius: 999px;
}

.gg-drawer-body::-webkit-scrollbar-thumb:hover,
.gg-recovery-list::-webkit-scrollbar-thumb:hover,
.gg-scene-preview-ta::-webkit-scrollbar-thumb:hover {
  background: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.5));
}

/* Sticky Top-Level Segmented Nav Bar (Basic | Advanced) */
.gg-drawer-nav {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  min-width: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.14));
  flex-shrink: 0;
}

.gg-drawer-nav-btn {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
  padding: 4.5px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(255, 255, 255, 0.65)));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.gg-drawer-nav-btn:hover {
  color: var(--lumiverse-text, var(--text-primary, rgba(255, 255, 255, 0.92)));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
}

.gg-drawer-nav-btn.is-active {
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-weight: 600;
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.14);
}

.gg-drawer-nav-btn .gg-nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gg-drawer-nav-btn .gg-nav-icon svg {
  width: 13px;
  height: 13px;
  display: block;
}

.gg-drawer-nav-btn.is-active .gg-nav-icon {
  color: var(--lumiverse-primary, #a78bfa);
}

.gg-nav-armed-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 5px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  flex-shrink: 0;
}

.gg-nav-armed-dot.is-paused {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 5px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.5));
}

/* Inner Advanced Sub-Tab Strip (Extensible for future advanced features) */
.gg-subnav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.gg-subnav-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3.5px 9px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(255, 255, 255, 0.72)));
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.gg-subnav-btn:hover {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-text, currentColor);
}

.gg-subnav-btn.is-active {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.2));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.5));
  color: var(--lumiverse-text, currentColor);
  font-weight: 600;
}

.gg-subnav-btn svg {
  width: 12px;
  height: 12px;
  display: block;
  flex-shrink: 0;
}

.gg-subnav-btn.is-active svg {
  color: var(--lumiverse-primary, #a78bfa);
}

/* Sticky Notice Slot & Scrollable Drawer Body */
.gg-drawer-sticky-slot {
  padding: 6px 10px 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-drawer-sticky-slot:empty {
  display: none;
}

.gg-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gg-drawer-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.gg-drawer-view.is-hidden {
  display: none;
}

/* Basic View (Borderless Flat Sections) */
.gg-drawer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-size: 12px;
  min-width: 0;
}

.gg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
}

.gg-header h2 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
}

.gg-muted {
  margin: 2px 0 0;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.65)));
  font-size: 11px;
  line-height: 1.4;
}

.gg-notice {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-primary-050, rgba(59, 130, 246, 0.35));
  background: var(--lumiverse-primary-015, rgba(59, 130, 246, 0.12));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-size: 11.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.gg-notice.is-error {
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.45));
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.13));
  color: var(--lumiverse-danger-text, var(--lumiverse-text, var(--text-primary, currentColor)));
}

.gg-notice.is-warn {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.42));
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.12));
  color: var(--lumiverse-warning-text, var(--lumiverse-text, var(--text-primary, currentColor)));
}

/* Flat Borderless Flow Sections (Shared by Basic & Advanced) */
.gg-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.gg-section + .gg-section {
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.gg-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(255, 255, 255, 0.62)));
}

.gg-section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 8px;
}

/* Flat Borderless Collapsible Rows (Remodeled Settings Sections) */
.gg-card {
  border: none;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
  padding-top: 2px;
}

.gg-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  transition: background var(--lumiverse-transition-fast, 150ms ease);
}

.gg-card-header:hover {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
}

.gg-card-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.gg-card-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 11px;
  transition: transform 140ms ease;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  opacity: 0.78;
}

.gg-card.is-expanded .gg-card-chevron {
  transform: rotate(90deg);
}

.gg-card-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.32));
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.15));
  color: var(--lumiverse-primary-text, var(--lumiverse-primary, #c4b5fd));
  font-variant-numeric: tabular-nums;
}

.gg-card-badge.is-muted {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.65)));
}

.gg-card-body-wrap {
  border-top: none;
  padding-left: 4px;
}

.gg-card:not(.is-expanded) .gg-card-body-wrap {
  display: none;
}

/* Sub-disclosure (Prompt Templates inside Guided Scene settings) */
.gg-sub-disclosure {
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-sub-disclosure-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 4px 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.gg-sub-disclosure-btn:hover {
  color: var(--lumiverse-text, currentColor);
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
}

.gg-sub-disclosure-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gg-sub-disclosure:not(.is-expanded) .gg-sub-disclosure-body {
  display: none;
}

/* Media Localizer-Style Clean Tick Boxes (replaces toggle switches) */
.gg-checkbox-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border-neutral, var(--lumiverse-border, rgba(255, 255, 255, 0.08)));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.025));
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease);
}

.gg-checkbox-row:hover {
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.24));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.045));
}

.gg-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  cursor: pointer;
  user-select: none;
}

.gg-checkbox {
  width: 14px;
  height: 14px;
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
}

.gg-checkbox:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.gg-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.gg-field-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-primary, rgba(229, 231, 235, 0.88)));
}

/* Compact Buttons & Inputs */
.gg-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3.5px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.gg-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.12)));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.34));
}

.gg-btn-sm:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.gg-btn-sm.is-primary {
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  color: var(--lumiverse-primary-contrast, #ffffff);
  font-weight: 600;
}

.gg-btn-sm.is-primary:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
  border-color: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
}

.gg-btn-sm.is-danger {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.15));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.4));
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
}

.gg-btn-sm.is-danger:hover:not(:disabled) {
  background: var(--lumiverse-danger-020, rgba(239, 68, 68, 0.24));
  border-color: var(--lumiverse-danger, #ef4444);
}

.gg-btn-sm.is-xs {
  padding: 2px 6px;
  font-size: 10.5px;
}

.gg-input-sm {
  width: 100%;
  box-sizing: border-box;
  padding: 4.5px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill, rgba(0, 0, 0, 0.14)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font: inherit;
  font-size: 11.5px;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.gg-input-sm::placeholder {
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(156, 163, 175, 0.6)));
}

.gg-input-sm:focus {
  outline: none;
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
}

.gg-input-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Badges & Status Pills */
.gg-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  font-size: 10px;
  font-weight: 600;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.gg-badge.is-info {
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.36));
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  color: var(--lumiverse-primary-text, var(--lumiverse-primary, #c4b5fd));
}

.gg-badge.is-warn {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.38));
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.15));
  color: var(--lumiverse-warning-text, var(--lumiverse-warning, #f59e0b));
}

.gg-badge.is-success {
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.35));
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.15));
  color: var(--lumiverse-success-text, var(--lumiverse-success, #22c55e));
}

/* Sticky Armed Steering Banner */
.gg-scene-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.gg-armed-banner {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.44));
  background:
    linear-gradient(
      0deg,
      var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16)),
      var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16))
    ),
    var(--lumiverse-bg-deep, var(--lumiverse-bg-elevated, var(--bg-secondary, #18181f)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}

.gg-armed-banner.is-paused {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.44));
  background:
    linear-gradient(
      0deg,
      var(--lumiverse-warning-015, rgba(245, 158, 11, 0.15)),
      var(--lumiverse-warning-015, rgba(245, 158, 11, 0.15))
    ),
    var(--lumiverse-bg-deep, var(--lumiverse-bg-elevated, var(--bg-secondary, #18181f)));
}

.gg-armed-banner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.gg-armed-banner-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
  font-size: 11.5px;
  font-weight: 600;
}

.gg-armed-banner-title > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gg-armed-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 6px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.6));
}

.gg-armed-banner.is-paused .gg-armed-dot {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 6px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.55));
}

.gg-armed-banner-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

/* Guided Scene Workbench */
.gg-scene-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
  padding: 20px 12px;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  font-size: 11.5px;
}

.gg-scene-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
  color: var(--lumiverse-primary, #a78bfa);
}

.gg-scene-empty-icon svg {
  width: 15px;
  height: 15px;
}

.gg-scene-header-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.gg-scene-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 8px;
  align-items: start;
}

.gg-scene-grid-2 > .is-span-2 {
  grid-column: 1 / -1;
}

.gg-scene-compact-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.7)));
  letter-spacing: 0.02em;
}

.gg-checkbox-row.is-compact {
  padding: 3.5px 7px;
}

.gg-scene-preview-ta {
  width: 100%;
  box-sizing: border-box;
  min-height: 88px;
  max-height: 220px;
  resize: vertical;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.14)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.45;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.gg-scene-preview-ta::placeholder {
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(156, 163, 175, 0.6)));
}

.gg-scene-preview-ta:focus {
  outline: none;
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
}

.gg-scene-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.gg-scene-preview-title-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.gg-scene-preview-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

/* Expandable Textarea (Lumiverse ExpandableTextarea parity) */
.gg-expandable-ta {
  position: relative;
  width: 100%;
  min-width: 0;
}

.gg-expandable-ta-slot {
  width: 100%;
  min-width: 0;
}

.gg-expandable-ta-slot textarea {
  padding-right: 34px;
  box-sizing: border-box;
}

.gg-expandable-ta-fallback {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 34px 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.14)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.45;
  resize: vertical;
}

.gg-ta-expand-btn {
  position: absolute;
  top: 5px;
  right: 8px;
  width: var(--lumiverse-btn-icon-sm, 24px);
  height: var(--lumiverse-btn-icon-sm, 24px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--lumiverse-bg-deep, var(--lumiverse-bg-elevated, var(--bg-secondary, var(--lumiverse-bg, #0f0d15))));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.55));
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  z-index: 2;
  padding: 0;
}

.gg-expandable-ta:hover .gg-ta-expand-btn:not(:disabled),
.gg-expandable-ta:focus-within .gg-ta-expand-btn:not(:disabled) {
  opacity: 1;
}

@media (any-hover: none) {
  .gg-ta-expand-btn:not(:disabled) {
    opacity: 0.7;
  }
}

.gg-ta-expand-btn:hover:not(:disabled) {
  color: var(--lumiverse-primary, #c4b5fd);
  border-color: var(--lumiverse-primary, #c4b5fd);
}

.gg-ta-expand-btn:disabled {
  opacity: 0;
  pointer-events: none;
}

/* Expanded Textarea Modal Content (mounted inside ctx.ui.showModal) */
.gg-expanded-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: min(560px, calc(70vh - 120px));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
}

.gg-expanded-editor-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gg-expanded-editor-ta {
  width: 100%;
  flex: 1 1 auto;
  min-height: min(460px, calc(70vh - 200px));
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.22));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.55;
  scrollbar-width: thin;
  scrollbar-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22)) transparent;
}

@media (max-width: 640px), (max-height: 600px) {
  .gg-expanded-editor {
    min-height: min(340px, 55vh);
  }
  .gg-expanded-editor-ta {
    min-height: min(240px, 40vh);
  }
}

.gg-expanded-editor-ta::placeholder {
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(156, 163, 175, 0.6)));
}

.gg-expanded-editor-ta:focus {
  outline: none;
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
}

.gg-expanded-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  flex-wrap: wrap;
}

.gg-expanded-editor-footer-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.gg-expanded-editor-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gg-expanded-editor-counts {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

/* Fallback Modal Overlay (only when host lacks ctx.ui.showModal) */
.gg-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(2px);
}

.gg-modal-dialog {
  display: flex;
  flex-direction: column;
  width: min(860px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  border-radius: 10px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.26));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.gg-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
}

.gg-modal-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.gg-modal-content {
  padding: 12px 14px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.gg-scene-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.gg-scene-primary-btn {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6.5px 12px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  color: var(--lumiverse-primary-contrast, #ffffff);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.gg-scene-primary-btn:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
  border-color: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
}

.gg-scene-primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-scene-stop-btn {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6.5px 12px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-danger-050, rgba(239, 68, 68, 0.5));
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.16));
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.gg-scene-stop-btn:hover {
  background: var(--lumiverse-danger-020, rgba(239, 68, 68, 0.25));
}

.gg-spinner {
  width: 11px;
  height: 11px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  display: inline-block;
  animation: gg-spin 0.8s linear infinite;
}

@keyframes gg-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Recovery & Order Lists (Minimalist Flat Rows) */
.gg-recovery-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-recovery-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
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
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.6)));
}

.gg-recovery-snippet {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gg-order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
}

.gg-order-item-left {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.gg-order-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
}

.gg-order-item-icon svg {
  width: 13px;
  height: 13px;
  display: block;
}

.gg-order-item-label {
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-item-state {
  font-size: 10px;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.55)));
}

.gg-order-item-controls {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.gg-icon-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
  color: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.gg-icon-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.12));
}

.gg-icon-btn-sm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Drop-Up Quick Menu (portaled to document.body) */
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
  min-height: 34px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.25;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
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

.gg-dropup-item.is-danger {
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
}

.gg-dropup-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  pointer-events: none;
  display: block;
  color: var(--lumiverse-primary, var(--accent-primary, currentColor));
}

.gg-dropup-item.is-danger svg {
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
}

.gg-dropup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  margin-bottom: 2px;
}

.gg-dropup-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.75)));
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}

.gg-dropup-back:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
}

.gg-dropup-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
  padding-right: 4px;
}

.gg-dropup-history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-dropup-history-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: min(220px, 100%);
  max-width: 300px;
}

.gg-dropup-history-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-dropup-history-snippet {
  font-size: 12.5px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-dropup-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
  text-align: center;
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

.gg-streaming-indicator--optimistic {
  padding: 8px 16px;
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

/* Floating Chat Heads */
.gg-chat-heads-root {
  position: fixed;
  z-index: 10950;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 6px;
  overflow: visible;
  transform: translate(-50%, -50%);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  cursor: grab;
}

.gg-chat-heads-root.is-dragging {
  cursor: grabbing;
}

.gg-chat-heads-root.is-dragging .gg-chat-head {
  cursor: grabbing;
}

.gg-chat-heads-root.is-dragging .gg-chat-head:active {
  transform: none;
}

.gg-chat-head-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}

.gg-chat-head-dismiss {
  position: absolute;
  top: -4px;
  left: -4px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.25));
  background: var(--lumiverse-bg-deep, #18181f);
  color: var(--lumiverse-text, #e5e7eb);
  font-size: 11px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
  z-index: 1;
}

.gg-chat-head-item:hover .gg-chat-head-dismiss,
.gg-chat-head-item:focus-within .gg-chat-head-dismiss {
  opacity: 1;
  transform: scale(1);
}

.gg-chat-head-dismiss:hover {
  background: var(--lumiverse-danger, #ef4444);
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.4));
  color: var(--lumiverse-danger-contrast, var(--lumiverse-primary-contrast, #fff));
}

@media (hover: none), (pointer: coarse) {
  .gg-chat-head-dismiss {
    opacity: 1;
    transform: scale(1);
    width: 22px;
    height: 22px;
    top: -5px;
    left: -5px;
    font-size: 12px;
  }
}

.gg-chat-head {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  transition:
    transform 140ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.gg-chat-head:hover {
  transform: scale(1.06);
}

.gg-chat-head:active {
  transform: scale(0.96);
}

.gg-chat-head.is-running {
  border-color: var(--lumiverse-warning, #f59e0b);
  box-shadow:
    0 0 0 3px var(--lumiverse-warning-020, var(--lumiverse-warning-015, rgba(245, 158, 11, 0.24))),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-running::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-primary-050, rgba(139, 92, 246, 0.45));
  pointer-events: none;
  will-change: transform, opacity;
  animation: gg-chat-head-pulse 1.5s ease-in-out infinite;
}

.gg-chat-head.is-streaming {
  border-color: var(--lumiverse-primary, #8b5cf6);
  box-shadow:
    0 0 0 3px var(--lumiverse-primary-020, rgba(139, 92, 246, 0.28)),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-completed {
  border-color: var(--lumiverse-success, #22c55e);
  box-shadow:
    0 0 0 3px var(--lumiverse-success-020, var(--lumiverse-success-015, rgba(34, 197, 94, 0.3))),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
  display: block;
}

.gg-chat-head-initials {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--lumiverse-text, #e5e7eb);
  pointer-events: none;
}

.gg-chat-head-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-warning, #f59e0b);
  pointer-events: none;
}

.gg-chat-head.is-streaming .gg-chat-head-badge {
  background: var(--lumiverse-primary, #8b5cf6);
}

.gg-chat-head.is-completed .gg-chat-head-badge {
  background: var(--lumiverse-success, #22c55e);
}

.gg-chat-head-pip {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-danger, #ef4444);
  pointer-events: none;
}

@keyframes gg-chat-head-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.16);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gg-btn,
  .gg-chat-head,
  .gg-chat-head.is-running::after,
  .gg-chat-head-dismiss,
  .gg-card-chevron,
  .gg-dropup-item,
  .gg-drawer-nav-btn,
  .gg-subnav-btn,
  .gg-spinner {
    animation: none !important;
    transition: none !important;
  }
}
`;
