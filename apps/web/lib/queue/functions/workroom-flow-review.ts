import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/**
 * EP-B70E718D F8 (BI-3C98682D): the daily flow review. Each place where rooms
 * pile up becomes (or recurs) an ImprovementSignal; the improvement facility
 * files one backlog item when the same pile persists across reviews.
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §8.
 */
export const workroomFlowReview = jobs.createFunction(
  {
    id: "workroom/flow-review",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    // Once a day: recurrence across reviews is the persistence signal.
    triggers: [cron("23 6 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "workroom/flow-review");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("review-flow", async () => {
      const { loadPortfolioFlowView } = await import("@/lib/work-management/area-flow.server");
      const { bottleneckSignal, findFlowBottlenecks } = await import("@/lib/work-management/flow-review");
      const { createOrTouchImprovementSignal } = await import("@/lib/improvement-flywheel/signals");
      const { getWorkShape } = await import("@/lib/work-management/work-shapes");
      const findings = findFlowBottlenecks(await loadPortfolioFlowView());
      let filed = 0;
      for (const finding of findings) {
        const title = getWorkShape(finding.shapeRef.split("@")[0]!)?.title ?? finding.shapeRef;
        const result = await createOrTouchImprovementSignal(bottleneckSignal(finding, title));
        if (result.backlogItemId) filed += 1;
      }
      return { findings: findings.length, filed };
    });
  },
);
