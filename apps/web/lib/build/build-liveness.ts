// apps/web/lib/build/build-liveness.ts

import type { prisma as Db } from "@dpf/db";

/**
 * BI-5BF650CB: how recently a build must have shown activity to count as live.
 * Both build reconcilers run on boot AND on an interval, and the auto-dispatched
 * orchestrator records its progress as BuildActivity rows — it never bumps
 * FeatureBuild.updatedAt or writes an exec step. Without this check a build that
 * was actively coding (FB-8255C0E5: 171 sandbox commands) had its checkpoint
 * cleared and a second pipeline dispatched, which wiped the shared
 * /workspace node_modules under the first.
 */
export const BUILD_LIVENESS_WINDOW_MS = 15 * 60 * 1000;

/** The reconcilers' own rows must not keep a build looking alive. */
const RECONCILER_ACTIVITY_TOOLS = ["resumeStrandedBuildsOnBoot", "recoverContradictoryBuildExecStatesOnBoot"];

export async function recentlyActiveBuildIds(
  prisma: Pick<typeof Db, "buildActivity">,
  buildIds: string[],
  now: Date,
): Promise<Set<string>> {
  if (buildIds.length === 0) return new Set();
  const rows = await prisma.buildActivity.findMany({
    where: {
      buildId: { in: buildIds },
      createdAt: { gte: new Date(now.getTime() - BUILD_LIVENESS_WINDOW_MS) },
      tool: { notIn: RECONCILER_ACTIVITY_TOOLS },
    },
    select: { buildId: true },
    distinct: ["buildId"],
  });
  return new Set(rows.map((row) => row.buildId));
}

