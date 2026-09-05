import { randomUUID } from "node:crypto";

import { Prisma, prisma } from "@dpf/db";

import { ok } from "@/lib/shared/action-result";

import { validateInitiativeBaselineChainHead } from "./baseline-repository";
import {
  MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES,
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
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactDigest: string;
  objectiveStatements: Array<{ objectiveId: string }>;
  acceptanceStatements: Array<{ acceptanceId: string }>;
};

function parseBaseline(value: unknown): BaselinePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.baselineId !== "string"
    || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")
    || typeof row.artifactDigest !== "string"
    || !Array.isArray(row.objectiveStatements)
    || !row.objectiveStatements.every((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).objectiveId === "string")
    || !Array.isArray(row.acceptanceStatements)
    || !row.acceptanceStatements.every((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).acceptanceId === "string")) {
    return null;
  }
  return row as unknown as BaselinePayload;
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
  if (!args.proposerAgentId || !args.authorityDecisionId || !args.tokenScope || !args.reason.trim()) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "Authenticated proposer, authority decision, token scope, and reason are required." };
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
    const rows = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { recordedAt: true, payload: true },
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
    const eligibleRows = await tx.backlogItemActivity.findMany({
      where: {
        id: { in: eligibleEvidenceActivityIds },
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
      activities: eligibleRows,
    });
    if (!validatedEvidence.ok
      || validatedEvidence.data.activityIds.length !== eligibleEvidenceActivityIds.length
      || validatedEvidence.data.activityIds.some((id) => !eligibleSet.has(id))) {
      return { ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED", error: "The bound evidence set contains a missing, foreign, pre-baseline, or non-passing activity." };
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
