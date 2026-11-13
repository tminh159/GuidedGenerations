import { describe, expect, test } from "bun:test";
import type { ChatMessageDTO, LlmMessageDTO } from "lumiverse-spindle-types";
import {
  buildActiveSwipePatch,
  buildDryRunInput,
  type ChatMessageWithRole,
  findLastAssistantMessage,
  formatGuidanceText,
  injectGuidanceMessage,
  normalizeMessageSwipes,
  resolveEffectiveModelAndProvider,
  stitchContinueContent,
  stripRejectedSwipeAssistantTurn,
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
});

