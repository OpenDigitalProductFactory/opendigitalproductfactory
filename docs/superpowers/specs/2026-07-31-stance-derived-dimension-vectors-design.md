---
title: Stance-Derived Dimension Vectors — connect the layer owners edit to the layer that scores
authoredAt: 2026-07-31
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: BI-E1427A3E
epic: EP-DECISION-TIER-REBALANCE
relatedSpecs:
  - docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md
  - docs/superpowers/specs/2026-07-25-job-specific-decision-vector-inventory-design.md
  - docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md
  - docs/superpowers/specs/2026-07-11-wwwd-stance-onboarding-design.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/decisions-belong-to-their-scope.md
  - docs/founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md
  - docs/professions/enterprise-architecture/wiki/verify-the-substrate-before-proposing-new.md
---

# Stance-Derived Dimension Vectors

## Summary

The platform has two things called "vectors" and they are not connected.

The layer a business owner actually edits — five plain-English business stances, pre-answered from
their archetype, three carrying a dollar authority ceiling — is seeded as `pageKind: "stance"`
material with **no `principleDimensionVector`**. So it steers decisions only by being *retrieved*
and semantically matched. The layer that actually scores options — the 20-axis registry — never sees
it.

This spec proposes the mapping that closes that gap: a platform-owned, compile-enforced
`STANCE_DIMENSION_MAP` that turns a **confirmed** stance (and its `ceilingUsd`) into a signed
dimension vector at an authority tier the existing promotion ladder already computes.

The contribution is deliberately narrow. It adds **no axes**, changes **no stance keys**, and
touches **no archetype defaults or confirmation UX**. It writes one mapping and derives from it.

---

## 1. What exists (grounded, per `verify-the-substrate-before-proposing-new`)

Verified against `main` @ `b6a82e48d4`, 2026-07-31.

- **The five stance keys** are closed: `STANCE_VECTOR_KEYS`
  (`apps/web/lib/onboarding/archetype-business-context.ts:414`) — `customer-goodwill`,
  `pricing-integrity`, `growth-vs-stability`, `quality-bar`, `spend-authority`.
- **Archetype defaults exist and genuinely differ.** `GENERIC_STANCE_VECTORS` (`:434`) plus
  `INDUSTRY_STANCE_VECTORS` (`:466`), keyed by **archetype-category slug**; 12 categories override at
  least one vector. Three vectors carry `ceilingUsd` (generic: goodwill 100, pricing 100, spend 250).
- **Stance pages are seeded without a principle block.** `seed-org-wwwd-corpus.ts:264-285` builds each
  stance page with `pageKind: "stance"` and `bundles: STANCE_VECTOR_BUNDLES[key]`, and **no
  `principle` field** — only the mission page gets `principle: { principleTier: "core", ... }`
  (`:132`, `:195`). The `WikiPage.principleDimensionVector` column
  (`schema.prisma:12841`) is therefore null for every stance page in every install.
- **Confirmation is already the authority lever, and it is already tiered.**
  `stance-promotion.ts:20-23`: `unconfirmed` B/0.6 → `confirmed` A/0.9 → `ruled` A/1.0, and
  `promoteStanceMaterial` never downgrades (`:85`). `confirm-stance-vectors.ts` documents why the
  whole class bundle upgrades together — the gate's confidence is a **mean**, so a confirmed vector
  sitting next to an unconfirmed identity echo lands below the recommend band (the "mixed-drag
  hazard", proven in `stance-onboarding.simulation.test.ts`).
- **Bundles bind stances to decision classes.** `STANCE_VECTOR_BUNDLES`
  (`seed-org-wwwd-corpus.ts:58-64`) maps each key onto `DecisionDomainClass` values from the closed
  set `["plan-readiness", "architecture-tradeoff", "risk-assessment", "professional-practice",
  "kernel-consult"]` (`decision-perspective/types.ts:32`).
- **Scoring mode is chosen two-sided.** `computeStructuredAlignment` runs only when *both* the
  principle declares dimensions *and* the option scores at least one of them (`hasScoreableOverlap`);
  otherwise `computeSemanticAlignment` (cosine over embeddings) is used. **This is why the gap is
  currently silent**: a stance page has no dimensions, so it always takes the semantic path, and
  nothing anywhere reports that the owner's stated policy never entered a structured score.
- **The registry is closed and compile-enforced.** `PRINCIPLE_DIMENSIONS` (20 axes,
  `wiki-taxonomy.ts:144`), scope classification `satisfies Record<PrincipleDimension, ...>`
  (`dimension-scope.ts:209`), and `validateOptionFeatures` rejects unknown keys.
- **Five axes are costs**, and a principle opposing them must carry a **negative** weight
  (`PRINCIPLE_COST_DIMENSIONS`, `wiki-taxonomy.ts:201`). The inversion this prevents is not
  hypothetical — see the 2026-06-14 sign audit.

### 1.1 The measurement this feeds

The tier-rebalance baseline: 95 principles average 3.6 of 19 axes; effective rank ≈ 6;
`cost_efficiency` is scored by **zero** principles. That last one matters here — `cost_efficiency`
is spine, is explicitly protected from the demote-if-unused rule, and is *exactly* what a
goodwill/pricing/spend stance is about. **Stance-derived vectors are the natural first authors of
the registry's most conspicuously empty axis.**

---

## 2. Thesis

**T1. The owner has already answered the elicitation questions.** DPF has an open item
(BI-DF87F8D2) to build AHP-style pairwise elicitation for cold-start weights. But an onboarded org
has already stated five postures *and* attached money to three of them. Deriving a vector from
answers already given is strictly cheaper than running a fresh comparison session, and it does not
add an onboarding step. §7 proposes sequencing this first and re-scoping DF87F8D2 accordingly.

**T2. `ceilingUsd` is the rare thing in this system: an owner-stated magnitude in a real unit.**
Every other weight in the registry is a hand-picked number on an arbitrary scale. A ceiling is
denominated in dollars, chosen by the person who bears the cost, and already load-bearing for
autonomy ("up to $X per case may be resolved without the owner"). It should inform *magnitude*, not
merely presence — but it must be **normalised**, never used literally (§4.2).

**T3. Authority already exists; do not invent a second ladder.** `weight-inference.ts` proposals
enter *below* `unconfirmed` at 0.3 because a statistical inference has nobody vouching for it. A
confirmed stance is the opposite case: a human explicitly authored it. It should inherit the tier
`stance-promotion.ts` already computed, and sit **below authored doctrine but above statistical
inference**.

**T4. This must not become a per-org axis backdoor.** The hard constraint from the tier-rebalance
spec (§2.3) — an install *re-weights* the shared spine, it never *declares* axes — is the guardrail
the entire hive-generalisation property rests on. The mapping is therefore **platform-owned and
identical in every install**; only the resolved weights differ per org.

---

## 3. Proposed design

### 3.1 `STANCE_DIMENSION_MAP` — the mapping (platform-owned)

A new module (proposed: `apps/web/lib/decision-perspective/stance-dimension-map.ts`) declaring, per
stance key, the axes it legitimately speaks to, with a signed direction and a written rationale per
edge. Compile-enforced as `satisfies Record<StanceVectorKey, StanceAxisEdge[]>` with every axis key
constrained to `PrincipleDimension`, so an unknown axis is a compile error rather than a silent drop
— the same discipline as `dimension-scope.ts`.

The proposed mapping, with signs stated explicitly (cost axes marked ✱, where a negative weight means
"this stance pulls against the cost"):

| Stance | Axis | Sign | Why this edge |
|---|---|---|---|
| `customer-goodwill` | `cost_efficiency` | **−** | The stance is a declared willingness to absorb cost to preserve a relationship. Negative = this org trades money away here. |
| | `long_term_maintainability` | + | The thing being bought is relationship durability. |
| | `speed_to_value` | + | "Resolve it on the spot" is explicit in every default. |
| | `operator_effort` ✱ | − | "Without making the customer fight for it" is a demand to keep effort low. |
| `pricing-integrity` | `governance_compliance` | + | Honouring a quoted price, including our own error, is the commitment-keeping axis. |
| | `evidence_density` | + | The quote record binds; the stance is that the record wins over convenience. |
| | `cost_efficiency` | **−** | Honouring our own mistake is deliberately not the cheap option. |
| `growth-vs-stability` | `long_term_maintainability` | + | Existing commitments get first call on capacity. |
| | `speed_to_value` | **−** | "At the pace quality allows, not faster" is an explicit speed trade-away. This is the clearest case of a legitimately negative weight on a benefit axis. |
| | `capacity_utilization` | + | Profession-local (operations), projects onto `cost_efficiency`. Only applies inside operations work. |
| `quality-bar` | `long_term_maintainability` | + | "A redo is cheaper than a lost reputation" is durability reasoning. |
| | `evidence_density` | + | A standard that is checkable rather than asserted. |
| | `speed_to_value` | **−** | Work does not leave below standard, however urgent. |
| | `public_safety` | + | **Conditional** — only where the archetype's `quality-bar` default names safety (clinics, food, trades). Not asserted generically. |
| `spend-authority` | `cost_efficiency` | + | The stance is directly about money discipline. |
| | `blast_radius` ✱ | − | "Novel, recurring, or above the ceiling" is a reach limit, not just a price limit. |
| | `reversibility` | + | Routine budgeted purchases are the reversible ones; the ceiling is where irreversibility begins. |
| | `legibility_of_consequence` | + | The ceiling exists so the owner can foresee what proceeds without them. |

Every edge above is a **proposal for review**, not a settled fact. §6 requires each to be justified
against the archetype defaults' actual wording before it ships, and §5 requires the whole map to pass
kernel scoring rather than be asserted.

### 3.2 Derivation and attachment

On confirmation (the existing `stance-confirm.ts` path), for each confirmed vector:

1. Resolve edges from `STANCE_DIMENSION_MAP`.
2. Compute each edge's magnitude (§4.2).
3. Write the resulting signed vector to that stance page's `principleDimensionVector`, with a
   generated `principleWeightRationale` naming the stance, the archetype default it came from, and
   whether the owner adjusted it.
4. Leave `principleTier` unset — a stance is **not** a kernel principle and must not inherit
   commandment/core/contextual magnitudes. Its weight comes from the ladder (§4.1).

Unconfirmed stances derive **nothing**. The archetype default is a starting suggestion, not the
org's judgement, and it must not score until a human adopts it. This preserves exactly the property
`confirm-stance-vectors.ts` was built around.

### 3.3 Scope containment

A stance is WWWD — the organisation's own policy. Per `decisions-belong-to-their-scope`, a
stance-derived vector must score **only** decisions the org scope owns. It must not:

- influence WWMD/platform decisions (a customer's goodwill posture is not founder doctrine);
- influence WSID/profession craft floors (an org cannot re-weight what competent practice means);
- reach decision classes outside its own `STANCE_VECTOR_BUNDLES` binding.

The bundle binding already exists and already scopes the material by class; the derivation must not
widen it. Concretely: `quality-bar` is bundled to `professional-practice` only, so its derived vector
scores there and nowhere else.

---

## 4. The two numbers that need care

### 4.1 Authority — where a derived vector sits

Derived vectors participate through the **existing** material weighting, not a parallel path. The
resulting ordering, strongest to weakest:

| Source | Effective authority | Rationale |
|---|---|---|
| Kernel commandment | 1.0 magnitude | Ratified doctrine; unchanged |
| Core / contextual principle | 0.4 / 0.1 | Unchanged |
| Stance, `ruled` | A/1.0 material | A human ruled on a real decision in this class |
| Stance, `confirmed` | A/0.9 material | The owner explicitly adopted it |
| Stance, `unconfirmed` | **derives nothing** | Archetype suggestion, not org judgement |
| Weight inference (statistical) | enters at 0.3, sub-`unconfirmed` | Nobody vouches for it |

A derived vector can therefore never outrank a commandment, and never sits below a statistical
inference. **No new tier is introduced.**

### 4.2 Magnitude — normalising `ceilingUsd`

Using a ceiling literally would make a self-storage business with a $500 ceiling "care about cost
efficiency five times more" than a restaurant with a $100 one, which is nonsense — the restaurant's
smaller ceiling reflects ticket size, not conviction.

The ceiling must therefore be interpreted **relative to that archetype's own default**, which is the
only honest baseline available: it is the posture typical for that kind of business.

```
ratio      = ownerCeiling / archetypeDefaultCeiling
magnitude  = clamp(base × f(ratio), floor, cap)
```

An owner who leaves the default untouched gets the base magnitude. An owner who *raises* the ceiling
is saying "we go further than typical here", and the magnitude moves — sublinearly (a log or
square-root shape), clamped, so an extreme entry cannot dominate the ledger. Vectors without a
ceiling (`growth-vs-stability`, `quality-bar`) use the base magnitude only.

Exact curve, base, floor and cap are deliberately **left open for Phase 1 calibration** against real
orgs rather than picked here; §6 requires the simulation to fix them before the derivation ships.

### 4.3 The sign guard must cover this

Derived vectors are exactly the shape that produced the `never-wipe-db-for-code-fixes` inversion: a
generated positive weight landing on a cost axis makes the scorer reward the harm. Three of the
proposed edges are negative-on-cost (`operator_effort`, `blast_radius`) or
negative-on-benefit-by-design (`speed_to_value`, `cost_efficiency`).

The existing seed-time sign-convention guard must be extended to assert over `STANCE_DIMENSION_MAP`
at compile/test time **and** over the derived vectors at write time. A derived vector that violates
the convention must fail loudly, never be written.

---

## 5. Research and validation (per `design-research-required`)

1. **Ground each edge in the defaults' actual wording.** Every edge in §3.1 must be traceable to
   language present in the generic default or an archetype override — not to what the axis name
   suggests. Where an edge is only supported in some archetypes (`public_safety` on `quality-bar`),
   it is conditional, not universal.
2. **Kernel-score the map itself.** The mapping is a decision with alternatives (which axes, how
   many edges, whether ceilings scale magnitude at all). Run it through `principle_decide` so the
   choice is defensible rather than asserted — the same discipline the tier-rebalance and inventory
   specs applied to their own choices.
3. **External grounding.** Value-focused thinking (Keeney 1992) is the closest prior art for
   deriving decision criteria from stated objectives rather than eliciting weights directly, and it
   is the honest citation for "convert a stated posture into criteria weights". The AHP
   eigenvector method (Saaty 1980) stays cited where it belongs — as DF87F8D2's method, not this
   one's.
4. **Simulate before shipping.** `apps/web/lib/decision-perspective/stance-onboarding.simulation.test.ts` already models the mixed-drag
   hazard. Extend it to assert that (a) adding derived vectors does not push any class below its
   recommend band, and (b) a confirmed stance measurably changes at least one option ranking versus
   the semantic-only path — otherwise the whole exercise is decorative.

---

## 6. Sequencing

| Phase | Work | Gate before proceeding |
|---|---|---|
| 0 | Author `STANCE_DIMENSION_MAP` with per-edge rationale; compile enforcement; extend the sign guard. No derivation, no writes. | §5.1 wording trace + §5.2 kernel scoring |
| 1 | Calibrate §4.2 (curve, base, floor, cap) in simulation. Still no writes. | §5.4 simulation: no class drops below its band |
| 2 | Wire derivation into the confirm path; write `principleDimensionVector` + rationale on confirmed stances only. Backfill existing confirmed stances. | Ranking-change evidence (§5.4b) |
| 3 | Surface it: show the owner which factors their stance moved, on `/coworker-decisions/stance`. | UX-fit review |
| 4 | Decide DF87F8D2's fate explicitly — reduced to a refinement step, or closed as superseded. | Founder ratification |

Phase 3 is not cosmetic. The platform's stated differentiator is the inspectable contribution
ledger; a derived weight the owner cannot see is exactly the opaque scoring this architecture exists
to avoid.

---

## 7. Relationship to BI-DF87F8D2 (must be decided, not drifted)

Both items answer "where does a brand-new org's weight vector come from". They should not both ship
unexamined.

- **This spec**: derives from five questions already answered, with archetype defaults pre-filled and
  a real money magnitude. Zero added onboarding burden.
- **DF87F8D2**: derives from a fresh pairwise comparison session, producing a full weight vector with
  a consistency check.

The honest read is that this is the better *default* and DF87F8D2 is the better *refinement* — worth
reaching for only when a derived vector is ambiguous or an org wants to tune deliberately. Phase 4
forces that call explicitly rather than letting two overlapping mechanisms accrete.

---

## 8. Non-goals

- New axes, per-org axes, or any widening of `PRINCIPLE_DIMENSIONS` (§2 T4 — hard no).
- Changing the five stance keys, the archetype defaults, or the confirmation UX.
- Replacing `weight-inference.ts`. Revealed preference from real rulings remains the stronger signal
  and supersedes a derived cold-start vector once history exists.
- Deriving anything from an **unconfirmed** stance.
- Letting a stance weight WWMD or WSID decisions (§3.3).

## 9. Acceptance

1. `STANCE_DIMENSION_MAP` exists, is compile-enforced, and every edge carries a rationale traceable
   to the stance defaults' own wording.
2. The sign guard covers both the map and derived vectors; a violating vector cannot be written.
3. A confirmed stance produces a signed vector at the ladder-derived tier, scoped to its bundled
   decision classes only, and provably below commandment authority.
4. Simulation shows no decision class drops below its recommend band, and at least one option ranking
   demonstrably changes versus the semantic-only path.
5. `cost_efficiency` — scored by zero principles at the §1.1 baseline — is measurably scored after
   this lands.
6. The owner can see which decision factors their stance moved (Phase 3).

## 10. Open questions for founder ratification

1. **Should a *ruled* stance be able to reach commandment-level magnitude in its own class?** The
   ladder gives it A/1.0 material weight, but that is material confidence, not principle magnitude.
   Proposed: no — org policy is authoritative within its scope but never doctrine-tier.
2. **Does `ceilingUsd` scale magnitude at all, or only gate autonomy?** §4.2 proposes it scales,
   sublinearly. The conservative alternative is that it stays purely an autonomy threshold and every
   derived edge uses the base magnitude.
3. **Is `public_safety` on `quality-bar` conditional (per archetype) or never derived?** Deriving a
   safety weight from a commercial quality stance is the most aggressive edge proposed; it may
   belong to profession corpora only.
4. **DF87F8D2** — reduce to a refinement step, or close as superseded (§7)?
