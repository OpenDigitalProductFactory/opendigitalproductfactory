import { S5_REHEARSAL_APPROVAL_ACTION } from "@/lib/workroom-runtime/s5-rehearsal-approval-action";

type ApprovalActionPolicy = {
  completion: "decision-only";
  decision: "owner-one-time";
};

// Server-owned registrations for envelope actions that are not executable
// tools. Never derive this policy from the decision request or stored args.
const POLICIES: ReadonlyMap<string, ApprovalActionPolicy> = new Map([
  [S5_REHEARSAL_APPROVAL_ACTION, { completion: "decision-only", decision: "owner-one-time" }],
]);

export function approvalActionPolicy(actionId: string): ApprovalActionPolicy | undefined {
  return POLICIES.get(actionId);
}
