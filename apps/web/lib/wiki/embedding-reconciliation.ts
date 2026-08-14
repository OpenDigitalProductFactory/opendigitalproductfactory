import { prisma, QDRANT_COLLECTIONS, scrollPoints } from "@dpf/db";

import { storeWikiPage } from "./embeddings";

const DEFAULT_PAGE_LIMIT = 500;
const VECTOR_SCAN_LIMIT = 10_000;

export type WikiEmbeddingReconciliationResult = {
  scanned: number;
  missing: number;
  embedded: number;
  failed: string[];
};

export async function reconcilePublishedWikiEmbeddings(input: {
  kind?: string | null;
  limit?: number;
  dryRun?: boolean;
} = {}): Promise<WikiEmbeddingReconciliationResult> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT));
  const [pages, points] = await Promise.all([
    prisma.wikiPage.findMany({
      where: { status: "published", ...(input.kind ? { pageKind: input.kind } : {}) },
      select: {
        id: true, slug: true, title: true, body: true, abstract: true, pageKind: true,
        status: true, isKernel: true, kernelVersion: true, organizationId: true,
        kernelPageId: true, principleTier: true, principleAppliesTo: true,
        principleRingScope: true, principleDimensionVector: true, principlePublic: true,
      },
      take: limit,
      orderBy: { id: "asc" },
    }),
    scrollPoints(QDRANT_COLLECTIONS.WIKI_PAGES, {
      must: [{ key: "entityType", match: { value: "wiki-page" } }],
    }, VECTOR_SCAN_LIMIT),
  ]);
  const present = new Set(points
    .map((point) => point.payload.entityId)
    .filter((id): id is string => typeof id === "string"));
  const missing = pages.filter((page) => !present.has(page.id));
  if (input.dryRun) return { scanned: pages.length, missing: missing.length, embedded: 0, failed: [] };

  let embedded = 0;
  const failed: string[] = [];
  for (const page of missing) {
    const dimensions = page.principleDimensionVector && typeof page.principleDimensionVector === "object"
      ? Object.keys(page.principleDimensionVector as Record<string, unknown>)
      : undefined;
    try {
      const ok = await storeWikiPage({
        pageId: page.id, slug: page.slug, title: page.title, body: page.body,
        abstract: page.abstract, pageKind: page.pageKind, status: page.status,
        isKernel: page.isKernel, kernelVersion: page.kernelVersion,
        organizationId: page.organizationId, kernelPageId: page.kernelPageId,
        ...(page.pageKind === "principle" ? {
          principleTier: page.principleTier,
          principleAppliesTo: page.principleAppliesTo,
          principleRingScope: page.principleRingScope,
          principleDimensions: dimensions,
          principlePublic: page.principlePublic ?? undefined,
        } : {}),
      });
      if (ok) embedded += 1;
      else failed.push(page.slug);
    } catch {
      failed.push(page.slug);
    }
  }
  return { scanned: pages.length, missing: missing.length, embedded, failed };
}
