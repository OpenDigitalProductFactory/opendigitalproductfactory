---
title: Workspace-home primitive registry — implementation plan (11 primitives + typed contract + component-registry render boundary)
date: 2026-06-04
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-5B8FE5C1
epic: EP-REDUCTION-GEAR-ARCH
implements:
  - docs/superpowers/specs/2026-05-24-workspace-home-primitive-registry-design.md (primitive registry spec — typed contract + 11 per-primitive specs)
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5 (parent substrate spec — primitive list, slot covenant, component registry pattern)
upstream-deps:
  - BI-1CCC6264 (substrate) — DONE, on main (PR #1237)
  - BI-3E8D2CF5 (projection service) — SPEC ONLY in [PR #1452](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1452); implementation not started
related:
  - PR #1438 (architect amendments — primaryOperatingQuestion + zone) — merged
  - PR #1439 (unconfigured-archetype telemetry) — merged
  - PR #1442 (HVAC dispatcher implementation plan) — open
  - PR #1452 (projection-service spec) — open
---

# Workspace-home primitive registry — implementation plan

## Anchor

This plan implements **[BI-5B8FE5C1](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues?q=BI-5B8FE5C1)** — *Vertical workspace primitive library — queues, maps, health, capacity, inventory, and case boards*. Its acceptance criteria are this plan's definition of done:

- Each primitive has a clear purpose, vertical-native labels, canonical data dependencies, interaction expectations, mobile behavior, and setup-activation metadata.
- Queue + map primitives support service-business workflows; health/status primitives support MSP/customer-estate workflows.
- Business-archetype setup can report which primitive widgets will activate for exact/category workspace homes and what data is missing before a worker sees the home.
- Vertical implementation BIs can compose primitives by manifest, vocabulary, data binding, and layout without manually wiring dashboard tiles after setup.
- No worker-facing primitive exposes gear / ring / torque / slip / cockpit terminology.
- The result updates or extends the vertical workspace home spec before broad implementation begins.

The primitive registry spec ([`2026-05-24-workspace-home-primitive-registry-design.md`](../specs/2026-05-24-workspace-home-primitive-registry-design.md)) is the design contract; the parent vertical workspace home spec ([`2026-05-24-vertical-workspace-home-design.md`](../specs/2026-05-24-vertical-workspace-home-design.md)) §5 is the substrate-boundary contract. This plan does not re-litigate them; it sequences the implementation.

## Phase 0 — substrate gap + sequencing

**Why this phase exists.** The substrate at BI-1CCC6264 / PR #1237 ships a **provisional** `WorkspaceHomePrimitiveKey` enum that uses different names from the spec-canonical 11 primitives. The substrate sign-off ADR explicitly documents this enum as "a boundary BI-5B8FE5C1 fills out." Phase 1 of this plan owns the rename. Without it, vertical contributions (BI-CE6AF925 HVAC home) inherit a vocabulary mismatch between the substrate type they declare against and the primitive renderers this BI ships.

**Substrate naming gap (verified against `apps/web/lib/workspace-home/types.ts` on main):**

| Substrate (provisional) | Spec-canonical |
| --- | --- |
| `today-strip` | (deprecated — folds into `decision-queue` semantics) |
| `service-queue` | `decision-queue` |
| `customer-map` | `geo-map` |
| `customer-health-map` | `health-board` |
| `exception-list` | (deprecated — folds into `decision-queue` semantics) |
| `coworker-handoffs` | `handoff-queue` |
| `metric-tile` | (out of scope — not in the 11; remove or move to platform-tiles) |
| `calendar` | `appointment-schedule` |
| `activity-feed` | (out of scope; remove or move to platform fallback) |
| `platform-tiles` | (substrate-fallback only; remove from primitives, keep in `PlatformWorkspaceHome`) |
| — (new) | `capacity-lanes` |
| — (new) | `inventory-watch` |
| — (new) | `case-board` |
| — (new) | `service-period-board` |
| — (new) | `communication-exceptions` |
| — (new) | `volunteer-program-board` |

Phase 1 lands the rename. Phases 2–7 implement against the spec-canonical names.

**Deliverable.** Confirm before any code is written:

1. `BI-1CCC6264` is `done` on main. ✅ (PR #1237 merged 2026-05-27.)
2. The primitive registry spec at [`docs/superpowers/specs/2026-05-24-workspace-home-primitive-registry-design.md`](../specs/2026-05-24-workspace-home-primitive-registry-design.md) is on main. ✅ (PR #1232 merged.)
3. The projection-service spec at [`docs/superpowers/specs/2026-06-04-vertical-workspace-home-projections-design.md`](../specs/2026-06-04-vertical-workspace-home-projections-design.md) is at least pending review (PR #1452). The primitive's `dataContract.acceptedLoaders` and `acceptedSignals` fields are defined against types from that spec; if the projection-service signal type or loader-id naming changes during review, Phase 3+ must reflect those changes.
4. No in-flight worktree is implementing BI-5B8FE5C1. Quick check via `git worktree list | grep primitive` and `gh pr list --search "primitive"`. The `D:/DPF/.claude/worktrees/interesting-cori-09ccd1` worktree was at `8ea7ee0d` (the spec commit) and has not progressed; safe to start.

**Verification.** Substrate primitive-key audit script: a one-time grep across `apps/web/components/` and `apps/web/lib/workspace-home/contributions/` (none exist yet) confirms no caller has cemented the provisional naming. If a caller exists, document it as a Phase 1 rename target.

## Phase 1 — substrate primitive-key rename to spec-canonical naming

**Goal.** Replace the provisional `WorkspaceHomePrimitiveKey` enum in `apps/web/lib/workspace-home/types.ts` with the 11 spec-canonical keys + retire the substrate-fallback-only keys to the platform path. The rename is the boundary the entire Phase 2+ build composes against.

**Files.**
- `apps/web/lib/workspace-home/types.ts` — modify. Replace the `WorkspaceHomePrimitiveKey` union with:
  ```ts
  export type WorkspaceHomePrimitiveKey =
    | "decision-queue"
    | "geo-map"
    | "capacity-lanes"
    | "health-board"
    | "inventory-watch"
    | "case-board"
    | "service-period-board"
    | "communication-exceptions"
    | "handoff-queue"
    | "appointment-schedule"
    | "volunteer-program-board";
  ```
- Search for any consumer of the old `WorkspaceHomePrimitiveKey` values: `git grep -E '"(today-strip|service-queue|customer-map|customer-health-map|exception-list|coworker-handoffs|metric-tile|calendar|activity-feed|platform-tiles)"' -- apps/web/`. Each hit either uses a value that maps to a new name (translate) or uses one of the to-be-deprecated keys (`today-strip`, `exception-list`, `metric-tile`, `activity-feed`, `platform-tiles`). Translate or remove per the Phase 0 mapping table.
- `apps/web/lib/workspace-home/registry.ts` — modify. The `WORKSPACE_HOME_COMPONENT_KEYS` set ships a parallel "component key" enum (`"today-now-strip"`, `"service-queue"`, etc.). Update to a spec-canonical default set: `"today-strip"`, `"jobs-queue"`, `"customer-map"`, `"customer-health"`, `"exception-queue"`, `"coworker-handoff-list"`, `"metric-tile"`, `"calendar-panel"`, `"activity-feed-panel"`, `"platform-tile-grid"` → replace with spec-canonical component keys derived from each primitive's renderer name in Phase 3-6. Each primitive's "concrete renderer" is its `WorkspaceHomeComponentKey`; primitive-key and component-key remain distinct (per parent spec §5.5).
- `apps/web/lib/workspace-home/types.ts` — modify the `WorkspaceHomeComponentKey` union as well. (The parent spec §5.5 distinguishes primitives — families of widgets — from components — concrete renderers. A primitive may have multiple component-key implementations across archetypes.)
- `apps/web/lib/workspace-home/registry.test.ts` + `activation-summary.test.ts` — modify. The test fixtures currently use `"service-queue"`, `"customer-map"`, `"coworker-handoffs"`, etc. Update them to use the spec-canonical names (`"decision-queue"`, `"geo-map"`, `"handoff-queue"`). The tests assert the slot covenant; they don't care about specific primitive values, but the typing must hold.
- `apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx` — same fixture update.
- `apps/web/components/storefront-admin/SetupWizard.tsx` — same fixture update (inline summary for custom archetype).

**Verification.**
- `pnpm --filter web typecheck` green.
- `pnpm --filter web exec vitest run lib/workspace-home components/workspace-home components/storefront-admin/ArchetypeActivationSummary 'app/(shell)/workspace'` — all green. Slot covenant + unconfigured fallback + activation summary tests still pass.
- Run full `pnpm --filter web exec vitest run` — no regressions in unrelated test suites that might import the substrate type.
- `pnpm --filter web build` — green, no new Turbopack warnings owned by substrate code.

**Rollback.** Revert the type union changes; the substrate returns to its provisional enum. Phase 2+ stays paused. No data changes; no schema changes.

## Phase 2 — typed `WorkspaceHomePrimitiveSpec` + `WorkspaceHomePrimitiveRegistry`

**Goal.** Land the typed contract from spec §5. No primitive renderers yet — just the type contract + the empty registry surface that Phases 3-6 fill.

**Files.**
- `apps/web/lib/workspace-home/primitives/primitive-spec.ts` — new. Export `WorkspaceHomePrimitiveSpec` type (verbatim from spec §5) + `WorkspaceHomePrimitiveRegistry` type. Export utility predicates: `isWorkspaceHomePrimitiveKey(value)`, `getPrimitiveSpec(registry, key)`, `getPrimitivesForCategory(registry, category)`.
- `apps/web/lib/workspace-home/primitives/registry.ts` — new. Exports an `emptyWorkspaceHomePrimitiveRegistry()` factory + a `defaultWorkspaceHomePrimitiveRegistry` singleton (initially empty). Phases 3-6 register against the singleton.
- `apps/web/lib/workspace-home/primitives/index.ts` — new barrel.
- `apps/web/lib/workspace-home/index.ts` — modify. Re-export the primitives barrel.
- `apps/web/lib/workspace-home/primitives/primitive-spec.test.ts` — new. Asserts the type contract:
  - Every entry of `WorkspaceHomePrimitiveKey` MUST exist in a registered registry by the end of the plan (this test is initially permissive; tightens in Phase 7).
  - The slot covenant test from `registry.test.ts` validates against the spec-canonical primitive keys (no more `"service-queue"`-as-canonical references in fixtures).
  - The Phase 2 test asserts only the type-system contract; per-primitive content tests land in Phase 3-6.

**Verification.**
- typecheck green.
- `pnpm --filter web exec vitest run lib/workspace-home/primitives` — Phase 2 contract tests pass.
- No build regression.

**Rollback.** Delete the new primitives directory + barrel re-export. Substrate retains the spec-canonical enum from Phase 1 but has no registry yet.

## Phase 3 — Queue family: `decision-queue` + `handoff-queue` + `communication-exceptions`

**Goal.** Implement the three queue-family primitives. Powers three of Dale HVAC's six slots (per the Dale visual spec §primitive-to-slot table): jobs-needing-attention, coworker-handoffs, customer-update failures.

**Depends on.** Phase 2 + a working `projection-service` shim for testing (it can be the spec's `translateGearInterfaceProjection`-style pure function with hand-coded seeds; the real projection-service implementation lands separately and the primitive code consumes its public surface).

**Files.**
- `apps/web/lib/workspace-home/primitives/queues/decision-queue.spec.ts` — new. Exports the `WorkspaceHomePrimitiveSpec` literal for `decision-queue` per primitive-registry spec §6.1.
- `apps/web/lib/workspace-home/primitives/queues/handoff-queue.spec.ts` — new. Per spec §6.9.
- `apps/web/lib/workspace-home/primitives/queues/communication-exceptions.spec.ts` — new. Per spec §6.8.
- `apps/web/components/workspace-home/primitives/DecisionQueue.tsx` — new. Renders the `decision-queue` primitive. Reads the `WorkspaceHomeSignal[]` for its slot from the projection service (parent spec §5.7). Density per spec §6.1 (`col-span 6`, `row-span 2`, `min-width 360px`). States: empty "all caught up", loading skeleton (3 rows), stale 60s, misconfigured.
- `apps/web/components/workspace-home/primitives/HandoffQueue.tsx` — new. Per spec §6.9.
- `apps/web/components/workspace-home/primitives/CommunicationExceptions.tsx` — new. Per spec §6.8.
- `apps/web/lib/workspace-home/primitives/queues/index.ts` + barrel registration on the singleton.
- Tests: one `.test.tsx` per renderer + one `.test.ts` per spec literal. Each test fixture-renders the empty / loading / stale / misconfigured / populated states; asserts vocabulary substitution; asserts NO banned tokens in any rendered surface.

**Verification.**
- `pnpm --filter web exec vitest run lib/workspace-home/primitives/queues components/workspace-home/primitives` — all green.
- Banned-copy assertion runs across all three primitives' rendered HTML against the parent spec §10 token list (`/\b(gear|ring|torque|slip|wear|triple|shaft|calibration|cockpit)\b/i`).
- Static-analysis test (Phase 8 candidate, can land here as a smoke check): no primitive component imports from `apps/web/lib/gear-interface/`. The projection-service module is the only allowed source for translated signal data.

**Rollback.** Delete the queue-family primitives + their barrel registration. The registry returns to "empty queue family"; spec-canonical primitive keys remain in the substrate enum but unrendered.

## Phase 4 — Map + Capacity: `geo-map` + `capacity-lanes`

**Goal.** Implement the two remaining primitives Dale HVAC needs. After Phase 4, **Dale's six slots are all covered by registered primitives** — five of six (queue + map + capacity + handoff + communication) come from Phases 3-4; the sixth (inventory-watch from Phase 5) is the only remaining gap for Dale.

**Depends on.** Phase 2 + a map widget library decision (the Dale visual spec defers this to "Mapbox vs. Leaflet vs. simple SVG"; this plan's default is **Leaflet**, see §Open Questions below).

**Files.**
- `apps/web/lib/workspace-home/primitives/geo/geo-map.spec.ts` — new. Per spec §6.2.
- `apps/web/lib/workspace-home/primitives/capacity/capacity-lanes.spec.ts` — new. Per spec §6.3.
- `apps/web/components/workspace-home/primitives/GeoMap.tsx` — new. Renders with Leaflet + OSM tiles (free, no API key, respects DPF self-hosted ethos). The map slot must remain functional with the map disabled — per Dale spec accessibility floor, critical state is reachable via the row list beside the map. Tile loading uses skeleton state; route-risk overlay reads from the `route-plan` loader.
- `apps/web/components/workspace-home/primitives/CapacityLanes.tsx` — new. Horizontal scroll on tablet (per Dale spec architect default #1); per-lane load meter + current/next job card.
- Tests: per-renderer + per-spec-literal as in Phase 3. Map-disabled accessibility check is its own test.

**Verification.**
- targeted vitest green.
- Build green; `next.config.mjs` may need a `transpilePackages` entry for Leaflet (verify at impl time).
- Banned-copy assertion across both primitives.
- Accessibility floor: `CapacityLanes` lane labels reachable via keyboard tab; `GeoMap` row list accessible when map renderer is forced disabled.

**Rollback.** Delete the map + capacity primitives. Dale's home is still possible to render with empty placeholder slots for those two; the rest of the queue/handoff/communication slots from Phase 3 still work.

## Phase 5 — Inventory + Case: `inventory-watch` + `case-board`

**Goal.** Implement the two primitives that unblock the rest of Dale's home (inventory-watch for truck stock) + the first non-HVAC use cases (case-board for legal / animal-rescue / tutoring / residential-mgmt).

**Files.** Pattern follows Phases 3-4: `apps/web/lib/workspace-home/primitives/inventory/inventory-watch.spec.ts`, `apps/web/lib/workspace-home/primitives/cases/case-board.spec.ts`, `apps/web/components/workspace-home/primitives/InventoryWatch.tsx`, `apps/web/components/workspace-home/primitives/CaseBoard.tsx`, tests, barrel registration.

**Special considerations.**
- `inventory-watch.spec.ts` has `rendersWhenEmpty: true` (per spec §6.5 — "everything is stocked" is a positive state). The renderer must distinguish "stocked OK" empty from "loader misconfigured" empty.
- `case-board.spec.ts` similarly has `rendersWhenEmpty: true` (per §6.6).
- The case-board renderer supports a "stage" dimension (per spec §6.6 actions `change-stage`); the renderer accepts an optional vocabulary-substitution for stage labels (e.g. `legal`: "intake → discovery → trial"; `animal-rescue`: "intake → medical → fostering → adopted").

**Verification.** As in Phases 3-4. Add a "stocked positive" empty-state assertion specific to inventory-watch.

**Rollback.** As in Phase 4.

## Phase 6 — Period + Schedule + Volunteer + Health: complete the registry

**Goal.** Implement the four remaining primitives (`service-period-board`, `appointment-schedule`, `volunteer-program-board`, `health-board`) so the registry is fully populated. These primitives are NOT used by Dale's home but are required by:
- Restaurant / bakery / catering / event-production (service-period-board).
- Clinic / classes / studios (appointment-schedule).
- Non-profit / volunteer programs (volunteer-program-board).
- MSP / facilities / software-platform (health-board).

**Files.** Pattern as Phases 3-5.

**Verification.** As in prior phases. Each primitive's per-archetype applicability set (spec §6's `applicability.suggestedCategories`) covered by at least one fixture.

**Rollback.** As in prior phases. The registry retains primitives from Phases 3-5; this phase is additive.

## Phase 7 — `WorkspaceHomeComponentRegistry` + `VerticalWorkspaceHome` render integration

**Goal.** Wire the populated `WorkspaceHomePrimitiveRegistry` into the rendering pipeline so a `WorkspaceHomeContribution` declared with primitive keys lands at the correct renderer. This is the "fail-closed on unknown keys" pattern from parent §5.5 + primitive-registry §5.

**Files.**
- `apps/web/components/workspace-home/UnknownPrimitiveComponent.tsx` — new. The admin-visible "Slot misconfigured" placeholder for unknown component keys. Empty placeholder for non-admins per parent spec.
- `apps/web/components/workspace-home/VerticalWorkspaceHome.tsx` — new (if not already landed by the HVAC implementation under PR #1442 sequencing). Reads the contribution's `slots`, sorts by priority + architect-amendment `zone`, renders each slot through `defaultWorkspaceHomePrimitiveRegistry`. Uses the fail-closed pattern: `registry[slot.primitiveKey] ?? UnknownPrimitiveComponent`.
- `apps/web/app/(shell)/workspace/page.tsx` — modify (or rely on the HVAC plan's Phase 2 to land this). The `if (resolution.mode === "vertical")` branch must dispatch to `VerticalWorkspaceHome` and pass the registered registry.
- `apps/web/components/workspace-home/VerticalWorkspaceHome.test.tsx` — new. Renders a synthetic 6-slot fixture using the full registry from Phases 3-6. Asserts every slot renders via the correct primitive renderer (not the `UnknownPrimitiveComponent`); asserts unknown primitive key correctly falls back; asserts banned-copy assertion over the full HTML.
- Coordinate with PR #1442 (HVAC plan Phase 2) so the substrate-side `VerticalWorkspaceHome` is implemented once, not twice. The plan defers to whichever PR lands first; the second PR consumes the existing component.

**Verification.**
- Full vitest green.
- Build green.
- The substrate's `WorkspaceHomeContribution` types continue to satisfy the slot covenant validator; the spec covenant tests pass.

**Rollback.** Revert the integration in `page.tsx` to keep rendering `PlatformWorkspaceHome` as fallback regardless of `resolution.mode`. The primitives stay registered but unrendered until a downstream BI re-wires.

## Phase 8 — Static-analysis tests: banned-imports + banned-copy union

**Goal.** Lock in the substrate firewall + banned-copy guarantee at the test layer so future contributors can't accidentally regress.

**Files.**
- `apps/web/lib/workspace-home/primitives/banned-imports.test.ts` — new. Walks every `.tsx` under `apps/web/components/workspace-home/`; reads each file's import declarations; asserts NO import path starts with `apps/web/lib/gear-interface/` (or the `@/lib/gear-interface/` alias). The projection service is the only legal data path from gear-interface to workspace-home UI.
- `apps/web/lib/workspace-home/primitives/banned-copy.test.tsx` — new. Renders each primitive in its populated state with a synthetic vocabulary substitution and asserts the rendered HTML contains NO banned token (parent spec §10 list). Also asserts NO D-defect terms (tool names, MCP names, `BI-` codes, FeatureBuild ids) appear.
- `apps/web/lib/workspace-home/primitives/primitive-spec.test.ts` — modify. Tighten the Phase 2 permissive assertion: every `WorkspaceHomePrimitiveKey` MUST be present in `defaultWorkspaceHomePrimitiveRegistry` (no orphan keys after Phase 6).

**Verification.** All three tests green.

**Rollback.** Delete the test files. Lose the safety net; don't.

## Phase 9 — Sign-off ADR + PR

**Goal.** Functional verification on the Live portal (against the projection-service implementation if it landed in parallel; against a synthetic fixture loader if not), sign-off ADR, scoped PR open against `main`.

**Pre-conditions.**
- Phases 1-8 complete locally.
- `pnpm --filter web typecheck` + targeted vitest + full vitest + production build all green.
- Sweep `gh pr list --state open` against `primitive OR workspace-home OR 5B8FE5C1` to catch concurrent overlap.

**Files.**
- `docs/superpowers/decisions/YYYY-MM-DD-workspace-home-primitive-registry-signoff.md` — sign-off ADR mapping BI acceptance criteria to evidence (test paths + UX evidence dir + standing-rules audit + audience-boundary scan), following the substrate ADR precedent at `docs/superpowers/decisions/2026-05-26-vertical-workspace-home-substrate-signoff.md`.
- `docs/superpowers/evidence/YYYY-MM-DD-workspace-home-primitive-registry/dynamic-analysis.md` — prose findings per `feedback_dynamic_analysis_is_evidence`. If the HVAC home (PR #1442 → BI-CE6AF925 implementation) is also landing, run them side-by-side and capture both. If not, drive a synthetic-fixture install that loads a stub contribution registering each primitive in turn; observe each primitive rendering correctly with vocabulary substitution.

**Verification matrix in the PR body.**

| Gate | Expected |
|---|---|
| `pnpm --filter web typecheck` | green |
| Targeted vitest | all green, including Phase 8 banned-imports + banned-copy union |
| Full web vitest | green, no new regressions |
| Production build | green, zero new substrate-owned warnings |
| UX evidence | desktop + mobile drive of each primitive in its populated + empty + stale + misconfigured states (sample-archetype-driven, doesn't require Dale's HVAC fixture to land first) |
| Audience boundary | banned-imports test green; banned-copy union assertion green |
| DCO sign-off | every commit |
| Overlap sweep | clean at push time |

**Verification.** PR opened, CI green, sign-off ADR + evidence dir linked, merge by reviewer.

**Rollback.** PR-level revert. All phases are additive (new types, new components, new tests); reverting the merge reinstates the substrate-only state. The substrate's spec-canonical primitive enum from Phase 1 stays — it's a corrective rename, not a feature.

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| Phase 1 substrate rename breaks downstream consumers we didn't expect | medium | medium | Phase 0 grep audit catches them; the substrate enum is barely 2 weeks old so consumer surface is small. Worst case: include consumers in the same PR. |
| Phase 4 map library choice (Leaflet) introduces a Turbopack build issue | medium | low | Architect default; can swap to `react-leaflet` or a simple SVG fallback. The `GeoMap` primitive spec mandates a row-list accessibility floor so the map renderer itself isn't load-bearing. |
| Projection-service spec (PR #1452) changes during review and primitive `dataContract` fields drift | medium | medium | Phase 0 dependency check notes the open spec. If PR #1452 changes the signal type or loader-id naming during review, Phase 3+ rebases the affected `dataContract` declarations in a single commit. |
| Phase 7 wiring collides with the HVAC plan's Phase 2 (PR #1442) which also lands `VerticalWorkspaceHome` | high | low | Whichever lands first wins; the second PR consumes the existing component. Coordinate via PR descriptions referencing each other. |
| Per-primitive spec literals drift from the spec doc during implementation | medium | low | Each `.spec.ts` literal cross-references the spec section heading in a JSDoc comment + a vitest assertion compares declared field values against the spec text where machine-readable. |
| Banned-copy test catches a leak from vocabulary substitution that the contribution didn't fix | medium | medium | Phase 8 banned-copy test surfaces this at primitive build time, not at contribution build time. The contribution's vocabulary block is required to provide all expected tokens; missing tokens → primitive emits a `[primitive-vocabulary-gap]` warning + falls back to generic worker-phrase. |
| Concurrent session lands an overlapping primitive renderer (e.g. someone starts BI-CE6AF925 HVAC and writes a `JobsQueue` inline) | low | low | `feedback_continuous_overlap_check`: sweep `gh pr list` before every push. PR #1442 (HVAC plan) explicitly defers slot rendering to this BI per its Phase 0. |

## Rollback

Each phase is additive and reverts cleanly:

- Phase 1 (rename) — revert types.ts changes; substrate returns to provisional enum. Existing fixtures revert to the substrate-shipped values.
- Phase 2 (typed registry) — delete the primitives directory + barrel re-export.
- Phases 3-6 (per-family primitives) — delete each family directory + remove barrel registration. The registry returns to "empty family" but the type contract remains.
- Phase 7 (component-registry render integration) — revert `page.tsx` to the substrate's pre-render-integration single-branch render. Primitives stay registered but unrendered.
- Phase 8 (static-analysis tests) — delete the test files. Lose the safety net (don't).
- Phase 9 (PR) — PR-level revert. All prior phases revert with the PR.

There are no schema changes anywhere in this plan. Rollback at the data-layer is N/A.

## Open questions for the design pass

The primitive registry spec at §6 pre-decided per-primitive defaults (density, states, actions, applicability). This plan inherits those. The following implementation-level questions need design-pass decisions:

1. **Map widget library (Phase 4).** Plan default: **Leaflet + OSM tiles** (no API key, self-hosted-friendly, transparent licensing). Alternatives: Mapbox (commercial; needs an access token; faster vector tiles); pure SVG bounding box (no real-world geography; trivial; ugly). If the design pass picks Mapbox, add token-provisioning to setup; the primitive's accessibility-floor row-list requirement stands regardless.
2. **Component-registry barrel: per-family file or single index file?** Plan default: **per-family barrel files** (`primitives/queues/index.ts`, `primitives/geo/index.ts`, etc.) + a top-level `primitives/index.ts` that composes them. This makes Phase 3-6 git history bisectable by primitive family. Alternative: single barrel at `primitives/index.ts` referenced by everyone — simpler at the surface but worse for incremental phase development.
3. **Phase 7 component split: does `VerticalWorkspaceHome` belong in this BI or the HVAC BI?** Plan default: **whichever PR lands first owns it.** Both BIs need it; both BIs benefit from it. Coordinate via PR cross-reference. If both PRs are about to land in the same window, file a quick coordination evidence row on both BIs naming the chosen owner.
4. **Phase 9 UX verification: synthetic-fixture install or wait for Dale's HVAC fixture?** Plan default: **synthetic-fixture install** (a stub contribution registering each primitive with placeholder vocabulary + a synthetic loader returning sample data). Doesn't require BI-CE6AF925 to ship first. If Dale's HVAC home is also landing, run both side-by-side and capture in the same evidence dir.

If the design pass rejects any default, document the alternative + evidence in the PR that overrides this plan; update the affected phase here in the same commit.

## What's explicitly NOT in this plan

- **Implementation of the projection service (BI-3E8D2CF5)** — its own plan; this plan depends on its public surface but does not implement it. The primitive code consumes pure translator functions or shimmed equivalents until BI-3E8D2CF5 lands.
- **HVAC dispatcher contribution (BI-CE6AF925)** — its own plan ([PR #1442](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1442)) sequences the contribution composition; this plan provides the renderers it consumes.
- **Other vertical archetype contributions** (clinic, retail, MSP, training) — separate BIs; this plan establishes the primitive surface they'll compose against.
- **Schema migrations** — none. Primitives read from existing canonical records via the projection service.
- **New routes or navigation entries** — none. `/workspace` is the consumer; this BI doesn't add routes.
- **Cockpit / admin diagnostic surfaces** — BI-19D40BE7 territory; the primitives are worker-facing only. Admin "Slot misconfigured" placeholders surface to admins but the primitive itself doesn't render an admin diagnostic dashboard.

## Definition of done

This plan is "done" when:

1. Phases 1-9 ship via a single PR (or a chained series — Phase 1 + Phase 2 + Phases 3-6 can land as separate PRs if the substrate rename in Phase 1 lands first, but the typed registry + at least one primitive family must land together to validate the contract end-to-end).
2. All 11 primitive keys are registered in `defaultWorkspaceHomePrimitiveRegistry`.
3. The banned-imports test + banned-copy union test are green and run on CI.
4. The sign-off ADR maps each BI acceptance criterion to its evidence path.
5. The Phase 7 integration is verified — a synthetic or real contribution renders through the registry and falls back to `UnknownPrimitiveComponent` on unknown keys without throwing.
6. The Dale HVAC home (PR #1442 → BI-CE6AF925 implementation) consumes this registry without inline-inventing a single primitive — confirmed by a grep over the HVAC contribution code looking for inline component definitions outside the primitive registry.
