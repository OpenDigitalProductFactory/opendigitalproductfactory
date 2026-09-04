/**
 * EP-WORK-POSTURE (BI-5087F34F) — why a scheduled job exists, not just when it fires.
 *
 * THE GAP. `ScheduledAgentTask` records a cron expression, a timezone, a
 * taskKind and a taskConfig. It records WHEN a job fires and nothing about WHY.
 * The proactivity plan is consulted only AFTER a failure, to size retry cadence
 * (see the `attempts` comment on the model). At fire time nothing can judge
 * immediacy, because nothing is ever asked.
 *
 * The concrete consequence: a job firing at 03:00 to discharge an obligation due
 * at 09:00 should resolve `pre-deadline` and behave urgently. Today it resolves
 * neither `pre-deadline` nor `out-of-hours` — the resolver is never called, and
 * the obligation it is racing is not recorded anywhere to resolve against.
 *
 * THE FOUR TRIGGER SOURCES are not invented here. They are the ones already
 * named in the governed value-stream design §5.1 — time, user request, incoming
 * message, detected need. Adding a fifth taxonomy for scheduled work would be
 * the parallel-vocabulary defect this platform keeps paying for.
 *
 * MIGRATION-FREE. The record rides the existing `taskConfig` JSON column under a
 * `trigger` key — the same discipline the workroom shape and posture claims use
 * on `scopeClaims`. A task with no trigger recorded behaves exactly as today.
 */
import type { TemporalBandInput } from "@/lib/work-posture";

export const SCHEDULED_WORK_TRIGGER_KINDS = [
  "time",
  "user-request",
  "incoming-message",
  "detected-need",
] as const;
export type ScheduledWorkTriggerKind = (typeof SCHEDULED_WORK_TRIGGER_KINDS)[number];

export interface ScheduledWorkTrigger {
  /** Why this job exists. */
  kind: ScheduledWorkTriggerKind;
  /** The room this job serves, when it serves one — so posture resolves through the room ladder. */
  workroomId?: string | null;
  /** The obligation this job discharges, when it discharges one. */
  obligation?: {
    /** ISO-8601. What the job is racing. */
    dueAt: string;
    /** Optional human label, e.g. "Q3 sales tax filing". */
    label?: string | null;
  } | null;
  recordedAt?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isScheduledWorkTriggerKind(value: unknown): value is ScheduledWorkTriggerKind {
  return (
    typeof value === "string"
    && (SCHEDULED_WORK_TRIGGER_KINDS as readonly string[]).includes(value)
  );
}

function validDueAt(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/**
 * Read the trigger out of a task's `taskConfig`, or null when none was recorded
 * or the record is unusable. Never throws — a malformed config must not stop a
 * scheduled job from running.
 */
export function readScheduledWorkTrigger(taskConfig: unknown): ScheduledWorkTrigger | null {
  const config = asRecord(taskConfig);
  const raw = config ? asRecord(config.trigger) : null;
  if (!raw || !isScheduledWorkTriggerKind(raw.kind)) return null;

  const obligationRaw = asRecord(raw.obligation);
  const dueAt = obligationRaw ? validDueAt(obligationRaw.dueAt) : null;

  return {
    kind: raw.kind,
    workroomId: typeof raw.workroomId === "string" && raw.workroomId ? raw.workroomId : null,
    // An obligation with no usable dueAt is not an obligation. Recording it as
    // one would make a job look deadline-bound when nothing can be measured.
    obligation: dueAt
      ? { dueAt, label: typeof obligationRaw?.label === "string" ? obligationRaw.label : null }
      : null,
    recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : null,
  };
}

/** Merge a trigger into an existing taskConfig, preserving every other key. */
export function withScheduledWorkTrigger(
  taskConfig: unknown,
  trigger: ScheduledWorkTrigger,
  now: Date = new Date(),
): Record<string, unknown> {
  const existing = asRecord(taskConfig) ?? {};
  return {
    ...existing,
    trigger: {
      kind: trigger.kind,
      ...(trigger.workroomId ? { workroomId: trigger.workroomId } : {}),
      ...(trigger.obligation?.dueAt
        ? {
            obligation: {
              dueAt: trigger.obligation.dueAt,
              ...(trigger.obligation.label ? { label: trigger.obligation.label } : {}),
            },
          }
        : {}),
      recordedAt: trigger.recordedAt ?? now.toISOString(),
    },
  };
}

/**
 * Turn a recorded trigger into the temporal input the posture resolver needs at
 * FIRE TIME. The obligation's due date — not the cron time — decides whether
 * this tick is racing a deadline.
 *
 * Returns the caller's base input unchanged when no obligation was recorded, so
 * a job that discharges nothing simply resolves against the business clock.
 */
export function temporalInputForTrigger(
  trigger: ScheduledWorkTrigger | null | undefined,
  base: TemporalBandInput,
): TemporalBandInput {
  const dueAt = trigger?.obligation?.dueAt;
  if (!dueAt) return base;
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) return base;
  return { ...base, dueAt: parsed };
}
