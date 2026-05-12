# DPF Edge Node — Implementation Roadmap

> **Status: NOT STARTED — gated on spec finalization.**
> The Edge Node is currently a research stub
> ([docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md](../specs/2026-05-09-dpf-edge-node-design.md))
> with unresolved open questions and unchecked maturity gates. No
> Edge Node code (binary, API routes, Prisma models, token machinery)
> exists on `main` yet. This roadmap sequences the work between
> "research stub" and "shipped capability" so the slicing is visible
> before any code lands.
>
> **Parent epic:** "Epic B — Edge Node implementation" in
> [docs/superpowers/plans/2026-05-09-deployment-architecture-and-rollout.md](2026-05-09-deployment-architecture-and-rollout.md).
>
> **Sequencing constraint from the spec:** the Edge Node epic sits
> *after* the macOS / Linux installer-parity roadmap ships its full
> installer (Epic A, now in early access as of 2026-05-11). Until then
> the network sweep keeps its current data path
> (`windows_exporter` / `node-exporter` / container-local fallback).

## What the Edge Node is (one-paragraph explanation for README / portal docs)

The DPF Edge Node is a small, host-resident component that runs
**outside** the Docker Desktop / container boundary so DPF can see
the things the container can't: real network interfaces, the real
LAN, host-installed software, host-level credentials and trust, and
private-network MCP / A2A peers. It registers with a DPF Authority
Core (the portal you already run), receives a machine-bound token
(`dpfedge_*`), and reports observations back through a governed
ingestion API. The same binary runs in three deployment modes
depending on where it lives; the Authority Core is the only place
that decides what each Edge Node is allowed to do.

For the architectural rationale — capability envelope, identity
boundary, token model, enrollment ceremony, quarantine /
revocation, soft-fail policy — read the
[Edge Node design spec](../specs/2026-05-09-dpf-edge-node-design.md).

## Scope

**In scope for this roadmap:**

- The minimum schema, ingestion contract, and registration flow for
  an Edge Node to enroll, heartbeat, rotate tokens, and submit
  discovery observations to a DPF Authority Core.
- Three deployment modes for the **first** capability slice
  (`capability.discovery.network`):
  - **Mode 1 — Linux container with `network_mode: host`** (the
    default for native-Linux DPF installs).
  - **Mode 2 — native binary on macOS / Windows**, run by the host's
    own service manager (`launchd` on macOS, Windows Service on
    Windows), because Docker Desktop's container networking does not
    expose host topology truthfully on those platforms.
  - **Mode 3 — in-VM container fallback** for Docker Desktop hosts
    where a native binary cannot be installed. Capability set is
    knowingly degraded.
- Binary distribution: signed multi-platform release artifacts,
  install scripts, self-update story.
- Verification reports for each mode, on real hardware, per
  [docs/install/verification-runbook.md](../../install/verification-runbook.md).

**Out of scope (handled by later capability slices, *not* this
roadmap):**

- `capability.discovery.software` (installed-package inventory
  beyond what the first network slice picks up incidentally).
- `capability.metrics.host` (CPU / memory / disk / network
  time-series — the Prometheus exporter retirement decision lives
  in the macOS/Linux installer-parity plan, not here).
- `capability.identity.broker`, `capability.mcp.gateway`,
  `capability.a2a.gateway`, `capability.policy.enforcement`,
  `capability.tunnel.private-link`.
- A2A protocol gatewaying. The Edge Node architecture must accept
  it without redesign, but A2A waits until the public protocol
  contract stabilizes.
- Retiring `windows_exporter` from the Windows installer. That
  retirement is gated on the Windows native Edge Node landing — see
  Phase 4 below — and the change itself happens in the Windows
  installer's plan, not in this one.

## Maturity gates (must close before Phase 0)

These are inherited from the
[spec's "Maturity gates before implementation" checklist](../specs/2026-05-09-dpf-edge-node-design.md)
and *block* Phase 0 — no Edge Node code lands on `main` until each
is checked off, with the security review weighted heaviest.

- [ ] Research & Benchmarking section complete (per AGENTS.md §10):
      Netbox-Agent, Nautobot, Steampipe, osquery, Falco, Wazuh,
      Tailscale client, Cloudflare Tunnel; commercial comparators
      Auvik, Lansweeper, ScienceLogic SL1, Tailscale, Cloudflare
      Zero Trust, Twingate. Read data + trust models, not marketing.
- [ ] Open questions in the spec resolved or explicitly deferred
      (Linux default networking `host` vs `macvlan`; binary
      distribution shape; update path; required Linux capabilities;
      macOS entitlements; Windows service vs scheduled task).
- [ ] Schema impact reviewed and migration drafted — `EdgeNode`,
      `BootstrapToken`, `EdgeNodeCapability`,
      `DiscoveryRun.edgeNodeId`; new
      `persistSubmittedDiscoveryRun` sibling of
      `persistBootstrapDiscoveryRun`.
- [ ] Canonical contracts updated if this work changes shared
      behavior (Contract 5 of the deployment doctrine references
      this spec).
- [ ] **Security review complete (heavy)** — token issuance and
      rotation, bootstrap enrollment ceremony, quarantine /
      revocation triggers, soft-fail policy windows, policy-cache
      integrity, binary signing / attestation, Linux capability
      surface, macOS entitlements, audit-trail consistency.
- [ ] Release / rollback story defined — binary distribution,
      self-update flow, downgrade path if a release is bad.
- [ ] Test / verification gates defined — fresh install on
      Windows / macOS / Linux; submission contract test against
      `persistSubmittedDiscoveryRun`; air-gap behavior;
      capability advertisement / Authority Core policy round-trip.

## Phases

Each phase below lands as a separate PR (or small PR set) per
AGENTS.md §4 ("one concern per branch, one concern per PR").
Phases are ordered by dependency — earlier phases unblock later
ones. The roadmap is **strict** about Phase 0 → Phase 1 → Phase 2;
Phases 3 and 4 can run in parallel once Phase 1 lands, and Phase 5
is the closing gate that lets the README / portal docs flip the
status from "design partner wanted" to "early access".

### Phase 0 — Authority Core foundation (no Edge Node binary yet)

**Goal:** make it possible for *something* to enroll, heartbeat,
rotate tokens, and submit observations. No binary exists yet —
this phase is exercised by tests and (optionally) a `curl`-based
synthetic agent.

**Deliverables:**

1. Prisma models — `EdgeNode`, `BootstrapToken`,
   `EdgeNodeCapability`; `DiscoveryRun.edgeNodeId` optional FK.
   Migration committed and verified on a fresh install.
2. `dpfedge_*` token namespace — hashed-at-rest, scope-bound,
   machine-bound, rotating. Mirrors the `McpApiToken` pattern
   (`packages/db/prisma/schema.prisma:2974`), with the differences
   the spec calls out (machine ownership, shorter TTL, refresh via
   heartbeat).
3. Routes under `apps/web/app/api/v1/edge/`:
   - `POST /api/v1/edge/enroll` — consumes a one-time bootstrap
     token; issues a node token; records `enrollmentTokenId` on
     the new `EdgeNode` row; auto-approves only when the bootstrap
     token was issued by the local installer for the same host
     (per the spec's approval policy).
   - `POST /api/v1/edge/heartbeat` — keepalive + token rotation;
     returns the rotated node token in the response.
   - `POST /api/v1/edge/discovery-runs` — ingestion. Calls a new
     `persistSubmittedDiscoveryRun` sibling of the existing
     `persistBootstrapDiscoveryRun`; **does not** rerun
     collectors server-side.
4. Admin > Platform Development surface — list nodes, see
   trust state, issue bootstrap tokens, approve / quarantine /
   revoke.
5. Contract tests for every route. Air-gap soft-fail test for the
   ingestion path (queue locally, flush on reconnect).

**Depends on:** all maturity gates above; no other epic.
**Exit criteria:** a `curl` script can complete the full
enrollment → heartbeat → submit → quarantine → revoke lifecycle
end-to-end against a fresh install.
**Risk:** schema migration risk on an existing install. The seed
must populate the new models cleanly per the "DB fix = seed +
migration" rule
([CLAUDE.md memory](../../../CLAUDE.md)).

### Phase 1 — Native binary build pipeline + Mode 1 (Linux container)

**Goal:** produce the Edge Node binary as a real release artifact
and ship Mode 1 (Linux container, `network_mode: host`) as the
first deployment shape. This is the smallest mode to verify
because the runner already has the right network visibility.

**Deliverables:**

1. Binary source under `apps/edge-node/` (language choice — Go or
   Rust — locked during the spec's open-question resolution; the
   spec lists both as acceptable, with bias toward Go for static
   linking simplicity and ~5 MB target size).
2. Build pipeline producing signed, multi-platform release
   artifacts:
   - `linux/amd64`, `linux/arm64`
   - `darwin/arm64` (no Intel Mac per scope)
   - `windows/amd64`
   Published as a GitHub Release plus checksums + signatures.
   New `.github/workflows/edge-node-release.yml` workflow; reuses
   the multi-arch primitives from
   [`.github/workflows/publish-image.yml`](../../../.github/workflows/publish-image.yml)
   where it can.
3. Mode 1 container image variant — minimal Linux container, runs
   the binary, expects `network_mode: host`, documents minimum
   required Linux capabilities (the spec calls out `CAP_NET_RAW`
   and `CAP_NET_ADMIN` as the candidates; least privilege is
   non-negotiable).
4. `capability.discovery.network` collector ported into the
   binary. The existing
   [`packages/db/src/discovery-collectors/network.ts`](../../../packages/db/src/discovery-collectors/network.ts)
   stays in place server-side as a fallback for Edge-Node-absent
   installs; it is *not* retired in this phase.
5. Verification report against a real Linux host (template at
   [docs/install/verification-runbook.md](../../install/verification-runbook.md)).

**Depends on:** Phase 0.
**Exit criteria:** an Edge Node container on a Linux host enrolls
against a fresh DPF install, completes a discovery sweep that
agrees with the current `network.ts` collector output ±confidence,
and survives a docker daemon restart.

### Phase 2 — Mode 2 (native macOS binary + launchd)

**Goal:** ship the macOS deployment mode that the
[Edge Node spec's "Deployment modes" table](../specs/2026-05-09-dpf-edge-node-design.md)
calls out specifically: a native LaunchAgent because Docker
Desktop on macOS does *not* expose host topology truthfully (its
"host networking" is L4-only — port reachability, not real NIC /
ARP / LLDP visibility).

**Deliverables:**

1. `darwin/arm64` install script (`install-edge-node.sh` on
   macOS), distributed with the release. Idempotent. Places the
   binary in a standard path (`/usr/local/libexec/dpf-edge-node/`
   per macOS conventions, exact path locked during Phase 1).
2. `launchd` plist for boot-time + login-time start, with
   relaunch-on-crash. Lives in `~/Library/LaunchAgents/` (per-user)
   or `/Library/LaunchDaemons/` (system-wide) — the spec's
   open question on which is the default needs to be resolved
   before this phase starts; system-wide is the default working
   assumption.
3. macOS code signing + notarization for the binary. Entitlement
   set minimized per the spec's gate; the exact entitlement list
   is part of the spec's open-question resolution (network
   discovery may need
   `com.apple.developer.networking.multicast` or similar).
4. Discovery extensions specific to macOS — `pkgutil` receipts,
   Homebrew package inventory, `docker.raw.sock` detection,
   `vmnet`-visible interfaces. These extensions are advertised as
   capability evidence rows so the Authority Core can see what
   the node actually collected.
5. Verification report against a real Apple Silicon Mac (M1 / M2
   / M3 / M4) running macOS 14+. Must include a reboot survival
   test (launchd starts the agent at boot and the node resumes
   heartbeating without operator action).

**Depends on:** Phase 1 (binary + pipeline).
**Hard prerequisite:** physical Apple Silicon hardware available
to whoever runs the verification — no useful surrogate exists.

### Phase 3 — Mode 3 (in-VM container fallback for Docker Desktop)

**Goal:** ship the degraded-capability fallback for hosts where
the native binary cannot be installed (locked-down corporate Macs,
or admins who explicitly choose the container path). Capability
set is knowingly restricted — see the spec's "Hard constraint"
paragraph on Docker Desktop's L4-only networking.

**Deliverables:**

1. Container image variant for Docker Desktop's VM. Same binary
   inside, but a manifest that advertises a restricted capability
   set to the Authority Core (no real host NIC enumeration, no
   ARP, no LLDP).
2. Discovery items that *do* still work from inside the VM —
   `docker.raw.sock` presence, in-VM software inventory,
   Docker-Desktop-VM network introspection — flagged with reduced
   `confidence` per
   [`DiscoveredItem.confidence`](../../../packages/db/prisma/schema.prisma).
3. Authority Core UI surface (Admin > Platform Development) shows
   the degraded capability set explicitly so the operator
   understands what they're giving up by choosing Mode 3 over
   Mode 2.
4. Verification report against Docker Desktop for Mac (Apple
   Silicon, macOS 14+), confirming the degraded set is what the
   spec predicts and no capability claims escape the restricted
   manifest.

**Depends on:** Phase 1 (binary + pipeline). **Can run in
parallel** with Phase 2 once Phase 1 ships.

### Phase 4 — Windows native (parity slice)

**Goal:** Windows installs get the same native path macOS gets
in Phase 2, closing the parity gap. Until this phase ships,
Windows installs continue to use `windows_exporter` for network
sweep data per the installer-parity plan's "Network sweep data
path" decision. This phase is what unblocks `windows_exporter`
retirement; the retirement itself is a follow-up in the
installer plan, not here.

**Deliverables:**

1. Windows Service registration script (PowerShell). Idempotent.
   Service runs under a least-privilege account with the
   minimum Windows privileges needed for the network discovery
   surface — the exact set is part of the spec's open-question
   resolution.
2. Authenticode signing of the `windows/amd64` binary using the
   same signing infrastructure the Windows installer uses today.
3. Discovery extensions specific to Windows — WMI / CIM
   network-adapter enumeration, ARP cache, installed-software
   inventory via the registry.
4. Verification report against a real Windows 11 host with the
   reboot survival test.

**Depends on:** Phase 1. **Can run in parallel** with Phase 2
once Phase 1 ships.

### Phase 5 — Status flip + public doc surface

**Goal:** with verification reports in hand for at least Modes 1
and 2, flip the Edge Node from "design partner wanted" to "early
access" in the README and the portal documentation. This phase
is the gate between "the code exists" and "we are inviting users
to deploy it".

**Deliverables:**

1. Update [README.md](../../../README.md) Edge Node section to
   "early access" and link to this roadmap + the verification
   runbook.
2. Add an Edge Node page to the portal documentation surface
   (under Admin > Platform Development > Edge Nodes) that
   explains the three modes, links the install scripts, and
   surfaces the verification status for the current install's
   platform.
3. Update [docs/install/verification-runbook.md](../../install/verification-runbook.md)
   to flip Edge Node entries from "design partner wanted" to
   "early access" for the modes that have shipped + verified.
4. Update the deployment doctrine
   ([docs/superpowers/specs/2026-05-09-deployment-contracts.md](../specs/2026-05-09-deployment-contracts.md))
   if Contract 5 needs amending based on what was learned in
   implementation.
5. A "what we learned" addendum at the foot of this roadmap
   (revision history pattern from the macOS / Linux native
   support plan).

**Depends on:** Phase 1 + Phase 2 verified on real hardware. Phase
3 and Phase 4 may flip independently once each lands its
verification report.

## Cross-cutting decisions (resolve during the maturity-gate phase)

These were called out as open questions in the spec. Closing them
is part of the maturity gates above; pinning them here so they
don't get re-litigated mid-implementation.

- **Language for the binary** — Go or Rust. Default working
  assumption: Go (static linking, small binary, mature
  cross-compilation, mature signing toolchains). Final lock
  during gate resolution.
- **Linux default networking** — `network_mode: host` (observer
  only) or `macvlan` (LAN peer with LLDP/CDP receive). Default
  working assumption: `network_mode: host` for the first slice;
  `macvlan` is a follow-up capability slice when LLDP/CDP receive
  becomes necessary.
- **Binary distribution shape** — GitHub Release assets (default)
  vs bundled inside the GHCR portal image. Default working
  assumption: GitHub Release assets, because the installer is
  the natural distribution channel and we already have signing
  primitives for it.
- **Update path** — pull-on-schedule (default), platform-push,
  or signal-and-download-via-installer.
- **macOS launchd scope** — `LaunchDaemon` (system-wide,
  default) vs `LaunchAgent` (per-user).
- **Windows service vs scheduled task** — service (always
  running, default) vs scheduled task. Default is "service".

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Spec open questions land late and ripple back through Phase 0 schema | High | Treat the maturity-gate phase as a hard prerequisite; do not start Phase 0 until every open question is resolved or explicitly deferred. |
| Security review surfaces token-model or attestation gaps after Phase 0 ships | High | Weight the security review heaviest in the maturity gates; have it close *before* Phase 0, not concurrently with it. |
| macOS notarization friction blocks Phase 2 | Medium | Spike notarization during Phase 1 (Linux mode is shipping, but the build pipeline exists), so Phase 2 only inherits a known-good pipeline. |
| Edge Node binary drifts from the Authority Core schema | Medium | Schema versioning in the registration envelope; Authority Core rejects unknown agentVersion ranges with a clear error per "Evidence before diagnosis". |
| In-VM Mode 3 advertises capabilities it cannot deliver | Medium-High | Capability rows include evidence; Authority Core validates evidence against the advertised capability before trusting any submission. The "Obfuscated, not anonymous" / silent-failure rules apply. |
| Verification reports never arrive (no Apple Silicon hardware) | Medium | Flip to "design partner wanted" status in the README and explicitly solicit early-access verifiers; do not flip to "early access" without at least one real-hardware report per mode. |
| Concurrent macOS / Windows phases produce overlapping PRs | Low | The "Check overlap before opening PR" rule applies; phases 2, 3, 4 land into distinct directories (`apps/edge-node/platform/{darwin,linux,windows}/`) so they don't conflict at file level. |

## References

- Spec: [docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md](../specs/2026-05-09-dpf-edge-node-design.md)
- Parent epic context: [docs/superpowers/plans/2026-05-09-deployment-architecture-and-rollout.md](2026-05-09-deployment-architecture-and-rollout.md)
- Companion plan (predecessor): [docs/superpowers/plans/2026-05-09-macos-linux-native-support.md](2026-05-09-macos-linux-native-support.md)
- Enterprise auth principle (authority / edge split): [docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md](../specs/2026-04-22-enterprise-auth-directory-federation-design.md)
- Cloud deployment spec (deployment-target neutrality the Edge Node inherits): [docs/superpowers/specs/2026-05-09-cloud-deployment-design.md](../specs/2026-05-09-cloud-deployment-design.md)
- Deployment doctrine: [docs/superpowers/specs/2026-05-09-deployment-contracts.md](../specs/2026-05-09-deployment-contracts.md)
- Existing MCP transport (template for governance + audit + tokenization): [apps/web/app/api/mcp/v1/route.ts](../../../apps/web/app/api/mcp/v1/route.ts)
- Existing token model (template for `dpfedge_*`): [packages/db/prisma/schema.prisma:2974](../../../packages/db/prisma/schema.prisma)
- Existing network sweep collector (predecessor for `capability.discovery.network`): [packages/db/src/discovery-collectors/network.ts](../../../packages/db/src/discovery-collectors/network.ts)
- Verification runbook: [docs/install/verification-runbook.md](../../install/verification-runbook.md)

## Revision history

- 2026-05-12 — initial roadmap.
