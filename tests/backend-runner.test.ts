import { describe, expect, test } from "bun:test";
import type {
  ChatMessageDTO,
  InterceptorHandler,
  LlmMessageDTO,
  PromptBlockSnapshotDTO,
  RegexScriptDTO,
  SpindleAPI,
  StreamChunkDTO,
} from "lumiverse-spindle-types";
import { registerBackend } from "../src/backend";
import {
  calculateGenerationTimingMetrics,
  resolveGenerationTokenCounts,
} from "../src/backend/generation-metrics";
import { GuidedGenerationRunner } from "../src/backend/generation-runner";
import type { ChatMessageWithRole } from "../src/backend/prompt-builder";
import {
  MAX_CONTINUE_ENTRIES,
  normalizeSettings,
  SettingsStore,
} from "../src/backend/settings-store";
import { createDefaultSettings } from "../src/shared/defaults";
import type {
  ActiveRunState,
  BackendPushEvent,
  ExtensionBootstrapView,
  RemoveContinueResult,
  RpcReplyEnvelope,
} from "../src/shared/types";

function makeMessage(
  overrides: Partial<ChatMessageWithRole> & { id: string; chat_id?: string },
): ChatMessageWithRole {
  const role = overrides.role ?? (overrides.is_user ? "user" : "assistant");
  const is_user = overrides.is_user ?? role === "user";
  const content = overrides.content ?? "";
  return {
    id: overrides.id,
    chat_id: overrides.chat_id ?? "chat-1",
    index_in_chat: overrides.index_in_chat ?? 0,
    is_user,
    role,
    name: overrides.name ?? (is_user ? "User" : "Assistant"),
    content,
    send_date: overrides.send_date ?? 1700000000,
    swipe_id: overrides.swipe_id ?? 0,
    swipes: overrides.swipes ?? [content],
    swipe_dates: overrides.swipe_dates ?? [1700000000],
    extra: overrides.extra ?? {},
    parent_message_id: overrides.parent_message_id ?? null,
    branch_id: overrides.branch_id ?? null,
    created_at: overrides.created_at ?? 1700000000,
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

interface HarnessOptions {
  permissions?: Partial<
    Record<
      | "generation"
      | "chats"
      | "chat_mutation"
      | "characters"
      | "presets"
      | "regex_scripts"
      | "interceptor",
      boolean
    >
  >;
  chats?: Record<string, ChatMessageWithRole[]>;
  chatCharacterIds?: Record<string, string>;
  activeChatByUser?: Record<string, string | null>;
  presets?: Record<
    string,
    {
      id: string;
      name: string;
      parameters?: Record<string, unknown>;
      prompt_order?: PromptBlockSnapshotDTO[];
    }
  >;
  activePresetId?: string | null;
  getActivePresetThrows?: boolean;
  regexScripts?: RegexScriptDTO[];
  macrosResolveImpl?: (
    template: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ text: string; diagnostics: Array<{ message: string; offset: number; length: number }> }>;
  interceptorMessagesByChat?: Record<string, Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>>;
  interceptorContextExtra?: Record<string, unknown>;
  writeError?: (path: string, userId?: string) => Error | null;
  writeDelayMs?: number;
  dryRunImpl?: (
    input: Record<string, unknown>,
    userId?: string,
  ) => Promise<Record<string, unknown>>;
  rawImpl?: (
    input: Record<string, unknown> & { signal?: AbortSignal },
  ) => Promise<Record<string, unknown>>;
  rawStreamImpl?: (
    input: Record<string, unknown> & { signal?: AbortSignal },
  ) => AsyncGenerator<StreamChunkDTO, void, void>;
  countTextImpl?: (
    text: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ total_tokens: number }>;
  connections?: Array<{
    id: string;
    name: string;
    provider: string;
    model: string;
    preset_id?: string | null;
    is_default: boolean;
  }>;
  updateMessageImpl?: (
    chatId: string,
    messageId: string,
    patch: Record<string, unknown>,
    defaultUpdate: () => Promise<void>,
  ) => Promise<void>;
}

function createSpindleHarness(options: HarnessOptions = {}) {
  const perms = {
    generation: true,
    chats: true,
    chat_mutation: true,
    characters: true,
    presets: true,
    regex_scripts: true,
    interceptor: true,
    ...options.permissions,
  };

  const userFiles = new Map<string, Map<string, string>>();
  const chatMessages = new Map<string, ChatMessageWithRole[]>();
  for (const [chatId, msgs] of Object.entries(options.chats ?? { "chat-1": [] })) {
    chatMessages.set(
      chatId,
      msgs.map((m) => ({
        ...m,
        swipes: [...m.swipes],
        swipe_dates: [...m.swipe_dates],
        extra: { ...m.extra },
      })),
    );
  }

  const activeChatByUser: Record<string, string | null> = {
    ...(options.activeChatByUser ?? {}),
  };

  const sentFrontend: Array<{ payload: unknown; userId?: string }> = [];
  const dryRunCalls: Array<{ input: Record<string, unknown>; userId?: string }> = [];
  const rawCalls: Array<Record<string, unknown>> = [];
  const rawStreamCalls: Array<Record<string, unknown>> = [];
  const presetGetCalls: Array<{ id: string; userId?: string }> = [];
  const registerInterceptorCalls: Array<{ options?: unknown; priority?: unknown }> = [];
  const registeredInterceptors: InterceptorHandler[] = [];
  const regexGetActiveCalls: Array<Record<string, unknown>> = [];
  const macroResolveCalls: Array<{ template: string; opts?: Record<string, unknown> }> = [];
  const countTextCalls: Array<{ text: string; opts?: Record<string, unknown> }> = [];
  const updateMessageCalls: Array<{
    chatId: string;
    messageId: string;
    patch: Record<string, unknown>;
  }> = [];
  const eventHandlers = new Map<string, Array<(payload: unknown, userId?: string) => void>>();
  let frontendMessageHandler: ((payload: unknown, userId: string) => void) | null = null;
  let permissionsChangedHandler: (() => void) | null = null;
  let nextMsgSeq = 100;

  const getUserBucket = (userId?: string) => {
    const key = userId ?? "__default__";
    let bucket = userFiles.get(key);
    if (!bucket) {
      bucket = new Map<string, string>();
      userFiles.set(key, bucket);
    }
    return bucket;
  };

  const api = {
    permissions: {
      has: (perm: keyof typeof perms) => Boolean(perms[perm]),
      onChanged: (cb: () => void) => {
        permissionsChangedHandler = cb;
      },
    },
    log: {
      warn: () => {},
      info: () => {},
      error: () => {},
      debug: () => {},
    },
    sendToFrontend: (payload: unknown, userId?: string) => {
      sentFrontend.push({ payload, userId });
    },
    onFrontendMessage: (cb: (payload: unknown, userId: string) => void) => {
      frontendMessageHandler = cb;
    },
    on: (eventName: string, cb: (payload: unknown, userId?: string) => void) => {
      const list = eventHandlers.get(eventName) ?? [];
      list.push(cb);
      eventHandlers.set(eventName, list);
      return () => {
        const current = eventHandlers.get(eventName);
        if (!current) return;
        const idx = current.indexOf(cb);
        if (idx >= 0) current.splice(idx, 1);
      };
    },
    userStorage: {
      exists: async (path: string, userId?: string) => getUserBucket(userId).has(path),
      read: async (path: string, userId?: string) => {
        const val = getUserBucket(userId).get(path);
        if (val === undefined) throw new Error(`File not found: ${path}`);
        return val;
      },
      write: async (path: string, data: string, userId?: string) => {
        if (options.writeDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.writeDelayMs));
        }
        const err = options.writeError?.(path, userId);
        if (err) throw err;
        getUserBucket(userId).set(path, data);
      },
    },
    storage: {
      exists: async () => {
        throw new Error("Operator-scoped global spindle.storage must not be used");
      },
      read: async () => {
        throw new Error("Operator-scoped global spindle.storage must not be used");
      },
      write: async () => {
        throw new Error("Operator-scoped global spindle.storage must not be used");
      },
    },
    connections: {
      list: async () =>
        options.connections ?? [
          {
            id: "conn-1",
            name: "Primary",
            provider: "openai",
            model: "gpt-4o",
            is_default: true,
          },
        ],
    },
    ...(options.countTextImpl
      ? {
          tokens: {
            countText: async (text: string, opts?: Record<string, unknown>) => {
              countTextCalls.push({ text, opts });
              return options.countTextImpl!(text, opts);
            },
          },
        }
      : {}),
    presets: {
      list: async () => ({
        data: Object.values(options.presets ?? { "p-1": { id: "p-1", name: "Default" } }),
        total: Object.keys(options.presets ?? { "p-1": true }).length,
      }),
      get: async (id: string, userId?: string) => {
        presetGetCalls.push({ id, userId });
        return options.presets?.[id] ?? null;
      },
      ...(options.activePresetId !== undefined || options.getActivePresetThrows
        ? {
            getActive: async () => {
              if (options.getActivePresetThrows) {
                throw new Error("getActive unsupported");
              }
              return { preset_id: options.activePresetId ?? null };
            },
          }
        : {}),
      blocks: {
        list: async (id: string) => options.presets?.[id]?.prompt_order ?? [],
      },
    },
    regex_scripts: {
      getActive: async (opts: Record<string, unknown>) => {
        regexGetActiveCalls.push(opts);
        const target = opts.target;
        return (options.regexScripts ?? []).filter((s) => s.target === target);
      },
    },
    macros: {
      resolve: async (template: string, opts?: Record<string, unknown>) => {
        macroResolveCalls.push({ template, opts });
        if (options.macrosResolveImpl) {
          return options.macrosResolveImpl(template, opts);
        }
        return { text: template, diagnostics: [] };
      },
    },
    registerInterceptor: (
      handler: InterceptorHandler,
      priorityOrOpts?: unknown,
      maybeOpts?: unknown,
    ) => {
      registerInterceptorCalls.push({
        priority: typeof priorityOrOpts === "number" ? priorityOrOpts : undefined,
        options: typeof priorityOrOpts === "object" ? priorityOrOpts : maybeOpts,
      });
      registeredInterceptors.push(handler);
      return () => {
        const idx = registeredInterceptors.indexOf(handler);
        if (idx >= 0) registeredInterceptors.splice(idx, 1);
      };
    },
    chats: {
      get: async (chatId: string) => {
        return chatMessages.has(chatId)
          ? {
              id: chatId,
              ...(options.chatCharacterIds?.[chatId]
                ? { character_id: options.chatCharacterIds[chatId] }
                : {}),
            }
          : null;
      },
      getActive: async (userId?: string) => {
        const activeId =
          userId && userId in activeChatByUser
            ? activeChatByUser[userId]
            : activeChatByUser.__default__ ?? "chat-1";
        return activeId && chatMessages.has(activeId)
          ? {
              id: activeId,
              ...(options.chatCharacterIds?.[activeId]
                ? { character_id: options.chatCharacterIds[activeId] }
                : {}),
            }
          : null;
      },
    },
    chat: {
      getMessages: async (chatId: string) => {
        const msgs = chatMessages.get(chatId) ?? [];
        return msgs.map((m) => ({
          ...m,
          swipes: [...m.swipes],
          swipe_dates: [...m.swipe_dates],
          extra: { ...m.extra },
          ...(m.metadata ? { metadata: { ...m.metadata } } : {}),
        }));
      },
      appendMessage: async (
        chatId: string,
        msg: { role: "system" | "user" | "assistant"; content: string; metadata?: Record<string, unknown> },
      ) => {
        const msgs = chatMessages.get(chatId) ?? [];
        const id = `msg-${++nextMsgSeq}`;
        msgs.push(
          makeMessage({
            id,
            chat_id: chatId,
            index_in_chat: msgs.length,
            role: msg.role,
            is_user: msg.role === "user",
            content: msg.content,
            swipes: [msg.content],
            ...(msg.metadata ? { metadata: msg.metadata } : {}),
          }),
        );
        chatMessages.set(chatId, msgs);
        return { id };
      },
      updateMessage: async (
        chatId: string,
        messageId: string,
        patch: {
          content?: string;
          metadata?: Record<string, unknown>;
          swipes?: string[];
          swipe_id?: number;
          swipe_dates?: number[];
          reasoning?: { text?: string | null; duration?: number | null };
          swipe_reasoning?: Array<{ text: string | null; duration?: number | null } | null>;
          skipChunkRebuild?: boolean;
        },
      ) => {
        updateMessageCalls.push({
          chatId,
          messageId,
          patch: { ...(patch as Record<string, unknown>) },
        });
        const defaultUpdate = async () => {
          const msgs = chatMessages.get(chatId) ?? [];
          const target = msgs.find((m) => m.id === messageId);
          if (!target) throw new Error(`Missing message ${messageId}`);
          if (patch.metadata !== undefined) {
            target.metadata = { ...patch.metadata };
          }
          if (patch.swipes) target.swipes = [...patch.swipes];
          if (typeof patch.swipe_id === "number") target.swipe_id = patch.swipe_id;
          if (patch.swipe_dates) target.swipe_dates = [...patch.swipe_dates];
          if (patch.content !== undefined) {
            target.content = patch.content;
            if (target.swipes.length > target.swipe_id) {
              target.swipes[target.swipe_id] = patch.content;
            }
          } else if (patch.swipes || typeof patch.swipe_id === "number") {
            target.content = target.swipes[target.swipe_id] ?? "";
          }
          if (patch.swipe_reasoning !== undefined) {
            if (patch.reasoning !== undefined) {
              throw new Error("Supply reasoning or swipe_reasoning, not both");
            }
            for (const slot of patch.swipe_reasoning) {
              if (
                slot !== null &&
                slot.duration != null &&
                (typeof slot.duration !== "number" ||
                  !Number.isFinite(slot.duration) ||
                  slot.duration < 0)
              ) {
                throw new Error(
                  "Each swipe_reasoning entry must be null or contain text and an optional non-negative duration in milliseconds",
                );
              }
            }
            const reasoningBySwipe = patch.swipe_reasoning.map((slot) => slot?.text ?? null);
            const reasoningDurationBySwipe = patch.swipe_reasoning.map(
              (slot) => slot?.duration ?? null,
            );
            target.extra = {
              ...target.extra,
              reasoningBySwipe,
              reasoningDurationBySwipe,
              reasoning: reasoningBySwipe[target.swipe_id] ?? null,
              reasoning_duration: reasoningDurationBySwipe[target.swipe_id] ?? null,
            };
          } else if (patch.reasoning) {
            if (
              patch.reasoning.duration != null &&
              (typeof patch.reasoning.duration !== "number" ||
                !Number.isFinite(patch.reasoning.duration) ||
                patch.reasoning.duration < 0)
            ) {
              throw new Error("reasoning duration must be a finite non-negative number");
            }
            const nextExtra: Record<string, unknown> = {
              ...target.extra,
              ...(patch.reasoning.text !== undefined ? { reasoning: patch.reasoning.text } : {}),
              ...(patch.reasoning.duration !== undefined
                ? { reasoning_duration: patch.reasoning.duration }
                : {}),
            };
            if (Array.isArray(nextExtra.reasoningBySwipe) && patch.reasoning.text !== undefined) {
              const bySwipe = [...(nextExtra.reasoningBySwipe as Array<string | null>)];
              while (bySwipe.length <= target.swipe_id) bySwipe.push(null);
              bySwipe[target.swipe_id] = patch.reasoning.text;
              nextExtra.reasoningBySwipe = bySwipe;
            }
            if (
              Array.isArray(nextExtra.reasoningDurationBySwipe) &&
              patch.reasoning.duration !== undefined
            ) {
              const durBySwipe = [
                ...(nextExtra.reasoningDurationBySwipe as Array<number | null>),
              ];
              while (durBySwipe.length <= target.swipe_id) durBySwipe.push(null);
              durBySwipe[target.swipe_id] = patch.reasoning.duration;
              nextExtra.reasoningDurationBySwipe = durBySwipe;
            }
            target.extra = nextExtra as ChatMessageWithRole["extra"];
          }
        };

        if (options.updateMessageImpl) {
          await options.updateMessageImpl(chatId, messageId, patch as Record<string, unknown>, defaultUpdate);
        } else {
          await defaultUpdate();
        }
      },
      deleteMessage: async (chatId: string, messageId: string) => {
        const msgs = chatMessages.get(chatId) ?? [];
        chatMessages.set(
          chatId,
          msgs.filter((m) => m.id !== messageId),
        );
      },
    },
    generate: {
      dryRun: async (input: Record<string, unknown>, userId?: string) => {
        dryRunCalls.push({ input, userId });
        const chatId = String(input.chatId ?? "chat-1");
        const interceptorMsgs = options.interceptorMessagesByChat?.[chatId];
        if (interceptorMsgs && registeredInterceptors.length > 0) {
          const ctx = {
            userId: userId ?? "u1",
            chatId,
            generationId: "gen-dry-1",
            generationType: (input.generationType as string) ?? "normal",
            dryRun: true,
            isDryRun: false, // Mirrors Lumiverse host quirk: dryRun=true instead of isDryRun=true
            presetId: (input.presetId as string) ?? null,
            presetMetadata: {},
            personaId: null,
            characterId: options.chatCharacterIds?.[chatId] ?? null,
            personaAddonStates: {},
            mainDispatch: {
              source: "main",
              descriptor: null,
              connectionDispatchRevision: null,
              dispatchKind: null,
            },
            prefillCarrier: { id: "p", state: "absent" },
            interceptorDeadlineAt: Date.now() + 5000,
            boundWorkDeadlineAt: Date.now() + 5000,
            signal: new AbortController().signal,
            ...(options.interceptorContextExtra ?? {}),
          };
          for (const handler of registeredInterceptors) {
            await handler(interceptorMsgs, ctx as unknown as Parameters<InterceptorHandler>[1]);
          }
        }
        if (options.dryRunImpl) {
          return options.dryRunImpl(input, userId);
        }
        return {
          messages: [{ role: "user", content: "Flattened display" }],
          request_messages: [{ role: "user", content: [{ type: "text", text: "Rich prompt" }] }],
          parameters: { temperature: 0.7 },
          model: "gpt-4o",
          provider: "openai",
        };
      },
      raw: async (input: Record<string, unknown> & { signal?: AbortSignal }) => {
        rawCalls.push(input);
        if (options.rawImpl) {
          return options.rawImpl(input);
        }
        return {
          content: "Generated reply.",
          finish_reason: "stop",
        };
      },
      rawStream: async function* (input: Record<string, unknown> & { signal?: AbortSignal }) {
        rawStreamCalls.push(input);
        if (options.rawStreamImpl) {
          yield* options.rawStreamImpl(input);
          return;
        }
        yield { type: "token", token: "Generated " };
        yield { type: "token", token: "reply." };
        yield { type: "done", content: "Generated reply.", finish_reason: "stop" };
      },
    },
  } as unknown as SpindleAPI;

  return {
    api,
    userFiles,
    chatMessages,
    sentFrontend,
    dryRunCalls,
    rawCalls,
    rawStreamCalls,
    presetGetCalls,
    registerInterceptorCalls,
    registeredInterceptors,
    regexGetActiveCalls,
    macroResolveCalls,
    countTextCalls,
    updateMessageCalls,
    triggerFrontendMessage: (payload: unknown, userId: string) => {
      frontendMessageHandler?.(payload, userId);
    },
    triggerPermissionsChanged: () => {
      permissionsChangedHandler?.();
    },
    triggerEvent: (eventName: string, payload: unknown, userId?: string) => {
      for (const cb of [...(eventHandlers.get(eventName) ?? [])]) {
        cb(payload, userId);
      }
    },
    getEventHandlerCount: (eventName: string) => (eventHandlers.get(eventName) ?? []).length,
  };
}

describe("SettingsStore operator isolation, write queue, and guards", () => {
  test("isolates settings and recovery per userId via userStorage", async () => {
    const harness = createSpindleHarness();
    const store = new SettingsStore(harness.api);

    const defaultsA = createDefaultSettings();
    defaultsA.toolbarPlacement = "before_native";
    defaultsA.inputRecovery.maxEntries = 3;
    await store.saveSettings(defaultsA, "user-a");

    const defaultsB = createDefaultSettings();
    defaultsB.toolbarPlacement = "below_bar";
    await store.saveSettings(defaultsB, "user-b");

    await store.pushRecovery({ text: "Secret A", actionId: "guided_response", chatId: "c-a" }, "user-a");
    await store.pushRecovery({ text: "Secret B", actionId: "guided_swipe", chatId: "c-b" }, "user-b");

    expect((await store.getSettings("user-a")).toolbarPlacement).toBe("before_native");
    expect((await store.getSettings("user-b")).toolbarPlacement).toBe("below_bar");
    expect((await store.getRecovery("user-a")).map((r) => r.text)).toEqual(["Secret A"]);
    expect((await store.getRecovery("user-b")).map((r) => r.text)).toEqual(["Secret B"]);

    await store.clearRecovery("user-a");
    expect(await store.getRecovery("user-a")).toEqual([]);
    expect((await store.getRecovery("user-b")).map((r) => r.text)).toEqual(["Secret B"]);
  });

  test("serializes concurrent pushRecovery writes and only updates cache after write succeeds", async () => {
    let failWrites = false;
    const harness = createSpindleHarness({
      writeDelayMs: 5,
      writeError: () => (failWrites ? new Error("disk full") : null),
    });
    const store = new SettingsStore(harness.api);

    await Promise.all([
      store.pushRecovery({ text: "First", actionId: "guided_response", chatId: "c1" }, "u1"),
      store.pushRecovery({ text: "Second", actionId: "guided_response", chatId: "c1" }, "u1"),
      store.pushRecovery({ text: "Third", actionId: "guided_response", chatId: "c1" }, "u1"),
    ]);

    const saved = await store.getRecovery("u1");
    expect(saved.map((r) => r.text)).toEqual(["Third", "Second", "First"]);

    failWrites = true;
    await expect(
      store.saveSettings({ ...createDefaultSettings(), toolbarPlacement: "right" }, "u1"),
    ).rejects.toThrow("disk full");
    expect((await store.getSettings("u1")).toolbarPlacement).toBe("after_native");

    await expect(
      store.pushRecovery({ text: "Fourth", actionId: "guided_response", chatId: "c1" }, "u1"),
    ).rejects.toThrow("disk full");
    expect((await store.getRecovery("u1")).map((r) => r.text)).toEqual([
      "Third",
      "Second",
      "First",
    ]);
  });

  test("skips saving recovery when inputRecovery.enabled is false and guards NaN maxEntries", async () => {
    const harness = createSpindleHarness();
    const store = new SettingsStore(harness.api);

    const saved = await store.saveSettings(
      {
        inputRecovery: { enabled: false, maxEntries: Number.NaN },
      },
      "u1",
    );
    expect(saved.inputRecovery.enabled).toBe(false);
    expect(saved.inputRecovery.maxEntries).toBe(10);

    const pushed = await store.pushRecovery(
      { text: "Should not persist", actionId: "guided_response", chatId: "c1" },
      "u1",
    );
    expect(pushed).toEqual([]);
    expect(harness.userFiles.get("u1")?.has("recovery.json")).toBe(false);
  });
});

describe("GuidedGenerationRunner actions, safety, and operator isolation", () => {
  test("guided_response defers blank slot creation until after dryRun, sets preset_contexts once, and keeps space on 0-token error/abort", async () => {
    let streamMode: "normal" | "pre-token-error" | "pre-token-abort" = "normal";
    let runnerRef: GuidedGenerationRunner;
    let sawBlankBeforeDryRun = false;
    let sawBlankBeforeStream = false;

    const harness = createSpindleHarness({
      activePresetId: "p-active",
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hello" })],
      },
      dryRunImpl: async () => {
        const msgs = harness.chatMessages.get("chat-1")!;
        const last = msgs[msgs.length - 1];
        sawBlankBeforeDryRun = msgs.length >= 2 && last?.role === "assistant" && last?.content === "";
        return {
          messages: [{ role: "user", content: "Flattened display" }],
          request_messages: [
            { role: "user", content: [{ type: "text", text: "Rich prompt" }], sourceMessageId: "m1" },
          ],
          parameters: { temperature: 0.7 },
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* ({ signal }) {
        const msgs = harness.chatMessages.get("chat-1")!;
        const last = msgs[msgs.length - 1];
        sawBlankBeforeStream =
          msgs.length >= 2 &&
          last?.role === "assistant" &&
          last?.content === "" &&
          (last?.metadata?.preset_contexts as Array<{ preset_id?: string }> | undefined)?.[0]
            ?.preset_id === "p-active";
        if (streamMode === "pre-token-error") {
          throw new Error("Upstream 502");
        }
        if (streamMode === "pre-token-abort") {
          runnerRef.abortCurrent("u1");
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
        }
        yield { type: "token", token: "Hi " };
        await new Promise((r) => setTimeout(r, 135));
        yield { type: "token", token: "there!" };
        yield { type: "done", content: "Hi there!", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    runnerRef = new GuidedGenerationRunner(harness.api, store, (ev, uid) =>
      harness.api.sendToFrontend(ev, uid),
    );

    streamMode = "pre-token-error";
    await expect(
      runnerRef.run({ actionId: "guided_response", chatId: "chat-1", inputText: "Be warm" }, "u1"),
    ).rejects.toThrow("Upstream 502");
    expect(sawBlankBeforeDryRun).toBe(false);
    expect(sawBlankBeforeStream).toBe(true);
    // Blank space was created after dryRun and kept on 0-token error.
    expect(harness.chatMessages.get("chat-1")?.length).toBe(2);
    expect(harness.chatMessages.get("chat-1")![1]?.content).toBe("");

    // Reset back to 1 message for abort test.
    harness.chatMessages.get("chat-1")!.splice(1);

    streamMode = "pre-token-abort";
    const abortedRes = await runnerRef.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Be warm" },
      "u1",
    );
    expect(abortedRes.aborted).toBe(true);
    expect(abortedRes.messageId).toBeDefined();
    expect(harness.chatMessages.get("chat-1")?.length).toBe(2);
    expect(harness.chatMessages.get("chat-1")![1]?.content).toBe("");

    // Reset back to 1 message for normal streaming test.
    harness.chatMessages.get("chat-1")!.splice(1);

    streamMode = "normal";
    const okRes = await runnerRef.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Be warm" },
      "u1",
    );
    expect(okRes.aborted).toBe(false);
    expect(okRes.text).toBe("Hi there!");
    expect(harness.chatMessages.get("chat-1")?.length).toBe(2);
    expect(harness.dryRunCalls[0]?.input.includeRequestMessages).toBe(true);
    const sentMessages = harness.rawStreamCalls[2]?.messages as LlmMessageDTO[];
    // Clean prompt without phantom blank assistant message, plus injected guidance.
    expect(sentMessages.some((m) => m.role === "assistant")).toBe(false);
    expect(sentMessages[0]?.content).toEqual([{ type: "text", text: "Rich prompt" }]);

    // Mid-stream flushes omit metadata and pass skipChunkRebuild: true; final flush omits metadata and passes skipChunkRebuild: false.
    expect(harness.updateMessageCalls.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < harness.updateMessageCalls.length - 1; i += 1) {
      const patch = harness.updateMessageCalls[i]!.patch;
      expect("metadata" in patch).toBe(false);
      expect(patch.skipChunkRebuild).toBe(true);
    }
    const finalPatch = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect("metadata" in finalPatch).toBe(false);
    expect(finalPatch.skipChunkRebuild).toBe(false);
    expect(harness.chatMessages.get("chat-1")![1]?.metadata).toEqual({
      preset_contexts: [{ preset_id: "p-active" }],
    });
  });

  test("guided_regenerate snapshots & restores multi-swipe/reasoning assistant on dryRun or 0-token failure and gates presets.get", async () => {
    let failDryRun = true;
    const originalAssistant = makeMessage({
      id: "m2",
      role: "assistant",
      content: "Original swipe 2",
      swipe_id: 1,
      swipes: ["Original swipe 1", "Original swipe 2"],
      swipe_dates: [1700000010, 1700000020],
      extra: { reasoning: "Thought process", reasoning_duration: 1.5 },
    });

    const harness = createSpindleHarness({
      permissions: { presets: false },
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Question" }),
          originalAssistant,
        ],
      },
      dryRunImpl: async () => {
        if (failDryRun) throw new Error("Preset failed");
        return {
          messages: [{ role: "user", content: "Question" }],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        yield* [];
        throw new Error("Stream died before first token");
      },
    });

    const store = new SettingsStore(harness.api);
    const settings = createDefaultSettings();
    settings.actions.guided_regenerate.presetId = "missing-preset";
    await store.saveSettings(settings, "u1");

    const runner = new GuidedGenerationRunner(harness.api, store, () => {});

    // Even with missing-preset configured, presets.get must NOT be called without 'presets' permission.
    await expect(
      runner.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "" }, "u1"),
    ).rejects.toThrow("Preset failed");
    expect(harness.presetGetCalls).toEqual([]);

    const afterDryRunFail = harness.chatMessages.get("chat-1")!;
    expect(afterDryRunFail).toHaveLength(2);
    expect(afterDryRunFail[1]?.content).toBe("Original swipe 2");
    expect(afterDryRunFail[1]?.swipes).toEqual(["Original swipe 1", "Original swipe 2"]);
    expect(afterDryRunFail[1]?.swipe_id).toBe(1);
    expect(afterDryRunFail[1]?.extra.reasoning).toBe("Thought process");

    // Pre-token stream failure also restores the snapshotted assistant message.
    failDryRun = false;
    await expect(
      runner.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "" }, "u1"),
    ).rejects.toThrow("Stream died before first token");
    const afterStreamFail = harness.chatMessages.get("chat-1")!;
    expect(afterStreamFail).toHaveLength(2);
    expect(afterStreamFail[1]?.content).toBe("Original swipe 2");
    expect(afterStreamFail[1]?.swipes).toEqual(["Original swipe 1", "Original swipe 2"]);
  });

  test("guided_swipe defers slot creation until after dryRun, strips rejected turn from prompt, and keeps slot on 0-token failure", async () => {
    let emitTokens = false;
    let sawEagerSlotBeforeDryRun = false;
    let sawSlotBeforeStream = false;
    let targetContentAtDryRun = "";
    const harness = createSpindleHarness({
      activePresetId: "p-swipe",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Knock knock" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Rejected old swipe",
            swipes: ["Rejected old swipe"],
            swipe_id: 0,
          }),
        ],
      },
      dryRunImpl: async () => {
        const target = harness.chatMessages.get("chat-1")![1]!;
        targetContentAtDryRun = target.content;
        sawEagerSlotBeforeDryRun =
          target.swipes.length === 2 &&
          target.swipes[1] === "" &&
          target.swipe_id === 1 &&
          target.content === "";
        return {
          messages: [
            { role: "user", content: "Knock knock" },
            { role: "assistant", content: target.content },
          ],
          request_messages: [
            { role: "user", content: "Knock knock", sourceMessageId: "m1" },
            { role: "assistant", content: target.content, sourceMessageId: "m2" },
          ],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        const target = harness.chatMessages.get("chat-1")![1]!;
        sawSlotBeforeStream =
          target.swipes.length >= 2 &&
          target.swipes[target.swipe_id] === "" &&
          target.content === "";
        if (!emitTokens) {
          throw new Error("0-token failure");
        }
        yield { type: "token", token: "Who's there?" };
        yield { type: "done", content: "Who's there?", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});

    // 0-token failure keeps the post-dryRun created swipe slot & swipe_id.
    await expect(
      runner.run({ actionId: "guided_swipe", chatId: "chat-1", inputText: "Be mysterious" }, "u1"),
    ).rejects.toThrow("0-token failure");
    expect(sawEagerSlotBeforeDryRun).toBe(false);
    expect(targetContentAtDryRun).toBe("Rejected old swipe");
    expect(sawSlotBeforeStream).toBe(true);
    const afterFailure = harness.chatMessages.get("chat-1")![1]!;
    expect(afterFailure.swipes).toEqual(["Rejected old swipe", ""]);
    expect(afterFailure.swipe_id).toBe(1);
    expect(afterFailure.metadata).toEqual({
      preset_contexts: [null, { preset_id: "p-swipe" }],
    });

    // Rejected assistant message was stripped from rawStream input.
    const failedPrompt = harness.rawStreamCalls[0]?.messages as LlmMessageDTO[];
    expect(failedPrompt.some((m) => m.role === "assistant")).toBe(false);
    expect(failedPrompt.map((m) => m.role)).toEqual(["user", "system"]);

    // Successful swipe appends next slot after dryRun and streams into it without duplicate slots.
    emitTokens = true;
    const res = await runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Be mysterious" },
      "u1",
    );
    expect(res.swipeId).toBe(2);
    expect(res.text).toBe("Who's there?");
    const updated = harness.chatMessages.get("chat-1")![1]!;
    expect(updated.swipes).toEqual(["Rejected old swipe", "", "Who's there?"]);
    expect(updated.swipe_id).toBe(2);
  });

  test("guided_continue skips trailing system messages, handles Continue Nudge, and preserves concurrent sibling swipe edits", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Go on" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "She opened the door",
            swipes: ["She opened the door"],
            swipe_id: 0,
          }),
          makeMessage({
            id: "m3",
            role: "system",
            is_user: false,
            content: "Author note",
          }),
        ],
      },
      dryRunImpl: async () => ({
        messages: [],
        request_messages: [
          { role: "user", content: "Go on" },
          { role: "assistant", content: "She opened the door" },
          { role: "system", content: "[Continue Nudge]" },
        ],
        parameters: {},
        model: "gpt-4o",
        provider: "openai",
      }),
      rawStreamImpl: async function* () {
        yield { type: "token", token: "and gasped." };
        await new Promise((resolve) => setTimeout(resolve, 5));
        // Simulate a concurrent edit adding a sibling swipe while streaming.
        harness.chatMessages.get("chat-1")![1]!.swipes.push("Alternate sibling swipe");
        harness.chatMessages.get("chat-1")![1]!.swipe_dates.push(1700000099);
        yield { type: "done", content: "and gasped.", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    const res = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Add suspense" },
      "u1",
    );

    expect(res.messageId).toBe("m2");
    expect(res.text).toBe("She opened the door and gasped.");

    const sent = harness.rawStreamCalls[0]?.messages as LlmMessageDTO[];
    expect(sent.map((m) => m.role)).toEqual(["user", "system", "assistant", "system"]);
    expect(sent[2]?.content).toBe("She opened the door");

    const continuedMsg = harness.chatMessages.get("chat-1")![1]!;
    expect(continuedMsg.swipes).toEqual([
      "She opened the door and gasped.",
      "Alternate sibling swipe",
    ]);
  });

  test("guided_impersonate works without chat_mutation and includes chatId on gg:impersonate-chunk", async () => {
    const events: Array<{ event: BackendPushEvent; userId?: string }> = [];
    const harness = createSpindleHarness({
      permissions: { chat_mutation: false },
      chats: { "chat-9": [makeMessage({ id: "m1", role: "assistant", content: "Hello!" })] },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "I wave back." };
        yield { type: "done", content: "I wave back.", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, (event, userId) => {
      events.push({ event, userId });
    });

    const res = await runner.run(
      { actionId: "guided_impersonate", chatId: "chat-9", inputText: "Friendly wave" },
      "u1",
    );
    expect(res.text).toBe("I wave back.");
    const chunks = events.filter((e) => e.event.type === "gg:impersonate-chunk");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.event.chatId).toBe("chat-9");
    }
    expect(chunks[chunks.length - 1]?.event.done).toBe(true);
  });

  test("isolates active runs and aborts per userId, and survives transient updateMessage failure + flushes partial error output", async () => {
    let releaseUserA!: () => void;
    const userAGate = new Promise<void>((resolve) => {
      releaseUserA = resolve;
    });
    let updateAttempt = 0;

    const harness = createSpindleHarness({
      chats: {
        "chat-a": [makeMessage({ id: "ma1", role: "user", content: "A" })],
        "chat-b": [makeMessage({ id: "mb1", role: "user", content: "B" })],
      },
      updateMessageImpl: async (_chatId, _msgId, _patch, defaultUpdate) => {
        updateAttempt += 1;
        if (updateAttempt === 1) {
          throw new Error("Transient DB busy");
        }
        await defaultUpdate();
      },
      rawStreamImpl: async function* ({ userId, signal }: { userId?: string; signal?: AbortSignal }) {
        if (userId === "user-a") {
          yield { type: "token", token: "Part1 " };
          await userAGate;
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          yield { type: "token", token: "Part2" };
          yield { type: "done", content: "Part1 Part2", finish_reason: "stop" };
          return;
        }
        yield { type: "token", token: "Partial B" };
        throw new Error("Midstream failure B");
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});

    const runAPromise = runner.run(
      { actionId: "guided_response", chatId: "chat-a", inputText: "Go A" },
      "user-a",
    );
    await new Promise((r) => setTimeout(r, 15));

    const activeA = runner.getActiveRun("user-a");
    expect(activeA?.chatId).toBe("chat-a");
    expect(runner.getActiveRun("user-b")).toBeNull();

    // User B cannot abort User A's run, even with User A's runId.
    expect(runner.abortCurrent("user-b", activeA?.runId)).toBe(false);
    expect(runner.abortCurrent("user-b")).toBe(false);

    // User B can run concurrently without being blocked by User A, and partial tokens flush on midstream error.
    await expect(
      runner.run({ actionId: "guided_response", chatId: "chat-b", inputText: "Go B" }, "user-b"),
    ).rejects.toThrow("Midstream failure B");
    const chatBMessages = harness.chatMessages.get("chat-b")!;
    expect(chatBMessages).toHaveLength(2);
    expect(chatBMessages[1]?.content).toBe("Partial B");

    // User A completes and recovers after transient updateMessage rejection on first flush.
    releaseUserA();
    const resA = await runAPromise;
    expect(resA.text).toBe("Part1 Part2");
    expect(harness.chatMessages.get("chat-a")![1]?.content).toBe("Part1 Part2");
  });

  test("throws when explicit requestedChatId is missing instead of falling back to active chat", async () => {
    const harness = createSpindleHarness();
    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});

    await expect(
      runner.run(
        { actionId: "guided_response", chatId: "deleted-chat", inputText: "Hello" },
        "u1",
      ),
    ).rejects.toThrow("The requested chat is no longer available.");
  });
});

describe("backend handleRpc orchestration", () => {
  test("handles bootstrap, settings, recovery restore/clear, action run/abort, and events scoped by userId", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hi" })],
      },
    });
    const { handleRpc } = registerBackend(harness.api);

    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-1",
        action: "push_recovery",
        input: { text: "Draft 1", actionId: "guided_response", chatId: "chat-1" },
      },
      "user-1",
    );
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-2",
        action: "push_recovery",
        input: { text: "Draft 2", actionId: "guided_swipe", chatId: "chat-1" },
      },
      "user-1",
    );

    await handleRpc({ type: "gg:rpc", requestId: "req-3", action: "get_bootstrap" }, "user-1");
    const bootstrapReply = harness.sentFrontend.find(
      (m) => (m.payload as RpcReplyEnvelope).requestId === "req-3",
    )?.payload as RpcReplyEnvelope;
    const bootstrapResult = bootstrapReply.result as {
      recovery: Array<{ id: string; text: string }>;
      activeRun: unknown;
    };
    expect(bootstrapResult.recovery.map((r) => r.text)).toEqual(["Draft 2", "Draft 1"]);
    expect(bootstrapResult.activeRun).toBeNull();

    // restore_recovery returns null when targetId is missing instead of falling back to recovery[0].
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-4",
        action: "restore_recovery",
        input: { id: "non-existent-id" },
      },
      "user-1",
    );
    const missingRestore = harness.sentFrontend.find(
      (m) => (m.payload as RpcReplyEnvelope).requestId === "req-4",
    )?.payload as RpcReplyEnvelope;
    expect(missingRestore.result).toBeNull();

    // restore_recovery finds matching id and defaults to latest when id is omitted.
    const secondId = bootstrapResult.recovery[1]!.id;
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-5",
        action: "restore_recovery",
        input: { id: secondId },
      },
      "user-1",
    );
    const foundRestore = harness.sentFrontend.find(
      (m) => (m.payload as RpcReplyEnvelope).requestId === "req-5",
    )?.payload as RpcReplyEnvelope;
    expect((foundRestore.result as { text: string }).text).toBe("Draft 1");

    // Disabled inputRecovery skips push_recovery.
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-6",
        action: "save_settings",
        input: { inputRecovery: { enabled: false } },
      },
      "user-1",
    );
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-7",
        action: "push_recovery",
        input: { text: "Should ignore", actionId: "guided_response", chatId: "chat-1" },
      },
      "user-1",
    );
    const ignoredPush = harness.sentFrontend.find(
      (m) => (m.payload as RpcReplyEnvelope).requestId === "req-7",
    )?.payload as RpcReplyEnvelope;
    expect((ignoredPush.result as Array<{ text: string }>).map((r) => r.text)).toEqual([
      "Draft 2",
      "Draft 1",
    ]);

    // Events forward gg:changed cleanly.
    harness.triggerEvent("CHAT_SWITCHED", {}, "user-1");
    harness.triggerPermissionsChanged();
    const changedReasons = harness.sentFrontend
      .filter((m) => (m.payload as BackendPushEvent).type === "gg:changed")
      .map((m) => (m.payload as BackendPushEvent).reason);
    expect(changedReasons).toEqual(["chat_switched", "permissions"]);
  });

  test("bootstrap exposes regex_scripts/interceptor permissions and normalizeSettings defaults legacy action configs", () => {
    const harness = createSpindleHarness({
      permissions: { regex_scripts: true, interceptor: false },
    });
    const { buildBootstrapView } = registerBackend(harness.api);

    const legacy = normalizeSettings({
      actions: {
        guided_response: {
          enabled: true,
          injectionRole: "user",
          instructionTemplate: "Legacy {{input}}",
        },
        guided_swipe: {
          guidancePosition: "invalid_pos",
          guidanceDepth: 2500,
          applyRegex: false,
        },
        guided_continue: {
          guidancePosition: "in_history",
          guidanceDepth: -4,
        },
      },
    });

    expect(legacy.actions.guided_response.guidancePosition).toBe("before_post_history");
    expect(legacy.actions.guided_response.guidanceDepth).toBe(0);
    expect(legacy.actions.guided_response.applyRegex).toBe(true);
    expect(legacy.actions.guided_swipe.guidancePosition).toBe("before_post_history");
    expect(legacy.actions.guided_swipe.guidanceDepth).toBe(999);
    expect(legacy.actions.guided_swipe.applyRegex).toBe(false);
    expect(legacy.actions.guided_continue.guidancePosition).toBe("in_history");
    expect(legacy.actions.guided_continue.guidanceDepth).toBe(0);

    return buildBootstrapView("u1").then((view: ExtensionBootstrapView) => {
      expect(view.permissions).toEqual({
        generation: true,
        chats: true,
        chat_mutation: true,
        characters: true,
        presets: true,
        regex_scripts: true,
        interceptor: false,
      });
    });
  });

  test("captures dry-run interceptor messages with dryRun=true quirk, places guidance by preset position, and strips swipe by captured sourceMessageId", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Rejected old swipe",
            swipes: ["Rejected old swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main Prompt", __isChatHistory: false },
          {
            role: "user",
            content: "Hello",
            __isChatHistory: true,
            sourceMessageId: "m1",
            sourceIndexInChat: 0,
          },
          {
            role: "assistant",
            content: "Rejected old swipe",
            __isChatHistory: true,
            sourceMessageId: "m2",
            sourceIndexInChat: 1,
          },
          { role: "system", content: "Post-History Rules", __isChatHistory: false },
        ],
      },
      dryRunImpl: async () => ({
        messages: [
          { role: "system", content: "Main Prompt" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Rejected old swipe" },
          { role: "system", content: "Post-History Rules" },
        ],
        // Deliberately omit sourceMessageId & __isChatHistory from request_messages
        // so the runner must rely on the dry-run interceptor capture.
        request_messages: [
          { role: "system", content: "Main Prompt" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Rejected old swipe" },
          { role: "system", content: "Post-History Rules" },
        ],
        parameters: {},
        model: "gpt-4o",
        provider: "openai",
      }),
    });

    const store = new SettingsStore(harness.api);
    const settings = createDefaultSettings();
    settings.actions.guided_swipe.guidancePosition = "before_post_history";
    settings.actions.guided_response.guidancePosition = "pre_history";
    await store.saveSettings(settings, "u1");

    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    await runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Try again" },
      "u1",
    );

    // Must NOT register with match: { isDryRun: true } (which fails on Lumiverse's dryRun: true quirk)
    expect(harness.registerInterceptorCalls.length).toBe(1);
    expect(harness.registerInterceptorCalls[0]?.options).toBeUndefined();

    // Rejected m2 stripped via captured sourceMessageId; guidance injected before Post-History Rules
    const swipeMessages = harness.rawStreamCalls[0]?.messages as LlmMessageDTO[];
    expect(swipeMessages.map((m) => m.content)).toEqual([
      "Main Prompt",
      "Hello",
      "[OOC Guidance for this alternative response: Try again]",
      "Post-History Rules",
    ]);
    // Internal __isChatHistory flag is stripped before sending to rawStream
    expect(swipeMessages.every((m) => m.__isChatHistory === undefined)).toBe(true);

    // Non-dry-run interceptor calls must pass through untouched and not clobber captures
    const liveResult = await harness.registeredInterceptors[0]!(
      [{ role: "user", content: "Live call" }],
      { chatId: "chat-1", isDryRun: false, dryRun: false } as unknown as Parameters<
        InterceptorHandler
      >[1],
    );
    expect(liveResult).toEqual([{ role: "user", content: "Live call" }]);

    // pre_history places guidance right before first chat_history turn
    await runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Set tone" },
      "u1",
    );
    const responseMessages = harness.rawStreamCalls[1]?.messages as LlmMessageDTO[];
    expect(responseMessages.map((m) => m.content)).toEqual([
      "Main Prompt",
      "[OOC Guidance for the next response: Set tone]",
      "Hello",
      "Rejected old swipe",
      "Post-History Rules",
    ]);
  });

  test("resolves macros in instructionTemplate before substituting {{input}} and applies prompt/response regex when applyRegex is enabled", async () => {
    const promptScript: RegexScriptDTO = {
      id: "pr-1",
      can_mutate: false,
      name: "Prompt rule",
      script_id: "pr-1",
      find_regex: "\\bshout\\b",
      replace_string: "WHISPER",
      flags: "gi",
      placement: ["user_input"],
      scope: "global",
      scope_id: null,
      target: "prompt",
      min_depth: 1,
      max_depth: 3,
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: "none",
      disabled: false,
      sort_order: 0,
      description: "",
      folder: "",
      metadata: {},
      created_at: 1,
      updated_at: 1,
    };

    const responseScript: RegexScriptDTO = {
      ...promptScript,
      id: "rr-1",
      name: "Response rule",
      find_regex: "rawtoken",
      replace_string: "clean {{char}}",
      placement: ["ai_output"],
      target: "response",
      min_depth: null,
      max_depth: null,
      substitute_macros: "raw",
    };

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hi" })],
      },
      chatCharacterIds: { "chat-1": "char-alice" },
      regexScripts: [promptScript, responseScript],
      macrosResolveImpl: async (template) => ({
        // Simulate host macro engine stripping unknown {{input}} if unprotected
        text: template
          .replaceAll("{{char}}", "Alice")
          .replaceAll("{{input}}", ""),
        diagnostics: [],
      }),
      rawStreamImpl: async function* () {
        yield { type: "token", token: '<font color="#ff0000>rawtoken * softly *' };
        yield { type: "done", content: '<font color="#ff0000>rawtoken * softly *', finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const settings = createDefaultSettings();
    settings.actions.guided_response.injectionRole = "user";
    settings.actions.guided_response.guidancePosition = "in_history";
    settings.actions.guided_response.guidanceDepth = 2;
    settings.actions.guided_response.instructionTemplate = "[For {{char}}: {{input}}]";
    settings.actions.guided_response.applyRegex = true;
    await store.saveSettings(settings, "u1");

    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    const res = await runner.run(
      // {{char}} inside user input must remain literal if macros resolved before {{input}}
      { actionId: "guided_response", chatId: "chat-1", inputText: "please shout {{char}}" },
      "u1",
    );

    // instructionTemplate resolved with commit: false and characterId
    expect(harness.macroResolveCalls[0]?.opts).toEqual({
      chatId: "chat-1",
      characterId: "char-alice",
      userId: "u1",
      commit: false,
    });

    const sent = harness.rawStreamCalls[0]?.messages as LlmMessageDTO[];
    // guidanceDepth=2 on a 1-message prompt clamps to index 0 (before "Rich prompt")
    expect(sent[0]?.content).toBe("[For Alice: please WHISPER {{char}}]");
    expect(res.text).toBe('<font color="#ff0000">clean Alice *softly*</font>');
    expect(harness.chatMessages.get("chat-1")![1]?.content).toBe(
      '<font color="#ff0000">clean Alice *softly*</font>',
    );

    // When applyRegex is false, prompt and response regex scripts are skipped
    settings.actions.guided_response.applyRegex = false;
    await store.saveSettings(settings, "u1");
    const skippedRes = await runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "please shout" },
      "u1",
    );
    const sentSkipped = harness.rawStreamCalls[1]?.messages as LlmMessageDTO[];
    expect(sentSkipped[0]?.content).toBe("[For Alice: please shout]");
    expect(skippedRes.text).toBe('<font color="#ff0000>rawtoken * softly *');
  });

  test("applies response regex on guided_continue before stitching, on abort-with-partial-text, and on guided_impersonate final chunk", async () => {
    const events: BackendPushEvent[] = [];
    let runnerRef: GuidedGenerationRunner;
    let mode: "continue" | "abort_partial" | "impersonate" = "continue";

    const responseScript: RegexScriptDTO = {
      id: "rr-2",
      can_mutate: false,
      name: "Clean tag",
      script_id: "rr-2",
      find_regex: "\\[DROP\\]",
      replace_string: "",
      flags: "g",
      placement: ["ai_output"],
      scope: "global",
      scope_id: null,
      target: "response",
      min_depth: null,
      max_depth: null,
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: "none",
      disabled: false,
      sort_order: 0,
      description: "",
      folder: "",
      metadata: {},
      created_at: 1,
      updated_at: 1,
    };

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Go" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            // Existing text has [DROP] which must NOT be touched during guided_continue!
            content: "[DROP] Base",
            swipes: ["[DROP] Base"],
            swipe_id: 0,
          }),
        ],
      },
      regexScripts: [responseScript],
      rawStreamImpl: async function* () {
        if (mode === "continue") {
          yield { type: "token", token: "and [DROP]continued * nicely *" };
          yield { type: "done", content: "and [DROP]continued * nicely *", finish_reason: "stop" };
          return;
        }
        if (mode === "abort_partial") {
          yield { type: "token", token: 'partial [DROP] " text "' };
          runnerRef.abortCurrent("u1");
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        yield { type: "token", token: "I [DROP]smile * warmly *" };
        yield { type: "done", content: "I [DROP]smile * warmly *", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    runnerRef = new GuidedGenerationRunner(harness.api, store, (ev) => events.push(ev));

    mode = "continue";
    const contRes = await runnerRef.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(contRes.text).toBe("[DROP] Base and continued *nicely*");

    mode = "abort_partial";
    const abortRes = await runnerRef.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );
    expect(abortRes.aborted).toBe(true);
    expect(abortRes.text).toBe('partial  "text"');
    const persistedAbortMsg = harness.chatMessages.get("chat-1")![2]!;
    expect(persistedAbortMsg.content).toBe('partial  "text"');

    mode = "impersonate";
    const impRes = await runnerRef.run(
      { actionId: "guided_impersonate", chatId: "chat-1", inputText: "Wave" },
      "u1",
    );
    expect(impRes.text).toBe("I smile *warmly*");
    const impDone = events.filter(
      (e) => e.type === "gg:impersonate-chunk" && e.done === true,
    );
    expect(impDone[impDone.length - 1]?.text).toBe("I smile *warmly*");
  });

  test("guided_swipe stops mid-stream flushes on MESSAGE_SWIPED back to old swipe and commits cleanly on completion, abort, and error", async () => {
    const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const makeBaseChat = () => [
      makeMessage({ id: "m1", role: "user", content: "Tell me a story" }),
      makeMessage({
        id: "m2",
        role: "assistant",
        content: "Old swipe",
        swipes: ["Old swipe"],
        swipe_id: 0,
        extra: {
          reasoningBySwipe: ["Old reasoning"],
          reasoningDurationBySwipe: [500],
          reasoning: "Old reasoning",
          reasoning_duration: 500,
        },
      }),
    ];

    // 1. Completion after swiping back mid-stream
    let gate1Resolve!: () => void;
    const gate1 = new Promise<void>((r) => {
      gate1Resolve = r;
    });

    const harness = createSpindleHarness({
      chats: { "chat-1": makeBaseChat() },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Part 1" };
        await gate1;
        yield { type: "reasoning", token: "New thought" };
        yield { type: "token", token: " Part 2" };
        await waitMs(135);
        yield { type: "token", token: " Part 3" };
        yield { type: "done", content: "Part 1 Part 2 Part 3", reasoning: "New thought", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runnerRef = new GuidedGenerationRunner(harness.api, store, () => {});

    const runPromise = runnerRef.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Twist" },
      "u1",
    );
    while (harness.updateMessageCalls.length < 2) {
      await waitMs(5);
    }
    expect(harness.getEventHandlerCount("MESSAGE_SWIPED")).toBe(1);
    // Initial slot + mid-stream flush both had skipChunkRebuild: true.
    expect(harness.updateMessageCalls[0]!.patch.skipChunkRebuild).toBe(true);
    expect(harness.updateMessageCalls[1]!.patch.skipChunkRebuild).toBe(true);

    // User clicks < back to old swipe 0
    const targetMsg = harness.chatMessages.get("chat-1")![1]!;
    targetMsg.swipe_id = 0;
    targetMsg.content = "Old swipe";
    targetMsg.extra.reasoning = "Old reasoning";
    harness.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      message: { ...targetMsg, swipes: [...targetMsg.swipes], extra: { ...targetMsg.extra } },
      action: "navigated",
      swipeId: 0,
      previousSwipeId: 1,
    });
    const callsAtSwipeBack = harness.updateMessageCalls.length;

    gate1Resolve();
    const res = await runPromise;

    expect(res.aborted).toBe(false);
    expect(res.text).toBe("Part 1 Part 2 Part 3");
    expect(harness.getEventHandlerCount("MESSAGE_SWIPED")).toBe(0);
    // Only ONE final background commit patch after swiping back (zero mid-stream flicker!)
    expect(harness.updateMessageCalls.length).toBe(callsAtSwipeBack + 1);
    const finalPatch = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect("content" in finalPatch).toBe(false);
    expect("swipe_id" in finalPatch).toBe(false);
    expect("reasoning" in finalPatch).toBe(false);
    expect(finalPatch.skipChunkRebuild).toBe(true);
    expect(finalPatch.swipe_reasoning).toEqual([
      { text: "Old reasoning", duration: 500 },
      { text: "New thought" },
    ]);

    expect(targetMsg.swipe_id).toBe(0);
    expect(targetMsg.content).toBe("Old swipe");
    expect(targetMsg.swipes).toEqual(["Old swipe", "Part 1 Part 2 Part 3"]);
    expect(targetMsg.extra.reasoning).toBe("Old reasoning");
    expect(targetMsg.extra.reasoningBySwipe).toEqual(["Old reasoning", "New thought"]);

    // 2. Abort-with-output while viewing old swipe
    let abortGateResolve!: () => void;
    const abortGate = new Promise<void>((r) => {
      abortGateResolve = r;
    });
    const abortHarness = createSpindleHarness({
      chats: { "chat-1": makeBaseChat() },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Abort start" };
        await abortGate;
        yield { type: "token", token: " partial" };
        abortRunner.abortCurrent("u1");
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
    });
    const abortStore = new SettingsStore(abortHarness.api);
    const abortRunner = new GuidedGenerationRunner(abortHarness.api, abortStore, () => {});
    const abortPromise = abortRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Twist" },
      "u1",
    );
    while (abortHarness.updateMessageCalls.length < 2) {
      await waitMs(5);
    }
    const abortMsg = abortHarness.chatMessages.get("chat-1")![1]!;
    abortMsg.swipe_id = 0;
    abortMsg.content = "Old swipe";
    abortHarness.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      message: { ...abortMsg, swipes: [...abortMsg.swipes], extra: { ...abortMsg.extra } },
      action: "navigated",
      swipeId: 0,
      previousSwipeId: 1,
    });
    abortGateResolve();
    const abortRes = await abortPromise;
    expect(abortRes.aborted).toBe(true);
    expect(abortRes.text).toBe("Abort start partial");
    expect(abortMsg.swipe_id).toBe(0);
    expect(abortMsg.content).toBe("Old swipe");
    expect(abortMsg.swipes).toEqual(["Old swipe", "Abort start partial"]);
    expect(abortHarness.getEventHandlerCount("MESSAGE_SWIPED")).toBe(0);

    // 3. Error-with-output while viewing old swipe
    let errGateResolve!: () => void;
    const errGate = new Promise<void>((r) => {
      errGateResolve = r;
    });
    const errHarness = createSpindleHarness({
      chats: { "chat-1": makeBaseChat() },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Err start" };
        await errGate;
        yield { type: "token", token: " partial" };
        throw new Error("Midstream drop");
      },
    });
    const errStore = new SettingsStore(errHarness.api);
    const errRunner = new GuidedGenerationRunner(errHarness.api, errStore, () => {});
    const errPromise = errRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Twist" },
      "u1",
    );
    while (errHarness.updateMessageCalls.length < 2) {
      await waitMs(5);
    }
    const errMsg = errHarness.chatMessages.get("chat-1")![1]!;
    errMsg.swipe_id = 0;
    errMsg.content = "Old swipe";
    errHarness.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      message: { ...errMsg, swipes: [...errMsg.swipes], extra: { ...errMsg.extra } },
      action: "navigated",
      swipeId: 0,
      previousSwipeId: 1,
    });
    errGateResolve();
    await expect(errPromise).rejects.toThrow("Midstream drop");
    expect(errMsg.swipe_id).toBe(0);
    expect(errMsg.content).toBe("Old swipe");
    expect(errMsg.swipes).toEqual(["Old swipe", "Err start partial"]);
    expect(errHarness.getEventHandlerCount("MESSAGE_SWIPED")).toBe(0);
  });

  test("guided_swipe keeps swipe_id on old swipe if user navigates away before token 1 (TTFT)", async () => {
    const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let ttftResolve!: () => void;
    const ttftGate = new Promise<void>((r) => {
      ttftResolve = r;
    });

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Swipe 1",
            swipes: ["Swipe 0", "Swipe 1"],
            swipe_id: 1,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        await ttftGate;
        yield { type: "token", token: "Hello" };
        await waitMs(135);
        yield { type: "token", token: " world" };
        yield { type: "done", content: "Hello world", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    const runPromise = runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );

    // Wait until rawStream has been entered (TTFT phase before token 1); eager active slot already created
    while (harness.rawStreamCalls.length < 1) {
      await waitMs(5);
    }

    const msg = harness.chatMessages.get("chat-1")![1]!;
    expect(msg.swipe_id).toBe(2);
    msg.swipe_id = 0;
    msg.content = "Swipe 0";
    harness.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      message: { ...msg, swipes: [...msg.swipes] },
      action: "navigated",
      swipeId: 0,
      previousSwipeId: 2,
    });

    ttftResolve();
    const res = await runPromise;

    expect(res.swipeId).toBe(2);
    expect(res.text).toBe("Hello world");
    expect(msg.swipe_id).toBe(0);
    expect(msg.content).toBe("Swipe 0");
    expect(msg.swipes).toEqual(["Swipe 0", "Swipe 1", "Hello world"]);

    // Exactly 2 updateMessage calls: 1 eager slot creation ("") + 1 background completion commit
    expect(harness.updateMessageCalls).toHaveLength(2);
    expect(harness.updateMessageCalls[0]!.patch.swipe_id).toBe(2);
    expect(harness.updateMessageCalls[0]!.patch.content).toBe("");
    expect(harness.updateMessageCalls[0]!.patch.skipChunkRebuild).toBe(true);
    expect(harness.updateMessageCalls[0]!.patch.swipes).toEqual(["Swipe 0", "Swipe 1", ""]);

    expect("content" in harness.updateMessageCalls[1]!.patch).toBe(false);
    expect("swipe_id" in harness.updateMessageCalls[1]!.patch).toBe(false);
    expect(harness.updateMessageCalls[1]!.patch.skipChunkRebuild).toBe(true);
    expect(harness.updateMessageCalls[1]!.patch.swipes).toEqual([
      "Swipe 0",
      "Swipe 1",
      "Hello world",
    ]);
  });

  test("guided_swipe resumes live streaming flushes when user navigates forward onto newSwipeIndex mid-stream", async () => {
    const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let midGateResolve!: () => void;
    const midGate = new Promise<void>((r) => {
      midGateResolve = r;
    });

    const harness = createSpindleHarness({
      activePresetId: "p-swipe",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Old swipe",
            swipes: ["Old swipe"],
            swipe_id: 0,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Start" };
        yield { type: "token", token: " middle" };
        await midGate;
        await waitMs(135);
        yield { type: "token", token: " end" };
        yield { type: "done", content: "Start middle end", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    const runPromise = runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Steer", backgroundSwipe: true },
      "u1",
    );

    // Wait for eager background slot registration and buffered tokens in rawStream
    while (harness.rawStreamCalls.length < 1) {
      await waitMs(5);
    }
    await waitMs(15);
    expect(harness.updateMessageCalls).toHaveLength(1);
    const msg = harness.chatMessages.get("chat-1")![1]!;
    expect(msg.swipe_id).toBe(0);
    expect(msg.swipes).toEqual(["Old swipe", ""]);
    expect(msg.metadata).toEqual({
      preset_contexts: [null, { preset_id: "p-swipe" }],
    });

    // User clicks > onto newSwipeIndex (1) mid-stream
    msg.swipe_id = 1;
    msg.content = "";
    harness.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      message: { ...msg, swipes: [...msg.swipes] },
      action: "navigated",
      swipeId: 1,
      previousSwipeId: 0,
    });

    // Immediate flush resumes live streaming on swipe 1 without rewriting metadata
    while (harness.updateMessageCalls.length < 2) {
      await waitMs(5);
    }
    expect(harness.updateMessageCalls[1]!.patch.swipe_id).toBe(1);
    expect(harness.updateMessageCalls[1]!.patch.content).toBe("Start middle");
    expect(harness.updateMessageCalls[1]!.patch.skipChunkRebuild).toBe(true);
    expect("metadata" in harness.updateMessageCalls[1]!.patch).toBe(false);

    midGateResolve();
    const res = await runPromise;

    expect(res.text).toBe("Start middle end");
    expect(msg.swipe_id).toBe(1);
    expect(msg.content).toBe("Start middle end");
    const lastPatch = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect(lastPatch.swipe_id).toBe(1);
    expect(lastPatch.skipChunkRebuild).toBe(false);
    expect("metadata" in lastPatch).toBe(false);
    expect(lastPatch.content).toBe("Start middle end");
  });

  test("backgroundSwipe: true on RunActionInput starts in background mode, buffers mid-stream, and commits text + reasoning on completion", async () => {
    const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const harness = createSpindleHarness({
      activePresetId: "p-bg",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Old swipe",
            swipes: ["Old swipe"],
            swipe_id: 0,
            extra: {
              reasoningBySwipe: ["Old thought"],
              reasoningDurationBySwipe: [300],
              reasoning: "Old thought",
              reasoning_duration: 300,
            },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Alpha" };
        await waitMs(135);
        yield { type: "reasoning", token: "Bg thought" };
        yield { type: "token", token: " Beta" };
        yield { type: "done", content: "Alpha Beta", reasoning: "Bg thought", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    const res = await runner.run(
      {
        actionId: "guided_swipe",
        chatId: "chat-1",
        inputText: "Keep reading old",
        backgroundSwipe: true,
      },
      "u1",
    );

    expect(res.swipeId).toBe(1);
    expect(res.text).toBe("Alpha Beta");

    // Only 2 updateMessage calls across >135ms stream: initial eager slot registration + final commit
    expect(harness.updateMessageCalls).toHaveLength(2);
    const [slotPatch, commitPatch] = harness.updateMessageCalls.map((c) => c.patch);

    expect("content" in slotPatch!).toBe(false);
    expect("swipe_id" in slotPatch!).toBe(false);
    expect("reasoning" in slotPatch!).toBe(false);
    expect("swipe_reasoning" in slotPatch!).toBe(false);
    expect(slotPatch!.skipChunkRebuild).toBe(true);
    expect(slotPatch!.swipes).toEqual(["Old swipe", ""]);
    expect(slotPatch!.metadata).toEqual({
      preset_contexts: [null, { preset_id: "p-bg" }],
    });

    expect("content" in commitPatch!).toBe(false);
    expect("swipe_id" in commitPatch!).toBe(false);
    expect("reasoning" in commitPatch!).toBe(false);
    expect("metadata" in commitPatch!).toBe(false);
    expect(commitPatch!.skipChunkRebuild).toBe(true);
    expect(commitPatch!.swipes).toEqual(["Old swipe", "Alpha Beta"]);
    expect(commitPatch!.swipe_reasoning).toEqual([
      { text: "Old thought", duration: 300 },
      { text: "Bg thought" },
    ]);

    const msg = harness.chatMessages.get("chat-1")![1]!;
    expect(msg.swipe_id).toBe(0);
    expect(msg.content).toBe("Old swipe");
    expect(msg.swipes).toEqual(["Old swipe", "Alpha Beta"]);
    expect(msg.extra.reasoning).toBe("Old thought");
    expect(msg.extra.reasoningBySwipe).toEqual(["Old thought", "Bg thought"]);
    expect(harness.getEventHandlerCount("MESSAGE_SWIPED")).toBe(0);
  });

  test("guided_regenerate deletes trailing assistant before dryRun, creates blank slot after dryRun, and restores cleanly without duplicate on 0-token abort/failure", async () => {
    let streamBehavior: "abort_zero" | "fail_zero" | "succeed" = "abort_zero";
    let sawBlankCreatedBeforeDryRun = false;
    let sawDeletedAtDryRun = false;
    let sawBlankCreatedBeforeStream = false;
    let runnerRef: GuidedGenerationRunner;

    const harness = createSpindleHarness({
      presets: { "p-regen": { id: "p-regen", name: "Regen Preset" } },
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Question" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Original swipe 2",
            swipe_id: 1,
            swipes: ["Original swipe 1", "Original swipe 2"],
            swipe_dates: [1700000010, 1700000020],
            extra: { reasoning: "Original thought", reasoning_duration: 1.2 },
            metadata: { customKeep: "orig" },
          }),
        ],
      },
      dryRunImpl: async () => {
        const msgs = harness.chatMessages.get("chat-1")!;
        const last = msgs[msgs.length - 1];
        sawDeletedAtDryRun = msgs.length === 1 && last?.id === "m1";
        sawBlankCreatedBeforeDryRun =
          msgs.length === 2 &&
          last?.id !== "m2" &&
          last?.role === "assistant" &&
          last?.content === "";
        return {
          messages: [],
          request_messages: [
            { role: "user", content: "Question", sourceMessageId: "m1" },
          ],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        const msgs = harness.chatMessages.get("chat-1")!;
        const last = msgs[msgs.length - 1];
        sawBlankCreatedBeforeStream =
          msgs.length === 2 &&
          last?.id !== "m2" &&
          last?.role === "assistant" &&
          last?.content === "" &&
          (last?.metadata?.preset_contexts as Array<{ preset_id?: string }> | undefined)?.[0]
            ?.preset_id === "p-regen";
        if (streamBehavior === "abort_zero") {
          runnerRef.abortCurrent("u1");
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        if (streamBehavior === "fail_zero") {
          throw new Error("0-token regen failure");
        }
        yield { type: "token", token: "Fresh " };
        await new Promise((r) => setTimeout(r, 135));
        yield { type: "token", token: "answer." };
        yield { type: "done", content: "Fresh answer.", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const settings = createDefaultSettings();
    settings.actions.guided_regenerate.presetId = "p-regen";
    await store.saveSettings(settings, "u1");
    runnerRef = new GuidedGenerationRunner(harness.api, store, () => {});

    // 1. 0-token abort deletes post-dryRun blank slot and restores snapshot without duplicate
    streamBehavior = "abort_zero";
    const aborted = await runnerRef.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "Try better" },
      "u1",
    );
    expect(aborted.aborted).toBe(true);
    expect(aborted.messageId).toBeUndefined();
    expect(sawDeletedAtDryRun).toBe(true);
    expect(sawBlankCreatedBeforeDryRun).toBe(false);
    expect(sawBlankCreatedBeforeStream).toBe(true);
    const afterAbort = harness.chatMessages.get("chat-1")!;
    expect(afterAbort).toHaveLength(2);
    expect(afterAbort[1]?.content).toBe("Original swipe 2");
    expect(afterAbort[1]?.swipes).toEqual(["Original swipe 1", "Original swipe 2"]);
    expect(afterAbort[1]?.swipe_id).toBe(1);
    expect(afterAbort[1]?.metadata).toEqual({ customKeep: "orig" });

    // 2. 0-token failure also cleans up empty slot and restores snapshot
    streamBehavior = "fail_zero";
    await expect(
      runnerRef.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "Try better" }, "u1"),
    ).rejects.toThrow("0-token regen failure");
    expect(harness.chatMessages.get("chat-1")).toHaveLength(2);
    expect(harness.chatMessages.get("chat-1")![1]?.content).toBe("Original swipe 2");

    // 3. Successful stream strips blank slot from dryRun prompt and streams into pre-created slot
    harness.updateMessageCalls.length = 0;
    streamBehavior = "succeed";
    const ok = await runnerRef.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "Try better" },
      "u1",
    );
    expect(ok.aborted).toBe(false);
    expect(ok.text).toBe("Fresh answer.");
    const sent = harness.rawStreamCalls[2]?.messages as LlmMessageDTO[];
    expect(sent.some((m) => m.role === "assistant")).toBe(false);

    const finalMsgs = harness.chatMessages.get("chat-1")!;
    expect(finalMsgs).toHaveLength(2);
    expect(finalMsgs[1]?.content).toBe("Fresh answer.");
    expect(finalMsgs[1]?.metadata).toEqual({
      preset_contexts: [{ preset_id: "p-regen" }],
    });
    expect(harness.updateMessageCalls.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < harness.updateMessageCalls.length - 1; i += 1) {
      expect(harness.updateMessageCalls[i]!.patch.skipChunkRebuild).toBe(true);
      expect("metadata" in harness.updateMessageCalls[i]!.patch).toBe(false);
    }
    const lastRegenPatch = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect(lastRegenPatch.skipChunkRebuild).toBe(false);
    expect("metadata" in lastRegenPatch).toBe(false);
  });

  test("guided_continue patches missing preset_contexts once before streaming, preserves existing preset_contexts, and uses skipChunkRebuild", async () => {
    const harness = createSpindleHarness({
      activePresetId: "p-cont",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Go" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Line one",
            swipes: ["Line one"],
            swipe_id: 0,
            metadata: { existingFlag: true },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "line " };
        await new Promise((r) => setTimeout(r, 135));
        yield { type: "token", token: "two." };
        yield { type: "done", content: "line two.", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});
    const res1 = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(res1.text).toBe("Line one line two.");

    // First updateMessage call patched metadata once (without overwriting content/swipes)
    expect(harness.updateMessageCalls[0]!.patch).toEqual({
      metadata: {
        existingFlag: true,
        preset_contexts: [{ preset_id: "p-cont" }],
      },
      skipChunkRebuild: true,
    });
    // Mid-stream flush had skipChunkRebuild: true and no metadata; final flush had skipChunkRebuild: false and no metadata
    for (let i = 1; i < harness.updateMessageCalls.length - 1; i += 1) {
      expect(harness.updateMessageCalls[i]!.patch.skipChunkRebuild).toBe(true);
      expect("metadata" in harness.updateMessageCalls[i]!.patch).toBe(false);
    }
    const lastPatch1 = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect(lastPatch1.skipChunkRebuild).toBe(false);
    expect("metadata" in lastPatch1).toBe(false);

    // Second continue when preset_contexts[0] is ALREADY set must NOT touch metadata at all (preserves presetIdentity!)
    harness.updateMessageCalls.length = 0;
    const msg = harness.chatMessages.get("chat-1")![1]!;
    msg.metadata = {
      existingFlag: true,
      preset_contexts: [{ preset_id: "p-original-kept" }],
    };
    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(harness.updateMessageCalls.every((c) => !("metadata" in c.patch))).toBe(true);
    expect(msg.metadata).toEqual({
      existingFlag: true,
      preset_contexts: [{ preset_id: "p-original-kept" }],
    });
  });

  test("omits preset_contexts when configured preset is deleted or presets.getActive returns null/throws, and handleRpc parses backgroundSwipe", async () => {
    const harness = createSpindleHarness({
      presets: {},
      getActivePresetThrows: true,
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Swipe 0",
            swipes: ["Swipe 0"],
            swipe_id: 0,
          }),
        ],
      },
    });
    const { handleRpc } = registerBackend(harness.api);

    // Deleted presetId configured -> must NOT write invalid preset_id into preset_contexts
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-save",
        action: "save_settings",
        input: {
          actions: {
            guided_response: { presetId: "deleted-preset-id" },
          },
        },
      },
      "u1",
    );

    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-resp",
        action: "run_action",
        input: { actionId: "guided_response", chatId: "chat-1", inputText: "Hello" },
      },
      "u1",
    );
    const respMsg = harness.chatMessages.get("chat-1")![2]!;
    expect(respMsg.metadata).toBeUndefined();

    // handleRpc forwards backgroundSwipe: true onto RunActionInput for guided_swipe
    harness.chatMessages.get("chat-1")!.splice(2);
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-bg-swipe",
        action: "run_action",
        input: {
          actionId: "guided_swipe",
          chatId: "chat-1",
          inputText: "Bg via rpc",
          backgroundSwipe: true,
        },
      },
      "u1",
    );
    const swipedMsg = harness.chatMessages.get("chat-1")![1]!;
    expect(swipedMsg.swipe_id).toBe(0);
    expect(swipedMsg.content).toBe("Swipe 0");
    expect(swipedMsg.swipes).toEqual(["Swipe 0", "Generated reply."]);
  });

  test("SettingsStore continue history enforces LIFO stack per swipe, MAX_CONTINUE_ENTRIES cap, write serialization, and userId isolation", async () => {
    let failWrite = false;
    const harness = createSpindleHarness({
      writeDelayMs: 5,
      writeError: (path) =>
        failWrite && path === "continue-history.json"
          ? new Error("disk full")
          : null,
    });
    const store = new SettingsStore(harness.api);

    await Promise.all([
      store.pushContinueEntry(
        {
          chatId: "chat-1",
          messageId: "m-1",
          swipeIndex: 0,
          baseText: "Base",
          resultText: "Base One",
          baseReasoning: "R0",
          baseReasoningDuration: 1.5,
          inputText: "first",
        },
        "user-a",
      ),
      store.pushContinueEntry(
        {
          chatId: "chat-1",
          messageId: "m-1",
          swipeIndex: 0,
          baseText: "Base One",
          resultText: "Base One Two",
          baseReasoning: "R1",
          baseReasoningDuration: 2.0,
          inputText: "second",
        },
        "user-a",
      ),
      store.pushContinueEntry(
        {
          chatId: "chat-1",
          messageId: "m-1",
          swipeIndex: 1,
          baseText: "Swipe 1",
          resultText: "Swipe 1 Cont",
          baseReasoning: null,
          baseReasoningDuration: null,
          inputText: "other swipe",
        },
        "user-a",
      ),
    ]);

    expect(await store.peekContinueEntry("chat-1", "m-1", 0, "user-b")).toBeNull();

    const topSwipe0 = await store.peekContinueEntry("chat-1", "m-1", 0, "user-a");
    expect(topSwipe0?.resultText).toBe("Base One Two");

    // Failed write must not mutate in-memory cache.
    failWrite = true;
    await expect(
      store.pushContinueEntry(
        {
          chatId: "chat-1",
          messageId: "m-1",
          swipeIndex: 0,
          baseText: "X",
          resultText: "Y",
          baseReasoning: null,
          baseReasoningDuration: null,
          inputText: "",
        },
        "user-a",
      ),
    ).rejects.toThrow("disk full");
    failWrite = false;

    expect((await store.peekContinueEntry("chat-1", "m-1", 0, "user-a"))?.id).toBe(
      topSwipe0?.id,
    );

    // Replace top entry atomically.
    const replaced = await store.replaceTopContinueEntry(
      "chat-1",
      "m-1",
      0,
      topSwipe0!.id,
      {
        chatId: "chat-1",
        messageId: "m-1",
        swipeIndex: 0,
        baseText: "Base One",
        resultText: "Base One Replaced",
        baseReasoning: "R1",
        baseReasoningDuration: 2.0,
        inputText: "second",
      },
      "user-a",
    );
    expect(replaced.resultText).toBe("Base One Replaced");
    expect((await store.peekContinueEntry("chat-1", "m-1", 0, "user-a"))?.id).toBe(
      replaced.id,
    );

    // Mismatched expectedId does not pop.
    expect(
      await store.popContinueEntry("chat-1", "m-1", 0, "wrong-id", "user-a"),
    ).toBeNull();

    const popped1 = await store.popContinueEntry(
      "chat-1",
      "m-1",
      0,
      replaced.id,
      "user-a",
    );
    expect(popped1?.resultText).toBe("Base One Replaced");
    const popped2 = await store.popContinueEntry("chat-1", "m-1", 0, undefined, "user-a");
    expect(popped2?.resultText).toBe("Base One");
    expect(await store.peekContinueEntry("chat-1", "m-1", 0, "user-a")).toBeNull();
    // Swipe 1 remains untouched.
    expect((await store.peekContinueEntry("chat-1", "m-1", 1, "user-a"))?.inputText).toBe(
      "other swipe",
    );

    // Evicts oldest entries beyond MAX_CONTINUE_ENTRIES.
    for (let i = 0; i < MAX_CONTINUE_ENTRIES + 5; i += 1) {
      await store.pushContinueEntry(
        {
          chatId: "chat-cap",
          messageId: "m-cap",
          swipeIndex: 0,
          baseText: `B${i}`,
          resultText: `R${i}`,
          baseReasoning: null,
          baseReasoningDuration: null,
          inputText: `${i}`,
        },
        "user-cap",
      );
    }
    const capped = await store.getContinueHistory("user-cap");
    expect(capped.length).toBe(MAX_CONTINUE_ENTRIES);
    expect(capped[0]?.resultText).toBe(`R${MAX_CONTINUE_ENTRIES + 4}`);
    expect(capped[capped.length - 1]?.resultText).toBe("R5");
  });

  test("guided_continue LIFO stack records continues and remove_last_continue restores baseText, reasoning, and duration one step at a time", async () => {
    let streamCount = 0;
    const harness = createSpindleHarness({
      presets: { "p-cont": { id: "p-cont", name: "Continue Preset" } },
      activePresetId: "p-cont",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Tell a story." }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "She opened the door.",
            swipes: ["She opened the door.", "Alt swipe."],
            swipe_id: 0,
            extra: {
              reasoningBySwipe: ["Initial thought", "Alt thought"],
              reasoningDurationBySwipe: [1.5, 0.8],
              reasoning: "Initial thought",
              reasoningDuration: 1.5,
            },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        streamCount += 1;
        if (streamCount === 1) {
          yield { type: "reasoning", token: "Cont 1 thought" };
          yield { type: "token", token: "Cold wind rushed in." };
          yield { type: "done", content: "Cold wind rushed in.", reasoning: "Cont 1 thought", finish_reason: "stop" };
        } else {
          yield { type: "reasoning", token: "Cont 2 thought" };
          yield { type: "token", token: "A shadow moved." };
          yield { type: "done", content: "A shadow moved.", reasoning: "Cont 2 thought", finish_reason: "stop" };
        }
      },
    });
    const { runner, handleRpc } = registerBackend(harness.api);

    // First guided_continue
    const res1 = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Add atmosphere" },
      "u1",
    );
    expect(res1.text).toBe("She opened the door. Cold wind rushed in.");
    const msgAfter1 = harness.chatMessages.get("chat-1")![1]!;
    expect(msgAfter1.extra.reasoning).toBe("Cont 1 thought");
    expect(msgAfter1.metadata).toEqual({ preset_contexts: [{ preset_id: "p-cont" }] });

    // Second guided_continue on top of first
    const res2 = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Add danger" },
      "u1",
    );
    expect(res2.text).toBe("She opened the door. Cold wind rushed in. A shadow moved.");
    expect(harness.chatMessages.get("chat-1")![1]!.extra.reasoning).toBe("Cont 2 thought");

    // Remove #1 -> pops second continue back to first continue state
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "rem-1",
        action: "remove_last_continue",
        input: { chatId: "chat-1" },
      },
      "u1",
    );
    const reply1 = harness.sentFrontend.find(
      (e) => (e.payload as RpcReplyEnvelope).requestId === "rem-1",
    )?.payload as RpcReplyEnvelope;
    expect(reply1.error).toBeUndefined();
    expect(reply1.result as RemoveContinueResult).toEqual({
      removed: true,
      messageId: "m2",
      swipeIndex: 0,
      text: "She opened the door. Cold wind rushed in.",
    });

    const afterRem1 = harness.chatMessages.get("chat-1")![1]!;
    expect(afterRem1.content).toBe("She opened the door. Cold wind rushed in.");
    expect(afterRem1.swipes[0]).toBe("She opened the door. Cold wind rushed in.");
    expect(afterRem1.swipes[1]).toBe("Alt swipe.");
    expect(afterRem1.extra.reasoning).toBe("Cont 1 thought");
    expect(afterRem1.metadata).toEqual({ preset_contexts: [{ preset_id: "p-cont" }] });

    // Remove #2 -> pops first continue back to original message + original reasoning + duration
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "rem-2",
        action: "remove_last_continue",
        input: { chatId: "chat-1" },
      },
      "u1",
    );
    const reply2 = harness.sentFrontend.find(
      (e) => (e.payload as RpcReplyEnvelope).requestId === "rem-2",
    )?.payload as RpcReplyEnvelope;
    expect(reply2.error).toBeUndefined();
    expect((reply2.result as RemoveContinueResult).text).toBe("She opened the door.");

    const afterRem2 = harness.chatMessages.get("chat-1")![1]!;
    expect(afterRem2.content).toBe("She opened the door.");
    expect(afterRem2.extra.reasoning).toBe("Initial thought");
    expect(afterRem2.extra.reasoning_duration).toBe(1.5);
    expect(afterRem2.extra.reasoningBySwipe).toEqual(["Initial thought", "Alt thought"]);
    expect(afterRem2.extra.reasoningDurationBySwipe).toEqual([1.5, 0.8]);
    const finalPatch = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect(finalPatch.skipChunkRebuild).toBe(false);
    expect("metadata" in finalPatch).toBe(false);

    // Remove #3 -> empty stack throws friendly error
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "rem-3",
        action: "remove_last_continue",
        input: { chatId: "chat-1" },
      },
      "u1",
    );
    const reply3 = harness.sentFrontend.find(
      (e) => (e.payload as RpcReplyEnvelope).requestId === "rem-3",
    )?.payload as RpcReplyEnvelope;
    expect(reply3.error).toBe("No continue history found for the current swipe.");
  });

  test("guided_continue does not push history on 0-token abort/error, pushes on abort/error with output, and remove_last_continue guards incompatible edits", async () => {
    let mode: "zero_abort" | "zero_error" | "error_with_output" | "abort_with_output" = "zero_abort";
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Go on." }),
          makeMessage({ id: "m2", role: "assistant", content: "Original line.", swipes: ["Original line."], swipe_id: 0 }),
        ],
      },
      rawStreamImpl: async function* ({ signal }) {
        if (mode === "zero_abort") {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        if (mode === "zero_error") {
          throw new Error("Upstream 502");
        }
        if (mode === "error_with_output") {
          yield { type: "token", token: "Partial error output." };
          throw new Error("Midstream drop");
        }
        if (mode === "abort_with_output") {
          yield { type: "token", token: "Partial abort" };
          if (signal?.aborted) return;
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
      },
    });
    const { store, runner } = registerBackend(harness.api);

    mode = "zero_abort";
    const zeroAbortRes = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "x" },
      "u1",
    );
    expect(zeroAbortRes.aborted).toBe(true);
    expect(await store.peekContinueEntry("chat-1", "m2", 0, "u1")).toBeNull();

    mode = "zero_error";
    await expect(
      runner.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "x" }, "u1"),
    ).rejects.toThrow("Upstream 502");
    expect(await store.peekContinueEntry("chat-1", "m2", 0, "u1")).toBeNull();

    // Error with output must record history so user can undo the partial output.
    mode = "error_with_output";
    await expect(
      runner.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "Recoverable" }, "u1"),
    ).rejects.toThrow("Midstream drop");
    const errEntry = await store.peekContinueEntry("chat-1", "m2", 0, "u1");
    expect(errEntry?.baseText).toBe("Original line.");
    expect(errEntry?.resultText).toBe("Original line. Partial error output.");
    expect(errEntry?.inputText).toBe("Recoverable");

    // Undo clears partial output and restores null reasoning.
    const removedErr = await runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    expect(removedErr.text).toBe("Original line.");
    expect(harness.chatMessages.get("chat-1")![1]!.content).toBe("Original line.");

    // Abort with output records history too.
    mode = "abort_with_output";
    const abortOutRes = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Abortable" },
      "u1",
    );
    expect(abortOutRes.aborted).toBe(true);
    expect(abortOutRes.text).toBe("Original line. Partial abort");
    expect((await store.peekContinueEntry("chat-1", "m2", 0, "u1"))?.resultText).toBe(
      "Original line. Partial abort",
    );

    // Incompatible manual edit blocks remove_last_continue without popping stack.
    const msg = harness.chatMessages.get("chat-1")![1]!;
    msg.content = "Completely rewritten text.";
    msg.swipes[0] = "Completely rewritten text.";
    await expect(
      runner.removeLastContinue({ chatId: "chat-1" }, "u1"),
    ).rejects.toThrow("The message was edited after the last continue; cannot safely remove it.");
    expect(await store.peekContinueEntry("chat-1", "m2", 0, "u1")).not.toBeNull();

    // Compatible tail edit (still starts with baseText) is allowed.
    msg.content = "Original line. Tweaked ending.";
    msg.swipes[0] = "Original line. Tweaked ending.";
    const removedTail = await runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    expect(removedTail.text).toBe("Original line.");
    expect(await store.peekContinueEntry("chat-1", "m2", 0, "u1")).toBeNull();
  });

  test("regenerate_last_continue reverts eagerly to baseText, reuses saved inputText without touching inputRecovery, and updates stack on success", async () => {
    let streamCount = 0;
    let promptSeenOnRegen: LlmMessageDTO[] = [];
    const seenTextsDuringStream: string[] = [];

    const harness = createSpindleHarness({
      presets: { "p-cont": { id: "p-cont", name: "Continue Preset" } },
      activePresetId: "p-cont",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base start.",
            swipes: ["Base start."],
            swipe_id: 0,
            extra: {
              reasoning: "Base reasoning",
              reasoningDuration: 2.25,
            },
          }),
        ],
      },
      dryRunImpl: async () => {
        // Observe the eagerly reverted message state before dryRun finishes!
        seenTextsDuringStream.push(harness.chatMessages.get("chat-1")![1]!.content);
        return {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: harness.chatMessages.get("chat-1")![1]!.content },
          ],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* (input) {
        streamCount += 1;
        if (streamCount === 1) {
          yield { type: "reasoning", token: "First cont reasoning" };
          yield { type: "token", token: "First continuation." };
          yield { type: "done", content: "First continuation.", reasoning: "First cont reasoning", finish_reason: "stop" };
        } else {
          promptSeenOnRegen = input.messages as LlmMessageDTO[];
          yield { type: "reasoning", token: "Second cont reasoning" };
          yield { type: "token", token: "Fresh continuation." };
          yield { type: "done", content: "Fresh continuation.", reasoning: "Second cont reasoning", finish_reason: "stop" };
        }
      },
    });
    const { store, runner, handleRpc } = registerBackend(harness.api);

    // Run initial guided_continue with inputText (pushes to inputRecovery once).
    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Keep it spooky" },
      "u1",
    );
    const recoveryBeforeRegen = await store.getRecovery("u1");
    expect(recoveryBeforeRegen.length).toBe(1);
    expect(recoveryBeforeRegen[0]?.text).toBe("Keep it spooky");

    harness.updateMessageCalls.length = 0;
    harness.sentFrontend.length = 0;
    seenTextsDuringStream.length = 0;

    // Regenerate last continue via RPC.
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "regen-1",
        action: "regenerate_last_continue",
        input: { chatId: "chat-1" },
      },
      "u1",
    );

    const regenReply = harness.sentFrontend.find(
      (e) => (e.payload as RpcReplyEnvelope).requestId === "regen-1",
    )?.payload as RpcReplyEnvelope;
    expect(regenReply.error).toBeUndefined();
    expect((regenReply.result as { text: string }).text).toBe(
      "Base start. Fresh continuation.",
    );

    // Eager revert happened before dryRun with skipChunkRebuild: true and base reasoning/duration.
    expect(seenTextsDuringStream[0]).toBe("Base start.");
    expect(harness.updateMessageCalls[0]?.patch.content).toBe("Base start.");
    expect(harness.updateMessageCalls[0]?.patch.skipChunkRebuild).toBe(true);
    expect(harness.updateMessageCalls[0]?.patch.reasoning).toEqual({
      text: "Base reasoning",
      duration: 2.25,
    });

    // Reused saved inputText in prompt without adding duplicate/new entry to inputRecovery.
    expect(
      promptSeenOnRegen.some(
        (m) => typeof m.content === "string" && m.content.includes("Keep it spooky"),
      ),
    ).toBe(true);
    expect(await store.getRecovery("u1")).toEqual(recoveryBeforeRegen);

    // Emitted gg:status lifecycle with guided_continue.
    const statusEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
      .map((e) => (e.payload as BackendPushEvent).run);
    expect(statusEvents[0]?.actionId).toBe("guided_continue");
    expect(statusEvents[statusEvents.length - 1]).toBeNull();

    // Stack top now has updated resultText while keeping original baseText/baseReasoning/inputText.
    const topEntry = await store.peekContinueEntry("chat-1", "m2", 0, "u1");
    expect(topEntry?.baseText).toBe("Base start.");
    expect(topEntry?.resultText).toBe("Base start. Fresh continuation.");
    expect(topEntry?.baseReasoning).toBe("Base reasoning");
    expect(topEntry?.baseReasoningDuration).toBe(2.25);
    expect(topEntry?.inputText).toBe("Keep it spooky");

    // Removing after regenerate reverts all the way back to original base state.
    const removed = await runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    expect(removed.text).toBe("Base start.");
    const msgFinal = harness.chatMessages.get("chat-1")![1]!;
    expect(msgFinal.content).toBe("Base start.");
    expect(msgFinal.extra.reasoning).toBe("Base reasoning");
    expect(msgFinal.extra.reasoning_duration).toBe(2.25);
  });

  test("regenerate_last_continue restores preRegen message and keeps stack entry on 0-token abort or failure", async () => {
    let failDryRun = false;
    let streamMode: "normal" | "zero_abort" | "zero_error" = "normal";

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base line.",
            swipes: ["Base line."],
            swipe_id: 0,
            extra: { reasoning: "Base R", reasoning_duration: 1.0 },
          }),
        ],
      },
      dryRunImpl: async () => {
        if (failDryRun) throw new Error("DryRun failed");
        return {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Base line." },
          ],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        if (streamMode === "normal") {
          yield { type: "reasoning", token: "Prev cont R" };
          yield { type: "token", token: "Existing continue." };
          yield { type: "done", content: "Existing continue.", reasoning: "Prev cont R", finish_reason: "stop" };
          return;
        }
        if (streamMode === "zero_abort") {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        throw new Error("Provider error");
      },
    });
    const { store, runner } = registerBackend(harness.api);

    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Original input" },
      "u1",
    );
    const originalEntry = await store.peekContinueEntry("chat-1", "m2", 0, "u1");
    expect(originalEntry?.resultText).toBe("Base line. Existing continue.");

    // 1. 0-token abort during regenerate -> restores preRegen and keeps originalEntry.
    streamMode = "zero_abort";
    const abortRes = await runner.regenerateLastContinue({ chatId: "chat-1" }, "u1");
    expect(abortRes.aborted).toBe(true);
    expect(abortRes.text).toBe("Base line. Existing continue.");
    const msgAfterAbort = harness.chatMessages.get("chat-1")![1]!;
    expect(msgAfterAbort.content).toBe("Base line. Existing continue.");
    expect(msgAfterAbort.extra.reasoning).toBe("Prev cont R");
    expect((await store.peekContinueEntry("chat-1", "m2", 0, "u1"))?.id).toBe(
      originalEntry?.id,
    );

    // 2. dryRun error -> restores preRegen and keeps originalEntry.
    failDryRun = true;
    await expect(
      runner.regenerateLastContinue({ chatId: "chat-1" }, "u1"),
    ).rejects.toThrow("DryRun failed");
    failDryRun = false;
    expect(harness.chatMessages.get("chat-1")![1]!.content).toBe(
      "Base line. Existing continue.",
    );
    expect(harness.chatMessages.get("chat-1")![1]!.extra.reasoning).toBe("Prev cont R");
    expect((await store.peekContinueEntry("chat-1", "m2", 0, "u1"))?.id).toBe(
      originalEntry?.id,
    );

    // 3. 0-token stream error -> restores preRegen and keeps originalEntry.
    streamMode = "zero_error";
    await expect(
      runner.regenerateLastContinue({ chatId: "chat-1" }, "u1"),
    ).rejects.toThrow("Provider error");
    expect(harness.chatMessages.get("chat-1")![1]!.content).toBe(
      "Base line. Existing continue.",
    );
    expect(harness.chatMessages.get("chat-1")![1]!.extra.reasoning).toBe("Prev cont R");
    expect((await store.peekContinueEntry("chat-1", "m2", 0, "u1"))?.id).toBe(
      originalEntry?.id,
    );
    const lastPatch = harness.updateMessageCalls[harness.updateMessageCalls.length - 1]!.patch;
    expect(lastPatch.skipChunkRebuild).toBe(false);
  });

  test("gg:status emits messageId, swipeId, and hasContentOutput lifecycle for guided_response and guided_regenerate", async () => {
    for (const actionId of ["guided_response", "guided_regenerate"] as const) {
      let runAtDryRun = null as ActiveRunState | null;
      let statusAtDryRun: Array<ActiveRunState | null> = [];
      let runAtStreamStart = null as ActiveRunState | null;
      let statusAtStreamStart: Array<ActiveRunState | null> = [];
      let runAfterReasoning = null as ActiveRunState | null;
      let statusCountAfterReasoning = 0;
      let runAfterEmptyToken = null as ActiveRunState | null;
      let statusCountAfterEmptyToken = 0;
      let runAfterFirstToken = null as ActiveRunState | null;
      let statusCountAfterFirstToken = 0;
      let statusCountAfterSecondToken = 0;

      const harness = createSpindleHarness({
        chats: {
          "chat-1": [
            makeMessage({ id: "m1", role: "user", content: "Hello" }),
            ...(actionId === "guided_regenerate"
              ? [makeMessage({ id: "m2", role: "assistant", content: "Old reply", swipes: ["Old reply"] })]
              : []),
          ],
        },
        dryRunImpl: async () => {
          runAtDryRun = runner.getActiveRun("u1");
          statusAtDryRun = harness.sentFrontend
            .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
            .map((e) => (e.payload as BackendPushEvent).run ?? null);
          return {
            messages: [{ role: "user", content: "Hello" }],
            parameters: {},
            model: "gpt-4o",
            provider: "openai",
          };
        },
        rawStreamImpl: async function* () {
          runAtStreamStart = runner.getActiveRun("u1");
          statusAtStreamStart = harness.sentFrontend
            .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
            .map((e) => (e.payload as BackendPushEvent).run ?? null);

          yield { type: "reasoning", token: "Thinking..." };
          runAfterReasoning = runner.getActiveRun("u1");
          statusCountAfterReasoning = harness.sentFrontend.filter(
            (e) => (e.payload as BackendPushEvent).type === "gg:status",
          ).length;

          yield { type: "token", token: "" };
          runAfterEmptyToken = runner.getActiveRun("u1");
          statusCountAfterEmptyToken = harness.sentFrontend.filter(
            (e) => (e.payload as BackendPushEvent).type === "gg:status",
          ).length;

          yield { type: "token", token: "Hello" };
          runAfterFirstToken = runner.getActiveRun("u1");
          statusCountAfterFirstToken = harness.sentFrontend.filter(
            (e) => (e.payload as BackendPushEvent).type === "gg:status",
          ).length;

          yield { type: "token", token: " world" };
          statusCountAfterSecondToken = harness.sentFrontend.filter(
            (e) => (e.payload as BackendPushEvent).type === "gg:status",
          ).length;

          yield { type: "done", content: "Hello world", reasoning: "Thinking...", finish_reason: "stop" };
        },
      });
      const { runner } = registerBackend(harness.api);

      const res = await runner.run(
        { actionId, chatId: "chat-1", inputText: "Be concise" },
        "u1",
      );

      expect(res.messageId).toBeDefined();
      expect(statusAtDryRun).toHaveLength(1);
      expect(statusAtDryRun[0]?.messageId).toBeUndefined();
      expect(runAtDryRun?.messageId).toBeUndefined();

      expect(statusAtStreamStart).toHaveLength(2);
      expect(statusAtStreamStart[0]?.messageId).toBeUndefined();
      expect(statusAtStreamStart[1]?.messageId).toBe(res.messageId);
      expect(statusAtStreamStart[1]?.swipeId).toBe(0);
      expect(statusAtStreamStart[1]?.hasContentOutput).toBeFalsy();
      expect(runAtStreamStart?.messageId).toBe(res.messageId);
      expect(runAtStreamStart?.swipeId).toBe(0);

      // Reasoning-only and empty token chunks keep hasContentOutput falsy and do not emit extra gg:status.
      expect(runAfterReasoning?.hasContentOutput).toBeFalsy();
      expect(statusCountAfterReasoning).toBe(2);
      expect(runAfterEmptyToken?.hasContentOutput).toBeFalsy();
      expect(statusCountAfterEmptyToken).toBe(2);

      // First non-empty content token emits gg:status with hasContentOutput: true once.
      expect(runAfterFirstToken?.hasContentOutput).toBe(true);
      expect(statusCountAfterFirstToken).toBe(3);
      expect(statusCountAfterSecondToken).toBe(3);

      const allStatusRuns = harness.sentFrontend
        .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
        .map((e) => (e.payload as BackendPushEvent).run ?? null);
      expect(allStatusRuns[2]?.hasContentOutput).toBe(true);
      expect(allStatusRuns[allStatusRuns.length - 1]).toBeNull();
    }
  });

  test("gg:status emits messageId, swipeId, backgroundSwipe, and hasContentOutput on done-only stream for guided_swipe", async () => {
    for (const backgroundSwipe of [false, true] as const) {
      let statusAtDryRun: Array<ActiveRunState | null> = [];
      let statusAtStreamStart: Array<ActiveRunState | null> = [];
      let runAfterReasoning = null as ActiveRunState | null;
      let statusCountAfterReasoning = 0;

      const harness = createSpindleHarness({
        chats: {
          "chat-1": [
            makeMessage({ id: "m1", role: "user", content: "Hello" }),
            makeMessage({
              id: "m2",
              role: "assistant",
              content: "First swipe",
              swipes: ["First swipe"],
              swipe_id: 0,
            }),
          ],
        },
        dryRunImpl: async () => {
          statusAtDryRun = harness.sentFrontend
            .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
            .map((e) => (e.payload as BackendPushEvent).run ?? null);
          return {
            messages: [{ role: "user", content: "Hello" }],
            parameters: {},
            model: "gpt-4o",
            provider: "openai",
          };
        },
        rawStreamImpl: async function* () {
          statusAtStreamStart = harness.sentFrontend
            .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
            .map((e) => (e.payload as BackendPushEvent).run ?? null);
          yield { type: "reasoning", token: "Pondering swipe..." };
          runAfterReasoning = runner.getActiveRun("u1");
          statusCountAfterReasoning = harness.sentFrontend.filter(
            (e) => (e.payload as BackendPushEvent).type === "gg:status",
          ).length;

          yield { type: "done", content: "Second swipe", reasoning: "Pondering swipe...", finish_reason: "stop" };
        },
      });
      const { runner } = registerBackend(harness.api);

      const res = await runner.run(
        { actionId: "guided_swipe", chatId: "chat-1", inputText: "Try another angle", backgroundSwipe },
        "u1",
      );

      expect(res.messageId).toBe("m2");
      expect(res.swipeId).toBe(1);
      expect(statusAtDryRun).toHaveLength(1);
      expect(statusAtDryRun[0]?.messageId).toBeUndefined();

      expect(statusAtStreamStart).toHaveLength(2);
      expect(statusAtStreamStart[1]?.messageId).toBe("m2");
      expect(statusAtStreamStart[1]?.swipeId).toBe(1);
      expect(statusAtStreamStart[1]?.backgroundSwipe).toBe(backgroundSwipe);
      expect(statusAtStreamStart[1]?.hasContentOutput).toBeFalsy();

      expect(runAfterReasoning?.hasContentOutput).toBeFalsy();
      expect(statusCountAfterReasoning).toBe(2);

      const allStatusRuns = harness.sentFrontend
        .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
        .map((e) => (e.payload as BackendPushEvent).run ?? null);
      expect(allStatusRuns).toHaveLength(4);
      expect(allStatusRuns[2]?.hasContentOutput).toBe(true);
      expect(allStatusRuns[2]?.backgroundSwipe).toBe(backgroundSwipe);
      expect(allStatusRuns[3]).toBeNull();
    }
  });

  test("gg:status emits messageId, swipeId, and hasContentOutput lifecycle for guided_continue", async () => {
    let runAtDryRun = null as ActiveRunState | null;
    let statusAtDryRun: Array<ActiveRunState | null> = [];
    let runAfterReasoning = null as ActiveRunState | null;
    let statusCountAfterReasoning = 0;
    let runAfterEmptyToken = null as ActiveRunState | null;
    let statusCountAfterEmptyToken = 0;
    let runAfterFirstToken = null as ActiveRunState | null;
    let statusCountAfterFirstToken = 0;
    let statusCountAfterSecondToken = 0;

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Initial text.",
            swipes: ["Alt swipe", "Initial text."],
            swipe_id: 1,
          }),
        ],
      },
      dryRunImpl: async () => {
        runAtDryRun = runner.getActiveRun("u1");
        statusAtDryRun = harness.sentFrontend
          .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
          .map((e) => (e.payload as BackendPushEvent).run ?? null);
        return {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Initial text." },
          ],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        yield { type: "reasoning", token: "Thinking continue..." };
        runAfterReasoning = runner.getActiveRun("u1");
        statusCountAfterReasoning = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield { type: "token", token: "" };
        runAfterEmptyToken = runner.getActiveRun("u1");
        statusCountAfterEmptyToken = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield { type: "token", token: "More" };
        runAfterFirstToken = runner.getActiveRun("u1");
        statusCountAfterFirstToken = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield { type: "token", token: " details." };
        statusCountAfterSecondToken = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield {
          type: "done",
          content: "More details.",
          reasoning: "Thinking continue...",
          finish_reason: "stop",
        };
      },
    });
    const { runner } = registerBackend(harness.api);

    const res = await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Keep going" },
      "u1",
    );

    expect(res.messageId).toBe("m2");
    expect(res.swipeId).toBe(1);
    expect(statusAtDryRun).toHaveLength(2);
    expect(statusAtDryRun[0]?.messageId).toBeUndefined();
    expect(statusAtDryRun[1]?.messageId).toBe("m2");
    expect(statusAtDryRun[1]?.swipeId).toBe(1);
    expect(statusAtDryRun[1]?.hasContentOutput).toBeFalsy();
    expect(runAtDryRun?.messageId).toBe("m2");
    expect(runAtDryRun?.swipeId).toBe(1);

    // Reasoning-only and empty token chunks keep hasContentOutput falsy and do not emit extra gg:status.
    expect(runAfterReasoning?.hasContentOutput).toBeFalsy();
    expect(statusCountAfterReasoning).toBe(2);
    expect(runAfterEmptyToken?.hasContentOutput).toBeFalsy();
    expect(statusCountAfterEmptyToken).toBe(2);

    // First non-empty content token emits gg:status with hasContentOutput: true once.
    expect(runAfterFirstToken?.hasContentOutput).toBe(true);
    expect(statusCountAfterFirstToken).toBe(3);
    expect(statusCountAfterSecondToken).toBe(3);

    const allStatusRuns = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
      .map((e) => (e.payload as BackendPushEvent).run ?? null);
    expect(allStatusRuns).toHaveLength(4);
    expect(allStatusRuns[2]?.hasContentOutput).toBe(true);
    expect(allStatusRuns[3]).toBeNull();
  });

  test("gg:status emits messageId, swipeId, and hasContentOutput lifecycle for regenerate_last_continue", async () => {
    let phase: "initial" | "regen" = "initial";
    let runAtDryRun = null as ActiveRunState | null;
    let statusAtDryRun: Array<ActiveRunState | null> = [];
    let runAfterReasoning = null as ActiveRunState | null;
    let statusCountAfterReasoning = 0;
    let runAfterEmptyToken = null as ActiveRunState | null;
    let statusCountAfterEmptyToken = 0;
    let runAfterFirstToken = null as ActiveRunState | null;
    let statusCountAfterFirstToken = 0;
    let statusCountAfterSecondToken = 0;

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base line.",
            swipes: ["Alt swipe", "Base line."],
            swipe_id: 1,
          }),
        ],
      },
      dryRunImpl: async () => {
        if (phase === "regen") {
          runAtDryRun = runner.getActiveRun("u1");
          statusAtDryRun = harness.sentFrontend
            .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
            .map((e) => (e.payload as BackendPushEvent).run ?? null);
        }
        return {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Base line." },
          ],
          parameters: {},
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        if (phase === "initial") {
          yield { type: "token", token: "First try." };
          yield { type: "done", content: "First try.", finish_reason: "stop" };
          return;
        }

        yield { type: "reasoning", token: "Rethinking continue..." };
        runAfterReasoning = runner.getActiveRun("u1");
        statusCountAfterReasoning = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield { type: "token", token: "" };
        runAfterEmptyToken = runner.getActiveRun("u1");
        statusCountAfterEmptyToken = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield { type: "token", token: "Better" };
        runAfterFirstToken = runner.getActiveRun("u1");
        statusCountAfterFirstToken = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield { type: "token", token: " ending." };
        statusCountAfterSecondToken = harness.sentFrontend.filter(
          (e) => (e.payload as BackendPushEvent).type === "gg:status",
        ).length;

        yield {
          type: "done",
          content: "Better ending.",
          reasoning: "Rethinking continue...",
          finish_reason: "stop",
        };
      },
    });
    const { runner } = registerBackend(harness.api);

    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Keep going" },
      "u1",
    );
    harness.sentFrontend.length = 0;
    phase = "regen";

    const res = await runner.regenerateLastContinue({ chatId: "chat-1" }, "u1");

    expect(res.messageId).toBe("m2");
    expect(res.swipeId).toBe(1);
    expect(statusAtDryRun).toHaveLength(2);
    expect(statusAtDryRun[0]?.messageId).toBeUndefined();
    expect(statusAtDryRun[1]?.messageId).toBe("m2");
    expect(statusAtDryRun[1]?.swipeId).toBe(1);
    expect(statusAtDryRun[1]?.hasContentOutput).toBeFalsy();
    expect(runAtDryRun?.messageId).toBe("m2");
    expect(runAtDryRun?.swipeId).toBe(1);

    expect(runAfterReasoning?.hasContentOutput).toBeFalsy();
    expect(statusCountAfterReasoning).toBe(2);
    expect(runAfterEmptyToken?.hasContentOutput).toBeFalsy();
    expect(statusCountAfterEmptyToken).toBe(2);

    expect(runAfterFirstToken?.hasContentOutput).toBe(true);
    expect(statusCountAfterFirstToken).toBe(3);
    expect(statusCountAfterSecondToken).toBe(3);

    const allStatusRuns = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
      .map((e) => (e.payload as BackendPushEvent).run ?? null);
    expect(allStatusRuns).toHaveLength(4);
    expect(allStatusRuns[2]?.hasContentOutput).toBe(true);
    expect(allStatusRuns[3]).toBeNull();
  });

  test("guided_regenerate clears activeRun via gg:status run:null and restores trailing assistant when dryRun fails", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({ id: "m2", role: "assistant", content: "Keep me", swipes: ["Keep me"] }),
        ],
      },
      dryRunImpl: async () => {
        throw new Error("DryRun exploded");
      },
    });
    const { runner } = registerBackend(harness.api);

    await expect(
      runner.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "Retry" }, "u1"),
    ).rejects.toThrow("DryRun exploded");

    const statusPayloads = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:status")
      .map((e) => e.payload as BackendPushEvent);
    expect(statusPayloads).toHaveLength(2);
    expect(statusPayloads[0]?.run?.actionId).toBe("guided_regenerate");
    expect(statusPayloads[0]?.run?.messageId).toBeUndefined();
    expect(statusPayloads[statusPayloads.length - 1]?.run).toBeNull();
    expect(runner.getActiveRun("u1")).toBeNull();
    expect(harness.chatMessages.get("chat-1")![1]!.content).toBe("Keep me");
  });
});

describe("generation metrics helpers and gg:generation_metrics emission", () => {
  test("calculateGenerationTimingMetrics and resolveGenerationTokenCounts match Lumiverse semantics", () => {
    expect(
      calculateGenerationTimingMetrics(
        {
          streamingStartedAt: 1_000,
          firstTokenAt: 1_300,
          firstContentTokenAt: 2_000,
          responseStoppedAt: 4_000,
          completedAt: 4_500,
          wasStreaming: true,
        },
        30,
      ),
    ).toEqual({
      durationMs: 3_500,
      wasStreaming: true,
      ttft: 300,
      tps: 15,
    });

    expect(
      calculateGenerationTimingMetrics(
        {
          streamingStartedAt: 1_000,
          firstTokenAt: 1_200,
          firstContentTokenAt: 1_500,
          responseStoppedAt: 3_000,
          completedAt: 3_200,
          wasStreaming: true,
        },
        1,
      ).tps,
    ).toBeUndefined();

    expect(
      calculateGenerationTimingMetrics(
        {
          streamingStartedAt: 1_000,
          firstTokenAt: 1_200,
          firstContentTokenAt: 1_500,
          responseStoppedAt: 3_000,
          completedAt: 3_200,
          wasStreaming: false,
        },
        40,
      ),
    ).toEqual({
      durationMs: 2_200,
      wasStreaming: false,
    });

    expect(
      resolveGenerationTokenCounts(
        128,
        { messageTokenCount: 50, responseTokenCount: 40 },
        {
          hasReasoning: true,
          providerRaw: { completion_tokens_details: { reasoning_tokens: 108 } },
        },
      ),
    ).toEqual({
      messageTokenCount: 128,
      responseTokenCount: 20,
    });

    expect(
      resolveGenerationTokenCounts(
        128,
        { responseTokenCount: 35 },
        {
          hasDelimitedReasoning: true,
          providerRaw: { output_tokens_details: { thinking_tokens: 100 } },
        },
      ),
    ).toEqual({
      messageTokenCount: 128,
      responseTokenCount: 35,
    });
  });

  test("guided_response emits gg:generation_metrics with usage, timing, model, provider, and preset metadata", async () => {
    const harness = createSpindleHarness({
      presets: { "p-1": { id: "p-1", name: "Storyteller Preset" } },
      activePresetId: "p-1",
      connections: [
        {
          id: "conn-1",
          name: "Anthropic Main",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          is_default: true,
        },
      ],
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Begin." })],
      },
      dryRunImpl: async () => ({
        messages: [{ role: "user", content: "Begin." }],
        parameters: { temperature: 0.8 },
        model: "claude-3-7-sonnet",
        provider: "anthropic",
      }),
      rawStreamImpl: async function* () {
        await new Promise((r) => setTimeout(r, 15));
        yield { type: "reasoning", token: "Thinking..." };
        await new Promise((r) => setTimeout(r, 20));
        yield { type: "token", token: "   " };
        await new Promise((r) => setTimeout(r, 10));
        yield { type: "token", token: "Hello " };
        await new Promise((r) => setTimeout(r, 30));
        yield { type: "token", token: "world!" };
        yield {
          type: "done",
          content: "Hello world!",
          reasoning: "Thinking...",
          finish_reason: "stop",
          usage: {
            prompt_tokens: 10,
            completion_tokens: 45,
            total_tokens: 55,
            provider_raw: {
              completion_tokens_details: { reasoning_tokens: 25 },
            },
          },
        } as unknown as StreamChunkDTO;
      },
      countTextImpl: async () => {
        throw new Error("countText should not be needed when usage has details");
      },
    });
    const { runner } = registerBackend(harness.api);

    const res = await runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Keep it atmospheric" },
      "u1",
    );

    const metricEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);

    expect(metricEvents).toHaveLength(1);
    const evt = metricEvents[0]!;
    expect(evt.chatId).toBe("chat-1");
    expect(res.messageId).toBeDefined();
    expect(evt.messageId).toBe(res.messageId!);
    expect(evt.swipeId).toBe(0);
    expect(evt.tokenCount).toBe(45);
    expect(evt.generationMetrics?.wasStreaming).toBe(true);
    expect(evt.generationMetrics?.durationMs).toBeGreaterThanOrEqual(40);
    expect(evt.generationMetrics?.ttft).toBeGreaterThanOrEqual(10);
    expect(evt.generationMetrics?.ttft).toBeLessThanOrEqual(evt.generationMetrics!.durationMs);
    expect(evt.generationMetrics?.tps).toBeGreaterThan(0);
    expect(evt.generationMetrics?.model).toBe("claude-3-7-sonnet");
    expect(evt.generationMetrics?.provider).toBe("anthropic");
    expect(evt.generationMetrics?.presetId).toBe("p-1");
    expect(evt.generationMetrics?.presetName).toBe("Storyteller Preset");
    expect(harness.countTextCalls).toHaveLength(0);
  });

  test("guided_regenerate and guided_swipe fall back to spindle.tokens.countText when usage is missing and handle non-streaming", async () => {
    const harness = createSpindleHarness({
      presets: { "p-regen": { id: "p-regen", name: "Regen Preset" } },
      activePresetId: "p-regen",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({ id: "m2", role: "assistant", content: "Old", swipes: ["Old"], swipe_id: 0 }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Fresh " };
        await new Promise((r) => setTimeout(r, 20));
        yield { type: "token", token: "response." };
        yield { type: "done", content: "Fresh response.", finish_reason: "stop" };
      },
      countTextImpl: async (text) => ({
        total_tokens: Math.max(2, text.split(/\s+/).length * 4),
      }),
    });
    const { store, runner } = registerBackend(harness.api);

    const settings = await store.getSettings("u1");
    settings.actions.guided_regenerate.presetId = "p-regen";
    await store.saveSettings(settings, "u1");

    const regenRes = await runner.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "Try again" },
      "u1",
    );

    // Raw delta === finalText, so countText should only be called once and reused for TPS.
    expect(harness.countTextCalls).toHaveLength(1);
    expect(harness.countTextCalls[0]?.text).toBe("Fresh response.");
    expect(harness.countTextCalls[0]?.opts).toEqual({ model: "gpt-4o", userId: "u1" });

    let metricEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(metricEvents).toHaveLength(1);
    expect(regenRes.messageId).toBeDefined();
    expect(metricEvents[0]?.messageId).toBe(regenRes.messageId!);
    expect(metricEvents[0]?.swipeId).toBe(0);
    expect(metricEvents[0]?.tokenCount).toBe(8);
    expect(metricEvents[0]?.generationMetrics?.tps).toBeGreaterThan(0);
    expect(metricEvents[0]?.generationMetrics?.presetId).toBe("p-regen");
    expect(metricEvents[0]?.generationMetrics?.presetName).toBe("Regen Preset");

    // Now test non-streaming guided_swipe in background mode
    const nonStreamParams = { _streaming: false, temperature: 0.5 };
    const nonStreamHarness = createSpindleHarness({
      presets: { "p-regen": { id: "p-regen", name: "Regen Preset" } },
      activePresetId: "p-regen",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({ id: "m2", role: "assistant", content: "First", swipes: ["First"], swipe_id: 0 }),
        ],
      },
      dryRunImpl: async () => ({
        messages: [{ role: "user", content: "Hi" }],
        parameters: nonStreamParams,
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async () => {
        await new Promise((r) => setTimeout(r, 15));
        return {
          content: "Second swipe",
          finish_reason: "stop",
          usage: { prompt_tokens: 5, completion_tokens: 14, total_tokens: 19 },
        };
      },
      rawStreamImpl: async function* () {
        throw new Error("rawStream must not be called when _streaming is false");
      },
    });
    const nonStreamBackend = registerBackend(nonStreamHarness.api);
    const swipeRes = await nonStreamBackend.runner.run(
      {
        actionId: "guided_swipe",
        chatId: "chat-1",
        inputText: "Another angle",
        backgroundSwipe: true,
      },
      "u1",
    );

    expect(nonStreamHarness.rawCalls).toHaveLength(1);
    expect(nonStreamHarness.rawStreamCalls).toHaveLength(0);
    expect(nonStreamHarness.rawCalls[0]?.parameters).toEqual({ temperature: 0.5 });
    expect("_streaming" in ((nonStreamHarness.rawCalls[0]?.parameters as Record<string, unknown>) ?? {})).toBe(false);
    expect(nonStreamParams._streaming).toBe(false);
    expect(swipeRes.swipeId).toBe(1);
    metricEvents = nonStreamHarness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(metricEvents).toHaveLength(1);
    expect(metricEvents[0]?.messageId).toBe("m2");
    expect(metricEvents[0]?.swipeId).toBe(1);
    expect(metricEvents[0]?.tokenCount).toBe(14);
    expect(metricEvents[0]?.generationMetrics?.wasStreaming).toBe(false);
    expect(metricEvents[0]?.generationMetrics?.ttft).toBeUndefined();
    expect(metricEvents[0]?.generationMetrics?.tps).toBeUndefined();
    expect(metricEvents[0]?.generationMetrics?.durationMs).toBeGreaterThanOrEqual(10);
  });

  test("guided_continue and regenerate_last_continue compute combined tokenCount and raw delta TPS", async () => {
    const harness = createSpindleHarness({
      presets: { "p-cont": { id: "p-cont", name: "Continue Preset" } },
      activePresetId: "p-cont",
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Go on." }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "She opened the door.",
            swipes: ["She opened the door."],
            swipe_id: 0,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        await new Promise((r) => setTimeout(r, 10));
        yield { type: "token", token: "The hallway " };
        await new Promise((r) => setTimeout(r, 25));
        yield { type: "token", token: "was silent." };
        yield {
          type: "done",
          content: "The hallway was silent.",
          finish_reason: "stop",
          // Provider completion_tokens only reflects the delta; continue must count combined finalText.
          usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
        };
      },
      countTextImpl: async (text) => {
        if (text === "She opened the door. The hallway was silent.") {
          return { total_tokens: 18 };
        }
        if (text === "The hallway was silent.") {
          return { total_tokens: 6 };
        }
        if (text === "She opened the door.") {
          return { total_tokens: 12 };
        }
        return { total_tokens: 4 };
      },
    });
    const { runner } = registerBackend(harness.api);

    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Describe the hall" },
      "u1",
    );

    const continueMetrics = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);

    expect(continueMetrics).toHaveLength(1);
    expect(continueMetrics[0]?.messageId).toBe("m2");
    expect(continueMetrics[0]?.swipeId).toBe(0);
    expect(continueMetrics[0]?.tokenCount).toBe(18);
    expect(continueMetrics[0]?.generationMetrics?.tps).toBeGreaterThan(0);
    expect(continueMetrics[0]?.generationMetrics?.ttft).toBeGreaterThanOrEqual(5);
    expect(continueMetrics[0]?.generationMetrics?.presetId).toBe("p-cont");
    expect(continueMetrics[0]?.generationMetrics?.presetName).toBe("Continue Preset");

    // Regenerate last continue should also emit metrics for the new continuation.
    await runner.regenerateLastContinue({ chatId: "chat-1" }, "u1");
    const afterRegenMetrics = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(afterRegenMetrics).toHaveLength(2);
    expect(afterRegenMetrics[1]?.tokenCount).toBe(18);
    expect(afterRegenMetrics[1]?.generationMetrics?.tps).toBeGreaterThan(0);
  });

  test("removeLastContinue emits gg:generation_metrics with restored tokenCount (or null) and generationMetrics: null", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Tell me more." }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Original line.",
            swipes: ["Original line."],
            swipe_id: 0,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Extra line." };
        yield { type: "done", content: "Extra line.", finish_reason: "stop" };
      },
      countTextImpl: async (text) => {
        if (text === "Original line.") return { total_tokens: 7 };
        return { total_tokens: 11 };
      },
    });
    const { runner } = registerBackend(harness.api);

    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "More" },
      "u1",
    );
    const removed = await runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    expect(removed.removed).toBe(true);
    expect(removed.text).toBe("Original line.");

    const metricEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(metricEvents).toHaveLength(2);
    expect(metricEvents[1]).toEqual({
      type: "gg:generation_metrics",
      chatId: "chat-1",
      messageId: "m2",
      swipeId: 0,
      tokenCount: 7,
      generationMetrics: null,
    });

    // When countText is unavailable or throws, removeLastContinue still clears metrics with tokenCount: null.
    const noTokenizerHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Tell me more." }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Original line.",
            swipes: ["Original line."],
            swipe_id: 0,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Extra line." };
        yield { type: "done", content: "Extra line.", finish_reason: "stop" };
      },
      countTextImpl: async () => {
        throw new Error("tokenizer offline");
      },
    });
    const noTokBackend = registerBackend(noTokenizerHarness.api);
    await noTokBackend.runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "More" },
      "u1",
    );
    await noTokBackend.runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    const noTokEvents = noTokenizerHarness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(noTokEvents[1]).toEqual({
      type: "gg:generation_metrics",
      chatId: "chat-1",
      messageId: "m2",
      swipeId: 0,
      tokenCount: null,
      generationMetrics: null,
    });
  });

  test("aborted, errored, and impersonate runs do not emit gg:generation_metrics", async () => {
    const abortHarness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Start" })],
      },
      rawStreamImpl: async function* ({ signal }) {
        yield { type: "token", token: "Partial " };
        abortBackend.runner.abortCurrent("u1");
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        yield { type: "done", content: "Partial ", finish_reason: "stop" };
      },
    });
    const abortBackend = registerBackend(abortHarness.api);
    const abortRes = await abortBackend.runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Go" },
      "u1",
    );
    expect(abortRes.aborted).toBe(true);
    expect(
      abortHarness.sentFrontend.some(
        (e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics",
      ),
    ).toBe(false);

    const errHarness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Start" })],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Partial " };
        throw new Error("Upstream stream crash");
      },
    });
    const errBackend = registerBackend(errHarness.api);
    await expect(
      errBackend.runner.run(
        { actionId: "guided_response", chatId: "chat-1", inputText: "Go" },
        "u1",
      ),
    ).rejects.toThrow("Upstream stream crash");
    expect(
      errHarness.sentFrontend.some(
        (e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics",
      ),
    ).toBe(false);

    const impHarness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Start" })],
      },
    });
    const impBackend = registerBackend(impHarness.api);
    await impBackend.runner.run(
      { actionId: "guided_impersonate", chatId: "chat-1", inputText: "Act cool" },
      "u1",
    );
    expect(
      impHarness.sentFrontend.some(
        (e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics",
      ),
    ).toBe(false);
  });

  test("emitMetricsForCompletedStream passes hasDelimitedReasoning when <think>...</think> is in rawDeltaText", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Think and answer." })],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "<think>hidden chain of thought</think>" };
        await new Promise((r) => setTimeout(r, 35));
        yield { type: "token", token: "Visible answer." };
        yield {
          type: "done",
          content: "<think>hidden chain of thought</think>Visible answer.",
          finish_reason: "stop",
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5000,
            total_tokens: 5010,
          },
        };
      },
      countTextImpl: async () => ({ total_tokens: 4 }),
    });
    const { runner } = registerBackend(harness.api);

    const res = await runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Solve carefully" },
      "u1",
    );

    expect(harness.countTextCalls).toHaveLength(1);
    expect(harness.countTextCalls[0]?.text).toBe(
      "<think>hidden chain of thought</think>Visible answer.",
    );

    const metricEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(metricEvents).toHaveLength(1);
    const evt = metricEvents[0]!;
    expect(res.messageId).toBeDefined();
    expect(evt.messageId).toBe(res.messageId!);
    expect(evt.tokenCount).toBe(5000);
    expect(evt.generationMetrics?.tps).toBeGreaterThan(0);
    expect(evt.generationMetrics?.tps).toBeLessThan(1000);
  });
});

describe("Step 1 audit regression tests", () => {
  test("save_settings lowering inputRecovery.maxEntries trims persisted recovery on disk and cache and emits gg:recovery-updated", async () => {
    const harness = createSpindleHarness();
    const { store, handleRpc } = registerBackend(harness.api);

    for (const text of ["first", "second", "third", "fourth"]) {
      await store.pushRecovery({ text, actionId: "guided_response", chatId: "chat-1" }, "u1");
    }
    expect((await store.getRecovery("u1")).map((e) => e.text)).toEqual([
      "fourth",
      "third",
      "second",
      "first",
    ]);

    harness.sentFrontend.length = 0;
    const lowered = await store.getSettings("u1");
    lowered.inputRecovery.maxEntries = 2;

    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "save-trim-1",
        action: "save_settings",
        input: lowered,
      },
      "u1",
    );

    expect((await store.getRecovery("u1")).map((e) => e.text)).toEqual(["fourth", "third"]);

    const diskRecovery = JSON.parse(harness.userFiles.get("u1")!.get("recovery.json")!) as Array<{
      text: string;
    }>;
    expect(diskRecovery.map((e) => e.text)).toEqual(["fourth", "third"]);

    const freshStore = new SettingsStore(harness.api);
    expect((await freshStore.getRecovery("u1")).map((e) => e.text)).toEqual(["fourth", "third"]);

    const recoveryEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:recovery-updated")
      .map((e) => e.payload as BackendPushEvent);
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0]?.recovery?.map((e) => e.text)).toEqual(["fourth", "third"]);
    expect(
      harness.sentFrontend.some((e) => (e.payload as BackendPushEvent).type === "gg:changed"),
    ).toBe(false);

    // Raising maxEntries afterward does not resurrect pruned entries or emit gg:recovery-updated
    harness.sentFrontend.length = 0;
    const raised = await store.getSettings("u1");
    raised.inputRecovery.maxEntries = 10;
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "save-raise-1",
        action: "save_settings",
        input: raised,
      },
      "u1",
    );
    expect((await store.getRecovery("u1")).map((e) => e.text)).toEqual(["fourth", "third"]);
    expect(
      harness.sentFrontend.some(
        (e) => (e.payload as BackendPushEvent).type === "gg:recovery-updated",
      ),
    ).toBe(false);
  });

  test("restoreTrailingAssistant preserves multi-swipe reasoningBySwipe/reasoningDurationBySwipe and rebinds continue-history to restored.id", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Swipe one",
            swipes: ["Swipe zero", "Swipe one"],
            swipe_id: 1,
            swipe_dates: [1700000000, 1700000100],
            extra: {
              reasoningBySwipe: ["Thought 0", "Thought 1"],
              reasoningDurationBySwipe: [1.5, 2.75],
              reasoning: "Thought 1",
              reasoningDuration: 2.75,
            },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        throw new Error("Provider failed before token 1");
      },
    });
    const { store, runner } = registerBackend(harness.api);

    await store.pushContinueEntry(
      {
        chatId: "chat-1",
        messageId: "m2",
        swipeIndex: 1,
        baseText: "Base one",
        resultText: "Swipe one",
        baseReasoning: "Base thought 1",
        baseReasoningDuration: 1.25,
        inputText: "continue note",
      },
      "u1",
    );

    await expect(
      runner.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "Try again" }, "u1"),
    ).rejects.toThrow("Provider failed before token 1");

    const restored = harness.chatMessages.get("chat-1")![1]!;
    expect(restored.id).not.toBe("m2");
    expect(restored.swipes).toEqual(["Swipe zero", "Swipe one"]);
    expect(restored.swipe_id).toBe(1);
    expect(restored.content).toBe("Swipe one");
    expect(restored.extra.reasoningBySwipe).toEqual(["Thought 0", "Thought 1"]);
    expect(restored.extra.reasoningDurationBySwipe).toEqual([1.5, 2.75]);

    expect(await store.peekContinueEntry("chat-1", "m2", 1, "u1")).toBeNull();
    const rebound = await store.peekContinueEntry("chat-1", restored.id, 1, "u1");
    expect(rebound).not.toBeNull();
    expect(rebound?.messageId).toBe(restored.id);
    expect(rebound?.baseText).toBe("Base one");

    const removed = await runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    expect(removed.messageId).toBe(restored.id);
    expect(removed.text).toBe("Base one");
  });

  test("abortCurrent cancels a run while still in the pendingUsers startup window", async () => {
    let releaseChatLookup!: () => void;
    const chatLookupGate = new Promise<void>((resolve) => {
      releaseChatLookup = resolve;
    });
    let notifyLookupEntered!: () => void;
    const lookupEntered = new Promise<void>((resolve) => {
      notifyLookupEntered = resolve;
    });

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hello" })],
      },
    });
    const origChatsGet = harness.api.chats.get;
    harness.api.chats.get = async (chatId, userId) => {
      notifyLookupEntered();
      await chatLookupGate;
      return origChatsGet(chatId, userId);
    };

    const { runner } = registerBackend(harness.api);

    const runPromise = runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );
    await lookupEntered;

    expect(runner.getActiveRun("u1")).toBeNull();
    expect(runner.abortCurrent("u1")).toBe(true);
    releaseChatLookup();

    const res = await runPromise;
    expect(res.aborted).toBe(true);
    expect(res.text).toBe("");
    expect(harness.dryRunCalls).toHaveLength(0);
    expect(harness.rawStreamCalls).toHaveLength(0);
    expect(harness.chatMessages.get("chat-1")).toHaveLength(1);
    expect(runner.getActiveRun("u1")).toBeNull();
  });

  test("removeLastContinue rejects edits when entry.baseText is empty while allowing compatible tail edits for non-empty baseText", async () => {
    let streamCount = 0;
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Start" }),
          makeMessage({ id: "m2", role: "assistant", content: "", swipes: [""], swipe_id: 0 }),
        ],
      },
      rawStreamImpl: async function* () {
        streamCount += 1;
        const text = streamCount === 1 ? "From empty base." : "Tail continuation.";
        yield { type: "token", token: text };
        yield { type: "done", content: text, finish_reason: "stop" };
      },
    });
    const { store, runner } = registerBackend(harness.api);

    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Continue empty" },
      "u1",
    );
    const emptyBaseMsg = harness.chatMessages.get("chat-1")![1]!;
    expect(emptyBaseMsg.content).toBe("From empty base.");

    emptyBaseMsg.content = "From empty base. Edited manually!";
    emptyBaseMsg.swipes[0] = "From empty base. Edited manually!";
    await expect(runner.removeLastContinue({ chatId: "chat-1" }, "u1")).rejects.toThrow(
      "The message was edited after the last continue; cannot safely remove it.",
    );
    expect((await store.peekContinueEntry("chat-1", "m2", 0, "u1"))?.baseText).toBe("");

    // Non-empty baseText still allows compatible tail edits starting with entry.baseText
    harness.chatMessages.set("chat-1", [
      makeMessage({ id: "m1", role: "user", content: "Start" }),
      makeMessage({
        id: "m3",
        role: "assistant",
        content: "Existing start.",
        swipes: ["Existing start."],
        swipe_id: 0,
      }),
    ]);
    await runner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "Continue non-empty" },
      "u1",
    );
    const nonEmptyMsg = harness.chatMessages.get("chat-1")![1]!;
    expect(nonEmptyMsg.content).toBe("Existing start. Tail continuation.");

    nonEmptyMsg.content = "Existing start. User tweaked tail.";
    nonEmptyMsg.swipes[0] = "Existing start. User tweaked tail.";
    const removed = await runner.removeLastContinue({ chatId: "chat-1" }, "u1");
    expect(removed.text).toBe("Existing start.");
    expect(nonEmptyMsg.content).toBe("Existing start.");
  });

  test("executeImpersonate emits terminal done:true aborted:true chunk when rawStream throws", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hello" })],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Half drafted" };
        throw new Error("Impersonate stream boom");
      },
    });
    const { runner } = registerBackend(harness.api);

    await expect(
      runner.run(
        { actionId: "guided_impersonate", chatId: "chat-1", inputText: "Reply" },
        "u1",
      ),
    ).rejects.toThrow("Impersonate stream boom");

    const chunks = harness.sentFrontend
      .map((e) => e.payload as BackendPushEvent)
      .filter((e) => e.type === "gg:impersonate-chunk");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[chunks.length - 1]).toEqual({
      type: "gg:impersonate-chunk",
      chatId: "chat-1",
      text: "Half drafted",
      done: true,
      aborted: true,
    });
  });

  test("allows concurrent runs across different chats for the same user while blocking a duplicate run on the same chat and resolving character metadata", async () => {
    let releaseChatA!: () => void;
    const chatAGate = new Promise<void>((resolve) => {
      releaseChatA = resolve;
    });
    let notifyChatAStreaming!: () => void;
    const chatAStreaming = new Promise<void>((resolve) => {
      notifyChatAStreaming = resolve;
    });

    let releaseChatB!: () => void;
    const chatBGate = new Promise<void>((resolve) => {
      releaseChatB = resolve;
    });
    let notifyChatBStreaming!: () => void;
    const chatBStreaming = new Promise<void>((resolve) => {
      notifyChatBStreaming = resolve;
    });

    let streamCallIndex = 0;
    const harness = createSpindleHarness({
      chats: {
        "chat-a": [makeMessage({ id: "ma-1", chat_id: "chat-a", role: "user", content: "Hello A" })],
        "chat-b": [makeMessage({ id: "mb-1", chat_id: "chat-b", role: "user", content: "Hello B" })],
      },
      chatCharacterIds: {
        "chat-a": "char-alpha",
        "chat-b": "char-beta",
      },
      rawStreamImpl: async function* () {
        streamCallIndex += 1;
        if (streamCallIndex === 1) {
          yield { type: "token", token: "Alpha streaming..." };
          notifyChatAStreaming();
          await chatAGate;
          yield { type: "token", token: " done." };
          yield { type: "done", content: "Alpha streaming... done.", finish_reason: "stop" };
        } else {
          yield { type: "token", token: "Beta streaming..." };
          notifyChatBStreaming();
          await chatBGate;
          yield { type: "token", token: " finished." };
          yield { type: "done", content: "Beta streaming... finished.", finish_reason: "stop" };
        }
      },
    });
    (harness.api as unknown as {
      characters: { get: (id: string) => Promise<{ id: string; name: string } | null> };
    }).characters = {
      get: async (id: string) => {
        if (id === "char-alpha") return { id, name: "Alpha Hero" };
        if (id === "char-beta") return { id, name: "Beta Companion" };
        return null;
      },
    };

    const { runner, buildBootstrapView, handleRpc } = registerBackend(harness.api);

    // 1. Start guided_response in chat-a
    const runAPromise = runner.run(
      { actionId: "guided_response", chatId: "chat-a", inputText: "Guide A" },
      "u1",
    );
    await chatAStreaming;

    const activeA = runner.getActiveRun("u1", "chat-a");
    expect(activeA).not.toBeNull();
    expect(activeA?.chatId).toBe("chat-a");
    expect(activeA?.characterId).toBe("char-alpha");
    expect(activeA?.characterName).toBe("Alpha Hero");
    expect(activeA?.avatarUrl).toBe("/api/v1/characters/char-alpha/avatar?thumb=1");
    expect(activeA?.hasContentOutput).toBe(true);
    expect(runner.getActiveRun("u1", "chat-b")).toBeNull();

    // 2. Starting a second action in chat-a while chat-a is running is rejected
    await expect(
      runner.run({ actionId: "guided_response", chatId: "chat-a", inputText: "Duplicate A" }, "u1"),
    ).rejects.toThrow(
      "A Guided Generations action is already running. Stop it before starting another.",
    );

    // 3. Starting a concurrent action in chat-b for the same user succeeds
    const runBPromise = runner.run(
      { actionId: "guided_response", chatId: "chat-b", inputText: "Guide B" },
      "u1",
    );
    await chatBStreaming;

    const allActive = runner.getActiveRuns("u1");
    expect(allActive).toHaveLength(2);
    expect(allActive.map((r) => r.chatId).sort()).toEqual(["chat-a", "chat-b"]);

    const bootstrap = await buildBootstrapView("u1");
    expect(bootstrap.activeRuns).toHaveLength(2);
    expect(bootstrap.activeRuns?.find((r) => r.chatId === "chat-b")?.characterName).toBe(
      "Beta Companion",
    );

    // 4. Finish chat-a while chat-b continues running
    releaseChatA();
    const resA = await runAPromise;
    expect(resA.chatId).toBe("chat-a");
    expect(resA.aborted).toBe(false);
    expect(resA.text).toBe("Alpha streaming... done.");
    expect(harness.chatMessages.get("chat-a")?.at(-1)?.content).toBe("Alpha streaming... done.");

    expect(runner.getActiveRun("u1", "chat-a")).toBeNull();
    expect(runner.getActiveRun("u1", "chat-b")?.chatId).toBe("chat-b");

    // Check terminal gg:status for chat-a carries chatId: "chat-a", done: true, and remaining run for chat-b
    const statusEvents = harness.sentFrontend
      .map((e) => e.payload as BackendPushEvent)
      .filter((e) => e.type === "gg:status");
    const chatATerminal = statusEvents.find(
      (e) => e.chatId === "chat-a" && e.done === true && e.aborted === false,
    );
    expect(chatATerminal).toBeDefined();
    expect(chatATerminal?.run?.chatId).toBe("chat-b");

    // 5. Abort chat-b specifically by runId via abort_action RPC
    const activeB = runner.getActiveRun("u1", "chat-b")!;
    await handleRpc(
      {
        type: "gg:rpc",
        requestId: "abort-b",
        action: "abort_action",
        input: { runId: activeB.runId },
      },
      "u1",
    );
    releaseChatB();
    const resB = await runBPromise;
    expect(resB.chatId).toBe("chat-b");
    expect(resB.aborted).toBe(true);
    expect(runner.getActiveRuns("u1")).toHaveLength(0);
  });
});

describe("audit regression tests (backend)", () => {
  test("restoreTrailingAssistant never sends both reasoning and swipe_reasoning and filters invalid durations", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Prompt" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Swipe 1 content",
            swipes: ["Swipe 0 content", "Swipe 1 content"],
            swipe_id: 1,
            swipe_dates: [1700000000, 1700000010],
            extra: {
              reasoningBySwipe: ["Thought 0", "Thought 1"],
              reasoningDurationBySwipe: [150, Number.NaN],
              reasoning: "Thought 1",
              reasoningDuration: Number.NaN,
            },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "done", content: "", finish_reason: "stop" };
      },
    });

    const { runner } = registerBackend(harness.api);
    const res = await runner.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "" }, "u1");
    expect(res.text).toBe("");

    // Every updateMessage call must satisfy host invariant (never both reasoning & swipe_reasoning)
    for (const call of harness.updateMessageCalls) {
      expect(
        call.patch.reasoning !== undefined && call.patch.swipe_reasoning !== undefined,
      ).toBe(false);
    }

    const restored = harness.chatMessages.get("chat-1")?.at(-1);
    expect(restored?.swipes).toEqual(["Swipe 0 content", "Swipe 1 content"]);
    expect(restored?.swipe_id).toBe(1);
    expect(restored?.extra?.reasoningBySwipe).toEqual(["Thought 0", "Thought 1"]);
    expect(restored?.extra?.reasoningDurationBySwipe).toEqual([150, null]);
  });

  test("characters permission=false skips spindle.characters.get and reports permission false", async () => {
    let charactersGetCalls = 0;
    const harness = createSpindleHarness({
      permissions: { characters: false },
      chatCharacterIds: { "chat-1": "char-1" },
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hi" })],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Hello" };
        yield { type: "done", content: "Hello", finish_reason: "stop" };
      },
    });
    (harness.api as unknown as { characters: { get: (id: string) => Promise<unknown> } }).characters = {
      get: async () => {
        charactersGetCalls += 1;
        return { id: "char-1", name: "Should Not Be Fetched" };
      },
    };

    const { runner, buildBootstrapView } = registerBackend(harness.api);
    const view = await buildBootstrapView("u1");
    expect(view.permissions.characters).toBe(false);

    await runner.run({ actionId: "guided_response", chatId: "chat-1", inputText: "Steer" }, "u1");
    expect(charactersGetCalls).toBe(0);
    const statusEvents = harness.sentFrontend
      .map((e) => e.payload as BackendPushEvent)
      .filter((e) => e.type === "gg:status" && e.run);
    expect(statusEvents[0]?.run?.characterName).toBeUndefined();
  });

  test("guided_continue streamIntoMessage preserves base reasoning/duration when continuation emits no reasoning and updates duration when new reasoning arrives", async () => {
    // Case A: continuation has no reasoning -> base reasoning & base duration preserved
    const harnessNoReasoning = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base text",
            swipes: ["Base text"],
            swipe_id: 0,
            extra: { reasoning: "Base thought", reasoningDuration: 420 },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: " continued." };
        yield { type: "done", content: " continued.", finish_reason: "stop" };
      },
    });

    const { runner: runnerA } = registerBackend(harnessNoReasoning.api);
    await runnerA.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "" }, "u1");
    const msgA = harnessNoReasoning.chatMessages.get("chat-1")?.at(-1);
    expect(msgA?.extra?.reasoning).toBe("Base thought");
    expect(msgA?.extra?.reasoningDuration).toBe(420);

    // Case B: continuation produces new reasoning -> reasoningDuration updated (not stale 420)
    const harnessWithReasoning = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base text",
            swipes: ["Base text"],
            swipe_id: 0,
            extra: { reasoning: "Base thought", reasoning_duration: 99999 },
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "reasoning", token: "New thought" };
        yield { type: "token", token: " continued." };
        yield { type: "done", content: " continued.", finish_reason: "stop" };
      },
    });

    const { runner: runnerB } = registerBackend(harnessWithReasoning.api);
    await runnerB.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "" }, "u1");
    const msgB = harnessWithReasoning.chatMessages.get("chat-1")?.at(-1);
    expect(msgB?.extra?.reasoning).toBe("New thought");
    expect(typeof msgB?.extra?.reasoning_duration).toBe("number");
    expect((msgB?.extra?.reasoning_duration as number)).toBeLessThan(99999);
  });

  test("regenerateLastContinue runs ensureTarget (restorePreRegenMessage) before onFirstOutput and aborted flush error does not corrupt continue-history", async () => {
    const callOrder: string[] = [];
    let failFinalFlush = false;

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base text old continuation",
            swipes: ["Base text old continuation"],
            swipe_id: 0,
          }),
        ],
      },
      updateMessageImpl: async (_chatId, _messageId, patch, defaultUpdate) => {
        if (patch.content === "Base text") {
          callOrder.push("restorePreRegen");
        } else if (typeof patch.content === "string" && patch.content.includes("partial")) {
          callOrder.push("flushStream");
          if (failFinalFlush && patch.skipChunkRebuild === false) {
            throw new Error("Simulated final flush failure");
          }
        }
        await defaultUpdate();
      },
      rawStreamImpl: async function* ({ signal }) {
        callOrder.push("streamStart");
        yield { type: "token", token: " partial" };
        if (signal?.aborted) {
          throw new Error("AbortError");
        }
        yield { type: "done", content: " partial", finish_reason: "stop" };
      },
    });

    const { runner, store } = registerBackend(harness.api);
    await store.pushContinueEntry(
      {
        chatId: "chat-1",
        messageId: "m2",
        swipeIndex: 0,
        baseText: "Base text",
        resultText: "Base text old continuation",
        baseReasoning: null,
        baseReasoningDuration: null,
        inputText: "keep going",
      },
      "u1",
    );

    // 1. Normal regenerateLastContinue ensures restorePreRegen happens before first stream flush
    await runner.regenerateLastContinue({ chatId: "chat-1" }, "u1");
    expect(callOrder.indexOf("restorePreRegen")).toBeGreaterThan(-1);
    expect(callOrder.indexOf("flushStream")).toBeGreaterThan(callOrder.indexOf("restorePreRegen"));

    // 2. Final flush failure on abort throws and preserves prior continue-history entry (never writes unpersisted text)
    failFinalFlush = true;
    const beforeHistory = await store.getContinueHistory("u1");
    const harnessAbort = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hi" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Base text",
            swipes: ["Base text"],
            swipe_id: 0,
          }),
        ],
      },
      updateMessageImpl: async (_chatId, _messageId, patch, defaultUpdate) => {
        if (patch.skipChunkRebuild === false) {
          throw new Error("Final flush persistence failed");
        }
        await defaultUpdate();
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: " unpersisted" };
        runnerAbort.abortCurrent("u1");
        yield { type: "done", content: " unpersisted", finish_reason: "stop" };
      },
    });
    const { runner: runnerAbort, store: storeAbort } = registerBackend(harnessAbort.api);
    await expect(
      runnerAbort.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "" }, "u1"),
    ).rejects.toThrow("Final flush persistence failed");
    expect(await storeAbort.getContinueHistory("u1")).toEqual([]);
    expect(beforeHistory).toHaveLength(1);
  });

  test("promptPostProcessing='single' strips rejected/trailing history from capturedMessages before collapsing to single role", async () => {
    // 1. guided_response with promptPostProcessing='single' (system) collapses captured messages + guidance
    let capturedPrompt: Array<{ role: string; content: unknown }> = [];
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({ id: "m2", role: "assistant", content: "Hi there" }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main", __chatHistorySource: false },
          { role: "user", content: "Hello", __chatHistorySource: true, __sourceMessageId: "m1" },
          { role: "assistant", content: "Hi there", __chatHistorySource: true, __sourceMessageId: "m2" },
        ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>,
      },
      dryRunImpl: async () => ({
        request_messages: [
          { role: "system", content: "Collapsed Single System Prompt" },
        ],
        parameters: { model: "gpt-4" },
      }),
      rawStreamImpl: async function* (input) {
        capturedPrompt = (input.messages as Array<{ role: string; content: unknown }>) ?? [];
        yield { type: "token", token: "Done" };
        yield { type: "done", content: "Done", finish_reason: "stop" };
      },
    });

    const { runner } = registerBackend(harness.api);
    await runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Guide single" },
      "u1",
    );

    expect(capturedPrompt).toHaveLength(1);
    expect(capturedPrompt[0]?.role).toBe("system");
    expect(capturedPrompt[0]?.content).toBe(
      "Main\n\nHello\n\nHi there\n\n[OOC Guidance for the next response: Guide single]",
    );

    // 2. guided_swipe with promptPostProcessing='single' strips rejected turn & unshifts depth=1 before collapsing
    let swipeSinglePrompt: Array<{ role: string; content: unknown }> = [];
    const swipeSingleHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Rejected swipe",
            swipes: ["Rejected swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main", __chatHistorySource: false },
          { role: "user", content: "Hello", __chatHistorySource: true, __sourceMessageId: "m1" },
          { role: "system", content: "Depth 1", __chatHistorySource: false },
          { role: "assistant", content: "Rejected swipe", __chatHistorySource: true, __sourceMessageId: "m2" },
          { role: "assistant", content: "Post assistant", __chatHistorySource: false },
        ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>,
      },
      dryRunImpl: async () => ({
        request_messages: [{ role: "system", content: "Collapsed Single System Prompt" }],
        parameters: { model: "gpt-4" },
      }),
      rawStreamImpl: async function* (input) {
        swipeSinglePrompt = (input.messages as Array<{ role: string; content: unknown }>) ?? [];
        yield { type: "token", token: "Fresh" };
        yield { type: "done", content: "Fresh", finish_reason: "stop" };
      },
    });
    const { runner: swipeSingleRunner } = registerBackend(swipeSingleHarness.api);
    await swipeSingleRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(swipeSinglePrompt).toHaveLength(1);
    expect(swipeSinglePrompt[0]?.role).toBe("system");
    expect(swipeSinglePrompt[0]?.content).toBe("Main\n\nDepth 1\n\nHello\n\nPost assistant");

    // 3. collapseMessages=true (role: "user") also collapses stripped messages into a single user message
    let swipeCollapseUserPrompt: Array<{ role: string; content: unknown }> = [];
    const swipeUserHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Rejected swipe",
            swipes: ["Rejected swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main", __chatHistorySource: false },
          { role: "user", content: "Hello", __chatHistorySource: true, __sourceMessageId: "m1" },
          { role: "system", content: "Depth 1", __chatHistorySource: false },
          { role: "assistant", content: "Rejected swipe", __chatHistorySource: true, __sourceMessageId: "m2" },
        ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>,
      },
      dryRunImpl: async () => ({
        request_messages: [{ role: "user", content: "Collapsed Single User Prompt" }],
        parameters: { model: "gpt-4" },
      }),
      rawStreamImpl: async function* (input) {
        swipeCollapseUserPrompt = (input.messages as Array<{ role: string; content: unknown }>) ?? [];
        yield { type: "token", token: "Fresh" };
        yield { type: "done", content: "Fresh", finish_reason: "stop" };
      },
    });
    const { runner: swipeUserRunner } = registerBackend(swipeUserHarness.api);
    await swipeUserRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Keep calm" },
      "u1",
    );
    expect(swipeCollapseUserPrompt).toHaveLength(1);
    expect(swipeCollapseUserPrompt[0]?.role).toBe("user");
    expect(swipeCollapseUserPrompt[0]?.content).toBe(
      "Main\n\nDepth 1\n\nHello\n\n[OOC Guidance for this alternative response: Keep calm]",
    );
  });

  test("guided_swipe with empty inputText unshifts in_history depth=1 system prompt before latest user with post_history assistant-user-system", async () => {
    let sentMessages: Array<Record<string, unknown>> = [];
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
          makeMessage({
            id: "m4",
            role: "assistant",
            content: "Rejected swipe",
            swipes: ["Rejected swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main Prompt", __chatHistorySource: false },
          {
            role: "user",
            content: "Earlier user",
            __chatHistorySource: true,
            __sourceMessageId: "m1",
          },
          {
            role: "assistant",
            content: "Earlier assistant",
            __chatHistorySource: true,
            __sourceMessageId: "m2",
          },
          {
            role: "user",
            content: "Latest user",
            __chatHistorySource: true,
            __sourceMessageId: "m3",
          },
          { role: "system", content: "Depth 1 System", __chatHistorySource: false },
          {
            role: "assistant",
            content: "",
            __chatHistorySource: true,
            __sourceMessageId: "m4",
          },
          { role: "assistant", content: "Post assistant", __chatHistorySource: false },
          { role: "user", content: "Post user", __chatHistorySource: false },
          { role: "system", content: "Post system", __chatHistorySource: false },
        ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>,
      },
      dryRunImpl: async () => ({
        messages: [],
        request_messages: [
          { role: "system", content: "Main Prompt" },
          { role: "user", content: "Earlier user" },
          { role: "assistant", content: "Earlier assistant" },
          { role: "user", content: "Latest user" },
          { role: "system", content: "Depth 1 System" },
          { role: "assistant", content: "" },
          { role: "assistant", content: "Post assistant" },
          { role: "user", content: "Post user" },
          { role: "system", content: "Post system" },
        ],
        parameters: { temperature: 0.7 },
      }),
      rawStreamImpl: async function* (input) {
        sentMessages = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Replacement" };
        yield { type: "done", content: "Replacement", finish_reason: "stop" };
      },
    });

    const { runner } = registerBackend(harness.api);
    const res = await runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(res.text).toBe("Replacement");
    expect(sentMessages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:Main Prompt",
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "assistant:Post assistant",
      "user:Post user",
      "system:Post system",
    ]);
    for (const msg of sentMessages) {
      expect("__chatHistorySource" in msg).toBe(false);
      expect("__sourceMessageId" in msg).toBe(false);
    }
  });

  test("guided_swipe unshifts multi-depth blocks while preserving WI after h0 and depth=0/post_history, guided_response/guided_regenerate run dryRun cleanly without blank slot, and guided_continue does not unshift", async () => {
    const buildCleanMultiDepth = () =>
      [
        { role: "system", content: "Main", __chatHistorySource: false },
        { role: "system", content: "Depth 3", __chatHistorySource: false },
        { role: "user", content: "h0", __chatHistorySource: true, __sourceMessageId: "m1" },
        {
          role: "system",
          content: "WI anAfter",
          __chatHistorySource: false,
          __worldInfoSource: true,
        },
        { role: "system", content: "Depth 2", __chatHistorySource: false },
        { role: "assistant", content: "h1", __chatHistorySource: true, __sourceMessageId: "m2" },
        { role: "system", content: "Depth 1", __chatHistorySource: false },
        { role: "user", content: "h2", __chatHistorySource: true, __sourceMessageId: "m3" },
        { role: "system", content: "Depth 0", __chatHistorySource: false },
        { role: "system", content: "Post-History", __chatHistorySource: false },
      ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>;

    const buildMultiDepthWithSwipeTarget = (targetId: string) =>
      [
        { role: "system", content: "Main", __chatHistorySource: false },
        { role: "user", content: "h0", __chatHistorySource: true, __sourceMessageId: "m1" },
        {
          role: "system",
          content: "WI anAfter",
          __chatHistorySource: false,
          __worldInfoSource: true,
        },
        { role: "system", content: "Depth 3", __chatHistorySource: false },
        { role: "assistant", content: "h1", __chatHistorySource: true, __sourceMessageId: "m2" },
        { role: "system", content: "Depth 2", __chatHistorySource: false },
        { role: "user", content: "h2", __chatHistorySource: true, __sourceMessageId: "m3" },
        { role: "system", content: "Depth 1", __chatHistorySource: false },
        { role: "assistant", content: "Old swipe", __chatHistorySource: true, __sourceMessageId: targetId },
        { role: "system", content: "Depth 0", __chatHistorySource: false },
        { role: "system", content: "Post-History", __chatHistorySource: false },
      ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>;

    const expectedUnshifted = [
      "system:Main",
      "system:Depth 3",
      "user:h0",
      "system:WI anAfter",
      "system:Depth 2",
      "assistant:h1",
      "system:Depth 1",
      "user:h2",
      "system:Depth 0",
      "system:Post-History",
    ];

    // 1. guided_response (requires non-empty guidance) runs dryRun without a blank turn and injects guidance before post-history
    let responseSent: Array<Record<string, unknown>> = [];
    let responseDryRunChatLen = 0;
    const responseHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "h0" }),
          makeMessage({ id: "m2", role: "assistant", content: "h1" }),
          makeMessage({ id: "m3", role: "user", content: "h2" }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": buildCleanMultiDepth(),
      },
      dryRunImpl: async () => {
        responseDryRunChatLen = responseHarness.chatMessages.get("chat-1")!.length;
        return {
          messages: [],
          request_messages: buildCleanMultiDepth().map((m) => ({
            role: m.role,
            content: m.content,
          })),
          parameters: {},
        };
      },
      rawStreamImpl: async function* (input) {
        responseSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Resp" };
        yield { type: "done", content: "Resp", finish_reason: "stop" };
      },
    });
    const { runner: responseRunner } = registerBackend(responseHarness.api);
    await responseRunner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Be dramatic" },
      "u1",
    );
    expect(responseDryRunChatLen).toBe(3);
    expect(responseSent.map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:Main",
      "system:Depth 3",
      "user:h0",
      "system:WI anAfter",
      "system:Depth 2",
      "assistant:h1",
      "system:Depth 1",
      "user:h2",
      "system:[OOC Guidance for the next response: Be dramatic]",
      "system:Depth 0",
      "system:Post-History",
    ]);

    // 2. guided_regenerate with inputText: "" deletes m4 and runs dryRun cleanly without blank slot
    let regenSent: Array<Record<string, unknown>> = [];
    let regenDryRunChatLen = 0;
    const regenHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "h0" }),
          makeMessage({ id: "m2", role: "assistant", content: "h1" }),
          makeMessage({ id: "m3", role: "user", content: "h2" }),
          makeMessage({ id: "m4", role: "assistant", content: "Old reply" }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": buildCleanMultiDepth(),
      },
      dryRunImpl: async () => {
        regenDryRunChatLen = regenHarness.chatMessages.get("chat-1")!.length;
        return {
          messages: [],
          request_messages: buildCleanMultiDepth().map((m) => ({
            role: m.role,
            content: m.content,
          })),
          parameters: {},
        };
      },
      rawStreamImpl: async function* (input) {
        regenSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Regen" };
        yield { type: "done", content: "Regen", finish_reason: "stop" };
      },
    });
    const { runner: regenRunner } = registerBackend(regenHarness.api);
    await regenRunner.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(regenDryRunChatLen).toBe(3);
    expect(regenSent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedUnshifted);

    // 2b. guided_swipe with m4 in dryRun unshifts multi-depth blocks while preserving WI after h0 and depth=0/post_history
    let swipeSent: Array<Record<string, unknown>> = [];
    const swipeHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "h0" }),
          makeMessage({ id: "m2", role: "assistant", content: "h1" }),
          makeMessage({ id: "m3", role: "user", content: "h2" }),
          makeMessage({ id: "m4", role: "assistant", content: "Old swipe", swipes: ["Old swipe"], swipe_id: 0 }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": buildMultiDepthWithSwipeTarget("m4"),
      },
      dryRunImpl: async () => ({
        messages: [],
        request_messages: buildMultiDepthWithSwipeTarget("m4").map((m) => ({
          role: m.role,
          content: m.content,
        })),
        parameters: {},
      }),
      rawStreamImpl: async function* (input) {
        swipeSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Swiped" };
        yield { type: "done", content: "Swiped", finish_reason: "stop" };
      },
    });
    const { runner: swipeRunner } = registerBackend(swipeHarness.api);
    await swipeRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(swipeSent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedUnshifted);

    // 3. guided_continue does NOT unshift (finalizeContinuePrompt places depth=1 relative to continued turn)
    let continueSent: Array<Record<string, unknown>> = [];
    const continueHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "h0" }),
          makeMessage({ id: "m2", role: "assistant", content: "Continued start" }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main", __chatHistorySource: false },
          { role: "user", content: "h0", __chatHistorySource: true, __sourceMessageId: "m1" },
          { role: "system", content: "Depth 1", __chatHistorySource: false },
          {
            role: "assistant",
            content: "Continued start",
            __chatHistorySource: false,
            __sourceMessageId: "m2",
          },
          { role: "system", content: "[Continue Nudge]", __chatHistorySource: false },
        ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>,
      },
      dryRunImpl: async () => ({
        messages: [],
        request_messages: [
          { role: "system", content: "Main" },
          { role: "user", content: "h0" },
          { role: "system", content: "Depth 1" },
          { role: "assistant", content: "Continued start" },
          { role: "system", content: "[Continue Nudge]" },
        ],
        parameters: {},
      }),
      rawStreamImpl: async function* (input) {
        continueSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "more." };
        yield { type: "done", content: "more.", finish_reason: "stop" };
      },
    });
    const { runner: continueRunner } = registerBackend(continueHarness.api);
    await continueRunner.run(
      { actionId: "guided_continue", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(continueSent.map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:Main",
      "user:h0",
      "system:Depth 1",
      "assistant:Continued start",
      "system:[Continue Nudge]",
    ]);
  });

  test("promptPostProcessing='merge' uses unmerged capturedMessages to strip h_k before assistantPrefill/post-history, unshifts depth, and re-merges consecutive same-role messages", async () => {
    let sentMessages: Array<Record<string, unknown>> = [];
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Latest user" }),
          makeMessage({
            id: "m2",
            role: "assistant",
            content: "Old swipe",
            swipes: ["Old swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        "chat-1": [
          { role: "system", content: "Main Prompt", __chatHistorySource: false },
          {
            role: "user",
            content: "Latest user",
            __chatHistorySource: true,
            __sourceMessageId: "m1",
          },
          { role: "system", content: "Depth 1 System", __chatHistorySource: false },
          {
            role: "assistant",
            content: "",
            __chatHistorySource: true,
            __sourceMessageId: "m2",
          },
          {
            role: "assistant",
            content: "Post-history assistant",
            __chatHistorySource: false,
          },
          {
            role: "assistant",
            content: "Prefill...",
            partial: true,
            __chatHistorySource: false,
          },
        ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>,
      },
      // Simulate host applyPostProcessing('merge') having merged h_k (''), post-history assistant, and prefill:
      dryRunImpl: async () => ({
        messages: [],
        request_messages: [
          { role: "system", content: "Main Prompt" },
          { role: "user", content: "Latest user" },
          { role: "system", content: "Depth 1 System" },
          {
            role: "assistant",
            content: "\n\nPost-history assistant\n\nPrefill...",
            partial: true,
          },
        ],
        parameters: {},
      }),
      rawStreamImpl: async function* (input) {
        sentMessages = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Merged reply" };
        yield { type: "done", content: "Merged reply", finish_reason: "stop" };
      },
    });

    const { runner } = registerBackend(harness.api);
    await runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "" },
      "u1",
    );

    expect(sentMessages).toEqual([
      { role: "system", content: "Main Prompt\n\nDepth 1 System" },
      { role: "user", content: "Latest user" },
      {
        role: "assistant",
        content: "Post-history assistant\n\nPrefill...",
        partial: true,
      },
    ]);
  });

  test("SettingsStore prevents cold-read cache clobbering on concurrent write and preserves full recovery across maxEntries expansion", async () => {
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const files = new Map<string, string>([
      [
        "settings.json",
        JSON.stringify({
          toolbarPlacement: "inline",
          inputRecovery: { enabled: true, maxEntries: 2 },
        }),
      ],
      [
        "recovery.json",
        JSON.stringify([
          { id: "r1", text: "Draft 1", actionId: "guided_response", chatId: "c1", createdAt: 4 },
          { id: "r2", text: "Draft 2", actionId: "guided_response", chatId: "c1", createdAt: 3 },
          { id: "r3", text: "Draft 3", actionId: "guided_response", chatId: "c1", createdAt: 2 },
          { id: "r4", text: "Draft 4", actionId: "guided_response", chatId: "c1", createdAt: 1 },
        ]),
      ],
    ]);

    let delayFirstSettingsRead = true;
    const mockApi = {
      permissions: { has: () => false, onChanged: () => () => {} },
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
      userStorage: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => {
          if (path === "settings.json" && delayFirstSettingsRead) {
            delayFirstSettingsRead = false;
            await readGate;
          }
          return files.get(path) ?? "";
        },
        write: async (path: string, content: string) => {
          files.set(path, content);
        },
      },
    } as unknown as SpindleAPI;

    const store = new SettingsStore(mockApi);

    // 1. Start cold read (which stalls before completing), then write newer settings concurrently
    const coldReadPromise = store.getSettings("u1");
    await Promise.resolve();

    const updated = createDefaultSettings();
    updated.toolbarPlacement = "below_bar";
    updated.inputRecovery.maxEntries = 2;
    await store.saveSettings(updated, "u1");

    releaseRead();
    const resolvedCold = await coldReadPromise;
    expect(resolvedCold.toolbarPlacement).toBe("below_bar");
    expect((await store.getSettings("u1")).toolbarPlacement).toBe("below_bar");

    // 2. Reading recovery with maxEntries=2 on disk then expanding maxEntries=5 does not lose r3/r4
    const filesForRecovery = new Map<string, string>([
      [
        "settings.json",
        JSON.stringify({
          toolbarPlacement: "inline",
          inputRecovery: { enabled: true, maxEntries: 2 },
        }),
      ],
      [
        "recovery.json",
        JSON.stringify([
          { id: "r1", text: "Draft 1", actionId: "guided_response", chatId: "c1", createdAt: 4 },
          { id: "r2", text: "Draft 2", actionId: "guided_response", chatId: "c1", createdAt: 3 },
          { id: "r3", text: "Draft 3", actionId: "guided_response", chatId: "c1", createdAt: 2 },
          { id: "r4", text: "Draft 4", actionId: "guided_response", chatId: "c1", createdAt: 1 },
        ]),
      ],
    ]);
    const recoveryApi = {
      permissions: { has: () => false, onChanged: () => () => {} },
      log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
      userStorage: {
        exists: async (path: string) => filesForRecovery.has(path),
        read: async (path: string) => filesForRecovery.get(path) ?? "",
        write: async (path: string, content: string) => {
          filesForRecovery.set(path, content);
        },
      },
    } as unknown as SpindleAPI;
    const recoveryStore = new SettingsStore(recoveryApi);

    const twoEntries = await recoveryStore.getRecovery("u1");
    expect(twoEntries).toHaveLength(2);

    const expanded = createDefaultSettings();
    expanded.inputRecovery.maxEntries = 5;
    await recoveryStore.saveSettings(expanded, "u1");

    const allEntries = await recoveryStore.getRecovery("u1");
    expect(allEntries.map((e) => e.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  test("runner.dispose aborts active runs and clears state cleanly", async () => {
    let streamSignalAborted = false;
    let notifyStreaming!: () => void;
    const streamingStarted = new Promise<void>((resolve) => {
      notifyStreaming = resolve;
    });
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });

    const harness = createSpindleHarness({
      chats: { "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hi" })] },
      rawStreamImpl: async function* ({ signal }) {
        notifyStreaming();
        await streamGate;
        streamSignalAborted = Boolean(signal?.aborted);
        yield { type: "done", content: "", finish_reason: "stop" };
      },
    });

    const { runner } = registerBackend(harness.api);
    const runPromise = runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );
    await streamingStarted;
    expect(runner.getActiveRuns("u1")).toHaveLength(1);

    runner.dispose();
    expect(runner.getActiveRuns("u1")).toHaveLength(0);
    releaseStream();
    const res = await runPromise;
    expect(res.aborted).toBe(true);
    expect(streamSignalAborted).toBe(true);
  });

  test("Nemo Engine 30-block preset with hasNonEmptyContent-filtered dryRun preserves unmerged pre_history in none mode and handles merge, guided_response, and guided_regenerate", async () => {
    const preHistoryBlocks = Array.from({ length: 30 }, (_, idx) => ({
      role: "system" as const,
      content: `Nemo Block ${idx + 1}`,
    }));

    const lumiverseHasNonEmptyContent = (msg: {
      role: string;
      content: unknown;
      partial?: boolean;
    }): boolean => {
      if (typeof msg.content === "string") {
        return msg.content.trim().length > 0 || (msg.role === "assistant" && msg.partial === true);
      }
      if (Array.isArray(msg.content)) {
        return msg.content.length > 0;
      }
      return true;
    };

    const lumiverseApplyMerge = (
      msgs: Array<Record<string, unknown>>,
    ): Array<Record<string, unknown>> => {
      const merged: Array<Record<string, unknown>> = [];
      for (const msg of msgs) {
        const prev = merged[merged.length - 1];
        if (prev && prev.role === msg.role) {
          merged[merged.length - 1] = {
            ...prev,
            content: `${String(prev.content ?? "")}\n\n${String(msg.content ?? "")}`,
            ...(msg.partial === true ? { partial: true } : {}),
          };
        } else {
          merged.push({ ...msg });
        }
      }
      return merged;
    };

    const assembleNemoPrompt = (chatMsgs: ChatMessageWithRole[]) => {
      const pre = preHistoryBlocks.map((b) => ({
        role: b.role,
        content: b.content,
        __isChatHistory: false,
        __chatHistorySource: false,
      }));
      const depth1Block = {
        role: "system" as const,
        content: "Depth 1 System",
        __isChatHistory: false,
        __chatHistorySource: false,
      };
      const historyItems = chatMsgs.map((m) => ({
        role: (m.role ?? (m.is_user ? "user" : "assistant")) as "user" | "assistant" | "system",
        content: m.content,
        __isChatHistory: true,
        __chatHistorySource: true,
        sourceMessageId: m.id,
        __sourceMessageId: m.id,
      }));
      const insertAt = Math.max(0, historyItems.length - 1);
      const historyWithDepth = [
        ...historyItems.slice(0, insertAt),
        depth1Block,
        ...historyItems.slice(insertAt),
      ];
      return [
        ...pre,
        ...historyWithDepth,
        {
          role: "assistant" as const,
          content: "Depth 0 assistant",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
        {
          role: "user" as const,
          content: "Depth 0 user",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
        {
          role: "system" as const,
          content: "Trailing system",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
      ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>;
    };

    const buildDryRunResult = (
      captured: Array<Record<string, unknown>>,
      postProcessing: "none" | "merge",
    ) => {
      const processed =
        postProcessing === "merge" ? lumiverseApplyMerge(captured) : captured.map((m) => ({ ...m }));
      const requestMessages = processed.filter((m) =>
        lumiverseHasNonEmptyContent(m as { role: string; content: unknown; partial?: boolean }),
      );
      return {
        messages: [],
        request_messages: requestMessages,
        parameters: { temperature: 0.7 },
      };
    };

    const expectedBaseNone = [
      ...preHistoryBlocks.map((b) => `${b.role}:${b.content}`),
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "assistant:Depth 0 assistant",
      "user:Depth 0 user",
      "system:Trailing system",
    ];

    // 1. guided_swipe (none): a_target("") dropped in request_messages; pre_history stays 30 unmerged blocks
    let swipeNoneSent: Array<Record<string, unknown>> = [];
    let swipeNoneCapturedLen = 0;
    let swipeNoneRequestLen = 0;
    const swipeNoneHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
          makeMessage({
            id: "m4",
            role: "assistant",
            content: "Rejected swipe",
            swipes: ["Rejected swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        get "chat-1"() {
          const assembled = assembleNemoPrompt(swipeNoneHarness.chatMessages.get("chat-1")!);
          swipeNoneCapturedLen = assembled.length;
          return assembled;
        },
      },
      dryRunImpl: async () => {
        const assembled = assembleNemoPrompt(swipeNoneHarness.chatMessages.get("chat-1")!);
        const res = buildDryRunResult(
          assembled as unknown as Array<Record<string, unknown>>,
          "none",
        );
        swipeNoneRequestLen = res.request_messages.length;
        return res;
      },
      rawStreamImpl: async function* (input) {
        swipeNoneSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Replacement" };
        yield { type: "done", content: "Replacement", finish_reason: "stop" };
      },
    });
    const { runner: swipeNoneRunner } = registerBackend(swipeNoneHarness.api);
    expect(swipeNoneHarness.registerInterceptorCalls).toHaveLength(1);
    await swipeNoneRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "", backgroundSwipe: false },
      "u1",
    );
    expect(swipeNoneCapturedLen).toBe(38);
    expect(swipeNoneRequestLen).toBe(38);
    expect(swipeNoneSent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedBaseNone);
    for (const msg of swipeNoneSent) {
      expect("__isChatHistory" in msg).toBe(false);
      expect("__chatHistorySource" in msg).toBe(false);
      expect("sourceMessageId" in msg).toBe(false);
      expect("__sourceMessageId" in msg).toBe(false);
    }

    // 2. guided_swipe (merge): m4("Rejected swipe") merged with assistant(depth=0) in request_messages; reconciled via capturedMessages
    let swipeMergeSent: Array<Record<string, unknown>> = [];
    const swipeMergeHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
          makeMessage({
            id: "m4",
            role: "assistant",
            content: "Rejected swipe",
            swipes: ["Rejected swipe"],
            swipe_id: 0,
          }),
        ],
      },
      interceptorMessagesByChat: {
        get "chat-1"() {
          return assembleNemoPrompt(swipeMergeHarness.chatMessages.get("chat-1")!);
        },
      },
      dryRunImpl: async () => {
        const assembled = assembleNemoPrompt(swipeMergeHarness.chatMessages.get("chat-1")!);
        return buildDryRunResult(assembled as unknown as Array<Record<string, unknown>>, "merge");
      },
      rawStreamImpl: async function* (input) {
        swipeMergeSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Merged" };
        yield { type: "done", content: "Merged", finish_reason: "stop" };
      },
    });
    const { runner: swipeMergeRunner } = registerBackend(swipeMergeHarness.api);
    await swipeMergeRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "", backgroundSwipe: false },
      "u1",
    );
    expect(swipeMergeSent.map((m) => `${m.role}:${m.content}`)).toEqual([
      `system:${preHistoryBlocks.map((b) => b.content).join("\n\n")}`,
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "assistant:Depth 0 assistant",
      "user:Depth 0 user",
      "system:Trailing system",
    ]);

    // 3. guided_response (none): dryRun runs cleanly on 3-turn history without blank slot
    let responseSent: Array<Record<string, unknown>> = [];
    let responseCapturedLen = 0;
    let responseRequestLen = 0;
    const responseHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
        ],
      },
      interceptorMessagesByChat: {
        get "chat-1"() {
          const assembled = assembleNemoPrompt(responseHarness.chatMessages.get("chat-1")!);
          responseCapturedLen = assembled.length;
          return assembled;
        },
      },
      dryRunImpl: async () => {
        const assembled = assembleNemoPrompt(responseHarness.chatMessages.get("chat-1")!);
        const res = buildDryRunResult(
          assembled as unknown as Array<Record<string, unknown>>,
          "none",
        );
        responseRequestLen = res.request_messages.length;
        return res;
      },
      rawStreamImpl: async function* (input) {
        responseSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Response" };
        yield { type: "done", content: "Response", finish_reason: "stop" };
      },
    });
    const { runner: responseRunner } = registerBackend(responseHarness.api);
    await responseRunner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Focus on tension" },
      "u1",
    );
    expect(responseCapturedLen).toBe(37);
    expect(responseRequestLen).toBe(37);
    expect(responseSent.map((m) => `${m.role}:${m.content}`)).toEqual([
      ...preHistoryBlocks.map((b) => `${b.role}:${b.content}`),
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "system:[OOC Guidance for the next response: Focus on tension]",
      "assistant:Depth 0 assistant",
      "user:Depth 0 user",
      "system:Trailing system",
    ]);

    // 4. guided_regenerate (none): dryRun runs cleanly after deleting m4 and before creating blank slot
    let regenSent: Array<Record<string, unknown>> = [];
    let regenCapturedLen = 0;
    let regenRequestLen = 0;
    const regenHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
          makeMessage({ id: "m4", role: "assistant", content: "Old reply" }),
        ],
      },
      interceptorMessagesByChat: {
        get "chat-1"() {
          const assembled = assembleNemoPrompt(regenHarness.chatMessages.get("chat-1")!);
          regenCapturedLen = assembled.length;
          return assembled;
        },
      },
      dryRunImpl: async () => {
        const assembled = assembleNemoPrompt(regenHarness.chatMessages.get("chat-1")!);
        const res = buildDryRunResult(
          assembled as unknown as Array<Record<string, unknown>>,
          "none",
        );
        regenRequestLen = res.request_messages.length;
        return res;
      },
      rawStreamImpl: async function* (input) {
        regenSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Regenerated" };
        yield { type: "done", content: "Regenerated", finish_reason: "stop" };
      },
    });
    const { runner: regenRunner } = registerBackend(regenHarness.api);
    await regenRunner.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(regenCapturedLen).toBe(37);
    expect(regenRequestLen).toBe(37);
    expect(regenSent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedBaseNone);
  });

  test("Nemo Engine 30-block preset with hasNonEmptyContent-filtered dryRun and interceptor: false defers blanking/creation cleanly for guided_swipe, guided_response, and guided_regenerate", async () => {
    const preHistoryBlocks = Array.from({ length: 30 }, (_, idx) => ({
      role: "system" as const,
      content: `Nemo Block ${idx + 1}`,
    }));

    const lumiverseHasNonEmptyContent = (msg: {
      role: string;
      content: unknown;
      partial?: boolean;
    }): boolean => {
      if (typeof msg.content === "string") {
        return msg.content.trim().length > 0 || (msg.role === "assistant" && msg.partial === true);
      }
      if (Array.isArray(msg.content)) {
        return msg.content.length > 0;
      }
      return true;
    };

    const assembleFilteredRequestMessages = (chatMsgs: ChatMessageWithRole[]) => {
      const pre = preHistoryBlocks.map((b) => ({
        role: b.role,
        content: b.content,
        __isChatHistory: false,
        __chatHistorySource: false,
      }));
      const depth1Block = {
        role: "system" as const,
        content: "Depth 1 System",
        __isChatHistory: false,
        __chatHistorySource: false,
      };
      const historyItems = chatMsgs.map((m) => ({
        role: (m.role ?? (m.is_user ? "user" : "assistant")) as "user" | "assistant" | "system",
        content: m.content,
        __isChatHistory: true,
        __chatHistorySource: true,
        sourceMessageId: m.id,
        __sourceMessageId: m.id,
      }));
      const insertAt = Math.max(0, historyItems.length - 1);
      const assembled = [
        ...pre,
        ...historyItems.slice(0, insertAt),
        depth1Block,
        ...historyItems.slice(insertAt),
        {
          role: "assistant" as const,
          content: "Depth 0 assistant",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
        {
          role: "user" as const,
          content: "Depth 0 user",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
        {
          role: "system" as const,
          content: "Trailing system",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
      ];
      return assembled.filter((m) => lumiverseHasNonEmptyContent(m));
    };

    const expectedBase = [
      ...preHistoryBlocks.map((b) => `${b.role}:${b.content}`),
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "assistant:Depth 0 assistant",
      "user:Depth 0 user",
      "system:Trailing system",
    ];

    // 1. guided_swipe with interceptor: false
    let swipeSent: Array<Record<string, unknown>> = [];
    let swipeTargetContentAtDryRun = "";
    let swipeTargetAtStream: ChatMessageWithRole | undefined;
    const swipeHarness = createSpindleHarness({
      permissions: { interceptor: false },
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
          makeMessage({
            id: "m4",
            role: "assistant",
            content: "Rejected swipe",
            swipes: ["Rejected swipe"],
            swipe_id: 0,
          }),
        ],
      },
      dryRunImpl: async () => {
        const msgs = swipeHarness.chatMessages.get("chat-1")!;
        swipeTargetContentAtDryRun = msgs[msgs.length - 1]!.content;
        return {
          messages: [],
          request_messages: assembleFilteredRequestMessages(msgs),
          parameters: { temperature: 0.7 },
        };
      },
      rawStreamImpl: async function* (input) {
        const msgs = swipeHarness.chatMessages.get("chat-1")!;
        swipeTargetAtStream = { ...msgs[msgs.length - 1]!, swipes: [...msgs[msgs.length - 1]!.swipes] };
        swipeSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Swiped" };
        yield { type: "done", content: "Swiped", finish_reason: "stop" };
      },
    });
    const { runner: swipeRunner } = registerBackend(swipeHarness.api);
    expect(swipeHarness.registerInterceptorCalls).toHaveLength(0);
    await swipeRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "", backgroundSwipe: false },
      "u1",
    );
    expect(swipeTargetContentAtDryRun).toBe("Rejected swipe");
    expect(swipeTargetAtStream?.swipe_id).toBe(1);
    expect(swipeTargetAtStream?.swipes).toEqual(["Rejected swipe", ""]);
    expect(swipeSent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedBase);

    // 2. guided_response with interceptor: false
    let responseSent: Array<Record<string, unknown>> = [];
    let responseChatLenAtDryRun = 0;
    let responseChatLenAtStream = 0;
    const responseHarness = createSpindleHarness({
      permissions: { interceptor: false },
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
        ],
      },
      dryRunImpl: async () => {
        const msgs = responseHarness.chatMessages.get("chat-1")!;
        responseChatLenAtDryRun = msgs.length;
        return {
          messages: [],
          request_messages: assembleFilteredRequestMessages(msgs),
          parameters: { temperature: 0.7 },
        };
      },
      rawStreamImpl: async function* (input) {
        responseChatLenAtStream = responseHarness.chatMessages.get("chat-1")!.length;
        responseSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Response" };
        yield { type: "done", content: "Response", finish_reason: "stop" };
      },
    });
    const { runner: responseRunner } = registerBackend(responseHarness.api);
    expect(responseHarness.registerInterceptorCalls).toHaveLength(0);
    await responseRunner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );
    expect(responseChatLenAtDryRun).toBe(3);
    expect(responseChatLenAtStream).toBe(4);
    expect(responseSent.map((m) => `${m.role}:${m.content}`)).toEqual([
      ...preHistoryBlocks.map((b) => `${b.role}:${b.content}`),
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "system:[OOC Guidance for the next response: Steer]",
      "assistant:Depth 0 assistant",
      "user:Depth 0 user",
      "system:Trailing system",
    ]);

    // 3. guided_regenerate with interceptor: false
    let regenSent: Array<Record<string, unknown>> = [];
    let regenChatLenAtDryRun = 0;
    let regenChatLenAtStream = 0;
    const regenHarness = createSpindleHarness({
      permissions: { interceptor: false },
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Earlier user" }),
          makeMessage({ id: "m2", role: "assistant", content: "Earlier assistant" }),
          makeMessage({ id: "m3", role: "user", content: "Latest user" }),
          makeMessage({ id: "m4", role: "assistant", content: "Old reply" }),
        ],
      },
      dryRunImpl: async () => {
        const msgs = regenHarness.chatMessages.get("chat-1")!;
        regenChatLenAtDryRun = msgs.length;
        return {
          messages: [],
          request_messages: assembleFilteredRequestMessages(msgs),
          parameters: { temperature: 0.7 },
        };
      },
      rawStreamImpl: async function* (input) {
        regenChatLenAtStream = regenHarness.chatMessages.get("chat-1")!.length;
        regenSent = (input.messages as Array<Record<string, unknown>>) ?? [];
        yield { type: "token", token: "Regen" };
        yield { type: "done", content: "Regen", finish_reason: "stop" };
      },
    });
    const { runner: regenRunner } = registerBackend(regenHarness.api);
    expect(regenHarness.registerInterceptorCalls).toHaveLength(0);
    await regenRunner.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(regenChatLenAtDryRun).toBe(3);
    expect(regenChatLenAtStream).toBe(4);
    expect(regenSent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedBase);
  });

  test("real Lumiverse stripEmptyTextParts-before-interceptor simulation preserves Nemo Engine order for guided_swipe (none/merge/single, fg/bg), guided_response, and guided_regenerate", async () => {
    const preHistoryBlocks = Array.from({ length: 30 }, (_, idx) => ({
      role: "system" as const,
      content: `Nemo Pre ${idx + 1}`,
    }));

    // Mirrors Lumiverse prompt-assembly.service.ts:620-656 (`stripEmptyTextParts`).
    const lumiverseStripEmptyTextParts = (msgs: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
      const out: Array<Record<string, unknown>> = [];
      for (const msg of msgs) {
        if (typeof msg.content === "string") {
          if (msg.content.trim().length > 0) {
            out.push(msg);
          }
          continue;
        }
        if (!Array.isArray(msg.content)) {
          out.push(msg);
          continue;
        }
        const cleaned = (msg.content as Array<{ type: string; text?: string }>).filter(
          (p) => p.type !== "text" || String(p.text ?? "").trim().length > 0,
        );
        if (cleaned.length > 0) {
          out.push({ ...msg, content: cleaned });
        }
      }
      return out;
    };

    const lumiverseHasNonEmptyContent = (msg: Record<string, unknown>): boolean => {
      if (typeof msg.content === "string") {
        return msg.content.trim().length > 0 || (msg.role === "assistant" && msg.partial === true);
      }
      if (Array.isArray(msg.content)) {
        return msg.content.length > 0;
      }
      return true;
    };

    const lumiverseApplyPostProcessing = (
      msgs: Array<Record<string, unknown>>,
      mode: "none" | "merge" | "single",
    ): Array<Record<string, unknown>> => {
      if (mode === "none") {
        return msgs.map((m) => ({ ...m }));
      }
      if (mode === "merge") {
        const merged: Array<Record<string, unknown>> = [];
        for (const msg of msgs) {
          const prev = merged[merged.length - 1];
          if (prev && prev.role === msg.role) {
            merged[merged.length - 1] = {
              ...prev,
              content: `${String(prev.content ?? "")}\n\n${String(msg.content ?? "")}`,
            };
          } else {
            merged.push({ ...msg });
          }
        }
        return merged;
      }
      // "single": collapse all non-empty messages into one system message without chat-history metadata
      const joined = msgs
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .filter((t) => t.length > 0)
        .join("\n\n");
      return [{ role: "system", content: joined }];
    };

    const assembleNemoWithBlocks = (chatMsgs: ChatMessageWithRole[]): Array<Record<string, unknown>> => {
      const pre = preHistoryBlocks.map((b) => ({
        role: b.role,
        content: b.content,
        __isChatHistory: false,
        __chatHistorySource: false,
      }));
      const block618 = {
        role: "system" as const,
        content: "[618] system(depth=1)",
        __isChatHistory: false,
        __chatHistorySource: false,
      };
      const historyItems = chatMsgs.map((m) => ({
        role: (m.role ?? (m.is_user ? "user" : "assistant")) as "user" | "assistant" | "system",
        content: m.content,
        __isChatHistory: true,
        __chatHistorySource: true,
        sourceMessageId: m.id,
        __sourceMessageId: m.id,
      }));
      const insertAt = Math.max(0, historyItems.length - 1);
      return [
        ...pre,
        ...historyItems.slice(0, insertAt),
        block618,
        ...historyItems.slice(insertAt),
        {
          role: "assistant" as const,
          content: "[619] assistant(depth=0)",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
        {
          role: "user" as const,
          content: "[620] user(depth=0)",
          __isChatHistory: false,
          __chatHistorySource: false,
        },
      ];
    };

    const runLumiverseDryRun = async (
      harness: ReturnType<typeof createSpindleHarness>,
      input: Record<string, unknown>,
      userId: string | undefined,
      mode: "none" | "merge" | "single",
    ) => {
      const chatId = String(input.chatId ?? "chat-1");
      const rawAssembled = assembleNemoWithBlocks(harness.chatMessages.get(chatId)!);
      // 1. stripEmptyTextParts runs BEFORE interceptorPipeline.run (prompt-assembly.service.ts:4251, 4287)
      const afterStripEmpty = lumiverseStripEmptyTextParts(rawAssembled);
      // 2. invoke registeredInterceptors (generate.service.ts:1238)
      const ctx = {
        userId: userId ?? "u1",
        chatId,
        generationId: "gen-dry-lumiverse",
        generationType: (input.generationType as string) ?? "normal",
        dryRun: true,
        isDryRun: false,
        presetId: (input.presetId as string) ?? null,
        presetMetadata: {},
        personaId: null,
        characterId: null,
        personaAddonStates: {},
        mainDispatch: {
          source: "main",
          descriptor: null,
          connectionDispatchRevision: null,
          dispatchKind: null,
        },
        prefillCarrier: { id: "p", state: "absent" },
        interceptorDeadlineAt: Date.now() + 5000,
        boundWorkDeadlineAt: Date.now() + 5000,
        signal: new AbortController().signal,
      };
      for (const handler of harness.registeredInterceptors) {
        await handler(
          afterStripEmpty as unknown as LlmMessageDTO[],
          ctx as unknown as Parameters<InterceptorHandler>[1],
        );
      }
      // 3. applyPostProcessing -> hasNonEmptyContent (generate.service.ts:1254-1255, 1423)
      const postProcessed = lumiverseApplyPostProcessing(afterStripEmpty, mode);
      const requestMessages = postProcessed.filter(lumiverseHasNonEmptyContent);
      return {
        messages: [],
        request_messages: requestMessages,
        parameters: { temperature: 0.7 },
      };
    };

    const expectedNoneMessages = [
      ...preHistoryBlocks.map((b) => `${b.role}:${b.content}`),
      "system:[618] system(depth=1)",
      "user:u_last",
      "assistant:[619] assistant(depth=0)",
      "user:[620] user(depth=0)",
    ];
    const expectedMergedMessages = [
      `system:${[...preHistoryBlocks.map((b) => b.content), "[618] system(depth=1)"].join("\n\n")}`,
      "user:u_last",
      "assistant:[619] assistant(depth=0)",
      "user:[620] user(depth=0)",
    ];
    const expectedSingleContent = [
      ...preHistoryBlocks.map((b) => b.content),
      "[618] system(depth=1)",
      "u_last",
      "[619] assistant(depth=0)",
      "[620] user(depth=0)",
    ].join("\n\n");

    // 1. guided_swipe across backgroundSwipe (false/true) and promptPostProcessing (none/merge/single)
    for (const backgroundSwipe of [false, true] as const) {
      for (const mode of ["none", "merge", "single"] as const) {
        let sent: Array<Record<string, unknown>> = [];
        const swipeHarness = createSpindleHarness({
          chats: {
            "chat-1": [
              makeMessage({ id: "u_last", role: "user", content: "u_last" }),
              makeMessage({
                id: "a_target",
                role: "assistant",
                content: "Old reply",
                swipes: ["Old reply"],
                swipe_id: 0,
              }),
            ],
          },
          dryRunImpl: (input, userId) => runLumiverseDryRun(swipeHarness, input, userId, mode),
          rawStreamImpl: async function* (input) {
            sent = (input.messages as Array<Record<string, unknown>>) ?? [];
            yield { type: "token", token: "New swipe" };
            yield { type: "done", content: "New swipe", finish_reason: "stop" };
          },
        });
        const { runner } = registerBackend(swipeHarness.api);
        const res = await runner.run(
          { actionId: "guided_swipe", chatId: "chat-1", inputText: "", backgroundSwipe },
          "u1",
        );
        expect(res.text).toBe("New swipe");

        const serialized = JSON.stringify(sent);
        expect(serialized.includes("Old reply")).toBe(false);

        if (mode === "none") {
          expect(sent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedNoneMessages);
        } else if (mode === "merge") {
          expect(sent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedMergedMessages);
        } else {
          expect(sent).toHaveLength(1);
          expect(sent[0]?.role).toBe("system");
          expect(sent[0]?.content).toBe(expectedSingleContent);
        }
      }
    }

    // 2. guided_response under the same stripEmptyTextParts-before-interceptor mock
    for (const mode of ["none", "merge", "single"] as const) {
      let sent: Array<Record<string, unknown>> = [];
      const respHarness = createSpindleHarness({
        chats: {
          "chat-1": [makeMessage({ id: "u_last", role: "user", content: "u_last" })],
        },
        dryRunImpl: (input, userId) => runLumiverseDryRun(respHarness, input, userId, mode),
        rawStreamImpl: async function* (input) {
          sent = (input.messages as Array<Record<string, unknown>>) ?? [];
          yield { type: "token", token: "Fresh response" };
          yield { type: "done", content: "Fresh response", finish_reason: "stop" };
        },
      });
      const { runner } = registerBackend(respHarness.api);
      await runner.run(
        { actionId: "guided_response", chatId: "chat-1", inputText: "Steer tension" },
        "u1",
      );
      if (mode === "none") {
        expect(sent.map((m) => `${m.role}:${m.content}`)).toEqual([
          ...preHistoryBlocks.map((b) => `${b.role}:${b.content}`),
          "system:[618] system(depth=1)",
          "user:u_last",
          "system:[OOC Guidance for the next response: Steer tension]",
          "assistant:[619] assistant(depth=0)",
          "user:[620] user(depth=0)",
        ]);
      } else if (mode === "merge") {
        expect(sent.map((m) => `${m.role}:${m.content}`)).toEqual([
          `system:${[...preHistoryBlocks.map((b) => b.content), "[618] system(depth=1)"].join("\n\n")}`,
          "user:u_last",
          "system:[OOC Guidance for the next response: Steer tension]",
          "assistant:[619] assistant(depth=0)",
          "user:[620] user(depth=0)",
        ]);
      } else {
        expect(sent).toHaveLength(1);
        expect(sent[0]?.role).toBe("system");
        expect(sent[0]?.content).toBe(
          [
            ...preHistoryBlocks.map((b) => b.content),
            "[618] system(depth=1)",
            "u_last",
            "[OOC Guidance for the next response: Steer tension]",
            "[619] assistant(depth=0)",
            "[620] user(depth=0)",
          ].join("\n\n"),
        );
      }
    }

    // 3. guided_regenerate under the same stripEmptyTextParts-before-interceptor mock
    for (const mode of ["none", "merge", "single"] as const) {
      let sent: Array<Record<string, unknown>> = [];
      const regenHarness = createSpindleHarness({
        chats: {
          "chat-1": [
            makeMessage({ id: "u_last", role: "user", content: "u_last" }),
            makeMessage({ id: "a_target", role: "assistant", content: "Old reply", swipes: ["Old reply"] }),
          ],
        },
        dryRunImpl: (input, userId) => runLumiverseDryRun(regenHarness, input, userId, mode),
        rawStreamImpl: async function* (input) {
          sent = (input.messages as Array<Record<string, unknown>>) ?? [];
          yield { type: "token", token: "Regen reply" };
          yield { type: "done", content: "Regen reply", finish_reason: "stop" };
        },
      });
      const { runner } = registerBackend(regenHarness.api);
      await runner.run(
        { actionId: "guided_regenerate", chatId: "chat-1", inputText: "" },
        "u1",
      );
      expect(JSON.stringify(sent).includes("Old reply")).toBe(false);
      if (mode === "none") {
        expect(sent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedNoneMessages);
      } else if (mode === "merge") {
        expect(sent.map((m) => `${m.role}:${m.content}`)).toEqual(expectedMergedMessages);
      } else {
        expect(sent).toHaveLength(1);
        expect(sent[0]?.role).toBe("system");
        expect(sent[0]?.content).toBe(expectedSingleContent);
      }
    }
  });
});

describe("post-audit polish regression tests (backend)", () => {
  test("guided_swipe on already-empty swipe without interceptor preserves earlier non-empty assistant turn", async () => {
    let sentMessages: LlmMessageDTO[] = [];
    const harness = createSpindleHarness({
      permissions: { interceptor: false },
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Hello" }),
          makeMessage({
            id: "a1",
            role: "assistant",
            content: "Earlier non-empty assistant turn",
            swipes: ["Earlier non-empty assistant turn"],
            swipe_id: 0,
          }),
          makeMessage({ id: "u2", role: "user", content: "Continue" }),
          makeMessage({
            id: "a2",
            role: "assistant",
            content: "",
            swipes: [""],
            swipe_id: 0,
          }),
        ],
      },
      dryRunImpl: async () => ({
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Earlier non-empty assistant turn" },
          { role: "user", content: "Continue" },
          { role: "system", content: "Post-history" },
        ],
        request_messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Earlier non-empty assistant turn" },
          { role: "user", content: "Continue" },
          { role: "system", content: "Post-history" },
        ],
        breakdown: [
          { type: "preset", name: "System" },
          { type: "chat_history", name: "Chat History", firstMessageIndex: 1, messageCount: 3 },
          { type: "preset", name: "Post-history" },
        ],
        model: "gpt-4o",
        provider: "openai",
      }),
      rawStreamImpl: async function* (input) {
        sentMessages = (input.messages as LlmMessageDTO[]) ?? [];
        yield { type: "token", token: "Fresh swipe reply" };
        yield { type: "done", content: "Fresh swipe reply", finish_reason: "stop" };
      },
    });

    const { runner } = registerBackend(harness.api);
    const res = await runner.run({ actionId: "guided_swipe", chatId: "chat-1", inputText: "" }, "u1");
    expect(res.text).toBe("Fresh swipe reply");
    expect(sentMessages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:System",
      "user:Hello",
      "assistant:Earlier non-empty assistant turn",
      "user:Continue",
      "system:Post-history",
    ]);
  });

  test("mergeDryRunAndCapturedMessages does not misclassify 1-message empty-turn pruning or non-history role merge as collapseToSingleRole", async () => {
    // Case A: Empty-turn pruning leaves 1 non-empty user message (without metadata on request_messages)
    let sentA: LlmMessageDTO[] = [];
    const capturedA = [
      { role: "user" as const, content: "Only user turn", __chatHistorySource: true, __sourceMessageId: "u1" },
      { role: "assistant" as const, content: "" },
    ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>;
    const harnessA = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "u1", role: "user", content: "Only user turn" })],
      },
      interceptorMessagesByChat: { "chat-1": capturedA },
      dryRunImpl: async () => ({
        messages: capturedA,
        request_messages: [{ role: "user", content: "Only user turn" }],
        model: "gpt-4o",
        provider: "openai",
      }),
      rawStreamImpl: async function* (input) {
        sentA = (input.messages as LlmMessageDTO[]) ?? [];
        yield { type: "token", token: "Reply A" };
        yield { type: "done", content: "Reply A", finish_reason: "stop" };
      },
    });
    const { runner: runnerA } = registerBackend(harnessA.api);
    await runnerA.run({ actionId: "guided_response", chatId: "chat-1", inputText: "Guide A" }, "u1");
    // Guidance must be injected as a separate system message, NOT collapsed into the single user message
    expect(sentA).toEqual([
      { role: "user", content: "Only user turn" },
      { role: "system", content: "[OOC Guidance for the next response: Guide A]" },
    ]);

    // Case B: Non-history consecutive system blocks merge into 1 system message in merge mode
    let sentB: LlmMessageDTO[] = [];
    const capturedB = [
      { role: "system" as const, content: "Sys 1", __chatHistorySource: false },
      { role: "system" as const, content: "Sys 2", __chatHistorySource: false },
    ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>;
    const harnessB = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "a0", role: "assistant", content: "" })],
      },
      interceptorMessagesByChat: { "chat-1": capturedB },
      dryRunImpl: async () => ({
        messages: capturedB,
        request_messages: [{ role: "system", content: "Sys 1\n\nSys 2" }],
        model: "gpt-4o",
        provider: "openai",
      }),
      rawStreamImpl: async function* (input) {
        sentB = (input.messages as LlmMessageDTO[]) ?? [];
        yield { type: "token", token: "Reply B" };
        yield { type: "done", content: "Reply B", finish_reason: "stop" };
      },
    });
    const { runner: runnerB, store: storeB } = registerBackend(harnessB.api);
    const settingsB = await storeB.getSettings("u1");
    settingsB.actions.guided_response.injectionRole = "user";
    await storeB.saveSettings(settingsB, "u1");
    await runnerB.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "User-role guide" },
      "u1",
    );
    expect(sentB).toEqual([
      { role: "system", content: "Sys 1\n\nSys 2" },
      { role: "user", content: "[OOC Guidance for the next response: User-role guide]" },
    ]);
  });

  test("guided_swipe handles mid-stream swipe deletion (earlier swipe shifts activeRuns.swipeId; target swipe aborts without resurrection) and concurrent dryRun swipe mutations", async () => {
    // 1. Deleting an earlier swipe mid-stream shifts targetSwipeIndex & updates activeRuns.swipeId
    let releaseToken2!: () => void;
    const token2Gate = new Promise<void>((resolve) => {
      releaseToken2 = resolve;
    });
    let onFirstToken!: () => void;
    const firstTokenSeen = new Promise<void>((resolve) => {
      onFirstToken = resolve;
    });

    const harnessShift = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Prompt" }),
          makeMessage({
            id: "a1",
            role: "assistant",
            content: "Swipe 1",
            swipes: ["Swipe 0", "Swipe 1"],
            swipe_id: 1,
            swipe_dates: [100, 200],
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "First " };
        onFirstToken();
        await token2Gate;
        yield { type: "token", token: "Second" };
        yield { type: "done", content: "First Second", finish_reason: "stop" };
      },
    });
    const { runner: shiftRunner } = registerBackend(harnessShift.api);
    const shiftPromise = shiftRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );
    await firstTokenSeen;
    expect(shiftRunner.getActiveRun("u1", "chat-1")?.swipeId).toBe(2);

    // Simulate user deleting swipe 0 mid-stream on host
    const msgBeforeDelete = harnessShift.chatMessages.get("chat-1")![1]!;
    msgBeforeDelete.swipes.splice(0, 1);
    msgBeforeDelete.swipe_dates.splice(0, 1);
    msgBeforeDelete.swipe_id = 1;
    harnessShift.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      action: "deleted",
      swipeId: 0,
      message: { id: "a1", swipe_id: 1 },
    });

    expect(shiftRunner.getActiveRun("u1", "chat-1")?.swipeId).toBe(1);
    releaseToken2();
    const shiftRes = await shiftPromise;
    expect(shiftRes.swipeId).toBe(1);
    expect(shiftRes.text).toBe("First Second");
    const finalMsg = harnessShift.chatMessages.get("chat-1")![1]!;
    expect(finalMsg.swipes).toEqual(["Swipe 1", "First Second"]);
    expect(finalMsg.swipe_id).toBe(1);

    // 2. Deleting the target swipe slot itself mid-stream aborts and does NOT resurrect the deleted slot
    let onTargetToken!: () => void;
    const targetTokenSeen = new Promise<void>((resolve) => {
      onTargetToken = resolve;
    });
    let releaseTargetStream!: () => void;
    const targetStreamGate = new Promise<void>((resolve) => {
      releaseTargetStream = resolve;
    });

    const harnessDel = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Prompt" }),
          makeMessage({
            id: "a1",
            role: "assistant",
            content: "Swipe 0",
            swipes: ["Swipe 0"],
            swipe_id: 0,
            swipe_dates: [100],
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Partial" };
        onTargetToken();
        await targetStreamGate;
        yield { type: "token", token: "AfterDelete" };
        yield { type: "done", content: "PartialAfterDelete", finish_reason: "stop" };
      },
    });
    const { runner: delRunner } = registerBackend(harnessDel.api);
    const delPromise = delRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Steer" },
      "u1",
    );
    await targetTokenSeen;
    const updatesBeforeDelete = harnessDel.updateMessageCalls.length;

    // Host deletes target swipe slot 1
    const targetMsg = harnessDel.chatMessages.get("chat-1")![1]!;
    targetMsg.swipes = ["Swipe 0"];
    targetMsg.swipe_dates = [100];
    targetMsg.swipe_id = 0;
    targetMsg.content = "Swipe 0";
    harnessDel.triggerEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      action: "deleted",
      swipeId: 1,
      message: { id: "a1", swipe_id: 0 },
    });
    releaseTargetStream();

    const delRes = await delPromise;
    expect(delRes.aborted).toBe(true);
    expect(delRes.text).toBe("");
    // No post-delete updateMessage calls resurrected swipe slot 1
    expect(harnessDel.updateMessageCalls.length).toBe(updatesBeforeDelete);
    expect(harnessDel.chatMessages.get("chat-1")![1]!.swipes).toEqual(["Swipe 0"]);

    // 3. Concurrent swipe added during dryRun is preserved when pendingSwipeSlotWrite re-reads target
    const harnessConcurrent = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Prompt" }),
          makeMessage({
            id: "a1",
            role: "assistant",
            content: "Swipe 0",
            swipes: ["Swipe 0"],
            swipe_id: 0,
            swipe_dates: [100],
          }),
        ],
      },
      dryRunImpl: async () => {
        // Concurrent swipe added while dryRun is in flight
        const m = harnessConcurrent.chatMessages.get("chat-1")![1]!;
        m.swipes.push("Concurrent swipe 1");
        m.swipe_dates.push(150);
        return {
          messages: [
            { role: "user", content: "Prompt" },
            { role: "assistant", content: "Swipe 0" },
          ],
          request_messages: [
            { role: "user", content: "Prompt" },
            { role: "assistant", content: "Swipe 0" },
          ],
          model: "gpt-4o",
          provider: "openai",
        };
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "GG swipe 2" };
        yield { type: "done", content: "GG swipe 2", finish_reason: "stop" };
      },
    });
    const { runner: concRunner } = registerBackend(harnessConcurrent.api);
    const concRes = await concRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "" },
      "u1",
    );
    expect(concRes.swipeId).toBe(2);
    expect(harnessConcurrent.chatMessages.get("chat-1")![1]!.swipes).toEqual([
      "Swipe 0",
      "Concurrent swipe 1",
      "GG swipe 2",
    ]);
  });

  test("persists reasoningDuration on guided_response, guided_regenerate, and guided_swipe (active and background)", async () => {
    const delayedReasoningStream = async function* () {
      yield { type: "reasoning" as const, token: "Step 1. " };
      await new Promise((r) => setTimeout(r, 15));
      yield { type: "reasoning" as const, token: "Step 2." };
      yield { type: "token" as const, token: "Final answer." };
      yield { type: "done" as const, content: "Final answer.", reasoning: "Step 1. Step 2.", finish_reason: "stop" };
    };

    // 1. guided_response
    const respHarness = createSpindleHarness({
      chats: { "chat-1": [makeMessage({ id: "u1", role: "user", content: "Hi" })] },
      rawStreamImpl: delayedReasoningStream,
    });
    const { runner: respRunner } = registerBackend(respHarness.api);
    await respRunner.run({ actionId: "guided_response", chatId: "chat-1", inputText: "Reason" }, "u1");
    const respFinalPatch = respHarness.updateMessageCalls.at(-1)?.patch;
    expect(respFinalPatch?.reasoning).toEqual({
      text: "Step 1. Step 2.",
      duration: expect.any(Number),
    });
    expect((respFinalPatch?.reasoning as { duration: number }).duration).toBeGreaterThan(0);

    // 2. guided_regenerate
    const regenHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Hi" }),
          makeMessage({ id: "a1", role: "assistant", content: "Old" }),
        ],
      },
      rawStreamImpl: delayedReasoningStream,
    });
    const { runner: regenRunner } = registerBackend(regenHarness.api);
    await regenRunner.run({ actionId: "guided_regenerate", chatId: "chat-1", inputText: "" }, "u1");
    const regenFinalPatch = regenHarness.updateMessageCalls.at(-1)?.patch;
    expect((regenFinalPatch?.reasoning as { duration: number }).duration).toBeGreaterThan(0);

    // 3. guided_swipe (active)
    const swipeHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Hi" }),
          makeMessage({ id: "a1", role: "assistant", content: "Old", swipes: ["Old"], swipe_id: 0 }),
        ],
      },
      rawStreamImpl: delayedReasoningStream,
    });
    const { runner: swipeRunner } = registerBackend(swipeHarness.api);
    await swipeRunner.run({ actionId: "guided_swipe", chatId: "chat-1", inputText: "" }, "u1");
    const swipeFinalPatch = swipeHarness.updateMessageCalls.at(-1)?.patch;
    expect((swipeFinalPatch?.reasoning as { duration: number }).duration).toBeGreaterThan(0);

    // 4. guided_swipe (background)
    const bgHarness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Hi" }),
          makeMessage({ id: "a1", role: "assistant", content: "Old", swipes: ["Old"], swipe_id: 0 }),
        ],
      },
      rawStreamImpl: delayedReasoningStream,
    });
    const { runner: bgRunner } = registerBackend(bgHarness.api);
    await bgRunner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "", backgroundSwipe: true },
      "u1",
    );
    const bgFinalPatch = bgHarness.updateMessageCalls.at(-1)?.patch;
    const bgSwipeReasoning = bgFinalPatch?.swipe_reasoning as Array<{ text: string; duration?: number } | null>;
    expect(bgSwipeReasoning[1]?.text).toBe("Step 1. Step 2.");
    expect(bgSwipeReasoning[1]?.duration).toBeGreaterThan(0);
  });

  test("regenerateLastContinue restores preRegen on post-token transformOutput throw and on final flush error", async () => {
    // 1. Post-token transformOutput throw after tokens were streamed
    const harnessTransform = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Hello" }),
          makeMessage({
            id: "a1",
            role: "assistant",
            content: "Base",
            swipes: ["Base"],
            swipe_id: 0,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Token" };
        yield { type: "done", content: "Token", finish_reason: "stop" };
      },
    });
    const { runner: runner1, store: store1 } = registerBackend(harnessTransform.api);
    await runner1.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "Keep going" }, "u1");
    expect(harnessTransform.chatMessages.get("chat-1")![1]!.content).toBe("Base Token");

    const origPrepare = (
      runner1 as unknown as {
        prepareRawGenerationInput: (...a: unknown[]) => Promise<{
          rawInput: unknown;
          transformResponseOutput?: () => Promise<unknown>;
          transformImpersonateOutput?: unknown;
        }>;
      }
    ).prepareRawGenerationInput.bind(runner1);
    (
      runner1 as unknown as {
        prepareRawGenerationInput: (...a: unknown[]) => Promise<{
          rawInput: unknown;
          transformResponseOutput?: () => Promise<unknown>;
          transformImpersonateOutput?: unknown;
        }>;
      }
    ).prepareRawGenerationInput = async (...a: unknown[]) => {
      const prepared = await origPrepare(...a);
      return {
        ...prepared,
        transformResponseOutput: async () => {
          throw new Error("Post-token transformOutput failure");
        },
      };
    };

    await expect(runner1.regenerateLastContinue({ chatId: "chat-1" }, "u1")).rejects.toThrow(
      "Post-token transformOutput failure",
    );
    expect(harnessTransform.chatMessages.get("chat-1")![1]!.content).toBe("Base Token");
    const entry1 = await store1.peekContinueEntry("chat-1", "a1", 0, "u1");
    expect(entry1?.resultText).toBe("Base Token");

    // 2. Final flush error after tokens streamed
    let failFinalFlush = false;
    const harnessFlush = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "Hello" }),
          makeMessage({
            id: "a1",
            role: "assistant",
            content: "Base",
            swipes: ["Base"],
            swipe_id: 0,
          }),
        ],
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "NewPart" };
        yield { type: "done", content: "NewPart", finish_reason: "stop" };
      },
      updateMessageImpl: async (_chatId, _messageId, patch, defaultUpdate) => {
        if (failFinalFlush && patch.skipChunkRebuild === false) {
          throw new Error("Final flush rejected");
        }
        await defaultUpdate();
      },
    });
    const { runner: runner2, store: store2 } = registerBackend(harnessFlush.api);
    await runner2.run({ actionId: "guided_continue", chatId: "chat-1", inputText: "Extend" }, "u1");
    expect(harnessFlush.chatMessages.get("chat-1")![1]!.content).toBe("Base NewPart");

    failFinalFlush = true;
    await expect(runner2.regenerateLastContinue({ chatId: "chat-1" }, "u1")).rejects.toThrow(
      "Final flush rejected",
    );
    failFinalFlush = false;
    expect(harnessFlush.chatMessages.get("chat-1")![1]!.content).toBe("Base NewPart");
    const entry2 = await store2.peekContinueEntry("chat-1", "a1", 0, "u1");
    expect(entry2?.resultText).toBe("Base NewPart");
  });

  test("prepareRawGenerationInput filters empty turns before injectGuidanceMessage and abortCurrent aborts pendingUsers with undefined chatId", async () => {
    // 1. Empty-turn filtering runs before injectGuidanceMessage so in_history depth counts non-empty turns
    let sent: LlmMessageDTO[] = [];
    const capturedWithEmpty = [
      { role: "system" as const, content: "System", __chatHistorySource: false },
      { role: "user" as const, content: "First user", __chatHistorySource: true, __sourceMessageId: "u1" },
      { role: "assistant" as const, content: "First reply", __chatHistorySource: true, __sourceMessageId: "a1" },
      { role: "assistant" as const, content: "", __chatHistorySource: true, __sourceMessageId: "a-empty" },
    ] as unknown as Array<LlmMessageDTO & { __isWorldInfoEntry?: boolean }>;
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "u1", role: "user", content: "First user" }),
          makeMessage({ id: "a1", role: "assistant", content: "First reply" }),
        ],
      },
      interceptorMessagesByChat: { "chat-1": capturedWithEmpty },
      dryRunImpl: async () => ({
        messages: capturedWithEmpty,
        request_messages: [
          { role: "system", content: "System" },
          { role: "user", content: "First user" },
          { role: "assistant", content: "First reply" },
        ],
        model: "gpt-4o",
        provider: "openai",
      }),
      rawStreamImpl: async function* (input) {
        sent = (input.messages as LlmMessageDTO[]) ?? [];
        yield { type: "token", token: "Done" };
        yield { type: "done", content: "Done", finish_reason: "stop" };
      },
    });
    const { runner, store } = registerBackend(harness.api);
    const s = await store.getSettings("u1");
    s.actions.guided_response.guidancePosition = "in_history";
    s.actions.guided_response.guidanceDepth = 1;
    await store.saveSettings(s, "u1");
    await runner.run({ actionId: "guided_response", chatId: "chat-1", inputText: "Depth 1 guide" }, "u1");
    // Depth 1 from non-empty history [u1, a1] must insert right before "First reply", not after "First reply"
    expect(sent.map((m) => m.content)).toEqual([
      "System",
      "First user",
      "[OOC Guidance for the next response: Depth 1 guide]",
      "First reply",
    ]);

    // 2. abortCurrent with chatId aborts pendingUsers entry whose chatId is still undefined during resolveChatContext
    let releaseChatGet!: () => void;
    const chatGetGate = new Promise<void>((resolve) => {
      releaseChatGet = resolve;
    });
    let chatGetStarted!: () => void;
    const chatGetStartedPromise = new Promise<void>((resolve) => {
      chatGetStarted = resolve;
    });
    const slowHarness = createSpindleHarness({
      chats: { "chat-1": [makeMessage({ id: "u1", role: "user", content: "Hi" })] },
    });
    const origGetActive = slowHarness.api.chats.getActive;
    slowHarness.api.chats.getActive = async (userId?: string) => {
      chatGetStarted();
      await chatGetGate;
      return origGetActive(userId);
    };
    const { runner: slowRunner } = registerBackend(slowHarness.api);
    const pendingRunPromise = slowRunner.run(
      { actionId: "guided_response", inputText: "Slow resolve" },
      "u1",
    );
    await chatGetStartedPromise;
    expect(slowRunner.abortCurrent("u1", undefined, "chat-1")).toBe(true);
    releaseChatGet();
    const pendingRes = await pendingRunPromise;
    expect(pendingRes.aborted).toBe(true);
  });
});

describe("non-streaming (_streaming: false) vs streaming generation dispatch", () => {
  test("streamIntoMessage calls generate.raw when _streaming is false, handles content/reasoning/usage/regex, strips _streaming without mutating dryRun parameters", async () => {
    const dryRunParams: Record<string, unknown> = { _streaming: false, temperature: 0.65, top_p: 0.9 };
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hello" })],
      },
      regexScripts: [
        {
          id: "rx-resp",
          script_name: "Replace foo",
          find_regex: "foo",
          replace_string: "bar",
          trim_strings: [],
          placement: ["ai_output"],
          target: "response",
          disabled: false,
          markdown_only: false,
          prompt_only: false,
          run_on_edit: false,
          substitute_regex: 0,
          min_depth: null,
          max_depth: null,
        } as unknown as RegexScriptDTO,
      ],
      dryRunImpl: async () => ({
        messages: [{ role: "user", content: "Hello" }],
        parameters: dryRunParams,
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async () => ({
        content: "Answer foo",
        reasoning: "Thought process",
        finish_reason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 22, total_tokens: 32 },
      }),
      rawStreamImpl: async function* () {
        throw new Error("rawStream must not be called when _streaming is false");
      },
    });
    const { runner } = registerBackend(harness.api);

    const res = await runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Keep it brief" },
      "u1",
    );

    expect(harness.rawCalls).toHaveLength(1);
    expect(harness.rawStreamCalls).toHaveLength(0);
    expect(harness.rawCalls[0]?.parameters).toEqual({ temperature: 0.65, top_p: 0.9 });
    expect("_streaming" in ((harness.rawCalls[0]?.parameters as Record<string, unknown>) ?? {})).toBe(false);
    expect(dryRunParams).toEqual({ _streaming: false, temperature: 0.65, top_p: 0.9 });

    expect(res.aborted).toBe(false);
    expect(res.text).toBe("Answer bar");
    const msgs = harness.chatMessages.get("chat-1") ?? [];
    const created = msgs.find((m) => m.id === res.messageId);
    expect(created?.content).toBe("Answer bar");
    expect(created?.extra?.reasoning).toBe("Thought process");

    const metricEvents = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:generation_metrics")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:generation_metrics" }>);
    expect(metricEvents).toHaveLength(1);
    expect(metricEvents[0]?.tokenCount).toBe(22);
    expect(metricEvents[0]?.generationMetrics?.wasStreaming).toBe(false);
    expect(metricEvents[0]?.generationMetrics?.ttft).toBeUndefined();
    expect(metricEvents[0]?.generationMetrics?.tps).toBeUndefined();
  });

  test("streamIntoMessage handles AbortError during non-streaming generate.raw and restores regenerated snapshot", async () => {
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [
          makeMessage({ id: "m1", role: "user", content: "Hello" }),
          makeMessage({ id: "m2", role: "assistant", content: "Original reply", swipes: ["Original reply"], swipe_id: 0 }),
        ],
      },
      dryRunImpl: async () => ({
        messages: [{ role: "user", content: "Hello" }],
        parameters: { _streaming: false },
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async ({ signal }) => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        if (signal?.aborted) throw err;
        throw err;
      },
      rawStreamImpl: async function* () {
        throw new Error("rawStream must not be called when _streaming is false");
      },
    });
    const { runner } = registerBackend(harness.api);

    const res = await runner.run(
      { actionId: "guided_regenerate", chatId: "chat-1", inputText: "Try again" },
      "u1",
    );

    expect(harness.rawCalls).toHaveLength(1);
    expect(harness.rawStreamCalls).toHaveLength(0);
    expect(res.aborted).toBe(true);
    const msgs = harness.chatMessages.get("chat-1") ?? [];
    expect(msgs.some((m) => m.role === "assistant" && m.content === "Original reply")).toBe(true);
  });

  test("executeImpersonate calls generate.raw when _streaming is false, applies regex, emits terminal chunk, and handles abort", async () => {
    const dryRunParams: Record<string, unknown> = { _streaming: false, max_tokens: 120 };
    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "assistant", content: "What do you do?" })],
      },
      regexScripts: [
        {
          id: "rx-imp",
          script_name: "Clean draft",
          find_regex: "DRAFT",
          replace_string: "FINAL",
          trim_strings: [],
          placement: ["ai_output"],
          target: "response",
          disabled: false,
          markdown_only: false,
          prompt_only: false,
          run_on_edit: false,
          substitute_regex: 0,
          min_depth: null,
          max_depth: null,
        } as unknown as RegexScriptDTO,
      ],
      dryRunImpl: async () => ({
        messages: [{ role: "assistant", content: "What do you do?" }],
        parameters: dryRunParams,
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async () => ({
        content: "I say DRAFT response.",
        finish_reason: "stop",
      }),
      rawStreamImpl: async function* () {
        throw new Error("rawStream must not be called when _streaming is false");
      },
    });
    const { runner } = registerBackend(harness.api);

    const res = await runner.run(
      { actionId: "guided_impersonate", chatId: "chat-1", inputText: "Respond boldly" },
      "u1",
    );

    expect(harness.rawCalls).toHaveLength(1);
    expect(harness.rawStreamCalls).toHaveLength(0);
    expect(harness.rawCalls[0]?.parameters).toEqual({ max_tokens: 120 });
    expect("_streaming" in ((harness.rawCalls[0]?.parameters as Record<string, unknown>) ?? {})).toBe(false);
    expect(dryRunParams).toEqual({ _streaming: false, max_tokens: 120 });
    expect(res.aborted).toBe(false);
    expect(res.text).toBe("I say FINAL response.");

    const chunks = harness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:impersonate-chunk")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:impersonate-chunk" }>);
    expect(chunks).toEqual([
      {
        type: "gg:impersonate-chunk",
        chatId: "chat-1",
        text: "I say FINAL response.",
        done: true,
        aborted: false,
      },
    ]);

    // Abort handling on non-streaming impersonate
    const abortHarness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "assistant", content: "Hi" })],
      },
      dryRunImpl: async () => ({
        messages: [{ role: "assistant", content: "Hi" }],
        parameters: { _streaming: false },
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
    });
    const abortBackend = registerBackend(abortHarness.api);
    const abortRes = await abortBackend.runner.run(
      { actionId: "guided_impersonate", chatId: "chat-1", inputText: "Outline" },
      "u1",
    );
    expect(abortRes.aborted).toBe(true);
    expect(abortRes.text).toBe("");
    const abortChunks = abortHarness.sentFrontend
      .filter((e) => (e.payload as BackendPushEvent).type === "gg:impersonate-chunk")
      .map((e) => e.payload as Extract<BackendPushEvent, { type: "gg:impersonate-chunk" }>);
    expect(abortChunks).toEqual([
      {
        type: "gg:impersonate-chunk",
        chatId: "chat-1",
        text: "",
        done: true,
        aborted: true,
      },
    ]);
  });

  test("honors already-fetched preset samplerOverrides.streaming === false without extra presets RPC and keeps rawStream when streaming is enabled with _streaming stripped", async () => {
    const presetDryRunParams: Record<string, unknown> = { temperature: 0.8 };
    const presetHarness = createSpindleHarness({
      presets: {
        "p-nostream": {
          id: "p-nostream",
          name: "No Stream Preset",
          parameters: { samplerOverrides: { streaming: false } },
        },
      },
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hi" })],
      },
      dryRunImpl: async () => ({
        messages: [{ role: "user", content: "Hi", __isChatHistory: true }],
        parameters: presetDryRunParams,
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async () => ({
        content: "Non-streamed preset reply",
        finish_reason: "stop",
      }),
      rawStreamImpl: async function* () {
        throw new Error("rawStream must not be called when already-fetched preset has streaming: false");
      },
    });
    const presetBackend = registerBackend(presetHarness.api);
    const s = await presetBackend.store.getSettings("u1");
    s.actions.guided_response.presetId = "p-nostream";
    await presetBackend.store.saveSettings(s, "u1");

    const presetRes = await presetBackend.runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Guide" },
      "u1",
    );
    expect(presetRes.text).toBe("Non-streamed preset reply");
    expect(presetHarness.rawCalls).toHaveLength(1);
    expect(presetHarness.rawStreamCalls).toHaveLength(0);
    // Only the single resolvePresetContext presets.get call should occur (no extra RPC).
    expect(presetHarness.presetGetCalls).toHaveLength(1);
    expect(presetHarness.rawCalls[0]?.parameters).toEqual({ temperature: 0.8 });
    expect(presetDryRunParams).toEqual({ temperature: 0.8 });

    // Streaming enabled (_streaming: true) still uses rawStream and strips _streaming
    const streamParams: Record<string, unknown> = { _streaming: true, temperature: 0.7 };
    const streamHarness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hi" })],
      },
      dryRunImpl: async () => ({
        messages: [{ role: "user", content: "Hi" }],
        parameters: streamParams,
        model: "gpt-4o",
        provider: "openai",
      }),
      rawImpl: async () => {
        throw new Error("raw must not be called when streaming is enabled");
      },
      rawStreamImpl: async function* () {
        yield { type: "token", token: "Streamed " };
        yield { type: "token", token: "reply" };
        yield { type: "done", content: "Streamed reply", finish_reason: "stop" };
      },
    });
    const streamBackend = registerBackend(streamHarness.api);
    const streamRes = await streamBackend.runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Stream it" },
      "u1",
    );
    expect(streamRes.text).toBe("Streamed reply");
    expect(streamHarness.rawStreamCalls).toHaveLength(1);
    expect(streamHarness.rawCalls).toHaveLength(0);
    expect(streamHarness.rawStreamCalls[0]?.parameters).toEqual({ temperature: 0.7 });
    expect("_streaming" in ((streamHarness.rawStreamCalls[0]?.parameters as Record<string, unknown>) ?? {})).toBe(false);
    expect(streamParams).toEqual({ _streaming: true, temperature: 0.7 });
  });
});
