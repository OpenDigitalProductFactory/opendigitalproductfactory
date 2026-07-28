// Scheduling identity for the business-journey watchdog (BI-E105303D).
//
// Deliberately dependency-free, mirroring catalog-sweep-constants.ts and
// identity-inference-constants.ts: the scheduled-jobs catalog and the admin
// surface must be able to name this job WITHOUT importing the Inngest function
// module and dragging the whole queue client into their graph.

export const BUSINESS_JOURNEY_WATCHDOG_JOB_ID = "business-journey-watchdog";
export const BUSINESS_JOURNEY_WATCHDOG_JOB_NAME = "Business journey watchdog";
export const BUSINESS_JOURNEY_WATCHDOG_INNGEST_ID = "ops/business-journey-watchdog";
export const BUSINESS_JOURNEY_WATCHDOG_RUN_NOW_INNGEST_ID =
  "ops/business-journey-watchdog-run-now";
export const BUSINESS_JOURNEY_WATCHDOG_REQUESTED_EVENT =
  "ops/business-journey-watchdog.requested";

/**
 * Mon/Wed/Fri at 06:00 — not nightly.
 *
 * A sweep costs real work (HTTP calls plus transaction rehearsals), and three
 * runs a week still catch a broken signup within a working day. 06:00 keeps it
 * clear of the 04:00–05:00 nightly block so it never shares a tick with the
 * data-model mirror, SysML projection, memory consolidation, or coworker
 * certification.
 */
export const BUSINESS_JOURNEY_WATCHDOG_CRON = "0 6 * * 1,3,5";
export const BUSINESS_JOURNEY_WATCHDOG_CADENCE = "Mon/Wed/Fri at 06:00";
