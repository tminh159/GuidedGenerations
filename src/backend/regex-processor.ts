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
  previousContent?: string;
}

export interface ProcessResponseOutputOptions {
  content: string;
  reasoning?: string;
  scripts: readonly RegexScriptDTO[];
  resolveMacros?: (input: string) => Promise<string>;
  previousContent?: string;
}

export interface ProcessResponseOutputResult {
  content: string;
  reasoning?: string;
}

type MatchActionType = "move_top" | "move_bottom" | "repeat_back";

const MAX_REGEX_MATCHES = 5_000;
const MAX_REGEX_PATTERN_LENGTH = 50_000;
const REGEX_SCRIPT_TIME_BUDGET_MS = 500;
const VALID_REGEX_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

interface MacroTokenSpan {
  start: number;
  end: number;
  value: string;
}

interface RawMacroTag {
  start: number;
  end: number;
  name: string;
  isClose: boolean;
}

function countPrecedingBackslashes(input: string, index: number): number {
  let count = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i -= 1) {
    count += 1;
  }
  return count;
}

function parseMacroTagHeader(tagText: string): { name: string; isClose: boolean } {
  let pos = 2; // skip "{{"
  const len = tagText.length - 2; // stop before "}}"

  while (pos < len && (tagText[pos] === " " || tagText[pos] === "\t")) pos += 1;

  let isClose = false;
  while (pos < len) {
    const ch = tagText[pos]!;
    if (ch === "!" || ch === "?" || ch === "~" || ch === ">" || ch === "#") {
      pos += 1;
    } else if (ch === "/") {
      isClose = true;
      pos += 1;
    } else {
      break;
    }
  }

  while (pos < len && (tagText[pos] === " " || tagText[pos] === "\t")) pos += 1;

  const idStart = pos;
  while (pos < len && /[a-zA-Z0-9_-]/.test(tagText[pos]!)) pos += 1;
  const name = pos > idStart ? tagText.slice(idStart, pos).toLowerCase() : "";

  return { name, isClose };
}

function findClosingMacroTagIndex(tags: readonly RawMacroTag[], startIdx: number, name: string): number {
  let depth = 0;
  for (let i = startIdx; i < tags.length; i += 1) {
    const tag = tags[i]!;
    if (tag.name !== name) continue;
    if (tag.isClose) {
      if (depth === 0) return i;
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return -1;
}

function findTopLevelMacroTokens(input: string): MacroTokenSpan[] {
  const rawTags: RawMacroTag[] = [];
  let depth = 0;
  let tokenStart = -1;

  for (let i = 0; i < input.length; ) {
    const ch = input[i]!;
    if ((ch === "{" || ch === "}") && countPrecedingBackslashes(input, i) % 2 === 1) {
      i += 1;
      continue;
    }
    if (ch === "{" && input[i + 1] === "{") {
      if (depth === 0) {
        tokenStart = i;
      }
      depth += 1;
      i += 2;
      continue;
    }
    if (ch === "}" && input[i + 1] === "}" && depth > 0) {
      depth -= 1;
      i += 2;
      if (depth === 0 && tokenStart >= 0) {
        const tagText = input.slice(tokenStart, i);
        const { name, isClose } = parseMacroTagHeader(tagText);
        rawTags.push({
          start: tokenStart,
          end: i,
          name,
          isClose,
        });
        tokenStart = -1;
      }
      continue;
    }
    i += 1;
  }

  if (rawTags.length === 0) {
    return [];
  }

  const tokens: MacroTokenSpan[] = [];
  for (let i = 0; i < rawTags.length; ) {
    const tag = rawTags[i]!;
    if (!tag.isClose && tag.name) {
      const closingIdx = findClosingMacroTagIndex(rawTags, i + 1, tag.name);
      if (closingIdx >= 0) {
        const end = rawTags[closingIdx]!.end;
        tokens.push({
          start: tag.start,
          end,
          value: input.slice(tag.start, end),
        });
        i = closingIdx + 1;
        continue;
      }
    }
    tokens.push({
      start: tag.start,
      end: tag.end,
      value: input.slice(tag.start, tag.end),
    });
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

function validateFlags(flags: string): boolean {
  const seen = new Set<string>();
  for (const ch of flags) {
    if (!VALID_REGEX_FLAGS.has(ch) || seen.has(ch)) {
      return false;
    }
    seen.add(ch);
  }
  return true;
}

function hasOverlappingAlternationBranches(
  branches: readonly string[],
  hasEmptyBranch: boolean,
  hasCharClassOrShorthandOverlap: boolean,
): boolean {
  if (hasEmptyBranch || hasCharClassOrShorthandOverlap) return true;
  for (let i = 0; i < branches.length; i += 1) {
    const a = branches[i]!;
    if (!a) return true;
    for (let j = i + 1; j < branches.length; j += 1) {
      const b = branches[j]!;
      if (!b) return true;
      if (a.startsWith(b) || b.startsWith(a)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Conservative static guard against catastrophic backtracking (nested unbounded
 * quantifiers, repeating wildcards, or overlapping alternations inside a
 * repeated group). Returns true if the pattern appears unsafe to run inline.
 */
function isLikelyCatastrophicRegex(pattern: string): boolean {
  interface GroupFrame {
    hasInnerQuantifier: boolean;
    hasWildcard: boolean;
    hasAlternation: boolean;
    hasOptionalElement: boolean;
    mandatoryCount: number;
    branches: string[];
    currentBranchPrefix: string;
    currentBranchOpen: boolean;
    hasEmptyBranch: boolean;
    classLikeBranches: number;
  }

  const createFrame = (): GroupFrame => ({
    hasInnerQuantifier: false,
    hasWildcard: false,
    hasAlternation: false,
    hasOptionalElement: false,
    mandatoryCount: 0,
    branches: [],
    currentBranchPrefix: "",
    currentBranchOpen: true,
    hasEmptyBranch: false,
    classLikeBranches: 0,
  });

  const stack: GroupFrame[] = [createFrame()];
  let inCharClass = false;
  let lastWasQuantifiableAtom = false;
  let lastWasWildcard = false;
  let lastAtomIsUnboundedQuantifiedWildcard = false;

  const readQuantifier = (idx: number): { end: number; min: number; maxMoreThanOne: boolean; unbounded: boolean } | null => {
    if (idx >= pattern.length) return null;
    const ch = pattern[idx]!;
    if (ch === "*") {
      const end = pattern[idx + 1] === "?" || pattern[idx + 1] === "+" ? idx + 2 : idx + 1;
      return { end, min: 0, maxMoreThanOne: true, unbounded: true };
    }
    if (ch === "+") {
      const end = pattern[idx + 1] === "?" || pattern[idx + 1] === "+" ? idx + 2 : idx + 1;
      return { end, min: 1, maxMoreThanOne: true, unbounded: true };
    }
    if (ch === "?") {
      const end = pattern[idx + 1] === "?" || pattern[idx + 1] === "+" ? idx + 2 : idx + 1;
      return { end, min: 0, maxMoreThanOne: false, unbounded: false };
    }
    if (ch === "{") {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(idx));
      if (!m) return null;
      const min = Number.parseInt(m[1]!, 10);
      const maxStr = m[2];
      const max = maxStr === undefined ? min : maxStr === "" ? Number.POSITIVE_INFINITY : Number.parseInt(maxStr, 10);
      let end = idx + m[0].length;
      if (pattern[end] === "?" || pattern[end] === "+") end += 1;
      return {
        end,
        min,
        maxMoreThanOne: max > 1,
        unbounded: maxStr === "",
      };
    }
    return null;
  };

  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i]!;
    const top = stack[stack.length - 1]!;

    if (ch === "\\") {
      if (i + 1 >= pattern.length) break;
      const esc = pattern[i + 1]!;
      let advance = 2;
      if ((esc === "k" || esc === "p" || esc === "P") && pattern[i + 2] === "<") {
        const close = pattern.indexOf(">", i + 3);
        if (close >= 0) advance = close - i + 1;
      } else if ((esc === "p" || esc === "P" || esc === "u") && pattern[i + 2] === "{") {
        const close = pattern.indexOf("}", i + 3);
        if (close >= 0) advance = close - i + 1;
      }
      i += advance;
      if (!inCharClass) {
        const isAnchor = esc === "b" || esc === "B";
        lastWasQuantifiableAtom = !isAnchor;
        lastWasWildcard = false;
        if (!isAnchor) {
          top.mandatoryCount += 1;
          lastAtomIsUnboundedQuantifiedWildcard = false;
          if (esc === "w" || esc === "W" || esc === "d" || esc === "D" || esc === "s" || esc === "S" || esc === "p" || esc === "P") {
            if (top.currentBranchOpen && top.currentBranchPrefix.length === 0) {
              top.classLikeBranches += 1;
            }
            top.currentBranchOpen = false;
          } else if (top.currentBranchOpen && top.currentBranchPrefix.length < 16) {
            top.currentBranchPrefix += esc;
          }
        }
      }
      continue;
    }

    if (inCharClass) {
      if (ch === "]") {
        inCharClass = false;
        lastWasQuantifiableAtom = true;
        lastWasWildcard = false;
        top.mandatoryCount += 1;
        if (top.currentBranchOpen && top.currentBranchPrefix.length === 0) {
          top.classLikeBranches += 1;
        }
        top.currentBranchOpen = false;
      }
      i += 1;
      continue;
    }

    if (ch === "[") {
      inCharClass = true;
      const rest = pattern.slice(i);
      const isWildClass = /^\[(?:\\s\\S|\\S\\s|\\d\\D|\\D\\d|\\w\\W|\\W\\w)\]/.test(rest);
      lastWasWildcard = isWildClass;
      if (isWildClass) top.hasWildcard = true;
      i += 1;
      continue;
    }

    if (ch === "(") {
      let skip = 1;
      if (pattern[i + 1] === "?") {
        if (pattern[i + 2] === "#") {
          const close = pattern.indexOf(")", i + 3);
          i = close >= 0 ? close + 1 : pattern.length;
          continue;
        }
        if (pattern[i + 2] === "<" && (pattern[i + 3] === "=" || pattern[i + 3] === "!")) {
          skip = 4;
        } else if (pattern[i + 2] === "<") {
          const gt = pattern.indexOf(">", i + 3);
          skip = gt >= 0 ? gt - i + 1 : 2;
        } else if (pattern[i + 2] === ":" || pattern[i + 2] === "=" || pattern[i + 2] === "!") {
          skip = 3;
        }
      }
      top.currentBranchOpen = false;
      stack.push(createFrame());
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      i += skip;
      continue;
    }

    if (ch === ")") {
      const closed = stack.length > 1 ? stack.pop()! : null;
      const parent = stack[stack.length - 1]!;
      if (closed) {
        if (closed.currentBranchPrefix.length === 0 && closed.mandatoryCount === 0) {
          closed.hasEmptyBranch = true;
        } else if (closed.currentBranchPrefix.length > 0) {
          closed.branches.push(closed.currentBranchPrefix);
        }
        if (closed.hasInnerQuantifier) parent.hasInnerQuantifier = true;
        if (closed.hasWildcard) parent.hasWildcard = true;
        if (closed.mandatoryCount > 0) parent.mandatoryCount += 1;
      }
      lastWasQuantifiableAtom = true;
      lastWasWildcard = false;
      i += 1;

      const q = readQuantifier(i);
      if (q) {
        if (closed && q.maxMoreThanOne) {
          if (
            closed.hasInnerQuantifier &&
            (q.unbounded || closed.hasWildcard || closed.hasOptionalElement || closed.mandatoryCount <= 1)
          ) {
            return true;
          }
          if (
            closed.hasAlternation &&
            (closed.hasOptionalElement ||
              closed.hasWildcard ||
              hasOverlappingAlternationBranches(
                closed.branches,
                closed.hasEmptyBranch,
                closed.classLikeBranches > 1,
              ))
          ) {
            return true;
          }
        }
        if (q.min === 0) {
          parent.hasOptionalElement = true;
          if (closed && closed.mandatoryCount > 0) {
            parent.mandatoryCount = Math.max(0, parent.mandatoryCount - 1);
          }
        }
        if (q.maxMoreThanOne) {
          parent.hasInnerQuantifier = true;
        }
        lastWasQuantifiableAtom = false;
        i = q.end;
      }
      continue;
    }

    if (ch === "|") {
      top.hasAlternation = true;
      if (top.currentBranchPrefix.length === 0 && top.currentBranchOpen) {
        top.hasEmptyBranch = true;
      } else if (top.currentBranchPrefix.length > 0) {
        top.branches.push(top.currentBranchPrefix);
      }
      top.currentBranchPrefix = "";
      top.currentBranchOpen = true;
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      i += 1;
      continue;
    }

    const q = readQuantifier(i);
    if (q && lastWasQuantifiableAtom) {
      if (q.min === 0) {
        top.hasOptionalElement = true;
        top.mandatoryCount = Math.max(0, top.mandatoryCount - 1);
      }
      if (q.maxMoreThanOne) {
        top.hasInnerQuantifier = true;
      }
      if (lastWasWildcard && q.unbounded) {
        if (lastAtomIsUnboundedQuantifiedWildcard) {
          return true;
        }
        lastAtomIsUnboundedQuantifiedWildcard = true;
      } else {
        lastAtomIsUnboundedQuantifiedWildcard = false;
      }
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      i = q.end;
      continue;
    }

    if (ch === "^" || ch === "$") {
      lastWasQuantifiableAtom = false;
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      i += 1;
      continue;
    }

    if (ch === ".") {
      top.hasWildcard = true;
      lastWasWildcard = true;
      top.currentBranchOpen = false;
    } else {
      lastWasWildcard = false;
      lastAtomIsUnboundedQuantifiedWildcard = false;
      if (top.currentBranchOpen && top.currentBranchPrefix.length < 16) {
        top.currentBranchPrefix += ch;
      }
    }

    top.mandatoryCount += 1;
    lastWasQuantifiableAtom = true;
    i += 1;
  }

  return false;
}

const ESCAPABLE_LITERAL_CHARS = new Set("\\^$.*+?()[]{}|/");

function getRequiredTerminalLiteral(pattern: string): string | null {
  let suffix = "";
  let depth = 0;
  let inCharacterClass = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === "\\") {
      const escaped = pattern[i + 1];
      if (escaped === undefined) return null;
      i += 1;
      if (inCharacterClass) continue;
      if (ESCAPABLE_LITERAL_CHARS.has(escaped)) {
        suffix += escaped;
      } else {
        suffix = "";
        if ((escaped === "k" || escaped === "p" || escaped === "P") && pattern[i + 1] === "<") {
          const close = pattern.indexOf(">", i + 2);
          if (close >= 0) i = close;
        } else if ((escaped === "p" || escaped === "P" || escaped === "u") && pattern[i + 1] === "{") {
          const close = pattern.indexOf("}", i + 2);
          if (close >= 0) i = close;
        } else if (escaped === "u") {
          i = Math.min(pattern.length - 1, i + 4);
        } else if (escaped === "x") {
          i = Math.min(pattern.length - 1, i + 2);
        } else if (escaped === "c") {
          i = Math.min(pattern.length - 1, i + 1);
        } else if (/\d/.test(escaped)) {
          while (/\d/.test(pattern[i + 1] ?? "")) i += 1;
        }
      }
      continue;
    }

    if (inCharacterClass) {
      if (char === "]") inCharacterClass = false;
      continue;
    }
    if (char === "[") {
      inCharacterClass = true;
      suffix = "";
      continue;
    }
    if (char === "(") {
      depth += 1;
      suffix = "";
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      suffix = "";
      continue;
    }
    if (char === "|") {
      if (depth === 0) return null;
      suffix = "";
      continue;
    }
    if (".*+?^${}".includes(char)) {
      suffix = "";
      continue;
    }
    suffix += char;
  }

  return suffix.length >= 4 ? suffix : null;
}

function getRegexSearchEnd(
  input: string,
  pattern: string,
  flags: string,
  replacementTemplate: string,
): number {
  if (flags.includes("y") || replacementTemplate.includes("$'")) return input.length;
  const terminal = getRequiredTerminalLiteral(pattern);
  if (!terminal) return input.length;

  let index = -1;
  if (!flags.includes("i")) {
    index = input.lastIndexOf(terminal);
  } else {
    const unicodeFlag = flags.includes("v") ? "v" : flags.includes("u") ? "u" : "";
    const guard = new RegExp(escapeRegExp(terminal), `gi${unicodeFlag}`);
    let match: RegExpExecArray | null;
    while ((match = guard.exec(input)) !== null) {
      index = match.index;
    }
  }

  return index < 0 ? 0 : index + terminal.length;
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
  // Expand {{match}} and $-references in a single pass so '$' sequences
  // inside matched text are never re-parsed as capture back-references.
  return template.replace(
    /\{\{match\}\}|\$(?:\$|&|`|'|<([^>]+)>|(\d{1,2}))/g,
    (token, groupName: string | undefined, groupNum: string | undefined) => {
      if (token === "{{match}}") return trimmedMatch;
      if (token === "$$") return "$";
      if (token === "$&") return match[0];
      if (token === "$`") return fullText.slice(0, match.index);
      if (token === "$'") return fullText.slice(match.index + match[0].length);
      if (groupName !== undefined) {
        if (match.groups && Object.prototype.hasOwnProperty.call(match.groups, groupName)) {
          return match.groups[groupName] ?? "";
        }
        return token;
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

function applyTrimStrings(result: string, trimStrings: readonly string[]): string {
  for (const trim of trimStrings) {
    if (typeof trim === "string" && trim.length > 0) {
      while (result.includes(trim)) {
        result = result.replaceAll(trim, "");
      }
    }
  }
  return result;
}

function trimMatchStrings(rawMatch: string, trimStrings: readonly string[]): string {
  let trimmed = rawMatch;
  for (const trim of trimStrings) {
    if (typeof trim === "string" && trim.length > 0) {
      trimmed = trimmed.split(trim).join("");
    }
  }
  return trimmed;
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
    if (
      script.metadata &&
      typeof script.metadata === "object" &&
      (script.metadata as { regex_evidence?: { quarantined?: unknown } }).regex_evidence?.quarantined === true
    ) {
      continue;
    }
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

    const flags = typeof script.flags === "string" ? script.flags : "";
    if (!validateFlags(flags)) {
      continue;
    }

    const resolvedFindRegex = await resolveFindRegex(
      script.find_regex,
      script.substitute_macros,
      options.resolveMacros,
    );

    if (resolvedFindRegex.length > MAX_REGEX_PATTERN_LENGTH || isLikelyCatastrophicRegex(resolvedFindRegex)) {
      continue;
    }

    const actions = extractMatchActions(script);
    const moveTop = actions.has("move_top");
    const moveBottom = actions.has("move_bottom");
    const repeatBack = actions.has("repeat_back");
    const effectiveFlags = moveTop || moveBottom ? flags.replaceAll("g", "") : flags;

    let regex: RegExp;
    try {
      regex = new RegExp(resolvedFindRegex, effectiveFlags);
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

    const trimStrings = Array.isArray(script.trim_strings) ? script.trim_strings : [];

    const searchEnd = getRegexSearchEnd(current, resolvedFindRegex, effectiveFlags, baseReplaceTemplate);
    const searchInput = searchEnd === current.length ? current : current.slice(0, searchEnd);
    const searchTail = searchEnd === current.length ? "" : current.slice(searchEnd);

    const matches: Array<{
      index: number;
      length: number;
      replacement: string;
      movedValue: string;
    }> = [];

    let timedOut = false;
    const startedAt = Date.now();
    if (searchEnd > 0 || current.length === 0) {
      let execResult: RegExpExecArray | null;
      while ((execResult = regex.exec(searchInput)) !== null) {
        const trimmedMatch = trimMatchStrings(execResult[0], trimStrings);

        let replacement = expandReplacementTemplate(
          baseReplaceTemplate,
          execResult,
          trimmedMatch,
          current,
        );

        if (script.substitute_macros === "raw" && options.resolveMacros) {
          replacement = await options.resolveMacros(replacement);
        }

        const movedValue = replacement.length > 0 ? replacement : trimmedMatch;
        matches.push({
          index: execResult.index,
          length: execResult[0].length,
          replacement,
          movedValue,
        });

        if (Date.now() - startedAt > REGEX_SCRIPT_TIME_BUDGET_MS) {
          timedOut = true;
          break;
        }
        if (matches.length >= MAX_REGEX_MATCHES) {
          break;
        }
        if (!regex.global && !regex.sticky) {
          break;
        }
        if (execResult[0].length === 0) {
          if (regex.lastIndex >= searchInput.length) {
            break;
          }
          const cp = searchInput.codePointAt(regex.lastIndex);
          regex.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1;
        }
      }
    }

    if (timedOut) {
      continue;
    }

    if (matches.length === 0) {
      if (repeatBack && options.previousContent !== undefined) {
        let priorRegex: RegExp | null = null;
        try {
          priorRegex = new RegExp(resolvedFindRegex, effectiveFlags);
        } catch {
          priorRegex = null;
        }
        const priorExec = priorRegex ? priorRegex.exec(options.previousContent) : null;
        if (priorExec) {
          const repeatRawMatch = script.metadata?.repeat_raw_match === true;
          const repeatPosition =
            typeof script.metadata?.repeat_position === "string"
              ? script.metadata.repeat_position
              : (script.replace_string ?? "").split(" ", 2)[1];

          let piece: string;
          if (repeatRawMatch) {
            piece = priorExec[0];
          } else {
            const trimmedPrior = trimMatchStrings(priorExec[0], trimStrings);
            piece = expandReplacementTemplate(
              baseReplaceTemplate,
              priorExec,
              trimmedPrior,
              options.previousContent,
            );
            if (
              (script.substitute_macros === "raw" || script.substitute_macros === "after") &&
              options.resolveMacros
            ) {
              piece = await options.resolveMacros(piece);
            }
          }

          let repeated = current;
          if (!repeatPosition || repeatPosition === "end") {
            repeated = current + piece;
          } else if (repeatPosition === "start") {
            repeated = piece + current;
          } else if (repeatPosition === "end_nl") {
            repeated = `${current}\n${piece}`;
          } else if (repeatPosition === "start_nl") {
            repeated = `${piece}\n${current}`;
          }
          current = applyTrimStrings(repeated, trimStrings);
        }
      }
      if (script.substitute_macros === "after" && options.resolveMacros) {
        current = await options.resolveMacros(current);
      }
      continue;
    }

    if (moveTop || moveBottom) {
      const m = matches[0]!;
      const remainder =
        searchInput.slice(0, m.index) +
        searchInput.slice(m.index + m.length) +
        searchTail;
      let moved = m.movedValue;
      if (script.substitute_macros === "after" && options.resolveMacros) {
        moved = await options.resolveMacros(moved);
      }
      let next = moveTop
        ? joinSections(moved, remainder)
        : joinSections(remainder, moved);
      if (repeatBack && options.previousContent === undefined && moved) {
        next = joinSections(next, moved);
      }
      current = applyTrimStrings(next, trimStrings);
      continue;
    }

    let rebuilt = "";
    let cursor = 0;
    const movedChunks: string[] = [];

    for (const m of matches) {
      rebuilt += searchInput.slice(cursor, m.index);
      rebuilt += m.replacement;
      if (repeatBack && options.previousContent === undefined && m.movedValue) {
        movedChunks.push(m.movedValue);
      }
      cursor = m.index + m.length;
    }
    rebuilt += searchInput.slice(cursor) + searchTail;

    if (script.substitute_macros === "after" && options.resolveMacros) {
      rebuilt = await options.resolveMacros(rebuilt);
    }

    if (repeatBack && options.previousContent === undefined && movedChunks.length > 0) {
      rebuilt = joinSections(rebuilt, movedChunks.join("\n"));
    }

    current = applyTrimStrings(rebuilt, trimStrings);
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
  const fontTokenRe = /(<\/?font\b[^>]*>|\r?\n\r?\n)/gi;
  const closeInsertOffsets: number[] = [];
  const openStack: Array<{ endOffset: number; lineEndOffset: number }> = [];
  let tokenMatch: RegExpExecArray | null;

  const findLineEnd = (fromIndex: number): number => {
    const nl = out.indexOf("\n", fromIndex);
    if (nl === -1) return out.length;
    return nl > fromIndex && out[nl - 1] === "\r" ? nl - 1 : nl;
  };

  while ((tokenMatch = fontTokenRe.exec(out)) !== null) {
    const token = tokenMatch[0];
    if (token === "\n\n" || token === "\r\n\r\n" || /^\r?\n\r?\n$/.test(token)) {
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

const OPEN_BOUNDARY_RE = /[\s([{"'“‘«>—–-]/;
const CLOSE_BOUNDARY_RE = /[\s)\]},.!?:;"'”’»<—–-]/;
const HAS_ALNUM_RE = /[\p{L}\p{N}]/u;

interface TextSpan {
  start: number;
  end: number;
}

function findHtmlTagSpansOnLine(line: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "<") continue;
    const next = line[i + 1];
    if (!next || !/[a-zA-Z!?/]/.test(next)) continue;

    let attrQuote: '"' | "'" | null = null;
    let closedAt = -1;
    for (let j = i + 1; j < line.length; j += 1) {
      const ch = line[j]!;
      if (attrQuote) {
        if (ch === attrQuote && countPrecedingBackslashes(line, j) % 2 === 0) {
          attrQuote = null;
        }
      } else if (ch === '"' || ch === "'") {
        attrQuote = ch;
      } else if (ch === ">") {
        closedAt = j + 1;
        break;
      }
    }
    if (closedAt > i) {
      spans.push({ start: i, end: closedAt });
      i = closedAt - 1;
    }
  }
  return spans;
}

function isInsideSpans(index: number, spans: readonly TextSpan[]): boolean {
  for (const span of spans) {
    if (index < span.start) return false;
    if (index < span.end) return true;
  }
  return false;
}

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

function applyTextEdits(line: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) return line;
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += line.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + line.slice(cursor);
}

function trimInnerWhitespaceInPairs(
  line: string,
  openChar: string,
  closeChar: string,
  tagSpans: readonly TextSpan[] = findHtmlTagSpansOnLine(line),
): string {
  const edits: TextEdit[] = [];
  let openEnd = -1;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch !== openChar && ch !== closeChar) continue;
    if (isInsideSpans(i, tagSpans)) continue;
    if (countPrecedingBackslashes(line, i) % 2 === 1) continue;

    const canOpen = i === 0 || OPEN_BOUNDARY_RE.test(line[i - 1]!);
    const canClose = i + 1 === line.length || CLOSE_BOUNDARY_RE.test(line[i + 1]!);

    if (openChar === closeChar) {
      if (openEnd === -1) {
        if (canOpen) {
          openEnd = i + 1;
        }
      } else if (canClose) {
        const inner = line.slice(openEnd, i);
        const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
        if (trimmed !== inner && trimmed.length > 0 && HAS_ALNUM_RE.test(trimmed)) {
          edits.push({ start: openEnd, end: i, replacement: trimmed });
        }
        openEnd = -1;
      }
    } else {
      if (ch === openChar) {
        if (canOpen) {
          openEnd = i + 1;
        }
      } else if (ch === closeChar && openEnd !== -1 && canClose) {
        const inner = line.slice(openEnd, i);
        const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
        if (trimmed !== inner && trimmed.length > 0 && HAS_ALNUM_RE.test(trimmed)) {
          edits.push({ start: openEnd, end: i, replacement: trimmed });
        }
        openEnd = -1;
      }
    }
  }

  return applyTextEdits(line, edits);
}

function trimDelimiterOnLine(
  line: string,
  delimiter: "*" | "_",
  tagSpans: readonly TextSpan[],
): string {
  let out = line;
  let currentTagSpans = tagSpans;

  for (const size of [3, 2, 1] as const) {
    if (out !== line) {
      currentTagSpans = findHtmlTagSpansOnLine(out);
    }

    const runs: Array<{
      start: number;
      end: number;
      canOpen: boolean;
      canClose: boolean;
      isMath: boolean;
    }> = [];

    for (let i = 0; i < out.length; ) {
      if (out[i] !== delimiter) {
        i += 1;
        continue;
      }
      if (isInsideSpans(i, currentTagSpans) || countPrecedingBackslashes(out, i) % 2 === 1) {
        while (i < out.length && out[i] === delimiter) i += 1;
        continue;
      }
      const runStart = i;
      while (i < out.length && out[i] === delimiter) i += 1;
      const runEnd = i;
      if (runEnd - runStart !== size) continue;

      const canOpen = runStart === 0 || OPEN_BOUNDARY_RE.test(out[runStart - 1]!);
      const canClose = runEnd === out.length || CLOSE_BOUNDARY_RE.test(out[runEnd]!);

      let isMath = false;
      if (delimiter === "*" && (size === 1 || size === 2)) {
        const hasLeftMath = /[\d)][ \t]+$/.test(out.slice(0, runStart));
        const hasRightMath = /^[ \t]+[\d(]/.test(out.slice(runEnd));
        isMath = hasLeftMath && hasRightMath;
      }

      runs.push({ start: runStart, end: runEnd, canOpen, canClose, isMath });
    }

    const nonMathRuns = runs.filter((r) => !r.isMath);
    if (nonMathRuns.length < 2) continue;

    if (
      delimiter === "*" &&
      size === 1 &&
      /^[ \t]*\*(?!\*)[ \t]+/.test(out) &&
      nonMathRuns.length % 2 === 1
    ) {
      continue;
    }

    const marker = delimiter.repeat(size);
    const edits: TextEdit[] = [];
    let openRun: (typeof nonMathRuns)[number] | null = null;

    for (const run of nonMathRuns) {
      if (!openRun) {
        if (run.canOpen) {
          openRun = run;
        }
        continue;
      }

      if (run.canClose) {
        const inner = out.slice(openRun.end, run.start);
        const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
        const safeInner =
          trimmed !== inner &&
          trimmed.length > 0 &&
          HAS_ALNUM_RE.test(trimmed) &&
          !trimmed.startsWith(delimiter) &&
          !trimmed.endsWith(delimiter) &&
          !trimmed.includes(marker) &&
          (size > 1 || !inner.includes(delimiter));
        if (safeInner) {
          edits.push({ start: openRun.end, end: run.start, replacement: trimmed });
        }
        openRun = null;
      } else if (run.canOpen) {
        openRun = run;
      }
    }

    out = applyTextEdits(out, edits);
  }

  return out;
}

function trimEmphasisOnLine(
  line: string,
  tagSpans: readonly TextSpan[] = findHtmlTagSpansOnLine(line),
): string {
  let out = trimDelimiterOnLine(line, "*", tagSpans);
  const nextSpans = out === line ? tagSpans : findHtmlTagSpansOnLine(out);
  out = trimDelimiterOnLine(out, "_", nextSpans);
  return out;
}

function healProseSegment(prose: string): string {
  const out = healFontTagsAndAttributes(prose);
  const lines = out.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]!;
    for (let pass = 0; pass < 2; pass += 1) {
      let next = trimEmphasisOnLine(line);
      const tagSpans = findHtmlTagSpansOnLine(next);
      next = trimInnerWhitespaceInPairs(next, '"', '"', tagSpans);
      next = trimInnerWhitespaceInPairs(next, "“", "”", tagSpans);
      next = trimInnerWhitespaceInPairs(next, "‘", "’", tagSpans);
      if (next === line) break;
      line = next;
    }
    lines[i] = line;
  }

  return lines.join("\n");
}

function findFencedCodeSpans(text: string): TextSpan[] {
  interface FenceLine {
    lineStart: number;
    lineEnd: number;
    fenceChar: string;
    fenceLen: number;
    isCloserOnly: boolean;
    infoHasBacktick: boolean;
  }

  const fenceLines: FenceLine[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    const m = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (m) {
      const fence = m[1]!;
      const info = m[2]!;
      fenceLines.push({
        lineStart: pos,
        lineEnd,
        fenceChar: fence[0]!,
        fenceLen: fence.length,
        isCloserOnly: /^[ \t]*$/.test(info),
        infoHasBacktick: fence[0] === "`" && info.includes("`"),
      });
    }
    if (nl === -1) break;
    pos = nl + 1;
  }

  const spans: TextSpan[] = [];
  for (let i = 0; i < fenceLines.length; i += 1) {
    const open = fenceLines[i]!;
    if (open.infoHasBacktick) continue;
    for (let j = i + 1; j < fenceLines.length; j += 1) {
      const close = fenceLines[j]!;
      if (
        close.isCloserOnly &&
        close.fenceChar === open.fenceChar &&
        close.fenceLen >= open.fenceLen
      ) {
        spans.push({ start: open.lineStart, end: close.lineEnd });
        i = j;
        break;
      }
    }
  }

  return spans;
}

const JSON_OPEN_TAG_RE = /<json(?:\s[^>]*)?>/gi;
const JSON_TAG_AT_RE = /<\/?json(?:\s[^>]*)?>/iy;
const JSON_START_RE = /[ \t\n\r]*[-0-9"[{tfn]/y;
const MAX_REJECTED_JSON_CANDIDATES = 256;

function indexOfJsonTagOutsideStrings(text: string, from: number, limit: number): number {
  let inString = false;
  for (let i = from; i < limit; i += 1) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 0x5c) i += 1; // backslash escape
      else if (ch === 0x22) inString = false; // '"'
    } else if (ch === 0x22) {
      inString = true;
    } else if (ch === 0x3c) {
      JSON_TAG_AT_RE.lastIndex = i;
      const m = JSON_TAG_AT_RE.exec(text);
      if (m && i + m[0].length <= limit) return i;
    }
  }
  return -1;
}

function findJsonBlockSpans(
  text: string,
  from: number,
  to: number,
): { spans: TextSpan[]; stoppedAt: number } {
  const spans: TextSpan[] = [];
  let rejected = 0;

  const findOpen = (start: number): { start: number; end: number } | null => {
    JSON_OPEN_TAG_RE.lastIndex = start;
    const m = JSON_OPEN_TAG_RE.exec(text);
    if (!m || m.index + m[0].length > to) return null;
    return { start: m.index, end: m.index + m[0].length };
  };

  let open = findOpen(from);
  while (open) {
    const innerStart = open.end;
    const tagIdx = indexOfJsonTagOutsideStrings(text, innerStart, to);
    if (tagIdx >= 0 && text.charCodeAt(tagIdx + 1) !== 0x2f) {
      // Another opening <json> before </json> outside strings
      open = findOpen(tagIdx);
      continue;
    }

    let validBlockEnd = -1;
    if (tagIdx >= 0) {
      JSON_TAG_AT_RE.lastIndex = tagIdx;
      const closeTag = JSON_TAG_AT_RE.exec(text);
      if (closeTag && closeTag[0].toLowerCase() === "</json>") {
        JSON_START_RE.lastIndex = innerStart;
        if (JSON_START_RE.test(text)) {
          try {
            JSON.parse(text.slice(innerStart, tagIdx));
            validBlockEnd = tagIdx + closeTag[0].length;
          } catch {
            validBlockEnd = -1;
          }
        }
      }
    }

    if (validBlockEnd >= 0) {
      spans.push({ start: open.start, end: validBlockEnd });
      open = findOpen(validBlockEnd);
    } else if (++rejected === MAX_REJECTED_JSON_CANDIDATES) {
      return { spans, stoppedAt: open.start };
    } else {
      open = findOpen(innerStart);
    }
  }

  return { spans, stoppedAt: to };
}

function healInlineBackticksAndProse(segment: string): string {
  const runs: Array<{ start: number; end: number; len: number }> = [];
  const byLen = new Map<number, number[]>();

  for (let i = 0; i < segment.length; ) {
    if (segment[i] !== "`") {
      i += 1;
      continue;
    }
    const start = i;
    while (i < segment.length && segment[i] === "`") i += 1;
    const len = i - start;
    const runIdx = runs.length;
    runs.push({ start, end: i, len });
    let list = byLen.get(len);
    if (!list) {
      list = [];
      byLen.set(len, list);
    }
    list.push(runIdx);
  }

  if (runs.length < 2) {
    return healProseSegment(segment);
  }

  const lenCursors = new Map<number, number>();
  let result = "";
  let textCursor = 0;

  for (let rIdx = 0; rIdx < runs.length; rIdx += 1) {
    const open = runs[rIdx]!;
    if (open.start < textCursor) continue;

    const list = byLen.get(open.len)!;
    let ptr = lenCursors.get(open.len) ?? 0;
    while (ptr < list.length && list[ptr]! <= rIdx) {
      ptr += 1;
    }
    lenCursors.set(open.len, ptr);

    if (ptr >= list.length) continue;

    const closeIdx = list[ptr]!;
    const close = runs[closeIdx]!;
    if (open.start > textCursor) {
      result += healProseSegment(segment.slice(textCursor, open.start));
    }
    result += segment.slice(open.start, close.end);
    textCursor = close.end;
    lenCursors.set(open.len, ptr + 1);
    rIdx = closeIdx;
  }

  if (textCursor < segment.length) {
    result += healProseSegment(segment.slice(textCursor));
  }

  return result;
}

function healOutsideJsonBlocks(text: string, from: number, to: number): string {
  const { spans, stoppedAt } = findJsonBlockSpans(text, from, to);
  let result = "";
  let cursor = from;
  for (const span of spans) {
    if (span.start > cursor) {
      result += healInlineBackticksAndProse(text.slice(cursor, span.start));
    }
    result += text.slice(span.start, span.end);
    cursor = span.end;
  }
  if (stoppedAt > cursor) {
    result += healInlineBackticksAndProse(text.slice(cursor, stoppedAt));
  }
  if (stoppedAt < to) {
    result += text.slice(stoppedAt, to);
  }
  return result;
}

/**
 * Mirrors Lumiverse's prose-only formatting healer while skipping fenced code blocks,
 * `<json>...</json>` blocks, and inline backtick spans.
 */
export function healFormattingArtifacts(text: string): string {
  if (!text || typeof text !== "string") {
    return text;
  }

  const fencedSpans = findFencedCodeSpans(text);
  let result = "";
  let lastIndex = 0;

  for (const span of fencedSpans) {
    if (span.start > lastIndex) {
      result += healOutsideJsonBlocks(text, lastIndex, span.start);
    }
    result += text.slice(span.start, span.end);
    lastIndex = span.end;
  }

  if (lastIndex < text.length) {
    result += healOutsideJsonBlocks(text, lastIndex, text.length);
  }

  return result;
}

/**
 * Applies `"ai_output"` and optional `"reasoning"` response regex scripts at depth 0,
 * followed by `healFormattingArtifacts` on `content` (matching Lumiverse's `processResponseText`).
 */
export async function processResponseOutput(
  options: ProcessResponseOutputOptions,
): Promise<ProcessResponseOutputResult> {
  const processedContent = healFormattingArtifacts(
    await applyRegexScripts(options.content, options.scripts, "ai_output", 0, {
      resolveMacros: options.resolveMacros,
      ...(options.previousContent !== undefined ? { previousContent: options.previousContent } : {}),
    }),
  );

  let processedReasoning = options.reasoning;
  if (typeof options.reasoning === "string" && options.reasoning.length > 0) {
    processedReasoning = await applyRegexScripts(
      options.reasoning,
      options.scripts,
      "reasoning",
      0,
      {
        resolveMacros: options.resolveMacros,
        ...(options.previousContent !== undefined ? { previousContent: options.previousContent } : {}),
      },
    );
  }

  return {
    content: processedContent,
    ...(processedReasoning !== undefined ? { reasoning: processedReasoning } : {}),
  };
}
