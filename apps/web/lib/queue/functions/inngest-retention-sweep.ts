// BI-0AB96FE7 (EP-B9DD37C7) — Scheduled Inngest history-retention + orphan reap.
//
// Prevention item #1 for the Inngest executor wedge: the self-hosted Inngest
// Postgres history (function_runs, spans, …) has no TTL/GC, and runs whose
// Redis {estate} state TTL-expires strand as orphans the single executor
// retries forever — until it chokes and drives ZERO executions (a silent, total
// outage of all scheduled + autonomous dispatch). This janitor bounds the
// history and reaps the orphans on a schedule so the executor can never starve.
//
// Runs every 6 hours. Quiescence-gated (skips cleanly during a self-upgrade
// drain) and concurrency-limited to one in-flight run. The operator kill switch
// (ScheduledJob.enabled=false) is honored inside the runner.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  INNGEST_RETENTION_CRON,
  INNGEST_RETENTION_REQUESTED_EVENT,
  INNGEST_RETENTION_SCHEDULED_INNGEST_ID,
  INNGEST_RETENTION_REQUESTED_INNGEST_ID,
} from "@/lib/operate/inngest-retention/constants";

export const inngestRetentionSweepScheduled = inngest.createFunction(
  {
    id: INNGEST_RETENTION_SCHEDULED_INNGEST_ID,
    retries: 1,
    // One sweep at a time. A still-running sweep (catching up a large backlog)
    // must not overlap the next trigger.
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(INNGEST_RETENTION_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, INNGEST_RETENTION_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("inngest-retention-sweep", async () => {
      const { executeScheduledInngestRetentionSweep } = await import(
        "@/lib/operate/inngest-retention/run"
      );
      return executeScheduledInngestRetentionSweep({ dryRun: false });
    });
  },
);

// Manual one-shot trigger for the admin "run now" action. Supports a dry-run
// (count-only) preview via `event.data.dryRun = true`.
export const inngestRetentionSweepRequested = inngest.createFunction(
  {
    id: INNGEST_RETENTION_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: INNGEST_RETENTION_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const dryRun = Boolean(
      (event.data as { dryRun?: boolean } | undefined)?.dryRun,
    );
    return step.run("inngest-retention-sweep-manual", async () => {
      const { executeScheduledInngestRetentionSweep } = await import(
        "@/lib/operate/inngest-retention/run"
      );
      return executeScheduledInngestRetentionSweep({ dryRun });
    });
  },
);
