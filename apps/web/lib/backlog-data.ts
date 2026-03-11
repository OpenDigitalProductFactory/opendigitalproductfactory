// apps/web/lib/backlog-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
import { cache } from "react";
import { prisma } from "@dpf/db";
import type { BacklogItemWithRelations, DigitalProductSelect, TaxonomyNodeSelect } from "./backlog";

export const getBacklogItems = cache(async (): Promise<BacklogItemWithRelations[]> => {
  return prisma.backlogItem.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
      type: true,
      body: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      digitalProduct: { select: { id: true, productId: true, name: true } },
      taxonomyNode: { select: { id: true, nodeId: true, name: true } },
    },
  });
});

export const getDigitalProductsForSelect = cache(async (): Promise<DigitalProductSelect[]> => {
  return prisma.digitalProduct.findMany({
    orderBy: { name: "asc" },
    select: { id: true, productId: true, name: true, lifecycleStage: true },
  });
});

// Note: The spec originally proposed reusing getPortfolioTree() and flattening at call site.
// A direct query is used here instead: getPortfolioTree() returns nodes with product-count
// metadata that is irrelevant for the form selector, and coupling the form to the portfolio
// tree shape creates an unnecessary dependency. A dedicated active-node query is cleaner.
export const getTaxonomyNodesFlat = cache(async (): Promise<TaxonomyNodeSelect[]> => {
  return prisma.taxonomyNode.findMany({
    where: { status: "active" },
    select: { id: true, nodeId: true, name: true },
    orderBy: { nodeId: "asc" },
  });
});
