import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { readRoutingEligibility } from "../inference/routing-exclusion-buckets";
import { semanticReviewRecoveryObservation, semanticReviewNodeEligibility } from "./semantic-review-recovery-policy";
import { readSemanticReviewRemediation, SEMANTIC_REVIEW_REMEDIATION_MAX_AGE_MS } from "./semantic-review-remediation";
import { inspectSemanticReviewAuthority, type SemanticReviewAuthorityObservation } from "./semantic-review-authority";
import { readPersistedSemanticReviewRequest } from "./semantic-review-request-store";
import type { OAuthExecutionAuthorityDetail } from "@/lib/auth/oauth-tokens";

const NODE_LIMIT = 100;
type OwnedTask = {
  id?: string; taskRunId: string; userId: string; status: string; updatedAt: Date;
  progressPayload: unknown; a2aMetadata: unknown;
};

const authorityRemedies: Record<SemanticReviewAuthorityObservation["reason"], string> = {
  "authority-current": "Current authority is valid. Reconcile execution and the original recovery budget before any recovery action.",
  "human-capability-denied": "The original human's current platform access must be reviewed by its authority administrator.",
  "saved-token-unavailable": "The original saved credential reference is unavailable or no longer eligible. Use supported original-request recovery; do not substitute another credential.",
  "saved-token-scope-denied": "The original saved credential does not currently authorize review. Its authority owner must review the existing scope; signing in alone does not widen it.",
  "oauth-authority-invalid": "The original OAuth client, consent or continuity envelope is no longer valid. Review that original connection through supported account controls; do not copy credentials or assume expiry.",
  "auth-source-unsupported": "The recorded authentication source is unsupported. Reconcile the original request through its existing owner recovery procedure.",
  "coworker-grant-denied": "The acting coworker lacks the required current review grant. Its grant administrator must review access; this observation does not grant it.",
  "task-authority-denied": "The original actor is not currently authorized for this task, or the task is unavailable. Reconcile the existing task assignment through supported ownership controls.",
  "task-authority-unavailable": "Task authority could not be observed. Restore its observation service before diagnosing a denial or recovering work.",
};

const oauthRemedies: Record<OAuthExecutionAuthorityDetail, string> = {
  "token-kind-invalid": "The saved reference is not an OAuth access credential. Reconcile the original request binding through supported recovery; do not substitute credentials.",
  "token-revoked": "The original credential is revoked. Its owner must review the revocation through supported account controls; this does not authorize retry.",
  "client-missing": "The original OAuth client record is missing. Reconcile that original connection through supported recovery; a different working connection is not proof of restoration.",
  "client-revoked": "The original OAuth client is revoked. Its owner must review that connection through supported account controls; signing in elsewhere does not restore it.",
  "human-unavailable": "The original human is not currently eligible. The authority administrator must review that account's current access.",
  "continuity-envelope-missing": "The original queued-work continuity binding is incomplete. Reconcile the original binding; do not infer that reconnecting can restore it.",
  "continuity-evidence-missing": "No eligible access successor or refresh evidence was found for the original continuity binding. The recovery owner must reconcile that binding; this does not establish why continuity was lost.",
  "consent-binding-missing": "The original connection has no required consent binding. Review the original consent through supported account controls; do not copy another connection's consent.",
  "consent-envelope-missing": "The original consent binding lacks its client or resource context. Reconcile the original binding through supported recovery.",
  "consent-invalid": "The original consent is not currently eligible for the recorded assistant and scope. Its authority owner must review that consent; this observation does not identify a historical cause.",
};

async function readAuthority(row: OwnedTask) {
  try {
    const packet = row.id ? await readPersistedSemanticReviewRequest({ ...row, id: row.id }) : null;
    if (!packet) return { state: "unavailable" as const, reason: "immutable-request-unavailable" as const,
      nextAction: "The original immutable request could not be verified. Restore its existing binding before authority diagnosis; do not reconstruct its digest." };
    const observation = await inspectSemanticReviewAuthority(packet, row.taskRunId);
    return { ...observation, nextAction: observation.reason === "oauth-authority-invalid" && observation.detail
      ? oauthRemedies[observation.detail] : authorityRemedies[observation.reason] };
  } catch {
    return { state: "unavailable" as const, reason: "authority-observation-unavailable" as const,
      nextAction: "Authority could not be observed. Restore the observation service; this is neither a confirmed denial nor permission to recover." };
  }
}

/** Called only after task admission; also bind every detail query to its admitted owner. */
export async function readSemanticReviewRecovery(row: OwnedTask, callerUserId: string) {
  if (row.userId !== callerUserId) throw new Error("semantic-review-recovery-not-owned");
  const authority = await readAuthority(row);
  let observation = semanticReviewRecoveryObservation(row.status, row.progressPayload);
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
  const routingEligibility = semanticReviewNodeEligibility(visible, observation.requestDigest ?? "");
  if (routingEligibility.length) {
    const payload = isRecord(row.progressPayload) ? row.progressPayload : {};
    observation = semanticReviewRecoveryObservation(row.status, { ...payload,
      semanticReview: { ...(isRecord(payload.semanticReview) ? payload.semanticReview : {}), routingEligibility } });
  }
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
    authority,
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
