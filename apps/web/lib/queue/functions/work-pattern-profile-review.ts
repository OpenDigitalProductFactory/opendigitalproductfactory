import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

export const workPatternProfileReview = jobs.createFunction(
  {
    id: "quality/work-pattern-profile-review",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("17 7 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "quality/work-pattern-profile-review");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("review-agent-work-patterns", async () => {
      const { runDueWorkPatternProfileReviews } = await import(
        "@/lib/tak/work-pattern-profile-review"
      );
      return runDueWorkPatternProfileReviews();
    });
  },
);
