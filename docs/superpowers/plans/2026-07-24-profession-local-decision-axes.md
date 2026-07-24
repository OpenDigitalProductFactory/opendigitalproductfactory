# Profession-Local Decision Axes

- **Date:** 2026-07-24
- **Backlog:** `BI-106C2585`
- **Epic:** `EP-DECISION-TIER-REBALANCE`
- **Spec:** [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](../specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md) §2.2
- **Depends on:** `BI-AA7D80FE` (spine labelled; `projectVectorOntoSpine` shipped) — done. `BI-5FE47130` (professions own their content) — in progress.

## Problem

`PRINCIPLE_DIMENSIONS` is a closed `as const` registry and every tier scores into that one flat space. A profession-specific trade-off has nowhere to land, so it is crushed into the nearest generic axis — a UX judgment about typographic hierarchy vs information density becomes `human_cognitive_load` and is thereby indistinguishable from a build-queue latency concern. That flattening is a mechanism behind ambiguous vectors that cannot discern multiple trade-offs.

The answer is not to widen the shared space — that re-inflates exactly what spine reduction shrank. It is to let a profession declare axes **inside its own corpus**, scored at full resolution there and projected onto the spine when the decision leaves the profession.

## Three rules (from the spec)

1. **Typed** — `benefit` or `cost`, with a `highMeans` statement, matching `DimensionGuidance`.
2. **Projected** — every local axis declares a weight onto ≥1 spine axis. Full resolution inside the profession; rolls up when the decision leaves it. This is what preserves cross-profession commensurability.
3. **Sourced** — inherits the WSID provenance invariant: a local axis without a cited source cannot publish.

The projection and integrity machinery already exists from BI-AA7D80FE: `projectVectorOntoSpine`, `assertDimensionScopeIntegrity`, the `projectsOnto`-must-terminate-on-spine rule. This work adds the *profession-owned* registry that reuses it.

## Phases

### Phase 1 — the registry (substrate only, no retrieval change)

`packages/db/src/profession-local-axes.ts`:

- `ProfessionLocalAxis` — `{ profession, key, kind, highMeans, projectsOnto, source }`.
- Keys are **namespaced** `<profession>/<axis>` so a local axis can never collide with a spine axis or another profession's axis, and so a bare feature key is unambiguously spine.
- `PROFESSION_LOCAL_AXES` — an array (not an `as const` map, because keys are namespaced strings, not the closed `PrincipleDimension` union).
- `assertProfessionLocalAxisIntegrity(knownProfessions)` — every axis: real `professionKey`; `kind` set; non-empty `highMeans`; `projectsOnto` non-empty and every target a **spine** axis (reuses `isSpineDimension`); non-empty `source`. Namespaced key matches `<profession>/`.
- `projectLocalAxisVector(profession, vector)` — extends `projectVectorOntoSpine` so a vector mixing spine axes and this profession's local axes rolls up correctly, splitting weight across targets (no amplification), sign preserved.

Ships with the registry **empty** plus one worked example in a test, same discipline as the slug-migration list: machinery lands proven, the first real axis lands with the profession that needs it.

Enforcement mirrors the spine: an integrity test runs `assert…` against the real registry, and pins the no-amplification and sign-preservation properties.

### Phase 2 — thread the caller's profession into `principle_decide` (retrieval path)

`resolve-profession-profile.ts` already resolves a profession from an agent identity, but `principle-decide-pack.ts` does not call it. Add a resolved `profession` to the decision context so the scorer knows which local axes are in scope. Live-verify: a profession caller's local axes appear as valid feature keys; a cross-profession caller's do not.

### Phase 3 — validation + scoring wiring

- `validateOptionFeatures` accepts a namespaced local axis **only** when the caller is in that profession; otherwise it is `unknown-dimension`, exactly as today.
- In-profession, the local axis scores at full resolution. On roll-up (the decision is consumed outside the profession, or a cross-profession ledger is assembled), `projectLocalAxisVector` maps it to the spine.
- The dimension catalogue surface (`buildFeaturesDescription`) gains the in-scope profession's local axes when a profession is resolved.

## Spec relaxation to record

The founder-kernel evolution discipline (`2026-05-24`) requires an orthogonality argument plus ≥2 principles for a new **spine** axis. Profession-local axes take a lighter path — provenance and a declared projection, not the full argument. That relaxation is deliberate; §2.2 already states it, and the evolution-discipline spec should carry a banner pointing at it.

## Acceptance

A profession declares a local axis end-to-end — typed, sourced, projected, scored at full resolution within the profession, correctly rolled up when the decision crosses professions; an unsourced or unprojected axis fails to publish (integrity assertion + provenance gate).
