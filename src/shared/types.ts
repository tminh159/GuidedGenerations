export type GuidedActionId =
  | "guided_response"
  | "guided_continue"
  | "guided_regenerate"
  | "guided_swipe"
  | "guided_impersonate";

export type ToolbarOptionId = GuidedActionId | "input_recovery";

export type ToolbarPlacement =
  | "after_native"
  | "before_native"
  | "right"
  | "below_bar";

export type GuidanceInjectionRole = "system" | "user" | "assistant";

export interface GuidedActionConfig {
  enabled: boolean;
  connectionId: string | null;
  model: string | null;
  presetId: string | null;
  injectionRole: GuidanceInjectionRole;
  instructionTemplate: string;
  clearInputOnRun: boolean;
}

export interface InputRecoveryConfig {
  enabled: boolean;
  maxEntries: number;
}

export interface GuidedGenerationsSettings {
  version: number;
  toolbarPlacement: ToolbarPlacement;
  buttonOrder: ToolbarOptionId[];
  actions: Record<GuidedActionId, GuidedActionConfig>;
  inputRecovery: InputRecoveryConfig;
}

export interface ConnectionOptionSummary {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
}

export interface PresetOptionSummary {
  id: string;
  name: string;
}

export interface RecoveryEntry {
  id: string;
  text: string;
  actionId: GuidedActionId;
  chatId: string | null;
  createdAt: number;
}

export interface ActiveRunState {
  runId: string;
  actionId: GuidedActionId;
  chatId: string;
  startedAt: number;
}

export interface ExtensionBootstrapView {
  settings: GuidedGenerationsSettings;
  connections: ConnectionOptionSummary[];
  presets: PresetOptionSummary[];
  recovery: RecoveryEntry[];
  activeRun: ActiveRunState | null;
  permissions: {
    generation: boolean;
    chats: boolean;
    chat_mutation: boolean;
    presets: boolean;
  };
  catalogWarnings?: string[];
}

export type RpcActionName =
  | "get_bootstrap"
  | "save_settings"
  | "run_action"
  | "abort_action"
  | "push_recovery"
  | "restore_recovery"
  | "clear_recovery";

export interface RpcRequestEnvelope {
  type: "gg:rpc";
  requestId: string;
  action: RpcActionName;
  input?: unknown;
}

export interface RpcReplyEnvelope {
  type: "gg:reply";
  requestId: string;
  result?: unknown;
  error?: string;
}

export interface RunActionInput {
  actionId: GuidedActionId;
  chatId?: string | null;
  activeConnectionId?: string | null;
  inputText: string;
}

export interface ActionRunResult {
  runId: string;
  actionId: GuidedActionId;
  chatId: string;
  aborted: boolean;
  messageId?: string;
  swipeId?: number;
  text?: string;
}

export interface BackendPushEvent {
  type:
    | "gg:changed"
    | "gg:status"
    | "gg:impersonate-chunk"
    | "gg:recovery-updated";
  reason?: string;
  run?: ActiveRunState | null;
  chatId?: string;
  text?: string;
  done?: boolean;
  aborted?: boolean;
  error?: string;
  recovery?: RecoveryEntry[];
}

