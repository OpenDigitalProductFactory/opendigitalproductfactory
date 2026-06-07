// Inngest cron: scheduled research proposals (BI-8A58C65A slice D).
// Weekly, proposes the standard research topics per org (slice D logic in
// lib/wiki/research-schedule.ts). Proposals await human approval (slice B);
// nothing executes here. Cadence is a conservative weekly default — tune the
// cron below.

import { cron } from "inngest";
import { inngest } from "@/lib/queue/inngest-client";
import { proposeScheduledResearch } from "@/lib/wiki/research-schedule";

export const researchScheduleScan = inngest.createFunction(
  { id: "research/schedule-scan", retries: 1, triggers: [cron("0 9 * * 1")] }, // Mon 09:00
  async ({ step }) => {
    const result = await step.run("propose-scheduled-research", async () =>
      proposeScheduledResearch(),
    );
    return { ok: true, ...result };
  },
);
