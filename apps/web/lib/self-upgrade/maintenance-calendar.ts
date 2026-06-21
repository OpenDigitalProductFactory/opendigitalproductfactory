// apps/web/lib/self-upgrade/maintenance-calendar.ts
//
// The platform's own HEAVY recurring maintenance jobs, so the self-upgrade
// overnight window can avoid running its quiescence drain + recovery-point
// backup + portal rebuild on top of them (BI-963B9D47). Contention here is
// acute on budget / small-GPU local deployments.
//
// Only heavy batch/backup jobs are listed — the lightweight pollers
// (*/1, */5, */15 crons) run continuously and are not a contention source, so
// avoiding them is neither possible nor useful.
//
// Inngest crons fire in UTC (no tz arg), so this calendar is evaluated in UTC
// and the window scorer reconciles the store-local candidate windows against it
// on the absolute timeline. Pure + prisma-free (only Date UTC accessors + pure
// constant imports) so the cron path and unit tests can use it without a DB.

import { POSTGRES_BACKUP_CRON } from "@/lib/operate/backups/constants";
import { DATA_RETENTION_CRON } from "@/lib/operate/retention/constants";

export type HeavyMaintenanceWindow = {
  label: string;
  /** "M H * * D" — D is "*" or a comma-list of 0-6 (Sun=0). The only shapes used here. */
  cron: string;
  /** Approximate run length; sizes the busy interval [H:00, H:00 + durationMin). */
  durationMin: number;
};

/**
 * Heavy recurring platform maintenance, clustered at 03:00-04:00 UTC. Backup +
 * retention crons reuse their exported constants; the rest are inline literals
 * that MUST be kept in sync with their function files (cited per entry).
 */
export const HEAVY_MAINTENANCE: HeavyMaintenanceWindow[] = [
  { label: "postgres + all-services backups", cron: POSTGRES_BACKUP_CRON, durationMin: 60 },
  { label: "data-retention sweep", cron: DATA_RETENTION_CRON, durationMin: 60 },
  // keep in sync with apps/web/lib/queue/functions/model-discovery-refresh.ts
  { label: "model-discovery refresh", cron: "0 3 * * *", durationMin: 30 },
  // keep in sync with apps/web/lib/queue/functions/material-freshness-decay.ts
  { label: "material-freshness decay", cron: "0 3 * * *", durationMin: 30 },
  // keep in sync with apps/web/lib/queue/functions/infra-prune.ts (weekly, Sun)
  { label: "infra prune", cron: "0 3 * * 0", durationMin: 30 },
];

export type SimpleCron = { minute: number; hour: number; daysOfWeek: number[] | null };

/**
 * Parse the limited `"M H * * D"` cron shape this calendar uses (daily or
 * day-of-week). Returns null for anything outside that shape (intervals, ranges,
 * day-of-month, month constraints) rather than guessing.
 */
export function parseSimpleCron(cron: string): SimpleCron | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minRaw, hourRaw, dom, mon, dowRaw] = parts;
  const minute = Number(minRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (dom !== "*" || mon !== "*") return null; // only daily/weekly shapes
  let daysOfWeek: number[] | null = null;
  if (dowRaw !== "*") {
    const days = (dowRaw ?? "").split(",").map((d) => Number(d));
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
    daysOfWeek = days;
  }
  return { minute, hour, daysOfWeek };
}

/**
 * True when `date` (an absolute instant) falls inside a heavy maintenance
 * window, evaluated in UTC. A job at H:M for `durationMin` is busy during
 * [start, start + durationMin); a window spilling past midnight marks the early
 * minutes of the following UTC day busy too (day-of-week aware).
 */
export function isHeavyMaintenanceBusyAtUtc(
  date: Date,
  windows: HeavyMaintenanceWindow[] = HEAVY_MAINTENANCE,
): boolean {
  const utcDow = date.getUTCDay();
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  return windows.some((w) => {
    const c = parseSimpleCron(w.cron);
    if (!c) return false;
    const start = c.hour * 60 + c.minute;
    const end = start + w.durationMin;
    const matchesDay = c.daysOfWeek === null || c.daysOfWeek.includes(utcDow);
    if (matchesDay && minuteOfDay >= start && minuteOfDay < Math.min(end, 1440)) {
      return true;
    }
    // Window wrapping past midnight: its tail belongs to the next UTC day.
    if (end > 1440) {
      const prevDow = (utcDow + 6) % 7;
      const startedPrevDay = c.daysOfWeek === null || c.daysOfWeek.includes(prevDow);
      if (startedPrevDay && minuteOfDay < end - 1440) return true;
    }
    return false;
  });
}
