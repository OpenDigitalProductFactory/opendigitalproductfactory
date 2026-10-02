---
status: draft
---

# Phone map renderer, slice 1: design (BI-3DAE2169)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-3DAE2169` (P0m) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | §3.3.2 of the 2026-09-23 geographic footprint, coverage and live overlays amendment |
| **Builds on** | The web map renderer `BI-814F86E1` (#5906: style contract, PMTiles pack route); the customer map `BI-560128FB` (#5921) |
| **Decisions** | WWMD 2026-09-25: native MapLibre over a WebView or vendor basemaps (margin 0.59). Tool evaluation `docs/security/tool-evaluations/2026-10-02-maplibre-react-native.md`, **approved by the operator 2026-10-02** with conditions. WWMD `DI-747D4742ED40`: one shared style builder used by web and phone (high confidence, margin 1.84). |
| **Out of scope (follow-ups)** | Offline region packs on the phone (needs file storage); HOA per-lot status markers (need the community layout `BI-FE286C27`); inspection rounds (`BI-1B3DED34`) |

## 1. Problem

The Expo app (`apps/mobile`) has no map. Field technicians and inspectors work from the phone, so the map has to reach it. The web renderer draws from install-managed PMTiles packs with a style that fetches nothing from third parties. The phone should use the same style and the same packs, not a second engine or a vendor basemap.

Two facts make this harder:

- The pack route `/api/map-assets/[packId]` authenticates only the web session cookie (`auth()`). The phone authenticates with a bearer token (`packages/api-client`, verified by `authenticateRequest` in `apps/web/lib/api/auth-middleware.ts`).
- The style builder lives in the web app (`apps/web/components/twin/geographic/geographic-style.ts`), where the phone cannot import it.

## 2. What this slice delivers

1. **One style builder for both apps.** The pure builder moves to `@dpf/types` as `@dpf/types/geographic-style`. It has its own minimal style types and no new package dependency. The web canvas imports it from there, and each client supplies its theme colours. There is no copy.
2. **The pack route accepts the phone.** `/api/map-assets/[packId]` and its runtime routes authenticate through `authenticateRequest`, which accepts a bearer token or the web session. The response is unchanged: ranges, ETag, and 401 when neither is present.
3. **A customer-sites map scene for the phone.** `GET /api/v1/map/customer-sites` requires `view_customer`. It returns the same model the web customer map draws (sites as placements, service areas as zones, the not-on-the-map count) and the installed packs that cover it.
4. **A map screen in the app**, under Customers, behind a Map tab:
   - MapLibre native with the shared style. Tiles come from `pmtiles://<install>/api/map-assets/<pack>`, with the bearer header added only for the install's own origin (`TransformRequestManager.addHeader` with a `match` on the origin).
   - Sites are drawn as circles with a letter label, so state is never shown by colour alone. Service areas are drawn as outlines.
   - **Follow me** tracks the GPS position using the existing `expo-location` grant, with **Recenter** and a compass.
   - A **legend** sits in the screen, not in a help article.
   - Tapping a site opens its account.
   - The map component loads only on this screen.
   - **Honest fallback:** with no installed pack covering the area, or when the map cannot start, the screen shows the list of sites with a plain reason. It is never a blank map.

## Objectives and acceptance

- **OBJ-PMR-SHARED:** The phone and the web draw maps from one style builder and one pack route.
- **OBJ-PMR-FIELD:** A field user sees customer sites on a phone map that follows them, and can open a site's account from it.
- **OBJ-PMR-SAFE:** The phone map sends no request to a third party, and tiles are only served to authenticated users.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-PMR-STYLE-1 | OBJ-PMR-SHARED | The style builder exists once, in `@dpf/types`, and both the web canvas and the phone import it; its tests assert no off-origin URL, no glyphs and no sprite. |
| AC-PMR-AUTH-1 | OBJ-PMR-SAFE | `/api/map-assets/[packId]` serves a range for a valid bearer token or web session and returns 401 for neither. |
| AC-PMR-SCENE-1 | OBJ-PMR-FIELD | `GET /api/v1/map/customer-sites` requires `view_customer` and returns placements, zones, the not-on-the-map count and covering packs. |
| AC-PMR-SCREEN-1 | OBJ-PMR-FIELD | The app's Customers area has a Map screen that draws sites with letter labels, follows the device position when "Follow me" is on, recenters, shows a legend, and opens a site's account on tap. |
| AC-PMR-FALLBACK-1 | OBJ-PMR-FIELD | With no covering pack or a map start failure, the Map screen shows the site list and the reason instead of a blank map. |
| AC-PMR-BUILD-1 | OBJ-PMR-SAFE | `@maplibre/maplibre-react-native` is pinned at 11.4.1 and allow-listed, and the app prebuilds and runs on the iOS simulator rendering a pack (tool-evaluation condition 4). |

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| Native MapLibre | WebView with the web renderer; react-native-maps | WWMD 2026-09-25 and the approved tool evaluation: same style and packs, no vendor basemap or key |
| Style builder in `@dpf/types` | A server style endpoint; a copy in the app | One source for the rule "no off-origin URLs". Both apps already depend on `@dpf/types`. WWMD `DI-747D4742ED40` |
| Pack route via `authenticateRequest` | A second, phone-only pack route | One route and one authorization rule; the existing helper already accepts both credentials |
| Customer sites first | HOA lots first | Lots have no coordinates until the community layout exists; customer sites already do (#5921) |
| Offline packs deferred | Bundle offline now | Needs a file-storage module and pack download management; the first value is the online map |

## 4. Research & Benchmarking

- **MapLibre React Native 11.4** (MIT; [docs](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/)):
  - `TransformRequestManager.addHeader` adds a header to matching requests only ([docs](https://maplibre.org/maplibre-react-native/docs/modules/transform-request-manager)). DPF adopts it, scoped to the install's origin.
  - MapLibre Native reads `pmtiles://` sources since Android 11.8.0 and iOS 6.10.0. DPF adopts the same packs as the web.
- **Smartwebs Mobile Offline** (incumbent HOA inspection app; parent §3.3.2): GPS tracking, recenter, legend and filter over Apple Maps. DPF adopts follow-me, recenter and legend; it rejects the vendor basemap and puts the legend in the screen.
- **Traccar** (parent §5): MapLibre with switchable layers. It confirms one style family across clients.
- **Standards:**
  - MapLibre Style Spec v8;
  - PMTiles v3;
  - GeoJSON RFC 7946;
  - WCAG 1.4.1 (Use of Color), which is why every marker carries a letter.

## 5. Security and privacy

- **Tiles:** the pack route serves only authenticated callers, by bearer or session, as before for the web. The bearer header is attached only to requests whose origin is the install.
- **No third-party requests:** the shared style declares no glyphs, no sprite and no off-origin source, and a test enforces this.
- **Position:** the device position is used on the phone for follow-me and is not sent to the server. Recording a technician's position is `BI-D5549DE2`, with its own privacy design.
- **Data:** the scene endpoint returns what the web customer map shows, to the same capability (`view_customer`).

## 6. Verification

- **Unit tests:**
  - the shared style builder;
  - the pack route with bearer, with session, and with neither;
  - the scene endpoint (capability and shape);
  - the phone screen state (fallback reasons, follow-me toggle, legend) with the native map mocked.
- **Native:** prebuild and run on the iOS simulator, with the map rendering an installed pack, follow-me on and a site tap (AC-PMR-BUILD-1).
- **Build gate:** typecheck, affected tests, pregate.

## 7. Documentation impact

- `docs/user-guide/`, the mobile or field area: the phone map, follow-me, the legend, and what to do when no street map is installed.
- `docs/install/platform-support-watchlist.md`: the native map module and its Expo config plugin.
