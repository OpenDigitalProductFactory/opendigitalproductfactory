# Edge Node Deployment Topology — SysML Architecture Note

| Field | Value |
| --- | --- |
| Date | 2026-06-19 |
| Status | Draft — hand-authored SysML model over current state (interim until the Phase D extractor lands) |
| Notation | SysML v2 (`sysml2` EA notation) — viewpoint over the canonical DPF EA graph |
| Package | `PKG-EDGE-TOPO` "Edge Node Deployment Topology" |
| Owner | Enterprise Architect, Platform team |
| Source design | [`2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`](../superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) |
| Binding parent | [`2026-05-09-dpf-edge-node-design.md`](../superpowers/specs/2026-05-09-dpf-edge-node-design.md) |
| Substrate spec | [`2026-06-14-sysml-architecture-substrate-design.md`](../superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md) |
| Living-graph program | [`2026-06-16-living-architecture-graph-and-operational-bridge-design.md`](../superpowers/specs/2026-06-16-living-architecture-graph-and-operational-bridge-design.md) (Phase D — network topology bridge) |
| Model content (seed) | _planned_ `packages/db/src/seed-ea-sysml-edge-topology.ts` (filed under EP-EDGE-TOPOLOGY / EP-ARCH-GRAPH-LIVE) |

This models the **deployment topology** of the edge node (how it is deployed, where, with what footprint, at what scale) — not the discovery wire-contract internals, which the binding 2026-05-09 spec already owns. The canonical model is the DPF EA graph (`EaElement`/`EaRelationship`); this markdown is the human-readable companion and the source for the future seed. Per the substrate spec's stance, the edge node is the planned Phase D "network topology bridge" of the living-architecture program; this note is the **hand-authored interim** until that extractor makes the model self-maintaining (see §8 — the convergence plan).

**Legend.** `[D]` = deterministic fact (grounded in code/schema/scripts today). `[J]` = architect-authored judgment (design intent from the source spec, not yet realized). Verification status: **green** = automated test passes today; **planned** = future slice.

---

## SysML Architecture Note (skill template)

- **Scope:** the Authority-Core ↔ edge-node deployment relationship — deploy posture (opt-in), remote provisioning, minimal footprint, and the fleet-across-contexts pattern (base + retail + MSP). It changes the platform's deployment decomposition; it does **not** change the discovery ingestion contract.
- **Changed requirements/constraints:** REQ-EDGE-1…10 + CON-EDGE-1 (below). REQ-EDGE-3/4/5 (deploy opt-in, easy remote, footprint) are the realized-later posture changes from the source spec; REQ-EDGE-1/2/6/7 are deterministic today.
- **Changed interfaces/ports:** no change to `/api/v1/edge/*` wire shapes `[D]`; adds the portal **"add a node on another machine"** provisioning interface `[J]` and an `install-state.json` `edge` deploy-record port `[J]`.
- **Allocations:** agent → `services/edge-node-go/` + `services/edge-node/`; enrollment/trust → `apps/web/app/api/v1/edge/*` + `resolveEdgeNodeAuth`; fleet registry → `EdgeNode`/`BootstrapToken` + `/platform/edge-nodes`; deploy gate → `install-dpf.sh`/`fresh-install.ps1`/`dpf-start.*` + `docker-compose.edge*.yml`. (Full table §3.)
- **Verification cases:** VC-EDGE-LIFECYCLE, VC-EDGE-STATE, VC-EDGE-AIRGAP green today; VC-EDGE-OPTIN, VC-EDGE-REMOTE-EASY, VC-EDGE-FOOTPRINT, VC-EDGE-FLEET planned.
- **Data authority impact:** no new source-of-truth tables. Identity stays on `Principal`/`PrincipalAlias`; node state on `EdgeNode`/`BootstrapToken`/`EdgeNodeCapability`; the only new fact is a non-DB `install-state.json` `edge` record. The SysML model seeds into the existing EA graph (no new EA tables — substrate spec §3 boundary).
- **EA/current-state catch-up:** this is the first SysML coverage of the edge node at all; it closes part of the living-graph Phase D gap with a hand-authored note, ahead of the extractor.
- **Open architecture risks:** (1) note vs. future extractor drift — this note is the interim source, the extractor BI is linked (§8). (2) Default-flip migration must grandfather existing local nodes. (3) Retail per-location scope is `[J]` — depends on a site model audit. (Full list in source spec §14.)

---

## 1. Requirements (`requirement`)

Stable IDs are the `infraCiKey`s for the future EA seed (`sysml:req:REQ-EDGE-N`).

| ID | Requirement | Status |
| --- | --- | --- |
| REQ-EDGE-1 | **Authority-client topology.** An edge node is always a client of exactly one Authority Core; it registers with an Authority URL and never operates standalone. | green `[D]` |
| REQ-EDGE-2 | **Deployment-target neutral.** The same edge agent runs on Windows / macOS / Linux, container or native, against a local / LAN / cloud / TAPPaaS Authority. | green (binary parity-tested) `[D]` |
| REQ-EDGE-3 | **Opt-in deployment.** Where the platform is installed, no edge node runs unless the operator explicitly chooses it; the choice is identical across host OSes and persisted in `install-state.json`. | planned `[J]` (today: bundled+auto-trusted, the inverse) |
| REQ-EDGE-4 | **Easy remote provisioning.** An operator can add an edge node on separate hardware and connect it to the portal without cloning the repo or editing files — the portal generates a ready-to-run, token-bound artifact. | planned `[J]` |
| REQ-EDGE-5 | **Minimal footprint.** An edge node carries no portal, DB, graph/vector store, or LLM; it is one process/binary with outbound-only reach to the Authority URL + a small local state file. | partial — true of the standalone compose + Go binary `[D]`; not yet stated/tested as a contract `[J]` |
| REQ-EDGE-6 | **Trust is operator-gated for remote nodes.** Paste/remote-provisioned nodes enroll `pending` and submit nothing until an operator approves; a *chosen* local node may auto-approve (the choice is the consent). | green `[D]` |
| REQ-EDGE-7 | **Scope from the authority-issued token, never the request body.** A node's customer/site (or location) scope is bound on the bootstrap token and copied to `EdgeNode` at enrollment; runtime derives scope from the authenticated record. | green `[D]` (MSP) |
| REQ-EDGE-8 | **Fleet is first-class.** One Authority Core supports zero-or-more edge nodes; admin list, discovery evidence, adapter credentials, status, and reaping are all per-node and scope-qualified. | partial — data model green `[D]`; fleet-grouped UX planned `[J]` |
| REQ-EDGE-9 | **Retail fleet by location.** A retail org can run one edge node per store/warehouse/HQ, each scoped to its location, under one Authority Core. | planned `[J]` (retail site model gap) |
| REQ-EDGE-10 | **MSP fleet by customer × site.** An MSP can run one edge node per customer site with strict estate separation; overlapping private IP ranges are valid under different scopes. | green at data layer `[D]`; provisioning/fleet UX planned `[J]` |

## 2. Constraint / parametric (`constraint`)

**CON-EDGE-1 — Edge footprint & isolation constraint.** A deployed edge node satisfies, for all topologies:

- `inbound_listeners(edge) = ∅` — outbound-only to `DPF_AUTHORITY_URL` (FP1). `[D]`
- `persistent_stores(edge) = { state.json }` — no relational/graph/vector store (FP2). `[D]`
- `llm_runtimes(edge) = ∅` — no inference on the edge (FP3). `[D]`
- `install_artifacts(edge) ⊆ { single_binary, single_compose_file }` — no monorepo clone required (FP4). `[J]`
- `scope(node) = scope(bootstrapToken)` — derived at enrollment, server-enforced; `customerSiteId ⇒ customerAccountId`. `[D]`
- `deploy(local_node) ⇒ operator_choice ∧ recorded(install-state.json.edge)` — the deploy gate (REQ-EDGE-3). `[J]`

Realized by: the standalone/edge compose overlays' `network_mode`/`${VAR:?}` guards + `cap_add` minimalism `[D]`; `resolveEdgeNodeAuth` scope derivation `[D]`; the proposed `install-state.json` `edge` record + start-script reads `[J]`.

## 3. Part definitions (`part_definition`) and allocations

Each block is **allocated** (`sysml_allocates`) to the substrate that realizes it.

| Block (ID) | Realizing substrate (allocation) | Satisfies |
| --- | --- | --- |
| `PART-EDGE-authority` Authority Core | the full portal compose stack (`docker-compose.yml`) + `apps/web` `[D]` | REQ-EDGE-1, REQ-EDGE-8 |
| `PART-EDGE-agent` Edge Node Agent | `services/edge-node-go/` (native, default remote) + `services/edge-node/` (container) `[D]` | REQ-EDGE-1, REQ-EDGE-2, REQ-EDGE-5 |
| `PART-EDGE-enroll` Enrollment & Trust Service | `apps/web/app/api/v1/edge/enroll/route.ts` + `heartbeat/route.ts` + `resolveEdgeNodeAuth` `[D]` | REQ-EDGE-1, REQ-EDGE-6, REQ-EDGE-7 |
| `PART-EDGE-token` Bootstrap Token Service | `BootstrapToken` model + `scripts/issue-edge-bootstrap-token.ts` + Authority-side issuance `[D]`; portal-flow issuance planned `[J]` | REQ-EDGE-4, REQ-EDGE-6, REQ-EDGE-7 |
| `PART-EDGE-registry` Fleet Registry & Admin | `EdgeNode`/`EdgeNodeCapability` + `apps/web/app/(shell)/platform/edge-nodes/page.tsx` `[D]`; fleet grouping by context planned `[J]` | REQ-EDGE-8, REQ-EDGE-9, REQ-EDGE-10 |
| `PART-EDGE-deploygate` Deploy Gate | `install-dpf.sh`/`fresh-install.ps1`/`dpf-start.{sh,ps1}` + `docker-compose.edge*.yml` `[D]`; opt-in default + `install-state.json` record planned `[J]` | REQ-EDGE-3 |
| `PART-EDGE-provision` Remote Provisioning Flow | _planned_ portal "add a node on another machine" → token-bound command/bundle `[J]` | REQ-EDGE-4 |
| `PART-EDGE-ingest` Discovery Ingestion | `apps/web/app/api/v1/edge/discovery-runs/route.ts` + `adapters/route.ts` + `events/route.ts` `[D]` (owned by the binding 2026-05-09 spec) | REQ-EDGE-7, REQ-EDGE-10 |

## 4. Interfaces / ports (`interface_definition`)

| ID | Interface | Where | Status |
| --- | --- | --- | --- |
| `IF-EDGE-enroll` | `POST /api/v1/edge/enroll` (`dpfboot_*` → `dpfedge_*` + intervals) | `enroll/route.ts` `[D]` | green |
| `IF-EDGE-heartbeat` | `POST /api/v1/edge/heartbeat` (`dpfedge_*`, liveness + intervals) | `heartbeat/route.ts` `[D]` | green |
| `IF-EDGE-discovery` | `POST /api/v1/edge/discovery-runs` (scoped, idempotent, freshness-gated) | `discovery-runs/route.ts` `[D]` | green |
| `IF-EDGE-adapters` | `GET /api/v1/edge/adapters` (scope-filtered adapter config) | `adapters/route.ts` `[D]` | green |
| `IF-EDGE-events` | `POST /api/v1/edge/events` (canonical event envelope) | `events/route.ts` `[D]` | green |
| `IF-EDGE-provision` | portal "add a node on another machine" → token-bound install artifact | spec §8 `[J]` | planned |
| `IF-EDGE-deployrecord` | `install-state.json` `edge:{enabled,mode}` read by start scripts + portal | spec §5.2 `[J]` | planned |

## 5. State machines (`state`)

**SM-DEPLOY — Local deploy gate** `[J]` (REQ-EDGE-3):
`absent (default) → operator-chooses → recorded(install-state) → overlay-included → enrolled`. Today the path is `installed → bundled → auto-enrolled → auto-trusted` with no `absent` start state — that inversion is what this model changes.

**SM-TRUST — Node trust lifecycle** `[D]` (REQ-EDGE-6):
`pending → trusted → { quarantined → trusted | revoked(terminal) }`. Local chosen node may transition `enrolled → trusted` automatically (consent = the choice); remote node holds at `pending` until operator approve.

**SM-ENROLL — Agent enrollment** `[D]`:
`first-run(has bootstrap token) → enroll → persist state.json(node token) → { heartbeat-loop ∥ sweep-loop } → on 401 node_revoked → clear state → exit`. Subsequent runs skip enroll and read `state.json`.

## 6. Verification cases (`verification_case`)

| ID | Verifies | Evidence | Status |
| --- | --- | --- | --- |
| VC-EDGE-LIFECYCLE | REQ-EDGE-1, REQ-EDGE-6 | `services/edge-node/scripts/verify-lifecycle.ts`; `scripts/verify-install-edge.sh` | **green** |
| VC-EDGE-STATE | REQ-EDGE-5 (state-only persistence) | `services/edge-node/src/__tests__/state.test.ts` | **green** |
| VC-EDGE-AIRGAP | CON-EDGE-1 (outbound-only) | `scripts/verify-edge-node-air-gap.sh` | **green** |
| VC-EDGE-REMOTE-LAN | REQ-EDGE-1, REQ-EDGE-2 | `docs/install/edge-node-multi-host.md` §6 runbook gate | **green** (manual runbook) |
| VC-EDGE-OPTIN | REQ-EDGE-3 | default install runs no node; opt-in adds one; Win/bash parity via `install-state.json` | planned |
| VC-EDGE-REMOTE-EASY | REQ-EDGE-4 | portal-generated command enrolls a node with no repo clone / file edit | planned |
| VC-EDGE-FOOTPRINT | REQ-EDGE-5 / CON-EDGE-1 (FP1–FP4) | egress allow-list + image bill-of-materials + no-clone install assertions | planned |
| VC-EDGE-FLEET-MSP | REQ-EDGE-10 | two nodes, different customer/site scope, isolated inventory/adapters/evidence | planned |
| VC-EDGE-FLEET-RETAIL | REQ-EDGE-9 | two nodes, different location scope, isolated posture | planned (after retail site model) |

## 7. Traceability summary

```
REQ-EDGE-1 ──satisfies── PART-EDGE-authority, PART-EDGE-agent, PART-EDGE-enroll ──verifies── VC-EDGE-LIFECYCLE ✓
REQ-EDGE-3 ──satisfies── PART-EDGE-deploygate ──verifies── VC-EDGE-OPTIN (planned)
REQ-EDGE-4 ──satisfies── PART-EDGE-provision, PART-EDGE-token ──verifies── VC-EDGE-REMOTE-EASY (planned)
REQ-EDGE-5 ──satisfies── PART-EDGE-agent ──refines── CON-EDGE-1 ──verifies── VC-EDGE-STATE ✓, VC-EDGE-AIRGAP ✓, VC-EDGE-FOOTPRINT (planned)
REQ-EDGE-7 ──satisfies── PART-EDGE-enroll, PART-EDGE-token ──verifies── (covered by VC-EDGE-FLEET-*)
REQ-EDGE-10 ─satisfies── PART-EDGE-registry, PART-EDGE-ingest ──verifies── VC-EDGE-FLEET-MSP (planned)
CON-EDGE-1 ──refines──── REQ-EDGE-5, REQ-EDGE-7, REQ-EDGE-3
PART-EDGE-agent ──sysml_allocates──▶ code:subsystem:services/edge-node-go
PART-EDGE-registry ──sysml_traces──▶ prisma:model:EdgeNode   (the Phase-D cross-layer edge, per PR #2073 pattern)
PART-EDGE-enroll ──sysml_traces──▶ archimate:application_component (edge enrollment API)
```

## 8. What is modeled now vs. the extractor convergence plan

**Authored now `[J]` (this note):** the full deployment-topology model — REQ-EDGE-1…10, CON-EDGE-1, the eight parts, interfaces, three state machines, nine verification cases. Hand-authored architect judgment over verified current state.

**Deterministic today `[D]`:** the Authority-client topology, deployment-target-neutral binary, outbound-only footprint, pending→approve trust, and scope-from-token are all real and test-backed (VC-EDGE-LIFECYCLE / STATE / AIRGAP green).

**Convergence plan (Phase D extractor).** This note is the **interim source of truth**. The living-architecture program's network-topology bridge will add `buildEdgeTopologyModel(facts) → SysmlDesiredModel`, projecting each live `EdgeNode` row as a `part_usage` (`layer="network"`, `refinementLevel="actual"`, `sysmlKey="runtime:edge-node:<nodeId>"`) allocated to `PART-EDGE-agent` and `traces`-linked to `prisma:model:EdgeNode` — the cross-layer edge pattern established by PR #2073. When that lands, the *actual* fleet self-maintains in the graph and this note keeps only the *logical* definitions + judgment. The extractor is filed against EP-ARCH-GRAPH-LIVE (source spec §13 BI 5) so the two never compete.
