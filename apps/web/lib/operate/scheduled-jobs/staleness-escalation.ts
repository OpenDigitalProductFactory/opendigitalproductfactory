// Scheduled-job staleness escalation (BI-12E646D3, EP-FULL-OBS).
//
// Cognitive-load migration "ascent" (code→AI / make-silent-failures-observable):
// a deterministic scheduled job that keeps failing — or hasn't succeeded for a
// long stretch — must EMIT a queryable escalation, not silently retry. The
// code-graph reconcile job was the motivating case (a multi-day silent staleness
// degraded code search / impact analysis with no operator signal).
//
// This module is intentionally generic so sibling jobs (taskrun-watchdog,
// skill-curator, …) can adopt the same pattern: the decision logic is a PURE
// function (unit-tested without a DB), and the escalation side-effect is a thin,
// idempotent wrapper over the governed createPlatformIssueReport front door.

/** Durable per-job staleness counters, persisted under ScheduledJob.metadata.staleness. */
export type JobStalenessState = {
  /** ISO timestamp of the last successful run, or null if never recorded. */
  lastOkAt: string | null;
  /** Consecutive error runs since the last success. */
  consecutiveErrors: number;
  /**
   * Consecutive DEFERRED runs since the last actual run (BI-9BF17415) — a
   * scheduled tick that was skipped before executing (e.g. blocked by the
   * quiescence drain gate) instead of running to ok/error. Reset to 0 on any
   * actual run. A climbing value is a make-silent-failures-observable signal
   * that the job is being starved of execution windows — a code→AI "ascent"
   * candidate whose fixed gating may need judgment (consumed by BI-A028AA14).
   */
  deferCount: number;
};

export type StalenessThresholds = {
  /** Escalate once this many consecutive error runs is reached. */
  maxConsecutiveErrors: number;
  /** Escalate once no successful run has happened for this long (ms). */
  maxAgeMs: number;
};

export type StalenessDecision = {
  nextState: JobStalenessState;
  escalate: boolean;
  /** Human-readable why, present only when escalate === true. */
  reason: string | null;
};

const EMPTY_STATE: JobStalenessState = { lastOkAt: null, consecutiveErrors: 0, deferCount: 0 };

/** Read the staleness sub-state out of a ScheduledJob.metadata JSON blob. */
export function readStalenessState(metadata: unknown): JobStalenessState {
  if (!metadata || typeof metadata !== "object") return { ...EMPTY_STATE };
  const raw = (metadata as Record<string, unknown>).staleness;
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  const r = raw as Record<string, unknown>;
  return {
    lastOkAt: typeof r.lastOkAt === "string" ? r.lastOkAt : null,
    consecutiveErrors: typeof r.consecutiveErrors === "number" && r.consecutiveErrors >= 0 ? r.consecutiveErrors : 0,
    deferCount: typeof r.deferCount === "number" && r.deferCount >= 0 ? r.deferCount : 0,
  };
}

/** Merge a new staleness sub-state back into a metadata blob, preserving other keys. */
export function mergeStalenessState(metadata: unknown, state: JobStalenessState): Record<string, unknown> {
  const base = metadata && typeof metadata === "object" ? { ...(metadata as Record<string, unknown>) } : {};
  base.staleness = state;
  return base;
}

/**
 * Pure staleness decision. A successful run resets the counters and never
 * escalates. A failed run advances the counters and escalates when EITHER the
 * consecutive-error count or the age-since-last-success crosses its threshold.
 * `lastOkAt === null` (never succeeded) is treated as infinitely old, so a job
 * that has only ever failed escalates on its `maxConsecutiveErrors`-th run.
 */
export function evaluateJobStaleness(
  prev: JobStalenessState,
  status: "ok" | "error",
  now: Date,
  thresholds: StalenessThresholds,
): StalenessDecision {
  if (status === "ok") {
    return { nextState: { lastOkAt: now.toISOString(), consecutiveErrors: 0, deferCount: 0 }, escalate: false, reason: null };
  }

  const consecutiveErrors = (prev.consecutiveErrors ?? 0) + 1;
  const lastOkAt = prev.lastOkAt ?? null;

  const byErrors = consecutiveErrors >= thresholds.maxConsecutiveErrors;
  // Age only applies once we have a prior success to measure from — a job that
  // has only ever failed escalates on its consecutive-error count, not on an
  // (infinite) age, so a brand-new job doesn't escalate on its first error.
  const ageMs = lastOkAt ? now.getTime() - new Date(lastOkAt).getTime() : 0;
  const byAge = lastOkAt != null && ageMs >= thresholds.maxAgeMs;
  const escalate = byErrors || byAge;

  let reason: string | null = null;
  if (escalate) {
    const parts: string[] = [];
    if (byErrors) parts.push(`${consecutiveErrors} consecutive failed run(s)`);
    if (byAge) parts.push(`no successful run for ~${Math.round(ageMs / 3_600_000)}h`);
    reason = parts.join("; ");
  }

  return { nextState: { lastOkAt, consecutiveErrors, deferCount: 0 }, escalate, reason };
}

/**
 * Pure: record that a scheduled run was DEFERRED (skipped before executing —
 * e.g. blocked by the quiescence drain gate) instead of running. Increments the
 * consecutive-defer counter and preserves the staleness counters; an actual run
 * (`evaluateJobStaleness` on ok|error) resets deferCount to 0. The rate/
 * threshold read is the consumer's job (BI-A028AA14); this only emits the
 * queryable counter, so a deferral is never mistaken for an error or a success.
 */
export function recordJobDefer(prev: JobStalenessState): JobStalenessState {
  return { ...prev, deferCount: (prev.deferCount ?? 0) + 1 };
}

/**
 * Idempotently raise a PlatformIssueReport for a stale scheduled job. The
 * dedupeKey (`stale:<jobId>`) + the platform's "one non-resolved report per
 * dedupeKey" partial-unique mean repeated calls while a report is already open
 * are no-ops (the unique violation is swallowed) — so this is safe to call on
 * every cadence tick. Server-only; dynamic imports match the reconcile worker.
 */
export async function escalateStaleScheduledJob(args: {
  jobId: string;
  reason: string;
  title: string;
  description: string;
  routeContext?: string;
}): Promise<{ escalated: boolean }> {
  const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");
  const dedupeKey = `stale:${args.jobId}`;
  try {
    await createPlatformIssueReport({
      type: "scheduled-job-stale",
      severity: "high",
      source: "automated-detection",
      title: args.title,
      description: `${args.description}\n\nDetected: ${args.reason}.`,
      routeContext: args.routeContext ?? "/platform",
      triggerKind: "staleness-watchdog",
      dedupeKey,
    });
    return { escalated: true };
  } catch (err) {
    // Expected when a non-resolved report for this dedupeKey already exists
    // (partial-unique). Any failure here must not break the reconcile job.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2002") {
      console.error(`[staleness-escalation] failed to raise report for ${JSON.stringify(args.jobId)}: ${err instanceof Error ? JSON.stringify(err.message) : "unknown"}`);
    }
    return { escalated: false };
  }
}
