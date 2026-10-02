---
status: active
---

# Phone map renderer, slice 1: implementation plan (BI-3DAE2169)

**Design:** [phone map renderer, slice 1](../specs/2026-10-02-phone-map-renderer-design.md)
**Backlog:** `BI-3DAE2169` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` · workroom `WC-A8C538A6`
**Shape:** `delivery-medium@1.0.0`. The baseline is the acceptance list in the backlog item.

## Delivery

One PR. The shared style and the bearer-accepting pack route are useful only together with the phone screen. All tasks map to `BI-3DAE2169`.

### Task 1: shared style builder

- Move `apps/web/components/twin/geographic/geographic-style.ts` to `packages/types/src/geographic-style.ts`, exported as `@dpf/types/geographic-style`. It gets its own minimal style types and no new dependency.
- The web canvas imports it from there. The web file is deleted, not left as a re-export.
- Its tests move with it and keep the assertions: no off-origin URL, no glyphs, no sprite (AC-PMR-STYLE-1).

### Task 2: pack route accepts the phone

- `apps/web/app/api/map-assets/[packId]/route.ts` and `runtime/[file]/route.ts` authenticate with `authenticateRequest`, so a bearer token or the web session is accepted. A 401 still means neither.
- Tests: bearer, session, neither (AC-PMR-AUTH-1).

### Task 3: customer-sites scene endpoint

- `apps/web/app/api/v1/map/customer-sites/route.ts` (`// @exposure authenticated`, route sync) requires `view_customer`. It returns:
  - `{ model, notOnMap, packs }`, where `model` comes from `loadCustomerMap` and `buildGeographicSceneModel`;
  - `packs` lists the installed packs covering the model's bounds.
- `packages/api-client`: `api.map.customerSites()`.
- Tests: capability refusal, and the response shape (AC-PMR-SCENE-1).

### Task 4: the phone map screen

- `apps/mobile`: add `@maplibre/maplibre-react-native@11.4.1` (exact pin) and its Expo config plugin in `app.json`. Add it to `sbom/dependency-allowlist.json` with a note pointing at the tool evaluation.
- `app/(tabs)/customers/map.tsx`, with a Map entry on the Customers screen:
  - **Map:** the shared style with the app's theme colours. The pack source is `pmtiles://<install>/api/map-assets/<pack>`. `TransformRequestManager.addHeader` adds the bearer token, matched to the install origin only.
  - **Content:** sites as circles with letter labels and service areas as outlines.
  - **Controls:** **Follow me** (UserLocation follow mode, existing `expo-location` grant), **Recenter**, compass, and an in-screen legend.
  - **Tapping** a site navigates to the account.
- **Fallback:** a pure `mapScreenState(...)` returns `ready`, `no-pack` or `failed` with a reason. The screen shows the site list and the reason when not ready.
- Tests: `mapScreenState`, the legend content, and the follow-me toggle, with the native map mocked (AC-PMR-SCREEN-1, AC-PMR-FALLBACK-1).

### Task 5: native build check, docs, gates

- Expo prebuild, then build and run on the iOS simulator. Sign in, open Customers, then Map. Confirm the map renders an installed pack, follow-me works, and tapping a site opens it. Record a screenshot as evidence (AC-PMR-BUILD-1).
- Docs:
  - the phone map in the user guide;
  - the platform-support watchlist row for the native module and config plugin.
- Build gate: typecheck (web, mobile, types), affected tests, pregate.

## Acceptance (quoted from the backlog item)

- AC-PMR-STYLE-1: The style builder exists once, in @dpf/types, and both the web canvas and the phone import it; its tests assert no off-origin URL, no glyphs and no sprite.
- AC-PMR-AUTH-1: /api/map-assets/[packId] serves a range for a valid bearer token or web session and returns 401 for neither.
- AC-PMR-SCENE-1: GET /api/v1/map/customer-sites requires view_customer and returns placements, zones, the not-on-the-map count and covering packs.
- AC-PMR-SCREEN-1: The app's Customers area has a Map screen that draws sites with letter labels, follows the device position when "Follow me" is on, recenters, shows a legend, and opens a site's account on tap.
- AC-PMR-FALLBACK-1: With no covering pack or a map start failure, the Map screen shows the site list and the reason instead of a blank map.
- AC-PMR-BUILD-1: @maplibre/maplibre-react-native is pinned at 11.4.1 and allow-listed, and the app prebuilds and runs on the iOS simulator rendering a pack.

## Traceability

| Acceptance | Task | Evidence |
|---|---|---|
| AC-PMR-STYLE-1 | Task 1 | shared style tests |
| AC-PMR-AUTH-1 | Task 2 | pack route auth tests |
| AC-PMR-SCENE-1 | Task 3 | scene endpoint tests |
| AC-PMR-SCREEN-1 | Task 4 | map screen tests |
| AC-PMR-FALLBACK-1 | Task 4 | mapScreenState tests |
| AC-PMR-BUILD-1 | Task 5 | simulator run |

## Backlog coverage

All tasks map to `BI-3DAE2169`, delivered atomically. Follow-ups, not covered here: offline packs on the phone, and HOA per-lot markers once `BI-FE286C27` lands.
