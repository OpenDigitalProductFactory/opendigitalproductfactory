// Inngest cron: age stale decision material (BI-06B2EC05).
// Daily, transitions researched/derived material past the staleness window from
// `current` to `stale` so aged research stops driving decisions at full weight.
// Logic lives in lib/decision-perspective/material-freshness.ts.

import { cron } from "inngest";
import { inngest } from "@/lib/queue/inngest-client";
import { decayStaleMaterials } from "@/lib/decision-perspective/material-freshness";

export const materialFreshnessDecay = inngest.createFunction(
  { id: "decision/material-freshness-decay", retries: 1, triggers: [cron("0 3 * * *")] }, // daily 03:00
  async ({ step }) => {
    const result = await step.run("decay-stale-materials", async () => decayStaleMaterials());
    return { ok: true, ...result };
  },
);
