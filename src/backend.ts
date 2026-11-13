import type { SpindleAPI } from "lumiverse-spindle-types";
import { GuidedGenerationRunner } from "./backend/generation-runner";
import { SettingsStore } from "./backend/settings-store";
import { isGuidedActionId } from "./shared/defaults";
import type {
  BackendPushEvent,
  ExtensionBootstrapView,
  RpcReplyEnvelope,
  RpcRequestEnvelope,
  RunActionInput,
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
  };
}

export function registerBackend(api: SpindleAPI) {
  const store = new SettingsStore(api);

  function emitFrontend(event: BackendPushEvent, userId?: string): void {
    api.sendToFrontend(event, userId);
  }

  const runner = new GuidedGenerationRunner(api, store, emitFrontend);

  async function buildBootstrapView(userId?: string): Promise<ExtensionBootstrapView> {
    const [settings, catalogs, recovery] = await Promise.all([
      store.getSettings(userId),
      store.loadCatalogs(userId),
      store.getRecovery(userId),
    ]);

    return {
      settings,
      connections: catalogs.connections,
      presets: catalogs.presets,
      recovery,
      activeRun: runner.getActiveRun(userId),
      permissions: {
        generation: api.permissions.has("generation"),
        chats: api.permissions.has("chats"),
        chat_mutation: api.permissions.has("chat_mutation"),
        presets: api.permissions.has("presets"),
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
          reply(await buildBootstrapView(userId));
          return;
        }
        case "save_settings": {
          const saved = await store.saveSettings(req.input, userId);
          reply(saved);
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
          const aborted = runner.abortCurrent(
            userId,
            typeof record.runId === "string" ? record.runId : undefined,
          );
          reply({ aborted });
          return;
        }
        case "push_recovery": {
          const record = isRecord(req.input) ? req.input : {};
          const text = typeof record.text === "string" ? record.text : "";
          const actionId = isGuidedActionId(record.actionId)
            ? record.actionId
            : "guided_response";
          const settings = await store.getSettings(userId);
          if (!settings.inputRecovery.enabled) {
            reply(await store.getRecovery(userId));
            return;
          }
          const recovery = await store.pushRecovery(
            {
              text,
              actionId,
              chatId: typeof record.chatId === "string" ? record.chatId : null,
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
        default:
          throw new Error(`Unsupported action: ${String(req.action)}`);
      }
    } catch (error) {
      reply(undefined, error instanceof Error ? error.message : String(error));
    }
  }

  api.onFrontendMessage((payload, userId) => {
    const req = asRpcRequest(payload);
    if (!req) return;
    void handleRpc(req, userId);
  });

  api.permissions.onChanged(() => {
    emitFrontend({ type: "gg:changed", reason: "permissions" });
  });

  for (const eventName of ["CHAT_SWITCHED", "CHAT_CHANGED"]) {
    api.on(eventName, (_payload, userId) => {
      emitFrontend({ type: "gg:changed", reason: eventName.toLowerCase() }, userId);
    });
  }

  return { store, runner, handleRpc, buildBootstrapView };
}

if (typeof spindle !== "undefined") {
  registerBackend(spindle);
}
