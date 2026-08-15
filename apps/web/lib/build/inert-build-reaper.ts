// apps/web/lib/build/inert-build-reaper.ts
//
// BI-8F45BA74 — reap INERT stuck builds so they stop jamming the WIP cap.
//
// Why this exists:
//   Auto-promoted builds (e.g. a daily backlog batch) that stall at the
//   operator-driven ideate intent gate produce ZERO observable activity and sit
//   in a non-terminal phase forever. Each holds a Build Studio WIP slot (the cap
//   is intentionally small — see wip-cap.ts), so a handful of dead-on-arrival
//   builds jam the pipeline: `promote_to_build_studio` then rejects every new
//   build with `wip_cap_reached`, and nothing can be built at all. Observed live
//   2026-06-19: 15 builds in `ideate`/`plan` with 0 BuildActivity against a cap
//   of 3.
//
//   The dead-phase reaper in self-upgrade/quiescence.ts only closes orphaned
//   BuildPhaseRun rows — these builds never created one (0 activity), so it can't
//   help. This reaper targets the build itself.
//
// Safety: only a build that has produced NO observable work is reapable — zero
// BuildActivity AND no active/working TaskRun — and only after it's older than
// the inert threshold, in a non-terminal phase, not already abandoned, and not
// an epic-decomposed child (those are coordinated by the epic, not reaped here).
// A build that ever did anything (any phase that reached build/review/ship) has
// BuildActivity and is therefore never touched. Re-promoting the backlog item
// restarts the work cleanly.

import { TASK_LIVE_STATES } from "@/lib/tak/task-states";

/** Default inert threshold: 3h with zero activity = dead-on-arrival. Override with BUILD_INERT_REAP_MS. */
export const INERT_BUILD_REAP_MS = Number(process.env.BUILD_INERT_REAP_MS) || 3 * 60 * 60 * 1000;

const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"];

/**
 * Pure decision: is this build an inert corpse safe to abandon? No DB. Unit-tested.
 * A build is reapable only when it has produced no observable work at all and is
 * older than the threshold.
 */
export function isInertBuildReapable(args: {
  phase: string;
  abandonedAt: Date | null;
  parentEpicId: string | null;
  createdAt: Date;
  activityCount: number;
  liveTaskRunCount: number;
  now: Date;
  thresholdMs: number;
}): boolean {
  const { phase, abandonedAt, parentEpicId, createdAt, activityCount, liveTaskRunCount, now, thresholdMs } = args;
  if (abandonedAt) return false;
  if (parentEpicId) return false; // epic-decomposed child — coordinated elsewhere
  if (TERMINAL_BUILD_PHASES.includes(phase)) return false;
  if (activityCount > 0) return false; // did something — not inert
  if (liveTaskRunCount > 0) return false; // actively running right now
  return now.getTime() - createdAt.getTime() > thresholdMs;
}

/**
 * Default stalled-after-activity threshold: 6h with no BuildActivity = a build
 * that DID work then froze. Override with BUILD_STALLED_REAP_MS.
 *
 * Deliberately far larger than any healthy step's activity gap (real builds emit
 * BuildActivity every few minutes), so a genuinely-long-running step is never
 * mistaken for stalled.
 */
export const STALLED_BUILD_REAP_MS = Number(process.env.BUILD_STALLED_REAP_MS) || 6 * 60 * 60 * 1000;

/**
 * Pure decision: is this build STALLED-AFTER-ACTIVITY and safe to reap? No DB.
 * Unit-tested. This is the remediation half of the watchdog detect→remediate
 * loop (BI-EB33BD37) — the companion to {@link isInertBuildReapable}, which only
 * covers zero-activity dead-on-arrival builds. A build that produced work and
 * then went silent (e.g. FB-CCEC4210: build orchestration completed, then a
 * heartbeat_timeout, then 3 days frozen in `build`) was covered by neither the
 * inert reaper (activityCount>0) nor the 7-day ideate/plan abandon age-out.
 *
 * SAFETY: the `liveTaskRunCount > 0` guard is load-bearing. A genuinely-working
 * build always has a live TaskRun; the watchdog marks stalled runs non-live
 * BEFORE this runs (same sweep — taskrun-watchdog.ts), so this only ever fires
 * on a build whose runs are already stalled/done and whose last activity is old.
 * Abandon is reversible: re-promote the backlog item to retry cleanly.
 */
export function isStalledBuildReapable(args: {
  phase: string;
  abandonedAt: Date | null;
  parentEpicId: string | null;
  activityCount: number;
  liveTaskRunCount: number;
  lastActivityAt: Date | null;
  now: Date;
  staleMs: number;
}): boolean {
  const { phase, abandonedAt, parentEpicId, activityCount, liveTaskRunCount, lastActivityAt, now, staleMs } = args;
  if (abandonedAt) return false;
  if (parentEpicId) return false; // epic-decomposed child — coordinated elsewhere
  // Only the active EXECUTION phases can stall-after-activity here (matches the
  // UI stall definition, BI-46204009). ideate/plan are coworker-custody and are
  // covered by the 7-day age-out (BI-A009313E) + the zero-activity inert reaper;
  // ship/complete/failed/abandoned own their own flows.
  if (phase !== "build" && phase !== "review") return false;
  if (liveTaskRunCount > 0) return false; // actively running right now — never reap
  if (activityCount === 0) return false; // zero activity is the inert reaper's job
  if (!lastActivityAt) return false; // unknown freshness — stay conservative
  return now.getTime() - lastActivityAt.getTime() > staleMs;
}

/**
 * DB wrapper — find inert AND stalled-after-activity builds and abandon them,
 * freeing their WIP slots (BI-8F45BA74 + BI-EB33BD37).
 * Returns the count reaped. Best-effort per row (one tx each) so a single
 * failure never aborts the sweep. Re-checks under the transaction to avoid
 * racing a build that just came alive between the scan and the write.
 */
export async function reapInertStuckBuilds(
  now: Date = new Date(),
  thresholdMs: number = INERT_BUILD_REAP_MS,
  staleAfterActivityMs: number = STALLED_BUILD_REAP_MS,
): Promise<number> {
  const { prisma } = await import("@dpf/db");
  // Coarse cutoff is the SMALLER of the two thresholds so neither an inert nor a
  // stalled candidate is excluded before the precise per-candidate check.
  const cutoff = new Date(now.getTime() - Math.min(thresholdMs, staleAfterActivityMs));

  // Coarse scalar filter (indexed); per-candidate activity/taskrun checks below.
  const candidates = await prisma.featureBuild.findMany({
    where: {
      phase: { notIn: TERMINAL_BUILD_PHASES },
      abandonedAt: null,
      parentEpicId: null,
      createdAt: { lt: cutoff },
    },
    select: { buildId: true, phase: true, createdAt: true },
    take: 100,
  });
  if (candidates.length === 0) return 0;

  let reaped = 0;
  for (const c of candidates) {
    const [activityCount, liveTaskRunCount, lastActivity] = await Promise.all([
      prisma.buildActivity.count({ where: { buildId: c.buildId } }),
      prisma.taskRun.count({ where: { buildId: c.buildId, status: { in: [...TASK_LIVE_STATES] } } }),
      prisma.buildActivity.findFirst({
        where: { buildId: c.buildId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    const lastActivityAt = lastActivity?.createdAt ?? null;

    const inert = isInertBuildReapable({
      phase: c.phase,
      abandonedAt: null,
      parentEpicId: null,
      createdAt: c.createdAt,
      activityCount,
      liveTaskRunCount,
      now,
      thresholdMs,
    });
    const stalled =
      !inert &&
      isStalledBuildReapable({
        phase: c.phase,
        abandonedAt: null,
        parentEpicId: null,
        activityCount,
        liveTaskRunCount,
        lastActivityAt,
        now,
        staleMs: staleAfterActivityMs,
      });
    if (!inert && !stalled) continue;

    const hoursOld = Math.round((now.getTime() - c.createdAt.getTime()) / 3_600_000);
    const staleHours = lastActivityAt
      ? Math.round((now.getTime() - lastActivityAt.getTime()) / 3_600_000)
      : hoursOld;
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check under the row: don't reap a build that just came alive.
        const fresh = await tx.featureBuild.findUnique({
          where: { buildId: c.buildId },
          select: { phase: true, abandonedAt: true },
        });
        if (!fresh || fresh.abandonedAt || TERMINAL_BUILD_PHASES.includes(fresh.phase)) return;

        if (inert) {
          const recount = await tx.buildActivity.count({ where: { buildId: c.buildId } });
          if (recount > 0) return; // gained activity since the scan — no longer inert
        } else {
          // Stalled: bail if it came alive since the scan — a live task run, or a
          // fresh BuildActivity within the stale window.
          const [liveNow, freshLast] = await Promise.all([
            tx.taskRun.count({ where: { buildId: c.buildId, status: { in: [...TASK_LIVE_STATES] } } }),
            tx.buildActivity.findFirst({
              where: { buildId: c.buildId },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            }),
          ]);
          if (liveNow > 0) return;
          if (!freshLast || now.getTime() - freshLast.createdAt.getTime() <= staleAfterActivityMs) return;
        }

        const abandonReason = inert
          ? `Auto-reaped: inert build — no activity for >${Math.round(thresholdMs / 3_600_000)}h, ` +
            `stuck in ${c.phase}. Freed a Build Studio WIP slot; re-promote the backlog item to retry. (BI-8F45BA74)`
          : `Auto-reaped: stalled build — did work then no activity for >${Math.round(staleAfterActivityMs / 3_600_000)}h ` +
            `with no live task run, stuck in ${c.phase}. Freed a Build Studio WIP slot; re-promote the backlog item to retry. (BI-EB33BD37)`;

        await tx.featureBuild.update({
          where: { buildId: c.buildId },
          data: { phase: "abandoned", abandonedAt: now, abandonReason },
        });
        await tx.buildActivity.create({
          data: {
            buildId: c.buildId,
            tool: inert ? "watchdog:reap-inert" : "watchdog:reap-stalled",
            summary: inert
              ? `Reaped inert build (${hoursOld}h old, 0 activity in ${c.phase}) to free a WIP slot.`
              : `Reaped stalled build (last activity ${staleHours}h ago, no live run in ${c.phase}) to free a WIP slot.`,
          },
        });
      });
      reaped += 1;
      console.warn(
        `[inert-build-reaper] reaped ${inert ? "inert" : "stalled"} build ${c.buildId} (${hoursOld}h old, phase=${c.phase}, last activity ${staleHours}h ago)`,
      );
      // BI-8BD61C30: free sandbox .builds/<id> — inert reaper previously left worktrees behind.
      const { releaseSandboxForTerminalBuild } = await import(
        "@/lib/integrate/sandbox/sandbox-build-gc"
      );
      await releaseSandboxForTerminalBuild(c.buildId, { deleteBranch: false }).catch(() => {});
      // WS9 (BI-CBAAEA94): a terminal build must not leave a zombie "working"
      // Workroom behind — that is the surface that reads as active and gets
      // silently duplicated. Transition the attached capsule in the same tick.
      const { transitionCapsuleForTerminalBuild } = await import(
        "@/lib/work-capsules/work-capsule-reaper"
      );
      await transitionCapsuleForTerminalBuild(
        c.buildId,
        inert ? `inert — no activity in ${c.phase}.` : `stalled — no activity in ${c.phase}.`,
        now,
      ).catch(() => {});
    } catch (err) {
      console.warn(`[inert-build-reaper] failed to reap build ${c.buildId}:`, err);
    }
  }
  return reaped;
}
