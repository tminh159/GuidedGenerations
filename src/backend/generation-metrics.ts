import type { SpindleAPI, TokenCountOptionsDTO } from "lumiverse-spindle-types";
import type { NativeGenerationMetrics } from "../shared/types";

export interface GenerationTimingSource {
  streamingStartedAt?: number;
  firstTokenAt?: number;
  firstContentTokenAt?: number;
  responseStoppedAt?: number;
  completedAt?: number;
  wasStreaming?: boolean;
}

export interface GenerationTimingMetrics {
  durationMs: number;
  wasStreaming: boolean;
  ttft?: number;
  tps?: number;
}

export interface GenerationTokenCounts {
  /** Authoritative generated-token count for message metadata. */
  messageTokenCount?: number;
  /** Visible response-token count used for response throughput. */
  responseTokenCount?: number;
}

export interface GenerationUsageInput {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  provider_raw?: Record<string, unknown>;
  completion_tokens_details?: Record<string, unknown>;
  output_tokens_details?: Record<string, unknown>;
}

export interface GenerationTokenCountOptions {
  hasReasoning?: boolean;
  /** Guided reasoning is counted as ordinary content by the provider. */
  hasDelimitedReasoning?: boolean;
  providerRaw?: Record<string, unknown>;
  usageDetailsContainer?: Record<string, unknown>;
}

/**
 * Matches Lumiverse's `resolveGenerationTokenCounts`. Provider completion usage
 * remains authoritative for message metadata, while TPS uses completion usage
 * minus reported reasoning tokens or falls back to local visible tokenization.
 */
export function resolveGenerationTokenCounts(
  providerCompletionTokenCount: unknown,
  calculatedTokenCounts: GenerationTokenCounts = {},
  options: GenerationTokenCountOptions = {},
): GenerationTokenCounts {
  const flooredProviderCount =
    typeof providerCompletionTokenCount === "number" &&
    Number.isFinite(providerCompletionTokenCount) &&
    providerCompletionTokenCount > 0
      ? Math.floor(providerCompletionTokenCount)
      : undefined;
  const normalizedProviderCount =
    flooredProviderCount != null && flooredProviderCount > 0
      ? flooredProviderCount
      : undefined;

  const details =
    options.providerRaw?.completion_tokens_details ??
    options.providerRaw?.output_tokens_details ??
    options.usageDetailsContainer?.completion_tokens_details ??
    options.usageDetailsContainer?.output_tokens_details;
  const reasoningTokenCount =
    typeof details === "object" && details !== null
      ? (details as Record<string, unknown>).reasoning_tokens ??
        (details as Record<string, unknown>).thinking_tokens
      : undefined;

  let providerResponseTokenCount: number | undefined;
  if (!options.hasDelimitedReasoning) {
    if (
      normalizedProviderCount != null &&
      typeof reasoningTokenCount === "number" &&
      Number.isInteger(reasoningTokenCount) &&
      reasoningTokenCount >= 0 &&
      reasoningTokenCount <= normalizedProviderCount
    ) {
      providerResponseTokenCount = normalizedProviderCount - reasoningTokenCount;
    } else if (!options.hasReasoning && reasoningTokenCount == null) {
      providerResponseTokenCount = normalizedProviderCount;
    }
  }

  return {
    messageTokenCount: normalizedProviderCount ?? calculatedTokenCounts.messageTokenCount,
    responseTokenCount: providerResponseTokenCount ?? calculatedTokenCounts.responseTokenCount,
  };
}

/**
 * Matches Lumiverse's `calculateGenerationTimingMetrics`. TTFT measures from
 * stream start to the first token (including reasoning); TPS measures visible
 * content tokens between the first non-whitespace content token and stream stop.
 */
export function calculateGenerationTimingMetrics(
  source: GenerationTimingSource,
  responseTokenCount?: number,
  observedAt = Date.now(),
): GenerationTimingMetrics {
  const wasStreaming = source.wasStreaming ?? true;
  const streamStart = source.streamingStartedAt;
  const responseEndedAt = source.completedAt ?? observedAt;
  const durationMs = streamStart ? Math.max(0, responseEndedAt - streamStart) : 0;

  let ttft: number | undefined;
  let tps: number | undefined;

  if (wasStreaming && streamStart) {
    if (source.firstTokenAt != null) {
      ttft = Math.max(0, source.firstTokenAt - streamStart);
    }

    if (
      source.firstContentTokenAt != null &&
      source.responseStoppedAt != null &&
      responseTokenCount &&
      responseTokenCount > 1
    ) {
      const responseDurationSec = (source.responseStoppedAt - source.firstContentTokenAt) / 1000;
      if (responseDurationSec > 0) {
        tps = Math.round((responseTokenCount / responseDurationSec) * 10) / 10;
      }
    }
  }

  return {
    durationMs,
    wasStreaming,
    ...(ttft != null ? { ttft } : {}),
    ...(tps != null ? { tps } : {}),
  };
}

/**
 * Best-effort token counting via `spindle.tokens.countText`. Never throws so
 * unavailable tokenizers or test stubs without `spindle.tokens` do not fail runs.
 */
export async function safeCountTokens(
  spindle: SpindleAPI,
  text: string,
  options?: { model?: string; userId?: string },
): Promise<number | undefined> {
  if (!text || text.length === 0) {
    return undefined;
  }
  const countText = spindle.tokens?.countText;
  if (typeof countText !== "function") {
    return undefined;
  }
  const dtoOptions: TokenCountOptionsDTO = {
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.userId ? { userId: options.userId } : {}),
  };
  try {
    const result = await countText.call(
      spindle.tokens,
      text,
      Object.keys(dtoOptions).length > 0 ? dtoOptions : undefined,
    );
    if (
      typeof result?.total_tokens === "number" &&
      Number.isFinite(result.total_tokens) &&
      result.total_tokens > 0
    ) {
      const floored = Math.floor(result.total_tokens);
      return floored > 0 ? floored : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort preset name lookup via `spindle.presets.get`, gated on `"presets"`
 * permission when present.
 */
export async function resolvePresetNameSafe(
  spindle: SpindleAPI,
  presetId: string | null | undefined,
  userId?: string,
): Promise<string | undefined> {
  const trimmedId = typeof presetId === "string" ? presetId.trim() : "";
  if (!trimmedId) {
    return undefined;
  }
  if (spindle.permissions?.has && !spindle.permissions.has("presets")) {
    return undefined;
  }
  const getPreset = spindle.presets?.get;
  if (typeof getPreset !== "function") {
    return undefined;
  }
  try {
    const preset = await getPreset.call(spindle.presets, trimmedId, userId);
    const name = typeof preset?.name === "string" ? preset.name.trim() : "";
    return name || undefined;
  } catch {
    return undefined;
  }
}

export async function buildGenerationMetricsPayload(args: {
  spindle: SpindleAPI;
  userId?: string;
  isContinue?: boolean;
  finalText: string;
  rawDeltaText: string;
  hasReasoning?: boolean;
  hasDelimitedReasoning?: boolean;
  usage?: GenerationUsageInput;
  timingSource: GenerationTimingSource;
  model?: string;
  provider?: string;
  presetId?: string | null;
  presetName?: string;
}): Promise<{
  tokenCount?: number;
  generationMetrics: NativeGenerationMetrics;
}> {
  const wasStreaming = args.timingSource.wasStreaming ?? true;
  const countOptions = {
    ...(args.model ? { model: args.model } : {}),
    ...(args.userId ? { userId: args.userId } : {}),
  };

  let resolvedTokenCount: number | undefined;
  let responseTokenCount: number | undefined;

  if (args.isContinue) {
    // Continue appends to an existing message, so the pill tokenCount reflects
    // the full combined message while TPS counts only the newly generated delta.
    const calculatedMessageTokenCount =
      args.finalText.length > 0
        ? await safeCountTokens(args.spindle, args.finalText, countOptions)
        : undefined;

    let calculatedResponseTokenCount: number | undefined;
    if (wasStreaming && /\S/.test(args.rawDeltaText)) {
      if (args.rawDeltaText === args.finalText) {
        calculatedResponseTokenCount = calculatedMessageTokenCount;
      } else {
        calculatedResponseTokenCount = await safeCountTokens(
          args.spindle,
          args.rawDeltaText,
          countOptions,
        );
      }
    }

    resolvedTokenCount = calculatedMessageTokenCount;
    responseTokenCount = calculatedResponseTokenCount;
  } else {
    const tokenCountOptions: GenerationTokenCountOptions = {
      hasReasoning: args.hasReasoning,
      hasDelimitedReasoning: args.hasDelimitedReasoning,
      providerRaw: args.usage?.provider_raw,
      usageDetailsContainer: args.usage as Record<string, unknown> | undefined,
    };

    const providerTokenCounts = resolveGenerationTokenCounts(
      args.usage?.completion_tokens,
      undefined,
      tokenCountOptions,
    );

    let calculatedMessageTokenCount: number | undefined;
    if (providerTokenCounts.messageTokenCount == null && args.finalText.length > 0) {
      calculatedMessageTokenCount = await safeCountTokens(
        args.spindle,
        args.finalText,
        countOptions,
      );
    }

    let calculatedResponseTokenCount: number | undefined;
    if (
      wasStreaming &&
      providerTokenCounts.responseTokenCount == null &&
      /\S/.test(args.rawDeltaText)
    ) {
      if (
        providerTokenCounts.messageTokenCount == null &&
        args.rawDeltaText === args.finalText
      ) {
        calculatedResponseTokenCount = calculatedMessageTokenCount;
      } else {
        calculatedResponseTokenCount = await safeCountTokens(
          args.spindle,
          args.rawDeltaText,
          countOptions,
        );
      }
    }

    const resolved = resolveGenerationTokenCounts(
      args.usage?.completion_tokens,
      {
        messageTokenCount: calculatedMessageTokenCount,
        responseTokenCount: calculatedResponseTokenCount,
      },
      tokenCountOptions,
    );
    resolvedTokenCount = resolved.messageTokenCount;
    responseTokenCount = resolved.responseTokenCount;
  }

  const timingMetrics = calculateGenerationTimingMetrics(
    args.timingSource,
    responseTokenCount,
  );

  const normalizedPresetId =
    typeof args.presetId === "string" && args.presetId.trim()
      ? args.presetId.trim()
      : undefined;
  const resolvedPresetName =
    (typeof args.presetName === "string" && args.presetName.trim()
      ? args.presetName.trim()
      : undefined) ??
    (normalizedPresetId
      ? await resolvePresetNameSafe(args.spindle, normalizedPresetId, args.userId)
      : undefined);

  const generationMetrics: NativeGenerationMetrics = {
    ...timingMetrics,
    ...(args.model ? { model: args.model } : {}),
    ...(args.provider ? { provider: args.provider } : {}),
    ...(normalizedPresetId ? { presetId: normalizedPresetId } : {}),
    ...(resolvedPresetName ? { presetName: resolvedPresetName } : {}),
  };

  return {
    ...(resolvedTokenCount != null ? { tokenCount: resolvedTokenCount } : {}),
    generationMetrics,
  };
}
