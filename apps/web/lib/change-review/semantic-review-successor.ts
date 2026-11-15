import { prisma, type Prisma } from "@dpf/db";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { createSemanticReviewRequest, type SemanticReviewRequest } from "./semantic-review-request";
import { createPrismaSemanticReviewSingleFlightStore, deterministicTaskRunId } from "./semantic-review-single-flight";
import { verifySemanticReviewAuthority } from "./semantic-review-authority";
import { restoreSemanticReviewCheckpoint } from "./semantic-change-review";
import { resolveFailureAnalysisEvidence } from "./failure-analysis-evidence";
import { validateFailureAnalysis } from "./failure-analysis";
import { SEMANTIC_REVIEW_MAX_ATTEMPTS as MAX_DISPATCH_ATTEMPTS } from "./semantic-review-recovery-policy";
import { readSemanticReviewRemediation } from "./semantic-review-remediation";
import { hasProvenNoDispatchLineage } from "./semantic-review-capacity-recovery";
import { json, object, progress, state, type Run } from "./semantic-review-run";

/** Bounds a chain of server-admitted successors; a remediation-admitted successor never chains. */
const MAX_NO_DISPATCH_SUCCESSORS = MAX_DISPATCH_ATTEMPTS;
export function noDispatchSuccessorAvailable(row: Run): boolean {
  if (object(row.progressPayload).resultClass === "fail" || typeof state(row).successorTaskRunId === "string") return false;
  if (state(row).predecessorTaskRunId === undefined) return true;
  const position = state(row).successorAttempt;
  return state(row).successorBasis === "proven-no-dispatch" && typeof position === "number"
    && Number.isSafeInteger(position) && position >= 1 && position < MAX_NO_DISPATCH_SUCCESSORS;
}
export async function provenNoDispatchLineage(db: Prisma.TransactionClient | typeof prisma, row: Run, packet: SemanticReviewRequest) {
  const nodes = await db.taskNode.findMany({ where: { taskRunId: row.id }, take: 101 });
  return nodes.length <= 100 && hasProvenNoDispatchLineage({ nodes, requestDigest: packet.digest });
}
export type SuccessorAdmission =
  | { kind: "remediation"; operatorUserId: string; recovery: { remediationVerificationId: string; expectedRequestDigest: string };
    eligibilityBlocked: boolean }
  /** BI-49AA6BE8: the server's own proof that no branch ever reached a provider; no person restates it. */
  | { kind: "proven-no-dispatch" };

/**
 * One successor per lineage, admitted by fresh scoped runtime evidence or by a
 * server-proven no-dispatch lineage, never by a replay. Either way the change,
 * request identity, failure evidence and authority are rechecked, and the
 * predecessor is fenced before its checkpoints are read.
 */
/** Supplied by the worker so this module stays out of the portal's import cycle. */
export type SuccessorAdmissionDeps = { enqueue: (taskRunId: string) => Promise<boolean>; quiescenceLevel: () => Promise<string> };

export async function admitReviewSuccessor(row: Run, packet: SemanticReviewRequest, admission: SuccessorAdmission,
  deps: SuccessorAdmissionDeps) {
  const remediation = admission.kind === "remediation" ? admission : null;
  if (object(row.progressPayload).resultClass === "fail") throw new Error("semantic-review-failed-verdict-requires-repair");
  if (remediation && remediation.recovery.expectedRequestDigest !== packet.digest) throw new Error("semantic-review-recovery-digest-mismatch");
  if (remediation ? state(row).successorAttempt !== undefined || state(row).predecessorTaskRunId !== undefined
    : !noDispatchSuccessorAvailable(row)) {
    throw new Error("semantic-review-successor-budget-exhausted");
  }
  if (!(await verifySemanticReviewAuthority(packet, row.taskRunId))) throw new Error("semantic-review-recovery-authority-denied");
  if (await deps.quiescenceLevel() !== "normal") throw new Error("semantic-review-recovery-quiescing");
  const capsule = await prisma.workroom.findUnique({ where: { capsuleId: packet.input.identity.capsuleId }, select: { id: true } });
  if (!capsule) throw new Error("semantic-review-workroom-missing");
  const evidence = await resolveFailureAnalysisEvidence(packet.input.failureAnalysis, capsule.id);
  const analysis = validateFailureAnalysis(packet.input.failureAnalysis, packet.input.identity, evidence);
  if (!analysis.valid || analysis.digest !== packet.input.identity.failureAnalysisDigest) throw new Error("semantic-review-failure-evidence-changed");
  const replacement = createSemanticReviewRequest(packet.input, packet.actor);
  if (replacement.gateKey !== packet.gateKey || replacement.repository !== packet.repository
    || JSON.stringify(replacement.input) !== JSON.stringify(packet.input)) throw new Error("semantic-review-successor-identity-changed");
  const priorRecovery = state(row).recoveryAttempt ?? 0;
  if (typeof priorRecovery !== "number" || !Number.isSafeInteger(priorRecovery) || priorRecovery < 0 || priorRecovery > MAX_DISPATCH_ATTEMPTS) {
    throw new Error("semantic-review-recovery-counter-invalid");
  }
  const attempt = object(row.a2aMetadata).attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1 || attempt >= Number.MAX_SAFE_INTEGER) throw new Error("semantic-review-attempt-invalid");
  const newTaskRunId = deterministicTaskRunId(packet.gateKey, attempt + 1);
  const actorUserId = remediation ? remediation.operatorUserId : row.userId;
  const successorAttempt = remediation ? 1
    : (state(row).predecessorTaskRunId === undefined ? 0 : state(row).successorAttempt as number) + 1;
  const publication = await prisma.$transaction(async tx => {
    let proof: ReturnType<typeof readSemanticReviewRemediation> = null;
    if (remediation) {
      const verification = await tx.runtimeVerification.findUnique({ where: { verificationId: remediation.recovery.remediationVerificationId } });
      proof = readSemanticReviewRemediation(verification, { capsuleId: capsule.id,
        taskRunId: row.taskRunId, requestDigest: packet.digest, updatedAt: row.updatedAt });
      if (!proof || (remediation.eligibilityBlocked && !proof.eligibilityVerified)) {
        throw new Error("semantic-review-remediation-evidence-required");
      }
    }
    // CAS fences every old writer before inspecting checkpoints in this transaction.
    const changed = await tx.taskRun.updateMany({ where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
      data: { status: "canceled", completedAt: new Date(), progressPayload: progress(row, remediation ? {
        state: "superseded", successorTaskRunId: newTaskRunId, remediationVerificationId: remediation.recovery.remediationVerificationId,
        recoveryAuthorizedBy: remediation.operatorUserId, recoveryAuthorizedAt: new Date().toISOString(),
      } : {
        state: "superseded", successorTaskRunId: newTaskRunId, successorBasis: "proven-no-dispatch",
        capacityRecovery: null, successorOnCapacity: false, recoveryAuthorizedAt: new Date().toISOString(),
      }) } });
    if (changed.count !== 1) throw new Error("semantic-review-recovery-state-changed");
    const nodes = await tx.taskNode.findMany({ where: { taskRunId: row.id }, take: 101 });
    if (nodes.length > 100) throw new Error("semantic-review-checkpoint-limit-exceeded");
    if (!remediation) {
      // Re-proved inside the fence: a late writer cannot slip a dispatched branch in.
      if (!hasProvenNoDispatchLineage({ nodes, requestDigest: packet.digest })) throw new Error("semantic-review-execution-unresolved");
    } else for (const node of nodes) {
      const output = object(node.outputSnapshot);
      if (node.status === "completed") {
        if (output.requestDigest !== packet.digest) throw new Error("semantic-review-checkpoint-binding-mismatch");
        const restored = restoreSemanticReviewCheckpoint(output.result, String(object(node.requestContract).agentId ?? "change-reviewer"));
        if (restored.decision === "fail" || object(output.result).decision === "fail") throw new Error("semantic-review-failed-verdict-requires-repair");
      } else if (node.status !== "superseded") {
        if (!proof!.settledNodeIds.includes(node.taskNodeId)) throw new Error("semantic-review-execution-unresolved");
        await tx.taskNode.update({ where: { taskNodeId: node.taskNodeId }, data: { status: "failed", completedAt: new Date(),
          outputSnapshot: json({ ...output, requestDigest: packet.digest, providerOutcome: "unknown",
            remediationVerificationId: remediation.recovery.remediationVerificationId }) } });
      }
    }
    await createPrismaSemanticReviewSingleFlightStore(tx, remediation
      ? { packet: replacement, predecessorTaskRunId: row.taskRunId, remediationVerificationId: remediation.recovery.remediationVerificationId }
      : { packet: replacement, predecessorTaskRunId: row.taskRunId, successorAttempt, successorBasis: "proven-no-dispatch" }).create({
      taskRunId: newTaskRunId, repeatedPatternKey: `gate:${packet.gateKey}`, gateKey: packet.gateKey,
      userId: actorUserId, capsuleId: packet.input.identity.capsuleId, attempt: attempt + 1,
      title: packet.input.title, objective: packet.input.title,
    });
    const activity = await recordWorkCapsuleEvidence({ db: tx, capsuleId: packet.input.identity.capsuleId,
      evidence: { kind: "note", summary: remediation
        ? "Authorized one bounded review successor after runtime reconciliation; no verdict inferred."
        : "Started a successor review of the same change: no earlier branch reached a provider, so nothing needed settling. No verdict inferred.",
        targetId: newTaskRunId, result: { predecessorTaskRunId: row.taskRunId, requestDigest: packet.digest,
          successorRequestDigest: replacement.digest, deadlineAt: replacement.deadlineAt,
          ...(remediation ? { remediationVerificationId: remediation.recovery.remediationVerificationId }
            : { successorBasis: "proven-no-dispatch", successorAttempt }) } },
      actor: { userId: actorUserId, agentId: null, principalId: null }, deferPublication: true });
    return activity;
  });
  publishRecordedWorkCapsuleActivity(capsule.id, publication.id);
  await deps.enqueue(newTaskRunId);
  revalidatePortalContext();
  return { newTaskRunId, predecessorTaskRunId: row.taskRunId, strategy: "bounded-review-successor" };
}
