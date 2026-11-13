import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  createDefaultSettings,
  GUIDED_ACTION_ORDER,
  normalizeButtonOrder,
  normalizeToolbarPlacement,
} from "../shared/defaults";
import type {
  ConnectionOptionSummary,
  GuidanceInjectionRole,
  GuidedActionConfig,
  GuidedActionId,
  GuidedGenerationsSettings,
  PresetOptionSummary,
  RecoveryEntry,
} from "../shared/types";

const SETTINGS_FILE = "settings.json";
const RECOVERY_FILE = "recovery.json";

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
    instructionTemplate:
      typeof record.instructionTemplate === "string"
        ? record.instructionTemplate
        : fallback.instructionTemplate,
    clearInputOnRun:
      typeof record.clearInputOnRun === "boolean"
        ? record.clearInputOnRun
        : fallback.clearInputOnRun,
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

  const entry: RecoveryEntry = {
    id: next.id ?? `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    actionId: next.actionId,
    chatId: next.chatId ?? null,
    createdAt: next.createdAt ?? Date.now(),
  };

  return [entry, ...entries].slice(0, limit);
}

export class SettingsStore {
  private readonly settingsCache = new Map<string, GuidedGenerationsSettings>();
  private readonly recoveryCache = new Map<string, RecoveryEntry[]>();
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly spindle: SpindleAPI) {}

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

  async getSettings(userId?: string): Promise<GuidedGenerationsSettings> {
    const key = this.userKey(userId);
    const cached = this.settingsCache.get(key);
    if (cached) return this.cloneSettings(cached);

    try {
      if (await this.spindle.userStorage.exists(SETTINGS_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(SETTINGS_FILE, userId);
        const parsed = normalizeSettings(JSON.parse(raw));
        this.settingsCache.set(key, parsed);
        return this.cloneSettings(parsed);
      }
    } catch (error) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed reading settings, using defaults: ${error instanceof Error ? error.message : String(error)}`,
      );
      return createDefaultSettings();
    }

    const defaults = createDefaultSettings();
    this.settingsCache.set(key, defaults);
    return this.cloneSettings(defaults);
  }

  async saveSettings(next: unknown, userId?: string): Promise<GuidedGenerationsSettings> {
    return this.enqueueUserWrite(userId, async () => {
      const key = this.userKey(userId);
      const normalized = normalizeSettings(next);
      await this.spindle.userStorage.write(
        SETTINGS_FILE,
        JSON.stringify(normalized, null, 2),
        userId,
      );
      this.settingsCache.set(key, normalized);

      const currentRecovery = await this.readRecoveryUnlocked(
        userId,
        normalized.inputRecovery.maxEntries,
      );
      if (currentRecovery.length > normalized.inputRecovery.maxEntries) {
        await this.writeRecoveryUnlocked(
          currentRecovery.slice(0, normalized.inputRecovery.maxEntries),
          userId,
        );
      }
      return this.cloneSettings(normalized);
    });
  }

  async getRecovery(userId?: string): Promise<RecoveryEntry[]> {
    const settings = await this.getSettings(userId);
    return this.readRecoveryUnlocked(userId, settings.inputRecovery.maxEntries);
  }

  async pushRecovery(
    input: Omit<RecoveryEntry, "id" | "createdAt">,
    userId?: string,
  ): Promise<RecoveryEntry[]> {
    return this.enqueueUserWrite(userId, async () => {
      const settings = await this.getSettings(userId);
      const current = await this.readRecoveryUnlocked(
        userId,
        settings.inputRecovery.maxEntries,
      );
      if (!settings.inputRecovery.enabled) {
        return current;
      }
      const updated = appendRecoveryEntry(current, input, settings.inputRecovery.maxEntries);
      await this.writeRecoveryUnlocked(updated, userId);
      return [...updated];
    });
  }

  async clearRecovery(userId?: string): Promise<RecoveryEntry[]> {
    return this.enqueueUserWrite(userId, async () => {
      await this.writeRecoveryUnlocked([], userId);
      return [];
    });
  }

  private async readRecoveryUnlocked(
    userId: string | undefined,
    maxEntries: number,
  ): Promise<RecoveryEntry[]> {
    const key = this.userKey(userId);
    const cached = this.recoveryCache.get(key);
    if (cached) return [...cached.slice(0, maxEntries)];

    try {
      if (await this.spindle.userStorage.exists(RECOVERY_FILE, userId)) {
        const raw = await this.spindle.userStorage.read(RECOVERY_FILE, userId);
        const parsed = normalizeRecoveryList(JSON.parse(raw), maxEntries);
        this.recoveryCache.set(key, parsed);
        return [...parsed];
      }
    } catch (error) {
      this.spindle.log.warn(
        `[GuidedGenerations] Failed reading recovery history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    this.recoveryCache.set(key, []);
    return [];
  }

  private async writeRecoveryUnlocked(
    entries: RecoveryEntry[],
    userId?: string,
  ): Promise<void> {
    await this.spindle.userStorage.write(
      RECOVERY_FILE,
      JSON.stringify(entries, null, 2),
      userId,
    );
    this.recoveryCache.set(this.userKey(userId), [...entries]);
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

