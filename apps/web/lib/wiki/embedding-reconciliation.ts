import { prisma, VECTOR_COLLECTIONS, scrollPoints } from "@dpf/db";
import { digestOfPoint, wikiEmbeddingDigest } from "@dpf/db/wiki-embedding-digest";

import { storeWikiPage } from "./embeddings";
import { isEmbeddingAvailable } from "@/lib/inference/embedding";

const DEFAULT_PAGE_LIMIT = 500;
const VECTOR_SCAN_LIMIT = 10_000;

export type WikiEmbeddingReconciliationResult = {
  scanned: number;
  /** Published pages with no vector at all. */
  missing: number;
  /**
   * Published pages whose vector was computed from different text than the page
   * now carries — or from text nobody recorded (a point written before content
   * digests existed). BI-F039D17A: a release that edits a page's prose used to
   * leave these matching the old wording forever, because only `missing` was
   * repaired.
   */
  stale: number;
  /** Pages re-embedded on this run (missing + stale that succeeded). */
  embedded: number;
  /** Slugs re-embedded on this run, so a run can say WHAT it refreshed. */
  refreshed: string[];
  failed: string[];
  /**
   * Pages that needed work but were left for the next run because the caller's
   * time budget ran out. Not a failure: the digest keys the work, so the next
   * run (boot, the two-hourly schedule, or a restart) picks up exactly these.
   */
  deferred: number;
  /**
   * Dry run only — the freshness check. Every page that is not current, and
   * why, so the check NAMES stale pages instead of only counting them.
   */
  pending?: Array<{ slug: string; reason: "missing" | "stale" }>;
  /** True when nothing was attempted because the embedding provider was down.
   *  Distinguishes "nothing to do" from "could not do anything" (BI-ED117C82). */
  providerUnavailable?: boolean;
};

type ReconcilePage = {
  id: string; slug: string; title: string; body: string; abstract: string | null;
  pageKind: string; status: string; isKernel: boolean; kernelVersion: string | null;
  organizationId: string | null; kernelPageId: string | null; principleTier: string | null;
  principleAppliesTo: string[]; principleRingScope: string[];
  principleDimensionVector: unknown; principlePublic: boolean | null;
};

/**
 * Converge the `wiki-pages` vector store on the published corpus.
 *
 * A page needs work when it has no vector (`missing`) or when its vector's
 * recorded content digest differs from the digest of the page's current text
 * (`stale`, BI-F039D17A). Unchanged pages are never re-embedded. The digest is
 * the whole of the state: there is no job cursor, so the run is idempotent and
 * a restart mid-run simply resumes with whatever is still missing or stale.
 */
export async function reconcilePublishedWikiEmbeddings(input: {
  kind?: string | null;
  limit?: number;
  dryRun?: boolean;
  /** Stop starting new embeds after this many ms; the rest are `deferred`. */
  budgetMs?: number;
  /** Injectable clock for the budget (tests). */
  now?: () => number;
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
    }) as Promise<ReconcilePage[]>,
    scrollPoints(VECTOR_COLLECTIONS.WIKI_PAGES, {
      must: [{ key: "entityType", match: { value: "wiki-page" } }],
    }, Math.max(VECTOR_SCAN_LIMIT, limit)),
  ]);
  // entityId -> recorded digest (null when the point predates digests).
  const pointDigest = new Map<string, string | null>();
  for (const point of points) {
    const id = point.payload.entityId;
    if (typeof id === "string") pointDigest.set(id, digestOfPoint(point.payload));
  }
  const missing: ReconcilePage[] = [];
  const stale: ReconcilePage[] = [];
  for (const page of pages) {
    if (!pointDigest.has(page.id)) missing.push(page);
    else if (pointDigest.get(page.id) !== wikiEmbeddingDigest(page)) stale.push(page);
  }
  // Missing first: a page with no vector is invisible, a stale one is merely dated.
  const work = [...missing, ...stale];
  const base = { scanned: pages.length, missing: missing.length, stale: stale.length };
  if (input.dryRun) {
    return {
      ...base, embedded: 0, refreshed: [], failed: [], deferred: work.length,
      pending: [
        ...missing.map((page) => ({ slug: page.slug, reason: "missing" as const })),
        ...stale.map((page) => ({ slug: page.slug, reason: "stale" as const })),
      ],
    };
  }

  // BI-ED117C82: when the embedding provider is down, EVERY page fails for the
  // same reason and the run is not a reconcile at all — it is a no-op that
  // previously read as "scanned N, embedded 0", indistinguishable from a healthy
  // corpus needing nothing. Detect that up front and say so, so a caller can
  // retry later instead of recording a clean pass.
  const providerAvailable = work.length === 0 || await isEmbeddingAvailable().catch(() => false);
  if (!providerAvailable) {
    return {
      ...base,
      embedded: 0,
      refreshed: [],
      failed: work.map((page) => page.slug),
      deferred: 0,
      providerUnavailable: true,
    };
  }

  const now = input.now ?? Date.now;
  const deadline = input.budgetMs === undefined ? Number.POSITIVE_INFINITY : now() + input.budgetMs;
  const refreshed: string[] = [];
  const failed: string[] = [];
  let deferred = 0;
  for (const page of work) {
    if (now() >= deadline) {
      deferred += 1;
      continue;
    }
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
      if (ok) refreshed.push(page.slug);
      else failed.push(page.slug);
    } catch {
      failed.push(page.slug);
    }
  }
  return { ...base, embedded: refreshed.length, refreshed, failed, deferred };
}

export function summariseSlugs(slugs: readonly string[], max = 10): string {
  return slugs.slice(0, max).join(", ") + (slugs.length > max ? ` (+${slugs.length - max} more)` : "");
}

/** Pages whose vector matches their current text after a run. */
export function currentCount(result: WikiEmbeddingReconciliationResult): number {
  return result.scanned - result.failed.length - result.deferred;
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
    const covered = currentCount(result);

    if (result.providerUnavailable) {
      logger.warn(
        `[wiki-embeddings] Coverage ${covered}/${result.scanned}; ${result.missing} page(s) unembedded and `
        + `${result.stale} with a stale vector. `
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
      + (result.embedded > 0 ? ` (re-embedded ${result.embedded}: ${summariseSlugs(result.refreshed)})` : "")
      + (result.deferred > 0 ? `; ${result.deferred} deferred to the next run` : ""),
    );
    return result;
  } catch (err) {
    logger.error("[wiki-embeddings] Boot reconcile failed (non-fatal):", err);
    return null;
  }
}

/**
 * Register the boot self-heal without blocking startup. Deferred because this is
 * repair, not a boot precondition — it must never delay serving. Lives here
 * rather than in `instrumentation.ts` so the scheduling policy sits beside the
 * work it schedules.
 */
export function scheduleWikiEmbeddingReconcile(delayMs = 10_000): void {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(() => {
    void reconcileWikiEmbeddingsOnBoot();
  }, delayMs).unref?.();
}
