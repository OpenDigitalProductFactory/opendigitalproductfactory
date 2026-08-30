import "server-only";

import { prisma } from "@dpf/db";

import {
  fingerprintCoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { AUTHORITY_APPROVAL_TTL_MS } from "@/lib/coworker/authority-approval-envelope";
import {
  type ApprovalRecoveryDb,
  type RecoverableProposal,
  type RecoverableTaskRun,
  failedReviewWorkroomTarget,
  isRecoverableProviderFailure,
  isStaleApprovalRecoveryRun,
  objectRecord,
  reboundProposalResult,
  recoveryProgress,
  storedBinding,
  storedRequestDigest,
} from "@/lib/mcp-task-approval-recovery-contract";

export type StaleApprovalRecovery =
  | { kind: "approved-resume-ready"; envelopeId: string }
  | {
      kind: "fresh-approval-required";
      sourceEnvelopeId: string;
      replacementEnvelopeId: string;
      replacementProposalExecutionId: string;
    };

class ApprovalRecoveryRace extends Error {}

export async function recoverStaleApprovedRemoteTask(
  input: {
    taskRunId: string;
    requestDigest: string;
    expectedUpdatedAt: Date;
    userId: string;
    agentId: string;
    writerToolName: string;
    now?: Date;
  },
  db: ApprovalRecoveryDb = prisma as unknown as ApprovalRecoveryDb,
): Promise<StaleApprovalRecovery | null> {
  const now = input.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const run = await tx.taskRun.findUnique({
        where: { taskRunId: input.taskRunId },
        select: {
          id: true,
          taskRunId: true,
          status: true,
          updatedAt: true,
          lastHeartbeatAt: true,
          completedAt: true,
          progressPayload: true,
          a2aMetadata: true,
        },
      });
      if (
        !run
        || run.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
        || storedRequestDigest(run) !== input.requestDigest
        || (!isStaleApprovalRecoveryRun(run, now) && run.status !== "failed")
      ) return null;

      const providerFailure = isRecoverableProviderFailure(run);
      if (run.status === "failed") {
        const target = failedReviewWorkroomTarget(run);
        if (!target && !providerFailure) return null;
        if (target) {
          const candidates = await tx.workroom.findMany({
            where: {
              backlogItemId: target.itemId,
              repositoryFullName: target.repositoryFullName,
              archivedAt: null,
              status: { notIn: ["abandoned", "cancelled"] },
            },
            take: 2,
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            select: { capsuleId: true, headSha: true },
          });
          const matching = candidates.filter(
            (candidate) => candidate.headSha?.toLocaleLowerCase("en-US") === target.commitSha,
          );
          if (matching.length !== 1) return null;
        }
      }

      const envelope = await tx.coworkerActionEnvelope.findFirst({
        where: {
          taskRunId: input.taskRunId,
          delegatingUserId: input.userId,
          coworkerAgentId: input.agentId,
          manifestActionId: input.writerToolName,
          status: { in: ["approved", "failed"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          coworkerAgentId: true,
          delegatingUserId: true,
          threadId: true,
          chatMessageId: true,
          manifestActionId: true,
          argsJson: true,
          rationale: true,
          status: true,
          taskRunId: true,
          delegationChainId: true,
          authorityDecisionId: true,
          inputFingerprint: true,
          approvalBindingFingerprint: true,
          expiresAt: true,
        },
      });
      if (!envelope?.expiresAt || envelope.taskRunId !== input.taskRunId) return null;
      if (
        envelope.status === "failed"
        && !providerFailure
      ) return null;

      const binding = storedBinding(envelope);
      if (
        !binding
        || binding.taskRunId !== input.taskRunId
        || binding.actingHumanUserId !== input.userId
        || binding.actingAgentId !== input.agentId
        || binding.toolName !== input.writerToolName
      ) return null;
      const approvalBindingFingerprint = fingerprintCoworkerApprovalBinding(binding);
      if (
        !envelope.approvalBindingFingerprint
        || envelope.approvalBindingFingerprint !== approvalBindingFingerprint
        || envelope.inputFingerprint !== binding.inputFingerprint
      ) return null;

      const completedWriter = await tx.toolExecution.findFirst({
        where: {
          taskRunId: input.taskRunId,
          toolName: input.writerToolName,
          OR: [
            { success: true },
            { receipt: { isNot: null } },
          ],
        },
        select: { id: true },
      });
      if (completedWriter) return null;

      const proposal = await tx.toolExecution.findFirst({
        where: {
          taskRunId: input.taskRunId,
          toolName: input.writerToolName,
          success: false,
          result: { path: ["data", "envelopeId"], equals: envelope.id },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          threadId: true,
          agentId: true,
          userId: true,
          toolName: true,
          parameters: true,
          result: true,
          success: true,
          executionMode: true,
          routeContext: true,
          auditClass: true,
          capabilityId: true,
          summary: true,
          apiTokenId: true,
          taskRunId: true,
          skillId: true,
          delegatingUserId: true,
          chatMessageId: true,
          envelopeId: true,
          delegationChainId: true,
        },
      }) as RecoverableProposal | null;
      if (
        !proposal
        || proposal.taskRunId !== input.taskRunId
        || proposal.toolName !== input.writerToolName
        || proposal.success
        || !objectRecord(proposal.parameters)
      ) return null;

      const observedAt = now.toISOString();
      if (envelope.expiresAt.getTime() > now.getTime()) {
        if (envelope.status !== "approved") return null;
        // A normal input-required replay already owns the unexpired approval
        // path. Recovery may only replace an expired approval in this state.
        if (run.status === "input-required") return null;
        const parked = await tx.taskRun.updateMany({
          where: {
            taskRunId: input.taskRunId,
            status: run.status,
            updatedAt: run.updatedAt,
          },
          data: {
            status: "input-required",
            completedAt: null,
            progressPayload: recoveryProgress(run, {
              requestDigest: input.requestDigest,
              sourceEnvelopeId: envelope.id,
              replacementEnvelopeId: envelope.id,
              replacementProposalExecutionId: proposal.id,
              approvalBindingFingerprint,
              observedAt,
              freshApprovalRequired: false,
            }),
          },
        });
        if (parked.count !== 1) throw new ApprovalRecoveryRace();
        return { kind: "approved-resume-ready", envelopeId: envelope.id };
      }

      const cancelled = await tx.coworkerActionEnvelope.updateMany({
        where: {
          id: envelope.id,
          status: envelope.status,
          expiresAt: { lte: now },
        },
        data: { status: "cancelled", resolvedAt: now },
      });
      if (cancelled.count !== 1) throw new ApprovalRecoveryRace();

      const replacement = await tx.coworkerActionEnvelope.create({
        data: {
          coworkerAgentId: envelope.coworkerAgentId,
          delegatingUserId: envelope.delegatingUserId,
          threadId: envelope.threadId,
          chatMessageId: envelope.chatMessageId,
          manifestActionId: envelope.manifestActionId,
          argsJson: envelope.argsJson,
          rationale: envelope.rationale,
          status: "proposed",
          taskRunId: envelope.taskRunId,
          delegationChainId: envelope.delegationChainId,
          authorityDecisionId: envelope.authorityDecisionId,
          inputFingerprint: envelope.inputFingerprint,
          approvalBindingFingerprint,
          expiresAt: new Date(now.getTime() + AUTHORITY_APPROVAL_TTL_MS),
          resolvedAt: null,
        },
        select: { id: true },
      });
      const replacementProposal = await tx.toolExecution.create({
        data: {
          threadId: proposal.threadId,
          agentId: proposal.agentId,
          userId: proposal.userId,
          toolName: proposal.toolName,
          parameters: proposal.parameters,
          result: reboundProposalResult(proposal.result, replacement.id),
          success: false,
          executionMode: "proposal",
          routeContext: proposal.routeContext,
          auditClass: proposal.auditClass,
          capabilityId: proposal.capabilityId,
          summary: proposal.summary,
          apiTokenId: proposal.apiTokenId,
          taskRunId: proposal.taskRunId,
          skillId: proposal.skillId,
          delegatingUserId: proposal.delegatingUserId,
          chatMessageId: proposal.chatMessageId,
          envelopeId: null,
          delegationChainId: proposal.delegationChainId,
        },
        select: { id: true },
      });

      const parked = await tx.taskRun.updateMany({
        where: {
          taskRunId: input.taskRunId,
          status: run.status,
          updatedAt: run.updatedAt,
        },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: recoveryProgress(run, {
            requestDigest: input.requestDigest,
            sourceEnvelopeId: envelope.id,
            replacementEnvelopeId: replacement.id,
            replacementProposalExecutionId: replacementProposal.id,
            approvalBindingFingerprint,
            observedAt,
            freshApprovalRequired: true,
            sourceEnvelopeStatus: envelope.status,
          }),
        },
      });
      if (parked.count !== 1) throw new ApprovalRecoveryRace();

      return {
        kind: "fresh-approval-required",
        sourceEnvelopeId: envelope.id,
        replacementEnvelopeId: replacement.id,
        replacementProposalExecutionId: replacementProposal.id,
      };
    });
  } catch (error) {
    if (error instanceof ApprovalRecoveryRace) return null;
    throw error;
  }
}
