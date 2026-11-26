export type MediaSlotPosition = "leading" | "inline" | "trailing";

export type MediaSlotKind =
  | "markdown_image"
  | "html_img"
  | "html_video"
  | "html_audio"
  | "html_picture"
  | "html_figure";

export interface MediaSlot {
  /** 1-based slot index corresponding to `[[MEDIA_1]]`, `[[MEDIA_2]]`, ... */
  index: number;
  /** Placeholder token inserted into sanitized prose, e.g. `[[MEDIA_1]]`. */
  token: string;
  /** Exact byte-for-byte original media markup. */
  original: string;
  /** Original placement relative to surrounding prose. */
  position: MediaSlotPosition;
  /** Detected markup category. */
  kind: MediaSlotKind;
}

export interface ExtractMediaSlotsResult {
  text: string;
  slots: MediaSlot[];
  hasMedia: boolean;
}

export interface RestoreMediaSlotsReport {
  text: string;
  restoredTokens: string[];
  reanchoredTokens: string[];
}

interface RawMediaMatch {
  start: number;
  end: number;
  original: string;
  kind: MediaSlotKind;
}

const PAIRED_MEDIA_TAGS = ["figure", "picture", "video", "audio"] as const;
type PairedMediaTag = (typeof PAIRED_MEDIA_TAGS)[number];

const PAIRED_KIND_MAP: Record<PairedMediaTag, MediaSlotKind> = {
  figure: "html_figure",
  picture: "html_picture",
  video: "html_video",
  audio: "html_audio",
};

function isTagBoundaryChar(ch: string | undefined): boolean {
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

function isSelfClosingTag(text: string, openPos: number, closePos: number): boolean {
  let j = closePos - 1;
  while (j > openPos && /\s/.test(text[j]!)) {
    j -= 1;
  }
  return j > openPos && text[j] === "/";
}

function matchTagNameAt(text: string, pos: number, tagName: string): boolean {
  const end = pos + tagName.length;
  if (end > text.length) return false;
  if (text.slice(pos, end).toLowerCase() !== tagName) return false;
  return isTagBoundaryChar(text[end]);
}

function isHtmlTagStartChar(ch: string | undefined): boolean {
  return ch !== undefined && (/[a-zA-Z]/.test(ch) || ch === "/" || ch === "!");
}

/**
 * Per-scan O(N) memoization tables so adversarial unclosed tags or brackets
 * (`<figure>`.repeat(N), `<img `.repeat(N), `![`.repeat(N)) never degrade to O(N²).
 */
interface MediaScanMemo {
  /** Lowest index from which `text.indexOf(">", pos)` returned `-1`. */
  noGtFrom: number;
  /** `<` offsets already proven to have no unquoted closing `>` before EOF. */
  failedTagStarts: Set<number>;
  /** Lowest index from which no `)` exists before EOF. */
  noCloseParenFrom: number;
  /** Lazily computed O(N) stack map of matched paired blocks per tag (`openStart -> endExclusive`). */
  pairedBlocks: Partial<Record<PairedMediaTag, Map<number, number>>>;
  /** Lazily computed O(N) stack map of balanced Markdown `[...]` pairs (`openBracketPos -> closeBracketPos`). */
  bracketPairs: Map<number, number> | null;
}

function createMediaScanMemo(): MediaScanMemo {
  return {
    noGtFrom: Number.POSITIVE_INFINITY,
    failedTagStarts: new Set<number>(),
    noCloseParenFrom: Number.POSITIVE_INFINITY,
    pairedBlocks: {},
    bracketPairs: null,
  };
}

/**
 * Memoized HTML tag-end finder that respects quoted attribute values and
 * memoizes failed unclosed-quote scans so adversarial inputs remain O(N).
 */
function findHtmlTagEndMemo(
  text: string,
  openPos: number,
  memo: MediaScanMemo,
): number {
  if (openPos >= memo.noGtFrom || memo.failedTagStarts.has(openPos)) {
    return -1;
  }
  const rawGt = text.indexOf(">", openPos + 1);
  if (rawGt === -1) {
    memo.noGtFrom = Math.min(memo.noGtFrom, openPos);
    return -1;
  }
  let quote: '"' | "'" | null = null;
  let nullQuoteLt: number[] | null = null;
  for (let i = openPos + 1; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    } else if (ch === "<") {
      if (!nullQuoteLt) nullQuoteLt = [];
      nullQuoteLt.push(i);
    }
  }
  memo.failedTagStarts.add(openPos);
  if (nullQuoteLt) {
    for (const pos of nullQuoteLt) {
      memo.failedTagStarts.add(pos);
    }
  }
  return -1;
}

/**
 * Lazily computes all valid matched `<tag>...</tag>` (and self-closing `<tag/>`)
 * spans in a single O(N) pass, advancing past EVERY inner HTML tag with
 * `findHtmlTagEnd` so quoted attributes like `alt="</figure>"` can never
 * prematurely close the outer paired block.
 */
function getPairedBlockMap(
  text: string,
  tag: PairedMediaTag,
  memo: MediaScanMemo,
): Map<number, number> {
  const existing = memo.pairedBlocks[tag];
  if (existing) return existing;

  const matched = new Map<number, number>();
  const openStack: number[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const lt = text.indexOf("<", cursor);
    if (lt === -1) break;

    if (!isHtmlTagStartChar(text[lt + 1])) {
      cursor = lt + 1;
      continue;
    }

    // Handle HTML comments `<!-- ... -->` cleanly so commented tags don't break nesting
    if (text.startsWith("<!--", lt)) {
      const commentEnd = text.indexOf("-->", lt + 4);
      if (commentEnd === -1) break;
      cursor = commentEnd + 3;
      continue;
    }

    const gt = findHtmlTagEndMemo(text, lt, memo);
    if (gt === -1) {
      // Unterminated tag at `lt`; advance by 1 in case it was literal `<foo` prose
      // while avoiding O(N²) rescanning via `noGtFrom` / `noTagEndFrom`.
      if (lt >= memo.noGtFrom) break;
      cursor = lt + 1;
      continue;
    }

    if (text[lt + 1] === "/") {
      if (matchTagNameAt(text, lt + 2, tag) && openStack.length > 0) {
        const openStart = openStack.pop()!;
        matched.set(openStart, gt + 1);
      }
    } else if (matchTagNameAt(text, lt + 1, tag)) {
      if (isSelfClosingTag(text, lt, gt)) {
        matched.set(lt, gt + 1);
      } else {
        openStack.push(lt);
      }
    }

    cursor = gt + 1;
  }

  memo.pairedBlocks[tag] = matched;
  return matched;
}

/**
 * Lazily computes balanced Markdown `[` -> `]` pairs within paragraphs (resetting
 * on double newlines `\n\n` and honoring backslash escapes) in a single O(N) pass.
 */
function getBracketPairMap(text: string, memo: MediaScanMemo): Map<number, number> {
  if (memo.bracketPairs) return memo.bracketPairs;

  const pairs = new Map<number, number>();
  const stack: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      i += 1;
      continue;
    }
    if (ch === "\n" && text[i + 1] === "\n") {
      stack.length = 0;
      continue;
    }
    if (ch === "[") {
      stack.push(i);
    } else if (ch === "]" && stack.length > 0) {
      pairs.set(stack.pop()!, i);
    }
  }

  memo.bracketPairs = pairs;
  return pairs;
}

/**
 * Scans an HTML media tag or paired block (`<figure>`, `<picture>`, `<video>`,
 * `<audio>`, `<img>`) starting at `start` in amortized O(1) time.
 */
function scanHtmlMediaAt(
  text: string,
  start: number,
  memo: MediaScanMemo,
): RawMediaMatch | null {
  if (text[start] !== "<") return null;

  // Standalone <img> tag
  if (matchTagNameAt(text, start + 1, "img")) {
    const endGt = findHtmlTagEndMemo(text, start, memo);
    if (endGt === -1) return null;
    return {
      start,
      end: endGt + 1,
      original: text.slice(start, endGt + 1),
      kind: "html_img",
    };
  }

  // Paired media/wrapper tags (<figure>, <picture>, <video>, <audio>)
  for (const tag of PAIRED_MEDIA_TAGS) {
    if (!matchTagNameAt(text, start + 1, tag)) continue;
    const blockEnd = getPairedBlockMap(text, tag, memo).get(start);
    if (blockEnd === undefined) return null;
    return {
      start,
      end: blockEnd,
      original: text.slice(start, blockEnd),
      kind: PAIRED_KIND_MAP[tag],
    };
  }

  return null;
}

/**
 * Scans a Markdown image `![alt](url)` (with optional angle-bracket URL,
 * balanced parentheses inside URL, and optional title) starting at `start`
 * in amortized O(1) / linear total time.
 */
function scanMarkdownImageAt(
  text: string,
  start: number,
  memo: MediaScanMemo,
): RawMediaMatch | null {
  if (text[start] !== "!" || text[start + 1] !== "[") return null;

  const closeBracket = getBracketPairMap(text, memo).get(start + 1);
  if (closeBracket === undefined) return null;

  const openParen = closeBracket + 1;
  if (text[openParen] !== "(") return null;
  if (openParen >= memo.noCloseParenFrom) return null;

  const nextParen = text.indexOf(")", openParen + 1);
  if (nextParen === -1) {
    memo.noCloseParenFrom = Math.min(memo.noCloseParenFrom, openParen);
    return null;
  }

  // Scan destination + optional title inside `(...)`
  let cursor = openParen + 1;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
    cursor += 1;
  }
  if (cursor >= text.length || text[cursor] === ")") {
    return null;
  }

  if (text[cursor] === "<") {
    // Angle-bracketed destination `<url with spaces>`
    cursor += 1;
    let foundCloseAngle = false;
    while (cursor < text.length) {
      const ch = text[cursor]!;
      if (ch === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (ch === "\n" || ch === "\r") return null;
      if (ch === ">") {
        foundCloseAngle = true;
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    if (!foundCloseAngle) return null;
  } else {
    // Standard destination supporting balanced parentheses
    let parenDepth = 0;
    const destStart = cursor;
    while (cursor < text.length) {
      const ch = text[cursor]!;
      if (ch === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (ch === "\n" || ch === "\r") return null;
      if (ch === "(") {
        parenDepth += 1;
        cursor += 1;
        continue;
      }
      if (ch === ")") {
        if (parenDepth === 0) break;
        parenDepth -= 1;
        cursor += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        break;
      }
      cursor += 1;
    }
    if (cursor === destStart || parenDepth !== 0) return null;
  }

  // Skip optional whitespace before title or `)`
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
    cursor += 1;
  }

  // Optional quoted/parenthesized title
  if (cursor < text.length && text[cursor] !== ")") {
    const opener = text[cursor]!;
    const closer = opener === '"' ? '"' : opener === "'" ? "'" : opener === "(" ? ")" : null;
    if (!closer) return null;
    cursor += 1;
    let foundTitleClose = false;
    while (cursor < text.length) {
      const ch = text[cursor]!;
      if (ch === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (ch === "\n" && text[cursor + 1] === "\n") return null;
      if (ch === closer) {
        foundTitleClose = true;
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    if (!foundTitleClose) return null;
    while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
      cursor += 1;
    }
  }

  if (text[cursor] !== ")") return null;

  return {
    start,
    end: cursor + 1,
    original: text.slice(start, cursor + 1),
    kind: "markdown_image",
  };
}

function scanAllMediaMatches(text: string): RawMediaMatch[] {
  const matches: RawMediaMatch[] = [];
  const memo = createMediaScanMemo();
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "<") {
      if (text.startsWith("<!--", i)) {
        const commentEnd = text.indexOf("-->", i + 4);
        if (commentEnd === -1) break;
        i = commentEnd + 3;
        continue;
      }
      const htmlMatch = scanHtmlMediaAt(text, i, memo);
      if (htmlMatch) {
        matches.push(htmlMatch);
        i = htmlMatch.end;
        continue;
      }
    } else if (ch === "!" && text[i + 1] === "[") {
      const mdMatch = scanMarkdownImageAt(text, i, memo);
      if (mdMatch) {
        matches.push(mdMatch);
        i = mdMatch.end;
        continue;
      }
    }
    i += 1;
  }
  return matches;
}

function findProseBounds(
  text: string,
  matches: readonly RawMediaMatch[],
): { firstProseIndex: number; lastProseIndex: number } {
  let firstProseIndex = -1;
  let lastProseIndex = -1;

  let cursor = 0;
  for (const match of matches) {
    for (let i = cursor; i < match.start; i += 1) {
      if (!/\s/.test(text[i]!)) {
        if (firstProseIndex === -1) firstProseIndex = i;
        lastProseIndex = i;
      }
    }
    cursor = match.end;
  }
  for (let i = cursor; i < text.length; i += 1) {
    if (!/\s/.test(text[i]!)) {
      if (firstProseIndex === -1) firstProseIndex = i;
      lastProseIndex = i;
    }
  }

  return { firstProseIndex, lastProseIndex };
}

/**
 * Returns true if `text` contains any supported Markdown image or HTML media block.
 */
export function hasMediaContent(text: string): boolean {
  if (!text) return false;
  return scanAllMediaMatches(text).length > 0;
}

/**
 * Extracts Markdown images (`![alt](url)`) and HTML media blocks (`<img>`,
 * `<video>...</video>`, `<audio>...</audio>`, `<picture>...</picture>`,
 * `<figure>...</figure>`) into numbered `[[MEDIA_1]]`, `[[MEDIA_2]]` placeholders,
 * preserving each slot's exact original markup and relative position.
 */
export function extractMediaSlots(text: string): ExtractMediaSlotsResult {
  if (!text) {
    return { text: "", slots: [], hasMedia: false };
  }

  const matches = scanAllMediaMatches(text);
  if (matches.length === 0) {
    return { text, slots: [], hasMedia: false };
  }

  const { firstProseIndex, lastProseIndex } = findProseBounds(text, matches);
  const slots: MediaSlot[] = [];
  const parts: string[] = [];
  let cursor = 0;

  for (let idx = 0; idx < matches.length; idx += 1) {
    const match = matches[idx]!;
    const slotNumber = idx + 1;
    const token = `[[MEDIA_${slotNumber}]]`;

    let position: MediaSlotPosition;
    if (firstProseIndex === -1 || match.end <= firstProseIndex) {
      position = "leading";
    } else if (match.start > lastProseIndex) {
      position = "trailing";
    } else {
      position = "inline";
    }

    slots.push({
      index: slotNumber,
      token,
      original: match.original,
      position,
      kind: match.kind,
    });

    parts.push(text.slice(cursor, match.start));
    parts.push(token);
    cursor = match.end;
  }

  parts.push(text.slice(cursor));

  return {
    text: parts.join(""),
    slots,
    hasMedia: true,
  };
}

const MEDIA_PLACEHOLDER_RE = /\[\[\s*MEDIA_(\d+)\s*\]\]/gi;

function countNonOverlappingOccurrences(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  let count = 0;
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, pos);
    if (found === -1) break;
    count += 1;
    pos = found + needle.length;
  }
  return count;
}

/**
 * Restores extracted media placeholders back into `rewrittenText` byte-for-byte
 * and returns a detailed restoration report. Any slot omitted by the LLM is
 * safely re-anchored (leading slots prepended at the top, inline/trailing slots
 * appended at the bottom) so zero media is ever lost or altered.
 */
export function restoreMediaSlotsWithReport(
  rewrittenText: string,
  slots: readonly MediaSlot[],
): RestoreMediaSlotsReport {
  if (slots.length === 0) {
    return { text: rewrittenText, restoredTokens: [], reanchoredTokens: [] };
  }

  const slotByIndex = new Map<number, MediaSlot>();
  for (const slot of slots) {
    slotByIndex.set(slot.index, slot);
  }

  const restoredIndices = new Set<number>();
  const restoredTokens: string[] = [];

  const replaced = rewrittenText.replace(MEDIA_PLACEHOLDER_RE, (fullMatch, rawNum: string) => {
    const num = Number.parseInt(rawNum, 10);
    const slot = slotByIndex.get(num);
    if (!slot) {
      return fullMatch;
    }
    if (restoredIndices.has(num)) {
      // Avoid duplicating media if an LLM repeated the placeholder token
      return "";
    }
    restoredIndices.add(num);
    restoredTokens.push(slot.token);
    return slot.original;
  });

  // Count verbatim occurrences present in the LLM's raw output BEFORE placeholder splicing,
  // so duplicate byte-identical media blocks still re-anchor properly when one slot is omitted.
  const remainingVerbatimCounts = new Map<string, number>();
  const omittedLeading: MediaSlot[] = [];
  const omittedTrailing: MediaSlot[] = [];
  const reanchoredTokens: string[] = [];

  for (const slot of slots) {
    if (restoredIndices.has(slot.index)) continue;

    let verbatimRemaining = remainingVerbatimCounts.get(slot.original);
    if (verbatimRemaining === undefined) {
      verbatimRemaining = countNonOverlappingOccurrences(rewrittenText, slot.original);
    }
    if (verbatimRemaining > 0) {
      remainingVerbatimCounts.set(slot.original, verbatimRemaining - 1);
      restoredIndices.add(slot.index);
      restoredTokens.push(slot.token);
      continue;
    }
    remainingVerbatimCounts.set(slot.original, 0);

    reanchoredTokens.push(slot.token);
    if (slot.position === "leading") {
      omittedLeading.push(slot);
    } else {
      omittedTrailing.push(slot);
    }
  }

  let output = replaced;

  if (omittedLeading.length > 0) {
    const prefix = omittedLeading.map((s) => s.original).join("\n");
    const trimmedBody = output.replace(/^\s+/, "");
    output = trimmedBody.length > 0 ? `${prefix}\n\n${trimmedBody}` : prefix;
  }

  if (omittedTrailing.length > 0) {
    const suffix = omittedTrailing.map((s) => s.original).join("\n");
    const trimmedBody = output.replace(/\s+$/, "");
    output = trimmedBody.length > 0 ? `${trimmedBody}\n\n${suffix}` : suffix;
  }

  return {
    text: output,
    restoredTokens,
    reanchoredTokens,
  };
}

/**
 * Restores extracted media placeholders back into `rewrittenText` byte-for-byte,
 * safely re-anchoring any slots omitted by the LLM (leading slots prepended at
 * top, remaining slots appended at bottom).
 */
export function restoreMediaSlots(
  rewrittenText: string,
  slots: readonly MediaSlot[],
): string {
  return restoreMediaSlotsWithReport(rewrittenText, slots).text;
}

const RESIDUAL_MEDIA_TAG_RE = /<\/?(?:img|video|audio|source|track|picture|figure)\b[^>]*>/gi;

/**
 * Removes all Markdown image links and HTML media blocks/tags so background
 * steering prompts never leak raw media URLs or HTML tags into buildup turns.
 */
export function stripMediaForSteering(text: string): string {
  if (!text) return "";

  const { text: slotted, hasMedia } = extractMediaSlots(text);
  let cleaned = hasMedia ? slotted.replace(MEDIA_PLACEHOLDER_RE, "") : text;

  // Strip any stray/unclosed residual HTML media tags as a safety net
  cleaned = cleaned.replace(RESIDUAL_MEDIA_TAG_RE, "");

  // Clean up whitespace artifacts left behind by removed media lines
  cleaned = cleaned
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}
