import type {
  RegexPlacementDTO,
  RegexScriptDTO,
  RegexTargetDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";

export interface FetchRegexScriptsOptions {
  target: RegexTargetDTO;
  characterId?: string;
  chatId?: string;
  userId?: string;
}

export interface ApplyRegexOptions {
  resolveMacros?: (input: string) => Promise<string>;
}

export interface ProcessResponseOutputOptions {
  content: string;
  reasoning?: string;
  scripts: readonly RegexScriptDTO[];
  resolveMacros?: (input: string) => Promise<string>;
}

export interface ProcessResponseOutputResult {
  content: string;
  reasoning?: string;
}

type MatchActionType = "move_top" | "move_bottom" | "repeat_back";

const MAX_REGEX_MATCHES = 5_000;

interface MacroTokenSpan {
  start: number;
  end: number;
  value: string;
}

function findTopLevelMacroTokens(input: string): MacroTokenSpan[] {
  const tokens: MacroTokenSpan[] = [];
  let depth = 0;
  let tokenStart = -1;

  for (let i = 0; i < input.length; ) {
    if (input[i] === "{" && input[i + 1] === "{") {
      if (depth === 0) {
        tokenStart = i;
      }
      depth += 1;
      i += 2;
      continue;
    }
    if (input[i] === "}" && input[i + 1] === "}" && depth > 0) {
      depth -= 1;
      i += 2;
      if (depth === 0 && tokenStart >= 0) {
        tokens.push({
          start: tokenStart,
          end: i,
          value: input.slice(tokenStart, i),
        });
        tokenStart = -1;
      }
      continue;
    }
    i += 1;
  }

  return tokens;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinSections(first: string, second: string): string {
  if (!first) return second;
  if (!second) return first;
  if (first.endsWith("\n") || second.startsWith("\n")) {
    return first + second;
  }
  return `${first}\n${second}`;
}

function extractMatchActions(script: RegexScriptDTO): Set<MatchActionType> {
  const actions = new Set<MatchActionType>();
  const raw =
    script.metadata?.match_actions ??
    (script as unknown as { actions?: unknown }).actions;

  const addIfValid = (item: unknown) => {
    if (item === "move_top" || item === "move_bottom" || item === "repeat_back") {
      actions.add(item);
    }
  };

  if (typeof raw === "string") {
    addIfValid(raw);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        addIfValid(item);
      } else if (item && typeof item === "object") {
        const typeVal = (item as { type?: unknown }).type ?? (item as { action?: unknown }).action;
        addIfValid(typeVal);
      }
    }
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.move_top === true) actions.add("move_top");
    if (obj.move_bottom === true) actions.add("move_bottom");
    if (obj.repeat_back === true) actions.add("repeat_back");
  }

  return actions;
}

async function resolveFindRegex(
  findRegex: string,
  mode: RegexScriptDTO["substitute_macros"],
  resolveMacros?: (input: string) => Promise<string>,
): Promise<string> {
  if (!resolveMacros || mode === "none") {
    return findRegex;
  }

  if (mode === "escaped") {
    const tokens = findTopLevelMacroTokens(findRegex);
    if (tokens.length === 0) {
      return findRegex;
    }
    let lastIndex = 0;
    let out = "";
    for (const token of tokens) {
      out += findRegex.slice(lastIndex, token.start);
      const resolved = await resolveMacros(token.value);
      out += escapeRegExp(resolved);
      lastIndex = token.end;
    }
    out += findRegex.slice(lastIndex);
    return out;
  }

  // "raw", "find", or "after"
  return resolveMacros(findRegex);
}

async function resolveEscapedReplaceTemplate(
  replaceString: string,
  resolveMacros?: (input: string) => Promise<string>,
): Promise<string> {
  if (!resolveMacros || !replaceString.includes("{{")) {
    return replaceString;
  }

  const tokens = findTopLevelMacroTokens(replaceString);
  if (tokens.length === 0) {
    return replaceString;
  }
  let lastIndex = 0;
  let out = "";
  for (const token of tokens) {
    out += replaceString.slice(lastIndex, token.start);
    if (token.value === "{{match}}") {
      out += "{{match}}";
    } else {
      const resolved = await resolveMacros(token.value);
      // Escape '$' -> '$$' so macro values are not parsed as capture back-references.
      out += resolved.replace(/\$/g, "$$$$");
    }
    lastIndex = token.end;
  }
  out += replaceString.slice(lastIndex);
  return out;
}

function expandReplacementTemplate(
  template: string,
  match: RegExpExecArray,
  trimmedMatch: string,
  fullText: string,
): string {
  const withMatch = template.includes("{{match}}")
    ? template.replaceAll("{{match}}", () => trimmedMatch)
    : template;

  return withMatch.replace(
    /\$(?:\$|&|`|'|<([^>]+)>|(\d{1,2}))/g,
    (token, groupName: string | undefined, groupNum: string | undefined) => {
      if (token === "$$") return "$";
      if (token === "$&") return match[0];
      if (token === "$`") return fullText.slice(0, match.index);
      if (token === "$'") return fullText.slice(match.index + match[0].length);
      if (groupName !== undefined) {
        return match.groups?.[groupName] ?? "";
      }
      if (groupNum !== undefined) {
        const idx = Number.parseInt(groupNum, 10);
        if (idx >= 1 && idx < match.length) {
          return match[idx] ?? "";
        }
        return token;
      }
      return token;
    },
  );
}

/**
 * Fetches active Lumiverse regex scripts for the given target & chat context,
 * safely returning [] if the `regex_scripts` permission is ungranted or unavailable.
 */
export async function fetchActiveRegexScripts(
  spindle: SpindleAPI,
  options: FetchRegexScriptsOptions,
): Promise<RegexScriptDTO[]> {
  if (!spindle.permissions?.has?.("regex_scripts")) {
    return [];
  }

  const regexApi = (spindle as { regex_scripts?: SpindleAPI["regex_scripts"] }).regex_scripts;
  if (!regexApi || typeof regexApi.getActive !== "function") {
    return [];
  }

  try {
    const scripts = await regexApi.getActive({
      target: options.target,
      ...(options.characterId ? { characterId: options.characterId } : {}),
      ...(options.chatId ? { chatId: options.chatId } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
    });
    return Array.isArray(scripts) ? scripts : [];
  } catch (error) {
    spindle.log?.warn?.(
      `[GuidedGenerations] Failed fetching active regex scripts (${options.target}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

/**
 * Applies matching Lumiverse regex scripts sequentially to `text`.
 */
export async function applyRegexScripts(
  text: string,
  scripts: readonly RegexScriptDTO[],
  placement: RegexPlacementDTO,
  depth: number,
  options: ApplyRegexOptions = {},
): Promise<string> {
  if (!scripts || scripts.length === 0) {
    return text;
  }

  let current = text;

  for (const script of scripts) {
    if (!script || script.disabled) continue;
    if (!Array.isArray(script.placement) || !script.placement.includes(placement)) {
      continue;
    }
    if (
      typeof script.min_depth === "number" &&
      Number.isFinite(script.min_depth) &&
      depth < script.min_depth
    ) {
      continue;
    }
    if (
      typeof script.max_depth === "number" &&
      Number.isFinite(script.max_depth) &&
      depth > script.max_depth
    ) {
      continue;
    }
    if (!script.find_regex) {
      continue;
    }

    const resolvedFindRegex = await resolveFindRegex(
      script.find_regex,
      script.substitute_macros,
      options.resolveMacros,
    );

    let regex: RegExp;
    try {
      regex = new RegExp(resolvedFindRegex, script.flags ?? "");
    } catch {
      continue;
    }

    const baseReplaceTemplate =
      script.substitute_macros === "escaped"
        ? await resolveEscapedReplaceTemplate(
            script.replace_string ?? "",
            options.resolveMacros,
          )
        : (script.replace_string ?? "");

    const actions = extractMatchActions(script);
    const moveTop = actions.has("move_top");
    const moveBottom = actions.has("move_bottom");
    const repeatBack = actions.has("repeat_back");
    const trimStrings = Array.isArray(script.trim_strings) ? script.trim_strings : [];

    const matches: Array<{
      index: number;
      length: number;
      replacement: string;
      movedValue: string;
    }> = [];

    let execResult: RegExpExecArray | null;
    while ((execResult = regex.exec(current)) !== null) {
      let trimmedMatch = execResult[0];
      for (const trim of trimStrings) {
        if (typeof trim === "string" && trim.length > 0) {
          trimmedMatch = trimmedMatch.split(trim).join("");
        }
      }

      let replacement = expandReplacementTemplate(
        baseReplaceTemplate,
        execResult,
        trimmedMatch,
        current,
      );

      if (
        (script.substitute_macros === "raw" || script.substitute_macros === "after") &&
        options.resolveMacros
      ) {
        replacement = await options.resolveMacros(replacement);
      }

      const movedValue = replacement.length > 0 ? replacement : trimmedMatch;
      matches.push({
        index: execResult.index,
        length: execResult[0].length,
        replacement,
        movedValue,
      });

      if (matches.length >= MAX_REGEX_MATCHES) {
        break;
      }
      if (!regex.global && !regex.sticky) {
        break;
      }
      if (execResult[0].length === 0) {
        if (regex.lastIndex >= current.length) {
          break;
        }
        const cp = current.codePointAt(regex.lastIndex);
        regex.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1;
      }
    }

    if (matches.length === 0) {
      continue;
    }

    let rebuilt = "";
    let cursor = 0;
    const movedChunks: string[] = [];

    for (const m of matches) {
      rebuilt += current.slice(cursor, m.index);
      if (moveTop || moveBottom) {
        if (repeatBack) {
          rebuilt += m.replacement;
        }
        if (m.movedValue) {
          movedChunks.push(m.movedValue);
        }
      } else {
        rebuilt += m.replacement;
        if (repeatBack && m.movedValue) {
          movedChunks.push(m.movedValue);
        }
      }
      cursor = m.index + m.length;
    }
    rebuilt += current.slice(cursor);

    if (moveTop && movedChunks.length > 0) {
      rebuilt = joinSections(movedChunks.join("\n"), rebuilt);
    }
    if ((moveBottom || repeatBack) && movedChunks.length > 0) {
      rebuilt = joinSections(rebuilt, movedChunks.join("\n"));
    }

    for (const trim of trimStrings) {
      if (typeof trim === "string" && trim.length > 0) {
        while (rebuilt.includes(trim)) {
          rebuilt = rebuilt.replaceAll(trim, "");
        }
      }
    }

    current = rebuilt;
  }

  return current;
}

function healFontTagsAndAttributes(prose: string): string {
  // 1. Repair unterminated <font ... color="..."> quotes before '>' or next attribute.
  let out = prose.replace(/<font\b([^>]*)>/gi, (_full, attrs: string) => {
    let fixed = attrs.replace(
      /(\bcolor\s*=\s*)(["'])([^"'\s>]+)(?=\s+[a-zA-Z_-]+\s*=|\s*$)/gi,
      "$1$2$3$2",
    );
    fixed = fixed.replace(/(\bcolor\s*=\s*)(["'])([^"'=>]+)$/i, "$1$2$3$2");
    return `<font${fixed}>`;
  });

  // 2. Repair quoted color tag boundaries (crossed quotes & <font>...</font>).
  // Crossed: "<font ...>text"</font> -> "<font ...>text</font>"
  out = out.replace(
    /(["“])(<font\b[^>]*>)([^<\n]*?)(["”])(<\/font>)/gi,
    (_m, openQ: string, openTag: string, inner: string, closeQ: string, closeTag: string) => {
      const pairs =
        (openQ === '"' && closeQ === '"') || (openQ === "“" && (closeQ === "”" || closeQ === '"'));
      return pairs ? `${openQ}${openTag}${inner}${closeTag}${closeQ}` : _m;
    },
  );
  // Crossed: <font ...>"text</font>" -> <font ...>"text"</font>
  out = out.replace(
    /(<font\b[^>]*>)(["“])([^<\n]*?)(<\/font>)(["”])/gi,
    (_m, openTag: string, openQ: string, inner: string, closeTag: string, closeQ: string) => {
      const pairs =
        (openQ === '"' && closeQ === '"') || (openQ === "“" && (closeQ === "”" || closeQ === '"'));
      return pairs ? `${openTag}${openQ}${inner}${closeQ}${closeTag}` : _m;
    },
  );
  // Whitespace directly inside <font ...> "text" </font>
  out = out.replace(
    /(<font\b[^>]*>)[ \t]*((?:["“])[^<\n]*?(?:["”]))[ \t]*(<\/font>)/gi,
    "$1$2$3",
  );

  // 3. Close any unclosed <font> tags (before another <font> on a new line, paragraph break, or end of prose).
  const fontTokenRe = /(<\/?font\b[^>]*>|\n\n)/gi;
  const closeInsertOffsets: number[] = [];
  let openStack: Array<{ endOffset: number; lineEndOffset: number }> = [];
  let tokenMatch: RegExpExecArray | null;

  const findLineEnd = (fromIndex: number): number => {
    const nl = out.indexOf("\n", fromIndex);
    return nl === -1 ? out.length : nl;
  };

  while ((tokenMatch = fontTokenRe.exec(out)) !== null) {
    const token = tokenMatch[0];
    if (token === "\n\n") {
      while (openStack.length > 0) {
        const entry = openStack.pop()!;
        closeInsertOffsets.push(Math.min(entry.lineEndOffset, tokenMatch.index));
      }
      continue;
    }
    if (/^<\/font/i.test(token)) {
      if (openStack.length > 0) {
        openStack.pop();
      }
    } else if (!/\/>$/.test(token)) {
      // If a previous <font> opened on an earlier line wasn't closed before a new <font> opens on a later line, close it at its line end.
      while (
        openStack.length > 0 &&
        openStack[openStack.length - 1]!.lineEndOffset < tokenMatch.index
      ) {
        const prev = openStack.pop()!;
        closeInsertOffsets.push(prev.lineEndOffset);
      }
      openStack.push({
        endOffset: tokenMatch.index + token.length,
        lineEndOffset: findLineEnd(tokenMatch.index + token.length),
      });
    }
  }

  while (openStack.length > 0) {
    openStack.pop();
    closeInsertOffsets.push(out.length);
  }

  if (closeInsertOffsets.length > 0) {
    closeInsertOffsets.sort((a, b) => a - b);
    let rebuilt = "";
    let cursor = 0;
    for (const offset of closeInsertOffsets) {
      rebuilt += out.slice(cursor, offset) + "</font>";
      cursor = offset;
    }
    rebuilt += out.slice(cursor);
    out = rebuilt;
  }

  return out;
}

function trimInnerWhitespaceInPairs(line: string, openChar: string, closeChar: string): string {
  const positions: number[] = [];
  let inTag = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">" && inTag) {
      inTag = false;
      continue;
    }
    if (!inTag && ch === openChar && (i === 0 || line[i - 1] !== "\\")) {
      positions.push(i);
    }
  }
  if (openChar === closeChar) {
    if (positions.length < 2 || positions.length % 2 !== 0) {
      return line;
    }
    let out = "";
    let cursor = 0;
    for (let i = 0; i < positions.length; i += 2) {
      const start = positions[i]!;
      const end = positions[i + 1]!;
      const inner = line.slice(start + 1, end);
      const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
      out += line.slice(cursor, start + 1);
      out += trimmed.length > 0 ? trimmed : inner;
      out += closeChar;
      cursor = end + 1;
    }
    out += line.slice(cursor);
    return out;
  }
  return line;
}

function trimEmphasisOnLine(line: string): string {
  let out = line;

  // Triple & double asterisks: *** text *** and ** text **
  out = out.replace(
    /(^|[^\S\r\n]|[\(\["'“‘>])(\*{2,3})[ \t]+([^\n]*?\S)[ \t]*\2(?=$|[\s.,!?;:'"”’\)\]<])/g,
    (full, prefix: string, marker: string, inner: string) =>
      inner.includes(marker) ? full : `${prefix}${marker}${inner}${marker}`,
  );
  out = out.replace(
    /(^|[^\S\r\n]|[\(\["'“‘>])(\*{2,3})(\S[^\n]*?)[ \t]+\2(?=$|[\s.,!?;:'"”’\)\]<])/g,
    (full, prefix: string, marker: string, inner: string) =>
      inner.includes(marker) ? full : `${prefix}${marker}${inner}${marker}`,
  );

  // Double underscore: __ text __
  out = out.replace(
    /(^|[^\w_\\])__[ \t]+([^_\n]*?\S)[ \t]*__(?!\w|_)/g,
    "$1__$2__",
  );
  out = out.replace(
    /(^|[^\w_\\])__(\S[^_\n]*?)[ \t]+__(?!\w|_)/g,
    "$1__$2__",
  );

  // Single asterisk: skip lines that appear to be markdown bullet lists with odd '*' counts
  // or arithmetic like `2 * 3 * 4`.
  const singleStarIndices: number[] = [];
  for (let i = 0; i < out.length; i += 1) {
    if (
      out[i] === "*" &&
      out[i - 1] !== "*" &&
      out[i + 1] !== "*" &&
      out[i - 1] !== "\\"
    ) {
      singleStarIndices.push(i);
    }
  }
  const isBulletWithOddStars = /^[ \t]*\*[ \t]+/.test(out) && singleStarIndices.length % 2 === 1;
  if (!isBulletWithOddStars && singleStarIndices.length >= 2) {
    out = out.replace(
      /(^|[^\w*\\])\*[ \t]+([^*\n]*?\S)[ \t]*\*(?!\*)/g,
      (full, prefix: string, inner: string, offset: number) => {
        const before = out.slice(0, offset + prefix.length);
        const afterStart = offset + full.length;
        const after = out.slice(afterStart);
        // Guard math like `2 * 3 * 4`
        if (/\d\s+$/.test(before) && /^\s+\d/.test(after) && /^\d+$/.test(inner.trim())) {
          return full;
        }
        return `${prefix}*${inner}*`;
      },
    );
    out = out.replace(
      /(^|[^\w*\\])\*([^\s*\n][^*\n]*?)[ \t]+\*(?!\*)/g,
      "$1*$2*",
    );
  }

  // Single underscore: _ text _ (never inside words)
  out = out.replace(
    /(^|[^\w_\\])_[ \t]+([^_\n]*?\S)[ \t]*_(?!\w|_)/g,
    "$1_$2_",
  );
  out = out.replace(
    /(^|[^\w_\\])_([^\s_\n][^_\n]*?)[ \t]+_(?!\w|_)/g,
    "$1_$2_",
  );

  return out;
}

function healProseSegment(prose: string): string {
  let out = healFontTagsAndAttributes(prose);

  // Curly quotes (directional, unambiguous)
  out = out.replace(/“[ \t]*([^”\n]*?\S)[ \t]*”/g, "“$1”");
  out = out.replace(/‘[ \t]*([^’\n]*?\S)[ \t]*’/g, "‘$1’");

  // Straight double quotes & emphasis per line
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]!;
    line = trimInnerWhitespaceInPairs(line, '"', '"');
    line = trimEmphasisOnLine(line);
    lines[i] = line;
  }

  return lines.join("\n");
}

/**
 * Mirrors Lumiverse's prose-only formatting healer while skipping fenced code blocks,
 * `<json>...</json>` blocks, and inline backtick spans.
 */
export function healFormattingArtifacts(text: string): string {
  if (!text || typeof text !== "string") {
    return text;
  }

  const protectedRe =
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|<json\b[^>]*>[\s\S]*?<\/json>|(`+)[^\n]*?\2)/gi;

  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = protectedRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result += healProseSegment(text.slice(lastIndex, match.index));
    }
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result += healProseSegment(text.slice(lastIndex));
  }

  return result;
}

/**
 * Applies `"ai_output"` and optional `"reasoning"` response regex scripts at depth 0,
 * followed by `healFormattingArtifacts`.
 */
export async function processResponseOutput(
  options: ProcessResponseOutputOptions,
): Promise<ProcessResponseOutputResult> {
  const processedContent = healFormattingArtifacts(
    await applyRegexScripts(options.content, options.scripts, "ai_output", 0, {
      resolveMacros: options.resolveMacros,
    }),
  );

  let processedReasoning = options.reasoning;
  if (typeof options.reasoning === "string" && options.reasoning.length > 0) {
    processedReasoning = healFormattingArtifacts(
      await applyRegexScripts(options.reasoning, options.scripts, "reasoning", 0, {
        resolveMacros: options.resolveMacros,
      }),
    );
  }

  return {
    content: processedContent,
    ...(processedReasoning !== undefined ? { reasoning: processedReasoning } : {}),
  };
}
