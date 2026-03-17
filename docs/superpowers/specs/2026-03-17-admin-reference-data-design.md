# EP-REF-002: Admin Reference Data Management

**Status:** Draft
**Date:** 2026-03-17
**Scope:** Admin page for managing geographic reference data (countries, regions, cities) and linking addresses to work locations

---

## Problem Statement

The Reference Data & UX Polish epic (EP-REF-001) introduced a geographic hierarchy (Country → Region → City) with organic growth — users add regions and cities as they enter addresses. However, there is no admin interface to:

- View what reference data has been created across the platform
- Fix mistakes (typos in region/city names, incorrect codes)
- Deactivate bad entries (duplicates that slipped through, test data)
- Link physical addresses to WorkLocation records (the schema bridge exists but has no UI)

Without this, organic growth has no cleanup path. An admin entering "Calfornia" by mistake has no way to correct it.

## Goals

1. Admin-only page for viewing and managing all geographic reference data
2. Inline editing of region/city names and codes
3. Soft-delete (deactivate/reactivate) for countries, regions, and cities
4. Work location → address linking UI
5. Follows existing admin page patterns exactly

## Non-Goals

- Bulk import/export of reference data
- Merge duplicate entries (deactivate the wrong one, keep the right one)
- Customer/supplier address management (future entity epics)
- Geocoding MCP service configuration (handled through the MCP Surface epic)

---

## Design

### 1. Route & Navigation

New admin sub-page at `/admin/reference-data`.

**AdminTabNav update** — add 4th tab:
```typescript
{ label: "Reference Data", href: "/admin/reference-data" }
```

**Auth:** Inherits the existing admin layout gate (`view_admin` capability, HR-000 + superusers only). No additional permissions needed.

**Route file:** `apps/web/app/(shell)/admin/reference-data/page.tsx` — server component following the standard admin page pattern (heading + AdminTabNav + content).

### 2. Page Layout

Four collapsible sections on a single page, each rendered by a client component panel. All sections visible by default, collapsible via a chevron toggle on the section header. Counts shown in each header.

```
┌─────────────────────────────────────────┐
│ Admin                                   │
│ Geographic reference data management    │
├─────────────────────────────────────────┤
│ Access | Branding | Settings | Ref Data │
├─────────────────────────────────────────┤
│ ▾ Countries (249 active)                │
│   [search] ________________             │
│   ┌──────────────────────────────┐      │
│   │ Afghanistan  AF  AFG  +93    │      │
│   │ Albania      AL  ALB  +355   │      │
│   │ ...                          │      │
│   └──────────────────────────────┘      │
├─────────────────────────────────────────┤
│ ▾ Regions (12 active)                   │
│   Country: [dropdown________]           │
│   ┌──────────────────────────────┐      │
│   │ California  CA  United States│ ✎ ×  │
│   │ Oregon      OR  United States│ ✎ ×  │
│   └──────────────────────────────┘      │
│   [+ Add region]                        │
├─────────────────────────────────────────┤
│ ▾ Cities (8 active)                     │
│   Country: [____] Region: [____]        │
│   ┌──────────────────────────────┐      │
│   │ San Francisco  California, US│ ✎ ×  │
│   │ Portland       Oregon, US    │ ✎ ×  │
│   └──────────────────────────────┘      │
│   [+ Add city]                          │
├─────────────────────────────────────────┤
│ ▾ Work Locations (5)                    │
│   ┌──────────────────────────────┐      │
│   │ HQ Office  [office]  PST     │      │
│   │ 📍 123 Main St, SF, CA 94102│      │
│   │            [Unlink address]  │      │
│   ├──────────────────────────────┤      │
│   │ Remote - Eastern  [remote]   │      │
│   │ No address  [Link address]   │      │
│   └──────────────────────────────┘      │
└─────────────────────────────────────────┘
```

### 3. Country Panel

**Component:** `apps/web/components/admin/CountryPanel.tsx` (client component)

**Display:** Searchable list of all countries. Each row shows: name, iso2, iso3, phoneCode, status badge.

**Search:** Client-side filter on name/iso2/iso3 (all countries are loaded — ~250 rows, no pagination needed).

**Actions:**
- Toggle status: active ↔ inactive. Deactivating a country hides it from typeahead dropdowns but does not cascade to regions/cities (they retain their status independently).
- No create/edit — countries are seeded from ISO 3166-1. Corrections go through the seed script.

**Status badge:** Green dot for active, muted dot for inactive.

### 4. Region Panel

**Component:** `apps/web/components/admin/RegionPanel.tsx` (client component)

**Filters:** Country dropdown at top (scopes the list). Shows all regions when no country selected.

**Display:** Each row shows: name, code, country name, status badge, created date.

**Actions:**
- **Inline edit:** Click edit icon → name and code become editable inputs. Enter to save, Escape to cancel. Uses `updateRegion` server action.
- **Deactivate/Reactivate:** Toggle status. Deactivating hides from typeahead but preserves existing address references.
- **Add region:** Button at bottom opens inline form (name, code, country dropdown). Uses existing `forceCreateRegion` to skip near-match check (admin is authoritative).

### 5. City Panel

**Component:** `apps/web/components/admin/CityPanel.tsx` (client component)

**Filters:** Country dropdown → Region dropdown (cascading). Shows all cities when no filters selected.

**Display:** Each row shows: name, region name, country name, status badge.

**Actions:**
- **Inline edit:** Name only (cities have no code).
- **Deactivate/Reactivate.**
- **Add city:** Inline form with region dropdown (scoped to selected country if filtered).

### 6. Work Location Panel

**Component:** `apps/web/components/admin/WorkLocationPanel.tsx` (client component)

**Display:** All work locations. Each card shows: name, type badge (office/remote/hybrid/customer_site), timezone, linked address (formatted) or "No address".

**Actions:**
- **Link address:** Opens a mini address form below the card. Reuses the same cascading typeahead pattern from AddressSection (Country → Region → City + street lines + postal code). Creates an Address record and links it via `addressId` on WorkLocation.
- **Unlink address:** Removes the `addressId` FK (sets to null). Does not delete the Address record.

No create/edit/delete for WorkLocations themselves — those are managed elsewhere (workforce reference data setup). This panel only manages the address link.

### 7. Server Actions

**File:** `apps/web/lib/actions/reference-data-admin.ts`

All actions require `view_admin` permission (checked via the same `requireAuth` + capability pattern used in workforce admin actions).

```typescript
// Country
toggleCountryStatus(id: string): WorkforceActionResult
  // Flips active ↔ inactive

// Region
updateRegion(id: string, data: { name?: string; code?: string }): WorkforceActionResult
  // Trims, validates non-empty name, updates
toggleRegionStatus(id: string): WorkforceActionResult

// City
updateCity(id: string, data: { name?: string }): WorkforceActionResult
toggleCityStatus(id: string): WorkforceActionResult

// Work Location address linking
linkWorkLocationAddress(locationId: string, addressData: AddressInput): WorkforceActionResult
  // Creates Address record + sets WorkLocation.addressId in a transaction
unlinkWorkLocationAddress(locationId: string): WorkforceActionResult
  // Sets WorkLocation.addressId to null
```

All actions call `revalidatePath("/admin/reference-data")`.

### 8. Data Loading

Server component loads all data in parallel via `Promise.all`:

```typescript
const [countries, regions, cities, workLocations] = await Promise.all([
  prisma.country.findMany({ orderBy: { name: "asc" } }),
  prisma.region.findMany({
    include: { country: { select: { id: true, name: true, iso2: true } } },
    orderBy: { name: "asc" },
  }),
  prisma.city.findMany({
    include: {
      region: {
        include: { country: { select: { id: true, name: true, iso2: true } } },
        select: { id: true, name: true, code: true, country: true },
      },
    },
    orderBy: { name: "asc" },
  }),
  prisma.workLocation.findMany({
    include: {
      address: {
        include: {
          city: {
            include: {
              region: {
                include: { country: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  }),
]);
```

No pagination — reference data is small (hundreds of rows, not thousands). Client-side filtering is sufficient.

---

## Testing

- Toggle country status: active → inactive → active roundtrip
- Update region name and code, verify persistence
- Deactivate a region, verify it disappears from employee form typeahead
- Add a new city via admin panel, verify it appears in employee form typeahead
- Link an address to a work location, verify it displays
- Unlink an address, verify WorkLocation.addressId is null
- Admin permission gate: non-admin user gets 404

---

## Security & Access Control

- All server actions check `view_admin` capability before executing
- The admin layout already gates the route — unauthenticated or unauthorized users get 404
- Reference data changes (deactivate/edit) do not cascade to existing records — addresses already using a deactivated region/city retain their references
- No destructive operations — all "deletes" are soft (status toggle)
