---
status: draft
---

# Geographic map renderer — design (BI-814F86E1)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-09-25 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-814F86E1` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parents** | [Spatial Operational Views](./2026-07-21-spatial-operational-views-design.md) (engine choice) · [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) (compositions, §7 P0) · [territory map substrate plan](../plans/2026-08-01-territory-map-substrate.md) (steps this design executes) |
| **Decisions** | `DI-63D94E36B0B0` (install-managed region pack) · WWMD 2026-09-25: `maplibre-pmtiles-inhouse-wrapper`, high confidence, margin 1.23 |
| **Out of scope** | Phone renderer (`BI-3DAE2169`), region-pack download/import tooling, geocoding (`BI-560128FB`), every archetype composition |

## 1. Problem

DPF has the geographic scene contract (`apps/web/lib/twin/geographic-scene.ts`), a PMTiles pack manifest validator (`map-pack-manifest.ts`) and a byte-range helper (`map-asset-range.ts`), all merged in PR #4361. Nothing draws a map. The `geo-map` and `customer-map` workspace primitives are registered and unrendered. Every spatial composition waits on this item: HOA, field dispatch, equipment yard, ward board, coverage and customer map.

## 2. What this item delivers

1. **Dependencies.** `maplibre-gl@6.11.2` and `pmtiles@4.5.0` are pinned exactly in `apps/web` and recorded in `packages/db/data/approved_tools_registry.json`. The evaluation is in [`docs/security/tool-evaluations/2026-09-25-maplibre-pmtiles.md`](../../security/tool-evaluations/2026-09-25-maplibre-pmtiles.md). No React binding package: a small in-house wrapper owns the lifecycle.
2. **Map-data location.** One persistent directory, `DPF_MAP_DATA_DIR`, defaulting to `/var/lib/dpf/maps`. Each installed pack is `<packId>.pmtiles` plus `<packId>.manifest.json`. Compose adds a named volume `map_data` mounted there on the portal. The image never carries a pack (`DI-63D94E36B0B0`).
3. **Map-asset route.** `GET` and `HEAD` on `/api/map-assets/[packId]` (route file `apps/web/app/api/map-assets/[packId]/route.ts`):
   - It requires an authenticated session.
   - It resolves only a pack id that passes the manifest id pattern and has a valid manifest on disk. There is no caller-supplied path, and it never proxies a remote URL.
   - It serves one byte range through `resolveMapAssetRange`, returning `206` with `Content-Range` for a range and `416` when the range is unsatisfiable. It sends `Accept-Ranges: bytes`, an `ETag` equal to the manifest SHA-256, and an immutable `Cache-Control`.
   - A missing pack returns a typed `404 {status:"missing"}`. A pack whose file length disagrees with its manifest returns `409 {status:"invalid"}`.

   A catalogue route, `GET /api/map-assets`, lists the valid installed manifests so the client can pick a pack covering the scene.
4. **Renderer.** `apps/web/components/twin/geographic/GeographicSceneCanvas.tsx`:
   - It is a client component. MapLibre and PMTiles are loaded by dynamic `import()` only when the component mounts, so no other route downloads them.
   - It registers the `pmtiles://` protocol once per module lifetime.
   - It draws the scene's zones (fill and outline) and placements (circle plus label) from `buildGeographicSceneModel` output, with selection passed in and out by entity id.
   - The map style is generated in `geographic-style.ts` from the `--dpf-*` tokens read at mount and on theme change. Without a pack it is a no-basemap style (a plain background plus the scene layers). With a pack it adds a vector basemap from the pack's `pmtiles://` source plus the pack attribution.
   - No CDN styles, glyphs, sprites or telemetry are used. The style declares no `glyphs` URL. MapLibre 6 draws label glyphs from the browser's local fonts: its `GlyphManager` rasterizes a grapheme "from the local fonts" when neither `font-faces` nor a glyphs URL covers it (verified in the 6.11.2 type declarations).
   - **The worker is served first-party.** MapLibre 6 builds its worker from `import.meta.url`, which a bundler cannot rewrite, and the worker imports `./maplibre-gl-shared.mjs` from beside itself. So `GET /api/map-assets/runtime/[file]` serves exactly two allowlisted files from the pinned package, `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs`, and the wrapper calls `setWorkerUrl()` on that route before the first map. `outputFileTracingIncludes` ships the two files in the standalone image, following the design-intelligence precedent in `next.config.mjs`.
5. **Honest degradation.** `geographicRendererCapability()` returns one of `renderer-ready`, `webgl-unavailable`, `region-pack-missing` or `region-out-of-coverage`. The component shows that state beside the caller's accessible list. It never shows a blank grey canvas or invents coordinates. Per the `BI-3A56AE0C` contract, callers must always render their own list; the map is the enhancement.

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| MapLibre GL JS + PMTiles | Leaflet (raster only; react-leaflet is under the non-OSI Hippocratic licence), OpenLayers (no advantage for our vector-style needs), Mapbox and Google (proprietary, keyed, billed), writing our own WebGL renderer | Parent spec §4.2; WWMD 2026-09-25 margin 1.23 |
| In-house wrapper | `@vis.gl/react-maplibre` | Absorb, don't adopt: about 150 lines of lifecycle code is cheaper to own than another package |
| Install-managed pack in a volume | Pack baked into the image; remote tile host | `DI-63D94E36B0B0` |
| No-basemap style when no pack exists | Blocking the map until a pack is installed | Zones and pins in real coordinates are useful without a street layer, and the world view (P1) needs none |
| Style generated from `--dpf-*` tokens | A static style JSON | AGENTS.md §9; dark mode and per-org branding follow automatically |

## 4. Research & Benchmarking

Recorded in the parent amendment §5:
- Traccar and Grafana Geomap converge on MapLibre-style compatibility.
- Odoo's Mapbox-token dependency is the failure mode this design avoids.
- Frappe's automatic map view for location-bearing records is the model for `customer-map`.

Standards: RFC 7946 GeoJSON, the MapLibre Style Spec, PMTiles v3, HTTP range semantics (RFC 9110 §14), and WCAG 2.2 AA with the map as enhancement and never the only representation.

## 5. Security

- **Assets are pack ids only.** The route checks each id against the manifest regex, joins it under a fixed root and rejects anything that resolves outside that root. The traversal tests cover `..`, encoded separators and absolute paths.
- **No outbound request is possible.** Nothing in the route or the renderer takes a URL from the caller.
- **Content-Security-Policy.** DPF has no app-wide CSP today (verified 2026-09-23). MapLibre v6 creates its worker from a same-origin module URL, so a future CSP needs `worker-src 'self' blob:`. This item records that requirement in the platform-support watchlist; it adds no CSP.
- **Authorization.** Packs hold public OSM-derived data, but serving them still requires a session, so an install does not become an open tile server.

## 6. Verification

- **Unit tests:**
  - range and route behaviour: full, partial, suffix, multiple-range and invalid-range requests, `HEAD`, a missing pack, a length mismatch, traversal attempts and unauthenticated calls;
  - the style builder in light and dark themes, with and without a pack;
  - the capability resolver;
  - the pmtiles protocol registering only once.
- **Build gate:** `pnpm --filter web typecheck`, the affected vitest files, and `pnpm --filter web build`. The build report must show MapLibre in a separate chunk loaded only by the geographic component.
- **UX:** this item ships the substrate without a user-facing route. The first mounted surface is P1 (`BI-4EC1D572`), which carries the UX gate. A component test covers mount, unmount cleanup and the fallback states.

## 7. Documentation impact

- Operator guidance: [`docs/user-guide/platform/map-packs.md`](../../user-guide/platform/map-packs.md) covers where packs live, attribution and what happens without one.
- `docs/install/platform-support-watchlist.md` gains a row for the new volume and the future CSP worker requirement.
