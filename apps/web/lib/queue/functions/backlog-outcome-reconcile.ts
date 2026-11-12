// apps/web/lib/queue/functions/backlog-outcome-reconcile.ts
//
// Hourly reconciliation of backlog item outcomes (BI-8DE5429B):
//   1. open items with no outcome get one through the intake derivation
//      (lib/backlog/outcome-backfill.ts), at most 250 per run;
//   2. reopens from done and failing evidence while done are recorded as
//      regressed / not achieved against the item's own outcome
//      (lib/product-management/delivered-work-outcomes-repository.ts).
// Both are idempotent compare-and-set writes; this is the gated cron wrapper.

import { cron } from "@/lib/jobs/triggers";
import { prisma } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { backfillBacklogItemOutcomes, type OutcomeBackfillDb } from "@/lib/backlog/outcome-backfill";
import {
  recordItemOutcomeEvents,
  type DeliveredWorkOutcomeDb,
} from "@/lib/product-management/delivered-work-outcomes-repository";

export const BACKLOG_OUTCOME_RECONCILE_ID = "ops/backlog-outcome-reconcile";
export const BACKLOG_OUTCOME_RECONCILE_CRON = "41 * * * *";

export const backlogOutcomeReconcile = jobs.createFunction(
  {
    id: BACKLOG_OUTCOME_RECONCILE_ID,
    retries: 1,
    triggers: [cron(BACKLOG_OUTCOME_RECONCILE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, BACKLOG_OUTCOME_RECONCILE_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const backfill = await step.run("backfill-item-outcomes", async () =>
      backfillBacklogItemOutcomes(prisma as unknown as OutcomeBackfillDb));
    const events = await step.run("record-item-outcome-events", async () =>
      recordItemOutcomeEvents(prisma as unknown as DeliveredWorkOutcomeDb, { now: new Date() }));
    if (backfill.filled > 0 || events.recorded > 0) {
      console.info(
        `[backlog-outcome-reconcile] filled ${backfill.filled} (stated ${backfill.bySource.stated}, derived ${backfill.bySource.derived}), `
        + `${backfill.remaining} remaining; recorded ${events.recorded} item outcome event(s)${events.truncated ? " (more remain)" : ""}`,
      );
    }
    return { backfill, events };
  },
);
