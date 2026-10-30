import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily guard retirement review (BI-FEDD8F45). A guard refused but never
 * caught, or with a false-refusal rate above 25%, gets one review item; guards
 * that never refused land in one weekly digest item. Nothing is disabled or
 * deleted. Runs at 06:40 UTC, an hour after classification.
 */
export const guardRetirementReview = jobs.createFunction(
  {
    id: "ops/guard-retirement-review",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("40 6 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/guard-retirement-review");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("review-guards", async () => {
      const { runGuardRetirementReview } = await import("@/lib/gpp/efficacy/guard-outcome-jobs");
      const { evaluation, filed, digest } = await runGuardRetirementReview();
      console.log(
        `[guard-retirement-review] filed=${filed.filter((f) => f.created).length} recurring=${filed.filter((f) => !f.created).length} deferred=${evaluation.deferred.length} digest=${digest ? digest.guards : 0} silenced=${evaluation.silencedByKeep.length} undeclared=${evaluation.undeclared.length}`,
      );
      return {
        filed,
        digest,
        deferred: evaluation.deferred.map((f) => f.guardId),
        silencedByKeep: evaluation.silencedByKeep,
        undeclared: evaluation.undeclared.length,
      };
    });
  },
);
