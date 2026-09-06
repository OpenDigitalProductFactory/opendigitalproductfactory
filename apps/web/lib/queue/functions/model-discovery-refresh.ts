import { cron } from "inngest";
import { Pool } from "pg";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// jobId of the catalog ScheduledJob row this cron corresponds to.
const JOB_ID = "model-discovery-refresh";

// Lazy singleton pool — created once per process, reused across invocations.
let _pgPool: Pool | undefined;
function getPool(): Pool {
  if (!_pgPool) {
    _pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pgPool;
}

/**
 * Stamp the catalog ScheduledJob row so the Scheduled Jobs UI reflects when model
 * discovery last ran and whether it succeeded (BI-86CC0266). Previously this
 * function never wrote back, so the row read lastRunAt=NULL indefinitely even
 * while the cron fired — hiding whether discovery was healthy and making it look
 * permanently "never run". Best-effort: never fail the job over a stamp.
 */
async function recordRun(status: "ok" | "error", error?: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  await prisma.scheduledJob
    .update({
      where: { jobId: JOB_ID },
      data: { lastRunAt: new Date(), lastStatus: status, lastError: error ?? null },
    })
    .catch(() => {});
}

export const modelDiscoveryRefresh = inngest.createFunction(
  {
    id: "inference/model-discovery-refresh",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("10 3 * * *")], // 03:10 UTC — staggered off the 03:00 batch (EP-MODEL-CAP-001-D)
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "inference/model-discovery-refresh");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    try {
      await step.run("refresh-all-providers", async () => {
        const { runModelRevalidation } = await import(
          "@/lib/inference/model-revalidation"
        );
        await runModelRevalidation({ source: "scheduled" }, getPool());
      });
      await step.run("record-success", () => recordRun("ok"));
    } catch (err) {
      await step.run("record-failure", () => recordRun("error", String(err).slice(0, 500)));
      throw err;
    }
  },
);
