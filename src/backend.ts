import type { SpindleAPI } from "lumiverse-spindle-types";
import { GuidedGenerationRunner } from "./backend/generation-runner";
import { InterceptorMux } from "./backend/interceptor-mux";
import { GuidedSceneManager } from "./backend/scene-manager";
import { SettingsStore } from "./backend/settings-store";
import {
  isGuidedActionId,
  normalizeSceneAdjustmentMode,
  normalizeSceneArmedPacing,
  normalizeSceneDelivery,
  normalizeSceneDropTarget,
} from "./shared/defaults";
import type {
  ArmSceneInput,
  BackendPushEvent,
  DropSceneNowInput,
  ExtensionBootstrapView,
  GuidedSceneDraftBaseInput,
  PreviewSceneDraftInput,
  RegenerateContinueInput,
  RpcReplyEnvelope,
  RpcRequestEnvelope,
  RunActionInput,
  UpdateArmedSceneInput,
} from "./shared/types";

declare const spindle: SpindleAPI | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRpcRequest(payload: unknown): RpcRequestEnvelope | null {
  if (!isRecord(payload)) return null;
  if (payload.type !== "gg:rpc") return null;
  if (typeof payload.requestId !== "string" || typeof payload.action !== "string") return null;
  return payload as unknown as RpcRequestEnvelope;
}

function parseRunActionInput(raw: unknown): RunActionInput {
  const record = isRecord(raw) ? raw : {};
  if (!isGuidedActionId(record.actionId)) {
    throw new Error("Invalid Guided Generations action id.");
  }

  return {
    actionId: record.actionId,
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    activeConnectionId:
      typeof record.activeConnectionId === "string" ? record.activeConnectionId : null,
    inputText: typeof record.inputText === "string" ? record.inputText : "",
    backgroundSwipe: record.backgroundSwipe === true,
  };
}

function parseRegenerateContinueInput(raw: unknown): RegenerateContinueInput {
  const record = isRecord(raw) ? raw : {};
  return {
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    activeConnectionId:
      typeof record.activeConnectionId === "string" ? record.activeConnectionId : null,
  };
}

function parseSceneDraftBaseInput(raw: unknown): GuidedSceneDraftBaseInput {
  const record = isRecord(raw) ? raw : {};
  return {
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    activeConnectionId:
      typeof record.activeConnectionId === "string" ? record.activeConnectionId : null,
    delivery: normalizeSceneDelivery(record.delivery, "time_skip"),
    adjustmentMode: normalizeSceneAdjustmentMode(record.adjustmentMode, "verbatim"),
    greetingSource: record.greetingSource === "custom" ? "custom" : "card",
    selectedGreetingKey:
      typeof record.selectedGreetingKey === "string" ? record.selectedGreetingKey : null,
    ...(typeof record.greetingLabel === "string" ? { greetingLabel: record.greetingLabel } : {}),
    rawGreetingText: typeof record.rawGreetingText === "string" ? record.rawGreetingText : "",
    speakerCharacterId:
      typeof record.speakerCharacterId === "string" ? record.speakerCharacterId : null,
    speakerCharacterName:
      typeof record.speakerCharacterName === "string" ? record.speakerCharacterName : null,
    ...(typeof record.transitionNote === "string" ? { transitionNote: record.transitionNote } : {}),
    ...(typeof record.customDirection === "string"
      ? { customDirection: record.customDirection }
      : {}),
    ...(typeof record.keepMediaIntact === "boolean"
      ? { keepMediaIntact: record.keepMediaIntact }
      : {}),
  };
}

function parsePreviewSceneDraftInput(raw: unknown): PreviewSceneDraftInput {
  return parseSceneDraftBaseInput(raw);
}

function parseDropSceneNowInput(raw: unknown): DropSceneNowInput {
  const record = isRecord(raw) ? raw : {};
  return {
    ...parseSceneDraftBaseInput(raw),
    ...(record.dropTarget !== undefined
      ? { dropTarget: normalizeSceneDropTarget(record.dropTarget, "new_message") }
      : {}),
    ...(record.lockedDraftText !== undefined
      ? {
          lockedDraftText:
            typeof record.lockedDraftText === "string" ? record.lockedDraftText : null,
        }
      : {}),
    ...(record.previewText !== undefined
      ? { previewText: typeof record.previewText === "string" ? record.previewText : null }
      : {}),
    ...(typeof record.draftLocked === "boolean" ? { draftLocked: record.draftLocked } : {}),
  };
}

function parseArmSceneInput(raw: unknown): ArmSceneInput {
  const record = isRecord(raw) ? raw : {};
  return {
    ...parseSceneDraftBaseInput(raw),
    pacing: normalizeSceneArmedPacing(record.pacing, "next_turn"),
    ...(record.lockedDraftText !== undefined
      ? {
          lockedDraftText:
            typeof record.lockedDraftText === "string" ? record.lockedDraftText : null,
        }
      : {}),
    ...(record.previewText !== undefined
      ? { previewText: typeof record.previewText === "string" ? record.previewText : null }
      : {}),
    ...(typeof record.draftLocked === "boolean" ? { draftLocked: record.draftLocked } : {}),
  };
}

function parseUpdateArmedSceneInput(raw: unknown): UpdateArmedSceneInput {
  const record = isRecord(raw) ? raw : {};
  const pacing =
    record.pacing === "next_turn" || record.pacing === "multi_turn"
      ? record.pacing
      : undefined;
  const delivery =
    record.delivery === "cut" || record.delivery === "time_skip" || record.delivery === "bridge"
      ? record.delivery
      : undefined;
  const adjustmentMode =
    record.adjustmentMode === "verbatim" ||
    record.adjustmentMode === "context_adapt" ||
    record.adjustmentMode === "summary_rewrite"
      ? record.adjustmentMode
      : undefined;
  const greetingSource =
    record.greetingSource === "card" || record.greetingSource === "custom"
      ? record.greetingSource
      : undefined;

  return {
    chatId: typeof record.chatId === "string" ? record.chatId : null,
    ...(pacing !== undefined ? { pacing } : {}),
    ...(delivery !== undefined ? { delivery } : {}),
    ...(adjustmentMode !== undefined ? { adjustmentMode } : {}),
    ...(greetingSource !== undefined ? { greetingSource } : {}),
    ...(record.selectedGreetingKey !== undefined
      ? {
          selectedGreetingKey:
            typeof record.selectedGreetingKey === "string" ? record.selectedGreetingKey : null,
        }
      : {}),
    ...(typeof record.greetingLabel === "string" ? { greetingLabel: record.greetingLabel } : {}),
    ...(typeof record.rawGreetingText === "string"
      ? { rawGreetingText: record.rawGreetingText }
      : {}),
    ...(record.speakerCharacterId !== undefined
      ? {
          speakerCharacterId:
            typeof record.speakerCharacterId === "string" ? record.speakerCharacterId : null,
        }
      : {}),
    ...(record.speakerCharacterName !== undefined
      ? {
          speakerCharacterName:
            typeof record.speakerCharacterName === "string" ? record.speakerCharacterName : null,
        }
      : {}),
    ...(typeof record.transitionNote === "string" ? { transitionNote: record.transitionNote } : {}),
    ...(typeof record.customDirection === "string"
      ? { customDirection: record.customDirection }
      : {}),
    ...(typeof record.keepMediaIntact === "boolean"
      ? { keepMediaIntact: record.keepMediaIntact }
      : {}),
    ...(record.lockedDraftText !== undefined
      ? {
          lockedDraftText:
            typeof record.lockedDraftText === "string" ? record.lockedDraftText : null,
        }
      : {}),
    ...(record.previewText !== undefined
      ? { previewText: typeof record.previewText === "string" ? record.previewText : null }
      : {}),
    ...(typeof record.draftLocked === "boolean" ? { draftLocked: record.draftLocked } : {}),
  };
}

export function registerBackend(api: SpindleAPI) {
  const store = new SettingsStore(api);

  function emitFrontend(event: BackendPushEvent, userId?: string): void {
    api.sendToFrontend(event, userId);
  }

  const interceptorMux = new InterceptorMux(api);
  const sharedDryRunQueues = new Map<string, Promise<unknown>>();
  let sceneManagerRef: GuidedSceneManager | null = null;
  const runner = new GuidedGenerationRunner(api, store, emitFrontend, interceptorMux, {
    chatDryRunQueues: sharedDryRunQueues,
    isExternalChatBusy: (userId, chatId) => sceneManagerRef?.hasBusyChat(userId, chatId) ?? false,
  });
  const sceneManager = new GuidedSceneManager(api, store, emitFrontend, interceptorMux, {
    chatDryRunQueues: sharedDryRunQueues,
    isExternalChatBusy: (userId, chatId) => runner.hasBusyChat(userId, chatId),
  });
  sceneManagerRef = sceneManager;

  async function buildBootstrapView(
    userId?: string,
    options?: { includeCatalogs?: boolean },
  ): Promise<ExtensionBootstrapView> {
    const includeCatalogs = options?.includeCatalogs !== false;
    const emptyCatalogs: Awaited<ReturnType<SettingsStore["loadCatalogs"]>> = {
      connections: [],
      presets: [],
      warnings: [],
    };
    const [settings, catalogs, recovery, armedScenes] = await Promise.all([
      store.getSettings(userId),
      includeCatalogs ? store.loadCatalogs(userId) : Promise.resolve(emptyCatalogs),
      store.getRecovery(userId),
      sceneManager.hydrateUserArmedScenes(userId),
    ]);
    sceneManager.onSettingsSaved(settings, userId);

    const activeRuns = [...runner.getActiveRuns(userId), ...sceneManager.getActiveRuns(userId)];
    const activeRun = activeRuns[activeRuns.length - 1] ?? null;
    const recentTerminalRuns = [
      ...runner.getRecentTerminalRuns(userId),
      ...sceneManager.getRecentTerminalRuns(userId),
    ]
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .slice(0, 20);

    return {
      settings,
      connections: catalogs.connections,
      presets: catalogs.presets,
      recovery,
      activeRun,
      activeRuns,
      recentTerminalRuns,
      armedScene: armedScenes[0] ?? null,
      armedScenes,
      permissions: {
        generation: api.permissions.has("generation"),
        chats: api.permissions.has("chats"),
        chat_mutation: api.permissions.has("chat_mutation"),
        characters: api.permissions.has("characters"),
        presets: api.permissions.has("presets"),
        regex_scripts: api.permissions.has("regex_scripts"),
        interceptor: api.permissions.has("interceptor"),
        push_notification: api.permissions.has("push_notification"),
      },
      ...(catalogs.warnings.length > 0 ? { catalogWarnings: catalogs.warnings } : {}),
    };
  }

  async function handleRpc(req: RpcRequestEnvelope, userId: string): Promise<void> {
    const reply = (result?: unknown, error?: string) => {
      const envelope: RpcReplyEnvelope = {
        type: "gg:reply",
        requestId: req.requestId,
        ...(error !== undefined ? { error } : { result }),
      };
      api.sendToFrontend(envelope, userId);
    };

    try {
      switch (req.action) {
        case "get_bootstrap": {
          const includeCatalogs =
            isRecord(req.input) && req.input.includeCatalogs === false ? false : true;
          reply(await buildBootstrapView(userId, { includeCatalogs }));
          return;
        }
        case "save_settings": {
          if (!isRecord(req.input)) {
            throw new Error("Invalid settings payload: expected an object.");
          }
          const { settings, recoveryPruned, recovery } = await store.saveSettingsWithMeta(
            req.input,
            userId,
          );
          sceneManager.onSettingsSaved(settings, userId);
          if (recoveryPruned) {
            emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
          }
          reply(settings);
          return;
        }
        case "run_action": {
          const parsed = parseRunActionInput(req.input);
          const result = await runner.run(parsed, userId);
          reply(result);
          return;
        }
        case "abort_action": {
          const record = isRecord(req.input) ? req.input : {};
          const runId =
            typeof record.runId === "string" && record.runId.trim().length > 0
              ? record.runId.trim()
              : undefined;
          const chatId =
            typeof record.chatId === "string" && record.chatId.trim().length > 0
              ? record.chatId.trim()
              : undefined;
          const runnerAborted = runner.abortCurrent(userId, runId, chatId);
          const sceneAborted = sceneManager.abortCurrent(userId, runId, chatId);
          const aborted = runnerAborted || sceneAborted;
          reply({ aborted });
          return;
        }
        case "push_recovery": {
          const record = isRecord(req.input) ? req.input : {};
          const text = typeof record.text === "string" ? record.text : "";
          if (!text.trim()) {
            reply(await store.getRecovery(userId));
            return;
          }
          const actionId = isGuidedActionId(record.actionId)
            ? record.actionId
            : "guided_response";
          const settings = await store.getSettings(userId);
          if (!settings.inputRecovery.enabled) {
            reply(await store.getRecovery(userId));
            return;
          }
          const rawChatId = typeof record.chatId === "string" ? record.chatId.trim() : "";
          const recovery = await store.pushRecovery(
            {
              text,
              actionId,
              chatId: rawChatId.length > 0 ? rawChatId : null,
            },
            userId,
          );
          emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
          reply(recovery);
          return;
        }
        case "restore_recovery": {
          const recovery = await store.getRecovery(userId);
          const record = isRecord(req.input) ? req.input : {};
          const targetId = typeof record.id === "string" && record.id ? record.id : null;
          const entry = targetId
            ? recovery.find((item) => item.id === targetId) ?? null
            : recovery[0] ?? null;
          reply(entry);
          return;
        }
        case "clear_recovery": {
          const recovery = await store.clearRecovery(userId);
          emitFrontend({ type: "gg:recovery-updated", recovery }, userId);
          reply(recovery);
          return;
        }
        case "remove_last_continue": {
          const record = isRecord(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          const result = await runner.removeLastContinue({ chatId }, userId);
          reply(result);
          return;
        }
        case "regenerate_last_continue": {
          const parsed = parseRegenerateContinueInput(req.input);
          const result = await runner.regenerateLastContinue(parsed, userId);
          reply(result);
          return;
        }
        case "get_scene_context": {
          const record = isRecord(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          reply(await sceneManager.getSceneContext(chatId, userId));
          return;
        }
        case "preview_scene_draft": {
          const parsed = parsePreviewSceneDraftInput(req.input);
          reply(await sceneManager.previewSceneDraft(parsed, userId));
          return;
        }
        case "drop_scene_now": {
          const parsed = parseDropSceneNowInput(req.input);
          reply(await sceneManager.dropSceneNow(parsed, userId));
          return;
        }
        case "arm_scene": {
          const parsed = parseArmSceneInput(req.input);
          reply(await sceneManager.armScene(parsed, userId));
          return;
        }
        case "update_armed_scene": {
          const parsed = parseUpdateArmedSceneInput(req.input);
          reply(await sceneManager.updateArmedScene(parsed, userId));
          return;
        }
        case "pause_scene": {
          const record = isRecord(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          reply(await sceneManager.pauseScene(chatId, userId));
          return;
        }
        case "resume_scene": {
          const record = isRecord(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          reply(await sceneManager.resumeScene(chatId, userId));
          return;
        }
        case "drop_next_turn": {
          const record = isRecord(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          reply(await sceneManager.dropNextTurn(chatId, userId));
          return;
        }
        case "cancel_scene": {
          const record = isRecord(req.input) ? req.input : {};
          const chatId = typeof record.chatId === "string" ? record.chatId : null;
          reply(await sceneManager.cancelScene(chatId, userId));
          return;
        }
        case "close_drawer": {
          reply(await sceneManager.closeDrawer(userId));
          return;
        }
        default:
          throw new Error(`Unsupported action: ${String(req.action)}`);
      }
    } catch (error) {
      reply(undefined, error instanceof Error ? error.message : String(error));
    }
  }

  const disposers: Array<(() => void) | void> = [];

  disposers.push(
    api.onFrontendMessage((payload, userId) => {
      const req = asRpcRequest(payload);
      if (!req) return;
      void handleRpc(req, userId);
    }),
  );

  disposers.push(
    api.permissions.onChanged((arg1?: unknown, arg2?: unknown) => {
      interceptorMux.syncPermissions();
      runner.syncPermissions();
      sceneManager.syncInterceptorRegistration();
      const userId =
        typeof arg1 === "string" && arg1.length > 0
          ? arg1
          : typeof arg2 === "string" && arg2.length > 0
            ? arg2
            : isRecord(arg1) && typeof arg1.userId === "string" && arg1.userId.length > 0
              ? arg1.userId
              : undefined;
      emitFrontend({ type: "gg:changed", reason: "permissions" }, userId);
    }),
  );

  return {
    store,
    runner,
    sceneManager,
    interceptorMux,
    handleRpc,
    buildBootstrapView,
    dispose: () => {
      sceneManager.dispose();
      runner.dispose();
      interceptorMux.dispose();
      for (const d of disposers.splice(0)) {
        if (typeof d === "function") d();
      }
    },
  };
}

if (typeof spindle !== "undefined") {
  registerBackend(spindle);
}
