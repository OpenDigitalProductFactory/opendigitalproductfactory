import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { validateFailureAnalysis } from "./failure-analysis";
import { resolveFailureAnalysisEvidence } from "./failure-analysis-evidence";
import { CHANGE_REVIEW_POLICY_VERSION, CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION } from "./semantic-change-review";

/** Mandatory server boundary. Legacy receipts and shadow mode confer no exemption. */
export async function checkWorkroomFailureReadiness(capsuleId: string) {
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { id: true, headSha: true, repositoryFullName: true } });
  if (!room?.headSha || !room.repositoryFullName) return { mayPublish: false, reason: "Workroom source identity is missing." };
  const rows = await prisma.externalEvidenceRecord.findMany({
    where: { workCapsuleId: room.id, operationType: "semantic-change-review.receipt" },
    orderBy: { createdAt: "desc" }, take: 20, select: { id: true, details: true },
  });
  for (const row of rows) {
    const receipt = row.details;
    if (!isRecord(receipt) || receipt.sourceHeadSha !== room.headSha) continue;
    if (receipt.schemaVersion !== CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION || receipt.policyVersion !== CHANGE_REVIEW_POLICY_VERSION
      || receipt.disposition !== "reviewed" || !isRecord(receipt.result) || receipt.result.decision !== "pass"
      || !isRecord(receipt.result.failureAnalysisReview) || receipt.result.failureAnalysisReview.adequate !== true
      || typeof receipt.result.failureAnalysisReview.rationale !== "string" || receipt.result.failureAnalysisReview.rationale.trim().length < 20) {
      return { mayPublish: false, reason: "The current change lacks an adequate independent failure review." };
    }
    const identity = { capsuleId, headTreeHash: String(receipt.headTreeHash), diffDigest: String(receipt.diffDigest) };
    const evidence = await resolveFailureAnalysisEvidence(receipt.failureAnalysis, room.id);
    const analysis = validateFailureAnalysis(receipt.failureAnalysis, identity, evidence);
    return analysis.valid && analysis.digest === receipt.failureAnalysisDigest
      ? { mayPublish: true, reason: "Current failure analysis and executed evidence were independently reviewed.", evidenceId: row.id, sourceHeadSha: room.headSha }
      : { mayPublish: false, reason: "Failure-analysis evidence is missing, stale, or changed; refresh it and request internal review." };
  }
  return { mayPublish: false, reason: "No failure-analysis review exists for this final change." };
}
