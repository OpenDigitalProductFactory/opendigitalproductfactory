// EP-SCHEDULING-SURFACE — forward schedule projection over an operator-chosen
// window.
//
// The predecessor timeline projected a STATIC in-code map onto a fixed 24-hour
// UTC clock. Two consequences: it showed catalog crons that have never run while
// hiding every live coworker task except four hard-coded ones, and a day was the
// only period you could ever see — so a weekly sweep or a monthly reconcile was
// invisible on the only chart the surface had.
//
// This projects the LIVE register forward over a day, a week or a month, using
// each job's actual cadence. Pure: takes views, returns buckets.

import { computeNextCronRun } from "@/lib/operate/cron-next-run";
import { computeNextRunAt } from "@/lib/inference/ai-provider-types";

import {
  cadenceIntervalMs,
  hasProjectableCronTime,
  type ScheduledWorkView,
} from "./work-model";

export type WindowRange = "day" | "week" | "month";

export const WINDOW_LABELS: Record<WindowRange, string> = {
  day: "Next 24 hours",
  week: "Next 7 days",
  month: "Next 30 days",
};

interface WindowShape {
  /** Number of buckets in the window. */
  buckets: number;
  /** Duration of one bucket, ms. */
  bucketMs: number;
}

const SHAPES: Record<WindowRange, WindowShape> = {
  day: { buckets: 24, bucketMs: 3_600_000 },
  week: { buckets: 7, bucketMs: 24 * 3_600_000 },
  month: { buckets: 30, bucketMs: 24 * 3_600_000 },
};

export interface Occurrence {
  jobId: string;
  name: string;
  /** ISO instant the job is projected to fire. */
  at: string;
  isAgent: boolean;
  category: "core" | "editable";
}

export interface WindowBucket {
  /** Bucket start, ISO. */
  startsAt: string;
  /** Short axis label ("14", "Mon 24"). */
  label: string;
  occurrences: Occurrence[];
}

export interface ScheduleWindow {
  range: WindowRange;
  startsAt: string;
  buckets: WindowBucket[];
  /** Busiest bucket size, for bar scaling. */
  peak: number;
  /** Jobs firing more often than one bucket — charting them would be noise, so
   *  they are listed rather than plotted. */
  continuous: { jobId: string; name: string; cadence: string; isAgent: boolean }[];
  /** Enabled recurring jobs with no projectable next run in the window. */
  quiet: { jobId: string; name: string; cadence: string; isAgent: boolean }[];
}

/** Next fire strictly after `from`, for either cadence form. Null when the
 *  expression's minute/hour cannot be projected — the caller lists those as
 *  continuous rather than inventing a fire time for them. */
function nextFire(schedule: string, from: Date): Date | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length === 5) {
    return hasProjectableCronTime(schedule) ? computeNextCronRun(schedule, from) : null;
  }
  return computeNextRunAt(schedule, from);
}

/** Hard cap on enumerated fires per job, so a dense cadence cannot run away. */
const MAX_OCCURRENCES_PER_JOB = 64;

function bucketLabel(range: WindowRange, at: Date): string {
  if (range === "day") return String(at.getHours()).padStart(2, "0");
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][at.getDay()]!;
  return `${day} ${at.getDate()}`;
}

/**
 * Project every live, enabled, recurring job forward across the window.
 *
 * Spent one-shots, slot-locks and disabled jobs are excluded by construction —
 * they will not fire, and the whole point of the chart is what is going to
 * happen.
 */
export function buildScheduleWindow(
  views: readonly ScheduledWorkView[],
  range: WindowRange,
  now: Date = new Date(),
): ScheduleWindow {
  const { buckets: bucketCount, bucketMs } = SHAPES[range];

  // Align to the start of the current bucket so the axis reads cleanly.
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  if (range !== "day") start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = startMs + bucketCount * bucketMs;

  const buckets: WindowBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const at = new Date(startMs + i * bucketMs);
    return { startsAt: at.toISOString(), label: bucketLabel(range, at), occurrences: [] };
  });

  const continuous: ScheduleWindow["continuous"] = [];
  const quiet: ScheduleWindow["quiet"] = [];

  for (const view of views) {
    if (view.kind !== "recurring" || !view.enabled) continue;
    const isAgent = view.substrate === "agent-task";
    const entry = { jobId: view.jobId, name: view.name, cadence: view.cadence, isAgent };

    // Two reasons a job is listed rather than plotted:
    //  - it fires more often than one bucket, so a bar per fire is a solid block;
    //  - its cron pins no concrete minute/hour, so there is no fire time to place
    //    it at. Such a shape always repeats sub-daily (`*​/5 * * * *`,
    //    `0 * * * *`), so listing it is right and inventing a bar would be wrong.
    const interval = cadenceIntervalMs(view.schedule);
    const isCron = view.schedule.trim().split(/\s+/).length === 5;
    if ((interval !== null && interval < bucketMs) || (isCron && !hasProjectableCronTime(view.schedule))) {
      continuous.push(entry);
      continue;
    }

    // Anchor on the register's own next run when it falls inside the window. A
    // named-token cadence ("daily") carries no time of day, so projecting it
    // from the window start puts the first fire exactly at the window edge and
    // a daily job reads as "no fire in the next 24 hours". The stored next run
    // is the truthful anchor, and it is what the row already shows.
    const stored = view.nextRunAt ? new Date(view.nextRunAt).getTime() : NaN;
    const anchored = Number.isFinite(stored) && stored >= startMs && stored < endMs;

    let cursor = new Date(anchored ? stored : startMs);
    let placed = 0;
    for (let i = 0; i < MAX_OCCURRENCES_PER_JOB; i++) {
      // The anchor itself is the first fire; afterwards project forward.
      const fire = i === 0 && anchored ? new Date(stored) : nextFire(view.schedule, cursor);
      if (!fire || fire.getTime() < startMs) break;
      if (i > 0 && fire.getTime() <= cursor.getTime()) break;
      if (fire.getTime() >= endMs) break;
      const index = Math.floor((fire.getTime() - startMs) / bucketMs);
      if (index >= 0 && index < bucketCount) {
        buckets[index]!.occurrences.push({
          jobId: view.jobId,
          name: view.name,
          at: fire.toISOString(),
          isAgent,
          category: view.category,
        });
        placed++;
      }
      cursor = fire;
    }
    if (placed === 0) quiet.push(entry);
  }

  for (const b of buckets) {
    b.occurrences.sort((a, z) => a.at.localeCompare(z.at));
  }

  return {
    range,
    startsAt: start.toISOString(),
    buckets,
    peak: buckets.reduce((m, b) => Math.max(m, b.occurrences.length), 0),
    continuous: continuous.sort((a, z) => a.name.localeCompare(z.name)),
    quiet: quiet.sort((a, z) => a.name.localeCompare(z.name)),
  };
}
