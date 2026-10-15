import { jobs, type BuildGauntletRepairEvent } from "@/lib/jobs";

// BI-B2EEA6DE: one repair of a build's guard findings, then back to review.
// One run per build at a time; the attempt bound lives in gauntlet-repair.ts.
export const buildGauntletRepair = jobs.createFunction(
  {
    id: "build/gauntlet-repair",
    retries: 0,
    concurrency: [{ key: "event.data.buildId", limit: 1 }],
    triggers: [{ event: "build/gauntlet.repair" }],
  },
  async ({ event, step }) => {
    const { buildId } = event.data as BuildGauntletRepairEvent["data"];
    const outcome = await step.run("repair-guard-findings", async () => {
      const { runGauntletRepair } = await import("@/lib/build/gauntlet-repair");
      return runGauntletRepair(buildId);
    });
    return { buildId, outcome };
  },
);
