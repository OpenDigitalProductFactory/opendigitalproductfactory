---
status: active
date: 2026-10-12
backlog: BI-449F5F0F
---

# Truthful runtime-health availability

## Grounding and scope

The existing routing explainability design, `docs/superpowers/specs/2026-07-26-ai-routing-architecture-explainability-design.md` §2–3, requires observed routing and exclusions to be understandable. Reuse its existing projection, not another health engine. The actual source is `apps/web/lib/inference/phase-model-resolution.ts`; the served projection is `apps/web/app/(shell)/platform/ai/runtime-health/page.tsx`.

On DEV recovery.4, only two of five phases resolve, while the banner says all phases route to cloud. Three phases fail because completion capacity is unknown. Capability authority is unavailable and all 130 coworkers are blocked. These are observed states, not proof that installed models cannot infer.

The page repair computes availability from existing `PhaseResolution.isLocal` values, where null means unresolved. A local/cloud verdict describes resolved locations and cannot establish availability. Derive one banner presentation once and reuse its title, summary and tone throughout the existing banner. Keep its landmark shape, controls and frozen arrival word budget. Shorten surrounding copy to compensate for accurate counts. New copy lives in the existing `admin` message namespace (`packages/i18n/src/messages/en-US/admin.json`), loaded with the shared server translator alongside health reads; existing legacy copy is unchanged.

No persistence, authority, routing eligibility, model-capacity assumption, provider activation, inference probe, migration, or runtime deployment is part of this page change. Missing evidence remains unknown. The shared shell's infrastructure health signal needs a separate scope assessment; this change cannot claim to fix it.

## Delivery boundaries

1. **RH-UI**, independently shippable, maps to BI-449F5F0F: existing runtime-health page and colocated tests. Render `3 of 5 phases unresolved` with error tone in the observed case, and summarize the two resolved locations without claiming all phases can run. Empty phase evidence must also avoid a healthy availability claim. Complete local/cloud/mixed cases retain accurate location reporting.
2. **RH-PROJECTION**, separately owned, maps to BI-59E37E39: its existing WC-7ACEDEB5 owns the resolver and tests. Coordinate partial native/MCP summaries and capacity-exclusion explanations with that owner. No edits to its claims from this worktree. The broader BI acceptance remains open until this dependency is reconciled.

The capability convergence dependency is existing BI-5ACBAC50 / WC-0AD784CD. Provider reachability is BI-E2BDE90B; account discovery stays with its original owner. Local inference qualification remains separate and provider disable remains authoritative.

## Implementation and verification

- **Requirement RH-UI:** unresolved counts lead the existing banner; successful locations remain visible. Red test reproduces two cloud phases plus three null resolutions; also cover complete locations and absent phase evidence.
- **Contract RH-UI:** consume existing `ModelSelectionOverview.phases`, without changing its wire contract or introducing a new verdict enum. `apps/web/app/(shell)/platform/ai/runtime-health/page.tsx` is the edit boundary.
- **Flow RH-UI:** served phase read → availability/location counts → one banner presentation → existing renderer. Unknown availability is never converted into all-ready.
- **Verification RH-UI:** `apps/web/app/(shell)/platform/ai/runtime-health/page.test.tsx` tests rendered behavior; run affected tests and both web typechecks through admitted source/shared gates. Exercise prose and style guards, derived-artifact checks and the frozen ≤630-word route sweep; never inflate baselines. Canonical exact-tree gate and protected publication remain required.
- **Requirement RH-PROJECTION:** coordinate the partial native summary and structured explanation with the existing resolver owner; retain its current eligibility checks.
- **Contract RH-PROJECTION:** `apps/web/lib/inference/phase-model-resolution.ts`, already claimed by WC-7ACEDEB5, and its colocated tests.
- **Flow RH-PROJECTION:** actual routing exclusions → existing phase projection → native/MCP and UI summaries.
- **Verification RH-PROJECTION:** the owning branch supplies regression and exact-tree evidence; do not attribute its unrun verification to this page change.

Graph advice returned no related test links for the page. Its colocated tests are confirmed in source; expand shared verification rather than treating missing graph links as an exemption.

## Design fit, risks and rollback

This is a correction within the existing dashboard. No new control or disclosure is added. Preserve DPF theme tokens and error/unknown distinctions. Risks: stale summaries disagreeing with the phase table, empty projections claiming healthy state, or added text exceeding the frozen word budget. Render tests check the first two; source guards and the protected runtime sweep check the third. Revert the page/test change as one unit if needed; no data rollback exists or is required.

Live acceptance follows canonical release inclusion and preflight CAN-TEST. Verify partial and complete phase reporting on the served route, then record evidence. Source tests do not establish actual AI routing recovery. No parent completion or independent semantic-review pass is implied by this plan.

## Backlog coverage

Native decomposed receipt `cmv5v820y1pca01pg7ds5q22o` binds immutable plan commit `5040f8704c2b128e207c96e64935258a80677f4a`, blob `f1af2f1d6d3872073d47c78705be7c262d0d75dc`. RH-UI maps to BI-449F5F0F and RH-PROJECTION maps to existing BI-59E37E39. Both mappings validated. Page-only implementation was admitted as `IRD-E142A139F53A`; native projection and broader acceptance remain separately owed.
