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

export type GuidancePosition =
  | "before_post_history"
  | "in_history"
  | "pre_history"
  | "post_history";

export interface GuidedActionConfig {
  enabled: boolean;
  connectionId: string | null;
  model: string | null;
  presetId: string | null;
  injectionRole: GuidanceInjectionRole;
  guidancePosition: GuidancePosition;
  guidanceDepth: number;
  instructionTemplate: string;
  clearInputOnRun: boolean;
  applyRegex: boolean;
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

export interface ContinueHistoryEntry {
  id: string;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  baseText: string;
  resultText: string;
  baseReasoning: string | null;
  baseReasoningDuration: number | null;
  inputText: string;
  createdAt: number;
}

export interface ActiveRunState {
  runId: string;
  actionId: GuidedActionId;
  chatId: string;
  startedAt: number;
  messageId?: string;
  swipeId?: number;
  backgroundSwipe?: boolean;
  hasContentOutput?: boolean;
  characterId?: string;
  characterName?: string;
  avatarUrl?: string;
}

export type TerminalRunStatus = "done" | "aborted" | "error";

export interface TerminalRunSummary {
  runId: string;
  actionId: GuidedActionId;
  chatId: string;
  status: TerminalRunStatus;
  error?: string;
  startedAt: number;
  finishedAt: number;
}

export interface ExtensionBootstrapView {
  settings: GuidedGenerationsSettings;
  connections: ConnectionOptionSummary[];
  presets: PresetOptionSummary[];
  recovery: RecoveryEntry[];
  activeRun: ActiveRunState | null;
  activeRuns?: ActiveRunState[];
  recentTerminalRuns?: TerminalRunSummary[];
  permissions: {
    generation: boolean;
    chats: boolean;
    chat_mutation: boolean;
    characters?: boolean;
    presets: boolean;
    regex_scripts: boolean;
    interceptor: boolean;
    push_notification?: boolean;
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
  | "clear_recovery"
  | "remove_last_continue"
  | "regenerate_last_continue";

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
  backgroundSwipe?: boolean;
}

export interface RegenerateContinueInput {
  chatId?: string | null;
  activeConnectionId?: string | null;
}

export interface RemoveContinueResult {
  removed: boolean;
  messageId: string;
  swipeIndex: number;
  text: string;
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

export interface NativeGenerationMetrics {
  ttft?: number;
  tps?: number;
  durationMs: number;
  wasStreaming: boolean;
  model?: string;
  provider?: string;
  presetId?: string;
  presetName?: string;
}

interface StandardBackendPushEvent<
  T extends
    | "gg:changed"
    | "gg:status"
    | "gg:impersonate-chunk"
    | "gg:recovery-updated",
> {
  type: T;
  reason?: string;
  run?: ActiveRunState | null;
  chatId?: string;
  text?: string;
  done?: boolean;
  aborted?: boolean;
  error?: string;
  recovery?: RecoveryEntry[];
  messageId?: string;
  swipeId?: number;
  tokenCount?: number | null;
  generationMetrics?: NativeGenerationMetrics | null;
}

export type BackendPushEvent =
  | StandardBackendPushEvent<"gg:changed">
  | StandardBackendPushEvent<"gg:status">
  | StandardBackendPushEvent<"gg:impersonate-chunk">
  | StandardBackendPushEvent<"gg:recovery-updated">
  | {
      type: "gg:generation_metrics";
      chatId: string;
      messageId: string;
      swipeId: number;
      tokenCount?: number | null;
      generationMetrics?: NativeGenerationMetrics | null;
      reason?: undefined;
      run?: undefined;
      text?: undefined;
      done?: undefined;
      aborted?: undefined;
      error?: undefined;
      recovery?: undefined;
    };

