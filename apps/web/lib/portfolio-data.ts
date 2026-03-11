// apps/web/lib/portfolio-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
// Both layout.tsx and page.tsx call getPortfolioTree() — React deduplicates automatically.
import { cache } from "react";
import { prisma } from "@dpf/db";
import { buildPortfolioTree } from "./portfolio";

export const getPortfolioTree = cache(async () => {
  const [nodes, counts] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { status: "active" },
      select: { id: true, nodeId: true, name: true, parentId: true, portfolioId: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { status: "active" },
    }),
  ]);
  return buildPortfolioTree(nodes, counts);
});
