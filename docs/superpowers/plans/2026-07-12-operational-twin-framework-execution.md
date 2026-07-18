# Operational Twin Framework — execution plan

**Spec:** [2026-07-12-operational-twin-framework-design.md](../specs/2026-07-12-operational-twin-framework-design.md)
**Parent:** [2026-07-11-living-business-workforce-visualization-design.md](../specs/2026-07-11-living-business-workforce-visualization-design.md)
**Epic:** EP-LIVING-BUSINESS-VIZ (proposed)
**Started:** 2026-07-12

Delivering the framework that gives *every* archetype — physical and non-physical — a working operational twin, from one grammar + ~12 templates + a derived `TwinProfile`.

## P1 — the derivation (this PR) · DONE

The pure, DB-free foundation: `deriveTwinProfile(archetype)` picks a template and binds its nouns/zones/queues/cog from the archetype's operating-model axes, `schedulingDefaults`, derived `FieldDispatchProfile`, and category — the fourth member of DPF's derive-with-override family (OVSM, media-profile, field-dispatch ADR-4).

- `packages/storefront-templates/src/twin-profile.ts` — types (`TwinTemplate` ×12, `TwinVariant`, `TwinCogKind`, `TwinProfile`, `TwinProfileOverride`), the `TEMPLATE_DEFAULTS` grammar map, `chooseTemplate` (priority: dispatch → rental → board family → physical categories → safety net), and `deriveTwinProfile` with the leaf-override escape hatch.
- `packages/storefront-templates/src/types.ts` — `twinProfile?: TwinProfileOverride` added to `ArchetypeDefinition` (optional leaf override, mirroring `fieldDispatch?`/`mediaProfile?`; type-only circular import, same pattern as `FieldDispatchProfileOverride`).
- `packages/storefront-templates/src/index.ts` — re-export.
- `packages/storefront-templates/src/twin-profile.test.ts` — totality (every seeded archetype → a complete, deterministic twin), the board↔physical invariant, axis-over-category taxonomy, the signature mappings, the leaf override, and coverage breadth.

**Key design correction found during P1 (verified against the live catalog):** *category is not destiny — the physical axes win.* A land-surveying or field-inspection **professional-services** firm is dispatch-native → TERRITORY; an equipment-pooling **co-op** (nonprofit) is reservation-and-return → YARD; a member-owned **credit union** (banking) → TENANTS/portfolio, not the donor PROGRAMS board. The derivation checks dispatch/rental axes and category-specific board mappings before generic governance, so a physically-operating business in a "non-physical" category correctly gets a physical twin, and vice versa.

### P1 verification evidence (source-local — pure, DB-free package; §5)
- **Typecheck:** `tsc` compiles all package sources clean (exit 0), including the new `twinProfile?` leaf field and the type-only circular import.
- **Logic over the live catalog:** `deriveTwinProfile` was exercised over all **94** seeded archetypes present during the P1 PR via a compiled Node harness — every archetype derived a complete twin (zones, queue, chips, nouns, cog+signals, physical flag); deterministic; the board↔physical invariant held for all 94; dispatch-native archetypes bound the field-dispatch resource noun; the clearly-determined category mappings (banking→TENANTS/portfolio, media→PIPELINE/timeline, food→FLOOR, hoa→TERRITORY/unit-portfolio, construction→TERRITORY/job-sites, rental→YARD) all held; the leaf override replaced template/variant/nouns with fall-through. **2026-07-18 sweep:** the source catalog is now **95** archetypes, so the next acceptance signoff must rerun the harness over the current catalog before treating this evidence as current. **10 of 12 templates** were exercised by the P1 seeded catalog (BAYS and COUNTER are reachable-by-derivation — fixed-shop automotive and permit-counter public-sector — but no seeded leaf currently lands there; both are covered by category/override).
- Every `twin-profile.test.ts` assertion was replicated against the compiled output and passes (0 failures). The vitest run itself is the canonical gate — it executes in CI's Unit Tests job (deps unavailable in this source-only worktree; harness limitation, not a product defect, §5).

### Non-physical coverage (this PR)
The derivation covers all non-physical categories via the board family, and a **board-twin prototype** demonstrates them with the same operating-twin grammar (presence + cog + queues + attributed feed): `docs/superpowers/specs/assets/2026-07-12-living-business-board-twin-prototype.html` — SaaS (TENANTS), professional-services (PIPELINE), nonprofit (PROGRAMS), banking (TENANTS/portfolio), media (PIPELINE/timeline). Tap a queue item → the cog routes it to the best owner by the archetype's signal (health-score/CSM-load, utilization, engagement, banker workload, editor availability) → tap to confirm; humans and AI coworkers act on one shared board with an attributed feed.

## P1.5 — Archetype Catalog admin view · DONE

The first product surface to *consume* `deriveTwinProfile`: a read-only
`/admin/archetypes` catalog (admin Configuration family) that lists every installed
archetype configuration — including the ones **not enabled**, which the
setup-wizard redirect otherwise hides — with each row's derived operational-twin
template. Plan: [2026-07-12-archetype-catalog-admin-view-execution.md](2026-07-12-archetype-catalog-admin-view-execution.md). Composed from report-kit; no render kit yet (that is P2).

## P2 — the grammar kit · DONE
The ten primitives as React components on the token/report-kit substrate
(`apps/web/components/twin/`), lifted from the four prototypes: capacity chips,
zone, resource unit, work item (with blocked-on-external state), queue, cog banner,
utility band, presence row, attributed feed, needs-you quests — plus a shared
`ActorMark` that renders humans and AI coworkers on one plane (the operating-twin
doctrine). Each is `--dpf-*` token-driven, reduced-motion-safe (`motion-safe:` live
dots), and React-safe by construction (no `innerHTML`). Nine are pure/server-usable;
only `CogBanner` is a client component (it owns the HITL confirm/dismiss). A viewable
fixture — `/admin/twin-kit` (`TwinKitShowcase`) — renders all ten twice: a physical
restaurant **FLOOR** and a non-physical SaaS **TENANTS** board, proving one grammar
spans both lenses. Unit tests (`twin-kit.test.tsx`) assert each pure primitive renders
to static markup and surfaces its data (incl. the blocked-on-external and attributed
human/AI states).

Verification: `pnpm --filter web typecheck` clean; `twin-kit.test.tsx` green;
route manifest regenerated. **UX-Fit-Decision** recorded on the PR (composed from
report-kit `intentStyle`/`StatusBadge`; progressive disclosure — capacity chips +
one bottleneck queue + a single needs-you surface, not a chart wall; no raw/numeric
operator inputs). The fixture is intentionally **not** linked from the admin nav —
it is a developer preview, reachable directly and gated by the admin `view_admin`
guard.

## P3 — the profile-driven renderer · DONE (first increment)
`TwinView` (`apps/web/components/twin/TwinView.tsx`) renders **any** archetype's
twin by composing the P2 kit from a `TwinProfile` (merged P1) + a `TwinSnapshot` —
one component for every template, physical or board. The profile supplies the
template, vocabulary (`resourceNoun`/`workItemNoun`), zone/queue labels, and cog
signals; the snapshot supplies the live values. `TwinSnapshot` (`snapshot.ts`) is
the render contract the future `LivingBusinessSnapshot` projection (P4) fills; until
then `buildDemoTwinSnapshot` (`demo-snapshot.ts`) fills it deterministically. The
`/admin/twin-kit` fixture now renders six archetypes through the *same* `TwinView`
— restaurant FLOOR, trades TERRITORY, rental YARD, SaaS TENANTS, prof-svcs PIPELINE,
nonprofit PROGRAMS — via an archetype switcher, proving one renderer serves both
lenses.

Tests (`twin-view.test.tsx`): demo-snapshot **totality** over all seeded archetypes
(every profile → a renderable snapshot whose zones bind to real profile keys and
whose presence includes an AI coworker), determinism, and `TwinView` rendering a
physical FLOOR and a non-physical TENANTS board from the one component with the
correct profile vocabulary. Verification: typecheck clean; `vitest components/twin/`
12/12 green; route manifest current.

### P3 increment 2a — the live data projection · DONE
`loadLivingBusinessSnapshot` (`apps/web/lib/twin/living-business-snapshot.ts`)
projects the deployment's single org into a real `TwinSnapshot` — the same shape
`buildDemoTwinSnapshot` invents — so `TwinView` renders live where the substrate
exists. Sources, honest by policy (every field backed by a query or clearly derived;
nothing faked):
- **presence** ← the workforce roster (`loadWorkforceRoster`) — humans + AI coworkers
  on one plane, AI first, `kind` from the roster discriminator.
- **utility** ← the finance spine — bills due ≤7d (count + amount), next unfiled
  `TaxObligationPeriod`, open `Obligation` reviews, coworker capability gaps.
- **capacityChips** ← real counts (workforce, AI coworkers, open demand, bills due).
- **zones / units** ← active `ServiceProvider`s, else the workforce ("staff = work
  owned").
- **queues / workItems** ← `StorefrontBooking` (pending → primary queue; in-flight →
  work items attributed to the provider).
- **quests** ← real attention only (tax due ≤14d, unassigned demand, bills due).
- **cog** ← a proposal shell raised only when there is real pending demand.

Returns `null` when no org is configured → the caller falls back to the demo.
`/admin/twin-kit` now leads with a **live · this business** tab (the real projection)
ahead of the demo archetypes. Pure mapping helpers are unit-tested
(`living-business-snapshot.test.ts`, 11 assertions incl. a fake-client loader run);
what has no substrate yet is left empty with its calm-state label, not faked.

### P3 increment 2b — workspace-home placement · DONE (merged, sibling PR)
`TwinView` is the main `/workspace` view — a dedicated hero (`WorkspaceTwinHero`,
parent viz spec §9 option c) that folds `OperatorCockpit` in as its HUD so exactly
one attention surface renders, with the platform launcher demoted below. The
`twin-panel-data` seam (`resolveWorkspaceTwinPresentation`) resolves the org's
archetype → profile → snapshot and condenses for the home mount (strips the twin's
rival `cog`/`quests`).

### P3 increment 2c — wire the home to LIVE data + real flow metrics · DONE
The home seam now renders the **real** projection. `loadWorkspaceTwinPresentation`
(async) overlays `loadLivingBusinessSnapshot` onto the resolved presentation:
`demo: false` with live business data when the org is configured, deterministic demo
otherwise, never throwing (a projection failure degrades to demo). The workspace page
awaits it. Added **real queue wait-time** flow metrics — the founder's original ask
("if we know the queue and wait times"): `bookingsToQueueItems` orders longest-waiting
first and shows each item's true age (from `createdAt`), and a **Longest wait**
capacity chip leads the board when demand is waiting (`humanizeWait`/`longestWaitMs`).
A **live cog optimizer** (`proposeCogAllocation`) realizes the founder's
`constraint → proposal → confirm` cog ("a suggested table seating cog"): it takes the
longest-waiting unassigned demand and proposes the least-loaded active resource
(fewest in-flight items), naming the actual item + resource, and stays silent when
there is nothing to allocate. It shows on the admin/twin-kit live tab and any
non-home mount (the workspace home condenses the cog out, keeping `OperatorCockpit`
the single attention surface).

Tests: live-overlay + demo-fallback (`twin-panel-data.test.ts`); wait-metric + cog
helpers (`living-business-snapshot.test.ts`); 37 twin assertions green.

**Still deferred (each behind the same `TwinSnapshot` shape, no contract change):**
a *persisted* human+AI event log for a richer live feed (needs a new table +
write-path instrumentation — a migration-class change, out of scope here; the feed
stays derived-from-bookings until then), and per-value-stream-stage WIP over
`deriveOperationalValueStream` (the value-stream *lens*, a distinct render surface
from the twin's spatial "now" lens).

## P4 — remaining templates by install demand
BOOK, BAYS, ROOMS, STORE, VENUE, COUNTER + the TENANTS/PIPELINE/PROGRAMS boards, each a template + bindings (not a bespoke build). Certification: a golden-journey per template exercising queue → cog → confirm. PHI-class ROOMS (healthcare) gets the presence/feed redaction mode (role, not patient identity) keyed off `privacyClass` (open question §9.2).

## P5 — simulator coverage
Business Activity Simulator archetype factories (its P2) emit per-template scenarios so every twin can be demonstrated live on a test install.

## Risks / decisions carried forward
- **BAYS/COUNTER have no seeded leaf** — reachable by category/override; a fixed-shop automotive or permit-counter public-sector archetype (or a leaf override) exercises them. Not a gap in the derivation. **Now render-covered:** `twin-template-coverage.test.tsx` renders all 12 templates through `TwinView`, exercising BAYS (Intake/Bays·lifts) and COUNTER (Service queue) via the realistic fixed-location config (`fieldDispatch.enabled: false`) `chooseTemplate` routes to them; the `/admin/twin-kit` preview also browses both. Seeding *actual* fixed-shop-automotive / permit-counter business archetypes into the catalog remains a product-catalog decision, deliberately out of scope here.
- **TERRITORY nouns for non-dispatch physical categories** (HOA/construction/trades routed by category, not field-dispatch) fall back to the generic "technician" default; render-time vocabulary resolves the operator label ("vendor"/"crew"). A follow-up can specialize per-variant default nouns.
- **Hybrid archetypes** (retail+online, telehealth) set `hybridBoard`; the composed-archetype case (`StorefrontArchetypeComposition`) is deferred to the first real composed install (§9.3).
