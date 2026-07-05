// Backlog → portfolio attribution (BI-PORTPRIO-1). BacklogItem links to a
// portfolio only indirectly (via its digital product, taxonomy node, or epic).
// This resolves that to a denormalized BacklogItem.portfolioId cache so the
// backlog can be grouped, budgeted, and ranked per portfolio (BI-PORTPRIO-3/4).
//
// The indirect links remain authoritative; portfolioId is a cache refreshed on
// create + by backfill.

import { prisma } from "./client";

/** The portfolio-bearing relations of a backlog item, as loaded for resolution. */
export interface BacklogPortfolioLinks {
  digitalProduct?: { portfolioId: string | null } | null;
  taxonomyNode?: { portfolioId: string | null } | null;
  coworkerNeeds?: Array<{ agent?: { portfolioId: string | null } | null }> | null;
  epic?: { portfolios?: Array<{ portfolioId: string }> } | null;
}

/**
 * Resolve a backlog item's portfolio by precedence: its digital product, then
 * its taxonomy node, then linked AI coworker capability need ownership, then
 * its epic's first portfolio. Returns null when none of the links carry a
 * portfolio.
 */
export function resolveBacklogPortfolio(links: BacklogPortfolioLinks): string | null {
  const coworkerNeedPortfolio =
    links.coworkerNeeds?.find((need) => need.agent?.portfolioId)?.agent?.portfolioId ?? null;
  return (
    links.digitalProduct?.portfolioId ??
    links.taxonomyNode?.portfolioId ??
    coworkerNeedPortfolio ??
    links.epic?.portfolios?.[0]?.portfolioId ??
    null
  );
}

/** Prisma read/write subset used here — satisfied by PrismaClient and test fakes. */
export type BacklogPortfolioClient = {
  backlogItem: {
    findUnique: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

const LINK_SELECT = {
  id: true,
  portfolioId: true,
  digitalProduct: { select: { portfolioId: true } },
  taxonomyNode: { select: { portfolioId: true } },
  coworkerNeeds: { select: { agent: { select: { portfolioId: true } } } },
  epic: { select: { portfolios: { select: { portfolioId: true } } } },
} as const;

type LinkedItem = {
  id: string;
  portfolioId: string | null;
} & BacklogPortfolioLinks;

/**
 * Resolve + persist a single backlog item's portfolioId from its links. Call on
 * create / triage so new items are attributed immediately. No-op when the
 * resolved value already matches. Returns the resolved portfolioId (or null).
 */
export async function attributeBacklogPortfolio(
  itemId: string,
  options: { db?: BacklogPortfolioClient } = {},
): Promise<string | null> {
  const db = options.db ?? (prisma as unknown as BacklogPortfolioClient);
  const item = (await db.backlogItem.findUnique({
    where: { id: itemId },
    select: LINK_SELECT,
  })) as LinkedItem | null;
  if (!item) return null;
  const resolved = resolveBacklogPortfolio(item);
  if (resolved !== item.portfolioId) {
    await db.backlogItem.update({ where: { id: itemId }, data: { portfolioId: resolved } });
  }
  return resolved;
}

/** Backfill portfolioId across all backlog items (idempotent). */
export async function backfillBacklogPortfolios(
  options: { db?: BacklogPortfolioClient } = {},
): Promise<{ scanned: number; updated: number }> {
  const db = options.db ?? (prisma as unknown as BacklogPortfolioClient);
  const items = (await db.backlogItem.findMany({ select: LINK_SELECT })) as LinkedItem[];
  let updated = 0;
  for (const item of items) {
    const resolved = resolveBacklogPortfolio(item);
    if (resolved !== null && resolved !== item.portfolioId) {
      await db.backlogItem.update({ where: { id: item.id }, data: { portfolioId: resolved } });
      updated++;
    }
  }
  return { scanned: items.length, updated };
}

export interface BacklogPortfolioGroup {
  /** The portfolio root id, or null for backlog not attributable to a portfolio. */
  portfolioId: string | null;
  count: number;
  /** Count of items by effortSize (for budget-vs-allocated, BI-PORTPRIO-3). */
  effortBreakdown: Record<string, number>;
}

/** Group backlog items by portfolio (optionally filtered to statuses). */
export async function getBacklogByPortfolio(
  options: { db?: BacklogPortfolioClient; statuses?: string[] } = {},
): Promise<BacklogPortfolioGroup[]> {
  const db = options.db ?? (prisma as unknown as BacklogPortfolioClient);
  const where = options.statuses ? { status: { in: options.statuses } } : {};
  const items = (await db.backlogItem.findMany({
    where,
    select: { portfolioId: true, effortSize: true },
  })) as Array<{ portfolioId: string | null; effortSize: string | null }>;

  const groups = new Map<string | null, BacklogPortfolioGroup>();
  for (const it of items) {
    const group = groups.get(it.portfolioId) ?? {
      portfolioId: it.portfolioId,
      count: 0,
      effortBreakdown: {},
    };
    group.count++;
    if (it.effortSize) {
      group.effortBreakdown[it.effortSize] = (group.effortBreakdown[it.effortSize] ?? 0) + 1;
    }
    groups.set(it.portfolioId, group);
  }
  return Array.from(groups.values());
}
