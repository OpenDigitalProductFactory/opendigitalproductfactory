# TERRITORY map substrate implementation plan

**Backlog:** `BI-3A56AE0C`  
**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`  
**Downstream:** the vertical cockpits that consume this renderer — HOA/property, equipment yard, HVAC field service — tracked under the recovered-cohort item `BI-D3EFD80C`.  
**Distribution decision:** `DI-63D94E36B0B0` (`managed-region-pack`, high confidence)  
**Coverage receipt:** `cmsvc6gcv0aa001prb5kpy1pk` (`atomic`)

> **Coverage rebinding (2026-08-16).** The original anchors — `BI-3B07C332` with downstream `BI-8D9A2DE5`, `BI-49036A4F`, `BI-76C1B949`, and receipt `cmsahfmd800lv01qkgxfx0cqr` — do not resolve in this install, so the plan could not pass `check_plan_backlog_coverage`. Rebound to `BI-3A56AE0C`. Recorded `atomic`: the three modules are one indivisible contract rather than phases, because a consumer cannot render anything with only a subset of scene layout, asset range and pack manifest.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Deliver the reusable, domain-neutral geographic renderer that makes a TERRITORY operational twin possible without requiring a cloud map account. The renderer consumes the existing `GeographicSceneLayout`; MapLibre renders a locally served PMTiles basemap plus typed GeoJSON overlays; every install reports whether it is operating in `schematic`, `geocoded`, or `optimized` mode; and loss of WebGL, the region pack, or network connectivity never removes the accessible operational workflow.

This BI does not implement HVAC dispatch, HOA priorities, route optimization, geocoding, or a new business-data model. Those remain downstream compositions over this substrate.

## Evidence and standards

- The approved spatial design already selects MapLibre GL JS and PMTiles: `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md`.
- Current registry evidence on 2026-08-01 identifies `maplibre-gl@6.1.0` (BSD-3-Clause, ESM-only, about 18.9 MB unpacked) and `pmtiles@4.4.1` (BSD-3-Clause, one runtime dependency, about 371 KB unpacked). Adoption remains gated by Tool Evaluations `cmsahdvye00k001qkwhk1bcks` and `cmsahdvzy00k401qk7ly9uu3n`.
- `map-gl-offline@0.8.8` is an optional cache candidate, not an assumed dependency. Its broader SQL.js/Turf/i18n dependency graph is under Tool Evaluation `cmsahfcbf00lj01qkuvtvar72`. If it is not approved or does not materially beat the local-region design, do not add it.
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) is a browser WebGL renderer; v6 uses an ESM worker URL and supports native GeoJSON point, line, polygon, fill, symbol, and heatmap layers.
- [PMTiles](https://docs.protomaps.com/pmtiles/) is a single-file archive format whose browser reader fetches metadata and tiles with HTTP Range requests. The official MapLibre integration uses `addProtocol` and the `pmtiles` package.
- HTTP delivery follows RFC 9110 range semantics: valid byte ranges return `206` plus `Content-Range`; unsatisfiable ranges return `416`; immutable packs carry an ETag and `Accept-Ranges: bytes`.
- WCAG 2.2 AA applies to controls, focus, contrast, and non-color status. A map is an enhancement, never the only representation of a job, person, route, or exception.

## Substrate verification

- `packages/storefront-templates/src/scene-layout.ts` already owns geographic viewport, point, line-string, polygon, zone, placement, and entity-reference contracts.
- `OperationalSceneLayout` already persists renderer-neutral geometry; no new scene table or map-specific persistence model is needed.
- `Address.latitude` / `Address.longitude`, `CustomerSite`, address-validation confidence helpers, and `FieldDispatchProfile.routeMode` already own location and capability truth.
- `apps/web/lib/workspace-home/types.ts` and profiles already register `geo-map` / `customer-map`; the missing element is an implementation, not another primitive key.
- `apps/web/lib/api/nearby-geo.ts` already owns bounded coordinate validation and haversine distance math.
- No MapLibre or PMTiles dependency, renderer, related open PR, or recent main-branch implementation exists as of pickup.

**Verdict:** extend the existing geographic scene and dispatch capability contracts. Do not add a parallel geography model, route-mode enum, customer location table, or archetype-specific map renderer.

## Architecture decision

The 2026-07-21 design left PMTiles distribution open. Three options were evaluated through the platform kernel:

| Option | Result |
| --- | --- |
| Bake a locale archive into every portal image | Rejected: local, but makes routine builds, transfers, rollbacks, and upgrades multi-gigabyte. |
| Install-managed signed region pack | **Selected:** one versioned archive in a persistent map-data volume, fetched or imported once, checksum verified, served locally. |
| Remote-first archive plus browser cache | Rejected as the default: fastest initially, but normal operations inherit WAN and tile-host availability. |

`DI-63D94E36B0B0` recommends the managed region pack with high confidence (composite 4.514, margin 2.817); strongest contributors were **Ship Real Functionality** and **Optimize for the Whole**; no commandment conflict fired.

The portal image carries renderer code, a small no-basemap schematic style, and the asset-manifest contract. Region packs remain outside Git and outside the image in a persistent, install-managed location. The normal renderer reads only the local portal endpoint. Remote URLs are import sources, never an undeclared runtime dependency.

## Delivery sequence

### 1. Close the dependency gate

- Wait for the three Tool Evaluation results; adopt only approved or explicitly conditional versions.
- The dependency-free pure geographic adapter in phase 2 and manifest/range contracts in phase 3 may proceed while evaluations run; no package, renderer import, archive-format integration, or external-tool integration may land before approval.
- Pin exact versions in `apps/web/package.json`, `pnpm-lock.yaml`, and `packages/db/data/approved_tools_registry.json` with evidence IDs and re-evaluation dates.
- Prefer only `maplibre-gl` and `pmtiles`. Add `map-gl-offline` only if the evaluation and a measured sandbox comparison prove its storage and dependency cost worthwhile.
- Record package integrity, license, transitive dependency count, ESM/SSR behavior, CSP/worker requirements, bundle delta, removal smoke test, and CVE scan.

Verification: approved-tool guard, lockfile integrity, production build, and a clean uninstall/reinstall smoke test in the governed sandbox.

### 2. Extract the reusable geographic presentation contract (refactoring allocation)

Create a pure adapter under `apps/web/lib/twin/geographic-scene.ts` that:

- validates longitude/latitude bounds and rejects non-finite coordinates;
- converts `GeographicSceneLayout` into stable GeoJSON feature collections grouped by point, line, polygon, and zone;
- preserves `SceneEntityRef`, labels, selection state, and domain-neutral presentation tokens without importing HVAC or HOA vocabulary;
- returns explicit capability and failure facts (`renderer-ready`, `webgl-unavailable`, `region-pack-missing`, `region-out-of-coverage`);
- clamps and derives a bounded initial viewport without mutating authored scene geometry.

This shared contract and its tests receive at least 20% of the implementation/refactoring effort. MapLibre components, accessible lists, later HVAC/HOA projections, and test fixtures all consume it instead of translating scene data independently.

Likely files:

- `apps/web/lib/twin/geographic-scene.ts`
- `apps/web/lib/twin/geographic-scene.test.ts`
- minimal additive types in `packages/storefront-templates/src/scene-layout.ts` only if a proven renderer-neutral gap remains

Verification: property/boundary tests for invalid coordinates, antimeridian-safe bounds, empty scenes, stable feature IDs, selection, and geometry parity.

### 3. Implement local region-pack governance and HTTP range delivery

Define a small versioned manifest contract containing pack ID, locale/region, bounding box, source and attribution, archive version, byte length, SHA-256, PMTiles spec version, created time, and minimum/maximum zoom. The filesystem asset remains in an ignored persistent map-data volume; the manifest is the only source of delivery truth.

Add a narrowly scoped route such as `apps/web/app/api/map-assets/[packId]/route.ts` backed by `apps/web/lib/twin/map-assets.server.ts`:

- authorize the current organization/install before revealing configured assets;
- resolve only allowlisted manifest IDs—never caller-supplied filesystem paths;
- support one bounded byte range, `HEAD`, `If-Range`, ETag, immutable cache headers, `206`, and `416`;
- cap open handles and concurrent reads; abort on client disconnect;
- never proxy an arbitrary remote URL;
- fail with typed `missing`, `invalid-checksum`, `outside-coverage`, or `unavailable` status.

Extend installer/deployment contracts rather than adding a portal-image blob. Add the persistent map-data location and platform-specific behavior to the deployment doctrine and `docs/install/platform-support-watchlist.md`. Import/download is transactional: stage, verify length/checksum/manifest, then atomically promote; preserve the prior valid pack for rollback.

Likely files:

- `apps/web/lib/twin/map-pack-manifest.ts` and tests
- `apps/web/lib/twin/map-assets.server.ts` and tests
- `apps/web/app/api/map-assets/[packId]/route.ts` and tests
- minimal compose/install asset-volume wiring plus cross-platform watchlist entry

Verification: exact range bytes, suffix/open ranges, `HEAD`, ETag/If-Range, invalid ranges, traversal attempts, checksum rejection, interrupted import, rollback, Windows/macOS/Linux path resolution, and no outbound request during normal map use.

### 4. Build the MapLibre renderer as a progressive enhancement

Create a dynamically imported client component under `apps/web/components/twin/geographic/`:

- instantiate MapLibre only in the browser and only when the geographic view is selected;
- register and unregister the PMTiles protocol exactly once per module lifecycle;
- use a first-party local style and the local `/api/map-assets/...` URL—no CDN CSS, glyphs, sprites, telemetry, geocoder, or tile calls;
- render zones, routes, sites, and moving resources from the shared GeoJSON adapter;
- expose selected entity IDs and activation callbacks compatible with the existing twin selection model;
- use DPF design tokens, text/status plus shape (not color alone), >=44 px controls, keyboard navigation, reduced-motion behavior, and clear attribution;
- preserve the accessible list/schedule supplied by the downstream composition when WebGL or the pack is unavailable.

Likely files:

- `apps/web/components/twin/geographic/GeographicSceneCanvas.tsx`
- `apps/web/components/twin/geographic/GeographicSceneCanvas.test.tsx`
- a small MapLibre style module and CSS import at the owning client boundary

Verification: component lifecycle/cleanup, no SSR import crash, no request to a non-local origin, point/line/polygon parity, keyboard selection, WebGL failure, missing pack, light/dark themes, mobile layout, and axe.

### 5. Prove offline, performance, and honest degradation

- With the region pack installed, block WAN egress and prove the basemap and overlays still render from the local portal.
- If the optional browser cache is approved, measure cold/warm storage, quota failure, eviction, version invalidation, and rollback; never label the renderer offline-capable based only on a service-worker registration.
- Keep MapLibre and PMTiles out of non-geographic route chunks. Measure first geographic-view interaction, map-ready timing, heap growth, range-request count/bytes, and cleanup after unmount.
- On missing/invalid pack, WebGL failure, or out-of-coverage coordinates, show the typed capability state and retain the list/schematic workflow—never an empty gray canvas or fake coordinates.

Targets:

- non-geographic Operations routes: zero map asset requests and no eager MapLibre initialization;
- selection response after renderer ready: <=100 ms p95;
- bounded initial region requests with documented byte total;
- no normal-operation outbound network request;
- exact entity count and selection parity between GeoJSON output and the accessible downstream representation.

Verification: governed production build, exact shared local-CI, offline browser exercise, network request capture, bundle report, WebGL-disabled exercise, keyboard-only flow, responsive/theme screenshots, and migration apply if deployment metadata unexpectedly requires schema work.

### 6. Documentation and downstream handoff

- Add operator guidance for installing/updating/importing a region pack, attribution, coverage, storage cost, rollback, and typed degraded modes.
- Document the domain integration contract for `BI-8D9A2DE5`: downstream code supplies `GeographicSceneLayout`, current presentation bindings, and an accessible list; it does not instantiate MapLibre directly.
- Add the evaluated tools and use cases to the durable tool corpus so later archetypes reuse the same evidence instead of searching anew.
- Record verification evidence to `BI-3B07C332`; route confirmed map/range/offline techniques to the WSID commons only after the PR merges.

## Backlog coverage

- **Decision:** `atomic`
- **Receipt:** `cmsahfmd800lv01qkgxfx0cqr`
- **Rationale:** evaluated dependency pins, the renderer adapter, local PMTiles range delivery, and offline/fallback behavior form one production capability. A dependency-only, asset-only, or map-only phase has no independently usable owner outcome.
- **Downstream BIs:** generic TERRITORY remains `BI-8D9A2DE5`; HVAC and HOA compositions remain `BI-49036A4F` and `BI-76C1B949`.

## Architecture review (advisory)

- **Alignment:** well aligned after selecting managed region packs.
- **Important:** the older spec's phrase “bundled region asset” could be read as image-baked. This plan makes it an install-managed, verified persistent asset and keeps routine images small.
- **Important:** runtime map requests must stay local and declared. Remote-first tiles or arbitrary URL proxying would violate fully-local-by-choice and create an unbounded SSRF/data-egress surface.
- **Important:** MapLibre is a renderer, not a domain source. `GeographicSceneLayout`, canonical addresses/sites, and domain Operations projections remain authoritative.
- **Important:** map-only interaction is not accessible parity. Downstream compositions must provide the schedule/list workflow and exact shared entity references.
- **Minor:** the old spec names `maplibre-offline-pmtiles`, which does not resolve in the npm registry. This plan removes that assumption and treats `map-gl-offline` as an evaluated optional candidate.

## Risks and rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| Portal images become multi-gigabyte | Persistent managed pack outside image and Git | Remove asset-volume wiring; renderer falls back honestly |
| Range route exposes files or enables SSRF | Manifest ID allowlist, fixed root, no remote proxy, traversal tests | Disable map-asset capability without affecting Operations data |
| Unapproved dependency enters lockfile | Tool Evaluation and approved-registry guard before install | Revert package/lock changes; no data migration |
| Map slows every business route | Client-only dynamic import on geographic selection | Feature-disable geographic renderer; list/schematic remains |
| Region pack is stale, corrupt, or wrong locale | Signed/checksummed manifest, coverage bounds, transactional promotion | Restore prior valid pack atomically |
| WebGL or browser storage is unavailable | Typed capability state and accessible workflow | Continue in schematic/list mode |
| Tiles carry incompatible attribution/license | Manifest records source/license/attribution; tool/content review | Reject pack before promotion |

No partial map is production-ready: evaluated dependencies, local verified range delivery, renderer lifecycle, honest degradation, and offline evidence ship together under `BI-3B07C332`.
