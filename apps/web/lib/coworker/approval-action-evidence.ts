import "server-only";
import type { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { originalToolParameters } from "@/lib/attention/coworker-envelope-decision";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";

export type ApprovalActionEvidence =
  | { state: "missing" | "conflicting" | "unsupported"; reason: "not-settled" | "binding-unproven" | "operation-unsupported" | "execution-missing" | "execution-ambiguous" | "execution-binding-mismatch" | "result-unproven" }
  | { state: "available"; executionId: string; executedAtIso: string; toolName: "manage_provider_account";
      operation: "test"; connectionId: string; providerId?: string; outcome: "succeeded" | "failed";
      threadBinding: "matched" | "not-recorded";
      responsesVerification: "unproven"; quotaReconciliation: "unproven" };

type Envelope = { id: string; status: string; delegatingUserId: string; coworkerAgentId: string;
  threadId: string; manifestActionId: string; inputFingerprint: string | null; argsJson: unknown; createdAt: Date };
const LIMIT = 10;
const locator = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Only called after the envelope reader proves the authenticated human AND
 * assistant. Historical evidence is read without replaying or renewing consent. */
export async function readApprovalActionEvidence(envelope: Envelope, db: Pick<typeof prisma, "toolExecution">, now: Date): Promise<ApprovalActionEvidence> {
  if (envelope.status !== "executed" && envelope.status !== "failed") return { state: "missing", reason: "not-settled" };
  if (envelope.manifestActionId !== "manage_provider_account") return { state: "unsupported", reason: "operation-unsupported" };
  const binding = isRecord(envelope.argsJson) && isRecord(envelope.argsJson.approvalBinding) ? envelope.argsJson.approvalBinding : null;
  if (!binding || binding.actingHumanUserId !== envelope.delegatingUserId || binding.actingAgentId !== envelope.coworkerAgentId
    || binding.toolName !== envelope.manifestActionId || typeof binding.inputFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(binding.inputFingerprint) || binding.inputFingerprint !== envelope.inputFingerprint
    || binding.taskRunId !== null || binding.chainId !== null || binding.routeContext !== null || binding.authorResearchBinding != null) {
    return { state: "missing", reason: "binding-unproven" };
  }
  const rows = await db.toolExecution.findMany({
    where: { envelopeId: envelope.id, toolName: envelope.manifestActionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1,
    select: { id: true, envelopeId: true, userId: true, agentId: true, threadId: true, taskRunId: true,
      toolName: true, executionMode: true, createdAt: true, durationMs: true, parameters: true, success: true, result: true },
  });
  if (rows.length > LIMIT) return { state: "conflicting", reason: "execution-ambiguous" };
  const actual = rows.filter(row => row.executionMode !== "approval-outcome" && row.durationMs !== null
    && !(isRecord(row.result) && row.result.error === "approval_required"));
  if (!actual.length) return { state: "missing", reason: "execution-missing" };
  if (actual.length !== 1) return { state: "conflicting", reason: "execution-ambiguous" };
  const run = actual[0];
  const parameters = originalToolParameters(run.parameters);
  // The existing external approval runner supplies no threadId in its execution
  // context; governed audit stores "". Exact envelope/tool/actor/input still
  // bind that direct call. Never invent a matching thread or accept a foreign one.
  const unrecordedDirectThread = run.threadId === "" && run.executionMode === "external-jsonrpc";
  if (run.envelopeId !== envelope.id || run.toolName !== envelope.manifestActionId
    || run.userId !== envelope.delegatingUserId || run.agentId !== envelope.coworkerAgentId
    || (!unrecordedDirectThread && run.threadId !== envelope.threadId) || run.taskRunId !== null || !parameters
    || fingerprintCoworkerInput(parameters) !== binding.inputFingerprint
    || !Number.isFinite(run.createdAt.getTime()) || run.createdAt < envelope.createdAt || run.createdAt > now) {
    return { state: "conflicting", reason: "execution-binding-mismatch" };
  }
  if (parameters.operation !== "test" || !locator(parameters.connectionId)
    || (parameters.providerId !== undefined && !locator(parameters.providerId))) {
    return { state: "unsupported", reason: "operation-unsupported" };
  }
  if (!isRecord(run.result) || typeof run.result.success !== "boolean" || run.result.success !== run.success
    || (run.success && run.result.error !== undefined)) return { state: "missing", reason: "result-unproven" };
  // No raw messages/errors/arguments cross this boundary. Generic test success
  // does not contain a typed Responses or selected-quota transaction receipt.
  return { state: "available", executionId: run.id, executedAtIso: run.createdAt.toISOString(),
    toolName: "manage_provider_account", operation: "test", connectionId: parameters.connectionId,
    ...(parameters.providerId !== undefined ? { providerId: parameters.providerId } : {}),
    outcome: run.success ? "succeeded" : "failed", threadBinding: unrecordedDirectThread ? "not-recorded" : "matched",
    responsesVerification: "unproven", quotaReconciliation: "unproven" };
}
