"use server";

import { prisma } from "@dpf/db";
import { startChain, extendChain, getChainOfCustody } from "@/lib/tak/delegation-authority";
import type { DelegationLink } from "@/lib/tak/delegation-authority";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoverableSkill {
  skillId: string;
  name: string;
  description: string;
  category: string;
  triggerPattern: string | null;
  assignedAgents: string[]; // which agents have this skill
  riskBand: string;
  capability: string | null;
}

export interface DelegationRequest {
  fromAgentId: string;
  toAgentId: string;
  skillId: string;
  context: string; // what the delegating agent needs done
  chainId?: string; // existing chain to extend, or null for new chain
  originUserId: string;
  originAuthority: string[];
}

export interface DelegationResponse {
  allowed: boolean;
  chainId: string | null;
  linkId: string | null;
  reason: string;
  propagatedAuthority: string[];
}

// ---------------------------------------------------------------------------
// Skill Discovery
// ---------------------------------------------------------------------------

/**
 * Discover skills available from other coworkers.
 * Searches SkillDefinition where agentInvocable=true.
 * Optionally filters by query and required capabilities.
 */
export async function discoverCoworkerSkills(
  query?: string,
  requiredCapabilities?: string[],
  excludeAgentId?: string,
): Promise<DiscoverableSkill[]> {
  const where: Record<string, unknown> = {
    agentInvocable: true,
    status: "active",
  };

  if (query) {
    where.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { triggerPattern: { contains: query, mode: "insensitive" } },
    ];
  }

  const skills = await prisma.skillDefinition.findMany({
    where,
    include: {
      assignments: {
        where: { enabled: true },
        select: { agentId: true },
      },
    },
    orderBy: { name: "asc" },
  });

  let results: DiscoverableSkill[] = skills.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    description: s.description,
    category: s.category,
    triggerPattern: s.triggerPattern,
    assignedAgents: s.assignments.map((a) => a.agentId),
    riskBand: s.riskBand,
    capability: s.capability,
  }));

  // Exclude skills only assigned to the requesting agent
  if (excludeAgentId) {
    results = results.filter(
      (s) => !s.assignedAgents.every((a) => a === excludeAgentId)
    );
  }

  // Filter by required capabilities
  if (requiredCapabilities && requiredCapabilities.length > 0) {
    results = results.filter(
      (s) => s.capability === null || requiredCapabilities.includes(s.capability)
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

/**
 * Delegate a task to another coworker via their skill.
 * Creates or extends a DelegationChain with authority propagation.
 */
export async function delegateToCoworker(
  request: DelegationRequest,
): Promise<DelegationResponse> {
  // Validate the target agent has the skill
  const assignment = await prisma.skillAssignment.findUnique({
    where: {
      skillId_agentId: {
        skillId: request.skillId,
        agentId: request.toAgentId,
      },
    },
    include: { skill: true },
  });

  if (!assignment || !assignment.enabled) {
    return {
      allowed: false,
      chainId: null,
      linkId: null,
      reason: `Agent ${request.toAgentId} does not have skill ${request.skillId}`,
      propagatedAuthority: [],
    };
  }

  const requiredCapabilities = assignment.skill.capability
    ? [assignment.skill.capability]
    : [];

  // Start new chain or extend existing
  if (request.chainId) {
    const result = await extendChain(
      request.chainId,
      request.fromAgentId,
      request.toAgentId,
      request.skillId,
      requiredCapabilities,
    );
    return {
      allowed: result.allowed,
      chainId: request.chainId,
      linkId: result.link?.id ?? null,
      reason: result.reason,
      propagatedAuthority: result.propagatedAuthority,
    };
  } else {
    const result = await startChain(
      request.fromAgentId,
      request.toAgentId,
      request.skillId,
      request.originUserId,
      request.originAuthority,
    );
    return {
      allowed: result.allowed,
      chainId: result.link?.chainId ?? null,
      linkId: result.link?.id ?? null,
      reason: result.reason,
      propagatedAuthority: result.propagatedAuthority,
    };
  }
}

/**
 * Get the chain of custody for display in the UI.
 */
export async function getChainOfCustodyForDisplay(
  chainId: string,
): Promise<DelegationLink[]> {
  return getChainOfCustody(chainId);
}
