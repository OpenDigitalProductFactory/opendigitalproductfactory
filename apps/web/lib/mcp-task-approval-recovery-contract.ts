import type { CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";

export type RecoverableTaskRun = {
  id: string;
  taskRunId: string;
  status: string;
  updatedAt: Date;
  lastHeartbeatAt: Date | null;
  completedAt: Date | null;
  progressPayload: unknown;
  a2aMetadata: unknown;
};

const APPROVAL_RECOVERY_STALE_TASK_MS = 15 * 60 * 1000;

export function isStaleApprovalRecoveryRun(
  run: Pick<RecoverableTaskRun, "status" | "lastHeartbeatAt">,
  now: Date = new Date(),
): boolean {
  if (
    run.status !== "working"
    && run.status !== "stalled"
    && run.status !== "input-required"
  ) return false;
  if (!run.lastHeartbeatAt) return false;
  return run.lastHeartbeatAt.getTime() <= now.getTime() - APPROVAL_RECOVERY_STALE_TASK_MS;
}

export type RecoverableEnvelope = {
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

export type RecoverableProposal = {
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

export type ApprovalRecoveryTransaction = {
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

export type ApprovalRecoveryDb = {
  $transaction<T>(callback: (tx: ApprovalRecoveryTransaction) => Promise<T>): Promise<T>;
};

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function storedBinding(envelope: RecoverableEnvelope): CoworkerApprovalBinding | null {
  const args = objectRecord(envelope.argsJson);
  const value = objectRecord(args?.["approvalBinding"]);
  return value ? value as CoworkerApprovalBinding : null;
}

export function storedRequestDigest(run: RecoverableTaskRun): string | null {
  const metadata = objectRecord(run.a2aMetadata);
  const digest = metadata?.["requestDigest"];
  return typeof digest === "string" && digest.trim() ? digest.trim() : null;
}

export function reboundProposalResult(value: unknown, envelopeId: string): Record<string, unknown> {
  const result = objectRecord(value) ?? {};
  const data = objectRecord(result["data"]) ?? {};
  return { ...result, data: { ...data, envelopeId } };
}

export function recoveryProgress(
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
