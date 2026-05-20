/**
 * Resolve per-TaskRun stall thresholds (BI-4ab6be39 slice B2).
 *
 * Joins TaskRun → FeatureBuild.phase to pick the right row from
 * BuildStudioStallThreshold. Falls back to "default" for TaskRuns without a
 * buildId (coworker / skill / proactive sources).
 *
 * Reads on every call so operator threshold edits at runtime take effect
 * immediately — see Admin > Build Studio > Stall Thresholds (slice G1).
 */
import { prisma } from "@dpf/db";

export interface ResolvedThreshold {
  scope: string;
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
}

export async function resolveThresholdForTaskRun(taskRunId: string): Promise<ResolvedThreshold> {
  const tr = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: { buildId: true },
  });

  let scope = "default";
  if (tr?.buildId) {
    const fb = await prisma.featureBuild.findUnique({
      where: { buildId: tr.buildId },
      select: { phase: true },
    });
    if (fb?.phase) scope = `phase.${fb.phase}`;
  }

  const row = await prisma.buildStudioStallThreshold.findUnique({ where: { scope } });
  if (row) {
    return {
      scope,
      heartbeatTimeoutSeconds: row.heartbeatTimeoutSeconds,
      totalPhaseTimeoutSeconds: row.totalPhaseTimeoutSeconds,
    };
  }

  // Fallback to "default" — seed invariant guarantees this row exists.
  const def = await prisma.buildStudioStallThreshold.findUnique({ where: { scope: "default" } });
  if (!def) {
    throw new Error(
      "[threshold-lookup] BuildStudioStallThreshold seed missing 'default' row — re-seed required",
    );
  }
  return {
    scope: "default",
    heartbeatTimeoutSeconds: def.heartbeatTimeoutSeconds,
    totalPhaseTimeoutSeconds: def.totalPhaseTimeoutSeconds,
  };
}
