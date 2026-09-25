---
status: draft
---

# Geographic footprint, coverage and live overlays — amendment to Spatial Operational Views

| Field | Value |
|-------|-------|
| **Status** | Draft — research complete; decisions recorded 2026-09-23 with WWMD evidence, two open (§9) |
| **Created** | 2026-09-23 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Amends** | [2026-07-21 Spatial Operational Views](./2026-07-21-spatial-operational-views-design.md) — does not supersede it |
| **Builds on** | `BI-3A56AE0C` (territory map substrate, contracts merged PR #4361) · [territory map substrate plan](../plans/2026-08-01-territory-map-substrate.md) · `DI-63D94E36B0B0` (managed region pack) · [field dispatch ADR-9](./2026-06-13-field-dispatch-capability-design.md) (provider-swappable geocoding/routing) |
| **Unblocks** | `BI-FE286C27` (HOA cockpit) · `BI-A951CC46` (field dispatch surface) · `BI-3391BE2C` (equipment yard) · `BI-F91D0685` (ward board map) · MSP §16.1 "Site Location And Mapping" ([MSP archetype spec](./2026-04-23-it-service-provider-msp-archetype-design.md)) · `customer-site-map` ([customer surface activation](./2026-05-22-customer-surface-archetype-activation-design.md)) |

## 1. Why this amendment exists

The operator asked for a shared mapping capability across archetypes, naming three uses:

1. **Market footprint (software-platform archetype, i.e. DPF itself):** a world/country view of where the platform is deployed, where customers are, and which markets are targeted, so the business can visit, support and sell. The platform is English-only, so market scope is a real constraint worth seeing.
2. **Coverage (MSP / field service):** service areas and territory coverage for the people who travel to customer sites.
3. **Community layout (HOA / property):** lots, homes, common areas and amenities, with inspection findings and maintenance work pinned in place so subcontractors know exactly where to go.

It also asked for real-time data overlays and third-party integrations where they help.

The 2026-07-21 spec already settles the engine and most of the architecture. This amendment does **not** reopen it. It records what the 2026-09-23 survey found built versus designed, and it adds the three uses the parent spec does not cover.

## 2. What exists today (verified 2026-09-23 against `main` and the live DB)

| Layer | State | Evidence |
|---|---|---|
| Engine decision | **Settled.** MapLibre GL JS + Protomaps PMTiles for geographic scenes; React Flow for cartesian (floor/site plan) and node-graph scenes; no second canvas engine. | parent spec §3–4 |
| Tile distribution | **Settled.** Install-managed, signed region pack in a persistent volume, served locally by range requests; no runtime outbound tile calls. | `DI-63D94E36B0B0`, territory plan "Architecture decision" |
| Scene contract | **Built.** `GeographicSceneLayout` → GeoJSON projection, bounds, validation; PMTiles pack manifest; byte-range helper. Pure code, no UI. | `apps/web/lib/twin/geographic-scene.ts`, `map-pack-manifest.ts`, `map-asset-range.ts`; `packages/storefront-templates/src/scene-layout.ts:151` |
| Scene persistence | **Built.** `OperationalSceneLayout` (`spaceKind`, `layoutState`, `underlayRef`). | `verticals-storefront.prisma:80` |
| Cartesian renderer | **Built.** React Flow scene canvas. | `apps/web/components/twin/cartesian/CartesianSceneCanvas.tsx` |
| **Geographic renderer** | **Not built.** No `maplibre-gl` or `pmtiles` in any `package.json`; no map-asset route; `geo-map` / `customer-map` primitive keys registered but nothing renders them. | `apps/web/lib/workspace-home/types.ts:24,42,72` |
| Dependency gate | **Not run in this install.** The tool evaluations the territory plan cites do not resolve; `ToolEvaluation` has no MapLibre / PMTiles / geocoder rows. | live DB query, 2026-09-23 |
| Archetype → map routing | **Built.** `deriveTwinProfile` sends HOA, trades, field-dispatch, agriculture and construction archetypes to TERRITORY; `territoryVariant` picks fleet / posts / unit-portfolio / job-sites. `software-platform` maps to the non-spatial TENANTS board. | `packages/storefront-templates/src/twin-profile.ts:174,328,367–453` |
| Location data | **Schema yes, data no.** `Address.latitude/longitude` exist; 0 of 1 addresses in this install carry coordinates. `Country` has 250 ISO rows with `iso2/iso3/numericCode`. `CustomerAccount` has **no** address or country — location reaches an account only through `CustomerSite → Address`. | `mdm-reference.prisma:63–152`, `crm-commerce.prisma:52,158` |
| Market scope | **Captured, unplotted.** `BusinessContext.operatesIn / sellsTo / employsIn / dataResidency` are country-code arrays (`{us}` here); `MarketingStrategy.serviceTerritories` is JSON; `PartnerProgramEnrollment.territory` is free text. | `core-identity.prisma:632–643`, `marketing.prisma` |
| Install footprint | **Absent.** No install registry records location. `FederationLink` knows peers but no geography; the hive spec explicitly rejects telemetry-style push. | `edge-federation.prisma:379`; hive spec :108 |
| Geocoding | **Partly live.** Nominatim is called from site-address validation; the general validator is a stub. | `apps/web/lib/shared/site-address-validation.ts:153`, `address-validation.ts:12–39` |
| Spatial SQL | **Absent.** No PostGIS anywhere; distance is haversine in TypeScript. | `apps/web/lib/api/nearby-geo.ts`; `docker/postgres/Dockerfile` |
| CSP | **Absent app-wide**, so the "no outbound map request" rule is currently unenforced by the browser. | `apps/web/next.config.mjs` |

**Verdict:** the gap is one renderer plus three compositions over it. No new geography model, no second map engine, no parallel customer-location table.

## 3. The three uses as compositions over one renderer

All three consume `GeographicSceneLayout` (or, for plans, the cartesian `SceneLayout`) and supply an accessible list at parity, per the `BI-3A56AE0C` contract. None instantiates MapLibre directly.

### 3.1 Market footprint — `software-platform` and any archetype that sells beyond one locality

- **Geometry:** a world **country layer drawn as GeoJSON** (Natural Earth, public domain), joined on ISO 3166-1. The world view needs **no tile pack**, so it works on every install from day one, including installs that never import a region pack. Region packs add street detail only when the operator zooms into a market.
- **Layers, each a count per country with drill-down to the list:**
  - *Target markets* — `BusinessContext.sellsTo ∪ operatesIn`, and `MarketingStrategy.serviceTerritories`.
  - *Customers* — `CustomerAccount` counted by the country of its sites' addresses. Accounts with no site are shown as an explicit **"unplaced: N"** figure, never silently dropped.
  - *Language fit* — countries outside the platform's supported locales are shaded as a distinct state, so "English-only" is visible as a market constraint.
  - *Deployments* — see §3.1.1.
- **Twin placement:** a new `footprint` variant rendered alongside the TENANTS board rather than a change to `chooseTemplate`. The world view is additive to the board, not a replacement for it.

#### 3.1.1 Deployment footprint needs a source that does not exist yet

There is no honest source today. Options, in recommended order:

1. **CRM-derived (no new data flow).** An install is a fulfilled product for a `CustomerAccount`; its location is the account's primary site. Works now for installs DPF sells directly; blind to self-installed open-source users.
2. **Consented, coarse self-declaration over federation.** An install that federates may choose to share **country only** (ISO 3166-1, never coordinates) as an allow-listed field in its federation projection. Opt-in, revocable, consistent with the hive spec's rejection of automatic telemetry.
3. Automatic phone-home telemetry. **Rejected:** contradicts the hive spec's egress posture.

### 3.2 Coverage — MSP and field service

- **Service areas are drawn polygons** stored as `GeographicSceneLayout` zones (already supported). Drive-time isochrones are an **optional** fill for the same zone, produced by a routing provider behind ADR-9, never a requirement.
- **Questions the view answers:** which customer sites fall outside every service area; which technician covers a site; where coverage overlaps.
- **Point-in-polygon without PostGIS for v1.** A tenant has tens of polygons and hundreds to low thousands of sites; a pure TypeScript ray-cast in `lib/twin/` is sufficient and adds no dependency. PostGIS is deferred until a measured need appears (KNN over large fleets, parcel-scale polygons); adopting it is its own tool evaluation, because it changes the digest-pinned Postgres image.
- **Technician live position** is opt-in per shift, only while on a job, role-gated, with retention bounds. See §6.

### 3.3 Community layout — HOA / condo / property management

A drawn layout is what the HOA plan's hierarchy-and-list first slice does not yet provide. Two paths, chosen by what the association has:

- **Geocoded lot points (default for homes).** Each lot is one point on the geographic map, geocoded from its address and nudged by hand where the geocoder is off. Drive-by inspection (§3.3.2) needs real-world position so the inspector's phone can show which home it is passing, and one point per lot is enough: an incumbent HOA product works this way, with no parcel polygons. *Revised 2026-09-25 from operator evidence; WWMD `geocoded-points-plus-siteplan`, high confidence, margin 0.35.*
- **Site-plan image (for common areas and boundaries).** Upload the plat or site plan as the `underlayRef` and draw common areas, amenities, lawn zones and pond boundaries on it with the **cartesian** (React Flow) renderer. This needs no geocoding and no parcel purchase, and it still suits communities without reliable address data.
- **Parcel polygons (optional).** Import county parcel GeoJSON or a shapefile when lot boundaries matter, or pin the site plan's four corners so MapLibre draws it as an image source.
- **Pinned work:** inspection findings, violations and maintenance work orders attach to a placement's `entityRef` (lot, common asset), so a subcontractor's view is "this lot, this spot, this photo". A placement references the work; it does not own it.

#### 3.3.1 The map is where, not the workflow

Added 2026-09-23 from operator direction. Most HOA work is a list, a schedule or a case, and the map earns its place only when someone must be told *where* or *within what boundary*. So for every HOA flow below, the primary surface is the list or case, and the map appears as:

- a **location attachment** on the case (a pin, or a boundary drawn on the community layout);
- a **shareable snapshot** of that location sent with the work to a vendor or inspector;
- a **duplicate check** on public reports ("3 open reports within 30 m").

It never appears as a standing dashboard that must be watched.

#### 3.3.2 Violation inspections

The people involved are inspectors, who may be staff, board volunteers or a contracted inspection firm (the `field-inspection` archetype, `BI-E25B803C`), plus the board and the homeowner.

- **Flow.** Inspection round → finding (lot, rule cited, photo, note) → notice to homeowner → cure deadline → re-inspection → resolved, or escalated (fine or hearing). This is a Work Case in the HOA plan's `violation` / `inspection` categories, **not a new model**. The rule citation points at the association's governing documents.
- **On the phone.** The inspector walks a round of lots in order, and each finding is captured in place. Photo and location capture depends on `EP-528CF32A` (camera, signature and location fields in mobile dynamic forms). The mobile photo seam is a stub today (`apps/mobile/src/features/job-evidence/imageSource.ts`). Rounds must work offline and sync later, because communities have dead spots.
- **Re-inspection** is a scheduled follow-up on the same case at the cure deadline, not a fresh finding.
- **Map role:** this is the archetype's most important map. The inspector drives the community with the phone following their GPS position, and every home shows its standing at a glance.

**Incumbent benchmark (operator screenshots, 2026-09-25).** The details are generic, because the screenshots show a real community and are not stored:

- a street basemap with one house icon per lot at a geocoded point, labelled by house number;
- a status colour per home (four colours, some two-toned), with extra markers for documents and a letter code;
- phone controls: Tracking (GPS follow-me), Recenter, Legend, Filter and a compass;
- tap a home to see its violation history.

Zoomed out, its labels pile up unreadably.

**DPF adopts:**

- geocoded points per lot;
- follow-me tracking;
- filter and legend;
- tap-through to the lot's case history.

**DPF improves on:**

- *Accessibility:* status carries colour **plus** a letter or shape, because colour alone fails WCAG. States map to the Work Case: open violation, in cure period, re-inspection due, escalated, clear.
- *Density:* clustering and label collision at low zoom.
- *Offline:* the community's region pack lives on the phone.

**DPF rejects** a vendor basemap (the incumbent uses Apple Maps).

- **Phone renderer.** The inspection runs in the Expo app, which the web renderer (`BI-814F86E1`) does not reach. Native `@maplibre/maplibre-react-native` uses the same style spec and the same PMTiles region pack (WWMD 2026-09-25, high confidence, margin 0.59; tool evaluation required). It is tracked as `BI-3DAE2169`.
- **Care:** a violation is a dispute between neighbours. Findings, photos and the reporter's identity are visible to the board and the manager, never to other residents. A public report that becomes a violation does not expose its reporter to the homeowner.

#### 3.3.3 Maintenance reports from residents and the public

- **Intake.** Reuse the civic 311 pattern: the municipality archetype already runs a service-request queue over `StorefrontInquiry` behind the `service-request-311` capability (`apps/web/app/(shell)/service-requests/page.tsx`), with **no new model**. The HOA `Maintenance Request` item template is the same shape, but today it captures only free text: no location and no photo.
- **Additions:**
  - an optional **pin on the community layout** ("where is the problem"), or the phone's location, reduced to the nearest common asset or lot rather than stored as a raw coordinate;
  - an optional photo;
  - a public reference number for status follow-up.
- **Phone app.** The mobile app already has an anonymous, geo-aware `visitor` surface and a multi-business `spaces` connection. A resident joins their community as a space, and a passer-by can report without an account, following the walk-up pattern (`BI-9FEB61B8`). Anonymous reports need rate limiting and abuse controls.
- **Duplicates.** Before a report is filed, open reports near the same spot are offered for "+1", which turns five reports of one broken light into one case with five reporters.
- **Triage:** a report becomes a maintenance case, or (if it describes a homeowner's lot) a candidate violation for the inspector. It never becomes a violation automatically.

#### 3.3.4 Recurring maintenance of common areas and trees

- **What gets maintained:** trees, lawn and landscape zones, pools, ponds, playgrounds, lighting, gates, fences, irrigation. Each is a **maintained feature** on the community layout:
  - a **point** for a tree, light or gate;
  - a **boundary** for a lawn zone, pool enclosure or pond.
- **Recurrence reuses `RecurrenceSchedule`** (RFC 5545 RRULE, the platform's one recurrence primitive; see `ai-coworker.prisma:135` and its canonical-primitive note). Examples: trim yearly in the dormant season; mow weekly in season; pool chemistry twice weekly and inspection annually. Each occurrence materializes a work item for the assigned vendor. No parallel scheduler.
- **Why boundaries matter:** a lawn contract covers a drawn area, so the vendor knows exactly what is and is not in scope, and a dispute about "you missed the strip by the entrance" has an answer. The boundary travels with the work order as a snapshot. How the vendor opens it (expiring link or portal account) is open in §9.
- **Substrate gap:** there is no maintained-asset record. `FixedAsset` is a finance record, and `Resource` is bookable capacity (the pool is already a bookable amenity through `Resource`). Before proposing anything new, check whether a common-area feature can be a `Resource` / `CustomerSiteNode` with maintenance attributes, versus a new typed record. This is `dpf-verify-substrate-first` work and is not decided here.
- **Tree specifics:** species, size, last trimmed, next due, and an arborist note are attributes, not map layers. The map shows only where the tree is.

## 4. Real-time and third-party overlays

**Rule:** every external feed is fetched **server-side**, cached, normalized to GeoJSON, and pushed to the browser over the existing event bus. The browser never calls a third party. This keeps the parent spec's no-outbound-request guarantee, centralizes rate limits and attribution, and lets an install run with every feed off.

Each feed is an **opt-in connector** on the planned integration substrate (`EP-E93736C6`) and connections cockpit (`BI-2A0180A9`), not map code.

| Rank | Feed | Use | Terms |
|---|---|---|---|
| 1 | NWS / NOAA alerts (US) | Weather warnings over service areas and communities; dispatch and inspection holds | Public-domain federal data, no key, User-Agent required ([docs](https://www.weather.gov/documentation/services-web-api)) |
| 2 | USGS earthquakes | Post-event inspection triggers | Public GeoJSON feed ([feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)); public-domain status assumed, not confirmed on page |
| 3 | GDACS | Global disaster awareness for the market-footprint view | Free GeoJSON API, attribution requested ([quickstart](https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v2.pdf)); commercial terms unconfirmed |
| 4 | Open-Meteo | Forecast weather | Free tier is **non-commercial**; commercial use needs a paid plan or the self-hosted server ([pricing](https://open-meteo.com/en/pricing)) |
| 5 | TomTom traffic | Live traffic for dispatch | Commercial, operator-keyed only ([pricing](https://docs.tomtom.com/pricing)) |
| — | RainViewer | Radar | **Avoid**: free tier is non-commercial and zoom-capped from 2026-01-01 |

Internal live data (work-order status, technician position, occupancy) is already event-bus data; it reaches the map as GeoJSON source updates keyed on stable feature ids (`promoteId` + feature-state), not re-renders.

## 5. Research & Benchmarking

| Product | What it does | DPF adopts / rejects |
|---|---|---|
| **Odoo** Field Service | Itinerary map needs a Mapbox token; the community backfills with Leaflet/OSM ([docs](https://www.odoo.com/documentation/18.0/applications/services/field_service/planning_itinerary.html)) | **Reject** vendor-token mapping; it is the failure mode "fully local by choice" exists to avoid |
| **Frappe / ERPNext** | Geolocation field stores GeoJSON; Leaflet map view appears automatically for location-bearing doctypes ([docs](https://docs.frappe.io/erpnext/user/manual/en/geolocation-field)) | **Adopt** the idea that any location-bearing record gets a map view for free (the `customer-map` primitive); **reject** Leaflet (raster-only; react-leaflet is licensed Hippocratic-2.1, which is not OSI open source — [LICENSE](https://github.com/PaulLeCam/react-leaflet/blob/master/LICENSE.md)) |
| **SuiteCRM** | Bundled Google Maps module; cron geocoding cached in custom fields ([docs](https://docs.suitecrm.com/admin/administration-panel/google-maps/)) | **Adopt** batch geocode-and-cache; **reject** Google, whose terms allow caching coordinates for only 30 days ([policy](https://developers.google.com/maps/documentation/geocoding/policies)) |
| **Traccar** | MapLibre, switchable basemaps, weather/traffic overlays ([DeepWiki](https://deepwiki.com/traccar/traccar-web/3-map-system)) | **Adopt** overlays as switchable layers over one engine |
| **Grafana Geomap** | Chose OpenLayers over Leaflet for robustness; accepts a MapLibre style as a basemap ([PR #36188](https://github.com/grafana/grafana/pull/36188)) | **Confirms** MapLibre-style compatibility is the convergence point |

Engine comparison (sizes measured from npm tarballs on 2026-09-23): MapLibre GL JS 6.11.1, BSD-3, ~302 KB gzip, WebGL2-only, ESM-only since v6.0 (2026-07-22) · Leaflet 1.9.4, BSD-2, ~42 KB, raster-only · OpenLayers 10.10, BSD-2, ~290 KB · Mapbox GL ≥2 proprietary, billed per load. **The parent spec's MapLibre choice stands.** Two new facts:

- **v6 is ESM-only and loads its worker from a URL.** The renderer must be a client-only dynamic import, and the worker is a static asset the eventual CSP must allow. The territory plan pinned 6.1.0; re-pin at evaluation time.
- **`@vis.gl/react-maplibre` (MIT)** is a thin React binding. Evaluate it against a ~100-line in-house wrapper; per "absorb, don't adopt", the wrapper wins unless the binding retires real code.

Standards: GeoJSON RFC 7946 (WGS84, lon-lat order) · EPSG:4326 storage / EPSG:3857 display · ISO 3166-1 alpha-2 in the data, numeric for the world-atlas join (`Country.numericCode` already holds it) · ISO 3166-2 for subdivisions · PMTiles v3 · MapLibre Style Spec · BCP 47 for label language · OGC API – Features Parts 1–3 if an external feature endpoint is ever exposed.

Geocoding stays behind ADR-9, defaulting to **no provider** (manual pin). Candidate adapters: US Census (free, US-only, batch 10k), OpenCage (results may be stored permanently), and self-hosted Nominatim or Photon. The Mapbox and Google geocoders are excluded because their storage terms conflict with keeping coordinates in our database.

## 6. Privacy

- Technician position is employee data. Under GDPR, consent is generally not a valid basis in employment; the basis is legitimate interest with a DPIA (source: [Irish DPC note](https://www.dataprotection.ie/sites/default/files/uploads/2020-09/Employer%20Vehicle%20Tracking_May2020.pdf)). The existing `DriverLocationConsent` model is the anchor: extend it, do not add a parallel one.
- **Defaults (design inference, not sourced):** off unless on shift and on a job; no off-hours or break tracking; configurable retention (30–90 days); role-gated live view.
- **Precision reduction:** customer- or public-facing and aggregate views round coordinates (2–3 decimals) or aggregate to country or region. The market-footprint view is country-level by construction.

## 7. Phasing

Each phase is independently shippable, and P0 is the dependency every other phase and every blocked vertical waits on.

| Phase | Deliverable | Notes |
|---|---|---|
| **P0** | Tool evaluations (MapLibre, PMTiles, and the React binding against an in-house wrapper) → geographic renderer + local map-asset route, exactly as the territory plan §1–5 specifies | Already planned; this is the critical path. Includes the CSP entry for the worker URL. |
| **P1** | World country layer (vendored Natural Earth GeoJSON) + market-footprint composition: target markets, customers by country with the "unplaced" figure, language-fit shading, CRM-derived deployments | No tile pack required. Dogfoods on DPF's own install. |
| **P2** | `customer-map` primitive (List/Map on the customer list) + batch geocode-and-cache through ADR-9 with the "none" default | Satisfies the customer-surface spec and MSP §16.1 |
| **P3** | Coverage: service-area zones, pure-TS point-in-polygon, "sites outside coverage" | Isochrones optional via a routing connector |
| **P4** | HOA community layout on the cartesian renderer with site-plan underlay; work and inspections pinned to lots and common assets | Lands inside `BI-FE286C27` rather than as a parallel item |
| **P4a** | Resident/public maintenance reports: 311-pattern intake with pin, photo, reference number and near-duplicate "+1"; phone intake via `spaces` / `visitor` | Web first; phone photo depends on `EP-528CF32A` |
| **P0m** | Phone map renderer: native MapLibre, GPS follow-me, offline region pack, per-lot status markers | `BI-3DAE2169`; tool evaluation first |
| **P4b** | Violation inspection rounds: drive-by map of lots with standing at a glance, in-place finding capture, notice → cure → re-inspection on one case, offline sync | Depends on P0m, P2 and `EP-528CF32A` |
| **P4c** | Recurring common-area and tree maintenance: maintained features with point or boundary, `RecurrenceSchedule`-driven work, boundary snapshot sent to vendors | Substrate decision (§3.3.4) comes first |
| **P5** | Server-side overlay connectors, NWS alerts first | On the integration substrate |
| **P6** | Consented country-only deployment declaration over federation | Decided 2026-09-23 (§9); follows P1 |

## 8. Non-goals

- A second map engine, a map-specific persistence model, or per-archetype renderers.
- PostGIS in v1 (§3.2).
- Bundling a routing engine or a planet-scale geocoder in the default install.
- Browser-side calls to any third-party tile, geocode or data service.
- Automatic install telemetry.

## 9. Decisions

Platform-direction choices were scored with WWMD `principle_decide` on 2026-09-23 (`platform-development`, stakes `routine`). The operator answers the calls WWMD leaves uncertain or that belong to the org's own business (WWWD).

| Decision | Outcome | Basis |
|---|---|---|
| Market footprint placement (§3.1) | `footprint` variant beside the TENANTS board | WWMD, high confidence, margin 2.67 |
| First overlay connector (§4) | NWS alerts | WWMD, high confidence, margin 0.99 |
| Backlog home | Create `EP-SPATIAL-OPERATIONAL-VIEWS` (done 2026-09-23) | WWMD, high confidence, margin 7.33 |
| HOA layout default (§3.3) | Geocoded point per lot for homes; site plan for common areas and boundaries | Revised 2026-09-25: the operator's incumbent evidence showed inspection needs real-world position. WWMD, high confidence, margin 0.35. Supersedes the 2026-09-23 site-plan-first answer |
| Phone map renderer (§3.3.2) | Native MapLibre React Native | WWMD 2026-09-25, high confidence, margin 0.59 |
| Deployment-footprint source (§3.1.1) | CRM first, then opt-in country-only federation | Operator; WWMD uncertain (margin 0.02), a human call |
| Who may file public reports (§3.3.3) | **An org-level (WWWD) setting**; platform default **open** | Operator chose "anyone, rate-limited"; WWMD leaned residents-only on a thin margin (0.20) |
| Vendor access (§3.3.4) | **Open** | Operator chose signed expiring link; WWMD leaned portal accounts on a thin margin (0.33) |

WWMD's margins on the last two are narrow, and the principles it cites for them are only loosely related. Both remain with the operator.

## 10. Backlog

Epic `EP-SPATIAL-OPERATIONAL-VIEWS`, created 2026-09-23:

| Phase | Item |
|---|---|
| P0 geographic renderer | `BI-814F86E1` |
| P0m phone map renderer | `BI-3DAE2169` |
| P1 market footprint | `BI-4EC1D572` |
| P2 customer-map + geocoding | `BI-560128FB` |
| P3 coverage | `BI-6CC10E4C` |
| P4 HOA layout | inside `BI-FE286C27` |
| P4a public reports | `BI-246AC135` |
| P4b violation inspections | `BI-1B3DED34` |
| P4c recurring maintenance | `BI-3DA6E1A0` |
| P5 NWS alerts connector | `BI-DC264802` |
| P6 country-only federation | `BI-06EA3167` |
| Nominatim policy compliance | `BI-3099EACD` |

Existing spatial items (`BI-3A56AE0C`, `BI-FE286C27`, `BI-A951CC46`, `BI-3391BE2C`, `BI-F91D0685`) still need linking to this epic. The MCP `update_backlog_item` tool exposes no `epicId` field, so that link cannot be made through the governed surface today.

## 11. Findings to route separately

- **Nominatim usage policy** (filed as `BI-3099EACD`). The public server allows at most 1 request/second, requires caching, forbids client-side autocomplete and requires an identifying User-Agent ([policy](https://operations.osmfoundation.org/policies/nominatim/)). `site-address-validation.ts:153` calls it live; compliance has not been checked.
- **Stale plan anchors.** The territory plan's tool-evaluation IDs and the downstream items named in its "Backlog coverage" section do not resolve in this install; `BI-3A56AE0C` already records the rebinding.
