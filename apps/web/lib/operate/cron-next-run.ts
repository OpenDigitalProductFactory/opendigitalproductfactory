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
