import { describe, expect, test } from "bun:test";
import type {
  ChatMessageDTO,
  LlmMessageDTO,
  SpindleAPI,
  StreamChunkDTO,
} from "lumiverse-spindle-types";
import { registerBackend } from "../src/backend";
import { GuidedGenerationRunner } from "../src/backend/generation-runner";
import type { ChatMessageWithRole } from "../src/backend/prompt-builder";
import { SettingsStore } from "../src/backend/settings-store";
import { createDefaultSettings } from "../src/shared/defaults";
import type { BackendPushEvent, RpcReplyEnvelope } from "../src/shared/types";

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
  permissions?: Partial<Record<"generation" | "chats" | "chat_mutation" | "presets", boolean>>;
  chats?: Record<string, ChatMessageWithRole[]>;
  activeChatByUser?: Record<string, string | null>;
  presets?: Record<string, { id: string; name: string }>;
  writeError?: (path: string, userId?: string) => Error | null;
  writeDelayMs?: number;
  dryRunImpl?: (
    input: Record<string, unknown>,
    userId?: string,
  ) => Promise<Record<string, unknown>>;
  rawStreamImpl?: (
    input: Record<string, unknown> & { signal?: AbortSignal },
  ) => AsyncGenerator<StreamChunkDTO, void, void>;
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
    presets: true,
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
  const rawStreamCalls: Array<Record<string, unknown>> = [];
  const presetGetCalls: Array<{ id: string; userId?: string }> = [];
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
      list: async () => [
        {
          id: "conn-1",
          name: "Primary",
          provider: "openai",
          model: "gpt-4o",
          is_default: true,
        },
      ],
    },
    presets: {
      list: async () => ({
        data: Object.values(options.presets ?? { "p-1": { id: "p-1", name: "Default" } }),
        total: Object.keys(options.presets ?? { "p-1": true }).length,
      }),
      get: async (id: string, userId?: string) => {
        presetGetCalls.push({ id, userId });
        return options.presets?.[id] ?? null;
      },
    },
    chats: {
      get: async (chatId: string) => {
        return chatMessages.has(chatId) ? { id: chatId } : null;
      },
      getActive: async (userId?: string) => {
        const activeId =
          userId && userId in activeChatByUser
            ? activeChatByUser[userId]
            : activeChatByUser.__default__ ?? "chat-1";
        return activeId && chatMessages.has(activeId) ? { id: activeId } : null;
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
          swipes?: string[];
          swipe_id?: number;
          swipe_dates?: number[];
          reasoning?: { text?: string | null; duration?: number | null };
        },
      ) => {
        const defaultUpdate = async () => {
          const msgs = chatMessages.get(chatId) ?? [];
          const target = msgs.find((m) => m.id === messageId);
          if (!target) throw new Error(`Missing message ${messageId}`);
          if (patch.swipes) target.swipes = [...patch.swipes];
          if (typeof patch.swipe_id === "number") target.swipe_id = patch.swipe_id;
          if (patch.swipe_dates) target.swipe_dates = [...patch.swipe_dates];
          if (patch.content !== undefined) {
            target.content = patch.content;
            if (target.swipes.length > target.swipe_id) {
              target.swipes[target.swipe_id] = patch.content;
            }
          }
          if (patch.reasoning) {
            target.extra = {
              ...target.extra,
              ...(patch.reasoning.text !== undefined ? { reasoning: patch.reasoning.text } : {}),
              ...(patch.reasoning.duration !== undefined
                ? { reasoning_duration: patch.reasoning.duration }
                : {}),
            };
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
    rawStreamCalls,
    presetGetCalls,
    triggerFrontendMessage: (payload: unknown, userId: string) => {
      frontendMessageHandler?.(payload, userId);
    },
    triggerPermissionsChanged: () => {
      permissionsChangedHandler?.();
    },
    triggerEvent: (eventName: string, payload: unknown, userId?: string) => {
      for (const cb of eventHandlers.get(eventName) ?? []) {
        cb(payload, userId);
      }
    },
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
  test("guided_response uses request_messages, defers append until first token, and leaves no blank message on error/abort", async () => {
    let streamMode: "normal" | "pre-token-error" | "pre-token-abort" = "normal";
    let runnerRef: GuidedGenerationRunner;

    const harness = createSpindleHarness({
      chats: {
        "chat-1": [makeMessage({ id: "m1", role: "user", content: "Hello" })],
      },
      rawStreamImpl: async function* ({ signal }) {
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
        yield { type: "token", token: "Hi there!" };
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
    expect(harness.chatMessages.get("chat-1")?.length).toBe(1);

    streamMode = "pre-token-abort";
    const abortedRes = await runnerRef.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Be warm" },
      "u1",
    );
    expect(abortedRes.aborted).toBe(true);
    expect(abortedRes.messageId).toBeUndefined();
    expect(harness.chatMessages.get("chat-1")?.length).toBe(1);

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
    expect(sentMessages[0]?.content).toEqual([{ type: "text", text: "Rich prompt" }]);
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

  test("guided_swipe strips rejected assistant turn from prompt and defers creating swipe until first token", async () => {
    let emitTokens = false;
    const harness = createSpindleHarness({
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
      dryRunImpl: async () => ({
        messages: [
          { role: "user", content: "Knock knock" },
          { role: "assistant", content: "Rejected old swipe" },
        ],
        request_messages: [
          { role: "user", content: "Knock knock", sourceMessageId: "m1" },
          { role: "assistant", content: "Rejected old swipe", sourceMessageId: "m2" },
        ],
        parameters: {},
        model: "gpt-4o",
        provider: "openai",
      }),
      rawStreamImpl: async function* () {
        if (!emitTokens) {
          throw new Error("0-token failure");
        }
        yield { type: "token", token: "Who's there?" };
        yield { type: "done", content: "Who's there?", finish_reason: "stop" };
      },
    });

    const store = new SettingsStore(harness.api);
    const runner = new GuidedGenerationRunner(harness.api, store, () => {});

    // 0-token failure leaves original swipes & swipe_id intact.
    await expect(
      runner.run({ actionId: "guided_swipe", chatId: "chat-1", inputText: "Be mysterious" }, "u1"),
    ).rejects.toThrow("0-token failure");
    const untouched = harness.chatMessages.get("chat-1")![1]!;
    expect(untouched.swipes).toEqual(["Rejected old swipe"]);
    expect(untouched.swipe_id).toBe(0);

    // Rejected assistant message was stripped from rawStream input.
    const failedPrompt = harness.rawStreamCalls[0]?.messages as LlmMessageDTO[];
    expect(failedPrompt.some((m) => m.content === "Rejected old swipe")).toBe(false);
    expect(failedPrompt.map((m) => m.role)).toEqual(["user", "system"]);

    // Successful swipe appends & selects new swipe only once tokens arrive.
    emitTokens = true;
    const res = await runner.run(
      { actionId: "guided_swipe", chatId: "chat-1", inputText: "Be mysterious" },
      "u1",
    );
    expect(res.swipeId).toBe(1);
    expect(res.text).toBe("Who's there?");
    const updated = harness.chatMessages.get("chat-1")![1]!;
    expect(updated.swipes).toEqual(["Rejected old swipe", "Who's there?"]);
    expect(updated.swipe_id).toBe(1);
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
});
