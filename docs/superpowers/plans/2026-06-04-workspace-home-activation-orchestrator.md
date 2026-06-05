---
title: Archetype-driven workspace-home setup activation orchestrator — implementation plan
date: 2026-06-04
status: proposal — awaiting operator review
owner: Mark Bodman (CEO) — proposed by agent
backlog-item: BI-B14D6CF6
epic: EP-REDUCTION-GEAR-ARCH
implements:
  - docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5.5 ("setup can create setup tasks, seed safe demo records in test installs, or show honest empty states")
  - docs/superpowers/specs/2026-06-04-workspace-home-contribution-roster-design.md §9.1 (PR #1462 — names this BI as the cross-cutting orchestrator)
upstream-deps:
  - BI-1CCC6264 (substrate) — DONE, on main
  - BI-5B8FE5C1 Phase 1 (substrate primitive-key rename) — DONE, on main (PR #1456)
  - BI-3E8D2CF5 (projection service) — SPEC ONLY in PR #1452; impl not started but the spec's translateXProjection signatures are stable enough to bind against
related:
  - BI-CE6AF925 HVAC plan (PR #1442) — Phase 9 simplifies under this orchestrator
  - 8 category-level BIs filed 2026-06-04: BI-1F7731E5, BI-FE74CD4A, BI-25AFC2BC, BI-CB8EE2D0, BI-336FC845, BI-ED0153CA, BI-204CE2D6, BI-FA3294E0
  - 4 pre-existing category-level BIs: BI-EF03E915, BI-43A682A2, BI-96A3C7A9, BI-02845133
  - BI-FE002675 MSP exact-archetype BI
---

# Workspace-home setup activation orchestrator — implementation plan

## Anchor

This plan implements **[BI-B14D6CF6](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues?q=BI-B14D6CF6)** — *Archetype-driven workspace-home setup activation orchestrator*. The BI's operator-stated principle is the plan's definition of done:

> "These differences are installed / established when the archetypes are chosen. The portal configuration needs to follow the needs of these business archetypes with little effort." — Mark Bodman, 2026-06-04

Universal across all archetypes (HVAC is one of many). Continuous tracking, not one-shot at selection. Declaration-driven so every category-level + exact-archetype contribution flows through the same code path.

## Phase 0 — substrate + upstream check

**Why this phase exists.** The orchestrator consumes `WorkspaceHomeContribution.setupActivation` declarations and binds the projection service's loaders. It needs both surfaces stable enough to commit against. The primitive registry (BI-5B8FE5C1) post-Phase-1 supplies the typed primitive-key set; the projection-service spec (PR #1452) supplies the `translateGearInterfaceProjection` / `translateCalibratorProjection` / `translateGovernorProjection` function signatures the orchestrator binds.

**Deliverable.** Confirm before Phase 1:

1. Substrate `WorkspaceHomeContribution.setupActivation` type on main carries the architect-amendment fields (`requiredCanonicalData`, `requiredSignals`, `missingDataBehavior`, `primitiveWidgets`, `status`). ✅ verified on main (substrate types post-rename).
2. The existing storefront activation pipeline at `apps/web/app/api/storefront/admin/setup/route.ts` is the integration point. Verified: creates `StorefrontConfig` + sections + items + applies business-capability perspective. Does NOT yet call any workspace-home orchestration. Phase 7 plugs in here.
3. The projection-service spec at `docs/superpowers/specs/2026-06-04-vertical-workspace-home-projections-design.md` (PR #1452) has settled `WorkspaceHomeSignal` + the three `translateXProjection` function signatures. Even if the impl hasn't shipped, the orchestrator binds against the spec's declared surface; rebases against impl drift cheaply.
4. The substrate's `defaultWorkspaceHomeRegistry` is empty (no concrete contributions registered) — so Phase 7 integration can land without any vertical home rendering changes today; the orchestrator simply has no-op cases until contributions land.

**Verification.** Read-only grep audit confirms `apps/web/app/api/storefront/admin/setup/route.ts` does not call any workspace-home code; the integration is a clean extension.

## Phase 1 — declarations walker

**Goal.** Pure function that takes a resolved `WorkspaceHomeContribution` + install context and emits a structured *activation plan*: which canonical data declarations are satisfied, which are missing, which signals need binding, which slots need empty-state coordination.

**Files.**
- `apps/web/lib/workspace-home/activation-orchestrator/types.ts` — new. Exports:
  ```ts
  export type ActivationPlan = {
    contributionId: string;
    archetypeContext: string;
    canonicalData: Array<{
      key: string;
      satisfied: boolean;
      sample: { tableName?: string; expectedMin: number; observed: number } | null;
    }>;
    signals: Array<{
      kind: string;
      loaderId: string | null;        // null when the projection service has no loader for this kind
      bound: boolean;
    }>;
    slotBehaviors: Array<{
      slotId: string;
      missingDataBehavior: "render-empty-state" | "platform-fallback" | "hide-widget";
      hasData: boolean;
    }>;
  };
  ```
- `apps/web/lib/workspace-home/activation-orchestrator/walker.ts` — new. Exports:
  ```ts
  export async function buildActivationPlan(input: {
    contribution: WorkspaceHomeContribution;
    archetypeContext: string;
    prisma: PrismaClient;
  }): Promise<ActivationPlan>;
  ```
  Pure-ish: reads from prisma but emits no side effects. Maps each `requiredCanonicalData` entry to a row-count check against the right table (HVAC's `work-item` → `prisma.workItem.count({where: { sourceType: "field-service-job" }})`); maps each `requiredSignals` entry to the projection-service's signal-kind registry. The mapping from declaration key → table is encoded in a small lookup module:
- `apps/web/lib/workspace-home/activation-orchestrator/canonical-data-registry.ts` — new. Maps `requiredCanonicalData` keys to Prisma queries that count satisfying rows. Initially covers the keys the HVAC / dental / restaurant proving installs declare; extensible as new contributions land.
- `apps/web/lib/workspace-home/activation-orchestrator/signal-registry.ts` — new. Maps `requiredSignals` keys to the projection-service's loader IDs (e.g. `"governor-require-hitl"` → `translateGovernorProjection` with verdict filter). Reads against the PR #1452 spec surface; rebases against impl when it lands.

**Verification.**
- Unit test for `buildActivationPlan` against a fixture contribution (HVAC-shaped: requires `work-item`, `calendar-event`, `customer-account`, signals `governor-require-hitl` + `communication-failed`) with two install scenarios: fully-populated (plan shows all satisfied) and empty (plan shows all missing).
- Test the canonical-data-registry covers every declaration key used by HVAC + at least one non-HVAC archetype shape (dental's `appointment` for example) — when a contribution declares an unknown key, walker returns `satisfied: false, sample: null` and logs `[orchestrator-unknown-canonical-data]` so the gap surfaces.
- No prisma writes anywhere; verified by mock-prisma assertion.

**Rollback.** Delete the new directory. Substrate behavior unaffected (orchestrator isn't wired in yet).

## Phase 2 — setup task generator

**Goal.** Reads an `ActivationPlan`, emits `PlatformNotification`-style setup tasks (or `WorkItem` rows — verify substrate at impl time) for each unsatisfied canonical-data declaration. Each task names the missing requirement, links to the right admin surface, and tags itself for archetype-aware grouping so the admin UX can present them coherently.

**Depends on.** Phase 1.

**Files.**
- `apps/web/lib/workspace-home/activation-orchestrator/setup-tasks.ts` — new. Exports:
  ```ts
  export async function emitSetupTasksForActivationPlan(input: {
    plan: ActivationPlan;
    prisma: PrismaClient;
    organizationId: string;
  }): Promise<{ created: number; skipped: number }>;
  ```
  - Idempotent: queries existing setup tasks by `archetypeContext + contributionId + dataKey` before creating; skips if already open.
  - Each task carries: title (e.g. "HVAC dispatcher home needs at least one technician schedule — open Settings → People"), body (worker-vocabulary explanation of why this matters), `actionHref` to the right admin surface, severity per the contribution's `missingDataBehavior` (`platform-fallback` = `info`, `render-empty-state` = `warning`, `hide-widget` = `info`).
  - On `signals` entries where `loaderId: null`: emits a single setup task pointing at `BI-3E8D2CF5` (projection-service impl not landed yet for this signal kind). Telemetry counter `dpf_workspace_home_orchestrator_signal_gap_total` increments. Per Mark's principle: surface the gap; don't hide it.
- `apps/web/lib/workspace-home/activation-orchestrator/admin-surface-map.ts` — new. Maps canonical-data keys to admin URLs (e.g. `"work-schedule"` → `/storefront/team`, `"customer-account"` → `/customer`). Mirror of the canonical-data-registry; both extend together.

**Verification.**
- Unit test: plan with 3 missing declarations emits 3 tasks; running again emits 0 (idempotent).
- Unit test: plan with a signal that has no projection-service loader emits 1 BI-3E8D2CF5 pointer task + counter incremented.
- Unit test: re-running after a previously-missing declaration is now satisfied closes the corresponding task (declaration-driven reconciliation, not stale).
- Banned-copy assertion on every emitted task title + body.

**Rollback.** Delete the module + admin-surface-map. Activation plan stops emitting tasks; plan output still usable for the empty-state coordinator (Phase 4).

## Phase 3 — signal-loader binder

**Goal.** When a contribution's `requiredSignals` map to projection-service loaders, the orchestrator wires the binding so the UI components receive the signal stream without per-slot wiring code. The binding lives in a per-request signal-stream cache keyed by `(archetypeContext, contributionId, slotId)`.

**Depends on.** Phase 1 + the projection-service spec (PR #1452) — signals only bind to loaders that exist. Loaders not yet implemented stay unbound; the empty-state coordinator (Phase 4) surfaces them honestly.

**Files.**
- `apps/web/lib/workspace-home/activation-orchestrator/signal-binder.ts` — new. Exports:
  ```ts
  export async function bindSignalsForActivationPlan(input: {
    plan: ActivationPlan;
    contribution: WorkspaceHomeContribution;
  }): Promise<Map<string /* slotId */, SignalStream>>;
  ```
  - Calls the projection-service's `loadWorkspaceHomeSignals` (or its substitute when the impl hasn't landed) with the contribution's archetype context + the per-slot data refs.
  - Returns a per-slot signal stream the UI consumes via context or props.
  - Per-request memoization (NOT cross-request); the projection-service's own caching guidance (§11(1) in its spec) is the boundary.
- `apps/web/components/workspace-home/SignalStreamProvider.tsx` — new. React context provider that VerticalWorkspaceHome consumes; each slot reads its signal stream from context by slotId. (Coordinates with the HVAC plan PR #1442 Phase 2 and the primitive registry plan PR #1453 Phase 7 on VerticalWorkspaceHome ownership — same first-PR-wins pattern.)

**Verification.**
- Unit test: binding a 3-slot contribution returns a 3-entry Map with the right loader-id per slot.
- Unit test: binding a contribution with a signal whose loader doesn't exist returns the slot with an empty stream + records the gap (does not throw).
- Integration test against a mocked projection service (the actual projection impl can be deferred to BI-3E8D2CF5).

**Rollback.** Delete the binder + provider. VerticalWorkspaceHome falls back to per-slot prop wiring (less elegant but functional).

## Phase 4 — empty-state coordinator

**Goal.** Drive each slot's empty-state rendering from the contribution's declared `missingDataBehavior` — `"render-empty-state"` → primitive's empty state, `"platform-fallback"` → PlatformWorkspaceHome takes the slot, `"hide-widget"` → slot omitted entirely. No per-slot hand-wiring of empty-state logic.

**Depends on.** Phases 1 + 3.

**Files.**
- `apps/web/lib/workspace-home/activation-orchestrator/slot-render-decision.ts` — new. Exports:
  ```ts
  export type SlotRenderDecision =
    | { kind: "render-with-data"; stream: SignalStream }
    | { kind: "render-empty-state" }
    | { kind: "platform-fallback"; reason: "missing-required-data" }
    | { kind: "hide-widget" };
  export function decideSlotRender(input: {
    plan: ActivationPlan;
    streams: Map<string, SignalStream>;
    slotId: string;
  }): SlotRenderDecision;
  ```
  Pure function. Reads the slot's `hasData` from the plan + the binding result; returns the decision.
- `apps/web/components/workspace-home/VerticalWorkspaceHome.tsx` — coordinates with PR #1442 / PR #1453; this phase's contribution is wiring `decideSlotRender` per slot.

**Verification.**
- Unit test: each of the 3 `missingDataBehavior` values returns the correct decision shape.
- Visual snapshot test (renderToStaticMarkup): contribution with 2 slots, one with data + one without and `missingDataBehavior: "hide-widget"`, renders only one slot.
- Banned-copy assertion on empty-state copy across all primitives.

**Rollback.** As Phase 3.

## Phase 5 — demo-data seed gate

**Goal.** On test installs only, gated by `DPF_SEED_DEMO_DATA=true` env flag, auto-seed records that satisfy the contribution's `requiredCanonicalData` declarations. Derives seed shape from the canonical-data registry — no per-archetype seed code.

**Depends on.** Phase 1 (declarations walker).

**Files.**
- `apps/web/lib/workspace-home/activation-orchestrator/demo-seed.ts` — new. Exports:
  ```ts
  export async function seedDemoDataForActivationPlan(input: {
    plan: ActivationPlan;
    prisma: PrismaClient;
    organizationId: string;
    archetypeContext: string;
  }): Promise<{ seeded: Array<{ key: string; rowsCreated: number }> }>;
  ```
  - Hard guard: throws on `NODE_ENV === "production"` unless `DPF_ALLOW_PROD_DEMO_SEED=true` (escape hatch for prod-shaped test installs).
  - For each unsatisfied canonical-data declaration: looks up the seed factory in `canonical-data-seed-registry.ts` (a sibling of canonical-data-registry.ts) and creates representative rows.
  - Idempotent: queries existing seeded rows (tagged with a `seedTag: "demo-orchestrator"` field or equivalent) before creating; skips re-seeding.
  - Tags every seeded row so a cleanup script (admin-only, future BI) can remove demo data without touching real records.
- `apps/web/lib/workspace-home/activation-orchestrator/canonical-data-seed-registry.ts` — new. Maps canonical-data keys to seed factories (e.g. `"work-schedule"` → factory that creates 4 technicians, `"work-item"` → factory that creates 7 service calls with the state mix from Dale's spec §Verification).
- `apps/web/app/api/dev/seed-demo-orchestrator/route.ts` — new dev-only POST route to manually trigger seeding; gated to HR-000 / superuser. Returns the seeded summary.

**Verification.**
- Unit test: running with `NODE_ENV === "production"` throws.
- Unit test: running twice on the same install produces the same row counts (idempotent).
- Integration test: seed → re-run activation plan → all declarations now satisfied.
- HVAC seed matches Dale's spec §Verification fixture shape (4 trucks/4 techs/7 service calls with specific state mix).

**Rollback.** Delete the seed module + route. Tagged demo rows remain until the cleanup BI ships; they're additive and gated so leaving them is safe.

## Phase 6 — reconciliation cadence

**Goal.** Continuous tracking. Light read-only check on a configurable cadence (default daily) that re-runs `buildActivationPlan` + `emitSetupTasksForActivationPlan` for the install's currently-resolved contribution. Surfaces drift (deleted data, new signal kinds) as setup tasks without destructive sync.

**Depends on.** Phases 1 + 2.

**Files.**
- `apps/web/lib/queue/functions/workspace-home-reconciliation.ts` — new. Inngest function (per existing DPF queue pattern under `apps/web/lib/queue/`) that runs daily; for each install, resolves the active contribution + calls Phases 1 + 2.
- `apps/web/lib/workspace-home/activation-orchestrator/reconciliation.ts` — new. Pure orchestration helper the Inngest function calls.

**Verification.**
- Unit test: orchestrator detects when a previously-satisfied declaration becomes unsatisfied (all rows deleted) and emits a new setup task.
- Unit test: when a contribution adds a new `requiredCanonicalData` entry (e.g. via a future architect amendment), reconciliation catches the new requirement on the next cadence.
- Integration test: full lifecycle — initial activation → satisfied → admin deletes data → reconciliation re-emits the task.

**Rollback.** Disable the Inngest function. Activation still runs at archetype selection + archetype change (Phase 7), just not on cadence.

## Phase 7 — integration into existing storefront activation pipeline

**Goal.** Wire the orchestrator into the existing setup commit path so picking an archetype triggers activation end-to-end. Same path for archetype-change.

**Files.**
- `apps/web/lib/workspace-home/activation-orchestrator/index.ts` — new top-level orchestration function:
  ```ts
  export async function activateWorkspaceHomeForArchetype(input: {
    archetypeContext: string;
    organizationId: string;
    prisma: PrismaClient;
    registry?: WorkspaceHomeRegistry;
    seedDemoData?: boolean;
  }): Promise<{
    plan: ActivationPlan;
    setupTasks: { created: number; skipped: number };
    streams: Map<string, SignalStream>;
    seeded?: Array<{ key: string; rowsCreated: number }>;
  }>;
  ```
  Composes Phases 1 + 2 + 3 + 5 in order. Returns the activation outcome for observability + UX surfaces.
- `apps/web/app/api/storefront/admin/setup/route.ts` — modify. After the existing `storefrontConfig.create` + capability perspective + design-system generation, call `activateWorkspaceHomeForArchetype`. The setup wizard's response includes the activation outcome (setup task count, demo-seed summary if applicable). Wizard surfaces it in the redirect or a post-setup banner.
- `apps/web/app/api/storefront/admin/archetype/route.ts` (if exists; verify at impl time) — same wiring for the archetype-change path. If no such route exists yet, the existing archetype-update flow goes through `/api/storefront/admin/setup` re-use.
- `apps/web/components/storefront-admin/SetupWizard.tsx` — modify. After successful POST, the Preview step's success state shows the activation outcome (X setup tasks opened, Y signals bound, Z demo records seeded if applicable) — honest visibility into what just happened.

**Verification.**
- Integration test: POST `/api/storefront/admin/setup` with HVAC archetype → response includes `setupTasks.created > 0` and `streams.size > 0` (or 0/0 if all dependencies have data and the projection-service impl isn't landed).
- Functional UX: drive the setup wizard end-to-end on the Live portal with HVAC, then with dental-practice, then with restaurant. Each shows setup-task banner + opens the expected setup tasks. Different archetypes → different declarations → different tasks. The "tracks the archetype's needs to the proper functionality" principle is demonstrated end-to-end across at least 3 archetypes.

**Rollback.** Revert the API route changes. The orchestrator stays buildable but no longer fires; manual invocation via the demo-seed route still works for testing.

## Phase 8 — sign-off ADR + PR

**Goal.** Functional dynamic-analysis verification on the Live portal across at least 3 archetypes proving universality, sign-off ADR following the substrate ADR precedent, scoped PR open against `main`.

**Pre-conditions.**
- Phases 1-7 complete locally.
- Full vitest green; production build green.
- Sweep `gh pr list --state open` against `orchestrator OR setup-activation OR workspace-home` for overlap.

**Files.**
- `docs/superpowers/decisions/YYYY-MM-DD-workspace-home-orchestrator-signoff.md` — sign-off ADR mapping BI acceptance criteria to evidence. Universality proof: at least 3 archetypes drove through the same code path with archetype-specific declarations producing archetype-specific setup tasks.
- `docs/superpowers/evidence/YYYY-MM-DD-workspace-home-orchestrator/dynamic-analysis.md` — prose findings per `feedback_dynamic_analysis_is_evidence`: drove the orchestrator end-to-end with HVAC, dental, restaurant. Per-archetype setup tasks differ. Per-archetype demo seed (when DPF_SEED_DEMO_DATA=true) differs. Reconciliation cadence re-runs catch deletions. Empty-state behavior varies per `missingDataBehavior`. Banned-copy scan clean across all generated task copy.

**Verification matrix in the PR body.**
| Gate | Expected |
|---|---|
| `pnpm --filter web typecheck` | green |
| Targeted vitest (lib/workspace-home + activation-orchestrator + components/workspace-home) | all green |
| Full web vitest | green, no new regressions |
| Production build | green, zero new substrate-owned warnings |
| UX evidence | drive 3 archetypes end-to-end; setup tasks differ per declaration; banned-copy clean |
| DCO sign-off | every commit |
| Overlap sweep | clean at push time |

**Rollback.** PR-level revert. All prior phases revert with the PR. Substrate behavior pre-orchestrator restored; the activation pipeline reverts to the pre-orchestrator setup path.

## Risks

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| Projection-service spec (PR #1452) drifts during review, changing the loader-id naming or signal-kind enum | medium | medium | Phase 3 binder reads against the spec's surface. If spec changes, signal-registry.ts rebases in a single commit. The orchestrator core (Phases 1-2-4-5-6) is agnostic to loader-id naming. |
| `canonical-data-registry.ts` mapping gets stale as new contributions land with new declarations | high | low | New keys without a registry entry produce a `[orchestrator-unknown-canonical-data]` log + the declaration goes to `satisfied: false, sample: null`. Setup-task generator emits a task pointing at "extend canonical-data-registry for key X." Self-surfacing gap. |
| Setup-task model (PlatformNotification vs WorkItem) chosen wrong at impl time | medium | medium | Phase 2 verifies substrate at impl time (`mcp__dpf__search_code_graph` for "PlatformNotification" + "WorkItem"). The model that already serves admin-actionable items wins. If both are wrong, file a BI before continuing. |
| Demo-seed creates rows that conflict with existing real install data | low | high | Idempotent + tagged seeding. Hard production guard (default-off). The `DPF_ALLOW_PROD_DEMO_SEED` escape hatch exists for prod-shaped test installs but logs loudly. Cleanup BI (future) removes tagged demo rows. |
| Reconciliation cadence runs cause Inngest queue load on installs with many contributions | low | low | Default cadence is daily; configurable. Per-install reconciliation is read-only + bounded by contribution slot count (small). |
| Phase 7 integration into `/api/storefront/admin/setup` breaks the existing customer-side activation flow | medium | high | Integration is additive — orchestrator runs AFTER `storefrontConfig.create` + capability perspective + design-system generation. If orchestrator throws, the setup commit has already succeeded; orchestrator failure surfaces as a setup task pointing at the error, not as a setup-commit failure. |
| Cross-cutting design dependencies on PR #1442 / #1453 ownership of `VerticalWorkspaceHome` | high | low | Same first-PR-wins pattern. Phases 3-4 components consume the existing VerticalWorkspaceHome surface from whichever PR landed it. |

## Rollback

Each phase is additive and reverts cleanly:

- Phase 1 (walker) — delete the activation-orchestrator directory. Substrate unchanged.
- Phase 2 (setup tasks) — delete the setup-tasks module + admin-surface-map. Walker still emits plans; nothing acts on them yet.
- Phase 3 (signal binder) — delete the binder + provider. VerticalWorkspaceHome falls back to per-slot prop wiring.
- Phase 4 (empty-state coordinator) — delete the decision module. Per-slot empty-state hand-wiring takes over.
- Phase 5 (demo seed) — delete the seed module + route. Tagged demo rows remain (additive + gated).
- Phase 6 (reconciliation) — disable the Inngest function. Activation still runs at setup + change.
- Phase 7 (API integration) — revert the setup-route change. Orchestrator stays buildable; just doesn't fire.
- Phase 8 (PR) — PR-level revert.

No schema changes anywhere in this plan. Rollback at the schema level is N/A.

## Open questions for the design pass

1. **Setup-task model — `PlatformNotification` vs `WorkItem` vs a new `SetupTask` model?** Plan default: **verify substrate at Phase 2 impl time**. Look for an existing admin-actionable-item table; the orchestrator extends what's there, doesn't invent new substrate.
2. **Telemetry placement** — the orchestrator's signal-gap counter (`dpf_workspace_home_orchestrator_signal_gap_total`) lives alongside the existing `dpf_workspace_home_resolutions_total` from PR #1439. Architect default: **yes**, same module (`apps/web/lib/operate/metrics.ts`), same prefix.
3. **Reconciliation cadence frequency** — daily? Hourly? Weekly? Plan default: **daily** is the right tradeoff (drift detection latency vs queue load). Configurable per-install via existing PlatformConfig pattern if it becomes a concern.
4. **`activateWorkspaceHomeForArchetype` return shape** — does the setup wizard's Preview step show the activation outcome inline, or as a separate post-setup banner? Plan default: **inline in the wizard's success state**, since the user is already there and the activation IS what they triggered.

If the design pass rejects any default, document the alternative + evidence in the override PR; update the affected phase here in the same commit.

## What's explicitly NOT in this plan

- **Implementation of any vertical contribution.** The 9 category-level + 2 exact-archetype BIs handle that; the orchestrator consumes their declarations.
- **Implementation of the projection service (BI-3E8D2CF5).** Its own plan; this plan binds against the spec's surface.
- **Implementation of the primitive registry (BI-5B8FE5C1) Phases 2+.** Its own plan; this plan consumes the primitive-key enum.
- **A new admin UI for setup tasks.** The orchestrator emits setup tasks against the existing admin-actionable-item surface (whatever Phase 2 verifies). A bespoke "setup-tasks for workspace-home" UI is a downstream BI if evidence justifies.
- **A cleanup script for tagged demo data.** Future BI; the orchestrator only seeds.

## Definition of done

This plan is "done" when:

1. Phases 1-8 ship via a single PR or a chained series.
2. The setup wizard, on at least 3 different archetype selections (e.g. HVAC, dental-practice, restaurant), opens archetype-specific setup tasks corresponding to that contribution's declarations.
3. The `DPF_SEED_DEMO_DATA=true` flag auto-seeds the right records per archetype with no per-archetype seed code.
4. The reconciliation cadence catches data deletion and re-opens setup tasks.
5. The Dale HVAC plan (PR #1442) Phase 9 is updated (in a follow-on amendment) to remove its per-BI fixture file and reference the orchestrator's demo-seed instead.
6. Every category-level BI's setup-activation requirements are honored without writing per-BI orchestration code.

The orchestrator's success criterion is the operator-stated principle:

> The portal configuration follows the needs of the business archetype with little effort.

…demonstrated functionally across at least 3 archetypes in the sign-off ADR's evidence dir.
