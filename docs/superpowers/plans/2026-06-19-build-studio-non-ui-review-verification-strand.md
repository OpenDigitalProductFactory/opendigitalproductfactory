# Build Studio: non-UI builds strand at review-phase UX verification

- **Date:** 2026-06-19
- **Status:** implementing
- **Backlog item:** BI-2F10D6D3
- **Epic:** EP-BUILD-STUDIO
- **Related:** BI-4890FDC3 (out-of-scope test scoping — already landed via `scopeVerificationOutputForGate`), BI-17377D05 / BI-9257CF19 (stranded-build resume), the ratified 2026-06-07 "UX verification is advisory" gate decision (`build-process-matrix.ts` `uxVerification-not-blocking`).

## Problem

Every in-flight Build Studio build was stranding before delivery. Live evidence (2026-06-19): of 12 builds, **0 had delivered**; FB-FD850A2C ("Add truncateMiddle string helper with unit tests") looped `review-verification → "UX verification failed: 0/1 passed"` on **every portal boot since 2026-06-15**.

Root cause — a contradiction between the gate policy and the auto-ship trigger:

1. `build-review-verification.ts` runs **browser-use UX tests** by navigating the sandbox preview and checking the build's **acceptance criteria**. That only works when the build changed a **rendered UI surface** (a page, layout, or React component).
2. For a pure **library / backend / doc** build (e.g. `truncateMiddle`, a string helper), the acceptance criteria are **code-level assertions** ("`truncateMiddle('abc',1)` returns `'…'`") with **no page to drive**. browser-use returns a vacuous `0/1` failure.
3. The review→ship gate already treats UX verification as **advisory / non-blocking** (`uxVerification-not-blocking`, ratified 2026-06-07) — only the transient `running` state defers.
4. **But** the auto-ship trigger in `build-review-verification.ts` only fired on `finalStatus === "complete"`. A `failed` (false negative) or `skipped` verification never dispatched ship, so the build sat in `review`, and `resumeStrandedBuildsOnBoot` just re-queued the same failing browser-use run forever.

The unit-test gate is **not** the blocker: `checkRequirement("verification-typecheck-passed")` gates build→review on **typecheck only**, and `scopeVerificationOutputForGate` already neutralizes out-of-scope test noise (BI-4890FDC3). The 88 "failed" tests shown in the panel are cosmetic global-health signal.

## Fix

Two coordinated, surgical changes — keep the browser UX check where it is meaningful, stop stranding where it is not.

1. **Skip browser UX verification for builds with no UI surface.** New helper `apps/web/lib/build/ui-surface.ts`:
   - `buildHasUiSurface(changedFiles)` — true when any changed file is `.tsx`/`.jsx`.
   - `shouldRunBrowserUxVerification({ testCaseCount, changedFiles })` — false when there are no acceptance criteria **or** the (known, non-empty) change set has no UI surface; conservatively true when the change set is unknown (a briefly-unavailable diff projection must not disable UX verification fleet-wide).
   - Changed files are resolved from the build's captured diff (`getSandboxStateForBuild` → `sourceDiffstat`), falling back to the plan's declared files (`expectedPlanFiles`) when the diff isn't populated yet at review time. This is branch-scoped, so it is correct despite shared-sandbox branch contention.

2. **Auto-dispatch ship on `skipped`, not only `complete`.** When UX verification is skipped (no AC or no UI surface), `build-review-verification.ts` now marks `uxVerificationStatus = "skipped"`, logs a clear `BuildActivity`, and calls `autoDispatchShipForCompletedVerification(buildId, "skipped")`. `dispatchShipForVerifiedBuild` already accepts `"skipped"`. This mirrors the `complete` path so non-UI builds advance to the `ship` phase instead of looping.

`failed` (a genuine UI build whose UX check failed) is intentionally left non-auto-shipping — the operator inspects a real UI regression. Only the **false** failure (non-UI build) is converted to `skipped` and advanced.

**Safety:** auto-ship only runs `deploy_feature` (extract diff, impact analysis, advance phase to `ship`). Pushing to GitHub remains the human "Ship to GitHub" gate, so no outward action is automated by this change.

## Verification

- Unit: `apps/web/lib/build/ui-surface.test.ts` (predicate matrix incl. the truncateMiddle change set) and `build-review-verification.test.ts` (auto-ship forwards `"skipped"`, defaults to `"complete"`).
- Typecheck: `pnpm --filter web typecheck`.
- Functional: on the live install, the stranded library builds (FB-FD850A2C truncateMiddle, FB-69231490 classifySemanticId, etc.) reach `ship` (diff extracted, awaiting "Ship to GitHub") after the next review-verification run, instead of looping `0/1`.

## Follow-up (landed same day): progress/resume layer must also honor scoped verification

Deploying the fix above (live on the install via self-upgrade) proved the strand is broken — `review-verification` now logs `"UX verification skipped: build changed no UI surface… advancing to ship"`. But the stranded library builds still didn't reach a ship action, because the **progress/action layer** keyed off the **raw** verification, not the scoped result:

- `getImplementationConcernState` (`build-studio-workflow-actions.ts`) set `hasRecoverableConcern = nonCleanTasks.length > 0 || verificationFailed`, where `verificationFailed` was true whenever `verificationOut.failureAxis === "test-failure"` — i.e. the 88 out-of-scope global failures forced the operator action to "Resume Implementation" even though typecheck passed and `buildScoped.affectedTests === []`. (The scoped gate `checkPhaseGate` already treats test failures as advisory; the action layer did not.)
- The skip path left a **stale failed `uxTestResults`** array on builds that had previously run browser-use, so `hasCompletedUxVerification` returned false and the build couldn't reach the "Record Acceptance" step.

Fix (second change set, same root):
1. `getImplementationConcernState` now computes `scopedSurfaceClean` from `progressVisibility.verification.buildScoped` (typecheck passed + `affectedTests` empty). When clean, out-of-scope/global test failures are advisory: `verificationFailed` ignores a `test-failure` axis, and a task that merely `DONE_WITH_CONCERNS` no longer counts as a recoverable concern. Without a scoped projection the stricter legacy behavior is preserved; an in-scope failure (`affectedTests` non-empty) or a typecheck failure still blocks.
2. `build-review-verification.ts` skip path clears `uxTestResults` to `[]` alongside `uxVerificationStatus = "skipped"`.

With both, a non-UI build flows review → (concern clear) → Record Acceptance → Continue to Release → ship, driven from the BS UX. Tests: `build-studio-workflow-actions.test.ts` (scoped-clean advances; in-scope failure still resumes).

Note: builds that already had `deploy_feature` extract a `diffPatch` before this landed (e.g. FB-FD850A2C) hit the auto-ship idempotency guard ("diff already extracted") and need the operator to drive the ship step; fresh builds flow cleanly.

## Out of scope (follow-ups)

- Local endpoint throughput / model-swap thrash (gemma4 ↔ qwen3-coder) causing 502s on routed phases — separate config/infra work (largely mitigated: the boot-time 502 storm was stranded builds re-running review-verification, which this strand fix removes).
- Quality of the browser-use agent on genuine UI builds (BI-4BD81F3B).
- Shared-sandbox branch contention + cross-build untracked-file contamination across concurrent builds.
