# Tool Evaluation: MapLibre React Native

**Backlog item:** `BI-3DAE2169` (epic `EP-SPATIAL-OPERATIONAL-VIEWS`)
**Decision:** conditional approval, approved by the operator on 2026-10-02
**Risk:** low
**Confidence:** 0.8
**Re-evaluate after:** 2027-04-02, on any major version, on an upgrade of the bundled MapLibre Native SDKs, or immediately after a security advisory

The Expo app (`apps/mobile`) has no map. Drive-by HOA inspections and field work happen on the phone, and the web renderer (`BI-814F86E1`) does not reach it.

On 2026-09-25 a WWMD decision recorded in the backlog item chose native MapLibre over two alternatives. It was high confidence, with a margin of 0.59:

| Option | Result |
|---|---|
| `@maplibre/maplibre-react-native`: native MapLibre, same style spec and PMTiles packs as the web | **Selected** |
| The web renderer inside a WebView (`react-native-webview` plus the existing `maplibre-gl`) | Rejected. It adds a native module anyway and doubles the map engine in memory. GPS follow-me and offline pack access cross a message bridge, and native gestures and accessibility are weaker. |
| `react-native-maps` with Apple or Google basemaps | Rejected. It needs a vendor basemap, and Google Maps needs a key. The vendor-lock and online dependency are what the incumbent HOA app has, and DPF avoids them. |

## What is evaluated

**`@maplibre/maplibre-react-native@11.4.1`** (MIT), published 2026-10-01 by the MapLibre organisation. Facts are from the npm registry and an isolated install on 2026-10-02.

- **Maintainers:** `maplibreorg` (board@maplibre.org) and two maintainers. Signed npm provenance.
- **Release cadence:** six releases between 2026-08-22 and 2026-10-01. The repository was pushed 2026-10-01; 666 stars, 41 open issues, not archived.
- **Peer requirements:** `expo >=54`, `react-native >=0.80`, `react >=19.1`. The app runs Expo 56, React Native 0.85.3 and React 19.2.3, so they are compatible. v11 supports only React Native's new architecture, which the app already uses.
- **JavaScript dependencies:** 16 packages and 15 MB unpacked:
  - `@maplibre/maplibre-gl-style-spec` pinned at 26.2.1. The web already carries 26.4.4 through `maplibre-gl`, so the lockfile keeps two copies.
  - Four `@turf/*` packages, plus helpers and small utilities.

  Licences: MIT (11), ISC (3), BSD-2-Clause (1), 0BSD (1). No install scripts.
- **Native SDKs**, pinned exactly by the package:
  - MapLibre Android `org.maplibre.gl:android-sdk-opengl:13.6.1`, with `android-sdk-turf:6.0.1`.
  - MapLibre iOS `6.31.0`, fetched through Swift Package Manager from `github.com/maplibre/maplibre-gl-native-distribution`.
- **PMTiles:** MapLibre Native has read `pmtiles://` sources since Android 11.8.0 and iOS 6.10.0 (January 2025). The phone can therefore use the same region packs as the web renderer.

## CoSAI security findings

| # | Category | Severity | Finding | Treatment |
| --- | --- | --- | --- | --- |
| 1 | Authentication | none | The library has no auth. Tile and pack requests carry whatever headers the app sets. | Pack downloads use the existing mobile session token through DPF's own route. No key is involved. |
| 2 | Access control | none | No permission model of its own. | The DPF pack route already requires a session (`/api/map-assets`). |
| 3 | Input validation | low | It renders style JSON and GeoJSON supplied by the app. Malformed GeoJSON fails to render, and does not execute. | Scenes pass the shared scene validator before rendering, as on the web. |
| 4 | Data/control boundary | none | No AI or tool-call surface. | n/a |
| 5 | Data protection | low | The device location is read by the app for follow-me; the library does not transmit it. | Location stays on the device. Recording a technician's position is a separate item (`BI-D5549DE2`) with its own privacy design. |
| 6 | Integrity | low | npm provenance is signed. The iOS SDK comes over SPM at an exact version; Android comes from Maven Central at an exact version. | Pin the package exactly. The lockfile integrity hash covers JavaScript. A native SDK upgrade is a re-evaluation trigger. |
| 7 | Session/transport | none | HTTPS to DPF's own pack route only. | Styles carry no off-origin URL, as on the web. |
| 8 | Network isolation | medium | Examples and docs point at `demotiles.maplibre.org`. The `mapStyle` prop has no default, so nothing is fetched unless the app supplies a URL. MapLibre Native has no telemetry. | DPF builds the style itself, with no remote glyphs, sprite or tile URL. A test asserts that no style URL is off-origin. |
| 9 | Trust boundary | none | No privileged decisions. | n/a |
| 10 | Resource management | low | A large offline pack or dense markers can use a lot of memory on low-end phones. | Packs are region extracts. Clustering is used at low zoom. The scene caps of 5,000 placements and 20,000 coordinates apply. |
| 11 | Operational security | none | No server component. | Map failures degrade to the list view, which is required by the design. |
| 12 | Supply chain | low | 16 small JavaScript packages, plus two native SDKs from the same organisation. OSV shows no advisories for the package (queried 2026-10-02). The style spec is duplicated. | Pin exactly. Run `pnpm scan:deps`. Revisit the duplicate when the package moves to 26.4.x. |

No early-termination condition applies:
- no hardcoded credentials;
- no CVE;
- a permissive licence;
- active maintenance, with a release yesterday.

## Compliance

- **Licences.** MIT for the package; BSD-2-Clause for the native SDKs (MapLibre Native). Both are permissive and compatible with DPF distribution. OSM-derived pack data carries ODbL attribution, which is shown through the map's attribution control as on the web.
- **Data residency.** Fully local. There is no telemetry, account or key, and tiles come from the install's own pack route or a pack stored on the phone.
- **Regulatory.** Not an AI system.

## Architecture fit

It uses the same MapLibre style specification and the same PMTiles packs as the web renderer, so the platform still has one map engine family, one style builder and one pack format. It does add a native module and an Expo config plugin to the mobile build. The **absorb, don't adopt** test is satisfied against the alternatives, not against today's tree:
- The app has no map, so nothing existing is retired.
- Every option adds a native dependency.
- This option adds no second engine, basemap vendor or key.

## Integration test

Run on 2026-10-02 in an isolated scratch directory, with install scripts disabled:
- **Install:** 16 packages, 15 MB, licences as above, no install scripts. Removal left nothing behind.
- **Source inspection:** no default remote style, and no telemetry in the JavaScript, iOS or Android sources.
- **Native build: not run.** An Expo prebuild and a simulator run of the app with the library are condition 4 below. A failure there reopens this evaluation.

## Conditions

1. Pin `@maplibre/maplibre-react-native` at `11.4.1` exactly, and add it to `sbom/dependency-allowlist.json` with a note referencing this evaluation.
2. Styles on the phone carry no off-origin URL. The phone uses the shared style builder, or a pure port of it, and a test asserts that every source is DPF's pack route or a local file.
3. Load the map only on the screens that need it, so the rest of the app does not pay for it.
4. Before merge, prebuild the app and run it on the iOS simulator with the map rendering a pack, and record the result.
5. Re-evaluate on a major version, a native SDK upgrade, or an advisory.

## Approval

The operator (Mark Bodman) approved adoption on 2026-10-02 under the conditions above, as the human gate of the evaluation pipeline. The approval is recorded in `BI-3DAE2169`.
