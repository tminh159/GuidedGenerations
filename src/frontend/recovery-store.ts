import type { RecoveryEntry } from "../shared/types";

export function formatRecoverySnippet(text: string, maxLength = 68): string {
  const safeMax = Number.isFinite(maxLength) ? Math.max(4, Math.floor(maxLength)) : 60;
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= safeMax) return singleLine;
  return `${singleLine.slice(0, safeMax - 1)}…`;
}

export function pickRecoveryEntry(
  entries: readonly RecoveryEntry[],
  preferredId?: string,
): RecoveryEntry | null {
  if (entries.length === 0) return null;
  if (preferredId) {
    return entries.find((item) => item.id === preferredId) ?? entries[0] ?? null;
  }
  return entries[0] ?? null;
}

