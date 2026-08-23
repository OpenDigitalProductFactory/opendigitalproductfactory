---
status: proposed
---

# Canonical resource occupancy for animal housing

- **Date:** 2026-08-23
- **Status:** Review-ready; implementation remains gated
- **Epic:** `EP-5102F494`
- **Backlog item:** `BI-D2A51B36`
- **Workroom:** `WC-B0DD2B2F`
- **Companion plan:** `docs/superpowers/plans/2026-08-23-bi-d2a51b36-resource-occupancy.md`
- **Kernel decision:** `DI-C955877F245D` (`canonical-resource-occupancy`, high confidence)
- **Readiness decision:** `IRD-63E785B55D6B` (`input-required`; no implementation before the required receipts exist)

---

## 1. Executive decision

DPF will represent a subject's residence in a capacity-bearing operating resource with one subject-polymorphic, append-preserving `ResourceOccupancy` ledger beside canonical `Resource`. Animal welfare is the first consumer: kennels, wards, runs, pens, and foster homes are `Resource` rows in the `animal_welfare` domain, while each animal's current and historical location is projected from occupancy rows keyed by stable `animalRef`.

The design does not widen booking-oriented `ResourceCapacityAllocation` into open-ended residence and does not create an animal-only placement table or route. Generic Resource commands own resource lifecycle and capacity invariants; animal-welfare code supplies subject validation, compatibility policy, and the operator-facing projection. Hospitality consumes the same generic resource repository rather than retaining a second implementation.

### 1.1 Objectives

1. **OBJ-HOUSING-001:** A shelter coordinator can see the current housing location and movement history of every animal from the existing Animals management route.
2. **OBJ-HOUSING-002:** The system reports safe free capacity by housing kind and animal size without counting blocked, retired, incompatible, or already-full resources.
3. **OBJ-HOUSING-003:** Every move, release, and reassignment preserves history and atomically enforces organization, lifecycle, blocked-state, compatibility, uniqueness, and capacity invariants.
4. **OBJ-HOUSING-004:** Kennels and foster homes use the same canonical Resource and occupancy contracts, so off-site capacity is not fragmented from shelter capacity.
5. **OBJ-HOUSING-005:** Hospitality and animal welfare share one generic admin-resource repository and route contract without breaking existing hospitality behavior.
6. **OBJ-HOUSING-006:** The Animals UX remains one scan-first, mobile-capable operating surface with honest empty and failure states and no new global or section navigation.

### 1.2 Acceptance manifest

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-HOUSING-001 | OBJ-HOUSING-001, OBJ-HOUSING-003 | An authorized operator can assign, move, and release an animal, and the read model returns exactly one current occupancy plus a chronological immutable history. |
| AC-HOUSING-002 | OBJ-HOUSING-002, OBJ-HOUSING-003 | Concurrent moves cannot overfill a destination or leave two current occupancies for one organization-scoped subject. |
| AC-HOUSING-003 | OBJ-HOUSING-002, OBJ-HOUSING-004 | Capacity summaries include on-site and foster resources and exclude blocked, retired, full, and size-incompatible units. |
| AC-HOUSING-004 | OBJ-HOUSING-003 | Cross-organization subjects and resources, nonpositive quantities, backward time ranges, unsupported subject kinds, and invalid lifecycle transitions are rejected. |
| AC-HOUSING-005 | OBJ-HOUSING-005 | Hospitality resource create and update behavior passes its existing route tests through the shared repository, with no animal-resources clone introduced. |
| AC-HOUSING-006 | OBJ-HOUSING-001, OBJ-HOUSING-006 | The first viewport of `/storefront/animals` exposes free capacity and animals without housing before catalog media work, while housing setup stays progressively disclosed. |
| AC-HOUSING-007 | OBJ-HOUSING-006 | Desktop and narrow governed-browser verification covers seeded kennel, foster, blocked, full, incompatible, unassigned, permission, mutation-failure, and settled-success states. |
| AC-HOUSING-008 | OBJ-HOUSING-001, OBJ-HOUSING-002, OBJ-HOUSING-003, OBJ-HOUSING-004, OBJ-HOUSING-005, OBJ-HOUSING-006 | A DCO-signed exact-tree branch passes affected tests, migration replay and guards, UX measurement, independent semantic review, local integration CI, PR health, and squash auto-merge. |

### 1.3 Non-goals

- Intake, legal holds, daily-care rounds, adoption workflow, veterinary workflow, supply inventory, funding, events, and Workspace tiles remain in their ordered epic items.
- Foster-person CRM is not introduced here. A foster home is a capacity-bearing housing resource; its future human relationship may link through existing identity/CRM substrate without changing occupancy semantics.
- This slice does not migrate `CareAppointment` or decide the clinical hybrid fallback.
- The design does not add a new page, global navigation item, section tab, dashboard dialect, prompt-sending action, or animal-only resource API.
- No historical animal-location backfill is invented because the current schema contains no authoritative location field.

---

## 2. Problem and operating context

Second Chance Animal Rescue cannot currently answer the prerequisite operational questions “where is this animal?” and “is there safe room for another intake?” `AdoptableAnimal` has identity and catalog state but no location. Canonical `Resource` already represents named, capacity-bearing operational units with service area, block reason, lifecycle, and organization/storefront identity. Hospitality proves the shape with tables and seats, but its route currently carries domain-specific persistence behavior.

Foster placement must be part of the same capacity picture. Treating foster as a separate placement system would produce two current-location authorities and make intake decisions undercount off-site capacity.

---

## 3. Research and benchmarking

The design adopts operational patterns, not code dependencies.

- [Animal Shelter Manager](https://github.com/sheltermanager/asm3) and its [manual](https://sheltermanager.com/repo/asm3_help.pdf) treat foster, adoption, and transfer as time-ordered movements with a current location. DPF adopts movement history and rejects the rescue-specific monolith.
- [RefuPet / Hackapet](https://github.com/hackapet-project/petsync_web_V2) keeps the animal record and shelter operations in one mobile-capable surface. DPF adopts one operator surface and rejects a separate housing application.
- [Open Animal Rescue](https://github.com/leethobbit/OAR) emphasizes small-rescue operability and local control. DPF adopts the operating posture and rejects a parallel rescue data model.
- [albdangarcia/animal-shelter](https://github.com/albdangarcia/animal-shelter) uses lifecycle history and transactions for multi-record changes. DPF adopts atomic close-and-open movement and rejects a UI-only location flag.
- DPF design-intelligence precedents for [OpenTable table management](https://www.opentable.com/restaurant-solutions/products/table-management/) and [Rentman inventory management](https://rentman.io/solutions/inventory-management) reinforce a scan-first assignment surface with visible capacity, location, conflict reasons, and an accessible list alternative. DPF adopts explicit compatibility and operator confirmation and rejects color-only or spatial-only meaning.

No runtime dependency or external hosted service is added.

---

## 4. Substrate verification

### 4.1 Existing substrate extended

- `Resource` owns unit identity, `domain`, open `kindSlug`, label, capacity/unit, service area, block reason, attributes, lifecycle, organization, and optional storefront.
- `ResourceAvailability` owns recurring and dated availability/block windows.
- `ResourceCapacityAllocation` owns time-bounded booking/hold demand. Its mandatory `startsAt` and `endsAt` and booking relations make it the wrong authority for open-ended residence.
- `AdoptableAnimal.animalRef` is the stable semantic subject reference.
- `ActivationProfile.processProfile.resourceKinds` already constrains allowed kinds, capacity units, and maximum capacity per archetype.
- `/storefront/animals` and `AnimalsManager` are the canonical internal animal-management surface.
- Report-kit already supplies `StatCard`, `StatusBadge`, `EmptyState`, tables, and progressive-disclosure primitives.

### 4.2 Verified gap

No canonical model links an arbitrary subject to its current capacity-bearing `Resource` while preserving open-ended movement history. `ResourceCapacityAllocation` cannot be widened without changing booking conflict semantics and forcing artificial end times. A new ledger is therefore justified, but its identity remains open and subject-polymorphic so the next housed-subject vertical extends it instead of cloning it.

### 4.3 Overlap disposition

Live backlog and open-PR sweeps found this work in `BI-D2A51B36` under `EP-5102F494` and no competing occupancy implementation. WordPress PR #4478 released the four generated route artifacts at merged commit `2b3ea261f841df1f68fcfe6720bda546044aaf92`; regeneration begins from current `origin/main` only after implementation readiness passes.

---

## 5. Architecture decision

Kernel decision `DI-C955877F245D` compared:

1. a canonical subject-polymorphic `ResourceOccupancy` ledger;
2. widening booking-oriented `ResourceCapacityAllocation` into open-ended residence;
3. an animal-specific `AnimalHousingPlacement` table.

Option 1 won with composite `12.153`, margin `6.040`, high confidence, no commandment conflict, and autonomy eligibility. It preserves one responsibility per ledger, avoids artificial booking windows, and prevents animal welfare from becoming a second home for resource capacity.

### 5.1 Ownership boundaries

| Concern | Canonical owner |
| --- | --- |
| Unit identity, capacity, service area, blocked reason, lifecycle | `Resource` |
| Current and historical subject residence | `ResourceOccupancy` |
| Allowed kinds, unit, maximum capacity | activation profile `resourceKinds` |
| Animal identity and size | `AdoptableAnimal` |
| Generic Resource persistence and optimistic concurrency | shared admin-resource repository |
| Move/release transaction and capacity enforcement | shared occupancy command service |
| Animal size compatibility and presentation | animal-welfare housing policy/read model |
| Visible capacity and assignment workflow | existing `/storefront/animals` route |

No visible count, status, or location is stored again in UI state as an authority. The page receives a serialized read model and refreshes it after a settled mutation.

---

## 6. Data design

### 6.1 Domain extension

Add `animal_welfare` to closed Prisma enum `ResourceDomain`. Resource kinds remain open per domain and are constrained by the activation profile. Pet-rescue and animal-shelter profiles include at least:

- `kennel`, `capacityUnit: "animals"`;
- `foster-home`, `capacityUnit: "animals"`.

Additional run/pen/ward vocabulary can be configured without widening a global enum.

### 6.2 `ResourceOccupancy`

The normalized ledger contains:

- `id`;
- `organizationId`, optional `storefrontId`, and required `resourceId`;
- `domain` copied from the governed resource domain for bounded domain queries and contract validation;
- `subjectKindSlug` and `subjectRef` as the open subject identity;
- positive `quantity`, defaulting to one;
- `startedAt`, nullable `endedAt`, and nullable `transitionReason`;
- optional organization-scoped `idempotencyKey`;
- lifecycle/version/audit timestamps consistent with canonical resource ledgers.

Relations use composite `(resourceId, organizationId)` and optional `(storefrontId, organizationId)` foreign keys, plus the canonical `Organization` relation. `AdoptableAnimal` is deliberately not a database FK because the ledger is polymorphic; the command adapter proves an `animal` subject under the same organization and stores its stable `animalRef`.

### 6.3 Database invariants and indexes

- Partial unique index on `(organizationId, subjectKindSlug, subjectRef)` where `endedAt IS NULL`.
- Check `quantity > 0`.
- Check `endedAt IS NULL OR endedAt >= startedAt`.
- Unique `(organizationId, idempotencyKey)` with nullable idempotency semantics.
- FK-leading index `(resourceId, organizationId, endedAt)` for current load and history.
- Subject-history index `(organizationId, subjectKindSlug, subjectRef, startedAt DESC)`.
- Domain/storefront current-capacity index sufficient for paged roster reads.

The migration is additive and forward-only. There is no backfill. Rollback disables new commands and uses a compensating migration; it never drops populated history.

### 6.4 Transaction contract

`moveResourceOccupant` runs under serializable isolation with a small bounded retry only for PostgreSQL serialization conflicts:

1. Resolve the caller, organization/storefront, subject adapter, destination Resource, and activation profile.
2. Reject a missing, cross-organization, retired, blocked, wrong-domain, unconfigured-kind, wrong-capacity-unit, or incompatible destination.
3. Lock/read the destination's current occupancy quantity and the subject's current row.
4. Reject a move whose quantity would exceed capacity after accounting for a same-resource current row.
5. Close the prior row and insert the destination row atomically; a null destination closes without inserting.
6. Return the authoritative current placement, history cursor, and capacity delta.

Idempotency returns the prior successful result for the same organization/key and rejects a conflicting payload. Optimistic `Resource.version` guards unit edits; occupancy serialization guards moves.

---

## 7. Service and API contracts

### 7.1 Generic Resource repository

Extract hospitality's canonical Resource persistence into a shared repository that accepts organization/storefront, `ResourceDomain`, configured kind, validated capacity, service area, block reason, attributes, lifecycle, and expected version. Hospitality keeps only table-specific attribute translation and response compatibility.

### 7.2 Routes

- `GET/POST /api/storefront/admin/resources` lists or creates configured resources using bounded pagination and explicit filters.
- `PATCH /api/storefront/admin/resources/[id]` changes mutable resource properties with expected-version concurrency.
- `POST /api/storefront/admin/resource-occupancies` performs `move` or `release`; response includes current placement and bounded history metadata.
- Existing hospitality routes delegate to the shared repository and retain their public contract.
- The existing animal route may update animal catalog fields, but it does not become a second occupancy writer.

All routes use existing storefront-admin authorization and shared action-result/JSON primitives. Unknown filters, unsupported subject kinds, and invalid closed values fail explicitly.

### 7.3 Read model and pagination

The Animals page receives:

- capacity totals by configured housing kind and supported animal-size band;
- counts of blocked, full, and free resources;
- animals without a current occupancy;
- current placement per displayed animal;
- a cursor-bounded movement history requested progressively rather than loaded for the entire roster.

List routes use stable cursor pagination. Capacity aggregation is database-bounded by one organization/storefront and current rows; no platform-wide scan or silent `take` cap is permitted.

### 7.4 Scale ceiling

This slice is designed for one organization/storefront with tens of thousands of housing resources and current occupants, using indexed current-row aggregation and cursor-paged history. It does not provide cross-install or cross-organization fleet analytics. `EP-5102F494` owns the vertical operating model; any future federated capacity exchange requires a separate epic over the existing federation contracts rather than widening this request path into mesh fan-out.

---

## 8. UX design

### 8.1 Fit decision

- **Decision:** `fits-with-guardrails`
- **Owning area:** Storefront
- **Route:** existing internal `/storefront/animals`
- **Primary persona:** shelter coordinator deciding where an animal is housed and whether intake remains safe
- **Navigation layer:** contextual actions only
- **AI boundary:** no prompt send

### 8.2 First viewport

The page leads with the operator's two decisions, not schema nouns:

1. free housing capacity, separated by kennel/foster and applicable size;
2. animals needing housing.

Catalog photo and profile editing remains available but follows operating attention. `StatCard` and `StatusBadge` use report-kit tokens. A compact filter controls the animal roster; no new dashboard, tab row, or global navigation is introduced.

### 8.3 Assignment interaction

Each animal exposes one reachable contextual “Move” action. The form identifies the current location, offers only compatible destinations with free capacity, and supports release with an explicit reason. Housing-unit setup is progressively disclosed because it is occasional configuration, while moving an animal is routine work.

Pending, success, validation, permission, and server-failure states are visible and settled. Controls meet the 44px target standard, preserve focus, and use only `--dpf-*` theme variables and existing primitives.

### 8.4 Empty and failure states

- No units: explain why assignments are unavailable and reveal “Add housing unit.”
- Units exist but all are blocked/full/incompatible: state the specific constraint; do not show a generic zero state.
- No unassigned animals: confirm that every displayed animal has housing.
- Permission denied: show read-only state without a dead control.
- Save failure: preserve the operator's input and provide retry.
- Stale/concurrent move: refresh authoritative placement and explain that another update won.

### 8.5 Measured evidence

Before merge, a `sweep-measurement` manifest at `docs/ux-fit/2026-08-23-animal-housing-operations.ux-fit.json` covers exactly the changed UI files and records default-visible words, lead-band words, primary actions, visible fields, maximum choices, sub-legible controls, buried action, and axe violations against the committed route baseline. Governed browser verification exercises desktop and narrow viewports with kennel, foster, blocked, full, incompatible, unassigned, and mutation states.

---

## 9. Security, privacy, compliance, and domain safeguards

- Storefront-admin authorization protects resource and occupancy writes; ordinary catalog visibility does not imply move authority.
- Organization/storefront scope is rederived server-side and enforced in every relation and query.
- Foster-home labels and attributes must not expose a private home address in the general animal roster. Future person/address details remain in canonical identity/CRM models and require a separately authorized view.
- Transition reasons are operational notes, not medical records. Clinical data remains in the veterinary/care substrate.
- Audit history is append-preserving; release or correction closes a row instead of deleting it.
- Blocked/quarantine reasons are operator-visible only at the privilege already required for internal animal management.
- Capacity is a safety control, not a recommendation to accept intake. Later intake workflow applies legal hold, staffing, care, quarantine, and mission criteria before acceptance.

---

## 10. Architecture review (advisory)

- **Alignment summary:** aligned with guardrails.
- **Data model:** extends canonical `Resource`; the new ledger owns a missing normalized residence fact and does not duplicate booking allocation or animal identity.
- **Normal form:** location history exists once in occupancy; current location is a query projection, not a copied animal column.
- **Scalability:** indexed current-row aggregation and cursors avoid unbounded organization history loads; the explicit ceiling excludes federation.
- **Single source of truth:** activation profiles own resource-kind policy, Resource owns capacity/block/lifecycle, occupancy owns residence, and animal welfare owns compatibility.
- **Substrate fit:** generic resource repository replaces hospitality-only persistence while vertical adapters remain thin.
- **Contracts:** the new `ResourceDomain` value is a migration; open kind vocabulary stays profile-constrained.
- **Blast radius:** Prisma schema/migration, organization/resource relations, activation profiles, shared repository/routes, hospitality adapters, animal read model/route/component, generated route/doc/architecture artifacts, and related tests.
- **Finding folded into this spec:** movement history must be cursor-bounded and foster address data must not leak through Resource attributes.
- **Escalated decisions:** none; `DI-C955877F245D` already settled the genuine ledger trade-off.

This advisory does not substitute for the independent architecture, data, UX, security, compliance, domain, design-checklist, or plan-review receipts required by initiative readiness.

---

## 11. Delivery and verification contract

Implementation follows the companion plan with TDD:

1. schema/profile tests fail for the absent contract;
2. additive schema and migration make them green;
3. shared repository/occupancy service route tests drive generic behavior and hospitality compatibility;
4. read-model and component tests drive capacity and operator states;
5. generated artifacts, measured UX evidence, browser verification, independent semantic review, exact-tree local CI, PR health, and squash auto-merge complete the item.

The worktree is currently `source-only`; no local pnpm, component, or Prisma test may be claimed until managed dependencies are available or the governed shared local-CI environment supplies evidence.

### 11.1 Documentation impact

This spec and the companion plan are the design authority. Generated architecture counts and route/doc indexes update with implementation. User-guide documentation is added only after the workflow is functionally proven so it describes shipped behavior rather than intent.

### 11.2 Refactoring allocation

Approximately twenty percent of implementation effort converges shared substrate: extracting the generic Resource repository, shrinking hospitality routes to adapters, centralizing occupancy validation, and replacing hand-rolled Animals status/form chrome with existing primitives. This refactor stays behavior-guarded and does not expand the BI into unrelated cleanup.

---

## 12. Readiness and handoff

This artifact is review-ready, not approved. Implementation claim `IRD-63E785B55D6B` remains `input-required`. The only writer for the required `initiative_scope_baseline` is the independent spec-approval transaction, and current `origin/main` explicitly reports that it is not reachable from an external MCP session. Live remediation is `BI-0996913C`.

The next authorized transition must bind this exact immutable repository blob to:

- research and artifact-author identity;
- passing design-checklist/spec approval and objective baseline;
- independent architecture, data, UX, security, compliance, and domain reviews;
- a passing plan review and plan/backlog coverage receipt.

No source implementation begins until that enforced transition succeeds.
