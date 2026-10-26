import "server-only";
import type { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { originalToolParameters } from "@/lib/attention/coworker-envelope-decision";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import type { ApprovalFailureEvidence, UnavailableApprovalEvidence } from "./approval-outcome";

export type ApprovalActionEvidence = UnavailableApprovalEvidence
  | { state: "available"; executionId: string; executedAtIso: string; toolName: "manage_provider_account";
      operation: "test"; connectionId: string; providerId?: string; outcome: "succeeded" | "failed";
      threadBinding: "matched" | "not-recorded";
      responsesVerification: "unproven"; quotaReconciliation: "unproven" };

type Envelope = { id: string; status: string; delegatingUserId: string; coworkerAgentId: string;
  threadId: string; manifestActionId: string; inputFingerprint: string | null; argsJson: unknown; createdAt: Date };
type Db = Pick<typeof prisma, "toolExecution">;
const LIMIT = 10;
const locator = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Server-only original evidence. Callers must project an explicit safe contract;
 * neither this object nor its parameters/result may cross the read boundary. */
async function readBoundApprovalExecution(envelope: Envelope, db: Db, now: Date) {
  if (envelope.status !== "executed" && envelope.status !== "failed") return { state: "missing", reason: "not-settled" } as const;
  const binding = isRecord(envelope.argsJson) && isRecord(envelope.argsJson.approvalBinding) ? envelope.argsJson.approvalBinding : null;
  if (!binding || binding.actingHumanUserId !== envelope.delegatingUserId || binding.actingAgentId !== envelope.coworkerAgentId
    || binding.toolName !== envelope.manifestActionId || typeof binding.inputFingerprint !== "string"
    || !/^[a-f0-9]{64}$/.test(binding.inputFingerprint) || binding.inputFingerprint !== envelope.inputFingerprint
    || binding.taskRunId !== null || binding.chainId !== null || binding.routeContext !== null || binding.authorResearchBinding != null) {
    return { state: "missing", reason: "binding-unproven" } as const;
  }
  const rows = await db.toolExecution.findMany({
    where: { envelopeId: envelope.id, toolName: envelope.manifestActionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1,
    select: { id: true, envelopeId: true, userId: true, agentId: true, threadId: true, taskRunId: true,
      toolName: true, executionMode: true, createdAt: true, durationMs: true, parameters: true, success: true, result: true },
  });
  if (rows.length > LIMIT) return { state: "conflicting", reason: "execution-ambiguous" } as const;
  const actual = rows.filter(row => row.executionMode !== "approval-outcome" && row.durationMs !== null
    && !(isRecord(row.result) && row.result.error === "approval_required"));
  if (!actual.length) return { state: "missing", reason: "execution-missing" } as const;
  if (actual.length !== 1) return { state: "conflicting", reason: "execution-ambiguous" } as const;
  const run = actual[0];
  const parameters = originalToolParameters(run.parameters);
  // Historical direct calls genuinely lack thread attribution. Preserve that
  // absence while requiring the exact envelope, tool, actor and input.
  const unrecordedDirectThread = run.threadId === "" && run.executionMode === "external-jsonrpc";
  if (run.envelopeId !== envelope.id || run.toolName !== envelope.manifestActionId
    || run.userId !== envelope.delegatingUserId || run.agentId !== envelope.coworkerAgentId
    || (!unrecordedDirectThread && run.threadId !== envelope.threadId) || run.taskRunId !== null || !parameters
    || fingerprintCoworkerInput(parameters) !== binding.inputFingerprint
    || !Number.isFinite(run.createdAt.getTime()) || run.createdAt < envelope.createdAt || run.createdAt > now) {
    return { state: "conflicting", reason: "execution-binding-mismatch" } as const;
  }
  return { state: "available", run, parameters,
    threadBinding: unrecordedDirectThread ? "not-recorded" : "matched" } as const;
}

/** Keep operation classification ahead of result validation for existing readers. */
function consistentResult(run: { success: boolean; result: unknown }) {
  const result = run.result;
  return isRecord(result) && typeof result.success === "boolean" && result.success === run.success
    && !(run.success && result.error !== undefined) ? result : null;
}

/** Read only after owner/assistant admission. No replay or consent renewal. */
export async function readApprovalActionEvidence(envelope: Envelope, db: Db, now: Date): Promise<ApprovalActionEvidence> {
  if (envelope.status !== "executed" && envelope.status !== "failed") return { state: "missing", reason: "not-settled" };
  if (envelope.manifestActionId !== "manage_provider_account") return { state: "unsupported", reason: "operation-unsupported" };
  const bound = await readBoundApprovalExecution(envelope, db, now);
  if (bound.state !== "available") return bound;
  const { parameters, run } = bound;
  if (parameters.operation !== "test" || !locator(parameters.connectionId)
    || (parameters.providerId !== undefined && !locator(parameters.providerId))) {
    return { state: "unsupported", reason: "operation-unsupported" };
  }
  if (!consistentResult(run)) return { state: "missing", reason: "result-unproven" };
  return { state: "available", executionId: run.id, executedAtIso: run.createdAt.toISOString(),
    toolName: "manage_provider_account", operation: "test", connectionId: parameters.connectionId,
    ...(parameters.providerId !== undefined ? { providerId: parameters.providerId } : {}),
    outcome: run.success ? "succeeded" : "failed", threadBinding: bound.threadBinding,
    responsesVerification: "unproven", quotaReconciliation: "unproven" };
}

/** A tool-specific allowlist explains the original refusal, never arbitrary
 * handler text. Room navigation needs a separate current access check. */
export async function readApprovalFailureEvidence(
  envelope: Envelope, db: Db, now: Date,
  resolveRoomHref?: (capsuleId: string) => Promise<string | null>,
): Promise<ApprovalFailureEvidence> {
  if (envelope.status !== "failed") return { state: "missing", reason: "not-settled" };
  if (envelope.manifestActionId !== "reassign_workroom_executor") return { state: "unsupported", reason: "operation-unsupported" };
  const bound = await readBoundApprovalExecution(envelope, db, now);
  if (bound.state !== "available") return bound;
  const result = consistentResult(bound.run);
  if (!result || bound.run.success || result.error !== "handoff-transaction-required") {
    return { state: "missing", reason: "result-unproven" };
  }
  const capsuleId = bound.parameters.capsuleId;
  const roomHref = typeof capsuleId === "string" && /^WC-[A-Za-z0-9-]{1,96}$/.test(capsuleId)
    ? await resolveRoomHref?.(capsuleId).catch(() => null) : null;
  return { state: "available", code: "handoff-transaction-required",
    executionId: bound.run.id, executedAtIso: bound.run.createdAt.toISOString(),
    threadBinding: bound.threadBinding, ...(roomHref ? { roomHref } : {}),
    roomAccess: roomHref ? "available" : "unavailable" };
}
