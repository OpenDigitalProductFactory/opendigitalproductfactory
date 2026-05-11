// EP-WIKI-001 Phase 3a: passive wiki context recall.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §3.6 + §7
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 3)
//
// `recallWikiContext()` runs at message-assembly time alongside
// `recallRelevantContext()` (semantic memory). Its output is injected
// into Block 5 of the system prompt (Domain context), below the
// dynamic boundary marker. This is the "passive context injection"
// path described in spec §3.6 — the agent gets grounded answers
// without the user having to invoke a tool.
//
// The MCP tool surface (`wiki_query`, `wiki_propose_edit`) lands in
// Phase 3b; this PR is the passive path only.

import { searchWikiPages, type WikiSearchResult } from "./embeddings";

// ─── Public types ───────────────────────────────────────────────────────────

export type RecallWikiContextInput = {
  /** The user's message or query, embedded against the wiki-pages collection. */
  query: string;
  /** Tenant context. Pass `null` for kernel-only retrieval (admin / public surfaces). */
  organizationId: string | null;
  /** Optional route hint surfaced as context to the model. Free-form. */
  routeContext?: string | null;
  /** Total results to retrieve across the two-pass search. Default 4. */
  limit?: number;
  /** Cosine score threshold per pass. Default 0.55 (matches `searchWikiPages`). */
  scoreThreshold?: number;
};

// ─── Pure formatter ─────────────────────────────────────────────────────────

/**
 * Render search results as a prompt context block. Pure — no I/O.
 *
 * Returns `null` when there are no results, so callers can skip the
 * Block 5 insertion entirely instead of adding an empty header.
 *
 * Each line is `- <slug> (<pageKind>, kernel|overlay) — <preview>`.
 * The preview is the first 240 chars of the page's stored
 * contentPreview, normalised to a single line.
 */
export function formatWikiContext(results: WikiSearchResult[]): string | null {
  if (results.length === 0) return null;

  const lines = results.map((r) => {
    const origin = r.source === "kernel" ? "kernel" : "overlay";
    const preview = (r.contentPreview ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    return `- ${r.slug} (${r.pageKind}, ${origin}) — ${preview}`;
  });

  return `RELEVANT WIKI CONTEXT:\n${lines.join("\n")}`;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Embed the query, run the overlay-aware two-pass search, and format
 * the result as a prompt context block.
 *
 * Silent-degradation contract: returns `null` on embedding failure or
 * empty result, so the caller can drop the wiki block from Block 5
 * without affecting the rest of the prompt. Matches the
 * `recallRelevantContext` pattern used by EP-MEMORY-001.
 */
export async function recallWikiContext(
  input: RecallWikiContextInput,
): Promise<string | null> {
  try {
    const results = await searchWikiPages({
      query: input.query,
      organizationId: input.organizationId,
      limit: input.limit ?? 4,
      scoreThreshold: input.scoreThreshold,
    });
    return formatWikiContext(results);
  } catch (err) {
    // Wiki retrieval is best-effort; never throw into the prompt pipeline.
    console.warn("[recallWikiContext] failed:", err);
    return null;
  }
}
