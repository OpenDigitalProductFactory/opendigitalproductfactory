import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Use-it-or-lose-it capacity drain — evaluates hourly. Near the weekly
// allocation reset, with a healthy pool and free build slots, it dispatches the
// top demand-ranked ready work so pre-paid LLM capacity is not wasted. No-op
// unless capacityDrainEnabled (opt-in). Kernel decision DI-5FED0D945EBB.
export const capacityDrainScheduled = inngest.createFunction(
  {
    id: "build/capacity-drain-scheduled",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    // Off-minute hourly (avoids the top-of-hour fleet stampede).
    triggers: [cron("17 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "build/capacity-drain-scheduled");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("evaluate-capacity-drain", async () => {
      const { prisma } = await import("@dpf/db");
      const { evaluateAndDrainCapacity } = await import("@/lib/capacity/evaluate-drain");
      const { dispatchApprovedIdeateBuilds } = await import("@/lib/build/ideate-on-approval");
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");

      // Refresh the REAL weekly-quota snapshot before evaluating, so the drain
      // policy burns on live remaining allocation rather than the proxy. Opt-in
      // + fail-closed: a no-op unless the operator has declared the creds path
      // and enabled collection (BI-779FA953). Never throws into the drain.
      const { collectClaudeCliWeeklyQuota } = await import("@/lib/routing/weekly-quota-collector");
      const collect = await collectClaudeCliWeeklyQuota().catch(() => ({ collected: false, reason: "collector threw" }));

      const userId = await resolveScheduledOwnerUserId();
      const result = await evaluateAndDrainCapacity({ prisma, userId });
      // Fire Ideate for anything the drain just promoted (same completion the
      // daily tee-up does), so drained builds don't strand in `ideate`.
      const ideateDispatch = result.drained
        ? await dispatchApprovedIdeateBuilds({ userId })
        : null;
      return { ...result, ideateDispatch, weeklyCollect: collect };
    });
  },
);
