import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { readDocumentBlob } from "./documents/blob-storage";
import { validateInitiativeBaselineChainHead } from "./backlog/initiative-readiness/baseline-repository";
import { validInitiativeGateReceipt } from "./backlog/initiative-readiness/receipt-validation";
import { parseInitiativeReviewArtifactRef, parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import { parseReassessmentPolicy, reassessmentPolicyDigest, type ReassessmentPolicy } from "./mcp-task-reassessment-policy";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { readOriginalReviewResult, type OriginalReviewResult } from "./mcp-task-original-result";
import { currentUserContext } from "./govern/current-user-context";
import { can } from "./permissions";
import { expandGrants } from "./tak/agent-grants";
import { resolveAgentWorkroomAccess } from "./work-management/workroom-agent-access.server";
import { collectReviewCreationPredecessors } from "./mcp-task-reassessment-lineage";
import { hasExecutionUncertainty } from "./shared/execution-uncertainty";
import { TASK_IN_FLIGHT_STATES } from "./tak/task-states";

type PolicyDatabase = Pick<Prisma.TransactionClient, "backlogItem" | "backlogItemActivity" | "initiativeArtifactRetentionPin">;
const object = (v: unknown): Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
export class ReviewReassessmentRefusal extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReviewReassessmentRefusal"; }
}
function refuse(code = "reassessment-policy-unproven"): never { throw new ReviewReassessmentRefusal(code); }

/** Every bound review creation, including ordinary/legacy lanes, serializes
 * on the same subject. A reassessment guard must first lock its collected
 * existing TaskRuns in stable order; this helper never locks another task. */
export async function lockInitiativeReviewCreationSubject(tx: Prisma.TransactionClient, rawBinding: unknown): Promise<void> {
  const binding = parseInitiativeReviewBinding(rawBinding);
  if (!binding || !equal(binding, rawBinding)) refuse("reassessment-lineage-unproven");
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${binding.itemId} FOR UPDATE`;
  if (rows.length !== 1) refuse("reassessment-lineage-unproven");
  // Present creation already passed its TaskRun-before-subject admission guard.
  // Ordinary submission cannot erase that policy by omitting its relation or
  // choosing another key, credential family, user or reviewer.
  if (binding.presentReassessment) return;
  for (const predecessor of await collectReviewCreationPredecessors(tx, binding)) {
    const progress = object(predecessor.progressPayload);
    if (predecessor.binding.presentReassessment || Object.hasOwn(progress, "reassessmentQuarantine")
      || hasExecutionUncertainty(predecessor.progressPayload) || (TASK_IN_FLIGHT_STATES as readonly string[]).includes(predecessor.status)) {
      refuse("reassessment-original-recovery-required");
    }
  }
}
export type ApprovedReassessmentPolicy = {
  policy: ReassessmentPolicy; policyDigest: string; baselineId: string; artifactDigest: string;
  authorizationItemId: string;
  authorityArtifact: NonNullable<ReturnType<typeof parseInitiativeReviewArtifactRef>> & { kind: "repo-blob-at-commit" };
  authorizationRowId: string; subjectRowId: string;
};
const retainedPolicyBytes = new WeakMap<ApprovedReassessmentPolicy, Buffer>();

/** Internal read, after normal owner/actor access checks. No candidate is
 * allocated and no provider is called. Only independently approved retained
 * source supplies policy; the locator alone supplies no execution authority. */
export async function readApprovedReassessmentPolicy(input: {
  authorizationItemId: string; subjectItemId: string; userId: string;
}, options: { database?: PolicyDatabase; readBlob?: typeof readDocumentBlob } = {}): Promise<ApprovedReassessmentPolicy> {
  const db = options.database ?? prisma;
  const [authorization, subject] = await Promise.all([
    db.backlogItem.findUnique({ where: { itemId: input.authorizationItemId }, select: { id: true, itemId: true, organizationId: true } }),
    db.backlogItem.findUnique({ where: { itemId: input.subjectItemId }, select: { id: true, itemId: true, organizationId: true } }),
  ]);
  if (!authorization || !subject || authorization.organizationId !== subject.organizationId) refuse();
  const rows = await db.backlogItemActivity.findMany({ where: { backlogItemId: authorization.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }], take: 251, select: { id: true, payload: true } });
  if (!rows.length || rows.length > 250) refuse();
  const baselines = rows.map(row => ({ row, value: object(row.payload) }));
  if (baselines.some(({ value }) => typeof value.baselineId !== "string"
    || value.supersedesBaselineId !== null && typeof value.supersedesBaselineId !== "string")) refuse();
  const superseded = new Set(baselines.map(({ value }) => value.supersedesBaselineId));
  const heads = baselines.filter(({ value }) => !superseded.has(value.baselineId));
  const current = heads.length === 1 ? heads[0]! : null;
  if (!current || !validateInitiativeBaselineChainHead(baselines.map(({ value }) => ({
    baselineId: value.baselineId as string, supersedesBaselineId: value.supersedesBaselineId as string | null,
  })), current.value.baselineId as string).ok) refuse();
  const baseline = current.value;
  const ref = parseInitiativeReviewArtifactRef(baseline.artifactRef);
  if (ref?.kind !== "repo-blob-at-commit" || typeof baseline.approvalReceiptId !== "string"
    || typeof baseline.artifactDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(baseline.artifactDigest)) refuse();
  const [approval, pin] = await Promise.all([
    db.backlogItemActivity.findUnique({ where: { id: baseline.approvalReceiptId }, select: { kind: true, backlogItemId: true, payload: true } }),
    db.initiativeArtifactRetentionPin.findUnique({ where: { baselineActivityId: current.row.id },
      select: { sourceKind: true, artifactDigest: true, artifactLocator: true, documentBlob: { select: { id: true, sha256: true, sizeBytes: true, storageKey: true } } } }),
  ]);
  const receipt = object(approval?.payload);
  if (!approval || approval.kind !== "initiative_gate_receipt" || approval.backlogItemId !== authorization.id
    || !validInitiativeGateReceipt(receipt, { receiptId: baseline.approvalReceiptId, gate: "spec-approval", subject: { kind: "backlog-item", id: authorization.itemId } })
    || receipt.decision !== "pass" || !equal(receipt.artifactRef, ref) || receipt.artifactDigest !== baseline.artifactDigest
    || !pin || pin.sourceKind !== "repository_blob_archive" || !equal(pin.artifactLocator, ref)
    || pin.artifactDigest !== baseline.artifactDigest || !pin.documentBlob || pin.documentBlob.sha256 !== baseline.artifactDigest.slice(7)
    || pin.documentBlob.sizeBytes <= 0 || pin.documentBlob.sizeBytes > 1024 * 1024) refuse();
  const blob = pin.documentBlob;
  let bytes: Buffer;
  try { bytes = await (options.readBlob ?? readDocumentBlob)({ storageKey: blob.storageKey, expectedSha256: blob.sha256 }); }
  catch { return refuse(); }
  if (bytes.length !== blob.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== blob.sha256
    || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== ref.providerBlobId) refuse();
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return refuse(); }
  const policy = parseReassessmentPolicy(source);
  if (!policy || policy.subjectItemId !== subject.itemId) refuse();
  const evidence = await db.backlogItemActivity.findMany({ where: { id: { in: policy.operatorEvidenceActivityIds } },
    select: { id: true, kind: true, backlogItemId: true, recordedById: true } });
  if (evidence.length !== policy.operatorEvidenceActivityIds.length || evidence.some(row => row.kind !== "evidence"
    || row.recordedById !== input.userId || ![authorization.id, subject.id].includes(row.backlogItemId))) refuse();
  const proof: ApprovedReassessmentPolicy = { policy, policyDigest: reassessmentPolicyDigest(policy), baselineId: baseline.baselineId as string,
    artifactDigest: baseline.artifactDigest, authorityArtifact: ref, authorizationItemId: authorization.itemId,
    authorizationRowId: authorization.id, subjectRowId: subject.id };
  retainedPolicyBytes.set(proof, Buffer.from(bytes));
  return Object.freeze(proof);
}

/** Current DB ownership/baseline/retention checks use the pre-Q verified bytes.
 * This never reads files or a source provider while Q/E or row locks are active.
 * A serialized copy cannot stand in for the privately retained source proof. */
export async function revalidateApprovedReassessmentPolicy(tx: PolicyDatabase, proof: ApprovedReassessmentPolicy, userId: string): Promise<void> {
  const bytes = retainedPolicyBytes.get(proof);
  if (!bytes) refuse("reassessment-policy-unproven");
  const fresh = await readApprovedReassessmentPolicy({ authorizationItemId: proof.authorizationItemId,
    subjectItemId: proof.policy.subjectItemId, userId }, { database: tx, readBlob: async () => Buffer.from(bytes) });
  if (!equal(fresh, proof)) refuse("reassessment-policy-changed");
}

export type AuthorizedReassessmentOriginal = {
  gate: "design-spec" | "spec-approval"; taskRunId: string; requestDigest: string; readback: OriginalReviewResult;
};

/** Policy membership comes from the exact saved accepted requests, never
 * caller-supplied predecessor IDs. Both originals remain read-only. */
export async function readAuthorizedReassessmentOriginals(input: {
  proof: ApprovedReassessmentPolicy; userId: string; actingAgentId: string; tokenGrantScopes: readonly string[];
}): Promise<AuthorizedReassessmentOriginal[]> {
  const originals: AuthorizedReassessmentOriginal[] = [];
  for (const requirement of input.proof.policy.requirements) {
    const rows = await prisma.taskRun.findMany({ where: { userId: input.userId,
      a2aMetadata: { path: ["requestDigest"], equals: requirement.originalRequestDigest } },
      take: 2, select: { taskRunId: true } });
    if (rows.length !== 1) refuse("reassessment-lineage-unproven");
    const taskRunId = rows[0]!.taskRunId;
    const readback = await readOriginalReviewResult({ taskRunId, userId: input.userId, actingAgentId: input.actingAgentId,
      tokenGrantScopes: input.tokenGrantScopes, expected: { requestDigest: requirement.originalRequestDigest } });
    const binding = readback?.binding;
    if (!readback || !binding || binding.requestDigest !== requirement.originalRequestDigest
      || binding.gate !== requirement.gate || binding.itemId !== input.proof.policy.subjectItemId
      || binding.artifactRef.kind !== "repo-blob-at-commit" || readback.replayAllowed !== false
      || readback.classification === "receipt-complete") refuse("reassessment-original-readback-required");
    originals.push({ gate: requirement.gate, taskRunId, requestDigest: requirement.originalRequestDigest, readback });
  }
  return originals;
}

/** Pure request construction after authoritative reads. Admission repeats all
 * policy, original, grant and lineage checks; this packet is not a grant. */
export function presentReassessmentPacket(input: {
  packet: Record<string, unknown>; proof: ApprovedReassessmentPolicy; originals: AuthorizedReassessmentOriginal[];
}): Record<string, unknown> {
  const binding = parseInitiativeReviewBinding(input.packet.initiativeReviewBinding);
  const original = input.originals.find(row => row.gate === binding?.gate);
  if (!binding || binding.presentReassessment || binding.writerToolName !== "record_initiative_design_review"
    || binding.itemId !== input.proof.policy.subjectItemId || !binding.workroomRef || !original
    || !equal(binding.artifactRef, original.readback.binding?.artifactRef)) refuse("reassessment-source-changed");
  const present = { schemaVersion: 1 as const, authorizationItemId: input.proof.authorizationItemId,
    baselineId: input.proof.baselineId, policyDigest: input.proof.policyDigest,
    originalTaskRunId: original.taskRunId, originalRequestDigest: original.requestDigest,
    predecessorTaskRunIds: [original.taskRunId], authorityArtifact: input.proof.authorityArtifact };
  const key = createHash("sha256").update(canonicalJson({ itemId: binding.itemId, gate: binding.gate,
    artifactRef: binding.artifactRef, present })).digest("hex");
  return { ...input.packet, requestKey: `review-reassessment-v1-${key}`,
    initiativeReviewBinding: { ...binding, presentReassessment: present } };
}

export async function issuePresentReassessmentRequest(input: {
  packet: Record<string, unknown>; authorizationItemId: string; userId: string; actingAgentId: string;
  tokenGrantScopes: readonly string[];
}): Promise<Record<string, unknown>> {
  const binding = parseInitiativeReviewBinding(input.packet.initiativeReviewBinding);
  if (!binding || !["design-spec", "spec-approval"].includes(binding.gate)) refuse("reassessment-policy-unproven");
  const human = await currentUserContext(input.userId);
  const tokenGrants = expandGrants(input.tokenGrantScopes);
  const agent = await prisma.agent.findUnique({ where: { agentId: input.actingAgentId },
    select: { status: true, archived: true, toolGrants: { select: { grantKey: true } } } });
  const grants = expandGrants(agent?.toolGrants.map(row => row.grantKey) ?? []);
  if (!human || !can(human, "manage_backlog") || !agent || agent.status !== "active" || agent.archived
    || ![grants, tokenGrants].every(values => values.includes("backlog_read") && values.includes("initiative_evidence_write"))) {
    refuse("reassessment-source-access-required");
  }
  const authorization = await prisma.backlogItem.findUnique({ where: { itemId: input.authorizationItemId }, select: { id: true } });
  if (!authorization) refuse("reassessment-policy-unproven");
  const rooms = await prisma.workroom.findMany({ where: { OR: [{ backlogItemId: authorization.id }, { backlogItemId: input.authorizationItemId }], archivedAt: null },
    orderBy: [{ id: "asc" }], take: 21, select: { id: true } });
  if (!rooms.length || rooms.length > 20) refuse("reassessment-source-access-required");
  let mayRead = false;
  for (const room of rooms) {
    const access = await resolveAgentWorkroomAccess({ userId: input.userId, agentId: input.actingAgentId, workroomId: room.id, requested: "content" });
    if (access.decision.level === "content") mayRead = true;
  }
  if (!mayRead) refuse("reassessment-source-access-required");
  const proof = await readApprovedReassessmentPolicy({ authorizationItemId: input.authorizationItemId,
    subjectItemId: binding.itemId, userId: input.userId });
  const originals = await readAuthorizedReassessmentOriginals({ proof, userId: input.userId,
    actingAgentId: input.actingAgentId, tokenGrantScopes: input.tokenGrantScopes });
  return presentReassessmentPacket({ packet: input.packet, proof, originals });
}
