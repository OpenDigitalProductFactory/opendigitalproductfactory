# Spec: Infrastructure Auto-Discovery and Product Promotion

**Date:** 2026-04-02
**Status:** Draft
**Author:** Claude Code (with Mark Bodman)
**IT4IT Alignment:** S5.7 Operate (D2C), S6.1 Enterprise Architecture FC
**Relates to:** EP-FULL-OBS, discovery-attribution.ts, discovery-sync.ts

## 1. Problem Statement

The platform has a comprehensive infrastructure discovery system (host, Docker, Kubernetes collectors; taxonomy attribution; Neo4j projection; quality issue tracking) but it only runs on manual trigger via `triggerBootstrapDiscovery()`. Discovered `InventoryEntity` records are never automatically promoted to `DigitalProduct` records, meaning infrastructure components remain invisible in the portfolio tree until manually created.

When a new container starts (e.g., adding Prometheus to the stack), or a new database comes online, the portfolio view has no awareness of it. The operator must manually create a DigitalProduct, assign a taxonomy node, and link it. This defeats the purpose of having a discovery system.

Additionally, Prometheus already knows about every monitored service via its scrape targets, but this data source is not used for discovery.

## 2. Goals

1. **Continuous discovery** -- run discovery sweeps on a schedule so new infrastructure is detected without manual intervention
2. **Prometheus target integration** -- use Prometheus `/api/v1/targets` as an additional discovery source alongside Docker and host collectors
3. **Auto-promotion** -- automatically create `DigitalProduct` records from high-confidence `InventoryEntity` records (rule-based attribution >= 0.90)
4. **Exception queue** -- surface low-confidence and unmatched entities on the `/inventory` page for human review with AI Coworker assistance
5. **Taxonomy accuracy** -- every auto-promoted product must be placed in the correct taxonomy node; anything that can't be confidently placed goes to the exception queue

## 3. Non-Goals

- Kubernetes auto-discovery beyond the existing minimal collector
- External cloud provider discovery (AWS, Azure, GCP)
- Automatic retirement/deletion of digital products when services disappear (staleness is flagged, not acted on)
- Modifying the existing Docker or host collectors (extend, don't replace)

## 4. Design

### 4.1 Discovery Scheduling

**Approach:** API route + interval timer in the portal process.

A new API route `/api/v1/discovery/sweep` accepts POST requests to trigger a discovery sweep. The portal process runs a lightweight timer that:

1. Every **60 seconds**: polls Prometheus `/api/v1/targets` for new/disappeared scrape targets (fast, ~50ms)
2. Every **15 minutes**: runs the full discovery pipeline (host + Docker + Prometheus + attribution + sync)

The timer starts on portal boot and is resilient to failures (catches errors, logs, continues). A `sweepInProgress` flag prevents concurrent sweeps -- if a sweep is still running when the timer fires, the new sweep is skipped and a warning is logged.

```
apps/web/lib/operate/discovery-scheduler.ts
  - startDiscoveryScheduler()    // called from app initialization
  - stopDiscoveryScheduler()     // cleanup on shutdown
  - runPrometheusTargetCheck()   // lightweight 60s poll
  - runFullDiscoverySweep()      // 15-minute full sweep
```

The full sweep calls the existing `executeBootstrapDiscovery()` with `trigger: "scheduled"` plus the new Prometheus collector.

### 4.2 Prometheus Target Collector

**New file:** `packages/db/src/discovery-collectors/prometheus.ts`

Queries Prometheus `/api/v1/targets` and produces `CollectorOutput` items:

```typescript
type PrometheusTarget = {
  labels: { job: string; instance: string; [key: string]: string };
  health: "up" | "down" | "unknown";
  lastScrape: string;
  scrapePool: string;
};
```

**Classification rules** (map Prometheus job names to discovery item types):

| Job Pattern | Item Type | Taxonomy Rule |
|---|---|---|
| `postgres*` | `database` | foundational/data_and_storage_management/database |
| `neo4j` | `database` | foundational/data_and_storage_management/database |
| `qdrant` | `database` | foundational/data_and_storage_management/database |
| `portal`, `sandbox*` | `application` | foundational/platform_services |
| `model-runner` | `ai_service` | foundational/platform_services/ai_and_agent_platform |
| `cadvisor` | `monitoring_service` | foundational/platform_services/observability_platform |
| `node-exporter` | `monitoring_service` | foundational/platform_services/observability_platform |
| `prometheus` | `monitoring_service` | foundational/platform_services/observability_platform |
| (unrecognized) | `service` | needs_review |

Each target produces a `DiscoveredItem` with:
- `sourceKind: "prometheus"`
- `naturalKey: "prom:<job>:<instance>"`
- `attributes: { job, instance, health, scrapePool }`
- `confidence`: 0.95 for recognized jobs, 0.5 for unrecognized

**Relationships:** The collector also creates `monitors` relationships from the Prometheus self-target to all other targets.

### 4.3 Auto-Promotion to DigitalProduct

**New file:** `packages/db/src/discovery-promotion.ts`

After each discovery sweep, a promotion pass runs:

```typescript
async function promoteInventoryEntities(prisma: PrismaClient): Promise<PromotionSummary> {
  // 1. Find entities eligible for promotion:
  //    - attributionStatus = "attributed"
  //    - confidence >= AUTO_PROMOTE_THRESHOLD (0.90)
  //    - digitalProductId IS NULL (not already linked)
  //    - taxonomyNodeId IS NOT NULL (must have a placement)
  //    - entityType in PROMOTABLE_TYPES
  
  // 2. For each eligible entity:
  //    a. Generate a productId from entityKey (e.g., "infra-postgres-core")
  //    b. Resolve portfolioId from taxonomy node ancestry
  //    c. Upsert DigitalProduct with:
  //       - productId, name, description (from entity properties)
  //       - taxonomyNodeId (from attribution)
  //       - portfolioId (from taxonomy ancestry)
  //       - lifecycleStage: "production"
  //       - lifecycleStatus: "active"
  //    d. Link entity: set inventoryEntity.digitalProductId
  //    e. Log promotion event
  
  // 3. Return summary: { promoted: N, skipped: N, errors: N }
}
```

**Promotable entity types** (auto-promote without review):
- `host` -- physical/virtual machines
- `runtime` -- container runtimes (mapped from docker_runtime by normalize)
- `container` -- application containers (non-monitoring)
- `database` -- database services
- `monitoring_service` -- observability stack
- `ai_service` -- AI inference endpoints
- `application` -- platform applications (portal, sandbox)

**Threshold:** `AUTO_PROMOTE_THRESHOLD = 0.90`
- Rule-based attributions have 0.98 confidence -> auto-promote
- Heuristic matches below 0.90 -> exception queue

**Portfolio resolution:** Look up `Portfolio` by slug derived from the taxonomy node's root path segment (e.g., `foundational/data_and_storage_management/database` yields slug `"foundational"`). If no Portfolio exists for the slug, skip promotion and place entity in the exception queue instead.

**ProductId generation:**
- From entity name: `"PostgreSQL"` -> `"infra-postgresql"`
- From container name: `"dpf-neo4j-1"` -> `"infra-neo4j-core"` (strip compose suffix)
- Deduplication: check existing `DigitalProduct.productId` before creating

### 4.4 Exception Queue (Inventory Page Enhancement)

The existing `/inventory` page already shows `PortfolioQualityIssuesPanel`. Enhance it to be a proper exception queue:

**New component:** `InventoryExceptionQueue` (replaces/enhances `PortfolioQualityIssuesPanel`)

For each `InventoryEntity` with `attributionStatus = "needs_review"`:

1. **Show the entity** -- name, type, source, discovery timestamp
2. **Show candidate taxonomy matches** -- from `candidateTaxonomy` JSON field, ranked by score
3. **Actions:**
   - **Accept top match** -- set `taxonomyNodeId`, `attributionStatus = "attributed"`, trigger promotion
   - **Choose different node** -- taxonomy picker, manual assignment
   - **Dismiss** -- mark as `attributionStatus = "dismissed"` (not an infrastructure product)
   - **Ask AI Coworker** -- route to the AI Coworker on the inventory page for classification help

### 4.5 Change Detection (Staleness)

When a discovery sweep runs, entities NOT seen in the current sweep are marked `status = "stale"` (existing behavior in discovery-sync.ts). The staleness escalation uses `lastSeenAt` timestamps rather than consecutive-sweep counters -- simpler, no schema migration needed:

1. Entity `lastSeenAt` older than 1 hour (4 missed sweeps at 15-min interval) -> create `PortfolioQualityIssue` with `issueType = "stale_entity"`, severity `"warn"`
2. Entity `lastSeenAt` older than 4 hours -> escalate to severity `"error"`, flag the linked DigitalProduct for lifecycle review (do NOT auto-retire)
3. Surface stale entities prominently in the exception queue

**Retention:** Keep the last 100 `DiscoveryRun` records. Prune older runs during each full sweep.

### 4.6 Integration with Existing Systems

**Discovery pipeline flow (enhanced):**

```
Timer (60s / 15m)
  |
  v
Collectors: Host + Docker + Prometheus (NEW)
  |
  v
Normalize (existing discovery-normalize.ts)
  |
  v
Attribute (existing discovery-attribution.ts)
  |
  v
Persist (existing discovery-sync.ts)
  |
  v
Promote (NEW discovery-promotion.ts)  <-- auto-creates DigitalProducts
  |
  v
Quality Eval (existing) -> PortfolioQualityIssue for needs_review
  |
  v
Exception Queue (ENHANCED /inventory UI)
```

**Agent integration:**
- AGT-170 (monitoring-agent) gains a `discovery_sweep` tool grant to trigger on-demand sweeps
- AGT-171 (incident-detection-agent) can detect stale infrastructure and create incidents

## 5. File Changes

### New Files

| File | Purpose |
|---|---|
| `packages/db/src/discovery-collectors/prometheus.ts` | Prometheus target collector |
| `packages/db/src/discovery-promotion.ts` | Auto-promotion logic |
| `apps/web/lib/operate/discovery-scheduler.ts` | Timer-based scheduling |
| `apps/web/app/api/v1/discovery/sweep/route.ts` | API endpoint for manual/scheduled sweeps |
| `apps/web/components/inventory/InventoryExceptionQueue.tsx` | Enhanced exception queue UI |

### Modified Files

| File | Change |
|---|---|
| `packages/db/src/discovery-types.ts` | Add `"prometheus"` to `DiscoverySourceKind` and `CollectorName` unions |
| `packages/db/src/discovery-collectors/index.ts` | Export `collectPrometheusDiscovery` |
| `packages/db/src/discovery-attribution.ts` | Add `"dismissed"` to attribution status types; add `ai_service` and `application` rule-match branches |
| `packages/db/src/discovery-normalize.ts` | Add `"dismissed"` to `attributionStatus` union |
| `packages/db/src/discovery-runner.ts` | Add Prometheus to default collectors; call promotion after persist |
| `packages/db/src/discovery-sync.ts` | Skip dismissed entities in quality evaluation; add run retention pruning |
| `packages/db/src/index.ts` | Export `promoteInventoryEntities` and `collectPrometheusDiscovery` |
| `apps/web/lib/consume/discovery-data.ts` | Add query for needs_review entities with candidateTaxonomy |
| `apps/web/app/(shell)/inventory/page.tsx` | Wire in exception queue component |
| `packages/db/data/agent_registry.json` | Add `discovery_sweep` tool to AGT-170 |

## 6. Testing Strategy

### Unit Tests

| Test | What it verifies |
|---|---|
| `discovery-collectors/prometheus.test.ts` | Job-to-itemType classification, relationship creation, error handling |
| `discovery-promotion.test.ts` | Threshold logic, productId generation, dedup, portfolio resolution |
| `discovery-scheduler.test.ts` | Timer start/stop, error resilience, sweep triggering |

### Integration Tests

| Test | What it verifies |
|---|---|
| Prometheus collector + attribution | Targets flow through to correct taxonomy nodes |
| Full sweep + promotion | End-to-end: Prometheus target -> InventoryEntity -> DigitalProduct |
| Staleness detection | Entity not seen in N sweeps -> quality issue created |

### Manual Tests

| Test | Steps |
|---|---|
| M1: Scheduled discovery | Start platform, wait 15 min, verify `/inventory` shows entities |
| M2: New service detection | Start a new container, wait 60s, verify it appears |
| M3: Auto-promotion | Verify promoted entities appear in `/portfolio` tree |
| M4: Exception queue | Add an unknown service, verify it appears in exception queue |
| M5: Accept attribution | Click "Accept" on a needs_review entity, verify it promotes |

## 7. Success Criteria

- [ ] Discovery runs automatically every 15 minutes without manual trigger
- [ ] Prometheus targets appear as InventoryEntities within 60 seconds
- [ ] High-confidence entities (>= 0.90) auto-promote to DigitalProducts
- [ ] Auto-promoted products appear in the correct portfolio taxonomy node
- [ ] Low-confidence entities surface in the exception queue with candidate matches
- [ ] Stale entities (not seen in 3+ sweeps) generate quality issues
- [ ] All 9 current platform services discoverable and correctly attributed
- [ ] Exception queue allows accept/reassign/dismiss actions
