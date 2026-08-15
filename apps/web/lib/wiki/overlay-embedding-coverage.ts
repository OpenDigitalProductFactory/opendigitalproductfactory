// BI-D4C1E05E — read model for the governance UI's embedding-coverage indicator.
//
// "ACTIVE" in the governance list means the WikiPage row is published. It does
// NOT mean the page is embedded, and only an embedded page is retrievable by the
// decision engine (wiki_query / principle_decide). Surfacing published-vs-embedded
// stops "ACTIVE" from overstating readiness: an operator can see at a glance that
// a stance is published but not yet counting, and that the reembed reconcile will
// close the gap on the next upgrade boot.
//
// This mirrors reconcilePublishedWikiEmbeddings' scan (published rows ∩ vector
// points) but is ORG-SCOPED and read-only — it never embeds. Fail-open: on any
// store error it reports what it can rather than throwing into the page render.

import { prisma, QDRANT_COLLECTIONS, scrollPoints } from "@dpf/db";

const PAGE_SCAN_LIMIT = 2_000;
const VECTOR_SCAN_LIMIT = 20_000;

export type OverlayEmbeddingCoverage = {
  /** Published org-overlay pages (the ones the governance list shows as ACTIVE). */
  published: number;
  /** Of those, how many have a `wiki-pages` vector row (retrievable). */
  embedded: number;
  /** published − embedded: published but NOT retrievable yet. */
  pending: number;
  /** Slugs of pending pages (capped) so the UI can name what is not counting. */
  pendingSlugs: string[];
  /** True when the coverage scan itself failed (store unreachable) — fail-open. */
  degraded: boolean;
};

export async function getOverlayEmbeddingCoverage(
  organizationId: string,
): Promise<OverlayEmbeddingCoverage> {
  try {
    const [pages, points] = await Promise.all([
      prisma.wikiPage.findMany({
        where: { organizationId, status: "published", isKernel: false },
        select: { id: true, slug: true },
        take: PAGE_SCAN_LIMIT,
        orderBy: { slug: "asc" },
      }),
      scrollPoints(
        QDRANT_COLLECTIONS.WIKI_PAGES,
        { must: [{ key: "entityType", match: { value: "wiki-page" } }] },
        VECTOR_SCAN_LIMIT,
      ),
    ]);
    const present = new Set(
      points
        .map((point) => point.payload.entityId)
        .filter((id): id is string => typeof id === "string"),
    );
    const pendingSlugs = pages.filter((p) => !present.has(p.id)).map((p) => p.slug);
    return {
      published: pages.length,
      embedded: pages.length - pendingSlugs.length,
      pending: pendingSlugs.length,
      pendingSlugs: pendingSlugs.slice(0, 50),
      degraded: false,
    };
  } catch {
    return { published: 0, embedded: 0, pending: 0, pendingSlugs: [], degraded: true };
  }
}
