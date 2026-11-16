import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  createDefaultSettings,
  GUIDED_ACTION_ORDER,
  normalizeButtonOrder,
  normalizeGuidanceDepth,
  normalizeGuidancePosition,
  normalizeToolbarPlacement,
} from "../shared/defaults";
import type {
  ConnectionOptionSummary,
  ContinueHistoryEntry,
  GuidanceInjectionRole,
  GuidedActionConfig,
  GuidedActionId,
  GuidedGenerationsSettings,
  PresetOptionSummary,
  RecoveryEntry,
} from "../shared/types";

const SETTINGS_FILE = "settings.json";
const RECOVERY_FILE = "recovery.json";
const CONTINUE_HISTORY_FILE = "continue-history.json";
export const MAX_CONTINUE_ENTRIES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRole(value: unknown, fallback: GuidanceInjectionRole): GuidanceInjectionRole {
  return value === "system" || value === "user" || value === "assistant" ? value : fallback;
}

function normalizeOptionalId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeActionConfig(
  raw: unknown,
  fallback: GuidedActionConfig,
): GuidedActionConfig {
  const record = isRecord(raw) ? raw : {};
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    connectionId: normalizeOptionalId(record.connectionId),
    model: normalizeOptionalId(record.model),
    presetId: normalizeOptionalId(record.presetId),
    injectionRole: normalizeRole(record.injectionRole, fallback.injectionRole),
    guidancePosition: normalizeGuidancePosition(record.guidancePosition, fallback.guidancePosition),
    guidanceDepth: normalizeGuidanceDepth(record.guidanceDepth, fallback.guidanceDepth),
    instructionTemplate:
      typeof record.instructionTemplate === "string"
        ? record.instructionTemplate
        : fallback.instructionTemplate,
    clearInputOnRun:
      typeof record.clearInputOnRun === "boolean"
        ? record.clearInputOnRun
        : fallback.clearInputOnRun,
    applyRegex: typeof record.applyRegex === "boolean" ? record.applyRegex : fallback.applyRegex,
  };
}

/**
 * Merges untrusted/partial persisted settings onto defaults safely.
 */
export function normalizeSettings(raw: unknown): GuidedGenerationsSettings {
  const defaults = createDefaultSettings();
  const root = isRecord(raw) ? raw : {};
  const rawActions = isRecord(root.actions) ? root.actions : {};
  const rawRecovery = isRecord(root.inputRecovery) ? root.inputRecovery : {};

  const actions = { ...defaults.actions };
  for (const actionId of GUIDED_ACTION_ORDER) {
    actions[actionId] = normalizeActionConfig(rawActions[actionId], defaults.actions[actionId]);
  }

  const maxEntriesRaw =
    typeof rawRecovery.maxEntries === "number" && Number.isFinite(rawRecovery.maxEntries)
      ? rawRecovery.maxEntries
      : defaults.inputRecovery.maxEntries;
  const maxEntries = Math.max(1, Math.min(50, Math.floor(maxEntriesRaw)));

  return {
    version: 1,
    toolbarPlacement: normalizeToolbarPlacement(root.toolbarPlacement),
    buttonOrder: normalizeButtonOrder(root.buttonOrder),
    actions,
    inputRecovery: {
      enabled:
        typeof rawRecovery.enabled === "boolean"
          ? rawRecovery.enabled
          : defaults.inputRecovery.enabled,
      maxEntries,
    },
  };
}

export function normalizeRecoveryList(raw: unknown, maxEntries: number): RecoveryEntry[] {
  if (!Array.isArray(raw)) return [];
  const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 10;
  const validIds = new Set<GuidedActionId>(GUIDED_ACTION_ORDER);
  const result: RecoveryEntry[] = [];

  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    if (typeof item.id !== "string" || !item.id) continue;
    const actionId = validIds.has(item.actionId as GuidedActionId)
      ? (item.actionId as GuidedActionId)
      : "guided_response";
    result.push({
      id: item.id,
      text: item.text,
      actionId,
      chatId: typeof item.chatId === "string" && item.chatId ? item.chatId : null,
      createdAt:
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
          ? item.createdAt
          : Date.now(),
    });
    if (result.length >= limit) break;
  }

  return result;
}

export function appendRecoveryEntry(
  entries: readonly RecoveryEntry[],
  next: Omit<RecoveryEntry, "id" | "createdAt"> & { id?: string; createdAt?: number },
  maxEntries: number,
): RecoveryEntry[] {
  const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 10;
  const text = next.text;
  if (!text.trim()) return [...entries].slice(0, limit);

  // Avoid pushing identical duplicate text straight onto the top of the stack.
  if (entries[0]?.text === text) {
    return [...entries].slice(0, limit);
  }

  const trimmedChatId =
    typeof next.chatId === "string" && next.chatId.trim().length > 0
      ? next.chatId.trim()
      : null;

  const entry: RecoveryEntry = {
    id: next.id ?? `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    actionId: next.actionId,
    chatId: trimmedChatId,
    createdAt: next.createdAt ?? Date.now(),
  };

  return [entry, ...entries].slice(0, limit);
}

export type ContinueHistoryInput = Omit<ContinueHistoryEntry, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

function createContinueEntry(input: ContinueHistoryInput): ContinueHistoryEntry {
  const safeSwipeIndex =
    typeof input.swipeIndex === "number" && Number.isFinite(input.swipeIndex)
      ? Math.max(0, Math.floor(input.swipeIndex))
      : 0;
  return {
    id: input.id ?? `cont-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    chatId: input.chatId,
    messageId: input.messageId,
    swipeIndex: safeSwipeIndex,
    baseText: input.baseText,
    resultText: input.resultText,
    baseReasoning: typeof input.baseReasoning === "string" ? input.baseReasoning : null,
    baseReasoningDuration:
      typeof input.baseReasoningDuration === "number" &&
      Number.isFinite(input.baseReasoningDuration) &&
      input.baseReasoningDuration >= 0
        ? input.baseReasoningDuration
        : null,
    inputText: input.inputText,
    createdAt:
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? input.createdAt
        : Date.now(),
  };
}

export function normalizeContinueHistoryList(
  raw: unknown,
  maxEntries: number = MAX_CONTINUE_ENTRIES,
): ContinueHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const limit = Number.isFinite(maxEntries)
    ? Math.max(1, Math.floor(maxEntries))
    : MAX_CONTINUE_ENTRIES;
  const result: ContinueHistoryEntry[] = [];

  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || !item.id) continue;
    if (typeof item.chatId !== "string" || !item.chatId) continue;
    if (typeof item.messageId !== "string" || !item.messageId) continue;
    if (
      typeof item.swipeIndex !== "number" ||
      !Number.isInteger(item.swipeIndex) ||
      item.swipeIndex < 0
    ) {
      continue;
    }
    if (typeof item.baseText !== "string") continue;
    if (typeof item.resultText !== "string") continue;

    result.push({
      id: item.id,
      chatId: item.chatId,
      messageId: item.messageId,
      swipeIndex: item.swipeIndex,
      baseText: item.baseText,
      resultText: item.resultText,
      baseReasoning: typeof item.baseReasoning === "string" ? item.baseReasoning : null,
      baseReasoningDuration:
        typeof item.baseReasoningDuration === "number" &&
        Number.isFinite(item.baseReasoningDuration) &&
        item.baseReasoningDuration >= 0
          ? item.baseReasoningDuration
          : null,
      inputText: typeof item.inputText === "string" ? item.inputText : "",
      createdAt:
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
          ? item.createdAt
          : Date.now(),
    });
    if (result.length >= limit) break;
  }

  return result;
}

export class SettingsStore {
  private readonly settingsCache = new Map<string, GuidedGenerationsSettings>();
  private readonly recoveryCache = new Map<string, RecoveryEntry[]>();
  private readonly continueHistoryCache = new Map<string, ContinueHistoryEntry[]>();
  private readonly settingsVersions = new Map<string, number>();
  private readonly recoveryVersions = new Map<string, number>();
  private readonly continueVersions = new Map<string, number>();
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly spindle: SpindleAPI) {}

  private bumpVersion(versions: Map<string, number>, key: string): void {
    versions.set(key, (versions.get(key) ?? 0) + 1);
  }

  private userKey(userId?: string): string {
    return userId && userId.length > 0 ? userId : "__default__";
  }

  private cloneSettings(settings: GuidedGenerationsSettings): GuidedGenerationsSettings {
    const actions = { ...settings.actions };
    for (const actionId of GUIDED_ACTION_ORDER) {
      actions[actionId] = { ...settings.actions[actionId] };
    }
    return {
      ...settings,
      buttonOrder: [...settings.buttonOrder],
      actions,
      inputRecovery: { ...settings.inputRecovery },
    };
  }

  private enqueueUserWrite<T>(userId: string | undefined, task: () => Promise<T>): Promise<T> {
    const key = this.userKey(userId);
    const prev = this.writeQueues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    this.writeQueues.set(key, tail);
    void tail.finally(() => {
      if (this.writeQueues.get(key) === tail) {
        this.writeQueues.delete(key);
      }
    });
    return next;
  }

  private async waitForPendingWrites(key: string): Promise<void> {
    let pending = this.writeQueues.get(key);
    while (pending) {
      await pending.catch(() => undefined);
      const nextPending = this.writeQueues.get(key);
      if (nextPending === pending) break;
      pending = nextPending;
    }
  }

  async getSettings(userId?: string): Promise<GuidedGenerationsSettings> {
    return this.getSettingsUnlocked(userId, false);
  }

  private async getSettingsUnlocked(
    userId: string | undefined,
    skipWriteWait = false,
  ): Promise<GuidedGenerationsSettings> {
    const key = this.userKey(userId);
    const cached = this.settingsCache.get(key);
    if (cached) return this.cloneSettings(cached);

    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.settingsCache.get(key);
      if (rechecked) return this.cloneSettings(rechecked);
    }

    const versionBeforeRead = this.settingsVersions.get(key) ?? 0;
    let resolved: GuidedGenerationsSettings;

    try {
      if (await this.spindle.userStorage.exists(SETTINGS_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(SETTINGS_FILE, userId);
        resolved = normalizeSettings(JSON.parse(raw));
      } else {
        resolved = createDefaultSettings();
      }
    } catch (error) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed reading settings, using defaults: ${error instanceof Error ? error.message : String(error)}`,
      );
      return createDefaultSettings();
    }

    if (!skipWriteWait && this.writeQueues.has(key)) {
      await this.waitForPendingWrites(key);
    }
    const concurrentCached = this.settingsCache.get(key);
    if (concurrentCached) {
      return this.cloneSettings(concurrentCached);
    }
    if ((this.settingsVersions.get(key) ?? 0) === versionBeforeRead) {
      this.settingsCache.set(key, resolved);
    }
    return this.cloneSettings(resolved);
  }

  async saveSettingsWithMeta(
    next: unknown,
    userId?: string,
  ): Promise<{
    settings: GuidedGenerationsSettings;
    recoveryPruned: boolean;
    recovery: RecoveryEntry[];
  }> {
    return this.enqueueUserWrite(userId, async () => {
      const key = this.userKey(userId);
      const normalized = normalizeSettings(next);
      await this.spindle.userStorage.write(
        SETTINGS_FILE,
        JSON.stringify(normalized, null, 2),
        userId,
      );
      this.settingsCache.set(key, normalized);
      this.bumpVersion(this.settingsVersions, key);

      const currentRecovery = await this.readRawRecoveryUnlocked(userId, true);
      const recoveryPruned = currentRecovery.length > normalized.inputRecovery.maxEntries;
      const trimmed = currentRecovery.slice(0, normalized.inputRecovery.maxEntries);
      if (recoveryPruned) {
        await this.writeRecoveryUnlocked(trimmed, userId);
      }
      return {
        settings: this.cloneSettings(normalized),
        recoveryPruned,
        recovery: trimmed.map((e) => ({ ...e })),
      };
    });
  }

  async saveSettings(next: unknown, userId?: string): Promise<GuidedGenerationsSettings> {
    const { settings } = await this.saveSettingsWithMeta(next, userId);
    return settings;
  }

  async getRecovery(userId?: string): Promise<RecoveryEntry[]> {
    const settings = await this.getSettings(userId);
    return this.readRecoveryUnlocked(userId, settings.inputRecovery.maxEntries, false);
  }

  async pushRecovery(
    input: Omit<RecoveryEntry, "id" | "createdAt">,
    userId?: string,
  ): Promise<RecoveryEntry[]> {
    return this.enqueueUserWrite(userId, async () => {
      const settings = await this.getSettingsUnlocked(userId, true);
      const current = await this.readRecoveryUnlocked(
        userId,
        settings.inputRecovery.maxEntries,
        true,
      );
      if (!settings.inputRecovery.enabled) {
        return current;
      }
      const updated = appendRecoveryEntry(current, input, settings.inputRecovery.maxEntries);
      await this.writeRecoveryUnlocked(updated, userId);
      return updated.map((e) => ({ ...e }));
    });
  }

  async clearRecovery(userId?: string): Promise<RecoveryEntry[]> {
    return this.enqueueUserWrite(userId, async () => {
      await this.writeRecoveryUnlocked([], userId);
      return [];
    });
  }

  private async readRawRecoveryUnlocked(
    userId: string | undefined,
    skipWriteWait = false,
  ): Promise<RecoveryEntry[]> {
    const key = this.userKey(userId);
    const cached = this.recoveryCache.get(key);
    if (cached) return cached.map((e) => ({ ...e }));

    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.recoveryCache.get(key);
      if (rechecked) return rechecked.map((e) => ({ ...e }));
    }

    const versionBeforeRead = this.recoveryVersions.get(key) ?? 0;
    let parsed: RecoveryEntry[];

    try {
      if (await this.spindle.userStorage.exists(RECOVERY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(RECOVERY_FILE, userId);
        parsed = normalizeRecoveryList(JSON.parse(raw), 50);
      } else {
        parsed = [];
      }
    } catch (error) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed reading recovery history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    if (!skipWriteWait && this.writeQueues.has(key)) {
      await this.waitForPendingWrites(key);
    }
    const concurrentCached = this.recoveryCache.get(key);
    if (concurrentCached) {
      return concurrentCached.map((e) => ({ ...e }));
    }
    if ((this.recoveryVersions.get(key) ?? 0) === versionBeforeRead) {
      this.recoveryCache.set(
        key,
        parsed.map((e) => ({ ...e })),
      );
    }
    return parsed.map((e) => ({ ...e }));
  }

  private async readRecoveryUnlocked(
    userId: string | undefined,
    maxEntries: number,
    skipWriteWait = false,
  ): Promise<RecoveryEntry[]> {
    const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 10;
    const all = await this.readRawRecoveryUnlocked(userId, skipWriteWait);
    return all.slice(0, limit);
  }

  private async writeRecoveryUnlocked(
    entries: RecoveryEntry[],
    userId?: string,
  ): Promise<void> {
    const key = this.userKey(userId);
    await this.spindle.userStorage.write(
      RECOVERY_FILE,
      JSON.stringify(entries, null, 2),
      userId,
    );
    this.recoveryCache.set(
      key,
      entries.map((e) => ({ ...e })),
    );
    this.bumpVersion(this.recoveryVersions, key);
  }

  async getContinueHistory(userId?: string): Promise<ContinueHistoryEntry[]> {
    const entries = await this.readContinueHistoryUnlocked(userId, false);
    return entries.map((entry) => ({ ...entry }));
  }

  async pushContinueEntry(
    input: ContinueHistoryInput,
    userId?: string,
  ): Promise<ContinueHistoryEntry> {
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      const entry = createContinueEntry(input);
      const updated = [entry, ...current].slice(0, MAX_CONTINUE_ENTRIES);
      await this.writeContinueHistoryUnlocked(updated, userId);
      return { ...entry };
    });
  }

  async peekContinueEntry(
    chatId: string,
    messageId: string,
    swipeIndex: number,
    userId?: string,
  ): Promise<ContinueHistoryEntry | null> {
    const current = await this.readContinueHistoryUnlocked(userId, false);
    const match = current.find(
      (entry) =>
        entry.chatId === chatId &&
        entry.messageId === messageId &&
        entry.swipeIndex === swipeIndex,
    );
    return match ? { ...match } : null;
  }

  async popContinueEntry(
    chatId: string,
    messageId: string,
    swipeIndex: number,
    expectedId?: string,
    userId?: string,
  ): Promise<ContinueHistoryEntry | null> {
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      const idx = current.findIndex(
        (entry) =>
          entry.chatId === chatId &&
          entry.messageId === messageId &&
          entry.swipeIndex === swipeIndex,
      );
      if (idx < 0) return null;
      const target = current[idx]!;
      if (expectedId !== undefined && target.id !== expectedId) {
        return null;
      }
      const updated = [...current.slice(0, idx), ...current.slice(idx + 1)];
      await this.writeContinueHistoryUnlocked(updated, userId);
      return { ...target };
    });
  }

  async replaceTopContinueEntry(
    chatId: string,
    messageId: string,
    swipeIndex: number,
    expectedId: string | undefined,
    nextEntry: ContinueHistoryInput,
    userId?: string,
  ): Promise<ContinueHistoryEntry> {
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      const created = createContinueEntry(nextEntry);
      const idx = current.findIndex(
        (entry) =>
          entry.chatId === chatId &&
          entry.messageId === messageId &&
          entry.swipeIndex === swipeIndex,
      );
      const shouldReplace =
        idx >= 0 && (expectedId === undefined || current[idx]!.id === expectedId);
      const withoutOld = shouldReplace
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : current;
      const updated = [created, ...withoutOld].slice(0, MAX_CONTINUE_ENTRIES);
      await this.writeContinueHistoryUnlocked(updated, userId);
      return { ...created };
    });
  }

  async rebindContinueHistoryMessageId(
    chatId: string,
    oldMessageId: string,
    newMessageId: string,
    userId?: string,
  ): Promise<void> {
    if (!chatId || !oldMessageId || !newMessageId || oldMessageId === newMessageId) {
      return;
    }
    return this.enqueueUserWrite(userId, async () => {
      const current = await this.readContinueHistoryUnlocked(userId, true);
      let changed = false;
      const updated = current.map((entry) => {
        if (entry.chatId === chatId && entry.messageId === oldMessageId) {
          changed = true;
          return { ...entry, messageId: newMessageId };
        }
        return entry;
      });
      if (changed) {
        await this.writeContinueHistoryUnlocked(updated, userId);
      }
    });
  }

  private async readContinueHistoryUnlocked(
    userId: string | undefined,
    skipWriteWait = false,
  ): Promise<ContinueHistoryEntry[]> {
    const key = this.userKey(userId);
    const cached = this.continueHistoryCache.get(key);
    if (cached) return cached.map((entry) => ({ ...entry }));

    if (!skipWriteWait) {
      await this.waitForPendingWrites(key);
      const rechecked = this.continueHistoryCache.get(key);
      if (rechecked) return rechecked.map((entry) => ({ ...entry }));
    }

    const versionBeforeRead = this.continueVersions.get(key) ?? 0;
    let parsed: ContinueHistoryEntry[];

    try {
      if (await this.spindle.userStorage.exists(CONTINUE_HISTORY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(CONTINUE_HISTORY_FILE, userId);
        parsed = normalizeContinueHistoryList(JSON.parse(raw), MAX_CONTINUE_ENTRIES);
      } else {
        parsed = [];
      }
    } catch (error) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed reading continue history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    if (!skipWriteWait && this.writeQueues.has(key)) {
      await this.waitForPendingWrites(key);
    }
    const concurrentCached = this.continueHistoryCache.get(key);
    if (concurrentCached) {
      return concurrentCached.map((entry) => ({ ...entry }));
    }
    if ((this.continueVersions.get(key) ?? 0) === versionBeforeRead) {
      this.continueHistoryCache.set(
        key,
        parsed.map((entry) => ({ ...entry })),
      );
    }
    return parsed.map((entry) => ({ ...entry }));
  }

  private async writeContinueHistoryUnlocked(
    entries: ContinueHistoryEntry[],
    userId?: string,
  ): Promise<void> {
    const key = this.userKey(userId);
    await this.spindle.userStorage.write(
      CONTINUE_HISTORY_FILE,
      JSON.stringify(entries, null, 2),
      userId,
    );
    this.continueHistoryCache.set(
      key,
      entries.map((entry) => ({ ...entry })),
    );
    this.bumpVersion(this.continueVersions, key);
  }

  async listConnections(userId?: string): Promise<ConnectionOptionSummary[]> {
    const { items } = await this.fetchConnections(userId);
    return items;
  }

  async listPresets(userId?: string): Promise<PresetOptionSummary[]> {
    const { items } = await this.fetchPresets(userId);
    return items;
  }

  async loadCatalogs(userId?: string): Promise<{
    connections: ConnectionOptionSummary[];
    presets: PresetOptionSummary[];
    warnings: string[];
  }> {
    const [connRes, presetRes] = await Promise.all([
      this.fetchConnections(userId),
      this.fetchPresets(userId),
    ]);
    const warnings = [connRes.warning, presetRes.warning].filter(
      (w): w is string => Boolean(w),
    );
    return {
      connections: connRes.items,
      presets: presetRes.items,
      warnings,
    };
  }

  private async fetchCatalog<T>(
    permission: "generation" | "presets",
    label: string,
    loader: () => Promise<T[]>,
  ): Promise<{ items: T[]; warning?: string }> {
    if (!this.spindle.permissions.has(permission)) return { items: [] };
    try {
      return { items: await loader() };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.spindle.log.warn(`[GuidedGenerations] Unable to list ${label}: ${detail}`);
      return { items: [], warning: `Unable to load ${label}: ${detail}` };
    }
  }

  private fetchConnections(userId?: string) {
    return this.fetchCatalog("generation", "connection profiles", async () => {
      const items = await this.spindle.connections.list(userId);
      return items.map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        model: c.model,
        isDefault: Boolean(c.is_default),
      }));
    });
  }

  private fetchPresets(userId?: string) {
    return this.fetchCatalog("presets", "presets", async () => {
      const res = await this.spindle.presets.list({ limit: 200, userId });
      return res.data.map((p) => ({
        id: p.id,
        name: p.name,
      }));
    });
  }
}

