import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/**
 * EP-B70E718D F8c (BI-3EC4722F): the daily flow review. Each shape version's
 * newest review is recorded the day it falls; when two consecutive reviews name
 * the same pile (step and cause), it is filed once as a backlog item, owned by
 * the stage's accountable principal and carrying its routing answer.
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §8.
 */
export const workroomFlowReview = jobs.createFunction(
  {
    id: "workroom/flow-review",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    // Daily, so a review is recorded on the day its review point falls.
    triggers: [cron("23 6 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "workroom/flow-review");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("review-flow", async () => {
      const { defaultFlowReviewEscalationDeps, runFlowReviewEscalation } = await import(
        "@/lib/work-management/flow-review-escalation.server"
      );
      const result = await runFlowReviewEscalation(await defaultFlowReviewEscalationDeps());
      if (result.reviewsRecorded > 0 || result.filed.length > 0) {
        console.log(`[flow-review] recorded ${result.reviewsRecorded} review(s); filed or updated ${result.filed.join(", ") || "no item"}`);
      }
      return result;
    });
  },
);
