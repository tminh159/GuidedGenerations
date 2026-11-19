import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { setup } from "../src/frontend";
import { ChatHeadController } from "../src/frontend/chat-head";
import { InputToolbarController } from "../src/frontend/input-toolbar";
import { PillMetricsController } from "../src/frontend/pill-metrics";
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
  detachDrawerTab?: boolean;
  tabLocation?: { kind: "main-drawer" } | { kind: "container"; containerId: string };
  frontendConnectionsFallback?: Array<{
    id: string;
    name: string;
    provider?: string;
    model?: string;
    is_default?: boolean;
  }>;
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
      regex_scripts: true,
      interceptor: true,
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
  document.body.append(actionsMount, toolbarRowMount, alertMount);
  if (!opts.detachDrawerTab) {
    document.body.append(tabRoot);
  }

  let currentTabLocation:
    | { kind: "main-drawer" }
    | { kind: "container"; containerId: string } = opts.tabLocation ?? {
    kind: "main-drawer",
  };

  const sentRpcs: RpcRequestEnvelope[] = [];
  const backendListeners = new Set<(payload: unknown) => void>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const stateListeners = new Map<string, Set<(payload: unknown) => void>>();
  const connectionSubscribers = new Set<
    (value: {
      activeProfileId: string | null;
      provider: string | null;
      model: string | null;
    }) => void
  >();
  const activateHandlers = new Set<() => void>();
  const messageElements = new Map<string, Element>();
  const injectedWrappers = new Set<Element>();

  let injectCalls = 0;
  let uninjectCalls = 0;
  let mountSwitchCount = 0;
  let mountSelectCount = 0;
  let mountComboboxCount = 0;
  let mountTextAreaCount = 0;
  let connectionsListCalls = 0;
  let mountedTextAreaDestroyCount = 0;
  let mountedComboboxDestroyCount = 0;
  let lastTextAreaOnChange: ((val: string) => void) | undefined;
  let lastComboboxOnChange: ((val: string) => void) | undefined;
  let focusCalls = 0;
  const setTextCalls: string[] = [];
  const chatMessages = new Map<
    string,
    Array<{ id: string; chat_id?: string; swipe_id: number; extra?: Record<string, unknown> }>
  >();
  const getMessagesCalls: Array<{ chatId: string; options?: { limit?: number; tail?: boolean } }> = [];
  const updateMessageCalls: Array<{
    chatId: string;
    messageId: string;
    input: Record<string, unknown>;
  }> = [];
  let customGetMessages:
    | ((chatId: string, options?: { limit?: number; tail?: boolean }) => Promise<unknown>)
    | null = null;
  let customUpdateMessage:
    | ((chatId: string, messageId: string, input: Record<string, unknown>) => Promise<unknown>)
    | null = null;

  const ctx = {
    dom: {
      addStyle: () => () => {},
      findMessageElement: (messageId: string) => messageElements.get(messageId) ?? null,
      inject: (target: string | Element, html: string, position: InsertPosition = "beforeend") => {
        const el = typeof target === "string" ? document.querySelector(target)! : target;
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-spindle-injected", "true");
        wrapper.innerHTML = html;
        el.insertAdjacentElement(position, wrapper);
        injectedWrappers.add(wrapper);
        injectCalls += 1;
        return wrapper;
      },
      uninject: (el: Element) => {
        if (injectedWrappers.delete(el)) {
          uninjectCalls += 1;
        }
        el.remove();
      },
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
      getTabLocation: () => currentTabLocation,
    },
    components: {
      mountSwitch: (
        target: string | Element,
        options: { checked?: boolean; ariaLabel?: string; onChange?: (v: boolean) => void },
      ) => {
        mountSwitchCount += 1;
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
        mountSelectCount += 1;
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
        mountComboboxCount += 1;
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
        mountTextAreaCount += 1;
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
      list: () => {
        connectionsListCalls += 1;
        return opts.frontendConnectionsFallback ?? [];
      },
      getActive: () => ({ activeProfileId: "c1", provider: "openai", model: "gpt-4o" }),
      subscribe: (
        handler: (value: {
          activeProfileId: string | null;
          provider: string | null;
          model: string | null;
        }) => void,
      ) => {
        connectionSubscribers.add(handler);
        return () => connectionSubscribers.delete(handler);
      },
    },
    chats: {
      getMessages: async (chatId: string, options?: { limit?: number; tail?: boolean }) => {
        getMessagesCalls.push({ chatId, options });
        if (customGetMessages) {
          return customGetMessages(chatId, options);
        }
        const rows = chatMessages.get(chatId) ?? [];
        return { data: rows.map((row) => structuredClone(row)), total: rows.length };
      },
      updateMessage: async (
        chatId: string,
        messageId: string,
        input: Record<string, unknown>,
      ) => {
        updateMessageCalls.push({ chatId, messageId, input: structuredClone(input) });
        if (customUpdateMessage) {
          return customUpdateMessage(chatId, messageId, input);
        }
        const rows = chatMessages.get(chatId) ?? [];
        const target = rows.find((m) => m.id === messageId);
        if (target && input.extra && typeof input.extra === "object") {
          target.extra = structuredClone(input.extra as Record<string, unknown>);
        }
        return target ?? { id: messageId };
      },
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
    emitEvent: (event: string, payload: unknown) => {
      for (const handler of eventListeners.get(event) ?? []) {
        handler(payload);
      }
    },
    setMessageElement: (messageId: string, el: Element | null) => {
      if (el) {
        messageElements.set(messageId, el);
      } else {
        messageElements.delete(messageId);
      }
    },
    getInjectCounts: () => ({
      injectCalls,
      uninjectCalls,
      activeInjections: injectedWrappers.size,
    }),
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
    getMountCounts: () => ({
      switch: mountSwitchCount,
      select: mountSelectCount,
      combobox: mountComboboxCount,
      textArea: mountTextAreaCount,
    }),
    getConnectionsListCalls: () => connectionsListCalls,
    activateDrawer: () => {
      for (const handler of activateHandlers) {
        handler();
      }
      if (!tabRoot.isConnected) {
        document.body.append(tabRoot);
      }
    },
    emitConnectionsChange: (
      value: {
        activeProfileId: string | null;
        provider: string | null;
        model: string | null;
      } = { activeProfileId: "c2", provider: "anthropic", model: "claude-sonnet" },
    ) => {
      for (const handler of connectionSubscribers) {
        handler(value);
      }
    },
    emitStateChange: (key: string, payload?: unknown) => {
      for (const handler of stateListeners.get(key) ?? []) {
        handler(payload);
      }
    },
    setTabLocation: (
      loc: { kind: "main-drawer" } | { kind: "container"; containerId: string },
    ) => {
      currentTabLocation = loc;
    },
    triggerLastTextAreaChange: (val: string) => lastTextAreaOnChange?.(val),
    triggerLastComboboxChange: (val: string) => lastComboboxOnChange?.(val),
    setChatMessages: (
      chatId: string,
      messages: Array<{ id: string; chat_id?: string; swipe_id: number; extra?: Record<string, unknown> }>,
    ) => {
      chatMessages.set(chatId, messages);
    },
    getGetMessagesCalls: () => getMessagesCalls,
    getUpdateMessageCalls: () => updateMessageCalls,
    setCustomGetMessages: (
      fn: ((chatId: string, options?: { limit?: number; tail?: boolean }) => Promise<unknown>) | null,
    ) => {
      customGetMessages = fn;
    },
    setCustomUpdateMessage: (
      fn: ((chatId: string, messageId: string, input: Record<string, unknown>) => Promise<unknown>) | null,
    ) => {
      customUpdateMessage = fn;
    },
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
      onRemoveLastContinue: () => {},
      onRegenerateLastContinue: () => {},
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

  test("Input Recovery clears composer without saving to History or showing a banner when history is empty, and restores when saved inputs exist", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "  Draft with formatting  ",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView({ recovery: [] }), "get_bootstrap");
    await flushMicrotasks();

    const getRecoveryBtn = () =>
      h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!;

    expect(getRecoveryBtn().disabled).toBe(false);
    expect(getRecoveryBtn().getAttribute("aria-label")).toBe("Clear current input");

    // Pressing Input Recovery with empty history clears the composer, focuses it,
    // does NOT push to recovery history, and shows NO pop-up banner.
    getRecoveryBtn().click();
    await flushMicrotasks();

    expect(h.getComposerText()).toBe("");
    expect(h.getFocusCalls()).toBe(1);
    expect(h.sentRpcs.filter((r) => r.action === "push_recovery")).toHaveLength(0);
    expect(h.alertMount.children.length).toBe(0);
    expect(h.alertMount.textContent).toBe("");
    expect(h.tabRoot.querySelector(".gg-recovery-item")).toBeNull();
    expect(getRecoveryBtn().getAttribute("aria-label")).toBe("Clear current input");

    // When saved inputs exist, pressing Input Recovery still restores the latest saved entry.
    const savedEntry: RecoveryEntry = {
      id: "rec-1",
      text: "Previously saved draft",
      actionId: "guided_response",
      chatId: "chat-a",
      createdAt: 123,
    };
    h.emitFromBackend({
      type: "gg:recovery-updated",
      recovery: [savedEntry],
    });
    await flushMicrotasks();

    expect(getRecoveryBtn().getAttribute("aria-label")).toBe("Restore last input");
    getRecoveryBtn().click();
    await flushMicrotasks();
    expect(h.getComposerText()).toBe("Previously saved draft");
    expect(h.getFocusCalls()).toBe(2);
    expect(h.sentRpcs.filter((r) => r.action === "push_recovery")).toHaveLength(0);
    expect(h.alertMount.children.length).toBe(0);

    teardown();
  });

  test("Input Recovery with empty history is a quiet no-op when composer is already empty and warns only if composer is unavailable", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView({ recovery: [] }), "get_bootstrap");
    await flushMicrotasks();

    const getRecoveryBtn = () =>
      h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!;

    // Already empty composer -> focuses quietly, no setText call, no push_recovery, no banner.
    getRecoveryBtn().click();
    await flushMicrotasks();
    expect(h.getComposerText()).toBe("");
    expect(h.getFocusCalls()).toBe(1);
    expect(h.getSetTextCalls()).toEqual([]);
    expect(h.sentRpcs.filter((r) => r.action === "push_recovery")).toHaveLength(0);
    expect(h.alertMount.children.length).toBe(0);
    expect(h.alertMount.textContent).toBe("");

    // Whitespace-only input is cleared to "" without saving or showing a banner.
    h.setComposerState({ text: "   \n  " });
    getRecoveryBtn().click();
    await flushMicrotasks();
    expect(h.getComposerText()).toBe("");
    expect(h.getFocusCalls()).toBe(2);
    expect(h.sentRpcs.filter((r) => r.action === "push_recovery")).toHaveLength(0);
    expect(h.alertMount.children.length).toBe(0);

    // Unmounted / unavailable composer -> warns safely without uncaught throws or push_recovery.
    h.setComposerState({ mounted: false, chatId: null, text: "" });
    getRecoveryBtn().click();
    await flushMicrotasks();
    expect(h.sentRpcs.filter((r) => r.action === "push_recovery")).toHaveLength(0);
    expect(h.alertMount.textContent).toContain("Composer is unavailable");

    teardown();
  });

  test("guided_impersonate applies streaming and final regex-processed gg:impersonate-chunk cleanly without cross-chat races", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "ask about the mission",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    const impersonateBtn = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_impersonate"]',
    )!;
    impersonateBtn.click();
    await flushMicrotasks();

    const runReq = h.sentRpcs.find((r) => r.action === "run_action")!;
    expect(runReq).toBeDefined();
    expect(h.getComposerText()).toBe("");

    h.emitFromBackend({
      type: "gg:status",
      run: {
        runId: "imp-1",
        actionId: "guided_impersonate",
        chatId: "chat-a",
        startedAt: Date.now(),
      },
    });

    // Streaming chunk updates composer without stealing focus
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-a",
      text: "*waves* [OOC: keep it brief]",
      done: false,
    });
    expect(h.getComposerText()).toBe("*waves* [OOC: keep it brief]");
    expect(h.getFocusCalls()).toBe(0);

    // Even if composer text changed mid-stream or gg:status cleared activeRun slightly early,
    // the final regex-processed chunk (done: true) replaces composer cleanly and focuses it.
    h.setComposerState({ text: "*waves* [OOC: user edited]" });
    h.emitFromBackend({ type: "gg:status", run: null });
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-a",
      text: "Waves warmly.",
      done: true,
      aborted: false,
    });
    expect(h.getComposerText()).toBe("Waves warmly.");
    expect(h.getFocusCalls()).toBe(1);

    h.emitFromBackend({
      type: "gg:reply",
      requestId: runReq.requestId,
      result: {
        runId: "imp-1",
        actionId: "guided_impersonate",
        chatId: "chat-a",
        aborted: false,
        text: "Waves warmly.",
      },
    });
    await flushMicrotasks();

    // Switching to chat-b rejects late chunks tagged for chat-a
    h.setChat("chat-b", { mounted: true, text: "Chat B draft" });
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-a",
      text: "Late stale chunk",
      done: true,
    });
    expect(h.getComposerText()).toBe("Chat B draft");

    teardown();
  });

  test("preserves fallback In-history depth input focus and debounced save across background gg:changed refresh", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    const initialView = makeBootstrapView();
    initialView.settings.actions.guided_response.guidancePosition = "in_history";
    initialView.settings.actions.guided_response.guidanceDepth = 2;
    h.resolveLastRpc(initialView, "get_bootstrap");
    await flushMicrotasks();

    const depthInput = h.tabRoot.querySelector<HTMLInputElement>(
      'input[aria-label="Guided Response In-history depth"]',
    )!;
    expect(depthInput).not.toBeNull();
    expect(depthInput.disabled).toBe(false);
    expect(depthInput.value).toBe("2");

    depthInput.focus();
    depthInput.value = "7";
    depthInput.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));

    // Background gg:changed triggers get_bootstrap while user is still editing depth
    h.emitFromBackend({ type: "gg:changed" });
    const nextView = makeBootstrapView({
      presets: [{ id: "p1", name: "Default" }, { id: "p2", name: "Extra" }],
    });
    nextView.settings.actions.guided_response.guidancePosition = "in_history";
    nextView.settings.actions.guided_response.guidanceDepth = 2;
    h.resolveLastRpc(nextView, "get_bootstrap");
    await flushMicrotasks();

    // Depth input element stays intact & focused, and blurring commits normalized depth = 7
    expect(document.activeElement).toBe(depthInput);
    depthInput.blur();
    depthInput.dispatchEvent(new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }));
    await flushMicrotasks();

    const saveReq = h.sentRpcs.find((r) => r.action === "save_settings");
    expect(saveReq).toBeDefined();
    expect((saveReq!.input as GuidedGenerationsSettings).actions.guided_response.guidanceDepth).toBe(
      7,
    );

    teardown();
  });

  test("guided_swipe click, Ctrl/Cmd+Click, and click-and-hold wire backgroundSwipe into run_action RPC without double-triggering or aborting", async () => {
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const pendingHoldTimers = new Map<number, () => void>();
    let nextTimerId = 95_000;

    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 450) {
        const id = ++nextTimerId;
        pendingHoldTimers.set(id, () => fn(...args));
        return id as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;

    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      const num = Number(id);
      if (pendingHoldTimers.has(num)) {
        pendingHoldTimers.delete(num);
        return;
      }
      origClearTimeout(id);
    }) as typeof clearTimeout;

    const fireHoldTimers = () => {
      for (const [id, fn] of [...pendingHoldTimers.entries()]) {
        if (!pendingHoldTimers.has(id)) continue;
        pendingHoldTimers.delete(id);
        fn();
      }
    };

    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "Keep tension high",
    });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const Win = document.defaultView!;
      const PointerEvt = Win.PointerEvent;
      const MouseEvt = Win.MouseEvent;

      const getSwipeBtn = () =>
        h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_swipe"]')!;

      // 1. Plain click -> run_action without backgroundSwipe
      getSwipeBtn().click();
      await flushMicrotasks();

      let runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(1);
      expect(runRpcs[0]!.input).toEqual({
        actionId: "guided_swipe",
        chatId: "chat-a",
        activeConnectionId: "c1",
        inputText: "Keep tension high",
      });
      expect("backgroundSwipe" in (runRpcs[0]!.input as Record<string, unknown>)).toBe(false);

      h.emitFromBackend({
        type: "gg:reply",
        requestId: runRpcs[0]!.requestId,
        result: { runId: "r-1", actionId: "guided_swipe", chatId: "chat-a", aborted: false },
      });
      await flushMicrotasks();

      // 2. Ctrl+Click -> run_action with backgroundSwipe: true
      h.setComposerState({ text: "Background via Ctrl+Click" });
      getSwipeBtn().dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      await flushMicrotasks();

      runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(2);
      expect(runRpcs[1]!.input).toEqual({
        actionId: "guided_swipe",
        chatId: "chat-a",
        activeConnectionId: "c1",
        inputText: "Background via Ctrl+Click",
        backgroundSwipe: true,
      });

      h.emitFromBackend({
        type: "gg:reply",
        requestId: runRpcs[1]!.requestId,
        result: { runId: "r-2", actionId: "guided_swipe", chatId: "chat-a", aborted: false },
      });
      await flushMicrotasks();

      // 3. Click-and-hold (pointerdown -> 450ms timer -> pointerup -> click)
      //    triggers run_action with backgroundSwipe: true once without aborting on release
      h.setComposerState({ text: "Background via hold" });
      const swipeBtnBeforeHold = getSwipeBtn();
      swipeBtnBeforeHold.dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 15,
          clientY: 15,
        }),
      );
      expect(swipeBtnBeforeHold.classList.contains("is-holding")).toBe(true);
      expect(pendingHoldTimers.size).toBe(1);

      fireHoldTimers();
      await flushMicrotasks();

      runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(3);
      expect(runRpcs[2]!.input).toEqual({
        actionId: "guided_swipe",
        chatId: "chat-a",
        activeConnectionId: "c1",
        inputText: "Background via hold",
        backgroundSwipe: true,
      });

      // Release pointerup + click on the button must neither double-trigger nor abort
      swipeBtnBeforeHold.dispatchEvent(
        new PointerEvt("pointerup", {
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 15,
          clientY: 15,
        }),
      );
      swipeBtnBeforeHold.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();

      expect(h.sentRpcs.filter((r) => r.action === "run_action")).toHaveLength(3);
      expect(h.sentRpcs.filter((r) => r.action === "abort_action")).toHaveLength(0);

      // 3b. When gg:status arrives right after 450ms hold fires (replacing button with is-running Stop button)
      //     before pointerup + click, releasing does NOT abort; a subsequent deliberate click DOES abort.
      h.emitFromBackend({
        type: "gg:reply",
        requestId: runRpcs[2]!.requestId,
        result: { runId: "r-3", actionId: "guided_swipe", chatId: "chat-a", aborted: false },
      });
      await flushMicrotasks();

      h.setComposerState({ text: "Hold with immediate gg:status" });
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "touch",
          clientX: 18,
          clientY: 18,
        }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      fireHoldTimers();
      await flushMicrotasks();

      runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(4);
      expect(runRpcs[3]!.input).toEqual({
        actionId: "guided_swipe",
        chatId: "chat-a",
        activeConnectionId: "c1",
        inputText: "Hold with immediate gg:status",
        backgroundSwipe: true,
      });

      const oldBtnBeforeStatus = getSwipeBtn();
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "r-3b",
          actionId: "guided_swipe",
          chatId: "chat-a",
          startedAt: Date.now(),
        },
      });
      const replacementBtn = getSwipeBtn();
      expect(replacementBtn).not.toBe(oldBtnBeforeStatus);
      expect(replacementBtn.classList.contains("is-running")).toBe(true);

      // Synthesized release pointerup + click on replacement button must NOT abort
      replacementBtn.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 18,
          clientY: 18,
        }),
      );
      replacementBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();
      expect(h.sentRpcs.filter((r) => r.action === "abort_action")).toHaveLength(0);

      // Subsequent deliberate click on replacement button DOES abort
      replacementBtn.click();
      await flushMicrotasks();
      let abortRpcs = h.sentRpcs.filter((r) => r.action === "abort_action");
      expect(abortRpcs).toHaveLength(1);
      expect(abortRpcs[0]!.input).toEqual({ runId: "r-3b" });

      h.emitFromBackend({ type: "gg:status", run: null });
      h.emitFromBackend({
        type: "gg:reply",
        requestId: runRpcs[3]!.requestId,
        result: { runId: "r-3b", actionId: "guided_swipe", chatId: "chat-a", aborted: true },
      });
      await flushMicrotasks();

      // 3c. When gg:status replaces button and browser drops click after pointerup,
      //     0ms timer after document pointerup clears suppression so next deliberate click aborts.
      h.setComposerState({ text: "Hold with dropped click" });
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 12,
          clientY: 12,
        }),
      );
      fireHoldTimers();
      await flushMicrotasks();
      runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(5);

      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "r-3c",
          actionId: "guided_swipe",
          chatId: "chat-a",
          startedAt: Date.now(),
        },
      });
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 12,
          clientY: 12,
        }),
      );
      // No click fired on release; wait for next macrotask then click Stop deliberately
      await flushMicrotasks();
      getSwipeBtn().click();
      await flushMicrotasks();
      abortRpcs = h.sentRpcs.filter((r) => r.action === "abort_action");
      expect(abortRpcs).toHaveLength(2);
      expect(abortRpcs[1]!.input).toEqual({ runId: "r-3c" });

      h.emitFromBackend({ type: "gg:status", run: null });
      h.emitFromBackend({
        type: "gg:reply",
        requestId: runRpcs[4]!.requestId,
        result: { runId: "r-3c", actionId: "guided_swipe", chatId: "chat-a", aborted: true },
      });
      await flushMicrotasks();

      // 4. Releasing early (<450ms) cancels hold and falls back to normal swipe without backgroundSwipe
      h.setComposerState({ text: "Short click" });
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 10,
          clientY: 10,
        }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerup", {
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 10,
          clientY: 10,
        }),
      );
      expect(pendingHoldTimers.size).toBe(0);
      getSwipeBtn().dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();

      runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(6);
      expect("backgroundSwipe" in (runRpcs[5]!.input as Record<string, unknown>)).toBe(false);

      // 5. Teardown during an active hold clears the hold timer
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "touch",
          clientX: 10,
          clientY: 10,
        }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      teardown();
      expect(pendingHoldTimers.size).toBe(0);
    } finally {
      teardown();
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("guided_continue click vs hold/shortcut drop-up dispatches remove_last_continue and regenerate_last_continue RPCs without touching composer and respects isLaunching lock", async () => {
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origDateNow = Date.now;
    let fakeNow = 20_000;
    const pendingHoldTimers = new Map<number, () => void>();
    let nextTimerId = 96_000;

    Date.now = () => fakeNow;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 450) {
        const id = ++nextTimerId;
        pendingHoldTimers.set(id, () => fn(...args));
        return id as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;

    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      const num = Number(id);
      if (pendingHoldTimers.has(num)) {
        pendingHoldTimers.delete(num);
        return;
      }
      origClearTimeout(id);
    }) as typeof clearTimeout;

    const fireHoldTimers = () => {
      for (const [id, fn] of [...pendingHoldTimers.entries()]) {
        if (!pendingHoldTimers.has(id)) continue;
        pendingHoldTimers.delete(id);
        fn();
      }
    };

    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "Unsent user draft",
    });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const Win = document.defaultView!;
      const PointerEvt = Win.PointerEvent;
      const MouseEvt = Win.MouseEvent;
      const KeyEvt = Win.KeyboardEvent;

      const getContinueBtn = () =>
        h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_continue"]')!;
      const getMenu = () =>
        document.body.querySelector<HTMLDivElement>(".gg-dropup-menu");
      const getMenuItem = (action: "remove_last_continue" | "regenerate_last_continue") =>
        document.body.querySelector<HTMLButtonElement>(
          `.gg-dropup-menu [data-gg-menu-action="${action}"]`,
        )!;

      // 1. Single click on guided_continue still runs guided_continue with composer text
      h.setComposerState({ text: "Nudge toward mystery" });
      getContinueBtn().click();
      await flushMicrotasks();

      let runRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
      expect(runRpcs).toHaveLength(1);
      expect(runRpcs[0]!.input).toEqual({
        actionId: "guided_continue",
        chatId: "chat-a",
        activeConnectionId: "c1",
        inputText: "Nudge toward mystery",
      });
      h.emitFromBackend({
        type: "gg:reply",
        requestId: runRpcs[0]!.requestId,
        result: { runId: "c-run-1", actionId: "guided_continue", chatId: "chat-a", aborted: false },
      });
      await flushMicrotasks();

      // 2. 450ms click-and-hold opens drop-up menu without triggering guided_continue on release,
      //    respects touch-release grace window, and clicking "Remove the last continue" sends RPC
      //    while keeping composer draft untouched.
      h.setComposerState({ text: "Keep this draft intact" });
      const setTextCountBeforeMenu = h.getSetTextCalls().length;
      const continueBtn = getContinueBtn();
      continueBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "touch",
          clientX: 20,
          clientY: 20,
        }),
      );
      fakeNow += 450;
      fireHoldTimers();
      expect(getMenu()).not.toBeNull();

      // Release inside 150ms grace period -> menu remains open & no run_action fired
      fakeNow += 30;
      continueBtn.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 20,
          clientY: 20,
        }),
      );
      continueBtn.dispatchEvent(new MouseEvt("click", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      expect(getMenu()).not.toBeNull();
      expect(h.sentRpcs.filter((r) => r.action === "run_action")).toHaveLength(1);

      // Click "Remove the last continue"
      getMenuItem("remove_last_continue").click();
      await flushMicrotasks();
      expect(getMenu()).toBeNull();

      // Double-opening via Ctrl+Click while remove_last_continue is in-flight is blocked by isLaunching
      continueBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      getMenuItem("remove_last_continue").click();
      await flushMicrotasks();

      const removeRpcs = h.sentRpcs.filter((r) => r.action === "remove_last_continue");
      expect(removeRpcs).toHaveLength(1);
      expect(removeRpcs[0]!.input).toEqual({ chatId: "chat-a" });
      expect(h.getComposerText()).toBe("Keep this draft intact");
      expect(h.getSetTextCalls().length).toBe(setTextCountBeforeMenu);

      // Backend rejection on remove_last_continue surfaces warn banner
      h.rejectRpc(removeRpcs[0]!.requestId, "No continue history found.");
      await flushMicrotasks();
      const warnNotice = h.alertMount.querySelector(".gg-notice");
      expect(warnNotice?.classList.contains("is-warn")).toBe(true);
      expect(warnNotice?.textContent).toContain("No continue history found.");

      // Successful remove_last_continue clears existing banner
      continueBtn.dispatchEvent(
        new KeyEvt("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
      );
      getMenuItem("remove_last_continue").click();
      await flushMicrotasks();
      const removeRpcs2 = h.sentRpcs.filter((r) => r.action === "remove_last_continue");
      expect(removeRpcs2).toHaveLength(2);
      h.emitFromBackend({
        type: "gg:reply",
        requestId: removeRpcs2[1]!.requestId,
        result: { removed: true, messageId: "m2", swipeIndex: 0, text: "Before" },
      });
      await flushMicrotasks();
      expect(h.alertMount.children.length).toBe(0);

      // 3. Alt+ArrowUp opens menu and "Regenerate last continue" dispatches RPC without touching composer
      continueBtn.dispatchEvent(
        new KeyEvt("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }),
      );
      expect(getMenu()).not.toBeNull();
      getMenuItem("regenerate_last_continue").click();
      await flushMicrotasks();

      // Attempt second regenerate while isLaunching is true -> blocked
      continueBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      getMenuItem("regenerate_last_continue").click();
      await flushMicrotasks();

      const regenRpcs = h.sentRpcs.filter((r) => r.action === "regenerate_last_continue");
      expect(regenRpcs).toHaveLength(1);
      expect(regenRpcs[0]!.input).toEqual({
        chatId: "chat-a",
        activeConnectionId: "c1",
      });
      expect(h.getComposerText()).toBe("Keep this draft intact");
      expect(h.getSetTextCalls().length).toBe(setTextCountBeforeMenu);

      // Failure shows error banner
      h.rejectRpc(regenRpcs[0]!.requestId, "Regenerate failed.");
      await flushMicrotasks();
      const errNotice = h.alertMount.querySelector(".gg-notice");
      expect(errNotice?.classList.contains("is-error")).toBe(true);
      expect(errNotice?.textContent).toContain("Regenerate failed.");

      // 4. Active run status closes an open menu; outside click after grace period closes menu; teardown closes menu
      getContinueBtn().dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "live-cont",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: fakeNow,
        },
      });
      expect(getMenu()).toBeNull();

      h.emitFromBackend({ type: "gg:status", run: null });
      getContinueBtn().dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      fakeNow += 200;
      document.body.click();
      expect(getMenu()).toBeNull();

      getContinueBtn().dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      teardown();
      expect(getMenu()).toBeNull();
    } finally {
      teardown();
      Date.now = origDateNow;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("StreamingIndicatorController mounts 3-dot indicator into message_body_before with rAF retry for response, regenerate, and swipe", async () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-indicator");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-dot");
    expect(GUIDED_GENERATIONS_CSS).toContain("@keyframes gg-streaming-bounce");
    expect(GUIDED_GENERATIONS_CSS).toContain("var(--lumiverse-primary, rgba(147, 112, 219, 0.9))");
    expect(GUIDED_GENERATIONS_CSS).toContain("animation-delay: 0.15s");
    expect(GUIDED_GENERATIONS_CSS).toContain("animation-delay: 0.3s");

    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (
      cb: FrameRequestCallback,
    ) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    };
    (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (
      id: number,
    ) => {
      rafQueue.delete(id);
    };

    const flushRaf = () => {
      const entries = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of entries) cb(16);
    };

    const createBubbleRow = (messageId: string, withMount = true) => {
      const row = document.createElement("div");
      row.setAttribute("data-item-type", "message");
      row.setAttribute("data-message-id", messageId);
      const bubbleMsg = document.createElement("div");
      bubbleMsg.setAttribute("data-component", "BubbleMessage");
      const bubble = document.createElement("div");
      const header = document.createElement("div");
      const content = document.createElement("div");
      if (withMount) {
        const mount = document.createElement("span");
        mount.setAttribute("data-spindle-mount", "message_body_before");
        content.append(mount);
      }
      bubble.append(header, content);
      bubbleMsg.append(bubble);
      row.append(bubbleMsg);
      document.body.append(row);
      return { row, target: withMount ? content.firstElementChild! : content };
    };

    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // 1. guided_response: gg:status arrives before DOM paints -> rAF retries until row mounts
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-resp",
          actionId: "guided_response",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-resp",
          swipeId: 0,
        },
      });
      expect(rafQueue.size).toBe(1);

      const respDom = createBubbleRow("m-resp");
      h.setMessageElement("m-resp", respDom.row);
      flushRaf();

      const respIndicators = respDom.target.querySelectorAll(".gg-streaming-indicator");
      expect(respIndicators).toHaveLength(1);
      expect(respIndicators[0]!.getAttribute("role")).toBe("status");
      expect(respIndicators[0]!.getAttribute("aria-label")).toBe("Generating response");
      expect(respIndicators[0]!.querySelectorAll(".gg-streaming-dot")).toHaveLength(3);

      // Re-emitting status or MESSAGE_SENT does not duplicate the injection
      h.emitEvent("MESSAGE_SENT", { message: { id: "m-resp", content: "", swipe_id: 0 } });
      expect(respDom.target.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
      expect(h.getInjectCounts().injectCalls).toBe(1);

      // 2. guided_regenerate mounts into its target message_body_before and cleans up previous
      const regenDom = createBubbleRow("m-regen");
      h.setMessageElement("m-regen", regenDom.row);
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-regen",
          actionId: "guided_regenerate",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-regen",
          swipeId: 0,
        },
      });
      expect(respDom.target.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(regenDom.target.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // 3. guided_swipe mounts into fallback BubbleMessage content container when mount span is absent
      const swipeDom = createBubbleRow("m-swipe", false);
      h.setMessageElement("m-swipe", swipeDom.row);
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-swipe",
          actionId: "guided_swipe",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-swipe",
          swipeId: 1,
          backgroundSwipe: false,
        },
      });
      expect(regenDom.target.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(swipeDom.target.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // 4. Non-card action (guided_impersonate) does not mount indicator
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-imp",
          actionId: "guided_impersonate",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-swipe",
        },
      });
      expect(swipeDom.target.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
    } finally {
      teardown();
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = origRaf;
      (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = origCancelRaf;
    }
  });

  test("StreamingIndicatorController mounts guided_continue after MessageContent with fallbacks and clean action transitions", async () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-streaming-indicator--after");

    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // 1. BubbleMessage with MessageContent: injects "afterend" on [data-component="MessageContent"] (inside .content, outside MessageContent)
      const bubbleRow = document.createElement("div");
      bubbleRow.setAttribute("data-message-id", "m-cont-1");
      const bubbleMsg = document.createElement("div");
      bubbleMsg.setAttribute("data-component", "BubbleMessage");
      const bubbleInner = document.createElement("div");
      const bubbleContent = document.createElement("div");
      bubbleContent.className = "bubble_content_abc";
      const mountBefore = document.createElement("span");
      mountBefore.setAttribute("data-spindle-mount", "message_body_before");
      const messageContent = document.createElement("div");
      messageContent.setAttribute("data-component", "MessageContent");
      messageContent.textContent = "Existing paragraph";
      const mountAfter = document.createElement("span");
      mountAfter.setAttribute("data-spindle-mount", "message_body_after");
      bubbleContent.append(mountBefore, messageContent);
      bubbleInner.append(bubbleContent, mountAfter);
      bubbleMsg.append(bubbleInner);
      bubbleRow.append(bubbleMsg);
      document.body.append(bubbleRow);
      h.setMessageElement("m-cont-1", bubbleRow);

      // guided_continue injects directly after MessageContent
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-cont-1",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-cont-1",
          swipeId: 0,
          hasContentOutput: false,
        },
      });
      expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(messageContent.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(mountAfter.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      const afterSibling = messageContent.nextElementSibling;
      expect(afterSibling).not.toBeNull();
      expect(afterSibling!.parentElement).toBe(bubbleContent);
      expect(afterSibling!.querySelectorAll(".gg-streaming-indicator--after")).toHaveLength(1);
      expect(bubbleRow.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // Re-emitting same guided_continue status must not unmount/re-inject
      const injectCountBeforeDup = h.getInjectCounts().injectCalls;
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-cont-1",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-cont-1",
          swipeId: 0,
          hasContentOutput: false,
        },
      });
      expect(h.getInjectCounts().injectCalls).toBe(injectCountBeforeDup);
      expect(bubbleRow.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // 2. Fallback to [data-spindle-mount="message_body_after"] ("beforeend") when MessageContent is absent
      const fallbackRow = document.createElement("div");
      fallbackRow.setAttribute("data-message-id", "m-cont-2");
      const fallbackMountBefore = document.createElement("span");
      fallbackMountBefore.setAttribute("data-spindle-mount", "message_body_before");
      const fallbackMountAfter = document.createElement("span");
      fallbackMountAfter.setAttribute("data-spindle-mount", "message_body_after");
      fallbackRow.append(fallbackMountBefore, fallbackMountAfter);
      document.body.append(fallbackRow);
      h.setMessageElement("m-cont-2", fallbackRow);

      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-cont-2",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-cont-2",
          swipeId: 0,
          hasContentOutput: false,
        },
      });
      expect(bubbleRow.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(fallbackMountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(fallbackMountAfter.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
      expect(h.getInjectCounts().activeInjections).toBe(1);
    } finally {
      teardown();
    }
  });

  test("StreamingIndicatorController keeps dots mounted across hasContentOutput and MESSAGE_EDITED for all 4 actions until run: null", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const row = document.createElement("div");
      const bubbleMsg = document.createElement("div");
      bubbleMsg.setAttribute("data-component", "BubbleMessage");
      const bubbleInner = document.createElement("div");
      const contentWrap = document.createElement("div");
      const mountBefore = document.createElement("span");
      mountBefore.setAttribute("data-spindle-mount", "message_body_before");
      contentWrap.append(mountBefore);
      bubbleInner.append(contentWrap);
      bubbleMsg.append(bubbleInner);
      row.append(bubbleMsg);
      document.body.append(row);
      h.setMessageElement("m-all-4", row);

      const actions: Array<"guided_response" | "guided_regenerate" | "guided_swipe" | "guided_continue"> = [
        "guided_response",
        "guided_regenerate",
        "guided_swipe",
        "guided_continue",
      ];

      for (const [idx, actionId] of actions.entries()) {
        // Reset MessageContent for blank-slot start on non-continue, or present for continue
        contentWrap.querySelector('[data-component="MessageContent"]')?.remove();
        if (actionId === "guided_continue") {
          const mc = document.createElement("div");
          mc.setAttribute("data-component", "MessageContent");
          mc.textContent = "Base text";
          contentWrap.append(mc);
        }

        const runId = `run-all-${idx}`;
        h.emitFromBackend({
          type: "gg:status",
          run: {
            runId,
            actionId,
            chatId: "chat-a",
            startedAt: Date.now(),
            messageId: "m-all-4",
            swipeId: 0,
            hasContentOutput: false,
          },
        });
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

        // Reasoning-only edit keeps indicator
        h.emitEvent("MESSAGE_EDITED", {
          message: { id: "m-all-4", content: actionId === "guided_continue" ? "Base text" : "", reasoning: "Thinking...", swipe_id: 0 },
        });
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

        // Ensure MessageContent exists for streaming text, then emit hasContentOutput: true + MESSAGE_EDITED text chunks
        if (!contentWrap.querySelector('[data-component="MessageContent"]')) {
          const mc = document.createElement("div");
          mc.setAttribute("data-component", "MessageContent");
          mc.textContent = "Chunk 1";
          contentWrap.append(mc);
        }

        h.emitFromBackend({
          type: "gg:status",
          run: {
            runId,
            actionId,
            chatId: "chat-a",
            startedAt: Date.now(),
            messageId: "m-all-4",
            swipeId: 0,
            hasContentOutput: true,
          },
        });
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

        const mc = contentWrap.querySelector('[data-component="MessageContent"]')!;
        expect(mc.nextElementSibling?.querySelectorAll(".gg-streaming-indicator--after")).toHaveLength(1);

        h.emitEvent("MESSAGE_EDITED", {
          message: { id: "m-all-4", content: "Chunk 1 Chunk 2", swipe_id: 0 },
        });
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

        // Unmounts only when run becomes null (finish, abort/cancel, or error)
        h.emitFromBackend({ type: "gg:status", run: null });
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
        expect(h.getInjectCounts().activeInjections).toBe(0);
      }
    } finally {
      teardown();
    }
  });

  test("StreamingIndicatorController relocates blank-slot actions from message_body_before to MessageContent afterend via rAF without flicker", async () => {
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (
      cb: FrameRequestCallback,
    ) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    };
    (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (
      id: number,
    ) => {
      rafQueue.delete(id);
    };

    const flushRaf = () => {
      const entries = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of entries) cb(16);
    };

    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const actionList: Array<"guided_response" | "guided_regenerate" | "guided_swipe"> = [
        "guided_response",
        "guided_regenerate",
        "guided_swipe",
      ];

      for (const [idx, actionId] of actionList.entries()) {
        const messageId = `m-reloc-${idx}`;
        // 1. Run starts before row mounts -> rAF retries in "row" mode
        h.emitFromBackend({
          type: "gg:status",
          run: {
            runId: `run-reloc-${idx}`,
            actionId,
            chatId: "chat-a",
            startedAt: Date.now(),
            messageId,
            swipeId: 0,
            backgroundSwipe: false,
          },
        });
        expect(rafQueue.size).toBe(1);

        // Row mounts with blank eager slot (message_body_before, no MessageContent yet)
        const row = document.createElement("div");
        const contentWrap = document.createElement("div");
        const mountBefore = document.createElement("span");
        mountBefore.setAttribute("data-spindle-mount", "message_body_before");
        contentWrap.append(mountBefore);
        row.append(contentWrap);
        document.body.append(row);
        h.setMessageElement(messageId, row);

        flushRaf();
        expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
        expect(rafQueue.size).toBe(0);

        // 2. Content output begins (MESSAGE_EDITED / hasContentOutput) BEFORE MessageContent renders in DOM
        //    -> keeps fallback mounted AND schedules rAF retry in "content" mode
        const injectCountBeforeWait = h.getInjectCounts().injectCalls;
        h.emitEvent("MESSAGE_EDITED", {
          message: { id: messageId, content: "First token", swipe_id: 0 },
        });
        expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
        expect(h.getInjectCounts().injectCalls).toBe(injectCountBeforeWait);
        expect(rafQueue.size).toBe(1);

        // Still not in DOM on first rAF -> stays on fallback and keeps retrying
        flushRaf();
        expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
        expect(h.getInjectCounts().injectCalls).toBe(injectCountBeforeWait);
        expect(rafQueue.size).toBe(1);

        // 3. React mounts <MessageContent> -> next rAF cleanly relocates to MessageContent "afterend"
        const messageContent = document.createElement("div");
        messageContent.setAttribute("data-component", "MessageContent");
        messageContent.textContent = "First token";
        contentWrap.append(messageContent);

        flushRaf();
        expect(mountBefore.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
        expect(messageContent.nextElementSibling).not.toBeNull();
        expect(messageContent.nextElementSibling!.querySelectorAll(".gg-streaming-indicator--after")).toHaveLength(1);
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
        expect(rafQueue.size).toBe(0);

        // Subsequent streaming updates do not re-inject
        const injectCountAfterReloc = h.getInjectCounts().injectCalls;
        h.emitEvent("MESSAGE_EDITED", {
          message: { id: messageId, content: "First token second token", swipe_id: 0 },
        });
        expect(h.getInjectCounts().injectCalls).toBe(injectCountAfterReloc);

        h.emitFromBackend({ type: "gg:status", run: null });
        expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      }
    } finally {
      teardown();
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = origRaf;
      (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = origCancelRaf;
    }
  });

  test("StreamingIndicatorController hides guided_continue and guided_regenerate on swipe-away and remounts on swipe-back while running", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const row = document.createElement("div");
      const messageContent = document.createElement("div");
      messageContent.setAttribute("data-component", "MessageContent");
      messageContent.textContent = "Existing swipe 1 text";
      row.append(messageContent);
      document.body.append(row);
      h.setMessageElement("m-cont-swipe", row);

      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-cont-swipe",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-cont-swipe",
          swipeId: 1,
          hasContentOutput: false,
        },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // User swipes to swipe 0 -> indicator hides
      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-cont-swipe", swipe_id: 0, content: "Swipe 0 text" },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // User swipes back to swipe 1 while still running (even after hasContentOutput: true) -> indicator remounts
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-cont-swipe",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-cont-swipe",
          swipeId: 1,
          hasContentOutput: true,
        },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-cont-swipe", swipe_id: 1, content: "Existing swipe 1 text + more" },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // guided_regenerate with swipeId set also guards against swipe-away/back
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-regen-swipe",
          actionId: "guided_regenerate",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-cont-swipe",
          swipeId: 2,
          hasContentOutput: true,
        },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-cont-swipe", swipe_id: 0, content: "Swipe 0 text" },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-cont-swipe", swipe_id: 2, content: "Regen text" },
      });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // Only run: null unmounts
      h.emitFromBackend({ type: "gg:status", run: null });
      expect(row.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
    } finally {
      teardown();
    }
  });

  test("StreamingIndicatorController handles guided_swipe foreground swipe-away/back and backgroundSwipe visibility", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const row = document.createElement("div");
      const mount = document.createElement("span");
      mount.setAttribute("data-spindle-mount", "message_body_before");
      row.append(mount);
      document.body.append(row);
      h.setMessageElement("m-swipe", row);

      // 1. Foreground swipe (swipeId: 1) mounts -> swiping away to 0 (even with old content) unmounts -> swiping back to 1 remounts
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "swipe-fg",
          actionId: "guided_swipe",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-swipe",
          swipeId: 1,
          backgroundSwipe: false,
        },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-swipe", swipe_id: 0, content: "Previous swipe content" },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-swipe", swipe_id: 1, content: "" },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);

      // 2. Background swipe (swipeId: 2, backgroundSwipe: true) does NOT mount on old swipe,
      //    but DOES mount when user navigates onto swipe 2 while still empty
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "swipe-bg",
          actionId: "guided_swipe",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-swipe",
          swipeId: 2,
          backgroundSwipe: true,
        },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // Old swipe edit does not falsely mark new swipe as having content
      h.emitEvent("MESSAGE_EDITED", {
        message: { id: "m-swipe", swipe_id: 0, content: "Still old swipe" },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // Navigating forward onto swipe 2 while empty mounts the indicator
      h.emitEvent("MESSAGE_SWIPED", {
        message: { id: "m-swipe", swipe_id: 2, content: "" },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
    } finally {
      teardown();
    }
  });

  test("StreamingIndicatorController unmounts cleanly on run: null, CHAT_CHANGED, and destroy()", async () => {
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const cancelledRafs: number[] = [];
    let nextRafId = 10;
    (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = () =>
      nextRafId++;
    (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (
      id: number,
    ) => {
      cancelledRafs.push(id);
    };

    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const row = document.createElement("div");
      const mount = document.createElement("span");
      mount.setAttribute("data-spindle-mount", "message_body_before");
      row.append(mount);
      document.body.append(row);
      h.setMessageElement("m-life", row);

      // Unmounts on run: null
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-null-test",
          actionId: "guided_response",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-life",
          swipeId: 0,
        },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
      h.emitFromBackend({ type: "gg:status", run: null });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(h.getInjectCounts().activeInjections).toBe(0);

      // Unmounts on CHAT_CHANGED
      h.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-chat-test",
          actionId: "guided_response",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-life",
          swipeId: 0,
        },
      });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
      h.setChat("chat-b");
      h.emitEvent("CHAT_CHANGED", { chatId: "chat-b" });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);

      // Switching back to chat-a while run is still active & empty remounts, then teardown() unmounts
      h.setChat("chat-a");
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(1);
      teardown();
      expect(mount.querySelectorAll(".gg-streaming-indicator")).toHaveLength(0);
      expect(h.getInjectCounts().activeInjections).toBe(0);

      // Pending rAF retry is cancelled on destroy()
      const h2 = createFrontendHarness({ initialChatId: "chat-a" });
      const teardown2 = setup(h2.ctx);
      h2.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();
      h2.emitFromBackend({
        type: "gg:status",
        run: {
          runId: "run-raf-cancel",
          actionId: "guided_response",
          chatId: "chat-a",
          startedAt: Date.now(),
          messageId: "m-unpainted",
          swipeId: 0,
        },
      });
      teardown2();
      expect(cancelledRafs.length).toBeGreaterThan(0);
    } finally {
      teardown();
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = origRaf;
      (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = origCancelRaf;
    }
  });

  test("PillMetricsController persists tokenCount and generationMetrics onto active swipe via extra-only updateMessage", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    h.setChatMessages("chat-a", [
      {
        id: "msg-1",
        chat_id: "chat-a",
        swipe_id: 1,
        extra: { spindle_metadata: { preset_contexts: { 1: { preset_id: "p1" } } } },
      },
    ]);
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const metrics = {
        ttft: 320,
        tps: 44.5,
        durationMs: 2100,
        wasStreaming: true,
        model: "gpt-4o",
        provider: "openai",
        presetId: "p1",
        presetName: "Default",
      };
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-1",
        swipeId: 1,
        tokenCount: 128,
        generationMetrics: metrics,
      });
      await flushMicrotasks();

      expect(h.getGetMessagesCalls()).toEqual([
        { chatId: "chat-a", options: { limit: 50, tail: true } },
      ]);
      const updates = h.getUpdateMessageCalls();
      expect(updates).toHaveLength(1);
      expect(updates[0]!.chatId).toBe("chat-a");
      expect(updates[0]!.messageId).toBe("msg-1");
      expect("content" in updates[0]!.input).toBe(false);
      expect(updates[0]!.input).toEqual({
        extra: {
          spindle_metadata: { preset_contexts: { 1: { preset_id: "p1" } } },
          tokenCount: 128,
          generationMetrics: metrics,
        },
      });
    } finally {
      teardown();
    }
  });

  test("PillMetricsController defers background-swipe metrics until MESSAGE_SWIPED activates targetSwipeId", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    // User stayed on swipe 0 while background guided_swipe generated swipe 2
    h.setChatMessages("chat-a", [
      {
        id: "msg-bg",
        chat_id: "chat-a",
        swipe_id: 0,
        extra: { tokenCount: 50, generationMetrics: { durationMs: 800, wasStreaming: true, model: "old-model" } },
      },
    ]);
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const swipe2Metrics = {
        ttft: 150,
        tps: 60.2,
        durationMs: 1400,
        wasStreaming: true,
        model: "claude-sonnet",
        provider: "anthropic",
        presetId: "p2",
        presetName: "Creative",
      };

      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-bg",
        swipeId: 2,
        tokenCount: 240,
        generationMetrics: swipe2Metrics,
      });
      await flushMicrotasks();

      // Must NOT clobber swipe 0
      expect(h.getUpdateMessageCalls()).toHaveLength(0);

      // Swiping to swipe 1 still must NOT flush swipe 2's metrics
      h.setChatMessages("chat-a", [
        { id: "msg-bg", chat_id: "chat-a", swipe_id: 1, extra: {} },
      ]);
      h.emitEvent("MESSAGE_SWIPED", {
        chatId: "chat-a",
        message: { id: "msg-bg", chat_id: "chat-a", swipe_id: 1, extra: {} },
      });
      await flushMicrotasks();
      expect(h.getUpdateMessageCalls()).toHaveLength(0);

      // Swiping onto swipe 2 flushes the queued metrics onto swipe 2
      h.setChatMessages("chat-a", [
        { id: "msg-bg", chat_id: "chat-a", swipe_id: 2, extra: { spindle_metadata: { ok: true } } },
      ]);
      h.emitEvent("MESSAGE_SWIPED", {
        chatId: "chat-a",
        message: { id: "msg-bg", chat_id: "chat-a", swipe_id: 2, extra: { spindle_metadata: { ok: true } } },
      });
      await flushMicrotasks();

      const updates = h.getUpdateMessageCalls();
      expect(updates).toHaveLength(1);
      expect("content" in updates[0]!.input).toBe(false);
      expect(updates[0]!.input).toEqual({
        extra: {
          spindle_metadata: { ok: true },
          tokenCount: 240,
          generationMetrics: swipe2Metrics,
        },
      });
    } finally {
      teardown();
    }
  });

  test("PillMetricsController passes explicit null to clear stale generationMetrics while updating tokenCount", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    h.setChatMessages("chat-a", [
      {
        id: "msg-cont",
        chat_id: "chat-a",
        swipe_id: 0,
        extra: {
          spindle_metadata: { keep: 1 },
          tokenCount: 190,
          generationMetrics: {
            ttft: 100,
            tps: 50,
            durationMs: 1200,
            wasStreaming: true,
            model: "gpt-4o",
          },
        },
      },
    ]);
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-cont",
        swipeId: 0,
        tokenCount: 95,
        generationMetrics: null,
      });
      await flushMicrotasks();

      const updates = h.getUpdateMessageCalls();
      expect(updates).toHaveLength(1);
      expect("content" in updates[0]!.input).toBe(false);
      const extra = updates[0]!.input.extra as Record<string, unknown>;
      expect(extra.spindle_metadata).toEqual({ keep: 1 });
      expect(extra.tokenCount).toBe(95);
      expect("generationMetrics" in extra).toBe(true);
      expect(extra.generationMetrics).toBeNull();
    } finally {
      teardown();
    }
  });

  test("PillMetricsController coalesces concurrent updates, retries once on transient error, drops deleted/denied cleanly, and aborts safely on teardown", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    h.setChatMessages("chat-a", [
      { id: "msg-race", chat_id: "chat-a", swipe_id: 0, extra: {} },
    ]);
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // 1. Coalescing while first getMessages is in flight
      let resolveFirstRead!: (v: unknown) => void;
      let readCount = 0;
      h.setCustomGetMessages(async (chatId) => {
        readCount += 1;
        if (readCount === 1) {
          return new Promise((resolve) => {
            resolveFirstRead = resolve;
          });
        }
        return {
          data: [{ id: "msg-race", chat_id: chatId, swipe_id: 0, extra: {} }],
          total: 1,
        };
      });

      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-race",
        swipeId: 0,
        tokenCount: 10,
        generationMetrics: { durationMs: 100, wasStreaming: true },
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(readCount).toBe(1);

      // Newer event arrives before first read resolves -> serialized follow-up applies tokenCount: 25
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-race",
        swipeId: 0,
        tokenCount: 25,
        generationMetrics: null,
      });

      resolveFirstRead({
        data: [{ id: "msg-race", chat_id: "chat-a", swipe_id: 0, extra: {} }],
        total: 1,
      });
      await flushMicrotasks();

      const updates = h.getUpdateMessageCalls();
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[updates.length - 1]!.input).toEqual({
        extra: { tokenCount: 25, generationMetrics: null },
      });

      // 2. Transient updateMessage error retries once and succeeds
      h.setCustomGetMessages(null);
      let updateAttempts = 0;
      h.setCustomUpdateMessage(async () => {
        updateAttempts += 1;
        if (updateAttempts === 1) {
          throw new Error("Temporary network glitch");
        }
        return { id: "msg-race" };
      });
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-race",
        swipeId: 0,
        tokenCount: 77,
      });
      await flushMicrotasks();
      await flushMicrotasks();
      expect(updateAttempts).toBe(2);

      // 3. Deleted message (not in getMessages) and PERMISSION_DENIED drop cleanly without throwing
      h.setCustomUpdateMessage(null);
      h.setChatMessages("chat-a", []);
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-deleted",
        swipeId: 0,
        tokenCount: 50,
      });
      await flushMicrotasks();

      h.setCustomGetMessages(async () => {
        throw new Error("PERMISSION_DENIED:chats");
      });
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-denied",
        swipeId: 0,
        tokenCount: 50,
      });
      await flushMicrotasks();

      // 4. Teardown while getMessages is pending prevents updateMessage from running
      const updatesBeforeTeardown = h.getUpdateMessageCalls().length;
      let resolvePendingRead!: (v: unknown) => void;
      h.setCustomGetMessages(
        () =>
          new Promise((resolve) => {
            resolvePendingRead = resolve;
          }),
      );
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-race",
        swipeId: 0,
        tokenCount: 999,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(typeof resolvePendingRead).toBe("function");

      teardown();
      resolvePendingRead({
        data: [{ id: "msg-race", chat_id: "chat-a", swipe_id: 0, extra: {} }],
        total: 1,
      });
      await flushMicrotasks();
      expect(h.getUpdateMessageCalls().length).toBe(updatesBeforeTeardown);

      // 5. Direct controller unit check: supports ctx.domain.chats.getMessages + onChatChanged
      let domainReads = 0;
      const domainUpdates: unknown[] = [];
      const domainCtx = {
        domain: {
          chats: {
            getMessages: async (chatId: string) => {
              domainReads += 1;
              return {
                data: [{ id: "m-dom", chat_id: chatId, swipe_id: 0, extra: {} }],
                total: 1,
              };
            },
          },
        },
        chats: {
          updateMessage: async (_chatId: string, _msgId: string, input: unknown) => {
            domainUpdates.push(input);
            return {};
          },
        },
        getActiveChat: () => ({ chatId: "chat-dom", characterId: null }),
      } as unknown as SpindleFrontendContext;

      const ctrl = new PillMetricsController(domainCtx);
      ctrl.handleMetricsEvent({
        type: "gg:generation_metrics",
        chatId: "chat-dom",
        messageId: "m-dom",
        swipeId: 0,
        tokenCount: 42,
      });
      await flushMicrotasks();
      expect(domainReads).toBe(1);
      expect(domainUpdates).toEqual([{ extra: { tokenCount: 42 } }]);
      ctrl.onChatChanged("chat-dom");
      ctrl.destroy();
    } finally {
      teardown();
    }
  });

  test("PillMetricsController drops deleted swipe metrics and decrements queued swipeId when an earlier swipe is deleted", async () => {
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    h.setChatMessages("chat-a", [
      { id: "msg-del", chat_id: "chat-a", swipe_id: 1, extra: {} },
    ]);
    const teardown = setup(h.ctx);

    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const shiftedMetrics = {
        ttft: 110,
        tps: 55.4,
        durationMs: 950,
        wasStreaming: true,
        model: "gpt-4o",
      };

      // Queue metrics for swipe 0 (will be deleted) and swipe 2 (will shift down to swipe 1)
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-del",
        swipeId: 0,
        tokenCount: 111,
      });
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-del",
        swipeId: 2,
        tokenCount: 222,
        generationMetrics: shiftedMetrics,
      });
      await flushMicrotasks();
      expect(h.getUpdateMessageCalls()).toHaveLength(0);

      // Delete swipe 0 while currently viewing new swipe 0
      h.setChatMessages("chat-a", [
        { id: "msg-del", chat_id: "chat-a", swipe_id: 0, extra: {} },
      ]);
      h.emitEvent("MESSAGE_SWIPED", {
        chatId: "chat-a",
        action: "deleted",
        swipeId: 0,
        message: { id: "msg-del", chat_id: "chat-a", swipe_id: 0, extra: {} },
      });
      await flushMicrotasks();

      // Deleted swipe 0 entry must NOT flush onto the new swipe 0, and old swipe 2 waits at swipe 1
      expect(h.getUpdateMessageCalls()).toHaveLength(0);

      // Navigate onto new swipe 1 (formerly swipe 2) -> shifted metrics flush cleanly
      h.setChatMessages("chat-a", [
        {
          id: "msg-del",
          chat_id: "chat-a",
          swipe_id: 1,
          extra: { spindle_metadata: { kept: true } },
        },
      ]);
      h.emitEvent("MESSAGE_SWIPED", {
        chatId: "chat-a",
        action: "navigated",
        swipeId: 1,
        message: { id: "msg-del", chat_id: "chat-a", swipe_id: 1, extra: {} },
      });
      await flushMicrotasks();

      const updates = h.getUpdateMessageCalls();
      expect(updates).toHaveLength(1);
      expect(updates[0]!.messageId).toBe("msg-del");
      expect(updates[0]!.input).toEqual({
        extra: {
          spindle_metadata: { kept: true },
          tokenCount: 222,
          generationMetrics: shiftedMetrics,
        },
      });
    } finally {
      teardown();
    }
  });

  test("guided_continue anchor click closes open drop-up menu without triggering guided_continue, Tab/blur cancel cleanly, and positionContinueMenu respects scale / --lumiverse-ui-scale", () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(
      "max-width: calc((100vw - 16px) / var(--lumiverse-ui-scale, 1));",
    );

    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origDateNow = Date.now;
    let fakeNow = 50_000;
    const pendingHoldTimers = new Map<number, () => void>();
    let nextTimerId = 98_000;

    Date.now = () => fakeNow;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 450) {
        const id = ++nextTimerId;
        pendingHoldTimers.set(id, () => fn(...args));
        return id as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;

    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      const num = Number(id);
      if (pendingHoldTimers.has(num)) {
        pendingHoldTimers.delete(num);
        return;
      }
      origClearTimeout(id);
    }) as typeof clearTimeout;

    const Win = document.defaultView!;
    const origGetComputedStyle = Win.getComputedStyle;

    try {
      const triggered: string[] = [];
      const actionsMount = document.createElement("span");
      document.body.append(actionsMount);
      const fakeCtx = {
        ui: { mount: () => actionsMount },
      } as unknown as SpindleFrontendContext;

      const toolbar = new InputToolbarController(fakeCtx, {
        onTriggerAction: (actionId) => triggered.push(actionId),
        onAbortAction: () => {},
        onRestoreLatest: () => {},
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      });

      toolbar.render({
        settings: createDefaultSettings(),
        activeRun: null,
        recovery: [],
        hasActiveChat: true,
      });

      const continueBtn = actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_continue"]',
      )!;
      const getMenu = () => document.body.querySelector<HTMLDivElement>(".gg-dropup-menu");
      const PointerEvt = Win.PointerEvent;
      const MouseEvt = Win.MouseEvent;
      const KeyEvt = Win.KeyboardEvent;

      Object.defineProperty(Win, "innerWidth", { configurable: true, value: 1000 });
      Object.defineProperty(Win, "innerHeight", { configurable: true, value: 800 });
      continueBtn.getBoundingClientRect = () =>
        ({
          top: 600,
          bottom: 626,
          left: 250,
          right: 280,
          width: 30,
          height: 26,
          x: 250,
          y: 600,
          toJSON: () => ({}),
        }) as DOMRect;

      // 1. CSS `scale` property (when zoom is 1) scales menu position
      Win.getComputedStyle = (() =>
        ({
          zoom: "1",
          getPropertyValue: (prop: string) => (prop === "scale" ? "1.25" : ""),
        }) as unknown as CSSStyleDeclaration) as typeof Win.getComputedStyle;

      continueBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      let menu = getMenu()!;
      expect(menu).not.toBeNull();
      expect(menu.style.left).toBe("200px");
      expect(menu.style.bottom).toBe("166px");

      // Clicking guided_continue button while menu is open (past 150ms grace window) toggles menu closed without triggering guided_continue
      fakeNow += 200;
      continueBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
        }),
      );
      continueBtn.dispatchEvent(new MouseEvt("click", { bubbles: true, cancelable: true }));
      expect(getMenu()).toBeNull();
      expect(continueBtn.getAttribute("aria-expanded")).toBe("false");
      expect(triggered).toHaveLength(0);

      // 2. `--lumiverse-ui-scale` fallback (when zoom is 1 and scale is "none") scales menu position
      Win.getComputedStyle = (() =>
        ({
          zoom: "1",
          getPropertyValue: (prop: string) => (prop === "--lumiverse-ui-scale" ? "2" : "none"),
        }) as unknown as CSSStyleDeclaration) as typeof Win.getComputedStyle;

      continueBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      menu = getMenu()!;
      expect(menu.style.left).toBe("125px"); // 250 / 2
      expect(menu.style.bottom).toBe("106px"); // (800 - 600) / 2 + 6

      // Tab closes menu and restores focus to anchor button
      menu.dispatchEvent(new KeyEvt("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      expect(getMenu()).toBeNull();
      expect(document.activeElement).toBe(continueBtn);

      // Window blur cancels active 450ms hold timer
      continueBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 10,
          clientY: 10,
        }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      Win.dispatchEvent(new Win.Event("blur"));
      expect(pendingHoldTimers.size).toBe(0);
      expect(continueBtn.classList.contains("is-holding")).toBe(false);

      toolbar.destroy();
    } finally {
      Win.getComputedStyle = origGetComputedStyle;
      Date.now = origDateNow;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("SettingsDrawerController preserves just-saved edits when flushing deferred pendingView, and teardown flushes pending debounced saves before marking destroyed", async () => {
    // 1. Deferred pendingView merges this.currentSettings on flush
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);
    const saved: GuidedGenerationsSettings[] = [];

    const fakeCtx = {
      connections: { getActive: () => ({ activeProfileId: "c1" }) },
      ui: {
        registerDrawerTab: () => ({
          root: tabRoot,
          tabId: "t-pending",
          setTitle: () => {},
          setShortName: () => {},
          setBadge: () => {},
          activate: () => {},
          destroy: () => {},
          onActivate: () => () => {},
        }),
      },
      components: {
        mountSwitch: (
          target: string | Element,
          opts: { checked?: boolean; ariaLabel?: string; onChange?: (v: boolean) => void },
        ) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const btn = document.createElement("button");
          btn.setAttribute("role", "switch");
          let checked = Boolean(opts.checked);
          btn.setAttribute("aria-checked", String(checked));
          if (opts.ariaLabel) btn.setAttribute("aria-label", opts.ariaLabel);
          btn.addEventListener("click", () => {
            checked = !checked;
            btn.setAttribute("aria-checked", String(checked));
            opts.onChange?.(checked);
          });
          el.append(btn);
          return {
            componentId: "s",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => el.replaceChildren(),
          };
        },
        mountSelect: (
          target: string | Element,
          opts: {
            options?: Array<{ value: string; label: string }>;
            value?: string;
            ariaLabel?: string;
          },
        ) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const sel = document.createElement("select");
          if (opts.ariaLabel) sel.setAttribute("aria-label", opts.ariaLabel);
          for (const opt of opts.options ?? []) {
            const optionEl = document.createElement("option");
            optionEl.value = opt.value;
            optionEl.textContent = opt.label;
            sel.append(optionEl);
          }
          sel.value = opts.value ?? "";
          el.append(sel);
          return {
            componentId: "sel",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => el.replaceChildren(),
          };
        },
        mountModelCombobox: (target: string | Element, opts: { value?: string }) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const input = document.createElement("input");
          input.value = opts.value ?? "";
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
        mountTextArea: (
          target: string | Element,
          opts: { value?: string; ariaLabel?: string; onChange?: (v: string) => void },
        ) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const ta = document.createElement("textarea");
          ta.value = opts.value ?? "";
          if (opts.ariaLabel) ta.setAttribute("aria-label", opts.ariaLabel);
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
      onSaveSettings: async (next) => {
        saved.push(next);
      },
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    const initialView = makeBootstrapView();
    initialView.settings.actions.guided_response.instructionTemplate = "Initial template";
    drawer.render(initialView);

    // Edit switch synchronously (applyRegex -> false) + edit textarea debounced
    const regexSwitch = tabRoot.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Apply Lumiverse regex scripts for Guided Response"]',
    )!;
    regexSwitch.click();

    const textarea = tabRoot.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Guided Response Guidance Template"]',
    )!;
    textarea.focus();
    textarea.value = "Just-saved template";
    textarea.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));

    // Stale view arrives while editing (new preset added, but old settings snapshot)
    const staleView = makeBootstrapView({
      presets: [
        { id: "p1", name: "Default" },
        { id: "p2", name: "Added Preset" },
      ],
    });
    staleView.settings.actions.guided_response.instructionTemplate = "Initial template";
    staleView.settings.actions.guided_response.applyRegex = true;
    drawer.render(staleView);
    expect(tabRoot.textContent).not.toContain("Added Preset");

    // Blur flushes debounced save AND applies deferred pendingView with currentSettings preserved
    textarea.blur();
    textarea.dispatchEvent(new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }));
    await flushMicrotasks();

    expect(saved[saved.length - 1]!.actions.guided_response.instructionTemplate).toBe(
      "Just-saved template",
    );
    expect(saved[saved.length - 1]!.actions.guided_response.applyRegex).toBe(false);
    expect(tabRoot.textContent).toContain("Added Preset");

    const rebuiltTextarea = tabRoot.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Guided Response Guidance Template"]',
    )!;
    const rebuiltRegexSwitch = tabRoot.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Apply Lumiverse regex scripts for Guided Response"]',
    )!;
    expect(rebuiltTextarea.value).toBe("Just-saved template");
    expect(rebuiltRegexSwitch.getAttribute("aria-checked")).toBe("false");
    drawer.destroy();

    // 2. setup(ctx) teardown flushes pending debounced saves before marking destroyed
    const h = createFrontendHarness({ initialChatId: "chat-a" });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    const maxDraftsInput = h.tabRoot.querySelector<HTMLInputElement>(
      'input[aria-label="Max saved drafts"]',
    )!;
    expect(maxDraftsInput).not.toBeNull();
    maxDraftsInput.focus();
    maxDraftsInput.value = "27";
    maxDraftsInput.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));

    expect(h.sentRpcs.filter((r) => r.action === "save_settings")).toHaveLength(0);
    teardown();

    const saveRpcs = h.sentRpcs.filter((r) => r.action === "save_settings");
    expect(saveRpcs).toHaveLength(1);
    expect((saveRpcs[0]!.input as GuidedGenerationsSettings).inputRecovery.maxEntries).toBe(27);
  });

  test("background chat generation unlocks other chats' toolbars, renders floating Chat Head indicator, turns green on completion, and navigates on click", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "Steer chat-a response",
    });

    const invokedRoutes: Array<{ ref: { kind: string; id: string }; params: { chatId: string } }> =
      [];
    (
      h.ctx as unknown as {
        host: {
          surfaces: {
            invoke: (ref: { kind: string; id: string }, params: { chatId: string }) => void;
          };
        };
      }
    ).host = {
      surfaces: {
        invoke: (ref, params) => {
          invokedRoutes.push({ ref, params });
        },
      },
    };

    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    // 1. Trigger Guided Response in chat-a
    const responseBtnA = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_response"]',
    )!;
    expect(responseBtnA).not.toBeNull();
    expect(responseBtnA.disabled).toBe(false);
    responseBtnA.click();
    await flushMicrotasks();

    const runActionRpcsA = h.sentRpcs.filter((r) => r.action === "run_action");
    expect(runActionRpcsA).toHaveLength(1);
    expect((runActionRpcsA[0]!.input as { chatId: string }).chatId).toBe("chat-a");

    // Backend emits active run status for chat-a (running, then streaming)
    const runA = {
      runId: "run-chat-a",
      actionId: "guided_response" as const,
      chatId: "chat-a",
      startedAt: 1000,
      messageId: "msg-a1",
      swipeId: 0,
      hasContentOutput: false,
      characterId: "char-alpha",
      characterName: "Alpha Hero",
      avatarUrl: "/api/v1/characters/char-alpha/avatar?thumb=1",
    };
    h.emitFromBackend({
      type: "gg:status",
      chatId: "chat-a",
      run: runA,
    });

    // While viewing chat-a: Stop button is shown on toolbar, and no floating Chat Head is shown for chat-a
    expect(h.actionsMount.querySelector(".gg-btn.is-running")).not.toBeNull();
    expect(
      h.actionsMount
        .querySelector('[data-gg-action="guided_response"]')
        ?.getAttribute("aria-label"),
    ).toBe("Stop Guided Response");
    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-a"]')).toBeNull();

    // 2. Switch to chat-b while chat-a continues running in background
    h.setChat("chat-b", { mounted: true, text: "Steer chat-b response" });
    h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
    await flushMicrotasks();

    // In chat-b: toolbar is NOT locked by chat-a's run (no Stop button; action buttons are enabled)
    expect(h.actionsMount.querySelector(".gg-btn.is-running")).toBeNull();
    const responseBtnB = h.actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="guided_response"]',
    )!;
    expect(responseBtnB).not.toBeNull();
    expect(responseBtnB.disabled).toBe(false);
    expect(responseBtnB.getAttribute("aria-label")).toBe("Guided Response");

    // Floating Chat Head for chat-a appears in document.body in running state
    let headA = document.body.querySelector<HTMLButtonElement>(
      '.gg-chat-head[data-chat-id="chat-a"]',
    );
    expect(headA).not.toBeNull();
    expect(headA?.classList.contains("is-running")).toBe(true);
    expect(headA?.classList.contains("is-streaming")).toBe(false);
    expect(headA?.getAttribute("aria-label")).toContain("Alpha Hero");

    // chat-a transitions to streaming (hasContentOutput: true)
    h.emitFromBackend({
      type: "gg:status",
      chatId: "chat-a",
      run: { ...runA, hasContentOutput: true },
    });
    headA = document.body.querySelector<HTMLButtonElement>(
      '.gg-chat-head[data-chat-id="chat-a"]',
    );
    expect(headA).not.toBeNull();
    expect(headA?.classList.contains("is-running")).toBe(true);
    expect(headA?.classList.contains("is-streaming")).toBe(true);

    // 3. Can trigger a guided action in chat-b while chat-a is still streaming in the background
    responseBtnB.click();
    await flushMicrotasks();
    const allRunRpcs = h.sentRpcs.filter((r) => r.action === "run_action");
    expect(allRunRpcs).toHaveLength(2);
    expect((allRunRpcs[1]!.input as { chatId: string }).chatId).toBe("chat-b");
    h.resolveLastRpc(
      { runId: "run-chat-b", actionId: "guided_response", chatId: "chat-b", aborted: false },
      "run_action",
    );
    await flushMicrotasks();

    // 4. Switching back to chat-a while chat-a is still streaming hides chat-a's Chat Head and shows chat-a's Stop button
    h.setChat("chat-a", { mounted: true, text: "" });
    h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
    await flushMicrotasks();

    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-a"]')).toBeNull();
    expect(h.actionsMount.querySelector(".gg-btn.is-running")).not.toBeNull();

    // Switch back to chat-b again while chat-a is still streaming
    h.setChat("chat-b", { mounted: true, text: "" });
    h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
    await flushMicrotasks();

    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-a"]')).not.toBeNull();
    expect(h.actionsMount.querySelector(".gg-btn.is-running")).toBeNull();

    // 5. chat-a completes while viewing chat-b -> Chat Head turns green (.is-completed) with notification pip
    h.emitFromBackend({
      type: "gg:status",
      chatId: "chat-a",
      run: null,
      done: true,
      aborted: false,
    });
    h.emitFromBackend({
      type: "gg:reply",
      requestId: runActionRpcsA[0]!.requestId,
      result: { runId: "run-chat-a", actionId: "guided_response", chatId: "chat-a", aborted: false },
    });
    await flushMicrotasks();

    headA = document.body.querySelector<HTMLButtonElement>(
      '.gg-chat-head[data-chat-id="chat-a"]',
    );
    expect(headA).not.toBeNull();
    expect(headA?.classList.contains("is-completed")).toBe(true);
    expect(headA?.classList.contains("is-running")).toBe(false);
    expect(headA?.querySelector(".gg-chat-head-pip")).not.toBeNull();

    // 6. Clicking the completed Chat Head invokes route navigation to chat-a and dismisses the completed indicator
    headA!.click();
    expect(invokedRoutes).toEqual([
      {
        ref: { kind: "route", id: "/chat/:chatId" },
        params: { chatId: "chat-a" },
      },
    ]);
    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-a"]')).toBeNull();
    expect(document.body.querySelector(".gg-chat-heads-root")).toBeNull();

    // 7. Background impersonate final draft arriving while viewing chat-b is buffered and applied when switching back to chat-a
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-a",
      text: "Buffered impersonation draft for chat-a",
      done: true,
      aborted: false,
    });
    expect(h.getComposerText()).toBe("");

    h.setChat("chat-a", { mounted: true, text: "" });
    h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
    await flushMicrotasks();
    expect(h.getComposerText()).toBe("Buffered impersonation draft for chat-a");

    teardown();
  });

  test("audit regressions: background CHAT_CHANGED preserves head, refresh statusSeq preserves concurrent runs, pendingImpersonateDrafts survives failed setText, and ChatHeadController handles sidebar/surfaces/img errors", async () => {
    // 1. CHAT_CHANGED on background chat-b does NOT hide/dismiss chat-b's active background head while viewing chat-a;
    //    refresh() statusSeq race preserves concurrent runs updated via gg:status while get_bootstrap is in flight;
    //    pendingImpersonateDrafts is NOT deleted when setText throws, and applies on subsequent CHAT_SWITCHED.
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
    await flushMicrotasks();

    // Start background run in chat-b while viewing chat-a
    const runB = {
      runId: "run-b-1",
      actionId: "guided_response" as const,
      chatId: "chat-b",
      startedAt: 2000,
      messageId: "msg-b1",
      swipeId: 0,
      hasContentOutput: false,
    };
    h.emitFromBackend({ type: "gg:status", chatId: "chat-b", run: runB });
    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-b"]')).not.toBeNull();

    // StreamingIndicator must NOT mount onto chat-a for chat-b's run
    expect(h.getInjectCounts().injectCalls).toBe(0);

    // Emit CHAT_CHANGED referencing background chat-b while active chat remains chat-a
    h.emitEvent("CHAT_CHANGED", { chatId: "chat-b" });
    await flushMicrotasks();
    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-b"]')).not.toBeNull();

    // Complete chat-b in background -> completed head appears; CHAT_CHANGED for chat-b still does not dismiss it
    h.emitFromBackend({
      type: "gg:status",
      chatId: "chat-b",
      run: null,
      done: true,
      aborted: false,
    });
    h.emitEvent("CHAT_CHANGED", { chatId: "chat-b" });
    await flushMicrotasks();
    const completedHeadB = document.body.querySelector<HTMLButtonElement>(
      '.gg-chat-head[data-chat-id="chat-b"]',
    );
    expect(completedHeadB?.classList.contains("is-completed")).toBe(true);

    // Trigger refresh(), then emit a new gg:status for chat-c BEFORE get_bootstrap resolves
    h.emitFromBackend({ type: "gg:changed", reason: "permissions" });
    const pendingBootstrap = h.sentRpcs.filter((r) => r.action === "get_bootstrap").at(-1)!;
    const runC = {
      runId: "run-c-1",
      actionId: "guided_response" as const,
      chatId: "chat-c",
      startedAt: 3000,
      hasContentOutput: true,
    };
    h.emitFromBackend({ type: "gg:status", chatId: "chat-c", run: runC });
    // Resolve stale get_bootstrap with activeRuns: [] -> newer chat-c run must survive!
    h.emitFromBackend({
      type: "gg:reply",
      requestId: pendingBootstrap.requestId,
      result: makeBootstrapView({ activeRun: null, activeRuns: [] }),
    });
    await flushMicrotasks();
    expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-c"]')).not.toBeNull();

    // pendingImpersonateDrafts: failing setText while viewing chat-a must NOT delete the buffered draft
    h.setComposerState({ throwOnWrite: true });
    h.emitFromBackend({
      type: "gg:impersonate-chunk",
      chatId: "chat-a",
      text: "Draft kept after setText error",
      done: true,
      aborted: false,
    });
    expect(h.getComposerText()).toBe("");

    // Switch away and back with working composer -> buffered draft is applied!
    h.setChat("chat-b", { mounted: true, text: "" });
    h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
    h.setComposerState({ throwOnWrite: false });
    h.setChat("chat-a", { mounted: true, text: "" });
    h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
    await flushMicrotasks();
    expect(h.getComposerText()).toBe("Draft kept after setText error");

    teardown();

    // 2. ChatHeadController unit regressions:
    //    - sidebar [data-chat-id] does NOT trigger hasNativeChatHead false positive
    //    - img error swaps to initials in-place without rebuilding rootEl or sibling heads
    //    - surfaces.invoke async rejection falls back to history.pushState + popstate and dismisses completed head
    const sidebarItem = document.createElement("div");
    sidebarItem.setAttribute("data-chat-id", "chat-bg-1");
    document.body.append(sidebarItem);

    const nativeHeadHost = document.createElement("div");
    const nativeHead = document.createElement("button");
    nativeHead.setAttribute("data-head-idx", "0");
    nativeHead.setAttribute("data-chat-id", "chat-native");
    nativeHeadHost.append(nativeHead);
    document.body.append(nativeHeadHost);

    const win = document.defaultView!;
    const popstateEvents: string[] = [];
    const origPushState = win.history.pushState.bind(win.history);
    const pushStateCalls: string[] = [];
    win.history.pushState = ((_data: unknown, _unused: string, url?: string | URL | null) => {
      pushStateCalls.push(String(url ?? ""));
    }) as typeof win.history.pushState;
    const onPopState = () => popstateEvents.push(win.location.pathname);
    win.addEventListener("popstate", onPopState);

    const headCtx = {
      getActiveChat: () => ({ chatId: "chat-active" }),
      events: { on: () => () => {} },
      host: {
        surfaces: {
          invoke: () => Promise.reject(new Error("surface unavailable")),
        },
      },
    } as unknown as SpindleFrontendContext;

    const controller = new ChatHeadController(headCtx);
    try {
      controller.syncRuns(
        [
          {
            runId: "r-bg-1",
            actionId: "guided_response",
            chatId: "chat-bg-1",
            startedAt: 100,
            characterName: "Aria Vance",
            avatarUrl: "/api/v1/characters/c1/avatar",
          },
          {
            runId: "r-bg-2",
            actionId: "guided_response",
            chatId: "chat-bg-2",
            startedAt: 101,
            characterName: "Kai Thorne",
            avatarUrl: "/api/v1/characters/c2/avatar",
          },
          {
            runId: "r-native",
            actionId: "guided_response",
            chatId: "chat-native",
            startedAt: 102,
          },
        ],
        "chat-active",
      );

      // Sidebar [data-chat-id] did NOT hide chat-bg-1; real native [data-head-idx][data-chat-id] DID hide chat-native
      const head1 = document.body.querySelector<HTMLButtonElement>('.gg-chat-head[data-chat-id="chat-bg-1"]');
      const head2 = document.body.querySelector<HTMLButtonElement>('.gg-chat-head[data-chat-id="chat-bg-2"]');
      expect(head1).not.toBeNull();
      expect(head2).not.toBeNull();
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-native"]')).toBeNull();

      // img error on head1 replaces just that <img> with initials in-place without rebuilding rootEl or head2
      const rootBefore = document.body.querySelector(".gg-chat-heads-root");
      const img1 = head1!.querySelector("img.gg-chat-head-avatar")!;
      img1.dispatchEvent(new (document.defaultView!.Event)("error"));
      expect(document.body.querySelector(".gg-chat-heads-root")).toBe(rootBefore);
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-bg-2"]')).toBe(head2);
      expect(head1!.querySelector("img.gg-chat-head-avatar")).toBeNull();
      expect(head1!.querySelector(".gg-chat-head-initials")?.textContent).toBe("AV");

      // Complete chat-bg-1, click it -> surfaces.invoke rejects -> falls back to history.pushState + popstate -> dismisses completed head
      controller.handleStatusEvent(
        { type: "gg:status", chatId: "chat-bg-1", run: null, done: true, aborted: false },
        "chat-active",
      );
      const completed1 = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head[data-chat-id="chat-bg-1"]',
      )!;
      expect(completed1.classList.contains("is-completed")).toBe(true);
      completed1.click();
      await flushMicrotasks();
      await flushMicrotasks();
      expect(pushStateCalls).toEqual(["/chat/chat-bg-1"]);
      expect(popstateEvents).toHaveLength(1);
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-bg-1"]')).toBeNull();
    } finally {
      controller.destroy();
      win.removeEventListener("popstate", onPopState);
      win.history.pushState = origPushState;
      sidebarItem.remove();
      nativeHeadHost.remove();
    }
  });

  test("post-audit polish: ChatHeadController deferred setPointerCapture, drag persistence, collision bounds, dismissal, resize clamp, custom avatarUrl + negative cache", async () => {
    const win = document.defaultView!;
    const origInnerWidth = win.innerWidth;
    const origInnerHeight = win.innerHeight;
    const origLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

    const storeMap = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
      clear: () => storeMap.clear(),
      key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
      get length() {
        return storeMap.size;
      },
    } as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = fakeStorage;

    Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });

    const navCalls: string[] = [];
    const charGetCalls: string[] = [];
    const headCtx = {
      getActiveChat: () => ({ chatId: "chat-active" }),
      events: { on: () => () => {} },
      characters: {
        get: async (id: string) => {
          charGetCalls.push(id);
          if (id === "char-custom") {
            return { id, name: "Custom Avatar", avatarUrl: "https://cdn.example/custom.png" };
          }
          if (id === "char-empty") {
            return null;
          }
          return { id, name: "Fallback" };
        },
      },
      host: {
        surfaces: {
          invoke: (_ref: unknown, params: { chatId: string }) => {
            navCalls.push(params.chatId);
            return Promise.resolve();
          },
        },
      },
    } as unknown as SpindleFrontendContext;

    const controller = new ChatHeadController(headCtx);
    try {
      // 1. Custom avatarUrl override + negative caching on char-empty
      controller.syncRuns(
        [
          {
            runId: "r-custom",
            actionId: "guided_response",
            chatId: "chat-custom",
            startedAt: 10,
            characterId: "char-custom",
            avatarUrl: "/api/v1/characters/char-custom/avatar?thumb=1",
          } as unknown as Parameters<ChatHeadController["syncRuns"]>[0] extends Iterable<infer T> ? T : never,
          {
            runId: "r-empty",
            actionId: "guided_response",
            chatId: "chat-empty",
            startedAt: 11,
            characterId: "char-empty",
          } as unknown as Parameters<ChatHeadController["syncRuns"]>[0] extends Iterable<infer T> ? T : never,
        ],
        "chat-active",
      );
      await flushMicrotasks();

      const customImg = document.body.querySelector<HTMLImageElement>(
        '.gg-chat-head[data-chat-id="chat-custom"] img.gg-chat-head-avatar',
      )!;
      expect(customImg.src).toBe("https://cdn.example/custom.png");

      // Repeated syncRuns for char-empty must NOT re-query characters.get (negative cached)
      expect(charGetCalls.filter((id) => id === "char-empty")).toHaveLength(1);
      controller.syncRuns(
        [
          {
            runId: "r-custom",
            actionId: "guided_response",
            chatId: "chat-custom",
            startedAt: 10,
            characterId: "char-custom",
          } as unknown as Parameters<ChatHeadController["syncRuns"]>[0] extends Iterable<infer T> ? T : never,
          {
            runId: "r-empty",
            actionId: "guided_response",
            chatId: "chat-empty",
            startedAt: 11,
            characterId: "char-empty",
          } as unknown as Parameters<ChatHeadController["syncRuns"]>[0] extends Iterable<infer T> ? T : never,
        ],
        "chat-active",
      );
      await flushMicrotasks();
      expect(charGetCalls.filter((id) => id === "char-empty")).toHaveLength(1);

      // 2. Deferred setPointerCapture: NOT called on pointerdown or <=6px move, click navigates
      const rootEl = document.body.querySelector<HTMLDivElement>(".gg-chat-heads-root")!;
      const captureCalls: number[] = [];
      const releaseCalls: number[] = [];
      let capturedId: number | null = null;
      rootEl.setPointerCapture = (id: number) => {
        capturedId = id;
        captureCalls.push(id);
      };
      rootEl.hasPointerCapture = (id: number) => capturedId === id;
      rootEl.releasePointerCapture = (id: number) => {
        if (capturedId === id) capturedId = null;
        releaseCalls.push(id);
      };

      const PointerEvt = win.PointerEvent;
      const customBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head[data-chat-id="chat-custom"]',
      )!;

      customBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 7,
          pointerType: "mouse",
          button: 0,
          clientX: 900,
          clientY: 200,
        }),
      );
      // Small move <= 6px
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 7,
          pointerType: "mouse",
          clientX: 903,
          clientY: 204,
        }),
      );
      expect(captureCalls).toEqual([]);
      document.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          pointerId: 7,
          pointerType: "mouse",
          clientX: 903,
          clientY: 204,
        }),
      );
      customBtn.click();
      await flushMicrotasks();
      expect(navCalls).toEqual(["chat-custom"]);

      // 3. Drag >6px calls setPointerCapture, suppresses click, and persists gg:chatHeadsPos
      customBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 9,
          pointerType: "mouse",
          button: 0,
          clientX: 900,
          clientY: 200,
        }),
      );
      expect(captureCalls).toEqual([]);
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 9,
          pointerType: "mouse",
          clientX: 800,
          clientY: 240,
        }),
      );
      expect(captureCalls).toEqual([9]);
      document.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          pointerId: 9,
          pointerType: "mouse",
          clientX: 800,
          clientY: 240,
        }),
      );
      expect(releaseCalls).toEqual([9]);
      customBtn.click();
      await flushMicrotasks();
      expect(navCalls).toEqual(["chat-custom"]);
      const savedPos = JSON.parse(storeMap.get("gg:chatHeadsPos") ?? "null");
      expect(savedPos).toEqual({
        xPct: expect.any(Number),
        yPct: expect.any(Number),
      });
      expect(savedPos.xPct).toBeLessThan(94);

      // 4. Resize clamps root position within viewport bounds
      Object.defineProperty(win, "innerWidth", { value: 180, configurable: true });
      Object.defineProperty(win, "innerHeight", { value: 160, configurable: true });
      win.dispatchEvent(new win.Event("resize"));
      const leftPct = parseFloat(rootEl.style.left);
      const topPct = parseFloat(rootEl.style.top);
      expect(leftPct).toBeGreaterThanOrEqual(0);
      expect(leftPct).toBeLessThanOrEqual(100);
      expect(topPct).toBeGreaterThanOrEqual(0);
      expect(topPct).toBeLessThanOrEqual(100);

      // 5. Native chat head collision avoidance respects min/max bounds
      Object.defineProperty(win, "innerWidth", { value: 1000, configurable: true });
      Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
      const nativeContainer = document.createElement("div");
      const nativeBtn = document.createElement("button");
      nativeBtn.setAttribute("data-head-idx", "0");
      nativeBtn.setAttribute("data-chat-id", "chat-native-other");
      nativeContainer.append(nativeBtn);
      nativeContainer.getBoundingClientRect = () =>
        ({
          left: 800,
          top: 160,
          right: 880,
          bottom: 780, // belowCy would exceed maxY -> must pick aboveCy or leftCx!
          width: 80,
          height: 620,
          x: 800,
          y: 160,
          toJSON: () => ({}),
        }) as DOMRect;
      document.body.append(nativeContainer);
      // Re-position near nativeContainer (84% x 25%) and verify avoidance keeps it inside bounds
      storeMap.set("gg:chatHeadsPos", JSON.stringify({ xPct: 84, yPct: 25 }));
      const collisionController = new ChatHeadController(headCtx);
      collisionController.syncRuns(
        [
          {
            runId: "r-col",
            actionId: "guided_response",
            chatId: "chat-col",
            startedAt: 1,
          },
        ],
        "chat-active",
      );
      const colRoot = document.body.querySelectorAll<HTMLDivElement>(".gg-chat-heads-root")[1]!;
      const colTopPx = (parseFloat(colRoot.style.top) / 100) * 800;
      const colLeftPx = (parseFloat(colRoot.style.left) / 100) * 1000;
      // Either nudged above native (top <= 160) or left of native (left <= 800), and still in viewport
      expect(colTopPx < 160 || colLeftPx < 800).toBe(true);
      expect(colTopPx).toBeGreaterThanOrEqual(12);
      expect(colLeftPx).toBeGreaterThanOrEqual(12);
      collisionController.destroy();
      nativeContainer.remove();

      // 6. × dismiss button & contextmenu dismiss completed heads
      controller.handleStatusEvent(
        { type: "gg:status", chatId: "chat-custom", run: null, done: true, aborted: false },
        "chat-active",
      );
      controller.handleStatusEvent(
        { type: "gg:status", chatId: "chat-empty", run: null, done: true, aborted: false },
        "chat-active",
      );
      const dismissBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head-item:has([data-chat-id="chat-custom"]) [data-gg-chat-head-dismiss]',
      ) ?? document.body.querySelector<HTMLButtonElement>('[data-gg-chat-head-dismiss]')!;
      dismissBtn.click();
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-custom"]')).toBeNull();

      const emptyCompletedBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head[data-chat-id="chat-empty"]',
      )!;
      emptyCompletedBtn.dispatchEvent(new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-empty"]')).toBeNull();
    } finally {
      controller.destroy();
      Object.defineProperty(win, "innerWidth", { value: origInnerWidth, configurable: true });
      Object.defineProperty(win, "innerHeight", { value: origInnerHeight, configurable: true });
      if (origLocalStorage === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as unknown as { localStorage: Storage }).localStorage = origLocalStorage;
      }
    }
  });

  test("post-audit polish: CHAT_DELETED and MESSAGE_DELETED cleanup across frontend, ChatHeadController, and PillMetricsController, plus truncated tail wider read", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // Background run + queued impersonate draft in chat-b, plus active run in chat-a
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-b",
        run: {
          runId: "r-b",
          actionId: "guided_response",
          chatId: "chat-b",
          startedAt: 100,
          hasContentOutput: true,
        },
      });
      h.emitFromBackend({
        type: "gg:impersonate-chunk",
        chatId: "chat-b",
        text: "Draft for deleted chat",
        done: true,
        aborted: false,
      });
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-b"]')).not.toBeNull();

      // Queue PillMetrics for chat-b msg-b1 (not in active tail yet) and chat-a msg-a1
      h.setCustomGetMessages(async (chatId, opts) => {
        if (chatId === "chat-b") {
          return { data: [], total: 10 }; // truncated page (total > data.length even when data.length < 50!)
        }
        return {
          data:
            opts?.limit === 200
              ? [{ id: "msg-a-old", chat_id: "chat-a", swipe_id: 0, extra: {} }]
              : [{ id: "msg-a-recent", chat_id: "chat-a", swipe_id: 0, extra: {} }],
          total: 10, // total=10 > data.length=1 => isPageTruncated true even though length < 50
        };
      });

      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-b",
        messageId: "msg-b1",
        swipeId: 0,
        tokenCount: 42,
      });
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-a-old",
        swipeId: 0,
        tokenCount: 99,
      });
      await flushMicrotasks();
      await flushMicrotasks();

      // msg-a-old was found via wider tail read (limit: 200) even though initial page had < 50 items
      expect(h.getGetMessagesCalls().some((c) => c.chatId === "chat-a" && c.options?.limit === 200)).toBe(true);
      expect(h.getUpdateMessageCalls().some((u) => u.messageId === "msg-a-old")).toBe(true);

      // Now queue another metrics entry for chat-a msg-a-del while on swipe 1 (currently swipe 0), then emit MESSAGE_DELETED
      h.setCustomGetMessages(async () => ({
        data: [{ id: "msg-a-del", chat_id: "chat-a", swipe_id: 0, extra: {} }],
        total: 1,
      }));
      h.emitFromBackend({
        type: "gg:generation_metrics",
        chatId: "chat-a",
        messageId: "msg-a-del",
        swipeId: 1,
        tokenCount: 55,
      });
      await flushMicrotasks();
      const updatesBeforeMsgDel = h.getUpdateMessageCalls().length;
      h.emitEvent("MESSAGE_DELETED", { chatId: "chat-a", messageId: "msg-a-del" });
      // Even if a MESSAGE_SWIPED arrives afterwards, queued metrics were dropped on MESSAGE_DELETED
      h.emitEvent("MESSAGE_SWIPED", { chatId: "chat-a", message: { id: "msg-a-del", swipe_id: 1 } });
      await flushMicrotasks();
      expect(h.getUpdateMessageCalls().length).toBe(updatesBeforeMsgDel);

      // CHAT_DELETED clears chat-b's head, pending impersonate draft, and pending metrics
      h.emitEvent("CHAT_DELETED", { chatId: "chat-b" });
      await flushMicrotasks();
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-b"]')).toBeNull();

      // Switching to chat-b must NOT populate the deleted chat's impersonate draft
      h.setChat("chat-b", { mounted: true, text: "" });
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
      await flushMicrotasks();
      expect(h.getComposerText()).toBe("");
    } finally {
      teardown();
    }
  });

  test("post-audit polish: pendingImpersonateDrafts retries when composer chatId lags behind CHAT_SWITCHED and survives interleaved refresh()", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-b",
      composerMounted: true,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      // 1. Impersonate completes for chat-a while viewing chat-b
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: {
          runId: "imp-a",
          actionId: "guided_impersonate",
          chatId: "chat-a",
          startedAt: 100,
        },
      });
      h.emitFromBackend({
        type: "gg:impersonate-chunk",
        chatId: "chat-a",
        text: "Retried draft for chat-a",
        done: true,
        aborted: false,
      });

      // 2. Interleaved refresh() clears activeRunsByChat before terminal gg:status(run: null) arrives
      h.emitFromBackend({ type: "gg:changed", reason: "settings" });
      h.resolveLastRpc(makeBootstrapView({ activeRun: null, activeRuns: [] }), "get_bootstrap");
      await flushMicrotasks();

      // Terminal gg:status with run: null (prevEventChatRun is undefined) must NOT drop chat-a's buffered draft
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: null,
        done: true,
        aborted: false,
      });

      // 3. Switch to chat-a while composer.getState().chatId lags behind at "chat-b"
      h.setChat("chat-a", { mounted: true, text: "" });
      h.setComposerState({ chatId: "chat-b" });
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
      expect(h.getComposerText()).toBe("");

      // Composer catches up to "chat-a" before retry timer fires -> retry applies the buffered draft!
      h.setComposerState({ chatId: "chat-a" });
      await new Promise((r) => setTimeout(r, 35));
      expect(h.getComposerText()).toBe("Retried draft for chat-a");
    } finally {
      teardown();
    }
  });

  test("post-audit polish: rebuildDrawer: true does not tear down drawer twice when saved settings match optimistic settings", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
    });
    const teardown = setup(h.ctx);
    try {
      const initialView = makeBootstrapView();
      h.resolveLastRpc(initialView, "get_bootstrap");
      await flushMicrotasks();

      const tabRoot = h.tabRoot;
      const beforeCounts = h.getDestroyCounts();

      // Trigger a rebuildDrawer: true save via "Move down" button in buttonOrder
      const moveDownBtn = tabRoot.querySelector<HTMLButtonElement>(
        '.gg-order-item button[aria-label^="Move "][aria-label$=" down"]',
      )!;
      expect(moveDownBtn).not.toBeNull();
      moveDownBtn.click();

      // Optimistic rebuild tore down components once
      const afterOptimistic = h.getDestroyCounts();
      expect(afterOptimistic.textArea).toBeGreaterThan(beforeCounts.textArea);
      expect(afterOptimistic.combobox).toBeGreaterThan(beforeCounts.combobox);

      // Resolve save_settings with the exact optimistic settings payload
      const saveReq = h.sentRpcs.filter((r) => r.action === "save_settings").at(-1)!;
      h.emitFromBackend({
        type: "gg:reply",
        requestId: saveReq.requestId,
        result: saveReq.input,
      });
      await flushMicrotasks();

      // Drawer must NOT tear down a second time when saved equals view.settings!
      expect(h.getDestroyCounts()).toEqual(afterOptimistic);
    } finally {
      teardown();
    }
  });

  test("mobile touch drag: ignores child bubbling lostpointercapture, handles direct root lostpointercapture, prevents touchmove scroll, ignores 2nd touch, preserves button across status updates, uses rendered startPos, and applies mobile CSS", async () => {
    const win = document.defaultView!;
    const origInnerWidth = win.innerWidth;
    const origInnerHeight = win.innerHeight;
    const origLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

    const storeMap = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
      clear: () => storeMap.clear(),
      key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
      get length() {
        return storeMap.size;
      },
    } as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = fakeStorage;

    Object.defineProperty(win, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(win, "innerHeight", { value: 844, configurable: true });

    const navCalls: string[] = [];
    const headCtx = {
      getActiveChat: () => ({ chatId: "chat-active" }),
      events: { on: () => () => {} },
      host: {
        surfaces: {
          invoke: (_ref: unknown, params: { chatId: string }) => {
            navCalls.push(params.chatId);
            return Promise.resolve();
          },
        },
      },
    } as unknown as SpindleFrontendContext;

    const controller = new ChatHeadController(headCtx);
    try {
      controller.syncRuns(
        [
          {
            runId: "r-touch",
            actionId: "guided_response",
            chatId: "chat-touch",
            startedAt: 100,
            characterName: "Touch Hero",
          },
        ],
        "chat-active",
      );

      const rootEl = document.body.querySelector<HTMLDivElement>(".gg-chat-heads-root")!;
      const btn = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head[data-chat-id="chat-touch"]',
      )!;
      const PointerEvt = win.PointerEvent;

      // Narrow mobile viewport (390x844) clamps default 94% right-edge position
      const initialLeftPct = parseFloat(rootEl.style.left);
      const initialTopPct = parseFloat(rootEl.style.top);
      expect(initialLeftPct).toBeLessThan(94);

      const captureCalls: number[] = [];
      const releaseCalls: number[] = [];
      let capturedId: number | null = null;
      let emitChildLossOnCapture = true;
      rootEl.setPointerCapture = (id: number) => {
        capturedId = id;
        captureCalls.push(id);
        // Simulate implicit touch capture transfer from child button to root
        if (emitChildLossOnCapture) {
          btn.dispatchEvent(
            new PointerEvt("lostpointercapture", {
              bubbles: true,
              pointerId: id,
              pointerType: "touch",
            }),
          );
        }
      };
      rootEl.hasPointerCapture = (id: number) => capturedId === id;
      rootEl.releasePointerCapture = (id: number) => {
        if (capturedId === id) capturedId = null;
        releaseCalls.push(id);
      };

      // 1. Touch pointerdown + move past 6px -> bubbling lostpointercapture must NOT drop drag,
      //    and rendered startPos avoids dead-zone lag when dragging left from clamped edge
      btn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          button: 0,
          clientX: 340,
          clientY: 185,
        }),
      );
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          clientX: 325,
          clientY: 185,
        }),
      );
      expect(captureCalls).toEqual([11]);
      expect(releaseCalls).toEqual([]);
      expect(rootEl.classList.contains("is-dragging")).toBe(true);
      const afterFirstMoveLeft = parseFloat(rootEl.style.left);
      expect(afterFirstMoveLeft).toBeLessThan(initialLeftPct);

      // Move further smoothly
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          clientX: 250,
          clientY: 260,
        }),
      );
      const afterSecondMoveLeft = parseFloat(rootEl.style.left);
      const afterSecondMoveTop = parseFloat(rootEl.style.top);
      expect(afterSecondMoveLeft).toBeLessThan(afterFirstMoveLeft);
      expect(afterSecondMoveTop).toBeGreaterThan(initialTopPct);

      // Cancelable touchmove is prevented mid-drag
      const touchMoveEv = new win.Event("touchmove", { bubbles: true, cancelable: true });
      document.dispatchEvent(touchMoveEv);
      expect(touchMoveEv.defaultPrevented).toBe(true);

      // Second finger touch pointerdown does not abort pointer 11's drag
      btn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 12,
          pointerType: "touch",
          button: 0,
          clientX: 240,
          clientY: 265,
        }),
      );
      expect(rootEl.classList.contains("is-dragging")).toBe(true);
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          clientX: 180,
          clientY: 340,
        }),
      );
      const afterMultiTouchLeft = parseFloat(rootEl.style.left);
      const afterMultiTouchTop = parseFloat(rootEl.style.top);
      expect(afterMultiTouchLeft).toBeLessThan(afterSecondMoveLeft);
      expect(afterMultiTouchTop).toBeGreaterThan(afterSecondMoveTop);

      // Status transitions (running -> streaming -> completed) preserve button identity and keep drag alive
      controller.handleStatusEvent(
        {
          type: "gg:status",
          chatId: "chat-touch",
          run: {
            runId: "r-touch",
            actionId: "guided_response",
            chatId: "chat-touch",
            startedAt: 100,
            hasContentOutput: true,
            characterName: "Touch Hero",
          },
        },
        "chat-active",
      );
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-touch"]')).toBe(btn);
      expect(btn.classList.contains("is-streaming")).toBe(true);

      controller.handleStatusEvent(
        { type: "gg:status", chatId: "chat-touch", run: null, done: true, aborted: false },
        "chat-active",
      );
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-touch"]')).toBe(btn);
      expect(btn.classList.contains("is-completed")).toBe(true);

      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          clientX: 120,
          clientY: 420,
        }),
      );
      const beforeUpLeft = parseFloat(rootEl.style.left);
      const beforeUpTop = parseFloat(rootEl.style.top);
      expect(beforeUpLeft).toBeLessThan(afterMultiTouchLeft);
      expect(beforeUpTop).toBeGreaterThan(afterMultiTouchTop);

      // Pointerup finishes drag cleanly, persists position, and suppresses trailing click
      document.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          clientX: 120,
          clientY: 420,
        }),
      );
      expect(releaseCalls).toEqual([11]);
      expect(rootEl.classList.contains("is-dragging")).toBe(false);
      const persistedAfterUp = JSON.parse(storeMap.get("gg:chatHeadsPos") ?? "null");
      expect(persistedAfterUp).toEqual({
        xPct: expect.any(Number),
        yPct: expect.any(Number),
      });
      expect(persistedAfterUp.xPct).toBeCloseTo(beforeUpLeft, 3);
      expect(persistedAfterUp.yPct).toBeCloseTo(beforeUpTop, 3);

      btn.click();
      await flushMicrotasks();
      expect(navCalls).toEqual([]);

      // 2. Direct lostpointercapture on rootEl (target === rootEl) ends drag cleanly and persists position
      emitChildLossOnCapture = false;
      btn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 21,
          pointerType: "touch",
          button: 0,
          clientX: 120,
          clientY: 420,
        }),
      );
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 21,
          pointerType: "touch",
          clientX: 210,
          clientY: 460,
        }),
      );
      expect(rootEl.classList.contains("is-dragging")).toBe(true);
      const leftBeforeRootLoss = parseFloat(rootEl.style.left);
      expect(leftBeforeRootLoss).toBeGreaterThan(persistedAfterUp.xPct);

      rootEl.dispatchEvent(
        new PointerEvt("lostpointercapture", {
          bubbles: true,
          pointerId: 21,
          pointerType: "touch",
        }),
      );
      expect(rootEl.classList.contains("is-dragging")).toBe(false);
      const persistedAfterLoss = JSON.parse(storeMap.get("gg:chatHeadsPos") ?? "null");
      expect(persistedAfterLoss.xPct).toBeCloseTo(leftBeforeRootLoss, 3);

      // 3. Mobile CSS declarations check
      const rootCssMatch = GUIDED_GENERATIONS_CSS.match(/(?:^|\n)\.gg-chat-heads-root\s*\{([^}]*)\}/);
      const headCssMatch = GUIDED_GENERATIONS_CSS.match(/(?:^|\n)\.gg-chat-head\s*\{([^}]*)\}/);
      expect(rootCssMatch?.[1]).toContain("overflow: visible;");
      expect(rootCssMatch?.[1]).not.toContain("overflow-y: auto");
      expect(headCssMatch?.[1]).toContain("touch-action: none;");
      expect(headCssMatch?.[1]).toContain("-webkit-touch-callout: none;");
    } finally {
      controller.destroy();
      Object.defineProperty(win, "innerWidth", { value: origInnerWidth, configurable: true });
      Object.defineProperty(win, "innerHeight", { value: origInnerHeight, configurable: true });
      if (origLocalStorage === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as unknown as { localStorage: Storage }).localStorage = origLocalStorage;
      }
    }
  });

  test("lazy settings drawer (detached tabRoot): defers component mounts and catalogs until activateDrawer(), ignores connections.subscribe while unmounted, and buffers notice/busy/recovery safely", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      detachDrawerTab: true,
      composerMounted: true,
      composerText: "",
      frontendConnectionsFallback: [
        {
          id: "fb-1",
          name: "Fallback Profile",
          provider: "openai",
          model: "gpt-4o-mini",
          is_default: true,
        },
      ],
    });
    const teardown = setup(h.ctx);
    try {
      expect(h.tabRoot.isConnected).toBe(false);

      // Startup refresh requests get_bootstrap with { includeCatalogs: false }
      const startupBootstraps = h.sentRpcs.filter((r) => r.action === "get_bootstrap");
      expect(startupBootstraps).toHaveLength(1);
      expect(startupBootstraps[0]!.input).toEqual({ includeCatalogs: false });

      h.resolveLastRpc(
        makeBootstrapView({ connections: [], presets: [], recovery: [] }),
        "get_bootstrap",
      );
      await flushMicrotasks();

      // Zero drawer components mounted and frontend connections fallback NOT invoked
      expect(h.getMountCounts()).toEqual({
        switch: 0,
        select: 0,
        combobox: 0,
        textArea: 0,
      });
      expect(h.tabRoot.children.length).toBe(0);
      expect(h.getConnectionsListCalls()).toBe(0);

      // Toolbar IS still rendered and functional while drawer is unmounted
      expect(h.actionsMount.querySelectorAll("button")).toHaveLength(6);

      // connections.subscribe is ignored while drawer is unmounted
      h.emitConnectionsChange();
      await flushMicrotasks();
      expect(h.sentRpcs.filter((r) => r.action === "get_bootstrap")).toHaveLength(1);

      // Buffer notice (empty guided_response), busy state (activeRun), and recovery entry while unmounted
      const responseBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_response"]',
      )!;
      responseBtn.click();
      await flushMicrotasks();
      expect(h.alertMount.textContent).toContain("Type guidance");

      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: {
          runId: "run-busy",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: Date.now(),
        },
      });
      const recEntry: RecoveryEntry = {
        id: "rec-buffered",
        text: "Buffered draft while unmounted",
        actionId: "guided_response",
        chatId: "chat-a",
        createdAt: 42,
      };
      h.emitFromBackend({
        type: "gg:recovery-updated",
        recovery: [recEntry],
      });
      await flushMicrotasks();

      // Still 0 drawer component mounts
      expect(h.getMountCounts()).toEqual({
        switch: 0,
        select: 0,
        combobox: 0,
        textArea: 0,
      });
      expect(h.tabRoot.children.length).toBe(0);

      // Opening drawer mounts synchronously with buffered notice, recovery, and busy state,
      // AND immediately requests get_bootstrap({ includeCatalogs: true })
      h.activateDrawer();

      expect(h.getMountCounts()).toEqual({
        switch: 16,
        select: 21,
        combobox: 5,
        textArea: 5,
      });
      expect(h.tabRoot.querySelector(".gg-notice")?.textContent).toContain("Type guidance");
      const restoreBtn = h.tabRoot.querySelector<HTMLButtonElement>(".gg-recovery-item button");
      expect(restoreBtn).not.toBeNull();
      expect(restoreBtn!.disabled).toBe(true);
      const clearBtn = h.tabRoot.querySelector<HTMLButtonElement>(
        'button[data-gg-focus-key="clear-recovery"]',
      )!;
      expect(clearBtn.disabled).toBe(true);

      const postActivateBootstraps = h.sentRpcs.filter((r) => r.action === "get_bootstrap");
      expect(postActivateBootstraps).toHaveLength(2);
      expect(postActivateBootstraps[1]!.input).toEqual({ includeCatalogs: true });

      // Resolving the catalog bootstrap triggers frontend connection fallback and re-renders with catalogs
      const catalogView = makeBootstrapView({
        connections: [],
        presets: [{ id: "p-fresh", name: "Fresh Preset" }],
        recovery: [recEntry],
      });
      h.resolveLastRpc(catalogView, "get_bootstrap");
      await flushMicrotasks();
      expect(h.getConnectionsListCalls()).toBe(1);

      // Re-activating drawer when nothing changed uses onlyIfChanged + areJsonValuesEqual (zero teardown)
      const destroysAfterCatalogLoad = h.getDestroyCounts();
      h.activateDrawer();
      const thirdBootstraps = h.sentRpcs.filter((r) => r.action === "get_bootstrap");
      expect(thirdBootstraps).toHaveLength(3);
      expect(thirdBootstraps[2]!.input).toEqual({ includeCatalogs: true });
      h.resolveLastRpc(catalogView, "get_bootstrap");
      await flushMicrotasks();
      expect(h.getDestroyCounts()).toEqual(destroysAfterCatalogLoad);

      // Once drawer is mounted, connections.subscribe DOES trigger catalog refresh
      h.emitConnectionsChange();
      const fourthBootstraps = h.sentRpcs.filter((r) => r.action === "get_bootstrap");
      expect(fourthBootstraps).toHaveLength(4);
      expect(fourthBootstraps[3]!.input).toEqual({ includeCatalogs: true });
    } finally {
      teardown();
    }
  });

  test("lazy settings drawer edge cases: pre-bootstrap activation renders loading state cleanly, and custom-docked containers mount via getTabLocation or IntersectionObserver", async () => {
    // 1. Activating before initial get_bootstrap resolves shows loading UI synchronously
    //    and supersedes stale { includeCatalogs: false } response
    const h1 = createFrontendHarness({ initialChatId: "chat-a", detachDrawerTab: true });
    const teardown1 = setup(h1.ctx);
    try {
      const req1 = h1.sentRpcs.filter((r) => r.action === "get_bootstrap")[0]!;
      expect(req1.input).toEqual({ includeCatalogs: false });

      h1.activateDrawer();
      expect(h1.tabRoot.textContent).toContain("Loading Guided Generations settings");
      expect(h1.getMountCounts()).toEqual({ switch: 0, select: 0, combobox: 0, textArea: 0 });

      const req2 = h1.sentRpcs.filter((r) => r.action === "get_bootstrap")[1]!;
      expect(req2.input).toEqual({ includeCatalogs: true });

      // Stale req1 resolves -> ignored
      h1.emitFromBackend({
        type: "gg:reply",
        requestId: req1.requestId,
        result: makeBootstrapView({ connections: [], presets: [] }),
      });
      await flushMicrotasks();
      expect(h1.getMountCounts()).toEqual({ switch: 0, select: 0, combobox: 0, textArea: 0 });

      // Fresh req2 resolves -> mounts full drawer
      h1.emitFromBackend({
        type: "gg:reply",
        requestId: req2.requestId,
        result: makeBootstrapView(),
      });
      await flushMicrotasks();
      expect(h1.getMountCounts()).toEqual({
        switch: 16,
        select: 21,
        combobox: 5,
        textArea: 5,
      });
    } finally {
      teardown1();
    }

    // 2. Tab already docked into a custom container at startup (getTabLocation !== main-drawer)
    const h2 = createFrontendHarness({
      initialChatId: "chat-a",
      detachDrawerTab: true,
      tabLocation: { kind: "container", containerId: "canvas-dock" },
    });
    const teardown2 = setup(h2.ctx);
    try {
      const req = h2.sentRpcs.filter((r) => r.action === "get_bootstrap")[0]!;
      expect(req.input).toEqual({ includeCatalogs: true });
      h2.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();
      expect(h2.getMountCounts()).toEqual({
        switch: 16,
        select: 21,
        combobox: 5,
        textArea: 5,
      });
    } finally {
      teardown2();
    }

    // 3. Tab starts detached in main-drawer and is later docked into a custom container
    //    observed via IntersectionObserver without onActivate ever firing
    const origIntersectionObserver = (
      globalThis as unknown as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver;
    const observerState: {
      callback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null;
      observedTarget: Element | null;
      disconnectCalls: number;
    } = {
      callback: null,
      observedTarget: null,
      disconnectCalls: 0,
    };

    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observerState.callback = cb;
      }
      observe(target: Element) {
        observerState.observedTarget = target;
      }
      disconnect() {
        observerState.disconnectCalls += 1;
      }
    };

    const h3 = createFrontendHarness({ initialChatId: "chat-a", detachDrawerTab: true });
    const teardown3 = setup(h3.ctx);
    try {
      expect(observerState.observedTarget).toBe(h3.tabRoot);
      expect(h3.sentRpcs.filter((r) => r.action === "get_bootstrap")[0]!.input).toEqual({
        includeCatalogs: false,
      });
      h3.resolveLastRpc(makeBootstrapView({ connections: [], presets: [] }), "get_bootstrap");
      await flushMicrotasks();

      // Initial non-intersecting delivery while detached must keep drawer unmounted
      observerState.callback?.([{ isIntersecting: false }]);
      expect(h3.getMountCounts()).toEqual({ switch: 0, select: 0, combobox: 0, textArea: 0 });
      expect(observerState.disconnectCalls).toBe(0);

      // ContainerTabContent appends tabRoot into a visible container -> observer fires
      document.body.append(h3.tabRoot);
      observerState.callback?.([{ isIntersecting: true }]);

      expect(observerState.disconnectCalls).toBe(1);
      expect(h3.getMountCounts()).toEqual({
        switch: 16,
        select: 21,
        combobox: 5,
        textArea: 5,
      });
      const postDockReq = h3.sentRpcs.filter((r) => r.action === "get_bootstrap")[1]!;
      expect(postDockReq.input).toEqual({ includeCatalogs: true });

      // 4. Direct SettingsDrawerController.destroy() disconnects any active observeTabConnection observer
      //    even if caller never invokes the returned disposer
      const directDisconnectBefore = observerState.disconnectCalls;
      const directTabRoot = document.createElement("div");
      const directDrawer = new SettingsDrawerController(
        {
          ui: {
            registerDrawerTab: () => ({
              root: directTabRoot,
              tabId: "gg-direct-tab",
              setTitle: () => {},
              setShortName: () => {},
              setBadge: () => {},
              activate: () => {},
              destroy: () => {},
              onActivate: () => () => {},
            }),
          },
        } as unknown as SpindleFrontendContext,
        {
          onRefresh: () => {},
          onSaveSettings: async () => {},
          onRestoreEntry: () => {},
          onClearRecovery: async () => {},
        },
      );
      directDrawer.observeTabConnection(() => {});
      directDrawer.destroy();
      expect(observerState.disconnectCalls).toBe(directDisconnectBefore + 1);
    } finally {
      teardown3();
      if (origIntersectionObserver === undefined) {
        delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
      } else {
        (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
          origIntersectionObserver;
      }
    }

    // 5. Auto-detected tab connection inside refresh() renders drawer synchronously so an RPC failure
    //    displays its error notice inside the connected tab instead of leaving the tab blank
    const h4 = createFrontendHarness({ initialChatId: "chat-a", detachDrawerTab: true });
    const teardown4 = setup(h4.ctx);
    try {
      h4.resolveLastRpc(makeBootstrapView({ connections: [], presets: [] }), "get_bootstrap");
      await flushMicrotasks();
      expect(h4.tabRoot.children.length).toBe(0);

      // Tab becomes connected without onActivate (e.g. host container reparent), then gg:changed triggers refresh()
      document.body.append(h4.tabRoot);
      h4.emitFromBackend({ type: "gg:changed", reason: "permissions" });
      const failedReq = h4.sentRpcs.filter((r) => r.action === "get_bootstrap")[1]!;
      expect(failedReq.input).toEqual({ includeCatalogs: true });

      // Drawer already mounted synchronously before RPC settles
      expect(h4.tabRoot.querySelector(".gg-drawer")).not.toBeNull();

      // If get_bootstrap rejects, the error notice renders inside the connected tab (never blank)
      h4.rejectRpc(failedReq.requestId, "Bootstrap RPC failed");
      await flushMicrotasks();
      const drawerErrorNotice = h4.tabRoot.querySelector<HTMLElement>(".gg-notice.is-error");
      expect(drawerErrorNotice).not.toBeNull();
      expect(drawerErrorNotice!.textContent).toContain("Bootstrap RPC failed");
    } finally {
      teardown4();
    }
  });

  test("InputToolbarController.render() memoization preserves exact button DOM nodes on unchanged toolbar state and updates on toolbar-relevant changes", async () => {
    const h = createFrontendHarness({
      initialChatId: "chat-a",
      composerMounted: true,
      composerText: "",
    });
    const teardown = setup(h.ctx);
    try {
      h.resolveLastRpc(makeBootstrapView(), "get_bootstrap");
      await flushMicrotasks();

      const getButtons = () =>
        Array.from(h.actionsMount.querySelectorAll<HTMLButtonElement>("button"));
      const initialButtons = getButtons();
      expect(initialButtons).toHaveLength(6);

      const expectSameButtonRefs = (expected: HTMLButtonElement[]) => {
        const current = getButtons();
        expect(current).toHaveLength(expected.length);
        for (let i = 0; i < expected.length; i += 1) {
          expect(current[i]).toBe(expected[i]);
        }
      };

      // 1. Same-chat CHAT_CHANGED and duplicate chat.active preserve exact DOM button references
      h.emitEvent("CHAT_CHANGED", { chatId: "chat-a" });
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
      h.emitStateChange("chat.active", { chatId: "chat-a" });
      expectSameButtonRefs(initialButtons);

      // 2. Background-chat gg:status lifecycle (start -> streaming -> complete) preserves exact DOM nodes
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-b",
        run: {
          runId: "bg-1",
          actionId: "guided_response",
          chatId: "chat-b",
          startedAt: 100,
        },
      });
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-b",
        run: {
          runId: "bg-1",
          actionId: "guided_response",
          chatId: "chat-b",
          startedAt: 100,
          hasContentOutput: true,
        },
      });
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-b",
        run: null,
        done: true,
      });
      expectSameButtonRefs(initialButtons);

      // 3. Unrelated setting edit (instructionTemplate) preserves exact toolbar DOM nodes
      h.triggerLastTextAreaChange("Updated unrelated instruction template {{input}}");
      const firstTextarea = h.tabRoot.querySelector("textarea")!;
      firstTextarea.dispatchEvent(
        new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }),
      );
      await flushMicrotasks();
      expect(h.sentRpcs.filter((r) => r.action === "save_settings").length).toBeGreaterThanOrEqual(
        1,
      );
      expectSameButtonRefs(initialButtons);

      // 4. Active run start updates toolbar DOM; non-toolbar progress fields (hasContentOutput/messageId) preserve running DOM nodes
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: {
          runId: "fg-1",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: 200,
        },
      });
      const runningButtons = getButtons();
      const continueRunningBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_continue"]',
      )!;
      expect(continueRunningBtn.classList.contains("is-running")).toBe(true);
      expect(continueRunningBtn).not.toBe(initialButtons[1]);

      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: {
          runId: "fg-1",
          actionId: "guided_continue",
          chatId: "chat-a",
          startedAt: 200,
          hasContentOutput: true,
          messageId: "msg-1",
          swipeId: 0,
        },
      });
      expectSameButtonRefs(runningButtons);

      // Finish run -> idle buttons restored
      h.emitFromBackend({
        type: "gg:status",
        chatId: "chat-a",
        run: null,
        done: true,
      });
      const idleButtons = getButtons();
      expect(
        h.actionsMount
          .querySelector<HTMLButtonElement>('[data-gg-action="guided_continue"]')!
          .classList.contains("is-running"),
      ).toBe(false);

      // 5. Chat switch between two idle chats closes open Continue menu without tearing down buttons
      const continueBtn = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_continue"]',
      )!;
      continueBtn.dispatchEvent(
        new (document.defaultView!.MouseEvent)("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      );
      expect(document.body.querySelector(".gg-dropup-menu")).not.toBeNull();

      h.setChat("chat-b", { mounted: true, text: "" });
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-b" });
      expect(document.body.querySelector(".gg-dropup-menu")).toBeNull();
      expectSameButtonRefs(idleButtons);

      // 6. hasActiveChat change (chat-b -> null -> chat-a) updates disabled state properly
      h.setChat(null, { mounted: false, text: "" });
      h.emitEvent("CHAT_SWITCHED", { chatId: null });
      expect(
        h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_response"]')!
          .disabled,
      ).toBe(true);

      h.setChat("chat-a", { mounted: true, text: "" });
      h.emitEvent("CHAT_SWITCHED", { chatId: "chat-a" });
      expect(
        h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_response"]')!
          .disabled,
      ).toBe(false);

      // 7. Recovery updates: empty -> populated updates aria-label/title; adding older entry preserves button DOM
      //    while refreshing an open recovery History menu live; changing latest entry or emptying updates button DOM
      const rec1: RecoveryEntry = {
        id: "rec-1",
        text: "First saved draft",
        actionId: "guided_response",
        chatId: "chat-a",
        createdAt: 100,
      };
      const rec2: RecoveryEntry = {
        id: "rec-2",
        text: "Older saved draft",
        actionId: "guided_swipe",
        chatId: "chat-a",
        createdAt: 50,
      };
      const rec3: RecoveryEntry = {
        id: "rec-3",
        text: "Newest saved draft",
        actionId: "guided_continue",
        chatId: "chat-a",
        createdAt: 200,
      };

      h.emitFromBackend({ type: "gg:recovery-updated", recovery: [rec1] });
      const recBtnAfterFirst = h.actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="input_recovery"]',
      )!;
      expect(recBtnAfterFirst.getAttribute("aria-label")).toBe("Restore last input");
      expect(recBtnAfterFirst.title).toContain("First saved draft");

      const buttonsWithRec1 = getButtons();
      recBtnAfterFirst.dispatchEvent(
        new (document.defaultView!.MouseEvent)("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      );
      document.body
        .querySelector<HTMLButtonElement>('.gg-dropup-menu [data-gg-menu-action="history"]')!
        .click();
      expect(document.body.querySelectorAll('.gg-dropup-menu [role="menuitem"]')).toHaveLength(1);

      // Adding an older entry keeps recovery[0] identical -> toolbar buttons stay ===, open History menu updates live!
      h.emitFromBackend({ type: "gg:recovery-updated", recovery: [rec1, rec2] });
      expectSameButtonRefs(buttonsWithRec1);
      const liveHistoryItems = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>('.gg-dropup-menu [role="menuitem"]'),
      );
      expect(liveHistoryItems.map((el) => el.getAttribute("data-gg-recovery-id"))).toEqual([
        "rec-1",
        "rec-2",
      ]);

      // Changing latest entry updates recovery button title
      h.emitFromBackend({ type: "gg:recovery-updated", recovery: [rec3, rec1, rec2] });
      expect(
        h.actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!.title,
      ).toContain("Newest saved draft");

      // Emptying recovery updates aria-label back to Clear current input
      h.emitFromBackend({ type: "gg:recovery-updated", recovery: [] });
      expect(
        h.actionsMount
          .querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!
          .getAttribute("aria-label"),
      ).toBe("Clear current input");
    } finally {
      teardown();
    }

    // 8. Direct InputToolbarController checks for enabled, buttonOrder, placement/alignment,
    //    activeRun.runId swap, and external host detach recovery
    const abortedRunIds: string[] = [];
    const actionsMount = document.createElement("div");
    const rowMount = document.createElement("div");
    document.body.append(actionsMount, rowMount);

    const toolbar = new InputToolbarController(
      {
        ui: {
          mount: (point: string) => (point === "chat_toolbar" ? rowMount : actionsMount),
        },
      } as unknown as SpindleFrontendContext,
      {
        onTriggerAction: () => {},
        onAbortAction: (runId) => abortedRunIds.push(runId),
        onRestoreLatest: () => {},
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      },
    );

    try {
      const settings = createDefaultSettings();
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      const snap1 = Array.from(actionsMount.querySelectorAll<HTMLButtonElement>("button"));

      // Same state -> exact DOM refs preserved
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(Array.from(actionsMount.querySelectorAll<HTMLButtonElement>("button"))).toEqual(snap1);
      expect(actionsMount.querySelectorAll("button")[0]).toBe(snap1[0]);

      // Toggling action enabled updates buttons
      settings.actions.guided_swipe.enabled = false;
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(actionsMount.querySelector('[data-gg-action="guided_swipe"]')).toBeNull();
      expect(actionsMount.querySelectorAll("button")).toHaveLength(5);

      // Toggling inputRecovery.enabled updates buttons
      settings.inputRecovery.enabled = false;
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(actionsMount.querySelector('[data-gg-action="input_recovery"]')).toBeNull();
      expect(actionsMount.querySelectorAll("button")).toHaveLength(4);

      // Reordering buttonOrder updates DOM order
      settings.buttonOrder = [
        "guided_impersonate",
        "guided_regenerate",
        "guided_continue",
        "guided_response",
        "guided_swipe",
        "input_recovery",
      ];
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(
        Array.from(actionsMount.querySelectorAll("button")).map((b) =>
          b.getAttribute("data-gg-action"),
        ),
      ).toEqual([
        "guided_impersonate",
        "guided_regenerate",
        "guided_continue",
        "guided_response",
      ]);

      // Placement / alignment changes update classes and mount host
      settings.toolbarPlacement = "before_native";
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(actionsMount.classList.contains("is-before-native")).toBe(true);

      settings.toolbarPlacement = "right";
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(actionsMount.classList.contains("is-right")).toBe(true);
      expect(actionsMount.classList.contains("is-before-native")).toBe(false);

      settings.toolbarPlacement = "below_bar";
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      expect(rowMount.classList.contains("gg-actions-host--row")).toBe(true);
      expect(rowMount.querySelectorAll("button")).toHaveLength(4);

      // Swapping activeRun.runId for same actionId rebinds Stop button click handler
      toolbar.render({
        settings,
        activeRun: { runId: "run-1", actionId: "guided_response", chatId: "c1", startedAt: 1 },
        recovery: [],
        hasActiveChat: true,
      });
      toolbar.render({
        settings,
        activeRun: { runId: "run-2", actionId: "guided_response", chatId: "c1", startedAt: 2 },
        recovery: [],
        hasActiveChat: true,
      });
      rowMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_response"]')!.click();
      expect(abortedRunIds).toEqual(["run-2"]);

      // External detach from target mount recovers cleanly on next render even with identical state
      rowMount.replaceChildren();
      expect(rowMount.querySelectorAll("button")).toHaveLength(0);
      toolbar.render({
        settings,
        activeRun: { runId: "run-2", actionId: "guided_response", chatId: "c1", startedAt: 2 },
        recovery: [],
        hasActiveChat: true,
      });
      expect(rowMount.querySelectorAll("button")).toHaveLength(4);
    } finally {
      toolbar.destroy();
      actionsMount.remove();
      rowMount.remove();
    }
  });

  test("mobile touch UX & CSS optimizations: 450ms touch hold dismisses completed chat head (cancelled on >6px drag), touch pointerleave keeps toolbar hold alive, drop-up menu repositions on visualViewport/window resize, and CSS has coarse-pointer dismiss + prefers-reduced-motion + compositor pulses", async () => {
    const win = document.defaultView!;
    const PointerEvt = win.PointerEvent;
    const MouseEvt = win.MouseEvent;
    const origInnerWidth = win.innerWidth;
    const origInnerHeight = win.innerHeight;
    const origVisualViewport = Object.getOwnPropertyDescriptor(win, "visualViewport");
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origDateNow = Date.now;

    let fakeNow = 70_000;
    const holdTimers = new Map<number, () => void>();
    let nextTimerId = 120_000;

    Date.now = () => fakeNow;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 450) {
        const id = ++nextTimerId;
        holdTimers.set(id, () => fn(...args));
        return id as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;

    (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      const num = Number(id);
      if (holdTimers.has(num)) {
        holdTimers.delete(num);
        return;
      }
      origClearTimeout(id);
    }) as typeof clearTimeout;

    const fireHoldTimers = () => {
      for (const [id, fn] of [...holdTimers.entries()]) {
        if (!holdTimers.has(id)) continue;
        holdTimers.delete(id);
        fn();
      }
    };

    const navCalls: string[] = [];
    const headCtx = {
      getActiveChat: () => ({ chatId: "chat-active" }),
      events: { on: () => () => {} },
      host: {
        surfaces: {
          invoke: (_ref: unknown, params: { chatId: string }) => {
            navCalls.push(params.chatId);
            return Promise.resolve();
          },
        },
      },
    } as unknown as SpindleFrontendContext;

    const headController = new ChatHeadController(headCtx);
    const actionsMount = document.createElement("div");
    document.body.append(actionsMount);
    const triggeredActions: Array<{ actionId: string; backgroundSwipe?: boolean }> = [];
    const toolbar = new InputToolbarController(
      {
        ui: { mount: () => actionsMount },
      } as unknown as SpindleFrontendContext,
      {
        onTriggerAction: (actionId, opts) => {
          triggeredActions.push({ actionId, backgroundSwipe: opts?.backgroundSwipe });
        },
        onAbortAction: () => {},
        onRestoreLatest: () => {},
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      },
    );

    try {
      Object.defineProperty(win, "innerWidth", { value: 390, configurable: true });
      Object.defineProperty(win, "innerHeight", { value: 844, configurable: true });

      // (a) Completed Chat Head 450ms touch long-press dismissal & >6px drag cancellation
      headController.handleStatusEvent(
        { type: "gg:status", chatId: "chat-done-1", run: null, done: true, aborted: false },
        "chat-active",
      );
      headController.handleStatusEvent(
        { type: "gg:status", chatId: "chat-done-2", run: null, done: true, aborted: false },
        "chat-active",
      );

      const doneBtn1 = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head[data-chat-id="chat-done-1"]',
      )!;
      const doneBtn2 = document.body.querySelector<HTMLButtonElement>(
        '.gg-chat-head[data-chat-id="chat-done-2"]',
      )!;
      expect(doneBtn1.classList.contains("is-completed")).toBe(true);
      expect(doneBtn2.classList.contains("is-completed")).toBe(true);

      // Dragging > 6px cancels the 450ms hold-dismiss timer
      doneBtn1.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 31,
          pointerType: "touch",
          button: 0,
          clientX: 330,
          clientY: 180,
        }),
      );
      expect(holdTimers.size).toBe(1);
      document.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          pointerId: 31,
          pointerType: "touch",
          clientX: 300,
          clientY: 180,
        }),
      );
      expect(holdTimers.size).toBe(0);
      document.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          pointerId: 31,
          pointerType: "touch",
          clientX: 300,
          clientY: 180,
        }),
      );
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-done-1"]')).toBe(
        doneBtn1,
      );

      // Stationary 450ms touch hold on completed chat head dismisses it and suppresses trailing click
      doneBtn1.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          pointerId: 32,
          pointerType: "touch",
          button: 0,
          clientX: 300,
          clientY: 180,
        }),
      );
      expect(holdTimers.size).toBe(1);
      fakeNow += 450;
      fireHoldTimers();
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-done-1"]')).toBeNull();
      expect(document.body.querySelector('.gg-chat-head[data-chat-id="chat-done-2"]')).toBe(
        doneBtn2,
      );

      document.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          pointerId: 32,
          pointerType: "touch",
          clientX: 300,
          clientY: 180,
        }),
      );
      doneBtn1.click();
      await flushMicrotasks();
      expect(navCalls).toEqual([]);

      // (b) Toolbar long-press: touch pointerleave within 10px does NOT cancel hold, while mouse pointerleave DOES cancel
      toolbar.render({
        settings: createDefaultSettings(),
        activeRun: null,
        recovery: [],
        hasActiveChat: true,
      });

      const swipeBtn = actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_swipe"]',
      )!;

      // Mouse pointerleave cancels hold
      swipeBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          isPrimary: true,
          pointerType: "mouse",
          button: 0,
          clientX: 40,
          clientY: 40,
        }),
      );
      expect(holdTimers.size).toBe(1);
      swipeBtn.dispatchEvent(
        new PointerEvt("pointerleave", {
          bubbles: true,
          isPrimary: true,
          pointerType: "mouse",
          clientX: 42,
          clientY: 42,
        }),
      );
      expect(holdTimers.size).toBe(0);
      expect(swipeBtn.classList.contains("is-holding")).toBe(false);

      // Touch pointerleave within 10px tolerance keeps hold alive and fires after 450ms
      swipeBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 40,
          clientY: 40,
        }),
      );
      expect(holdTimers.size).toBe(1);
      swipeBtn.dispatchEvent(
        new PointerEvt("pointermove", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 45,
          clientY: 46,
        }),
      );
      swipeBtn.dispatchEvent(
        new PointerEvt("pointerleave", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 45,
          clientY: 46,
        }),
      );
      expect(holdTimers.size).toBe(1);
      expect(swipeBtn.classList.contains("is-holding")).toBe(true);

      fakeNow += 450;
      fireHoldTimers();
      expect(triggeredActions).toEqual([{ actionId: "guided_swipe", backgroundSwipe: true }]);
      swipeBtn.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 45,
          clientY: 46,
        }),
      );

      // (c) Drop-up menu repositions on visualViewport & window resize instead of closing
      const vpTarget = new win.EventTarget();
      const fakeVisualViewport = Object.assign(vpTarget, {
        width: 390,
        height: 844,
      });
      Object.defineProperty(win, "visualViewport", {
        value: fakeVisualViewport,
        configurable: true,
      });

      const continueBtn = actionsMount.querySelector<HTMLButtonElement>(
        '[data-gg-action="guided_continue"]',
      )!;
      let anchorTop = 760;
      continueBtn.getBoundingClientRect = () =>
        ({
          left: 60,
          right: 88,
          top: anchorTop,
          bottom: anchorTop + 26,
          width: 28,
          height: 26,
          x: 60,
          y: anchorTop,
          toJSON: () => ({}),
        }) as DOMRect;

      continueBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      const menuEl = document.body.querySelector<HTMLDivElement>(".gg-dropup-menu")!;
      expect(menuEl).not.toBeNull();
      expect(menuEl.style.bottom).toBe("90px"); // (844 - 760) + 6

      // Simulate mobile virtual keyboard opening: visualViewport.height shrinks to 480 and anchor moves up to 420
      fakeVisualViewport.height = 480;
      anchorTop = 420;
      fakeVisualViewport.dispatchEvent(new win.Event("resize"));
      expect(document.body.querySelector(".gg-dropup-menu")).toBe(menuEl);
      expect(menuEl.style.bottom).toBe("66px"); // (480 - 420) + 6

      // Window resize (e.g. URL bar collapse) also keeps menu open and repositions
      Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
      fakeVisualViewport.height = 800;
      anchorTop = 700;
      win.dispatchEvent(new win.Event("resize"));
      expect(document.body.querySelector(".gg-dropup-menu")).toBe(menuEl);
      expect(menuEl.style.bottom).toBe("106px"); // (800 - 700) + 6

      // Disabling anchor button and firing resize closes the menu cleanly
      continueBtn.disabled = true;
      fakeVisualViewport.dispatchEvent(new win.Event("resize"));
      expect(document.body.querySelector(".gg-dropup-menu")).toBeNull();

      // (d) CSS includes coarse-pointer dismiss visibility, prefers-reduced-motion, and compositor pseudo-element animations
      expect(GUIDED_GENERATIONS_CSS).toContain("@media (hover: none), (pointer: coarse)");
      expect(GUIDED_GENERATIONS_CSS).toContain("@media (prefers-reduced-motion: reduce)");
      expect(GUIDED_GENERATIONS_CSS).toContain(".gg-btn.is-running::after");
      expect(GUIDED_GENERATIONS_CSS).toContain(".gg-chat-head.is-running::after");
      const btnCss = GUIDED_GENERATIONS_CSS.match(/(?:^|\n)\.gg-btn\s*\{([^}]*)\}/)?.[1] ?? "";
      expect(btnCss).toContain("position: relative;");
      expect(btnCss).toContain("touch-action: manipulation;");
      expect(btnCss).toContain("-webkit-touch-callout: none;");
    } finally {
      headController.destroy();
      toolbar.destroy();
      actionsMount.remove();
      Object.defineProperty(win, "innerWidth", { value: origInnerWidth, configurable: true });
      Object.defineProperty(win, "innerHeight", { value: origInnerHeight, configurable: true });
      if (origVisualViewport) {
        Object.defineProperty(win, "visualViewport", origVisualViewport);
      } else {
        delete (win as unknown as { visualViewport?: unknown }).visualViewport;
      }
      Date.now = origDateNow;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });
});
