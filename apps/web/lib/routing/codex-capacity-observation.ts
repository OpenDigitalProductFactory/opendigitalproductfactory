import { isRecord } from "@/lib/shared/coerce";

/** A current account-wide read is stronger than a historical CLI reset forecast. */
export function codexCapacityAvailable(value: unknown, accountId: string): boolean {
  if (!isRecord(value) || value.accountId !== accountId || !isRecord(value.rateLimits)) return false;
  const snapshots: unknown[] = [value.rateLimits];
  if (value.rateLimitsByLimitId != null) {
    if (!isRecord(value.rateLimitsByLimitId)) return false;
    snapshots.push(...Object.values(value.rateLimitsByLimitId));
  }
  return snapshots.every(snapshot => {
    if (!isRecord(snapshot)) return false;
    // Require both windows: absence is unknown, never available.
    return [snapshot.primary, snapshot.secondary].every(window => isRecord(window)
      && typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)
      && window.usedPercent >= 0 && window.usedPercent < 100);
  });
}
