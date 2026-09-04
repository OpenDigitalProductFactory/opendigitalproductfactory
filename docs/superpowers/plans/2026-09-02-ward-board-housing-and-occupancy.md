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

### Phase 1 — occupancy projection *(delivered)*

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

### Phase 2 — kennel roster and placement writes *(delivered: projection-side)*

`planSeedKennels`, `buildPlacement` and `buildRelease` shape the rows: a seed roster derived from
the archetype's declared `resourceKinds` with a stable `resourceKey` so re-seeding cannot double it,
an allocation carrying an idempotency key so a repeated place is the same move rather than a second
animal in the run, and a release that **closes** a stay with its reason instead of deleting the row.

Closing rather than deleting is what keeps housing a timeline: the row saying an animal shared a
ward with the index case has to survive that animal moving out of it.

`ResourceCapacityAllocation.endsAt` is required and a shelter stay has no known end, so `releasedAt`
is authoritative and `endsAt` is a ten-year horizon. The canonical substrate doc already names long
episodes as the thing that will stress this model; a stay of years is that case, recorded here
rather than discovered later.

**Still to come:** the mutation endpoints and the activation hook that call these. The shapes and
their invariants are covered; nothing yet writes.

### Phase 3 — the board surface *(delivered)*

`/workspace/ward` renders the map by default with a list flip, grouped by the shelter's own
`serviceArea`, free units visibly empty. Chosen over list-only and map-only through
`principle_decide` (`DI-6E711DA68A9B`, composite 9.673, margin 0.804, high confidence): list-only
scores *negative* on "Do the work; don't task the operator" because it turns a capacity
conversation back into counting rows, and map-only is opposed by "Every non-text element needs a
text alternative" — which is why the list is a flip rather than a separate page.

**Still to come:** per-unit photograph, the empty unit as the intake affordance, and
`OperationalSceneLayout` for position and **tier** — cat condos stack, the requirement a flat
restaurant floor never exercised.

### Phase 4 — capacity on the cockpit *(delivered)*

`Kennels — N free` beside the `Animals in care` tile from PR #4972, closing the 16:00 step. A full
shelter reads `warning`, not a healthy zero; a shelter that has recorded no housing reads
**"Not recorded"**, never `0 free`, because telling a manager they are full when nobody has entered
a kennel is the failure this tile exists to avoid.

### Phase 5 — the cockpit's front door *(delivered, narrowed)*

Found by the owner on the running portal, in the same sitting as the missing animals: the cockpit
led with **"From your storefront"** and **"Storefront bookings and inquiries waiting on you"**. A
storefront is what DPF calls the product. It is not what a rescue calls the people arriving at its
door.

While this branch was held at the gate, PRs #5026 and #5028 landed on `main` and fixed most of it —
and fixed it *better* than the version first written here. They key the vocabulary on `archetypeId`
(`pet-rescue`, `animal-shelter`) rather than on the category, so the rescue reads *adoption
enquiries*, *donations* and *Care readiness*; keying on `nonprofit-community`, as this branch
originally did, would have put the same words in front of a food bank and a sports club. That work
is taken wholesale here and the earlier approach was discarded rather than re-litigated.

What those PRs did not reach is the line the owner actually pointed at. `buildWorkspaceStorefrontSummary`
still chose its headline with `vocab.isRestaurant ? "From your guests" : "From your storefront"`, so
every business that was not a restaurant inherited the retail default no matter how good its
vocabulary row was. The remaining change is small and matches the shape already there:
`inboundHeadline` and `inboundSubhead` become vocabulary fields on all three tables, the branch
becomes a lookup, and the rescue reads **"From your community"**. A test asserts that no archetype's
worker copy contains the product noun, so the next archetype cannot inherit another's front door by
falling through a branch. One finance branch had identical arms and was collapsed.

## Definition of done for phase 1

- The projection is pure, covered, and imported by nothing that writes.
- Free, occupied and out-of-service counts are correct with blocked units and released allocations
  present.
- Unplaced animals are surfaced by name.
- No migration, no schema change, no change to any shipped vertical.
