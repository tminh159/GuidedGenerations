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

  test("healFormattingArtifacts preserves dimension quotes, HTML attrs, even-star math bullets, exponentiation, boundary underscores, 4-backtick fences, multiline backticks, and nested </json> strings", async () => {
    const input = [
      'Board dimensions: 2" x 4" and 6" x 8" are standard.',
      '<div data-expr="1>0" title=" * keep * "> " spaced prose " </div>',
      "* Multiply 2 * 3",
      "Math: 2 * (3 + 4) * 5 and 2 ** 3 ** 4",
      "Boundary underscores: foo(1)_ and bar(2)_ stay intact",
      "`* multiline\ninline code *`",
      '````md\n```ts\nconst s = "* keep *";\n```\n````',
      '<json>{"html":"</json> * keep *"}</json>',
    ].join("\n");

    const healed = healFormattingArtifacts(input);
    const expected = [
      'Board dimensions: 2" x 4" and 6" x 8" are standard.',
      '<div data-expr="1>0" title=" * keep * "> "spaced prose" </div>',
      "* Multiply 2 * 3",
      "Math: 2 * (3 + 4) * 5 and 2 ** 3 ** 4",
      "Boundary underscores: foo(1)_ and bar(2)_ stay intact",
      "`* multiline\ninline code *`",
      '````md\n```ts\nconst s = "* keep *";\n```\n````',
      '<json>{"html":"</json> * keep *"}</json>',
    ].join("\n");
    expect(healed).toBe(expected);

    // processResponseOutput runs healFormattingArtifacts on content ONLY, not reasoning
    const out = await processResponseOutput({
      content: '" spaced content "',
      reasoning: '" spaced reasoning " and 2 * 3',
      scripts: [],
    });
    expect(out.content).toBe('"spaced content"');
    expect(out.reasoning).toBe('" spaced reasoning " and 2 * 3');
  });

  test("applyRegexScripts preserves $1/$& inside {{match}} and tokenizes block macros as single top-level tokens", async () => {
    const matchWithDollars = makeScript({
      find_regex: "(Price:\\s*\\S+)",
      replace_string: "[{{match}} | $1]",
    });
    expect(
      await applyRegexScripts("Price: $1/$&", [matchWithDollars], "ai_output", 0),
    ).toBe("[Price: $1/$& | Price: $1/$&]");

    const resolvedTokens: string[] = [];
    const blockMacroScript = makeScript({
      find_regex: "{{#if flag}}yes*{{/if}} (\\w+)",
      replace_string: "MATCH:$1",
      substitute_macros: "escaped",
    });
    const blockOut = await applyRegexScripts(
      "yes* world",
      [blockMacroScript],
      "ai_output",
      0,
      {
        resolveMacros: async (token) => {
          resolvedTokens.push(token);
          if (token === "{{#if flag}}yes*{{/if}}") return "yes*";
          return token;
        },
      },
    );
    expect(resolvedTokens).toEqual(["{{#if flag}}yes*{{/if}}"]);
    expect(blockOut).toBe("MATCH:world");
  });

  test("applyRegexScripts runs substitute_macros 'after' on 0 matches and healFormattingArtifacts closes unclosed <font> at CRLF paragraph breaks", async () => {
    const afterZeroMatches = makeScript({
      find_regex: "NEVER_MATCHES_XYZ",
      replace_string: "unused",
      substitute_macros: "after",
    });
    const resolved = await applyRegexScripts(
      "Hello {{char}} and {{user}}.",
      [afterZeroMatches],
      "ai_output",
      0,
      {
        resolveMacros: async (text) =>
          text.replace(/\{\{char\}\}/g, "Aria").replace(/\{\{user\}\}/g, "Kai"),
      },
    );
    expect(resolved).toBe("Hello Aria and Kai.");

    const crlfUnclosedFont = '<font color="#ff0000">First paragraph\r\n\r\nSecond paragraph';
    expect(healFormattingArtifacts(crlfUnclosedFont)).toBe(
      '<font color="#ff0000">First paragraph</font>\r\n\r\nSecond paragraph',
    );
  });

  test("applyRegexScripts blocks adjacent wildcard-class ReDoS patterns while allowing safe wildcards and disjoint alternations", async () => {
    const catastrophicWildClass = makeScript({
      id: "redos-wild-class",
      find_regex: "[\\s\\S]+[\\s\\S]+!",
      replace_string: "REPLACED",
    });
    const catastrophicMixedWild = makeScript({
      id: "redos-mixed-wild",
      find_regex: "[\\d\\D]*[\\w\\W]+!",
      replace_string: "REPLACED",
    });
    const catastrophicOverlapAlt = makeScript({
      id: "redos-overlap-alt",
      find_regex: "(foo|foobar)+!",
      replace_string: "REPLACED",
    });

    const input = "a".repeat(50);
    expect(
      await applyRegexScripts(
        input,
        [catastrophicWildClass, catastrophicMixedWild, catastrophicOverlapAlt],
        "ai_output",
        0,
      ),
    ).toBe(input);

    // Non-adjacent wildcards separated by a literal or non-wildcard char class still execute
    const safeWild = makeScript({
      id: "safe-wild",
      find_regex: "[\\s\\S]+:[\\s\\S]+",
      replace_string: "OK",
      flags: "",
    });
    expect(await applyRegexScripts("left:right", [safeWild], "ai_output", 0)).toBe("OK");

    const safeNonWildSep = makeScript({
      id: "safe-non-wild-sep",
      find_regex: "[\\s\\S]+[^a-z][\\s\\S]+",
      replace_string: "OK",
      flags: "",
    });
    expect(await applyRegexScripts("abc1def", [safeNonWildSep], "ai_output", 0)).toBe("OK");

    // Disjoint alternation branches inside a repeated group are allowed
    const safeDisjointAlt = makeScript({
      id: "safe-disjoint-alt",
      find_regex: "(cat|dog|bird)+",
      replace_string: "PETS",
      flags: "g",
    });
    expect(await applyRegexScripts("catdog and bird", [safeDisjointAlt], "ai_output", 0)).toBe(
      "PETS and PETS",
    );
  });

  test("applyRegexScripts cached regexes safely reset lastIndex across repeated, concurrent async, and repeat_back calls", async () => {
    const globalScript = makeScript({
      id: "cached-g",
      find_regex: "foo(\\d+)",
      replace_string: "bar$1",
      flags: "g",
    });

    // Repeated calls reuse cached RegExp without stale lastIndex
    expect(await applyRegexScripts("foo1 foo2", [globalScript], "ai_output", 0)).toBe("bar1 bar2");
    expect(await applyRegexScripts("foo3", [globalScript], "ai_output", 0)).toBe("bar3");
    expect(await applyRegexScripts("foo4 foo5 foo6", [globalScript], "ai_output", 0)).toBe(
      "bar4 bar5 bar6",
    );

    // Case-insensitive terminal-literal guard cached RegExp resets lastIndex properly
    const ciTerminalScript = makeScript({
      id: "cached-gi-terminal",
      find_regex: "\\w+_MARKER",
      replace_string: "HIT",
      flags: "gi",
    });
    expect(
      await applyRegexScripts("a_marker b_MARKER tail", [ciTerminalScript], "ai_output", 0),
    ).toBe("HIT HIT tail");
    expect(await applyRegexScripts("c_marker", [ciTerminalScript], "ai_output", 0)).toBe("HIT");

    // Concurrent async calls sharing the same cached 'g' regex with async raw macro resolution
    const rawAsyncScript = makeScript({
      id: "cached-async-raw",
      find_regex: "item(\\d+)",
      replace_string: "{{wrap::$1}}",
      flags: "g",
      substitute_macros: "raw",
    });
    const asyncResolver = async (s: string) => {
      await new Promise((r) => setTimeout(r, 1));
      return s.replace(/\{\{wrap::(\d+)\}\}/g, "[$1]");
    };
    const [r1, r2] = await Promise.all([
      applyRegexScripts("item1 item2 item3", [rawAsyncScript], "ai_output", 0, {
        resolveMacros: asyncResolver,
      }),
      applyRegexScripts("item4 item5", [rawAsyncScript], "ai_output", 0, {
        resolveMacros: asyncResolver,
      }),
    ]);
    expect(r1).toBe("[1] [2] [3]");
    expect(r2).toBe("[4] [5]");

    // repeat_back with previousContent reuses cached regex cleanly across calls
    const repeatBackScript = makeScript({
      id: "cached-repeat-back",
      find_regex: "\\[STATUS:[^\\]]+\\]",
      replace_string: "{{match}}",
      flags: "g",
      metadata: { match_actions: ["repeat_back"], repeat_position: "end_nl" },
    });
    expect(
      await applyRegexScripts("Current turn", [repeatBackScript], "ai_output", 0, {
        previousContent: "Prev [STATUS:OK]",
      }),
    ).toBe("Current turn\n[STATUS:OK]");
    expect(
      await applyRegexScripts("Next turn", [repeatBackScript], "ai_output", 0, {
        previousContent: "Prev [STATUS:READY]",
      }),
    ).toBe("Next turn\n[STATUS:READY]");
  });

  test("healFormattingArtifacts handles plain prose fast paths, many unclosed '<' tags in linear time, and mixed HTML/emphasis/math lines", () => {
    // Plain prose with no special delimiters returns unchanged
    const plain = "Just a normal paragraph with no formatting artifacts at all.\nSecond line.";
    expect(healFormattingArtifacts(plain)).toBe(plain);

    // Many unclosed '<' tokens with and without a quoted '>' at the end stay fast and accurate
    const manyUnclosed = `${"<a ".repeat(2000)}* spaced *`;
    expect(healFormattingArtifacts(manyUnclosed)).toBe(`${"<a ".repeat(2000)}*spaced*`);

    const manyUnclosedWithQuotedGt = `${"<a ".repeat(2000)}" > * spaced *`;
    expect(healFormattingArtifacts(manyUnclosedWithQuotedGt)).toBe(
      `${"<a ".repeat(2000)}" > *spaced*`,
    );

    // Valid tag after an unclosed quote is still recognized as an HTML tag span
    const tagAfterUnclosedQuote = '<a " <span title=" * keep * "> * heal * </span>';
    expect(healFormattingArtifacts(tagAfterUnclosedQuote)).toBe(
      '<a " <span title=" * keep * "> *heal* </span>',
    );

    // Mixed math runs, emphasis, and quotes on the same line
    const mixedLine =
      'Compute 2 * 3 * 4 then * whisper * and ** bold ** with " spaced " and <em data-x=" * keep * "> _ under _ </em>';
    expect(healFormattingArtifacts(mixedLine)).toBe(
      'Compute 2 * 3 * 4 then *whisper* and **bold** with "spaced" and <em data-x=" * keep * "> _under_ </em>',
    );
  });
});
