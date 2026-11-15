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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function withFrontendConnectionFallback(
  next: ExtensionBootstrapView,
  ctx: FrontendContextWithHostExtensions,
): ExtensionBootstrapView {
  if (next.connections.length > 0 || !ctx.connections?.list) return next;
  try {
    const profiles = ctx.connections.list();
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
  let bootstrapSeq = 0;
  let settingsRevision = 0;
  let statusSeq = 0;
  let isLaunching = false;
  let view: ExtensionBootstrapView | null = null;
  let activeRun: ActiveRunState | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let composerAlertMount: Element | null = null;

  try {
    composerAlertMount = ctx.ui.mount("chat_composer_above");
  } catch {
    composerAlertMount = null;
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

  function safeSetComposerText(text: string): boolean {
    if (destroyed) return false;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) return false;
    try {
      ctx.composer.setText(text);
      return true;
    } catch {
      return false;
    }
  }

  function safeFocusComposer(): boolean {
    if (destroyed) return false;
    const state = safeGetComposerState();
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

  function renderToolbar(): void {
    if (destroyed || !view) return;
    const { chatId } = ctx.getActiveChat();
    toolbar.render({
      settings: view.settings,
      activeRun,
      recovery: view.recovery,
      hasActiveChat: Boolean(chatId),
    });
  }

  async function refresh(options: { onlyIfChanged?: boolean } = {}): Promise<void> {
    if (destroyed) return;
    const myBootstrapSeq = ++bootstrapSeq;
    const startSettingsRevision = settingsRevision;
    const startStatusSeq = statusSeq;
    try {
      const rawNext = await rpc<ExtensionBootstrapView>("get_bootstrap");
      if (destroyed || myBootstrapSeq !== bootstrapSeq) return;
      const next = withFrontendConnectionFallback(rawNext, ctx);

      const resolvedSettings =
        view && settingsRevision !== startSettingsRevision
          ? view.settings
          : next.settings;
      const resolvedActiveRun =
        statusSeq !== startStatusSeq ? activeRun : next.activeRun;

      const mergedNext: ExtensionBootstrapView = {
        ...next,
        settings: resolvedSettings,
        activeRun: resolvedActiveRun,
      };

      const coreUnchanged =
        Boolean(options.onlyIfChanged) &&
        view !== null &&
        JSON.stringify({
          settings: view.settings,
          connections: view.connections,
          presets: view.presets,
          permissions: view.permissions,
          catalogWarnings: view.catalogWarnings ?? [],
        }) ===
          JSON.stringify({
            settings: mergedNext.settings,
            connections: mergedNext.connections,
            presets: mergedNext.presets,
            permissions: mergedNext.permissions,
            catalogWarnings: mergedNext.catalogWarnings ?? [],
          });

      const recoveryUnchanged =
        Boolean(options.onlyIfChanged) &&
        view !== null &&
        JSON.stringify(view.recovery) === JSON.stringify(mergedNext.recovery);

      view = mergedNext;
      activeRun = resolvedActiveRun;
      indicator.sync(activeRun);
      if (!coreUnchanged) {
        drawer.render(view);
      } else if (!recoveryUnchanged) {
        drawer.updateRecovery(view.recovery, view.settings);
      }
      renderToolbar();
    } catch (error) {
      if (destroyed) return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "error");
    }
  }

  async function triggerAction(
    actionId: GuidedActionId,
    options?: { backgroundSwipe?: boolean },
  ): Promise<void> {
    if (destroyed || activeRun || isLaunching) return;
    isLaunching = true;
    try {
      if (!view) await refresh();
      if (destroyed || !view || activeRun) return;

      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before triggering a guided action.", "warn");
        return;
      }

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

      const shouldClear =
        Boolean(inputText.trim()) &&
        (config.clearInputOnRun || actionId === "guided_impersonate");
      if (shouldClear && !safeSetComposerText("")) {
        showBanner("Composer is unavailable right now.", "warn");
        return;
      }

      const activeConnectionId = ctx.connections?.getActive?.()?.activeProfileId ?? null;
      const payload: RunActionInput = {
        actionId,
        chatId,
        activeConnectionId,
        inputText,
        ...(actionId === "guided_swipe" && options?.backgroundSwipe
          ? { backgroundSwipe: true }
          : {}),
      };

      try {
        // Streaming generations may take longer than default 30s.
        await rpc("run_action", payload, 300_000);
        if (destroyed) return;
      } catch (error) {
        if (destroyed) return;
        // Restore cleared input only when no backend run is still active,
        // the same chat & composer are still mounted, and the user hasn't typed.
        if (shouldClear && !activeRun) {
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
      }
    } finally {
      isLaunching = false;
    }
  }

  function restoreRecoveryEntry(entry: RecoveryEntry): void {
    if (destroyed) return;
    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner(
        "Composer is unavailable right now — cannot restore input.",
        "warn",
      );
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
    if (destroyed || !view || activeRun) return;
    if (!view.settings.inputRecovery.enabled) return;

    const state = safeGetComposerState();
    if (!isComposerAvailable(state)) {
      showBanner(
        "Composer is unavailable right now — cannot clear input.",
        "warn",
      );
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
    if (destroyed || activeRun || isLaunching) return;
    isLaunching = true;
    try {
      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before removing the last continue.", "warn");
        return;
      }
      clearBanner();
      await rpc<RemoveContinueResult>("remove_last_continue", { chatId });
    } catch (error) {
      if (destroyed) return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "warn", 7_000);
    } finally {
      isLaunching = false;
    }
  }

  async function regenerateLastContinue(): Promise<void> {
    if (destroyed || activeRun || isLaunching) return;
    isLaunching = true;
    try {
      const { chatId } = ctx.getActiveChat();
      if (!chatId) {
        showBanner("Open a chat before regenerating the last continue.", "warn");
        return;
      }
      clearBanner();
      const activeConnectionId = ctx.connections?.getActive?.()?.activeProfileId ?? null;
      const payload: RegenerateContinueInput = {
        chatId,
        activeConnectionId,
      };
      await rpc("regenerate_last_continue", payload, 300_000);
    } catch (error) {
      if (destroyed) return;
      const msg = error instanceof Error ? error.message : String(error);
      showBanner(msg, "error", 7_000);
    } finally {
      isLaunching = false;
    }
  }

  const indicator = new StreamingIndicatorController(ctx);
  const pillMetrics = new PillMetricsController(ctx);

  const toolbar = new InputToolbarController(ctx, {
    onTriggerAction: (actionId, options) => {
      void triggerAction(actionId, options);
    },
    onAbortAction: (runId) => {
      if (destroyed) return;
      void rpc("abort_action", { runId }).catch(() => undefined);
    },
    onRestoreLatest: () => {
      if (destroyed || !view || activeRun) return;
      const latest = pickRecoveryEntry(view.recovery);
      if (latest) {
        restoreRecoveryEntry(latest);
      } else {
        clearCurrentInput();
      }
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
      void refresh();
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
        view = { ...view, settings: saved };
        renderToolbar();
        if (options?.rebuildDrawer) drawer.render(view, { force: true });
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
    onClearRecovery: async () => {
      if (destroyed) return;
      try {
        const recovery = await rpc<RecoveryEntry[]>("clear_recovery");
        if (destroyed) return;
        if (view) {
          view = { ...view, recovery };
          renderToolbar();
          drawer.updateRecovery(view.recovery, view.settings);
        }
      } catch (error) {
        if (destroyed) return;
        showBanner(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  disposers.push(
    drawer.onActivate(() => {
      if (!destroyed) void refresh({ onlyIfChanged: true });
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
          activeRun = event.run ?? null;
          if (view) view = { ...view, activeRun };
          indicator.sync(activeRun);
          renderToolbar();
          if (event.error) {
            showBanner(event.error, "error", 7_000);
          }
          return;
        }
        case "gg:impersonate-chunk": {
          if (typeof event.text === "string") {
            const rawChatId = (event as { chatId?: unknown }).chatId;
            const chunkChatId = typeof rawChatId === "string" ? rawChatId : null;
            const expectedChatId = chunkChatId ?? activeRun?.chatId ?? null;
            const state = safeGetComposerState();
            const activeChatId = ctx.getActiveChat().chatId;
            if (
              !isComposerAvailable(state) ||
              !activeChatId ||
              state.chatId !== activeChatId ||
              (expectedChatId !== null && expectedChatId !== activeChatId)
            ) {
              return;
            }
            if (safeSetComposerText(event.text) && event.done) {
              safeFocusComposer();
            }
          }
          return;
        }
        case "gg:recovery-updated": {
          if (view && Array.isArray(event.recovery)) {
            view = { ...view, recovery: event.recovery };
            renderToolbar();
            drawer.updateRecovery(view.recovery, view.settings);
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
      if (destroyed) return;
      renderToolbar();
      pillMetrics.onChatChanged(
        extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId,
      );
    }),
  );
  disposers.push(
    ctx.events.on("CHAT_CHANGED", (payload) => {
      if (destroyed) return;
      renderToolbar();
      pillMetrics.onChatChanged(
        extractChatIdFromPayload(payload) ?? ctx.getActiveChat().chatId,
      );
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

  if (ctx.connections?.subscribe) {
    disposers.push(
      ctx.connections.subscribe(() => {
        if (!destroyed) void refresh({ onlyIfChanged: true });
      }),
    );
  }

  let stateSubscribed = false;
  try {
    if (ctx.state) {
      disposers.push(
        ctx.state.subscribe("chat.active", () => {
          if (!destroyed) {
            indicator.sync(activeRun);
            renderToolbar();
          }
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
        indicator.sync(activeRun);
        renderToolbar();
      }
    }, 600);
    disposers.push(() => clearInterval(poll));
  }

  ctx.ready();
  void refresh();

  return () => {
    drawer.flushPendingSaves();
    destroyed = true;
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    for (const dispose of disposers) dispose();
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Guided Generations unloaded."));
    }
    pending.clear();
    pillMetrics.destroy();
    indicator.destroy();
    toolbar.destroy();
    drawer.destroy();
    composerAlertMount?.replaceChildren();
    removeStyle();
  };
}
