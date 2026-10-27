// When a fail-closed pause may be retried (BI-WRITEBACK-LATCH).
//
// #5166 stopped a real defect: a stage that produced no completing receipt was
// re-dispatched every 15 minutes, burning model capacity on work that never
// completed. Pausing instead was right.
//
// The latch it introduced is self-sustaining, though — the pause reason is
// itself one of the conditions that causes the pause — so a room that enters
// this state never leaves it. On this install that locked 12 of 24 rooms, and
// they stayed locked after the executor defect was fixed and deployed: a fix
// cannot reach a room that will not try again.
//
// So the latch is bounded rather than permanent. It holds WITHIN a cycle and
// releases on the next one, giving one attempt per cycle — daily, for these
// shapes — instead of the 96 per day the guard was built to stop. The capacity
// protection is kept (a 96x reduction); the deadlock is not.

import { isRecord } from "@/lib/shared/coerce";
import type { ApprovalOutcomeState } from "@/lib/coworker/approval-outcome";

import { WORKROOM_DRIVE_STALL_TICKS } from "./workroom-drive-hold";
import { EXECUTOR_WRITEBACK_UNAVAILABLE_REASON } from "./workroom-drive-receipts";

export type PriorDriveForLatch = {
  action: string;
  reason: string;
  stageKey: string | null;
  /** The cycle the prior tick belonged to. Null when unknown. */
  cycleKey: string | null;
};

/**
 * Whether the writeback latch still holds for this stage.
 *
 * A recorded `blocked` receipt records "this stage produced no writeback in THIS
 * cycle" — not a finding that the stage is permanently unfit. It is therefore
 * bounded by the cycle exactly like the prior-tick signal.
 *
 * ⟦An earlier version of this function returned true unconditionally on a
 * blocked receipt, reasoning that a recorded receipt outranks a prior-tick
 * inference. That preserved the very deadlock the bounded latch was written to
 * remove, and preserved it precisely for the rooms already stuck: on this
 * install the cycle rolled from 2026-09-08 to 2026-09-09 and all twelve stayed
 * locked. A guard that cannot be re-entered by the fix for its own cause is not
 * a guard.⟧
 *
 * An unknown cycle on either side still holds. Treating "unknown" as "a new
 * cycle" would silently re-open the every-tick loop the guard exists to prevent.
 */
export function writebackLatchHolds(input: {
  prior: PriorDriveForLatch | null;
  stageKey: string;
  currentCycleKey: string | null;
  blocked: boolean;
}): boolean {
  const prior = input.prior;
  // A blocked receipt with no readable prior tick cannot be dated, so it holds.
  if (!prior) return input.blocked;
  if (prior.stageKey !== input.stageKey) return false;

  const triedWriteback =
    input.blocked
    || prior.action === "dispatch_agent"
    || prior.reason === EXECUTOR_WRITEBACK_UNAVAILABLE_REASON;
  if (!triedWriteback) return false;

  // Same cycle — or an unknown one — keeps the latch. A genuinely new cycle
  // releases it for exactly one fresh attempt.
  if (prior.cycleKey === null || input.currentCycleKey === null) return true;
  return prior.cycleKey === input.currentCycleKey;
}

// ── The latch reads the dispatched run (BI-7C0B2BD6) ─────────────────────────
//
// The cycle bound above still held a room for the rest of its cycle whether or
// not anything was running. On 2026-10-14 that was 279 rooms: some had no task
// at all (an old dispatch_agent record that never created one), some had a
// task whose run had already failed, and some had a task the drive itself
// switched off on the next tick, before the scheduler ever ran it.
//
// When the drive can see the room's task, the latch now holds only while the
// dispatched run is outstanding, and for no longer than a deadline. A run that
// finished without a completing receipt is a failure: retried with backoff,
// and after WRITEBACK_RETRY_LIMIT failures of the same stage in a cycle the
// room stays paused and names the last error. A new cycle resets the count,
// so a deployed fix still reaches the room. Without a run observation (the
// graph path, older callers) the cycle-bounded rule above applies unchanged.

/** One drive tick: the backoff unit (WORKROOM_DRIVE_CRON is every 15 minutes). */
export const WRITEBACK_RETRY_BASE_MS = 15 * 60 * 1000;
/** Failures of the same stage in one cycle before the room stops retrying. */
export const WRITEBACK_RETRY_LIMIT = 3;
/** How long a queued run may stay unfinished: twice the stall window (WORKROOM_DRIVE_STALL_TICKS ticks). */
export const WRITEBACK_RUN_DEADLINE_MS = 2 * WORKROOM_DRIVE_STALL_TICKS * WRITEBACK_RETRY_BASE_MS;

/** What the room's scheduled task shows about the run the drive queued. */
export type StageRunObservation = {
  /** The stage the task was queued for; null when it names none. */
  stageKey: string | null;
  /** When the drive queued it (the dispatch checkpoint); null when unrecorded. */
  dispatchedAt: string | null;
  /** The task's latest run start, written when that run finishes. */
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  /** Exact recorded outcome(s) for this task's last proposed run. Missing stays held. */
  approvalOutcome?: ApprovalOutcomeState;
};

/** Failed attempts at one stage in one cycle, carried on the drive snapshot. */
export type WritebackRetry = {
  stageKey: string;
  cycleKey: string | null;
  failures: number;
  lastError: string | null;
  lastFailedAt: string;
  /** Which run (or deadline miss) the latest failure counted, so it counts once. */
  countedRunAt: string;
};

export type WritebackLatchDecision =
  | { hold: false; retry: WritebackRetry | null }
  | { hold: true; why: "outstanding"; keepTaskActive: true; retry: WritebackRetry | null }
  | { hold: true; why: "backoff"; retryAt: string; retry: WritebackRetry }
  | { hold: true; why: "exhausted"; retry: WritebackRetry }
  | { hold: true; why: "cycle"; retry: WritebackRetry | null }
  | { hold: true; why: "approval"; outcome: ApprovalOutcomeState; retry: WritebackRetry | null };

const time = (value: string | null | undefined): number => (typeof value === "string" ? Date.parse(value) : Number.NaN);

/**
 * Whether the latch holds, given what the dispatched run did. `run` undefined
 * means the caller cannot see the task (legacy rule); null means no task exists.
 */
export function decideWritebackLatch(input: {
  prior: PriorDriveForLatch | null;
  stageKey: string;
  currentCycleKey: string | null;
  blocked: boolean;
  run: StageRunObservation | null | undefined;
  retry: WritebackRetry | null;
  now: Date;
}): WritebackLatchDecision {
  const { prior, stageKey, currentCycleKey, run, now } = input;
  // Failures count within one stage and one cycle; anything else starts fresh.
  let retry = input.retry && input.retry.stageKey === stageKey && input.retry.cycleKey === currentCycleKey ? input.retry : null;
  if (run === undefined) {
    return writebackLatchHolds({ prior, stageKey, currentCycleKey, blocked: input.blocked })
      ? { hold: true, why: "cycle", retry }
      : { hold: false, retry };
  }
  // The task's recorded proposal is sufficient to retain the wait, even when
  // an older dispatch has no checkpoint or the calendar has rolled over.
  if (run?.stageKey === stageKey && run.lastStatus === "proposed" && run.approvalOutcome !== "executed") {
    return { hold: true, why: "approval", outcome: run.approvalOutcome ?? "unknown", retry };
  }
  const tried = prior
    ? prior.stageKey === stageKey
      && (input.blocked || prior.action === "dispatch_agent" || prior.reason === EXECUTOR_WRITEBACK_UNAVAILABLE_REASON)
    : input.blocked;
  if (!tried) return { hold: false, retry };
  // No task for this stage, or none the drive recorded queuing: nothing is outstanding.
  const dispatched = time(run?.dispatchedAt);
  if (!run || run.stageKey !== stageKey || !Number.isFinite(dispatched)) return { hold: false, retry };

  const ranAt = time(run.lastRunAt);
  const finished = Number.isFinite(ranAt) && ranAt >= dispatched && run.lastStatus !== null && run.lastStatus !== "running";
  let failure: { key: string; at: number; error: string };
  if (finished) {
    failure = {
      key: run.lastRunAt as string,
      at: ranAt,
      error: run.lastError?.trim()
        || (run.lastStatus === "error"
          ? "the run failed without a message"
          : `the run finished (${run.lastStatus}) without recording the stage's evidence`),
    };
  } else if (now.getTime() - dispatched < WRITEBACK_RUN_DEADLINE_MS) {
    return { hold: true, why: "outstanding", keepTaskActive: true, retry };
  } else {
    const hours = Math.round(WRITEBACK_RUN_DEADLINE_MS / 3_600_000);
    // Dated from the dispatch: the deadline already waited longer than any backoff step.
    failure = { key: `deadline:${run.dispatchedAt}`, at: dispatched, error: `no run finished within ${hours}h of dispatch` };
  }
  if (!retry || retry.countedRunAt !== failure.key) {
    retry = {
      stageKey,
      cycleKey: currentCycleKey,
      failures: (retry?.failures ?? 0) + 1,
      lastError: failure.error.slice(0, 280),
      lastFailedAt: new Date(failure.at).toISOString(),
      countedRunAt: failure.key,
    };
  }
  if (retry.failures >= WRITEBACK_RETRY_LIMIT) return { hold: true, why: "exhausted", retry };
  const retryAt = time(retry.lastFailedAt) + WRITEBACK_RETRY_BASE_MS * 2 ** (retry.failures - 1);
  if (now.getTime() < retryAt) return { hold: true, why: "backoff", retryAt: new Date(retryAt).toISOString(), retry };
  return { hold: false, retry };
}

/** The retry record a stored drive snapshot carries, or null when it carries none readable. */
export function readWritebackRetry(drive: unknown): WritebackRetry | null {
  const raw = isRecord(drive) && isRecord(drive.writebackRetry) ? drive.writebackRetry : null;
  if (!raw || typeof raw.stageKey !== "string" || !Number.isInteger(raw.failures) || (raw.failures as number) < 1
    || typeof raw.lastFailedAt !== "string" || typeof raw.countedRunAt !== "string") return null;
  return {
    stageKey: raw.stageKey,
    cycleKey: typeof raw.cycleKey === "string" ? raw.cycleKey : null,
    failures: raw.failures as number,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    lastFailedAt: raw.lastFailedAt,
    countedRunAt: raw.countedRunAt,
  };
}
