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
import { isStale } from "@/lib/observability/staleness";

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
  return isStale(now, createdAt, thresholdMs);
}

/**
 * DB wrapper — find inert builds and abandon them, freeing their WIP slots.
 * Returns the count reaped. Best-effort per row (one tx each) so a single
 * failure never aborts the sweep. Re-checks under the transaction to avoid
 * racing a build that just came alive between the scan and the write.
 */
export async function reapInertStuckBuilds(
  now: Date = new Date(),
  thresholdMs: number = INERT_BUILD_REAP_MS,
): Promise<number> {
  const { prisma } = await import("@dpf/db");
  const cutoff = new Date(now.getTime() - thresholdMs);

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
    const [activityCount, liveTaskRunCount] = await Promise.all([
      prisma.buildActivity.count({ where: { buildId: c.buildId } }),
      prisma.taskRun.count({ where: { buildId: c.buildId, status: { in: [...TASK_LIVE_STATES] } } }),
    ]);
    if (
      !isInertBuildReapable({
        phase: c.phase,
        abandonedAt: null,
        parentEpicId: null,
        createdAt: c.createdAt,
        activityCount,
        liveTaskRunCount,
        now,
        thresholdMs,
      })
    ) {
      continue;
    }

    const hoursOld = Math.round((now.getTime() - c.createdAt.getTime()) / 3_600_000);
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check under the row: don't reap a build that just came alive.
        const fresh = await tx.featureBuild.findUnique({
          where: { buildId: c.buildId },
          select: { phase: true, abandonedAt: true },
        });
        if (!fresh || fresh.abandonedAt || TERMINAL_BUILD_PHASES.includes(fresh.phase)) return;
        const recount = await tx.buildActivity.count({ where: { buildId: c.buildId } });
        if (recount > 0) return;

        await tx.featureBuild.update({
          where: { buildId: c.buildId },
          data: {
            phase: "abandoned",
            abandonedAt: now,
            abandonReason:
              `Auto-reaped: inert build — no activity for >${Math.round(thresholdMs / 3_600_000)}h, ` +
              `stuck in ${c.phase}. Freed a Build Studio WIP slot; re-promote the backlog item to retry. (BI-8F45BA74)`,
          },
        });
        await tx.buildActivity.create({
          data: {
            buildId: c.buildId,
            tool: "watchdog:reap-inert",
            summary: `Reaped inert build (${hoursOld}h old, 0 activity in ${c.phase}) to free a WIP slot.`,
          },
        });
      });
      reaped += 1;
      console.warn(
        `[inert-build-reaper] reaped inert build ${c.buildId} (${hoursOld}h old, phase=${c.phase}, 0 activity)`,
      );
    } catch (err) {
      console.warn(`[inert-build-reaper] failed to reap inert build ${c.buildId}:`, err);
    }
  }
  return reaped;
}
