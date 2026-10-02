---
status: active
---

# Service coverage areas: implementation plan (BI-6CC10E4C)

**Design:** [service coverage areas](../specs/2026-10-02-service-coverage-areas-design.md)
**Backlog:** `BI-6CC10E4C` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` · workroom `WC-75B3F9BC`
**Shape:** `delivery-medium@1.0.0`. The baseline is the acceptance list in the backlog item.
**Starts after:** `BI-560128FB` (customer map, PR #5921) merges. This plan edits the customer map's view and loader.

## Delivery

One atomic PR, because no task is useful on its own: a saved area nobody can see is not a feature, and a Coverage section with no way to draw areas is empty. All tasks map to `BI-6CC10E4C`.

### Task 1: zone reference and validation

- `packages/storefront-templates/src/scene-layout.ts`: add an optional `coveredBy?: { kind: "staffing-crew" | "employee"; id: string }` to the geographic zone type only.
- `apps/web/lib/twin/geographic-scene.ts`:
  - `validateGeographicSceneLayout` checks that `coveredBy` has a known kind and a non-empty id.
  - It refuses a ring that crosses the antimeridian (any edge spanning more than 180° of longitude).
  - Zone features carry `coveredByLabel` for the map label.
- Tests: a valid `coveredBy`; an unknown kind refused; an antimeridian ring refused; existing layouts without `coveredBy` stay valid.

### Task 2: point-in-polygon and coverage

- Extract the even-odd ring ray-cast from `apps/web/lib/twin/cartesian-scene.ts:410` into a shared helper, so the cartesian behaviour is unchanged.
- New `apps/web/lib/twin/geographic-coverage.ts`:
  - `pointInGeographicPolygon(point, polygon)`: exterior ring plus holes.
  - `coverageForSites(sites, zones)` returns `{ bySite: Map<siteId, zoneId[]>, outside: siteId[], overlaps: { siteId, zoneIds }[] }`.
- Tests (AC-COV-PIP-1): inside, outside, inside a hole, concave "C" shape, and the existing cartesian tests unchanged. `coverageForSites` cases: outside, single, overlap, no zones.

### Task 3: geographic save path

- `apps/web/lib/twin/operational-scene-layout-repository.ts`: add `saveExistingGeographicScene` and `loadOrCreateServiceAreaLayout(orgId)`. The latter is the `TERRITORY` layout with `locationId = null` and `spaceKind = "geographic"`.
  - Saving uses the same optimistic `updateMany` version check as the cartesian path, validated with `validateGeographicSceneLayout`.
- New server action `apps/web/lib/actions/service-areas.ts`:
  - `saveServiceAreasAction(expectedVersion, zones)`: `requireCapability("operate_customer")`; returns `ok({version})` or `err("forbidden" | "stale" | "invalid")`.
  - `coveredBy` ids must resolve to a `StaffingCrew` or `EmployeeProfile` of the same organization.
- Tests (AC-COV-DRAW-2, AC-COV-DRAW-3):
  - create on first save;
  - a stale version refused, with nothing written;
  - an invalid layout refused;
  - forbidden without the capability;
  - an unknown or cross-organization `coveredBy` refused.

### Task 4: loader

- `apps/web/lib/crm/customer-map.server.ts` loads:
  - the service-area layout;
  - the assignable crews (`StaffingCrew`) and active employees (`EmployeeProfile.displayName`), with names only.

  It computes `coverageForSites` over the placed sites.
- `buildCustomerMap` takes the zones and returns them in the layout, with the coverage result.

### Task 5: Coverage section and drawing UI

- `CustomerMapView`: zones are drawn through the existing zone layers.
  - The **Coverage** section appears only when at least one area exists (AC-COV-SAFE-1). It holds:
    - the sites outside every area, each linking to its account (AC-COV-ANSWER-1);
    - the overlaps;
    - one row per area showing who covers it and its site count, with **Rename**, **Reassign** and **Delete** for editors.
  - Selecting a site names its areas and who covers them (AC-COV-ANSWER-2).
- New `ServiceAreaDrawing` client component:
  - a pure state machine (`idle → drawing(points) → naming → saving`) with **Undo last point**, **Finish** (enabled at three corners or more) and **Cancel**;
  - the in-progress outline is shown through the canvas model;
  - points come from the existing `onPlacePoint` callback.

  Controls are shown only with `canEdit` (AC-COV-DRAW-1, AC-COV-DRAW-3).
- i18n: new keys in `packages/i18n/src/messages/en-US/customerMap.json`; no hard-coded copy and no hard-coded colours.
- Tests:
  - the drawing state machine;
  - the view with no areas, one area and overlapping areas;
  - no edit controls when `canEdit` is false.

### Task 6: docs, UX fit, gates

- `docs/user-guide/customers/customer-map.md`: a "Service areas" section.
- A UX-fit manifest for `CustomerMapView` and `ServiceAreaDrawing` (WWMD `DI-17FBE7351E32`, `DI-4D6FA8193950`).
- The UX route baseline for `/customer` re-frozen if the sweep measures a change.
- Build gate: typecheck, affected tests, pregate. UX check on the contributor preview: drawing, Coverage section, light and dark themes, phone width.

## Acceptance traceability

| Acceptance | Task | Evidence |
|---|---|---|
| AC-COV-DRAW-1 | 3, 5 | drawing state machine and save action tests; preview walk-through |
| AC-COV-DRAW-2 | 3, 5 | stale-version test; rename, reassign and delete on the preview |
| AC-COV-DRAW-3 | 3, 5 | forbidden action test; view test without `canEdit` |
| AC-COV-PIP-1 | 2 | point-in-polygon tests |
| AC-COV-ANSWER-1 | 2, 4, 5 | `coverageForSites` and view tests |
| AC-COV-ANSWER-2 | 2, 5 | view selection test; preview |
| AC-COV-SAFE-1 | 5, 6 | view test with no areas; diff shows no package or migration |

## Backlog coverage

All tasks: `BI-6CC10E4C` (atomic). Split out and not covered here:
- `BI-D5549DE2`: technician live position.
- Drive-time areas: not filed. They stay an optional routing-connector idea in the parent spec.

Receipt: blocked-by: BI-560128FB (PR #5921 must merge first).
