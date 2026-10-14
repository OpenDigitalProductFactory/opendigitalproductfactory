"use server";

import { prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/actions/shared/guards";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import * as crypto from "crypto";
import {
  PROACTIVITY_CHANGE_ACTION,
  parseProactivityChangeProposalParameters,
} from "@/lib/proactivity/proactivity-change-proposal";
import {
  buildProactivityDismissalFact,
  buildProactivityOverrideFact,
  persistProactivityFact,
  scopeKeyFor,
} from "@/lib/proactivity/proactivity-override-preferences";
import {
  LEAVE_DECISION_ACTION,
  LEAVE_DECISION_VERB_REFUSAL,
} from "@/lib/workforce/leave/leave-decision-proposal-contract";
import { convertAndRunProposal } from "@/lib/actions/proposal-convert-and-run";

/**
 * What an approval returns to the card. `noLongerRunnable` is set when the
 * reference monitor refused the proposed call (spec D5): nothing ran, the
 * proposal is still `proposed`, and `error` says why, so the card offers
 * Decline only. `retryable` is set when nothing ran for a reason that is not a
 * settled no (a permit the call still needs, a check that could not complete):
 * the proposal is still `proposed` and Approve stays.
 */
export type ProposalApprovalResult = {
  success: boolean;
  resultEntityId?: string;
  error?: string;
  noLongerRunnable?: true;
  retryable?: true;
};


export async function approveProposal(
  proposalId: string,
): Promise<ProposalApprovalResult> {
  const user = await requireUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

  if (proposal.actionType === PROACTIVITY_CHANGE_ACTION) {
    return approveProactivityChangeProposal(proposal, user.id);
  }
  // BI-4E192035: a leave.decide proposal is a recommendation. "Approve" or
  // "reject" of it does not say which leave outcome the person meant, so the
  // leave is decided only by the explicit Approve leave / Deny leave actions.
  if (proposal.actionType === LEAVE_DECISION_ACTION) {
    return { success: false, error: LEAVE_DECISION_VERB_REFUSAL };
  }

  // Check capability
  const tool = PLATFORM_TOOLS.find((t) => t.name === proposal.actionType);
  const userContext = { platformRole: user.platformRole, isSuperuser: user.isSuperuser };
  if (tool?.requiredCapability && !can(userContext, tool.requiredCapability)) {
    return { success: false, error: "Insufficient permissions" };
  }

  // Convert-and-run (spec D5): the approval runs through the reference
  // monitor. Sequential, not in a wrapping transaction, because tool handlers
  // like shipBuild/createBuildEpic use their own $transaction internally.
  try {
    const outcome = await convertAndRunProposal(proposal, { userId: user.id, userContext }, { threadRecord: true });
    if (outcome.kind === "already-decided") return { success: false, error: "Proposal already decided" };
    if (outcome.kind === "refused") return { success: false, error: outcome.message, noLongerRunnable: true };
    if (outcome.kind === "held") return { success: false, error: outcome.message, retryable: true };
    if (outcome.kind === "threw") return { success: false, error: outcome.error };

    const { result } = outcome;
    const returnVal: ProposalApprovalResult = { success: result.success };
    if (result.entityId !== undefined) returnVal.resultEntityId = result.entityId;
    if (result.error !== undefined) returnVal.error = result.error;
    return returnVal;
  } catch (e) {
    // convert-and-run settles a throw after its claim itself; this guards
    // anything else. Only a row still `approved` (claimed, never settled) may
    // be marked failed: an executed or reverted row keeps its status.
    const message = e instanceof Error ? e.message : "Execution failed";
    await prisma.agentActionProposal.updateMany({
      where: { proposalId, status: "approved" },
      data: { status: "failed", resultError: message },
    });
    return { success: false, error: message };
  }
}

export async function rejectProposal(
  proposalId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

  if (proposal.actionType === PROACTIVITY_CHANGE_ACTION) {
    return rejectProactivityChangeProposal(proposal, user.id, reason);
  }
  // BI-4E192035: a leave.decide proposal is a recommendation. "Approve" or
  // "reject" of it does not say which leave outcome the person meant, so the
  // leave is decided only by the explicit Approve leave / Deny leave actions.
  if (proposal.actionType === LEAVE_DECISION_ACTION) {
    return { success: false, error: LEAVE_DECISION_VERB_REFUSAL };
  }

  await prisma.agentActionProposal.update({
    where: { proposalId },
    data: { status: "rejected", decidedAt: new Date(), decidedById: user.id },
  });

  await prisma.authorizationDecisionLog.create({
    data: {
      decisionId: `DEC-${crypto.randomUUID()}`,
      actionKey: proposal.actionType,
      objectRef: proposalId,
      actorType: "user",
      actorRef: user.id,
      decision: "deny",
      rationale: { proposalId, reason: reason ?? "User rejected" },
    },
  });

  return { success: true };
}

async function approveProactivityChangeProposal(
  proposal: { proposalId: string; actionType: string; parameters: unknown; agentId: string; threadId: string },
  userId: string,
): Promise<ProposalApprovalResult> {
  const parsed = parseProactivityChangeProposalParameters(proposal.parameters);
  if (!parsed) return { success: false, error: "Invalid proactivity proposal" };

  const acknowledgedAt = new Date().toISOString();
  const fact = buildProactivityOverrideFact({
    proposalId: proposal.proposalId,
    acknowledgedByUserId: userId,
    acknowledgedAt,
    proposal: parsed,
  });
  const resultEntityId = `proactivity-override:${scopeKeyFor(parsed)}`;

  await persistProactivityFact(userId, fact);
  await prisma.agentActionProposal.update({
    where: { proposalId: proposal.proposalId },
    data: {
      status: "executed",
      decidedAt: new Date(acknowledgedAt),
      decidedById: userId,
      executedAt: new Date(acknowledgedAt),
      resultEntityId,
    },
  });
  await prisma.authorizationDecisionLog.create({
    data: {
      decisionId: `DEC-${crypto.randomUUID()}`,
      actionKey: proposal.actionType,
      objectRef: proposal.proposalId,
      actorType: "user",
      actorRef: userId,
      decision: "allow",
      rationale: {
        proposalId: proposal.proposalId,
        scopeKey: scopeKeyFor(parsed),
        proposedLevel: parsed.proposedLevel,
        authorityImpact: parsed.authorityImpact,
      },
    },
  });

  await prisma.agentMessage.create({
    data: {
      threadId: proposal.threadId,
      role: "system",
      content: `Proactivity changed to ${parsed.proposedLevel} for ${scopeKeyFor(parsed)}. Authority boundaries were not expanded.`,
      agentId: proposal.agentId,
    },
  }).catch(() => {});

  return { success: true, resultEntityId };
}

async function rejectProactivityChangeProposal(
  proposal: {
    proposalId: string;
    actionType: string;
    parameters: unknown;
    agentId: string;
    threadId: string;
  },
  userId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const parsed = parseProactivityChangeProposalParameters(proposal.parameters);
  if (!parsed) return { success: false, error: "Invalid proactivity proposal" };

  const dismissedAt = new Date();
  const cooldownUntil = new Date(dismissedAt);
  cooldownUntil.setUTCDate(cooldownUntil.getUTCDate() + 7);
  const fact = buildProactivityDismissalFact({
    proposalId: proposal.proposalId,
    dismissedByUserId: userId,
    dismissedAt: dismissedAt.toISOString(),
    cooldownUntil: cooldownUntil.toISOString(),
    proposal: parsed,
  });

  await persistProactivityFact(userId, fact);
  await prisma.agentActionProposal.update({
    where: { proposalId: proposal.proposalId },
    data: { status: "rejected", decidedAt: dismissedAt, decidedById: userId },
  });
  await prisma.authorizationDecisionLog.create({
    data: {
      decisionId: `DEC-${crypto.randomUUID()}`,
      actionKey: proposal.actionType,
      objectRef: proposal.proposalId,
      actorType: "user",
      actorRef: userId,
      decision: "deny",
      rationale: {
        proposalId: proposal.proposalId,
        reason: reason ?? "User rejected",
        scopeKey: scopeKeyFor(parsed),
        cooldownUntil: cooldownUntil.toISOString(),
      },
    },
  });

  await prisma.agentMessage.create({
    data: {
      threadId: proposal.threadId,
      role: "system",
      content: `Proactivity proposal declined: ${reason ?? "Keep the current level"}.`,
      agentId: proposal.agentId,
    },
  }).catch(() => {});

  return { success: true };
}
