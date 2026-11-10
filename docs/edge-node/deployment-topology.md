# DPF Edge Node — Deployment Topology

> **What this is.** The operator's map of *where* an edge node can run and *how* it
> connects to your DPF portal. It is the front door above the developer runbooks
> ([multi-host](../install/edge-node-multi-host.md), [air-gapped](../install/edge-node-air-gapped.md)).
>
> **Design:** [`2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md)
> · **SysML:** [`2026-06-19-edge-node-deployment-sysml-architecture-note.md`](../architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md)
> · **Binding spec:** [`2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)

## The one-sentence model

Your DPF install is **one Authority Core** (the full portal) plus **zero or more edge nodes** —
small, host-resident agents that map a network and report back. An edge node is always a client
of an Authority Core; it never runs on its own.

## What an edge node is *not*

An edge node is **not a second copy of DPF**. It carries:

| | Authority Core (the portal) | Edge node |
| --- | --- | --- |
| Web portal / admin UI | ✅ | ❌ |
| Database, graph, vector store | ✅ | ❌ — just one small local state file |
| AI / LLM | ✅ | ❌ — no inference on the edge |
| Inbound network ports | serves the portal | ❌ — **outbound only**, to your Authority URL |
| What it needs to run | a full install | the Authority URL, a one-time enrollment token, a state folder |

That is why an edge node is cheap to drop onto a small box at a remote site: it only reaches
*out* to your portal and holds nothing but its own enrollment.

## Edge nodes also find your other DPF installs

Besides mapping hosts, an edge node looks for **other DPF installs** on its segment
every 90 seconds and offers them to your portal as nearby peers to pair with. That
is how two installs of one organization find each other without anyone typing a URL.

Two switches control it, and both default to on:

- `DPF_FEDERATION_SCAN` on an **edge node** — whether it looks.
- `DPF_FEDERATION_ADVERTISE` on a **portal** — whether it can be found.

On Docker Desktop the edge node cannot see your LAN, so name the peers with
`DPF_FEDERATION_SCAN_HOSTS`; the [multi-host
runbook](../install/edge-node-multi-host.md#finding-nearby-dpf-installs-federation-candidates)
has the full table. Finding a peer never grants it anything — pairing is still a
separate decision, made against your organization's certificate root.

## Edge nodes are opt-in

Installing DPF does **not** start an edge node. Mapping a network is a deliberate choice you make
— at setup, or later under **Platform → Edge Nodes**. (If you upgraded from an older install that
already ran a local edge node, it is kept; new installs start with none.)

There are two separate decisions, and it helps to keep them apart:

- **Deploy** — *do I want an edge node running here at all?* Off by default; you turn it on.
- **Trust** — *may this node submit what it finds?* A node you add on another machine arrives
  **pending** and submits nothing until you click **Approve**. A node you deliberately add on the
  portal's own machine can trust itself, because choosing it *is* the consent.

## Pick your situation

### A — Map the network from the machine that runs DPF (co-located)

The simplest case: you want to see the LAN around the box that already runs the portal.
**Platform → Edge Nodes → Add an edge node here.** On Linux, choose the host-network profile for
full LAN visibility; on Windows/macOS the native agent is used (a container on Docker Desktop
cannot see your real LAN — see [why](wsl-mirrored-note.md)).

Under the hood this is the [`docker-compose.edge.yml`](../../docker-compose.edge.yml) overlay,
now included only when you opt in.

### B — Put an edge node on a *different* machine (remote)

A box on a LAN you want to map, a branch office, a customer site. The edge node runs there; your
portal runs elsewhere (same building, a data centre, or the cloud).

**Platform → Edge Nodes → Add a node on another machine.** Tell the portal the host's OS and (for
multi-customer / multi-location setups) which context it belongs to. The portal hands you **one
command to run on the other machine** with the Authority URL and a one-time token already filled
in — no repo to clone, no file to edit. The default is a single native agent download; a Docker
one-liner is offered as a fallback.

The node appears as **pending**; click **Approve** and within a few minutes it submits its first
discovery run.

> The step-by-step substrate beneath this flow (and the manual path if you prefer it) is the
> [multi-host runbook](../install/edge-node-multi-host.md), with
> [TLS](../install/edge-node-multi-host.md#optional--upgrade-the-lan-path-to-https) and
> [air-gapped](../install/edge-node-air-gapped.md) variants.

### C — Many edge nodes across many contexts (a fleet)

Situation B, repeated, grouped by the context that matters to your business. One Authority Core is
the single pane; each node stays in its own lane (its inventory, credentials, and findings never
blur with another's). This is where the archetypes differ:

- **Retail** — one node **per location** (each store, the warehouse, HQ). Each store's network —
  POS, payment devices, Wi-Fi, cameras — is mapped and kept separate (it also keeps each store's
  PCI scope clean). See [Marisol, the retail persona](../personas/marisol-retail.md).
- **MSP (managed services)** — one node **per customer, per site**. Each customer's estate is
  strictly separated; two customers can even use the same private IP range without colliding. The
  data boundary is specified in the
  [edge-node customer-site binding design](../superpowers/specs/2026-05-22-edge-node-customer-site-binding-design.md).
- **Other multi-site businesses** — property management (per building), HOAs (per community),
  field-service trades (per yard) follow the same one-node-per-context pattern.

Running more than a handful of nodes is its own discipline — staged rollout, version skew,
quarantine, missed-heartbeat alerting, and keeping the Authority Core from becoming a bottleneck.
See [Fleet operations](fleet-operations.md). For how tokens, raw evidence, and customer-site data
stay scoped and un-leaked across a fleet, see [Security & sovereignty](security-and-sovereignty.md).

## Decision guide

| If you want to… | Situation | Start here |
| --- | --- | --- |
| See the LAN around the portal machine | A | Platform → Edge Nodes → *Add an edge node here* |
| Map a network on another machine / site | B | Platform → Edge Nodes → *Add a node on another machine* |
| Cover many stores / customers / sites | C | Add a node (B) per context; the fleet view groups them |
| Run with no internet / disconnected | B/C (air-gap) | [air-gapped runbook](../install/edge-node-air-gapped.md) |
| Not map any network | — | Do nothing — edge nodes are opt-in |

## Verifying it works

Each topology has a verification path (full matrix in the
[design spec §11.2](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md#112-verification-matrix)):
co-located + remote lifecycle via `scripts/verify-install-edge.sh`, outbound-only footprint via
`scripts/verify-edge-node-air-gap.sh`, and the multi-host runbook's own §6 assertions. Success in
every case is the same shape: the node shows **trusted** with a recent **last seen**, and a
**discovery run** carries real LAN-side addresses.

## See also

- Operator companions: [Fleet operations](fleet-operations.md) · [Security & sovereignty](security-and-sovereignty.md)
- [Single-host overlay](../../docker-compose.edge.yml) · [standalone (separate host)](../../docker-compose.edge-standalone.yml) · [TLS overlay](../../docker-compose.edge-standalone-tls.yml) · [SNMP overlay](../../docker-compose.edge-snmp.yml) · [macvlan](../../docker-compose.edge.macvlan.yml)
- [Event envelope](event-envelope.md) · [UniFi adapter](unifi-adapter.md) · [macvlan deployment](macvlan-deployment.md) · [WSL mirrored networking note](wsl-mirrored-note.md)
- Deployment doctrine: [`2026-05-09-deployment-contracts.md` Contract 5](../superpowers/specs/2026-05-09-deployment-contracts.md)
