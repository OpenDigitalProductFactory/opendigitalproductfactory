"use server";

import crypto from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { buildPrincipalContext } from "@/lib/principal-context";
import { getAgentGovernance, getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { resolveGovernedAction } from "@/lib/governance-resolver";
import type { DelegationGrantScope, RiskBand } from "@/lib/governance-types";

export type GovernanceActionResult = {
  ok: boolean;
  message: string;
};

type SessionUserContext = {
  id: string;
  email: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

export type DelegationGrantInput = {
  granteeAgentId: string;
  riskBand: RiskBand;
  validFrom: Date;
  expiresAt: Date;
  scope: DelegationGrantScope;
  reason?: string;
  targetUserId?: string;
  workflowKey?: string;
  objectRef?: string;
  maxUses?: number;
};

async function requireAnyCapability(
  capabilities: Array<"manage_agents" | "manage_user_lifecycle" | "manage_users">,
): Promise<SessionUserContext> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");

  const context: SessionUserContext = {
    id: user.id,
    email: user.email ?? "",
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };

  if (!capabilities.some((capability) => can(context, capability))) {
    throw new Error("Unauthorized");
  }

  return context;
}

function governanceDenied(message: string): GovernanceActionResult {
  return { ok: false, message };
}

export async function validateDelegationGrantInput(input: DelegationGrantInput): Promise<string | null> {
  if (!input.granteeAgentId.trim()) return "Select an agent.";
  if (input.expiresAt <= input.validFrom) return "Grant expiry must be after the start time.";
  if (input.scope.actionFamilies.length === 0) return "Grant scope must include at least one action family.";
  if (input.scope.resourceTypes.length === 0) return "Grant scope must include at least one resource type.";
  return null;
}

export async function createDelegationGrant(input: DelegationGrantInput): Promise<GovernanceActionResult> {
  const validationError = await validateDelegationGrantInput(input);
  if (validationError) return governanceDenied(validationError);

  const actor = await requireAnyCapability(["manage_agents", "manage_user_lifecycle"]);
  const [teamIds, agentGovernance] = await Promise.all([
    getUserTeamIds(actor.id),
    getAgentGovernance(input.granteeAgentId),
  ]);

  if (!agentGovernance?.governanceProfile) {
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: actor.id,
      humanContextRef: actor.id,
      agentContextRef: input.granteeAgentId,
      actionKey: "delegation_grant.create",
      objectRef: input.objectRef ?? null,
      decision: "deny",
      rationale: { code: "agent_governance_missing" } satisfies Prisma.InputJsonValue,
    });
    return governanceDenied("Agent governance profile is required before grants can be created.");
  }

  if (!agentGovernance.governanceProfile.allowDelegation) {
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: actor.id,
      humanContextRef: actor.id,
      agentContextRef: input.granteeAgentId,
      actionKey: "delegation_grant.create",
      objectRef: input.objectRef ?? null,
      decision: "deny",
      rationale: { code: "agent_delegation_disabled" } satisfies Prisma.InputJsonValue,
    });
    return governanceDenied("This agent is not eligible for delegated elevation.");
  }

  const principalContext = buildPrincipalContext({
    sessionUser: actor,
    teamIds,
    actingAgentId: input.granteeAgentId,
    delegationGrantIds: [],
  });

  const baselineRiskBand = (agentGovernance.governanceProfile.maxDelegationRiskBand ??
    agentGovernance.governanceProfile.capabilityClass.riskBand ??
    "low") as RiskBand;

  const decision = resolveGovernedAction({
    humanAllowed: principalContext.platformRoleIds.length > 0 || actor.isSuperuser,
    agentPolicyAllowed: agentGovernance.governanceProfile.allowDelegation,
    riskBand: input.riskBand,
    agentMaxRiskBand: baselineRiskBand,
    activeGrant: {
      maxRiskBand: input.scope.maxRiskBand,
      allowsRequestedScope: true,
      expiresAt: input.expiresAt,
      now: new Date(),
    },
  });

  if (decision.decision !== "allow") {
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: actor.id,
      humanContextRef: actor.id,
      agentContextRef: input.granteeAgentId,
      actionKey: "delegation_grant.create",
      objectRef: input.objectRef ?? null,
      decision: decision.decision,
      rationale: { code: decision.rationaleCode } satisfies Prisma.InputJsonValue,
    });
    return governanceDenied("Requested delegation exceeds the agent governance envelope.");
  }

  await prisma.delegationGrant.create({
    data: {
      grantId: `DGR-${crypto.randomUUID()}`,
      grantorUserId: actor.id,
      granteeAgentId: agentGovernance.id,
      targetUserId: input.targetUserId ?? null,
      scopeJson: input.scope as Prisma.InputJsonValue,
      reason: input.reason ?? null,
      riskBand: input.riskBand,
      validFrom: input.validFrom,
      expiresAt: input.expiresAt,
      maxUses: input.maxUses ?? null,
      workflowKey: input.workflowKey ?? null,
      objectRef: input.objectRef ?? null,
    },
  });

  await createAuthorizationDecisionLog({
    actorType: "user",
    actorRef: actor.id,
    humanContextRef: actor.id,
    agentContextRef: input.granteeAgentId,
    actionKey: "delegation_grant.create",
    objectRef: input.objectRef ?? null,
    decision: "allow",
    rationale: { code: decision.rationaleCode } satisfies Prisma.InputJsonValue,
  });

  revalidatePath("/platform");
  revalidatePath("/employee");
  revalidatePath("/ea/agents");
  return { ok: true, message: "Delegation grant created." };
}

export async function revokeDelegationGrant(grantId: string): Promise<GovernanceActionResult> {
  const actor = await requireAnyCapability(["manage_agents", "manage_user_lifecycle"]);

  const grant = await prisma.delegationGrant.findUnique({
    where: { grantId },
    select: { id: true, grantId: true },
  });
  if (!grant) return governanceDenied("Delegation grant not found.");

  await prisma.delegationGrant.update({
    where: { id: grant.id },
    data: { status: "revoked" },
  });

  await createAuthorizationDecisionLog({
    actorType: "user",
    actorRef: actor.id,
    humanContextRef: actor.id,
    actionKey: "delegation_grant.revoke",
    objectRef: grant.grantId,
    decision: "allow",
    rationale: { code: "grant_revoked" } satisfies Prisma.InputJsonValue,
  });

  revalidatePath("/platform");
  revalidatePath("/ea/agents");
  return { ok: true, message: "Delegation grant revoked." };
}

export async function assignAgentGovernanceProfile(input: {
  agentId: string;
  capabilityClassId: string;
  directivePolicyClassId: string;
  autonomyLevel: string;
  hitlPolicy: string;
  allowDelegation: boolean;
  maxDelegationRiskBand?: RiskBand | null;
}): Promise<GovernanceActionResult> {
  await requireAnyCapability(["manage_agents"]);

  const [agent, capabilityClass, directivePolicyClass] = await Promise.all([
    prisma.agent.findUnique({ where: { agentId: input.agentId }, select: { id: true } }),
    prisma.agentCapabilityClass.findUnique({ where: { capabilityClassId: input.capabilityClassId }, select: { id: true } }),
    prisma.directivePolicyClass.findUnique({ where: { policyClassId: input.directivePolicyClassId }, select: { id: true } }),
  ]);

  if (!agent || !capabilityClass || !directivePolicyClass) {
    return governanceDenied("Agent, capability class, or directive policy class was not found.");
  }

  await prisma.agentGovernanceProfile.upsert({
    where: { agentId: agent.id },
    update: {
      capabilityClassId: capabilityClass.id,
      directivePolicyClassId: directivePolicyClass.id,
      autonomyLevel: input.autonomyLevel,
      hitlPolicy: input.hitlPolicy,
      allowDelegation: input.allowDelegation,
      maxDelegationRiskBand: input.maxDelegationRiskBand ?? null,
    },
    create: {
      agentId: agent.id,
      capabilityClassId: capabilityClass.id,
      directivePolicyClassId: directivePolicyClass.id,
      autonomyLevel: input.autonomyLevel,
      hitlPolicy: input.hitlPolicy,
      allowDelegation: input.allowDelegation,
      maxDelegationRiskBand: input.maxDelegationRiskBand ?? null,
    },
  });

  revalidatePath("/platform");
  revalidatePath("/ea/agents");
  return { ok: true, message: "Agent governance profile saved." };
}

export async function assignAgentOwnership(input: {
  agentId: string;
  teamId: string;
  responsibility: "owning_team" | "operating_team" | "approving_team";
}): Promise<GovernanceActionResult> {
  await requireAnyCapability(["manage_agents"]);

  const [agent, team] = await Promise.all([
    prisma.agent.findUnique({ where: { agentId: input.agentId }, select: { id: true } }),
    prisma.team.findUnique({ where: { teamId: input.teamId }, select: { id: true } }),
  ]);

  if (!agent || !team) return governanceDenied("Agent or team not found.");

  await prisma.agentOwnership.upsert({
    where: {
      agentId_teamId_responsibility: {
        agentId: agent.id,
        teamId: team.id,
        responsibility: input.responsibility,
      },
    },
    update: {},
    create: {
      agentId: agent.id,
      teamId: team.id,
      responsibility: input.responsibility,
    },
  });

  revalidatePath("/platform");
  revalidatePath("/ea/agents");
  return { ok: true, message: "Agent ownership saved." };
}
