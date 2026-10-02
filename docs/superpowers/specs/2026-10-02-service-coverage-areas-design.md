---
status: draft
---

# Service coverage areas: design (BI-6CC10E4C)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-6CC10E4C` (P3) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parents** | [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) §3.2, §5, §6, §7 P3 · [Spatial operational views](./2026-07-21-spatial-operational-views-design.md) |
| **Builds on** | The map engine, `BI-814F86E1` (PR #5906) · the customer map, `BI-560128FB` (PR #5921: site points, the "Not on the map" list, the canvas click callback) |
| **Decisions** | WWMD `DI-68B7F9ED5FBF`: who covers an area is an optional reference on the zone (high confidence, margin 2.63). WWMD `DI-4D6FA8193950`: areas are drawn in-house by clicking corners, with no drawing library (high, 0.50). WWMD `DI-17FBE7351E32`: areas live on the customer map (high, 1.72). |
| **Out of scope** | Live technician position: split to its own item because it is employee monitoring and needs a privacy assessment (parent §6). Also out of scope: drive-time areas (isochrones), routing, PostGIS, and the phone map (`BI-3DAE2169`). |

## 1. Problem

An MSP or field-service business promises to serve some places and not others. Today DPF cannot answer three questions an owner asks when taking on a customer or sending someone out:

1. Which customer sites are outside every area we serve?
2. Which crew or technician covers this site?
3. Where do our areas overlap, so two crews could both claim a job?

The substrate is mostly present (verified 2026-10-02 against `main`):

- `OperationalSceneLayout` stores one layout per organization, twin template and optional location (`verticals-storefront.prisma:80`). The `TERRITORY` template is already geographic (`packages/storefront-templates/src/twin-profile.ts:174`).
- A geographic layout already holds zones, as polygons in longitude/latitude (`packages/storefront-templates/src/scene-layout.ts:94`). The renderer already draws them (`apps/web/components/twin/geographic/geographic-style.ts`).
- The customer map (PR #5921) already places every customer site that has coordinates.

Four things are missing:

- **Assignment:** a zone cannot say who covers it.
- **Saving:** nothing saves a geographic layout. The repository refuses any space kind other than cartesian (`apps/web/lib/twin/operational-scene-layout-repository.ts:78`).
- **Drawing:** there is no way to draw an area.
- **Point-in-polygon:** the only implementation is cartesian and private (`apps/web/lib/twin/cartesian-scene.ts:410`).

## 2. What this item delivers

1. **Who covers an area.** The shared geographic zone type gains an optional `coveredBy` reference: `{ kind: "staffing-crew" | "employee", id }`. It points at `StaffingCrew.crewId` or `EmployeeProfile.employeeId`. It mirrors how a placement already references its entity. It is stored in the layout JSON, so no migration is needed. A zone without `coveredBy` is still a valid service area that nobody is assigned to.
2. **Saving a geographic layout.** The repository gains a geographic save path, `saveExistingGeographicScene`, beside the cartesian one. It uses the same optimistic version check: a stale save is refused and the caller reloads. It validates with `validateGeographicSceneLayout`. Zones are limited to the existing 200, and a polygon may not cross the antimeridian. The service-area layout is the organization's `TERRITORY` layout with no location. It is created on first save.
3. **Pure coverage logic**, in `apps/web/lib/twin/geographic-coverage.ts`, with no new dependency:
   - `pointInGeographicPolygon(point, polygon)`: a ray-cast over longitude/latitude with even-odd rings, so holes are supported. It shares the ring routine with the cartesian helper, which is extracted rather than copied.
   - `coverageForSites(sites, zones)`: returns, for each site, the zones that contain it. It also returns the sites outside every zone, and the sites inside more than one zone (the overlaps).
4. **Areas on the customer map.** The customer map view shows the areas as filled outlines. A **Coverage** section under the map shows:
   - the sites outside every area, each linking to its account;
   - the areas that overlap, with the sites they share;
   - for each area, its name, who covers it and how many sites it holds.

   Selecting a site point names the area or areas that cover it, and who covers them. The section appears only when at least one area exists, so a business that does not use areas sees nothing new.
5. **Drawing and editing areas** (operate_customer). On the customer map:
   - **Add a service area** starts drawing. Each click on the map adds a corner, with **Undo last point**, **Finish** (at least three corners) and **Cancel**.
   - The new area is then named and optionally assigned to a crew or employee from a list.
   - An existing area can be renamed, reassigned or deleted.
   - To reshape an area, delete it and draw it again. Vertex editing is out of scope for v1.

   Drawing reuses the canvas click callback that the manual pin introduced.

## Objectives and acceptance

- **OBJ-COV-AREAS:** An owner can draw, name, assign, rename and delete service areas on the customer map, and they persist for the organization.
- **OBJ-COV-ANSWERS:** The customer map answers which sites are outside every area, who covers a given site, and where areas overlap.
- **OBJ-COV-SAFE:** Coverage adds no dependency, no migration and no outbound request, and changes nothing for an organization with no areas.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-COV-DRAW-1 | OBJ-COV-AREAS | A person with `operate_customer` can draw an area of at least three corners, name it, and optionally assign a crew or employee. After reload it is shown on the customer map. |
| AC-COV-DRAW-2 | OBJ-COV-AREAS | An area can be renamed, reassigned and deleted. A save made against an outdated version is refused with a message to reload, and nothing is overwritten. |
| AC-COV-DRAW-3 | OBJ-COV-AREAS | A person without `operate_customer` sees the areas but no drawing or editing controls, and the save action refuses them. |
| AC-COV-PIP-1 | OBJ-COV-ANSWERS | `pointInGeographicPolygon` is correct for points inside, outside, inside a hole, and on concave shapes. Unit tests cover each case. |
| AC-COV-ANSWER-1 | OBJ-COV-ANSWERS | The Coverage section lists every placed site outside every area, each linking to its account. |
| AC-COV-ANSWER-2 | OBJ-COV-ANSWERS | Selecting a site names each area that covers it and who covers that area. A site in more than one area is listed under overlaps with the areas it shares. |
| AC-COV-SAFE-1 | OBJ-COV-SAFE | With no areas saved, the customer map is unchanged apart from the **Add a service area** control for people who can edit. The change adds no package, no migration and no outbound request. |

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| `coveredBy` on the zone, in the existing layout JSON | A new `ServiceArea` table; a free-text crew name in the label | One home for the polygon and its owner. It is consistent with placement `entityRef` and needs no migration. A label cannot be queried or kept in step with a renamed crew. WWMD `DI-68B7F9ED5FBF` |
| In-house click-to-add-corners drawing | terra-draw (MIT); postal-code lists | Absorb, don't adopt: about 150 lines on the existing click callback versus a new dependency. Postal codes cannot express a polygon and need a code-to-area dataset. WWMD `DI-4D6FA8193950` |
| Areas on the customer map | A tab on the trades dispatch board; a separate coverage page | The board is trades-only and excludes MSPs. A second map page splits one capability. WWMD `DI-17FBE7351E32` |
| Pure TypeScript point-in-polygon | PostGIS; turf.js | Parent §3.2: tens of polygons and up to low thousands of sites. PostGIS changes the pinned Postgres image and needs its own tool evaluation. turf is a dependency for one function. |
| Redraw to reshape | Vertex editing | It keeps v1 small. Vertex handles can come later if operators ask. |
| Live technician position split out | Built here | It is employee monitoring: legitimate interest plus a privacy assessment, extending `DriverLocationConsent` (parent §6). It deserves its own design and review. |

## 4. Research & Benchmarking

Parent §5 compares Odoo, Frappe/ERPNext, SuiteCRM and Traccar for the map engine. For coverage specifically:

- **ServiceTitan** ([Set up and use zones](https://help.servicetitan.com/docs/set-up-and-use-zones), accessed 2026-10-02):
  - A zone is a set of ZIP codes or cities, with wildcards such as `912*`. A ZIP or city belongs to one zone only.
  - A technician has one main zone.
  - Locations are assigned to zones automatically by ZIP, and the dispatch board shows a zone dot for each job and technician.
- **Housecall Pro** ([Service area overview](https://help.housecallpro.com/en/articles/362750-service-area-overview), accessed 2026-10-02):
  - A business has several service areas, each built from cities or ZIP codes, with an optional trip charge and assigned technicians.
  - Areas can be picked on an interactive map.
- **What DPF adopts and rejects from both:**
  - **Adopted:** a named service area with assigned people; automatic site-to-area matching; showing a site's area alongside it. The `hvac-dispatch-territory` operational precedent (`apps/web/data/design-intelligence/operational-precedents.csv`) already records zones as part of ServiceTitan's dispatch.
  - **Deviation:** areas are drawn polygons, not postal-code lists. Postal matching needs a postal-code-to-boundary dataset. The install has none, and DPF serves countries whose postal codes do not map to useful areas. A polygon works anywhere a site has coordinates.
  - **Postal-code areas** remain a possible later addition. One could build the same zone from a postal boundary pack, if one is ever installed.
  - **Not adopted:** the one-zone-per-ZIP rule. Overlaps are allowed and reported instead, because two crews sharing an edge is a real situation the owner should see.
- **Turf.js `booleanPointInPolygon`** (MIT) is the common open-source reference implementation of the even-odd ray-cast. DPF adopts the same algorithm and its edge-case semantics (holes, boundary treatment). It rejects the package: the function is a few dozen lines and the rule is to absorb, not adopt.
- **Standards:**
  - GeoJSON RFC 7946 polygon semantics: an exterior ring plus holes, longitude/latitude order. Rings do not cross the antimeridian; RFC 7946 §3.1.9 says to split them instead, and v1 refuses them.
  - WGS84 / EPSG:4326 for storage, as in the parent spec.

## 5. Security and privacy

- **Permissions:** viewing areas needs `view_customer`, the same as the customer map. Drawing, assigning and deleting need `operate_customer`. The save action checks the capability itself; hiding the controls is not the only protection. Every new server action checks a capability, so it does not repeat the defect filed as `BI-1708EC05`.
- **No outbound request:** areas are drawn and evaluated in the install.
- **Employee names:** assigning a crew or employee shows their display name to anyone who can view the customer map. That is the same audience that already sees them on dispatch screens. No location of the employee is stored or shown.

## 6. Verification

- **Unit tests:**
  - point-in-polygon cases;
  - `coverageForSites` (outside, single, overlap);
  - zone `coveredBy` validation;
  - the geographic save path (version conflict, validation refusal, create on first save);
  - the save action's capability check;
  - the drawing state machine: add, undo, finish requires three corners, cancel.
- **UX:**
  - drawing, naming, assigning and deleting an area;
  - the Coverage section with no areas, one area, and overlapping areas;
  - light and dark themes and phone width, on the contributor preview.
- **Build gate:** typecheck, affected tests and the production build.

## 7. Documentation impact

- `docs/user-guide/customers/customer-map.md`: a "Service areas" section on drawing areas, assigning who covers them, and reading the Coverage section.
