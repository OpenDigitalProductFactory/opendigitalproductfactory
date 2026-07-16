# Ground the Twin in the Value Stream — execution plan (workstream C)

**Program:** [Living Business Excellence](../specs/2026-07-15-living-business-excellence-program-design.md) §2 (row C)
**Parent:** [Operational Twin Framework](../specs/2026-07-12-operational-twin-framework-design.md)
**Epic / BI:** `EP-LIVING-BUSINESS-EXCELLENCE` · `BI-DE577C43`
**Started:** 2026-07-16

## Why

The operational twin (`deriveTwinProfile`) renders *space* — zones + demand queues.
The operational value stream (`deriveOperationalValueStream`, OVSM) renders *flow* — the
six-stage backbone (Attract → Capture → Qualify → Deliver → Settle → Retain, plus cross-cuts).
They were two disjoint sibling derivations, so the animation view and the architecture view were
two unrelated pictures of the same business. Workstream C binds them: each twin queue and zone maps
to the value-stream stage its work actually sits in, so the twin's tiles map to the archetype's real
process — the factory-automation lens of **queue depth + wait per stage**.

## C-1 — the binding derivation (this PR)

- `packages/storefront-templates/src/twin-value-stream.ts` — `deriveTwinValueStreamBinding(archetype)`
  → `TwinValueStreamBinding`: `queueToStage` / `zoneToStage` maps (clamped to the stages the
  archetype actually has), the ordered `stages[]` (each OVS stage with its bound twin queues/zones),
  and `primaryStageKey`. Pure, total, deterministic — the seventh member of the derive family.
- Refactor: `deriveDemoBusiness` now takes its per-item `stageKey` from
  `binding.queueToStage` (single source of truth; the private `stageForQueue` duplication is gone).
- **Verified:** binding unit tests over all 94 (every queue/zone resolves to a real stage of the
  archetype; stages ordered; queues/zones partitioned consistently; deterministic; rental gets
  Return & Inspect; dispatch → Qualify; renewals → Retain). Golden snapshot regenerated (per-stage
  demand counts now reflect the grounded mapping). Package suite 259/259; typecheck clean.

## C-2 — per-stage flow in the live twin (next PR)

- Extend `loadLivingBusinessSnapshot` (`apps/web/lib/twin/living-business-snapshot.ts`) and/or the
  demo→TwinSnapshot bridge to group live/demo demand **by value-stream stage** using
  `deriveTwinValueStreamBinding`, surfacing per-stage queue depth + longest wait — so the twin's
  queues carry their stage label and the architecture view and animation view line up.
- Verify end-to-end against the real dev DB (loaded demo → per-stage grouping renders through the
  live projection), same discipline as A·P1.

## Non-goals

- Not a `TwinProfile` schema change (spec §6.3): the binding is a *derivation over* the existing
  profile + OVS, not a new authored field — leaves both stable and keeps the ADR-4 override story
  intact.
