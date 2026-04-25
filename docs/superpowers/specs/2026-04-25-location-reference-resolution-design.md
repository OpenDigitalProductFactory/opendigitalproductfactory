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

Reference: https://developers.google.com/maps/documentation/javascript/place-autocomplete

### OpenStreetMap / Nominatim

OpenStreetMap address tagging supports different locality-like concepts by country, including town, village, suburb, city, district, and county. Nominatim's country-specific formatting also demonstrates that address hierarchy varies by jurisdiction. The platform should not assume "city" is the universal lowest administrative level.

References:

- https://wiki.openstreetmap.org/wiki/Addresses
- https://wiki.openstreetmap.org/wiki/Nominatim/Country_Address_Format

### OpenCage Geocoder

OpenCage exposes many address components, including city, town, township, village, municipality, suburb, county, state, country, and postal city. It also derives a normalized city value from multiple possible component fields. The platform should store a canonical locality record plus provenance rather than only the label returned by one provider.

Reference: https://opencagedata.com/api

### US Census Geocoder and TIGER

The US Census Geocoder uses MAF/TIGER data for address lookup and supports single-address and batch geocoding. PostGIS TIGER Geocoder exposes normalized address output and city/state/ZIP matching. For US addresses, this shows a credible path to public-source validation without requiring commercial vendor lock-in.

References:

- https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html
- https://postgis.net/docs/manual-3.7/tiger_geocoder_cheatsheet-en.html

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
- `suggestDuplicateLocalities(regionId, name)`
- `resolveAddress(input, options)`
- `validateAddress(addressId, options)`

Existing server actions can delegate into this service. UI surfaces should not hand-roll their own duplicate checks or provider parsing.

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

Keep the physical `City` table, but update service/API/UI language to `Locality` where user-facing. Add fields to `City` in a new migration:

```prisma
model City {
  id              String    @id @default(cuid())
  name            String
  regionId        String
  localityType    String    @default("city")
  source          String    @default("seed")
  sourceProvider  String?
  sourceRef       String?
  confidence      Decimal?  @db.Decimal(5, 4)
  status          String    @default("active")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  addresses       Address[]
  region          Region    @relation(fields: [regionId], references: [id])

  @@index([regionId, name])
  @@index([regionId])
  @@index([status])
  @@index([source])
}
```

The migration must backfill existing rows:

- `localityType = 'city'`
- `source = 'seed'`
- `confidence = NULL`

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
- Postal code
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
  providerId: string;
  searchPlaces(input: PlaceSearchInput): Promise<PlaceCandidate[]>;
  validateAddress(input: AddressValidationInput): Promise<AddressValidationResult>;
};
```

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

Build Studio must not treat missing reference data as an invitation for a one-off patch. Add this rule to the platform's build guidance and coworker review checklist:

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

### Slice 1: Shared Resolver Boundary

- Extract employee address cascade behavior into `LocationCascadePicker`.
- Add service functions behind existing reference-data server actions.
- Update work-location form to consume the shared picker.
- Preserve existing database tables.

### Slice 2: Admin Reference Data Refactor

- Stop loading all cities in `admin/reference-data/page.tsx`.
- Add scoped server actions for paged locality browsing.
- Replace `CityPanel` with a scoped locality management panel.
- Add empty states and add-locality flow.

### Slice 3: Locality Metadata

- Add metadata fields to `City`.
- Backfill existing rows as `source = 'seed'`.
- Capture `localityType`, source, provider, source ref, and confidence for new localities.

### Slice 4: Provider-Assisted Resolution

- Add provider interface and a no-provider implementation.
- Wire configured provider suggestions into the resolver.
- Persist validation output to `Address`.

### Slice 5: Customer Site Adoption

- Use the resolver in customer-site create/edit flows.
- Align with `BI-SITE-3D8B44` and `BI-SITE-4F2C93`.
- Add duplicate-site prevention hooks using normalized locality/address data.

### Slice 6: Build Studio Guidance

- Add the reference-data stewardship rule to relevant Build Studio prompts/guidance.
- Add a review check that rejects tactical missing-reference-data patches unless the user explicitly requested a one-off data repair.

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

Use the existing open epic `EP-SITE-7C4D2B` instead of creating a separate overlapping epic. Add one implementation item:

**Title:** Build reusable locality resolver for HQ, employee, and customer-site addresses

**Description:** Replace city-centric address entry with a shared Country -> Region -> Locality resolver, scoped admin reference-data management, governed missing-locality creation, provenance metadata, and provider-assisted validation hooks. The work must avoid one-off runtime data patches and should update Build Studio guidance so generated fixes follow the same long-term stewardship rule.

This item should be completed before the customer-site address validation items are marked done, because those flows should consume the shared resolver rather than building another address picker.

---

## Default Decisions

1. The first implementation should ship no-provider plus manual stewardship. A provider adapter can follow once the shared resolver contract is stable.
2. Low-confidence user-added localities should start as visibility-only review items. Blocking approval can be added later for regulated workflows if evidence shows it is needed.
3. The eventual address-level model name should be `Locality`. Reserve `Place` for broader operational concepts such as facilities, campuses, rooms, or service areas.
