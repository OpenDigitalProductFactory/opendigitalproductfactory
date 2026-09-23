import { isRecord } from "@/lib/shared/coerce";
import { readLatestInitiativeGateRows, type InitiativeGateQueryDb } from "@/lib/backlog/initiative-readiness/receipt-reader";
import { validInitiativeGateReceipt } from "@/lib/backlog/initiative-readiness/receipt-validation";
import { resolveWorkShapeClaim } from "./workroom-shape-claim";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkShapeEvidenceKind } from "./work-shape-evidence-kinds";

export type InitiativeEvidenceRoom = {
  id?: string; capsuleId: string; backlogItemId?: string | null;
  repositoryFullName?: string | null; headSha?: string | null; scopeClaims?: unknown;
};
export type InitiativeEvidenceClient = Partial<InitiativeGateQueryDb> & {
  backlogItem?: { findMany(args: unknown): Promise<{ id: string; itemId: string }[]> };
};

// These are evidence requirements in the versioned delivery definitions, not
// permissions to advance a stage. Other gates remain in the evidence lane.
const REQUIREMENT_KIND: Readonly<Record<string, WorkShapeEvidenceKind>> = {
  research: "research-receipt", "spec-approval": "spec-approval-receipt",
  "architecture-review": "architecture-review-receipt", "plan-review": "plan-review-receipt",
  "post-implementation-review": "pir-receipt",
};

export async function loadWorkroomInitiativeEvidence(
  db: InitiativeEvidenceClient, rooms: readonly InitiativeEvidenceRoom[],
): Promise<{ receipts: ReceiptEnvelope[]; partial: boolean }> {
  const itemIds = [...new Set(rooms.flatMap(room => room.backlogItemId ? [room.backlogItemId] : []))];
  if (!itemIds.length) return { receipts: [], partial: false };
  if (!db.backlogItem || !db.$queryRaw) return { receipts: [], partial: true };
  try {
    const items = await db.backlogItem.findMany({ where: { itemId: { in: itemIds.slice(0, 200) } },
      select: { id: true, itemId: true }, take: 200 });
    const byId = new Map(items.map(item => [item.id, item.itemId]));
    const rows = await readLatestInitiativeGateRows(items.map(item => item.id), { $queryRaw: db.$queryRaw.bind(db) });
    let partial = itemIds.length > 200 || items.length !== itemIds.length;
    const receipts: ReceiptEnvelope[] = [];
    for (const row of rows) {
      const itemId = byId.get(row.backlogItemId);
      const payload = row.payload;
      if (!itemId || !isRecord(payload) || !Number.isFinite(row.recordedAt.getTime())
        || !validInitiativeGateReceipt(payload, { receiptId: row.id, gate: row.gateKey,
          subject: { kind: "backlog-item", id: itemId } })) {
        partial = true;
        continue;
      }
      const matchingRooms = rooms.filter(room => room.backlogItemId === itemId);
      const artifact = isRecord(payload.artifactRef) ? payload.artifactRef : null;
      for (const room of matchingRooms) {
        const currentSource = artifact?.kind === "repo-blob-at-commit"
          && typeof artifact.commitSha === "string" && /^[a-f0-9]{40}$/i.test(artifact.commitSha)
          && typeof artifact.providerBlobId === "string" && /^[a-f0-9]{40}$/i.test(artifact.providerBlobId)
          && typeof artifact.repositoryFullName === "string" && Boolean(room.repositoryFullName)
          && artifact.repositoryFullName.toLowerCase() === room.repositoryFullName!.toLowerCase()
          && artifact.commitSha.toLowerCase() === room.headSha?.toLowerCase();
        const definition = resolveWorkShapeClaim(room.scopeClaims);
        const evidenceKind = REQUIREMENT_KIND[row.gateKey];
        const stages = currentSource && evidenceKind && definition
          ? definition.stages.filter(stage => stage.evidence.includes(evidenceKind)) : [];
        receipts.push({
          receiptId: row.id, receiptKind: row.gateKey, enforcementMode: "observed-event",
          sourceRef: { kind: "work-capsule", id: room.capsuleId, status: String(payload.decision) },
          actionType: row.gateKey, status: "observed",
          summary: `${row.gateKey}: ${payload.decision} (${currentSource ? "current source" : "historical or unresolved source"}${typeof artifact?.commitSha === "string" ? ` ${artifact.commitSha.slice(0, 12)}` : ""}). ${String(payload.reason).slice(0, 240)}`,
          occurredAt: row.recordedAt.toISOString(), actorRef: { actorKind: "agent", actorId: String(payload.reviewerAgentId) },
          inputDigest: String(payload.artifactDigest), outputDigest: { artifactRef: artifact, decision: payload.decision },
          policyRefs: [String(payload.policyVersion)], rawRef: { table: "BacklogItemActivity", id: row.id },
          ...(stages.length === 1 && definition ? { processEvidence: {
            definitionRef: `${definition.key}@${definition.version}`, stageKey: stages[0]!.key,
            evidenceKind, relationship: "required-evidence" as const,
          } } : {}),
        });
      }
    }
    return { receipts, partial };
  } catch {
    return { receipts: [], partial: true };
  }
}
