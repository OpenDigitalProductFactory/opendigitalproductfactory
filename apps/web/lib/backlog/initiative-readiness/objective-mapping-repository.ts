import { randomUUID } from "node:crypto";

import { Prisma, prisma } from "@dpf/db";

import {
  validateObjectiveMappingRequestKey,
  type ObjectiveMappingBinding,
} from "@/lib/mcp-task-objective-mapping-request-key";
import {
  parseInitiativeReviewBinding,
  requiredToolNames as requiredToolNamesFromScope,
  validateInitiativeReviewAuthorityScope,
} from "@/lib/mcp-task-review-contract";
import {
  err,
  ok,
  type ActionFailure,
  type ActionSuccess,
} from "@/lib/shared/action-result";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";

import { validateInitiativeBaselineChainHead } from "./baseline-repository";
import {
  MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES,
  reconcileInitiativeObjectives,
  selectEligibleObjectiveEvidenceActivityIds,
} from "./objective-reconciliation";

export type InitiativeObjectiveMapping = {
  objectiveId: string;
  evidenceRefs: string[];
};

export type InitiativeObjectiveMappingProposal = {
  schemaVersion: 1;
  proposalId: string;
  subject: { kind: "backlog-item"; id: string };
  baselineId: string;
  artifactDigest: string;
  mappings: InitiativeObjectiveMapping[];
  eligibleEvidenceActivityIds: string[];
  proposerPrincipalId: string;
  proposerAgentId: string;
  authorityDecisionId: string;
  authoritySnapshot: {
    decision: "allow";
    effectiveHumanCapability: "manage_backlog";
    effectiveAgentGrant: "initiative_evidence_write";
    tokenScope: string;
    organizationId: string;
    actionKey: "record_initiative_evidence";
    policyVersion: string;
  };
  reason: string;
};

export type InitiativeObjectiveMappingResult =
  | { ok: true; proposalId: string; proposal: InitiativeObjectiveMappingProposal }
  | { ok: false; code: string; error: string };

type BaselinePayload = {
  schemaVersion: 1;
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactDigest: string;
  subject: { kind: "backlog-item"; id: string };
  objectiveStatements: Array<{ objectiveId: string }>;
  acceptanceStatements: Array<{ acceptanceId: string }>;
  artifactRef?: ObjectiveMappingBinding["artifactRef"];
};

function parseBaseline(value: unknown): BaselinePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const subject = object(row.subject);
  if (row.schemaVersion !== 1
    || typeof row.baselineId !== "string"
    || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")
    || typeof row.artifactDigest !== "string"
    || subject?.kind !== "backlog-item"
    || typeof subject.id !== "string"
    || !Array.isArray(row.objectiveStatements)
    || !row.objectiveStatements.every((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).objectiveId === "string")
    || !Array.isArray(row.acceptanceStatements)
    || !row.acceptanceStatements.every((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).acceptanceId === "string")) {
    return null;
  }
  const statementIds = [
    ...row.objectiveStatements.map((entry) => (entry as Record<string, unknown>).objectiveId as string),
    ...row.acceptanceStatements.map((entry) => (entry as Record<string, unknown>).acceptanceId as string),
  ];
  if (statementIds.length === 0 || new Set(statementIds).size !== statementIds.length) return null;
  const artifact = object(row.artifactRef);
  const artifactRef = artifact?.kind === "repo-blob-at-commit"
    && typeof artifact.repositoryFullName === "string"
    && typeof artifact.commitSha === "string"
    && typeof artifact.path === "string"
    && typeof artifact.providerBlobId === "string"
    ? {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: artifact.repositoryFullName,
        commitSha: artifact.commitSha,
        path: artifact.path,
        providerBlobId: artifact.providerBlobId,
      }
    : undefined;
  return {
    ...row,
    ...(artifactRef ? { artifactRef } : {}),
  } as unknown as BaselinePayload;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.some((entry) => typeof entry !== "string" || !entry.trim())
    || right.some((entry) => typeof entry !== "string" || !entry.trim())) return false;
  const normalizedLeft = [...new Set(left.map((entry) => entry.trim()))].sort();
  const normalizedRight = [...new Set(right.map((entry) => entry.trim()))].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((entry, index) => entry === normalizedRight[index]);
}

function exactArtifactRef(
  left: ObjectiveMappingBinding["artifactRef"],
  right: ObjectiveMappingBinding["artifactRef"],
): boolean {
  return left.kind === right.kind
    && left.repositoryFullName.toLocaleLowerCase("en-US") === right.repositoryFullName.toLocaleLowerCase("en-US")
    && left.commitSha.toLocaleLowerCase("en-US") === right.commitSha.toLocaleLowerCase("en-US")
    && left.path === right.path
    && left.providerBlobId.toLocaleLowerCase("en-US") === right.providerBlobId.toLocaleLowerCase("en-US");
}

async function validateExecutingObjectiveMappingTask(args: {
  tx: Prisma.TransactionClient;
  taskRunId: string;
  itemId: string;
  itemRowId: string;
  proposerUserId: string;
  proposerAgentId: string;
  baselineId: string;
  eligibleEvidenceActivityIds: string[];
}): Promise<ActionSuccess<{ binding: ObjectiveMappingBinding }> | (
  ActionFailure & { code: string }
)> {
  await args.tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${args.taskRunId} FOR SHARE`;
  const run = await args.tx.taskRun.findUnique({
    where: { taskRunId: args.taskRunId },
    select: {
      taskRunId: true,
      userId: true,
      currentAgentId: true,
      status: true,
      completedAt: true,
      archivedAt: true,
      title: true,
      objective: true,
      authorityScope: true,
      a2aMetadata: true,
    },
  });
  const metadata = object(run?.a2aMetadata);
  const binding = parseInitiativeReviewBinding(metadata?.initiativeReviewBinding);
  const requestKey = nonEmptyString(metadata?.idempotencyKey);
  const requestedAgentId = nonEmptyString(metadata?.requestedAgentId);
  const requestObjective = nonEmptyString(metadata?.requestObjective);
  const title = nonEmptyString(run?.title);
  const authorityScope = Array.isArray(run?.authorityScope)
    && run.authorityScope.every((entry) => typeof entry === "string")
    ? run.authorityScope as string[]
    : null;
  if (!run || run.status !== "working" || run.completedAt !== null || run.archivedAt !== null
    || metadata?.trigger !== "external-mcp" || !binding || !requestKey
    || !requestedAgentId || !requestObjective || !title || !authorityScope
    || binding.gate !== "objective-mapping" || binding.writerToolName !== "record_initiative_evidence"
    || binding.itemId !== args.itemId || binding.expectedCurrentBaselineId !== args.baselineId
    || !binding.workroomRef || !binding.eligibleEvidenceActivityIds
    || run.userId !== args.proposerUserId
    || requestedAgentId !== args.proposerAgentId || run.currentAgentId !== requestedAgentId
    || validateInitiativeReviewAuthorityScope(binding, authorityScope)
    || !exactStringSet(binding.eligibleEvidenceActivityIds, args.eligibleEvidenceActivityIds)) {
    const error = "The executing TaskRun does not carry the exact current server-issued objective-mapping authority.";
    return { ...err(error), code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT" };
  }

  const requiredToolNames = requiredToolNamesFromScope(authorityScope);
  if (!validateObjectiveMappingRequestKey({
    targetAgent: requestedAgentId,
    objective: requestObjective,
    questionPacketSummary: title,
    requiredToolNames,
    requestKey,
    binding: binding as ObjectiveMappingBinding,
  })) {
    const error = "The executing TaskRun request key is not the server-derived identity for its immutable packet.";
    return { ...err(error), code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT" };
  }

  await args.tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "capsuleId" = ${binding.workroomRef.workroomId} FOR SHARE`;
  const room = await args.tx.workroom.findUnique({
    where: { capsuleId: binding.workroomRef.workroomId },
    select: {
      capsuleId: true,
      backlogItemId: true,
      repositoryFullName: true,
      headBranch: true,
      headSha: true,
      archivedAt: true,
    },
  });
  if (!room || room.archivedAt !== null
    || (room.backlogItemId !== args.itemId && room.backlogItemId !== args.itemRowId)
    || room.repositoryFullName?.toLocaleLowerCase("en-US") !== binding.workroomRef.repositoryFullName.toLocaleLowerCase("en-US")
    || room.headBranch !== binding.workroomRef.branchName
    || room.headSha?.toLocaleLowerCase("en-US") !== binding.workroomRef.headSha.toLocaleLowerCase("en-US")) {
    const error = "The executing TaskRun no longer matches the current live Workroom identity.";
    return { ...err(error), code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT" };
  }
  const liveness = await loadCapsuleLivenessInventory(args.tx, {
    where: { capsuleId: binding.workroomRef.workroomId },
    take: 2,
  });
  if (liveness.capsulesAll.length !== 1 || liveness.capsulesAll[0]?.isLive !== true) {
    const error = "The executing TaskRun no longer matches the current live Workroom identity.";
    return { ...err(error), code: "OBJECTIVE_MAPPING_AUTHORITY_CONFLICT" };
  }
  return ok({ binding: binding as ObjectiveMappingBinding });
}

export function normalizeInitiativeObjectiveMappings(
  mappings: readonly InitiativeObjectiveMapping[],
  objectiveIds: ReadonlySet<string>,
): InitiativeObjectiveMapping[] | null {
  const seen = new Set<string>();
  const normalized: InitiativeObjectiveMapping[] = [];
  for (const mapping of mappings) {
    const objectiveId = mapping.objectiveId?.trim();
    if (!objectiveId || seen.has(objectiveId) || !objectiveIds.has(objectiveId)
      || !Array.isArray(mapping.evidenceRefs) || mapping.evidenceRefs.length === 0
      || mapping.evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim())) return null;
    seen.add(objectiveId);
    normalized.push({ objectiveId, evidenceRefs: [...new Set(mapping.evidenceRefs.map((ref) => ref.trim()))].sort() });
  }
  return normalized.length > 0 ? normalized : null;
}

export async function recordInitiativeObjectiveMappingProposal(args: {
  taskRunId: string | null;
  itemId: string;
  baselineId: string;
  mappings: InitiativeObjectiveMapping[];
  eligibleEvidenceActivityIds: string[];
  reason: string;
  proposerUserId: string;
  proposerAgentId: string | null;
  authorityDecisionId: string | null;
  tokenScope: string | null;
}): Promise<InitiativeObjectiveMappingResult> {
  if (!args.taskRunId || !args.proposerAgentId || !args.authorityDecisionId || !args.tokenScope || !args.reason.trim()) {
    const error = "Executing TaskRun, authenticated proposer, authority decision, token scope, and reason are required.";
    return { ...err(error), code: "AUTHORIZATION_DENIED" };
  }
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: args.itemId },
    select: { id: true, itemId: true, organizationId: true },
  });
  if (!item) return { ok: false, code: "OBJECTIVE_BASELINE_REQUIRED", error: `BacklogItem ${args.itemId} was not found.` };
  const authority = await prisma.authorizationDecisionLog.findUnique({
    where: { decisionId: args.authorityDecisionId },
    select: { decisionId: true, decision: true, actionKey: true, policyVersion: true, organizationId: true },
  });
  if (!authority || authority.decision !== "allow" || authority.actionKey !== "record_initiative_evidence"
    || authority.organizationId !== item.organizationId) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "The current tool call has no matching initiative-evidence allow decision." };
  }
  const organizationId = item.organizationId ?? "platform";
  const proposerAliases = await prisma.principalAlias.findMany({
    where: { aliasType: "user", aliasValue: args.proposerUserId, issuer: "" },
    select: { principal: { select: { principalId: true } } },
    take: 2,
  });
  const proposerPrincipalId = proposerAliases.length === 1 ? proposerAliases[0]?.principal.principalId : null;
  if (!proposerPrincipalId) return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Proposer principal identity is unavailable or ambiguous." };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${item.id} FOR UPDATE`;
    const taskAuthority = await validateExecutingObjectiveMappingTask({
      tx,
      taskRunId: args.taskRunId!,
      itemId: item.itemId,
      itemRowId: item.id,
      proposerUserId: args.proposerUserId,
      proposerAgentId: args.proposerAgentId!,
      baselineId: args.baselineId,
      eligibleEvidenceActivityIds: args.eligibleEvidenceActivityIds,
    });
    if (!taskAuthority.ok) return taskAuthority;
    const rows = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
    });
    const baselines = rows.map((row) => parseBaseline(row.payload));
    if (baselines.some((baseline) => !baseline)) {
      return { ok: false, code: "OBJECTIVE_BASELINE_CONFLICT", error: "The initiative baseline chain contains malformed evidence." };
    }
    const parsed = baselines as BaselinePayload[];
    const chain = validateInitiativeBaselineChainHead(parsed, args.baselineId);
    if (!chain.ok) return { ok: false, code: "OBJECTIVE_BASELINE_CONFLICT", error: chain.error };
    const baseline = parsed.find((entry) => entry.baselineId === args.baselineId);
    if (!baseline) return { ok: false, code: "OBJECTIVE_BASELINE_REQUIRED", error: "The current objective baseline was not found." };
    if (baseline.subject.id !== item.itemId
      || !baseline.artifactRef
      || !exactArtifactRef(baseline.artifactRef, taskAuthority.data.binding.artifactRef)) {
      const error = "The current objective baseline does not match the executing TaskRun artifact binding.";
      return { ...err(error), code: "OBJECTIVE_BASELINE_CONFLICT" };
    }
    const baselineRecordedAt = rows.find((row) => parseBaseline(row.payload)?.baselineId === args.baselineId)?.recordedAt;
    if (!baselineRecordedAt) {
      return { ok: false, code: "OBJECTIVE_BASELINE_CONFLICT", error: "The current objective baseline activity is unavailable or ambiguous." };
    }
    const statementIds = new Set([
      ...baseline.objectiveStatements.map((entry) => entry.objectiveId),
      ...baseline.acceptanceStatements.map((entry) => entry.acceptanceId),
    ]);
    const mappings = normalizeInitiativeObjectiveMappings(args.mappings, statementIds);
    if (!mappings || mappings.length !== statementIds.size) return { ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED", error: "Every proposal mapping must name each current objective and acceptance statement exactly once with at least one evidence reference." };

    const eligibleEvidenceActivityIds = args.eligibleEvidenceActivityIds.map((id) => id.trim());
    if (eligibleEvidenceActivityIds.length === 0
      || eligibleEvidenceActivityIds.length > MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES
      || eligibleEvidenceActivityIds.some((id) => !id)
      || new Set(eligibleEvidenceActivityIds).size !== eligibleEvidenceActivityIds.length) {
      return { ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED", error: "The server-bound eligible evidence activity set is missing, duplicated, or unbounded." };
    }
    const eligibleSet = new Set(eligibleEvidenceActivityIds);
    const mappedEvidenceRefs = [...new Set(mappings.flatMap((mapping) => mapping.evidenceRefs))];
    if (mappedEvidenceRefs.some((id) => !eligibleSet.has(id))) {
      return { ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED", error: "Every evidence reference must come from the server-bound eligible activity set." };
    }
    const evidenceRows = await tx.backlogItemActivity.findMany({
      where: {
        backlogItemId: item.id,
        kind: "evidence",
        recordedAt: { gte: baselineRecordedAt },
      },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      take: MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES + 1,
      select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
    });
    const validatedEvidence = selectEligibleObjectiveEvidenceActivityIds({
      itemId: item.itemId,
      itemRowId: item.id,
      baselineRecordedAt,
      activities: evidenceRows,
    });
    if (!validatedEvidence.ok
      || !exactStringSet(validatedEvidence.data.activityIds, taskAuthority.data.binding.eligibleEvidenceActivityIds)
      || !exactStringSet(validatedEvidence.data.activityIds, eligibleEvidenceActivityIds)) {
      const error = "The bound evidence set is no longer the exact current set of same-item, post-baseline passing activities.";
      return { ...err(error), code: "OBJECTIVE_RECONCILIATION_REQUIRED" };
    }

    const mappingRows = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_objective_mapping" },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: 1,
      select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
    });
    const reconciliation = reconcileInitiativeObjectives({
      itemId: item.itemId,
      itemRowId: item.id,
      activities: [...rows, ...evidenceRows, ...mappingRows],
    });
    if (reconciliation.state === "pass" || reconciliation.state === "fail") {
      const error = "A canonical objective mapping already exists for the current baseline.";
      return { ...err(error), code: "OBJECTIVE_MAPPING_ALREADY_EXISTS" };
    }

    const proposalId = `initiative-${randomUUID()}`;
    const proposal: InitiativeObjectiveMappingProposal = {
      schemaVersion: 1,
      proposalId,
      subject: { kind: "backlog-item", id: item.itemId },
      baselineId: baseline.baselineId,
      artifactDigest: baseline.artifactDigest,
      mappings,
      eligibleEvidenceActivityIds: [...eligibleEvidenceActivityIds].sort(),
      proposerPrincipalId,
      proposerAgentId: args.proposerAgentId!,
      authorityDecisionId: authority.decisionId,
      authoritySnapshot: {
        decision: "allow",
        effectiveHumanCapability: "manage_backlog",
        effectiveAgentGrant: "initiative_evidence_write",
        tokenScope: args.tokenScope!,
        organizationId,
        actionKey: "record_initiative_evidence",
        policyVersion: authority.policyVersion ?? "coworker-authority.v1",
      },
      reason: args.reason.trim(),
    };
    await tx.backlogItemActivity.create({ data: {
      id: proposalId,
      backlogItemId: item.id,
      kind: "initiative_objective_mapping",
      summary: `Objective evidence proposal for ${mappings.length} objective(s)`,
      payload: proposal as unknown as Prisma.InputJsonValue,
      recordedById: args.proposerUserId,
      recordedByAgentId: args.proposerAgentId,
    } });
    const success = ok();
    if (!success.ok) throw new Error("Canonical success constructor returned an error.");
    return { ...success, proposalId, proposal };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
