// apps/web/lib/portfolio-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
// Both layout.tsx and page.tsx call getPortfolioTree() — React deduplicates automatically.
import { cache } from "react";
import { prisma } from "@dpf/db";
import {
  SELECTABLE_COWORKER_STATE,
  dropDualSeedAliasAgents,
} from "@/lib/coworker-record/selectable-coworker";
import { buildPortfolioTree, PORTFOLIO_OWNER_ROLES, type OwnerRoleInfo } from "./portfolio";
import {
  getPortfolioBudgetMetric,
  type PortfolioBudgetMetric,
} from "@/lib/portfolio/budget-provenance";

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
      select: {
        id: true,
        nodeId: true,
        name: true,
        parentId: true,
        portfolioId: true,
        // Detail page (Task 3.3) renders these via toPortfolioNodeViewModel.
        description: true,
        governance: true,
        enrichment: true,
      },
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
 * Returns annual budget metric per portfolio slug with visible source
 * provenance. Seeded placeholders remain visible as placeholders until a
 * connected finance/setup source replaces them.
 * React cache() deduplicates across layout + page within one request.
 */
export const getPortfolioBudgets = cache(async (): Promise<Record<string, PortfolioBudgetMetric>> => {
  const portfolios = await prisma.portfolio.findMany({
    select: { slug: true, budgetKUsd: true },
  });
  return Object.fromEntries(
    portfolios.map((p) => [p.slug, getPortfolioBudgetMetric(p.slug, p.budgetKUsd)])
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

// ─── Aggregated Portfolio Summary ────────────────────────────────────────────

export type LifecycleStageCounts = Record<string, number>;

export type PortfolioSummary = {
  totalProducts: number;
  activeProducts: number;
  draftProducts: number;
  retiredProducts: number;
  lifecycleStages: LifecycleStageCounts;
  openBacklogItems: number;
  inProgressBacklogItems: number;
  openEpics: number;
  totalAgents: number;
  activeAgents: number;
};

/**
 * Aggregated cross-portfolio summary for the portfolio overview page.
 * Queries product lifecycle distribution, backlog health, and agent counts.
 */
export const getPortfolioSummary = cache(async (): Promise<PortfolioSummary> => {
  const [
    lifecycleGroups,
    statusGroups,
    backlogCounts,
    epicCounts,
    selectableAgentRows,
  ] = await Promise.all([
    prisma.digitalProduct.groupBy({
      by: ["lifecycleStage"],
      _count: { id: true },
    }),
    prisma.digitalProduct.groupBy({
      by: ["lifecycleStatus"],
      _count: { id: true },
    }),
    prisma.backlogItem.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.epic.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    // BI-B939790B: count the SAME canonical roster the /workforce cockpit shows —
    // selectable coworkers (active · production · not-archived) with dual-seed alias
    // twins collapsed — instead of raw Agent rows. A raw groupBy summed alias twins,
    // draft, and retired rows into "114 total / 97 active" beside /workforce's 76.
    prisma.agent.findMany({
      where: SELECTABLE_COWORKER_STATE,
      select: { agentId: true },
    }),
  ]);
  const rosterAgentCount = dropDualSeedAliasAgents(selectableAgentRows).length;

  const lifecycleStages: LifecycleStageCounts = {};
  let totalProducts = 0;
  for (const g of lifecycleGroups) {
    lifecycleStages[g.lifecycleStage] = g._count.id;
    totalProducts += g._count.id;
  }

  const statusByName = new Map(statusGroups.map(g => [g.lifecycleStatus, g._count.id]));
  const backlogByStatus = new Map(backlogCounts.map(g => [g.status, g._count.id]));
  const epicByStatus = new Map(epicCounts.map(g => [g.status, g._count.id]));

  return {
    totalProducts,
    activeProducts: statusByName.get("active") ?? 0,
    draftProducts: statusByName.get("draft") ?? 0,
    retiredProducts: statusByName.get("retired") ?? 0,
    lifecycleStages,
    openBacklogItems: backlogByStatus.get("open") ?? 0,
    inProgressBacklogItems: backlogByStatus.get("in-progress") ?? 0,
    openEpics: epicByStatus.get("open") ?? 0,
    totalAgents: rosterAgentCount,
    activeAgents: rosterAgentCount,
  };
});
