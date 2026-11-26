import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleAPI, SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  SettingsStore,
  appendRecoveryEntry,
  normalizeRecoveryList,
  normalizeSettings,
} from "../src/backend/settings-store";
import { buildGenerationMetricsPayload } from "../src/backend/generation-metrics";
import { registerBackend } from "../src/backend";
import { InputToolbarController } from "../src/frontend/input-toolbar";
import { PillMetricsController } from "../src/frontend/pill-metrics";
import {
  formatRecoverySnippet,
  pickRecoveryEntry,
} from "../src/frontend/recovery-store";
import { SettingsDrawerController } from "../src/frontend/settings-drawer";
import { StreamingIndicatorController } from "../src/frontend/streaming-indicator";
import { GUIDED_GENERATIONS_CSS } from "../src/frontend/styles";
import { CONTINUE_MENU_ICONS, RECOVERY_MENU_ICONS, TOOLBAR_ICONS } from "../src/frontend/icons";
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
      "guided_scene",
    ]);
    expect(parsed.actions.guided_swipe.enabled).toBe(false);
    expect(parsed.actions.guided_swipe.connectionId).toBe("conn-2");
    expect(parsed.actions.guided_swipe.model).toBe("claude-sonnet");
    expect(parsed.actions.guided_swipe.presetId).toBeNull();
    expect(parsed.actions.guided_swipe.injectionRole).toBe("system");
    expect(parsed.actions.guided_swipe.clearInputOnRun).toBe(false);
    expect("backgroundSwipe" in parsed.actions.guided_swipe).toBe(false);
    expect(parsed.actions.guided_continue.model).toBeNull();
    expect(parsed.actions.guided_response.enabled).toBe(true);
    expect(parsed.actions.guided_response.model).toBeNull();
    expect(parsed.inputRecovery.maxEntries).toBe(50);

    const withLegacyBackgroundSwipe = normalizeSettings({
      actions: {
        guided_swipe: { backgroundSwipe: true },
        guided_response: { backgroundSwipe: "yes" },
      },
    });
    expect("backgroundSwipe" in withLegacyBackgroundSwipe.actions.guided_swipe).toBe(false);
    expect("backgroundSwipe" in withLegacyBackgroundSwipe.actions.guided_response).toBe(false);

    const invalidPlacement = normalizeSettings({ toolbarPlacement: "floating_moon" });
    expect(invalidPlacement.toolbarPlacement).toBe("after_native");

    const withGuidedScene = normalizeSettings({
      guidedScene: {
        enabled: false,
        connectionId: " conn-scene ",
        model: " claude-sonnet ",
        presetId: " preset-9 ",
        contextMode: "full_preset",
        contextTurns: 500,
        injectionRole: "assistant",
        guidancePosition: "append_last_user",
        guidanceDepth: 4,
        keepMediaIntact: false,
        applyRegex: false,
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "summary_rewrite",
        dropTarget: "new_swipe",
        readinessTag: "<custom-ready />",
      },
    });
    expect(withGuidedScene.guidedScene.enabled).toBe(false);
    expect(withGuidedScene.guidedScene.connectionId).toBe("conn-scene");
    expect(withGuidedScene.guidedScene.model).toBe("claude-sonnet");
    expect(withGuidedScene.guidedScene.presetId).toBe("preset-9");
    expect(withGuidedScene.guidedScene.contextMode).toBe("full_preset");
    expect(withGuidedScene.guidedScene.contextTurns).toBe(200);
    expect(withGuidedScene.guidedScene.injectionRole).toBe("assistant");
    expect(withGuidedScene.guidedScene.guidancePosition).toBe("append_last_user");
    expect(withGuidedScene.guidedScene.guidanceDepth).toBe(4);
    expect(withGuidedScene.guidedScene.keepMediaIntact).toBe(false);
    expect(withGuidedScene.guidedScene.applyRegex).toBe(false);
    expect(withGuidedScene.guidedScene.pacing).toBe("multi_turn");
    expect(withGuidedScene.guidedScene.delivery).toBe("bridge");
    expect(withGuidedScene.guidedScene.adjustmentMode).toBe("summary_rewrite");
    expect(withGuidedScene.guidedScene.dropTarget).toBe("new_swipe");
    expect(withGuidedScene.guidedScene.readinessTag).toBe("custom-ready");
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
      onRemoveLastContinue: () => {},
      onRegenerateLastContinue: () => {},
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
      "guided_scene",
      "input_recovery",
    ]);

    buttons[2]!.click();
    buttons[5]!.click();
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
      permissions: {
        generation: true,
        chats: true,
        chat_mutation: true,
        presets: true,
        regex_scripts: true,
        interceptor: true,
      },
    };

    drawer.render(view);

    // Model combobox is mounted for each action + Guided Scene with initial placeholder from active connection,
    // deferring connection binding while the card is collapsed.
    expect(modelComboboxes).toHaveLength(6);
    expect(modelComboboxes[0]!.options.connection).toBeUndefined();
    expect(modelComboboxes[0]!.options.placeholder).toBe("Use connection model (gpt-4o)");

    // Every mounted component target must be attached inside tabRoot immediately (never detached).
    expect(mountedTargets.length).toBeGreaterThan(10);
    for (const target of mountedTargets) {
      expect(tabRoot.contains(target)).toBe(true);
    }

    // Every card starts collapsed by default and can be expanded on click while keeping children attached.
    const headers = Array.from(tabRoot.querySelectorAll<HTMLButtonElement>(".gg-card-header"));
    expect(headers).toHaveLength(8);
    for (const header of headers) {
      expect(header.getAttribute("aria-expanded")).toBe("false");
    }
    headers[1]!.click();
    expect(headers[1]!.getAttribute("aria-expanded")).toBe("true");
    expect(modelComboboxes[0]!.updates).toEqual([
      {
        connection: { kind: "llm" },
      },
    ]);

    // Switching API Connection Profile while expanded updates the Model combobox connection binding & placeholder.
    const firstConnSelect = selectHandlers.find(
      (s) => s.ariaLabel === "Guided Response API Connection Profile",
    )!;
    firstConnSelect.onChange?.("c2");
    expect(modelComboboxes[0]!.updates).toEqual([
      {
        connection: { kind: "llm" },
      },
      {
        connection: { kind: "llm", id: "c2" },
        placeholder: "Leave blank for connection model",
      },
    ]);

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

    // Clicking a mounted checkbox fires onSaveSettings with updated enabled state (zero mountSwitch calls).
    expect(switchCallbacks).toHaveLength(0);
    const firstCheckbox = tabRoot.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    firstCheckbox.click();
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
      onRemoveLastContinue: () => {},
      onRegenerateLastContinue: () => {},
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
      "guided_scene",
    ]);

    settings.toolbarPlacement = "right";
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(actionsMount.classList.contains("is-right")).toBe(true);
    expect(actionsMount.classList.contains("is-before-native")).toBe(false);

    settings.toolbarPlacement = "below_bar";
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
    expect(actionsMount.children.length).toBe(0);
    expect(rowMount.classList.contains("gg-actions-host--row")).toBe(true);
    expect(rowMount.querySelectorAll("button").length).toBe(7);

    toolbar.destroy();
    expect(rowMount.children.length).toBe(0);
  });

  test("InputToolbarController keeps Input Recovery enabled when recovery is empty unless a run is active", () => {
    let clicks = 0;
    const actionsMount = document.createElement("span");
    const fakeCtx = {
      ui: {
        mount: () => actionsMount,
      },
    } as unknown as SpindleFrontendContext;

    const toolbar = new InputToolbarController(fakeCtx, {
      onTriggerAction: () => {},
      onAbortAction: () => {},
      onRestoreLatest: () => {
        clicks += 1;
      },
      onRemoveLastContinue: () => {},
      onRegenerateLastContinue: () => {},
    });

    const settings = createDefaultSettings();
    toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });

    const emptyRecoveryBtn = actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="input_recovery"]',
    )!;
    expect(emptyRecoveryBtn.disabled).toBe(false);
    expect(emptyRecoveryBtn.getAttribute("aria-label")).toBe("Clear current input");
    expect(emptyRecoveryBtn.title).toBe("Input Recovery — clear current input");

    emptyRecoveryBtn.click();
    expect(clicks).toBe(1);

    toolbar.render({
      settings,
      activeRun: {
        runId: "run-1",
        actionId: "guided_response",
        chatId: "c1",
        startedAt: 1,
      },
      recovery: [],
      hasActiveChat: true,
    });
    const busyRecoveryBtn = actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="input_recovery"]',
    )!;
    expect(busyRecoveryBtn.disabled).toBe(true);

    toolbar.render({
      settings,
      activeRun: null,
      recovery: [
        {
          id: "rec-1",
          text: "Saved draft",
          actionId: "guided_response",
          chatId: "c1",
          createdAt: 2,
        },
      ],
      hasActiveChat: true,
    });
    const populatedRecoveryBtn = actionsMount.querySelector<HTMLButtonElement>(
      '[data-gg-action="input_recovery"]',
    )!;
    expect(populatedRecoveryBtn.disabled).toBe(false);
    expect(populatedRecoveryBtn.getAttribute("aria-label")).toBe("Restore last input");
    expect(populatedRecoveryBtn.title).toContain("Restore last cleared input");

    toolbar.destroy();
  });

  test("SettingsDrawerController renders Guidance Position, In-history depth, applyRegex toggle, and permission notices", () => {
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);

    const savedSettings: GuidedGenerationsSettings[] = [];
    const selectHandlers: Array<{
      ariaLabel?: string;
      options: Array<{ value: string; label: string }>;
      value?: string;
      onChange?: (val: string) => void;
    }> = [];
    const numericHandlers: Array<{
      ariaLabel?: string;
      disabled?: boolean;
      value: number | null;
      input: HTMLInputElement;
      updates: Array<{ value?: number | null; disabled?: boolean }>;
      onChange?: (val: number | null) => void;
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
        mountSwitch: (
          target: string | Element,
          opts: { checked?: boolean; ariaLabel?: string; onChange?: (v: boolean) => void },
        ) => {
          const el = resolveTarget(target);
          let checked = Boolean(opts.checked);
          const btn = document.createElement("button");
          btn.setAttribute("role", "switch");
          if (opts.ariaLabel) btn.setAttribute("aria-label", opts.ariaLabel);
          btn.setAttribute("aria-checked", String(checked));
          btn.addEventListener("click", () => {
            checked = !checked;
            btn.setAttribute("aria-checked", String(checked));
            opts.onChange?.(checked);
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
          opts: {
            ariaLabel?: string;
            options: Array<{ value: string; label: string }>;
            value?: string;
            onChange?: (v: string) => void;
          },
        ) => {
          const el = resolveTarget(target);
          selectHandlers.push({
            ariaLabel: opts.ariaLabel,
            options: opts.options,
            value: opts.value,
            onChange: opts.onChange,
          });
          return {
            componentId: "sel",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => {},
            getValue: () => opts.value ?? "",
          };
        },
        mountNumericInput: (
          target: string | Element,
          opts: {
            ariaLabel?: string;
            value?: number | null;
            disabled?: boolean;
            onChange?: (v: number | null) => void;
          },
        ) => {
          const el = resolveTarget(target);
          const input = document.createElement("input");
          input.type = "number";
          if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);
          input.disabled = Boolean(opts.disabled);
          input.value = opts.value === null || opts.value === undefined ? "" : String(opts.value);
          const entry = {
            ariaLabel: opts.ariaLabel,
            disabled: Boolean(opts.disabled),
            value: opts.value ?? null,
            input,
            updates: [] as Array<{ value?: number | null; disabled?: boolean }>,
            onChange: opts.onChange,
          };
          input.addEventListener("input", () => {
            const parsed = input.value.trim() === "" ? null : Number(input.value);
            entry.value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
            opts.onChange?.(entry.value);
          });
          el.append(input);
          numericHandlers.push(entry);
          return {
            componentId: "num",
            element: el as HTMLElement,
            update: (patch: { value?: number | null; disabled?: boolean }) => {
              entry.updates.push(patch);
              if (patch.disabled !== undefined) {
                entry.disabled = patch.disabled;
                input.disabled = patch.disabled;
              }
              if (patch.value !== undefined) {
                entry.value = patch.value;
                input.value = patch.value === null ? "" : String(patch.value);
              }
            },
            destroy: () => el.replaceChildren(),
            getValue: () => entry.value,
            focus: () => input.focus(),
            blur: () => input.blur(),
          };
        },
        mountModelCombobox: (target: string | Element) => {
          const el = resolveTarget(target);
          return {
            componentId: "mc",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => {},
            getValue: () => "",
            refresh: () => {},
          };
        },
        mountTextArea: (target: string | Element) => {
          const el = resolveTarget(target);
          return {
            componentId: "ta",
            element: el as HTMLElement,
            update: () => {},
            destroy: () => {},
            getValue: () => "",
          };
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

    const baseView: ExtensionBootstrapView = {
      settings: createDefaultSettings(),
      connections: [{ id: "c1", name: "Main", provider: "openai", model: "gpt-4o", isDefault: true }],
      presets: [{ id: "p1", name: "Default Preset" }],
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
    };

    drawer.render(baseView);

    // No permission warnings when all 6 permissions are granted
    expect(tabRoot.querySelectorAll(".gg-notice")).toHaveLength(0);

    // All 5 actions + Guided Scene expose Guidance Position select, In-history depth input, applyRegex checkbox, and macro hint
    const positionSelects = selectHandlers.filter((s) =>
      s.ariaLabel?.endsWith("Guidance Position"),
    );
    expect(positionSelects).toHaveLength(6);
    expect(positionSelects[0]!.options.map((o) => o.value)).toEqual([
      "before_post_history",
      "in_history",
      "pre_history",
      "post_history",
    ]);

    expect(numericHandlers).toHaveLength(8);
    const responseDepth = numericHandlers[0]!;
    const responseDepthWrap = responseDepth.input.closest(".gg-field") as HTMLElement;
    expect(responseDepth.disabled).toBe(true);
    expect(responseDepthWrap.style.display).toBe("none");

    // Switching Guidance Position to "in_history" saves config and shows + enables depth input
    positionSelects[0]!.onChange?.("in_history");
    expect(savedSettings[savedSettings.length - 1]!.actions.guided_response.guidancePosition).toBe(
      "in_history",
    );
    expect(responseDepth.disabled).toBe(false);
    expect(responseDepthWrap.style.display).toBe("");

    // Typing an out-of-range depth normalizes on save and clamps input value on focusout
    responseDepth.input.focus();
    responseDepth.input.value = "1500";
    responseDepth.input.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));
    responseDepth.input.dispatchEvent(
      new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }),
    );
    expect(savedSettings[savedSettings.length - 1]!.actions.guided_response.guidanceDepth).toBe(
      999,
    );
    expect(responseDepth.input.value).toBe("999");

    // Input Recovery "Max saved drafts" numeric input clamps [1, 50] and saves inputRecovery.maxEntries
    const maxDrafts = numericHandlers.find((n) => n.ariaLabel === "Max saved drafts")!;
    expect(maxDrafts).toBeDefined();
    expect(maxDrafts.disabled).toBe(false);
    expect(maxDrafts.input.value).toBe("10");

    maxDrafts.input.focus();
    maxDrafts.input.value = "99";
    maxDrafts.input.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));
    maxDrafts.input.dispatchEvent(
      new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }),
    );
    expect(savedSettings[savedSettings.length - 1]!.inputRecovery.maxEntries).toBe(50);
    expect(maxDrafts.input.value).toBe("50");

    maxDrafts.input.focus();
    maxDrafts.input.value = "0";
    maxDrafts.input.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));
    maxDrafts.input.dispatchEvent(
      new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }),
    );
    expect(savedSettings[savedSettings.length - 1]!.inputRecovery.maxEntries).toBe(1);
    expect(maxDrafts.input.value).toBe("1");

    maxDrafts.input.focus();
    maxDrafts.input.value = "25";
    maxDrafts.input.dispatchEvent(new (document.defaultView!.Event)("input", { bubbles: true }));
    maxDrafts.input.dispatchEvent(
      new (document.defaultView!.FocusEvent)("focusout", { bubbles: true }),
    );
    expect(savedSettings[savedSettings.length - 1]!.inputRecovery.maxEntries).toBe(25);
    expect(maxDrafts.input.value).toBe("25");

    // Per-action applyRegex checkbox defaults to true and saves false when clicked
    const regexCheckbox = tabRoot.querySelector<HTMLInputElement>(
      'input[type="checkbox"][aria-label="Apply Lumiverse regex scripts for Guided Response"]',
    )!;
    expect(regexCheckbox.checked).toBe(true);
    regexCheckbox.click();
    expect(regexCheckbox.checked).toBe(false);
    expect(savedSettings[savedSettings.length - 1]!.actions.guided_response.applyRegex).toBe(false);

    // Background swipe toggle is no longer rendered anywhere in Settings
    const bgToggles = tabRoot.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][aria-label*="background"], button[role="switch"][aria-label*="background"]',
    );
    expect(bgToggles).toHaveLength(0);
    expect(tabRoot.textContent).not.toContain("Run in background (keep current swipe)");

    // Template field label notes both {{input}} and Lumiverse macros
    const labels = Array.from(tabRoot.querySelectorAll("label.gg-field-label")).map(
      (el) => el.textContent ?? "",
    );
    expect(labels.some((t) => t.includes("{{input}}") && t.includes("{{char}}") && t.includes("{{user}}"))).toBe(
      true,
    );

    // Permission notices: regex_scripts and interceptor ungranted only -> optional degraded warning
    selectHandlers.length = 0;
    numericHandlers.length = 0;
    drawer.render(
      {
        ...baseView,
        permissions: {
          ...baseView.permissions,
          regex_scripts: false,
          interceptor: false,
        },
      },
      { force: true },
    );
    const featureOnlyNotices = Array.from(tabRoot.querySelectorAll(".gg-notice")).map(
      (el) => el.textContent ?? "",
    );
    expect(featureOnlyNotices).toHaveLength(1);
    expect(featureOnlyNotices[0]).toContain("interceptor");
    expect(featureOnlyNotices[0]).toContain("regex_scripts");
    expect(featureOnlyNotices[0]).toContain("Lumiverse regex scripts are skipped");

    // Permission notices: core permission missing alongside regex_scripts -> preserves core warning + optional warning
    drawer.render(
      {
        ...baseView,
        permissions: {
          ...baseView.permissions,
          generation: false,
          regex_scripts: false,
          interceptor: true,
        },
      },
      { force: true },
    );
    const combinedNotices = Array.from(tabRoot.querySelectorAll(".gg-notice")).map(
      (el) => el.textContent ?? "",
    );
    expect(combinedNotices).toHaveLength(2);
    expect(combinedNotices[0]).toContain("Missing extension permissions (generation)");
    expect(combinedNotices[1]).toContain("Optional permissions not granted (regex_scripts)");

    drawer.destroy();
  });

  test("InputToolbarController handles guided_swipe click-and-hold, move/early-release cancellation, Ctrl/Cmd+Click/Enter, and timer cleanup", () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-btn.is-holding");

    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const pendingHoldTimers = new Map<number, () => void>();
    let nextTimerId = 90_000;

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

    try {
      const triggered: Array<{ actionId: GuidedActionId; backgroundSwipe?: boolean }> = [];
      const aborted: string[] = [];
      const actionsMount = document.createElement("span");
      const fakeCtx = {
        ui: { mount: () => actionsMount },
      } as unknown as SpindleFrontendContext;

      const toolbar = new InputToolbarController(fakeCtx, {
        onTriggerAction: (actionId, options) => {
          triggered.push({ actionId, backgroundSwipe: options?.backgroundSwipe });
        },
        onAbortAction: (runId) => aborted.push(runId),
        onRestoreLatest: () => {},
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      });

      const settings = createDefaultSettings();
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });

      const getSwipeBtn = () =>
        actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_swipe"]')!;

      const Win = document.defaultView!;
      const PointerEvt = Win.PointerEvent;
      const MouseEvt = Win.MouseEvent;
      const KeyEvt = Win.KeyboardEvent;

      // Tooltip and aria-keyshortcuts when idle
      expect(getSwipeBtn().getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
      expect(getSwipeBtn().title).toBe(
        "Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background",
      );

      // Normal click -> backgroundSwipe false
      getSwipeBtn().click();
      expect(triggered).toEqual([{ actionId: "guided_swipe", backgroundSwipe: false }]);
      triggered.length = 0;

      // Ctrl+Click and Meta+Click -> backgroundSwipe true
      getSwipeBtn().dispatchEvent(new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      getSwipeBtn().dispatchEvent(new MouseEvt("click", { bubbles: true, cancelable: true, metaKey: true }));
      expect(triggered).toEqual([
        { actionId: "guided_swipe", backgroundSwipe: true },
        { actionId: "guided_swipe", backgroundSwipe: true },
      ]);
      triggered.length = 0;

      // Ctrl+Enter and Meta+Space -> backgroundSwipe true
      getSwipeBtn().dispatchEvent(new KeyEvt("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
      getSwipeBtn().dispatchEvent(new KeyEvt("keydown", { key: " ", metaKey: true, bubbles: true, cancelable: true }));
      expect(triggered).toEqual([
        { actionId: "guided_swipe", backgroundSwipe: true },
        { actionId: "guided_swipe", backgroundSwipe: true },
      ]);
      triggered.length = 0;

      // Non-primary pointer and secondary mouse button do NOT start hold
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: false, pointerType: "touch", clientX: 10, clientY: 10 }),
      );
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: true, pointerType: "mouse", button: 2, clientX: 10, clientY: 10 }),
      );
      expect(pendingHoldTimers.size).toBe(0);
      expect(getSwipeBtn().classList.contains("is-holding")).toBe(false);

      // Primary touch hold -> fires once after 450ms, blocks contextmenu, and suppresses trailing click
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: true, pointerType: "touch", clientX: 20, clientY: 20 }),
      );
      expect(getSwipeBtn().classList.contains("is-holding")).toBe(true);
      expect(pendingHoldTimers.size).toBe(1);

      const ctxMenuWhileHolding = new MouseEvt("contextmenu", { bubbles: true, cancelable: true });
      getSwipeBtn().dispatchEvent(ctxMenuWhileHolding);
      expect(ctxMenuWhileHolding.defaultPrevented).toBe(true);

      // Small move <= 10px (6, 8 => hypot 10) keeps hold alive
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointermove", { isPrimary: true, pointerType: "touch", clientX: 26, clientY: 28 }),
      );
      expect(pendingHoldTimers.size).toBe(1);

      fireHoldTimers();
      expect(getSwipeBtn().classList.contains("is-holding")).toBe(false);
      expect(triggered).toEqual([{ actionId: "guided_swipe", backgroundSwipe: true }]);

      // Releasing pointer and firing click after hold does not double-trigger
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerup", { isPrimary: true, pointerType: "touch", clientX: 26, clientY: 28 }),
      );
      const trailingClick = new MouseEvt("click", { bubbles: true, cancelable: true });
      getSwipeBtn().dispatchEvent(trailingClick);
      expect(trailingClick.defaultPrevented).toBe(true);
      expect(triggered).toHaveLength(1);
      triggered.length = 0;

      // Moving > 10px cancels hold
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointermove", { isPrimary: true, pointerType: "mouse", clientX: 18, clientY: 18 }),
      );
      expect(pendingHoldTimers.size).toBe(0);
      expect(getSwipeBtn().classList.contains("is-holding")).toBe(false);

      // Releasing early (pointerup / pointercancel / pointerleave) cancels hold
      for (const endEvt of ["pointerup", "pointercancel", "pointerleave"] as const) {
        getSwipeBtn().dispatchEvent(
          new PointerEvt("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 }),
        );
        expect(pendingHoldTimers.size).toBe(1);
        getSwipeBtn().dispatchEvent(new PointerEvt(endEvt, { isPrimary: true, pointerType: "mouse" }));
        expect(pendingHoldTimers.size).toBe(0);
        expect(getSwipeBtn().classList.contains("is-holding")).toBe(false);
      }

      // Re-render clears active hold timer
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      toolbar.render({
        settings,
        activeRun: { runId: "run-swipe", actionId: "guided_swipe", chatId: "c1", startedAt: 1 },
        recovery: [],
        hasActiveChat: true,
      });
      expect(pendingHoldTimers.size).toBe(0);
      expect(getSwipeBtn().title).toBe("Stop Guided Swipe");
      expect(getSwipeBtn().hasAttribute("aria-keyshortcuts")).toBe(false);

      // While running: Ctrl+Enter and pointerdown do not trigger; click aborts
      getSwipeBtn().dispatchEvent(new KeyEvt("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 }),
      );
      expect(pendingHoldTimers.size).toBe(0);
      expect(triggered).toHaveLength(0);
      getSwipeBtn().click();
      expect(aborted).toEqual(["run-swipe"]);

      // Destroy clears active hold timer
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      getSwipeBtn().dispatchEvent(
        new PointerEvt("pointerdown", { isPrimary: true, pointerType: "mouse", button: 0, clientX: 10, clientY: 10 }),
      );
      expect(pendingHoldTimers.size).toBe(1);
      toolbar.destroy();
      expect(pendingHoldTimers.size).toBe(0);
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("InputToolbarController handles guided_continue drop-up menu, hold/shortcuts, zoom positioning, grace period, keyboard nav, and cleanup", () => {
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-dropup-menu");
    expect(GUIDED_GENERATIONS_CSS).toContain("z-index: 11000");
    expect(GUIDED_GENERATIONS_CSS).toContain(".gg-dropup-item");
    expect(CONTINUE_MENU_ICONS.remove_last_continue).toContain("<svg");
    expect(CONTINUE_MENU_ICONS.regenerate_last_continue).toContain("<svg");

    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origDateNow = Date.now;
    let fakeNow = 10_000;
    const pendingHoldTimers = new Map<number, () => void>();
    let nextTimerId = 92_000;

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

    const Win = document.defaultView!;
    const origGetComputedStyle = Win.getComputedStyle;
    try {
      const triggered: GuidedActionId[] = [];
      const aborted: string[] = [];
      let removeCalls = 0;
      let regenerateCalls = 0;

      const actionsMount = document.createElement("span");
      document.body.append(actionsMount);
      const fakeCtx = {
        ui: { mount: () => actionsMount },
      } as unknown as SpindleFrontendContext;

      const toolbar = new InputToolbarController(fakeCtx, {
        onTriggerAction: (actionId) => triggered.push(actionId),
        onAbortAction: (runId) => aborted.push(runId),
        onRestoreLatest: () => {},
        onRemoveLastContinue: () => {
          removeCalls += 1;
        },
        onRegenerateLastContinue: () => {
          regenerateCalls += 1;
        },
      });

      const settings = createDefaultSettings();
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });

      const getContinueBtn = () =>
        actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_continue"]')!;
      const getMenu = () =>
        document.body.querySelector<HTMLDivElement>(".gg-dropup-menu");
      const getMenuItems = () =>
        Array.from(document.body.querySelectorAll<HTMLButtonElement>('.gg-dropup-menu [role="menuitem"]'));

      const PointerEvt = Win.PointerEvent;
      const MouseEvt = Win.MouseEvent;
      const KeyEvt = Win.KeyboardEvent;

      // Attributes on idle guided_continue button
      expect(getContinueBtn().getAttribute("aria-haspopup")).toBe("menu");
      expect(getContinueBtn().getAttribute("aria-expanded")).toBe("false");
      expect(getContinueBtn().title).toBe(
        "Guided Continue — click to continue, hold for continue options",
      );

      // Single click triggers guided_continue without opening menu
      getContinueBtn().click();
      expect(triggered).toEqual(["guided_continue"]);
      expect(getMenu()).toBeNull();
      triggered.length = 0;

      // Zoom & anchor positioning above button
      let mockZoom = "1.25";
      Win.getComputedStyle = (() => ({ zoom: mockZoom }) as CSSStyleDeclaration) as typeof Win.getComputedStyle;
      Object.defineProperty(Win, "innerWidth", { configurable: true, value: 1000 });
      Object.defineProperty(Win, "innerHeight", { configurable: true, value: 800 });
      const btnForRect = getContinueBtn();
      btnForRect.getBoundingClientRect = () =>
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

      // 450ms touch hold opens menu portaled to document.body, suppresses contextmenu & trailing click
      btnForRect.dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "touch",
          clientX: 260,
          clientY: 610,
        }),
      );
      expect(btnForRect.classList.contains("is-holding")).toBe(true);
      const ctxEvt = new MouseEvt("contextmenu", { bubbles: true, cancelable: true });
      btnForRect.dispatchEvent(ctxEvt);
      expect(ctxEvt.defaultPrevented).toBe(true);

      fakeNow += 450;
      fireHoldTimers();
      expect(btnForRect.classList.contains("is-holding")).toBe(false);
      expect(btnForRect.getAttribute("aria-expanded")).toBe("true");

      const menu = getMenu()!;
      expect(menu).not.toBeNull();
      expect(menu.parentElement).toBe(document.body);
      expect(menu.getAttribute("role")).toBe("menu");
      expect(menu.style.left).toBe("200px"); // 250 / 1.25
      expect(menu.style.bottom).toBe("166px"); // (800 - 600) / 1.25 + 6
      expect(menu.style.top).toBe("");

      const items = getMenuItems();
      expect(items.map((el) => el.textContent?.trim())).toEqual([
        "Remove the last continue",
        "Regenerate last continue",
      ]);
      expect(document.activeElement).toBe(items[0]);

      // Lifting touch within ~150ms grace period does NOT close menu or trigger guided_continue
      fakeNow += 40;
      btnForRect.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 260,
          clientY: 610,
        }),
      );
      const trailingClick = new MouseEvt("click", { bubbles: true, cancelable: true });
      btnForRect.dispatchEvent(trailingClick);
      expect(trailingClick.defaultPrevented).toBe(true);
      expect(triggered).toHaveLength(0);
      expect(getMenu()).not.toBeNull();

      // Outside pointerdown within < 150ms grace window does NOT close menu
      document.body.dispatchEvent(
        new PointerEvt("pointerdown", { bubbles: true, isPrimary: true, clientX: 10, clientY: 10 }),
      );
      expect(getMenu()).not.toBeNull();

      // Keyboard navigation inside menu (ArrowDown, ArrowUp, End, Home) and Escape restores focus
      menu.dispatchEvent(new KeyEvt("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[1]);
      menu.dispatchEvent(new KeyEvt("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[0]);
      menu.dispatchEvent(new KeyEvt("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[1]);
      menu.dispatchEvent(new KeyEvt("keydown", { key: "Home", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[0]);
      menu.dispatchEvent(new KeyEvt("keydown", { key: "End", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[1]);

      menu.dispatchEvent(new KeyEvt("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(getMenu()).toBeNull();
      expect(btnForRect.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(btnForRect);

      // Insufficient top space flips menu below button cleanly
      mockZoom = "1";
      btnForRect.getBoundingClientRect = () =>
        ({
          top: 4,
          bottom: 30,
          left: 20,
          right: 50,
          width: 30,
          height: 26,
          x: 20,
          y: 4,
          toJSON: () => ({}),
        }) as DOMRect;
      btnForRect.dispatchEvent(
        new KeyEvt("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }),
      );
      const flippedMenu = getMenu()!;
      expect(flippedMenu).not.toBeNull();
      expect(flippedMenu.style.top).toBe("36px"); // 30 + 6
      expect(flippedMenu.style.bottom).toBe("");

      // Outside pointerdown after >= 150ms dismisses menu
      fakeNow += 200;
      document.body.dispatchEvent(
        new PointerEvt("pointerdown", { bubbles: true, isPrimary: true, clientX: 500, clientY: 500 }),
      );
      expect(getMenu()).toBeNull();

      // Ctrl+Click, Shift+F10, Ctrl+Enter open menu and items dispatch handlers
      btnForRect.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      getMenuItems()[0]!.click();
      expect(removeCalls).toBe(1);
      expect(getMenu()).toBeNull();

      btnForRect.dispatchEvent(
        new KeyEvt("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
      );
      expect(getMenu()).not.toBeNull();
      getMenuItems()[1]!.click();
      expect(regenerateCalls).toBe(1);
      expect(getMenu()).toBeNull();

      btnForRect.dispatchEvent(
        new KeyEvt("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
      );
      expect(getMenu()).not.toBeNull();

      // Scroll / resize dismissal
      Win.dispatchEvent(new Win.Event("resize"));
      expect(getMenu()).toBeNull();

      // render() with activeRun closes open menu and hides aria-haspopup while running
      btnForRect.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, metaKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      toolbar.render({
        settings,
        activeRun: { runId: "run-cont", actionId: "guided_continue", chatId: "c1", startedAt: 1 },
        recovery: [],
        hasActiveChat: true,
      });
      expect(getMenu()).toBeNull();
      expect(getContinueBtn().hasAttribute("aria-haspopup")).toBe(false);
      getContinueBtn().click();
      expect(aborted).toEqual(["run-cont"]);

      // destroy() cleans up open menu
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      getContinueBtn().dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      toolbar.destroy();
      expect(getMenu()).toBeNull();
    } finally {
      Win.getComputedStyle = origGetComputedStyle;
      Date.now = origDateNow;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("InputToolbarController handles input_recovery press-and-hold drop-up menu with History and Clear History options", () => {
    expect(RECOVERY_MENU_ICONS.history).toContain("<svg");
    expect(RECOVERY_MENU_ICONS.clear_history).toContain("<svg");

    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origDateNow = Date.now;
    let fakeNow = 20_000;
    const pendingHoldTimers = new Map<number, () => void>();
    let nextTimerId = 94_000;

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

    const Win = document.defaultView!;
    try {
      let restoreLatestCalls = 0;
      let clearRecoveryCalls = 0;
      const restoredEntries: RecoveryEntry[] = [];

      const actionsMount = document.createElement("span");
      document.body.append(actionsMount);
      const fakeCtx = {
        ui: { mount: () => actionsMount },
      } as unknown as SpindleFrontendContext;

      const toolbar = new InputToolbarController(fakeCtx, {
        onTriggerAction: () => {},
        onAbortAction: () => {},
        onRestoreLatest: () => {
          restoreLatestCalls += 1;
        },
        onRestoreEntry: (entry) => {
          restoredEntries.push(entry);
        },
        onClearRecovery: () => {
          clearRecoveryCalls += 1;
        },
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      });

      const entries: RecoveryEntry[] = [
        {
          id: "rec-2",
          text: "Second saved draft",
          actionId: "guided_swipe",
          chatId: "c1",
          createdAt: 200,
        },
        {
          id: "rec-1",
          text: "First saved draft",
          actionId: "guided_response",
          chatId: "c1",
          createdAt: 100,
        },
      ];

      const settings = createDefaultSettings();
      toolbar.render({ settings, activeRun: null, recovery: entries, hasActiveChat: true });

      const getRecoveryBtn = () =>
        actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!;
      const getMenu = () =>
        document.body.querySelector<HTMLDivElement>(".gg-dropup-menu");
      const getMenuItems = () =>
        Array.from(document.body.querySelectorAll<HTMLButtonElement>('.gg-dropup-menu [role="menuitem"]'));

      const PointerEvt = Win.PointerEvent;
      const MouseEvt = Win.MouseEvent;
      const KeyEvt = Win.KeyboardEvent;

      expect(getRecoveryBtn().getAttribute("aria-haspopup")).toBe("menu");
      expect(getRecoveryBtn().getAttribute("aria-expanded")).toBe("false");

      // Single click restores latest without opening menu
      getRecoveryBtn().click();
      expect(restoreLatestCalls).toBe(1);
      expect(getMenu()).toBeNull();

      // Press and hold for 450ms opens drop-up with 2 options: History and Clear History
      const recBtn = getRecoveryBtn();
      recBtn.dispatchEvent(
        new PointerEvt("pointerdown", {
          isPrimary: true,
          pointerType: "touch",
          clientX: 100,
          clientY: 100,
        }),
      );
      expect(recBtn.classList.contains("is-holding")).toBe(true);
      fakeNow += 450;
      fireHoldTimers();
      expect(recBtn.classList.contains("is-holding")).toBe(false);
      expect(recBtn.getAttribute("aria-expanded")).toBe("true");

      // Release pointer after hold -> trailing click is suppressed and menu stays open
      fakeNow += 30;
      recBtn.dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 100,
          clientY: 100,
        }),
      );
      const trailingClick = new MouseEvt("click", { bubbles: true, cancelable: true });
      recBtn.dispatchEvent(trailingClick);
      expect(trailingClick.defaultPrevented).toBe(true);
      expect(restoreLatestCalls).toBe(1);

      const menu = getMenu()!;
      expect(menu).not.toBeNull();
      expect(menu.getAttribute("aria-label")).toBe("Input Recovery options");

      const rootItems = getMenuItems();
      expect(rootItems.map((el) => el.textContent?.trim())).toEqual([
        "History",
        "Clear History",
      ]);

      // Clicking "History" switches drop-up to saved drafts list
      rootItems[0]!.click();
      expect(getMenu()).not.toBeNull();
      expect(getMenu()!.getAttribute("aria-label")).toBe("Input Recovery History");
      const historyItems = getMenuItems();
      expect(historyItems).toHaveLength(2);
      expect(historyItems[0]!.getAttribute("data-gg-recovery-id")).toBe("rec-2");
      expect(historyItems[1]!.getAttribute("data-gg-recovery-id")).toBe("rec-1");

      // Pressing ArrowLeft returns to root options ("History" and "Clear History")
      getMenu()!.dispatchEvent(
        new KeyEvt("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
      expect(getMenuItems().map((el) => el.textContent?.trim())).toEqual([
        "History",
        "Clear History",
      ]);

      // Clicking "History" then selecting the second draft restores that entry and closes menu
      getMenuItems()[0]!.click();
      getMenuItems()[1]!.click();
      expect(restoredEntries).toEqual([entries[1]!]);
      expect(getMenu()).toBeNull();
      expect(recBtn.getAttribute("aria-expanded")).toBe("false");

      // Re-open with Ctrl+Click and click "Clear History"
      recBtn.dispatchEvent(
        new MouseEvt("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      expect(getMenu()).not.toBeNull();
      const clearItem = document.body.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="clear_history"]',
      )!;
      clearItem.click();
      expect(clearRecoveryCalls).toBe(1);
      expect(getMenu()).toBeNull();

      // Empty history state in drop-up History view
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      getRecoveryBtn().dispatchEvent(
        new KeyEvt("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
      );
      expect(getMenu()).not.toBeNull();
      getMenuItems()[0]!.click();
      expect(document.body.querySelector(".gg-dropup-empty")?.textContent).toBe(
        "No saved inputs yet.",
      );
      const backBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="back"]',
      )!;
      backBtn.click();
      expect(getMenuItems().map((el) => el.textContent?.trim())).toEqual([
        "History",
        "Clear History",
      ]);

      toolbar.destroy();
      expect(getMenu()).toBeNull();
    } finally {
      Date.now = origDateNow;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("audit regressions: History maxHeight viewport clamping, disabled Clear History when empty, onFocusOut with pendingView not swallowing drawer clicks, and updateRecovery preserved across pendingView flush", async () => {
    const Win = document.defaultView!;
    const origInnerHeight = Win.innerHeight;
    Object.defineProperty(Win, "innerHeight", { value: 240, configurable: true });

    const actionsMount = document.createElement("span");
    document.body.append(actionsMount);
    const fakeCtx = {
      ui: { mount: () => actionsMount },
    } as unknown as SpindleFrontendContext;

    const toolbar = new InputToolbarController(fakeCtx, {
      onTriggerAction: () => {},
      onAbortAction: () => {},
      onRestoreLatest: () => {},
      onRestoreEntry: () => {},
      onClearRecovery: () => {},
      onRemoveLastContinue: () => {},
      onRegenerateLastContinue: () => {},
    });

    try {
      const settings = createDefaultSettings();
      // 1. Empty recovery -> Clear History disabled in root drop-up menu
      toolbar.render({ settings, activeRun: null, recovery: [], hasActiveChat: true });
      const recBtn = actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!;
      recBtn.dispatchEvent(new Win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      const clearMenuBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="clear_history"]',
      )!;
      expect(clearMenuBtn.disabled).toBe(true);
      expect(clearMenuBtn.getAttribute("aria-disabled")).toBe("true");
      toolbar.render({
        settings,
        activeRun: null,
        recovery: Array.from({ length: 15 }, (_, idx) => ({
          id: `rec-${idx}`,
          text: `Saved draft #${idx}`,
          actionId: "guided_response" as const,
          chatId: "chat-1",
          createdAt: 1000 + idx,
        })),
        hasActiveChat: true,
      });

      // Live refresh keeps recovery drop-up open and enables Clear History
      const refreshedClearBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="clear_history"]',
      )!;
      expect(refreshedClearBtn).not.toBeNull();
      expect(refreshedClearBtn.disabled).toBe(false);
      // Close before re-opening with tight viewport rect
      document.dispatchEvent(new Win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(document.body.querySelector(".gg-dropup-menu")).toBeNull();

      // 2. Tight viewport clamps menuEl.style.maxHeight and .gg-dropup-history-list maxHeight
      const recBtn2 = actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!;
      recBtn2.getBoundingClientRect = () =>
        ({
          left: 100,
          right: 130,
          top: 190,
          bottom: 220,
          width: 30,
          height: 30,
          x: 100,
          y: 190,
          toJSON: () => ({}),
        }) as DOMRect;
      recBtn2.dispatchEvent(new Win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      const historyMenuBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="history"]',
      )!;
      historyMenuBtn.click();
      const menuEl = document.body.querySelector<HTMLDivElement>(".gg-dropup-menu")!;
      const listEl = document.body.querySelector<HTMLDivElement>(".gg-dropup-history-list")!;
      expect(parseFloat(menuEl.style.maxHeight)).toBeLessThanOrEqual(190);
      expect(parseFloat(listEl.style.maxHeight)).toBeLessThanOrEqual(190);
    } finally {
      toolbar.destroy();
      actionsMount.remove();
      Object.defineProperty(Win, "innerHeight", { value: origInnerHeight, configurable: true });
    }

    // 3. SettingsDrawerController: onFocusOut while clicking a drawer button with pendingView
    //    must NOT detach the clicked button before click fires; and updateRecovery during pendingView
    //    is preserved when pendingView flushes.
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);
    let refreshClicked = 0;
    const drawerCtx = {
      ui: {
        registerDrawerTab: () => ({
          root: tabRoot,
          tabId: "gg-test-tab",
          setTitle: () => {},
          setShortName: () => {},
          setBadge: () => {},
          activate: () => {},
          destroy: () => {},
          onActivate: () => () => {},
        }),
      },
      components: {
        mountSwitch: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const btn = document.createElement("button");
          btn.setAttribute("role", "switch");
          btn.setAttribute("aria-checked", "true");
          el.append(btn);
          return { componentId: "sw", element: el as HTMLElement, update: () => {}, destroy: () => { el.replaceChildren(); }, getValue: () => true };
        },
        mountSelect: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          return { componentId: "sel", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
        mountModelCombobox: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          return { componentId: "mc", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "", refresh: () => {} };
        },
        mountTextArea: (target: string | Element, opts: { value?: string; ariaLabel?: string }) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const ta = document.createElement("textarea");
          if (opts.ariaLabel) ta.setAttribute("aria-label", opts.ariaLabel);
          ta.value = opts.value ?? "";
          el.append(ta);
          return { componentId: "ta", element: el as HTMLElement, update: () => {}, destroy: () => { el.replaceChildren(); }, getValue: () => ta.value };
        },
      },
    } as unknown as SpindleFrontendContext;

    const drawer = new SettingsDrawerController(drawerCtx, {
      onRefresh: () => {
        refreshClicked += 1;
      },
      onSaveSettings: async () => {},
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    const initialSettings = createDefaultSettings();
    const initialView: ExtensionBootstrapView = {
      settings: initialSettings,
      connections: [],
      presets: [],
      recovery: [],
      activeRun: null,
      permissions: {
        generation: true,
        chats: true,
        chat_mutation: true,
        characters: true,
        presets: true,
        regex_scripts: true,
        interceptor: true,
      },
    };

    try {
      drawer.render(initialView);
      const templateBox = tabRoot.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Guided Response Guidance Template"]',
      )!;
      const refreshBtn = tabRoot.querySelector<HTMLButtonElement>(
        'button[data-gg-focus-key="refresh"]',
      )!;

      // Focus textarea so drawer.render(nextView) queues pendingView instead of rebuilding
      templateBox.focus();
      drawer.render({
        ...initialView,
        recovery: [
          {
            id: "old-rec",
            text: "Stale recovery",
            actionId: "guided_response",
            chatId: "chat-1",
            createdAt: 1,
          },
        ],
      });

      // Update recovery while pendingView is queued
      drawer.updateRecovery(
        [
          {
            id: "fresh-rec",
            text: "Fresh recovery entry",
            actionId: "guided_response",
            chatId: "chat-1",
            createdAt: 2,
          },
        ],
        initialSettings,
      );

      // Simulate clicking Refresh button while textarea had focus:
      // pointerdown -> focusout (relatedTarget: refreshBtn) -> microtask tick -> mouseup -> click
      tabRoot.dispatchEvent(new Win.MouseEvent("mousedown", { bubbles: true }));
      templateBox.dispatchEvent(
        new Win.FocusEvent("focusout", { bubbles: true, relatedTarget: refreshBtn }),
      );
      await Promise.resolve();
      // refreshBtn must STILL be connected so the browser click fires on it!
      expect(refreshBtn.isConnected).toBe(true);

      refreshBtn.dispatchEvent(new Win.MouseEvent("mouseup", { bubbles: true }));
      refreshBtn.click();
      expect(refreshClicked).toBe(1);

      // Wait for macrotask pendingView flush -> updated recovery ("Fresh recovery entry") is preserved!
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(tabRoot.textContent).toContain("Fresh recovery entry");
      expect(tabRoot.textContent).not.toContain("Stale recovery");
    } finally {
      drawer.destroy();
      tabRoot.remove();
    }
  });

  test("post-audit polish: mountBoundedIntegerField focusout inside slot, setRecoveryBusy, and touch post-hold click suppression", () => {
    const Win = document.defaultView!;
    // 1. mountBoundedIntegerField focusout with relatedTarget inside options.slot does NOT commit default/flush
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);
    const savedPatches: GuidedGenerationsSettings[] = [];
    let currentNumericVal: number | null = 5;
    let slotBtn!: HTMLButtonElement;
    const drawerCtx = {
      ui: {
        registerDrawerTab: () => ({
          root: tabRoot,
          tabId: "gg-test-polish",
          setTitle: () => {},
          setShortName: () => {},
          setBadge: () => {},
          activate: () => {},
          destroy: () => {},
          onActivate: () => () => {},
        }),
      },
      components: {
        mountSwitch: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          return { componentId: "sw", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => true };
        },
        mountSelect: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          return { componentId: "sel", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
        mountNumericInput: (
          target: string | Element,
          opts: { value?: number | null; onChange?: (v: number | null) => void },
        ) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          const input = document.createElement("input");
          input.type = "number";
          input.value = opts.value != null ? String(opts.value) : "";
          slotBtn = document.createElement("button");
          slotBtn.type = "button";
          el.append(input, slotBtn);
          return {
            componentId: "num",
            element: el as HTMLElement,
            update: (patch: { value?: number | null }) => {
              if (patch.value !== undefined) {
                currentNumericVal = patch.value;
                input.value = patch.value === null ? "" : String(patch.value);
              }
            },
            destroy: () => el.replaceChildren(),
            getValue: () => currentNumericVal,
            onChange: opts.onChange,
          };
        },
        mountModelCombobox: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          return { componentId: "mc", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "", refresh: () => {} };
        },
        mountTextArea: (target: string | Element) => {
          const el = typeof target === "string" ? document.querySelector(target)! : target;
          return { componentId: "ta", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
      },
    } as unknown as SpindleFrontendContext;

    const drawer = new SettingsDrawerController(drawerCtx, {
      onRefresh: () => {},
      onSaveSettings: async (next) => {
        savedPatches.push(next);
      },
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    try {
      const settings = createDefaultSettings();
      settings.inputRecovery.maxEntries = 12;
      currentNumericVal = 12;
      drawer.render({
        settings,
        connections: [],
        presets: [],
        recovery: [
          {
            id: "r1",
            text: "Saved 1",
            actionId: "guided_response",
            chatId: "c1",
            createdAt: 1,
          },
        ],
        activeRun: null,
        permissions: {
          generation: true,
          chats: true,
          chat_mutation: true,
          characters: true,
          presets: true,
          regex_scripts: true,
          interceptor: true,
        },
      });

      const maxEntriesSlot = tabRoot.querySelector("#gg-recovery-max-entries")?.parentElement as HTMLElement;
      expect(maxEntriesSlot).not.toBeNull();
      const inputEl = maxEntriesSlot.querySelector("input")!;
      const maxEntriesSlotBtn = maxEntriesSlot.querySelector("button")!;
      // Focus moves to sibling inside slot (relatedTarget inside options.slot) -> must NOT flush/reset
      currentNumericVal = null;
      inputEl.value = "";
      maxEntriesSlot.dispatchEvent(
        new Win.FocusEvent("focusout", { bubbles: true, relatedTarget: maxEntriesSlotBtn }),
      );
      expect(inputEl.value).toBe("");
      expect(savedPatches).toHaveLength(0);

      // setRecoveryBusy(true) disables Clear History and restore buttons; setRecoveryBusy(false) re-enables
      drawer.setRecoveryBusy(true);
      const recoveryButtons = Array.from(
        tabRoot.querySelectorAll<HTMLButtonElement>(".gg-recovery-list button"),
      );
      expect(recoveryButtons.length).toBeGreaterThan(0);
      expect(recoveryButtons.every((b) => b.disabled)).toBe(true);
      drawer.setRecoveryBusy(false);
      expect(recoveryButtons.every((b) => !b.disabled)).toBe(true);
    } finally {
      drawer.destroy();
      tabRoot.remove();
    }

    // 2. Touch pointerup keeps post-hold click suppression active for delayed clicks (e.g. 120ms) within 250ms
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origDateNow = Date.now;
    let fakeNow = 50_000;
    const holdTimers = new Map<number, () => void>();
    let nextId = 81_000;

    Date.now = () => fakeNow;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 450) {
        const id = ++nextId;
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

    const actionsMount = document.createElement("span");
    document.body.append(actionsMount);
    const triggered: string[] = [];
    const toolbar = new InputToolbarController(
      { ui: { mount: () => actionsMount } } as unknown as SpindleFrontendContext,
      {
        onTriggerAction: (id) => triggered.push(id),
        onAbortAction: () => {},
        onRestoreLatest: () => {},
        onRestoreEntry: () => {},
        onClearRecovery: () => {},
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
      const swipeBtn = actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="guided_swipe"]')!;
      swipeBtn.dispatchEvent(
        new Win.PointerEvent("pointerdown", {
          isPrimary: true,
          pointerType: "touch",
          clientX: 50,
          clientY: 50,
        }),
      );
      fakeNow += 450;
      for (const [id, fn] of [...holdTimers.entries()]) {
        holdTimers.delete(id);
        fn();
      }
      expect(triggered).toEqual(["guided_swipe"]);
      triggered.length = 0;
      swipeBtn.dispatchEvent(
        new Win.PointerEvent("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerType: "touch",
          clientX: 50,
          clientY: 50,
        }),
      );
      // Advance 120ms (< 250ms POST_RELEASE_MAX_WINDOW_MS): delayed touch click must still be suppressed
      fakeNow += 120;
      const delayedClick = new Win.MouseEvent("click", { bubbles: true, cancelable: true });
      swipeBtn.dispatchEvent(delayedClick);
      expect(delayedClick.defaultPrevented).toBe(true);
      expect(triggered).toEqual([]);
    } finally {
      toolbar.destroy();
      actionsMount.remove();
      Date.now = origDateNow;
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = origSetTimeout;
      (globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout =
        origClearTimeout;
    }
  });

  test("SettingsDrawerController defers mountModelCombobox connection binding on collapsed cards and binds on expand, plus PillMetricsController & StreamingIndicatorController event guards", async () => {
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);

    const selectHandlers: Array<{ ariaLabel?: string; onChange?: (val: string) => void }> = [];
    const modelComboboxes: Array<{
      options: { connection?: { kind: string; id?: string }; placeholder?: string };
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
          tabId: "gg-deferred-combobox-tab",
          setTitle: () => {},
          setShortName: () => {},
          setBadge: () => {},
          activate: () => {},
          destroy: () => {},
          onActivate: () => () => {},
        }),
      },
      components: {
        mountSwitch: (target: string | Element) => {
          const el = resolveTarget(target);
          return { componentId: "sw", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => true };
        },
        mountSelect: (target: string | Element, opts: { ariaLabel?: string; onChange?: (v: string) => void }) => {
          const el = resolveTarget(target);
          selectHandlers.push({ ariaLabel: opts.ariaLabel, onChange: opts.onChange });
          return { componentId: "sel", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
        mountModelCombobox: (
          target: string | Element,
          opts: { connection?: { kind: string; id?: string }; placeholder?: string },
        ) => {
          const el = resolveTarget(target);
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
          return { componentId: "ta", element: el as HTMLElement, update: () => {}, destroy: () => {}, getValue: () => "" };
        },
      },
    } as unknown as SpindleFrontendContext;

    let latestSettings = createDefaultSettings();
    const drawer = new SettingsDrawerController(fakeCtx, {
      onRefresh: () => {},
      onSaveSettings: async (next) => {
        latestSettings = next;
      },
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    try {
      latestSettings.actions.guided_continue.connectionId = "c2";
      const view: ExtensionBootstrapView = {
        settings: latestSettings,
        connections: [
          { id: "c1", name: "Main", provider: "openai", model: "gpt-4o", isDefault: true },
          { id: "c2", name: "Anthropic", provider: "anthropic", model: "claude-sonnet", isDefault: false },
        ],
        presets: [{ id: "p1", name: "Default Preset" }],
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
      };

      drawer.render(view);

      // All 5 action cards + Guided Scene Settings card start collapsed -> all 6 mountModelCombobox calls receive connection: undefined
      expect(modelComboboxes).toHaveLength(6);
      for (const mc of modelComboboxes) {
        expect(mc.options.connection).toBeUndefined();
        expect(mc.updates).toEqual([]);
      }

      const headers = Array.from(tabRoot.querySelectorAll<HTMLButtonElement>(".gg-card-header"));
      // Expand Guided Response (headers[1]) -> binds default active connection { kind: "llm" }
      headers[1]!.click();
      expect(modelComboboxes[0]!.updates).toEqual([{ connection: { kind: "llm" } }]);
      // Other 5 comboboxes remain unbound
      for (let i = 1; i < 6; i += 1) {
        expect(modelComboboxes[i]!.updates).toEqual([]);
      }

      // Collapsing and re-expanding Guided Response does not fire duplicate connection updates
      headers[1]!.click();
      headers[1]!.click();
      expect(modelComboboxes[0]!.updates).toEqual([{ connection: { kind: "llm" } }]);

      // Changing connectionId on a still-collapsed card (Guided Swipe, index 3) updates only placeholder until expanded
      const swipeConnSelect = selectHandlers.find(
        (s) => s.ariaLabel === "Guided Swipe API Connection Profile",
      )!;
      swipeConnSelect.onChange?.("c2");
      expect(modelComboboxes[3]!.updates).toEqual([
        { placeholder: "Use connection model (claude-sonnet)" },
      ]);
      // Expanding Guided Swipe (headers[4]) now binds { kind: "llm", id: "c2" }
      headers[4]!.click();
      expect(modelComboboxes[3]!.updates).toEqual([
        { placeholder: "Use connection model (claude-sonnet)" },
        { connection: { kind: "llm", id: "c2" } },
      ]);

      // Re-rendering drawer while Guided Response and Guided Swipe are expanded passes connection at mount time for those two only
      modelComboboxes.length = 0;
      drawer.render({ ...view, settings: latestSettings }, { force: true });
      expect(modelComboboxes).toHaveLength(6);
      expect(modelComboboxes[0]!.options.connection).toEqual({ kind: "llm" });
      expect(modelComboboxes[1]!.options.connection).toBeUndefined();
      expect(modelComboboxes[2]!.options.connection).toBeUndefined();
      expect(modelComboboxes[3]!.options.connection).toEqual({ kind: "llm", id: "c2" });
      expect(modelComboboxes[4]!.options.connection).toBeUndefined();
      expect(modelComboboxes[5]!.options.connection).toBeUndefined();
    } finally {
      drawer.destroy();
      tabRoot.remove();
    }

    // PillMetricsController: skips redundant getMessages on CHAT_CHANGED when latestFallback.swipe_id !== entry.swipeId
    let getMessagesCalls = 0;
    let activeSwipe = 0;
    const pillCtx = {
      chats: {
        getMessages: async () => {
          getMessagesCalls += 1;
          return {
            data: [{ id: "m-bg", chat_id: "chat-1", swipe_id: activeSwipe, extra: {} }],
            total: 1,
          };
        },
        updateMessage: async () => ({}),
      },
      getActiveChat: () => ({ chatId: "chat-1", characterId: null }),
    } as unknown as SpindleFrontendContext;

    const pillCtrl = new PillMetricsController(pillCtx);
    try {
      pillCtrl.handleMetricsEvent({
        type: "gg:generation_metrics",
        chatId: "chat-1",
        messageId: "m-bg",
        swipeId: 2,
        tokenCount: 120,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getMessagesCalls).toBe(1);

      // CHAT_CHANGED while user is still on swipe 0 (latestFallback.swipe_id === 0 !== 2) skips getMessages
      pillCtrl.onChatChanged("chat-1");
      await new Promise((r) => setTimeout(r, 0));
      expect(getMessagesCalls).toBe(1);

      // Swiping to swipe 2 updates latestFallback and flushes
      activeSwipe = 2;
      pillCtrl.onMessageEvent({
        chatId: "chat-1",
        message: { id: "m-bg", chat_id: "chat-1", swipe_id: 2, extra: {} },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getMessagesCalls).toBe(2);
    } finally {
      pillCtrl.destroy();
    }

    // StreamingIndicatorController: skips findMessageElement on message events for unrelated messageIds
    let findCalls = 0;
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const row = document.createElement("div");
    const mountBefore = document.createElement("span");
    mountBefore.setAttribute("data-spindle-mount", "message_body_before");
    row.append(mountBefore);
    document.body.append(row);

    const streamCtx = {
      getActiveChat: () => ({ chatId: "chat-1", characterId: null }),
      events: {
        on: (ev: string, fn: (payload: unknown) => void) => {
          eventHandlers.set(ev, fn);
          return () => eventHandlers.delete(ev);
        },
      },
      dom: {
        findMessageElement: (id: string) => {
          findCalls += 1;
          return id === "m-target" ? row : null;
        },
        inject: (target: Element, html: string, pos: InsertPosition = "beforeend") => {
          const wrap = document.createElement("div");
          wrap.innerHTML = html;
          target.insertAdjacentElement(pos, wrap);
          return wrap;
        },
        uninject: (el: Element) => el.remove(),
      },
    } as unknown as SpindleFrontendContext;

    const streamCtrl = new StreamingIndicatorController(streamCtx);
    try {
      streamCtrl.sync({
        runId: "r-1",
        actionId: "guided_response",
        chatId: "chat-1",
        startedAt: 1,
        messageId: "m-target",
        swipeId: 0,
      });
      expect(findCalls).toBe(1);

      // Unrelated message events must NOT call syncCurrent() / findMessageElement
      eventHandlers.get("MESSAGE_EDITED")?.({ message: { id: "m-other", content: "unrelated" } });
      eventHandlers.get("MESSAGE_SWIPED")?.({ messageId: "m-other", swipeId: 1 });
      eventHandlers.get("MESSAGE_SENT")?.({ message: { id: "m-other" } });
      expect(findCalls).toBe(1);

      // Event with undefined messageId or matching messageId still calls syncCurrent()
      eventHandlers.get("MESSAGE_EDITED")?.({});
      expect(findCalls).toBe(2);
      eventHandlers.get("MESSAGE_EDITED")?.({ message: { id: "m-target", content: "chunk" } });
      expect(findCalls).toBe(3);
    } finally {
      streamCtrl.destroy();
      row.remove();
    }
  });

  test("frontend audit fixes: recovery drop-up live refresh, scroll containment, open custom Select drawer protection, and theme-aware contrast CSS", async () => {
    const Win = document.defaultView!;

    // 1. Styles: no hardcoded pale #fecaca / #fde68a on running button or error/warn notices
    expect(GUIDED_GENERATIONS_CSS).not.toContain("#fecaca");
    expect(GUIDED_GENERATIONS_CSS).not.toContain("#fde68a");
    expect(GUIDED_GENERATIONS_CSS).toMatch(/\.gg-btn\.is-running\s*\{[^}]*var\(--lumiverse-danger/);
    expect(GUIDED_GENERATIONS_CSS).toMatch(/\.gg-notice\.is-error\s*\{[^}]*var\(--lumiverse-danger-text/);
    expect(GUIDED_GENERATIONS_CSS).toMatch(/\.gg-notice\.is-warn\s*\{[^}]*var\(--lumiverse-warning-text/);

    // 2. Drop-up live refreshRecovery() + scroll containment on unrelated vs ancestor/root scroll
    const outerScrollHost = document.createElement("div");
    const actionsMount = document.createElement("span");
    outerScrollHost.append(actionsMount);
    const unrelatedChatLog = document.createElement("div");
    document.body.append(outerScrollHost, unrelatedChatLog);

    const toolbar = new InputToolbarController(
      { ui: { mount: () => actionsMount } } as unknown as SpindleFrontendContext,
      {
        onTriggerAction: () => {},
        onAbortAction: () => {},
        onRestoreLatest: () => {},
        onRestoreEntry: () => {},
        onClearRecovery: () => {},
        onRemoveLastContinue: () => {},
        onRegenerateLastContinue: () => {},
      },
    );

    try {
      const settings = createDefaultSettings();
      const entry1: RecoveryEntry = {
        id: "r1",
        text: "First draft",
        actionId: "guided_response",
        chatId: "c1",
        createdAt: 100,
      };
      const entry2: RecoveryEntry = {
        id: "r2",
        text: "Second draft",
        actionId: "guided_swipe",
        chatId: "c1",
        createdAt: 200,
      };
      toolbar.render({ settings, activeRun: null, recovery: [entry1], hasActiveChat: true, chatId: "c1" });

      const recBtn = actionsMount.querySelector<HTMLButtonElement>('[data-gg-action="input_recovery"]')!;
      let anchorTop = 400;
      recBtn.getBoundingClientRect = () =>
        ({
          top: anchorTop,
          bottom: anchorTop + 26,
          left: 100,
          right: 130,
          width: 30,
          height: 26,
          x: 100,
          y: anchorTop,
          toJSON: () => ({}),
        }) as DOMRect;

      // Open recovery menu and switch to History view
      recBtn.dispatchEvent(new Win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      const historyBtn = document.body.querySelector<HTMLButtonElement>(
        '.gg-dropup-menu [data-gg-menu-action="history"]',
      )!;
      historyBtn.click();
      expect(document.body.querySelectorAll('.gg-dropup-menu [data-gg-recovery-id]')).toHaveLength(1);

      // Update recovery with new top entry -> menu stays OPEN, aria-expanded remains true, and History refreshes live
      toolbar.render({ settings, activeRun: null, recovery: [entry2, entry1], hasActiveChat: true, chatId: "c1" });
      expect(document.body.querySelector(".gg-dropup-menu")).not.toBeNull();
      expect(recBtn.getAttribute("aria-expanded")).toBe("true");
      const liveIds = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>('.gg-dropup-menu [data-gg-recovery-id]'),
      ).map((el) => el.getAttribute("data-gg-recovery-id"));
      expect(liveIds).toEqual(["r2", "r1"]);

      // Unrelated container scroll (e.g. chat log auto-scroll) does NOT close the menu
      unrelatedChatLog.dispatchEvent(new Win.Event("scroll", { bubbles: false }));
      expect(document.body.querySelector(".gg-dropup-menu")).not.toBeNull();

      // Ancestor container scroll (containing anchorBtn) DOES close the menu
      outerScrollHost.dispatchEvent(new Win.Event("scroll", { bubbles: false }));
      expect(document.body.querySelector(".gg-dropup-menu")).toBeNull();

      // Re-open, shift anchorBtn rect, then unrelated scroll DOES close because anchor moved
      recBtn.dispatchEvent(new Win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      expect(document.body.querySelector(".gg-dropup-menu")).not.toBeNull();
      anchorTop = 320;
      unrelatedChatLog.dispatchEvent(new Win.Event("scroll", { bubbles: false }));
      expect(document.body.querySelector(".gg-dropup-menu")).toBeNull();

      // Re-open, document scroll DOES close
      recBtn.dispatchEvent(new Win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      expect(document.body.querySelector(".gg-dropup-menu")).not.toBeNull();
      document.dispatchEvent(new Win.Event("scroll", { bubbles: false }));
      expect(document.body.querySelector(".gg-dropup-menu")).toBeNull();
    } finally {
      toolbar.destroy();
      outerScrollHost.remove();
      unrelatedChatLog.remove();
    }

    // 3. SettingsDrawerController defers re-renders while custom Spindle Select is open,
    //    but does NOT block renders when only a .gg-card-header is expanded
    const tabRoot = document.createElement("div");
    document.body.append(tabRoot);
    let selectTriggerEl: HTMLButtonElement | null = null;
    const fakeDrawerCtx = {
      ui: {
        registerDrawerTab: () => ({
          tabId: "gg-tab",
          root: tabRoot,
          onActivate: () => () => {},
          destroy: () => {},
        }),
      },
      components: {
        mountSwitch: (slot: HTMLElement) => {
          const btn = document.createElement("button");
          btn.setAttribute("role", "switch");
          slot.append(btn);
          return { update: () => {}, destroy: () => btn.remove() };
        },
        mountSelect: (slot: HTMLElement) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.setAttribute("role", "combobox");
          btn.setAttribute("aria-expanded", "false");
          slot.append(btn);
          if (!selectTriggerEl) selectTriggerEl = btn;
          return { update: () => {}, destroy: () => btn.remove() };
        },
        mountNumberInput: (slot: HTMLElement) => {
          const input = document.createElement("input");
          slot.append(input);
          return { update: () => {}, destroy: () => input.remove() };
        },
        mountTextArea: (slot: HTMLElement) => {
          const ta = document.createElement("textarea");
          slot.append(ta);
          return { update: () => {}, destroy: () => ta.remove() };
        },
      },
    } as unknown as SpindleFrontendContext;

    const drawer = new SettingsDrawerController(fakeDrawerCtx, {
      onRefresh: () => {},
      onSaveSettings: async () => {},
      onRestoreEntry: () => {},
      onClearRecovery: async () => {},
    });

    try {
      const baseView: ExtensionBootstrapView = {
        settings: createDefaultSettings(),
        connections: [],
        presets: [],
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
      };
      drawer.render(baseView);
      const firstRoot = tabRoot.querySelector(".gg-drawer");
      expect(firstRoot).not.toBeNull();

      // Open a section card (.gg-card-header[aria-expanded="true"]) -> non-forced render must still proceed
      const cardHeader = tabRoot.querySelector<HTMLButtonElement>(".gg-card-header")!;
      cardHeader.click();
      expect(cardHeader.getAttribute("aria-expanded")).toBe("true");
      drawer.render({ ...baseView, catalogWarnings: ["Warn 1"] });
      const secondRoot = tabRoot.querySelector(".gg-drawer");
      expect(secondRoot).not.toBe(firstRoot);

      // Now open a custom Spindle Select ([role="combobox"][aria-expanded="true"]) -> non-forced render MUST defer
      const combobox = tabRoot.querySelector<HTMLButtonElement>('[role="combobox"]')!;
      combobox.setAttribute("aria-expanded", "true");
      drawer.render({ ...baseView, catalogWarnings: ["Warn 2"] });
      expect(tabRoot.querySelector(".gg-drawer")).toBe(secondRoot);
      expect(combobox.isConnected).toBe(true);

      // Close select and dispatch focusout -> deferred pendingView flushes
      combobox.setAttribute("aria-expanded", "false");
      tabRoot.dispatchEvent(new Win.FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(tabRoot.querySelector(".gg-drawer")).not.toBe(secondRoot);
    } finally {
      drawer.destroy();
      tabRoot.remove();
    }
  });
});

describe("backend perf optimizations (Phase 3 & 4)", () => {
  test("SettingsStore coalesces concurrent cold-cache reads for settings.json and recovery.json (including bootstrap)", async () => {
    const files = new Map<string, string>([
      ["u1:settings.json", JSON.stringify({ toolbarPlacement: "before_native", inputRecovery: { enabled: true, maxEntries: 5 } })],
      [
        "u1:recovery.json",
        JSON.stringify([
          { id: "r1", text: "Saved draft", actionId: "guided_response", chatId: "c1", createdAt: 100 },
        ]),
      ],
    ]);
    const readCounts = new Map<string, number>();
    const existsCounts = new Map<string, number>();

    const fakeSpindle = {
      permissions: { has: () => true, onChanged: () => () => {} },
      log: { warn: () => {} },
      onFrontendMessage: () => () => {},
      sendToFrontend: () => {},
      connections: { list: async () => [] },
      presets: { list: async () => ({ data: [], total: 0 }) },
      userStorage: {
        exists: async (file: string, userId?: string) => {
          const k = `${userId}:${file}`;
          existsCounts.set(k, (existsCounts.get(k) ?? 0) + 1);
          await new Promise((r) => setTimeout(r, 10));
          return files.has(k);
        },
        read: async (file: string, userId?: string) => {
          const k = `${userId}:${file}`;
          readCounts.set(k, (readCounts.get(k) ?? 0) + 1);
          await new Promise((r) => setTimeout(r, 10));
          const val = files.get(k);
          if (val === undefined) throw new Error("missing");
          return val;
        },
        write: async (file: string, content: string, userId?: string) => {
          files.set(`${userId}:${file}`, content);
        },
      },
    } as unknown as SpindleAPI;

    const backend = registerBackend(fakeSpindle);
    try {
      const [view1, view2] = await Promise.all([
        backend.buildBootstrapView("u1", { includeCatalogs: false }),
        backend.buildBootstrapView("u1", { includeCatalogs: false }),
      ]);

      expect(existsCounts.get("u1:settings.json")).toBe(1);
      expect(readCounts.get("u1:settings.json")).toBe(1);
      expect(existsCounts.get("u1:recovery.json")).toBe(1);
      expect(readCounts.get("u1:recovery.json")).toBe(1);

      expect(view1.settings.toolbarPlacement).toBe("before_native");
      expect(view2.settings.toolbarPlacement).toBe("before_native");
      expect(view1.recovery).toHaveLength(1);
      expect(view2.recovery).toHaveLength(1);

      // Verify callers received independent clones
      view1.settings.toolbarPlacement = "right";
      view1.recovery[0]!.text = "mutated";
      expect(view2.settings.toolbarPlacement).toBe("before_native");
      expect(view2.recovery[0]!.text).toBe("Saved draft");
    } finally {
      backend.dispose();
    }
  });

  test("SettingsStore skips redundant disk writes in pushRecovery on no-op duplicate or blank text", async () => {
    const files = new Map<string, string>();
    let recoveryWrites = 0;

    const fakeSpindle = {
      permissions: { has: () => true },
      log: { warn: () => {} },
      userStorage: {
        exists: async (file: string, userId?: string) => files.has(`${userId}:${file}`),
        read: async (file: string, userId?: string) => files.get(`${userId}:${file}`) ?? "",
        write: async (file: string, content: string, userId?: string) => {
          if (file === "recovery.json") recoveryWrites += 1;
          files.set(`${userId}:${file}`, content);
        },
      },
    } as unknown as SpindleAPI;

    const store = new SettingsStore(fakeSpindle);

    const first = await store.pushRecovery(
      { text: "Keep this draft", actionId: "guided_response", chatId: "c1" },
      "u1",
    );
    expect(first).toHaveLength(1);
    expect(recoveryWrites).toBe(1);

    // Duplicate of top entry -> skips disk write
    const dup = await store.pushRecovery(
      { text: "Keep this draft", actionId: "guided_swipe", chatId: "c2" },
      "u1",
    );
    expect(dup).toHaveLength(1);
    expect(dup[0]!.id).toBe(first[0]!.id);
    expect(recoveryWrites).toBe(1);

    // Blank / whitespace-only -> skips disk write
    const blank = await store.pushRecovery(
      { text: "   \n\t ", actionId: "guided_response", chatId: "c1" },
      "u1",
    );
    expect(blank).toHaveLength(1);
    expect(recoveryWrites).toBe(1);

    // Different text -> writes to disk
    const second = await store.pushRecovery(
      { text: "New draft", actionId: "guided_response", chatId: "c1" },
      "u1",
    );
    expect(second).toHaveLength(2);
    expect(second[0]!.text).toBe("New draft");
    expect(recoveryWrites).toBe(2);
  });

  test("SettingsStore enforces LRU maxCachedUsers eviction and isolates writeQueues per (userId, fileKey)", async () => {
    const files = new Map<string, string>([
      ["u1:settings.json", JSON.stringify({ toolbarPlacement: "before_native" })],
      ["u2:settings.json", JSON.stringify({ toolbarPlacement: "right" })],
      ["u3:settings.json", JSON.stringify({ toolbarPlacement: "below_bar" })],
    ]);
    const readCounts = new Map<string, number>();

    let releaseBlockedSettingsWrite!: () => void;
    const settingsWriteBlocked = new Promise<void>((resolve) => {
      releaseBlockedSettingsWrite = resolve;
    });
    let settingsWriteStarted!: () => void;
    const settingsWriteStartedPromise = new Promise<void>((resolve) => {
      settingsWriteStarted = resolve;
    });
    let blockNextSettingsWrite = false;

    const fakeSpindle = {
      permissions: { has: () => true },
      log: { warn: () => {} },
      userStorage: {
        exists: async (file: string, userId?: string) => files.has(`${userId}:${file}`),
        read: async (file: string, userId?: string) => {
          const k = `${userId}:${file}`;
          readCounts.set(k, (readCounts.get(k) ?? 0) + 1);
          return files.get(k) ?? "";
        },
        write: async (file: string, content: string, userId?: string) => {
          if (file === "settings.json" && blockNextSettingsWrite) {
            blockNextSettingsWrite = false;
            settingsWriteStarted();
            await settingsWriteBlocked;
          }
          files.set(`${userId}:${file}`, content);
        },
      },
    } as unknown as SpindleAPI;

    const store = new SettingsStore(fakeSpindle, { maxCachedUsers: 2 });

    // Load u1, u2; touch u1 to refresh recency; load u3 -> u2 evicted, u1 & u3 kept
    await store.getSettings("u1");
    await store.getSettings("u2");
    await store.getSettings("u1");
    await store.getSettings("u3");

    expect(readCounts.get("u1:settings.json")).toBe(1);
    expect(readCounts.get("u2:settings.json")).toBe(1);
    expect(readCounts.get("u3:settings.json")).toBe(1);

    // u1 and u3 are still cached (no new reads); u2 was evicted (triggers a 2nd read)
    await store.getSettings("u1");
    await store.getSettings("u3");
    expect(readCounts.get("u1:settings.json")).toBe(1);
    expect(readCounts.get("u3:settings.json")).toBe(1);

    await store.getSettings("u2");
    expect(readCounts.get("u2:settings.json")).toBe(2);

    // Verify per-(userId, fileKey) writeQueue isolation:
    // A blocked settings.json write for u1 must NOT block continue-history.json writes for u1
    blockNextSettingsWrite = true;
    const pendingSettingsSave = store.saveSettings({ toolbarPlacement: "after_native" }, "u1");
    await settingsWriteStartedPromise;

    const continueEntry = await store.pushContinueEntry(
      {
        chatId: "chat-1",
        messageId: "m-1",
        swipeIndex: 0,
        baseText: "Hello",
        resultText: "Hello world",
        baseReasoning: null,
        baseReasoningDuration: null,
        inputText: "continue",
      },
      "u1",
    );
    expect(continueEntry.resultText).toBe("Hello world");

    // Unblock settings write and verify it completes cleanly
    releaseBlockedSettingsWrite();
    const saved = await pendingSettingsSave;
    expect(saved.toolbarPlacement).toBe("after_native");
  });

  test("buildGenerationMetricsPayload executes independent token count and preset lookup RPCs in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const createDeferred = <T>() => {
      let resolve!: (val: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    const countFinalDeferred = createDeferred<{ total_tokens: number }>();
    const countDeltaDeferred = createDeferred<{ total_tokens: number }>();
    const presetDeferred = createDeferred<{ id: string; name: string }>();

    const fakeSpindle = {
      permissions: { has: () => true },
      tokens: {
        countText: async (text: string) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            return text === "Combined message text"
              ? await countFinalDeferred.promise
              : await countDeltaDeferred.promise;
          } finally {
            inFlight -= 1;
          }
        },
      },
      presets: {
        get: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            return await presetDeferred.promise;
          } finally {
            inFlight -= 1;
          }
        },
      },
    } as unknown as SpindleAPI;

    const payloadPromise = buildGenerationMetricsPayload({
      spindle: fakeSpindle,
      userId: "u1",
      isContinue: true,
      finalText: "Combined message text",
      rawDeltaText: "message text",
      presetId: "preset-1",
      model: "gpt-4o",
      provider: "openai",
      timingSource: {
        streamingStartedAt: 1000,
        firstTokenAt: 1200,
        firstContentTokenAt: 1250,
        responseStoppedAt: 2250,
        completedAt: 2300,
        wasStreaming: true,
      },
    });

    // Yield a microtask so all parallel RPCs start before resolving any of them
    await Promise.resolve();
    expect(inFlight).toBe(3);
    expect(maxInFlight).toBe(3);

    countFinalDeferred.resolve({ total_tokens: 42 });
    countDeltaDeferred.resolve({ total_tokens: 20 });
    presetDeferred.resolve({ id: "preset-1", name: "Storyteller" });

    const payload = await payloadPromise;
    expect(payload.tokenCount).toBe(42);
    expect(payload.generationMetrics.presetId).toBe("preset-1");
    expect(payload.generationMetrics.presetName).toBe("Storyteller");
    expect(payload.generationMetrics.ttft).toBe(200);
    expect(payload.generationMetrics.tps).toBe(20);
    expect(payload.generationMetrics.durationMs).toBe(1300);
  });

  test("SettingsStore preserves disk-only armed scenes during concurrent saveArmedScene and never resurrects deleted scenes in getArmedScene", async () => {
    const files = new Map<string, string>();
    let releaseList!: () => void;
    let listGate: Promise<void> | null = null;
    let releaseRead!: () => void;
    let readGate: Promise<void> | null = null;
    let gateReadPath: string | null = null;

    const scenePath = (chatId: string) =>
      `active-scenes/${encodeURIComponent(chatId).replaceAll(".", "%2E")}.json`;

    const fakeSpindle = {
      permissions: { has: () => true },
      log: { warn: () => {} },
      userStorage: {
        exists: async (path: string, userId?: string) => files.has(`${userId ?? "__default__"}:${path}`),
        read: async (path: string, userId?: string) => {
          if (gateReadPath === path && readGate) {
            await readGate;
          }
          const val = files.get(`${userId ?? "__default__"}:${path}`);
          if (val === undefined) throw new Error(`missing: ${path}`);
          return val;
        },
        write: async (path: string, content: string, userId?: string) => {
          files.set(`${userId ?? "__default__"}:${path}`, content);
        },
        delete: async (path: string, userId?: string) => {
          files.delete(`${userId ?? "__default__"}:${path}`);
        },
        list: async (prefix = "", userId?: string) => {
          if (listGate) {
            await listGate;
          }
          const userPrefix = `${userId ?? "__default__"}:`;
          const results: string[] = [];
          for (const key of files.keys()) {
            if (key.startsWith(userPrefix)) {
              const rel = key.slice(userPrefix.length);
              if (rel.startsWith(prefix)) results.push(rel);
            }
          }
          return results;
        },
      },
    } as unknown as SpindleAPI;

    // 1. Concurrent saveArmedScene(chatB) while listArmedScenes() is reading chatA from disk
    const seedStore = new SettingsStore(fakeSpindle);
    await seedStore.saveArmedScene(
      {
        chatId: "chatA",
        userId: "u1",
        status: "armed",
        pacing: "next_turn",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Scene A",
        rawGreetingText: "Disk scene A",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 100,
      },
      "u1",
    );

    const store1 = new SettingsStore(fakeSpindle);
    listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const listPromise = store1.listArmedScenes("u1");
    await Promise.resolve();

    await store1.saveArmedScene(
      {
        chatId: "chatB",
        userId: "u1",
        status: "armed",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Scene B",
        rawGreetingText: "New scene B",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 200,
      },
      "u1",
    );
    releaseList();
    listGate = null;

    const listed = await listPromise;
    expect(listed.map((s) => s.chatId)).toEqual(["chatA", "chatB"]);
    expect((await store1.getArmedScene("chatA", "u1"))?.rawGreetingText).toBe("Disk scene A");
    expect((await store1.getArmedScene("chatB", "u1"))?.rawGreetingText).toBe("New scene B");

    // 2. Concurrent deleteArmedScene(chatA) while getArmedScene(chatA) is reading from disk
    const store2 = new SettingsStore(fakeSpindle);
    gateReadPath = scenePath("chatA");
    readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    const getPromise = store2.getArmedScene("chatA", "u1");
    await Promise.resolve();
    await Promise.resolve();

    const delPromise = store2.deleteArmedScene("chatA", "u1");
    releaseRead();
    readGate = null;
    gateReadPath = null;

    const [gotAfterDelete] = await Promise.all([getPromise, delPromise]);
    expect(gotAfterDelete).toBeNull();
    expect(await store2.getArmedScene("chatA", "u1")).toBeNull();
    expect((await store2.listArmedScenes("u1")).map((s) => s.chatId)).toEqual(["chatB"]);
  });
});

