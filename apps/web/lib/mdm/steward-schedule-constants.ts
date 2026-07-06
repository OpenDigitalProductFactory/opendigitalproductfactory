/**
 * Autonomous Data Steward schedule constants (EP-4A12A7CB slice 4).
 * Kept separate from the Inngest function so the scheduled-jobs catalog and
 * the parity test can import the ids without pulling the queue runtime.
 */
export const MDM_STEWARD_JOB_ID = "mdm-steward-sweep";
export const MDM_STEWARD_JOB_NAME = "MDM Data Steward sweep";
export const MDM_STEWARD_SCHEDULED_INNGEST_ID = "ops/mdm-steward-sweep-scheduled";
export const MDM_STEWARD_REQUESTED_INNGEST_ID = "ops/mdm-steward-sweep-requested";
export const MDM_STEWARD_REQUESTED_EVENT = "ops/mdm-steward.requested";
/**
 * Daily at 04:50 UTC — after the 03:00 data-model mirror and 04:00 SysML
 * projection so the sweep runs on freshly reconciled data, and on a distinct
 * minute offset so it never shares a tick with the 05:00 jobs (scheduling-map
 * contention guard: no cron shared by 3+ jobs). Keep this literal in sync with
 * the catalog entry in scheduled-jobs/catalog.ts.
 */
export const MDM_STEWARD_CRON = "50 4 * * *";
export const MDM_STEWARD_CADENCE = "Daily at 04:50 UTC";
