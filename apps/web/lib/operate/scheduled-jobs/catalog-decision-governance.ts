// Decision-governance scheduled jobs, split out of catalog.ts (BI-C62127B9).
//
// The catalog is one hand-maintained list by design — see its header for why
// reflection cannot replace it — but it sits against an 800-line ceiling with a
// paired hotspot count, so it grows by DOMAIN GROUP rather than by row. This is
// the first such group; the next domain to add a job should follow it rather
// than pushing the shared file over again.

import {
  CONCIERGE_SWEEP_CADENCE,
  CONCIERGE_SWEEP_CRON,
  CONCIERGE_SWEEP_JOB_ID,
  CONCIERGE_SWEEP_JOB_NAME,
  CONCIERGE_SWEEP_REQUESTED_EVENT,
  CONCIERGE_SWEEP_SCHEDULED_INNGEST_ID,
} from "@/lib/decision/concierge-sweep-constants";

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const DECISION_GOVERNANCE_JOBS: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: CONCIERGE_SWEEP_JOB_ID,
    honorsEnabledGate: true,
    inngestId: CONCIERGE_SWEEP_SCHEDULED_INNGEST_ID,
    name: CONCIERGE_SWEEP_JOB_NAME,
    purpose:
      "EP-0AF96937 (BI-C62127B9): looks at the decisions waiting on a human, convenes the coworkers whose profession the question touches, and drafts what the owner should do. Bounded per pass and reports what it deferred. It never resolves a decision — every draft waits on a human ruling. If it stops, decisions still surface but the owner starts from a blank field again.",
    cron: CONCIERGE_SWEEP_CRON,
    cadence: CONCIERGE_SWEEP_CADENCE,
    category: "editable",
    tracksRunData: false,
    runNowEvent: CONCIERGE_SWEEP_REQUESTED_EVENT,
  },
] as const;
