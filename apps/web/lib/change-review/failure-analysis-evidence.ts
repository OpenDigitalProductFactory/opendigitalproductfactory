import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { failureAnalysisSchema, type FailureVerificationEvidence } from "./failure-analysis";

/** Resolve references inside this Workroom; request-supplied proof is never used. */
export async function resolveFailureAnalysisEvidence(value: unknown, workroomId: string): Promise<FailureVerificationEvidence[]> {
  const parsed = failureAnalysisSchema.safeParse(value);
  if (!parsed.success) return [];
  const ids = [...new Set([...parsed.data.eliminated, ...parsed.data.scenarios].flatMap(s => s.evidenceIds))];
  const room = await prisma.workroom.findUnique({ where: { id: workroomId }, select: { capsuleId: true, headSha: true } });
  if (!room?.headSha) return [];
  const rows = await prisma.externalEvidenceRecord.findMany({
    where: { id: { in: ids }, workCapsuleId: workroomId },
    select: { id: true, operationType: true, details: true, createdAt: true },
  });
  return rows.flatMap(row => {
    if (!isRecord(row.details) || row.operationType !== "local_integration_ci") return [];
    const details = row.details;
    const evidence = isRecord(details.evidence) ? details.evidence : {};
    // Resolve an executed report, not the caller's narrative verification string.
    // Documentation uses the existing lightweight lane; runtime uses its lease.
    const governedRun = Boolean(details.gateKey && details.leaseId)
      || evidence.phase === "pre-admission-documentation";
    const validity = isRecord(details.evidenceValidity) ? details.evidenceValidity
      : isRecord(evidence.evidenceValidity) ? evidence.evidenceValidity : null;
    if (!validity || typeof validity.expiresAt !== "string" || !Number.isFinite(Date.parse(validity.expiresAt))
      || Date.parse(validity.expiresAt) <= Date.now()) return [];
    if (!governedRun || details.status !== "passed" || evidence.gatePassed !== true || evidence.sha !== room.headSha) return [];
    if (typeof evidence.headTreeHash !== "string" || typeof evidence.diffDigest !== "string"
      || typeof evidence.output !== "string" || typeof evidence.completedAt !== "string"
      || !Array.isArray(evidence.commands) || !evidence.commands.length) return [];
    return [{ id: row.id, capsuleId: room.capsuleId, status: "passed", headTreeHash: evidence.headTreeHash,
      diffDigest: evidence.diffDigest, expected: evidence.commands.join("\n"), observed: evidence.output,
      completedAt: evidence.completedAt }];
  });
}
