// The standing demand-scoring steward (BI-00C68162).
//
// 83 of 1,941 open items carried a demand score when this was filed, so the
// value ranking had almost nothing to rank and starts fell back to age. This
// task proposes RICE inputs for a bounded batch of unscored triaged items each
// run, marked agent-proposed so an owner can override them.
//
// Config lives here beside decision-engine-review-config.ts because the seed
// (packages/db) and the deterministic executor (apps/web) both need it, and
// neither may import the other. Same shape as DECISION_ENGINE_REVIEW_*.

export const DEMAND_SCORING_STEWARD_TASK_ID = "demand-scoring-steward-daily";

/** Portfolio Advisor: owns demand triage (skills/product-management/demand-triage). */
export const DEMAND_SCORING_STEWARD_AGENT_ID = "AGT-WS-PORTFOLIO";

export const DEMAND_SCORING_STEWARD_TASK_TITLE = "Propose demand scores for unscored work (daily)";

export const DEMAND_SCORING_STEWARD_ROUTE_CONTEXT = "/ops/demand";

/** Daily 05:41 UTC — before the 14:00 governed tee-up reads the ranking. */
export const DEMAND_SCORING_STEWARD_SCHEDULE = "41 5 * * *";

export const DEMAND_SCORING_STEWARD_DEFAULT_TIMEZONE = "UTC";

export const DEMAND_SCORING_STEWARD_SCHEDULED_JOB_NAME = "Demand Scoring Steward Daily";

export const DEMAND_SCORING_STEWARD_TASK_KIND = "demand-scoring-steward";

/** Seeded taskConfig; an operator may change batchSize on the row (1-200). */
export const DEMAND_SCORING_STEWARD_DEFAULT_CONFIG = { batchSize: 50 } as const;

/**
 * Recorded for the operator reading the schedule, not sent to a model. The
 * executor is deterministic: the same item signals always give the same proposal.
 */
export const DEMAND_SCORING_STEWARD_PROMPT =
  "Propose RICE inputs (reach, impact, confidence, effort) and an investment bucket for a "
  + "bounded batch of unscored open or in-progress backlog items, highest likely value first "
  + "(in-flight epics, user requests, bugs with live evidence). Record each as agent-proposed "
  + "with its basis. Never write over inputs an owner entered. Deterministic: no model judgement.";
