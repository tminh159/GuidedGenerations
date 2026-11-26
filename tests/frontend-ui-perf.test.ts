import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  CONTINUE_MENU_ICONS,
  DRAWER_TAB_ICON_SVG,
  RECOVERY_MENU_ICONS,
  STOP_ICON_SVG,
  TOOLBAR_ICONS,
} from "../src/frontend/icons";
import { InputToolbarController } from "../src/frontend/input-toolbar";
import {
  SettingsDrawerController,
  findElementByAttribute,
} from "../src/frontend/settings-drawer";
import { createDefaultSettings } from "../src/shared/defaults";
import type {
  ExtensionBootstrapView,
  GuidedActionId,
  RecoveryEntry,
} from "../src/shared/types";

describe("Phase 4 frontend UI & icon performance optimizations", () => {
  let dom: JSDOM | null = null;
  let previousDocument: Document | undefined;

  beforeEach(() => {
    previousDocument = (globalThis as unknown as { document?: Document }).document;
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    (globalThis as unknown as { document: Document }).document = dom.window.document;
  });

  afterEach(() => {
    if (previousDocument === undefined) {
      delete (globalThis as unknown as { document?: Document }).document;
    } else {
      (globalThis as unknown as { document: Document }).document = previousDocument;
    }
    dom?.window.close();
    dom = null;
  });

  function createMinimalDrawerCtx(tabRoot: HTMLElement): SpindleFrontendContext {
    const resolveTarget = (target: string | Element) =>
      typeof target === "string" ? document.querySelector(target)! : target;
    return {
      connections: {
        getActive: () => ({ activeProfileId: "c1", provider: "openai", model: "gpt-4o" }),
      },
      ui: {
        registerDrawerTab: () => ({
          root: tabRoot,
          tabId: "guided_generations:tab:settings",
          setTitle: () => {},
          setShortName: () => {},
          setBadge: () => {},
          activate: () => {},
          destroy: () => {},
          onActivate: () => () => {},
        }),
      },
      components: {
        mountSwitch: (target: string | Element) => ({
          componentId: "sw",
          element: resolveTarget(target) as HTMLElement,
          update: () => {},
          destroy: () => {},
          getValue: () => true,
        }),
        mountSelect: (target: string | Element) => ({
          componentId: "sel",
          element: resolveTarget(target) as HTMLElement,
          update: () => {},
          destroy: () => {},
          getValue: () => "",
        }),
        mountModelCombobox: (target: string | Element) => ({
          componentId: "mc",
          element: resolveTarget(target) as HTMLElement,
          update: () => {},
          destroy: () => {},
          getValue: () => "",
          refresh: () => {},
        }),
        mountTextArea: (target: string | Element) => ({
          componentId: "ta",
          element: resolveTarget(target) as HTMLElement,
          update: () => {},
          destroy: () => {},
          getValue: () => "",
        }),
      },
    } as unknown as SpindleFrontendContext;
  }

  function makeBootstrapView(recovery: RecoveryEntry[]): ExtensionBootstrapView {
    return {
      settings: createDefaultSettings(),
      connections: [
        { id: "c1", name: "Main", provider: "openai", model: "gpt-4o", isDefault: true },
      ],
      presets: [{ id: "p1", name: "Default Preset" }],
      recovery,
      activeRun: null,
      permissions: {
        generation: true,
        chats: true,
        chat_mutation: true,
        presets: true,
        regex_scripts: true,
        interceptor: true,
      },
    };
  }

  test("SettingsDrawerController uses delegated recovery clicks, skips no-op list rebuilds, and reuses list container", () => {
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);

    const restored: RecoveryEntry[] = [];
    const drawer = new SettingsDrawerController(createMinimalDrawerCtx(tabRoot), {
      onRefresh: () => {},
      onSaveSettings: async () => {},
      onRestoreEntry: (entry) => restored.push(entry),
      onClearRecovery: async () => {},
    });

    const entryA: RecoveryEntry = {
      id: "r-a",
      text: "First saved draft",
      actionId: "guided_response",
      chatId: "chat-1",
      createdAt: 100,
    };
    const entryB: RecoveryEntry = {
      id: "r-b",
      text: "Second saved draft",
      actionId: "guided_swipe",
      chatId: "chat-1",
      createdAt: 200,
    };

    try {
      drawer.render(makeBootstrapView([entryA, entryB]));

      const listEl = tabRoot.querySelector<HTMLDivElement>(".gg-recovery-list")!;
      expect(listEl).not.toBeNull();
      const firstButtons = Array.from(listEl.querySelectorAll<HTMLButtonElement>("button"));
      expect(firstButtons).toHaveLength(2);

      // Delegated click dispatches the exact entry
      firstButtons[1]!.click();
      firstButtons[0]!.click();
      expect(restored).toEqual([entryB, entryA]);
      restored.length = 0;

      // Disabled during busy state ignores delegated clicks
      drawer.setRecoveryBusy(true);
      firstButtons[0]!.click();
      expect(restored).toEqual([]);
      drawer.setRecoveryBusy(false);

      // Identical entries (cloned objects) short-circuit DOM rebuild completely
      drawer.updateRecovery([{ ...entryA }, { ...entryB }]);
      const afterNoopList = tabRoot.querySelector<HTMLDivElement>(".gg-recovery-list")!;
      const afterNoopButtons = Array.from(
        afterNoopList.querySelectorAll<HTMLButtonElement>("button"),
      );
      expect(afterNoopList).toBe(listEl);
      expect(afterNoopButtons[0]).toBe(firstButtons[0]);
      expect(afterNoopButtons[1]).toBe(firstButtons[1]);

      // Updating with new entries reuses the same list container and delegated listener
      const entryC: RecoveryEntry = {
        id: "r-c",
        text: "Third saved draft",
        actionId: "guided_continue",
        chatId: "chat-1",
        createdAt: 300,
      };
      drawer.updateRecovery([entryC]);
      const reusedList = tabRoot.querySelector<HTMLDivElement>(".gg-recovery-list")!;
      expect(reusedList).toBe(listEl);
      const updatedButtons = Array.from(reusedList.querySelectorAll<HTMLButtonElement>("button"));
      expect(updatedButtons).toHaveLength(1);
      updatedButtons[0]!.click();
      expect(restored).toEqual([entryC]);

      // Empty recovery removes the list container cleanly
      drawer.updateRecovery([]);
      expect(tabRoot.querySelector(".gg-recovery-list")).toBeNull();
    } finally {
      drawer.destroy();
      tabRoot.remove();
    }
  });

  test("findElementByAttribute uses direct attribute selector without wildcard querySelectorAll('*')", () => {
    const root = document.createElement("div");
    const btn1 = document.createElement("button");
    btn1.setAttribute("data-gg-focus-key", "card-header:guided_response");
    const btn2 = document.createElement("button");
    btn2.setAttribute("aria-label", 'Quote "test" \\ [123]');
    const span = document.createElement("span");
    span.setAttribute("aria-label", 'Quote "test" \\ [123]');
    root.append(btn1, span, btn2);
    document.body.append(root);

    const origQsa = root.querySelectorAll.bind(root);
    const wildcardCalls: string[] = [];
    root.querySelectorAll = ((selector: string) => {
      if (selector === "*") wildcardCalls.push(selector);
      return origQsa(selector);
    }) as typeof root.querySelectorAll;

    try {
      expect(findElementByAttribute(root, "data-gg-focus-key", "card-header:guided_response")).toBe(
        btn1,
      );
      expect(findElementByAttribute(root, "aria-label", 'Quote "test" \\ [123]', "BUTTON")).toBe(
        btn2,
      );
      expect(findElementByAttribute(root, "aria-label", 'Quote "test" \\ [123]', "SPAN")).toBe(
        span,
      );
      expect(findElementByAttribute(root, "data-gg-focus-key", "nonexistent")).toBeNull();
      expect(wildcardCalls).toEqual([]);

      // Also verify fallback path when CSS.escape is unavailable
      const origCss = (globalThis as unknown as { CSS?: typeof CSS }).CSS;
      (globalThis as unknown as { CSS?: typeof CSS }).CSS = undefined;
      try {
        expect(findElementByAttribute(root, "aria-label", 'Quote "test" \\ [123]', "BUTTON")).toBe(
          btn2,
        );
        expect(wildcardCalls).toEqual([]);
      } finally {
        (globalThis as unknown as { CSS?: typeof CSS }).CSS = origCss;
      }
    } finally {
      root.remove();
    }
  });

  test("InputToolbarController updates buttons in-place without DOM teardown or unnecessary SVG re-parsing", () => {
    const actionsMount = document.createElement("span");
    document.body.append(actionsMount);

    const triggered: GuidedActionId[] = [];
    const aborted: string[] = [];
    let restored = 0;

    const toolbar = new InputToolbarController(
      { ui: { mount: () => actionsMount } } as unknown as SpindleFrontendContext,
      {
        onTriggerAction: (id) => triggered.push(id),
        onAbortAction: (runId) => aborted.push(runId),
        onRestoreLatest: () => {
          restored += 1;
        },
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      },
    );

    const settings = createDefaultSettings();
    try {
      toolbar.render({
        settings,
        activeRun: null,
        recovery: [],
        hasActiveChat: true,
      });

      const initialButtons = Array.from(actionsMount.querySelectorAll<HTMLButtonElement>("button"));
      expect(initialButtons).toHaveLength(7);
      const initialSvgs = initialButtons.map((b) => b.querySelector("svg"));

      // Transition to activeRun on guided_response -> same button nodes, untouched SVGs on other buttons
      toolbar.render({
        settings,
        activeRun: {
          runId: "run-42",
          actionId: "guided_response",
          chatId: "chat-1",
          startedAt: 100,
        },
        recovery: [],
        hasActiveChat: true,
      });

      const runningButtons = Array.from(actionsMount.querySelectorAll<HTMLButtonElement>("button"));
      expect(runningButtons).toHaveLength(7);
      for (let i = 0; i < 7; i += 1) {
        expect(runningButtons[i]).toBe(initialButtons[i]);
      }

      const responseIdx = runningButtons.findIndex(
        (b) => b.getAttribute("data-gg-action") === "guided_response",
      );
      const continueIdx = runningButtons.findIndex(
        (b) => b.getAttribute("data-gg-action") === "guided_continue",
      );
      const recoveryIdx = runningButtons.findIndex(
        (b) => b.getAttribute("data-gg-action") === "input_recovery",
      );

      // Running button updated icon & state in-place; non-running buttons preserved exact SVG node
      expect(runningButtons[responseIdx]!.classList.contains("is-running")).toBe(true);
      expect(runningButtons[responseIdx]!.querySelector("svg")).not.toBe(initialSvgs[responseIdx]);
      expect(runningButtons[continueIdx]!.querySelector("svg")).toBe(initialSvgs[continueIdx]);
      expect(runningButtons[recoveryIdx]!.querySelector("svg")).toBe(initialSvgs[recoveryIdx]);
      expect(runningButtons[recoveryIdx]!.disabled).toBe(true);
      expect(runningButtons[recoveryIdx]!.hasAttribute("aria-haspopup")).toBe(false);

      // Single-attached click handler reads live activeRun and aborts
      runningButtons[responseIdx]!.click();
      expect(aborted).toEqual(["run-42"]);

      // Transition back to idle with recovery entry -> still same button nodes & recovery SVG preserved
      toolbar.render({
        settings,
        activeRun: null,
        recovery: [
          {
            id: "rec-1",
            text: "Recovered draft text",
            actionId: "guided_response",
            chatId: "chat-1",
            createdAt: 200,
          },
        ],
        hasActiveChat: true,
      });

      const idleButtons = Array.from(actionsMount.querySelectorAll<HTMLButtonElement>("button"));
      for (let i = 0; i < 7; i += 1) {
        expect(idleButtons[i]).toBe(initialButtons[i]);
      }
      expect(idleButtons[recoveryIdx]!.querySelector("svg")).toBe(initialSvgs[recoveryIdx]);
      expect(idleButtons[recoveryIdx]!.disabled).toBe(false);
      expect(idleButtons[recoveryIdx]!.getAttribute("aria-haspopup")).toBe("menu");
      expect(idleButtons[recoveryIdx]!.title).toContain("Recovered draft text");

      idleButtons[responseIdx]!.click();
      idleButtons[recoveryIdx]!.click();
      expect(triggered).toEqual(["guided_response"]);
      expect(restored).toBe(1);
    } finally {
      toolbar.destroy();
      actionsMount.remove();
    }
  });

  test("InputToolbarController registers passive capture scroll listener and RAF-throttles menu resize repositioning", () => {
    const actionsMount = document.createElement("span");
    document.body.append(actionsMount);

    const win = document.defaultView!;
    const origAddDocListener = document.addEventListener.bind(document);
    const scrollListenerOpts: Array<boolean | AddEventListenerOptions | undefined> = [];
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "scroll") {
        scrollListenerOpts.push(options);
      }
      return origAddDocListener(type, listener, options);
    }) as typeof document.addEventListener;

    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const rafQueue = new Map<number, FrameRequestCallback>();
    const cancelledRafs: number[] = [];
    let nextRafId = 1;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
      (cb: FrameRequestCallback) => {
        const id = nextRafId++;
        rafQueue.set(id, cb);
        return id;
      };
    (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
      (id: number) => {
        cancelledRafs.push(id);
        rafQueue.delete(id);
      };

    const toolbar = new InputToolbarController(
      { ui: { mount: () => actionsMount } } as unknown as SpindleFrontendContext,
      {
        onTriggerAction: () => {},
        onAbortAction: () => {},
        onRestoreLatest: () => {},
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      },
    );

    try {
      toolbar.render({
        settings: createDefaultSettings(),
        activeRun: null,
        recovery: [],
        hasActiveChat: true,
      });

      const continueBtn = actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_continue"]',
      )!;
      let rectCalls = 0;
      let anchorTop = 600;
      continueBtn.getBoundingClientRect = () => {
        rectCalls += 1;
        return {
          top: anchorTop,
          bottom: anchorTop + 26,
          left: 100,
          right: 130,
          width: 30,
          height: 26,
          x: 100,
          y: anchorTop,
          toJSON: () => ({}),
        } as DOMRect;
      };

      Object.defineProperty(win, "innerHeight", { configurable: true, value: 800 });
      continueBtn.dispatchEvent(
        new win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );

      // Single passive + capture scroll listener on document
      expect(scrollListenerOpts).toEqual([{ capture: true, passive: true }]);
      expect(rectCalls).toBe(1);

      // Burst of 3 resize events coalesces into a single requestAnimationFrame
      Object.defineProperty(win, "innerHeight", { configurable: true, value: 780 });
      win.dispatchEvent(new win.Event("resize"));
      Object.defineProperty(win, "innerHeight", { configurable: true, value: 760 });
      win.dispatchEvent(new win.Event("resize"));
      anchorTop = 500;
      Object.defineProperty(win, "innerHeight", { configurable: true, value: 700 });
      win.dispatchEvent(new win.Event("resize"));

      expect(rafQueue.size).toBe(1);
      expect(rectCalls).toBe(1);

      // Flush RAF -> repositions once using the latest viewport & anchor coordinates
      const [[rafId, rafCb]] = Array.from(rafQueue.entries());
      rafQueue.delete(rafId);
      rafCb(16);
      expect(rectCalls).toBe(2);
      const menuEl = document.body.querySelector<HTMLDivElement>(".gg-dropup-menu")!;
      expect(menuEl.style.bottom).toBe("206px"); // (700 - 500) + 6

      // Pending RAF is cancelled on destroy()
      Object.defineProperty(win, "innerHeight", { configurable: true, value: 650 });
      win.dispatchEvent(new win.Event("resize"));
      expect(rafQueue.size).toBe(1);
      toolbar.destroy();
      expect(cancelledRafs).toHaveLength(1);
      expect(rafQueue.size).toBe(0);
    } finally {
      document.addEventListener = origAddDocListener;
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
        origRaf;
      (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
        origCancelRaf;
      toolbar.destroy();
      actionsMount.remove();
    }
  });

  test("icons.ts deduplicates refresh SVG and preserves exact SVG wrapper attributes", () => {
    expect(TOOLBAR_ICONS.guided_regenerate).toBe(CONTINUE_MENU_ICONS.regenerate_last_continue);
    expect(DRAWER_TAB_ICON_SVG).toContain(
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
    );
    expect(STOP_ICON_SVG).toBe(
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    );

    const expectedPrefix =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">';
    for (const svg of [
      ...Object.values(TOOLBAR_ICONS),
      ...Object.values(CONTINUE_MENU_ICONS),
      ...Object.values(RECOVERY_MENU_ICONS),
    ]) {
      expect(svg.startsWith(expectedPrefix)).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });
});
