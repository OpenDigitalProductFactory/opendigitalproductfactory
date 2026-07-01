# Feasibility: Deploying the Edge Node Across 100 Separate Client Installs

**Date:** 2026-06-24
**Status:** Feasibility analysis (no implementation)
**Question:** "How do we deploy the edge node in 100 different clients of ours?"
**Scoping answer from operator:** *100 separate installs* — each client runs their own DPF
portal — and the immediate goal is *understand feasibility*, not plan or build.

> **Scope superseded (2026-06-25):** the operator subsequently reframed the real target as
> **MSP-primary + internal company-owned resources**, not separate installs. See
> [2026-06-25-edge-node-fleet-substrate-msp-and-internal-archetypes.md](2026-06-25-edge-node-fleet-substrate-msp-and-internal-archetypes.md).
> This doc remains valid for the narrow "100 sovereign installs" question only.

---

## TL;DR

- **Edge node across 100 separate installs: feasible today, essentially free.** In the
  separate-install model the edge node co-locates with each client's own portal and
  self-enrolls to its own local Authority. There is no fleet-of-nodes problem to solve,
  because there is no shared Authority — there are 100 Authorities, each with one local node.
- **Operating 100 separate installs as a managed fleet: not feasible today.** The blocker is
  not the edge node. It is that "separate installs" deliberately has **no shared control
  plane**, and per-install self-upgrade is still maturing. You would be running 100
  hand-managed boxes.
- If centralized visibility/management across the 100 clients matters at all, the
  **MSP / one-Authority model is the architecturally-supported path** and the only one with a
  real fleet story. "Separate installs" trades all central control for client data
  sovereignty. That is the core trade-off.

---

## 1. The reframe: this is an install problem, not an edge-node problem

The edge node is a thin host agent — no portal, no DB, no LLM, outbound-only HTTPS. It always
enrolls *to* an Authority Core. See [deployment-topology.md](../../edge-node/deployment-topology.md).

In the **separate-installs** model, each client runs their own DPF portal, which **is** its own
Authority Core. The edge node co-locates with that portal and enrolls to its own local
Authority — bootstrap token auto-minted and auto-approved at install time, since choosing to
install the node on your own box is itself the consent (see [install-dpf.sh](../../../install-dpf.sh)
around the `DPF_INCLUDE_EDGE` bundle block).

So there is no fleet-of-nodes coordination to solve here. There are 100 independent
Authorities, each with exactly one local node. The real question is therefore:

> Can we stand up and operate 100 independent DPF installs?

The edge node rides along for free with each.

## 2. What works today (a single install is solid)

- **Edge is opt-in, at parity on both installers.**
  - macOS/Linux: [install-dpf.sh](../../../install-dpf.sh) — `--with-edge` / `--no-edge`,
    default OFF, resolved via recorded install-state (BI-72CFF89D).
  - Windows: [install-dpf.ps1](../../../install-dpf.ps1) — `-WithEdge` / `-NoEdge` with the
    same install-state gating and pre-flip grandfathering. (An earlier draft of this analysis
    called Windows parity a gap; that is now **closed** — verified in code 2026-06-24.)
- **Co-located node bundle exists** for every target:
  [docker-compose.edge.yml](../../../docker-compose.edge.yml) (co-located),
  plus standalone / TLS / macvlan / SNMP overlays for remote and isolated variants.
- **Per-install self-enrollment** — a bundled node mints its own bootstrap token against its
  own portal and auto-trusts. No manual step per client for the node itself.

## 3. What is missing to operate 100 of them

The gaps are about running 100 *installs*, not about the node:

1. **No cross-install control plane.** 100 separate installs = 100 independent portals, DBs,
   edge nodes, and secrets. There is no central dashboard, no "deploy to all," no fleet health
   view spanning installs. DPF's fleet machinery ([fleet-operations.md](../../edge-node/fleet-operations.md))
   is for *edge nodes under one Authority* — it does **not** span separate installs.
2. **Updates are per-install self-upgrade, and not herd-tested.** Each install pulls and
   self-upgrades independently (merge-upstream-into-durable-install-branch, local delta
   preserved). There is no staged rollout, canary, or central push. Self-upgrade still surfaces
   fresh single-box blockers — recent examples: the false-negative "upgrade failed" banner
   (unwired `reconcileQuiescenceOnBoot`, PR #2215), the git-lfs prep hook aborting checkouts,
   and quiescence/promote.sh stubs. 100 unattended self-upgrades = 100 independent failure
   surfaces.
3. **No bulk provisioning / config distribution.** Install IDs, workspace/org IDs, hostnames,
   and secrets are per-install and hand-set. No templated 100× bootstrap.
4. **No central observability or support hook.** When client #47's portal wedges, there is no
   signal unless the client reports it.

## 4. Feasibility verdict

| Dimension | Verdict |
|---|---|
| Edge node, per separate install | **Feasible today, free** — bundled, self-enrolls. |
| Edge node, Windows parity | **Done** (verified 2026-06-24). |
| Standing up 100 installs (one-by-one, manual) | Feasible but labor-linear; no bulk path. |
| Operating 100 installs as a managed fleet | **Not feasible today** — no shared control plane; self-upgrade not herd-tested. |
| Centralized visibility across clients | **Not available** in this model by design. |

## 5. The trade-off to weigh

This is the decision that actually matters, and it is architectural, not tactical:

- **Separate installs (this scenario):** maximum client data sovereignty (each client's data
  never leaves their own Authority). Cost: zero central control — provisioning, updates,
  monitoring, and support are all per-box and manual at 100×.
- **MSP / one-Authority model:** one portal you run, 100 customer accounts, scoped edge nodes
  phoning home (scope enforced server-side via `customerAccountId` + `customerSiteId`, see
  [2026-05-22 customer-site-binding spec](2026-05-22-edge-node-customer-site-binding-design.md)).
  This is the path DPF is built for and the only one with a real fleet story
  ([fleet-operations.md](../../edge-node/fleet-operations.md)). Cost: client data flows to a
  shared Authority.

If the 100 clients genuinely require sovereign installs, the edge node is not your problem —
the **install fleet** is, and closing gaps #1–#4 above (a cross-install control plane + herd-
tested self-upgrade + bulk provisioning) would be the prerequisite program of work.

## 6. References

- [docs/edge-node/deployment-topology.md](../../edge-node/deployment-topology.md) — operator mental model
- [docs/edge-node/fleet-operations.md](../../edge-node/fleet-operations.md) — rollout/upgrade/quarantine (one-Authority fleet)
- [docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md](2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) — full topology spec, EP-EDGE-TOPOLOGY gaps
- [docs/superpowers/specs/2026-05-22-edge-node-customer-site-binding-design.md](2026-05-22-edge-node-customer-site-binding-design.md) — MSP scope enforcement
- [install-dpf.sh](../../../install-dpf.sh), [install-dpf.ps1](../../../install-dpf.ps1) — edge opt-in (BI-72CFF89D)
