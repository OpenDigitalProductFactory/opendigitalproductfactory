# Edge Node — Event Envelope (Operator Guide)

> Slice 0 of the edge-node detection engine. This is the wire shape that
> every edge-side detector (built-in, declarative, scripted, sidecar) uses
> when posting to `POST /api/v1/edge/events`. Full design spec lives at
> [`docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md`](../superpowers/specs/2026-05-21-edge-event-envelope-design.md).
> BI: BI-9FE9D48D.

## TL;DR

| Surface | Where |
|---|---|
| Endpoint | `POST /api/v1/edge/events` |
| Auth | `dpfedge_` bearer token, scope `edge:events`, `trustState=trusted` |
| Body cap | 256 KB |
| Freshness | `observedAt` within 5 min of server time (symmetric) |
| Rate limit | 30 req/min, 600 req/hour per node |
| Batch | 1..500 events per request |
| Dedup | `(edgeNodeId, dedupKey)` — events with the same key collapse |
| Persistence | `EdgeEvent` table (Prisma model in `packages/db/prisma/schema.prisma`) |

## Envelope shape

```jsonc
{
  "runKey": "7c2d6f4a-3b1e-4d8a-9e1b-1234567890ab",
  "nodeId": "edge_abc",
  "observedAt": "2026-05-21T02:30:01Z",
  "eventsVersion": "1",
  "events": [
    {
      "dedupKey": "snmp.trap:10.0.0.5:ifaceDown:ifIndex=42",
      "source": "snmp.trap",
      "component": "10.0.0.5",
      "eventGroup": "network",
      "eventClass": "interface_down",
      "severity": "error",
      "action": "trigger",
      "summary": "Interface ifIndex=42 link state down on 10.0.0.5",
      "occurredAt": "2026-05-21T02:30:00Z",
      "customDetails": { "ifIndex": 42, "ifDescr": "GigabitEthernet0/1" }
    }
  ]
}
```

## Field reference

### Envelope

| Field | Type | Required | Notes |
|---|---|---|---|
| `runKey` | UUID | yes | Batch idempotency anchor. Re-submitting the same `runKey` is safe — each event upsert is replay-idempotent on its own. |
| `nodeId` | string | no | Informational. The portal uses the nodeId resolved from the bearer token; the body field is ignored. |
| `observedAt` | RFC 3339 | yes | When the batch left the edge. Must be within ±5 min of server time. |
| `eventsVersion` | `"1"` | yes | Wire version. Bumped only on incompatible change. |
| `events` | array | yes | 1..500 EdgeEvent records. |

### EdgeEvent

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventType` | enum | no | `alert` (default) &#124; `change`. Discriminator selecting the persistence path. Omitting it keeps Slice 0 wire compatibility. See [Change events](#change-events-slice-1) below. |
| `dedupKey` | string (1..255) | yes | Anchor for collapse. Same key = same row. For changes, this is the change's stable identifier (git SHA, deploy ID). |
| `source` | string (1..100) | yes | Detector identifier — `snmp.trap`, `syslog`, `ping`, `unifi.events`. |
| `component` | string (1..200) | no | Operator-readable sub-source — hostname, IP, MAC, port. |
| `eventGroup` | string (1..100) | no | Logical bucket — `network`, `host`, `ups`. |
| `eventClass` | string (1..100) | no | The condition — `interface_down`, `high_cpu`, `cert_expiring`. |
| `severity` | enum | yes | `info` &#124; `warn` &#124; `error` &#124; `critical`. |
| `action` | enum | yes | `trigger` &#124; `acknowledge` &#124; `resolve`. |
| `summary` | string (1..500) | yes | Short human-readable line. |
| `occurredAt` | RFC 3339 | yes | When the detector observed the condition. |
| `customDetails` | object | no | Free-form detector payload — varbinds, parsed syslog, vendor data. |

## Dedup key composition

The portal collapses events on `(edgeNodeId, dedupKey)`. Detectors are responsible for composing
keys that collapse correctly:

```
<source>:<component>:<eventClass>[:<instance>]
```

Examples:

```
snmp.trap:10.0.0.5:ifaceDown:ifIndex=42
syslog:fw01:login_failure:src_ip=192.0.2.7
ping:192.168.0.10:loss
ups.nut:rack-a:on_battery
unifi.events:aa:bb:cc:dd:ee:ff:client_blocked
```

If a detector observes genuinely distinct conditions on the same component, vary `instance` so the
portal keeps them separate.

## Lifecycle

| Incoming `action` | Existing row | Effect |
|---|---|---|
| `trigger` | none | Create row, `status="triggered"`, `occurrenceCount=1`. |
| `trigger` | open (`triggered` / `acknowledged`) | Bump `occurrenceCount`, refresh payload, `lastSeenAt=now`. |
| `trigger` | `resolved` | Re-open — clear `resolvedAt`, bump `occurrenceCount`, `status="triggered"`. |
| `acknowledge` | any | `status="acknowledged"`. Counter is NOT bumped (ack is operator/automation state, not a new observation). |
| `resolve` | any | `status="resolved"`, `resolvedAt=now`. A subsequent `trigger` re-opens. |

## Response

```jsonc
{
  "ok": true,
  "runKey": "7c2d6f4a-3b1e-4d8a-9e1b-1234567890ab",
  "nodeId": "edge_abc",
  "accepted": 5,          // events in this batch
  "created": 2,           // new rows
  "reopened": 1,          // resolved -> triggered
  "acknowledged": 0,
  "resolved": 1,
  "updated": 1,           // trigger replay against an open row
  "remaining": 29,        // rate-limit budget remaining this minute
  "route": "/api/v1/edge/events"
}
```

## Error responses

| Status | Error | Cause |
|---|---|---|
| 400 | `invalid_json` | Body is not valid JSON. |
| 401 | `missing_authorization` / `invalid_scheme` / `invalid_token_format` / `token_not_found` / `node_revoked` | Bearer-token auth failures. |
| 403 | `scope_disallowed` | Node is `pending` or `quarantined`, not `trusted`. |
| 413 | `payload_too_large` | `Content-Length` exceeds 256 KB. |
| 422 | `invalid_envelope` | Zod rejected the body shape. `issues` contains field-level errors. |
| 422 | `stale_payload` | `observedAt` outside the ±5 min freshness window. |
| 429 | `rate_limited` | 30/min or 600/hour ceiling hit. Honor `Retry-After`. |
| 500 | `persist_failed` | DB transaction failed. Retry with the same `runKey` — upserts are idempotent. |

## Capability declaration

Edge nodes that emit events should advertise `events.emit` in `advertisedCapabilities` during enroll
and report status in heartbeats. The portal's accepted-capabilities negotiation includes it in
`RESERVED_CAPABILITIES` (`packages/db/src/edge-node-types.ts`).

## Quick local check (cURL)

```bash
curl -X POST https://localhost:3000/api/v1/edge/events \
  -H "Authorization: Bearer dpfedge_<your_token>" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "runKey": "7c2d6f4a-3b1e-4d8a-9e1b-1234567890ab",
  "observedAt": "2026-05-21T02:30:01Z",
  "eventsVersion": "1",
  "events": [{
    "dedupKey": "ping:192.168.0.10:loss",
    "source": "ping",
    "component": "192.168.0.10",
    "severity": "warn",
    "action": "trigger",
    "summary": "Packet loss to 192.168.0.10 (35% over 60s)",
    "occurredAt": "2026-05-21T02:30:00Z"
  }]
}
JSON
```

## Change events (Slice 1)

> Slice 1 of the detection engine. BI: `BI-8405FDA5`. Spec:
> [`2026-05-21-edge-change-events-design.md`](../superpowers/specs/2026-05-21-edge-change-events-design.md).

Set `eventType: "change"` on an event to record a **point-in-time fact** — a deploy, config push,
feature-flag flip, infra apply — that the correlation engine (separate slice) joins to alerts that
fire shortly after. This is the highest-leverage pattern borrowed from PagerDuty's PD-CEF model:
most production incidents trace back to a recent change, and surfacing the join shaves the
biggest single chunk off MTTR.

**Wire shape:** identical to an alert event. The discriminator is `eventType`. Omit it (or set
`"alert"`) and the event lands in `EdgeEvent` with the Slice 0 lifecycle. Set it to `"change"`
and the event lands in `ChangeEvent` instead.

**Semantic differences from alerts:**

| | Alerts | Changes |
|---|---|---|
| Lifecycle | triggered → acknowledged → resolved (re-opens on later trigger) | Point-in-time only — no lifecycle, no `resolvedAt`, no `occurrenceCount` |
| `action` | Drives the state machine | Required by the wire schema for envelope uniformity, but **ignored**. Use `"trigger"`. |
| `dedupKey` | Detector-composed (`source:component:eventClass[:instance]`) so flap noise collapses | The change's stable identifier — git SHA, deploy ID, change-ticket ref. Re-submitting with the same key **updates** summary + customDetails instead of duplicating. |
| Replay update | Bumps `occurrenceCount`; may reopen from resolved | Refreshes `summary` / `customDetails` / `lastSeenAt`; `firstSeenAt` + `occurredAt` preserved so the original observation is pinned in time |
| Persistence | `EdgeEvent` table | `ChangeEvent` table |
| Useful `severity` | `info` → `critical` based on detector confidence | `info` for routine deploys, `warn` for canaries, `error`/`critical` for emergency hotfixes / rollbacks |
| Useful `customDetails` | Probe response, syslog body, varbinds | `gitSha`, `deployedBy`, `targetEnv`, `runId`, `ticketRef`, diff URL |

**Example — a deploy:**

```jsonc
{
  "eventType": "change",
  "dedupKey": "git.deploy:web@abcdef1",
  "source": "git.deploy",
  "component": "web",
  "eventGroup": "deploy",
  "eventClass": "deploy",
  "severity": "info",
  "action": "trigger",
  "summary": "Deploy abcdef1 to web (production)",
  "occurredAt": "2026-05-21T02:28:30Z",
  "customDetails": {
    "gitSha": "abcdef1",
    "deployedBy": "ci-bot",
    "targetEnv": "production"
  }
}
```

A mixed batch (alerts + changes) is fine — they share one envelope and land in one transaction.
The route response splits the counts:

```jsonc
{ "ok": true, "accepted": 4, "created": 2, "changes": 2, ... }
```

## What this is NOT (yet)

Slice 0 + Slice 1 ship the envelope + ingest + per-event persistence only. There is **no** event
list UI, **no** correlation engine joining alerts to changes, **no** escalation, **no** on-call.
Those land in follow-on slices:

- Slice 2 — edge detector framework (registry/scheduler/bus/dedupe/transport in `edge-node-go`)
- Slice 3 — first built-in detector pack (reachability, SNMP poll+trap, syslog, ARP/DHCP, host self)
- Portal slice — alert ⇄ change correlation engine (N-minute window join)
- Portal slices A / B / C — incident lifecycle UX, escalation, on-call

Track the parent BI `BI-9FE9D48D` (foundation) and follow-on `BI-8405FDA5` (Slice 1 change events).
