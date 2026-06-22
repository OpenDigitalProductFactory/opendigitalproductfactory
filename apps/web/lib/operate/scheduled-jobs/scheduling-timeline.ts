// BI-SCHED-TIMELINE / EP-SCHEDULING-SURFACE — pure model for the daily-schedule
// visual on /admin/scheduled-jobs. Classifies each scheduled unit (from the
// canonical scheduling map) onto the 24h UTC clock: a concrete time-of-day, a
// frequent/always-on cadence, or a daily job whose exact time lives in code.

import type { SchedulingMapEntry } from "./scheduling-map";

export type TimelineJob = {
  id: string;
  name: string;
  category: "core" | "editable";
  /** Display label: "03:10" / "03:00 (weekly)" for timed; the cadence otherwise. */
  label: string;
};

export type TimelineProfile =
  | { kind: "timed"; hour: number; minute: number; weekly: boolean }
  | { kind: "frequent" }
  | { kind: "unpinned" };

function parseFirstInt(field: string): number | null {
  const m = field.match(/^(\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

/**
 * Classify a 5-field cron (or null) by where it sits on the daily clock:
 *   - hour `*`        -> fires within every hour (frequent / always-on)
 *   - concrete hour   -> timed at that hour:minute (weekly if day-of-week is set)
 *   - null / non-cron -> unpinned (e.g. the "daily" backup tokens whose real
 *                        time is an env constant, not in the catalog string)
 * A comma/range hour list uses its first value for placement.
 */
export function fireProfile(cron: string | null): TimelineProfile {
  if (!cron) return { kind: "unpinned" };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { kind: "unpinned" };
  const [minP, hourP, , , dowP] = parts as [string, string, string, string, string];
  if (hourP === "*") return { kind: "frequent" };
  const hour = parseFirstInt(hourP);
  if (hour === null || hour < 0 || hour > 23) return { kind: "unpinned" };
  const minute = minP === "*" ? 0 : parseFirstInt(minP) ?? 0;
  return { kind: "timed", hour, minute, weekly: dowP !== "*" };
}

const pad = (n: number) => String(n).padStart(2, "0");

export type TimelineModel = {
  /** length 24, indexed by UTC hour 0..23. */
  hourBuckets: { hour: number; jobs: TimelineJob[] }[];
  /** sub-hourly / always-on jobs (hour `*`). */
  frequent: TimelineJob[];
  /** daily jobs whose exact time is code-defined (the "daily" tokens). */
  unpinned: TimelineJob[];
  /** busiest single hour's job count, for bar scaling. */
  maxBucket: number;
};

export function buildTimelineModel(entries: readonly SchedulingMapEntry[]): TimelineModel {
  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour, jobs: [] as TimelineJob[] }));
  const frequent: TimelineJob[] = [];
  const unpinned: TimelineJob[] = [];

  for (const e of entries) {
    const profile = fireProfile(e.cron);
    if (profile.kind === "timed") {
      hourBuckets[profile.hour]!.jobs.push({
        id: e.id,
        name: e.name,
        category: e.category,
        label: `${pad(profile.hour)}:${pad(profile.minute)}${profile.weekly ? " (weekly)" : ""}`,
      });
    } else if (profile.kind === "frequent") {
      frequent.push({ id: e.id, name: e.name, category: e.category, label: e.cadence });
    } else {
      unpinned.push({ id: e.id, name: e.name, category: e.category, label: e.cadence });
    }
  }

  for (const bucket of hourBuckets) bucket.jobs.sort((a, b) => a.label.localeCompare(b.label));
  frequent.sort((a, b) => a.name.localeCompare(b.name));
  unpinned.sort((a, b) => a.name.localeCompare(b.name));

  const maxBucket = hourBuckets.reduce((m, b) => Math.max(m, b.jobs.length), 0);
  return { hourBuckets, frequent, unpinned, maxBucket };
}
