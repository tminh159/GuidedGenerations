import { describe, expect, test } from "bun:test";
import type { RegexScriptDTO, SpindleAPI } from "lumiverse-spindle-types";
import {
  applyRegexScripts,
  fetchActiveRegexScripts,
  healFormattingArtifacts,
  processResponseOutput,
} from "../src/backend/regex-processor";

function makeScript(overrides: Partial<RegexScriptDTO> = {}): RegexScriptDTO {
  return {
    id: overrides.id ?? "script-1",
    can_mutate: false,
    name: overrides.name ?? "Test Script",
    script_id: overrides.script_id ?? "test-script",
    find_regex: overrides.find_regex ?? "",
    replace_string: overrides.replace_string ?? "",
    flags: overrides.flags ?? "g",
    placement: overrides.placement ?? ["ai_output"],
    scope: overrides.scope ?? "global",
    scope_id: overrides.scope_id ?? null,
    target: overrides.target ?? "response",
    min_depth: overrides.min_depth ?? null,
    max_depth: overrides.max_depth ?? null,
    trim_strings: overrides.trim_strings ?? [],
    run_on_edit: overrides.run_on_edit ?? false,
    substitute_macros: overrides.substitute_macros ?? "none",
    disabled: overrides.disabled ?? false,
    sort_order: overrides.sort_order ?? 0,
    description: overrides.description ?? "",
    folder: overrides.folder ?? "",
    metadata: overrides.metadata ?? {},
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

describe("regex-processor", () => {
  test("fetchActiveRegexScripts respects regex_scripts permission and missing API", async () => {
    const deniedApi = {
      permissions: { has: () => false },
      regex_scripts: {
        getActive: async () => {
          throw new Error("Should not be called");
        },
      },
    } as unknown as SpindleAPI;
    expect(await fetchActiveRegexScripts(deniedApi, { target: "response" })).toEqual([]);

    const missingApi = {
      permissions: { has: () => true },
    } as unknown as SpindleAPI;
    expect(await fetchActiveRegexScripts(missingApi, { target: "prompt" })).toEqual([]);

    const calls: unknown[] = [];
    const grantedApi = {
      permissions: { has: (p: string) => p === "regex_scripts" },
      regex_scripts: {
        getActive: async (opts: unknown) => {
          calls.push(opts);
          return [makeScript({ id: "s1" })];
        },
      },
    } as unknown as SpindleAPI;

    const fetched = await fetchActiveRegexScripts(grantedApi, {
      target: "prompt",
      characterId: "char-1",
      chatId: "chat-1",
      userId: "user-1",
    });
    expect(fetched).toHaveLength(1);
    expect(calls).toEqual([
      {
        target: "prompt",
        characterId: "char-1",
        chatId: "chat-1",
        userId: "user-1",
      },
    ]);
  });

  test("applyRegexScripts filters by disabled, placement, depth bounds, and skips invalid regex", async () => {
    const scripts: RegexScriptDTO[] = [
      makeScript({ id: "disabled", disabled: true, find_regex: "foo", replace_string: "bar" }),
      makeScript({
        id: "wrong-placement",
        placement: ["user_input"],
        find_regex: "foo",
        replace_string: "bar",
      }),
      makeScript({
        id: "out-of-depth-min",
        min_depth: 2,
        find_regex: "foo",
        replace_string: "bar",
      }),
      makeScript({
        id: "out-of-depth-max",
        max_depth: 0,
        find_regex: "foo",
        replace_string: "bar",
      }),
      makeScript({
        id: "invalid-regex",
        find_regex: "[unclosed(",
        replace_string: "bar",
      }),
      makeScript({
        id: "matching",
        min_depth: 1,
        max_depth: 3,
        placement: ["ai_output"],
        find_regex: "foo",
        replace_string: "baz",
      }),
    ];

    const out = await applyRegexScripts("foo bar", scripts, "ai_output", 1);
    expect(out).toBe("baz bar");
  });

  test("applyRegexScripts supports substitute_macros modes and trim_strings", async () => {
    const resolveMacros = async (input: string) =>
      input
        .replaceAll("{{char}}", "A.B (Bot)")
        .replaceAll("{{user}}", "Hero")
        .replaceAll("{{price}}", "$1")
        .replaceAll("{{upper::hello}}", "HELLO");

    // escaped mode escapes regex metacharacters in find_regex and escapes '$' in replacement macros
    const escapedScript = makeScript({
      find_regex: "({{char}})\\s+wave\\s+(\\w+)",
      replace_string: "{{price}} {{user}} greets {{match}} ($2)",
      substitute_macros: "escaped",
      trim_strings: [" wave now"],
    });
    expect(
      await applyRegexScripts("A.B (Bot) wave now", [escapedScript], "ai_output", 0, {
        resolveMacros,
      }),
    ).toBe("$1 Hero greets A.B (Bot) (now)");

    // raw mode does not escape find_regex macro output, and expands captures before resolving replacement macros
    const rawScript = makeScript({
      find_regex: "{{char}} (hello)",
      replace_string: "TARGET {{upper::$2}}",
      substitute_macros: "raw",
    });
    expect(
      await applyRegexScripts("A.B Bot hello", [rawScript], "ai_output", 0, {
        resolveMacros,
      }),
    ).toBe("TARGET HELLO");

    // after mode resolves find_regex macros AND expands {{match}} / $1 before resolving replacement macros
    const afterScript = makeScript({
      find_regex: "{{user}} say (hello)",
      replace_string: "{{upper::$1}}",
      substitute_macros: "after",
    });
    expect(
      await applyRegexScripts("Hero say hello", [afterScript], "ai_output", 0, {
        resolveMacros,
      }),
    ).toBe("HELLO");

    // post-replacement trim_strings trims repeatedly from the replaced result string
    const postTrimScript = makeScript({
      find_regex: "hello (\\w+)",
      replace_string: "[[$1]]",
      trim_strings: ["[", "]"],
    });
    expect(await applyRegexScripts("hello world", [postTrimScript], "ai_output", 0)).toBe(
      "world",
    );

    // none mode leaves macros untouched
    const noneScript = makeScript({
      find_regex: "hi",
      replace_string: "{{user}}",
      substitute_macros: "none",
    });
    expect(
      await applyRegexScripts("hi", [noneScript], "ai_output", 0, { resolveMacros }),
    ).toBe("{{user}}");
  });

  test("applyRegexScripts supports match_actions (move_top, move_bottom, repeat_back)", async () => {
    const moveTop = makeScript({
      find_regex: "\\[TOP\\]",
      replace_string: "{{match}}",
      metadata: { match_actions: ["move_top"] },
    });
    expect(await applyRegexScripts("Start [TOP] End", [moveTop], "ai_output", 0)).toBe(
      "[TOP]\nStart  End",
    );

    const moveBottom = makeScript({
      find_regex: "\\[BOT\\]",
      replace_string: "{{match}}",
    });
    (moveBottom as unknown as { actions: string[] }).actions = ["move_bottom"];
    expect(await applyRegexScripts("[BOT] Middle End", [moveBottom], "ai_output", 0)).toBe(
      " Middle End\n[BOT]",
    );

    const repeatBack = makeScript({
      find_regex: "\\[TAG\\]",
      replace_string: "<tag/>",
      metadata: { match_actions: ["repeat_back"] },
    });
    expect(await applyRegexScripts("Hello [TAG] world", [repeatBack], "ai_output", 0)).toBe(
      "Hello <tag/> world\n<tag/>",
    );
  });

  test("healFormattingArtifacts repairs prose font/quote/emphasis artifacts and skips code/json/backticks", () => {
    const input = [
      '<font color="#ff0000>Red text',
      '"<font color="#00ff00">Green"</font>',
      '<font color="#0000ff">"Blue</font>"',
      '* whispered softly * and ** bold move ** and " spaced quote " and “ curly ”',
      '"Hello," she said, "goodbye."',
      "* bullet item with *emphasis* stays intact",
      "2 * 3 * 4 stays math",
      "snake_case_name stays intact",
      "`* inline code * <font color=\"#fff>`",
      "```ts\nconst x = '<font color=\"#fff>* keep *';\n```",
      '<json>{"text": "<font color=\\"#fff> * keep * "}</json>',
    ].join("\n");

    const healed = healFormattingArtifacts(input);
    const lines = healed.split("\n");

    expect(lines[0]).toBe('<font color="#ff0000">Red text</font>');
    expect(lines[1]).toBe('"<font color="#00ff00">Green</font>"');
    expect(lines[2]).toBe('<font color="#0000ff">"Blue"</font>');
    expect(lines[3]).toBe('*whispered softly* and **bold move** and "spaced quote" and “curly”');
    expect(lines[4]).toBe('"Hello," she said, "goodbye."');
    expect(lines[5]).toBe("* bullet item with *emphasis* stays intact");
    expect(lines[6]).toBe("2 * 3 * 4 stays math");
    expect(lines[7]).toBe("snake_case_name stays intact");
    expect(lines[8]).toBe('`* inline code * <font color="#fff>`');
    expect(lines[9]).toBe("```ts");
    expect(lines[10]).toBe("const x = '<font color=\"#fff>* keep *';");
    expect(lines[11]).toBe("```");
    expect(lines[12]).toBe('<json>{"text": "<font color=\\"#fff> * keep * "}</json>');
  });

  test("processResponseOutput applies ai_output, non-empty reasoning, and healFormattingArtifacts", async () => {
    const scripts: RegexScriptDTO[] = [
      makeScript({
        id: "r1",
        placement: ["ai_output"],
        find_regex: "badword",
        replace_string: "* goodword *",
      }),
      makeScript({
        id: "r2",
        placement: ["reasoning"],
        find_regex: "secret",
        replace_string: "redacted",
      }),
    ];

    const res = await processResponseOutput({
      content: '<font color="#abc>Saying badword',
      reasoning: "Thinking about secret",
      scripts,
    });
    expect(res.content).toBe('<font color="#abc">Saying *goodword*</font>');
    expect(res.reasoning).toBe("Thinking about redacted");

    const noReasoning = await processResponseOutput({
      content: "badword",
      reasoning: "",
      scripts,
    });
    expect(noReasoning.content).toBe("*goodword*");
    expect(noReasoning.reasoning).toBe("");
  });

  test("applyRegexScripts supports balanced nested macro tokenization in escaped find/replace templates", async () => {
    const seenTokens: string[] = [];
    const resolveMacros = async (input: string) => {
      seenTokens.push(input);
      if (input === "{{upper::{{char}}}}") return "A.B (BOT)*";
      if (input === "{{lower::{{user}}}}") return "$1 hero";
      return input;
    };

    const nestedScript = makeScript({
      find_regex: "({{upper::{{char}}}})\\s+(\\w+)",
      replace_string: "{{lower::{{user}}}} -> {{match}} ($2)",
      substitute_macros: "escaped",
    });

    const out = await applyRegexScripts(
      "A.B (BOT)* waves",
      [nestedScript],
      "ai_output",
      0,
      { resolveMacros },
    );

    expect(seenTokens).toEqual(["{{upper::{{char}}}}", "{{lower::{{user}}}}"]);
    expect(out).toBe("$1 hero -> A.B (BOT)* waves (waves)");

    // Unbalanced braces do not crash or hang tokenization
    const unbalancedScript = makeScript({
      find_regex: "{{unclosed",
      replace_string: "safe",
      substitute_macros: "escaped",
    });
    expect(
      await applyRegexScripts("{{unclosed text", [unbalancedScript], "ai_output", 0, {
        resolveMacros,
      }),
    ).toBe("safe text");
  });

  test("applyRegexScripts terminates zero-length matches, preserves astral surrogate pairs, and handles non-global/sticky flags", async () => {
    // Global zero-length match advances across astral code points (U+1D11E) by 2 UTF-16 code units
    const astralZeroLen = makeScript({
      find_regex: "(?:)",
      flags: "g",
      replace_string: "|",
    });
    expect(await applyRegexScripts("a𝄞b", [astralZeroLen], "ai_output", 0)).toBe("|a|𝄞|b|");

    // Zero-length match on empty input terminates cleanly
    const emptyAnchor = makeScript({
      find_regex: "^",
      flags: "g",
      replace_string: "X",
    });
    expect(await applyRegexScripts("", [emptyAnchor], "ai_output", 0)).toBe("X");

    // Non-global regex stops after a single match (even for zero-length or repeated tokens)
    const nonGlobalZeroLen = makeScript({
      find_regex: "(?:)",
      flags: "",
      replace_string: "|",
    });
    expect(await applyRegexScripts("ab", [nonGlobalZeroLen], "ai_output", 0)).toBe("|ab");

    const nonGlobalChar = makeScript({
      find_regex: "a",
      flags: "",
      replace_string: "b",
    });
    expect(await applyRegexScripts("aaa", [nonGlobalChar], "ai_output", 0)).toBe("baa");

    // Sticky regex matches only contiguous runs from index 0 and handles zero-length astral progression
    const stickyChar = makeScript({
      find_regex: "a",
      flags: "y",
      replace_string: "x",
    });
    expect(await applyRegexScripts("aaaba", [stickyChar], "ai_output", 0)).toBe("xxxba");

    const stickyZeroLen = makeScript({
      find_regex: "(?:)",
      flags: "y",
      replace_string: "|",
    });
    expect(await applyRegexScripts("a𝄞", [stickyZeroLen], "ai_output", 0)).toBe("|a|𝄞|");
  });
});
