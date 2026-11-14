import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { failureAnalysisSchema, type FailureVerificationEvidence } from "./failure-analysis";
import { readCommitTree } from "./review-artifact-source";

/** Resolve references inside this Workroom; request-supplied proof is never used. */
export async function resolveFailureAnalysisEvidence(value: unknown, workroomId: string): Promise<FailureVerificationEvidence[]> {
  const parsed = failureAnalysisSchema.safeParse(value);
  if (!parsed.success) return [];
  const [evidence, authorities] = await Promise.all([
    resolveEvidenceByIds([...parsed.data.eliminated, ...parsed.data.scenarios].flatMap(s => s.evidenceIds), workroomId),
    resolveRiskAcceptanceAuthorities(
      parsed.data.scenarios.flatMap(s => s.residualRisk.authorityEvidenceId ? [s.residualRisk.authorityEvidenceId] : []),
      workroomId,
    ),
  ]);
  return [...evidence, ...authorities];
}

/** The Workroom activity kind a platform-decided risk acceptance is written as. */
export const RISK_ACCEPTANCE_ACTIVITY_KIND = "risk-acceptance";

/**
 * BI-09FB398D: the risk-acceptance authorities a failure analysis cites,
 * resolved from this Workroom's own log. Only platform code writes this
 * activity kind (apps/web/lib/build/risk-acceptance.ts); no MCP evidence
 * kind can produce it, so a caller cannot mint one. The validator still binds
 * each to the scenario, the exact change and the owning item.
 */
export async function resolveRiskAcceptanceAuthorities(ids: readonly string[], workroomId: string): Promise<FailureVerificationEvidence[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const room = await prisma.workroom.findUnique({ where: { id: workroomId }, select: { capsuleId: true } });
  if (!room) return [];
  const rows = await prisma.workroomActivity.findMany({
    where: { id: { in: unique }, workCapsuleId: workroomId, kind: RISK_ACCEPTANCE_ACTIVITY_KIND },
    select: { id: true, payload: true, recordedAt: true },
  });
  return rows.flatMap(row => {
    const p = isRecord(row.payload) ? row.payload : {};
    if (typeof p.scenarioKey !== "string" || typeof p.headTreeHash !== "string" || typeof p.diffDigest !== "string"
      || typeof p.followUpReference !== "string" || !p.followUpReference) return [];
    return [{
      id: row.id, kind: "risk-acceptance" as const, capsuleId: room.capsuleId, status: "accepted",
      headTreeHash: p.headTreeHash, diffDigest: p.diffDigest,
      expected: typeof p.consult === "string" ? p.consult : "escalation gate consult",
      observed: typeof p.decision === "string" ? p.decision : "accepted",
      completedAt: row.recordedAt.toISOString(),
      scenarioKey: p.scenarioKey, followUpReference: p.followUpReference,
    }];
  });
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
  // BI-7430A9CC: local-CI reuses a PASS by tree identity, so a head rebuilt with
  // the same tree (a clean rebase, a DCO re-sign) is served a record minted for
  // the earlier commit. That record verified these exact bytes. Accept it only
  // when this install's own checkout shows the room head has the record's tree;
  // the review identity still has to match the record's tree and diff digest.
  const headSha = room.headSha;
  let headTree: Promise<string | null> | undefined;
  const boundToHead = async (evidence: Record<string, unknown>) => evidence.sha === headSha
    || (typeof evidence.headTreeHash === "string"
      && evidence.headTreeHash === await (headTree ??= readCommitTree(headSha)));
  const resolved = await Promise.all(rows.map(async row => {
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
    if (!governedRun || details.status !== "passed" || evidence.gatePassed !== true || !await boundToHead(evidence)) return [];
    if (typeof evidence.headTreeHash !== "string" || typeof evidence.diffDigest !== "string"
      || typeof evidence.output !== "string" || typeof evidence.completedAt !== "string"
      || !Array.isArray(evidence.commands) || !evidence.commands.length) return [];
    return [{ id: row.id, capsuleId: room.capsuleId, status: "passed", headTreeHash: evidence.headTreeHash,
      diffDigest: evidence.diffDigest, expected: evidence.commands.join("\n"), observed: evidence.output,
      completedAt: evidence.completedAt }];
  }));
  return resolved.flat();
}
