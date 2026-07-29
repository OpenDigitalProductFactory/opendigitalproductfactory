// apps/web/app/(shell)/portfolio/products/[productId]/page.tsx
//
// Digital product detail route (Task 3.4 of the discovery -> portfolio gap
// closure plan). Loads a DigitalProduct by `productId`, hydrates the
// taxonomy ancestor chain from `taxonomyNode.nodeId`, projects everything
// through `toDigitalProductViewModel`, then hands off to the pure
// presentation component.
//
// Route placement note: the plan originally specified
// `[[...slug]]/products/[productId]/page.tsx`, but Next.js rejects children
// under an optional catch-all ("Optional catch-all must be the last part
// of the URL"). Moved up one level so `products` is a sibling of the
// optional catch-all; static segments still win route matching, so the
// URL `/portfolio/products/<id>` resolves here and not into the catch-all.
//
// Forward-compatible with Chunk 4 Task 4.1: `freshness` (on InventoryEntity)
// and `enrichmentStatus` / `lastEnrichedAt` (on DigitalProduct) are not yet
// in the Prisma schema. The view model accepts them as optional inputs and
// defaults them to null, so this page renders today on the existing schema
// and will light up once Chunk 4 lands without further changes here.

import { notFound } from "next/navigation";
import { INVENTORY_ENTITY_CANONICAL_WHERE, prisma } from "@dpf/db";
import { toDigitalProductViewModel } from "@/lib/portfolio/digital-product-view-model";
import { DigitalProductDetail } from "@/components/portfolio/DigitalProductDetail";

type Props = {
  params: Promise<{ productId: string }>;
};

export default async function DigitalProductPage({ params }: Props) {
  const { productId } = await params;

  const product = await prisma.digitalProduct.findUnique({
    where: { productId },
    select: {
      id: true,
      productId: true,
      name: true,
      description: true,
      version: true,
      lifecycleStage: true,
      lifecycleStatus: true,
      observationConfig: true,
      portfolio: { select: { id: true, slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true, name: true } },
      // TODO(Chunk 4 Task 4.1): add enrichmentStatus + lastEnrichedAt once schema lands.
      inventoryEntities: {
        where: INVENTORY_ENTITY_CANONICAL_WHERE,
        select: {
          id: true,
          name: true,
          entityKey: true,
          entityType: true,
          manufacturer: true,
          productModel: true,
          technicalClass: true,
          iconKey: true,
          observedVersion: true,
          normalizedVersion: true,
          attributionConfidence: true,
          lastSeenAt: true,
          // TODO(Chunk 4 Task 4.1): add freshness once schema lands.
        },
      },
      portfolioQualityIssues: {
        where: { status: "open" },
        orderBy: { lastDetectedAt: "desc" },
        take: 10,
        select: {
          id: true,
          issueType: true,
          severity: true,
          summary: true,
          lastDetectedAt: true,
          status: true,
        },
      },
    },
  });

  if (!product) notFound();

  const taxonomyAncestors = await buildAncestors(product.taxonomyNode?.nodeId);

  const vm = toDigitalProductViewModel({
    product,
    taxonomyAncestors,
    inventoryEntities: product.inventoryEntities,
    qualityIssues: product.portfolioQualityIssues,
    // freshness / enrichmentStatus / lastEnrichedAt -- pending Chunk 4 Task 4.1
  });

  return <DigitalProductDetail vm={vm} />;
}

/**
 * Build the taxonomy ancestor list (root-first, leaf excluded) from the
 * product's `taxonomyNode.nodeId` slash-delimited path. The leaf itself is
 * the product's own node, which the view model appends after the ancestors.
 */
async function buildAncestors(
  nodeId: string | null | undefined,
): Promise<Array<{ nodeId: string; name: string }>> {
  if (!nodeId) return [];
  const segments = nodeId.split("/");
  const ancestorIds: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestorIds.push(segments.slice(0, i).join("/"));
  }
  if (ancestorIds.length === 0) return [];
  const nodes = await prisma.taxonomyNode.findMany({
    where: { nodeId: { in: ancestorIds } },
    select: { nodeId: true, name: true },
  });
  // Sort to match ancestorIds order (root -> deeper).
  const byNodeId = new Map(nodes.map((n) => [n.nodeId, n]));
  return ancestorIds
    .map((id) => byNodeId.get(id))
    .filter((n): n is { nodeId: string; name: string } => n !== undefined);
}
