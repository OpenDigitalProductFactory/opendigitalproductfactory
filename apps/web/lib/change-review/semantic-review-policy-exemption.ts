import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { recordExternalEvidenceInStore } from "@/lib/observability/external-evidence-store";
import { humanApprovalForConsumption, humanApprovalForExecution } from "@/lib/coworker/human-approved-execution";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";
import { loadInstallationOperatingIntent } from "@/lib/installation-journey/operating-intent";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { can } from "@/lib/permissions";
import { isRecord } from "@/lib/shared/coerce";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { CHANGE_REVIEW_POLICY_VERSION } from "./semantic-change-review";
import { SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION } from "./semantic-review-enforcement";

const operationType = "semantic-change-review.exemption";
const inputKeys = ["capsuleId", "sourceHeadSha", "baseTreeHash", "headTreeHash", "diffDigest", "reason", "expiresAt", "verificationEvidenceId", "clientAssessmentActivityId", "reviewBasis"];
export const semanticReviewExemptionDefinition: ToolDefinition = {
  name: "record_semantic_review_exemption",
  description: "Record one operator-authorized DEV publication exception with current verification and a cited client assessment. Native review remains UNRUN and assessment independence UNVERIFIED. The operator explicitly accepts that assurance limit. No model executes and a failed review requires repair.",
  inputSchema: { type: "object", additionalProperties: false, properties: {
    capsuleId: { type: "string" }, sourceHeadSha: { type: "string" }, baseTreeHash: { type: "string" },
    headTreeHash: { type: "string" }, diffDigest: { type: "string" }, reason: { type: "string" },
    expiresAt: { type: "string" }, verificationEvidenceId: { type: "string" }, clientAssessmentActivityId: { type: "string" },
    reviewBasis: { type: "string", enum: ["operator-accepted-client-assessment"], description: "Explicit acceptance of client assessment whose independent execution is not certified. Part of the operator's exact approval." },
  }, required: ["capsuleId", "sourceHeadSha", "baseTreeHash", "headTreeHash", "diffDigest", "reason", "expiresAt", "verificationEvidenceId", "clientAssessmentActivityId", "reviewBasis"] },
  requiredCapability: "manage_platform", executionMode: "immediate", sideEffect: true,
  consequence: "authority", consequenceScope: "platform", buildPhases: ["review", "ship"],
};
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const hash = (value: unknown, length: number) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Query the revision itself; unrelated later receipts must not hide a failure. */
export async function findCurrentSemanticFailure(roomId: string, headSha: string) {
  return prisma.externalEvidenceRecord.findFirst({ where: { workCapsuleId: roomId, operationType: "semantic-change-review.receipt",
    AND: [{ details: { path: ["sourceHeadSha"], equals: headSha } }, { details: { path: ["result", "decision"], equals: "fail" } }] }, select: { id: true } });
}

async function isEngineeringDevelopment() {
  const [environment, intent] = await Promise.all([
    loadEnvironmentClassResolution({ readConfig: async key => (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null }),
    loadInstallationOperatingIntent(prisma),
  ]);
  return environment.environmentClass === "development" && intent.status === "valid" && intent.intent.primaryPurpose === "evolve-dpf";
}

/** Resolve cited evidence, without treating client declarations as certified
 * independent execution. The operator accepts this limit explicitly. */
type ExceptionActor = { userId: string; agentId: string };
const refusal = (message: string): ToolResult => ({ success: false, error: "review_exemption_refused", message });
const scopeRefusal = "The exception prerequisites cannot be verified within the caller's authorized workroom scope.";

async function canReadRoom(actor: ExceptionActor, workroomId: string) {
  const access = await resolveAgentWorkroomAccess({ ...actor, workroomId, requested: "content" }, prisma);
  return access.decision.level === "content";
}

async function resolveBindings(value: Record<string, unknown>, roomId: string, actor: ExceptionActor) {
  if (!nonempty(value.verificationEvidenceId) || !nonempty(value.clientAssessmentActivityId)) return null;
  if (!await canReadRoom(actor, roomId)) return null;
  // A locator is not permission to read the assessment. Its owning room can
  // differ from the requested waiver's room; missing and denied stay identical.
  const reviewLocator = await prisma.workroomActivity.findUnique({
    where: { id: value.clientAssessmentActivityId }, select: { workCapsuleId: true },
  });
  if (!reviewLocator || !nonempty(reviewLocator.workCapsuleId)
    || reviewLocator.workCapsuleId !== roomId && !await canReadRoom(actor, reviewLocator.workCapsuleId)) return null;
  const [ci, review] = await Promise.all([
    prisma.externalEvidenceRecord.findUnique({ where: { id: value.verificationEvidenceId, workCapsuleId: roomId } }),
    prisma.workroomActivity.findUnique({ where: { id: value.clientAssessmentActivityId, workCapsuleId: reviewLocator.workCapsuleId } }),
  ]);
  if (review && review.workCapsuleId !== reviewLocator.workCapsuleId) return null;
  const source = !ci ? await prisma.workroomActivity.findUnique({ where: { id: value.verificationEvidenceId, workCapsuleId: roomId } }) : null;
  const sourcePayload = source && isRecord(source.payload) ? source.payload : null;
  const sourceEvidence = sourcePayload && isRecord(sourcePayload.result) ? sourcePayload.result : null;
  const sourceValid = source?.workCapsuleId === roomId && source.kind === "evidence-recorded" && sourcePayload?.kind === "test"
    && nonempty(source.recordedById) && source.recordedByAgentId === value.requestingAgentId && sourceEvidence?.tier === "source-local-checks"
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
  // Record the cited room separately from the activity's actual producer.
  // Room executors do not establish who wrote a generic evidence record.
  const reviewerRoom = review.workCapsuleId !== roomId
    ? await prisma.workroom.findUnique({ where: { id: review.workCapsuleId }, select: { id: true, executorRef: true } }) : null;
  if (review.workCapsuleId !== roomId && (!reviewerRoom || reviewerRoom.id !== review.workCapsuleId)) return null;
  if (reviewerRoom && result.capsuleId !== value.capsuleId) return null;
  return { assessmentRecordedByAgentId: review.recordedByAgentId, assessmentRecordedByUserId: review.recordedById,
    independentReview: "UNVERIFIED", assessmentWorkroomId: review.workCapsuleId, assessmentWorkroomExecutorRef: reviewerRoom?.executorRef ?? null,
    verificationStatus: sourceValid ? "client-reported-source-checks-passed/full-gate-UNRUN" : "executed-gate-passed",
    bindingDigest: fingerprint({ verification: sourceValid ? source?.payload : ci?.details, review: review.payload,
      verificationUserId: source?.recordedById ?? null, verificationAgentId: source?.recordedByAgentId ?? null,
      reviewerUserId: review.recordedById, reviewerAgentId: review.recordedByAgentId,
      reviewerWorkroomId: review.workCapsuleId, reviewerExecutorRef: reviewerRoom?.executorRef ?? null }) };
}

function validIdentity(value: Record<string, unknown>) {
  const expiry = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
  return value.reviewBasis === "operator-accepted-client-assessment" && nonempty(value.capsuleId) && hash(value.sourceHeadSha, 40) && hash(value.baseTreeHash, 40)
    && hash(value.headTreeHash, 40) && hash(value.diffDigest, 64) && nonempty(value.reason) && value.reason.trim().length >= 20
    && nonempty(value.verificationEvidenceId) && nonempty(value.clientAssessmentActivityId)
    && expiry > Date.now() && expiry <= Date.now() + 24 * 60 * 60 * 1000;
}

function parameterRefusal(params: Record<string, unknown>): ToolResult | null {
  return validIdentity(params) ? null : {
    success: false, error: "review_exemption_refused",
    message: "This exact exception request is malformed, expired, or exceeds the 24-hour limit. Submit a fresh exact request with current source identity and bounded expiry; it still requires the operator's approval.",
  };
}

function exceptionActor(userId: string, context?: ToolExecutionContext) {
  if (!nonempty(userId) || !context?.userContext || (context.userContext.userId && context.userContext.userId !== userId)
    || !can(context.userContext, "manage_platform")) return { refusal: refusal("An authenticated platform operator must authorize this exception.") };
  if (!nonempty(context.agentId)) return { refusal: refusal("The canonical waiver requires an operator-approved delegated call.") };
  return { actor: { userId, agentId: context.agentId } };
}

/** Read-only preparation is repeated after approval; only room identity is
 * fenced at insertion. This does not serialize all configuration/evidence reads. */
async function prepareException(params: Record<string, unknown>, actor: ExceptionActor) {
  const refused = (message: string) => ({ refusal: refusal(message) });
  const malformed = parameterRefusal(params);
  if (malformed) return { refusal: malformed };
  try {
    if (!await isEngineeringDevelopment()) return refused("Exceptions require the development/evolve-dpf installation.");
    const locator = await prisma.workroom.findUnique({ where: { capsuleId: String(params.capsuleId) }, select: { id: true } });
    if (!locator || !await canReadRoom(actor, locator.id)) return refused(scopeRefusal);
    const room = await prisma.workroom.findUnique({ where: { id: locator.id, capsuleId: String(params.capsuleId) },
      select: { id: true, capsuleId: true, repositoryFullName: true, headSha: true, headBranch: true, executorRef: true } });
    if (!room || !room.repositoryFullName || !room.headSha || room.headSha !== params.sourceHeadSha) return refused("The Workroom source identity changed or is incomplete.");
    const value = { ...params, requestingAgentId: actor.agentId, sourceExecutorRef: room.executorRef };
    const bindings = await resolveBindings(value, room.id, actor);
    if (!bindings) return refused("Current executed verification and a separate reviewer record are required within the authorized workroom scope; failed checks remain failed.");
    if (await findCurrentSemanticFailure(room.id, room.headSha)) return refused("A failed current review requires repair.");
    return { prepared: { room, value, bindings } };
  } catch {
    return { refusal: { success: false, error: "authority_evidence_unavailable",
      message: "The current exception prerequisites could not be checked. Restore their availability before submitting this exact request." } satisfies ToolResult };
  }
}

/** Necessary eligibility only: no approval probe, reservation, lock or write. */
export async function preflightSemanticReviewExemption(params: Record<string, unknown>, userId: string, context?: ToolExecutionContext): Promise<ToolResult | null> {
  const malformed = parameterRefusal(params);
  if (malformed) return malformed;
  const actor = exceptionActor(userId, context);
  if (actor.refusal) return actor.refusal;
  const outcome = await prepareException(params, actor.actor);
  return "refusal" in outcome ? outcome.refusal : null;
}

export async function recordSemanticReviewExemption(params: Record<string, unknown>, userId: string, context?: ToolExecutionContext): Promise<ToolResult> {
  const actor = exceptionActor(userId, context);
  if (actor.refusal) return actor.refusal;
  const approval = await humanApprovalForExecution({ envelopeId: context?.approvedAuthorityEnvelopeId,
    toolName: "record_semantic_review_exemption", userId, agentId: actor.actor.agentId, params, requiredApproverCapability: "manage_platform" });
  if (approval?.userId !== userId) return refusal("The delegate needs the existing verified operator approval for this exact exception.");
  const outcome = await prepareException(params, actor.actor);
  if ("refusal" in outcome) return outcome.refusal;
  const { room, value, bindings } = outcome.prepared;
  // Share the room fence with bounded handoff. A final unlocked read leaves
  // a transfer window between the source check and evidence insertion.
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = ${room.id} FOR UPDATE`;
    const finalRoom = await tx.workroom.findUnique({ where: { id: room.id } });
    if (!finalRoom || finalRoom.headSha !== room.headSha || finalRoom.repositoryFullName !== room.repositoryFullName
      || finalRoom.headBranch !== room.headBranch || finalRoom.executorRef !== room.executorRef) {
      return refusal("Workroom identity changed while authorizing the exception.");
    }
    const details = { ...value, ...bindings, schemaVersion: SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION,
      policyVersion: CHANGE_REVIEW_POLICY_VERSION, sourceRepository: room.repositoryFullName, sourceBranch: room.headBranch,
      approvedByUserId: userId, approvalDeciderUserId: approval.approverUserId, approvalOnBehalfOfUserId: approval.onBehalfOf,
      authorityEnvelopeId: approval.envelopeId, authorityInputFingerprint: fingerprintCoworkerInput(params),
      issuedAt: new Date().toISOString(), nativeReview: "UNRUN" };
    const record = await recordExternalEvidenceInStore({ actorUserId: userId, recordedByAgentId: actor.actor.agentId,
      routeContext: "change-review", operationType, target: room.capsuleId, provider: "dpf-change-review", workCapsuleId: room.id,
      resultSummary: "Operator accepted a bounded DEV exception; native review UNRUN, assessment independence UNVERIFIED.", details: details as Prisma.InputJsonValue }, tx);
    return { success: true, entityId: record.id, message: "Publication exception recorded; native review UNRUN and assessment independence UNVERIFIED.", data: { exemption: { ...details, evidenceId: record.id } } };
  }, { isolationLevel: "ReadCommitted" });
}

export async function resolveWorkroomReviewExemption(capsuleId: string, roomId: string, headSha: string) {
  if (!await isEngineeringDevelopment()) return null;
  const room = await prisma.workroom.findUnique({ where: { capsuleId } });
  if (!room || room.id !== roomId || room.headSha !== headSha) return null;
  if (await findCurrentSemanticFailure(roomId, headSha)) return null;
  const rows = await prisma.externalEvidenceRecord.findMany({ where: { workCapsuleId: roomId, operationType }, orderBy: { createdAt: "desc" }, take: 20 });
  for (const row of rows) {
    const value = row.details;
    if (!isRecord(value) || value.sourceHeadSha !== headSha) continue;
    if (!validIdentity(value) || value.capsuleId !== capsuleId || value.schemaVersion !== SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION
      || value.policyVersion !== CHANGE_REVIEW_POLICY_VERSION || value.nativeReview !== "UNRUN"
      || value.sourceRepository !== room.repositoryFullName || value.sourceBranch !== room.headBranch
      || value.sourceExecutorRef !== room.executorRef || value.independentReview !== "UNVERIFIED"
      || !nonempty(value.approvedByUserId) || !nonempty(value.requestingAgentId) || !nonempty(value.authorityEnvelopeId)) return null;
    if (value.requestingAgentId) {
      const approvedInput = Object.fromEntries(inputKeys.map(key => [key, value[key]]));
      const approval = await humanApprovalForConsumption({ envelopeId: String(value.authorityEnvelopeId),
        toolName: "record_semantic_review_exemption", userId: String(value.approvedByUserId),
        agentId: String(value.requestingAgentId), params: approvedInput, requiredApproverCapability: "manage_platform" });
      if (!approval || approval.inputFingerprint !== value.authorityInputFingerprint) return null;
      if ("approvalDeciderUserId" in value || "approvalOnBehalfOfUserId" in value) {
        if (value.approvalDeciderUserId !== approval.approverUserId || value.approvalOnBehalfOfUserId !== approval.onBehalfOf) return null;
      } else if (approval.approverUserId !== value.approvedByUserId || approval.onBehalfOf !== null) return null;
    }
    const bindings = await resolveBindings(value, roomId, { userId: value.approvedByUserId, agentId: value.requestingAgentId });
    if (!bindings || bindings.bindingDigest !== value.bindingDigest || bindings.assessmentRecordedByAgentId !== value.assessmentRecordedByAgentId) return null;
    return { evidenceId: row.id, sourceHeadSha: headSha };
  }
  return null;
}
