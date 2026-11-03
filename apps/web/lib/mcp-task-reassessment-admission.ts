import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma, type Prisma } from "@dpf/db";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { collectReassessmentLineage, lockReassessmentLineage, revalidateReassessmentLineage } from "./mcp-task-reassessment-lineage";
import { validateReassessmentRuntimeCompatibility } from "./shared/reassessment-owner-versions";
import { validAuditedReassessmentNativeQualification } from "./shared/reassessment-native-composition";
import { captureTaskExecutionFence, sameTaskExecutionFence, taskExecutionEligible } from "./shared/task-execution-fence";
import { reassessmentExecutionManifestDigest, readPersistedReassessmentQualificationPrefix,
  type PersistedReassessmentExecutionInput, type ReassessmentCaptureDatabase } from "./mcp-task-reassessment-capture";
import { deriveReassessmentExecutionSealArtifactId, parseReassessmentExecutionSealV2, parseReassessmentRootLocatorV2,
  validReassessmentBudgetConfiguration, type ReassessmentQualificationManifestV2, type ReassessmentExecutionSealV2 } from "./routing/reassessment-phase-contract";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import type { ApprovedReassessmentPolicy, AuthorizedReassessmentOriginal } from "./mcp-task-review-reassessment";
import type { ReassessmentRuntimeCompatibility } from "./shared/reassessment-owner-versions";
import type { ReassessmentBudgetConfiguration } from "./shared/reassessment-budget-contract";
import type { ReassessmentLineageSnapshot } from "./mcp-task-reassessment-lineage";
import type { ReassessmentQualificationSeedV2, QualifiedReassessmentExecution } from "./routing/reassessment-phase-contract";
export type PresentReassessmentAdmissionInput = {
  parsed: RemoteTaskSubmitParams; taskRunId: string; userId: string; actingAgentId: string; authorityDecisionId: string;
  proof: ApprovedReassessmentPolicy; originals: AuthorizedReassessmentOriginal[];
  candidate: { budgetConfiguration: ReassessmentBudgetConfiguration; bounds: QualifiedReassessmentExecution["bounds"]; nativeObservationUrls: string[] };
  compatibility: ReassessmentRuntimeCompatibility;
};
export type ReassessmentAdmissionAuthorityContext = { proof: ApprovedReassessmentPolicy; originals: AuthorizedReassessmentOriginal[];
  parsed: RemoteTaskSubmitParams; snapshot?: ReassessmentLineageSnapshot; root?: ReassessmentQualificationSeedV2; qualification?: QualifiedReassessmentExecution };
export type ReassessmentAdmissionAuthority = (tx: Prisma.TransactionClient, context: ReassessmentAdmissionAuthorityContext) => Promise<void>;
export class ReassessmentAdmissionJoin extends Error {
  readonly code = "reassessment-existing-assessment";
  constructor(readonly taskRunId: string, readonly requestDigest: string) { super("reassessment-existing-assessment"); }
}
export class ReassessmentAdmissionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReassessmentAdmissionError"; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const hash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const refuse = (code: string): never => { throw new ReassessmentAdmissionError(code); };
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;

function validatePacket(input: Pick<PresentReassessmentAdmissionInput, "parsed" | "proof" | "originals">): void {
  const { parsed, proof, originals } = input, binding = parsed.initiativeReviewBinding, relation = binding?.presentReassessment;
  const normalized = parseRemoteTaskSubmitParams(parsed as unknown as Record<string, unknown>);
  const original = originals.find(row => row.gate === binding?.gate);
  if (typeof normalized === "string" || !equal(normalized, parsed) || !binding?.workroomRef || !relation || !original
    || binding.itemId !== proof.policy.subjectItemId || binding.writerToolName !== "record_initiative_design_review"
    || proof.policy.maxAssessments !== 2 || proof.policy.historicalConsumption !== "retain-unknown" || proof.policy.currentLimits !== "normal-recorded" || proof.policy.originalReplay !== false
    || proof.policy.requirements.length !== 2 || originals.length !== 2
    || proof.policy.requirements.some(requirement => requirement.maxAssessments !== 1 || !originals.some(row => row.gate === requirement.gate && row.requestDigest === requirement.originalRequestDigest))
    || originals.some(row => row.readback.replayAllowed !== false || row.readback.classification === "receipt-complete"
      || row.readback.binding?.requestDigest !== row.requestDigest || row.readback.binding.itemId !== binding.itemId || row.readback.binding.gate !== row.gate)
    || !equal(binding.artifactRef, original.readback.binding?.artifactRef) || relation.originalTaskRunId !== original.taskRunId || relation.originalRequestDigest !== original.requestDigest
    || relation.authorizationItemId !== proof.authorizationItemId || relation.baselineId !== proof.baselineId || relation.policyDigest !== proof.policyDigest
    || !equal(relation.authorityArtifact, proof.authorityArtifact)) return refuse("reassessment-policy-unproven");
  const key = hash({ itemId: binding.itemId, gate: binding.gate, artifactRef: binding.artifactRef, present: relation });
  if (parsed.idempotencyKey !== `review-reassessment-v1-${key}`) refuse("reassessment-packet-changed");
}

function validateCandidate(input: PresentReassessmentAdmissionInput): void {
  const { budgetConfiguration: budget, bounds, nativeObservationUrls: urls } = input.candidate;
  validateReassessmentRuntimeCompatibility(input.compatibility);
  if (!validReassessmentBudgetConfiguration(budget, input.parsed.agentId)
    || Object.keys(bounds).length !== 3 || ![bounds.maxProviderStarts, bounds.maxDurationMs, bounds.maxOutputTokens].every(positive)
    || bounds.maxProviderStarts > 200 || bounds.maxDurationMs > budget.configuredTimeoutMs || bounds.maxOutputTokens > budget.configuredMaxOutputTokens
    || !Array.isArray(urls) || !urls.length || urls.length > bounds.maxProviderStarts || new Set(urls).size !== urls.length
    || !urls.every(value => { try { const url = new URL(value); return url.href === value && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash; } catch { return false; } })) {
    refuse("reassessment-current-bounds-unproven");
  }
}

async function lockedLineage(tx: Prisma.TransactionClient, parsed: RemoteTaskSubmitParams, proof: ApprovedReassessmentPolicy,
  originals: AuthorizedReassessmentOriginal[]): Promise<ReassessmentLineageSnapshot> {
  const subject = await tx.backlogItem.findUnique({ where: { itemId: proof.policy.subjectItemId }, select: { id: true, organizationId: true } });
  if (!subject || subject.id !== proof.subjectRowId) return refuse("reassessment-policy-unproven");
  const snapshot = await collectReassessmentLineage(tx, { binding: parsed.initiativeReviewBinding!, organizationId: subject.organizationId,
    originals: originals.map(row => ({ taskRunId: row.taskRunId, requestDigest: row.requestDigest })) });
  const token = await lockReassessmentLineage(tx, snapshot, [proof.policy.subjectItemId, proof.authorizationItemId]);
  return revalidateReassessmentLineage(tx, token);
}

function existingAssessments(snapshot: ReassessmentLineageSnapshot, parsed: RemoteTaskSubmitParams, ownTaskRunId?: string): void {
  const binding = parsed.initiativeReviewBinding!;
  const present = snapshot.rows.filter(row => row.binding.presentReassessment && row.taskRunId !== ownTaskRunId);
  const matching = present.filter(row => row.binding.gate === binding.gate && equal(row.binding.artifactRef, binding.artifactRef));
  if (matching.length > 1) refuse("reassessment-allocation-limit-exhausted");
  if (matching.length === 1) throw new ReassessmentAdmissionJoin(matching[0]!.taskRunId, matching[0]!.requestDigest);
  if (present.length >= 2) refuse("reassessment-allocation-limit-exhausted");
}

/** The factory is server-only. Neither tool parameters nor a relation DTO can
 * supply this normal-authority callback or an approved retained policy. */
export function createPresentReassessmentAdmission(input: PresentReassessmentAdmissionInput,
  dependencies: { validateAuthority: ReassessmentAdmissionAuthority }) {
  validatePacket(input); validateCandidate(input);
  if (!dependencies.validateAuthority || !input.taskRunId.startsWith("TR-") || !input.userId || !input.actingAgentId || !input.authorityDecisionId) refuse("reassessment-authority-unproven");
  const requestDigest = remoteTaskRequestDigest(input.parsed);
  const prepared = new WeakMap<Prisma.TransactionClient, { snapshot: ReassessmentLineageSnapshot; startedAt: string; deadlineAt: string }>();
  return { requestDigest,
    admissionGuard: async (tx: Prisma.TransactionClient) => {
      const snapshot = await lockedLineage(tx, input.parsed, input.proof, input.originals);
      await dependencies.validateAuthority(tx, { proof: input.proof, originals: input.originals, parsed: input.parsed, snapshot });
      existingAssessments(snapshot, input.parsed);
      const now = Date.now(); prepared.set(tx, { snapshot, startedAt: new Date(now).toISOString(), deadlineAt: new Date(now + input.candidate.bounds.maxDurationMs).toISOString() });
    },
    afterTaskCreated: async (tx: Prisma.TransactionClient, run: { id: string; taskRunId: string; contextId: string | null }) => {
      const reserved = prepared.get(tx); prepared.delete(tx);
      if (!reserved || run.taskRunId !== input.taskRunId || Date.now() >= Date.parse(reserved.deadlineAt)) return refuse("reassessment-admission-transaction-unproven");
      const row = await tx.taskRun.findUnique({ where: { taskRunId: run.taskRunId } });
      const metadata = object(row?.a2aMetadata) ? row.a2aMetadata : null;
      const fence = captureTaskExecutionFence(row?.progressPayload, requestDigest);
      if (!row || row.id !== run.id || row.userId !== input.userId || row.currentAgentId !== input.parsed.agentId || row.status !== "working"
        || !metadata || metadata.trigger !== "external-mcp" || metadata.requestDigest !== requestDigest || !equal(metadata.initiativeReviewBinding, input.parsed.initiativeReviewBinding)
        || Object.hasOwn(metadata, "reassessmentExecution") || !fence || fence.reservation !== null || fence.dispatchClaim !== null || fence.authorityDigest !== null
        || !taskExecutionEligible({ status: row.status, progressPayload: row.progressPayload, requestDigest, executionFence: fence })) return refuse("reassessment-initial-generation-unproven");
      const root: ReassessmentQualificationManifestV2 = { schemaVersion: 2, phase: "qualification", taskRunId: run.taskRunId,
        userId: row.userId, agentId: input.parsed.agentId, requestDigest, executionFence: fence, binding: input.parsed.initiativeReviewBinding!,
        budgetConfiguration: input.candidate.budgetConfiguration, bounds: input.candidate.bounds, nativeObservationUrls: input.candidate.nativeObservationUrls,
        compatibility: input.compatibility, startedAt: reserved.startedAt, deadlineAt: reserved.deadlineAt };
      const locator = { schemaVersion: 2 as const, manifestArtifactId: `ta-reassessment-root-${hash({ taskRunId: run.taskRunId, requestDigest })}`,
        manifestDigest: reassessmentExecutionManifestDigest(root) };
      await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId: locator.manifestArtifactId, taskRunId: run.id,
        name: "reassessment-qualification-root-v2", parts: json([{ type: "reassessment-qualification-root-v2", mimeType: "application/json", data: root }]),
        metadata: json({ schemaVersion: 2, authorityDecisionId: input.authorityDecisionId, actingAgentId: input.actingAgentId,
          lineage: { fingerprint: reserved.snapshot.fingerprint, taskRunIds: reserved.snapshot.rows.map(row => row.taskRunId) } }), producerAgentId: input.parsed.agentId } });
      const updated = await tx.taskRun.updateMany({ where: { id: run.id, status: row.status, a2aMetadata: { equals: json(metadata) } },
        data: { a2aMetadata: json({ ...metadata, reassessmentExecution: locator }) } });
      if (updated.count !== 1) return refuse("reassessment-initial-generation-changed");
      await tx.taskMessage.create({ data: { id: randomUUID(), messageId: randomUUID(), taskRunId: run.id, contextId: row.contextId ?? run.contextId ?? run.taskRunId,
        role: "user", parts: json([{ type: "message", text: input.parsed.prompt }]), referenceTaskIds: [] } });
    },
  };
}

export type PresentReassessmentSealInput = { persistedInput: PersistedReassessmentExecutionInput; parsed: RemoteTaskSubmitParams;
  proof: ApprovedReassessmentPolicy; originals: AuthorizedReassessmentOriginal[]; qualification: QualifiedReassessmentExecution; authorityDecisionId: string };

/** Promotion persists an additive seal on the already allocated root. It can
 * neither allocate another TaskRun nor refill any counter or deadline. */
export async function sealPresentReassessmentExecution(input: PresentReassessmentSealInput,
  dependencies: { database?: ReassessmentCaptureDatabase; validateAuthority: ReassessmentAdmissionAuthority }): Promise<ReassessmentExecutionSealV2> {
  validatePacket(input);
  const { persistedInput: execution, qualification } = input;
  const locator = parseReassessmentRootLocatorV2(object(execution.a2aMetadata) ? execution.a2aMetadata.reassessmentExecution : null);
  if (!locator || !dependencies.validateAuthority || !input.authorityDecisionId || remoteTaskRequestDigest(input.parsed) !== execution.requestDigest
    || !equal(execution.binding, input.parsed.initiativeReviewBinding) || !validAuditedReassessmentNativeQualification(qualification)) {
    return refuse("reassessment-execution-seal-unproven");
  }
  return (dependencies.database ?? prisma).$transaction(async tx => {
    const snapshot = await lockedLineage(tx, input.parsed, input.proof, input.originals);
    const member = snapshot.rows.find(row => row.id === execution.taskRunRecordId && row.taskRunId === execution.taskRunId);
    if (!member || member.requestDigest !== execution.requestDigest || !equal(member.binding, execution.binding)) return refuse("reassessment-lineage-unproven");
    existingAssessments(snapshot, input.parsed, execution.taskRunId);
    const row = await tx.taskRun.findUnique({ where: { taskRunId: execution.taskRunId } });
    const metadata = object(row?.a2aMetadata) ? row.a2aMetadata : null;
    const stored = await tx.taskArtifact.findUnique({ where: { artifactId: locator.manifestArtifactId } });
    const part = Array.isArray(stored?.parts) && stored.parts.length === 1 && object(stored.parts[0]) ? stored.parts[0] : null;
    const data = part?.data;
    if (!row || row.id !== execution.taskRunRecordId || row.userId !== execution.userId || row.currentAgentId !== execution.agentId
      || !metadata || !equal(metadata.reassessmentExecution, locator) || !equal(metadata.initiativeReviewBinding, execution.binding)
      || metadata.requestDigest !== execution.requestDigest || !taskExecutionEligible({ status: row.status, progressPayload: row.progressPayload,
        requestDigest: execution.requestDigest, executionFence: execution.executionFence })
      || !stored || stored.taskRunId !== row.id || stored.producerAgentId !== execution.agentId || part?.type !== "reassessment-qualification-root-v2"
      || !object(data) || reassessmentExecutionManifestDigest(data as ReassessmentQualificationManifestV2) !== locator.manifestDigest
      || data.schemaVersion !== 2 || data.phase !== "qualification" || data.taskRunId !== row.taskRunId || data.userId !== execution.userId || data.agentId !== execution.agentId
      || data.requestDigest !== execution.requestDigest || !sameTaskExecutionFence(data.executionFence, execution.executionFence) || !equal(data.binding, execution.binding)
      || !equal(data.budgetConfiguration, qualification.budgetConfiguration) || !equal(data.bounds, qualification.bounds)
      || typeof data.deadlineAt !== "string" || Date.now() >= Date.parse(data.deadlineAt)) return refuse("reassessment-execution-seal-unproven");
    const root = { ...data, manifest: { artifactId: locator.manifestArtifactId, digest: locator.manifestDigest } } as ReassessmentQualificationSeedV2;
    validateReassessmentRuntimeCompatibility(root.compatibility);
    const prefix = await readPersistedReassessmentQualificationPrefix(tx, execution, locator);
    const sealArtifactId = deriveReassessmentExecutionSealArtifactId({ taskRunId: execution.taskRunId, rootArtifactId: locator.manifestArtifactId, rootDigest: locator.manifestDigest });
    const prior = await tx.taskArtifact.findUnique({ where: { artifactId: sealArtifactId } });
    await dependencies.validateAuthority(tx, { proof: input.proof, originals: input.originals, parsed: input.parsed, snapshot, root, qualification });
    if (prior) {
      const priorPart = Array.isArray(prior.parts) && prior.parts.length === 1 && object(prior.parts[0]) ? prior.parts[0] : null;
      const seal = parseReassessmentExecutionSealV2(priorPart?.data);
      if (!seal || prior.taskRunId !== row.id || prior.producerAgentId !== execution.agentId || prior.name !== "reassessment-execution-seal-v2"
        || priorPart?.type !== "reassessment-execution-seal-v2" || !equal(seal.root, locator) || !equal(seal.qualificationPrefix, prefix)
        || !equal(seal.qualification, qualification) || !equal(seal.binding, execution.binding) || !sameTaskExecutionFence(seal.executionFence, execution.executionFence)
        || seal.taskRunId !== execution.taskRunId || seal.userId !== execution.userId || seal.agentId !== execution.agentId || seal.requestDigest !== execution.requestDigest) {
        return refuse("reassessment-execution-seal-unproven");
      }
      return seal;
    }
    const seal = parseReassessmentExecutionSealV2({ schemaVersion: 2, root: locator, taskRunId: execution.taskRunId,
      userId: execution.userId, agentId: execution.agentId, requestDigest: execution.requestDigest, executionFence: execution.executionFence,
      binding: execution.binding, qualificationPrefix: prefix, qualification, authorityDecisionId: input.authorityDecisionId, sealedAt: new Date().toISOString() });
    if (!seal) return refuse("reassessment-execution-seal-unproven");
    await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId: sealArtifactId, taskRunId: row.id, name: "reassessment-execution-seal-v2",
      producerAgentId: execution.agentId, parts: json([{ type: "reassessment-execution-seal-v2", mimeType: "application/json", data: seal }]),
      metadata: json({ schemaVersion: 2, root: locator, lineageFingerprint: snapshot.fingerprint }) } });
    const binding = input.parsed.initiativeReviewBinding!;
    // The second authorized requirement shares allocation accounting, but its
    // current assessment is not a predecessor of this requirement.
    const quarantine = snapshot.rows.filter(value => value.id !== row.id && !value.binding.presentReassessment
      && value.binding.gate === binding.gate && equal(value.binding.artifactRef, binding.artifactRef));
    const linked = new Set(quarantine.flatMap(value => [value.id, value.taskRunId]));
    for (let prior = -1; prior !== linked.size;) {
      prior = linked.size;
      for (const value of snapshot.rows) {
        if (value.id === row.id || value.binding.presentReassessment) continue;
        if (linked.has(value.id) || linked.has(value.taskRunId) || value.parentTaskRunId && linked.has(value.parentTaskRunId)) {
          linked.add(value.id); linked.add(value.taskRunId);
          if (value.parentTaskRunId) linked.add(value.parentTaskRunId);
        }
      }
    }
    for (const predecessor of snapshot.rows.filter(value => value.id !== row.id && !value.binding.presentReassessment && (linked.has(value.id) || linked.has(value.taskRunId)))) {
      if (predecessor.progressPayload !== null && !object(predecessor.progressPayload)) return refuse("reassessment-lineage-unproven");
      const progress = object(predecessor.progressPayload) ? predecessor.progressPayload : {};
      const marker = { schemaVersion: 1, kind: "present-reassessment-quarantine", executionSealArtifactId: sealArtifactId,
        root: locator, replayAllowed: false, recordedAt: seal.sealedAt };
      // Keep all original uncertainty, waits, attempts, limits and generation
      // markers byte-for-byte. Quarantine is a new hold, never settlement.
      const next = { ...progress, reassessmentQuarantine: progress.reassessmentQuarantine ?? marker };
      const terminal = ["completed", "canceled", "rejected", "archived"].includes(predecessor.status);
      await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId: `ta-reassessment-quarantine-${hash({ sealArtifactId, predecessor: predecessor.id })}`,
        taskRunId: predecessor.id, producerAgentId: execution.agentId, name: "reassessment-predecessor-quarantine-v2",
        parts: json([{ type: "reassessment-predecessor-quarantine-v2", mimeType: "application/json", data: { taskRunId: predecessor.taskRunId,
          requestDigest: predecessor.requestDigest, priorStatus: predecessor.status, priorProgressPayload: predecessor.progressPayload, marker } }]) } });
      const updated = await tx.taskRun.updateMany({ where: { id: predecessor.id, status: predecessor.status, a2aMetadata: { equals: json(predecessor.a2aMetadata) } },
        data: { ...(terminal ? {} : { status: "input-required" }), progressPayload: json(next) } });
      if (updated.count !== 1) return refuse("reassessment-predecessor-changed");
    }
    return seal;
  });
}
