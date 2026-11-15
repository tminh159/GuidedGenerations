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
import { CONTINUE_MENU_ICONS, TOOLBAR_ICONS } from "../src/frontend/icons";
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
    expect(events).toEqual(["delete:m2", "append", "dryRun"]);
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

    // All 5 actions expose Guidance Position select, In-history depth input, applyRegex switch, and macro hint
    const positionSelects = selectHandlers.filter((s) =>
      s.ariaLabel?.endsWith("Guidance Position"),
    );
    expect(positionSelects).toHaveLength(5);
    expect(positionSelects[0]!.options.map((o) => o.value)).toEqual([
      "before_post_history",
      "in_history",
      "pre_history",
      "post_history",
    ]);

    expect(numericHandlers).toHaveLength(6);
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

    // Per-action applyRegex switch defaults to true and saves false when clicked
    const regexSwitch = tabRoot.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Apply Lumiverse regex scripts for Guided Response"]',
    )!;
    expect(regexSwitch.getAttribute("aria-checked")).toBe("true");
    regexSwitch.click();
    expect(regexSwitch.getAttribute("aria-checked")).toBe("false");
    expect(savedSettings[savedSettings.length - 1]!.actions.guided_response.applyRegex).toBe(false);

    // Background swipe switch is no longer rendered anywhere in Settings
    const bgSwitches = tabRoot.querySelectorAll<HTMLButtonElement>(
      'button[role="switch"][aria-label*="background"]',
    );
    expect(bgSwitches).toHaveLength(0);
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
});

