// apps/web/lib/queue/functions/coworker-certification.ts
// EP-COWORKER-LIFECYCLE Phase 2 (BI-DE9CC88B) — nightly coworker certification.
//
// Exercises every roster coworker's golden journeys through the real
// execution path (read-only tool surface) and persists per-coworker
// AssuranceRun/AssuranceFinding records the workforce roster reads. This is
// the job that keeps "defined but never exercised" from recurring: a coworker
// that stops working is a failed certification the next night, not a
// production surprise weeks later.
//
// Mirrors patch-assessment-sweep.ts: pure exported sweep + thin Inngest
// wrappers (cron + run-now event) behind the quiescence gate.
//
// Capacity backpressure (BI-44E401B5): a journey that cannot be assessed because
// inference was at its concurrency ceiling is NOT a coworker failure. The sweep
// marks it "inconclusive"; the wrapper then sleeps and re-runs only the still-
// inconclusive coworkers, so they are certified when a slot frees rather than
// wrongly failed on a busy box — the queue is the booking system, we do not turn
// autonomous work away. Bounded so a persistently-saturated box eventually stops
// (those coworkers stay un-promoted, never failed).

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/** Max capacity-backpressure requeue attempts, and the sleep between them. With
 *  the origin-aware admission budget (autonomous waits ~30m per call) this covers
 *  a long saturation window before giving up for the night. */
const MAX_CAPACITY_REQUEUES = 6;
const CAPACITY_REQUEUE_BACKOFF = "10m";

export type CoworkerCertificationJobResult = {
  passed: number;
  failed: number;
  inconclusive: number;
  agents: Array<{ agentId: string; status: "passed" | "failed" | "inconclusive" }>;
  inconclusiveAgentIds: string[];
};

export async function runCoworkerCertificationJob(
  agentIds?: string[],
): Promise<CoworkerCertificationJobResult> {
  const { runCoworkerCertificationSweep } = await import(
    "@/lib/coworker-lifecycle/certification-runner"
  );
  const sweep = await runCoworkerCertificationSweep(agentIds ? { agentIds } : undefined);
  return {
    passed: sweep.passed,
    failed: sweep.failed,
    inconclusive: sweep.inconclusive,
    agents: sweep.results.map((r) => ({ agentId: r.agentId, status: r.status })),
    inconclusiveAgentIds: sweep.results
      .filter((r) => r.status === "inconclusive")
      .map((r) => r.agentId),
  };
}

export const coworkerCertificationNightly = inngest.createFunction(
  {
    id: "ops/coworker-certification-nightly",
    retries: 1,
    // Serialize with itself; certification runs real inference per coworker.
    concurrency: [{ limit: 1 }],
    triggers: [cron("40 4 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/coworker-certification-nightly");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    // Full roster, then requeue only capacity-inconclusive coworkers (below).
    let agentIds: string[] | undefined = undefined;
    let last = await step.run("coworker-certification", () =>
      runCoworkerCertificationJob(agentIds),
    );
    for (let attempt = 1; attempt <= MAX_CAPACITY_REQUEUES; attempt++) {
      if (last.inconclusiveAgentIds.length === 0) break;
      // Sleep durably (the function suspends — it does not hold an inference
      // slot) and re-run only the coworkers left inconclusive by capacity.
      await step.sleep(`capacity-backoff-${attempt}`, CAPACITY_REQUEUE_BACKOFF);
      agentIds = last.inconclusiveAgentIds;
      last = await step.run(`coworker-certification-requeue-${attempt}`, () =>
        runCoworkerCertificationJob(agentIds),
      );
    }
    return last;
  },
);

export const coworkerCertificationRunNow = inngest.createFunction(
  {
    id: "ops/coworker-certification-run-now",
    retries: 0,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: "ops/coworker-certification.requested" }],
  },
  async ({ step, event }) => {
    const gate = await gateAtEntry(step, "ops/coworker-certification-run-now");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const requested = (event?.data as { agentIds?: unknown } | undefined)?.agentIds;
    let agentIds: string[] | undefined = Array.isArray(requested)
      ? requested.filter((a): a is string => typeof a === "string")
      : undefined;
    let last = await step.run("coworker-certification", () =>
      runCoworkerCertificationJob(agentIds),
    );
    for (let attempt = 1; attempt <= MAX_CAPACITY_REQUEUES; attempt++) {
      if (last.inconclusiveAgentIds.length === 0) break;
      await step.sleep(`capacity-backoff-${attempt}`, CAPACITY_REQUEUE_BACKOFF);
      agentIds = last.inconclusiveAgentIds;
      last = await step.run(`coworker-certification-requeue-${attempt}`, () =>
        runCoworkerCertificationJob(agentIds),
      );
    }
    return last;
  },
);
