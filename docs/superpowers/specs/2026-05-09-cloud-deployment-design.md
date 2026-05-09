# Customer-Cloud Deployment Design (DRAFT / RESEARCH)

> Status: **research stub** — not yet a finalized spec. Per AGENTS.md §10
> this needs full "Research & Benchmarking" before finalization.
>
> Source plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> (the macOS / Linux installer-parity roadmap that establishes the
> bash-installable Linux deployment surface this spec extends).
>
> Required prerequisite: `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
> (Edge Node architecture). The cleanness of cloud deployment depends
> directly on the Edge Node split: Authority Core no longer needs LAN
> proximity to the managed estate.

## Architectural premise (binding)

**DPF is single-tenant by design.** Each customer runs their own DPF
instance on hardware or cloud resources they own. There is no shared
SaaS instance serving multiple customers from a single Authority Core.

Cloud deployment is therefore a **deployment target choice**, not a
product variant. A customer chooses to host DPF on:

- a Windows server in their office (today's default),
- a Linux server in their datacenter (lands with macOS / Linux
  installer-parity Phase 7),
- a macOS workstation (developer install),
- **their own AWS / GCP / Azure account** (this spec).

The architecture, codebase, data model, and authority semantics are
identical across all four. Only the *infrastructure substrate*
changes.

**Out of scope for this spec (and binding non-goals):**

- Multi-tenant SaaS where one Authority Core serves multiple
  customer organizations.
- Tenant isolation logic in Postgres / Neo4j / Qdrant.
- Vendor-managed update orchestration across customer instances.
- DPF-as-vendor billing, metering, or usage-based pricing.
- Shared Identity Edge serving multiple customers' workforces.

If a future feature requires any of those, that feature breaks the
single-tenant premise and needs its own architectural review against
this spec — not a quiet drift into multi-tenancy.

## Why the Edge Node split unlocks this

Without the Edge Node, DPF must run "near" the network it manages
because the discovery sweep, Prometheus host scrapes, and
`host.docker.internal` reachability assume the portal container has
direct host/LAN access. Putting DPF in cloud meant losing on-prem
visibility unless customers tunneled the cloud Authority Core into
their LAN.

With Edge Nodes (per the Edge Node spec), data flows reverse:

```
  Customer-premises Edge Node
        │  egress-only HTTPS, dpfedge_* token
        ▼
  Customer-cloud DPF Authority Core
        │  managed-service connectors
        ▼
  Postgres / Neo4j / Qdrant / Redis / ... (managed cloud services)
```

Customers can put their Authority Core in cloud with no special
networking — the Edge Nodes phone home through standard outbound
HTTPS, the same pattern as Tailscale, Cloudflare Tunnel, and Datadog
Agent. This is the architectural unlock.

## Deployment shapes

Three customer-cloud shapes are in scope. All three host the same
DPF codebase and Authority Core; they differ in the infrastructure
substrate.

### Shape 1 — Single cloud VM (lift-and-shift)

The Linux installer from the Mac/Linux installer-parity roadmap runs
on an EC2 / Compute Engine / Azure VM. Compose stack runs locally on
that VM. Customer's Edge Nodes report in over the public internet
(or via VPC peering / Direct Connect / VPN if the customer prefers).

**Trade-offs:** simplest to operate; no managed-service complexity;
single point of failure unless the customer adds it themselves;
backup is the customer's responsibility (snapshot the volumes).

**Reuses:** the Linux installer itself, unchanged. Cloud deployment
templates (Terraform / CloudFormation / ARM / Deployment Manager)
wrap the installer rather than replacing it.

### Shape 2 — Container service with managed databases

Authority Core runs on ECS Fargate / Cloud Run / Azure Container
Apps. Postgres → RDS / Cloud SQL / Azure Database. Neo4j → AuraDB /
self-managed on a small VM (no fully-managed Neo4j on AWS native).
Qdrant → Qdrant Cloud or self-managed. Redis → ElastiCache / MemoryStore.

**Trade-offs:** managed DB benefits (PITR, replicas, automated
backups). Build Studio sandboxes are the hard part — see "Build
Studio in cloud" below. No HA story for the portal container yet.

**Reuses:** the GHCR-published portal/sandbox/promoter images from
Phase 1 of the installer-parity roadmap. Cloud deployment is a
matter of pointing managed services at compose-equivalent
environment variables.

### Shape 3 — Managed Kubernetes (EKS / GKE / AKS)

Authority Core as a Helm chart. Same managed databases as Shape 2.
Build Studio sandboxes as ephemeral pods.

**Trade-offs:** most operational complexity, but the standard target
for customers who already run k8s. Most flexibility for HA, scaling,
and integration with existing customer GitOps / observability.

**Reuses:** same images, but adds a Helm chart as a separate
artifact. Helm chart can be considered the "cloud-native installer"
counterpart to `install-dpf.sh`.

### Shape 4 — TAPPaaS module (customer's self-hosted private PaaS)

[TAPPaaS](https://tappaas.org/) — "Trusted Automated Private Platform
as a (self-hosted) Service" — is an MPL-2.0 self-hosted PaaS that
targets small business / NGO / government / community deployments on
the customer's own hardware. It is single-tenant by design (one
cluster per organization), cluster-based, and organizes workloads
into "Stacks" (Foundation, AI, Productivity, Home, DevOps) installed
as "TAPPaaS Modules" via `install-module.sh` /
`update-module.sh` / `delete-module.sh` shell scripts.

The premise alignment with DPF is strong:

- **Single-tenant by design** — matches DPF's binding non-goal
  exactly.
- **Customer-owned hardware or cloud** — matches DPF's premise
  that "the project can run on the customer's own hardware,
  including their own cloud resources if chosen."
- **Open source under permissive license** — both projects.
- **Multi-service stack support** — DPF's 8-service compose layout
  fits the TAPPaaS stack model.
- **AI Stack already ships compatible components:** Ollama, vLLM,
  OpenWebUI, LiteLLM. DPF's `LLM_BASE_URL` provider contract
  (Phase 4 of the installer-parity roadmap) can target the customer's
  pre-existing TAPPaaS Ollama service directly without requiring
  DPF to bring its own LLM runtime.
- **Hardware tiering** — TAPPaaS publishes Minimal / Standard /
  Performance tiers (8GB / 16GB / 32GB+ RAM); DPF sits firmly in
  Performance given Postgres + Neo4j + Qdrant + Build Studio +
  browser-use Chromium.

**Trade-offs:** TAPPaaS imposes its own platform conventions (SSO,
networking, firewall, storage layers are architectural sections of
TAPPaaS itself, see [tappaas.org/architecture/](https://tappaas.org/architecture/)).
DPF must decide where to integrate (use TAPPaaS-provided platform
services) and where to keep ownership (DPF's authentik Identity
Edge, DPF's own Postgres / Neo4j / Qdrant).

**Reuses:** same images from the GHCR multi-arch publish (Phase 1 of
the installer-parity roadmap). Packaging adds a `deploy/tappaas/`
directory with `install-module.sh` / `update-module.sh` /
`delete-module.sh` that internally drive whatever TAPPaaS uses —
which is itself an open question (see below).

**Strategic upside:** publishing DPF as a TAPPaaS module gives the
project distribution into a community of organizations (small
business, NGO, government, community of homes) that explicitly want
self-hosted infrastructure. That is exactly the audience this
roadmap and the single-tenant premise are designed for.

**Open questions specific to TAPPaaS** (overlap with the global open
questions further below):

- **Packaging format:** what does TAPPaaS's `install-module.sh`
  invoke under the covers — Helm, Kustomize, kubectl apply,
  Docker Compose, or something custom? Verify by reading
  [tappaas.org/installation/](https://tappaas.org/installation/)
  and the linked module-design pages, or by reading the source on
  the project's repository. The answer determines whether DPF's
  Helm chart from Shape 3 is reusable directly or needs a
  TAPPaaS-specific wrapper.
- **Platform-provided services vs module-provided services:** does
  TAPPaaS provide a shared cluster Postgres / object store /
  ingress controller that modules consume, or does each module
  install its own everything? The TAPPaaS Foundation Stack lists
  Network / Firewall / Storage as platform layers, suggesting some
  shared services exist; the exact contract is undocumented in the
  pages reviewed.
- **Image registries and multi-arch:** does TAPPaaS pull from
  external registries like `ghcr.io/<owner>/dpf-portal:<tag>`?
  Multi-arch (`linux/amd64` + `linux/arm64`) support? GHCR auth for
  customers running early-access (private) images?
- **SSO integration:** TAPPaaS has its own SSO architecture
  section. The enterprise auth spec selects authentik as DPF's
  Identity Edge. If TAPPaaS's SSO is also authentik (or
  interoperable via OIDC), the integration is clean — one
  authentik per cluster, shared by TAPPaaS and DPF. If TAPPaaS
  ships a different IdP, the customer must pick: TAPPaaS SSO
  upstream of DPF authentik via OIDC federation, or two parallel
  IdPs. **This is the single most important integration question.**
- **Build Studio:** TAPPaaS's cluster runtime constraints around
  privileged pods determine whether Build Studio works as-is or
  needs the cloud-shape Option A / B / C decision (see "Build
  Studio in cloud").
- **Module catalog:** is there an officially-published catalog of
  TAPPaaS modules, and what's the vetting process for inclusion?
  A DPF module published to that catalog would amplify the
  project's reach into the TAPPaaS audience.
- **Project maturity and governance:** TAPPaaS lists copyright as
  "TAPPaaS Contributors (2026)" but the team size, release cadence,
  and SLA expectations aren't documented in the overview pages
  reviewed. Do the [tool-evaluation pipeline](../../specs/2026-03-25-tool-evaluation-pipeline-design.md)
  per AGENTS.md §9 before committing DPF to a TAPPaaS dependency.

## Authority Core in cloud — service mapping

| Compose service | AWS | GCP | Azure | Notes |
|---|---|---|---|---|
| portal | ECS Fargate / EKS | Cloud Run / GKE | Container Apps / AKS | Stateless, horizontal-scalable |
| postgres | RDS Postgres / Aurora Postgres | Cloud SQL Postgres | Azure Database for PostgreSQL | PG 16 needed (current schema target) |
| neo4j | EC2 (no fully-managed AWS) or Neo4j AuraDB | GCE or AuraDB | VM or AuraDB | Multi-cloud AuraDB is the cleanest |
| qdrant | EC2 or Qdrant Cloud | GCE or Qdrant Cloud | VM or Qdrant Cloud | Qdrant Cloud is multi-cloud |
| redis | ElastiCache | Memorystore | Azure Cache for Redis | |
| inngest | Inngest Cloud or self-hosted | Inngest Cloud or self-hosted | Inngest Cloud or self-hosted | Decision per customer |
| sandbox | Ephemeral containers (see below) | Ephemeral containers | Ephemeral containers | Hard part |
| promoter | Lambda / Cloud Run Job / Container Job | Cloud Run Job | Container Job | Triggered, not always-on |
| browser-use | ECS / k8s pod | Cloud Run / GKE | Container Apps / AKS | Same as portal |
| adp | ECS / k8s pod | Cloud Run / GKE | Container Apps / AKS | Same as portal |
| prometheus + grafana | Managed Prometheus + Managed Grafana, or self-host | Managed Prometheus + Managed Grafana | Managed Prometheus + Managed Grafana | Customer choice |

The mapping is **not part of the spec contract** — it's a starting
point. The actual deployment templates (next section) pick one
target per cloud rather than offering all permutations.

## Build Studio in cloud — the hard part

Today's sandbox is a privileged sibling container that the portal
shells out to via the host Docker socket
(`apps/web/lib/integrate/sandbox/sandbox.ts`,
`apps/web/lib/mcp-tools.ts:1025-1162`). On a single-VM cloud install
this works unchanged.

On managed container services and serverless platforms, Docker
socket access is restricted or unavailable:

- **ECS Fargate:** no Docker socket access at all.
- **Cloud Run:** no Docker socket; can launch Cloud Run Jobs as
  ephemeral compute.
- **Azure Container Apps:** no Docker socket; can launch Container
  Apps Jobs.
- **EKS / GKE / AKS:** Docker-in-Docker requires privileged pods,
  which most customer security postures forbid.

Architectural choices for this:

- **Option A — Sandbox as ephemeral cloud-native job.** Replace
  `docker run sandbox` with `aws ecs run-task` / `gcloud run jobs
  execute` / `az containerapp job start`. Sandbox container image
  unchanged; lifecycle layer becomes cloud-aware.
- **Option B — Dedicated sandbox node pool.** k8s shapes only. A
  taint-isolated, privileged-permitted node pool for sandbox pods.
  Customer's k8s admin opts in.
- **Option C — Single-VM deployment only for Build Studio.** Don't
  cloud-deploy Build Studio in container-service shapes; require
  Shape 1 (single VM) for any install that uses Build Studio.

Decision deferred to the cloud-deployment epic. **Build Studio
cloud-compatibility is the bottleneck** for Shapes 2 and 3, not the
Authority Core itself.

## Edge Node connectivity from anywhere

Edge Node connectivity to a cloud Authority Core is unchanged from
the Edge Node spec:

- Egress-only HTTPS to the Authority Core's public hostname.
- `dpfedge_*` bearer token for authentication.
- Standard pattern: corporate firewalls already permit outbound 443
  to the customer's chosen Authority Core hostname.
- For air-gapped customer environments, the Edge Node's
  `capability.tunnel.private-link` envelope item handles bidirectional
  connectivity (Tailscale / WireGuard mesh; out of scope for the
  first slice).

The same Edge Node binary, with the same registration flow, supports
Authority Cores hosted on a Windows server, a Linux box, a macOS
workstation, or any of the three cloud shapes above. **No
deployment-target awareness in the binary.**

## Identity in cloud

Per the enterprise auth spec
(`docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`),
DPF uses authentik as the Identity Edge. In cloud:

- **One authentik per DPF instance.** Standard self-hosted
  authentik in the customer's cloud, alongside the Authority Core.
- **Customer brings their own upstream IdP.** authentik connects to
  the customer's existing Entra ID / Okta / Google Workspace / etc.
  via OIDC or SAML.
- **No DPF-vendor-managed identity.** The customer owns the
  authentik instance, the customer's IdP relationship is the
  customer's, the customer's compliance posture is the customer's.

This matches the single-tenant premise: identity stays the
customer's, end-to-end.

## Deployment templates

The cloud-deployment epic ships infrastructure-as-code rather than
a wizard. Proposed primary artifacts:

- **`deploy/terraform/aws/`** — modules for Shape 1 (single VM) and
  Shape 2 (ECS Fargate + RDS + ElastiCache + AuraDB).
- **`deploy/terraform/gcp/`** — same for Cloud Run + Cloud SQL.
- **`deploy/terraform/azure/`** — same for Container Apps + Azure
  Database.
- **`deploy/helm/`** — Helm chart for Shape 3 (any managed k8s).
- **`deploy/cloudformation/`**, **`deploy/arm/`**,
  **`deploy/deployment-manager/`** — secondary, only if customer
  demand justifies.

Terraform is the primary because it's hyperscaler-portable and most
customer infra teams already use it. Helm is the parallel for k8s
shops.

**Reuses the Linux installer:** Shape 1's Terraform module bootstraps
a Linux VM, runs `install-dpf.sh --headless`, returns the Authority
Core URL. The installer-parity roadmap's Phase 6 (`--headless` flag)
is the dependency. No new installer codepath.

## Open questions

These need answers before this stub becomes a finalized spec:

### Substrate decisions
- **Managed Neo4j availability:** AuraDB is multi-cloud but is
  Neo4j-the-company's hosted service. Customers in regulated
  industries may require single-cloud-account deployment, which
  forces self-managed Neo4j on a VM. Default? Per-shape choice?
- **Inngest hosting:** Inngest Cloud, self-hosted Inngest, or
  customer choice? The current compose includes a self-hosted
  inngest service.
- **Build Studio cloud-compatibility:** Option A / B / C above. The
  decision shapes whether Shapes 2 and 3 are first-class or
  documented-as-degraded.

### Operational
- **Backup / DR:** managed DB PITR is the easy answer. What about
  Neo4j when self-managed? What about cross-region failover?
- **Update path:** how does a customer upgrade their cloud-deployed
  DPF? Re-run the Terraform module against a new image tag? GitOps
  pull?
- **Secret management:** customer's KMS / Secrets Manager /
  Key Vault should hold the secrets the installer currently
  generates and writes to `.env`. Terraform modules wire this up.
- **Observability stack in cloud:** Managed Prometheus + Managed
  Grafana per cloud, or ship the existing self-hosted compose
  services into the cloud deployment too? Customer choice or
  default?

### Network
- **Authority Core public exposure:** customers may want the
  Authority Core only on a private VPC, with Edge Nodes connected
  via VPN / PrivateLink / Private Service Connect. The Edge Node
  already handles this (it's just a hostname change), but the
  deployment templates must support both public and private
  exposure modes.
- **Edge Node enrollment for cloud Authority Cores:** the
  bootstrap-token ceremony from the Edge Node spec needs concrete
  flow — does the customer paste a token into the binary on
  install, or is there a TOFU (trust-on-first-use) flow with
  operator approval in Admin > Platform Development?

### Compliance posture
- **Default deployment posture:** what's the recommended default
  for a customer pursuing SOC 2 / HIPAA / FedRAMP? Encryption at
  rest defaults, log retention, audit-trail integrity (Authority
  Core's `ToolExecution` table is the durable audit; cloud-side
  immutable storage like S3 Object Lock?).
- **Customer-managed encryption keys:** RDS / Cloud SQL / managed
  Postgres all support customer-managed KMS keys. Confirm Prisma
  Postgres connector compatibility.

## Research and Benchmarking (TBD per AGENTS.md §10)

Before finalization, compare the deployment patterns of:

**Open source — single-tenant self-hosted:** Mattermost, GitLab
self-managed, Authentik, Wazuh, Plausible Analytics. Read their
cloud deployment templates and what they chose to manage vs require
the customer to bring.

**Open source — self-hosted PaaS as a deployment target:**
[TAPPaaS](https://tappaas.org/) (MPL-2.0, single-tenant, k8s-shaped,
module-driven). Already ships Ollama / vLLM / LiteLLM / OpenWebUI in
its AI Stack — direct alignment with DPF's LLM provider contract.
Open question for the epic: what `install-module.sh` actually invokes
under the covers, and how DPF's authentik Identity Edge interacts
with TAPPaaS's SSO architecture. See Shape 4 above for the full
analysis.

**Open source — fleet/observability with cloud control plane:**
Datadog Agent (open-source agent, closed-source server — so only the
agent side is comparable), osquery + Fleet, Wazuh manager.

**Commercial — for what NOT to do:** Datadog, Auvik, Lansweeper.
These are SaaS multi-tenant; they're the architectural shape DPF
explicitly is not. Useful as anti-patterns.

**Cloud-native deployment patterns:** AWS Marketplace AMIs, GCP
Marketplace, Azure Marketplace. Decide whether to publish DPF as a
marketplace listing.

Document patterns adopted, patterns rejected, anti-patterns
identified, gaps the design fills.

## Sequencing

This epic sits **after** the Edge Node spec is finalized and the
macOS / Linux installer-parity roadmap ships its Phase 7 (full
installer with `--headless`). Customer-cloud deployment depends on:

1. The Linux installer being clean and headless (installer-parity
   Phase 6 / Phase 7).
2. Multi-arch GHCR images (installer-parity Phase 1).
3. Edge Node connectivity contract (Edge Node spec).
4. Build Studio cloud-compatibility decision (this spec, open
   question).

Order: installer-parity → Edge Node → cloud deployment templates.

## Source documents

- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — Linux installer that this spec wraps in IaC.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
  — Edge Node spec; required prerequisite.
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — authentik as the Identity Edge runtime, single-instance per
  customer.
- `apps/web/lib/integrate/sandbox/sandbox.ts`,
  `apps/web/lib/mcp-tools.ts:1025-1162` — current Build Studio
  sandbox code that's the cloud-compatibility bottleneck.
- `docker-compose.yml` — service inventory the cloud templates
  must reproduce.
- `Dockerfile`, `Dockerfile.sandbox`, `Dockerfile.promoter` — image
  artifacts the cloud deployment consumes.
