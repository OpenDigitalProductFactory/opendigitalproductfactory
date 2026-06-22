// BI-SCHED-ALLOCATE / EP-SCHEDULING-SURFACE — creation-time de-confliction.
//
// The contention guard (scheduling-map.test.ts) is a CI-time check over
// code-defined crons. Runtime-created ScheduledAgentTasks bypass it entirely:
// scheduleAgentTask() stored the operator's cron verbatim, so a new task could
// pile straight onto a tick already in use (e.g. another job at 03:00). This
// allocator de-conflicts AT CREATION: given the ticks already in use (the
// canonical map + live tasks), it nudges a colliding specific-time task to the
// nearest free minute within its hour and reports the move.
//
// Scope: specific-time crons (concrete hour). Interval/"frequent" cadences
// (hour `*`) are passed through — those come from code and are covered by the
// CI contention guard, not operator task creation.

const pad = (n: number) => String(n).padStart(2, "0");

/** The "HH:MM" tick a specific-time cron fires at, or null if it is not a
 *  single concrete tick (interval/frequent, malformed, or null). */
export function tickOf(cron: string | null): string | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minP, hourP] = parts as [string, string, string, string, string];
  if (hourP === "*") return null;
  const hour = parseInt(hourP, 10);
  const minute = minP === "*" ? 0 : parseInt(minP, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

/** Build the set of occupied "HH:MM" ticks from a list of crons. */
export function occupiedTicks(crons: ReadonlyArray<string | null>): Set<string> {
  const set = new Set<string>();
  for (const cron of crons) {
    const tick = tickOf(cron);
    if (tick) set.add(tick);
  }
  return set;
}

export type DeconflictResult = {
  /** The schedule to use — unchanged, or nudged to a free minute. */
  cron: string;
  moved: boolean;
  /** Operator-facing note when moved (null otherwise). */
  note: string | null;
};

/**
 * If `desired` is a specific-time cron whose tick is already occupied, nudge its
 * minute forward to the nearest free minute within the same hour (preserving
 * day-of-month / month / day-of-week). Otherwise return it unchanged.
 */
export function deconflictCron(desired: string, occupied: ReadonlySet<string>): DeconflictResult {
  const parts = desired.trim().split(/\s+/);
  if (parts.length !== 5) return { cron: desired, moved: false, note: null };
  const [minP, hourP, domP, monP, dowP] = parts as [string, string, string, string, string];
  if (hourP === "*") return { cron: desired, moved: false, note: null }; // interval — leave to CI guard
  const hour = parseInt(hourP, 10);
  const minute = minP === "*" ? 0 : parseInt(minP, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return { cron: desired, moved: false, note: null };

  const tick = (m: number) => `${pad(hour)}:${pad(m)}`;
  if (!occupied.has(tick(minute))) return { cron: desired, moved: false, note: null };

  for (let delta = 1; delta <= 59; delta++) {
    const m = (minute + delta) % 60;
    if (!occupied.has(tick(m))) {
      return {
        cron: `${m} ${hour} ${domP} ${monP} ${dowP}`,
        moved: true,
        note: `Auto-staggered ${tick(minute)} → ${tick(m)} UTC to avoid colliding with an existing scheduled job.`,
      };
    }
  }
  // Hour fully booked (60 jobs in one hour) — unreachable in practice; keep the
  // operator's choice rather than fail.
  return { cron: desired, moved: false, note: null };
}
