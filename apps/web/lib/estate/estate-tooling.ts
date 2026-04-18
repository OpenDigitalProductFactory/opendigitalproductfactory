import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

import { createEstateItem } from "@/lib/estate/estate-item";

const ESTATE_ENTITY_SELECT: Prisma.InventoryEntitySelect = {
  id: true,
  entityKey: true,
  name: true,
  entityType: true,
  technicalClass: true,
  iconKey: true,
  manufacturer: true,
  productModel: true,
  observedVersion: true,
  normalizedVersion: true,
  supportStatus: true,
  providerView: true,
  status: true,
  firstSeenAt: true,
  lastSeenAt: true,
  attributionStatus: true,
  attributionConfidence: true,
  taxonomyNode: { select: { name: true, nodeId: true } },
  softwareEvidence: {
    orderBy: [{ lastSeenAt: "desc" }, { firstSeenAt: "desc" }],
    take: 3,
    select: {
      rawVendor: true,
      rawVersion: true,
      normalizationStatus: true,
      normalizationConfidence: true,
      lastSeenAt: true,
    },
  },
  qualityIssues: {
    where: { status: "open" },
    orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
    take: 8,
    select: {
      issueType: true,
      severity: true,
      status: true,
    },
  },
  _count: {
    select: {
      fromRelationships: true,
      toRelationships: true,
    },
  },
};

type EntityLookupParams = {
  entityId?: string;
  entityKey?: string;
  entityName?: string;
};

export function getEstateProductIdFromRoute(routeContext?: string | null): string | null {
  const parts = routeContext?.split("/").filter(Boolean) ?? [];
  if (parts[0] === "portfolio" && parts[1] === "product" && parts[2]) {
    return parts[2];
  }
  return null;
}

export async function resolveEstateEntity(
  params: EntityLookupParams,
  routeContext?: string | null,
): Promise<
  | {
      kind: "resolved";
      item: ReturnType<typeof createEstateItem>;
    }
  | {
      kind: "ambiguous";
      matches: Array<{ id: string; name: string; entityKey: string; entityType: string }>;
    }
  | {
      kind: "missing";
      reason: string;
    }
> {
  const productId = getEstateProductIdFromRoute(routeContext);

  if (params.entityId) {
    const entity = await prisma.inventoryEntity.findUnique({
      where: { id: params.entityId },
      select: ESTATE_ENTITY_SELECT,
    });
    if (!entity) {
      return { kind: "missing", reason: `No estate item was found for id "${params.entityId}".` };
    }
    return { kind: "resolved", item: createEstateItem(entity) };
  }

  if (params.entityKey) {
    const entity = await prisma.inventoryEntity.findFirst({
      where: { entityKey: params.entityKey },
      select: ESTATE_ENTITY_SELECT,
    });
    if (!entity) {
      return { kind: "missing", reason: `No estate item was found for key "${params.entityKey}".` };
    }
    return { kind: "resolved", item: createEstateItem(entity) };
  }

  const trimmedName = params.entityName?.trim();
  if (!trimmedName) {
    return {
      kind: "missing",
      reason: "Specify an estate item by id, key, or name before using this tool.",
    };
  }

  const whereBase = productId ? { digitalProductId: productId } : {};
  const exactMatches = await prisma.inventoryEntity.findMany({
    where: {
      ...whereBase,
      name: { equals: trimmedName, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      entityKey: true,
      entityType: true,
    },
    take: 5,
  });

  if (exactMatches.length === 1) {
    const entity = await prisma.inventoryEntity.findUnique({
      where: { id: exactMatches[0].id },
      select: ESTATE_ENTITY_SELECT,
    });
    if (!entity) {
      return { kind: "missing", reason: `No estate item was found for "${trimmedName}".` };
    }
    return { kind: "resolved", item: createEstateItem(entity) };
  }

  if (exactMatches.length > 1) {
    return { kind: "ambiguous", matches: exactMatches };
  }

  const containsMatches = await prisma.inventoryEntity.findMany({
    where: {
      ...whereBase,
      name: { contains: trimmedName, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      entityKey: true,
      entityType: true,
    },
    take: 5,
  });

  if (containsMatches.length === 1) {
    const entity = await prisma.inventoryEntity.findUnique({
      where: { id: containsMatches[0].id },
      select: ESTATE_ENTITY_SELECT,
    });
    if (!entity) {
      return { kind: "missing", reason: `No estate item was found for "${trimmedName}".` };
    }
    return { kind: "resolved", item: createEstateItem(entity) };
  }

  if (containsMatches.length > 1) {
    return { kind: "ambiguous", matches: containsMatches };
  }

  return { kind: "missing", reason: `No estate item matched "${trimmedName}".` };
}

export async function summarizeProductEstate(routeContext?: string | null) {
  const productId = getEstateProductIdFromRoute(routeContext);
  if (!productId) return null;

  const product = await prisma.digitalProduct.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      inventoryEntities: {
        select: ESTATE_ENTITY_SELECT,
      },
    },
  });

  if (!product) return null;

  const items = product.inventoryEntities.map((entity) => createEstateItem(entity));
  const staleCount = items.filter((item) => item.freshnessTone === "danger").length;
  const uncertainVersionCount = items.filter((item) => item.versionConfidenceTone !== "good").length;
  const attentionItems = items
    .filter((item) => item.openIssueCount > 0 || item.supportTone === "danger" || item.freshnessTone === "danger")
    .sort((left, right) => right.openIssueCount - left.openIssueCount)
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      name: item.name,
      blastRadiusLabel: item.blastRadiusLabel,
      freshnessLabel: item.freshnessLabel,
      posture: item.postureBadges.map((badge) => badge.label),
    }));

  return {
    productId: product.id,
    productName: product.name,
    itemCount: items.length,
    staleCount,
    uncertainVersionCount,
    unknownSupportCount: items.filter((item) => item.supportStatus === "unknown").length,
    openIssueCount: items.reduce((total, item) => total + item.openIssueCount, 0),
    attentionItems,
  };
}

export async function summarizeDiscoveryOperations() {
  const [latestRun, needsReviewCount, issueGroups] = await Promise.all([
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        runKey: true,
        status: true,
        itemCount: true,
        relationshipCount: true,
      },
    }),
    prisma.inventoryEntity.count({ where: { attributionStatus: "needs_review" } }),
    prisma.portfolioQualityIssue.groupBy({
      by: ["issueType"],
      where: { status: "open" },
      _count: true,
      orderBy: { _count: { issueType: "desc" } },
      take: 8,
    }),
  ]);

  return {
    latestRun,
    needsReviewCount,
    issueGroups: issueGroups.map((group) => ({
      issueType: group.issueType,
      count: group._count,
    })),
  };
}

export async function loadEstateBlastRadius(entityId: string) {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    select: {
      id: true,
      name: true,
      fromRelationships: {
        where: { status: "active" },
        take: 12,
        select: {
          relationshipType: true,
          confidence: true,
          toEntity: {
            select: {
              id: true,
              name: true,
              entityKey: true,
              entityType: true,
            },
          },
        },
      },
      toRelationships: {
        where: { status: "active" },
        take: 12,
        select: {
          relationshipType: true,
          confidence: true,
          fromEntity: {
            select: {
              id: true,
              name: true,
              entityKey: true,
              entityType: true,
            },
          },
        },
      },
    },
  });

  if (!entity) return null;

  return {
    entityId: entity.id,
    entityName: entity.name,
    upstream: entity.fromRelationships.map((relationship) => ({
      relationshipType: relationship.relationshipType,
      confidence: relationship.confidence,
      entity: relationship.toEntity,
    })),
    downstream: entity.toRelationships.map((relationship) => ({
      relationshipType: relationship.relationshipType,
      confidence: relationship.confidence,
      entity: relationship.fromEntity,
    })),
  };
}
