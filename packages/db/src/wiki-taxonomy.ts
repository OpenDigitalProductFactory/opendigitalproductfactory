// Phase 0 Task 0.1 — single source of truth for wiki page kinds, statuses,
// and the principle-only taxonomy (tier, applies-to, dimension registry,
// weight defaults, caps, decision defaults).
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 0)
//
// Imported by seed, lint, MCP schemas, retrieval, and UI. wiki-store.ts
// re-exports WikiPageKind / WikiPageStatus from this module so callers keep
// working through the existing import path.

// ─── Wiki page kinds and statuses ───────────────────────────────────────────

/**
 * The eight page kinds supported by the founder kernel wiki. Defined in
 * docs/founder-kernel/SCHEMA.md and EP-WIKI-001 section 4. `principle` was
 * added by the principles-as-wiki-kind work (spec section 7).
 */
export const WIKI_PAGE_KINDS = [
  "entity",
  "summary",
  "decision",
  "runbook",
  "index",
  "stance",
  "heuristic",
  "principle",
] as const;
export type WikiPageKind = (typeof WIKI_PAGE_KINDS)[number];

/** Status lifecycle for wiki pages, defined in EP-WIKI-001 section 4. */
export const WIKI_PAGE_STATUSES = [
  "draft",
  "published",
  "review-needed",
  "archived",
] as const;
export type WikiPageStatus = (typeof WIKI_PAGE_STATUSES)[number];

// ─── Principle taxonomy ─────────────────────────────────────────────────────

/**
 * Tiers control how strongly a principle pulls on decision aggregation and how
 * strictly lint enforces required fields. Order is high-to-low weight so
 * callers can iterate in priority order. See spec section 5.1.
 */
export const PRINCIPLE_TIERS = ["commandment", "core", "contextual"] as const;
export type PrincipleTier = (typeof PRINCIPLE_TIERS)[number];

/**
 * Populations a principle governs. Used by retrieval (`recallPrincipleContext`)
 * to filter principles to the calling agent's scope. See spec section 5.3.
 */
export const PRINCIPLE_APPLIES_TO = [
  "in_platform_coworker",
  "external_coding_agent",
  "human",
] as const;
export type PrincipleAppliesTo = (typeof PRINCIPLE_APPLIES_TO)[number];

/**
 * Consumer archetype — answers "who is expected to consume this principle?"
 * Independent axis from `PRINCIPLE_APPLIES_TO`; the coherence rule for valid
 * combinations is in spec section 8A.1 and is enforced by lint, not at the
 * type layer. Ordered broadest-to-narrowest so retrieval iterates scope tiers
 * cleanly: universal first, then caller-specific archetypes, then route/domain
 * narrowed by context. See spec section 8A.
 */
export const PRINCIPLE_CONSUMER_ARCHETYPES = [
  "universal",
  "ai-coworker-universal",
  "generalist",
  "specialist",
  "route-domain-specific",
] as const;
export type PrincipleConsumerArchetype =
  (typeof PRINCIPLE_CONSUMER_ARCHETYPES)[number];

/**
 * Example route/domain slugs used as values of `principleConsumerContexts` when
 * `principleConsumerArchetype = "route-domain-specific"`. These are NOT a
 * closed enum — `isPrincipleConsumerContextSlug` defines the slug-shape
 * contract and new contexts are added by authoring without a schema change.
 * Ordering puts `build-studio` first because it is the most-cited consumer
 * context in the existing kernel.
 */
export const PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES = [
  "build-studio",
  "marketing",
  "compliance",
  "discovery",
  "finance",
  "storefront",
  "portfolio",
] as const;
/** Consumer-context slugs are governed kebab-case strings, not a closed enum. */
export type PrincipleConsumerContext = string;

/**
 * Option-feature axes that principle dimension vectors can score against.
 * V1 ships a small registry — growth is gated by PR review so the registry
 * stays auditable. See spec section 10.
 */
export const PRINCIPLE_DIMENSIONS = [
  "long_term_maintainability",
  "blast_radius",
  "reusability",
  "evidence_density",
  "human_cognitive_load",
  "capacity_utilization",
  "governance_compliance",
  "public_safety",
  "speed_to_value",
  "schema_grounding",
] as const;
export type PrincipleDimension = (typeof PRINCIPLE_DIMENSIONS)[number];

/**
 * Default weight magnitude for each tier. A principle can override via
 * `principleWeight` + `principleWeightRationale`; lint warns on divergence.
 * Ratios chosen so one commandment outweighs ten contextual at peak alignment
 * (1.0 vs 10 * 0.1 = 1.0 — the hierarchy degrades gracefully, no hard
 * categorical override). See spec section 5.1.
 */
export const PRINCIPLE_TIER_DEFAULT_WEIGHT: Record<PrincipleTier, number> = {
  commandment: 1.0,
  core: 0.4,
  contextual: 0.1,
};

/**
 * Hard cap on commandments (10) is the central inflation guard — if every rule
 * is a commandment, nothing is. Core has a soft cap (30) enforced by `warn`-
 * severity lint. Contextual is uncapped. See spec section 5.1 and section 14.
 */
export const PRINCIPLE_TIER_CAPS: Record<PrincipleTier, number | null> = {
  commandment: 10,
  core: 30,
  contextual: null,
};

/**
 * Defaults for the `principle_decide` advisory MCP tool. Callers can override
 * per-invocation but the defaults reflect the spec section 11 contract.
 */
export const PRINCIPLE_DECIDE_DEFAULTS = {
  maxPrinciples: 20,
  tieMargin: 0.2,
  contextualSimilarityThreshold: 0.75,
  semanticFallbackWarnRatio: 0.4,
} as const;

// ─── Type-narrowing predicates ──────────────────────────────────────────────

/**
 * String-narrowing predicates used by seed parsing, MCP input validation, and
 * lint detectors. Each predicate accepts `unknown` and narrows on success so
 * callers can pipe DB rows, frontmatter values, and MCP arguments through the
 * same gate without separate type assertions.
 */

export function isWikiPageKind(value: unknown): value is WikiPageKind {
  return (
    typeof value === "string" &&
    (WIKI_PAGE_KINDS as readonly string[]).includes(value)
  );
}

export function isWikiPageStatus(value: unknown): value is WikiPageStatus {
  return (
    typeof value === "string" &&
    (WIKI_PAGE_STATUSES as readonly string[]).includes(value)
  );
}

export function isPrincipleTier(value: unknown): value is PrincipleTier {
  return (
    typeof value === "string" &&
    (PRINCIPLE_TIERS as readonly string[]).includes(value)
  );
}

export function isPrincipleAppliesTo(
  value: unknown,
): value is PrincipleAppliesTo {
  return (
    typeof value === "string" &&
    (PRINCIPLE_APPLIES_TO as readonly string[]).includes(value)
  );
}

export function isPrincipleDimension(
  value: unknown,
): value is PrincipleDimension {
  return (
    typeof value === "string" &&
    (PRINCIPLE_DIMENSIONS as readonly string[]).includes(value)
  );
}

export function isPrincipleConsumerArchetype(
  value: unknown,
): value is PrincipleConsumerArchetype {
  return (
    typeof value === "string" &&
    (PRINCIPLE_CONSUMER_ARCHETYPES as readonly string[]).includes(value)
  );
}

/**
 * Kebab-case slug validator for `principleConsumerContexts` entries. Accepts
 * lowercase alphanumeric characters and single-hyphen separators only. Rejects
 * leading/trailing hyphens, double hyphens, underscores, whitespace, and
 * non-string values. Contexts are governed slugs, not a closed enum, so the
 * shape contract lives here rather than in a hardcoded array.
 */
const CONSUMER_CONTEXT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function isPrincipleConsumerContextSlug(
  value: unknown,
): value is PrincipleConsumerContext {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    CONSUMER_CONTEXT_SLUG_PATTERN.test(value)
  );
}
