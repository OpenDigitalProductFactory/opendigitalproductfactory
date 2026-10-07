---
status: draft
---

# Automatic location capture: implementation plan

- **Backlog item:** `BI-C318C227` (umbrella) · epic `EP-SPATIAL-OPERATIONAL-VIEWS`
- **Design:** [2026-10-07-automatic-location-capture-design.md](../specs/2026-10-07-automatic-location-capture-design.md)
- **Workroom:** `WC-CB18F5B9` · branch `feat/automatic-location-capture`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Phases and deliverables

| Phase | Backlog item | Objectives | Depends on | Ships alone |
|---|---|---|---|---|
| 1 | `BI-CAA04C84`: geocode on save, provenance rule, shared geofence | OBJ-ALC-SAVE, OBJ-ALC-GEOFENCE | — | yes |
| 2 | `BI-8C76920D`: region recommendation | OBJ-ALC-REGION | phase 1 (geofence module) | yes |
| 3 | `BI-BA53C1A8`: confirm a site at check-in | OBJ-ALC-VISIT | phase 1 (provenance, geofence) | yes |
| — | `BI-43BBCC26`: fetch and install packs | follow-up, not in this plan | phase 2 | — |

Phase 3 goes last, as the design §7 requires, so it can be held without holding the rest.

## Phase 1: geocode on save (`BI-CAA04C84`)

**Shared geofence module**
1. `packages/types/src/geofence.ts` (exported from `packages/types/src/index.ts`) contains:
   - `GeoPoint`, `haversineMeters`, `Geofence`, `withinGeofence`, `addressGeofence`;
   - the constants `SITE_CONFIRM_MAX_ACCURACY_M = 50` and `SITE_CONFIRM_FAR_M = 1000`.
2. Tests are in `geofence.test.ts`.
3. `apps/web/lib/api/nearby-geo.ts`: `haversineKm` delegates to `haversineMeters`. The existing nearby tests must pass unchanged.

**Provenance rule**

4. `apps/web/lib/geocoding/provenance.ts` contains:
   - `locationProvenance(source)`, returning `"person-confirmed" | "provider-derived" | "none"`;
   - `PERSON_CONFIRMED_SOURCES`;
   - `replaceableByProviderWhere()` and `replaceableByDeviceWhere()`, Prisma `where` fragments for `Address`.
5. Tests are in `provenance.test.ts`.
6. `apps/web/lib/geocoding/backfill.ts` uses `replaceableByProviderWhere()`. The existing backfill tests stay green.

**Geocode job**

7. `apps/web/lib/jobs/events.ts` gains the events `geocode/address.requested { addressId }` and `geocode/organization.requested { organizationId }`.
8. `apps/web/lib/queue/functions/geocode-on-save.ts`: one function per event, `concurrency: [{ key: "\"geocoding\"", limit: 1 }]`, `retries: 2`. Each function:
   - loads the config with `parseGeocodingConfig`;
   - resolves the provider and returns early if it is not enabled;
   - geocodes one input;
   - writes with `updateMany` guarded by the provenance `where`;
   - `step.sleep`s `minIntervalMs`.

   Both are registered in `apps/web/lib/queue/functions/index.ts`.
9. `apps/web/lib/geocoding/request.server.ts`: `requestAddressGeocode(addressId)` and `requestOrganizationGeocode(orgId)` read the provider config and `jobs.send` only when it is enabled. They swallow and log send failures, so a save never fails because of geocoding.

**Hooks on save**

10. `apps/web/lib/actions/customer-sites.ts`: after the create (`createCustomerSite`) and the address-change (`updateCustomerSite`) transactions commit, call `requestAddressGeocode` when the materialized address has no latitude.
11. `apps/web/lib/actions/reference-data-admin.ts`: the same after the work-location address is created.
12. `apps/web/lib/shared/org-address.ts`:
   - `OrgAddress` gains `latitude?`, `longitude?`, `validationSource?` and `validatedAt?`;
   - `serializeOrgAddress(next, previous)` keeps coordinates when the address text is unchanged, or when they are person-confirmed;
   - otherwise it drops them.
13. `apps/web/app/api/business-context/setup/route.ts`: after the update, call `requestOrganizationGeocode` when the stored address has text and no coordinates.

**Phase 1 verification**
- **Unit tests:**
  - geofence;
  - provenance;
  - `serializeOrgAddress` keeping and clearing coordinates;
  - the geocode functions: `none` sends nothing, found and not-found results, refusal to overwrite person-confirmed coordinates, interval sleep;
  - the request helpers sending nothing under `none`;
  - the customer-site actions emitting exactly one request.
- **Package checks:** typecheck of `apps/web` and `packages/types`.
- **Runtime, on the contributor preview:**
  - with `geocoding.provider` set to a self-hosted mock, or `census` for a US address, create a site and see it placed on `/customer?view=map`;
  - save the organization address and query `/api/v1/directory/nearby` near it.
- **No live production data is written.** Any run against the live install needs the operator's go first.

## Phase 2: region recommendation (`BI-8C76920D`)

1. `apps/web/lib/twin/map-region-recommendation.ts`: `recommendMapRegions({ points, packs })`.
   - Each point is `{ latitude, longitude, regionName, countryName, countryIso2 }`.
   - It groups points by country and region, then for each group pads the bounds by the larger of 25 km and 10% of the span, and clamps them to valid ranges.
   - The label is "Texas, United States". The pack id is `${iso2}-${slug(region)}`, matching `us-texas`.
   - Coverage uses `packCoveringBounds`, imported from `apps/web/components/twin/geographic/geographic-capability.ts`. If importing it into `lib` breaks layering, move it to `lib/twin`.
   - Tests in `map-region-recommendation.test.ts` cover: covered by `us-texas`, partly covered, two regions, no locations, and a point with no region.
2. `apps/web/lib/twin/map-region-recommendation.server.ts` loads the points from three sources:
   - placed customer-site and work-location `Address` rows through `City → Region → Country`;
   - the organization point;
   - the region and country from `OrgAddress`.
3. `apps/web/app/api/map-assets/recommendation/route.ts`: `GET`, requires `manage_platform`.
4. The "Street maps" line in `apps/web/components/customer/map/GeocodingAdminPanel.tsx` follows the theme runbook: semantic tokens only.

**Phase 2 verification**
- **Unit tests:** the cases above, plus the route's permission refusal.
- **Runtime:** on the contributor preview against an installed pack, the panel shows the covered or not-covered line. The Texas pack is installed in the dev portal.

## Phase 3: confirm a site at check-in (`BI-BA53C1A8`)

1. `apps/web/lib/api/work-item-site-resolution.ts`: `resolveWorkItemSites({ sourceType, sourceId })` reuses `resolveWorkItemAccount`. It returns the account's active, unmerged sites with `hasLocation` and `locationConfirmed`, the latter from `locationProvenance`. Tests are included.
2. `apps/web/app/api/v1/work-items/[itemId]/sites/route.ts`: `GET`, with the same `loadAssigned` check as the `PATCH` handler.
3. `apps/web/app/api/v1/customer-sites/[siteId]/location/device-confirmation/route.ts`: `POST` with the checks from design §2.2 item 4.
   - **Write:** `address.updateMany` with `replaceableByDeviceWhere()`, coordinates rounded to 5 decimal places, `validationSource: "device-confirmed"`.
   - **Audit:** an entry through the existing audit helper the plan step selects from `apps/web/lib` after a code-graph check. The entry records who, which site, which job and when. It never records the raw fix or the accuracy beyond the stored point.
   - **Tests:** every refusal code and success.
4. `packages/api-client/src/endpoints/work-items.ts` gains `sites(itemId)`. `packages/api-client/src/endpoints/customer-sites.ts`, new or extended, gains `confirmLocation(siteId, body)`. Types go in `packages/types`.
5. `apps/mobile/src/hooks/useGeolocation.ts` gains:
   - a `{ auto?: boolean }` option, default `true` so Nearby is unchanged;
   - an exported `takeOneFix({ accuracy })` that returns `{ latitude, longitude, accuracyMeters }`, `denied` or `unavailable`.
6. `apps/mobile/src/features/jobs/site-location.ts`, pure, plus `jobs.store.ts` changes:
   - after `updateStatus(..., "in-progress")` succeeds, fetch sites;
   - decide whether to offer: one site that needs confirmation, or a choice between several;
   - keep the "Not now" memory in `secure-store`/async storage for 30 days, keyed by site;
   - handle the far-from-address retry.
7. `apps/mobile/app/(tabs)/jobs/[itemId]/index.tsx`: the offer sheet, using the design's wording and the theme tokens from `useTheme`.
8. A guard test asserts that `apps/mobile/app.json` declares no background location mode and that `apps/mobile/package.json` has no `expo-task-manager`.

**Phase 3 verification**
- **Unit tests:**
  - resolver and route tests;
  - jobs store tests: no fix before the tap, offer rules, "Not now", far-from-address;
  - the guard test.
- **Package checks:** typecheck of `apps/web`, `apps/mobile` and `packages/*`.
- **Runtime:**
  - the route on the contributor preview with a seeded preview job;
  - the phone flow in the iOS simulator against the preview, with a simulated location.

## Cross-cutting obligations

- **Theme:** the theme-aware styling runbook applies to the panel line and the phone sheet.
- **No schema change:** there is no migration. The data-impact check still runs for the new `OrgAddress` JSON keys, and the new `validationSource` value is recorded in `field-classification.ts` if `Address.latitude` is classified there.
- **Documentation:** each phase updates the user-guide pages listed in the design §8.
- **Build gate:**
  - affected unit tests and package typecheck, run locally;
  - the production build through the governed shared runtime, never a hand-built live image.

## Risks and rollback

- **Provider load from a burst of saves, such as an import.** Concurrency 1 plus the provider interval caps the rate. An import of N sites queues N jobs.
  - **Rollback:** set the provider to `none`. Queued jobs then exit without a call.
- **Org address serialization dropping coordinates wrongly.** This is covered by tests.
  - **Rollback:** revert phase 1. Any stored coordinates are inert extra JSON keys.
- **Device confirmation storing a wrong point,** for example a staff member who is not actually at the site. Mitigations: the 1,000 m question, the 50 m accuracy floor, and an audit entry naming the person.
  - **Correction:** `placeCustomerSiteOnMapAction` is a deliberate person action and already writes unconditionally. Today the map offers it only for unplaced sites, so re-placing a confirmed site is not in this plan. It is noted in the phase 3 PR as a follow-up if acceptance finds it needed.
- **Rollback by phase:** each phase is its own PR and can be reverted alone. Phases 2 and 3 depend only on modules phase 1 adds.

## Backlog coverage

To be recorded with `record_plan_backlog_coverage` after spec approval mints the scope baseline. Mapping:

| Deliverable | Backlog item |
|---|---|
| Geocode on save, provenance, shared geofence | `BI-CAA04C84` |
| Region recommendation | `BI-8C76920D` |
| Confirm a site at check-in | `BI-BA53C1A8` |
| Fetching packs, follow-up outside this plan | `BI-43BBCC26` |
