import { cron } from "inngest";
import { inngest } from "../inngest-client";

// Weekly Hive Scout sweep of the 500-AI-Agents-Projects catalog.
// 08:17 UTC Monday — off-peak and intentionally off the :00 mark.
export const hiveScoutIngest = inngest.createFunction(
  {
    id: "hive/scout-ingest",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("17 8 * * 1")],
  },
  async ({ step }) => {
    await step.run("run-ingest", async () => {
      const { runHiveScoutIngest } = await import(
        "@/lib/actions/hive-scout/ingest-500-agents"
      );
      const result = await runHiveScoutIngest();
      return result;
    });
  },
);
