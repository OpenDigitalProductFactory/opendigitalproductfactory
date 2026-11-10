// Inngest cron: age stale decision material (BI-06B2EC05).
// Daily, transitions researched/derived material past the staleness window from
// `current` to `stale` so aged research stops driving decisions at full weight.
// Logic lives in lib/decision-perspective/material-freshness.ts.

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { decayStaleMaterials } from "@/lib/decision-perspective/material-freshness";

export const materialFreshnessDecay = jobs.createFunction(
  { id: "decision/material-freshness-decay", retries: 1, triggers: [cron("20 3 * * *")] }, // daily 03:20 — staggered off the 03:00 batch
  async ({ step }) => {
    const result = await step.run("decay-stale-materials", async () => decayStaleMaterials());
    return { ok: true, ...result };
  },
);
