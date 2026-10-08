// Durable propose-only record of a time-off recommendation (BI-4D030159).
// The AI may prepare this record; only D1's governed human approve/reject
// actions may mutate LeaveRequest.status.

import { prisma } from "@dpf/db";

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

/** The recommendation's audit key (stable per request and interaction) and its state. */
type RecommendationResult = { recommendationId: string; status: "proposed" };

/**
 * BI-7BCC87BB (approval convergence PR-B, spec D2 S5): a time-off decision is
 * the manager's own act under HR approval authority, and the coworker only
 * recommends. So the recommendation is no longer an AgentActionProposal and
 * never an envelope: it is the leave thread's assistant message plus the
 * request's link to its DecisionInteraction, which the leave surface reads
 * (lib/workforce/leave-data.ts) and the manager's decision resolves
 * (lib/actions/leave.ts).
 */
export type LeaveDecisionRecommendationPersistence = {
  ensureThread(input: { userId: string; threadId?: string | null }): Promise<{ id: string }>;
  /** The same recommendation already written to the thread, for idempotency. */
  findExistingMessage(input: { threadId: string; content: string }): Promise<{ id: string } | null>;
  writeRecommendation(input: {
    threadId: string;
    taskRunId?: string | null;
    agentId: string;
    messageContent: string;
    leaveRequestUpdate: {
      requestId: string;
      decisionInteractionId: string | null;
    };
  }): Promise<{ messageId: string }>;
};

export async function proposeLeaveDecision(input: {
  decision: LeaveDecisionRuntimeResult;
  userId: string;
  agentId?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  persistence?: LeaveDecisionRecommendationPersistence;
}): Promise<RecommendationResult & { existing?: true }> {
  const draft = prepareLeaveDecisionProposal(input.decision);
  const auditKey = input.decision.interactionId ?? `guard-${input.decision.action}`;
  const recommendationId = `leave-decision:${input.decision.request.requestId}:${auditKey}`;
  const persistence = input.persistence ?? prismaLeaveDecisionRecommendationPersistence();
  const messageContent = `Time-off recommendation: ${draft.parameters.recommendation}. ${draft.parameters.rationale}`;

  const thread = await persistence.ensureThread({ userId: input.userId, threadId: input.threadId });
  const existing = await persistence.findExistingMessage({ threadId: thread.id, content: messageContent });
  if (existing) return { recommendationId, status: "proposed", existing: true };

  await persistence.writeRecommendation({
    threadId: thread.id,
    taskRunId: input.taskRunId,
    agentId: input.agentId ?? DEFAULT_AGENT_ID,
    messageContent,
    leaveRequestUpdate: {
      requestId: input.decision.request.requestId,
      decisionInteractionId: input.decision.interactionId,
    },
  });
  return { recommendationId, status: "proposed" };
}

const LEAVE_RECOMMENDATION_TASK_TYPE = "leave-decision-recommendation";

export function prismaLeaveDecisionRecommendationPersistence(): LeaveDecisionRecommendationPersistence {
  return {
    ensureThread: async ({ userId, threadId }) => {
      if (threadId) return { id: threadId };
      return prisma.agentThread.upsert({
        where: { userId_contextKey: { userId, contextKey: LEAVE_DECISION_CONTEXT_KEY } },
        create: { userId, contextKey: LEAVE_DECISION_CONTEXT_KEY },
        update: {},
        select: { id: true },
      });
    },
    findExistingMessage: ({ threadId, content }) =>
      prisma.agentMessage.findFirst({
        where: { threadId, role: "assistant", taskType: LEAVE_RECOMMENDATION_TASK_TYPE, content },
        select: { id: true },
      }),
    writeRecommendation: (input) =>
      prisma.$transaction(async (tx) => {
        const message = await tx.agentMessage.create({
          data: {
            threadId: input.threadId,
            role: "assistant",
            content: input.messageContent,
            agentId: input.agentId,
            routeContext: LEAVE_DECISION_ROUTE,
            taskType: LEAVE_RECOMMENDATION_TASK_TYPE,
            ...(input.taskRunId ? { taskRunId: input.taskRunId } : {}),
          },
          select: { id: true },
        });
        if (input.leaveRequestUpdate.decisionInteractionId) {
          await tx.leaveRequest.update({
            where: { requestId: input.leaveRequestUpdate.requestId },
            data: { decisionInteractionId: input.leaveRequestUpdate.decisionInteractionId },
          });
        }
        return { messageId: message.id };
      }),
  };
}
