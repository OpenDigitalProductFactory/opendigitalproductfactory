import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

/**
 * EP-3516E23D Phase 1 — hourly rollup of the QueueTelemetryEvent stream into
 * QueueMetricSnapshot rows (one per queueKey × day). Runs at :07 each hour so
 * the current day's snapshot stays fresh through the day; the aggregator is
 * idempotent and re-aggregates the whole current UTC day on each run, so a
 * missed tick self-heals on the next one (mirrors skill-metrics-aggregator).
 *
 * Spec: docs/superpowers/specs/2026-07-06-reusable-queueing-substrate-design.md §4.2
 */
export const queueMetricsAggregator = jobs.createFunction(
  {
    id: "queue/metrics-aggregator",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("7 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "queue/metrics-aggregator");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    // EP-B70E718D F2: replay the drive log into Workroom stage telemetry once,
    // so stage trends start with history. Idempotent; a no-op after first run.
    await step.run("backfill-workroom-stages", async () => {
      const { backfillWorkroomStageTelemetry, defaultStageBackfillDeps } = await import(
        "@/lib/work-management/workroom-stage-backfill"
      );
      const result = await backfillWorkroomStageTelemetry(await defaultStageBackfillDeps());
      if (result.ran) {
        console.log(
          `[queue-metrics] replayed ${result.transitions} workroom stage transition(s) over ${result.days} day(s), up to ${result.until}`,
        );
      }
      return result;
    });

    return step.run("aggregate-current-day", async () => {
      const { aggregateQueueMetrics, defaultRollupDeps } = await import(
        "@/lib/queue/queue-metrics-rollup"
      );
      const result = await aggregateQueueMetrics(await defaultRollupDeps());
      console.log(
        `[queue-metrics] rolled up ${result.upserted} queue snapshot(s) for period ${result.period}`,
      );
      return result;
    });
  },
);
