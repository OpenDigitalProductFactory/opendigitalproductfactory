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

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export async function runCoworkerCertificationJob() {
  const { runCoworkerCertificationSweep } = await import(
    "@/lib/coworker-lifecycle/certification-runner"
  );
  const sweep = await runCoworkerCertificationSweep();
  return {
    passed: sweep.passed,
    failed: sweep.failed,
    agents: sweep.results.map((r) => ({ agentId: r.agentId, status: r.status })),
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
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("coworker-certification", runCoworkerCertificationJob);
  },
);

export const coworkerCertificationRunNow = inngest.createFunction(
  {
    id: "ops/coworker-certification-run-now",
    retries: 0,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: "ops/coworker-certification.requested" }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("coworker-certification", runCoworkerCertificationJob);
  },
);
