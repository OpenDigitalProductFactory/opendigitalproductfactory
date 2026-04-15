import { cron } from "inngest";
import { Pool } from "pg";
import { inngest } from "../inngest-client";

// Lazy singleton pool — created once per process, reused across invocations.
let _pgPool: Pool | undefined;
function getPool(): Pool {
  if (!_pgPool) {
    _pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pgPool;
}

export const modelDiscoveryRefresh = inngest.createFunction(
  {
    id: "inference/model-discovery-refresh",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 3 * * *")], // 3 AM daily (EP-MODEL-CAP-001-D)
  },
  async ({ step }) => {
    await step.run("refresh-all-providers", async () => {
      const { runModelRevalidation } = await import(
        "@/lib/inference/model-revalidation"
      );
      await runModelRevalidation({ source: "scheduled" }, getPool());
    });
  },
);
