# DPF Edge Node and Discovery Plane Architecture

> Status: **implementation-ready** for Phase 0 (pending heavy security
> review per the maturity gates section below). R&B pass complete
> 2026-05-12; open questions resolved or explicitly deferred.
>
> Source plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> (the "Discovery plane refactor" subsection under Future direction).
> The installer-parity roadmap deliberately leaves this epic
> unsequenced; the work lands after macOS / Linux installer-parity
> ships (which it has — installer Phase 7 merged 2026-05-10).
>
> Phase 0 implementation roadmap:
> `docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md`.
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

## Enrollment, rotation, and lifecycle (first-draft contract)

Promoted from open question because for an agent that runs outside
Docker and can see the LAN, **enrollment is not a detail — it is the
dragon's name tag**. Pattern borrowed from Fleet / osquery (enroll
secret → durable node key) and Tailscale (one-off / reusable /
ephemeral / pre-approved / tagged auth keys).

### Enrollment ceremony

```
┌─────────────────────┐       ┌──────────────────────┐
│  Authority Core     │       │  Edge Node binary    │
│                     │       │                      │
│  Admin > Platform   │       │                      │
│  Development        │       │                      │
│  generates a        │       │                      │
│  bootstrap token    │       │                      │
│  (short-lived,      │       │                      │
│  one-time,          │       │                      │
│  scope:edge:enroll) │       │                      │
│                     │       │                      │
│  Operator pastes    │──────▶│  --bootstrap-token=…│
│  / scans QR         │       │  --core-url=…       │
│                     │       │                      │
│                     │       │  POST /api/v1/edge/  │
│                     │◀──────│       enroll         │
│  Validates token,   │       │  with platform,      │
│  consumes it        │       │  arch, host          │
│  (single-use),      │       │  fingerprint,        │
│  records            │       │  attestation         │
│  enrollmentTokenId  │       │                      │
│  on EdgeNode row,   │       │                      │
│  issues machine-    │       │                      │
│  bound dpfedge_*    │       │                      │
│  node token,        │       │                      │
│  marks node as      │       │                      │
│  trustState=pending │       │                      │
│  (or =trusted if    │       │                      │
│  auto-approve       │       │                      │
│  policy)            │──────▶│  Stores node token   │
│                     │       │  in OS secure store  │
└─────────────────────┘       └──────────────────────┘
```

### Token namespaces and lifecycle

| Token | Scope | Lifetime | Issuer | Storage |
|---|---|---|---|---|
| **Bootstrap token** | `edge:enroll` only | one-time, ≤ 15 min default TTL | Authority Core (Admin > Platform Development action; or installer auto-issued for local-host enrollment) | not persisted on Edge Node — consumed and discarded |
| **Node token** (`dpfedge_*`) | `edge:heartbeat`, `discovery:submit`, plus capability-specific scopes from §"Token model" above | rotating; default 24h with refresh | Authority Core after successful enroll | OS-native secure store (Keychain / Credential Manager / libsecret); never written to plaintext config |
| **Refresh** | `edge:rotate` | bound to machine fingerprint + recent heartbeat | Authority Core | Edge Node calls heartbeat with current node token; Authority Core mints replacement token in response |

Bootstrap tokens are **never reusable**. Operators wanting bulk
enrollment must request N bootstrap tokens (Tailscale's one-off-key
pattern); a long-lived shared bootstrap token would replicate the
"shared API key in CI" anti-pattern.

### Approval policy

The default policy is **operator approval required for remote nodes,
auto-approval for local-host nodes**:

- **Auto-approve** when the bootstrap token is issued by the local
  installer for the DPF host's own Edge Node — same machine, no
  remote attack surface; node moves directly to
  `trustState: trusted`.
- **Operator approval** for any node where the bootstrap token is
  paste-provisioned or QR-provisioned: node lands in
  `trustState: pending` after enroll; an operator must approve in
  Admin > Platform Development before the node may submit
  observations (`trustState: trusted`).
- **Per-deployment override:** customers in low-friction
  environments may flip the default to auto-approve for any node;
  customers in high-friction (regulated, fleet-onboarding)
  environments may require operator approval for the local-host
  node too. Configurable but defaulted as above.

### Quarantine

A node moves to `trustState: quarantined` when:

- the platform's anomaly detection flags the node's submissions
  (e.g. observation deltas exceed configured deviance thresholds),
- the operator manually quarantines via Admin > Platform
  Development,
- the node fails a periodic re-attestation check
  (binary-signature mismatch, host-fingerprint drift),
- the node misses heartbeats beyond the soft-fail window plus a
  configured grace period.

**Quarantined behavior:** the node may still heartbeat (so operators
can see it's alive) but **must not** submit observations that flow
into trusted inventory. Submissions from quarantined nodes are
dropped (or archived to a separate `QuarantinedSubmission` table if
the operator opts in for forensic review). Quarantine never
auto-clears; an operator action is required to restore trust or
revoke.

### Revocation

A node moves to `trustState: revoked` when:

- the operator explicitly revokes (Admin > Platform Development
  action),
- the host the node ran on is decommissioned,
- a security incident invalidates the node's tokens.

**Revoked behavior:** the node's tokens are invalidated server-side;
the node row is preserved for audit (never deleted) with
`revokedAt` and `revocationReason`. The node cannot heartbeat,
cannot submit, cannot re-enroll without explicit operator
re-enrollment action that issues a fresh bootstrap token.

### Re-enrollment

Re-enrollment is always **operator-explicit**. There is no
"auto-recover from revoked." The operator runs an Admin >
Platform Development action that:

1. (optional) creates a new `EdgeNode` row vs reusing the existing
   row's `nodeId` — usually a new row to preserve audit history.
2. issues a fresh bootstrap token.
3. operator delivers the bootstrap token to the host (paste / QR
   / installer rerun).
4. the binary on the host enrolls anew per the ceremony above.

Stale state on the host (old node token in secure store) is
explicitly cleared by the binary before re-enrollment so the node
never holds two valid token versions simultaneously.

### Soft-fail policy windows (when Authority Core unreachable)

When the Edge Node cannot reach the Authority Core, default
behavior is **deny new principals/scopes; honor positive cached
decisions for known-good scopes only**. Per-scope soft-fail windows
are operator-configurable:

| Scope | Default soft-fail window | Notes |
|---|---|---|
| `edge:heartbeat` | unbounded (offline tolerance) | so node can resume cleanly after Authority Core returns |
| `discovery:submit` | 24h | submissions queue locally; flushed on reconnect; older submissions stamp the original `observedAt` |
| `mcp:gateway`, `a2a:gateway` | 0 (deny) | high-stakes; never operate without live policy |
| `policy:fetch` | 1h | policy decisions cached; refresh on reconnect |

## Edge Node registry (proposed Prisma models)

```prisma
model EdgeNode {
  id                    String    @id @default(cuid())
  nodeId                String    @unique
  displayName           String
  platform              String    // darwin | win32 | linux
  installMode           String    // native | container-host | container-vm
  version               String
  status                String    // pending | active | offline | quarantined
  trustState            String    // pending | trusted | quarantined | revoked
  lastSeenAt            DateTime?
  capabilities          Json
  metadata              Json?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  // Enrollment lifecycle (first-draft contract above).
  enrollmentTokenId     String?           // FK to BootstrapToken.id; cleared after consumption
  enrolledAt            DateTime?         // set when enroll succeeded
  approvedAt            DateTime?         // null until operator (or auto-approve policy) trusts the node
  approvedByPrincipalId String?           // FK to Principal who approved; null for auto-approve
  tokenRotatedAt        DateTime?         // last successful node-token rotation
  quarantinedAt         DateTime?
  quarantineReason      String?
  revokedAt             DateTime?
  revocationReason      String?

  capabilityRows EdgeNodeCapability[]
  observations   DiscoveryRun[]      @relation("EdgeNodeObservations")
}

model BootstrapToken {
  id            String   @id @default(cuid())
  tokenHash     String   @unique          // hashed at rest (mirrors McpApiToken pattern)
  prefix        String                    // for visual identification only
  issuedAt      DateTime @default(now())
  issuedByPrincipalId String              // FK to Principal who issued
  expiresAt     DateTime
  consumedAt    DateTime?                 // single-use; one EdgeNode consumes exactly one token
  consumedByEdgeNodeId String?            // FK to EdgeNode that enrolled
  revokedAt     DateTime?                 // operator can pre-revoke before consumption
  scope         String   @default("edge:enroll")
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

## Open questions — resolutions for Phase 0

The decisions below are binding for Phase 0. Revisits are explicit:
where a decision is "Phase 0 only" the alternative is named so the
re-decision path is clear.

### Edge Node lifecycle

| Question | Phase 0 decision | Rationale | Revisit |
|---|---|---|---|
| **Linux default networking** | `network_mode: host` only | Observer-only is sufficient for the first capability slice (`discovery.network` reads the host's NIC table, ARP, `docker ps`, `ss`). LLDP/CDP receive needs `macvlan`, but those collectors aren't in Phase 0. | Phase 1 when LLDP / segregated-scanning capabilities ship |
| **Binary distribution** | Container image only (`linux/amd64` + `linux/arm64`, multi-arch GHCR) | Phase 0 ships only Linux mode. Native binaries for macOS / Windows are in T3. Avoids the "extract from portal image vs separate release" question by deferring it. | T3 (macOS / Windows native binary) |
| **Update path** | Operator-managed: pull new image, restart container | Per S7 of Phase 0 decisions doc. Aligns with mainstream fleet agent practice (Datadog, Tailscale, Consul). Auto-update is an attack-surface increase that the operational benefit doesn't justify for a security-sensitive component. | Indefinite — only revisit if customer demand emerges |
| **Linux capabilities** | None beyond container default for Phase 0 | First slice's collectors (`ip addr`, `docker ps`, `ss`, ARP table read) need no special capabilities under `network_mode: host`. The container runs as a non-root user (`uid: 10001`). | Phase 1 — `CAP_NET_RAW` for raw-socket collectors (nmap probes, ICMP), behind a capability flag operator must explicitly enable |
| **macOS entitlements** | Out of Phase 0 (T3 thread) | Native binary path doesn't ship in Phase 0 | T3 |
| **Windows service vs scheduled task** | Out of Phase 0 (deferred — no Windows Edge Node ships before T3 lands the macOS path) | Same reason as macOS | Future thread (after T3) |

### Authority and trust

| Question | Phase 0 decision | Rationale |
|---|---|---|
| **Token scope catalog (Phase 0 subset)** | `edge:enroll` (bootstrap only), `edge:heartbeat`, `edge:rotate`, `discovery:submit` | Minimum-viable set to enroll, stay alive, rotate creds, and submit observations. Other capabilities (`mcp:gateway`, `a2a:gateway`, `policy:fetch`, `metrics:submit`) reserved as string constants in code but not implemented |
| **Enrollment ceremony** | Per spec § "Enrollment, rotation, and lifecycle (first-draft contract)" — no changes | Already a fully-defined contract; no open question remained |
| **Approval policy default** | Auto-approve for installer-issued local-host bootstrap; operator approval required for paste-provisioned remote nodes | Per spec § Approval policy. Operator can flip per-deployment |
| **Quarantine triggers (Phase 0)** | Manual operator-trigger only | Anomaly detection on observation deltas requires baseline observations to compare against — circular for a fresh deployment. Automatic triggers add in Phase 1 once a baseline window exists |
| **Soft-fail policy windows** | Per spec § Soft-fail policy windows (table) — no changes | Already defined |
| **Auth model (Phase 0)** | Bearer-token over HTTPS for `dpfedge_*` tokens; CSR field present in enrollment payload but Authority does not sign yet | Per S1 of Phase 0 decisions doc. Bearer ships fast and meets the production-grade fleet management bar (matches Datadog, Tailscale control plane, osquery+Fleet) | Phase 1 / T4 — mTLS hardening upgrade |
| **Bootstrap token TTL** | 15 min default, operator-configurable up to 24h max | Per S2. Tighter than AWS SSM Activations (30 days default). Tighter is appropriate for higher-risk environments |

### Capabilities and protocol gatewaying

| Question | Phase 0 decision |
|---|---|
| **MCP gateway** | Out of Phase 0. Capability string `mcp.gateway` reserved. Implementation in a later phase |
| **A2A gateway** | Out of Phase 0. Capability string `a2a.gateway` reserved |
| **Telemetry parity** | `windows_exporter` and `node-exporter` continue running unchanged. Phase 0 ships a *parallel* data path (Edge Node `discovery.network` capability), not a replacement. Retirement of the exporters happens in a later phase, gated on feature parity verification |

### Schema and ingestion

| Question | Phase 0 decision | Rationale |
|---|---|---|
| **Schema additions** | Per spec § Edge Node registry — `EdgeNode`, `BootstrapToken`, `EdgeNodeCapability`. `DiscoveryRun.edgeNodeId` added optional FK | Confirmed; ships as A1 in the roadmap |
| **`DiscoveredItem.confidence` field** | No change for Phase 0 | The existing `confidence` field is a `Float`, already expressive enough. Edge Node submissions stamp confidence in the agent (default 0.9 for native-host data, 0.7 for container-VM-fallback data) |
| **Ingestion path: REST vs MCP tool** | REST only (`/api/v1/edge/discovery-runs`) | Simpler debug path for Phase 0. MCP-tool wrapper can be added later as a thin shim over the REST endpoint. Avoids coupling Phase 0 to MCP grant evaluation while the Edge Node trust model is brand new |
| **PrincipalAlias for EdgeNode** | Required from A1 | Per AGENTS.md §11 principal-convergence rule (any new identity-bearing entity post-2026-05-09 must be a `PrincipalAlias`) |

### Minor gaps surfaced during R&B

| Gap | Phase 0 default |
|---|---|
| **Node identity** | UUID minted at enrollment (`nodeId`), plus host fingerprint stored separately for verification. Hostname is informational metadata only (lesson from Wazuh's mutable-IP-as-key trap) |
| **Node naming / tagging** | Free-text `displayName` + `metadata` JSON for tags; operator-set at enrollment time or editable post-enroll |
| **Capability negotiation** | Authority replies with `acceptedCapabilities` set; Edge Node operates within that set only. Mismatches between advertised and accepted are surfaced in Admin > Platform Development |
| **Time sync** | Assume NTP. Edge Node attaches local timestamp + clock-skew estimate (vs Authority's response time) to each submission; Authority rejects submissions with skew > 5 min and emits a warning |
| **Edge Node operational logs** | stdout (operator captures via `docker compose logs edge-node`). Ship-to-Authority is deferred |
| **Resource footprint** | Best-effort — document observed CPU/RAM in the runbook produced as part of the Phase 0 verification artifact |

## Research and Benchmarking

Per AGENTS.md §10: read data and trust models, not feature lists.
Three open-source leaders + two commercial agents that share the
"central authority + many host-resident agents reporting state +
machine-bound credentials + lifecycle management" shape with the
DPF Edge Node.

### Open source — osquery + Fleet (kolide/fleetdm)

**Source:** `osquery` (https://osquery.io), `Fleet`
(https://fleetdm.com, formerly Kolide Fleet).

**Data model:** Hosts identified by a server-issued opaque
`node_key` (durable per-host identifier). Initial enrollment uses an
`enroll_secret` provided to the host out-of-band, exchanged for the
durable `node_key`. The agent runs scheduled queries (SQL over the
host's OS state); results submit via TLS to the Fleet server's
`/api/v1/osquery/log` and `/api/v1/osquery/distributed/read`.

**Trust model:** `node_key` is bearer-equivalent at the wire; TLS
provides the channel. The `enroll_secret` is shared (one secret can
enroll many hosts) — Fleet adds per-team enroll secrets to scope
this. The server treats the agent as semi-trusted — it can submit
observations, but the server schedules the queries (a different
shape than the DPF Edge Node, where the agent decides what to scan).

**Patterns adopted:**
- Two-stage credential model: bootstrap secret → durable node key.
  This is exactly the `BootstrapToken` → `dpfedge_*` node token
  shape.
- Server-side ingestion that takes a *prepared* observation set
  and skips the local-collector path. Maps directly to
  `persistSubmittedDiscoveryRun` vs `persistBootstrapDiscoveryRun`.

**Patterns rejected:**
- Shared `enroll_secret` across all hosts. Fleet mitigates with
  per-team secrets, but the model still tolerates "shared API key
  in CI" risk. DPF rejects this — `BootstrapToken` is **single-use,
  one-time consumption** per the enrollment ceremony in this spec.
- Server-pushed query schedules. The DPF Edge Node decides
  *whether* to scan (local cadence + Authority's per-scope
  policy), but the Authority does not push the actual scan
  parameters into the Edge Node's runtime. Reduces blast radius
  if Authority is compromised.

### Open source — Tailscale (tailscaled + control plane)

**Source:** Tailscale OSS client `tailscaled`
(https://github.com/tailscale/tailscale); control protocol
described in https://tailscale.com/blog/how-tailscale-works.

**Data model:** Each node has a long-lived `MachineKey` (Curve25519,
generated locally, never leaves the host). On first contact with the
control plane, the node submits `MachineKey` + auth proof; control
plane records the node and issues short-lived `NodeKey` (also
Curve25519). `NodeKey` rotates on schedule (default ~7 days) and on
network changes; `MachineKey` is durable and represents identity.

**Auth keys come in flavors:**
- **One-time auth key:** consumed on first node enrollment; cannot
  be reused.
- **Reusable auth key:** N enrollments allowed; useful for fleet
  bootstrap.
- **Ephemeral auth key:** node is auto-deleted from the tailnet
  after being offline for a period.
- **Pre-approved + tagged auth keys:** node is pre-approved (skips
  manual approval) and arrives with operator-set tags for ACL
  routing.

**Trust model:** Bearer-equivalent over a control protocol with
mutual authentication. Tags on a node carry into ACL evaluation —
the `tag:server` node gets server-class privileges automatically.
Revocation is server-side: a revoked node's `NodeKey` is rejected
on next handshake.

**Patterns adopted:**
- Local key generation; the host-private machine key never travels
  the wire. The DPF Edge Node generates its keypair locally; the
  CSR / public-key fingerprint goes into the enrollment payload.
- Short-lived node creds with rotation on heartbeat (the spec's
  `tokenRotatedAt` field + the "default 24h with refresh" entry in
  the token table).
- Tagged enrollment for capability auto-grant (Phase 0 ships only
  the `discovery.network` capability, but the
  `EdgeNodeCapability.mode` field provides the same auto-grant
  mechanism: an Authority operator can pre-approve which
  capabilities a tagged node enables on enrollment).

**Patterns rejected:**
- Reusable auth keys (Tailscale offers them; the DPF Edge Node spec
  explicitly does not — same reason as the osquery rejection
  above). Fleet onboarding scenarios that benefit from reusability
  in Tailscale are handled in the DPF model by Admin > Platform
  Development minting N one-time tokens at once.
- Direct node-to-node mesh connectivity (Tailscale's primary value
  prop). Out of scope for the Edge Node — observations are
  authority-submitted, not peer-shared, and the spec is explicit
  that "Edge Nodes do not talk to each other directly without
  going through DPF."

### Open source — Wazuh (ossec-agent)

**Source:** Wazuh (https://github.com/wazuh/wazuh), fork of OSSEC.
Manager / agent / agentd lifecycle protocol.

**Data model:** Each agent has a unique `agent_id` (numeric,
manager-issued at registration), `agent_name`, `agent_ip`. On
enrollment via `authd`, the agent submits a CSR; the manager signs
and returns the agent's certificate + `client.keys` entry (id +
key + name + IP). The agent uses that key for all subsequent
manager communications.

**Lifecycle states tracked at the manager:**
- `pending` — enrolled but not yet authenticated
- `active` — keepalive received within the soft-fail window
- `disconnected` — keepalive missed past the configured threshold
- `never_connected` — enrolled but never sent its first keepalive

**Trust model:** Pre-shared key (enrollment secret) for the
authd handshake; client cert thereafter (mTLS-style, though the
default deployment is TLS-with-shared-key). Agent state is
manager-canonical; the agent reports its state in keepalives but
the manager makes the authoritative determination (`active` vs
`disconnected`).

**Patterns adopted:**
- Multi-state lifecycle at the Authority (`pending` → `active`
  → `quarantined` → `revoked`). The DPF Edge Node `trustState`
  enum is a direct match for the data-side; the *operational*
  state (`active` / `offline`) is the spec's `status` enum.
- Authority-canonical state determination from heartbeat misses
  with a soft-fail window. The spec already has this; Wazuh
  validates the pattern.
- Agent submits a CSR at enrollment. The spec's `BootstrapToken`
  flow includes a CSR field for the same reason — Phase 1 mTLS
  upgrade has a hook in place from day 1.

**Patterns rejected:**
- Pre-shared enrollment secret reused across agents. Wazuh's
  default is to share the password across the fleet; the DPF
  spec uses one-time bootstrap tokens.
- Manager-canonical agent IP tracking. The spec's `EdgeNode`
  carries no IP field — the host's network identity is mutable,
  the Edge Node identity is not.

### Commercial — Datadog Agent

**Source:** datadog-agent OSS repo (https://github.com/DataDog/datadog-agent),
plus published architecture docs at https://docs.datadoghq.com/agent/.

**Data model:** Each host runs a single Agent binary (Go). Agent
identifies itself to Datadog with a long-lived **API key** (per-org,
per-environment) plus optional **App key** (for management plane).
Hosts surface in the inventory by `hostname` + `tags`; tag
inheritance is the primary attribution mechanism (`env:prod`,
`service:web`, `team:platform`).

**Capability model:** One Agent binary, configuration-driven
checks. Checks declared in `conf.d/*.yaml`. Agents can run in
multiple modes (host metrics + APM trace forwarding + log
collection + cluster checks) selected by config — same pattern as
"one binary, capability flags" called out for the DPF Edge Node.

**Trust model:** API key is bearer-over-HTTPS. Long-lived (no
automatic rotation). Per-host scope is achieved through tag-based
ACLs. Datadog has been criticized in security audits for the
"long-lived shared API key" pattern; the company has added
short-lived **API key forwarding** in fleet automation
(intermediate token issuance) but the agent itself still uses
long-lived bearers.

**Patterns adopted:**
- One binary, capability negotiation by config. Maps to the DPF
  Edge Node's capability envelope.
- Tag-based attribution at the Authority (DPF's
  `EdgeNode.metadata` JSON column gives the same flexibility).
- On-disk buffered queue when the central is unreachable. Datadog's
  Agent uses `forwarder.transactions_serializer` with bounded
  retry; the spec's S6 (SQLite-backed buffer with bound and
  exponential backoff) matches the proven pattern.

**Patterns rejected:**
- Long-lived API key with no rotation. The DPF spec's `dpfedge_*`
  node tokens rotate on heartbeat (default 24h). Agents that hold
  long-lived bearers indefinitely are an unrecoverable-incident
  attack surface.
- "Per-team" rather than per-host credentials. Each DPF Edge Node
  has its own machine-bound token; no token covers a fleet.

### Commercial — AWS Systems Manager Agent (SSM Agent)

**Source:** AWS SSM Agent
(https://github.com/aws/amazon-ssm-agent); managed-instance
service architecture.

**Data model:** EC2 instances and managed on-prem hosts register
to SSM. EC2 instances authenticate via the EC2 instance profile
(IAM role on the metadata service); on-prem hosts use **hybrid
activation** — operator generates a short-lived `Activation` (id +
code, ~30-day TTL by default), the host runs `ssm register
--activation-id <id> --activation-code <code>`, exchanges for a
long-lived **managed-instance ID** (`mi-*`) tied to a per-instance
IAM role.

**Trust model:** Activations are one-time, short-lived (operator-
configured TTL, max 30 days). The exchanged managed-instance ID
is durable; the host then uses standard AWS SDK signing (SigV4)
for all subsequent API calls — true cryptographic auth, not bearer
tokens.

**Patterns adopted:**
- Activation = short-lived, one-time, operator-issued. Matches
  the DPF `BootstrapToken` shape exactly (the spec's "≤ 15 min
  default TTL" is tighter than AWS's 30-day default; tighter is
  appropriate for higher-risk environments).
- Per-instance IAM role / per-edge-node permissions. The spec's
  per-EdgeNode capability flags accomplish the same thing.

**Patterns rejected:**
- Cloud-only attestation (instance metadata service). DPF cannot
  rely on cloud-provided attestation since the Authority Core may
  run on bare metal, in TAPPaaS, or in a customer VPC. The Edge
  Node uses a host-fingerprint + signed binary measurement instead.

### Patterns adopted (consolidated)

| Pattern | Source | DPF mapping |
|---|---|---|
| Two-stage credential: bootstrap → durable node key | osquery, Wazuh, AWS SSM | `BootstrapToken` → `dpfedge_*` node token |
| Server-side prepared-observation ingestion | osquery+Fleet | `persistSubmittedDiscoveryRun` |
| Local key generation; private key never wired | Tailscale | Edge Node generates keypair locally; CSR in enrollment payload |
| Short-lived node creds with heartbeat rotation | Tailscale | `tokenRotatedAt`; default 24h refresh |
| One binary, capability flags | Datadog Agent, OpenTelemetry Collector | Edge Node binary + `EdgeNodeCapability` rows |
| Multi-state lifecycle at Authority (pending/active/disconnected/quarantined/revoked) | Wazuh | `EdgeNode.trustState` + `EdgeNode.status` |
| Authority-canonical state from heartbeat misses + soft-fail window | Wazuh | Spec's heartbeat / soft-fail policy section |
| Bounded on-disk buffer when central unreachable | Datadog Agent, OpenTelemetry, Fluent Bit | S6 — SQLite buffer with bound + exponential backoff |
| Tag-based attribution and capability auto-grant | Tailscale, Datadog | `EdgeNode.metadata` + `EdgeNodeCapability.mode` |
| Authority-decided heartbeat / scan cadence | Wazuh, K8s kubelet | S4 + S5 — Authority returns intervals in heartbeat response |

### Patterns rejected (consolidated)

| Pattern | Source | Why rejected |
|---|---|---|
| Reusable / shared bootstrap secret | osquery `enroll_secret`, Tailscale reusable auth keys, Wazuh shared password | Replicates "shared API key in CI" anti-pattern. DPF mints N one-time tokens for fleet onboarding instead. |
| Server-pushed query schedules / remote agent config | osquery distributed queries, Datadog remote config | Increases blast radius if Authority is compromised. Edge Node decides *whether* to scan; Authority controls *which capabilities* via policy. |
| Long-lived agent bearer with no rotation | Datadog Agent API key | Unrecoverable-incident surface. DPF rotates `dpfedge_*` tokens on heartbeat. |
| Direct node-to-node mesh | Tailscale data plane | All cross-node trust through Authority Core; Edge Nodes do not peer. |
| Cloud-only instance attestation | AWS SSM (EC2 instance profile) | Authority Core may run on bare metal / TAPPaaS / on-prem; can't depend on cloud metadata. |
| Auth fail-open when central unreachable | (varies — many small agents) | Spec's soft-fail policy is **deny new principals/scopes**; only known-good cached scopes honored within bounded windows. |
| Plaintext token in agent config file | cloudflared default, many bespoke agents | Spec mandates OS-native secure store (Keychain / Credential Manager / libsecret). |

### Anti-patterns identified

| Anti-pattern | Where seen | DPF guard |
|---|---|---|
| Single capability per binary (separate `osquery` + `node_exporter` + `cloudflared` + ...) | Most fleet stacks | One binary + capability flags; operator manages one daemon, not N |
| Mutable agent identity (hostname / IP as primary key) | Wazuh `agent_ip`, some monitoring stacks | `EdgeNode.nodeId` is opaque + immutable; hostname / IP go in `metadata` only |
| Trust model where revocation requires server reboot or config push | Several self-hosted SIEM agents | `dpfedge_*` rotation on heartbeat; revocation propagates within one heartbeat window |
| Auto-update with no operator gate | AWS SSM auto-update default-on, some endpoint agents | S7 — operator-managed updates; auto-update deferred indefinitely |
| Authority and Edge sharing the same DB / token table | Naïve co-located deployments | Token namespace separation (`dpfedge_*` vs `dpfmcp_*` vs user JWTs) enforces per-surface scope |

### Gaps the Edge Node design fills (vs. the comparison set)

| Gap | What the comparison set offers | What the Edge Node design adds |
|---|---|---|
| Authority/Edge identity split | osquery, Wazuh, Datadog all assume the central is a SaaS or on-prem appliance with its own identity | Edge Node is a `PrincipalAlias` per the principal-convergence work; the same authorization model that gates users / agents / mobile devices gates Edge Node submissions |
| Deployment-target neutrality | Each comparison product is opinionated about its server (Datadog SaaS, Wazuh on-prem appliance, AWS SSM cloud-only) | One Edge Node binary works against Authority Core in any deployment shape: local, single-VM cloud, container service, k8s, TAPPaaS |
| Per-Edge-Node capability policy | Datadog's "fleet automation" comes closest, but capability-level enable/disable is config-side, not Authority-side | Authority's `EdgeNodeCapability.mode` (`enabled` / `reporting-only` / `disabled`) lets operators flip individual capabilities per node without redeploying the binary |
| Audit-uniform observation submission | Most agents submit through bespoke endpoints with bespoke auth | Same `ToolExecution` audit table receives Edge Node submissions; same governance envelope as MCP / web / mobile |
| Quarantine as first-class state | Wazuh has it; Datadog and Tailscale don't (revoke is the only escape valve) | DPF separates `quarantined` (still alive, dropped submissions) from `revoked` (tokens dead, audit row preserved) — operator can investigate before destroying state |

## Sequencing

This epic sits **after** the macOS / Linux installer-parity roadmap
ships its Phase 7 (full installer). Until then, the discovery sweep
keeps its current data path: `windows_exporter` on Windows,
`node-exporter` (`linux-monitoring` profile) on Linux,
container-local fallback on macOS.

The installer-parity roadmap does **not** retire `windows_exporter`
or the `windows-host` Prometheus scrape — those retire when this
epic ships the Edge Node's `capability.discovery.network` slice.

## Maturity gates — Phase 0 status

This spec moves from research to binding when all of these are
complete. **Security review is weighted heavier than other specs
because the Edge Node touches sandbox execution, network scanning,
credentials, policy caching, and host-local trust — an
architectural defect here has wider blast radius than a deployment-
target misconfiguration.**

- [x] **Research & Benchmarking section complete** (per AGENTS.md §10).
      Five comparison systems analyzed (osquery+Fleet, Tailscale,
      Wazuh, Datadog Agent, AWS SSM Agent). Patterns adopted /
      rejected / anti-patterns / gaps documented above.
- [x] **Open questions resolved or explicitly deferred.** Phase 0
      decisions table above. All deferred items have an explicit
      revisit trigger and a destination thread (Phase 1 / T3 / T4).
- [x] **Schema impact reviewed** — `EdgeNode`, `BootstrapToken`,
      `EdgeNodeCapability`, `DiscoveryRun.edgeNodeId` migration; the
      `persistSubmittedDiscoveryRun` function added alongside
      `persistBootstrapDiscoveryRun`. Ships as roadmap A1.
      `EdgeNode` is a `PrincipalAlias` per AGENTS.md §11
      principal-convergence rule.
- [x] **Canonical contracts updated** —
      `docs/superpowers/specs/2026-05-09-deployment-contracts.md`
      Contract 5 already references this spec. Contract 9 mode 4
      (CLI agents) is orthogonal. No further doctrine updates
      needed for Phase 0.
- [ ] **Security review complete (heavy)** — required before Phase 0
      implementation merges. Reviewer scope:
      - `dpfedge_*` token issuance and rotation flow (per token
        table in spec § Token namespaces and lifecycle)
      - Bootstrap-token enrollment ceremony (one-time, ≤15 min TTL,
        operator approval default for remote nodes)
      - Quarantine / revocation triggers and effects (Phase 0:
        manual-only; automatic deferred)
      - Soft-fail policy windows when Authority Core unreachable
        (per spec table)
      - OS-secure-store key storage (Keychain / Credential Manager /
        libsecret) — review for the Linux container case where the
        host's libsecret may not be available; Phase 0 fallback is
        a 0600-permission file under `/var/lib/dpf-edge/` owned by
        the container user
      - Edge Node binary attestation (Phase 0: signed container
        image manifest only; signed-binary attestation deferred)
      - Linux capability surface — Phase 0 needs no special
        capabilities (documented above)
      - Audit-trail consistency for Edge Node observation
        submissions (Phase 0: each submission writes one
        `ToolExecution` row with `surface=edge-node`)
- [x] **Release / rollback story defined** — Phase 0:
      - Distribution: container image only, multi-arch GHCR, pinned
        version tag (`ghcr.io/.../dpf-edge-node:v0.1.0`)
      - Update: operator pulls new image + restarts (no auto-update)
      - Rollback: operator points docker-compose back at the
        previous tag and restarts; `EdgeNode` row preserved across
        version rollback
      - Downgrade safety: schema migrations for the Edge Node
        models are forward-only in v0; downgrade requires manual
        DB intervention (acceptable for Phase 0 — fleet of
        intentionally small)
- [x] **Test / verification gates defined** — Phase 0:
      - Unit tests on the new ingestion endpoints + auth middleware
      - Unit tests on `persistSubmittedDiscoveryRun` (submission
        envelope → DiscoveredItem rows → InventoryEntity rows)
      - Integration smoke (compose-based): portal + edge-node
        side-by-side, enroll → sweep → verify Postgres + Neo4j rows
      - Verification runbook entry (added to
        `docs/install/verification-runbook.md`) for real-LAN
        verification (T2 thread)
      - Air-gapped behavior verification deferred to T5 thread

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
