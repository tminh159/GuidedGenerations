import { describe, expect, test } from "bun:test";
import manifestJson from "../spindle.json";
import {
  DEFAULT_BUTTON_ORDER,
  DEFAULT_GUIDED_SCENE_CONFIG,
  GUIDED_ACTION_ORDER,
  GUIDED_SCENE_METADATA,
  SCENE_GUIDANCE_POSITION_OPTIONS,
  TOOLBAR_OPTION_LABELS,
  createDefaultSettings,
  isGuidedActionId,
  isRunActionId,
  isToolbarOptionId,
  normalizeButtonOrder,
  normalizeGuidedSceneConfig,
  normalizeSceneReadinessTag,
} from "../src/shared/defaults";
import type { ArmedSceneState } from "../src/shared/types";
import type { AssembledLlmMessageDTO } from "../src/backend/prompt-builder";
import {
  extractMediaSlots,
  hasMediaContent,
  restoreMediaSlots,
  restoreMediaSlotsWithReport,
  stripMediaForSteering,
} from "../src/backend/scene-media";
import {
  buildRewriteMessages,
  combineBridgeAndVerbatimScene,
  hasReadinessTag,
  injectSceneDirective,
  renderSteeringDirective,
  resolveGreetingMacros,
  stripReadinessTag,
} from "../src/backend/scene-prompts";

describe("shared Guided Scene contract & defaults", () => {
  test("registers guided_scene as a toolbar & run option without bloating GUIDED_ACTION_ORDER", () => {
    expect(GUIDED_ACTION_ORDER).toHaveLength(5);
    expect(isGuidedActionId("guided_scene")).toBe(false);
    expect(isRunActionId("guided_scene")).toBe(true);
    expect(isRunActionId("guided_response")).toBe(true);
    expect(isToolbarOptionId("guided_scene")).toBe(true);
    expect(DEFAULT_BUTTON_ORDER).toContain("guided_scene");
    expect(GUIDED_SCENE_METADATA.label).toBe("Guided Scene");
    expect(TOOLBAR_OPTION_LABELS.guided_scene).toBe("Guided Scene");

    // Existing saved button orders missing guided_scene safely get it appended once
    const normalized = normalizeButtonOrder(["guided_response", "input_recovery", "guided_scene", "guided_scene"]);
    expect(normalized.filter((id) => id === "guided_scene")).toHaveLength(1);
    expect(normalized).toHaveLength(DEFAULT_BUTTON_ORDER.length);
  });

  test("includes append_last_user in SCENE_GUIDANCE_POSITION_OPTIONS and sane defaults", () => {
    const values = SCENE_GUIDANCE_POSITION_OPTIONS.map((opt) => opt.value);
    expect(values).toEqual([
      "before_post_history",
      "in_history",
      "pre_history",
      "post_history",
      "append_last_user",
    ]);

    const settings = createDefaultSettings();
    expect(settings.guidedScene).toEqual(DEFAULT_GUIDED_SCENE_CONFIG);
    expect(settings.guidedScene.enabled).toBe(true);
    expect(settings.guidedScene.contextMode).toBe("lightweight");
    expect(settings.guidedScene.contextTurns).toBe(20);
    expect(settings.guidedScene.injectionRole).toBe("system");
    expect(settings.guidedScene.guidancePosition).toBe("before_post_history");
    expect(settings.guidedScene.guidanceDepth).toBe(0);
    expect(settings.guidedScene.keepMediaIntact).toBe(true);
    expect(settings.guidedScene.applyRegex).toBe(true);
    expect(settings.guidedScene.pacing).toBe("drop_now");
    expect(settings.guidedScene.delivery).toBe("time_skip");
    expect(settings.guidedScene.adjustmentMode).toBe("verbatim");
    expect(settings.guidedScene.dropTarget).toBe("new_message");
    expect(settings.guidedScene.readinessTag).toBe("scene-ready");
  });

  test("normalizeGuidedSceneConfig clamps turns, sanitizes readinessTag, and ignores invalid enums", () => {
    const normalized = normalizeGuidedSceneConfig({
      enabled: false,
      connectionId: " conn-scene ",
      model: "  ",
      presetId: "preset-1",
      contextMode: "full_preset",
      contextTurns: 9999,
      injectionRole: "invalid",
      guidancePosition: "append_last_user",
      guidanceDepth: -4,
      keepMediaIntact: false,
      applyRegex: false,
      pacing: "multi_turn",
      delivery: "bridge",
      adjustmentMode: "context_adapt",
      dropTarget: "new_swipe",
      readinessTag: " <my-ready_tag /> ",
    });

    expect(normalized.enabled).toBe(false);
    expect(normalized.connectionId).toBe("conn-scene");
    expect(normalized.model).toBeNull();
    expect(normalized.presetId).toBe("preset-1");
    expect(normalized.contextMode).toBe("full_preset");
    expect(normalized.contextTurns).toBe(200);
    expect(normalized.injectionRole).toBe("system");
    expect(normalized.guidancePosition).toBe("append_last_user");
    expect(normalized.guidanceDepth).toBe(0);
    expect(normalized.keepMediaIntact).toBe(false);
    expect(normalized.applyRegex).toBe(false);
    expect(normalized.pacing).toBe("multi_turn");
    expect(normalized.delivery).toBe("bridge");
    expect(normalized.adjustmentMode).toBe("context_adapt");
    expect(normalized.dropTarget).toBe("new_swipe");
    expect(normalized.readinessTag).toBe("my-ready_tag");

    expect(normalizeSceneReadinessTag("123-bad!!")).toBe("scene-ready");
    expect(normalizeSceneReadinessTag("")).toBe("scene-ready");
    expect(normalizeGuidedSceneConfig({ contextTurns: 0 }).contextTurns).toBe(1);
  });
});

describe("scene-media slot extraction, restoration, and steering strip", () => {
  test("extracts Markdown images (including balanced parens, spaces, titles, and $ characters) and tracks positions", () => {
    const banner = '![Banner [v2]](https://cdn.example.com/a(1)/hero_$&_$$.png "Main Art")';
    const inlineImg = "![Inline](<https://cdn.example.com/room with spaces.webp>)";
    const footer = "![Outro](https://cdn.example.com/outro.jpg)";
    const input = `${banner}\n\nThe tavern doors swing open.\n\n${inlineImg}\n\nRain rattles the glass.\n\n${footer}`;

    const extracted = extractMediaSlots(input);
    expect(extracted.hasMedia).toBe(true);
    expect(hasMediaContent(input)).toBe(true);
    expect(extracted.slots).toHaveLength(3);
    expect(extracted.slots.map((s) => ({ token: s.token, pos: s.position, kind: s.kind }))).toEqual([
      { token: "[[MEDIA_1]]", pos: "leading", kind: "markdown_image" },
      { token: "[[MEDIA_2]]", pos: "inline", kind: "markdown_image" },
      { token: "[[MEDIA_3]]", pos: "trailing", kind: "markdown_image" },
    ]);
    expect(extracted.slots[0]!.original).toBe(banner);
    expect(extracted.slots[1]!.original).toBe(inlineImg);
    expect(extracted.slots[2]!.original).toBe(footer);
    expect(extracted.text).toBe(
      "[[MEDIA_1]]\n\nThe tavern doors swing open.\n\n[[MEDIA_2]]\n\nRain rattles the glass.\n\n[[MEDIA_3]]",
    );

    // Byte-for-byte restoration including special regex replacement sequences ($& / $$)
    const restored = restoreMediaSlots(extracted.text, extracted.slots);
    expect(restored).toBe(input);
  });

  test("extracts HTML media blocks atomically (img, video, audio, picture, figure) without splitting nested tags", () => {
    const figureBlock =
      '<figure class="scene">\n  <picture>\n    <source srcset="/a.avif" type="image/avif">\n    <img src="/a.png" alt="a > b">\n  </picture>\n  <figcaption>The courtyard</figcaption>\n</figure>';
    const imgTag = '<IMG src="/portrait.png" alt="portrait > frame" />';
    const videoBlock =
      '<video controls autoplay loop>\n  <source src="/rain.mp4" type="video/mp4">\n</video>';
    const audioBlock = '<audio controls><source src="/bgm.ogg" type="audio/ogg"></audio>';

    const input = `${figureBlock}\n\nShe steps forward.\n${imgTag}\nMiddle prose.\n${videoBlock}\n${audioBlock}`;
    const extracted = extractMediaSlots(input);

    expect(extracted.slots).toHaveLength(4);
    expect(extracted.slots.map((s) => [s.kind, s.position])).toEqual([
      ["html_figure", "leading"],
      ["html_img", "inline"],
      ["html_video", "trailing"],
      ["html_audio", "trailing"],
    ]);
    expect(extracted.slots[0]!.original).toBe(figureBlock);
    expect(extracted.slots[1]!.original).toBe(imgTag);
    expect(extracted.slots[2]!.original).toBe(videoBlock);
    expect(extracted.slots[3]!.original).toBe(audioBlock);

    expect(restoreMediaSlots(extracted.text, extracted.slots)).toBe(input);
  });

  test("re-anchors omitted slots safely (leading at top, inline/trailing at bottom) and tolerates placeholder drift", () => {
    const top1 = "![Top1](/top1.png)";
    const top2 = '<img src="/top2.png">';
    const mid = "![Mid](/mid.png)";
    const end = '<video src="/end.mp4"></video>';
    const source = `${top1}\n${top2}\n\nHello.\n${mid}\nGoodbye.\n\n${end}`;
    const { slots } = extractMediaSlots(source);

    // LLM keeps MEDIA_2 with sloppy whitespace/casing, duplicates it once, and drops MEDIA_1, MEDIA_3, MEDIA_4
    const rewritten = "[[ media_2 ]]\n\nFreshly adapted story.\n[[MEDIA_2]]";
    const report = restoreMediaSlotsWithReport(rewritten, slots);

    expect(report.restoredTokens).toEqual(["[[MEDIA_2]]"]);
    expect(report.reanchoredTokens).toEqual(["[[MEDIA_1]]", "[[MEDIA_3]]", "[[MEDIA_4]]"]);
    expect(report.text.startsWith(`${top1}\n\n`)).toBe(true);
    expect(report.text).toContain(top2);
    expect(report.text.indexOf(top2)).toBe(report.text.lastIndexOf(top2));
    expect(report.text.endsWith(`\n\n${mid}\n${end}`)).toBe(true);
    expect(report.text).not.toContain("[[MEDIA_");
  });

  test("does not duplicate media if LLM emitted original markup verbatim, and ignores unclosed figure safely", () => {
    const img = "![Map](/map.png)";
    const { slots } = extractMediaSlots(`${img}\n\nProse.`);
    const restored = restoreMediaSlots(`Rewritten.\n${img}`, slots);
    expect(restored.indexOf(img)).toBe(restored.lastIndexOf(img));

    const unclosed = "<figure>Not actually closed\nStill prose here.";
    const extracted = extractMediaSlots(unclosed);
    expect(extracted.hasMedia).toBe(false);
    expect(extracted.text).toBe(unclosed);
  });

  test("stripMediaForSteering removes Markdown images, HTML media blocks, and stray media tags", () => {
    const raw = [
      "![Hero](https://example.com/hero.png)",
      "",
      '<figure><img src="/bg.jpg" alt="bg"><figcaption>Banner</figcaption></figure>',
      "The lantern flickers in the rain.",
      '<video src="/clip.mp4"></video>',
      '<img src="/stray.png">',
      "Footsteps echo down the alley.",
    ].join("\n");

    const stripped = stripMediaForSteering(raw);
    expect(stripped).toBe("The lantern flickers in the rain.\n\nFootsteps echo down the alley.");
    expect(stripped).not.toContain("https://example.com");
    expect(stripped).not.toContain("<img");
    expect(stripped).not.toContain("<video");
    expect(stripped).not.toContain("<figure");
  });
});

describe("scene-prompts readiness tags, macros, steering, injection, and rewrite builders", () => {
  test("hasReadinessTag and stripReadinessTag handle self-closing, paired, whitespace, case, and blank lines", () => {
    expect(hasReadinessTag("They reach the harbor.\n\n<scene-ready />")).toBe(true);
    expect(hasReadinessTag("Done.<SCENE-READY/>")).toBe(true);
    expect(hasReadinessTag("Done.\n<Scene-Ready>now</Scene-Ready>")).toBe(true);
    expect(hasReadinessTag("Still walking.")).toBe(false);

    expect(stripReadinessTag("They reach the harbor.\n\n<scene-ready />\n")).toBe(
      "They reach the harbor.",
    );
    expect(stripReadinessTag("First para.\n\n<scene-ready />\n\nSecond para.")).toBe(
      "First para.\n\nSecond para.",
    );
    expect(stripReadinessTag("She nods. <SCENE-READY />")).toBe("She nods.");
    expect(stripReadinessTag("Arrived.\n<custom-go>ready</custom-go>", "custom-go")).toBe(
      "Arrived.",
    );
    expect(stripReadinessTag("Untouched text.")).toBe("Untouched text.");
  });

  test("resolveGreetingMacros performs owner-aware case-insensitive substitution safely", () => {
    const text = "{{char}} hands {{USER}} a ledger marked $100 from {{Char}} to {{unknown}}.";
    expect(
      resolveGreetingMacros(text, { charName: "Aria $V", userName: "Kai $$" }),
    ).toBe("Aria $V hands Kai $$ a ledger marked $100 from Aria $V to {{unknown}}.");

    // Leaves macros intact when names omitted
    expect(resolveGreetingMacros("{{char}} greets {{user}}.", {})).toBe(
      "{{char}} greets {{user}}.",
    );
  });

  test("renderSteeringDirective shapes guidance by pacing, delivery, transitionNote, speaker, and strips media", () => {
    const baseArmed: ArmedSceneState = {
      chatId: "chat-1",
      status: "armed",
      pacing: "multi_turn",
      delivery: "bridge",
      adjustmentMode: "verbatim",
      greetingSource: "card",
      selectedGreetingKey: "char-2:1",
      greetingLabel: "#2 Rooftop Rain",
      rawGreetingText:
        '![Roof](https://cdn.example.com/roof.png)\n\n{{char}} leans against the wet railing waiting for {{user}}.',
      speakerCharacterId: "char-2",
      speakerCharacterName: "Nyx",
      transitionNote: "Make it start pouring right as they climb the stairs.",
      customDirection: "",
      lockedDraftText: null,
      draftLocked: false,
      armedAt: 1000,
    };

    const multiTurnDirective = renderSteeringDirective(
      baseArmed,
      { readinessTag: "scene-ready" },
      { charName: "OtherChar", userName: "Robin" },
    );

    expect(multiTurnDirective).toContain("Nyx leans against the wet railing waiting for Robin.");
    expect(multiTurnDirective).not.toContain("https://cdn.example.com/roof.png");
    expect(multiTurnDirective).toContain("In-Scene Bridge");
    expect(multiTurnDirective).toContain("Make it start pouring right as they climb the stairs.");
    expect(multiTurnDirective).toContain("Do NOT output <scene-ready /> while still building up");

    const nextTurnDirective = renderSteeringDirective(
      { ...baseArmed, pacing: "next_turn", delivery: "time_skip", transitionNote: "" },
      { steeringTemplate: "Custom steer: {{target_scene}}", readinessTag: "handoff-now" },
      { userName: "Robin" },
    );
    expect(nextTurnDirective).toContain("Custom steer: Nyx leans");
    expect(nextTurnDirective).toContain("<handoff-now />");
  });

  test("injectSceneDirective supports all 4 standard positions plus append_last_user and its fallback", () => {
    const messages: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Pre-history system" },
      { role: "user", content: "Turn 1 user" },
      { role: "assistant", content: "Turn 1 assistant" },
      { role: "user", content: "Turn 2 user" },
      { role: "system", content: "Post-history note" },
    ];
    const historyFlags = [false, true, true, true, false];

    // 1. append_last_user when latest history turn is non-empty user
    const appended = injectSceneDirective(
      messages,
      "Guide toward the harbor.",
      "system",
      "append_last_user",
      0,
      historyFlags,
    );
    expect(appended.appliedPosition).toBe("append_last_user");
    expect(appended.injectedIndex).toBe(3);
    expect(appended.messages).toHaveLength(5);
    expect(appended.messages[3]!.content).toBe(
      "Turn 2 user\n\n(OOC: Guide toward the harbor. Do not reply to this note.)",
    );
    // Input must remain unmutated
    expect(messages[3]!.content).toBe("Turn 2 user");

    // 2. append_last_user with multimodal user content
    const multimodalMessages: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this map." },
          { type: "image", data: "base64data", mimeType: "image/png" } as unknown as Extract<
            AssembledLlmMessageDTO["content"],
            readonly unknown[]
          >[number],
        ],
      },
    ];
    const multimodalAppended = injectSceneDirective(
      multimodalMessages,
      "Steer gently.",
      "system",
      "append_last_user",
      0,
      [false, true],
    );
    expect(multimodalAppended.appliedPosition).toBe("append_last_user");
    expect(Array.isArray(multimodalAppended.messages[1]!.content)).toBe(true);
    const parts = multimodalAppended.messages[1]!.content as Array<{ type: string; text?: string }>;
    expect(parts[parts.length - 1]).toEqual({
      type: "text",
      text: "\n\n(OOC: Steer gently. Do not reply to this note.)",
    });

    // 3. append_last_user falls back to before_post_history when latest history turn is assistant (e.g. group chat)
    const groupMsgs: AssembledLlmMessageDTO[] = [
      { role: "system", content: "Pre" },
      { role: "user", content: "User spoke earlier" },
      { role: "assistant", content: "Char A replied" },
      { role: "system", content: "Post" },
    ];
    const fallback = injectSceneDirective(
      groupMsgs,
      "Bring them to the courtyard.",
      "system",
      "append_last_user",
      0,
      [false, true, true, false],
    );
    expect(fallback.appliedPosition).toBe("before_post_history");
    expect(fallback.injectedIndex).toBe(3);
    expect(fallback.messages).toHaveLength(5);
    expect(fallback.messages[3]).toEqual({
      role: "system",
      content: "Bring them to the courtyard.",
    });

    // 4. Standard positions: pre_history, before_post_history, in_history, post_history
    const pre = injectSceneDirective(messages, "Dir", "system", "pre_history", 0, historyFlags);
    expect(pre.appliedPosition).toBe("pre_history");
    expect(pre.injectedIndex).toBe(1);

    const beforePost = injectSceneDirective(
      messages,
      "Dir",
      "system",
      "before_post_history",
      0,
      historyFlags,
    );
    expect(beforePost.appliedPosition).toBe("before_post_history");
    expect(beforePost.injectedIndex).toBe(4);

    const inHist = injectSceneDirective(messages, "Dir", "user", "in_history", 1, historyFlags);
    expect(inHist.appliedPosition).toBe("in_history");
    expect(inHist.injectedIndex).toBe(3);
    expect(inHist.messages[3]!.role).toBe("user");

    const post = injectSceneDirective(messages, "Dir", "system", "post_history", 0, historyFlags);
    expect(post.appliedPosition).toBe("post_history");
    expect(post.injectedIndex).toBe(5);

    // 5. Blank directive is a safe no-op
    const noop = injectSceneDirective(messages, "   ", "system", "before_post_history", 0, historyFlags);
    expect(noop.injectedIndex).toBe(-1);
    expect(noop.messages).toHaveLength(messages.length);
  });

  test("buildRewriteMessages handles lightweight & full_preset across adapt, summary, and verbatim_bridge", () => {
    const history = Array.from({ length: 5 }, (_, idx) => ({
      role: (idx % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      name: idx % 2 === 0 ? "Robin" : "Nyx",
      content: `Turn ${idx + 1} text`,
    }));

    // Lightweight + context_adapt + media slots + custom direction
    const lightweightAdapt = buildRewriteMessages({
      mode: "context_adapt",
      contextMode: "lightweight",
      delivery: "time_skip",
      targetSceneText: "[[MEDIA_1]]\n\nNyx waits by the pier.",
      hasMediaSlots: true,
      mediaSlotTokens: ["[[MEDIA_1]]"],
      transitionNote: "Three hours later at dusk.",
      customDirection: "Keep Nyx slightly injured from the fight.",
      config: { contextTurns: 2 },
      names: { charName: "Nyx", userName: "Robin" },
      character: { name: "Nyx", description: "A sharp-eyed courier.", personality: "Dry wit." },
      persona: { name: "Robin", description: "An archivist." },
      recentHistory: history,
    });

    expect(lightweightAdapt).toHaveLength(2);
    expect(lightweightAdapt[0]!.role).toBe("system");
    expect(lightweightAdapt[0]!.content).toContain("Name: Nyx");
    expect(lightweightAdapt[0]!.content).toContain("Name: Robin");
    expect(lightweightAdapt[0]!.content).toContain("Three hours later at dusk.");
    expect(lightweightAdapt[0]!.content).toContain("Keep Nyx slightly injured from the fight.");
    expect(lightweightAdapt[0]!.content).toContain("[[MEDIA_1]]");

    expect(lightweightAdapt[1]!.role).toBe("user");
    const userPrompt = String(lightweightAdapt[1]!.content);
    expect(userPrompt).not.toContain("Turn 1 text");
    expect(userPrompt).toContain("Turn 4 text");
    expect(userPrompt).toContain("Turn 5 text");
    expect(userPrompt).toContain("[[MEDIA_1]]\n\nNyx waits by the pier.");

    // Full preset + summary_rewrite preserves prefill at end & strips internal markers
    const fullPresetSummary = buildRewriteMessages({
      mode: "summary_rewrite",
      contextMode: "full_preset",
      delivery: "cut",
      targetSceneText: "The market bursts into chaos.",
      customDirection: "Lean into suspense.",
      presetMessages: [
        { role: "system", content: "Preset system", __worldInfoSource: true },
        { role: "user", content: "Prior turn", __isChatHistory: true },
        { role: "assistant", content: "Prefill:", partial: true },
      ],
    });

    expect(fullPresetSummary).toHaveLength(4);
    expect("__worldInfoSource" in fullPresetSummary[0]!).toBe(false);
    expect(fullPresetSummary[2]!.role).toBe("user");
    expect(String(fullPresetSummary[2]!.content)).toContain("Lean into suspense.");
    expect(fullPresetSummary[3]).toEqual({
      role: "assistant",
      content: "Prefill:",
      partial: true,
    });

    // Verbatim bridge strips media from target excerpt and omits media-token instructions
    const bridgeMsgs = buildRewriteMessages({
      mode: "verbatim_bridge",
      contextMode: "lightweight",
      delivery: "bridge",
      targetSceneText: "![Art](/art.png)\n\nNyx opens the door.",
      hasMediaSlots: true,
      recentHistory: history,
    });
    expect(String(bridgeMsgs[0]!.content)).not.toContain("[[MEDIA_N]]");
    expect(String(bridgeMsgs[1]!.content)).not.toContain("/art.png");
    expect(String(bridgeMsgs[1]!.content)).toContain("Nyx opens the door.");
  });

  test("combineBridgeAndVerbatimScene joins cleanly without mutating verbatim scene", () => {
    const verbatim = "![Art](/art.png)\n\nNyx opens the door.";
    expect(
      combineBridgeAndVerbatimScene("Hours pass in silence.\n\n---", verbatim, "time_skip"),
    ).toBe(`Hours pass in silence.\n\n---\n\n${verbatim}`);
    expect(combineBridgeAndVerbatimScene("They cross the hall.", verbatim, "bridge")).toBe(
      `They cross the hall.\n\n${verbatim}`,
    );
    expect(combineBridgeAndVerbatimScene("   ", verbatim, "time_skip")).toBe(verbatim);
  });

  test("regression #57/#58: self-closing & bare readiness tags never swallow prose and avoid O(N^2) backtracking", () => {
    // Self-closing tag followed by prose and a later closing tag must NOT swallow prose
    const selfClosingThenClose =
      "First sentence. <scene-ready /> Important middle prose stays intact. </scene-ready>";
    expect(hasReadinessTag(selfClosingThenClose)).toBe(true);
    const strippedSelfClosing = stripReadinessTag(selfClosingThenClose);
    expect(strippedSelfClosing).toContain("First sentence.");
    expect(strippedSelfClosing).toContain("Important middle prose stays intact.");
    expect(strippedSelfClosing).not.toContain("<scene-ready");

    // Self-closing tag followed by prose and a later paired tag strips both tags without swallowing middle prose
    const selfClosingThenPaired =
      "Intro.\n<scene-ready />\nMiddle paragraph stays.\n<scene-ready>ok</scene-ready>\nOutro.";
    expect(stripReadinessTag(selfClosingThenPaired)).toBe(
      "Intro.\nMiddle paragraph stays.\nOutro.",
    );

    // Bare unclosed <scene-ready> before a later paired <scene-ready>done</scene-ready> preserves prose between them
    const bareThenPaired =
      "Start <scene-ready> keep this prose <scene-ready>done</scene-ready> end.";
    expect(stripReadinessTag(bareThenPaired)).toBe("Start keep this prose end.");

    // Adversarial O(N^2) backtracking inputs must finish in linear time
    const startMs = performance.now();
    const unclosedSpaces = `<scene-ready${" ".repeat(60_000)}`;
    expect(hasReadinessTag(unclosedSpaces)).toBe(false);
    expect(stripReadinessTag(unclosedSpaces)).toBe(unclosedSpaces);

    const manyBare = "<scene-ready>".repeat(5_000);
    expect(hasReadinessTag(manyBare)).toBe(true);
    expect(stripReadinessTag(manyBare)).toBe("");
    expect(performance.now() - startMs).toBeLessThan(250);
  });

  test("regression #57: scene-media handles inner quoted closing tags, duplicate identical slots, and O(N) unclosed markup", () => {
    // Inner attribute containing literal `</figure>` must not prematurely close outer `<figure>`
    const trickyFigure =
      '<figure class="card"><img src="/x.png" alt="</figure>"><figcaption>Keep caption</figcaption></figure>';
    const figExtracted = extractMediaSlots(`${trickyFigure}\n\nStory continues.`);
    expect(figExtracted.slots).toHaveLength(1);
    expect(figExtracted.slots[0]!.kind).toBe("html_figure");
    expect(figExtracted.slots[0]!.original).toBe(trickyFigure);
    expect(figExtracted.text).toBe("[[MEDIA_1]]\n\nStory continues.");
    expect(restoreMediaSlots(figExtracted.text, figExtracted.slots)).toBe(
      `${trickyFigure}\n\nStory continues.`,
    );

    // Duplicate byte-identical media blocks: preserving MEDIA_1 while omitting MEDIA_2 must re-anchor MEDIA_2
    const divider = "![Divider](/div.png)";
    const dupSource = `${divider}\n\nFirst beat.\n\n${divider}\n\nSecond beat.`;
    const dupExtracted = extractMediaSlots(dupSource);
    expect(dupExtracted.slots).toHaveLength(2);

    const onlyFirstKept = restoreMediaSlotsWithReport(
      "[[MEDIA_1]]\n\nAdapted first and second beat.",
      dupExtracted.slots,
    );
    expect(onlyFirstKept.restoredTokens).toEqual(["[[MEDIA_1]]"]);
    expect(onlyFirstKept.reanchoredTokens).toEqual(["[[MEDIA_2]]"]);
    expect(onlyFirstKept.text.split(divider).length - 1).toBe(2);

    // If LLM omits both placeholders and writes one verbatim copy, exactly one remaining slot is re-anchored
    const oneVerbatim = restoreMediaSlotsWithReport(
      `${divider}\n\nAdapted text with one copy.`,
      dupExtracted.slots,
    );
    expect(oneVerbatim.restoredTokens).toEqual(["[[MEDIA_1]]"]);
    expect(oneVerbatim.reanchoredTokens).toEqual(["[[MEDIA_2]]"]);
    expect(oneVerbatim.text.split(divider).length - 1).toBe(2);

    // Valid <img> after an unclosed-quote `<img alt="unclosed >` is still extracted
    const afterBadQuote = '<img alt="unclosed > <img src="/valid.png"> prose';
    const afterBadQuoteRes = extractMediaSlots(afterBadQuote);
    expect(afterBadQuoteRes.slots).toHaveLength(1);
    expect(afterBadQuoteRes.slots[0]!.original).toBe('<img src="/valid.png">');

    // Adversarial unclosed markup must stay linear-time (no O(N^2) degradation)
    const startMs = performance.now();
    expect(extractMediaSlots("<figure>".repeat(5_000)).hasMedia).toBe(false);
    const nestedTrailing = extractMediaSlots(`${"<figure>".repeat(5_000)}</figure>`);
    expect(nestedTrailing.slots).toHaveLength(1);
    expect(nestedTrailing.slots[0]!.original).toBe("<figure></figure>");
    expect(extractMediaSlots("<img ".repeat(5_000)).hasMedia).toBe(false);
    expect(extractMediaSlots("![".repeat(5_000)).hasMedia).toBe(false);
    expect(extractMediaSlots(`${"![".repeat(5_000)}]`).hasMedia).toBe(false);
    expect(extractMediaSlots("![a](".repeat(5_000)).hasMedia).toBe(false);
    expect(performance.now() - startMs).toBeLessThan(350);
  });

  test("regression #59: scene-media ignores media inside HTML comments and handles adversarial unclosed quotes with trailing > in O(N)", () => {
    const commented = [
      '<!-- <img src="/hidden.png" alt="commented"> -->',
      '<!-- <figure><img src="/nested.png"></figure> ![md](/md.png) -->',
      'Visible prose.',
      '<img src="/visible.png" alt="real">',
    ].join("\n");
    const extracted = extractMediaSlots(commented);
    expect(extracted.slots).toHaveLength(1);
    expect(extracted.slots[0]!.original).toBe('<img src="/visible.png" alt="real">');
    expect(extracted.text).toContain('<!-- <img src="/hidden.png" alt="commented"> -->');

    const startMs = performance.now();
    expect(extractMediaSlots(`${"<img ".repeat(5_000)}a=">`).hasMedia).toBe(false);
    expect(extractMediaSlots(`${'<img a="'.repeat(5_001)}>`).slots).toHaveLength(1);
    expect(extractMediaSlots(`${"<figure ".repeat(5_000)}a=">`).hasMedia).toBe(false);
    expect(performance.now() - startMs).toBeLessThan(350);
  });

  test("regression #58: spindle.json manifest description includes Guided Scene", () => {
    expect(manifestJson.description).toContain("Guided Scene");
  });
});
