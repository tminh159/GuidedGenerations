import type { RecoveryEntry } from "../shared/types";

export function formatRecoverySnippet(text: string, maxLength = 68): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
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

