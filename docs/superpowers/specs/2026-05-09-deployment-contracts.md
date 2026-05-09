# Canonical Deployment Contracts (DRAFT)

> Status: **doctrine spec** — establishes the binding contracts every
> DPF deployment target wraps. Per AGENTS.md §10 this needs full
> "Research & Benchmarking" before finalization, but its primary job
> is to anchor existing deployment specs against shared rules so they
> stop describing five deployment worlds and start describing one
> architecture with several wrappers.
>
> Source plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> already separates **developer setup**, **release runtime**, and
> **end-user installation** as the three contracts an installer must
> not collapse. This spec generalizes that seed across Windows, macOS,
> Linux, cloud, TAPPaaS, and any future packaging target.

## Why this exists

Without a shared doctrine, each deployment spec invents its own
release artifacts, lifecycle, identity story, Edge Node treatment,
Build Studio assumptions, observability layout, and secret store. The
result is duplicate truth: the cloud spec says one thing, the TAPPaaS
section says another, the Edge Node spec implies a third. Drift is
inevitable; consistency is impossible.

The fix is to make the deployment-target docs **wrap** a shared set
of contracts rather than each restate them. Mac, Windows, Linux,
cloud, and TAPPaaS are different coats on the same creature. This
spec is the creature.

## The eight canonical contracts

All DPF deployment targets must wrap these contracts. Wrappers may
provision infrastructure, secrets, ingress, and backups around each
contract; they must not fork or replace the contract itself.

### 1. Release artifacts

Every installed-runtime service ships as a versioned multi-arch
GHCR image (`ghcr.io/<owner>/dpf-<svc>:<tag>` for both `linux/amd64`
and `linux/arm64`). The compose file's `image:` references and the
Helm chart's image tags resolve to those same artifacts. Local
builds via `docker compose build` exist for development; deployment
wrappers consume the pre-published images.

Single source of truth: the GHCR publish workflow at
`.github/workflows/publish-image.yml` plus Phase 1 of the
installer-parity roadmap that makes it multi-arch.

### 2. Runtime configuration

One env / config schema covers every deployment. Variables include
the public URL, auth settings, database connections, the LLM
provider contract (`DPF_LLM_PROVIDER`, `LLM_BASE_URL`,
`DPF_MODEL_PULL_MODE`, `EMBEDDING_MODEL`, `BROWSER_USE_MODEL` per
installer-parity Phase 4), observability targets, Edge Node
endpoints, and Build Studio configuration.

Wrappers may inject these from different secret stores (cloud KMS,
TAPPaaS module config, `.env` file), but the variable names and
semantics are identical across deployments.

Single source of truth: `.env.docker.example` and
`.env.example`, kept current as the runtime schema documentation.

### 3. Lifecycle

Every deployment supports the same lifecycle operations: install,
start, stop, update, backup, restore, uninstall. Different
substrates implement them differently (`install-dpf.sh` on Linux,
PowerShell `dpf-{start,stop,reinstall,release}.ps1` on Windows, a
TAPPaaS module's `install.sh` / `update.sh` / `delete.sh` scripts
on a TAPPaaS deployment), but the *operations* are the same.

The update operation must support pre-update logical backups
(Postgres / Neo4j / Qdrant exports) regardless of whether the
substrate also takes its own snapshot.

### 4. Identity

DPF Authority Core owns authorization semantics: principals, roles,
groups, route capabilities, coworker grants, Edge Node trust,
downstream app assignments. The Identity Edge presents OIDC, SAML,
LDAP, and SCIM protocol surfaces. No deployment target may move
authorization decisions out of the Authority Core.

Per `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`:
"DPF owns identity meaning and authority. The identity edge owns
protocol presentation."

Identity Edge can be **dpf-managed** (DPF deploys its own authentik),
**customer-provided** (existing identity edge wired in), or
**tappaas-upstream** (TAPPaaS Authentik used as upstream OIDC into
DPF's identity edge, only when isolation and automation are
explicitly validated). See the enterprise auth spec for the full
mode definitions.

### 5. Edge

Edge Nodes own host visibility, LAN discovery, private-network
participation, and host-local trust enforcement. Authority Core
owns policy decisions; Edge Nodes cache for resilience and gateway
local protocols (MCP, A2A) under Authority Core's audit envelope.

The Edge Node binary is **deployment-target neutral**. It registers
with an Authority Core URL and receives its policy and capability
configuration from there. The same binary supports Windows, macOS,
Linux, cloud-hosted Authority Cores, TAPPaaS-hosted Authority Cores,
and remote managed hosts.

Per `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`.

### 6. Build execution

Build Studio uses a **provider abstraction**: local Docker is one
provider, not the whole architecture. The runtime exposes a
`BuildExecutionProvider` interface; deployments configure which
provider implementation is wired in (`local-docker`, `tappaas-vm`,
`kubernetes-job`, `ecs-task`, `cloud-run-job`,
`azure-containerapp-job`, `disabled`).

Per `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
(stub).

The current implementation at
`apps/web/lib/integrate/sandbox/sandbox.ts` and
`apps/web/lib/mcp-tools.ts:1025-1162` shells out to Docker socket;
that's the `local-docker` provider in this taxonomy. Other
providers are stubs until the abstraction lands.

### 7. Observability

DPF emits app and runtime metrics via `/api/metrics` (prom-client) —
this is portable across every deployment. **Platform metrics**
(host CPU / memory / network / disk) are substrate-specific:
cadvisor + node-exporter on Linux (`linux-monitoring` profile);
managed metrics on cloud (CloudWatch / Stackdriver / Azure Monitor);
TAPPaaS's own observability stack on TAPPaaS deployments.

The discovery sweep
(`packages/db/src/discovery-collectors/network.ts`) is currently
Prometheus-coupled but moves to the Edge Node's
`capability.discovery.network` once that ships. The substrate
choice does not change the *output* contract (`InventoryEntity`,
`InventoryRelationship`, `InfraCI`).

Historical context preserved at
`docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md`:
silent failures of critical infrastructure must produce alerts.
Wrappers must preserve that invariant.

### 8. Secrets

The same logical secrets (admin password, AUTH_SECRET, DB
passwords, encryption keys, MCP / Edge Node tokens, provider OAuth
refresh tokens) exist across every deployment. The backing store
varies: `.env` on a single VM, AWS Secrets Manager on Shape 2,
Azure Key Vault, GCP Secret Manager, k8s `Secret` resources, or
TAPPaaS-module-managed secrets.

Wrappers must not invent new secret semantics. If a deployment
needs a new logical secret, it goes into the runtime config schema
(contract 2) and propagates to every other wrapper.

## What deployment specs are required to do

Every deployment-target spec must:

1. State explicitly that it wraps these contracts; do not restate
   them.
2. Map each contract to its substrate-specific implementation
   (e.g. "Secrets are backed by AWS Secrets Manager via the
   Terraform module"; "Identity Edge mode is `customer-provided` —
   the customer wires in an existing authentik or OIDC IdP").
3. Surface only the **deltas** that the substrate or packaging
   target introduces. Anything that's the same across deployments
   stays in this doctrine spec.

Specs that violate this rule should be brought back into compliance
rather than allowed to drift.

## Specs that wrap this doctrine

- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — installer-parity roadmap. Phases 1, 2, 4, 6, 7 directly
  implement contracts 1, 2, 3, 7, 8.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` —
  Edge Node, the canonical implementation of contract 5.
- `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`
  — customer-cloud deployment shapes; wraps contracts 1-8 per
  cloud substrate.
- `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
  — Build Studio provider abstraction, the canonical
  implementation of contract 6.
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — authentik as Identity Edge; the canonical implementation of
  contract 4.

## Out of scope

This doctrine does **not** specify:

- Which cloud hyperscaler is preferred (substrate choice).
- Which TAPPaaS module dependency tree to use (packaging-target
  detail).
- Which Linux distribution the installer targets (installer-parity
  roadmap detail).
- Multi-tenancy. **DPF is single-tenant by design** per the
  cloud-deployment spec; this doctrine inherits that premise. If a
  feature requires multi-tenancy, it breaks the premise and needs
  its own architectural review.

## Open questions

- **Where does the LLM-provider contract live long term — in this
  doctrine, in the cloud-deployment spec, or in a dedicated LLM
  routing spec?** Currently captured in installer-parity Phase 4
  and elaborated in the cloud-deployment spec's "LLM provider
  routing" section. Decide whether to lift it here as a ninth
  contract.
- **Versioning the doctrine.** When a new logical secret or
  lifecycle operation is added, every deployment spec needs to
  catch up. Is the answer a doctrine `version:` field with
  per-spec compatibility? Or just careful PR review?
- **Contract enforcement.** Should there be a CI check that
  flags deployment specs claiming behavior that contradicts the
  doctrine? Probably not in v1 — humans review specs.

## Source documents

- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — Chief Architect Amendment that planted the three-contract seed.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` —
  Edge Node architecture this doctrine references.
- `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`
  — cloud deployment substrate / packaging-target taxonomy this
  doctrine anchors.
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — authority/edge split this doctrine codifies as contract 4.
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md`
  — observability invariants that contract 7 preserves.
