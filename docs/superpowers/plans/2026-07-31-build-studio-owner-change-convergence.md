---
title: Build Studio Owner Change Convergence Implementation Plan
date: 2026-07-31
updated: 2026-08-15
status: in progress - current-main reconciliation applied
owner: platform
backlogItem: BI-A40C8A70
spec: docs/superpowers/specs/2026-06-12-build-studio-owner-improvement-experience-design.md
---

# Build Studio Owner Change Convergence Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## 1. Goal

Converge the production Build Studio, persistent business brief, shared Attention Surface, native mobile app, and outcome substrate into one small-business-owner journey:

```text
Outcome -> Change -> visible work -> Needs You -> preview -> proof -> release -> follow-up
```

This plan does not create a new Improvements product. Workspace/coworker remains the owner front door, `/workspace/inbox` remains the only Needs You queue, and `/build` remains the owner-readable Change detail.

### 1.1 Current-main reconciliation - 2026-08-15

The five-slice delivery graph remains valid, but later platform work changed the implementation boundary. This table is the current execution authority; historical local commits and completed adjacent BIs are not evidence that a slice shipped.

| Slice or adjacent item | Current state | Reconciled decision |
| --- | --- | --- |
| Phase A - `BI-8B601F2F` | In progress. The implementation branch was rebased onto `ca95c7f88aa`; the relation, selected-Change brief, proof packet, and accessibility work are still absent from `main`. | Finish as one Phase A PR. Consume the canonical owner state from #4249; do not restore a second health/status interpreter. |
| Owner state - `BI-62075FF9` | Done in PR #4249 (`49079d71ec7`) with canonical-runtime UX and merged-tree CI evidence. | Treat `owner-status-reconciliation.ts` as the sole owner-state seam. Do not duplicate this item in Phase A. |
| Long-running state - `BI-78499309` | Reopened on 2026-08-15 after genuine provider-outage recovery activity made idle builds appear active. | Remains independently owned by the 2026-08-12 owner-state plan. Phase A may display its projection but does not repair its runtime/liveness source. |
| Phase B - `BI-1BBFE3E2` | Open. Build Studio captures some `DecisionInteraction` records, but there is no complete idempotent owner-gate resolver shared across `/build`, Attention, and mobile. | Re-audit against the canonical lifecycle grammar from PR #4289, then persist one gate identity per logical owner decision. Lifecycle grammar is not a substitute for decision persistence. |
| Phase C - `BI-DC63D163` | Open. `/build?v=2`, `BuildStudioV2`, and `build-studio-demo.ts` remain production-reachable. | Execute after Phase A lands and parity is verified. Remove the route switch and demo-only code rather than extending it. |
| Phase D - `BI-98A7B589` | Deferred. The separate archetype-aware mobile companion design has not landed on `main`; SDK maintenance since August 1 does not deliver Today / Needs You. | Keep deferred until Phase B and mobile identity, channel-binding, deep-link, and durable offline prerequisites are accepted. Reuse the DAP cross-process inbox; no mobile-only decision store. |
| Phase E - `BI-3CBF6A99` | Open and still dependent on deferred `BI-96812FC2`. Watched-analysis work in PR #4233 is adjacent evidence infrastructure, not Build Studio outcome closure. | Do not start until the HX re-measurement contract is live. Reuse outcome observations and stable improvement signals. |

Recommended remaining order: finish Phase A; retire V2; deliver the DecisionInteraction gate identity; then unblock mobile and outcome follow-up only through their named prerequisites. The umbrella `BI-A40C8A70` remains open until integrated canonical-runtime evidence proves the complete journey.

## 2. Current Substrate

The plan extends these verified homes:

| Concern | Current home |
| --- | --- |
| Production Change detail | `apps/web/components/build/BuildStudio.tsx` |
| Build route/data loading | `apps/web/app/(shell)/build/page.tsx` |
| Persistent business brief | `packages/db/prisma/schema.prisma` (`BusinessBuildBrief`), `apps/web/lib/build/business-build-brief.ts` |
| Existing brief editor | `apps/web/components/build-studio/BusinessBriefPanel.tsx` |
| Legacy production brief presentation | `apps/web/components/build/FeatureBriefPanel.tsx` |
| Owner status/proof ingredients | `BuildOperatorOverview`, customer status, solution/change/decision bands in `apps/web/components/build/` |
| Workflow action derivation | `apps/web/components/build/build-studio-workflow-actions.ts` |
| Existing gate capture | `apps/web/components/build/BuildStudioWorkflowActionCard.tsx` and `apps/web/lib/actions/decision-perspective.ts` |
| Decision persistence | `apps/web/lib/decision-perspective/persistence.ts` |
| Needs You projection | `apps/web/lib/attention/aggregate.ts`, `apps/web/lib/attention/sources/ai-decision.ts` |
| Mobile owner home | `apps/mobile/app/(tabs)/index.tsx` |
| Mobile approval/notification stores | `apps/mobile/src/features/governance/`, `apps/mobile/src/features/notifications/` |
| Mobile deep links | `apps/mobile/src/hooks/useDeepLink.ts` |
| Outcome observations | `apps/web/lib/product-management/outcomes-repository.ts` |
| Improvement signal | `apps/web/lib/improvement-flywheel/signals.ts` |

`mcp__dpf__search_code_graph` returned no symbol matches for these queries even though its index reported ready. Local current-main source inspection is therefore the authoritative grounding for file-level sequencing.

## 3. Delivery Graph

| Key | Backlog item | Independently shippable | Depends on |
| --- | --- | --- | --- |
| `brief-proof` | `BI-8B601F2F` | Yes | none |
| `decision-gates` | `BI-1BBFE3E2` | Yes | none |
| `retire-v2` | `BI-DC63D163` | Yes | `brief-proof` |
| `mobile-needs-you` | `BI-98A7B589` | Yes | `decision-gates`; mobile auth/multi-space prerequisites when applicable |
| `outcome-follow-up` | `BI-3CBF6A99` | Yes | `BI-96812FC2` |

Existing adjacent work remains independently owned:

- `BI-78499309`: long-running progress visibility.
- `BI-950FE085`: intake affordance hardening.
- `BI-62075FF9`: status-strip cleanup.
- `BI-8F83933B`: remaining unified-tracking reconciliation.
- `BI-3F455757`: generic proactive human-assist substrate.
- `BI-MOBAPP-SCREENS`: mobile SDUI screen layer.
- `BI-96812FC2`: HX loop closure and re-measurement.

## 4. Phase A - Canonical Brief And Owner Proof

**BI:** `BI-8B601F2F`

**Delivery boundary:** independently shippable. This is the first implementation PR.

### 4.1 Schema and loader contract

1. Add a failing schema/loader test proving the selected `FeatureBuild` resolves only its linked `BusinessBuildBrief`.
2. Audit `BusinessBuildBrief.featureBuildId` and `FeatureBuild` for a proper bidirectional Prisma relation.
3. If the relation is absent, add it with an immutable migration and an inline backfill/constraint validation appropriate to current data.
4. Extend `getFeatureBuildById` / build-page loading to return the selected build's brief by relation, never `findFirst` by submitting user.
5. Preserve `legacyFeatureBuildBriefToBusinessBuildBriefInput` only as the compatibility path for historical rows and existing write callers.

Likely files:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_relate_business_build_brief/migration.sql` if required
- `apps/web/app/(shell)/build/page.tsx`
- `apps/web/lib/feature-build-data.ts`
- `apps/web/lib/build/business-build-brief.ts`
- associated unit/integration tests

### 4.2 Owner projection

1. Add a pure `OwnerChangeView` projector under `apps/web/lib/build/`.
2. Derive Outcome, Now, Next, canonical `ownerState`, preview posture, pending decision ID, and proof states from canonical records. Consume `owner-status-reconciliation.ts`; do not infer another status from owner copy.
3. Use closed evidence states: `passed`, `failed`, `not-applicable`, `not-recorded`, `stale`.
4. Never infer a pass from phase position, missing output, or optimistic UI state.
5. Unit-test every phase, health overlay, missing/stale evidence, and cross-build isolation.

Likely files:

- `apps/web/lib/build/owner-change-view.ts` (new)
- `apps/web/lib/build/owner-change-view.test.ts` (new)
- `apps/web/lib/build/customer-status-projection.ts`
- `apps/web/lib/build/customer-status-loader.ts`

### 4.3 Production composition

1. Refactor `BusinessBriefPanel` into the production build component area or a shared build primitive; remove demo-specific imports and assumptions.
2. Replace the default legacy brief presentation with the canonical business brief while preserving historical fallback.
3. Compose the owner proof packet from existing solution, change narrative, decision ledger, customer status, runtime verification, and unified timeline projections.
4. Place the owner proof summary above Technical details; keep commands, IDs, branches, and raw receipts below disclosure.
5. Use theme tokens and report-kit status/list primitives. Do not add local status colors or a hand-rolled reporting table.

Likely files:

- `apps/web/components/build/BuildStudio.tsx`
- `apps/web/components/build/FeatureBriefPanel.tsx`
- `apps/web/components/build-studio/BusinessBriefPanel.tsx`
- `apps/web/components/build/BuildOperatorOverview.tsx`
- `apps/web/components/build/BuildCustomerStatusBand.tsx`
- `apps/web/components/build/BuildSolutionSummaryBand.tsx`
- `apps/web/components/build/BuildChangeSummaryBand.tsx`
- `apps/web/components/build/BuildDecisionLedgerBand.tsx`
- new owner proof component and tests under `apps/web/components/build/`

### 4.4 Phase verification

- Targeted Vitest for projector, loader, editor, and Build Studio composition.
- `pnpm --filter web typecheck`.
- Production build in the shared local-CI convergence sandbox.
- Migration validation/apply evidence if schema changes.
- Desktop and mobile-width UX evidence for no build, working, Needs You, proof complete, proof missing/stale, failed, and permission-limited states.
- Cross-build test: select Change A, Change B, then A; each brief and proof remains isolated.

### 4.5 Rollback

Keep the legacy brief projection callable behind a short-lived compatibility adapter. If the new owner projection fails after deployment, revert the composition to the legacy panel without deleting or rewriting `BusinessBuildBrief` rows. A relation migration must be additive and safe to retain during rollback.

## 5. Phase B - DecisionInteraction-First Needs You

**BI:** `BI-1BBFE3E2`

**Delivery boundary:** independently shippable and can proceed in parallel with Phase A.

### 5.1 Gate inventory and idempotency

1. Enumerate every `BuildStudioWorkflowAction` and classify it as autonomous, operator-only, or owner-required.
2. Add table-driven tests locking that classification.
3. For each owner-required action, create or resolve one `DecisionInteraction` before rendering the actionable choice.
4. Use the stable key `(featureBuildId, gateKind, gateVersion)` in supported metadata or dedicated indexed fields if the schema audit proves metadata cannot enforce idempotency.
5. Extend existing persistence; do not create `BuildAttention` or another decision table.

Likely files:

- `apps/web/components/build/build-studio-workflow-actions.ts`
- `apps/web/components/build/build-studio-workflow-actions.test.ts`
- `apps/web/components/build/BuildStudioWorkflowActionCard.tsx`
- `apps/web/components/build/BuildStudioWorkflowActionCard.test.tsx`
- `apps/web/lib/actions/decision-perspective.ts`
- `apps/web/lib/decision-perspective/persistence.ts`
- `packages/db/prisma/schema.prisma` and migration only if indexed gate identity needs schema support

### 5.2 One decision across surfaces

1. Extend `DecisionInteractionRow` / `aiDecisionToAttentionItem` with supported Change context and `/build?buildId=...` deep link.
2. Ensure situation, recommendation, consequences, risk, deadline, and authority are owner-readable.
3. Make `/build` action handling resolve the same interaction consumed by `/workspace/inbox`.
4. Deduplicate escalation residue that refers to the same gate; retain non-actionable failure context in the timeline.
5. Return resolved/stale context instead of a dead action when a delayed deep link is opened.

Likely files:

- `apps/web/lib/attention/sources/ai-decision.ts`
- `apps/web/lib/attention/sources/sources.test.ts`
- `apps/web/lib/attention/owner-decision.ts`
- `apps/web/lib/attention/owner-routing.ts`
- `apps/web/app/(shell)/workspace/inbox/page.tsx`
- Build Studio refresh/resume actions and tests

### 5.3 Phase verification

- Table-driven classification and idempotency tests.
- Concurrent double-create test produces one interaction.
- Act in `/build`; inbox card resolves and workflow resumes.
- Act in `/workspace/inbox`; Build Studio refreshes to the next state.
- Stale, unauthorized, expired, reassigned, and adapter-failure paths.
- Typecheck, production build, shared-sandbox UX evidence, and accessibility verification.

### 5.4 Rollback

Decision rows are additive audit evidence and remain valid after rollback. Revert presentation/routing to local Build Studio actions while retaining interaction history. Do not delete decisions to roll back UI behavior.

## 6. Phase C - Retire The V2 Demo Path

**BI:** `BI-DC63D163`

**Delivery boundary:** independently shippable after Phase A reaches production parity.

1. Add a regression test that `/build?v=2` cannot select a demo component.
2. Remove the route branch and latest-user brief query from `apps/web/app/(shell)/build/page.tsx`.
3. Delete `BuildStudioV2`, `build-studio-demo.ts`, no-op handlers, and demo-only children/tests when no remaining importer exists.
4. If a visual primitive is retained, move it into the production build area with real props, theme compliance, responsive behavior, and a named owner.
5. Run `rg` to prove no production import of `DEMO_BUILD`, `DEMO_CONVERSATION`, `DEMO_STEPS`, `DEMO_PENDING_APPROVALS`, or the demo sandbox remains.

Likely files:

- `apps/web/app/(shell)/build/page.tsx`
- `apps/web/components/build-studio/BuildStudioV2.tsx`
- `apps/web/components/build-studio/BuildStudioV2.test.tsx`
- `apps/web/lib/build-studio-demo.ts`
- demo-only components under `apps/web/components/build-studio/`

Verification:

- Route/component tests and no-demo-import guard.
- Typecheck and production build.
- `/build` and `/build?v=2` both reach canonical behavior.
- Owner brief editing, progress, proof, and release remain functional.

Rollback is a code revert only; no data migration is owned by this phase.

## 7. Phase D - Mobile Today / Needs You

**BI:** `BI-98A7B589`

**Delivery boundary:** independently shippable after Phase B. Coordinate with mobile auth/multi-space and `BI-MOBAPP-SCREENS` rather than bypassing them.

### 7.1 Shared API contract

1. Expose the owner Attention projection through the existing authenticated mobile API version and shared wire types.
2. Preserve source, decision ID, risk, urgency, audience, situation, recommendation, consequence, choices, status, and deep link.
3. Resolve the action server-side against the current `DecisionInteraction`; never trust a cached mobile choice against stale state.
4. Keep `AgentActionProposal` approvals separate from decision interactions while presenting both in one Today / Needs You hierarchy.

### 7.2 Mobile composition

1. Add a Today / Needs You section to `apps/mobile/app/(tabs)/index.tsx` for owner/operator personas.
2. Add an attention store/repository rather than overloading `governance.store.ts`.
3. Create an owner decision card with 44px minimum targets, risk/urgency semantics, loading/error/offline states, and authenticated detail review.
4. Extend deep-link handling to resolve Change context and stale/resolved decisions.
5. Respect multi-space scope, channel bindings, quiet hours, and offline mutation policy.
6. Do not allow high-risk approval directly from a push action.

Likely files:

- mobile/web shared types package selected by the schema audit
- authenticated API route under `apps/web/app/api/v1/`
- `apps/mobile/app/(tabs)/index.tsx`
- new `apps/mobile/src/features/attention/` store and tests
- new owner decision card under `apps/mobile/src/components/`
- `apps/mobile/src/hooks/useDeepLink.ts`
- notification and navigation tests
- Maestro flow under `apps/mobile/e2e/flows/`

### 7.3 Phase verification

- Mobile Jest for loading, ordering, resolve, rollback-on-error, stale, unauthorized, and offline behavior.
- Web API authorization and idempotency tests.
- Mobile typecheck and path-filtered CI.
- Device evidence for small/large phones, text scaling, screen reader labels, touch targets, offline/reconnect, multi-space switching, push deep link, and high-risk authenticated review.
- Cross-surface test: resolve on mobile and verify web update; resolve on web and verify mobile update.

### 7.4 Rollback

Feature-gate the mobile home projection by server manifest capability. Rollback removes the nav/home projection while leaving canonical decisions and notification history intact.

## 8. Phase E - Governed Outcome Follow-Up

**BI:** `BI-3CBF6A99`

**Delivery boundary:** independently shippable after `BI-96812FC2` provides the canonical loop-closure behavior.

1. Map approved `BusinessBuildBrief.successSignals` to an existing `ProductObjective`/measure contract or a bounded follow-up prompt; do not invent an untyped metric blob.
2. On successful release, schedule the agreed review date through the existing scheduled-task substrate.
3. Record observations with `recordProductOutcomeObservation` and link them to the Change/Backlog outcome anchor.
4. When evidence shows unmet value or repeatable friction, call `createOrTouchImprovementSignal` with a stable source key derived from the Change and measure.
5. Render follow-up status and observations in the unified Change timeline.
6. Preserve explicit owner judgment when the measure is qualitative or evidence is inconclusive.

Likely files:

- `apps/web/components/build/ReleaseDecisionPanel.tsx`
- `apps/web/lib/actions/build.ts`
- release/ship orchestration under `apps/web/lib/integrate/`
- `apps/web/lib/product-management/outcomes.ts`
- `apps/web/lib/product-management/outcomes-repository.ts`
- `apps/web/lib/improvement-flywheel/signals.ts`
- scheduled task integration and unified timeline projection
- associated tests

Verification:

- Release schedules one follow-up idempotently.
- Observation records preserve measure/source/reviewer context.
- Met outcome closes without a signal; unmet/repeatable outcome touches one stable signal.
- Re-measurement can resolve the signal with before/after evidence.
- Typecheck, production build, scheduler test, and end-to-end timeline evidence.

Rollback disables new scheduling and signal emission while retaining already-recorded observations and audit rows.

## 9. Cross-Cutting Completion Gate

Each implementation PR must pass the gates owned by its BI. The umbrella is complete only when the integrated current main proves:

1. Web targeted Vitest suites pass.
2. `pnpm --filter web typecheck` passes.
3. `pnpm --filter web build` passes in canonical install or the leased shared local-CI convergence sandbox.
4. Mobile Jest/typecheck and E2E evidence pass when Phase D is included.
5. Any Prisma migration validates and applies cleanly against representative current data.
6. UX verification covers desktop and mobile intake, working, Needs You, proof, permission, empty, stale, offline, failure, release, and follow-up states.
7. Accessibility verification covers keyboard, screen reader names, focus, text scaling, contrast through theme tokens, reduced motion, and touch targets.
8. No production route renders demo Build Studio data.
9. One owner decision has one identity across `/build`, `/workspace/inbox`, push, and mobile.
10. Evidence claims remain honest when records are missing, stale, failed, or not applicable.

## 10. Backlog Coverage

- Decision: `decomposed`
- Umbrella: `BI-A40C8A70`
- Plan path: `docs/superpowers/plans/2026-07-31-build-studio-owner-change-convergence.md`
- Coverage receipt: `cms9vd8j5009s01r2c65der0f`
- Coverage validation: `check_plan_backlog_coverage` returned `valid: true` on 2026-07-31

Mappings:

| Deliverable | BI | Depends on |
| --- | --- | --- |
| `brief-proof` | `BI-8B601F2F` | none |
| `decision-gates` | `BI-1BBFE3E2` | none |
| `retire-v2` | `BI-DC63D163` | `brief-proof` |
| `mobile-needs-you` | `BI-98A7B589` | `decision-gates` |
| `outcome-follow-up` | `BI-3CBF6A99` | `BI-96812FC2` |

Before each implementation slice begins, rerun `check_plan_backlog_coverage` with this receipt. Stop if a mapped BI is missing, the plan path changes, or the receipt is no longer valid.
