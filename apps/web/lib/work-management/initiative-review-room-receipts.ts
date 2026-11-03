import type { PrismaClient } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@/lib/shared/coerce";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { ARTIFACT_IDENTITY_KEYS, receiptArtifactMatches } from "@/lib/mcp-task-review-receipt";
import { validInitiativeGateReceipt } from "@/lib/backlog/initiative-readiness/receipt-validation";
import { readBoundReviewAuthorityTask } from "@/lib/backlog/initiative-readiness/bound-review-effect";
import { initiativeRoomIdentity } from "./review-room-request-identity";
import type { ReviewerRoomCandidate } from "./review-room-candidates";

export type InitiativeReceiptClient = Partial<Pick<PrismaClient, "$queryRaw">>;
export type InitiativeReceiptObservation = {
  id: string; decision: "pass" | "fail" | "not-applicable"; summary: string; recordedAt: Date;
};
type ReceiptRow = { rowId: string; receiptId: string; itemRowId: string; backlogItemId: string;
  organizationId: string | null; gateKey: string; payload: unknown; recordedAt: Date; payloadTruncated: boolean; authority: unknown; envelopeTaskIds: string[] };
const MAX_REQUESTS = 100;
const MAX_REQUEST_BYTES = 262144;
const PER_TASK_RECEIPTS = 20;

/** Summary-only read of existing domain effects, never task reconciliation or replay.
 * The immutable task binding is rechecked in SQL; the canonical writer's authority
 * link supplies provenance even when its ToolExecution acknowledgement was lost. */
export async function loadInitiativeReviewRoomReceipts(db: InitiativeReceiptClient,
  rows: ReviewerRoomCandidate[], now: Date) {
  const receipts = new Map<string, InitiativeReceiptObservation>();
  const partialRooms = new Set<string>();
  const selected = rows.filter(row => row.reviewKind === "initiative-review"
    && initiativeRoomIdentity(row, now).requestBound);
  if (!selected.length) return { receipts, partialRooms };
  if (!db.$queryRaw) {
    for (const row of selected) partialRooms.add(row.capsuleId);
    return { receipts, partialRooms };
  }
  const requests: Array<{ rowId: string; taskRunId: string; userId: string; requestDigest: string;
    itemId: string; gate: string; binding: NonNullable<ReturnType<typeof parseInitiativeReviewBinding>>;
    artifact: Record<string, unknown> }> = [];
  for (const row of selected) {
    const binding = parseInitiativeReviewBinding(row.initiativeBinding);
    if (!binding || canonicalJson(binding) !== canonicalJson(row.initiativeBinding)) {
      partialRooms.add(row.capsuleId); continue;
    }
    const fields = binding.artifactRef as Record<string, unknown>;
    const artifact = Object.fromEntries(ARTIFACT_IDENTITY_KEYS[binding.artifactRef.kind].map(key => [key, fields[key]]));
    const request = { rowId: row.id, taskRunId: row.taskRunId, userId: row.userId!,
      requestDigest: row.requestDigest!, itemId: binding.itemId, gate: binding.gate, binding, artifact };
    if (requests.length >= MAX_REQUESTS || Buffer.byteLength(JSON.stringify([...requests, request]), "utf8") > MAX_REQUEST_BYTES) {
      partialRooms.add(row.capsuleId); continue;
    }
    requests.push(request);
  }
  if (!requests.length) return { receipts, partialRooms };
  try {
    const found = await db.$queryRaw<ReceiptRow[]>`
      SELECT request."rowId", activity.id AS "receiptId", item.id AS "itemRowId",
        activity."backlogItemId", item."organizationId", activity."gateKey"::text,
        CASE WHEN octet_length(activity.payload::text) <= 32768 THEN activity.payload END AS payload,
        COALESCE(octet_length(activity.payload::text) > 32768, false) AS "payloadTruncated",
        activity."recordedAt",
        CASE WHEN authority."decisionId" IS NOT NULL THEN jsonb_build_object(
          'decisionId', authority."decisionId", 'decision', authority.decision,
          'actionKey', authority."actionKey", 'organizationId', authority."organizationId",
          'policyVersion', authority."policyVersion", 'rationale', jsonb_build_object('taskRunId', authority.rationale->'taskRunId')) END AS authority,
        COALESCE(envelopes."taskIds", ARRAY[]::text[]) AS "envelopeTaskIds"
      FROM jsonb_to_recordset(${JSON.stringify(requests)}::jsonb) AS request(
        "rowId" text, "taskRunId" text, "userId" text, "requestDigest" text,
        "itemId" text, gate text, binding jsonb, artifact jsonb)
      JOIN "TaskRun" task ON task.id = request."rowId" AND task."taskRunId" = request."taskRunId"
        AND task."userId" = request."userId" AND task."archivedAt" IS NULL
        AND task."a2aMetadata"->>'trigger' = 'external-mcp'
        AND task."a2aMetadata"->>'requestDigest' = request."requestDigest"
        AND task."a2aMetadata"->'initiativeReviewBinding' = request.binding
      JOIN "BacklogItem" item ON item."itemId" = request."itemId"
      CROSS JOIN LATERAL (
        SELECT a.id, a."backlogItemId", a."gateKey", a.payload, a."recordedAt"
        FROM "BacklogItemActivity" a
        WHERE a."backlogItemId" = item.id AND a.kind = 'initiative_gate_receipt'
          AND a."gateKey"::text = replace(request.gate, '-', '_')
          AND a.payload->'artifactRef' @> request.artifact
        ORDER BY a."recordedAt" DESC, a.id DESC LIMIT 21
      ) activity
      LEFT JOIN "AuthorizationDecisionLog" authority ON authority."decisionId" = activity.payload->>'authorityDecisionId'
      LEFT JOIN LATERAL (
        SELECT array_agg(link."taskRunId") AS "taskIds" FROM (
          SELECT DISTINCT envelope."taskRunId" FROM "CoworkerActionEnvelope" envelope
          WHERE envelope."authorityDecisionId" = authority."decisionId"
            AND envelope."taskRunId" IS NOT NULL AND envelope."taskRunId" <> '' LIMIT 2
        ) link
      ) envelopes ON true
    `;
    for (const request of requests) {
      const row = selected.find(row => row.id === request.rowId)!;
      const matches = found.filter(value => value.rowId === request.rowId);
      if (matches.length > PER_TASK_RECEIPTS || matches.some(value => value.payloadTruncated)) {
        partialRooms.add(row.capsuleId); continue;
      }
      const proven: InitiativeReceiptObservation[] = [];
      for (const value of matches) {
        const payload = isRecord(value.payload) ? value.payload : null;
        if (!payload || value.backlogItemId !== value.itemRowId
          || value.gateKey !== request.gate.replaceAll("-", "_")
          || !validInitiativeGateReceipt(payload, { receiptId: value.receiptId, gate: request.gate,
            subject: { kind: "backlog-item", id: request.itemId } })
          || !isRecord(payload.artifactRef) || !receiptArtifactMatches(request.binding.artifactRef, payload.artifactRef)) continue;
        // Read adapters over this same native SQL observation reuse the canonical
        // authority reducer without extra per-receipt database reads or new authority.
        const authorityReader = {
          authorizationDecisionLog: { findUnique: async () => value.authority },
          coworkerActionEnvelope: { findMany: async () => value.envelopeTaskIds.map(taskRunId => ({ taskRunId })) },
        } as unknown as Parameters<typeof readBoundReviewAuthorityTask>[0];
        if (await readBoundReviewAuthorityTask(authorityReader, String(payload.authorityDecisionId),
          { actionKey: request.binding.writerToolName }, value.organizationId,
          payload.authoritySnapshot as Record<string, unknown>) !== request.taskRunId) continue;
        if (!(value.recordedAt instanceof Date) || !Number.isFinite(value.recordedAt.getTime())
          || value.recordedAt.getTime() > now.getTime()) { partialRooms.add(row.capsuleId); continue; }
        proven.push({ id: value.receiptId, decision: payload.decision as InitiativeReceiptObservation["decision"],
          summary: String(payload.reason).slice(0, 1200), recordedAt: value.recordedAt });
      }
      if (proven.length === 1 && !partialRooms.has(row.capsuleId)) receipts.set(row.id, proven[0]!);
      else if (proven.length > 1) partialRooms.add(row.capsuleId);
    }
  } catch {
    for (const row of selected) partialRooms.add(row.capsuleId);
    receipts.clear();
  }
  for (const row of selected) if (partialRooms.has(row.capsuleId)) receipts.delete(row.id);
  return { receipts, partialRooms };
}
