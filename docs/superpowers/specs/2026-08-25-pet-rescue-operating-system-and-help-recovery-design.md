---
status: proposed
---

# Pet Rescue operating system and resilient Help design

**Integration backlog item:** `BI-7A38F667`  
**Covered Pet Rescue items:** `BI-4F8A484C`, `BI-D2A51B36`, `BI-97290291`,
`BI-7111AF0C`, `BI-5A25EC37`, `BI-A442F129`, `BI-E861E8B8`,
`BI-7A38F667` (`EP-5102F494`)
**Covered Help item:** `BI-AE7C386B` (`EP-56AE0F69`)  
**Workroom:** `WC-16B8E810`  
**Architecture decision:** `DI-0AFD05E602CA`

## 1. Decision summary

This change turns the Pet Rescue archetype from a public animal catalog into an
operating system for the three value streams already defined in Architecture:

1. **Rescue and intake** — bring an animal into custody safely and lawfully.
2. **Health and welfare** — house the animal, coordinate clinical care, and
   complete daily care without omissions.
3. **Placement and continuity** — assess adopters, place the animal, and retain
   the full history if it returns.

It also repairs global Help so a renamed, removed, or unseeded document cannot
strand an operator on a 404.

This is one umbrella design and one coordinated implementation PR, matching the
operator's explicit constraint to use one source sandbox and one publication
event. Each independently reviewable slice retains its existing backlog item,
acceptance evidence, verification seam, and clean-revert commit inside the
shared governed Workroom and branch. A shared nonproduction lease verifies the
assembled change without letting the integration item hide partial delivery.

## 2. Outcomes and objective baseline

The current baseline includes the Pet Rescue value streams, the
`AdoptableAnimal` catalog, the mission-impact strip, and the canonical ward and
occupancy surface merged in PRs #4972, #5000, and #5022. This design consumes
those delivered capabilities; it does not recreate them.

**OBJ-RESCUE-IDENTITY:** Establish one durable operational animal identity while
keeping the public adoption listing an optional projection.

**OBJ-RESCUE-INTAKE:** Preserve intake source, custody stage, legal holds, and
outcome history across re-entry instead of overwriting the current listing.

**OBJ-RESCUE-CAPACITY:** Reuse the delivered canonical Resource occupancy and
ward surface as the housing spine for intake, care, and placement.

**OBJ-RESCUE-CARE:** Make appointments, clinical facts, recurring care,
completion, exceptions, and escalation visible per animal without treating an
animal as a human patient.

**OBJ-RESCUE-ADOPTION:** Connect application, screening, visits, reservation,
placement, and return as one governed trace from inquiry to outcome.

**OBJ-RESCUE-STEWARDSHIP:** Attribute posted cost and restricted funding to the
animal and program so stewardship readouts reconcile to canonical finance.

**OBJ-RESCUE-HOME:** Make the Pet Rescue opening viewport answer animal-welfare
questions and provide durable drill-ins to intake, care, capacity, adoption,
and stewardship work.

**OBJ-HELP-RECOVERY:** Resolve Help to a valid canonical document or a truthful
contextual index so missing or renamed content never becomes a record 404.

| Acceptance | Objective | Statement |
|---|---|---|
| AC-RESCUE-IDENTITY-01 | OBJ-RESCUE-IDENTITY | Existing public animals gain a stable operational identity without invented custody, care, or outcome facts. |
| AC-RESCUE-INTAKE-01 | OBJ-RESCUE-INTAKE | An operator can admit, stage, hold, outcome, and later re-admit an animal while retaining the prior episode and events. |
| AC-RESCUE-CAPACITY-01 | OBJ-RESCUE-CAPACITY | Intake and animal detail read the same Resource and ResourceCapacityAllocation facts as the delivered ward surface, including unknown and blocked capacity. |
| AC-RESCUE-CARE-01 | OBJ-RESCUE-CARE | An operator can see due care, missed or exceptional care, appointments, and a correctable clinical/welfare history for one animal. |
| AC-RESCUE-ADOPTION-01 | OBJ-RESCUE-ADOPTION | An inquiry can become a screened application and placement, and a return preserves the placement before opening a new custody episode. |
| AC-RESCUE-STEWARDSHIP-01 | OBJ-RESCUE-STEWARDSHIP | Restricted balances and animal cost use posted fund and subject dimensions, not a parallel rescue ledger. |
| AC-RESCUE-HOME-01 | OBJ-RESCUE-HOME | Every first-viewport signal drills into a bounded operational queue and unavailable data is distinguished from a truthful zero. |
| AC-HELP-RECOVERY-01 | OBJ-HELP-RECOVERY | Header Help, legacy aliases, missing seeds, and unknown direct slugs render a valid documentation destination with recovery context and intact authorization. |

## 3. Research & benchmarking

### 3.1 Open-source products

| Product | Evidence | Adopt | Reject |
|---|---|---|---|
| [Animal Shelter Manager](https://github.com/sheltermanager/asm3) | GPL self-hosted shelter system. Its [current manual](https://sheltermanager.com/repo/asm3_help/animals.html) keeps movements, medical, clinic, diet, costs, transport, media, and diary against the animal history. | One durable animal record, movement/custody history, due-care alerts, and costs attached to the animal. | A monolithic animal screen whose tabs each own ad-hoc status and permissions. DPF composes bounded services and progressively discloses detail. |
| [Hackapet / RefuPet](https://github.com/hackapet-project) | AGPL web/mobile shelter project with records, shelter operations, and adoption. | Mobile-friendly operational access and explicit shelter/adoption separation. | A rescue-only application boundary. DPF must reuse generic resources, care appointments, work, finance, identity, and storefront services. |
| [Shelter Hub](https://github.com/Shelter-Hub/shelter-hub-management-api) | Open-source animal registry and clinical-record service covering vaccines, conditions, treatments, medications, and visits. | Subject history as normalized records with dates, status, and provenance. | Independent medical identity or a JSON medical blob on the public listing. |

### 3.2 Domain standards

- The [Association of Shelter Veterinarians 2022 Guidelines](https://doi.org/10.56771/asvguidelines.2022)
  apply to shelters, foster-based organizations, sanctuaries, and other
  population-care settings. DPF adopts capacity-aware intake, population-level
  welfare visibility, timely medical care, daily observation, and documented
  exceptions. It does not encode clinical judgment or automate consequential
  welfare decisions.
- [Shelter Animals Count data standardization resources](https://www.shelteranimalscount.org/data-standardization-resources/)
  define animal-level intake/outcome collection and consistent reporting.
  DPF adopts event dates and standard intake/outcome categories while retaining
  local subtypes and reasons.
- The [Shelter Animals Count glossary](https://www.shelteranimalscount.org/glossary)
  distinguishes total/community intake, stray, owner relinquishment,
  seizure/confiscation, transfer-in, adoption, return-to-owner, transfer-out,
  and days in care. Those terms inform the closed enums and metric definitions.

### 3.3 Help and web-platform standards

- A route is not a durable document identity. Help links therefore target a
  canonical doc key and resolve it server-side at request time.
- Missing content is a recoverable content condition, not a Next.js route
  absence. The docs route returns a valid contextual fallback with a notice;
  `notFound()` remains reserved for deliberately invalid external URLs when no
  recovery context exists.
- Query context is validated and carried only as an internal route path; it
  cannot widen organization or permission scope.

## 4. Current substrate audit

| Need | Existing substrate | Classification | Design action |
|---|---|---|---|
| Public animal listing | `AdoptableAnimal`, `MediaAttachment` | vertical-native but catalog-bound | Keep as optional projection; backfill operational identity. |
| Animal identity/history | None beyond listing | absent | Add `AnimalProfile` and custody episodes. |
| Housing/foster capacity | `Resource`, `ResourceAvailability`, `ResourceCapacityPool`, `ResourceCapacityAllocation`, `/workspace/ward` | canonical and delivered | Reuse the shipped ward store and occupancy projection; add only animal/custody integration needed by the remaining workflows. |
| Scheduled veterinary visit | subject-agnostic `CareAppointment(subjectKindSlug, subjectRef)` | canonical | Use `animal-profile` + stable animal id; no patient row. |
| Intake forms | subject-agnostic `CareIntakePacket` and versioned `CareIntakeResponse` | canonical | Use for health/behavior assessments; keep custody stage on the custody episode. |
| Clinical facts | Human `PatientProfile` exists but no subject-agnostic condition/medication/observation record | absent | Add one generic `CareRecord`, not an animal medical JSON blob. |
| Recurring daily work | `RecurrenceSchedule`, `WorkEngagement`, `WorkEngagementActivity`, `WorkItem` | canonical but subjectless | Refactor `WorkEngagement` to carry optional subject and location references. |
| Adoption lead | `StorefrontInquiry` | partial | Link an application to inquiry/contact and the animal profile. |
| Adoption workflow/outcome | None | absent | Add application and placement records with explicit lifecycle evidence. |
| Donations | `StorefrontDonation` | canonical | Link optional restricted fund. |
| Restricted funds | `FundBudgetLine.fund` is municipal and string-bound | vertical-bound | Add generic finance fund; do not reuse municipal budget vocabulary. |
| Cost per animal | `JournalLine` has customer/contact dimensions only | partial | Add optional subject dimension and fund relation to the canonical line. |
| Pet Rescue first viewport | Pet Rescue mission-impact strip plus generic nonprofit boards | partial | Extend the existing leaf-aware composition with bounded care, intake, adoption, and stewardship signals; preserve shipped animal/capacity tiles. |
| Help | route map + filesystem docs loader + contextual quick help | canonical but brittle | Add canonical resolver and recovery contract. |

Quoted absence checks were run across `packages/db/prisma/schema` for animal
identity, custody/outcome, subject clinical records, adoption placement,
restricted funds, and subject-level finance dimensions. The apparent
`FundBudgetLine` and workforce `Application` matches are decoys for municipal
budgeting and employment respectively.

## 5. Canonical data architecture

### 5.1 Animal identity boundary

`AnimalProfile` is the operational aggregate and the only source of identity,
demographics, custody state, and durable identifiers. `AdoptableAnimal` becomes
an optional one-to-one publication projection.

```
AnimalProfile 1 ── 0..1 AdoptableAnimal
      │
      ├── * AnimalCustodyEpisode
      ├── * AnimalAdoptionApplication ── 0..1 AnimalPlacement
      ├── * CareRecord (subjectKind=animal-profile)
      ├── * CareAppointment (subjectKind=animal-profile)
      ├── * WorkEngagement (subjectKind=animal-profile)
      ├── * ResourceCapacityAllocation (demandSlug=animal-housing)
      └── * JournalLine (subjectKind=animal-profile)
```

Kernel consultation `DI-0AFD05E602CA` compared:

1. expanding `AdoptableAnimal` into the operational aggregate;
2. a canonical `AnimalProfile` with an optional public projection; and
3. a universal human/animal `CareSubject` migration.

The kernel recommended option 2 with high confidence (composite 3.779, margin
0.896, autonomy eligible). The dominant positive contributors were Ground New
Work In Existing Platform, Research and Use Standards, Single Source of Truth,
and Architecture Over Shortcuts. No commandment conflict was raised.

### 5.2 Closed enums

All persisted closed axes are Prisma enums with hyphenated database mappings:

- `AnimalLifecycleStatus`: `intake-review`, `in-care`, `adoption-ready`,
  `reserved`, `placed`, `transferred`, `returned`, `deceased`, `entered-in-error`.
- `AnimalCustodyStage`: `intake`, `legal-hold`, `quarantine`,
  `health-assessment`, `procedures`, `behavior-assessment`, `care`,
  `placement-ready`, `outcome-recorded`.
- `AnimalIntakeType`: `stray`, `owner-relinquished`, `seizure-confiscate`,
  `transfer-in`, `born-in-care`, `return`, `other`.
- `AnimalOutcomeType`: `adoption`, `return-to-owner`, `return-to-field`,
  `transfer-out`, `died-in-care`, `euthanasia`, `lost-in-care`, `other`.
- `CareRecordKind`: `condition`, `allergy`, `medication`, `vaccination`,
  `procedure`, `weight`, `observation`, `behavior`, `note`.
- `AnimalAdoptionApplicationStatus`: `submitted`, `screening`,
  `meet-and-greet`, `home-check`, `approved`, `waitlisted`, `declined`,
  `withdrawn`, `placed`, `closed`.
- `AnimalPlacementStatus`: `reserved`, `active`, `returned`, `cancelled`.
- `FinancialFundRestriction`: `unrestricted`, `temporarily-restricted`,
  `permanently-restricted`.

Open local vocabularies remain slugs (`speciesSlug`, `breed`, `kindSlug`,
`recordCode`) and are not forced into global enums.

### 5.3 New and extended models

#### `AnimalProfile`

- stable `animalId` business id plus organization-scoped unique reference;
- organization and storefront ownership;
- name, species, breed, birth estimate, sex, size, microchip and identifying
  marks;
- current lifecycle as a projection for fast lists, updated only by the custody
  and placement services;
- source/provenance, record lifecycle, version, and timestamps;
- one-to-one optional `AdoptableAnimal` relation.

#### `AnimalCustodyEpisode`

One row per admission through final outcome. A returned animal opens a new
episode; history is never overwritten.

- intake type, subtype/reason, source contact/organization, intake timestamp;
- current stage and stage timestamp;
- legal hold start/end/reason and intake capacity decision evidence;
- outcome type, timestamp, reason, and destination contact/organization;
- optimistic version and append-only `AnimalCustodyEvent` sequence.

The profile's current lifecycle is a read projection. The episode/event stream
is authoritative.

#### `CareRecord`

Subject-agnostic clinical/welfare history keyed by organization,
`subjectKindSlug`, and `subjectRef`. It carries record kind, optional code and
display, status, value/quantity/unit, effective interval, structured detail,
source, author, sensitivity, retention, legal hold, correction/supersession,
and timestamps. It does not create a second patient or animal identity.

`CareIntakeResponse` remains the authored form response. A reviewed response may
produce normalized `CareRecord` facts through an explicit service; raw answers
are not queried as the clinical record.

#### Adoption records

`AnimalAdoptionApplication` links `AnimalProfile`, optional
`StorefrontInquiry`, and `CustomerContact`. It owns screening status, assigned
reviewer, decision reason, and timestamps. Meet-and-greet and home-check visits
are subject-agnostic `CareAppointment` rows linked by join rows, not date
columns duplicated on the application.

`AnimalPlacement` links the approved application, animal, adopter contact,
reservation allocation, donation/payment reference, placed date, suggested
contribution, return date/reason, and status. Returning closes the placement and
opens a new custody episode in one transaction.

#### Finance dimensions

`FinancialFund` is an organization-scoped fund with stable key, restriction,
purpose, effective interval, currency, lifecycle, and optional donor restriction
text. `StorefrontDonation.fundId` is optional. `JournalLine` gains optional
`fundId`, `subjectKindSlug`, and `subjectRef`. The posting line remains the
source of actual cost; the dashboard never sums bills separately.

The municipal `FundBudgetLine` remains in place and may later reference the
generic fund. This PR does not silently reinterpret its existing `fund` values.

#### Generic work subject refactor

`WorkEngagement` gains nullable `subjectKindSlug`, `subjectRef`, and
`locationResourceId`. This is the intended refactoring share of the change:
daily care uses the existing recurrence materializer and append-only activity
timeline rather than a rescue-only task engine. Existing rows remain valid.

Recurring templates create dated engagement instances. Each instance may
project to a `WorkItem`; completion and exception evidence are appended to
`WorkEngagementActivity`. Missed medication or welfare exceptions create urgent
work and require human acknowledgement; no coworker makes a treatment or
euthanasia decision.

### 5.4 Housing and foster allocation

PRs #5000 and #5022 already delivered the generic occupancy projection,
Pet Rescue ward store, kennel write shapes, capacity tile, and `/workspace/ward`
experience on current `main`. They are dependencies and acceptance evidence,
not work to duplicate in this branch.

- A kennel, room, isolation space, or foster home is `Resource(domain =
  animal-welfare)`.
- A capacity-only foster network may be a `ResourceCapacityPool`; a named foster
  home is a `Resource` when placement history and suitability matter.
- Occupancy is `ResourceCapacityAllocation` with `demandSlug =
  animal-housing`, `demandRef = AnimalProfile.id`, and the custody interval.
- Blocked and unavailable capacity uses `ResourceAvailability` or resource
  lifecycle fields; it is not represented by a fake animal allocation.
- Free capacity is computed from capacity minus overlapping active allocations.
  Queries are time bounded and detect over-allocation; they never use a cloned
  hospitality route.

## 6. Service boundaries and invariants

### 6.1 Commands

- `admitAnimal` creates/locates the profile, opens a custody episode, records the
  intake event, and applies housing only after a capacity check.
- `advanceAnimalCustodyStage` enforces legal-hold and assessment prerequisites
  and appends an event with actor/reason.
- `assignAnimalHousing` uses the canonical capacity allocator and releases the
  previous allocation transactionally.
- `recordCareFact` writes a normalized, correctable `CareRecord` with provenance.
- `scheduleAnimalAppointment` delegates to the care appointment service.
- `establishCareRoutine` delegates recurrence to `WorkEngagement`.
- `transitionAdoptionApplication` enforces the application state machine.
- `placeAnimal` atomically reserves/releases housing, records the placement,
  closes custody with an adoption outcome, and unpublishes the listing.
- `returnAnimal` closes the placement and opens a new custody episode without
  deleting prior history.

All commands require organization scope and an authenticated principal. APIs
never accept organization id as authority from the form body.

### 6.2 Invariants

1. One organization-scoped animal identity per stable source identity or
   microchip when present; duplicate candidates require human merge review.
2. At most one open custody episode per animal.
3. At most one active housing allocation per animal for the same interval.
4. An animal cannot be placement-ready while a legal hold is active.
5. An active placement requires an approved application and closes active public
   availability.
6. A return preserves the placement, custody, care, and cost history.
7. Corrected clinical facts supersede; they are not mutated out of history.
8. Restricted-fund and subject dimensions sit on journal lines, so every report
   reads posted accounting facts.

Database constraints cover uniqueness and FKs. Service transactions cover
cross-model state transitions; PostgreSQL checks/exclusions cover invariants
that cannot be expressed in Prisma.

### 6.3 API authentication and authorization

Internal route handlers and server actions derive a trusted request context from
the authenticated session and server-side organization membership:
`{ principalId, organizationId, capabilities }`. A request body, query, path,
cookie outside the authenticated session, or imported source record may select a
record, but it never supplies authority or organization scope. Repositories
repeat `organizationId` in every read and write predicate. An unauthenticated
request fails before repository access; a signed-in principal without the
required capability fails before data is loaded; an absent or cross-organization
record is not disclosed.

Authorization is action- and field-specific:

| Boundary | Required authority |
|---|---|
| Public animal listing | No internal session; the existing public serializer exposes only explicitly published allowlisted fields. |
| Rescue operational reads | Authenticated organization member plus a domain-appropriate operational read grant. Clinical, legal-hold, foster-address, applicant, donor, and finance fields require their own narrower projection. |
| Intake, housing, daily-care, appointment, and adoption workflow writes | Authenticated organization member plus explicit animal-welfare operating authority for that action; every transition records the principal and reason. |
| Clinical corrections and medical detail | Animal-welfare operating authority plus clinical scope; corrections supersede prior facts and never erase them. |
| Restricted-fund, journal-line, and cost detail | Existing `view_finance` or `manage_finance` capability as appropriate; animal-welfare authority alone cannot expose or post finance data. |
| Legal-hold release, adoption approval, euthanasia, and fund-restriction release | Explicit human approval at the consequential-action boundary; no background job, inferred occupation, or AI coworker can self-authorize it. |

The current closed `CapabilityKey` catalog has no animal-welfare operating
grant, and `HR-600` occupations are explicitly narrowing-only. The implementation
must not borrow `view_operations`, `operate_customer`, or another semantically
unrelated capability for rescue writes. Before the first write slice can be
planned, a linked authorization prerequisite must either approve an existing
domain-capability mechanism or add the smallest animal-welfare grant and its
occupation-aware narrowing policy. Until that prerequisite is approved, all new
rescue mutations fail closed. Authentication, cross-organization isolation,
capability denial, field redaction, and consequential-action approval each need
negative tests.

## 7. Pet Rescue user experience

### 7.1 Navigation

Pet Rescue gets a leaf-specific workspace profile selected by semantic
archetype id before the generic `nonprofit-community` category profile. It does
not add builder terminology to Simple mode.

- **Home** — rescue operating cockpit.
- **Animals** — bounded animal list and durable detail.
- **Intake** — staged custody queue and exceptions.
- **Care** — today's rounds, medications, welfare exceptions, and appointments.
- **Adoptions** — applications, visits, reservations, placements, and returns.
- **Capacity** — housing/foster map and blocked/free capacity.
- **Stewardship** — funds, donations, and attributed animal costs through
  existing finance surfaces and contextual drill-ins.

The first PR may compose these as tabs inside one Rescue Operations route when
that reduces navigation churn, but each tab has a durable URL and access check.

### 7.2 First viewport

The Pet Rescue home answers: **Which animal or care commitment needs attention
now?** It uses report-kit primitives and shared status intents:

1. Animals in care, intake review, legal hold, and placement-ready.
2. Free housing/foster capacity plus blocked spaces.
3. Today's care rounds, due/missed medications, and welfare exceptions.
4. Today's veterinary and adoption appointments.
5. Long-stay animals and placement-ready animals with no active interest.
6. Donations by restriction, available restricted balances, and posted cost per
   animal.

Every tile has a drill-in. Missing sources produce a named partial-result notice,
not a zero that implies the business has no work. Empty states teach the first
setup action. Tables are cursor/page bounded; no first viewport fetches every
animal or activity.

### 7.3 Animal detail

The overview leads with identity, current custody stage, location, holds, next
care, and placement readiness. Secondary tabs disclose timeline, care,
appointments, routines, applications/placements, costs, and public listing.
One summary is rendered once; detail tabs do not create competing summaries.

### 7.4 Accessibility and visual rules

- `StatCard`, `KpiCard`, `StatusBadge`, `DataTable`, `FilterBar`, `Notice`,
  `EmptyState`, and `ExpandableCard` come from report-kit.
- All colors use `--dpf-*` tokens and the shared status-intent registry.
- Status is expressed in text and semantics, never color alone.
- Controls meet the 44px tap target and preserve keyboard/focus order.
- Desktop, narrow viewport, light theme, and dark theme are verified.

There is no Pet Rescue wireframe or mockup artifact in the repository, and this
design does not claim one. Sections 7.1–7.4 are the normative interaction and
layout contract. Rendered narrow/wide and light/dark screenshots are produced as
implementation verification evidence after the real routes exist; they are not
retroactively described as design inputs.

## 8. Resilient Help contract

### 8.1 Stable identity

`DOCS_ROUTE_MAP` maps source routes to a canonical `docKey`, not an unchecked
filesystem path. A server-safe registry resolves the key against the currently
packaged docs index.

Resolution order:

1. exact canonical key;
2. declared alias from a renamed key;
3. nearest existing area index;
4. global docs index;
5. generated contextual quick-help page when packaged docs are absent.

The resolver returns `{ href, requestedKey, resolvedKey, recoveryKind }`.
`buildContextualDocsHref` uses the valid resolved href and includes
`sourceRoute`; it never emits a link that the current package cannot render.

### 8.2 Direct URL recovery

For `/docs/[...slug]`:

- an existing doc renders normally;
- a known alias permanently redirects or renders the canonical page with a
  clear notice;
- a missing mapped/contextual doc renders the nearest valid index plus a notice
  naming the unavailable page;
- a completely unknown direct slug renders the docs index with search, not the
  shell's record-not-found dead end.

The page retains the current authenticated organization context and does not
cross into public-site documentation.

### 8.3 Tests

- header Help on a valid route;
- mapped doc present, renamed through alias, and missing;
- docs package empty/fresh install;
- direct valid/invalid/legacy URLs;
- contextual source route encoded safely;
- setup and shell layouts preserve their real permission boundary.

## 9. Security, privacy, and compliance

- Animal welfare records may contain adopter PII, legal-hold evidence, and
  sensitive location data. Route repositories scope every read by organization.
- Public animal projection exposes only explicitly published fields. Clinical,
  legal-hold, foster-address, screening, donor, and finance data never flow
  through the public storefront serializer.
- Care record sensitivity/retention labels use the existing retention engine
  contract. Legal hold prevents deletion.
- Foster contacts and adopters remain canonical contacts/principals; animal
  identity never masquerades as `Principal`.
- Consequential decisions—intake beyond capacity, medical treatment, adoption
  approval, euthanasia, and fund-restriction release—remain human-authorized.
- Every state transition records actor, time, prior state, and reason.

## 10. Migration and compatibility

This is an additive expand migration:

1. Create enums and new tables nullable where fleet-safe backfill requires it.
2. Add `animalProfileId` to `AdoptableAnimal`, initially nullable and unique.
3. Backfill one `AnimalProfile` per existing listing using the listing's
   organization, `animalRef`, identity fields, and status translation.
4. Link listings to profiles and add supporting indexes.
5. Add nullable work, donation, and journal-line dimensions.
6. Seed no operational facts. Existing listings become profiles but do not gain
   invented custody, clinical, housing, adoption, fund, or cost history.

The application dual-reads the legacy listing identity only during the same
release's migration boundary. New writes require `AnimalProfile`; public writes
project through the service. Contracting or making the one-to-one FK mandatory
is a later fleet release after conformance telemetry proves all rows linked.

No migration is edited after commit, no database is wiped, and no installed
runtime files are patched.

## 11. Scale and reporting

- List reads use `(organizationId, status/stage, updatedAt, id)` cursor indexes,
  default to 50 rows, and reject a requested page size above 100.
- Timelines use `(animalProfileId, occurredAt, id)` cursors, default to 50 rows,
  and reject a requested page size above 100.
- Capacity conflicts are interval/index constrained; no N-by-N resource scan.
- Cockpit aggregation issues bounded group/count/sum queries and returns per
  source `{ state: available|empty|unavailable, asOf, data }`.
- Cost per animal reads posted `JournalLine` subject dimensions for a bounded
  fiscal window; restricted balance reads posted fund dimensions.
- Long-stay is calculated from the open custody episode and has a configurable
  threshold, not a hard-coded shelter-policy decision.

The design holds to approximately 100,000 animal profiles, 10 million timeline
and care rows, 10,000 active resources, and 1,000 concurrent organizations per
installation with indexed pagination. Cross-install population benchmarking and
federated animal matching are outside `EP-5102F494`; a future federation epic
must add aggregate exchange and conflict contracts rather than widening these
queries.

Migration tests use a fixture with existing public listings and prove that the
backfill is resumable and idempotent. Query verification uses representative
high-cardinality fixtures and `EXPLAIN` evidence to reject sequential scans on
the bounded list, timeline, capacity-conflict, and cockpit paths. Any latency
budget is recorded from the repository's measured performance harness rather
than invented in this document.

### 11.1 Integration and connectivity boundary

This initiative integrates DPF services inside one installation: animal identity
is the stable subject reference; custody owns lifecycle state; Resource capacity
owns placement; care owns appointments and assessed facts; work owns recurring
commitments; finance owns posted money; the storefront owns only the optional
public projection. Multi-model invariants run in one database transaction where
atomicity is required. Read projections may refresh after commit, expose `asOf`,
and report a named source as unavailable instead of substituting stale data.

External shelter-management imports, veterinary-practice synchronization,
microchip registries, payment-provider changes, and cross-install federation are
not in this initiative. A later connector must translate into these canonical
commands and keep source provenance; it may not write the tables directly.

The first release is online-only. It does not cache adopter, donor, foster,
clinical, or legal-hold records in browser storage and does not queue mutations
for later replay. If connectivity is lost, the UI preserves only non-sensitive
in-memory input, shows that the write was not accepted, and requires an explicit
retry after reauthentication. It never renders optimistic completion. Because
the standing Pet Rescue operating model calls for signal-tolerant rounds, offline
capture and conflict resolution remain a named follow-up requirement and a
production-rollout risk, not an implied capability of this scope.

## 12. Delivery slices and acceptance trace

| Slice | Backlog item | Primary acceptance evidence |
|---|---|---|
| Help resolver and recovery UI | `BI-AE7C386B` | resolver/unit tests, header/direct-route tests, running Help path |
| Canonical animal identity and public-listing projection | `BI-4F8A484C` | migration/backfill tests, publication-boundary tests, durable animal detail |
| Housing/capacity integration | `BI-D2A51B36` | existing PRs #5000/#5022 plus animal-to-occupancy integration tests and running capacity drill-in |
| Subject clinical history + vet coordination | `BI-97290291` | care-record and appointment tests, animal care detail |
| Custody/intake pipeline | `BI-7111AF0C` | state-machine/legal-hold tests, running intake queue |
| Recurring daily care | `BI-5A25EC37` | recurrence/completion/exception tests, running care board |
| Adoption and return | `BI-A442F129` | application/placement transaction tests, running adoption flow |
| Restricted funds and animal-cost attribution | `BI-E861E8B8` | posting/dimension/reconciliation tests, bounded stewardship readouts |
| Pet Rescue home | `BI-7A38F667` | partial-result aggregation tests, responsive/themed cockpit verification |

The delivery decision is `decomposed`: each row is independently shippable and
retains its own BI and test-first evidence, while the operator-directed packaging
uses one shared Workroom, branch, nonproduction lease, and PR. The root plan
records dependencies and objective coverage across that coordinated delivery;
scope is claimed explicitly for every implementation path before editing.

## 13. Verification contract

Before publication:

1. Prisma format, generate, schema validation, and migration-from-existing-data
   verification.
2. Affected Vitest suites for state machines, repositories, resolvers, route
   contracts, projections, and UI components.
3. Web lint/typecheck and the repository's required local merge gates.
4. One governed shared nonproduction lease—the only source sandbox claim for
   this delivery—to exercise Help, intake, housing, care, adoption, return, and
   the Pet Rescue cockpit.
5. UX-fit review in narrow/wide and light/dark viewports, with screenshots.
6. Blast-radius analysis of schema, public storefront serialization, finance
   posting, recurrence, care appointments/intake, navigation, docs, seed,
   archetype activation, and generated indexes.
7. Independent semantic review of the stable committed tree, then DCO PR and
   merge queue.

### 13.1 Implementation risk register

These risks remain owned through implementation rather than disappearing at
design approval:

| Risk | Implementation mitigation | Release evidence and owner |
|---|---|---|
| Privacy leakage across adopter, donor, foster, clinical, or legal-hold records | Enforce organization scope and the animal-welfare capability on every command and read model; keep sensitive data out of browser persistence, logs, public projections, and Help query parameters; add negative authorization and serialization tests. | Security/privacy test suite plus public-payload snapshots; owner: Pet Rescue identity and route slices. |
| Scale degradation from unbounded animal history, capacity scans, or cockpit aggregation | Implement the cursor limits and composite indexes in §11, keep cockpit sources independently bounded, and add representative high-cardinality fixtures with measured query-plan evidence before the shared runtime verification. | Migration/query-plan tests and measured aggregation results; owner: data migration and cockpit slices. |
| Integration drift between custody, housing, care, work, finance, and the public adoption projection | Route writes through typed domain commands, keep cross-model invariants transactional, publish projections only after commit, surface source availability and `asOf`, and add contract tests for each handoff plus rollback behavior. | Cross-service integration tests and the end-to-end intake-to-placement walkthrough; owner: each domain slice, reconciled by `BI-7A38F667`. |

## 14. Architecture review (advisory)

- **Alignment summary:** aligned after choosing a canonical operational animal
  identity with an optional public projection.
- **Findings folded into this spec:**
  - A public listing could not remain the operational aggregate; §5.1 now
    establishes `AnimalProfile` and records `DI-0AFD05E602CA`.
  - Rescue-only housing, task, appointment, or finance tables would duplicate
    canonical services; §§5.3–5.4 instead extend resources, care, work, and
    journal dimensions.
  - A dashboard-first implementation would truthfully show only zeros; §12 puts
    the cockpit last and requires partial-result contracts.
  - Unbounded animal/timeline aggregation would fail at realistic history; §11
    names cursor keys, limits, and the scale ceiling.
  - Missing Help content is not a record-level 404; §8 makes it a recoverable
    resolver outcome.
- **Standards researched:** ASM, RefuPet, Shelter Hub, ASV 2022, and Shelter
  Animals Count; adopted/rejected details are in §3.
- **Escalated decisions:** canonical animal boundary, resolved by
  `DI-0AFD05E602CA` with no commandment conflict.
- **Recommended next step:** immutable design review through the governed
  initiative-readiness route, then a coverage-recorded implementation plan.

## 15. Current design-review finding dispositions

| Finding | Disposition in this revision |
|---|---|
| `IF-B0AEDBE9A774B561` | No external Pet Rescue wireframe exists or is claimed. Section 7 is the written UI contract; implementation screenshots remain future verification evidence. |
| `IF-0C274B6495B036E2` | Section 6.3 now defines trusted request context, organization isolation, action/field boundaries, negative tests, and the fail-closed authorization prerequisite exposed by the current capability catalog. |
| `IF-91AD392C75C37050` | Sections 11–11.1 now bind pagination and scale verification, define in-install service seams and excluded external connectors, and state the online-only/offline-failure contract and follow-up risk. |

These are dispositions for independent re-review, not a self-issued pass. The
failed receipt remains historical evidence against its original immutable blob.
