import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { deterministicExternalTaskRunId, parseResourceWaitProjection } from "./mcp-task-capacity-contract";
import { reconstructPersistedRemoteTask, type PersistedRemoteTask } from "./mcp-task-persisted-request";
import { parseInitiativeReviewBinding, validateInitiativeReviewAuthorityScope, type InitiativeReviewBinding } from "./mcp-task-review-contract";
import { parseTerminalWriterWait } from "./mcp-task-replay-projection";
import { loadInitiativeReviewOutcome } from "./mcp-task-review-outcome";
import { sanitizeNativeCliDiagnostics } from "./shared/execution-uncertainty";
import { isRecord } from "./shared/coerce";
import { expandGrants, getAgentToolGrantsAsync } from "./tak/agent-grants";
import { INITIATIVE_READINESS_LANES } from "./tak/initiative-readiness-tool-grants";
import { readBoundReviewAuthorityTask } from "./backlog/initiative-readiness/bound-review-effect";
import { validInitiativeGateReceipt } from "./backlog/initiative-readiness/receipt-validation";
import { resolveAgentWorkroomAccess } from "./work-management/workroom-agent-access.server";

export const ORIGINAL_REVIEW_RESULT_CHAR_CAP = 8_000;
const MAX_WRITER_OBSERVATIONS = 8;
type Facts = Record<string, string | number | boolean | null>;
type Observation = { source: string; recordedAt: string; digest: string; facts: Facts };
export type OriginalReviewResult = {
  schemaVersion: 1;
  taskRunId: string;
  classification: "receipt-complete" | "proven-not-dispatched" | "proven-settled-without-receipt" | "unknown";
  readOnly: true;
  replayAllowed: false;
  bounded: true;
  reason: string;
  binding?: { requestDigest: string; checkpointUpdatedAt: string; attempt: number | null; dispatchAttempt: number | null; writerAttempt: number | null; writerToolName: string;
    reviewerAgentId: string; itemId: string; gate: string; artifactRef: InitiativeReviewBinding["artifactRef"]; workroomId: string };
  observations: Observation[];
  receipt?: { receiptId: string; gate: string; decision: string };
  missingProof: string[];
};
type ReadInput = { taskRunId: string; userId: string; actingAgentId: string | null; tokenGrantScopes?: readonly string[];
  expected?: { requestDigest: string; updatedAt?: string } };
type Task = PersistedRemoteTask & { createdAt: Date };
type Writer = { id: string; taskRunId: string | null; userId: string; agentId: string; threadId: string; toolName: string;
  success: boolean; executionMode: string; createdAt: Date; result: unknown };
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const iso = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= 300 ? value : null;
const positiveInt = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
const observation = (source: string, recordedAt: string, facts: Facts): Observation => ({ source, recordedAt, digest: hash(facts), facts });
function nativeObservation(value: unknown, source: string, checkpoint: Date): Observation | null {
  if (!isRecord(value)) return null;
  const diagnostics = sanitizeNativeCliDiagnostics(value.diagnostics);
  const recordedObservedAt = iso(value.observedAt);
  const observedAt = recordedObservedAt ?? checkpoint.toISOString();
  if (Date.parse(observedAt) > checkpoint.getTime()) return null;
  return observation(source, observedAt, {
    settlement: "unknown", providerId: text(value.providerId), observedAtMissing: recordedObservedAt === null, ...(diagnostics ? {
      exitCode: diagnostics.exitCode, signal: diagnostics.signal, timedOut: diagnostics.timedOut,
      outerProcessClosed: diagnostics.outerProcessClosed, childProcessClosure: diagnostics.childProcessClosure,
      stdoutPresent: diagnostics.stdoutPresent, stderrPresent: diagnostics.stderrPresent,
      terminalStatus: diagnostics.terminalResult?.status ?? null, terminalSubtype: diagnostics.terminalResult?.subtype ?? null,
    } : {}),
  });
}
function unknown(taskRunId: string, reason: string, missingProof = [reason]): OriginalReviewResult {
  return { schemaVersion: 1, taskRunId, classification: "unknown", readOnly: true, replayAllowed: false, bounded: true, reason, observations: [], missingProof };
}
const taskSelect = {
  id: true, taskRunId: true, userId: true, threadId: true, contextId: true, status: true, routeContext: true, title: true, objective: true,
  currentAgentId: true, authorityScope: true, progressPayload: true, a2aMetadata: true, createdAt: true, updatedAt: true,
  messages: { where: { role: "user" }, orderBy: { createdAt: "asc" as const }, take: 1, select: { parts: true } },
  user: { select: { id: true, isSuperuser: true, isActive: true, automationExpiresAt: true, groups: { include: { platformRole: true } } } },
} as const;
async function loadTask(taskRunId: string) {
  return prisma.taskRun.findUnique({ where: { taskRunId }, select: taskSelect }) as Promise<Task | null>;
}
async function loadWriters(taskRunId: string, writerToolName: string, attemptStart: number): Promise<Writer[]> {
  return prisma.toolExecution.findMany({ where: { taskRunId, toolName: writerToolName,
    ...(Number.isFinite(attemptStart) ? { createdAt: { gte: new Date(attemptStart) } } : {}) }, take: MAX_WRITER_OBSERVATIONS + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, taskRunId: true, userId: true, agentId: true, threadId: true,
      toolName: true, success: true, executionMode: true, createdAt: true, result: true } });
}
function fingerprint(row: Task) {
  return hash({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}
function writersFingerprint(rows: Writer[]) { return hash(rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))); }

/** Read authority is current owner + original acting coworker + exact-room content;
 * the expired origin token is used only to identify the original coworker. */
async function mayRead(input: ReadInput, task: Task, binding: InitiativeReviewBinding): Promise<boolean> {
  if (task.userId !== input.userId || input.actingAgentId === null || !binding.workroomRef) return false;
  const metadata = isRecord(task.a2aMetadata) ? task.a2aMetadata : {};
  if (typeof metadata.apiTokenId !== "string") return false;
  const origin = await prisma.mcpApiToken.findUnique({ where: { id: metadata.apiTokenId }, select: { userId: true, agentId: true } });
  if (!origin || origin.userId !== input.userId || !origin.agentId
    || resolveCanonicalAgentId(origin.agentId) !== resolveCanonicalAgentId(input.actingAgentId)) return false;
  if (!expandGrants(await getAgentToolGrantsAsync(input.actingAgentId)).includes("backlog_read")) return false;
  const room = await prisma.workroom.findUnique({ where: { capsuleId: binding.workroomRef.workroomId }, select: {
    id: true, backlogItemId: true, repositoryFullName: true, headBranch: true, headSha: true,
  } });
  if (!room || room.repositoryFullName !== binding.workroomRef.repositoryFullName
    || room.headBranch !== binding.workroomRef.branchName || room.headSha !== binding.workroomRef.headSha) return false;
  if (room.backlogItemId !== binding.itemId) {
    const item = await prisma.backlogItem.findUnique({ where: { itemId: binding.itemId }, select: { id: true } });
    if (!item || room.backlogItemId !== item.id) return false;
  }
  const requested = { userId: input.userId, workroomId: room.id, requested: "content" as const };
  const access = await resolveAgentWorkroomAccess({ ...requested, agentId: input.actingAgentId });
  return access.decision.level === "content";
}

/** Original observations only. There are no calls to settlement, replay or dispatch. */
export async function readOriginalReviewResult(input: ReadInput): Promise<OriginalReviewResult | null> {
  try {
    const task = await loadTask(input.taskRunId);
    if (!task) return unknown(input.taskRunId, "original-task-unavailable");
    if (!isRecord(task.a2aMetadata) || task.a2aMetadata.initiativeReviewBinding === undefined) return null;
    const metadata = task.a2aMetadata;
    const binding = parseInitiativeReviewBinding(metadata.initiativeReviewBinding);
    const lane = binding ? INITIATIVE_READINESS_LANES[binding.writerToolName] : undefined;
    // Ordinary initiative evidence keeps its existing Tasks/result contract.
    if (binding && lane && !lane.independent && (lane.gates as readonly string[]).includes(binding.gate)) return null;
    if (!binding?.workroomRef) return unknown(input.taskRunId, "original-review-binding-invalid");
    const grants = expandGrants(input.tokenGrantScopes ?? []);
    const itemScopes = grants.filter(scope => scope.startsWith("backlog-item:"));
    if (!grants.includes("backlog_read") || (itemScopes.length && !itemScopes.includes(`backlog-item:${binding.itemId}`))) {
      return unknown(input.taskRunId, "current-read-scope-required");
    }
    if (!await mayRead(input, task, binding)) return unknown(input.taskRunId, "current-original-owner-content-access-required");
    const reconstructed = reconstructPersistedRemoteTask(task);
    const requestDigest = text(metadata.requestDigest);
    if (!reconstructed.ok || !requestDigest || !/^[a-f0-9]{64}$/.test(requestDigest)
      || metadata.trigger !== "external-mcp" || metadata.tokenSource !== "oauth" || metadata.tokenCapability !== "write"
      || typeof metadata.taskAuthorityKey !== "string" || !metadata.taskAuthorityKey.startsWith("oauth-family:")
      || task.taskRunId !== input.taskRunId || typeof metadata.idempotencyKey !== "string"
      || deterministicExternalTaskRunId(metadata.taskAuthorityKey, metadata.idempotencyKey) !== task.taskRunId
      || !lane?.independent || !(lane.gates as readonly string[]).includes(binding.gate)
      || validateInitiativeReviewAuthorityScope(binding, reconstructed.ok ? reconstructed.data.parsed.authorityScope : undefined)
      || task.currentAgentId !== reconstructed.data.parsed.agentId
      || (input.expected && (input.expected.requestDigest !== requestDigest
        || (input.expected.updatedAt !== undefined && input.expected.updatedAt !== task.updatedAt.toISOString())))) {
      return unknown(input.taskRunId, "original-request-or-checkpoint-mismatch");
    }
    const progress = isRecord(task.progressPayload) ? task.progressPayload : {};
    const wait = parseTerminalWriterWait(progress);
    if ((Object.prototype.hasOwnProperty.call(progress, "terminalWriterWait") && !wait)
      || (Object.prototype.hasOwnProperty.call(progress, "dispatch") && !isRecord(progress.dispatch))) {
      return unknown(input.taskRunId, "original-attempt-or-checkpoint-mismatch");
    }
    const dispatch = isRecord(progress.dispatch) ? progress.dispatch : {};
    if ((Object.prototype.hasOwnProperty.call(progress, "resumeReservedAt") && !iso(progress.resumeReservedAt))
      || (Object.prototype.hasOwnProperty.call(dispatch, "claimedAt") && !iso(dispatch.claimedAt))) {
      return unknown(input.taskRunId, "original-attempt-or-checkpoint-mismatch");
    }
    const resolution = isRecord(progress.executionUncertaintyResolution) ? progress.executionUncertaintyResolution : null;
    const prior = resolution && isRecord(resolution.prior) ? resolution.prior : null;
    const priorUncertainty = prior?.executionUncertainty;
    const priorWriterWait = prior ? parseTerminalWriterWait({ terminalWriterWait: prior.terminalWriterWait }) : null;
    if (Object.prototype.hasOwnProperty.call(progress, "executionUncertaintyResolution")
      && (!resolution || resolution.schemaVersion !== 1 || !text(resolution.reviewReceiptId) || !prior
        || canonicalJson(resolution.artifactRef) !== canonicalJson(binding.artifactRef)
        || (priorUncertainty != null && (!isRecord(priorUncertainty) || priorUncertainty.schemaVersion !== 1
          || priorUncertainty.kind !== "execution-uncertain" || priorUncertainty.settlement !== "unknown"))
        || (prior.terminalWriterWait != null && (!priorWriterWait || !iso(priorWriterWait.observedAt)
          || Date.parse(priorWriterWait.observedAt) > task.updatedAt.getTime() || priorWriterWait.writerToolName !== binding.writerToolName)))) {
      return unknown(input.taskRunId, "original-history-binding-mismatch");
    }
    const dispatchAttempt = positiveInt(dispatch.attempt);
    const attempt = wait?.attempt ?? dispatchAttempt;
    const startMarkers = [iso(progress.resumeReservedAt), iso(dispatch.claimedAt)].filter((value): value is string => value !== null);
    const attemptStart = startMarkers.length ? Math.max(...startMarkers.map(Date.parse)) : attempt === 1 ? task.createdAt.getTime() : NaN;
    if ((wait && (wait.writerToolName !== binding.writerToolName || !iso(wait.observedAt) || Date.parse(wait.observedAt) > task.updatedAt.getTime()))
      || (Object.prototype.hasOwnProperty.call(progress, "dispatch") && (dispatch.schemaVersion !== 1 || dispatch.kind !== "external-mcp-task"
        || dispatchAttempt === null || dispatch.eventId !== `mcp-task-run:${task.taskRunId}:execute:${dispatchAttempt}`))
      || (Number.isFinite(attemptStart) && attemptStart > task.updatedAt.getTime())) {
      return unknown(input.taskRunId, "original-attempt-or-checkpoint-mismatch");
    }
    const result = unknown(input.taskRunId, "original-execution-proof-incomplete", ["authoritative-native-dispatch", "authoritative-child-closure", "no-unresolved-or-late-effects"]);
    result.binding = { requestDigest, checkpointUpdatedAt: task.updatedAt.toISOString(), attempt, dispatchAttempt, writerAttempt: wait?.attempt ?? null, writerToolName: binding.writerToolName,
      reviewerAgentId: reconstructed.data.parsed.agentId, itemId: binding.itemId, gate: binding.gate,
      artifactRef: binding.artifactRef, workroomId: binding.workroomRef.workroomId };
    if (attempt === null || !Number.isFinite(attemptStart)) result.missingProof.push("original-attempt-checkpoint");
    if (text(dispatch.eventId) && dispatch.schemaVersion === 1 && dispatch.kind === "external-mcp-task") {
      result.observations.push(observation("TaskRun.progressPayload.dispatch", iso(dispatch.claimedAt) ?? task.updatedAt.toISOString(), {
        eventId: String(dispatch.eventId), attempt: dispatchAttempt, state: text(dispatch.state),
      }));
    }
    const currentNative = nativeObservation(progress.executionUncertainty, "TaskRun.progressPayload.executionUncertainty", task.updatedAt);
    if (currentNative) result.observations.push(currentNative);
    const priorNative = nativeObservation(prior?.executionUncertainty, "TaskRun.progressPayload.executionUncertaintyResolution.prior.executionUncertainty", task.updatedAt);
    if (priorNative) result.observations.push(priorNative);
    if (priorWriterWait) {
      result.observations.push(observation("TaskRun.progressPayload.executionUncertaintyResolution.prior.terminalWriterWait",
        iso(priorWriterWait.observedAt) ?? task.updatedAt.toISOString(), { writerToolName: priorWriterWait.writerToolName, writerAttempt: priorWriterWait.attempt,
          dispatchContract: priorWriterWait.dispatchContract ?? null, historical: true }));
    }
    const capacity = parseResourceWaitProjection(progress);
    if (capacity && iso(capacity.observedAt) && Date.parse(capacity.observedAt) <= task.updatedAt.getTime()) {
      result.observations.push(observation("TaskRun.progressPayload.resourceWait", new Date(capacity.observedAt).toISOString(), {
        kind: capacity.kind, failureKind: capacity.failureKind, attempt: capacity.attempt, resumeMode: capacity.resumeMode,
      }));
    }
    const writers = await loadWriters(task.taskRunId, binding.writerToolName, attemptStart);
    if (writers.length > MAX_WRITER_OBSERVATIONS) return unknown(input.taskRunId, "original-result-over-budget");
    const receipts: Array<NonNullable<OriginalReviewResult["receipt"]>> = [];
    for (const writer of writers) {
      if (writer.taskRunId !== task.taskRunId || writer.userId !== input.userId || writer.threadId !== task.threadId
        || writer.agentId !== reconstructed.data.parsed.agentId || writer.toolName !== binding.writerToolName
        || !Number.isFinite(attemptStart) || writer.createdAt.getTime() < attemptStart || writer.createdAt.getTime() > task.updatedAt.getTime()) {
        result.missingProof.push("writer-attempt-binding-mismatch"); continue;
      }
      result.observations.push(observation("ToolExecution", writer.createdAt.toISOString(), {
        id: writer.id, writerToolName: writer.toolName, executionMode: writer.executionMode, success: writer.success,
      }));
      const stored = isRecord(writer.result) ? writer.result : {};
      const data = isRecord(stored.data) ? stored.data : {};
      const receiptId = text(data.receiptId);
      if (!writer.success || stored.success !== true || !receiptId) continue;
      const activity = await prisma.backlogItemActivity.findUnique({ where: { id: receiptId }, select: { id: true, payload: true, recordedAt: true } });
      const payload = isRecord(activity?.payload) ? activity.payload : {};
      const outcome = await loadInitiativeReviewOutcome(binding, receiptId);
      const validReceipt = validInitiativeGateReceipt(payload, { receiptId, gate: binding.gate, subject: { kind: "backlog-item", id: binding.itemId } });
      const authorityTask = validReceipt && typeof payload.authorityDecisionId === "string" && isRecord(payload.authoritySnapshot)
        ? await readBoundReviewAuthorityTask(prisma, payload.authorityDecisionId, { actionKey: binding.writerToolName }, undefined, payload.authoritySnapshot) : null;
      if (!activity || !outcome || !validReceipt || authorityTask !== task.taskRunId || payload.reviewerAgentId !== reconstructed.data.parsed.agentId
        || activity.recordedAt.getTime() < attemptStart || activity.recordedAt.getTime() > task.updatedAt.getTime()) {
        result.missingProof.push("canonical-receipt-binding-mismatch"); continue;
      }
      result.observations.push(observation("BacklogItemActivity.initiative_gate_receipt", activity.recordedAt.toISOString(), {
        receiptId, gate: outcome.gate, decision: outcome.decision, writerExecutionId: writer.id,
        authorityDecisionId: String(payload.authorityDecisionId), authorityTaskRunId: authorityTask,
      }));
      receipts.push({ receiptId, gate: outcome.gate, decision: outcome.decision });
    }
    // Audit rows can arrive without updating the TaskRun. Fence both sources,
    // then recheck current read authority before returning protected evidence.
    const [latest, latestWriters] = await Promise.all([loadTask(task.taskRunId), loadWriters(task.taskRunId, binding.writerToolName, attemptStart)]);
    if (!latest || fingerprint(latest) !== fingerprint(task) || writersFingerprint(latestWriters) !== writersFingerprint(writers)) {
      return unknown(input.taskRunId, "original-snapshot-changed");
    }
    if (!await mayRead(input, latest, binding)) return unknown(input.taskRunId, "current-original-owner-content-access-required");
    const uniqueReceipts = new Map(receipts.map(value => [value.receiptId, value]));
    if (resolution && (uniqueReceipts.size !== 1 || !uniqueReceipts.has(String(resolution.reviewReceiptId)))) {
      result.missingProof.push("historical-receipt-binding-mismatch");
    }
    if (uniqueReceipts.size === 1 && !result.missingProof.some(value => value.endsWith("binding-mismatch"))) {
      result.classification = "receipt-complete"; result.receipt = [...uniqueReceipts.values()][0]!;
      result.reason = "Matching original writer receipt recorded; other effects and replay remain unproved.";
      result.missingProof = [];
    }
    // No current persisted native source proves an entire original attempt was
    // never dispatched, or that every child/effect settled. Queue status,
    // printable claims and outer-process close cannot produce those verdicts.
    if (JSON.stringify(result).length > ORIGINAL_REVIEW_RESULT_CHAR_CAP) return unknown(input.taskRunId, "original-result-over-budget");
    return result;
  } catch {
    return unknown(input.taskRunId, "original-result-read-unavailable");
  }
}
