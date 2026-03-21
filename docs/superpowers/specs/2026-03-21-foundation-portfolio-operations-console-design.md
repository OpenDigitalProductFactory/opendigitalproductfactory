# Foundation Portfolio Operations Console

**Date:** 2026-03-21
**Status:** Draft
**Epic:** EP-FOUND-OPS (combines Foundation Portfolio Console + Platform Instrumentation & Operational Visibility)
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md` (discovery models, inventory entities)
- `docs/superpowers/specs/2026-03-10-portfolio-route-design.md` (portfolio route, taxonomy tree)
- `docs/superpowers/specs/2026-03-15-calendar-infrastructure-design.md` (CalendarEvent for probe scheduling)
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md` (ontology — parallel track)

## Problem Statement

The platform discovers and inventories its own infrastructure through bootstrap discovery (delivered in the discovery spec). The `InventoryEntity` and `InventoryRelationship` models capture *what exists* and *how it connects*. But there is no operational surface for Foundation portfolio owners to:

1. **See health** — Is the database accepting connections? Is the container running? Is disk filling up? The inventory knows *what's there* but not *how it's doing*.
2. **Understand impact** — If I plan a change to Postgres, what digital products are affected? The relationships exist in the data but have no rendered view for operations teams.
3. **Manage operationally** — The `/portfolio` route shows the taxonomy tree and product counts, but Foundation portfolio owners need an operations-oriented view: infrastructure grouped by type, health status, dependency topology, and probe history.
4. **Plan for change** — Before proposing an RFC (EP-CHG-MGMT), operators need to assess the blast radius. The operational graph with health overlay is the planning surface for change management.

Additionally, the platform currently runs in Docker on a single host, but the architecture must accommodate future deployment to cloud or distributed infrastructure. The instrumentation model must be deployment-topology-agnostic.

## Design Summary

A combined operational console and instrumentation layer for the Foundation portfolio:

1. **Health Probes** — lightweight periodic checks stored as time-series snapshots, scheduled via CalendarEvent
2. **Infrastructure Dashboard** — operational view of inventory entities grouped by type, with health status, attribution, and staleness
3. **Operational Dependency Graph** — rendered topology view of inventory relationships with health overlay and impact analysis
4. **Probe History** — time-series view of health snapshots for trend analysis and degradation detection

The console is scoped to Foundation portfolio initially but the instrumentation models are portfolio-agnostic — any inventory entity can have health probes regardless of portfolio attribution.

### Key Principles

- **Build on existing models** — `InventoryEntity`, `InventoryRelationship`, `DiscoveryRun`, and `CalendarEvent` are the foundation. New models are additive.
- **Lightweight first** — health probes check reachability and resource thresholds, not full APM. Full observability integration (EP-FULL-OBS) is a future epic.
- **Deployment-agnostic** — probe definitions reference inventory entities by key, not by Docker socket path or hostname. When infrastructure moves to cloud, the probe definitions remain valid; only the probe executor adapts.
- **Operations lens, not architecture lens** — the dependency graph is a topology map colored by health, not an ArchiMate diagram. Different audience, different fidelity.

---

**Schema convention note:** Model pseudocode below uses simplified types for readability. Implementation must follow the project's schema conventions: `String @id @default(cuid())` for all IDs, `String` for all foreign keys, `@relation` annotations on all FK fields, and `@@index` directives for query performance.

## Section 1: Health Probe Model

### 1.1 New Schema Models

#### HealthProbe

Defines a periodic health check for an inventory entity.

```
model HealthProbe {
  id                 Int              @id @default(autoincrement())
  probeKey           String           @unique        // e.g., "docker-container-postgres-health"
  inventoryEntityId  Int
  inventoryEntity    InventoryEntity  @relation(fields: [inventoryEntityId], references: [id])
  probeType          String                          // container | database | service | image | custom
  name               String                          // human-readable label
  description        String?
  interval           Int              @default(300)  // seconds between checks
  timeout            Int              @default(30)   // seconds before probe times out
  thresholds         Json                            // type-specific threshold config
  enabled            Boolean          @default(true)
  calendarEventId    Int?                            // link to scheduling CalendarEvent
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
  snapshots          HealthSnapshot[]
}
```

#### HealthSnapshot

Point-in-time health reading.

```
model HealthSnapshot {
  id             Int          @id @default(autoincrement())
  probeId        Int
  probe          HealthProbe  @relation(fields: [probeId], references: [id], onDelete: Cascade)
  timestamp      DateTime     @default(now())
  status         String       // healthy | warning | critical | unreachable | unknown
  metrics        Json         // type-specific readings (cpu_pct, mem_pct, disk_pct, response_ms, etc.)
  message        String?      // human-readable status message
  durationMs     Int?         // how long the probe took to execute

  @@index([probeId, timestamp])
}
```

### 1.2 Probe Types and Thresholds

| Probe Type | What It Checks | Metrics Collected | Threshold Examples |
|-----------|---------------|-------------------|-------------------|
| `container` | Docker container state | `status` (running/stopped/restarting), `cpu_pct`, `mem_pct`, `uptime_seconds`, `restart_count` | `cpu_warning: 70, cpu_critical: 90, mem_warning: 75, mem_critical: 90` |
| `database` | Database connectivity and capacity | `accepting_connections` (bool), `active_connections`, `max_connections`, `disk_used_pct`, `response_ms` | `disk_warning: 70, disk_critical: 85, connections_warning: 80%_of_max` |
| `service` | HTTP/TCP endpoint reachability | `reachable` (bool), `response_ms`, `status_code`, `tls_expiry_days` | `response_warning: 2000, response_critical: 5000, tls_warning: 30` |
| `image` | Container image currency | `current_tag`, `latest_available`, `age_days`, `vuln_scan_age_days` | `age_warning: 30, age_critical: 90, vuln_scan_warning: 7` |
| `custom` | User-defined check via script/command | User-defined JSON | User-defined |

### 1.3 Status Derivation

Each probe execution produces a status based on threshold evaluation:

| Status | Meaning | Derivation |
|--------|---------|-----------|
| `healthy` | All metrics within normal thresholds | No threshold breached |
| `warning` | One or more metrics approaching limits | Warning threshold breached, no critical |
| `critical` | One or more metrics at dangerous levels | Critical threshold breached |
| `unreachable` | Probe could not connect to the entity | Timeout or connection refused |
| `unknown` | Probe has never run or failed to execute | No snapshot exists or probe execution error |

The `InventoryEntity` does not store health status directly — it is always derived from the most recent `HealthSnapshot` for its linked probes. This avoids stale cached status.

### 1.4 Scheduling

Health probes are scheduled via `CalendarEvent`:
- `eventType: 'action'`
- `category: 'platform'`
- Recurrence based on probe interval
- Probe executor runs as a platform service, not an agent task — no HITL required for routine probes
- **CalendarEvent ownership:** The current `CalendarEvent` model requires `ownerEmployeeId` (non-nullable). Platform-scheduled probes need a system-owned event convention. Options: (a) make `ownerEmployeeId` nullable for system events, (b) create a system employee profile for platform-owned events, (c) use a lightweight scheduler outside CalendarEvent for probe scheduling. The chosen approach must be resolved at implementation time and should align with EP-CHG-MGMT's same requirement for system-generated maintenance window events.

### 1.5 Retention Policy

- **Raw snapshots:** 7 days retention
- **Hourly rollups:** 90 days (min/max/avg per metric per hour)
- **Daily rollups:** indefinite (min/max/avg per metric per day)
- Rollup executed as a scheduled platform task
- Rollup model: `HealthRollup` (same structure as HealthSnapshot but with `rollupPeriod: hourly | daily` and aggregated metrics)

```
model HealthRollup {
  id             Int          @id @default(autoincrement())
  probeId        Int
  probe          HealthProbe  @relation(fields: [probeId], references: [id], onDelete: Cascade)
  periodStart    DateTime
  periodEnd      DateTime
  rollupPeriod   String       // hourly | daily
  worstStatus    String       // worst status observed in the period
  metrics        Json         // min/max/avg per metric
  snapshotCount  Int          // how many raw snapshots were aggregated

  @@index([probeId, periodStart])
  @@unique([probeId, periodStart, rollupPeriod])
}
```

### 1.6 Default Probes

On bootstrap discovery completion, the system auto-creates default probes for discovered entities:
- Each Docker container → `container` probe (5-minute interval)
- Each database → `database` probe (5-minute interval)
- Each service with HTTP endpoint → `service` probe (5-minute interval)
- Each container image → `image` probe (daily)

Default thresholds are conservative. Operators can tune via the console.

---

## Section 2: Infrastructure Dashboard

### 2.1 Route

`/portfolio/foundational/ops` — nested under the existing portfolio route, scoped to Foundation portfolio.

Accessible from the portfolio tree when navigating to the Foundational root node, as an additional tab alongside the existing product list and taxonomy views.

### 2.2 Layout

Tab-based layout (per platform design conventions):

| Tab | Content |
|-----|---------|
| **Overview** | Summary cards: total entities by type, health distribution (healthy/warning/critical/unreachable), discovery freshness, unattributed count |
| **Containers** | Filtered list of container-type inventory entities with health status, CPU/mem bands, uptime, attributed product |
| **Databases** | Filtered list of database entities with connection status, disk usage, attributed product |
| **Services** | HTTP/TCP endpoints with reachability, response time, TLS status |
| **Images** | Container images with version currency, vulnerability scan age |
| **Quality** | Portfolio quality issues from `PortfolioQualityIssue` — attribution gaps, stale entities, relationship anomalies |

### 2.3 Entity Detail Panel

Clicking any entity opens a detail panel showing:
- Entity properties (from `InventoryEntity.properties` JSON)
- Attribution: portfolio, taxonomy node, digital product (if attributed)
- Health probe history: sparkline of recent status, current metrics
- Relationships: upstream and downstream dependencies (links to graph view)
- Discovery provenance: which run discovered it, confidence, last confirmed
- Actions: edit attribution, adjust probe thresholds, disable/enable probes

### 2.4 Health Status Indicators

Consistent color coding throughout:
- Green: healthy
- Amber: warning
- Red: critical
- Grey: unreachable or unknown

Applied to: entity list rows, summary cards, graph nodes, sparklines.

---

## Section 3: Operational Dependency Graph

### 3.1 Purpose

A rendered topology view for operations teams to understand infrastructure dependencies and assess change impact. This is distinct from the EA Modeler — it shows physical reality (inventory entities and their relationships), not conceptual architecture.

### 3.2 Data Source

- **Nodes:** `InventoryEntity` records attributed to the Foundation portfolio (with option to show cross-portfolio dependencies)
- **Edges:** `InventoryRelationship` records, using canonical relationship types from the bootstrap discovery spec: `runs_on`, `hosts`, `depends_on`, `stores_data_in`, `connected_to_network`, `exposed_via`
- **Health overlay:** Latest `HealthSnapshot` status colors each node
- **Attribution overlay:** Digital product attribution labels on nodes

### 3.3 Rendering

- **Layout options:** Force-directed (default for organic topology), hierarchical (layers: host → runtime → container → service → database), grouped by type
- **Interaction:** Pan, zoom, click node for detail panel, hover for health summary
- **Impact analysis mode:** Click a node → highlight all downstream dependents in the graph. Shows: "If this entity is unavailable, these N entities and M digital products are affected."
- **Technology:** Client-side graph rendering (e.g., D3.js force simulation or similar library already in use in the EA Modeler). Server provides the graph data as nodes + edges JSON.

### 3.4 Graph API

Server endpoint returns the graph data:

```
GET /api/portfolio/foundational/ops/graph
Response: {
  nodes: [{
    id: string,
    entityKey: string,
    name: string,
    entityType: string,
    healthStatus: string,     // from latest snapshot
    healthMetrics: object,    // key metrics for tooltip
    digitalProductId: string | null,
    digitalProductName: string | null,
    portfolioId: string | null
  }],
  edges: [{
    id: string,
    source: string,           // from entity id
    target: string,           // to entity id
    relationshipType: string,
    label: string | null
  }]
}
```

### 3.5 Impact Analysis

When a node is selected for impact analysis:

1. Server traverses `InventoryRelationship` graph downstream from selected node
2. Collects all affected entities, their health status, and attributed digital products
3. Returns impact report:

```
GET /api/portfolio/foundational/ops/impact/:entityId
Response: {
  sourceEntity: { ... },
  affectedEntities: [{ entity, healthStatus, depth }],
  affectedProducts: [{ productId, name, portfolioSlug }],
  affectedServiceOfferings: [{ offeringId, name, availabilityTarget }],
  riskSummary: {
    totalAffected: number,
    criticalDependencies: number,
    productsAffected: number,
    portfoliosAffected: string[]
  }
}
```

**Traversal path for service offerings:** affected entities → attributed `digitalProductId` → `DigitalProduct.serviceOfferings`. This provides the SLA impact dimension for change risk assessment.

This impact data feeds directly into EP-CHG-MGMT when creating an RFC.

---

## Section 4: Probe History & Trend Analysis

### 4.1 Entity Health Timeline

For each inventory entity, the console provides:
- **24-hour view:** Raw snapshots plotted as a timeline (status color bands + metric sparklines)
- **7-day view:** Hourly rollups showing min/max/avg per metric
- **90-day view:** Daily rollups showing trend lines

### 4.2 Fleet Health Summary

Overview tab includes:
- **Health distribution over time:** Stacked area chart showing healthy/warning/critical/unreachable entity counts over 7 days
- **Top degraded entities:** Sorted by time-in-warning/critical state
- **Recent status changes:** Feed of entities that changed health status in last 24 hours

### 4.3 Alerting (Advisory Only)

For the initial implementation, alerting is advisory — surfaced in the console, not pushed externally:
- Entity transitions from healthy → warning or warning → critical create a `PortfolioQualityIssue` with `severity: warn` or `severity: error`
- Issues auto-resolve when the entity returns to healthy
- Quality issues are visible in the Quality tab and the portfolio overview health metrics

External notification integration (email, webhook, Slack) is deferred to EP-FULL-OBS.

---

## Section 5: Future-Proofing for Cloud & Distribution

### 5.1 Deployment-Agnostic Design

The probe model references inventory entities by key, not by infrastructure-specific identifiers:
- Probes don't store Docker socket paths or hostnames — those come from the `InventoryEntity.properties`
- Probe *executors* are pluggable: a Docker probe executor today, a cloud API probe executor tomorrow
- The `HealthSnapshot` schema is the same regardless of where the entity lives

### 5.2 Probe Executor Interface

```typescript
interface ProbeExecutor {
  probeType: string;                    // which probe types this executor handles
  canExecute(entity: InventoryEntity): boolean;  // can this executor probe this entity?
  execute(probe: HealthProbe, entity: InventoryEntity): Promise<HealthSnapshot>;
}
```

Initial executors:
- `DockerContainerProbeExecutor` — uses Docker Engine API
- `PostgresProbeExecutor` — uses pg connection test
- `HttpServiceProbeExecutor` — uses HTTP/TCP connectivity check
- `ContainerImageProbeExecutor` — checks image metadata

Future executors (EP-FULL-OBS or cloud expansion):
- `AzureResourceProbeExecutor`
- `AWSCloudWatchProbeExecutor`
- `KubernetesProbeExecutor`

### 5.3 Multi-Host Topology

When the platform expands to distributed deployment:
- Discovery runs can target remote hosts (deferred in bootstrap discovery spec)
- Inventory entities from multiple hosts appear in the same graph
- Cross-host relationships (network dependencies, replicated databases) are first-class edges
- The graph view supports filtering by host/location/region

---

## Section 6: Integration Points

### 6.1 EP-CHG-MGMT Integration

The impact analysis API (Section 3.5) is the primary input for change request risk assessment:
- When an RFC is created targeting an inventory entity, the system auto-calls the impact API
- Impact report is attached to the RFC as the basis for risk level calculation
- Approvers see the impact visualization as part of the approval workflow

### 6.2 EP-EA-DP Integration

The operational graph (physical reality) links to EA views (conceptual architecture):
- An `InventoryEntity` can be linked to an `EaElement` via the existing `EaElement.infraCiKey` → `InventoryEntity.entityKey` join (when the conceptual-to-operational bridge from EP-EA-DP is implemented)
- EA views can pull health status from the operational layer to show "is the architecture healthy?"
- Drill-through: EA element → linked inventory entity → operational graph

### 6.3 EP-ONTOLOGY Alignment

This spec's models map to the ontology entity catalog:
- `HealthProbe` and `HealthSnapshot` are new entities added to the ontology
- The operational dependency graph is a projection of the ontology's relationship taxonomy
- Impact analysis traversal uses the ontology's `depends-on`, `runs-in`, and `composed-of` relationships

### 6.4 Existing Portfolio Route

The Foundation operations console is an extension of the existing `/portfolio` route:
- The Foundational root node in the portfolio tree gains an "Operations" tab
- Portfolio overview health metrics (from Phase 2c spec) are enriched with probe-derived health data
- Quality issues from probes feed into the existing `PortfolioQualityIssue` model

---

## Section 7: Backlog Item — Full Observability (EP-FULL-OBS)

Deferred to a future epic when lightweight probes prove insufficient:

- Docker stats API integration (real-time CPU/memory/network per container)
- Database performance views (slow queries, lock contention, replication lag)
- Application-level metrics (request rates, error rates, latency percentiles)
- Custom dashboard builder (not Grafana replacement, but platform-native operational views)
- External notification channels (email, webhook, Slack, PagerDuty)
- Distributed tracing integration
- Log aggregation and search

This epic triggers when: operational complexity outgrows the probe model, or customer deployments require deeper visibility than health checks provide.

---

## Implementation Sequence

| Phase | Scope | Deliverables |
|-------|-------|-------------|
| 1 | Schema & probe infrastructure | `HealthProbe`, `HealthSnapshot`, `HealthRollup` models. Probe executor interface. Default probe creation on bootstrap. |
| 2 | Probe executors | Docker container, Postgres, HTTP service, container image executors. CalendarEvent scheduling integration. |
| 3 | Infrastructure dashboard | `/portfolio/foundational/ops` route. Overview, type-filtered lists, entity detail panel. Health status indicators. |
| 4 | Operational dependency graph | Graph API, client-side rendering, impact analysis mode, impact report API. |
| 5 | Probe history & trends | Timeline views (24h/7d/90d), fleet health summary, advisory alerting via PortfolioQualityIssue. |
| 6 | Retention & rollups | Snapshot retention policy, hourly/daily rollup task, rollup model. |
