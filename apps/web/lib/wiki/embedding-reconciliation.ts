import { prisma, QDRANT_COLLECTIONS, scrollPoints } from "@dpf/db";

import { storeWikiPage } from "./embeddings";
import { isEmbeddingAvailable } from "@/lib/inference/embedding";

const DEFAULT_PAGE_LIMIT = 500;
const VECTOR_SCAN_LIMIT = 10_000;

export type WikiEmbeddingReconciliationResult = {
  scanned: number;
  missing: number;
  embedded: number;
  failed: string[];
  /** True when nothing was attempted because the embedding provider was down.
   *  Distinguishes "nothing to do" from "could not do anything" (BI-ED117C82). */
  providerUnavailable?: boolean;
};

export async function reconcilePublishedWikiEmbeddings(input: {
  kind?: string | null;
  limit?: number;
  dryRun?: boolean;
} = {}): Promise<WikiEmbeddingReconciliationResult> {
  // BI-D4C1E05E: this reconcile is now the fleet self-heal wired into portal boot,
  // so its page limit must be RAISABLE (the maintainer/boot path passes a full-corpus
  // limit). The default stays DEFAULT_PAGE_LIMIT for the fire-and-forget recall
  // callers that want it bounded — but the old unraisable `Math.min(..., 500)` cap
  // would have left any install with >500 published pages self-healing only an
  // arbitrary subset, permanently skipping the unembedded stance that motivated
  // this BI. Order by `updatedAt desc` so a just-authored (most-recently-touched)
  // unembedded page is covered first when a limit does bite. The point scan is
  // scaled to the page limit so a large corpus doesn't falsely re-embed already-
  // embedded pages (an incomplete point set only wastes work — it never misses a
  // genuinely-missing page).
  const limit = Math.max(1, input.limit ?? DEFAULT_PAGE_LIMIT);
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
      orderBy: { updatedAt: "desc" },
    }),
    scrollPoints(QDRANT_COLLECTIONS.WIKI_PAGES, {
      must: [{ key: "entityType", match: { value: "wiki-page" } }],
    }, Math.max(VECTOR_SCAN_LIMIT, limit)),
  ]);
  const present = new Set(points
    .map((point) => point.payload.entityId)
    .filter((id): id is string => typeof id === "string"));
  const missing = pages.filter((page) => !present.has(page.id));
  if (input.dryRun) return { scanned: pages.length, missing: missing.length, embedded: 0, failed: [] };

  // BI-ED117C82: when the embedding provider is down, EVERY page fails for the
  // same reason and the run is not a reconcile at all — it is a no-op that
  // previously read as "scanned N, embedded 0", indistinguishable from a healthy
  // corpus needing nothing. Detect that up front and say so, so a caller can
  // retry later instead of recording a clean pass.
  const providerAvailable = missing.length === 0 || await isEmbeddingAvailable().catch(() => false);
  if (!providerAvailable) {
    return {
      scanned: pages.length,
      missing: missing.length,
      embedded: 0,
      failed: missing.map((page) => page.slug),
      providerUnavailable: true,
    };
  }

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

/**
 * Boot self-heal for the wiki vector index (BI-ED117C82).
 *
 * `reconcilePublishedWikiEmbeddings` has carried a comment since BI-D4C1E05E
 * saying it is "the fleet self-heal wired into portal boot". It was not wired to
 * anything: the only callers were the maintainer script and its tests. A live
 * install was found on 2026-08-15 with a published org stance carrying no
 * vector, 16 of 17 embedded, on a portal booted well after the page was
 * authored — the self-heal that was supposed to repair it had never run.
 *
 * That matters beyond one page: an unembedded stance degrades stance relevance
 * to lexical, and the BI-7E1F128A fail-safe then escalates by design. A silent
 * embedding gap surfaces to the operator as "the AI keeps asking me things it
 * should already know".
 *
 * Non-fatal by contract — a boot hook must not take the portal down — but it
 * reports coverage as a NUMBER and names the provider outage explicitly rather
 * than logging a clean pass it did not achieve. Retry is left to the next boot
 * or the maintainer script; this call deliberately does not loop.
 */
export async function reconcileWikiEmbeddingsOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<WikiEmbeddingReconciliationResult | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  try {
    // Full corpus: a bounded scan would let the limit silently decide which
    // pages stay invisible to retrieval.
    const result = await reconcilePublishedWikiEmbeddings({ limit: Number.MAX_SAFE_INTEGER });
    const covered = result.scanned - result.failed.length;

    if (result.providerUnavailable) {
      logger.warn(
        `[wiki-embeddings] Coverage ${covered}/${result.scanned}; ${result.missing} page(s) still unembedded. `
        + "Embedding provider unavailable, so NOTHING was re-embedded — this is not a clean pass. "
        + "Retrying on next boot; run scripts/reembed-wiki-store.ts once the provider is reachable.",
      );
      return result;
    }

    if (result.failed.length > 0) {
      logger.warn(
        `[wiki-embeddings] Coverage ${covered}/${result.scanned} after re-embedding ${result.embedded}. `
        + `Still failing: ${result.failed.slice(0, 10).join(", ")}`
        + (result.failed.length > 10 ? ` (+${result.failed.length - 10} more)` : ""),
      );
      return result;
    }

    logger.log(
      `[wiki-embeddings] Coverage ${covered}/${result.scanned}`
      + (result.embedded > 0 ? ` (re-embedded ${result.embedded})` : ""),
    );
    return result;
  } catch (err) {
    logger.error("[wiki-embeddings] Boot reconcile failed (non-fatal):", err);
    return null;
  }
}
