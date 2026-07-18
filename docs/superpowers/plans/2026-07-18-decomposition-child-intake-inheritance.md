# Decomposition children must inherit intake from their parent

**BI:** BI-FF8ABFCB (surfaced babysitting the BI-C4F828B7 auto-decompose wave)
**Status:** implemented
**Date:** 2026-07-18

## Problem

`approveDecomposition` (`apps/web/lib/build/approve-decomposition.ts`) creates child
FeatureBuilds directly in `phase="plan"` with the parent's `designDoc`/`designReview`
copied, but **never sets `plan.happyPathState.intake`**. The plan→build gate
(`checkPhaseGate` → `isHappyPathIntakeReady`) requires `taxonomyNodeId` +
`backlogItemId` + `epicId` + `constrainedGoal` — all null on children — so every
child hard-blocks with *"Intake is incomplete"* and the resume reconciler
re-dispatches it forever, burning plan-generation spend.

Children skip the ideate `reviewDesignDoc` step that normally auto-populates intake,
so nothing ever fills it in. Pre-existing defect (operator-driven `approve_decomposition`
hits it too); the BI-C4F828B7 autopilot auto-decompose fired it at scale — **86/86
children of the drain wave had `intake = null`**, all stuck churning in `plan`.

## Fix (fix-forward + self-heal)

New module `apps/web/lib/build/decomposition-child-intake.ts`:

- `buildDecompositionChildIntakePatch({ parentIntake, epicSemanticId, childTitle,
  childOriginatingBacklogItemId, childBuildId })` — pure derivation:
  - `epicId` = the child's own decomposition Epic (its `parentEpicId`).
  - `backlogItemId` / `taxonomyNodeId` inherit from the parent; taxonomy falls back
    to the provenance anchor (`triaged-bi:<id>` / `adhoc-build:<id>`), so the result
    always satisfies `isHappyPathIntakeReady`.
  - `constrainedGoal` = the child scope title (each child is a distinct slice).
- `healDecompositionChildIntake({ child, db? })` — DB self-heal: for a `plan`-phase
  child with incomplete intake, derive it from the **superseded parent build**
  (`supersededByEpicId = child.parentEpicId`) + the Epic's semantic id, and persist.
  Idempotent.

Wiring:
1. **Fix-forward** — `approveDecomposition` computes `parentIntake` once and sets each
   child's `plan` via `applyChildIntakeToPlan(null, buildDecompositionChildIntakePatch(...))`
   at creation time.
2. **Self-heal** — `resume-pre-build-phase.ts`, at the top of the `phase === "plan"`
   branch, calls `healDecompositionChildIntake` for any child (`parentEpicId != null`)
   before doing plan work, so the builds created **before** this fix (the 86 stuck
   wave children) unblock on their next resume tick after deploy. Non-fatal on error
   (falls through to the normal resume path).

## Verification

- `apps/web/lib/build/decomposition-child-intake.test.ts` — 6 tests (inheritance,
  gate-readiness, taxonomy/backlog fallbacks, self-heal write, self-heal no-op).
- Existing `approve-decomposition` + `resume-pre-build-phase` suites pass (50 total),
  no regression.
- Full-workspace `tsc --noEmit` clean.

Live: expected to drain the 86 stuck children (intake backfilled on resume → plan
gate clears → advance to build) once deployed.
