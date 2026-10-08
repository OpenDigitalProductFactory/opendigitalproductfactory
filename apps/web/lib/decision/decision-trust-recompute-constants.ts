// Identity and cadence of the governed-decision TrustState recompute
// (BI-7D1E43DE). Split out so the Inngest function and the Scheduled Jobs
// catalog name the same job rather than two strings that can drift.

export const DECISION_TRUST_RECOMPUTE_JOB_ID = "decision-trust-recompute";
export const DECISION_TRUST_RECOMPUTE_JOB_NAME = "Decision trust measurement";
export const DECISION_TRUST_RECOMPUTE_SCHEDULED_INNGEST_ID = "decision-trust-recompute-scheduled";
export const DECISION_TRUST_RECOMPUTE_REQUESTED_INNGEST_ID = "decision-trust-recompute-requested";
export const DECISION_TRUST_RECOMPUTE_REQUESTED_EVENT = "decision/trust-recompute.requested";
/** Every six hours. Agreement accrues slowly; a fresher number would not be a better one. */
export const DECISION_TRUST_RECOMPUTE_CRON = "41 */6 * * *";
export const DECISION_TRUST_RECOMPUTE_CADENCE = "Every 6 hours";
