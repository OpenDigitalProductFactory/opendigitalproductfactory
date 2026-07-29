import {
  INVENTORY_ENTITY_CANONICAL_WHERE,
  INVENTORY_RELATIONSHIP_CANONICAL_WHERE,
  prisma,
} from "@dpf/db";
import { createEstateItem } from "@/lib/estate/estate-item";

export async function getProductEstateContext(
  _userId: string,
  routeContext: string,
): Promise<string> {
  const parts = routeContext.split("/").filter(Boolean);
  const productId = parts[2] ?? null;
  if (!productId) {
    return "\nPAGE DATA — Product Estate:\nNo product is selected.";
  }

  const product = await prisma.digitalProduct.findUnique({
    where: { id: productId },
    select: {
      productId: true,
      name: true,
      portfolio: { select: { name: true } },
      taxonomyNode: { select: { nodeId: true } },
      inventoryEntities: {
        where: INVENTORY_ENTITY_CANONICAL_WHERE,
        orderBy: [{ lastSeenAt: "desc" }, { name: "asc" }],
        take: 10,
        select: {
          name: true,
          entityType: true,
          technicalClass: true,
          iconKey: true,
          manufacturer: true,
          productModel: true,
          normalizedVersion: true,
          observedVersion: true,
          supportStatus: true,
          providerView: true,
          status: true,
          firstSeenAt: true,
          lastSeenAt: true,
          taxonomyNode: { select: { name: true, nodeId: true } },
          softwareEvidence: {
            orderBy: [{ lastSeenAt: "desc" }, { firstSeenAt: "desc" }],
            take: 2,
            select: {
              rawVendor: true,
              rawProductName: true,
              rawPackageName: true,
              rawVersion: true,
              normalizationStatus: true,
              normalizationConfidence: true,
              lastSeenAt: true,
            },
          },
          _count: {
            select: {
              fromRelationships: { where: INVENTORY_RELATIONSHIP_CANONICAL_WHERE },
              toRelationships: { where: INVENTORY_RELATIONSHIP_CANONICAL_WHERE },
            },
          },
          qualityIssues: {
            where: { status: "open" },
            select: { issueType: true, status: true, severity: true },
            take: 4,
          },
        },
      },
    },
  });

  if (!product) {
    return "\nPAGE DATA — Product Estate:\nThe selected product could not be loaded.";
  }

  const taxonomyPath = product.taxonomyNode?.nodeId ?? "unmapped";
  const attentionCount = product.inventoryEntities.filter(
    (entity) => entity.qualityIssues.length > 0,
  ).length;

  return [
    "\nPAGE DATA — Product Estate:",
    `Product: ${product.name} (${product.productId})`,
    `Portfolio: ${product.portfolio?.name ?? "unassigned"}`,
    `Taxonomy: ${taxonomyPath}`,
    `Estate items: ${product.inventoryEntities.length}, items with open issues: ${attentionCount}`,
    "",
    "Visible estate items:",
    ...product.inventoryEntities.map((entity) => {
      const item = createEstateItem({
        id: `${productId}:${entity.name}`,
        entityKey: `${entity.entityType}:${entity.name}`,
        name: entity.name,
        entityType: entity.entityType,
        technicalClass: entity.technicalClass,
        iconKey: entity.iconKey,
        manufacturer: entity.manufacturer,
        productModel: entity.productModel,
        observedVersion: entity.observedVersion,
        normalizedVersion: entity.normalizedVersion,
        supportStatus: entity.supportStatus,
        providerView: entity.providerView,
        status: entity.status,
        firstSeenAt: entity.firstSeenAt,
        lastSeenAt: entity.lastSeenAt,
        taxonomyNode: entity.taxonomyNode,
        softwareEvidence: entity.softwareEvidence,
        _count: entity._count,
        qualityIssues: entity.qualityIssues,
      });
      const issues = entity.qualityIssues.map((issue) => issue.issueType).join(", ") || "none";
      const lastSeen = entity.lastSeenAt?.toISOString().slice(0, 10) ?? "unknown";
      return `- ${item.name} [${item.technicalClassLabel}] identity=${item.identityLabel} (${item.identityConfidenceLabel}), vendor=${item.manufacturerLabel}, version=${item.versionLabel} (${item.versionSourceLabel}), support=${item.supportSummaryLabel}, advisories=${item.advisorySummaryLabel}, last seen=${lastSeen}, upstream=${item.upstreamCount}, downstream=${item.downstreamCount}, issues=${issues}`;
    }),
  ].join("\n");
}
