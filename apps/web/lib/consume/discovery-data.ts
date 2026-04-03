import { prisma } from "@dpf/db";

export type DiscoveryHealthSummary = {
  totalEntities: number;
  staleEntities: number;
  openIssues: number;
};

export function summarizeDiscoveryHealth(
  summary: DiscoveryHealthSummary,
): DiscoveryHealthSummary {
  return summary;
}

export async function getLatestDiscoveryRun() {
  return prisma.discoveryRun.findFirst({
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      runKey: true,
      status: true,
      trigger: true,
      startedAt: true,
      completedAt: true,
      itemCount: true,
      relationshipCount: true,
    },
  });
}

export async function getInventoryEntitiesForPage() {
  return prisma.inventoryEntity.findMany({
    orderBy: [{ providerView: "asc" }, { name: "asc" }],
    include: {
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true, name: true } },
      digitalProduct: { select: { id: true, productId: true, name: true } },
    },
  });
}

export async function getNeedsReviewEntities() {
  const entities = await prisma.inventoryEntity.findMany({
    where: { attributionStatus: "needs_review" },
    orderBy: [{ lastSeenAt: "desc" }],
    select: {
      id: true,
      entityKey: true,
      entityType: true,
      name: true,
      attributionConfidence: true,
      candidateTaxonomy: true,
      firstSeenAt: true,
      lastSeenAt: true,
      properties: true,
    },
  });
  return entities.map((e) => ({
    ...e,
    firstSeenAt: e.firstSeenAt.toISOString(),
    lastSeenAt: e.lastSeenAt.toISOString(),
    candidateTaxonomy: Array.isArray(e.candidateTaxonomy)
      ? (e.candidateTaxonomy as Array<{ nodeId: string; name: string; score: number }>)
      : [],
  }));
}

export async function getOpenPortfolioQualityIssues() {
  return prisma.portfolioQualityIssue.findMany({
    where: { status: "open" },
    orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
    include: {
      inventoryEntity: { select: { entityKey: true, name: true } },
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true, name: true } },
      digitalProduct: { select: { productId: true, name: true } },
    },
  });
}
