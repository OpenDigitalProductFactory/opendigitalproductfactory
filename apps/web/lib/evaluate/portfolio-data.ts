// apps/web/lib/portfolio-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
// Both layout.tsx and page.tsx call getPortfolioTree() — React deduplicates automatically.
import { cache } from "react";
import { prisma } from "@dpf/db";
import { buildPortfolioTree, formatBudget, PORTFOLIO_OWNER_ROLES, type OwnerRoleInfo } from "./portfolio";

export const getPortfolioTree = cache(async (pruneEmpty = true) => {
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
      where: { lifecycleStatus: "active" },
    }),
  ]);
  return buildPortfolioTree(nodes, totalCounts, activeCounts, { pruneEmpty });
});

/** Returns the full (unpruned) tree for admin/reference views. */
export const getFullPortfolioTree = cache(async () => {
  const [nodes, totalCounts, activeCounts] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { status: "active" },
      select: { id: true, nodeId: true, name: true, parentId: true, portfolioId: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["taxonomyNodeId"],
      _count: { id: true },
      where: { lifecycleStatus: "active" },
    }),
  ]);
  return buildPortfolioTree(nodes, totalCounts, activeCounts, { pruneEmpty: false });
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

/**
 * Returns annual budget per portfolio slug, e.g. { foundational: "$2.5M", ... }.
 * Returns "—" for portfolios with null budget.
 * React cache() deduplicates across layout + page within one request.
 */
export const getPortfolioBudgets = cache(async (): Promise<Record<string, string>> => {
  const portfolios = await prisma.portfolio.findMany({
    select: { slug: true, budgetKUsd: true },
  });
  return Object.fromEntries(
    portfolios.map((p) => [p.slug, formatBudget(p.budgetKUsd)])
  );
});

/**
 * Returns owner role detail per portfolio slug.
 * React cache() deduplicates within one request.
 */
export const getPortfolioOwnerRoles = cache(async (): Promise<Record<string, OwnerRoleInfo>> => {
  const ownerRoleIds = Object.values(PORTFOLIO_OWNER_ROLES);
  const roles = await prisma.platformRole.findMany({
    where: { roleId: { in: ownerRoleIds } },
    select: {
      roleId: true,
      name: true,
      description: true,
      _count: { select: { users: true } },
    },
  });

  const roleById = new Map(
    roles.map((r) => [
      r.roleId,
      { roleId: r.roleId, name: r.name, description: r.description, userCount: r._count.users },
    ])
  );

  return Object.fromEntries(
    Object.entries(PORTFOLIO_OWNER_ROLES).map(([slug, roleId]) => [
      slug,
      roleById.get(roleId) ?? { roleId, name: roleId, description: null, userCount: 0 },
    ])
  );
});
