// EP-DATA-RETENTION — Scheduled data-retention sweep (inngest).
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md
//
// Daily purge of accumulating operational/telemetry/log/chat data past its
// retention window. Regulated records (financial/tax/compliance/licensing/HR/
// consent) are never touched — see policies.ts RETAINED_DATASETS.
//
// Runs at 04:00 UTC, strictly AFTER the 03:00 backup crons, so a durable backup
// always exists before any row is purged. Quiescence-gated (skips cleanly during
// a self-upgrade drain) and concurrency-limited to one in-flight run. The
// operator kill switch (ScheduledJob.enabled=false) is honored inside
// executeScheduledRetentionSweep.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  DATA_RETENTION_CRON,
  DATA_RETENTION_REQUESTED_EVENT,
  DATA_RETENTION_SCHEDULED_INNGEST_ID,
  DATA_RETENTION_REQUESTED_INNGEST_ID,
} from "@/lib/operate/retention/constants";

export const dataRetentionSweepScheduled = inngest.createFunction(
  {
    id: DATA_RETENTION_SCHEDULED_INNGEST_ID,
    retries: 1,
    // One sweep at a time. A still-running sweep (catching up a backlog) must
    // not overlap the next nightly trigger.
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(DATA_RETENTION_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, DATA_RETENTION_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("data-retention-sweep", async () => {
      const { executeScheduledRetentionSweep } = await import(
        "@/lib/operate/retention/run"
      );
      return executeScheduledRetentionSweep({ dryRun: false });
    });
  },
);

// Manual one-shot trigger for the admin "run now" action. Supports a dry-run
// (count-only) preview via `event.data.dryRun = true`.
export const dataRetentionSweepRequested = inngest.createFunction(
  {
    id: DATA_RETENTION_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: DATA_RETENTION_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const dryRun = Boolean(
      (event.data as { dryRun?: boolean } | undefined)?.dryRun,
    );
    return step.run("data-retention-sweep-manual", async () => {
      const { executeScheduledRetentionSweep } = await import(
        "@/lib/operate/retention/run"
      );
      return executeScheduledRetentionSweep({ dryRun });
    });
  },
);
