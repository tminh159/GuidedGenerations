export type GuidedActionId =
  | "guided_response"
  | "guided_continue"
  | "guided_regenerate"
  | "guided_swipe"
  | "guided_impersonate";

export type RunActionId = GuidedActionId | "guided_scene";

export type ToolbarOptionId = GuidedActionId | "guided_scene" | "input_recovery";

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

export type SceneGuidancePosition = GuidancePosition | "append_last_user";

export type GuidedScenePacing = "drop_now" | "next_turn" | "multi_turn";

export type GuidedSceneArmedPacing = "next_turn" | "multi_turn";

export type GuidedSceneDelivery = "cut" | "time_skip" | "bridge";

export type GuidedSceneAdjustmentMode =
  | "verbatim"
  | "context_adapt"
  | "summary_rewrite";

export type GuidedSceneDropTarget = "new_message" | "new_swipe";

export type GuidedSceneContextMode = "lightweight" | "full_preset";

export type GuidedSceneGreetingSource = "card" | "custom";

export type ArmedSceneStatus = "armed" | "paused";

export interface GuidedSceneConfig {
  enabled: boolean;
  connectionId: string | null;
  model: string | null;
  presetId: string | null;
  contextMode: GuidedSceneContextMode;
  contextTurns: number;
  injectionRole: GuidanceInjectionRole;
  guidancePosition: SceneGuidancePosition;
  guidanceDepth: number;
  keepMediaIntact: boolean;
  applyRegex: boolean;
  pacing: GuidedScenePacing;
  delivery: GuidedSceneDelivery;
  adjustmentMode: GuidedSceneAdjustmentMode;
  dropTarget: GuidedSceneDropTarget;
  steeringTemplate: string;
  adaptTemplate: string;
  summaryTemplate: string;
  bridgeTemplate: string;
  readinessTag: string;
}

export interface GuidedSceneGreetingOption {
  /** Stable identifier for this greeting (e.g. `${characterId}:${greetingIndex}`). */
  key: string;
  /** Alias for `key`. */
  id: string;
  characterId: string;
  characterName: string;
  /** 0 for `first_mes`, 1..N for `alternate_greetings`. */
  greetingIndex: number;
  /** Human-friendly label such as `#1 Opening Greeting` or `#2 Alternate Greeting`. */
  label: string;
  text: string;
  preview: string;
  isOpening?: boolean;
  hasMedia?: boolean;
}

export interface GuidedSceneMember {
  id: string;
  name: string;
}

export interface ArmedSceneState {
  chatId: string;
  userId?: string;
  status: ArmedSceneStatus;
  pacing: GuidedSceneArmedPacing;
  delivery: GuidedSceneDelivery;
  adjustmentMode: GuidedSceneAdjustmentMode;
  greetingSource: GuidedSceneGreetingSource;
  selectedGreetingKey?: string | null;
  greetingLabel: string;
  rawGreetingText: string;
  speakerCharacterId?: string | null;
  speakerCharacterName?: string | null;
  transitionNote: string;
  customDirection: string;
  keepMediaIntact?: boolean;
  lockedDraftText: string | null;
  draftLocked: boolean;
  armedAt: number;
  turnsSteered?: number;
  lastDropMessageId?: string;
}

export interface GuidedSceneChatContext {
  chatId: string;
  isGroup: boolean;
  primaryCharacterId: string | null;
  primaryCharacterName?: string | null;
  members: GuidedSceneMember[];
  greetings: GuidedSceneGreetingOption[];
  armedScene: ArmedSceneState | null;
  canSwipeLastAssistant?: boolean;
}

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
  guidedScene: GuidedSceneConfig;
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
  actionId: RunActionId;
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
  actionId: RunActionId;
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
  armedScene?: ArmedSceneState | null;
  armedScenes?: ArmedSceneState[];
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
  | "regenerate_last_continue"
  | "get_scene_context"
  | "preview_scene_draft"
  | "drop_scene_now"
  | "arm_scene"
  | "update_armed_scene"
  | "pause_scene"
  | "resume_scene"
  | "drop_next_turn"
  | "cancel_scene"
  | "close_drawer";

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

export interface GetSceneContextInput {
  chatId?: string | null;
}

export interface GuidedSceneDraftBaseInput {
  chatId?: string | null;
  activeConnectionId?: string | null;
  delivery: GuidedSceneDelivery;
  adjustmentMode: GuidedSceneAdjustmentMode;
  greetingSource: GuidedSceneGreetingSource;
  selectedGreetingKey?: string | null;
  greetingLabel?: string;
  rawGreetingText: string;
  speakerCharacterId?: string | null;
  speakerCharacterName?: string | null;
  transitionNote?: string;
  customDirection?: string;
  keepMediaIntact?: boolean;
}

export type PreviewSceneDraftInput = GuidedSceneDraftBaseInput;

export interface PreviewSceneDraftResult {
  text: string;
  chatId?: string;
  aborted?: boolean;
}

export interface DropSceneNowInput extends GuidedSceneDraftBaseInput {
  dropTarget?: GuidedSceneDropTarget;
  lockedDraftText?: string | null;
  previewText?: string | null;
  draftLocked?: boolean;
}

export interface DropSceneNowResult {
  runId?: string;
  actionId: "guided_scene";
  chatId: string;
  aborted: boolean;
  messageId?: string;
  swipeId?: number;
  text: string;
  dropTarget: GuidedSceneDropTarget;
}

export interface ArmSceneInput extends GuidedSceneDraftBaseInput {
  pacing: GuidedSceneArmedPacing;
  lockedDraftText?: string | null;
  previewText?: string | null;
  draftLocked?: boolean;
}

export interface UpdateArmedSceneInput {
  chatId?: string | null;
  pacing?: GuidedSceneArmedPacing;
  delivery?: GuidedSceneDelivery;
  adjustmentMode?: GuidedSceneAdjustmentMode;
  greetingSource?: GuidedSceneGreetingSource;
  selectedGreetingKey?: string | null;
  greetingLabel?: string;
  rawGreetingText?: string;
  speakerCharacterId?: string | null;
  speakerCharacterName?: string | null;
  transitionNote?: string;
  customDirection?: string;
  keepMediaIntact?: boolean;
  lockedDraftText?: string | null;
  previewText?: string | null;
  draftLocked?: boolean;
}

export interface SceneChatActionInput {
  chatId?: string | null;
}

export interface CloseDrawerResult {
  closed: boolean;
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

export interface SceneUpdatedPushEvent {
  type: "gg:scene-updated";
  chatId?: string;
  armedScene?: ArmedSceneState | null;
  armedScenes?: ArmedSceneState[];
  reason?: string;
  run?: undefined;
  text?: undefined;
  done?: undefined;
  aborted?: undefined;
  error?: undefined;
  recovery?: undefined;
  messageId?: undefined;
  swipeId?: undefined;
  tokenCount?: undefined;
  generationMetrics?: undefined;
}

export type BackendPushEvent =
  | StandardBackendPushEvent<"gg:changed">
  | StandardBackendPushEvent<"gg:status">
  | StandardBackendPushEvent<"gg:impersonate-chunk">
  | StandardBackendPushEvent<"gg:recovery-updated">
  | SceneUpdatedPushEvent
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

