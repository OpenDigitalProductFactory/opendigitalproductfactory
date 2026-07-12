# Implementation Plan — BI-BB13B599: Build Studio customer-mode status from the capsule projection

**BI:** BI-BB13B599 (epic EP-WORK-CONVERGENCE) · **Date:** 2026-07-11 (render delivered 2026-07-12) · **Status:** DELIVERED — pure projection slice (#2857) + render wiring (this PR).

## Gap
Build Studio's bands read `FeatureBuild.phase` directly (`BuildStudio.tsx`) and are blind to the WorkCapsule projection, so external Claude/Codex/Grok progress carried on the capsule is invisible in customer mode.

## This slice (pure, unit-testable)
- `apps/web/lib/build/customer-status-projection.ts` — `projectBuildStudioCustomerStatus({ build, capsule })` returns a business-safe `{ whatIsBeingBuilt, lifecyclePosition, worker, needsYou }`. Reuses `projectWorkCaseState` (does not re-implement the status map); combines with `build.phase`; falls back to a phase-only plain status when no capsule is linked.
- **Business-safe by construction:** the executor is NOT in the signature, and `worker` labels never name Claude/Codex/Grok/opencode — a unit test asserts the output never matches `/claude|codex|grok|opencode/i`.

## Verification
- 7 unit tests (capsule status → plain state/needsYou; phase-only fallback; failed→needs-you; business-safety guard). Typecheck clean (0 errors post-typegen). No DB, no React.

## Render slice (delivered 2026-07-12)
- `apps/web/lib/build/customer-status-loader.ts` — `loadBuildStudioCustomerStatuses(db, builds)` fetches every linked capsule in one `workCapsule.findMany({ where: { featureBuildId: { in } }})` (the capsule is attached to every build via `attachBuildStudioWorkCapsule`, `build.ts:112`) and projects each build into its plain status, keyed by the build's cuid `id`. Server-side so the projection never enters the client bundle. 5 unit tests (capsule path, phase-only fallback, empty, dedupe, needsYou-from-blocked).
- `apps/web/components/build/BuildCustomerStatusBand.tsx` — the plain first-viewport band: lifecycle line + business-safe worker phrasing + a "Needs you" pill. Always visible (not behind engineer view). 3 render tests (renderToStaticMarkup; needs-you pill conditional; no executor-name leak).
- `app/(shell)/build/page.tsx` — computes `customerStatuses` server-side and passes it to `<BuildStudio>`; `BuildStudio.tsx` renders `<BuildCustomerStatusBand>` for the active build right below the header.

## Verification
- Pure/loader/band: 15 unit tests total across projection + loader + band. `apps/web` typecheck clean (0 errors post-typegen). Live-validated on the Contributor preview (:3001): the customer status band renders the plain lifecycle line + business-safe worker phrasing for the active build, with no executor name or raw phase leaking.
