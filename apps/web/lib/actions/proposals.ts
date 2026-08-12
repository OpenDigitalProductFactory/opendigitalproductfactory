"use server";

import { prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/actions/shared/guards";
import { PLATFORM_TOOLS, executeTool } from "@/lib/mcp-tools";
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
import { approveLeaveRequest, rejectLeaveRequest } from "@/lib/actions/leave";
import {
  LEAVE_DECISION_ACTION,
  parseLeaveDecisionProposalParameters,
} from "@/lib/workforce/leave/leave-decision-proposal-contract";


export async function approveProposal(
  proposalId: string,
): Promise<{ success: boolean; resultEntityId?: string; error?: string }> {
  const user = await requireUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

  if (proposal.actionType === PROACTIVITY_CHANGE_ACTION) {
    return approveProactivityChangeProposal(proposal, user.id);
  }
  if (proposal.actionType === LEAVE_DECISION_ACTION) {
    const parameters = parseLeaveDecisionProposalParameters(proposal.parameters);
    return parameters
      ? approveLeaveRequest(parameters.requestId)
      : { success: false, error: "Invalid leave decision proposal" };
  }

  // Check capability
  const tool = PLATFORM_TOOLS.find((t) => t.name === proposal.actionType);
  if (tool?.requiredCapability && !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, tool.requiredCapability)) {
    return { success: false, error: "Insufficient permissions" };
  }

  // Execute sequentially (not in a wrapping transaction) because tool handlers
  // like shipBuild/createBuildEpic use their own $transaction internally.
  try {
    await prisma.agentActionProposal.update({
      where: { proposalId },
      data: { status: "approved", decidedAt: new Date(), decidedById: user.id },
    });

    const result = await executeTool(
      proposal.actionType,
      proposal.parameters as Record<string, unknown>,
      user.id,
      { agentId: proposal.agentId, threadId: proposal.threadId },
    );

    if (result.success) {
      await prisma.agentActionProposal.update({
        where: { proposalId },
        data: {
          status: "executed",
          executedAt: new Date(),
          ...(result.entityId !== undefined ? { resultEntityId: result.entityId } : {}),
        },
      });
    } else {
      await prisma.agentActionProposal.update({
        where: { proposalId },
        data: {
          status: "failed",
          ...(result.error !== undefined ? { resultError: result.error } : {}),
        },
      });
    }

    // Audit log
    await prisma.authorizationDecisionLog.create({
      data: {
        decisionId: `DEC-${crypto.randomUUID()}`,
        actionKey: proposal.actionType,
        objectRef: proposalId,
        actorType: "user",
        actorRef: user.id,
        decision: "allow",
        rationale: { proposalId, parameters: proposal.parameters, result: result.message },
      },
    });

    // Inject tool result as a system message so the agent sees it in the next turn.
    // Without this, the agent doesn't know the tool succeeded and re-calls it.
    const toolResultSummary = result.success
      ? `${proposal.actionType} completed successfully.${result.message ? ` ${result.message.slice(0, 500)}` : ""}`
      : `${proposal.actionType} failed: ${result.error ?? result.message ?? "unknown error"}`;
    await prisma.agentMessage.create({
      data: {
        threadId: proposal.threadId,
        role: "system",
        content: toolResultSummary,
        agentId: proposal.agentId,
      },
    }).catch(() => {});

    const returnVal: { success: boolean; resultEntityId?: string; error?: string } = { success: result.success };
    if (result.entityId !== undefined) returnVal.resultEntityId = result.entityId;
    if (result.error !== undefined) returnVal.error = result.error;
    return returnVal;
  } catch (e) {
    // Transaction failed — proposal stays as "proposed"
    await prisma.agentActionProposal.update({
      where: { proposalId },
      data: { status: "failed", resultError: e instanceof Error ? e.message : "Execution failed" },
    });
    return { success: false, error: e instanceof Error ? e.message : "Execution failed" };
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
  if (proposal.actionType === LEAVE_DECISION_ACTION) {
    const parameters = parseLeaveDecisionProposalParameters(proposal.parameters);
    return parameters
      ? rejectLeaveRequest(parameters.requestId, reason ?? "Manager declined this request")
      : { success: false, error: "Invalid leave decision proposal" };
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
): Promise<{ success: boolean; resultEntityId?: string; error?: string }> {
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
