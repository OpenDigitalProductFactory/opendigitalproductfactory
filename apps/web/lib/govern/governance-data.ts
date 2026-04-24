import crypto from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { getAgentGaidMap } from "@/lib/identity/principal-linking";

export async function getUserTeamIds(userId: string): Promise<string[]> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return memberships.map((membership) => membership.teamId);
}

export async function getAgentGovernance(agentId: string) {
  return prisma.agent.findUnique({
    where: { agentId },
    select: {
      id: true,
      agentId: true,
      governanceProfile: {
        select: {
          autonomyLevel: true,
          hitlPolicy: true,
          allowDelegation: true,
          maxDelegationRiskBand: true,
          capabilityClass: {
            select: {
              capabilityClassId: true,
              riskBand: true,
              defaultActionScope: true,
            },
          },
          directivePolicyClass: {
            select: {
              policyClassId: true,
              approvalMode: true,
              allowedRiskBand: true,
            },
          },
        },
      },
      ownerships: {
        select: {
          responsibility: true,
          team: { select: { teamId: true, name: true } },
        },
      },
    },
  });
}

export async function getActiveDelegationGrants(params: {
  grantorUserId?: string;
  granteeAgentId?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return prisma.delegationGrant.findMany({
    where: {
      status: "active",
      validFrom: { lte: now },
      expiresAt: { gt: now },
      ...(params.grantorUserId ? { grantorUserId: params.grantorUserId } : {}),
      ...(params.granteeAgentId ? { granteeAgent: { agentId: params.granteeAgentId } } : {}),
    },
    orderBy: { expiresAt: "asc" },
    select: {
      id: true,
      grantId: true,
      grantorUserId: true,
      granteeAgentId: true,
      targetUserId: true,
      scopeJson: true,
      riskBand: true,
      status: true,
      validFrom: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      workflowKey: true,
      objectRef: true,
    },
  });
}

export async function createAuthorizationDecisionLog(input: {
  actorType: "user" | "customer_contact" | "agent";
  actorRef: string;
  humanContextRef?: string | null;
  agentContextRef?: string | null;
  delegationGrantId?: string | null;
  actionKey: string;
  objectRef?: string | null;
  decision: "allow" | "deny" | "require_approval";
  rationale: Prisma.InputJsonValue;
}): Promise<void> {
  const agentIdentityRef = input.agentContextRef
    ? (await getAgentGaidMap([input.agentContextRef])).get(input.agentContextRef) ?? input.agentContextRef
    : null;

  await prisma.authorizationDecisionLog.create({
    data: {
      decisionId: crypto.randomUUID(),
      actorType: input.actorType,
      actorRef: input.actorRef,
      humanContextRef: input.humanContextRef ?? null,
      agentContextRef: agentIdentityRef,
      delegationGrantId: input.delegationGrantId ?? null,
      actionKey: input.actionKey,
      objectRef: input.objectRef ?? null,
      decision: input.decision,
      rationale: input.rationale,
    },
  });
}

export async function createUnifiedAuditLog(input: {
  actorRef: string;
  actionKey: string;
  objectRef: string;
  decision: "allow" | "deny" | "require_approval";
  rationale: import("@dpf/db").Prisma.InputJsonValue;
  endpointUsed?: string;
  mode?: "advise" | "act";
  routeContext?: string;
  sensitivityLevel?: string;
  sensitivityOverride?: boolean;
}) {
  return prisma.authorizationDecisionLog.create({
    data: {
      decisionId: crypto.randomUUID(),
      actorType: "user",
      actorRef: input.actorRef,
      actionKey: input.actionKey,
      objectRef: input.objectRef,
      decision: input.decision,
      rationale: input.rationale,
      endpointUsed: input.endpointUsed,
      mode: input.mode,
      routeContext: input.routeContext,
      sensitivityLevel: input.sensitivityLevel,
      sensitivityOverride: input.sensitivityOverride,
    },
  });
}
