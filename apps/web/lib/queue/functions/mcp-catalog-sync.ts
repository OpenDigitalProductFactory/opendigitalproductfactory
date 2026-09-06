import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const mcpCatalogSync = inngest.createFunction(
  {
    id: "ops/mcp-catalog-sync",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "ops/mcp-catalog.sync" }],
  },
  async ({ event, step }) => {
    // Gate at entry only — once the sync is running it's killable:false
    // (mid-upsert state would be lost). Refuses NEW syncs during drain;
    // an in-flight sync runs to completion. See spec §6.3.
    const gate = await gateAtEntry(step, "ops/mcp-catalog-sync");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    await step.run("run-sync", async () => {
      const { runMcpCatalogSync } = await import("@/lib/mcp-catalog-sync");
      await runMcpCatalogSync(event.data.syncId);
    });
    await step.run("record-job", async () => {
      const { prisma } = await import("@dpf/db");
      const { computeNextRunAt } = await import("@/lib/ai-provider-types");
      const job = await prisma.scheduledJob.findUnique({
        where: { jobId: "mcp-catalog-sync" },
      });
      if (job) {
        await prisma.scheduledJob.update({
          where: { jobId: "mcp-catalog-sync" },
          data: {
            lastStatus: "completed",
            lastRunAt: new Date(),
            nextRunAt: computeNextRunAt(job.schedule, new Date()),
          },
        });
      }
    });
  },
);
