import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Owner/manager metrics are refreshed off the request path. Recomputing the
 * current and prior local-business day makes the job idempotent and lets a
 * missed run self-heal without deleting the last valid snapshot.
 */
export const businessMetricsAggregator = inngest.createFunction(
  {
    id: "business/metrics-aggregator",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("17 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("aggregate-business-metrics", async () => {
      const { aggregateBusinessMetrics } = await import(
        "@/lib/performance/business-metric-rollup"
      );
      const { defaultBusinessMetricRollupDeps } = await import(
        "@/lib/performance/business-metric-rollup.server"
      );
      const result = await aggregateBusinessMetrics(
        defaultBusinessMetricRollupDeps(),
      );
      console.log(
        `[business-metrics] refreshed ${result.upserted} rollups across ${result.organizations} organization(s)`,
      );
      return result;
    });
  },
);
