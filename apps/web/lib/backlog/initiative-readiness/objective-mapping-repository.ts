import { randomUUID } from "node:crypto";

import { Prisma, prisma } from "@dpf/db";

import { validateInitiativeBaselineChainHead } from "./baseline-repository";

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
};

function parseBaseline(value: unknown): BaselinePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.baselineId !== "string"
    || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")
    || typeof row.artifactDigest !== "string"
    || !Array.isArray(row.objectiveStatements)
    || !row.objectiveStatements.every((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).objectiveId === "string")) {
    return null;
  }
  return row as unknown as BaselinePayload;
}

function normalizeMappings(
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
    || (item.organizationId && authority.organizationId !== item.organizationId)) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "The current tool call has no matching initiative-evidence allow decision." };
  }
  const organizationId = authority.organizationId ?? item.organizationId;
  if (!organizationId) return { ok: false, code: "AUTHORIZATION_DENIED", error: "Objective mapping requires organization-bound authority." };
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
      select: { payload: true },
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
    const mappings = normalizeMappings(args.mappings, new Set(baseline.objectiveStatements.map((entry) => entry.objectiveId)));
    if (!mappings) return { ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED", error: "Every proposal mapping must name one current objective and at least one evidence reference." };

    const proposalId = `initiative-${randomUUID()}`;
    const proposal: InitiativeObjectiveMappingProposal = {
      schemaVersion: 1,
      proposalId,
      subject: { kind: "backlog-item", id: item.itemId },
      baselineId: baseline.baselineId,
      artifactDigest: baseline.artifactDigest,
      mappings,
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
    return { ok: true, proposalId, proposal };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
