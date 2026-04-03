# Infrastructure Auto-Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically discover running infrastructure from Prometheus and Docker, attribute to the correct taxonomy node, and auto-promote high-confidence entities to DigitalProduct records so they appear in the portfolio tree.

**Architecture:** Extends the existing discovery pipeline (collectors -> normalize -> attribute -> persist) with a new Prometheus collector, an auto-promotion pass after persistence, and a timer-based scheduler. The `/inventory` exception queue surfaces low-confidence entities for human review.

**Tech Stack:** TypeScript, Prisma 7.x, Next.js 16 (instrumentation.ts), Prometheus HTTP API, existing `@dpf/db` discovery modules.

**Spec:** `docs/superpowers/specs/2026-04-02-infrastructure-auto-discovery-design.md`

---

### Task 1: Prometheus Target Collector

**Files:**
- Create: `packages/db/src/discovery-collectors/prometheus.ts`
- Create: `packages/db/src/discovery-collectors/prometheus.test.ts`
- Modify: `packages/db/src/discovery-collectors/index.ts`
- Modify: `packages/db/src/discovery-types.ts` (add "prometheus" to DiscoverySourceKind)

**Context:** Follow the pattern in `packages/db/src/discovery-collectors/docker.ts`. The collector receives a Prometheus base URL (defaulting to `http://prometheus:9090`), queries `/api/v1/targets`, and produces `CollectorOutput` items classified by job name.

- [ ] **Step 1: Write failing test** — Create `prometheus.test.ts` with tests for:
  - Classifies `postgres` job as `database` itemType
  - Classifies `neo4j` job as `database` itemType
  - Classifies `portal` job as `application` itemType
  - Classifies `model-runner` job as `ai_service` itemType
  - Classifies `cadvisor`/`node-exporter` as `monitoring_service`
  - Unknown job gets `service` itemType and confidence 0.5
  - Creates `monitors` relationship from prometheus self-target to all other targets
  - Returns empty output when Prometheus is unreachable
- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @dpf/db test -- prometheus.test`
- [ ] **Step 3: Implement `collectPrometheusDiscovery`** — Query `/api/v1/targets`, classify by job, build items + relationships. Use dependency injection for fetch (like docker.ts uses deps for socket/spawn). Classification map:
  ```typescript
  const JOB_CLASSIFICATION: Record<string, { itemType: string; confidence: number }> = {
    postgres: { itemType: "database", confidence: 0.95 },
    neo4j: { itemType: "database", confidence: 0.95 },
    qdrant: { itemType: "database", confidence: 0.95 },
    portal: { itemType: "application", confidence: 0.95 },
    sandbox: { itemType: "application", confidence: 0.90 },
    "model-runner": { itemType: "ai_service", confidence: 0.95 },
    cadvisor: { itemType: "monitoring_service", confidence: 0.95 },
    "node-exporter": { itemType: "monitoring_service", confidence: 0.95 },
    prometheus: { itemType: "monitoring_service", confidence: 0.95 },
  };
  ```
  Default: `{ itemType: "service", confidence: 0.5 }` for unrecognized jobs.
- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @dpf/db test -- prometheus.test`
- [ ] **Step 5: Wire into collectors barrel** — Add `export { collectPrometheusDiscovery } from "./prometheus"` to `discovery-collectors/index.ts`. Add `"prometheus"` to `DiscoverySourceKind` union in `discovery-types.ts`. Add `"prometheus"` to `CollectorName` type.
- [ ] **Step 6: Commit** — `feat(discovery): add Prometheus target collector`

---

### Task 2: Auto-Promotion Logic

**Files:**
- Create: `packages/db/src/discovery-promotion.ts`
- Create: `packages/db/src/discovery-promotion.test.ts`
- Modify: `packages/db/src/index.ts` (export new module)

**Context:** After `persistBootstrapDiscoveryRun` completes, a promotion pass scans `InventoryEntity` records. Entities with rule-based attribution (>= 0.90 confidence) and no existing `digitalProductId` are auto-promoted to `DigitalProduct` records.

- [ ] **Step 1: Write failing test** — Create `discovery-promotion.test.ts` with tests for:
  - Promotes entity with confidence >= 0.90 and taxonomyNodeId to DigitalProduct
  - Skips entity already linked to a DigitalProduct
  - Skips entity with confidence < 0.90
  - Skips entity with no taxonomyNodeId
  - Generates correct productId from entity name (slugify, prefix `infra-`)
  - Deduplicates: doesn't create if DigitalProduct with same productId exists
  - Resolves portfolioId from taxonomy node ancestry (walks up to root)
  - Sets lifecycleStage "production", lifecycleStatus "active"
  - Links entity back: sets `inventoryEntity.digitalProductId`
  - Returns promotion summary with counts
- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @dpf/db test -- discovery-promotion.test`
- [ ] **Step 3: Implement `promoteInventoryEntities`** — Query eligible entities, generate productId, upsert DigitalProduct, link back. Use a transaction for atomicity.
  ```typescript
  const AUTO_PROMOTE_THRESHOLD = 0.90;
  const PROMOTABLE_TYPES = ["host", "runtime", "container", "database", "monitoring_service", "ai_service", "application"];
  
  function generateProductId(entity: { entityType: string; name: string }): string {
    const slug = entity.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    return entity.entityType === "host" ? `host-${slug}` : `infra-${slug}`;
  }
  ```
- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @dpf/db test -- discovery-promotion.test`
- [ ] **Step 5: Export from package** — Add `export { promoteInventoryEntities } from "./discovery-promotion"` to `packages/db/src/index.ts`.
- [ ] **Step 6: Commit** — `feat(discovery): auto-promote high-confidence entities to DigitalProduct`

---

### Task 3: Enhanced Discovery Runner

**Files:**
- Modify: `packages/db/src/discovery-runner.ts`
- Modify: `packages/db/src/discovery-runner.test.ts` (if exists, else create)

**Context:** Extend `executeBootstrapDiscovery` to include the Prometheus collector and run auto-promotion after persistence.

- [ ] **Step 1: Write failing test** — Test that `runLocalDiscoveryCollectors` includes the Prometheus collector when a `prometheusUrl` option is provided. Test that promotion runs after persistence.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Modify `discovery-runner.ts`** — 
  - Add `collectPrometheusDiscovery` to the default collectors list in `runLocalDiscoveryCollectors`
  - Add `prometheusUrl` to `BootstrapExecutionOptions`
  - After `persist()` call, invoke `promoteInventoryEntities(db)` and merge its summary into the return value
  - The Prometheus collector needs a URL at runtime — pass it via options, default to `process.env.PROMETHEUS_URL ?? "http://prometheus:9090"`
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(discovery): wire Prometheus collector and auto-promotion into runner`

---

### Task 4: Discovery Scheduler

**Files:**
- Create: `apps/web/lib/operate/discovery-scheduler.ts`
- Create: `apps/web/lib/operate/discovery-scheduler.test.ts`
- Create: `apps/web/instrumentation.ts` (Next.js server startup hook)

**Context:** Use Next.js `instrumentation.ts` to start a timer on server boot. The timer runs a lightweight Prometheus target check every 60s and a full discovery sweep every 15 minutes. See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation.

- [ ] **Step 1: Write failing test** — Test `discovery-scheduler.ts`:
  - `startDiscoveryScheduler` sets intervals
  - `stopDiscoveryScheduler` clears intervals
  - `runPrometheusTargetCheck` fetches `/api/v1/targets` and detects new targets
  - `runFullDiscoverySweep` calls `executeBootstrapDiscovery` with `trigger: "scheduled"`
  - Error in sweep doesn't crash the scheduler (resilient)
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement scheduler** —
  ```typescript
  // apps/web/lib/operate/discovery-scheduler.ts
  const PROMETHEUS_POLL_INTERVAL_MS = 60_000;    // 60 seconds
  const FULL_SWEEP_INTERVAL_MS = 15 * 60_000;    // 15 minutes
  
  let prometheusTimer: ReturnType<typeof setInterval> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let knownTargetKeys = new Set<string>();
  
  export function startDiscoveryScheduler() { ... }
  export function stopDiscoveryScheduler() { ... }
  export async function runPrometheusTargetCheck() { ... }
  export async function runFullDiscoverySweep() { ... }
  ```
  - `runPrometheusTargetCheck`: fetch `${PROMETHEUS_URL}/api/v1/targets`, extract `job:instance` keys, compare to `knownTargetKeys`. If new keys found, trigger `runFullDiscoverySweep`.
  - `runFullDiscoverySweep`: call `executeBootstrapDiscovery(prisma, { trigger: "scheduled" })`. Wrap in try/catch — log errors, never throw.
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Create `instrumentation.ts`** —
  ```typescript
  // apps/web/instrumentation.ts
  export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { startDiscoveryScheduler } = await import("@/lib/operate/discovery-scheduler");
      startDiscoveryScheduler();
    }
  }
  ```
- [ ] **Step 6: Commit** — `feat(discovery): scheduled discovery with Prometheus polling`

---

### Task 5: Discovery Sweep API Endpoint

**Files:**
- Create: `apps/web/app/api/v1/discovery/sweep/route.ts`

**Context:** Provides an HTTP endpoint for manual and agent-triggered discovery sweeps. Requires `manage_provider_connections` permission (same as existing `triggerBootstrapDiscovery`).

- [ ] **Step 1: Write failing test** — Create `apps/web/lib/api/__tests__/discovery-endpoints.test.ts`:
  - POST returns 200 with summary on success
  - POST returns 401 without auth
  - POST returns 403 without required permission
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement route** —
  ```typescript
  // apps/web/app/api/v1/discovery/sweep/route.ts
  import { executeBootstrapDiscovery, prisma } from "@dpf/db";
  import { auth } from "@/lib/auth";
  import { can } from "@/lib/permissions";
  import { NextResponse } from "next/server";
  
  export async function POST() {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_provider_connections")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const summary = await executeBootstrapDiscovery(prisma as never, { trigger: "manual_api" });
    return NextResponse.json({ ok: true, summary });
  }
  ```
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(discovery): add POST /api/v1/discovery/sweep endpoint`

---

### Task 6: Exception Queue UI Enhancement

**Files:**
- Create: `apps/web/components/inventory/InventoryExceptionQueue.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx` (wire in new component)
- Create: `apps/web/lib/actions/inventory.ts` (server actions: accept, reassign, dismiss)

**Context:** Enhance the existing `/inventory` page to show a proper exception queue for entities with `attributionStatus = "needs_review"`. Each item shows candidate taxonomy matches and allows accept/reassign/dismiss actions.

- [ ] **Step 1: Create server actions** — `apps/web/lib/actions/inventory.ts`:
  - `acceptAttribution(entityId: string)` — sets `attributionStatus = "attributed"`, triggers promotion
  - `reassignTaxonomy(entityId: string, taxonomyNodeId: string)` — updates taxonomy, sets attributed, triggers promotion
  - `dismissEntity(entityId: string)` — sets `attributionStatus = "dismissed"`
  Each action requires auth + `manage_provider_connections` permission.
- [ ] **Step 2: Build `InventoryExceptionQueue` component** — Shows entities with `attributionStatus = "needs_review"`:
  - Entity name, type, source, first/last seen timestamps
  - Candidate taxonomy matches from `candidateTaxonomy` JSON, sorted by score
  - Accept button (top match), reassign dropdown (other candidates), dismiss button
  - Yellow warning banner showing count of items needing review
- [ ] **Step 3: Wire into inventory page** — Replace `PortfolioQualityIssuesPanel` with `InventoryExceptionQueue` + the existing quality issues below it. Query `needs_review` entities separately.
- [ ] **Step 4: Test manually** — Visit `/inventory`, verify exception queue renders, test accept/dismiss actions
- [ ] **Step 5: Commit** — `feat(inventory): exception queue for unattributed infrastructure entities`

---

### Task 7: Agent Tool Grant + Registry Update

**Files:**
- Modify: `packages/db/data/agent_registry.json` (add `discovery_sweep` to AGT-170 tool_grants)
- Modify: `apps/web/lib/tak/agent-grants.ts` (add `discovery_sweep` mapping if needed)

**Context:** Give AGT-170 (monitoring-agent) the ability to trigger discovery sweeps so the AI Coworker can run on-demand infrastructure scans.

- [ ] **Step 1: Add tool grant** — In `agent_registry.json`, add `"discovery_sweep"` to AGT-170's `tool_grants` array.
- [ ] **Step 2: Add grant mapping** — In `agent-grants.ts`, add `discovery_sweep: ["telemetry_read"]` (reuses existing permission).
- [ ] **Step 3: Commit** — `feat(agent): grant discovery_sweep tool to monitoring agent`

---

### Task 8: Integration Test + Full Regression

**Files:**
- Run: `pnpm --filter @dpf/db test`
- Run: `pnpm --filter web test`
- Run: `pnpm --filter web typecheck`
- Run: `pnpm --filter web build`

- [ ] **Step 1: Run @dpf/db tests** — All discovery tests pass
- [ ] **Step 2: Run web tests** — No new failures
- [ ] **Step 3: Run typecheck** — Zero errors from new code
- [ ] **Step 4: Run build** — Production build compiles successfully
- [ ] **Step 5: Manual verification** — Start platform, wait 60s, verify `/inventory` shows discovered entities. Check `/portfolio` shows auto-promoted products in correct taxonomy nodes.
- [ ] **Step 6: Commit any fixes** — Address any issues found during integration

---

## Execution Order

Tasks 1-2 are independent (can run in parallel).
Task 3 depends on Tasks 1+2.
Task 4 depends on Task 3.
Task 5 is independent (can run in parallel with Task 4).
Task 6 is independent (can run in parallel with Tasks 4+5).
Task 7 is independent.
Task 8 is the final integration gate.

```
Task 1 (Prometheus collector) ─┐
                                ├─> Task 3 (Enhanced runner) ─> Task 4 (Scheduler)
Task 2 (Auto-promotion)       ─┘                                     │
                                                                      v
Task 5 (API endpoint) ────────────────────────────────────> Task 8 (Integration)
Task 6 (Exception queue UI) ──────────────────────────────>      │
Task 7 (Agent grant) ─────────────────────────────────────>      │
```
