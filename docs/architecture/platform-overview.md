# Platform Overview

> **Scope:** this document describes the **current GA runtime** — the Single VM substrate served via Docker Desktop on Windows. Multi-platform (macOS Apple Silicon, native Linux), customer-cloud (AWS / GCP / Azure), Managed Kubernetes, and TAPPaaS deployment shapes are documented under the deployment doctrine at [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../superpowers/specs/2026-05-09-deployment-contracts.md). Implementation status for each is tracked in the [umbrella branch plan](../superpowers/plans/2026-05-09-deployment-architecture-and-rollout.md).

This document explains the main runtime pieces of Open Digital Product Factory, the two supported deployment models, the sandbox-based iterative workflow, and the practical hardware tiers for running the platform well.

The intent is to separate the always-on platform runtime from the evolving self-improvement loop. Some sandbox capabilities already exist in the codebase today. The broader governed iterative workflow is the target direction and should be read as an architecture goal, not as a claim that every stage is already fully automated.

## Current Runtime Core

The current platform runtime is a containerized application stack centered on the `portal` application and a small set of supporting data and AI services.

### Core Services

| Service | Role |
|---------|------|
| `portal-init` | One-shot startup container that waits for infrastructure readiness, applies Prisma migrations, and exits once initialization is complete |
| `portal` | Main Next.js application surface for operations, portfolio, architecture, AI coworker, storefront, and governance workflows |
| `postgres` | System of record for transactional platform data |
| `neo4j` | Graph storage for relationship-rich models such as enterprise architecture and connected capability views |
| `qdrant` | Vector database for semantic indexing, retrieval, and memory-style AI support |
| `inngest` | Durable execution engine for scheduled jobs, event-driven workflows, and retryable background tasks |
| `redis` | In-memory store backing Inngest's job queue and state |
| Docker Model Runner | Local AI inference built into Docker Desktop 4.40+ — no separate container needed. Models managed via `docker model pull`. On Linux installs without Docker Desktop, Ollama in compose substitutes; on TAPPaaS deployments, the customer's AI Stack Ollama / LiteLLM serves the same role. The runtime contract (`DPF_LLM_PROVIDER`, `LLM_BASE_URL`) is universal — see Doctrine Contract 9. |
| External AI providers | Optional provider layer used when the tenant enables remote model access |

### Runtime Characteristics

- `portal` is the only service that needs to be directly exposed to end users in the target customer deployment.
- `postgres`, `neo4j`, and `qdrant` remain internal services by default. Docker Model Runner is built into Docker Desktop and does not run as a separate container.
- `portal` can route AI work to either local models (via Docker Model Runner) or enabled external providers.
- Governance, auditability, and human approval sit above the execution layer rather than outside it.

## Deployment Model 1: Customer Mode

Customer mode is the target packaged deployment. The platform runs as a contained Docker stack with minimal host-level prerequisites and with a bias toward local data ownership.

### Characteristics

- Everything runs in Docker.
- Only the web app is published externally, normally on port `3000`.
- Databases and local AI stay on the internal Docker network.
- Docker Model Runner handles GPU passthrough automatically when a supported GPU is present.
- Sandbox containers are launched only when needed and are not part of the steady-state runtime.

### Mermaid Diagram

```mermaid
flowchart LR
    user[Customer user]

    subgraph host["Customer machine / server"]
        subgraph docker["Docker runtime"]
            portal[portal<br/>published :3000]
            init[portal-init<br/>one-shot]
            postgres[(postgres)]
            neo4j[(neo4j)]
            qdrant[(qdrant)]
            modelrunner[Docker Model Runner<br/>built into Docker Desktop]
            sandbox[sandbox containers<br/>on demand]
        end
    end

    user --> portal
    init --> postgres
    portal --> postgres
    portal --> neo4j
    portal --> qdrant
    portal --> modelrunner
    portal -. create / inspect / destroy .-> sandbox
```

### Best Fit

Use customer mode when the goal is:

- the simplest supported install
- strong local control over platform data
- an internal-only infrastructure footprint
- minimal dependency on local developer tooling

## Deployment Model 2: Native Developer Mode

Native developer mode uses the same platform services, but changes the ergonomics. Stateful infrastructure remains in Docker while the app itself runs locally for debugging, hot reload, and tighter development loops.

### Characteristics

- `portal` runs locally via `pnpm --filter web dev`
- `postgres`, `neo4j`, and related services remain containerized. Docker Model Runner is built into Docker Desktop.
- Docker-published ports let the local app connect directly to those services
- IDE integration and live debugging are first-class in this mode
- The same sandbox image and sandbox orchestration mechanisms can still be used

### Mermaid Diagram

```mermaid
flowchart LR
    browser[Browser]

    subgraph workstation["Developer workstation"]
        localapp[Local Next.js app<br/>pnpm --filter web dev]

        subgraph docker["Docker sidecars"]
            postgres[(postgres<br/>:5432)]
            neo4j[(neo4j<br/>:7474 / :7687)]
            modelrunner[Docker Model Runner<br/>built-in]
            qdrant[(qdrant<br/>internal by default)]
            sandbox[sandbox containers<br/>on demand]
        end
    end

    browser --> localapp
    localapp --> postgres
    localapp --> neo4j
    localapp --> modelrunner
    localapp --> qdrant
    localapp -. launch / inspect .-> sandbox
```

### Best Fit

Use native developer mode when you need:

- local IDE debugging
- hot reload during UI and API changes
- direct inspection of logs and service state
- a faster inner loop for development work

## Sandbox and Iterative Build Workflow

The platform includes the beginnings of a governed iterative build loop built around an isolated sandbox image and optional isolated sandbox infrastructure.

### Implemented Building Blocks

The current codebase already includes:

- a dedicated `dpf-sandbox` image definition
- source copy into an isolated `/workspace`
- sandbox-local dependency install and Prisma client generation
- a local development server inside the sandbox
- optional sandbox-local `postgres`, `neo4j`, and `qdrant` containers on a dedicated network
- time, CPU, memory, and disk limits for sandbox containers
- sandbox lifecycle controls for launch, inspect, and teardown

### Target Iterative Workflow

The target workflow layers governance and feedback on top of those sandbox primitives:

1. A user or operator proposes a feature or change
2. The platform records a brief, plan, and constraints
3. An isolated sandbox network and runtime are launched
4. Source is copied into the workspace with a clean baseline
5. An agent iterates on the change inside the sandbox
6. Preview, logs, and verification results are inspected
7. A human reviews the diff and outcome
8. Approved changes are promoted back into the main platform
9. Outcome data feeds evaluation, routing, and improvement systems

### Mermaid Diagram

```mermaid
flowchart TD
    request[Feature request / change request]
    brief[Feature brief + plan in portal]
    launch[Launch isolated sandbox network and containers]
    workspace[Copy source into /workspace<br/>baseline git state]
    iterate[Coding agent iterates inside sandbox]
    preview[Live preview / logs / inspection]
    verify[Run tests and verification]
    review[Human review of diff and result]
    promote[Promote approved diff back to main platform]
    learn[Feed outcomes into routing, eval, and improvement loops]

    request --> brief
    brief --> launch
    launch --> workspace
    workspace --> iterate
    iterate --> preview
    preview --> verify
    verify --> review
    review -->|approve| promote
    review -->|request changes| iterate
    promote --> learn
```

### Important Boundaries

- The sandbox is isolated from the main runtime and can be destroyed completely.
- The sandbox may run its own temporary infrastructure rather than sharing the live databases.
- Human review remains the promotion gate for consequential changes.
- The adaptive feedback loop should tune behavior gradually rather than allowing uncontrolled architectural drift.

## Data Architecture: Three Complementary Data Layers

The platform uses three distinct data stores, each optimized for a different kind of question. Understanding which system answers which question is key to understanding the architecture.

### Layer 1: PostgreSQL — System of Record

PostgreSQL is the authoritative source for all mutable platform data. Every entity, relationship, configuration, and credential lives here. All writes go to Postgres first; other systems receive projections.

| What It Stores | Examples |
|---------------|---------|
| Business entities | Digital products, portfolios, taxonomy nodes, backlog items, epics |
| Infrastructure inventory | InventoryEntity, InventoryRelationship (from bootstrap discovery) |
| AI workforce | Agents, providers, credentials, token usage, task evaluations |
| Governance | Change requests, deployment windows, audit trails, authority grants |
| Health data | HealthSnapshot, PortfolioQualityIssue (from monitoring pipeline) |

**Question it answers:** "What is the current state of this entity and its full history?"

### Layer 2: Neo4j — Graph Projection for Topology and Impact

Neo4j receives a **read-only projection** from PostgreSQL. It does not accept direct writes — sync functions (`syncDigitalProduct`, `syncInventoryEntityAsInfraCI`, `syncEaElement`) fire after Postgres writes and project the data into graph form. Failures are logged but never block the source write.

| Node Type | Source | Purpose |
|-----------|--------|---------|
| DigitalProduct | Prisma DigitalProduct | Portfolio membership, taxonomy classification |
| TaxonomyNode | Prisma TaxonomyNode | Hierarchy traversal (CHILD_OF relationships) |
| Portfolio | Prisma Portfolio | Product grouping |
| InfraCI | Prisma InventoryEntity | Infrastructure topology (hosts, containers, databases, monitoring services) |
| EaElement | Prisma EaElement | Enterprise architecture modeling (ArchiMate notation) |

**Relationship types:** BELONGS_TO, CATEGORIZED_AS, CHILD_OF, DEPENDS_ON (with role: hosts, monitors, depends_on, stores_data_in), PROVIDES_TO, EA_REPRESENTS, and dynamic EA relationship types.

**Questions it answers:**
- "If PostgreSQL goes down, what digital products are affected?" (downstream impact traversal)
- "What infrastructure does this product depend on?" (upstream dependency traversal)
- "What is the shortest dependency path between these two systems?" (shortest path)
- "Show me the full topology of the Foundational portfolio" (subgraph extraction)

**What it cannot answer:** "How is PostgreSQL performing right now?" or "What was the CPU usage of this container over the last hour?" — those are time-series questions.

### Layer 3: Prometheus — Time-Series Metrics for Operational Health

Prometheus scrapes metrics from running services every 10-15 seconds and stores them as time-series data with 15-day retention. It is the operational health layer — it knows how things are performing right now and how that has changed over time.

| What It Collects | Source | Metrics |
|-----------------|--------|---------|
| Container resources | cAdvisor | CPU %, memory bytes, network I/O, disk I/O, restart count per container |
| Host resources | node-exporter | Total CPU, memory, disk utilization, network throughput |
| Database health | postgres-exporter | Connection pool utilization, active connections, query performance |
| Application performance | Portal /api/metrics (prom-client) | HTTP request latency, error rates, AI inference duration/tokens/cost |
| AI provider health | Portal /api/metrics | Inference errors by type (auth, rate_limit, network), semantic memory ops |
| Vector DB health | Qdrant native /metrics | Collection sizes, search latency |

**Questions it answers:**
- "What is the CPU utilization of the portal container right now?"
- "What was the p95 AI inference latency over the last hour?"
- "Is the Qdrant vector DB reachable?"
- "How many auth errors has the Anthropic provider thrown in the last 5 minutes?"

**What it cannot answer:** "What depends on Qdrant?" or "Which digital products are affected if Qdrant goes down?" — those are graph questions.

### How the Three Layers Work Together

![Three-Layer Data Architecture](monitoring-diagrams/svg/01-three-layer-data-architecture.svg)

*[High-resolution PNG](monitoring-diagrams/png/01-three-layer-data-architecture.png) | [Mermaid source](monitoring-diagrams/01-three-layer-data-architecture.mmd)*

**The convergence point** is the platform's native UI. Only the platform can combine:
- Topology from Neo4j ("Prometheus monitors PostgreSQL")
- Health from Prometheus ("PostgreSQL CPU is at 85%")
- Business context from PostgreSQL ("PostgreSQL belongs to the Foundational portfolio and is attributed to the Database taxonomy node")

No single data store has all three. This is why the platform renders its own dashboards rather than delegating entirely to Grafana.

### Grafana's Role: Power-User Escape Hatch

Grafana ships as an **opt-in** power-user tool — it is not started by `docker compose up` (enable it with `docker compose --profile observability-ui up -d grafana`). It serves a different audience and purpose than the platform UI:

| | Platform UI | Grafana |
|---|---|---|
| **Audience** | All users — business owners, operators, product managers | Platform engineers, DevOps, advanced troubleshooting |
| **Data sources** | PostgreSQL + Neo4j + Prometheus (all three) | Prometheus only (time-series) |
| **Navigation** | Integrated into product lifecycle views | Separate tool at :3002 |
| **Dashboards** | Curated, pre-built, context-aware | Ad-hoc, customizable, raw PromQL |
| **Graph data** | Yes — topology, impact analysis, dependency visualization | No — cannot query Neo4j |
| **Business context** | Yes — portfolios, products, taxonomy, governance | No — infrastructure metrics only |
| **Alerting** | Fires into PortfolioQualityIssue (platform-native, visible in product lifecycle) | Fires into Grafana UI (separate tool) |

![Platform UI vs Grafana](monitoring-diagrams/svg/04-grafana-vs-platform-ui.svg)

*[High-resolution PNG](monitoring-diagrams/png/04-grafana-vs-platform-ui.png) | [Mermaid source](monitoring-diagrams/04-grafana-vs-platform-ui.mmd)*

**When to use Grafana:** Something is wrong and you need to dig deeper — correlate metrics across arbitrary dimensions, zoom into a 5-minute window, write custom PromQL queries, explore metrics that the platform UI doesn't surface yet.

**When to use the platform UI:** Day-to-day operational awareness, product lifecycle health, impact analysis before changes, understanding which digital products are affected by infrastructure degradation.

### Monitoring Stack Topology

The **headless** monitoring stack (Prometheus, Loki, Alloy, and the metric exporters) runs as part of the default Docker Compose stack — these feed the platform's native UI and alert pipeline. The Grafana **UI** is opt-in (`--profile observability-ui`), since the platform renders its own context-aware dashboards and delivers alerts via the Inngest poll-bridge rather than through Grafana.

![Monitoring Stack Topology](monitoring-diagrams/svg/02-monitoring-stack-topology.svg)

*[High-resolution PNG](monitoring-diagrams/png/02-monitoring-stack-topology.png) | [Mermaid source](monitoring-diagrams/02-monitoring-stack-topology.mmd)*

### Layer 3b: Loki + Alloy — Container Logs (the unbounded signal)

Metrics answer "how is a *pre-declared* signal trending?" Logs answer the larger, unbounded question: "what did any container actually write to stdout/stderr?" An error line repeated 500×/min, or a brand-new exception nobody instrumented, is invisible to Prometheus. Loki + Alloy close that gap, and — like the rest of the stack — run default-on in the base Compose project.

| Component | Role | Why it is cross-platform |
|-----------|------|--------------------------|
| **Alloy** (Grafana Alloy) | Discovers every container on the Docker daemon and tails its stdout/stderr into Loki, labeled by compose service. One config, no per-service wiring — a new container is captured on the next 15-second discovery refresh. | Reads the Docker **log API via the socket** — no host-path bind mounts (`/proc`, `/sys`, `/var/lib/docker`), so it runs identically on Docker Desktop for macOS/Windows and native Linux, unlike cAdvisor/node-exporter. |
| **Loki** | Stores the lines, label-indexed (not full-text), 14-day retention. A per-stream rate cap means one flooding container cannot fill the disk — excess is dropped, and the drop is itself an alert (`LogIngestionThrottled`). | Touches no host paths; the log *source* is Alloy. |

Two complementary detectors run on top, because a *loud* problem and a *quiet* problem need different lenses:

- **Loud path — Loki ruler (LogQL).** Error-rate rules (`ContainerErrorLogSpike` at >5 lines/min for 10m; `ContainerErrorLogStorm` at >60/min) fire in real time when a service sustains an elevated error rate.
- **Quiet path — novel-signature scanner.** An Inngest cron (every 15 min) clusters error lines into signatures — template extraction strips digits, UUIDs, hex, paths, and timestamps to a stable hash — and files **one** issue per *first-seen* signature. It catches a single novel exception even at low volume, deduped so a recurring line is filed once, not every cycle.

### How the Platform Handles Anything That Happens

The defining design choice is **one issue substrate**: every detection source — a metric breach, a log storm, a novel error line, an in-process crash, or a human report — converges into a single deduped inbox, is auto-triaged into the backlog, and is tracked to resolution. No source gets its own parallel inbox, so a *new* detector plugs into the same pipe without new surfacing or triage code. This is the IT4IT SS5.7 *Detect → Diagnose → Change → Resolve → Close* loop.

```
DETECT (many sources)        CONVERGE (one inbox)     SURFACE              MANAGE → RESOLVE
─────────────────────        ────────────────────     ───────              ────────────────
metric thresholds  ┐                                   System Health tab    auto-triage →
log rate / storm   ┤                                   shell health dot       BacklogItem
novel log lines    ┼─►  PlatformIssueReport      ─►   (amber/red, any    ─►  (deduped, sized)
app crash/regress  ┤    + PortfolioQualityIssue        page) + backlog     resolve: auto-clear
user reports       ┘    (deduped by key)                                    or "fix" build
```

**1 — Detect.** Each source carries its own dedup key so a recurring problem files *once*:

| Source | Mechanism | Lands as |
|--------|-----------|----------|
| Metric thresholds | Prometheus alert rules (`ContainerDown`, `HighErrorRate`, `HostDiskCritical`, `PostgresDown`, `AIInferenceHighLatency`…) | `PortfolioQualityIssue` (`health_alert`) |
| Log rate / storm | Loki ruler LogQL rules | `PortfolioQualityIssue` (`health_alert`) |
| Novel log lines | Novel-signature scanner (Inngest, 15 min) | `PlatformIssueReport` (`log_signature`) |
| App crashes / regressions | In-process error boundary + coworker-regression detector | `PlatformIssueReport` (`runtime_error`) |
| User reports | Feedback + support intake | `PlatformIssueReport` (`user_report` / `feedback`) |
| Estate drift | Discovery/portfolio quality writer | `PortfolioQualityIssue` (discovery kinds) |

**2 — Converge.** Two sibling tables share the operator inbox: `PlatformIssueReport` (runtime/log/user issues, deduped by `dedupeKey`) and `PortfolioQualityIssue` (metric/log-rate health alerts + discovery quality, keyed by `issueKey`). One inbox, one triage, one backlog.

**3 — Surface.** The native **System Health** tab (alert banner, service grid, resource gauges, Log Issues panel), the shell-nav **health dot** (`PlatformHealthIndicator`, amber/red on every page), and the **backlog**.

**4 — Manage → Resolve.** The `issue-report-triage` cron projects each issue into a tracked `BacklogItem` (`source=automated-detection`) — the "managed going forward" loop. Resolution is automatic (the issue auto-closes when its alert stops firing) or operator-driven ("Send to Build Studio as a fix" spins a fix-kind build).

**Alert delivery without an Alertmanager.** The stack deliberately ships **no** Alertmanager (fewer moving parts). Instead, an `alert-delivery-bridge` Inngest cron polls firing alerts from both Prometheus (`/api/v1/alerts`) and the Loki ruler (`/prometheus/api/v1/alerts`) and upserts them into `PortfolioQualityIssue` via the same writer the webhook receiver uses; the System Health alert endpoint (`/api/platform/metrics/alerts`) merges both evaluators so the shell-nav health dot reflects log-rate alerts, not just metric alerts. New detectors reuse the existing Inngest runtime rather than adding a process.

**Storm-resilient by construction.** The bridge reads **aggregated** alert state, so a container flooding 10k lines/sec yields exactly **one** `ContainerErrorLogStorm` issue, never a per-line flood. Loki's per-stream rate cap bounds disk; only *firing* alerts (past their `for:` debounce) are persisted; and reconciliation is source-attributed, so a transient Prometheus outage never false-resolves a still-firing issue.

**Coverage edges (honest limits).** The platform can tell you *that* something failed and *how often*, but not yet reconstruct a single request's path across services — **distributed tracing (Tier 3) is not built**. Detection is threshold- and novelty-based, not predictive: a slow drift that never crosses a threshold and repeats an existing signature stays invisible.

### AI Provider Failure Detection and Recovery

When an AI provider fails (credential expiry, rate limit exhaustion, network outage), the platform detects, adapts, and surfaces the issue through a governed cascade:

![Provider Failure Cascade](monitoring-diagrams/svg/03-provider-failure-cascade.svg)

*[High-resolution PNG](monitoring-diagrams/png/03-provider-failure-cascade.png) | [Mermaid source](monitoring-diagrams/03-provider-failure-cascade.mmd)*

Key design: degradation is **feature-specific, not platform-wide**. A missing deep-thinker provider degrades Build Studio (code generation) but has no impact on portfolio management or backlog tracking. The platform surfaces contextual warnings on the affected feature, not a global error banner.

Router providers are also policy boundaries. The suitability compiler carries account-scoped OpenRouter obligations through the request contract and every execution/fallback plan. The chat adapter is the single request-construction point for the `provider` controls and router-metadata header. Restricted routes require bounded endpoint slugs, ZDR, data-collection denial, disabled unbounded fallback, parameter support, and returned underlying-provider evidence. EU base-URL selection additionally requires current enterprise regional entitlement on that specific connection. This prevents a router fallback or a second account for the same provider ID from bypassing the original route policy.

### Neo4j Sync Integrity

Because Neo4j is a projection, it can fall out of sync with PostgreSQL. The current sync is fire-and-forget — failures are logged but not retried. This is a known operational risk that the monitoring system should track:

- **Sync success/failure rate** — Prometheus metric to track projection health
- **Drift detection** — periodic reconciliation comparing Postgres entity counts to Neo4j node counts
- **Full rebuild** — the EA graph has `rebuildEaGraph()` for complete re-projection; inventory/product graphs should have equivalent capability

When the monitoring stack detects sync drift, it creates a `PortfolioQualityIssue` so operators are aware that graph-based views (impact analysis, dependency topology) may be stale.

---

## Hardware Guidance

The platform supports a broad range of hardware, but the user experience changes significantly depending on whether the goal is simple evaluation, day-to-day local AI, or sandbox-heavy self-building workflows.

### Practical Tiers

| Tier | CPU | RAM | Storage | GPU | Best for |
|------|-----|-----|---------|-----|----------|
| Minimum viable local run | Modern 4 cores | 16 GB | 50-100 GB SSD | None required | Evaluation, administration, and external-provider-first usage |
| Recommended for serious use | 8+ cores | 32 GB | 100-200 GB NVMe SSD | Optional, 8-12 GB VRAM recommended | Small-team use, local-first AI, and moderate sandbox iteration |
| Best for self-building / sandbox-heavy use | 12+ cores | 64 GB+ | 200+ GB NVMe SSD | 16 GB+ VRAM recommended | Frequent sandbox launches, heavier local models, and tighter iterative workflows |

### Current Local Model Auto-Selection

The installer uses detected RAM and VRAM to choose a default local model automatically via Docker Model Runner:

| Hardware signal | Default model |
|----------------|---------------|
| GPU with 16 GB+ VRAM | `qwen3:32b` |
| GPU with 8-16 GB VRAM | `qwen3:14b` |
| GPU with 4-8 GB VRAM | `qwen3:8b` |
| CPU-only with 16 GB+ RAM | `qwen3:8b` |
| CPU-only with 8-16 GB RAM | `qwen3:1.7b` |
| Constrained systems below that | `qwen3:0.6b` |

These defaults are meant to keep installation practical. They are not the only models the platform can use, and they do not replace the broader multi-provider routing strategy for remote models.

## Summary

Open Digital Product Factory is designed as a contained business platform with:

- a main application container
- internal data and AI services
- optional external model providers
- isolated sandbox environments for controlled iteration
- two practical operating modes: packaged customer deployment and native developer mode

That architecture is what allows the platform to combine operational software, governed AI, and iterative self-improvement without collapsing everything into one unsafe runtime.
