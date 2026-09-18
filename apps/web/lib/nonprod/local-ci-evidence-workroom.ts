import type { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";

type EvidenceTx = Pick<typeof prisma, "workroom" | "externalEvidenceRecord">;
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
  const matches = await tx.workroom.findMany({ where: {
    headBranch: evidence.branch, headSha: evidence.sha,
    executorRef: details.externalSessionId, archivedAt: null,
  }, select: { id: true }, take: 2 });
  if (matches.length > 1) throw new Error("local-ci-evidence-workroom-ambiguous");
  if (!matches.length) return;
  const workCapsuleId = matches[0].id;
  if (record.workCapsuleId === workCapsuleId) return;
  if (record.workCapsuleId !== null) throw new Error("local-ci-evidence-workroom-conflict");
  const attached = await tx.externalEvidenceRecord.updateMany({
    where: { id: record.id, workCapsuleId: null }, data: { workCapsuleId },
  });
  if (attached.count !== 1) throw new Error("local-ci-evidence-workroom-conflict");
}
