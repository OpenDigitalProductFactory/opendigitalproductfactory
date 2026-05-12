# DPF Edge Node — T2: Multi-Host Real-LAN Verification

> **Status:** planning artifact. No code in this PR.
>
> **Thread label:** T2 — the next-up follow-on after Phase 0
> ("single-host demo verified locally") completes. T2 verifies the
> Edge Node across a real LAN with two distinct Linux hosts,
> separated by at least one real switch / gateway. T3 (macOS / Windows
> native binary modes), T4 (mTLS hardening), and T5 (air-gapped) are
> siblings, each with their own thread.
>
> **Parent roadmap:**
> [`docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md`](2026-05-12-edge-node-phase0-roadmap.md)
> — "Real-LAN multi-host verification is then T2's job."
> **Spec:** [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md).
>
> **What this doc is:** a forward-looking gap list of Phase 0
> assumptions that will not survive a multi-host LAN setting,
> sliced into 3–5 follow-on PRs. None of these are Phase 0 bugs —
> Phase 0 explicitly defers multi-host. They are the work T2 must
> close before a second-host operator can follow the runbook
> end-to-end.

## T2 scope (what "done" means)

End-to-end demo, two physical (or VM) Linux hosts on the same LAN
segment, separated by at least one real switch or gateway. Neither
host is Docker Desktop; both run native Docker Engine on Linux per
the Phase 7c installer parity work.

```bash
# Host A (Authority Core)
bash dpf-start.sh
# Operator opens Admin > Platform Development > Edge Nodes,
# clicks "Issue bootstrap token", copies the token.

# Host B (Edge Node — a different machine on the same LAN)
docker compose -f docker-compose.edge-standalone.yml up -d \
  -e DPF_AUTHORITY_URL=https://dpf-host-a.lan:443 \
  -e DPF_BOOTSTRAP_TOKEN=<token>

# Verify in the portal on Host A:
#   - EdgeNode row exists with a non-loopback IP attributed to it
#   - trustState=trusted (after operator approval — paste-provisioned
#     tokens land in 'pending' per spec § Approval policy)
#   - DiscoveryRun visible with edgeNodeId populated
#   - DiscoveredItem rows include real LAN-side IPs (not Docker
#     bridge IPs)
#   - At least one switch / gateway / non-portal-host inventory item
#     with osiLayer >= 2 appears in the discovery results
```

## Out of scope for T2

- **macOS / Windows native binary modes** — T3.
- **mTLS** — T4. T2 uses bearer-over-HTTPS with a self-signed cert
  + operator-trusted CA bundle as the minimum viable hardening.
- **Air-gapped** — T5.
- **VLAN-segregated / multi-segment LAN topology** — separate
  thread; T2 verifies one switch-hop, not L3 routing.

## Phase 0 assumptions that break on a real LAN

Each item below cites the Phase 0 surface where the assumption
lives and proposes the T2 follow-on action. None require changes
to merged Phase 0 code; they are additive or fix-on-T2-PR-land.

### G1 — `host.docker.internal` in the demo block

**Surface:**
[`phase0-roadmap.md` § Phase 0 scope](2026-05-12-edge-node-phase0-roadmap.md)
hardcodes
`DPF_AUTHORITY_URL=http://host.docker.internal:3000`. This is a
Docker Desktop bridge alias. It does not resolve from a second
Linux host across a real switch, and it does not resolve from a
sibling container under `network_mode: host` on native Linux
Docker Engine either.

**Action (T2 PR 1):** new `docker-compose.edge-standalone.yml`
overlay that documents the canonical multi-host setup. The
`DPF_AUTHORITY_URL` value comes from `.env` (operator sets it to
a routable URL — IP, mDNS `.local` name, or DNS A record).
Update operator docs to call out the difference between the
Phase 0 single-host demo (`host.docker.internal` works) and the
T2 multi-host demo (does not).

### G2 — `http://` bearer-token transport on the demo LAN

**Surface:** Phase 0 demo uses `http://`. The spec
([§ Soft-fail policy windows](../specs/2026-05-09-dpf-edge-node-design.md))
defers mTLS to T4 but reasonably expects bearer-over-HTTPS as the
Phase 0 floor. Bearer tokens (`dpfedge_*`) over plain HTTP on a
LAN are sniffable by anyone on the same broadcast domain.

**Action (T2 PR 2):** A8 audit / runbook update — operator
instructions for issuing a self-signed cert on Host A (the
Authority Core), distributing the CA bundle to Host B (the Edge
Node), and pointing `DPF_AUTHORITY_URL` at `https://`. The
`edge-node` service already needs to honor a custom CA bundle —
verify A3's HTTP client respects `NODE_EXTRA_CA_CERTS` or accept
a small follow-on to wire it. Document that mTLS is the T4 floor.

### G3 — Clock skew tolerance on submission envelopes

**Surface:** A2 (`/api/v1/edge/discovery-runs`) is expected to
validate `observedAt` freshness per spec § Soft-fail policy
windows. Spec says "submissions queue locally; older submissions
stamp the original `observedAt`" but does not specify the
tolerance window. On a single host this is moot — clock is shared.
On two hosts that haven't synced NTP recently (common on freshly
provisioned VMs) skew can be tens of seconds.

**Action (T2 PR 3):** spec amendment + A2 implementation
parameter — explicit `freshness_tolerance_sec` config knob with
a sensible default (proposed: 300s ≈ 5 min, matching NTP
resync horizon on a healthy LAN). Document NTP as a hard
prerequisite for Edge Node hosts in the operator runbook.

### G4 — Authority URL discovery if the Authority IP changes

**Surface:** The Edge Node persists `DPF_AUTHORITY_URL` from
env on first run. If Host A reboots and gets a new DHCP IP, every
enrolled Edge Node on the LAN loses contact. The spec does not
define an Authority discovery mechanism.

**Action (T2 doc-level, no PR yet):** runbook note that Authority
should use a static IP, mDNS name (`.local`), or DNS A record on
the LAN. Defer the actual discovery protocol (mDNS-SD,
Zeroconf) to a later thread; T2 documents the operational
constraint and adds it to the verification checklist.

### G5 — Linux capabilities for L2 collectors

**Surface:** A6 (`docker-compose.edge.yml`) uses
`network_mode: host`. That gives the container the host's
interfaces but not the elevated capabilities ARP / nmap / SNMP
collectors need. `arp-scan` and `nmap`'s raw-socket modes need
`CAP_NET_RAW` and `CAP_NET_ADMIN`; without them, the collectors
either silently fall back to a less-informative mode or fail
outright (and a quarantined-node-style silent skip is exactly
what AGENTS.md §1 forbids).

**Action (T2 PR 4):** add explicit `cap_add: [NET_RAW, NET_ADMIN]`
to the standalone compose overlay introduced in G1 (or to the
upstream `docker-compose.edge.yml` if A6 doesn't include them).
Audit the host-runnable collectors from A4 for silent capability
fallbacks; add an explicit failing-loud check that the collector
reports a `WARN` envelope row when raw-socket access is denied.

### G6 — `EdgeNode` row has no IP / hostname surface for the operator

**Surface:** A1 schema (`EdgeNode` model) carries `platform`,
`installMode`, `version`, `status`, `trustState`, `lastSeenAt`,
`capabilities`, `metadata`. No first-class IP or hostname field.
For a single-host demo the operator knows where the Edge Node
runs (same machine). For multi-host they need to find the row
that corresponds to the host they just provisioned.

**Action (T2 PR 5, or fold into one of G1–G5):** standardize
the `metadata.host.ipAddresses` and `metadata.host.hostname`
shape submitted at enrollment / heartbeat. Surface them in the
A7 admin UI's Edge Nodes list page. No schema change required
if the contract is documented and the UI reads the JSON
consistently; a denormalized column is a possible later
optimization.

### G7 — Bootstrap-token approval flow is invisible in the demo

**Surface:** The Phase 0 demo block says the operator copies the
token and the Edge Node "enrolls within ~30s." But the spec's
approval policy (§ Approval policy) says paste-provisioned
tokens land in `trustState=pending` and the node "must not
submit observations" until an operator approves in Admin >
Platform Development. The demo glosses over the approval step
because Phase 0's local-host enrollment auto-approves.

**Action (T2 doc-level + runbook):** the T2 verification
runbook entry explicitly walks the operator through clicking
"Approve" in the admin UI before the first sweep is expected to
land. Without this, T2 verifiers will report the demo as broken
when actually the node is sitting in `pending` waiting for them.

### G8 — Demo's docker-compose assumes Authority + Edge Node share a compose project

**Surface:** A6 says the Edge Node ships as an *overlay* on the
existing portal compose project (`docker-compose.yml -f
docker-compose.linux.yml -f docker-compose.edge.yml`). On a
second host the operator does not have the portal services in
their compose file at all — they need a standalone overlay that
brings up only the Edge Node, with the Authority Core as an
external endpoint.

**Action (T2 PR 1, alongside G1):** the new
`docker-compose.edge-standalone.yml` is *not* an overlay on the
portal compose — it is a complete compose file in its own
right, intended to be the only file in play on the Edge Node
host. Operator docs explicitly distinguish the two cases.

## Slice plan (3–5 PRs per brief)

| # | PR | Closes | Notes |
|---|---|---|---|
| **T2.1** | `feat(edge-node): docker-compose.edge-standalone.yml + cap_add` | G1, G5, G8 | Standalone compose for second-host installs; CAP_NET_RAW / CAP_NET_ADMIN; routable `DPF_AUTHORITY_URL` |
| **T2.2** | `feat(edge-node): bearer-over-HTTPS with operator-trusted CA bundle` | G2 | Self-signed cert generation script on Authority; CA bundle propagation to Edge Node via `NODE_EXTRA_CA_CERTS` (or equivalent) |
| **T2.3** | `feat(edge-node): submission freshness tolerance + NTP runbook` | G3 | Spec amendment + A2 config knob + operator NTP-prerequisite note |
| **T2.4** | `feat(admin-ui): surface EdgeNode IP / hostname in admin list` | G6 | Read `metadata.host.*` in the A7 Edge Nodes table; standardize the JSON shape at enroll/heartbeat |
| **T2.5** | `docs(install): verification runbook + install_verification.md template for multi-host LAN` | G4, G7, verification report | Issue template; runbook entry with explicit approval step; Authority-stable-URL operational note; doctor bundle attachment instructions |

T2.1, T2.2, T2.3 can ship in parallel after Phase 0 lands. T2.4
depends on the A7 admin UI shipping (Phase 0 slice). T2.5 is the
verification report itself, landing last and bundling the doctor
output.

## Verification gate

A clean-checkout developer follows
[`docs/install/edge-node.md`](../../install/edge-node.md) (added in
Phase 0 A10) on two distinct Linux hosts. The "Verify in the portal
on Host A" assertions in this doc's T2 scope section all pass.
`bash install-dpf.sh doctor` from Host A includes the Edge Node
section and the bundle attaches cleanly to the
`install_verification.md` issue template.

When that happens, **T2 flips to `verified on real LAN`** in the
parent thread ledger.

## Cross-references

- Parent roadmap: [`2026-05-12-edge-node-phase0-roadmap.md`](2026-05-12-edge-node-phase0-roadmap.md)
- Spec: [`docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`](../specs/2026-05-09-dpf-edge-node-design.md)
- Deployment contracts: [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../specs/2026-05-09-deployment-contracts.md) — Contract 5 (host trust + discovery)
- Sibling thread roadmaps (T3 macOS/Windows, T4 mTLS, T5 air-gapped) — to follow.
