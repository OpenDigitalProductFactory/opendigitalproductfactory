/**
 * Background eval and probe execution via Inngest.
 *
 * These jobs run asynchronously so the admin UI is never blocked.
 * The UI fires an event, shows "Running in background...", and the
 * result appears when the job completes (via page revalidation).
 */

import { inngest } from "../inngest-client";

/**
 * Background dimension eval for a single model.
 * Triggered by the "Run Eval" button on ModelCard / RoutingProfilePanel.
 */
export const evalBackground = inngest.createFunction(
  {
    id: "ai/eval-background",
    retries: 1,
    concurrency: [{ limit: 2 }],
    triggers: [{ event: "ai/eval.run" }],
  },
  async ({ event, step }) => {
    const { endpointId, modelId, userId } = event.data;

    const result = await step.run("run-dimension-eval", async () => {
      const { runDimensionEval } = await import("@/lib/routing/eval-runner");
      return runDimensionEval(endpointId, modelId, userId);
    });

    // Record completion in ScheduledJob for UI visibility
    await step.run("record-completion", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.scheduledJob.upsert({
        where: { jobId: `eval-${modelId}` },
        create: {
          jobId: `eval-${modelId}`,
          schedule: "manual",
          lastRunAt: new Date(),
          lastStatus: "completed",
          nextRunAt: null,
        },
        update: {
          lastRunAt: new Date(),
          lastStatus: "completed",
        },
      });
    });

    return result;
  },
);

/**
 * Background endpoint probes / full tests.
 * Triggered by "Run Probes" and "Run Full Tests" buttons.
 */
export const probeBackground = inngest.createFunction(
  {
    id: "ai/probe-background",
    retries: 1,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: "ai/probe.run" }],
  },
  async ({ event, step }) => {
    const { endpointId, modelId, probesOnly, userId } = event.data;

    const results = await step.run("run-endpoint-tests", async () => {
      const { runEndpointTests } = await import("@/lib/operate/endpoint-test-runner");
      return runEndpointTests({
        endpointId,
        modelId,
        probesOnly,
        triggeredBy: userId,
      });
    });

    await step.run("record-completion", async () => {
      const { prisma } = await import("@dpf/db");
      const jobId = probesOnly ? "probe-run" : "full-test-run";
      await prisma.scheduledJob.upsert({
        where: { jobId },
        create: {
          jobId,
          schedule: "manual",
          lastRunAt: new Date(),
          lastStatus: "completed",
          nextRunAt: null,
        },
        update: {
          lastRunAt: new Date(),
          lastStatus: "completed",
        },
      });
    });

    return { tested: results.length };
  },
);
