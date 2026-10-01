// Inngest cron: move already-PRed coding-pool items to awaiting-acceptance
// (BI-7161625D). Webhook handles live PR submit; this is the post-upgrade
// backstop for Workrooms that already have a pullRequestNumber.

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { sweepPrSubmittedBacklogItems } from "@/lib/backlog/pr-submit-awaiting-acceptance";

export const prSubmitAwaitingAcceptanceReconcile = jobs.createFunction(
  { id: "backlog/pr-submit-awaiting-acceptance-reconcile", retries: 1, triggers: [cron("7,22,37,52 * * * *")] },
  async ({ step }) => {
    const result = await step.run("sweep-pr-submitted-items", async () =>
      sweepPrSubmittedBacklogItems({ limit: 100 }),
    );
    return { swept: true, ...result };
  },
);
