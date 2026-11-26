import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type {
  SpindleFrontendContext,
  SpindleModalHandle,
  SpindleModalOptions,
  SpindleSelectOption,
  SpindleTextAreaOptions,
} from "lumiverse-spindle-types";
import { setup } from "../src/frontend";
import { CUSTOM_GREETING_VALUE } from "../src/frontend/scene-panel";
import { GUIDED_GENERATIONS_CSS } from "../src/frontend/styles";
import { createDefaultSettings } from "../src/shared/defaults";
import type {
  ArmedSceneState,
  DropSceneNowInput,
  ExtensionBootstrapView,
  GuidedGenerationsSettings,
  GuidedSceneChatContext,
} from "../src/shared/types";

let dom: JSDOM | null = null;
const origWindow = globalThis.window;
const origDocument = globalThis.document;
const origHTMLElement = globalThis.HTMLElement;
const origElement = globalThis.Element;
const origNode = globalThis.Node;

function installDom(): void {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://localhost/",
  });
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: unknown }).document = dom.window.document;
  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement =
    dom.window.HTMLElement;
  (globalThis as unknown as { Element: unknown }).Element = dom.window.Element;
  (globalThis as unknown as { Node: unknown }).Node = dom.window.Node;
}

function uninstallDom(): void {
  dom?.window.close();
  dom = null;
  (globalThis as unknown as { window: unknown }).window = origWindow;
  (globalThis as unknown as { document: unknown }).document = origDocument;
  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement =
    origHTMLElement;
  (globalThis as unknown as { Element: unknown }).Element = origElement;
  (globalThis as unknown as { Node: unknown }).Node = origNode;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeBootstrapView(
  overrides: Partial<ExtensionBootstrapView> = {},
): ExtensionBootstrapView {
  return {
    settings: createDefaultSettings(),
    connections: [
      {
        id: "conn-1",
        name: "Primary LLM",
        provider: "openai",
        model: "gpt-4o",
        isDefault: true,
      },
    ],
    presets: [{ id: "preset-1", name: "Roleplay Preset" }],
    recovery: [],
    activeRun: null,
    armedScene: null,
    armedScenes: [],
    permissions: {
      generation: true,
      chats: true,
      chat_mutation: true,
      characters: true,
      presets: true,
      regex_scripts: true,
      interceptor: true,
    },
    ...overrides,
  };
}

function makeSceneContext(
  overrides: Partial<GuidedSceneChatContext> = {},
): GuidedSceneChatContext {
  return {
    chatId: "chat-a",
    isGroup: false,
    primaryCharacterId: "char-1",
    primaryCharacterName: "Lyra",
    members: [{ id: "char-1", name: "Lyra" }],
    greetings: [
      {
        key: "char-1:0",
        id: "g-0",
        characterId: "char-1",
        characterName: "Lyra",
        greetingIndex: 0,
        label: "Greeting #1 — Tavern Opening",
        text: "Lyra looks up from her ledger as the tavern door creaks open.",
        preview: "Lyra looks up from her ledger...",
        isOpening: true,
        hasMedia: false,
      },
      {
        key: "char-1:1",
        id: "g-1",
        characterId: "char-1",
        characterName: "Lyra",
        greetingIndex: 1,
        label: "Greeting #2 — Rooftop Rain",
        text: "![rain](https://example.com/rain.png)\nRain hammers the slate roof while Lyra steadies the lantern.",
        preview: "Rain hammers the slate roof...",
        isOpening: false,
        hasMedia: true,
      },
    ],
    armedScene: null,
    canSwipeLastAssistant: true,
    ...overrides,
  };
}

function makeArmedScene(
  overrides: Partial<ArmedSceneState> = {},
): ArmedSceneState {
  return {
    chatId: "chat-a",
    status: "armed",
    pacing: "multi_turn",
    delivery: "bridge",
    adjustmentMode: "context_adapt",
    greetingSource: "card",
    selectedGreetingKey: "char-1:1",
    greetingLabel: "Greeting #2 — Rooftop Rain",
    rawGreetingText:
      "![rain](https://example.com/rain.png)\nRain hammers the slate roof while Lyra steadies the lantern.",
    speakerCharacterId: "char-1",
    speakerCharacterName: "Lyra",
    transitionNote: "Head up the stairwell after the toast",
    customDirection: "Keep tone taut and atmospheric",
    keepMediaIntact: true,
    lockedDraftText: null,
    draftLocked: false,
    armedAt: 1000,
    turnsSteered: 1,
    ...overrides,
  };
}

interface SentRpc {
  requestId: string;
  action: string;
  input: unknown;
}

interface TrackedTextArea {
  textareaEl: HTMLTextAreaElement;
  initialOptions: SpindleTextAreaOptions;
  updates: Array<Partial<SpindleTextAreaOptions>>;
  destroyed: boolean;
}

interface MockModalRecord {
  options: SpindleModalOptions;
  root: HTMLDivElement;
  dismissed: boolean;
  triggerDismiss: () => void;
}

function createSceneHarness(options: {
  initialChatId?: string | null;
  detachDrawerTab?: boolean;
  drawerOpenOnTab?: boolean;
  composerText?: string;
  enableMountTextArea?: boolean;
  enableShowModal?: boolean;
} = {}) {
  document.body.replaceChildren();
  const actionsMount = document.createElement("div");
  const rowMount = document.createElement("div");
  const alertMount = document.createElement("div");
  const streamAfterMount = document.createElement("div");
  const tabRoot = document.createElement("div");
  if (options.detachDrawerTab) {
    document.body.append(actionsMount, rowMount, alertMount, streamAfterMount);
  } else {
    document.body.append(
      actionsMount,
      rowMount,
      alertMount,
      streamAfterMount,
      tabRoot,
    );
  }

  let activeChatId: string | null =
    options.initialChatId === undefined ? "chat-a" : options.initialChatId;
  let drawerOpen = Boolean(options.drawerOpenOnTab ?? !options.detachDrawerTab);
  let drawerActiveTabId: string | null = drawerOpen
    ? "guided-generations-settings"
    : null;
  let composerText = options.composerText ?? "My untouched user draft";
  let composerSetCalls = 0;
  let tabActivateCalls = 0;
  let switchMountCount = 0;
  const openedModals: MockModalRecord[] = [];
  const textAreaControls = new Map<string, TrackedTextArea>();
  const selectControls = new Map<
    string,
    {
      selectEl: HTMLSelectElement;
      options: SpindleSelectOption[];
      value: string;
      onChange?: (val: string) => void;
    }
  >();

  const sentRpcs: SentRpc[] = [];
  const backendListeners = new Set<(payload: unknown) => void>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const activateListeners = new Set<() => void>();

  const componentsObj: Record<string, unknown> = {
    mountSwitch: () => {
      switchMountCount += 1;
      throw new Error(
        "mountSwitch must NOT be called anywhere in the remodeled drawer!",
      );
    },
    mountSelect: (
      target: string | Element,
      opts: {
        options: SpindleSelectOption[];
        value: string;
        ariaLabel?: string;
        onChange?: (val: string) => void;
      },
    ) => {
      const el =
        typeof target === "string" ? document.querySelector(target)! : target;
      const select = document.createElement("select");
      if (opts.ariaLabel) select.setAttribute("aria-label", opts.ariaLabel);
      const state = {
        selectEl: select,
        options: opts.options,
        value: opts.value,
        onChange: opts.onChange,
      };
      const syncOptions = () => {
        select.replaceChildren();
        for (const o of state.options) {
          const optEl = document.createElement("option");
          optEl.value = o.value;
          optEl.textContent = o.label;
          optEl.disabled = Boolean(o.disabled);
          select.append(optEl);
        }
        select.value = state.value;
      };
      syncOptions();
      select.addEventListener("change", () => {
        state.value = select.value;
        state.onChange?.(select.value);
      });
      if (opts.ariaLabel) {
        selectControls.set(opts.ariaLabel, state);
      }
      el.replaceChildren(select);
      return {
        componentId: "sel",
        element: el as HTMLElement,
        update: (patch: {
          options?: SpindleSelectOption[];
          value?: string;
        }) => {
          if (patch.options) state.options = patch.options;
          if (patch.value !== undefined) state.value = patch.value;
          syncOptions();
        },
        destroy: () => {
          el.replaceChildren();
        },
      };
    },
    mountModelCombobox: (
      target: string | Element,
      opts: { value?: string; onChange?: (v: string) => void },
    ) => {
      const el =
        typeof target === "string" ? document.querySelector(target)! : target;
      const input = document.createElement("input");
      input.value = opts.value ?? "";
      input.addEventListener("input", () => opts.onChange?.(input.value));
      el.replaceChildren(input);
      return {
        componentId: "mc",
        element: el as HTMLElement,
        update: () => {},
        destroy: () => el.replaceChildren(),
        getValue: () => input.value,
        refresh: () => {},
      };
    },
    mountNumericInput: (
      target: string | Element,
      opts: {
        value?: number | null;
        disabled?: boolean;
        ariaLabel?: string;
        onChange?: (v: number | null) => void;
      },
    ) => {
      const el =
        typeof target === "string" ? document.querySelector(target)! : target;
      const input = document.createElement("input");
      input.type = "number";
      input.value = opts.value != null ? String(opts.value) : "";
      input.disabled = Boolean(opts.disabled);
      if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);
      input.addEventListener("input", () => {
        const parsed = input.value.trim() === "" ? null : Number(input.value);
        opts.onChange?.(
          parsed !== null && Number.isFinite(parsed) ? parsed : null,
        );
      });
      el.replaceChildren(input);
      return {
        componentId: "num",
        element: el as HTMLElement,
        update: (patch: { value?: number | null; disabled?: boolean }) => {
          if (patch.value !== undefined) {
            input.value = patch.value != null ? String(patch.value) : "";
          }
          if (patch.disabled !== undefined) {
            input.disabled = patch.disabled;
          }
        },
        destroy: () => el.replaceChildren(),
        getValue: () => {
          const v = input.value.trim();
          return v === "" ? null : Number(v);
        },
      };
    },
  };

  if (options.enableMountTextArea !== false) {
    componentsObj.mountTextArea = (
      target: string | Element,
      opts: SpindleTextAreaOptions,
    ) => {
      const el =
        typeof target === "string" ? document.querySelector(target)! : target;
      const ta = document.createElement("textarea");
      ta.value = opts.value ?? "";
      if (opts.rows !== undefined) ta.rows = opts.rows;
      if (opts.placeholder !== undefined) ta.placeholder = opts.placeholder;
      if (opts.disabled !== undefined) ta.disabled = Boolean(opts.disabled);
      if (opts.className) ta.className = opts.className;
      if (opts.ariaLabel) ta.setAttribute("aria-label", opts.ariaLabel);
      ta.addEventListener("input", () => opts.onChange?.(ta.value));
      el.replaceChildren(ta);

      const tracked: TrackedTextArea = {
        textareaEl: ta,
        initialOptions: { ...opts },
        updates: [],
        destroyed: false,
      };
      if (opts.ariaLabel) {
        textAreaControls.set(opts.ariaLabel, tracked);
      }

      return {
        componentId: "ta",
        element: el as HTMLElement,
        update: (patch: Partial<SpindleTextAreaOptions>) => {
          tracked.updates.push({ ...patch });
          if (patch.value !== undefined) ta.value = patch.value;
          if (patch.placeholder !== undefined) ta.placeholder = patch.placeholder;
          if (patch.disabled !== undefined) ta.disabled = Boolean(patch.disabled);
          if (patch.rows !== undefined) ta.rows = patch.rows;
        },
        destroy: () => {
          tracked.destroyed = true;
          el.replaceChildren();
        },
        getValue: () => ta.value,
        focus: () => ta.focus(),
        blur: () => ta.blur(),
      };
    };
  }

  const uiObj: Record<string, unknown> = {
    mount: (point: string) => {
      if (point === "chat_toolbar") return rowMount;
      if (point === "chat_composer_above") return alertMount;
      if (point === "chat_stream_after") return streamAfterMount;
      return actionsMount;
    },
    events: {
      getDrawerState: () => ({
        open: drawerOpen,
        tabId: drawerActiveTabId,
      }),
    },
    registerDrawerTab: (opts: { id: string }) => ({
      root: tabRoot,
      tabId: opts.id,
      setTitle: () => {},
      setShortName: () => {},
      setBadge: () => {},
      activate: () => {
        tabActivateCalls += 1;
        drawerOpen = true;
        drawerActiveTabId = opts.id;
        if (!tabRoot.isConnected) {
          document.body.append(tabRoot);
        }
        for (const fn of activateListeners) fn();
      },
      destroy: () => {},
      onActivate: (fn: () => void) => {
        activateListeners.add(fn);
        return () => activateListeners.delete(fn);
      },
    }),
  };

  if (options.enableShowModal !== false) {
    uiObj.showModal = (modalOpts: SpindleModalOptions): SpindleModalHandle => {
      const root = document.createElement("div");
      root.className = "mock-host-modal-root";
      document.body.append(root);
      const listeners = new Set<() => void>();
      const rec: MockModalRecord = {
        options: modalOpts,
        root,
        dismissed: false,
        triggerDismiss: () => {
          if (rec.dismissed) return;
          rec.dismissed = true;
          root.remove();
          for (const fn of [...listeners]) fn();
          listeners.clear();
        },
      };
      openedModals.push(rec);
      return {
        root,
        modalId: `mock-modal-${openedModals.length}`,
        dismiss: () => rec.triggerDismiss(),
        setTitle: (nextTitle: string) => {
          rec.options = { ...rec.options, title: nextTitle };
        },
        onDismiss: (cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      };
    };
  }

  const ctx = {
    ready: () => {},
    getActiveChat: () => ({ chatId: activeChatId, characterId: "char-1" }),
    sendToBackend: (payload: unknown) => {
      const p = payload as {
        type: string;
        requestId: string;
        action: string;
        input: unknown;
      };
      if (p.type === "gg:rpc") {
        sentRpcs.push({
          requestId: p.requestId,
          action: p.action,
          input: p.input,
        });
      }
    },
    onBackendMessage: (handler: (payload: unknown) => void) => {
      backendListeners.add(handler);
      return () => backendListeners.delete(handler);
    },
    events: {
      on: (name: string, handler: (payload: unknown) => void) => {
        let set = eventListeners.get(name);
        if (!set) {
          set = new Set();
          eventListeners.set(name, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    },
    dom: {
      addStyle: () => () => {},
      findMessageElement: () => null,
      inject: (target: Element, html: string) => {
        const div = document.createElement("div");
        div.innerHTML = html;
        const child = div.firstElementChild!;
        target.append(child);
        return child;
      },
      uninject: (el: Element) => el.remove(),
    },
    composer: {
      getState: () => ({
        mounted: true,
        chatId: activeChatId,
        text: composerText,
      }),
      setText: (next: string) => {
        composerSetCalls += 1;
        composerText = next;
      },
      focus: () => {},
    },
    connections: {
      getActive: () => ({
        activeProfileId: "conn-1",
        provider: "openai",
        model: "gpt-4o",
      }),
      list: () => [],
      subscribe: () => () => {},
    },
    ui: uiObj,
    components: componentsObj,
  } as unknown as SpindleFrontendContext;

  const emitFromBackend = (payload: unknown) => {
    for (const fn of [...backendListeners]) fn(payload);
  };

  const resolveLastRpc = (result: unknown, action?: string) => {
    const req = action
      ? [...sentRpcs].reverse().find((r) => r.action === action)
      : sentRpcs[sentRpcs.length - 1];
    if (!req) throw new Error(`No sent RPC found for ${action ?? "any"}`);
    emitFromBackend({
      type: "gg:reply",
      requestId: req.requestId,
      result,
    });
    return req;
  };

  const emitEvent = (name: string, payload: unknown) => {
    const set = eventListeners.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  };

  const changeSelect = (ariaLabel: string, value: string) => {
    const ctrl = selectControls.get(ariaLabel);
    if (!ctrl) throw new Error(`Select not found: ${ariaLabel}`);
    ctrl.selectEl.value = value;
    ctrl.selectEl.dispatchEvent(
      new (document.defaultView!.Event)("change", { bubbles: true }),
    );
  };

  return {
    ctx,
    actionsMount,
    rowMount,
    alertMount,
    streamAfterMount,
    tabRoot,
    sentRpcs,
    selectControls,
    textAreaControls,
    openedModals,
    emitFromBackend,
    resolveLastRpc,
    emitEvent,
    changeSelect,
    setActiveChat: (chatId: string | null) => {
      activeChatId = chatId;
    },
    setDrawerOpenState: (open: boolean, tabId: string | null) => {
      drawerOpen = open;
      drawerActiveTabId = tabId;
    },
    getComposerText: () => composerText,
    getComposerSetCalls: () => composerSetCalls,
    getTabActivateCalls: () => tabActivateCalls,
    getSwitchMountCount: () => switchMountCount,
  };
}

describe("Guided Scene frontend remodel & workbench", () => {
  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    uninstallDom();
  });

  test("uses Media Localizer borderless CSS, Basic | Advanced top nav, single Keep media intact checkbox, ZERO mountSwitch, and ExpandableTextarea corner button on all 10 textareas", async () => {
    // Structural CSS assertions (Media Localizer + Lumiverse ExpandableTextarea parity)
    expect(GUIDED_GENERATIONS_CSS).toContain(
      "[data-spindle-drawer-tab]:has(> .gg-drawer-root)",
    );
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-drawer-nav");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-subnav");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-checkbox-row");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-scene-grid-2");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-expandable-ta");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-ta-expand-btn");
    expect(GUIDED_GENERATIONS_CSS).toContain("@media (any-hover: none)");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-expanded-editor-ta");
    expect(GUIDED_GENERATIONS_CSS).toContain("position: sticky;");
    expect(GUIDED_GENERATIONS_CSS).toContain("width: 5px;");
    expect(GUIDED_GENERATIONS_CSS).not.toContain("crypto.randomUUID");

    const h = createSceneHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // Zero mountSwitch calls anywhere in the drawer
      expect(h.getSwitchMountCount()).toBe(0);
      expect(h.tabRoot.querySelectorAll('button[role="switch"]')).toHaveLength(
        0,
      );

      // 9 settings textareas (5 Basic Guidance Templates + 4 Guided Scene Prompt Templates) each have a corner expand button
      expect(h.tabRoot.querySelectorAll(".gg-ta-expand-btn")).toHaveLength(9);

      // Top-level Basic | Advanced nav bar, Basic active by default
      const basicTab = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-nav="basic"]',
      )!;
      const advancedTab = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-nav="advanced"]',
      )!;
      expect(basicTab.classList.contains("is-active")).toBe(true);
      expect(advancedTab.classList.contains("is-active")).toBe(false);

      // Zero get_scene_context calls while viewing Basic
      expect(
        h.sentRpcs.filter((r) => r.action === "get_scene_context"),
      ).toHaveLength(0);

      // Toolbar Layout includes Guided Scene in Button Order
      const sceneOrderItem = h.tabRoot.querySelector(
        '[data-gg-order-id="guided_scene"]',
      );
      expect(sceneOrderItem).not.toBeNull();
      expect(sceneOrderItem!.textContent).toContain("Guided Scene");

      // Switching to Advanced reveals Guided Scene sub-tab, compact workbench, and Guided Scene Settings
      advancedTab.click();
      await flushMicrotasks();

      expect(advancedTab.classList.contains("is-active")).toBe(true);
      const subNavScene = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-subnav="guided_scene"]',
      )!;
      expect(subNavScene.classList.contains("is-active")).toBe(true);

      // Lazy load fired exactly once when Advanced -> Guided Scene became visible
      const ctxRpcs = h.sentRpcs.filter(
        (r) => r.action === "get_scene_context",
      );
      expect(ctxRpcs).toHaveLength(1);
      expect(ctxRpcs[0]!.input).toEqual({ chatId: "chat-a" });
      h.resolveLastRpc(makeSceneContext(), "get_scene_context");
      await flushMicrotasks();

      // Now all 10 multi-line textareas (5 Basic + 4 Prompt Templates + 1 Staging Preview) have corner .gg-ta-expand-btn
      expect(h.tabRoot.querySelectorAll(".gg-ta-expand-btn")).toHaveLength(10);
      expect(h.getSwitchMountCount()).toBe(0);

      // EXACTLY ONE "Keep media intact" checkbox across the entire drawer
      const keepMediaBoxes = h.tabRoot.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][aria-label*="Keep media intact"]',
      );
      expect(keepMediaBoxes).toHaveLength(1);
      expect(
        h.tabRoot
          .querySelector(".gg-scene-panel")!
          .contains(keepMediaBoxes[0]!),
      ).toBe(true);
      expect(
        h.tabRoot.querySelector(
          '[data-gg-section-id="guided_scene"] input[type="checkbox"][aria-label*="Keep media"]',
        ),
      ).toBeNull();

      // Toggling the single canonical checkbox persists keepMediaIntact via save_settings
      keepMediaBoxes[0]!.click();
      await flushMicrotasks();
      const saved = h.sentRpcs
        .filter((r) => r.action === "save_settings")
        .pop()!;
      expect(
        (saved.input as GuidedGenerationsSettings).guidedScene.keepMediaIntact,
      ).toBe(false);

      // Guided Scene Settings card exists inside Advanced -> Guided Scene with OOC append_last_user option
      const sceneSettingsCard = h.tabRoot.querySelector(
        '[data-gg-view="advanced"] [data-gg-section-id="guided_scene"]',
      );
      expect(sceneSettingsCard).not.toBeNull();
      const posControl = h.selectControls.get(
        "Guided Scene Steering Guidance Position",
      )!;
      expect(posControl.options.some((o) => o.value === "append_last_user")).toBe(
        true,
      );
    } finally {
      teardown();
    }
  });

  test("guided_scene toolbar button opens Advanced -> Guided Scene without touching composer, toggles close_drawer, and aborts when streaming", async () => {
    const h = createSceneHarness({
      initialChatId: "chat-a",
      detachDrawerTab: true,
      drawerOpenOnTab: false,
      composerText: "Keep my typed message intact!",
    });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      expect(
        h.sentRpcs.filter((r) => r.action === "get_scene_context"),
      ).toHaveLength(0);

      const sceneBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_scene"]',
      )!;
      expect(sceneBtn).not.toBeNull();

      sceneBtn.click();
      await flushMicrotasks();

      expect(h.getTabActivateCalls()).toBe(1);
      expect(h.getComposerSetCalls()).toBe(0);
      expect(h.getComposerText()).toBe("Keep my typed message intact!");
      expect(
        h.tabRoot
          .querySelector('[data-gg-nav="advanced"]')!
          .classList.contains("is-active"),
      ).toBe(true);
      expect(
        h.sentRpcs.filter((r) => r.action === "get_scene_context").length,
      ).toBeGreaterThanOrEqual(1);

      // 2nd click while main drawer is open on Advanced -> Guided Scene calls close_drawer
      sceneBtn.click();
      await flushMicrotasks();
      expect(
        h.sentRpcs.filter((r) => r.action === "close_drawer"),
      ).toHaveLength(1);

      // Switching to Basic then clicking toolbar jumps back to Advanced -> Guided Scene
      h.tabRoot
        .querySelector<HTMLButtonElement>('[data-gg-nav="basic"]')!
        .click();
      await flushMicrotasks();
      sceneBtn.click();
      await flushMicrotasks();
      expect(
        h.sentRpcs.filter((r) => r.action === "close_drawer"),
      ).toHaveLength(1);
      expect(
        h.tabRoot
          .querySelector('[data-gg-nav="advanced"]')!
          .classList.contains("is-active"),
      ).toBe(true);

      // While streaming guided_scene, clicking toolbar button aborts the run
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: {
          runId: "scene-run-7",
          actionId: "guided_scene",
          chatId: "chat-a",
          startedAt: Date.now(),
        },
      });
      await flushMicrotasks();

      expect(sceneBtn.classList.contains("is-running")).toBe(true);
      sceneBtn.click();
      await flushMicrotasks();
      const abortRpcs = h.sentRpcs.filter((r) => r.action === "abort_action");
      expect(abortRpcs).toHaveLength(1);
      expect(abortRpcs[0]!.input).toEqual({ runId: "scene-run-7" });
    } finally {
      teardown();
    }
  });

  test("armed steering shows toolbar accent & hold quick menu without disabling other Guided buttons, and syncs sticky armed banner", async () => {
    const h = createSceneHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const armed = makeArmedScene();
      h.emitFromBackend({
        type: "gg:scene-updated",
        chatId: "chat-a",
        armedScene: armed,
        reason: "armed",
      });
      await flushMicrotasks();

      const sceneBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_scene"]',
      )!;
      const responseBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_response"]',
      )!;
      const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_continue"]',
      )!;

      expect(sceneBtn.classList.contains("is-armed")).toBe(true);
      expect(sceneBtn.classList.contains("is-paused")).toBe(false);
      expect(responseBtn.disabled).toBe(false);
      expect(continueBtn.disabled).toBe(false);

      // Ctrl+Click opens armed quick menu with all 4 controls
      sceneBtn.dispatchEvent(
        new (document.defaultView!.MouseEvent)("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      );
      await flushMicrotasks();

      const menuItems = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '.gg-dropup-menu [role="menuitem"]',
        ),
      );
      expect(menuItems.map((el) => el.textContent?.trim())).toEqual([
        "Drop Next Turn",
        "Drop Now",
        "Pause Steering",
        "Cancel Steering",
      ]);

      // Trigger Pause Steering from quick menu
      menuItems[2]!.click();
      await flushMicrotasks();
      const pauseReq = h.resolveLastRpc(
        { armedScene: { ...armed, status: "paused" } },
        "pause_scene",
      );
      expect(pauseReq.input).toEqual({ chatId: "chat-a" });
      await flushMicrotasks();

      expect(sceneBtn.classList.contains("is-armed")).toBe(true);
      expect(sceneBtn.classList.contains("is-paused")).toBe(true);

      // Open Advanced -> Guided Scene and verify sticky armed banner
      h.tabRoot
        .querySelector<HTMLButtonElement>('[data-gg-nav="advanced"]')!
        .click();
      await flushMicrotasks();
      h.resolveLastRpc(
        makeSceneContext({ armedScene: { ...armed, status: "paused" } }),
        "get_scene_context",
      );
      await flushMicrotasks();

      const banner = h.tabRoot.querySelector<HTMLElement>(".gg-armed-banner")!;
      expect(banner.style.display).not.toBe("none");
      expect(banner.classList.contains("is-paused")).toBe(true);
      expect(banner.textContent).toContain("Paused");
      expect(banner.textContent).toContain("Greeting #2 — Rooftop Rain");

      // Resume from banner
      banner
        .querySelector<HTMLButtonElement>(
          '[data-gg-scene-banner="toggle-pause"]',
        )!
        .click();
      await flushMicrotasks();
      h.resolveLastRpc({ armedScene: armed }, "resume_scene");
      await flushMicrotasks();
      expect(banner.classList.contains("is-paused")).toBe(false);

      // Cancel from banner clears armed state & hides banner
      banner
        .querySelector<HTMLButtonElement>('[data-gg-scene-banner="cancel"]')!
        .click();
      await flushMicrotasks();
      h.resolveLastRpc({ cancelled: true }, "cancel_scene");
      await flushMicrotasks();
      expect(banner.style.display).toBe("none");
      expect(sceneBtn.classList.contains("is-armed")).toBe(false);
    } finally {
      teardown();
    }
  });

  test("Staging Preview corner .gg-ta-expand-btn opens ctx.ui.showModal with cursor restoration, live bidirectional sync, extra actions, compact dropdowns, and Custom", async () => {
    const h = createSceneHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    let previewTracked!: TrackedTextArea;
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // Open Advanced -> Guided Scene
      h.tabRoot
        .querySelector<HTMLButtonElement>('[data-gg-nav="advanced"]')!
        .click();
      await flushMicrotasks();
      h.resolveLastRpc(
        makeSceneContext({
          isGroup: true,
          members: [
            { id: "char-1", name: "Lyra" },
            { id: "char-2", name: "Kael" },
          ],
          canSwipeLastAssistant: false,
        }),
        "get_scene_context",
      );
      await flushMicrotasks();

      previewTracked = h.textAreaControls.get("Scene staging preview")!;
      expect(previewTracked).toBeDefined();
      expect(previewTracked.initialOptions.rows).toBe(5);
      expect(previewTracked.initialOptions.className).toBe("gg-scene-preview-ta");

      // Corner expand button sits inside .gg-expandable-ta
      const previewSlot = h.tabRoot.querySelector<HTMLElement>(
        '[data-gg-scene-field="preview-slot"]',
      )!;
      const expandBtn = previewSlot.querySelector<HTMLButtonElement>(
        ".gg-ta-expand-btn",
      )!;
      expect(expandBtn).not.toBeNull();
      expect(expandBtn.getAttribute("aria-label")).toBe("Expand Staging Preview");
      expect(expandBtn.title).toBe("Expand Staging Preview");

      // Greeting dropdown ends with Custom, no redundant Custom Scene toggle or Copy button
      expect(h.tabRoot.querySelector("[data-gg-scene-source]")).toBeNull();
      expect(
        h.tabRoot.querySelector('[data-gg-scene-action="copy-card-greeting"]'),
      ).toBeNull();
      expect(
        h.tabRoot.querySelectorAll(".gg-scene-panel .gg-segmented"),
      ).toHaveLength(0);
      const greetingSelect = h.selectControls.get("Scene Greeting")!;
      expect(greetingSelect.options[greetingSelect.options.length - 1]!.value).toBe(
        CUSTOM_GREETING_VALUE,
      );
      expect(greetingSelect.options[greetingSelect.options.length - 1]!.label).toBe(
        "Custom",
      );

      // Selecting Empty (Custom) clears preview & switches to custom source
      const previewTa = previewTracked.textareaEl;
      h.changeSelect("Scene Greeting", CUSTOM_GREETING_VALUE);
      expect(previewTa.value).toBe("");

      // Switch Final Adjustment dropdown to Context Adapt
      h.changeSelect("Scene Final Adjustment", "context_adapt");
      await flushMicrotasks();

      // Type inline text and place cursor at index 5 before clicking corner expand button
      previewTa.focus();
      previewTa.value = "They step through the obsidian archway at dusk.";
      previewTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      previewTa.setSelectionRange(5, 5);
      expandBtn.dispatchEvent(
        new (document.defaultView!.Event)("mousedown", { bubbles: true }),
      );
      expandBtn.click();
      await flushMicrotasks();

      // Opened Lumiverse native modal shell with exact title & size
      expect(h.openedModals).toHaveLength(1);
      expect(h.openedModals[0]!.options).toEqual({
        title: "Staging Preview",
        width: 860,
        maxHeight: 720,
      });

      const modalRoot = h.openedModals[0]!.root;
      const modalTa = modalRoot.querySelector<HTMLTextAreaElement>(
        '[data-gg-expanded-editor="true"]',
      )!;
      expect(modalTa.value).toBe(
        "They step through the obsidian archway at dusk.",
      );
      // Cursor position preserved & focused on expanded modal textarea!
      expect(document.activeElement).toBe(modalTa);
      expect(modalTa.selectionStart).toBe(5);
      expect(
        modalRoot.querySelector('[data-gg-expanded-counts="true"]')!.textContent,
      ).toContain("8 words");

      // Typing inside modal syncs inline textarea live and keeps draftLocked=false
      modalTa.value = "They step quietly through the obsidian archway at dusk.";
      modalTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      expect(previewTa.value).toBe(
        "They step quietly through the obsidian archway at dusk.",
      );
      const statusBadge = h.tabRoot.querySelector<HTMLElement>(
        '[data-gg-scene-status="preview"]',
      )!;
      expect(statusBadge.textContent).toBe("Adapts on drop");

      // Preview Draft extra action inside modal updates both modal & inline textareas
      modalRoot
        .querySelector<HTMLButtonElement>(
          '[data-gg-expanded-action="preview-draft"]',
        )!
        .click();
      await flushMicrotasks();
      h.resolveLastRpc(
        { text: "Adapted obsidian archway scene." },
        "preview_scene_draft",
      );
      await flushMicrotasks();
      expect(modalTa.value).toBe("Adapted obsidian archway scene.");
      expect(previewTa.value).toBe("Adapted obsidian archway scene.");
      expect(statusBadge.textContent).toBe("Locked draft");

      // Unlock dynamic adapt inside modal restores customText in both textareas
      const modalResetBtn = modalRoot.querySelector<HTMLButtonElement>(
        '[data-gg-expanded-action="reset-preview"]',
      )!;
      expect(modalResetBtn.textContent).toBe("Unlock dynamic adapt");
      modalResetBtn.click();
      expect(modalTa.value).toBe(
        "They step quietly through the obsidian archway at dusk.",
      );
      expect(previewTa.value).toBe(
        "They step quietly through the obsidian archway at dusk.",
      );

      // Clicking Done dismisses modal cleanly
      modalRoot
        .querySelector<HTMLButtonElement>('[data-gg-expanded-action="done"]')!
        .click();
      expect(h.openedModals[0]!.dismissed).toBe(true);

      // Re-open modal and verify chat switch dismisses it cleanly
      expandBtn.click();
      await flushMicrotasks();
      expect(h.openedModals).toHaveLength(2);
      expect(h.openedModals[1]!.dismissed).toBe(false);

      h.setActiveChat("chat-b");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
      await flushMicrotasks();
      h.resolveLastRpc(
        makeSceneContext({ chatId: "chat-b" }),
        "get_scene_context",
      );
      await flushMicrotasks();
      expect(h.openedModals[1]!.dismissed).toBe(true);

      // Instant verbatim + Hard Cut drop does not flash streaming indicator
      h.changeSelect("Scene Greeting", CUSTOM_GREETING_VALUE);
      previewTa.value = "Instant cut text.";
      previewTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      h.changeSelect("Scene Delivery", "cut");
      h.changeSelect("Scene Final Adjustment", "verbatim");
      await flushMicrotasks();

      const primaryBtn = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-scene-action="primary"]',
      )!;
      primaryBtn.click();
      await flushMicrotasks();
      const dropReq = h.sentRpcs
        .filter((r) => r.action === "drop_scene_now")
        .pop()!;
      expect((dropReq.input as DropSceneNowInput).delivery).toBe("cut");
      expect(
        h.streamAfterMount.querySelector(".gg-streaming-indicator"),
      ).toBeNull();
    } finally {
      teardown();
    }

    expect(previewTracked.destroyed).toBe(true);
  });

  test("Basic Guidance Template & Guided Scene Prompt Template corner expand buttons open showModal, guard isEditingDrawerInput against background refresh, and flush cleanly on Done", async () => {
    const h = createSceneHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // Open Guided Response Guidance Template expand modal
      const responseTaTracked = h.textAreaControls.get(
        "Guided Response Guidance Template",
      )!;
      const responseWrapper = responseTaTracked.textareaEl.closest(
        ".gg-expandable-ta",
      )!;
      const responseExpandBtn = responseWrapper.querySelector<HTMLButtonElement>(
        ".gg-ta-expand-btn",
      )!;
      responseExpandBtn.click();
      await flushMicrotasks();

      expect(h.openedModals).toHaveLength(1);
      expect(h.openedModals[0]!.options).toEqual({
        title: "Guided Response — Guidance Template",
        width: 860,
        maxHeight: 720,
      });

      const modalRoot = h.openedModals[0]!.root;
      const modalTa = modalRoot.querySelector<HTMLTextAreaElement>(
        '[data-gg-expanded-editor="true"]',
      )!;

      // Background gg:changed refresh with a new preset arrives while modal is open -> must NOT tear down drawer/modal!
      h.emitFromBackend({ type: "gg:changed" });
      h.resolveLastRpc(
        makeBootstrapView({
          presets: [
            { id: "preset-1", name: "Roleplay Preset" },
            { id: "preset-new", name: "Freshly Added Preset" },
          ],
        }),
        "get_bootstrap",
      );
      await flushMicrotasks();
      expect(h.openedModals[0]!.dismissed).toBe(false);
      expect(responseTaTracked.destroyed).toBe(false);

      // Edit inside modal -> syncs inline textarea live
      modalTa.value = "[OOC: {{input}}]";
      modalTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      expect(responseTaTracked.textareaEl.value).toBe("[OOC: {{input}}]");

      // Clicking Done dismisses modal, flushes debounced save, and applies deferred pendingView while preserving edited value
      modalRoot
        .querySelector<HTMLButtonElement>('[data-gg-expanded-action="done"]')!
        .click();
      await flushMicrotasks();
      expect(h.openedModals[0]!.dismissed).toBe(true);

      const saveRpcs = h.sentRpcs.filter((r) => r.action === "save_settings");
      expect(saveRpcs.length).toBeGreaterThanOrEqual(1);
      expect(
        (saveRpcs[saveRpcs.length - 1]!.input as GuidedGenerationsSettings)
          .actions.guided_response.instructionTemplate,
      ).toBe("[OOC: {{input}}]");

      // Also verify Guided Scene Prompt Template corner expand button opens with proper title
      const steeringTaTracked = h.textAreaControls.get(
        "Guided Scene Steering Directive Template",
      )!;
      const steeringExpandBtn = steeringTaTracked.textareaEl
        .closest(".gg-expandable-ta")!
        .querySelector<HTMLButtonElement>(".gg-ta-expand-btn")!;
      steeringExpandBtn.click();
      await flushMicrotasks();
      expect(h.openedModals).toHaveLength(2);
      expect(h.openedModals[1]!.options.title).toBe(
        "Steering Directive Template",
      );
    } finally {
      teardown();
    }

    // Teardown cleanly dismissed the still-open Steering Directive modal
    expect(h.openedModals[1]!.dismissed).toBe(true);
  });

  test("ExpandableTextarea falls back cleanly when host lacks mountTextArea and showModal, cleaning up on teardown", async () => {
    const h = createSceneHarness({
      initialChatId: "chat-a",
      enableMountTextArea: false,
      enableShowModal: false,
    });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      h.tabRoot
        .querySelector<HTMLButtonElement>('[data-gg-nav="advanced"]')!
        .click();
      await flushMicrotasks();
      h.resolveLastRpc(makeSceneContext(), "get_scene_context");
      await flushMicrotasks();

      const previewSlot = h.tabRoot.querySelector<HTMLElement>(
        '[data-gg-scene-field="preview-slot"]',
      )!;
      const fallbackTa = previewSlot.querySelector<HTMLTextAreaElement>(
        "textarea",
      )!;
      expect(fallbackTa.value).toContain("Rain hammers the slate roof");

      previewSlot
        .querySelector<HTMLButtonElement>(".gg-ta-expand-btn")!
        .click();
      await flushMicrotasks();

      const backdrop = document.body.querySelector(".gg-modal-backdrop");
      expect(backdrop).not.toBeNull();
      const modalTa = backdrop!.querySelector<HTMLTextAreaElement>(
        '[data-gg-expanded-editor="true"]',
      )!;
      modalTa.value = "Fallback edited scene text.";
      modalTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      expect(fallbackTa.value).toBe("Fallback edited scene text.");
    } finally {
      teardown();
    }

    expect(document.body.querySelector(".gg-modal-backdrop")).toBeNull();
  });

  test("audit regressions (#56 & #58): syncSettings persistence, cross-chat RPC guard, host showModal Escape dismissal, in-place modal button focus, no-chat preview invalidation, ARIA tablist, and single get_scene_context on toggle", async () => {
    // CSS audit checks (#56 Medium #3, #4, Low #9, #10, #11, #58 High #3)
    expect(GUIDED_GENERATIONS_CSS).toContain("z-index: 5;");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-expandable-ta-slot textarea");
    expect(GUIDED_GENERATIONS_CSS).toContain("padding-right: 34px;");
    expect(GUIDED_GENERATIONS_CSS).toContain("min(560px, calc(70vh - 120px))");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-armed-banner-title > span:last-child");

    const h = createSceneHarness({
      initialChatId: "chat-a",
      detachDrawerTab: true,
      drawerOpenOnTab: false,
    });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // 1. Nit #14: First toolbar toggle fires EXACTLY ONE get_scene_context RPC (no duplicate)
      const sceneBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_scene"]',
      )!;
      sceneBtn.click();
      await flushMicrotasks();
      expect(
        h.sentRpcs.filter((r) => r.action === "get_scene_context"),
      ).toHaveLength(1);
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-a" }), "get_scene_context");
      await flushMicrotasks();

      // 2. Low #8: ARIA tablist/tabpanel linkage & keyboard ArrowLeft/ArrowRight navigation
      const basicTab = h.tabRoot.querySelector<HTMLButtonElement>('[data-gg-nav="basic"]')!;
      const advancedTab = h.tabRoot.querySelector<HTMLButtonElement>('[data-gg-nav="advanced"]')!;
      expect(basicTab.getAttribute("aria-controls")).toBe("gg-nav-panel-basic");
      expect(advancedTab.getAttribute("aria-controls")).toBe("gg-nav-panel-advanced");
      expect(advancedTab.tabIndex).toBe(0);
      expect(basicTab.tabIndex).toBe(-1);

      advancedTab.focus();
      advancedTab.dispatchEvent(
        new (document.defaultView!.KeyboardEvent)("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      );
      expect(basicTab.classList.contains("is-active")).toBe(true);
      expect(document.activeElement).toBe(basicTab);
      expect(basicTab.tabIndex).toBe(0);
      expect(advancedTab.tabIndex).toBe(-1);

      basicTab.dispatchEvent(
        new (document.defaultView!.KeyboardEvent)("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
      expect(advancedTab.classList.contains("is-active")).toBe(true);
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-a" }), "get_scene_context");
      await flushMicrotasks();

      // 3. High #1: Unchecking Keep media intact syncs drawer.currentSettings & scenePanel.settings
      //    so switching chats AND editing another Basic setting both preserve keepMediaIntact=false
      const keepMediaBox = h.tabRoot.querySelector<HTMLInputElement>(
        'input[type="checkbox"][aria-label*="Keep media intact"]',
      )!;
      keepMediaBox.click();
      await flushMicrotasks();
      const save1 = h.sentRpcs.filter((r) => r.action === "save_settings").pop()!;
      h.emitFromBackend({
        type: "gg:reply",
        requestId: save1.requestId,
        result: save1.input,
      });
      await flushMicrotasks();

      // Edit a Basic checkbox -> must NOT overwrite guidedScene.keepMediaIntact back to true!
      const respCheckbox = h.tabRoot.querySelector<HTMLInputElement>(
        'input[type="checkbox"][aria-label="Show Guided Response button on input bar"]',
      )!;
      respCheckbox.click();
      await flushMicrotasks();
      const save2 = h.sentRpcs.filter((r) => r.action === "save_settings").pop()!;
      expect(
        (save2.input as GuidedGenerationsSettings).guidedScene.keepMediaIntact,
      ).toBe(false);

      // Switching to Chat B hydrates keepMediaIntact=false from synced settings
      h.setActiveChat("chat-b");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
      await flushMicrotasks();
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-b" }), "get_scene_context");
      await flushMicrotasks();
      expect(keepMediaBox.checked).toBe(false);

      // 4. High #2: Switching chats while arm_scene is in flight must NOT corrupt the new chat's state
      h.changeSelect("Scene Pacing", "multi_turn");
      await flushMicrotasks();
      const primaryBtn = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-scene-action="primary"]',
      )!;
      primaryBtn.click();
      await flushMicrotasks();
      const armReq = h.sentRpcs.filter((r) => r.action === "arm_scene").pop()!;

      // Switch to Chat C before arm_scene resolves
      h.setActiveChat("chat-c");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-c" });
      await flushMicrotasks();
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-c" }), "get_scene_context");
      await flushMicrotasks();

      // Now resolve Chat B's arm_scene RPC -> Chat C's banner must stay hidden!
      h.emitFromBackend({
        type: "gg:reply",
        requestId: armReq.requestId,
        result: { armedScene: makeArmedScene({ chatId: "chat-b" }) },
      });
      await flushMicrotasks();
      const banner = h.tabRoot.querySelector<HTMLElement>(".gg-armed-banner")!;
      expect(banner.style.display).toBe("none");

      // 5. #58 High #3 & #56 Medium #6: Host showModal supports Escape dismissal AND reconciles modal extra buttons in-place without losing focus
      h.changeSelect("Scene Final Adjustment", "context_adapt");
      await flushMicrotasks();
      const previewSlot = h.tabRoot.querySelector<HTMLElement>(
        '[data-gg-scene-field="preview-slot"]',
      )!;
      previewSlot.querySelector<HTMLButtonElement>(".gg-ta-expand-btn")!.click();
      await flushMicrotasks();

      expect(h.openedModals).toHaveLength(1);
      const modalRoot = h.openedModals[0]!.root;
      const modalPreviewBtnBefore = modalRoot.querySelector<HTMLButtonElement>(
        '[data-gg-expanded-action="preview-draft"]',
      )!;
      modalPreviewBtnBefore.focus();
      const modalTa = modalRoot.querySelector<HTMLTextAreaElement>(
        '[data-gg-expanded-editor="true"]',
      )!;
      modalTa.value = "Updated inside modal";
      modalTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      const modalPreviewBtnAfter = modalRoot.querySelector<HTMLButtonElement>(
        '[data-gg-expanded-action="preview-draft"]',
      )!;
      expect(modalPreviewBtnAfter).toBe(modalPreviewBtnBefore);

      // Escape dismisses host showModal cleanly
      document.dispatchEvent(
        new (document.defaultView!.KeyboardEvent)("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
      expect(h.openedModals[0]!.dismissed).toBe(true);

      // 6. Medium #5: Leaving to no-chat (chatId=null) while Preview Draft is in flight resets previewBusy and ignores late error
      h.tabRoot
        .querySelector<HTMLButtonElement>('[data-gg-scene-action="preview-draft"]')!
        .click();
      await flushMicrotasks();
      const previewReq = h.sentRpcs
        .filter((r) => r.action === "preview_scene_draft")
        .pop()!;

      h.setActiveChat(null);
      h.emitEvent("CHAT_SWITCHED", { chatId: null });
      await flushMicrotasks();

      h.emitFromBackend({
        type: "gg:reply",
        requestId: previewReq.requestId,
        error: "Late preview error from previous chat",
      });
      await flushMicrotasks();
      expect(h.tabRoot.querySelector(".gg-scene-panel .gg-notice.is-error")).toBeNull();

      // 7. Nit #15: Hold menu disables Drop Next Turn when already armed as next_turn & unpaused
      h.setActiveChat("chat-d");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-d" });
      await flushMicrotasks();
      const nextTurnArmed = makeArmedScene({
        chatId: "chat-d",
        pacing: "next_turn",
        status: "armed",
      });
      h.resolveLastRpc(
        makeSceneContext({ chatId: "chat-d", armedScene: nextTurnArmed }),
        "get_scene_context",
      );
      await flushMicrotasks();

      sceneBtn.dispatchEvent(
        new (document.defaultView!.MouseEvent)("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      );
      await flushMicrotasks();
      const dropNextItem = document.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="drop_next_turn"]',
      )!;
      expect(dropNextItem.disabled).toBe(true);

      // 8. Low #12: MESSAGE_SENT refreshes get_scene_context while Scene view is open
      const ctxCountBeforeMsg = h.sentRpcs.filter(
        (r) => r.action === "get_scene_context",
      ).length;
      h.emitEvent("MESSAGE_SENT", { chatId: "chat-d" });
      await flushMicrotasks();
      expect(
        h.sentRpcs.filter((r) => r.action === "get_scene_context").length,
      ).toBe(ctxCountBeforeMsg + 1);
    } finally {
      teardown();
    }
  });

  test("regressions: loadSceneContext stale chat guard & Basic-tab clear, per-chat busy lock, armed banner Drop Now, Cancel Preview abort, and setArmedState pacing sync", async () => {
    const h = createSceneHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // Open Advanced -> Guided Scene on chat-a
      const basicTab = h.tabRoot.querySelector<HTMLButtonElement>('[data-gg-nav="basic"]')!;
      const advancedTab = h.tabRoot.querySelector<HTMLButtonElement>('[data-gg-nav="advanced"]')!;
      advancedTab.click();
      await flushMicrotasks();

      const ctxReqA1 = h.sentRpcs
        .filter((r) => r.action === "get_scene_context")
        .pop()!;

      // 1a. Switch to chat-b while chat-a's get_scene_context is in flight
      h.setActiveChat("chat-b");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
      await flushMicrotasks();

      const ctxReqB1 = h.sentRpcs
        .filter((r) => r.action === "get_scene_context")
        .pop()!;
      h.emitFromBackend({
        type: "gg:reply",
        requestId: ctxReqB1.requestId,
        result: makeSceneContext({
          chatId: "chat-b",
          primaryCharacterName: "Kael",
          greetings: [
            {
              key: "char-2:0",
              id: "g-b0",
              characterId: "char-2",
              characterName: "Kael",
              greetingIndex: 0,
              label: "Greeting #1 — Kael",
              text: "Kael waits by the dock.",
              preview: "Kael waits by the dock.",
              isOpening: false,
              hasMedia: false,
            },
          ],
        }),
      });
      await flushMicrotasks();

      // Now stale chat-a response resolves with an armedScene -> must be ignored!
      h.emitFromBackend({
        type: "gg:reply",
        requestId: ctxReqA1.requestId,
        result: makeSceneContext({
          chatId: "chat-a",
          armedScene: makeArmedScene({ chatId: "chat-a" }),
        }),
      });
      await flushMicrotasks();

      const banner = h.tabRoot.querySelector<HTMLElement>(".gg-armed-banner")!;
      expect(banner.style.display).toBe("none");
      expect(
        h.textAreaControls.get("Scene staging preview")!.textareaEl.value,
      ).toBe("Kael waits by the dock.");

      // 1b. Switch to Basic tab, then switch chat to chat-c -> stale chat-b context is cleared immediately
      basicTab.click();
      await flushMicrotasks();
      h.setActiveChat("chat-c");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-c" });
      await flushMicrotasks();

      // Re-open Guided Scene while chat-c context is still loading -> must show loading empty state, NOT stale chat-b workbench
      advancedTab.click();
      await flushMicrotasks();
      const emptyEl = h.tabRoot.querySelector<HTMLElement>(".gg-scene-empty")!;
      expect(emptyEl.style.display).not.toBe("none");
      expect(emptyEl.textContent).toContain("Loading scene context");

      // Resolve chat-c context
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-c" }), "get_scene_context");
      await flushMicrotasks();

      // 2. Per-chat action busy lock in GuidedScenePanel
      const primaryBtn = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-scene-action="primary"]',
      )!;
      const refreshBtn = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-scene-action="refresh"]',
      )!;
      h.changeSelect("Scene Pacing", "multi_turn");
      await flushMicrotasks();
      primaryBtn.click();
      await flushMicrotasks();

      const armReqC = h.sentRpcs.filter((r) => r.action === "arm_scene").pop()!;
      expect(primaryBtn.disabled).toBe(true);
      expect(refreshBtn.disabled).toBe(true);

      // Switching to chat-d while chat-c's arm_scene is in flight must NOT disable chat-d's buttons
      h.setActiveChat("chat-d");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-d" });
      await flushMicrotasks();
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-d" }), "get_scene_context");
      await flushMicrotasks();
      expect(primaryBtn.disabled).toBe(false);
      expect(refreshBtn.disabled).toBe(false);

      // Switching back to chat-c while arm_scene is STILL in flight keeps chat-c disabled
      h.setActiveChat("chat-c");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-c" });
      await flushMicrotasks();
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-c" }), "get_scene_context");
      await flushMicrotasks();
      expect(primaryBtn.disabled).toBe(true);
      expect(refreshBtn.disabled).toBe(true);

      // Finish chat-c arm_scene
      const armedC = makeArmedScene({
        chatId: "chat-c",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "card",
        selectedGreetingKey: "char-1:1",
        transitionNote: "Armed transition note",
        customDirection: "Armed custom dir",
        draftLocked: true,
        lockedDraftText: "Locked armed draft",
        armedAt: 5000,
      });
      h.emitFromBackend({
        type: "gg:reply",
        requestId: armReqC.requestId,
        result: { armedScene: armedC },
      });
      await flushMicrotasks();
      expect(primaryBtn.disabled).toBe(false);
      expect(refreshBtn.disabled).toBe(false);

      // 3. setArmedState syncs pacing when armedAt is unchanged
      expect(h.selectControls.get("Scene Pacing")!.value).toBe("multi_turn");
      h.emitFromBackend({
        type: "gg:scene-updated",
        chatId: "chat-c",
        armedScene: { ...armedC, pacing: "next_turn" },
      });
      await flushMicrotasks();
      expect(h.selectControls.get("Scene Pacing")!.value).toBe("next_turn");
      expect(
        banner.querySelector<HTMLButtonElement>('[data-gg-scene-banner="drop-next"]')!
          .disabled,
      ).toBe(true);

      // 4. Armed Banner "Drop Now" drops armedScene fields rather than staging form edits
      h.changeSelect("Scene Greeting", CUSTOM_GREETING_VALUE);
      const previewTa = h.textAreaControls.get("Scene staging preview")!.textareaEl;
      previewTa.value = "Completely different staging edit";
      previewTa.dispatchEvent(
        new (document.defaultView!.Event)("input", { bubbles: true }),
      );
      h.changeSelect("Scene Delivery", "cut");
      h.changeSelect("Scene Final Adjustment", "verbatim");
      await flushMicrotasks();

      banner
        .querySelector<HTMLButtonElement>('[data-gg-scene-banner="drop-now"]')!
        .click();
      await flushMicrotasks();

      const dropReq = h.sentRpcs
        .filter((r) => r.action === "drop_scene_now")
        .pop()!;
      expect(dropReq.input).toEqual({
        chatId: "chat-c",
        greetingSource: "card",
        selectedGreetingKey: "char-1:1",
        greetingLabel: armedC.greetingLabel,
        rawGreetingText: armedC.rawGreetingText,
        speakerCharacterId: "char-1",
        speakerCharacterName: "Lyra",
        delivery: "bridge",
        transitionNote: "Armed transition note",
        adjustmentMode: "context_adapt",
        customDirection: "Armed custom dir",
        keepMediaIntact: true,
        draftLocked: true,
        lockedDraftText: "Locked armed draft",
        previewText: "Locked armed draft",
        dropTarget: "new_message",
        activeConnectionId: "conn-1",
      });
      h.emitFromBackend({
        type: "gg:reply",
        requestId: dropReq.requestId,
        result: {
          runId: "drop-1",
          actionId: "guided_scene",
          chatId: "chat-c",
          aborted: false,
          text: "Locked armed draft",
          dropTarget: "new_message",
        },
      });
      await flushMicrotasks();
      h.resolveLastRpc(makeSceneContext({ chatId: "chat-c" }), "get_scene_context");
      await flushMicrotasks();

      // 5. Cancel Preview calls onCancelPreview -> abort_action
      h.changeSelect("Scene Final Adjustment", "context_adapt");
      await flushMicrotasks();
      const previewBtn = h.tabRoot.querySelector<HTMLButtonElement>(
        '[data-gg-scene-action="preview-draft"]',
      )!;
      previewBtn.click();
      await flushMicrotasks();
      expect(previewBtn.textContent).toContain("Cancel Preview");

      previewBtn.click();
      await flushMicrotasks();
      const abortPreviewReq = h.sentRpcs
        .filter((r) => r.action === "abort_action")
        .pop()!;
      expect(abortPreviewReq.input).toEqual({ chatId: "chat-c" });
      expect(previewBtn.textContent).toBe("Preview Draft");
    } finally {
      teardown();
    }
  });
});
