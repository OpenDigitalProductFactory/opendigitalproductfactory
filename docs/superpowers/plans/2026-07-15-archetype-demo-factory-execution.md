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
- ✅ **Landed (pure planner)** — `packages/storefront-templates/src/demo-business-load.ts` —
  `planDemoLoad(demo, { storefrontId, itemIds })` maps a `DemoBusiness` onto the exact rows the live
  loader reads (`ServiceProvider`, `StorefrontBooking`, `Bill`/`Supplier`, `EmployeeProfile`),
  DB-free and deterministic, so the risky part — field mapping, reversible `demo-` tagging, the
  load-over-real-data guardrail (`isSafeToLoadDemo`) — is unit-tested without a database. Provenance:
  most target models have **no** `source` column, so every demo row carries a stable `demo-` prefix
  on its `@unique` ref; `demoTeardownSpec` drives a `deleteMany({ startsWith })` teardown (resolves
  spec §9.1). **Verified:** planner suite green over all 94 (refs/FK-safety/status-mapping/teardown/
  guardrail); package suite stays green.
- ✅ **Landed (thin executor)** — `apps/web/lib/demo/load-demo-business.ts` — `loadDemoBusiness` /
  `unloadDemoBusiness`: resolve the org, run the guardrail, set the archetype via
  `resetStorefrontArchetype`, execute `planDemoLoad` as prisma upserts (parents first; FK ids
  resolved for `Bill.supplierId`→`Supplier.id`, `Booking.providerId`→`ServiceProvider.id`), and run
  `runSetupCompletionSeeds`. `db` is injectable; covered by a fake-db unit test (guardrail refusal,
  demo-prefix tagging, reversible teardown) run in CI. Schema wiring verified against the live DB
  (`information_schema` column + FK checks). **Remaining tier:** end-to-end render through the live
  `loadLivingBusinessSnapshot` on a running install — exercised by P2's gallery / a deployed build.

## P2 — the gallery (founder review surface)

✅ **Landed** (BI-1C26FCD5). Three pieces:

- `apps/web/lib/twin/demo-business-snapshot.ts` — `demoBusinessToTwinSnapshot(demo, profile)`, the
  **persona'd render bridge**: the third sibling of the snapshot family (live = DB→TwinSnapshot,
  fixture = TwinProfile→TwinSnapshot, **demo = DemoBusiness→TwinSnapshot**), so the same `TwinView`
  renders a real generated demo in memory, no DB. Plus `demoGalleryCard` (the scannable summary).
- `app/(shell)/admin/twin-gallery/page.tsx` — a **scannable grid** of all 94 persona'd demos grouped
  by category (company name, template, staffed zones, queued demand + longest wait, workforce/AI,
  revenue-in, the cog's proposed move), click-through per card.
- `app/(shell)/admin/twin-gallery/[archetypeId]/page.tsx` — the **full persona'd twin** rendered
  through `TwinView` from `demoBusinessToTwinSnapshot`.

Deterministic ⇒ safe to static-render; no per-archetype build. **Verified:** mapper + gallery-card
unit tests over all 94 (zones/queues keyed to the profile, primary queue carries the cog move,
presence has humans + AI, finance utility present); `apps/web` typecheck clean. `UX-Fit-Decision`:
new admin dev surface, view_admin-gated, reachable at `/admin/twin-gallery` (not added to primary
nav — a reviewer/developer surface, like `/admin/twin-kit`).

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
