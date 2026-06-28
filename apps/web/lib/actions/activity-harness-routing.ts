"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import {
  buildActivityHarnessApprovalProposalCommand,
  type BuildActivityHarnessApprovalProposalCommandInput,
} from "@/lib/routing/activity-harness-approval-source";
import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

const ACTIVITY_ROUTING_AGENT_ID = "activity-routing-governor";
const ACTIVITY_ROUTING_CONTEXT_KEY = "platform:ai:activity-routing";
const ACTIVITY_ROUTING_ROUTE_CONTEXT = "/platform/ai/operations-map";
const ACTIVITY_ROUTING_TASK_TYPE = "activity-routing-governance";

type ProposeActivityHarnessOverrideResult =
  | {
      success: true;
      proposalId: string;
      status: string;
      existing?: true;
    }
  | {
      success: false;
      error: string;
    };

export async function proposeActivityHarnessOverrideAction(
  input: BuildActivityHarnessApprovalProposalCommandInput,
): Promise<ProposeActivityHarnessOverrideResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, error: "Unauthorized" };
  }

  const command = buildActivityHarnessApprovalProposalCommand(input);
  const existing = await prisma.agentActionProposal.findUnique({
    where: { proposalId: command.proposalId },
    select: { proposalId: true, status: true },
  });
  if (existing) {
    return {
      success: true,
      proposalId: existing.proposalId,
      status: existing.status,
      existing: true,
    };
  }

  const thread = await prisma.agentThread.upsert({
    where: {
      userId_contextKey: {
        userId,
        contextKey: ACTIVITY_ROUTING_CONTEXT_KEY,
      },
    },
    create: {
      userId,
      contextKey: ACTIVITY_ROUTING_CONTEXT_KEY,
    },
    update: {},
    select: { id: true },
  });
  const message = await prisma.agentMessage.create({
    data: {
      threadId: thread.id,
      role: "assistant",
      content: command.messageContent,
      agentId: ACTIVITY_ROUTING_AGENT_ID,
      routeContext: ACTIVITY_ROUTING_ROUTE_CONTEXT,
      taskType: ACTIVITY_ROUTING_TASK_TYPE,
    },
    select: { id: true },
  });
  const proposal = await prisma.agentActionProposal.create({
    data: {
      proposalId: command.proposalId,
      threadId: thread.id,
      messageId: message.id,
      agentId: ACTIVITY_ROUTING_AGENT_ID,
      actionType: command.actionType,
      parameters: command.parameters as Prisma.InputJsonValue,
      status: "proposed",
    },
    select: { proposalId: true, status: true },
  });

  revalidatePath(ACTIVITY_ROUTING_ROUTE_CONTEXT);

  return {
    success: true,
    proposalId: proposal.proposalId,
    status: proposal.status,
  };
}
