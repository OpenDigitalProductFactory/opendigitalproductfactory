// apps/web/lib/portfolio-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
// Both layout.tsx and page.tsx call getPortfolioTree() — React deduplicates automatically.
import { cache } from "react";
import { prisma } from "@dpf/db";
import { buildPortfolioTree } from "./portfolio";

export const getPortfolioTree = cache(async () => {
  const [nodes, totalCounts, activeCounts] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { status: "active" },
      select: { id: true, nodeId: true, name: true, parentId: true, portfolioId: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      // no status filter — counts all products in the taxonomy regardless of lifecycle stage
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { status: "active" },
    }),
  ]);
  return buildPortfolioTree(nodes, totalCounts, activeCounts);
});

/**
 * Returns agent count per portfolio slug, e.g. { foundational: 14, ... }.
 * Cross-cutting agents (portfolioId = null) are excluded.
 * React cache() deduplicates across layout + page within one request.
 */
export const getAgentCounts = cache(async (): Promise<Record<string, number>> => {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true },
  });
  const counts = await prisma.agent.groupBy({
    by: ["portfolioId"],
    _count: { id: true },
    where: { status: "active", portfolioId: { not: null } },
  });
  // portfolioId! is safe: where clause already excludes null
  const countById = new Map(counts.map((c) => [c.portfolioId!, c._count.id]));
  return Object.fromEntries(portfolios.map((p) => [p.slug, countById.get(p.id) ?? 0]));
});
