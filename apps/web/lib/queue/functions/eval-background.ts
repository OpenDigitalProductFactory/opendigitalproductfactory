/**
 * Background eval and probe execution via Inngest.
 *
 * These jobs run asynchronously so the admin UI is never blocked.
 * The UI fires an event, shows "Running in background...", and the
 * result appears when the job completes (via page revalidation).
 */

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// BI-C8164664: how long a "running" eval slot blocks a duplicate GPU eval for
// the same model. runDimensionEval already skips when the model was EVALUATED
// (lastEvalAt) within its own cooldown — but lastEvalAt is stamped only on a
// SUCCESSFUL run, so an Inngest lease error that re-invokes the function BEFORE
// completion never trips that guard and the GPU eval runs again and again (the
// observed "burns the local GPU" storm). This slot claim is stamped BEFORE the
// GPU work on the eval-background ScheduledJob (not lastEvalAt — that keeps its
// "last successful eval" meaning for the routing/calibration signal), so a
// storm re-invocation sees a recent "running" slot and skips. Override with
// DPF_EVAL_SLOT_COOLDOWN_MS; must comfortably exceed one eval's duration.
const EVAL_SLOT_COOLDOWN_MS = (() => {
  const raw = Number(process.env.DPF_EVAL_SLOT_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 20 * 60_000;
})();

/** Atomically claim the GPU eval slot for a model before running it. Recency-
 *  based: the claim wins only when the last eval attempt for this model is older
 *  than the cooldown (or there is none). A retry/lease-storm re-invocation
 *  within the window loses (count 0) and the caller skips the GPU work. Keyed on
 *  the eval-<modelId> ScheduledJob's lastRunAt — NOT ModelProfile.lastEvalAt,
 *  which must keep meaning "last SUCCESSFUL eval" for the calibration signal.
 *  The stamp self-heals: it ages out after the cooldown, so a genuinely-next
 *  eval proceeds. Exported for testing. */
export async function claimEvalSlot(modelId: string, now: Date = new Date()): Promise<boolean> {
  const { prisma } = await import("@dpf/db");
  const jobId = `eval-${modelId}`;
  const cutoff = new Date(now.getTime() - EVAL_SLOT_COOLDOWN_MS);
  const claimed = await prisma.scheduledJob.updateMany({
    where: { jobId, OR: [{ lastRunAt: { lt: cutoff } }, { lastRunAt: null }] },
    data: { lastRunAt: now },
  });
  if (claimed.count > 0) return true;
  // No row yet (first-ever eval for this model) → create and claim it.
  const existing = await prisma.scheduledJob.findUnique({ where: { jobId }, select: { jobId: true } });
  if (existing) return false; // row exists with a fresh lastRunAt → claim lost.
  await prisma.scheduledJob
    .create({
      data: { jobId, name: `Eval: ${modelId}`, schedule: "manual", lastStatus: "running", lastRunAt: now, nextRunAt: null },
    })
    .catch(() => {});
  return true;
}

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
    const gate = await gateAtEntry(step, "ai/eval-background");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const { endpointId, modelId, userId, force } = event.data;

    // BI-C8164664: claim the GPU eval slot BEFORE the work. A retry/lease-storm
    // re-invocation within the cooldown loses the claim and skips, so the GPU is
    // not re-burned. Operator-forced runs bypass the slot (they also bypass the
    // recency cooldown inside runDimensionEval).
    if (force !== true) {
      const claimed = await step.run("claim-eval-slot", async () => {
        const { claimEvalSlot } = await import("./eval-background");
        return claimEvalSlot(modelId);
      });
      if (!claimed) {
        return { skipped: true, reason: "eval-slot-busy" };
      }
    }

    const result = await step.run("run-dimension-eval", async () => {
      const { runDimensionEval } = await import("@/lib/routing/eval-runner");
      return runDimensionEval(endpointId, modelId, userId, { force: force === true });
    });

    // BI-C8164664: don't stamp ScheduledJob as completed when the eval was
    // skipped by the in-flight guard — that would mask the real status of the
    // last successful eval and make stuck retry loops invisible.
    if (!result.skipped) {
      // Record completion in ScheduledJob for UI visibility
      await step.run("record-completion", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.scheduledJob.upsert({
          where: { jobId: `eval-${modelId}` },
          create: {
            jobId: `eval-${modelId}`,
            name: `Eval: ${modelId}`,
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
    }

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
    const gate = await gateAtEntry(step, "ai/probe-background");
    if (!gate.proceed) return { skipped: true, reason: gate.reason, tested: 0 };

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
          name: probesOnly ? "Endpoint Probes" : "Full Endpoint Tests",
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
