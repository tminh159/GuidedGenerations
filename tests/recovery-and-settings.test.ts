import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleAPI, SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  SettingsStore,
  appendRecoveryEntry,
  normalizeRecoveryList,
  normalizeSettings,
} from "../src/backend/settings-store";
import { InputToolbarController } from "../src/frontend/input-toolbar";
import {
  formatRecoverySnippet,
  pickRecoveryEntry,
} from "../src/frontend/recovery-store";
import { SettingsDrawerController } from "../src/frontend/settings-drawer";
import { GUIDED_GENERATIONS_CSS } from "../src/frontend/styles";
import { TOOLBAR_ICONS } from "../src/frontend/icons";
import { GuidedGenerationRunner } from "../src/backend/generation-runner";
import { createDefaultSettings } from "../src/shared/defaults";
import type {
  ExtensionBootstrapView,
  GuidedActionId,
  GuidedGenerationsSettings,
  RecoveryEntry,
} from "../src/shared/types";

describe("settings and recovery normalization", () => {
  test("normalizeSettings merges partial fields and clamps limits", () => {
    const parsed = normalizeSettings({
      toolbarPlacement: "before_native",
      buttonOrder: ["guided_swipe", "unknown_id", "guided_swipe", "input_recovery"],
      actions: {
        guided_swipe: {
          enabled: false,
          connectionId: " conn-2 ",
          model: " claude-sonnet ",
          presetId: "",
          injectionRole: "invalid-role",
          clearInputOnRun: false,
        },
        guided_continue: {
          model: "   ",
        },
      },
      inputRecovery: {
        enabled: true,
        maxEntries: 999,
      },
    });

    expect(parsed.toolbarPlacement).toBe("before_native");
    expect(parsed.buttonOrder).toEqual([
      "guided_swipe",
      "input_recovery",
      "guided_response",
      "guided_continue",
      "guided_regenerate",
      "guided_impersonate",
    ]);
    expect(parsed.actions.guided_swipe.enabled).toBe(false);
    expect(parsed.actions.guided_swipe.connectionId).toBe("conn-2");
    expect(parsed.actions.guided_swipe.model).toBe("claude-sonnet");
    expect(parsed.actions.guided_swipe.presetId).toBeNull();
    expect(parsed.actions.guided_swipe.injectionRole).toBe("system");
    expect(parsed.actions.guided_swipe.clearInputOnRun).toBe(false);
    expect(parsed.actions.guided_continue.model).toBeNull();
    expect(parsed.actions.guided_response.enabled).toBe(true);
    expect(parsed.actions.guided_response.model).toBeNull();
    expect(parsed.inputRecovery.maxEntries).toBe(50);

    const invalidPlacement = normalizeSettings({ toolbarPlacement: "floating_moon" });
    expect(invalidPlacement.toolbarPlacement).toBe("after_native");
  });

  test("appendRecoveryEntry deduplicates consecutive identical entries and enforces maxEntries", () => {
    let stack: RecoveryEntry[] = [];
    stack = appendRecoveryEntry(
      stack,
      { text: "First idea", actionId: "guided_response", chatId: "c1" },
      2,
    );
    stack = appendRecoveryEntry(
      stack,
      { text: "First idea", actionId: "guided_response", chatId: "c1" },
      2,
    );
    expect(stack).toHaveLength(1);

    stack = appendRecoveryEntry(
      stack,
      { text: "Second idea", actionId: "guided_swipe", chatId: "c1" },
      2,
    );
    stack = appendRecoveryEntry(
      stack,
      { text: "Third idea", actionId: "guided_continue", chatId: "c1" },
      2,
    );

    expect(stack.map((e) => e.text)).toEqual(["Third idea", "Second idea"]);
    expect(normalizeRecoveryList(stack, 1)).toHaveLength(1);
    expect(pickRecoveryEntry(stack)?.text).toBe("Third idea");
    expect(formatRecoverySnippet("Hello\n\nworld   from  test", 12)).toBe(
      "Hello world…",
    );
  });
});

describe("InputToolbarController DOM behavior", () => {
  let mountContainer: HTMLElement;
  let currentDom: JSDOM | null = null;
  let previousDocument: Document | undefined;

  beforeEach(() => {
    previousDocument = (globalThis as unknown as { document?: Document }).document;
    currentDom = new JSDOM("<!doctype html><html><body><span id='slot'></span></body></html>");
    (globalThis as unknown as { document: Document }).document = currentDom.window.document;
    mountContainer = currentDom.window.document.getElementById("slot")!;
  });

  afterEach(() => {
    if (previousDocument === undefined) {
      delete (globalThis as unknown as { document?: Document }).document;
    } else {
      (globalThis as unknown as { document: Document }).document = previousDocument;
    }
    currentDom?.window.close();
    currentDom = null;
  });

  test("renders only enabled option buttons on chat_actions and dispatches clicks", () => {
    const triggered: GuidedActionId[] = [];
    const aborted: string[] = [];
    let restored = 0;

    const fakeCtx = {
      ui: {
        mount: (point: string) => {
          expect(point).toBe("chat_actions");
          return mountContainer;
        },
      },
    } as unknown as SpindleFrontendContext;

    const toolbar = new InputToolbarController(fakeCtx, {
      onTriggerAction: (id) => triggered.push(id),
      onAbortAction: (runId) => aborted.push(runId),
      onRestoreLatest: () => {
        restored += 1;
      },
    });

    const settings = createDefaultSettings();
    settings.actions.guided_response.enabled = false;
    settings.actions.guided_impersonate.enabled = true;
    settings.inputRecovery.enabled = true;

    toolbar.render({
      settings,
      activeRun: null,
      recovery: [
        {
          id: "r-1",
          text: "Saved draft",
          actionId: "guided_swipe",
          chatId: "c1",
          createdAt: 1,
        },
      ],
      hasActiveChat: true,
    });

    const buttons = Array.from(mountContainer.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("data-gg-action"))).toEqual([
      "guided_continue",
      "guided_regenerate",
      "guided_swipe",
      "guided_impersonate",
      "input_recovery",
    ]);

    buttons[2]!.click();
    buttons[4]!.click();
    expect(triggered).toEqual(["guided_swipe"]);
    expect(restored).toBe(1);

    toolbar.render({
      settings,
      activeRun: {
        runId: "run-99",
        actionId: "guided_swipe",
        chatId: "c1",
        startedAt: 10,
      },
      recovery: [],
      hasActiveChat: true,
    });

    const swipeBtn = mountContainer.querySelector(
      '[data-gg-action="guided_swipe"]',
    ) as HTMLButtonElement;
    expect(swipeBtn.classList.contains("is-running")).toBe(true);
    swipeBtn.click();
    expect(aborted).toEqual(["run-99"]);

    expect(mountContainer.classList.contains("gg-actions-host")).toBe(true);
    toolbar.destroy();
    expect(mountContainer.classList.contains("gg-actions-host")).toBe(false);
    expect(mountContainer.children.length).toBe(0);
  });

  test("SettingsDrawerController keeps all component targets attached in tab.root across collapse/expand", () => {
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);

    const mountedTargets: Element[] = [];
    const savedSettings: GuidedGenerationsSettings[] = [];
    const switchCallbacks: Array<(checked: boolean) => void> = [];
    const selectHandlers: Array<{ ariaLabel?: string; onChange?: (val: string) => void }> = [];
    const modelComboboxes: Array<{
      options: { connection?: { kind: string; id?: string }; placeholder?: string; onChange?: (val: string) => void };
      updates: Array<{ connection?: { kind: string; id?: string }; placeholder?: string }>;
    }> = [];

    const resolveTarget = (target: string | Element) =>
      typeof target === "string" ? document.querySelector(target)! : target;

    const fakeCtx = {
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
        mountSwitch: (target: string | Element, opts: { checked?: boolean; onChange?: (v: boolean) => void }) => {
          const el = resolveTarget(target);
          mountedTargets.push(el);
          if (opts.onChange) switchCallbacks.push(opts.onChange);
          const btn = document.createElement("button");
          btn.setAttribute("role", "switch");
          btn.setAttribute("aria-checked", String(Boolean(opts.checked)));
          btn.addEventListener("click", () => opts.onChange?.(!opts.checked));
          el.append(btn);
          return { componentId: "sw", element: el as HTMLElement, update: () => {}, destroy: () => { el.replaceChildren(); }, getValue: () => Boolean(opts.checked) };
        },
        mountSelect: (target: string | Element, opts: { ariaLabel?: string; onChange?: (v: string) => void }) => {
          const el = resolveTarget(target);
          mountedTargets.push(el);
          selectHandlers.push({ ariaLabel: opts.ariaLabel, onChange: opts.onChange });
          return { componentId: "sel", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
        mountModelCombobox: (
          target: string | Element,
          opts: { connection?: { kind: string; id?: string }; placeholder?: string; onChange?: (v: string) => void },
        ) => {
          const el = resolveTarget(target);
          mountedTargets.push(el);
          const entry = {
            options: opts,
            updates: [] as Array<{ connection?: { kind: string; id?: string }; placeholder?: string }>,
          };
          modelComboboxes.push(entry);
          return {
            componentId: "mc",
            element: el as HTMLElement,
            update: (patch: { connection?: { kind: string; id?: string }; placeholder?: string }) => {
              entry.updates.push(patch);
            },
            destroy: () => {},
            getValue: () => "",
            refresh: () => {},
          };
        },
        mountTextArea: (target: string | Element) => {
          const el = resolveTarget(target);
          mountedTargets.push(el);
          return { componentId: "ta", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
      },
    } as unknown as SpindleFrontendContext;

    const drawer = new SettingsDrawerController(fakeCtx, {
      onRefresh: () => {},
      onSaveSettings: async (next) => {
        savedSettings.push(next);
      },
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    const view: ExtensionBootstrapView = {
      settings: createDefaultSettings(),
      connections: [
        { id: "c1", name: "Main", provider: "openai", model: "gpt-4o", isDefault: true },
        { id: "c2", name: "OpenRouter Blank Model", provider: "openrouter", model: "", isDefault: false },
      ],
      presets: [{ id: "p1", name: "Default Preset" }],
      recovery: [],
      activeRun: null,
      permissions: { generation: true, chats: true, chat_mutation: true, presets: true },
    };

    drawer.render(view);

    // Model combobox is mounted for each action with initial placeholder from active connection.
    expect(modelComboboxes).toHaveLength(5);
    expect(modelComboboxes[0]!.options.connection).toEqual({ kind: "llm" });
    expect(modelComboboxes[0]!.options.placeholder).toBe("Use connection model (gpt-4o)");

    // Switching API Connection Profile updates the Model combobox connection binding & placeholder.
    const firstConnSelect = selectHandlers.find(
      (s) => s.ariaLabel === "Guided Response API Connection Profile",
    )!;
    firstConnSelect.onChange?.("c2");
    expect(modelComboboxes[0]!.updates).toEqual([
      {
        connection: { kind: "llm", id: "c2" },
        placeholder: "Leave blank for connection model",
      },
    ]);

    // Every mounted component target must be attached inside tabRoot immediately (never detached).
    expect(mountedTargets.length).toBeGreaterThan(10);
    for (const target of mountedTargets) {
      expect(tabRoot.contains(target)).toBe(true);
    }

    // Every card starts collapsed by default and can be expanded on click while keeping children attached.
    const headers = Array.from(tabRoot.querySelectorAll<HTMLButtonElement>(".gg-card-header"));
    expect(headers).toHaveLength(7);
    for (const header of headers) {
      expect(header.getAttribute("aria-expanded")).toBe("false");
    }
    headers[1]!.click();
    expect(headers[1]!.getAttribute("aria-expanded")).toBe("true");

    // Switching Bar Placement and moving a button in Toolbar Position & Order persists updates.
    const layoutPlacementSelect = selectHandlers.find(
      (s) => s.ariaLabel === "Toolbar Bar Placement",
    )!;
    layoutPlacementSelect.onChange?.("before_native");
    expect(savedSettings[1]!.toolbarPlacement).toBe("before_native");

    const moveDownBtn = tabRoot.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Guided Response down"]',
    )!;
    moveDownBtn.click();
    expect(savedSettings[2]!.buttonOrder.slice(0, 2)).toEqual([
      "guided_continue",
      "guided_response",
    ]);

    // Clicking a mounted switch fires onSaveSettings with updated enabled state.
    const firstSwitch = tabRoot.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    firstSwitch.click();
    expect(savedSettings).toHaveLength(4);
    expect(savedSettings[0]!.actions.guided_response.connectionId).toBe("c2");
    expect(savedSettings[3]!.actions.guided_response.enabled).toBe(false);

    drawer.destroy();
  });

  test("SettingsStore forwards userId when listing connections and presets for operator-scoped extensions", async () => {
    const connUserIds: Array<string | undefined> = [];
    const presetUserIds: Array<string | undefined> = [];

    const fakeSpindle = {
      permissions: { has: () => true },
      log: { warn: () => {} },
      connections: {
        list: async (userId?: string) => {
          connUserIds.push(userId);
          if (!userId) throw new Error("userId is required for operator-scoped extensions");
          return [
            {
              id: "conn-1",
              name: "Primary OpenAI",
              provider: "openai",
              model: "gpt-4o",
              is_default: true,
            },
            {
              id: "conn-2",
              name: "Creative Anthropic",
              provider: "anthropic",
              model: "claude-sonnet",
              is_default: false,
            },
          ];
        },
      },
      presets: {
        list: async (opts?: { limit?: number; userId?: string }) => {
          presetUserIds.push(opts?.userId);
          if (!opts?.userId) throw new Error("userId is required for operator-scoped extensions");
          return {
            data: [
              { id: "preset-1", name: "Roleplay" },
              { id: "preset-2", name: "Short Impersonate" },
            ],
            total: 2,
          };
        },
      },
    } as unknown as SpindleAPI;

    const store = new SettingsStore(fakeSpindle);

    const catalogs = await store.loadCatalogs("user-42");
    expect(connUserIds).toEqual(["user-42"]);
    expect(presetUserIds).toEqual(["user-42"]);
    expect(catalogs.warnings).toEqual([]);
    expect(catalogs.connections.map((c) => c.id)).toEqual(["conn-1", "conn-2"]);
    expect(catalogs.presets.map((p) => p.id)).toEqual(["preset-1", "preset-2"]);

    const missingUserCatalogs = await store.loadCatalogs(undefined);
    expect(missingUserCatalogs.connections).toEqual([]);
    expect(missingUserCatalogs.presets).toEqual([]);
    expect(missingUserCatalogs.warnings).toHaveLength(2);
  });

  test("guided_regenerate deletes trailing assistant message before dryRun and streams fresh reply", async () => {
    const events: string[] = [];
    const deletedIds: string[] = [];

    const fakeSpindle = {
      permissions: { has: () => true },
      log: { warn: () => {} },
      chats: {
        getActive: async () => ({ id: "chat-1" }),
      },
      connections: {
        list: async () => [
          { id: "conn-1", name: "Default", provider: "openai", model: "gpt-4o", is_default: true },
        ],
      },
      presets: {
        list: async () => ({ data: [], total: 0 }),
      },
      chat: {
        getMessages: async () => [
          { id: "m1", is_user: true, role: "user", content: "Hi", extra: {} },
          { id: "m2", is_user: false, role: "assistant", content: "Old reply", extra: {} },
        ],
        deleteMessage: async (_chatId: string, id: string) => {
          events.push(`delete:${id}`);
          deletedIds.push(id);
        },
        appendMessage: async () => {
          events.push("append");
          return { id: "m3" };
        },
        updateMessage: async () => {},
      },
      generate: {
        dryRun: async () => {
          events.push("dryRun");
          return {
            messages: [{ role: "user", content: "Hi" }],
            parameters: {},
            model: "gpt-4o",
            provider: "openai",
          };
        },
        rawStream: async function* () {
          yield { type: "token", token: "Fresh reply" };
          yield { type: "done", content: "Fresh reply" };
        },
      },
      storage: {
        exists: async () => false,
        read: async () => {
          throw new Error("not found");
        },
        write: async () => {},
        getJson: async (_path: string, opts?: { fallback?: unknown }) => opts?.fallback,
        setJson: async () => {},
      },
      userStorage: {
        exists: async () => false,
        read: async () => {
          throw new Error("not found");
        },
        write: async () => {},
        getJson: async (_path: string, opts?: { fallback?: unknown }) => opts?.fallback,
        setJson: async () => {},
      },
    } as unknown as SpindleAPI;

    const store = new SettingsStore(fakeSpindle);
    const runner = new GuidedGenerationRunner(fakeSpindle, store, () => {});

    const res = await runner.run({ actionId: "guided_regenerate", inputText: "More dramatic" }, "u1");
    expect(res.actionId).toBe("guided_regenerate");
    expect(res.messageId).toBe("m3");
    expect(res.text).toBe("Fresh reply");
    expect(deletedIds).toEqual(["m2"]);
    expect(events).toEqual(["delete:m2", "dryRun", "append"]);
  });

  test("reset toolbar alignment supports CSS ordering, custom buttonOrder, and below_bar placement", () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-actions-host.is-before-native");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-actions-host.is-right");
    expect(TOOLBAR_ICONS.guided_swipe).toContain("m9 18 6-6-6-6");
    expect(TOOLBAR_ICONS.guided_regenerate).toContain("M21 12a9 9 0");

    const actionsMount = document.createElement("span");
    const rowMount = document.createElement("div");
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
    settings.toolbarPlacement = "before_native";
    settings.buttonOrder = [
      "input_recovery",
      "guided_regenerate",
      "guided_response",
      "guided_continue",
      "guided_swipe",
      "guided_impersonate",
    ];

    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(actionsMount.classList.contains("is-before-native")).toBe(true);
    expect(
      Array.from(actionsMount.querySelectorAll("button")).map((b) =>
        b.getAttribute("data-gg-action"),
      ),
    ).toEqual([
      "input_recovery",
      "guided_regenerate",
      "guided_response",
      "guided_continue",
      "guided_swipe",
      "guided_impersonate",
    ]);

    settings.toolbarPlacement = "right";
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(actionsMount.classList.contains("is-right")).toBe(true);
    expect(actionsMount.classList.contains("is-before-native")).toBe(false);

    settings.toolbarPlacement = "below_bar";
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(actionsMount.children.length).toBe(0);
    expect(rowMount.classList.contains("gg-actions-host--row")).toBe(true);
    expect(rowMount.querySelectorAll("button").length).toBe(6);

    toolbar.destroy();
    expect(rowMount.children.length).toBe(0);
  });
});

