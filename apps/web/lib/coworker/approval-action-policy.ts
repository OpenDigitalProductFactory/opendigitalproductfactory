import { S5_REHEARSAL_APPROVAL_ACTION } from "@/lib/workroom-runtime/s5-rehearsal-approval-action";
import type { S5DecisionEnvelope } from "@/lib/workroom-runtime/s5-rehearsal-approver.server";
import type { Prisma } from "@dpf/db";

type ApprovalActionPolicy = {
  completion: "decision-only";
  decision: "owner-one-time";
  commitDecision: <T extends { ok: boolean }>(envelope: S5DecisionEnvelope, userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T | null>;
};

// Server-owned registrations for envelope actions that are not executable
// tools. Never derive this policy from the decision request or stored args.
const POLICIES: ReadonlyMap<string, ApprovalActionPolicy> = new Map([
  [S5_REHEARSAL_APPROVAL_ACTION, {
    completion: "decision-only", decision: "owner-one-time",
    commitDecision: async (envelope, userId, write) =>
      (await import("@/lib/workroom-runtime/s5-rehearsal-approval-producer.server")).commitS5RehearsalApproval(envelope, userId, write),
  }],
]);

export function approvalActionPolicy(actionId: string): ApprovalActionPolicy | undefined {
  return POLICIES.get(actionId);
}
