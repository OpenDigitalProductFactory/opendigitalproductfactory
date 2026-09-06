import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily aggregator for the governed Hermes-style skill telemetry surface.
 * Runs at 05:00 UTC — verified 2026-05-15 against live ScheduledJob rows
 * and repo cron seeds; no other job uses that slot.
 *
 * The aggregator is idempotent and re-aggregates the current period on each
 * run, so a missed tick is recovered automatically on the next one. On-
 * demand admin invocation lives in `apps/web/lib/actions/skills-observatory.ts`.
 */
export const skillMetricsAggregator = inngest.createFunction(
  {
    id: "skills/metrics-aggregator",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 5 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "skills/metrics-aggregator");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("aggregate-current-period", async () => {
      const { aggregateSkillMetrics } = await import("@/lib/skills/skill-metrics");
      const result = await aggregateSkillMetrics();
      console.log(
        `[skill-metrics] daily aggregation upserted ${result.upserted} rows for period ${result.period}`,
      );
      return result;
    });
  },
);
