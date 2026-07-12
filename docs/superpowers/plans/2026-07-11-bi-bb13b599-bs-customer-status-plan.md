# Implementation Plan — BI-BB13B599: Build Studio customer-mode status from the capsule projection

**BI:** BI-BB13B599 (epic EP-WORK-CONVERGENCE) · **Date:** 2026-07-11 · **Status:** Pure projection slice implemented; render wiring deferred (live-portal).

## Gap
Build Studio's bands read `FeatureBuild.phase` directly (`BuildStudio.tsx`) and are blind to the WorkCapsule projection, so external Claude/Codex/Grok progress carried on the capsule is invisible in customer mode.

## This slice (pure, unit-testable)
- `apps/web/lib/build/customer-status-projection.ts` — `projectBuildStudioCustomerStatus({ build, capsule })` returns a business-safe `{ whatIsBeingBuilt, lifecyclePosition, worker, needsYou }`. Reuses `projectWorkCaseState` (does not re-implement the status map); combines with `build.phase`; falls back to a phase-only plain status when no capsule is linked.
- **Business-safe by construction:** the executor is NOT in the signature, and `worker` labels never name Claude/Codex/Grok/opencode — a unit test asserts the output never matches `/claude|codex|grok|opencode/i`.

## Verification
- 7 unit tests (capsule status → plain state/needsYou; phase-only fallback; failed→needs-you; business-safety guard). Typecheck clean (0 errors post-typegen). No DB, no React.

## Deferred (needs live-portal verification, per operator — validate at epic completion)
- The server-side fetch `workCapsule.findFirst({ where: { featureBuildId: build.id } })` (join precedent: `evidence-timeline.ts:168`).
- Rendering the customer status in `BuildStudio.tsx` (band/rail).
