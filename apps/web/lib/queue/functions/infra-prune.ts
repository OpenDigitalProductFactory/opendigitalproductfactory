import { cron } from "inngest";
import { inngest } from "../inngest-client";

export const infraPrune = inngest.createFunction(
  { id: "ops/infra-prune", retries: 2, triggers: [cron("0 3 * * 0")] },
  async ({ step }) => {
    await step.run("prune-stale", async () => {
      const { pruneStaleInfraCIs, prisma } = await import("@dpf/db");
      const { computeNextRunAt } = await import("@/lib/ai-provider-types");

      const result = await pruneStaleInfraCIs({
        markDecommissionedAfterDays: 30,
        deleteAfterDays: 90,
      });

      const now = new Date();
      await prisma.scheduledJob.update({
        where: { jobId: "infra-ci-prune" },
        data: {
          lastRunAt: now,
          lastStatus: "ok",
          lastError: null,
          nextRunAt: computeNextRunAt("weekly", now),
        },
      }).catch(() => {});

      return result;
    });
  },
);
