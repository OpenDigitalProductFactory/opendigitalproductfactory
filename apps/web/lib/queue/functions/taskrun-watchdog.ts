/**
 * Build Studio Stall Detection watchdog cron (BI-4ab6be39 slices C3-C5).
 *
 * Fires every minute. Strategy: coarse-fetch in SQL using the SMALLEST
 * threshold across phases, then filter per-phase in app code — keeps the
 * threshold rows operator-editable at runtime without re-deploying SQL.
 *
 * For each detected stall, in one transaction per row:
 *   - TaskRun.status = "stalled", completedAt = now
 *   - StallEvent row written with reason + observed values + thresholds
 *   - BuildActivity row (when buildId present) so the Build Studio panel reflects it
 *   - Notification to the build owner (or platform admin fallback)
 *
 * After each successful tx, emits a "taskrun:stalled" AgentEvent so live UIs
 * update without polling.
 *
 * See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §5.7, §6.2.
 */
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import {
  decideStall,
  shouldSurfaceBuildFailure,
  type WatchdogCandidate,
  type StallDecision,
} from "@/lib/observability/watchdog-detect";
import { buildStallSurface, mergeVerificationPatch } from "@/lib/observability/stall-surface";
import { isStallWatchdogEnabled } from "@/lib/shared/feature-flags";
import { reapInertStuckBuilds } from "@/lib/build/inert-build-reaper";
import { TASK_LIVE_STATES } from "@/lib/tak/task-states";
import { newestSignal, isStale } from "@/lib/shared/staleness";
import { reap } from "@/lib/operate/reap";
import { Prisma } from "@dpf/db";

// QUIESCENCE EXEMPTION (BI-QUIESCE-004a + spec §6.1 extension): this
// function is intentionally NOT wrapped with gateAtEntry. The watchdog
// must keep running during quiescence drain because BI-QUIESCE-007
// extends it to also detect stuck quiescence coordinators (rows in
// status NOT IN terminal with stale lastHeartbeatAt). Gating the
// watchdog would prevent it from ever detecting that very condition,
// creating a deadlock: a crashed coordinator would never be reaped.
// Same rationale exempts selfUpgradeScheduled + selfUpgradeManual.

/**
 * BI-QUIESCE-007 (early-return fix, 2026-06-15): reap quiescence coordinators
 * whose heartbeat went stale. A coordinator that crashes mid-protocol leaves its
 * QuiescenceRun row non-terminal and the PlatformConfig.portal.quiescence level
 * stuck 'draining'/'swapping', which permanently gates the entire Inngest queue
 * (every gated cron skips; every gateBetweenSteps suspends). This forces the
 * level back to normal and emits platform.quiescence-cleared so suspended
 * functions wake up.
 *
 * Runs on EVERY watchdog tick. It previously lived inline AFTER the
 * `decisions.length === 0` early-return, so it almost never ran — a crashed
 * coordinator could hold the platform draining for days (root cause of the
 * 2026-06-14 Inngest outage, only cleared by a portal reboot).
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md §5.7
 */
export async function recoverStuckQuiescenceCoordinators(now: Date): Promise<number> {
  const { prisma } = await import("@dpf/db");
  const STUCK_COORDINATOR_TIMEOUT_MS = 2 * 60 * 1000;
  const stuckCutoff = new Date(now.getTime() - STUCK_COORDINATOR_TIMEOUT_MS);
  const stuckCoordinators = await prisma.quiescenceRun.findMany({
    where: {
      // Only reap coordinators wedged in a DRAIN phase (pending/preparing/
      // draining). Those heartbeat every wait-tick, so a >2min gap means the
      // coordinator crashed and is holding the platform draining — the exact
      // case this reaper exists for.
      //
      // Do NOT reap `ready-to-swap` or `swapping`: at ready-to-swap the
      // coordinator parks in `step.waitForEvent(swap-complete)` and stops
      // heartbeating BY DESIGN while the caller (runSelfUpgrade) takes the
      // recovery-point backup and runs the promoter — a docker build that
      // routinely exceeds 2 minutes in local mode. The 2-min heartbeat reaper
      // was therefore killing the coordinator mid-build on essentially every
      // local upgrade, flipping the level back to normal and wedging the run
      // with the swap half-done. These caller-owned states are already bounded
      // by the coordinator's own 60-min waitForEvent timeout and by the
      // promoter timeout + runSelfUpgrade's failure path (failQuiescenceSwap),
      // so a genuinely-crashed swap is still recovered — just not by this
      // aggressive short-window reaper. (BI-QUIESCE-READY-REAP)
      status: {
        notIn: ["ready-to-swap", "swapping", "completed", "deferred", "aborted", "failed"],
      },
      OR: [
        { lastHeartbeatAt: { lt: stuckCutoff } },
        { AND: [{ lastHeartbeatAt: null }, { startedAt: { lt: stuckCutoff } }] },
      ],
    },
    select: { runId: true, status: true, lastHeartbeatAt: true, startedAt: true },
    take: 10,
  });
  if (stuckCoordinators.length === 0) return 0;

  const { transitionState, setQuiescenceLevel } = await import(
    "@/lib/self-upgrade/quiescence"
  );
  let recovered = 0;
  for (const sc of stuckCoordinators) {
    try {
      await transitionState(sc.runId, "failed", {
        outcome: "failed",
        completionSource: "watchdog",
        outcomeNotes: `Watchdog reaped stuck coordinator (status=${sc.status}, lastHeartbeat=${sc.lastHeartbeatAt?.toISOString() ?? "never"})`,
        completedAt: now,
      });
      await setQuiescenceLevel("normal", null);
      await inngest.send({
        name: "platform.quiescence-cleared",
        data: {
          runId: sc.runId,
          outcome: "failed",
          triggerRefId: null,
          deferSurface: null,
          reason: "watchdog-reaped",
        },
      });
      recovered += 1;
      console.warn(
        `[taskrun-watchdog] quiescence-recovery: reaped stuck coordinator ${sc.runId} (was ${sc.status})`,
      );
    } catch (err) {
      console.warn(
        `[taskrun-watchdog] failed to reap quiescence coordinator ${sc.runId}:`,
        err,
      );
    }
  }
  return recovered;
}

/**
 * BI-8F45BA74 — recover orphaned `quiescing` TaskRuns (watchdog blind spot).
 *
 * On a self-upgrade drain, `flipActiveTaskRunsToQuiescing` flips every
 * working/active TaskRun to `quiescing`; each loop is then expected to
 * cooperatively exit to `paused-for-upgrade` on its NEXT heartbeat
 * (~30s typical, ~3min worst). A loop that is already DEAD never heartbeats
 * again, so its row is stranded in `quiescing` forever — silently-lost work
 * that no surface ever recovers:
 *   - the stall watchdog deliberately ignores `quiescing` (it expects a clean
 *     exit imminently — task-states.ts), so it never reaps these;
 *   - recoverStuckQuiescenceCoordinators reaps the coordinator (QuiescenceRun)
 *     but NOT the TaskRuns it flipped;
 *   - a portal reboot resumes builds but leaves these rows untouched
 *     (observed live 2026-06-19: 32 quiescing rows survived a swap+reboot).
 *
 * This reaps a `quiescing` row whose most-recent signal (quiescedAt, or its
 * heartbeat if it somehow beat after the flip) is older than the liveness
 * window — the loop is provably dead — transitioning it to `stalled` (the
 * watchdog's terminal-for-dead-work state: surfaced, operator-retryable, no
 * longer in limbo). The window matches DEAD_PHASE_LIVENESS_MS (15 min) and is
 * far longer than the worst-case cooperative-exit, so a loop that is merely
 * mid-exit is never reaped. Runs every tick before any early-return.
 */
export const STUCK_QUIESCING_TASKRUN_MS = 15 * 60 * 1000;

/**
 * Pure: true when a `quiescing` TaskRun's loop is provably dead (its newest
 * signal predates the liveness window). A row with no signal at all is left
 * alone — we never guess. Unit-tested.
 */
export function isStuckQuiescingTaskRun(args: {
  quiescedAt: Date | null;
  lastHeartbeatAt: Date | null;
  now: Date;
  thresholdMs: number;
}): boolean {
  const { quiescedAt, lastHeartbeatAt, now, thresholdMs } = args;
  const newest = newestSignal(quiescedAt, lastHeartbeatAt);
  if (newest === null) return false; // no observable signal — do not guess
  return isStale(now, newest, thresholdMs);
}

export async function recoverStuckQuiescingTaskRuns(now: Date): Promise<number> {
  const { prisma } = await import("@dpf/db");
  const cutoff = new Date(now.getTime() - STUCK_QUIESCING_TASKRUN_MS);

  // EP-8DC217EB BET-10: this reaper is the canonical fit for the shared reap()
  // skeleton — coarse indexed scan → pure per-candidate gate → per-row settle
  // with error isolation → count. Behavior is unchanged; only the control flow
  // is consolidated into lib/operations-run/reap.
  const { reaped: recovered } = await reap({
    // Coarse SQL filter (mirrors the stall-detection pattern: cheap WHERE, then
    // a precise pure check in app code). `quiescedAt` is set the instant the
    // row is flipped, so it is the primary signal; fall back to startedAt for
    // legacy rows.
    scan: () =>
      prisma.taskRun.findMany({
        where: {
          status: "quiescing",
          OR: [
            { quiescedAt: { lt: cutoff } },
            { AND: [{ quiescedAt: null }, { startedAt: { lt: cutoff } }] },
          ],
        },
        select: { taskRunId: true, quiescedAt: true, lastHeartbeatAt: true },
        take: 100,
      }),
    isReapable: (c) =>
      isStuckQuiescingTaskRun({
        quiescedAt: c.quiescedAt,
        lastHeartbeatAt: c.lastHeartbeatAt,
        now,
        thresholdMs: STUCK_QUIESCING_TASKRUN_MS,
      }),
    // Guard against a race: only transition if it is STILL quiescing.
    transition: async (c) => {
      const res = await prisma.taskRun.updateMany({
        where: { taskRunId: c.taskRunId, status: "quiescing" },
        data: { status: "stalled", completedAt: now },
      });
      return res.count;
    },
    onError: (c, err) =>
      console.warn(
        `[taskrun-watchdog] failed to recover orphaned quiescing TaskRun ${c.taskRunId}:`,
        err,
      ),
  });

  if (recovered > 0) {
    console.warn(
      `[taskrun-watchdog] recovered ${recovered} orphaned quiescing TaskRun(s) → stalled ` +
        `(loop died during a drain; never cooperatively exited). (BI-8F45BA74)`,
    );
  }
  return recovered;
}

export const taskrunWatchdog = inngest.createFunction(
  {
    id: "ops/taskrun-watchdog",
    retries: 0,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("* * * * *")],
  },
  async () => {
    // Reap crashed quiescence coordinators FIRST, on every tick — before any
    // early-return. This is platform-safety, not a stall-detection feature, so
    // it must run even when the stall watchdog is flag-off, no thresholds are
    // seeded, or no build is stalled. (It previously sat after all three of
    // those returns and so almost never ran — the 4-day Inngest outage.)
    const quiescenceRecovered = await recoverStuckQuiescenceCoordinators(new Date());

    // BI-8F45BA74: recover orphaned `quiescing` TaskRuns (dead loops that never
    // cooperatively exited a drain) every tick, before any early-return — they
    // are silently-lost work the stall watchdog deliberately ignores and a
    // reboot does not clear. Best-effort: a failure must never abort the tick.
    let quiescingTaskRunsRecovered = 0;
    try {
      quiescingTaskRunsRecovered = await recoverStuckQuiescingTaskRuns(new Date());
    } catch (err) {
      console.warn("[taskrun-watchdog] quiescing-taskrun recovery failed:", err);
    }

    // BI-8F45BA74: reap inert builds (0 activity, stuck non-terminal) every tick,
    // before any early-return — they jam the WIP cap and block all new builds, so
    // this must run even when the stall watchdog is flag-off or no thresholds are
    // seeded. Independent of stall detection (which keys off live TaskRuns).
    // Best-effort: a reaper error must never abort the tick (quiescence recovery
    // already ran above; stall detection still follows).
    let inertBuildsReaped = 0;
    try {
      inertBuildsReaped = await reapInertStuckBuilds(new Date());
    } catch (err) {
      console.warn("[taskrun-watchdog] inert-build reaper failed:", err);
    }

    // WS9 (BI-CBAAEA94): governed Workroom reaper — transition capsules whose
    // TRUE liveness is dead (lease expired, linked build terminal, or idle past
    // the floor) out of "working" so abandoned work stops reading as active and
    // jamming the WIP cap. GOVERNED: observe-only (dry-run) unless
    // DPF_WORKCAPSULE_REAPER_ENABLED=1, and live actuation only when additionally
    // DPF_WORKCAPSULE_REAPER_AUTO_REAP=1 (mirrors the runtime-artifact / worktree
    // janitors). Best-effort. DB-only (junction-safe: never touches worktrees).
    let workCapsulesReapCandidates = 0;
    let workCapsulesReaped = 0;
    try {
      const reaperEnabled = process.env.DPF_WORKCAPSULE_REAPER_ENABLED === "1";
      if (reaperEnabled) {
        const autoReap = process.env.DPF_WORKCAPSULE_REAPER_AUTO_REAP === "1";
        const { reapStaleWorkCapsules } = await import("@/lib/work-capsules/work-capsule-reaper");
        const { prisma: capsuleDb } = await import("@dpf/db");
        const result = await reapStaleWorkCapsules({
          db: capsuleDb as never,
          now: new Date(),
          dryRun: !autoReap,
        });
        workCapsulesReapCandidates = result.candidates.length;
        workCapsulesReaped = result.reaped;
        if (!autoReap && result.candidates.length > 0) {
          console.warn(
            `[work-capsule-reaper] observe-only: ${result.candidates.length} reap candidate(s) — ` +
              "set DPF_WORKCAPSULE_REAPER_AUTO_REAP=1 to actuate.",
          );
        }
      }
    } catch (err) {
      console.warn("[taskrun-watchdog] work-capsule reaper failed:", err);
    }

    // BI-B62B9F1E: release stale BacklogItem claims (dead sessions) so they do
    // not linger as "active" operator noise. Complements the atomic reclaim path.
    let staleBacklogClaimsReaped = 0;
    try {
      const { reapStaleBacklogClaims } = await import("@/lib/backlog/claim-on-start");
      const { prisma: claimDb } = await import("@dpf/db");
      staleBacklogClaimsReaped = (await reapStaleBacklogClaims({ db: claimDb })).reaped;
    } catch (err) {
      console.warn("[taskrun-watchdog] stale-backlog-claim reaper failed:", err);
    }

    if (!(await isStallWatchdogEnabled())) {
      return { skipped: true, reason: "flag-off", quiescenceRecovered, quiescingTaskRunsRecovered, inertBuildsReaped, workCapsulesReapCandidates, workCapsulesReaped, staleBacklogClaimsReaped };
    }

    const { prisma } = await import("@dpf/db");

    const thresholds = await prisma.buildStudioStallThreshold.findMany();
    if (thresholds.length === 0) {
      return { skipped: true, reason: "no-thresholds-seeded", quiescenceRecovered, quiescingTaskRunsRecovered, inertBuildsReaped, workCapsulesReapCandidates, workCapsulesReaped, staleBacklogClaimsReaped };
    }

    // Coarse SQL filter using the smallest applicable thresholds across all
    // phases. Anything stricter is filtered out in app code below.
    const minHeartbeatS = Math.min(...thresholds.map((t) => t.heartbeatTimeoutSeconds));
    const minTotalS = Math.min(...thresholds.map((t) => t.totalPhaseTimeoutSeconds));

    const candidates = await prisma.$queryRaw<WatchdogCandidate[]>`
      SELECT tr."taskRunId" AS "taskRunId",
             tr."buildId" AS "buildId",
             fb.phase AS "phase",
             tr."startedAt" AS "startedAt",
             tr."lastHeartbeatAt" AS "lastHeartbeatAt",
             tr."source" AS "source"
      FROM "TaskRun" tr
      LEFT JOIN "FeatureBuild" fb ON tr."buildId" = fb."buildId"
      -- Catches both the canonical "working" state AND the legacy "active"
      -- value still written by deliberation-run.ts and any other paths that
      -- haven't been migrated. They mean the same thing semantically (work
      -- in flight, not terminal). Audited 2026-05-20. The IN-list is built
      -- from the canonical TASK_LIVE_STATES constant (EP-8DC217EB BET-10).
      WHERE tr.status IN (${Prisma.join([...TASK_LIVE_STATES])})
        AND (
          tr."lastHeartbeatAt" IS NULL
          OR now() - tr."lastHeartbeatAt" > make_interval(secs => ${minHeartbeatS})
          OR now() - tr."startedAt" > make_interval(secs => ${minTotalS})
        )
    `;

    const now = new Date();
    const thresholdByScope = new Map(thresholds.map((t) => [t.scope, t]));
    const defaultRow = thresholdByScope.get("default");

    const decisions: StallDecision[] = [];
    for (const c of candidates) {
      const scope = c.phase ? `phase.${c.phase}` : "default";
      const t = thresholdByScope.get(scope) ?? defaultRow;
      if (!t) continue; // Unreachable given the seed invariant; skip defensively.
      const decision = decideStall(
        c,
        {
          scope,
          heartbeatTimeoutSeconds: t.heartbeatTimeoutSeconds,
          totalPhaseTimeoutSeconds: t.totalPhaseTimeoutSeconds,
        },
        now,
      );
      if (decision) decisions.push(decision);
    }

    if (decisions.length === 0) {
      return { processed: 0, quiescenceRecovered, quiescingTaskRunsRecovered, inertBuildsReaped, workCapsulesReapCandidates, workCapsulesReaped };
    }

    // Batch id-resolution: business taskRunId → cuid id for FK writes.
    const businessIds = decisions.map((d) => d.candidate.taskRunId);
    const idRows = await prisma.taskRun.findMany({
      where: { taskRunId: { in: businessIds } },
      select: { id: true, taskRunId: true, userId: true },
    });
    const idMap = new Map(idRows.map((r) => [r.taskRunId, { id: r.id, userId: r.userId }]));

    let processed = 0;
    for (const d of decisions) {
      const idEntry = idMap.get(d.candidate.taskRunId);
      if (!idEntry) continue; // row deleted between fetch and tx — safe to skip
      const cuid = idEntry.id;

      // Resolve notification recipient: build owner if buildId present, else
      // task user. If neither resolves, skip notification — the StallEvent
      // row is the durable record.
      let notifyUserId: string | null = idEntry.userId ?? null;
      let buildRow: { createdById: string | null; buildExecState: unknown; verificationOut: unknown } | null = null;
      if (d.candidate.buildId) {
        buildRow = await prisma.featureBuild.findUnique({
          where: { buildId: d.candidate.buildId },
          select: { createdById: true, buildExecState: true, verificationOut: true },
        });
        if (buildRow?.createdById) notifyUserId = buildRow.createdById;
      }

      // Surface a build-phase stall as an ACTIONABLE blocked state (failed
      // checkpoint + failureAxis) so the build no longer sits silently quiet —
      // the FB-69231490 symptom. Only the build phase: other phases own their
      // own recovery flows.
      //
      // GUARD (shouldSurfaceBuildFailure): only the actual build-execution
      // TaskRun (source="build") may fail the build. Deliberation runs
      // (source="proactive", "Deliberation: review") carry the same buildId and
      // leak in the `working` state after the review passes; while the build is
      // in phase="build" they would otherwise trip this surface and mark a
      // HEALTHY build failed — after codegen but before commit — which stranded
      // builds with correct-but-uncommitted code (the empty-diff symptom). The
      // stalled deliberation run is still marked stalled + audited below; it
      // just no longer corrupts the build's exec state.
      const stallSurface =
        buildRow && shouldSurfaceBuildFailure(d.candidate, true)
          ? buildStallSurface({
              reason: d.reason as import("@/lib/observability/stall-surface").StallReason,
              phase: d.candidate.phase,
              heartbeatTimeoutSeconds: d.threshold.heartbeatTimeoutSeconds,
              totalPhaseTimeoutSeconds: d.threshold.totalPhaseTimeoutSeconds,
              priorExecState:
                buildRow.buildExecState && typeof buildRow.buildExecState === "object" && !Array.isArray(buildRow.buildExecState)
                  ? (buildRow.buildExecState as Record<string, unknown>)
                  : null,
              now: now.toISOString(),
            })
          : null;

      await prisma.$transaction(async (tx) => {
        // 1. Transition TaskRun.
        await tx.taskRun.update({
          where: { taskRunId: d.candidate.taskRunId },
          data: { status: "stalled", completedAt: now },
        });

        // 2. StallEvent audit row.
        await tx.stallEvent.create({
          data: {
            taskRunId: cuid,
            buildId: d.candidate.buildId,
            phase: d.candidate.phase,
            reason: d.reason,
            lastHeartbeatAt: d.candidate.lastHeartbeatAt,
            startedAt: d.candidate.startedAt,
            thresholdHeartbeatS: d.threshold.heartbeatTimeoutSeconds,
            thresholdTotalS: d.threshold.totalPhaseTimeoutSeconds,
          },
        });

        // 3. BuildActivity row when this stall is tied to a build that
        //    still exists. d.candidate.phase is non-null iff the LEFT JOIN
        //    matched a FeatureBuild row — use that as the FK-safety check.
        //    Catches the case where TaskRun.buildId references a deleted
        //    FeatureBuild (observed in live data 2026-05-20).
        if (d.candidate.buildId && d.candidate.phase) {
          await tx.buildActivity.create({
            data: {
              buildId: d.candidate.buildId,
              tool: "watchdog:stall",
              summary: `Watchdog detected stall (${d.reason}) in phase ${d.candidate.phase}`,
            },
          });
        }

        // 3b. Surface the build-phase stall as an actionable failed checkpoint
        //     so the operator sees Reset/Resume + a failureAxis instead of a
        //     silently quiet build.
        if (stallSurface && d.candidate.buildId) {
          await tx.featureBuild.update({
            where: { buildId: d.candidate.buildId },
            data: {
              buildExecState: stallSurface.execState as import("@dpf/db").Prisma.InputJsonValue,
              verificationOut: mergeVerificationPatch(
                buildRow?.verificationOut,
                stallSurface.verificationPatch,
              ) as import("@dpf/db").Prisma.InputJsonValue,
            },
          });
        }

        // 4. Notification.
        // BI-15B42AFE: per-type dedup/cap so we do not mint a fresh row per stall
        // and bury the operator in 5000 unread rows.
        if (notifyUserId) {
          const existing = await tx.notification.findFirst({
            where: { userId: notifyUserId, type: "taskrun.stalled", read: false },
            select: { id: true },
          });
          const payload = {
            title: `Task stalled in ${d.candidate.phase ?? "unknown"} phase`,
            body: `Watchdog detected ${d.reason} after ${d.threshold.heartbeatTimeoutSeconds}s heartbeat / ${d.threshold.totalPhaseTimeoutSeconds}s total budget.`,
            deepLink: d.candidate.buildId ? `/build` : `/platform/ai/operations`,
          };

          if (existing) {
            await tx.notification.update({
              where: { id: existing.id },
              data: { ...payload, createdAt: now },
            });
          } else {
            await tx.notification.create({
              data: {
                userId: notifyUserId,
                type: "taskrun.stalled",
                ...payload,
              },
            });
          }
        }
      });

      // 5. Emit AgentEvent for live-UI subscribers (outside the tx — best
      //    effort; failure to emit must not roll back the audit row).
      try {
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        agentEventBus.emit("watchdog", {
          type: "taskrun:stalled",
          taskRunId: d.candidate.taskRunId,
          buildId: d.candidate.buildId,
          phase: d.candidate.phase,
          reason: d.reason,
        });
      } catch (err) {
        console.warn("[taskrun-watchdog] event emit failed:", err);
      }

      processed += 1;
    }

    return { processed, quiescenceRecovered, quiescingTaskRunsRecovered, inertBuildsReaped, workCapsulesReapCandidates, workCapsulesReaped };
  },
);
