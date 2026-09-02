---
status: draft
---

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

## The canonical deployment contracts

All DPF deployment targets must wrap these contracts. Wrappers may
provision infrastructure, secrets, ingress, and backups around each
contract; they must not fork or replace the contract itself.

(Originally seeded with 8 contracts; Contract 9 added 2026-05-09 to
unify LLM and agent-provider routing across deployments — that
material was previously scattered across the cloud and installer
specs. Contract 10 added 2026-05-09 to capture client/API surface
governance — browser admin, storefront, customer portal, mobile API,
MCP, Edge Node ingestion, OAuth and Codex callbacks all converge on
the same Authority Core but with distinct auth models and ingress
needs. Contract 12 added 2026-08-02 (BI-DIG-EB45310E) for
contributor installer-state vs `.env` vs process-environment
precedence so specs stop re-deriving that rule. The numbered list
may grow; the count is informational, not the contract.)

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
(Postgres exports — since BET-5 (BI-A1E864A5) retired Neo4j and
Qdrant onto PostgreSQL, the graph mirror and pgvector data ride in
the same Postgres backup) regardless of whether the substrate also
takes its own snapshot.

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

> **Superseded stance (2026-08-26, EP-24741BBF / `BI-5167932D`).** The enterprise-auth spec's choice to adopt authentik as a runtime identity edge has been **reversed**. DPF absorbs the directory over its own `Principal` spine and adds no IdP to any install. Consuming an external IdP as an *upstream* remains supported and optional. See [Directory Service — Identity Absorption Design](2026-08-23-directory-service-identity-absorption-design.md) and [the authentik evaluation](../../security/tool-evaluations/2026-08-23-authentik.md).

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

**Opt-in deployment.** Where the platform is installed, no Edge Node
runs unless the operator chooses it; the choice is identical across
host OSes and persisted in `install-state.json`. This is the *deploy*
gate, distinct from the *trust* gate (remote nodes still enroll
`pending` until approved).

**Minimal footprint.** An Edge Node carries no portal, database,
graph/vector store, or LLM — it is one process/binary, outbound-only
to the Authority URL, holding only a small local state file. The
remote artifact installs without a monorepo clone (a single native
binary, or a single compose file fetched by URL).

**Fleet topology.** One Authority Core supports a fleet of Edge Nodes
across many contexts; admin list, discovery evidence, adapter
credentials, status, and reaping are per-node and scope-qualified.
Archetypes specialize the fleet: retail one node per location, MSP one
per customer × site (strict estate separation).

**Network & observability boundary.** Remote nodes call home — outbound
HTTPS to the Authority URL only; the Authority never scrapes or dials
into a customer LAN. Edge metrics are an authenticated push
(`/api/v1/edge/metrics`); Prometheus/Grafana (Contract 7) visualize
accepted, scope-tagged Authority data with bounded label cardinality —
they are not the edge protocol and never a remote scrape target. Every
persisted edge-derived record carries authenticated scope; raw
site-identifying payloads are retained by class and kept out of metric
labels, dashboards, and long-lived logs (sovereignty per Contract 8 +
EP-ESTATE-SOVEREIGNTY).

Per `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` and the
deployment-topology + remote-provisioning design
`docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`.

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

This contract has two distinct sub-paths: **inference** (modes 1–3
below, governed by the runtime envvars and the OAuth callback flow)
and **CLI agents** (mode 4, separate execution + credential path
that **bypasses** `LLM_BASE_URL`). Both are part of the contract
because both can be present in any deployment, but they have
different governance and compliance implications.

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

#### CLI agent sub-contract (Codex, Claude Code)

Mode 4 — CLI agents bundled in the sandbox image
(`Dockerfile.sandbox:6,9` installs `@openai/codex` and
`@anthropic-ai/claude-code` globally) — is a **separate execution
and credential path from `LLM_BASE_URL`-routed inference**. The
dispatchers at `apps/web/lib/integrate/codex-dispatch.ts` and
`apps/web/lib/integrate/claude-dispatch.ts` inject provider
credentials into the sandbox and invoke the CLIs via `docker exec`.
Codex writes `~/.codex/auth.json` inside the sandbox and runs
`codex exec --dangerously-bypass-approvals-and-sandbox`. Claude Code
mounts OAuth/API-key auth and runs analogously.

These calls do **not** flow through the inference layer; they reach
provider APIs directly from the sandbox. Per-deployment policy must
therefore answer:

- **Enabled?** Whether Codex and/or Claude Code CLIs are enabled at
  all. Default on for consumer/SaaS-equivalent installs; default
  off for regulated / air-gapped installs that cannot tolerate
  uncontrolled egress to vendor APIs.
- **Endpoint redirection?** Whether the CLIs are configured to use
  a local OpenAI-compatible endpoint (Codex CLI honors
  `OPENAI_BASE_URL`; Claude Code CLI similar config). For
  air-gapped installs that still want the CLI ergonomics, this is
  the only safe path.
- **Credential lifecycle.** How `~/.codex/auth.json` and Claude
  Code's auth state are stored, mounted into the sandbox, rotated
  when refreshed, and audited. Today these are injected by
  dispatchers; the Build Execution Provider abstraction is the
  right home for this contract long-term (per
  `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`).
- **Audit.** Authority Core's `ToolExecution` table records the
  dispatch invocation but cannot record the LLM payload (the CLI
  call goes direct to provider). Operators of regulated installs
  must accept this gap or disable mode 4.
- **Build Provider compatibility.** On non-`local-docker`
  providers (k8s-job, ECS-task, etc.), CLI dispatch must go
  through the provider's `runAgentCommand` interface, not direct
  `docker exec`. See the Build Execution Provider spec.

Runtime envvars per deployment for CLI agents:

```
DPF_SANDBOX_ENABLE_CODEX=true|false
DPF_SANDBOX_ENABLE_CLAUDE=true|false
CLI_AGENT_CALLBACK_PORTS                 # comma-separated, e.g. "1455"
CODEX_OAUTH_CALLBACK_PORT=1455           # locked by upstream Codex client
DPF_SANDBOX_OPENAI_BASE_URL              # optional redirect for Codex
DPF_SANDBOX_ANTHROPIC_BASE_URL           # optional redirect for Claude Code
```

`docker-compose.yml:79` reserves port 1455 for Codex's OAuth
callback; this port lock-in is the single biggest CLI-agent
deployment constraint. Wrappers must either expose port 1455
reachably from the user's browser or document Codex CLI as
unsupported.

The sandbox image itself may need variants (`dpf-sandbox:full`,
`dpf-sandbox:no-cli-agents`, `dpf-sandbox:local-only`) for
deployments that mandate compile-time exclusion rather than runtime
disablement. The Build Execution Provider spec owns that decision
along with the rest of the sandbox lifecycle.

### 10. Client and API surfaces

The Authority Core has multiple distinct **client surfaces**,
each with its own auth model, public-vs-private exposure, and
ingress requirements. Wrappers must wire them all consistently.

| Surface | Path / port | Auth | Typical exposure | Notes |
|---|---|---|---|---|
| Workforce admin shell | `/storefront`, `/platform`, `/admin` | workforce session (Identity Edge OIDC) | private (VPN) or public-with-strict-IP | Identity Edge contract 4 |
| Storefront public | `/s/**` | public / customer | public (often custom domain) | tenant-branded; CORS rules differ from admin |
| Customer portal | `/portal/**` | customer session | public | CustomerContact-scoped |
| Mobile API | `/api/v1/**` | JWT today; OIDC + PKCE per Mobile spec evolution | public or private | mobile clients |
| Managed Station / Device Client | `/api/v1/**` | device `Principal` credential plus an optional, separately scoped human session | public HTTPS or private network | managed Android attended clients; EMM supplies policy/bootstrap configuration, never identity authority or durable secrets |
| External MCP transport | `/api/mcp/v1` | `dpfmcp_*` bearer | usually private (origin + TLS validated) | spec § 8 of AGENTS.md; ingress must pass `X-Forwarded-Proto` / `X-Forwarded-Host` |
| Edge Node ingestion | `/api/v1/edge/**` | `dpfedge_*` machine token | public HTTPS or private mesh | per Edge Node spec |
| OAuth callback | `/api/v1/auth/provider-oauth/callback` | OAuth state | publicly reachable | provider OAuth + Anthropic sub OAuth |
| Codex CLI callback | `:1455` | Codex shared client | optional; off in regulated installs | port locked by upstream |
| Apple universal links | `/.well-known/apple-app-site-association` | unauthenticated | publicly reachable | required for mobile app universal links per the Mobile spec; served by the Authority Core's domain |
| Android app links | `/.well-known/assetlinks.json` | unauthenticated | publicly reachable | required for Android App Links per the Mobile spec; served by the Authority Core's domain |

**Client identity convergence (binding direction).** Browser UI,
mobile app, managed Station/Device Client, Edge Node, and external MCP clients are all clients
of the Authority Core but use different auth surfaces (browser
session, mobile JWT/OIDC, device principal credential plus optional
human session, `dpfedge_*` machine token, `dpfmcp_*`
MCP token). Per the Enterprise Auth spec's principal-convergence
addendum: `User`, `CustomerContact`, `Agent`, `EdgeNode`,
`MobileDevice`, managed attended devices, and `ServiceAccount` all eventually resolve to a
single `Principal` / `PrincipalAlias` model. New surfaces must not
become parallel identity islands.

**Managed attended client boundary.** DPF Mobile and DPF Station share
the Device Client contracts, but Station is a distinct managed Android
package so dedicated-device policy, private distribution, kiosk behavior,
and native peripheral permissions do not leak into the personal Mobile
package. EMM/MDM is operator-selected and remains the device-policy
authority. DPF consumes non-secret managed configuration; enrollment
creates the durable device credential and converges it on
`Principal`/`PrincipalAlias`. Continuous polling, discovery, industrial
protocols, and background LAN services remain Edge Node concerns. The
target-specific architecture and proof contract live in
[`2026-08-15-attended-device-client-and-archetype-hardware-enablement-design.md`](2026-08-15-attended-device-client-and-archetype-hardware-enablement-design.md).

### 11. Agent-to-agent coordination constraints

Coworker-to-coworker delegation (`request_coworker` / `summon_coworker` /
`spawn_subagents`) is a **runtime operational contract**, not only a product
feature. Wrappers and capacity planning must assume the platform enforces
these hard bounds (BI-IMP-285B5B1C / IP-38698). Code SSOT:

| Constraint | Bound | Source |
|---|---|---|
| Recursive delegation | **Allowed**, authority-narrowing only | `apps/web/lib/tak/delegation-authority.ts` |
| Hard chain depth | **4** (refuse new link at `newDepth >= 4`) | `MAX_DELEGATION_DEPTH` in `delegation-authority.ts` |
| Policy depth (prefer inline) | **3** (mode switch before hard refuse) | `MAX_DELEGATION_DEPTH` in `delegation-policy.ts` |
| Fan-out width per spawn | **8** parallel sub-tasks | `MAX_FANOUT_WIDTH` in `subagent-fanout.ts` |
| Self-delegation | **Forbidden** | same authority module |
| Tool-script recursion | **Forbidden** (`tool_script_exec` never nested) | `apps/web/lib/tak/tool-script.ts` |

**Timeout / orphan behavior.** Child TaskRuns inherit platform TaskRun /
Inngest lease heartbeats; a blocked or orphaned delegation does **not**
extend parent wall-clock forever — the parent loop remains under agentic-loop
duration/iteration ceilings. Operators observe chain depth and fan-out via
delegation audit rows and TaskRun parent/child links (not a separate A2A
control plane per install).

**Monitoring expectations for ops wrappers.** Emit / retain:

1. Active delegation-chain depth histograms (alert if approach hard cap).
2. Fan-out refusals (`depth`, `self`, `authority`, width drop).
3. Orphaned child TaskRuns past lease TTL.

Wrappers must **not** raise these caps via env without a platform release —
the constants are product doctrine, not install knobs.

**Ingress requirements** (substrate-specific; cloud-deployment
spec carries the matrix):

- MCP and OAuth callbacks need stable hostnames; managed
  container services with elastic instances must pin the
  load-balancer host so refresh-token flows survive instance
  churn.
- The MCP route (`apps/web/app/api/mcp/v1/route.ts:120-142`)
  reads `MCP_ALLOWED_ORIGIN_HOSTS`, `x-forwarded-proto`, and
  `x-forwarded-host`. Wrappers must:
  - set `MCP_ALLOWED_ORIGIN_HOSTS` deliberately (implemented), and
    `MCP_INSECURE_INTERNAL_HOSTS` only for internal-network callers
    that cannot use TLS;
  - `MCP_PUBLIC_URL` and `TRUST_PROXY_HEADERS` are **planned, not
    implemented** — nothing reads them today, so setting them has no
    effect. The matrix row below has always said Planned; see
    `2026-05-09-cloud-deployment-design.md` for which half ships.
    Until `TRUST_PROXY_HEADERS` exists, `X-Forwarded-Proto` is
    honoured unconditionally, so a trusted proxy that strips
    client-supplied `X-Forwarded-*` is the only thing preventing a
    caller from asserting `https` for itself (`BI-1AE9D368`);
  - configure Caddy (TAPPaaS) / ALB (AWS) / Application Gateway
    (Azure) / Cloud Run frontend / k8s Ingress to forward
    `X-Forwarded-Proto` and `X-Forwarded-Host` correctly.

Surface-specific deltas live in the cloud-deployment spec
(`docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`)
and the per-surface specs (`Mobile`, `Storefront`, `External
MCP Surface`); this contract is the universal frame they wrap.

#### Required well-known routes

The mobile spec calls for universal links and Android App Links;
the server-side requirements live here so wrappers know to serve
them on the correct domain (the Authority Core's, not the
storefront's customer-branded domain — these vouch for *which app*
is allowed to handle which URLs).

| Path | Content type | Caching | Tested by |
|---|---|---|---|
| `/.well-known/apple-app-site-association` | `application/json` (Apple does not require `.json` extension) | reachable without auth, no redirects, served at the apex of `mobileUniversalLinkDomain` | universal-link integration test in the mobile spec |
| `/.well-known/assetlinks.json` | `application/json` | same — unauthenticated, no redirects | Android App Links integration test |

Wrappers must verify these routes survive proxy / CDN paths
because Apple and Google fetch them from outside the customer's
network. Edge caching is fine; redirects break verification.

#### Required server-side tests for Contract 10

Each of these is a route-level integration test the Authority
Core's CI must pass before any Contract 10 surface is marked
GA on a given substrate:

- `/.well-known/apple-app-site-association` returns 200,
  unauthenticated, JSON content type, no redirects.
- `/.well-known/assetlinks.json` returns 200, unauthenticated,
  JSON, no redirects.
- OAuth callback URL generation correctly honors trusted proxy
  headers (returns `https://${PUBLIC_HOST}/...` rather than internal
  scheme/host). Stated without `TRUST_PROXY_HEADERS`, which is planned
  rather than implemented; verify the resulting URL, not the flag.
- CORS pre-flight responses per surface match the policy:
  - `/api/storefront/**` allows the configured tenant origins
    (anonymous), no credentials by default.
  - `/api/portal/**` allows the customer portal domain with
    credentials.
  - `/api/v1/**` allows mobile (`null` origin) with Bearer auth,
    workforce admin domain with credentials.
  - `/api/mcp/v1` honors `MCP_ALLOWED_ORIGIN_HOSTS` strictly.
  - `/api/v1/edge/**` rejects browser preflight (not browser-callable).
- MCP origin validation honors `MCP_ALLOWED_ORIGIN_HOSTS` and
  `x-forwarded-proto` / `x-forwarded-host` correctly.
- Surface-cross-contamination: a `dpfmcp_*` token must not
  authenticate against `/api/v1/edge/**` (different
  surface-namespace), and vice versa.
- Managed-client cross-contamination: a Station device credential must
  not authenticate as a browser user, Edge Node, or MCP client; a human
  session alone must not impersonate a managed device.
- An attended command made under a human session on a managed Station
  preserves both the human principal and device principal in its audit
  context; ending the human session does not silently revoke the device,
  and revoking the device blocks later commands independently.

These tests are part of the Authority Core's per-PR CI; they don't
gate substrate-specific deployment templates, but they gate the
runtime that all wrappers serve.

### 12. Contributor installer state and configuration precedence

Contributor and workstation installs keep **host-local facts** that
are not the same thing as the **runtime env schema** in Contract 2.
Specs and scripts that touch installers, worktrees, or bootstrap
helpers must declare ownership using this layering. Do not invent a
parallel rule per substrate.

#### Three layers (highest wins only where stated)

| Layer | Typical home | Role | Who may write |
| --- | --- | --- | --- |
| **1. Installer state (canonical)** | `%USERPROFILE%\.dpf\install-state.json` / `~/.dpf/install-state.json` (and peer files under `.dpf/`) | Durable machine/user install record: install path, mode, capability stamps, workspace topology, lifecycle metadata | Installer and governed bootstrap scripts only |
| **2. Derived projection** | Repo-local `.env`, generated compose env, mirrored shell exports | Compatibility surface for Compose and tools that only read env files | Writers that **project from** layer 1 (or explicit first-run generation); never a second source of truth for the same fact |
| **3. Process environment (ephemeral override)** | `process.env` / session shell | One-shot override for a single command or CI job | Operator or CI; must not be silently persisted back as if it were layer 1 |

**Read precedence** when the same conceptual setting appears in more
than one layer:

1. Process environment (layer 3), if set for that invocation  
2. Else installer state (layer 1), when the setting is an install/host fact  
3. Else derived `.env` / compose projection (layer 2)  
4. Else documented default

**Write ownership:** a setting has exactly one canonical store. If
`.env` mirrors it, the mirror is a projection: drift is resolved by
re-projecting from the canonical store (or by an explicit operator
migration), not by treating `.env` as authoritative on the next run.

#### Contributor topology (two-tree model)

- **Install / production tree** — may be self-upgrade managed; treat
  as the runtime identity of the live portal.
- **Writable dev workspaces / worktrees** — relocatable outside that
  tree (sibling worktree base on Windows; equivalent elsewhere).  
  Worktree helpers reuse existing readiness, Compose isolation, and
  bootstrap contracts; they do not invent parallel env semantics.

Path comparison across Windows / macOS / Linux must normalize
(absolute form, consistent separators, case rules per platform) before
equality checks. Nullable install-state fields keep explicit null
semantics — do not collapse "unknown" and "unset" without a schema.

#### Installer state vs database-owned state

- **Installer / host config** → install-state (this contract).  
- **Tenant / org / product facts** → PostgreSQL and platform identity
  models (`Organization`, etc.).  
Never store org branding, backlog, or runtime business records in
`install-state.json`.

#### What specs and scripts must declare

When a design or script persists the same conceptual setting in more
than one artifact, it must name:

1. Canonical store  
2. Any derived projections  
3. Read precedence (or "inherits Contract 12")  
4. Which component may mutate each artifact  
5. Drift reconciliation behavior  

Cross-platform pairs (`.ps1` / `.sh`) share one contract; substrate
deltas are path and shell syntax only.

Backlog origin: BI-DIG-EB45310E (canonical digest of repeated
reference-doc findings on installer-state vs `.env` precedence).

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

## Deployment support matrix

What works on which deployment, at what status. Every cell is one
of: **GA** (production-ready), **Preview** (works but not yet
release-gated), **Planned** (designed, implementation pending),
**Unsupported** (out of scope; documented in Source plan), **Degraded**
(works with reduced fidelity, see notes), or **Blocked** (waiting on
external dependency).

This table is the at-a-glance answer to "what breaks where" so
buried prose elsewhere doesn't become accidental truth. Inspired by
GitLab Runner's executor compatibility matrix.

Capability rows borrow from the spec ownership map directly below
this section.

| Capability | Win + DD | Mac + DD (AS) | Linux native Docker | Single cloud VM | Container service | Managed K8s | TAPPaaS module | Marketplace image |
|---|---|---|---|---|---|---|---|---|
| **Release & install** | | | | | | | | |
| Release images (GHCR multi-arch) | GA (amd64) | Planned | Planned | Planned | Planned | Planned | Planned | Planned |
| Installer (`install-dpf.{ps1,sh}`) | GA | Planned | Planned | Planned (via cloud-init) | Planned (via Helm/Terraform) | Planned (via Helm) | Planned (via TAPPaaS module) | Planned |
| Auto-start on boot | GA (Scheduled Task) | Planned (LaunchAgent) | Planned (systemd user) | Planned | Substrate-managed | Substrate-managed | TAPPaaS-managed | Inherits Single VM |
| **LLM provider** | | | | | | | | |
| Default mode | Docker Model Runner | Docker Model Runner | Ollama (in compose) | Ollama (in compose) | External Ollama / LiteLLM | Ollama via Helm + GPU pool | TAPPaaS AI Stack (LiteLLM/Ollama) | Inherits Single VM |
| Codex CLI (port 1455) | GA | Planned | Planned (1455 firewall) | Planned (firewall) | Unsupported (port lock-in) | Planned (Ingress, default off) | Planned (Caddy directive) | Inherits Single VM |
| Claude Code CLI | GA | Planned | Planned | Planned | Planned | Planned | Planned | Inherits Single VM |
| **Build Studio** | | | | | | | | |
| Build Studio via `local-docker` provider | GA | Planned | Planned | Planned | Unsupported | Unsupported | Planned (in VM) | Inherits Single VM |
| Build Studio via cloud-native job providers (`kubernetes-job`, `ecs-task`, `cloud-run-job`, `azure-containerapp-job`) | n/a | n/a | n/a | n/a | Planned (gates Build Studio readiness) | Planned (gates Build Studio readiness) | n/a | n/a |
| **Surfaces & ingress (Contract 10)** | | | | | | | | |
| MCP transport hardening (`MCP_PUBLIC_URL`, `MCP_ALLOWED_ORIGIN_HOSTS`, `TRUST_PROXY_HEADERS`) | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Planned |
| OAuth provider callbacks | GA | Planned | Planned | Planned (sticky host) | Planned (sticky LB host) | Planned (Ingress) | Planned (Caddy proxyDomain) | Inherits Single VM |
| Mobile API + universal links (`/.well-known/...`) | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Planned |
| Managed Station / Device Client API | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Planned |
| Storefront custom domains (multi-domain TLS) | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Inherits Single VM |
| **Edge Node (Contract 5)** | | | | | | | | |
| Edge Node binary (Mode B) | Planned | Planned | n/a (Mode A container preferred) | n/a | n/a | n/a | n/a | n/a |
| Edge Node container w/ `network_mode: host` (Mode A) | n/a | n/a | Planned | Planned | Unsupported (substrate restriction) | Planned (privileged node pool) | Planned (in VM) | Inherits Single VM |
| Network sweep — full host topology fidelity | Planned (via `windows_exporter`; Edge Node post-Epic B) | Degraded (Docker Desktop VM hides Mac NICs; Mode B native binary closes gap) | Planned (via node-exporter) | Planned (via node-exporter) | Degraded (no host topology truth in container service substrate) | Degraded | Planned | Inherits Single VM |
| Host metrics (cadvisor + node-exporter) | Degraded (WSL2 VM hides physical NICs; `windows_exporter` substitutes today) | Degraded (Docker Desktop VM) | Planned (`linux-monitoring` profile) | Planned | Substrate-native (CloudWatch / Stackdriver / Azure Monitor) | Substrate-native | Substrate-native | Inherits Single VM |
| **Identity (Contract 4)** | | | | | | | | |
| `identityEdgeMode=dpf-managed` (bundled authentik) | Planned | Planned | Planned | Planned | Planned (Helm dep) | Planned (Helm dep) | Planned (alongside TAPPaaS Authentik) | Inherits Single VM |
| `identityEdgeMode=customer-provided` | Planned | Planned | Planned | Planned | Planned | Planned | Planned | Planned |
| `identityEdgeMode=tappaas-upstream` | n/a | n/a | n/a | n/a | n/a | n/a | Blocked (TAPPaaS identity automation maturity) | n/a |
| **Lifecycle (Contract 3)** | | | | | | | | |
| Backup / restore (logical Postgres exports; graph + vector data live in Postgres since BET-5) | Planned | Planned | Planned | Planned | Substrate-managed (PITR + snapshots) | Substrate-managed | Inherits Single VM + TAPPaaS VM snapshots | Inherits Single VM |
| Update / rollback | GA (`dpf-reinstall.ps1`) | Planned | Planned | Planned (Terraform re-apply) | Planned (Helm/Terraform) | Planned (Helm) | TAPPaaS-managed (snapshot + post-update tests + rollback on fatal) | Marketplace listing version |

### Reading the matrix

- A **Planned** cell does not commit to a delivery date; it asserts
  the architecture supports the capability and the implementing epic
  is named in the Source plan. Status moves to **Preview** when the
  capability ships behind a feature flag, and **GA** when it passes
  the spec's maturity gates and is the documented default.
- **Degraded** cells must always carry a note in their owning spec
  explaining what fidelity is reduced and what remediation closes
  the gap. Cell content names the remediation when known.
- **Blocked** cells must name the external dependency (TAPPaaS
  identity automation in this case). When the dependency clears,
  the cell graduates to Planned and an implementing epic is named.
- This matrix is the **single canonical answer** to "does X work on
  Y?" Owning specs link here rather than restating; updates land
  via a doctrine PR, not a substrate-spec PR.

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
| CLI agent dispatch (Codex, Claude Code) | This doctrine (Contract 9 sub-contract) + `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md` |
| Client / API surface governance | This doctrine (Contract 10) |
| MCP transport hardening (origin, forwarded headers) | This doctrine (Contract 10) + `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` |
| Mobile client packaging | `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md` (treated as a Contract-10 client packaging target) |
| Managed Station / attended Device Client packaging and hardware proof | `docs/superpowers/specs/2026-08-15-attended-device-client-and-archetype-hardware-enablement-design.md` |
| Storefront / customer portal surfaces | `docs/superpowers/specs/2026-03-19-storefront-foundation-design.md` |
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


## Patterns for extending deployment contracts

Future specs that add install-time or runtime **configuration metadata** should
reuse these canonical field patterns (BI-IMP-336969A9) rather than inventing
new key shapes per surface.

### Required identity fields (every config document)

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | string (semver) | Document shape version, not product version |
| `contractId` | string | Stable id, e.g. `deploy.lifecycle` |
| `ownerSpec` | string path | Spec that owns validation |

### Optional operator-facing metadata

| Field | Type | Notes |
|---|---|---|
| `displayName` | string | Human label |
| `description` | string | One paragraph |
| `required` | boolean | Fail install if missing |
| `default` | JSON | Only when safe and documented |
| `secret` | boolean | Must not log / must use secrets store (contract 8) |
| `envVar` | string | Maps to runtime env name from contract 2 |

### Minimal JSON template

```json
{
  "schemaVersion": "1.0.0",
  "contractId": "deploy.example",
  "ownerSpec": "docs/superpowers/specs/2026-05-09-deployment-contracts.md",
  "displayName": "Example setting",
  "required": false,
  "secret": false,
  "envVar": "DPF_EXAMPLE"
}
```

Validation: reject unknown keys at write time; refuse to start when `required`
is true and the value is empty; never put secrets in compose `environment:`
plaintext when `secret: true`.

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
- [ ] Schema impact reviewed (Prisma / Postgres, including the
      in-Postgres graph mirror and pgvector) — including
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
