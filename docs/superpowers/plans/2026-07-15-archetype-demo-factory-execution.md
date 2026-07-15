# Archetype Demo Factory — execution plan

**Spec:** [2026-07-15-archetype-demo-factory-design.md](../specs/2026-07-15-archetype-demo-factory-design.md)
**Program:** [Living Business Excellence Program](../specs/2026-07-15-living-business-excellence-program-design.md)
**Epic:** EP-ARCHETYPE-DEMO (workstream A) — the test-bench for EP-LIVING-BUSINESS-EXCELLENCE
**Started:** 2026-07-15

Standing up a realistic business per archetype — for all 94 — from **one deterministic generator
plus a thin flavor layer**, so we can see, test, and iterate every archetype without a per-archetype
build. Scalability is the constraint (spec §2, §5).

## P1 — the generator + load path + scale gates (first PR)

The pure, DB-free foundation, mirroring the twin's `demo-snapshot.ts` discipline (deterministic,
no `Math.random`/`Date` in the core).

- `packages/storefront-templates/src/demo-business.ts` — `deriveDemoBusiness(archetype, { seed, flavor? })`
  → `DemoBusiness` (spec §3). Pure; composes `deriveTwinProfile`, `deriveOperationalValueStream`,
  `getPlaybook`, `resolveBusinessProfile`-equivalent signal already in the definition. The fifth
  member of the derive-with-override family.
- `packages/storefront-templates/src/demo-business.test.ts` — **golden snapshot over all 94**
  (deterministic) + the **delight oracle** (spec §5.3): every archetype's demo is non-degenerate —
  every zone has resources, the primary queue has demand with sane wait-times, the cog has a real
  move, presence has humans + AI, finance shows money in-flight.
- `apps/web/lib/demo/load-demo-business.ts` — `loadDemoBusiness(archetypeId, { flavor? })` /
  `unloadDemoBusiness()`: upsert the generated `DemoBusiness` into the real tables tagged
  `source:"demo"` (idempotent, reversible), set the org archetype via the existing reset path, run
  setup-completion seeds. Guardrail: never load over non-demo data.
- Verification: `deriveDemoBusiness` exercised over `ALL_ARCHETYPES`; a loaded demo renders through
  the **live** `loadLivingBusinessSnapshot` (same code path, not a fixture) on a seeded test org.

## P2 — the gallery (founder review surface)

`/admin/twin-gallery` (or extend `/admin/twin-kit`): iterate `ALL_ARCHETYPES`, render each twin
from its generated demo through `TwinView`, grouped by category, click-through to `/workspace`.
Carries a recorded `UX-Fit-Decision` (new admin surface).

## P3 — the flavor registry (shared with EP-EXCELLENCE-CORPUS)

Per-archetype `DemoFlavor` (spec §2.2): category defaults + the ~8 flagship slugs first, then fan
out. Each entry raises fidelity without touching the generator. Authored once, consumed by both the
demo factory and WWWD priming (the epics converge here).

## P4 — CI gate + simulator convergence

Wire the delight oracle into CI as the per-archetype quality gate; fold the shipped field-service
Business Activity Simulator flow in as the "activity over time" layer for animated demos.

## Risks / decisions
- **Single-org isolation** — `source:"demo"` tag + guardrail for P1 (spec §9.1); a dedicated demo
  deployment is a later option if tagging proves leaky.
- **Coverage vs fidelity** — the derived default makes all 94 valid immediately; flavor is
  incremental, so we never block on authoring 94 businesses (spec §2).
- **Determinism** — no `Math.random`/`Date` in the generator core; seed varies output by
  archetypeId + index, so snapshots are stable and diffable.
