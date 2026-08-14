# DPF Edge Node — Fleet Operations

> **What this is.** The operator runbook for running **many** edge nodes against one DPF
> Authority Core: rollout, version, rotation, quarantine, decommission, and the health signals
> that keep a fleet from overwhelming the portal. For *where* nodes run, see the
> [deployment topology guide](deployment-topology.md); for token/data handling, see
> [security & sovereignty](security-and-sovereignty.md).
>
> **Design:** [topology spec §7, §8A.3, §11.2](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md)
> · **SysML:** [`PART-EDGE-fleetops`, `SM-LIFECYCLE`, `VC-EDGE-SCALE`](../architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md)

## The fleet contract in one paragraph

Every edge node is an independently enrolled, scoped, trusted, and reaped client of **one**
Authority Core. The Authority Core is the single pane of glass and the only system of record.
Nodes **observe and submit**; the Authority **authenticates, scopes, persists, decides, and
presents**. Everything below exists so that scaling the number of nodes does not turn the portal
into a bottleneck or the edge into a second management platform.

## Node operational lifecycle

The portal keeps health and trust as independent axes:

- **Health:** `setup-required`, `starting`, `healthy`, `degraded`, `offline`, `quarantined`, or `revoked`. Health is derived server-side from heartbeat age, capability reports, version compatibility, and trust; a stale stored `active` value never wins.
- **Trust:** `pending`, `trusted`, `quarantined`, or `revoked`. These are durable, operator-governed `EdgeNode.trustState` values.

That distinction matters: a trusted node may be offline, and a quarantined node may still heartbeat. The Authority retains revoked rows and their scoped evidence for audit.

The first fleet member is **This DPF installation**. Installer-issued auto-approval is its identity evidence. On Windows and macOS, every governed install/repair stages the verified native artifact, converges Task Scheduler/launchd supervision, restores the prior binary if restart fails, and reuses the existing machine enrollment. Remote MSP/customer nodes remain separately scoped by customer and site; each fleet row names its first failed readiness check and next action.

## Rollout (adding nodes at scale)

Add nodes through the portal flow, not by hand-cloning the repo (see
[topology §8](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md)).
For a fleet:

- **Stage by scope.** Roll out customer-by-customer (MSP) or region-by-region (retail), not all at
  once — a staged rollout keeps the first-heartbeat thundering herd bounded and lets you catch a bad
  build early.
- **One node per context.** One node per customer × site (MSP) or per location (retail). Do not
  multi-home one node across contexts — scope is per node and enforced server-side.
- **Expect `pending`.** Remote nodes land `pending`; approve them deliberately. A burst of unexpected
  `pending` nodes with unfamiliar hostnames is a signal, not a chore — investigate before approving.

## Versioning and upgrades

- **Signed, staged.** Edge binaries/images are release artifacts (deployment Contract 1) — pull by
  pinned tag, verify the checksum/signature, and roll forward by scope.
- **Compatibility window.** The agent and the Authority `/api/v1/edge/*` contract maintain a version
  compatibility window; a fleet will always be briefly mixed-version. Track **version skew** on the
  fleet dashboard and treat large skew as `degraded`.
- **Rollback path.** Keep the prior pinned tag reachable so a bad edge release rolls back without
  re-enrollment (state survives in the node's state volume/dir).

## Rotation, quarantine, decommission

| Action | When | How | Effect |
| --- | --- | --- | --- |
| **Rotate node token** | suspected token exposure; periodic hygiene | portal node action | new `dpfedge_*`; old token invalid on next call |
| **Re-issue bootstrap token** | a generated install command leaked / expired | portal "issue token" | new one-use short-TTL `dpfboot_*`; old one already single-use |
| **Quarantine** | anomalous submissions; investigation | portal node action | node may heartbeat (stays visible) but discovery/metrics are **rejected/diverted** at the route layer |
| **Revoke** | decommission; compromise | portal node action | node clears state and exits on next heartbeat; evidence retained, scoped |
| **Retire** | row no longer needed | retention workflow | archived per retention class |

Quarantine being **route-effective** (not just a label) is the invariant: a quarantined node cannot
keep feeding the inventory graph while you investigate.

## Health signals to watch (and alert on)

These come from the Authority-side observability surface, **not** from scraping remote nodes
(see [security & sovereignty](security-and-sovereignty.md) and topology §8A.4):

- **Missed-heartbeat rate by scope** — alert on the *rate* across a scope, not only per-node misses.
- **Ingest error / discovery payload rejection rate** — rising rejections mean a bad collector, clock
  skew (freshness window), or a misconfigured node.
- **Ingest backlog / projection lag** — the graph/reporting projection is async; a growing backlog is
  the early sign of fan-in pressure.
- **Metrics cardinality budget** — per-interface/per-host labels explode Prometheus series; keep them
  in inventory tables, alert when the budget is approached.
- **Version skew** — share of the fleet off the current pinned release.
- **Stale `pending` nodes / tokens** — enrolled-but-never-approved nodes and unused tokens are both
  cleanup and security signals.
- **Token reuse / quarantine attempts** — security signals worth a dedicated alert.

## Fan-in controls (why the fleet stays healthy)

The Authority Core is the fan-in point by design. The controls that keep that correct rather than
fragile (topology §8A.3): server-assigned heartbeat intervals **with jitter**, per-scope concurrency
caps, payload size/rate caps, `runKey` idempotency, **async** projection to Neo4j/Qdrant/reporting,
bounded offline queues with drop-oldest-by-class, and visible backlog gauges. Validate them with the
synthetic fleet harness (100 / 1,000-node profiles, `VC-EDGE-SCALE`) before a broad rollout.

## See also

- [Deployment topology](deployment-topology.md) · [Security & sovereignty](security-and-sovereignty.md)
- [Multi-host runbook](../install/edge-node-multi-host.md) · [Air-gapped runbook](../install/edge-node-air-gapped.md)
- MSP scope boundary: [edge-node customer-site binding design](../superpowers/specs/2026-05-22-edge-node-customer-site-binding-design.md)
- Doctrine: [deployment-contracts Contract 5 + Contract 7](../superpowers/specs/2026-05-09-deployment-contracts.md)
