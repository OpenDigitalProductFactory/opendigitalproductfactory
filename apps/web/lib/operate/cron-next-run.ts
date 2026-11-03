// Cron next-run computation for scheduled agent tasks (BI-D72CC945).
//
// The previous hand-rolled parser in agent-task-scheduler.ts destructured
// `[minute, hour, , , dayOfWeek]` and silently discarded the day-of-month and
// month fields, so the Calendar "Monthly (1st)" preset (`0 9 1 * *`) actually
// fired DAILY and "Once" (`m h D M *`) fired daily and never stopped. This
// module honors all five standard cron fields.
//
// The agent-task compatibility API and durable jobs share the full UTC
// evaluator below (BI-0A82D3B4), including wildcard, list, range and step fields.

/**
 * Compute the next run time strictly after `from` for a 5-field cron
 * expression (`minute hour day-of-month month day-of-week`).
 *
 * Honors all five fields. Follows standard cron semantics for the
 * day-of-month / day-of-week interaction: when BOTH are restricted the match is
 * their union (OR); when one is `*` the other governs.
 *
 * The Date-returning compatibility API retains `from + 24h` when the bounded
 * evaluator cannot find a match. Validation/projection callers use the nullable
 * evaluator directly rather than treating that fallback as a valid cron fire.
 */
export function computeNextCronRun(cronExpr: string, from: Date): Date {
  return computeNextCronFire(cronExpr, from) ?? new Date(from.getTime() + 24 * 60 * 60_000);
}

/**
 * True when a cron expression denotes a single calendar occurrence rather than
 * a recurring cadence — i.e. both month and day-of-month are pinned (and
 * day-of-week is unconstrained). This is exactly the Calendar "Once" preset
 * (`m h D M *`); no recurring preset pins the month. Callers use this to
 * deactivate the task after it fires instead of re-arming it a year later.
 */
export function isOneShotCron(cronExpr: string): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , domP, monP, dowP] = parts as [string, string, string, string, string];
  return monP !== "*" && domP !== "*" && dowP === "*";
}

// ─── Full five-field evaluator (BI-85E6EF14) ───────────────────────────────
//
// Shared by agent tasks and the job engine: `*` minute and hour, steps
// (`*/5`, `37 */6 * * *`) and long minute lists, evaluated in UTC.

type CronSchedule = {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number> | null;
  months: Set<number>;
  weekdays: Set<number> | null;
};

function expandCronField(field: string, min: number, max: number, normalize?: (n: number) => number): Set<number> | null {
  const out = new Set<number>();
  for (const token of field.split(",")) {
    const segments = token.split("/");
    if (segments.length > 2) return null;
    const [range, stepPart] = segments as [string, string | undefined];
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (/^\d+-\d+$/.test(range)) {
      [lo, hi] = range.split("-").map(Number) as [number, number];
    } else if (/^\d+$/.test(range)) {
      lo = Number(range);
      hi = stepPart === undefined ? lo : max;
    } else {
      return null;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let n = lo; n <= hi; n += step) out.add(normalize ? normalize(n) : n);
  }
  return out.size > 0 ? out : null;
}

/** Parse a five-field cron expression, or null when it is not one. */
export function parseCronSchedule(cronExpr: string): CronSchedule | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minP, hourP, domP, monP, dowP] = parts as [string, string, string, string, string];
  const minutes = expandCronField(minP, 0, 59);
  const hours = expandCronField(hourP, 0, 23);
  const months = expandCronField(monP, 1, 12);
  const days = domP === "*" ? null : expandCronField(domP, 1, 31);
  const weekdays = dowP === "*" ? null : expandCronField(dowP, 0, 7, (n) => (n === 7 ? 0 : n));
  if (!minutes || !hours || !months) return null;
  if (domP !== "*" && !days) return null;
  if (dowP !== "*" && !weekdays) return null;
  return { minutes, hours, days, months, weekdays };
}

/**
 * The first UTC minute strictly after `from` that a five-field cron expression
 * matches. Supports `*`, values, lists, ranges and steps; day-of-month and
 * day-of-week combine as a union when both are restricted (Vixie cron).
 * Returns null for an expression it cannot parse, so a caller never invents a
 * schedule the author did not write.
 */
export function computeNextCronFire(cronExpr: string, from: Date): Date | null {
  const schedule = parseCronSchedule(cronExpr);
  if (!schedule) return null;
  const cand = new Date(from.getTime());
  cand.setUTCSeconds(0, 0);
  cand.setUTCMinutes(cand.getUTCMinutes() + 1);
  // Minute-granular scan with day and hour skips. Bounded at ~5 years, which
  // covers every valid day/month combination (Feb 29) without an open loop.
  const limit = cand.getTime() + 5 * 366 * 24 * 60 * 60_000;
  while (cand.getTime() <= limit) {
    if (!schedule.months.has(cand.getUTCMonth() + 1) || !dayMatches(schedule, cand)) {
      cand.setUTCDate(cand.getUTCDate() + 1);
      cand.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!schedule.hours.has(cand.getUTCHours())) {
      cand.setUTCHours(cand.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!schedule.minutes.has(cand.getUTCMinutes())) {
      cand.setUTCMinutes(cand.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return cand;
  }
  return null;
}

function dayMatches(schedule: CronSchedule, at: Date): boolean {
  const domMatch = !schedule.days || schedule.days.has(at.getUTCDate());
  const dowMatch = !schedule.weekdays || schedule.weekdays.has(at.getUTCDay());
  return schedule.days && schedule.weekdays ? domMatch || dowMatch : domMatch && dowMatch;
}
