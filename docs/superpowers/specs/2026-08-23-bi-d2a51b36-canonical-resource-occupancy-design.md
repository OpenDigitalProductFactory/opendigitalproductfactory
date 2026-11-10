---
status: active
---

# Canonical resource occupancy for animal housing

- **Backlog item:** `BI-D2A51B36`
- **Epic:** `EP-5102F494`
- **Workroom:** `WC-19B43FAC`
- **Review state:** Ready for independent specification approval
- **Architecture dependency:** `BI-2C80E6EA`, merged in PR #4494
- **Earlier decision:** `DI-C955877F245D`, superseded by the verified-substrate decision below
- **Companion plan:** `docs/superpowers/plans/2026-08-23-bi-d2a51b36-resource-occupancy.md`

## Decision

Animal housing uses the canonical `Resource` and `ResourceCapacityAllocation`
family already in production. A kennel, run, pen, or foster home is a
capacity-bearing `Resource`. An animal's stay is an append-preserving allocation
with `demandSlug: "animal-occupancy"`, `demandRef: <animalRef>`, and
`releasedAt` as the authoritative close.

The 2026-08-23 proposal to add `ResourceOccupancy` and an
`animal_welfare` resource domain is rejected after verification against current
`main`. PRs #5000 and #5022 proved that the existing allocation ledger preserves
movement history and projects safe capacity without a new table. Animal welfare
uses the existing `care` domain because care became subject-agnostic in migration
`20260822164000`. This is the minimum normalized substrate and avoids creating a
second occupancy authority.

## Outcomes

1. **OBJ-HOUSING-001:** A shelter operator can create and maintain kennels and
   foster homes from the Ward without learning schema vocabulary.
2. **OBJ-HOUSING-002:** An operator can place, move, and release an animal while
   retaining its housing history.
3. **OBJ-HOUSING-003:** The Ward reports one honest combined capacity picture
   across on-site and foster housing, excluding blocked, retired, and full units.
4. **OBJ-HOUSING-004:** Concurrent moves cannot overfill a destination or leave
   an animal with two active placements.
5. **OBJ-HOUSING-005:** Hospitality and animal welfare share canonical Resource
   persistence helpers; no `animal-resources` clone is introduced.
6. **OBJ-HOUSING-006:** The existing `/workspace/ward` map/list remains the
   operator's home surface, with direct actions that work at desktop and narrow
   widths.

## Acceptance manifest

| ID | Objectives | Acceptance |
| --- | --- | --- |
| AC-HOUSING-001 | OBJ-HOUSING-001, OBJ-HOUSING-005 | Create, rename, block, unblock, and retire a configured housing Resource with optimistic version checks. |
| AC-HOUSING-002 | OBJ-HOUSING-002, OBJ-HOUSING-003, OBJ-HOUSING-004 | Place or move an in-care animal into a compatible unit; the prior stay closes and one new active allocation is created atomically. |
| AC-HOUSING-003 | OBJ-HOUSING-002 | Release closes the active stay with a reason and never deletes history. |
| AC-HOUSING-004 | OBJ-HOUSING-001, OBJ-HOUSING-003, OBJ-HOUSING-004 | Organization mismatch, unknown animal, wrong domain/kind/unit, blocked or retired resource, nonpositive capacity, and over-capacity moves fail explicitly. |
| AC-HOUSING-005 | OBJ-HOUSING-004 | Subject and destination transaction locks plus a serializable transaction prevent concurrent double placement and overfill. |
| AC-HOUSING-006 | OBJ-HOUSING-001, OBJ-HOUSING-002, OBJ-HOUSING-003, OBJ-HOUSING-005 | `kennel` and `foster-home` use the same read, command, history, and capacity contracts. |
| AC-HOUSING-007 | OBJ-HOUSING-001, OBJ-HOUSING-006 | Ward actions expose pending, validation, permission, conflict, retry, and settled-success states without adding navigation. |
| AC-HOUSING-008 | OBJ-HOUSING-003, OBJ-HOUSING-005, OBJ-HOUSING-006 | Existing ward, cockpit, animal, Resource, and hospitality behavior remains green. |
| AC-HOUSING-009 | OBJ-HOUSING-001, OBJ-HOUSING-002, OBJ-HOUSING-003, OBJ-HOUSING-004, OBJ-HOUSING-005, OBJ-HOUSING-006 | The DCO-signed exact tree passes focused tests, typecheck, guards, UX fit, semantic review, local integration CI, PR health, and protected squash merge. |

## Research and precedent

The design adopts operating patterns, not dependencies.

- Animal Shelter Manager models foster, adoption, and transfer as time-ordered
  movements with a current location. DPF adopts history and rejects its
  rescue-specific monolith.
- RefuPet keeps the animal record and shelter work together in a mobile-capable
  surface. DPF keeps the Ward as the single operating surface and rejects a
  separate housing application.
- Open Animal Rescue favors small-rescue operability and local control. DPF
  adopts that posture while keeping the data model reusable.
- OpenTable-style resource management validates named units, service areas,
  capacity, and blocked state. DPF adopts the resource pattern and rejects a
  hospitality clone for animal welfare.

## Verified substrate and prior delivery

PR #4494 made care subjects and the Resource family reusable. PR #5000 shipped
the pure ward occupancy projection. PR #5022 shipped the map/list Ward and the
cockpit capacity projection. Those deliveries establish these authorities:

| Concern | Authority |
| --- | --- |
| Unit identity, kind, capacity, area, block reason, lifecycle | `Resource` |
| Housing episode and history | `ResourceCapacityAllocation` |
| Animal identity | `AdoptableAnimal.animalRef` |
| Allowed housing kinds and ceilings | activation profile `resourceKinds` |
| Current board and capacity | `apps/web/lib/ward/*` projection |
| Operator surface | `/workspace/ward` |

The remaining gap is write reach: the branch has pure `buildPlacement`,
`buildRelease`, and seed shapes, but no governed command path invokes them.

## Resource contract

Housing kinds are open, profile-governed values. Pet rescue and animal shelter
declare at least `kennel` and `foster-home`, both with
`capacityUnit: "animals"`. Private foster addresses do not belong in Resource
labels or the general Ward; only an operator-safe label and service area are
projected.

A shared repository validates profile kind, capacity unit, maximum capacity,
organization/storefront scope, lifecycle, and expected version. Animal-welfare
and hospitality adapters use this repository for canonical Resource persistence;
legacy hospitality mirroring remains compatibility work, not a second authority.

The shared command boundary uses server-derived tenancy and a narrow public
shape. Callers may supply labels and capacity facts, but never an organization,
storefront, resource domain, or capacity unit:

```ts
type HousingResourceCommand =
  | {
      action: "create";
      label: string;
      kindSlug: "kennel" | "foster-home";
      serviceArea: string | null;
      capacity: number;
      idempotencyKey: string;
    }
  | {
      action: "update";
      resourceId: string;
      expectedVersion: number;
      label?: string;
      serviceArea?: string | null;
      capacity?: number;
      blockedReason?: string | null;
      lifecycle?: "active" | "retired";
      idempotencyKey: string;
    };
```

The repository resolves `organizationId`, `storefrontId`, `domain: "care"`,
`capacityUnit: "animals"`, the configured kind ceiling, and the current version
from the authenticated server context. Success returns the full authoritative
resource projection, including its new version. Version mismatch returns
`resource_conflict`; validation, authorization, and idempotency errors use stable
machine codes plus operator-readable messages.

## Command and HTTP contracts

The generic routes are adapters over shared repositories, not new authorities:

| Route | Method | Contract |
| --- | --- | --- |
| `/api/resources` | `GET` | List active and retired resources visible to the authenticated organization, filtered only by server-allowed domain/kind query values. |
| `/api/resources` | `POST` | Create one profile-governed resource from `HousingResourceCommand.action = "create"`; return `201` with the authoritative projection. |
| `/api/resources/[resourceId]` | `PATCH` | Rename, resize, block/unblock, or retire with `expectedVersion`; return `409 resource_conflict` when stale. |
| `/api/resource-occupancy` | `POST` | Place or move one subject using `PlacementCommand`; return current placement and destination capacity. |
| `/api/resource-occupancy/[allocationId]` | `PATCH` | Release the current stay using `ReleaseCommand`; return the closed allocation and current placement `null`. |

The Ward server actions call these services directly after `requireAdmin()` and
server-side organization/storefront resolution. They do not make loopback HTTP
requests and do not accept authority-bearing tenancy fields from form data.

```ts
type PlacementCommand = {
  animalRef: string;
  destinationResourceId: string;
  quantity: 1;
  placedAt: string;
  reason?: string;
  idempotencyKey: string;
};

type ReleaseCommand = {
  allocationId: string;
  expectedResourceId: string;
  releasedAt: string;
  reason: string;
  idempotencyKey: string;
};

type OccupancyResult = {
  allocationId: string;
  animalRef: string;
  resourceId: string;
  placedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  capacity: { occupied: number; total: number; available: number };
};
```

Invalid JSON or fields return `400 invalid_request`; unknown or cross-tenant
subjects/resources return `404 not_found`; blocked, retired, incompatible, or
full destinations return `409` with a specific stable code; missing write
authority returns `403 forbidden`; unexpected failures return a correlation id
without leaking foster or tenancy data.

## Persistence mapping

No new entity is introduced. The write contract maps exactly to deployed
columns:

| Contract fact | Canonical persistence |
| --- | --- |
| Housing unit identity and optimistic version | `Resource.id`, `Resource.version` |
| Operator-safe label and area | `Resource.name`, `Resource.serviceArea` |
| Kind and unit | `Resource.kindSlug`, `Resource.capacityUnit` |
| Capacity and availability | `Resource.capacity`, active allocation quantity sum |
| Block/retire state | existing Resource lifecycle and block fields |
| Animal placement | `ResourceCapacityAllocation.demandSlug = "animal-occupancy"`, `demandRef = animalRef` |
| Stay interval | allocation `startsAt`, technical `endsAt`, business `releasedAt` |
| Move/release audit | allocation `releaseReason`, immutable prior row retained |
| Retry identity | existing allocation/request idempotency key contract |

Reads always derive current placement from the single unreleased allocation;
they never persist a duplicate `currentResourceId` on `AdoptableAnimal`.

## Occupancy transaction

The generic command accepts an organization, subject demand identity,
destination Resource, quantity, time, and idempotency key. The animal adapter
resolves `AdoptableAnimal` under the same organization and permits only in-care
animals.

Within one serializable transaction it:

1. acquires deterministic transaction-scoped locks for the subject and
   destination;
2. resolves the active destination Resource and rejects blocked, wrong-domain,
   unconfigured-kind, wrong-unit, or cross-organization rows;
3. reads all active allocations for the subject and destination;
4. excludes the subject's current same-unit quantity from the capacity check;
5. closes every prior active subject allocation with `releaseReason: "moved"`;
6. creates or returns the idempotent destination allocation;
7. returns the authoritative current placement and capacity delta.

A release performs the same subject lock and closes the active row without
creating another. PostgreSQL serialization conflicts are retried only within a
small bounded count. Application errors are stable and operator-readable.

`endsAt` remains the existing ten-year technical horizon; `releasedAt` is the
business close. This preserves the deployed schema and its booking semantics.

## UX contract

The Ward continues to lead with occupancy and free capacity. Routine placement
is reachable on the board. Less frequent housing setup is progressively
disclosed. The form offers only configured `kennel` and `foster-home` kinds and
only available destinations. It must distinguish:

- no housing has been configured;
- housing exists but every unit is full, blocked, or incompatible;
- every animal is placed;
- a concurrent update won;
- the operator lacks write authority;
- the save failed and can be retried.

The map and list describe the same population. State is never color-only,
controls retain a 44-pixel target, and successful mutations refresh the
authoritative server projection before announcing completion.

## Security and privacy

- Admin authorization is required for writes; organization/storefront identity
  is derived on the server.
- A caller cannot submit an organization id, domain, capacity unit, or arbitrary
  demand slug as authority.
- Foster labels must not expose a home address in the Ward.
- Transition reasons are operational notes, not medical records.
- History is append-preserving; correction closes rows rather than deleting them.
- Capacity is evidence for intake, not authorization to accept an animal.

## Data and migration disposition

No Prisma schema change, migration, or backfill is required. Existing resources
and allocations are read in place. Rollback removes the new commands and controls
while preserving all Resource and allocation rows.

## Delivery boundary

This BI delivers the missing housing write workflow and reconciles the original
design with already-merged ward work. Intake, rounds, adoption, veterinary,
supplies, funding, events, and Workspace composition stay in their ordered epic
items. Per-unit spatial tier and intake-from-empty-unit remain later ward
enhancements unless required to make this workflow usable.

Approximately twenty percent of the implementation converges shared Resource
validation/persistence and reduces vertical duplication; it does not fund an
unrelated refactor.
