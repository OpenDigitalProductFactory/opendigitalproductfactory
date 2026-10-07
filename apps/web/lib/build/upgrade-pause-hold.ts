// apps/web/lib/build/upgrade-pause-hold.ts
//
// BI-E9DAA23F — builds held by a self-upgrade pause.
//
// While an upgrade drains, admitPhaseTransition refuses the next phase and
// records an upgrade-wait row on the build. Nothing woke those builds when the
// pause cleared: they waited for the 10-minute stranded-build tick, and one
// parked that way for a week was aged out by the 7-day cap as if it had failed
// on its own (2026-10-07: 59 of 126 plan-parked builds last stopped on the wait).
//
// "Held by the pause" means the wait is the LAST thing recorded on the build.
// Any later row (a resume attempt and its outcome, or the build's own work)
// means an attempt was made after the wait, and its result, not the platform,
// now explains where the build stands. The stranded-build resumer skips
// pre-build work during a pause, so its own attempts do not mint fresh waits.

import { prisma as defaultPrisma } from "@dpf/db";
import {
  UPGRADE_PAUSE_RESUME_TOOL,
  UPGRADE_WAIT_ACTIVITY_TOOL,
  isOrchestrationRunning,
  withOrchestrationRunning,
} from "@/lib/build/build-liveness";

type Db = Pick<typeof defaultPrisma, "buildActivity" | "featureBuild">;

/** Phases whose next transition waits on a pause and that resumePreBuildPhase can re-fire. */
const HELD_PHASES = ["ideate", "plan", "review"];

/** How far back to look for waits when a pause clears. Older strands are the tick's job. */
export const UPGRADE_PAUSE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** True when the build's latest activity row is the upgrade-wait marker. */
export async function isBuildHeldByUpgradePause(
  db: Pick<typeof defaultPrisma, "buildActivity">,
  buildId: string,
): Promise<boolean> {
  const latest = await db.buildActivity.findFirst({
    where: { buildId },
    orderBy: { createdAt: "desc" },
    select: { tool: true, createdAt: true },
  });
  return latest?.tool === UPGRADE_WAIT_ACTIVITY_TOOL;
}

export type HeldBuild = { buildId: string; phase: string; userId: string };

/** Pre-build builds that waited on a pause in the lookback window and are still held by it. */
export async function findBuildsHeldByUpgradePause(
  opts: { db?: Db; now?: Date; lookbackMs?: number } = {},
): Promise<HeldBuild[]> {
  const db = opts.db ?? defaultPrisma;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackMs ?? UPGRADE_PAUSE_LOOKBACK_MS));
  const waits = await db.buildActivity.findMany({
    where: { tool: UPGRADE_WAIT_ACTIVITY_TOOL, createdAt: { gte: since } },
    select: { buildId: true },
  });
  const waitedIds = [...new Set(waits.map((w) => w.buildId))];
  if (waitedIds.length === 0) return [];
  const builds = await db.featureBuild.findMany({
    where: { buildId: { in: waitedIds } },
    select: { buildId: true, phase: true, abandonedAt: true, createdById: true },
  });
  const held: HeldBuild[] = [];
  for (const build of builds) {
    if (build.abandonedAt || !HELD_PHASES.includes(build.phase)) continue;
    if (!(await isBuildHeldByUpgradePause(db, build.buildId))) continue;
    held.push({ buildId: build.buildId, phase: build.phase, userId: build.createdById });
  }
  return held;
}

export type HeldBuildResume = "resumed" | "skipped" | "failed" | "not-held" | "running";

/**
 * Re-fire the canonical pre-build resume for one held build. Re-checks the hold
 * first, so a build another path already moved on is left alone. Never throws.
 */
export async function resumeBuildHeldByUpgradePause(params: { buildId: string; db?: Db }): Promise<HeldBuildResume> {
  const db = params.db ?? defaultPrisma;
  const { buildId } = params;
  try {
    const build = await db.featureBuild.findUnique({
      where: { buildId },
      select: { phase: true, abandonedAt: true, createdById: true },
    });
    if (!build || build.abandonedAt || !HELD_PHASES.includes(build.phase)) return "not-held";
    if (!(await isBuildHeldByUpgradePause(db, buildId))) return "not-held";
    if (isOrchestrationRunning(buildId)) return "running";

    await db.buildActivity.create({
      data: {
        buildId,
        tool: UPGRADE_PAUSE_RESUME_TOOL,
        summary: `The platform upgrade pause cleared: resuming the ${build.phase} phase now (BI-E9DAA23F).`,
      },
    });
    const { resumePreBuildPhase } = await import("@/lib/build/resume-pre-build-phase");
    const outcome = await withOrchestrationRunning(buildId, () =>
      resumePreBuildPhase({ buildId, phase: build.phase, userId: build.createdById }),
    );
    const detail =
      "via" in outcome ? ` via ${outcome.via}: ${outcome.detail}` : "reason" in outcome ? `: ${outcome.reason}` : `: ${outcome.error}`;
    await db.buildActivity
      .create({
        data: {
          buildId,
          tool: UPGRADE_PAUSE_RESUME_TOOL,
          summary: `Resume after the upgrade pause (${build.phase}): ${outcome.kind}${detail}`.slice(0, 500),
        },
      })
      .catch(() => {});
    return outcome.kind;
  } catch (err) {
    console.warn("[upgrade-pause-hold] resume failed:", { buildId }, err);
    return "failed";
  }
}
