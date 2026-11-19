import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type {
  ActiveRunState,
  BackendPushEvent,
  ExtensionBootstrapView,
  GuidedActionId,
  GuidedGenerationsSettings,
  RecoveryEntry,
  RegenerateContinueInput,
  RemoveContinueResult,
  RpcActionName,
  RunActionInput,
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

function isPendingRunId(runId: string | null | undefined): boolean {
  return typeof runId === "string" && runId.startsWith(PENDING_RUN_ID_PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  let settingsRevision = 0;
  let statusSeq = 0;
  let globalClearSeq = 0;
  let isPreChatLaunching = false;
  const launchingChats = new Set<string>();
  let view: ExtensionBootstrapView | null = null;
  let drawerMounted = false;
  let catalogsLoaded = false;
  let stopObservingTabConnection: (() => void) | null = null;
  let activeRun: ActiveRunState | null = null;
  const activeRunsByChat = new Map<string, ActiveRunState>();
  const chatStatusSeq = new Map<string, number>();
  const pendingImpersonateDrafts = new Map<string, string>();
  const IMPERSONATE_DRAFT_RETRY_DELAYS_MS = [0, 20, 50, 100, 200] as const;
  let impersonateDraftRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let impersonateDraftRetryChatId: string | null = null;
  let impersonateDraftRetryAttempt = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let composerAlertMount: Element | null = null;
  let inFlightRefresh: Promise<void> | null = null;
  let inFlightRefreshIncludeCatalogs = false;
  let pendingFollowUpRefresh = false;
  let pendingFollowUpOnlyIfChanged = true;
  let pendingFollowUpIncludeCatalogs = false;
  let lastChatSwitchKey: string | null = null;
  let chatSwitchResetQueued = false;
  let lastObservedActiveChatId: string | null = ctx.getActiveChat().chatId;

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
    const currentChatId = ctx.getActiveChat().chatId;
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
    actionId: GuidedActionId,
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
    setChatStatusSeq(chatId, statusSeq);
    activeRunsByChat.set(chatId, pendingRun);
    syncPrimaryActiveRun();
    if (view) {
      view = { ...view, activeRun };
    }
    const activeChatId = ctx.getActiveChat().chatId;
    indicator.sync(getActiveRunForChat(activeChatId));
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
    syncPrimaryActiveRun();
    if (view) {
      view = { ...view, activeRun };
    }
    if (!destroyed) {
      const activeChatId = ctx.getActiveChat().chatId;
      indicator.sync(getActiveRunForChat(activeChatId));
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
    const activeChatId = ctx.getActiveChat().chatId;
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
  ): Promise<T> {
    if (destroyed) return Promise.reject(new Error("Extension unloaded."));
    const requestId = `gg-${++seq}-${Date.now().toString(36)}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out waiting for ${action}.`));
      }, timeoutMs);

      pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

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
    const { chatId } = ctx.getActiveChat();
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
    const { chatId } = ctx.getActiveChat();
    toolbar.render({
      settings: view.settings,
      activeRun: getActiveRunForChat(chatId),
      recovery: view.recovery,
      hasActiveChat: Boolean(chatId),
      chatId,
    });
    syncRecoveryBusy();
  }

  async function refresh(
    options: { onlyIfChanged?: boolean; includeCatalogs?: boolean } = {},
  ): Promise<void> {
    if (destroyed) return;
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
      return inFlightRefresh;
    }

    let runPromise!: Promise<void>;
    runPromise = (async () => {
      const myBootstrapSeq = ++bootstrapSeq;
      const startSettingsRevision = settingsRevision;
      const startStatusSeq = statusSeq;
      try {
        const rawNext = await rpc<ExtensionBootstrapView>("get_bootstrap", {
          includeCatalogs,
        });
        if (destroyed || myBootstrapSeq !== bootstrapSeq) return;
        const next = includeCatalogs
          ? await withFrontendConnectionFallback(rawNext, ctx)
          : rawNext;
        if (destroyed || myBootstrapSeq !== bootstrapSeq) return;

        const resolvedSettings =
          view && settingsRevision !== startSettingsRevision
            ? view.settings
            : next.settings;

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

        for (const [chatId, pendingRun] of preservedPendingRuns.entries()) {
          if (!activeRunsByChat.has(chatId) && launchingChats.has(chatId)) {
            activeRunsByChat.set(chatId, pendingRun);
          }
        }

        syncPrimaryActiveRun();
        const resolvedActiveRun = activeRun;

        const prevView = view;
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
        const currentChatId = ctx.getActiveChat().chatId;
        indicator.sync(getActiveRunForChat(currentChatId));
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
      } catch (error) {
        if (destroyed) return;
        const msg = error instanceof Error ? error.message : String(error);
        showBanner(msg, "error");
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

  async function triggerAction(
    actionId: GuidedActionId,
    options?: { backgroundSwipe?: boolean },
  ): Promise<void> {
    if (destroyed || isPreChatLaunching) return;
    const preChatId = ctx.getActiveChat().chatId;
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
      syncRecoveryBusy();
    }

    try {
      if (!view) await refresh();
      isPreChatLaunching = false;
      if (destroyed || !view) return;

      const { chatId } = ctx.getActiveChat();
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
        syncRecoveryBusy();
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

      const activeConnectionId = ctx.connections?.getActive?.()?.activeProfileId ?? null;
      const isBackgroundSwipe =
        actionId === "guided_swipe" && Boolean(options?.backgroundSwipe);
      const payload: RunActionInput = {
        actionId,
        chatId,
        activeConnectionId,
        inputText,
        ...(isBackgroundSwipe ? { backgroundSwipe: true } : {}),
      };

      const pendingRun = startPendingRun(actionId, chatId, {
        backgroundSwipe: isBackgroundSwipe,
      });

      try {
        // Streaming generations may take longer than default 30s.
        await rpc("run_action", payload, 300_000);
        if (destroyed) return;
      } catch (error) {
        clearPendingRun(chatId, pendingRun.runId);
        if (destroyed) return;
        // Restore cleared input only when no backend run is still active for this chat,
        // the same chat & composer are still mounted, and the user hasn't typed.
        if (shouldClear && !getActiveRunForChat(chatId)) {
          const currentComposer = safeGetComposerState();
          const activeChatId = ctx.getActiveChat().chatId;
          if (
            isComposerAvailable(currentComposer) &&
            currentComposer.chatId === chatId &&
            activeChatId === chatId &&
            !currentComposer.text
          ) {
            safeSetComposerText(inputText);
          }
        }
        const msg = error instanceof Error ? error.message : String(error);
        showBanner(msg, "error", 7_000);
      } finally {
        clearPendingRun(chatId, pendingRun.runId);
      }
    } finally {
      isPreChatLaunching = false;
      if (lockedChatId) {
        launchingChats.delete(lockedChatId);
      }
      syncRecoveryBusy();
    }
  }

  function restoreRecoveryEntry(entry: RecoveryEntry): void {
    const activeChatId = ctx.getActiveChat().chatId;
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
    const activeChatId = ctx.getActiveChat().chatId;
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
    const { chatId } = ctx.getActiveChat();
    if (!chatId) {
      showBanner("Open a chat before removing the last continue.", "warn");
      return;
    }
    if (isChatBusy(chatId)) return;
    launchingChats.add(chatId);
    syncRecoveryBusy();
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
      syncRecoveryBusy();
    }
  }

  async function regenerateLastContinue(): Promise<void> {
    if (destroyed || isPreChatLaunching) return;
    const { chatId } = ctx.getActiveChat();
    if (!chatId) {
      showBanner("Open a chat before regenerating the last continue.", "warn");
      return;
    }
    if (isChatBusy(chatId)) return;
    launchingChats.add(chatId);
    pendingImpersonateDrafts.delete(chatId);
    let pendingRun: ActiveRunState | null = null;
    try {
      clearBanner();
      pendingRun = startPendingRun("guided_continue", chatId);
      const activeConnectionId = ctx.connections?.getActive?.()?.activeProfileId ?? null;
      const payload: RegenerateContinueInput = {
        chatId,
        activeConnectionId,
      };
      await rpc("regenerate_last_continue", payload, 300_000);
    } catch (error) {
      if (pendingRun) {
        clearPendingRun(chatId, pendingRun.runId);
      }
      if (destroyed) return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "error", 7_000);
    } finally {
      if (pendingRun) {
        clearPendingRun(chatId, pendingRun.runId);
      }
      launchingChats.delete(chatId);
      syncRecoveryBusy();
    }
  }

  async function clearRecoveryHistory(): Promise<void> {
    const activeChatId = ctx.getActiveChat().chatId;
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
      if (destroyed) return;
      if (isPendingRunId(runId)) {
        const activeChatId = ctx.getActiveChat().chatId;
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
      void rpc("abort_action", { runId }).catch(() => undefined);
    },
    onRestoreLatest: () => {
      const activeChatId = ctx.getActiveChat().chatId;
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
  });

  const drawer = new SettingsDrawerController(ctx, {
    onRefresh: () => {
      if (destroyed) return;
      clearBanner();
      void refresh({ includeCatalogs: true });
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
          if (options?.rebuildDrawer) drawer.render(view);
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
    const activeChatId = ctx.getActiveChat().chatId;
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
    indicator.sync(getActiveRunForChat(activeChatId));
    chatHeads.onChatChanged(activeChatId);
    renderToolbar();
    applyPendingImpersonateDraft(activeChatId);
    pillMetrics.onChatChanged(effectiveMetricsChatId);
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
          const activeChatId = ctx.getActiveChat().chatId;
          const prevActiveChatRun = getActiveRunForChat(activeChatId);
          const eventChatId =
            typeof event.chatId === "string" && event.chatId.length > 0
              ? event.chatId
              : undefined;
          const hasTerminalSignal =
            Boolean(event.done) || Boolean(event.aborted) || Boolean(event.error);
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
              (eventChatId !== undefined && event.run.chatId !== eventChatId)
            ) {
              if (prevRunChatRun?.runId !== event.run.runId) {
                pendingImpersonateDrafts.delete(event.run.chatId);
              }
              activeRunsByChat.set(event.run.chatId, event.run);
              setChatStatusSeq(event.run.chatId, statusSeq);
            } else {
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
          } else {
            activeRunsByChat.clear();
            globalClearSeq = statusSeq;
            if (hasTerminalSignal) {
              pendingImpersonateDrafts.clear();
            }
          }

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
            (!eventChatId && !event.run);
          if (activeChatAffected) {
            indicator.sync(nextActiveChatRun);
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
        case "gg:impersonate-chunk": {
          if (typeof event.text === "string") {
            const rawChatId = (event as { chatId?: unknown }).chatId;
            const chunkChatId = typeof rawChatId === "string" ? rawChatId : null;
            const expectedChatId =
              chunkChatId ??
              (activeRunsByChat.size === 1
                ? Array.from(activeRunsByChat.values())[0]!.chatId
                : activeRun?.chatId ?? null);
            const activeChatId = ctx.getActiveChat().chatId;
            if (expectedChatId !== null && expectedChatId !== activeChatId) {
              if (event.done && !event.aborted && event.text.length > 0) {
                pendingImpersonateDrafts.set(expectedChatId, event.text);
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
                pendingImpersonateDrafts.set(expectedChatId, event.text);
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
              pendingImpersonateDrafts.set(activeChatId, event.text);
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
        extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId,
      );
    }),
  );
  disposers.push(
    ctx.events.on("CHAT_CHANGED", (payload) => {
      handleActiveChatChanged(
        extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId,
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
      pendingImpersonateDrafts.delete(deletedChatId);
      if (impersonateDraftRetryChatId === deletedChatId) {
        clearImpersonateDraftRetry();
      }
      launchingChats.delete(deletedChatId);
      syncPrimaryActiveRun();
      const activeChatId = ctx.getActiveChat().chatId;
      indicator.sync(getActiveRunForChat(activeChatId));
      chatHeads.onChatDeleted(deletedChatId);
      pillMetrics.onChatDeleted(deletedChatId);
      renderToolbar();
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
      if (!destroyed) pillMetrics.onMessageDeleted(payload);
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
          const nextChatId = ctx.getActiveChat().chatId;
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
    let lastChatId = ctx.getActiveChat().chatId;
    const poll = setInterval(() => {
      if (destroyed) return;
      const nextChatId = ctx.getActiveChat().chatId;
      if (nextChatId !== lastChatId) {
        lastChatId = nextChatId;
        handleActiveChatChanged(nextChatId);
      }
    }, 600);
    disposers.push(() => clearInterval(poll));
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
    launchingChats.clear();
    activeRunsByChat.clear();
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
