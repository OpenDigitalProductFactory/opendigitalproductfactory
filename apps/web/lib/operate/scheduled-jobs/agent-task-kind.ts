/** Closed discriminators for deterministic scheduled-agent-task execution. */
export const SCHEDULED_AGENT_TASK_KINDS = [
  "product-intelligence-watch",
  "product-management-playbook",
  "business-analysis-watch",
  // TAK §8.11 — a standing watch over recorded obligations, reviews, and
  // expiries. Distinct from the product/business watches above because its
  // trigger is `deadline-horizon` (a recorded due date entering a look-ahead
  // window), not a cadence over free-form research.
  "assurance-watch",
  // S-TRIG (BI-DC738330) — the weekly books cadence. Deterministically opens or
  // advances the standing Bookkeeping Work Room's cycle for the current period;
  // handled off the LLM path (like the data-model mirror), not a free-form watch.
  "bookkeeping-cycle",
] as const;

export type ScheduledAgentTaskKind =
  (typeof SCHEDULED_AGENT_TASK_KINDS)[number];

export const BUSINESS_ANALYSIS_WATCH_TASK_KIND =
  SCHEDULED_AGENT_TASK_KINDS[2];

export const ASSURANCE_WATCH_TASK_KIND =
  SCHEDULED_AGENT_TASK_KINDS[3];

export const BOOKKEEPING_CYCLE_TASK_KIND =
  SCHEDULED_AGENT_TASK_KINDS[4];

export function isScheduledAgentTaskKind(
  value: unknown,
): value is ScheduledAgentTaskKind {
  return (
    typeof value === "string" &&
    (SCHEDULED_AGENT_TASK_KINDS as readonly string[]).includes(value)
  );
}
