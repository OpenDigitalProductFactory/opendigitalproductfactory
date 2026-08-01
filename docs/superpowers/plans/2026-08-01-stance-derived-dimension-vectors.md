---
title: Stance-Derived Dimension Vectors — implementation plan
authoredAt: 2026-08-01
authoredBy: mark-bodman
backlogItem: BI-E1427A3E
epic: EP-DECISION-TIER-REBALANCE
design: docs/superpowers/specs/2026-07-31-stance-derived-dimension-vectors-design.md
---

# Stance-Derived Dimension Vectors — implementation plan

Design: [2026-07-31-stance-derived-dimension-vectors-design.md](../specs/2026-07-31-stance-derived-dimension-vectors-design.md)
(merged as #3845). This plan sequences the build and records what each phase may
NOT do, because the risk here is not difficulty — it is a mapping that silently
starts moving real decisions before anyone has reviewed the edges.

## Kernel rulings that fix the contract

Two of the design's §10 questions were put through `principle_decide` before any
code, per `consult-the-governed-scopes-before-asking-a-human`. Both returned
**high confidence with no commandment conflict**, and both confirmed the design's
proposed default:

| Question | Ruling | Interaction | Margin |
|---|---|---|---|
| §10 Q3 — may a commercial `quality-bar` stance derive `public_safety`? | **`never-derive-safety`** | `DI-A01830820221` | 2.65 |
| §10 Q1 — may a `ruled` stance reach commandment magnitude in its own class? | **`cap-below-doctrine`** | `DI-687A1094E253` | 6.52 |

Both are now encoded as enforced constants rather than prose:
`STANCE_FORBIDDEN_DIMENSIONS` and `STANCE_MAX_MAGNITUDE`.

Still open, and NOT blocking Phase 0: **Q2** (does `ceilingUsd` scale magnitude
at all, or only gate autonomy?) gates Phase 1, and **Q4** (BI-DF87F8D2's fate)
gates Phase 4. Both want founder input rather than a kernel score, because they
are investment calls rather than principle conflicts.

## Phase 0 — the map (this PR)

**Ships:** `apps/web/lib/decision-perspective/stance-dimension-map.ts` — the
platform-owned map, 17 edges across the five stances, each with a signed weight
and a rationale traceable to the stance defaults' own wording; plus
`findStanceDimensionMapViolations()` and its guard test.

**Deliberately does NOT ship:** any derivation, any write to
`principleDimensionVector`, any change to scoring. Nothing about a live decision
changes in this PR. The map is inert until Phase 2.

**Enforcement landed here:**
- `satisfies Record<StanceVectorKey, …>` — an unmapped stance is a compile error.
- Cost axes must carry negative weights (the `never-wipe-db` inversion class).
- `|weight| <= STANCE_MAX_MAGNITUDE` (0.4, the core-tier default) — org stance
  is never doctrine-tier.
- `public_safety` is refused outright, including on `quality-bar` where several
  archetype defaults do name safety — the tempting case the kernel refused.
- Every edge needs a reviewable rationale.
- The violation checker is itself tested against synthetic bad edges: a guard
  that cannot fail is not a guard.

**Exit criteria:** guard test green; typecheck clean; no behaviour change
observable anywhere in the portal.

## Phase 1 — calibrate the magnitude curve

Resolve §10 Q2 first. If `ceilingUsd` scales magnitude, fix the curve, base,
floor and cap against the archetype default ratio (design §4.2) — sublinear and
clamped, so an extreme owner entry cannot dominate the ledger. Extend
`stance-onboarding.simulation.test.ts` to prove no decision class drops below its
recommend band once derived vectors join the mean.

**Still no writes.** Calibration is a simulation exercise.

## Phase 2 — wire derivation

Derive on confirmation only (`stance-confirm.ts`), writing
`principleDimensionVector` + a generated `principleWeightRationale` to the org's
stance page. `principleTier` stays unset — a stance is not a kernel principle.
Backfill existing confirmed stances. Honour `professionLocal` on the
`capacity_utilization` edge, and the `STANCE_VECTOR_BUNDLES` class scoping, so a
stance cannot reach decisions it does not own.

**Exit criteria (the falsifiable ones from design §9):** `cost_efficiency` —
scored by ZERO principles at today's baseline — is measurably scored afterwards,
and at least one option ranking demonstrably changes versus the semantic-only
path. If neither moves, the work was decorative and should be reverted rather
than shipped.

## Phase 3 — show the owner

Surface which decision factors their stance moved, on
`/coworker-decisions/stance`. Not cosmetic: the platform's stated differentiator
is the inspectable contribution ledger, and a derived weight the owner cannot see
is exactly the opaque scoring this architecture exists to avoid. Needs a UX-fit
review.

## Phase 4 — resolve the DF87F8D2 overlap

Decide explicitly whether pairwise elicitation becomes a refinement step or is
closed as superseded (design §7). Founder ratification.

## Risks

- **The map starts scoring before review.** Mitigated structurally: Phase 0
  writes nothing, and derivation is a separate phase behind a simulation gate.
- **Sign inversion.** Three edges are negative-by-design; the guard covers the
  map now and must cover derived vectors at write time in Phase 2.
- **Scope leak.** A stance must never weight WWMD doctrine or WSID craft floors.
  `professionLocal` and the bundle binding are declared in Phase 0 so Phase 2 has
  something to honour rather than infer.
- **Rank-deficiency relocation.** If every derived edge lands on
  `long_term_maintainability` (already loaded by 68% of principles) we deepen the
  concentration instead of fixing it. The map spreads deliberately across
  `cost_efficiency`, `governance_compliance`, `reversibility`,
  `legibility_of_consequence`, and `evidence_density`.
