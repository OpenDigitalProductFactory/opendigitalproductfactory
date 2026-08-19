import { prisma } from "@dpf/db";
import { inngest, type BuildPreBuildReviewRepairEvent } from "../inngest-client";

type PreBuildReviewRepairEventData = BuildPreBuildReviewRepairEvent["data"];

function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary: summary.slice(0, 240) } }).catch(() => {});
}

export const preBuildReviewRepair = inngest.createFunction(
  {
    id: "build/pre-build-review-repair",
    retries: 2,
    concurrency: [{ key: "event.data.buildId", limit: 1 }],
    triggers: [{ event: "build/pre-build-review.repair" }],
  },
  async ({ event, step }) => {
    const { buildId, userId, kind } = event.data as PreBuildReviewRepairEventData;

    if (kind === "design") {
      const outcome = await step.run("repair-design-review", async () => {
        const { dispatchDesignReviewFixLoop } = await import("@/lib/build/ideate-on-approval");
        return dispatchDesignReviewFixLoop({ buildId, userId });
      });
      logBuildActivity(
        buildId,
        "design_fix_loop",
        `In-place design repair finished: ${outcome.kind} after ${outcome.rounds} round(s).`,
      );
      return { buildId, kind, outcome };
    }

    const outcome = await step.run("repair-plan-review", async () => {
      const { dispatchPlanForApprovedBuild } = await import("@/lib/build/plan-on-approval");
      return dispatchPlanForApprovedBuild({ buildId, userId, forceRegenerate: true });
    });
    logBuildActivity(buildId, "plan_dispatch", `In-place plan repair finished: ${outcome.kind}.`);
    return { buildId, kind, outcome };
  },
);
