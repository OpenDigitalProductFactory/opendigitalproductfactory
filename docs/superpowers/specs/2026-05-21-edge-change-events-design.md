# Edge Node — Change Events (Detection Engine, Slice 1)

| Field | Value |
|-------|-------|
| **BI** | BI-8405FDA5 — Change Events on the edge-event envelope (additive eventType:alert\|change + new ChangeEvent model) |
| **Parent BI** | BI-9FE9D48D — Edge-node detection engine (Slice 0 foundation) |
| **IT4IT Alignment** | §5.7 Operate — Event Management FC + Change & Configuration Management FC |
| **Depends On** | Slice 0 (`2026-05-21-edge-event-envelope-design.md`, merged via PR #895) |
| **Status** | Slice 1 — Draft (envelope discriminator + ChangeEvent table + route dispatch; correlation engine ships in a separate slice) |
| **Created** | 2026-05-21 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

Most production incidents trace back to a recent change — a deploy, a config push, a feature-flag
flip, an infra apply. PagerDuty's PD-CEF model separates `change_event` records from `alert`/
`incident` records and joins them in the timeline so responders see "we shipped X at 02:28; this
fired at 02:31" without manual cross-referencing. Per the PagerDuty research brief
(post-merge of PR #895), this join is the **highest-leverage single MTTR win** that maps cleanly
onto our Slice 0 envelope.

DPF has no change record class today. Without one, the future correlation engine has nothing to
join alerts against. Slice 1 closes that — additively, with no breaking change to Slice 0.

## 2. Goals (Slice 1)

1. One wire shape for both event classes — extend `EdgeEventEnvelope` with an optional `eventType`
   discriminator (`alert` default, `change` opt-in). Slice 0 producers don't change.
2. A `ChangeEvent` Prisma model distinct from `EdgeEvent` — point-in-time facts, no lifecycle, no
   `occurrenceCount` / `resolvedAt` columns, indexed for the future correlation join.
3. The portal route at `POST /api/v1/edge/events` dispatches per event by `eventType` — alerts go
   to the existing upsert path; changes go to a new `ChangeEvent.upsert` path. Same auth, same
   freshness window, same rate limit, same transaction boundary.
4. Cross-runtime parity: Go envelope mirrors the discriminator; wire-contract fixtures (TS + Go)
   include a change event so drift surfaces.

## 3. Non-Goals (Slice 1)

- **Correlation engine.** Joining alerts to changes within an N-minute window is its own follow-on
  slice. Slice 1 ships the substrate the join queries; the join itself ships separately.
- **Change-emitting detectors.** Git-deploy hooks, kubectl-apply watchers, Terraform-plan parsers
  each get their own BI.
- **Change feed UI.** Operator-facing list / timeline ships in a UI slice.
- **Schema changes to EdgeEvent.** Slice 1 is purely additive. Slice 0 producers continue to work
  byte-identically.

## 4. Wire Contract

### 4.1 Envelope (unchanged from Slice 0)

```ts
{
  runKey: string;          // UUID — idempotency at batch level
  nodeId?: string;         // informational; portal trusts the bearer token
  observedAt: string;      // RFC 3339
  eventsVersion: "1";      // literal
  events: EdgeEvent[];     // 1..500
}
```

### 4.2 Event (extended with `eventType`)

```ts
{
  eventType?: "alert" | "change";  // default "alert" — Slice 0 producers omit
  dedupKey: string;
  source: string;
  component?: string;
  eventGroup?: string;
  eventClass?: string;
  severity: "info" | "warn" | "error" | "critical";
  action: "trigger" | "acknowledge" | "resolve";  // required; ignored for changes
  summary: string;
  occurredAt: string;
  customDetails?: Record<string, unknown>;
}
```

### 4.3 Semantic differences

| Aspect | `eventType: "alert"` (default) | `eventType: "change"` |
|---|---|---|
| Persistence | `EdgeEvent` table (Slice 0) | `ChangeEvent` table (new) |
| Lifecycle | triggered → acknowledged → resolved; re-open on later trigger | Point-in-time only |
| `dedupKey` semantics | Collapse anchor (`source:component:eventClass[:instance]`) | Stable identifier (git SHA, deploy ID, ticket ref) |
| `action` | Drives state machine | Required by schema, ignored at the route |
| Replay update | Bumps `occurrenceCount`; may clear `resolvedAt` | Refreshes `summary` / `customDetails` / `lastSeenAt`; `firstSeenAt` + `occurredAt` preserved |
| Useful `severity` | `info`–`critical` per detector confidence | `info` for routine, `warn` for canary, `error`/`critical` for hotfix / rollback |
| Useful `customDetails` | Probe / syslog / varbinds | `gitSha`, `deployedBy`, `targetEnv`, `runId`, `ticketRef` |

## 5. Data Model

### 5.1 `ChangeEvent`

```prisma
model ChangeEvent {
  id            String   @id @default(cuid())
  edgeNodeId    String                // FK to EdgeNode.id (cascade)
  changeKey     String                // envelope dedupKey, scoped per node
  source        String
  component     String?
  eventGroup    String?
  eventClass    String?
  severity      String   @default("info")
  summary       String
  customDetails Json?
  occurredAt    DateTime
  firstSeenAt   DateTime @default(now())
  lastSeenAt    DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  node EdgeNode @relation("EdgeNodeChanges", fields: [edgeNodeId], references: [id], onDelete: Cascade)

  @@unique([edgeNodeId, changeKey])
  @@index([edgeNodeId, occurredAt])   // ← powers the correlation join
  @@index([source])
  @@index([occurredAt])
}
```

The `@@index([edgeNodeId, occurredAt])` composite mirrors `EdgeEvent.@@index([occurredAt])` so both
sides of the future correlation join (`alerts.occurredAt BETWEEN change.occurredAt AND change.occurredAt + window`)
are O(log n).

### 5.2 Migration

`packages/db/prisma/migrations/20260521130000_add_change_event_table/migration.sql` —
`CREATE TABLE`, four indexes, FK to `EdgeNode` with cascade. Schema-only; no data backfill.

## 6. Portal Ingest

Same `POST /api/v1/edge/events` route. Order of operations is unchanged from Slice 0 (size cap →
auth → JSON → Zod → freshness → rate limit → persist). The persistence loop gains one branch:

```ts
for (const ev of parsed.data.events) {
  if (ev.eventType === "change") {
    await ingestChange(tx, edgeNodeRowId, ev, summary);
  } else {
    await ingestOne(tx, edgeNodeRowId, ev, summary);   // Slice 0 path
  }
}
```

`ingestChange` does a single `prisma.changeEvent.upsert` on `(edgeNodeId, changeKey)`:

- **create** path populates every column and stamps `firstSeenAt` = `lastSeenAt` = now.
- **update** path refreshes `summary`, `customDetails`, the four classification fields, and bumps
  `lastSeenAt`. `firstSeenAt` and `occurredAt` are intentionally **not** refreshed — the
  correlation engine cares about when the change *actually happened*, not the last time the
  emitter re-asserted it.

Response summary gains a `changes` count:

```jsonc
{
  "ok": true,
  "runKey": "...",
  "nodeId": "edge_abc",
  "accepted": 5,
  "created": 2,        // EdgeEvent inserts
  "reopened": 1,
  "acknowledged": 0,
  "resolved": 1,
  "updated": 1,
  "changes": 2,        // ChangeEvent inserts + updates
  "remaining": 29,
  "route": "/api/v1/edge/events"
}
```

## 7. Cross-Runtime Parity

`services/edge-node-go/internal/envelope/event.go` adds an `EventType` Go enum + struct field with
`json:"eventType,omitempty"` — omitting the field on the wire matches the Zod default of `"alert"`.
`Validate()` accepts empty, `EventTypeAlert`, or `EventTypeChange`.

`apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` already covers the events fixture;
Slice 1 extends both `fixtures/ts/events/v1.json` and `fixtures/go/events/v1.json` with a
change-event record so drift on either runtime fails the same Zod check.

## 8. Out-of-Scope (Follow-on Slices)

| Slice | Title | Notes |
|---|---|---|
| Correlation | Alert ⇄ change join engine | Reads `ChangeEvent.occurredAt` window around each `EdgeEvent.occurredAt`; surfaces matches in incident timeline. |
| 2 (edge framework) | Detector framework on `edge-node-go` | Registry, scheduler, bus, local-dedupe, transport — same as parent BI-9FE9D48D Slice 2. |
| 3+ (detectors) | First built-in detector pack | reachability, SNMP poll+trap, syslog, ARP/DHCP, host self. |
| Portal A | Incident lifecycle UX | Reads both EdgeEvent + correlated ChangeEvent. |
| Portal B | Escalation policies | Per-service routing. |
| Portal C | On-call schedules | Calendar + paging. |

## 9. Open Questions

- **Change → service mapping.** Slice 1 has no `Service` first-class object yet; `component`
  carries the service name as a string. When Service Graph (per PagerDuty research brief item #2)
  ships, ChangeEvent gains an optional `serviceId` FK.
- **Change TTL.** Like `EdgeEvent`, `ChangeEvent` rows grow unbounded. Compaction / archival
  policy depends on the correlation engine's lookback window — defer until correlation lands and
  the operationally useful window is empirically known.
- **Cross-node changes.** Some changes (an org-wide kubectl apply) logically belong to many edge
  nodes but are submitted by one. The `(edgeNodeId, changeKey)` unique scopes that out for now;
  a future slice may add a `globalChangeKey` field for cross-node dedup.

## 10. Trademark / Licensing Watchouts

Per PagerDuty research brief — schema field names (`source`, `component`, `eventGroup`,
`eventClass`, `severity`, `customDetails`) are PD-CEF public reference, not protectable. Do not
copy PagerDuty's marketing strings (e.g. "Change Events" landing-page copy, prompt-library
phrasings). The term "change event" as a generic operations concept is fine — it's used
industry-wide.
