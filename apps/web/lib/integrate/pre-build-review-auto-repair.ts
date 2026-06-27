import { prisma } from "@dpf/db";

type AutoRepairContext = {
  suppressDesignReviewAutoRepair?: boolean;
  suppressPlanReviewAutoRepair?: boolean;
};

function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary } }).catch(() => {});
}

export function triggerDesignReviewAutoRepair(buildId: string, userId: string, context?: AutoRepairContext): void {
  if (context?.suppressDesignReviewAutoRepair) return;
  logBuildActivity(buildId, "design_fix_loop", "Design review failed - starting the in-place repair loop.");
  void import("@/lib/integrate/ideate-on-approval")
    .then((m) => m.dispatchDesignReviewFixLoop({ buildId, userId }))
    .then((outcome) => {
      logBuildActivity(
        buildId,
        "design_fix_loop",
        `In-place design repair finished: ${outcome.kind} after ${outcome.rounds} round(s).`,
      );
    })
    .catch((err) => {
      logBuildActivity(
        buildId,
        "design_fix_loop",
        `In-place design repair failed to start: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`,
      );
    });
}

export function triggerPlanReviewAutoRepair(buildId: string, userId: string, context?: AutoRepairContext): void {
  if (context?.suppressPlanReviewAutoRepair) return;
  logBuildActivity(buildId, "plan_dispatch", "Plan review failed - starting the in-place repair loop.");
  void import("@/lib/integrate/plan-on-approval")
    .then((m) => m.dispatchPlanForApprovedBuild({ buildId, userId, forceRegenerate: true }))
    .then((outcome) => {
      logBuildActivity(buildId, "plan_dispatch", `In-place plan repair finished: ${outcome.kind}.`);
    })
    .catch((err) => {
      logBuildActivity(
        buildId,
        "plan_dispatch",
        `In-place plan repair failed to start: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`,
      );
    });
}
