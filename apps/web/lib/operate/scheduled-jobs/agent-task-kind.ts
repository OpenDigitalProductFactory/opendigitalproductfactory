/** Closed discriminators for deterministic scheduled-agent-task execution. */
export const SCHEDULED_AGENT_TASK_KINDS = [
  "product-intelligence-watch",
] as const;

export type ScheduledAgentTaskKind =
  (typeof SCHEDULED_AGENT_TASK_KINDS)[number];

export function isScheduledAgentTaskKind(
  value: unknown,
): value is ScheduledAgentTaskKind {
  return (
    typeof value === "string" &&
    (SCHEDULED_AGENT_TASK_KINDS as readonly string[]).includes(value)
  );
}
