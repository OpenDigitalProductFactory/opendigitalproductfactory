import { prisma } from "@dpf/db";
import type { ProactivityChangeProposalParameters } from "./proactivity-change-proposal";
import type { ProactivityLevel } from "./proactivity-types";

export const PROACTIVITY_FACT_CATEGORY = "preference";
export const PROACTIVITY_OVERRIDE_FACT_PREFIX = "aiCoworkerProactivity";
export const PROACTIVITY_COOLDOWN_FACT_PREFIX = "aiCoworkerProactivityCooldown";

export type ProactivityOverrideFactValue = {
  scope: ProactivityChangeProposalParameters["scope"];
  scopeKey: string;
  level: ProactivityLevel;
  previousLevel: ProactivityLevel;
  source: "coworker-proposal";
  proposedByAgentId: string | null;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
  proposalId: string;
  rationale: string;
  evidenceRefs: ProactivityChangeProposalParameters["evidenceRefs"];
};

export type DismissedProactivityProposalFactValue = {
  proposalId: string;
  scopeKey: string;
  proposedLevel: ProactivityLevel;
  dismissedByUserId: string;
  dismissedAt: string;
  cooldownUntil: string;
  rationale: string;
};

export type ProactivityFactWrite = {
  category: typeof PROACTIVITY_FACT_CATEGORY;
  key: string;
  value: string;
  sourceRoute: string;
  sourceAgentId: string | null;
  lastValidatedAt?: Date;
};

export type ApplyProactivityOverrideInput = {
  proposalId: string;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
  proposal: ProactivityChangeProposalParameters;
};

export type DismissProactivityProposalInput = {
  proposalId: string;
  dismissedByUserId: string;
  dismissedAt: string;
  cooldownUntil: string;
  proposal: ProactivityChangeProposalParameters;
};

export async function persistProactivityFact(userId: string, fact: ProactivityFactWrite): Promise<void> {
  const existing = await prisma.userFact.findFirst({
    where: {
      userId,
      category: fact.category,
      key: fact.key,
      supersededAt: null,
    },
    select: { id: true },
  });

  const data = {
    value: fact.value,
    confidence: 1,
    sourceRoute: fact.sourceRoute,
    sourceAgentId: fact.sourceAgentId,
    ...(fact.lastValidatedAt ? { lastValidatedAt: fact.lastValidatedAt } : {}),
  };

  if (existing) {
    await prisma.userFact.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.userFact.create({
    data: {
      userId,
      category: fact.category,
      key: fact.key,
      ...data,
    },
  });
}

export function buildProactivityOverrideFact(input: ApplyProactivityOverrideInput): ProactivityFactWrite {
  const scopeKey = scopeKeyFor(input.proposal);
  const value: ProactivityOverrideFactValue = {
    scope: input.proposal.scope,
    scopeKey,
    level: input.proposal.proposedLevel,
    previousLevel: input.proposal.currentLevel,
    source: "coworker-proposal",
    proposedByAgentId: input.proposal.agentId ?? null,
    acknowledgedByUserId: input.acknowledgedByUserId,
    acknowledgedAt: input.acknowledgedAt,
    proposalId: input.proposalId,
    rationale: input.proposal.rationale,
    evidenceRefs: input.proposal.evidenceRefs,
  };

  return {
    category: PROACTIVITY_FACT_CATEGORY,
    key: overrideFactKeyFor(input.proposal),
    value: JSON.stringify(value),
    sourceRoute: input.proposal.routeContext ?? "/platform/ai",
    sourceAgentId: input.proposal.agentId ?? null,
    lastValidatedAt: new Date(input.acknowledgedAt),
  };
}

export function buildProactivityDismissalFact(input: DismissProactivityProposalInput): ProactivityFactWrite {
  const scopeKey = scopeKeyFor(input.proposal);
  const value: DismissedProactivityProposalFactValue = {
    proposalId: input.proposalId,
    scopeKey,
    proposedLevel: input.proposal.proposedLevel,
    dismissedByUserId: input.dismissedByUserId,
    dismissedAt: input.dismissedAt,
    cooldownUntil: input.cooldownUntil,
    rationale: input.proposal.rationale,
  };

  return {
    category: PROACTIVITY_FACT_CATEGORY,
    key: cooldownFactKeyFor(input.proposal),
    value: JSON.stringify(value),
    sourceRoute: input.proposal.routeContext ?? "/platform/ai",
    sourceAgentId: input.proposal.agentId ?? null,
  };
}

export function overrideFactKeyFor(proposal: ProactivityChangeProposalParameters): string {
  return `${PROACTIVITY_OVERRIDE_FACT_PREFIX}:${scopeKeyFor(proposal)}`;
}

export function cooldownFactKeyFor(proposal: ProactivityChangeProposalParameters): string {
  return `${PROACTIVITY_COOLDOWN_FACT_PREFIX}:${scopeKeyFor(proposal)}`;
}

export function scopeKeyFor(proposal: ProactivityChangeProposalParameters): string {
  if (proposal.scope === "activity-family" && proposal.activityFamily) {
    return `activity-family:${proposal.activityFamily}`;
  }
  if (proposal.scope === "route-context" && proposal.routeContext) {
    return `route-context:${proposal.routeContext}`;
  }
  if (proposal.scope === "agent" && proposal.agentId) {
    return `agent:${proposal.agentId}`;
  }
  return proposal.scope;
}
