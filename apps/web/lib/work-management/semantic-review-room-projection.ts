import { projectRecordedTaskState } from "@/lib/tak/task-states";
import type { PrismaClient } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { SEMANTIC_REVIEW_HEARTBEAT_STALE_MS } from "@/lib/change-review/semantic-review-request";
import { CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION } from "@/lib/change-review/semantic-change-review";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkCaseSourceRef } from "./case-types";
import { isSemanticReviewRecoveryWait, readSemanticReviewBudget, type SemanticReviewBudgetSnapshot } from "@/lib/change-review/semantic-review-recovery-policy";

/** Read-only facts from existing tasks; neither a verdict nor a new execution ledger. */
export type ReviewerExecutionObservation = {
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

type RequestIdentity = {
  rowId: string; capsuleId: string; sourceHeadSha: string | null; currentHeadSha: string | null;
  issuedAt: string | null; requestBound: boolean;
  receiptId?: string | null; receiptDecision?: string | null; receiptSummary?: string | null;
  receiptCreatedAt?: Date | null;
};

/** Project small identity fields, never the potentially multi-megabyte review prompt. */
async function loadRequestIdentities(db: ReviewerRoomClient, rows: ReviewerRunSnapshot[]): Promise<RequestIdentity[]> {
  if (!rows.length || !db.$queryRaw) return [];
  return db.$queryRaw<RequestIdentity[]>`
    SELECT t.id AS "rowId", w."capsuleId", w."headSha" AS "currentHeadSha",
      e.id AS "receiptId", e.details #>> '{result,decision}' AS "receiptDecision",
      e."createdAt" AS "receiptCreatedAt",
      LEFT(e.details #>> '{result,summary}', 1200) AS "receiptSummary",
      a.parts #>> '{0,data,input,identity,sourceHeadSha}' AS "sourceHeadSha",
      a.parts #>> '{0,data,issuedAt}' AS "issuedAt",
      COALESCE(a.parts #>> '{0,data,schemaVersion}' = '1'
        AND a.parts #>> '{0,data,actor,userId}' = t."userId"
        AND lower(a.parts #>> '{0,data,repository}') = lower(w."repositoryFullName")
        AND a.parts #>> '{0,data,input,identity,capsuleId}' = w."capsuleId"
        AND a.parts #>> '{0,data,gateKey}' = t."a2aMetadata"->>'gateKey'
        AND a.parts #>> '{0,data,digest}' = t."progressPayload" #>> '{semanticReview,requestDigest}', false) AS "requestBound"
    FROM "TaskRun" t
    LEFT JOIN "WorkCapsule" w ON w."capsuleId" = t."a2aMetadata"->>'capsuleId'
    LEFT JOIN "TaskArtifact" a ON a."taskRunId" = t.id
      AND a."artifactId" = 'semantic-review-request:' || t."taskRunId"
    LEFT JOIN "ExternalEvidenceRecord" e ON e.id = t."progressPayload"->>'evidenceRecordId'
      AND e."taskRunId" = t."taskRunId" AND e."workCapsuleId" = w.id AND e."actorUserId" = t."userId"
      AND e."operationType" = 'semantic-change-review.receipt'
      AND e.details->>'schemaVersion' = ${CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION}
      AND e.details->>'sourceHeadSha' = a.parts #>> '{0,data,input,identity,sourceHeadSha}'
      AND e.details->>'headTreeHash' = a.parts #>> '{0,data,input,identity,headTreeHash}'
      AND e.details->>'diffDigest' = a.parts #>> '{0,data,input,identity,diffDigest}'
      AND e.details->>'policyVersion' = a.parts #>> '{0,data,input,identity,policyVersion}'
      AND e.details->>'reviewerVersion' = a.parts #>> '{0,data,input,identity,reviewerVersion}'
    WHERE t.id = ANY(${rows.map(row => row.id)}::text[])
  `.catch(() => []);
}

/** Read-model snapshots of existing records, never new completion receipts or a task ledger. */
export async function loadSemanticReviewRoomProjection(db: ReviewerRoomClient, capsuleIds: string[], now: Date) {
  const receipts: ReceiptEnvelope[] = [];
  const runs: ReviewerExecutionObservation[] = [];
  const sourceRefs: WorkCaseSourceRef[] = [];
  let attentionReason: string | null = null;
  let partial = false;
  if (!capsuleIds.length) return { runs, receipts, sourceRefs, attentionReason, partial };
  if (!db.taskRun) return { runs, receipts, sourceRefs, attentionReason, partial: true };
  const rows = await db.taskRun.findMany({
    where: { archivedAt: null, AND: [
      { a2aMetadata: { path: ["gateKind"], equals: "semantic-review" } },
      { OR: [...new Set(capsuleIds)].map((capsuleId) => ({ a2aMetadata: { path: ["capsuleId"], equals: capsuleId } })) },
    ] },
    select: { id: true, taskRunId: true, userId: true, status: true, updatedAt: true,
      user: { select: { employeeProfile: { select: { displayName: true } } } },
      lastHeartbeatAt: true, progressPayload: true,
      nodes: { select: { id: true, taskNodeId: true, title: true, status: true, updatedAt: true, requestContract: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 13 } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
  }).catch(() => null);
  if (!rows) return { runs, receipts, sourceRefs, partial: true, attentionReason: "Reviewer execution could not be read. Recheck its evidence before advancing." };
  partial = rows.length > 20 || rows.some((row) => !row.nodes || row.nodes.length > 12);
  const identities = await loadRequestIdentities(db, rows.slice(0, 20));
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
  for (const row of rows.slice(0, 20)) {
    const identity = identities.find(identity => identity.rowId === row.id);
    const identityScope = !identity || !validIdentity(identity) ? "unknown"
      : latest.get(identity.capsuleId)?.rowId === row.id ? "current" : "historical";
    if (identityScope === "unknown") partial = true;
    if (identity && validIdentity(identity) && !latest.has(identity.capsuleId)) {
      partial = true;
      attentionReason ??= "No request for the current source version is in the displayed review history.";
    }
    const state = projectRecordedTaskState(row.status);
    const payload = isRecord(row.progressPayload) ? row.progressPayload : {};
    const progress = isRecord(payload.semanticReview) ? payload.semanticReview : {};
    const recordedReason = row.status === "working" || row.status === "submitted" ? null
      : typeof progress.reason === "string" ? progress.reason : null;
    const reason = recordedReason ? `Last recorded reason: ${recordedReason}` : "No reason recorded";
    const next = state === "terminal" ? "Inspect the completion receipt; task status alone does not verify the Workroom outcome."
      : state === "waiting" ? "The requester must inspect the wait and current recovery authority."
        : state === "unknown" ? "Reconcile the unknown task state before acting."
          : "The server owns continuation; await its next recorded result.";
    const heartbeat = row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : "unknown";
    const age = row.lastHeartbeatAt ? now.getTime() - row.lastHeartbeatAt.getTime() : null;
    const freshness = state === "terminal" ? "historical" : age === null || age < 0 ? "unknown" : age >= SEMANTIC_REVIEW_HEARTBEAT_STALE_MS ? "stale" : "recent";
    runs.push({ taskRunId: row.taskRunId, recordId: row.id, status: row.status, requesterId: row.userId,
      requesterName: row.user?.employeeProfile?.displayName.trim() || null,
      identityScope, sourceHeadSha: identity?.requestBound ? identity.sourceHeadSha : null,
      ...(identity?.requestBound && identity.receiptId
        && (identity.receiptDecision === "pass" || identity.receiptDecision === "fail" || identity.receiptDecision === "inconclusive")
        ? { receipt: { id: identity.receiptId, decision: identity.receiptDecision,
          summary: identity.receiptSummary ?? "No receipt summary recorded." } } : {}),
      reason: recordedReason,
      nextAction: row.status === "working" || row.status === "submitted" ? next : typeof progress.action === "string" ? progress.action
        : typeof progress.nextAction === "string" ? progress.nextAction : next,
      readAt: now.toISOString(), lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
      heartbeat: freshness, recoveryWait: isSemanticReviewRecoveryWait(row.status),
      budget: readSemanticReviewBudget(row.progressPayload),
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
      ...(typeof progress.requestDigest === "string" ? { inputDigest: progress.requestDigest } : {}),
      policyRefs: [], rawRef: { table: "TaskRun", id: row.id } });
    for (const node of (row.nodes ?? []).slice(0, 12)) {
      const contract = isRecord(node.requestContract) ? node.requestContract : {};
      receipts.push({
      receiptId: `task-node-snapshot:${node.taskNodeId}`, receiptKind: "reviewer-checkpoint-snapshot",
      enforcementMode: "observed-event", sourceRef: { kind: "evidence", id: node.taskNodeId, sourceType: "task-node", status: node.status },
      status: "observed", summary: `${node.title}: recorded ${node.status}; part of ${row.taskRunId}. Checkpoint status does not authorize a Workroom transition.`,
      occurredAt: node.updatedAt.toISOString(), policyRefs: [], rawRef: { table: "TaskNode", id: node.id },
      ...(typeof contract.agentId === "string" ? { actorRef: { actorKind: "agent" as const, actorId: contract.agentId } } : {}),
    });
    }
  }
  return { runs, receipts, sourceRefs, attentionReason, partial };
}
