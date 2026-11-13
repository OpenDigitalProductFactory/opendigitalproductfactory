// BI-F039D17A — the content digest that keys a wiki page's vector to its prose.
//
// A vector is only as current as the text it was computed from. Before this
// digest, the wiki vector store knew only whether a page HAD a vector, so a
// release that changed a kernel principle or a profession page shipped the new
// prose with the old vector: retrieval (wiki_query, principle_decide, expert
// steering) kept matching the superseded wording.
//
// Every writer of a `wiki-pages` point stamps `contentDigest` into the payload,
// and the reconcile re-embeds any published page whose current digest differs
// from (or is absent on) its point. One definition lives here so the runtime
// writer (`apps/web/lib/wiki/embeddings.ts`), the seed-time sidecar loader
// (`seed-wiki-kernel.ts`) and the sidecar builder
// (`scripts/build-kernel-embeddings.ts`) can never disagree about what text a
// vector stands for.

import { createHash } from "node:crypto";

/** Bump when the embedded-text shape changes, so every point re-embeds once. */
export const WIKI_EMBEDDING_DIGEST_VERSION = "wiki-embed-v1";

/** Vector payload key that carries the digest. */
export const WIKI_EMBEDDING_DIGEST_KEY = "contentDigest";

/**
 * The exact text a wiki page is embedded from: abstract, blank line, body.
 * Truncation to the model's input cap happens at embed time and is not part of
 * the digest — any change to the page's prose counts as a change.
 */
export function wikiEmbeddingInput(page: { abstract?: string | null; body: string }): string {
  return [page.abstract ?? "", page.body].filter(Boolean).join("\n\n");
}

/** sha256 over the versioned embedding input. Stable across processes. */
export function wikiEmbeddingDigest(page: { abstract?: string | null; body: string }): string {
  return createHash("sha256")
    .update(`${WIKI_EMBEDDING_DIGEST_VERSION}\n`)
    .update(wikiEmbeddingInput(page))
    .digest("hex");
}

/** Read the digest a vector point was stamped with, if any. */
export function digestOfPoint(payload: Record<string, unknown> | null | undefined): string | null {
  const value = payload?.[WIKI_EMBEDDING_DIGEST_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}
