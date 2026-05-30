// apps/web/lib/self-upgrade/last-check.ts
//
// Makes checkIntervalHours REAL. The scheduled cron fires hourly, but an
// operator who sets "check every 24h" expects it to actually poll daily — not
// hourly. We persist the last time a check actually ran and skip scheduled
// ticks until checkIntervalHours has elapsed. Manual/forced runs are not
// throttled (the operator is asking now) but they DO reset the clock, since a
// check just happened. Previously checkIntervalHours was displayed but governed
// nothing — a never-fabricate violation this closes.

import { prisma } from "@dpf/db";

const LAST_CHECK_CONFIG_KEY = "self_upgrade.lastCheckedAt";

/**
 * True when a scheduled check is due: never checked before, or at least
 * `intervalHours` have elapsed since the last check. Pure + deterministic.
 */
export function isCheckIntervalElapsed(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
): boolean {
  if (!lastCheckedAt) return true;
  if (!(intervalHours > 0)) return true; // non-positive interval = no throttle
  const elapsedMs = now.getTime() - lastCheckedAt.getTime();
  return elapsedMs >= intervalHours * 60 * 60 * 1000;
}

/** Last time a check actually ran, or null if never recorded. */
export async function getLastCheckedAt(): Promise<Date | null> {
  const row = await prisma.platformConfig.findUnique({ where: { key: LAST_CHECK_CONFIG_KEY } });
  const at = (row?.value as { at?: string } | null)?.at;
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Record that a check ran at `now` (resets the interval clock). */
export async function recordCheckedAt(now: Date): Promise<void> {
  const value = { at: now.toISOString() };
  await prisma.platformConfig.upsert({
    where: { key: LAST_CHECK_CONFIG_KEY },
    update: { value },
    create: { key: LAST_CHECK_CONFIG_KEY, value },
  });
}
