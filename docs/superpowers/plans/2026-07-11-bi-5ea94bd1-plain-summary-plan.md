# Implementation Plan — BI-5EA94BD1: Build Studio IA reframe (plain layer default)

**BI:** BI-5EA94BD1 (epic EP-WORK-CONVERGENCE) · **Date:** 2026-07-11 (render delivered 2026-07-12) · **Status:** DELIVERED — pure core (#2859) + drawer render swap (this PR). The IA default-flip (plain bands default, engineer content behind `engineerView`) shipped in an earlier merged PR; the remaining slice was the drawer `<pre>` swap.

## Gap
Build Studio still shows `diffSummary` (= `fullDiff.slice(0, 500)`) in a `<pre>` labeled as a summary — a truncated raw patch mislabeled as plain language (Spec 4 §3, "worse than nothing"). And the plain overseer band layer is not yet the default first-viewport.

## This slice (pure, unit-testable)
- `apps/web/lib/build/customer-change-summary.ts` — `customerChangeSummaryText(build)` composes the customer-facing "what changed" from the plain `changeNarrative` (headline + whyItMatters) and, **by construction, cannot leak the raw diff**: `diffSummary` is absent from the input signature (a `@ts-expect-error` test asserts it). Returns null when there is no narrative, so the plain layer shows "no plain summary yet" instead of a misleading diff slice.

## Verification
- 4 unit tests (compose headline+why; headline-only; null when no narrative; diff cannot leak). Typecheck clean.

## Render slice (delivered 2026-07-12)
- The plain overseer band layer is already the default first-viewport with the engineer-grade graph / assurance / agent-activity demoted behind the `engineerView` toggle — shipped in an earlier merged PR (verified present at `BuildStudio.tsx`).
- **This PR:** replaced the in-drawer `diffSummary` `<pre>` with `customerChangeSummaryText`. `FeatureBriefPanel` now takes `changeNarrative` (threaded from BuildStudio's already-loaded narrative state through `buildDetailsDrawerSections`) instead of `diffSummary`; the review/ship/complete "Build Summary" renders the plain narrative as prose, or "No plain summary yet." when there is none — never the truncated patch. The `diffSummary` prop is removed from the panel entirely (the fake-summary feed is gone by construction).

## Verification
- 7 `FeatureBriefPanel` render tests (jsdom) incl. two new for the plain Build Summary (narrative present → plain prose; narrative null → "No plain summary yet."); 4 core tests; `BuildStudioDetailsDrawer` 9 tests green. `apps/web` typecheck clean post-typegen; module-size clean.
- Live sanity on the Contributor preview (:3001): the Details drawer + Brief/Design Doc section render without error under the new prop threading. The exact review-phase Build Summary text could not be driven because no build is currently in review/ship/complete in the live DB (data limitation, not a code gap) — the jsdom test mounts the real panel at `phase="review"` and asserts the plain text + absence of any raw diff.
