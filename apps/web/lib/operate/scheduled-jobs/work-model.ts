// EP-SCHEDULING-SURFACE — the scheduled-work model (pure).
//
// WHY THIS EXISTS
// ---------------
// The admin Scheduled Jobs surface used to read ONE table (ScheduledJob) and
// treat every row in it as a live recurring job. That table is not a register of
// recurring work; it is a junk drawer holding four different populations:
//
//   1. genuinely recurring crons          (code-graph-reconcile, hourly)
//   2. one-shot dated dispatches          (mcp-efficiency-aiops-20260821)
//   3. GPU eval slot-claim locks          (eval-<modelId>, schedule "manual")
//   4. quarantined index-repair renames   (__dpf_quarantined__…)
//
// Only (1) is a scheduled job. (2) accumulates one permanent row per day
// forever — nothing retires it after it fires. (3) is a mutex stamped into the
// schedule table because it needed an atomic updateMany. (4) is debris. All
// four rendered identically, which is why the register read as "unwieldy" and
// why jobs that ran once and will never run again looked live.
//
// It also read the WRONG TABLE for agent-backed work. Seven ScheduledAgentTask
// rows are mirrored into ScheduledJob, and the two copies have drifted:
// `self-marketing-specialist-…` reads schedule="disabled" in ScheduledJob while
// its ScheduledAgentTask is active on `7 14 * * *` with a future nextRunAt —
// the surface showed "Disabled" for a job that runs every afternoon.
//
// THE MODEL
// ---------
// One read model over both substrates, with three derived facts the old view
// could not express:
//
//   kind      — recurring vs one-shot vs slot-lock. Lifecycle differs; so does
//               what the operator is allowed to do about it.
//   substrate — which engine actually runs it, and therefore which table is
//               AUTHORITATIVE. For agent-backed work the ScheduledAgentTask
//               wins and the ScheduledJob mirror is display debris.
//   agent     — the coworker behind the work, its route, and its last outcome.
//               Proactive coworker tasks are the majority of the live register;
//               showing them anonymously is why the page could not be read.
//
// Storage stays substrate-first (crons keep their catalog, agent tasks keep
// their table). This module is the read model that spans them.

import { SCHEDULE_INTERVALS_MS } from "@/lib/inference/ai-provider-types";
import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";

import { getCatalogEntry } from "./catalog";
import type { JobCategory } from "./catalog-types";

/**
 * Lifecycle shape of a unit of scheduled work. Derived, not stored — the
 * schedule string already carries the answer, nobody had read it.
 */
export type WorkKind =
  /** Fires on a repeating cadence. The only kind that belongs in the register. */
  | "recurring"
  /** Pinned to one calendar date (`isOneShotCron`). Fires once, then is spent. */
  | "one-shot"
  /** Not scheduled work at all — a mutex or run-record parked in the table. */
  | "slot-lock";

/** Which engine actually runs the work, and therefore which table is truth. */
export type WorkSubstrate =
  | "inngest-cron"
  /** A ScheduledAgentTask driven by the every-5-min agent-task-dispatch cron. */
  | "agent-task"
  /** A ScheduledJob row with no catalog entry and no agent task behind it. */
  | "unregistered";

export type WorkHealth =
  | "ok"
  /** Last run reported an error. */
  | "error"
  /** Active + recurring, but nextRunAt is well past due — it has stopped firing. */
  | "overdue"
  /** Has never run, and it maintains run data — so this is a real silence. */
  | "never"
  /** Runs, but reports nothing. A catalog cron with tracksRunData:false writes no
   *  ScheduledJob row by design, so it has no lastRunAt to show. Treating that
   *  absence as "never run" cried wolf on 44 healthy crons. */
  | "untracked"
  /** One-shot or slot-lock that has already fired. Nothing more will happen. */
  | "spent";

/** The coworker behind an agent-backed unit of work. */
export interface WorkAgentContext {
  agentId: string;
  /** Human title from the task itself (more specific than the job name). */
  taskTitle: string;
  /** Portal route whose page-scoped tools the agentic loop attaches. Doubles as
   *  the "where does this land" answer for an operator. */
  routeContext: string;
  ownerUserId: string;
  /** Public id of the TaskRun the last tick spawned, when there was one. */
  lastTaskRunId: string | null;
  lastThreadId: string | null;
}

/** Client-safe, fully-resolved row. Dates are ISO strings so the DTO crosses
 *  the server→client boundary cleanly. */
export interface ScheduledWorkView {
  jobId: string;
  name: string;
  purpose: string;
  kind: WorkKind;
  substrate: WorkSubstrate;
  category: JobCategory;
  inngestId: string | null;
  /** Operator may not retune or toggle this job from the surface. */
  locked: boolean;
  /** Live enablement, read from the AUTHORITATIVE substrate. */
  enabled: boolean;
  /** Raw cadence — a named token, a 5-field cron, or "manual". */
  schedule: string;
  /** Human cadence label derived from `schedule`, never from a stale catalog. */
  cadence: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  health: WorkHealth;
  /** How far past due `nextRunAt` is, in ms. 0 when not overdue. */
  overdueByMs: number;
  /** True when disabling this job actually stops it. Agent tasks always qualify
   *  (the dispatcher reads isActive); a cron qualifies only when its entry gate
   *  consults ScheduledJob.enabled. Elsewhere the switch is advisory and the
   *  surface must say so rather than offer a control that does nothing. */
  killSwitchEnforced: boolean;
  /** False when this job writes no run data, so last/next run are unknowable
   *  rather than absent. Drives the "runs, but reports nothing" presentation. */
  reportsRunData: boolean;
  /** True when the stored nextRunAt disagrees with the cadence — the schedule
   *  projection has gone stale and the row's "next run" cannot be trusted. */
  projectionStale: boolean;
  agent: WorkAgentContext | null;
  /** A manual trigger exists for this row (cron event, or agent re-arm). */
  canRunNow: boolean;
  /** Cadence is operator-tunable from this surface. */
  scheduleEditable: boolean;
  /** Spent one-shot / slot-lock debris that can be cleared from the register. */
  retirable: boolean;
  inCatalog: boolean;
}

// ─── Cadence humanising ───────────────────────────────────────────────────────

const TOKEN_LABELS: Record<string, string> = {
  "every-1m": "Every minute",
  "every-5m": "Every 5 minutes",
  "every-15m": "Every 15 minutes",
  "every-30m": "Every 30 minutes",
  "every-10-minutes": "Every 10 minutes",
  "every-6-hours": "Every 6 hours",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  disabled: "Disabled",
  manual: "Manual only",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (n: string) => n.padStart(2, "0");

/**
 * Human label for any cadence the register actually stores. Derived from the
 * schedule string itself so it can never disagree with what runs — the old view
 * fell back to the CATALOG's cadence text, which is why a row retuned in the DB
 * still advertised its code-defined cadence.
 */
export function describeSchedule(schedule: string): string {
  const token = TOKEN_LABELS[schedule];
  if (token) return token;

  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  // Sub-hourly and hourly step shapes: `*/15 * * * *`, `37 */6 * * *`.
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep) return `Every ${minStep[1]} minutes`;
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep) return `Every ${hourStep[1]}h at :${pad(min)}`;
  if (hour === "*") {
    // A deconflicted cron spreads its fires across an evenly-spaced minute list
    // (`2,7,12,…,57`). Rendering the list is accurate and unreadable; the gap is
    // what an operator is actually asking about.
    const spacing = evenMinuteSpacing(min);
    if (spacing) return `Every ${spacing} minutes`;
    return `Hourly at :${pad(min)}`;
  }

  const at = `${pad(hour)}:${pad(min)}`;

  // One calendar occurrence — say the date, and say that it is spent.
  if (mon !== "*" && dom !== "*") {
    const m = MONTHS[Number(mon) - 1] ?? mon;
    return `Once on ${m} ${dom} at ${at}`;
  }
  if (dow !== "*") {
    const days = dow
      .split(",")
      .map((d) => DOW[Number(d) % 7] ?? d)
      .join(", ");
    return `Weekly — ${days} at ${at}`;
  }
  if (dom !== "*") return `Monthly on the ${dom}${ordinal(Number(dom))} at ${at}`;
  return `Daily at ${at}`;
}

/** The common gap of an evenly-spaced, hour-filling minute list, else null. */
function evenMinuteSpacing(min: string): number | null {
  if (!min.includes(",")) return null;
  const mins = min.split(",");
  if (!mins.every((m) => /^\d+$/.test(m))) return null;
  const ns = mins.map(Number).sort((a, b) => a - b);
  if (ns.length < 3) return null;
  const gap = ns[1]! - ns[0]!;
  if (gap <= 0 || 60 % gap !== 0 || ns.length !== 60 / gap) return null;
  for (let i = 1; i < ns.length; i++) if (ns[i]! - ns[i - 1]! !== gap) return null;
  return gap;
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
}

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Lifecycle shape from the schedule string alone.
 *
 * `manual` is the tell for the eval slot-claim rows: `claimEvalSlot` writes a
 * ScheduledJob purely to get an atomic `updateMany` mutex on the GPU, and there
 * is no cadence behind it. Those are not jobs and must not sit in the register.
 */
export function deriveKind(schedule: string): WorkKind {
  if (schedule === "manual") return "slot-lock";
  if (isOneShotCron(schedule)) return "one-shot";
  return "recurring";
}

/**
 * Gap between fires for the sub-hourly and hourly cron shapes, or null when the
 * expression is not one of them.
 *
 * `computeNextCronRun` — the agent dispatcher's projector — deliberately treats
 * minute and hour as CONCRETE fields and returns a 24h fallback for anything
 * else. Delegating to it made every `*​/5 * * * *` cron look daily, which put
 * jobs that fire twelve times an hour in the "no fire inside this window" list.
 * This layer answers the shapes it does not cover, and leaves the rest to it.
 */
export function stepCronIntervalMs(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  // A step/wildcard minute or hour only repeats sub-daily when the date fields
  // are unconstrained; `*/5 * 1 * *` fires every 5 min on the 1st, not always.
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;

  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hour === "*") {
    const n = Number(minStep[1]);
    return n > 0 ? n * 60_000 : null;
  }
  if (min === "*" && hour === "*") return 60_000;

  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep && /^\d+$/.test(min)) {
    const n = Number(hourStep[1]);
    return n > 0 ? n * 3_600_000 : null;
  }
  // A concrete minute with a wildcard hour fires once an hour.
  if (hour === "*" && /^\d+$/.test(min)) return 3_600_000;
  return null;
}

/** True when the cron's minute and hour are concrete, which is the only shape
 *  `computeNextCronRun` can project a real next fire for. */
export function hasProjectableCronTime(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour] = parts as [string, string];
  return /^\d+$/.test(min) && /^\d+$/.test(hour);
}

/** Expected gap between runs, for overdue detection. Null when unknowable. */
export function cadenceIntervalMs(schedule: string): number | null {
  const token = SCHEDULE_INTERVALS_MS[schedule as keyof typeof SCHEDULE_INTERVALS_MS];
  if (token !== undefined) return token;
  if (schedule === "every-10-minutes") return 10 * 60_000;
  if (schedule === "every-6-hours") return 6 * 3_600_000;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const step = stepCronIntervalMs(schedule);
  if (step !== null) return step;
  if (!hasProjectableCronTime(schedule)) return null;
  // Measure the real gap by projecting two consecutive fires.
  const base = new Date(0);
  const first = computeNextCronRun(schedule, base);
  const second = computeNextCronRun(schedule, first);
  const gap = second.getTime() - first.getTime();
  return gap > 0 ? gap : null;
}

/**
 * Grace before an unfired job is called overdue: one full cadence on top of the
 * due time, floored at 15 minutes so a fast cron is not flagged for one missed
 * tick, and capped at a day so a monthly job still surfaces within a day of
 * going silent.
 */
export function overdueGraceMs(schedule: string): number {
  const interval = cadenceIntervalMs(schedule);
  if (interval === null) return 3_600_000;
  return Math.min(Math.max(interval, 15 * 60_000), 24 * 3_600_000);
}

export interface HealthInput {
  kind: WorkKind;
  enabled: boolean;
  schedule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  /** False when the job is a catalog cron that does not instrument run data.
   *  Its silence is by design and must not be reported as a failure. */
  reportsRunData: boolean;
}

/**
 * Health, including the two states the old three-way pill could not say:
 * "spent" (a one-shot that already fired and never will again) and "overdue"
 * (an active recurring job whose next run came and went). The old view showed
 * both as a green OK — a job could stop firing entirely and still read healthy.
 */
export function deriveHealth(input: HealthInput, now: Date): {
  health: WorkHealth;
  overdueByMs: number;
} {
  const { kind, enabled, schedule, lastRunAt, nextRunAt, lastStatus, reportsRunData } = input;

  if (kind !== "recurring" && lastRunAt) return { health: "spent", overdueByMs: 0 };
  if (!lastRunAt) {
    if (!reportsRunData) return { health: "untracked", overdueByMs: 0 };
    return { health: enabled ? "never" : "spent", overdueByMs: 0 };
  }
  if (lastStatus === "error") return { health: "error", overdueByMs: 0 };
  if (!enabled || !nextRunAt) return { health: "ok", overdueByMs: 0 };

  const lateBy = now.getTime() - nextRunAt.getTime();
  if (lateBy > overdueGraceMs(schedule)) return { health: "overdue", overdueByMs: lateBy };
  return { health: "ok", overdueByMs: 0 };
}

/**
 * True when the stored nextRunAt cannot be reconciled with the cadence — it is
 * further from lastRunAt than one cadence allows, in either direction. This is
 * how `postgres-trial-restore-daily` was carrying a nextRunAt 73 days in the
 * PAST while running fine every night: nothing recomputed the projection, and
 * the surface reported it as fact.
 */
export function isProjectionStale(
  schedule: string,
  lastRunAt: Date | null,
  nextRunAt: Date | null,
): boolean {
  if (!lastRunAt || !nextRunAt) return false;
  const interval = cadenceIntervalMs(schedule);
  if (interval === null) return false;
  const gap = nextRunAt.getTime() - lastRunAt.getTime();
  // Allow a generous 2x band; anything outside it (including a NEGATIVE gap,
  // i.e. a next run before the last run) is an unmaintained projection.
  return gap <= 0 || gap > interval * 2;
}

// ─── Row shapes ───────────────────────────────────────────────────────────────

export interface JobRow {
  jobId: string;
  name: string;
  schedule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  category: string;
  locked: boolean;
  enabled: boolean;
  metadata?: unknown;
}

export interface AgentTaskRow {
  taskId: string;
  agentId: string;
  title: string;
  routeContext: string;
  schedule: string;
  isActive: boolean;
  ownerUserId: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastThreadId: string | null;
  taskRunId: string | null;
}

export const JOB_SELECT = {
  jobId: true,
  name: true,
  schedule: true,
  lastRunAt: true,
  nextRunAt: true,
  lastStatus: true,
  lastError: true,
  category: true,
  locked: true,
  enabled: true,
  metadata: true,
} as const;

export const TASK_SELECT = {
  taskId: true,
  agentId: true,
  title: true,
  routeContext: true,
  schedule: true,
  isActive: true,
  ownerUserId: true,
  lastRunAt: true,
  nextRunAt: true,
  lastStatus: true,
  lastError: true,
  lastThreadId: true,
  taskRunId: true,
} as const;

/** Rows renamed aside by the index-integrity repair. Debris, not schedule. */
const QUARANTINE_PREFIX = "__dpf_quarantined__";

export function isQuarantined(jobId: string): boolean {
  return jobId.startsWith(QUARANTINE_PREFIX);
}

/**
 * True when an operator has explicitly retired this spent entry. Retire is
 * non-destructive (the eval slot-locks are a live GPU mutex keyed on their own
 * lastRunAt), so the row survives — but it must leave the register, or the
 * button reports success and visibly does nothing.
 */
export function isRetired(metadata: unknown): boolean {
  return (
    metadata != null
    && typeof metadata === "object"
    && typeof (metadata as Record<string, unknown>).retiredAt === "string"
  );
}

/**
 * Which ids belong in the register, given the catalog and both substrates.
 *
 * Pure and separately tested because this is where a retired entry leaked back
 * in: an aiops one-shot exists as BOTH a ScheduledJob mirror and a
 * ScheduledAgentTask, so excluding it from one source left the other re-adding
 * it — Retire reported success and the row stayed on screen.
 */
export function selectRegisterIds(
  catalogIds: readonly string[],
  jobRows: readonly { jobId: string; metadata?: unknown }[],
  taskIds: readonly string[],
): string[] {
  const retired = new Set(jobRows.filter((r) => isRetired(r.metadata)).map((r) => r.jobId));
  const ids = new Set<string>();
  for (const id of catalogIds) if (!retired.has(id)) ids.add(id);
  for (const id of taskIds) if (!retired.has(id)) ids.add(id);
  for (const r of jobRows) {
    if (isQuarantined(r.jobId) || retired.has(r.jobId)) continue;
    ids.add(r.jobId);
  }
  return [...ids];
}

/**
 * Build one view from whatever evidence exists for a jobId. Exported for tests.
 *
 * Authority order is deliberate: an agent task OWNS its schedule and run state,
 * because the agent-task-dispatch cron reads that table and never reads the
 * ScheduledJob mirror. Where the two disagree the mirror is simply wrong.
 */
export function buildWorkView(
  jobId: string,
  job: JobRow | undefined,
  task: AgentTaskRow | undefined,
  now: Date,
): ScheduledWorkView {
  const entry = getCatalogEntry(jobId);

  const substrate: WorkSubstrate = task
    ? "agent-task"
    : entry
      ? "inngest-cron"
      : "unregistered";

  // The authoritative record for cadence + run state.
  const schedule = task?.schedule ?? job?.schedule ?? entry?.cron ?? "unknown";
  const enabled = task ? task.isActive : (job?.enabled ?? true);
  const lastRunAt = task?.lastRunAt ?? job?.lastRunAt ?? null;
  const nextRunAt = task?.nextRunAt ?? job?.nextRunAt ?? null;
  const lastStatus = task?.lastStatus ?? job?.lastStatus ?? null;
  const lastError = task?.lastError ?? job?.lastError ?? null;

  const kind = deriveKind(schedule);
  const category: JobCategory = entry
    ? entry.category
    : job?.category === "core"
      ? "core"
      : "editable";
  const locked = entry ? entry.category === "core" : (job?.locked ?? false);

  // A job reports run data when it actually has a row, or when its catalog entry
  // says it instruments one. An uncatalogued row obviously reports (it exists).
  const reportsRunData = job != null || task != null || (entry?.tracksRunData ?? false);
  const killSwitchEnforced = task != null || (entry?.honorsEnabledGate ?? false);

  const { health, overdueByMs } = deriveHealth(
    { kind, enabled, schedule, lastRunAt, nextRunAt, lastStatus, reportsRunData },
    now,
  );

  const agent: WorkAgentContext | null = task
    ? {
        agentId: task.agentId,
        taskTitle: task.title,
        routeContext: task.routeContext,
        ownerUserId: task.ownerUserId,
        lastTaskRunId: task.taskRunId,
        lastThreadId: task.lastThreadId,
      }
    : null;

  const name = entry?.name ?? task?.title ?? job?.name ?? jobId;
  const purposeText =
    entry?.purpose ??
    task?.title ??
    (kind === "slot-lock"
      ? "Not a scheduled job — a run-slot claim recorded in the schedule table."
      : "No registered purpose. This row is not in the code cron registry and has no agent task behind it.");
  // An agent task's title is already the row's name; repeating it as the purpose
  // just prints the same sentence twice.
  const purpose = purposeText === name ? "" : purposeText;

  return {
    jobId,
    name,
    purpose,
    kind,
    substrate,
    category,
    inngestId: entry?.inngestId ?? null,
    locked,
    enabled,
    schedule,
    cadence: describeSchedule(schedule),
    lastRunAt: lastRunAt?.toISOString() ?? null,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    lastStatus,
    lastError,
    health,
    overdueByMs,
    killSwitchEnforced,
    reportsRunData,
    projectionStale:
      kind === "recurring" && isProjectionStale(schedule, lastRunAt, nextRunAt),
    agent,
    // Every row can now be triggered by hand — a cron via its registered event,
    // an agent task by re-arming nextRunAt. Only rows with neither cannot.
    canRunNow: task != null || entry?.runNowEvent != null,
    scheduleEditable: !locked && kind === "recurring",
    retirable: health === "spent" && kind !== "recurring",
    inCatalog: entry != null,
  };
}

