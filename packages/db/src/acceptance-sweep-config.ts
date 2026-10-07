// The standing daily acceptance sweep (BI-DF255666, slice 2 of BI-5F3D6A37).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.3.
// Plan:   docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md, phase 2.
//
// Nothing periodically looked at awaiting-acceptance items: only their authors
// took them out. This task revisits the pool in bounded pages, records who owes
// each item's acceptance, and reports the pool's age every day.
//
// Config lives here beside decision-engine-review-config.ts because the seed
// (packages/db) and the deterministic executor (apps/web) both need it, and
// neither may import the other.

export const ACCEPTANCE_SWEEP_TASK_ID = "acceptance-sweep-daily";

/** Portfolio Advisor: the same steward as the decision-engine review. */
export const ACCEPTANCE_SWEEP_AGENT_ID = "AGT-WS-PORTFOLIO";

export const ACCEPTANCE_SWEEP_TASK_TITLE = "Acceptance sweep (daily)";

export const ACCEPTANCE_SWEEP_ROUTE_CONTEXT = "/ops";

/** 05:00 UTC daily: before the weekly decision review (Mon 06:00) and the bookkeeping cycle. */
export const ACCEPTANCE_SWEEP_SCHEDULE = "0 5 * * *";

export const ACCEPTANCE_SWEEP_DEFAULT_TIMEZONE = "UTC";

export const ACCEPTANCE_SWEEP_SCHEDULED_JOB_NAME = "Acceptance Sweep Daily";

export const ACCEPTANCE_SWEEP_TASK_KIND = "acceptance-sweep";

/** An item is aged at this many days in awaiting-acceptance (two 7-day review points, design §3.2). */
export const ACCEPTANCE_AGED_DAYS = 14;

/** The trend line every run records (AC-AA-06). */
export const ACCEPTANCE_TREND_DAYS = 30;

/** Readiness evaluations per run. The whole pool is revisited every ceil(N / page) runs (design §7). */
export const ACCEPTANCE_SWEEP_PAGE_SIZE = 100;

/** Aged items routed to a coworker per run. Used from phase 3 (BI-C1781121). */
export const ACCEPTANCE_SWEEP_ROUTE_LIMIT = 10;

/** Coworker routing stays off until phase 3 (BI-C1781121) lands and is verified. */
export const ACCEPTANCE_SWEEP_ROUTING = false;

/**
 * Recorded for the operator reading the schedule, not sent to a model. The
 * executor is deterministic: readiness projection, grant-backed owner
 * resolution and SQL. There is no LLM in the run.
 */
export const ACCEPTANCE_SWEEP_PROMPT =
  "Revisit a bounded page of awaiting-acceptance backlog items: compute each item's completion "
  + "readiness, record who owes its acceptance (or why no coworker can be named) when that changed, "
  + "and write one run summary to the standing Acceptance room with the pool's age bands, items aged "
  + "over 30 days, closable items and unroutable items by code. Deterministic: no model judgement.";
