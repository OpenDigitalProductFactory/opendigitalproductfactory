# Tool Evaluation: MapLibre GL JS and PMTiles

**Backlog item:** `BI-814F86E1` (epic `EP-SPATIAL-OPERATIONAL-VIEWS`)
**Decision:** conditional approval
**Risk:** low
**Confidence:** 0.85
**Re-evaluate after:** 2027-03-25, on any MapLibre major version, or immediately after a security advisory against either package

DPF needs one browser map renderer for every geographic scene: territory, coverage, HOA and the market footprint. The engine was chosen in the [Spatial Operational Views spec](../../superpowers/specs/2026-07-21-spatial-operational-views-design.md) §4.2. A WWMD decision on 2026-09-25 then scored four options:

| Option | Result |
|---|---|
| Pin both packages and write a thin in-house wrapper | **Selected.** High confidence, margin 1.23 |
| Add the `@vis.gl/react-maplibre` binding | Rejected: one more package for a few hundred lines of lifecycle code |
| Write our own WebGL renderer | Rejected: large cost, and slow to deliver value |
| Leaflet with raster tiles | Rejected: raster only, and its React binding carries a non-OSI licence |

The design is [2026-09-25-geographic-map-renderer-design.md](../../superpowers/specs/2026-09-25-geographic-map-renderer-design.md).

## What is evaluated

**`maplibre-gl@6.11.2`** (BSD-3-Clause), measured from the npm tarball on 2026-09-25:
- ESM only: `dist/maplibre-gl.mjs`, `maplibre-gl-shared.mjs` and `maplibre-gl-worker.mjs`, about 150 KB, 147 KB and 6 KB gzip.
- 18 direct runtime dependencies. Every one is BSD-2/3, ISC, MIT, or MIT-or-Apache-2.0.

**`pmtiles@4.5.0`** (BSD-3-Clause):
- One runtime dependency, `fflate` (MIT).
- About 380 KB unpacked, including the CJS and ESM builds.

## CoSAI security findings

| # | Category | Severity | Finding | Required treatment |
| --- | --- | --- | --- | --- |
| 1 | Network isolation | medium | The default MapLibre style URLs and demo tiles point at third-party hosts. | DPF generates its own style with no remote `glyphs`, `sprite` or tile URL. The only sources are same-origin (`/api/map-assets/...`) or inline GeoJSON. A test asserts that no style URL is off-origin. |
| 2 | Supply chain | low | The package set is 20 small, widely used packages. | Pin exact versions. Lockfile integrity hashes are enforced. Re-evaluate on major versions. |
| 3 | Code execution | low | The worker is built from a URL. A misconfigured URL could load foreign code. | `setWorkerUrl()` points only at a first-party route that serves two allowlisted files from the pinned package. The route takes no caller path. |
| 4 | Input validation | low | Renderer input is GeoJSON from DPF's own validated scene contract, plus PMTiles bytes from an operator-installed pack. | Scenes pass `validateGeographicSceneLayout` first. Packs are served only when their manifest validates and the byte length matches. |
| 5 | Resource management | low | Large scenes or large tiles can exhaust GPU memory on low-end devices. | The scene contract caps at 5,000 placements and 20,000 coordinates. WebGL loss degrades to the caller's accessible list. |
| 6 | Data protection | low | Map packs are public OSM-derived data. The scene data is the organization's own. | Scene data never leaves the install. The pack route requires a session, so an install is not an open tile server. |
| 7 | Future CSP | info | DPF has no app-wide Content-Security-Policy today. A future CSP must allow the module worker. | Recorded in `docs/install/platform-support-watchlist.md`: `worker-src 'self' blob:`. |

## Compliance and architecture fit

- **Licences.** All permissive and compatible with DPF distribution. Rendered OSM data carries ODbL attribution: each pack's manifest `attribution` is shown through MapLibre's attribution control.
- **Data residency.** Fully local. There is no telemetry, account or key.
- **Fit.** One renderer for every geographic scene, and it is loaded only on geographic routes. It retires the need for any vendor map API.

## Conditions

1. Pin `maplibre-gl` at `6.11.2` and `pmtiles` at `4.5.0` exactly.
2. Styles carry no off-origin URL.
3. The worker is served only from the first-party allowlisted route.
4. MapLibre loads only by dynamic import, inside the geographic component.
5. Re-evaluate on a major version or an advisory.
