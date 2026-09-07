---
title: "Edge Nodes"
area: platform
order: 6
---

## Use This Doc For

- `/platform/edge-nodes`
- Edge Node enrollment, trust review, heartbeat status, and discovery-run intake
- Choosing the right Edge Node runtime for a given host (Linux container vs. native binary on Windows / macOS)
- Reviewing the adapter inventory and operational event stream that an enrolled node produces
- Multi-host and air-gapped Edge Node runbooks under `docs/install/`

## What An Edge Node Does

An Edge Node is the host-resident trust and discovery component. It enrolls with the platform's Authority Core, heartbeats freshness, runs local collectors against the network it can reach, and submits results as governed evidence. Two surfaces matter to an operator: **enrollment / trust state** (managed in the portal) and **what the node can see from where it runs** (decided by the deployment mode below).

## Start With This DPF Installation

The first card on **Platform > Edge Nodes** answers whether the host component belonging to the current DPF installation is ready. It is intentionally separate from remote or customer nodes. The installer-issued enrollment identifies that node; hostnames and stored `active` labels do not.

The card checks the supervised service, enrollment, trust, heartbeat freshness, platform version, and nearby-DPF discovery capability. Its health states mean:

| Health | Meaning | Operator response |
| --- | --- | --- |
| **Setup required** | Edge was not enabled, no local supervised service is enrolled, or more than one installer-managed enrollment claims this installation. | Follow the card detail. For an enrollment conflict, review the fleet and retire or repair the obsolete enrollment before relying on nearby discovery. |
| **Starting** | Enrollment or the first heartbeat/approval is still completing. | Wait briefly, then review the named waiting check. |
| **Healthy** | Trust, heartbeat, version, and required capabilities are current. | No action. |
| **Degraded** | The node is reachable but a version, capability, or freshness check needs attention. | Follow the failed check; open **Connections** for nearby discovery. |
| **Offline** | No heartbeat arrived inside the offline window. | Use the governed repair/self-upgrade workflow; do not trust recent discovery as current. |
| **Quarantined / Revoked** | Trust policy intentionally blocks or permanently retires the node. | Review the recorded trust decision before restoring or replacing it. |

Health and trust are different axes. A node can be trusted yet offline, or alive yet quarantined. The fleet table therefore shows both columns, plus the first failed readiness check and its next action, and derives health from live evidence rather than `EdgeNode.status` alone.

If **Connections** reports an **Enrollment conflict**, discovery may still be running, but the Authority cannot safely prove which installer-managed node belongs to this installation. DPF does not guess from the newest heartbeat or hostname. The common cause heals on its own: an installer-managed enrollment that has been silent for a week while another installer-managed node is live is retired automatically, both right after a new installer enrollment and by an hourly sweep, and its retirement reason names the live node that superseded it. Only two live installer-managed nodes remain a conflict; then open **Edge Nodes**, identify the obsolete enrollment, and retire or repair it through the governed lifecycle.

Once Edge is enabled, each governed install or self-upgrade refreshes the checksum-bound native binary and its supervisor while preserving the enrolled machine identity. Replacement bytes are staged before the service stops, and a failed restart restores the prior binary. A platform version change does not issue a new bootstrap token.

## Deployment Modes

The Edge Node ships in two runtimes. Pick the one that matches the host substrate — the installer auto-selects based on platform detection, and the choice can be overridden with `--mode=native|container|macvlan`.

| Mode | Host | Networking visibility | When to use |
|------|------|------------------------|-------------|
| **Mode 1 — Linux container** with `network_mode: host` | Linux bare-metal, Linux VM, headless server | Real LAN — sees host NICs, ARP, broadcast, mDNS | Default for any Authority + Edge single-host install on Linux. Existing `linux-host-network` compose profile. |
| **Mode 1 — Linux container** with macvlan / ipvlan L2 | Linux container-host with isolation requirement, or Linux + Wi-Fi | Own IP on LAN (macvlan) or shared MAC + own IP (ipvlan, Wi-Fi-friendly) | Operator opt-in via `docker-compose.edge.macvlan.yml` overlay. Use when the Edge Node must be isolated from the rest of the Linux container fleet but still needs real LAN reach. |
| **Mode 4 — native binary** | Windows + Docker Desktop, macOS Docker Desktop, macOS bare-metal, Windows native, Linux native (appliances, NAS, hardened hosts) | Real LAN, direct host networking | The only path that works on Docker Desktop. Verified on 2026-05-20: WSL2 mirrored networking does **not** expose the Windows host LAN to Docker containers — Docker Engine inserts its own services network between the container and the host. |

The Mode 4 native binary is a Go agent (`services/edge-node-go/`) shipping today with: enroll + heartbeat client (W1), host-info collector + sweep submission (W2), ARP collector reading `GetIpNetTable` on Windows, `/proc/net/arp` on Linux, and `arp -an` on macOS (W3), and MAC-OUI vendor enrichment on every ARP-discovered host (W3.5). A wire-contract parity test keeps the Go agent and the container runtime emitting the same envelope.

### When a container looks like it works but doesn't

A common failure mode: an Edge Node container runs successfully on a Windows or macOS Docker Desktop host, heartbeats green, and reports discovery results that look correct. They aren't. What the container actually saw is Docker's internal services network (typically `192.168.65.0/24` on Docker Desktop) — host info plus the bridge MAC, two items per sweep. The platform now refuses this default on Docker Desktop and recommends the native binary instead.

## Adapters and What They Discover

A single enrolled Edge Node carries several collectors. Each one writes through the canonical `/api/v1/edge/adapters` ingest path, so the platform schema is the same regardless of which adapter produced the row.

| Adapter | What it collects | Status |
|---------|------------------|--------|
| **ARP collector** | Local ARP cache; one host row per IP + MAC observed. Enriched with vendor name via MAC-OUI lookup. | Shipped (Go agent W3 + W3.5) |
| **Host info** | The Edge Node host itself — hostname, NICs, OS, capabilities. | Shipped (Go agent W2) |
| **UniFi controller** | Sites, devices, and connected clients via the UniFi controller API. Slice A is read-only discovery; Slice B adds the `/stat/sta` clients endpoint. | Shipped (Slices A + B) |
| **SNMP — ifTable** | Network-device interface metrics for hosts that expose SNMP. | Shipped |
| **LLDP — neighbor discovery** | Layer-2 neighbor relationships between SNMP/LLDP-capable devices. Used to assemble physical topology. | Shipped |

The UniFi adapter is the first example of a **vendor adapter** consolidated through the platform's `/api/v1/edge/adapters` surface — operator-configured once, with the controller URL and credential living in the platform's credentials store. SNMP and LLDP are the first **infrastructure-protocol adapters**. The pattern is the same in both cases: the adapter runs inside the Edge Node, the platform receives normalized rows.

## The Canonical Event Envelope

Every Edge Node submission — whether discovery, host info, or operational event — lands at the portal as an `EdgeEventEnvelope`. Slice 0 of the envelope shipped in PR #895; Slice 1 (change events) shipped in PR #914. The wire contract is intentionally PD-CEF-shaped so future adapters from external monitoring tools translate to the same vocabulary without a second mapping pass.

What an operator can rely on today:

- **One wire shape** validated identically by the portal's Zod schema, the Go envelope validator, and a cross-runtime parity test
- **Replay-safe dedupe** on `(edgeNodeId, dedupKey)` so flap and flood noise that survived edge-side collapse still folds to one row at the portal
- **Lifecycle primitives** — `trigger`, `acknowledge`, `resolve` — on every event, ready to project onto an incident state machine in a later slice
- **Auth and rate-limit parity** with the existing edge ingest routes (`heartbeat`, `discovery-runs`, `metrics`) — same `dpfedge_` bearer-token model, same per-node ceiling pattern
- **Change events** — the Slice 1 surface — record state transitions on the envelope so downstream consumers can reason about deltas rather than re-deriving them

What is **not** in place yet: the detector framework on the edge (Slice 1 of the detection engine), the reachability / SNMP-trap / syslog / ARP / DHCP detector pack (Slice 2), vendor detector packs for UniFi events / Synology / Home Assistant / NUT / Suricata (Slice 3+), cross-source correlation and grouping, the incident UX, and escalation policies / on-call schedules. The envelope is the lock-step contract those slices will build on; until each of them lands, the Edge Node is a discovery and telemetry surface, not yet a full event-management surface.

## Workflow

1. Start from `/platform/edge-nodes` and confirm **This DPF installation** is healthy before relying on nearby discovery or the wider fleet.
2. Approve trust only when the node identity, host, network placement, and intended collector scope are understood. Trust is one-way — once approved, the node's submissions become platform evidence.
3. Review heartbeat and freshness before treating a discovery run as current. A stale heartbeat means the run is stale, regardless of how recent the row looks.
4. For the host-level setup, follow the runbooks under `docs/install/`:
   - [Multi-host LAN installation](../../install/edge-node-multi-host.md)
   - [Air-gapped installation](../../install/edge-node-air-gapped.md)
   - [Verification runbook](../../install/verification-runbook.md)
5. Use collected inventory as evidence for operations and discovery workflows — owner review still applies before any change is taken on the basis of an Edge Node row.

## Authoritative State

- Edge Node **trust, heartbeat, and run status** live in the platform database. They are managed in the portal and surfaced through `/platform/edge-nodes`.
- The Edge Node **host owns** collector configuration and network reachability. The platform does not push configuration into the host — the host pulls its operating parameters from the platform when it enrolls and heartbeats.
- **Discovery output becomes platform evidence only after the Authority Core accepts and records it.** A row in the Edge Node's local buffer is not yet evidence.

## AI Coworker Support

The AI coworker can summarize node posture, highlight stale or untrusted nodes, and help turn unresolved setup issues into backlog work. It must **not** approve a node, widen collector scope, or infer legal authority to scan a network without operator approval. Scope expansion is always a human decision.

## What To Watch

- **Pending nodes** that look familiar but have not been tied to a known host — the platform will not auto-trust on hostname similarity
- **Stale heartbeat windows** caused by host sleep, clock drift, or changed Authority Core URLs — the heartbeat is the freshness signal; treat its absence as data invalidity, not noise
- **Docker Desktop containers** mistaken for physical LAN truth — see "When a container looks like it works but doesn't" above. The platform now defaults Docker Desktop hosts to the native binary; the trap is older installs that still run the container
- **Active scans** configured beyond the operator-approved subnet list — collector scope is bounded by configuration; operator approval is the gate

## Related Specs

- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` — token and trust model (the binding spec)
- `docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md` — the Mode 4 native runtime ADR
- `docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md` — SNMP / LLDP / UniFi adapter design
- `docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md` — the deployment matrix and the Docker Desktop verification finding
- `docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md` — the canonical `EdgeEventEnvelope` (Slice 0)
- `docs/superpowers/specs/2026-05-21-edge-change-events-design.md` — change events on the envelope (Slice 1)
