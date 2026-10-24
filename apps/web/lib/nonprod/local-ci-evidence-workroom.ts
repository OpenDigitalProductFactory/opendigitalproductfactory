import type { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";

type EvidenceTx = Pick<typeof prisma, "workroom" | "externalEvidenceRecord">;
type WorkroomReader = { findMany(args: unknown): Promise<Array<{ id: string; headSha: string | null }>> };

/**
 * The Workroom a local-CI result belongs to: the gating session's live room on
 * the gated branch. BI-C9912C22: an adopted room may not have recorded its head
 * yet (WC-BFDF763B was adopted before its first sync, so its headSha was null
 * when pregate passed), or may hold an older commit of the same branch. Both
 * still own the run. Attribution confers no review authority: the failure-
 * analysis resolver re-checks evidence.sha against the room's head at review.
 *
 * The room whose head is exactly the gated commit wins. Without one, a single
 * room is linked; several inexact rooms are left unlinked rather than guessed.
 * Several exact rooms are "ambiguous".
 */
export async function findLocalCiEvidenceWorkroom(
  workroom: WorkroomReader,
  run: { branch: string; sha: string; sessionId: string },
): Promise<{ id: string } | "ambiguous" | null> {
  const rooms = await workroom.findMany({
    where: { headBranch: run.branch, executorRef: run.sessionId, archivedAt: null },
    select: { id: true, headSha: true }, take: 3,
  });
  const exact = rooms.filter((room) => room.headSha === run.sha);
  if (exact.length > 1) return "ambiguous";
  if (exact.length === 1) return { id: exact[0].id };
  return rooms.length === 1 ? { id: rooms[0].id } : null;
}
export type ReusedLocalCiEvidence = {
  id: string; operationType: string; target: string | null;
  workCapsuleId: string | null; details: unknown;
};

/** Inside the lease transaction: repair attribution only, never a gate verdict. */
export async function reconcileLocalCiEvidenceWorkroom(
  tx: EvidenceTx,
  record: ReusedLocalCiEvidence | null,
  lease: { leaseId: string; ownerSessionId: string },
): Promise<void> {
  if (!record || record.operationType !== "local_integration_ci" || !isRecord(record.details)) return;
  const details = record.details;
  const evidence = isRecord(details.evidence) ? details.evidence : null;
  // Legacy/incomplete evidence remains unlinked; it gains no review authority.
  if (!evidence || typeof evidence.sha !== "string" || !/^[a-f0-9]{40}$/.test(evidence.sha)
    || typeof evidence.branch !== "string" || !evidence.branch
    || typeof details.externalSessionId !== "string" || !details.externalSessionId) return;
  if (record.target !== evidence.branch || details.leaseId !== lease.leaseId
    || details.externalSessionId !== lease.ownerSessionId) {
    throw new Error("local-ci-evidence-owner-mismatch");
  }
  const match = await findLocalCiEvidenceWorkroom(tx.workroom as unknown as WorkroomReader, {
    branch: evidence.branch, sha: evidence.sha, sessionId: details.externalSessionId,
  });
  if (match === "ambiguous") throw new Error("local-ci-evidence-workroom-ambiguous");
  if (!match) return;
  const workCapsuleId = match.id;
  if (record.workCapsuleId === workCapsuleId) return;
  if (record.workCapsuleId !== null) throw new Error("local-ci-evidence-workroom-conflict");
  const attached = await tx.externalEvidenceRecord.updateMany({
    where: { id: record.id, workCapsuleId: null }, data: { workCapsuleId },
  });
  if (attached.count !== 1) throw new Error("local-ci-evidence-workroom-conflict");
}
