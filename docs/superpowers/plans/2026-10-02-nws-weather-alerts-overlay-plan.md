---
status: active
---

# Weather alerts on the map: implementation plan (BI-DC264802)

**Design:** [Weather alerts on the map](../specs/2026-10-02-nws-weather-alerts-overlay-design.md)
**Backlog:** `BI-DC264802` (P5) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` · workroom `WC-C0D00B7E`
**Shape:** large (raised for an external service). The baseline is minted by spec approval.

## Delivery

One PR, delivered atomically (not independently shippable task by task): the connector without the map shows nothing, and the map without the feed has nothing to draw. Every task maps to `BI-DC264802`.

### Task 1: snapshot and zone-cache storage

- Migration adding two models, each tagged with its `/// @dpf` declaration:
  - `ExternalOverlaySnapshot`: one row per feed key. Holds the normalized GeoJSON, version, `fetchedAt`, `lastSuccessAt`, `lastError` and alert count. Tagged `lifecycle=operational retention=projection`, because it is replaced on every fetch.
  - `ExternalOverlayZoneShape`: zone URL, geometry and `fetchedAt`. Tagged `lifecycle=operational retention=projection`. Shapes older than 30 days are refetched.
- The migration is additive and forward-only, and applies to any existing data.

### Task 2: the connector (AC-NWS-CONNECTOR-1)

- `apps/web/lib/integrations/connectors/weather-nws-alerts.ts`: `parseConnectorDefinition` with `auth: none`, capability `overlay.weather-alerts`, one `fetch-active-alerts` operation and a health probe. Register it in `connectors/index.ts`.
- Settings are the enabled flag and the area codes, stored on the connector's `IntegrationCredential` row (`integrationId: "weather-nws-alerts"`). The default area code is the state in `Organization.address`.
- Admin page `app/(shell)/platform/tools/integrations/weather-nws-alerts/` with a server action guarded by `manage_provider_connections`. It shows what is sent to NWS, last success and last error. A hub card is added.
- Tests:
  - registration;
  - the action refuses without the capability;
  - it saves area codes and validates them against the NWS area code list.

### Task 3: fetch and normalize (AC-NWS-FETCH-1, AC-NWS-NORMALIZE-1)

- `apps/web/lib/overlays/nws/fetch.ts`: `safeJsonRequest` with `allowedHosts: ["api.weather.gov"]`, a User-Agent of the form `DPF (<install name>, <organization email>)`, a 15 s timeout and an 8 MB response cap.
- `normalize.ts`: one feature per alert with the kept properties, expired alerts dropped, and geometry from the alert or from the cached zone shapes. Uncached zones are fetched once each, with at most 50 zone fetches per run; the rest are drawn on the next run and marked until then.
- `apps/web/lib/queue/functions/nws-alerts-poll.ts`: cron every 5 minutes. It returns immediately while the connector is off, writes the snapshot and records success or error. It is registered in `scheduledFunctions`.
- Tests:
  - the request helper is mocked to check the host, User-Agent and bounds, and that no call happens when the connector is off;
  - normalization over a recorded sample (`__fixtures__/nws-active-tx.json`, captured 2026-10-02) covers a polygon alert, a zone alert, an expired alert and an unresolvable alert.

### Task 4: route and push (AC-NWS-PUSH-1)

- `GET /api/map/overlays/weather-nws-alerts` (`// @exposure authenticated`) returns the snapshot, or 401 without a session.
- `system:overlay-updated` is added to `AgentEvent` and `SystemEventMap`. The poll broadcasts it when the version changes.
- Tests: the route's 401 and payload, and the broadcast only on change.

### Task 5: the customer map layer and panel (AC-NWS-MAP-1, AC-NWS-STALE-1)

- Shared style: an optional overlay source and its layers in `buildGeographicStyle`, drawn below zones and placements. The outline is dashed for a watch or advisory and solid for a warning. Its test keeps the no-off-origin, no-glyphs and no-sprite assertions.
- `GeographicSceneCanvas` takes an optional `overlay` GeoJSON prop, sets its data in `pushData`, and adds the NWS attribution when it is present.
- `CustomerMapView`:
  - a **Weather alerts** switch;
  - `useSystemEvent("system:overlay-updated")` to refetch;
  - a panel listing each alert that touches a placed site or service area, with severity in words, area, end time, and covered sites and areas. Coverage uses `apps/web/lib/twin/geographic-coverage.ts`.
  - the stale (over 30 minutes) and failed states, and a mark on undrawn alerts.
- UX-fit manifest from the route sweep for `/customer?view=map`.
- Tests:
  - panel coverage and wording;
  - the stale and failed states;
  - the switch;
  - the canvas pushes overlay data.

### Task 6: docs, watch-list, gates

- `docs/user-guide/customers/customer-map.md`: the Weather alerts layer and panel.
- New `docs/user-guide/platform/weather-alerts.md`: turning the connector on, what is sent, and the stale and failed states.
- Platform-support watch-list row: scheduled jobs must be enabled, and outbound access to `api.weather.gov` is needed.
- Build gate:
  - typecheck;
  - affected tests;
  - migration applies;
  - UX check on the contributor preview (turn the connector on for TX, run the poll, view the map);
  - pregate.

## Requirements and verification

| Requirement | Verification | Task |
|---|---|---|
| OBJ-NWS-SAFE | AC-NWS-CONNECTOR-1 | Task 2 |
| OBJ-NWS-SAFE | AC-NWS-FETCH-1 | Task 3 |
| OBJ-NWS-SEE | AC-NWS-NORMALIZE-1 | Task 3 |
| OBJ-NWS-SEE | AC-NWS-PUSH-1 | Task 4 |
| OBJ-NWS-SEE | AC-NWS-MAP-1 | Task 5 |
| OBJ-NWS-HONEST | AC-NWS-STALE-1 | Task 5 |

## Backlog coverage

All tasks map to `BI-DC264802`, delivered atomically. Follow-ups, not covered: dispatch and inspection holds on alerts, the phone map layer, and other feeds (USGS, GDACS).
