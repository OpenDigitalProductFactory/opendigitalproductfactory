import { S5_REHEARSAL_APPROVAL_ACTION } from "@/lib/workroom-runtime/s5-rehearsal-approval-action";

type DecisionEnvelope = {
  authorityDecisionId?: string | null;
  inputFingerprint?: string | null;
  approvalBindingFingerprint?: string | null;
  delegatingUserId: string;
  coworkerAgentId: string;
};

type ApprovalActionPolicy = {
  completion: "decision-only";
  decision: "owner-one-time";
  authorizeDecision: (envelope: DecisionEnvelope, userId: string) => Promise<boolean>;
};

// Server-owned registrations for envelope actions that are not executable
// tools. Never derive this policy from the decision request or stored args.
const POLICIES: ReadonlyMap<string, ApprovalActionPolicy> = new Map([
  [S5_REHEARSAL_APPROVAL_ACTION, {
    completion: "decision-only", decision: "owner-one-time",
    authorizeDecision: async (envelope, userId) =>
      (await import("@/lib/workroom-runtime/s5-rehearsal-approver.server")).canDecideS5RehearsalEnvelope(envelope, userId),
  }],
]);

export function approvalActionPolicy(actionId: string): ApprovalActionPolicy | undefined {
  return POLICIES.get(actionId);
}
