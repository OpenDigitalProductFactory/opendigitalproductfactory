/** Closed discriminators for deterministic scheduled-agent-task execution. */
export const SCHEDULED_AGENT_TASK_KINDS = [
  "product-intelligence-watch",
  "product-management-playbook",
  "business-analysis-watch",
] as const;

export type ScheduledAgentTaskKind =
  (typeof SCHEDULED_AGENT_TASK_KINDS)[number];

export const BUSINESS_ANALYSIS_WATCH_TASK_KIND =
  SCHEDULED_AGENT_TASK_KINDS[2];

export function isScheduledAgentTaskKind(
  value: unknown,
): value is ScheduledAgentTaskKind {
  return (
    typeof value === "string" &&
    (SCHEDULED_AGENT_TASK_KINDS as readonly string[]).includes(value)
  );
}
