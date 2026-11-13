import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { setup } from "../src/frontend";
import { InputToolbarController } from "../src/frontend/input-toolbar";
import { SettingsDrawerController } from "../src/frontend/settings-drawer";
import { GUIDED_GENERATIONS_CSS } from "../src/frontend/styles";
import { createDefaultSettings } from "../src/shared/defaults";
import type {
  ExtensionBootstrapView,
  GuidedGenerationsSettings,
  RecoveryEntry,
  RpcRequestEnvelope,
} from "../src/shared/types";

interface HarnessOptions {
  initialChatId?: string | null;
  composerMounted?: boolean;
  composerText?: string;
  throwOnComposerWrite?: boolean;
}

function makeBootstrapView(
  overrides: Partial<ExtensionBootstrapView> = {},
): ExtensionBootstrapView {
  return {
    settings: createDefaultSettings(),
    connections: [
      { id: "c1", name: "Main", provider: "openai", model: "gpt-4o", isDefault: true },
    ],
    presets: [{ id: "p1", name: "Default" }],
    recovery: [],
    activeRun: null,
    permissions: {
      generation: true,
      chats: true,
      chat_mutation: true,
      presets: true,
    },
    ...overrides,
  };
}

function createFrontendHarness(opts: HarnessOptions = {}) {
  let activeChatId: string | null =
    opts.initialChatId === undefined ? "chat-a" : opts.initialChatId;
  let composerMounted = opts.composerMounted ?? true;
  let composerChatId: string | null = composerMounted ? activeChatId : null;
  let composerText = opts.composerText ?? "";
  let throwOnComposerWrite = opts.throwOnComposerWrite ?? false;

  const actionsMount = document.createElement("div");
  const toolbarRowMount = document.createElement("div");
  const alertMount = document.createElement("div");
  const tabRoot = document.createElement("div");
  document.body.append(actionsMount, toolbarRowMount, alertMount, tabRoot);

  const sentRpcs: RpcRequestEnvelope[] = [];
  const backendListeners = new Set<(payload: unknown) => void>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const stateListeners = new Map<string, Set<(payload: unknown) => void>>();
  const activateHandlers = new Set<() => void>();

  let mountedTextAreaDestroyCount = 0;
  let mountedComboboxDestroyCount = 0;
  let lastTextAreaOnChange: ((val: string) => void) | undefined;
  let lastComboboxOnChange: ((val: string) => void) | undefined;
  let focusCalls = 0;
  const setTextCalls: string[] = [];

  const ctx = {
    dom: {
      addStyle: () => () => {},
    },
    ui: {
      mount: (point: string) => {
        if (point === "chat_actions") return actionsMount;
        if (point === "chat_toolbar") return toolbarRowMount;
        if (point === "chat_composer_above") return alertMount;
        return document.createElement("div");
      },
      registerDrawerTab: () => ({
        root: tabRoot,
        tabId: "guided_generations:tab:settings",
        setTitle: () => {},
        setShortName: () => {},
        setBadge: () => {},
        activate: () => {},
        destroy: () => {},
        onActivate: (h: () => void) => {
          activateHandlers.add(h);
          return () => activateHandlers.delete(h);
        },
      }),
    },
    components: {
      mountSwitch: (
        target: string | Element,
        options: { checked?: boolean; ariaLabel?: string; onChange?: (v: boolean) => void },
      ) => {
        const el = typeof target === "string" ? document.querySelector(target)! : target;
        const btn = document.createElement("button");
        btn.setAttribute("role", "switch");
        if (options.ariaLabel) btn.setAttribute("aria-label", options.ariaLabel);
        let checked = Boolean(options.checked);
        btn.setAttribute("aria-checked", String(checked));
        btn.addEventListener("click", () => {
          checked = !checked;
          btn.setAttribute("aria-checked", String(checked));
          options.onChange?.(checked);
        });
        el.append(btn);
        return {
          componentId: "sw",
          element: el as HTMLElement,
          update: () => {},
          destroy: () => el.replaceChildren(),
          getValue: () => checked,
        };
      },
      mountSelect: (
        target: string | Element,
        options: { ariaLabel?: string; onChange?: (v: string) => void },
      ) => {
        const el = typeof target === "string" ? document.querySelector(target)! : target;
        const sel = document.createElement("select");
        if (options.ariaLabel) sel.setAttribute("aria-label", options.ariaLabel);
        el.append(sel);
        return {
          componentId: "sel",
          element: el as HTMLElement,
          update: () => {},
          destroy: () => el.replaceChildren(),
          getValue: () => "",
        };
      },
      mountModelCombobox: (
        target: string | Element,
        options: { value?: string; onChange?: (v: string) => void },
      ) => {
        const el = typeof target === "string" ? document.querySelector(target)! : target;
        const input = document.createElement("input");
        input.value = options.value ?? "";
        lastComboboxOnChange = options.onChange;
        el.append(input);
        return {
          componentId: "mc",
          element: el as HTMLElement,
          update: () => {},
          destroy: () => {
            mountedComboboxDestroyCount += 1;
            el.replaceChildren();
          },
          getValue: () => input.value,
          refresh: () => {},
        };
      },
      mountTextArea: (
        target: string | Element,
        options: { value?: string; ariaLabel?: string; onChange?: (v: string) => void },
      ) => {
        const el = typeof target === "string" ? document.querySelector(target)! : target;
        const ta = document.createElement("textarea");
        ta.value = options.value ?? "";
        if (options.ariaLabel) ta.setAttribute("aria-label", options.ariaLabel);
        lastTextAreaOnChange = options.onChange;
        el.append(ta);
        return {
          componentId: "ta",
          element: el as HTMLElement,
          update: () => {},
          destroy: () => {
            mountedTextAreaDestroyCount += 1;
            el.replaceChildren();
          },
          getValue: () => ta.value,
          focus: () => ta.focus(),
          blur: () => ta.blur(),
        };
      },
    },
    connections: {
      list: () => [],
      getActive: () => ({ activeProfileId: "c1", provider: "openai", model: "gpt-4o" }),
      subscribe: () => () => {},
    },
    events: {
      on: (event: string, handler: (payload: unknown) => void) => {
        let set = eventListeners.get(event);
        if (!set) {
          set = new Set();
          eventListeners.set(event, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
      emit: () => {},
    },
    state: {
      subscribe: (key: string, handler: (payload: unknown) => void) => {
        let set = stateListeners.get(key);
        if (!set) {
          set = new Set();
          stateListeners.set(key, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    },
    getActiveChat: () => ({ chatId: activeChatId, characterId: "char-1" }),
    composer: {
      getState: () => ({
        mounted: composerMounted,
        chatId: composerChatId,
        text: composerText,
      }),
      setText: (text: string) => {
        if (!composerMounted || throwOnComposerWrite) {
          throw new Error("COMPOSER_UNAVAILABLE");
        }
        composerText = text;
        setTextCalls.push(text);
      },
      focus: () => {
        if (!composerMounted || throwOnComposerWrite) {
          throw new Error("COMPOSER_UNAVAILABLE");
        }
        focusCalls += 1;
      },
    },
    ready: () => {},
    sendToBackend: (payload: unknown) => {
      sentRpcs.push(payload as RpcRequestEnvelope);
    },
    onBackendMessage: (handler: (payload: unknown) => void) => {
      backendListeners.add(handler);
      return () => backendListeners.delete(handler);
    },
  } as unknown as SpindleFrontendContext;

  function emitFromBackend(payload: unknown): void {
    for (const handler of backendListeners) {
      handler(payload);
    }
  }

  function resolveLastRpc(result: unknown, action?: string): RpcRequestEnvelope {
    const req = action
      ? [...sentRpcs].reverse().find((r) => r.action === action)!
      : sentRpcs[sentRpcs.length - 1]!;
    emitFromBackend({ type: "gg:reply", requestId: req.requestId, result });
    return req;
  }

  function rejectRpc(requestId: string, error: string): void {
    emitFromBackend({ type: "gg:reply", requestId, error });
  }

  return {
    ctx,
    actionsMount,
    toolbarRowMount,
    alertMount,
    tabRoot,
    sentRpcs,
    emitFromBackend,
    resolveLastRpc,
    rejectRpc,
    setChat: (chatId: string | null, opts2?: { mounted?: boolean; text?: string }) => {
      activeChatId = chatId;
      if (opts2?.mounted !== undefined) composerMounted = opts2.mounted;
      composerChatId = composerMounted ? chatId : null;
      if (opts2?.text !== undefined) composerText = opts2.text;
    },
    setComposerState: (next: { mounted?: boolean; chatId?: string | null; text?: string; throwOnWrite?: boolean }) => {
      if (next.mounted !== undefined) composerMounted = next.mounted;
      if (next.chatId !== undefined) composerChatId = next.chatId;
      if (next.text !== undefined) composerText = next.text;
      if (next.throwOnWrite !== undefined) throwOnComposerWrite = next.throwOnWrite;
    },
    getComposerText: () => composerText,
    getFocusCalls: () => focusCalls,
    getSetTextCalls: () => setTextCalls,
    getDestroyCounts: () => ({
      textArea: mountedTextAreaDestroyCount,
      combobox: mountedComboboxDestroyCount,
    }),
    triggerLastTextAreaChange: (val: string) => lastTextAreaOnChange?.(val),
    triggerLastComboboxChange: (val: string) => lastComboboxOnChange?.(val),
  };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("frontend orchestration and safety", () => {
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

  test("handles COMPOSER_UNAVAILABLE on triggerAction, rollback, and restore without uncaught throws", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: false,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    // Click Guided Continue while composer is unmounted -> warns instead of throwing
    const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_continue"]',
    )!;
    continueBtn.click();
    await flushMicrotasks();

    expect(h.sentRpcs.filter((r) => r.action === "run_action")).toHaveLength(0);
    expect(h.alertMount.textContent).toContain("Composer is unavailable");

    // Mount composer in chat-a with guidance text, trigger action, then unmount before RPC rejects
    h.setComposerState({ mounted: true, chatId: "chat-a", text: "My draft" });
    continueBtn.click();
    await flushMicrotasks();

    const runReq = h.sentRpcs.find((r) => r.action === "run_action")!;
    expect(runReq).toBeDefined();
    expect(h.getComposerText()).toBe("");

    // Unmount composer before run_action rejects -> must not throw COMPOSER_UNAVAILABLE
    h.setComposerState({ mounted: false, chatId: null, text: "", throwOnWrite: true });
    h.rejectRpc(runReq.requestId, "Backend failure");
    await flushMicrotasks();

    expect(h.alertMount.textContent).toContain("Backend failure");

    // Restore button in drawer when composer is unmounted -> warns safely
    h.emitFromBackend({
      type: "gg:recovery-updated",
      recovery: [
        { id: "r1", text: "Saved text", actionId: "guided_continue", chatId: "chat-a", createdAt: 1 },
      ],
    });
    const restoreBtn = h.tabRoot.querySelector<HTMLButtonElement>(".gg-recovery-item button")!;
    restoreBtn.click();
    expect(h.alertMount.textContent).toContain("Composer is unavailable");

    teardown();
  });

  test("prevents cross-chat input rollback and cross-chat gg:impersonate-chunk overwrites", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "Chat A prompt",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    // Trigger action in chat-a
    const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_continue"]',
    )!;
    continueBtn.click();
    await flushMicrotasks();
    const runReq = h.sentRpcs.find((r) => r.action === "run_action")!;
    expect(h.getComposerText()).toBe("");

    // Switch to chat-b before run_action fails
    h.setChat("chat-b", { mounted: true, text: "" });
    h.rejectRpc(runReq.requestId, "Network error");
    await flushMicrotasks();

    // Chat A's cleared input must NOT be restored into Chat B's empty composer
    expect(h.getComposerText()).toBe("");

    // Impersonate chunk carrying chatId="chat-a" while active chat is "chat-b" must be ignored
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-a",
      text: "Stale impersonation for A",
      done: true,
    });
    expect(h.getComposerText()).toBe("");

    // Matching chatId="chat-b" with mounted composer applies chunk and focuses on done
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-b",
      text: "Hello from B",
      done: true,
    });
    expect(h.getComposerText()).toBe("Hello from B");
    expect(h.getFocusCalls()).toBe(1);

    teardown();
  });

  test("post-destroy async safety prevents composer calls and orphaned notice timers", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "Hello",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_continue"]',
    )!;
    continueBtn.click();
    await flushMicrotasks();

    let composerCalledAfterDestroy = false;
    (h.ctx as unknown as { composer: { getState: () => never } }).composer.getState = () => {
      composerCalledAfterDestroy = true;
      throw new Error("SPINDLE_FRONTEND_INACTIVE");
    };

    teardown();
    await flushMicrotasks();

    expect(composerCalledAfterDestroy).toBe(false);
    expect(h.alertMount.children.length).toBe(0);
  });

  test("enforces synchronous launch lock and skips input rollback on timeout while activeRun is active", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "Guidance",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_continue"]',
    )!;
    // Rapid double-click before gg:status arrives
    continueBtn.click();
    continueBtn.click();
    await flushMicrotasks();

    const runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
    expect(runRpcs).toHaveLength(1);
    expect(h.getComposerText()).toBe("");

    // Backend emits gg:status activeRun, then RPC times out/errors while activeRun is still non-null
    h.emitFromBackend({
      type: "gg:status",
      run: {
        runId: "run-1",
        actionId: "guided_continue",
        chatId: "chat-a",
        startedAt: Date.now(),
      },
    });
    h.rejectRpc(runRpcs[0]!.requestId, "Timed out waiting for run_action.");
    await flushMicrotasks();

    // Must NOT restore cleared input while activeRun is still running
    expect(h.getComposerText()).toBe("");

    teardown();
  });

  test("ignores stale out-of-order save_settings and preserves newer gg:status across get_bootstrap", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    const initialView = makeBootstrapView();
    h.resolveLastRpc(initialView, "get_bootstrap");
    await flushMicrotasks();

    // Toggle first switch (Guided Response enabled -> false) => save #1
    const switches = h.tabRoot.querySelectorAll<HTMLButtonElement>('button[role="switch"]');
    switches[0]!.click();
    await flushMicrotasks();
    const save1 = h.sentRpcs.filter((r) => r.action === "save_settings")[0]!;

    // Toggle second switch (Guided Response clearInputOnRun -> false) => save #2
    switches[1]!.click();
    await flushMicrotasks();
    const save2 = h.sentRpcs.filter((r) => r.action === "save_settings")[1]!;

    const settings1 = save1.input as GuidedGenerationsSettings;
    const settings2 = save2.input as GuidedGenerationsSettings;
    expect(settings2.actions.guided_response.clearInputOnRun).toBe(false);

    // Save #2 resolves first, Save #1 resolves second (out of order!)
    h.emitFromBackend({ type: "gg:reply", requestId: save2.requestId, result: settings2 });
    await flushMicrotasks();
    h.emitFromBackend({ type: "gg:reply", requestId: save1.requestId, result: settings1 });
    await flushMicrotasks();

    // Newer clearInputOnRun=false must be preserved when triggering next save
    switches[0]!.click();
    await flushMicrotasks();
    const save3 = h.sentRpcs.filter((r) => r.action === "save_settings")[2]!;
    expect((save3.input as GuidedGenerationsSettings).actions.guided_response.clearInputOnRun).toBe(
      false,
    );

    // Background refresh starts; while in flight, gg:status sets activeRun
    h.emitFromBackend({ type: "gg:changed" });
    const bootstrapReq = h.sentRpcs[h.sentRpcs.length - 1]!;
    expect(bootstrapReq.action).toBe("get_bootstrap");

    h.emitFromBackend({
      type: "gg:status",
      run: {
        runId: "live-run",
        actionId: "guided_continue",
        chatId: "chat-a",
        startedAt: Date.now(),
      },
    });

    // Resolve stale get_bootstrap with activeRun: null -> must NOT clobber live-run
    h.emitFromBackend({
      type: "gg:reply",
      requestId: bootstrapReq.requestId,
      result: makeBootstrapView({ activeRun: null }),
    });
    await flushMicrotasks();

    const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_continue"]',
    )!;
    expect(continueBtn.classList.contains("is-running")).toBe(true);

    teardown();
  });

  test("updates drawer notice in-place, clears on expiry, and preserves active inputs on gg:changed / recovery updates", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    const initialDestroyCounts = h.getDestroyCounts();

    // Triggering Guided Response with empty composer shows warn banner in-place
    const responseBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_response"]',
    )!;
    responseBtn.click();
    await flushMicrotasks();

    const drawerNotice = h.tabRoot.querySelector<HTMLElement>(".gg-notice");
    expect(drawerNotice?.textContent).toContain("Type guidance");
    expect(drawerNotice?.getAttribute("role")).toBe("alert");
    // Drawer components must NOT have been destroyed/rebuilt
    expect(h.getDestroyCounts()).toEqual(initialDestroyCounts);

    // Unchanged gg:changed refresh must NOT rebuild drawer
    h.emitFromBackend({ type: "gg:changed" });
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();
    expect(h.getDestroyCounts()).toEqual(initialDestroyCounts);

    // gg:recovery-updated updates recovery rows incrementally without rebuilding inputs
    const recEntry: RecoveryEntry = {
      id: "rec-1",
      text: "My recovered draft",
      actionId: "guided_continue",
      chatId: "chat-a",
      createdAt: 100,
    };
    h.emitFromBackend({ type: "gg:recovery-updated", recovery: [recEntry] });
    expect(h.getDestroyCounts()).toEqual(initialDestroyCounts);
    const restoreBtn = h.tabRoot.querySelector<HTMLButtonElement>(".gg-recovery-item button")!;
    expect(restoreBtn.getAttribute("aria-label")).toContain("Guided Continue");
    expect(restoreBtn.getAttribute("aria-label")).toContain("My recovered draft");

    // Focus a textarea inside the drawer; background refresh with different preset must defer rebuild until blur
    const textarea = h.tabRoot.querySelector("textarea")!;
    textarea.focus();
    h.emitFromBackend({ type: "gg:changed" });
    h.resolveLastRpc(
      makeBootstrapView({ presets: [{ id: "p1", name: "Default" }, { id: "p2", name: "New" }] }),
      "get_bootstrap",
    );
    await flushMicrotasks();
    expect(h.getDestroyCounts()).toEqual(initialDestroyCounts);

    // Blur flushes pending render
    textarea.blur();
    textarea.dispatchEvent(new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }));
    await flushMicrotasks();
    expect(h.getDestroyCounts().textArea).toBeGreaterThan(initialDestroyCounts.textArea);

    teardown();
  });

  test("clears drawer notice when ephemeral noticeTimer expires", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "x",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    // Force an error with 5s timer? Let's test via SettingsDrawerController + setTimeout spy or real short timer.
    // Intercept setTimeout for 5000/7000ms to fire fast
    const origSetTimeout = globalThis.setTimeout;
    const scheduledNotices: Array<() => void> = [];
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms && ms >= 5_000) {
        scheduledNotices.push(() => fn(...args));
        return 999 as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;

    try {
      const responseBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_response"]',
      )!;
      h.setComposerState({ text: "" });
      responseBtn.click();
      await flushMicrotasks();

      expect(h.tabRoot.querySelector(".gg-notice")).not.toBeNull();
      expect(h.alertMount.children.length).toBe(1);
      expect(scheduledNotices.length).toBeGreaterThan(0);

      for (const fire of scheduledNotices) fire();
      expect(h.tabRoot.querySelector(".gg-notice")).toBeNull();
      expect(h.alertMount.children.length).toBe(0);
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      teardown();
    }
  });

  test("drawer updates layout visibility tags synchronously, restores focus on reorder, flushes debounces on destroy, and has a11y attributes", async () => {
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);
    const saved: GuidedGenerationsSettings[] = [];

    const fakeCtx = {
      connections: { getActive: () => ({ activeProfileId: "c1" }) },
      ui: {
        registerDrawerTab: () => ({
          root: tabRoot,
          tabId: "t1",
          setTitle: () => {},
          setShortName: () => {},
          setBadge: () => {},
          activate: () => {},
          destroy: () => {},
          onActivate: () => () => {},
        }),
      },
      components: {
        mountSwitch: (target: string | Element, opts: { checked?: boolean; ariaLabel?: string; onChange?: (v: boolean) => void }) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const btn = document.createElement("button");
          btn.setAttribute("role", "switch");
          if (opts.ariaLabel) btn.setAttribute("aria-label", opts.ariaLabel);
          btn.addEventListener("click", () => opts.onChange?.(!opts.checked));
          el.append(btn);
          return { componentId: "s", element: el as HTMLElement, update: () => {}, destroy: () => el.replaceChildren() };
        },
        mountSelect: (target: string | Element) => ({
          componentId: "sel",
          element: (typeof target === "string" ? document.querySelector(target)! : target) as HTMLElement,
          update: () => {},
          destroy: () => {},
        }),
        mountModelCombobox: (target: string | Element, opts: { onChange?: (v: string) => void }) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const input = document.createElement("input");
          input.addEventListener("input", () => opts.onChange?.(input.value));
          el.append(input);
          return {
            componentId: "mc",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => el.replaceChildren(),
            getValue: () => input.value,
            refresh: () => {},
          };
        },
        mountTextArea: (target: string | Element, opts: { onChange?: (v: string) => void }) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const ta = document.createElement("textarea");
          ta.addEventListener("input", () => opts.onChange?.(ta.value));
          el.append(ta);
          return {
            componentId: "ta",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => el.replaceChildren(),
            getValue: () => ta.value,
          };
        },
      },
    } as unknown as SpindleFrontendContext;

    const drawer = new SettingsDrawerController(fakeCtx, {
      onRefresh: () => {},
      onSaveSettings: async (next, opts) => {
        saved.push(next);
        if (opts?.rebuildDrawer) {
          drawer.render(makeBootstrapView({ settings: next }), { force: true });
        }
      },
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    drawer.render(makeBootstrapView());

    // A11y checks: chevrons aria-hidden, card headers aria-controls, <label> for fields
    const chevrons = tabRoot.querySelectorAll(".gg-card-chevron");
    expect(chevrons.length).toBe(7);
    for (const chevron of chevrons) {
      expect(chevron.getAttribute("aria-hidden")).toBe("true");
    }
    const headers = tabRoot.querySelectorAll<HTMLButtonElement>(".gg-card-header");
    for (const header of headers) {
      const controlsId = header.getAttribute("aria-controls");
      expect(controlsId).toBeTruthy();
      expect(tabRoot.querySelector(`#${controlsId}`)).not.toBeNull();
    }
    expect(tabRoot.querySelectorAll("label.gg-field-label").length).toBeGreaterThan(5);

    // Toggling Guided Response switch synchronously updates its Visible/Hidden tag in Toolbar Position & Order
    const orderTag = tabRoot.querySelector<HTMLElement>(
      '[data-gg-order-id="guided_response"] .gg-order-item-state',
    )!;
    expect(orderTag.textContent).toBe("Visible");
    const responseSwitch = tabRoot.querySelector<HTMLButtonElement>(
      'button[aria-label="Show Guided Response button on input bar"]',
    )!;
    responseSwitch.click();
    expect(orderTag.textContent).toBe("Hidden");

    // Reordering moves row and restores focus to the moved row's button
    const moveDownBtn = tabRoot.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Guided Response down"]',
    )!;
    moveDownBtn.focus();
    moveDownBtn.click();
    await flushMicrotasks();

    const movedRowBtn = tabRoot.querySelector<HTMLButtonElement>(
      '[data-gg-order-id="guided_response"] button[data-gg-move="down"]',
    )!;
    expect(document.activeElement).toBe(movedRowBtn);

    // Debounced textarea edit is flushed on destroy() instead of silently dropped
    const firstTextarea = tabRoot.querySelector("textarea")!;
    firstTextarea.value = "Updated template";
    firstTextarea.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));
    const countBeforeDestroy = saved.length;

    drawer.destroy();
    expect(saved.length).toBe(countBeforeDestroy + 1);
    expect(saved[saved.length - 1]!.actions.guided_response.instructionTemplate).toBe(
      "Updated template",
    );
  });

  test("InputToolbarController hides inactive host mounts with display:none, wraps rows in CSS, and supports roving tabindex", () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-actions-host--row .gg-toolbar");
    expect(GUIDED_GENERATIONS_CSS).toContain("flex-wrap: wrap");

    const actionsMount = document.createElement("div");
    const rowMount = document.createElement("div");
    document.body.append(actionsMount, rowMount);

    const fakeCtx = {
      ui: {
        mount: (point: string) => (point === "chat_toolbar" ? rowMount : actionsMount),
      },
    } as unknown as SpindleFrontendContext;

    const toolbar = new InputToolbarController(fakeCtx, {
      onTriggerAction: () => {},
      onAbortAction: () => {},
      onRestoreLatest: () => {},
    });

    const settings = createDefaultSettings();
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });

    const buttons = Array.from(actionsMount.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons[0]!.tabIndex).toBe(0);
    expect(buttons[1]!.tabIndex).toBe(-1);

    buttons[0]!.focus();
    const ToolbarKeyEvent = document.defaultView!.KeyboardEvent;
    buttons[0]!.dispatchEvent(new ToolbarKeyEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]!.tabIndex).toBe(0);
    expect(buttons[0]!.tabIndex).toBe(-1);

    buttons[1]!.dispatchEvent(new ToolbarKeyEvent("keydown", { key: "End", bubbles: true }));
    const lastEnabled = buttons.filter((b) => !b.disabled).pop()!;
    expect(document.activeElement).toBe(lastEnabled);
    expect(lastEnabled.tabIndex).toBe(0);

    // Switching to below_bar sets display:none on actionsMount
    settings.toolbarPlacement = "below_bar";
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(actionsMount.style.display).toBe("none");
    expect(rowMount.style.display).toBe("flex");

    // Switching back to after_native sets display:none on rowMount
    settings.toolbarPlacement = "after_native";
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(rowMount.style.display).toBe("none");
    expect(actionsMount.style.display).toBe("inline-flex");

    toolbar.destroy();
    expect(actionsMount.style.display).toBe("none");
    expect(rowMount.style.display).toBe("none");
  });
});
