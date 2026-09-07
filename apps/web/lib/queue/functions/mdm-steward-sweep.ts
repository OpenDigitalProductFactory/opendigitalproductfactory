// EP-4A12A7CB slice 4 — Autonomous Data Steward scheduled sweep (inngest).
//
// Spec: docs/superpowers/specs/2026-07-04-mdm-write-time-dedup-and-lifecycle-design.md §10
//
// Daily pass that runs the MDM sweep and lets the Data Steward coworker
// auto-resolve account duplicates it is confident about (full autonomy incl.
// fuzzy matches, operator decision 2026-07-06) — accountable via audit trail,
// unmerge undo, a per-run cap, and a conflicting-domain guardrail (see
// lib/mdm/autonomous-steward.ts). Quiescence-gated (skips during a
// self-upgrade drain), concurrency 1, honors the ScheduledJob.enabled kill
// switch inside the runner.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  MDM_STEWARD_CRON,
  MDM_STEWARD_REQUESTED_EVENT,
  MDM_STEWARD_SCHEDULED_INNGEST_ID,
  MDM_STEWARD_REQUESTED_INNGEST_ID,
  MDM_STEWARD_JOB_ID,
} from "@/lib/mdm/steward-schedule-constants";

/** Kill switch: operators pause the Data Steward via ScheduledJob.enabled=false.
 *  Routed through the one shared implementation (BI-7E49FA15); default-on when
 *  no row exists or the read fails. */
async function isEnabled(): Promise<boolean> {
  const { isJobEnabled } = await import("@/lib/operate/scheduled-jobs/core");
  return isJobEnabled(MDM_STEWARD_JOB_ID);
}

export const mdmStewardSweepScheduled = inngest.createFunction(
  {
    id: MDM_STEWARD_SCHEDULED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(MDM_STEWARD_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, MDM_STEWARD_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    if (!(await step.run("mdm-steward-enabled", isEnabled))) {
      return { skipped: true, reason: "disabled" };
    }
    return step.run("mdm-steward-sweep", async () => {
      const { runAutonomousStewardship } = await import("@/lib/mdm/autonomous-steward");
      return runAutonomousStewardship({ dryRun: false });
    });
  },
);

// Manual one-shot trigger for the admin "run now" action; supports dry-run.
export const mdmStewardSweepRequested = inngest.createFunction(
  {
    id: MDM_STEWARD_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: MDM_STEWARD_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const dryRun = Boolean((event.data as { dryRun?: boolean } | undefined)?.dryRun);
    return step.run("mdm-steward-sweep-manual", async () => {
      const { runAutonomousStewardship } = await import("@/lib/mdm/autonomous-steward");
      return runAutonomousStewardship({ dryRun });
    });
  },
);
