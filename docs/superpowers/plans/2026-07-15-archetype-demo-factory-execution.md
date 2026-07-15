# Archetype Demo Factory — execution plan

**Spec:** [2026-07-15-archetype-demo-factory-design.md](../specs/2026-07-15-archetype-demo-factory-design.md)
**Program:** [Living Business Excellence Program](../specs/2026-07-15-living-business-excellence-program-design.md)
**Epic:** EP-ARCHETYPE-DEMO (workstream A, registered 2026-07-15) — the test-bench for EP-LIVING-BUSINESS-EXCELLENCE
**Backlog items:** P1 `BI-7C95BEF6` · P2 `BI-1C26FCD5` · P3 `BI-7308C27E` · P4 `BI-7067BF90`
**Started:** 2026-07-15

Standing up a realistic business per archetype — for all 94 — from **one deterministic generator
plus a thin flavor layer**, so we can see, test, and iterate every archetype without a per-archetype
build. Scalability is the constraint (spec §2, §5).

## P1 — the generator + load path + scale gates (first PR)

The pure, DB-free foundation, mirroring the twin's `demo-snapshot.ts` discipline (deterministic,
no `Math.random`/`Date` in the core).

- ✅ **Landed** — `packages/storefront-templates/src/demo-business.ts` — `deriveDemoBusiness(archetype, options)`
  → `DemoBusiness` (spec §3). Pure; composes `deriveTwinProfile` + `deriveOperationalValueStream` +
  the archetype definition's own item prices / scheduling. The fifth member of the derive-with-override
  family. **Architecture note:** `getPlaybook` / `resolveBusinessProfile` live in `apps/web/lib` and a
  package cannot import the app, so they are passed as *optional injected enrichment*
  (`options.playbook` / `options.businessProfile`) that the load path wires in; the core is valid
  (94/94) from package-local signal alone. The thin `DemoFlavor` (shared with the Excellence Corpus)
  overrides company name / staff / customers / notes.
- ✅ **Landed** — `packages/storefront-templates/src/demo-business.test.ts` — **golden digest snapshot
  over all 94** (deterministic) + the **delight oracle** `evaluateDemoDelight` (spec §5.3), run as a
  per-archetype test: every archetype's demo is non-degenerate — every zone has resources, the primary
  queue has demand with sane wait-times, the cog has a real move, presence has humans + AI, finance
  shows money in-flight *and* revenue accruing. `evaluateDemoDelight` is exported for reuse as the P4
  CI gate. **Verified:** 100 tests green (94 oracle + determinism/flavor/enrichment/grounding/golden);
  full package suite 238/238.
- ⏳ **Next** — `apps/web/lib/demo/load-demo-business.ts` — `loadDemoBusiness(archetypeId, { flavor? })` /
  `unloadDemoBusiness()`: upsert the generated `DemoBusiness` into the real tables, set the org
  archetype via the existing reset path (`resetStorefrontArchetype`), run `runSetupCompletionSeeds`.
  Provenance/teardown: most target models (`StorefrontBooking`, `ServiceProvider`, `Bill`,
  `TaxObligationPeriod`, `Obligation`) have **no** `source` column, so demo rows are tagged with a
  stable `demo-` prefix on their `@unique` refs (`bookingRef`/`providerId`/`billRef`/…) for a
  `deleteMany({ startsWith: "demo-" })` teardown (resolves spec §9.1). Guardrail: never load over
  non-demo data. Verified against the **live** `loadLivingBusinessSnapshot` (same code path, not a
  fixture).

## P2 — the gallery (founder review surface)

`/admin/twin-gallery` (or extend `/admin/twin-kit`): iterate `ALL_ARCHETYPES`, render each twin
from its generated demo through `TwinView`, grouped by category, click-through to `/workspace`.
Carries a recorded `UX-Fit-Decision` (new admin surface).

## P3 — the flavor registry (shared with the Excellence Corpus, `BI-44EF78DE`)

Per-archetype `DemoFlavor` (spec §2.2): category defaults + the ~8 flagship slugs first, then fan
out. Each entry raises fidelity without touching the generator. Authored once, consumed by both the
demo factory and WWWD priming — workstream A·P3 (`BI-7308C27E`) and workstream B (`BI-44EF78DE`,
under `EP-LIVING-BUSINESS-EXCELLENCE`) converge here.

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
