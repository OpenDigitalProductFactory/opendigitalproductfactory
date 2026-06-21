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

import { getCatalogEntry } from "@/lib/operate/scheduled-jobs/catalog";
import { ALL_BACKUPS_CRON, POSTGRES_BACKUP_CRON } from "@/lib/operate/backups/constants";
import { DATA_RETENTION_CRON } from "@/lib/operate/retention/constants";

export type HeavyMaintenanceWindow = {
  label: string;
  /** "M H * * D" — D is "*" or a comma-list of 0-6 (Sun=0). The only shapes used here. */
  cron: string;
  /** Approximate run length; sizes the busy interval [H:00, H:00 + durationMin). */
  durationMin: number;
};

/**
 * Which catalog jobs are HEAVY enough that a self-upgrade rebuild should avoid
 * running on top of them, keyed by SCHEDULED_JOB_CATALOG jobId. The cron/time is
 * resolved FROM the catalog (single source of truth — operate/scheduled-jobs/catalog.ts,
 * which carries a build-failing catalog<->registry parity guard and backs the
 * /admin/scheduled-jobs surface); only the "is this heavy" judgement + an
 * approximate duration live here, because the catalog carries neither (its
 * `category` is operator-tunability, not resource weight — taskrun-watchdog is
 * `core` yet a 1-minute poller). This is a deliberately CONSERVATIVE set:
 * backups + retention + the 03:00 batch jobs that actually contend with a portal
 * rebuild. Lighter jobs (wiki-lint, skill-metrics/curator) are excluded — adding
 * them would broaden the busy band enough to push even a deep-sleep slot off a
 * clear window for no real contention benefit.
 *
 * `cronOverride` pins the precise UTC cron for entries whose catalog `cron` is a
 * display cadence word ("daily" for the backups) and for the jobs that own a
 * runtime cron CONSTANT (the constant is the true runtime source; the catalog
 * string is hand-maintained for display). Entries with no override use the
 * catalog's own cron.
 */
type HeavyJobSpec = { jobId: string; durationMin: number; cronOverride?: string };

const HEAVY_JOB_SPECS: HeavyJobSpec[] = [
  { jobId: "postgres-daily-backup", durationMin: 60, cronOverride: POSTGRES_BACKUP_CRON },
  { jobId: "all-backups-daily", durationMin: 60, cronOverride: ALL_BACKUPS_CRON },
  { jobId: "data-retention-sweep", durationMin: 60, cronOverride: DATA_RETENTION_CRON },
  { jobId: "model-discovery-refresh", durationMin: 30 }, // catalog cron "0 3 * * *"
  { jobId: "material-freshness-decay", durationMin: 30 }, // catalog cron "0 3 * * *"
  { jobId: "infra-prune", durationMin: 30 }, // catalog cron "0 3 * * 0" (weekly, Sun)
];

/** The heavy-job ids this calendar tracks — exposed for the drift guard test. */
export const HEAVY_JOB_IDS: readonly string[] = HEAVY_JOB_SPECS.map((s) => s.jobId);

/**
 * Resolve the heavy maintenance windows from the catalog at module load. A spec
 * whose jobId is absent from the catalog, or whose resolved cron is unparseable,
 * is dropped — the drift guard (maintenance-calendar.test.ts) asserts every spec
 * resolves, so a renamed / removed / re-shaped job fails CI rather than silently
 * dropping out of the avoidance set.
 */
function resolveHeavyMaintenance(): HeavyMaintenanceWindow[] {
  const out: HeavyMaintenanceWindow[] = [];
  for (const spec of HEAVY_JOB_SPECS) {
    const entry = getCatalogEntry(spec.jobId);
    if (!entry) continue;
    const cron = spec.cronOverride ?? entry.cron;
    if (!parseSimpleCron(cron)) continue;
    out.push({ label: entry.name, cron, durationMin: spec.durationMin });
  }
  return out;
}

export const HEAVY_MAINTENANCE: HeavyMaintenanceWindow[] = resolveHeavyMaintenance();

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
