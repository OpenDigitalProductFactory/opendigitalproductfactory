// The standing weekly decision-engine self-review (BI-19CEC4B4).
//
// Founder direction, 2026-09-08: "the platform needs to continuously be
// responsible for optimizing itself and presenting to the right human what
// may / should be changed. How many decisions were made, where missing corpus
// or weights need to be examined."
//
// Config lives here beside bookkeeping-cycle-config.ts because the seed
// (packages/db) and the deterministic executor (apps/web) both need it, and
// neither may import the other. Same shape as BOOKKEEPING_CYCLE_*.

export const DECISION_ENGINE_REVIEW_TASK_ID = "decision-engine-review-weekly";

/** Portfolio Advisor: the coworker accountable for routing findings to scope owners. */
export const DECISION_ENGINE_REVIEW_AGENT_ID = "AGT-WS-PORTFOLIO";

export const DECISION_ENGINE_REVIEW_TASK_TITLE = "Decision-engine review (weekly)";

export const DECISION_ENGINE_REVIEW_ROUTE_CONTEXT = "/coworker-decisions/review";

/**
 * Monday 06:00 UTC — before the bookkeeping cycle at 09:00, so a week's
 * governance findings are waiting when the operating week opens.
 */
export const DECISION_ENGINE_REVIEW_SCHEDULE = "0 6 * * 1";

export const DECISION_ENGINE_REVIEW_DEFAULT_TIMEZONE = "UTC";

export const DECISION_ENGINE_REVIEW_SCHEDULED_JOB_NAME = "Decision Engine Review Weekly";

export const DECISION_ENGINE_REVIEW_TASK_KIND = "decision-engine-review";

/**
 * Recorded for the operator reading the schedule, not sent to a model. The
 * executor is deterministic SQL and pure measures; there is no LLM in the run.
 */
export const DECISION_ENGINE_REVIEW_PROMPT =
  "Measure the decision engine over the trailing week from the DecisionInteraction ledger: "
  + "volume by scope and gate, specialist fallback rate, material starvation, repeated "
  + "escalations, unlearned outcomes, agreement rate, and weight-sensitive verdicts. "
  + "Route each finding to the scope that owns it as a proposal with its evidence. "
  + "Deterministic: no model judgement is involved in producing the measures.";
