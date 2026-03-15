"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { PLATFORM_TOOLS, executeTool } from "@/lib/mcp-tools";
import * as crypto from "crypto";

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

export async function approveProposal(
  proposalId: string,
): Promise<{ success: boolean; resultEntityId?: string; error?: string }> {
  const user = await requireAuthUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

  // Check capability
  const tool = PLATFORM_TOOLS.find((t) => t.name === proposal.actionType);
  if (tool?.requiredCapability && !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, tool.requiredCapability)) {
    return { success: false, error: "Insufficient permissions" };
  }

  // Execute in transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.agentActionProposal.update({
        where: { proposalId },
        data: { status: "approved", decidedAt: new Date(), decidedById: user.id },
      });

      const toolResult = await executeTool(
        proposal.actionType,
        proposal.parameters as Record<string, unknown>,
        user.id,
      );

      if (toolResult.success) {
        await tx.agentActionProposal.update({
          where: { proposalId },
          data: {
            status: "executed",
            executedAt: new Date(),
            ...(toolResult.entityId !== undefined ? { resultEntityId: toolResult.entityId } : {}),
          },
        });
      } else {
        await tx.agentActionProposal.update({
          where: { proposalId },
          data: {
            status: "failed",
            ...(toolResult.error !== undefined ? { resultError: toolResult.error } : {}),
          },
        });
      }

      return toolResult;
    });

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
  const user = await requireAuthUser();

  const proposal = await prisma.agentActionProposal.findUnique({
    where: { proposalId },
  });
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "proposed") return { success: false, error: "Proposal already decided" };

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
