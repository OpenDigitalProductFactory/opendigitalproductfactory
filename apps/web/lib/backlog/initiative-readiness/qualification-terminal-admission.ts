import { prisma } from "@dpf/db";

import { isSemanticReviewReceipt } from "@/lib/change-review/semantic-change-review";
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { resolveFederationIdentity } from "@/lib/federation/demand-identity";
import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { readRepositoryProviderBlob } from "./repository-artifact";
import { resolveQualificationLeasePrincipalId } from "./qualification-admission-ownership";
import {
  createQualificationExperimentAdmission,
  parseQualificationCandidateEvidence,
  parseQualificationExperimentState,
  qualificationExecutorAttestationAvailable,
  qualificationBindingDigest,
  verifyQualificationExperimentAdmission,
  type QualificationExperimentBinding,
} from "./qualification-research-admission";

export type QualificationAdmissionRoute = {
  toolName: "claim_workroom_scope";
  workroomId: string;
  qualificationAdmissionToken: string;
  bindingDigest: string;
  binding: QualificationExperimentBinding;
};

type QualificationAdmissionDb = Pick<typeof prisma,
  "backlogItem" | "workroom" | "workroomActivity" | "externalEvidenceRecord">;

type QualificationProtocol = {
  targetProductionBlobIds: string[];
  allowedPaths: string[];
  executorMode: "sandbox-build" | "workroom-host";
  requiredPlatform: "linux" | "win32";
};

function bodyMatch(body: string, expression: RegExp): string | null {
  return expression.exec(body)?.[1]?.trim() ?? null;
}

/** Parse only the values the signed binding uses. Mutable backlog prose can
 * locate the protocol, but can no longer supply its production or write scope.
 */
export function parseQualificationProtocol(bytes: Uint8Array, itemId: string): QualificationProtocol | null {
  const text = Buffer.from(bytes).toString("utf8");
  const productionBlob = bodyMatch(text, /(?:writer blob is|same blob,)\s*([a-f0-9]{40})/i);
  const allowedPath = bodyMatch(text, /(scripts\/[A-Za-z0-9._/-]+\.test\.[A-Za-z0-9]+)/i);
  if (!text.includes(itemId) || !/qualification-only/i.test(text) || !productionBlob || !allowedPath) return null;
  const requiresWindows = /\bWindows\b/i.test(text);
  return {
    targetProductionBlobIds: [productionBlob],
    allowedPaths: [allowedPath],
    executorMode: requiresWindows ? "workroom-host" : "sandbox-build",
    requiredPlatform: requiresWindows ? "win32" : "linux",
  };
}

function isIndependentPassReview(
  details: unknown,
  capsuleId: string,
  headSha: string,
  currentAgentId: string,
  diffDigest?: string,
): boolean {
  if (!isSemanticReviewReceipt(details)
    || details.artifactType !== "code-change"
    || details.capsuleId !== capsuleId
    || details.disposition !== "reviewed"
    || details.result.decision !== "pass"
    || details.result.issues.length !== 0
    || details.sourceHeadSha?.toLowerCase() !== headSha.toLowerCase()
    || (diffDigest !== undefined && details.diffDigest !== diffDigest)
    || details.specialistIds.length === 0) return false;
  const currentAuthorityId = coworkerAuthorityAgentId(currentAgentId);
  return details.specialistIds.every((specialistId) =>
    coworkerAuthorityAgentId(specialistId) !== currentAuthorityId);
}

function selectIndependentPassReview(
  receipts: Array<{ id: string; details: unknown }>,
  input: { capsuleId: string; headSha: string; currentAgentId: string; diffDigest?: string; receiptId?: string },
) {
  const sameHead = receipts.filter((row) => isSemanticReviewReceipt(row.details)
    && row.details.artifactType === "code-change"
    && row.details.capsuleId === input.capsuleId
    && row.details.sourceHeadSha?.toLowerCase() === input.headSha.toLowerCase());
  // A failed review of this immutable head is terminal until the head changes;
  // never revive an older pass for the same artifact.
  if (sameHead.some((row) => isSemanticReviewReceipt(row.details)
    && row.details.result.decision === "fail")) return null;
  return sameHead.find((row) => (!input.receiptId || row.id === input.receiptId)
    && isIndependentPassReview(row.details, input.capsuleId, input.headSha,
      input.currentAgentId, input.diffDigest)) ?? null;
}

/** Server-side qualification issuer. Every mutable pointer is checked against
 * an exact independent semantic review and then re-read from the provider.
 */
export async function resolveQualificationAdmission(args: {
  itemId: string; refusedWorkroomId: string | null; currentAgentId: string | null;
}, ports: {
  db?: QualificationAdmissionDb;
  now?: () => Date;
  readBlob?: typeof readRepositoryProviderBlob;
  resolveIdentity?: typeof resolveFederationIdentity;
  resolveLeasePrincipalId?: typeof resolveQualificationLeasePrincipalId;
  resolveShape?: typeof resolveWorkShapeClaim;
} = {}): Promise<QualificationAdmissionRoute | null> {
  if (!args.refusedWorkroomId || !args.currentAgentId) return null;
  const db = ports.db ?? prisma;
  const issuedAt = (ports.now ?? (() => new Date()))();
  const [item, room, identity, agentPrincipalId] = await Promise.all([
    db.backlogItem.findUnique({ where: { itemId: args.itemId }, select: { id: true, itemId: true, body: true } }),
    db.workroom.findUnique({ where: { capsuleId: args.refusedWorkroomId }, select: {
      id: true, capsuleId: true, status: true, archivedAt: true, backlogItemId: true,
      repositoryFullName: true, headBranch: true, baseSha: true, headSha: true,
      scopeClaims: true, leaseHolderPrincipalId: true, leaseExpiresAt: true, workspaceState: true,
    } }),
    (ports.resolveIdentity ?? resolveFederationIdentity)(db as never),
    (ports.resolveLeasePrincipalId ?? resolveQualificationLeasePrincipalId)(db as never, args.currentAgentId),
  ]);
  if (!item?.body || !room || room.status !== "working" || room.archivedAt !== null
    || room.backlogItemId !== args.itemId || !room.repositoryFullName || !room.headBranch
    || !room.baseSha || !room.headSha || !room.leaseExpiresAt || room.leaseExpiresAt <= issuedAt
    || !agentPrincipalId || room.leaseHolderPrincipalId !== agentPrincipalId) return null;

  const path = bodyMatch(item.body, /Canonical design is now published at\s+([^\s]+\.md)/i);
  const commitSha = bodyMatch(item.body, /signed commit\s+([a-f0-9]{40})/i);
  const providerBlobId = bodyMatch(item.body, /blob\s+([a-f0-9]{40})/i);
  if (!path || !commitSha || !providerBlobId) return null;

  const protocolBytes = await (ports.readBlob ?? readRepositoryProviderBlob)({
    repositoryFullName: room.repositoryFullName, commitSha, path, expectedBlobId: providerBlobId,
  });
  if (!protocolBytes.ok) return null;
  const protocol = parseQualificationProtocol(protocolBytes.data, args.itemId);
  const shape = (ports.resolveShape ?? resolveWorkShapeClaim)(room.scopeClaims);
  const stage = shape?.stages.find((candidate) => candidate.key === "reproduce") ?? shape?.stages[0];
  if (!protocol || !shape || !stage) return null;
  // Preserve protocol parsing for audit/recovery, but do not issue a new
  // qualification until the responsible runner supplies exact provenance.
  if (!qualificationExecutorAttestationAvailable(protocol.executorMode)) return null;

  const receipts = await db.externalEvidenceRecord.findMany({ where: {
    workCapsuleId: room.id, operationType: "semantic-change-review.receipt",
  }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, details: true } });

  // This decision proves independent approval of the immutable protocol. It is
  // deliberately not treated as current execution authority: the
  // claim_workroom_scope MCP boundary re-evaluates the current human/token
  // intersection, and the scheduled mandate re-reads the current agent grants
  // immediately before every admitted tool effect.

  const workspace = room.workspaceState && typeof room.workspaceState === "object" && !Array.isArray(room.workspaceState)
    ? room.workspaceState as Record<string, unknown> : {};
  const state = parseQualificationExperimentState(workspace.qualificationExperimentAdmission);
  if (workspace.qualificationExperimentAdmission !== undefined && !state) return null;
  // Preparation is authored at the approved protocol head. Verification keeps
  // that immutable protocol binding while the live room advances to the
  // separately reviewed candidate head.
  if (!state && commitSha.toLowerCase() !== room.headSha.toLowerCase()) return null;
  if (state) {
    if (state.status !== "settled" || !state.evidenceId) return null;
    const prior = verifyQualificationExperimentAdmission(state.token, { now: issuedAt, allowExpired: true });
    if (!prior.ok || prior.data.binding.phase !== "prepare") return null;
    const protocolReview = selectIndependentPassReview(receipts, { capsuleId: room.capsuleId,
      headSha: commitSha, currentAgentId: args.currentAgentId!,
      receiptId: prior.data.binding.protocolReviewReceiptId });
    if (!protocolReview) return null;
    const evidence = await db.workroomActivity.findUnique({ where: { id: state.evidenceId }, select: { payload: true } });
    const evidencePayload = evidence?.payload && typeof evidence.payload === "object" && !Array.isArray(evidence.payload)
      ? evidence.payload as Record<string, unknown> : null;
    const candidate = parseQualificationCandidateEvidence(evidencePayload?.result, prior.data.binding);
    if (!candidate.ok || candidate.data.headSha.toLowerCase() !== room.headSha.toLowerCase()) return null;
    const review = selectIndependentPassReview(receipts, { capsuleId: room.capsuleId,
      headSha: candidate.data.headSha, currentAgentId: args.currentAgentId!,
      diffDigest: candidate.data.diffDigest });
    if (!review) return null;
    const binding: QualificationExperimentBinding = {
      ...prior.data.binding, phase: "verify", headSha: candidate.data.headSha,
      protocolReviewReceiptId: protocolReview.id, stageKey: stage.key,
      permittedTools: prior.data.binding.executorMode === "workroom-host"
        ? ["read_source_at_version", "read_codebase_manifest", "record_execution_evidence", "record_workroom_evidence"]
        : ["read_source_at_version", "read_codebase_manifest", "run_sandbox_tests", "record_workroom_evidence"],
      issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 30 * 60_000).toISOString(),
      candidate: { ...candidate.data, reviewReceiptId: review.id },
    };
    return { toolName: "claim_workroom_scope", workroomId: room.capsuleId,
      qualificationAdmissionToken: createQualificationExperimentAdmission(binding),
      bindingDigest: qualificationBindingDigest(binding), binding };
  }
  const protocolReview = selectIndependentPassReview(receipts, { capsuleId: room.capsuleId,
    headSha: commitSha, currentAgentId: args.currentAgentId! });
  if (!protocolReview) return null;
  const binding: QualificationExperimentBinding = {
    schemaVersion: 1, phase: "prepare", itemId: args.itemId, workroomId: room.capsuleId,
    repositoryFullName: room.repositoryFullName, baseSha: room.baseSha, headSha: room.headSha,
    protocol: { path, commitSha, providerBlobId }, installationId: identity.installationId,
    accountablePrincipalRef: room.leaseHolderPrincipalId!, protocolReviewReceiptId: protocolReview.id,
    shapeKey: shape.key, shapeVersion: shape.version, stageKey: stage.key, policyVersion: 1,
    targetProductionBlobIds: protocol.targetProductionBlobIds,
    executorMode: protocol.executorMode, requiredPlatform: protocol.requiredPlatform,
    permittedTools: protocol.executorMode === "workroom-host"
      ? ["read_source_at_version", "read_codebase_manifest", "record_workroom_evidence"]
      : ["read_source_at_version", "read_codebase_manifest", "write_sandbox_file", "edit_sandbox_file", "record_workroom_evidence"],
    allowedPaths: protocol.allowedPaths, issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 30 * 60_000).toISOString(), maxStarts: 1, maxDurationMs: 15 * 60_000,
  };
  return { toolName: "claim_workroom_scope", workroomId: room.capsuleId,
    qualificationAdmissionToken: createQualificationExperimentAdmission(binding),
    bindingDigest: qualificationBindingDigest(binding), binding };
}
