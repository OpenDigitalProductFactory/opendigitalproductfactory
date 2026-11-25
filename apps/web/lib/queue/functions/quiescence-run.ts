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
 *   2. enter-draining + flip-level (admission closes) + broadcast
 *   3. wait loop: one check step per tick (re-snapshot, persist live progress,
 *      heartbeat, re-read the moving bound and the force flag), then sleep on
 *      the operator-control event (abort / keep-waiting / force) with a timeout
 *   4. either ready-to-swap (TaskRuns flipped to quiescing only now, then await
 *      the caller's swap-complete event)
 *      OR, for an upgrade, awaiting-operator at the bound (level stays draining)
 *      until the operator chooses or the work clears (spec §11a, BI-F9EE05E5)
 *      OR deferred at the bound (other triggers: teardown, manual)
 *      OR aborted/failed (operator event or coordinator crash)
 *   5. emit platform.quiescence-cleared (CRITICAL — every terminal path)
 *
 * Resumable on worker restart via Inngest step checkpointing.
 * Single-flight via concurrency: { limit: 1, scope: "fn" }.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §5.2 (state machine), §5.3 (this function), §5.7 (stuck-coordinator
 *   watchdog), §6.8 (drain order), §11a (an upgrade waits for work, BI-F9EE05E5).
 *
 * BI-QUIESCE-002.
 */
import { jobs } from "@/lib/jobs";
import {
  captureActiveSessionBlockers,
  flipActiveTaskRunsToQuiescing,
  invalidateQuiescenceCache,
  pickPrimaryBlocker,
  setQuiescenceLevel,
  transitionState,
  type ActiveSessionBlockers,
} from "@/lib/self-upgrade/quiescence";
import {
  isDrainWaitingStatus,
  QUIESCENCE_CONTROL_EVENT,
  QUIESCENCE_READY_EVENT,
  readDrainControl,
  recordDrainProgress,
} from "@/lib/self-upgrade/drain-wait";
import { reassertDrainingLevel } from "@/lib/self-upgrade/drain-admission";
import { enterReadyToSwap } from "@/lib/self-upgrade/ready-to-swap-state";
import { readyToSwapBudgetMs, readyToSwapDeadline } from "@/lib/self-upgrade/ready-to-swap-window";
import { isRecord } from "@/lib/shared/coerce";

export const QUIESCENCE_RUN_FUNCTION_ID = "ops/quiescence-run";
export const QUIESCENCE_START_EVENT = "ops/quiescence.start";
export const QUIESCENCE_SWAP_COMPLETE_EVENT = "ops/quiescence.swap-complete";

export const QUIESCENCE_CLEARED_EVENT = "platform.quiescence-cleared";

// Wait-loop check cadence (BI-F9EE05E5). Between checks the coordinator sleeps
// on the operator-control event, so Abort / Keep waiting / Force act at once and
// a 60-minute wait costs ~180 checks, not ~720 five-second sleeps. Each check is
// two steps (check + wait); the job engine caps steps per run (Inngest: 1000),
// so MAX_WAIT_CHECKS bounds the whole wait under that cap. Both timeouts stay
// well inside the 2-minute stuck-coordinator reaper (taskrun-watchdog.ts).
const DRAIN_CHECK_TIMEOUT = "20s";
const AWAITING_OPERATOR_CHECK_TIMEOUT = "60s";
// Other triggers (teardown, manual) keep their short, bounded drain.
const BOUNDED_DRAIN_CHECK_TIMEOUT = "5s";
// 180 checks at 20s fill the default hour; the remaining ~260 at 60s give the
// operator about 4 more hours before the coordinator gives up and reopens.
export const MAX_WAIT_CHECKS = 440;

type DrainCheck = {
  /** Operator who pressed Abort (durable marker), when set. */
  abortedBy: string | null;
  pastBound: boolean;
  hardBlockers: number;
  primaryBlocker: string | null;
  status: string;
  now: number;
  deadlineAt: number;
  drainStartedAt: number;
};

export const quiescenceRun = jobs.createFunction(
  {
    id: QUIESCENCE_RUN_FUNCTION_ID,
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: QUIESCENCE_START_EVENT }],
    // Coordinator timeout is enforced externally by the watchdog
    // (BI-QUIESCE-007) reading QuiescenceRun.lastHeartbeatAt. step.waitForEvent
    // times out the swap-complete handshake at the persisted ready deadline.
  },
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    const budgetMs = (event.data.budgetMs as number) ?? 5 * 60 * 1000;
    const triggerRefId = (event.data.triggerRefId as string | null) ?? null;
    const shipForce = !!event.data.shipForce;
    // BI-F9EE05E5: the self-upgrade trigger waits for work and pauses for the
    // operator at the bound instead of deferring (spec §11a, decision 7).
    const awaitOperator = !!event.data.awaitOperatorAtBudget;

    // ─── Step 1: initial snapshot + preparing transition ─────────────────

    // Recency window for the soft tool-execution signal: other triggers use
    // their (minutes-long) budget as before; an hour-long upgrade budget must not
    // turn an hour of past clicks into "activity", so it uses the default.
    const snapshotOpts = awaitOperator ? undefined : { thresholdMs: budgetMs };
    const initialSnapshot = (await step.run("snapshot-initial", () =>
      captureActiveSessionBlockers(snapshotOpts),
    )) as ActiveSessionBlockers;

    await step.run("enter-preparing", () =>
      transitionState(runId, "preparing", { initialSnapshot }),
    );

    // ─── Step 2: enter draining — close admission, broadcast ─────────────

    await step.run("enter-draining", () => transitionState(runId, "draining"));
    await step.run("flip-level-draining", () => setQuiescenceLevel("draining", runId));

    await step.run("broadcast-quiescence-draining", async () => {
      const { agentEventBus } = await import("@/lib/tak/agent-event-bus");
      agentEventBus.broadcastSystem({
        type: "system:quiescence",
        level: "draining",
        runId,
        swapEtaSeconds: Math.floor(budgetMs / 1000),
        deferReason: null,
        deferSurface: null,
        outcome: "draining",
      });
      return { broadcast: "draining", runId };
    });

    // Other triggers stop coworker loops at drain start, as before. An upgrade
    // does not: in-flight work runs to completion (spec §11a item 1), and the
    // flip happens only once the hard blockers reach zero, or on force.
    const flippedCount = awaitOperator
      ? 0
      : ((await step.run("flip-taskruns-quiescing", () => flipActiveTaskRunsToQuiescing())) as number);

    // ─── Step 3: wait loop ───────────────────────────────────────────────

    // BI-F9EE05E5: every check re-reads the row, so the bound follows Keep
    // waiting (drainStart + current budgetMs) and a mid-flight Force now
    // (BI-4F3B2FA9, shipForceEscalatedAt) is honoured within one check. All
    // clock reads happen inside steps so a replay sees the recorded values.
    let check: DrainCheck | null = null;
    let end: "ready" | "deferred" | "aborted" | "exhausted" = "exhausted";
    let abortedBy = "unknown";

    for (let tick = 0; tick < MAX_WAIT_CHECKS; tick++) {
      check = (await step.run(`drain-check-${tick}`, async () => {
        const control = await readDrainControl(runId);
        // This coordinator is alive and its drain is waiting: admission must be
        // closed. A portal restart mid-drain resets the level on boot; close it
        // again within one check (BI-F9EE05E5).
        if (control && isDrainWaitingStatus(control.status)) {
          await reassertDrainingLevel(runId);
        }
        const snapshot = await captureActiveSessionBlockers(snapshotOpts);
        const now = Date.now();
        await recordDrainProgress(runId, snapshot, new Date(now));
        const drainStartedAt = control ? Date.parse(control.drainStartedAt) : now;
        const deadlineAt = drainStartedAt + (control?.budgetMs ?? budgetMs);
        const hardBlockers = countEffectiveHardBlockers(snapshot, shipForce || !!control?.forced);
        let status = control?.status ?? "draining";
        // At the bound an upgrade pauses for the operator (level stays
        // draining); after Keep waiting moves the bound it returns to draining.
        // Done here, not in a step of its own, so Keep waiting costs no steps
        // against the engine's per-run cap.
        if (awaitOperator && hardBlockers > 0 && !control?.abortRequestedBy) {
          const want = now >= deadlineAt ? "awaiting-operator" : "draining";
          if (status !== want) {
            await transitionState(runId, want);
            status = want;
          }
        }
        return {
          abortedBy: control?.abortRequestedBy ?? null,
          pastBound: now >= deadlineAt,
          hardBlockers,
          primaryBlocker: pickPrimaryBlocker(snapshot),
          status,
          now,
          deadlineAt,
          drainStartedAt,
        };
      })) as DrainCheck;

      // A durable Abort wins over everything, even blockers that just cleared:
      // the operator's event may have been dropped while this check ran.
      if (check.abortedBy) {
        end = "aborted";
        abortedBy = check.abortedBy;
        break;
      }
      if (check.hardBlockers === 0) {
        end = "ready";
        break;
      }
      const pastBound = check.pastBound;
      if (pastBound && !awaitOperator) {
        end = "deferred";
        break;
      }

      const control = await step.waitForEvent(`drain-control-${tick}`, {
        event: QUIESCENCE_CONTROL_EVENT,
        timeout: !awaitOperator
          ? BOUNDED_DRAIN_CHECK_TIMEOUT
          : pastBound
            ? AWAITING_OPERATOR_CHECK_TIMEOUT
            : DRAIN_CHECK_TIMEOUT,
        if: `async.data.runId == "${runId}"`,
      });
      if (control?.data.action === "abort") {
        end = "aborted";
        abortedBy = (control.data.operatorUserId as string | undefined) ?? "unknown";
        break;
      }
      // keep-waiting / force: the decision is already on the row; the next
      // check reads it.
    }

    const actualWaitMs = check ? check.now - check.drainStartedAt : 0;

    // ─── Step 4a: operator abort mid-drain (BI-F9EE05E5) ─────────────────

    if (end === "aborted") {
      await step.run("enter-aborted-draining", () =>
        transitionState(runId, "aborted", {
          outcome: "aborted-by-operator",
          completionSource: "caller",
          outcomeNotes: `Aborted by operator ${abortedBy} while waiting for in-flight work; admission reopened`,
          completedAt: new Date(),
          actualWaitMs,
        }),
      );
      await step.run("flip-level-normal-abort-draining", () => setQuiescenceLevel("normal", null, new Date(), runId));
      await step.run("emit-cleared-aborted-draining", () =>
        emitCleared({ runId, outcome: "aborted", triggerRefId, reason: abortedBy }),
      );
      return { ok: false, outcome: "aborted", runId };
    }

    // ─── Step 4b: wait-step ceiling reached — reopen admission ───────────

    if (end === "exhausted") {
      await step.run("enter-failed-exhausted", () =>
        transitionState(runId, "failed", {
          outcome: "failed",
          completionSource: "caller",
          outcomeNotes: `Still waiting for in-flight work after ${MAX_WAIT_CHECKS} checks with no operator decision; admission reopened`,
          completedAt: new Date(),
          actualWaitMs,
        }),
      );
      await step.run("flip-level-normal-exhausted", () => setQuiescenceLevel("normal", null, new Date(), runId));
      await step.run("emit-cleared-failed-exhausted", () =>
        emitCleared({ runId, outcome: "failed", triggerRefId, reason: "wait-exhausted" }),
      );
      return { ok: false, outcome: "failed", reason: "wait-exhausted", runId };
    }

    // ─── Step 4c: defer path (other triggers only) ───────────────────────

    if (end === "deferred") {
      const blockingSurface = check?.primaryBlocker ?? null;
      await step.run("enter-deferred", () =>
        transitionState(runId, "deferred", {
          deferReason: `Hard blocker exceeded ${budgetMs}ms budget`,
          deferSurface: blockingSurface ?? "unknown",
          outcome: "deferred-by-surface",
          completionSource: "caller",
          completedAt: new Date(),
          actualWaitMs,
        }),
      );
      await step.run("flip-level-normal-defer", () => setQuiescenceLevel("normal", null, new Date(), runId));
      await step.run("emit-cleared-deferred", () =>
        emitCleared({ runId, outcome: "deferred", triggerRefId, deferSurface: blockingSurface }),
      );
      return { ok: false, outcome: "deferred", deferSurface: blockingSurface, runId, flippedCount };
    }

    // Blockers are clear (or forced through): only now stop the coworker loops
    // so the swap does not cut one mid-iteration (BI-F9EE05E5).
    if (awaitOperator) {
      await step.run("flip-taskruns-quiescing", () => flipActiveTaskRunsToQuiescing());
    }

    // ─── Step 4d: ready-to-swap — await caller signal ────────────────────

    // The latest snapshot is already on finalSnapshot (persisted each check).
    const checkpoint: unknown = await step.run("enter-ready-to-swap", () => enterReadyToSwap(runId, triggerRefId, actualWaitMs));
    const ready = isRecord(checkpoint) ? checkpoint : {};
    if (ready.kind === "aborted") {
      const operator = typeof ready.operator === "string" ? ready.operator : "unknown";
      await step.run("enter-aborted-before-ready", () => transitionState(runId, "aborted", {
        outcome: "aborted-by-operator", completionSource: "caller", completedAt: new Date(),
      }));
      await step.run("clear-aborted-before-ready", () => setQuiescenceLevel("normal", null, new Date(), runId));
      await step.run("emit-aborted-before-ready", () => emitCleared({ runId, outcome: "aborted", triggerRefId, reason: operator }));
      return { ok: false, outcome: "aborted", runId };
    }
    // An older deployment may already have checkpointed this step. Anchor
    // legacy time to its original transition, never to a replay's wall clock.
    const legacy = ready.kind === undefined && ready.status === "ready-to-swap";
    const expiresAt = readyToSwapDeadline({
      readyToSwapDeadlineAt: ready.kind === "ready" && typeof ready.deadline === "string" ? new Date(ready.deadline) : null,
      enteredStateAt: legacy ? ready.enteredStateAt : null,
    }, legacy && !awaitOperator ? readyToSwapBudgetMs("unrelated") : undefined);
    const failAndClear = async (reason: "no-signal" | "invalid-ready-deadline", notes: string) => {
      await step.run(`enter-failed-${reason}`, () => transitionState(runId, "failed", {
        outcome: "failed", completionSource: "caller", outcomeNotes: notes, completedAt: new Date(),
      }));
      await step.run(`flip-level-normal-${reason}`, () => setQuiescenceLevel("normal", null, new Date(), runId));
      await step.run(`emit-cleared-failed-${reason}`, () => emitCleared({ runId, outcome: "failed", triggerRefId, reason }));
      return { ok: false, outcome: "failed", reason, runId } as const;
    };
    if (!expiresAt) return failAndClear("invalid-ready-deadline", "Ready checkpoint has no trustworthy swap deadline");
    const deadline = expiresAt.toISOString();
    if (ready.kind === "ready" && ready.trigger === "self-upgrade") {
      await step.run("broadcast-ready-deadline", async () => {
        const { agentEventBus } = await import("@/lib/tak/agent-event-bus");
        agentEventBus.broadcastSystem({
          type: "system:quiescence", level: "draining", runId, swapEtaSeconds: null,
          deferReason: null, deferSurface: null, outcome: "draining", readyToSwapDeadlineAt: deadline,
        });
      });
    }
    // Wake the waiting self-upgrade job now rather than on its next poll.
    await step.run("announce-ready-to-swap", () =>
      jobs.send({ name: QUIESCENCE_READY_EVENT, data: { runId, triggerRefId } }),
    );

    const swap = await step.waitForEvent("await-swap-complete", {
      event: QUIESCENCE_SWAP_COMPLETE_EVENT,
      timeout: expiresAt,
      if: `async.data.runId == "${runId}"`,
    });

    if (!swap) {
      // Caller never signaled — coordinator must abandon. Force level back
      // to normal so the system isn't permanently drained.
      return failAndClear("no-signal", `swap-complete signal never received by ${deadline}`);
    }

    // ─── Step 4e: caller signaled — branch on outcome ────────────────────

    const callerOutcome = (swap.data.outcome as string) ?? "succeeded";

    if (callerOutcome === "succeeded") {
      const now = new Date();
      await step.run("enter-swapping", () =>
        transitionState(runId, "swapping", { swapStartedAt: now }),
      );
      await step.run("flip-level-swapping", () => setQuiescenceLevel("swapping", runId));
      await step.run("broadcast-quiescence-swapping", async () => {
        const { agentEventBus } = await import("@/lib/tak/agent-event-bus");
        agentEventBus.broadcastSystem({
          type: "system:quiescence",
          level: "swapping",
          runId,
          swapEtaSeconds: 30,
          deferReason: null,
          deferSurface: null,
          outcome: "swapping",
          ...(ready.kind === "ready" && ready.trigger === "self-upgrade" ? { readyToSwapDeadlineAt: deadline } : {}),
        });
        return { broadcast: "swapping", runId };
      });

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
      await step.run("flip-level-normal-success", () => setQuiescenceLevel("normal", null, new Date(), runId));
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
      await step.run("flip-level-normal-abort", () => setQuiescenceLevel("normal", null, new Date(), runId));
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
    await step.run("flip-level-normal-fail", () => setQuiescenceLevel("normal", null, new Date(), runId));
    await step.run("emit-cleared-failed-swap", () =>
      emitCleared({ runId, outcome: "failed", triggerRefId, reason }),
    );
    return { ok: false, outcome: "failed", reason, runId };
  },
);

/**
 * Effective hard-blocker count, applying the shipForce override.
 *
 * `shipForce` is the operator EMERGENCY OVERRIDE (the `force` flag on a manual
 * self-upgrade). It means "swap now regardless of in-flight work" — so it
 * bypasses ALL hard blockers, letting the drain reach ready-to-swap
 * immediately. The override is audit-recorded on QuiescenceRun.forcedSurfaces
 * by the caller, and the scheduled cron NEVER sets it. Without this, a single
 * stale/orphaned surface (e.g. a build phase left in-flight by a previously
 * dead queue) would defer every forced upgrade forever.
 *
 * Without shipForce, every hard blocker still counts and the drain waits or
 * defers as normal.
 */
function countEffectiveHardBlockers(
  snapshot: ActiveSessionBlockers | null,
  shipForce: boolean,
): number {
  if (!snapshot) return 0;
  if (shipForce) return 0;
  return snapshot.surfaces.filter((s) => s.kind === "hard").length;
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

  // SSE broadcast to ALL connected clients FIRST so banners dismiss
  // immediately. Then the Inngest event so suspended functions wake.
  // Both are required (spec §5.2 invariant — every terminal path must
  // emit platform.quiescence-cleared, AND clients must see the banner
  // dismiss without waiting on Inngest event propagation).
  try {
    const { agentEventBus } = await import("@/lib/tak/agent-event-bus");
    agentEventBus.broadcastSystem({
      type: "system:quiescence",
      level: "cleared",
      runId: payload.runId,
      swapEtaSeconds: null,
      deferReason: payload.outcome === "deferred" ? (payload.reason ?? null) : null,
      deferSurface: payload.deferSurface ?? null,
      outcome: payload.outcome,
    });
  } catch (err) {
    // Best-effort — the Inngest event below is the authoritative signal.
    console.warn("[quiescence-run] broadcastSystem failed:", err);
  }

  await jobs.send({
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
