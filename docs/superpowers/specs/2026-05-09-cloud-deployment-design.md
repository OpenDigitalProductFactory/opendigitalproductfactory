# Customer-Cloud Deployment Design (DRAFT / RESEARCH)

> Status: **research stub** — not yet a finalized spec. Per AGENTS.md §10
> this needs full "Research & Benchmarking" before finalization.
>
> **Doctrine reference:** this spec wraps the eight canonical
> deployment contracts at
> `docs/superpowers/specs/2026-05-09-deployment-contracts.md`. Anything
> below that's the same across deployments belongs in the doctrine,
> not here. This spec captures only the cloud-substrate and
> packaging-target *deltas*.
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

## Deployment substrates

A **substrate** is the infrastructure shape DPF runs on. Three
customer-cloud substrates are in scope; together with the local
substrates from the installer-parity roadmap (Windows / macOS /
Linux on a developer or customer-prem machine), they cover every
DPF deployment.

Substrates are orthogonal to **packaging targets** (next section),
which are *distribution channels* that wrap a substrate.

### Single cloud VM (lift-and-shift)

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

### Managed container service

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

### Managed Kubernetes (EKS / GKE / AKS)

Authority Core deployed via the Helm chart packaging target (below).
Same managed databases as the container-service substrate. Build
Studio sandboxes as ephemeral pods.

**Trade-offs:** most operational complexity, but the standard target
for customers who already run k8s. Most flexibility for HA, scaling,
and integration with existing customer GitOps / observability.

**Reuses:** same GHCR images plus the Helm chart packaging target.

## Packaging and distribution targets

Distinct from substrates: a packaging target is an **artifact +
distribution channel** that wraps one of the substrates above for a
specific customer environment. Canonical DPF artifacts (GHCR images,
Linux installer, Edge Node binary, Helm chart, Terraform modules)
remain canonical; packaging targets reuse them rather than forking
the runtime.

### TAPPaaS module (wraps Single VM substrate)

[TAPPaaS](https://tappaas.org/) — "Trusted Automated Private Platform
as a (self-hosted) Service" — is **not** a fourth cloud substrate. It
is a customer-owned **private-platform distribution target** built
around Proxmox VE (verified at
[tappaas.org/installation/foundation/](https://tappaas.org/installation/foundation/)),
VM modules, lifecycle shell scripts, NixOS / Podman service patterns,
OPNsense / Caddy networking, ZFS storage, and Authentik-based SSO.

The module contract is concrete: each module is a directory containing
`<module>.json`, `install.sh`, `update.sh`, optional `pre-update.sh`,
optional `delete.sh`, and service scripts under `services/`. Module
JSON declares VM provisioning fields (`vmid`, `vmname`, `node`,
`cores`, `memory`, `diskSize`, `storage`, `imageType`, `bridge0`,
`zone0`, `proxyDomain`, `proxyPort`) and a `dependsOn` list. The
TAPPaaS updater wraps each update with snapshot, pre-update tests,
dependency updates, module update, post-update tests, and rollback on
fatal failure.

**Premise alignment** is strong (single-tenant by design,
customer-owned hardware, MPL-2.0, targets small business / NGO /
government / community), but **the runtime model is VM-and-shell-script
on Proxmox**, not Helm-on-Kubernetes. DPF should integrate with that
model rather than fight it, and rather than pretend it's a fourth
cloud substrate.

#### Verified TAPPaaS facts

These are sourced conclusions from the TAPPaaS architecture pages
and module-design source. Treat them as the ground truth this spec
builds on, not open questions:

- **Proxmox VE / VM-based foundation, not Kubernetes.** Verified at
  [tappaas.org/installation/foundation/](https://tappaas.org/installation/foundation/);
  references "Proxmox VE Cluster" and "Proxmox Node" alongside
  OPNsense, VM template creation, and (per architect's source
  review) ZFS storage pools.
- **Module contract is shell-script-driven.** Each module is a
  directory containing `<module>.json`, `install.sh`, `update.sh`,
  optional `pre-update.sh`, optional `delete.sh`, plus service
  dependency scripts under `services/`. Modules declare
  `dependsOn` lists and VM provisioning fields (`vmid`, `vmname`,
  `node`, `cores`, `memory`, `diskSize`, `storage`, `imageType`,
  `bridge0`, `zone0`, `proxyDomain`, `proxyPort`).
- **`install-module.sh` lifecycle:** validates module config,
  checks dependencies, calls dependency `install-service.sh`
  scripts, then runs the module's own `install.sh`.
- **`update-module.sh` lifecycle:** snapshot → pre-update tests →
  dependency updates → module update → post-update tests →
  rollback on fatal failure. The platform owns operational
  rollback at the VM level.
- **Authentik is the preferred TAPPaaS SSO solution**, matching
  the enterprise auth spec's choice for DPF's Identity Edge.
  Identity-automation maturity is incomplete: TAPPaaS's identity
  guide is documented as "TODO: Not tested" with central API key
  management not yet implemented.
- **TAPPaaS AI Stack ships OpenWebUI, LiteLLM, and Ollama/vLLM**
  (verified at [tappaas.org/installation/ai-stack/](https://tappaas.org/installation/ai-stack/)).
  Ollama exposes an OpenAI-compatible endpoint at
  `http://ollama.mgmt.internal:11434/v1` — direct match for DPF's
  `LLM_BASE_URL` provider contract.
- **NixOS / Podman service pattern is a published precedent** —
  the OpenWebUI module runs as a NixOS VM with a Podman container,
  per architect's source review. DPF can reuse Debian + Docker
  Compose initially without committing to that pattern.

#### What a DPF TAPPaaS module is

The first DPF TAPPaaS module is a **VM wrapper around the Single VM
substrate**. It provisions a dedicated VM via TAPPaaS's `cluster:vm`,
then runs DPF's Linux installer (`install-dpf.sh --headless`) inside
that VM. Suggested module dependencies:

```json
{
  "dependsOn": [
    "cluster:vm",
    "templates:debian",
    "backup:vm",
    "firewall:proxy",
    "identity:identity"
  ]
}
```

`templates:debian` is the lowest-risk choice; `templates:nixos` can
come later if/when DPF supports a NixOS / Podman-native packaging,
which is gated on the Build Studio provider abstraction
(`docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`).

#### Canonical artifacts stay canonical

The TAPPaaS module **must not fork** DPF's runtime semantics. Canonical
DPF artifacts remain:

1. GHCR multi-arch images (installer-parity Phase 1)
2. Linux installer (`install-dpf.sh`, installer-parity Phase 6/7)
3. Helm chart (packaging target below)
4. Terraform modules (packaging target below)
5. Edge Node binary (Edge Node spec, Mode B)

The TAPPaaS module wraps these. It does not replace them.

#### Identity integration — phased

TAPPaaS also chooses Authentik as its preferred SSO solution, which
matches DPF's enterprise auth direction
(`docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`).
However, TAPPaaS's identity automation is documented as work in
progress, so DPF cannot assume a fully wired identity edge on day one.

| Phase | Recommendation |
|---|---|
| Initial DPF TAPPaaS module | DPF ships its own identity surface, **or** connects to a TAPPaaS-managed Authentik as upstream OIDC if one is present and stable in that customer's install. |
| Later integration | Add `identity:auth` (or whatever TAPPaaS settles on) as a hard module dependency once TAPPaaS identity automation is real and tested. |
| Never | Let TAPPaaS Authentik own DPF authorization semantics. DPF remains the Authority Core; TAPPaaS Authentik is at most a **shared identity edge** or **upstream IdP**, never the policy decision point. |

This preserves the authority/edge split inherited from the enterprise
auth spec.

#### Network / ingress integration

TAPPaaS has a mature network stack: VLAN zones (mgmt / srv / dmz /
client / iot), OPNsense firewall, Caddy reverse proxy with automatic
provisioning. DPF should integrate via the standard module fields
rather than ship its own ingress:

```json
{
  "zone0": "srv",
  "proxyDomain": "dpf.<customer-domain>",
  "proxyPort": 3000
}
```

Edge Nodes can still report into the DPF Authority Core over HTTPS in
a TAPPaaS install. Some Edge Node functionality may be redundant in
that environment because TAPPaaS already controls much of the private
network, but **keep the Edge Node boundary consistent** — don't fork
the trust contract for TAPPaaS deployments.

#### Storage / backup integration

TAPPaaS uses ZFS-based storage pools with cross-node snapshots and
replication, with a stated caveat that synchronous replication is not
provided (best replication may lag several minutes). The module update
lifecycle natively supports snapshot + rollback.

Recommendation: **TAPPaaS VM snapshots are the platform rollback
mechanism. DPF logical backups remain the application recovery
mechanism.** Don't trust VM snapshots as the only database recovery
story. The DPF module's `pre-update.sh` should still take logical
exports of Postgres / Neo4j / Qdrant before letting TAPPaaS take its
VM snapshot.

#### LLM provider integration

TAPPaaS's AI Stack ships OpenWebUI, LiteLLM, Ollama, and vLLM. The
Ollama module exposes an OpenAI-compatible endpoint at
`http://ollama.mgmt.internal:11434/v1`. This is a perfect match for
DPF's `LLM_BASE_URL` provider contract from installer-parity Phase 4.

For TAPPaaS installs where the AI Stack is present:

```
DPF_LLM_PROVIDER=external
LLM_BASE_URL=http://ollama.mgmt.internal:11434/v1
```

or, preferably (if the customer's LiteLLM gateway routes to the right
upstreams):

```
DPF_LLM_PROVIDER=external
LLM_BASE_URL=http://litellm.srv.internal:<port>/v1
```

**Do not install DPF's own Ollama service when the TAPPaaS AI Stack
is present.** Use the customer's pre-existing AI Stack as the upstream
provider; that's exactly what the LLM provider contract was designed
to allow.

#### Build Studio in TAPPaaS

TAPPaaS is actually **more promising for Build Studio than serverless
container platforms** because a DPF module can run inside a VM where
Docker (or Podman) is available. The OpenWebUI module precedent shows
a NixOS VM running a Podman container.

However, DPF's current Build Studio uses Docker socket / sibling
container semantics
(`apps/web/lib/integrate/sandbox/sandbox.ts`). The TAPPaaS module
therefore targets one of two modes:

| Mode | Cost | Status |
|---|---|---|
| **First release** — DPF runs inside a VM via Docker Compose, preserving Build Studio parity. | Low; reuses Single VM substrate verbatim. | Recommended for v1 of the TAPPaaS module. |
| **Native TAPPaaS mode** — DPF re-implemented as a NixOS / Podman module pattern with sandbox lifecycle reworked accordingly. | High; requires the Build Studio provider abstraction. | Defer until that abstraction exists. |

**TAPPaaS is a full-parity DPF target only when DPF runs in its own
VM with Docker available.** Don't promise NixOS/Podman-native parity
until Build Studio supports a provider abstraction — that's a
non-trivial refactor with its own design pass.

#### Strategic upside

Publishing a DPF module to a TAPPaaS catalog reaches an audience
(small business / NGO / government / community of homes) that
explicitly wants self-hosted infrastructure. That is exactly the
audience this single-tenant premise is designed for. **TAPPaaS is a
good docking bay, not the mothership.** Package DPF for it; integrate
with its Authentik / LLM / networking where clean; keep DPF's
canonical deployment contracts independent.

#### Open questions specific to TAPPaaS

- **Module catalog and publishing:** is there an officially-published
  catalog and what's the vetting process for inclusion? A DPF module
  in that catalog would amplify project reach.
- **Project maturity:** TAPPaaS lists copyright as "TAPPaaS
  Contributors (2026)"; team size and release cadence aren't
  documented in pages reviewed. Run TAPPaaS through the AGENTS.md §9
  Tool Evaluation Pipeline before committing DPF to a hard
  dependency.
- **Upstream IdP federation timing:** when does TAPPaaS's
  `identity:identity` automation reach the maturity bar where DPF can
  hard-depend on it (vs treating it as optional upstream OIDC)?
- **Multi-arch VM templates:** do `templates:debian` and
  `templates:nixos` ship arm64 variants for Apple Silicon Proxmox
  hosts? (Likely amd64 only in practice; flag as an installer-parity
  cross-check.)
- **Edge Node deployment inside TAPPaaS:** when DPF Edge Nodes onboard
  *other* hosts in a TAPPaaS-managed customer network, can they be
  deployed as TAPPaaS modules in their own right (per managed host),
  or do they remain the Edge Node binary outside TAPPaaS's module
  system?

### Cloud marketplace image / package (wraps Single VM substrate)

AWS Marketplace AMI, GCP Marketplace, Azure Marketplace listings.
Same wrap as TAPPaaS: a marketplace listing bootstraps a Single VM
substrate with `install-dpf.sh --headless` baked in, plus
marketplace-specific licensing / billing metadata.

This packaging target is a **distribution channel decision**, not an
architectural one — covered here so the spec accounts for the option,
not because it changes anything technical. Decide per-marketplace
based on customer demand.

### Helm chart (wraps Managed Kubernetes substrate)

A Helm chart published to a public OCI registry (or as a
git-checkout-able artifact under `deploy/helm/`) is the canonical
packaging target for the Managed Kubernetes substrate. Customer
runs `helm install dpf <chart>` against their EKS / GKE / AKS / on-
prem cluster.

The chart wraps:

- The same GHCR multi-arch images the installer uses.
- Values for the runtime configuration schema (contract 2 of the
  doctrine): public URL, auth, database URLs, LLM provider,
  observability targets, Edge Node endpoint, Build Studio config.
- Optional dependency charts for Postgres / Neo4j / Qdrant when the
  customer doesn't bring their own managed services. (When they do,
  set `postgresql.enabled=false` etc. and the chart consumes
  external connection strings.)
- The Build Studio provider configuration — see the build-execution-
  provider spec; on Kubernetes the default provider is
  `kubernetes-job` once that lands.

The Helm chart can be considered the "cloud-native installer"
counterpart to `install-dpf.sh`. It does not replace the installer;
it wraps the same artifacts via a different orchestration mechanism.

### Terraform modules (wraps any cloud substrate)

Terraform modules under `deploy/terraform/{aws,gcp,azure}/` provision
the substrate and bootstrap DPF inside it. Per substrate:

- **Single VM:** Terraform module creates the VM, attaches storage,
  configures security groups, runs `install-dpf.sh --headless` via
  cloud-init or an SSH provisioner, returns the Authority Core URL
  output.
- **Managed container service:** module creates the container service
  + managed databases + secret store + load balancer; deploys the
  GHCR images directly.
- **Managed Kubernetes:** module creates the cluster + node pools +
  ingress + DNS, then `helm install`s the chart above.

Terraform is the primary cross-substrate IaC because it's
hyperscaler-portable and most customer infra teams already use it.
CloudFormation / ARM / Deployment Manager are secondary, considered
only on customer demand.

## Deployment priority

Subject to the open questions, the recommended ordering is:

1. **Single VM substrate.** First GA customer-cloud and
   private-platform target. Lowest risk, reuses the installer-parity
   roadmap directly.
2. **TAPPaaS module wrapping Single VM.** High-value
   self-hosted distribution channel. Build after installer parity
   ships and GHCR images publish multi-arch (Phase 1 of the
   installer-parity roadmap).
3. **Helm chart on Managed Kubernetes substrate.** Strategic
   enterprise target. Requires the Build Studio provider abstraction
   to ship Build Studio capability; without it, ships
   Build-Studio-disabled.
4. **Managed container service substrate.** Preview-only until the
   Build Studio provider abstraction lands. Without it, ships a
   degraded DPF (no Build Studio).
5. **Cloud marketplace image / package.** Distribution-channel
   work; sequenced based on demand, not capability.
6. **Terraform modules** ship in parallel with the substrates they
   target (each module gates on its substrate's readiness).

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
point. The actual deployment templates pick one target per cloud
rather than offering all permutations.

## Build Studio in cloud — the hard part

Today's sandbox is a privileged sibling container that the portal
shells out to via the host Docker socket
(`apps/web/lib/integrate/sandbox/sandbox.ts`,
`apps/web/lib/mcp-tools.ts:1025-1162`). On a Single VM substrate
install this works unchanged.

On managed container services and serverless platforms, Docker
socket access is restricted or unavailable:

- **ECS Fargate:** no Docker socket access at all.
- **Cloud Run:** no Docker socket; can launch Cloud Run Jobs as
  ephemeral compute.
- **Azure Container Apps:** no Docker socket; can launch Container
  Apps Jobs.
- **EKS / GKE / AKS:** Docker-in-Docker requires privileged pods,
  which most customer security postures forbid.

The right answer is the **Build Studio provider abstraction** at
`docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`,
which decouples sandbox lifecycle from any specific runtime.

Until that abstraction ships, the constraints translate to:

- **Single VM substrate:** Build Studio works (provider:
  `local-docker`).
- **TAPPaaS module:** Build Studio works (provider: `local-docker`
  inside the provisioned VM, or future `tappaas-vm` provider).
- **Cloud marketplace image:** Build Studio works (same as Single VM).
- **Managed container service:** Build Studio is preview-only; needs
  `cloud-run-job` / `ecs-task` / `azure-containerapp-job` providers.
- **Managed Kubernetes:** Build Studio is preview-only; needs
  `kubernetes-job` provider, optionally backed by a privileged
  node pool if a customer opts in.

**Build Studio cloud-compatibility is the bottleneck** for the
container-service and Kubernetes substrates, not the Authority Core
itself. The Single VM substrate, the TAPPaaS module, and the
marketplace image all inherit Build Studio compatibility from
`local-docker` and ship Build Studio on day one without waiting for
the cloud-native sandbox rewrite.

## LLM provider routing across deployment options

DPF supports **four provider modes** today, with distinct credential
flows and deployment requirements. The right default per deployment
shape isn't obvious from the substrate alone — the auth/credential
axis matters as much as the substrate axis.

### Provider modes

1. **Inference via OpenAI-compatible HTTP endpoint** (`LLM_BASE_URL`).
   Routes to OpenAI / Anthropic public APIs, Ollama, Docker Model
   Runner, vLLM, or a LiteLLM gateway. Auth is API key (long-lived
   secret in DPF's encrypted credentials), or none for local Ollama.
   This is the inference path the installer-parity Phase 4 contract
   formalizes (`DPF_LLM_PROVIDER`, `LLM_BASE_URL`,
   `DPF_MODEL_PULL_MODE`).
2. **Provider OAuth (authorization-code)** for upstream provider
   accounts that don't accept API keys, or where the customer wants
   per-user authorization. Spec:
   `docs/superpowers/specs/2026-03-21-provider-oauth-authorization-code-design.md`.
   Implementation: `apps/web/lib/{provider-oauth,actions/provider-oauth,govern/provider-oauth}.ts`,
   callback at `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts`.
   Auth is a refreshable token tied to a provider account (e.g.
   Anthropic console, GitHub).
3. **Anthropic subscription OAuth** specifically for Claude Pro /
   Max subscription accounts (different cost model: subscription, not
   per-token). Spec:
   `docs/superpowers/specs/2026-03-22-anthropic-sub-oauth-design.md`.
4. **CLI agents inside the sandbox.** `Dockerfile.sandbox:6,9`
   bundles `@openai/codex` and `@anthropic-ai/claude-code`. These
   tools make their own LLM calls *bypassing* DPF's `LLM_BASE_URL`
   contract, using their own auth (Codex OAuth or OpenAI API key;
   Claude Code OAuth or Anthropic API key). Specs:
   `2026-03-15-codex-provider-integration-design.md`,
   `2026-04-08-claude-code-cli-dispatch-design.md`.

The four modes coexist. A typical install uses:
- mode 1 (Ollama or Docker Model Runner) for the platform's own
  agents and inference,
- mode 4 (CLIs) inside Build Studio sandboxes,
- mode 2/3 (OAuth) when a customer plugs an external account into
  the provider registry.

### Reachability requirements per provider mode

| Mode | Outbound | Inbound callback | Specific port lock-in | DPF secret store |
|---|---|---|---|---|
| 1 — `LLM_BASE_URL` API key | HTTPS to provider or in-cluster Ollama | none | none | API key |
| 1 — `LLM_BASE_URL` local | none (in-cluster) | none | none | none |
| 2 — Provider OAuth | HTTPS to provider | **publicly reachable callback URL** at `/api/v1/auth/provider-oauth/callback` | varies by provider | refresh token |
| 3 — Anthropic sub OAuth | HTTPS to Anthropic | publicly reachable callback URL | varies | refresh token |
| 4 — Codex CLI in sandbox | HTTPS from sandbox container to OpenAI | **port 1455** (`docker-compose.yml:79`, "shared client requires this port") | **yes — port 1455 hardcoded** | per-account in CLI config volume |
| 4 — Claude Code CLI in sandbox | HTTPS from sandbox container to Anthropic | varies (OAuth or API key) | none if API key | per-account in CLI config volume |

The **port 1455 lock-in for Codex** is the single biggest deployment
constraint. Codex's shared OAuth client requires that specific port
for its redirect URI; customers cannot freely remap it.

### Compatibility matrix (compatibility × default per deployment)

| Deployment | Mode 1 — public API | Mode 1 — Docker Model Runner | Mode 1 — Ollama (in-cluster) | Mode 1 — external Ollama / LiteLLM | Mode 2 — provider OAuth | Mode 3 — Anthropic sub | Mode 4 — Codex CLI | Mode 4 — Claude Code CLI |
|---|---|---|---|---|---|---|---|---|
| Win + Docker Desktop (today) | ✓ | **default** | alt | ✓ | ✓ if public DNS | ✓ if public DNS | ✓ (port 1455 local) | ✓ |
| Mac + Docker Desktop (Phase 7) | ✓ | **default** | alt | ✓ | ✓ if public DNS | ✓ if public DNS | ✓ | ✓ |
| Linux native Docker (Phase 7) | ✓ | unavailable | **default** | ✓ | ✓ if public DNS | ✓ if public DNS | ✓ | ✓ |
| Single VM substrate | ✓ | unavailable | default | ✓ | ✓ — straightforward | ✓ | ✓ if 1455 exposed | ✓ |
| Managed container service | ✓ | unavailable | impractical (GPU + state) | **recommended** | requires sticky callback host | requires sticky callback host | impractical (port lock-in) | ✓ |
| Managed Kubernetes | ✓ | unavailable | via Helm + GPU node pool | ✓ | ✓ via Ingress | ✓ via Ingress | requires explicit 1455 Ingress rule | ✓ |
| TAPPaaS module | ✓ | unavailable | possible but redundant | **default** (AI Stack Ollama) | ✓ via Caddy `proxyDomain` | ✓ via Caddy `proxyDomain` | needs Caddy rule for 1455 | ✓ |
| Marketplace image | ✓ | unavailable | default (self-hosted) | ✓ | ✓ if customer wires DNS | ✓ | ✓ if 1455 exposed | ✓ |

### Compliance and data-residency

- **Modes 1 (public API), 2, 3, 4** all ship customer prompts and
  context to vendor APIs. Incompatible with air-gapped deployments
  out of the box. HIPAA / FedRAMP customers need explicit BAAs / FedRAMP
  authorization with each provider before enabling.
- **Mode 1 local (Ollama / Docker Model Runner)** keeps data inside
  the customer's environment. The default for compliance-sensitive
  installs.
- **CLI agents (mode 4)** are the most subtle compliance pitfall:
  they're bundled with the platform image but their network calls
  bypass the LLM_BASE_URL contract and the platform's audit envelope.
  An air-gapped customer must either configure the CLIs to use a
  local OpenAI-compatible endpoint (Codex CLI now supports
  `OPENAI_BASE_URL`; Claude Code CLI similar config) or disable them
  in the sandbox image.

### Cost / capacity models

| Mode | Cost model | Capacity model | Customer billing relationship |
|---|---|---|---|
| 1 — public API | per-token, metered | per-API-key rate limit | direct with provider |
| 1 — local LLM | capex / fixed compute | concurrent-capacity ceiling | none (customer's hardware) |
| 2 / 3 — provider OAuth | per-account (metered or subscription) | per-account rate limit | direct with provider |
| 4 — CLI agents | per-account, blended (subscription + per-token) | per-account rate limit | direct with provider |
| LiteLLM gateway | aggregates all of the above | configured per-route | customer-defined |

LiteLLM is the recommended fan-out point for customers running mixed
modes — it gives a single `LLM_BASE_URL` target that internally routes
by class (PII to local, general to public, premium to subscription).
The TAPPaaS packaging target gets this for free if the customer
already runs the AI Stack.

### Deployment-specific guidance

- **Single VM substrate:** default to Ollama (in compose) for
  inference; expose port 1455 if Build Studio with Codex is in scope;
  document that customers in regulated industries should pick local
  Ollama and disable the sandbox CLIs (mode 4) until a local-routed
  config is wired.
- **Managed container service:** strongly recommend external
  Ollama or LiteLLM as the LLM_BASE_URL target. Codex CLI (mode 4)
  is impractical on this substrate due to the port-1455 lock-in
  combined with the substrate's port-mapping restrictions; document
  Build Studio as Codex-disabled / Claude-Code-only here.
- **Managed Kubernetes:** Ingress can route mode 2/3 callbacks
  cleanly; mode 4 Codex requires an explicit 1455-routed Ingress rule
  and is fragile if the customer's k8s cluster is multi-tenant. Helm
  chart should expose this as a values flag, default off.
- **TAPPaaS module:** default to mode 1 external pointing
  at the customer's TAPPaaS AI Stack (Ollama or LiteLLM). OAuth
  callbacks (modes 2/3) work via Caddy's `proxyDomain`. Codex (mode 4
  with port 1455) requires a Caddy rule that publishes 1455
  externally — feasible but worth documenting as a Build-Studio
  prerequisite. Claude Code CLI (mode 4) works without the port
  constraint and is the lower-friction default for the TAPPaaS shape.
- **Marketplace image:** identical to Single VM substrate; whatever
  the marketplace image bakes in becomes the customer's default
  unless they override.

The runtime contract from installer-parity Phase 4 (`DPF_LLM_PROVIDER`,
`LLM_BASE_URL`, `DPF_MODEL_PULL_MODE`, `EMBEDDING_MODEL`,
`BROWSER_USE_MODEL`) does **not** change across deployment options.
What changes is which modes are *available* and which are *reachable*
on each shape.

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
workstation, or any of the cloud substrates above. **No
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

## Open questions

These need answers before this stub becomes a finalized spec:

### Substrate decisions
- **Managed Neo4j availability:** AuraDB is multi-cloud but is
  Neo4j-the-company's hosted service. Customers in regulated
  industries may require single-cloud-account deployment, which
  forces self-managed Neo4j on a VM. Default? Per-substrate choice?
- **Inngest hosting:** Inngest Cloud, self-hosted Inngest, or
  customer choice? The current compose includes a self-hosted
  inngest service.
- **Build Studio cloud-compatibility:** see the build-execution-
  provider spec for the architectural decision; the question for
  this spec is which substrate ships Build-Studio-enabled vs
  preview at v1.

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

**Open source — self-hosted private platform as a packaging target:**
[TAPPaaS](https://tappaas.org/) (MPL-2.0, single-tenant, **Proxmox /
VM / shell-script-based — not Kubernetes**). Already ships Ollama /
vLLM / LiteLLM / OpenWebUI in its AI Stack — direct alignment with
DPF's LLM provider contract. Reclassified in this spec as a
private-platform **packaging target** rather than a fourth cloud
substrate; it wraps the Single VM substrate inside a TAPPaaS module
contract. See the TAPPaaS module section above for the full
analysis including identity / network / storage / Build Studio
integration guidance.

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
4. Build Execution Provider abstraction
   (`docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`)
   for substrates beyond Single VM / TAPPaaS / Marketplace.

Order: installer-parity → Edge Node → Build Execution Provider →
cloud deployment templates.

## Source documents

- `docs/superpowers/specs/2026-05-09-deployment-contracts.md` — the
  doctrine this spec wraps.
- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — Linux installer that this spec wraps in IaC.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
  — Edge Node spec; required prerequisite.
- `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
  — Build Studio provider abstraction; gates the cloud substrates
  beyond Single VM.
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
