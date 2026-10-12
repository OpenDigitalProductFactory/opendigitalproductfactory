import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import { humanApprovalForExecution } from "@/lib/coworker/human-approved-execution";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";
import { loadInstallationOperatingIntent } from "@/lib/installation-journey/operating-intent";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { can } from "@/lib/permissions";
import { isRecord } from "@/lib/shared/coerce";
import { CHANGE_REVIEW_POLICY_VERSION } from "./semantic-change-review";
import { SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION } from "./semantic-review-enforcement";

const operationType = "semantic-change-review.exemption";
export const semanticReviewExemptionDefinition: ToolDefinition = {
  name: "record_semantic_review_exemption",
  description: "Record one operator-authorized DEV publication exception on the current Workroom source, backed by executed verification and an independent review record. Native review remains UNRUN. No model executes and no failed review is overridden.",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    capsuleId: { type: "string" }, sourceHeadSha: { type: "string" }, baseTreeHash: { type: "string" },
    headTreeHash: { type: "string" }, diffDigest: { type: "string" }, reason: { type: "string" },
    expiresAt: { type: "string" }, verificationEvidenceId: { type: "string" }, independentReviewActivityId: { type: "string" },
  }, required: ["capsuleId", "sourceHeadSha", "baseTreeHash", "headTreeHash", "diffDigest", "reason", "expiresAt", "verificationEvidenceId", "independentReviewActivityId"] },
  requiredCapability: "manage_platform", executionMode: "immediate", sideEffect: true,
  consequence: "authority", consequenceScope: "platform", buildPhases: ["review", "ship"],
};
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const hash = (value: unknown, length: number) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

async function isEngineeringDevelopment() {
  const [environment, intent] = await Promise.all([
    loadEnvironmentClassResolution({ readConfig: async key => (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null }),
    loadInstallationOperatingIntent(prisma),
  ]);
  return environment.environmentClass === "development" && intent.status === "valid" && intent.intent.primaryPurpose === "evolve-dpf";
}

/** Resolve existing executed CI and an independently authored Workroom record.
 * An exception never turns nonpassing verification into a passing test. */
async function resolveBindings(value: Record<string, unknown>, roomId: string) {
  if (!nonempty(value.verificationEvidenceId) || !nonempty(value.independentReviewActivityId)) return null;
  const [ci, review] = await Promise.all([
    prisma.externalEvidenceRecord.findUnique({ where: { id: value.verificationEvidenceId } }),
    prisma.workroomActivity.findUnique({ where: { id: value.independentReviewActivityId } }),
  ]);
  const source = !ci ? await prisma.workroomActivity.findUnique({ where: { id: value.verificationEvidenceId } }) : null;
  const sourcePayload = source && isRecord(source.payload) ? source.payload : null;
  const sourceEvidence = sourcePayload && isRecord(sourcePayload.result) ? sourcePayload.result : null;
  const sourceValid = source?.workCapsuleId === roomId && source.kind === "evidence-recorded" && sourcePayload?.kind === "test"
    && nonempty(source.recordedById) && source.recordedByAgentId === value.authorAgentId && sourceEvidence?.tier === "source-local-checks"
    && sourceEvidence.status === "passed" && sourceEvidence.fullGateStatus === "UNRUN";
  if (!sourceValid && (!ci || ci.workCapsuleId !== roomId || ci.operationType !== "local_integration_ci" || !isRecord(ci.details))) return null;
  const details = ci && isRecord(ci.details) ? ci.details : {};
  const evidence = sourceValid ? sourceEvidence : isRecord(details.evidence) ? details.evidence : null;
  const validity = isRecord(details.evidenceValidity) ? details.evidenceValidity
    : evidence && isRecord(evidence.evidenceValidity) ? evidence.evidenceValidity : sourceValid ? sourceEvidence : null;
  if (!evidence || (!sourceValid && (details.status !== "passed" || evidence.gatePassed !== true || !(details.gateKey && details.leaseId)))
    || !validity || !nonempty(validity.expiresAt)
    || !(Date.parse(validity.expiresAt) > Date.now()) || (sourceValid ? evidence.sourceHeadSha : evidence.sha) !== value.sourceHeadSha
    || evidence.headTreeHash !== value.headTreeHash || evidence.diffDigest !== value.diffDigest
    || !nonempty(evidence.output) || !nonempty(evidence.completedAt)
    || !(Date.parse(evidence.completedAt) <= Date.now()) || !Array.isArray(evidence.commands) || !evidence.commands.length) return null;
  const payload = review && isRecord(review.payload) ? review.payload : null;
  const result = payload && isRecord(payload.result) ? payload.result : null;
  if (!review || review.kind !== "evidence-recorded"
    || !nonempty(review.recordedById) || !nonempty(review.recordedByAgentId)
    || !result || result.decision !== "pass"
    || result.sourceHeadSha !== value.sourceHeadSha || result.headTreeHash !== value.headTreeHash
    || result.diffDigest !== value.diffDigest || !nonempty(result.rationale) || result.rationale.trim().length < 20) return null;
  // External chats can share one coworker principal. Use their separately
  // admitted Workroom executors; never invent a reviewer agent to satisfy separation.
  const reviewerRoom = review.workCapsuleId !== roomId
    ? await prisma.workroom.findUnique({ where: { id: review.workCapsuleId } }) : null;
  if (review.workCapsuleId !== roomId && (!reviewerRoom || reviewerRoom.id !== review.workCapsuleId)) return null;
  if (reviewerRoom && result.capsuleId !== value.capsuleId) return null;
  const separateExecutor = reviewerRoom && nonempty(reviewerRoom.executorRef) && nonempty(value.authorExecutorRef)
    && reviewerRoom.executorRef !== value.authorExecutorRef;
  if (review.recordedByAgentId === value.authorAgentId && !separateExecutor) return null;
  return { reviewerAgentId: review.recordedByAgentId,
    independenceBasis: review.recordedByAgentId !== value.authorAgentId ? "distinct-recorded-agents" : "distinct-recorded-workroom-executors",
    reviewerWorkroomId: review.workCapsuleId, reviewerExecutorRef: reviewerRoom?.executorRef ?? null,
    verificationStatus: sourceValid ? "source-checks-passed/full-gate-UNRUN" : "executed-gate-passed",
    bindingDigest: fingerprint({ verification: sourceValid ? source?.payload : ci?.details, review: review.payload,
      verificationUserId: source?.recordedById ?? null, verificationAgentId: source?.recordedByAgentId ?? null,
      reviewerUserId: review.recordedById, reviewerAgentId: review.recordedByAgentId,
      reviewerWorkroomId: review.workCapsuleId, reviewerExecutorRef: reviewerRoom?.executorRef ?? null }) };
}

function validIdentity(value: Record<string, unknown>) {
  const expiry = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
  return nonempty(value.capsuleId) && hash(value.sourceHeadSha, 40) && hash(value.baseTreeHash, 40)
    && hash(value.headTreeHash, 40) && hash(value.diffDigest, 64) && nonempty(value.reason) && value.reason.trim().length >= 20
    && expiry > Date.now() && expiry <= Date.now() + 24 * 60 * 60 * 1000;
}

export async function recordSemanticReviewExemption(params: Record<string, unknown>, userId: string, context?: ToolExecutionContext): Promise<ToolResult> {
  const refuse = (message: string): ToolResult => ({ success: false, error: "review_exemption_refused", message });
  if (!context?.userContext || (context.userContext.userId && context.userContext.userId !== userId)
    || !can(context.userContext, "manage_platform")) return refuse("An authenticated platform operator must authorize this exception.");
  const approval = await humanApprovalForExecution({ envelopeId: context.approvedAuthorityEnvelopeId,
    toolName: "record_semantic_review_exemption", userId, agentId: context.agentId, params });
  if (context.agentId && approval?.userId !== userId) return refuse("The delegate needs the existing verified operator approval for this exact exception.");
  if (!validIdentity(params) || !await isEngineeringDevelopment()) return refuse("Exceptions require a current source identity, expiry within 24 hours, and the development/evolve-dpf installation.");
  const room = await prisma.workroom.findUnique({ where: { capsuleId: String(params.capsuleId) } });
  if (!room || !room.repositoryFullName || room.headSha !== params.sourceHeadSha) return refuse("The Workroom source identity changed or is incomplete.");
  const value = { ...params, authorAgentId: context.agentId ?? null, authorExecutorRef: room.executorRef };
  const bindings = await resolveBindings(value, room.id);
  if (!bindings) return refuse("Current executed verification and a separate reviewer record are required; failed checks remain failed.");
  const current = await prisma.externalEvidenceRecord.findMany({ where: { workCapsuleId: room.id, operationType: "semantic-change-review.receipt" }, orderBy: { createdAt: "desc" }, take: 20 });
  if (current.some(row => isRecord(row.details) && row.details.sourceHeadSha === room.headSha
    && isRecord(row.details.result) && row.details.result.decision === "fail")) return refuse("A failed current review requires repair.");
  // Re-read immediately before capture; subsequent head movement invalidates the record at consumption.
  const finalRoom = await prisma.workroom.findUnique({ where: { capsuleId: String(params.capsuleId) } });
  if (finalRoom?.headSha !== room.headSha || finalRoom.repositoryFullName !== room.repositoryFullName) return refuse("Workroom identity changed while authorizing the exception.");
  const details = { ...value, ...bindings, schemaVersion: SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION,
    policyVersion: CHANGE_REVIEW_POLICY_VERSION, sourceRepository: room.repositoryFullName, sourceBranch: room.headBranch,
    approvedByUserId: userId, authorityEnvelopeId: approval?.envelopeId ?? null, authorityInputFingerprint: fingerprintCoworkerInput(params),
    issuedAt: new Date().toISOString(), nativeReview: "UNRUN" };
  const record = await recordExternalEvidence({ actorUserId: userId, recordedByAgentId: context.agentId,
    routeContext: "change-review", operationType, target: room.capsuleId, provider: "dpf-change-review", workCapsuleId: room.id,
    resultSummary: "Operator authorized a bounded DEV publication exception; native review UNRUN.", details: details as Prisma.InputJsonValue });
  return { success: true, entityId: record.id, message: "Publication exception recorded; native review remains UNRUN.", data: { exemption: { ...details, evidenceId: record.id } } };
}

export async function resolveWorkroomReviewExemption(capsuleId: string, roomId: string, headSha: string) {
  if (!await isEngineeringDevelopment()) return null;
  const room = await prisma.workroom.findUnique({ where: { capsuleId } });
  if (!room || room.id !== roomId || room.headSha !== headSha) return null;
  const rows = await prisma.externalEvidenceRecord.findMany({ where: { workCapsuleId: roomId, operationType }, orderBy: { createdAt: "desc" }, take: 20 });
  for (const row of rows) {
    const value = row.details;
    if (!isRecord(value) || value.sourceHeadSha !== headSha) continue;
    if (!validIdentity(value) || value.capsuleId !== capsuleId || value.schemaVersion !== SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION
      || value.policyVersion !== CHANGE_REVIEW_POLICY_VERSION || value.nativeReview !== "UNRUN"
      || value.sourceRepository !== room.repositoryFullName || value.sourceBranch !== room.headBranch
      || value.authorExecutorRef !== room.executorRef
      || !nonempty(value.approvedByUserId) || (value.authorAgentId && !nonempty(value.authorityEnvelopeId))) return null;
    if (value.authorAgentId) {
      const approval = await prisma.coworkerActionEnvelope.findUnique({ where: { id: String(value.authorityEnvelopeId) } });
      if (!approval || !["approved", "executed"].includes(approval.status) || approval.delegatingUserId !== value.approvedByUserId
        || approval.coworkerAgentId !== value.authorAgentId || approval.manifestActionId !== "record_semantic_review_exemption"
        || approval.inputFingerprint !== value.authorityInputFingerprint) return null;
    }
    const bindings = await resolveBindings(value, roomId);
    if (!bindings || bindings.bindingDigest !== value.bindingDigest || bindings.reviewerAgentId !== value.reviewerAgentId) return null;
    return { evidenceId: row.id, sourceHeadSha: headSha };
  }
  return null;
}
