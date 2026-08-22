---
status: active
---

# Subject-agnostic scheduling and resource substrate implementation plan

> **For agentic workers:** implement test-first, keep the Workroom claim and impact contract current, and stop at the hybrid fallback if the clinical invariants below cannot be preserved. This is one governed architecture gate, not permission to build animal-welfare features early.

**Backlog item:** `BI-2C80E6EA`  
**Epic:** `EP-5102F494`  
**Primary decision:** `DI-F289DBB51DCB` — generalise subject-agnostically; hybrid remains the live fallback  
**Process-profile decision:** `DI-B0DC28CFFAB6` — keep process semantics in the existing activation-profile authority  
**Plan size:** xlarge, deliberately atomic

## Outcome

Generalise the existing scheduling, intake, resource, and archetype configuration seams without adding rescue-specific user behaviour:

1. `CareAppointment` and `CareIntakePacket` gain one validated, queryable subject reference (`subjectType`, `subjectId`) while their patient relations become conditionally clinical rather than universally required.
2. Existing human-care writes backfill and continue as `patient-profile` subjects with the same recall, overbooking authorization, preparation/recovery footprint, optimistic version, evidence, and RLS behaviour.
3. `Resource` becomes the canonical read/write projection for hospitality admin resources, with the legacy hospitality and provider rows retained as compatibility projections during the W19 soak.
4. Archetype process semantics live in the already-persisted, strictly parsed `StorefrontArchetype.activationProfile`; `customVocabulary` remains presentation labels only.
5. Restaurant and pet-rescue archetypes declare typed resource/subject defaults, but this item does not create kennels, animals, care rounds, applications, or any other rescue feature.

The current API paths, DTOs, IDs, error copy, and UI behaviour remain stable. The only observable change outside tests is an explicit failure if an admin roster exceeds the documented scale ceiling instead of an unbounded query.

## Decision guard and fallback

`DI-F289DBB51DCB` selected `generalise-subject-agnostic` at 8.334, with the hybrid only 0.433 behind. Therefore:

- Preserve `recallAt`, `overbookAuthorizedByPrincipalId` + `overbookReason`, `preparationMinutes`, `recoveryMinutes`, `footprintStart`, and `footprintEnd` in their existing physical care records and repository contracts.
- Preserve patient-context and staff-review RLS as fail-closed policies. Non-patient subject access is not granted by this gate; the later animal-welfare BIs add their own governed operator policies.
- Keep the Care* model and route names as compatibility vocabulary in this refactor. The canonical abstraction is the typed subject reference plus reusable helpers, not a second appointment/intake table.
- If a migration or repository change cannot retain every invariant above, stop the appointment/intake phase and ship the hybrid only: canonical Resource + process profile. State the fallback in the PR body.

`DI-B0DC28CFFAB6` independently scored the process-profile home:

- `activation-profile-process`: 8.044 (winner, high confidence, autonomy eligible)
- `dedicated-process-column`: 5.533
- `vocabulary-mixed-profile`: 0.200

The strongest contributors were Single Source of Truth and Research and Use Standards. Consequently, this plan does not add `StorefrontArchetype.processProfile` or mix behavioural flags into `customVocabulary`.

## Verified substrate and research

- The current `ArchetypeVocabulary` has ten label fields, not the stale eleven-field count in the finding. The architectural finding remains valid: it is presentation vocabulary, not a process abstraction.
- `StorefrontArchetype.activationProfile` is already the persisted, typed, schema-validated operating-model authority. `readActivationProfile` normalizes legacy records and `mergeActivationProfiles` owns multi-archetype composition.
- The W19 `Resource` family is an expand-phase canonical target. `sourceRef`, clone adapters, and `mergeDualRead` already provide provenance and deterministic canonical-first dedupe. The legacy hospitality family remains the compatibility projection until its soak/drop wave.
- `CareAppointment` already owns the required clinical scheduling invariants. `CareIntakePacket` and its evidence children already own minimum-necessary, consent, coverage, provenance, and RLS behaviour.
- A read-only inventory on the live install found zero `HospitalityResource`, `HospitalityResourceAvailability`, `CareAppointment`, and `CareIntakePacket` rows. That removes current-install vocabulary surprises but does not weaken the any-state fleet migration requirement.
- HL7 FHIR R5 models appointment participants with typed references and QuestionnaireResponse with an independent typed `subject`, `author`, and `source`. DPF will adopt the typed-reference separation, not FHIR payloads or a new interoperability surface: <https://www.hl7.org/fhir/appointment.html> and <https://fhir.hl7.org/fhir/questionnaireresponse.html>.
- Microsoft Dynamics 365 Field Service separates schedulable resource type/profile from the work being scheduled. DPF will mirror that separation through process-configured resource kinds and the canonical `Resource` family: <https://learn.microsoft.com/en-us/dynamics365/field-service/scheduling-resource-types>.

## Requirements, contracts, flows, and verification map

### Requirements

- **R1 — zero behaviour drift:** current care and hospitality callers receive the same success/error semantics, public IDs, DTOs, and clinical authorization behaviour.
- **R2 — one process-profile home:** typed process semantics are nested in `activationProfile`, strictly parsed, and deterministically composed; vocabulary stays labels only.
- **R3 — canonical Resource:** hospitality resources and availability are backfilled and dual-written to `Resource` / `ResourceAvailability`; canonical rows win reads by `sourceRef` while legacy projections remain rollback-safe.
- **R4 — typed subject reference:** appointment and intake roots carry non-empty, validated `subjectType` and `subjectId`; existing rows backfill as `patient-profile:<patientProfileId>`.
- **R5 — clinical preservation:** patient subjects still require matching patient, visit-type, and care-location relations and retain recall, overbooking, footprint, evidence, and RLS invariants.
- **R6 — any-state data safety:** the migration is generated from `packages/db`, preserves unknown legacy vocabulary visibly, reconciles row counts/provenance, and has an explicit rollback disposition.

### Contracts

- **C1 — process profile:** `catalogModes[]`, `subjectTypes[]`, `housesSubjects`, `schedulesSubjects`, and `resourceKinds[]` are code-typed and write-validated inside `ActivationProfile.processProfile`.
- **C2 — subject reference:** subject types are open, validated slugs because identity homes grow by vertical; built-in constants are compiler-checked and subject IDs remain opaque identifiers, never JSON metadata.
- **C3 — clinical discriminator:** a database check requires patient/visit/location fields for `patient-profile` appointments and requires `subjectId = patientProfileId`; non-patient subjects cannot carry a patient relation accidentally.
- **C4 — intake relation:** packet/response/access/exception/status joins use packet + organization identity; patient-specific consent and coverage joins retain the stronger patient composite relation.
- **C5 — resource compatibility:** restaurant attribute parsing stays in its vertical codec; the shared admin profile supplies kind, capacity unit, limit, and canonical/legacy mapping without learning restaurant vocabulary.
- **C6 — bounded reads:** admin roster reads have a hard 5,000-row ceiling and fail explicitly above it. Raising the ceiling requires cursor pagination and a separately filed BI.

### Flows

- **F1 — archetype to resource config:** checked-in archetype → seed `activationProfile` → strict parser → composite process profile → resource-kind selection.
- **F2 — hospitality resource write/read:** existing route → shared admin profile → atomic canonical + legacy/provider write → canonical-first provenance merge → unchanged hospitality DTO.
- **F3 — human care:** booking/intake request → patient context → `patient-profile` subject helper → existing Care* repository/evidence paths → unchanged patient response.
- **F4 — future subject:** later animal/asset route → the same subject helper and roots → separately governed vertical relations/policies; no Care model clone.

### Verification

- **V1:** activation parser, composition, archetype, and seed tests prove R2/C1/F1.
- **V2:** clone-adapter, dual-read, shared-profile, and route characterization tests prove R1/R3/C5/C6/F2.
- **V3:** subject-helper, schema, appointment repository, and intake repository/access tests prove R1/R4/R5/C2/C3/C4/F3.
- **V4:** migration safety, schema validation/generation, any-state fixtures, count reconciliation, RLS tests, and data-impact checks prove R6.
- **V5:** prose-lint and style-drift guards prove the refactor adds no ungoverned UI copy or styling surface.
- **V6:** pregate preflight, exact-tree local CI, independent semantic review, PR health, and merge verification prove the integrated branch.

## Backlog coverage

- **Decision:** atomic
- **Parent:** `BI-2C80E6EA`
- **Receipt:** pending initial immutable-plan recording
- **Rationale:** The process profile, canonical resource projection, subject reference, compatibility adapters, clinical constraints, RLS preservation, and backfill form one zero-behaviour architecture gate. Shipping any phase independently would leave two authorities, a write path without a read migration, or a polymorphic root without the constraints that preserve clinical safety. The phases below are implementation order, not independently shippable product slices.

## Architecture

### 1. Process semantics accompany vocabulary; they do not become vocabulary

Add a strictly parsed `ArchetypeProcessProfile` inside `ActivationProfile`:

- `catalogModes`: additive set of `priced`, `donation`, and `unpriced`.
- `subjectTypes`: additive, validated subject slugs such as `patient-profile`, `animal`, and `asset`.
- `housesSubjects` and `schedulesSubjects`: monotonic booleans in composition.
- `resourceKinds`: keyed definitions containing `kindSlug`, `capacityUnit`, and `maxCapacity`; primary archetype wins a same-key conflict and secondaries add new keys.

Seed restaurant with `table` / `seats` / 100 and pet rescue + animal shelter with animal subject/housing/scheduling posture and `kennel` / `animals`. These are configuration facts only; no resource rows or rescue UI are created.

### 2. Resource becomes canonical without bypassing W19 convergence

Extract `admin-resource-profile.ts` as a small, injected service/adapter boundary. The hospitality routes keep their paths and restaurant attribute codec, but source `kindSlug`, `capacityUnit`, and capacity validation from the parsed process profile.

Backfill `HospitalityResource` and availability into the canonical family with deterministic `sourceRef` keys. Treat legacy `blocked` as an active resource with its blocked reason, not as archived; preserve any unknown status as archived with `lifecycleReason=legacy-status:<value>`. Writes update canonical and legacy/provider projections in one transaction. Reads merge by provenance with canonical values winning while retaining the legacy public row ID expected by the current route and UI.

Do not drop any legacy table, compatibility provider, or source reference in this BI. That remains the operator-soak boundary in `2026-08-18-w19-vertical-clone-collapse-data-migration-plan.md`.

### 3. Subject polymorphism is normalized into columns, not metadata

Add the same `subjectType` + `subjectId` contract to appointment and intake roots. A pure `subject-reference.ts` module validates open slugs/opaque IDs and supplies `patientSubjectReference(patientProfileId)` for current care writers.

Use single-table inheritance for this gate: existing care-specific nullable relations stay on the established physical records, with database checks making their conditional requirements explicit. This avoids a second appointment/intake authority and preserves the mature evidence/RLS graph. Existing rows are backfilled before `subjectType` and `subjectId` become required.

For intake children, remove patient identity from the generic packet join while retaining optional direct patient provenance. Consent and coverage remain patient-specific branches with their composite patient constraints. Patient-token RLS continues to reject rows with no allowed patient profile; staff review retains its exact purpose-and-actor-bound select policy. No generic non-patient write policy is introduced here.

### 4. Data lifecycle, rollback, and scale

- Care appointment/intake records remain `restricted`; Resource remains `internal`. Subject-reference fields inherit the owner record classification.
- Existing retention windows, legal-hold semantics, append-only triggers, and physical table names remain unchanged.
- No new Prisma model is introduced, so the model-count baseline must not be ratcheted.
- The migration is expand/backfill/constraint work and does not drop legacy columns/tables. Because this gate exposes no non-patient writer, a source revert can restore the prior NOT NULL clinical constraints; canonical hospitality rows are removable by their `Hospitality*:<id>` source refs while legacy rows remain authoritative.
- Queries use organization + subject + schedule/status indexes. Route roster reads stop at 5,001 to detect the 5,000 ceiling without silent truncation; availability request limits remain 50 + 50.

## Refactoring budget

Reserve approximately 20 percent of implementation effort for structural cleanup that directly reduces future vertical cost:

- one pure subject-reference helper instead of repeated string pairs;
- one strict process-profile parser/composer in the existing activation authority;
- one shared resource-admin profile/adapter instead of a cloned animal-resources route implementation;
- characterization helpers that keep hospitality DTO mapping and clinical invariants readable;
- removal of route-local table/seats validation constants after configuration owns them.

Do not spend this budget on unrelated Care model renames, Workspace UI, animal-welfare screens, the W19 clone drop, or broad schema cleanup.

## File map

Create:

- `packages/db/src/subject-reference.ts` and `.test.ts`
- `apps/web/lib/resource-scheduling/admin-resource-profile.ts` and `.test.ts`
- `packages/db/prisma/migrations/20260822060000_subject_agnostic_scheduling_and_resources/migration.sql`
- `docs/data-impact/2026-08-22-subject-agnostic-scheduling-and-resources.data-impact.json`

Modify:

- `packages/storefront-templates/src/types.ts`, `activation-profile.ts`, `composition.ts`, and their tests
- `packages/storefront-templates/src/archetypes/food-hospitality.ts`, `nonprofit-community.ts`, and archetype tests
- `packages/db/src/seed-storefront-archetypes.ts`, its tests, and `packages/db/src/index.ts`
- `apps/web/lib/resource-scheduling/clone-adapters.ts`, `dual-read.ts`, and their tests
- both hospitality-resource routes and colocated tests
- `packages/db/prisma/schema/verticals-care.prisma`
- care appointment/intake domain helpers, schema tests, repositories, access helpers, and related tests
- generated documentation and architecture projections required by the impact contract

## Implementation phases

### Phase 0 — Record and review the architecture plan

1. Commit and push this plan with DCO sign-off.
2. Record atomic four-way coverage for R1–R6 / C1–C6 / F1–F4 / V1–V6 against the immutable plan blob; add and revalidate the returned receipt.
3. Run the DPF chief-architect review. Fold every concrete finding into this plan, regenerate doc projections, and recommit before source implementation.

### Phase 1 — Process profile (Red → Green → Refactor)

1. Add failing parser tests for valid resource kinds, malformed/unbounded values, legacy-profile defaults, and no free-form behaviour rules.
2. Add failing composition tests for monotonic booleans, additive catalog/subject sets, resource-key union, and primary conflict precedence.
3. Add failing archetype/seed tests for restaurant, pet rescue, and animal shelter profiles.
4. Implement the typed profile, strict normalization, deterministic composition, and seed persistence in the existing activation JSON.
5. Run the exact template and seed tests; refactor only after Green.

### Phase 2 — Canonical hospitality Resource (Red → Green → Refactor)

1. Extend clone-adapter tests for blocked status, unknown-status provenance, canonical DTO mapping, and availability mapping.
2. Write failing shared-profile tests proving table/seats/100 comes from process configuration and the 5,000 roster ceiling fails explicitly.
3. Extend both route suites to characterize current IDs/DTOs/errors and require atomic Resource + legacy/provider writes.
4. Implement the injected profile/service and canonical-first provenance merge. Keep restaurant attributes in the existing codec and the route entrypoints thin.
5. Run route, adapter, dual-read, prose-lint, and style-drift tests before proceeding.

### Phase 3 — Subject-aware appointment and intake (Red → Green → Refactor)

1. Write failing subject-helper tests for patient/animal/asset/open-slug references and malformed values.
2. Extend Prisma schema tests to require subject columns, subject indexes, conditional clinical checks, generic packet joins, and unchanged evidence/RLS/immutability contracts.
3. Extend care repository tests so every current write emits `patient-profile` + the existing patient id while public request/response types remain unchanged.
4. Add non-patient pure/schema fixtures proving clinical relations can be absent without weakening patient requirements.
5. Implement the schema, helper, repositories, and compatibility types; keep current API and route surfaces unchanged.

### Phase 4 — Generated migration and data governance

1. From `packages/db`, generate the create-only migration:

   ```powershell
   pnpm exec prisma migrate dev --create-only --name subject_agnostic_scheduling_and_resources
   ```

2. Review and amend the generated SQL with inline, idempotent backfills; reconciliation checks; conditional clinical constraints; RLS preservation; canonical hospitality resource/availability backfill; and `@migration-safety` attestations.
3. Add any-state fixtures covering populated care rows, blocked hospitality resources, unknown legacy vocabulary, duplicate/retry application, empty installs, and rollback preconditions.
4. Add the data-impact manifest with migration/backfill/rollback, field provenance, classification, retention, and affected-copy details.
5. Regenerate documentation/architecture projections after every documentation or schema edit.

### Phase 5 — Verification and delivery

Run targeted suites first, then proportional package gates:

```powershell
pnpm --filter @dpf/storefront-templates exec vitest run src/activation-profile.test.ts src/composition.test.ts src/archetypes/archetypes.test.ts
pnpm --filter @dpf/db exec vitest run src/subject-reference.test.ts src/healthcare-care-appointment.test.ts src/healthcare-care-appointment-model.test.ts src/healthcare-care-intake-model.test.ts src/healthcare-care-intake-staff-rls.test.ts test/seed-storefront-archetypes.test.ts
pnpm --filter web exec vitest run apps/web/lib/resource-scheduling/admin-resource-profile.test.ts apps/web/lib/resource-scheduling/clone-adapters.test.ts apps/web/lib/resource-scheduling/dual-read.test.ts apps/web/app/api/storefront/admin/hospitality-resources/route.test.ts 'apps/web/app/api/storefront/admin/hospitality-resources/[id]/route.test.ts' apps/web/lib/healthcare/care-appointment-repository.test.ts apps/web/lib/healthcare/care-intake-access.test.ts apps/web/lib/healthcare/care-intake-api-repository.test.ts
pnpm --filter @dpf/db generate
pnpm --filter @dpf/db typecheck
pnpm --filter web typecheck
pnpm run check:prose-lint:test
pnpm run check:prose-lint
node scripts/check-style-drift.mjs
pnpm run pregate:preflight
```

Then:

1. Run exact-tree merged-code local CI through the governed shared sandbox (`pnpm run pregate`), including migration convergence from representative prior states and production build.
2. Commit the stable tree with a matching DCO sign-off and obtain a fresh independent semantic-review receipt.
3. Push, open one ready non-draft PR for `BI-2C80E6EA`, and include `Seed-Fit-Decision:` in the PR body plus the data-impact manifest reference and primary/hybrid decision disposition.
4. Run `pnpm pr:health`, read bot review findings as well as checks, resolve every issue, enable squash auto-merge, and verify the merge before beginning `BI-D2A51B36`.

## Definition of done

- Current care and hospitality behaviour is characterized and unchanged.
- Process configuration is typed, composed, and persisted in the existing activation-profile authority.
- Hospitality Resource/availability reads and writes are canonical-first and provenance-reconciled while legacy projections remain rollback-safe.
- Appointment/intake roots are subject-aware; current care rows and writes are explicit patient subjects.
- Recall, overbooking authorization, preparation/recovery footprint, status evidence, intake evidence, RLS, retention, and legal-hold behaviour remain intact.
- Migration/data-impact/generated-doc gates pass on empty and populated states.
- Coverage receipt, architecture review, exact-tree local CI, independent semantic review, DCO PR health, squash auto-merge, and post-merge verification are complete.
