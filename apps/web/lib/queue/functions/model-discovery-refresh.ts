import { cron } from "inngest";
import { inngest } from "../inngest-client";

export const modelDiscoveryRefresh = inngest.createFunction(
  {
    id: "inference/model-discovery-refresh",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 4 * * *")], // 4 AM daily
  },
  async ({ step }) => {
    await step.run("refresh-all-providers", async () => {
      const { runModelDiscoveryRefresh } = await import(
        "@/lib/inference/model-discovery-scheduler"
      );
      await runModelDiscoveryRefresh();
    });
  },
);
