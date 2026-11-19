import { describe, expect, test } from "bun:test";
import type {
  AssemblyBreakdownEntryDTO,
  ChatMessageDTO,
  LlmMessageDTO,
  PromptBlockSnapshotDTO,
} from "lumiverse-spindle-types";
import {
  type AssembledLlmMessageDTO,
  buildActiveSwipePatch,
  buildBackgroundSwipePatch,
  buildDryRunInput,
  buildPresetContextMetadata,
  type ChatMessageWithRole,
  collapseMessagesToSingleRole,
  computeEffectiveGuidanceDepth,
  extractSwipeReasoning,
  findLastAssistantMessage,
  formatGuidanceText,
  hasNonEmptyLlmContent,
  hasPresetContextForSwipe,
  injectGuidanceMessage,
  mapInjectionRoleToRegexPlacement,
  mergeConsecutiveSameRoleMessages,
  normalizeMessageSwipes,
  resolveChatHistoryFlags,
  resolveEffectiveModelAndProvider,
  stitchContinueContent,
  stripCreatedBlankAssistantTurnWithHistory,
  stripInternalMessageMarkers,
  stripRejectedSwipeAssistantTurn,
  stripRejectedSwipeAssistantTurnWithHistory,
} from "../src/backend/prompt-builder";
import { createDefaultSettings } from "../src/shared/defaults";

describe("prompt-builder", () => {
  test("formatGuidanceText substitutes {{input}} and handles empty/raw cases", () => {
    expect(
      formatGuidanceText("[OOC Guidance: {{input}}]", "Make her whisper."),
    ).toBe("[OOC Guidance: Make her whisper.]");

    expect(formatGuidanceText("", "Raw direction only")).toBe(
      "Raw direction only",
    );

    expect(formatGuidanceText("[OOC Guidance: {{input}}]", "   ")).toBeNull();

    expect(
      formatGuidanceText("Write in 2nd person POV.", "", {
        allowTemplateWithoutInput: true,
      }),
    ).toBe("Write in 2nd person POV.");

    expect(
      formatGuidanceText("[OOC: {{input}}]", "Price is $$50, match $& and $' and $` and $1"),
    ).toBe("[OOC: Price is $$50, match $& and $' and $` and $1]");
  });

  test("injectGuidanceMessage preserves trailing assistant prefill/continue boundary", () => {
    const withTrailingAssistant: LlmMessageDTO[] = [
      { role: "system", content: "Persona" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "She opened the door" },
    ];

    const injected = injectGuidanceMessage(
      withTrailingAssistant,
      "[Continue with suspense]",
      "system",
    );

    expect(injected).toEqual([
      { role: "system", content: "Persona" },
      { role: "user", content: "Hello" },
      { role: "system", content: "[Continue with suspense]" },
      { role: "assistant", content: "She opened the door" },
    ]);
  });

  test("injectGuidanceMessage appends at end when last message is user", () => {
    const chat: LlmMessageDTO[] = [
      { role: "system", content: "Rules" },
      { role: "user", content: "What happens next?" },
    ];

    const injected = injectGuidanceMessage(chat, "[Steer dramatic]", "user");
    expect(injected[injected.length - 1]).toEqual({
      role: "user",
      content: "[Steer dramatic]",
    });
  });

  test("buildDryRunInput sets forcePresetId only when preset override is configured", () => {
    const defaults = createDefaultSettings();

    const withOverrides = buildDryRunInput({
      chatId: "chat-1",
      actionId: "guided_swipe",
      config: {
        ...defaults.actions.guided_swipe,
        connectionId: "conn-fast",
        presetId: "preset-creative",
      },
      activeConnectionId: "conn-main",
    });

    expect(withOverrides).toEqual({
      chatId: "chat-1",
      connectionId: "conn-fast",
      presetId: "preset-creative",
      forcePresetId: true,
      generationType: "swipe",
      includeRequestMessages: true,
    });

    const inheritActive = buildDryRunInput({
      chatId: "chat-1",
      actionId: "guided_continue",
      config: defaults.actions.guided_continue,
      activeConnectionId: "conn-main",
    });

    expect(inheritActive).toEqual({
      chatId: "chat-1",
      connectionId: "conn-main",
      generationType: "continue",
      includeRequestMessages: true,
    });

    const regenerateInput = buildDryRunInput({
      chatId: "chat-1",
      actionId: "guided_regenerate",
      config: defaults.actions.guided_regenerate,
      activeConnectionId: "conn-main",
    });

    expect(regenerateInput).toEqual({
      chatId: "chat-1",
      connectionId: "conn-main",
      generationType: "regenerate",
      includeRequestMessages: true,
    });
  });

  test("injectGuidanceMessage places guidance before continued assistant turn even with trailing continue nudge", () => {
    const withContinueNudge: LlmMessageDTO[] = [
      { role: "system", content: "Persona" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "She opened the door" },
      { role: "system", content: "[Continue the last message without repeating it.]" },
    ];

    const injected = injectGuidanceMessage(
      withContinueNudge,
      "[Reveal a hidden letter]",
      "user",
      { actionId: "guided_continue" },
    );

    expect(injected).toEqual([
      { role: "system", content: "Persona" },
      { role: "user", content: "Hello" },
      { role: "user", content: "[Reveal a hidden letter]" },
      { role: "assistant", content: "She opened the door" },
      { role: "system", content: "[Continue the last message without repeating it.]" },
    ]);

    const userEndedWithPostHistory: LlmMessageDTO[] = [
      { role: "assistant", content: "Earlier reply" },
      { role: "user", content: "New turn" },
      { role: "system", content: "Post-history note" },
    ];

    const appended = injectGuidanceMessage(
      userEndedWithPostHistory,
      "[Steer]",
      "system",
      { actionId: "guided_continue" },
    );
    expect(appended[appended.length - 1]).toEqual({
      role: "system",
      content: "[Steer]",
    });
  });

  test("stripRejectedSwipeAssistantTurn removes rejected swipe by sourceMessageId or trailing turn", () => {
    const withSourceId: LlmMessageDTO[] = [
      { role: "system", content: "Persona" },
      { role: "user", content: "Hi", sourceMessageId: "m-1" },
      { role: "assistant", content: "Rejected swipe", sourceMessageId: "m-2" },
      { role: "assistant", content: "Preset prefill" },
    ];

    expect(stripRejectedSwipeAssistantTurn(withSourceId, "m-2")).toEqual([
      { role: "system", content: "Persona" },
      { role: "user", content: "Hi", sourceMessageId: "m-1" },
      { role: "assistant", content: "Preset prefill" },
    ]);

    const displayFallback: LlmMessageDTO[] = [
      { role: "system", content: "Persona" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Rejected swipe" },
      { role: "system", content: "Post-history instruction" },
    ];

    expect(stripRejectedSwipeAssistantTurn(displayFallback, "m-2")).toEqual([
      { role: "system", content: "Persona" },
      { role: "user", content: "Hi" },
      { role: "system", content: "Post-history instruction" },
    ]);

    const userAfterAssistant: LlmMessageDTO[] = [
      { role: "assistant", content: "Older reply" },
      { role: "user", content: "Follow-up" },
    ];
    expect(stripRejectedSwipeAssistantTurn(userAfterAssistant, "m-1")).toEqual(
      userAfterAssistant,
    );
  });

  test("findLastAssistantMessage skips system messages with is_user: false and normalizeMessageSwipes guards NaN", () => {
    const messages: ChatMessageWithRole[] = [
      {
        id: "m-1",
        chat_id: "c-1",
        index_in_chat: 0,
        is_user: false,
        role: "assistant",
        name: "Alice",
        content: "Real assistant turn",
        send_date: 1700000000,
        swipe_id: 0,
        swipes: ["Real assistant turn"],
        swipe_dates: [1700000000],
        extra: {},
        parent_message_id: null,
        branch_id: null,
        created_at: 1700000000,
      },
      {
        id: "m-2",
        chat_id: "c-1",
        index_in_chat: 1,
        is_user: false,
        role: "system",
        name: "Narrator",
        content: "Scene transition",
        send_date: 1700000001,
        swipe_id: 0,
        swipes: ["Scene transition"],
        swipe_dates: [1700000001],
        extra: {},
        parent_message_id: null,
        branch_id: null,
        created_at: 1700000001,
      },
    ];

    expect(findLastAssistantMessage(messages)?.id).toBe("m-1");

    const nanSwipes = normalizeMessageSwipes({
      ...messages[0]!,
      swipe_id: Number.NaN,
      swipes: ["One", "Two"],
      swipe_dates: [Number.NaN, 1700000005],
    });
    expect(nanSwipes.activeIndex).toBe(0);
    expect(Number.isFinite(nanSwipes.swipeDates[0])).toBe(true);
    expect(nanSwipes.swipeDates[1]).toBe(1700000005);
  });

  test("stitchContinueContent handles spacing and punctuation cleanly", () => {
    expect(stitchContinueContent("She paused", "and smiled.")).toBe(
      "She paused and smiled.",
    );
    expect(stitchContinueContent("She paused ", "and smiled.")).toBe(
      "She paused and smiled.",
    );
    expect(stitchContinueContent("She whispered", ", barely audible.")).toBe(
      "She whispered, barely audible.",
    );
    expect(stitchContinueContent("", "First line")).toBe("First line");
    expect(stitchContinueContent("Existing text", "")).toBe("Existing text");

    // Trailing whitespace variants and leading whitespace in delta
    expect(stitchContinueContent("Line one\n", "Line two")).toBe("Line one\nLine two");
    expect(stitchContinueContent("Tab\t", "word")).toBe("Tab\tword");
    expect(stitchContinueContent("Word", " next")).toBe("Word next");
    expect(stitchContinueContent("Word", "\nnext")).toBe("Word\nnext");

    // Trailing opening delimiters do not insert a space
    expect(stitchContinueContent("Wait (", "really)")).toBe("Wait (really)");
    expect(stitchContinueContent("Open [", "tag]")).toBe("Open [tag]");
    expect(stitchContinueContent("Dash—", "suddenly")).toBe("Dash—suddenly");
    expect(stitchContinueContent("Curly “", "hello")).toBe("Curly “hello");

    // Trailing quote/emphasis delimiters: opening vs closing context
    expect(stitchContinueContent('"', "Hello")).toBe('"Hello');
    expect(stitchContinueContent('She said "', "Hello")).toBe('She said "Hello');
    expect(stitchContinueContent("<b>*", "italic")).toBe("<b>*italic");
    expect(stitchContinueContent('She said "hi"', "then left.")).toBe('She said "hi" then left.');
    expect(stitchContinueContent("word*", "next")).toBe("word* next");

    // Leading punctuation in delta does not insert a space
    expect(stitchContinueContent("Hello", "...")).toBe("Hello...");
    expect(stitchContinueContent("Hello", "…")).toBe("Hello…");
    expect(stitchContinueContent("Hello", "! Next")).toBe("Hello! Next");
    expect(stitchContinueContent("Hello", "—wait")).toBe("Hello—wait");

    // Long baseContent boundary check (trailing-slice fast path)
    const longBase = "a".repeat(100_000);
    expect(stitchContinueContent(longBase, "next")).toBe(`${longBase} next`);
    expect(stitchContinueContent(`${longBase} "`, "quoted")).toBe(`${longBase} "quoted`);
    expect(stitchContinueContent(`${longBase}"`, "after")).toBe(`${longBase}" after`);
  });

  test("swipe helpers append new swipes and update active swipe without clobbering siblings", () => {
    const baseMsg: ChatMessageDTO = {
      id: "m-2",
      chat_id: "chat-1",
      index_in_chat: 1,
      is_user: false,
      name: "Alice",
      content: "Swipe one",
      send_date: 1700000000,
      swipe_id: 0,
      swipes: ["Swipe zero", "Swipe one"],
      swipe_dates: [1700000000, 1700000010],
      extra: {},
      parent_message_id: null,
      branch_id: null,
      created_at: 1700000000,
    };

    const userMsg: ChatMessageDTO = {
      ...baseMsg,
      id: "m-3",
      index_in_chat: 2,
      is_user: true,
      name: "User",
    };

    expect(findLastAssistantMessage([baseMsg, userMsg])?.id).toBe("m-2");

    const normalized = normalizeMessageSwipes({ ...baseMsg, swipe_id: 1 });
    expect(normalized.activeIndex).toBe(1);

    const newSlotIndex = normalized.swipes.length;
    const patch = buildActiveSwipePatch({
      swipes: [...normalized.swipes, ""],
      swipeIndex: newSlotIndex,
      content: "Steered third swipe",
      swipeDates: [...normalized.swipeDates, 1700000099],
    });

    expect(patch.swipe_id).toBe(2);
    expect(patch.swipes).toEqual(["Swipe zero", "Swipe one", "Steered third swipe"]);
    expect(patch.content).toBe("Steered third swipe");
  });

  test("resolveEffectiveModelAndProvider uses configured model or falls back to connection/dry-run model", () => {
    expect(
      resolveEffectiveModelAndProvider({
        configuredModel: "gpt-4.1",
        connectionModel: "gpt-4o",
        connectionProvider: "openai",
        dryRunModel: "gpt-4o-mini",
        dryRunProvider: "openai",
      }),
    ).toEqual({
      model: "gpt-4.1",
      provider: "openai",
    });

    expect(
      resolveEffectiveModelAndProvider({
        configuredModel: "   ",
        connectionModel: "claude-sonnet-4",
        connectionProvider: "anthropic",
        dryRunModel: "fallback-model",
        dryRunProvider: "anthropic",
      }),
    ).toEqual({
      model: "claude-sonnet-4",
      provider: "anthropic",
    });

    expect(
      resolveEffectiveModelAndProvider({
        configuredModel: null,
        connectionModel: "",
        connectionProvider: "openrouter",
        dryRunModel: "deepseek/deepseek-chat",
        dryRunProvider: "openrouter",
      }),
    ).toEqual({
      model: "deepseek/deepseek-chat",
      provider: "openrouter",
    });
  });

  test("injectGuidanceMessage respects pre_history, before_post_history, in_history, and post_history with isChatHistory", () => {
    const prompt: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main Prompt" },
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "system", content: "World Info at depth 1" },
      { role: "user", content: "Turn 2" },
      { role: "system", content: "Post-History Instructions" },
      { role: "assistant", content: "Prefill...", partial: true },
    ];
    const isChatHistory = [false, true, true, false, true, false, false];

    const pre = injectGuidanceMessage(prompt, "[Pre]", "system", {
      guidancePosition: "pre_history",
      isChatHistory,
    });
    expect(pre.map((m) => m.content)).toEqual([
      "Main Prompt",
      "[Pre]",
      "Turn 1",
      "Reply 1",
      "World Info at depth 1",
      "Turn 2",
      "Post-History Instructions",
      "Prefill...",
    ]);

    const beforePost = injectGuidanceMessage(prompt, "[BeforePost]", "system", {
      guidancePosition: "before_post_history",
      isChatHistory,
    });
    expect(beforePost.map((m) => m.content)).toEqual([
      "Main Prompt",
      "Turn 1",
      "Reply 1",
      "World Info at depth 1",
      "Turn 2",
      "[BeforePost]",
      "Post-History Instructions",
      "Prefill...",
    ]);

    const inHistoryD1 = injectGuidanceMessage(prompt, "[InD1]", "user", {
      guidancePosition: "in_history",
      guidanceDepth: 1,
      isChatHistory,
    });
    expect(inHistoryD1.map((m) => m.content)).toEqual([
      "Main Prompt",
      "Turn 1",
      "Reply 1",
      "World Info at depth 1",
      "[InD1]",
      "Turn 2",
      "Post-History Instructions",
      "Prefill...",
    ]);

    const inHistoryD2 = injectGuidanceMessage(prompt, "[InD2]", "user", {
      guidancePosition: "in_history",
      guidanceDepth: 2,
      isChatHistory,
    });
    expect(inHistoryD2.map((m) => m.content)).toEqual([
      "Main Prompt",
      "Turn 1",
      "[InD2]",
      "Reply 1",
      "World Info at depth 1",
      "Turn 2",
      "Post-History Instructions",
      "Prefill...",
    ]);

    const inHistoryClamped = injectGuidanceMessage(prompt, "[Clamped]", "system", {
      guidancePosition: "in_history",
      guidanceDepth: 99,
      isChatHistory,
    });
    expect(inHistoryClamped.map((m) => m.content)).toEqual([
      "Main Prompt",
      "[Clamped]",
      "Turn 1",
      "Reply 1",
      "World Info at depth 1",
      "Turn 2",
      "Post-History Instructions",
      "Prefill...",
    ]);

    const postHistory = injectGuidanceMessage(prompt, "[Post]", "system", {
      guidancePosition: "post_history",
      isChatHistory,
    });
    expect(postHistory.map((m) => m.content)).toEqual([
      "Main Prompt",
      "Turn 1",
      "Reply 1",
      "World Info at depth 1",
      "Turn 2",
      "Post-History Instructions",
      "[Post]",
      "Prefill...",
    ]);

    // Empty chat history falls back to index 0 for pre_history
    const noHistory = [
      { role: "system" as const, content: "Main" },
      { role: "system" as const, content: "Post" },
    ];
    expect(
      injectGuidanceMessage(noHistory, "[Pre]", "system", {
        guidancePosition: "pre_history",
        isChatHistory: [false, false],
      }).map((m) => m.content),
    ).toEqual(["[Pre]", "Main", "Post"]);
  });

  test("injectGuidanceMessage handles guided_continue across guidancePosition modes", () => {
    const continuePrompt: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "She opened the door" },
      { role: "system", content: "Post-History Note" },
    ];
    const isChatHistory = [false, true, true, false];

    expect(
      injectGuidanceMessage(continuePrompt, "[Steer]", "user", {
        actionId: "guided_continue",
        guidancePosition: "before_post_history",
        isChatHistory,
      }).map((m) => m.content),
    ).toEqual(["Main", "Hello", "[Steer]", "She opened the door", "Post-History Note"]);

    expect(
      injectGuidanceMessage(continuePrompt, "[SteerD0]", "user", {
        actionId: "guided_continue",
        guidancePosition: "in_history",
        guidanceDepth: 0,
        isChatHistory,
      }).map((m) => m.content),
    ).toEqual(["Main", "Hello", "[SteerD0]", "She opened the door", "Post-History Note"]);

    expect(
      injectGuidanceMessage(
        [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "She opened the door" },
        ],
        "[PostCont]",
        "system",
        {
          actionId: "guided_continue",
          guidancePosition: "post_history",
          isChatHistory: [true, true],
        },
      ).map((m) => m.content),
    ).toEqual(["Hello", "[PostCont]", "She opened the door"]);

    // When chat_history ends with a trailing system message (e.g. Author's Note),
    // guided_continue still finds the continued assistant turn before it.
    const continueWithTrailingChatSystem: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "She opened the door" },
      { role: "system", content: "Author Note in chat" },
      { role: "system", content: "Post-History" },
    ];
    const flagsWithTrailingSystem = [false, true, true, true, false];
    expect(
      injectGuidanceMessage(continueWithTrailingChatSystem, "[SteerBeforeCont]", "user", {
        actionId: "guided_continue",
        guidancePosition: "before_post_history",
        isChatHistory: flagsWithTrailingSystem,
      }).map((m) => m.content),
    ).toEqual([
      "Main",
      "Hello",
      "[SteerBeforeCont]",
      "She opened the door",
      "Author Note in chat",
      "Post-History",
    ]);
    expect(
      injectGuidanceMessage(continueWithTrailingChatSystem, "[SteerInHist0]", "user", {
        actionId: "guided_continue",
        guidancePosition: "in_history",
        guidanceDepth: 0,
        isChatHistory: flagsWithTrailingSystem,
      }).map((m) => m.content),
    ).toEqual([
      "Main",
      "Hello",
      "[SteerInHist0]",
      "She opened the door",
      "Author Note in chat",
      "Post-History",
    ]);
  });

  test("resolveChatHistoryFlags falls back to breakdown and presetBlocks and stays aligned after swipe stripping", () => {
    const msgs: AssembledLlmMessageDTO[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Hi", sourceMessageId: "m1" },
      { role: "assistant", content: "Old swipe", sourceMessageId: "m2" },
      { role: "system", content: "Post-history" },
    ];

    const breakdown: AssemblyBreakdownEntryDTO[] = [
      { type: "preset", name: "System" },
      { type: "chat_history", name: "Chat History", firstMessageIndex: 1, messageCount: 2 },
      { type: "preset", name: "Post-history" },
    ];
    expect(resolveChatHistoryFlags(msgs, { breakdown })).toEqual([false, true, true, false]);

    const presetBlocks: PromptBlockSnapshotDTO[] = [
      {
        id: "b1",
        name: "System",
        content: "System",
        role: "system",
        enabled: true,
        position: "pre_history",
        depth: 0,
        marker: null,
        isLocked: false,
        color: null,
        injectionTrigger: [],
        group: null,
      },
      {
        id: "b2",
        name: "Post",
        content: "Post-history",
        role: "system",
        enabled: true,
        position: "post_history",
        depth: 0,
        marker: null,
        isLocked: false,
        color: null,
        injectionTrigger: [],
        group: null,
      },
    ];
    const flags = resolveChatHistoryFlags(msgs, { presetBlocks });
    expect(flags).toEqual([false, true, true, false]);

    const stripped = stripRejectedSwipeAssistantTurnWithHistory(msgs, "m2", flags);
    expect(stripped.messages.map((m) => m.content)).toEqual(["System", "Hi", "Post-history"]);
    expect(stripped.isChatHistory).toEqual([false, true, false]);

    expect(computeEffectiveGuidanceDepth("in_history", 3, flags)).toBe(3);
    expect(computeEffectiveGuidanceDepth("before_post_history", 3, flags)).toBe(0);
    expect(computeEffectiveGuidanceDepth("pre_history", 0, flags)).toBe(2);
    expect(mapInjectionRoleToRegexPlacement("user")).toBe("user_input");
    expect(mapInjectionRoleToRegexPlacement("assistant")).toBe("ai_output");
    expect(mapInjectionRoleToRegexPlacement("system")).toBe("world_info");
  });

  test("buildBackgroundSwipePatch omits content, swipe_id, and reasoning while preserving existing swipe_reasoning slots", () => {
    const slotOnlyPatch = buildBackgroundSwipePatch({
      swipes: ["Old swipe"],
      swipeIndex: 1,
      content: "",
      swipeDates: [1700000000, 1700000099],
    });

    expect(slotOnlyPatch).toEqual({
      swipes: ["Old swipe", ""],
      swipe_dates: [1700000000, 1700000099],
      skipChunkRebuild: true,
    });
    expect("content" in slotOnlyPatch).toBe(false);
    expect("swipe_id" in slotOnlyPatch).toBe(false);
    expect("reasoning" in slotOnlyPatch).toBe(false);
    expect("swipe_reasoning" in slotOnlyPatch).toBe(false);

    // Empty reasoningText omits swipe_reasoning unless clearReasoningSlot is set
    const emptyReasoningPatch = buildBackgroundSwipePatch({
      swipes: ["Old swipe", ""],
      swipeIndex: 1,
      content: "Final text",
      swipeDates: [1700000000, 1700000099],
      reasoningText: "",
      existingExtra: { reasoningBySwipe: ["Old thought"] },
    });
    expect("swipe_reasoning" in emptyReasoningPatch).toBe(false);

    // Non-empty reasoning preserves reasoningBySwipe & reasoningDurationBySwipe for prior slots
    const withReasoningPatch = buildBackgroundSwipePatch({
      swipes: ["Swipe 0", "Swipe 1", ""],
      swipeIndex: 2,
      content: "New swipe 2",
      swipeDates: [1700000000, 1700000010, 1700000099],
      reasoningText: "New reasoning 2",
      existingExtra: {
        reasoningBySwipe: ["Thought 0", null],
        reasoningDurationBySwipe: [1200, null],
      },
      existingActiveSwipeId: 0,
    });
    expect("content" in withReasoningPatch).toBe(false);
    expect("swipe_id" in withReasoningPatch).toBe(false);
    expect("reasoning" in withReasoningPatch).toBe(false);
    expect(withReasoningPatch.skipChunkRebuild).toBe(true);
    expect(withReasoningPatch.swipes).toEqual(["Swipe 0", "Swipe 1", "New swipe 2"]);
    expect(withReasoningPatch.swipe_reasoning).toEqual([
      { text: "Thought 0", duration: 1200 },
      null,
      { text: "New reasoning 2" },
    ]);

    // Falls back to top-level extra.reasoning / reasoning_duration when reasoningBySwipe is absent
    const legacyReasoningPatch = buildBackgroundSwipePatch({
      swipes: ["Swipe 0", ""],
      swipeIndex: 1,
      content: "New swipe 1",
      reasoningText: "New reasoning 1",
      existingExtra: {
        reasoning: "Legacy active thought",
        reasoning_duration: 850,
      },
      existingActiveSwipeId: 0,
    });
    expect(legacyReasoningPatch.swipe_reasoning).toEqual([
      { text: "Legacy active thought", duration: 850 },
      { text: "New reasoning 1" },
    ]);
  });

  test("buildPresetContextMetadata merges existing metadata, pads slots, and hasPresetContextForSwipe detects existing entries", () => {
    const fresh = buildPresetContextMetadata(undefined, 0, "preset-a");
    expect(fresh).toEqual({
      preset_contexts: [{ preset_id: "preset-a" }],
    });
    expect(hasPresetContextForSwipe(fresh, 0)).toBe(true);
    expect(hasPresetContextForSwipe(fresh, 1)).toBe(false);

    const padded = buildPresetContextMetadata(
      {
        customKey: "keep-me",
        preset_contexts: [{ preset_id: "preset-0" }],
      },
      2,
      "preset-2",
    );
    expect(padded).toEqual({
      customKey: "keep-me",
      preset_contexts: [
        { preset_id: "preset-0" },
        null,
        { preset_id: "preset-2" },
      ],
    });
    expect(hasPresetContextForSwipe(padded, 0)).toBe(true);
    expect(hasPresetContextForSwipe(padded, 1)).toBe(false);
    expect(hasPresetContextForSwipe(padded, 2)).toBe(true);
  });

  test("stripCreatedBlankAssistantTurnWithHistory removes eager blank slot by sourceMessageId or trailing blank fallback", () => {
    const withSourceId: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main" },
      { role: "user", content: "Hi", sourceMessageId: "m1" },
      { role: "assistant", content: "", sourceMessageId: "m-blank" },
      { role: "system", content: "Post-History" },
    ];
    const strippedById = stripCreatedBlankAssistantTurnWithHistory(
      withSourceId,
      "m-blank",
      [false, true, true, false],
    );
    expect(strippedById.messages.map((m) => m.content)).toEqual(["Main", "Hi", "Post-History"]);
    expect(strippedById.isChatHistory).toEqual([false, true, false]);

    const fallbackWithoutIds: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "" },
      { role: "system", content: "Post-History" },
      { role: "assistant", content: "Prefill...", partial: true },
    ];
    const strippedFallback = stripCreatedBlankAssistantTurnWithHistory(
      fallbackWithoutIds,
      "m-blank",
      [false, true, true, false, false],
    );
    expect(strippedFallback.messages.map((m) => m.content)).toEqual([
      "Main",
      "Hi",
      "Post-History",
      "Prefill...",
    ]);
    expect(strippedFallback.isChatHistory).toEqual([false, true, false, false]);

    // Must not remove a real non-blank assistant message when blank slot wasn't in dryRun.
    const realAssistant: AssembledLlmMessageDTO[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Previous real reply" },
      { role: "system", content: "Post-History" },
    ];
    const untouched = stripCreatedBlankAssistantTurnWithHistory(
      realAssistant,
      "m-blank",
      [true, true, false],
    );
    expect(untouched.messages.map((m) => m.content)).toEqual([
      "Hi",
      "Previous real reply",
      "Post-History",
    ]);
    expect(untouched.isChatHistory).toEqual([true, true, false]);
  });

  test("buildActiveSwipePatch forwards skipChunkRebuild and optional metadata", () => {
    const midStream = buildActiveSwipePatch({
      swipes: [""],
      swipeIndex: 0,
      content: "Hello",
      skipChunkRebuild: true,
    });
    expect(midStream.skipChunkRebuild).toBe(true);
    expect("metadata" in midStream).toBe(false);

    const finalWithMeta = buildActiveSwipePatch({
      swipes: ["Old", ""],
      swipeIndex: 1,
      content: "",
      metadata: { preset_contexts: [null, { preset_id: "p-1" }] },
      skipChunkRebuild: false,
    });
    expect(finalWithMeta.skipChunkRebuild).toBe(false);
    expect(finalWithMeta.metadata).toEqual({
      preset_contexts: [null, { preset_id: "p-1" }],
    });

    const clearReasoning = buildActiveSwipePatch({
      swipes: ["Base continued"],
      swipeIndex: 0,
      content: "Base",
      reasoningText: null,
      reasoningDuration: null,
      skipChunkRebuild: false,
    });
    expect(clearReasoning.reasoning).toEqual({ text: null, duration: null });
    expect(clearReasoning.skipChunkRebuild).toBe(false);

    const restoreReasoning = buildActiveSwipePatch({
      swipes: ["Base continued"],
      swipeIndex: 0,
      content: "Base",
      reasoningText: "Old thought",
      reasoningDuration: 2.5,
    });
    expect(restoreReasoning.reasoning).toEqual({ text: "Old thought", duration: 2.5 });
  });

  test("extractSwipeReasoning reads swipe arrays and falls back to active swipe extra fields", () => {
    const baseMsg: ChatMessageDTO = {
      id: "m-r",
      chat_id: "chat-1",
      index_in_chat: 1,
      is_user: false,
      name: "Alice",
      content: "Active swipe",
      send_date: 1700000000,
      swipe_id: 1,
      swipes: ["Swipe 0", "Swipe 1"],
      swipe_dates: [1700000000, 1700000010],
      extra: {
        reasoningBySwipe: ["Thought 0"],
        reasoningDurationBySwipe: [1.25],
        reasoning: "Thought 1",
        reasoningDuration: 3.5,
      },
      parent_message_id: null,
      branch_id: null,
      created_at: 1700000000,
    };

    expect(extractSwipeReasoning(baseMsg, 0)).toEqual({
      text: "Thought 0",
      duration: 1.25,
    });
    expect(extractSwipeReasoning(baseMsg, 1)).toEqual({
      text: "Thought 1",
      duration: 3.5,
    });
    expect(extractSwipeReasoning(baseMsg, 2)).toEqual({
      text: null,
      duration: null,
    });

    const snakeCaseMsg: ChatMessageDTO = {
      ...baseMsg,
      swipe_id: 0,
      extra: {
        reasoning: "Snake thought",
        reasoning_duration: 4.2,
      },
    };
    expect(extractSwipeReasoning(snakeCaseMsg, 0)).toEqual({
      text: "Snake thought",
      duration: 4.2,
    });
    expect(extractSwipeReasoning(snakeCaseMsg, 1)).toEqual({
      text: null,
      duration: null,
    });
  });

  test("resolveChatHistoryFlags, stripInternalMessageMarkers, and history strippers handle host __* markers", () => {
    const hostMessages: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main Prompt" },
      {
        role: "system",
        content: "World Info",
        __worldInfoSource: true,
        __chatHistorySource: false,
      },
      {
        role: "user",
        content: "Hello",
        __chatHistorySource: true,
        __sourceMessageId: "m-1",
        __sourceIndexInChat: 0,
      },
      {
        role: "assistant",
        content: "Old swipe",
        __chatHistorySource: true,
        __sourceMessageId: "m-2",
        __sourceIndexInChat: 1,
      },
      { role: "system", content: "Post-History", __chatHistorySource: false },
      { role: "assistant", content: "Prefill...", partial: true },
    ];

    const hostFlags = resolveChatHistoryFlags(hostMessages);
    expect(hostFlags).toEqual([false, false, true, true, false, false]);

    // Falls back to __sourceMessageId when boolean history flags are absent
    const sourceIdOnly: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main Prompt" },
      { role: "user", content: "Hello", __sourceMessageId: "m-1", __sourceIndexInChat: 0 },
      { role: "assistant", content: "Reply", __sourceMessageId: "m-2", __sourceIndexInChat: 1 },
      { role: "system", content: "World Info", __worldInfoSource: true },
    ];
    expect(resolveChatHistoryFlags(sourceIdOnly)).toEqual([false, true, true, false]);

    // stripInternalMessageMarkers strips all internal host/interceptor flags
    const cleaned = stripInternalMessageMarkers([
      ...hostMessages,
      {
        role: "user",
        content: "Legacy flags",
        __isChatHistory: true,
        __isWorldInfoEntry: false,
      },
    ]);
    for (const msg of cleaned) {
      expect("__chatHistorySource" in msg).toBe(false);
      expect("__worldInfoSource" in msg).toBe(false);
      expect("__sourceMessageId" in msg).toBe(false);
      expect("__sourceIndexInChat" in msg).toBe(false);
      expect("__isChatHistory" in msg).toBe(false);
      expect("__isWorldInfoEntry" in msg).toBe(false);
    }
    expect(cleaned[5] as unknown as Record<string, unknown>).toEqual({
      role: "assistant",
      content: "Prefill...",
      partial: true,
    });

    // stripRejectedSwipeAssistantTurnWithHistory matches __sourceMessageId
    const strippedSwipe = stripRejectedSwipeAssistantTurnWithHistory(
      hostMessages,
      "m-2",
      hostFlags,
    );
    expect(strippedSwipe.messages.map((m) => m.content)).toEqual([
      "Main Prompt",
      "World Info",
      "Hello",
      "Post-History",
      "Prefill...",
    ]);
    expect(strippedSwipe.isChatHistory).toEqual([false, false, true, false, false]);

    // stripCreatedBlankAssistantTurnWithHistory matches __sourceMessageId
    const withBlankSlot: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main Prompt" },
      {
        role: "user",
        content: "Hello",
        __chatHistorySource: true,
        __sourceMessageId: "m-1",
        __sourceIndexInChat: 0,
      },
      {
        role: "assistant",
        content: "",
        __chatHistorySource: true,
        __sourceMessageId: "m-blank",
        __sourceIndexInChat: 1,
      },
      { role: "system", content: "Post-History", __chatHistorySource: false },
    ];
    const blankFlags = resolveChatHistoryFlags(withBlankSlot);
    expect(blankFlags).toEqual([false, true, true, false]);
    const strippedBlank = stripCreatedBlankAssistantTurnWithHistory(
      withBlankSlot,
      "m-blank",
      blankFlags,
    );
    expect(strippedBlank.messages.map((m) => m.content)).toEqual([
      "Main Prompt",
      "Hello",
      "Post-History",
    ]);
    expect(strippedBlank.isChatHistory).toEqual([false, true, false]);
  });

  test("injectGuidanceMessage places guided_continue accurately after finalizeContinuePrompt with continueNudge and strips safely with partial/non-history guards", () => {
    // Shape produced by Lumiverse finalizeContinuePrompt:
    // continued assistant turn moved out of isChatHistory, followed by continueNudge system block
    const finalizedContinue: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main", __chatHistorySource: false },
      { role: "user", content: "Turn 1 user", __chatHistorySource: true },
      { role: "assistant", content: "Turn 1 assistant", __chatHistorySource: true },
      { role: "user", content: "Turn 2 user", __chatHistorySource: true },
      { role: "system", content: "Post-History", __chatHistorySource: false },
      { role: "assistant", content: "Continued turn...", __chatHistorySource: false },
      { role: "system", content: "[Continue Nudge]", __continueNudge: true, __chatHistorySource: false },
    ];
    const flags = resolveChatHistoryFlags(finalizedContinue);
    expect(flags).toEqual([false, true, true, true, false, false, false]);

    expect(
      injectGuidanceMessage(finalizedContinue, "[G]", "user", {
        actionId: "guided_continue",
        guidancePosition: "pre_history",
        isChatHistory: flags,
      }).map((m) => m.content),
    ).toEqual([
      "Main",
      "[G]",
      "Turn 1 user",
      "Turn 1 assistant",
      "Turn 2 user",
      "Post-History",
      "Continued turn...",
      "[Continue Nudge]",
    ]);

    expect(
      injectGuidanceMessage(finalizedContinue, "[G]", "user", {
        actionId: "guided_continue",
        guidancePosition: "before_post_history",
        isChatHistory: flags,
      }).map((m) => m.content),
    ).toEqual([
      "Main",
      "Turn 1 user",
      "Turn 1 assistant",
      "Turn 2 user",
      "[G]",
      "Post-History",
      "Continued turn...",
      "[Continue Nudge]",
    ]);

    // in_history depth 0 & 1 both land right after Turn 2 user (just before the moved continued turn / post-history)
    for (const depth of [0, 1]) {
      expect(
        injectGuidanceMessage(finalizedContinue, "[G]", "user", {
          actionId: "guided_continue",
          guidancePosition: "in_history",
          guidanceDepth: depth,
          isChatHistory: flags,
        }).map((m) => m.content),
      ).toEqual([
        "Main",
        "Turn 1 user",
        "Turn 1 assistant",
        "Turn 2 user",
        "[G]",
        "Post-History",
        "Continued turn...",
        "[Continue Nudge]",
      ]);
    }

    // in_history depth 2 steps 1 message further back in remaining history (before Turn 2 user)
    expect(
      injectGuidanceMessage(finalizedContinue, "[G]", "user", {
        actionId: "guided_continue",
        guidancePosition: "in_history",
        guidanceDepth: 2,
        isChatHistory: flags,
      }).map((m) => m.content),
    ).toEqual([
      "Main",
      "Turn 1 user",
      "Turn 1 assistant",
      "[G]",
      "Turn 2 user",
      "Post-History",
      "Continued turn...",
      "[Continue Nudge]",
    ]);

    // post_history places right before the moved continued assistant turn (after Post-History, before Continue Nudge)
    expect(
      injectGuidanceMessage(finalizedContinue, "[G]", "user", {
        actionId: "guided_continue",
        guidancePosition: "post_history",
        isChatHistory: flags,
      }).map((m) => m.content),
    ).toEqual([
      "Main",
      "Turn 1 user",
      "Turn 1 assistant",
      "Turn 2 user",
      "Post-History",
      "[G]",
      "Continued turn...",
      "[Continue Nudge]",
    ]);

    // Fallback swipe stripping skips non-history and partial assistant prefill turns
    const swipeFallbackMsgs: AssembledLlmMessageDTO[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Old reply" },
      { role: "assistant", content: "Post-history assistant example" },
      { role: "assistant", content: "Prefill", partial: true },
    ];
    const stripped = stripRejectedSwipeAssistantTurnWithHistory(
      swipeFallbackMsgs,
      "missing-id",
      [true, true, false, false],
    );
    expect(stripped.messages.map((m) => m.content)).toEqual([
      "Hello",
      "Post-history assistant example",
      "Prefill",
    ]);
    expect(stripped.isChatHistory).toEqual([true, false, false]);
  });

  test("stripRejectedSwipeAssistantTurnWithHistory unshifts depth=1 in_history system block before latest user with post_history assistant-user-system", () => {
    // Exact reported guided_swipe bug:
    // Chat has prior turns + latest user + rejected assistant swipe; preset has in_history system at depth=1
    // plus post_history assistant - user - system.
    const assembled: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main Prompt", __chatHistorySource: false },
      { role: "user", content: "Earlier user", __chatHistorySource: true, __sourceMessageId: "m1" },
      { role: "assistant", content: "Earlier assistant", __chatHistorySource: true, __sourceMessageId: "m2" },
      { role: "user", content: "Latest user", __chatHistorySource: true, __sourceMessageId: "m3" },
      { role: "system", content: "Depth 1 System", __chatHistorySource: false },
      { role: "assistant", content: "", __chatHistorySource: true, __sourceMessageId: "m4" },
      { role: "assistant", content: "Post assistant", __chatHistorySource: false },
      { role: "user", content: "Post user", __chatHistorySource: false },
      { role: "system", content: "Post system", __chatHistorySource: false },
    ];
    const flags = resolveChatHistoryFlags(assembled);
    expect(flags).toEqual([false, true, true, true, false, true, false, false, false]);

    const stripped = stripRejectedSwipeAssistantTurnWithHistory(assembled, "m4", flags);
    expect(stripped.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      "system:Main Prompt",
      "user:Earlier user",
      "assistant:Earlier assistant",
      "system:Depth 1 System",
      "user:Latest user",
      "assistant:Post assistant",
      "user:Post user",
      "system:Post system",
    ]);
    expect(stripped.isChatHistory).toEqual([false, true, true, false, true, false, false, false]);
  });

  test("removeTrailingHistoryTurnAndUnshiftDepth shifts multi-depth blocks (depth=1..k), preserves WI after h0, and keeps depth=0/post_history after h_{k-1}", () => {
    // Chat has 4 history turns: h0 (m1), h1 (m2), h2 (m3), h3 (m4 - stripped blank/rejected)
    // Gap 1 (h0..h1) has WI anAfter (must stay after h0) + depth=3 system (must shift before h0)
    // Gap 2 (h1..h2) has depth=2 system + depth=2 WI (must shift before h1)
    // Gap 3 (h2..h3) has depth=1 system (must shift before h2)
    // Post h3 has depth=0 system + post_history + prefill (must stay after h2)
    const assembled: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Pre-history / depth>=4", __chatHistorySource: false },
      { role: "user", content: "h0", __chatHistorySource: true, __sourceMessageId: "m1" },
      { role: "system", content: "WI anAfter", __chatHistorySource: false, __isWorldInfoEntry: true },
      { role: "system", content: "Depth 3 block", __chatHistorySource: false },
      { role: "assistant", content: "h1", __chatHistorySource: true, __sourceMessageId: "m2" },
      { role: "system", content: "Depth 2 preset", __chatHistorySource: false },
      { role: "system", content: "Depth 2 WI", __chatHistorySource: false, __worldInfoSource: true },
      { role: "user", content: "h2", __chatHistorySource: true, __sourceMessageId: "m3" },
      { role: "system", content: "Depth 1 block", __chatHistorySource: false },
      { role: "assistant", content: "", __chatHistorySource: true, __sourceMessageId: "m4" },
      { role: "system", content: "Depth 0 block", __chatHistorySource: false },
      { role: "system", content: "Post-history", __chatHistorySource: false },
      { role: "assistant", content: "Prefill", partial: true, __chatHistorySource: false },
    ];
    const flags = resolveChatHistoryFlags(assembled);

    const swipeStripped = stripRejectedSwipeAssistantTurnWithHistory(assembled, "m4", flags);
    expect(swipeStripped.messages.map((m) => m.content)).toEqual([
      "Pre-history / depth>=4",
      "Depth 3 block",
      "h0",
      "WI anAfter",
      "Depth 2 preset",
      "Depth 2 WI",
      "h1",
      "Depth 1 block",
      "h2",
      "Depth 0 block",
      "Post-history",
      "Prefill",
    ]);
    expect(swipeStripped.isChatHistory).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);

    // Same behavior for stripCreatedBlankAssistantTurnWithHistory (guided_response / guided_regenerate)
    const blankStripped = stripCreatedBlankAssistantTurnWithHistory(assembled, "m4", flags);
    expect(blankStripped.messages.map((m) => m.content)).toEqual(
      swipeStripped.messages.map((m) => m.content),
    );
    expect(blankStripped.isChatHistory).toEqual(swipeStripped.isChatHistory);

    // Fallback without sourceMessageId also unshifts depth cleanly
    const noIds = assembled.map(({ __sourceMessageId: _ignored, ...rest }) => rest);
    const fallbackBlank = stripCreatedBlankAssistantTurnWithHistory(noIds, "missing", flags);
    expect(fallbackBlank.messages.map((m) => m.content)).toEqual(
      swipeStripped.messages.map((m) => m.content),
    );
    expect(fallbackBlank.isChatHistory).toEqual(swipeStripped.isChatHistory);

    // Single-turn chat (k === 0, only h0 = targetIdx): strips h0 without touching non-history order
    const singleTurn: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main", __chatHistorySource: false },
      { role: "assistant", content: "", __chatHistorySource: true, __sourceMessageId: "m-only" },
      { role: "system", content: "Post", __chatHistorySource: false },
    ];
    const singleStripped = stripCreatedBlankAssistantTurnWithHistory(
      singleTurn,
      "m-only",
      [false, true, false],
    );
    expect(singleStripped.messages.map((m) => m.content)).toEqual(["Main", "Post"]);
    expect(singleStripped.isChatHistory).toEqual([false, false]);
  });

  test("mergeConsecutiveSameRoleMessages merges string and multimodal parts and preserves partial flag", () => {
    const merged = mergeConsecutiveSameRoleMessages([
      { role: "system", content: "Main" },
      { role: "system", content: "Depth 1" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "First part" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Prefill" }],
        partial: true,
      },
    ]);

    expect(merged).toEqual([
      { role: "system", content: "Main\n\nDepth 1" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "First part\n\nPrefill", partial: true },
    ]);

    const multimodal = mergeConsecutiveSameRoleMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "Look:" },
          { type: "image", data: "YWJj", mime_type: "image/png" },
        ],
      },
      { role: "user", content: "What is this?" },
    ]);
    expect(multimodal).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Look:" },
          { type: "image", data: "YWJj", mime_type: "image/png" },
          { type: "text", text: "\n\n" },
          { type: "text", text: "What is this?" },
        ],
      },
    ]);
  });

  test("hasNonEmptyLlmContent mirrors Lumiverse generate.service.ts empty-turn filtering", () => {
    expect(hasNonEmptyLlmContent({ role: "assistant", content: "" })).toBe(false);
    expect(hasNonEmptyLlmContent({ role: "assistant", content: "   \n\t  " })).toBe(false);
    expect(hasNonEmptyLlmContent({ role: "assistant", content: "", partial: true })).toBe(true);
    expect(hasNonEmptyLlmContent({ role: "user", content: "", partial: true })).toBe(false);
    expect(hasNonEmptyLlmContent({ role: "system", content: "Main prompt" })).toBe(true);
    expect(hasNonEmptyLlmContent({ role: "user", content: [] })).toBe(false);
    expect(
      hasNonEmptyLlmContent({
        role: "user",
        content: [{ type: "image", data: "YWJj", mime_type: "image/png" }],
      }),
    ).toBe(true);
  });

  test("stripRejectedSwipeAssistantTurnWithHistory with requireBlankFallback preserves earlier non-empty assistant turn when already-empty swipe was pruned", () => {
    // Trailing blank assistant turn was dropped by stripEmptyTextParts and sourceMessageId is absent (!interceptor)
    const prunedPrompt: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main", __chatHistorySource: false },
      { role: "user", content: "Turn 1", __chatHistorySource: true },
      { role: "assistant", content: "Earlier non-empty reply", __chatHistorySource: true },
      { role: "system", content: "Post-history", __chatHistorySource: false },
    ];
    const flags = [false, true, true, false];

    const preserved = stripRejectedSwipeAssistantTurnWithHistory(
      prunedPrompt,
      "m-empty-target",
      flags,
      { requireBlankFallback: true },
    );
    expect(preserved.messages.map((m) => m.content)).toEqual([
      "Main",
      "Turn 1",
      "Earlier non-empty reply",
      "Post-history",
    ]);
    expect(preserved.isChatHistory).toEqual([false, true, true, false]);

    // Still strips when trailing assistant turn IS blank
    const withBlankTrailing: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Main", __chatHistorySource: false },
      { role: "user", content: "Turn 1", __chatHistorySource: true },
      { role: "assistant", content: "Earlier non-empty reply", __chatHistorySource: true },
      { role: "assistant", content: "   ", __chatHistorySource: true },
      { role: "system", content: "Post-history", __chatHistorySource: false },
    ];
    const strippedBlank = stripRejectedSwipeAssistantTurnWithHistory(
      withBlankTrailing,
      "m-empty-target",
      [false, true, true, true, false],
      { requireBlankFallback: true },
    );
    expect(strippedBlank.messages.map((m) => m.content)).toEqual([
      "Main",
      "Turn 1",
      "Earlier non-empty reply",
      "Post-history",
    ]);
    expect(strippedBlank.isChatHistory).toEqual([false, true, true, false]);
  });

  test("collapseMessagesToSingleRole returns 1-message prompts unchanged and collapses multimodal multi-message prompts", () => {
    const singleUser: AssembledLlmMessageDTO[] = [{ role: "user", content: "Only message" }];
    const singleResult = collapseMessagesToSingleRole(singleUser, "system");
    expect(singleResult).toEqual([{ role: "user", content: "Only message" }]);
    expect(singleResult[0]).not.toBe(singleUser[0]);

    const multimodal: AssembledLlmMessageDTO[] = [
      { role: "system", content: "System intro" },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this:" },
          { type: "image", data: "YWJj", mime_type: "image/png" },
        ],
      },
      { role: "assistant", content: "Looks cool" },
    ];
    expect(collapseMessagesToSingleRole(multimodal, "user")).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "System intro\n\nDescribe this:\n\nLooks cool" },
          { type: "image", data: "YWJj", mime_type: "image/png" },
        ],
      },
    ]);
  });
});

