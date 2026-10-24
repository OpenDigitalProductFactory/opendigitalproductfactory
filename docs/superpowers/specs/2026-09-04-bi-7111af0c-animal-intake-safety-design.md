---
status: active
---

# Animal intake safety on the subject-neutral care substrate

- **Backlog item:** `BI-7111AF0C`
- **Epic:** `EP-5102F494`
- **Workroom:** `WC-0F9E29BA`
- **Decision:** `DI-F289DBB51DCB`
- **Architecture dependency:** `BI-2C80E6EA`, merged in PR #4494
- **Housing dependency:** `BI-D2A51B36`, merged in PR #5044
- **Companion plan:** `docs/superpowers/plans/2026-09-04-bi-7111af0c-animal-intake-safety.md`

## Decision

Animal intake reuses the canonical animal identity and custody ledger together
with the subject-neutral care and scheduling substrate. `AnimalProfile` owns the
animal identity. `AnimalCustodyEpisode` and `AnimalCustodyEvent` own custody and
stage history. `CareIntakePacket` owns the bounded intake checklist and
exceptions. `CareRecord` owns health, procedure, vaccination, weight, behaviour,
and observation facts. `CareAppointment` owns scheduled veterinary work,
including recall, preparation, recovery, resource footprints, and governed
overbooking. `ResourceCapacityAllocation` owns housing capacity and placement.

This is the primary outcome of `DI-F289DBB51DCB`: generalize the existing care
substrate by adding an animal adapter and governed access policy. Do not create
animal-specific copies of care intake, appointments, procedures, or resources.
The hybrid fallback is not activated because the deployed `CareAppointment`
contract already preserves recall, overbooking authorization, preparation, and
recovery footprints for a non-patient subject.

## Outcomes

1. **OBJ-INTAKE-001:** A rescue operator can record an animal arrival without
   incorrectly making that animal available for placement.
2. **OBJ-INTAKE-002:** Every intake retains its source, custody history, legal or
   policy hold state, and auditable transitions.
3. **OBJ-INTAKE-003:** Acceptance is capacity-aware and cannot silently exceed
   compatible housing capacity.
4. **OBJ-INTAKE-004:** Required health, vaccination, identification, parasite,
   sterilization, recovery, and behaviour work is represented as evidence, not
   unchecked booleans.
5. **OBJ-INTAKE-005:** Placement readiness is derived from custody, care,
   procedure, exception, recovery, and housing facts and fails closed when
   evidence is missing or contradictory.
6. **OBJ-INTAKE-006:** Operators can complete the workflow from the existing
   rescue intake surface at desktop and narrow widths with explicit blocked,
   pending, conflict, permission, and success states.
7. **OBJ-INTAKE-007:** Human and animal care share one subject-neutral substrate,
   with tenant isolation and purpose-specific access preserved.

## Acceptance manifest

| ID | Objectives | Acceptance |
| --- | --- | --- |
| `AC-INTAKE-001` | `OBJ-INTAKE-001`, `OBJ-INTAKE-002` | Creating an intake atomically resolves or creates the organization-owned `AnimalProfile`, opens one custody episode, appends the intake event, and creates one animal `CareIntakePacket`; the animal is not placement-ready. |
| `AC-INTAKE-002` | `OBJ-INTAKE-002` | Supported source types include stray, owner-relinquished, transfer-in, born-in-care, return, seizure/confiscate, and other, using canonical custody enums and append-only transitions. |
| `AC-INTAKE-003` | `OBJ-INTAKE-002`, `OBJ-INTAKE-005` | A legal or policy hold has a source, reason, effective interval, and human-authorized release; no hard-coded jurisdiction duration determines placement readiness. |
| `AC-INTAKE-004` | `OBJ-INTAKE-003` | Intake either allocates compatible housing within the same transaction or refuses with an explicit capacity/incompatibility result; caller-supplied tenancy or capacity authority is ignored. |
| `AC-INTAKE-005` | `OBJ-INTAKE-004`, `OBJ-INTAKE-007` | Animal care facts use `CareRecord` with `subjectKindSlug: "animal-profile"`; sterilization and other procedures preserve date, provider, outcome, cost evidence, complications, and append-only correction. |
| `AC-INTAKE-006` | `OBJ-INTAKE-004`, `OBJ-INTAKE-005`, `OBJ-INTAKE-007` | Veterinary and procedure scheduling uses `CareAppointment` and preserves recall, preparation, recovery, resource footprints, participants, and explicit overbooking authority for animal subjects. |
| `AC-INTAKE-007` | `OBJ-INTAKE-005` | The readiness evaluator refuses active holds, incomplete packets, unresolved exceptions, missing required evidence, active recovery windows, absent housing, closed custody, or inconsistent subject ownership; it explains every unmet requirement. |
| `AC-INTAKE-008` | `OBJ-INTAKE-001`, `OBJ-INTAKE-002`, `OBJ-INTAKE-004`, `OBJ-INTAKE-005` | Idempotent retries return the authoritative intake; organization mismatch, duplicate active intake, invalid stage transition, stale version, and cross-subject evidence fail explicitly. |
| `AC-INTAKE-009` | `OBJ-INTAKE-006` | `/workspace/rescue/intake` supports intake creation, checklist progress, care evidence, appointment/recovery status, hold state, housing, and readiness without horizontal overflow or color-only meaning. |
| `AC-INTAKE-010` | `OBJ-INTAKE-007` | Animal write access is server-derived and organization-scoped; patient-only healthcare access remains unchanged and no animal can be used to enumerate patient data. |
| `AC-INTAKE-011` | all | Focused tests, migration validation, typecheck, guards, UX fit, semantic review, exact-tree local CI, PR health, and protected squash merge pass on the DCO-signed tree. |

## Research and precedent

The design adopts operating patterns rather than third-party dependencies.

- The Association of Shelter Veterinarians' 2022 guidelines require timely
  intake assessment, source/history collection, and disease-risk-based
  separation. DPF adopts an evidence-led assessment and hold model and rejects a
  universal fixed quarantine duration because local rules and risk differ.
- Shelter Animals Count standardizes animal-level intake and outcome data and
  distinguishes stray, owner relinquished, transfer, seizure, born-in-care, and
  related pathways. DPF maps those pathways to the existing custody intake enum
  and retains the original source rather than reducing it to free text.
- Animal Shelter Manager models rescue operations as time-ordered movements and
  medical events. DPF adopts durable event history and rejects its
  rescue-specific monolithic persistence model.
- ShelterOS and the open `animal-shelter` project connect rescue intake to
  medical, foster, and adoption work. DPF adopts one connected operator flow and
  rejects duplicating identity, scheduling, or resource authorities per stage.

Primary references:

- Association of Shelter Veterinarians, *Guidelines for Standards of Care in
  Animal Shelters, Second Edition*: https://doi.org/10.56771/asvguidelines.2022
- Shelter Animals Count data standardization and Basic Data Matrix:
  https://www.shelteranimalscount.org/data-standardization-resources/
- Animal Shelter Manager: https://github.com/sheltermanager/asm3
- ShelterOS: https://github.com/talha5978/shelter-os
- animal-shelter: https://github.com/albdangarcia/animal-shelter

## Verified substrate

| Concern | Canonical authority |
| --- | --- |
| Animal identity and organization ownership | `AnimalProfile` |
| Custody source, active episode, hold, stage, and outcome | `AnimalCustodyEpisode`, `AnimalCustodyEvent` |
| Intake checklist, responses, exceptions, and status trail | `CareIntakePacket` family |
| Health, vaccine, identification, procedure, weight, observation, and behaviour evidence | `CareRecord` |
| Scheduled veterinary/procedure work and recovery footprint | `CareAppointment` |
| Housing placement and available capacity | `Resource`, `ResourceCapacityAllocation` |
| Operator surface | `/workspace/rescue/intake` |

The current Prisma schema already permits `CareIntakePacket`, `CareRecord`, and
`CareAppointment` to reference a non-patient subject through
`subjectKindSlug`/`subjectRef` with a nullable `patientProfileId`. The missing
work is an animal-specific application adapter, authorization/RLS policy, typed
evidence validation, transactional orchestration, and operator controls.

## Intake command contract

The public command contains business facts but no tenancy or authority fields:

```ts
type AnimalIntakeCommand = {
  animal:
    | { mode: "existing"; animalProfileId: string }
    | {
        mode: "new";
        name: string;
        species: string;
        breed?: string | null;
        sex?: string | null;
        birthDate?: string | null;
        microchipNumber?: string | null;
      };
  intakeType:
    | "stray"
    | "owner-relinquished"
    | "transfer-in"
    | "born-in-care"
    | "return"
    | "seizure-confiscate"
    | "other";
  sourceName?: string | null;
  arrivedAt: string;
  initialHousingResourceId: string;
  hold?: {
    kind: "legal" | "policy";
    source: string;
    reason: string;
    effectiveUntil?: string | null;
  } | null;
  idempotencyKey: string;
};
```

The server derives organization, storefront, operator principal, allowed intake
types, housing kinds, capacity unit, and default intake requirements from the
authenticated rescue activation profile. Free-text source and hold notes are
operator-visible audit facts, not authority to release a hold.

## Atomic intake transaction

Within one serializable transaction, the service:

1. acquires an idempotency lock and returns the prior authoritative result for a
   completed retry;
2. resolves or creates exactly one organization-owned `AnimalProfile` and
   rejects duplicate microchip identity within the organization;
3. verifies there is no conflicting active custody episode;
4. resolves a compatible, active, unblocked, same-organization housing Resource
   and locks its capacity projection;
5. opens the `AnimalCustodyEpisode` at `intake` or `legal-hold` and appends the
   first custody event;
6. creates the subject-neutral `CareIntakePacket` for
   `animal-profile:<id>` with the immutable requirement snapshot;
7. creates the initial `ResourceCapacityAllocation` using the housing service;
8. returns the full intake projection only after all writes commit.

Any failure rolls back all writes. The command never produces an un-housed
custody episode or a capacity allocation without a custody episode. Existing
animal intake is supported for returns and transfers without duplicating the
animal identity.

## Requirement and evidence contract

The activation profile supplies versioned requirement keys, not new database
columns. The packet snapshot freezes the applicable rules at intake. The initial
pet-rescue profile supports:

| Requirement | Evidence authority | Completion rule |
| --- | --- | --- |
| Identity and microchip check | `AnimalProfile`, `CareRecord(kind: observation)` | scan/check recorded; chip identity reconciled or exception resolved |
| Intake examination | `CareRecord(kind: observation)` | qualified observation with date/provider |
| Weight and body condition | `CareRecord(kind: weight/condition)` | typed measurement and unit |
| Vaccination | `CareRecord(kind: vaccination)` | product/date/provider and due/recall fact |
| Parasite treatment | `CareRecord(kind: medication)` | product/date/provider and outcome |
| Sterilization | `CareRecord(kind: procedure)` and optional `CareAppointment` | prior verified procedure or completed scheduled procedure; recovery elapsed |
| Behaviour assessment | `CareRecord(kind: behavior)` | dated assessment and outcome |
| Housing | `ResourceCapacityAllocation` | one compatible active placement |

An animal adapter validates the JSON detail for each requirement before creating
a `CareRecord`. It preserves provider, date, outcome, cost reference,
complication, provenance, and correction links when applicable. Legacy
`attributes.spayed` may be displayed as unverified historical context but never
satisfies the procedure requirement by itself.

## Care appointment contract and fallback decision

For `subjectKindSlug: "animal-profile"`, `CareAppointment.subjectRef` resolves to
the organization-owned `AnimalProfile.id` and `patientProfileId` remains null.
The existing model retains:

- `recallAt` and recurrence schedule identity;
- `overbookAuthorizedByPrincipalId` and `overbookReason`;
- `preparationMinutes` and `recoveryMinutes`;
- `footprintStart` and `footprintEnd`;
- participants, resources, events, status, and idempotency.

Those facts satisfy the goal's preservation test, so the hybrid animal-specific
appointment fallback is prohibited for this item. If an implementation test
demonstrates a real invariant cannot survive the subject adapter, stop and
return to architecture review rather than silently adding a parallel table.

## Readiness evaluator

Placement readiness is a pure projection over canonical records. It returns a
verdict plus stable reasons and supporting record ids. It never mutates custody
or adoption state.

`ready` requires all of the following:

- one open custody episode in an allowed pre-placement stage;
- no active legal or policy hold;
- a completed intake packet with no unresolved exception;
- every profile-required care requirement supported by valid evidence;
- every required procedure completed and its recovery footprint elapsed;
- one compatible active housing allocation;
- no contradictory or corrected-away evidence;
- no active appointment whose status or footprint blocks placement.

An authorized transition command may move the custody episode to
`placement-ready` only when this evaluator returns ready against the same locked
snapshot. The transition appends an event and does not write a duplicate
`isReady` flag.

## Authorization, tenancy, and RLS

- Reads and writes derive organization and operator principal on the server.
- The animal adapter resolves every subject, packet, care record, appointment,
  custody episode, and Resource inside one organization.
- Existing patient-only RLS remains intact. A generated Prisma migration adds
  only the narrowly scoped animal-subject access policies needed for the new
  repository; it must not broaden patient list access or accept caller-supplied
  subject kind as authority.
- Hold release and placement-ready transition require an authenticated human
  operator with the applicable rescue role and append principal/time/reason.
- Medical detail is projected only where the operator's purpose requires it;
  the intake queue shows completion and blockers rather than unrestricted notes.

## Operator UX

`/workspace/rescue/intake` remains the single intake home. It gains:

- a concise new-intake action with source, animal identity, arrival, hold, and
  compatible housing;
- a bounded queue grouped by blocked, active assessment, recovery, and ready;
- a detail panel showing checklist evidence, unresolved exceptions, upcoming or
  recovering procedures, current housing, and custody timeline;
- direct evidence and transition actions with pending, validation, permission,
  conflict, retry, and settled-success feedback;
- an explicit explanation whenever placement readiness is withheld.

Desktop and 390px layouts must not horizontally scroll. Status is never
communicated by color alone, controls keep a 44-pixel target, and focus returns
to the changed animal or error summary after mutation. Lists are bounded and
paginated; the page must not load an organization's full record history.

## Failure and correction semantics

Stable failures distinguish invalid input, duplicate identity, active intake,
capacity unavailable, incompatible housing, active hold, incomplete requirement,
recovery active, stale version, forbidden action, and cross-tenant not-found.
Unexpected failures return a correlation id without exposing private foster,
medical, or organization data.

Care and custody evidence is append-preserving. Corrections supersede prior
records; they do not delete them. Idempotent retries cannot create duplicate
custody episodes, packets, appointments, procedures, or housing allocations.

## Migration, seed, and rollback

Generate any RLS migration from `packages/db`; amend the generated SQL only for
policy details Prisma cannot express. No animal-only care table is permitted.
Existing rows require no destructive backfill.

Seed fit belongs in the PR body: refresh the pet-rescue activation profile's
versioned intake requirement keys only. Do not seed animals, medical records,
appointments, holds, or housing allocations.

Rollback disables the new command and controls, then restores the prior read-only
intake page. Already-created canonical identity, custody, packet, care,
appointment, and allocation rows remain valid and auditable.

## Delivery boundary

This item delivers intake through placement-readiness evidence. Daily care
rounds, adopter workflow, veterinary case management, supplies, funding, and
events remain in their ordered epic items. It may expose the canonical records
those items will consume but does not pre-deliver their workflows.

Approximately twenty percent of implementation effort may harden shared
subject-neutral care repositories and access policy. That work must reduce
duplication and retain patient behavior; it cannot fund an unrelated rewrite.
