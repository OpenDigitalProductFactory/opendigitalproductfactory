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
  // Added for EP-SOVEREIGN-SOC security-response governance (P2). The kernel
  // governs SOC ACTION decisions (escalate/close/respond, may-auto-execute) over
  // these commensurable axes — never the analytical verdict. `blast_radius`
  // (already a cost axis above) is reused for estate reach; the response gate +
  // security principles that weight these land in P3.
  "reversibility", // benefit: can the action be undone?
  "evidence_confidence", // benefit: investigation confidence in the verdict
  "customer_consent_state", // benefit: breadth of standing customer approval
  "business_disruption", // COST: does containment break production?
  // Added for the design-quality kernel additions (BI-B5EA2FB2 / spec
  // docs/superpowers/specs/2026-07-22-wwmd-design-quality-kernel-gap-design.md §3).
  // Two axes the kernel genuinely lacked for design/UX-shaped decisions, each
  // with an orthogonality claim vs the existing axes and >=2 authoring
  // principles (§5). Named for what a HIGH score means, per the cost-name
  // discipline that caught the never-wipe-db inversion.
  "operator_effort", // COST: how many operator operations + elapsed time to the outcome
  "legibility_of_consequence", // benefit: can the operator foresee what an action will do before authorizing it
] as const;
export type PrincipleDimension = (typeof PRINCIPLE_DIMENSIONS)[number];

/**
 * The subset of `PRINCIPLE_DIMENSIONS` that are *costs* — axes where a higher
 * option-feature score (0..1, "how much does this option exhibit this axis")
 * means the option exhibits MORE of a bad thing: more blast radius, more
 * operator/agent cognitive load, more vendor lock-in.
 *
 * Sign convention (AUTHORING.md §8A.3): a negative weight means a principle
 * "pulls against" the axis. Because option features are non-negative, the only
 * way for `principle_decide` to express "this principle opposes the cost" is a
 * NEGATIVE weight. A POSITIVE weight on a cost axis makes the scorer reward the
 * very cost the principle exists to prevent — e.g. `never-wipe-db-for-code-fixes`
 * with `blast_radius: 1.0` once scored "wipe the db" as its top-aligned option
 * (see docs/superpowers/audits/2026-06-14-principle-dimension-sign-audit.md).
 *
 * Enforced by the dimension-vector sign-convention guard in
 * `seed-wiki-kernel.test.ts`, so the inversion cannot silently return —
 * `remove-avoidable-failure-opportunities` applied to the kernel's own
 * calibration. All other dimensions are benefits (positive is the normal
 * direction) or neutral trade-offs (e.g. `speed_to_value`, legitimately
 * negative when a principle trades speed away).
 */
export const PRINCIPLE_COST_DIMENSIONS = [
  "blast_radius",
  "human_cognitive_load",
  "vendor_lock_in",
  // EP-SOVEREIGN-SOC: a security response that breaks production is a cost the
  // governing principle must pull AGAINST (negative weight), same as blast_radius.
  "business_disruption",
  // BI-B5EA2FB2: operator effort is a COST — a design that demands more operator
  // operations/time to reach the outcome is worse, so a principle that favours
  // fewer operations must carry a NEGATIVE weight. (legibility_of_consequence is
  // a BENEFIT and intentionally stays out of this list.) Renamed from the BI's
  // original "interaction_efficiency" precisely to avoid the benefit-shaped-name
  // inversion this list's sign guard exists to prevent.
  "operator_effort",
] as const satisfies readonly PrincipleDimension[];
export type PrincipleCostDimension = (typeof PRINCIPLE_COST_DIMENSIONS)[number];

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

// ─── WSID profession-corpus variant axes (BI-871126F9, variant addendum) ────
//
// Two orthogonal axes that apply ONLY to profession-corpus pages (slug prefix
// `professions/`). They are deliberately NOT principle columns: the variant
// addendum (docs/superpowers/specs/2026-06-13-wsid-location-competency-variants-design.md)
// keeps them as governed, validated frontmatter fields in V1 — no migration —
// expressed through the slug, frontmatter, and a body section. A later
// retrieval-wiring PR can lift them into the gate's filter once the WSID
// profile↔corpus material binding lands. Until then the corpus seed validates
// values against these registries (fail-fast, loud on typo) and logs coverage.

/**
 * Location / jurisdiction axis. A page omitting `professionJurisdiction` is
 * jurisdiction-neutral (applies everywhere) — equivalent to `["global"]`.
 * Jurisdiction-specific doctrine (US GAAP vs IFRS, CAN-SPAM vs GDPR consent,
 * EEOC vs EU employment law) declares the jurisdictions it governs so a
 * coworker serving a given org's jurisdiction can be served the right variant
 * and shielded from the wrong one. Kept intentionally small; grow by PR review
 * as real corpus demand appears (a customer in a new jurisdiction is the
 * signal, not speculation).
 */
export const PROFESSION_JURISDICTIONS = [
  "global",
  "us",
  "eu",
  "uk",
] as const;
export type ProfessionJurisdiction = (typeof PROFESSION_JURISDICTIONS)[number];

/**
 * Jurisdiction BASIS axis — *why* a jurisdiction-specific page applies, i.e.
 * which dimension of the install's regional profile triggers it. Region is not
 * one tag: an install operates in some jurisdictions, sells to others, and
 * employs in others, and different obligations key off different dimensions:
 *   - `global`        — applies everywhere a relevant capability exists, no
 *                       jurisdiction filter (e.g. PCI-DSS for card handling).
 *   - `operating`     — where the business is established (business licensing,
 *                       corporate tax/nexus).
 *   - `selling`       — where the customer / recipient is (sales tax & VAT,
 *                       marketing consent — GDPR/CAN-SPAM/CASL, consumer law).
 *   - `employing`     — where employees do the work (employment law, payroll
 *                       tax, workers' compensation).
 *   - `data-residency`— where data subjects are / data must reside (data
 *                       sovereignty — concern in some regions, not others).
 * A page omitting `professionJurisdictionBasis` defaults to `operating` when it
 * declares a specific jurisdiction, and is treated as `global` when it does not.
 */
export const PROFESSION_JURISDICTION_BASES = [
  "global",
  "operating",
  "selling",
  "employing",
  "data-residency",
] as const;
export type ProfessionJurisdictionBasis = (typeof PROFESSION_JURISDICTION_BASES)[number];

/**
 * Competency-level axis — the depth of professional judgment a page encodes,
 * loosely aligned to SFIA's responsibility bands and O*NET job zones (used as
 * a coverage frame, never as ingested text):
 *   - `foundational`  — non-negotiable basics every coworker in the family
 *     must hold (SFIA ~1-2): debits=credits, never concatenate untrusted input.
 *   - `practitioner`  — day-to-day working practice (SFIA ~3-4): month-end
 *     close steps, conventional-commit format, RESTful status-code usage.
 *   - `expert`        — nuanced trade-off judgment (SFIA ~5-7): IFRS/GAAP
 *     divergence handling, ASVS L3 controls, API deprecation strategy.
 * A coworker's configured competency selects how deep into the corpus the
 * gate retrieves; omitting the field defaults a page to `practitioner`.
 */
export const PROFESSION_COMPETENCY_LEVELS = [
  "foundational",
  "practitioner",
  "expert",
] as const;
export type ProfessionCompetencyLevel =
  (typeof PROFESSION_COMPETENCY_LEVELS)[number];

/**
 * Archetype axis — the business archetype whose practice a page is specific to.
 * A page omitting `professionArchetype` is archetype-neutral (applies to every
 * install) — equivalent to `["universal"]`. Archetype-specific doctrine (a
 * dispatcher's running-late cascade in field trades vs. a storefront order
 * handoff in retail; ADAS-calibration compliance for automotive vs. EPA-608 for
 * HVAC) declares the archetypes it governs so an install of that archetype is
 * served the right craft variant and shielded from the irrelevant one.
 *
 * The non-`universal` slugs mirror `ArchetypeCategory`
 * (packages/storefront-templates/src/types.ts) — the canonical install archetype
 * taxonomy — so an install's resolved archetype category maps 1:1 onto a corpus
 * tag. Kept in sync by the `profession-archetype-axis` invariant test; grow only
 * alongside that union. Like jurisdiction, seed archetype-specific content as
 * real per-archetype demand appears, not speculatively — but the axis is
 * complete so any install's archetype can be *noted* at setup from day one.
 */
export const PROFESSION_ARCHETYPES = [
  "universal",
  "healthcare-wellness",
  "beauty-personal-care",
  "trades-maintenance",
  "professional-services",
  "software-platform",
  "education-training",
  "pet-services",
  "food-hospitality",
  "retail-goods",
  "fitness-recreation",
  "nonprofit-community",
  "hoa-property-management",
  "banking-financial-services",
  "public-sector",
  "asset-rental",
  "real-estate-construction",
  "automotive-services",
  "moving-and-logistics",
  "security-services",
  "media-production",
  "live-events-venues",
  "warehousing-fulfilment",
  "fabric-care-services",
  "agriculture-ranching",
  "manufacturing",
] as const;
export type ProfessionArchetype = (typeof PROFESSION_ARCHETYPES)[number];

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
 * Narrowing predicate for the WSID location axis. Gates `professionJurisdiction`
 * frontmatter entries against the closed `PROFESSION_JURISDICTIONS` registry.
 */
export function isProfessionJurisdiction(
  value: unknown,
): value is ProfessionJurisdiction {
  return (
    typeof value === "string" &&
    (PROFESSION_JURISDICTIONS as readonly string[]).includes(value)
  );
}

/**
 * Narrowing predicate for the WSID competency axis. Gates
 * `professionCompetencyLevel` frontmatter against `PROFESSION_COMPETENCY_LEVELS`.
 */
export function isProfessionCompetencyLevel(
  value: unknown,
): value is ProfessionCompetencyLevel {
  return (
    typeof value === "string" &&
    (PROFESSION_COMPETENCY_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Narrowing predicate for the WSID archetype axis. Gates `professionArchetype`
 * frontmatter against `PROFESSION_ARCHETYPES`.
 */
export function isProfessionArchetype(
  value: unknown,
): value is ProfessionArchetype {
  return (
    typeof value === "string" &&
    (PROFESSION_ARCHETYPES as readonly string[]).includes(value)
  );
}

/**
 * Narrowing predicate for the WSID jurisdiction-basis axis. Gates
 * `professionJurisdictionBasis` frontmatter against `PROFESSION_JURISDICTION_BASES`.
 */
export function isProfessionJurisdictionBasis(
  value: unknown,
): value is ProfessionJurisdictionBasis {
  return (
    typeof value === "string" &&
    (PROFESSION_JURISDICTION_BASES as readonly string[]).includes(value)
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
