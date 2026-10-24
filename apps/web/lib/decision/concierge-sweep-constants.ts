// Identity and cadence of the decision-concierge sweep (BI-C62127B9).
//
// Split out so the Inngest function and the admin Scheduled Jobs catalog name
// the same job rather than two strings that can drift.

export const CONCIERGE_SWEEP_JOB_ID = "decision-concierge-sweep";
export const CONCIERGE_SWEEP_JOB_NAME = "Decision concierge";
export const CONCIERGE_SWEEP_SCHEDULED_INNGEST_ID = "decision-concierge-sweep-scheduled";
export const CONCIERGE_SWEEP_REQUESTED_INNGEST_ID = "decision-concierge-sweep-requested";
export const CONCIERGE_SWEEP_REQUESTED_EVENT = "decision/concierge-sweep.requested";
/** Every four hours. Governance is not an emergency, but a day is too long. */
export const CONCIERGE_SWEEP_CRON = "17 */4 * * *";
export const CONCIERGE_SWEEP_CADENCE = "Every 4 hours";
