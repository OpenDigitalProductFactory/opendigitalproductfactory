# Location Reference Resolution Design

**Status:** Draft
**Date:** 2026-04-25
**Related Epic:** EP-SITE-7C4D2B - Customer Site Records & Location Validation
**Scope:** Reference data stewardship, progressive location selection, address resolution, provider-assisted validation, and Build Studio guidance for long-term fixes.

---

## Problem Statement

The current geographic reference model is structurally linked, but the product experience does not consistently reveal that structure. The admin reference-data page loads all countries, all regions, and all cities at once, then renders a large city list in the browser. Work-location address entry uses a better country to region to city cascade, but it lacks the inline missing-locality creation flow already present in employee addresses.

This creates two related failures:

1. Users see an unscoped city list instead of a progressive location flow.
2. Valid towns can be missing because the seeded `City` data is a bootstrap subset, not an exhaustive global locality dataset.

The live 2026-04-25 check showed 250 countries, 4,961 regions, and 4,599 cities. Texas had only three seeded city rows and did not include Thorndale. That is not a one-off data defect; it is evidence that the platform is treating starter reference data like complete reference authority.

The fix must not be a tactical DB insert or one-off seed edit. The platform needs a reusable location-resolution capability that lets users select, add, validate, and steward localities through a governed product flow.

---

## Goals

1. Replace global city-list browsing with a progressive Country -> Region -> Locality -> Address flow.
2. Treat towns, villages, municipalities, suburbs, postal cities, and similar place concepts as first-class localities rather than forcing everything into "City".
3. Reuse one location picker/resolver across HQ/work locations, employee addresses, customer sites, business setup, and future customer/supplier address flows.
4. Allow missing localities to be added through governed UI with duplicate prevention, provenance, status, and optional validation.
5. Keep the platform usable without a paid geocoder while supporting provider-assisted enrichment when configured.
6. Encode a Build Studio guardrail so generated work prefers durable reference-data stewardship over tactical row patches.
7. Maintain theme-aware, accessible UI using platform CSS variables and the standards in `docs/platform-usability-standards.md`.

## Non-Goals

- Adding a single missing town directly to the live database.
- Claiming the seed dataset is exhaustive.
- Mandating a single geocoding vendor.
- Building a full global gazetteer import in the first implementation slice.
- Replacing postal address validation with a strict blocker. Validation is advisory unless a later compliance feature makes it mandatory for a specific workflow.

---

## Current System Evidence

### Existing Strengths

- `Country`, `Region`, `City`, and `Address` already form a strict hierarchy in `packages/db/prisma/schema.prisma`.
- `Address` already stores validation metadata: latitude, longitude, `validatedAt`, and `validationSource`.
- Employee address entry already supports scoped typeaheads and inline `createRegion` / `createCity` flows with duplicate suggestions.
- Work-location entry already scopes regions by selected country and cities by selected region.

### Existing Gaps

- `apps/web/app/(shell)/admin/reference-data/page.tsx` loads every city through `prisma.city.findMany()` before rendering.
- `apps/web/components/admin/CityPanel.tsx` filters a fully loaded city array in the browser, so users still encounter a giant city/town list.
- `apps/web/components/admin/WorkLocationPanel.tsx` searches scoped cities but does not expose an `onAddNew` path when the locality is absent.
- The March reference-data design called for organic growth, but the admin and work-location surfaces do not present that as a coherent product workflow.
- The March open-source readiness design intentionally describes the city seed as pre-filtered to major cities, so missing smaller towns are expected with the current data source.

---

## Research & Benchmarking

### Google Places Autocomplete

Google Places Autocomplete returns address components such as `country`, `administrative_area_level_1`, and `locality`, then fills form fields from the selected place. The lesson is that the UI should prefer address/place resolution and component extraction over forcing the user to browse a global place list.

Reference: [Google Places Autocomplete](https://developers.google.com/maps/documentation/javascript/place-autocomplete)

### OpenStreetMap / Nominatim

OpenStreetMap address tagging supports different locality-like concepts by country, including town, village, suburb, city, district, and county. Nominatim's country-specific formatting also demonstrates that address hierarchy varies by jurisdiction. The platform should not assume "city" is the universal lowest administrative level.

References:

- [OpenStreetMap Addresses](https://wiki.openstreetmap.org/wiki/Addresses)
- [Nominatim Country Address Format](https://wiki.openstreetmap.org/wiki/Nominatim/Country_Address_Format)

### OpenCage Geocoder

OpenCage exposes many address components, including city, town, township, village, municipality, suburb, county, state, country, and postal city. It also derives a normalized city value from multiple possible component fields. The platform should store a canonical locality record plus provenance rather than only the label returned by one provider.

Reference: [OpenCage Geocoding API](https://opencagedata.com/api)

### US Census Geocoder and TIGER

The US Census Geocoder uses MAF/TIGER data for address lookup and supports single-address and batch geocoding. PostGIS TIGER Geocoder exposes normalized address output and city/state/ZIP matching. For US addresses, this shows a credible path to public-source validation without requiring commercial vendor lock-in.

References:

- [US Census Geocoder technical documentation](https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html)
- [PostGIS TIGER Geocoder cheatsheet](https://postgis.net/docs/manual-3.7/tiger_geocoder_cheatsheet-en.html)

### Patterns Adopted

- Progressive component reveal rather than global lists.
- Locality as a broader product concept than city.
- Provider-assisted resolution that extracts normalized address components.
- Provenance and confidence stored with user-added or provider-added localities.
- Advisory validation in the first slice, with room for stricter workflow-specific rules later.

### Patterns Rejected

- Importing a bigger city seed as the primary fix. Larger static data can help, but it will still age and still miss valid localities.
- Vendor-only autocomplete. It improves UX, but it makes platform address entry dependent on an external service and hides stewardship decisions.
- Freeform city text. It solves entry speed at the cost of reporting, deduplication, compliance, and operational routing.

---

## Proposed Architecture

### Conceptual Model

The platform should treat geographic data as two related capabilities:

1. **Reference hierarchy:** canonical internal records for Country, Region, and Locality.
2. **Address resolution:** a user flow and service layer that searches, creates, validates, and enriches those records.

`City` remains as the existing physical table in the first migration-friendly slice, but the product layer should introduce the term `Locality`. A later schema migration can rename or expand the table when the implementation plan is ready.

### Shared Components

Create a reusable address/location composition instead of repeating address logic per surface:

- `LocationCascadePicker`
  - Selects country, region, and locality.
  - Scopes each search to its parent.
  - Shows empty states and add actions.
  - Supports keyboard navigation and accessible labels.

- `AddressResolverPanel`
  - Wraps `LocationCascadePicker`.
  - Captures address lines and postal code.
  - Optionally calls provider-assisted validation.
  - Displays normalized suggestions and confidence without blocking save by default.

- `ReferenceDataStewardshipPanel`
  - Replaces the giant city list in Admin Reference Data.
  - Allows scoped browse/search by country and region.
  - Shows missing/add flows, duplicate candidates, inactive records, provenance, and validation status.

### Service Layer

Create `apps/web/lib/location-resolution/` to centralize behavior:

- `searchCountries(query)`
- `searchRegions(countryId, query)`
- `searchLocalities(regionId, query)`
- `createLocality(input)`
- `suggestDuplicateLocalities(regionId, name)` — normalizes both sides via NFC + lowercase + diacritics-strip + whitespace-collapse, then ranks by trigram similarity within the parent region. Returns matches above a configurable threshold (default 0.6) plus any exact-normalized hit. Performance target: under 50ms p95 on a region with 10k localities (covered by `@@index([regionId, name])` plus the `pg_trgm` extension if available; fall back to `LIKE` against `nameNormalized` when not).
- `resolveAddress(input, options)`
- `validateAddress(addressId, options)`

Existing server actions can delegate into this service. UI surfaces should not hand-roll their own duplicate checks or provider parsing.

### Authorization & Audit

The inline add-locality flow on customer-facing surfaces (work-location, employee address, customer-site) must be gated by a single capability — `reference.locality.create` — that maps to the existing role/grant system. The default policy:

- Admin and reference-data steward roles: full add/edit/inactivate.
- Standard authenticated users: may create localities only when blocked from completing a primary task (HQ address, employee address, site address). Created records are written with `source = 'user'`, `status = 'needs-review'`, and `addedByUserId` set.
- Anonymous/storefront-only sessions: no locality creation; cascade picker is select-only.

Every locality write writes a `ComplianceAuditLog` row (model defined in `packages/db/prisma/schema.prisma`) with `entityType = 'Locality'`, `entityId` set to the new/affected `City.id`, `action ∈ {'create','update','inactivate','merge'}`, `performedByEmployeeId` or `agentId` populated, and `newValue` carrying a JSON blob of `{ regionId, name, source, sourceProvider?, sourceRef?, confidence? }`. `ComplianceAuditLog` is already entity-diff oriented, so no new audit model is needed; the locality use case is just another `entityType`. Stewardship-queue rows in Admin Reference Data surface the `needs-review` set to admins and let them confirm, merge into a duplicate, or reject — each of those actions writes its own audit row.

### Provider Result Caching

Provider lookups have non-trivial cost (per-request fees, rate limits). The resolver layer must cache provider responses keyed by normalized query plus parent scope, with a configurable TTL (default 24h) and an admin-visible cache-bust action. Provider results are evidence, not canonical reference data, so the cache lives outside `City` rows.

There is no shared `apps/web/lib/cache/` module today (verified 2026-04-25). The implementation introduces a single accessor `getCachedProviderResult(providerId, normalizedQuery, parentScopeId)` in `apps/web/lib/location-resolution/cache.ts` backed by Next.js `unstable_cache` with revalidation tags `location-resolution:<providerId>` and `location-resolution:scope:<parentScopeId>`. A later swap to Redis or another shared cache only changes that one file. Tag-based invalidation is what powers the admin "Refresh provider cache" action.

### Data Flow

1. User searches/selects a country.
2. Region field unlocks and searches only that country.
3. Locality field unlocks and searches only that region.
4. If the locality is absent, the UI offers "Add locality to [Region]".
5. The add flow captures:
   - name
   - locality type
   - source: `user`
   - optional external source/provenance if selected from provider suggestion
6. The service runs duplicate detection.
7. User either selects a suggestion or confirms creation.
8. Address fields are saved against the canonical locality.
9. If validation is configured, normalized output updates address metadata and may enrich locality provenance.

---

## Data Model Direction

### Phase 1: Use Current Tables With Locality Semantics

Keep the physical `City` table, but update service/API/UI language to `Locality` where user-facing. The migration adds three coordinated changes — `City` metadata fields, `Country.usesPostalCode`, and `Address.postalCode` nullability — and lands as one slice so the conditional postal-code rule has its source-of-truth flag from day one.

```prisma
model City {
  id              String    @id @default(cuid())
  name            String
  nameNormalized  String    // NFC + lowercased + diacritics stripped, used for dedupe
  regionId        String
  localityType    String    @default("city")
  source          String    @default("seed")
  sourceProvider  String?
  sourceRef       String?
  confidence      Decimal?  @db.Decimal(5, 4) // 0.0000-1.0000 inclusive; (5,4) chosen so 1.0000 is representable
  status          String    @default("active")
  disambiguator   String?   // populated by stewards when two same-name localities legitimately share a region (e.g., "Springfield" by county). Participates in the unique key so legitimate collisions are allowed; the common case leaves it NULL.
  addedByUserId   String?
  addedByUser     User?     @relation(fields: [addedByUserId], references: [id])
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  addresses       Address[]
  region          Region    @relation(fields: [regionId], references: [id])

  @@unique([regionId, nameNormalized, disambiguator])
  @@index([regionId, name])
  @@index([regionId])
  @@index([status])
  @@index([source])
}

model Country {
  // existing fields ...
  usesPostalCode  Boolean  @default(true) // drives the conditional postal-code requirement; backfilled from CLDR. See Default Decision 6.
}

model Address {
  // existing fields ...
  postalCode      String?  // was non-nullable; migration converts empty strings to NULL and relaxes the constraint. Consumers must tolerate null — see Risks.
}
```

The migration must backfill existing rows:

- `City.localityType = 'city'`
- `City.source = 'seed'`
- `City.confidence = NULL`
- `City.disambiguator = NULL`
- `City.nameNormalized` computed from `name` via the same normalizer used at write time (lowercased NFC, diacritics stripped, internal whitespace collapsed)
- `City.addedByUserId = NULL`
- `Country.usesPostalCode` populated from a CLDR-derived seed list; countries not in the list default to `true` and are flagged in the stewardship queue for steward review (logged but not blocking)
- `Address.postalCode` empty strings (`''`) rewritten to `NULL` before relaxing the column constraint

The `@@unique([regionId, nameNormalized, disambiguator])` constraint is the database-level guard against the duplicate-locality bug. NULL semantics in Postgres treat NULL as distinct, which is the wanted behavior here — two rows with `disambiguator = NULL` and the same `(regionId, nameNormalized)` will collide (the common case), while a steward-confirmed legitimate collision is unblocked by setting distinct disambiguators on each row. The constraint must be added in the same migration; relying solely on application-layer suggestions is what the existing system already does.

### Canonical Enum Values — CLAUDE.md MANDATORY COMPLIANCE

The new `String` fields below carry fixed value sets and are governed by the project's "Strongly-Typed String Enums" rule. The same commit that introduces them must:

1. Add `as const` arrays + TypeScript union types in `apps/web/lib/location-resolution/locality-enums.ts`. The Phase 8 backlog refactor moved canonical exports to `apps/web/lib/explore/backlog.ts` (with `apps/web/lib/backlog.ts` left as a re-export shim); if any locality enum is reused there, add it to the canonical file, not the shim.
2. Add the `enum:` arrays to the relevant MCP tool definitions in `apps/web/lib/mcp-tools.ts`.
3. Use the literal canonical values (copy-pasted, never paraphrased) in seed scripts, migrations, and backfill SQL.

| Model | Field | Canonical values | Default |
| ----- | ----- | ---------------- | ------- |
| `City` | `status` | `"active"` `"inactive"` `"needs-review"` | `"active"` |
| `City` | `source` | `"seed"` `"user"` `"provider"` `"import"` | `"seed"` |
| `City` | `localityType` | `"city"` `"town"` `"village"` `"municipality"` `"suburb"` `"district"` `"hamlet"` `"postal-city"` `"unknown"` | `"city"` |

Hyphens, not underscores. Multi-word values use hyphens (`"needs-review"`, `"postal-city"`).

`Address.validationSource` (already `String?` in the current schema) is distinct from `City.sourceProvider`: the former records who validated a specific street address; the latter records who supplied the canonical locality record. Both should reuse the provider-id format defined in the Provider Strategy section.

### Phase 2: Rename City to Locality

After the service and UI have moved to locality language, create a schema migration that renames the table/model to `Locality` and updates `Address.cityId` to `localityId`. This should be a deliberate expand/contract plan so existing deployments can migrate without data loss.

### Why Not Rename First

Renaming first creates broad churn before the user-facing behavior is improved. The long-term design is locality-based, but implementation should first centralize behavior behind a service boundary so the eventual table rename is mostly mechanical.

---

## UX Design

### HQ / Work Location Address

The HQ work-location form should become a compact address resolver:

- Label
- Country
- Region
- Locality
- Address line 1
- Address line 2
- Postal code (conditional — required only when `Country.usesPostalCode` is true on the selected country; rendered as optional otherwise. The non-nullable-to-nullable migration on `Address.postalCode` and the `Country.usesPostalCode` flag both ship in Slice 2; see Data Model Direction.)
- Validation status

The locality field empty state should be explicit:

> No locality found in Texas for "Thorndale". Add Thorndale to Texas?

Choosing add opens an inline confirmation row, not a modal:

- Name: Thorndale
- Type: Town
- Parent: Texas, United States
- Source: Added by user
- Button: Add locality

If near matches exist, show them first and require the user to either select one or confirm that this is distinct.

### Admin Reference Data

The admin page should not render every city/locality row by default. Replace it with:

- Countries panel: searchable list and active/inactive status.
- Regions panel: disabled until a country is selected, then scoped.
- Localities panel: disabled until a region is selected, then scoped.
- Stewardship queue: recently added localities, low-confidence provider matches, duplicates needing review.

Counts remain useful, but they should summarize scope:

- Countries: 250 active
- Regions in United States: 57 active
- Localities in Texas: 3 active, 1 user-added, 0 needs review

### Customer Sites and Employee Addresses

Employee addresses already contain the best current pattern. Refactor that behavior into the shared component and consume it from both employee and work-location surfaces. Customer-site create/edit should use the same resolver when implementing `BI-SITE-3D8B44` and `BI-SITE-4F2C93`.

### Accessibility and Theme

- Use `role="combobox"` and listbox keyboard behavior already present in `ReferenceTypeahead`.
- Add helper text for locked fields, for example "Select a country first."
- Keep all colors on `--dpf-*` CSS variables.
- Do not use global scroll-heavy lists for fixed-format selection.
- Ensure all `option` elements use explicit `bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]`.

---

## Provider Strategy

The platform should support provider-assisted resolution through configuration, not hardcoded dependency.

### Provider Interface

```ts
type AddressResolutionProvider = {
  providerId: ProviderId;
  searchPlaces(input: PlaceSearchInput): Promise<PlaceCandidate[]>;
  validateAddress(input: AddressValidationInput): Promise<AddressValidationResult>;
};
```

**Provider id format.** `ProviderId` is a kebab-case slug, lowercase, ASCII-only, exported as an `as const` array from `apps/web/lib/location-resolution/locality-enums.ts` and added to the relevant MCP tool `enum:` arrays per the canonical-enum rule. Initial values: `"none"` (no-provider default), `"nominatim"`, `"google-places"`, `"opencage"`, `"census-tiger"`. The same slug appears in `City.sourceProvider`, `Address.validationSource`, the cache key, and the audit log, so it must be the only spelling used anywhere in the system. Adding a new provider follows the same two-file rule as any other canonical enum.

### Candidate Shape

```ts
type PlaceCandidate = {
  displayName: string;
  countryCode: string;
  regionName?: string;
  regionCode?: string;
  localityName?: string;
  localityType?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  sourceRef?: string;
  confidence?: number;
};
```

### Provider Priority

1. Internal canonical reference data.
2. Configured provider suggestions.
3. User-added locality with duplicate/provenance checks.

The UI should never hide internal data behind a provider. Provider output helps normalize and validate; it does not replace platform stewardship.

---

## Build Studio Guardrail

Build Studio must not treat missing reference data as an invitation for a one-off patch. Add this rule to the platform's build guidance and coworker review checklist. Concrete artifacts to update in the same slice:

- New skill: `skills/reference-data/reference-data-stewardship.skill.md` — assigned to design and review coworkers (`assignTo: ["coworker-design", "coworker-review", "coworker-architect"]`), `riskBand: "medium"`, `userInvocable: false`, `agentInvocable: true`. Body carries the rule and the anti-pattern list below.
- Updated reviewer prompt: `prompts/reviewer/design-review.prompt.md` — add a numbered check that fails the review when a missing-reference-data fix is proposed without a stewardship-flow alternative.
- Build phase prompt: `prompts/build-phase/design.prompt.md` — `{{include:reviewer/reference-data-stewardship-check}}` so the rule is loaded in design as well as review.

The rule itself:

> When a user is blocked by missing reference data, prefer a durable reference-data stewardship flow over direct row insertion, seed-only edits, or surface-specific exceptions. The proposed work must identify the canonical model, reusable UI/API boundary, provenance, duplicate handling, and verification path.

Build Studio should flag these anti-patterns during design/review:

- "Just insert the row" as the primary fix.
- Editing `seed.ts` or bootstrap JSON to represent one tenant's runtime need.
- Adding a surface-specific freeform location field.
- Duplicating address cascade logic in a new component without extracting a shared resolver.
- Treating provider autocomplete as authoritative without storing internal canonical records.

Generated implementation plans should include:

- shared service/component extraction,
- migration/backfill details when schema changes,
- affected-surface verification,
- and admin stewardship UX.

---

## Implementation Slices

Each slice ships independently and is independently revertible. "Done when" is the explicit acceptance gate the implementer must satisfy before moving on.

### Slice 1: Shared Resolver Boundary

- Extract employee address cascade behavior into `LocationCascadePicker`.
- Add service functions behind existing reference-data server actions.
- Update work-location form to consume the shared picker.
- Preserve existing database tables.

**Done when:** work-location and employee-address surfaces both render through `LocationCascadePicker`; existing tests pass; no schema changes; the cascade picker has component tests covering the keyboard/locked-field behaviors listed in Testing.

### Slice 2: Locality Metadata + Conditional Postal Code (schema migration)

- Add metadata fields to `City` (`nameNormalized`, `localityType`, `source`, `sourceProvider`, `sourceRef`, `confidence`, `status`, `disambiguator`, `addedByUserId`, `createdAt`, `updatedAt`).
- Add `Country.usesPostalCode` and backfill from CLDR.
- Migrate `Address.postalCode` to nullable with empty-string-to-NULL backfill.
- Add `@@unique([regionId, nameNormalized, disambiguator])` and supporting indexes.
- Wire the `unstable_cache` accessor stub for provider results (no provider yet).
- Add the canonical-enum `as const` arrays + types per the Canonical Enum Values section.

**Done when:** migration applies cleanly on a fresh install and on a snapshot of staging data; backfill verified by sampling 20 rows per country in seed data; CI typecheck passes with the new union types; `pnpm --filter web typecheck` and `cd apps/web && npx next build` both pass; per-tenant address render verified across employee, work-location, and customer-site surfaces (no broken postal-code field).

### Slice 3: Admin Reference Data Refactor

- Stop loading all cities in `admin/reference-data/page.tsx`.
- Add scoped server actions for paged locality browsing.
- Replace `CityPanel` with a scoped locality management panel.
- Add empty states, add-locality flow, and the stewardship queue (driven by `status = 'needs-review'`, `source = 'user'`, and low-confidence provider matches once Slice 4 lands).
- Implement merge / inactivate / reject actions, each writing a `ComplianceAuditLog` row per the Authorization & Audit section.

**Done when:** admin reference-data page no longer issues an unscoped `prisma.city.findMany()`; locality panel is disabled until a region is selected; add-locality flow is reachable from the empty state; an admin can confirm, merge, or reject a `needs-review` row and see the audit row; lighthouse/axe checks pass for the new panels; UX verification steps 1–5 in Testing pass.

### Slice 4: Provider-Assisted Resolution

- Add `AddressResolutionProvider` interface and a no-provider implementation.
- Add at least one concrete adapter (default candidate: `nominatim` — public, no key required — see Provider Strategy).
- Wire configured provider suggestions into the resolver and stewardship queue.
- Persist validation output to `Address` (`latitude`, `longitude`, `validatedAt`, `validationSource`).

**Done when:** with a provider configured, searching a missing locality surfaces provider candidates with correct component extraction; cache hits do not re-call the provider within TTL; admin "Refresh provider cache" busts the relevant tag; with no provider configured, behavior is identical to Slice 3.

### Slice 5: Customer Site Adoption

- Use the resolver in customer-site create/edit flows.
- Align with `BI-SITE-3D8B44` and `BI-SITE-4F2C93`.
- Add duplicate-site prevention hooks using normalized locality/address data.

**Done when:** customer-site create/edit consumes `AddressResolverPanel`; a duplicate-site attempt at the same `(regionId, nameNormalized, postalCode, addressLine1Normalized)` triggers a confirmation flow; both BI items can be moved to `done` per their own acceptance criteria.

### Slice 6: Build Studio Guidance

- Ship `skills/reference-data/reference-data-stewardship.skill.md` per Build Studio Guardrail.
- Update `prompts/reviewer/design-review.prompt.md` and `prompts/build-phase/design.prompt.md`.
- Re-run seed so `PromptTemplate` and `SkillDefinition` rows are present.

**Done when:** an intentionally bad design proposal ("just insert the row") fails design review locally; the new skill appears in the agent's loaded skill set; the seed delta is captured in `packages/db/src/seed.ts` (or `seed-skills.ts`) so a fresh install picks it up.

---

## Migration and Data Stewardship

Every migration that changes existing rows must include backfill SQL inline with the migration. Existing migration files must not be edited.

The first schema migration should be additive:

- add nullable/default metadata fields to `City`,
- backfill existing data,
- add indexes,
- keep all existing FKs intact.

The later rename to `Locality` should use expand/contract:

1. Add new `Locality` table or rename with compatibility views/actions if safe.
2. Backfill from `City`.
3. Add `Address.localityId`.
4. Backfill from `Address.cityId`.
5. Update consumers.
6. Drop old columns only after the application no longer reads them.

Runtime additions should go through app actions/services, not seed files.

### Rollback

Each slice must be independently reversible:

- **Slice 1 (shared resolver UI):** revert the PR. Existing employee/work-location forms continue to work; no schema state to unwind.
- **Slice 2 (schema migration: metadata + `usesPostalCode` + nullable postal code):** ship a paired down-migration that drops the new `City` columns + unique constraint, drops `Country.usesPostalCode`, and re-tightens `Address.postalCode` (after backfilling NULLs to `''`). The slice is additive with defaults, so rollback does not lose `Country`/`Region`/`City` rows; it only loses provenance metadata captured in the rollback window. The recovery path for that data is the `ComplianceAuditLog` audit rows. Re-tightening `postalCode` only succeeds if no production address has been saved with NULL — guard the down-migration with that check.
- **Slice 3 (admin reference-data refactor):** revert the PR. The metadata schema from Slice 2 stays in place; the old `CityPanel` returns and silently ignores the new columns.
- **Slice 4 (provider adapter):** unset the provider config; resolver falls back to no-provider behavior. No schema rollback needed because provider data is cached, not persisted to `City`.
- **Slice 5 (customer-site adoption):** revert the PR; customer-site flows fall back to whatever picker they used before. The shared resolver remains in place for HQ and employee paths.
- **Slice 6 (Build Studio guidance):** revert the prompt/skill files and re-seed. The runtime falls back to the prior reviewer/design prompts; existing in-flight builds are not affected because prompts are loaded with a 60s cache.

If the eventual Phase 2 rename to `Locality` ships, rollback requires the contract step (drop new columns) before the expand step (drop `Locality` table) — the standard expand/contract reverse order.

---

## Testing and Verification

### Unit Tests

- `searchLocalities` scopes by region.
- Missing locality creates a canonical record with source metadata.
- Duplicate detection catches case-insensitive near matches.
- Provider candidate parsing maps city/town/village/municipality/postal-city components into locality.
- Work-location address save rejects missing locality and address line.

### Component Tests

- `LocationCascadePicker` keeps region disabled until country is selected.
- It clears region/locality when parent selection changes.
- It shows "add locality" when no exact match exists.
- It displays duplicate suggestions before forced creation.
- It uses theme variables and no hardcoded text/background/border colors.

### UX Verification

Run browser QA against the Docker-served app at `http://localhost:3000`:

1. Log in as `admin@dpf.local` using `ADMIN_PASSWORD` from root `.env`.
2. Open Admin -> Configuration -> Reference Data.
3. Verify cities/localities do not render as one global list.
4. Select United States, then Texas, search Thorndale, and verify the add-locality flow appears.
5. Add/select the locality through the governed UI.
6. Open Work Locations, link HQ address, and verify the same resolver behavior.
7. Verify legacy/current affected routes still render without stale admin navigation regressions.

### Build Verification

For implementation work:

- Run affected unit/component tests.
- Run `pnpm --filter web typecheck`.
- Run `cd apps/web && npx next build`.
- Run affected platform QA cases or add new cases if no suitable coverage exists.

---

## Backlog Recommendation

Use the existing open epic `EP-SITE-7C4D2B` (`status: "open"`) instead of creating a separate overlapping epic. Add one `BacklogItem` per implementation slice so each can be tracked, reviewed, and merged independently. All items below are `type: "product"` with `status: "open"` (canonical values per CLAUDE.md "Strongly-Typed String Enums" — copy-pasted, not paraphrased).

| # | Title | Depends on | Notes |
| - | ----- | ---------- | ----- |
| 1 | Extract shared `LocationCascadePicker` from employee address | — | Slice 1; UI-only, no schema. |
| 2 | Locality metadata migration + conditional postal code | #1 | Slice 2; ships `City` metadata fields, `Country.usesPostalCode`, `Address.postalCode` nullable, `pg_trgm` extension. The schema change every later slice depends on. |
| 3 | Admin reference-data refactor with stewardship queue | #2 | Slice 3; replaces unscoped `prisma.city.findMany()`, adds add-locality flow, merge/inactivate/reject actions with `ComplianceAuditLog` entries. |
| 4 | Provider-assisted address resolution (Nominatim default) | #2 | Slice 4; provider interface + at least one no-key adapter. Independent of #3 but most useful with stewardship UI in place. |
| 5 | Customer-site address adoption (`BI-SITE-3D8B44`, `BI-SITE-4F2C93`) | #1, #2 | Slice 5; the existing customer-site backlog items consume the shared resolver. Mark them `done` only when the resolver is in use, not on the basis of bespoke pickers. |
| 6 | Build Studio reference-data stewardship guidance | — | Slice 6; prompt/skill changes only. Can ship in parallel with any of #1–#5. |

This item set should be completed before `BI-SITE-3D8B44` and `BI-SITE-4F2C93` are marked `done`, because those flows should consume the shared resolver rather than building another address picker.

---

## Open Questions

1. **Locality near-match threshold.** Trigram threshold of 0.6 is a starting point; we need a small validation set (50 known-duplicate pairs sampled from current `City` rows) to tune before shipping Slice 3. Owner: reference-data steward role during Slice 3 review.
2. **`pg_trgm` availability.** The dedupe ranking assumes the extension is enabled. Confirm it is on in the Compose Postgres image; if not, the Slice 2 migration must `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and the fallback path (LIKE against `nameNormalized`) must be benchmarked.
3. **Provider selection per tenant.** Provider config is per-install today. Decide whether per-storefront override is needed before Slice 4 — the existing portal-archetype precedent suggests no, but confirm with the multi-storefront roadmap.
4. **Phase 2 rename timing.** The expand/contract rename to `Locality` is queued, but the trigger should be a measured one (e.g., once Slice 5 ships and customer-site adoption is non-trivial). It should not be calendar-driven.
5. **Reference-data steward role definition.** The Authorization & Audit section assumes a `reference-data steward` role distinct from `admin`. Confirm whether this is a new role on the existing role/grant system or an existing role being repurposed; resolve before Slice 3 ships its UI gating.

## Risks

- **Existing `Address.postalCode` is `String` non-nullable.** Migrating to nullable touches every consumer (employee, customer-site, work-location, finance, compliance reporting). Audit consumers and test the empty-postal-code render in each surface before merging the migration.
- **Duplicate detection false positives merge distinct localities.** Two real towns can have identical normalized names within a region (e.g., "Springfield" exists multiple times in some regions even after normalization). The `@@unique([regionId, nameNormalized])` constraint is too strict in those cases. Mitigation: include an optional `disambiguator` column populated when a steward confirms two same-name localities are distinct (e.g., by county or postal anchor); leave nullable for the common case.
- **`addedByUserId` on shared reference data leaks identity.** A user-added locality is visible org-wide. Mitigation: surface only `source = 'user'` plus a `needs-review` badge to non-stewards; the `addedByUserId` is only readable by admin/steward roles.
- **Provider quota exhaustion during a bulk import.** A provider-assisted import could exhaust paid quota silently. Mitigation: provider adapter must expose `remainingQuota` after each call; resolver throttles and surfaces a stewardship-queue alert when below a configurable floor.
- **Hive contribution silent-failure pattern.** Per `project_hive_contribution_gaps`: if `createLocality` is exposed via MCP and a downstream coworker invokes it without grants, the call may return `success: false` silently. The MCP tool definition must follow the post-2026-04-19 invariant (return structured `{ ok: false, reason }` and surface to the agent transcript); covered by Slice 1 unit tests.

## Default Decisions

1. The first implementation should ship no-provider plus manual stewardship. A provider adapter can follow once the shared resolver contract is stable.
2. Low-confidence user-added localities should start as visibility-only review items. Blocking approval can be added later for regulated workflows if evidence shows it is needed.
3. The eventual address-level model name should be `Locality`. Reserve `Place` for broader operational concepts such as facilities, campuses, rooms, or service areas.
4. Duplicate detection ships with the `(regionId, nameNormalized, disambiguator)` unique constraint; the application layer never silently coerces a near-match into an existing row. `disambiguator` is NULL in the common case, distinct only when a steward confirms two same-name localities are legitimately separate.
5. `addedByUserId` is captured for audit but is not displayed to non-steward users; the user-facing provenance label is the `source` field plus, for `source = 'provider'`, the provider id.
6. **`Country.usesPostalCode` source of truth.** Extend the `Country` model with a boolean, backfilled from CLDR at migration time. Considered alternatives (a code-side allowlist, runtime lookup of an external service) were rejected because the flag is read on every address render — a column with a stable backfill is faster, cacheable with the country row, and steward-overridable through the existing reference-data UI.
