// apps/web/lib/queue/functions/business-journey-watchdog.ts
// BI-E105303D / EP-PROACTIVE-OPS — the critical business journey watchdog.
//
// Exercises the install's revenue-critical journeys (front door, enquiry,
// booking, sign-in, checkout) against the RUNNING install, records evidence into
// the existing assurance store, and routes failures to the operator through the
// Attention Surface.
//
// Cadence is Mon/Wed/Fri at 06:00, not nightly. A watchdog run costs real work —
// HTTP calls plus transaction rehearsals — and three times a week catches a
// broken signup inside a working day while keeping cost per verified outcome
// low. 06:00 also keeps it clear of the 04:00–05:00 nightly block (data-model
// mirror, SysML projection, memory consolidation, coworker certification), so
// it never contends with them for the same tick.
//
// Mirrors coworker-certification.ts: pure exported job + thin Inngest wrappers
// (cron + run-now event) behind the quiescence gate.
//
// This job NEVER creates a build, opens a PR, or merges a fix. It records,
// raises, and notifies. Remediation goes through the governed backlog flow at
// the operator's initiative.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  BUSINESS_JOURNEY_WATCHDOG_CRON,
  BUSINESS_JOURNEY_WATCHDOG_INNGEST_ID,
  BUSINESS_JOURNEY_WATCHDOG_REQUESTED_EVENT,
  BUSINESS_JOURNEY_WATCHDOG_RUN_NOW_INNGEST_ID,
} from "@/lib/business-journeys/watchdog-constants";

export type BusinessJourneyWatchdogResult = {
  runId: string;
  passed: number;
  failed: number;
  notApplicable: number;
  failedJourneyIds: string[];
};

export async function runBusinessJourneyWatchdogJob(): Promise<BusinessJourneyWatchdogResult> {
  const { runJourneySweep } = await import("@/lib/business-journeys/runner");
  const sweep = await runJourneySweep();
  return {
    runId: sweep.runId,
    passed: sweep.passed,
    failed: sweep.failed,
    notApplicable: sweep.notApplicable,
    failedJourneyIds: sweep.journeys
      .filter((j) => j.status === "failed")
      .map((j) => j.journeyId),
  };
}

export const businessJourneyWatchdogScheduled = inngest.createFunction(
  {
    id: BUSINESS_JOURNEY_WATCHDOG_INNGEST_ID,
    retries: 1,
    // Serialize with itself: two concurrent sweeps would race on the same
    // journey-failure rows and on the data-path rehearsal slots.
    concurrency: [{ limit: 1 }],
    triggers: [cron(BUSINESS_JOURNEY_WATCHDOG_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, BUSINESS_JOURNEY_WATCHDOG_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("business-journey-watchdog", () => runBusinessJourneyWatchdogJob());
  },
);

export const businessJourneyWatchdogRunNow = inngest.createFunction(
  {
    id: BUSINESS_JOURNEY_WATCHDOG_RUN_NOW_INNGEST_ID,
    retries: 0,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: BUSINESS_JOURNEY_WATCHDOG_REQUESTED_EVENT }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, BUSINESS_JOURNEY_WATCHDOG_RUN_NOW_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("business-journey-watchdog", () => runBusinessJourneyWatchdogJob());
  },
);
