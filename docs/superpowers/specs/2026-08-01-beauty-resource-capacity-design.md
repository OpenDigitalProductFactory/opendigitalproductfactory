# Beauty resource and capacity design

**Backlog:** `BI-CD2A412D`
**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
**Decision:** `DI-8AC8943BE2A2` (`beauty-bounded-context`, high confidence)
**Precedent:** `salon-chair-book` (Fresha scheduling, accessed 2026-07-28; recheck 2027-01-28)

## Outcome

Beauty and personal-care businesses gain an authoritative model for the fixed physical resources that constrain appointments: salon chairs, barber chairs, nail stations, treatment rooms, and trainer stations. The model joins—but does not absorb—provider skills and calendars, booking demand, holds, or authored scene geometry. It projects all of those authorities into the shared scarce-resource mirror so Operations can answer, quickly and truthfully, which qualified person and physical place can perform a service at a requested time.

Mobile beauty stays on the field/travel path. A venue, group size, event time, provider calendar, and travel window constrain mobile work; a fictional fixed salon chair does not.

## Current precedent and DPF adaptation

The current operational precedent corpus records Fresha's day-calendar hierarchy: team members and bookable resources form lanes; waitlist and gaps remain adjacent; appointments reserve duration and buffers; provider skill, availability, resource, duration, and group alignment prevent conflicts. DPF adopts joint provider/resource availability and intelligent gap identification, then strengthens the pattern in four ways:

1. chairs, stations, and rooms are stable business records rather than inferred calendar columns;
2. every state and conflict has a text equivalent and accessible agenda representation;
3. allocation lifecycle, idempotency, tenant scope, and optimistic version facts are explicit; and
4. mobile beauty composes with field operations instead of inheriting fixed-premises assumptions.

`apps/web/data/design-intelligence/operational-precedents.csv` remains the evidence source of truth. This spec does not duplicate the full vendor evidence.

## Ownership boundaries

| Concern | Canonical owner | Beauty relationship |
| --- | --- | --- |
| Chair, station, room identity and physical availability | `BeautyResource`, `BeautyResourceAvailability` | New bounded-context authority |
| Resource/service eligibility | `BeautyResourceService` | Explicit join to `StorefrontItem` |
| Physical capacity consumed by demand | `BeautyCapacityAllocation` | Versioned append-preserving ledger |
| Person, skills, working time | `ServiceProvider`, `ProviderService`, `ProviderAvailability` | Read and projected; never copied |
| Customer appointment and service duration | `StorefrontBooking`, `StorefrontItem` | Demand authority |
| Temporary checkout/booking claim | `BookingHold` | Demand authority |
| Floor position and shape | `OperationalSceneLayout` | Geometry references resource identity |
| Mobile route/travel | field-operations capacity adapter | Composed for `mobile-beauty` |
| Cross-vertical Operations read model | shared capacity contracts/registry | Beauty adapter projects into it |

`HospitalityResource`, `CareResource`, and `StaffingResourceLink` are intentionally not broadened. Their names and constraints encode different bounded contexts.

## Data contract

### `BeautyResource`

- tenant/storefront-scoped stable `resourceId`;
- closed application vocabulary for `kind`: `chair`, `station`, `room`;
- owner-facing label, status, capacity/unit, service area, blocked reason, version, and optional attributes;
- explicit service eligibility through `BeautyResourceService`;
- recurring/dated blocks through `BeautyResourceAvailability`;
- capacity consumption through `BeautyCapacityAllocation`.

### `BeautyResourceService`

The join records which active storefront services may use a resource. It makes room-limited facials, nail-station work, and chair-compatible hair services queryable without hiding eligibility in JSON. Absence means no declared service eligibility; the projection reports incomplete setup rather than assuming universal compatibility.

### `BeautyResourceAvailability`

Recurring weekly windows and dated available/unavailable windows mirror the established hospitality availability shape while remaining beauty-owned. Human working time remains in `ProviderAvailability`.

### `BeautyCapacityAllocation`

An allocation targets one beauty resource and exactly one demand source: booking or booking hold. It records occupied start/end, quantity, lifecycle, idempotency, release facts, and version. Preparation, cleanup, and travel are projected interval properties derived from service/booking configuration; the ledger persists the actual occupied interval so overlap enforcement is unambiguous.

The migration is additive and safe for populated installs. New-table checks enforce positive quantities, non-empty intervals, one demand source, tenant-safe compound foreign keys, and non-overlap for consuming lifecycles. As the tables are new and empty at migration time, no existing rows can violate the constraints.

The governed substrate measurement intentionally ratchets only `prismaModelCount` from 563 to 567. The four models have distinct identity, lifecycle, cardinality, and constraint semantics; folding eligibility, availability, or allocation history into resource JSON would prevent foreign-key integrity, overlap enforcement, and append-preserving release evidence. No other non-increasing substrate metric is relaxed.

## Shared projection

Add `beauty` to the closed `ResourceCapacityAuthority` list. Appointment-pattern beauty archetypes resolve `provider-calendar`, `beauty`, and `staffing`; `mobile-beauty` continues to resolve field operations and staffing. The beauty adapter returns:

- resources with capability keys derived from eligible services;
- resource availability and blocks;
- booking/hold allocations with prep and cleanup buffers;
- data-backed overlap, unavailable-resource, capability-mismatch, blocked-resource, idle-capacity, unassigned-demand, late/no-show-risk, and incomplete-assignment signals;
- source health and watermark facts.

Provider and beauty projections are reconciled by stable booking/hold demand references. The adapter must be organization-scoped and bounded to the requested window. It does not query historical Performance aggregates.

## Owner-language attention

Signals are deterministic and compact. Examples include:

- `Chair 3 is open for 45 min before Maya's color appointment.`
- `Treatment Room 1 is unavailable for the 2:00 facial.`
- `Ava is double-booked at 3:30.`
- `The 11:00 bridal group is not fully assigned.`
- `Travel from the prior venue leaves 12 min for a 25 min journey.`

The first viewport later shows only the top exception and one recommended action. This substrate supplies evidence, severity inputs, and stable references; the Salon BOOK UI owns presentation and commands.

## Performance and failure behavior

- Window-bounded reads use storefront/resource/time indexes and run independent provider/beauty reads concurrently.
- Pure interval and eligibility analysis reuses shared helpers; no N+1 provider/resource lookup.
- The later Operations selection path targets visible response <=100 ms and authoritative confirmation p95 <=500 ms.
- A missing or failed adapter reports degraded source health; it never invents availability or zero utilization.
- Incomplete setup is explicit. A salon without declared chairs/rooms/services receives setup guidance, not a production-looking empty schedule.

## Refactoring allocation

At least 20% of implementation effort is reserved for convergence:

- extend the shared capacity authority/profile rather than introduce a beauty-only read contract;
- reuse and, where necessary, extract pure half-open interval, buffer, overlap, and idle-gap helpers;
- keep one owner-language formatter and one beauty profile map for all fixed-premises beauty archetypes;
- centralize fixture builders so schema, adapter, and later BOOK tests cannot drift.

## Verification

- schema and migration guards for tenant scope, demand XOR, lifecycle overlap, and non-destructive apply;
- archetype totality and mobile-beauty gating;
- joint skill/provider/resource/duration/buffer matrices;
- held/confirmed/active/released allocation behavior and idempotency;
- room-limited, blocked chair, idle gap, overlap, late/no-show, bridal group, and mobile travel fixtures;
- bounded-query and projection timing evidence;
- exact governed local-CI, migration apply, exhaustive tests, typecheck, and production build.

This PR adds no route or graphical UI. Operator documentation lands with Salon BOOK, where the resource model becomes directly configurable and actionable.
