# DPF Edge Node and Discovery Plane Architecture (DRAFT / RESEARCH)

> Status: **research stub** — not yet a finalized spec. Per AGENTS.md §10
> this needs full "Research & Benchmarking" before finalization.
>
> Source plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> (the "Discovery plane refactor" subsection under Future direction).
> The installer-parity roadmap deliberately leaves this epic
> unsequenced; the work lands after macOS / Linux installer-parity
> ships.
>
> Related authority: `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
> establishes the principle this spec inherits: **DPF owns identity
> meaning and authority; the identity edge owns protocol presentation.**

## Architectural thesis

DPF should support Docker Desktop as a **local application runtime**,
not as a complete local infrastructure substrate. Any feature that
needs:

- physical host visibility (real NICs, real ARP table, real LAN
  topology),
- private-network reachability (joining a customer LAN, brokering
  MCP/A2A across air gaps),
- long-lived host-local trust participation (device identity,
  attestation, policy enforcement at the edge),
- managed-fleet onboarding (treating any host — including DPF's own —
  as a managed node)

belongs in a **DPF Edge Node** running outside the Docker Desktop VM
boundary, not inside the container fleet.

The first Edge Node capability is network discovery (this is what
motivates the spec's existence right now). Later capabilities include
MCP gatewaying, A2A gatewaying, host metrics collection, and
identity / device attestation. The architecture must support those
extensions without redesign.

## Why a single narrow "discovery agent" was the wrong shape

The first draft of this spec framed the work as "how do we discover
host networking despite Docker Desktop?" That question is too small.
Discovery is one capability that needs to run outside the container;
identity brokering, MCP gatewaying, A2A gatewaying, policy
enforcement, and managed-fleet onboarding are all in the same
architectural class. Designing a one-off discovery helper would lock
in a snowflake that has to be replaced when those other capabilities
arrive.

Reframed: the question is **"what capabilities must run outside the
DPF container runtime when DPF needs host, LAN, identity, or
external-agent trust boundaries?"** The Edge Node is the answer.

## The four architectural layers

### 1. DPF Authority Core (canonical owner of meaning)

DPF retains exclusive ownership of:

- principals (users, agents, service accounts)
- roles, groups, manager scope
- route authorization
- coworker/tool grants (`agent_registry.json`,
  `apps/web/lib/agent-grants.ts`)
- managed-host registry
- agent identities and capability claims
- policy decisions
- inventory truth (`InventoryEntity`, `InventoryRelationship`)
- audit records (`ToolExecution`)

This aligns with the enterprise auth spec's stated principle: "DPF
owns identity meaning and authority; the identity edge owns protocol
presentation."

### 2. Identity Edge (protocol presentation)

Standards-heavy protocol surfaces — OIDC, SAML, LDAP, SCIM — are
served by an incorporated open-source identity edge. The enterprise
auth spec selects **authentik** as the chosen runtime; do not
duplicate that responsibility in the Edge Node.

The Edge Node never serves user-facing OIDC/SAML/LDAP/SCIM. It may
hold a *device* identity that authenticates *to* the Authority Core,
but it is never an IdP for humans.

### 3. DPF Edge Node (this spec)

Host-resident component. Modular capabilities. Lightweight. Trusted
under the Authority Core's policy. Runs in different shapes depending
on the host environment (see "Deployment modes").

### 4. Protocol Gateways (MCP / A2A)

DPF already has a governed external MCP transport at `/api/mcp/v1`
(`apps/web/app/api/mcp/v1/route.ts`) using `dpfmcp_*` bearer tokens
that are hashed at rest, scope-bound, capability-gated, and optionally
narrowed to a specific Agent identity (`McpApiToken` model,
`packages/db/prisma/schema.prisma:2974`).

Edge Nodes can act as **local protocol gateways** that bridge
private-network MCP servers and A2A peers into the Authority Core's
governed surface. They **do not** make authorization decisions
independently. They cache policy for resilience, but every call
resolves through Authority Core's principal, policy, token, and audit
model.

A2A specifically: keep the protocol surface behind the same trust
model as MCP until the public A2A protocol contract is locked. No
separate authorization stack.

## Edge Node capability envelope

The first implementation slice is `capability.discovery.network`. The
architecture must accept these without redesign:

```
capability.discovery.network        # nmap, arp, lldp, host NIC enumeration
capability.discovery.software       # installed-package inventory
capability.metrics.host             # CPU/mem/disk/network time-series
capability.identity.broker          # short-lived credential exchange
capability.mcp.gateway              # bridge private-network MCP servers
capability.a2a.gateway              # bridge private-network agent peers
capability.policy.enforcement       # cached policy decision points
capability.tunnel.private-link      # reverse connection / private mesh
```

Each agent advertises which capabilities it supports. The Authority
Core decides which to enable per node, governed by the same role and
manager-scope model that gates everything else.

## Deployment modes

Modes are about *where* the Edge Node runs, not *what* it does. Every
mode must be able to host any subset of the capability envelope above
that's compatible with its environment.

| Platform | Runtime | Notes |
|---|---|---|
| Linux native Docker | Container with `network_mode: host` (or `macvlan`) | Default for Linux server installs. Decision between `network_mode: host` (observer) and `macvlan` (LAN peer) is an open question — see below. |
| macOS | Native LaunchAgent | Statically-linked binary (~5 MB, Go or Rust). Same auto-start mechanism as the platform itself. |
| Windows | Native service | Same binary, Windows service registration. |
| Docker Desktop fallback | Degraded in-VM container | Sees only the Docker Desktop VM's network; capability set restricted. Acceptable for dev installs that don't need host-LAN visibility. |
| Remote managed host | Native service or container per host class | Same code, same API contract, same auth scope. |

**Hard constraint preserved from the prior draft (refined):** Docker
Desktop runs Docker Engine inside a lightweight Linux VM and proxies
container traffic through the Desktop backend process. Docker Desktop's
host-networking mode (where supported) is **Layer 4 TCP/UDP only** —
it can help with port reachability, but it does not provide physical
NIC enumeration, Layer 2 frames, ARP tables, LLDP/CDP exchange, or
true host-interface visibility. **Any capability that depends on
real host/LAN topology truth — discovery sweep, L2 peer mapping,
LLDP receive — must run as a native Edge Node binary on macOS /
Windows or on a Linux host-network / `macvlan` path.** Port
reachability is one beast; network truth is another, even though they
share an aquarium. The native deployment mode is the escape hatch for
the latter, not a temporary workaround.

## Deployment target neutrality

The Edge Node binary has **no deployment-target awareness**. It
registers with an Authority Core URL (passed at install or via
config) and receives its policy and capability configuration from
the Authority Core after registration.

The same binary supports every Authority Core deployment shape
described in
`docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` and
`docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`:

- Windows local installs
- macOS local installs
- Linux local installs (bare-metal or VM)
- Single VM substrate (cloud)
- Managed container service substrate
- Managed Kubernetes substrate
- TAPPaaS module deployments
- Cloud marketplace image deployments
- Remote managed hosts onboarded as nodes #2..N in a customer fleet

TAPPaaS may reduce the *need* for some local-network discovery
capability because it already controls parts of the private platform
network (VLAN zones, OPNsense, Caddy). It does **not** replace the
Edge Node contract. The Edge Node still owns host-local trust,
private-network MCP / A2A gateway capabilities, capability
attestation, and the policy-cache + audit envelope. Anything in the
Edge Node capability envelope that TAPPaaS happens to overlap on
gets disabled per-node by the Authority Core's capability policy,
not by forking the binary or the contract.

This neutrality is a binding contract: any future deployment target
must work with the same Edge Node binary, registration flow, token
namespace (`dpfedge_*`), and ingestion endpoint. Wrappers that
require deployment-specific Edge Node behavior should add capability
flags or policy entries in the Authority Core, not branches in the
Edge Node binary.

## Edge Node vs Mobile Device — distinct concepts

Before the identity boundary section, an important disambiguation:
**Edge Node and Mobile Device are not the same thing.** They both
register with the Authority Core, both can be Principals or
Principal-linked, but their trust semantics, capability envelopes,
and lifecycle are distinct:

| | EdgeNode | MobileDevice |
|---|---|---|
| Role | managed host / network participant — discovers and reports about its environment | user client endpoint — receives notifications, runs the mobile app, holds offline cache |
| Trust posture | machine principal under Authority Core policy; runs unattended; long-lived credentials with rotation | user-bound principal (one or more user sessions per device); attended; credentials tied to user auth |
| Capability envelope | discovery, host metrics, identity broker, MCP/A2A gateway, policy enforcement, tunnel — i.e. *infrastructure* roles | notifications, offline queueing, deep-link routing, biometric local-auth, geofence-aware actions — i.e. *user-experience* roles |
| Token namespace | `dpfedge_*` (machine, machine-bound, short-lived, rotated via heartbeat) | mobile JWT today; OIDC + PKCE refresh tokens per the Mobile spec evolution (see Doctrine Contract 10) |
| Owns physical-host visibility? | yes (the entire reason the Edge Node exists) | no |
| Stored in `EdgeNode` table? | yes | no — has its own `MobileDevice` table per the Mobile spec |
| Per-Principal model? | one EdgeNode → one machine principal | many MobileDevices → one user principal (multi-device) |

Both surfaces converge on the Principal model per the Enterprise
Auth spec's principal-convergence addendum, but **they should not
share registry tables, token namespaces, or capability semantics**.
An Edge Node onboarded for a host's discovery sweep is not a phone
running the mobile app, and the inverse. Wrappers and packaging
targets must keep them separate to avoid trust-model conflation.

Future cross-pollination is fine in narrow places — for instance, a
mobile device might *receive* alerts from observations an Edge Node
submitted — but those interactions go through the Authority Core's
audit and policy envelope, not through any direct Edge-Node-to-
Mobile-Device coupling.

## Identity boundary

The Edge Node holds:

- its own *device* / *agent* identity
- short-lived credentials (rotated by the Authority Core)
- capability claims it is permitted to advertise
- attestation material (signed measurement of the binary, host
  fingerprint)
- local config

The Edge Node does **not** hold:

- users or groups
- platform roles
- coworker grants
- route permissions
- downstream application assignments
- any user-facing IdP surface (that's the Identity Edge's job)

Cross-node trust is mediated by the Authority Core. Edge Nodes do not
talk to each other directly without going through DPF.

## Token model

Existing `dpfmcp_*` tokens are designed for *external MCP clients* and
governed *user-issued* scopes. They are too broad and too
human-oriented for an Edge Node's machine-to-machine flow.

Introduce a separate token namespace:

```
dpfedge_<token>      # or dpfagent_<token>
```

With narrow scope grants:

```
edge:register
edge:heartbeat
edge:rotate
discovery:submit
metrics:submit
mcp:gateway
a2a:gateway
policy:fetch
```

Tokens are machine-bound (issued by the Authority Core to a specific
`EdgeNode.nodeId`), short-lived, and rotate via a heartbeat / refresh
flow. They are *not* user-issued through Admin > Platform Development
the way MCP tokens are. The MCP token model
(`packages/db/prisma/schema.prisma:2974` — `tokenHash` unique, scopes
array, capability gate, optional agent narrowing) is the right
template; the data model differs only in ownership (machine, not user)
and rotation cadence.

## Edge Node registry (proposed Prisma models)

```prisma
model EdgeNode {
  id           String    @id @default(cuid())
  nodeId       String    @unique
  displayName  String
  platform     String    // darwin | win32 | linux
  installMode  String    // native | container-host | container-vm
  version      String
  status       String    // pending | active | offline | quarantined
  trustState   String    // pending | trusted | quarantined | revoked
  lastSeenAt   DateTime?
  capabilities Json
  metadata     Json?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  capabilityRows EdgeNodeCapability[]
  observations   DiscoveryRun[]      @relation("EdgeNodeObservations")
}

model EdgeNodeCapability {
  id          String   @id @default(cuid())
  edgeNodeId  String   // FK to EdgeNode.id (the cuid surrogate);
                       // distinct from EdgeNode.nodeId (the stable
                       // external identifier used in API URLs and
                       // tokens). Don't conflate the two.
  capability  String
  mode        String   // enabled | reporting-only | disabled
  status      String   // healthy | degraded | failing
  evidence    Json?
  reportedAt  DateTime @default(now())

  node        EdgeNode @relation(fields: [edgeNodeId], references: [id], onDelete: Cascade)

  @@unique([edgeNodeId, capability])
}
```

`DiscoveryRun` (already present, see
`packages/db/src/discovery-collectors/`) gains an optional
`edgeNodeId` so observations can be attributed back to a specific
agent.

## Ingestion contract: submit observations, don't trigger sweeps

The current `/api/v1/discovery/sweep` route
(`apps/web/app/api/v1/discovery/sweep/route.ts`) is a session-gated,
human-triggered manual sweep that requires the
`manage_provider_connections` permission. It runs the sweep
*server-side*, in the portal container — which is exactly the
container-bound pathway the Edge Node is meant to escape.

Edge Nodes need a different shape. They run scans on their own host
and POST results in. Proposed:

```
POST /api/v1/edge/discovery-runs
Authorization: Bearer dpfedge_<token>

{
  "nodeId": "edge_a1b2c3",
  "agentMode": "native-darwin",
  "agentVersion": "0.1.0",
  "observedAt": "2026-05-09T12:00:00Z",
  "capabilities": ["discovery.network"],
  "items": [...],
  "relationships": [...],
  "warnings": [...]
}
```

Or expose it as an MCP tool (`submit_discovery_observations`) that
goes through the same `/api/mcp/v1` machinery so all governance,
audit, and rate-limiting applies uniformly.

**Server-side ingestion pipeline (corrected):** Edge Node
submissions must **not** rerun local collectors. Today's
`executeBootstrapDiscovery` is portal-context code that invokes
host/docker/network/etc. collectors *inside the portal container* —
exactly the path the Edge Node exists to escape. For submitted
observations, the server skips collector execution and goes
straight to normalization + persistence:

```
Edge Node submission
  → validate envelope (auth, schema, freshness, edgeNodeId trust)
  → normalizeDiscoveredFacts(submittedItems, submittedRelationships)
  → inferCrossCollectorRelationships
  → persistSubmittedDiscoveryRun({
       edgeNodeId,
       agentMode,
       agentVersion,
       submittedOutput,
       trigger: "edge_node",
     })
  → Postgres (DiscoveryRun + DiscoveredItem + DiscoveredRelationship
              → InventoryEntity + InventoryRelationship)
  → Neo4j projection (InfraCI + relationship types)
```

`persistSubmittedDiscoveryRun` is a sibling of
`persistBootstrapDiscoveryRun` that takes a *prepared* observation
set instead of running collectors. The downstream
deduplication / promotion / Neo4j-projection logic is shared between
them; only the source of the observation set differs. This is the
function this epic introduces alongside the
`/api/v1/edge/discovery-runs` route.

## Authentication-provider implications

DPF can become an authentication provider for downstream products,
but **the Edge Node never becomes the IdP**. The split:

| Responsibility | Owner |
|---|---|
| Canonical principals and authority | DPF Authority Core |
| OIDC / SAML / LDAP / SCIM protocol serving | Identity Edge (authentik) |
| Local device/host trust and private-network participation | Edge Node |
| MCP / A2A policy decisions and audit | Authority Core (Edge Node is a gateway) |
| Downstream app federation | Identity Edge, governed by Authority Core |

This matches and extends the enterprise auth design's authority/edge
split. The Edge Node is a third surface (alongside the application
core and the identity edge), specifically for host-resident trust and
connectivity.

## Execution model when an Edge Node hosts a protocol gateway

```
External agent or local tool
        ↓
DPF Edge Node                         (auth: dpfedge_*; cached policy for resilience)
        ↓ policy check / token exchange / audit envelope
DPF Authority Core                    (final policy decision; audit write)
        ↓
MCP or A2A action
```

The Edge Node never short-circuits Authority Core for any access
decision. If the Authority Core is unreachable, the Edge Node's
default is **deny** for any new principal/scope it doesn't have a
positive cached decision for, with explicit operator-configurable
soft-fail windows for known-good repeat scopes.

## Open questions (for fleshing out)

These are the decisions that need to land before this stub becomes
a finalized spec:

### Edge Node lifecycle
- **Linux default networking:** `network_mode: host` (observer-only,
  simpler) vs `macvlan` (each agent is a LAN peer, supports LLDP/CDP
  receive and segregated scanning roles)? Decide based on whether
  agents need to be reachable as LAN peers or only emit scans.
- **Binary distribution:** ship the native binary inside the
  GHCR-published portal image and have the installer extract it on
  first run, or publish separately as signed multi-platform GitHub
  Release assets?
- **Update path:** how does the binary self-update? Pull-on-schedule
  vs platform-push vs signal-and-download-via-installer.
- **Capabilities required:** which Linux capabilities does the
  container Edge Node need (`CAP_NET_RAW`, `CAP_NET_ADMIN` for raw
  sockets used by nmap / arp-scan)? Document the principle of least
  privilege.
- **macOS entitlements:** does the binary need any special
  entitlements (e.g. for `vmnet.framework` or
  `com.apple.developer.networking.*`)? If signed and notarized,
  what's the distribution flow?
- **Windows service vs scheduled task:** Edge Node as a Windows
  service (always running) or scheduled task (triggered on
  schedule)? Auth-model implications for each.

### Authority and trust
- **Token scope catalog:** finalize the `dpfedge_*` scope vocabulary
  (the list above is a starting point, not the contract).
- **Enrollment ceremony:** how does an Edge Node prove identity for
  the first time? Bootstrap token from the installer, attested by
  what? Operator approval flow in Admin > Platform Development?
- **Quarantine / revocation:** what triggers a node moving to
  `trustState: quarantined` automatically vs manually? Policy on
  observation ingestion from quarantined nodes (drop / archive /
  alert).
- **Soft-fail policy windows:** how long can an Edge Node act on
  cached policy when the Authority Core is unreachable? Per-scope
  configurable.

### Capabilities and protocol gatewaying
- **MCP gateway:** what's the contract for an Edge Node to expose a
  private-network MCP server's tools through the Authority Core?
  How are tool grants composed (inner server's grants × Edge Node's
  scope × user's grants)?
- **A2A gateway:** keep behind the same `dpfedge_*` model and the
  Authority Core's policy until the public A2A protocol contract
  stabilizes.
- **Telemetry parity:** what subset of `windows_exporter` /
  `node_exporter` metrics, if any, must keep flowing for Grafana
  host-resource panels independent of the sweep? Decide before
  retiring those exporters.

### Schema and ingestion
- **Schema additions:** confirm the `EdgeNode` and
  `EdgeNodeCapability` Prisma models above; add `edgeNodeId` to
  `DiscoveryRun`; verify the `confidence` field on `DiscoveredItem`
  is enum-able to express agent-mode-driven degradation.
- **Endpoint vs MCP tool:** decide whether the ingestion path is
  the new `/api/v1/edge/*` REST surface, an MCP tool
  (`submit_discovery_observations`), or both. MCP tool is more
  uniform; REST is simpler for non-MCP-aware deployments.

## Research and Benchmarking (TBD per AGENTS.md §10)

Before finalization, compare:

**Open source — discovery and inventory:** Netbox-Agent, Nautobot,
Steampipe.

**Open source — fleet agents:** osquery, Falco, Wazuh, Tailscale
client architecture, Cloudflare Tunnel.

**Open source — identity edge (already chosen):** authentik (per
enterprise auth spec).

**Commercial — fleet observability and discovery:** Auvik,
Lansweeper, ScienceLogic SL1, Datadog Network Performance Monitoring.

**Commercial — zero-trust edge:** Tailscale, Cloudflare Zero Trust,
Twingate.

For each: read the data model and trust model, not the marketing.
Document patterns adopted, patterns rejected, anti-patterns
identified, gaps the design fills.

## Sequencing

This epic sits **after** the macOS / Linux installer-parity roadmap
ships its Phase 7 (full installer). Until then, the discovery sweep
keeps its current data path: `windows_exporter` on Windows,
`node-exporter` (`linux-monitoring` profile) on Linux,
container-local fallback on macOS.

The installer-parity roadmap does **not** retire `windows_exporter`
or the `windows-host` Prometheus scrape — those retire when this
epic ships the Edge Node's `capability.discovery.network` slice.

## Maturity gates before implementation

This spec moves from research to binding when all of these are
complete. **Security review is weighted heavier than other specs
because the Edge Node touches sandbox execution, network scanning,
credentials, policy caching, and host-local trust — an
architectural defect here has wider blast radius than a deployment-
target misconfiguration.**

- [ ] Research & Benchmarking section complete (per AGENTS.md §10).
- [ ] Open questions resolved or explicitly deferred.
- [ ] Schema impact reviewed — `EdgeNode`, `EdgeNodeCapability`,
      `DiscoveryRun.edgeNodeId` migration; the
      `persistSubmittedDiscoveryRun` function added alongside
      `persistBootstrapDiscoveryRun`.
- [ ] Canonical contracts updated if this spec changes shared
      behavior (Contract 5 of the doctrine references this spec;
      Contract 9's mode 4 — CLI agents — is orthogonal but
      adjacent).
- [ ] **Security review complete (heavy):**
      - `dpfedge_*` token issuance and rotation flow
      - Bootstrap-token enrollment ceremony (TOFU vs paste vs
        operator approval)
      - Quarantine / revocation triggers and effects
      - Soft-fail policy windows when Authority Core unreachable
      - Policy-cache integrity (signing, freshness)
      - Edge Node binary signing / attestation
      - Linux capability surface (`CAP_NET_RAW`, `CAP_NET_ADMIN`)
        documented and minimized
      - macOS entitlements minimized
      - Audit-trail consistency for Edge Node observation
        submissions
- [ ] Release / rollback story defined — binary distribution,
      self-update flow, downgrade path if a release is bad.
- [ ] Test / verification gates defined — fresh install on
      Windows / macOS / Linux; submission contract test against
      `persistSubmittedDiscoveryRun`; air-gap behavior verified;
      capability advertisement / Authority Core policy round-trip
      verified.

## Source documents

- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — installer-parity roadmap that motivates this epic and preserves
  the current data path until this lands.
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — the authority/edge split this spec inherits and extends.
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md`
  — Qdrant silent-failure incident; observability invariants this
  work must preserve.
- `apps/web/app/api/mcp/v1/route.ts` — existing MCP transport
  template for governance, audit, and tokenization.
- `packages/db/prisma/schema.prisma:2974` — `McpApiToken` model
  template for the new `dpfedge_*` token shape (machine-owned,
  shorter-lived).
- `packages/db/src/discovery-collectors/network.ts` — current sweep
  implementation that this epic eventually replaces with Edge Node
  capability rows.
- `apps/web/app/api/v1/discovery/sweep/route.ts` — existing
  human-triggered sweep entry point; the new Edge Node ingestion
  endpoint sits beside it, not on top of it.
- `install-dpf.ps1:281-328` — `windows_exporter` install path that
  this epic eventually retires.
