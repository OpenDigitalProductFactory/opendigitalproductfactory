# Autopilot auto-resolution of the ideate decompose-required gate

**BI:** BI-C4F828B7 (sibling / upstream source of BI-A009313E / PR #3196)
**Status:** implemented
**Date:** 2026-07-17

## Problem — a self-perpetuating loop

The daily governed-backlog tee-up (`0 14 * * *`, cap 3/day —
`apps/web/lib/queue/functions/governed-backlog-tee-up.ts`) auto-promotes
backlog items into `FeatureBuild`s and fires Ideate hands-off
(`dispatchApprovedIdeateBuilds`). Ideate produces a design, the design review
passes, and the deterministic design-time size assessment
(`apps/web/lib/build/size-design-doc.ts`) runs. When it returns
`decompose-required` (models ≥ 5, ACs ≥ 20, routes ≥ 4, endpoints ≥ 7, or
multipliers ≥ 4), the Phase-4b gate in `reviewDesignDoc`
(`apps/web/lib/mcp-tools.ts`) **blocks the advance** and waits for an operator to
call `approve_decomposition` or `record_decomposition_override`.

On an unattended install (the founder's localhost) nobody clicks, so the build
parks in `ideate` forever and is eventually reaped to `abandoned` (PR #3196's 7d
`createdAt` age-out — the downstream cap). Meanwhile the tee-up keeps minting
more. Evidence on the founder install (2026-07-17):

- Of builds that reached a design review, **decompose-required = 158** (133
  already abandoned, 23 currently parked in `ideate`) vs `ok`=44,
  `decompose-recommended`=41 — ~65% of auto-promotions are dead-on-arrival.
- 234 builds in `abandoned` from 165 distinct BIs (55 BIs promoted 2–4×).
- Eligible pool = 186 BIs → the batch never drains → 3 dead builds/day forever.

The coarse eligibility gate (`effortSize ∈ {small,medium,large}`) can't prevent
this: the design size isn't knowable until Ideate has produced a design, and a
human-sized "large" BI routinely yields an xlarge design.

## Decision

Operator chose **auto-decompose in the batch** (relentless-automation directive).
Under governed-backlog autopilot the operator has already confirmed intent
(triage=build → promote → auto-approve-start). The decomposition click is the
only thing between a passed design and forward progress, so we resolve it
autonomously instead of parking.

## Design

New module `apps/web/lib/build/auto-resolve-decompose-gate.ts` —
`autoResolveDecomposeRequiredGate(input)` — orchestrates the three existing
server-side primitives (`proposeDecomposition`, `approveDecomposition`,
`recordDecompositionOverride`), all dependency-injected for unit testing.

Resolution logic (never parks an eligible autopilot build):

1. **Not autopilot** (`!governedBacklogEnabled` OR no `originatingBacklogItemId`)
   → `park`. Operator-driven / non-governed builds keep the existing
   wait-for-operator gate unchanged.
2. **Decomposed child** (`parentEpicId != null`) → auto-`override` (monolithic).
   Recursion terminator — a child can never be re-decomposed
   (`assertNoRecursiveDecomposition`). Defensive: children are created in
   `plan`, so they don't normally reach this gate.
3. **Top-level autopilot build** → auto-decompose:
   - Ensure candidates exist; generate via `proposeDecomposition` if the
     designReview has none persisted.
   - Approve the **top** candidate via `approveDecomposition` → supersedes the
     parent into an Epic + child builds (created in `plan`, driven by the
     existing continuous resume reconciler in `instrumentation.ts`).
   - If candidates can't be generated OR approval fails → fall back to
     auto-`override` (monolithic) so the build ships as one rather than rotting.
   - If even the override write fails → `park` (never silently advance).

### Wiring

`reviewDesignDoc` (`apps/web/lib/mcp-tools.ts`) at the `decompose-required &&
!hasOverride` branch now calls the orchestrator (with `parentEpicId` added to the
build select):

- `decomposed` → return a non-blocked "auto-decomposed into N children" result.
- `park` → original blocked `decompose_or_override` response (unchanged).
- `overridden` → the monolithic override is recorded in the DB; fall through to
  the normal phase-advance logic.

## Why not the alternatives

- **Backpressure / human-queue** (park but bounded, or route to a decision
  surface): valid and safer, but the operator explicitly chose to keep the
  pipeline flowing autonomously.
- **Predict size pre-promotion**: impossible — the design that drives the size
  assessment doesn't exist until Ideate runs.

## Bounding / safety

- Recursion is impossible: children are `plan`-phase and `parentEpicId != null`;
  `approveDecomposition` and the invariants reject re-decomposition.
- WIP throughput: ≤3 parents/day × 2–4 children is bounded and reap-protected
  (`inert-build-reaper.ts`, WIP cap).
- The size gate is advisory in spirit (`decompose-recommended` builds already
  proceed); a monolithic override on fallback is acceptable and audited via a
  `BuildActivity` row.

## Verification

- `apps/web/lib/build/auto-resolve-decompose-gate.test.ts` — 8 tests (park,
  approve-with-existing-candidates, generate-then-approve, override fallbacks,
  child override, override-write-fails → park). All pass.
- Full decomposition suite (approve / propose / override) — 52 tests pass, no
  regression.
- `tsc --noEmit` on `apps/web` — clean.
