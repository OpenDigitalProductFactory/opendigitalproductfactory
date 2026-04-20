import { cron } from "inngest";
import { inngest } from "../inngest-client";

async function recordCodeGraphJob(status: "ok" | "error", error?: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { computeNextRunAt } = await import("@/lib/ai-provider-types");
  const { CODE_GRAPH_JOB_ID } = await import("@/lib/integrate/code-graph-refresh");

  const job = await prisma.scheduledJob.findUnique({
    where: { jobId: CODE_GRAPH_JOB_ID },
  });
  if (!job) return;

  const now = new Date();
  await prisma.scheduledJob.update({
    where: { jobId: CODE_GRAPH_JOB_ID },
    data: {
      lastRunAt: now,
      lastStatus: status,
      lastError: error ?? null,
      nextRunAt: computeNextRunAt(job.schedule, now),
    },
  });
}

export const codeGraphReconcileScheduled = inngest.createFunction(
  {
    id: "ops/code-graph-reconcile-scheduled",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("*/15 * * * *")],
  },
  async ({ step }) => {
    try {
      const result = await step.run("reconcile-code-graph-scheduled", async () => {
        const { reconcileCodeGraph } = await import("@/lib/integrate/code-graph-refresh");
        return reconcileCodeGraph({ reason: "scheduled" });
      });
      await step.run("record-job-ok", async () => {
        await recordCodeGraphJob("ok");
      });
      return result;
    } catch (error) {
      await step.run("record-job-error", async () => {
        await recordCodeGraphJob("error", error instanceof Error ? error.message : "Unknown reconcile failure");
      });
      throw error;
    }
  },
);

export const codeGraphReconcileEvent = inngest.createFunction(
  {
    id: "ops/code-graph-reconcile-event",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "ops/code-graph.reconcile" }],
  },
  async ({ event, step }) => {
    try {
      const result = await step.run("reconcile-code-graph-event", async () => {
        const { reconcileCodeGraph } = await import("@/lib/integrate/code-graph-refresh");
        return reconcileCodeGraph({
          reason: event.data.reason,
          graphKey: event.data.graphKey,
          forceFull: event.data.forceFull ?? false,
        });
      });
      await step.run("record-job-ok", async () => {
        await recordCodeGraphJob("ok");
      });
      return result;
    } catch (error) {
      await step.run("record-job-error", async () => {
        await recordCodeGraphJob("error", error instanceof Error ? error.message : "Unknown reconcile failure");
      });
      throw error;
    }
  },
);
