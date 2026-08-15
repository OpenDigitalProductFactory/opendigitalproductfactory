// BI-D4C1E05E: the ONE place a published org-overlay page becomes retrievable
// WWWD/decision context (its `wiki-pages` vector-store row).
//
// THE DEFECT THIS CLOSES
// Every path that flips an org-overlay page to `published` promoted decision
// material but did NOT embed the page, so the stance existed in Postgres and in
// the governance list yet was invisible to vector retrieval (`wiki_query`,
// `principle_decide`, `evaluate_org_business_decision`). An operator publishes a
// stance, the UI says "your AI now weighs this", and no decision path can see it.
// This is the embedding sibling of BI-8AC24F3D's `promoteCraftOverrideOnPublish`:
// a publish that structurally succeeds and functionally does nothing.
//
// The fix is one implementation with every publish caller, not a per-action
// best-effort try/catch that swallows the skip. Keeping this in a plain module
// (not a "use server" file) is deliberate — every export of a "use server"
// module becomes a callable server action, and this helper must not be reachable
// as its own endpoint. Same shape as `craft-override-promotion.ts`.

import { storeWikiPage } from "@/lib/wiki/embeddings";
import { isEmbeddingAvailable } from "@/lib/inference/embedding";

/** The page fields embedding needs. Satisfied by rows every publish caller already has. */
export type EmbeddableOverlayPage = {
  id: string;
  slug: string;
  title: string;
  body: string;
  abstract: string | null;
  pageKind: string;
};

export type OverlayEmbedOutcome =
  | { embedded: true; slug: string }
  | { embedded: false; slug: string; reason: "provider-unavailable" | "error" };

/**
 * Embed a just-published org-overlay page into the `wiki-pages` vector store so
 * it is retrievable as WWWD/decision context. Publishing a stance/overlay page
 * IS the operator's approval — this is the retrieval sibling of
 * `promoteCraftOverrideOnPublish`'s enforcement.
 *
 * NEVER THROWS, and callers must never roll back the publish on a failed embed:
 * the status flip has already happened and the reembed reconcile
 * (`scripts/reembed-wiki-store.ts`, wired into portal boot) self-heals any
 * missed page on the next upgrade. A failed embed is a LOUD warning, never a
 * silent skip — that silence was the bug.
 */
export async function embedPublishedOverlayPage(input: {
  page: EmbeddableOverlayPage;
  organizationId: string;
  /** Where the call came from, for the log line only. */
  origin: string;
}): Promise<OverlayEmbedOutcome> {
  const { page, organizationId, origin } = input;

  const doStore = (): Promise<boolean> =>
    storeWikiPage({
      pageId: page.id,
      slug: page.slug,
      title: page.title,
      body: page.body,
      abstract: page.abstract,
      pageKind: page.pageKind,
      status: "published",
      isKernel: false,
      kernelVersion: null,
      organizationId,
      kernelPageId: null,
    });

  try {
    let ok = await doStore();
    if (!ok) {
      // Idle-evict-safe warm-then-retry: the Docker Model Runner can evict the
      // embed model after idle, so the first `generateEmbedding` returns null.
      // Probing `/models` warms the runner; retry once before declaring a skip.
      const up = await isEmbeddingAvailable();
      if (up) ok = await doStore();
    }
    if (ok) return { embedded: true, slug: page.slug };

    console.error(
      `[embed-published-overlay] EMBED-SKIPPED slug=${page.slug} origin=${origin} — ` +
        "published page was NOT embedded (embedding provider unavailable after warm+retry), " +
        "so it is invisible to wiki_query / principle_decide until the reembed reconcile runs. " +
        "Fix: docker model pull ai/nomic-embed-text-v1.5",
    );
    return { embedded: false, slug: page.slug, reason: "provider-unavailable" };
  } catch (err) {
    console.error(
      `[embed-published-overlay] EMBED-FAILED slug=${page.slug} origin=${origin}: ` +
        `${(err as Error).message}. Page is published but not embedded; the reembed ` +
        "reconcile will self-heal it on the next upgrade boot.",
    );
    return { embedded: false, slug: page.slug, reason: "error" };
  }
}
