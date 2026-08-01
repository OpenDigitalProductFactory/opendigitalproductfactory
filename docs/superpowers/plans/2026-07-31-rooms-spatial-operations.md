# ROOMS spatial operations — implementation plan

**Backlog item:** `BI-CCE939AF`
**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
**Work Capsule:** `WC-D56EADD2`
**Branch:** `feat/hotel-room-operations`
**Parent design:** `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md`
**Related lodging work:** `BI-69F9BA89` (domain model), `BI-81F1D3EF` (lodging cockpit)
**Scope decision:** `DI-36CBF4CAD357` — reusable `ROOMS` renderer first; high confidence, composite `3.588`, margin `2.807`, no commandment conflict.

## Outcome

Replace the generic card grid for `ROOMS` twins with a reusable, privacy-safe operational view that makes a physical accommodation business legible at a glance. The surface coordinates three representations of the same projection:

## Design grounding

- **Existing specs/plans reviewed:** `2026-07-21-spatial-operational-views-design.md`, `2026-07-28-business-operations-and-performance-views-design.md`, `2026-07-30-cartesian-scene-renderer-plan.md`, and `2026-07-31-restaurant-business-grade-floor.md`.
- **Current code substrate reviewed:** `OperationalSceneLayout`, `CartesianSceneCanvas`, `CartesianResourceNode`, `TwinView`, the `ROOMS` storefront template, `WorkspaceTwinPanel`, and the restaurant floor-operations projection and renderer.
- **Source of truth:** the `RoomsOperationalView` projection owns the coordinated room-rack, floor/wing, accessible-list, exception, and workload facts; the established cartesian scene contract owns spatial geometry; durable lodging records and commands remain with `BI-69F9BA89` and `BI-81F1D3EF`.
- **Decision:** `DI-36CBF4CAD357` selected `rooms-renderer-first`: extend the existing scene substrate with a reusable ROOMS operational grammar and keep persistence/commands out of this branch.

Operational-Precedent: restaurant-floor

1. a date-by-room rack for stays and forward availability;
2. a floor/wing spatial view on the canonical `CartesianSceneCanvas`;
3. a semantic table that is fully keyboard-operable and carries every fact shown graphically.

This BI owns presentation grammar and projection contracts. It does not invent lodging persistence or mutating commands. The lodging domain model and command lifecycle remain in `BI-69F9BA89` and `BI-81F1D3EF`; those later adapters must supply this same view contract.

## Gap analysis

### Current DPF state

| Area | Current state on `origin/main` | Gap |
| --- | --- | --- |
| Restaurant | PR `#3825` delivered the business-grade host-stand floor over authored geometry, live table state, reservation/waitlist demand, server load, transactional seating/moving, and a customer-safe projection. | Live-install verification is still waiting on the governed upgrade batch, but the product implementation is merged. Do not build another restaurant canvas. |
| Generic spatial substrate | `OperationalSceneLayout`, `CartesianSceneCanvas`, typed scene placement refs, configure/read-only/operate modes, and theme-aware resource nodes are present. | `ROOMS` has no domain presentation adapter; the Workspace falls back to generic zone cards. |
| Hotel/lodging | `deriveTwinProfile` and business-view profiles know the `ROOMS` grammar; lodging BIs define the domain and cockpit work. | No hotel archetype is provisioned yet, no stay/housekeeping authority is implemented, and no room rack, arrival/departure lane, turnover risk view, or room-specific list alternative renders. |
| Other room-based businesses | Pet boarding and privacy-sensitive care can resolve to `ROOMS`. | Reusing a hotel-specific component directly would leak vocabulary and privacy assumptions across domains. |

### Product research

| Product | What works | What DPF should improve |
| --- | --- | --- |
| Toast Tables | Live floor first; waiting parties adjacent; tables carry status, server assignment, and turn progress; direct seating/moving keeps the host in context. | Avoid long-press-only interaction and color-only state. Keep a complete keyboard/list path and explain conflicts before confirmation. |
| OpenTable | Custom floor plans, flexible table inventory/types, assignment recommendations, POS-derived status, and shift/covers context. | Keep recommendations advisory and show why a placement fits; do not let performance reporting crowd the operational first viewport. |
| Cloudbeds | The calendar is the primary workspace; room rows cross dates; an unassigned-reservation panel exposes demand; continuous-availability checks explain failed assignments; locks protect intentional room placement. | Put turnover readiness and assignment risk in the same first viewport rather than requiring a separate housekeeping/reporting trip. Separate room condition from sellability. |
| Mews | Timeline plus a space-status report grouped by floor; explicit arrivals, departures, stayovers, clean/dirty/inspected/out-of-order summaries; staff assignment is visible. | Do not encode the entire state in color. Show occupancy, readiness, inventory, and privacy as independent labeled axes. |
| Oracle OPERA Cloud | Room-management coverage includes forecasts, housekeeping boards, floor plans, discrepancy handling, maintenance, out-of-order/out-of-service, and attendant work. | Reduce enterprise-screen hopping: one room selection should keep the rack, physical context, exception, and safe detail together. |

Primary sources:

- Toast Tables: <https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist?lang=en_US>
- OpenTable table management: <https://www.opentable.com/restaurant-solutions/products/table-management/>
- Cloudbeds calendar quick actions: <https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48384262863771-Managing-Reservations-and-Quick-Actions-on-the-New-Calendar>
- Cloudbeds unassigned reservations: <https://myfrontdesk.cloudbeds.com/hc/en-us/articles/217997178-Find-and-handle-unassigned-reservations>
- Mews timeline: <https://help.mews.com/s/article/timeline>
- Mews space-status report: <https://help.mews.com/s/article/space-status-report>
- Oracle OPERA room management: <https://docs.oracle.com/en/industries/hospitality/opera-cloud/21.5/ocsuh/c_housekeeping_room_management.htm>

## UX fit review — ROOMS spatial operations

- **Decision:** fits with guardrails.
- **Owning area:** Workspace.
- **Route family:** existing `/workspace`; no new global or section route.
- **Primary persona:** front-desk/host/operations lead deciding what can be assigned now and what threatens the next arrival; mobile housekeeping worker receives a compact task-oriented rendition.
- **Navigation layer:** local mode switch only: `Room rack`, `Floor & wing`, `Accessible list`.
- **Reuse/convergence:** reuse `CartesianSceneCanvas`, report-kit status metadata, `TwinView`/Workspace shell, and the existing spatial layout contract. Extract shared spatial status/selection presentation instead of creating another canvas dialect.
- **Source truth:** one `RoomsOperationalView` projection. Occupancy, readiness, inventory, privacy, stays, exceptions, and workload remain separate fields; the component never derives bookability from cleanliness alone.
- **Empty/failure behavior:** no rooms shows a setup/recovery message; missing stay/readiness data is labeled unavailable rather than rendered as zero or ready.
- **AI boundary:** read-only in this BI. A later assignment recommendation must preview room, stay, constraints, consequences, and alternatives before explicit confirmation.
- **Privacy:** rack/floor labels never require a guest or patient name. Fixtures and default cells use reservation/visit-safe references; care mode suppresses sensitive notes entirely.
- **Evidence before merge:** projection tests for three domains, component keyboard/list parity, 40-room density fixture, mobile and 200% zoom screenshots, theme scan, measured UX-fit manifest, production build, and served-route exercise.
- **Captured in:** this plan and `docs/ux-fit/2026-07-31-rooms-spatial-operations.ux-fit.json`.

## Architecture review (advisory)

- **Alignment summary:** aligned with guardrails.
- **Findings:**
  - `[important]` A hotel-only renderer would duplicate the existing `ROOMS` template and make boarding/care drift. **Edit:** define domain-neutral room/resource presentation and vocabulary adapters, with three fixtures proving separation.
  - `[important]` Treating clean/dirty as availability would collapse distinct authorities. **Edit:** keep `occupancy`, `readiness`, and `inventory` axes independent in the projection and visual treatment.
  - `[important]` A new canvas engine or route would duplicate established substrate. **Edit:** compose `CartesianSceneCanvas` inside the existing Workspace twin mount and add only a local mode switch.
  - `[important]` Client-only assignment would bypass the future stay/allocation transaction. **Edit:** keep this BI read-only; later commands consume `BI-69F9BA89` and use the versioned operational-command contract.
  - `[minor]` Dense visual cells can exclude keyboard and low-vision users. **Edit:** make the semantic table a first-class mode, preserve text labels in every cell, use 44px targets, and verify at 200% zoom.
- **Standards adopted:** incumbent operational precedents above; DPF spatial scene contract; portal usability standards; theme tokens; first-class text alternatives.
- **Recommended next step:** implement the projection and modes here, then let lodging persistence and commands bind to the stable contract in their own BIs.

## Delivery plan

### Phase 1 — Test-drive the room projection contract

**Deliverable:** a pure, domain-neutral `RoomsOperationalView` contract and validators/projectors.

- Add `apps/web/lib/twin/rooms-operations.ts` and focused tests.
- Model independent axes: occupancy, readiness, inventory, privacy, forward stay blocks, assignment lock, staff/task ownership, and exceptions.
- Provide selectors for summaries, ranked exceptions, status intent, floor/wing grouping, and privacy-safe labels.
- Prove hotel, pet-boarding, and inpatient fixtures do not require a shared domain record or sensitive identity.

Verification: run the focused projection test and observe red before implementation, then green after the minimum contract exists.

### Phase 2 — Build the coordinated rack, spatial, and list surface

**Deliverable:** `RoomsOperations` and small focused subcomponents under `apps/web/components/twin/rooms/`.

- Default to the room rack because date × room is the primary lodging assignment grammar.
- Keep arrivals/departures/unassigned demand and ranked readiness/maintenance exceptions adjacent.
- Add `Floor & wing` using `CartesianSceneCanvas` and the same presentation map.
- Add a semantic `Accessible list` with every graphical fact and room-selection parity.
- Keep detail in a side panel/inline drawer; do not navigate away for routine inspection.
- Use only theme variables/report-kit intents; text accompanies every color/icon.

Verification: component tests cover mode changes, room selection, keyboard access, empty state, privacy, and status-axis labels.

### Phase 3 — Integrate ROOMS into Workspace and refactor shared seams

**Deliverable:** the existing Workspace twin mount chooses `RoomsOperations` whenever `profile.template === "ROOMS"`.

- Extend `WorkspaceTwinPresentation` with a room view produced from one adapter seam.
- Preserve the current restaurant specialization and all non-spatial twin paths.
- Extract roughly 20% of the change into reusable scene-presentation/selection helpers shared by the room rack and Cartesian view; do not copy restaurant-specific mapping.
- Keep current live snapshots honest: unsupported axes render `Unavailable`, while deterministic demo data carries an explicit Demo badge.

Verification: Workspace tests prove `ROOMS` uses the coordinated renderer, `FLOOR` still uses `RestaurantFloorOperations`, and board twins remain unchanged.

### Phase 4 — Evidence, docs, and handoff

**Deliverable:** a merge-ready, documented, measured UI increment.

- Add a 40-room hotel stress fixture plus boarding and privacy-safe care fixtures.
- Update the Workspace/storefront user guide to explain rack/floor/list modes and the current read-only boundary.
- Commit the measured UX-fit manifest with exact UI file coverage.
- Run focused tests, full affected package tests, typecheck/production build, and governed browser verification through `local-integration-ci`.
- Capture screenshots at desktop, tablet/mobile, dark/light theme, and 200% zoom.
- Record evidence on `BI-CCE939AF` and `WC-D56EADD2`; commit with DCO, push, open a ready PR, run `pnpm pr:health`, and queue only when every check and review thread is terminal.

## Risks and rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| The rack looks hotel-specific in boarding/care | Vocabulary is injected; fixtures enforce guest/animal/patient-safe wording and privacy. | Fall back to the semantic list for an unsupported adapter without removing the shared contract. |
| Dense 40-room layouts overload the first viewport | Summary + exception lane lead; rack supports compact scrolling and local filters; floor is secondary. | Default large properties to the table mode while retaining the rack option. |
| Generic snapshots lack room axes | Preserve `unknown` explicitly and never infer ready/sellable from intent or absence. | Use the existing generic TwinView until a domain adapter supplies minimum fields. |
| Shared Cartesian changes regress the restaurant | Add contract tests for existing node types and keep restaurant bindings untouched. | Revert only the shared helper extraction; room projection/component remains isolated. |
| Users expect mutations from selectable rooms | Read-only language and no action button in this BI; future actions require preview + server command. | Disable selection detail without removing the visualization. |

No rollback path deletes or rewrites bookings, rooms, layouts, staff, stays, or work evidence. This BI adds no migration.

## Definition of done

- A `ROOMS` Workspace renders a recognizable room rack rather than a generic card dashboard.
- Rack, floor/wing, and semantic list share one projection and selection state.
- Occupancy, housekeeping readiness, sellability, and privacy are visibly separate and never color-only.
- Arrivals, departures, stayovers, unassigned demand, turnover threats, maintenance blocks, and staff workload are present when supplied and honestly unavailable when not.
- Hotel, boarding, and inpatient fixtures prove vocabulary and privacy isolation.
- The surface remains useful on mobile and at 200% zoom, with keyboard-operable controls and a full text alternative.
- Approximately 20% of the implementation refactors shared scene presentation/selection seams.
- Tests, production build, UX verification, docs impact, and the measured UX-fit manifest are recorded before the PR is opened.

## Backlog coverage

- Decision: atomic
- Parent: `BI-CCE939AF`
- Receipt: `cmsa53fkf087p01qqumn9etic`
- Rationale: the projection is not user-visible, the renderer is unreachable without Workspace integration, and integration is unsafe without cross-domain privacy, accessibility, and UX evidence; all four phases therefore form one deployable renderer slice.
- Dependencies: `projection-contract` → `coordinated-renderer` → `workspace-integration` → `cross-domain-evidence`; lodging persistence and commands remain independently tracked by `BI-69F9BA89` and `BI-81F1D3EF`.
