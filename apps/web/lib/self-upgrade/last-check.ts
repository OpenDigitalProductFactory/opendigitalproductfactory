// apps/web/lib/self-upgrade/last-check.ts
//
// Makes checkIntervalHours REAL. The scheduled cron fires hourly, but an
// operator who sets "check every 24h" expects it to actually poll daily — not
// hourly. We persist the last time a check actually ran and skip scheduled
// ticks until checkIntervalHours has elapsed. Manual/forced runs are not
// throttled (the operator is asking now) and they are recorded here too, since
// a check just happened. Previously checkIntervalHours was displayed but
// governed nothing — a never-fabricate violation this closes.
//
// BI-EF1AC111: the interval is anchored to the maintenance window. A window
// opening that has not had a check yet forgives up to a day of the interval
// (interval-anchor.ts), so a daytime manual run or last night's 23:02 run no
// longer pushes tonight's check out of the window.

import { prisma } from "@dpf/db";

import { isScheduledCheckDue } from "@/lib/self-upgrade/interval-anchor";

const LAST_CHECK_CONFIG_KEY = "self_upgrade.lastCheckedAt";

/**
 * True when a scheduled check is due: never checked before, or the interval
 * has elapsed. `windowOpenedAt` is the start of the window opening the check
 * would run in; a check made before it does not use that opening up
 * (BI-EF1AC111). Pure + deterministic.
 */
export function isCheckIntervalElapsed(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
  windowOpenedAt: Date | null = null,
): boolean {
  return isScheduledCheckDue(lastCheckedAt, intervalHours, now, windowOpenedAt);
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
