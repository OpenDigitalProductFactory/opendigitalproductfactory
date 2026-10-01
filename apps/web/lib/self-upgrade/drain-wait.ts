/**
 * An upgrade waits for work; it never ends "skipped" (BI-F9EE05E5).
 *
 * Helpers for the self-upgrade drain that closes admission, waits up to a
 * configurable bound (default 60 minutes) for in-flight work to finish, then
 * pauses in the non-terminal `awaiting-operator` status until the operator
 * chooses Keep waiting, Force now or Abort. The coordinator
 * (queue/functions/quiescence-run.ts) and the self-upgrade job
 * (queue/functions/self-upgrade-steps.ts) both build on these.
 *
 * Kept apart from quiescence.ts (which is at its module-size ceiling). It imports
 * only the leaf quiescence-contract.ts: quiescence.ts reaches this module through
 * dynamic imports, so importing quiescence.ts back would form an import cycle.
 * The helpers that need quiescence.ts at runtime (the level re-assert and the
 * swap guard) live in drain-admission.ts.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §11a, §12 decision 7.
 * Plan: docs/superpowers/plans/2026-09-30-upgrade-waits-for-work-plan.md slice A.
 */
import { prisma } from "@dpf/db";
import { isStale } from "@/lib/shared/staleness";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
// Only the leaf contract — never quiescence.ts, which reaches this module
// through dynamic imports (the import-cycle ratchet counts those too).
import {
  DEFAULT_DRAIN_WAIT_BUDGET_MS,
  TERMINAL_QUIESCENCE_STATUSES,
  type ActiveSessionBlockers,
  type EnteredStateAt,
  type QuiescenceOutcome,
} from "./quiescence-contract";

export { DEFAULT_DRAIN_WAIT_BUDGET_MS };

/** Operator controls while a drain waits: abort / keep-waiting / force. The
 *  coordinator sleeps on this event (filtered to its runId) between checks. */
export const QUIESCENCE_CONTROL_EVENT = "ops/quiescence.control";
export type QuiescenceControlAction = "abort" | "keep-waiting" | "force";

/** Sent by the coordinator when it reaches ready-to-swap, so the waiting
 *  self-upgrade job wakes at once instead of on its next poll. */
export const QUIESCENCE_READY_EVENT = "ops/quiescence.ready-to-swap";

/**
 * The statuses in which a drain is WAITING FOR WORK with admission closed: the
 * level is `draining` and new work is refused. The one definition used by the
 * coordinator's level re-assert, the boot reset (via isLiveSelfUpgradeDrain)
 * and Keep waiting.
 *   - pending / preparing come before admission closes (the level flips at
 *     enter-draining), so they are not waiting yet.
 *   - ready-to-swap / swapping keep admission closed too, but the wait is over:
 *     the swap owns them (see selfUpgradeRunsWithLiveDrain's swap window).
 */
export const DRAIN_WAIT_STATUSES = ["draining", "awaiting-operator"] as const;

export function isDrainWaitingStatus(status: string): boolean {
  return (DRAIN_WAIT_STATUSES as readonly string[]).includes(status);
}

/** How long after entering ready-to-swap a run still counts as live for the
 *  self-upgrade reconciler without a heartbeat: the coordinator stops beating
 *  there while the promoter builds (25-min budget) and the 10-min swap-complete
 *  handshake runs; an hour leaves margin and still reconciles a dead one. */
const SWAP_WINDOW_MS = 60 * 60 * 1000;

/** A waiting drain whose coordinator has not heartbeated for this long is dead.
 *  The 2-minute stuck-coordinator reaper (taskrun-watchdog.ts) normally fails it
 *  first; this is the in-process backstop for awaitQuiescenceReady. */
const COORDINATOR_SILENT_MS = 10 * 60 * 1000;

const DEFAULT_POLL_MS = 2_000;

/** A live drain's coordinator heartbeats on every check (at most ~60s apart);
 *  two minutes of silence means it is gone. Matches the stuck-coordinator
 *  reaper's window (taskrun-watchdog.ts). */
export const DRAIN_HEARTBEAT_LIVENESS_MS = 2 * 60 * 1000;

/**
 * Pure: a drain is live while its coordinator keeps heartbeating. Reconcilers
 * key on this, never on startedAt, so a drain that legitimately waits an hour
 * is never failed or reaped while it is still alive (BI-F9EE05E5).
 */
export function isDrainHeartbeatLive(args: {
  lastHeartbeatAt: Date | null | undefined;
  now: Date;
  thresholdMs: number;
}): boolean {
  return !!args.lastHeartbeatAt && !isStale(args.now, args.lastHeartbeatAt, args.thresholdMs);
}

/**
 * True while `runId` names a self-upgrade drain that is still waiting for work
 * (draining or awaiting-operator) and whose coordinator is heartbeating. The
 * one liveness test for "admission must stay closed": the coordinator's level
 * re-assert and the boot level reset both use it (BI-F9EE05E5).
 */
export async function isLiveSelfUpgradeDrain(runId: string | null, now: Date = new Date()): Promise<boolean> {
  if (!runId) return false;
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { status: true, trigger: true, lastHeartbeatAt: true },
  });
  return (
    !!row &&
    row.trigger === "self-upgrade" &&
    isDrainWaitingStatus(row.status) &&
    isDrainHeartbeatLive({ lastHeartbeatAt: row.lastHeartbeatAt, now, thresholdMs: DRAIN_HEARTBEAT_LIVENESS_MS })
  );
}

export type DrainControl = {
  status: string;
  budgetMs: number;
  /** When the drain began (enteredStateAt.draining, else the row's start), ISO. */
  drainStartedAt: string;
  /** True once an operator pressed Force now (shipForceEscalatedAt). */
  forced: boolean;
  /** Set once an operator pressed Abort (abortRequestedBy, see recordDrainAbort). */
  abortRequestedBy: string | null;
};

/**
 * Read what the coordinator re-evaluates every tick: the moving bound
 * (drainStartedAt + budgetMs, which Keep waiting extends) and the force flag.
 */
export async function readDrainControl(runId: string): Promise<DrainControl | null> {
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: {
      status: true, budgetMs: true, startedAt: true, enteredStateAt: true, shipForceEscalatedAt: true,
      abortRequestedAt: true, abortRequestedBy: true,
    },
  });
  if (!row) return null;
  const entered = (row.enteredStateAt as unknown as EnteredStateAt | null) ?? {};
  return {
    status: row.status,
    budgetMs: row.budgetMs,
    drainStartedAt: entered.draining ?? row.startedAt.toISOString(),
    forced: !!row.shipForceEscalatedAt,
    abortRequestedBy: row.abortRequestedAt ? (row.abortRequestedBy ?? "unknown") : null,
  };
}

/**
 * Make an operator Abort durable before any event is sent. The job engine only
 * delivers an event to a step already waiting for it, so an Abort sent while the
 * coordinator is inside a check would otherwise be lost and the drain could go
 * on to swap. The coordinator reads this marker on every check.
 *
 * Stored on QuiescenceRun.abortRequestedAt/By (mirroring shipForceEscalatedAt/By
 * for Force now). One conditional write: a no-op on a missing or already-ended
 * run, and the first Abort wins (a second click never rewrites who or when).
 * transitionState never writes these columns, so a transition cannot drop it.
 */
export async function recordDrainAbort(runId: string, operatorUserId: string, now: Date = new Date()): Promise<void> {
  await prisma.quiescenceRun.updateMany({
    where: { runId, abortRequestedAt: null, status: { notIn: [...TERMINAL_QUIESCENCE_STATUSES] } },
    data: { abortRequestedAt: now, abortRequestedBy: operatorUserId },
  });
}

/**
 * One write per tick: the coordinator heartbeat plus the latest blocker
 * snapshot. getQuiescenceActivity reads `finalSnapshot ?? initialSnapshot`, so
 * the Self-Upgrade page shows live progress (which builds and phases are still
 * running) while the drain waits. The terminal transition overwrites it.
 */
export async function recordDrainProgress(
  runId: string,
  snapshot: ActiveSessionBlockers,
  now: Date = new Date(),
): Promise<void> {
  await prisma.quiescenceRun.update({
    where: { runId },
    data: { lastHeartbeatAt: now, finalSnapshot: snapshot as unknown as object },
  });
}

/**
 * Wake a waiting coordinator with an operator decision. Best-effort: the
 * decision that matters is already durable (Force writes shipForceEscalatedAt,
 * Keep waiting writes budgetMs) and the coordinator re-reads it on its next
 * check; the event only makes it act now rather than in up to a minute.
 */
export async function sendQuiescenceControl(
  runId: string,
  action: QuiescenceControlAction,
  operatorUserId: string,
): Promise<void> {
  try {
    const { jobs } = await import("@/lib/jobs");
    await jobs.send({ name: QUIESCENCE_CONTROL_EVENT, data: { runId, action, operatorUserId } });
  } catch (err) {
    // runId and action arrive from the operator's request, so they stay out of
    // the log line (CodeQL js/log-injection, alert 426); the decision itself is
    // already durable on the run row.
    console.warn("[quiescence] operator control event not sent; the coordinator applies it on its next check: %s", sanitizeForLog(getErrorMessage(err)));
  }
}

/**
 * Keep waiting: move the drain's bound to `now + extendMs` (never shorter than
 * it already is) and wake the coordinator, which returns from
 * awaiting-operator to draining. Admission stays closed throughout.
 */
export async function extendQuiescenceWait(
  runId: string,
  operatorUserId: string,
  opts: { extendMs?: number; now?: Date } = {},
): Promise<ActionResult<{ budgetMs: number }>> {
  const now = opts.now ?? new Date();
  const extendMs = opts.extendMs ?? DEFAULT_DRAIN_WAIT_BUDGET_MS;
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { status: true, budgetMs: true, startedAt: true, enteredStateAt: true },
  });
  if (!row) return err("run not found");
  if (!isDrainWaitingStatus(row.status)) return err(`run is ${row.status}, not waiting`);
  const entered = (row.enteredStateAt as unknown as EnteredStateAt | null) ?? {};
  const drainStart = entered.draining ? new Date(entered.draining) : row.startedAt;
  const budgetMs = Math.max(row.budgetMs, now.getTime() - drainStart.getTime() + extendMs);
  await prisma.quiescenceRun.update({ where: { runId }, data: { budgetMs } });
  await sendQuiescenceControl(runId, "keep-waiting", operatorUserId);
  return ok({ budgetMs });
}

export type DrainWaiting = { waiting: true; status: string; lastHeartbeatAt?: string | null };

/**
 * One read of a drain's outcome: ready-to-swap or a terminal state, or
 * `{ waiting: true }` while it is still waiting for work (including
 * awaiting-operator). Shared by awaitQuiescenceReady and the stepped
 * self-upgrade job.
 */
export async function readQuiescenceOutcome(runId: string): Promise<QuiescenceOutcome | DrainWaiting> {
  const row = await prisma.quiescenceRun.findUnique({
    where: { runId },
    select: { status: true, finalSnapshot: true, deferSurface: true, outcomeNotes: true, lastHeartbeatAt: true },
  });
  if (!row) return { ok: false, outcome: "failed", runId, reason: "QuiescenceRun row disappeared" };
  if (row.status === "ready-to-swap") {
    return {
      ok: true,
      outcome: "ready-to-swap",
      runId,
      finalSnapshot: (row.finalSnapshot as unknown as ActiveSessionBlockers) ?? null!,
    };
  }
  if (row.status === "deferred") {
    return {
      ok: false,
      outcome: "deferred",
      runId,
      deferSurface: row.deferSurface,
      finalSnapshot: (row.finalSnapshot as unknown as ActiveSessionBlockers | null) ?? null,
    };
  }
  if (row.status === "aborted" || row.status === "failed") {
    return { ok: false, outcome: row.status, runId, reason: row.outcomeNotes ?? `Quiescence ${row.status}` };
  }
  if (row.status === "completed" || row.status === "swapping") {
    // Caller didn't observe ready-to-swap (e.g., another caller raced).
    // Surface as failed so caller doesn't double-swap.
    return { ok: false, outcome: "failed", runId, reason: `Coordinator already ${row.status}` };
  }
  return { waiting: true, status: row.status, lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null };
}

/**
 * Polls a drain until it reaches ready-to-swap or a terminal state.
 *
 * - `followDrain` (the self-upgrade trigger, BI-F9EE05E5): there is no fixed
 *   ceiling. The bound moves (Keep waiting) and awaiting-operator is still
 *   waiting, so this returns only on an outcome, or `failed` when the
 *   coordinator stops heartbeating.
 * - Otherwise (teardown, manual maintenance): the original `budgetMs + 60s`
 *   ceiling, because those callers wait inside a request.
 */
export async function awaitQuiescenceReady(
  runId: string,
  opts: { budgetMs: number; followDrain: boolean; pollMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<QuiescenceOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + opts.budgetMs + 60_000;
  while (opts.followDrain || Date.now() < deadline) {
    const out = await readQuiescenceOutcome(runId);
    if (!("waiting" in out)) return out;
    const beat = out.lastHeartbeatAt ? new Date(out.lastHeartbeatAt) : null;
    if (opts.followDrain && beat && !isDrainHeartbeatLive({ lastHeartbeatAt: beat, now: new Date(), thresholdMs: COORDINATOR_SILENT_MS })) {
      return { ok: false, outcome: "failed", runId, reason: `coordinator stopped heartbeating (last ${out.lastHeartbeatAt})` };
    }
    await sleep(pollMs);
  }
  return { ok: false, outcome: "failed", runId, reason: "awaitReady outer timeout" };
}

/**
 * The self-upgrade runs (by SelfUpgradeRun.runId, the drain's triggerRefId)
 * whose drain is still live. The periodic self-upgrade reconciler
 * (instrumentation.ts) skips these: a run that has waited 30+ minutes for work
 * is waiting, not stuck. Live means non-terminal and either heartbeating, or in
 * the swap window (ready-to-swap / swapping, entered within SWAP_WINDOW_MS):
 * the coordinator stops heartbeating there by design, so that phase is keyed
 * on status, as the stuck-coordinator reaper already does. Fails open to an
 * empty set (the reconciler's prior behaviour) on a read error.
 */
export async function selfUpgradeRunsWithLiveDrain(
  runIds: string[],
  now: Date,
  staleAfterMs: number,
): Promise<Set<string>> {
  if (runIds.length === 0) return new Set();
  try {
    const rows = await prisma.quiescenceRun.findMany({
      where: { triggerRefId: { in: runIds }, status: { notIn: [...TERMINAL_QUIESCENCE_STATUSES] } },
      select: { triggerRefId: true, status: true, lastHeartbeatAt: true, enteredStateAt: true },
    });
    const inSwapWindow = (r: (typeof rows)[number]) => {
      const readyAt = ((r.enteredStateAt as unknown as EnteredStateAt | null) ?? {})["ready-to-swap"];
      return (r.status === "ready-to-swap" || r.status === "swapping") && !!readyAt && !isStale(now, new Date(readyAt), SWAP_WINDOW_MS);
    };
    const live = rows.filter(
      (r) => isDrainHeartbeatLive({ lastHeartbeatAt: r.lastHeartbeatAt, now, thresholdMs: staleAfterMs }) || inSwapWindow(r),
    );
    return new Set(live.map((r) => r.triggerRefId).filter((id): id is string => !!id));
  } catch (err) {
    console.warn(sanitizeForLog(`[self-upgrade-reconcile] live-drain check failed (non-fatal): ${getErrorMessage(err)}`));
    return new Set();
  }
}
