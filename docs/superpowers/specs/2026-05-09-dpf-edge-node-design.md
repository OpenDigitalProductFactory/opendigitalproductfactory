---
status: binding
---

# DPF Edge Node and Discovery Plane Architecture

> Status: **binding** as of 2026-05-12. The maturity gates from the
> 2026-05-09 research stub closed in PR <#tbd> alongside this
> revision. Implementation sequencing lives in
> `docs/superpowers/plans/2026-05-12-edge-node-roadmap.md` (six
> phases, beginning with the Authority Core foundation). **Phase 0
> shipped a Node.js / TypeScript Edge Node service for Mode 1
> (Linux container) in PR #501** — the *native* binary path
> (Mode 2 macOS / Mode 4 Windows) is what waits for Phase 1+, not
> the existence of any Edge Node code. See "Language for the
> binary" under Open question resolutions for the runtime status.
>
> Revision history:
> - 2026-05-09 — initial research stub (PR #400).
> - 2026-05-12 — maturity gates closed: Research & Benchmarking
>   section filled in against osquery / Fleet, Wazuh, Tailscale,
>   Cloudflare Tunnel, Netbox-Agent, Falco; commercial comparators
>   Auvik, Lansweeper, ScienceLogic SL1, Twingate, Cloudflare Zero
>   Trust. Open questions resolved (Go for the binary, GitHub
>   Release distribution, `network_mode: host` as the first-slice
>   Linux default, LaunchDaemon system-wide on macOS, Windows
>   Service). Schema revised to honor the Principal convergence
>   rule from AGENTS.md §11 (EdgeNode is a host-attributes side
>   table, not a parallel identity). Security review summary,
>   release / rollback story, and verification gate matrix
>   added. Spec promoted from "research stub" to "binding".
> - 2026-05-12 — **security review pass (corrective).** Six findings
>   from the post-implementation security review addressed:
>   (1) "machine-bound" token language downgraded to "per-node
>   bearer (Phase 0)" with a documented Phase 1+ upgrade path
>   (mTLS / DPoP / platform-attested keys);
>   (2) ingestion-attribution rule made explicit — `edgeNodeId`,
>   `nodeId`, `principalId`, `sourceSlug` derive from
>   `resolveEdgeNodeAuth` only, never from the request body;
>   (3) REST ingestion controls section added (per-node rate
>   limits, payload size caps, `runKey` idempotency / replay
>   protection, failure-audit requirements, freshness window) —
>   binding for Phase 0;
>   (4) Phase 0 storage downgrade documented as such, with the
>   required compensating controls (non-root UID, 0600 perms,
>   no Docker socket mount, backup exclusion, log redaction,
>   rotation on suspected copy);
>   (5) Quarantine triggers split into Phase 0 (manual operator
>   action only) vs Phase 1+ (anomaly detection, re-attestation
>   drift, missed-heartbeat timer);
>   (6) Critical / Important / Acceptable security findings list
>   updated to match the corrections, with explicit notes on what
>   is Phase 0 risk vs Phase 1+ closure.
>   (7) Orphan scope name `edge:register` from the original draft
>   removed; canonical scope vocabulary `edge:enroll`,
>   `edge:heartbeat`, `edge:rotate`, `discovery:submit`,
>   `metrics:submit`, `mcp:gateway`, `a2a:gateway`, `policy:fetch`
>   documented as the authoritative list.
>   (8) Runtime-language drift documented: Phase 0 Mode 1 shipped
>   Node.js / TypeScript (PR #501) against a spec that named Go.
>   The drift is acknowledged with two acceptable paths forward
>   (standardize on TypeScript or hold the Go decision and rewrite
>   Mode 1) — decision must land before Mode 2 macOS native ships.
> - 2026-05-12 — **security review pass 3 (alignment cleanup).**
>   Five additional findings from the post-#509 review:
>   (1) Runtime/phase language internally inconsistent — header
>   said "no Edge Node binary ships before Phase 1" while Phase 0
>   shipped the Node.js Mode 1 service. Header revised to say the
>   *native* binary path (Mode 2 / 4) is what waits for Phase 1+,
>   not the existence of any Edge Node code. Maturity-gate row
>   updated: "Mode 1 runtime locked (TypeScript, shipped); Mode 2 /
>   4 native binary runtime open."
>   (2) REST controls section was framed as "binding" without
>   distinguishing "the gate the implementation must satisfy" from
>   "the current runtime truth." Added an "Implementation status"
>   subsection mapping each REST control to its current state
>   (auth + body validation + freshness + idempotency: implemented;
>   per-node rate limits + 64 KB rawData cap + total-body cap +
>   failure audit + persistence wiring: pending).
>   (3) Linux networking was simultaneously "open" (in the
>   deployment-modes table) and "locked for first slice" (in Open
>   question resolutions). Table now references the scoped
>   decision instead of restating it as open.
>   (4) Stale "custom Go HTTP client" wording in the
>   Endpoint-vs-MCP-tool resolution corrected to "custom HTTP
>   client (currently TypeScript / undici per services/edge-node)"
>   with a forward reference to the runtime drift note.
>   (5) Storage controls aligned with implementation: the read-time
>   "mode 0600" + "owner UID match" checks are now implemented in
>   `services/edge-node/src/state.ts:verifyStatePerms` with unit
>   tests. The cross-container fingerprint check (a stronger
>   promise the original spec made) is explicitly downgraded to
>   Phase 1+ — Phase 0 relies on the mode + owner + volume-isolation
>   controls listed above.
> - 2026-05-16 — **runtime decision resolved.** The
>   "Language for the binary" open question is closed by ADR
>   [`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md):
>   Modes 2 (macOS native) and 4 (Windows native) ship in Go. Mode 1
>   (Linux container, TypeScript shipped in #501) is retrofitted to
>   Go in a separate epic (`BI-EDGE-XP-04-MODE1-GO-RETROFIT`), gated
>   on Mode 4 verification passing on real Windows hardware. The
>   interim Mode 1 / Modes 2-4 runtime split is bounded by a new
>   wire-contract test suite shipping with the first Mode 4 slice.
>   The "Language for the binary", deployment-modes table, maturity-
>   gate row, and endpoint-vs-MCP-tool sections are amended in the
>   same PR.
>
> Source plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> (the "Discovery plane refactor" subsection under Future direction).
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

> **Superseded stance (2026-08-26, EP-24741BBF / `BI-5167932D`).** The enterprise-auth spec's choice to adopt authentik as a runtime identity edge has been **reversed**. DPF absorbs the directory over its own `Principal` spine and adds no IdP to any install. Consuming an external IdP as an *upstream* remains supported and optional. See [Directory Service — Identity Absorption Design](2026-08-23-directory-service-identity-absorption-design.md) and [the authentik evaluation](../../security/tool-evaluations/2026-08-23-authentik.md).


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
| Linux native Docker (Mode 1) | Container with `network_mode: host` (scoped first-slice default; see Open question resolutions) | Default for Linux server installs. Phase 0 ships Node.js / TypeScript per [`services/edge-node`](../../../services/edge-node) (PR #501). The first-slice networking choice (`network_mode: host`, observer-only) is resolved in "Open question resolutions" below; `macvlan` is a follow-on slice for LLDP/CDP receive, not Phase 0. |
| macOS native (Mode 2) | Native LaunchDaemon (or LaunchAgent) | Self-contained Go binary per the runtime-decision ADR ([`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md)). Cross-compile target `darwin/arm64` first slice; `darwin/amd64` for Intel Macs. Mode 1 (TypeScript, shipped in #501) is retrofitted to Go in a separate epic (`BI-EDGE-XP-04-MODE1-GO-RETROFIT`) gated on Mode 4 verification. |
| Windows native (Mode 4) | Native Windows Service | Self-contained Go binary per the runtime-decision ADR ([`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md)). Cross-compile target `windows/amd64` first slice; `windows/arm64` deferred to `BI-EDGE-XP-05-WIN-ARM64`. Windows Service registration via `golang.org/x/sys/windows/svc` (native SCM, no NSSM). |
| Docker Desktop fallback (Mode 3) | Degraded in-VM container | Sees only the Docker Desktop VM's network; capability set restricted. Acceptable for dev installs that don't need host-LAN visibility. Same Node.js / TypeScript image as Mode 1. |
| Remote managed host | Native service or container per host class | Same API contract, same auth scope; runtime per the host's mode. |

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
| Token namespace | `dpfedge_*` (per-node bearer over HTTPS; short-lived, rotated via heartbeat; Phase 0 lacks cryptographic token binding — see "Token model" below) | mobile JWT today; OIDC + PKCE refresh tokens per the Mobile spec evolution (see Doctrine Contract 10) |
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
edge:enroll       # bootstrap-token scope only; consumed at enroll
edge:heartbeat    # keepalive + rotation; allowed for pending and quarantined nodes
edge:rotate       # token rotation (server-side stamps rotatedAt, mints new token)
discovery:submit  # POST /api/v1/edge/discovery-runs; trusted-only
metrics:submit    # reserved for future host-metrics capability slice
mcp:gateway       # reserved for future MCP-gateway capability slice
a2a:gateway       # reserved for future A2A-gateway capability slice
policy:fetch      # reserved for future policy-cache capability slice
```

The scope vocabulary is closed; new scopes require an AGENTS.md
update + this list. The first-draft `edge:register` name was renamed
to `edge:enroll` during the implementation in PR #498 — the
bootstrap-token scope is `edge:enroll`, the enrollment ceremony
endpoint is `POST /api/v1/edge/enroll`, and the in-code constant
`EDGE_NODE_ALIAS_KIND`-adjacent surfaces all use the `enroll`
spelling. This list is authoritative; if you see `edge:register`
in an older draft or commit message, it's the orphan name and
should be treated as `edge:enroll`.

Tokens are **per-node bearers**: issued by the Authority Core to a
specific `EdgeNode.nodeId`, short-lived, rotated via heartbeat /
refresh. They are *not* user-issued through Admin > Platform
Development the way MCP tokens are. The MCP token model
(`packages/db/prisma/schema.prisma:2974` — `tokenHash` unique, scopes
array, capability gate, optional agent narrowing) is the right
template; the data model differs only in ownership (machine, not user)
and rotation cadence.

**Phase 0 token-binding posture (downgrade documented).**

A reviewer scoping this surface as "machine-bound" should read it
carefully: Phase 0 transports the node token as a bearer credential
in `Authorization: Bearer dpfedge_<secret>` over HTTPS. There is no
cryptographic proof-of-possession (no DPoP / OAuth2 mTLS / RFC 8705
token binding), no CSR-signed key, no enclave-attested key. **A
copied token impersonates the node** until the server-side rotation
or revocation invalidates it. The compensating controls are:

- **Short TTL.** Default 24h; configurable downward per deployment.
- **Heartbeat rotation.** Every successful heartbeat returns a new
  `dpfedge_*` token and rotates the previous one out of grace; the
  exposure window for a copied token narrows to (heartbeat interval
  + grace window) ≈ 1 hour by default.
- **Audit + anomaly signals.** Authority Core records every
  authenticated call and the operator can quarantine on anomaly.
- **No re-enrollment shortcut.** A stolen token cannot bootstrap a
  fresh long-lived credential — re-enrollment is operator-explicit
  (see "Re-enrollment").

**Phase 1+ upgrade path (planned, not committed).** Real machine
binding requires one of:

1. **mTLS** with a Phase-1 PKI: the Edge Node generates a keypair at
   install, the Authority signs a CSR during enrollment, every
   request authenticates the cert. Operator burden is the PKI.
2. **DPoP-style proof-of-possession** (RFC 9449): every request
   carries a signed JWT proving control of a private key bound to
   the issued node token. Lower operator burden than mTLS; needs
   server-side replay protection per the RFC.
3. **Platform-attested keys** (TPM 2.0 / Secure Enclave / Windows
   Platform Crypto): the private key never leaves the host's secure
   element. Strongest guarantee; constrained by platform availability.

Until one of those lands, **the spec calls the token a "per-node
bearer," not "machine-bound."** All other references in this spec
(security review, R&B, comparator analysis) are amended to match.

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
| **Node token** (`dpfedge_*`) | `edge:heartbeat`, `discovery:submit`, plus capability-specific scopes from §"Token model" above | rotating; default 24h with refresh | Authority Core after successful enroll | **Preferred:** OS-native secure store (Keychain / Credential Manager / libsecret). **Phase 0 fallback (Linux container Mode 1):** 0600 file under the container's state directory — explicitly a security downgrade; see "Phase 0 storage downgrade" below for required controls. |
| **Refresh** | `edge:rotate` | per-node bearer; rotation gate is a successful heartbeat with the current token (Phase 0). Phase 1+ adds cryptographic key binding (mTLS / DPoP / platform-attested), at which point rotation also re-attests possession of the key. | Authority Core | Edge Node calls heartbeat with current node token; Authority Core mints replacement token in response |

Bootstrap tokens are **never reusable**. Operators wanting bulk
enrollment must request N bootstrap tokens (Tailscale's one-off-key
pattern); a long-lived shared bootstrap token would replicate the
"shared API key in CI" anti-pattern.

### Phase 0 storage downgrade (Linux container Mode 1)

The OS-native secure store is the preferred storage target. The
Linux-container Phase 0 deployment (Mode 1) cannot reach the host's
libsecret / Keychain / Credential Manager from inside a container,
so it falls back to a **0600 file under the container's
container-private state directory** (currently
`/var/lib/dpf-edge-node/state.json`, implemented in
[`services/edge-node/src/state.ts`](../../../services/edge-node/src/state.ts)).
This is **explicitly a security downgrade** from the preferred
posture; the spec accepts it for Phase 0 only because the
container's filesystem is owned by a dedicated UID that no other
workload shares.

The downgrade is acceptable **only if** all of the following
controls are present:

- **File owner**: a non-root, dedicated UID created by the
  Dockerfile (e.g. `dpf:dpf`). Never `root`. The state dir is
  `chown`ed to that UID at image build time.
- **File mode**: `0600`. Enforced at write time (`fs.writeFile` /
  `fs.chmod` after `rename` to absorb umask drift); **verified at
  read time** via `verifyStatePerms` in
  [`services/edge-node/src/state.ts`](../../../services/edge-node/src/state.ts)
  (`loadState` refuses to read a state file whose mode is anything
  other than `0600`). The mode check is POSIX-only — skipped on
  Windows-host development machines where the perm semantics
  don't apply; the Linux-container production deployment is
  fully covered.
- **File owner UID**: the state file's owner UID must match the
  current process UID at read time. Enforced by the same
  `verifyStatePerms` function. Catches the host-bind-mount-leak
  threat (a different account's state dropped into the container's
  state directory) without relying on filesystem labels.
- **Volume isolation**: the state directory is a docker-managed
  volume, not a bind-mount from the host. Mounting host paths into
  the Edge Node container is forbidden (and would defeat the
  whole point of running outside the container fleet in the
  native Mode-2 path).
- **No Docker socket mount**: the Edge Node container does **not**
  mount `/var/run/docker.sock`. Docker introspection in Mode 1 is
  out of scope; if needed, it must be a Mode-2 native binary
  capability with explicit operator opt-in.
- **Backup exclusion**: this state file holds a live credential.
  Backup tooling that snapshots the volume must redact or
  exclude `state.json`. The installer's backup runbook calls
  this out explicitly.
- **Log redaction**: the binary never logs `state.nodeToken` in
  plaintext. Telemetry that includes the state object MUST
  redact the token field; verified by a unit test against the
  log-emitter.
- **Rotation on suspected copy**: if an operator suspects the
  state file was copied (host compromise, volume snapshot
  exfiltration, container escape), they revoke the node from
  Admin > Platform Development. The next request from any
  holder of the copied token returns 401 and forces
  re-enrollment.
- **No re-use across nodes** *(partial — see Phase 1+ note)*: each
  Edge Node has its own state directory. The mode + owner read-time
  checks above bound the cross-account leak case. **Cross-container
  fingerprint detection** (the spec's stronger promise — "two
  Edge Node containers sharing a volume both refuse to launch") is
  **Phase 1+**, not Phase 0. The Phase 0 controls in scope today are:
  - **docker-managed volume isolation** (no host bind-mount): two
    containers can only share state by explicit operator
    misconfiguration of compose; the default Mode 1 layout uses
    a dedicated volume per Edge Node container.
  - **dedicated non-root UID** (`dpf:dpf` in the Dockerfile): two
    containers running under the same UID can co-mount but a host
    bind-mount from a different UID is refused by the owner check.
  Phase 1+ will add a process-instance fingerprint stored in
  `state.json` so a second container reading state written by a
  different instance refuses to launch even if mode + owner match.
  That work is tracked as a Phase 1+ enhancement, not a Phase 0
  gate.

Mode 2 (native macOS / Windows) and Mode 4 (TPM-attested, Phase
1+) bypass this downgrade entirely — they use Keychain /
Credential Manager / libsecret / TPM directly.

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

**Phase 0 contract: manual operator action is the only trigger.**

A node moves to `trustState: quarantined` in Phase 0 only when an
operator explicitly quarantines it via Admin > Platform
Development. Implementations and tests in Phase 0 must rely on this
exact contract — no automatic flips, no anomaly-detection wiring,
no re-attestation polling, no heartbeat-miss timer. The Authority
Core surface in Phase 0 exposes a single operator action and
records `quarantinedAt` + `quarantineReason`.

**Phase 1+ planned triggers (out of scope for Phase 0).**

The following triggers are part of the long-term contract but
must NOT ship in Phase 0. Each requires its own design slice and
security review before implementation:

- **Anomaly-detection trigger.** The platform's observation-delta
  analyzer flags a node's submissions (deviance thresholds tuned
  per capability). Requires a baseline-modeling subsystem and a
  per-node anomaly-score table. Out of Phase 0 scope.
- **Re-attestation drift trigger.** Periodic re-attestation
  detects binary-signature mismatch or host-fingerprint drift.
  Requires (a) signed binary distribution per the
  "Release and rollback" section and (b) the fingerprint subsystem
  not yet defined for Phase 0.
- **Missed-heartbeat trigger.** Auto-quarantine after N consecutive
  missed heartbeats beyond the soft-fail window plus an operator-
  configured grace. Requires the soft-fail window subsystem
  ("Soft-fail policy windows" below) to be fully implemented; in
  Phase 0 the window is documented but not enforced server-side.

**Quarantined behavior (applies to any trigger):** the node may
still heartbeat (so operators can see it's alive) but **must not**
submit observations that flow into trusted inventory. Submissions
from quarantined nodes are dropped (or archived to a separate
`QuarantinedSubmission` table if the operator opts in for forensic
review). Quarantine never auto-clears; an operator action is
required to restore trust or revoke.

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

## Edge Node registry (Prisma models — Principal-convergence-aligned)

**AGENTS.md §11 (Principal convergence, 2026-05-09)** requires every
new identity-bearing entity introduced after 2026-05-09 to be modeled
as a `PrincipalAlias` linked to a single `Principal`, not as a
parallel identity table. Edge Nodes are explicitly named in the
convergence target. The schema therefore puts the identity on
`Principal` + `PrincipalAlias` (the existing identity spine at
`packages/db/prisma/schema.prisma:219`) and uses `EdgeNode` as a
**host-attributes side table** keyed by `principalId`. Authorization
decisions resolve on `Principal`; the alias kind tells the platform
which surface authenticated the request.

The convergence layout for an Edge Node identity is:

- `Principal { kind: "edge_node", status, displayName, principalId: "PRN-…" }`
  — the canonical identity row. Used by every authorization decision
  the same way `kind: "human"` and `kind: "agent"` are used today.
- `PrincipalAlias { aliasType: "edge_node", aliasValue: nodeId, principalId }`
  — binds the externally-visible `nodeId` (used in API URLs and
  embedded in the `dpfedge_*` token) to the Principal. `aliasType:
  "edge_node"` is a new value joining the existing set (`user`,
  `employee`, `agent`, `gaid`, `customer_contact`, `email`). The
  underscore form matches the existing aliasType convention; see
  `packages/db/src/edge-node-types.ts` for the canonical constant
  (`EDGE_NODE_ALIAS_KIND`).
- `EdgeNode { principalId @unique, …host attributes }` — host facts
  only. No identity-bearing field that's not derivable from the
  Principal.

```prisma
// EXISTING — packages/db/prisma/schema.prisma:219. Shown for context;
// no change to the model definition. New value added to `kind`:
// "edge_node".
//
// model Principal {
//   id          String           @id @default(cuid())
//   principalId String           @unique
//   kind        String   // "human" | "agent" | "customer" | "edge_node"
//   status      String   @default("active")
//   displayName String
//   aliases     PrincipalAlias[]
//   ...
// }
//
// EXISTING — packages/db/prisma/schema.prisma:230. New value added
// to `aliasType`: "edge_node" (aliasValue holds the stable nodeId).
//
// model PrincipalAlias {
//   id          String    @id @default(cuid())
//   principalId String
//   aliasType   String   // ..., "edge_node"
//   aliasValue  String
//   issuer      String    @default("")
//   ...
// }

// NEW side table. Host-specific attributes only; identity lives on
// Principal + PrincipalAlias per AGENTS.md §11.
model EdgeNode {
  id                    String    @id @default(cuid())
  principalId           String    @unique             // 1:1 with Principal
  nodeId                String    @unique             // stable external id (mirrored to PrincipalAlias.aliasValue where aliasType="edge_node")
  platform              String    // darwin | win32 | linux
  installMode           String    // native | container-host | container-vm
  version               String
  status                String    // pending | active | offline
  trustState            String    // pending | trusted | quarantined | revoked
  lastSeenAt            DateTime?
  capabilities          Json
  metadata              Json?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  // Enrollment lifecycle.
  enrollmentTokenId     String?           // FK to BootstrapToken.id; cleared after consumption
  enrolledAt            DateTime?         // set when enroll succeeded
  approvedAt            DateTime?         // null until operator (or auto-approve policy) trusts the node
  approvedByPrincipalId String?           // FK to Principal who approved; null for auto-approve
  tokenRotatedAt        DateTime?         // last successful node-token rotation
  quarantinedAt         DateTime?
  quarantineReason      String?
  revokedAt             DateTime?
  revocationReason      String?

  principal      Principal @relation(fields: [principalId], references: [id], onDelete: Cascade)
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
and POST results in. Wire shape:

```
POST /api/v1/edge/discovery-runs
Authorization: Bearer dpfedge_<token>

{
  "runKey": "uuid-v4-from-the-edge-node",
  "agentMode": "native-darwin",
  "agentVersion": "0.1.0",
  "observedAt": "2026-05-09T12:00:00Z",
  "capabilities": ["discovery.network"],
  "items": [...],
  "relationships": [...],
  "warnings": [...]
}
```

**Identity attribution rule (CRITICAL).** The persisted
`edgeNodeId`, `nodeId`, `principalId`, and `sourceSlug` columns on
the resulting `DiscoveryRun` row **come exclusively from the
authenticated token's resolution context** (`resolveEdgeNodeAuth`
in `apps/web/lib/auth/edge-node-token.ts`). Body fields that
shadow identity attributes are either:

- **not present in the wire shape** (the canonical envelope above
  omits `nodeId`, `edgeNodeId`, `principalId` entirely — server
  reads them from the bearer token), or
- **informational only and verified before use.** If a future
  envelope revision re-introduces a body `nodeId` for diagnostic
  echo purposes, the server compares it against the auth-resolved
  `nodeId` and returns `401 nodeId_mismatch` on any divergence.
  The body field is **never** the source of truth for attribution.

This rule closes a class of impersonation attacks where a compromised
or curious node holding a valid token for node A submits observations
claiming to come from node B by writing `B` in the body. The token
is the only authority on which Edge Node submitted the run.

The earlier proposed envelope above (older draft) included
`"nodeId": "edge_a1b2c3"` in the request body; that shape is
**deprecated** by this rule. The current implementation in
`apps/web/app/api/v1/edge/discovery-runs/route.ts` does not include
a body `nodeId` field — the Zod schema rejects unknown keys via
`.passthrough()` semantics on the wire shape, and only the
auth-resolved identity reaches `persistSubmittedDiscoveryRun`.

Alternatively, the same ingestion can be exposed as an MCP tool
(`submit_discovery_observations`) that goes through the
`/api/mcp/v1` machinery for governance, audit, and rate-limiting.
For Phase 0 the REST surface is the chosen path — see "REST
ingestion controls (Phase 0)" below for the controls the REST path
must add to compensate for not riding on the MCP envelope.

**Server-side ingestion pipeline (corrected):** Edge Node
submissions must **not** rerun local collectors. Today's
`executeBootstrapDiscovery` is portal-context code that invokes
host/docker/network/etc. collectors *inside the portal container* —
exactly the path the Edge Node exists to escape. For submitted
observations, the server skips collector execution and goes
straight to normalization + persistence:

```
Edge Node submission
  → authenticate (resolveEdgeNodeAuth) → { edgeNodeId, nodeId,
                                            principalId, trustState }
  → validate envelope (Zod schema, freshness window,
                       payload size caps, rate-limit gate,
                       runKey idempotency check)
  → normalizeDiscoveredFacts(submittedItems, submittedRelationships)
  → inferCrossCollectorRelationships
  → persistSubmittedDiscoveryRun({
       edgeNodeId,     // from auth, NEVER from body
       agentMode,      // from body (informational; not identity)
       agentVersion,   // from body (informational; not identity)
       submittedOutput,
       trigger: "edge_node",
     })
  → Postgres (DiscoveryRun + DiscoveredItem + DiscoveredRelationship
              → InventoryEntity + InventoryRelationship)
  → graph projection (InfraCI + relationship types — the in-Postgres
    graph_node/graph_edge mirror since BET-5 (BI-A1E864A5) retired Neo4j)
```

`persistSubmittedDiscoveryRun` is a sibling of
`persistBootstrapDiscoveryRun` that takes a *prepared* observation
set instead of running collectors. The downstream
deduplication / promotion / graph-projection logic (in-Postgres
since BET-5) is shared between
them; only the source of the observation set differs. This is the
function this epic introduces alongside the
`/api/v1/edge/discovery-runs` route.

### REST ingestion controls (Phase 0)

The MCP transport at `/api/mcp/v1` provides governance, audit, rate
limiting, and replay protection by construction. The Phase 0 REST
path at `/api/v1/edge/*` chose REST first for the reasons in
"Open question resolutions" — but that choice does not exempt the
REST path from those controls. They must be added explicitly. The
controls below are **binding** for Phase 0 and **must not** be
deferred into "we'll add it when we move to MCP."

- **Per-node rate limits.** Token-bucket gate per
  `EdgeNodeToken.id` (or `EdgeNode.id`, whichever maps to the
  rotating identity). Default Phase 0 ceilings:
  - `/api/v1/edge/heartbeat`: 12 req/min per node (1 every 5s
    sustained; bursts allowed up to 5 req/sec for 10s).
  - `/api/v1/edge/discovery-runs`: 4 req/min per node, 60 req/hour
    sustained. Discovery is meant to be a sweep, not a stream.
  - `/api/v1/edge/enroll`: 1 req per bootstrap-token per session;
    single-use enforcement already covers this server-side via the
    `consumedByEdgeNodeId @unique` constraint.
  Exceeding the bucket returns `429 Too Many Requests` with a
  `Retry-After` header; audit records every 429.
- **Payload size caps.** Hard limits enforced by the Zod schema on
  the route handler **before** parsing the body:
  - `items` array: ≤ 10,000 entries per run (already enforced).
  - `relationships` array: ≤ 20,000 entries per run (already
    enforced).
  - Single-item `rawData`: ≤ 64 KB (string-encoded). Larger
    payloads are split across multiple submissions.
  - Total request body: ≤ 5 MB. Above that, the Next.js route
    handler returns `413 Payload Too Large` before parsing.
- **Run idempotency / replay protection.** Edge Nodes generate a
  `runKey` (UUID v4) per discovery sweep. The server enforces
  uniqueness on the `(edgeNodeId, runKey)` pair:
  - First submission with a given `(edgeNodeId, runKey)` is
    persisted normally.
  - Re-submission of the same pair (e.g. network retry after a
    response timeout) returns `200 OK` with the prior result
    snapshot — idempotent. The Authority Core does NOT re-process
    the run.
  - Submission with a `runKey` already used by a *different*
    `edgeNodeId` is silent: each node has its own runKey
    namespace, so the schema's existing `runKey @unique` on
    `DiscoveryRun` must be revised to `@@unique([runKey,
    edgeNodeId])` in a follow-up migration. **This is a
    Phase 0 schema follow-up gating discovery-run ingestion.**
- **Replay protection on the auth credential.** Bearer tokens
  themselves are not nonce-protected in Phase 0 (per the Phase 0
  token-binding posture). A stolen token can replay until
  rotation; the heartbeat-rotation cadence and the
  trust-state-based quarantine path are the compensating controls.
  Phase 1+ DPoP / mTLS adds per-request replay protection by
  construction.
- **Failure-audit requirements.** Every authenticated request
  writes a `ToolExecution` row per AGENTS.md §8, including
  failures. The minimum audit surface for the REST routes:
  - 401 / 403: log `edgeNodeId` (if resolved), the failing scope,
    and the reason code (`token_not_found`, `node_revoked`,
    `scope_disallowed`, `node_quarantined`, etc.). Never log the
    bearer plaintext.
  - 429: log `edgeNodeId`, the route, and the bucket-state
    diagnostic. Aggregated counters surface in the operator UI
    so an Edge Node burning through its budget is visible.
  - 5xx from `persistSubmittedDiscoveryRun`: log full error with
    stack trace **server-side only**; client response masks the
    internals.
- **Freshness window.** The `observedAt` field on submissions must
  fall within an **asymmetric** window of server time:
  - **Past bound** default 24h, env `DPF_EDGE_FRESHNESS_PAST_SEC` —
    matches § Soft-fail policy windows (queue-flush submissions
    stamp the original `observedAt`, which may be up to 24h old).
  - **Future bound** default 5min, env
    `DPF_EDGE_FRESHNESS_FUTURE_SEC` — NTP-tightened; healthy
    NTP-synced LAN hosts have sub-second skew, so an `observedAt`
    more than minutes ahead is almost always a clock-sync problem
    on the Edge Node side.
  Outside either bound returns `400 stale_observation`. The audit
  row surfaces signed `deltaMs` and a `direction` field (`past` |
  `future`) so operators can distinguish queue-replay from clock
  skew at a glance. Prevents back-dated submissions that could
  pollute inventory history; also flags misconfigured NTP early.
  Operators may widen / tighten either bound at runtime via env;
  invalid values fall back to defaults so a typo doesn't disable
  the gate.

Phase 1+ MCP migration: when `submit_discovery_observations`
ships as an MCP tool, the controls above migrate into the MCP
governance plane and the REST path can be deprecated. Until
then, every control listed above is a Phase 0 gate.

#### Implementation status (Phase 0 gates, current runtime truth as of 2026-05-12)

The controls above are the Phase 0 gates the ingestion path must
satisfy before Phase 0 is considered complete. As of 2026-05-12
all gates have either landed on `main` or are explicit
risk-accepted-for-Phase-0 items. The table below captures the
PR that closed each gate so a reader can audit the exact change
that satisfied it.

| Control | Status (post #523 + #527 + #528) | Where |
|---|---|---|
| Auth gate (resolveEdgeNodeAuth) | **Implemented** | `app/api/v1/edge/discovery-runs/route.ts`; `app/api/v1/edge/heartbeat/route.ts`; `app/api/v1/edge/enroll/route.ts` (per #498) |
| Body schema validation (Zod) | **Implemented** | same; note `.passthrough()` on item / relationship schemas is intentional for forward-compat but allows unknown fields through |
| Freshness window (±24h on `observedAt`) | **Implemented** (#513) | same; fires before DB lookup |
| `(edgeNodeId, runKey)` idempotency lookup | **Implemented** (#513) | same; backed by `@@unique([edgeNodeId, runKey])` + partial unique on bootstrap path |
| Persist via `persistSubmittedDiscoveryRun` | **Implemented** (#521) | route now calls `persistSubmittedDiscoveryRun(prisma, { edgeNodeId, nodeId, runKey, submittedOutput })` and returns 201 with the persistence summary on first-time submission; 200 with `idempotentReplay: true` when the `(edgeNodeId, runKey)` lookup already has a row |
| Per-node rate limits (12/min heartbeat, 4/min discovery) | **Implemented** (#522) | sliding-window limiter at `apps/web/lib/edge-node/rate-limit.ts`; per-(route, edgeNodeId) buckets; returns 429 with `Retry-After` and writes an audit row |
| Payload size caps (5 MB total body, 64 KB per-item `rawData`) | **Implemented** (#523) | two-stage body cap: declared `Content-Length` first (no buffering), then buffered byte count via `arrayBuffer()`; per-item `rawData` cap fires after Zod validation but BEFORE the idempotency DB lookup, so oversized payloads never touch the DB |
| Failure audit to `ToolExecution` (401 / 403 / 413 / 429 / 5xx) | **Implemented** (#517) | `apps/web/lib/edge-node/audit.ts` exposes `writeEdgeNodeAudit` and a `setToolExecutionCreateOverride` test seam; all three REST routes (enroll, heartbeat, discovery-runs) write `userId: "system:edge-node"` rows with `executionMode: "edge-rest"` |
| Storage downgrade controls (state file `0600` + owner-UID check) | **Implemented** (#515) | `services/edge-node/src/state.ts` calls `verifyStatePerms()` at read time on POSIX hosts; refuses to load when the file is group/world-readable or owned by a different UID |
| Replay protection on bearer credential | **Phase 0 risk accepted** | bearer tokens aren't nonce-protected; the heartbeat-rotation cadence + grace window bound exposure to ~1h. Phase 1+ DPoP / mTLS closes this structurally. |

Phase 0 admin surface is also landed:

| Surface | Status | Where |
|---|---|---|
| Admin > Edge Nodes UI (list + bootstrap-token issuance + approve / quarantine / revoke) | **Implemented** (#527) | server component at `apps/web/app/(shell)/platform/edge-nodes/page.tsx`; client at `apps/web/components/platform/edge-nodes/EdgeNodesAdminClient.tsx`; server actions at `apps/web/lib/actions/edge-nodes.ts` (gated by `manage_platform`) |
| End-to-end lifecycle verification script | **Implemented** (#528) | `services/edge-node/scripts/verify-lifecycle.ts` walks enroll → heartbeat → discovery-runs (with idempotent replay) using `undici`; runbook at `docs/install/verification-runbook.md` § 7 |

The replay-protection row is the only Phase 0 item that remains
"risk accepted" rather than "implemented" — that one is
structurally a Phase 1+ change (DPoP or mTLS) and is tracked as
such in the roadmap rather than as a Phase 0 follow-up.

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

## Open question resolutions

The 2026-05-09 research stub deferred a set of open questions to
spec finalization. They are resolved below for the *first* slice
(`capability.discovery.network`). Resolutions that bind future
capability slices are marked as durable; resolutions that bind
only the first slice are marked as scoped, so future slices can
revisit without re-opening the doctrine.

### Edge Node lifecycle

- **Language for the binary** *(resolved 2026-05-16 — Go for
  Modes 2 / 4; Mode 1 retrofit follows. See
  [`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md)
  for the full ADR.)*:
  - **Spec's original resolution (durable, now reaffirmed):** Go.
    Mature cross-compilation, static linking, ~5 MB binary target,
    well-known signing/notarization toolchains on every platform,
    battle-tested in the comparators (Tailscale, Cloudflare Tunnel
    `cloudflared`, HashiCorp Boundary are Go and closer to what
    we're building).
  - **What actually shipped in Phase 0:** Node.js / TypeScript.
    PR #501 (A3 — Edge Node service skeleton) implements the Mode 1
    container service in TypeScript at
    [`services/edge-node`](../../../services/edge-node), built on
    `node:24-alpine`. Container image size is ~150 MB (vs Go's
    ~5 MB target). This was a divergence from the spec's resolution
    and was not amended in the spec before merge.
  - **Resolution (2026-05-16):** Modes 2 (macOS native) and 4
    (Windows native) ship in Go. Mode 1 continues running the
    Phase-0 TypeScript service on `main`; a Mode 1 Go retrofit is
    tracked as `BI-EDGE-XP-04-MODE1-GO-RETROFIT`, gated on Mode 4
    verification passing on real Windows hardware. The interim
    period (Mode 1 = TS, Modes 2 / 4 = Go) is bounded by a new
    wire-contract test suite at
    `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts`
    that ships with the first Mode 4 slice — drift between the two
    implementations becomes a CI failure, not a runtime surprise.
    Rationale, trade-off matrix, and validation gates live in
    [`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md).
  - **Why this matters for security review:** the Phase 0 storage
    downgrade controls (Phase 0 storage downgrade — Linux container
    Mode 1) are scoped to the Node.js container shipped in #501.
    The Go retrofit for Mode 1 must re-apply those controls
    (non-root UID, 0600 perms, owner-UID read-time check, volume
    isolation, no Docker socket, backup exclusion, log redaction)
    before it ships; they are not transferable for free. Modes 2 /
    4 bypass the downgrade entirely — they use Keychain /
    Credential Manager directly per "Token namespaces and
    lifecycle" above.
- **Linux default networking** *(scoped to first slice)*:
  **`network_mode: host`** (observer-only). LLDP/CDP receive and
  segregated scanner roles require `macvlan`; that's a follow-on
  capability slice when the need is real, not now. `network_mode:
  host` is simpler, has lower blast radius, and is sufficient for
  the network-discovery first slice. Documented Linux capabilities
  required: `CAP_NET_RAW` (raw sockets for `arp`/ICMP) and
  `CAP_NET_ADMIN` (interface enumeration). No `--privileged`. No
  `CAP_SYS_ADMIN`. The least-privilege baseline matches the
  Falco container guidance.
- **Binary distribution** *(durable)*: **signed multi-platform
  GitHub Release assets** plus checksums and signatures. Not bundled
  inside the GHCR portal image. Reasons: (a) installer is the
  natural distribution channel and already has signing primitives
  for `install-dpf.ps1` / `install-dpf.sh`; (b) the binary's
  release cadence is decoupled from the portal's; (c) the GitHub
  Release surface gives us a clean attestation trail for community
  auditors who don't want to trust the portal image build.
- **Update path** *(durable)*: **pull-on-schedule via the
  installer's lifecycle scripts**. The binary itself does **not**
  self-update — that's a privileged operation and we are not
  inviting an in-binary updater into the surface. `dpf-start` /
  `dpf-update` (Linux/macOS) and `dpf-update.ps1` (Windows) check
  the GitHub Release feed, verify signatures, atomically replace
  the binary, and restart the platform service manager unit. The
  Authority Core can *signal* an Edge Node that an update is
  available (heartbeat response field `availableVersion`); the
  operator's installer is what acts on the signal.
- **macOS LaunchAgent vs LaunchDaemon** *(durable)*:
  **`LaunchDaemon` (system-wide) by default; `LaunchAgent`
  (per-user) as an opt-in.** The Edge Node is a *machine*
  principal, not a *user* principal — running it under
  LaunchDaemon matches that posture and avoids the "agent stops
  when no user is logged in" failure mode. Per-user mode is
  available for environments where the operator explicitly wants
  it (e.g. a developer's MacBook where the Mac is single-user and
  the agent should pause when they log out).
- **macOS entitlements** *(durable)*: minimum set is
  `com.apple.security.network.client` (outbound to Authority Core),
  `com.apple.security.network.server` (for the local capability
  envelope where the node may serve gateway functions in later
  slices). No `com.apple.developer.networking.multicast` (raw
  multicast is not part of the first slice). No
  `vmnet.framework` (that's for VM-host networking; we read from
  the host directly). The binary is Developer ID-signed and
  notarized; the installer pins the expected signing identity and
  fails closed on mismatch.
- **Windows service vs scheduled task** *(durable)*: **Windows
  Service.** Always running, restarts on crash, integrates with
  Windows Event Log, matches the LaunchDaemon decision on macOS.
  Scheduled task is the wrong shape — a "triggered on schedule"
  agent cannot honor heartbeat soft-fail windows or respond to
  Authority Core pushes.

### Authority and trust

- **Token scope catalog** *(durable)*: finalized as the list in
  the "Token model" section above. Adding a new scope requires a
  schema migration (the scope is stored in the token row) and an
  AGENTS.md update. Removing a scope requires evidence that no
  Edge Node in the field still holds it.
- **Enrollment ceremony** *(durable)*: finalized as the
  ceremony described in "Enrollment, rotation, and lifecycle"
  above — bootstrap token → enroll endpoint → node token, with
  auto-approve for local-host installer-issued tokens and
  operator approval for remote nodes.
- **Quarantine / revocation triggers** *(durable)*: finalized as
  the trigger list under "Quarantine" and "Revocation" above —
  anomaly detection, manual operator action, re-attestation
  failure, missed heartbeats beyond grace.
- **Soft-fail policy windows** *(durable)*: finalized as the
  per-scope table under "Soft-fail policy windows" above.
  Operator-configurable, with deny-by-default for high-stakes
  scopes (`mcp:gateway`, `a2a:gateway`).

### Capabilities and protocol gatewaying

- **MCP gateway** *(deferred)*: not part of the first slice.
  The architecture must not preclude it — the
  `capability.mcp.gateway` row in the capability envelope is the
  forward-compatibility hook. The grant composition rule (inner
  server's grants × Edge Node's scope × user's grants, intersect)
  is captured here so the implementer of that future slice can
  see the contract.
- **A2A gateway** *(deferred)*: same shape as MCP. Behind the
  `dpfedge_*` model and the Authority Core's policy. Waits on
  the public A2A protocol contract stabilizing before
  implementation begins.
- **Telemetry parity** *(scoped to first slice)*: `windows_exporter`
  and `node-exporter` Prometheus scrapes stay in place until the
  Edge Node ships and a verification report confirms host-metrics
  parity. The retirement of those exporters is owned by the
  installer-parity plan, not this one — see
  [docs/superpowers/plans/2026-05-09-macos-linux-native-support.md](../plans/2026-05-09-macos-linux-native-support.md)
  "Network sweep data path" decision.

### Schema and ingestion

- **Schema additions** *(durable)*: confirmed; revised above to
  honor Principal convergence (AGENTS.md §11). `DiscoveryRun`
  gains an optional `edgeNodeId` FK in the same migration that
  introduces `EdgeNode`, `BootstrapToken`, `EdgeNodeCapability`,
  and the new `kind: "edge_node"` and `aliasType: "edge_node"`
  values for Principal / PrincipalAlias.
- **Endpoint vs MCP tool** *(durable)*: **REST first
  (`/api/v1/edge/*`), MCP tool follow-up**. Reasoning: the first
  Edge Node populations are non-MCP-aware (the binary itself is a
  custom HTTP client) and REST is the straightforward surface. An
  MCP tool (`submit_discovery_observations`) can wrap the same
  `persistSubmittedDiscoveryRun` function later without changing
  the contract on the wire. Per-mode HTTP-client truth:
  - **Mode 1 (Linux container, Phase 0 shipped):** TypeScript /
    `undici` per [`services/edge-node`](../../../services/edge-node).
  - **Modes 2 / 4 (native, planned):** Go's `net/http`, per the
    runtime-decision ADR
    ([`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md)).
  - **Mode 1 Go retrofit:** tracked as `BI-EDGE-XP-04-MODE1-GO-RETROFIT`,
    gated on Mode 4 verification passing on real Windows hardware.
  Historical note: the pre-#501 draft of this paragraph said "custom
  Go HTTP client" — that was the original Go resolution which was
  drifted from in Phase 0 and is now reaffirmed for Modes 2 / 4 with
  the Mode 1 retrofit as a follow-on.

## Research and Benchmarking

Per AGENTS.md §10. For each comparator: what we read of the data
model and trust model (not the marketing), what pattern we adopted,
what we rejected, anti-patterns we noted, and what gap this design
fills that the comparator doesn't.

### Open source

**osquery + Fleet** (Facebook → Linux Foundation, Apache-2.0).
The closest architectural analogue we have. `osqueryd` runs as a
host daemon; identity is a `node_key` per host, issued in exchange
for an `enroll_secret`; the daemon posts JSON results to a TLS
endpoint (Fleet, Kolide, etc.). The `enroll_secret` is shared and
long-lived (per-team); the `node_key` is per-host and rotates.

- **Adopted:** the enrollment-secret → node-key handshake. Our
  `bootstrap-token → dpfedge_* node-token` flow is the same shape
  with two corrections — bootstrap tokens are **one-time** (not
  shared / long-lived), and node tokens **rotate via heartbeat**
  (not stay-fixed-per-host).
- **Adopted:** server-side normalization. osquery agents emit raw
  query results; Fleet normalizes server-side. Our
  `persistSubmittedDiscoveryRun` mirrors this: the Edge Node
  reports observed facts, the Authority Core normalizes via
  `normalizeDiscoveredFacts` + `inferCrossCollectorRelationships`.
- **Rejected:** osquery exposes a SQL surface as the data model.
  We don't — discovery results are concrete objects (NICs, ARP
  entries, software inventory) flowing through
  `DiscoveredItem` / `DiscoveredRelationship` →
  `InventoryEntity` / `InventoryRelationship`. The SQL surface is
  powerful but blurs the line between query and observation; for
  DPF the observation contract is the value.
- **Anti-pattern noted:** shared enrollment secrets in CI configs
  (a real-world osquery footgun). Our bootstrap-token policy is
  **never reusable, ≤15 min TTL, single-use**. The Tailscale
  one-off-key pattern beat the shared-secret pattern here, and we
  followed Tailscale's lead.
- **Gap filled:** osquery is just a daemon — no protocol gateway
  capability, no MCP/A2A bridge, no policy enforcement edge.
  The Edge Node capability envelope is intentionally broader.

**Tailscale tailnet client** (Tailscale Inc., BSD-3 for the open
client). Identity = node-bound WireGuard key, authenticated by an
auth key that can be one-off / reusable / ephemeral / pre-approved
/ tagged.

- **Adopted:** the auth-key taxonomy. Our bootstrap-token model
  borrows directly: bootstrap tokens are single-use,
  short-lived, scope-bound to `edge:enroll`, optionally
  pre-approved for the local-host case. The "tag" concept maps
  to our capability-advertisement: a node enrolled with a
  particular bootstrap-token scope can only advertise the
  capabilities that bootstrap-token policy permits.
- **Adopted:** auto-approve for the local host, operator
  approval for everything else. Tailscale's "auth-key with
  pre-approved=true" is the same pattern; we apply it only to
  the installer-issued bootstrap-token for the DPF host itself.
- **Rejected:** Tailscale's coordination-server-as-IdP model
  (where the tailnet IS the auth surface). The Edge Node is
  *never* an IdP — that's the Identity Edge's responsibility per
  the enterprise auth spec.
- **Anti-pattern noted:** auth keys that don't rotate. Tailscale
  has dealt with this via expiry; we deal with it via
  heartbeat-driven rotation built into the node-token contract.

**Cloudflare Tunnel (`cloudflared`)** (Cloudflare, BSD-3). Identity
= a long-lived `cert.pem` issued at tunnel-creation time. Outbound
HTTP/2 multiplex to the Cloudflare edge.

- **Adopted:** outbound-only connection posture. The Edge Node
  initiates all connections to the Authority Core; the Authority
  Core never has to reach into the customer network. This is the
  same model and it's the right one for an on-prem-friendly
  deployment.
- **Rejected:** the long-lived `cert.pem` as the only credential.
  A multi-year credential with no rotation is the
  "shared API key in CI" anti-pattern just dressed up. Our
  node-token rotates per heartbeat (default 24h).
- **Gap filled:** Cloudflare Tunnel is a single capability
  (reverse proxy). The Edge Node is a capability *envelope*.

**Wazuh agent** (Wazuh Inc., GPL-2.0). HIDS/SIEM agent that
enrolls to a manager via `agent-auth`. Per-agent UUID + agent
password is the long-lived secret.

- **Adopted:** per-agent unique identity that's *not* the
  enrollment credential. Our `nodeId` / `principalId` is the
  durable identity; the rotating node-token is the credential.
- **Anti-pattern noted:** Wazuh's agent password is long-lived
  and stored in plaintext on the agent host. We store the
  node-token in the OS-native secure store (Keychain on macOS,
  Credential Manager on Windows, libsecret on Linux) and never
  in plaintext config. This is one of the spec's security-review
  red lines.

**Falco** (CNCF, Apache-2.0). Runtime security agent using eBPF
or kernel modules for syscall capture. Container-friendly, runs
under Kubernetes as a DaemonSet.

- **Adopted:** the "minimum-capability container" baseline.
  Falco documents exactly which Linux capabilities it needs in
  container mode; we mirror that discipline by enumerating
  `CAP_NET_RAW` + `CAP_NET_ADMIN` and refusing `--privileged`.
- **Rejected:** Falco's tight Kubernetes coupling. The Edge Node
  runs on bare-metal hosts, Docker Desktop hosts, and inside
  Kubernetes nodes — the deployment-target-neutrality rule (see
  "Deployment target neutrality" above) is non-negotiable.

**Netbox-Agent / Nautobot** (BSD-3). Small Python agent (Netbox)
or larger Django framework (Nautobot) for network-source-of-truth
inventory.

- **Adopted:** the "agent does discovery, server is the SoT"
  separation. Netbox-Agent runs `dmidecode` / `lshw` / `ipmitool`
  on the host and posts results via API token. We do the same:
  Edge Node runs collectors, posts to
  `/api/v1/edge/discovery-runs`, Authority Core is the SoT.
- **Rejected:** authentication via a single API token. Netbox's
  API tokens are user-scoped, long-lived, and one-token-per-user.
  Our `dpfedge_*` tokens are **per-node bearers** (Phase 0;
  Phase 1+ adds cryptographic binding per "Token model"),
  short-lived, and rotate per heartbeat — the difference matters
  because the Edge Node is an *unattended machine principal*,
  not a user.

**Steampipe** (Turbot, MPL-2.0). SQL-over-cloud-APIs.

- **Rejected wholesale:** Steampipe is a query layer over cloud
  control planes, not a host-resident agent. It's the wrong
  architectural class for what the Edge Node does. Useful only
  as a contrast point for what we are *not* building.

**authentik** (already chosen per the enterprise auth spec). The
identity edge. The Edge Node never duplicates this surface.

### Commercial

**Auvik** (network monitoring SaaS). Polling-based via SNMP/CDP,
agentless for most cases, with an optional collector that runs
on a customer-managed host.

- **Adopted (by contrast):** the collector pattern when SNMP is
  insufficient. Auvik's collector is the analogue of our
  "Edge Node running on a customer host because the cloud /
  container can't see the LAN truthfully." The lesson: an
  edge component is **necessary**, not nice-to-have, when host
  topology truth matters.
- **Rejected:** Auvik's data flow is cloud-tenant-bound — the
  collector phones home to Auvik's SaaS. DPF is single-tenant
  on-prem; the Authority Core *is* the customer's tenant.

**Lansweeper** (asset discovery). Hybrid agent / agentless.

- **Adopted (by contrast):** hybrid is the right answer.
  Agentless (SNMP, WMI, SSH) gets you the easy 80%; an agent
  gets you the hard 20% (truthful per-host inventory of
  installed software, running processes, real NICs). The Edge
  Node is that hard 20%.

**ScienceLogic SL1** (ITOM). MID-server pattern — a
customer-hosted collector that fans out to monitored devices.

- **Adopted:** the MID-server pattern is exactly what the Edge
  Node is, in DPF's vocabulary. Customer hosts run the agent;
  Authority Core is the central management plane.

**Twingate** (zero-trust network access). Connector-based.
Per-connector credential, short-lived.

- **Adopted:** the connector-as-machine-principal model. Each
  Twingate connector has its own credential; same as our per-node
  `dpfedge_*` token.

**Cloudflare Zero Trust** (WARP + `cloudflared`). Combines the
identity-aware Access proxy with the Tunnel architecture above.

- **Adopted (by contrast):** the lesson that *identity* and
  *connectivity* are separable concerns. The Edge Node owns
  connectivity (host-side); the Identity Edge (authentik) owns
  identity. Don't conflate them.

**Datadog Network Performance Monitoring**: agent-based, with the
Datadog Agent running on every host.

- **Adopted (by contrast):** the agent-per-host model is the
  right one for truthful host-level observation. We're not
  rebuilding Datadog, but the architectural posture is the same.

### Patterns and anti-patterns

**Patterns adopted across comparators:**

1. Bootstrap-credential → node-credential handshake (osquery,
   Tailscale, Wazuh).
2. Outbound-only connectivity from edge to core (Cloudflare
   Tunnel, Wazuh, Tailscale).
3. Server-side normalization of observations (Fleet, Nautobot).
4. Per-machine-principal credentials (Tailscale, Twingate, Wazuh).
5. Minimum-capability containers (Falco).

**Anti-patterns rejected across comparators:**

1. Shared enrollment secrets stored in CI config (osquery
   real-world failure mode). → Bootstrap tokens are one-time.
2. Long-lived, never-rotating machine credentials (Cloudflare
   Tunnel `cert.pem`, Wazuh agent password). → Node tokens
   rotate per heartbeat.
3. Plaintext credential storage on the agent host (Wazuh
   default). → OS-native secure store, never plaintext config.
4. Agent-as-IdP conflation (early Tailscale conceptual
   confusion). → Edge Node is **never** an IdP.
5. Forking the agent per deployment target (avoidable trap).
   → Deployment-target-neutrality is a binding contract in the
   spec.

**Gaps this design fills that no single comparator addresses:**

1. **Single agent, multiple capability classes** — discovery,
   metrics, MCP gateway, A2A gateway, policy enforcement,
   tunnel. No comparator covers this envelope.
2. **Capability advertisement governed by a central policy
   surface** — the Authority Core can disable individual
   capabilities per node from a central UI.
3. **Principal convergence** — the Edge Node identity lives on
   the same `Principal` spine as `human`, `agent`, and
   `customer`. No comparator has this discipline.

## Security review summary

The maturity gates required a heavy security review. Findings,
in order of severity:

### Critical (must be closed before Phase 0 lands)

- **Node-token storage on the host.** Plaintext in config files
  is the Wazuh anti-pattern. **Resolution (preferred):** OS-native
  secure store — Keychain on macOS, Credential Manager on Windows,
  libsecret on Linux. The binary reads the token from secure
  storage at startup, never writes it to disk in plaintext.
  **Resolution (Phase 0 Mode 1 fallback):** a 0600 file in a
  container-private volume, with the full controls in the
  "Phase 0 storage downgrade" section above (non-root UID, no
  Docker socket mount, backup exclusion, log redaction, rotation
  on suspected copy). **This is an explicit downgrade**, not the
  target posture; Modes 2 / 4 use the OS-native store directly.
- **Bootstrap token reuse.** The osquery footgun.
  **Resolution:** every bootstrap token is **single-use**,
  enforced server-side by the `consumedAt` / `consumedByEdgeNodeId`
  columns on `BootstrapToken`. Re-use attempt returns 409 with a
  hard audit-log entry; the operator must explicitly re-issue.
- **Auto-approve scope creep.** Auto-approve is convenient on
  the local host, dangerous everywhere else. **Resolution:**
  auto-approve fires only when the bootstrap token was issued by
  the local installer for the local-host Edge Node, and only
  with matching host fingerprint. Any mismatch falls back to
  operator approval. Configurable but defaulted-secure.
- **Token impersonation by copy (Phase 0).** A copied
  `dpfedge_*` token impersonates the node because Phase 0 has
  no cryptographic token binding. **Resolution (Phase 0):** the
  compensating controls listed in the "Phase 0 token-binding
  posture" subsection — short TTL, heartbeat rotation, audit +
  anomaly signals, no re-enrollment shortcut.
  **Resolution (Phase 1+):** the upgrade path in the same
  subsection — mTLS / DPoP / platform-attested keys. This finding
  is **accepted as a Phase 0 risk** with the compensating
  controls; **moves to "Critical, must close" before Phase 2
  (macOS native binary) ships**, because Mode 2 is the path that
  most plausibly handles tokens that escape the container
  boundary.
- **Ingestion attribution by body.** A node with a valid token
  for Edge Node A could claim observations from Edge Node B by
  shadowing `nodeId` in the request body. **Resolution:** the
  ingestion route reads `edgeNodeId`, `nodeId`, and `principalId`
  **only** from `resolveEdgeNodeAuth`. The Zod schema for
  `POST /api/v1/edge/discovery-runs` does not include identity
  fields. See "Identity attribution rule" in the ingestion
  contract section.

### Important (must be addressed in Phase 0 or Phase 1)

- **Quarantine bypass.** A quarantined node could try to flush
  observations through `/api/v1/edge/discovery-runs` anyway.
  **Resolution:** the route checks `trustState` per request;
  `quarantined` returns 403 (or archives to `QuarantinedSubmission`
  if the operator has forensic-review enabled). Audit-logged.
- **Soft-fail policy abuse.** A compromised Edge Node could
  pretend the Authority Core is unreachable to extend soft-fail
  windows indefinitely. **Resolution:** the binary reports its
  *attempted* Authority Core reachability in every heartbeat;
  the Authority Core can see "this node claimed offline for 48h
  but the network never went down" and quarantine it. The
  soft-fail windows are also operator-configurable per scope so
  high-stakes scopes (`mcp:gateway`, `a2a:gateway`) deny on
  Authority Core unreachable regardless. Phase 0 note:
  enforcement of the soft-fail-window timers is a Phase 1 item
  per "Quarantine — Phase 1+ planned triggers" above; Phase 0
  documents the windows but does not auto-trigger on
  reachability claims.
- **Binary tampering.** A modified Edge Node binary could
  fabricate observations. **Resolution (Phase 0):** binary is
  signed (Developer ID on macOS, Authenticode on Windows,
  GPG/Sigstore on Linux) and the installer pins the expected
  signing identity. **Phase 0 limit:** the spec does NOT
  ship automatic re-attestation quarantine in Phase 0 — that
  belongs to the "Phase 1+ planned triggers" list in the
  Quarantine section. Phase 0 relies on signed distribution +
  manual operator quarantine when an operator sees evidence of
  tamper. The auto-quarantine-on-binary-hash-mismatch flow is
  Phase 1+.
- **Linux capability surface.** Documented above:
  `CAP_NET_RAW` + `CAP_NET_ADMIN`, no `--privileged`, no
  `CAP_SYS_ADMIN`. The container variant's compose definition
  pins these and refuses to start with broader capabilities.
- **REST ingestion controls.** REST chose Phase 0 — see "REST
  ingestion controls (Phase 0)" in the ingestion contract
  section for the binding list (per-node rate limits, payload
  size caps, `runKey` idempotency, failure audit, freshness
  window). Phase 1+ MCP migration moves these into the MCP
  governance plane.

### Acceptable risks (documented, not blocked)

- **Local-host Edge Node trust without operator approval.** A
  user on the DPF host who can drop a fake bootstrap token in
  the installer's path could enroll a fake local-host node.
  Accepted because (a) that user already has the privileges
  needed to subvert the installer in many other ways, and
  (b) the local-host fingerprint check makes drive-by exploits
  hard.
- **Heartbeat-driven token rotation creates a denial-of-service
  vector if the Authority Core is down.** Accepted because the
  soft-fail policy windows are designed to handle exactly this,
  and heartbeat retries with backoff mean the node doesn't
  hammer the Authority Core on recovery.
- **Phase 0 bearer-token replay during the rotation window.** A
  copied token is valid until rotation; the heartbeat cadence
  + rotation-grace bound the exposure window to approximately
  one hour. Accepted for Phase 0 with the documented
  compensating controls; Phase 1+ token binding closes this
  hole structurally.

### Audit-trail consistency

Every Edge Node submission writes a `ToolExecution` row (per
AGENTS.md §8 — "Every tool call writes to `ToolExecution`")
plus a `DiscoveryRun` row tying back to the `edgeNodeId`. The
two together let an auditor reconstruct (a) which node submitted
which observations, (b) which operator approved that node, and
(c) which Principal authorized that operator. No anonymous
submissions; the "Obfuscated, not anonymous" rule (from the
hive-contribution work) applies.

## Release and rollback

### Distribution

- Binaries published as signed GitHub Release assets on the
  `OpenDigitalProductFactory/opendigitalproductfactory` repo,
  one release per Edge Node version. Releases include
  `darwin/arm64`, `linux/amd64`, `linux/arm64`, `windows/amd64`
  binaries plus a `SHA256SUMS` + `SHA256SUMS.sig` pair.
- Container image for Mode 1 / Mode 3 published to GHCR
  alongside the portal image, tag scheme
  `ghcr.io/opendigitalproductfactory/dpf-edge-node:<version>`.
- Installer lifecycle scripts (`dpf-start`, `dpf-update`,
  `dpf-update.ps1`) verify the signatures before installing.

### Rollback

- Each release is a self-contained binary; rollback is "install
  the previous release." No in-place schema state is
  Edge-Node-version-specific; the Authority Core ignores
  agent-version-specific fields it doesn't know.
- The installer keeps the previous binary at
  `~/.dpf/edge-node/previous/` until the next successful
  upgrade, so `dpf-update --rollback` is a same-second
  operation.
- Bad releases are revoked at the GitHub Release surface
  (mark as draft + publish a notice); the installer's signature
  check fails closed if a release is revoked. The Authority
  Core can also flag a known-bad agent-version range; nodes in
  that range receive a "please upgrade" hint in their heartbeat
  response.

### Compatibility

- The Authority Core and the Edge Node have a versioned
  contract. The Edge Node sends its `agentVersion` in every
  request; the Authority Core rejects unknown ranges with a
  clear error per "Evidence before diagnosis."
- Schema changes that affect the wire contract bump the contract
  version; the Authority Core supports the current and previous
  contract versions so upgrades can be staged.

## Test and verification gates

### Per-phase verification gates

| Phase | Gate |
|---|---|
| Phase 0 | Contract tests for every route; air-gap soft-fail test for the ingestion path; fresh-install seed verification (the new Principal kind / alias type values seed cleanly per "DB fix = seed + migration"); a `curl`-based synthetic-agent script completing the enrollment → heartbeat → submit → quarantine → revoke lifecycle end-to-end. |
| Phase 1 | An Edge Node container on a Linux host enrolls against a fresh DPF install, completes a discovery sweep that agrees with the current `network.ts` collector output ±confidence, and survives a docker daemon restart. |
| Phase 2 | An Edge Node binary on a real Apple Silicon Mac (M1/M2/M3/M4 on macOS 14+) enrolls, completes a discovery sweep including macOS-specific items (pkgutil receipts, brew packages, docker.raw.sock detection), survives a reboot via LaunchDaemon. |
| Phase 3 | An Edge Node container running in Docker Desktop's VM enrolls and submits the degraded capability set the spec predicts; the Authority Core UI surfaces the degradation correctly and refuses claims that escape the manifest. |
| Phase 4 | An Edge Node binary on Windows 11 enrolls, completes a discovery sweep, survives a reboot via Windows Service. Unblocks `windows_exporter` retirement (which happens in a follow-up PR in the installer plan). |

### Cross-cutting tests

- **Submission contract test.** A captured Edge Node submission
  fixture replayed through `persistSubmittedDiscoveryRun`
  produces identical `InventoryEntity` / `InventoryRelationship`
  outputs to the equivalent pre-Edge-Node bootstrap-discovery
  run (allowing for the agent-mode-driven confidence delta).
- **Capability advertisement round-trip.** The Authority Core
  disables a capability on an Edge Node; the heartbeat response
  carries the disabled capability; the Edge Node stops emitting
  that capability's observations; the Authority Core verifies
  no further observations of that capability arrive.
- **Quarantine effectiveness.** A quarantined Edge Node attempts
  every route; only `edge:heartbeat` succeeds (so the operator
  can see it's alive); `discovery:submit` returns 403 (or
  archives to `QuarantinedSubmission`); audit log records every
  attempt.

### Verification report template

Each phase that ships a real-hardware mode produces a verification
report under `docs/install/verification-reports/edge-node-<mode>-<host>.md`
following the existing pattern from
[docs/install/verification-runbook.md](../../install/verification-runbook.md).
The report includes the platform / version, the trust-state
lifecycle observed, the capability rows the node advertised, a
representative `DiscoveryRun` JSON sample, and a section on
anything that *didn't* work as the spec predicted (negative
findings are evidence too — the macOS / Linux installer-parity
verification runbook makes this explicit and we mirror it).

## Sequencing

This epic sits **after** the macOS / Linux installer-parity roadmap
ships its full installer (shipped early-access 2026-05-11). The
implementation slicing lives in
[docs/superpowers/plans/2026-05-12-edge-node-roadmap.md](../plans/2026-05-12-edge-node-roadmap.md);
that roadmap is the authoritative phase sequence. This spec
defines what each phase has to deliver; the roadmap defines when.

Until the Edge Node's `capability.discovery.network` slice lands,
the discovery sweep keeps its current data path:
`windows_exporter` on Windows, `node-exporter` (`linux-monitoring`
profile) on Linux, container-local fallback on macOS. The
installer-parity roadmap does **not** retire `windows_exporter`
or the `windows-host` Prometheus scrape — those retire when this
epic ships its first capability slice.

## Maturity gates before implementation

This spec moves from research to binding when all of these are
complete. **Security review is weighted heavier than other specs
because the Edge Node touches sandbox execution, network scanning,
credentials, policy caching, and host-local trust — an
architectural defect here has wider blast radius than a deployment-
target misconfiguration.**

- [x] Research & Benchmarking section complete (per AGENTS.md §10)
      — see "Research and Benchmarking" above; nine open-source
      comparators (osquery + Fleet, Tailscale, Cloudflare Tunnel,
      Wazuh, Falco, Netbox-Agent, Nautobot, Steampipe, authentik)
      and six commercial comparators (Auvik, Lansweeper,
      ScienceLogic SL1, Twingate, Cloudflare Zero Trust, Datadog
      NPM) read for data and trust models. Patterns adopted /
      rejected / anti-patterns listed; gaps this design fills
      enumerated.
- [x] Open questions resolved or explicitly deferred — see
      "Open question resolutions" above. **Mode 1 runtime: TypeScript
      / Node.js (Phase 0 shipped in #501; Go retrofit tracked as
      `BI-EDGE-XP-04-MODE1-GO-RETROFIT`, gated on Mode 4 verification).
      Modes 2 / 4 native binary runtime: Go** — resolved 2026-05-16
      in [`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md).
      The interim period (Mode 1 = TS, Modes 2 / 4 = Go) is bounded by
      a new wire-contract test suite that ships with the first Mode 4
      slice. Linux networking locked for first slice
      (`network_mode: host`); binary distribution locked (GitHub
      Release assets); update path locked (installer-driven, no
      in-binary self-updater); macOS scope locked (LaunchDaemon
      default); Windows scope locked (Service, not scheduled task);
      entitlements and capabilities documented and minimized. MCP /
      A2A gateway capabilities explicitly deferred to later
      capability slices with forward-compat hooks preserved.
- [x] Schema impact reviewed — `EdgeNode`, `BootstrapToken`,
      `EdgeNodeCapability` Prisma models defined above, revised
      to honor AGENTS.md §11 Principal convergence (EdgeNode
      becomes a host-attributes side table keyed by
      `principalId`; identity lives on Principal + PrincipalAlias
      with new kind `edge_node` and alias type `edge_node`).
      `DiscoveryRun.edgeNodeId` added as optional FK in the same
      migration. `persistSubmittedDiscoveryRun` sibling of
      `persistBootstrapDiscoveryRun` specified in "Ingestion
      contract" above.
- [x] Canonical contracts updated — Contract 5 of the deployment
      doctrine
      ([docs/superpowers/specs/2026-05-09-deployment-contracts.md](2026-05-09-deployment-contracts.md))
      already references this spec as its canonical
      implementation; revision history updated to reflect the
      finalization here. Contract 9 (LLM and agent-provider
      routing) is orthogonal; no change needed.
- [x] **Security review complete (heavy)** — see "Security
      review summary" above. Critical findings (node-token
      storage, bootstrap reuse, auto-approve scope creep) have
      resolutions that gate Phase 0 landing. Important findings
      (quarantine bypass, soft-fail abuse, binary tampering,
      Linux capability surface) have resolutions that gate
      Phase 0 / Phase 1. Acceptable risks are documented.
      Audit-trail consistency confirmed against AGENTS.md §8
      `ToolExecution` rule.
- [x] Release / rollback story defined — see "Release and
      rollback" above. Signed GitHub Release assets per platform,
      lifecycle-script-driven updates, atomic binary replacement
      with previous-version retained for one-step rollback, GitHub
      Release revocation as a kill-switch for known-bad
      releases.
- [x] Test / verification gates defined — see "Test and
      verification gates" above. Per-phase gates, cross-cutting
      contract tests, capability-round-trip tests,
      quarantine-effectiveness tests, and a verification-report
      template aligned with the macOS / Linux installer-parity
      precedent.

**Result:** spec status is now **binding**. Implementation may
proceed against the phase sequence in
[docs/superpowers/plans/2026-05-12-edge-node-roadmap.md](../plans/2026-05-12-edge-node-roadmap.md).

## Source documents

- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — installer-parity roadmap that motivates this epic and preserves
  the current data path until this lands.
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — the authority/edge split this spec inherits and extends.
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md`
  — the vector-store silent-failure incident (Qdrant-era, before
  BET-5 moved vectors to pgvector); observability invariants this
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
