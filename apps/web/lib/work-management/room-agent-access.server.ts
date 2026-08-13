/**
 * Prisma resolver for agent Work Room access (EP-WORKROOM-COMMS, BI-AD057F18 + BI-4402DABB).
 * Assembles the outcome-scoped ref sets — room policy + the assigned agent + the
 * capsules working the room (so an external CLI executor is admitted to its own
 * room, realizing "the local client joins its room") — then applies the pure
 * decision. Server-only; see room-agent-access.ts for the pure core.
 */
import { prisma } from "@dpf/db";

import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import { authorizeAgentRoomAccess } from "./room-agent-access";
import type { WorkRoomAccessDecision, WorkRoomAccessLevel } from "./room-participation";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

export interface AgentRoomAccessResult {
  decision: WorkRoomAccessDecision;
  agentPrincipalId: string | null;
}

const DEFAULT_AGENT_CLEARANCE = ["public", "internal"] as const;

/**
 * Resolve whether `agentId` may access the room backed by `workItem` at `requested`.
 * Admission (action) = room policy action refs + the capsules anchored to this room
 * (their lease/creator/requester principals) + the assigned agent's principal.
 */
export async function resolveAgentRoomAccess(input: {
  agentId: string;
  requested: Exclude<WorkRoomAccessLevel, "none">;
  workItem: { id: string; evidence: unknown; assignedToAgentId: string | null };
}): Promise<AgentRoomAccessResult> {
  const principal = await ensureAgentPrincipalIdentity(input.agentId);
  const agentPrincipalId = principal?.id ?? null;
  if (!agentPrincipalId) {
    return { decision: { level: "none", reason: "not-admitted" }, agentPrincipalId: null };
  }

  const [clearanceRow, capsules, assignedPrincipal] = await Promise.all([
    prisma.principal.findUnique({
      where: { principalId: agentPrincipalId },
      select: { sensitivityClearance: true },
    }),
    prisma.workCapsule.findMany({
      where: { workItemId: input.workItem.id },
      select: {
        leaseHolderPrincipalId: true,
        createdByPrincipalId: true,
        requestedByPrincipalId: true,
      },
    }),
    input.workItem.assignedToAgentId
      ? ensureAgentPrincipalIdentity(input.workItem.assignedToAgentId)
      : Promise.resolve(null),
  ]);

  const agentSensitivityClearance =
    (clearanceRow?.sensitivityClearance as string[] | undefined) ?? [...DEFAULT_AGENT_CLEARANCE];
  const policy = readWorkspaceRoomPolicy(input.workItem.evidence);

  const capsuleHolderRefs = capsules.flatMap((capsule) =>
    [capsule.leaseHolderPrincipalId, capsule.createdByPrincipalId, capsule.requestedByPrincipalId]
      .filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
  );

  const actionPrincipalRefs = [
    ...(policy.actionPrincipalRefs ?? []),
    ...capsuleHolderRefs,
    ...(assignedPrincipal?.id ? [assignedPrincipal.id] : []),
  ];
  const admittedPrincipalRefs = [...(policy.admittedPrincipalRefs ?? []), ...actionPrincipalRefs];

  const decision = authorizeAgentRoomAccess({
    requested: input.requested,
    agentPrincipalRef: agentPrincipalId,
    agentSensitivityClearance,
    admittedPrincipalRefs,
    actionPrincipalRefs,
    discoverablePrincipalRefs: policy.discoverablePrincipalRefs ?? [],
    sensitivityCeiling: policy.sensitivityCeiling ?? "internal",
  });

  return { decision, agentPrincipalId };
}
