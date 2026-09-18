// ScheduledAgentTask.lastStatus — the verdict of a scheduled agent run.
//
// Three states, not two. A run whose required mutation was diverted into an
// AgentActionProposal has not FAILED — it is waiting on a person, and calling
// that an error is what taught coworkers to read a governed platform as a
// broken one (BI-4F64C5D3, #5335). The column was documented as "ok | error"
// while "proposed" was already being written to it, so the comment was false
// and nothing noticed. It is a closed set in Postgres now
// ("ScheduledAgentTask_lastStatus_closed_set"), and the parity test beside this
// file fails the build if these two copies ever drift (BI-9F6AFFA0).

import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";

export const SCHEDULED_AGENT_TASK_STATUSES = ["ok", "error", "proposed"] as const;

export type ScheduledAgentTaskStatus = (typeof SCHEDULED_AGENT_TASK_STATUSES)[number];

/**
 * What kind of answer each run verdict is — total by construction, so a fourth
 * status cannot be added without deciding what it MEANS (§10 rule 6).
 *
 * "proposed" is the non-verdict: the run did what it could and stopped at a
 * human. countsAsFailure() is false for it, which is the whole point.
 */
export const SCHEDULED_AGENT_TASK_DISPOSITION: Record<
  ScheduledAgentTaskStatus,
  OutcomeDisposition
> = {
  ok: "proceed",
  error: "refused",
  proposed: "awaiting-person",
};

export function isScheduledAgentTaskStatus(value: unknown): value is ScheduledAgentTaskStatus {
  return (
    typeof value === "string" &&
    (SCHEDULED_AGENT_TASK_STATUSES as readonly string[]).includes(value)
  );
}
