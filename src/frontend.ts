import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { normalizeGuidedSceneConfig } from "./shared/defaults";
import type {
  ActionRunResult,
  ActiveRunState,
  ArmedSceneState,
  ArmSceneInput,
  BackendPushEvent,
  DropSceneNowInput,
  DropSceneNowResult,
  ExtensionBootstrapView,
  GuidedActionId,
  GuidedGenerationsSettings,
  GuidedSceneChatContext,
  GuidedSceneConfig,
  PreviewSceneDraftInput,
  PreviewSceneDraftResult,
  RecoveryEntry,
  RegenerateContinueInput,
  RemoveContinueResult,
  RpcActionName,
  RunActionId,
  RunActionInput,
  TerminalRunSummary,
  UpdateArmedSceneInput,
} from "./shared/types";
import { ChatHeadController } from "./frontend/chat-head";
import { InputToolbarController } from "./frontend/input-toolbar";
import { PillMetricsController } from "./frontend/pill-metrics";
import { pickRecoveryEntry } from "./frontend/recovery-store";
import { SettingsDrawerController } from "./frontend/settings-drawer";
import { StreamingIndicatorController } from "./frontend/streaming-indicator";
import { GUIDED_GENERATIONS_CSS } from "./frontend/styles";

interface HostComposerState {
  mounted?: boolean;
  chatId: string | null;
  text: string;
}

interface HostComposerAPI {
  getState(): HostComposerState;
  setText(text: string): void;
  focus(): void;
}

interface HostConnectionActiveState {
  activeProfileId: string | null;
  provider: string | null;
  model: string | null;
}

interface HostConnectionsDomainAPI {
  getActive?(): HostConnectionActiveState;
  subscribe?(handler: (value: HostConnectionActiveState) => void): () => void;
}

type FrontendContextWithHostExtensions = SpindleFrontendContext & {
  composer: HostComposerAPI;
  connections?: SpindleFrontendContext["connections"] & HostConnectionsDomainAPI;
};

const PENDING_RUN_ID_PREFIX = "pending:";
const MAX_CHAT_STATUS_SEQ_ENTRIES = 200;
const MAX_SEEN_TERMINAL_RUN_IDS = 100;
const MAX_PENDING_IMPERSONATE_DRAFTS = 50;
const FOREGROUND_RECONCILE_MIN_INTERVAL_MS = 500;
const ACTIVE_RUN_RECONCILE_INTERVAL_MS = 10_000;
const ACTION_RPC_TIMEOUT_MS = 300_000;

class RpcTimeoutError extends Error {
  constructor(action: RpcActionName) {
    super(`Timed out waiting for ${action}.`);
    this.name = "RpcTimeoutError";
  }
}

function isRpcTimeoutError(error: unknown): boolean {
  if (error instanceof RpcTimeoutError) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /^Timed out waiting for /i.test(msg) || /^Timeout waiting for /i.test(msg);
}

interface InFlightActionRpc {
  requestId: string;
  actionId: RunActionId;
  chatId: string;
  startedAt: number;
  observedRunId: string | null;
  cancelAsReconciled: () => void;
}

function isPendingRunId(runId: string | null | undefined): boolean {
  return typeof runId === "string" && runId.startsWith(PENDING_RUN_ID_PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isArmedSceneState(value: unknown): value is ArmedSceneState {
  return (
    isRecord(value) &&
    typeof value.chatId === "string" &&
    value.chatId.length > 0 &&
    typeof value.status === "string" &&
    typeof value.pacing === "string"
  );
}

function extractArmedSceneResult(raw: unknown): ArmedSceneState | null {
  if (isArmedSceneState(raw)) return raw;
  if (isRecord(raw) && "armedScene" in raw) {
    return isArmedSceneState(raw.armedScene) ? raw.armedScene : null;
  }
  return null;
}

function areJsonValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!areJsonValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = Object.keys(recA);
  const keysB = Object.keys(recB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(recB, key)) return false;
    if (!areJsonValuesEqual(recA[key], recB[key])) return false;
  }
  return true;
}

function extractChatIdFromPayload(rawPayload: unknown): string | null {
  if (!isRecord(rawPayload)) return null;
  if (typeof rawPayload.chatId === "string" && rawPayload.chatId) {
    return rawPayload.chatId;
  }
  if (isRecord(rawPayload.chat) && typeof rawPayload.chat.id === "string") {
    return rawPayload.chat.id;
  }
  return null;
}

function extractDeletedChatIdFromPayload(rawPayload: unknown): string | null {
  const fromChat = extractChatIdFromPayload(rawPayload);
  if (fromChat) return fromChat;
  if (isRecord(rawPayload) && typeof rawPayload.id === "string" && rawPayload.id) {
    return rawPayload.id;
  }
  return null;
}

function mapConnectionProfiles(
  next: ExtensionBootstrapView,
  profiles: unknown,
): ExtensionBootstrapView {
  if (!Array.isArray(profiles) || profiles.length === 0) return next;
  return {
    ...next,
    connections: profiles.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider ?? "",
      model: c.model ?? "",
      isDefault: Boolean((c as { is_default?: unknown }).is_default),
    })),
  };
}

async function withFrontendConnectionFallback(
  next: ExtensionBootstrapView,
  ctx: FrontendContextWithHostExtensions,
): Promise<ExtensionBootstrapView> {
  if (next.connections.length > 0 || !ctx.connections?.list) return next;
  try {
    const raw = ctx.connections.list() as unknown;
    if (raw && typeof (raw as PromiseLike<unknown>).then === "function") {
      const profiles = await raw;
      return mapConnectionProfiles(next, profiles);
    }
    return mapConnectionProfiles(next, raw);
  } catch {
    return next;
  }
}

export function setup(rawCtx: SpindleFrontendContext): () => void {
  const ctx = rawCtx as FrontendContextWithHostExtensions;
  const removeStyle = ctx.dom.addStyle(GUIDED_GENERATIONS_CSS);
  const disposers: Array<() => void> = [];

  let destroyed = false;
  let seq = 0;
  let pendingRunSeq = 0;
  let bootstrapSeq = 0;
  let sceneContextSeq = 0;
  let settingsRevision = 0;
  let statusSeq = 0;
  let globalClearSeq = 0;
  let isPreChatLaunching = false;
  const launchingChats = new Set<string>();
  let view: ExtensionBootstrapView | null = null;
  let drawerMounted = false;
  let catalogsLoaded = false;
  let suppressingActivateSceneLoad = false;
  let stopObservingTabConnection: (() => void) | null = null;
  let activeRun: ActiveRunState | null = null;
  const activeRunsByChat = new Map<string, ActiveRunState>();
  const armedScenesByChat = new Map<string, ArmedSceneState>();
  const inFlightActionRpcsByChat = new Map<string, InFlightActionRpc>();
  const seenTerminalRunIds = new Set<string>();
  const chatStatusSeq = new Map<string, number>();
  const pendingImpersonateDrafts = new Map<string, string>();
  const IMPERSONATE_DRAFT_RETRY_DELAYS_MS = [0, 20, 50, 100, 200] as const;
  let impersonateDraftRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let impersonateDraftRetryChatId: string | null = null;
  let impersonateDraftRetryAttempt = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let activeRunReconcileTimer: ReturnType<typeof setInterval> | undefined;
  let lastForegroundReconcileAt = 0;
  let composerAlertMount: Element | null = null;
  let inFlightRefresh: Promise<boolean> | null = null;
  let inFlightRefreshIncludeCatalogs = false;
  let lastRefreshSucceeded = false;
  let pendingFollowUpRefresh = false;
  let pendingFollowUpOnlyIfChanged = true;
  let pendingFollowUpIncludeCatalogs = false;
  let lastChatSwitchKey: string | null = null;
  let chatSwitchResetQueued = false;

  function safeGetActiveChat(): { chatId: string | null; characterId?: string | null } {
    try {
      const active = ctx.getActiveChat?.() as
        | { chatId?: string | null; characterId?: string | null }
        | null
        | undefined;
      return {
        chatId: typeof active?.chatId === "string" && active.chatId ? active.chatId : null,
        ...(active?.characterId !== undefined ? { characterId: active.characterId } : {}),
      };
    } catch {
      return { chatId: null };
    }
  }

  function safeGetActiveConnectionId(): string | null {
    try {
      return ctx.connections?.getActive?.()?.activeProfileId ?? null;
    } catch {
      return null;
    }
  }

  let lastObservedActiveChatId: string | null = safeGetActiveChat().chatId;

  function getArmedSceneForChat(
    chatId: string | null | undefined,
  ): ArmedSceneState | null {
    if (!chatId) return null;
    return armedScenesByChat.get(chatId) ?? null;
  }

  function applyArmedSceneForChat(
    chatId: string | null | undefined,
    armed: ArmedSceneState | null,
  ): void {
    if (chatId) {
      if (armed && armed.chatId === chatId) {
        armedScenesByChat.set(chatId, armed);
      } else {
        armedScenesByChat.delete(chatId);
      }
    }
    const activeChatId = safeGetActiveChat().chatId;
    drawer.setArmedScene(getArmedSceneForChat(activeChatId), activeChatId);
    renderToolbar();
  }

  function hydrateArmedScenesFromBootstrap(next: ExtensionBootstrapView): void {
    const hasArmedList = Array.isArray(next.armedScenes);
    const hasSingleArmed = next.armedScene !== undefined;
    if (!hasArmedList && !hasSingleArmed) return;

    if (hasArmedList) {
      armedScenesByChat.clear();
      for (const item of next.armedScenes!) {
        if (isArmedSceneState(item)) {
          armedScenesByChat.set(item.chatId, item);
        }
      }
    }
    if (isArmedSceneState(next.armedScene)) {
      armedScenesByChat.set(next.armedScene.chatId, next.armedScene);
    } else if (!hasArmedList && next.armedScene === null) {
      const activeChatId = safeGetActiveChat().chatId;
      if (activeChatId) {
        armedScenesByChat.delete(activeChatId);
      }
    }
  }

  function markTerminalRunSeen(runId: string | null | undefined): void {
    if (!runId || isPendingRunId(runId)) return;
    if (seenTerminalRunIds.has(runId)) {
      seenTerminalRunIds.delete(runId);
    } else if (seenTerminalRunIds.size >= MAX_SEEN_TERMINAL_RUN_IDS) {
      const oldest = seenTerminalRunIds.values().next().value;
      if (oldest !== undefined) {
        seenTerminalRunIds.delete(oldest);
      }
    }
    seenTerminalRunIds.add(runId);
  }

  function stopActiveRunReconcileTimer(): void {
    if (activeRunReconcileTimer !== undefined) {
      clearInterval(activeRunReconcileTimer);
      activeRunReconcileTimer = undefined;
    }
  }

  function syncActiveRunReconcileTimer(): void {
    if (destroyed || activeRunsByChat.size === 0) {
      stopActiveRunReconcileTimer();
      return;
    }
    if (activeRunReconcileTimer !== undefined) return;
    activeRunReconcileTimer = setInterval(() => {
      if (destroyed || activeRunsByChat.size === 0) {
        stopActiveRunReconcileTimer();
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refresh({ onlyIfChanged: true });
    }, ACTIVE_RUN_RECONCILE_INTERVAL_MS);
  }

  function reconcileOnForeground(): void {
    if (destroyed) return;
    if (activeRunsByChat.size === 0 && inFlightActionRpcsByChat.size === 0) {
      return;
    }
    const now = Date.now();
    if (now - lastForegroundReconcileAt < FOREGROUND_RECONCILE_MIN_INTERVAL_MS) {
      return;
    }
    lastForegroundReconcileAt = now;
    void refresh({ onlyIfChanged: true });
  }

  function setChatStatusSeq(chatId: string, seqValue: number): void {
    if (chatStatusSeq.has(chatId)) {
      chatStatusSeq.delete(chatId);
    } else if (chatStatusSeq.size >= MAX_CHAT_STATUS_SEQ_ENTRIES) {
      const oldestKey = chatStatusSeq.keys().next().value;
      if (oldestKey !== undefined) {
        chatStatusSeq.delete(oldestKey);
      }
    }
    chatStatusSeq.set(chatId, seqValue);
  }

  try {
    composerAlertMount = ctx.ui.mount("chat_composer_above");
  } catch {
    composerAlertMount = null;
  }

  function getActiveRunForChat(
    chatId: string | null | undefined,
  ): ActiveRunState | null {
    if (!chatId) return null;
    return (
      activeRunsByChat.get(chatId) ??
      (activeRun?.chatId === chatId ? activeRun : null)
    );
  }

  function isChatBusy(chatId: string | null | undefined): boolean {
    if (!chatId) return false;
    return Boolean(getActiveRunForChat(chatId)) || launchingChats.has(chatId);
  }

  function syncPrimaryActiveRun(): void {
    const currentChatId = safeGetActiveChat().chatId;
    if (currentChatId && activeRunsByChat.has(currentChatId)) {
      activeRun = activeRunsByChat.get(currentChatId)!;
      return;
    }
    let latest: ActiveRunState | null = null;
    for (const run of activeRunsByChat.values()) {
      if (!latest || run.startedAt >= latest.startedAt) {
        latest = run;
      }
    }
    activeRun = latest;
  }

  function startPendingRun(
    actionId: RunActionId,
    chatId: string,
    options?: { backgroundSwipe?: boolean },
  ): ActiveRunState {
    const pendingRun: ActiveRunState = {
      runId: `${PENDING_RUN_ID_PREFIX}${++pendingRunSeq}`,
      actionId,
      chatId,
      startedAt: Date.now(),
      ...(options?.backgroundSwipe ? { backgroundSwipe: true } : {}),
    };
    statusSeq += 1;
    lastForegroundReconcileAt = 0;
    setChatStatusSeq(chatId, statusSeq);
    activeRunsByChat.set(chatId, pendingRun);
    syncActiveRunReconcileTimer();
    syncPrimaryActiveRun();
    if (view) {
      view = { ...view, activeRun };
    }
    const activeChatId = safeGetActiveChat().chatId;
    const activeChatRun = getActiveRunForChat(activeChatId);
    indicator.sync(activeChatRun);
    drawer.setSceneActiveRun(activeChatRun);
    renderToolbar();
    return pendingRun;
  }

  function clearPendingRun(chatId: string, pendingRunId: string): boolean {
    const existing = activeRunsByChat.get(chatId);
    if (!existing || existing.runId !== pendingRunId) {
      return false;
    }
    statusSeq += 1;
    setChatStatusSeq(chatId, statusSeq);
    activeRunsByChat.delete(chatId);
    syncActiveRunReconcileTimer();
    syncPrimaryActiveRun();
    if (view) {
      view = { ...view, activeRun };
    }
    if (!destroyed) {
      const activeChatId = safeGetActiveChat().chatId;
      const activeChatRun = getActiveRunForChat(activeChatId);
      indicator.sync(activeChatRun);
      drawer.setSceneActiveRun(activeChatRun);
      renderToolbar();
    }
    return true;
  }

  function clearImpersonateDraftRetry(): void {
    if (impersonateDraftRetryTimer !== undefined) {
      clearTimeout(impersonateDraftRetryTimer);
      impersonateDraftRetryTimer = undefined;
    }
    impersonateDraftRetryChatId = null;
    impersonateDraftRetryAttempt = 0;
  }

  function scheduleImpersonateDraftRetry(chatId: string): void {
    if (destroyed) return;
    if (impersonateDraftRetryChatId !== chatId) {
      clearImpersonateDraftRetry();
      impersonateDraftRetryChatId = chatId;
      impersonateDraftRetryAttempt = 0;
    }
    if (impersonateDraftRetryTimer !== undefined) return;
    const delayMs = IMPERSONATE_DRAFT_RETRY_DELAYS_MS[impersonateDraftRetryAttempt];
    if (delayMs === undefined) return;
    impersonateDraftRetryAttempt += 1;
    impersonateDraftRetryTimer = setTimeout(() => {
      impersonateDraftRetryTimer = undefined;
      if (destroyed) return;
      applyPendingImpersonateDraft(chatId, { fromRetry: true });
    }, delayMs);
  }

  function setPendingImpersonateDraft(chatId: string, text: string): void {
    if (pendingImpersonateDrafts.has(chatId)) {
      pendingImpersonateDrafts.delete(chatId);
    } else if (pendingImpersonateDrafts.size >= MAX_PENDING_IMPERSONATE_DRAFTS) {
      const oldestKey = pendingImpersonateDrafts.keys().next().value;
      if (oldestKey !== undefined) {
        pendingImpersonateDrafts.delete(oldestKey);
      }
    }
    pendingImpersonateDrafts.set(chatId, text);
  }

  function applyPendingImpersonateDraft(
    chatId: string | null | undefined,
    options: { fromRetry?: boolean } = {},
  ): void {
    if (destroyed || !chatId) return;
    const draft = pendingImpersonateDrafts.get(chatId);
    if (draft === undefined) {
      if (impersonateDraftRetryChatId === chatId) {
        clearImpersonateDraftRetry();
      }
      return;
    }
    const state = safeGetComposerState();
    const activeChatId = safeGetActiveChat().chatId;
    if (activeChatId !== chatId) {
      if (impersonateDraftRetryChatId === chatId) {
        clearImpersonateDraftRetry();
      }
      return;
    }
    if (!isComposerAvailable(state) || state.chatId !== chatId) {
      if (!options.fromRetry) {
        clearImpersonateDraftRetry();
      }
      scheduleImpersonateDraftRetry(chatId);
      return;
    }
    clearImpersonateDraftRetry();
    if (state.text.trim().length > 0) {
      pendingImpersonateDrafts.delete(chatId);
      return;
    }
    if (safeSetComposerText(draft, state)) {
      pendingImpersonateDrafts.delete(chatId);
      safeFocusComposer(state);
    }
  }

  function safeGetComposerState(): HostComposerState | null {
    if (destroyed) return null;
    try {
      return ctx.composer?.getState?.() ?? null;
    } catch {
      return null;
    }
  }

  function isComposerAvailable(
    state: HostComposerState | null,
  ): state is HostComposerState {
    return Boolean(state) && state!.mounted !== false;
  }

  function safeSetComposerText(
    text: string,
    precheckedState?: HostComposerState | null,
  ): boolean {
    if (destroyed) return false;
    const state =
      precheckedState !== undefined ? precheckedState : safeGetComposerState();
    if (!isComposerAvailable(state)) return false;
    try {
      ctx.composer.setText(text);
      return true;
    } catch {
      return false;
    }
  }

  function safeFocusComposer(
    precheckedState?: HostComposerState | null,
  ): boolean {
    if (destroyed) return false;
    const state =
      precheckedState !== undefined ? precheckedState : safeGetComposerState();
    if (!isComposerAvailable(state)) return false;
    try {
      ctx.composer.focus();
      return true;
    } catch {
      return false;
    }
  }

  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  function rpc<T = unknown>(
    action: RpcActionName,
    input?: unknown,
    timeoutMs = 30_000,
    onDispatch?: (requestId: string) => void,
  ): Promise<T> {
    if (destroyed) return Promise.reject(new Error("Extension unloaded."));
    const requestId = `gg-${++seq}-${Date.now().toString(36)}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new RpcTimeoutError(action));
      }, timeoutMs);

      pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      onDispatch?.(requestId);

      ctx.sendToBackend({
        type: "gg:rpc",
        requestId,
        action,
        input,
      });
    });
  }

  function showBanner(
    text: string,
    kind: "info" | "warn" | "error" = "info",
    ephemeralMs = 5_000,
  ): void {
    if (destroyed) return;
    drawer.setNotice(text, kind);

    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }

    if (composerAlertMount) {
      if (!text) {
        composerAlertMount.replaceChildren();
      } else {
        const banner = document.createElement("div");
        banner.className = `gg-notice${kind === "error" ? " is-error" : kind === "warn" ? " is-warn" : ""}`;
        if (kind === "error" || kind === "warn") {
          banner.setAttribute("role", "alert");
          banner.setAttribute("aria-live", "assertive");
        } else {
          banner.setAttribute("role", "status");
          banner.setAttribute("aria-live", "polite");
        }
        banner.style.margin = "4px 12px";
        banner.textContent = text;
        composerAlertMount.replaceChildren(banner);
      }
    }

    if (text && ephemeralMs > 0) {
      noticeTimer = setTimeout(() => {
        noticeTimer = undefined;
        if (destroyed) return;
        drawer.setNotice("", "info");
        composerAlertMount?.replaceChildren();
      }, ephemeralMs);
    }
  }

  function clearBanner(): void {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    if (destroyed) return;
    drawer.setNotice("", "info");
    composerAlertMount?.replaceChildren();
  }

  function syncRecoveryBusy(): void {
    if (destroyed) return;
    const { chatId } = safeGetActiveChat();
    drawer.setRecoveryBusy(isChatBusy(chatId));
  }

  function clearTabConnectionObserver(): void {
    if (stopObservingTabConnection) {
      stopObservingTabConnection();
      stopObservingTabConnection = null;
    }
  }

  function renderToolbar(): void {
    if (destroyed || !view) return;
    const { chatId } = safeGetActiveChat();
    toolbar.render({
      settings: view.settings,
      activeRun: getActiveRunForChat(chatId),
      isBusy: isChatBusy(chatId),
      recovery: view.recovery,
      hasActiveChat: Boolean(chatId),
      chatId,
      armedScene: getArmedSceneForChat(chatId),
    });
    syncRecoveryBusy();
  }

  function syncBusyUi(): void {
    if (destroyed) return;
    if (view) {
      renderToolbar();
    } else {
      syncRecoveryBusy();
    }
  }

  async function loadSceneContext(options: { force?: boolean } = {}): Promise<void> {
    if (destroyed) return;
    if (!options.force && !drawer.isShowingGuidedScene()) return;
    const { chatId } = safeGetActiveChat();
    const mySeq = ++sceneContextSeq;
    if (!chatId) {
      drawer.setSceneLoading(false);
      drawer.setSceneContext(null, null);
      return;
    }
    drawer.setSceneLoading(true);
    try {
      const context = await rpc<GuidedSceneChatContext>("get_scene_context", {
        chatId,
      });
      if (
        destroyed ||
        mySeq !== sceneContextSeq ||
        safeGetActiveChat().chatId !== chatId
      ) {
        return;
      }
      if (context && typeof context.chatId === "string") {
        if (context.armedScene) {
          armedScenesByChat.set(context.chatId, context.armedScene);
        } else {
          armedScenesByChat.delete(context.chatId);
        }
      }
      drawer.setSceneLoading(false);
      drawer.setSceneContext(context, null);
      renderToolbar();
    } catch (error) {
      if (
        destroyed ||
        mySeq !== sceneContextSeq ||
        safeGetActiveChat().chatId !== chatId
      ) {
        return;
      }
      drawer.setSceneLoading(false);
      const msg = error instanceof Error ? error.message : String(error);
      drawer.setSceneContext(null, msg);
    }
  }

  async function saveSceneConfigPatch(
    patch: Partial<GuidedSceneConfig>,
  ): Promise<void> {
    if (destroyed || !view) return;
    const currentScene = normalizeGuidedSceneConfig(view.settings.guidedScene);
    const nextSettings: GuidedGenerationsSettings = {
      ...view.settings,
      guidedScene: {
        ...currentScene,
        ...patch,
      },
    };
    const rev = ++settingsRevision;
    view = { ...view, settings: nextSettings };
    drawer.syncSettings(nextSettings);
    renderToolbar();
    try {
      const saved = await rpc<GuidedGenerationsSettings>(
        "save_settings",
        nextSettings,
      );
      if (destroyed || !view || rev !== settingsRevision) return;
      const unchanged = areJsonValuesEqual(saved, view.settings);
      view = { ...view, settings: saved };
      if (!unchanged) {
        drawer.syncSettings(saved);
        renderToolbar();
      }
    } catch (error) {
      if (destroyed) return;
      showBanner(
        `Failed saving settings: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      if (rev === settingsRevision) {
        void refresh();
      }
    }
  }

  function abortRunById(runId: string): void {
    if (destroyed) return;
    if (isPendingRunId(runId)) {
      const activeChatId = safeGetActiveChat().chatId;
      const pendingRun =
        (activeChatId ? activeRunsByChat.get(activeChatId) : undefined) ??
        Array.from(activeRunsByChat.values()).find((r) => r.runId === runId);
      const targetChatId = pendingRun?.chatId ?? activeChatId;
      if (targetChatId) {
        clearPendingRun(targetChatId, runId);
        void rpc("abort_action", { chatId: targetChatId }).catch(() => undefined);
      }
      return;
    }
    void rpc<{ aborted?: boolean }>("abort_action", { runId }).then(
      (res) => {
        if (destroyed) return;
        if (!res?.aborted) {
          void refresh({ onlyIfChanged: true });
        }
      },
      () => {
        if (destroyed) return;
        void refresh({ onlyIfChanged: true });
      },
    );
  }

  async function executeSceneDropNow(
    input: DropSceneNowInput,
  ): Promise<DropSceneNowResult> {
    if (destroyed) {
      throw new Error("Extension unloaded.");
    }
    const chatId = input.chatId;
    if (!chatId) {
      throw new Error("Open a chat before dropping a scene.");
    }
    if (isChatBusy(chatId)) {
      throw new Error("Wait for the active guided run to finish first.");
    }

    const hasLockedDraft =
      Boolean(input.draftLocked) &&
      Boolean((input.lockedDraftText ?? input.previewText)?.trim());
    const willStreamBridge =
      input.delivery !== "cut" &&
      input.adjustmentMode === "verbatim" &&
      !hasLockedDraft;
    const willStreamRewrite =
      input.adjustmentMode !== "verbatim" && !hasLockedDraft;
    const mightStream = willStreamBridge || willStreamRewrite;

    launchingChats.add(chatId);
    const pendingRun = mightStream
      ? startPendingRun("guided_scene", chatId)
      : null;
    if (!mightStream) {
      syncBusyUi();
    }

    let reconciled = false;
    let currentRequestId = "";
    const actionEntry: InFlightActionRpc = {
      requestId: "",
      actionId: "guided_scene",
      chatId,
      startedAt: Date.now(),
      observedRunId: null,
      cancelAsReconciled: () => {
        if (reconciled) return;
        reconciled = true;
        const waiter = pending.get(currentRequestId);
        if (waiter) {
          pending.delete(currentRequestId);
          clearTimeout(waiter.timer);
          waiter.resolve(undefined);
        }
        if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
          inFlightActionRpcsByChat.delete(chatId);
        }
        launchingChats.delete(chatId);
        if (pendingRun) {
          clearPendingRun(chatId, pendingRun.runId);
        }
        syncBusyUi();
      },
    };

    try {
      clearBanner();
      const result = await rpc<DropSceneNowResult>(
        "drop_scene_now",
        input,
        ACTION_RPC_TIMEOUT_MS,
        (requestId) => {
          currentRequestId = requestId;
          actionEntry.requestId = requestId;
          inFlightActionRpcsByChat.set(chatId, actionEntry);
        },
      );
      if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
        inFlightActionRpcsByChat.delete(chatId);
      }
      if (pendingRun) {
        clearPendingRun(chatId, pendingRun.runId);
      }
      if (!destroyed && !reconciled && drawerMounted && drawer.isShowingGuidedScene()) {
        void loadSceneContext();
      }
      return result;
    } catch (error) {
      if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
        inFlightActionRpcsByChat.delete(chatId);
      }
      if (pendingRun) {
        clearPendingRun(chatId, pendingRun.runId);
      }
      if (!destroyed && !reconciled && getActiveRunForChat(chatId)) {
        void refresh({ onlyIfChanged: true });
      }
      throw error;
    } finally {
      if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
        inFlightActionRpcsByChat.delete(chatId);
      }
      launchingChats.delete(chatId);
      if (pendingRun) {
        clearPendingRun(chatId, pendingRun.runId);
      }
      syncBusyUi();
    }
  }

  function toggleSceneDrawer(): void {
    if (destroyed) return;
    let drawerState: { open?: boolean; tabId?: string | null } | null = null;
    try {
      drawerState = ctx.ui?.events?.getDrawerState?.() ?? null;
    } catch {
      drawerState = null;
    }
    const isMainDrawerOpenOnScene =
      Boolean(drawerState?.open) &&
      drawerState?.tabId === drawer.getTabId() &&
      drawer.isShowingGuidedScene();

    if (isMainDrawerOpenOnScene) {
      void rpc("close_drawer").catch(() => undefined);
      return;
    }

    const wasShowing = drawer.isShowingGuidedScene();
    drawer.openGuidedScene();
    if (!drawerMounted) {
      drawerMounted = true;
      clearTabConnectionObserver();
      drawer.render(view);
    }
    suppressingActivateSceneLoad = true;
    try {
      drawer.activate();
    } finally {
      suppressingActivateSceneLoad = false;
    }
    if (!catalogsLoaded) {
      void refresh({ onlyIfChanged: false, includeCatalogs: true });
    }
    // openGuidedScene() already triggers onActiveViewChange -> loadSceneContext when !wasShowing
    if (wasShowing) {
      void loadSceneContext({ force: true });
    }
  }

  async function handleToolbarSceneDropNextTurn(): Promise<void> {
    if (destroyed) return;
    const { chatId } = safeGetActiveChat();
    if (!chatId) return;
    try {
      const raw = await rpc<unknown>("drop_next_turn", { chatId });
      if (destroyed) return;
      applyArmedSceneForChat(chatId, extractArmedSceneResult(raw));
      showBanner("Guided Scene set to drop on the next turn.", "info");
    } catch (error) {
      if (destroyed) return;
      showBanner(
        error instanceof Error ? error.message : String(error),
        "error",
        7_000,
      );
    }
  }

  async function handleToolbarSceneDropNow(): Promise<void> {
    if (destroyed) return;
    const { chatId } = safeGetActiveChat();
    if (!chatId) return;
    const armed = getArmedSceneForChat(chatId);
    if (!armed) return;
    try {
      await executeSceneDropNow({
        chatId,
        greetingSource: armed.greetingSource,
        selectedGreetingKey: armed.selectedGreetingKey ?? null,
        greetingLabel: armed.greetingLabel,
        rawGreetingText: armed.rawGreetingText,
        speakerCharacterId: armed.speakerCharacterId ?? null,
        speakerCharacterName: armed.speakerCharacterName ?? null,
        delivery: armed.delivery,
        transitionNote: armed.transitionNote,
        adjustmentMode: armed.adjustmentMode,
        customDirection: armed.customDirection,
        keepMediaIntact:
          armed.keepMediaIntact ??
          view?.settings.guidedScene?.keepMediaIntact ??
          true,
        draftLocked: armed.draftLocked,
        lockedDraftText: armed.lockedDraftText,
        previewText: armed.lockedDraftText ?? undefined,
        dropTarget: "new_message",
        activeConnectionId: safeGetActiveConnectionId(),
      });
    } catch (error) {
      if (destroyed) return;
      showBanner(
        error instanceof Error ? error.message : String(error),
        "error",
        7_000,
      );
    }
  }

  async function handleToolbarSceneTogglePause(): Promise<void> {
    if (destroyed) return;
    const { chatId } = safeGetActiveChat();
    if (!chatId) return;
    const armed = getArmedSceneForChat(chatId);
    if (!armed) return;
    const action: RpcActionName =
      armed.status === "paused" ? "resume_scene" : "pause_scene";
    try {
      const raw = await rpc<unknown>(action, { chatId });
      if (destroyed) return;
      applyArmedSceneForChat(chatId, extractArmedSceneResult(raw));
    } catch (error) {
      if (destroyed) return;
      showBanner(
        error instanceof Error ? error.message : String(error),
        "error",
        7_000,
      );
    }
  }

  async function handleToolbarSceneCancel(): Promise<void> {
    if (destroyed) return;
    const { chatId } = safeGetActiveChat();
    if (!chatId) return;
    try {
      await rpc("cancel_scene", { chatId });
      if (destroyed) return;
      applyArmedSceneForChat(chatId, null);
    } catch (error) {
      if (destroyed) return;
      showBanner(
        error instanceof Error ? error.message : String(error),
        "error",
        7_000,
      );
    }
  }

  async function refresh(
    options: { onlyIfChanged?: boolean; includeCatalogs?: boolean; fresh?: boolean } = {},
  ): Promise<boolean> {
    if (destroyed) return false;
    if (!drawerMounted && drawer.isTabConnected()) {
      drawerMounted = true;
      clearTabConnectionObserver();
      drawer.render(view);
    }
    const drawerOpen = drawerMounted && drawer.isTabConnected();
    const includeCatalogs =
      options.includeCatalogs !== undefined
        ? Boolean(options.includeCatalogs)
        : drawerMounted && (!catalogsLoaded || drawerOpen);

    if (inFlightRefresh && (!includeCatalogs || inFlightRefreshIncludeCatalogs)) {
      pendingFollowUpRefresh = true;
      pendingFollowUpOnlyIfChanged =
        pendingFollowUpOnlyIfChanged && Boolean(options.onlyIfChanged);
      pendingFollowUpIncludeCatalogs =
        pendingFollowUpIncludeCatalogs || includeCatalogs;
      if (options.fresh) {
        await inFlightRefresh;
        if (destroyed) return false;
        if (inFlightRefresh) {
          return inFlightRefresh;
        }
        return refresh({
          onlyIfChanged: options.onlyIfChanged,
          includeCatalogs,
          fresh: false,
        });
      }
      return inFlightRefresh;
    }

    let runPromise!: Promise<boolean>;
    runPromise = (async (): Promise<boolean> => {
      const myBootstrapSeq = ++bootstrapSeq;
      const startSettingsRevision = settingsRevision;
      const startStatusSeq = statusSeq;
      try {
        const rawNext = await rpc<ExtensionBootstrapView>("get_bootstrap", {
          includeCatalogs,
        });
        if (destroyed) return false;
        if (myBootstrapSeq !== bootstrapSeq) {
          if (inFlightRefresh && inFlightRefresh !== runPromise) {
            return inFlightRefresh;
          }
          return lastRefreshSucceeded;
        }
        const next = includeCatalogs
          ? await withFrontendConnectionFallback(rawNext, ctx)
          : rawNext;
        if (destroyed) return false;
        if (myBootstrapSeq !== bootstrapSeq) {
          if (inFlightRefresh && inFlightRefresh !== runPromise) {
            return inFlightRefresh;
          }
          return lastRefreshSucceeded;
        }

        const resolvedSettings =
          view && settingsRevision !== startSettingsRevision
            ? view.settings
            : next.settings;

        hydrateArmedScenesFromBootstrap(next);

        const bootstrapRunsByChat = new Map<string, ActiveRunState>();
        const bootstrapRuns = (
          next as ExtensionBootstrapView & { activeRuns?: ActiveRunState[] }
        ).activeRuns;
        if (Array.isArray(bootstrapRuns)) {
          for (const r of bootstrapRuns) {
            if (r && typeof r.chatId === "string" && r.chatId.length > 0) {
              bootstrapRunsByChat.set(r.chatId, r);
            }
          }
        }
        if (
          next.activeRun &&
          typeof next.activeRun.chatId === "string" &&
          next.activeRun.chatId.length > 0
        ) {
          bootstrapRunsByChat.set(next.activeRun.chatId, next.activeRun);
        }

        const prevRealRunIdByChat = new Map<string, string>();
        for (const [chatId, run] of activeRunsByChat.entries()) {
          if (!isPendingRunId(run.runId)) {
            prevRealRunIdByChat.set(chatId, run.runId);
          }
        }

        const terminalRuns = (
          next as ExtensionBootstrapView & { recentTerminalRuns?: TerminalRunSummary[] }
        ).recentTerminalRuns;
        const recentTerminals = Array.isArray(terminalRuns) ? terminalRuns : [];

        for (const [chatId, run] of bootstrapRunsByChat.entries()) {
          if (!isPendingRunId(run.runId)) {
            const inFlight = inFlightActionRpcsByChat.get(chatId);
            if (inFlight) {
              inFlight.observedRunId = run.runId;
            }
          }
        }

        const preservedPendingRuns = new Map<string, ActiveRunState>();
        for (const [chatId, run] of activeRunsByChat.entries()) {
          if (isPendingRunId(run.runId) && launchingChats.has(chatId)) {
            preservedPendingRuns.set(chatId, run);
          }
        }

        if (statusSeq === startStatusSeq) {
          activeRunsByChat.clear();
          for (const [chatId, run] of bootstrapRunsByChat.entries()) {
            activeRunsByChat.set(chatId, run);
          }
        } else if (globalClearSeq <= startStatusSeq) {
          for (const chatId of [...activeRunsByChat.keys()]) {
            if ((chatStatusSeq.get(chatId) ?? 0) <= startStatusSeq) {
              const refreshedRun = bootstrapRunsByChat.get(chatId);
              if (refreshedRun) {
                activeRunsByChat.set(chatId, refreshedRun);
              } else {
                activeRunsByChat.delete(chatId);
              }
            }
          }
          for (const [chatId, run] of bootstrapRunsByChat.entries()) {
            if (
              !activeRunsByChat.has(chatId) &&
              (chatStatusSeq.get(chatId) ?? 0) <= startStatusSeq
            ) {
              activeRunsByChat.set(chatId, run);
            }
          }
        }

        // Reconcile orphaned action RPCs whose backend run is confirmed finished.
        for (const [chatId, inFlight] of [...inFlightActionRpcsByChat.entries()]) {
          if ((chatStatusSeq.get(chatId) ?? 0) > startStatusSeq) {
            continue;
          }
          const backendRun = bootstrapRunsByChat.get(chatId);
          const prevRealRunId = prevRealRunIdByChat.get(chatId) ?? null;
          const matchedTerminal = recentTerminals.find((t) =>
            inFlight.observedRunId !== null
              ? t.runId === inFlight.observedRunId
              : t.chatId === chatId &&
                t.actionId === inFlight.actionId &&
                t.finishedAt >= inFlight.startedAt,
          );
          const knownRunFinished =
            (matchedTerminal !== undefined &&
              (!backendRun || backendRun.runId !== matchedTerminal.runId)) ||
            (inFlight.observedRunId !== null &&
              (!backendRun || backendRun.runId !== inFlight.observedRunId)) ||
            (prevRealRunId !== null &&
              (!backendRun || backendRun.runId !== prevRealRunId));
          if (knownRunFinished) {
            inFlight.cancelAsReconciled();
          }
        }

        for (const [chatId, pendingRun] of preservedPendingRuns.entries()) {
          if (
            !activeRunsByChat.has(chatId) &&
            launchingChats.has(chatId) &&
            inFlightActionRpcsByChat.has(chatId)
          ) {
            activeRunsByChat.set(chatId, pendingRun);
          }
        }

        syncActiveRunReconcileTimer();
        syncPrimaryActiveRun();
        const resolvedActiveRun = activeRun;

        const prevView = view;
        let missedErrorToShow: string | null = null;
        if (recentTerminals.length > 0) {
          if (prevView === null) {
            for (const entry of recentTerminals) {
              markTerminalRunSeen(entry.runId);
            }
          } else {
            const ordered = [...recentTerminals].sort(
              (a, b) => a.finishedAt - b.finishedAt,
            );
            for (const entry of ordered) {
              if (seenTerminalRunIds.has(entry.runId)) continue;
              markTerminalRunSeen(entry.runId);
              if (
                entry.status === "error" &&
                typeof entry.error === "string" &&
                entry.error.length > 0
              ) {
                missedErrorToShow = entry.error;
              }
            }
          }
        }

        const preserveLoadedCatalogs =
          !includeCatalogs && catalogsLoaded && prevView !== null;
        const mergedNext: ExtensionBootstrapView = {
          ...next,
          settings: resolvedSettings,
          activeRun: resolvedActiveRun,
          ...(preserveLoadedCatalogs
            ? {
                connections: prevView.connections,
                presets: prevView.presets,
                catalogWarnings: prevView.catalogWarnings,
              }
            : {}),
        };

        const isInitialCatalogLoad = includeCatalogs && !catalogsLoaded;
        if (includeCatalogs) {
          catalogsLoaded = true;
        }

        const shouldDiffDrawer =
          drawerMounted &&
          Boolean(options.onlyIfChanged) &&
          !isInitialCatalogLoad &&
          prevView !== null;

        const coreUnchanged =
          shouldDiffDrawer &&
          areJsonValuesEqual(prevView.settings, mergedNext.settings) &&
          areJsonValuesEqual(prevView.connections, mergedNext.connections) &&
          areJsonValuesEqual(prevView.presets, mergedNext.presets) &&
          areJsonValuesEqual(prevView.permissions, mergedNext.permissions) &&
          areJsonValuesEqual(
            prevView.catalogWarnings ?? [],
            mergedNext.catalogWarnings ?? [],
          );

        view = mergedNext;
        activeRun = resolvedActiveRun;
        const currentChatId = safeGetActiveChat().chatId;
        const currentChatRun = getActiveRunForChat(currentChatId);
        indicator.sync(currentChatRun);
        drawer.setSceneActiveRun(currentChatRun);
        drawer.setArmedScene(getArmedSceneForChat(currentChatId), currentChatId);
        chatHeads.syncRuns(
          Array.from(activeRunsByChat.values()).filter((r) => !isPendingRunId(r.runId)),
          currentChatId,
        );
        if (drawerMounted) {
          if (!coreUnchanged) {
            drawer.render(view);
          } else if (!areJsonValuesEqual(prevView!.recovery, mergedNext.recovery)) {
            drawer.updateRecovery(view.recovery, view.settings);
          }
        }
        renderToolbar();
        if (missedErrorToShow) {
          showBanner(missedErrorToShow, "error", 7_000);
        }
        lastRefreshSucceeded = true;
        return true;
      } catch (error) {
        if (destroyed) return false;
        lastRefreshSucceeded = false;
        const msg = error instanceof Error ? error.message : String(error);
        showBanner(msg, "error");
        return false;
      } finally {
        if (inFlightRefresh === runPromise) {
          inFlightRefresh = null;
          inFlightRefreshIncludeCatalogs = false;
          if (pendingFollowUpRefresh && !destroyed) {
            const followUpOnlyIfChanged = pendingFollowUpOnlyIfChanged;
            const followUpIncludeCatalogs = pendingFollowUpIncludeCatalogs;
            pendingFollowUpRefresh = false;
            pendingFollowUpOnlyIfChanged = true;
            pendingFollowUpIncludeCatalogs = false;
            void refresh({
              onlyIfChanged: followUpOnlyIfChanged,
              includeCatalogs: followUpIncludeCatalogs,
            });
          }
        }
      }
    })();

    inFlightRefresh = runPromise;
    inFlightRefreshIncludeCatalogs = includeCatalogs;
    return runPromise;
  }

  async function executeActionRpc(params: {
    rpcAction: "run_action" | "regenerate_last_continue";
    actionId: GuidedActionId;
    chatId: string;
    payload: RunActionInput | RegenerateContinueInput;
    backgroundSwipe?: boolean;
    onRollback?: () => void;
  }): Promise<void> {
    const {
      rpcAction,
      actionId,
      chatId,
      payload,
      backgroundSwipe,
      onRollback,
    } = params;
    const pendingRun = startPendingRun(actionId, chatId, { backgroundSwipe });
    let reconciled = false;
    let currentRequestId = "";

    const actionEntry: InFlightActionRpc = {
      requestId: "",
      actionId,
      chatId,
      startedAt: Date.now(),
      observedRunId: null,
      cancelAsReconciled: () => {
        if (reconciled) return;
        reconciled = true;
        const waiter = pending.get(currentRequestId);
        if (waiter) {
          pending.delete(currentRequestId);
          clearTimeout(waiter.timer);
          waiter.resolve(undefined);
        }
        if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
          inFlightActionRpcsByChat.delete(chatId);
        }
        launchingChats.delete(chatId);
        clearPendingRun(chatId, pendingRun.runId);
        syncBusyUi();
      },
    };

    try {
      // Streaming generations may take longer than default 30s.
      const result = await rpc<ActionRunResult | undefined>(
        rpcAction,
        payload,
        ACTION_RPC_TIMEOUT_MS,
        (requestId) => {
          currentRequestId = requestId;
          actionEntry.requestId = requestId;
          inFlightActionRpcsByChat.set(chatId, actionEntry);
        },
      );
      if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
        inFlightActionRpcsByChat.delete(chatId);
      }
      if (destroyed || reconciled) return;

      const resultRunId =
        result && typeof result === "object" && typeof result.runId === "string"
          ? result.runId
          : actionEntry.observedRunId;
      if (resultRunId) {
        markTerminalRunSeen(resultRunId);
      }
      clearPendingRun(chatId, pendingRun.runId);

      const lingeringRun = activeRunsByChat.get(chatId);
      if (
        lingeringRun &&
        !isPendingRunId(lingeringRun.runId) &&
        (!resultRunId || lingeringRun.runId === resultRunId)
      ) {
        void refresh({ onlyIfChanged: true });
      }
    } catch (error) {
      if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
        inFlightActionRpcsByChat.delete(chatId);
      }
      clearPendingRun(chatId, pendingRun.runId);
      if (destroyed || reconciled) return;

      const msg = error instanceof Error ? error.message : String(error);
      if (isRpcTimeoutError(error)) {
        const refreshed = await refresh({ onlyIfChanged: true, fresh: true });
        if (destroyed) return;
        if (!refreshed) {
          onRollback?.();
          showBanner(msg, "error", 7_000);
        }
        return;
      }

      if (actionEntry.observedRunId) {
        markTerminalRunSeen(actionEntry.observedRunId);
      }
      onRollback?.();
      showBanner(msg, "error", 7_000);
      if (getActiveRunForChat(chatId)) {
        void refresh({ onlyIfChanged: true });
      }
    } finally {
      if (inFlightActionRpcsByChat.get(chatId) === actionEntry) {
        inFlightActionRpcsByChat.delete(chatId);
      }
      clearPendingRun(chatId, pendingRun.runId);
    }
  }

  async function triggerAction(
    actionId: GuidedActionId,
    options?: { backgroundSwipe?: boolean },
  ): Promise<void> {
    if (destroyed || isPreChatLaunching) return;
    const preChatId = safeGetActiveChat().chatId;
    if (
      preChatId &&
      (getActiveRunForChat(preChatId) || launchingChats.has(preChatId))
    ) {
      return;
    }

    isPreChatLaunching = true;
    let lockedChatId: string | null = preChatId;
    if (lockedChatId) {
      launchingChats.add(lockedChatId);
      syncBusyUi();
    }

    try {
      if (!view) await refresh();
      isPreChatLaunching = false;
      if (destroyed || !view) return;

      const { chatId } = safeGetActiveChat();
      if (!chatId) {
        showBanner("Open a chat before triggering a guided action.", "warn");
        return;
      }

      if (lockedChatId !== chatId) {
        if (lockedChatId) {
          launchingChats.delete(lockedChatId);
        }
        if (launchingChats.has(chatId)) return;
        lockedChatId = chatId;
        launchingChats.add(lockedChatId);
        syncBusyUi();
      }

      if (getActiveRunForChat(chatId)) return;

      const state = safeGetComposerState();
      if (!isComposerAvailable(state)) {
        showBanner(
          "Composer is unavailable right now. Open the message input bar and try again.",
          "warn",
        );
        return;
      }
      if (state.chatId !== null && state.chatId !== chatId) {
        showBanner("Active chat changed; please try again.", "warn");
        return;
      }

      const inputText = state.text;
      const config = view.settings.actions[actionId];

      if (actionId === "guided_response" && !inputText.trim()) {
        showBanner(
          "Type guidance in the input box before clicking Guided Response.",
          "warn",
        );
        safeFocusComposer();
        return;
      }

      clearBanner();
      pendingImpersonateDrafts.delete(chatId);

      const shouldClear =
        Boolean(inputText.trim()) &&
        (config.clearInputOnRun || actionId === "guided_impersonate");
      if (shouldClear && !safeSetComposerText("")) {
        showBanner("Composer is unavailable right now.", "warn");
        return;
      }

      const activeConnectionId = safeGetActiveConnectionId();
      const isBackgroundSwipe =
        actionId === "guided_swipe" && Boolean(options?.backgroundSwipe);
      const payload: RunActionInput = {
        actionId,
        chatId,
        activeConnectionId,
        inputText,
        ...(isBackgroundSwipe ? { backgroundSwipe: true } : {}),
      };

      await executeActionRpc({
        rpcAction: "run_action",
        actionId,
        chatId,
        payload,
        backgroundSwipe: isBackgroundSwipe,
        onRollback: () => {
          // Restore cleared input only when no backend run is still active for this chat,
          // the same chat & composer are still mounted, and the user hasn't typed.
          if (shouldClear && !getActiveRunForChat(chatId)) {
            const currentComposer = safeGetComposerState();
            const activeChatId = safeGetActiveChat().chatId;
            if (
              isComposerAvailable(currentComposer) &&
              currentComposer.chatId === chatId &&
              activeChatId === chatId &&
              !currentComposer.text
            ) {
              safeSetComposerText(inputText);
            }
          }
        },
      });
    } finally {
      isPreChatLaunching = false;
      if (lockedChatId) {
        launchingChats.delete(lockedChatId);
      }
      syncBusyUi();
    }
  }

  function restoreRecoveryEntry(entry: RecoveryEntry): void {
    const activeChatId = safeGetActiveChat().chatId;
    if (destroyed || !view) return;
    if (isChatBusy(activeChatId)) {
      showBanner(
        "Wait for the active guided generation to finish before restoring input.",
        "warn",
      );
      return;
    }
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner(
        "Composer is unavailable right now — cannot restore input.",
        "warn",
      );
      return;
    }
    if (state.chatId !== null && state.chatId !== activeChatId) {
      showBanner("Active chat changed; please try again.", "warn");
      return;
    }
    if (!safeSetComposerText(entry.text)) {
      showBanner(
        "Composer is unavailable right now — cannot restore input.",
        "warn",
      );
      return;
    }
    safeFocusComposer();
    clearBanner();
  }

  function clearCurrentInput(): void {
    const activeChatId = safeGetActiveChat().chatId;
    if (destroyed || !view || isChatBusy(activeChatId)) {
      return;
    }
    if (!view.settings.inputRecovery.enabled) return;

    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner(
        "Composer is unavailable right now — cannot clear input.",
        "warn",
      );
      return;
    }
    if (state.chatId !== null && state.chatId !== activeChatId) {
      showBanner("Active chat changed; please try again.", "warn");
      return;
    }

    if (!state.text) {
      safeFocusComposer();
      clearBanner();
      return;
    }

    if (!safeSetComposerText("")) {
      showBanner(
        "Composer is unavailable right now — cannot clear input.",
        "warn",
      );
      return;
    }

    safeFocusComposer();
    clearBanner();
  }

  async function removeLastContinue(): Promise<void> {
    if (destroyed || isPreChatLaunching) return;
    const { chatId } = safeGetActiveChat();
    if (!chatId) {
      showBanner("Open a chat before removing the last continue.", "warn");
      return;
    }
    if (isChatBusy(chatId)) return;
    launchingChats.add(chatId);
    syncBusyUi();
    pendingImpersonateDrafts.delete(chatId);
    try {
      clearBanner();
      await rpc<RemoveContinueResult>("remove_last_continue", { chatId });
    } catch (error) {
      if (destroyed) return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "warn", 7_000);
    } finally {
      launchingChats.delete(chatId);
      syncBusyUi();
    }
  }

  async function regenerateLastContinue(): Promise<void> {
    if (destroyed || isPreChatLaunching) return;
    const { chatId } = safeGetActiveChat();
    if (!chatId) {
      showBanner("Open a chat before regenerating the last continue.", "warn");
      return;
    }
    if (isChatBusy(chatId)) return;
    launchingChats.add(chatId);
    syncBusyUi();
    pendingImpersonateDrafts.delete(chatId);
    try {
      clearBanner();
      const activeConnectionId = safeGetActiveConnectionId();
      const payload: RegenerateContinueInput = {
        chatId,
        activeConnectionId,
      };
      await executeActionRpc({
        rpcAction: "regenerate_last_continue",
        actionId: "guided_continue",
        chatId,
        payload,
      });
    } finally {
      launchingChats.delete(chatId);
      syncBusyUi();
    }
  }

  async function clearRecoveryHistory(): Promise<void> {
    const activeChatId = safeGetActiveChat().chatId;
    if (destroyed) return;
    if (isChatBusy(activeChatId)) {
      showBanner(
        "Wait for the active guided generation to finish before clearing input recovery history.",
        "warn",
      );
      return;
    }
    try {
      const recovery = await rpc<RecoveryEntry[]>("clear_recovery");
      if (destroyed) return;
      if (view) {
        view = { ...view, recovery };
        renderToolbar();
        if (drawerMounted) {
          drawer.updateRecovery(view.recovery, view.settings);
        }
      }
    } catch (error) {
      if (destroyed) return;
      showBanner(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  const indicator = new StreamingIndicatorController(ctx);
  const chatHeads = new ChatHeadController(ctx);
  const pillMetrics = new PillMetricsController(ctx);

  const toolbar = new InputToolbarController(ctx, {
    onTriggerAction: (actionId, options) => {
      void triggerAction(actionId, options);
    },
    onAbortAction: (runId) => {
      abortRunById(runId);
    },
    onRestoreLatest: () => {
      const activeChatId = safeGetActiveChat().chatId;
      if (destroyed || !view || isChatBusy(activeChatId)) {
        return;
      }
      const latest = pickRecoveryEntry(view.recovery);
      if (latest) {
        restoreRecoveryEntry(latest);
      } else {
        clearCurrentInput();
      }
    },
    onRestoreEntry: (entry) => {
      restoreRecoveryEntry(entry);
    },
    onClearRecovery: () => {
      void clearRecoveryHistory();
    },
    onRemoveLastContinue: () => {
      void removeLastContinue();
    },
    onRegenerateLastContinue: () => {
      void regenerateLastContinue();
    },
    onToggleSceneDrawer: () => {
      toggleSceneDrawer();
    },
    onSceneDropNextTurn: () => {
      void handleToolbarSceneDropNextTurn();
    },
    onSceneDropNow: () => {
      void handleToolbarSceneDropNow();
    },
    onSceneTogglePause: () => {
      void handleToolbarSceneTogglePause();
    },
    onSceneCancelSteering: () => {
      void handleToolbarSceneCancel();
    },
  });

  const drawer = new SettingsDrawerController(ctx, {
    onRefresh: () => {
      if (destroyed) return;
      clearBanner();
      void refresh({ includeCatalogs: true });
      if (drawer.isShowingGuidedScene()) {
        void loadSceneContext();
      }
    },
    onSaveSettings: async (nextSettings: GuidedGenerationsSettings, options) => {
      if (destroyed || !view) return;
      const rev = ++settingsRevision;
      view = { ...view, settings: nextSettings };
      renderToolbar();
      if (options?.rebuildDrawer) drawer.render(view, { force: true });
      try {
        const saved = await rpc<GuidedGenerationsSettings>(
          "save_settings",
          nextSettings,
        );
        if (destroyed || !view || rev !== settingsRevision) return;
        const settingsUnchanged = areJsonValuesEqual(saved, view.settings);
        view = { ...view, settings: saved };
        if (!settingsUnchanged) {
          renderToolbar();
          if (options?.rebuildDrawer) {
            drawer.render(view);
          } else {
            drawer.syncSettings(saved);
          }
        }
      } catch (error) {
        if (destroyed) return;
        showBanner(
          `Failed saving settings: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        if (rev === settingsRevision) {
          void refresh();
        }
      }
    },
    onRestoreEntry: (entry) => restoreRecoveryEntry(entry),
    onClearRecovery: () => clearRecoveryHistory(),
    onActiveViewChange: (_tab, _subTab) => {
      if (destroyed) return;
      if (drawer.isShowingGuidedScene()) {
        void loadSceneContext({ force: true });
      }
    },
    scene: {
      onRefreshContext: async () => {
        await loadSceneContext({ force: true });
      },
      onSaveSceneConfigPatch: async (patch) => {
        await saveSceneConfigPatch(patch);
      },
      onPreviewDraft: async (input: PreviewSceneDraftInput) => {
        return rpc<PreviewSceneDraftResult>(
          "preview_scene_draft",
          input,
          ACTION_RPC_TIMEOUT_MS,
        );
      },
      onCancelPreview: (chatId: string) => {
        void rpc("abort_action", { chatId }).catch(() => undefined);
      },
      onAbortRun: (runId: string) => {
        abortRunById(runId);
      },
      onDropSceneNow: async (input: DropSceneNowInput) => {
        return executeSceneDropNow(input);
      },
      onArmScene: async (input: ArmSceneInput) => {
        const raw = await rpc<unknown>("arm_scene", input);
        const armed = extractArmedSceneResult(raw);
        if (!destroyed) {
          applyArmedSceneForChat(input.chatId, armed);
        }
        return armed;
      },
      onUpdateArmedScene: async (input: UpdateArmedSceneInput) => {
        const raw = await rpc<unknown>("update_armed_scene", input);
        const armed = extractArmedSceneResult(raw);
        if (!destroyed) {
          applyArmedSceneForChat(input.chatId, armed);
        }
        return armed;
      },
      onPauseScene: async (chatId: string) => {
        const raw = await rpc<unknown>("pause_scene", { chatId });
        const armed = extractArmedSceneResult(raw);
        if (!destroyed) {
          applyArmedSceneForChat(chatId, armed);
        }
        return armed;
      },
      onResumeScene: async (chatId: string) => {
        const raw = await rpc<unknown>("resume_scene", { chatId });
        const armed = extractArmedSceneResult(raw);
        if (!destroyed) {
          applyArmedSceneForChat(chatId, armed);
        }
        return armed;
      },
      onDropNextTurn: async (chatId: string) => {
        const raw = await rpc<unknown>("drop_next_turn", { chatId });
        const armed = extractArmedSceneResult(raw);
        if (!destroyed) {
          applyArmedSceneForChat(chatId, armed);
        }
        return armed;
      },
      onCancelScene: async (chatId: string) => {
        await rpc("cancel_scene", { chatId });
        if (!destroyed) {
          applyArmedSceneForChat(chatId, null);
        }
      },
      getActiveConnectionId: () => safeGetActiveConnectionId(),
    },
  });

  drawerMounted = drawer.isTabConnected();

  function activateDrawer(): void {
    if (destroyed) return;
    clearTabConnectionObserver();
    if (!drawerMounted) {
      drawerMounted = true;
      drawer.render(view);
    }
    void refresh({ onlyIfChanged: catalogsLoaded, includeCatalogs: true });
    if (!suppressingActivateSceneLoad && drawer.isShowingGuidedScene()) {
      void loadSceneContext();
    }
  }

  if (!drawerMounted) {
    stopObservingTabConnection = drawer.observeTabConnection(() => {
      activateDrawer();
    });
    disposers.push(() => {
      clearTabConnectionObserver();
    });
  }

  function handleActiveChatChanged(metricsChatId?: string | null): void {
    if (destroyed) return;
    const activeChatId = safeGetActiveChat().chatId;
    const effectiveMetricsChatId =
      metricsChatId !== undefined ? metricsChatId : activeChatId;
    const dedupeKey = `${activeChatId ?? ""}\0${effectiveMetricsChatId ?? ""}`;
    if (dedupeKey === lastChatSwitchKey) {
      return;
    }
    lastChatSwitchKey = dedupeKey;
    lastObservedActiveChatId = activeChatId;
    if (!chatSwitchResetQueued) {
      chatSwitchResetQueued = true;
      queueMicrotask(() => {
        chatSwitchResetQueued = false;
        lastChatSwitchKey = null;
      });
    }
    clearImpersonateDraftRetry();
    syncPrimaryActiveRun();
    const activeChatRun = getActiveRunForChat(activeChatId);
    indicator.sync(activeChatRun);
    drawer.setSceneActiveRun(activeChatRun);
    drawer.setArmedScene(getArmedSceneForChat(activeChatId), activeChatId);
    chatHeads.onChatChanged(activeChatId);
    renderToolbar();
    applyPendingImpersonateDraft(activeChatId);
    pillMetrics.onChatChanged(effectiveMetricsChatId);
    sceneContextSeq += 1;
    if (drawerMounted && drawer.isTabConnected() && drawer.isShowingGuidedScene()) {
      void loadSceneContext();
    } else {
      drawer.setSceneLoading(false);
      drawer.setSceneContext(null, null);
    }
  }

  disposers.push(
    drawer.onActivate(() => {
      activateDrawer();
    }),
  );

  disposers.push(
    ctx.onBackendMessage((rawPayload) => {
      if (destroyed) return;
      const msg = isRecord(rawPayload) ? rawPayload : {};

      if (msg.type === "gg:reply" && typeof msg.requestId === "string") {
        const waiter = pending.get(msg.requestId);
        if (!waiter) return;
        pending.delete(msg.requestId);
        clearTimeout(waiter.timer);
        if (typeof msg.error === "string" && msg.error) {
          waiter.reject(new Error(msg.error));
        } else {
          waiter.resolve(msg.result);
        }
        return;
      }

      const event = msg as unknown as BackendPushEvent;
      switch (event.type) {
        case "gg:status": {
          statusSeq += 1;
          const activeChatId = safeGetActiveChat().chatId;
          const prevActiveChatRun = getActiveRunForChat(activeChatId);
          const eventChatId =
            typeof event.chatId === "string" && event.chatId.length > 0
              ? event.chatId
              : undefined;
          const hasTerminalSignal =
            Boolean(event.done) || Boolean(event.aborted) || Boolean(event.error);
          const isUnscopedErrorStatus =
            eventChatId === undefined && hasTerminalSignal && Boolean(event.error);
          const prevEventChatRun = eventChatId
            ? activeRunsByChat.get(eventChatId)
            : undefined;
          const prevRunChatRun = event.run
            ? activeRunsByChat.get(event.run.chatId)
            : undefined;

          if (event.run) {
            if (
              eventChatId &&
              event.run.chatId !== eventChatId &&
              hasTerminalSignal
            ) {
              markTerminalRunSeen(prevEventChatRun?.runId);
              markTerminalRunSeen(
                inFlightActionRpcsByChat.get(eventChatId)?.observedRunId,
              );
              activeRunsByChat.delete(eventChatId);
              setChatStatusSeq(eventChatId, statusSeq);
              if (
                (prevEventChatRun !== undefined &&
                  prevEventChatRun.actionId !== "guided_impersonate") ||
                event.aborted ||
                event.error
              ) {
                pendingImpersonateDrafts.delete(eventChatId);
              }
            }
            if (
              !hasTerminalSignal ||
              isUnscopedErrorStatus ||
              (eventChatId !== undefined && event.run.chatId !== eventChatId)
            ) {
              if (prevRunChatRun?.runId !== event.run.runId) {
                pendingImpersonateDrafts.delete(event.run.chatId);
                lastForegroundReconcileAt = 0;
              }
              if (!isPendingRunId(event.run.runId)) {
                const inFlight = inFlightActionRpcsByChat.get(event.run.chatId);
                if (inFlight) {
                  inFlight.observedRunId = event.run.runId;
                }
              }
              activeRunsByChat.set(event.run.chatId, event.run);
              setChatStatusSeq(event.run.chatId, statusSeq);
            } else {
              markTerminalRunSeen(event.run.runId);
              markTerminalRunSeen(prevRunChatRun?.runId);
              activeRunsByChat.delete(event.run.chatId);
              setChatStatusSeq(event.run.chatId, statusSeq);
              if (
                event.run.actionId !== "guided_impersonate" ||
                event.aborted ||
                event.error
              ) {
                pendingImpersonateDrafts.delete(event.run.chatId);
              }
            }
          } else if (eventChatId) {
            markTerminalRunSeen(prevEventChatRun?.runId);
            markTerminalRunSeen(
              inFlightActionRpcsByChat.get(eventChatId)?.observedRunId,
            );
            activeRunsByChat.delete(eventChatId);
            setChatStatusSeq(eventChatId, statusSeq);
            if (
              (prevEventChatRun !== undefined &&
                prevEventChatRun.actionId !== "guided_impersonate") ||
              event.aborted ||
              event.error
            ) {
              pendingImpersonateDrafts.delete(eventChatId);
            }
          } else if (!isUnscopedErrorStatus) {
            if (hasTerminalSignal) {
              for (const run of activeRunsByChat.values()) {
                markTerminalRunSeen(run.runId);
              }
              for (const inFlight of inFlightActionRpcsByChat.values()) {
                markTerminalRunSeen(inFlight.observedRunId);
              }
            }
            activeRunsByChat.clear();
            globalClearSeq = statusSeq;
            if (hasTerminalSignal) {
              pendingImpersonateDrafts.clear();
            }
          }

          syncActiveRunReconcileTimer();
          syncPrimaryActiveRun();
          if (view) {
            view = {
              ...view,
              activeRun,
            };
          }
          const nextActiveChatRun = getActiveRunForChat(activeChatId);
          const activeChatAffected =
            prevActiveChatRun !== nextActiveChatRun ||
            (activeChatId !== null &&
              (eventChatId === activeChatId || event.run?.chatId === activeChatId)) ||
            (!eventChatId && !event.run && !isUnscopedErrorStatus);
          if (activeChatAffected) {
            indicator.sync(nextActiveChatRun);
            drawer.setSceneActiveRun(nextActiveChatRun);
          }
          chatHeads.handleStatusEvent(event, activeChatId);
          if (activeChatAffected) {
            renderToolbar();
          }
          if (event.error) {
            showBanner(event.error, "error", 7_000);
          }
          return;
        }
        case "gg:scene-updated": {
          if (Array.isArray(event.armedScenes)) {
            armedScenesByChat.clear();
            for (const item of event.armedScenes) {
              if (isArmedSceneState(item)) {
                armedScenesByChat.set(item.chatId, item);
              }
            }
          }
          const targetChatId =
            typeof event.chatId === "string" && event.chatId.length > 0
              ? event.chatId
              : isArmedSceneState(event.armedScene)
                ? event.armedScene.chatId
                : null;
          if (targetChatId) {
            if (isArmedSceneState(event.armedScene)) {
              armedScenesByChat.set(targetChatId, event.armedScene);
            } else if (event.armedScene === null || !Array.isArray(event.armedScenes)) {
              armedScenesByChat.delete(targetChatId);
            }
          }
          const activeChatId = safeGetActiveChat().chatId;
          drawer.setArmedScene(getArmedSceneForChat(activeChatId), activeChatId);
          renderToolbar();
          if (
            event.reason === "dropped" &&
            targetChatId &&
            targetChatId === activeChatId &&
            drawerMounted &&
            drawer.isTabConnected() &&
            drawer.isShowingGuidedScene()
          ) {
            void loadSceneContext();
          }
          return;
        }
        case "gg:impersonate-chunk": {
          if (typeof event.text === "string") {
            const rawChatId = (event as { chatId?: unknown }).chatId;
            const chunkChatId = typeof rawChatId === "string" ? rawChatId : null;
            const expectedChatId =
              chunkChatId ??
              (activeRunsByChat.size === 1
                ? Array.from(activeRunsByChat.values())[0]!.chatId
                : activeRun?.chatId ?? null);
            const activeChatId = safeGetActiveChat().chatId;
            if (expectedChatId !== null && expectedChatId !== activeChatId) {
              if (event.done && !event.aborted && event.text.length > 0) {
                setPendingImpersonateDraft(expectedChatId, event.text);
              }
              return;
            }
            const state = safeGetComposerState();
            if (
              !isComposerAvailable(state) ||
              !activeChatId ||
              state.chatId !== activeChatId
            ) {
              if (
                event.done &&
                !event.aborted &&
                event.text.length > 0 &&
                expectedChatId
              ) {
                setPendingImpersonateDraft(expectedChatId, event.text);
                if (expectedChatId === activeChatId) {
                  applyPendingImpersonateDraft(activeChatId);
                }
              }
              return;
            }
            if (safeSetComposerText(event.text, state)) {
              pendingImpersonateDrafts.delete(activeChatId);
              if (event.done) {
                safeFocusComposer(state);
              }
            } else if (event.done && !event.aborted && event.text.length > 0) {
              setPendingImpersonateDraft(activeChatId, event.text);
            }
          }
          return;
        }
        case "gg:recovery-updated": {
          if (view && Array.isArray(event.recovery)) {
            view = { ...view, recovery: event.recovery };
            renderToolbar();
            if (drawerMounted) {
              drawer.updateRecovery(view.recovery, view.settings);
            }
          }
          return;
        }
        case "gg:changed": {
          void refresh({ onlyIfChanged: true });
          return;
        }
        case "gg:generation_metrics": {
          if (
            typeof event.chatId === "string" &&
            typeof event.messageId === "string" &&
            typeof event.swipeId === "number"
          ) {
            pillMetrics.handleMetricsEvent(event);
          }
          return;
        }
      }
    }),
  );

  disposers.push(
    ctx.events.on("CHAT_SWITCHED", (payload) => {
      handleActiveChatChanged(
        extractChatIdFromPayload(payload) ?? safeGetActiveChat().chatId,
      );
    }),
  );
  disposers.push(
    ctx.events.on("CHAT_CHANGED", (payload) => {
      handleActiveChatChanged(
        extractChatIdFromPayload(payload) ?? safeGetActiveChat().chatId,
      );
    }),
  );
  disposers.push(
    ctx.events.on("CHAT_DELETED", (payload) => {
      if (destroyed) return;
      const deletedChatId = extractDeletedChatIdFromPayload(payload);
      if (!deletedChatId) return;
      statusSeq += 1;
      setChatStatusSeq(deletedChatId, statusSeq);
      activeRunsByChat.delete(deletedChatId);
      armedScenesByChat.delete(deletedChatId);
      pendingImpersonateDrafts.delete(deletedChatId);
      if (impersonateDraftRetryChatId === deletedChatId) {
        clearImpersonateDraftRetry();
      }
      launchingChats.delete(deletedChatId);
      syncActiveRunReconcileTimer();
      syncPrimaryActiveRun();
      const activeChatId = safeGetActiveChat().chatId;
      const activeChatRun = getActiveRunForChat(activeChatId);
      indicator.sync(activeChatRun);
      drawer.setSceneActiveRun(activeChatRun);
      drawer.setArmedScene(getArmedSceneForChat(activeChatId), activeChatId);
      chatHeads.onChatDeleted(deletedChatId);
      pillMetrics.onChatDeleted(deletedChatId);
      renderToolbar();
    }),
  );
  const refreshSceneContextOnMessageChange = () => {
    if (
      !destroyed &&
      drawerMounted &&
      drawer.isTabConnected() &&
      drawer.isShowingGuidedScene()
    ) {
      void loadSceneContext();
    }
  };
  disposers.push(
    ctx.events.on("MESSAGE_SENT", () => {
      refreshSceneContextOnMessageChange();
    }),
  );
  disposers.push(
    ctx.events.on("MESSAGE_SWIPED", (payload) => {
      if (!destroyed) pillMetrics.onMessageEvent(payload);
    }),
  );
  disposers.push(
    ctx.events.on("MESSAGE_EDITED", (payload) => {
      if (!destroyed) pillMetrics.onMessageEvent(payload);
    }),
  );
  disposers.push(
    ctx.events.on("MESSAGE_DELETED", (payload) => {
      if (!destroyed) {
        pillMetrics.onMessageDeleted(payload);
        refreshSceneContextOnMessageChange();
      }
    }),
  );

  if (ctx.connections?.subscribe) {
    disposers.push(
      ctx.connections.subscribe(() => {
        if (!destroyed && drawerMounted) {
          if (drawer.isTabConnected() || !catalogsLoaded) {
            void refresh({ onlyIfChanged: true, includeCatalogs: true });
          } else {
            catalogsLoaded = false;
          }
        }
      }),
    );
  }

  let stateSubscribed = false;
  try {
    if (ctx.state) {
      disposers.push(
        ctx.state.subscribe("chat.active", () => {
          const nextChatId = safeGetActiveChat().chatId;
          if (nextChatId === lastObservedActiveChatId) return;
          handleActiveChatChanged();
        }),
      );
      stateSubscribed = true;
    }
  } catch {
    // Older host fallback below
  }
  if (!stateSubscribed) {
    let lastChatId = safeGetActiveChat().chatId;
    const poll = setInterval(() => {
      if (destroyed) return;
      const nextChatId = safeGetActiveChat().chatId;
      if (nextChatId !== lastChatId) {
        lastChatId = nextChatId;
        handleActiveChatChanged(nextChatId);
      }
    }, 600);
    disposers.push(() => clearInterval(poll));
  }

  if (typeof document !== "undefined") {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconcileOnForeground();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    disposers.push(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  }

  const win =
    typeof window !== "undefined"
      ? window
      : typeof document !== "undefined"
        ? document.defaultView
        : null;
  if (win && typeof win.addEventListener === "function") {
    const onForegroundEvent = () => {
      reconcileOnForeground();
    };
    win.addEventListener("focus", onForegroundEvent);
    win.addEventListener("pageshow", onForegroundEvent);
    win.addEventListener("online", onForegroundEvent);
    disposers.push(() => {
      win.removeEventListener("focus", onForegroundEvent);
      win.removeEventListener("pageshow", onForegroundEvent);
      win.removeEventListener("online", onForegroundEvent);
    });
  }

  ctx.ready();
  void refresh();

  return () => {
    try {
      drawer.flushPendingSaves();
    } catch {
      // Ignore flush errors on teardown
    }
    destroyed = true;
    stopActiveRunReconcileTimer();
    inFlightRefresh = null;
    inFlightRefreshIncludeCatalogs = false;
    pendingFollowUpRefresh = false;
    clearImpersonateDraftRetry();
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Ignore teardown disposer errors
      }
    }
    disposers.length = 0;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Guided Generations unloaded."));
    }
    pending.clear();
    inFlightActionRpcsByChat.clear();
    seenTerminalRunIds.clear();
    launchingChats.clear();
    activeRunsByChat.clear();
    armedScenesByChat.clear();
    chatStatusSeq.clear();
    pendingImpersonateDrafts.clear();
    try {
      pillMetrics.destroy();
    } catch {}
    try {
      chatHeads.destroy();
    } catch {}
    try {
      indicator.destroy();
    } catch {}
    try {
      toolbar.destroy();
    } catch {}
    try {
      drawer.destroy();
    } catch {}
    try {
      composerAlertMount?.replaceChildren();
    } catch {}
    try {
      removeStyle();
    } catch {}
  };
}
