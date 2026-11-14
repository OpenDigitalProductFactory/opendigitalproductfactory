import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/**
 * build/plan-gate-stall-invariant — every 15 minutes (BI-9FA1F9CF). Files one
 * deduplicated PlatformIssueReport per Build Studio build whose plan passed its
 * own review but has been refused on PLAN_REQUIRED for 15 minutes or more. The
 * existing issue-report triage path promotes it. Observes only; it never
 * records a receipt or advances a build.
 *
 * Mirrors coworker-regression-detect: same retries, quiescence gate and lazy import.
 */
export const planGateStallInvariant = jobs.createFunction(
  {
    id: "build/plan-gate-stall-invariant",
    retries: 2,
    triggers: [cron("4,19,34,49 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "build/plan-gate-stall-invariant");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("check-plan-gate-stalls", async () => {
      const { runPlanGateStallInvariant } = await import("@/lib/build/plan-gate-stall-invariant");
      return runPlanGateStallInvariant();
    });
  },
);
