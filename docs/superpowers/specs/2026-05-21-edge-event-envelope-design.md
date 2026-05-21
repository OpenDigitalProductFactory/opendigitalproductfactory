# Edge Node — Canonical Event Envelope (Detection Engine, Slice 0)

| Field | Value |
|-------|-------|
| **BI** | [BI-9FE9D48D](../../../../docs/triage/) — Edge-node detection engine: single-binary detector framework on services/edge-node-go/ (PagerDuty-equivalent network/device event coverage foundation) |
| **IT4IT Alignment** | §5.7 Operate (Event Management FC) |
| **Depends On** | Phase 0 edge node (`services/edge-node-go/`), `2026-05-09-dpf-edge-node-design.md` (token + trust model), `2026-05-19-edge-node-network-telemetry-adapters-design.md` (SNMP/LLDP/UniFi adapters become detectors) |
| **Status** | Slice 0 — Draft (envelope + portal ingest only; detector framework + first detector pack land in follow-on slices) |
| **Created** | 2026-05-21 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

PagerDuty's "700 integrations" surface boils down to: receive a normalized event, dedupe it, run an
incident lifecycle, route + escalate to a human. DPF already runs Prometheus + Grafana + the edge
node's discovery and telemetry plane, but it has **no canonical event** — every adapter today writes
its own bespoke shape, so cross-source correlation and noise reduction are impossible without first
re-flattening the data.

Slice 0 closes that by defining one envelope shared between every edge detector and the portal, plus
the minimum ingest path to land events with replay-safe dedupe. Slice 0 is the lock-step contract
that downstream slices (detector framework, detector packs, correlation, escalation, on-call) depend
on; until it exists, every later slice would have to invent its own.

## 2. Goals (Slice 0)

1. One wire shape — `EdgeEventEnvelope` — used by every edge detector and validated identically by
   the portal Zod + the Go envelope validator + the cross-runtime parity test.
2. Lifecycle primitives — `trigger` / `acknowledge` / `resolve` — that map cleanly onto a portal-side
   incident state machine in later slices.
3. Replay-safe dedupe on `(edgeNodeId, dedupKey)` so flap/flood noise that survived edge-side
   collapse still folds into one row at the portal.
4. Auth + rate-limit parity with the existing edge ingest routes (`heartbeat`, `discovery-runs`,
   `metrics`) — same `dpfedge_` bearer-token model, same per-node ceiling pattern.
5. No portal UX yet — the row is for follow-on slices to read.

## 3. Non-Goals (Slice 0)

- Detector framework on the edge (Slice 1).
- Reachability/SNMP/syslog/ARP/DHCP detector pack (Slice 2).
- Vendor detector packs — UniFi events, Synology, HA, NUT, Suricata (Slice 3+).
- Cross-source correlation and ML grouping (separate portal slice).
- Incident UX, escalation policies, on-call schedules (separate portal slices).
- Re-platforming `PortfolioQualityIssue`, `ComplianceIncident`, or `RegulatoryAlert` — those keep
  their domain semantics. `EdgeEvent` is a new row class for edge-detected operational events only.

## 4. Wire Contract

The envelope is intentionally PD-CEF-shaped so adapters from external monitoring tools (a future
PagerDuty-compatible webhook adapter, for example) translate to the same vocabulary without a second
mapping pass.

### 4.1 EdgeEventEnvelope

```ts
{
  runKey: string;          // UUID — idempotency at batch level
  nodeId?: string;         // informational; portal trusts the bearer token
  observedAt: string;      // RFC 3339 — when the batch left the edge
  eventsVersion: "1";      // literal — bumped only on incompatible change
  events: EdgeEvent[];     // 1..500
}
```

### 4.2 EdgeEvent

```ts
{
  dedupKey: string;            // anchor; (edgeNodeId, dedupKey) is unique
  source: string;              // detector — "snmp.trap", "syslog", "ping"
  component?: string;          // sub-source — hostname, IP, MAC, port
  eventGroup?: string;         // logical bucket — "network", "host", "ups"
  eventClass?: string;         // condition — "interface_down", "cert_expiring"
  severity: "info" | "warn" | "error" | "critical";
  action: "trigger" | "acknowledge" | "resolve";
  summary: string;             // human-readable line for incident lists
  occurredAt: string;          // RFC 3339 — when the detector observed
  customDetails?: Record<string, unknown>;
}
```

`dedupKey` composition convention (operator-facing, enforced only by detector code):

```
<source>:<component>:<eventClass>[:<instance>]
```

Detectors that observe genuinely distinct conditions on the same component MUST vary `instance` so
the portal doesn't collapse two separate problems into one row.

## 5. Portal Ingest — POST /api/v1/edge/events

Order of operations (mirrors `/metrics`):

1. **Body size cap** — 256 KB. Larger than `/metrics` because events allow up to 500 records each
   with `customDetails`.
2. **Auth** — `edge:events` scope, `trustState=trusted` (same gate as `discovery:submit` /
   `edge:metrics`).
3. **JSON parse**.
4. **Envelope validation** — `edgeEventEnvelopeSchema.safeParse`. 422 on shape drift.
5. **Freshness** — symmetric 5-min window. Detectors buffering offline should bump `observedAt` on
   flush; per-event `occurredAt` preserves the original instant.
6. **Per-node rate limit** — `edge.events.submit` (30/min, 600/hour). Generous because the envelope
   already batches.
7. **Persist** — one `prisma.$transaction` per request; per-event upsert on `(edgeNodeId, dedupKey)`.

`nodeId` always derives from the bearer token; the body field is informational.

### 5.1 Lifecycle on upsert

| Incoming action | Existing row | Effect |
|---|---|---|
| `trigger` | none | Create row, `status="triggered"`, `occurrenceCount=1` |
| `trigger` | open (`triggered` / `acknowledged`) | Bump `occurrenceCount`, refresh payload, `lastSeenAt=now` |
| `trigger` | `resolved` | Re-open: clear `resolvedAt`, bump `occurrenceCount`, `status="triggered"` |
| `acknowledge` | none | Create row, `status="acknowledged"`, `occurrenceCount=1` |
| `acknowledge` | any | `status="acknowledged"` (counter NOT bumped) |
| `resolve` | none | Create row, `status="resolved"`, `resolvedAt=now`, `occurrenceCount=1` |
| `resolve` | any | `status="resolved"`, `resolvedAt=now` |

### 5.2 Response

```json
{
  "ok": true,
  "runKey": "...",
  "nodeId": "edge_abc",
  "accepted": 5,
  "created": 2,
  "reopened": 1,
  "acknowledged": 0,
  "resolved": 1,
  "updated": 1,
  "remaining": 29,
  "route": "/api/v1/edge/events"
}
```

## 6. Cross-Runtime Parity

The Go `internal/envelope/event.go` carries struct tags identical to the Zod field names; the
cross-runtime parity test at `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` replays
captured TS + Go fixtures against the same `edgeEventEnvelopeSchema`. Drift in either runtime fails
the test.

## 7. Out-of-Scope (Future Slices)

| Slice | Title | Notes |
|---|---|---|
| 1 | Edge detector framework | `internal/detector/`: contract, registry, scheduler, in-process bus, enricher, local-dedupe, embedded state store, outbound transport with offline buffer |
| 2 | First built-in detector pack | reachability (ping/TCP/HTTP/DNS/TLS), SNMP poll + trap receiver, syslog listener, ARP/DHCP delta, host self-metrics |
| 3+ | Vendor detector packs (per-BI) | UniFi events, Synology, HA, NUT, Suricata — each its own follow-on BI |
| P-A | Portal correlation | Group related events into incidents |
| P-B | Incident lifecycle | Full state machine + assignment UX |
| P-C | Escalation + on-call | Routing rules, schedules, paging |

## 8. Open Questions

- **Customer-facing event names** vs. detector-facing identifiers. Slice 0 uses raw strings; a
  catalog (mapping `source/eventClass` → human-readable name + remediation runbook) would slot in
  before Slice 2 ships.
- **Event TTL / archival** — `EdgeEvent` rows grow unbounded; Slice 0 ships without compaction.
  Add policy after Slice P-B (incident lifecycle) defines what "closed and aged out" means.
- **Severity-to-priority mapping** — Slice 0 keeps severity as a string; portal-side incident
  priority depends on policy not yet defined (see P-A / P-C).
