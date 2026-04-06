# Cloud Deployment Strategy — Architecture Guide

| Field | Value |
|-------|-------|
| **Status** | Reference Architecture |
| **Created** | 2026-04-06 |
| **Author** | Claude Code for Mark Bodman |
| **Scope** | Full platform: Docker Compose stack, infrastructure services, application containers, observability, network bridge |
| **Primary Goal** | Document the path from Docker Compose (local/single-host) to cloud-native deployment for operators who want to run DPF at scale |

---

## 1. Current Architecture Summary

DPF runs as a Docker Compose stack on a single host (Windows or Linux). The stack includes:

| Layer | Services | Protocol |
|-------|----------|----------|
| **Application** | portal (Next.js), sandbox pool (x3), portal-init, sandbox-init | HTTP |
| **Data** | PostgreSQL (production + sandbox), Neo4j, Qdrant, Redis | SQL, Bolt, HTTP, RESP |
| **AI Inference** | Docker Model Runner (built into Docker Desktop 4.40+) | OpenAI-compatible HTTP |
| **Browser Automation** | browser-use (Python + Chromium, MCP server) | HTTP JSON-RPC |
| **Async Execution** | Inngest (durable execution engine) | HTTP |
| **Observability** | Prometheus, Grafana, cAdvisor, node-exporter, postgres-exporter | HTTP |
| **Deployment** | Promoter (builds new portal images from sandbox source) | Docker socket |
| **Host Bridge** | MSI installer (Windows) — bridges containers to host network | Windows networking |

All inter-service communication uses environment variables for endpoint URLs (`DATABASE_URL`, `LLM_BASE_URL`, `BROWSER_USE_URL`, `INNGEST_BASE_URL`, etc.), making the topology reconfigurable without code changes.

---

## 2. Docker Coupling Analysis

Not all Docker dependencies are equal. Some are trivially swappable; others require architectural work.

### 2.1 Low coupling (environment variable swap)

These services are accessed exclusively through standard protocols and environment variables. Replacing them with managed cloud equivalents requires zero code changes — only configuration.

| Service | Cloud Equivalents | Migration |
|---------|-------------------|-----------|
| **PostgreSQL** | AWS RDS, Azure Database for PostgreSQL, GCP Cloud SQL, Supabase, Neon | Change `DATABASE_URL` |
| **Redis** | AWS ElastiCache, Azure Cache for Redis, GCP Memorystore, Upstash | Change Redis URI in Inngest config |
| **Neo4j** | Neo4j Aura (managed cloud), self-hosted on VM | Change `NEO4J_URI` |
| **Qdrant** | Qdrant Cloud (managed SaaS), self-hosted on VM | Change `QDRANT_INTERNAL_URL` |
| **browser-use** | browser-use Cloud API (`api.browser-use.com`), or deploy container to any cloud platform | Change `BROWSER_USE_URL` |
| **AI Inference** | OpenAI API, Anthropic API, Azure OpenAI, any OpenAI-compatible endpoint | Change `LLM_BASE_URL` |

### 2.2 Medium coupling (configuration + infrastructure)

These require infrastructure changes but no application code modifications.

| Component | Current | Cloud Approach | Effort |
|-----------|---------|----------------|--------|
| **Prometheus + Grafana** | Self-hosted containers scraping `/metrics` | AWS CloudWatch + Managed Grafana, Azure Monitor, GCP Cloud Monitoring, Datadog, or Grafana Cloud. The portal exports metrics via `prom-client` over HTTP — any Prometheus-compatible scraper works. Dashboard JSON files import directly into any Grafana instance. | Low-Medium |
| **Inngest** | Self-hosted container with PostgreSQL + Redis backends | Inngest Cloud (managed SaaS at `inngest.com`). The portal's Inngest client already supports remote event keys and signing keys. | Low |
| **MSI Network Bridge** | Windows MSI installer bridges Docker containers to host LAN — provides local network access to the portal and services | Replaced by cloud-native ingress: ALB/NLB (AWS), Application Gateway (Azure), Cloud Load Balancing (GCP), or a reverse proxy (Traefik, Caddy, nginx). In cloud, services are directly addressable via DNS — no bridge needed. | Medium |
| **Portal + Sandbox containers** | Docker Compose with port mapping | Deploy as container tasks: ECS (AWS), Container Apps (Azure), Cloud Run (GCP), or Kubernetes pods. Already containerized with health checks, so they deploy as-is. | Medium |

### 2.3 High coupling (requires abstraction work)

| Component | Current | Issue | Cloud Approach | Effort |
|-----------|---------|-------|----------------|--------|
| **Docker Socket Access** | Portal mounts `/var/run/docker.sock` to launch sandbox containers and manage the promoter | Direct Docker API dependency — doesn't exist in managed container platforms | Abstract container lifecycle behind an interface (see Section 4) | High |
| **Sandbox Container Pool** | 3 pre-started containers on fixed ports, managed via Docker socket | Cloud platforms use dynamic container scheduling, not pre-started pools | Replace with on-demand container launch via cloud APIs (ECS RunTask, Cloud Run Jobs, K8s Job) | High |
| **Promoter** | Builds new portal Docker images by accessing the Docker socket and host source code | Requires Docker-in-Docker or a build service | Replace with a CI/CD pipeline (GitHub Actions, AWS CodeBuild, Cloud Build) triggered by the promoter's MCP tool | High |

---

## 3. Cloud Deployment Options

### Option A: Lift-and-Shift (VM + Docker Compose)

**Best for:** Quick cloud deployment, small teams, cost-sensitive deployments.

Deploy the existing Docker Compose stack on a cloud VM. Minimal changes needed.

| Provider | VM Type | Estimated Cost |
|----------|---------|----------------|
| AWS | EC2 `t3.xlarge` (4 vCPU, 16 GB) | ~$120/month |
| Azure | Standard_B4ms (4 vCPU, 16 GB) | ~$120/month |
| GCP | e2-standard-4 (4 vCPU, 16 GB) | ~$100/month |
| Hetzner | CPX41 (8 vCPU, 16 GB) | ~$30/month |

**Changes required:**
1. Install Docker on the VM
2. Clone repo, run `docker compose up -d`
3. Replace MSI bridge with a reverse proxy (nginx/Caddy) for external access
4. Configure firewall rules for port 3000 (portal), 3002 (Grafana)
5. Optional: swap PostgreSQL for managed RDS to offload backup/HA

**Pros:** Fastest path, minimal changes, everything works as-is.
**Cons:** Single point of failure, manual scaling, Docker socket coupling remains.

### Option B: Hybrid (Managed Data + Container Platform)

**Best for:** Production deployments, teams wanting reliability without full Kubernetes.

Use managed services for data and observability, deploy application containers to a managed platform.

```
                    Internet
                       |
                 [Load Balancer]
                       |
            ┌──────────┴──────────┐
            |                     |
    [Portal Container]    [Sandbox Pool]
    (ECS / Cloud Run /    (On-demand tasks)
     Container Apps)
            |
    ┌───────┼───────┬──────────┐
    |       |       |          |
 [RDS]  [Neo4j  [Qdrant   [Redis
         Aura]   Cloud]   Managed]
```

**Changes required:**
1. Provision managed data services, update env vars
2. Deploy portal as a container service (ECS, Cloud Run, Container Apps)
3. Build the container abstraction layer (Section 4) for sandbox management
4. Replace Prometheus/Grafana with managed equivalents or Grafana Cloud
5. Replace promoter with CI/CD pipeline integration
6. Replace MSI bridge with cloud load balancer

**Pros:** Managed backups, HA, auto-scaling for portal. Data services handle their own ops.
**Cons:** Requires the container abstraction work (Section 4). Higher monthly cost than VM.

### Option C: Full Cloud-Native (Kubernetes)

**Best for:** Large-scale, multi-tenant, enterprise deployments.

Deploy everything on Kubernetes with managed node pools.

**Changes required:**
- Everything in Option B, plus:
- Helm charts or Kustomize manifests for all services
- Pod security policies for sandbox isolation
- Horizontal Pod Autoscaler for portal and sandbox pools
- PersistentVolumeClaims for workspace storage
- NetworkPolicies for inter-pod security

**Pros:** Maximum scalability, multi-tenancy, enterprise-grade isolation.
**Cons:** Significant operational complexity. Only justified at scale.

---

## 4. Container Abstraction Layer (Key Architecture Work)

The single highest-value architectural change for cloud readiness is abstracting the Docker socket dependency behind a provider interface. This is where the portal currently calls `docker exec`, `docker inspect`, and similar commands to manage sandbox containers.

### Proposed interface

```typescript
// lib/container-provider.ts

export interface ContainerProvider {
  /** Launch a new sandbox container, return its address. */
  launchSandbox(config: SandboxConfig): Promise<SandboxInstance>;

  /** Execute a command inside a running sandbox. */
  execInSandbox(instanceId: string, command: string[]): Promise<ExecResult>;

  /** Stop and remove a sandbox instance. */
  destroySandbox(instanceId: string): Promise<void>;

  /** List active sandbox instances. */
  listSandboxes(): Promise<SandboxInstance[]>;

  /** Health check a sandbox instance. */
  healthCheck(instanceId: string): Promise<boolean>;
}

export type SandboxConfig = {
  image: string;
  port: number;
  environment: Record<string, string>;
  volumes?: VolumeMount[];
};

export type SandboxInstance = {
  instanceId: string;
  address: string; // hostname:port or URL
  status: "running" | "starting" | "stopped";
  createdAt: Date;
};
```

### Provider implementations

| Provider | Backend | Use case |
|----------|---------|----------|
| `DockerSocketProvider` | `/var/run/docker.sock` (current behavior) | Local development, single-host deployment |
| `EcsProvider` | AWS ECS RunTask API | AWS cloud deployment |
| `CloudRunProvider` | GCP Cloud Run Jobs API | GCP cloud deployment |
| `KubernetesProvider` | K8s Jobs API | Kubernetes deployment |

The active provider is selected by an environment variable:

```
CONTAINER_PROVIDER=docker    # default (current behavior)
CONTAINER_PROVIDER=ecs       # AWS
CONTAINER_PROVIDER=cloudrun  # GCP
CONTAINER_PROVIDER=k8s       # Kubernetes
```

This abstraction isolates all Docker-specific code behind a single interface, making the rest of the platform container-runtime-agnostic.

---

## 5. Observability Migration Path

The current Prometheus + Grafana stack is self-hosted but standard.

### What stays the same

- Portal exports metrics via `prom-client` at `/api/metrics` — this HTTP endpoint works with any Prometheus-compatible system
- Grafana dashboard JSON files are portable across any Grafana instance (self-hosted or cloud)
- Alert rules in `monitoring/prometheus/alerts.yml` can be imported into any Prometheus-compatible alerting system

### Cloud equivalents

| Current | AWS | Azure | GCP | Vendor-Neutral |
|---------|-----|-------|-----|----------------|
| Prometheus | Amazon Managed Prometheus | Azure Monitor (Prometheus mode) | GCP Managed Prometheus | Grafana Cloud, Datadog |
| Grafana | Amazon Managed Grafana | Azure Managed Grafana | GCP (use Grafana Cloud) | Grafana Cloud |
| cAdvisor | CloudWatch Container Insights | Azure Container Insights | GKE Monitoring | Datadog |
| node-exporter | CloudWatch Agent | Azure Monitor Agent | Ops Agent | Datadog Agent |
| postgres-exporter | RDS Performance Insights | Azure DB metrics | Cloud SQL Insights | pganalyze |

### Migration steps

1. Set up the cloud Prometheus endpoint (or compatible scraper)
2. Point it at the portal's `/api/metrics` endpoint
3. Import dashboard JSON files from `monitoring/grafana/dashboards/`
4. Import alert rules from `monitoring/prometheus/alerts.yml`
5. Remove Prometheus, Grafana, cAdvisor, node-exporter, and postgres-exporter from `docker-compose.yml`
6. Update any portal health checks that reference local Prometheus/Grafana URLs

---

## 6. MSI Bridge Replacement

The Windows MSI installer currently bridges the Docker container network to the host LAN, making the portal accessible to other machines on the local network. In cloud, this function is handled by the platform's ingress layer.

| Deployment | Replaces MSI With |
|------------|-------------------|
| **VM (Option A)** | Reverse proxy (nginx, Caddy, Traefik) + firewall rules |
| **Managed containers (Option B)** | Cloud load balancer (ALB, Application Gateway, Cloud LB) |
| **Kubernetes (Option C)** | Ingress controller (nginx-ingress, Traefik, Istio gateway) |

In all cases, the portal container listens on port 3000 internally — only the routing layer changes.

---

## 7. AI Inference in Cloud

Docker Model Runner (local LLM inference) is a development convenience, not a production dependency. The portal's inference layer (`apps/web/lib/inference/ai-inference.ts`) already supports multiple backends via adapter pattern:

| Backend | Configuration | Use case |
|---------|--------------|----------|
| Docker Model Runner | `LLM_BASE_URL=http://model-runner.docker.internal/v1` | Local development (free, private) |
| OpenAI API | `LLM_BASE_URL=https://api.openai.com/v1` + `OPENAI_API_KEY` | Cloud production |
| Anthropic | Anthropic adapter (direct, not OpenAI-compatible) + `ANTHROPIC_API_KEY` | Cloud production |
| Azure OpenAI | `LLM_BASE_URL=https://<deployment>.openai.azure.com/` + key | Enterprise cloud |
| Ollama (self-hosted) | `LLM_BASE_URL=http://<ollama-host>:11434/v1` | Self-hosted cloud |
| OpenRouter | `LLM_BASE_URL=https://openrouter.ai/api/v1` + key | Multi-model routing |

No code changes needed — only environment variable configuration.

---

## 8. Migration Priority Matrix

For teams planning a cloud migration, this is the recommended order:

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Swap data services for managed equivalents (RDS, managed Redis, etc.) | Low | Eliminates backup/HA burden, biggest operational win |
| 2 | Deploy portal container to managed platform (ECS, Cloud Run) | Low | Auto-restart, health checks, log aggregation |
| 3 | Replace MSI bridge with load balancer / reverse proxy | Medium | Enables cloud networking, TLS termination |
| 4 | Migrate observability to cloud-managed stack | Medium | Eliminates 5 containers, reduces resource usage |
| 5 | Build container abstraction layer (Section 4) | High | Enables cloud-native sandbox management |
| 6 | Replace promoter with CI/CD pipeline | High | Removes Docker socket dependency for builds |

Steps 1-3 can be done incrementally with no application code changes. Steps 4-6 require development work but unlock true cloud-native operation.

---

## 9. Cost Estimation

Rough monthly estimates for a single-instance deployment:

| Component | Option A (VM) | Option B (Hybrid) | Option C (K8s) |
|-----------|---------------|-------------------|----------------|
| Compute | $100-150 (VM) | $50-100 (containers) | $200-400 (node pool) |
| PostgreSQL | Included in VM | $30-80 (managed) | $30-80 (managed) |
| Redis | Included in VM | $15-30 (managed) | $15-30 (managed) |
| Neo4j | Included in VM | $65+ (Aura) | $65+ (Aura) |
| Qdrant | Included in VM | $25+ (Cloud) | $25+ (Cloud) |
| Observability | Included in VM | $0-50 (Grafana Cloud free tier) | $0-50 |
| AI Inference | $0 (local) or API costs | API costs | API costs |
| **Total (infra only)** | **$100-150** | **$185-365** | **$335-655** |

API costs for AI inference (OpenAI, Anthropic) are usage-dependent and additional to infrastructure costs.

---

## 10. Summary

DPF's architecture is already cloud-friendly by design:
- All service endpoints are configurable via environment variables
- Application containers are health-checked and stateless
- Data services use standard protocols with managed equivalents available
- Observability metrics use the Prometheus standard

The two areas requiring development work for full cloud-native deployment are:
1. **Container abstraction layer** — abstracting Docker socket calls behind a provider interface
2. **Promoter replacement** — replacing Docker-in-Docker builds with CI/CD pipeline integration

These can be addressed incrementally without disrupting the existing Docker Compose workflow that serves local and single-host deployments today.
