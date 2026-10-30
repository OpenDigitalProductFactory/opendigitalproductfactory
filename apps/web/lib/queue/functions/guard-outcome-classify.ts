import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily guard outcome classification (BI-FEDD8F45). Classifies each guard
 * refusal as caught / overridden / false-refusal / unresolved from later runs,
 * writes the classification rows, and prunes guard-outcome rows past 365 days.
 * Runs at 05:43 UTC, before the retirement review at 06:40.
 */
export const guardOutcomeClassify = jobs.createFunction(
  {
    id: "ops/guard-outcome-classify",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("43 5 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/guard-outcome-classify");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("classify-guard-refusals", async () => {
      const { runGuardOutcomeClassification } = await import("@/lib/gpp/efficacy/guard-outcome-jobs");
      const result = await runGuardOutcomeClassification();
      console.log(
        `[guard-outcome-classify] series=${result.series} remaining=${result.seriesRemaining} incomplete=${result.incompleteSeries.length} runs=${result.runsLoaded} classified=${result.classified} written=${result.written} pruned=${result.pruned}`,
      );
      return result;
    });
  },
);
