# Salon BOOK Operations implementation plan

**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
**Operations prerequisite:** `BI-CD2A412D`
**Performance composition prerequisite:** `BI-00D276B2`
**Precedent evidence:** Fresha resource/calendar evidence activity `cms9zv2pc0dx901r294j655lv`
**Sequencing decision:** `DI-9487AA43AD60` (`operations-first-with-watermarks`, high confidence)


> **Rescue note (2026-08-16).** This design was recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed; the implementation did not.**
>
> - Tracking item: `BI-0B55EF4D`
> - Preserved implementation: `feat/salon-chair-operations` @ `820c169f4848a79e413cf0f37f57dbe44c05ba80`, pinned locally at `refs/salvage/2026-08-15/feat/salon-chair-operations` and recorded in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 820c169f4848a79e413cf0f37f57dbe44c05ba80:refs/heads/feat/salon-chair-operations`.
> - Merge state as measured on 2026-08-16: three conflicts: `WorkspaceTwinPanel.tsx`, `lib/twin/restaurant-scene-layout.ts`, and the generated `doc-index.generated.json` (regenerate, never hand-merge).
> - The original backlog anchors in this document did **not** resolve in this install, so it could not pass `check_plan_backlog_coverage`. Coverage is rebound to `BI-0B55EF4D`.
>
> - **Coverage is intentionally not recorded yet.** The stale delivery anchors (backlog-item and
>   coverage-receipt metadata lines) were removed because their ids do not resolve here, and a
>   receipt bound to work nobody has started would be fiction. This plan is therefore outside
>   the plan-backlog-coverage gate by design — that gate skips any plan carrying no
>   backlog-item metadata line. **When the implementation thread starts:** restore the backlog-item metadata line naming BI-0B55EF4D, call
>   `record_plan_backlog_coverage`, and copy its Receipt, Decision, Parent, Rationale and
>   Dependencies into a `## Backlog coverage` section. Recording a receipt requires an active
>   Workroom claim on BI-0B55EF4D — the repository-artifact resolver needs a claim-backed subject.
>
> Implementation is deliberately deferred to its own thread: this work needs an install/seed cycle to verify honestly, and a rebase alone would not prove it works. Read `BI-0B55EF4D` for the current dependency state before starting.

Operational-Precedent: salon-chair-book

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Give a salon owner or front-desk coordinator one fast operating surface that answers: which qualified beautician and physical chair or room can perform this service at the requested time without a provider overlap, resource overlap, missing skill, or impossible setup/cleanup transition?

The familiar provider-by-time day rail and the authored chair/room scene are coordinated views of the same assignment facts. Neither is a decorative duplicate. Selection in one highlights the same appointment, provider, and resource in the other. Every visual command remains fully operable through the calendar/table alternative.

This plan implements the existing `BOOK/provider-chair` template. It does not create another route, generic dashboard, scheduling product, or parallel operational model.

## Grounding

- `docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md` binds beauty/personal-care to `BOOK/provider-chair` and identifies provider-column scheduling plus processing-time gap fill as the market-proven pattern.
- `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md` requires current Operations to stay independent of historical analytics, with visible response <=100 ms and authoritative conflict confirmation p95 <=500 ms.
- `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md` makes salon P6 depend on cross-view reconciliation and requires current precedent, domain-owned facts, visual/list parity, busy-day fixtures, conflict-safe commands, and at least 20% shared-primitives refactoring.
- `apps/web/data/design-intelligence/operational-precedents.csv` records Fresha's staff/resource lanes, waitlist adjacency, buffers, conflict rules, and agenda-table alternative.
- Current official vendor evidence broadens that baseline: Boulevard requires one resource from each enabled category for the full service including processing and transition time; Vagaro pairs employee and resource calendars and auto-selects the first available room, chair, or tool with operator override; Meevo leads with a fast appointment book, real-time front-desk indicators, drag rescheduling, wait-list recovery, room capabilities/capacity, and utilization balancing. DPF adopts the joint staff/resource truth, visible transition spans, waitlist adjacency, and fast alternate assignment—not vendor navigation or visual branding.
- `packages/storefront-templates/src/twin-profile.ts` already derives `BOOK/provider-chair`; `packages/storefront-templates/src/scene-layout.ts` and `apps/web/lib/twin/cartesian-scene.ts` already own authored geometry and chair rendering.
- `StorefrontBooking`, `ServiceProvider`, `ProviderService`, `ProviderAvailability`, `BookingHold`, `StaffingShift`, `StaffingAssignment`, and `StaffingResourceLink` are existing people, service, booking, hold, and shared co-scheduling seams. `HospitalityResource` is explicitly Food & Hospitality-owned and must not be reused for salon chairs.
- `apps/web/lib/twin/operations-command.ts` already owns idempotency, expected-version handling, optimistic reconciliation, and typed conflict outcomes.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md`
  - `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
  - `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md`
- Current code substrate reviewed:
  - `WorkspaceTwinPanel` and `twin-panel-data` for the canonical Operations mount
  - `CartesianSceneCanvas`, cartesian scene validation, and restaurant scene persistence for shared authored geometry
  - Beauty capacity facts, availability, allocation repository, and attention projection for domain truth
  - Report-kit `DataTable`, `Notice`, `StatusBadge`, and the shared semantic status registry
- Source of truth:
  - `StorefrontConfig.archetypeId` selects applicability; Beauty-owned resource/provider/booking facts own live state; `OperationalSceneLayout` owns authored geometry.
- Decision:
  - Extend the existing `BOOK/provider-chair` composition on `/workspace`, keep Operations independent of historical Performance queries, and refactor scene persistence into one shared cartesian helper rather than creating a salon-only layout store.

## UX fit review - Salon BOOK Operations

- **Decision:** fits-with-guardrails
- **Owning area:** Workspace / Business Operations
- **Route family:** existing Operations workspace mount; no new global or section route
- **Primary persona:** salon owner/front-desk coordinator assigning and recovering today's client work
- **Navigation layer touched:** local view control and contextual assignment actions only
- **Reuse/convergence:** `WorkspaceTwinPanel`, `CartesianSceneCanvas`, twin grammar primitives, report-kit `DataTable`, `StatusBadge`, `Notice`, shared async indicators, and the existing operational command boundary
- **Source truth:** the beauty capacity substrate from `BI-CD2A412D`, existing booking/provider/service/availability facts, `OperationalSceneLayout` geometry, and versioned Operations projection
- **Empty/failure behavior:** unfinished setup names the missing chairs/providers/services and links to the owning setup path; projection failure preserves an honest list/day view; no zero-filled fake utilization; a scene failure never removes the accessible workflow
- **AI boundary:** gap-fill and waitlist promotion are attributed recommendations; selection is inert until the operator previews consequences and explicitly confirms
- **Required guardrails:** first viewport leads with the most important exception and one recommended action; detailed utilization/stage counts remain progressive disclosure; state is text plus semantic intent, never color-only; mobile beauty continues to use its travel-window composition
- **Evidence before merge:** focused projection/command/component tests, busy-Saturday fixture, keyboard-only list workflow, light/dark desktop and tablet exercise, mobile fallback, axe/route sweep, query/interaction timing, production build, and governed exact-tree evidence
- **Captured in:** this plan and `docs/ux-fit/2026-08-01-salon-book-operations.ux-fit.json`

## Delivery sequence

### 1. Beauty capacity substrate (`BI-CD2A412D`, separate PR)

Deliver domain-owned salon resources and joint provider/resource availability before rendering them.

- Confirm the canonical resource identity for fixed chairs, stations, and treatment rooms. Extend the existing scarce-resource/configuration substrate or `StaffingResourceLink`; do not broaden Food & Hospitality models.
- Project provider skill eligibility from `ProviderService`, provider time from `ProviderAvailability`, service duration from `StorefrontItem`, resource availability/holds, and booking intervals into one typed joint-availability contract.
- Extract pure shared interval, buffer, overlap, alternative-ranking, and conflict-reason helpers from restaurant-specific command code where semantics are genuinely common. This is the primary 20% refactor allocation.
- Make mobile beauty inapplicable to fixed-chair projection and preserve its existing field/travel window.
- Seed deterministic hair-salon chairs/rooms/providers/services through the canonical source path, including status and version facts.
- Surface data-backed exceptions for overlap, idle chair gaps, room-limited services, late appointments, and unassigned bookings.

Likely files after substrate verification:

- `apps/web/lib/twin/assignment-availability.ts` plus tests (new shared pure contract)
- beauty-owned projection/repository files under `apps/web/lib/beauty/` or the already-owning scarce-resource module found during implementation
- focused seed/fixture files in the owning package, not runtime patches
- existing attention-source registry and tests for owner-language exceptions

Verification: archetype-gating tests, interval/buffer/skill/resource matrix tests, overlap/idempotency tests, seed invariant, and proof that mobile beauty never receives fixed-chair state.

### 2. Cross-view reconciliation for the later Performance composition (`BI-00D276B2`, separate PR)

- Extend the existing Operations and Performance lineage contracts with bounded contributing source membership and watermarks.
- Ensure salon metrics can drill to the same appointments/providers/resources without historical aggregation entering the assignment path.
- Do not attach historical salon metrics or claim cross-view reconciliation until this contract is merged.
- `DI-9487AA43AD60` explicitly allows the independently useful Operations workspace to ship first when it carries canonical source identities and watermarks and keeps historical aggregation off the assignment hot path.

### 3. Salon read model and busy-Saturday fixture (`BI-9FA3C3A4`)

- Add a bounded salon Operations loader that reads one selected day and returns providers, resources, appointments, unassigned demand, waitlist opportunities, joint availability, conflicts, utilization, and exact source watermarks.
- Build the committed busy-Saturday fixture: multiple stylists, specialist service eligibility, one room-limited service, a late appointment, one cancellation filled from waitlist, prep/cleanup buffer, and an out-of-service chair.
- Keep elapsed/remaining time and next-booking calculations pure and timezone-aware.
- Use one projection for scene bindings, day rail, accessible table, and command options so the views cannot disagree.

Expected files:

- `apps/web/lib/twin/salon-book-projection.ts` and tests
- `apps/web/lib/twin/salon-book-loader.server.ts` and tests
- `apps/web/lib/twin/__fixtures__/salon-busy-saturday.ts`

### 4. Coordinated day rail, scene, and accessible workflow

- Add a provider-by-time day rail with explicit appointment blocks, processing/setup/cleanup spans, blocked time, unassigned demand, and waitlist opportunities.
- Bind chair/room scene placements through `OperationalSceneLayout` and `CartesianSceneCanvas`; show provider, client/service, elapsed/remaining, next booking, cleanup, out-of-service reason, and utilization through concise labels plus progressive detail.
- Selecting an appointment/provider/resource in either view highlights the corresponding entities in both views.
- Compose report-kit `DataTable` for the fully operable alternative with time, client, service, provider, chair/room, status, conflict reason, and action.
- On small screens, lead with the day/list workflow and make the scene secondary; preserve >=44 px targets and meaningful focus order.

Expected files:

- `apps/web/components/twin/salon/SalonBookOperations.tsx` and tests
- `apps/web/components/twin/salon/SalonDayRail.tsx` and tests
- `apps/web/lib/twin/salon-scene-layout.ts` and tests
- `apps/web/components/workspace-home/WorkspaceTwinPanel.tsx` and tests
- `apps/web/lib/workspace-home/twin-panel-data.ts` and tests
- `apps/web/components/ui/report-kit/statusColors.ts` and its registry test for salon statuses

### 5. Conflict-safe assignment and recovery

- Use `OperationalCommandBoundary` for assign/reassign; extend the typed entity references only as needed to carry both provider and physical resource identities.
- Preview provider, resource, time, buffer, and downstream consequences before confirmation.
- Commit provider/resource/hold/version checks atomically. A stale or conflicting move changes nothing, restores prior selection, explains the exact conflict, and offers ranked valid alternatives.
- Treat waitlist fill as an attributed proposal followed by the same explicit confirmation path.
- Emit interaction and confirmation latency telemetry through the existing Operations telemetry contract.

Expected files:

- `apps/web/lib/twin/salon-book-command.server.ts` and tests
- `apps/web/lib/twin/salon-book-actions.ts`
- minimal shared changes to `apps/web/lib/twin/operations-command.ts` with regression tests

### 6. Documentation, UX evidence, and governed verification

- Add operator guidance under `docs/user-guide/` for day scheduling, chair/room assignment, conflicts, and recovery.
- Commit a measured UX-fit manifest covering every UI-impacting file.
- Exercise the busy-Saturday happy path and conflict path with keyboard-only and pointer input, plus desktop/tablet/mobile and light/dark screenshots.
- Measure selection response, command confirmation, bounded query behavior, and first decision surface timing.
- Run focused unit tests, exact shared local-CI, production build, accessibility/route sweep, and migration apply if the prerequisite substrate adds a migration.
- Record test/build/UX/migration evidence to the owning BIs and route confirmed reusable interval/assignment techniques to the shared commons.

## Backlog coverage

This plan is decomposed because the beauty capacity substrate and cross-view reconciliation are independently shippable prerequisites with their own live BIs.

| Key | Deliverable | Backlog | Depends on |
| --- | --- | --- | --- |
| `beauty-capacity` | Beauty chair/room/provider capacity and conflict substrate | `BI-CD2A412D` | - |
| `reconciliation` | Operations and Performance source-lineage reconciliation contract | `BI-00D276B2` | - |
| `salon-book` | Salon BOOK spatial and day-rail operating view | `BI-9FA3C3A4` | `beauty-capacity` for Operations; `reconciliation` before Performance composition |

- **Coverage receipt:** `cmsa00jch0e5401r2poq1w5l9`
- **Decision:** `decomposed`
- **Mapped items:** `BI-CD2A412D`, `BI-00D276B2`, `BI-9FA3C3A4`

## Risks and rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| Salon resources are forced into Food & Hospitality tables | Verify ownership first; use beauty/scarce-resource substrate and typed adapters | Revert beauty adapter/migration while retaining generic interval helpers |
| Day rail and physical scene disagree | One read model and entity-reference map feeds both | Fall back to the accessible day/table view; do not show stale scene commands |
| Appointment moves double-book a provider or chair | Expected version, idempotency, holds, and atomic overlap checks | Reject with no mutation and ranked alternatives |
| Processing/setup/cleanup is hidden | Model explicit occupied intervals and render labelled spans | Disable gap-fill suggestion when buffer evidence is unavailable |
| Mobile beauty is misrepresented as a fixed salon | Archetype gating and regression tests | Preserve existing travel-window composition |
| New UI slows the front desk | Bounded selected-day query, memoized scene bindings, no Performance bundle/query on hot path | Feature-gate the graphical scene while retaining day/list operations |
| Empty data looks production-ready | Honest setup/recovery state and no invented utilization | Render the existing generic twin with a clear incomplete-setup notice |

No partial graphical BOOK view is considered production-ready: the visual scene, day/list parity, conflict-safe command, and busy-day evidence ship together under `BI-9FA3C3A4` after its two prerequisites.
