---
title: HVAC dispatcher workspace home — implementation plan (Dale's AC repair as proving install)
date: 2026-06-04
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-CE6AF925
epic: EP-REDUCTION-GEAR-ARCH
implements:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md (parent substrate spec)
  - docs/superpowers/specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md (Dale visual paradigm + slot covenant + primitive mapping)
upstream-deps:
  - BI-1CCC6264 (substrate) — DONE, on main (PR #1237)
  - BI-3E8D2CF5 (projection service for GearInterface / Calibrator / Governor signals) — OPEN, blocking Phases 3-5 + Phase 8
  - BI-5B8FE5C1 (primitive registry implementation) — spec on main (PR #1232), implementation OPEN, blocking Phases 3-8
related:
  - PR #1438 (architect amendments — primaryOperatingQuestion + zone) — landing
  - PR #1439 (unconfigured-archetype telemetry counter) — landing
---

# HVAC dispatcher workspace home — implementation plan

## Anchor

This plan implements **[BI-CE6AF925](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues?q=BI-CE6AF925)** — *HVAC dispatcher workspace home — service schedule, technician load, and customer updates*. Its acceptance criteria are this plan's definition of done:

- First viewport is a dense dispatch board, not a marketing hero or generic platform dashboard.
- UI vocabulary uses jobs, service calls, technicians, customers, sites, units, customer updates, and dispatcher handoffs.
- Coworker handoffs show pending PAR acknowledgements addressed to the worker and include Governor `require-hitl` decisions.
- No rendered worker UI copy exposes gear/ring/torque/slip/wear/triple/shaft/calibration/contribution-model/cockpit terms.
- Functional UX verification on Live portal `http://localhost:3000/workspace` against the seeded HVAC fixture: one scheduled job, one unscheduled job, one overloaded technician, one failed customer update, one pending PAR acknowledgement, one Governor `require-hitl` decision.
- Desktop + mobile verify slot priority and mobile-collapse behavior.
- Theme-aware styling — no hardcoded color classes / hex.
- `pnpm --filter web typecheck` + production build pass.

The Dale visual design ([`2026-05-24-dales-ac-repair-workspace-home-visual-design.md`](../specs/2026-05-24-dales-ac-repair-workspace-home-visual-design.md)) is the visual contract — six panels, density budget, mobile collapse order, accessibility floor, D-defect alignment. This plan does not re-litigate those; it sequences the implementation.

## Phase 0 — dependency check and sequencing

**Why this phase exists.** Dale's spec (§Implementation Implications) states the sequencing constraint explicitly: HVAC dispatcher implementation cannot start until the substrate (BI-1CCC6264), projection service (BI-3E8D2CF5), and primitive library (BI-5B8FE5C1) ship. The substrate is on main; the projection service and primitive library are not. Trying to implement Phases 3–8 without them inlines workarounds that fragment the contribution registry — the exact failure mode the substrate spec warns against.

**Substrate primitive-key naming gap.** The substrate (`apps/web/lib/workspace-home/types.ts`) ships `WorkspaceHomePrimitiveKey` as the union `"today-strip" | "service-queue" | "customer-map" | "customer-health-map" | "exception-list" | "coworker-handoffs" | "metric-tile" | "calendar" | "activity-feed" | "platform-tiles"`. The Dale visual spec and the primitive-registry spec name primitives differently: `decision-queue`, `geo-map`, `capacity-lanes`, `health-board`, `inventory-watch`, `case-board`, `service-period-board`, `communication-exceptions`, `handoff-queue` (+ `appointment-schedule`, `volunteer-program-board` from BI-5B8FE5C1). **The substrate's enum is provisional**; the substrate sign-off ADR documents it as a boundary BI-5B8FE5C1 fills out. BI-5B8FE5C1's implementation will replace or extend the enum, and BI-CE6AF925's contribution literal must align to whatever lands. This plan assumes the spec-canonical naming and notes the rename surface in Phase 1.

**Deliverable.** Confirm all three of the following before starting Phase 1:

1. `BI-1CCC6264` status = `done` and PR #1237's substrate code is on `origin/main`. ✅ as of 2026-05-27.
2. `BI-3E8D2CF5` status = `done`, and `apps/web/lib/workspace-home/projection/` (or equivalent path the projection BI lands at) exists with: GearInterface signal loader, Calibrator trust-snapshot loader, Governor decision loader, archetype-scoped filter, banned-copy lint passing on the worker-facing output. Verify via `git ls-tree -r origin/main --name-only -- apps/web/lib/workspace-home/projection`.
3. `BI-5B8FE5C1` status = `done`, and the spec-canonical primitive renderers exist under `apps/web/components/workspace-home/primitives/` (or equivalent), at minimum: `DecisionQueue`, `GeoMap`, `CapacityLanes`, `InventoryWatch`, `CommunicationExceptions`, `HandoffQueue` — the six Dale's home uses.

If 2 or 3 is not ready: stop. File the missing dependency as a blocker on BI-CE6AF925 via `mcp__dpf__record_execution_evidence` with `kind: "external_link"` and `summary: "BLOCKED: <which dep> not ready"`. Do not invent inline components.

**Verification.** `mcp__dpf__get_backlog_item` returns `status: "done"` for all three. `git ls-tree` confirms expected paths. Nothing here writes code yet.

## Phase 1 — HVAC contribution manifest scaffold

**Goal.** Register the `WorkspaceHomeContribution` for `hvac-contractor` against the substrate registry. No slot rendering yet; just the manifest declaration with stub `dataRef` values that fail closed.

**Files.**
- `apps/web/lib/workspace-home/contributions/hvac-contractor.ts` — new. Exports a typed `WorkspaceHomeContribution` literal with:
  - `id: "home-hvac-dispatch"`
  - `label: "HVAC dispatcher home"`
  - `primaryOperatingQuestion: "what's on the board today?"` (architect amendment from PR #1438; if PR #1438 hasn't merged when Phase 1 starts, omit the field — `primaryOperatingQuestion?` is optional)
  - `semanticArchetypeIds: ["hvac-contractor"]`
  - `archetypeCategories: ["trades-maintenance"]`
  - `setupActivation: { status: "ready", primitiveWidgets: [...the six Dale primitives], requiredCanonicalData: ["work-item", "calendar-event", "customer-account", "customer-configuration-item", "communication-delivery-attempt", "work-schedule"], requiredSignals: ["governor-require-hitl", "calibrator-trust-drop", "communication-failed"], missingDataBehavior: "render-empty-state" }`
  - `slots: [...]` — 6 slot entries honoring the covenant + Dale's three enrichment slots. Each slot includes the architect-amended `zone` (PR #1438): `critical-strip` for exceptions queue, `primary` for technician schedule, `briefing` for handoffs, `secondary` for the three enrichment slots.
  - `components: [...]` — each slot's component descriptor with `dataRef` pointing at the projection service's loader IDs.
- `apps/web/lib/workspace-home/contributions/index.ts` — new barrel. Exports the HVAC contribution + registers it on `defaultWorkspaceHomeRegistry` at module load (or exports an `registerHvacContribution(registry)` helper for explicit composition).
- `apps/web/lib/workspace-home/index.ts` — modify. Re-export the contributions barrel.

**Verification.**
- `pnpm --filter web typecheck` green — the TypeScript shape of the literal matches `WorkspaceHomeContribution` exactly. If the substrate `WorkspaceHomePrimitiveKey` enum hasn't been updated by BI-5B8FE5C1 yet, the literal can use string-cast escape hatches (`"decision-queue" as WorkspaceHomePrimitiveKey`) with a TODO comment pointing at BI-5B8FE5C1; this is the only place this plan tolerates a cast and it must be removed in the same PR as the BI-5B8FE5C1 rename.
- New test `apps/web/lib/workspace-home/contributions/hvac-contractor.test.ts` proves: registering the HVAC contribution satisfies the slot covenant validator (`validateWorkspaceHomeContribution` returns `{ok: true}`); the contribution declares exactly the six primitives Dale's visual spec lists; `primaryOperatingQuestion` matches "what's on the board today?"; every slot declares a `zone` from the architect-amended enum.
- Run the existing `apps/web/lib/workspace-home/registry.test.ts` and `activation-summary.test.ts` — must remain 23/23 (or 29/29 if PR #1438 has merged). No regression in substrate tests.

**Rollback.** Delete the new files; remove the re-export from `index.ts`. Registry returns to empty default.

## Phase 2 — Wire `/workspace` to render vertical mode for `match=exact`

**Goal.** Teach `apps/web/app/(shell)/workspace/page.tsx` to dispatch on `workspaceHomeResolution.mode === "vertical"` to a `<VerticalWorkspaceHome contribution={...} data={...} />` component instead of `<PlatformWorkspaceHome />`. With the HVAC contribution registered in Phase 1, an install configured with `archetype = hvac-contractor` will now render the vertical home.

**Files.**
- `apps/web/components/workspace-home/VerticalWorkspaceHome.tsx` — new. Reads the contribution's `slots`, sorts by priority + zone, renders each slot through the primitive registry (`apps/web/components/workspace-home/primitives/*`) using the `WorkspaceHomeComponentRegistry` fail-closed pattern (`registry[slot.component] ?? UnknownSlotComponent`). Renders a thin worker-mode chrome (no platform-operator INTERNAL COCKPIT chip — see "Worker-mode shell-chrome switch" note below).
- `apps/web/components/workspace-home/UnknownSlotComponent.tsx` — new. Renders the substrate's admin-visible "Slot misconfigured" placeholder for unknown component keys; empty placeholder for non-admins per substrate spec §5.5.
- `apps/web/app/(shell)/workspace/page.tsx` — modify. Switch:
  ```tsx
  if (workspaceHomeResolution.mode === "vertical") {
    return <VerticalWorkspaceHome contribution={workspaceHomeResolution.contribution} platformData={platformHomeData} />;
  }
  return (
    <>
      {workspaceHomeResolution.mode === "unconfigured" && <UnconfiguredWorkspaceHomeNotice />}
      <PlatformWorkspaceHome data={platformHomeData} />
    </>
  );
  ```
  Pass `platformData` through to the vertical component so any enrichment slot that needs platform-level data (e.g., calendar events, activity feed) can read it from the same loader.

**Worker-mode shell-chrome switch.** The BI body line "the worker home header does not present the surface as an Internal cockpit" applies here. The substrate exposes `WorkspaceHomeResolution.mode` as the contract handle; this phase teaches the `(shell)` layout to read the resolution mode (passed via React context or a server-only helper that re-evaluates the resolver) and conditionally swap the `INTERNAL COCKPIT` chip for vertical chrome (or hide it entirely). If swapping the shell chrome is too invasive for this phase, defer to a separate BI and ship Phase 2 with the existing chrome, recording the gap as evidence on BI-CE6AF925 — but the gap must be closed before Phase 11 sign-off.

**Verification.**
- New test `apps/web/app/(shell)/workspace/page.test.tsx` — extend the existing test file. Assert: when `resolveWorkspaceHomeContribution` returns `mode: "vertical", contribution: hvacContribution`, the rendered JSX contains `<VerticalWorkspaceHome>` and NOT `<PlatformWorkspaceHome>`. When mode is `unconfigured`, the existing behavior holds. Run with vitest in jsdom mode if not already configured.
- Targeted vitest: `pnpm --filter web exec vitest run lib/workspace-home components/workspace-home 'app/(shell)/workspace'` — all green.
- Build: `pnpm --filter web build` — green, no new substrate-owned warnings.

**Rollback.** Revert the switch in `page.tsx` to the pre-Phase-2 single-branch render. The Phase 1 contribution stays registered but no longer renders.

## Phase 3 — Covenant slot: today/now (Technician schedule and load)

**Goal.** Render the "Technician schedule and load" panel via the `capacity-lanes` primitive (per Dale's primitive→slot mapping table).

**Depends on.** Phase 2 + BI-5B8FE5C1's `CapacityLanes` primitive renderer + BI-3E8D2CF5's `loaderId: "work-schedule"` (or equivalent).

**Files.**
- `apps/web/lib/workspace-home/contributions/hvac-contractor.ts` — modify. Set the `today-now` slot's component descriptor: `{ key: "technician-schedule", slotId: "today-now", primitiveKey: "capacity-lanes", title: "Technician schedule and load", dataRefs: [{ kind: "canonical-data", key: "work-schedule", required: true }, { kind: "canonical-data", key: "calendar-event", required: true }, { kind: "canonical-data", key: "work-item", required: true }] }`.
- `apps/web/components/workspace-home/slots/TechnicianScheduleSlot.tsx` — new, if `CapacityLanes` needs HVAC-specific vocabulary wrapping. Otherwise, the `CapacityLanes` primitive renders directly from the contribution descriptor.
- HVAC vocabulary configuration — wherever `BI-5B8FE5C1`'s primitives accept vertical vocabulary (per primitive spec §6's vocabulary inputs), set HVAC-specific labels: "Trucks", "Technicians", "Current job", "Next job", "Load".

**Verification.**
- Unit test: `TechnicianScheduleSlot.test.tsx` (or `CapacityLanes` if rendering inline) renders a fixture with 4 technicians, asserts each lane shows current+next job, asserts load meter renders, asserts the banned-copy assertion fails on `gear|cockpit|ring|torque|slip` in the rendered output.
- Functional verification waits for Phase 11.

**Rollback.** Revert the slot's component descriptor to a stub; delete the slot-specific component if added. The contribution still satisfies the slot covenant via the stub.

## Phase 4 — Covenant slot: exceptions (Jobs needing attention)

**Goal.** Render the "Jobs needing attention" left-column queue via the `decision-queue` primitive.

**Depends on.** Phase 2 + BI-5B8FE5C1's `DecisionQueue` primitive renderer + BI-3E8D2CF5's `loaderId: "work-item"` filter for unassigned + emergency + parts-blocked + unconfirmed states.

**Files.**
- `apps/web/lib/workspace-home/contributions/hvac-contractor.ts` — modify. Set the `exceptions-needs-review` slot's component descriptor with `primitiveKey: "decision-queue"`, vocabulary "Jobs needing attention", and a composite `dataRef` that queries `WorkItem` rows where `sourceType = "field-service-job"` AND state is one of {unassigned, emergency, parts-blocked, unconfirmed}.
- Possibly `apps/web/components/workspace-home/slots/JobsNeedingAttentionSlot.tsx` if HVAC-specific exception-state rendering needs a wrapper.

**Verification.**
- Unit test: fixture with 1 unassigned, 1 parts-blocked, 1 unconfirmed, 1 emergency, 1 normal-scheduled job. Asserts the queue shows exactly the 4 attention-needing jobs, not the normal-scheduled one. Asserts each row carries an exception chip with icon + text + tone (accessibility floor — color not the only carrier).
- Banned-copy assertion against rendered output.

**Rollback.** As Phase 3.

## Phase 5 — Covenant slot: coworker-handoffs (PAR)

**Goal.** Render the "Coworker handoffs" PAR acknowledgement queue via the `handoff-queue` primitive. Must include Governor `require-hitl` decisions per the BI acceptance criterion.

**Depends on.** Phase 2 + BI-5B8FE5C1's `HandoffQueue` primitive + BI-3E8D2CF5's projection of Governor decisions into worker-readable `coworker-handoff` signals.

**Files.**
- `apps/web/lib/workspace-home/contributions/hvac-contractor.ts` — modify. Set the `coworker-handoffs` slot's component descriptor with `primitiveKey: "handoff-queue"`, vocabulary "Coworker handoffs", and `dataRef` of `kind: "signal"` for the projected handoff signals.
- `apps/web/components/workspace-home/slots/CoworkerHandoffsSlot.tsx` — only if HVAC needs vocabulary overrides for the ack/reassign control labels.

**Verification.**
- Unit test: fixture with 1 Governor `require-hitl` decision + 1 PAR-proposal pending Dale's ack. Both must render. Both must surface ack/reassign affordances. Banned-copy assertion passes (Governor decisions must be projected to worker vocabulary by BI-3E8D2CF5 — if the test catches gear/cockpit leakage here, the bug is upstream in the projection service).
- Specifically test that the PAR acknowledgement flow's "acknowledge" button is keyboard-reachable (accessibility floor).

**Rollback.** As Phase 3.

## Phase 6 — Enrichment slot: Customer/route map

**Goal.** Render the "Customer and route map" panel via the `geo-map` primitive.

**Depends on.** Phase 2 + BI-5B8FE5C1's `GeoMap` primitive (with route-risk overlay support).

**Files.** As Phase 3 pattern. Slot priority is enrichment-rank-1 per Dale's mobile collapse table; on mobile it lives behind a "Map" tab.

**Verification.**
- Unit test: fixture with 7 customers across the service area + 1 route-risk overlay. Asserts the map renders, asserts the risk overlay is visible, asserts the slot is reachable via keyboard tab order even when the map widget itself is disabled (accessibility floor — "The map slot must remain functional with the map disabled — implementer cannot make critical state visible only through a map overlay").

**Rollback.** Remove from `slots`; contribution still has the three covenant slots.

## Phase 7 — Enrichment slot: Truck stock and restock

**Goal.** Render the "Truck stock and restock" panel via the `inventory-watch` primitive.

**Depends on.** Phase 2 + BI-5B8FE5C1's `InventoryWatch` primitive + a canonical-data loader for truck inventory. **NB: the inventory loader may not exist yet on main.** If absent, file a thin loader BI before starting Phase 7 — do NOT inline a query.

**Files.** As Phase 3 pattern. Dale's defaulted design decision (§Design Questions — architect defaults #3): shared shop list as primary, per-truck stock badges as secondary affordance.

**Verification.**
- Unit test: fixture with one low-stock condition that crosses a restock threshold. Asserts the panel renders the shared shop list AND surfaces the same item as a per-truck badge inside the Phase-3 technician lane.
- Cross-slot integration: rendering Phases 3 + 7 together must not double-count or visually conflict.

**Rollback.** Remove the slot; reorder remaining enrichment slots per Dale's mobile-collapse table.

## Phase 8 — Enrichment slot: Customer updates (communication exceptions)

**Goal.** Render the "Failed customer updates" panel via the `communication-exceptions` primitive.

**Depends on.** Phase 2 + BI-5B8FE5C1's `CommunicationExceptions` primitive + BI-3E8D2CF5's projection of `CommunicationDeliveryAttempt` failures into worker-readable "customer update failed" signals.

**Files.** As Phase 3 pattern.

**Verification.**
- Unit test: fixture with 1 failed customer-update delivery attempt. Asserts the panel renders the failed update with a retry control. Banned-copy assertion passes (BI-3E8D2CF5 is responsible for the projection vocabulary).

**Rollback.** As Phase 6.

## Phase 9 — HVAC fixture seed

**Goal.** Add the exact fixture from Dale's spec §Verification so subsequent UX verification has data to drive: 4 trucks, 4 technicians, 7 service calls (≥1 unassigned, 1 parts-blocked, 1 unconfirmed, 1 emergency, 1 late), 1 failed customer notification, 1 Governor `require-hitl` handoff awaiting Dale's ack.

**Files.**
- `apps/web/lib/storefront/seed-hvac-dispatcher-fixture.ts` — new. Server-only function that creates the fixture under the install's HVAC archetype configuration. Idempotent — safe to call repeatedly without duplicating rows. Gated to **non-production environments only** (rejects when `NODE_ENV === "production"` unless an explicit `DPF_ALLOW_HVAC_FIXTURE=true` env override is set, to support test installs that genuinely need the fixture in a prod-shaped environment).
- `apps/web/app/api/dev/seed-hvac-fixture/route.ts` — new dev-only POST route that invokes the seed function. Gated to platform-admin role.
- Reference the fixture from a setup-task or a seed runner so a fresh install can opt in. Do NOT auto-seed on every install — the fixture is for the Dale dogfood and ad-hoc QA, not the default install state.

**Verification.**
- Unit test on the seed function: calling twice produces the same row count, not double. Calling with `NODE_ENV=production` and no override throws.
- After running the seed, `psql` (via `docker exec`) shows: 4 `WorkSchedule` rows with `workerType="technician"`, 4 `Agent` rows for trucks (or whatever the canonical truck representation is), 7 `WorkItem` rows with `sourceType="field-service-job"` and the required state mix, 1 `CommunicationDeliveryAttempt` with `status="failed"`, 1 `CoworkerActionEnvelope` (or whatever the Governor `require-hitl` projects through) ready for ack.

**Rollback.** Delete the seed module + route. Existing data unaffected (the seed is additive and gated).

## Phase 10 — Banned-copy + audience-boundary assertions

**Goal.** Codify the BI's "No rendered worker UI copy exposes gear/ring/torque/slip/wear/triple/shaft/calibration/contribution-model/cockpit terms" as a vitest assertion over the rendered HVAC home, plus D-defect terms from Dale's spec §Implementation Implications (D33: no tool names; D34: no stale build pointers; G1/G2/D14/D33: no FeatureBuild IDs, work-capsule slugs, git branch chips, schema field names, MCP tool names, or `BI-` codes in worker UI).

**Files.**
- `apps/web/components/workspace-home/VerticalWorkspaceHome.test.tsx` — new. Renders the full HVAC home tree against the Phase 9 fixture using `renderToStaticMarkup`. Asserts the rendered HTML matches NEITHER:
  - `/\b(gear|ring|torque|slip|wear|triple|shaft|calibration|cockpit)\b/i` (substrate-banned)
  - `/\b(reviewDesignDoc|loadWorkspaceHomeSignals|FeatureBuild|BI-[A-F0-9]{8}|mcp__|contribute_to_hive)\b/i` (D-defect terms)
  - `/\bcontribution[ -]?model\b/i`
- The test must NOT use `expect(html).not.toContain("gear")` (would fail on "gear-shift" in unrelated content); the regex word-bound is load-bearing.

**Verification.** The test passes. If it fails on a slot, the implementer traces whether the term came from the projection service (fix in BI-3E8D2CF5), the primitive (fix in BI-5B8FE5C1), or the HVAC contribution (fix here). Per Dale's spec: "If the test catches gear/cockpit leakage here, the bug is upstream."

**Rollback.** Phase is a test addition; rollback = delete the test (but you'd be losing the assertion the BI requires, so don't).

## Phase 11 — UX verification + sign-off ADR + PR

**Goal.** Functional dynamic-analysis verification of the HVAC home on the Live portal at `http://localhost:3000/workspace`, sign-off ADR following the substrate ADR pattern, scoped PR open against `main`.

**Pre-conditions.**
- Live portal at `localhost:3000` configured with `hvac-contractor` archetype (Dale's install) and Phase 9 fixture seeded.
- All Phase 3–8 + 10 tests green locally.
- Full vitest suite green (pre-push obligation per `feedback_run_full_tests_before_push`).
- Production build green.

**Files.**
- `docs/superpowers/decisions/YYYY-MM-DD-hvac-dispatcher-workspace-home-signoff.md` — sign-off ADR mapping BI acceptance criteria to evidence (test paths + UX evidence dir + audience-boundary scan results + standing-rules audit), following the substrate ADR precedent at `docs/superpowers/decisions/2026-05-26-vertical-workspace-home-substrate-signoff.md`.
- `docs/superpowers/evidence/YYYY-MM-DD-hvac-dispatcher-workspace-home/dynamic-analysis.md` — prose findings per `feedback_dynamic_analysis_is_evidence`: drove the dispatch board, observed each slot rendering real fixture records, recorded signed-off observations. Side-by-side comparison against `docs/superpowers/mockups/2026-05-24-dales-ac-repair-workspace-home.html`: same six panels, same grid topology, density budget ≤6 metric chips, three covenant slots above the fold at 1366×768, mobile collapse order matches Dale's table at 375×667.
- Sweep `gh pr list --state open` against `workspace OR dispatch OR hvac` for overlap before pushing.

**Verification matrix in the PR body.**
| Gate | Expected |
|---|---|
| `pnpm --filter web typecheck` | green |
| Targeted vitest | all green, includes Phase-10 banned-copy assertion |
| Full web vitest | green, no new regressions |
| Production build | green, zero new substrate-owned warnings |
| UX evidence | desktop + mobile drives of each slot + the unconfigured-archetype fallback path (sanity that other archetypes still get the platform fallback) |
| Audience boundary | dynamic-analysis vocabulary scan returns ZERO worker-facing forbidden tokens |
| DCO sign-off | every commit |
| Overlap sweep | clean at push time |

**Verification.** PR opened, CI green, sign-off ADR + evidence dir linked, merge by reviewer.

**Rollback.** PR-level revert. Phases 1–8 are additive (registry registration, new components, new contribution file); reverting the merge reinstates the substrate-only state.

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| BI-3E8D2CF5 (projection service) doesn't ship in time, or ships with a different loader-id naming scheme than this plan assumes | medium | high — Phases 3–8 all depend on canonical loaders | Phase 0 verifies projection is ready before any code is written. If projection naming differs, refactor the HVAC contribution's `dataRefs` block in a single commit and re-run tests. |
| BI-5B8FE5C1 (primitive library) ships with primitive renderers that need a different prop shape than this plan's component descriptors | medium | medium — slot rendering uses the substrate's `WorkspaceHomeComponentRegistry` fail-closed pattern, so missing/changed primitives degrade to the admin placeholder, not a hard crash | Phase 0 verifies the six Dale primitives exist; Phase 2's `VerticalWorkspaceHome` uses the registry-lookup pattern that already accepts unknown keys gracefully. |
| Substrate `WorkspaceHomePrimitiveKey` enum doesn't get renamed by BI-5B8FE5C1, leaving a vocabulary split (substrate "service-queue" vs spec "decision-queue") | medium | low — the contribution literal can use a typed alias map | Phase 1 documents the cast; remove the cast in the BI-5B8FE5C1 rename PR. |
| The worker-mode shell-chrome switch (Phase 2 sub-task) turns out to be larger than this plan can absorb — `(shell)/layout.tsx` is shared infrastructure | medium | medium | Defer the chrome switch to a separate BI; ship Phase 2 with the existing chrome and record the audience-boundary gap as evidence; close it before Phase 11 sign-off. |
| Concurrent session lands an overlapping vertical contribution (clinic, MSP, etc.) and we collide on the registry barrel | low | low | Memory `feedback_pr_overlap_check_before_pushing` + `feedback_continuous_overlap_check`: sweep `gh pr list` before every push. Worst case: barrel rebase. |
| HVAC fixture seed (Phase 9) violates schema constraints that change in main mid-implementation | medium | low | Idempotent seed + non-prod gate + test that runs the seed against a fresh test DB in CI. |
| Live portal smoke-test (Phase 11) reveals D-defect terms in worker UI traceable to projection-service output (not this BI's code) | medium | medium | Per Dale's spec, fix the upstream. File a follow-on bug on BI-3E8D2CF5 with the specific term + source; gate this BI's merge on the projection fix. |

## Rollback

Each phase is additive and reverts cleanly:

- Phase 1 (manifest scaffold) — delete the contribution file + barrel re-export. Registry returns to empty.
- Phase 2 (page wiring) — revert the `page.tsx` branch to the substrate's pre-Phase-2 single-render. The contribution stays registered but doesn't render.
- Phases 3–8 (slots) — each slot's component descriptor can be reverted to a stub without affecting other slots. The slot covenant validator still passes as long as the three covenant slots have descriptors.
- Phase 9 (fixture) — delete the seed module + route. No data changes (the seed is additive and gated).
- Phase 10 (assertion) — delete the test file. Removes the audience-boundary safety net; don't do this unless replacing with equivalent coverage.
- Phase 11 (PR) — PR-level revert reinstates substrate-only state.

The only schema change anywhere in this plan is at the row-data level (the Phase 9 fixture rows). There is no migration; rollback at the schema level is N/A.

## Open questions for the design pass

The Dale visual spec already pre-decided three design questions (technician lanes on tablet, customer map on mobile, truck stock layout). This plan inherits those defaults. Two new questions surface at the implementation level and need design-pass decisions:

1. **Worker-mode shell-chrome switch — same PR or separate BI?** This plan recommends "same PR if feasible; separate BI if not." The decision affects Phase 2's scope.
2. **HVAC fixture seed — admin-driven button or setup-step auto-seed?** This plan recommends "admin-driven dev-route" (Phase 9). Auto-seeding on every fresh HVAC install would pollute production-shaped Dale installs with synthetic data.

If the design pass rejects either default, document the alternative + evidence in the design-pass PR that overrides this plan, then update the affected phase here in the same PR.

## What's explicitly NOT in this plan

- **Implementation of the projection service (BI-3E8D2CF5)** — its own plan; this plan depends on its existence.
- **Implementation of the primitive library (BI-5B8FE5C1)** — its own plan.
- **Other vertical archetype homes** (clinic, retail, MSP, training) — separate BIs; this plan establishes the contribution pattern they'll mirror.
- **Schema migrations** — Dale's home reads existing schema (`WorkItem`, `CalendarEvent`, `CustomerConfigurationItem`, `CommunicationDeliveryAttempt`, `WorkSchedule`); no new tables.
- **New navigation entries** — `/workspace` is the existing route; no route additions.
