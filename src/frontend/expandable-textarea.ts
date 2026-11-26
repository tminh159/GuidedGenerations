import type {
  SpindleFrontendContext,
  SpindleModalHandle,
  SpindleTextAreaHandle,
  SpindleTextAreaOptions,
} from "lumiverse-spindle-types";

const MAXIMIZE2_ICON_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface ExpandableTextAreaExtraAction {
  id: string;
  label: string;
  html?: string;
  disabled?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

export interface ExpandableTextAreaOptions extends SpindleTextAreaOptions {
  expandTitle: string;
  getStatusBadge?: () => { text: string; className: string } | null;
  getExtraActions?: () => ReadonlyArray<ExpandableTextAreaExtraAction>;
  onModalStateChange?: (open: boolean) => void;
}

export interface ExpandableTextAreaHandle {
  getValue(): string;
  update(patch: Partial<SpindleTextAreaOptions>): void;
  focus(): void;
  blur(): void;
  isFocused(): boolean;
  isModalOpen(): boolean;
  openModal(): void;
  dismissModal(): void;
  syncChrome(): void;
  destroy(): void;
}

interface ExtraActionButtonEntry {
  btn: HTMLButtonElement;
  onClick: () => void;
  lastHtml?: string;
  lastLabel?: string;
}

interface ModalSession {
  handle: SpindleModalHandle;
  unsubDismiss: () => void;
  removeEscapeListener: () => void;
  textarea: HTMLTextAreaElement;
  statusRow: HTMLDivElement;
  statusBadge: HTMLSpanElement;
  countsEl: HTMLSpanElement;
  extraActionsHost: HTMLDivElement;
  extraActionButtons: Map<string, ExtraActionButtonEntry>;
}

function formatTextStats(text: string): string {
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return `${chars} ${chars === 1 ? "char" : "chars"} · ${words} ${words === 1 ? "word" : "words"}`;
}

function createFallbackModal(title: string): SpindleModalHandle {
  const backdrop = document.createElement("div");
  backdrop.className = "gg-modal-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", title);

  const dialog = document.createElement("div");
  dialog.className = "gg-modal-dialog";

  const header = document.createElement("div");
  header.className = "gg-modal-header";
  const titleEl = document.createElement("h3");
  titleEl.className = "gg-modal-title";
  titleEl.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "gg-icon-btn-sm";
  closeBtn.setAttribute("aria-label", "Close modal");
  closeBtn.textContent = "×";
  header.append(titleEl, closeBtn);

  const content = document.createElement("div");
  content.className = "gg-modal-content";

  dialog.append(header, content);
  backdrop.append(dialog);
  if (typeof document !== "undefined" && document.body) {
    document.body.append(backdrop);
  }

  let dismissed = false;
  const dismissListeners = new Set<() => void>();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.style.display !== "none");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!active || active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", onKeyDown, true);
    }
    backdrop.remove();
    for (const fn of [...dismissListeners]) {
      try {
        fn();
      } catch {
        // Ignore listener teardown errors
      }
    }
    dismissListeners.clear();
  };

  closeBtn.addEventListener("click", dismiss);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dismiss();
  });
  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onKeyDown, true);
  }

  return {
    root: content,
    modalId: "gg-fallback-expandable-modal",
    dismiss,
    setTitle: (nextTitle: string) => {
      titleEl.textContent = nextTitle;
      backdrop.setAttribute("aria-label", nextTitle);
    },
    onDismiss: (cb: () => void) => {
      dismissListeners.add(cb);
      return () => dismissListeners.delete(cb);
    },
  };
}

export function mountExpandableTextArea(
  ctx: SpindleFrontendContext,
  target: HTMLElement,
  options: ExpandableTextAreaOptions,
): ExpandableTextAreaHandle {
  let currentValue = options.value ?? "";
  let currentPlaceholder = options.placeholder ?? "";
  let currentDisabled = Boolean(options.disabled);
  let lastSelectionStart: number | null = null;
  let lastSelectionEnd: number | null = null;
  let modalSession: ModalSession | null = null;
  let destroyed = false;

  const wrapper = document.createElement("div");
  wrapper.className = "gg-expandable-ta";

  const mountSlot = document.createElement("div");
  mountSlot.className = "gg-expandable-ta-slot";

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "gg-ta-expand-btn";
  expandBtn.setAttribute("aria-label", `Expand ${options.expandTitle}`);
  expandBtn.title = `Expand ${options.expandTitle}`;
  expandBtn.disabled = currentDisabled;
  expandBtn.innerHTML = MAXIMIZE2_ICON_SVG;

  wrapper.append(mountSlot, expandBtn);
  target.replaceChildren(wrapper);

  let innerHandle: SpindleTextAreaHandle | null = null;
  let fallbackTa: HTMLTextAreaElement | null = null;

  const findInlineTextarea = (): HTMLTextAreaElement | null => {
    if (fallbackTa) return fallbackTa;
    return mountSlot.querySelector<HTMLTextAreaElement>("textarea");
  };

  const captureInlineSelection = () => {
    const ta = findInlineTextarea();
    if (!ta) return;
    if (typeof ta.selectionStart === "number") {
      lastSelectionStart = ta.selectionStart;
      lastSelectionEnd =
        typeof ta.selectionEnd === "number"
          ? ta.selectionEnd
          : ta.selectionStart;
    }
  };

  const syncModalChrome = () => {
    if (!modalSession) return;
    modalSession.countsEl.textContent = formatTextStats(currentValue);

    const badge = options.getStatusBadge?.() ?? null;
    if (badge && badge.text) {
      modalSession.statusRow.style.display = "";
      modalSession.statusBadge.className = badge.className;
      modalSession.statusBadge.textContent = badge.text;
    } else {
      modalSession.statusRow.style.display = "none";
      modalSession.statusBadge.textContent = "";
    }

    // Reconcile extra action buttons in place by act.id so focus is preserved across updates
    const actions = options.getExtraActions?.() ?? [];
    const seenIds = new Set<string>();
    for (const act of actions) {
      seenIds.add(act.id);
      let entry = modalSession.extraActionButtons.get(act.id);
      if (!entry) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gg-btn-sm";
        btn.dataset.ggExpandedAction = act.id;
        const created: ExtraActionButtonEntry = { btn, onClick: act.onClick };
        btn.addEventListener("click", () => {
          created.onClick();
        });
        modalSession.extraActionButtons.set(act.id, created);
        modalSession.extraActionsHost.append(btn);
        entry = created;
      } else {
        entry.onClick = act.onClick;
      }

      entry.btn.style.display = act.hidden ? "none" : "";
      entry.btn.disabled = Boolean(act.disabled);
      if (act.html !== undefined) {
        if (entry.lastHtml !== act.html) {
          entry.btn.innerHTML = act.html;
          entry.lastHtml = act.html;
          entry.lastLabel = undefined;
        }
      } else if (entry.lastLabel !== act.label || entry.lastHtml !== undefined) {
        entry.btn.textContent = act.label;
        entry.lastLabel = act.label;
        entry.lastHtml = undefined;
      }
    }

    for (const [id, entry] of [...modalSession.extraActionButtons.entries()]) {
      if (!seenIds.has(id)) {
        entry.btn.remove();
        modalSession.extraActionButtons.delete(id);
      }
    }
  };

  const handleInlineChange = (nextVal: string) => {
    currentValue = nextVal;
    captureInlineSelection();
    if (modalSession && modalSession.textarea.value !== nextVal) {
      modalSession.textarea.value = nextVal;
    }
    syncModalChrome();
    options.onChange?.(nextVal);
  };

  if (typeof ctx.components?.mountTextArea === "function") {
    innerHandle = ctx.components.mountTextArea(mountSlot, {
      value: currentValue,
      rows: options.rows,
      placeholder: options.placeholder,
      disabled: currentDisabled,
      className: options.className,
      ariaLabel: options.ariaLabel,
      onChange: handleInlineChange,
    });
  } else {
    const ta = document.createElement("textarea");
    ta.className = options.className
      ? `gg-expandable-ta-fallback ${options.className}`
      : "gg-expandable-ta-fallback";
    if (options.rows !== undefined) ta.rows = options.rows;
    if (options.placeholder !== undefined) ta.placeholder = options.placeholder;
    ta.disabled = currentDisabled;
    if (options.ariaLabel) ta.setAttribute("aria-label", options.ariaLabel);
    ta.value = currentValue;
    ta.addEventListener("input", () => {
      handleInlineChange(ta.value);
    });
    fallbackTa = ta;
    mountSlot.replaceChildren(ta);
  }

  // Capture inline cursor position before clicking expand steals focus
  const onSlotSelectionTrack = () => captureInlineSelection();
  mountSlot.addEventListener("keyup", onSlotSelectionTrack, true);
  mountSlot.addEventListener("mouseup", onSlotSelectionTrack, true);
  mountSlot.addEventListener("select", onSlotSelectionTrack, true);

  const onExpandPointerDown = () => {
    captureInlineSelection();
  };
  expandBtn.addEventListener("pointerdown", onExpandPointerDown);
  expandBtn.addEventListener("mousedown", onExpandPointerDown);

  const dismissModal = () => {
    const session = modalSession;
    if (!session) return;
    modalSession = null;
    session.removeEscapeListener();
    try {
      session.unsubDismiss();
    } catch {
      // Ignore unsubscribe errors
    }
    try {
      session.handle.dismiss();
    } catch {
      // Ignore dismiss errors
    }
    options.onModalStateChange?.(false);
  };

  const openModal = () => {
    if (destroyed || currentDisabled) return;
    if (modalSession) {
      modalSession.textarea.focus();
      return;
    }

    // Sync latest live value from inline component if needed
    const latest = innerHandle
      ? innerHandle.getValue()
      : fallbackTa?.value ?? currentValue;
    currentValue = latest;

    const handle =
      typeof ctx.ui?.showModal === "function"
        ? ctx.ui.showModal({
            title: options.expandTitle,
            width: 860,
            maxHeight: 720,
          })
        : createFallbackModal(options.expandTitle);

    const container = document.createElement("div");
    container.className = "gg-expanded-editor";

    const statusRow = document.createElement("div");
    statusRow.className = "gg-expanded-editor-status";
    statusRow.style.display = "none";
    const statusBadge = document.createElement("span");
    statusBadge.className = "gg-badge";
    statusBadge.dataset.ggExpandedStatus = "badge";
    statusRow.append(statusBadge);

    const modalTa = document.createElement("textarea");
    modalTa.className = "gg-expanded-editor-ta";
    modalTa.rows = 16;
    modalTa.placeholder = currentPlaceholder;
    modalTa.disabled = currentDisabled;
    modalTa.value = currentValue;
    modalTa.setAttribute("aria-label", options.expandTitle);
    modalTa.dataset.ggExpandedEditor = "true";
    modalTa.addEventListener("input", () => {
      const nextVal = modalTa.value;
      currentValue = nextVal;
      if (typeof modalTa.selectionStart === "number") {
        lastSelectionStart = modalTa.selectionStart;
        lastSelectionEnd =
          typeof modalTa.selectionEnd === "number"
            ? modalTa.selectionEnd
            : modalTa.selectionStart;
      }
      if (innerHandle) {
        if (innerHandle.getValue() !== nextVal) {
          innerHandle.update({ value: nextVal });
        }
      } else if (fallbackTa && fallbackTa.value !== nextVal) {
        fallbackTa.value = nextVal;
      }
      syncModalChrome();
      options.onChange?.(nextVal);
    });

    const footer = document.createElement("div");
    footer.className = "gg-expanded-editor-footer";

    const footerLeft = document.createElement("div");
    footerLeft.className = "gg-expanded-editor-footer-left";
    const countsEl = document.createElement("span");
    countsEl.className = "gg-muted gg-expanded-editor-counts";
    countsEl.dataset.ggExpandedCounts = "true";
    const extraActionsHost = document.createElement("div");
    extraActionsHost.className = "gg-expanded-editor-actions";
    footerLeft.append(extraActionsHost, countsEl);

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "gg-btn-sm is-primary";
    doneBtn.dataset.ggExpandedAction = "done";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => {
      if (typeof modalTa.selectionStart === "number") {
        lastSelectionStart = modalTa.selectionStart;
        lastSelectionEnd =
          typeof modalTa.selectionEnd === "number"
            ? modalTa.selectionEnd
            : modalTa.selectionStart;
      }
      handle.dismiss();
    });

    footer.append(footerLeft, doneBtn);
    container.append(statusRow, modalTa, footer);
    handle.root.replaceChildren(container);

    // Ensure Escape dismisses BOTH host ctx.ui.showModal and fallback modals cleanly
    const onModalEscapeKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modalSession?.handle !== handle) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof modalTa.selectionStart === "number") {
        lastSelectionStart = modalTa.selectionStart;
        lastSelectionEnd =
          typeof modalTa.selectionEnd === "number"
            ? modalTa.selectionEnd
            : modalTa.selectionStart;
      }
      handle.dismiss();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", onModalEscapeKeyDown, true);
    }
    const removeEscapeListener = () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", onModalEscapeKeyDown, true);
      }
    };

    const unsubDismiss = handle.onDismiss(() => {
      removeEscapeListener();
      if (modalSession?.handle === handle) {
        if (typeof modalTa.selectionStart === "number") {
          lastSelectionStart = modalTa.selectionStart;
          lastSelectionEnd =
            typeof modalTa.selectionEnd === "number"
              ? modalTa.selectionEnd
              : modalTa.selectionStart;
        }
        modalSession = null;
        options.onModalStateChange?.(false);
        if (!destroyed && mountSlot.isConnected) {
          const inlineTa = findInlineTextarea();
          if (inlineTa && !inlineTa.disabled) {
            inlineTa.focus();
            if (lastSelectionStart !== null) {
              const start = Math.min(lastSelectionStart, inlineTa.value.length);
              const end =
                lastSelectionEnd !== null
                  ? Math.min(lastSelectionEnd, inlineTa.value.length)
                  : start;
              try {
                inlineTa.setSelectionRange(start, end);
              } catch {
                // Ignore selection errors in non-standard DOM mocks
              }
            }
          }
        }
      }
    });

    modalSession = {
      handle,
      unsubDismiss,
      removeEscapeListener,
      textarea: modalTa,
      statusRow,
      statusBadge,
      countsEl,
      extraActionsHost,
      extraActionButtons: new Map(),
    };

    syncModalChrome();
    options.onModalStateChange?.(true);

    modalTa.focus();
    if (lastSelectionStart !== null) {
      const start = Math.min(lastSelectionStart, modalTa.value.length);
      const end =
        lastSelectionEnd !== null
          ? Math.min(lastSelectionEnd, modalTa.value.length)
          : start;
      try {
        modalTa.setSelectionRange(start, end);
      } catch {
        // Ignore selection errors in non-standard DOM mocks
      }
    }
  };

  expandBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openModal();
  });

  const getValue = (): string => {
    if (modalSession) return modalSession.textarea.value;
    if (innerHandle) return innerHandle.getValue();
    return fallbackTa?.value ?? currentValue;
  };

  return {
    getValue,
    update(patch: Partial<SpindleTextAreaOptions>) {
      if (destroyed) return;
      if (patch.value !== undefined) {
        currentValue = patch.value;
      }
      if (patch.placeholder !== undefined) {
        currentPlaceholder = patch.placeholder;
      }
      if (patch.disabled !== undefined) {
        currentDisabled = Boolean(patch.disabled);
        expandBtn.disabled = currentDisabled;
      }

      if (innerHandle) {
        innerHandle.update(patch);
      } else if (fallbackTa) {
        if (patch.value !== undefined && fallbackTa.value !== patch.value) {
          fallbackTa.value = patch.value;
        }
        if (patch.placeholder !== undefined) {
          fallbackTa.placeholder = patch.placeholder;
        }
        if (patch.disabled !== undefined) {
          fallbackTa.disabled = Boolean(patch.disabled);
        }
        if (patch.rows !== undefined) {
          fallbackTa.rows = patch.rows;
        }
      }

      if (modalSession) {
        if (
          patch.value !== undefined &&
          modalSession.textarea.value !== patch.value
        ) {
          modalSession.textarea.value = patch.value;
        }
        if (patch.placeholder !== undefined) {
          modalSession.textarea.placeholder = patch.placeholder;
        }
        if (patch.disabled !== undefined) {
          modalSession.textarea.disabled = Boolean(patch.disabled);
        }
        syncModalChrome();
      }
    },
    focus() {
      if (destroyed) return;
      if (modalSession) {
        modalSession.textarea.focus();
      } else if (innerHandle && typeof innerHandle.focus === "function") {
        innerHandle.focus();
      } else {
        findInlineTextarea()?.focus();
      }
    },
    blur() {
      if (destroyed) return;
      if (modalSession) {
        modalSession.textarea.blur();
      } else if (innerHandle && typeof innerHandle.blur === "function") {
        innerHandle.blur();
      } else {
        findInlineTextarea()?.blur();
      }
    },
    isFocused(): boolean {
      const active =
        typeof document !== "undefined" ? document.activeElement : null;
      if (!active) return false;
      if (modalSession && active === modalSession.textarea) return true;
      if (fallbackTa && active === fallbackTa) return true;
      return mountSlot.contains(active);
    },
    isModalOpen(): boolean {
      return modalSession !== null;
    },
    openModal,
    dismissModal,
    syncChrome() {
      syncModalChrome();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dismissModal();
      mountSlot.removeEventListener("keyup", onSlotSelectionTrack, true);
      mountSlot.removeEventListener("mouseup", onSlotSelectionTrack, true);
      mountSlot.removeEventListener("select", onSlotSelectionTrack, true);
      expandBtn.removeEventListener("pointerdown", onExpandPointerDown);
      expandBtn.removeEventListener("mousedown", onExpandPointerDown);
      innerHandle?.destroy();
      innerHandle = null;
      fallbackTa = null;
      wrapper.remove();
    },
  };
}
