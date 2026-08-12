// Durable propose-only envelope for time-off recommendations (BI-4D030159).
// The AI may prepare this record; only D1's governed human approve/reject
// actions may mutate LeaveRequest.status.

import { Prisma, prisma } from "@dpf/db";

import type { LeaveDecisionRuntimeResult } from "./leave-decision-runtime";
import {
  LEAVE_DECISION_ACTION,
  LEAVE_DECISION_ROUTE,
} from "./leave-decision-proposal-contract";

const LEAVE_DECISION_CONTEXT_KEY = "workforce:leave-decisions";
const DEFAULT_AGENT_ID = "time-off-advisor";

export { LEAVE_DECISION_ACTION } from "./leave-decision-proposal-contract";

export type LeaveDecisionProposalDraft = {
  actionType: typeof LEAVE_DECISION_ACTION;
  autoDecide: false;
  parameters: {
    requestId: string;
    organizationId: string | null;
    recommendation: LeaveDecisionRuntimeResult["action"];
    interactionId: string | null;
    orgProfileSelected: boolean;
    rationale: string;
    guardReasons: string[];
    minCoverageCushion: number | null;
    coverage: { requiredHeadcount: number; coveredIfApproved: number };
  };
};

export function prepareLeaveDecisionProposal(
  decision: LeaveDecisionRuntimeResult,
): LeaveDecisionProposalDraft {
  return {
    actionType: LEAVE_DECISION_ACTION,
    autoDecide: false,
    parameters: {
      requestId: decision.request.requestId,
      organizationId: decision.inputs.organizationId,
      recommendation: decision.action,
      interactionId: decision.interactionId,
      orgProfileSelected: decision.orgProfileSelected,
      rationale: decision.operatorMessage,
      guardReasons: decision.guardReasons,
      minCoverageCushion: decision.inputs.minCoverageCushion ?? null,
      coverage: decision.inputs.coverage,
    },
  };
}

type ProposalResult = { proposalId: string; status: string };

export type LeaveDecisionProposalPersistence = {
  findExisting(proposalId: string): Promise<ProposalResult | null>;
  ensureThread(input: { userId: string; threadId?: string | null }): Promise<{ id: string }>;
  createProposalBundle(input: {
    proposalId: string;
    threadId: string;
    taskRunId?: string | null;
    agentId: string;
    actionType: typeof LEAVE_DECISION_ACTION;
    parameters: LeaveDecisionProposalDraft["parameters"];
    messageContent: string;
    status: "proposed";
    leaveRequestUpdate: {
      requestId: string;
      decisionInteractionId: string | null;
    };
  }): Promise<ProposalResult>;
};

export async function proposeLeaveDecision(input: {
  decision: LeaveDecisionRuntimeResult;
  userId: string;
  agentId?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  persistence?: LeaveDecisionProposalPersistence;
}): Promise<ProposalResult & { existing?: true }> {
  const draft = prepareLeaveDecisionProposal(input.decision);
  const auditKey = input.decision.interactionId ?? `guard-${input.decision.action}`;
  const proposalId = `leave-decision:${input.decision.request.requestId}:${auditKey}`;
  const persistence = input.persistence ?? prismaLeaveDecisionProposalPersistence();
  const existing = await persistence.findExisting(proposalId);
  if (existing) return { ...existing, existing: true };

  const thread = await persistence.ensureThread({ userId: input.userId, threadId: input.threadId });
  return persistence.createProposalBundle({
    proposalId,
    threadId: thread.id,
    taskRunId: input.taskRunId,
    agentId: input.agentId ?? DEFAULT_AGENT_ID,
    actionType: draft.actionType,
    parameters: draft.parameters,
    messageContent: `Time-off recommendation: ${draft.parameters.recommendation}. ${draft.parameters.rationale}`,
    status: "proposed",
    leaveRequestUpdate: {
      requestId: input.decision.request.requestId,
      decisionInteractionId: input.decision.interactionId,
    },
  });
}

export function prismaLeaveDecisionProposalPersistence(): LeaveDecisionProposalPersistence {
  return {
    findExisting: (proposalId) =>
      prisma.agentActionProposal.findUnique({
        where: { proposalId },
        select: { proposalId: true, status: true },
      }),
    ensureThread: async ({ userId, threadId }) => {
      if (threadId) return { id: threadId };
      return prisma.agentThread.upsert({
        where: { userId_contextKey: { userId, contextKey: LEAVE_DECISION_CONTEXT_KEY } },
        create: { userId, contextKey: LEAVE_DECISION_CONTEXT_KEY },
        update: {},
        select: { id: true },
      });
    },
    createProposalBundle: (input) =>
      prisma.$transaction(async (tx) => {
        const message = await tx.agentMessage.create({
          data: {
            threadId: input.threadId,
            role: "assistant",
            content: input.messageContent,
            agentId: input.agentId,
            routeContext: LEAVE_DECISION_ROUTE,
            taskType: "leave-decision-recommendation",
            ...(input.taskRunId ? { taskRunId: input.taskRunId } : {}),
          },
          select: { id: true },
        });
        const proposal = await tx.agentActionProposal.create({
          data: {
            proposalId: input.proposalId,
            threadId: input.threadId,
            messageId: message.id,
            agentId: input.agentId,
            actionType: input.actionType,
            parameters: input.parameters as unknown as Prisma.InputJsonValue,
            status: input.status,
            ...(input.taskRunId ? { taskRunId: input.taskRunId } : {}),
          },
          select: { proposalId: true, status: true },
        });
        if (input.leaveRequestUpdate.decisionInteractionId) {
          await tx.leaveRequest.update({
            where: { requestId: input.leaveRequestUpdate.requestId },
            data: { decisionInteractionId: input.leaveRequestUpdate.decisionInteractionId },
          });
        }
        return proposal;
      }),
  };
}
