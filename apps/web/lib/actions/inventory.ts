"use server";

import { prisma, promoteInventoryEntities } from "@dpf/db";
import {
  buildDiscoveryEvidencePacket,
  DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
  recordDiscoveryTriageDecision,
  scoreDiscoveryTriageCandidate,
  type DiscoveryEvidencePacket,
  type DiscoveryTriageProposedRule,
  type DiscoveryTriageScore,
} from "@dpf/db/discovery-triage";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const DISCOVERY_REVALIDATE_PATHS = [
  "/platform/tools",
  "/platform/tools/discovery",
  "/inventory",
] as const;

function revalidateDiscoverySurfaces() {
  DISCOVERY_REVALIDATE_PATHS.forEach((path) => revalidatePath(path));
}

type InventoryActionResult = { ok: true } | { ok: false; error: string };

type DiscoveryManager = {
  id?: string | null;
};

async function requireManageDiscovery(): Promise<
  { ok: true; user: DiscoveryManager } | { ok: false; error: string }
> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return { ok: false, error: "Unauthorized" };
  }
  return { ok: true, user };
}

type ActionTriageEntity = {
  id: string;
  entityKey: string;
  entityType: string;
  name: string;
  providerView: string | null;
  manufacturer: string | null;
  productModel: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  attributionConfidence: number | null;
  attributionEvidence: Record<string, unknown> | null;
  candidateTaxonomy: Array<{ nodeId: string; name?: string | null; score: number }> | null;
  properties: Record<string, unknown> | null;
};

type ActionTriageDecision = {
  id: string;
  decisionId: string;
  inventoryEntityId: string | null;
  selectedTaxonomyNodeId: string | null;
  selectedIdentity: Record<string, unknown> | null;
  identityConfidence: number | null;
  taxonomyConfidence: number | null;
  evidenceCompleteness: number | null;
  reproducibilityScore: number | null;
  evidencePacket: DiscoveryEvidencePacket | Record<string, unknown>;
  proposedRule: Record<string, unknown> | null;
  requiresHumanReview: boolean;
};

function normalizeCandidateTaxonomy(
  value: ActionTriageEntity["candidateTaxonomy"],
): Array<{ nodeId: string; name?: string | null; score: number }> {
  return Array.isArray(value) ? [...value] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function coerceScore(value: number | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

function asProposedRule(
  value: Record<string, unknown> | null | undefined,
): DiscoveryTriageProposedRule | null {
  return value ? (value as unknown as DiscoveryTriageProposedRule) : null;
}

function buildActionEvidencePacket(entity: ActionTriageEntity): DiscoveryEvidencePacket {
  return buildDiscoveryEvidencePacket({
    id: entity.id,
    entityKey: entity.entityKey,
    entityType: entity.entityType,
    name: entity.name,
    source: entity.providerView,
    firstSeenAt: entity.firstSeenAt,
    lastSeenAt: entity.lastSeenAt,
    attributionConfidence: entity.attributionConfidence,
    manufacturer: entity.manufacturer,
    productModel: entity.productModel,
    observedVersion: entity.observedVersion,
    normalizedVersion: entity.normalizedVersion,
    attributionEvidence: entity.attributionEvidence,
    candidateTaxonomy: normalizeCandidateTaxonomy(entity.candidateTaxonomy),
    properties: entity.properties ?? {},
    hasSuitableTaxonomy: normalizeCandidateTaxonomy(entity.candidateTaxonomy).length > 0,
  });
}

async function loadTriageEntity(entityId: string): Promise<ActionTriageEntity | null> {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    select: {
      id: true,
      entityKey: true,
      entityType: true,
      name: true,
      providerView: true,
      manufacturer: true,
      productModel: true,
      observedVersion: true,
      normalizedVersion: true,
      firstSeenAt: true,
      lastSeenAt: true,
      attributionConfidence: true,
      attributionEvidence: true,
      candidateTaxonomy: true,
      properties: true,
    },
  });

  if (!entity) return null;

  return {
    ...entity,
    attributionEvidence: entity.attributionEvidence
      ? asRecord(entity.attributionEvidence)
      : null,
    candidateTaxonomy: normalizeCandidateTaxonomy(
      Array.isArray(entity.candidateTaxonomy)
        ? (entity.candidateTaxonomy as ActionTriageEntity["candidateTaxonomy"])
        : null,
    ),
    properties: asRecord(entity.properties),
  };
}

async function loadLatestTriageDecision(
  entityId: string,
): Promise<ActionTriageDecision | null> {
  const decision = await prisma.discoveryTriageDecision.findFirst({
    where: { inventoryEntityId: entityId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      decisionId: true,
      inventoryEntityId: true,
      selectedTaxonomyNodeId: true,
      selectedIdentity: true,
      identityConfidence: true,
      taxonomyConfidence: true,
      evidenceCompleteness: true,
      reproducibilityScore: true,
      evidencePacket: true,
      proposedRule: true,
      requiresHumanReview: true,
    },
  });

  if (!decision) return null;

  return {
    ...decision,
    selectedIdentity: decision.selectedIdentity
      ? asRecord(decision.selectedIdentity)
      : null,
    evidencePacket: asRecord(decision.evidencePacket),
    proposedRule: decision.proposedRule ? asRecord(decision.proposedRule) : null,
  };
}

async function recordHumanTriageDecision(
  userId: string | null | undefined,
  entity: ActionTriageEntity,
  latestDecision: ActionTriageDecision | null,
  outcome: "needs-more-evidence" | "taxonomy-gap" | "auto-attributed",
  requiresHumanReview: boolean,
  overrides?: Partial<{
    selectedTaxonomyNodeId: string | null;
    selectedIdentity: Record<string, unknown> | null;
    proposedRule: Record<string, unknown> | null;
    humanReviewedAt: Date | null;
  }>,
): Promise<void> {
  const evidencePacket = latestDecision?.evidencePacket && "inventoryEntity" in latestDecision.evidencePacket
    ? (latestDecision.evidencePacket as DiscoveryEvidencePacket)
    : buildActionEvidencePacket(entity);
  const fallbackScore = scoreDiscoveryTriageCandidate(
    evidencePacket,
    DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
  );
  const score: DiscoveryTriageScore = {
    identityConfidence: latestDecision?.identityConfidence ?? fallbackScore.identityConfidence,
    taxonomyConfidence: latestDecision?.taxonomyConfidence ?? fallbackScore.taxonomyConfidence,
    evidenceCompleteness: latestDecision?.evidenceCompleteness ?? fallbackScore.evidenceCompleteness,
    reproducibilityScore: latestDecision?.reproducibilityScore ?? fallbackScore.reproducibilityScore,
    identityAmbiguityMargin: fallbackScore.identityAmbiguityMargin,
    taxonomyAmbiguityMargin: fallbackScore.taxonomyAmbiguityMargin,
  };

  await recordDiscoveryTriageDecision(prisma as never, {
    decisionId: `triage-${entity.id}-${randomUUID().slice(0, 8)}`,
    inventoryEntityId: entity.id,
    actorType: "human",
    actorId: userId ?? null,
    outcome,
    score,
    evidencePacket,
    proposedRule: asProposedRule(overrides?.proposedRule ?? latestDecision?.proposedRule ?? null),
    selectedTaxonomyNodeId:
      overrides?.selectedTaxonomyNodeId
      ?? latestDecision?.selectedTaxonomyNodeId
      ?? evidencePacket.candidateTaxonomy[0]?.nodeId
      ?? null,
    selectedIdentity:
      overrides?.selectedIdentity
      ?? latestDecision?.selectedIdentity
      ?? (evidencePacket.identityCandidates[0]
        ? { label: evidencePacket.identityCandidates[0].identity }
        : null),
    requiresHumanReview,
    humanReviewedAt: overrides?.humanReviewedAt ?? null,
  });
}

async function resolveRecommendedTaxonomyNode(candidate: string | null | undefined) {
  if (!candidate) return null;

  return prisma.taxonomyNode.findFirst({
    where: {
      OR: [{ id: candidate }, { nodeId: candidate }],
    },
    select: { id: true, nodeId: true },
  });
}

export async function acceptAttribution(
  entityId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  await prisma.inventoryEntity.update({
    where: { id: entityId },
    data: { attributionStatus: "attributed" },
  });

  // Trigger promotion for the newly attributed entity
  await promoteInventoryEntities(prisma as never);

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function reassignTaxonomy(
  entityId: string,
  taxonomyNodeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  // Look up taxonomy node to get portfolioId
  const node = await prisma.taxonomyNode.findFirst({
    where: {
      OR: [{ id: taxonomyNodeId }, { nodeId: taxonomyNodeId }],
    },
    select: { id: true, nodeId: true },
  });
  if (!node) return { ok: false, error: "Taxonomy node not found" };

  const rootSlug = node.nodeId.split("/")[0];
  const portfolio = rootSlug
    ? await prisma.portfolio.findUnique({ where: { slug: rootSlug }, select: { id: true } })
    : null;

  await prisma.inventoryEntity.update({
    where: { id: entityId },
    data: {
      taxonomyNodeId: node.id,
      attributionStatus: "attributed",
      attributionMethod: "manual",
      attributionConfidence: 1.0,
      ...(portfolio ? { portfolioId: portfolio.id } : {}),
    },
  });

  await promoteInventoryEntities(prisma as never);

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function dismissEntity(
  entityId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  await prisma.inventoryEntity.update({
    where: { id: entityId },
    data: { attributionStatus: "dismissed" },
  });

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function requestDiscoveryEvidence(
  entityId: string,
): Promise<InventoryActionResult> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const entity = await loadTriageEntity(entityId);
  if (!entity) return { ok: false, error: "Inventory entity not found" };

  const latestDecision = await loadLatestTriageDecision(entityId);
  await recordHumanTriageDecision(
    authResult.user.id,
    entity,
    latestDecision,
    "needs-more-evidence",
    false,
  );

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function markTaxonomyGapForReview(
  entityId: string,
): Promise<InventoryActionResult> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const entity = await loadTriageEntity(entityId);
  if (!entity) return { ok: false, error: "Inventory entity not found" };

  const latestDecision = await loadLatestTriageDecision(entityId);
  await recordHumanTriageDecision(
    authResult.user.id,
    entity,
    latestDecision,
    "taxonomy-gap",
    true,
  );

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function acceptTriageRecommendation(
  decisionId: string,
): Promise<InventoryActionResult> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const decision = await prisma.discoveryTriageDecision.findUnique({
    where: { decisionId },
    select: {
      id: true,
      decisionId: true,
      inventoryEntityId: true,
      selectedTaxonomyNodeId: true,
      selectedIdentity: true,
      identityConfidence: true,
      taxonomyConfidence: true,
      evidenceCompleteness: true,
      reproducibilityScore: true,
      evidencePacket: true,
      proposedRule: true,
      requiresHumanReview: true,
    },
  });

  if (!decision?.inventoryEntityId) {
    return { ok: false, error: "Triage recommendation not found" };
  }

  const entity = await loadTriageEntity(decision.inventoryEntityId);
  if (!entity) return { ok: false, error: "Inventory entity not found" };

  const evidencePacket = asRecord(decision.evidencePacket);
  const proposedRule = decision.proposedRule ? asRecord(decision.proposedRule) : null;
  const candidateTaxonomyNodeId =
    decision.selectedTaxonomyNodeId
    ?? (typeof proposedRule?.taxonomyNodeId === "string" ? proposedRule.taxonomyNodeId : null)
    ?? (Array.isArray(evidencePacket.candidateTaxonomy)
      ? asRecord(evidencePacket.candidateTaxonomy[0]).nodeId as string | undefined
      : undefined)
    ?? normalizeCandidateTaxonomy(entity.candidateTaxonomy)[0]?.nodeId
    ?? null;
  const node = await resolveRecommendedTaxonomyNode(candidateTaxonomyNodeId);
  if (!node) {
    return { ok: false, error: "Recommended taxonomy node not found" };
  }

  const rootSlug = node.nodeId.split("/")[0];
  const portfolio = rootSlug
    ? await prisma.portfolio.findUnique({ where: { slug: rootSlug }, select: { id: true } })
    : null;
  const reviewedAt = new Date();

  await prisma.discoveryTriageDecision.update({
    where: { decisionId },
    data: {
      humanReviewedAt: reviewedAt,
    },
  });

  await prisma.inventoryEntity.update({
    where: { id: entity.id },
    data: {
      taxonomyNodeId: node.id,
      attributionStatus: "attributed",
      attributionMethod: "ai-proposed",
      attributionConfidence: coerceScore(decision.taxonomyConfidence ?? decision.identityConfidence),
      attributionEvidence: evidencePacket as never,
      ...(portfolio ? { portfolioId: portfolio.id } : {}),
    },
  });

  await recordHumanTriageDecision(
    authResult.user.id,
    entity,
    {
      ...decision,
      selectedIdentity: decision.selectedIdentity ? asRecord(decision.selectedIdentity) : null,
      evidencePacket,
      proposedRule,
    },
    "auto-attributed",
    false,
    {
      selectedTaxonomyNodeId: node.id,
      selectedIdentity: decision.selectedIdentity ? asRecord(decision.selectedIdentity) : null,
      proposedRule,
      humanReviewedAt: reviewedAt,
    },
  );

  await promoteInventoryEntities(prisma as never);

  revalidateDiscoverySurfaces();
  return { ok: true };
}

export async function resolvePortfolioQualityIssue(
  issueId: string,
  resolution: "resolved" | "dismissed",
): Promise<{ ok: boolean; error?: string }> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) return authResult;

  const existing = await prisma.portfolioQualityIssue.findUnique({
    where: { id: issueId },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: "Quality issue not found" };

  await prisma.portfolioQualityIssue.update({
    where: { id: issueId },
    data: {
      status: resolution,
      resolvedAt: new Date(),
    },
  });

  revalidateDiscoverySurfaces();
  return { ok: true };
}
