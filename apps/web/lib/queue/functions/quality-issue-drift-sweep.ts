// BI-0B420A1D — Scheduled quality-issue drift sweep (inngest).
//
// The runtime half of quality-issue governance. The registry
// (packages/db/src/quality-issue-registry.ts) is the compile-time gate; this
// makes each type's declared lifecycle live on the operator's install:
//
//   1. self-heal the recovery/orphan backstop (close stale issues whose scoped
//      row is active again or gone), and
//   2. detect DRIFT — any queue over its declared `expectedSteadyState` budget —
//      so a newly-accumulating detector is surfaced automatically rather than
//      found by inspection two months and thousands of rows later.
//
// It does NOT file backlog items or route work; the returned `drift` is the
// input the holistic auto-processing thread consumes (drift -> BI -> weekly
// token budget -> Build Studio / owning coworker). Runs daily at 05:00 UTC,
// after discovery has had a chance to run and reconcile in-sweep. Quiescence-
// gated and concurrency-limited to one in-flight run.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const qualityIssueDriftSweepScheduled = inngest.createFunction(
  {
    id: "governance/quality-issue-drift-sweep-scheduled",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    // Staggered off the crowded 05:00 tick (BI-SCHED-STAGGER contention guard);
    // still early morning, after discovery has had a chance to run + reconcile.
    triggers: [cron("23 5 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "governance/quality-issue-drift-sweep-scheduled");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("quality-issue-drift-sweep", async () => {
      const { prisma, runQualityIssueDriftSweep } = await import("@dpf/db");
      const report = await runQualityIssueDriftSweep(prisma as never);
      const resolved = Object.values(report.autoResolved).reduce((a, b) => a + b, 0);
      if (resolved > 0 || !report.healthy) {
        console.log(
          `[quality-issue-drift] auto-resolved ${resolved}; ${
            report.healthy ? "no drift" : `${report.drift.length} queue(s) over budget: ` +
              report.drift.map((d) => `${d.type}=${d.open} (owner ${d.owner})`).join(", ")
          }`,
        );
      }
      return report;
    });
  },
);

// Manual one-shot trigger for the admin "run now" action.
export const qualityIssueDriftSweepRequested = inngest.createFunction(
  {
    id: "governance/quality-issue-drift-sweep-requested",
    retries: 1,
    triggers: [{ event: "governance/quality-issue-drift-sweep.requested" }],
  },
  async ({ step }) => {
    return step.run("quality-issue-drift-sweep-manual", async () => {
      const { prisma, runQualityIssueDriftSweep } = await import("@dpf/db");
      return runQualityIssueDriftSweep(prisma as never);
    });
  },
);
