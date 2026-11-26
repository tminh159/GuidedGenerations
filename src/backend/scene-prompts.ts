import type { LlmMessageDTO } from "lumiverse-spindle-types";
import {
  DEFAULT_GUIDANCE_POSITION,
  DEFAULT_SCENE_ADAPT_TEMPLATE,
  DEFAULT_SCENE_BRIDGE_TEMPLATE,
  DEFAULT_SCENE_CONTEXT_TURNS,
  DEFAULT_SCENE_READINESS_TAG,
  DEFAULT_SCENE_STEERING_TEMPLATE,
  DEFAULT_SCENE_SUMMARY_TEMPLATE,
  normalizeGuidanceDepth,
  normalizeSceneContextTurns,
  normalizeSceneGuidancePosition,
  normalizeSceneReadinessTag,
} from "../shared/defaults";
import type {
  ArmedSceneState,
  GuidanceInjectionRole,
  GuidedSceneConfig,
  GuidedSceneContextMode,
  GuidedSceneDelivery,
  SceneGuidancePosition,
} from "../shared/types";
import {
  type AssembledLlmMessageDTO,
  injectGuidanceMessage,
  stripInternalMessageMarkers,
} from "./prompt-builder";
import { stripMediaForSteering } from "./scene-media";

export interface GreetingMacroNames {
  charName?: string | null;
  userName?: string | null;
}

export interface SteeringDirectiveOptions extends GreetingMacroNames {
  maxExcerptChars?: number;
}

export interface InjectSceneDirectiveResult {
  messages: AssembledLlmMessageDTO[];
  injectedIndex: number;
  appliedPosition: SceneGuidancePosition;
}

export type SceneRewriteMode = "context_adapt" | "summary_rewrite" | "verbatim_bridge";

export interface SceneLightweightCharacter {
  name?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
}

export interface SceneLightweightPersona {
  name?: string | null;
  description?: string | null;
}

export interface SceneHistoryTurn {
  role: "user" | "assistant" | "system";
  name?: string | null;
  content: string;
}

export interface BuildRewriteMessagesInput {
  mode: SceneRewriteMode;
  contextMode: GuidedSceneContextMode;
  delivery: GuidedSceneDelivery;
  /** Target scene text (already macro-resolved, and media-slotted when `keepMediaIntact` is on). */
  targetSceneText: string;
  hasMediaSlots?: boolean;
  mediaSlotTokens?: readonly string[];
  transitionNote?: string;
  customDirection?: string;
  config?: Partial<
    Pick<
      GuidedSceneConfig,
      "adaptTemplate" | "summaryTemplate" | "bridgeTemplate" | "contextTurns"
    >
  >;
  names?: GreetingMacroNames;
  character?: SceneLightweightCharacter | null;
  persona?: SceneLightweightPersona | null;
  recentHistory?: readonly SceneHistoryTurn[];
  presetMessages?: readonly AssembledLlmMessageDTO[];
  presetIsChatHistory?: readonly boolean[];
}

interface ReadinessTagSpan {
  start: number;
  end: number;
}

function isTagNameBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

/**
 * Finds the closing `>` of an HTML/XML tag starting at `openPos`, respecting
 * quoted attributes so `>` inside an attribute value does not terminate early.
 */
function findReadinessTagGt(content: string, openPos: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = openPos + 1; i < content.length; i += 1) {
    const ch = content[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

function isSelfClosingReadinessTag(
  content: string,
  openPos: number,
  gtPos: number,
): boolean {
  let j = gtPos - 1;
  while (j > openPos && /\s/.test(content[j]!)) {
    j -= 1;
  }
  return j > openPos && content[j] === "/";
}

/**
 * Finds the next valid closing tag `</tagName>` at or after `fromPos` in linear
 * time, returning its `[start, end)` range or `null` if none exists.
 */
function findNextClosingTag(
  lower: string,
  closeNeedle: string,
  fromPos: number,
): { start: number; end: number } | null {
  let cursor = fromPos;
  while (cursor < lower.length) {
    const idx = lower.indexOf(closeNeedle, cursor);
    if (idx === -1) return null;
    let p = idx + closeNeedle.length;
    while (p < lower.length && /\s/.test(lower[p]!)) {
      p += 1;
    }
    if (lower[p] === ">") {
      return { start: idx, end: p + 1 };
    }
    cursor = idx + closeNeedle.length;
  }
  return null;
}

/**
 * Finds the next valid opening tag `<tagName...` at or after `fromPos` (matching
 * tag-name boundary), returning its index or `-1`.
 */
function findNextOpeningTagIndex(
  lower: string,
  openNeedle: string,
  fromPos: number,
): number {
  let cursor = fromPos;
  while (cursor < lower.length) {
    const idx = lower.indexOf(openNeedle, cursor);
    if (idx === -1) return -1;
    if (isTagNameBoundary(lower[idx + openNeedle.length])) {
      return idx;
    }
    cursor = idx + openNeedle.length;
  }
  return -1;
}

/**
 * Locates all readiness handoff tag spans in strict O(N) time with cleanly
 * separated self-closing (`<tag />`), paired (`<tag>...</tag>`), and bare
 * (`<tag>`) handling. Self-closing tags never swallow prose up to a later
 * closing tag, and unclosed tags never cause O(N²) backtracking.
 */
function findReadinessTagSpans(
  content: string,
  tagName?: string,
): ReadinessTagSpan[] {
  if (!content) return [];
  const safeTag = normalizeSceneReadinessTag(tagName, DEFAULT_SCENE_READINESS_TAG);
  const lowerTag = safeTag.toLowerCase();
  const openNeedle = `<${lowerTag}`;
  const closeNeedle = `</${lowerTag}`;
  const lower = content.toLowerCase();

  const firstOpen = findNextOpeningTagIndex(lower, openNeedle, 0);
  if (firstOpen === -1) return [];

  const spans: ReadinessTagSpan[] = [];
  let cursor = firstOpen;
  let noMoreCloseTags = false;
  let cachedNextClose: { start: number; end: number } | null | undefined = undefined;

  while (cursor < content.length) {
    const openIdx =
      cursor === firstOpen
        ? firstOpen
        : findNextOpeningTagIndex(lower, openNeedle, cursor);
    if (openIdx === -1) break;

    const gtPos = findReadinessTagGt(content, openIdx);
    if (gtPos === -1) {
      // No closing `>` exists anywhere in the remaining text — stop immediately (O(N)).
      break;
    }

    const openEnd = gtPos + 1;

    // Branch 1: self-closing `<tag ... />` — atomic, never pairs with a later `</tag>`
    if (isSelfClosingReadinessTag(content, openIdx, gtPos)) {
      spans.push({ start: openIdx, end: openEnd });
      cursor = openEnd;
      continue;
    }

    // Branch 2: paired `<tag ...>...</tag>` when a closing tag appears before any next `<tag`
    if (!noMoreCloseTags) {
      if (!cachedNextClose || cachedNextClose.start < openEnd) {
        cachedNextClose = findNextClosingTag(lower, closeNeedle, openEnd);
        if (cachedNextClose === null) {
          noMoreCloseTags = true;
        }
      }

      if (cachedNextClose !== null) {
        const nextOpenAfter = findNextOpeningTagIndex(lower, openNeedle, openEnd);
        if (nextOpenAfter === -1 || cachedNextClose.start < nextOpenAfter) {
          spans.push({ start: openIdx, end: cachedNextClose.end });
          cursor = cachedNextClose.end;
          cachedNextClose = undefined;
          continue;
        }
      }
    }

    // Branch 3: bare unclosed `<tag ...>`
    spans.push({ start: openIdx, end: openEnd });
    cursor = openEnd;
  }

  return spans;
}

/**
 * Returns true if `content` contains the readiness handoff tag (self-closing
 * `<scene-ready />`, paired `<scene-ready>...</scene-ready>`, or bare
 * `<scene-ready>`), matching case- and whitespace-insensitively in linear time.
 */
export function hasReadinessTag(
  content: string,
  tagName: string = DEFAULT_SCENE_READINESS_TAG,
): boolean {
  if (!content) return false;
  return findReadinessTagSpans(content, tagName).length > 0;
}

/**
 * Strips all occurrences of the readiness handoff tag (self-closing, paired,
 * or bare) from `content` and cleans up leftover blank lines and trailing
 * whitespace without damaging the remaining prose formatting.
 */
export function stripReadinessTag(
  content: string,
  tagName: string = DEFAULT_SCENE_READINESS_TAG,
): string {
  if (!content) return "";
  const spans = findReadinessTagSpans(content, tagName);
  if (spans.length === 0) return content;

  // Expand spans that occupy an entire line on their own to absorb their line break cleanly
  const expanded: ReadinessTagSpan[] = [];
  for (const span of spans) {
    let start = span.start;
    let end = span.end;

    // Check horizontal whitespace back to start of line
    let lineStart = start;
    while (lineStart > 0 && (content[lineStart - 1] === " " || content[lineStart - 1] === "\t")) {
      lineStart -= 1;
    }
    const atLineStart = lineStart === 0 || content[lineStart - 1] === "\n";

    // Check horizontal whitespace forward to end of line
    let lineEnd = end;
    while (
      lineEnd < content.length &&
      (content[lineEnd] === " " || content[lineEnd] === "\t")
    ) {
      lineEnd += 1;
    }
    const atLineEnd =
      lineEnd === content.length ||
      content[lineEnd] === "\n" ||
      (content[lineEnd] === "\r" && content[lineEnd + 1] === "\n");

    if (atLineStart && atLineEnd) {
      if (lineStart > 0 && content[lineStart - 1] === "\n") {
        start = lineStart - 1;
        if (start > 0 && content[start - 1] === "\r") {
          start -= 1;
        }
        end = lineEnd;
      } else {
        start = lineStart;
        if (content[lineEnd] === "\r" && content[lineEnd + 1] === "\n") {
          end = lineEnd + 2;
        } else if (content[lineEnd] === "\n") {
          end = lineEnd + 1;
        } else {
          end = lineEnd;
        }
      }
    }

    const prev = expanded[expanded.length - 1];
    if (prev && start <= prev.end) {
      prev.end = Math.max(prev.end, end);
    } else {
      expanded.push({ start, end });
    }
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const span of expanded) {
    if (span.start > cursor) {
      parts.push(content.slice(cursor, span.start));
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }

  let cleaned = parts.join("");

  // Clean up inline spacing artifacts and excessive blank lines
  cleaned = cleaned
    .replace(/[ \t]{2,}/g, (match, offset: number, str: string) => {
      // Preserve intentional indentation at the start of a line
      const prev = offset > 0 ? str[offset - 1] : "\n";
      return prev === "\n" || prev === "\r" ? match : " ";
    })
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/(\r?\n){3,}/g, "\n\n")
    .replace(/^(?:\r?\n)+/, "")
    .replace(/(?:\s)+$/, "");

  return cleaned;
}

/**
 * Owner-aware `{{char}}` and `{{user}}` macro substitution helper.
 * Leaves macros untouched when the corresponding name is omitted or blank.
 */
export function resolveGreetingMacros(
  text: string,
  names: GreetingMacroNames = {},
): string {
  if (!text) return "";
  let result = text;
  const charName = typeof names.charName === "string" ? names.charName.trim() : "";
  const userName = typeof names.userName === "string" ? names.userName.trim() : "";

  if (charName) {
    result = result.replace(/\{\{\s*char\s*\}\}/gi, () => charName);
  }
  if (userName) {
    result = result.replace(/\{\{\s*user\s*\}\}/gi, () => userName);
  }
  return result;
}

function truncateExcerpt(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, Math.max(40, maxChars - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function replaceTemplateToken(template: string, token: string, value: string): string {
  if (!template.includes(token)) return template;
  return template.replaceAll(token, () => value);
}

/**
 * Renders concise, non-spoiling scene-steering guidance for an armed `next_turn`
 * or `multi_turn` scene. Automatically strips media URLs/HTML tags from the
 * target scene excerpt so raw media markup never leaks into steering turns.
 */
export function renderSteeringDirective(
  armed: ArmedSceneState,
  config: Partial<Pick<GuidedSceneConfig, "steeringTemplate" | "readinessTag">> = {},
  names: SteeringDirectiveOptions = {},
): string {
  const effectiveCharName =
    (typeof armed.speakerCharacterName === "string" && armed.speakerCharacterName.trim()) ||
    names.charName ||
    undefined;
  const effectiveUserName = names.userName || undefined;

  const resolvedRaw = resolveGreetingMacros(armed.rawGreetingText, {
    charName: effectiveCharName,
    userName: effectiveUserName,
  });
  const mediaStripped = stripMediaForSteering(resolvedRaw);
  const maxExcerptChars =
    typeof names.maxExcerptChars === "number" && Number.isFinite(names.maxExcerptChars)
      ? Math.max(80, Math.floor(names.maxExcerptChars))
      : 900;
  const targetExcerpt = mediaStripped
    ? truncateExcerpt(mediaStripped, maxExcerptChars)
    : armed.greetingLabel || "Upcoming target scene";

  const pacingInstruction =
    armed.pacing === "next_turn"
      ? "Bring the current exchange directly to the doorstep of the upcoming scene by the end of THIS reply so the scene can drop immediately next."
      : "Steer the narrative organically across turns toward the doorstep of the upcoming scene without rushing or abruptly jumping ahead. Only signal readiness once the characters and situation have naturally arrived at the threshold.";

  let deliveryInstruction: string;
  switch (armed.delivery) {
    case "cut":
      deliveryInstruction =
        "Delivery style: Hard Cut — wrap up the current moment cleanly without writing a transition into the upcoming scene.";
      break;
    case "time_skip":
      deliveryInstruction =
        "Delivery style: Time Skip — bring the current beat to a natural closing point so time can skip cleanly forward into the upcoming scene.";
      break;
    case "bridge":
      deliveryInstruction =
        "Delivery style: In-Scene Bridge — guide the characters and immediate action right up to the doorstep of the upcoming scene.";
      break;
  }

  const cleanNote = armed.transitionNote.trim();
  const transitionNoteLine = cleanNote ? `\nTransition note: ${cleanNote}` : "";

  const tagName = normalizeSceneReadinessTag(config.readinessTag, DEFAULT_SCENE_READINESS_TAG);
  const selfClosingTag = `<${tagName} />`;
  const readinessInstruction =
    armed.pacing === "next_turn"
      ? `When finished with this reply, append ${selfClosingTag} on its own line at the very end.`
      : `Do NOT output ${selfClosingTag} while still building up. Only when your reply has reached the immediate doorstep of the upcoming scene, append ${selfClosingTag} on its own line at the very end.`;

  const baseTemplate =
    typeof config.steeringTemplate === "string" && config.steeringTemplate.trim().length > 0
      ? config.steeringTemplate.trim()
      : DEFAULT_SCENE_STEERING_TEMPLATE;

  let rendered = baseTemplate;
  rendered = replaceTemplateToken(rendered, "{{pacing_instruction}}", pacingInstruction);
  rendered = replaceTemplateToken(rendered, "{{delivery_instruction}}", deliveryInstruction);
  rendered = replaceTemplateToken(rendered, "{{transition_note}}", transitionNoteLine);
  rendered = replaceTemplateToken(rendered, "{{target_scene}}", targetExcerpt);
  rendered = replaceTemplateToken(rendered, "{{readiness_instruction}}", readinessInstruction);
  rendered = replaceTemplateToken(rendered, "{{readiness_tag}}", selfClosingTag);
  rendered = replaceTemplateToken(rendered, "{{readiness_tag_name}}", tagName);
  rendered = resolveGreetingMacros(rendered, {
    charName: effectiveCharName,
    userName: effectiveUserName,
  });

  // Safety net: ensure a custom template that omitted readiness placeholders still conveys the tag
  if (!rendered.toLowerCase().includes(`<${tagName.toLowerCase()}`)) {
    rendered = `${rendered}\n${readinessInstruction}`;
  }

  return rendered.replace(/\n{3,}/g, "\n\n").trim();
}

function isNonEmptyLlmMessage(msg: AssembledLlmMessageDTO | undefined): boolean {
  if (!msg) return false;
  if (typeof msg.content === "string") {
    return msg.content.trim().length > 0;
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some((part) => {
      if (part.type === "text") {
        return typeof part.text === "string" && part.text.trim().length > 0;
      }
      return true;
    });
  }
  return false;
}

function appendOocNoteToContent(
  content: LlmMessageDTO["content"],
  oocBlock: string,
): LlmMessageDTO["content"] {
  if (typeof content === "string") {
    return `${content.replace(/\s+$/, "")}\n\n${oocBlock}`;
  }
  if (Array.isArray(content)) {
    return [...content, { type: "text" as const, text: `\n\n${oocBlock}` }];
  }
  return oocBlock;
}

function findLatestHistoryIndex(
  messages: readonly AssembledLlmMessageDTO[],
  isChatHistory?: readonly boolean[],
): number {
  const hasFlags = Array.isArray(isChatHistory) && isChatHistory.length === messages.length;
  if (hasFlags) {
    for (let i = isChatHistory!.length - 1; i >= 0; i -= 1) {
      if (isChatHistory![i]) {
        return i;
      }
    }
    return -1;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "assistant" && msg.partial === true) continue;
    if (msg.role === "user" || msg.role === "assistant") {
      return i;
    }
  }
  return -1;
}

const EXISTING_MSG_MARKER = Symbol("gg_existing_msg");

/**
 * Injects a Guided Scene steering directive into an assembled LLM message list.
 * Supports all 4 Guided Generations positions (`before_post_history`,
 * `in_history`, `pre_history`, `post_history`) PLUS `append_last_user`
 * (appends `(OOC: <directive> Do not reply to this note.)` to the latest
 * non-empty user chat-history turn, falling back cleanly to
 * `before_post_history` if the latest history message is not a user message,
 * such as consecutive AI turns in a group chat).
 */
export function injectSceneDirective(
  messages: readonly AssembledLlmMessageDTO[],
  directive: string | null,
  role: GuidanceInjectionRole,
  position: SceneGuidancePosition = DEFAULT_GUIDANCE_POSITION,
  depth = 0,
  isChatHistory?: readonly boolean[],
): InjectSceneDirectiveResult {
  const normalizedPosition = normalizeSceneGuidancePosition(
    position,
    DEFAULT_GUIDANCE_POSITION,
  );
  const cleanDirective = typeof directive === "string" ? directive.trim() : "";

  if (!cleanDirective) {
    return {
      messages: messages.map((msg) => ({ ...msg })),
      injectedIndex: -1,
      appliedPosition: normalizedPosition,
    };
  }

  if (normalizedPosition === "append_last_user") {
    const latestHistoryIdx = findLatestHistoryIndex(messages, isChatHistory);
    const latestMsg = latestHistoryIdx >= 0 ? messages[latestHistoryIdx] : undefined;

    if (latestMsg && latestMsg.role === "user" && isNonEmptyLlmMessage(latestMsg)) {
      const oocBlock = `(OOC: ${cleanDirective} Do not reply to this note.)`;
      const copy = messages.map((msg, idx) =>
        idx === latestHistoryIdx
          ? {
              ...msg,
              content: appendOocNoteToContent(msg.content, oocBlock),
            }
          : { ...msg },
      );
      return {
        messages: copy,
        injectedIndex: latestHistoryIdx,
        appliedPosition: "append_last_user",
      };
    }

    // Fallback cleanly to `before_post_history` when latest history turn isn't a non-empty user turn
    return injectStandardPosition(
      messages,
      cleanDirective,
      role,
      "before_post_history",
      depth,
      isChatHistory,
    );
  }

  return injectStandardPosition(
    messages,
    cleanDirective,
    role,
    normalizedPosition,
    depth,
    isChatHistory,
  );
}

function injectStandardPosition(
  messages: readonly AssembledLlmMessageDTO[],
  cleanDirective: string,
  role: GuidanceInjectionRole,
  position: Exclude<SceneGuidancePosition, "append_last_user">,
  depth: number,
  isChatHistory?: readonly boolean[],
): InjectSceneDirectiveResult {
  type MarkedMsg = AssembledLlmMessageDTO & { [EXISTING_MSG_MARKER]?: true };
  const markedInput: MarkedMsg[] = messages.map((msg) => ({
    ...msg,
    [EXISTING_MSG_MARKER]: true,
  }));

  const injectedList = injectGuidanceMessage(markedInput, cleanDirective, role, {
    guidancePosition: position,
    guidanceDepth: normalizeGuidanceDepth(depth, 0),
    isChatHistory,
  }) as MarkedMsg[];

  let injectedIndex = -1;
  const cleanOutput: AssembledLlmMessageDTO[] = injectedList.map((msg, idx) => {
    if (!msg[EXISTING_MSG_MARKER]) {
      injectedIndex = idx;
      return { ...msg };
    }
    const clone = { ...msg };
    delete clone[EXISTING_MSG_MARKER];
    return clone;
  });

  return {
    messages: cleanOutput,
    injectedIndex,
    appliedPosition: position,
  };
}

function buildDeliveryGuidanceText(
  delivery: GuidedSceneDelivery,
  transitionNote?: string,
): string {
  const note = typeof transitionNote === "string" ? transitionNote.trim() : "";
  const noteSuffix = note ? ` Transition note: ${note}` : "";

  switch (delivery) {
    case "time_skip":
      return `\nTransition style: Time Skip — convey a natural passage of time from the recent conversation into this scene.${noteSuffix}`;
    case "bridge":
      return `\nTransition style: In-Scene Bridge — connect smoothly from the immediately preceding moment into this scene.${noteSuffix}`;
    case "cut":
      return note ? `\nTransition note: ${note}` : "";
  }
}

function buildMediaInstructionText(
  hasMediaSlots: boolean,
  mediaSlotTokens?: readonly string[],
): string {
  if (!hasMediaSlots) return "";
  const tokenHint =
    Array.isArray(mediaSlotTokens) && mediaSlotTokens.length > 0
      ? ` (${mediaSlotTokens.join(", ")})`
      : " (such as [[MEDIA_1]])";
  return `\nMedia preservation (REQUIRED): The target scene contains media placeholder tokens${tokenHint}. Keep EVERY placeholder token verbatim in an appropriate place in your output. Do not alter, rename, wrap in code fences, or omit any [[MEDIA_N]] token.`;
}

function renderRewriteInstructions(input: BuildRewriteMessagesInput): string {
  let template: string;
  switch (input.mode) {
    case "context_adapt":
      template =
        input.config?.adaptTemplate?.trim() || DEFAULT_SCENE_ADAPT_TEMPLATE;
      break;
    case "summary_rewrite":
      template =
        input.config?.summaryTemplate?.trim() || DEFAULT_SCENE_SUMMARY_TEMPLATE;
      break;
    case "verbatim_bridge":
      template =
        input.config?.bridgeTemplate?.trim() || DEFAULT_SCENE_BRIDGE_TEMPLATE;
      break;
  }

  const deliveryGuidance = buildDeliveryGuidanceText(input.delivery, input.transitionNote);
  const cleanDirection =
    typeof input.customDirection === "string" ? input.customDirection.trim() : "";
  const customDirectionBlock = cleanDirection
    ? `\nAdditional user direction: ${cleanDirection}`
    : "";
  const includeMediaInstructions =
    Boolean(input.hasMediaSlots) && input.mode !== "verbatim_bridge";
  const mediaInstructions = buildMediaInstructionText(
    includeMediaInstructions,
    input.mediaSlotTokens,
  );

  const hadDirectionToken = template.includes("{{custom_direction}}");
  const hadMediaToken = template.includes("{{media_instructions}}");

  let rendered = template;
  rendered = replaceTemplateToken(rendered, "{{delivery_guidance}}", deliveryGuidance);
  rendered = replaceTemplateToken(rendered, "{{custom_direction}}", customDirectionBlock);
  rendered = replaceTemplateToken(rendered, "{{media_instructions}}", mediaInstructions);
  rendered = replaceTemplateToken(
    rendered,
    "{{transition_note}}",
    input.transitionNote?.trim() ?? "",
  );
  rendered = resolveGreetingMacros(rendered, input.names);

  if (customDirectionBlock && !hadDirectionToken) {
    rendered = `${rendered}${customDirectionBlock}`;
  }
  if (mediaInstructions && !hadMediaToken) {
    rendered = `${rendered}${mediaInstructions}`;
  }

  return rendered.replace(/\n{3,}/g, "\n\n").trim();
}

function buildFinalModeCue(mode: SceneRewriteMode): string {
  switch (mode) {
    case "context_adapt":
      return "Write the adapted scene opening now.";
    case "summary_rewrite":
      return "Write the rewritten scene opening now.";
    case "verbatim_bridge":
      return "Write ONLY the brief transitional bridge now (1 to 3 sentences, no scene divider, do not repeat or rewrite the target scene).";
  }
}

function formatLightweightCharacterBlock(
  character: SceneLightweightCharacter | null | undefined,
): string {
  if (!character) return "";
  const lines: string[] = [];
  if (character.name?.trim()) lines.push(`Name: ${character.name.trim()}`);
  if (character.description?.trim()) {
    lines.push(`Description: ${truncateExcerpt(character.description, 1800)}`);
  }
  if (character.personality?.trim()) {
    lines.push(`Personality: ${truncateExcerpt(character.personality, 800)}`);
  }
  if (character.scenario?.trim()) {
    lines.push(`Scenario: ${truncateExcerpt(character.scenario, 800)}`);
  }
  return lines.length > 0 ? `### Character\n${lines.join("\n")}` : "";
}

function formatLightweightPersonaBlock(
  persona: SceneLightweightPersona | null | undefined,
): string {
  if (!persona) return "";
  const lines: string[] = [];
  if (persona.name?.trim()) lines.push(`Name: ${persona.name.trim()}`);
  if (persona.description?.trim()) {
    lines.push(`Description: ${truncateExcerpt(persona.description, 1000)}`);
  }
  return lines.length > 0 ? `### User Persona\n${lines.join("\n")}` : "";
}

function formatRecentHistoryBlock(
  history: readonly SceneHistoryTurn[] | undefined,
  maxTurns: number,
  names?: GreetingMacroNames,
): string {
  if (!Array.isArray(history) || history.length === 0) return "";
  const nonEmpty = history.filter((turn) => typeof turn.content === "string" && turn.content.trim().length > 0);
  const sliced = nonEmpty.slice(-maxTurns);
  if (sliced.length === 0) return "";

  const defaultChar = names?.charName?.trim() || "Character";
  const defaultUser = names?.userName?.trim() || "User";

  const formattedTurns = sliced.map((turn) => {
    const label =
      turn.name?.trim() ||
      (turn.role === "user"
        ? defaultUser
        : turn.role === "assistant"
          ? defaultChar
          : "System");
    return `${label}: ${turn.content.trim()}`;
  });

  return `### Recent Conversation (last ${sliced.length} ${sliced.length === 1 ? "turn" : "turns"})\n${formattedTurns.join("\n\n")}`;
}

/**
 * Builds the LLM message list for `context_adapt`, `summary_rewrite`, or
 * `verbatim_bridge` (Drop Now + Verbatim + Time Skip/Bridge), supporting both
 * `lightweight` context (character + persona + last N turns) and `full_preset`
 * context (assembled preset stack + task injection).
 */
export function buildRewriteMessages(input: BuildRewriteMessagesInput): LlmMessageDTO[] {
  const instructions = renderRewriteInstructions(input);
  const finalCue = buildFinalModeCue(input.mode);
  const targetSectionLabel =
    input.mode === "verbatim_bridge"
      ? "### Upcoming Verbatim Scene Opening (for bridge context only — do NOT rewrite or repeat)"
      : "### Target Scene Opening";
  const targetTextForPrompt =
    input.mode === "verbatim_bridge"
      ? stripMediaForSteering(input.targetSceneText) || input.targetSceneText.trim()
      : input.targetSceneText.trim();

  if (input.contextMode === "full_preset" && Array.isArray(input.presetMessages) && input.presetMessages.length > 0) {
    const base = stripInternalMessageMarkers(input.presetMessages);
    const taskMessage: LlmMessageDTO = {
      role: "user",
      content: `${instructions}\n\n${targetSectionLabel}\n${targetTextForPrompt}\n\n${finalCue}`,
    };

    // Place before any trailing partial assistant prefill so prefill remains last if present
    const last = base[base.length - 1] as AssembledLlmMessageDTO | undefined;
    if (last && last.role === "assistant" && last.partial === true) {
      return [...base.slice(0, -1), taskMessage, last];
    }
    return [...base, taskMessage];
  }

  // Lightweight context mode (default, or graceful fallback when presetMessages are empty)
  const maxTurns = normalizeSceneContextTurns(
    input.config?.contextTurns,
    DEFAULT_SCENE_CONTEXT_TURNS,
  );
  const systemParts: string[] = [
    "You are an expert interactive fiction scene writer.",
    instructions,
  ];
  const charBlock = formatLightweightCharacterBlock(input.character);
  if (charBlock) systemParts.push(charBlock);
  const personaBlock = formatLightweightPersonaBlock(input.persona);
  if (personaBlock) systemParts.push(personaBlock);

  const userParts: string[] = [];
  const historyBlock = formatRecentHistoryBlock(input.recentHistory, maxTurns, input.names);
  if (historyBlock) userParts.push(historyBlock);
  userParts.push(`${targetSectionLabel}\n${targetTextForPrompt}`);
  userParts.push(finalCue);

  return [
    { role: "system", content: systemParts.join("\n\n") },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Combines a generated lead-in bridge paragraph with a verbatim scene opening,
 * preserving the verbatim scene text 100% untouched beneath a clean seam.
 */
export function combineBridgeAndVerbatimScene(
  bridgeText: string,
  verbatimScene: string,
  delivery: GuidedSceneDelivery,
): string {
  const cleanBridge = bridgeText
    .trim()
    .replace(/(?:\r?\n)+(?:---|___|\*\*\*)\s*$/, "")
    .trim();
  if (!cleanBridge) {
    return verbatimScene;
  }
  const separator = delivery === "time_skip" ? "\n\n---\n\n" : "\n\n";
  return `${cleanBridge}${separator}${verbatimScene}`;
}
