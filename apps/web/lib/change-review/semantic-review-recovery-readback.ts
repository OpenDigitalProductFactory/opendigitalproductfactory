import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { readRoutingEligibility } from "../inference/routing-exclusion-buckets";
import { semanticReviewRecoveryObservation } from "./semantic-review-recovery-policy";
import { readSemanticReviewRemediation, SEMANTIC_REVIEW_REMEDIATION_MAX_AGE_MS } from "./semantic-review-remediation";

const NODE_LIMIT = 100;
type OwnedTask = {
  taskRunId: string; userId: string; status: string; updatedAt: Date;
  progressPayload: unknown; a2aMetadata: unknown;
};

/** Called only after task admission; also bind every detail query to its admitted owner. */
export async function readSemanticReviewRecovery(row: OwnedTask, callerUserId: string) {
  if (row.userId !== callerUserId) throw new Error("semantic-review-recovery-not-owned");
  const observation = semanticReviewRecoveryObservation(row.status, row.progressPayload);
  const metadata = isRecord(row.a2aMetadata) ? row.a2aMetadata : {};
  const capsuleId = typeof metadata.capsuleId === "string" ? metadata.capsuleId : null;
  const now = Date.now();
  const nodes = await prisma.taskNode.findMany({
    where: { taskRun: { taskRunId: row.taskRunId, userId: callerUserId } },
    select: { taskNodeId: true, status: true, updatedAt: true, outputSnapshot: true },
    orderBy: { taskNodeId: "asc" }, take: NODE_LIMIT + 1,
  });
  const truncated = nodes.length > NODE_LIMIT;
  const visible = nodes.slice(0, NODE_LIMIT);
  // Scope before reading: never expose another task's proof, free text, or raw provider output.
  const verification = capsuleId && observation.requestDigest ? await prisma.runtimeVerification.findFirst({
    where: { kind: "health", status: "passed", workCapsule: { capsuleId },
      completedAt: { gte: new Date(Math.max(row.updatedAt.getTime(), now - SEMANTIC_REVIEW_REMEDIATION_MAX_AGE_MS)), lte: new Date(now) },
      AND: [
        { result: { path: ["semanticReviewRecovery", "taskRunId"], equals: row.taskRunId } },
        { result: { path: ["semanticReviewRecovery", "requestDigest"], equals: observation.requestDigest } },
      ],
    },
    orderBy: [{ completedAt: "desc" }, { verificationId: "asc" }],
    select: { verificationId: true, kind: true, status: true, workCapsuleId: true,
      runtimeTargetId: true, command: true, completedAt: true, result: true,
      workCapsule: { select: { capsuleId: true } } },
  }) : null;
  const proof = verification && verification.workCapsule?.capsuleId === capsuleId && observation.requestDigest
    ? readSemanticReviewRemediation(verification, { capsuleId: verification.workCapsuleId!,
      taskRunId: row.taskRunId, requestDigest: observation.requestDigest, updatedAt: row.updatedAt }, now) : null;
  const unresolvedNodeIds = visible.filter(node => node.status !== "completed" && node.status !== "superseded")
    .map(node => node.taskNodeId);
  const coverageComplete = !!proof && !truncated && unresolvedNodeIds.every(id => proof.settledNodeIds.includes(id));
  const remediationReady = coverageComplete && (!observation.eligibilityBlocked || proof!.eligibilityVerified);
  return { ...observation, details: {
    observedAt: new Date(now).toISOString(), taskUpdatedAt: row.updatedAt.toISOString(),
    nodes: visible.map(node => {
      const output = isRecord(node.outputSnapshot) ? node.outputSnapshot : {};
      const digestMatches = !!observation.requestDigest && output.requestDigest === observation.requestDigest;
      const routingEligibility = digestMatches && Array.isArray(output.routingEligibility)
        ? output.routingEligibility.slice(0, 5).flatMap(value => { const safe = readRoutingEligibility(value); return safe ? [safe] : []; }) : [];
      return { taskNodeId: node.taskNodeId, status: node.status, updatedAt: node.updatedAt.toISOString(),
        digestMatches, providerOutcome: digestMatches && output.providerOutcome === "not-dispatched" ? "not-dispatched"
          : output.providerOutcome === "inconclusive" ? "inconclusive" : "unknown",
        ...(routingEligibility.length ? { routingEligibility } : {}),
        settlement: coverageComplete && proof!.settledNodeIds.includes(node.taskNodeId) ? "verified" : "unverified" };
    }),
    truncated, unresolvedNodeIds,
    remediation: { state: truncated ? "node-limit-exceeded" : remediationReady ? "recorded"
        : coverageComplete ? "eligibility-verification-required" : proof ? "incomplete-node-coverage" : "missing-current-proof",
      verificationId: proof ? verification!.verificationId : null,
      executionSettled: coverageComplete, retryAuthorized: false,
      eligibilityVerified: proof?.eligibilityVerified === true,
      nextAction: remediationReady ? "Submit the recorded verification and exact request digest to retry_semantic_review; admission rechecks authority, checkpoints and lineage."
        : observation.classification === "routing-blocked"
          ? "Verify endpoint eligibility for this immutable review and record fresh scoped remediation evidence before recovery. No unchanged inference retry is authorized."
          : "Reconcile the listed provider executions and record a fresh scoped health verification. Failed or inactive task status does not prove settlement." },
  } };
}
