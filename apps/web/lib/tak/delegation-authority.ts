// apps/web/lib/tak/delegation-authority.ts
// Authority propagation, loop detection, and depth limiting for coworker delegation chains.

import "server-only";
import { prisma } from "@dpf/db";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DelegationLink = {
  id: string;
  chainId: string;
  depth: number;
  fromAgentId: string;
  toAgentId: string;
  skillId: string | null;
  authorityScope: string[];
  originUserId: string;
  originAuthority: string[];
  status: string;
  reason: string | null;
  parentLinkId: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type DelegationResult = {
  allowed: boolean;
  link: DelegationLink | null;
  reason: string;
  propagatedAuthority: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DELEGATION_DEPTH = 4;

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Start a new delegation chain.
 * Called when a user initiates a task that the first agent delegates.
 */
export async function startChain(
  fromAgentId: string,
  toAgentId: string,
  skillId: string | null,
  originUserId: string,
  originAuthority: string[],
): Promise<DelegationResult> {
  const chainId = randomUUID();

  // Loop check (trivial — can't loop on first link)
  if (fromAgentId === toAgentId) {
    return {
      allowed: false,
      link: null,
      reason: "Cannot delegate to self",
      propagatedAuthority: [],
    };
  }

  // Authority propagation — the delegated agent gets the intersection
  // of the origin user's authority and the skill's required capabilities
  const propagated = originAuthority; // Full authority on first hop

  const link = await prisma.delegationChain.create({
    data: {
      chainId,
      depth: 0,
      fromAgentId,
      toAgentId,
      skillId,
      authorityScope: propagated,
      originUserId,
      originAuthority,
      status: "active",
      reason: null,
      parentLinkId: null,
    },
  });

  return {
    allowed: true,
    link: link as DelegationLink,
    reason: "Chain started",
    propagatedAuthority: propagated,
  };
}

/**
 * Extend an existing delegation chain by one hop.
 * Validates: loop detection, depth limit, authority propagation.
 */
export async function extendChain(
  chainId: string,
  fromAgentId: string,
  toAgentId: string,
  skillId: string | null,
  requiredCapabilities: string[],
): Promise<DelegationResult> {
  // Load existing chain
  const existingLinks = await prisma.delegationChain.findMany({
    where: { chainId },
    orderBy: { depth: "asc" },
  });

  if (existingLinks.length === 0) {
    return {
      allowed: false,
      link: null,
      reason: "Chain not found",
      propagatedAuthority: [],
    };
  }

  const lastLink = existingLinks[existingLinks.length - 1];
  const newDepth = lastLink.depth + 1;

  // Depth limit
  if (newDepth >= MAX_DELEGATION_DEPTH) {
    const blocked = await prisma.delegationChain.create({
      data: {
        chainId,
        depth: newDepth,
        fromAgentId,
        toAgentId,
        skillId,
        authorityScope: [],
        originUserId: lastLink.originUserId,
        originAuthority: lastLink.originAuthority,
        status: "blocked",
        reason: `Depth limit exceeded (max ${MAX_DELEGATION_DEPTH})`,
        parentLinkId: lastLink.id,
      },
    });
    return {
      allowed: false,
      link: blocked as DelegationLink,
      reason: `Depth limit exceeded (max ${MAX_DELEGATION_DEPTH})`,
      propagatedAuthority: [],
    };
  }

  // Loop detection — check if toAgentId already appears in chain
  const agentsInChain = new Set(existingLinks.flatMap((l) => [l.fromAgentId, l.toAgentId]));
  if (agentsInChain.has(toAgentId)) {
    const blocked = await prisma.delegationChain.create({
      data: {
        chainId,
        depth: newDepth,
        fromAgentId,
        toAgentId,
        skillId,
        authorityScope: [],
        originUserId: lastLink.originUserId,
        originAuthority: lastLink.originAuthority,
        status: "blocked",
        reason: `Loop detected: ${toAgentId} already in chain`,
        parentLinkId: lastLink.id,
      },
    });
    return {
      allowed: false,
      link: blocked as DelegationLink,
      reason: `Loop detected: ${toAgentId} already in chain`,
      propagatedAuthority: [],
    };
  }

  // Authority propagation — narrow scope at each hop
  // The new agent only gets capabilities that:
  // 1. The previous link had in scope, AND
  // 2. The target skill requires (if specified)
  const parentScope = lastLink.authorityScope;
  const propagated = requiredCapabilities.length > 0
    ? parentScope.filter((cap) => requiredCapabilities.includes(cap))
    : parentScope;

  // Authority check — if skill requires capabilities not in scope, block
  if (requiredCapabilities.length > 0) {
    const missing = requiredCapabilities.filter((cap) => !parentScope.includes(cap));
    if (missing.length > 0) {
      const blocked = await prisma.delegationChain.create({
        data: {
          chainId,
          depth: newDepth,
          fromAgentId,
          toAgentId,
          skillId,
          authorityScope: [],
          originUserId: lastLink.originUserId,
          originAuthority: lastLink.originAuthority,
          status: "blocked",
          reason: `Authority insufficient: missing ${missing.join(", ")}`,
          parentLinkId: lastLink.id,
        },
      });
      return {
        allowed: false,
        link: blocked as DelegationLink,
        reason: `Authority insufficient: missing ${missing.join(", ")}`,
        propagatedAuthority: [],
      };
    }
  }

  // All checks passed — create the link
  const link = await prisma.delegationChain.create({
    data: {
      chainId,
      depth: newDepth,
      fromAgentId,
      toAgentId,
      skillId,
      authorityScope: propagated,
      originUserId: lastLink.originUserId,
      originAuthority: lastLink.originAuthority,
      status: "active",
      reason: null,
      parentLinkId: lastLink.id,
    },
  });

  return {
    allowed: true,
    link: link as DelegationLink,
    reason: "Delegation approved",
    propagatedAuthority: propagated,
  };
}

/**
 * Complete a chain link (mark as done).
 */
export async function completeChainLink(linkId: string): Promise<void> {
  await prisma.delegationChain.update({
    where: { id: linkId },
    data: { status: "completed", completedAt: new Date() },
  });
}

/**
 * Mark a chain link as failed.
 */
export async function failChainLink(linkId: string, reason: string): Promise<void> {
  await prisma.delegationChain.update({
    where: { id: linkId },
    data: { status: "failed", completedAt: new Date(), reason },
  });
}

/**
 * Get the full chain of custody for a given chainId.
 */
export async function getChainOfCustody(chainId: string): Promise<DelegationLink[]> {
  const links = await prisma.delegationChain.findMany({
    where: { chainId },
    orderBy: { depth: "asc" },
  });
  return links as DelegationLink[];
}

/**
 * Get all active chains involving a specific agent.
 */
export async function getActiveChainsForAgent(agentId: string): Promise<DelegationLink[]> {
  const links = await prisma.delegationChain.findMany({
    where: {
      status: "active",
      OR: [{ fromAgentId: agentId }, { toAgentId: agentId }],
    },
    orderBy: { startedAt: "desc" },
  });
  return links as DelegationLink[];
}
