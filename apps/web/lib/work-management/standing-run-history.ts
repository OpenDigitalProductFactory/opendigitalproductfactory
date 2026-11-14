// The rhythm of a standing room: its last 14 cycles as on time, late or missed
// (Work Atlas A4, BI-D8A6F0F2; design §3.5).
//
// A standing room runs once per cycle, and a cycle is one UTC date: the run key
// is the cycle key of the tick the run started on, ending `:YYYY-MM-DD`
// (drive-sequential-run.ts). The runs are read from the drive's own log. Every
// tick row carries its run key (BI-853120EE), and a run's conclusion changes the
// drive's hold, so the tick that concludes a run is always written, never
// folded into a quiet tick. A run cannot be replaced without concluding, so no
// run escapes the log.
//
// Nothing is inferred before the room's first recorded run: those dates read
// "no record", not "missed".
//
// Pure.

export const RHYTHM_WINDOW_DAYS = 14;

export type RhythmSlotState = "on-time" | "late" | "missed" | "running" | "due" | "no-record";

/** One drive log row, as far as the rhythm needs it. */
export type DriveRunRow = { runKey: string; action: string; reason: string; recordedAt: string | Date };

export type RhythmSlot = { date: string; state: RhythmSlotState };

export type StandingRhythm = {
  /** Oldest first; the last slot is today. */
  slots: RhythmSlot[];
  /** The start date of the open run, when one is in flight. */
  runningSince: string | null;
  counts: Record<"on-time" | "late" | "missed", number>;
};

const CYCLE_DATE = /:(\d{4}-\d{2}-\d{2})$/;
const DAY_MS = 86_400_000;

export function cycleDateOf(runKey: string): string | null {
  return CYCLE_DATE.exec(runKey)?.[1] ?? null;
}

/** The tick concluded its run: success, or asleep on the completed cycle (drive-plan-stage.ts runConcluded). */
function concludes(row: DriveRunRow): boolean {
  return (row.action === "stop" && row.reason === "success")
    || (row.action === "do_not_wake" && row.reason === "cycle_complete");
}

function utcDate(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function classifyStandingRhythm(input: {
  rows: readonly DriveRunRow[];
  /** The run key in the room's drive snapshot: the run in flight, or the last one concluded. */
  currentRunKey: string | null;
  /** The date of a recorded run older than `rows`, when the loader found one. */
  historyFrom?: string | null;
  now: Date;
  windowDays?: number;
}): StandingRhythm {
  const runs = new Map<string, { start: string; concluded: string | null }>();
  const note = (runKey: string) => {
    const start = cycleDateOf(runKey);
    if (!start) return null;
    const run = runs.get(runKey) ?? { start, concluded: null };
    runs.set(runKey, run);
    return run;
  };
  for (const row of input.rows) {
    const run = note(row.runKey);
    if (!run || !concludes(row)) continue;
    const date = utcDate(row.recordedAt);
    if (run.concluded === null || date < run.concluded) run.concluded = date;
  }
  if (input.currentRunKey) note(input.currentRunKey);

  const starts = [...runs.values()].map((run) => run.start);
  if (input.historyFrom) starts.push(input.historyFrom);
  const horizon = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : null;
  const open = [...runs.values()].filter((run) => run.concluded === null).sort((a, b) => a.start.localeCompare(b.start));
  const today = utcDate(input.now);
  const windowDays = input.windowDays ?? RHYTHM_WINDOW_DAYS;

  const slots: RhythmSlot[] = [];
  for (let back = windowDays - 1; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const own = [...runs.values()].find((run) => run.start === date);
    let state: RhythmSlotState;
    if (horizon === null || date < horizon) state = "no-record";
    else if (own) state = own.concluded === date ? "on-time" : own.concluded !== null || date !== today ? "late" : "running";
    else if (date === today) state = open.length > 0 ? "running" : "due";
    else state = "missed";
    slots.push({ date, state });
  }
  const count = (state: RhythmSlotState) => slots.filter((slot) => slot.state === state).length;
  return {
    slots,
    runningSince: open.at(-1)?.start ?? null,
    counts: { "on-time": count("on-time"), late: count("late"), missed: count("missed") },
  };
}
