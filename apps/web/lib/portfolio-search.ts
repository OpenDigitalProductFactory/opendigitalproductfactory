import { prisma } from "@dpf/db";
import type { SearchMatch, PortfolioSearchResult } from "./feature-build-types";

export function scoreKeywordMatch(
  query: string,
  name: string,
  description: string | null,
): number {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return 0;

  const nameLower = name.toLowerCase();
  const descLower = (description ?? "").toLowerCase();
  let score = 0;

  for (const kw of keywords) {
    if (nameLower === kw) {
      score += 10;
    } else if (nameLower.includes(kw)) {
      score += 5;
    } else if (descLower.includes(kw)) {
      score += 2;
    }
  }

  return score;
}

export function rankMatches<T extends { relevanceScore: number }>(
  matches: T[],
  maxResults = 5,
): T[] {
  return matches
    .filter((m) => m.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);
}

export async function searchPortfolioContext(
  query: string,
  portfolioId?: string | null,
): Promise<PortfolioSearchResult> {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) {
    return { taxonomyMatches: [], productMatches: [], buildMatches: [], backlogMatches: [] };
  }

  const textConditions = (fields: string[]) =>
    keywords.flatMap((kw) =>
      fields.map((field) => ({ [field]: { contains: kw, mode: "insensitive" as const } })),
    );

  const [taxonomyRows, productRows, buildRows, backlogRows] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { OR: textConditions(["name", "description"]) },
      select: { id: true, nodeId: true, name: true, description: true, portfolioId: true },
      take: 20,
    }),
    prisma.digitalProduct.findMany({
      where: { OR: textConditions(["name", "description"]) },
      select: { id: true, productId: true, name: true, description: true, lifecycleStage: true, portfolioId: true },
      take: 20,
    }),
    prisma.featureBuild.findMany({
      where: {
        phase: { notIn: ["complete", "failed"] },
        OR: textConditions(["title", "description"]),
      },
      select: { id: true, buildId: true, title: true, description: true, phase: true, portfolioId: true },
      take: 10,
    }),
    prisma.backlogItem.findMany({
      where: {
        status: { in: ["open", "in-progress"] },
        OR: textConditions(["title", "body"]),
      },
      select: { id: true, itemId: true, title: true, body: true, status: true, epicId: true },
      take: 10,
    }),
  ]);

  const boostPortfolio = (score: number, rowPortfolioId: string | null) =>
    portfolioId && rowPortfolioId === portfolioId ? score * 1.5 : score;

  const taxonomyMatches: SearchMatch[] = rankMatches(
    taxonomyRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.nodeId,
      description: r.description,
      relevanceScore: boostPortfolio(scoreKeywordMatch(query, r.name, r.description), r.portfolioId),
    })),
  );

  const productMatches: SearchMatch[] = rankMatches(
    productRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.productId,
      description: r.description,
      relevanceScore: boostPortfolio(scoreKeywordMatch(query, r.name, r.description), r.portfolioId),
      context: r.lifecycleStage,
    })),
  );

  const buildMatches: SearchMatch[] = rankMatches(
    buildRows.map((r) => ({
      id: r.id,
      name: r.title,
      slug: r.buildId,
      description: r.description,
      relevanceScore: boostPortfolio(scoreKeywordMatch(query, r.title, r.description), r.portfolioId),
      context: r.phase,
    })),
  );

  const backlogMatches: SearchMatch[] = rankMatches(
    backlogRows.map((r) => ({
      id: r.id,
      name: r.title,
      slug: r.itemId,
      description: r.body,
      relevanceScore: scoreKeywordMatch(query, r.title, r.body),
      context: r.status,
    })),
  );

  return { taxonomyMatches, productMatches, buildMatches, backlogMatches };
}
