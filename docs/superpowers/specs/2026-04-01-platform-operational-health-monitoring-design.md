# Platform Operational Health Monitoring (EP-FULL-OBS)

**Date:** 2026-04-01
**Status:** Draft
**Epic:** EP-FULL-OBS (Full Observability — referenced as deferred in EP-FOUND-OPS §7)
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-21-foundation-portfolio-operations-console-design.md` (HealthProbe, HealthSnapshot, HealthRollup models, probe executors, operations console)
- `docs/superpowers/specs/2026-03-13-bootstrap-infrastructure-discovery-and-portfolio-quality-foundation-design.md` (InventoryEntity, DiscoveryRun)
- `docs/superpowers/specs/2026-03-15-calendar-infrastructure-design.md` (CalendarEvent for scheduling)
- `docs/architecture/trusted-ai-kernel.md` (TAK governance, HR-500 authority domain)

**IT4IT Alignment:** SS5.7 Operate — Detect to Correct value stream. Provides the instrumentation layer that feeds health data into the Operations Console (EP-FOUND-OPS), enables change impact assessment (EP-CHG-MGMT), and closes the performance feedback loop back to portfolio decisions (SS5.1 Evaluate).

## Problem Statement

The platform runs a Docker Compose stack of 10+ services (postgres, neo4j, qdrant, portal, sandbox pool ×3, sandbox-postgres, promoter, plus Docker Model Runner for AI inference). Today, the only visibility into operational health is:

1. **Docker healthchecks** — binary pass/fail, visible only via `docker ps` or the Docker Desktop UI. No history, no trending, no thresholds.
2. **`/api/health`** — returns `{status: "ok"}`. No resource data, no dependency health.
3. **Token usage logging** — `TokenUsage` table captures inference cost but not latency distribution, error rates, or provider availability.
4. **Process observer** — detects conversational friction signals but not infrastructure degradation.

**What's missing:** CPU, memory, and disk utilization per container and host. AI Coworker semantic memory (Qdrant) growth and query performance. Database connection pool saturation. Inference latency percentiles. Container restart frequency. Disk pressure warnings before they cause outages.

**The incident that triggered this:** The AI Coworker's semantic memory subsystem (Qdrant-backed) was completely non-functional for an unknown period. No alert fired. No dashboard showed the failure. The team discovered it by accident during unrelated testing. This is the canonical case for why lightweight probes (EP-FOUND-OPS) are necessary but insufficient — the platform needs continuous metrics collection, historical dashboards, and threshold-based alerting.

### IT4IT Detect to Correct Flow

```
Detect → Diagnose → Change → Resolve → Close
  │          │          │        │         │
  │          │          │        │         └─ RFC closed, post-change verification
  │          │          │        └─ Deployment executes, health probes verify
  │          │          └─ RFC created with impact analysis (EP-CHG-MGMT)
  │          └─ Grafana dashboards + dependency graph pinpoint root cause
  └─ Prometheus alerts on threshold breach → PortfolioQualityIssue created
```

This spec covers the **Detect** and **Diagnose** phases. The downstream phases (Change, Resolve, Close) are handled by EP-CHG-MGMT and EP-FOUND-OPS.

---

## Design Summary

Integrate an open-source monitoring stack into the Docker Compose environment behind a `monitoring` profile, wire the Next.js application with custom metrics, and surface operational health through auto-provisioned Grafana dashboards. The monitoring stack feeds data into the existing `HealthProbe`/`HealthSnapshot` models so the Operations Console (EP-FOUND-OPS) remains the single pane of glass for platform operators.

### Key Principles

- **Always-on by default** — monitoring services start with the core stack via `docker compose up`. They are headless infrastructure that feeds the platform's native dashboards, alert pipeline, and AI Coworker health indicators.
- **Auto-provisioned, not manually configured** — Grafana datasources, dashboards, and alert rules are provisioned via config files mounted at startup. No manual setup after `docker compose --profile monitoring up`.
- **Lightweight first** — the Tier 1 stack adds ~175–350 MB RAM. Tier 2 and Tier 3 are additive and deferred.
- **Feed the existing models** — metrics flow into `HealthProbe`/`HealthSnapshot` via a bridge service, so the Operations Console renders real Prometheus-sourced data without duplicating storage.
- **Deployment-agnostic metrics** — application metrics use `prom-client` (OpenMetrics standard). If the platform moves to Kubernetes, the same `/api/metrics` endpoint is scraped by the same Prometheus — no code changes.

---

## Section 1: Monitoring Stack Architecture

### 1.1 Tier 1 — Essential (this spec)

| Service | Docker Image | Purpose | Resource Estimate |
|---------|-------------|---------|-------------------|
| **prometheus** | `prom/prometheus:latest` | Metrics collection, storage, alerting rules | ~100–200 MB RAM |
| **grafana** | `grafana/grafana-oss:latest` | Dashboards, visualization, built-in alerting | ~50–100 MB RAM |
| **cadvisor** | `gcr.io/cadvisor/cadvisor:latest` | Per-container CPU, memory, network, disk I/O | ~15–30 MB RAM |
| **node-exporter** | `prom/node-exporter:latest` | Host OS metrics (total CPU, memory, disk, network) | ~10–20 MB RAM |
| **postgres-exporter** | `prometheuscommunity/postgres-exporter:latest` | PostgreSQL query performance, connection pools, replication | ~10–20 MB RAM |

Plus **prom-client** (npm package, no container) integrated into the Next.js portal for application-level metrics.

**Native exporters (no additional containers):**
- **Neo4j** — exposes Prometheus metrics natively at `:2004/metrics` (requires `NEO4J_server_metrics_prometheus_enabled=true`)
- **Qdrant** — exposes `/metrics` on port 6333 natively (already accessible)
- **Docker Model Runner** — exposes `/metrics` at `model-runner.docker.internal/metrics`

### 1.2 Tier 2 — Log Aggregation (deferred, future spec)

| Service | Docker Image | Purpose |
|---------|-------------|---------|
| **loki** | `grafana/loki:latest` | Log storage and indexing (label-based, storage-efficient) |
| **alloy** | `grafana/alloy:latest` | Log shipping from containers to Loki (replaces deprecated Promtail) |

### 1.3 Tier 3 — Distributed Tracing (deferred, future spec)

| Service | Docker Image | Purpose |
|---------|-------------|---------|
| **otel-collector** | `otel/opentelemetry-collector-contrib:latest` | Trace collection and export |
| **tempo** | `grafana/tempo:latest` | Trace storage, queryable from Grafana |

### 1.4 Network Topology

All monitoring services join the default `dpf` network (same as application services) so they can scrape metrics endpoints directly by service name.

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Compose Network: dpf                                    │
│                                                                 │
│  Application Services          Monitoring Services              │
│  ┌──────────┐                  ┌──────────────┐                 │
│  │ portal   │◄─── scrape ──────│ prometheus   │                 │
│  │ :3000    │  /api/metrics    │ :9090        │                 │
│  └──────────┘                  └──────┬───────┘                 │
│  ┌──────────┐                         │                         │
│  │ postgres │◄── postgres-exporter ───┤                         │
│  │ :5432    │                         │                         │
│  └──────────┘                         │  ┌──────────────┐       │
│  ┌──────────┐                         ├──│ grafana      │       │
│  │ neo4j    │◄─── scrape :2004 ───────┤  │ :3002        │       │
│  │ :7474    │                         │  └──────────────┘       │
│  └──────────┘                         │                         │
│  ┌──────────┐                         │  ┌──────────────┐       │
│  │ qdrant   │◄─── scrape :6333 ───────┤  │ cadvisor     │       │
│  │ :6333    │                         │  │ :8080        │       │
│  └──────────┘                         │  └──────────────┘       │
│  ┌──────────┐                         │                         │
│  │ sandbox  │◄─── scrape ─────────────┤  ┌──────────────┐       │
│  │ ×3      │                         │  │ node-exporter│       │
│  └──────────┘                         │  │ :9100        │       │
│                                       │  └──────────────┘       │
│  ┌──────────────────┐                 │                         │
│  │ model-runner     │◄── scrape ──────┘                         │
│  │ (Docker Desktop) │                                           │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Section 2: Docker Compose Integration

### 2.1 Profile Definition

All monitoring services use `profiles: ["monitoring"]` so they are excluded from the default `docker compose up` but included with:

```bash
docker compose --profile monitoring up -d
```

### 2.2 Service Definitions

```yaml
  # ─── Monitoring Stack (profile: monitoring) ───────────────────────────────

  prometheus:
    image: prom/prometheus:latest
    profiles: ["monitoring"]
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"
      - "--web.enable-lifecycle"
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:9090/-/healthy"]
      interval: 10s
      timeout: 5s
      retries: 3

  grafana:
    image: grafana/grafana-oss:latest
    profiles: ["monitoring"]
    restart: unless-stopped
    ports:
      - "3001:3000"
    volumes:
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_data:/var/lib/grafana
    environment:
      GF_SECURITY_ADMIN_USER: ${GF_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GF_ADMIN_PASSWORD:-dpf_monitor}
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/dpf-overview.json
    depends_on:
      prometheus:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    profiles: ["monitoring"]
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /sys:/sys:ro
      - /var/lib/docker:/var/lib/docker:ro
    privileged: true

  node-exporter:
    image: prom/node-exporter:latest
    profiles: ["monitoring"]
    restart: unless-stopped
    ports:
      - "9100:9100"
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - "--path.procfs=/host/proc"
      - "--path.sysfs=/host/sys"
      - "--path.rootfs=/rootfs"
      - "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)"

  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    profiles: ["monitoring"]
    restart: unless-stopped
    ports:
      - "9187:9187"
    environment:
      DATA_SOURCE_NAME: "postgresql://${POSTGRES_USER:-dpf}:${POSTGRES_PASSWORD:-dpf_dev}@postgres:5432/dpf?sslmode=disable"
    depends_on:
      postgres:
        condition: service_healthy
```

### 2.3 Volumes

```yaml
volumes:
  prometheus_data:
  grafana_data:
  # ... existing volumes unchanged
```

### 2.4 Neo4j Metrics Enablement

Add to the existing `neo4j` service environment:

```yaml
  neo4j:
    environment:
      # ... existing env vars
      NEO4J_server_metrics_prometheus_enabled: "true"
      NEO4J_server_metrics_prometheus_endpoint: "0.0.0.0:2004"
```

---

## Section 3: Prometheus Configuration

### 3.1 Scrape Configuration

File: `monitoring/prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alerts.yml"

scrape_configs:
  # ─── Infrastructure ──────────────────────────────────────────
  - job_name: "cadvisor"
    scrape_interval: 10s
    static_configs:
      - targets: ["cadvisor:8080"]

  - job_name: "node-exporter"
    scrape_interval: 10s
    static_configs:
      - targets: ["node-exporter:9100"]

  # ─── Databases ───────────────────────────────────────────────
  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]

  - job_name: "neo4j"
    scrape_interval: 30s
    static_configs:
      - targets: ["neo4j:2004"]
    metrics_path: /metrics

  - job_name: "qdrant"
    scrape_interval: 30s
    static_configs:
      - targets: ["qdrant:6333"]
    metrics_path: /metrics

  # ─── Application ────────────────────────────────────────────
  - job_name: "portal"
    static_configs:
      - targets: ["portal:3000"]
    metrics_path: /api/metrics

  - job_name: "sandbox"
    static_configs:
      - targets:
          - "sandbox:3000"
          - "sandbox-2:3000"
          - "sandbox-3:3000"
    metrics_path: /api/metrics

  # ─── AI Inference ───────────────────────────────────────────
  - job_name: "model-runner"
    scrape_interval: 30s
    static_configs:
      - targets: ["model-runner.docker.internal:80"]
    metrics_path: /metrics

  # ─── Self-monitoring ────────────────────────────────────────
  - job_name: "prometheus"
    scrape_interval: 30s
    static_configs:
      - targets: ["localhost:9090"]
```

### 3.2 Alert Rules

File: `monitoring/prometheus/alerts.yml`

```yaml
groups:
  - name: dpf_infrastructure
    rules:
      # ─── Container Health ──────────────────────────────────
      - alert: ContainerDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.job }} is down"
          description: "{{ $labels.instance }} has been unreachable for > 1 minute."

      - alert: ContainerHighCPU
        expr: rate(container_cpu_usage_seconds_total{name=~"dpf-.*"}[5m]) * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Container {{ $labels.name }} CPU > 80%"

      - alert: ContainerHighMemory
        expr: container_memory_usage_bytes{name=~"dpf-.*"} / container_spec_memory_limit_bytes{name=~"dpf-.*"} * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Container {{ $labels.name }} memory > 85%"

      - alert: ContainerRestarting
        expr: increase(container_restart_count{name=~"dpf-.*"}[1h]) > 3
        labels:
          severity: warning
        annotations:
          summary: "Container {{ $labels.name }} restarted {{ $value }} times in 1h"

      # ─── Host Resources ───────────────────────────────────
      - alert: HostHighCPU
        expr: 100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Host CPU usage > 85% for 10 minutes"

      - alert: HostHighMemory
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Host memory usage > 85%"

      - alert: HostDiskPressure
        expr: (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Host disk usage > 80%"

      - alert: HostDiskCritical
        expr: (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 > 90
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Host disk usage > 90% — immediate attention required"

  - name: dpf_databases
    rules:
      - alert: PostgresConnectionSaturation
        expr: pg_stat_activity_count / pg_settings_max_connections * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL connection pool > 80% ({{ $value }}%)"

      - alert: PostgresDown
        expr: pg_up == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is unreachable"

      - alert: QdrantDown
        expr: up{job="qdrant"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Qdrant vector DB is unreachable — AI Coworker memory offline"

  - name: dpf_application
    rules:
      - alert: HighRequestLatency
        expr: histogram_quantile(0.95, rate(dpf_http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "95th percentile request latency > 5s"

      - alert: HighErrorRate
        expr: rate(dpf_http_requests_total{status_code=~"5.."}[5m]) / rate(dpf_http_requests_total[5m]) * 100 > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "HTTP 5xx error rate > 5%"

      - alert: AIInferenceDown
        expr: up{job="model-runner"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Docker Model Runner is unreachable — all AI inference offline"

      - alert: AIInferenceHighLatency
        expr: histogram_quantile(0.95, rate(dpf_ai_inference_duration_seconds_bucket[5m])) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "AI inference p95 latency > 30s"

      - alert: SemanticMemoryStoreFailures
        expr: rate(dpf_semantic_memory_errors_total[5m]) > 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Semantic memory store/recall failing — AI Coworker context degraded"
```

---

## Section 4: Application Metrics (prom-client)

### 4.1 Package Addition

Add `prom-client` to `apps/web/package.json`:

```bash
pnpm --filter web add prom-client
```

### 4.2 Metrics Registry

File: `apps/web/lib/metrics.ts`

```typescript
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();

// Collect Node.js runtime metrics (heap, GC, event loop lag, active handles)
collectDefaultMetrics({ register: metricsRegistry, prefix: "dpf_" });

// ─── HTTP Request Metrics ───────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: "dpf_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: "dpf_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegistry],
});

// ─── AI Inference Metrics ───────────────────────────────────────────────────

export const aiInferenceDuration = new Histogram({
  name: "dpf_ai_inference_duration_seconds",
  help: "AI inference call duration in seconds",
  labelNames: ["provider", "model", "agent"],
  buckets: [0.5, 1, 2.5, 5, 10, 20, 30, 60, 120],
  registers: [metricsRegistry],
});

export const aiInferenceTokens = new Counter({
  name: "dpf_ai_inference_tokens_total",
  help: "Total tokens consumed by AI inference",
  labelNames: ["provider", "model", "direction"], // direction: input | output
  registers: [metricsRegistry],
});

export const aiInferenceErrors = new Counter({
  name: "dpf_ai_inference_errors_total",
  help: "Total AI inference errors",
  labelNames: ["provider", "model", "error_type"],
  registers: [metricsRegistry],
});

export const aiInferenceCostUsd = new Counter({
  name: "dpf_ai_inference_cost_usd_total",
  help: "Cumulative AI inference cost in USD",
  labelNames: ["provider", "model"],
  registers: [metricsRegistry],
});

// ─── Semantic Memory Metrics ────────────────────────────────────────────────

export const semanticMemoryOps = new Counter({
  name: "dpf_semantic_memory_ops_total",
  help: "Semantic memory operations",
  labelNames: ["operation", "status"], // operation: store | recall, status: success | error
  registers: [metricsRegistry],
});

export const semanticMemoryErrors = new Counter({
  name: "dpf_semantic_memory_errors_total",
  help: "Semantic memory operation errors",
  labelNames: ["operation"],
  registers: [metricsRegistry],
});

export const semanticMemoryLatency = new Histogram({
  name: "dpf_semantic_memory_duration_seconds",
  help: "Semantic memory operation duration",
  labelNames: ["operation"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [metricsRegistry],
});

// ─── Sandbox Metrics ────────────────────────────────────────────────────────

export const sandboxBuildsActive = new Gauge({
  name: "dpf_sandbox_builds_active",
  help: "Number of active sandbox builds",
  registers: [metricsRegistry],
});

export const sandboxBuildDuration = new Histogram({
  name: "dpf_sandbox_build_duration_seconds",
  help: "Sandbox build duration",
  labelNames: ["phase"], // build | review | ship
  buckets: [10, 30, 60, 120, 300, 600, 1800],
  registers: [metricsRegistry],
});

// ─── Database Connection Metrics ────────────────────────────────────────────

export const dbQueryDuration = new Histogram({
  name: "dpf_db_query_duration_seconds",
  help: "Database query duration",
  labelNames: ["operation"], // findMany, create, update, delete, etc.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

export const dbQueryErrors = new Counter({
  name: "dpf_db_query_errors_total",
  help: "Database query errors",
  labelNames: ["operation"],
  registers: [metricsRegistry],
});

// ─── Process Observer Metrics ───────────────────────────────────────────────

export const observerFindings = new Counter({
  name: "dpf_observer_findings_total",
  help: "Process observer findings by type and severity",
  labelNames: ["type", "severity"],
  registers: [metricsRegistry],
});
```

### 4.3 Metrics API Endpoint

File: `apps/web/app/api/metrics/route.ts`

```typescript
import { NextResponse } from "next/server";
import { metricsRegistry } from "@/lib/metrics";

export async function GET() {
  const metrics = await metricsRegistry.metrics();
  return new NextResponse(metrics, {
    headers: { "Content-Type": metricsRegistry.contentType },
  });
}
```

**Access control:** The `/api/metrics` endpoint should not be exposed externally. In production, it is only accessible within the Docker network (Prometheus scrapes by container name, not by published port). The endpoint does not require authentication because it contains no PII — only aggregate counters and histograms.

### 4.4 Instrumentation Points

The following existing code paths need metric instrumentation:

| File | What to Instrument | Metric |
|------|-------------------|--------|
| `lib/ai-inference.ts` `callLLM()` | Inference duration, token counts, errors, cost | `aiInferenceDuration`, `aiInferenceTokens`, `aiInferenceErrors`, `aiInferenceCostUsd` |
| `lib/semantic-memory.ts` `storeConversationMemory()` | Store latency, success/error count | `semanticMemoryOps`, `semanticMemoryErrors`, `semanticMemoryLatency` |
| `lib/semantic-memory.ts` `recallRelevantContext()` | Recall latency, result count, errors | `semanticMemoryOps`, `semanticMemoryErrors`, `semanticMemoryLatency` |
| `lib/process-observer.ts` `detectSignals()` | Finding counts by type/severity | `observerFindings` |
| Next.js middleware or API route wrapper | Request duration, status codes | `httpRequestDuration`, `httpRequestsTotal` |

**Instrumentation pattern** — wrap existing function bodies, do not refactor:

```typescript
// Example: in ai-inference.ts callLLM()
const timer = aiInferenceDuration.startTimer({ provider, model, agent });
try {
  const result = await originalCallLogic();
  aiInferenceTokens.inc({ provider, model, direction: "input" }, result.usage.inputTokens);
  aiInferenceTokens.inc({ provider, model, direction: "output" }, result.usage.outputTokens);
  timer(); // records duration
  return result;
} catch (err) {
  aiInferenceErrors.inc({ provider, model, error_type: err.constructor.name });
  timer(); // records duration even on error
  throw err;
}
```

---

## Section 5: Grafana Auto-Provisioning

### 5.1 Directory Structure

```
monitoring/
├── prometheus/
│   ├── prometheus.yml          # Scrape config (§3.1)
│   └── alerts.yml              # Alert rules (§3.2)
└── grafana/
    ├── provisioning/
    │   ├── datasources/
    │   │   └── prometheus.yml  # Auto-register Prometheus datasource
    │   ├── dashboards/
    │   │   └── dashboards.yml  # Dashboard provider config
    │   └── alerting/
    │       └── alerts.yml      # Grafana alert notification channels
    └── dashboards/
        ├── dpf-overview.json           # Platform overview (home dashboard)
        ├── dpf-containers.json         # Per-container CPU/memory/network
        ├── dpf-host.json               # Host OS resources
        ├── dpf-postgres.json           # PostgreSQL performance
        ├── dpf-ai-inference.json       # AI inference latency/tokens/cost
        ├── dpf-semantic-memory.json    # Qdrant/semantic memory health
        └── dpf-sandbox.json            # Sandbox build lifecycle
```

### 5.2 Datasource Provisioning

File: `monitoring/grafana/provisioning/datasources/prometheus.yml`

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

### 5.3 Dashboard Provider

File: `monitoring/grafana/provisioning/dashboards/dashboards.yml`

```yaml
apiVersion: 1
providers:
  - name: DPF
    orgId: 1
    folder: DPF Platform
    type: file
    disableDeletion: true
    editable: false
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

### 5.4 Dashboard Specifications

#### DPF Overview (Home Dashboard)

The primary operational health surface. Rows:

| Row | Panels | Data Source |
|-----|--------|-------------|
| **Platform Status** | Service up/down indicators for all services (portal, postgres, neo4j, qdrant, model-runner, sandboxes) | Prometheus `up` metric |
| **Host Resources** | CPU gauge, Memory gauge, Disk gauge, Network throughput | node-exporter |
| **Container Resources** | CPU and memory per container (stacked bar or table) | cAdvisor |
| **AI Inference** | Inference rate (req/s), p95 latency, error rate, cumulative cost | prom-client `dpf_ai_*` |
| **Semantic Memory** | Store/recall rate, error rate, p95 latency | prom-client `dpf_semantic_memory_*` |
| **Database** | Active connections, connection pool utilization, query latency | postgres-exporter |
| **Active Alerts** | Firing alerts list | Prometheus alerting API |

#### Per-Container Dashboard

- Dropdown selector: container name
- CPU usage (rate), memory usage (bytes + percentage), network I/O (bytes/s), disk I/O (bytes/s), restart count
- All from cAdvisor metrics

#### AI Inference Dashboard

- Provider/model selector
- Request rate, token rate (input/output), p50/p95/p99 latency, error rate by type
- Cost accumulation over time (daily/weekly/monthly)
- Token budget burn rate

#### Semantic Memory Dashboard

- Store/recall operation rates
- Latency distribution (heatmap)
- Error rate with alert threshold overlay
- Qdrant collection size (from Qdrant native metrics: `collections_total_points`)

---

## Section 6: HealthProbe Bridge

### 6.1 Purpose

The EP-FOUND-OPS Operations Console reads health data from `HealthProbe`/`HealthSnapshot` models. Rather than duplicating metric collection, a bridge service periodically queries Prometheus and writes `HealthSnapshot` records, so the Operations Console works with Prometheus-sourced data.

### 6.2 Bridge Logic

Implemented as a scheduled platform task (using the existing `ScheduledJob` model):

```
Job: prometheus-health-bridge
Schedule: every 5 minutes
Logic:
  1. For each HealthProbe where probeType = 'container' | 'database' | 'service':
     a. Query Prometheus for the relevant metrics (via Prometheus HTTP API)
     b. Evaluate thresholds defined in HealthProbe.thresholds
     c. Derive status: healthy | warning | critical | unreachable
     d. Create HealthSnapshot with metrics JSON and derived status
  2. If Prometheus is unreachable, create snapshots with status = 'unknown'
     and message = 'Monitoring stack offline'
```

### 6.3 Prometheus Query Mapping

| Probe Type | Prometheus Query | Metrics Extracted |
|-----------|-----------------|-------------------|
| `container` | `container_cpu_usage_seconds_total{name=~"dpf-$name"}` | `cpu_pct` |
| `container` | `container_memory_usage_bytes{name=~"dpf-$name"}` | `mem_bytes`, `mem_pct` |
| `container` | `container_fs_usage_bytes{name=~"dpf-$name"}` | `disk_used_bytes` |
| `database` | `pg_up`, `pg_stat_activity_count`, `pg_settings_max_connections` | `accepting_connections`, `active_connections`, `max_connections` |
| `database` (qdrant) | `up{job="qdrant"}`, `collections_total_points` | `reachable`, `total_vectors` |
| `service` | `up{job="portal"}`, `dpf_http_request_duration_seconds` | `reachable`, `response_ms` |
| `service` (AI) | `up{job="model-runner"}`, `dpf_ai_inference_duration_seconds` | `reachable`, `inference_ms` |

### 6.4 Graceful Degradation

- If the monitoring profile is not active (Prometheus not running), the bridge job detects this on first attempt and sets `lastError = "Prometheus unreachable"`. It does not create false `critical` snapshots.
- The Operations Console continues to work with whatever snapshots exist — it is not dependent on the monitoring stack being up.
- The existing Docker healthcheck-based probes (from EP-FOUND-OPS) continue to function independently of Prometheus.

---

## Section 7: Alerting Integration

### 7.1 Grafana Built-In Alerting

For a single-machine deployment, Grafana's built-in alerting replaces the need for a separate Alertmanager. Alert rules are provisioned via config files.

### 7.2 Notification Channels (Initial)

| Channel | Purpose | Configuration |
|---------|---------|---------------|
| **Grafana UI** | In-dashboard alert badges and alert list panel | Default, always available |
| **PortfolioQualityIssue** | Platform-native alerting via webhook | Grafana webhook → `/api/platform/alerts` |

### 7.3 Platform Alert Webhook

New API endpoint: `POST /api/platform/alerts`

Receives Grafana webhook alert notifications and creates `PortfolioQualityIssue` records:

```typescript
// Mapping: Grafana alert → PortfolioQualityIssue
{
  portfolioId: foundationPortfolioId,
  issueType: "health_alert",
  severity: alert.labels.severity === "critical" ? "error" : "warn",
  title: alert.annotations.summary,
  description: alert.annotations.description,
  status: alert.status === "firing" ? "open" : "resolved",
  firstDetected: alert.startsAt,
  lastDetected: alert.endsAt || now(),
  autoResolvable: true,
}
```

This ensures operational alerts appear in the Operations Console Quality tab alongside other quality issues, maintaining a single pane of glass.

### 7.4 Future Notification Channels (deferred)

- Email notification (when SMTP is configured)
- Slack webhook
- PagerDuty integration
- Microsoft Teams webhook

---

## Section 8: Key Metrics Catalog

Complete catalog of metrics collected across all tiers, organized by operational concern:

### 8.1 Host Resources (node-exporter)

| Metric | What It Tells You | Alert Threshold |
|--------|------------------|-----------------|
| CPU utilization % | Overall host compute pressure | Warning: 85% for 10m |
| Memory utilization % | RAM pressure, swap risk | Warning: 85% for 5m |
| Disk utilization % | Storage exhaustion risk | Warning: 80%, Critical: 90% |
| Network throughput | Bandwidth saturation | No default alert |
| Disk I/O wait | Storage bottleneck | No default alert |

### 8.2 Container Resources (cAdvisor)

| Metric | What It Tells You | Alert Threshold |
|--------|------------------|-----------------|
| CPU usage per container | Which service is compute-heavy | Warning: 80% for 5m |
| Memory usage per container | Memory leaks, oversized heaps | Warning: 85% for 5m |
| Network I/O per container | Inter-service traffic patterns | No default alert |
| Restart count | Service instability | Warning: 3 restarts/hour |
| Container uptime | Service availability | Implicit via `up` metric |

### 8.3 AI Inference (prom-client)

| Metric | What It Tells You | Alert Threshold |
|--------|------------------|-----------------|
| Inference request rate | AI workload volume | No default alert |
| Inference p95 latency | User-perceived AI responsiveness | Warning: 30s |
| Inference error rate | Provider failures, model issues | Warning: any sustained errors |
| Token consumption rate | Cost trajectory | No default alert |
| Cost accumulation (USD) | Budget burn rate | No default alert (operator sets) |
| Provider availability | Can the AI Coworker function? | Critical: model-runner down 2m |

### 8.4 Semantic Memory (prom-client)

| Metric | What It Tells You | Alert Threshold |
|--------|------------------|-----------------|
| Store/recall operation rate | Memory system utilization | No default alert |
| Store/recall p95 latency | Vector search performance | No default alert |
| Error rate | **The metric that would have caught the outage** | Critical: any errors for 2m |
| Qdrant collection size | Memory growth, capacity planning | No default alert |

### 8.5 Database (postgres-exporter)

| Metric | What It Tells You | Alert Threshold |
|--------|------------------|-----------------|
| Active connections | Pool utilization | Warning: 80% of max |
| Connection pool saturation | Prisma pool exhaustion risk | Warning: 80% |
| Query latency | Database performance | No default alert |
| Database up/down | Core dependency availability | Critical: down 30s |
| Replication lag | Backup health (future) | No default alert |

---

## Section 9: Platform-Native Monitoring Experience

### 9.0 Design Philosophy

**The platform IS the monitoring surface.** Operators should never need to leave the DPF portal to understand platform health. Grafana remains available as a power-user deep-dive tool, but the primary experience is fully integrated into the Operations Console using native React components that render real-time data from Prometheus.

This means:
- The portal queries Prometheus directly via a server-side proxy API (no iframe embeds, no external links as primary UX)
- Charts, gauges, status grids, and timelines are platform-native components styled consistently with the rest of the UI
- Alert state is visible inline — not in a separate tool
- Drill-down from high-level status to per-service detail happens within the platform's tab navigation

Grafana at `:3002` is an optional advanced tool for custom queries, ad-hoc exploration, and PromQL debugging. It is not part of the operator's standard workflow.

### 9.1 Prometheus Proxy API

The portal cannot query Prometheus from the browser (CORS, network isolation). A server-side proxy routes queries through the portal's API layer.

#### Endpoint: `GET /api/platform/metrics`

```typescript
// apps/web/app/api/platform/metrics/route.ts
//
// Proxies PromQL queries to Prometheus running inside the Docker network.
// Accepts the same query parameters as Prometheus HTTP API:
//   ?query=up                              (instant query)
//   ?query=rate(dpf_ai_inference_duration_seconds_count[5m])&start=...&end=...&step=15s  (range query)
//   ?type=instant|range                    (default: instant)

import { NextRequest, NextResponse } from "next/server";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const type = req.nextUrl.searchParams.get("type") || "instant";
  const endpoint = type === "range" ? "/api/v1/query_range" : "/api/v1/query";

  // Forward all query params to Prometheus
  const promUrl = new URL(endpoint, PROMETHEUS_URL);
  promUrl.searchParams.set("query", query);
  for (const [key, val] of req.nextUrl.searchParams.entries()) {
    if (key !== "type" && key !== "query") promUrl.searchParams.set(key, val);
  }

  try {
    const res = await fetch(promUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { status: "error", error: "Monitoring stack unreachable" },
      { status: 503 }
    );
  }
}
```

#### Endpoint: `GET /api/platform/metrics/alerts`

Returns currently firing alerts from Prometheus:

```typescript
// Proxies to Prometheus /api/v1/alerts
// Returns: { alerts: [{ labels, annotations, state, activeAt }] }
```

#### Endpoint: `GET /api/platform/metrics/targets`

Returns scrape target health from Prometheus:

```typescript
// Proxies to Prometheus /api/v1/targets
// Returns: { activeTargets: [{ labels, health, lastScrape }] }
```

### 9.2 React Chart Components

Native chart components using a lightweight charting library (Recharts, already common in Next.js projects, or lightweight alternatives like uPlot for time-series performance).

#### Component Library

| Component | Props | Renders |
|-----------|-------|---------|
| `<MetricGauge>` | `query`, `label`, `thresholds: {warning, critical}`, `unit` | Radial gauge with green/amber/red zones. Used for CPU %, Memory %, Disk %. |
| `<MetricTimeSeries>` | `query`, `label`, `duration` (1h/6h/24h/7d), `unit` | Line chart with time axis. Used for latency, request rate, token consumption. |
| `<ServiceStatusGrid>` | `services: {name, job}[]` | Grid of colored status indicators (green/amber/red/grey) with service names. Queries `up{job=...}` for each. |
| `<AlertBanner>` | (none — self-fetching) | Dismissible banner at top of page showing firing critical/warning alerts. Polls `/api/platform/metrics/alerts`. |
| `<MetricStat>` | `query`, `label`, `unit`, `format` | Single big number with label (e.g., "Active Connections: 12/100"). |
| `<MetricTable>` | `queries: {label, query, unit}[]` | Table of metric name → current value. Used for per-container resource comparison. |
| `<SparkLine>` | `query`, `duration` | Tiny inline chart for embedding in tables or status grids. |

All components:
- Call `/api/platform/metrics` on mount and on a configurable refresh interval (default: 15s)
- Show a "Monitoring offline" placeholder when the proxy returns 503
- Accept a `className` prop for consistent platform styling

#### File Location

```
apps/web/components/monitoring/
├── MetricGauge.tsx
├── MetricTimeSeries.tsx
├── ServiceStatusGrid.tsx
├── AlertBanner.tsx
├── MetricStat.tsx
├── MetricTable.tsx
├── SparkLine.tsx
├── useMetricQuery.ts          # React hook: polls /api/platform/metrics
└── useMetricRangeQuery.ts     # React hook: polls range queries
```

### 9.3 Operations Console — System Health Tab

The Operations Console at `/portfolio/foundational/ops` gains a **System Health** tab as the **default landing tab** — because if the platform is unhealthy, nothing else matters.

#### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  [System Health] [Overview] [Containers] [Databases] [Services] ... │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Alert Banner (if any alerts firing) ───────────────────────┐   │
│  │  ⚠ HostDiskPressure: Host disk usage > 80%       [Dismiss]  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ─── Platform Services ────────────────────────────────────────     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ Portal │ │Postgres│ │ Neo4j  │ │ Qdrant │ │  AI    │           │
│  │   🟢   │ │   🟢   │ │   🟢   │ │   🔴   │ │   🟢   │           │
│  │  45ms  │ │ 12/100 │ │  8 qps │ │  DOWN  │ │ 2.1s   │           │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘           │
│  ┌────────┐ ┌────────┐ ┌────────┐                                  │
│  │Sandbox │ │Sandbox │ │Sandbox │                                  │
│  │  1 🟢  │ │  2 🟢  │ │  3 🟡  │                                  │
│  └────────┘ └────────┘ └────────┘                                  │
│                                                                     │
│  ─── Host Resources ──────────────────────────────────────────     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │   CPU: 42%   │ │ Memory: 67%  │ │  Disk: 54%   │               │
│  │  [  gauge  ] │ │  [  gauge  ] │ │  [  gauge  ] │               │
│  │  ▁▂▃▄▅▄▃▂▁  │ │  ▁▂▃▃▄▅▆▅▄  │ │  ▁▁▁▂▂▂▂▃▃  │               │
│  │   24h trend  │ │   24h trend  │ │   24h trend  │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
│                                                                     │
│  ─── AI Coworker ─────────────────────────────────────────────     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  Inference: 🟢 Available    Memory: 🔴 Offline           │      │
│  │  p95 Latency: 4.2s          Vectors: —                   │      │
│  │  Requests/min: 3.2          Errors (5m): 12               │      │
│  │  Cost today: $0.42          Store failures: 100%          │      │
│  │                                                            │      │
│  │  [─────── Inference Latency (1h) ───────────────────────] │      │
│  │  [─────── Memory Ops Rate (1h) ─────────────────────────] │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ─── Container Resources ─────────────────────────────────────     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  Container      │ CPU    │ Memory    │ Net I/O   │ Restarts│     │
│  │  portal         │ 12%  ▁▃│ 340MB  ▂▃│ 1.2KB/s   │ 0       │     │
│  │  postgres       │  3%  ▁▁│ 128MB  ▁▁│ 0.8KB/s   │ 0       │     │
│  │  neo4j          │  8%  ▁▂│ 512MB  ▃▃│ 0.1KB/s   │ 0       │     │
│  │  qdrant         │  0%  ──│   0MB  ──│ 0         │ 4  ⚠    │     │
│  │  sandbox        │  5%  ▁▁│ 280MB  ▂▂│ 0.3KB/s   │ 0       │     │
│  │  sandbox-2      │  1%  ▁▁│ 180MB  ▁▂│ 0.1KB/s   │ 0       │     │
│  │  sandbox-3      │ 45%  ▅▃│ 420MB  ▃▅│ 2.1KB/s   │ 0       │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ─── Database ────────────────────────────────────────────────     │
│  Active Connections: 12/100    Pool Utilization: 12%               │
│  [─────── Connection Count (1h) ─────────────────────────────]    │
│  [─────── Query Latency p95 (1h) ────────────────────────────]    │
│                                                                     │
│  ─── Recent Alerts ───────────────────────────────────────────     │
│  │ 10:42  CRITICAL  QdrantDown — Qdrant vector DB unreachable │    │
│  │ 10:40  WARNING   ContainerRestarting — qdrant restarted 4× │    │
│  │ 09:15  RESOLVED  HighRequestLatency — p95 back to normal   │    │
│                                                                     │
│  ─── Advanced ────────────────────────────────────────────────     │
│  [Open Grafana ↗] for custom queries and ad-hoc exploration       │
└─────────────────────────────────────────────────────────────────────┘
```

#### Data Flow

```
Browser (React components)
  │
  │  fetch /api/platform/metrics?query=...   (every 15s)
  │  fetch /api/platform/metrics/alerts       (every 30s)
  ▼
Portal API (server-side proxy)
  │
  │  fetch http://prometheus:9090/api/v1/...  (internal Docker network)
  ▼
Prometheus
  │
  │  scrapes cAdvisor, node-exporter, postgres-exporter, portal /api/metrics, ...
  ▼
Exporters & Instrumented Services
```

No HealthSnapshot bridge is needed for the System Health tab — it queries Prometheus directly for real-time data. The bridge (Section 6) remains for feeding the Operations Console's existing entity-centric views (Containers, Databases, Services tabs) which read from HealthSnapshot.

### 9.4 Platform-Wide Health Indicator

A persistent health indicator in the platform's shell navigation (visible on every page):

```
┌─────────────────────────────────────────────────────────────┐
│  DPF  │ Workspace │ Portfolio │ Build Studio │ ...  │ 🟢 ▼ │
└─────────────────────────────────────────────────────────────┘
```

The colored dot in the top navigation bar:
- **Green:** All services healthy, no alerts firing
- **Amber:** One or more warning-level alerts firing
- **Red:** One or more critical alerts firing
- **Grey:** Monitoring stack offline (Prometheus unreachable)

Clicking the indicator opens a dropdown summary of current alerts with a link to the System Health tab. This ensures operators see platform health status from any page in the application, not just when they navigate to the Operations Console.

#### Implementation

```typescript
// components/monitoring/PlatformHealthIndicator.tsx
//
// Mounted in the shell layout (app/(shell)/layout.tsx).
// Polls /api/platform/metrics/alerts every 30 seconds.
// Renders a colored dot + optional dropdown with alert summaries.
// When monitoring is offline (503 from proxy), renders grey dot with tooltip.
```

### 9.5 AI Coworker Health in Context

The AI Coworker chat interface (Build Studio and workspace chat) gains a subtle health status indicator:

| Scenario | Indicator | Location |
|----------|-----------|----------|
| Inference available, memory working | No indicator (clean UI) | — |
| Inference available, memory offline | "Memory offline — responses won't recall prior context" | Below chat input |
| Inference slow (p95 > 15s) | "AI responses may be slower than usual" | Below chat input |
| Inference offline | "AI Coworker unavailable — check System Health" | Replaces chat input |

This uses the same `/api/platform/metrics` proxy with targeted queries:
- `up{job="model-runner"}` — inference availability
- `up{job="qdrant"}` — memory availability
- `histogram_quantile(0.95, rate(dpf_ai_inference_duration_seconds_bucket[5m]))` — current latency

### 9.6 Grafana Role

Grafana remains in the stack but its role is explicitly secondary:

| Grafana is for... | The platform handles... |
|-------------------|------------------------|
| Ad-hoc PromQL queries | Standard operational dashboards |
| Custom chart exploration | Service status overview |
| Alert rule development/testing | Alert visibility and notification |
| Metric debugging | Threshold-based health derivation |
| Historical deep-dives beyond 24h | Real-time operational awareness |

Grafana is accessible at `http://localhost:3002` and linked from the System Health tab's "Advanced" section. It is not embedded via iframe — it is a separate tool for power users.

---

## Section 10: File Inventory

### 10.1 New Files

| File | Purpose |
|------|---------|
| `monitoring/prometheus/prometheus.yml` | Prometheus scrape configuration |
| `monitoring/prometheus/alerts.yml` | Prometheus alert rules |
| `monitoring/grafana/provisioning/datasources/prometheus.yml` | Grafana datasource auto-provisioning |
| `monitoring/grafana/provisioning/dashboards/dashboards.yml` | Grafana dashboard provider config |
| `monitoring/grafana/provisioning/alerting/alerts.yml` | Grafana alert notification channels |
| `monitoring/grafana/dashboards/dpf-overview.json` | Platform overview dashboard |
| `monitoring/grafana/dashboards/dpf-containers.json` | Per-container resources dashboard |
| `monitoring/grafana/dashboards/dpf-host.json` | Host OS resources dashboard |
| `monitoring/grafana/dashboards/dpf-postgres.json` | PostgreSQL performance dashboard |
| `monitoring/grafana/dashboards/dpf-ai-inference.json` | AI inference dashboard |
| `monitoring/grafana/dashboards/dpf-semantic-memory.json` | Semantic memory health dashboard |
| `monitoring/grafana/dashboards/dpf-sandbox.json` | Sandbox build lifecycle dashboard |
| `apps/web/lib/metrics.ts` | prom-client registry and metric definitions |
| `apps/web/app/api/metrics/route.ts` | `/api/metrics` Prometheus scrape endpoint |
| `apps/web/app/api/platform/alerts/route.ts` | Grafana webhook → PortfolioQualityIssue |
| `apps/web/app/api/platform/metrics/route.ts` | Prometheus proxy for platform-native charts |
| `apps/web/app/api/platform/metrics/alerts/route.ts` | Prometheus alerts proxy |
| `apps/web/app/api/platform/metrics/targets/route.ts` | Prometheus targets proxy |
| `apps/web/components/monitoring/MetricGauge.tsx` | Radial gauge (CPU/Memory/Disk) |
| `apps/web/components/monitoring/MetricTimeSeries.tsx` | Time-series line chart |
| `apps/web/components/monitoring/ServiceStatusGrid.tsx` | Service up/down status grid |
| `apps/web/components/monitoring/AlertBanner.tsx` | Firing alerts banner |
| `apps/web/components/monitoring/MetricStat.tsx` | Single big-number metric |
| `apps/web/components/monitoring/MetricTable.tsx` | Multi-metric comparison table |
| `apps/web/components/monitoring/SparkLine.tsx` | Inline mini chart for tables |
| `apps/web/components/monitoring/PlatformHealthIndicator.tsx` | Shell nav health dot + dropdown |
| `apps/web/components/monitoring/useMetricQuery.ts` | React hook for instant Prometheus queries |
| `apps/web/components/monitoring/useMetricRangeQuery.ts` | React hook for range Prometheus queries |

### 10.2 Modified Files

| File | Change |
|------|--------|
| `docker-compose.yml` | Add monitoring services (prometheus, grafana, cadvisor, node-exporter, postgres-exporter) under `profiles: ["monitoring"]`. Add `prometheus_data` and `grafana_data` volumes. Add Neo4j metrics env vars. |
| `apps/web/package.json` | Add `prom-client` dependency |
| `apps/web/lib/ai-inference.ts` | Instrument `callLLM()` with inference metrics |
| `apps/web/lib/semantic-memory.ts` | Instrument `storeConversationMemory()` and `recallRelevantContext()` with memory metrics |
| `apps/web/lib/process-observer.ts` | Instrument `detectSignals()` with observer finding counters |
| `apps/web/app/(shell)/layout.tsx` | Mount `PlatformHealthIndicator` in shell navigation bar |
| `.dockerignore` | Add `monitoring/` exclusion note (monitoring configs need to be in the build context for volume mounts, but the dashboards JSON files should not inflate the portal image) |

---

## Implementation Sequence

| Phase | Scope | Deliverables | Dependencies |
|-------|-------|-------------|--------------|
| **1** | Monitoring stack infrastructure | `monitoring/` directory with Prometheus + Grafana configs. Docker Compose services under `monitoring` profile. Neo4j metrics enabled. Volumes added. | None |
| **2** | Application metrics | `prom-client` integration. `lib/metrics.ts` registry. `/api/metrics` endpoint. Instrumentation of `ai-inference.ts`, `semantic-memory.ts`, `process-observer.ts`. | Phase 1 (for scraping) |
| **3** | Prometheus proxy API & chart components | `/api/platform/metrics` proxy. React chart component library (`MetricGauge`, `MetricTimeSeries`, `ServiceStatusGrid`, `AlertBanner`, `MetricStat`, `MetricTable`, `SparkLine`). React hooks (`useMetricQuery`, `useMetricRangeQuery`). | Phase 1 + 2 |
| **4** | Platform-native System Health tab | System Health tab in `/portfolio/foundational/ops` as default landing tab. All panels rendering live Prometheus data through proxy. Platform-wide health indicator in shell nav. | Phase 3 |
| **5** | Alert rules & webhook | Prometheus alert rules. Grafana notification channel config. `/api/platform/alerts` webhook endpoint. PortfolioQualityIssue integration. Alert banner in System Health tab. | Phase 4 |
| **6** | AI Coworker contextual health | Health status indicators in chat interface (memory offline, inference slow/unavailable). | Phase 3 |
| **7** | HealthProbe bridge | Scheduled job that queries Prometheus and writes HealthSnapshots for entity-centric views. | Phase 2 + EP-FOUND-OPS schema |
| **8** | Grafana dashboards (power-user) | Auto-provisioned dashboard JSON files for all 7 dashboards. Datasource and provider configs. Linked from System Health "Advanced" section. | Phase 1 + 2 |

### Validation Criteria

Each phase must demonstrate:

1. **Phase 1:** `docker compose --profile monitoring up` starts all 5 monitoring services. Prometheus targets page (`http://localhost:9090/targets`) shows all scrape targets as UP.
2. **Phase 2:** `curl http://localhost:3000/api/metrics` returns OpenMetrics-format output including `dpf_ai_inference_duration_seconds` and `dpf_semantic_memory_ops_total`. Prometheus confirms it is scraping the portal target.
3. **Phase 3:** Chart components render sample data when pointed at Prometheus proxy. `useMetricQuery("up")` returns current target state.
4. **Phase 4:** System Health tab at `/portfolio/foundational/ops` renders live gauges, service grid, container table, AI Coworker panel, and database metrics. Health indicator dot appears in shell navigation on every page.
5. **Phase 5:** Stopping a container triggers a `ContainerDown` alert visible in the platform's AlertBanner and creates a `PortfolioQualityIssue` record.
6. **Phase 6:** AI Coworker chat shows "Memory offline" when Qdrant is down, "AI responses may be slower" when inference latency exceeds threshold.
7. **Phase 7:** `HealthSnapshot` records appear in the database with Prometheus-sourced metrics. Entity-centric tabs display them.
8. **Phase 8:** Grafana at `http://localhost:3002` loads with auto-provisioned dashboards. Accessible via "Open Grafana" link in System Health tab.

---

## Appendix A: Windows/Docker Desktop Considerations

The DPF platform runs on Docker Desktop for Windows. Several monitoring components have platform-specific considerations:

| Component | Windows Consideration |
|-----------|----------------------|
| **cAdvisor** | Requires Docker Desktop WSL2 backend. The `/sys` and `/var/lib/docker` mounts map through WSL2 automatically. cAdvisor container must run with `privileged: true`. |
| **node-exporter** | Reports metrics from the Linux VM inside Docker Desktop, not from the Windows host directly. For host-level Windows metrics, a future enhancement could add Windows Exporter (`prometheus-community/windows_exporter`) running natively on the host. |
| **Docker socket** | `/var/run/docker.sock` is available inside Docker Desktop Linux containers. No special configuration needed. |
| **Prometheus data** | Named volume `prometheus_data` persists through Docker Desktop restarts. 15-day retention keeps storage manageable. |

## Appendix B: Consumer-Mode Install Impact

For consumer-mode installations (D:\DPF), the monitoring profile is opt-in:

- Default `install.ps1` does **not** enable the monitoring profile
- Operators enable it by adding `COMPOSE_PROFILES=monitoring` to `.env` or running `docker compose --profile monitoring up -d`
- The `monitoring/` directory is included in the source distribution
- Grafana credentials default to `admin/dpf_monitor` — operators should change via `.env` overrides (`GF_ADMIN_USER`, `GF_ADMIN_PASSWORD`)
