// apps/web/lib/queue/functions/obligation-assurance-watch.ts
//
// The `cadence` trigger of the obligation-assurance-watch work shape (TAK
// §8.11). It runs the deadline-horizon sweep and raises findings onto the
// Assurance Ledger without anyone asking.
//
// This job NEVER decides the response to a finding. The shape declares the
// `decide` stage as a governed decision owned by the accountable compliance
// owner (§8.11.2 — a proactivity setting can change how often the watch runs,
// never who answers for the response). The job sweeps, raises, and reconciles.
//
// Mirrors business-journey-watchdog.ts: pure exported job + thin Inngest
// wrappers (cron + run-now event) behind the quiescence gate.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  OBLIGATION_WATCH_CRON,
  OBLIGATION_WATCH_INNGEST_ID,
  OBLIGATION_WATCH_REQUESTED_EVENT,
  OBLIGATION_WATCH_RUN_NOW_INNGEST_ID,
} from "@/lib/compliance/obligation-watch-constants";

export type ObligationAssuranceWatchResult = {
  runId: string;
  findings: number;
  created: number;
  reopened: number;
  reconciled: number;
  stoppedBy: { kind: string; reason: string } | null;
};

export async function runObligationAssuranceWatchJob(
  now: Date = new Date(),
): Promise<ObligationAssuranceWatchResult> {
  const { prisma } = await import("@dpf/db");
  const { runDeadlineHorizonSweep } = await import("@/lib/compliance/deadline-horizon-runner");
  const result = await runDeadlineHorizonSweep(prisma as never, { now });
  return {
    runId: result.runId,
    findings: result.findings.length,
    created: result.created,
    reopened: result.reopened,
    reconciled: result.reconciled,
    stoppedBy: result.stoppedBy,
  };
}

export const obligationAssuranceWatchScheduled = inngest.createFunction(
  {
    id: OBLIGATION_WATCH_INNGEST_ID,
    retries: 1,
    // Serialize with itself: two concurrent sweeps would race on the same
    // finding rows and double-count the reconcile.
    concurrency: [{ limit: 1 }],
    triggers: [cron(OBLIGATION_WATCH_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, OBLIGATION_WATCH_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("obligation-assurance-watch", () => runObligationAssuranceWatchJob());
  },
);

export const obligationAssuranceWatchRunNow = inngest.createFunction(
  {
    id: OBLIGATION_WATCH_RUN_NOW_INNGEST_ID,
    retries: 0,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: OBLIGATION_WATCH_REQUESTED_EVENT }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, OBLIGATION_WATCH_RUN_NOW_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("obligation-assurance-watch", () => runObligationAssuranceWatchJob());
  },
);
