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

// ─── Spine vs profession-local axis scope (BI-AA7D80FE) ─────────────────────
//
// Spec: docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md §2.1.
//
// The registry was sized when WWMD was the only authoring tier. Now that WSID
// (profession corpora) exists, some axes here are one profession's vocabulary
// wearing doctrine's clothes. This classification says which axes are the
// **commensurability layer** — the ones that let a design objection and a
// security objection be weighed in one ledger — and which belong to a
// profession.
//
// REDUCTION IS BY DEMOTION, NOT DELETION. Nothing leaves PRINCIPLE_DIMENSIONS.
// A demoted axis keeps scoring at full resolution inside its profession and
// **projects** onto a spine axis when the decision leaves that profession, so
// no signal is lost and cross-profession comparison still works.
//
// HOW THESE CALLS WERE MADE (measured 2026-07-24 over the 100-page kernel):
// raw usage is a BAD criterion on its own, because this spec's own finding is
// that the specialist cohort is over-represented — 53 of 100 kernel principles
// are `route-domain-specific`, mostly software-engineering. So an axis can look
// load-bearing purely because one profession authored most of the corpus. The
// better evidence is **specialist-authorship share**:
//
//   axis                        uses  authored by route-domain-specific
//   reusability                   22   64%   <- demoted
//   schema_grounding              39   51%   <- demoted despite 3rd-highest usage
//   operational_independence       4   75%   <- demoted
//   vendor_lock_in                 2  100%   <- demoted
//   capacity_utilization           6   67%   <- demoted
//   reversibility                  2    0%   <- SPINE despite 2 uses
//   data_privacy                   1    0%   <- SPINE despite 1 use
//   legibility_of_consequence      4    0%   <- SPINE (and young)
//
// Two guards against misreading low usage:
//   - **Universal obligations outrank frequency.** `public_safety` (3 uses) and
//     `data_privacy` (1 use) stay spine. If a safety objection could not be
//     weighed against a design objection in one ledger, the spine would have
//     failed at its only job.
//   - **Young axes are protected.** `operator_effort` and
//     `legibility_of_consequence` landed 2026-07-23 (BI-B5EA2FB2). Their low
//     counts measure their age, not their reach. Demoting an axis in its first
//     week would encode "new axes are niche", which is backwards.

/** Whether an axis is shared doctrine or one profession's vocabulary. */
export const PRINCIPLE_DIMENSION_SCOPES = ["spine", "profession-local"] as const;
export type PrincipleDimensionScope =
  (typeof PRINCIPLE_DIMENSION_SCOPES)[number];

export type PrincipleDimensionScopeEntry =
  | {
      scope: "spine";
      /** Why this axis must stay commensurable across every profession. */
      rationale: string;
    }
  | {
      scope: "profession-local";
      /** Profession slug that owns the axis (see docs/professions/registry.json). */
      profession: string;
      /**
       * Spine axes this rolls up onto when the decision leaves the profession.
       * MUST be non-empty — a demotion without a projection silently drops the
       * axis from cross-profession decisions, which is deletion wearing a
       * demotion's name. Enforced by `assertDimensionScopeIntegrity`.
       */
      projectsOnto: readonly PrincipleDimension[];
      rationale: string;
    };

/**
 * Every axis, labelled. `satisfies Record<PrincipleDimension, …>` is the
 * enforcement: adding a dimension to PRINCIPLE_DIMENSIONS without classifying
 * it here is a COMPILE error, not a silently-unlabelled axis. Same discipline
 * as the quality-issue registry — an unregistered entry must not typecheck.
 */
export const PRINCIPLE_DIMENSION_SCOPE = {
  // ── Spine ────────────────────────────────────────────────────────────────
  long_term_maintainability: {
    scope: "spine",
    rationale:
      "Durability is profession-neutral: a contract, a menu, a network topology and a module all get more expensive to keep correct over time. The heaviest specialist share (57%) reflects who authored the corpus, not what the axis means.",
  },
  governance_compliance: {
    scope: "spine",
    rationale:
      "Policy and audit obligations bind every profession; an option that satisfies them must be comparable to one that does not, wherever the objection originates.",
  },
  evidence_density: {
    scope: "spine",
    rationale:
      "How much verifiable backing an option has, rather than assertion, is the platform's shared epistemic floor.",
  },
  speed_to_value: {
    scope: "spine",
    rationale:
      "Time-to-usable-outcome is the universal trade partner for every quality axis. Lowest specialist share (37%) of the high-usage axes.",
  },
  blast_radius: {
    scope: "spine",
    rationale:
      "How much of the estate an option reaches if it is wrong is the shared risk currency — the axis a security objection and an architecture objection both speak.",
  },
  human_cognitive_load: {
    scope: "spine",
    rationale:
      "Demand on human attention and judgement is borne by the same humans regardless of which profession produced the option.",
  },
  public_safety: {
    scope: "spine",
    rationale:
      "UNIVERSAL OBLIGATION, not frequency: 3 uses. Harm to people outside the organization must be weighable against any other objection in one ledger. Demoting it to a profession would mean a safety concern could not be compared to a design concern — precisely the failure the spine exists to prevent.",
  },
  data_privacy: {
    scope: "spine",
    rationale:
      "UNIVERSAL OBLIGATION, not frequency: 1 use, 0% specialist-authored. Protection of personal data is a legal duty crossing every profession, so it cannot be scoped to one.",
  },
  reversibility: {
    scope: "spine",
    rationale:
      "Whether an action can be undone is a property of ANY action, in any profession. 0% specialist-authored despite only 2 uses — authored by universal principles, which is the signal.",
  },
  cost_efficiency: {
    scope: "spine",
    rationale:
      "Money is the one axis every profession trades against. Scored by ZERO principles today, which §2.1 names as the explicit exception to the demote-if-rarely-used rule: an unused axis here means the corpus has a gap, not that the axis is niche. A cost-sensitivity principle is scoped in BI-8D3E7757.",
  },
  operator_effort: {
    scope: "spine",
    rationale:
      "YOUNG AXIS (landed 2026-07-23, BI-B5EA2FB2): 3 uses measures its age, not its reach. Operations and elapsed time demanded of the operator are borne identically whichever profession authored the option.",
  },
  legibility_of_consequence: {
    scope: "spine",
    rationale:
      "YOUNG AXIS (landed 2026-07-23, BI-B5EA2FB2): 4 uses, 0% specialist-authored. Whether an operator can foresee what an action will do before authorizing it is a precondition of informed authorization everywhere, not a design-profession concern.",
  },

  // ── Profession-local (demoted; each projects back onto the spine) ─────────
  schema_grounding: {
    scope: "profession-local",
    profession: "software-engineer",
    projectsOnto: ["long_term_maintainability"],
    rationale:
      "THE LARGEST DEMOTION, and the clearest instance of this spec's thesis: 39 uses (3rd highest) but 51% specialist-authored, and the axis is literally named in software vocabulary — 'anchored in the existing schema and substrate'. Its apparent load-bearing weight comes from the software cohort's over-representation in the kernel. Grounding work in existing substrate is how software buys durability, so it rolls up onto long_term_maintainability.",
  },
  reusability: {
    scope: "profession-local",
    profession: "software-engineer",
    projectsOnto: ["long_term_maintainability"],
    rationale:
      "Highest specialist share of any well-used axis (64% of 22 uses). 'Reusable across more callers and contexts' is software-engineering framing; the durable value it buys is what other professions can actually compare against.",
  },
  operational_independence: {
    scope: "profession-local",
    profession: "devops-platform",
    projectsOnto: ["long_term_maintainability", "blast_radius"],
    rationale:
      "75% specialist-authored. Sovereignty from external dependencies is an infrastructure property; its cross-profession meaning is continuity (durability) plus exposure when the dependency fails (reach).",
  },
  vendor_lock_in: {
    scope: "profession-local",
    profession: "devops-platform",
    projectsOnto: ["long_term_maintainability"],
    rationale:
      "100% specialist-authored (2 uses). Depth of tie to a single vendor is a procurement/architecture concern whose general form is the future cost of staying correct.",
  },
  capacity_utilization: {
    scope: "profession-local",
    profession: "operations",
    projectsOnto: ["cost_efficiency"],
    rationale:
      "67% specialist-authored. Fuller use of available capacity is operations vocabulary; what every other profession can weigh is the cheaper outcome it produces.",
  },
  evidence_confidence: {
    scope: "profession-local",
    profession: "security",
    projectsOnto: ["evidence_density"],
    rationale:
      "Introduced for SOC verdicts (EP-SOVEREIGN-SOC). How CONCLUSIVE an investigation is, is a distinct analytic judgement from how MUCH evidence exists, but only security work routinely separates the two; elsewhere it rolls up onto evidence_density.",
  },
  business_disruption: {
    scope: "profession-local",
    profession: "security",
    projectsOnto: ["blast_radius"],
    rationale:
      "Introduced for SOC containment decisions. 'Does the response break production' is a security-response framing of estate reach, which is what other professions weigh it as.",
  },
  customer_consent_state: {
    scope: "profession-local",
    profession: "marketing",
    projectsOnto: ["governance_compliance"],
    rationale:
      "Breadth of standing customer approval governs outbound and consent-bound action. Outside that work its force is exactly the compliance obligation it encodes.",
  },
} as const satisfies Record<PrincipleDimension, PrincipleDimensionScopeEntry>;

/** Axes that form the shared commensurability layer. */
export const PRINCIPLE_SPINE_DIMENSIONS = PRINCIPLE_DIMENSIONS.filter(
  (d) => PRINCIPLE_DIMENSION_SCOPE[d].scope === "spine",
) as readonly PrincipleDimension[];

/** Axes owned by a profession, each projecting back onto the spine. */
export const PRINCIPLE_LOCAL_DIMENSIONS = PRINCIPLE_DIMENSIONS.filter(
  (d) => PRINCIPLE_DIMENSION_SCOPE[d].scope === "profession-local",
) as readonly PrincipleDimension[];

export function isSpineDimension(d: PrincipleDimension): boolean {
  return PRINCIPLE_DIMENSION_SCOPE[d].scope === "spine";
}

/**
 * Project a dimension vector onto the spine — the roll-up that makes a
 * profession-scored decision comparable outside that profession. Spine axes
 * pass through; a profession-local axis contributes its weight to each spine
 * axis it declares, split evenly so a demotion cannot amplify a principle by
 * projecting onto several axes at full magnitude.
 */
export function projectVectorOntoSpine(
  vector: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => {
    out[k] = (out[k] ?? 0) + v;
  };
  for (const [key, value] of Object.entries(vector)) {
    if (!isPrincipleDimension(key)) continue;
    const entry = PRINCIPLE_DIMENSION_SCOPE[key];
    if (entry.scope === "spine") {
      add(key, value);
      continue;
    }
    const share = value / entry.projectsOnto.length;
    for (const target of entry.projectsOnto) add(target, share);
  }
  return out;
}

/**
 * Structural invariants that the type system cannot express. Called by the
 * registry test so a bad classification fails CI rather than silently
 * degrading a decision.
 */
export function assertDimensionScopeIntegrity(
  /**
   * Valid `professionKey` values from docs/professions/registry.json. Passed in
   * rather than read here so this module stays filesystem-free (it is imported
   * by the browser bundle); the registry test supplies the real set.
   */
  knownProfessions?: ReadonlySet<string>,
): void {
  for (const dim of PRINCIPLE_DIMENSIONS) {
    const entry = PRINCIPLE_DIMENSION_SCOPE[dim];
    if (entry.scope !== "profession-local") continue;
    // Widened deliberately: `as const` narrows these literal tuples to length
    // 1 | 2, so TS proves the check dead for TODAY's registry. The guard exists
    // for the NEXT author, who may add an entry with an empty projection — at
    // which point the literal type would permit 0 and this would fire.
    if ((entry.projectsOnto as readonly PrincipleDimension[]).length === 0) {
      throw new Error(
        `Dimension "${dim}" is profession-local with no projection. A demotion without a projection drops the axis from every cross-profession decision — that is deletion, which §2.1 forbids.`,
      );
    }
    for (const target of entry.projectsOnto) {
      const targetEntry = PRINCIPLE_DIMENSION_SCOPE[target];
      if (targetEntry.scope !== "spine") {
        throw new Error(
          `Dimension "${dim}" projects onto "${target}", which is itself profession-local. Projections must terminate on the spine in one hop, or the roll-up is not commensurable.`,
        );
      }
    }
    if (!entry.profession.trim()) {
      throw new Error(`Dimension "${dim}" is profession-local with no owning profession.`);
    }
    if (knownProfessions && !knownProfessions.has(entry.profession)) {
      throw new Error(
        `Dimension "${dim}" is owned by profession "${entry.profession}", which is not a professionKey in docs/professions/registry.json. A local axis owned by a profession that does not exist can never be retrieved.`,
      );
    }
  }
  if (PRINCIPLE_SPINE_DIMENSIONS.length === 0) {
    throw new Error("The spine cannot be empty — it is the commensurability layer.");
  }
}

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
