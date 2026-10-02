// Cron next-run computation for scheduled agent tasks (BI-D72CC945).
//
// The previous hand-rolled parser in agent-task-scheduler.ts destructured
// `[minute, hour, , , dayOfWeek]` and silently discarded the day-of-month and
// month fields, so the Calendar "Monthly (1st)" preset (`0 9 1 * *`) actually
// fired DAILY and "Once" (`m h D M *`) fired daily and never stopped. This
// module honors all five standard cron fields.
//
// Scope: supports the field shapes the scheduler actually emits and stores —
// concrete minute/hour, and `*` / single value / comma-list / `a-b` range for
// day-of-month, month, and day-of-week. Minute/hour are treated as concrete
// (a `*` minute/hour defaults to 0); sub-hourly crons are out of scope here and
// belong to the named-interval helper (computeNextRunAt). Times use the host
// Date methods, consistent with the rest of the scheduler (server runs UTC).

/** Parse one cron field into the set of matching integers, or null for `*`. */
function parseCronField(
  field: string,
  min: number,
  max: number,
  normalize?: (n: number) => number,
): number[] | null {
  if (field === "*") return null;
  const out = new Set<number>();
  for (const token of field.split(",")) {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = parseInt(range[1]!, 10);
      const hi = parseInt(range[2]!, 10);
      for (let n = lo; n <= hi; n++) add(n);
    } else if (/^\d+$/.test(token)) {
      add(parseInt(token, 10));
    }
    // Unsupported step/`*` tokens inside a list are ignored — the scheduler
    // never emits them; a bad token simply contributes no matches.
  }
  return out.size ? [...out] : null;

  function add(n: number) {
    const v = normalize ? normalize(n) : n;
    if (v >= min && v <= max) out.add(v);
  }
}

/**
 * Compute the next run time strictly after `from` for a 5-field cron
 * expression (`minute hour day-of-month month day-of-week`).
 *
 * Honors all five fields. Follows standard cron semantics for the
 * day-of-month / day-of-week interaction: when BOTH are restricted the match is
 * their union (OR); when one is `*` the other governs.
 *
 * Falls back to `from + 24h` for a malformed (non-5-field) expression, matching
 * the previous behavior so a bad value never wedges the dispatcher.
 */
export function computeNextCronRun(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(from.getTime() + 24 * 60 * 60_000);

  const [minP, hourP, domP, monP, dowP] = parts as [string, string, string, string, string];
  const minute = minP === "*" ? 0 : parseInt(minP, 10);
  const hour = hourP === "*" ? 0 : parseInt(hourP, 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return new Date(from.getTime() + 24 * 60 * 60_000);
  }

  const domSet = parseCronField(domP, 1, 31);
  const monSet = parseCronField(monP, 1, 12);
  // Day-of-week: accept 0-7 with 7 normalized to 0 (Sunday), as standard cron does.
  const dowSet = parseCronField(dowP, 0, 6, (n) => (n === 7 ? 0 : n));

  const cand = new Date(from);
  cand.setHours(hour, minute, 0, 0);

  // Day-granular search. 1500 days covers multi-year day-of-month/month combos
  // (e.g. Feb 29) without an unbounded loop.
  for (let i = 0; i < 1500; i++) {
    if (cand > from) {
      const monthOk = !monSet || monSet.includes(cand.getMonth() + 1);
      const domMatch = !domSet || domSet.includes(cand.getDate());
      const dowMatch = !dowSet || dowSet.includes(cand.getDay());
      // Both restricted -> union; otherwise the `*` side is already `true`.
      const dayOk = domSet && dowSet ? domMatch || dowMatch : domMatch && dowMatch;
      if (monthOk && dayOk) return cand;
    }
    cand.setDate(cand.getDate() + 1);
    cand.setHours(hour, minute, 0, 0);
  }

  // Unreachable for valid crons; keep the dispatcher live rather than throw.
  return new Date(from.getTime() + 24 * 60 * 60_000);
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
// computeNextCronRun above serves the agent-task scheduler, whose stored
// expressions pin minute and hour, and its behaviour stays as it is. The job
// engine's cron functions need the rest of the grammar: `*` minute and hour,
// steps (`*/5`, `37 */6 * * *`) and long minute lists. Evaluated in UTC, as
// the durable-job engine has always run its crons (spec 2026-09-25 §5.4).

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
    const [range, stepPart] = token.split("/") as [string, string | undefined];
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
