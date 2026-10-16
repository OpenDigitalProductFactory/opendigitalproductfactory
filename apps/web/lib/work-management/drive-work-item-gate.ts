// The drive acts only on live work (BI-72679FE0). Pure: the status read is in
// the drive job (lib/queue/functions/workroom-drive.ts).
//
// A delivery room outlives its item. When the item is done, awaiting
// acceptance, deferred or retired, the room is still non-terminal and still
// carries its shape, so the drive kept planning it. On 2026-10-14 the
// author-stage pre-authorisation (BI-8A32EBFF) let those plans dispatch: 277
// rooms whose item was finished or deferred got an agent at their first stage,
// every run left no evidence, and every room became a "Needs you" stall card.
//
// The rule is read from the item, the one record that says whether work is
// wanted:
//   - parked (done, deferred, retired): the room stands down entirely.
//   - delivered (awaiting-acceptance): no agent runs and no agent-side hold is
//     raised, but a person stage (the acceptance itself) still asks.
// A conformance stop or escalation is never hidden; a person must still see it.
// A stood-down room records do_not_wake/work_item_inactive, which deactivates
// its task and replaces its pause, so an existing stall card leaves on the next
// tick with no data repair. When the item is reopened the next tick plans it
// again.

import type { DrivePlan } from "./drive-resolution";

export type WorkItemStanding = "active" | "delivered" | "parked";

const PARKED: ReadonlySet<string> = new Set(["done", "deferred", "retired"]);
const DELIVERED: ReadonlySet<string> = new Set(["awaiting-acceptance"]);

/** An unbound room, or one whose item could not be read, is driven as before. */
export function workItemStanding(status: string | null | undefined): WorkItemStanding {
  if (!status) return "active";
  if (PARKED.has(status)) return "parked";
  if (DELIVERED.has(status)) return "delivered";
  return "active";
}

/** Holds that exist only because an agent was, or would be, dispatched. */
const AGENT_SIDE_PAUSES: ReadonlySet<string> = new Set(["executor_writeback_unavailable", "missing_task_owner"]);

function standsDown(plan: DrivePlan, standing: WorkItemStanding): boolean {
  if (standing === "active") return false;
  if (plan.action === "stop" || plan.action === "escalate" || plan.action === "do_not_wake") return false;
  if (standing === "parked") return true;
  return plan.action === "dispatch_agent" || (plan.action === "pause" && AGENT_SIDE_PAUSES.has(plan.reason));
}

export function gateDrivePlanOnWorkItem(plan: DrivePlan, itemStatus: string | null | undefined): DrivePlan {
  if (!standsDown(plan, workItemStanding(itemStatus))) return plan;
  // Graph-only fields are dropped so the runner applies this as one sequential, quiet tick.
  const { tokens: _tokens, marking: _marking, rework: _rework, deadlinesDue: _deadlines, subShapes: _subShapes, ...rest } = plan;
  return {
    ...rest,
    action: "do_not_wake",
    reason: "work_item_inactive",
    agentId: null,
    attentionPrincipalRef: null,
    taskId: null,
    ledger: [`The room's work item is ${itemStatus}; the drive stands down until it is active again.`],
  };
}
