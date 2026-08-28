import "server-only";

import { prisma } from "@dpf/db";

import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { AUTHORITY_APPROVAL_TTL_MS } from "@/lib/coworker/authority-approval-envelope";

const STALE_TASK_MS = 15 * 60 * 1000;

type RecoverableTaskRun = {
  id: string;
  taskRunId: string;
  status: string;
  updatedAt: Date;
  lastHeartbeatAt: Date | null;
  completedAt: Date | null;
  progressPayload: unknown;
  a2aMetadata: unknown;
};

type RecoverableEnvelope = {
  id: string;
  coworkerAgentId: string;
  delegatingUserId: string;
  threadId: string;
  chatMessageId: string | null;
  manifestActionId: string;
  argsJson: unknown;
  rationale: string;
  status: string;
  taskRunId: string | null;
  delegationChainId: string | null;
  authorityDecisionId: string | null;
  inputFingerprint: string | null;
  approvalBindingFingerprint: string | null;
  expiresAt: Date | null;
};

type RecoverableProposal = {
  id: string;
  threadId: string;
  agentId: string;
  userId: string;
  toolName: string;
  parameters: unknown;
  result: unknown;
  success: boolean;
  executionMode: string;
  routeContext: string | null;
  auditClass: string | null;
  capabilityId: string | null;
  summary: string | null;
  apiTokenId: string | null;
  taskRunId: string | null;
  skillId: string | null;
  delegatingUserId: string | null;
  chatMessageId: string | null;
  envelopeId: string | null;
  delegationChainId: string | null;
};

type ApprovalRecoveryTransaction = {
  taskRun: {
    findUnique(args: unknown): Promise<RecoverableTaskRun | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  coworkerActionEnvelope: {
    findFirst(args: unknown): Promise<RecoverableEnvelope | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<{ id: string }>;
  };
  toolExecution: {
    findFirst(args: unknown): Promise<{ id: string } | RecoverableProposal | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

type ApprovalRecoveryDb = {
  $transaction<T>(callback: (tx: ApprovalRecoveryTransaction) => Promise<T>): Promise<T>;
};

export type StaleApprovalRecovery =
  | { kind: "approved-resume-ready"; envelopeId: string }
  | {
      kind: "fresh-approval-required";
      sourceEnvelopeId: string;
      replacementEnvelopeId: string;
      replacementProposalExecutionId: string;
    };

class ApprovalRecoveryRace extends Error {}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function storedBinding(envelope: RecoverableEnvelope): CoworkerApprovalBinding | null {
  const args = objectRecord(envelope.argsJson);
  const value = objectRecord(args?.["approvalBinding"]);
  return value ? value as CoworkerApprovalBinding : null;
}

function isStale(run: RecoverableTaskRun, now: Date): boolean {
  if (run.status !== "working" && run.status !== "stalled") return false;
  if (!run.lastHeartbeatAt) return false;
  return run.lastHeartbeatAt.getTime() <= now.getTime() - STALE_TASK_MS;
}

function storedRequestDigest(run: RecoverableTaskRun): string | null {
  const metadata = objectRecord(run.a2aMetadata);
  const digest = metadata?.["requestDigest"];
  return typeof digest === "string" && digest.trim() ? digest.trim() : null;
}

function reboundProposalResult(value: unknown, envelopeId: string): Record<string, unknown> {
  const result = objectRecord(value) ?? {};
  const data = objectRecord(result["data"]) ?? {};
  return {
    ...result,
    data: { ...data, envelopeId },
  };
}

function recoveryProgress(
  run: RecoverableTaskRun,
  input: {
    requestDigest: string;
    sourceEnvelopeId: string;
    replacementEnvelopeId: string;
    replacementProposalExecutionId: string;
    approvalBindingFingerprint: string;
    observedAt: string;
    freshApprovalRequired: boolean;
  },
) {
  const progress = objectRecord(run.progressPayload) ?? {};
  return {
    ...progress,
    approvalRecovery: {
      schemaVersion: 1,
      kind: input.freshApprovalRequired
        ? "expired-approved-envelope"
        : "stale-approved-envelope",
      requestDigest: input.requestDigest,
      sourceStatus: run.status,
      sourceEnvelopeId: input.sourceEnvelopeId,
      replacementEnvelopeId: input.replacementEnvelopeId,
      replacementProposalExecutionId: input.replacementProposalExecutionId,
      approvalBindingFingerprint: input.approvalBindingFingerprint,
      observedAt: input.observedAt,
      inferenceRerun: false,
      freshApprovalRequired: input.freshApprovalRequired,
    },
  };
}

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
        || !isStale(run, now)
      ) return null;

      const envelope = await tx.coworkerActionEnvelope.findFirst({
        where: {
          taskRunId: input.taskRunId,
          delegatingUserId: input.userId,
          coworkerAgentId: input.agentId,
          manifestActionId: input.writerToolName,
          status: "approved",
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
          status: "approved",
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
