import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { prisma } from "@dpf/db";
import { isFullSourceCommitSha } from "@/lib/work-capsules/work-capsule-branch-identity";
import { parseInitiativeReviewArtifactRef } from "@/lib/mcp-task-review-contract";
import { validInitiativeGateReceipt } from "./receipt-validation";
import type { CurrentResearchEvidence } from "./judged-design-artifact";
import type { InitiativeArtifactRef } from "./receipt-schema";
import { prepareCurrentArtifactObservation, type ArtifactObservationDb } from "./current-artifact-observation";

type Db = Pick<typeof prisma, "backlogItem" | "backlogItemActivity" | "workroom"> & ArtifactObservationDb;
type ClaimSource = { workroomId?: string; repositoryFullName: string; headBranch: string; baseSha?: string | null; headSha?: string | null };
type Room = ClaimSource & { capsuleId: string; baseSha: string; headSha: string;
  leaseHolderPrincipalId: string | null; executorRef: string | null; leaseExpiresAt: string | null; status: string };
type BoundResearch = {
  kind: "bound"; itemRowId: string; itemId: string; selection: string;
  receiptId: string; receiptRecordedAt: string; receiptPayload: unknown; room: Room;
  artifactRef: Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>;
};
type Binding = BoundResearch | { kind: "not-applicable" | "unavailable" };
export type CurrentResearchPorts = Partial<{
  readBlob: typeof import("./repository-artifact").readRepositoryProviderBlob;
  lockBinding: (binding: BoundResearch, db: ArtifactObservationDb) => Promise<void>;
}>;

async function loadBinding(itemId: string, db: Db, claimSource?: ClaimSource): Promise<Binding> {
  const item = await db.backlogItem.findFirst({ where: { OR: [{ itemId }, { id: itemId }] },
    select: { id: true, itemId: true, body: true } });
  if (!item) return { kind: "unavailable" };
  const rows = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_gate_receipt", gateKey: "research" },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1,
    select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
  });
  const latest = rows.find(row => row.kind === "initiative_gate_receipt" && row.gateKey === "research");
  if (!latest) return { kind: "not-applicable" };
  if (!validInitiativeGateReceipt(latest.payload, { receiptId: latest.id, gate: "research",
    subject: { kind: "backlog-item", id: item.itemId } })) return { kind: "unavailable" };
  const payload = latest.payload as Record<string, unknown>;
  const artifactRef = parseInitiativeReviewArtifactRef(payload.artifactRef);
  if (artifactRef?.kind !== "repo-blob-at-commit" || !isFullSourceCommitSha(artifactRef.commitSha)
    || !isFullSourceCommitSha(artifactRef.providerBlobId)) return { kind: "unavailable" };
  if (claimSource && (!claimSource.repositoryFullName || !claimSource.headBranch
    || !isFullSourceCommitSha(claimSource.baseSha) || !isFullSourceCommitSha(claimSource.headSha))) return { kind: "unavailable" };
  const rooms = await db.workroom.findMany({
    where: { backlogItemId: { in: [item.id, item.itemId] }, archivedAt: null,
      status: { notIn: ["abandoned", "archived", "superseded"] },
      ...(claimSource?.workroomId ? { capsuleId: claimSource.workroomId } : {}),
      ...(claimSource ? { repositoryFullName: claimSource.repositoryFullName, headBranch: claimSource.headBranch,
        baseSha: claimSource.baseSha, headSha: claimSource.headSha } : {}) }, take: 2,
    select: { capsuleId: true, repositoryFullName: true, headBranch: true, baseSha: true, headSha: true,
      leaseHolderPrincipalId: true, executorRef: true, leaseExpiresAt: true, status: true },
  });
  const room = rooms.length === 1 ? rooms[0] : null;
  if (!room?.repositoryFullName || room.repositoryFullName !== artifactRef.repositoryFullName
    || !room.headBranch || !isFullSourceCommitSha(room.baseSha) || !isFullSourceCommitSha(room.headSha)) return { kind: "unavailable" };
  return { kind: "bound", itemRowId: item.id, itemId: item.itemId, selection: item.body ?? "",
    receiptId: latest.id, receiptRecordedAt: latest.recordedAt.toISOString(), receiptPayload: latest.payload, artifactRef,
    // canonicalJson deliberately treats Date as an empty object. Preserve the
    // actual expiry in the binding so a lease change cannot compare equal.
    room: { ...room, leaseExpiresAt: room.leaseExpiresAt?.toISOString() ?? null } as Room };
}

/** Own author research is not a replacement approval of the inherited design. */
export async function prepareCurrentResearchObservation(args: {
  itemId: string; db: Db; claimSource?: ClaimSource; ports?: CurrentResearchPorts;
}) {
  const source = args.claimSource ? { ...args.claimSource } : undefined;
  const unavailable: CurrentResearchEvidence = { state: "unavailable" };
  return prepareCurrentArtifactObservation<Binding, CurrentResearchEvidence | undefined>({
    db: args.db, load: db => loadBinding(args.itemId, db as Db, source),
    read: async binding => {
      const readBlob = args.ports?.readBlob ?? (await import("./repository-artifact")).readRepositoryProviderBlob;
      // Verify the recorded blob at the real current head, permitting unchanged
      // research across unrelated commits without treating history as current.
      // A valid persisted receipt scopes this internal public-byte observation;
      // it supplies no actor admission and never authorizes a new receipt/read.
      const fingerprint = canonicalJson(binding);
      const bytes = await readBlob({ repositoryFullName: binding.room.repositoryFullName,
        commitSha: binding.room.headSha, path: binding.artifactRef.path, expectedBlobId: binding.artifactRef.providerBlobId,
        sourceAdmission: { itemId: binding.itemId, workroomId: binding.room.capsuleId,
          repositoryFullName: binding.room.repositoryFullName, branchName: binding.room.headBranch, headSha: binding.room.headSha,
          isCurrent: async () => canonicalJson(await loadBinding(args.itemId, args.db, source)) === fingerprint },
      });
      return bytes.ok ? { state: "verified", receiptId: binding.receiptId,
        digest: `sha256:${createHash("sha256").update(bytes.data).digest("hex")}` } : unavailable;
    },
    unbound: binding => binding.kind === "not-applicable" ? undefined : unavailable,
    unavailable, isUnavailable: evidence => evidence?.state === "unavailable",
    lock: args.ports?.lockBinding,
  });
}
