---
title: Job-Specific Decision-Vector Inventory — sourcing-classified, per-job, fleet-comparable
authoredAt: 2026-07-25
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: pending — file against live Postgres before any implementation phase (per backlog-lives-in-postgresql).
epic: EP-DECISION-TIER-REBALANCE
relatedSpecs:
  - docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md
  - docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md
  - docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md
relatedPlans:
  - docs/superpowers/plans/2026-07-24-profession-local-decision-axes.md
  - docs/superpowers/plans/2026-07-24-weight-inference-from-rulings.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/decisions-belong-to-their-scope.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md
---

# Job-Specific Decision-Vector Inventory

## Summary

The JSI fluid-weight-layer spec (2026-07-24) proposed proving the fast/situational
layer with **one** archetype and **one** correlate. This spec replaces that
narrow pilot with the question the founder posed instead: **across the jobs AI
coworkers actually do, what are the decision vectors that matter — determined
holistically, not one at a time — and how is each one sourced?**

That reframing is not a detour from JSI Phase 3. It is Phase 3, correctly sized.
A single seasonal correlate proves a mechanism; it does not answer *what each job
should be scoring its decisions on* — and that is the question whose current
answer is measurably wrong: the decision space is rank-deficient (effective rank
≈ 6 of 19; §1.2 of the tier-rebalance spec). Inventorying the real per-job
vectors is what fixes that. The one-correlate pilot survives as a single
instance of one sourcing class, not the whole of Phase 3.

The spec's contribution is one idea with three consequences: **make the way a
vector is sourced a first-class property of the vector**, because sourcing
determines authoring, weighting, and refresh. The tier-rebalance spec already
named the classes (§1.4: measured / policy / revealed-preference / predictive)
but left them as prose with no substrate — every `principleDimensionVector` is
hand-authored regardless of class today
(`packages/db/src/wiki-taxonomy.ts:144-178`; spec §1.4). This spec proposes the
substrate and the per-job inventory that uses it.

---

## Thesis

**T1. "Which vectors" and "how they are weighted" are two problems, and today
we conflate them.** A `principleDimensionVector` is a single hand-authored
signed vector (`docs/founder-kernel/AUTHORING.md` §3). It bundles the *selection*
of axes with the *magnitude* on each. That is fine for a commandment an operator
ratifies by hand. It is the wrong shape for a vector whose right value is a fact
about the world (a season's effect on demand), a fact about the org (how this
owner actually trades cost against consent), or a fact that must be looked up
(an external signal). Those want different authoring, different refresh cadence,
and different authority to change — which is exactly the JSI three-timescale
argument, generalised from *timescale* to *source*.

**T2. Sourcing class is the missing property.** Mark's framing names three, which
map onto the tier-rebalance epistemology taxonomy and onto real substrate:

| Sourcing class (founder's words) | Epistemology class (tier-rebalance §1.4) | What it is | Where it already lives |
|---|---|---|---|
| **"more basic"** | policy / measured | Hand-scored, stable, shared. The spine. | `PRINCIPLE_DIMENSIONS` (20 axes) — `wiki-taxonomy.ts:144-178`; scope in `dimension-scope.ts` (12 spine) |
| **"need a graph and a corpus"** | revealed-preference + corpus-derived | A profession's craft vocabulary, derived from its WSID corpus; and an org's revealed weights, learned from rulings | Profession-local axes registry (`profession-local-axes.ts`) — **ships empty**; revealed-preference inference (`weight-inference.ts`, BI-D88DFEEA) — **shipped, now fed** by BI-6DCF772F |
| **"external info looked up and provided"** | predictive / signal | A live external fact fetched at decision time, validated against outcome before it is allowed to score | **Absent** — the JSI §4.3 fast layer |

**T3. The inventory is per-job, but the space stays shared.** The hard constraint
(tier-rebalance §2.3): an install *may not declare new axes; it re-weights the
spine*, and a profession multiplies vectors *inside* its corpus "without
inflating the shared space every profession must reason over" (§2.2). So a
"per-job vector inventory" is not a per-job feature explosion. Per job, we do
exactly two governed things: **select and weight** spine axes, or **declare a
profession-owned local axis that projects onto the spine** (`<profession>/<axis>`,
`profession-local-axes.ts:99-124`). Anything else fragments the fleet and
"destroy[s] the hive's ability to generalise" (§2.3). This is the guardrail the
whole spec is built to hold.

---

## 1. What exists (grounded)

Per `verify-substrate-before-proposing-new`, this names the substrate before
proposing anything.

- **20 spine axes**, closed `as const`, PR-gated: `PRINCIPLE_DIMENSIONS`
  (`wiki-taxonomy.ts:144-178`). 15 benefit + 5 cost (`PRINCIPLE_COST_DIMENSIONS`,
  `:201-216`). Sign convention (negative weight = pulls against; a positive
  weight on a cost axis is the inversion bug the 2026-06-14 audit caught) is
  load-bearing (`wiki-taxonomy.ts:180-199`).
- **Scope classification** in `dimension-scope.ts` (the spec §2.1 citation of
  `wiki-taxonomy.ts` is now stale): **12 spine** + **8 profession-local** demoted
  axes, each with `projectsOnto` + rationale (`dimension-scope.ts:89-209`); an
  unclassified new axis is a compile error (`satisfies Record<...>`, `:209`).
  Projection splits weight evenly across targets and must terminate on the spine
  in one hop (`:227-250`, `:280-282`).
- **Profession-owned namespaced registry** (`profession-local-axes.ts`,
  BI-106C2585) — the mechanism for a profession to declare a *net-new* axis
  inside its own corpus, namespaced so it can never collide with the spine. It
  **ships empty** (`profession-local-axes.ts:65-71`); the only worked axis
  (`ux-design/hierarchy_flatness`, cost-framed per BI-72E8FF05) lives in a test. Phases 2–3 (thread the
  caller's profession into `principle_decide`; validate + score the namespaced
  key) are **not built** (`plan 2026-07-24-profession-local-decision-axes.md:39-48`).
- **Revealed-preference inference** (`weight-inference.ts`, BI-D88DFEEA): built,
  and now actually fed — BI-6DCF772F closed the four gates so a ruled decision
  produces a `WeightInferenceObservation`. This is the medium-timescale weighter
  for the graph+corpus class.
- **The rank-deficiency the inventory must fix** (tier-rebalance §1.1–1.2):
  95 principles average 3.6 of 19 axes; `long_term_maintainability` loads 68%,
  `cost_efficiency` is **never used**; effective rank ≈ 6; 70 of 95 principles
  carry inert vectors (only the 25 commandments score structurally). The space
  is under-determined *and* concentrated in one persona's authorship (~41%).
- **23 professions**, all with real corpora (4–17 pages;
  `docs/professions/registry.json`). **Zero** own a `PROFESSION_LOCAL_AXES` entry
  today; only 5 own a demoted spine axis.
- **The epistemology taxonomy already exists — as prose only.** Tier-rebalance
  §1.4 names measured / policy / revealed-preference / predictive but gives them
  no code; `principleDimensionVector` is uniformly hand-authored (§1.4,
  `AUTHORING.md` §3). **This is the gap this spec fills.**

## 2. Proposed design — sourcing as a first-class property

### 2.1 A `dimensionSourcing` classification (the substrate)

Add, per axis, a declared **sourcing class** — the code analogue of tier-rebalance
§1.4, co-located with the existing scope registry (`dimension-scope.ts`) so an
axis's scope and its sourcing are declared together and an unclassified axis stays
a compile error:

- `basic` — hand-scored, stable. Authored as today. Refresh: PR + ratification.
- `corpus-derived` — a profession-local axis whose meaning comes from its WSID
  corpus (the empty `profession-local-axes.ts` registry is where these land).
  Refresh: corpus change → re-derive.
- `revealed` — a weight learned from rulings via `weight-inference.ts`. Never the
  axis *selection* (that stays governed), only the *weight*, and only through the
  existing proposal ladder (enters at confidenceWeight 0.3, human-ruled).
- `external` — a live looked-up signal, validated-against-outcome before scoring;
  modulates at inference time, never persisted as a stored weight (JSI §4.3).

This is a **label on an existing axis**, not a new axis and not a new scope. It
does not touch the closed spine set or the fleet-comparability constraint. It
tells the platform *how to keep each axis's weight honest*.

### 2.2 The per-job inventory (the actual work)

For each of the 23 professions, produce a **typed vector inventory**: the axes
that genuinely drive that job's decisions, each tagged with scope (spine vs a new
profession-local) and sourcing class. Governed by §2.3's two moves only —
select/weight the spine, or declare a projecting local axis — so the output is a
concrete, reviewable authoring backlog, not a feature free-for-all. The inventory
is where the rank-deficiency gets repaired: a job that today lights only
`long_term_maintainability` gets the 3–5 axes that actually discriminate its
calls.

### 2.3 Weighting, separated by class (T1 made concrete)

The founder's "balancing the weights is another thing" becomes a routing rule:
- `basic` → hand-authored `principleDimensionVector` (unchanged).
- `corpus-derived` → derived from the corpus + refined by `revealed` inference on
  that profession's rulings.
- `revealed` → the shipped proposal ladder (BI-D88DFEEA/6DCF772F).
- `external` → the validate-against-outcome gate (JSI §4.3), one pilot first.

So "which vectors" (§2.2, governed authoring) and "how weighted" (§2.3, routed by
class) stay the two separate problems the founder named.

## 3. Research (the "some research can be made")

Per `design-research-required`, the per-job inventory is grounded, not invented:
1. **Internal corpus mining** — for each profession, which axes do its existing
   corpus pages + its actual `DecisionInteraction` history already lean on? (The
   rank-deficiency table is the baseline; the gates now record real option
   vectors.)
2. **External practice** — decision-analysis / MCDA axis taxonomies, and the
   role's own professional-body decision criteria, to find the axes a job *should*
   weigh that the corpus is silent on.
3. **Kernel-scored selection** — each candidate axis-set runs through
   `principle_decide` (as this spec's own choices did) so the inventory is
   defensible, not asserted.

## 4. Non-goals

- New spine axes by fiat, or per-install/per-org axes (§2.3 — hard no).
- Making the `basic`/spine layer adaptive (it is correctly slow).
- Building the `external` framework before one validated pilot (JSI §4.3).
- Re-authoring commandment vectors (tier-rebalance invariant; diff-verify).
- A per-coworker-instance vector space (WSID is per role family, not per agent).

## 5. Sequencing

| Phase | Work | Depends on |
|---|---|---|
| 0 | `dimensionSourcing` label substrate (§2.1) — additive, compile-enforced | none |
| 1 | Per-job inventory for 2–3 deep professions first (data-architect, operations, software-engineer) — the authoring backlog | Phase 0 + §3 research |
| 2 | Author the selected spine weightings + first profession-local axes; wire `profession-local-axes.ts` Phases 2–3 (the empty registry gets its first real entries) | Phase 1 |
| 3 | The one `external` pilot (JSI §4.3), as one inventory row — kernel-recommended `rental-peak-season` (DI-FE4ECA6F3B0A) unless the inventory surfaces a better-grounded correlate | Phases 0–2 |
| 4 | Founder review before any learned/looked-up weight influences a live composite (JSI Phase 4) | 1–3 |

## 6. Risks

- **Inventory-as-fragmentation.** The whole spec fails if "per-job vectors"
  becomes per-job axes. Mitigated structurally: only §2.3's two governed moves
  are available; `validateOptionFeatures` already rejects unknown keys
  (`dimension-catalog.ts:190-228`).
- **Authoring concentration repeats.** If the same persona authors all 23
  inventories, we relocate rank-deficiency rather than fix it. Mitigated by
  §3's per-role external grounding + kernel scoring.
- **Naming honesty (spec §9.4 / `schema-honesty-over-aspirational-naming`).** An
  `external`/`predictive` axis that is not yet validated must not be named as a
  proven signal in its own code — the same trap the 2026-07-22 design-quality
  work fixed once. Its label should read as candidate until it earns promotion.

## 7. Acceptance

1. This spec merged; a live BI/epic filed under EP-DECISION-TIER-REBALANCE.
2. `dimensionSourcing` labels exist for all 20 axes, compile-enforced (Phase 0).
3. At least one profession's inventory is authored end-to-end and measurably
   raises the number of discriminating axes on its decisions vs the §1.2 baseline.
4. No change touches the closed spine set, commandment vectors, or the retrieval
   embedding path (diff-verified each phase).

## 8. Open questions for founder ratification

1. **Inventory order** — which professions first? (Proposed: the three deepest
   corpora — data-architect, operations, software-engineer — where the corpus can
   actually ground the axis selection.)
2. **Does `dimensionSourcing` live on the axis (one class per axis) or on the
   (principle × axis) edge?** An axis could be `basic` in one profession and
   `corpus-derived` in another. One-class-per-axis is simpler and matches the
   current registry; per-edge is more expressive but heavier. (Proposed:
   per-axis to start; revisit only if a real conflict appears.)
3. **The `external` pilot correlate** — confirm `rental-peak-season`, or let the
   rental inventory choose it.
4. **§9.4 naming** — how far `schema-honesty` constrains `external`-class naming
   before it ships (deferred from the JSI spec; now scoped by Risk §6).
