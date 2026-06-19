# DPF Edge Node — Security & Sovereignty

> **What this is.** How edge-node deployment handles secrets, network trust, raw evidence, and data
> sovereignty so a remote agent never becomes a leak path or an open door into a customer network.
> Pairs with [fleet operations](fleet-operations.md) (running many nodes) and the
> [deployment topology guide](deployment-topology.md) (where they run).
>
> **Design:** [topology spec §8A.1–8A.2, §8A.4, §6 (FP5–FP7), §11.1](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md)
> · **SysML:** [`CON-EDGE-2`, `REQ-EDGE-11/12/14`, `VC-EDGE-NETAUTH/SOVEREIGNTY/OBS`](../architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md)
> · **Binding auth model:** [`2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md)

## The one rule that drives the rest

**Remote nodes call home; the Authority Core never calls into a customer LAN.** Everything is an
outbound, authenticated push from the edge to `DPF_AUTHORITY_URL`. There is no inbound port on the
edge node — not for control, not for scraping, not for support. This is what makes it safe to drop a
node into a branch office or a customer site behind NAT.

## Network boundary

- **Outbound HTTPS** to the Authority URL is the production default. Plain HTTP is acceptable only for
  a local dev harness or an explicitly documented private-network bootstrap; remote provisioning uses
  HTTPS and supports an operator CA bundle (`docker-compose.edge-standalone-tls.yml` +
  `scripts/issue-authority-tls-cert.sh`).
- **No inbound listener** on the edge node (footprint contract FP1). It is not a Prometheus scrape
  target (FP5) — metrics flow out via `/api/v1/edge/metrics`.
- **Firewall posture:** the node needs egress to the Authority host/port only. A customer site can
  allow-list exactly that destination; the [air-gap harness](../../scripts/verify-edge-node-air-gap.sh)
  proves zero off-allow-list egress.

## Tokens

Two token types, neither of which can authorize a human, coworker, MCP client, A2A peer, or another node:

- **`dpfboot_*` — bootstrap (enrollment) token.** One-time, short-TTL, scope-bound, issued from the
  Authority. The portal shows it **once**; re-rendering means re-issuing, not recovering.
- **`dpfedge_*` — node credential.** Held only in the node's `state.json` (mode 0600); used for
  heartbeat, discovery, metrics. Rotatable from the portal.

**Treat a generated install command as a visible secret.** A copy-paste command is intentionally
easy — and can leak through shell history, screenshots, ticket comments, or logs. Mitigations
(topology §8A.2, risk §14.6): short TTL, one-use semantics, one-time display, redaction in
audit/log output, and a revoke/re-issue path that is *easier* than recovering a token. If in doubt,
re-issue.

## Authorization (server-side, every request)

- Route handlers derive `edgeNodeId`, `principalId`, trust state, and customer/site/location scope
  from the **authenticated node record** via `resolveEdgeNodeAuth` — never from the request body.
  Identity/scope fields in edge-submitted JSON are ignored or rejected.
- **Quarantine is route-effective:** a quarantined node may heartbeat (so you can see it) but its
  discovery/metrics submissions are rejected or diverted to a forensic holding path.
- **Remote-control is out of scope here.** Remote shell, reverse tunnel, MCP/A2A gatewaying, and
  remediation are *not* part of deployment/provisioning. Each is a future capability needing explicit
  customer consent, a least-privilege capability flag, audit rows, and its own security review.

## Data sovereignty

Edge observations are not generic telemetry — a discovered MAC, hostname, SSID, VLAN, payment
terminal, camera, or controller IP can identify a real site and may be **regulated evidence**.
Sovereignty follows the **operator/control boundary**, not just where bytes sit:

- **One system of record.** Authority Core. The edge stores only its credential, interval/heartbeat
  state, local retry queue, and capability hints needed to survive a short outage.
- **Scope every derived record.** Discovery runs, adapter fetches, metrics, ingest failures,
  quarantine attempts, and token events carry authenticated org / customer / site / location / node /
  capability / observed-time scope. Scope comes from auth, not payload.
- **Retain raw evidence by class.** `rawData`, SNMP labels, and controller metadata are kept as
  short-lived raw evidence, separate from normalized inventory and aggregate metrics. Raw payloads do
  **not** go into Prometheus labels, Grafana annotations, or long-lived audit text.
- **No SaaS export by default.** Exporting edge evidence to a third-party monitoring SaaS is a
  deliberate, recorded *lower-assurance* estate choice — never hidden platform behavior. Sovereign
  deployments keep it off.
- **Feed the sovereignty program, don't fork it.** Per-element jurisdiction/operator posture lives in
  the estate-sovereignty program ([EP-ESTATE-SOVEREIGNTY](../superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md));
  this topology supplies scoped edge facts to it rather than inventing a separate compliance register.

## Observability without leakage

Prometheus/Grafana are **Authority-side views over accepted, scoped data** — not the edge protocol
(topology §8A.4):

- The Authority Prometheus scrapes local/platform targets and an Authority-side fleet exporter; it
  **never** scrapes remote customer nodes.
- **Bounded labels** (`CON-EDGE-2`): metric labels are low-cardinality identifiers only — scope ids,
  node id, capability, trust state, version family. Interface names, MACs, hostnames, VLANs, and
  controller object names stay in inventory/query tables.
- **Dashboards are views, not governance.** Grafana is provisioned from version-controlled files,
  filtered by scope, and may deep-link to `/platform/edge-nodes` — but approve/quarantine/revoke
  happen in DPF under DPF authorization.
- Redaction and retention tests must cover **observability outputs** (labels, annotations, support
  bundles, screenshots), not only API payloads — that is where sovereignty most easily leaks.

## Verification

`VC-EDGE-NETAUTH` (token discipline + route auth + quarantine matrix + no inbound listener),
`VC-EDGE-SOVEREIGNTY` (scope present, raw identifiers absent from labels/logs, SaaS off),
`VC-EDGE-OBS` (Authority-side dashboards without scraping remotes, label budget held), and the
egress proof in `scripts/verify-edge-node-air-gap.sh`. Full matrix:
[topology spec §11.2](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md#112-verification-matrix).

## See also

- [Deployment topology](deployment-topology.md) · [Fleet operations](fleet-operations.md)
- TLS path: [multi-host runbook → HTTPS](../install/edge-node-multi-host.md#optional--upgrade-the-lan-path-to-https)
- Doctrine: [deployment-contracts Contracts 4, 5, 8](../superpowers/specs/2026-05-09-deployment-contracts.md)
