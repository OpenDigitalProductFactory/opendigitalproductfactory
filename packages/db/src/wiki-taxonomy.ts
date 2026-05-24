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
 *
 * Ordering reflects citation density in the kernel as of 2026-05-22 per the
 * scope-refactor audit (plan: `docs/superpowers/plans/2026-05-22-principle-scope-refactor.md`):
 * - `build-studio` and `engineering-flow` are the two largest clusters; the
 *   former scopes BS lifecycle rules, the latter covers code-contribution
 *   rules (PR / branch / worktree / DCO / build-gate) that bind any agent
 *   or human touching the codebase but do not bind, say, a finance coworker.
 * - `ui`, `data-model`, `mcp`, `release` were added as the audit surfaced
 *   distinct principle clusters that don't fit any seed example.
 * - `marketing`, `compliance`, `discovery`, `finance`, `storefront`,
 *   `portfolio` remain as original seed examples for non-engineering domains.
 */
export const PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES = [
  "build-studio",
  "engineering-flow",
  "ui",
  "data-model",
  "mcp",
  "release",
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
 * Ring scope — orthogonal axis from `principleConsumerArchetype` /
 * `principleConsumerContexts` describing WHICH DEPTH of the Reduction Gear
 * loop a principle binds. Contexts describe the domain (build-studio,
 * finance, ui); ring scopes describe the loop layer (Ring 1 individual
 * coworker iteration → Ring 5 global hive federation, plus external
 * coordination plane and a universal-ring escape hatch).
 *
 * Source spec: docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md §3.
 *
 * `universal-ring` is intentionally a separate value (not the omitted /
 * empty case) so authoring it requires a conscious choice, not default-
 * to-broadest. The companion lint detector `principle-ring-scope-overuse`
 * warns when more than 30% of published principles tag `universal-ring`.
 */
export const PRINCIPLE_RING_SCOPES = [
  "ring-1-coworker",
  "ring-2-workflow",
  "ring-3-archetype",
  "ring-4-sandbox-prod",
  "ring-5-hive",
  "external-coordination",
  "universal-ring",
] as const;
export type PrincipleRingScope = (typeof PRINCIPLE_RING_SCOPES)[number];

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
  // Added for prefer-self-hosted-infrastructure principle (PR #926)
  "operational_independence",
  "data_privacy",
  "cost_efficiency",
  "vendor_lock_in",
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
 * Tier caps. Updated 2026-05-22 per founder direction recorded in plan
 * `docs/superpowers/plans/2026-05-22-principle-scope-refactor.md`:
 *
 * - **Commandments are uncapped.** The earlier hard cap of 10 was an
 *   inflation guard, but the operating model has shifted: commandments are
 *   non-negotiable doctrine that wins in conflict resolution (weight 1.0
 *   beats any combination of lower-tier alignments), and there is no
 *   reason for that priority signal to be scarce. The scarcity guard is
 *   replaced by the dimension-vector + WWMD review loop — each new
 *   commandment must score against the dimension registry and justify
 *   itself against existing commandments at PR review time.
 * - **Commandments-in-context are first-class.** A `route-domain-specific`
 *   principle may carry `principleTier: commandment` to mean "non-
 *   negotiable within its declared contexts." The strict retrieval filter
 *   in `recallPrincipleContext` ensures it never applies outside its
 *   contexts, so a Build Studio commandment binds BS work without leaking
 *   into finance or storefront prompts.
 * - Core retains its soft cap (30) as an inflation guard, enforced by
 *   `warn`-severity lint.
 * - Contextual remains uncapped.
 *
 * See spec section 5.1 and section 14 for the original framing; the
 * 2026-05-22 plan supersedes the commandment-cap portion.
 */
export const PRINCIPLE_TIER_CAPS: Record<PrincipleTier, number | null> = {
  commandment: null,
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
 * Narrowing predicate for ring-scope values. Used by seed parsing, MCP input
 * validation, and the `principle-ring-scope-overuse` lint detector to gate
 * inputs against the closed `PRINCIPLE_RING_SCOPES` enum.
 */
export function isPrincipleRingScope(
  value: unknown,
): value is PrincipleRingScope {
  return (
    typeof value === "string" &&
    (PRINCIPLE_RING_SCOPES as readonly string[]).includes(value)
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
