// EP-WIKI-001 Phase 2.2: schema-grounding context for the LLM proposal pipeline.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2.2)
//
// The proposal pipeline is **schema-grounded, not free-form**: the LLM is
// shown the wiki's page-kind contract + the canonical entity registry +
// the list of existing slugs before extraction. Hallucinated cross-links
// and made-up page kinds are caught by parsing; structural drift is
// caught by lint at publish time.
//
// This module exports the static prompt preamble (mirrors SCHEMA.md but
// in a form the LLM ingests directly) and the helper that loads live
// existing slugs from Postgres so the LLM can target real pages rather
// than invent new ones.

// `WikiStoreClient` shape lives in @dpf/db/wiki-store; we keep the narrowed
// `SlugQueryClient` below local so test stubs don't have to satisfy every
// Prisma delegate method.

// ─── Static schema preamble ─────────────────────────────────────────────────

/**
 * Compact restatement of `docs/founder-kernel/SCHEMA.md` for inclusion in
 * the proposal pipeline's system prompt. Kept inline rather than read from
 * disk so the prompt is deterministic across deployments and round-tripped
 * by the test suite without filesystem access. When SCHEMA.md changes, this
 * constant updates in the same PR.
 */
export const SCHEMA_PROMPT_PREAMBLE = `You are extracting structured proposals to update a wiki built around founder judgment.

PAGE KINDS (exactly one per proposal):
- entity     — a first-class concept (Digital Product, Portfolio, Value Stream, etc.). Neutral, definitional.
- stance     — a position the author takes ("X is better than Y because Z"). Cited; bounded with "when this applies / when it doesn't".
- heuristic  — a rule of thumb ("When X, do Y"). Concrete, situational.
- principle  — a tiered governance rule ("Prefer A over B"). Heavier than stance, durable, machine-readable tier + dimensions.
- summary    — a condensed distillation of a single source. Must extract at least one stance or heuristic.
- decision   — a formal DEC-* style decision.
- runbook    — operational how-to.
- index      — auto-generated nav, NEVER propose this kind.

CANONICAL ENTITIES (use these slugs when an entity is referenced):
- entities/digital-product
- entities/portfolio
- entities/value-stream
- entities/it4it
- entities/csdm
- entities/agent
- entities/coworker
- entities/founder-kernel

CROSS-LINK RULES:
- Every entity reference must use [[entities/<slug>]] form.
- Every stance reference must use [[stances/<slug>]].
- Every heuristic reference must use [[heuristics/<slug>]].
- Every source citation must use [[raw-sources/<path>]].

WHAT TO EXTRACT:
1. CLAIMS: factual statements grounded in the source. Each claim targets exactly one page (an existing one to extend, or a new one to propose). Confidence in [0,1].
2. STANCES: positions the author takes — preferences, tradeoffs, "X is better than Y" framings. Each becomes a stance page.
3. HEURISTICS: rules of thumb the author articulates as actionable patterns. Each becomes a heuristic page.

NEVER:
- Invent slugs that don't follow the kind/slug convention above.
- Propose merging an existing stance into a summary page (lint flags summary-only pages).
- Output prose outside the JSON envelope. Output only valid JSON.
`;

// ─── Existing-slug snapshot ─────────────────────────────────────────────────

export type ExistingSlugSnapshot = {
  /** Every slug currently in the wiki, scoped to organization + kernel fallback. */
  all: string[];
  /** Slugs partitioned by kind for prompt readability. */
  byKind: {
    entity: string[];
    stance: string[];
    heuristic: string[];
    principle: string[];
    summary: string[];
    decision: string[];
    runbook: string[];
  };
};

/**
 * Narrow client shape this helper actually uses — only `findMany`. Defined
 * locally rather than `Pick<WikiStoreClient, "wikiPage">` so test stubs can
 * provide a minimal mock without satisfying the full delegate surface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlugQueryClient = { wikiPage: { findMany: (args: any) => Promise<unknown> } };

/**
 * Build an `ExistingSlugSnapshot` for the LLM's grounding context. Returns
 * both the flat slug list (used by the parser to validate target_slug) and
 * a per-kind partition (used in the prompt so the LLM can scan slugs of
 * the right shape).
 *
 * Scoping:
 * - `organizationId === null` returns kernel rows only.
 * - `organizationId === "<orgId>"` returns the org's overlay rows plus the
 *   kernel rows it doesn't override (matches the retrieval semantics).
 * - `organizationId === undefined` returns every row regardless of scope
 *   (used by maintainer CLIs).
 *
 * Only `status = "published"` rows are included — drafts and archived
 * pages are not valid targets for extraction proposals.
 */
export async function loadExistingSlugSnapshot(
  db: SlugQueryClient,
  args: { organizationId?: string | null } = {},
): Promise<ExistingSlugSnapshot> {
  const where: Record<string, unknown> = { status: "published" };
  if (args.organizationId === null) {
    where.organizationId = null;
  } else if (typeof args.organizationId === "string") {
    where.OR = [
      { organizationId: args.organizationId },
      { organizationId: null },
    ];
  }

  const rows = (await db.wikiPage.findMany({
    where,
    select: { slug: true, pageKind: true, organizationId: true, kernelPageId: true },
  })) as Array<{
    slug: string;
    pageKind: string;
    organizationId: string | null;
    kernelPageId: string | null;
  }>;

  // Overlay-aware dedupe: when both an org overlay and the underlying
  // kernel row are present, the overlay wins (its slug masks the kernel's).
  const slugToKind = new Map<string, string>();
  const overlaidSlugs = new Set<string>();
  for (const r of rows) {
    if (r.organizationId !== null && r.kernelPageId) {
      overlaidSlugs.add(r.slug);
    }
  }
  for (const r of rows) {
    // Skip kernel rows whose slug is overridden by an org overlay row.
    if (r.organizationId === null && overlaidSlugs.has(r.slug)) continue;
    if (!slugToKind.has(r.slug)) {
      slugToKind.set(r.slug, r.pageKind);
    }
  }

  const all = Array.from(slugToKind.keys()).sort();
  const byKind: ExistingSlugSnapshot["byKind"] = {
    entity: [],
    stance: [],
    heuristic: [],
    principle: [],
    summary: [],
    decision: [],
    runbook: [],
  };
  for (const [slug, kind] of slugToKind) {
    if (kind in byKind) {
      byKind[kind as keyof typeof byKind].push(slug);
    }
  }
  for (const key of Object.keys(byKind) as Array<keyof typeof byKind>) {
    byKind[key].sort();
  }

  return { all, byKind };
}

/**
 * Render an `ExistingSlugSnapshot` into a single string for the LLM prompt.
 * Per-kind blocks; empty kinds collapse to a placeholder so the LLM knows
 * the absence is real and not a missing-context bug.
 */
export function formatExistingSlugsForPrompt(snapshot: ExistingSlugSnapshot): string {
  const kinds: Array<keyof ExistingSlugSnapshot["byKind"]> = [
    "entity",
    "stance",
    "heuristic",
    "principle",
    "summary",
    "decision",
    "runbook",
  ];
  const blocks: string[] = [];
  for (const kind of kinds) {
    const slugs = snapshot.byKind[kind];
    if (slugs.length === 0) {
      blocks.push(`${kind} (none yet):`);
    } else {
      blocks.push(
        `${kind}:\n${slugs.map((s) => `  - ${s}`).join("\n")}`,
      );
    }
  }
  return blocks.join("\n\n");
}
