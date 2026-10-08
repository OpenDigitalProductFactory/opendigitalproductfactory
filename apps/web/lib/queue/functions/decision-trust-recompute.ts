// The cadence behind governed-decision TrustState (BI-7D1E43DE).
//
// A scheduled pass and a manual "run now", both quiescence-gated and
// single-flight. The pass is idempotent (see decision-trust-state-store.ts), so
// a rerun only refreshes lastEvaluatedAt. It measures; it never changes a level.

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import {
  DECISION_TRUST_RECOMPUTE_CRON,
  DECISION_TRUST_RECOMPUTE_REQUESTED_EVENT,
  DECISION_TRUST_RECOMPUTE_REQUESTED_INNGEST_ID,
  DECISION_TRUST_RECOMPUTE_SCHEDULED_INNGEST_ID,
} from "@/lib/decision/decision-trust-recompute-constants";

async function runPass() {
  const { prisma } = await import("@dpf/db");
  const { runDecisionTrustRecompute } = await import("@/lib/decision/decision-trust-state-store");
  return runDecisionTrustRecompute(prisma as never);
}

export const decisionTrustRecomputeScheduled = jobs.createFunction(
  {
    id: DECISION_TRUST_RECOMPUTE_SCHEDULED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(DECISION_TRUST_RECOMPUTE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, DECISION_TRUST_RECOMPUTE_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("decision-trust-recompute", () => runPass());
  },
);

export const decisionTrustRecomputeRequested = jobs.createFunction(
  {
    id: DECISION_TRUST_RECOMPUTE_REQUESTED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: DECISION_TRUST_RECOMPUTE_REQUESTED_EVENT }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, DECISION_TRUST_RECOMPUTE_REQUESTED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("decision-trust-recompute", () => runPass());
  },
);
