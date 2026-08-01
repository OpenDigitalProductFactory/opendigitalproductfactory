# Beauty resource and capacity implementation plan

**Backlog:** `BI-CD2A412D`
**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
**Design:** `docs/superpowers/specs/2026-08-01-beauty-resource-capacity-design.md`
**Decision:** `DI-8AC8943BE2A2`
**Branch:** `feat/beauty-resource-capacity`

## Outcome

Deliver the business-grade data and projection foundation required by Salon BOOK: fixed chairs/stations/rooms, service eligibility, availability, allocations and holds, joint provider/resource conflicts, idle capacity, buffers, and mobile travel-window composition. No visual BOOK view ships in this PR.

## Execution sequence

### 1. Lock the archetype and schema contract with failing tests

- Extend resource-capacity profile tests so fixed-premises beauty resolves a beauty authority and mobile beauty does not.
- Add schema-shape tests for `BeautyResource`, `BeautyResourceService`, `BeautyResourceAvailability`, and `BeautyCapacityAllocation`.
- Add migration tests for tenant-safe foreign keys, one-demand-source checks, positive/non-empty intervals, active-lifecycle overlap prevention, and additive fleet safety.

### 2. Add beauty-owned physical resource authority

- Add the four Prisma models and inverse relations on `Organization`, `StorefrontConfig`, `StorefrontItem`, `StorefrontBooking`, and `BookingHold`.
- Add an additive migration with explicit new-table data-safety attestation, `btree_gist` reuse, check constraints, indexes, and a partial exclusion constraint for consuming allocation lifecycles.
- Do not copy people, provider calendars, bookings, or geometry into beauty tables.

### 3. Extend the shared capacity profile and interval primitives

- Add `beauty` to the closed capacity-authority contract and descriptor registry.
- Route appointment-pattern beauty archetypes through `provider-calendar + beauty + staffing`.
- Keep `mobile-beauty` on the field-operations/travel path.
- Refactor common interval expansion, overlap, gap, and conflict construction only where the extracted semantics remain vertical-neutral.

### 4. Build the beauty capacity adapter and deterministic analysis

- Add a bounded repository read for resources, service eligibility, availability, allocations, providers, provider services/availability, bookings, and holds for one organization and requested window.
- Project stable resource/capability/allocation/availability contracts with an operational watermark.
- Derive deterministic owner-language signals for resource overlap, provider overlap, unavailable/blocked resource, capability mismatch, unassigned demand, idle chair gaps, duration/buffer risk, late/no-show risk, group incompleteness, and mobile travel conflict.
- Report degraded or incomplete setup honestly; never infer universal resource eligibility.

### 5. Seed and fixture the real operating shapes

- Extend the canonical storefront activation/default seed path, not runtime patching.
- Seed representative fixed resources and eligibility for hair/barber, nail, spa, and training archetypes only when their canonical services exist.
- Add a committed busy-day fixture covering multiple providers, service specialization, a room-limited service, blocked chair, buffer, hold, gap, late/no-show risk, and a partially assigned group.
- Add mobile venue/address/travel fixtures without manufacturing a fixed resource.

### 6. Verify and publish

- Run focused package and web tests, Prisma format/generate/schema guards, migration apply, affected typecheck, and production build.
- Run the exact merged-tree governed local-CI gate before push/PR.
- Record query/projection timing and source-health evidence on `WC-8E46DB7B` and `BI-CD2A412D`.
- Update architecture/user documentation only where this substrate changes an exposed contract. The Salon BOOK PR owns operator workflow documentation because this PR adds no route or controls.
- Commit with DCO, push, open a ready PR with `Operational-Precedent: salon-chair-book`, run mechanical PR health, and enroll in the squash merge queue.

## Acceptance map

| Acceptance | Implementation evidence |
| --- | --- |
| Chairs/stations/rooms are real resources | Beauty schema, seed, and repository tests |
| Beautician + resource + duration jointly constrain a slot | Adapter matrix tests |
| Buffers, holds, and lifecycle consume/release capacity | Allocation/migration and interval tests |
| Conflicts and idle capacity reach Operations attention | Deterministic analysis tests |
| Hair, barber, nail, spa, trainer vocabulary is specific | Profile/formatter fixtures |
| Mobile artist travel/venue/group constraints remain intact | Mobile gating and travel fixtures |
| Archetype gating prevents leakage | All-archetype totality tests |
| Hot-path is bounded | Query-count and projection timing evidence |

## Backlog coverage

This plan is deliberately atomic under `BI-CD2A412D`. Schema without the adapter is unused substrate; the adapter without persisted resource identity invents authority; seed/fixtures without both cannot prove production readiness. The graphical Salon BOOK surface remains independently tracked by `BI-9FA3C3A4`.

- **Decision:** atomic
- **Coverage receipt:** `cmsa6bab70bqp01qq0q397zjp`

## Risks and rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| Generic resource model erases beauty semantics | Beauty bounded context + closed application vocabulary | Revert additive beauty tables/adapter |
| Fixed salon assumptions leak into mobile work | Explicit archetype routing and regression fixture | Disable beauty adapter for mobile; retain field operations |
| Provider and resource views disagree | Stable demand refs and one combined analysis pass | Degrade source and suppress assignment advice |
| Constraint wedges existing installs | Additive empty tables with in-file data-safe attestation | Revert migration before release; no existing data rewritten |
| Hot-path becomes query-heavy | Bounded eager reads, compound indexes, pure in-memory analysis | Feature-gate adapter while provider calendar remains available |
