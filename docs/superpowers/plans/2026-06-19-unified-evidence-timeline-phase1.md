# Plan — Unified Evidence Timeline (EP-UNIFIED-TRACKING Phase 1 / BI-C25374E4)

- **Date:** 2026-06-19
- **Epic:** EP-UNIFIED-TRACKING
- **Item:** BI-C25374E4
- **Design spec:** [`2026-06-19-unified-build-studio-tracking-all-surfaces-design.md`](../specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md) §6.1 / §9.3

## Goal

Make **real cross-surface development evidence** visible on the Build Studio evidence timeline, replacing the lane that was **faked** from `FeatureBuild.codingProvider` (the engine Build Studio ran inside its own sandbox — not an external agent). Read-only: no write-model change (Phase 2 / BI-6357B975 populates the links this projection reads).

## Approach (Option C as the read-only subset of the spec's Option A)

Anchor a server-side projection on the build, merge the real records that are keyed to it, and thread the result to the existing `UnifiedEvidenceTimeline` component through the already-wired `progressVisibility` prop.

Three real sources merged (newest first):
- `ExternalEvidenceRecord` — keyed by the **FB- buildId** (`record_external_development_evidence`).
- `RuntimeVerification` — keyed by **`FeatureBuild.id`** (cuid).
- `WorkCapsuleActivity` (`kind="evidence-recorded"`) — via the build's linked `WorkCapsule` (`featureBuildId` = cuid; `record_capsule_evidence`).

The two id spaces matter: external evidence uses the FB- id, runtime/capsule use the cuid.

## File map

| File | Change |
| --- | --- |
| `apps/web/lib/build/evidence-timeline-types.ts` | NEW — canonical `UnifiedEvidenceTimelineEvent` type, in lib so server code can produce events without importing a `"use client"` module. |
| `apps/web/lib/build/evidence-timeline.ts` | NEW — pure `mapBuildEvidenceTimelineEvents` (the unit-tested core) + `loadBuildEvidenceTimelineEvents` (thin fetch over a structural `EvidenceTimelineDb`, satisfied by real prisma à la `CapsuleDb`). |
| `apps/web/lib/build/evidence-timeline.test.ts` | NEW — unit tests for the mapper (mapping, status normalization, provider labels, newest-first merge) + loader (id-space routing, no-capsule path). |
| `apps/web/lib/build/progress-visibility.ts` | EDIT — add `evidenceTimeline` to `BuildProgressVisibility`; select `id`; call the loader; thread through `buildProgressProjectionFromParts`. |
| `apps/web/components/build/UnifiedEvidenceTimeline.tsx` | EDIT — re-export the type from its new lib home (back-compat for existing importers). |
| `apps/web/components/build/WorkflowStageInspector.tsx` | EDIT — append `progressVisibility.evidenceTimeline` to the timeline; **de-fake** the implementation-tasks lane (label as Build Studio's engine, not "external"). |
| `apps/web/components/build/WorkflowStageInspector.test.tsx` | EDIT — assert real external + runtime events render. |

## Verification

- **CI unit gate:** `evidence-timeline.test.ts` (projection logic) + the extended `WorkflowStageInspector.test.tsx` (jsdom render of the real events). This cycle the root toolchain is degraded (`.pnpm` empty → no local `vitest`/`tsc`), so the gate runs in CI; the pure mapper + structural-db loader are designed to be fully exercised there.
- **Live UX verification — PENDING.** Driving `/build` on a live install to see real external-agent evidence render is deferred (no live-portal access + degraded toolchain this session). The logic is unit-tested at every layer; the final live render should be confirmed before marking BI-C25374E4 done.

## Out of scope (follow-on)

- `PhaseHandoff` + `BuildArtifactRevision` lanes (internal provenance; lower-value than the external-origin sources) — deferred within the BI.
- The phase gate: evidence shows only in runtime phases (`build`/`review`/`ship`), matching existing behavior.
- Populating `ExternalEvidenceRecord.workCapsuleId`/`buildId` at write time — that is Phase 2 (BI-6357B975); until then the external lane is sparse but correct.
