import { projectRecordedTaskState } from "@/lib/tak/task-states";
import { isRecord } from "@/lib/shared/coerce";
import { SEMANTIC_REVIEW_HEARTBEAT_STALE_MS } from "@/lib/change-review/semantic-review-request";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkCaseSourceRef } from "./case-types";
import { isSemanticReviewRecoveryWait, readSemanticReviewBudget, type SemanticReviewBudgetSnapshot } from "@/lib/change-review/semantic-review-recovery-policy";

/** Read-only facts from existing tasks; neither a verdict nor a new execution ledger. */
export type ReviewerExecutionObservation = {
  taskRunId: string; recordId: string; status: string; requesterId: string | null;
  reason: string | null; nextAction: string; readAt: string; lastHeartbeatAt: string | null;
  heartbeat: "historical" | "unknown" | "stale" | "recent";
  recoveryWait: boolean; budget: SemanticReviewBudgetSnapshot;
  checkpoints: Array<{ taskNodeId: string; recordId: string; title: string; status: string; actorId: string | null }>;
};

export type ReviewerRunSnapshot = {
  id: string; taskRunId: string; userId: string | null; status: string;
  updatedAt: Date; lastHeartbeatAt: Date | null; progressPayload: unknown;
  nodes?: Array<{ id: string; taskNodeId: string; title: string; status: string; updatedAt: Date; requestContract?: unknown }>;
};
export type ReviewerRoomClient = { taskRun?: { findMany(args: unknown): Promise<ReviewerRunSnapshot[]> } };

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
      lastHeartbeatAt: true, progressPayload: true,
      nodes: { select: { id: true, taskNodeId: true, title: true, status: true, updatedAt: true, requestContract: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 13 } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 21,
  }).catch(() => null);
  if (!rows) return { runs, receipts, sourceRefs, partial: true, attentionReason: "Reviewer execution could not be read. Recheck its evidence before advancing." };
  partial = rows.length > 20 || rows.some((row) => !row.nodes || row.nodes.length > 12);
  for (const row of rows.slice(0, 20)) {
    const state = projectRecordedTaskState(row.status);
    const payload = isRecord(row.progressPayload) ? row.progressPayload : {};
    const progress = isRecord(payload.semanticReview) ? payload.semanticReview : {};
    const reason = typeof progress.reason === "string" ? `Last recorded reason: ${progress.reason}` : "No reason recorded";
    const next = state === "terminal" ? "Inspect the completion receipt; task status alone does not verify the Workroom outcome."
      : state === "waiting" ? "The requester must inspect the wait and current recovery authority."
        : state === "unknown" ? "Reconcile the unknown task state before acting."
          : "The server owns continuation; await its next recorded result.";
    const heartbeat = row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : "unknown";
    const age = row.lastHeartbeatAt ? now.getTime() - row.lastHeartbeatAt.getTime() : null;
    const freshness = state === "terminal" ? "historical" : age === null || age < 0 ? "unknown" : age >= SEMANTIC_REVIEW_HEARTBEAT_STALE_MS ? "stale" : "recent";
    runs.push({ taskRunId: row.taskRunId, recordId: row.id, status: row.status, requesterId: row.userId,
      reason: typeof progress.reason === "string" ? progress.reason : null,
      nextAction: typeof progress.action === "string" ? progress.action : next,
      readAt: now.toISOString(), lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
      heartbeat: freshness, recoveryWait: isSemanticReviewRecoveryWait(row.status),
      budget: readSemanticReviewBudget(row.progressPayload),
      checkpoints: (row.nodes ?? []).slice(0, 12).map(node => ({ taskNodeId: node.taskNodeId,
        recordId: node.id, title: node.title, status: node.status,
        actorId: isRecord(node.requestContract) && typeof node.requestContract.agentId === "string" ? node.requestContract.agentId : null })),
    });
    const ref: WorkCaseSourceRef = { kind: "task-run", id: row.taskRunId, status: row.status, sourceType: "task-run" };
    sourceRefs.push(ref);
    if (!attentionReason && (state === "waiting" || state === "unknown" || row.status === "failed")) {
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
