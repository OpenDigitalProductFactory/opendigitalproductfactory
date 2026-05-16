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
import {
  recallPrincipleContext,
  type PrincipleAppliesToPopulation,
} from "./principle-recall";

// ─── Per-org retrieval mode (EP-WIKI-004) ───────────────────────────────────

/**
 * Read the org's `wikiRetrievalMode` config. Returns "vector" (the
 * default) when the org is missing, the column hasn't been migrated, or
 * any read error — same fail-open posture as the rest of this module.
 *
 * Lazy-imports prisma so the orchestrator stays testable without a DB
 * stub when the caller passes an explicit mode override.
 */
async function resolveRetrievalMode(
  organizationId: string | null,
): Promise<"vector" | "ppr"> {
  if (organizationId === null) return "vector";
  try {
    const { prisma } = await import("@dpf/db");
    const row = (await prisma.organization.findFirst({
      where: { id: organizationId },
      select: { wikiRetrievalMode: true },
    })) as { wikiRetrievalMode: string | null } | null;
    return row?.wikiRetrievalMode === "ppr" ? "ppr" : "vector";
  } catch (err) {
    console.warn("[recallWikiContext] retrieval-mode lookup failed:", err);
    return "vector";
  }
}

/**
 * Route the seed search to vector-only OR vector→PPR→combine based on
 * the org's wikiRetrievalMode. The PPR path is purely additive: it falls
 * back to vector-only when the subgraph is sparse (no edges) or when
 * the seed set is empty. Either path returns `WikiSearchResult[]`.
 */
async function runSeedSearch(
  input: RecallWikiContextInput,
  mode: "vector" | "ppr",
): Promise<WikiSearchResult[]> {
  if (mode === "ppr") {
    const { searchByPPR } = await import("./ppr");
    const { prisma } = await import("@dpf/db");
    return searchByPPR({
      query: input.query,
      organizationId: input.organizationId,
      limit: input.limit ?? 4,
      db: prisma,
    });
  }
  return searchWikiPages({
    query: input.query,
    organizationId: input.organizationId,
    limit: input.limit ?? 4,
    scoreThreshold: input.scoreThreshold,
  });
}

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
    const mode = await resolveRetrievalMode(input.organizationId);
    const results = await runSeedSearch(input, mode);
    return formatWikiContext(results);
  } catch (err) {
    // Wiki retrieval is best-effort; never throw into the prompt pipeline.
    console.warn("[recallWikiContext] failed:", err);
    return null;
  }
}

// ─── Principle-aware variant ────────────────────────────────────────────────

export type RecallWikiContextWithPrinciplesInput = RecallWikiContextInput & {
  /**
   * Population whose principles should apply. Drives the principle recall
   * branch — commandments are always injected for in-scope rows; relevant
   * core and contextual principles are pulled from Qdrant.
   */
  callingPopulation: PrincipleAppliesToPopulation;
};

export type RecallWikiContextWithPrinciplesResult = {
  /** Background wiki context (entity / stance / heuristic / etc.). */
  wikiBlock: string | null;
  /** Governance principles. Rendered separately so the prompt assembler can inject distinct sections. */
  principleBlock: string | null;
};

/**
 * Principle-aware companion to `recallWikiContext`. Runs the two
 * retrievals in parallel and returns both blocks separately so the
 * prompt assembler can render them into distinct sections (background
 * vs. governance).
 *
 * Silent-degradation contract:
 * - Wiki retrieval failure → `wikiBlock: null`, principles still surface.
 * - Principle retrieval failure (or all branches empty) → `principleBlock: null`,
 *   wiki still surfaces.
 * - Both failing → `{ wikiBlock: null, principleBlock: null }`; the
 *   prompt skips both blocks rather than throwing.
 *
 * Existing `recallWikiContext` callers are unchanged — this is additive.
 * Switch to this function when the calling context has a known
 * population (coworker chat, agent prompt assembly with grant scope).
 */
export async function recallWikiContextWithPrinciples(
  input: RecallWikiContextWithPrinciplesInput,
): Promise<RecallWikiContextWithPrinciplesResult> {
  const wikiPromise = (async () => {
    try {
      const mode = await resolveRetrievalMode(input.organizationId);
      const results = await runSeedSearch(input, mode);
      return formatWikiContext(results);
    } catch (err) {
      console.warn("[recallWikiContextWithPrinciples] wiki branch failed:", err);
      return null;
    }
  })();

  const principlePromise = (async () => {
    try {
      const result = await recallPrincipleContext({
        query: input.query,
        organizationId: input.organizationId,
        callingPopulation: input.callingPopulation,
      });
      return result?.block ?? null;
    } catch (err) {
      console.warn(
        "[recallWikiContextWithPrinciples] principle branch failed:",
        err,
      );
      return null;
    }
  })();

  const [wikiBlock, principleBlock] = await Promise.all([
    wikiPromise,
    principlePromise,
  ]);

  return { wikiBlock, principleBlock };
}
