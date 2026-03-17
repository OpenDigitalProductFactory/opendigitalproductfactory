# EP-REF-001: Reference Data & UX Polish

**Status:** Draft
**Date:** 2026-03-17
**Epic:** Reference Data & UX Polish
**Scope:** Geographic hierarchy, shared address model, typeahead entry, MCP-based validation, phone fields, date picker component

---

## Problem Statement

The platform serves employees, customers, and suppliers globally. Location data is critical for HR records, operational correspondence, compliance tagging, and regional reporting. Currently:

- **WorkLocation** stores only a name, type (office/remote/hybrid/customer_site), and timezone — no physical address, no geographic hierarchy
- **EmployeeProfile** has no address or phone fields
- No shared location reference data exists — when Customer and Supplier entities are built, they will face the same gap
- Date inputs across the platform use raw browser-native pickers with inconsistent UX

The historical pain point is freeform location entry leading to duplicate, inconsistent, and unusable data ("New York" vs "new york" vs "NYC"). This spec introduces controlled reference data with typeahead entry to eliminate that class of problem entirely.

## Goals

1. Geographic hierarchy (Country → Region → City) with ISO 3166-1 country seed
2. Shared, context-neutral Address table usable by any entity type
3. Typeahead-driven data entry — no freeform location text fields
4. Organic growth — regions and cities added incrementally as business needs grow
5. Optional MCP-surfaced geocoding validation (advisory, not blocking)
6. Phone number fields on EmployeeProfile
7. Shared DatePicker component replacing all raw date inputs

## Non-Goals

- Customer and Supplier entity models (future epics — this spec provides the address infrastructure they will consume)
- Mandatory address validation (the platform works fully without an external geocoding service)
- Postal code reference table (postal codes are street-level, stored on Address)
- Approval workflow for new regions/cities (first entrant is trusted; admin can deactivate bad entries via status field)
- Address deduplication/merge tooling (can be added later if data quality issues emerge)

---

## Design

### 1. Geographic Hierarchy Schema

Three reference tables forming a strict parent-child hierarchy. All follow the existing platform pattern: `id` as cuid primary key, `status` field for soft-delete, `createdAt`/`updatedAt` timestamps, explicit `onDelete` on all FKs, and `@@index` on all FK columns.

#### Country

Seeded from ISO 3166-1 on first migration (~250 rows). The `name` field stores the common short name ("United Kingdom"), not the formal ISO name ("United Kingdom of Great Britain and Northern Ireland"). Stable dataset, rarely changes.

```prisma
model Country {
  id          String   @id @default(cuid())
  name        String   // "United Kingdom" — common short name
  iso2        String   @unique // "GB"
  iso3        String   @unique // "GBR"
  numericCode String   // "826"
  phoneCode   String   // "+44" — note: some countries share codes (US/CA both +1)
  status      String   @default("active") // active | inactive
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  regions     Region[]

  @@index([status])
}
```

#### Region

States, provinces, counties. Starts empty, grows organically through address entry. Case-insensitive uniqueness enforced via a raw SQL functional index in the migration: `CREATE UNIQUE INDEX "Region_countryId_name_ci" ON "Region" (LOWER("name"), "countryId")` — the Prisma `@@unique` is kept as a fallback but the functional index is authoritative for duplicate prevention.

```prisma
model Region {
  id        String   @id @default(cuid())
  name      String   // "California"
  code      String?  // "CA" — ISO 3166-2 subdivision code where available
  countryId String
  country   Country  @relation(fields: [countryId], references: [id], onDelete: Restrict)
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  cities    City[]

  @@unique([countryId, name])
  @@index([countryId])
  @@index([status])
}
```

#### City

Grows organically. Scoped to a region to prevent ambiguity (Portland, OR vs Portland, ME). Same case-insensitive functional index pattern as Region: `CREATE UNIQUE INDEX "City_regionId_name_ci" ON "City" (LOWER("name"), "regionId")`.

```prisma
model City {
  id        String   @id @default(cuid())
  name      String   // "San Francisco"
  regionId  String
  region    Region   @relation(fields: [regionId], references: [id], onDelete: Restrict)
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  addresses Address[]

  @@unique([regionId, name])
  @@index([regionId])
  @@index([status])
}
```

### 2. Shared Address Model

Context-neutral — an address is just geographic data. Sensitivity is determined by the entity relationship, not the address itself.

The `label` field uses a controlled set of values: "home", "work", "billing", "shipping", "headquarters", "site". Stored as a required String (not an enum, consistent with platform pattern) — the UI presents these as a dropdown. Freeform entry is not offered; if a new label is needed it is added to the dropdown options in code, keeping the vocabulary controlled.

```prisma
model Address {
  id               String    @id @default(cuid())
  label            String    // "home" | "work" | "billing" | "shipping" | "headquarters" | "site"
  addressLine1     String
  addressLine2     String?
  cityId           String
  city             City      @relation(fields: [cityId], references: [id], onDelete: Restrict)
  postalCode       String    // String for alphanumeric codes: "SW1A 1AA", "H3Z 2Y7"
  latitude         Decimal?  @db.Decimal(10, 7) // Populated by external validation (~1cm precision)
  longitude        Decimal?  @db.Decimal(10, 7)
  validatedAt      DateTime? // Set when geocoding MCP service confirms address
  validationSource String?   // "google-places", "mapbox", etc.
  status           String    @default("active")
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  employeeAddresses EmployeeAddress[]
  workLocations     WorkLocation[]  // via new optional FK

  @@index([cityId])
  @@index([status])
}
```

### 3. Entity Join Tables

Join tables provide context, access scoping, and multi-address support per entity. An employee may have multiple addresses but only one per label (enforced at application layer — a unique constraint on `[employeeProfileId, label]` is not viable since label lives on Address, not the join).

```prisma
model EmployeeAddress {
  id                String          @id @default(cuid())
  employeeProfileId String
  employeeProfile   EmployeeProfile @relation(fields: [employeeProfileId], references: [id], onDelete: Cascade)
  addressId         String
  address           Address         @relation(fields: [addressId], references: [id], onDelete: Cascade)
  isPrimary         Boolean         @default(false)
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@unique([employeeProfileId, addressId])
  @@index([employeeProfileId])
  @@index([addressId])
}
```

Future join tables (`CustomerAddress`, `SupplierAddress`) follow the same pattern — added when those entities are built.

### 4. WorkLocation Bridge

The existing `WorkLocation` model gains an optional address link. This connects the logical work arrangement ("Remote — Pacific timezone") to a physical address ("123 Main St, San Francisco") when applicable.

```prisma
model WorkLocation {
  // ... existing fields (id, locationId, name, locationType, timezone, status) ...
  addressId String?
  address   Address? @relation(fields: [addressId], references: [id], onDelete: SetNull)

  @@index([addressId])
}
```

No existing data changes. Office-type locations can now optionally reference their physical address.

### 5. Phone Fields on EmployeeProfile

The existing `phoneNumber` field on EmployeeProfile is replaced by three purpose-specific fields. The migration renames `phoneNumber` → `phoneWork` (preserving existing data) and adds the two new fields.

```prisma
model EmployeeProfile {
  // ... existing fields ...
  phoneWork      String? // replaces existing phoneNumber — "+14155551234"
  phoneMobile    String?
  phoneEmergency String?
}
```

**Migration note:** `ALTER TABLE "EmployeeProfile" RENAME COLUMN "phoneNumber" TO "phoneWork"` preserves existing data. The `EmployeeFormPanel.tsx` and `workforce` server actions must be updated to use the new field names.

E.164 format chosen because:
- Internationally unambiguous
- Country `phoneCode` from the hierarchy helps UI formatting (display "+1 (415) 555-1234" while storing "+14155551234")
- Integrates with any telephony or notification system without parsing

### 6. Typeahead Data Entry UX

#### ReferenceTypeahead Component

A reusable component that provides controlled selection with organic growth:

- **Props:** query endpoint, parent filter (e.g., countryId for region typeahead), placeholder text
- **Behavior:** debounced search (300ms), case-insensitive, matches against name and code fields
- **"Add new" action:** appears as the last option when no exact match is found. Opens a minimal inline form (name + optional code) that creates the reference entry and selects it in one step.
- **Keyboard accessible:** arrow keys to navigate, enter to select, tab to move between fields

#### Address Entry Flow

Fields presented in dependency order — each selection scopes the next:

1. **Country** — typeahead against pre-seeded Country table (always populated)
2. **Region** — typeahead scoped to selected country. "Add new region" if not found.
3. **City** — typeahead scoped to selected region. "Add new city" if not found.
4. **Address Line 1** — freeform text
5. **Address Line 2** — freeform text (optional)
6. **Postal Code** — freeform text
7. **Label** — dropdown with common values ("home", "work", "billing", "shipping") plus freeform option

#### Duplicate Prevention

- Country: pre-seeded, unique on iso2/iso3 — no duplicates possible
- Region: case-insensitive unique index on `[countryId, LOWER(name)]` — database-level enforcement
- City: case-insensitive unique index on `[regionId, LOWER(name)]` — same pattern
- "Add new" flow: before creating, the server action queries existing entries with a case-insensitive prefix match (`WHERE LOWER(name) LIKE LOWER(input) || '%'`). If matches exist, they are shown as suggestions ("Did you mean San Francisco?"). The user can select an existing entry or confirm the new one. This is a UX guard, not a hard block — the database unique index is the ultimate enforcement.

### 7. MCP Validation Integration

External geocoding validation is advisory — it enhances data quality when available and degrades gracefully when not.

#### MCP Tool Contract

```
validate_address
  Input:  { addressLine1, addressLine2?, city, region, country, postalCode }
  Output: { valid: boolean, normalizedAddress?: {...}, latitude?, longitude?,
            confidence: number, suggestions?: [...] }
```

#### Validation Flow

1. User saves address → stored in Address table immediately (platform data is authoritative)
2. If a geocoding MCP service is registered and active (`ModelProvider` with `endpointType: "service"`), a validation request fires asynchronously (non-blocking)
3. On success: `validatedAt`, `validationSource`, `latitude`, `longitude` updated on the Address record
4. On failure or suggestions: a subtle indicator appears on the address in the UI

#### UI Indicators

| State | Icon | Meaning |
|-------|------|---------|
| Validated | Green checkmark | External service confirmed the address |
| Unvalidated | No icon | Service unavailable or not configured — no concern |
| Suggestions | Amber warning | Validation returned corrections — user can accept or dismiss |

#### MCP Registration

Fits the existing `ModelProvider` table:
- `endpointType: "service"`
- `category: "mcp-subscribed"` (Google Places, Mapbox) or `"mcp-internal"` (self-hosted Nominatim)
- Admin configures through the platform's MCP surface — no code changes needed to swap providers

**Key principle:** The platform never depends on the external service for address entry. Validation is an enhancement, not a gate.

### 8. DatePicker Component

A shared date picker replacing all raw `<input type="date">` elements across the platform. New dependency: `react-day-picker` added to `apps/web/package.json`.

#### Implementation

- Wraps `react-day-picker` (MIT license, zero dependencies, accessible, common in shadcn/ui stacks)
- Dark-theme compatible using existing platform CSS variables (`--background`, `--foreground`, `--accent`, etc.)
- Component file: `apps/web/components/ui/DatePicker.tsx`
- **Props interface:** `{ value?: Date | null, onChange: (date: Date | null) => void, mode?: "single" | "range", placeholder?: string, disabled?: boolean }`
- Returns `Date` objects (not ISO strings) — the consuming server action handles serialization
- Integrates with the existing form pattern (`inputClasses` / `labelClasses` from EmployeeFormPanel)
- Keyboard navigable (arrow keys to navigate days, enter to select, escape to close)
- Does not handle timezone conversion — dates are naive (consistent with existing date fields like `startDate`, `confirmationDate` on EmployeeProfile which are `DateTime` without timezone context)

#### Adoption Points

All existing date inputs across the platform:
- Employee start/end/confirmation dates
- Leave request date ranges
- Review cycle periods
- Timesheet week selection
- Calendar event creation
- Onboarding task due dates

---

## Migration & Seed Strategy

### Schema Migration

Single Prisma migration adding:
- `Country`, `Region`, `City` tables (with case-insensitive functional unique indexes via raw SQL)
- `Address`, `EmployeeAddress` tables
- `addressId` FK on `WorkLocation` (optional, with `@@index`)
- Rename `phoneNumber` → `phoneWork` on `EmployeeProfile` (data-preserving `ALTER TABLE RENAME COLUMN`)
- Add `phoneMobile`, `phoneEmergency` on `EmployeeProfile`

### Country Seed

- ISO 3166-1 dataset (~250 countries) loaded via idempotent seed script (upsert on `iso2`)
- Fields: name, iso2, iso3, numericCode, phoneCode
- Source: public domain JSON dataset (no license concerns)
- Can be re-run safely at any time

### Existing Data

- No backfill required — existing records simply have no addresses yet
- UI shows "Add address" prompt rather than empty fields
- `WorkLocation` records unchanged — `addressId` is nullable
- No breaking changes to any existing functionality

---

## Testing & Success Criteria

### Data Quality (Core Problem)

- No freeform country/region/city text fields anywhere — all reference-linked via FK
- Typeahead enforces selection from known values or explicit "add new" flow
- Unique constraints prevent duplicate regions and cities within their parent scope
- Case-insensitive typeahead search prevents near-duplicate creation

### Functional Tests

- Country seed: ~250 countries loaded, queryable by name/iso2/iso3
- Address CRUD: create, read, update with full hierarchy traversal (address → city → region → country)
- Typeahead: search by partial name, scoped by parent (regions for country X, cities for region Y)
- "Add new" flow: new region/city created, immediately available in typeahead results
- EmployeeAddress join: link address to employee, query employee's addresses, set/unset primary
- WorkLocation linking: office location gains an address without breaking existing references
- Phone fields: E.164 format validation on save
- DatePicker: renders correctly in all existing date input locations

### Validation Integration

- With MCP service registered: address validated async, latitude/longitude/validatedAt populated
- Without MCP service: address saves normally, no validation indicators shown
- Validation with suggestions: amber indicator displayed, user can accept or dismiss

### UX

- Address section appears in EmployeeFormPanel with cascading typeaheads
- DatePicker component renders consistently across all date inputs (dark theme)
- Typeahead works with keyboard navigation (accessibility)
- "Add new" inline form is minimal and fast — doesn't break the address entry flow

---

## Security & Access Control

- Address records are context-neutral — no inherent sensitivity
- Access control enforced at the join table level:
  - `EmployeeAddress` requires `view_employee` / `manage_employee` permissions
  - Future `CustomerAddress` requires customer-scoped permissions
- Geographic reference data (Country, Region, City) is read-accessible to all authenticated users
- Write access to reference data (adding new regions/cities) follows existing role patterns — any user entering an address can add missing reference entries
- Phone numbers on EmployeeProfile inherit employee record permissions

---

## API Layer

All new functionality uses Next.js server actions, consistent with the existing pattern (e.g., `apps/web/lib/actions/workforce.ts`).

### Server Actions

- `searchCountries(query: string)` — case-insensitive search on name, iso2, iso3. Returns `{ id, name, iso2, phoneCode }[]`.
- `searchRegions(countryId: string, query: string)` — case-insensitive search on name/code, scoped to country. Returns `{ id, name, code }[]`.
- `searchCities(regionId: string, query: string)` — same pattern, scoped to region.
- `createRegion(countryId: string, name: string, code?: string)` — with near-match check. Returns created region or error with suggestions.
- `createCity(regionId: string, name: string)` — same pattern.
- `createAddress(data: AddressInput)` — creates Address + EmployeeAddress link in a transaction.
- `updateAddress(addressId: string, data: Partial<AddressInput>)` — updates address fields.
- `deleteEmployeeAddress(employeeAddressId: string)` — removes the link (soft-deletes the address).
- `setPrimaryAddress(employeeAddressId: string)` — sets primary, unsets previous primary for same employee.

All typeahead search actions return a maximum of 20 results, ordered by name ascending.

## Open Questions

None — design approved through brainstorming session.

---

## Appendix: Backlog Item Mapping

| Backlog Item | Coverage in This Spec |
|---|---|
| Location reference data management (countries, regions, offices) | Sections 1, 2, 3, 4 — full geographic hierarchy + shared address model |
| Address and phone number fields on employee profiles | Sections 3, 5 — EmployeeAddress join table + phone fields on EmployeeProfile |
| Calendar date picker component for all date inputs | Section 8 — shared DatePicker wrapping react-day-picker |
