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
/** Daily at 05:00 UTC — after the 04:00 retention sweep, low-traffic window. */
export const MDM_STEWARD_CRON = "0 5 * * *";
export const MDM_STEWARD_CADENCE = "Daily at 05:00 UTC";
