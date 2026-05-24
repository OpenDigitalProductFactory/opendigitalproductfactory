/**
 * Activity Quiescence Protocol — coordinator Inngest function.
 *
 * Single function per active QuiescenceRun. Triggered by callers via
 * `ops/quiescence.start` event (sent from startQuiescence in
 * apps/web/lib/self-upgrade/quiescence.ts). Orchestrates the
 * pending → preparing → draining → ready-to-swap → swapping → completed
 * state machine, capturing ActiveSessionBlockers evidence at each transition
 * and emitting the load-bearing `platform.quiescence-cleared` event on
 * every terminal transition.
 *
 * Sequencing inside the function (drain order from spec §4.5 / §6.8):
 *   1. snapshot-initial — capture surfaces before flipping level
 *   2. enter-draining + flip-level + broadcast + flip-taskruns-to-quiescing
 *   3. wait loop with re-snapshot every 5s up to budget
 *   4. either ready-to-swap (await caller swap-complete event)
 *      OR deferred (hard blocker exceeded budget)
 *      OR aborted/failed (caller event or coordinator crash)
 *   5. emit platform.quiescence-cleared (CRITICAL — every terminal path)
 *
 * Resumable on worker restart via Inngest step checkpointing.
 * Single-flight via concurrency: { limit: 1, scope: "fn" }.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §5.2 (state machine), §5.3 (this function), §5.7 (timeout = 60min — see comment),
 *   §6.8 (drain order).
 *
 * BI-QUIESCE-002.
 */
import { inngest } from "../inngest-client";
import {
  captureActiveSessionBlockers,
  flipActiveTaskRunsToQuiescing,
  heartbeatQuiescenceRun,
  invalidateQuiescenceCache,
  pickPrimaryBlocker,
  setQuiescenceLevel,
  transitionState,
  type ActiveSessionBlockers,
} from "@/lib/self-upgrade/quiescence";

export const QUIESCENCE_RUN_FUNCTION_ID = "ops/quiescence-run";
export const QUIESCENCE_START_EVENT = "ops/quiescence.start";
export const QUIESCENCE_SWAP_COMPLETE_EVENT = "ops/quiescence.swap-complete";
export const QUIESCENCE_CLEARED_EVENT = "platform.quiescence-cleared";

// Per spec §5.7: 60 minutes — gives 2× headroom over the longest legitimate
// single-surface wait (build-phase budget = 30 min). At 30 min coordinator
// timeout the watchdog would race a legitimate completion of a long build
// and flip level back to normal mid-wait, causing awaitReady to return
// failed even when nothing is wrong. 60min absorbs that.
const COORDINATOR_TIMEOUT_MS = 60 * 60 * 1000;

// Wait-loop tick interval. 5s is fast enough that ready-to-swap fires
// within 5s of the last blocker clearing; cheap enough that even hundreds
// of ticks don't impact DB.
const WAIT_TICK_MS = 5_000;

export const quiescenceRun = inngest.createFunction(
  {
    id: QUIESCENCE_RUN_FUNCTION_ID,
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: QUIESCENCE_START_EVENT }],
    // Coordinator timeout is enforced externally by the watchdog
    // (BI-QUIESCE-007) reading QuiescenceRun.lastHeartbeatAt. step.waitForEvent
    // adds its own 10m timeout on the swap-complete handshake; if the caller
    // never signals, the function exits via the no-signal failure path.
  },
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    const budgetMs = (event.data.budgetMs as number) ?? 5 * 60 * 1000;
    const triggerRefId = (event.data.triggerRefId as string | null) ?? null;
    const shipForce = !!event.data.shipForce;

    // ─── Step 1: initial snapshot + preparing transition ─────────────────

    const initialSnapshot = (await step.run("snapshot-initial", () =>
      captureActiveSessionBlockers({ thresholdMs: budgetMs }),
    )) as ActiveSessionBlockers;

    await step.run("enter-preparing", () =>
      transitionState(runId, "preparing", { initialSnapshot }),
    );

    // ─── Step 2: enter draining — flip level, broadcast, flip TaskRuns ──

    await step.run("enter-draining", () => transitionState(runId, "draining"));
    await step.run("flip-level-draining", () => setQuiescenceLevel("draining", runId));

    // BI-QUIESCE-006 wires the real SSE broadcast via agentEventBus.
    // For now this is a recorded no-op — the coordinator's level flip is
    // the authoritative signal; client banner consumes it via the state
    // route which BI-QUIESCE-003 implements.
    await step.run("broadcast-quiescence-draining", async () => {
      return { broadcast: "deferred-to-bi-quiesce-006", runId, level: "draining" };
    });

    const flippedCount = (await step.run("flip-taskruns-quiescing", () =>
      flipActiveTaskRunsToQuiescing(),
    )) as number;

    // ─── Step 3: wait loop with re-snapshot ──────────────────────────────

    const drainStart = Date.now();
    const deadline = drainStart + budgetMs;
    let lastSnapshot: ActiveSessionBlockers | null = initialSnapshot;

    // Bounded outer iteration count — defensive against runaway loops
    // even with a sane deadline.
    const maxTicks = Math.ceil(budgetMs / WAIT_TICK_MS) + 5;

    for (let tick = 0; tick < maxTicks; tick++) {
      // Re-check the hard-blocker count from the prior snapshot before
      // sleeping. Lets the first tick exit fast in the no-blockers case.
      const hardBlockers = countEffectiveHardBlockers(lastSnapshot, shipForce);
      if (hardBlockers === 0) break;
      if (Date.now() >= deadline) break;

      await step.sleep(`drain-tick-${tick}`, `${Math.floor(WAIT_TICK_MS / 1000)}s`);

      lastSnapshot = (await step.run(`snapshot-tick-${tick}`, () =>
        captureActiveSessionBlockers({ thresholdMs: budgetMs }),
      )) as ActiveSessionBlockers;

      await step.run(`heartbeat-${tick}`, () => heartbeatQuiescenceRun(runId));
    }

    const finalHardBlockers = countEffectiveHardBlockers(lastSnapshot, shipForce);
    const actualWaitMs = Date.now() - drainStart;

    // ─── Step 4a: defer path ─────────────────────────────────────────────

    if (finalHardBlockers > 0) {
      const blockingSurface = pickPrimaryBlocker(lastSnapshot);
      await step.run("enter-deferred", () =>
        transitionState(runId, "deferred", {
          finalSnapshot: lastSnapshot,
          deferReason: `Hard blocker exceeded ${budgetMs}ms budget`,
          deferSurface: blockingSurface ?? "unknown",
          outcome: "deferred-by-surface",
          completionSource: "caller",
          completedAt: new Date(),
          actualWaitMs,
        }),
      );
      await step.run("flip-level-normal-defer", () => setQuiescenceLevel("normal", null));
      await step.run("emit-cleared-deferred", () =>
        emitCleared({ runId, outcome: "deferred", triggerRefId, deferSurface: blockingSurface }),
      );
      return { ok: false, outcome: "deferred", deferSurface: blockingSurface, runId, flippedCount };
    }

    // ─── Step 4b: ready-to-swap — await caller signal ────────────────────

    await step.run("enter-ready-to-swap", () =>
      transitionState(runId, "ready-to-swap", {
        finalSnapshot: lastSnapshot,
        actualWaitMs,
      }),
    );

    const swap = await step.waitForEvent("await-swap-complete", {
      event: QUIESCENCE_SWAP_COMPLETE_EVENT,
      timeout: "10m",
      if: `async.data.runId == "${runId}"`,
    });

    if (!swap) {
      // Caller never signaled — coordinator must abandon. Force level back
      // to normal so the system isn't permanently drained.
      await step.run("enter-failed-no-signal", () =>
        transitionState(runId, "failed", {
          outcome: "failed",
          completionSource: "caller",
          outcomeNotes: "swap-complete signal never received within 10m",
          completedAt: new Date(),
        }),
      );
      await step.run("flip-level-normal-no-signal", () => setQuiescenceLevel("normal", null));
      await step.run("emit-cleared-failed-no-signal", () =>
        emitCleared({ runId, outcome: "failed", triggerRefId, reason: "no-signal" }),
      );
      return { ok: false, outcome: "failed", reason: "no-signal", runId };
    }

    // ─── Step 4c: caller signaled — branch on outcome ────────────────────

    const callerOutcome = (swap.data.outcome as string) ?? "succeeded";

    if (callerOutcome === "succeeded") {
      const now = new Date();
      await step.run("enter-swapping", () =>
        transitionState(runId, "swapping", { swapStartedAt: now }),
      );
      await step.run("flip-level-swapping", () => setQuiescenceLevel("swapping", runId));

      // Caller already did the swap by now; coordinator just records the
      // terminal transition. The 'swapping' state is intentionally brief —
      // it exists for audit clarity rather than for waiting.
      await step.run("enter-completed", () =>
        transitionState(runId, "completed", {
          swapCompletedAt: now,
          completedAt: now,
          outcome: "succeeded",
          completionSource: "caller",
        }),
      );
      await step.run("flip-level-normal-success", () => setQuiescenceLevel("normal", null));
      await step.run("emit-cleared-success", () =>
        emitCleared({ runId, outcome: "succeeded", triggerRefId }),
      );
      return { ok: true, outcome: "succeeded", runId };
    }

    if (callerOutcome === "aborted") {
      const operatorUserId = (swap.data.operatorUserId as string | undefined) ?? "unknown";
      await step.run("enter-aborted", () =>
        transitionState(runId, "aborted", {
          outcome: "aborted-by-operator",
          completionSource: "caller",
          outcomeNotes: `Aborted by operator ${operatorUserId}`,
          completedAt: new Date(),
        }),
      );
      await step.run("flip-level-normal-abort", () => setQuiescenceLevel("normal", null));
      await step.run("emit-cleared-aborted", () =>
        emitCleared({ runId, outcome: "aborted", triggerRefId, reason: operatorUserId }),
      );
      return { ok: false, outcome: "aborted", runId };
    }

    // callerOutcome === "failed" or anything else
    const reason = (swap.data.reason as string) ?? "swap-failed";
    await step.run("enter-failed-swap", () =>
      transitionState(runId, "failed", {
        outcome: "failed",
        completionSource: "caller",
        outcomeNotes: `Swap failed: ${reason}`,
        completedAt: new Date(),
      }),
    );
    await step.run("flip-level-normal-fail", () => setQuiescenceLevel("normal", null));
    await step.run("emit-cleared-failed-swap", () =>
      emitCleared({ runId, outcome: "failed", triggerRefId, reason }),
    );
    return { ok: false, outcome: "failed", reason, runId };
  },
);

/**
 * Effective hard-blocker count, applying the shipForce override.
 *
 * When `shipForce` is true, ship-phase BuildPhaseRun blockers are ignored
 * (recorded on QuiescenceRun.forcedSurfaces by the caller). All other hard
 * blockers still count.
 */
function countEffectiveHardBlockers(
  snapshot: ActiveSessionBlockers | null,
  shipForce: boolean,
): number {
  if (!snapshot) return 0;
  return snapshot.surfaces.filter((s) => {
    if (s.kind !== "hard") return false;
    if (shipForce && s.surface === "build-studio.phase.ship") return false;
    return true;
  }).length;
}

/**
 * Emit the load-bearing platform.quiescence-cleared event. Fires on EVERY
 * terminal transition (success, deferred, aborted, failed) so suspended
 * Inngest functions waiting on the event resume regardless of outcome.
 *
 * Without this guarantee, a coordinator failure path that forgets to emit
 * would wedge the entire queue forever.
 *
 * Synchronously invalidates the level cache so the calling process's own
 * subsequent reads see the post-flip level.
 */
async function emitCleared(payload: {
  runId: string;
  outcome: "succeeded" | "deferred" | "aborted" | "failed";
  triggerRefId: string | null;
  deferSurface?: string | null;
  reason?: string;
}): Promise<void> {
  invalidateQuiescenceCache();
  await inngest.send({
    name: QUIESCENCE_CLEARED_EVENT,
    data: {
      runId: payload.runId,
      outcome: payload.outcome,
      triggerRefId: payload.triggerRefId,
      deferSurface: payload.deferSurface ?? null,
      reason: payload.reason ?? null,
    },
  });
}
