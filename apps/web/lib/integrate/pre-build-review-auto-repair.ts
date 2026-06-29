import { prisma } from "@dpf/db";
import { inngest, type BuildPreBuildReviewRepairEvent } from "@/lib/queue/inngest-client";

type AutoRepairContext = {
  suppressDesignReviewAutoRepair?: boolean;
  suppressPlanReviewAutoRepair?: boolean;
};

type RepairKind = BuildPreBuildReviewRepairEvent["data"]["kind"];

function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary } }).catch(() => {});
}

async function queuePreBuildReviewRepair(buildId: string, userId: string, kind: RepairKind): Promise<void> {
  const tool = kind === "design" ? "design_fix_loop" : "plan_dispatch";
  try {
    await inngest.send({
      name: "build/pre-build-review.repair",
      data: { buildId, userId, kind },
    });
    logBuildActivity(
      buildId,
      tool,
      `${kind === "design" ? "Design" : "Plan"} review failed - queued the in-place repair loop.`,
    );
  } catch (err) {
    logBuildActivity(
      buildId,
      tool,
      `${kind === "design" ? "Design" : "Plan"} review failed - failed to queue the in-place repair loop: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`,
    );
  }
}

export async function triggerDesignReviewAutoRepair(buildId: string, userId: string, context?: AutoRepairContext): Promise<void> {
  if (context?.suppressDesignReviewAutoRepair) return;
  await queuePreBuildReviewRepair(buildId, userId, "design");
}

export async function triggerPlanReviewAutoRepair(buildId: string, userId: string, context?: AutoRepairContext): Promise<void> {
  if (context?.suppressPlanReviewAutoRepair) return;
  await queuePreBuildReviewRepair(buildId, userId, "plan");
}
