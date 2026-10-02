---
status: draft
---

# Weather alerts on the map: the first live overlay (BI-DC264802)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-DC264802` (P5) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) §4 (WWMD 2026-09-23: NWS alerts first, margin 0.99) |
| **Builds on** | the integration kernel (`apps/web/lib/integrations/kernel`), the safe outbound request helper (`apps/web/lib/security/safe-request.ts`), scheduled jobs (`apps/web/lib/queue/functions`), the system event stream (`apps/web/lib/tak/agent-event-bus.ts`, `apps/web/lib/hooks/system-events.ts`), the shared map style (`packages/types/src/geographic-style.ts`, after `BI-3DAE2169` lands; `apps/web/components/twin/geographic/geographic-style.ts` before) and service-area coverage (`apps/web/lib/twin/geographic-coverage.ts`) |
| **Out of scope** | Dispatch and inspection holds driven by alerts (a follow-up on the work-order flow); the phone map (`BI-3DAE2169` follow-up); other feeds (USGS, GDACS: parent §4 table) |

## 1. Problem

A field business plans work outdoors. An MSP covers sites, and an HOA maintains a community. When the National Weather Service issues a flood or severe-thunderstorm warning over a service area, nothing in DPF says so. The office finds out from a phone app and works out by hand which sites and crews are affected.

The parent spec ranks NWS alerts first among external overlays. They are public-domain federal data, need no key, and are already GeoJSON. It also sets the rule every feed follows: **the server fetches, caches and normalizes; the browser never calls a third party; every feed is an opt-in connector.**

## 2. What this slice delivers

1. **An opt-in connector.** `weather-nws-alerts` is declared on the integration kernel with `auth: none`. It is off by default. An administrator turns it on under **Platform → Tools → Integrations → Weather alerts** and chooses the US states and territories to watch. The default is the state in the organization's address, read from `Organization.address`, the canonical identity.
2. **Server-side fetch and cache.** While the connector is on, a scheduled job runs every 5 minutes. It does the following:
   - Calls `GET https://api.weather.gov/alerts/active?area=<codes>` through `safeJsonRequest`, with `api.weather.gov` as the only allowed host and a User-Agent naming the install and the organization's contact email, as NWS asks.
   - Normalizes each alert to one GeoJSON feature. It keeps the event, severity, urgency, certainty, headline, area description, effective, expires and sender fields, and drops description and instruction text from the map payload.
   - Stores the result as the feed's current snapshot, replacing the previous one. Alerts past `expires` are dropped.
3. **Zone shapes.** In a live sample on 2026-10-02, 5 of 8 active Texas alerts had no polygon. They name affected zones instead (`affectedZones`, county or forecast zone URLs). The connector fetches each zone's geometry once from `api.weather.gov/zones/...` and caches it for 30 days. Zone boundaries change rarely. An alert with neither a polygon nor a resolvable zone is listed but not drawn, and the list says so.
4. **Live push.** After a snapshot changes, the server broadcasts `system:overlay-updated` with `{ feedKey: "weather-nws-alerts", version }`. Open maps refetch `GET /api/map/overlays/weather-nws-alerts`, which needs a signed-in user and returns the cached GeoJSON. The map never polls NWS itself, and a closed tab costs nothing.
5. **On the customer map.** When the connector is on:
   - The map gets a **Weather alerts** layer, on by default, that can be switched off. Alert areas are drawn under sites and service areas, and their outline style varies by severity.
   - A **Weather alerts** panel under the map lists each alert that touches a placed site or a service area: event, severity, area, ends, and the sites and areas it covers. Coverage reuses the existing ring test. Severity is shown in words, never by colour alone (WCAG 1.4.1).
   - The map credits "Alerts: US National Weather Service".
6. **Honest states.** When the connector is off, the panel and layer do not appear. When the last fetch failed, the panel shows the time of the last good snapshot and the error in plain words. When the snapshot is older than 30 minutes, the panel says the alerts may be out of date.

## Objectives and acceptance

- **OBJ-NWS-SEE:** A field office sees active weather alerts over its customer sites and service areas, and which sites they cover, without leaving DPF.
- **OBJ-NWS-SAFE:** The feed is opt-in. Only the server talks to NWS, through the governed outbound path, and the browser never calls a third party.
- **OBJ-NWS-HONEST:** The map never presents stale or partial alert data as current or complete.

| Acceptance | Objective | Criterion |
|---|---|---|
| AC-NWS-CONNECTOR-1 | OBJ-NWS-SAFE | `weather-nws-alerts` is a registered kernel connector with `auth: none`, off until an administrator with `manage_provider_connections` turns it on and saves at least one area code. |
| AC-NWS-FETCH-1 | OBJ-NWS-SAFE | The scheduled fetch calls only `api.weather.gov`, through `safeJsonRequest` with that host allowed, a User-Agent carrying the install name and contact email, a bounded timeout and response size, and does nothing while the connector is off. |
| AC-NWS-NORMALIZE-1 | OBJ-NWS-SEE | Normalization keeps one feature per alert with event, severity, urgency, certainty, headline, area, effective, expires and sender, drops expired alerts, and resolves a geometry-less alert from cached zone shapes, fetching an uncached zone once. |
| AC-NWS-PUSH-1 | OBJ-NWS-SEE | A changed snapshot broadcasts `system:overlay-updated`; `GET /api/map/overlays/weather-nws-alerts` returns the snapshot to a signed-in user and 401 otherwise. |
| AC-NWS-MAP-1 | OBJ-NWS-SEE | With the connector on, the customer map draws alert areas as a switchable layer with NWS attribution, and the Weather alerts panel lists each alert touching a placed site or service area with severity in words and the covered sites and areas. |
| AC-NWS-STALE-1 | OBJ-NWS-HONEST | The panel shows the last good snapshot time and a plain error after a failed fetch, says alerts may be out of date when the snapshot is older than 30 minutes, and marks an alert it cannot draw. |

## 3. Design choices and their reasons

- **A kernel connector, not map code.** The parent spec requires it, and the kernel already supports `auth: none`, health probes and the integrations hub. The connections cockpit (`BI-2A0180A9`) is still open. This connector uses the kernel directly, the way the shipped connectors do, so it joins the cockpit when the cockpit lands.
- **Area codes, not a bounding box.** The NWS API filters by `area` (state or marine area), `zone` or `point`. One `area` call per poll covers a whole state for any number of sites. A per-site `point` call would grow with the customer list.
- **A snapshot, not a history.** The map needs what is active now. Keeping past alerts is a separate decision with its own retention, and no use asks for it yet.
- **Refetch on event, not data in the event.** The system event bus is in-process and forwards small typed events. Sending only a version keeps the bus small and makes the route the one place that checks who can see the data.
- **Under the sites, not over them.** An alert is context for the sites and areas. Drawing it underneath keeps every site tappable.

## 4. Research & Benchmarking

| Product | What it does | DPF adopts / rejects |
|---|---|---|
| **NWS API** ([docs](https://www.weather.gov/documentation/services-web-api)) | Public-domain alerts as GeoJSON (`application/geo+json`). No key; asks for a User-Agent with contact details. Responses carry `cache-control: max-age=5` (observed 2026-10-02). Geometry is often null, with `affectedZones` instead (5 of 8 in the sample). | **Adopt**: area-filtered polling, a contact User-Agent, and cached zone shapes for geometry-less alerts |
| **Traccar** ([map system](https://deepwiki.com/traccar/traccar-web/3-map-system)) | Weather and traffic as switchable overlays over one MapLibre map | **Adopt** a switchable layer over the one engine |
| **RainViewer / Open-Meteo** | Radar and forecast tiles | **Reject** for this slice: the free tiers are non-commercial (parent §4) |

Standards: CAP 1.2 severity, urgency and certainty vocabularies, which NWS alerts carry. GeoJSON RFC 7946.

## 5. Security and privacy

- Outbound: one host (`api.weather.gov`, plus its zone paths), https only, private networks blocked, DNS pinned, redirects capped and response size bounded by `safeJsonRequest`. No credentials are sent.
- Nothing about the install's customers leaves it. The request names only state codes, and the User-Agent carries the install name and the organization's public contact email.
- The overlay route serves cached public data to signed-in users. It reveals no customer data: site coverage is computed in the page from data the viewer can already see.

## 6. Convergence

Code and one additive migration for the snapshot and zone cache. The migration is forward-only and applies cleanly to any existing data. The connector is off by default, so an upgrade changes nothing until an administrator turns it on. A scheduled function runs only where scheduled jobs are enabled (`DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED`); elsewhere the panel reports that the feed has never been fetched.

## 7. Verification

- **Unit tests:**
  - connector registration and the enable action's capability check (AC-NWS-CONNECTOR-1);
  - the fetch with the request helper mocked: host, User-Agent, bounds, and no call when off (AC-NWS-FETCH-1);
  - normalization over a recorded NWS sample, including a geometry-less alert and expiry (AC-NWS-NORMALIZE-1);
  - the overlay route's 401 and payload, and the broadcast on change (AC-NWS-PUSH-1);
  - the panel's coverage and severity wording and the stale and failed states (AC-NWS-MAP-1, AC-NWS-STALE-1).
- **UX:** on the contributor preview, turn the connector on for TX, run the fetch, and confirm the layer, attribution, panel and switch on `/customer?view=map`.
- **Migration** applies cleanly.

## 8. Documentation impact

- `docs/user-guide/customers/customer-map.md`: the Weather alerts layer and panel.
- A new `docs/user-guide/platform/weather-alerts.md`: turning the connector on, what is sent to NWS, and the stale and failed states.
- The platform-support watch-list: a row for the scheduled-jobs dependency and outbound access to `api.weather.gov`.
