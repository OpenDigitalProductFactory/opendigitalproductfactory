import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Staleness escalation thresholds for the 15-minute code-graph reconcile
// (BI-12E646D3): raise an operator-visible PlatformIssueReport after 4
// consecutive failed runs (~1h) or when no successful reconcile has happened for
// 2h, instead of silently retrying forever. Env-overridable.
const CODE_GRAPH_STALE_THRESHOLDS = {
  maxConsecutiveErrors: Number(process.env.CODE_GRAPH_STALE_MAX_ERRORS) || 4,
  maxAgeMs: Number(process.env.CODE_GRAPH_STALE_MAX_AGE_MS) || 2 * 3_600_000,
};

async function recordCodeGraphJob(status: "ok" | "error", error?: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { computeNextRunAt } = await import("@/lib/ai-provider-types");
  const { CODE_GRAPH_JOB_ID } = await import("@/lib/build/code-graph-refresh");
  const { evaluateJobStaleness, readStalenessState, mergeStalenessState, escalateStaleScheduledJob } = await import(
    "@/lib/operate/scheduled-jobs/staleness-escalation"
  );

  const job = await prisma.scheduledJob.findUnique({
    where: { jobId: CODE_GRAPH_JOB_ID },
  });
  if (!job) return;

  const now = new Date();
  // BI-12E646D3 (make-silent-failures-observable): track success recency in job
  // metadata and escalate when the reconcile goes stale, so a silently-failing
  // code graph (which degrades code search / impact analysis) becomes a
  // queryable operator signal instead of an invisible multi-day drift.
  const decision = evaluateJobStaleness(readStalenessState(job.metadata), status, now, CODE_GRAPH_STALE_THRESHOLDS);

  await prisma.scheduledJob.update({
    where: { jobId: CODE_GRAPH_JOB_ID },
    data: {
      lastRunAt: now,
      lastStatus: status,
      lastError: error ?? null,
      nextRunAt: computeNextRunAt(job.schedule, now),
      metadata: mergeStalenessState(job.metadata, decision.nextState) as import("@dpf/db").Prisma.InputJsonValue,
    },
  });

  if (decision.escalate && decision.reason) {
    await escalateStaleScheduledJob({
      jobId: CODE_GRAPH_JOB_ID,
      reason: decision.reason,
      title: "Code-intelligence graph reconcile is stale",
      description:
        "The scheduled code-graph reconcile is not succeeding. A stale code graph degrades code search and impact analysis across Build Studio and the EA surfaces until it recovers.",
      routeContext: "/platform",
    });
  }
}

// BI-9BF17415 (make-silent-failures-observable): a scheduled tick deferred by
// the quiescence drain gate is a silent no-op today. Bump a queryable
// consecutive-defer counter on the job's metadata so a job being starved of
// execution windows becomes an observable signal (consumed by the code→AI
// ascent scan, BI-A028AA14) instead of vanishing. Mirrors recordCodeGraphJob.
async function recordCodeGraphDefer(): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { CODE_GRAPH_JOB_ID } = await import("@/lib/build/code-graph-refresh");
  const { readStalenessState, recordJobDefer, mergeStalenessState } = await import(
    "@/lib/operate/scheduled-jobs/staleness-escalation"
  );

  const job = await prisma.scheduledJob.findUnique({ where: { jobId: CODE_GRAPH_JOB_ID } });
  if (!job) return;

  await prisma.scheduledJob.update({
    where: { jobId: CODE_GRAPH_JOB_ID },
    data: {
      metadata: mergeStalenessState(
        job.metadata,
        recordJobDefer(readStalenessState(job.metadata)),
      ) as import("@dpf/db").Prisma.InputJsonValue,
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
    const gate = await gateAtEntry(step, "ops/code-graph-reconcile-scheduled");
    if (!gate.proceed) {
      // BI-9BF17415: record the deferral as a counter before bailing, so a job
      // repeatedly starved by the drain gate surfaces instead of silently skipping.
      await step.run("record-defer", async () => {
        await recordCodeGraphDefer();
      });
      return { skipped: true, reason: gate.reason };
    }

    // Per-job kill switch (BI-5A42E572). Honour an operator's disable from the
    // Scheduled Jobs admin surface in addition to the global gate. Defaults to
    // enabled when no row exists, so a never-touched job runs normally.
    const enabled = await step.run("check-job-enabled", async () => {
      const { isJobEnabled } = await import("@/lib/operate/scheduled-jobs/core");
      const { CODE_GRAPH_JOB_ID } = await import("@/lib/build/code-graph/constants");
      return isJobEnabled(CODE_GRAPH_JOB_ID);
    });
    if (!enabled) return { skipped: true, reason: "job_disabled_by_operator" };

    try {
      const result = await step.run("reconcile-code-graph-scheduled", async () => {
        const { reconcileCodeGraph } = await import("@/lib/build/code-graph-refresh");
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
        const { reconcileCodeGraph } = await import("@/lib/build/code-graph-refresh");
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
