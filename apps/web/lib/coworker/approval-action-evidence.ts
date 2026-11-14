import "server-only";
import type { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { originalToolParameters } from "@/lib/attention/coworker-envelope-decision";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import type { ApprovalFailureEvidence, UnavailableApprovalEvidence } from "./approval-outcome";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const runtimeStatuses = ["succeeded", "failed", "transition_in_progress", "drain_required", "active_conflict",
  "host_applied_pending_verification", "rolled_back", "rollback_failed"] as const;
type RuntimeOperationStatus = typeof runtimeStatuses[number];
export const runtimeFailureCodes = ["runtime_transition_database_stale", "runtime_transition_database_baseline_changed",
  "runtime_transition_host_configuration_missing", "runtime_image_configuration_unverified",
  "runtime_service_image_protocol_unsupported", "runtime_reconciliation_protocol_unsupported",
  "runtime_capability_recovery_required", "runtime_capability_reconciliation_in_progress",
  "runtime_transition_authority_token_missing", "runtime_transition_authority_release_failed",
  "runtime_service_image_manifest_unproven", "runtime_protocol_server_identity_mismatch",
  "runtime_protocol_release_identity_missing", "promoter_unavailable", "promoter_spawn_failed",
  "required_health_failed", "host_apply_failed"] as const;
export type RuntimeFailureCode = typeof runtimeFailureCodes[number];
export type RuntimeTransitionObservation =
  | { state: "unavailable" | "not-recorded" | "conflicting"; receiptVerification: "unproven" }
  | { state: "recorded"; status: "pending" | "applying" | "host_applied" | "succeeded" | "failed" | "compensating" | "rolled_back" | "rollback_failed";
      receiptVerification: "verified" | "unproven"; receiptStatus: "applied" | "failed" | "rolled_back" | "rollback_failed" | null;
      recoveryRequired: "recorded" | "unproven" };
export type RuntimeApprovalActionEvidence = {
  state: "available"; executionId: string; executedAtIso: string; toolName: "reconcile_runtime_capabilities";
  operation: "reconciliation"; transitionId: string; outcome: "succeeded" | "failed" | "incomplete";
  operationStatus: RuntimeOperationStatus | null; failureCode: RuntimeFailureCode | null;
  threadBinding: "matched" | "not-recorded"; hostEvidence: RuntimeTransitionObservation;
};
export type RuntimeEvidenceRequest = { transitionId: string; requestedById: string; reconciliation: Record<string, unknown>;
  imageServices: unknown; executedAt: Date };
type RuntimeEvidenceReader = (request: RuntimeEvidenceRequest) => Promise<RuntimeTransitionObservation>;

export type ApprovalActionEvidence = UnavailableApprovalEvidence
  | RuntimeApprovalActionEvidence
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
export async function readApprovalActionEvidence(envelope: Envelope, db: Db, now: Date, readRuntime?: RuntimeEvidenceReader): Promise<ApprovalActionEvidence> {
  if (envelope.status !== "executed" && envelope.status !== "failed") return { state: "missing", reason: "not-settled" };
  if (envelope.manifestActionId !== "manage_provider_account" && envelope.manifestActionId !== "reconcile_runtime_capabilities") {
    return { state: "unsupported", reason: "operation-unsupported" };
  }
  const bound = await readBoundApprovalExecution(envelope, db, now);
  if (bound.state !== "available") return bound;
  const { parameters, run } = bound;
  if (envelope.manifestActionId === "reconcile_runtime_capabilities") {
    if (typeof parameters.transitionId !== "string" || !/^RCT-[A-Za-z0-9-]{1,48}$/.test(parameters.transitionId)
      || !isRecord(parameters.reconciliation)) return { state: "missing", reason: "result-unproven" };
    const result = consistentResult(run);
    try { if (!result || JSON.stringify(result).length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) throw new Error(); }
    catch { return { state: "missing", reason: "result-unproven" }; }
    const data = isRecord(result.data) ? result.data : null;
    const status = data?.status;
    if (status !== undefined && !runtimeStatuses.includes(status as RuntimeOperationStatus)) {
      return { state: "missing", reason: "result-unproven" };
    }
    if (run.success !== (status === "succeeded") || (status === undefined && typeof result.error !== "string")) {
      return { state: "missing", reason: "result-unproven" };
    }
    const rawCode = status === undefined ? result.error : data?.failure;
    const failureCode = runtimeFailureCodes.includes(rawCode as RuntimeFailureCode) ? rawCode as RuntimeFailureCode : null;
    const incomplete = status === "transition_in_progress" || status === "drain_required" || status === "active_conflict"
      || status === "host_applied_pending_verification";
    const hostEvidence = await readRuntime?.({ transitionId: parameters.transitionId, requestedById: envelope.delegatingUserId,
      reconciliation: parameters.reconciliation, imageServices: parameters.imageServices, executedAt: run.createdAt })
      .catch(() => ({ state: "unavailable" as const, receiptVerification: "unproven" as const }))
      ?? { state: "unavailable" as const, receiptVerification: "unproven" as const };
    return { state: "available", executionId: run.id, executedAtIso: run.createdAt.toISOString(),
      toolName: "reconcile_runtime_capabilities", operation: "reconciliation", transitionId: parameters.transitionId,
      outcome: status === "succeeded" ? "succeeded" : incomplete ? "incomplete" : "failed",
      operationStatus: status as RuntimeOperationStatus | undefined ?? null, failureCode,
      threadBinding: bound.threadBinding, hostEvidence };
  }
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

/** Internal server-only operation binding. Callers project an explicit safe
 * observation and never serialize these original parameters or raw results. */
export async function readFailedBoundedHandoffOperation(envelope: Envelope, db: Db, now: Date) {
  if (envelope.status !== "failed" || envelope.manifestActionId !== "reassign_workroom_executor") return null;
  const bound = await readBoundApprovalExecution(envelope, db, now);
  if (bound.state !== "available") return null;
  const result = consistentResult(bound.run);
  if (!result || bound.run.success || result.error !== "handoff-transaction-required") return null;
  try {
    const { parseBoundedHandoffCommand } = await import("@/lib/work-capsules/bounded-handoff-command");
    const command = parseBoundedHandoffCommand(bound.parameters);
    if (command?.phase !== "request") return null;
    return { approvalId: envelope.id, executionId: bound.run.id, executedAtIso: bound.run.createdAt.toISOString(),
      ownerUserId: envelope.delegatingUserId, sourceAgentId: envelope.coworkerAgentId, command };
  } catch { return null; }
}
