import { parseReviewExecutionAuthority } from "./mcp-task-persisted-request";
export { parseReviewExecutionAuthority } from "./mcp-task-persisted-request";
import { ok, err, type ActionSuccess, type ActionFailure } from "./shared/action-result";
import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthExecutionAuthority } from "./auth/oauth-tokens";
import { deterministicExternalTaskRunId, matchingRemoteTaskRequestDigest, reconcileReviewReplayScope } from "./mcp-task-capacity-contract";
import { parseTerminalWriterWait } from "./mcp-task-replay-projection";
import { nextTerminalWriterAttempt } from "./mcp-task-terminal-writer-recovery";
import { recoverTerminalWriterEscalation, TERMINAL_WRITER_MAX_ATTEMPTS } from "./mcp-task-terminal-writer-escalation";
import { hasExecutionUncertainty } from "./shared/execution-uncertainty";
import { expandGrants } from "./tak/agent-grants";
import { isRecord } from "./shared/coerce";
import { isBoundReviewTask, taskExecutionEligible } from "./shared/task-execution-fence";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import type { UserContext } from "./permissions";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import type { ExistingRemoteTask, RemoteTaskSubmitAuth } from "./mcp-task-submit-types";

type RecoveryTask = ExistingRemoteTask & { authorityScope: string[] };
type RecoverySelection = ActionSuccess<{ existing: RecoveryTask }> | (ActionFailure & {
  result: { isError: true; content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> };
});
const refuse = (reason: string): Extract<RecoverySelection, { ok: false }> => ({ ...err(reason), result: {
  isError: true, content: [{ type: "text", text: `Original review recovery refused: ${reason}` }],
  structuredContent: { error: "review_recovery_refused", reason, action: "Refresh the exact task recovery packet; no new task was created." },
} });

/** A locator never grants replay authority. No write occurs until the existing lifecycle CAS. */
export async function loadExplicitReviewRecovery(input: {
  token: RemoteTaskSubmitAuth; parsed: RemoteTaskSubmitParams; userContext: UserContext;
}): Promise<RecoverySelection> {
  const { token, parsed } = input;
  const target = parsed.reviewRecovery;
  const binding = parsed.initiativeReviewBinding;
  if (!target || parsed.collaborationKind !== "handoff" || parsed.routeContext !== "/build" || parsed.objective !== parsed.prompt || !binding?.workroomRef || token.source !== "oauth" || token.capability !== "write") {
    return refuse("current-interactive-review-authority-required");
  }
  const original = await prisma.taskRun.findFirst({ where: { taskRunId: target.taskRunId, userId: token.userId },
    select: { id: true, taskRunId: true, userId: true, threadId: true, contextId: true, status: true,
      a2aMetadata: true, progressPayload: true, authorityScope: true, updatedAt: true, completedAt: true, lastHeartbeatAt: true } });
  if (!original || original.userId !== token.userId || !original.threadId || !original.contextId
    || original.updatedAt.toISOString() !== target.expectedUpdatedAt) return refuse("original-task-or-checkpoint-changed");
  const meta = isRecord(original.a2aMetadata) ? original.a2aMetadata : {};
  const savedScope = reconcileReviewReplayScope(meta, original.authorityScope, parsed);
  if (meta.tokenSource !== "oauth" || meta.tokenCapability !== "write" || typeof meta.apiTokenId !== "string"
    || typeof meta.taskAuthorityKey !== "string" || !meta.taskAuthorityKey.startsWith("oauth-family:")
    || meta.idempotencyKey !== parsed.idempotencyKey || meta.requestDigest !== target.requestDigest
    || deterministicExternalTaskRunId(meta.taskAuthorityKey, parsed.idempotencyKey) !== original.taskRunId
    || !savedScope || matchingRemoteTaskRequestDigest(meta, { ...parsed, authorityScope: savedScope }) !== target.requestDigest) {
    return refuse("immutable-request-or-scope-mismatch");
  }
  const wait = parseTerminalWriterWait(original.progressPayload);
  const progress = isRecord(original.progressPayload) ? original.progressPayload : {};
  if (original.status !== "input-required" || !wait || wait.writerToolName !== binding.writerToolName
    || hasExecutionUncertainty(progress) || recoverTerminalWriterEscalation(progress)
    || nextTerminalWriterAttempt(wait) > TERMINAL_WRITER_MAX_ATTEMPTS) return refuse("checkpoint-not-safely-resumable");
  if (!recoveryWindowOpen(meta, progress)) return refuse("recorded-recovery-window-expired");
  const authorized = await authorizeReviewRecoveryExecution({ token, parsed, userContext: input.userContext,
    metadata: meta, savedScope });
  if (!authorized.ok) return authorized;
  const current = authorized.data.current;
  return ok({ existing: { ...original, authorityScope: savedScope,
    progressPayload: { ...progress, reviewExecutionAuthority: {
      schemaVersion: 1, tokenId: token.tokenId, userId: token.userId, actingAgentId: current.agentId,
      requestDigest: target.requestDigest, originTokenId: meta.apiTokenId,
      expectedPriorUpdatedAt: target.expectedUpdatedAt, recordedAt: new Date().toISOString(),
    } },
  } });
}

/** Origin is evidence; only a currently authorized interactive connection can execute. */
async function authorizeReviewRecoveryExecution(input: {
  token: RemoteTaskSubmitAuth; parsed: RemoteTaskSubmitParams; userContext: UserContext;
  metadata: Record<string, unknown>; savedScope: string[];
}): Promise<ActionSuccess<{ current: { agentId: string } }> | Extract<RecoverySelection, { ok: false }>> {
  const { token, parsed, metadata: meta, savedScope } = input;
  const binding = parsed.initiativeReviewBinding;
  if (!binding?.workroomRef || token.source !== "oauth" || token.capability !== "write") {
    return refuse("current-interactive-review-authority-required");
  }
  if (typeof meta.apiTokenId !== "string") return refuse("immutable-origin-incomplete");
  const current = await prisma.mcpApiToken.findUnique({ where: { id: token.tokenId },
    select: { ...OAUTH_EXECUTION_AUTHORITY_SELECT, scopes: true, capability: true } });
  if (!current || current.userId !== token.userId || !current.agentId || !current.authorityBindingId
    || current.oauthClient?.registrationKind === "credentials" || current.capability !== "write"
    || !await isCurrentOAuthExecutionAuthority(current)) return refuse("current-interactive-review-authority-required");
  const available = new Set(expandGrants(current.scopes));
  if (savedScope.some(scope => !scope.startsWith("tool:") && !scope.startsWith("backlog-item:") && !available.has(scope))) {
    return refuse("current-token-scope-narrowed");
  }
  const origin = await prisma.mcpApiToken.findUnique({ where: { id: meta.apiTokenId }, select: { userId: true, agentId: true } });
  if (!origin || origin.userId !== token.userId || !origin.agentId
    || resolveCanonicalAgentId(origin.agentId) !== resolveCanonicalAgentId(current.agentId)) return refuse("original-human-or-coworker-mismatch");
  // Reuse the native lane's live human, coworker, room, target and exact packet checks.
  const { authorizeCoworkerRequest } = await import("./mcp/independent-review-request");
  const authority = await authorizeCoworkerRequest({ targetAgent: parsed.agentId, objective: parsed.objective,
    questionPacketSummary: parsed.title, requestKey: parsed.idempotencyKey, tier: 2, enteredVia: "handoff",
    requiredToolNames: savedScope.filter(scope => scope.startsWith("tool:")).map(scope => scope.slice(5)),
    initiativeReviewBinding: binding,
  }, token.userId, { agentId: current.agentId, apiTokenId: token.tokenId, authSource: "oauth",
    tokenScope: "write", tokenGrantScopes: current.scopes, userContext: input.userContext }, { forceBounded: true });
  if (authority.refusal || !authority.bounded) return refuse("current-native-review-packet-not-authorized");
  return ok({ current: { agentId: current.agentId } });
}


export async function revalidateReviewExecutionAuthority(input: {
  token: RemoteTaskSubmitAuth; parsed: RemoteTaskSubmitParams; userContext: UserContext;
  metadata: unknown; progress: unknown;
}): Promise<boolean> {
  const ref = parseReviewExecutionAuthority(input.progress, input.metadata, input.token.userId);
  if (!ref || ref.tokenId !== input.token.tokenId || !isRecord(input.metadata)
    || matchingRemoteTaskRequestDigest(input.metadata, input.parsed) !== ref.requestDigest) return false;
  if (!recoveryWindowOpen(input.metadata, input.progress)) return false;
  const authorized = await authorizeReviewRecoveryExecution({ ...input, metadata: input.metadata,
    savedScope: input.parsed.authorityScope ?? [] });
  return authorized.ok && resolveCanonicalAgentId(authorized.data.current.agentId) === resolveCanonicalAgentId(ref.actingAgentId);
}

/** Readback supplies a locator only after the owning surface checks room content access. */
export async function issueOriginalReviewRecoveryTarget(input: {
  packet: Record<string, unknown>; userId: string; actingAgentId: string; taskAuthorityKey: string;
  tokenGrantScopes?: readonly string[];
}): Promise<{ kind: "none" } | { kind: "refused"; reason: string;
  originalResult?: import("./mcp-task-original-result").OriginalReviewResult;
  resultRead?: { method: "tasks/result"; params: { taskId: string; requestDigest: string } };
} | {
  kind: "target"; target: import("./mcp-task-submit-params").ReviewTaskRecoveryTarget;
}> {
  const { parseRemoteTaskSubmitParams } = await import("./mcp-task-submit-params");
  const { packet } = input;
  if (typeof packet.requestKey !== "string") return { kind: "none" };
  const rows = await prisma.taskRun.findMany({ where: { userId: input.userId,
    status: { notIn: ["completed", "canceled", "rejected", "archived"] },
    AND: [{ a2aMetadata: { path: ["idempotencyKey"], equals: packet.requestKey } },
      { a2aMetadata: { path: ["tokenSource"], equals: "oauth" } }],
  }, take: 3, orderBy: [{ createdAt: "desc" }], select: {
    taskRunId: true, status: true, updatedAt: true, a2aMetadata: true, progressPayload: true, authorityScope: true,
  } });
  if (!rows.length) return { kind: "none" };
  if (rows.length !== 1) return { kind: "refused", reason: "original-review-ambiguous" };
  const row = rows[0]!;
  const metadata = isRecord(row.a2aMetadata) ? row.a2aMetadata : {};
  const parsed = parseRemoteTaskSubmitParams({ agentId: packet.targetAgent, routeContext: "/build",
    title: packet.questionPacketSummary, objective: packet.objective, prompt: packet.objective,
    idempotencyKey: packet.requestKey, riskClass: "bounded-write", collaborationKind: "handoff",
    authorityScope: row.authorityScope, initiativeReviewBinding: packet.initiativeReviewBinding });
  const wait = parseTerminalWriterWait(row.progressPayload);
  if (typeof parsed === "string" || !parsed.initiativeReviewBinding?.workroomRef
    || typeof metadata.taskAuthorityKey !== "string"
    || !metadata.taskAuthorityKey.startsWith("oauth-family:") || typeof metadata.apiTokenId !== "string"
    || matchingRemoteTaskRequestDigest(metadata, parsed) !== metadata.requestDigest
    || typeof metadata.requestDigest !== "string"
    || deterministicExternalTaskRunId(metadata.taskAuthorityKey, packet.requestKey) !== row.taskRunId) {
    return { kind: "refused", reason: "original-review-not-safely-resumable" };
  }
  const origin = await prisma.mcpApiToken.findUnique({ where: { id: metadata.apiTokenId }, select: { userId: true, agentId: true } });
  if (!origin || origin.userId !== input.userId || !origin.agentId
    || resolveCanonicalAgentId(origin.agentId) !== resolveCanonicalAgentId(input.actingAgentId)) {
    return { kind: "refused", reason: "original-human-or-coworker-mismatch" };
  }
  if (row.status !== "input-required" || !wait || hasExecutionUncertainty(row.progressPayload)
    || recoverTerminalWriterEscalation(row.progressPayload)
    || nextTerminalWriterAttempt(wait) > TERMINAL_WRITER_MAX_ATTEMPTS
    || !recoveryWindowOpen(metadata, row.progressPayload)) {
    const { readOriginalReviewResult } = await import("./mcp-task-original-result");
    const originalResult = await readOriginalReviewResult({
      taskRunId: row.taskRunId, userId: input.userId, actingAgentId: input.actingAgentId,
      tokenGrantScopes: input.tokenGrantScopes,
      expected: { requestDigest: metadata.requestDigest, updatedAt: row.updatedAt.toISOString() },
    });
    return { kind: "refused", reason: "original-review-not-safely-resumable",
      ...(originalResult ? { originalResult } : {}),
      resultRead: { method: "tasks/result", params: { taskId: row.taskRunId, requestDigest: metadata.requestDigest } } };
  }
  if (metadata.taskAuthorityKey === input.taskAuthorityKey) return { kind: "none" };
  return { kind: "target", target: { taskRunId: row.taskRunId, requestDigest: metadata.requestDigest,
    expectedUpdatedAt: row.updatedAt.toISOString() } };
}

function recoveryWindowOpen(metadata: unknown, progress: unknown): boolean {
  for (const value of [metadata, progress]) {
    if (!isRecord(value)) continue;
    for (const key of ["deadlineAt", "expiresAt"]) {
      if (value[key] === undefined || value[key] === null) continue;
      const deadline = typeof value[key] === "string" ? Date.parse(value[key]) : NaN;
      if (!Number.isFinite(deadline) || deadline <= Date.now()) return false;
    }
  }
  return true;
}

/** Only the admitted normalized immutable binding can retain execution authority. */
export function validBoundReviewTaskMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  const binding = parseInitiativeReviewBinding(metadata.initiativeReviewBinding);
  // Persisted admission is already normalized. Dropping unknown fields would
  // reinterpret future authority or artifact formats as the current contract.
  return Boolean(binding && canonicalJson(binding) === canonicalJson(metadata.initiativeReviewBinding));
}

/** Read-only callback admission for every bound review, including legacy sessions.
 * Status/result observation uses its own read authority, never this execution gate. */
export async function reviewRecoveryToolRefusal(input: {
  taskRunId: string; apiTokenId?: string; userId: string; actingAgentId?: string;
  executionFence?: unknown; phase?: "working" | "approval-resume";
}): Promise<import("./mcp-tool-types").ToolResult | null> {
  const denied = (): import("./mcp-tool-types").ToolResult => ({ success: false,
    error: "review_execution_authority_refused",
    message: "The original review's current execution authority no longer permits this call. Reconcile its task; no tool was executed.",
  });
  try {
    const task = await prisma.taskRun.findUnique({ where: { taskRunId: input.taskRunId },
      select: { userId: true, currentAgentId: true, status: true, updatedAt: true, a2aMetadata: true, progressPayload: true } });
    if (!task) return denied();
    if (isBoundReviewTask(task.a2aMetadata)) {
      if (!validBoundReviewTaskMetadata(task.a2aMetadata)
        || task.userId !== input.userId || !task.currentAgentId || !input.actingAgentId
        || resolveCanonicalAgentId(task.currentAgentId) !== resolveCanonicalAgentId(input.actingAgentId)
        || !taskExecutionEligible({ status: task.status, progressPayload: task.progressPayload,
          requestDigest: isRecord(task.a2aMetadata) ? task.a2aMetadata.requestDigest : null,
          executionFence: input.executionFence, phase: input.phase })) return denied();
    }
    if (!isRecord(task.progressPayload) || task.progressPayload.reviewExecutionAuthority === undefined) return null;
    const authority = parseReviewExecutionAuthority(task.progressPayload, task.a2aMetadata, input.userId);
    if (!authority || task.userId !== input.userId || !["working", ...(input.phase === "approval-resume" ? ["input-required"] : [])].includes(task.status)
      || authority.tokenId !== input.apiTokenId || hasExecutionUncertainty(task.progressPayload)) return denied();
    const { loadPersistedRemoteTask, reconstructPersistedRemoteTask } = await import("./mcp-task-persisted-request");
    const stored = await loadPersistedRemoteTask(input.taskRunId);
    const reconstructed = stored ? reconstructPersistedRemoteTask(stored) : null;
    if (!stored || stored.updatedAt.getTime() !== task.updatedAt.getTime() || stored.status !== task.status
      || !reconstructed?.ok || reconstructed.data.token.tokenId !== authority.tokenId
      || !await revalidateReviewExecutionAuthority({ ...reconstructed.data,
        metadata: stored.a2aMetadata, progress: stored.progressPayload })) return denied();
    return null;
  } catch {
    return { success: false, error: "review_execution_authority_unavailable",
      message: "Current task authority could not be verified. No tool was executed; retry only after authority readback is available." };
  }
}
