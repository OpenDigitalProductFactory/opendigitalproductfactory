import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { failureAnalysisSchema, type FailureVerificationEvidence } from "./failure-analysis";

/** Resolve references inside this Workroom; request-supplied proof is never used. */
export async function resolveFailureAnalysisEvidence(value: unknown, workroomId: string): Promise<FailureVerificationEvidence[]> {
  const parsed = failureAnalysisSchema.safeParse(value);
  if (!parsed.success) return [];
  return resolveEvidenceByIds([...parsed.data.eliminated, ...parsed.data.scenarios].flatMap(s => s.evidenceIds), workroomId);
}

/**
 * The same resolution for a known set of record ids. BI-A0521CB0: the Build
 * Studio finalize stage resolves the evidence it just recorded before asking
 * for an analysis, so the analysis can only cite what will resolve at review.
 */
export async function resolveEvidenceByIds(evidenceIds: readonly string[], workroomId: string): Promise<FailureVerificationEvidence[]> {
  const ids = [...new Set(evidenceIds)];
  const room = await prisma.workroom.findUnique({ where: { id: workroomId }, select: { capsuleId: true, headSha: true, executorKind: true } });
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
    // BI-E4E9BD73: a Build Studio sandbox has no Docker, so its executed
    // in-platform guard and scoped-test runs are the evidence it can produce.
    // They count only inside a Build Studio Workroom; every currency and
    // content check below still applies.
    const inPlatformRun = room.executorKind === "build-studio"
      && (evidence.tier === "in-platform-preflight" || evidence.tier === "in-platform-scoped-tests");
    const governedRun = Boolean(details.gateKey && details.leaseId)
      || evidence.phase === "pre-admission-documentation"
      || inPlatformRun;
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
