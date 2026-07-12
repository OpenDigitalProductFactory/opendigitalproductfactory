# Implementation Plan — BI-5EA94BD1: Build Studio IA reframe (plain layer default)

**BI:** BI-5EA94BD1 (epic EP-WORK-CONVERGENCE) · **Date:** 2026-07-11 · **Status:** "Kill the fake summary" pure core implemented; IA default-flip deferred (live-portal).

## Gap
Build Studio still shows `diffSummary` (= `fullDiff.slice(0, 500)`) in a `<pre>` labeled as a summary — a truncated raw patch mislabeled as plain language (Spec 4 §3, "worse than nothing"). And the plain overseer band layer is not yet the default first-viewport.

## This slice (pure, unit-testable)
- `apps/web/lib/build/customer-change-summary.ts` — `customerChangeSummaryText(build)` composes the customer-facing "what changed" from the plain `changeNarrative` (headline + whyItMatters) and, **by construction, cannot leak the raw diff**: `diffSummary` is absent from the input signature (a `@ts-expect-error` test asserts it). Returns null when there is no narrative, so the plain layer shows "no plain summary yet" instead of a misleading diff slice.

## Verification
- 4 unit tests (compose headline+why; headline-only; null when no narrative; diff cannot leak). Typecheck clean.

## Deferred (needs live-portal verification, per operator — validate at epic completion)
- Make the plain overseer band layer the DEFAULT first-viewport; demote ProcessGraph / raw diff / taskResults / buildExecState behind the single `engineerView` toggle (`BuildStudio.tsx:196`).
- Replace the in-drawer `diffSummary` `<pre>` render with `customerChangeSummaryText` in the plain view.
