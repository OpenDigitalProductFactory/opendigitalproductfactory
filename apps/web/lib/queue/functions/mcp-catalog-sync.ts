import { inngest } from "../inngest-client";

export const mcpCatalogSync = inngest.createFunction(
  {
    id: "ops/mcp-catalog-sync",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "ops/mcp-catalog.sync" }],
  },
  async ({ event, step }) => {
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
