import { projectRecordedTaskState } from "@/lib/tak/task-states";
import type { PrismaClient } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { SEMANTIC_REVIEW_HEARTBEAT_STALE_MS } from "@/lib/change-review/semantic-review-request";
import { projectRemoteTaskReplay } from "@/lib/mcp-task-replay-projection";
import { hasExecutionUncertainty } from "@/lib/shared/execution-uncertainty";
import { loadReviewRoomCandidates } from "./review-room-candidates";
import { loadRequestIdentities, initiativeRoomIdentity, type RequestIdentity } from "./review-room-request-identity";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkCaseSourceRef } from "./case-types";
import { isSemanticReviewRecoveryWait, semanticReviewRecoveryObservation, readSemanticReviewBudget, type SemanticReviewBudgetSnapshot } from "@/lib/change-review/semantic-review-recovery-policy";

/** Read-only facts from existing tasks; neither a verdict nor a new execution ledger. */
export type ReviewerExecutionObservation = {
  reviewKind?: "semantic-review" | "initiative-review";
  reviewGate?: string | null; requestDigest?: string | null; artifactVersion?: string | null;
  executionUncertain?: boolean; identityConflict?: boolean;
  capsuleId?: string | null;
  requesterAgentId?: string | null;
  taskRunId: string; recordId: string; status: string; requesterId: string | null; requesterName?: string | null;
  reason: string | null; nextAction: string; readAt: string; lastHeartbeatAt: string | null;
  heartbeat: "historical" | "unknown" | "stale" | "recent";
  recoveryWait: boolean; budget: SemanticReviewBudgetSnapshot;
  identityScope?: "current" | "historical" | "unknown";
  sourceHeadSha?: string | null;
  receipt?: { id: string; decision: "pass" | "fail" | "inconclusive"; summary: string };
  checkpoints: Array<{ taskNodeId: string; recordId: string; title: string; status: string; actorId: string | null }>;
};

export type ReviewerRunSnapshot = {
  id: string; taskRunId: string; userId: string | null; status: string;
  user?: { employeeProfile: { displayName: string } | null } | null;
  updatedAt: Date; lastHeartbeatAt: Date | null; progressPayload: unknown;
  nodes?: Array<{ id: string; taskNodeId: string; title: string; status: string; updatedAt: Date; requestContract?: unknown }>;
};
export type ReviewerRoomClient = { taskRun?: { findMany(args: unknown): Promise<ReviewerRunSnapshot[]> } }
  & Partial<Pick<PrismaClient, "$queryRaw">>;

/** Read-model snapshots of existing records, never new completion receipts or a task ledger. */
export async function loadSemanticReviewRoomProjection(db: ReviewerRoomClient, capsuleIds: string[], now: Date) {
  const receipts: ReceiptEnvelope[] = [];
  const runs: ReviewerExecutionObservation[] = [];
  const sourceRefs: WorkCaseSourceRef[] = [];
  let attentionReason: string | null = null;
  const candidates = await loadReviewRoomCandidates(db, capsuleIds);
  const partialRooms = new Set(candidates.partialCapsuleIds);
  const rows = candidates.rows;
  if (!rows.length && candidates.partial) attentionReason = "Reviewer execution could not be read completely. Recheck its evidence before advancing.";
  const identities = await loadRequestIdentities(db, rows.filter(row => row.reviewKind === "semantic-review"));
  const ordinaryIdentities = new Map(rows.filter(row => row.reviewKind === "initiative-review")
    .map(row => [row.id, initiativeRoomIdentity(row, now)]));
  const ordinaryGates = new Map<string, number>();
  for (const identity of ordinaryIdentities.values()) {
    if (!identity.requestBound || identity.sourceHeadSha?.toLowerCase() !== identity.currentHeadSha?.toLowerCase()) continue;
    const key = `${identity.capsuleId}:${identity.reviewGate}`;
    ordinaryGates.set(key, (ordinaryGates.get(key) ?? 0) + 1);
  }
  const validIdentity = (identity: RequestIdentity) => identity.requestBound
    && /^[a-f0-9]{40}$/i.test(identity.sourceHeadSha ?? "")
    && /^[a-f0-9]{40}$/i.test(identity.currentHeadSha ?? "")
    && Number.isFinite(Date.parse(identity.issuedAt ?? "")) && Date.parse(identity.issuedAt!) <= now.getTime();
  const latest = new Map<string, RequestIdentity>();
  for (const identity of identities.filter(validIdentity)) {
    if (identity.sourceHeadSha!.toLowerCase() !== identity.currentHeadSha!.toLowerCase()) continue;
    const previous = latest.get(identity.capsuleId);
    if (!previous || Date.parse(identity.issuedAt!) > Date.parse(previous.issuedAt!)
      || (identity.issuedAt === previous.issuedAt && identity.rowId > previous.rowId)) latest.set(identity.capsuleId, identity);
  }
  for (const row of rows) {
    const ordinary = row.reviewKind === "initiative-review";
    const ordinaryIdentity = ordinaryIdentities.get(row.id);
    const identity: RequestIdentity | undefined = ordinary ? ordinaryIdentity : identities.find(identity => identity.rowId === row.id);
    const qualified = !!identity && validIdentity(identity) && identity.capsuleId === row.capsuleId && !row.ambiguousReviewKind;
    const identityScope = !qualified ? "unknown" : ordinary
      ? identity!.sourceHeadSha!.toLowerCase() === identity!.currentHeadSha!.toLowerCase() ? "current" : "historical"
      : latest.get(identity!.capsuleId)?.rowId === row.id ? "current" : "historical";
    const identityConflict = ordinary && qualified && identityScope === "current"
      && (ordinaryGates.get(`${row.capsuleId}:${ordinaryIdentity?.reviewGate}`) ?? 0) > 1;
    if (identityScope === "unknown") partialRooms.add(row.capsuleId);
    if (identityConflict) attentionReason ??= "Competing original reviews for the same gate require reconciliation.";
    if (!ordinary && qualified && !latest.has(identity!.capsuleId)) {
      attentionReason ??= "No request for the current source version is in the displayed review history.";
    }
    const state = projectRecordedTaskState(row.status);
    const payload = isRecord(row.progressPayload) ? row.progressPayload : {};
    const progress = isRecord(payload.semanticReview) ? payload.semanticReview : {};
    const recovery = semanticReviewRecoveryObservation(row.status, row.progressPayload, now.getTime());
    const wait = ordinary && (state === "waiting" || state === "unknown")
      ? projectRemoteTaskReplay({ existing: { taskRunId: row.taskRunId, status: row.status,
        progressPayload: row.progressPayload, a2aMetadata: null }, requestMatches: true }).result.waitReason : null;
    // Reuse canonical wait classification, never its content or generic resume hints.
    const recordedReason = ordinary ? typeof wait === "string" ? wait : null
      : row.status === "working" || row.status === "submitted" ? null
        : recovery.capacityRecovery?.reason ?? (typeof progress.reason === "string" ? progress.reason : null);
    const reason = recordedReason ? `Last recorded reason: ${recordedReason}` : "No reason recorded";
    const next = state === "terminal" ? "Inspect the completion receipt; task status alone does not verify the Workroom outcome."
      : state === "waiting" ? "The requester must inspect the wait and current recovery authority."
        : state === "unknown" ? "Reconcile the unknown task state before acting."
          : "The server owns continuation; await its next recorded result.";
    const recoveryAction = recovery.successorTaskRunId ? `Read successor review ${recovery.successorTaskRunId}.`
      : recovery.capacityRecovery || (isSemanticReviewRecoveryWait(row.status) && recovery.budget === "expired") ? recovery.nextAction : null;
    const heartbeat = row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : "unknown";
    const age = row.lastHeartbeatAt ? now.getTime() - row.lastHeartbeatAt.getTime() : null;
    const freshness = state === "terminal" ? "historical" : age === null || age < 0 ? "unknown" : age >= SEMANTIC_REVIEW_HEARTBEAT_STALE_MS ? "stale" : "recent";
    runs.push({ capsuleId: row.capsuleId,
      reviewKind: row.reviewKind, reviewGate: ordinaryIdentity?.reviewGate ?? null,
      artifactVersion: ordinaryIdentity?.artifactVersion ?? null,
      requestDigest: ordinary ? ordinaryIdentity?.requestDigest ?? null : qualified && typeof progress.requestDigest === "string" ? progress.requestDigest : null,
      executionUncertain: hasExecutionUncertainty(row.progressPayload), identityConflict,
      requesterAgentId: qualified ? identity!.requesterAgentId ?? null : null,
      taskRunId: row.taskRunId, recordId: row.id, status: row.status, requesterId: row.userId,
      requesterName: row.user?.employeeProfile?.displayName.trim() || null,
      identityScope, sourceHeadSha: qualified ? identity!.sourceHeadSha : null,
      ...(!ordinary && qualified && identity?.receiptId
        && (identity.receiptDecision === "pass" || identity.receiptDecision === "fail" || identity.receiptDecision === "inconclusive")
        ? { receipt: { id: identity.receiptId, decision: identity.receiptDecision,
          summary: identity.receiptSummary ?? "No receipt summary recorded." } } : {}),
      reason: recordedReason,
      nextAction: ordinary ? "Inspect this original review result with its bound request digest; status alone is not a verdict." : recoveryAction ?? (row.status === "working" || row.status === "submitted" ? next : typeof progress.action === "string" ? progress.action
        : typeof progress.nextAction === "string" ? progress.nextAction : next),
      readAt: now.toISOString(), lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
      heartbeat: freshness, recoveryWait: !ordinary && recovery.manualRecoveryWait,
      budget: readSemanticReviewBudget(ordinary ? null : row.progressPayload),
      checkpoints: (row.nodes ?? []).slice(0, 12).map(node => ({ taskNodeId: node.taskNodeId,
        recordId: node.id, title: node.title, status: node.status,
        actorId: isRecord(node.requestContract) && typeof node.requestContract.agentId === "string" ? node.requestContract.agentId : null })),
    });
    const ref: WorkCaseSourceRef = { kind: "task-run", id: row.taskRunId, status: row.status, sourceType: "task-run" };
    sourceRefs.push(ref);
    const recordedReceipt = runs[runs.length - 1]!.receipt;
    if (recordedReceipt && identity?.receiptCreatedAt) {
      const receiptRef: WorkCaseSourceRef = { kind: "evidence", id: recordedReceipt.id, sourceType: "external-evidence", status: recordedReceipt.decision };
      sourceRefs.push(receiptRef);
      receipts.push({ receiptId: recordedReceipt.id, receiptKind: "semantic-review-receipt", enforcementMode: "observed-event",
        sourceRef: receiptRef, status: "observed", summary: `Recorded review ${recordedReceipt.decision}: ${recordedReceipt.summary}`,
        occurredAt: identity.receiptCreatedAt.toISOString(), policyRefs: [],
        rawRef: { table: "ExternalEvidenceRecord", id: recordedReceipt.id } });
    }
    if (!attentionReason && identityScope !== "historical" && (state === "waiting" || state === "unknown" || row.status === "failed")) {
      attentionReason = `Reviewer ${row.taskRunId}: ${state === "unknown" ? "unknown state" : row.status}. ${reason}`;
    }
    receipts.push({ receiptId: `task-run-snapshot:${row.taskRunId}`, receiptKind: "reviewer-state-snapshot",
      enforcementMode: "observed-event", sourceRef: ref, status: "observed",
      summary: `Reviewer ${row.taskRunId}: recorded ${state} (${row.status}). ${reason}. ${next} Heartbeat ${freshness}: ${heartbeat}; read at ${now.toISOString()}.`,
      occurredAt: row.updatedAt.toISOString(), ...(row.userId ? { actorRef: { actorKind: "person" as const, actorId: row.userId } } : {}),
      ...(runs[runs.length - 1]!.requestDigest ? { inputDigest: runs[runs.length - 1]!.requestDigest! } : {}),
      policyRefs: [], rawRef: { table: "TaskRun", id: row.id } });
    for (const node of (row.nodes ?? []).slice(0, 12)) {
      const contract: Record<string, unknown> = isRecord(node.requestContract) ? node.requestContract : {};
      receipts.push({
      receiptId: `task-node-snapshot:${node.taskNodeId}`, receiptKind: "reviewer-checkpoint-snapshot",
      enforcementMode: "observed-event", sourceRef: { kind: "evidence", id: node.taskNodeId, sourceType: "task-node", status: node.status },
      status: "observed", summary: `${node.title}: recorded ${node.status}; part of ${row.taskRunId}. Checkpoint status does not authorize a Workroom transition.`,
      occurredAt: node.updatedAt.toISOString(), policyRefs: [], rawRef: { table: "TaskNode", id: node.id },
      ...(typeof contract.agentId === "string" ? { actorRef: { actorKind: "agent" as const, actorId: contract.agentId } } : {}),
    });
    }
  }
  return { runs, receipts, sourceRefs, attentionReason, partial: partialRooms.size > 0, partialCapsuleIds: [...partialRooms] };
}
