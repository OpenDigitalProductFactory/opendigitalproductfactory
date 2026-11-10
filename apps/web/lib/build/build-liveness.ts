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

/** Written when a phase transition is refused because an upgrade is draining (admitPhaseTransition). */
export const UPGRADE_WAIT_ACTIVITY_TOOL = "phase:upgrade-wait";

/** Written by the subscriber that resumes builds when an upgrade pause clears (BI-E9DAA23F). */
export const UPGRADE_PAUSE_RESUME_TOOL = "resumeBuildsAfterUpgradePause";

/** The reconcilers' own rows must not keep a build looking alive. */
export const RECONCILER_ACTIVITY_TOOLS = [
  "resumeStrandedBuildsOnBoot",
  "recoverContradictoryBuildExecStatesOnBoot",
  UPGRADE_PAUSE_RESUME_TOOL,
];

/**
 * BI-E9DAA23F: a refused transition is not progress either. Counting the
 * upgrade-wait marker as liveness kept a waiting build out of the resumer for
 * 15 minutes after the pause cleared. Liveness only; the wait still counts as
 * the build's last activity everywhere else.
 */
const NOT_PROGRESS_TOOLS = [...RECONCILER_ACTIVITY_TOOLS, UPGRADE_WAIT_ACTIVITY_TOOL];

// BI-4EB33E54: an orchestration records task results only when its whole run ends, so a
// long first task looks like silence (FB-D671B016, 2026-09-25: 22 quiet
// minutes, checkpoint cleared under it). The registry is process-wide via
// globalThis because the reconcilers (instrumentation) and the orchestrator
// can load this module from different bundle chunks. A portal restart empties
// it, which is right: the orchestration died with the process.
const REGISTRY_KEY = "__dpfRunningBuildOrchestrations";
function runningOrchestrations(): Set<string> {
  const scope = globalThis as unknown as Record<string, Set<string> | undefined>;
  return (scope[REGISTRY_KEY] ??= new Set<string>());
}

export async function withOrchestrationRunning<T>(buildId: string, run: () => Promise<T>): Promise<T> {
  runningOrchestrations().add(buildId);
  try {
    return await run();
  } finally {
    runningOrchestrations().delete(buildId);
  }
}

/** True while this process is running an orchestration (or a resume) for the build. */
export function isOrchestrationRunning(buildId: string): boolean {
  return runningOrchestrations().has(buildId);
}

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
      tool: { notIn: NOT_PROGRESS_TOOLS },
    },
    select: { buildId: true },
    distinct: ["buildId"],
  });
  const live = new Set(rows.map((row) => row.buildId));
  for (const buildId of buildIds) if (runningOrchestrations().has(buildId)) live.add(buildId);
  return live;
}

