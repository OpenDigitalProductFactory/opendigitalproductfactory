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
- **Logic over the live catalog:** `deriveTwinProfile` exercised over all **94** seeded archetypes via a compiled Node harness — every archetype derives a complete twin (zones, queue, chips, nouns, cog+signals, physical flag); deterministic; the board↔physical invariant holds for all 94; dispatch-native archetypes bind the field-dispatch resource noun; the clearly-determined category mappings (banking→TENANTS/portfolio, media→PIPELINE/timeline, food→FLOOR, hoa→TERRITORY/unit-portfolio, construction→TERRITORY/job-sites, rental→YARD) all hold; the leaf override replaces template/variant/nouns with fall-through. **10 of 12 templates** are exercised by the seeded catalog (BAYS and COUNTER are reachable-by-derivation — fixed-shop automotive and permit-counter public-sector — but no seeded leaf currently lands there; both are covered by category/override).
- Every `twin-profile.test.ts` assertion was replicated against the compiled output and passes (0 failures). The vitest run itself is the canonical gate — it executes in CI's Unit Tests job (deps unavailable in this source-only worktree; harness limitation, not a product defect, §5).

### Non-physical coverage (this PR)
The derivation covers all non-physical categories via the board family, and a **board-twin prototype** demonstrates them with the same operating-twin grammar (presence + cog + queues + attributed feed): `docs/superpowers/specs/assets/2026-07-12-living-business-board-twin-prototype.html` — SaaS (TENANTS), professional-services (PIPELINE), nonprofit (PROGRAMS), banking (TENANTS/portfolio), media (PIPELINE/timeline). Tap a queue item → the cog routes it to the best owner by the archetype's signal (health-score/CSM-load, utilization, engagement, banker workload, editor availability) → tap to confirm; humans and AI coworkers act on one shared board with an attributed feed.

## P2 — the grammar kit · NEXT
The ten primitives as React components on the token/report-kit substrate (`apps/web/components/twin/`), lifted from the four prototypes: capacity chips, zone, resource unit, work item (with blocked-on-external state), queue, cog banner, utility band, presence row, attributed feed, needs-you quests. Each rendered through `--dpf-*` tokens, reduced-motion-safe, dynamic text via a safe helper (no innerHTML). A fixture page per primitive. Requires a recorded `UX-Fit-Decision` (§12) for the metric/status components.

## P3 — first templates live
FLOOR, TERRITORY, YARD as template compositions bound via `TwinProfile`, replacing the three hand-built prototypes with framework-rendered equivalents wired to `LivingBusinessSnapshot` + `agent-event-bus` (parent spec P1–P2). Registers as a workspace-home contribution per archetype.

## P4 — remaining templates by install demand
BOOK, BAYS, ROOMS, STORE, VENUE, COUNTER + the TENANTS/PIPELINE/PROGRAMS boards, each a template + bindings (not a bespoke build). Certification: a golden-journey per template exercising queue → cog → confirm. PHI-class ROOMS (healthcare) gets the presence/feed redaction mode (role, not patient identity) keyed off `privacyClass` (open question §9.2).

## P5 — simulator coverage
Business Activity Simulator archetype factories (its P2) emit per-template scenarios so every twin can be demonstrated live on a test install.

## Risks / decisions carried forward
- **BAYS/COUNTER have no seeded leaf** — reachable by category/override; a fixed-shop automotive or permit-counter public-sector archetype (or a leaf override) exercises them. Not a gap in the derivation.
- **TERRITORY nouns for non-dispatch physical categories** (HOA/construction/trades routed by category, not field-dispatch) fall back to the generic "technician" default; render-time vocabulary resolves the operator label ("vendor"/"crew"). A follow-up can specialize per-variant default nouns.
- **Hybrid archetypes** (retail+online, telehealth) set `hybridBoard`; the composed-archetype case (`StorefrontArchetypeComposition`) is deferred to the first real composed install (§9.3).
