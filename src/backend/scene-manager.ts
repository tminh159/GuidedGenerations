import type {
  CharacterDTO,
  ChatAppendMessageDTO,
  ChatDTO,
  ConnectionProfileDTO,
  GenerationEndedPayloadDTO,
  GenerationRequestDTO,
  GenerationResponseDTO,
  GenerationStoppedPayloadDTO,
  InterceptorDisposer,
  LlmMessageDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import {
  DEFAULT_SCENE_READINESS_TAG,
  normalizeSceneAdjustmentMode,
  normalizeSceneArmedPacing,
  normalizeSceneDelivery,
  normalizeSceneDropTarget,
  normalizeSceneReadinessTag,
} from "../shared/defaults";
import type {
  ActiveRunState,
  ArmedSceneState,
  ArmSceneInput,
  BackendPushEvent,
  CloseDrawerResult,
  DropSceneNowInput,
  DropSceneNowResult,
  GuidedGenerationsSettings,
  GuidedSceneChatContext,
  GuidedSceneConfig,
  GuidedSceneDelivery,
  GuidedSceneDropTarget,
  GuidedSceneGreetingOption,
  GuidedSceneMember,
  PreviewSceneDraftInput,
  PreviewSceneDraftResult,
  TerminalRunSummary,
  UpdateArmedSceneInput,
} from "../shared/types";
import {
  buildGenerationMetricsPayload,
  type GenerationTimingSource,
  type GenerationUsageInput,
} from "./generation-metrics";
import type { InterceptorMux } from "./interceptor-mux";
import {
  type AssembledLlmMessageDTO,
  buildActiveSwipePatch,
  buildPresetContextMetadata,
  type ChatMessageWithRole,
  type DryRunRequestWithOverride,
  type DryRunResultWithRequestMessages,
  isAssistantMessage,
  mergeConsecutiveSameRoleMessages,
  normalizeMessageSwipes,
  resolveChatHistoryFlags,
  resolveEffectiveModelAndProvider,
  stripInternalMessageMarkers,
  stripRejectedSwipeAssistantTurnWithHistory,
} from "./prompt-builder";
import { fetchActiveRegexScripts, processResponseOutput } from "./regex-processor";
import {
  extractMediaSlots,
  hasMediaContent,
  type MediaSlot,
  restoreMediaSlots,
} from "./scene-media";
import {
  buildRewriteMessages,
  combineBridgeAndVerbatimScene,
  hasReadinessTag,
  injectSceneDirective,
  renderSteeringDirective,
  resolveGreetingMacros,
  type SceneHistoryTurn,
  type SceneLightweightCharacter,
  type SceneLightweightPersona,
  type SceneRewriteMode,
  stripReadinessTag,
} from "./scene-prompts";
import type { SettingsStore } from "./settings-store";

interface GenerationRequestWithSignal extends GenerationRequestDTO {
  provider?: string;
  model?: string;
  signal?: AbortSignal;
}

interface InternalSceneRun {
  state: ActiveRunState;
  controller: AbortController;
}

interface PendingSceneDryRunCapture {
  userId?: string;
  presetId?: string | null;
  capturedMessages?: AssembledLlmMessageDTO[];
}

const STREAM_FLUSH_INTERVAL_MS = 120;
const TERMINAL_RUN_MAX_ENTRIES = 20;
const TERMINAL_RUN_TTL_MS = 30 * 60_000;
const MAX_DROPPED_TRIGGER_KEYS = 200;
const MAX_OWN_DROP_IDS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function asGenerationResponse(raw: unknown): Partial<GenerationResponseDTO> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Partial<GenerationResponseDTO>;
}

function extractPresetStreamingOverride(
  preset: { parameters?: Record<string, unknown> } | null | undefined,
): boolean | undefined {
  const overrides = preset?.parameters?.samplerOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return undefined;
  }
  const streaming = (overrides as { streaming?: unknown }).streaming;
  return typeof streaming === "boolean" ? streaming : undefined;
}

function prepareOutboundGenerationInput(rawInput: GenerationRequestWithSignal): {
  wasStreaming: boolean;
  outboundInput: GenerationRequestWithSignal;
} {
  const params = rawInput.parameters;
  const wasStreaming = params?._streaming !== false;
  if (!params) {
    return { wasStreaming, outboundInput: rawInput };
  }
  const { _streaming: _omitted, ...sanitizedParameters } = params;
  return {
    wasStreaming,
    outboundInput: {
      ...rawInput,
      parameters: sanitizedParameters,
    },
  };
}

function makeGreetingPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 140) return collapsed;
  return `${collapsed.slice(0, 139).trimEnd()}…`;
}

/**
 * Replaces already-emitted `[[MEDIA_N]]` tokens in place during mid-stream
 * flushes without prematurely re-anchoring tokens that have not streamed yet.
 */
function previewRestoreEmittedMediaSlots(
  text: string,
  slots: readonly MediaSlot[],
): string {
  if (slots.length === 0) return text;
  const byIndex = new Map<number, string>();
  for (const slot of slots) {
    byIndex.set(slot.index, slot.original);
  }
  return text.replace(/\[\[\s*MEDIA_(\d+)\s*\]\]/gi, (full, rawNum: string) => {
    const idx = Number.parseInt(rawNum, 10);
    return byIndex.get(idx) ?? full;
  });
}

export class GuidedSceneManager {
  /** Per-user map of `chatId -> ArmedSceneState` (armed or paused). */
  private readonly armedByUser = new Map<string, Map<string, ArmedSceneState>>();
  /** Fast O(1) index of `chatId -> Set<userKey>` for chats with an armed/paused scene. */
  private readonly armedChatOwners = new Map<string, Set<string>>();
  /** Tracks which users have completed hydration from `active-scenes/*.json`. */
  private readonly hydratedUsers = new Set<string>();
  /** In-flight hydration promises per user so concurrent callers await instead of seeing `[]`. */
  private readonly hydrationInFlight = new Map<string, Promise<void>>();
  /** Tracks chatIds mutated/deleted during an in-flight hydration so stale reads cannot resurrect them. */
  private readonly mutatedDuringHydration = new Map<string, Set<string>>();
  /** Cached readiness tag per user. */
  private readonly readinessTagByUser = new Map<string, string>();
  /** Deduplication set of `(userKey, chatId, messageId, swipeId)` already dropped. */
  private readonly droppedTriggerKeys = new Set<string>();
  /** Shared synchronous per-`(userKey, chatId)` lock across `dropSceneNow` and armed handoffs. */
  private readonly inFlightDrops = new Set<string>();
  /** Message IDs created by Guided Scene itself so GENERATION_ENDED ignores them. */
  private readonly ownDropMessageIds = new Set<string>();

  private readonly activeRuns = new Map<string, Map<string, InternalSceneRun>>();
  private readonly previewControllers = new Map<string, Set<AbortController>>();
  private readonly recentTerminalRuns = new Map<string, TerminalRunSummary[]>();
  private readonly pendingDryRunCaptures = new Map<string, PendingSceneDryRunCapture>();
  private readonly chatDryRunQueues: Map<string, Promise<unknown>>;
  private readonly armedSceneLocks = new Map<string, Promise<unknown>>();

  private interceptorDisposer: InterceptorDisposer | null = null;
  private readonly lifecycleDisposers: Array<() => void> = [];
  private runCounter = 0;
  private disposed = false;

  constructor(
    private readonly spindle: SpindleAPI,
    private readonly store: SettingsStore,
    private readonly emitFrontend: (event: BackendPushEvent, userId?: string) => void,
    private readonly interceptorMux?: InterceptorMux,
    private readonly coordination?: {
      chatDryRunQueues?: Map<string, Promise<unknown>>;
      isExternalChatBusy?: (userId: string | undefined, chatId: string) => boolean;
    },
  ) {
    this.chatDryRunQueues =
      coordination?.chatDryRunQueues ?? new Map<string, Promise<unknown>>();
    this.registerGenerationLifecycleListeners();
  }

  private userKey(userId?: string): string {
    return typeof userId === "string" && userId.length > 0 ? userId : "__default__";
  }

  private compositeKey(userKey: string, chatId: string): string {
    return `${userKey}::${chatId}`;
  }

  private withArmedSceneLock<T>(
    userKey: string,
    chatId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = this.compositeKey(userKey, chatId);
    const prev = this.armedSceneLocks.get(lockKey) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    const tail = next.catch(() => undefined);
    this.armedSceneLocks.set(lockKey, tail);
    void tail.finally(() => {
      if (this.armedSceneLocks.get(lockKey) === tail) {
        this.armedSceneLocks.delete(lockKey);
      }
    });
    return next;
  }

  hasBusyChat(userId?: string, chatId?: string | null): boolean {
    const key = this.userKey(userId);
    const cleanChatId =
      typeof chatId === "string" && chatId.trim().length > 0 ? chatId.trim() : null;
    if (cleanChatId) {
      return (
        this.inFlightDrops.has(this.compositeKey(key, cleanChatId)) ||
        this.isChatRunning(key, cleanChatId)
      );
    }
    const prefix = `${key}::`;
    for (const dropKey of this.inFlightDrops) {
      if (dropKey.startsWith(prefix)) return true;
    }
    const userRuns = this.activeRuns.get(key);
    return Boolean(userRuns && userRuns.size > 0);
  }

  /**
   * Synchronous O(1) check used by lifecycle listeners to avoid overhead when idle.
   */
  hasArmedChat(chatId: string): boolean {
    const owners = this.armedChatOwners.get(chatId);
    return Boolean(owners && owners.size > 0);
  }

  hasAnyActiveArmedScene(): boolean {
    for (const userMap of this.armedByUser.values()) {
      for (const scene of userMap.values()) {
        if (scene.status === "armed") {
          return true;
        }
      }
    }
    return false;
  }

  isInterceptorRegistered(): boolean {
    if (this.interceptorMux) {
      return this.interceptorDisposer !== null && this.interceptorMux.isRegistered();
    }
    return this.interceptorDisposer !== null;
  }

  onSettingsSaved(settings: GuidedGenerationsSettings, userId?: string): void {
    const key = this.userKey(userId);
    this.readinessTagByUser.set(
      key,
      normalizeSceneReadinessTag(settings.guidedScene.readinessTag, DEFAULT_SCENE_READINESS_TAG),
    );
  }

  private setInMemoryArmedScene(userKey: string, scene: ArmedSceneState): void {
    this.mutatedDuringHydration.get(userKey)?.add(scene.chatId);

    let userMap = this.armedByUser.get(userKey);
    if (!userMap) {
      userMap = new Map<string, ArmedSceneState>();
      this.armedByUser.set(userKey, userMap);
    }
    userMap.set(scene.chatId, { ...scene });

    let owners = this.armedChatOwners.get(scene.chatId);
    if (!owners) {
      owners = new Set<string>();
      this.armedChatOwners.set(scene.chatId, owners);
    }
    owners.add(userKey);
  }

  private deleteInMemoryArmedScene(userKey: string, chatId: string): boolean {
    this.mutatedDuringHydration.get(userKey)?.add(chatId);

    const userMap = this.armedByUser.get(userKey);
    const existed = Boolean(userMap?.delete(chatId));
    if (userMap && userMap.size === 0) {
      this.armedByUser.delete(userKey);
    }
    const owners = this.armedChatOwners.get(chatId);
    if (owners) {
      owners.delete(userKey);
      if (owners.size === 0) {
        this.armedChatOwners.delete(chatId);
      }
    }
    return existed;
  }

  private getInMemoryArmedScene(chatId: string, userId?: string): ArmedSceneState | null {
    const key = this.userKey(userId);
    const scene = this.armedByUser.get(key)?.get(chatId);
    return scene ? { ...scene } : null;
  }

  private listInMemoryArmedScenes(userId?: string): ArmedSceneState[] {
    const userMap = this.armedByUser.get(this.userKey(userId));
    if (!userMap || userMap.size === 0) return [];
    return Array.from(userMap.values(), (scene) => ({ ...scene })).sort(
      (a, b) => a.armedAt - b.armedAt,
    );
  }

  /**
   * Resolves the owning `(userKey, userId, scene)` for a lifecycle/interceptor
   * callback while strictly preserving multi-user isolation.
   */
  private resolveArmedOwnerForEvent(
    chatId: string,
    eventUserId?: string,
  ): { userKey: string; userId?: string; scene: ArmedSceneState } | null {
    if (typeof eventUserId === "string" && eventUserId.length > 0) {
      const key = this.userKey(eventUserId);
      const scene = this.armedByUser.get(key)?.get(chatId);
      return scene ? { userKey: key, userId: eventUserId, scene } : null;
    }

    const defaultScene = this.armedByUser.get("__default__")?.get(chatId);
    if (defaultScene) {
      return { userKey: "__default__", userId: defaultScene.userId, scene: defaultScene };
    }

    // Single-user fallback only when exactly one owner holds an armed scene for this chatId.
    const owners = this.armedChatOwners.get(chatId);
    if (owners && owners.size === 1) {
      const onlyKey = owners.values().next().value as string;
      const scene = this.armedByUser.get(onlyKey)?.get(chatId);
      if (scene) {
        return {
          userKey: onlyKey,
          userId: scene.userId ?? (onlyKey === "__default__" ? undefined : onlyKey),
          scene,
        };
      }
    }
    return null;
  }

  /**
   * Loads persisted ephemeral `active-scenes/*.json` entries for a user once
   * per lifecycle, coalescing concurrent callers and preventing stale disk
   * reads from resurrecting scenes mutated or cancelled while hydration ran.
   */
  async hydrateUserArmedScenes(userId?: string): Promise<ArmedSceneState[]> {
    if (this.disposed) return [];
    const key = this.userKey(userId);
    if (this.hydratedUsers.has(key)) {
      return this.listInMemoryArmedScenes(userId);
    }

    let pending = this.hydrationInFlight.get(key);
    if (!pending) {
      const touchedChats = new Set<string>();
      this.mutatedDuringHydration.set(key, touchedChats);

      const loadPromise = (async () => {
        try {
          const [persisted, settings] = await Promise.all([
            this.store.listArmedScenes(userId),
            this.store.getSettings(userId).catch(() => null),
          ]);
          if (settings) {
            this.onSettingsSaved(settings, userId);
          }
          if (this.disposed) return;

          const canVerifyChatExists =
            this.spindle.permissions.has("chats") &&
            typeof this.spindle.chats?.get === "function";

          await Promise.all(
            persisted.map(async (scene) => {
              if (
                touchedChats.has(scene.chatId) ||
                this.armedByUser.get(key)?.has(scene.chatId)
              ) {
                return;
              }
              if (canVerifyChatExists) {
                try {
                  const chat = await this.spindle.chats.get(scene.chatId, userId);
                  if (this.disposed) return;
                  if (
                    touchedChats.has(scene.chatId) ||
                    this.armedByUser.get(key)?.has(scene.chatId)
                  ) {
                    return;
                  }
                  if (chat == null) {
                    await this.store.deleteArmedScene(scene.chatId, userId).catch(() => undefined);
                    return;
                  }
                } catch {
                  // Keep persisted scene on transient chat lookup error.
                }
              }
              this.setInMemoryArmedScene(key, scene);
            }),
          );

          if (this.disposed) return;
          this.hydratedUsers.add(key);
          if (this.hasAnyActiveArmedScene()) {
            this.ensureInterceptorRegistered();
          }
        } catch (error) {
          this.spindle.log?.warn?.(
            `[GuidedGenerations] Failed hydrating armed scenes: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })();

      const tracked = loadPromise.finally(() => {
        if (this.hydrationInFlight.get(key) === tracked) {
          this.hydrationInFlight.delete(key);
        }
        if (this.mutatedDuringHydration.get(key) === touchedChats) {
          this.mutatedDuringHydration.delete(key);
        }
      });

      pending = tracked;
      this.hydrationInFlight.set(key, tracked);
    }

    await pending;
    return this.listInMemoryArmedScenes(userId);
  }

  private async createRunId(): Promise<string> {
    const uuidCapability = this.spindle.host?.capabilities?.["uuid-v1"];
    const canUseUuid = typeof uuidCapability === "number" ? uuidCapability >= 1 : true;
    if (canUseUuid && typeof this.spindle.uuid?.v7 === "function") {
      return `ggs-${await this.spindle.uuid.v7()}`;
    }
    if (canUseUuid && typeof this.spindle.uuid?.v4 === "function") {
      return `ggs-${await this.spindle.uuid.v4()}`;
    }
    this.runCounter += 1;
    return `ggs-${Date.now().toString(36)}-${this.runCounter.toString(36)}`;
  }

  private disposeInterceptor(): void {
    if (!this.interceptorDisposer) return;
    try {
      this.interceptorDisposer();
    } finally {
      this.interceptorDisposer = null;
    }
  }

  private releaseInterceptorIfIdle(): void {
    if (
      !this.hasAnyActiveArmedScene() &&
      this.pendingDryRunCaptures.size === 0 &&
      this.interceptorDisposer
    ) {
      this.disposeInterceptor();
    }
  }

  syncInterceptorRegistration(): void {
    if (this.disposed || !this.spindle.permissions?.has?.("interceptor")) {
      this.disposeInterceptor();
      return;
    }
    if (this.hasAnyActiveArmedScene() || this.pendingDryRunCaptures.size > 0) {
      this.ensureInterceptorRegistered();
    } else {
      this.disposeInterceptor();
    }
  }

  private ensureInterceptorRegistered(): void {
    if (this.disposed) return;
    if (!this.spindle.permissions?.has?.("interceptor")) {
      this.disposeInterceptor();
      return;
    }
    if (this.interceptorDisposer) return;

    const registerFn = this.interceptorMux
      ? (handler: Parameters<SpindleAPI["registerInterceptor"]>[0]) =>
          this.interceptorMux!.register(handler)
      : typeof this.spindle.registerInterceptor === "function"
        ? (handler: Parameters<SpindleAPI["registerInterceptor"]>[0]) =>
            this.spindle.registerInterceptor(handler)
        : null;
    if (!registerFn) return;

    try {
      this.interceptorDisposer = registerFn(async (messages, context) => {
        if (this.disposed) return messages;
        if (this.spindle.permissions?.has && !this.spindle.permissions.has("interceptor")) {
          return messages;
        }

        const isDryRun = Boolean(
          (context as { dryRun?: boolean }).dryRun || context.isDryRun,
        );
        if (isDryRun) {
          const pending = this.pendingDryRunCaptures.get(context.chatId);
          if (pending) {
            const matchesUser =
              !pending.userId || !context.userId || context.userId === pending.userId;
            const matchesPreset = !pending.presetId || context.presetId === pending.presetId;
            if (matchesUser && matchesPreset) {
              pending.capturedMessages = messages.map((m) => ({
                ...(m as AssembledLlmMessageDTO),
              }));
            }
          }
          return messages;
        }

        if (
          context.generationType === "impersonate" ||
          context.generationType === "quiet"
        ) {
          return messages;
        }

        if (!this.hasArmedChat(context.chatId)) {
          return messages;
        }

        const match = this.resolveArmedOwnerForEvent(context.chatId, context.userId);
        if (!match || match.scene.status !== "armed") {
          return messages;
        }

        const { userKey, userId, scene } = match;
        const settings = await this.store.getSettings(userId);
        this.onSettingsSaved(settings, userId);

        const names = await this.resolveMacroNames({
          chatId: context.chatId,
          characterId: scene.speakerCharacterId ?? context.characterId ?? undefined,
          speakerCharacterName: scene.speakerCharacterName ?? undefined,
          userId,
        });

        const directive = renderSteeringDirective(scene, settings.guidedScene, names);
        const assembled = messages as AssembledLlmMessageDTO[];
        const isChatHistory = resolveChatHistoryFlags(assembled);
        const injected = injectSceneDirective(
          assembled,
          directive,
          settings.guidedScene.injectionRole,
          settings.guidedScene.guidancePosition,
          settings.guidedScene.guidanceDepth,
          isChatHistory,
        );

        const liveScene = this.armedByUser.get(userKey)?.get(context.chatId);
        if (liveScene && liveScene.status === "armed") {
          liveScene.turnsSteered = (liveScene.turnsSteered ?? 0) + 1;
          const steeredSnapshot: ArmedSceneState = { ...liveScene };
          const expectedArmedAt = liveScene.armedAt;
          this.emitSceneUpdated(context.chatId, steeredSnapshot, userId, "steered");
          void this.withArmedSceneLock(userKey, context.chatId, async () => {
            if (this.disposed) return;
            const current = this.armedByUser.get(userKey)?.get(context.chatId);
            if (!current || current.armedAt !== expectedArmedAt) return;
            const saved = await this.store.saveArmedScene({ ...current }, userId);
            const afterSave = this.armedByUser.get(userKey)?.get(context.chatId);
            if (afterSave && afterSave.armedAt === expectedArmedAt) {
              this.setInMemoryArmedScene(userKey, saved);
            }
          }).catch((err) => {
            this.spindle.log?.warn?.(
              `[GuidedGenerations] Failed persisting turnsSteered for chat ${context.chatId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        }

        return injected.messages;
      });
    } catch {
      this.interceptorDisposer = null;
    }
  }

  private registerGenerationLifecycleListeners(): void {
    if (typeof this.spindle.on !== "function") return;

    const handleGenerationEvent = (
      eventKind: "ended" | "stopped",
      rawPayload: unknown,
      eventUserId?: string,
    ) => {
      if (this.disposed || !isRecord(rawPayload)) return;
      const chatId = typeof rawPayload.chatId === "string" ? rawPayload.chatId : "";
      if (!chatId || !this.hasArmedChat(chatId)) return;

      void this.processArmedGenerationCompletion(eventKind, rawPayload, eventUserId).catch(
        (err) => {
          this.spindle.log?.warn?.(
            `[GuidedGenerations] Armed scene handoff failed for chat ${chatId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        },
      );
    };

    try {
      const d1 = this.spindle.on(
        "GENERATION_ENDED",
        (payload: GenerationEndedPayloadDTO, userId?: string) => {
          handleGenerationEvent("ended", payload, userId);
        },
      );
      if (typeof d1 === "function") this.lifecycleDisposers.push(d1);

      const d2 = this.spindle.on(
        "GENERATION_STOPPED",
        (payload: GenerationStoppedPayloadDTO, userId?: string) => {
          handleGenerationEvent("stopped", payload, userId);
        },
      );
      if (typeof d2 === "function") this.lifecycleDisposers.push(d2);

      const d3 = this.spindle.on(
        "CHAT_DELETED",
        (rawPayload: unknown, eventUserId?: string) => {
          if (this.disposed || !isRecord(rawPayload)) return;
          const deletedChatId =
            typeof rawPayload.chatId === "string" && rawPayload.chatId.trim().length > 0
              ? rawPayload.chatId.trim()
              : typeof rawPayload.id === "string" && rawPayload.id.trim().length > 0
                ? rawPayload.id.trim()
                : "";
          if (!deletedChatId || !this.hasArmedChat(deletedChatId)) return;

          const affectedOwners: Array<{ key: string; userId?: string }> = [];
          if (typeof eventUserId === "string" && eventUserId.length > 0) {
            const key = this.userKey(eventUserId);
            if (this.armedByUser.get(key)?.has(deletedChatId)) {
              affectedOwners.push({ key, userId: eventUserId });
            }
          } else {
            const ownerKeys = this.armedChatOwners.get(deletedChatId);
            if (ownerKeys) {
              for (const key of [...ownerKeys]) {
                const scene = this.armedByUser.get(key)?.get(deletedChatId);
                affectedOwners.push({
                  key,
                  userId: scene?.userId ?? (key === "__default__" ? undefined : key),
                });
              }
            }
          }

          for (const owner of affectedOwners) {
            this.deleteInMemoryArmedScene(owner.key, deletedChatId);
            void this.store.deleteArmedScene(deletedChatId, owner.userId).catch(() => undefined);
            this.releaseInterceptorIfIdle();
            this.emitSceneUpdated(deletedChatId, null, owner.userId, "chat_deleted");
          }
        },
      );
      if (typeof d3 === "function") this.lifecycleDisposers.push(d3);
    } catch {
      // Ignore if host event bus is unavailable in minimal test stubs.
    }
  }

  private rememberOwnDropMessageId(messageId: string): void {
    this.ownDropMessageIds.add(messageId);
    if (this.ownDropMessageIds.size > MAX_OWN_DROP_IDS) {
      const oldest = this.ownDropMessageIds.values().next().value;
      if (oldest !== undefined) {
        this.ownDropMessageIds.delete(oldest);
      }
    }
  }

  private markTriggerDropped(triggerKey: string): void {
    this.droppedTriggerKeys.add(triggerKey);
    if (this.droppedTriggerKeys.size > MAX_DROPPED_TRIGGER_KEYS) {
      const oldest = this.droppedTriggerKeys.values().next().value;
      if (oldest !== undefined) {
        this.droppedTriggerKeys.delete(oldest);
      }
    }
  }

  private checkArmedDropPermissions(armed: ArmedSceneState): string | null {
    if (!this.spindle.permissions.has("chat_mutation")) {
      return "Missing required 'chat_mutation' permission to drop Guided Scene.";
    }
    const lockedText = typeof armed.lockedDraftText === "string" ? armed.lockedDraftText.trim() : "";
    const needsLlm = armed.adjustmentMode !== "verbatim" && !(armed.draftLocked && lockedText.length > 0);
    if (needsLlm) {
      if (!this.spindle.permissions.has("generation")) {
        return "Missing required 'generation' permission to rewrite Guided Scene.";
      }
      if (!this.spindle.permissions.has("chats")) {
        return "Missing required 'chats' permission to rewrite Guided Scene.";
      }
    }
    return null;
  }

  private async pauseArmedSceneOnError(
    userKey: string,
    armed: ArmedSceneState,
    userId: string | undefined,
    errorMessage: string,
    emitStatusError: boolean,
  ): Promise<void> {
    if (this.disposed) return;
    const existing = this.armedByUser.get(userKey)?.get(armed.chatId);
    if (existing && existing.armedAt !== armed.armedAt) {
      return;
    }

    const paused: ArmedSceneState = {
      ...armed,
      status: "paused",
    };
    try {
      const saved = await this.store.saveArmedScene(paused, userId);
      const afterSave = this.armedByUser.get(userKey)?.get(armed.chatId);
      if (this.disposed || (afterSave && afterSave.armedAt !== armed.armedAt)) {
        return;
      }
      this.setInMemoryArmedScene(userKey, saved);
    } catch {
      const afterFail = this.armedByUser.get(userKey)?.get(armed.chatId);
      if (this.disposed || (afterFail && afterFail.armedAt !== armed.armedAt)) {
        return;
      }
      this.setInMemoryArmedScene(userKey, paused);
    }
    this.releaseInterceptorIfIdle();
    this.emitSceneUpdated(armed.chatId, paused, userId, "error");
    if (emitStatusError) {
      this.emitFrontend(
        {
          type: "gg:status",
          error: errorMessage,
          run: this.getActiveRun(userId, armed.chatId),
          chatId: armed.chatId,
        },
        userId,
      );
    }
  }

  private async processArmedGenerationCompletion(
    eventKind: "ended" | "stopped",
    payload: Record<string, unknown>,
    eventUserId?: string,
  ): Promise<void> {
    if (this.disposed) return;

    const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
    if (!chatId) return;

    // Ignore failed generations, impersonation, and quiet background calls.
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return;
    }
    const genType = typeof payload.generationType === "string" ? payload.generationType : "";
    if (genType === "impersonate" || genType === "quiet") {
      return;
    }

    const match = this.resolveArmedOwnerForEvent(chatId, eventUserId);
    if (!match || match.scene.status !== "armed") {
      return;
    }

    const { userKey, userId } = match;
    const dropGuardKey = this.compositeKey(userKey, chatId);
    // Synchronous shared lock across dropSceneNow & armed completions.
    if (this.inFlightDrops.has(dropGuardKey)) {
      return;
    }

    let messageId =
      typeof payload.messageId === "string" && payload.messageId.trim().length > 0
        ? payload.messageId.trim()
        : undefined;
    if (messageId && this.ownDropMessageIds.has(messageId)) {
      return;
    }

    this.inFlightDrops.add(dropGuardKey);
    try {
      const armedSnapshot: ArmedSceneState = { ...match.scene };
      let swipeId =
        typeof payload.swipeId === "number" && Number.isFinite(payload.swipeId)
          ? Math.floor(payload.swipeId)
          : undefined;
      let rawContent = typeof payload.content === "string" ? payload.content : "";

      let latestAssistantMsg: ChatMessageWithRole | null = null;
      if (!messageId || swipeId === undefined || !rawContent) {
        try {
          const tail = await this.getChatMessagesWithOptions(chatId, { tail: 5, includeExtra: true });
          const trailing = tail[tail.length - 1];
          latestAssistantMsg = isAssistantMessage(trailing) ? trailing : null;
          if (latestAssistantMsg) {
            if (!messageId) messageId = latestAssistantMsg.id;
            if (swipeId === undefined) {
              const norm = normalizeMessageSwipes(latestAssistantMsg);
              swipeId = norm.activeIndex;
            }
            if (!rawContent) {
              rawContent = latestAssistantMsg.content ?? "";
            }
          }
        } catch {
          // Proceed with payload fields if tail read fails.
        }
      }

      if (messageId && this.ownDropMessageIds.has(messageId)) {
        return;
      }

      const effectiveMessageId = messageId ?? "latest";
      const effectiveSwipeId = swipeId ?? 0;
      const triggerKey = `${userKey}::${chatId}::${effectiveMessageId}::${effectiveSwipeId}`;
      if (this.droppedTriggerKeys.has(triggerKey)) {
        return;
      }

      const settings = await this.store.getSettings(userId);
      this.onSettingsSaved(settings, userId);
      const tagName = normalizeSceneReadinessTag(
        settings.guidedScene.readinessTag,
        DEFAULT_SCENE_READINESS_TAG,
      );

      const hasTag = hasReadinessTag(rawContent, tagName);
      const shouldTrigger =
        eventKind === "ended"
          ? armedSnapshot.pacing === "next_turn" || hasTag
          : hasTag;

      if (!shouldTrigger) {
        return;
      }

      // Re-check armed state after async reads.
      if (this.disposed) return;
      const currentArmed = this.armedByUser.get(userKey)?.get(chatId);
      if (!currentArmed || currentArmed.status !== "armed") {
        return;
      }

      // Strip <scene-ready /> from stored lead-in message if present.
      if (hasTag && messageId && this.spindle.permissions.has("chat_mutation")) {
        try {
          const msgToClean =
            latestAssistantMsg && latestAssistantMsg.id === messageId
              ? latestAssistantMsg
              : await this.findAssistantMessageById(chatId, messageId);
          if (msgToClean && hasReadinessTag(msgToClean.content ?? "", tagName)) {
            const cleanedContent = stripReadinessTag(msgToClean.content ?? "", tagName);
            const norm = normalizeMessageSwipes(msgToClean);
            const targetSwipeIdx =
              swipeId !== undefined && swipeId >= 0 && swipeId < norm.swipes.length
                ? swipeId
                : norm.activeIndex;
            const patch = buildActiveSwipePatch({
              swipes: norm.swipes,
              swipeIndex: targetSwipeIdx,
              content: cleanedContent,
              swipeDates: norm.swipeDates,
              skipChunkRebuild: false,
            });
            await this.spindle.chat.updateMessage(chatId, msgToClean.id, patch);
          }
        } catch (err) {
          this.spindle.log?.warn?.(
            `[GuidedGenerations] Failed stripping readiness tag from message ${messageId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // Post-strip handoff commit serialized under per-chat lock: re-check armed state AFTER updateMessage.
      const committed = await this.withArmedSceneLock(userKey, chatId, async () => {
        if (this.disposed) return null;
        const postStripArmed = this.armedByUser.get(userKey)?.get(chatId);
        if (
          !postStripArmed ||
          postStripArmed.status !== "armed" ||
          postStripArmed.armedAt !== armedSnapshot.armedAt
        ) {
          return null;
        }

        // Precheck permissions BEFORE clearing armed state so missing permissions don't silently wipe it.
        const permError = this.checkArmedDropPermissions(postStripArmed);
        if (permError) {
          await this.pauseArmedSceneOnError(userKey, postStripArmed, userId, permError, true);
          return null;
        }

        this.markTriggerDropped(triggerKey);

        // Clear armed state, delete ephemeral storage, dispose interceptor if idle, and notify frontend.
        this.deleteInMemoryArmedScene(userKey, chatId);
        await this.store.deleteArmedScene(chatId, userId);
        this.releaseInterceptorIfIdle();
        this.emitSceneUpdated(chatId, null, userId, "dropped");
        return { ...postStripArmed };
      });

      if (!committed) {
        return;
      }

      const lockedText =
        typeof committed.lockedDraftText === "string"
          ? committed.lockedDraftText.trim()
          : "";
      const isDirectDrop =
        committed.adjustmentMode === "verbatim" ||
        Boolean(committed.draftLocked && lockedText.length > 0);

      try {
        await this.executeArmedDrop(committed, settings.guidedScene, userId);
      } catch (dropErr) {
        const message = dropErr instanceof Error ? dropErr.message : String(dropErr);
        // Preserve scene as paused if direct/pre-commit drop failed; streaming dropSceneNow already emitted gg:status error.
        await this.withArmedSceneLock(userKey, chatId, async () => {
          await this.pauseArmedSceneOnError(userKey, committed, userId, message, isDirectDrop);
        });
        throw dropErr;
      }
    } finally {
      this.inFlightDrops.delete(dropGuardKey);
    }
  }

  private async executeArmedDrop(
    armed: ArmedSceneState,
    config: GuidedSceneConfig,
    userId?: string,
  ): Promise<DropSceneNowResult> {
    const lockedText = typeof armed.lockedDraftText === "string" ? armed.lockedDraftText.trim() : "";
    const useLockedDraft = Boolean(armed.draftLocked && lockedText.length > 0);

    // For armed scenes, the lead-in turn ALREADY handled the delivery seam.
    // Therefore verbatim drops instantly (zero LLM), locked drafts drop instantly,
    // and unlocked context_adapt / summary_rewrite runs live using the latest history.
    if (armed.adjustmentMode === "verbatim" || useLockedDraft) {
      const sourceText = useLockedDraft ? lockedText : armed.rawGreetingText;
      const keepMedia = armed.keepMediaIntact ?? config.keepMediaIntact;
      const resolvedText = await this.resolveSceneTextMacros({
        text: sourceText,
        chatId: armed.chatId,
        characterId: armed.speakerCharacterId ?? undefined,
        speakerCharacterName: armed.speakerCharacterName ?? undefined,
        keepMediaIntact: keepMedia,
        userId,
      });

      const appended = await this.appendSceneAssistantMessage({
        chatId: armed.chatId,
        content: resolvedText,
        speakerCharacterId: armed.speakerCharacterId ?? undefined,
        speakerCharacterName: armed.speakerCharacterName ?? undefined,
      });

      return {
        actionId: "guided_scene",
        chatId: armed.chatId,
        aborted: false,
        messageId: appended.id,
        swipeId: 0,
        text: resolvedText,
        dropTarget: "new_message",
      };
    }

    return this.executeDropSceneNow(
      {
        chatId: armed.chatId,
        delivery: armed.delivery,
        adjustmentMode: armed.adjustmentMode,
        greetingSource: armed.greetingSource,
        selectedGreetingKey: armed.selectedGreetingKey,
        greetingLabel: armed.greetingLabel,
        rawGreetingText: armed.rawGreetingText,
        speakerCharacterId: armed.speakerCharacterId,
        speakerCharacterName: armed.speakerCharacterName,
        transitionNote: armed.transitionNote,
        customDirection: armed.customDirection,
        keepMediaIntact: armed.keepMediaIntact ?? config.keepMediaIntact,
        dropTarget: "new_message",
        draftLocked: false,
        lockedDraftText: null,
      },
      userId,
      { holdsDropLock: true },
    );
  }

  private async clearArmedSceneAfterDrop(chatId: string, userId?: string): Promise<void> {
    const key = this.userKey(userId);
    await this.withArmedSceneLock(key, chatId, async () => {
      const hadInMemory = this.deleteInMemoryArmedScene(key, chatId);
      const hadPersisted =
        !hadInMemory && !this.hydratedUsers.has(key)
          ? Boolean(await this.store.getArmedScene(chatId, userId).catch(() => null))
          : false;
      if (!hadInMemory && !hadPersisted) {
        return;
      }
      await this.store.deleteArmedScene(chatId, userId);
      this.releaseInterceptorIfIdle();
      this.emitSceneUpdated(chatId, null, userId, "dropped");
    });
  }

  private emitSceneUpdated(
    chatId: string | undefined,
    armedScene: ArmedSceneState | null,
    userId: string | undefined,
    reason: string,
  ): void {
    if (this.disposed) return;
    this.emitFrontend(
      {
        type: "gg:scene-updated",
        ...(chatId ? { chatId } : {}),
        armedScene: armedScene ? { ...armedScene } : null,
        armedScenes: this.listInMemoryArmedScenes(userId),
        reason,
      },
      userId,
    );
  }

  private async resolveChatOrThrow(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<ChatDTO> {
    if (!this.spindle.permissions.has("chats")) {
      throw new Error("Missing required 'chats' permission for Guided Scene.");
    }
    const cleanId =
      typeof requestedChatId === "string" && requestedChatId.trim().length > 0
        ? requestedChatId.trim()
        : null;
    if (cleanId) {
      const chat = await this.spindle.chats.get(cleanId, userId);
      if (!chat) {
        throw new Error("The requested chat is no longer available.");
      }
      return chat;
    }
    const active = await this.spindle.chats.getActive(userId);
    if (!active) {
      throw new Error("Open a chat before using Guided Scene.");
    }
    return active;
  }

  private extractGroupMetadata(chat: ChatDTO): {
    isGroup: boolean;
    memberIds: string[];
    activeGreetingIndex: number;
    openingCharacterId: string | null;
    hasExplicitOpeningCharacter: boolean;
  } {
    const meta = isRecord(chat.metadata) ? chat.metadata : {};
    const rawCharIds: string[] = [];

    if (Array.isArray(meta.character_ids)) {
      for (const entry of meta.character_ids) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          rawCharIds.push(entry.trim());
        }
      }
    }
    if (Array.isArray(meta.members)) {
      for (const entry of meta.members) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          rawCharIds.push(entry.trim());
        } else if (isRecord(entry) && typeof entry.id === "string" && entry.id.trim().length > 0) {
          rawCharIds.push(entry.id.trim());
        }
      }
    }

    const primaryCharId =
      typeof chat.character_id === "string" && chat.character_id.trim().length > 0
        ? chat.character_id.trim()
        : null;

    const seen = new Set<string>();
    const memberIds: string[] = [];
    const addId = (id: string | null) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      memberIds.push(id);
    };

    const isGroup =
      meta.group === true ||
      meta.isGroup === true ||
      meta.is_group === true ||
      rawCharIds.length > 1;

    if (isGroup) {
      for (const id of rawCharIds) addId(id);
      addId(primaryCharId);
    } else {
      addId(primaryCharId);
      for (const id of rawCharIds) addId(id);
    }

    const rawGreetingIdx =
      meta.activeGreetingIndex ?? meta.greetingIndex ?? meta.greeting_index;
    const activeGreetingIndex =
      typeof rawGreetingIdx === "number" &&
      Number.isFinite(rawGreetingIdx) &&
      rawGreetingIdx >= 0
        ? Math.floor(rawGreetingIdx)
        : 0;

    const explicitOpeningCharId =
      typeof meta.greeting_character_id === "string" && meta.greeting_character_id.trim().length > 0
        ? meta.greeting_character_id.trim()
        : typeof meta.greetingCharacterId === "string" && meta.greetingCharacterId.trim().length > 0
          ? meta.greetingCharacterId.trim()
          : typeof meta.openingCharacterId === "string" && meta.openingCharacterId.trim().length > 0
            ? meta.openingCharacterId.trim()
            : null;

    return {
      isGroup,
      memberIds,
      activeGreetingIndex,
      openingCharacterId: explicitOpeningCharId ?? primaryCharId ?? memberIds[0] ?? null,
      hasExplicitOpeningCharacter: explicitOpeningCharId !== null,
    };
  }

  async getSceneContext(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<GuidedSceneChatContext> {
    const chat = await this.resolveChatOrThrow(requestedChatId, userId);
    await this.hydrateUserArmedScenes(userId);

    const groupMeta = this.extractGroupMetadata(chat);
    const { isGroup, memberIds, activeGreetingIndex } = groupMeta;
    let openingCharacterId = groupMeta.openingCharacterId;

    const canReadCharacters =
      this.spindle.permissions.has("characters") &&
      typeof this.spindle.characters?.get === "function";

    const [loadedChars, trailingTail, openingMsgExtra] = await Promise.all([
      canReadCharacters && memberIds.length > 0
        ? Promise.all(
            memberIds.map(async (charId) => {
              try {
                return await this.spindle.characters.get(charId, userId);
              } catch {
                return null;
              }
            }),
          ).then((results) => results.filter((ch): ch is CharacterDTO => Boolean(ch)))
        : Promise.resolve([] as CharacterDTO[]),
      this.getChatMessagesWithOptions(chat.id, { tail: 1, includeExtra: true }).catch(
        () => [] as ChatMessageWithRole[],
      ),
      isGroup && !groupMeta.hasExplicitOpeningCharacter
        ? this.getChatMessagesWithOptions(chat.id, { limit: 1, offset: 0, includeExtra: true })
            .then((firstList) => firstList[0]?.extra)
            .catch(() => undefined)
        : Promise.resolve(undefined),
    ]);

    if (
      isGroup &&
      !groupMeta.hasExplicitOpeningCharacter &&
      isRecord(openingMsgExtra) &&
      typeof openingMsgExtra.greeting_character_id === "string" &&
      openingMsgExtra.greeting_character_id.trim().length > 0
    ) {
      openingCharacterId = openingMsgExtra.greeting_character_id.trim();
    }

    const members: GuidedSceneMember[] = loadedChars.map((ch) => ({
      id: ch.id,
      name: ch.name || "Character",
    }));

    const greetings: GuidedSceneGreetingOption[] = [];
    for (const ch of loadedChars) {
      const charName = ch.name || "Character";
      const isOpeningOwner = ch.id === openingCharacterId;

      if (typeof ch.first_mes === "string" && ch.first_mes.trim().length > 0) {
        const key = `${ch.id}:0`;
        greetings.push({
          key,
          id: key,
          characterId: ch.id,
          characterName: charName,
          greetingIndex: 0,
          label: isGroup ? `${charName} — #1 Opening Greeting` : "#1 Opening Greeting",
          text: ch.first_mes,
          preview: makeGreetingPreview(ch.first_mes),
          isOpening: isOpeningOwner && activeGreetingIndex === 0,
          hasMedia: hasMediaContent(ch.first_mes),
        });
      }

      if (Array.isArray(ch.alternate_greetings)) {
        for (let idx = 0; idx < ch.alternate_greetings.length; idx += 1) {
          const alt = ch.alternate_greetings[idx];
          if (typeof alt !== "string" || alt.trim().length === 0) continue;
          const greetingIndex = idx + 1;
          const key = `${ch.id}:${greetingIndex}`;
          greetings.push({
            key,
            id: key,
            characterId: ch.id,
            characterName: charName,
            greetingIndex,
            label: isGroup
              ? `${charName} — #${greetingIndex + 1} Alternate Greeting`
              : `#${greetingIndex + 1} Alternate Greeting`,
            text: alt,
            preview: makeGreetingPreview(alt),
            isOpening: isOpeningOwner && activeGreetingIndex === greetingIndex,
            hasMedia: hasMediaContent(alt),
          });
        }
      }
    }

    const trailing = trailingTail[trailingTail.length - 1];
    const canSwipeLastAssistant = isAssistantMessage(trailing);

    const primaryCharId =
      typeof chat.character_id === "string" && chat.character_id.trim().length > 0
        ? chat.character_id.trim()
        : members[0]?.id ?? null;
    const primaryMember = members.find((m) => m.id === primaryCharId) ?? members[0] ?? null;

    return {
      chatId: chat.id,
      isGroup,
      primaryCharacterId: primaryCharId,
      primaryCharacterName: primaryMember?.name ?? null,
      members,
      greetings,
      armedScene: this.getInMemoryArmedScene(chat.id, userId),
      canSwipeLastAssistant,
    };
  }

  private trackPreviewController(
    userKey: string,
    chatId: string,
    controller: AbortController,
  ): () => void {
    const compKey = this.compositeKey(userKey, chatId);
    let set = this.previewControllers.get(compKey);
    if (!set) {
      set = new Set<AbortController>();
      this.previewControllers.set(compKey, set);
    }
    set.add(controller);
    return () => {
      const existing = this.previewControllers.get(compKey);
      if (!existing) return;
      existing.delete(controller);
      if (existing.size === 0) {
        this.previewControllers.delete(compKey);
      }
    };
  }

  private assertNonEmptySceneText(
    rawGreetingText: string,
    options?: { draftLocked?: boolean; lockedDraftText?: string | null },
  ): void {
    const hasRaw = typeof rawGreetingText === "string" && rawGreetingText.trim().length > 0;
    if (hasRaw) return;
    const hasLocked =
      Boolean(options?.draftLocked) &&
      typeof options?.lockedDraftText === "string" &&
      options.lockedDraftText.trim().length > 0;
    if (hasLocked) return;
    throw new Error("Scene greeting text cannot be empty.");
  }

  async previewSceneDraft(
    input: PreviewSceneDraftInput,
    userId?: string,
  ): Promise<PreviewSceneDraftResult> {
    this.assertNonEmptySceneText(input.rawGreetingText);
    const chat = await this.resolveChatOrThrow(input.chatId, userId);
    const settings = await this.store.getSettings(userId);
    this.onSettingsSaved(settings, userId);
    const config = settings.guidedScene;
    const keepMedia = input.keepMediaIntact ?? config.keepMediaIntact;

    const speakerCharacterId =
      input.speakerCharacterId || (chat.character_id ? chat.character_id : undefined);
    const speakerCharacterName =
      input.speakerCharacterName ||
      (speakerCharacterId ? await this.resolveCharacterName(speakerCharacterId, userId) : undefined);

    if (input.adjustmentMode === "verbatim" && input.delivery === "cut") {
      const resolved = await this.resolveSceneTextMacros({
        text: input.rawGreetingText,
        chatId: chat.id,
        characterId: speakerCharacterId,
        speakerCharacterName,
        keepMediaIntact: keepMedia,
        userId,
      });
      return { text: resolved, chatId: chat.id };
    }

    this.assertGenerationPermissions(false);

    const controller = new AbortController();
    const releasePreview = this.trackPreviewController(this.userKey(userId), chat.id, controller);
    try {
      const prepared = await this.prepareSceneLlmRequest({
        chat,
        config,
        mode:
          input.adjustmentMode === "verbatim"
            ? "verbatim_bridge"
            : input.adjustmentMode === "summary_rewrite"
              ? "summary_rewrite"
              : "context_adapt",
        delivery: input.delivery,
        rawGreetingText: input.rawGreetingText,
        speakerCharacterId,
        speakerCharacterName,
        transitionNote: input.transitionNote,
        customDirection: input.customDirection,
        keepMediaIntact: keepMedia,
        activeConnectionId: input.activeConnectionId,
        signal: controller.signal,
        userId,
      });

      if (controller.signal.aborted) {
        return { text: "", chatId: chat.id, aborted: true };
      }

      const generated = await this.runSingleShotLlm(prepared.rawInput, controller.signal);
      const finalized =
        generated.aborted && generated.text.length === 0
          ? ""
          : await this.finalizeGeneratedSceneText({
              rawOutput: generated.text,
              mode: prepared.mode,
              delivery: input.delivery,
              resolvedVerbatimScene: prepared.resolvedVerbatimScene,
              mediaSlots: prepared.mediaSlots,
              keepMediaIntact: keepMedia,
              applyRegex: config.applyRegex,
              chatId: chat.id,
              characterId: speakerCharacterId,
              userId,
            });

      return {
        text: finalized,
        chatId: chat.id,
        ...(generated.aborted ? { aborted: true } : {}),
      };
    } finally {
      releasePreview();
    }
  }

  async dropSceneNow(
    input: DropSceneNowInput,
    userId?: string,
  ): Promise<DropSceneNowResult> {
    const lockedCandidate =
      typeof input.lockedDraftText === "string" && input.lockedDraftText.trim().length > 0
        ? input.lockedDraftText
        : typeof input.previewText === "string" && input.previewText.trim().length > 0
          ? input.previewText
          : null;
    this.assertNonEmptySceneText(input.rawGreetingText, {
      draftLocked: input.draftLocked,
      lockedDraftText: lockedCandidate,
    });
    return this.executeDropSceneNow(input, userId, { holdsDropLock: false });
  }

  private async executeDropSceneNow(
    input: DropSceneNowInput,
    userId: string | undefined,
    options: { holdsDropLock: boolean },
  ): Promise<DropSceneNowResult> {
    const key = this.userKey(userId);
    const explicitChatId =
      typeof input.chatId === "string" && input.chatId.trim().length > 0
        ? input.chatId.trim()
        : null;

    let acquiredDropLockKey: string | null = null;
    if (!options.holdsDropLock && explicitChatId) {
      if (this.coordination?.isExternalChatBusy?.(userId, explicitChatId)) {
        throw new Error("A guided generation is already running in this chat.");
      }
      const candidateKey = this.compositeKey(key, explicitChatId);
      if (this.inFlightDrops.has(candidateKey) || this.isChatRunning(key, explicitChatId)) {
        throw new Error("A Guided Scene drop is already running in this chat.");
      }
      this.inFlightDrops.add(candidateKey);
      acquiredDropLockKey = candidateKey;
    }

    try {
      const chat = await this.resolveChatOrThrow(input.chatId, userId);
      if (!options.holdsDropLock && !acquiredDropLockKey) {
        if (this.coordination?.isExternalChatBusy?.(userId, chat.id)) {
          throw new Error("A guided generation is already running in this chat.");
        }
        const resolvedKey = this.compositeKey(key, chat.id);
        if (this.inFlightDrops.has(resolvedKey) || this.isChatRunning(key, chat.id)) {
          throw new Error("A Guided Scene drop is already running in this chat.");
        }
        this.inFlightDrops.add(resolvedKey);
        acquiredDropLockKey = resolvedKey;
      }

      if (!this.spindle.permissions.has("chat_mutation")) {
        throw new Error("Missing required 'chat_mutation' permission for Guided Scene.");
      }

      const settings = await this.store.getSettings(userId);
      this.onSettingsSaved(settings, userId);
      const config = settings.guidedScene;
      const keepMedia = input.keepMediaIntact ?? config.keepMediaIntact;
      const requestedTarget = normalizeSceneDropTarget(input.dropTarget, config.dropTarget);

      const speakerCharacterId =
        input.speakerCharacterId || (chat.character_id ? chat.character_id : undefined);
      const speakerCharacterName =
        input.speakerCharacterName ||
        (speakerCharacterId
          ? await this.resolveCharacterName(speakerCharacterId, userId)
          : undefined);

      const lockedCandidate =
        typeof input.lockedDraftText === "string" && input.lockedDraftText.trim().length > 0
          ? input.lockedDraftText
          : typeof input.previewText === "string" && input.previewText.trim().length > 0
            ? input.previewText
            : "";
      const useLockedDraft = Boolean(input.draftLocked && lockedCandidate.trim().length > 0);

      // Check ONLY the trailing message for new_swipe (fall back to new_message if last turn is user).
      let swipeTargetMessage: ChatMessageWithRole | null = null;
      let effectiveDropTarget: GuidedSceneDropTarget = requestedTarget;
      if (requestedTarget === "new_swipe") {
        const tail = await this.getChatMessagesWithOptions(chat.id, {
          tail: 1,
          includeExtra: true,
        });
        const trailing = tail[tail.length - 1];
        swipeTargetMessage = isAssistantMessage(trailing) ? trailing : null;
        if (!swipeTargetMessage) {
          effectiveDropTarget = "new_message";
        }
      }

      // Instant zero-LLM drop: locked draft OR verbatim + Hard Cut.
      if (useLockedDraft || (input.adjustmentMode === "verbatim" && input.delivery === "cut")) {
        const sourceText = useLockedDraft ? lockedCandidate : input.rawGreetingText;
        const finalText = await this.resolveSceneTextMacros({
          text: sourceText,
          chatId: chat.id,
          characterId: speakerCharacterId,
          speakerCharacterName,
          keepMediaIntact: keepMedia,
          userId,
        });

        if (effectiveDropTarget === "new_swipe" && swipeTargetMessage) {
          const { swipes, swipeDates } = normalizeMessageSwipes(swipeTargetMessage);
          const newSwipeIndex = swipes.length;
          const nextSwipes = [...swipes, finalText];
          const nextDates = [...swipeDates, Math.floor(Date.now() / 1000)];
          await this.spindle.chat.updateMessage(
            chat.id,
            swipeTargetMessage.id,
            buildActiveSwipePatch({
              swipes: nextSwipes,
              swipeIndex: newSwipeIndex,
              content: finalText,
              swipeDates: nextDates,
              skipChunkRebuild: false,
            }),
          );
          await this.clearArmedSceneAfterDrop(chat.id, userId);
          return {
            actionId: "guided_scene",
            chatId: chat.id,
            aborted: false,
            messageId: swipeTargetMessage.id,
            swipeId: newSwipeIndex,
            text: finalText,
            dropTarget: "new_swipe",
          };
        }

        const appended = await this.appendSceneAssistantMessage({
          chatId: chat.id,
          content: finalText,
          speakerCharacterId,
          speakerCharacterName,
        });
        await this.clearArmedSceneAfterDrop(chat.id, userId);
        return {
          actionId: "guided_scene",
          chatId: chat.id,
          aborted: false,
          messageId: appended.id,
          swipeId: 0,
          text: finalText,
          dropTarget: "new_message",
        };
      }

      // Streaming LLM drop (verbatim + time_skip/bridge OR context_adapt / summary_rewrite).
      this.assertGenerationPermissions(true);

      const controller = new AbortController();
      const runId = await this.createRunId();
      const startedAt = Date.now();
      const avatarUrl = speakerCharacterId
        ? `/api/v1/characters/${encodeURIComponent(speakerCharacterId)}/avatar?thumb=1`
        : undefined;

      this.setActiveRun(key, {
        state: {
          runId,
          actionId: "guided_scene",
          chatId: chat.id,
          startedAt,
          ...(speakerCharacterId ? { characterId: speakerCharacterId } : {}),
          ...(speakerCharacterName ? { characterName: speakerCharacterName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        controller,
      });
      this.emitStatus(userId, runId);

      let wasAborted = false;
      let completedText = "";
      let targetMessageId: string | undefined;
      let targetSwipeIndex = 0;
      let preSwipeSnapshot: {
        swipes: string[];
        swipeDates: number[];
        activeIndex: number;
        metadata?: Record<string, unknown>;
      } | null = null;
      let hadCommittedContent = false;

      const cleanupBlankSlot = async (): Promise<void> => {
        if (!targetMessageId || hadCommittedContent) return;
        try {
          if (effectiveDropTarget === "new_swipe" && preSwipeSnapshot) {
            await this.spindle.chat.updateMessage(chat.id, targetMessageId, {
              content: preSwipeSnapshot.swipes[preSwipeSnapshot.activeIndex] ?? "",
              swipes: preSwipeSnapshot.swipes,
              swipe_id: preSwipeSnapshot.activeIndex,
              swipe_dates: preSwipeSnapshot.swipeDates,
              metadata: preSwipeSnapshot.metadata ?? {},
              skipChunkRebuild: true,
            });
          } else if (
            effectiveDropTarget === "new_message" &&
            typeof this.spindle.chat.deleteMessage === "function"
          ) {
            await this.spindle.chat.deleteMessage(chat.id, targetMessageId);
          }
        } catch {
          // Best-effort cleanup of empty slot on 0-output abort/error.
        }
        targetMessageId = undefined;
      };

      try {
        const mode: SceneRewriteMode =
          input.adjustmentMode === "verbatim"
            ? "verbatim_bridge"
            : input.adjustmentMode === "summary_rewrite"
              ? "summary_rewrite"
              : "context_adapt";

        const prepared = await this.prepareSceneLlmRequest({
          chat,
          config,
          mode,
          delivery: input.delivery,
          rawGreetingText: input.rawGreetingText,
          speakerCharacterId,
          speakerCharacterName,
          transitionNote: input.transitionNote,
          customDirection: input.customDirection,
          keepMediaIntact: keepMedia,
          activeConnectionId: input.activeConnectionId,
          excludeMessageId:
            effectiveDropTarget === "new_swipe" ? swipeTargetMessage?.id : undefined,
          signal: controller.signal,
          userId,
        });

        if (controller.signal.aborted) {
          wasAborted = true;
          return {
            runId,
            actionId: "guided_scene",
            chatId: chat.id,
            aborted: true,
            text: "",
            dropTarget: effectiveDropTarget,
          };
        }

        // Create the target slot (new message or new swipe).
        let swipes: string[];
        let swipeDates: number[];
        const nowSec = Math.floor(Date.now() / 1000);

        if (effectiveDropTarget === "new_swipe" && swipeTargetMessage) {
          const norm = normalizeMessageSwipes(swipeTargetMessage);
          preSwipeSnapshot = {
            swipes: [...norm.swipes],
            swipeDates: [...norm.swipeDates],
            activeIndex: norm.activeIndex,
            ...(swipeTargetMessage.metadata
              ? { metadata: { ...swipeTargetMessage.metadata } }
              : {}),
          };
          targetMessageId = swipeTargetMessage.id;
          targetSwipeIndex = norm.swipes.length;
          swipes = [...norm.swipes, ""];
          swipeDates = [...norm.swipeDates, nowSec];
          const metadata = prepared.presetContext.presetId
            ? buildPresetContextMetadata(
                swipeTargetMessage.metadata,
                targetSwipeIndex,
                prepared.presetContext.presetId,
              )
            : undefined;
          await this.spindle.chat.updateMessage(
            chat.id,
            targetMessageId,
            buildActiveSwipePatch({
              swipes,
              swipeIndex: targetSwipeIndex,
              content: "",
              swipeDates,
              ...(metadata ? { metadata } : {}),
              skipChunkRebuild: true,
            }),
          );
        } else {
          const metadata = prepared.presetContext.presetId
            ? buildPresetContextMetadata(undefined, 0, prepared.presetContext.presetId)
            : undefined;
          const created = await this.appendSceneAssistantMessage({
            chatId: chat.id,
            content: "",
            speakerCharacterId,
            speakerCharacterName,
            metadata,
          });
          targetMessageId = created.id;
          targetSwipeIndex = 0;
          swipes = [""];
          swipeDates = [nowSec];
        }

        this.updateActiveRunState(userId, runId, {
          messageId: targetMessageId,
          swipeId: targetSwipeIndex,
        });

        const formatStreamingContent = (rawDelta: string, isFinal: boolean): string => {
          if (mode === "verbatim_bridge") {
            return combineBridgeAndVerbatimScene(
              rawDelta,
              prepared.resolvedVerbatimScene,
              input.delivery,
            );
          }
          if (keepMedia && prepared.mediaSlots.length > 0) {
            return isFinal
              ? restoreMediaSlots(rawDelta, prepared.mediaSlots)
              : previewRestoreEmittedMediaSlots(rawDelta, prepared.mediaSlots);
          }
          return rawDelta;
        };

        const { wasStreaming, outboundInput } = prepareOutboundGenerationInput(prepared.rawInput);
        let deltaText = "";
        let reasoningText = "";
        let streamingStartedAt = Date.now();
        let firstTokenAt: number | undefined;
        let firstContentTokenAt: number | undefined;
        let lastProviderContentAt: number | undefined;
        let responseStoppedAt: number | undefined;
        let completedAt: number | undefined;
        let streamUsage: GenerationUsageInput | undefined;
        let lastFlushAt = 0;
        let notifiedContent = false;

        const flushToTarget = async (content: string, skipChunkRebuild: boolean) => {
          if (!targetMessageId) return;
          swipes[targetSwipeIndex] = content;
          await this.spindle.chat.updateMessage(
            chat.id,
            targetMessageId,
            buildActiveSwipePatch({
              swipes,
              swipeIndex: targetSwipeIndex,
              content,
              swipeDates,
              skipChunkRebuild,
            }),
          );
        };

        try {
          if (wasStreaming && typeof this.spindle.generate.rawStream === "function") {
            const stream = this.spindle.generate.rawStream(outboundInput);
            streamingStartedAt = Date.now();
            for await (const chunk of stream) {
              if (controller.signal.aborted) {
                wasAborted = true;
                break;
              }
              if (chunk.type === "token") {
                const now = Date.now();
                if (chunk.token.length > 0) {
                  if (firstTokenAt === undefined) firstTokenAt = now;
                  if (firstContentTokenAt === undefined && /\S/.test(chunk.token)) {
                    firstContentTokenAt = now;
                  }
                }
                lastProviderContentAt = now;
                deltaText += chunk.token;
                if (!notifiedContent && deltaText.length > 0) {
                  notifiedContent = true;
                  this.updateActiveRunState(userId, runId, { hasContentOutput: true });
                }
                if (now - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
                  lastFlushAt = now;
                  await flushToTarget(formatStreamingContent(deltaText, false), true);
                }
              } else if (chunk.type === "reasoning") {
                const now = Date.now();
                if (chunk.token.length > 0 && firstTokenAt === undefined) {
                  firstTokenAt = now;
                }
                reasoningText += chunk.token;
              } else if (chunk.type === "done") {
                if (chunk.content) deltaText = chunk.content;
                if (chunk.reasoning) reasoningText = chunk.reasoning;
                if (chunk.usage) streamUsage = chunk.usage as GenerationUsageInput;
              }
            }
            if (!wasAborted && !controller.signal.aborted) {
              responseStoppedAt = Math.max(Date.now(), lastProviderContentAt ?? 0);
            } else {
              wasAborted = true;
            }
          } else {
            streamingStartedAt = Date.now();
            const rawResp = await this.spindle.generate.raw(outboundInput);
            if (controller.signal.aborted) {
              wasAborted = true;
            } else {
              const resp = asGenerationResponse(rawResp);
              if (typeof resp.content === "string") deltaText = resp.content;
              if (typeof resp.reasoning === "string") reasoningText = resp.reasoning;
              if (resp.usage && typeof resp.usage === "object") {
                streamUsage = resp.usage as GenerationUsageInput;
              }
              if (deltaText.length > 0) {
                this.updateActiveRunState(userId, runId, { hasContentOutput: true });
              }
              responseStoppedAt = Date.now();
            }
          }
        } catch (err) {
          if (isAbortError(err) || controller.signal.aborted) {
            wasAborted = true;
          } else {
            throw err;
          }
        }

        // Treat zero-token aborts as clean rollback across ALL modes (including verbatim_bridge).
        const isAbortedZeroOutput =
          (wasAborted || controller.signal.aborted) && deltaText.length === 0;

        const finalText = isAbortedZeroOutput
          ? ""
          : await this.finalizeGeneratedSceneText({
              rawOutput: deltaText,
              mode,
              delivery: input.delivery,
              resolvedVerbatimScene: prepared.resolvedVerbatimScene,
              mediaSlots: prepared.mediaSlots,
              keepMediaIntact: keepMedia,
              applyRegex: config.applyRegex,
              chatId: chat.id,
              characterId: speakerCharacterId,
              userId,
            });

        completedText = finalText;
        if (isAbortedZeroOutput || (finalText.length === 0 && mode !== "verbatim_bridge")) {
          await cleanupBlankSlot();
        } else if (targetMessageId) {
          await flushToTarget(finalText, false);
          hadCommittedContent = true;
        }

        if (!wasAborted && !controller.signal.aborted) {
          completedAt = Date.now();
          await this.clearArmedSceneAfterDrop(chat.id, userId);
        } else {
          wasAborted = true;
        }

        const timingSource: GenerationTimingSource = {
          streamingStartedAt,
          ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
          ...(firstContentTokenAt !== undefined ? { firstContentTokenAt } : {}),
          ...(responseStoppedAt !== undefined ? { responseStoppedAt } : {}),
          ...(completedAt !== undefined ? { completedAt } : {}),
          wasStreaming,
        };

        if (!wasAborted && targetMessageId && finalText.length > 0) {
          await this.emitMetricsForCompletedStream({
            chatId: chat.id,
            userId,
            messageId: targetMessageId,
            swipeId: targetSwipeIndex,
            finalText,
            rawDeltaText: deltaText,
            hasReasoning: reasoningText.length > 0,
            usage: streamUsage,
            timingSource,
            model: prepared.rawInput.model,
            provider: prepared.rawInput.provider,
            presetId: prepared.presetContext.presetId,
            presetName: prepared.presetContext.presetName,
          });
        }

        return {
          runId,
          actionId: "guided_scene",
          chatId: chat.id,
          aborted: wasAborted,
          ...(targetMessageId ? { messageId: targetMessageId, swipeId: targetSwipeIndex } : {}),
          text: finalText,
          dropTarget: effectiveDropTarget,
        };
      } catch (error) {
        await cleanupBlankSlot();
        const message = error instanceof Error ? error.message : String(error);
        const activeState = this.activeRuns.get(key)?.get(runId)?.state;
        this.deleteActiveRun(key, runId);
        const finishedAt = Date.now();
        this.recordTerminalRun(userId, {
          runId,
          actionId: "guided_scene",
          chatId: chat.id,
          status: "error",
          error: message,
          startedAt,
          finishedAt,
        });
        void this.dispatchPushNotification({
          userId,
          chatId: chat.id,
          status: "error",
          errorMessage: message,
          characterId: activeState?.characterId,
          characterName: activeState?.characterName,
        });
        this.emitFrontend(
          {
            type: "gg:status",
            error: message,
            run: this.getActiveRun(userId, chat.id),
            chatId: chat.id,
          },
          userId,
        );
        throw error;
      } finally {
        const activeState = this.activeRuns.get(key)?.get(runId)?.state;
        const deletedActive = this.deleteActiveRun(key, runId);
        const finalAborted = wasAborted || controller.signal.aborted;
        if (deletedActive) {
          const finishedAt = Date.now();
          this.recordTerminalRun(userId, {
            runId,
            actionId: "guided_scene",
            chatId: chat.id,
            status: finalAborted ? "aborted" : "done",
            startedAt,
            finishedAt,
          });
          if (!finalAborted) {
            void this.dispatchPushNotification({
              userId,
              chatId: chat.id,
              status: "done",
              content: completedText,
              characterId: activeState?.characterId,
              characterName: activeState?.characterName,
            });
          }
          this.emitFrontend(
            {
              type: "gg:status",
              run: this.getActiveRun(userId),
              chatId: chat.id,
              done: !finalAborted,
              aborted: finalAborted,
            },
            userId,
          );
        }
      }
    } finally {
      if (acquiredDropLockKey) {
        this.inFlightDrops.delete(acquiredDropLockKey);
      }
    }
  }

  async armScene(input: ArmSceneInput, userId?: string): Promise<ArmedSceneState> {
    if (!this.spindle.permissions.has("interceptor")) {
      throw new Error(
        "Missing required 'interceptor' permission to arm Next-Turn or Multi-Turn Guided Scene steering.",
      );
    }
    if (!this.spindle.permissions.has("chat_mutation")) {
      throw new Error("Missing required 'chat_mutation' permission for Guided Scene.");
    }

    const lockedCandidate =
      typeof input.lockedDraftText === "string"
        ? input.lockedDraftText
        : typeof input.previewText === "string"
          ? input.previewText
          : null;
    const draftLocked = Boolean(
      input.draftLocked && lockedCandidate && lockedCandidate.trim().length > 0,
    );
    this.assertNonEmptySceneText(input.rawGreetingText, {
      draftLocked,
      lockedDraftText: lockedCandidate,
    });

    const chat = await this.resolveChatOrThrow(input.chatId, userId);
    await this.hydrateUserArmedScenes(userId);
    const key = this.userKey(userId);

    return this.withArmedSceneLock(key, chat.id, async () => {
      const settings = await this.store.getSettings(userId);
      this.onSettingsSaved(settings, userId);

      const speakerCharacterId =
        input.speakerCharacterId ||
        (chat.character_id ? chat.character_id : null);
      const speakerCharacterName =
        input.speakerCharacterName ||
        (speakerCharacterId
          ? (await this.resolveCharacterName(speakerCharacterId, userId)) ?? null
          : null);

      const armed: ArmedSceneState = {
        chatId: chat.id,
        ...(userId ? { userId } : {}),
        status: "armed",
        pacing: normalizeSceneArmedPacing(input.pacing, "next_turn"),
        delivery: normalizeSceneDelivery(input.delivery, settings.guidedScene.delivery),
        adjustmentMode: normalizeSceneAdjustmentMode(
          input.adjustmentMode,
          settings.guidedScene.adjustmentMode,
        ),
        greetingSource: input.greetingSource === "custom" ? "custom" : "card",
        selectedGreetingKey: input.selectedGreetingKey ?? null,
        greetingLabel:
          typeof input.greetingLabel === "string" && input.greetingLabel.trim().length > 0
            ? input.greetingLabel.trim()
            : input.greetingSource === "custom"
              ? "Custom Scene"
              : "Scene Greeting",
        rawGreetingText: input.rawGreetingText,
        speakerCharacterId,
        speakerCharacterName,
        transitionNote: typeof input.transitionNote === "string" ? input.transitionNote : "",
        customDirection: typeof input.customDirection === "string" ? input.customDirection : "",
        keepMediaIntact: input.keepMediaIntact ?? settings.guidedScene.keepMediaIntact,
        lockedDraftText: draftLocked ? lockedCandidate : null,
        draftLocked,
        armedAt: Date.now(),
        turnsSteered: 0,
      };

      const saved = await this.store.saveArmedScene(armed, userId);
      this.setInMemoryArmedScene(key, saved);
      this.ensureInterceptorRegistered();
      this.emitSceneUpdated(chat.id, saved, userId, "armed");
      return { ...saved };
    });
  }

  async updateArmedScene(
    input: UpdateArmedSceneInput,
    userId?: string,
  ): Promise<ArmedSceneState> {
    const chat = await this.resolveChatOrThrow(input.chatId, userId);
    await this.hydrateUserArmedScenes(userId);
    const key = this.userKey(userId);

    return this.withArmedSceneLock(key, chat.id, async () => {
      const existing = this.armedByUser.get(key)?.get(chat.id);
      if (!existing) {
        throw new Error("No Guided Scene is currently armed for this chat.");
      }

      const nextLockedText =
        input.lockedDraftText !== undefined
          ? input.lockedDraftText
          : input.previewText !== undefined
            ? input.previewText
            : existing.lockedDraftText;
      const nextDraftLocked =
        input.draftLocked !== undefined
          ? Boolean(input.draftLocked && nextLockedText && nextLockedText.trim().length > 0)
          : existing.draftLocked;
      const nextRawGreetingText =
        input.rawGreetingText !== undefined ? input.rawGreetingText : existing.rawGreetingText;

      this.assertNonEmptySceneText(nextRawGreetingText, {
        draftLocked: nextDraftLocked,
        lockedDraftText: nextLockedText,
      });

      const updated: ArmedSceneState = {
        ...existing,
        ...(input.pacing !== undefined
          ? { pacing: normalizeSceneArmedPacing(input.pacing, existing.pacing) }
          : {}),
        ...(input.delivery !== undefined
          ? { delivery: normalizeSceneDelivery(input.delivery, existing.delivery) }
          : {}),
        ...(input.adjustmentMode !== undefined
          ? {
              adjustmentMode: normalizeSceneAdjustmentMode(
                input.adjustmentMode,
                existing.adjustmentMode,
              ),
            }
          : {}),
        ...(input.greetingSource !== undefined
          ? { greetingSource: input.greetingSource === "custom" ? "custom" : "card" }
          : {}),
        ...(input.selectedGreetingKey !== undefined
          ? { selectedGreetingKey: input.selectedGreetingKey }
          : {}),
        ...(input.greetingLabel !== undefined && input.greetingLabel.trim().length > 0
          ? { greetingLabel: input.greetingLabel.trim() }
          : {}),
        ...(input.rawGreetingText !== undefined
          ? { rawGreetingText: input.rawGreetingText }
          : {}),
        ...(input.speakerCharacterId !== undefined
          ? { speakerCharacterId: input.speakerCharacterId }
          : {}),
        ...(input.speakerCharacterName !== undefined
          ? { speakerCharacterName: input.speakerCharacterName }
          : {}),
        ...(input.transitionNote !== undefined ? { transitionNote: input.transitionNote } : {}),
        ...(input.customDirection !== undefined ? { customDirection: input.customDirection } : {}),
        ...(typeof input.keepMediaIntact === "boolean"
          ? { keepMediaIntact: input.keepMediaIntact }
          : {}),
        lockedDraftText: nextDraftLocked ? nextLockedText : null,
        draftLocked: nextDraftLocked,
      };

      const saved = await this.store.saveArmedScene(updated, userId);
      this.setInMemoryArmedScene(key, saved);
      this.emitSceneUpdated(chat.id, saved, userId, "updated");
      return { ...saved };
    });
  }

  async pauseScene(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<ArmedSceneState | null> {
    const explicitChatId =
      typeof requestedChatId === "string" && requestedChatId.trim().length > 0
        ? requestedChatId.trim()
        : null;
    const chatId = explicitChatId ?? (await this.resolveChatOrThrow(requestedChatId, userId)).id;
    await this.hydrateUserArmedScenes(userId);
    const key = this.userKey(userId);

    return this.withArmedSceneLock(key, chatId, async () => {
      const existing = this.armedByUser.get(key)?.get(chatId);
      if (!existing) return null;

      const updated: ArmedSceneState = {
        ...existing,
        status: "paused",
      };
      const saved = await this.store.saveArmedScene(updated, userId);
      this.setInMemoryArmedScene(key, saved);
      this.releaseInterceptorIfIdle();
      this.emitSceneUpdated(chatId, saved, userId, "paused");
      return { ...saved };
    });
  }

  async resumeScene(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<ArmedSceneState | null> {
    if (!this.spindle.permissions.has("interceptor")) {
      throw new Error("Missing required 'interceptor' permission to resume Guided Scene steering.");
    }
    const chat = await this.resolveChatOrThrow(requestedChatId, userId);
    await this.hydrateUserArmedScenes(userId);
    const key = this.userKey(userId);

    return this.withArmedSceneLock(key, chat.id, async () => {
      const existing = this.armedByUser.get(key)?.get(chat.id);
      if (!existing) return null;

      const updated: ArmedSceneState = {
        ...existing,
        status: "armed",
      };
      const saved = await this.store.saveArmedScene(updated, userId);
      this.setInMemoryArmedScene(key, saved);
      this.ensureInterceptorRegistered();
      this.emitSceneUpdated(chat.id, saved, userId, "resumed");
      return { ...saved };
    });
  }

  async dropNextTurn(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<ArmedSceneState | null> {
    if (!this.spindle.permissions.has("interceptor")) {
      throw new Error(
        "Missing required 'interceptor' permission to switch Guided Scene to Next Turn.",
      );
    }
    const chat = await this.resolveChatOrThrow(requestedChatId, userId);
    await this.hydrateUserArmedScenes(userId);
    const key = this.userKey(userId);

    return this.withArmedSceneLock(key, chat.id, async () => {
      const existing = this.armedByUser.get(key)?.get(chat.id);
      if (!existing) return null;

      const updated: ArmedSceneState = {
        ...existing,
        status: "armed",
        pacing: "next_turn",
      };
      const saved = await this.store.saveArmedScene(updated, userId);
      this.setInMemoryArmedScene(key, saved);
      this.ensureInterceptorRegistered();
      this.emitSceneUpdated(chat.id, saved, userId, "drop_next_turn");
      return { ...saved };
    });
  }

  async cancelScene(
    requestedChatId?: string | null,
    userId?: string,
  ): Promise<{ cancelled: boolean; chatId: string }> {
    const explicitChatId =
      typeof requestedChatId === "string" && requestedChatId.trim().length > 0
        ? requestedChatId.trim()
        : null;
    const chatId = explicitChatId ?? (await this.resolveChatOrThrow(requestedChatId, userId)).id;
    const key = this.userKey(userId);

    return this.withArmedSceneLock(key, chatId, async () => {
      const existedInMemory = this.deleteInMemoryArmedScene(key, chatId);
      const existedOnDisk =
        !existedInMemory && !this.hydratedUsers.has(key)
          ? Boolean(await this.store.getArmedScene(chatId, userId).catch(() => null))
          : false;
      await this.store.deleteArmedScene(chatId, userId);
      this.releaseInterceptorIfIdle();
      this.emitSceneUpdated(chatId, null, userId, "cancelled");
      return { cancelled: existedInMemory || existedOnDisk, chatId };
    });
  }

  async closeDrawer(userId?: string): Promise<CloseDrawerResult> {
    const closeFn = this.spindle.ui?.closeDrawer;
    if (typeof closeFn !== "function") {
      return { closed: false };
    }
    try {
      await closeFn.call(this.spindle.ui, userId ? { userId } : undefined);
      return { closed: true };
    } catch {
      return { closed: false };
    }
  }

  getActiveRuns(userId?: string): ActiveRunState[] {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    if (!userRuns || userRuns.size === 0) return [];
    return Array.from(userRuns.values(), (run) => ({ ...run.state }));
  }

  getActiveRun(userId?: string, chatId?: string): ActiveRunState | null {
    const userRuns = this.activeRuns.get(this.userKey(userId));
    if (!userRuns || userRuns.size === 0) return null;
    if (typeof chatId === "string" && chatId.length > 0) {
      for (const run of userRuns.values()) {
        if (run.state.chatId === chatId) return { ...run.state };
      }
      return null;
    }
    const runs = Array.from(userRuns.values());
    const latest = runs[runs.length - 1];
    return latest ? { ...latest.state } : null;
  }

  getRecentTerminalRuns(userId?: string): TerminalRunSummary[] {
    const key = this.userKey(userId);
    const now = Date.now();
    const existing = this.recentTerminalRuns.get(key);
    if (!existing || existing.length === 0) return [];
    const fresh = existing.filter((entry) => now - entry.finishedAt <= TERMINAL_RUN_TTL_MS);
    if (fresh.length === 0) {
      this.recentTerminalRuns.delete(key);
      return [];
    }
    if (fresh.length !== existing.length) {
      this.recentTerminalRuns.set(key, fresh);
    }
    return fresh.map((entry) => ({ ...entry }));
  }

  abortCurrent(userId?: string, runId?: string, chatId?: string): boolean {
    const key = this.userKey(userId);
    const trimmedChatId =
      typeof chatId === "string" && chatId.trim().length > 0 ? chatId.trim() : undefined;
    let aborted = false;

    const userRuns = this.activeRuns.get(key);
    if (userRuns && userRuns.size > 0) {
      if (runId) {
        const target = userRuns.get(runId);
        if (target) {
          target.controller.abort();
          return true;
        }
      } else {
        const runs = Array.from(userRuns.values());
        const target = trimmedChatId
          ? [...runs].reverse().find((run) => run.state.chatId === trimmedChatId)
          : runs[runs.length - 1];
        if (target) {
          target.controller.abort();
          aborted = true;
        }
      }
    }

    // Also abort any matching in-flight previewSceneDraft requests.
    if (!runId) {
      if (trimmedChatId) {
        const controllers = this.previewControllers.get(this.compositeKey(key, trimmedChatId));
        if (controllers && controllers.size > 0) {
          for (const ctrl of [...controllers]) {
            ctrl.abort();
            aborted = true;
          }
        }
      } else {
        const prefix = `${key}::`;
        for (const [compKey, controllers] of this.previewControllers.entries()) {
          if (!compKey.startsWith(prefix)) continue;
          for (const ctrl of [...controllers]) {
            ctrl.abort();
            aborted = true;
          }
        }
      }
    }

    return aborted;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.lifecycleDisposers.splice(0)) {
      try {
        d();
      } catch {
        // Ignore disposer errors.
      }
    }
    for (const userRuns of this.activeRuns.values()) {
      for (const run of userRuns.values()) {
        run.controller.abort();
      }
      userRuns.clear();
    }
    this.activeRuns.clear();
    for (const controllers of this.previewControllers.values()) {
      for (const ctrl of controllers) {
        ctrl.abort();
      }
      controllers.clear();
    }
    this.previewControllers.clear();
    this.recentTerminalRuns.clear();
    this.armedByUser.clear();
    this.armedChatOwners.clear();
    this.hydratedUsers.clear();
    this.hydrationInFlight.clear();
    this.mutatedDuringHydration.clear();
    this.readinessTagByUser.clear();
    this.droppedTriggerKeys.clear();
    this.ownDropMessageIds.clear();
    this.inFlightDrops.clear();
    this.pendingDryRunCaptures.clear();
    if (!this.coordination?.chatDryRunQueues) {
      this.chatDryRunQueues.clear();
    }
    this.armedSceneLocks.clear();
    this.disposeInterceptor();
  }

  private assertGenerationPermissions(requireMutation: boolean): void {
    if (!this.spindle.permissions.has("generation")) {
      throw new Error("Missing required 'generation' permission for Guided Scene.");
    }
    if (!this.spindle.permissions.has("chats")) {
      throw new Error("Missing required 'chats' permission for Guided Scene.");
    }
    if (requireMutation && !this.spindle.permissions.has("chat_mutation")) {
      throw new Error("Missing required 'chat_mutation' permission for Guided Scene.");
    }
  }

  private isChatRunning(userKey: string, chatId: string): boolean {
    const userRuns = this.activeRuns.get(userKey);
    if (!userRuns) return false;
    for (const run of userRuns.values()) {
      if (run.state.chatId === chatId) return true;
    }
    return false;
  }

  private setActiveRun(userKey: string, run: InternalSceneRun): void {
    let userRuns = this.activeRuns.get(userKey);
    if (!userRuns) {
      userRuns = new Map<string, InternalSceneRun>();
      this.activeRuns.set(userKey, userRuns);
    }
    userRuns.set(run.state.runId, run);
  }

  private deleteActiveRun(userKey: string, runId: string): boolean {
    const userRuns = this.activeRuns.get(userKey);
    if (!userRuns || !userRuns.has(runId)) return false;
    userRuns.delete(runId);
    if (userRuns.size === 0) {
      this.activeRuns.delete(userKey);
    }
    return true;
  }

  private updateActiveRunState(
    userId: string | undefined,
    runId: string,
    patch: Partial<ActiveRunState>,
  ): void {
    const active = this.activeRuns.get(this.userKey(userId))?.get(runId);
    if (!active) return;
    active.state = { ...active.state, ...patch };
    this.emitStatus(userId, runId);
  }

  private emitStatus(userId?: string, runId?: string): void {
    const key = this.userKey(userId);
    const active = runId ? this.activeRuns.get(key)?.get(runId)?.state : undefined;
    const run = active ? { ...active } : this.getActiveRun(userId);
    this.emitFrontend(
      {
        type: "gg:status",
        run,
        ...(run?.chatId ? { chatId: run.chatId } : {}),
      },
      userId,
    );
  }

  private recordTerminalRun(userId: string | undefined, summary: TerminalRunSummary): void {
    const key = this.userKey(userId);
    const existing = this.getRecentTerminalRuns(userId);
    if (existing.some((entry) => entry.runId === summary.runId)) return;
    this.recentTerminalRuns.set(
      key,
      [{ ...summary }, ...existing].slice(0, TERMINAL_RUN_MAX_ENTRIES),
    );
  }

  private async appendSceneAssistantMessage(args: {
    chatId: string;
    content: string;
    speakerCharacterId?: string;
    speakerCharacterName?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const caps = this.spindle.host?.capabilities;
    const supportsIdentity = !caps || Boolean(caps["chat-append-identity-v1"]);
    const basePayload: ChatAppendMessageDTO = {
      role: "assistant",
      content: args.content,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    };
    const withIdentity =
      supportsIdentity && (args.speakerCharacterName || args.speakerCharacterId);
    const payload: ChatAppendMessageDTO = withIdentity
      ? {
          ...basePayload,
          ...(args.speakerCharacterName ? { name: args.speakerCharacterName } : {}),
          ...(args.speakerCharacterId ? { characterId: args.speakerCharacterId } : {}),
        }
      : basePayload;

    let created: { id: string };
    try {
      created = await this.spindle.chat.appendMessage(args.chatId, payload, {
        triggerGeneration: false,
      });
    } catch (err) {
      if (!withIdentity) throw err;
      created = await this.spindle.chat.appendMessage(args.chatId, basePayload, {
        triggerGeneration: false,
      });
    }
    if (created?.id) {
      this.rememberOwnDropMessageId(created.id);
    }
    return created;
  }

  private async resolveCharacterName(
    characterId?: string,
    userId?: string,
  ): Promise<string | undefined> {
    if (!characterId || !this.spindle.permissions?.has?.("characters")) return undefined;
    if (typeof this.spindle.characters?.get !== "function") return undefined;
    try {
      const ch = await this.spindle.characters.get(characterId, userId);
      return typeof ch?.name === "string" && ch.name.trim().length > 0
        ? ch.name.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveMacroNames(args: {
    chatId: string;
    characterId?: string;
    speakerCharacterName?: string;
    userId?: string;
  }): Promise<{ charName?: string; userName?: string }> {
    let effectiveCharacterId = args.characterId;
    if (
      !args.speakerCharacterName?.trim() &&
      !effectiveCharacterId &&
      this.spindle.permissions?.has?.("chats")
    ) {
      try {
        const chat = await this.spindle.chats.get(args.chatId, args.userId);
        if (typeof chat?.character_id === "string" && chat.character_id.trim().length > 0) {
          effectiveCharacterId = chat.character_id.trim();
        }
      } catch {
        // Best-effort chat character fallback.
      }
    }

    const charName =
      args.speakerCharacterName?.trim() ||
      (effectiveCharacterId
        ? await this.resolveCharacterName(effectiveCharacterId, args.userId)
        : undefined);

    let userName: string | undefined;
    if (typeof this.spindle.macros?.resolve === "function") {
      try {
        const res = await this.spindle.macros.resolve("{{user}}", {
          chatId: args.chatId,
          ...(effectiveCharacterId ? { characterId: effectiveCharacterId } : {}),
          ...(args.userId ? { userId: args.userId } : {}),
          commit: false,
        });
        if (
          typeof res?.text === "string" &&
          res.text.trim().length > 0 &&
          !/^\{\{\s*user\s*\}\}$/i.test(res.text.trim())
        ) {
          userName = res.text.trim();
        }
      } catch {
        // Ignore macro lookup failures.
      }
    }

    return {
      ...(charName ? { charName } : {}),
      ...(userName ? { userName } : {}),
    };
  }

  private async resolveSceneTextMacros(args: {
    text: string;
    chatId: string;
    characterId?: string;
    speakerCharacterName?: string;
    keepMediaIntact: boolean;
    userId?: string;
  }): Promise<string> {
    if (!args.text) return "";

    const extracted = args.keepMediaIntact
      ? extractMediaSlots(args.text)
      : { text: args.text, slots: [] as MediaSlot[], hasMedia: false };

    const names = await this.resolveMacroNames({
      chatId: args.chatId,
      characterId: args.characterId,
      speakerCharacterName: args.speakerCharacterName,
      userId: args.userId,
    });

    // Apply owner-aware {{char}}/{{user}} substitution first so group speakers win.
    let resolved = resolveGreetingMacros(extracted.text, names);

    if (resolved.includes("{{") && typeof this.spindle.macros?.resolve === "function") {
      try {
        const res = await this.spindle.macros.resolve(resolved, {
          chatId: args.chatId,
          ...(args.characterId ? { characterId: args.characterId } : {}),
          ...(args.userId ? { userId: args.userId } : {}),
          commit: false,
        });
        if (typeof res?.text === "string") {
          resolved = res.text;
        }
      } catch {
        // Keep owner-resolved text on macro error.
      }
    }

    return args.keepMediaIntact && extracted.slots.length > 0
      ? restoreMediaSlots(resolved, extracted.slots)
      : resolved;
  }

  private async prepareSceneLlmRequest(args: {
    chat: ChatDTO;
    config: GuidedSceneConfig;
    mode: SceneRewriteMode;
    delivery: GuidedSceneDelivery;
    rawGreetingText: string;
    speakerCharacterId?: string;
    speakerCharacterName?: string;
    transitionNote?: string;
    customDirection?: string;
    keepMediaIntact: boolean;
    activeConnectionId?: string | null;
    excludeMessageId?: string;
    signal: AbortSignal;
    userId?: string;
  }): Promise<{
    mode: SceneRewriteMode;
    rawInput: GenerationRequestWithSignal;
    mediaSlots: MediaSlot[];
    resolvedVerbatimScene: string;
    presetContext: {
      presetId: string | null;
      presetName?: string;
      presetStreaming?: boolean;
    };
  }> {
    const { chat, config, mode, userId } = args;
    const effectiveCharId = args.speakerCharacterId || chat.character_id || undefined;

    const [resolvedConnection, presetContext, names] = await Promise.all([
      this.resolveConnection(config.connectionId, args.activeConnectionId, userId),
      this.resolvePresetContext(config.presetId, chat.id, userId),
      this.resolveMacroNames({
        chatId: chat.id,
        characterId: effectiveCharId,
        speakerCharacterName: args.speakerCharacterName,
        userId,
      }),
    ]);

    // Extract media slots before macro resolution when keepMediaIntact is true so URLs/HTML remain untouched.
    const extracted = args.keepMediaIntact
      ? extractMediaSlots(args.rawGreetingText)
      : { text: args.rawGreetingText, slots: [] as MediaSlot[], hasMedia: false };

    let resolvedSlottedText = resolveGreetingMacros(extracted.text, names);
    if (resolvedSlottedText.includes("{{") && typeof this.spindle.macros?.resolve === "function") {
      try {
        const res = await this.spindle.macros.resolve(resolvedSlottedText, {
          chatId: chat.id,
          ...(effectiveCharId ? { characterId: effectiveCharId } : {}),
          ...(userId ? { userId } : {}),
          commit: false,
        });
        if (typeof res?.text === "string") {
          resolvedSlottedText = res.text;
        }
      } catch {
        // Keep owner-resolved text.
      }
    }

    const resolvedVerbatimScene =
      args.keepMediaIntact && extracted.slots.length > 0
        ? restoreMediaSlots(resolvedSlottedText, extracted.slots)
        : resolvedSlottedText;

    let messages: LlmMessageDTO[];
    let parameters: Record<string, unknown> | undefined;
    let dryRunModel: string | undefined;
    let dryRunProvider: string | undefined;

    if (config.contextMode === "full_preset") {
      const dryRunInput: DryRunRequestWithOverride = {
        chatId: chat.id,
        generationType: args.excludeMessageId ? "swipe" : "normal",
        includeRequestMessages: true,
        ...(resolvedConnection?.id ? { connectionId: resolvedConnection.id } : {}),
        ...(config.presetId ? { presetId: config.presetId, forcePresetId: true } : {}),
      };
      const { result: dryRunResult, capturedMessages } = await this.runDryRunWithCapture(
        chat.id,
        dryRunInput,
        userId,
      );
      dryRunModel = dryRunResult.model;
      dryRunProvider = dryRunResult.provider;
      parameters = dryRunResult.parameters;

      // Prefer post-processed request_messages when available; fall back to captured or messages.
      let presetMessages: AssembledLlmMessageDTO[] =
        Array.isArray(dryRunResult.request_messages) && dryRunResult.request_messages.length > 0
          ? (dryRunResult.request_messages as AssembledLlmMessageDTO[])
          : capturedMessages && capturedMessages.length > 0
            ? capturedMessages
            : (dryRunResult.messages as AssembledLlmMessageDTO[]);

      if (args.excludeMessageId && presetMessages.length > 0) {
        const isChatHistory = resolveChatHistoryFlags(presetMessages, {
          breakdown: dryRunResult.breakdown,
        });
        presetMessages = stripRejectedSwipeAssistantTurnWithHistory(
          presetMessages,
          args.excludeMessageId,
          isChatHistory,
        ).messages;
      }

      const rawFullMessages = buildRewriteMessages({
        mode,
        contextMode: "full_preset",
        delivery: args.delivery,
        targetSceneText: resolvedSlottedText,
        hasMediaSlots: extracted.hasMedia,
        mediaSlotTokens: extracted.slots.map((s) => s.token),
        transitionNote: args.transitionNote,
        customDirection: args.customDirection,
        config,
        names,
        presetMessages,
      });
      messages = stripInternalMessageMarkers(
        mergeConsecutiveSameRoleMessages(rawFullMessages as AssembledLlmMessageDTO[]),
      );
    } else {
      const [character, persona, recentHistory] = await Promise.all([
        this.loadLightweightCharacter(effectiveCharId, userId),
        this.loadLightweightPersona(chat.id, effectiveCharId, names.userName, userId),
        this.loadRecentHistoryTurns(chat.id, config.contextTurns, args.excludeMessageId),
      ]);

      messages = buildRewriteMessages({
        mode,
        contextMode: "lightweight",
        delivery: args.delivery,
        targetSceneText: resolvedSlottedText,
        hasMediaSlots: extracted.hasMedia,
        mediaSlotTokens: extracted.slots.map((s) => s.token),
        transitionNote: args.transitionNote,
        customDirection: args.customDirection,
        config,
        names,
        character,
        persona,
        recentHistory,
      });
    }

    const { model, provider } = resolveEffectiveModelAndProvider({
      configuredModel: config.model,
      connectionModel: resolvedConnection?.model,
      connectionProvider: resolvedConnection?.provider,
      dryRunModel,
      dryRunProvider,
    });

    const finalParameters =
      presetContext.presetStreaming === false && parameters?._streaming === undefined
        ? { ...(parameters ?? {}), _streaming: false }
        : parameters;

    const rawInput: GenerationRequestWithSignal = {
      type: "raw",
      messages,
      ...(finalParameters ? { parameters: finalParameters } : {}),
      ...(resolvedConnection?.id ? { connection_id: resolvedConnection.id } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(config.contextMode === "lightweight" || mode === "verbatim_bridge"
        ? { reasoning: { source: "off" as const } }
        : {}),
      ...(userId ? { userId } : {}),
      signal: args.signal,
    };

    return {
      mode,
      rawInput,
      mediaSlots: extracted.slots,
      resolvedVerbatimScene,
      presetContext,
    };
  }

  private async runSingleShotLlm(
    rawInput: GenerationRequestWithSignal,
    signal: AbortSignal,
  ): Promise<{ text: string; aborted: boolean }> {
    const { wasStreaming, outboundInput } = prepareOutboundGenerationInput(rawInput);
    let text = "";
    let aborted = false;

    try {
      if (wasStreaming && typeof this.spindle.generate.rawStream === "function") {
        for await (const chunk of this.spindle.generate.rawStream(outboundInput)) {
          if (signal.aborted) {
            aborted = true;
            break;
          }
          if (chunk.type === "token") {
            text += chunk.token;
          } else if (chunk.type === "done" && chunk.content) {
            text = chunk.content;
          }
        }
      } else if (typeof this.spindle.generate.raw === "function") {
        const resp = asGenerationResponse(await this.spindle.generate.raw(outboundInput));
        if (signal.aborted) {
          aborted = true;
        } else if (typeof resp.content === "string") {
          text = resp.content;
        }
      }
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        aborted = true;
      } else {
        throw err;
      }
    }

    return { text, aborted };
  }

  private async finalizeGeneratedSceneText(args: {
    rawOutput: string;
    mode: SceneRewriteMode;
    delivery: GuidedSceneDelivery;
    resolvedVerbatimScene: string;
    mediaSlots: readonly MediaSlot[];
    keepMediaIntact: boolean;
    applyRegex: boolean;
    chatId: string;
    characterId?: string;
    userId?: string;
  }): Promise<string> {
    let processed = args.rawOutput;

    if (args.applyRegex && processed.length > 0) {
      try {
        const scripts = await fetchActiveRegexScripts(this.spindle, {
          target: "response",
          characterId: args.characterId,
          chatId: args.chatId,
          userId: args.userId,
        });
        if (scripts.length > 0) {
          const resolveMacros = this.createRegexMacroResolver(
            args.chatId,
            args.characterId,
            args.userId,
          );
          const result = await processResponseOutput({
            content: processed,
            scripts,
            resolveMacros,
          });
          processed = result.content;
        }
      } catch {
        // Regex failure should never lose generated scene output.
      }
    }

    if (args.mode === "verbatim_bridge") {
      return combineBridgeAndVerbatimScene(
        processed,
        args.resolvedVerbatimScene,
        args.delivery,
      );
    }

    if (args.keepMediaIntact && args.mediaSlots.length > 0) {
      return restoreMediaSlots(processed, args.mediaSlots);
    }

    return processed;
  }

  private createRegexMacroResolver(
    chatId: string,
    characterId?: string,
    userId?: string,
  ): ((input: string) => Promise<string>) | undefined {
    const macrosApi = this.spindle.macros;
    if (!macrosApi || typeof macrosApi.resolve !== "function") return undefined;
    return async (macroInput: string): Promise<string> => {
      if (!macroInput.includes("{{")) return macroInput;
      try {
        const res = await macrosApi.resolve(macroInput, {
          chatId,
          ...(characterId ? { characterId } : {}),
          ...(userId ? { userId } : {}),
          commit: false,
        });
        return typeof res?.text === "string" ? res.text : macroInput;
      } catch {
        return macroInput;
      }
    };
  }

  private async loadLightweightCharacter(
    characterId?: string,
    userId?: string,
  ): Promise<SceneLightweightCharacter | null> {
    if (!characterId || !this.spindle.permissions?.has?.("characters")) return null;
    if (typeof this.spindle.characters?.get !== "function") return null;
    try {
      const ch = await this.spindle.characters.get(characterId, userId);
      if (!ch) return null;
      return {
        name: ch.name,
        description: ch.description,
        personality: ch.personality,
        scenario: ch.scenario,
      };
    } catch {
      return null;
    }
  }

  private async loadLightweightPersona(
    chatId: string,
    characterId: string | undefined,
    fallbackName: string | undefined,
    userId?: string,
  ): Promise<SceneLightweightPersona | null> {
    let description: string | undefined;
    if (typeof this.spindle.macros?.resolve === "function") {
      try {
        const res = await this.spindle.macros.resolve("{{persona}}", {
          chatId,
          ...(characterId ? { characterId } : {}),
          ...(userId ? { userId } : {}),
          commit: false,
        });
        if (
          typeof res?.text === "string" &&
          res.text.trim().length > 0 &&
          !/^\{\{\s*persona\s*\}\}$/i.test(res.text.trim())
        ) {
          description = res.text.trim();
        }
      } catch {
        // Ignore macro lookup failures.
      }
    }

    if (!fallbackName && !description) return null;
    return {
      ...(fallbackName ? { name: fallbackName } : {}),
      ...(description ? { description } : {}),
    };
  }

  private async loadRecentHistoryTurns(
    chatId: string,
    maxTurns: number,
    excludeMessageId?: string,
  ): Promise<SceneHistoryTurn[]> {
    try {
      const fetchTail = excludeMessageId ? maxTurns + 1 : maxTurns;
      const messages = await this.getChatMessagesWithOptions(chatId, { tail: fetchTail });
      return messages
        .filter(
          (m) =>
            (!excludeMessageId || m.id !== excludeMessageId) &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
        )
        .slice(-maxTurns)
        .map((m) => ({
          role: m.is_user
            ? ("user" as const)
            : m.role === "system"
              ? ("system" as const)
              : ("assistant" as const),
          name: m.name,
          content: m.content,
        }));
    } catch {
      return [];
    }
  }

  private enqueueChatDryRun<T>(chatId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chatDryRunQueues.get(chatId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    this.chatDryRunQueues.set(chatId, tail);
    void tail.finally(() => {
      if (this.chatDryRunQueues.get(chatId) === tail) {
        this.chatDryRunQueues.delete(chatId);
      }
    });
    return next;
  }

  private async runDryRunWithCapture(
    chatId: string,
    dryRunInput: DryRunRequestWithOverride,
    userId?: string,
  ): Promise<{
    result: DryRunResultWithRequestMessages;
    capturedMessages?: AssembledLlmMessageDTO[];
  }> {
    return this.enqueueChatDryRun(chatId, async () => {
      const capture: PendingSceneDryRunCapture = {
        userId,
        presetId: dryRunInput.presetId ?? null,
      };
      if (!this.disposed) {
        this.pendingDryRunCaptures.set(chatId, capture);
        this.ensureInterceptorRegistered();
      }
      try {
        const result = (await this.spindle.generate.dryRun(
          dryRunInput,
          userId,
        )) as DryRunResultWithRequestMessages;
        return { result, capturedMessages: capture.capturedMessages };
      } finally {
        if (this.pendingDryRunCaptures.get(chatId) === capture) {
          this.pendingDryRunCaptures.delete(chatId);
        }
        this.releaseInterceptorIfIdle();
      }
    });
  }

  private async resolveConnection(
    configuredConnectionId: string | null,
    activeConnectionId?: string | null,
    userId?: string,
  ): Promise<ConnectionProfileDTO | undefined> {
    const getConn = this.spindle.connections?.get;
    if (configuredConnectionId && typeof getConn === "function") {
      try {
        const found = await getConn.call(this.spindle.connections, configuredConnectionId, userId);
        if (found) return found;
        throw new Error(
          "Selected API connection profile for Guided Scene no longer exists. Choose another in Settings.",
        );
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("Selected API connection profile for Guided Scene no longer exists")
        ) {
          throw err;
        }
      }
    }

    if (!configuredConnectionId && activeConnectionId && typeof getConn === "function") {
      try {
        const active = await getConn.call(this.spindle.connections, activeConnectionId, userId);
        if (active) return active;
      } catch {
        // Fall through to list.
      }
    }

    if (typeof this.spindle.connections?.list !== "function") {
      return undefined;
    }
    const connections = await this.spindle.connections.list(userId);
    if (configuredConnectionId) {
      const found = connections.find((c) => c.id === configuredConnectionId);
      if (!found) {
        throw new Error(
          "Selected API connection profile for Guided Scene no longer exists. Choose another in Settings.",
        );
      }
      return found;
    }
    if (activeConnectionId) {
      const active = connections.find((c) => c.id === activeConnectionId);
      if (active) return active;
    }
    return connections.find((c) => c.is_default) ?? connections[0];
  }

  private async resolvePresetContext(
    configuredPresetId: string | null,
    chatId: string,
    userId?: string,
  ): Promise<{
    presetId: string | null;
    presetName?: string;
    presetStreaming?: boolean;
  }> {
    if (!this.spindle.permissions?.has?.("presets")) {
      return { presetId: null };
    }
    const trimmed = typeof configuredPresetId === "string" ? configuredPresetId.trim() : "";
    if (trimmed && typeof this.spindle.presets?.get === "function") {
      try {
        const preset = await this.spindle.presets.get(trimmed, userId);
        if (!preset) return { presetId: null };
        const name =
          typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : undefined;
        const presetStreaming = extractPresetStreamingOverride(preset);
        return {
          presetId: trimmed,
          ...(name ? { presetName: name } : {}),
          ...(presetStreaming !== undefined ? { presetStreaming } : {}),
        };
      } catch {
        return { presetId: null };
      }
    }

    if (typeof this.spindle.presets?.getActive === "function") {
      try {
        const active = await this.spindle.presets.getActive(chatId, userId);
        const activeId = typeof active?.preset_id === "string" ? active.preset_id.trim() : "";
        return { presetId: activeId || null };
      } catch {
        return { presetId: null };
      }
    }

    return { presetId: null };
  }

  private async getChatMessagesWithOptions(
    chatId: string,
    options?: { tail?: number; limit?: number; offset?: number; includeExtra?: boolean },
  ): Promise<ChatMessageWithRole[]> {
    const getMessagesFn = this.spindle.chat.getMessages as (
      chatId: string,
      options?: { tail?: number; limit?: number; offset?: number; includeExtra?: boolean },
    ) => Promise<ChatMessageWithRole[]>;
    if (!options) {
      return getMessagesFn.call(this.spindle.chat, chatId);
    }
    try {
      return await getMessagesFn.call(this.spindle.chat, chatId, options);
    } catch {
      return getMessagesFn.call(this.spindle.chat, chatId);
    }
  }

  private async findAssistantMessageById(
    chatId: string,
    targetId: string,
  ): Promise<ChatMessageWithRole | null> {
    const msgs = await this.getChatMessagesWithOptions(chatId, { tail: 20, includeExtra: true });
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (m && m.id === targetId && isAssistantMessage(m)) {
        return m;
      }
    }
    return null;
  }

  private async emitMetricsForCompletedStream(args: {
    chatId: string;
    userId?: string;
    messageId: string;
    swipeId: number;
    finalText: string;
    rawDeltaText: string;
    hasReasoning: boolean;
    usage?: GenerationUsageInput;
    timingSource: GenerationTimingSource;
    model?: string;
    provider?: string;
    presetId?: string | null;
    presetName?: string;
  }): Promise<void> {
    try {
      const { tokenCount, generationMetrics } = await buildGenerationMetricsPayload({
        spindle: this.spindle,
        userId: args.userId,
        isContinue: false,
        finalText: args.finalText,
        rawDeltaText: args.rawDeltaText,
        hasReasoning: args.hasReasoning,
        usage: args.usage,
        timingSource: args.timingSource,
        model: args.model,
        provider: args.provider,
        presetId: args.presetId,
        presetName: args.presetName,
      });

      if (tokenCount != null || generationMetrics != null) {
        this.emitFrontend(
          {
            type: "gg:generation_metrics",
            chatId: args.chatId,
            messageId: args.messageId,
            swipeId: args.swipeId,
            ...(tokenCount != null ? { tokenCount } : {}),
            ...(generationMetrics != null ? { generationMetrics } : {}),
          },
          args.userId,
        );
      }
    } catch (err) {
      this.spindle.log?.warn?.(
        `[GuidedGenerations] Failed emitting scene generation metrics: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async dispatchPushNotification(args: {
    userId?: string;
    chatId: string;
    status: "done" | "error";
    content?: string;
    errorMessage?: string;
    characterId?: string;
    characterName?: string;
  }): Promise<void> {
    try {
      if (
        this.disposed ||
        !this.spindle.permissions?.has?.("push_notification") ||
        typeof this.spindle.push?.send !== "function"
      ) {
        return;
      }
      if (typeof this.spindle.push.getStatus === "function") {
        const status = await this.spindle.push.getStatus(args.userId);
        if (!status?.available) return;
      }

      const characterName =
        args.characterName?.trim() ||
        (args.characterId
          ? await this.resolveCharacterName(args.characterId, args.userId)
          : undefined);

      const icon = args.characterId
        ? `/api/v1/characters/${encodeURIComponent(args.characterId)}/avatar?size=sm`
        : undefined;
      const isError = args.status === "error";
      const title = isError ? "Guided Scene Failed" : characterName || "Guided Scene";
      const body = isError
        ? (args.errorMessage?.trim() || "The Guided Scene generation failed.").slice(0, 240)
        : (args.content?.trim() || "Your Guided Scene is ready.").slice(0, 120);

      await this.spindle.push.send(
        {
          title,
          body,
          tag: isError ? `generation-error-${args.chatId}` : `generation-${args.chatId}`,
          url: `/chat/${args.chatId}`,
          rawTitle: true,
          ...(icon ? { icon } : {}),
        },
        args.userId,
      );
    } catch {
      // Push failures must never break scene drops.
    }
  }
}
