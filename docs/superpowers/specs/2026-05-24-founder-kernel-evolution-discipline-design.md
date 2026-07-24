---
title: Founder kernel evolution discipline — ring-scoped consultation, promotion + retirement contract, and four candidate principles
authoredAt: 2026-05-24
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: BI-746268A1
epic: EP-REDUCTION-GEAR-ARCH
relatedSpecs:
  - docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
  - docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md
  - docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
relatedPlans:
  - docs/superpowers/plans/2026-05-22-principle-scope-refactor.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
  - docs/professions/data-architect/wiki/schema-audit-before-features.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
---

> **Amended 2026-07-23** by [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md).
> The promotion/retirement contract here governs SPINE axes. A second, lighter path is introduced there for profession-local axes: they require provenance and a declared projection onto a spine axis, not the full orthogonality argument. This is an explicit, recorded relaxation.

# Founder kernel evolution discipline

## Summary

The DPF founder kernel is 58 principles strong and growing. Three failure modes
are imminent if growth is left ungoverned:

1. **Dimensionality bloat** — every new principle adds a new axis to the
   decision-aggregation vector. Past ~80 principles, signal degrades into noise.
2. **Universal-scope-by-default** — most "universal" principles get loaded into
   every prompt at every ring, even when they have nothing to say about the
   action at hand. Cognitive load rises linearly per action.
3. **Overlap without dedup** — `verify-substrate-before-proposing-new`,
   `schema-audit-before-features`, and `consult-specs-first` already overlap;
   nothing prevents a fourth near-duplicate from being added next week.

The Reduction Gear Architecture (PR #1075) supplies the missing scoping lattice:
five concentric rings (Ring 1 Coworker → Ring 5 Hive) plus an external
coordination plane. This spec proposes using that lattice as an **orthogonal
second scope axis** on every principle — independent of the existing
domain-context axis (`build-studio`, `engineering-flow`, `finance`, etc.) — and
defines the promotion/retirement contract that keeps the kernel a load-bearing
decision vector instead of a documentation pile.

It then promotes four candidate principles surfaced organically by the Reduction
Gear and governed-upgrade work, under the new discipline.

This spec is additive. No existing principle file is destroyed; no existing
field is repurposed (schema honesty). The scope-refactor plan from 2026-05-22
remains the authoritative cleanup for `principleConsumerArchetype` /
`principleConsumerContexts` and is consciously not duplicated here.

## 1. Why

### 1.1 The articulated concern

Mark, 2026-05-24: *"Specs are heavy adds to the principles, so need to apply
this smartly to align future work and not get bogged down with too much detail
in every action."*

The kernel works as a decision aggregation today because most decisions face a
small enough principle field that the structured-alignment math (`buildOptionScores`
in [apps/web/lib/wiki/principle-decide.ts:321](../../../apps/web/lib/wiki/principle-decide.ts))
returns a useful signal. As the kernel grows, three things happen:

- Decision composites accumulate small contributions from every principle
  regardless of relevance — the runner-up margin shrinks toward `tieMargin`
  (default 0.2), the `low` confidence flag fires on every call, and the
  recommendation becomes "human review required" by default.
- Prompt context for each coworker call carries more commandments than the
  call actually binds. Today's `COMMANDMENT_RETRIEVAL_CAP = 10` mitigates this
  but doesn't fix it — once there are 20 commandments, picking which 10
  becomes itself a decision, and the cut is currently arbitrary
  (Postgres-order LIMIT).
- New principles drift toward duplicating existing ones because the bar for
  "is this already covered?" is informal grep, not a structural overlap check.

### 1.2 Mission alignment

This work is high-leverage because every other DPF spec inherits the kernel's
shape:

- **Trusted AI Kernel (TAK) positioning.** A kernel that bloats into noise is
  exactly the failure mode TAK exists to refute. "Our kernel scales because
  consultation is bounded, not unbounded" is a load-bearing TAK claim.
- **Reduction Gear loop integrity.** Every ring boundary in the Reduction
  Gear spec relies on `principle_decide` for autonomy and graduation
  decisions. If the math degrades with kernel size, the graduation signal
  becomes noisier as the kernel matures — exactly backwards.
- **Hive economic moat.** The hive ships `FeaturePack` today and will ship
  `CalibratedCapabilityPack` after the Reduction Gear lands. The kernel is
  the thing every install consults to decide whether to accept incoming
  calibration. A kernel that doesn't scope decisions cleanly to a ring is a
  kernel that accepts hive priors at the wrong ring.
- **Verify-substrate-before-proposing-new** (existing core principle). The
  substrate sweep done for this spec found the scope-refactor plan and the
  full taxonomy registry. Reusing them is the whole point.

### 1.3 Why not just keep adding principles

Three reasons the status quo of "add a principle whenever a pattern is
observed twice" stops working:

1. **No retirement pressure.** Existing principles never sunset. A principle
   that was load-bearing in 2026-04 (e.g. `keep-root-clone-as-merge-worktree`)
   may have been superseded by `worktree-per-session` + `worktree-base-origin-main`
   without anyone deleting the older one. Lint catches missing fields, not
   redundancy.
2. **No dimension orthogonality check.** New principles can introduce new
   `principleDimensionVector` keys via PR review (lint blocks unknown
   dimensions), but nothing checks whether a new dimension is genuinely
   orthogonal to existing ones. `governance_compliance` and `blast_radius`
   are nearly co-linear in the current vector field — adding a fifth
   near-redundant axis would not be caught.
3. **No ring-scoping mechanism.** A principle about Ring 5 hive federation
   (when one is written) would, with today's filters, surface in a Ring 1
   coworker capability-improvement call — irrelevantly. The cost of that
   irrelevant injection is paid every call, forever.

### 1.4 Mission-critical non-goals

- **Do NOT delete principle files.** Retirement is `status: archived` (already
  in the `WIKI_PAGE_STATUSES` enum). The history of a retired principle is
  evidence; deletion erases it.
- **Do NOT add a new "ring" enum that competes with `principleConsumerArchetype`
  or `principleConsumerContexts`.** Rings are an orthogonal axis. Contexts
  describe *which domain* (data-model, ui, finance); rings describe *which
  depth of agentic loop* (coworker iteration vs hive federation). A principle
  can be Ring 2 + context `ui` simultaneously.
- **Do NOT implement the runtime gating in this spec.** Implementation is a
  downstream BI under EP-REDUCTION-GEAR-ARCH. This spec defines the contract.

## 2. Current substrate truth (verified 2026-05-24)

The substrate sweep checked every claim made below against the live worktree.

### 2.1 Taxonomy registry — what exists

[packages/db/src/wiki-taxonomy.ts](../../../packages/db/src/wiki-taxonomy.ts):

| Constant | Shape | Today's coverage |
|---|---|---|
| `PRINCIPLE_TIERS` | `["commandment", "core", "contextual"]` | Used by every principle |
| `PRINCIPLE_TIER_DEFAULT_WEIGHT` | `{commandment: 1.0, core: 0.4, contextual: 0.1}` | Authors can override with `principleWeight` + rationale |
| `PRINCIPLE_TIER_CAPS` | `{commandment: null, core: 30, contextual: null}` | Commandment cap removed 2026-05-22; core has soft cap (warn-severity lint) |
| `PRINCIPLE_APPLIES_TO` | `["in_platform_coworker", "external_coding_agent", "human"]` | **Population filter** — who the calling actor is |
| `PRINCIPLE_CONSUMER_ARCHETYPES` | `["universal", "ai-coworker-universal", "generalist", "specialist", "route-domain-specific"]` | Independent axis from `PRINCIPLE_APPLIES_TO` |
| `PRINCIPLE_CONSUMER_CONTEXT_EXAMPLES` | 12 governed slugs (`build-studio`, `engineering-flow`, `ui`, `data-model`, `mcp`, `release`, `marketing`, `compliance`, `discovery`, `finance`, `storefront`, `portfolio`) | Not a closed enum; validated by `isPrincipleConsumerContextSlug` (kebab-case shape) |
| `PRINCIPLE_DIMENSIONS` | 14 axes (`long_term_maintainability`, `blast_radius`, `reusability`, `evidence_density`, `human_cognitive_load`, `capacity_utilization`, `governance_compliance`, `public_safety`, `speed_to_value`, `schema_grounding`, `operational_independence`, `data_privacy`, `cost_efficiency`, `vendor_lock_in`) | Closed enum; lint blocks unknown keys |
| `PRINCIPLE_DECIDE_DEFAULTS.maxPrinciples` | 20 | Hard ceiling on principles per `principle_decide` call |

### 2.2 Retrieval — what exists

[apps/web/lib/wiki/principle-recall.ts](../../../apps/web/lib/wiki/principle-recall.ts)
implements `recallPrincipleContext` which today:

- Returns commandments from Postgres for the calling population (cap 10 via
  `COMMANDMENT_RETRIEVAL_CAP`).
- Returns top-K core principles from Qdrant filtered by `principleAppliesTo`
  (population) — does NOT filter by `principleConsumerContexts`.
- Returns contextual principles above `contextualSimilarityThreshold = 0.75`
  filtered by `principleAppliesTo` — does NOT filter by contexts.

**Gap:** The 2026-05-22 scope-refactor plan (Phase B) proposes adding
`consumerContexts: string[]` filtering to `recallPrincipleContext` and
`principle_decide`. That gap is still open. This spec assumes Phase B lands
and builds on top of it.

### 2.3 Lint — what exists

[apps/web/lib/wiki/principle-lint-detectors.ts](../../../apps/web/lib/wiki/principle-lint-detectors.ts):

| Detector | Severity | Blocks publish |
|---|---|---|
| `principle-missing-tier` | error | yes |
| `principle-missing-applies-to` | error | yes |
| `principle-missing-direction` | error (commandment/core) / warn (contextual) | tier-gated |
| `principle-missing-vector` | error (commandment) / warn (core) / off (contextual) | tier-gated |
| `principle-vector-dimension-mismatch` | warn | no |
| `principle-unknown-dimension` | error | yes |
| `principle-tier-weight-mismatch` | warn | no |
| `principle-public-missing-rationale` | warn | no |
| `principle-public-unsafe-marker` | warn | no |
| `principle-runtime-enforcement-*` | varies | yes for invalid regex / mode |

### 2.4 Decision math — what exists

[apps/web/lib/wiki/principle-decide.ts](../../../apps/web/lib/wiki/principle-decide.ts)
implements:

- `computeStructuredAlignment` — normalized dot product over the principle's
  declared dimensions; missing option features count as 0 with
  `missingDimensions` reported.
- `computeSemanticAlignment` — cosine similarity between option embedding and
  `principleDirection` embedding; fallback when the principle has no vector.
- `decide(options, principles, config)` — composite scoring with three
  guardrails: `tieMargin` (low-confidence when margin < 0.2),
  `semanticFallbackWarnRatio` (weak coverage when > 40% semantic),

  `commandmentConflictThreshold` (flag when a commandment contributes
  < -0.5 to the winning option).

### 2.5 Population distribution across 58 principles

Counts are the pre-existing kernel as of 2026-05-24, NOT including the four
candidate principles promoted in §6 of this spec. After this PR ships, the
totals shift to 62 principles (16 commandment / 40 core / 6 contextual;
14 universal / 12 ai-coworker-universal / 1 specialist / 35 route-domain-specific).

| Tier | Count (pre-existing) |
|---|---|
| commandment | 16 |
| core | 36 |
| contextual | 6 |

| Consumer archetype | Count (pre-existing) |
|---|---|
| universal | 14 |
| ai-coworker-universal | 11 |
| generalist | 0 |
| specialist | 1 |
| route-domain-specific | 32 |

(`generalist` is in the `PRINCIPLE_CONSUMER_ARCHETYPES` enum but has no
authored principles today; included here so the absence is intentional, not
an oversight.)

The 2026-05-22 scope-refactor plan has already landed Phase A (tagging).
What's missing is the orthogonal ring-scope axis and the promotion-discipline
contract.

## 3. The ring-scope axis

### 3.1 New frontmatter field — `principleRingScope`

**Proposed addition to `wiki-frontmatter.ts`:**

```typescript
export type WikiPageFrontmatter = {
  // ...existing fields stay unchanged...
  /** Ring(s) of the Reduction Gear Architecture this principle binds.
   *  Independent axis from principleConsumerArchetype / principleConsumerContexts.
   *  Empty / omitted → universal-ring (binds at every ring) BUT lint warns at
   *  `principle-ring-scope-overuse` threshold (>30% universal-ring, mirroring
   *  the existing universal-archetype guard). */
  principleRingScope?: string[];
};
```

**Proposed addition to `wiki-taxonomy.ts`:**

```typescript
export const PRINCIPLE_RING_SCOPES = [
  "ring-1-coworker",        // Individual coworker capability iteration
  "ring-2-workflow",        // Build Studio phases, A2A handoffs, deliberations
  "ring-3-archetype",       // Vertical/industry segment calibration
  "ring-4-sandbox-prod",    // Promotions, releases, in-prod outcomes
  "ring-5-hive",            // Cross-install federation
  "external-coordination",  // Suppliers / partners / customers
  "universal-ring",         // Binds at every ring (must be earned, not default)
] as const;
export type PrincipleRingScope = (typeof PRINCIPLE_RING_SCOPES)[number];

export function isPrincipleRingScope(value: unknown): value is PrincipleRingScope {
  return (
    typeof value === "string" &&
    (PRINCIPLE_RING_SCOPES as readonly string[]).includes(value)
  );
}
```

**Schema migration:** an additive `principleRingScope String[] @default([])` on
`WikiPage` mirroring the existing `principleAppliesTo` column. No
backwards-incompatible change.

**Schema honesty note:** ring-scope values are a closed enum validated by
`isPrincipleRingScope`, not free-form slugs — so they live in a separate
namespace from `principleConsumerContexts` (free-form kebab-case slugs
validated by `isPrincipleConsumerContextSlug`). The `ring-` prefix on
five of the seven values is a readability convention, not a collision
guard; `external-coordination` and `universal-ring` carry their own
distinctive shapes for the same reason. A principle that has both
`principleRingScope: ["ring-2-workflow"]` and
`principleConsumerContexts: ["engineering-flow"]` is the expected case — depth
and domain are independent.

### 3.2 What each ring scope means in practice

| Ring scope | Calls that should consult it | Example existing principles after backfill |
|---|---|---|
| `ring-1-coworker` | Capability self-improvement, coworker skill acquisition, tool-trace evaluation | `selective-memory-not-total-recall`, `diversity-of-thought`, `specialization-over-generalization` |
| `ring-2-workflow` | Build Studio phase transitions, deliberations, A2A handoffs | `orchestrator-worker-pattern`, `structured-handoffs-not-conversation-history`, `external-and-internal-work-share-gates` |
| `ring-3-archetype` | Archetype calibration, vertical-specific routing, capability profiles | (none today — surface as Ring 3 instrumentation lands) |
| `ring-4-sandbox-prod` | Promotion gates, release decisions, runtime verification | `release-qa-plan`, `test-in-the-portal-build`, `plan-before-install-paths` |
| `ring-5-hive` | Hive contribution gates, calibrated-trust ingest, FeaturePack evaluation | (none today — surface as Ring 4↔5 instrumentation lands) |
| `external-coordination` | Federated / bridged / customer-facing GearInterface emits | (none today — surface as external plane work begins) |
| `universal-ring` | Decisions at any ring (rare; must be earned) | `architecture-over-shortcuts`, `never-fabricate`, `single-source-of-truth` |

### 3.3 Backfill posture

Backfilling 58 principles with ring scope is a separate cleanup BI (parallel
to Phase A of the scope-refactor plan). This spec ships:

- The taxonomy and schema additions
- A backfill default of `["universal-ring"]` for every existing principle so
  no current behavior changes
- A lint detector (`principle-ring-scope-overuse`) that fires at warn
  severity if > 30% of principles are tagged `universal-ring`. The bar
  mirrors the scope-refactor plan's `principle-universal-overuse`
  detector (proposed in Phase D, not yet shipped) — both guard against
  default-to-broadest tagging.

The backfill BI walks the 58 files and assigns narrower scope where the
principle's body makes the ring obvious. The four new principles promoted in
this spec ship with explicit ring scope from day one — they set the example.

## 4. Promotion discipline

### 4.1 Eligibility — when is a principle promotable?

A pattern is eligible for promotion to a principle when **all four** conditions
are met:

1. **Organic use across ≥2 specs or plans.** The pattern shows up in at least
   two independent specs/plans/Build Studio drafts where the authors did not
   know about each other's use. Counterexample: a principle proposed because
   it was useful in one PR and no one else has hit it yet.
2. **Operator-ratified, or unambiguous from a kernel-violation incident.** The
   pattern was either explicitly endorsed by the operator (e.g. memory file or
   feedback comment), or surfaced as the corrective from a documented incident
   (e.g. the 2026-05-23 volume-wipe drove `never-wipe-db-for-code-fixes` to
   commandment tier).
3. **No existing principle covers the same decision moment with ≥0.85
   structured alignment.** Overlap detection (§4.3) must run first.
4. **The pattern names a decision moment, not a state.** "Always X" or "Before
   Y, do Z" are decisions. "X is true" is a fact and belongs in a `summary`
   or `entity` wiki page, not a principle.

Failure mode if any of (1)–(4) is skipped: the kernel accumulates principles
that don't bind decisions, which dilutes the aggregation vector without adding
signal.

### 4.2 Ring-scope assignment — narrowest-applicable default

The default for a new principle is **the narrowest ring scope that still
covers the decisions it actually binds**. Specifically:

- If the principle's `principleDirection` references a primitive that lives
  at exactly one ring (e.g. `FeatureBuild`, `BuildPhaseRun` → Ring 2;
  `ReleaseBundle`, `RuntimeVerification` → Ring 4), the ring scope is that
  single ring.
- If the principle binds two adjacent rings (e.g. a calibration discipline
  that emits at Ring 2 and is consumed at Ring 3), tag both ring scopes
  explicitly. Do not generalize to `universal-ring`.
- `universal-ring` must be earned: the principle's body must show that at
  least three of the five rings need this binding, with examples per ring.
  Lint detector `principle-ring-scope-overuse` warns when the kernel exceeds
  30% universal-ring tagging.

This mirrors the scope-refactor plan's `universal` archetype discipline —
narrow by default, broad only when justified.

### 4.3 Overlap detection — structural alignment before promotion

Before a new principle is merged, the author MUST run a structured-alignment
check against the existing kernel and record the result in the principle file
(new optional frontmatter field `principleOverlapScan`):

```yaml
principleOverlapScan:
  highestAlignment: 0.72
  highestAlignmentSlug: schema-audit-before-features
  rationale: |
    Adjacent but not redundant — schema-audit-before-features is data-model-scoped;
    this principle generalizes to substrate-scoped sequencing across rings.
```

**Threshold rule:**
- `highestAlignment ≤ 0.70` → ship freely.
- `0.70 < highestAlignment ≤ 0.85` → ship only with a paragraph in the body
  explaining why the new principle is *additive* to the closest existing one
  (typical: different decision moment, different ring, different consumer).
- `highestAlignment > 0.85` → do NOT ship as a new principle. Either extend
  the existing principle (which is a one-PR change to its file) or document
  why this is a genuinely orthogonal sibling worth the dimension cost. The
  default outcome is rejection.

**How to run the scan:** call the existing `principle_decide` MCP tool with
the candidate principle's `principleDirection` as a single option, and the
full existing kernel as the principle field. The contribution ledger names
the closest matches by alignment. Pure read; no side effects.

The scan is mechanical, not subjective. Adding the check to the PR
description (and to the frontmatter) is the audit trail.

### 4.4 Dimension orthogonality

Every new principle should reuse existing dimensions from the 14-entry
`PRINCIPLE_DIMENSIONS` registry whenever possible. A new dimension requires:

1. A PR that adds the dimension to `PRINCIPLE_DIMENSIONS` in
   `wiki-taxonomy.ts`.
2. A documented orthogonality claim in the PR: the new dimension is not
   ≥0.7 correlated with any existing dimension in the current vector field
   (correlation measurable as cosine-similarity over the principles that use
   both dimensions, weighted by tier).
3. At least two principles that would use the new dimension (the "build for
   what you have, not what you might need" check).

Today's registry has near-co-linear pairs (`governance_compliance` /
`blast_radius` track each other for ~70% of principles that use both). The
registry should be pruned in a separate cleanup BI, not by this spec, but
the orthogonality bar prevents new co-linear additions.

### 4.5 Retirement

A principle becomes a retirement candidate when **any one** of:

1. **Superseded.** A newer principle covers its decision moment with broader
   or sharper framing. Retirement leaves a pointer in the new principle's
   body to the retired one.
2. **Promoted into the runtime kernel commandments.** A principle that gains
   a `principleRuntimeEnforcement` block is still a principle — it is not
   retired. Promotion to runtime enforcement is additive, not replacing.
3. **Decayed.** The principle has not been consulted by `principle_decide`
   in N months (telemetry exists via the `[principle-decide-trace]` log
   pattern; the cutoff is a separate operational decision).

Retirement mechanics:
- Set `status: archived` on the wiki frontmatter (existing enum value).
- Leave the file in place — git history is evidence.
- Append a `## Retired` section to the body with date and reason.
- Update the recall query to exclude archived principles from the live
  vector field (already the case for Qdrant searches — they filter
  `status: published`; commandment retrieval needs the same filter added).

## 5. Tiered-consultation discipline

### 5.1 The calling-context envelope

Every call into `principle_decide` and `recallPrincipleContext` already carries
`callingPopulation` ("who is asking"). This spec extends the envelope with:

```typescript
export type PrincipleConsultationContext = {
  callingPopulation: PrincipleAppliesToPopulation; // existing
  consumerContexts?: string[];                     // proposed by scope-refactor Phase B
  ringScope?: PrincipleRingScope[];                // new — this spec
  isCrossRing?: boolean;                           // new — Ring N↔N+1 boundary actions
};
```

The `ringScope` field carries the rings the calling action binds. Examples:

- An autonomous capability self-improvement loop in a Ring 1 coworker passes
  `ringScope: ["ring-1-coworker"]`.
- A Build Studio phase transition passes `ringScope: ["ring-2-workflow"]`.
- A GearInterface emit at the Ring 1→2 boundary passes
  `ringScope: ["ring-1-coworker", "ring-2-workflow"]` and `isCrossRing: true`.
- A hive contribution call passes
  `ringScope: ["ring-4-sandbox-prod", "ring-5-hive"]` and `isCrossRing: true`.
- A purely architectural design-time decision (e.g. inside a spec) passes
  `ringScope: ["universal-ring"]` and consults the full universal-ring slice
  plus commandments.

A small registry `apps/web/lib/wiki/calling-ring-map.ts` (proposed) maps
calling surfaces to default ring scopes — same pattern as the
`consumer-context-map.ts` proposed by the scope-refactor plan. The two maps
compose; callers can override either explicitly.

### 5.2 Retrieval contract

Updated `recallPrincipleContext` rules (additive to scope-refactor Phase B):

1. **Commandment branch** (always inject): filter by population AND ring-scope
   intersection with the caller. A commandment scoped `universal-ring`
   always passes; a commandment scoped `ring-4-sandbox-prod` only passes
   when the caller declared Ring 4. Cap stays at 10.
2. **Core branch** (top-K Qdrant): same filters — population, consumer
   contexts (Phase B), ring scope intersection. Cap stays at `coreLimit`
   default 5.
3. **Contextual branch** (above similarity threshold): same filters. Cap
   stays at `contextualLimit` default 5.

**Cognitive-load bound:**

```
principles_consulted_per_decision ≤ commandment_cap (10)
                                 + core_limit       (5)
                                 + contextual_limit (5)
                                 = 20 (matches PRINCIPLE_DECIDE_DEFAULTS.maxPrinciples)
```

This bound is **independent of total kernel size**. A 500-principle kernel
returns the same 20 to a single decision as a 58-principle kernel does today.
The math degrades only via the structured-alignment dot product (which is
per-principle and bounded), not via more principles entering each call.

### 5.3 Commandment-tier override

Commandments override ring-scope filtering only when their `principleRingScope`
intersects the caller OR is `universal-ring`. The intent is the opposite of
"commandments ignore scope" — it's "commandments are non-negotiable within
their declared scope, and a commandment scoped to one ring binds work at that
ring with no override available."

A Ring 4 commandment cannot block a Ring 1 action. If a rule must bind every
ring, its author must declare `principleRingScope: ["universal-ring"]` and
justify it in the body. This forces a conscious choice instead of
universal-by-omission.

### 5.4 Telemetry

A new structured log line `[principle-recall-trace]` records:

- Caller's `callingPopulation`, `consumerContexts`, `ringScope`
- Count of commandments / core / contextual returned
- Slugs of principles that scored highest contribution
- Slugs of principles that were excluded by ring-scope filter (so we can
  detect ring-scoping bugs — if a principle is being excluded everywhere,
  its scope is probably wrong)

Mirrors the existing `[tool-trace]` pattern in `project_tool_trace_logging`
memory and the `[kernel-gate-trace]` in the runtime commandments spec.

## 6. Four candidate principles promoted in this spec

Each candidate is profiled below; the principle files themselves live at
`docs/founder-kernel/wiki/principles/<slug>.md` and ship in the same PR as
this spec.

### 6.1 mirror-dont-migrate

- **Tier:** `core`
- **Ring scope:** `["ring-3-archetype", "ring-4-sandbox-prod"]`
- **Consumer archetype:** `route-domain-specific`
- **Consumer contexts:** `["data-model", "engineering-flow"]`
- **Direction:** Mirror canonical source data into a runtime model and derive
  consumers from the mirror, rather than destructively replacing the canonical
  source with a new schema.
- **Dimension vector:**
  ```json
  {"long_term_maintainability": 0.8, "blast_radius": -0.7,
   "schema_grounding": 0.6, "speed_to_value": -0.3}
  ```
- **Why surfaced:** Governed-upgrade Phase 1
  (`version.json` → `PlatformConfig` mirror → `/api/platform/version` → UI)
  and Reduction Gear (GearInterface dual-emit alongside existing event tables)
  both use this pattern without naming it. The Reduction Gear spec explicitly
  warns against "replacing mature local write models with one generic
  polymorphic table before command semantics are stable."
- **Overlap scan vs existing kernel:** closest match
  `one-data-model` (alignment ≈ 0.62) — paired-but-distinct; one-data-model
  is the design-time anti-pattern ("don't integrate two SoRs"), this is the
  migration-time pattern ("mirror, don't replace").

### 6.2 schema-honesty-over-aspirational-naming

- **Tier:** `core`
- **Ring scope:** `["ring-2-workflow", "ring-3-archetype"]`
- **Consumer archetype:** `route-domain-specific`
- **Consumer contexts:** `["data-model", "engineering-flow"]`
- **Direction:** Name columns, types, and models for what they hold today;
  defer aspirational names until the substrate actually carries the
  aspirational meaning.
- **Dimension vector:**
  ```json
  {"schema_grounding": 0.9, "long_term_maintainability": 0.7,
   "evidence_density": 0.5, "human_cognitive_load": 0.3}
  ```
- **Why surfaced:** Governed-upgrade plan kept SHA-named columns
  (`currentSha`, `targetSha`) until the substrate would actually carry
  versions; Reduction Gear spec explicitly rejected `StorefrontArchetype`
  for runtime-evolving capability and proposed a separate
  `ArchetypeCapabilityProfile` table rather than overloading the existing
  name. Both efforts use the discipline without articulating it.
- **Overlap scan vs existing kernel:** closest match
  `strongly-typed-string-enums` (alignment ≈ 0.55) — about TYPE shape;
  this is about NAME truth. Adjacent, not redundant.

### 6.3 make-silent-failures-observable

- **Tier:** `core`
- **Ring scope:** `["universal-ring"]` (genuinely binds every ring — earned)
- **Consumer archetype:** `ai-coworker-universal`
- **Consumer contexts:** *(none — ai-coworker-universal does not use contexts)*
- **Direction:** Emit a structured signal on every "nothing happened" code
  path so silent failures become queryable.
- **Dimension vector:**
  ```json
  {"evidence_density": 1.0, "governance_compliance": 0.6,
   "long_term_maintainability": 0.5, "human_cognitive_load": -0.3}
  ```
- **Why surfaced:** Governed-upgrade `resolveTargetSha` null-return now
  logs `self-upgrade.no-target` with tracking BI rather than failing
  silently; Reduction Gear spec specifies `slipDetected` + `slipReason` on
  every GearInterface record so non-compounding work is queryable. The
  memory `project_hive_contribution_gaps` documents that earlier silent
  `success: true, prUrl: null` returns broke the entire contribution mode
  until silent-failure observability was added. Three independent surfaces
  using the discipline without naming it = clear promotion signal.
- **Universal-ring justification:** Ring 1 coworker tool calls (silent
  no-op returns), Ring 2 Build Studio phase skips, Ring 4 release
  reconciliation, Ring 5 hive contribution failures all need this — at
  least three rings demonstrably bind, meeting the §4.2 universal-ring bar.
- **Overlap scan vs existing kernel:** closest match
  `fail-fast-explain-clearly` (alignment ≈ 0.67) — `fail-fast` is about
  errors (something went wrong); this is about non-events (nothing went
  wrong, nothing happened, no record of why). Different failure mode,
  different evidence shape, paired-but-distinct.

### 6.4 substrate-cleanup-before-substrate-addition

- **Tier:** `core`
- **Ring scope:** `["ring-2-workflow", "ring-3-archetype"]`
- **Consumer archetype:** `route-domain-specific`
- **Consumer contexts:** `["engineering-flow", "data-model", "portfolio"]`
- **Direction:** Consolidate existing substrate before adding new substrate
  to it; a Phase-0 cleanup pass beats a Phase-1 layer-on every time.
- **Dimension vector:**
  ```json
  {"long_term_maintainability": 0.8, "reusability": 0.6,
   "schema_grounding": 0.5, "speed_to_value": -0.4}
  ```
- **Why surfaced:** Reduction Gear spec explicitly reserves 20% of
  implementation capacity for refactoring existing event/evidence seams
  before adding new emitters: *"The intent is to shrink fragmentation, not
  layer one more table over unclear boundaries."* Governed-upgrade plan
  Phase 0 consolidates `version.json` parsing before Phase 1 builds the
  PlatformConfig mirror. Same discipline; not articulated.
- **Overlap scan vs existing kernel:** closest matches
  `verify-substrate-before-proposing-new` (alignment ≈ 0.78) and
  `schema-audit-before-features` (alignment ≈ 0.72). Both are in the
  `0.70 < x ≤ 0.85` band, so the body must justify additivity:
  - `verify-substrate-before-proposing-new` is the **discovery** discipline
    ("does X already exist before you propose it?"); this is the
    **sequencing** discipline ("when adding a new layer, consolidate the
    existing one first").
  - `schema-audit-before-features` is data-model-scoped; this is
    substrate-scoped across all rings.
  - The three together form a discovery → cleanup → naming progression
    rather than three competing rules.

## 7. Audit table — all 58 existing principles

Columns:

- **Slug** — file slug
- **Tier** — commandment / core / contextual
- **Archetype** — current `principleConsumerArchetype`
- **Recommended ring scope** — first-pass; the backfill BI confirms
- **Overlap notes** — paired-but-distinct (PBD), supersedes-candidate (SC),
  or — if none
- **Retire?** — N (no), C (candidate), R (recommended in same PR)

| Slug | Tier | Archetype | Recommended ring scope | Overlap notes | Retire? |
|---|---|---|---|---|---|
| all-changes-land-via-pr | commandment | route-domain-specific | universal-ring | — | N |
| always-push-after-committing | contextual | route-domain-specific | universal-ring | PBD: branch-guard-before-implementation | N |
| architecture-over-shortcuts | commandment | universal | universal-ring | — | N |
| autonomous-directives-are-blanket-approval | core | ai-coworker-universal | ring-1-coworker, ring-2-workflow | — | N |
| backlog-lives-in-postgresql | core | route-domain-specific | universal-ring | — | N |
| branch-guard-before-implementation | core | route-domain-specific | universal-ring | PBD: always-push-after-committing | N |
| build-gate-mandatory | commandment | route-domain-specific | ring-2-workflow, ring-4-sandbox-prod | PBD: release-qa-plan, test-in-the-portal-build | N |
| check-epic-overlap-before-creating | contextual | route-domain-specific | ring-2-workflow | — | N |
| check-tool-signals-first | core | ai-coworker-universal | ring-1-coworker | — | N |
| consult-specs-first | core | universal | universal-ring | PBD: verify-substrate-before-proposing-new (different decision moment) | N |
| contextualize-before-transforming | core | universal | universal-ring | — | N |
| db-fallback-explicit | contextual | route-domain-specific | ring-1-coworker | — | N |
| dco-sign-off-required | commandment | route-domain-specific | universal-ring | — | N |
| design-research-required | core | universal | universal-ring | PBD: research-and-use-standards (research stance) | N |
| destructive-actions-require-explicit-go | commandment | ai-coworker-universal | universal-ring | — | N |
| diversity-of-thought | core | ai-coworker-universal | ring-1-coworker | — | N |
| do-the-work-dont-task-the-operator | commandment | ai-coworker-universal | ring-1-coworker, ring-2-workflow | PBD: never-ask-user-to-run-commands (escalation form) | N |
| evidence-before-diagnosis | core | ai-coworker-universal | ring-1-coworker | — | N |
| external-and-internal-work-share-gates | core | route-domain-specific | ring-2-workflow, ring-4-sandbox-prod | — | N |
| fail-fast-explain-clearly | core | ai-coworker-universal | ring-1-coworker | PBD: make-silent-failures-observable (this spec; different failure mode) | N |
| fix-the-seed-not-the-runtime | core | route-domain-specific | ring-2-workflow, ring-4-sandbox-prod | — | N |
| human-in-the-loop-at-phase-boundaries | commandment | universal | ring-2-workflow, ring-4-sandbox-prod | — | N |
| keep-root-clone-as-merge-worktree | contextual | route-domain-specific | universal-ring | SC: covered by worktree-per-session + worktree-base-origin-main | C |
| live-state-over-seed-data | core | route-domain-specific | universal-ring | PBD: backlog-lives-in-postgresql | N |
| mention-uncommitted-changes | contextual | route-domain-specific | universal-ring | — | N |
| never-ask-user-to-run-commands | commandment | ai-coworker-universal | ring-1-coworker, ring-2-workflow | — | N |
| never-fabricate | commandment | universal | universal-ring | — | N |
| never-wipe-db-for-code-fixes | commandment | ai-coworker-universal | universal-ring | — | N |
| no-assumptions | commandment | universal | universal-ring | — | N |
| no-hardcoded-colors | commandment | route-domain-specific | ring-2-workflow | — | N |
| one-concern-per-pr | core | route-domain-specific | universal-ring | — | N |
| one-data-model | core | route-domain-specific | ring-3-archetype, ring-4-sandbox-prod, universal-ring | PBD: mirror-dont-migrate (this spec; migration-time counterpart) | N |
| orchestrator-worker-pattern | core | route-domain-specific | ring-2-workflow | — | N |
| organization-canonical-identity | core | route-domain-specific | universal-ring | PBD: single-source-of-truth (specific application) | N |
| plan-before-install-paths | contextual | route-domain-specific | ring-4-sandbox-prod | — | N |
| prefer-self-hosted-infrastructure | core | universal | universal-ring | — | N |
| principal-convergence | core | route-domain-specific | universal-ring | PBD: organization-canonical-identity (different identity surface) | N |
| release-qa-plan | core | route-domain-specific | ring-4-sandbox-prod | PBD: build-gate-mandatory, test-in-the-portal-build | N |
| research-and-use-standards | commandment | universal | universal-ring | PBD: design-research-required (commandment vs spec discipline) | N |
| research-before-implementing | core | universal | universal-ring | PBD: research-and-use-standards (external standards vs internal substrate) | N |
| responsible-capacity-utilization | core | universal | universal-ring | — | N |
| schema-audit-before-features | core | route-domain-specific | ring-2-workflow, ring-3-archetype | PBD: substrate-cleanup-before-substrate-addition (this spec; broader scope) | N |
| security-fix-needs-regression-test-first | core | route-domain-specific | ring-2-workflow, ring-4-sandbox-prod | — | N |
| selective-memory-not-total-recall | core | ai-coworker-universal | ring-1-coworker | — | N |
| single-source-of-truth | commandment | universal | universal-ring | PBD: one-data-model (rule vs application) | N |
| specialization-over-generalization | core | specialist | ring-1-coworker, ring-2-workflow | — | N |
| state-results-directly | core | universal | ring-1-coworker | — | N |
| strongly-typed-string-enums | core | route-domain-specific | ring-2-workflow, ring-3-archetype | PBD: schema-honesty-over-aspirational-naming (this spec; type shape vs name) | N |
| structural-verification-is-not-functional | commandment | route-domain-specific | ring-2-workflow, ring-4-sandbox-prod | PBD: test-in-the-portal-build (live-install vs unit) | N |
| structured-handoffs-not-conversation-history | core | ai-coworker-universal | ring-2-workflow | — | N |
| sweep-main-before-trusting-worktree-specs | core | route-domain-specific | universal-ring | — | N |
| test-in-the-portal-build | commandment | route-domain-specific | ring-2-workflow, ring-4-sandbox-prod | PBD: build-gate-mandatory, release-qa-plan | N |
| tool-evaluation-pipeline | core | route-domain-specific | ring-1-coworker | — | N |
| tools-must-be-self-documenting | core | route-domain-specific | ring-1-coworker | — | N |
| trust-the-data-spine | core | route-domain-specific | ring-3-archetype, ring-4-sandbox-prod | — | N |
| verify-substrate-before-proposing-new | core | universal | universal-ring | PBD: schema-audit-before-features, substrate-cleanup-before-substrate-addition (this spec; discovery vs cleanup) | N |
| worktree-base-origin-main | core | route-domain-specific | universal-ring | PBD: worktree-per-session | N |
| worktree-per-session | core | route-domain-specific | universal-ring | PBD: worktree-base-origin-main | N |

**Summary:**
- Four new principles in §6 ship in the same PR with explicit ring scope
  and overlap-scan results; not duplicated in this table.
- 1 retirement candidate: `keep-root-clone-as-merge-worktree` (superseded by
  the worktree-per-session + worktree-base-origin-main pair). Retirement
  decision deferred to the backfill BI; this spec does not retire it.
- 13 paired-but-distinct clusters surfaced. All retain.
- Candidate orthogonal dimension audit shows likely co-linearity between
  `governance_compliance` and `blast_radius` across ~70% of principles that
  use both. Recommended to a separate dimension-audit BI (out of scope here).

### 7.1 Build-Studio commandment naming clarification

`build-gate-mandatory` and `test-in-the-portal-build` both fire at the
ring-2/ring-4 boundary. The cluster of `build-gate-mandatory` +
`release-qa-plan` + `test-in-the-portal-build` +
`structural-verification-is-not-functional` is a coherent family of
"is this really done?" rules at different decision moments. None is
strictly redundant with another; all four are retained.

### 7.2 Candidate orthogonal dimensions surfaced for future audit

The 14-dimension registry was audited against the 58 principles. Co-linearity
observations (not actionable in this spec):

- `governance_compliance` ↔ `blast_radius`: ~70% co-direction
- `evidence_density` ↔ `schema_grounding`: ~60% co-direction
- `human_cognitive_load` ↔ `speed_to_value`: ~55% co-direction (inverse)

These are signal-degrading enough to justify a future dimension-pruning BI
but not severe enough to block this spec. Logged here for the next reviewer.

## 8. Acceptance criteria

This spec ships when:

1. **Spec text merged** at the path declared in §0 frontmatter.
2. **Four principle files merged** with the frontmatter shapes described in
   §6 (ring scope, dimensions, archetype, contexts, overlap scan, body).
3. **No existing principle file modified destructively.** Additive
   cross-reference updates allowed (e.g. adding a `Related principles`
   pointer to a new principle).
4. **No code changes in this spec.** Schema and taxonomy proposals are
   captured as `Proposed addition to ...` blocks; the implementing PR is a
   separate BI under EP-REDUCTION-GEAR-ARCH.
5. **Backlog item BI-746268A1 marked `done`** with resolution citing the
   merged PR.
6. **Downstream BI filed** for: schema migration + taxonomy registry
   addition + lint detector + recall extension + backfill of `principleRingScope`
   on all 58 existing principles. That BI is the implementation of this
   spec.

## 9. Trade-offs and open questions

### 9.1 Ring scope vs consumer context — orthogonal or merge?

**Question:** could `principleRingScope` be merged into
`principleConsumerContexts` as additional governed slugs (e.g.
`ring-2-workflow` becomes a context)?

**Lean: keep orthogonal.** Rings describe depth of the agentic loop;
contexts describe domain. A principle like `no-hardcoded-colors` is Ring 2
(it fires during BS workflow phases) AND context `ui` — the two answer
different filtering questions. Collapsing them sacrifices the orthogonality
that makes the recall math bounded. Records the choice; revisitable if the
audit shows ≥80% redundancy between any ring and any context.

### 9.2 Should `universal-ring` exist at all?

**Question:** the bar for `universal-ring` is high; would forcing every
principle to enumerate specific rings produce better hygiene?

**Lean: keep universal-ring with the 30% lint warn.** Some principles
(e.g. `never-fabricate`) genuinely bind every ring and enumerating five
ring scopes per file is friction without signal. The lint guard captures
overuse; the field is honest about what it claims.

### 9.3 Overlap scan threshold

**Question:** is 0.85 alignment the right rejection bar?

**Lean: ship at 0.85, revisit after first 5 promoted principles.** A
threshold that's too tight rejects useful additive principles; too loose
admits redundancy. 0.85 is high enough that genuine duplicates flag while
adjacent-but-distinct passes. The four candidates in §6 all sit between
0.55 and 0.78 — none would be rejected under the proposed rule.

### 9.4 Implementing the runtime gating

**Question:** when does §5.2's bounded-consultation rule become a runtime
contract, not a spec promise?

**Lean: separate BI under EP-REDUCTION-GEAR-ARCH.** This spec defines the
contract; the downstream BI implements the schema migration, taxonomy
addition, lint detector, recall extension, and calling-ring map. Splitting
keeps the spec PR focused on principles and contracts.

### 9.5 Dimension-pruning audit

**Question:** the co-linearity findings in §7.2 suggest the dimension
registry has redundancy. Prune now or later?

**Lean: later.** Pruning dimensions retires data from existing principle
vectors and re-derives `principleDimensions` across the kernel — a heavy
edit that warrants its own design pass. Capture as a follow-up BI; out of
scope here.

## 10. Out of scope

- **Implementation of the runtime gating.** Separate downstream BI.
- **Backfill of `principleRingScope` across 58 existing principles.**
  Separate cleanup BI (parallel to scope-refactor Phase A).
- **Promotion of principles beyond the four in §6.** Other candidates
  (e.g. a "graduation events are explicit" principle from the Reduction
  Gear trust ladder) are captured in the audit but not promoted in this
  session.
- **Changes to the runtime kernel commandments spec.** Cross-referenced
  only — that spec governs execution-time enforcement and is adjacent,
  not overlapping.
- **Dimension-pruning audit.** Captured as follow-up; not in this spec.

## 11. Definition of done

- This spec file merged to `main` via DCO-signed PR
- Four principle files merged to `main` in the same PR or in a paired PR
- BI-746268A1 marked `done` with resolution citing the merged PR
- Downstream implementation BI filed under EP-REDUCTION-GEAR-ARCH
