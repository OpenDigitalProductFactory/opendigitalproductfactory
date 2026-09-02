---
status: active
---

# Ward board: housing and occupancy implementation plan

> **For agentic workers:** one backlog item, one branch, one PR per phase. Red-green with
> `dpf-tdd`, guard-parity preflight and the exact-tree gate before any success claim, and
> `dpf-pr-with-dco` for handoff.

**Backlog item:** `BI-FB73D0B5`
**Epic:** `EP-5102F494`
**Depends on:** `BI-2C80E6EA` (subject-agnostic substrate — merged as PR #4494)
**Blocked-behind for later phases:** `BI-4F8A484C` (canonical subject identity)

## Outcome

A rescue can say **where each animal is** and **how many kennels are free** — the two questions the
2026-08-26 operating-day run could not answer at any point in the day (§6b, steps 1 and 16:00).

Design agreed with the founder against an interactive prototype: an occupancy board read like a
hotel front desk, with a list flip, per-animal situation, and intake straight from an empty unit.
This plan covers the data layer and the read surface. It does not build intake, rounds, holds or
the capacity assessment.

## Verified substrate — measured against `main`, 2026-09-02

Most of this is reach, not absence. Nothing here needs a new table.

| Need | Model | State |
|---|---|---|
| Housing unit | `Resource` — open `kindSlug`, `capacity`, `capacityUnit`, `serviceArea`, `blockedReason`, `attributes`, nullable `storefrontId`, `sourceRef` | exists, generic |
| Occupancy episode | `ResourceCapacityAllocation` — `demandSlug`/`demandRef`, `startsAt`/`endsAt`, `state`, `releasedAt`/`releaseReason` | exists, generic |
| Kennel already declared | `ANIMAL_WELFARE_ACTIVATION_PROFILE.processProfile.resourceKinds` = `[{ kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 }]`, with `housesSubjects: true` and `subjectTypes: ["animal"]` | **already declared** |
| Kind resolution | `resolveAdminResourceProfile()` is archetype-driven and resolves `kennel` correctly | exists |
| Spatial layout with tier | `OperationalSceneLayout` — `spaceKind`, `layoutState`, `underlayRef`, org-scoped | exists, unused here |

Two constraints found and respected:

- **`ResourceDomain` is a closed enum** — `beauty | hospitality | care | provider | workforce`. No
  shelter value. Use `care`: the care vertical is already subject-agnostic (migration
  `20260822164000`) and animal welfare is care. Widening the enum is a migration and is not
  justified by one archetype.
- **The admin resources route hardcodes `const ADMIN_RESOURCE_KIND = "table"`** and is threaded
  with `restaurant-table-attributes`. Generalising it is `BI-2C80E6EA`'s own step 1 and would
  disturb a shipped vertical, so this plan does **not** touch it. Kennel writes get their own path.

## The classification decision, recorded

`demandRef` carries `AdoptableAnimal.animalRef` — the storefront row's stable unique key — rather
than waiting for canonical subject identity.

Under the accommodation doctrine this is **pattern 3, polymorphic demand**, using an existing open
vocabulary with no schema change. It leans on a storefront-coupled row, deliberately: the
alternative is blocking the entire ward board behind `BI-4F8A484C`, which is deferred. When subject
identity lands, these rows migrate by `sourceRef` backfill — the same clone-to-canonical path the
hospitality → `Resource` migration already proved, and the reason that path exists.

What would change the answer: if `BI-4F8A484C` ships before phase 2, place occupancy against the
subject directly and skip the backfill.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-FB73D0B5`
- Receipt: blocked — no initiative scope baseline exists for this umbrella item, so
  `record_plan_backlog_coverage` returns `traceability-incomplete` and writes no receipt. A baseline
  is minted only by a passing `spec-approval` gate, which requires a reviewer independent of the
  artifact's author; the author cannot record it. This four-way table is the documented fallback
  the tool itself prescribes, and the blocking condition is stated here rather than as a backlog id
  that goes stale when that id closes.
- Dependencies: `BI-2C80E6EA` (subject-agnostic substrate, merged as PR #4494) for the canonical
  `Resource` and `ResourceCapacityAllocation` this reads; `BI-4F8A484C` (canonical subject identity,
  deferred) is **not** a dependency of any phase below — see the classification decision above for
  why `demandRef` carries the storefront key and how it migrates when identity lands.

| Deliverable | Independently shippable | Maps to | Requirement | Contract | Verification |
|---|---|---|---|---|---|
| phase-1-occupancy-projection | yes | -> `BI-FB73D0B5` | pet-rescue operating model §5 entities 7-8 | `apps/web/lib/ward/ward-occupancy.ts` | `apps/web/lib/ward/ward-occupancy.test.ts` |
| phase-2-kennel-roster-and-placement | yes | -> `BI-D58567DC` | canonical minimal substrate, elements 1 and 4 | `packages/db/prisma/schema/resource-scheduling.prisma` | route and adapter tests, phase 2 |
| phase-3-map-and-list-surface | yes | -> `BI-F91D0685` | pet-rescue operating model §7 per-role UX | `packages/db/prisma/schema/verticals-storefront.prisma` (`OperationalSceneLayout`) | surface tests, phase 3 |
| phase-4-cockpit-capacity | yes | -> `BI-A67AF6F0` | pet-rescue operating model §8, the 16:00 step | `apps/web/lib/twin/archetype-outcomes.ts` | `apps/web/lib/twin/archetype-outcomes.test.ts` |

Each phase ships on its own and leaves the product coherent: phase 1 is a projection nothing yet
reads, phase 2 lets a shelter record housing without a board to show it, phase 3 shows what phases
1-2 record, and phase 4 surfaces one number from it. No phase depends on a later one.

## Phases

### Phase 1 — occupancy projection *(this PR)*

`apps/web/lib/ward/ward-occupancy.ts`, pure and fully unit-tested. Given kennels, allocations and
animal names it produces the board: zones by the shelter's own `serviceArea`, units ordered
naturally, occupied/free/out-of-service counts, and the animals in care with **no kennel recorded**.

Properties the tests pin, each earned from the operating model rather than invented:

- A released allocation is history, not an occupant — housing is a timeline, which is what contact
  tracing needs (§2, the parvo case) even though tracing is not built.
- `blockedReason` keeps a unit out of the free count. A hotel room is empty between guests; a
  kennel awaiting a deep clean is not free, and the free count lies if it says otherwise.
- An animal in care with no open allocation is **named**, never silently dropped. A shelter that
  cannot locate an animal it is holding has a real gap and the board says so.
- No housing recorded and no housing free render differently. `summarizeKennelCapacity` returns
  `null` for the first — the same honesty the donation tile and `/performance` already keep.

### Phase 2 — kennel roster and placement writes

Create, rename, block and unblock a kennel; place an animal into one and release it. Kennel writes
take their own path rather than widening the table-coupled admin route. Seed the archetype's
declared `resourceKinds` on activation so a rescue is not asked to invent its own housing model.

### Phase 3 — the board surface

Map and list, occupancy header, per-unit occupant with photograph, empty unit as the intake
affordance. `OperationalSceneLayout` supplies position and **tier** — cat condos stack, which is the
requirement a flat restaurant floor never exercised.

### Phase 4 — capacity on the cockpit

`Kennels — N total · M free` beside the `Animals in care` tile shipped in PR #4972, closing the
16:00 step. Deliberately last: it reads a model built earlier, and a tile built first correctly
shows nothing.

## Definition of done for phase 1

- The projection is pure, covered, and imported by nothing that writes.
- Free, occupied and out-of-service counts are correct with blocked units and released allocations
  present.
- Unplaced animals are surfaced by name.
- No migration, no schema change, no change to any shipped vertical.
