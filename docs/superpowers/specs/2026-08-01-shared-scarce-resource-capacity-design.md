# Shared Scarce-Resource Capacity Design

- **Backlog:** `BI-D1D54D93`
- **Work Capsule:** `WC-2C4CCA14`
- **Unblocks:** `BI-CD2A412D`, `BI-B1C4A514`, `BI-094A0A1D`,
  `BI-DD6C4354`, `BI-495B1461`, `BI-4939EE33`, `BI-F8143960`, and the
  physical-archetype operational workspaces
- **Plan:**
  `docs/superpowers/plans/2026-08-01-shared-scarce-resource-capacity.md`
- **Umbrella:**
  `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`

## Decision

DPF will establish a **typed runtime mirror**, not a new universal resource
database authority.

Existing bounded contexts keep their canonical records:

- people and bookable-provider time remain in `ServiceProvider`,
  `ProviderService`, and `ProviderAvailability`;
- restaurant and hospitality capacity remains in `HospitalityResource` and its
  availability/allocation models;
- clinical rooms and equipment remain in `CareResource` and care allocations;
- rental inventory remains in `RentableUnit`, agreements, and holds;
- workforce shifts and co-scheduled resources remain in `StaffingShift`,
  `StaffingAssignment`, and `StaffingResourceLink`;
- field assets, locations, work, and travel remain in their field-operation
  owners;
- `OperationalSceneLayout` continues to own placement only.

The shared layer derives an archetype-gated resource profile and adapts these
sources into one read contract for capacity, availability, utilization,
conflicts, and source health. Domain commands continue to enforce conflicts at
their authoritative transaction boundary.

### Governed options

Decision `DI-23BD40A7AA2E` compared three options:

| Option | Composite | Result |
| --- | ---: | --- |
| New canonical resource tables | 3.182 | Rejected: premature authority migration and fleet-wide blast radius |
| Typed runtime mirror | **4.657** | **Selected: high confidence** |
| Persisted identity bridge | 4.195 | Deferred until adapter evidence proves a durable cross-domain identity need |

The selected option won by 0.462 with strong structured coverage, 5.9%
semantic fallback, and no commandment conflict. The strongest positive
contributors were Research and Use Standards and Never Assume—Verify. The
decision also follows the kernel's “Mirror, don't migrate” and “Audit Existing
Schema Before Adding Large Features” principles.

## Design grounding

- **Existing specifications reviewed:**
  - `docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md`
  - `docs/superpowers/specs/2026-07-17-organization-workforce-staffing-scheduling-design.md`
  - `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md`
  - `docs/superpowers/specs/2026-07-30-food-hospitality-resource-capacity-design.md`
  - `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
- **Current substrate reviewed:** `ArchetypeDefinition`, `TwinProfile`,
  `FieldDispatchProfile`, `SchedulingDefaults`, `ServiceProvider`,
  `ProviderAvailability`, `BookingHold`, `HospitalityResource`, `CareResource`,
  `RentableUnit`, `StaffingResourceLink`, `FixedAsset`, and
  `OperationalSceneLayout`.
- **Live backlog reviewed:** the shared dependency and 21 category resource
  items, including beauty, rental, HOA/property, trades/HVAC, healthcare,
  fitness/classes, venue, and warehousing.
- **Code graph result:** the committed code graph returned no curated result for
  the compound resource queries, so direct source/schema inspection is the
  grounding authority for this design.

## Problem

DPF already models scarce resources, but each bounded context exposes a
different shape. Operational-twin and owner-attention consumers would otherwise
repeat source-specific joins and interval logic, or create another central table
that competes with valid domain owners.

The shared problem is not “where should every resource row live?” It is:

1. which resource/capacity patterns apply to this archetype;
2. which existing source owns each resource and allocation;
3. how those sources become a bounded, typed operational view;
4. how intervals, buffers, travel, capacity, and conflicts are interpreted
   consistently; and
5. how missing/degraded sources remain visible rather than becoming fabricated
   availability.

## Archetype capacity profile

Add a pure `deriveResourceCapacityProfile(archetype)` function beside the
existing `deriveTwinProfile` and `deriveFieldDispatchProfile` family in
`@dpf/storefront-templates`.

The profile is derived from canonical archetype axes, scheduling defaults,
field-dispatch profile, and twin profile. It is not a second hand-authored
taxonomy.

```ts
type ResourceCapacityPattern =
  | "appointment"
  | "dispatch"
  | "rental"
  | "class"
  | "venue"
  | "project-resource";

type ResourceAuthority =
  | "provider-calendar"
  | "staffing"
  | "hospitality"
  | "care"
  | "rental"
  | "field-operations";

interface ResourceCapacityProfile {
  archetypeId: string;
  category: ArchetypeCategory;
  enabled: boolean;
  patterns: ResourceCapacityPattern[];
  authorities: ResourceAuthority[];
  resourceNoun: TwinNoun;
  physical: boolean;
  forwardHorizon: boolean;
  supportsBuffers: boolean;
  supportsTravel: boolean;
}
```

The initial rule matrix must represent at least:

| Pattern | Derivation signal | Representative archetypes | Primary authority |
| --- | --- | --- | --- |
| appointment | `schedulingPattern=slot` / BOOK | hair salon, healthcare | provider calendar plus vertical physical owner |
| dispatch | field-dispatch enabled / TERRITORY | HVAC, moving | field operations plus staffing |
| rental | reservation-and-return / YARD | equipment rental | rental |
| class | `schedulingPattern=class` / BOOK class-grid | fitness, education | provider calendar plus staffing |
| venue | VENUE | event venue | hospitality or venue-domain adapter when present |
| project-resource | project/job-site axes / TERRITORY | construction, HOA work | field operations plus staffing |

Derivation is archetype-gated: a source adapter cannot make a resource visible
for an archetype whose profile does not declare the matching pattern and
authority.

## Normalized runtime contract

The web runtime owns a source-neutral contract under
`apps/web/lib/capacity/`. It is a read model, never an alternate write model.

```ts
interface CapacityResourceRef {
  authority: ResourceAuthority;
  resourceType: string;
  resourceId: string;
}

interface CapacityResource {
  ref: CapacityResourceRef;
  organizationId: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  status: "available" | "busy" | "blocked" | "offline" | "unknown";
  locationRef?: string;
  capabilityKeys: string[];
  sourceVersion?: string;
}

interface CapacityInterval {
  startAt: Date;
  endAt: Date;
  preparationMinutes: number;
  cleanupMinutes: number;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
}

interface CapacityAllocation {
  allocationId: string;
  resourceRef: CapacityResourceRef;
  demandRef: string;
  interval: CapacityInterval;
  quantity: number;
  lifecycle: "held" | "confirmed" | "active" | "released" | "cancelled";
}
```

The normalized snapshot includes resources, allocations, availability windows,
attention signals, source watermarks, and degraded-source diagnostics. Every
record retains its authority and source identifier so a later operator command
can route back to the correct domain.

## Adapter registry

Each adapter:

- declares one `ResourceAuthority`;
- states which profile patterns it supports;
- loads only organization-scoped records from its canonical source;
- normalizes resource, availability, allocation, and watermark facts;
- returns a typed unsupported/degraded result when the source is absent;
- never writes through the mirror.

The registry refuses duplicate authority registrations and skips adapters that
the derived archetype profile does not authorize. Initial contract tests cover
provider calendar, staffing, hospitality, care, rental, and field-operation
adapter descriptors. Vertical PRs add concrete loaders as their authoritative
sources are exercised.

Descriptor presence is not readiness. `venue-operations`, pet occupancy, and
other patterns without a complete physical-resource owner remain explicitly
degraded until their vertical PR establishes one. In particular, the
Food & Hospitality-owned `HospitalityResource` must not be reused as the
physical-space authority for the separate Live Events & Venues category.
Likewise, finance-owned `FixedAsset` is not an operational field-asset source:
it lacks the organization and scheduling contracts required by this mirror.
Adding an authority requires its descriptor, profile-gating tests, and a named
canonical source in the same PR; registering a loader requires organization
scope and watermark contract tests.

## Shared interval and conflict semantics

One pure interval module defines:

- effective footprint = travel-before + preparation + service + cleanup +
  travel-after;
- half-open interval overlap (`[start, end)`) so adjacent work does not
  conflict;
- quantity consumption against resource capacity;
- lifecycle filtering so released/cancelled allocations do not consume;
- utilization for a bounded window;
- conflict kinds: `time-overlap`, `capacity-exceeded`, `unavailable`,
  `capability-mismatch`, `travel-window`, and `source-degraded`.

This computation predicts and explains conflicts. Atomic enforcement remains
inside the canonical domain transaction and existing database constraints. The
shared mirror must never label an assignment “safe to commit” merely because a
read snapshot showed no conflict.

## Attention contract

The shared projection emits structured signals, not English tied to one
vertical:

- conflicting demand;
- idle/open capacity opportunity;
- blocked/offline resource;
- capability mismatch;
- travel-window infeasibility;
- degraded or stale authority.

Vertical presentations supply owner language (“open chair for 45 minutes,”
“truck cannot reach the next job,” “room unavailable for massage”). The common
signal retains resource and demand references for drill-through and action.

## Performance and failure behavior

- Profile derivation is pure and deterministic.
- Adapter loads run in parallel under the existing bounded operations-load
  runtime.
- The projection is linearithmic at worst in allocations per resource; it must
  not scan unrelated organizations or archetypes.
- Missing adapters return `source-degraded`; they never imply zero demand or
  free capacity.
- The hot path carries source watermarks and can be cached with bounded
  staleness; commands always re-check at the authoritative write boundary.

## UX fit

This concern adds no route or user-facing control, so direct UX verification is
not applicable. Its output contract is specifically designed for the existing
Business Operations workspace, Cartesian scene/list parity, first-viewport
attention, and owner-language vertical presentations. Each consuming vertical
must perform its own measured UX review and latency verification.

## Migration and rollout

No Prisma migration is required. The mirror reads existing canonical models and
adds TypeScript contracts, derivation, registry, projection, tests, and
architecture documentation.

Rollout is additive:

1. ship profile, registry, and pure projection;
2. bind beauty to provider/staffing adapters;
3. add rental, hotel, HOA, HVAC, and other adapters through their vertical PRs;
4. evaluate a persisted identity bridge only after at least three independently
   implemented verticals reveal a repeated identity or availability write need.

## Verification

- profile matrix covers appointment, dispatch, rental, class, venue, and
  project-resource patterns and rejects non-applicable adapters;
- interval tests cover buffers, travel, adjacency, lifecycle release, capacity,
  and utilization;
- registry tests cover duplicate authority, unsupported, degraded, and
  organization-scoped aggregation;
- adapter contract fixtures prove source references and watermarks survive the
  mirror;
- source-local typecheck and targeted tests pass;
- governed merged-code exhaustive tests and production build pass before PR;
- UX and migration are recorded as not applicable with the concrete reasons
  above.
