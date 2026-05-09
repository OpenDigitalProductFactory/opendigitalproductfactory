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

(Originally seeded with 8 contracts; Contract 9 added 2026-05-09 to
unify LLM and agent-provider routing across deployments — that
material was previously scattered across the cloud and installer
specs.)

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

### 9. LLM and agent-provider routing

Every deployment uses the same LLM provider contract. Wrappers may
default to different providers (Docker Model Runner on Mac/Windows
Docker Desktop, Ollama on Linux, the customer's TAPPaaS AI Stack on
TAPPaaS deployments) but **must not fork the provider semantics**.

#### Runtime envvars (universal across deployments)

```
DPF_LLM_PROVIDER          # model-runner | ollama | external
LLM_BASE_URL              # OpenAI-compatible base URL
LLM_MODEL                 # default chat-completions model
EMBEDDING_MODEL           # default embedding model
BROWSER_USE_MODEL         # browser-use service model selection
DPF_MODEL_PULL_MODE       # auto | skip | verify-only
```

The portal's inference layer (`apps/web/lib/ai-inference.ts`)
honors these unchanged across every substrate.

#### Provider modes (universal)

DPF supports **four** provider modes; they coexist within a single
deployment:

1. **Inference via OpenAI-compatible HTTP endpoint** (`LLM_BASE_URL`).
   Routes to OpenAI / Anthropic public APIs, Ollama, Docker Model
   Runner, vLLM, or a LiteLLM gateway. Auth is API key (long-lived
   secret in DPF's encrypted credentials), or none for local Ollama.
2. **Provider OAuth (authorization-code)** for upstream provider
   accounts that don't accept API keys, or where the customer wants
   per-user authorization. Spec:
   `docs/superpowers/specs/2026-03-21-provider-oauth-authorization-code-design.md`.
   Implementation: `apps/web/lib/{provider-oauth,actions/provider-oauth,govern/provider-oauth}.ts`,
   callback at `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts`.
3. **Anthropic subscription OAuth** for Claude Pro / Max subscription
   accounts (different cost model: subscription, not per-token).
   Spec:
   `docs/superpowers/specs/2026-03-22-anthropic-sub-oauth-design.md`.
4. **CLI agents inside the sandbox.** `Dockerfile.sandbox:6,9`
   bundles `@openai/codex` and `@anthropic-ai/claude-code`. These
   tools make their own LLM calls *bypassing* DPF's `LLM_BASE_URL`
   contract, using their own auth (Codex OAuth or OpenAI API key;
   Claude Code OAuth or Anthropic API key). Specs:
   `2026-03-15-codex-provider-integration-design.md`,
   `2026-04-08-claude-code-cli-dispatch-design.md`.

#### Reachability requirements (universal)

| Mode | Outbound | Inbound callback | Specific port lock-in | DPF secret store |
|---|---|---|---|---|
| 1 — `LLM_BASE_URL` API key | HTTPS to provider or in-cluster | none | none | API key |
| 1 — `LLM_BASE_URL` local | none (in-cluster) | none | none | none |
| 2 — Provider OAuth | HTTPS to provider | publicly reachable callback at `/api/v1/auth/provider-oauth/callback` | varies by provider | refresh token |
| 3 — Anthropic sub OAuth | HTTPS to Anthropic | publicly reachable callback URL | varies | refresh token |
| 4 — Codex CLI in sandbox | HTTPS from sandbox to OpenAI | **port 1455** (`docker-compose.yml:79`, "shared client requires this port") | **yes — port 1455 hardcoded** | per-account in CLI config volume |
| 4 — Claude Code CLI in sandbox | HTTPS from sandbox to Anthropic | varies (OAuth or API key) | none if API key | per-account in CLI config volume |

The **port 1455 lock-in for Codex** is the single biggest deployment
constraint. Wrappers must either expose port 1455 reachably from the
user's browser or document Codex CLI as unsupported.

#### Compliance and data-residency (universal)

- **Modes 1 (public API), 2, 3, 4** all ship customer prompts and
  context to vendor APIs. Incompatible with air-gapped deployments
  out of the box. HIPAA / FedRAMP customers need explicit BAAs /
  FedRAMP authorization with each provider before enabling.
- **Mode 1 local (Ollama / Docker Model Runner)** keeps data inside
  the customer's environment. The default for compliance-sensitive
  installs.
- **CLI agents (mode 4)** are the most subtle compliance pitfall:
  bundled with the platform image but their network calls bypass the
  `LLM_BASE_URL` contract and the platform's audit envelope. An
  air-gapped customer must either configure the CLIs to use a local
  OpenAI-compatible endpoint (Codex CLI now supports
  `OPENAI_BASE_URL`; Claude Code CLI similar config) or disable them
  in the sandbox image.

#### Cost / capacity model (universal)

| Mode | Cost model | Capacity model | Customer billing relationship |
|---|---|---|---|
| 1 — public API | per-token, metered | per-API-key rate limit | direct with provider |
| 1 — local LLM | capex / fixed compute | concurrent-capacity ceiling | none (customer's hardware) |
| 2 / 3 — provider OAuth | per-account (metered or subscription) | per-account rate limit | direct with provider |
| 4 — CLI agents | per-account, blended (subscription + per-token) | per-account rate limit | direct with provider |
| LiteLLM gateway | aggregates all of the above | configured per-route | customer-defined |

LiteLLM is the recommended fan-out point for customers running mixed
modes — one `LLM_BASE_URL` target that internally routes by class
(PII to local, general to public, premium to subscription).

#### Default mode per deployment (universal)

| Deployment | Default for inference (mode 1) | CLI agents (mode 4) |
|---|---|---|
| Win + Docker Desktop | Docker Model Runner | available (port 1455 local) |
| Mac + Docker Desktop | Docker Model Runner | available |
| Linux native Docker | Ollama (in compose) | available |
| Single VM substrate (cloud) | Ollama (in compose) | available if 1455 exposed |
| Managed container service substrate | external Ollama / LiteLLM | impractical (port lock-in) |
| Managed Kubernetes substrate | Ollama via Helm + GPU node pool, or external | requires explicit 1455 Ingress |
| TAPPaaS module | external (TAPPaaS AI Stack Ollama / LiteLLM) | needs Caddy 1455 rule |
| Marketplace image | inherits Single VM | inherits Single VM |

Substrate-specific deltas live in
`docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` (cloud
shapes) and the Mac/Linux installer-parity roadmap (local shapes);
this contract is the universal frame they wrap.

The runtime envvar contract above does **not** change across
deployment options. What changes per deployment is which modes are
*available* and which are *reachable*.

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

## Spec ownership map

Where does any given DPF concern live? This map prevents readers
from spelunking through five docs to find the canonical answer.

| Concern | Canonical spec |
|---|---|
| Release artifacts (multi-arch GHCR images) | This doctrine + `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md` (installer-parity roadmap) |
| Runtime configuration (env / config schema) | This doctrine |
| Local installation (Windows / macOS / Linux) | `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md` |
| Cloud deployment substrates | `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` |
| TAPPaaS packaging | `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` |
| Cloud marketplace / Helm chart / Terraform packaging | `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` |
| Edge Node (host trust, discovery, MCP/A2A gateway) | `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` |
| Build Studio providers (sandbox lifecycle abstraction) | `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md` |
| Identity edge (OIDC / SAML / LDAP / SCIM, authentik) | `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md` |
| Identity edge deployment modes (`identityEdgeMode`) | `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md` (2026-05-09 addendum) |
| LLM and agent-provider routing | This doctrine (Contract 9) |
| Observability invariants (Qdrant-silent-failure precedent, alerts) | `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md` |
| Secrets (logical schema; substrate-specific stores) | This doctrine (Contract 8) |
| Discovery sweep ingestion (Edge Node submissions) | `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` |

When a concern is in flight (under active design) it stays in
whichever spec spawned the discussion until landed; once landed, it
either stays in that spec or moves to this doctrine if it's
universally applicable. **Universal == doctrine. Substrate or
target-specific == owning spec.**

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

- **Versioning the doctrine.** When a new logical secret or
  lifecycle operation is added, every deployment spec needs to
  catch up. Is the answer a doctrine `version:` field with
  per-spec compatibility? Or just careful PR review?
- **Contract enforcement.** Should there be a CI check that
  flags deployment specs claiming behavior that contradicts the
  doctrine? Probably not in v1 — humans review specs.

## Maturity gates before implementation

This doctrine moves from research to binding when all of these are
complete. The same checklist applies to every spec that wraps this
doctrine; that's the point of having a uniform gate.

- [ ] Research & Benchmarking section complete (per AGENTS.md §10).
- [ ] Open questions resolved or explicitly deferred to a named
      follow-up spec / epic.
- [ ] Schema impact reviewed (Prisma, Neo4j, Postgres) — including
      backward-compat implications and migration story.
- [ ] Canonical contracts updated if the spec changes shared
      behavior (this doctrine; or another doctrine if one is
      added).
- [ ] Security review complete — credentials, secrets propagation,
      network exposure, sandbox / privileged-execution concerns,
      audit-trail integrity. Sign-off recorded.
- [ ] Release / rollback story defined — how it ships, how it backs
      out if a regression appears, what the operator sees.
- [ ] Test / verification gates defined — unit tests, integration
      tests, smoke install on a fresh host, contract tests for any
      cross-spec interfaces.

For specs that own privileged execution or host-local trust
(Edge Node, Build Execution Provider), the security review gate is
weighted heavier than the others — those specs touch sandbox
execution, network scanning, credentials, policy caching, and
host-local trust, and an architectural defect there has wider
blast radius than a substrate misconfiguration.

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
