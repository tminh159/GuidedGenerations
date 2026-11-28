import { describe, expect, test } from "bun:test";
import type {
  CharacterDTO,
  ChatDTO,
  ChatMessageDTO,
  InterceptorContextDTO,
  InterceptorHandler,
  LlmMessageDTO,
  MessageContentProcessorCtxDTO,
  MessageContentProcessorResultDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { registerBackend } from "../src/backend";
import { GuidedSceneManager } from "../src/backend/scene-manager";
import {
  encodeArmedScenePath,
  normalizeSettings,
  SettingsStore,
} from "../src/backend/settings-store";
import type { ArmedSceneState, BackendPushEvent, RpcReplyEnvelope } from "../src/shared/types";

interface MockHarnessOptions {
  permissions?: string[];
  chats?: Record<string, ChatDTO>;
  activeChatId?: string;
  characters?: Record<string, CharacterDTO>;
  messagesByChat?: Record<string, ChatMessageDTO[]>;
  streamChunks?: Array<{ type: "token"; token: string } | { type: "done"; content: string; finish_reason: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }>;
  onStreamStart?: (input: unknown, signal?: AbortSignal) => AsyncGenerator<unknown, void, void>;
  dryRunMessages?: LlmMessageDTO[];
  dryRunRequestMessages?: LlmMessageDTO[];
  regexScripts?: Array<{
    id: string;
    name: string;
    find_regex: string;
    replace_string: string;
    flags: string;
    placement: string[];
    target: string;
    disabled: boolean;
  }>;
  userMacroName?: string;
  personaMacroText?: string;
  withUuidV7?: boolean;
  withUi?: boolean;
  capabilities?: Record<string, number>;
  failAppendWithIdentityOnce?: boolean;
  onUserStorageList?: (prefix: string, userId?: string) => Promise<void>;
  onAppendMessage?: (chatId: string, message: unknown) => Promise<void>;
  onUpdateMessage?: (chatId: string, messageId: string, patch: unknown) => Promise<void>;
  onDryRun?: (input: unknown, userId?: string) => Promise<void>;
}

function createMockSpindle(opts: MockHarnessOptions = {}) {
  const perms = new Set<string>(
    opts.permissions ?? [
      "generation",
      "chats",
      "chat_mutation",
      "characters",
      "presets",
      "regex_scripts",
      "interceptor",
      "push_notification",
    ],
  );

  const userStorageFiles = new Map<string, Map<string, string>>();
  const getUserBucket = (userId?: string) => {
    const key = userId || "__default__";
    let bucket = userStorageFiles.get(key);
    if (!bucket) {
      bucket = new Map<string, string>();
      userStorageFiles.set(key, bucket);
    }
    return bucket;
  };

  const chats: Record<string, ChatDTO> = opts.chats ?? {
    "chat-1": {
      id: "chat-1",
      character_id: "char-1",
      name: "Solo Chat",
      metadata: { activeGreetingIndex: 0 },
      created_at: 1,
      updated_at: 1,
    },
  };

  const characters: Record<string, CharacterDTO> = opts.characters ?? {
    "char-1": {
      id: "char-1",
      name: "Alice",
      description: "A quick-witted investigator.",
      personality: "Curious and dry-humored.",
      scenario: "A rainy noir city.",
      first_mes: "Hello {{user}}, I am {{char}}.",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      tags: [],
      alternate_greetings: [
        "![rain](/api/v1/images/rain.png)\n\n{{char}} steps onto the neon-lit rooftop beside {{user}}.",
      ],
      creator: "",
      image_id: null,
      world_book_ids: [],
      extensions: {},
      created_at: 1,
      updated_at: 1,
    },
  };

  const messagesByChat: Record<string, ChatMessageDTO[]> = opts.messagesByChat ?? {
    "chat-1": [
      {
        id: "m1",
        chat_id: "chat-1",
        index_in_chat: 0,
        is_user: true,
        name: "Bob",
        content: "Let's head upstairs to the rooftop.",
        send_date: 100,
        swipe_id: 0,
        swipes: ["Let's head upstairs to the rooftop."],
        swipe_dates: [100],
        extra: {},
        parent_message_id: null,
        branch_id: null,
        created_at: 100,
      },
      {
        id: "m2",
        chat_id: "chat-1",
        index_in_chat: 1,
        is_user: false,
        name: "Alice",
        content: "Right behind you.",
        send_date: 101,
        swipe_id: 0,
        swipes: ["Right behind you."],
        swipe_dates: [101],
        extra: {},
        parent_message_id: "m1",
        branch_id: null,
        created_at: 101,
      },
    ],
  };

  const eventHandlers = new Map<string, Set<(payload: unknown, userId?: string) => void>>();
  const permChangedHandlers = new Set<(detail: unknown) => void>();
  let frontendMsgHandler: ((payload: unknown, userId: string) => void) | null = null;
  const sentToFrontend: Array<{ payload: unknown; userId?: string }> = [];

  let interceptorRegisterCount = 0;
  let interceptorDisposeCount = 0;
  let activeInterceptor: InterceptorHandler | null = null;

  let processorRegisterCount = 0;
  let activeProcessor:
    | ((ctx: MessageContentProcessorCtxDTO) => Promise<MessageContentProcessorResultDTO | void>)
    | null = null;

  let characterUpdateCalls = 0;
  let uuidV7Calls = 0;
  let closeDrawerCalls: Array<{ userId?: string } | undefined> = [];
  const appendCalls: Array<{ chatId: string; message: unknown }> = [];
  const updateCalls: Array<{ chatId: string; messageId: string; patch: unknown }> = [];
  const deleteCalls: Array<{ chatId: string; messageId: string }> = [];
  const dryRunCalls: Array<unknown> = [];
  const rawStreamCalls: Array<unknown> = [];
  const pushCalls: Array<{ input: unknown; userId?: string }> = [];
  let nextMsgNum = 100;
  let remainingIdentityFail = opts.failAppendWithIdentityOnce ? 1 : 0;

  const spindle = {
    host: {
      capabilities: opts.capabilities ?? {
        "uuid-v1": 1,
        "chat-append-identity-v1": 1,
      },
    },
    uuid: {
      v7: async () => {
        uuidV7Calls += 1;
        return `01900000-0000-7000-8000-00000000000${uuidV7Calls}`;
      },
      v4: async () => `00000000-0000-4000-8000-000000000001`,
    },
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    permissions: {
      has: (perm: string) => perms.has(perm),
      onChanged: (handler: (detail: unknown) => void) => {
        permChangedHandlers.add(handler);
        return () => permChangedHandlers.delete(handler);
      },
    },
    on: (event: string, handler: (payload: unknown, userId?: string) => void) => {
      let set = eventHandlers.get(event);
      if (!set) {
        set = new Set();
        eventHandlers.set(event, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    onFrontendMessage: (handler: (payload: unknown, userId: string) => void) => {
      frontendMsgHandler = handler;
      return () => {
        if (frontendMsgHandler === handler) frontendMsgHandler = null;
      };
    },
    sendToFrontend: (payload: unknown, userId?: string) => {
      sentToFrontend.push({ payload, userId });
    },
    // Realistic single-slot worker interceptor (matches Lumiverse worker-runtime.ts):
    // every registerInterceptor overwrites the slot, and calling its disposer clears the slot.
    registerInterceptor: (handler: InterceptorHandler) => {
      interceptorRegisterCount += 1;
      activeInterceptor = handler;
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        interceptorDisposeCount += 1;
        activeInterceptor = null;
      };
    },
    registerMessageContentProcessor: (
      handler: (
        ctx: MessageContentProcessorCtxDTO,
      ) => Promise<MessageContentProcessorResultDTO | void>,
    ) => {
      processorRegisterCount += 1;
      activeProcessor = handler;
    },
    userStorage: {
      exists: async (path: string, userId?: string) => getUserBucket(userId).has(path),
      read: async (path: string, userId?: string) => {
        const val = getUserBucket(userId).get(path);
        if (val === undefined) throw new Error(`File not found: ${path}`);
        return val;
      },
      write: async (path: string, data: string, userId?: string) => {
        getUserBucket(userId).set(path, data);
      },
      delete: async (path: string, userId?: string) => {
        getUserBucket(userId).delete(path);
      },
      list: async (prefix = "", userId?: string) => {
        if (opts.onUserStorageList) {
          await opts.onUserStorageList(prefix, userId);
        }
        const bucket = getUserBucket(userId);
        return Array.from(bucket.keys()).filter((k) => k.startsWith(prefix));
      },
    },
    chats: {
      get: async (chatId: string) => chats[chatId] ?? null,
      getActive: async () => chats[opts.activeChatId ?? "chat-1"] ?? null,
    },
    characters: {
      get: async (characterId: string) => characters[characterId] ?? null,
      update: async () => {
        characterUpdateCalls += 1;
        throw new Error("FORBIDDEN: Guided Scene must never call characters.update");
      },
    },
    chat: {
      getMessages: async (
        chatId: string,
        options?: { tail?: number; limit?: number; offset?: number },
      ) => {
        const list = (messagesByChat[chatId] ?? []).map((m) => ({
          ...m,
          role: m.is_user ? ("user" as const) : ("assistant" as const),
          hidden: false,
        }));
        if (options?.tail && options.tail > 0) {
          return list.slice(-options.tail);
        }
        if (typeof options?.limit === "number" && options.limit > 0) {
          const offset = typeof options.offset === "number" && options.offset > 0 ? options.offset : 0;
          return list.slice(offset, offset + options.limit);
        }
        return list;
      },
      appendMessage: async (chatId: string, message: { role: string; content: string; name?: string; characterId?: string; metadata?: Record<string, unknown> }) => {
        if (opts.onAppendMessage) {
          await opts.onAppendMessage(chatId, message);
        }
        appendCalls.push({ chatId, message });
        if (remainingIdentityFail > 0 && (message.name || message.characterId)) {
          remainingIdentityFail -= 1;
          throw new Error("Host does not support chat-append-identity-v1");
        }
        nextMsgNum += 1;
        const id = `msg-${nextMsgNum}`;
        const list = (messagesByChat[chatId] ??= []);
        list.push({
          id,
          chat_id: chatId,
          index_in_chat: list.length,
          is_user: message.role === "user",
          name: message.name ?? (message.role === "user" ? "Bob" : "Alice"),
          content: message.content,
          send_date: 200,
          swipe_id: 0,
          swipes: [message.content],
          swipe_dates: [200],
          extra: {},
          parent_message_id: list[list.length - 1]?.id ?? null,
          branch_id: null,
          created_at: 200,
        });
        return { id };
      },
      deleteMessage: async (chatId: string, messageId: string) => {
        deleteCalls.push({ chatId, messageId });
        const list = messagesByChat[chatId];
        if (list) {
          const idx = list.findIndex((m) => m.id === messageId);
          if (idx >= 0) list.splice(idx, 1);
        }
      },
      updateMessage: async (
        chatId: string,
        messageId: string,
        patch: { content?: string; swipes?: string[]; swipe_id?: number; swipe_dates?: number[] },
      ) => {
        if (opts.onUpdateMessage) {
          await opts.onUpdateMessage(chatId, messageId, patch);
        }
        updateCalls.push({ chatId, messageId, patch });
        const list = messagesByChat[chatId] ?? [];
        const target = list.find((m) => m.id === messageId);
        if (target) {
          if (Array.isArray(patch.swipes)) target.swipes = [...patch.swipes];
          if (typeof patch.swipe_id === "number") target.swipe_id = patch.swipe_id;
          if (Array.isArray(patch.swipe_dates)) target.swipe_dates = [...patch.swipe_dates];
          if (typeof patch.content === "string") {
            target.content = patch.content;
            target.swipes[target.swipe_id] = patch.content;
          }
        }
      },
    },
    connections: {
      list: async () => [
        {
          id: "conn-1",
          name: "Main OpenAI",
          provider: "openai",
          api_url: "https://api.example.com",
          model: "gpt-4o",
          preset_id: null,
          is_default: true,
          has_api_key: true,
          metadata: {},
          reasoning_bindings: null,
          created_at: 1,
          updated_at: 1,
        },
        {
          id: "conn-scene",
          name: "Scene Claude",
          provider: "anthropic",
          api_url: "https://api.anthropic.com",
          model: "claude-sonnet",
          preset_id: "preset-1",
          is_default: false,
          has_api_key: true,
          metadata: {},
          reasoning_bindings: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
      get: async (id: string) => {
        if (id === "conn-scene") {
          return {
            id: "conn-scene",
            name: "Scene Claude",
            provider: "anthropic",
            api_url: "https://api.anthropic.com",
            model: "claude-sonnet",
            preset_id: "preset-1",
            is_default: false,
            has_api_key: true,
            metadata: {},
            reasoning_bindings: null,
            created_at: 1,
            updated_at: 1,
          };
        }
        return null;
      },
    },
    presets: {
      list: async () => ({
        data: [{ id: "preset-1", name: "Cinematic Preset" }],
        total: 1,
      }),
      get: async (id: string) =>
        id === "preset-1"
          ? { id: "preset-1", name: "Cinematic Preset", parameters: {} }
          : null,
      getActive: async () => ({ preset_id: "preset-1" }),
    },
    regex_scripts: {
      getActive: async () => opts.regexScripts ?? [],
    },
    macros: {
      resolve: async (template: string) => {
        let text = template;
        if (opts.userMacroName !== undefined) {
          text = text.replace(/\{\{\s*user\s*\}\}/gi, opts.userMacroName);
        } else {
          text = text.replace(/\{\{\s*user\s*\}\}/gi, "Bob");
        }
        if (opts.personaMacroText !== undefined) {
          text = text.replace(/\{\{\s*persona\s*\}\}/gi, opts.personaMacroText);
        }
        return { text, diagnostics: [] };
      },
    },
    tokens: {
      countText: async (text: string) => ({
        total_tokens: Math.max(1, Math.ceil(text.length / 4)),
        model: "gpt-4o",
        modelSource: "explicit" as const,
        tokenizer_id: null,
        tokenizer_name: "approx",
        approximate: true,
      }),
    },
    push: {
      getStatus: async () => ({ available: true, subscriptionCount: 1 }),
      send: async (input: unknown, userId?: string) => {
        pushCalls.push({ input, userId });
        return { sent: 1 };
      },
    },
    ...(opts.withUi !== false
      ? {
          ui: {
            closeDrawer: async (options?: { userId?: string }) => {
              closeDrawerCalls.push(options);
            },
          },
        }
      : {}),
    generate: {
      dryRun: async (input: { chatId: string; presetId?: string; generationType?: string }, userId?: string) => {
        if (opts.onDryRun) {
          await opts.onDryRun(input, userId);
        }
        dryRunCalls.push(input);
        const assembled: LlmMessageDTO[] = opts.dryRunMessages ?? [
          { role: "system", content: "Preset system prompt + Lorebook." },
          { role: "user", content: "Let's head upstairs to the rooftop." },
        ];
        if (activeInterceptor) {
          await activeInterceptor(assembled, {
            chatId: input.chatId,
            userId: userId ?? "u1",
            generationId: "dry-1",
            generationType: (input.generationType ?? "normal") as InterceptorContextDTO["generationType"],
            isDryRun: true,
            presetId: input.presetId ?? null,
          } as unknown as InterceptorContextDTO);
        }
        return {
          messages: assembled,
          request_messages: opts.dryRunRequestMessages ?? assembled,
          breakdown: [],
          parameters: { temperature: 0.7 },
          model: "claude-sonnet",
          provider: "anthropic",
        };
      },
      rawStream: async function* (input: { signal?: AbortSignal }) {
        rawStreamCalls.push(input);
        if (opts.onStreamStart) {
          yield* opts.onStreamStart(input, input.signal) as AsyncGenerator<unknown, void, void>;
          return;
        }
        const chunks = opts.streamChunks ?? [
          { type: "token" as const, token: "Adapted rooftop scene with [[MEDIA_1]] intact." },
          {
            type: "done" as const,
            content: "Adapted rooftop scene with [[MEDIA_1]] intact.",
            finish_reason: "stop",
            usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          },
        ];
        for (const chunk of chunks) {
          yield chunk;
        }
      },
      raw: async (input: unknown) => {
        rawStreamCalls.push(input);
        return {
          content: "Non-stream scene output.",
          finish_reason: "stop",
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        };
      },
    },
  } as unknown as SpindleAPI;

  const emitEvent = (event: string, payload: unknown, userId?: string) => {
    const handlers = eventHandlers.get(event);
    if (!handlers) return;
    for (const h of handlers) {
      h(payload, userId);
    }
  };

  const setPermission = (perm: string, granted: boolean, userId?: string) => {
    if (granted) perms.add(perm);
    else perms.delete(perm);
    for (const h of permChangedHandlers) {
      h({ permission: perm, granted, userId });
    }
  };

  return {
    spindle,
    userStorageFiles,
    messagesByChat,
    sentToFrontend,
    appendCalls,
    updateCalls,
    deleteCalls,
    dryRunCalls,
    rawStreamCalls,
    pushCalls,
    closeDrawerCalls,
    emitEvent,
    setPermission,
    getStats: () => ({
      interceptorRegisterCount,
      interceptorDisposeCount,
      hasActiveInterceptor: activeInterceptor !== null,
      processorRegisterCount,
      hasActiveProcessor: activeProcessor !== null,
      characterUpdateCalls,
      uuidV7Calls,
    }),
    invokeInterceptor: async (messages: LlmMessageDTO[], ctx: Partial<InterceptorContextDTO>) => {
      if (!activeInterceptor) throw new Error("No active interceptor registered");
      return activeInterceptor(messages, {
        userId: "u1",
        chatId: "chat-1",
        generationId: "gen-1",
        generationType: "normal",
        isDryRun: false,
        presetId: null,
        presetMetadata: undefined,
        personaId: null,
        characterId: "char-1",
        personaAddonStates: {},
        ...ctx,
      } as InterceptorContextDTO);
    },
    invokeMessageProcessor: async (ctx: MessageContentProcessorCtxDTO) => {
      if (!activeProcessor) throw new Error("No active message content processor registered");
      return activeProcessor(ctx);
    },
  };
}

async function flushMicrotasks(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("Guided Scene backend integration", () => {
  test("zero-footprint dormancy: no startup interceptor, dynamic register/dispose on arm/pause/resume/cancel & permission change", async () => {
    const mock = createMockSpindle();
    const backend = registerBackend(mock.spindle);

    // Zero hooks at startup
    expect(mock.getStats().interceptorRegisterCount).toBe(0);
    expect(mock.getStats().processorRegisterCount).toBe(0);
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    expect(mock.getStats().characterUpdateCalls).toBe(0);

    // Bootstrap with no persisted scenes keeps interceptor idle
    const boot = await backend.buildBootstrapView("u1");
    expect(boot.armedScenes).toEqual([]);
    expect(boot.armedScene).toBeNull();
    expect(mock.getStats().interceptorRegisterCount).toBe(0);

    // Arm scene -> registers interceptor & message content processor & writes ephemeral file
    const armed = await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        selectedGreetingKey: "char-1:1",
        greetingLabel: "#2 Alternate Greeting",
        rawGreetingText: "{{char}} meets {{user}} on the roof.",
        transitionNote: "Bring them to the stairwell door.",
      },
      "u1",
    );
    expect(armed.status).toBe("armed");
    expect(mock.getStats().interceptorRegisterCount).toBe(1);
    expect(mock.getStats().hasActiveInterceptor).toBe(true);
    // Zero registerMessageContentProcessor footprint (leaves Lumiverse render cache untouched)
    expect(mock.getStats().processorRegisterCount).toBe(0);
    const storageFile = encodeArmedScenePath("chat-1");
    expect(mock.userStorageFiles.get("u1")?.has(storageFile)).toBe(true);

    // Pause -> immediately disposes interceptor while preserving persisted paused scene
    const paused = await backend.sceneManager.pauseScene("chat-1", "u1");
    expect(paused?.status).toBe("paused");
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    expect(mock.getStats().interceptorDisposeCount).toBe(1);

    // Resume -> re-registers interceptor
    const resumed = await backend.sceneManager.resumeScene("chat-1", "u1");
    expect(resumed?.status).toBe("armed");
    expect(mock.getStats().hasActiveInterceptor).toBe(true);
    expect(mock.getStats().interceptorRegisterCount).toBe(2);

    // Permission revocation -> immediately disposes interceptor
    mock.setPermission("interceptor", false, "u1");
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    mock.setPermission("interceptor", true, "u1");
    expect(mock.getStats().hasActiveInterceptor).toBe(true);

    // Cancel -> deletes ephemeral file & disposes interceptor
    const cancelled = await backend.sceneManager.cancelScene("chat-1", "u1");
    expect(cancelled).toEqual({ cancelled: true, chatId: "chat-1" });
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    expect(mock.userStorageFiles.get("u1")?.has(storageFile)).toBe(false);
    expect(mock.getStats().processorRegisterCount).toBe(0);
    expect(mock.getStats().characterUpdateCalls).toBe(0);

    backend.dispose();
  });

  test("persisted armed scene restores on bootstrap and registers interceptor automatically", async () => {
    const mock = createMockSpindle();
    const store = new SettingsStore(mock.spindle);
    await store.saveArmedScene(
      {
        chatId: "chat-1",
        userId: "u1",
        status: "armed",
        pacing: "next_turn",
        delivery: "time_skip",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Custom Scene",
        rawGreetingText: "Dawn breaks over the harbor.",
        transitionNote: "Fast-forward to morning.",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 5000,
      },
      "u1",
    );

    const backend = registerBackend(mock.spindle);
    expect(mock.getStats().hasActiveInterceptor).toBe(false);

    const boot = await backend.buildBootstrapView("u1");
    expect(boot.armedScenes).toHaveLength(1);
    expect(boot.armedScene?.chatId).toBe("chat-1");
    expect(mock.getStats().hasActiveInterceptor).toBe(true);
    expect(mock.getStats().processorRegisterCount).toBe(0);

    backend.dispose();
  });

  test("multi-user isolation: User A's armed scene never steers, strips, or drops for User B", async () => {
    const mock = createMockSpindle();
    const backend = registerBackend(mock.spindle);

    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "User A Secret Scene",
        rawGreetingText: "Secret rooftop rendezvous.",
      },
      "user-A",
    );

    // User B bootstrap and context see NO armed scene
    const bootB = await backend.buildBootstrapView("user-B");
    expect(bootB.armedScenes).toEqual([]);
    const ctxB = await backend.sceneManager.getSceneContext("chat-1", "user-B");
    expect(ctxB.armedScene).toBeNull();

    // Interceptor invoked for User B returns messages untouched
    const baseMsgs: LlmMessageDTO[] = [{ role: "user", content: "Hello" }];
    const outB = await mock.invokeInterceptor(baseMsgs, {
      chatId: "chat-1",
      userId: "user-B",
    });
    expect(outB).toEqual(baseMsgs);

    // Interceptor invoked for User A injects steering directive
    const outA = (await mock.invokeInterceptor(baseMsgs, {
      chatId: "chat-1",
      userId: "user-A",
    })) as LlmMessageDTO[];
    expect(outA.length).toBe(2);
    expect(String(outA[1]!.content)).toContain("<scene-ready />");

    // GENERATION_ENDED for User B does NOT drop User A's armed scene
    mock.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-b",
        chatId: "chat-1",
        messageId: "m-b",
        content: "User B reply <scene-ready />",
      },
      "user-B",
    );
    await flushMicrotasks();
    expect(mock.appendCalls).toHaveLength(0);
    expect(mock.userStorageFiles.get("user-A")?.has(encodeArmedScenePath("chat-1"))).toBe(true);

    backend.dispose();
  });

  test("<scene-ready /> stripping, multi-turn handoff, deduplication, and ephemeral cleanup", async () => {
    const mock = createMockSpindle();
    mock.messagesByChat["chat-1"]!.push({
      id: "m-lead-2",
      chat_id: "chat-1",
      index_in_chat: 2,
      is_user: false,
      name: "Alice",
      content: "Alice pushes open the door to the wet rooftop.\n<scene-ready />",
      send_date: 102,
      swipe_id: 0,
      swipes: ["Alice pushes open the door to the wet rooftop.\n<scene-ready />"],
      swipe_dates: [102],
      extra: {},
      parent_message_id: "m2",
      branch_id: null,
      created_at: 102,
    });
    const backend = registerBackend(mock.spindle);

    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        selectedGreetingKey: "char-1:1",
        greetingLabel: "#2 Alternate Greeting",
        rawGreetingText: "![rain](/api/v1/images/rain.png)\n\n{{char}} meets {{user}} in the rain.",
      },
      "u1",
    );

    // Turn 1: no <scene-ready /> -> stays armed, no drop
    mock.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-1",
        chatId: "chat-1",
        messageId: "m-lead-1",
        content: "We climb the stairs toward the heavy steel door.",
      },
      "u1",
    );
    await flushMicrotasks();
    expect(mock.appendCalls).toHaveLength(0);
    expect(mock.getStats().hasActiveInterceptor).toBe(true);

    // Turn 2: emit duplicate GENERATION_ENDED + GENERATION_STOPPED carrying <scene-ready />
    mock.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-2",
        chatId: "chat-1",
        messageId: "m-lead-2",
        content: "Alice pushes open the door to the wet rooftop.\n<scene-ready />",
      },
      "u1",
    );
    mock.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-2",
        chatId: "chat-1",
        messageId: "m-lead-2",
        content: "Alice pushes open the door to the wet rooftop.\n<scene-ready />",
      },
      "u1",
    );
    mock.emitEvent(
      "GENERATION_STOPPED",
      {
        generationId: "gen-2",
        chatId: "chat-1",
        messageId: "m-lead-2",
        content: "Alice pushes open the door to the wet rooftop. <scene-ready />",
      },
      "u1",
    );
    await flushMicrotasks();

    // Tag stripped from m-lead-2 via updateMessage
    expect(mock.messagesByChat["chat-1"]!.find((m) => m.id === "m-lead-2")?.content).toBe(
      "Alice pushes open the door to the wet rooftop.",
    );

    // Dropped AT MOST ONCE as a new AI message with macros resolved and media intact
    expect(mock.appendCalls).toHaveLength(1);
    const droppedMsg = mock.appendCalls[0]!.message as { role: string; content: string };
    expect(droppedMsg.role).toBe("assistant");
    expect(droppedMsg.content).toBe(
      "![rain](/api/v1/images/rain.png)\n\nAlice meets Bob in the rain.",
    );

    // Armed state cleared, ephemeral file deleted, interceptor disposed, gg:scene-updated pushed
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    expect(mock.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(false);
    const sceneEvents = mock.sentToFrontend
      .map((e) => e.payload as BackendPushEvent)
      .filter((e) => e.type === "gg:scene-updated");
    expect(sceneEvents.some((e) => e.reason === "dropped" && e.armedScene === null)).toBe(true);

    backend.dispose();
  });

  test("next_turn triggers unconditionally on next GENERATION_ENDED and strips unstripped <scene-ready /> fallback", async () => {
    const mock = createMockSpindle();
    mock.messagesByChat["chat-1"]!.push({
      id: "m-lead-3",
      chat_id: "chat-1",
      index_in_chat: 2,
      is_user: false,
      name: "Alice",
      content: "Stepping outside now.\n<scene-ready />",
      send_date: 105,
      swipe_id: 0,
      swipes: ["Stepping outside now.\n<scene-ready />"],
      swipe_dates: [105],
      extra: {},
      parent_message_id: "m2",
      branch_id: null,
      created_at: 105,
    });

    const backend = registerBackend(mock.spindle);
    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "time_skip",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Next Turn Scene",
        rawGreetingText: "Hours later, the rain stops.",
      },
      "u1",
    );

    // Host bypassed content processor and emitted GENERATION_ENDED with raw tag still present
    mock.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-3",
        chatId: "chat-1",
        messageId: "m-lead-3",
        content: "Stepping outside now.\n<scene-ready />",
      },
      "u1",
    );
    await flushMicrotasks();

    // Stripped from m-lead-3 via updateMessage AND dropped new scene message
    expect(mock.updateCalls.some((u) => u.messageId === "m-lead-3")).toBe(true);
    expect(mock.messagesByChat["chat-1"]!.find((m) => m.id === "m-lead-3")?.content).toBe(
      "Stepping outside now.",
    );
    expect(mock.appendCalls).toHaveLength(1);
    expect((mock.appendCalls[0]!.message as { content: string }).content).toBe(
      "Hours later, the rain stops.",
    );
    expect(mock.getStats().hasActiveInterceptor).toBe(false);

    backend.dispose();
  });

  test("hybrid rewrite timing on armed drop: unlocked adapts using latest history; locked drops verbatim with zero LLM", async () => {
    // 1. Unlocked armed context_adapt -> runs LLM at drop time with latest lead-in turn + restores omitted media
    const mockUnlocked = createMockSpindle({
      streamChunks: [
        { type: "token", token: "Freshly adapted after the stairwell sprint." },
        {
          type: "done",
          content: "Freshly adapted after the stairwell sprint.",
          finish_reason: "stop",
          usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
        },
      ],
    });
    const backend1 = registerBackend(mockUnlocked.spindle);

    await backend1.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "card",
        selectedGreetingKey: "char-1:1",
        greetingLabel: "#2 Alternate Greeting",
        rawGreetingText:
          "![rain](/api/v1/images/rain.png)\n\n{{char}} meets {{user}} on the rooftop.",
        draftLocked: false,
      },
      "u1",
    );

    // Add a new lead-in message before GENERATION_ENDED
    mockUnlocked.messagesByChat["chat-1"]!.push({
      id: "m-lead-new",
      chat_id: "chat-1",
      index_in_chat: 2,
      is_user: false,
      name: "Alice",
      content: "We sprinted up the stairwell out of breath.",
      send_date: 120,
      swipe_id: 0,
      swipes: ["We sprinted up the stairwell out of breath."],
      swipe_dates: [120],
      extra: {},
      parent_message_id: "m2",
      branch_id: null,
      created_at: 120,
    });

    mockUnlocked.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-unlocked",
        chatId: "chat-1",
        messageId: "m-lead-new",
        content: "We sprinted up the stairwell out of breath.",
      },
      "u1",
    );
    await flushMicrotasks(12);

    // LLM was called with latest history and omitted leading media slot was re-anchored at top!
    expect(mockUnlocked.rawStreamCalls).toHaveLength(1);
    const llmReq = mockUnlocked.rawStreamCalls[0] as { messages: LlmMessageDTO[] };
    expect(JSON.stringify(llmReq.messages)).toContain("sprinted up the stairwell");
    const lastMsg =
      mockUnlocked.messagesByChat["chat-1"]![mockUnlocked.messagesByChat["chat-1"]!.length - 1]!;
    expect(lastMsg.content).toBe(
      "![rain](/api/v1/images/rain.png)\n\nFreshly adapted after the stairwell sprint.",
    );
    expect(mockUnlocked.getStats().uuidV7Calls).toBe(1);
    expect(mockUnlocked.pushCalls).toHaveLength(1);
    backend1.dispose();

    // 2. Locked armed context_adapt -> drops locked draft directly with ZERO LLM calls
    const mockLocked = createMockSpindle();
    const backend2 = registerBackend(mockLocked.spindle);
    await backend2.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "card",
        rawGreetingText: "Original text",
        lockedDraftText: "User hand-edited locked preview for {{user}}.",
        draftLocked: true,
      },
      "u1",
    );

    mockLocked.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-locked",
        chatId: "chat-1",
        messageId: "m-lead-locked",
        content: "Lead-in reply.",
      },
      "u1",
    );
    await flushMicrotasks();

    expect(mockLocked.rawStreamCalls).toHaveLength(0);
    expect(mockLocked.appendCalls).toHaveLength(1);
    expect((mockLocked.appendCalls[0]!.message as { content: string }).content).toBe(
      "User hand-edited locked preview for Bob.",
    );
    backend2.dispose();
  });

  test("Drop Now supports verbatim+cut (zero-LLM), new_swipe + fallback, verbatim+bridge, rewrite+regex+metrics, and AbortController", async () => {
    // 1. Verbatim + Hard Cut without generation permission -> instant zero-LLM drop
    const mockZeroLlm = createMockSpindle({
      permissions: ["chats", "chat_mutation", "characters"],
    });
    const mgrZero = new GuidedSceneManager(
      mockZeroLlm.spindle,
      new SettingsStore(mockZeroLlm.spindle),
      () => {},
    );
    const resCut = await mgrZero.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        rawGreetingText: "![img](/a.png)\n\nHello {{user}} from {{char}}.",
        dropTarget: "new_message",
      },
      "u1",
    );
    expect(resCut.dropTarget).toBe("new_message");
    expect(resCut.text).toBe("![img](/a.png)\n\nHello Bob from Alice.");
    expect(mockZeroLlm.rawStreamCalls).toHaveLength(0);

    // 2. Drop Now as new_swipe onto last assistant message
    const resSwipe = await mgrZero.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Swiped scene text.",
        dropTarget: "new_swipe",
      },
      "u1",
    );
    expect(resSwipe.dropTarget).toBe("new_swipe");
    expect(resSwipe.swipeId).toBe(1);
    mgrZero.dispose();

    // 3. Verbatim + Time Skip -> streams concise bridge above --- while keeping greeting 100% verbatim
    const mockBridge = createMockSpindle({
      streamChunks: [
        { type: "token", token: "Three hours slip by in quiet rain." },
        {
          type: "done",
          content: "Three hours slip by in quiet rain.",
          finish_reason: "stop",
        },
      ],
    });
    const eventsBridge: BackendPushEvent[] = [];
    const mgrBridge = new GuidedSceneManager(
      mockBridge.spindle,
      new SettingsStore(mockBridge.spindle),
      (ev) => eventsBridge.push(ev),
    );
    const resBridge = await mgrBridge.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "time_skip",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        rawGreetingText: "{{char}} leans against the railing.",
        dropTarget: "new_message",
      },
      "u1",
    );
    expect(resBridge.text).toBe(
      "Three hours slip by in quiet rain.\n\n---\n\nAlice leans against the railing.",
    );
    expect(eventsBridge.some((e) => e.type === "gg:status" && e.run?.actionId === "guided_scene")).toBe(
      true,
    );
    expect(eventsBridge.some((e) => e.type === "gg:generation_metrics")).toBe(true);
    mgrBridge.dispose();

    // 4. Context Adapt + full_preset + applyRegex + keepMediaIntact -> temporary dryRun capture disposes interceptor after!
    const mockFull = createMockSpindle({
      regexScripts: [
        {
          id: "rx-1",
          name: "Clean word",
          find_regex: "TEMPWORD",
          replace_string: "POLISHED",
          flags: "g",
          placement: ["ai_output"],
          target: "response",
          disabled: false,
        },
      ],
      streamChunks: [
        { type: "token", token: "A TEMPWORD scene with [[MEDIA_1]]." },
        {
          type: "done",
          content: "A TEMPWORD scene with [[MEDIA_1]].",
          finish_reason: "stop",
        },
      ],
    });
    const storeFull = new SettingsStore(mockFull.spindle);
    await storeFull.saveSettings(
      {
        guidedScene: {
          contextMode: "full_preset",
          connectionId: "conn-scene",
          presetId: "preset-1",
          applyRegex: true,
          keepMediaIntact: true,
        },
      },
      "u1",
    );
    const mgrFull = new GuidedSceneManager(mockFull.spindle, storeFull, () => {});
    const preview = await mgrFull.previewSceneDraft(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "card",
        rawGreetingText: '<img src="/api/v1/images/hero.webp" alt="hero" /> Original.',
      },
      "u1",
    );
    expect(preview.text).toBe('A POLISHED scene with <img src="/api/v1/images/hero.webp" alt="hero" />.');
    // Preview must NOT modify chat, and dryRun interceptor must be disposed immediately!
    expect(mockFull.appendCalls).toHaveLength(0);
    expect(mockFull.updateCalls).toHaveLength(0);
    expect(mockFull.getStats().hasActiveInterceptor).toBe(false);
    mgrFull.dispose();

    // 5. AbortController cancellation via abort_action RPC
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const mockAbort = createMockSpindle({
      onStreamStart: async function* (_input, signal) {
        yield { type: "token", token: "Partial start..." };
        await streamGate;
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        yield { type: "done", content: "Partial start...", finish_reason: "stop" };
      },
    });
    const backendAbort = registerBackend(mockAbort.spindle);
    const dropPromise = backendAbort.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "summary_rewrite",
        greetingSource: "custom",
        rawGreetingText: "Target premise",
      },
      "u1",
    );
    await flushMicrotasks();
    const aborted = backendAbort.sceneManager.abortCurrent("u1", undefined, "chat-1");
    expect(aborted).toBe(true);
    releaseStream();
    const abortResult = await dropPromise;
    expect(abortResult.aborted).toBe(true);
    backendAbort.dispose();
  });

  test("group chat pooling, opening detection, and owner-aware speaker attribution", async () => {
    const mock = createMockSpindle({
      chats: {
        "group-1": {
          id: "group-1",
          character_id: "char-a",
          name: "Tavern Group",
          metadata: {
            group: true,
            character_ids: ["char-a", "char-b"],
            activeGreetingIndex: 1,
            openingCharacterId: "char-a",
          },
          created_at: 1,
          updated_at: 1,
        },
      },
      characters: {
        "char-a": {
          id: "char-a",
          name: "Aria",
          description: "Bard",
          personality: "Cheerful",
          scenario: "Tavern",
          first_mes: "{{char}} tunes her lute for {{user}}.",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          alternate_greetings: ["{{char}} waves from the bar to {{user}}."],
          creator: "",
          image_id: null,
          world_book_ids: [],
          extensions: {},
          created_at: 1,
          updated_at: 1,
        },
        "char-b": {
          id: "char-b",
          name: "Bram",
          description: "Blacksmith",
          personality: "Gruff",
          scenario: "Forge",
          first_mes: "{{char}} slams the hammer down as {{user}} enters.",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          alternate_greetings: [],
          creator: "",
          image_id: null,
          world_book_ids: [],
          extensions: {},
          created_at: 1,
          updated_at: 1,
        },
      },
      messagesByChat: { "group-1": [] },
    });

    const backend = registerBackend(mock.spindle);
    const ctx = await backend.sceneManager.getSceneContext("group-1", "u1");
    expect(ctx.isGroup).toBe(true);
    expect(ctx.members).toEqual([
      { id: "char-a", name: "Aria" },
      { id: "char-b", name: "Bram" },
    ]);
    expect(ctx.greetings).toHaveLength(3);
    expect(ctx.greetings.find((g) => g.key === "char-a:1")?.isOpening).toBe(true);
    expect(ctx.greetings.find((g) => g.key === "char-a:0")?.isOpening).toBe(false);
    expect(ctx.greetings.find((g) => g.key === "char-b:0")?.characterName).toBe("Bram");
    expect(ctx.canSwipeLastAssistant).toBe(false);

    // Drop Bram's greeting -> {{char}} resolves to Bram (NOT Aria!) and appendMessage carries Bram's identity
    const dropped = await backend.sceneManager.dropSceneNow(
      {
        chatId: "group-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        selectedGreetingKey: "char-b:0",
        rawGreetingText: "{{char}} slams the hammer down as {{user}} enters.",
        speakerCharacterId: "char-b",
        speakerCharacterName: "Bram",
        dropTarget: "new_swipe", // No assistant messages yet -> falls back to new_message
      },
      "u1",
    );

    expect(dropped.dropTarget).toBe("new_message");
    expect(dropped.text).toBe("Bram slams the hammer down as Bob enters.");
    expect(mock.appendCalls[0]!.message).toMatchObject({
      role: "assistant",
      name: "Bram",
      characterId: "char-b",
      content: "Bram slams the hammer down as Bob enters.",
    });
    expect(mock.getStats().characterUpdateCalls).toBe(0);

    backend.dispose();
  });

  test("RPC dispatch for mid-flight controls, close_drawer, and guidedScene settings normalization", async () => {
    const mock = createMockSpindle();
    const backend = registerBackend(mock.spindle);

    const callRpc = async <T = unknown>(action: string, input?: unknown): Promise<T> => {
      const reqId = `req-${Date.now()}-${action}`;
      await backend.handleRpc(
        { type: "gg:rpc", requestId: reqId, action: action as never, input },
        "u1",
      );
      const reply = [...mock.sentToFrontend]
        .reverse()
        .map((e) => e.payload as RpcReplyEnvelope)
        .find((p) => p.type === "gg:reply" && p.requestId === reqId);
      if (!reply) throw new Error(`Missing reply for ${action}`);
      if (reply.error) throw new Error(reply.error);
      return reply.result as T;
    };

    // arm -> update -> drop_next_turn -> cancel via RPC
    const armed = await callRpc<{ pacing: string; transitionNote: string }>("arm_scene", {
      chatId: "chat-1",
      pacing: "multi_turn",
      delivery: "bridge",
      adjustmentMode: "verbatim",
      greetingSource: "custom",
      rawGreetingText: "Scene A",
      transitionNote: "Initial note",
    });
    expect(armed.pacing).toBe("multi_turn");

    const updated = await callRpc<{ transitionNote: string; rawGreetingText: string }>(
      "update_armed_scene",
      {
        chatId: "chat-1",
        transitionNote: "Updated live note",
        rawGreetingText: "Scene B",
      },
    );
    expect(updated.transitionNote).toBe("Updated live note");
    expect(updated.rawGreetingText).toBe("Scene B");

    const nextTurn = await callRpc<{ pacing: string; status: string }>("drop_next_turn", {
      chatId: "chat-1",
    });
    expect(nextTurn.pacing).toBe("next_turn");
    expect(nextTurn.status).toBe("armed");

    const closeRes = await callRpc<{ closed: boolean }>("close_drawer");
    expect(closeRes).toEqual({ closed: true });
    expect(mock.closeDrawerCalls).toEqual([{ userId: "u1" }]);

    const cancelRes = await callRpc<{ cancelled: boolean }>("cancel_scene", {
      chatId: "chat-1",
    });
    expect(cancelRes.cancelled).toBe(true);

    // Settings normalization for guidedScene global profile + sticky workbench defaults
    const normalized = normalizeSettings({
      guidedScene: {
        enabled: false,
        connectionId: " conn-scene ",
        model: " claude-sonnet ",
        presetId: " preset-1 ",
        contextMode: "full_preset",
        contextTurns: 999,
        injectionRole: "user",
        guidancePosition: "append_last_user",
        guidanceDepth: 3,
        keepMediaIntact: false,
        applyRegex: false,
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "summary_rewrite",
        dropTarget: "new_swipe",
        readinessTag: "<my-handoff />",
      },
    });
    expect(normalized.guidedScene.enabled).toBe(false);
    expect(normalized.guidedScene.connectionId).toBe("conn-scene");
    expect(normalized.guidedScene.model).toBe("claude-sonnet");
    expect(normalized.guidedScene.presetId).toBe("preset-1");
    expect(normalized.guidedScene.contextMode).toBe("full_preset");
    expect(normalized.guidedScene.contextTurns).toBe(200);
    expect(normalized.guidedScene.injectionRole).toBe("user");
    expect(normalized.guidedScene.guidancePosition).toBe("append_last_user");
    expect(normalized.guidedScene.guidanceDepth).toBe(3);
    expect(normalized.guidedScene.keepMediaIntact).toBe(false);
    expect(normalized.guidedScene.applyRegex).toBe(false);
    expect(normalized.guidedScene.pacing).toBe("multi_turn");
    expect(normalized.guidedScene.delivery).toBe("bridge");
    expect(normalized.guidedScene.adjustmentMode).toBe("summary_rewrite");
    expect(normalized.guidedScene.dropTarget).toBe("new_swipe");
    expect(normalized.guidedScene.readinessTag).toBe("my-handoff");

    backend.dispose();
  });

  test("dropSceneNow disarms active steering (instant & streaming) and cleans ephemeral file + interceptor", async () => {
    // 1. Instant zero-LLM dropSceneNow while armed
    const mockInstant = createMockSpindle();
    const backend1 = registerBackend(mockInstant.spindle);
    await backend1.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Rooftop drop now!",
      },
      "u1",
    );
    expect(mockInstant.getStats().hasActiveInterceptor).toBe(true);
    expect(mockInstant.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(true);

    const instantRes = await backend1.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Rooftop drop now!",
        dropTarget: "new_message",
      },
      "u1",
    );
    expect(instantRes.aborted).toBe(false);
    expect(mockInstant.getStats().hasActiveInterceptor).toBe(false);
    expect(mockInstant.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(false);
    const ctx1 = await backend1.sceneManager.getSceneContext("chat-1", "u1");
    expect(ctx1.armedScene).toBeNull();
    expect(
      mockInstant.sentToFrontend
        .map((e) => e.payload as BackendPushEvent)
        .some((e) => e.type === "gg:scene-updated" && e.reason === "dropped" && e.armedScene === null),
    ).toBe(true);
    backend1.dispose();

    // 2. Streaming dropSceneNow while armed
    const mockStream = createMockSpindle();
    const backend2 = registerBackend(mockStream.spindle);
    await backend2.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Streamed rooftop scene.",
      },
      "u1",
    );
    expect(mockStream.getStats().hasActiveInterceptor).toBe(true);

    const streamRes = await backend2.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Streamed rooftop scene.",
        dropTarget: "new_message",
      },
      "u1",
    );
    expect(streamRes.aborted).toBe(false);
    expect(mockStream.getStats().hasActiveInterceptor).toBe(false);
    expect(mockStream.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(false);
    backend2.dispose();
  });

  test("CHAT_DELETED cleans up armed memory, ephemeral storage, and interceptor with user isolation", async () => {
    const mock = createMockSpindle();
    const backend = registerBackend(mock.spindle);

    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "User A scene",
      },
      "user-A",
    );
    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "User B scene",
      },
      "user-B",
    );
    expect(mock.getStats().hasActiveInterceptor).toBe(true);

    // Deleting chat-1 for user-A cleans ONLY user-A, keeping user-B armed
    mock.emitEvent("CHAT_DELETED", { chatId: "chat-1" }, "user-A");
    await flushMicrotasks();
    expect(mock.userStorageFiles.get("user-A")?.has(encodeArmedScenePath("chat-1"))).toBe(false);
    expect(mock.userStorageFiles.get("user-B")?.has(encodeArmedScenePath("chat-1"))).toBe(true);
    expect(mock.getStats().hasActiveInterceptor).toBe(true);
    expect(
      mock.sentToFrontend.some(
        (e) =>
          e.userId === "user-A" &&
          (e.payload as BackendPushEvent).type === "gg:scene-updated" &&
          (e.payload as BackendPushEvent).reason === "chat_deleted",
      ),
    ).toBe(true);

    // Deleting chat-1 for user-B cleans user-B and disposes interceptor
    mock.emitEvent("CHAT_DELETED", { id: "chat-1" }, "user-B");
    await flushMicrotasks();
    expect(mock.userStorageFiles.get("user-B")?.has(encodeArmedScenePath("chat-1"))).toBe(false);
    expect(mock.getStats().hasActiveInterceptor).toBe(false);

    backend.dispose();
  });

  test("zero-output abort/error cleans up blank message or rolls back blank swipe, and appendMessage gates chat-append-identity-v1", async () => {
    // 1. Zero-output abort on new_message deletes the blank created slot
    let releaseAbort!: () => void;
    const gate = new Promise<void>((r) => {
      releaseAbort = r;
    });
    const mockMsgAbort = createMockSpindle({
      onStreamStart: async function* (_input, signal) {
        await gate;
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
      },
    });
    const backend1 = registerBackend(mockMsgAbort.spindle);
    const p1 = backend1.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "card",
        rawGreetingText: "![img](/a.png)\n\nOriginal prose",
        dropTarget: "new_message",
      },
      "u1",
    );
    await flushMicrotasks();
    expect(backend1.sceneManager.abortCurrent("u1", undefined, "chat-1")).toBe(true);
    releaseAbort();
    const res1 = await p1;
    expect(res1.aborted).toBe(true);
    expect(res1.text).toBe("");
    expect(res1.messageId).toBeUndefined();
    expect(mockMsgAbort.deleteCalls).toHaveLength(1);
    expect(mockMsgAbort.messagesByChat["chat-1"]).toHaveLength(2);
    backend1.dispose();

    // 2. Zero-output error on new_swipe rolls back the blank added swipe
    const mockSwipeErr = createMockSpindle({
      onStreamStart: async function* () {
        throw new Error("Upstream 500");
      },
    });
    const backend2 = registerBackend(mockSwipeErr.spindle);
    await expect(
      backend2.sceneManager.dropSceneNow(
        {
          chatId: "chat-1",
          delivery: "bridge",
          adjustmentMode: "summary_rewrite",
          greetingSource: "custom",
          rawGreetingText: "Premise",
          dropTarget: "new_swipe",
        },
        "u1",
      ),
    ).rejects.toThrow("Upstream 500");
    const lastAssistant = mockSwipeErr.messagesByChat["chat-1"]!.find((m) => m.id === "m2")!;
    expect(lastAssistant.swipes).toEqual(["Right behind you."]);
    expect(lastAssistant.swipe_id).toBe(0);
    backend2.dispose();

    // 3. chat-append-identity-v1 gating: omits name/characterId when capability is absent
    const mockOlderHost = createMockSpindle({
      capabilities: { "uuid-v1": 1 },
    });
    const backend3 = registerBackend(mockOlderHost.spindle);
    await backend3.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        rawGreetingText: "Hello {{user}} from {{char}}.",
        speakerCharacterId: "char-1",
        speakerCharacterName: "Alice",
      },
      "u1",
    );
    const olderPayload = mockOlderHost.appendCalls[0]!.message as Record<string, unknown>;
    expect(olderPayload.content).toBe("Hello Bob from Alice.");
    expect("name" in olderPayload).toBe(false);
    expect("characterId" in olderPayload).toBe(false);
    backend3.dispose();

    // 4. Fallback retry without identity if host rejects identity fields
    const mockRetry = createMockSpindle({
      capabilities: { "uuid-v1": 1, "chat-append-identity-v1": 1 },
      failAppendWithIdentityOnce: true,
    });
    const backend4 = registerBackend(mockRetry.spindle);
    const retryRes = await backend4.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "card",
        rawGreetingText: "Fallback test.",
        speakerCharacterId: "char-1",
        speakerCharacterName: "Alice",
      },
      "u1",
    );
    expect(retryRes.messageId).toBeDefined();
    expect(mockRetry.appendCalls).toHaveLength(2);
    expect("characterId" in (mockRetry.appendCalls[0]!.message as Record<string, unknown>)).toBe(
      true,
    );
    expect("characterId" in (mockRetry.appendCalls[1]!.message as Record<string, unknown>)).toBe(
      false,
    );
    backend4.dispose();
  });

  test("#58 Critical #1: InterceptorMux preserves armed steering across runner.run(guided_response) on single-slot host", async () => {
    const mock = createMockSpindle();
    const backend = registerBackend(mock.spindle);

    // 1. Arm a Guided Scene -> InterceptorMux registers host interceptor (0 -> 1)
    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "The hidden vault doors swing open.",
      },
      "u1",
    );
    expect(mock.getStats().interceptorRegisterCount).toBe(1);
    expect(mock.getStats().interceptorDisposeCount).toBe(0);
    expect(mock.getStats().hasActiveInterceptor).toBe(true);

    // 2. Run Guided Response (uses dryRunWithCapture via shared InterceptorMux: 1 -> 2 -> 1)
    const runRes = await backend.runner.run(
      {
        actionId: "guided_response",
        chatId: "chat-1",
        inputText: "Build suspense near the vault.",
      },
      "u1",
    );
    expect(runRes.aborted).toBe(false);

    // Host interceptor slot was NEVER overwritten or disposed!
    expect(mock.getStats().interceptorRegisterCount).toBe(1);
    expect(mock.getStats().interceptorDisposeCount).toBe(0);
    expect(mock.getStats().hasActiveInterceptor).toBe(true);

    // Subsequent normal generation STILL receives Guided Scene steering!
    const steered = (await mock.invokeInterceptor(
      [{ role: "user", content: "We reach the steel archway." }],
      { chatId: "chat-1", userId: "u1", generationType: "normal", isDryRun: false },
    )) as LlmMessageDTO[];
    expect(steered.length).toBe(2);
    expect(String(steered[1]!.content)).toContain("hidden vault doors");

    // 3. Cancel armed scene -> 1 -> 0 immediately disposes host interceptor
    await backend.sceneManager.cancelScene("chat-1", "u1");
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    expect(mock.getStats().interceptorDisposeCount).toBe(1);

    backend.dispose();
  });

  test("#57 High #1: concurrent hydrateUserArmedScenes awaits in-flight read and never resurrects cancelled scenes", async () => {
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const mock = createMockSpindle({
      onUserStorageList: async () => {
        await listGate;
      },
    });
    const preStore = new SettingsStore(mock.spindle);
    await preStore.saveArmedScene(
      {
        chatId: "chat-1",
        userId: "u1",
        status: "armed",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Persisted Scene",
        rawGreetingText: "Harbor fog.",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 1000,
      },
      "u1",
    );

    // A: Two concurrent hydration callers BOTH receive the restored scene
    const backend1 = registerBackend(mock.spindle);
    const h1 = backend1.sceneManager.hydrateUserArmedScenes("u1");
    const h2 = backend1.sceneManager.hydrateUserArmedScenes("u1");
    releaseList();
    const [res1, res2] = await Promise.all([h1, h2]);
    expect(res1).toHaveLength(1);
    expect(res2).toHaveLength(1);
    backend1.dispose();

    // B: Cancelling during an in-flight hydration must NOT be resurrected when hydration completes
    let releaseList2!: () => void;
    const listGate2 = new Promise<void>((resolve) => {
      releaseList2 = resolve;
    });
    const mock2 = createMockSpindle({
      onUserStorageList: async () => {
        await listGate2;
      },
    });
    const preStore2 = new SettingsStore(mock2.spindle);
    await preStore2.saveArmedScene(
      {
        chatId: "chat-1",
        userId: "u1",
        status: "armed",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Persisted Scene",
        rawGreetingText: "Harbor fog.",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 1000,
      },
      "u1",
    );

    const backend2 = registerBackend(mock2.spindle);
    const inflightHydration = backend2.sceneManager.hydrateUserArmedScenes("u1");
    await flushMicrotasks(2);
    await backend2.sceneManager.cancelScene("chat-1", "u1");
    releaseList2();
    const afterHydrate = await inflightHydration;
    expect(afterHydrate).toEqual([]);
    expect(mock2.getStats().hasActiveInterceptor).toBe(false);
    backend2.dispose();
  });

  test("#57 High #2: shared inFlightDrops lock prevents rapid dropSceneNow double-click and armed GENERATION_ENDED double-drop", async () => {
    let releaseAppend!: () => void;
    const appendGate = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const mock = createMockSpindle({
      onAppendMessage: async () => {
        await appendGate;
      },
    });
    const backend = registerBackend(mock.spindle);
    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Single drop only.",
      },
      "u1",
    );

    // Start first Drop Now (blocked inside appendMessage)
    const drop1 = backend.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Single drop only.",
      },
      "u1",
    );

    // Rapid second Drop Now rejects synchronously on shared lock
    await expect(
      backend.sceneManager.dropSceneNow(
        {
          chatId: "chat-1",
          delivery: "cut",
          adjustmentMode: "verbatim",
          greetingSource: "custom",
          rawGreetingText: "Single drop only.",
        },
        "u1",
      ),
    ).rejects.toThrow("already running");

    // Concurrent GENERATION_ENDED while Drop Now is in flight is ignored
    mock.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-race",
        chatId: "chat-1",
        messageId: "m-race",
        content: "Lead-in turn <scene-ready />",
      },
      "u1",
    );
    await flushMicrotasks();

    releaseAppend();
    const res = await drop1;
    expect(res.aborted).toBe(false);
    await flushMicrotasks();
    expect(mock.appendCalls).toHaveLength(1);
    expect(mock.getStats().hasActiveInterceptor).toBe(false);
    backend.dispose();
  });

  test("#57 High #3 & Medium #4 & Low #12: new_swipe checks trailing turn only, excludes rejected assistant turn, and merges consecutive roles", async () => {
    // 1. Trailing user message -> canSwipeLastAssistant is false, new_swipe falls back to new_message
    const mockUserTail = createMockSpindle({
      messagesByChat: {
        "chat-1": [
          {
            id: "m1",
            chat_id: "chat-1",
            index_in_chat: 0,
            is_user: false,
            name: "Alice",
            content: "Older assistant message.",
            send_date: 100,
            swipe_id: 0,
            swipes: ["Older assistant message."],
            swipe_dates: [100],
            extra: {},
            parent_message_id: null,
            branch_id: null,
            created_at: 100,
          },
          {
            id: "m2",
            chat_id: "chat-1",
            index_in_chat: 1,
            is_user: true,
            name: "Bob",
            content: "User reply after assistant.",
            send_date: 101,
            swipe_id: 0,
            swipes: ["User reply after assistant."],
            swipe_dates: [101],
            extra: {},
            parent_message_id: "m1",
            branch_id: null,
            created_at: 101,
          },
        ],
      },
    });
    const backendUserTail = registerBackend(mockUserTail.spindle);
    const ctx = await backendUserTail.sceneManager.getSceneContext("chat-1", "u1");
    expect(ctx.canSwipeLastAssistant).toBe(false);

    const dropped = await backendUserTail.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Appended cleanly.",
        dropTarget: "new_swipe",
      },
      "u1",
    );
    expect(dropped.dropTarget).toBe("new_message");
    expect(mockUserTail.messagesByChat["chat-1"]![0]!.swipes).toEqual(["Older assistant message."]);
    expect(mockUserTail.appendCalls).toHaveLength(1);
    backendUserTail.dispose();

    // 2. Trailing assistant message with new_swipe LLM drop + full_preset post-processing fidelity
    const mockLightweight = createMockSpindle();
    const backendLight = registerBackend(mockLightweight.spindle);
    await backendLight.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "New scene on swipe.",
        dropTarget: "new_swipe",
      },
      "u1",
    );
    const lightReq = mockLightweight.rawStreamCalls[0] as { messages: LlmMessageDTO[] };
    expect(JSON.stringify(lightReq.messages)).not.toContain("Right behind you.");
    expect(JSON.stringify(lightReq.messages)).toContain("head upstairs to the rooftop");
    backendLight.dispose();

    // 2a. Unmerged preset (promptPostProcessing: "none") preserves separate system prompt blocks in preview & drop
    const mockFullUnmerged = createMockSpindle({
      dryRunMessages: [
        { role: "system", content: "Main system prompt." },
        { role: "system", content: "Character description." },
        { role: "system", content: "Personality and scenario." },
        { role: "user", content: "Let's head upstairs.", __isChatHistory: true } as LlmMessageDTO,
        {
          role: "assistant",
          content: "Right behind you.",
          __isChatHistory: true,
          sourceMessageId: "m2",
        } as LlmMessageDTO,
        { role: "system", content: "Post-history instructions." },
      ],
    });
    const storeFullUnmerged = new SettingsStore(mockFullUnmerged.spindle);
    await storeFullUnmerged.saveSettings({ guidedScene: { contextMode: "full_preset" } }, "u1");
    const mgrFullUnmerged = new GuidedSceneManager(mockFullUnmerged.spindle, storeFullUnmerged, () => {});
    await mgrFullUnmerged.previewSceneDraft(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Preview unmerged full_preset.",
      },
      "u1",
    );
    const previewReq = mockFullUnmerged.rawStreamCalls[0] as { messages: LlmMessageDTO[] };
    expect(previewReq.messages.slice(0, 3)).toEqual([
      { role: "system", content: "Main system prompt." },
      { role: "system", content: "Character description." },
      { role: "system", content: "Personality and scenario." },
    ]);
    expect(previewReq.messages[3]).toEqual({ role: "user", content: "Let's head upstairs." });
    expect(previewReq.messages[4]).toEqual({ role: "assistant", content: "Right behind you." });
    expect(previewReq.messages[5]).toEqual({ role: "system", content: "Post-history instructions." });
    expect(previewReq.messages[6]?.role).toBe("user");
    expect(String(previewReq.messages[6]?.content)).toContain("Preview unmerged full_preset.");
    mgrFullUnmerged.dispose();

    // 2b. Merged preset (promptPostProcessing: "merge") strips m2 via captured metadata AND re-applies consecutive role merge
    const mockFullMerged = createMockSpindle({
      dryRunMessages: [
        { role: "system", content: "Main system prompt." },
        { role: "system", content: "Character description." },
        { role: "user", content: "Let's head upstairs.", __isChatHistory: true } as LlmMessageDTO,
        {
          role: "assistant",
          content: "Right behind you.",
          __isChatHistory: true,
          sourceMessageId: "m2",
        } as LlmMessageDTO,
      ],
      dryRunRequestMessages: [
        { role: "system", content: "Main system prompt.\n\nCharacter description." },
        { role: "user", content: "Let's head upstairs." },
        { role: "assistant", content: "Right behind you." },
      ],
    });
    const storeFullMerged = new SettingsStore(mockFullMerged.spindle);
    await storeFullMerged.saveSettings({ guidedScene: { contextMode: "full_preset" } }, "u1");
    const mgrFullMerged = new GuidedSceneManager(mockFullMerged.spindle, storeFullMerged, () => {});
    await mgrFullMerged.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "New full_preset swipe.",
        dropTarget: "new_swipe",
      },
      "u1",
    );
    expect((mockFullMerged.dryRunCalls[0] as { generationType?: string }).generationType).toBe("swipe");
    const fullMergedReq = mockFullMerged.rawStreamCalls[0] as { messages: LlmMessageDTO[] };
    expect(JSON.stringify(fullMergedReq.messages)).not.toContain("Right behind you.");
    // Consecutive system blocks and consecutive user turns (user history + user task) must be merged cleanly
    expect(fullMergedReq.messages).toHaveLength(2);
    expect(fullMergedReq.messages[0]).toEqual({
      role: "system",
      content: "Main system prompt.\n\nCharacter description.",
    });
    expect(fullMergedReq.messages[1]?.role).toBe("user");
    expect(String(fullMergedReq.messages[1]?.content)).toContain("Let's head upstairs.");
    expect(String(fullMergedReq.messages[1]?.content)).toContain("New full_preset swipe.");
    mgrFullMerged.dispose();

    // 2c. Single-role collapsed preset (promptPostProcessing: "single") collapses final prompt into one system message
    const mockFullSingle = createMockSpindle({
      dryRunMessages: [
        { role: "system", content: "Main system prompt." },
        { role: "user", content: "Let's head upstairs.", __isChatHistory: true } as LlmMessageDTO,
        { role: "assistant", content: "Right behind you.", __isChatHistory: true } as LlmMessageDTO,
      ],
      dryRunRequestMessages: [
        {
          role: "system",
          content: "Main system prompt.\n\nLet's head upstairs.\n\nRight behind you.",
        },
      ],
    });
    const storeFullSingle = new SettingsStore(mockFullSingle.spindle);
    await storeFullSingle.saveSettings({ guidedScene: { contextMode: "full_preset" } }, "u1");
    const mgrFullSingle = new GuidedSceneManager(mockFullSingle.spindle, storeFullSingle, () => {});
    await mgrFullSingle.previewSceneDraft(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Preview single collapsed full_preset.",
      },
      "u1",
    );
    const fullSingleReq = mockFullSingle.rawStreamCalls[0] as { messages: LlmMessageDTO[] };
    expect(fullSingleReq.messages).toHaveLength(1);
    expect(fullSingleReq.messages[0]?.role).toBe("system");
    expect(String(fullSingleReq.messages[0]?.content)).toContain("Main system prompt.");
    expect(String(fullSingleReq.messages[0]?.content)).toContain("Preview single collapsed full_preset.");
    mgrFullSingle.dispose();
  });

  test("#57 Medium #5, #7, #8, #58 Medium #4, and Low #9/#10 regressions", async () => {
    // 1. Medium #5: Zero-output abort on verbatim_bridge deletes blank slot (does NOT commit verbatim text)
    let releaseBridgeAbort!: () => void;
    const bridgeGate = new Promise<void>((r) => {
      releaseBridgeAbort = r;
    });
    const mockBridgeAbort = createMockSpindle({
      onStreamStart: async function* (_input, signal) {
        await bridgeGate;
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
      },
    });
    const backendBridge = registerBackend(mockBridgeAbort.spindle);
    const pBridge = backendBridge.sceneManager.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "time_skip",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Must NOT commit on abort.",
        dropTarget: "new_message",
      },
      "u1",
    );
    await flushMicrotasks();
    expect(backendBridge.sceneManager.abortCurrent("u1", undefined, "chat-1")).toBe(true);
    releaseBridgeAbort();
    const bridgeRes = await pBridge;
    expect(bridgeRes.aborted).toBe(true);
    expect(bridgeRes.text).toBe("");
    expect(bridgeRes.messageId).toBeUndefined();
    expect(mockBridgeAbort.deleteCalls).toHaveLength(1);
    backendBridge.dispose();

    // 2. Medium #7: SettingsStore.getArmedScene falls back to disk after LRU eviction
    const mockLru = createMockSpindle();
    const lruStore = new SettingsStore(mockLru.spindle, { maxCachedUsers: 1 });
    await lruStore.saveArmedScene(
      {
        chatId: "chat-1",
        userId: "u1",
        status: "armed",
        pacing: "next_turn",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "U1 Scene",
        rawGreetingText: "U1 text",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 1,
      },
      "u1",
    );
    // Mark u1 loaded, then load u2 to evict u1 from armedScenesCache
    await lruStore.listArmedScenes("u1");
    await lruStore.listArmedScenes("u2");
    const restoredU1 = await lruStore.getArmedScene("chat-1", "u1");
    expect(restoredU1?.rawGreetingText).toBe("U1 text");

    // 3. Medium #8: executeArmedDrop permission precheck pauses armed scene & emits gg:status error instead of wiping
    const mockPermErr = createMockSpindle();
    const backendPermErr = registerBackend(mockPermErr.spindle);
    await backendPermErr.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Preserved on perm error.",
      },
      "u1",
    );
    mockPermErr.setPermission("chat_mutation", false, "u1");
    mockPermErr.emitEvent(
      "GENERATION_ENDED",
      { generationId: "g-perm", chatId: "chat-1", messageId: "m-perm", content: "Done" },
      "u1",
    );
    await flushMicrotasks();
    // Armed scene preserved as paused on disk & error surfaced via gg:status
    expect(mockPermErr.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(true);
    const savedOnDisk = JSON.parse(
      mockPermErr.userStorageFiles.get("u1")!.get(encodeArmedScenePath("chat-1"))!,
    );
    expect(savedOnDisk.status).toBe("paused");
    expect(
      mockPermErr.sentToFrontend.some(
        (e) =>
          (e.payload as BackendPushEvent).type === "gg:status" &&
          typeof (e.payload as { error?: string }).error === "string",
      ),
    ).toBe(true);
    backendPermErr.dispose();

    // 4. #58 Medium #4: group chat greeting_character_id detection (from opening message extra)
    const mockGroupGreeting = createMockSpindle({
      chats: {
        "group-2": {
          id: "group-2",
          character_id: "char-a",
          name: "Group 2",
          metadata: { group: true, character_ids: ["char-a", "char-b"], activeGreetingIndex: 0 },
          created_at: 1,
          updated_at: 1,
        },
      },
      characters: {
        "char-a": {
          id: "char-a",
          name: "Aria",
          description: "",
          personality: "",
          scenario: "",
          first_mes: "Aria opening",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          alternate_greetings: [],
          creator: "",
          image_id: null,
          world_book_ids: [],
          extensions: {},
          created_at: 1,
          updated_at: 1,
        },
        "char-b": {
          id: "char-b",
          name: "Bram",
          description: "",
          personality: "",
          scenario: "",
          first_mes: "Bram opening",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          alternate_greetings: [],
          creator: "",
          image_id: null,
          world_book_ids: [],
          extensions: {},
          created_at: 1,
          updated_at: 1,
        },
      },
      messagesByChat: {
        "group-2": [
          {
            id: "mg-0",
            chat_id: "group-2",
            index_in_chat: 0,
            is_user: false,
            name: "Bram",
            content: "Bram opening",
            send_date: 100,
            swipe_id: 0,
            swipes: ["Bram opening"],
            swipe_dates: [100],
            extra: { greeting_character_id: "char-b" },
            parent_message_id: null,
            branch_id: null,
            created_at: 100,
          },
        ],
      },
    });
    const backendGroup = registerBackend(mockGroupGreeting.spindle);
    const groupCtx = await backendGroup.sceneManager.getSceneContext("group-2", "u1");
    expect(groupCtx.greetings.find((g) => g.key === "char-b:0")?.isOpening).toBe(true);
    expect(groupCtx.greetings.find((g) => g.key === "char-a:0")?.isOpening).toBe(false);
    backendGroup.dispose();

    // 5. Low #9: pauseScene & cancelScene with explicit chatId succeed even if chats permission is revoked
    const mockNoChats = createMockSpindle();
    const backendNoChats = registerBackend(mockNoChats.spindle);
    await backendNoChats.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Cancelable without chats perm.",
      },
      "u1",
    );
    mockNoChats.setPermission("chats", false, "u1");
    const pausedNoChats = await backendNoChats.sceneManager.pauseScene("chat-1", "u1");
    expect(pausedNoChats?.status).toBe("paused");
    const cancelledNoChats = await backendNoChats.sceneManager.cancelScene("chat-1", "u1");
    expect(cancelledNoChats).toEqual({ cancelled: true, chatId: "chat-1" });
    backendNoChats.dispose();

    // 6. Low #10: previewSceneDraft is abortable via abortCurrent
    let releasePreview!: () => void;
    const previewGate = new Promise<void>((r) => {
      releasePreview = r;
    });
    const mockPreviewAbort = createMockSpindle({
      onStreamStart: async function* (_input, signal) {
        await previewGate;
        if (signal?.aborted) {
          const err = new Error("Aborted");
          err.name = "AbortError";
          throw err;
        }
        yield { type: "done", content: "Late preview", finish_reason: "stop" };
      },
    });
    const backendPreview = registerBackend(mockPreviewAbort.spindle);
    const previewPromise = backendPreview.sceneManager.previewSceneDraft(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Preview target",
      },
      "u1",
    );
    await flushMicrotasks();
    expect(backendPreview.sceneManager.abortCurrent("u1", undefined, "chat-1")).toBe(true);
    releasePreview();
    const previewRes = await previewPromise;
    expect(previewRes.aborted).toBe(true);
    expect(previewRes.text).toBe("");
    backendPreview.dispose();
  });

  test("regression #59: handoff respects cancelScene during readiness-tag strip and error rollback never overwrites newer armed scene", async () => {
    // 1. cancelScene during updateMessage (readiness-tag strip) aborts the drop cleanly
    let releaseUpdate!: () => void;
    let updateStarted!: () => void;
    const updateStartedPromise = new Promise<void>((r) => {
      updateStarted = r;
    });
    const updateGate = new Promise<void>((r) => {
      releaseUpdate = r;
    });

    const mockCancelRace = createMockSpindle({
      onUpdateMessage: async () => {
        updateStarted();
        await updateGate;
      },
    });
    mockCancelRace.messagesByChat["chat-1"]!.push({
      id: "m-strip-race",
      chat_id: "chat-1",
      index_in_chat: 2,
      is_user: false,
      name: "Alice",
      content: "Opening door.\n<scene-ready />",
      send_date: 105,
      swipe_id: 0,
      swipes: ["Opening door.\n<scene-ready />"],
      swipe_dates: [105],
      extra: {},
      parent_message_id: "m2",
      branch_id: null,
      created_at: 105,
    });

    const backend1 = registerBackend(mockCancelRace.spindle);
    await backend1.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Should not drop after cancel.",
      },
      "u1",
    );

    mockCancelRace.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-cancel-race",
        chatId: "chat-1",
        messageId: "m-strip-race",
        content: "Opening door.\n<scene-ready />",
      },
      "u1",
    );
    await updateStartedPromise;
    await backend1.sceneManager.cancelScene("chat-1", "u1");
    releaseUpdate();
    await flushMicrotasks(10);

    expect(mockCancelRace.appendCalls).toHaveLength(0);
    expect(mockCancelRace.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(false);
    backend1.dispose();

    // 2. Armed drop error rollback does not overwrite a newer armed scene for the same chat
    let releaseStreamErr!: () => void;
    let streamStarted!: () => void;
    const streamStartedPromise = new Promise<void>((r) => {
      streamStarted = r;
    });
    const streamErrGate = new Promise<void>((r) => {
      releaseStreamErr = r;
    });

    const mockRollbackRace = createMockSpindle({
      onStreamStart: async function* () {
        streamStarted();
        await streamErrGate;
        throw new Error("Drop failed mid-stream");
      },
    });
    const backend2 = registerBackend(mockRollbackRace.spindle);
    const oldArmed = await backend2.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Old scene that fails",
      },
      "u1",
    );

    mockRollbackRace.emitEvent(
      "GENERATION_ENDED",
      {
        generationId: "gen-old",
        chatId: "chat-1",
        messageId: "m2",
        content: "Lead-in complete.",
      },
      "u1",
    );
    await streamStartedPromise;

    // Ensure Date.now() differs for the new armedAt timestamp
    await new Promise((r) => setTimeout(r, 5));
    const newArmed = await backend2.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Newer armed scene",
      },
      "u1",
    );
    expect(newArmed.armedAt).not.toBe(oldArmed.armedAt);

    releaseStreamErr();
    await flushMicrotasks(10);

    const ctxAfter = await backend2.sceneManager.getSceneContext("chat-1", "u1");
    expect(ctxAfter.armedScene?.status).toBe("armed");
    expect(ctxAfter.armedScene?.rawGreetingText).toBe("Newer armed scene");
    expect(ctxAfter.armedScene?.armedAt).toBe(newArmed.armedAt);
    backend2.dispose();
  });

  test("regression #59: validates empty rawGreetingText, persists/emits turnsSteered, prunes deleted chats on hydrate, aborts preview during dryRun, and supports coordination", async () => {
    // 1. Empty rawGreetingText validation across preview/drop/arm/update (unless draftLocked + lockedDraftText)
    const mockVal = createMockSpindle();
    const backendVal = registerBackend(mockVal.spindle);
    await expect(
      backendVal.sceneManager.previewSceneDraft(
        {
          chatId: "chat-1",
          delivery: "cut",
          adjustmentMode: "verbatim",
          greetingSource: "custom",
          rawGreetingText: "   \n ",
        },
        "u1",
      ),
    ).rejects.toThrow("Scene greeting text cannot be empty.");
    await expect(
      backendVal.sceneManager.dropSceneNow(
        {
          chatId: "chat-1",
          delivery: "cut",
          adjustmentMode: "verbatim",
          greetingSource: "custom",
          rawGreetingText: "",
        },
        "u1",
      ),
    ).rejects.toThrow("Scene greeting text cannot be empty.");
    await expect(
      backendVal.sceneManager.armScene(
        {
          chatId: "chat-1",
          pacing: "next_turn",
          delivery: "cut",
          adjustmentMode: "verbatim",
          greetingSource: "custom",
          rawGreetingText: "   ",
        },
        "u1",
      ),
    ).rejects.toThrow("Scene greeting text cannot be empty.");

    // Allowed when draftLocked with non-empty lockedDraftText
    const armedLocked = await backendVal.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "next_turn",
        delivery: "cut",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "",
        draftLocked: true,
        lockedDraftText: "Locked preview scene",
      },
      "u1",
    );
    expect(armedLocked.draftLocked).toBe(true);
    await expect(
      backendVal.sceneManager.updateArmedScene(
        { chatId: "chat-1", rawGreetingText: "   ", draftLocked: false },
        "u1",
      ),
    ).rejects.toThrow("Scene greeting text cannot be empty.");

    // 2. turnsSteered emitted & persisted asynchronously across steering turns
    await backendVal.sceneManager.updateArmedScene(
      { chatId: "chat-1", pacing: "multi_turn", rawGreetingText: "Steered scene" },
      "u1",
    );
    await mockVal.invokeInterceptor([{ role: "user", content: "Steer me" }], {
      chatId: "chat-1",
      userId: "u1",
    });
    await flushMicrotasks(8);
    const steeredEv = mockVal.sentToFrontend
      .map((e) => e.payload as BackendPushEvent)
      .find(
        (e): e is Extract<BackendPushEvent, { type: "gg:scene-updated" }> =>
          e.type === "gg:scene-updated" && e.reason === "steered",
      );
    expect(steeredEv?.armedScene?.turnsSteered).toBe(1);
    const persistedSteered = JSON.parse(
      mockVal.userStorageFiles.get("u1")!.get(encodeArmedScenePath("chat-1"))!,
    );
    expect(persistedSteered.turnsSteered).toBe(1);
    backendVal.dispose();

    // 3. hydrateUserArmedScenes prunes orphaned armed scenes for deleted chats
    const mockPrune = createMockSpindle();
    const pruneStore = new SettingsStore(mockPrune.spindle);
    await pruneStore.saveArmedScene(
      {
        chatId: "deleted-chat-99",
        userId: "u1",
        status: "armed",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Orphan",
        rawGreetingText: "Orphan scene",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 1000,
      },
      "u1",
    );
    await pruneStore.saveArmedScene(
      {
        chatId: "chat-1",
        userId: "u1",
        status: "armed",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        greetingLabel: "Live",
        rawGreetingText: "Live scene",
        transitionNote: "",
        customDirection: "",
        lockedDraftText: null,
        draftLocked: false,
        armedAt: 2000,
      },
      "u1",
    );
    const backendPrune = registerBackend(mockPrune.spindle);
    const hydrated = await backendPrune.sceneManager.hydrateUserArmedScenes("u1");
    expect(hydrated.map((s) => s.chatId)).toEqual(["chat-1"]);
    expect(mockPrune.userStorageFiles.get("u1")?.has(encodeArmedScenePath("deleted-chat-99"))).toBe(
      false,
    );
    expect(mockPrune.userStorageFiles.get("u1")?.has(encodeArmedScenePath("chat-1"))).toBe(true);
    backendPrune.dispose();

    // 4. abortCurrent aborts previewSceneDraft even while dryRun is in flight
    let releaseDryRun!: () => void;
    let dryRunStarted!: () => void;
    const dryRunStartedPromise = new Promise<void>((r) => {
      dryRunStarted = r;
    });
    const dryRunGate = new Promise<void>((r) => {
      releaseDryRun = r;
    });
    const mockDryAbort = createMockSpindle({
      onDryRun: async () => {
        dryRunStarted();
        await dryRunGate;
      },
    });
    const dryStore = new SettingsStore(mockDryAbort.spindle);
    await dryStore.saveSettings({ guidedScene: { contextMode: "full_preset" } }, "u1");
    const dryMgr = new GuidedSceneManager(mockDryAbort.spindle, dryStore, () => {});
    const previewDryPromise = dryMgr.previewSceneDraft(
      {
        chatId: "chat-1",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Dry run preview",
      },
      "u1",
    );
    await dryRunStartedPromise;
    expect(dryMgr.abortCurrent("u1", undefined, "chat-1")).toBe(true);
    releaseDryRun();
    const previewDryRes = await previewDryPromise;
    expect(previewDryRes.aborted).toBe(true);
    expect(previewDryRes.text).toBe("");
    expect(mockDryAbort.rawStreamCalls).toHaveLength(0);
    dryMgr.dispose();

    // 5. GuidedSceneManager coordination: hasBusyChat & isExternalChatBusy
    let externalBusy = true;
    const sharedQueues = new Map<string, Promise<unknown>>();
    const mockCoord = createMockSpindle();
    const coordMgr = new GuidedSceneManager(
      mockCoord.spindle,
      new SettingsStore(mockCoord.spindle),
      () => {},
      undefined,
      {
        chatDryRunQueues: sharedQueues,
        isExternalChatBusy: (_userId, cid) => externalBusy && cid === "chat-1",
      },
    );
    expect(coordMgr.hasBusyChat("u1", "chat-1")).toBe(false);
    await expect(
      coordMgr.dropSceneNow(
        {
          chatId: "chat-1",
          delivery: "cut",
          adjustmentMode: "verbatim",
          greetingSource: "custom",
          rawGreetingText: "Blocked by external busy",
        },
        "u1",
      ),
    ).rejects.toThrow("A guided generation is already running in this chat.");
    externalBusy = false;
    const okCoord = await coordMgr.dropSceneNow(
      {
        chatId: "chat-1",
        delivery: "cut",
        adjustmentMode: "verbatim",
        greetingSource: "custom",
        rawGreetingText: "Allowed once idle",
      },
      "u1",
    );
    expect(okCoord.text).toBe("Allowed once idle");
    coordMgr.dispose();
  });

  test("registerBackend coordinates cross-subsystem busy lock, non-short-circuiting abort, and update_armed_scene enum validation", async () => {
    let releaseRunnerStream!: () => void;
    let runnerStreamStarted!: () => void;
    const runnerStartedPromise = new Promise<void>((r) => {
      runnerStreamStarted = r;
    });
    const runnerGate = new Promise<void>((r) => {
      releaseRunnerStream = r;
    });

    const mock = createMockSpindle({
      async *onStreamStart() {
        runnerStreamStarted();
        await runnerGate;
        yield { type: "token", token: "ok" };
        yield { type: "done", content: "ok", finish_reason: "stop" };
      },
    });
    const backend = registerBackend(mock.spindle);

    // 1. Active runner run on chat-1 blocks concurrent sceneManager.dropSceneNow on chat-1
    const runnerPromise = backend.runner.run(
      {
        actionId: "guided_response",
        chatId: "chat-1",
        inputText: "Stay sharp",
      },
      "u1",
    );
    await runnerStartedPromise;

    await expect(
      backend.sceneManager.dropSceneNow(
        {
          chatId: "chat-1",
          delivery: "cut",
          adjustmentMode: "verbatim",
          greetingSource: "custom",
          rawGreetingText: "Concurrent scene drop",
        },
        "u1",
      ),
    ).rejects.toThrow("A guided generation is already running in this chat.");

    // 2. Non-short-circuiting abort_action without runId aborts both runner AND sceneManager preview
    let releasePreviewDryRun!: () => void;
    let previewDryRunStarted!: () => void;
    const previewStartedPromise = new Promise<void>((r) => {
      previewDryRunStarted = r;
    });
    const previewGate = new Promise<void>((r) => {
      releasePreviewDryRun = r;
    });
    let releaseAbortStream!: () => void;
    let abortStreamStarted!: () => void;
    const abortStreamStartedPromise = new Promise<void>((r) => {
      abortStreamStarted = r;
    });
    const abortStreamGate = new Promise<void>((r) => {
      releaseAbortStream = r;
    });
    const mockAbort = createMockSpindle({
      chats: {
        "chat-1": {
          id: "chat-1",
          character_id: "char-1",
          name: "Solo Chat 1",
          metadata: {},
          created_at: 1,
          updated_at: 1,
        },
        "chat-2": {
          id: "chat-2",
          character_id: "char-1",
          name: "Solo Chat 2",
          metadata: {},
          created_at: 2,
          updated_at: 2,
        },
      },
      messagesByChat: {
        "chat-1": [
          {
            id: "m1",
            chat_id: "chat-1",
            index_in_chat: 0,
            is_user: true,
            name: "Bob",
            content: "Hi",
            send_date: 100,
            swipe_id: 0,
            swipes: ["Hi"],
            swipe_dates: [100],
            extra: {},
            parent_message_id: null,
            branch_id: null,
            created_at: 100,
          },
        ],
        "chat-2": [
          {
            id: "m2",
            chat_id: "chat-2",
            index_in_chat: 0,
            is_user: true,
            name: "Bob",
            content: "Hi 2",
            send_date: 100,
            swipe_id: 0,
            swipes: ["Hi 2"],
            swipe_dates: [100],
            extra: {},
            parent_message_id: null,
            branch_id: null,
            created_at: 100,
          },
        ],
      },
      async *onStreamStart(_input, signal) {
        abortStreamStarted();
        signal?.addEventListener("abort", () => releaseAbortStream(), { once: true });
        await abortStreamGate;
        if (!signal?.aborted) {
          yield { type: "done", content: "", finish_reason: "stop" };
        }
      },
      onDryRun: async (input) => {
        if ((input as { chatId?: string }).chatId === "chat-2") {
          previewDryRunStarted();
          await previewGate;
        }
      },
    });
    await new SettingsStore(mockAbort.spindle).saveSettings(
      { guidedScene: { contextMode: "full_preset" } },
      "u1",
    );
    const backendAbort = registerBackend(mockAbort.spindle);

    const runChat1 = backendAbort.runner.run(
      { actionId: "guided_response", chatId: "chat-1", inputText: "Hold" },
      "u1",
    );
    await abortStreamStartedPromise;
    const previewChat2 = backendAbort.sceneManager.previewSceneDraft(
      {
        chatId: "chat-2",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Concurrent preview",
      },
      "u1",
    );
    await previewStartedPromise;

    await backendAbort.handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-abort-all",
        action: "abort_action",
        input: {},
      },
      "u1",
    );
    const abortReply = mockAbort.sentToFrontend
      .map((e) => e.payload as { type?: string; requestId?: string; result?: { aborted?: boolean } })
      .find((e) => e.type === "gg:reply" && e.requestId === "req-abort-all");
    expect(abortReply?.result?.aborted).toBe(true);

    releasePreviewDryRun();
    const previewRes = await previewChat2;
    expect(previewRes.aborted).toBe(true);
    const runRes = await runChat1;
    expect(runRes.aborted).toBe(true);
    backendAbort.dispose();

    releaseRunnerStream();
    await runnerPromise;

    // 3. update_armed_scene RPC ignores invalid enum values instead of clobbering existing fields
    await backend.sceneManager.armScene(
      {
        chatId: "chat-1",
        pacing: "multi_turn",
        delivery: "bridge",
        adjustmentMode: "context_adapt",
        greetingSource: "custom",
        rawGreetingText: "Armed scene",
      },
      "u1",
    );
    await backend.handleRpc(
      {
        type: "gg:rpc",
        requestId: "req-update-invalid-enums",
        action: "update_armed_scene",
        input: {
          chatId: "chat-1",
          pacing: "bogus_pacing",
          delivery: "bogus_delivery",
          adjustmentMode: "bogus_mode",
          greetingSource: "bogus_source",
          transitionNote: "Updated note",
        },
      },
      "u1",
    );
    const updateReply = mock.sentToFrontend
      .map((e) => e.payload as { type?: string; requestId?: string; result?: ArmedSceneState })
      .find((e) => e.type === "gg:reply" && e.requestId === "req-update-invalid-enums");
    expect(updateReply?.result?.pacing).toBe("multi_turn");
    expect(updateReply?.result?.delivery).toBe("bridge");
    expect(updateReply?.result?.adjustmentMode).toBe("context_adapt");
    expect(updateReply?.result?.greetingSource).toBe("custom");
    expect(updateReply?.result?.transitionNote).toBe("Updated note");

    backend.dispose();
  });
});
