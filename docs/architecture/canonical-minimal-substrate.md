# The canonical minimal substrate

**Objective:** the smallest set of subject-agnostic models that lets every archetype run its
business, so verticals supply vocabulary and rules rather than cloning structure.

Measured against the source tree on 2026-08-25 using three probes: `restaurant` (built, the
worked example), `pet-rescue` (empty, the discovery probe) and `campground` (the confirmation
probe — see [campground](archetypes/campground-operating-model.md)).

Classification procedure and the promotion rule: [accommodation doctrine](accommodation-doctrine.md).

---

## Headline

**The canonical substrate is roughly two-thirds built, and further along than the pet-rescue
audit implied.** Six of nine elements are already canonical, already subject-agnostic, or already
designed. The keystone — a canonical **subject identity** — is what the rest hang from.

Two further elements (10 and 11) were promoted by the campground probe under the doctrine's
counting rule. Both are **extensions of existing designs**, not new mechanisms.

This is a **much smaller** job than "build 30 entities for animal welfare".

## The elements

| # | Element | State | Where |
|---|---|---|---|
| 1 | Capacity-bearing resource | **canonical** | `Resource` |
| 2 | Resource availability | **canonical** | `ResourceAvailability` |
| 3 | Capacity pool | **canonical** | `ResourceCapacityPool` |
| 4 | Capacity allocation | **canonical** | `ResourceCapacityAllocation` |
| 5 | Staged admission (intake) | **subject-agnostic** | `CareIntakePacket` + response / access-grant / exception / status-event |
| 6 | Scheduled event against a subject | **subject-agnostic** | `CareAppointment` |
| 7 | **Subject identity** | **missing** | each vertical owns its own; animals have none |
| 8 | **Occupancy episode** | **clone-only** | `HospitalityServiceTurn` |
| 9 | Episode stage/state + event ledger | **already designed** | [canonical lifecycle grammar](../superpowers/specs/2026-08-15-canonical-lifecycle-grammar-design.md) + `LifecycleEvent` |

Adjacent and already generic: `OperationalSceneLayout` (spatial layout, `spaceKind:
cartesian-interior`, `layoutState`, floor-plan `underlayRef`) and `MediaAsset` /
`MediaAttachment`.

Also clone-only and worth lifting eventually: `BeautyResourceService`, the resource-to-service
capability map.

## What is already done, and done well

### The capacity substrate is genuinely canonical

`Resource` carries an **open** `kindSlug` — the comment enumerates "chair, station,
treatment_room, table, kitchen, ..." — plus `capacity`, `capacityUnit` (default `units`),
`serviceArea`, `attributes`, `lifecycle`, and `sourceRef` for clone provenance. A kennel is this
model with `kindSlug: kennel` and `capacityUnit: animals`. Nothing new is required.

`ResourceCapacityAllocation` is the strongest piece of design in the area:

- `demandSlug` — *"open demand vocabulary carried verbatim from the clones: booking, hold,
  service-turn, ..."*
- `demandRef` — polymorphic pointer to whatever created the demand
- `state`, `idempotencyKey`, `releasedAt`, `releaseReason`
- `startsAt` / `endsAt` / `quantity`, plus `lifecycle` triplet
- `sourceRef` — *"clone-row provenance key, e.g. `HospitalityCapacityAllocation:<id>`"*

It already anticipates `service-turn` as a demand slug, which is the hook element 8 needs.

### Care is already subject-agnostic — this corrects an earlier finding

Shipped in `20260822164000_subject_agnostic_scheduling_and_resources` and
`20260822172800_subject_reference_guard_alignment`:

- `CareAppointment` and `CareIntakePacket` both carry **required** `subjectKindSlug` and
  `subjectRef`
- `patientProfileId` became **nullable** on both
- existing rows were backfilled as `subjectType = 'patient-profile'`
- guards branch on `subjectType = 'patient-profile'` versus `<> 'patient-profile'`

Two consequences worth stating plainly:

1. **`verticals-care` is not "built for humans" any more.** An earlier version of the pet-rescue
   requirements doc said so; that was wrong and has been corrected. Intake and scheduling are
   already subject-neutral.
2. **The extension point is designed in, not forbidden.** The constraints branch on subject kind
   rather than rejecting non-patients, so onboarding a new subject kind is an intended path.

The data-impact record cites `BI-2C80E6EA` and `DI-F289DBB51DCB` as provenance. That is the
in-progress item asking generalise-vs-clone — so that question was already answered
**generalise**, and partly executed. The ratified decision on `BI-51C95802` is consistent with
work already shipped rather than a new direction.

The remaining gate is explicit in the field policy:

> "Patient subjects must equal `patientProfileId` by database check; future subject references
> require **owning-vertical resolution** before write."
> "no generic non-patient read or write policy is granted by this migration."

So a new subject kind needs an owning vertical identity row and a governed policy — which is
exactly element 7.

## The remaining work

### 7. Canonical subject identity — the keystone

There is no canonical subject. `PatientProfile` is the care vertical's identity row;
hospitality's subject is effectively the booking party; **animals have no identity row at all**,
only `AdoptableAnimal`, a storefront catalog row requiring `storefrontId`.

Everything else waits on this. `CareIntakePacket` and `CareAppointment` are ready to accept an
animal subject the moment one exists and is registered as a subject kind with an owning vertical.

Minimum shape: a durable identity per subject kind, existing independently of any listing, with
the identifiers and lifecycle its domain requires. Tracked as **BI-4F8A484C**; direction ratified
in **BI-51C95802**.

### 8. Occupancy episode — lift `HospitalityServiceTurn`

`HospitalityServiceTurn` is not a restaurant concept. It is *"a subject occupies capacity for a
period, in a stage"*:

```
turnId · bookingId? · staffingAssignmentId?
demandType + demandRef          <- polymorphic subject/demand attachment
stage (default "seated")
startedAt · expectedEndAt · closedAt
allocations[] · events[]
```

The same model is:

| Archetype | Episode | Stages |
|---|---|---|
| restaurant | party at a table | seated -> ordered -> served -> paid -> closed |
| pet-rescue | **animal in a kennel** | intake -> available -> hold -> outcome |
| pet-boarding | boarding stay | checked-in -> in-care -> checked-out |
| self-storage | unit rental | active -> overlocked -> released |
| healthcare | admission | admitted -> in-treatment -> discharged |
| 3PL / warehousing | stock in a location | received -> put-away -> picked |

Rename `stage` semantics per vertical, keep the structure. Nothing here is hospitality-specific
except the default value of one string.

### 9. Episode stage/state and event ledger — **already designed; do not re-invent**

An earlier draft of this document proposed lifting `HospitalityServiceTurnEvent` as a new
canonical element. That was wrong, and it is recorded here because the correction is the point.

The [canonical lifecycle grammar](../superpowers/specs/2026-08-15-canonical-lifecycle-grammar-design.md)
already defines **Stages + in-stage States + gated Advancement**, with health bands
(`ready` / `on-track` / `blocked`) and an extension of the existing `LifecycleEvent` ledger to
carry the state axis. It is explicitly *"a shape, not a new table of instances"*, with a
per-entity resolver.

So the occupancy episode (element 8) supplies **the entity**; the grammar supplies **its stage,
state, gate and event history**. Element 8 must declare a grammar and wire a resolver — it must
not invent a parallel stage enum or a second event table.

The requirement that motivated this still stands and is worth keeping visible:

> A parvo outbreak requires tracing every animal that shared a ward with the index case,
> **including animals already adopted out** inside the incubation window.

With only "where is it now", contact tracing is impossible. The same argument is a restaurant's
table-turn history, a warehouse's chain of custody, and a hospital's ward-exposure trace. The
grammar's event ledger is where that history lives.

### 10. Concurrent, time-bound holds — a genuine gap, and an *extension* of the grammar

The grammar gates advancement on **in-stage state**: a transition is legal when the current state
is exit-ready and the target is reachable. That is one `(stage, state)` point per entity.

A shelter hold is not a state. An animal can simultaneously be under:

- a **stray hold** until Thursday 14:00 (statutory)
- a **bite quarantine** until next Tuesday (health department)
- an **adoption reservation** until 17:00 today (commercial)

Three concurrent constraints, each with its own clock, source, authority and expiry, each
independently capable of blocking a different set of transitions. A single state field cannot
express this, and collapsing them to `blocked` destroys the reason — which the UX requires:
*"Not adoptable — stray hold until Thu 14:00"* is the requirement; a greyed-out button is a
failure.

Campground supplies a second sighting in a different shape: minimum-stay rules and statutory
length-of-stay limits block transitions for reasons external to the entity's own state.

**Classification:** load-bearing (getting it wrong is unlawful), so it promotes at two sightings
under the doctrine. **Design it as an extension to the grammar's advancement gate** — a gate that
consults active holds in addition to in-stage state — not as a parallel mechanism. Two ways to
block a transition is the failure mode to avoid.

### 11. Jurisdiction as a rule source — promoted at two sightings

Pet-rescue needs **static** jurisdiction: stray-hold length, mandatory spay/neuter, quarantine
duration — set once, changing rarely.

Campground needs the same **plus dynamic**: a county fire-danger level that changes mid-occupancy
and immediately restricts what guests may do and what the camp store may sell.

Both are load-bearing, so jurisdiction promotes at two sightings. Whether the *dynamic* variant
belongs in the same element or arrives as a later extension should be decided by the third
archetype that needs it — transport (hours-of-service), healthcare (licensure) and public sector
are all likely candidates.

### Also: resource-to-service capability map

`BeautyResourceService` answers "which services can this resource perform". Generalises to
"which kennels can hold a large dog", "which rooms are isolation-capable", "which racks are
refrigerated". Lower priority than 7-9 but the same lift.

## What pet-rescue proved that restaurant could not

Restaurant is a good worked example but it does not exercise everything. Three requirements only
appear once a second, unlike archetype is tried:

1. **Position needs a tier.** Cat condos stack two or three high, so location is room + row +
   column + **tier**. A restaurant floor is flat, so the layout model was never pushed on this.
   Warehouse racking and self-storage will push the same way. `OperationalSceneLayout.layoutState`
   is opaque JSON so it *can* express tier, but nothing defines it — decide the contract before
   two verticals invent different ones.
2. **A hold must block an action and explain itself.** A restaurant hold is a convenience; a
   shelter's stray hold is statutory, and adopting inside it is unlawful. Holds must be typed,
   clock-bearing, simultaneous, and capable of **preventing** a transition with a reason
   renderable in the UI. Restaurant's `BookingHold` does not carry this weight.
3. **Jurisdiction must drive rules, not label them.** Hold length, quarantine, licensing and
   mandatory spay/neuter vary by state and county. Restaurant never needed this. Any archetype
   with statutory obligations does — healthcare, banking, public sector, transport.

Requirements 2 and 3 are **not** in the canonical nine. They are candidates for a tenth and
eleventh element, and the decision of whether they are canonical or vertical belongs with the
next archetype that needs them, not with pet-rescue alone.

## Sequencing

Dependency order, not priority order:

1. **Canonical subject identity** (element 7) — unblocks intake and scheduling for every
   non-patient vertical. Nothing else should start first.
2. **Occupancy episode** (element 8) — lift `HospitalityServiceTurn` using the `sourceRef`
   clone-backfill pattern the resource canonicalisation already proved, declaring a lifecycle
   grammar rather than a new stage enum.
3. **Animal subject** as the first non-patient subject kind — the real test of whether element 7
   generalised, because it must satisfy an owning-vertical policy.
4. **Capability map** (promoted at three sightings) including dimensional fit — beauty already
   has `BeautyResourceService` to lift from.
5. **Holds as a grammar gate extension** (element 10) and **jurisdiction rules** (element 11),
   both promoted at two sightings as load-bearing.
6. Re-score all three probes. Restaurant must not regress; pet-rescue should move off 0.05;
   campground gets its first score.

## Method note for the next archetype

Use two probes, never one. Restaurant alone made the capacity substrate look complete, because a
flat floor plan and a convenience hold never stress the model. Pet-rescue exposed tier,
blocking holds, jurisdiction and the episode timeline within a single day's analysis.

**Pick the second probe to be structurally unlike the first**, then treat anything only the
second probe needs as a candidate canonical element rather than a vertical special case. That is
how the minimal set stays minimal without becoming insufficient.
