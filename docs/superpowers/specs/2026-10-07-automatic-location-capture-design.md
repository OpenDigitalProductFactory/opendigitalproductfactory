---
status: draft
---

# Automatic location capture: design (BI-C318C227)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-07 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-C318C227` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Builds on** | [Customer map and geocoding](./2026-10-02-customer-map-and-geocoding-design.md) (`BI-560128FB`: provider boundary, "never overwrite a confirmed point") · [Geographic map renderer](./2026-09-25-geographic-map-renderer-design.md) (`BI-814F86E1`: map packs and manifests) · the phone jobs flow (`apps/mobile/app/(tabs)/jobs/`) |
| **Connects to** | [Walk-up front door](./2026-08-05-viral-walkup-consumer-front-door-design.md) §4 item 1 and open question B (address geofence, nearby discovery) · [Town super-app](./2026-06-14-multi-business-town-super-app-design.md) M3, `BI-457160BB` (one geo grant) · [Field dispatch mobile contract](./2026-06-14-field-dispatch-mobile-contract-and-warranty-design.html) §2 (arrival geofence) · phone map `BI-3DAE2169` |
| **Decisions** | WWMD `DI-E73099262724` (confirmation is read from the existing source field, no new column) · `DI-BAD6A23EDF7C` (geocode on save through the jobs facade) · `DI-FD37ECA61552` (the business's own point lives in `Organization.address`) · `DI-B48FA1D225B4` (the portal computes the region; fetching the pack is separate) · `DI-6FCBA11B7980` (one consented position fix at check-in, low confidence, see §7) |
| **Out of scope** | Background or continuous staff location (`BI-D5549DE2`), automatic arrival detection, fetching and installing map packs (filed separately, §2.3), employee home addresses, routing |

## 1. Problem

Locations reach the map only by hand. On 2026-10-07 the operator asked for them to "fill in automatically… as the business locations are added or person travels to an appointment."

What is on `main` today:

- `apps/web/lib/geocoding/` has a provider boundary (`none` by default, `census`, `opencage`, `self-hosted`) and an administrator-started backfill. Nothing geocodes an address when it is saved. A customer site gets coordinates only if the person picks a suggestion from the address lookup.
- The business's own address is `Organization.address`, a JSON value without coordinates. The walk-up front door's nearby discovery (`/api/v1/directory/nearby`, `extractOrgLatLng` in `apps/web/lib/api/nearby-geo.ts`) reads `latitude` and `longitude` from that JSON. Nothing writes them, so nearby discovery cannot find any business.
- Staff check in on the phone by moving a job to "in progress" (`PATCH /api/v1/work-items/:id`). No position is recorded and nothing links a job directly to a customer site. The account is resolved when the job is read (`apps/web/lib/api/work-item-account-resolution.ts`).
- "One geo grant" (`BI-457160BB`) is not built. The phone has a foreground-only hook, `apps/mobile/src/hooks/useGeolocation.ts`, which asks for permission and takes one fix when its screen mounts.
- Map packs are copied into `/var/lib/dpf/maps` by hand. The Texas pack was chosen by the operator. Nothing records which region a business needs.
- Geofencing exists only as words in designs, plus three separate haversine helpers (`lib/storefront/geo.ts`, `lib/api/nearby-geo.ts`, `lib/mileage/classification.ts`) and a test-harness `withinGeofence`.

## 2. What this item delivers

### 2.1 Geocode on save

1. **When.** After a customer site is created or its address changes, after a business location (`WorkLocation`) address is created, and after the organization address is saved. The request is sent only when the saved point has no coordinates and the configured provider is not `none`.
2. **How.** The save emits `geocode/address.requested` (or `geocode/organization.requested`) through the `@/lib/jobs` facade. One registered function looks up that single address through the existing provider. Its concurrency is 1 for the whole install, and it waits the provider's `minIntervalMs` between calls, so the backfill's rate rules hold. The save never waits for the lookup and never fails because of it.
3. **The confirmation rule.** One classifier, `locationProvenance(validationSource)` in `apps/web/lib/geocoding/provenance.ts`, sorts every source into exactly one of:
   - **person-confirmed:** `manual-pin`, `nominatim` (a person picked a lookup suggestion), `device-confirmed` (new, §2.2);
   - **provider-derived:** `census`, `opencage`, `self-hosted`.

   Provider results only fill empty coordinates. A device confirmation may replace provider-derived coordinates and never person-confirmed ones. Every write is a conditional `updateMany` whose `where` encodes the rule, so two writers racing cannot break it. The backfill switches to the same classifier.
4. **Address changes.** A customer site's address change already creates a new `Address` row, so the new address starts unconfirmed and is geocoded. For the organization address, a changed address clears provider-derived coordinates and requests a geocode. Person-confirmed coordinates are kept.
5. **The business's own point.** `OrgAddress` gains optional `latitude`, `longitude`, `validationSource` and `validatedAt`. Serialization keeps them while the address text is unchanged. These are the keys nearby discovery already reads, so geocoding the business address makes that discovery work with no change to its code.
6. **With provider `none`.** Nothing is sent. The existing "Not on the map" list (BI-560128FB) remains the fix path.

### 2.2 Confirm a site's location at check-in

1. **Which site.** `resolveWorkItemSites` sits beside `resolveWorkItemAccount` and uses the same source chain. The account's active, unmerged customer sites are returned with whether each has a location and whether it is person-confirmed. One site is used directly. Several sites are offered as a choice.
2. **The offer.** After "Check in / start" succeeds, the phone asks only when the site has an address and no person-confirmed location. The text is: "Set the location of *{site}* from where you are now? Your phone's location is used once, for this site only." The answers are **Use my location** and **Not now**. "Not now" is remembered on the device for that site for 30 days.
3. **Consent.** Only a tap on **Use my location** asks the operating system for permission (foreground, when in use) and takes one high-accuracy fix. `useGeolocation` gains `{ auto: false }` so nothing is requested when the screen opens. There is no background location, no watch, and nothing is sent at check-in itself.
4. **The server check.** `POST /api/v1/customer-sites/:siteId/location/device-confirmation` takes `{ workItemId, latitude, longitude, accuracyMeters, confirmFar? }` and refuses unless all of these hold:
   - the caller is assigned the job and the job is in progress;
   - the site belongs to the job's resolved account and has an address;
   - accuracy is 50 m or better;
   - the site has no person-confirmed location;
   - when a provider point exists more than 1,000 m away, `confirmFar` is true. The phone asks first: "The address on file is 3.4 km from you. Are you at the site?"
5. **What is stored.** The point is stored on the site's `Address`, rounded to 5 decimal places (about 1 m), with `validationSource = "device-confirmed"` and `validatedAt`. An audit entry records who confirmed which site and when. The person's position is not stored anywhere else. The stored point is the site's location, not a record of where the person was.
6. **Shared device layer.** When `BI-457160BB` lands, this flow uses its single grant in place of the hook. The hook is the seam, so no second permission layer is created.

### 2.3 Pick the street-map region automatically

1. **The computation.** `recommendMapRegions` in `apps/web/lib/twin/map-region-recommendation.ts` is a pure function. It takes the organization point and every placed customer site and business location, grouped by the address's state or province (`City → Region → Country`). For each group it returns:
   - the bounds, padded by the larger of 25 km and 10% of the group's span;
   - a label such as "Texas, United States";
   - a suggested pack id such as `us-texas`;
   - whether an installed pack's manifest bounds already cover every point, using the same containment test the renderer uses (`packCoveringBounds`).

   Grouping by region means one far-away site adds a second region rather than turning the first into half a continent.
2. **Where it shows.** The geocoding administration panel on the customer map gains a "Street maps" line. Examples: "All 14 placed locations are covered by Texas, United States", or "3 locations in Oklahoma, United States are not covered. Recommended pack: `us-oklahoma`." `GET /api/map-assets/recommendation`, which requires `manage_platform`, returns the same result for tooling.
3. **Fetching the pack** is a separate backlog item. It needs the go-pmtiles extractor, which has no tool evaluation yet. It will consume this recommendation, so the operator is never asked to choose a region again.

### 2.4 One geofence, shared with the walk-up front door

`packages/types/src/geofence.ts` provides `haversineMeters`, `Geofence { centre, radiusMeters }`, `withinGeofence` and `addressGeofence(point, radiusMeters)`. Web and phone both import it.

- **Uses in this item:**
  - the 1,000 m far-from-address test in §2.2;
  - the coverage test in §2.3;
  - nearby discovery's distance (`nearby-geo.ts`), which is re-pointed with no change in behaviour.
- **Connection to the walk-up front door:**
  - That design's "address geofence" is `addressGeofence(organization point, radius)`. Its centre now comes from §2.1, with provenance attached.
  - Proactively serving people who move into a business's area uses the same primitive, matched on the visitor's device, as open question B recommends.
  - This item adds no movement tracking and no server-side presence.
- **Answer to open question B:** a business's geofence centre can only be its own organization address. Its trust is visible as provenance: provider-derived or person-confirmed. Verifying a business against spoofing stays open and is owned by the walk-up work.

## Objectives and acceptance

- **OBJ-ALC-SAVE:** Customer sites, business locations and the business's own address are placed on the map automatically when saved, through the administrator's chosen provider, and never overwrite a location a person confirmed.
- **OBJ-ALC-VISIT:** A staff member checking in at a job on the phone can confirm the site's location from where they are, only with an explicit tap, using one position fix and with no background tracking.
- **OBJ-ALC-REGION:** The portal works out which street-map regions the business needs from its own locations and says whether the installed packs cover them, without asking the operator to choose.
- **OBJ-ALC-GEOFENCE:** One geofence primitive serves the check-in, map coverage and the walk-up front door's nearby discovery.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-ALC-SAVE-1 | OBJ-ALC-SAVE | With a provider configured, creating a customer site without lookup coordinates, or changing its address, results in one geocode request for that address, and a found result stores the provider's point with `validationSource` set to the provider id. |
| AC-ALC-SAVE-2 | OBJ-ALC-SAVE | Saving the organization address with a provider configured stores `latitude` and `longitude` in `Organization.address`, and `/api/v1/directory/nearby` then returns the business for a point within the requested radius. |
| AC-ALC-SAVE-3 | OBJ-ALC-SAVE | With the default provider `none`, saving a site, business location or organization address sends no geocoding request and emits no geocode job. |
| AC-ALC-SAVE-4 | OBJ-ALC-SAVE | No geocode or backfill write replaces coordinates whose source is `manual-pin`, `nominatim` or `device-confirmed`. |
| AC-ALC-VISIT-1 | OBJ-ALC-VISIT | After check-in on a job whose site has no person-confirmed location, the phone offers to set it. No location permission is requested and no position is read until the person taps "Use my location". |
| AC-ALC-VISIT-2 | OBJ-ALC-VISIT | A confirmation from the assigned staff member on an in-progress job, with accuracy of 50 m or better, stores the point rounded to 5 decimal places with `validationSource = "device-confirmed"`. The site then shows on the customer map as confirmed. |
| AC-ALC-VISIT-3 | OBJ-ALC-VISIT | The server refuses a confirmation from someone not assigned the job, for a site outside the job's account, with accuracy worse than 50 m, for an already person-confirmed site, or more than 1,000 m from the address's provider point without `confirmFar`. |
| AC-ALC-VISIT-4 | OBJ-ALC-VISIT | No position is stored except the confirmed site point, and the phone app holds no background location permission or location task. |
| AC-ALC-REGION-1 | OBJ-ALC-REGION | For an install whose placed locations are all inside an installed pack's bounds, the panel and the recommendation API report them as covered by that pack. |
| AC-ALC-REGION-2 | OBJ-ALC-REGION | Locations in a state or province with no covering pack are counted and reported with recommended padded bounds, a label and a suggested pack id, one group per region. |
| AC-ALC-GEOFENCE-1 | OBJ-ALC-GEOFENCE | `withinGeofence` and `haversineMeters` come from one module in `packages/types`, used by the device-confirmation check, region coverage and nearby discovery, with nearby discovery's results unchanged. |

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| Confirmation read from `validationSource` through one classifier | A new `coordinatesConfirmedAt` column | No migration. The field already records provenance. One classifier plus conditional writes enforce the rule. WWMD `DI-E73099262724`, high confidence. |
| One geocode job per saved address through `@/lib/jobs` | Geocoding inside the save; fire-and-forget like the backfill | Saves stay fast, the job survives restarts, and pacing is shared. WWMD `DI-BAD6A23EDF7C`, margin 5.2. |
| Business point in `Organization.address` | A new `Organization.primaryAddressId` row | Nearby discovery and the storefront already read these keys. WWMD `DI-FD37ECA61552`, high confidence. |
| One consented fix after check-in | Silent capture at every check-in; waiting for `BI-457160BB` | Consent and no tracking were requirements. The hook is the seam the device layer will replace. WWMD `DI-6FCBA11B7980`, low margin over waiting (§7). |
| Site taken from the job's account | A new `WorkItem.customerSiteId` | It reuses the existing source chain. A direct link belongs to field dispatch (`BI-A951CC46`). |
| Regions grouped by state or province from the address hierarchy | A bundled catalog of region boundaries; one box around every point | The hierarchy is already in the database, and grouping keeps one outlying site from bloating a pack. |
| Recommendation now, fetching later | Adding the extractor to the portal image | The extractor has no tool evaluation, and absorb-don't-adopt applies. WWMD `DI-B48FA1D225B4`. |

## 4. Research & Benchmarking

- **Odoo `base_geolocalize` (open source).**
  - Geocodes a partner's address and stores `partner_latitude`/`partner_longitude` with a date.
  - A fix on its field-service app made it re-geocode when the address changes, because old coordinates outlived edits.
  - **Adopt:** geocode on save and on address change.
  - **Reject:** its default OpenStreetMap provider for bulk use, which the OSMF policy forbids, and Google, whose terms forbid keeping results.
  - **Gap filled:** Odoo cannot tell a person-placed pin from a geocoded one, so a re-geocode can erase a correction. DPF's provenance classifier prevents that.
- **Salesforce Field Service (commercial).**
  - Tracks a mobile worker's position in the background at configurable accuracy (100 m to 3 km).
  - Shares the worker's location only after "En Route".
  - Check-ins record a verified location next to the account location.
  - **Adopt:** a check-in is the natural moment to verify a site location.
  - **Reject:** background polling. It is employee monitoring, which `BI-D5549DE2` handles separately with a privacy assessment.
- **Jobber and Housecall Pro (commercial).**
  - Jobber stamps a GPS waypoint at clock-in, notes and completion, which reviewers describe as accountability without constant monitoring.
  - Housecall Pro offers geofence auto-clock-in and vehicle tracking.
  - **Adopt:** event-based, not continuous, capture.
  - **Go further:** DPF asks each time and keeps only the site point, not a waypoint history of the person.
- **Protomaps / go-pmtiles (open source).**
  - `pmtiles extract --bbox=W,S,E,N` cuts a region from the planet build.
  - Bounds are the only input a region needs, so DPF computes and publishes bounds in the same `west, south, east, north` order as its manifest.
- **Home Assistant zones and the Android geofencing API.**
  - A geofence is a centre and a radius. Android advises a radius of at least 100–150 m because of fix accuracy.
  - **Adopt:** centre plus radius as the one geofence shape.
  - **Adopt:** the accuracy floor (50 m to confirm a site, 1,000 m before asking "are you at the site?").
- **Standards:**
  - W3C Geolocation API, foreground one-shot `getCurrentPosition` semantics, used through `expo-location`;
  - RFC 7946 GeoJSON coordinate order;
  - Apple and Google "when in use" location permission, with no background mode.

## 5. Security and privacy

- **Addresses:** customer and business addresses leave the install only through a provider an administrator chose. The default sends nothing.
- **Staff position:**
  - read only on an explicit tap, once, in the foreground;
  - sent only to confirm a site the person is assigned to visit;
  - kept only as that site's location;
  - nothing is retained about the person's movements, so no retention schedule applies.
- **No standing consent:** `DriverLocationConsent` stays the anchor for continuous tracking (mileage, `BI-D5549DE2`). This item needs no standing consent because each tap is the consent.
- **Permissions:**
  - device confirmation requires assignment to an in-progress job and the site belonging to that job's account;
  - the recommendation API requires `manage_platform`;
  - the map and panel keep BI-560128FB's permissions.
- **Input validation:** coordinates and accuracy are range-checked on the server. Provider responses are already validated by the adapters.

## 6. Verification

- **Unit tests:**
  - the provenance classifier;
  - conditional writes that refuse to overwrite person-confirmed points;
  - the geocode job, with the provider mocked, honouring `none` and the interval;
  - organization address serialization keeping and clearing coordinates;
  - `resolveWorkItemSites`;
  - every refusal and the success path of the device-confirmation route;
  - `recommendMapRegions`: covered, partly covered, and two-region cases;
  - `geofence.ts`;
  - nearby discovery's existing tests, unchanged.
- **Phone:**
  - the check-in offer, the "Not now" memory and the far-from-address question, through the jobs store tests;
  - a check that `app.json` declares no background location.
- **Runtime:**
  - the contributor preview: create a site with a provider configured and see it placed;
  - the panel's street-map line against the installed Texas pack.
- **Build gate:** typecheck, affected tests and the production build.

## 7. Open item for the owner

WWMD scored the phone confirmation (`DI-6FCBA11B7980`) at low margin over waiting for the shared device layer. It proceeds because the operator's request sets the terms (consent only, no background tracking) and the hook is a replaceable seam. It ships as the last phase, separately from geocode-on-save and regions, so it can be held without holding the rest.

## 8. Documentation impact

- `docs/user-guide/customers/customer-map.md`: sites placed automatically, and confirming a site's location from the phone at check-in, including what the phone does with location.
- `docs/user-guide/platform/address-validation-providers.md`: geocoding on save.
- `docs/user-guide/platform/map-packs.md`: the street-map coverage line and recommended regions.
