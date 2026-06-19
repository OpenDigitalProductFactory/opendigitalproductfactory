# Edge Node Deployment Topology & Remote Provisioning — Design

| Field | Value |
| --- | --- |
| Date | 2026-06-19 |
| Status | Draft — for review |
| Author | Claude (Opus 4.8) with founder direction |
| Epic | EP-EDGE-TOPOLOGY (proposed) — see §13 |
| Supersedes | nothing; **extends** the binding edge-node design |
| Binding parent | [`2026-05-09-dpf-edge-node-design.md`](2026-05-09-dpf-edge-node-design.md) (binding) |
| Doctrine | [`2026-05-09-deployment-contracts.md`](2026-05-09-deployment-contracts.md) Contract 5 (Edge) |
| Related | [`2026-05-20-edge-node-deployment-matrix.md`](2026-05-20-edge-node-deployment-matrix.md), [`2026-05-22-edge-node-customer-site-binding-design.md`](2026-05-22-edge-node-customer-site-binding-design.md), [`2026-05-16-edge-node-runtime-decision.md`](2026-05-16-edge-node-runtime-decision.md), [`2026-06-16-living-architecture-graph-and-operational-bridge-design.md`](2026-06-16-living-architecture-graph-and-operational-bridge-design.md) |
| SysML companion | [`docs/architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md`](../../architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md) |
| Operator doc | [`docs/edge-node/deployment-topology.md`](../../edge-node/deployment-topology.md) |

> **Legend.** `[D]` = deterministic fact grounded in current code/schema/scripts. `[J]` = architect judgment / proposed change not yet realized.

---

## 1. Problem Statement

The edge node is the right architecture for **remote network visibility**: a host-resident agent that enrolls against a DPF Authority Core (the portal) and submits LAN/device/topology observations. The implementation is mature — TypeScript container + Go native binary, a full enrollment/heartbeat/discovery wire contract, customer/site-scoped fleet binding, and standalone/TLS/SNMP/air-gap compose overlays all exist today.

But the **deployment topology** around it is not yet described as one coherent, supportable, testable architecture, and its default posture is wrong for the product. The founder's direction names six concrete gaps:

1. **It is bundled and active by default; it must be opt-in.** Every install — `install-dpf.sh` and Windows `fresh-install.ps1` — bundles the edge-node container, **auto-issues a bootstrap token (`--auto-approve`)**, writes it to `.env`, and force-recreates the container so the local node **auto-enrolls and auto-trusts**. `[D]` This is silent default-on. Where the platform is installed, running an edge node should be a deliberate operator choice.
2. **There is no *easy* way to put an edge node on separate hardware and connect it to the portal.** The capability exists (`docker-compose.edge-standalone.yml`, the multi-host runbook), but the path requires cloning the whole monorepo onto the second host just for a compose file, hand-editing `.env`, copying a token out-of-band, and re-approving in the portal. `[D]` That is a developer runbook, not an operator experience.
3. **The edge install does not need everything the portal has — but that minimal footprint is not a described contract.** The standalone compose is already lean (no portal/postgres/neo4j/qdrant/LLM), and the Go binary is a single static executable. `[D]` Yet "what an edge node needs vs. what an Authority Core needs" is nowhere stated as a first-class footprint contract we can support and test against. `[J]`
4. **The architecture is not described uniformly across documentation, SysML, and specifications.** Docs exist but are scattered (multi-host, air-gapped, deployment-contracts Contract 5, user guide). The edge node is **not yet in the SysML/EA graph** (it is the planned-but-unbuilt "network topology bridge", Phase D of [EP-ARCH-GRAPH-LIVE]). `[D]` There is no single deployment-topology description tying local/remote/fleet together.
5. **Some archetypes deploy *many* edge nodes in different contexts, and that is not a base-architecture concept.** MSPs run an edge node per customer per site (the customer/site-binding spec already models the data boundary). Retail runs one per store/warehouse/HQ. `[D for MSP data model; J for the topology framing]` The "one Authority Core, a fleet of edge nodes across many contexts" pattern must be a base-architecture consideration and then specialized per archetype — not an MSP-only special case.
6. **The operational risk envelope is under-specified.** The draft describes how to deploy nodes, but not enough about the fan-in bottleneck at the Authority Core, site-to-site data sovereignty, telemetry cardinality, token exposure in generated commands, Prometheus/Grafana boundaries, or how a fleet is upgraded, quarantined, and observed without turning the edge node into a second management platform. `[J]`

This spec consolidates the deployment topology, flips the default posture to opt-in, defines the easy-remote provisioning experience and the minimal-footprint contract, models the system in SysML, gives a per-topology verification matrix, adds the multi-node fleet consideration to the base architecture and to the retail and MSP archetypes, and makes the operational/security/observability constraints first-class.

**This spec introduces no new identity-bearing tables.** It reuses `EdgeNode`, `BootstrapToken`, `EdgeNodeCapability`, and the `customerAccountId`/`customerSiteId` scope already on those models (Principal convergence preserved by the Data-Model Stewardship section). The work is posture, packaging, UX, description, operational management, and verification — not new identity substrate.

---

## 2. Current State (what already exists — credit the substrate)

A substrate sweep (code + specs + scripts + live backlog, 2026-06-19) found the edge node is far denser than a first read suggests. The table separates *capability that exists* from *the gap this spec closes*.

| Concern | Exists today `[D]` | Gap this spec closes |
| --- | --- | --- |
| Agent runtime | TypeScript container (`services/edge-node/`, Phase 0) + Go native binary (`services/edge-node-go/`, T3). Same `/api/v1/edge/*` wire contract; parity-tested. | Name the Go binary the **default remote artifact**; describe the footprint as a contract. |
| Enrollment | `POST /api/v1/edge/enroll` consumes a single-use `dpfboot_*` token, returns a `dpfedge_*` node token + intervals. Heartbeat + discovery-runs follow. | Make the *local* bundled node deploy opt-in; keep the remote node's pending→approve trust gate. |
| Trust | `trustState`: pending→trusted→quarantined→revoked. Installer-local tokens auto-approve; paste-provisioned remote tokens land pending. | Local install must default to **not enrolling at all**, not "enroll + auto-trust". |
| Co-located deploy | `docker-compose.edge.yml` overlay; default-ON via `DPF_INCLUDE_EDGE=1` (bash) and **hardcoded** in both `dpf-start.ps1` files (no Windows opt-out). | Flip default to **opt-in**; add Windows parity for the opt-out/opt-in choice. |
| Remote deploy | `docker-compose.edge-standalone.yml` (complete on its own — no portal/db), `-standalone-tls.yml`, `-snmp.yml`, `.macvlan.yml`. Multi-host + air-gapped runbooks. | Replace "clone the monorepo + hand-edit .env" with a portal-generated, copy-paste / single-artifact provisioning flow. |
| Fleet scoping | `BootstrapToken.targetCustomerAccountId/SiteId` → copied to `EdgeNode.customerAccountId/SiteId` at enrollment; adapters + discovery runs filtered by authenticated scope. | Elevate "fleet across contexts" to base architecture; add retail; document operator UX for many nodes. |
| Identity | `Principal(kind="edge_node")` + `PrincipalAlias` + `EdgeNode` side table. | Unchanged — reused. |
| Authorization boundary | Edge routes authenticate the node token and derive scope from `resolveEdgeNodeAuth`; binding spec forbids identity/scope from request bodies. | Pull the binding spec's auth invariants into this topology so provisioning, observability, and fleet UX never bypass them. |
| Observability | Portal-side Prometheus/Grafana already monitor local platform services; edge `metrics-loop.ts` pushes SNMP interface metrics to `/api/v1/edge/metrics`. | Define the rule: Prometheus/Grafana visualize accepted Authority data; they do not become inbound scrape dependencies for remote customer-site nodes. |
| Data sovereignty | Founder-kernel principle exists; estate-sovereignty spec tracks per-element posture work. | Treat customer/site/location-scoped observations as sovereignty-relevant evidence; preserve locality, scope, retention, and operator-jurisdiction metadata. |
| Scale / bottlenecks | Heartbeats, discovery submissions, and metrics all fan into the Authority Core. | Add quotas, jitter, backpressure, retention, async projection, cardinality budgets, and fleet SLOs before calling the topology ready. |
| Admin UX | `/platform/edge-nodes`: issue token, approve, quarantine, revoke. | Add a guided "add a node on another machine / another site" flow; fleet grouping by customer/site. |
| SysML / EA | **Absent.** Planned as the Phase D "network topology bridge" of the living-architecture graph. | Author the SysML architecture note now (§9) and define the extractor. |
| Verification | `scripts/verify-install-edge.sh`, `scripts/verify-edge-node-air-gap.sh`, `services/edge-node/scripts/verify-lifecycle.ts`, multi-host runbook §6. | Unify into a per-topology verification matrix (§11). |

**Key inconsistencies found:**

- `install-dpf.sh:136` defaults `DPF_INCLUDE_EDGE=1` and (lines 873–946) auto-issues an `--auto-approve` token, writing it to `.env` and force-recreating `edge-node`. `fresh-install.ps1:299–392` mirrors this on Windows with **no `--no-edge` equivalent**. `[D]`
- `scripts/dpf-start.ps1` and root `dpf-start.ps1` both **hardcode** `-f docker-compose.edge.yml` with no opt-out, while `dpf-start.sh` honors `--no-edge`/`DPF_INCLUDE_EDGE=0`. The two host surfaces disagree. `[D]`
- The multi-host runbook calls the pending→approve step "the friction that makes Edge Node enrollment opt-in" — but that governs *trust of a remote node*, not *whether the local node deploys*. The local node is auto-approved, i.e. fully silent. `[D]` The product needs deploy-opt-in, distinct from trust-opt-in.

---

## 3. Goals / Non-Goals

**Goals**

- G1. Edge node deployment is **opt-in** where the platform is installed: default OFF, an explicit operator choice turns it on, identical on Windows / macOS / Linux.
- G2. An operator can add an edge node on **separate hardware** and connect it to the portal **without cloning the repo or hand-editing files** — a portal-driven flow that yields a single copy-paste command (or downloadable minimal bundle) with the enrollment token pre-bound.
- G3. The **minimal edge footprint** is a described, testable contract — what an edge node requires, and explicitly what it does *not* (no DB, no LLM, no web app, outbound-only to the Authority URL).
- G4. The architecture is described coherently in **documentation, SysML, and specification** form, each pointing to the others as a single source-of-truth chain.
- G5. "One Authority Core, a **fleet** of edge nodes across many contexts" is a **base-architecture** concept, specialized for **retail** (per location) and **MSP** (per customer × site).
- G6. A per-topology **verification matrix** lets us test each deployment shape on its real substrate.
- G7. Remote deployment preserves **data sovereignty and tenant/estate separation**: observations, raw adapter payloads, metrics, logs, and dashboards are scoped to the Authority-issued customer/site/location boundary and governed by retention.
- G8. Network and auth are explicit: remote nodes use **outbound-only HTTPS** to Authority Core; token issuance is one-time, short-TTL, audit-logged, redacted, and scope-bound; authorization never trusts edge-submitted identity or scope.
- G9. Operational management covers **fleet scale**: rollout, rotation, quarantine, missed-heartbeat reaping, ingest backpressure, async projection, and per-node/per-scope quotas are part of the topology, not follow-up polish.
- G10. Prometheus/Grafana are integrated as **Authority-side observability surfaces** with bounded labels and provisioned dashboards; they do not scrape remote customer nodes directly or create a parallel source of truth.

**Non-Goals**

- No change to the edge wire contract, the `dpfboot_*`/`dpfedge_*` token model, or the discovery ingestion controls (the binding 2026-05-09 spec remains authoritative for those).
- No mTLS / client-cert work (that is the binding spec's Phase 1+ / T4 track).
- No new customer-estate modeling beyond the existing customer/site scope.
- No removal of the developer runbooks; they remain the substrate the easy flow wraps.
- No edge-hosted Prometheus/Grafana requirement. A customer site may already run local observability, but this topology does not require or manage a second monitoring stack at the edge.
- No remote-support/control-plane tunneling in this slice. Discovery and telemetry are observation flows; any future remote-control action needs explicit customer consent and a separate authorization review.

---

## 4. The Deployment Topology Model

One **Authority Core** (the full portal install) owns identity, policy, the inventory graph, and the admin surface. Around it sits a **fleet of edge nodes**, each a thin host-resident agent. An edge node is *always* a client of an Authority Core; it never stands alone. Three deployment **situations** compose from that one relationship:

```
                          ┌─────────────────────────────────────────┐
                          │            DPF Authority Core            │
                          │  portal · postgres · neo4j · qdrant ·    │
                          │  LLM routing · /api/v1/edge/* ingestion · │
                          │  /platform/edge-nodes admin + fleet view │
                          └───────────────▲───────────▲─────────────┘
        enroll/heartbeat/discovery (HTTPS)│           │
            outbound from edge → Authority │           │
        ┌──────────────────────┬──────────┘           └────────────────────┐
        │                      │                                            │
 ┌──────┴───────┐     ┌────────┴─────────┐                       ┌──────────┴──────────┐
 │ (A) Co-located│     │ (B) Remote node  │                       │ (C) Fleet across     │
 │ opt-in node   │     │ on separate HW   │                       │ contexts (B ×N)      │
 │ same host as  │     │ another machine/ │                       │ retail: per store    │
 │ Authority     │     │ site/LAN         │                       │ MSP: per customer×site│
 └───────────────┘     └──────────────────┘                       └──────────────────────┘
```

### 4.1 Situation A — Co-located, opt-in (the local node)

The edge node runs on the same host as the Authority Core, in the same compose project (`docker-compose.edge.yml`). Useful for a single-site business that wants to map its own LAN from the box that already runs DPF.

**Change (G1):** this is **opt-in**, default OFF. The platform installs and runs with no edge node unless the operator chooses to add one. Choosing it is a single decision at setup (or later, from `/platform/edge-nodes`), surfaced as a plain choice — not a token-paste chore.

### 4.2 Situation B — Remote, on separate hardware (the remote node)

The edge node runs on a **different machine** from the Authority Core — a box on the LAN to be mapped, a branch office, a customer site. It carries no portal, no database, no LLM. It needs only outbound reach to the Authority URL and a one-time enrollment token. This is the situation the founder flagged as having "no easy way" today.

**Change (G2):** the portal's `/platform/edge-nodes` gains an **"Add a node on another machine"** flow that:

1. Captures the node's intended scope (and, for MSP, the target customer/site) and a friendly name.
2. Issues a bootstrap token bound to that scope (existing `BootstrapToken` machinery).
3. Renders **one copy-paste provisioning command** (and a downloadable equivalent) with the Authority URL and token already substituted — defaulting to the **Go native binary** so the remote host needs neither Docker nor a repo clone. A Docker one-liner against `docker-compose.edge-standalone.yml` (pulled by URL, not cloned) is the fallback for hosts that prefer containers.
4. Shows the node arriving in `pending`, with an **Approve** button (trust-opt-in preserved).

### 4.3 Situation C — Fleet across contexts (many remote nodes)

Situation B repeated N times, grouped by the context that matters to the business. The Authority Core is the single pane; each node is scoped so its inventory, adapter credentials, and discovery evidence stay in their lane. This is where archetypes diverge (§7).

### 4.4 Planes and failure domains

The topology is easier to reason about if it is split into four planes. The edge node participates in all four, but Authority Core remains the owner of meaning and policy.

| Plane | Flow | Owner of truth | Failure posture |
| --- | --- | --- | --- |
| **Provisioning** | Operator UI → bootstrap token → generated command/bundle → enrollment | Authority Core (`BootstrapToken`, `EdgeNode`, audit) | Token expires or is consumed once; operator can re-issue without touching remote state. |
| **Control** | Heartbeat, capability enablement, trust-state changes, token rotation | Authority Core policy + `EdgeNode.trustState` | Edge node denies privileged capabilities when policy is stale beyond its allowed soft-fail window. |
| **Data** | Discovery runs, adapter observations, inventory relationships | Authority Core persistence + scope fields | Submissions are idempotent by `runKey`; projection to graph/reporting is async and retryable. |
| **Telemetry** | Health, interface metrics, ingest errors, version drift, queue/backlog gauges | Authority Core observability store; Prometheus/Grafana are views | Metrics are lossy/bounded where appropriate; missing heartbeat and ingest failure are alertable. |

This split prevents two architectural traps: (1) treating the edge node as a small second portal, and (2) treating Prometheus/Grafana as the source of edge truth. Edge nodes observe and submit; Authority Core authenticates, scopes, persists, decides, and presents.

---

## 5. Opt-In Posture (G1)

### 5.1 Two independent gates — name them

- **Deploy gate** — *is an edge node running here at all?* Today: implicitly yes (bundled). Target: **no, unless chosen.**
- **Trust gate** — *may this enrolled node submit observations?* Today: local auto-approves; remote lands pending. Target: **unchanged** — remote stays pending→approve; a *chosen* local node may auto-approve because choosing it is the consent.

The founder's "it needs to be opt-in" is about the **deploy gate**. The existing pending→approve friction is the trust gate and is correct; this spec leaves it intact.

### 5.2 Changes `[J]`

| Surface | Today `[D]` | Target |
| --- | --- | --- |
| `install-dpf.sh` | `DPF_INCLUDE_EDGE=1` default; auto-issues `--auto-approve` token | Default `DPF_INCLUDE_EDGE=0`; `--with-edge` opt-in flag; no token auto-issue unless opted in |
| `fresh-install.ps1` | hardcoded edge bootstrap, no opt-out | Mirror bash: default off; `-WithEdge` switch; parity with `--with-edge` |
| `dpf-start.sh` | honors `--no-edge`/`DPF_INCLUDE_EDGE=0`, default on | Default off; `--with-edge`/`DPF_INCLUDE_EDGE=1` to include; **read the persisted setup choice** from `install-state.json` |
| `dpf-start.ps1` (both) | hardcoded `-f docker-compose.edge.yml` | Read the persisted choice; include the overlay only when chosen; Windows parity |
| Setup UX | none | One plain choice: "Map this network from this machine? (adds an edge node)" — default No, with a one-line plain-language explanation |
| `/platform/edge-nodes` | manage existing | "Add an edge node here" (local) and "Add on another machine" (remote) as first-class actions |

`install-state.json` already records compose files and mode (`compose.sh` writes `composeFiles`); it gains an `edge: { enabled, mode }` record so start/stop scripts and the portal agree on whether the local node is part of this install — one source of truth, no drift between the two `dpf-start.ps1` files and `dpf-start.sh`.

### 5.3 Migration for existing installs

Existing installs already running a bundled+auto-trusted local node must not have it ripped out on upgrade. On first start after this lands: if an enrolled local edge node exists, record `edge.enabled=true, mode=local` in `install-state.json` (grandfather the choice) and surface a one-time portal notice — "Network mapping is now opt-in; your existing local edge node is kept. Manage it under Platform → Edge Nodes." Fresh installs get default-off. `[J]`

---

## 6. Minimal Edge Footprint (G3)

The edge node is **not a portal**. Stating the bill-of-materials as a contract is what lets us support and test "the edge install doesn't need everything the portal has."

| Concern | Authority Core (full portal) | Edge node (minimal) |
| --- | --- | --- |
| Web app / portal UI | yes | **no** |
| Postgres / Neo4j / Qdrant | yes | **no** — state is one small `state.json` under a state dir |
| LLM / model runtime | yes (routing + local DMR) | **no** — no inference on the edge |
| Inbound network | serves :3000 (+:443 TLS) | **none** — outbound-only to the Authority URL |
| Identity store | owns `Principal`/`User`/policy | holds only its own `dpfedge_*` node token in `state.json` (mode 0600) |
| Compute/footprint | multi-container stack | one process / one container; static Go binary or the lean edge image |
| Required inputs | install env, secrets | `DPF_AUTHORITY_URL`, one-time `DPF_BOOTSTRAP_TOKEN`, a state dir, (optional) a CA bundle for TLS |
| Capabilities | n/a | `NET_RAW`/`NET_ADMIN` only when the active-sweep collectors are enabled |
| Observability | Prometheus, Grafana, local platform discovery | local process logs + outbound heartbeat/metrics; no required inbound `/metrics` endpoint |

**Footprint contract (testable):**

- FP1. An edge node makes **only outbound** connections to `DPF_AUTHORITY_URL`; it opens no inbound listener. (Verified by the air-gap egress allow-list harness.)
- FP2. An edge node persists **only** `state.json` (node token + intervals + capabilities) — no relational/graph/vector store. (Verified by the lifecycle harness + image inspection.)
- FP3. An edge node performs **no LLM inference**. (Verified by image bill-of-materials: no model runtime, no provider keys required.)
- FP4. The remote artifact is installable **without a monorepo clone** — a single binary or a single compose file fetched by URL. (Verified by the remote-provisioning test, §11.)
- FP5. The remote artifact does **not** expose a Prometheus scrape endpoint by default. Authority-side observability is derived from authenticated heartbeats, `/api/v1/edge/metrics`, accepted discovery runs, and local process logs uploaded only under an explicit support workflow.
- FP6. Local state, logs, and command output redact `dpfboot_*`, `dpfedge_*`, SNMP community strings, adapter secrets, and customer/site labels that could identify a regulated estate outside the Authority UI.
- FP7. Metrics and discovery payloads are bounded: per-node batch size, payload size, queue depth, retry horizon, and label cardinality are enforced before data hits Postgres, Neo4j projection, Prometheus, or Grafana.

The footprint is the same across archetypes; what varies per archetype is *how many* nodes and *how they are scoped* (§7), never what one node carries.

---

## 7. Archetype Fleet Considerations (G5)

### 7.1 Base architecture — the fleet is first-class

A DPF install is **one Authority Core with zero-or-more edge nodes**. The default is zero (opt-in, §5). Beyond one, the model is a **fleet**: each node is independently enrolled, scoped, trusted, and reaped; the Authority Core is the single pane for all of them. Scope is carried from the bootstrap token to the `EdgeNode` row at enrollment and enforced server-side on every path (the customer/site-binding spec). The base architecture therefore must treat "node" as plural everywhere it surfaces: the admin list groups and filters by context; discovery evidence, adapter credentials, and operational status are always scope-qualified; reaping/upgrade act per-node. This base capability is then *specialized*, not reinvented, per archetype.

### 7.2 Retail — one node per location `[J]`

Retail businesses (archetype `retail-goods`; persona Marisol, two stores + warehouse + online) live across **physical locations**, each its own LAN with POS terminals, payment devices, back-office PCs, Wi-Fi APs, and cameras. The natural topology is **one edge node per store/warehouse**, each scoped to that location, all reporting to one Authority Core (typically at HQ or in the cloud).

- **Context dimension:** *location* (store / warehouse / HQ). For single-org retail without the MSP customer layer, the scope dimension is the **site**: model each location as a `CustomerSite`-equivalent under the org, or extend `EdgeNode` scope to carry an org-site key. (Substrate check: retail does not yet have a per-location site model wired the way MSP does — this is the retail-specific gap to file, not a base-arch change.)
- **Why it matters:** PCI scope (cardholder-data environment) is per-store; "what's on the network at store #2" must not blur with store #1. Aligns with the CADA / sovereignty posture (location-scoped evidence).
- **Operator UX:** "Add an edge node at a location" picks the store; the fleet view groups nodes by location; a store's network posture is one filtered view.

### 7.3 MSP — one node per customer × site `[D for data model]`

MSPs (archetype `it-managed-services`; first target TeamLogic IT) manage **many customers**, each with **many sites**. The customer/site-binding spec already models this precisely: a bootstrap token is bound to a `targetCustomerAccountId` (+ optional `targetCustomerSiteId`); enrollment copies that scope to the `EdgeNode`; `resolveEdgeNodeAuth` returns it; discovery runs and adapter selection are filtered by it; overlapping private IP ranges are valid under different customer/site scopes.

- **Context dimension:** *customer account* → *customer site*. The deepest fleet — `customers × sites` nodes under one MSP Authority Core.
- **What this spec adds:** the *deployment-topology* framing on top of that data model — the remote-provisioning flow (§4.2) must let the MSP pick customer + site when issuing the token; the fleet view must group by customer then site; the minimal footprint (§6) is what makes "drop a node into each customer site" operationally cheap; strict estate separation (`estateSeparation:"strict"`) is the invariant the topology must never violate.
- **Open follow-ups already named** by the customer/site spec (selector UI, adapter targeting UI, customer-estate projection, remote-support consent) are the MSP-fleet backlog; this spec references rather than duplicates them.

### 7.4 Other multi-context archetypes

The same pattern serves any archetype that operates across physical contexts — property management (per building), HOA (per community), field-service trades (per yard/branch), municipalities (per facility). The base-architecture fleet concept (§7.1) covers them; each can specialize later. We call out retail and MSP because the founder did and because they bracket the two scope models (single-org-by-location vs. multi-customer-by-site).

---

## 8. Easy Remote Provisioning (G2) — target experience

The design principle: **the operator never leaves the portal and never edits a file.** The portal holds the Authority URL and can mint a scoped token; it should therefore hand the operator a ready-to-run artifact.

**Flow (proposed `[J]`):**

1. `/platform/edge-nodes` → **Add a node on another machine**.
2. Operator picks: a friendly name; the host OS (Windows / macOS / Linux); for MSP, the customer + site; for retail, the location.
3. Portal resolves the **Authority URL reachable from elsewhere** (LAN IP / DNS / public HTTPS — not `localhost`) and warns if only a loopback URL is known.
4. Portal issues a scoped, short-TTL bootstrap token and renders:
   - **Default — native binary:** one command that downloads the platform-matched Go edge binary and runs its `enroll` with `--authority <url> --token <dpfboot_...>` baked in. No Docker, no repo.
   - **Fallback — container:** one `docker compose` command using `docker-compose.edge-standalone.yml` fetched by raw URL, with `DPF_AUTHORITY_URL`/`DPF_BOOTSTRAP_TOKEN` inlined.
   - **Air-gapped:** a link to the offline bundle path (existing air-gap runbook) with the token shown for manual transfer.
5. The node enrolls `pending`; the portal row updates live; operator clicks **Approve**.

**Why the Go binary is the default remote artifact:** it is the only path with full host-LAN fidelity on Windows/macOS (Docker Desktop cannot see the real LAN — verified, deployment-matrix spec), it needs no Docker, and it *is* the minimal footprint (§6). This makes G2 and G3 the same artifact.

**Dependencies / known blockers:** release/customer installs currently can't issue a bootstrap token host-side because `issue-edge-bootstrap-token.ts` imports `@dpf/db` (EP-BUILD-D78835). The portal-side issuance in this flow goes through the running Authority (not host-side tsx), which sidesteps that blocker — but the blocker must be closed for the installer's own opt-in local path. Cross-reference, do not duplicate.

---

## 8A. Critical Architecture Review — sovereignty, scale, network, auth, observability

This section is intentionally stricter than the happy-path topology. These are the constraints that keep a useful deployment flow from becoming an insecure remote-agent sprawl.

### 8A.1 Data sovereignty and estate boundaries

Edge observations are not generic telemetry. A discovered MAC address, hostname, SSID, VLAN, payment terminal, camera, controller IP, or SNMP interface label can identify a real site and may become regulated evidence. The sovereignty posture therefore follows the **operator/control boundary**, not just where bytes are stored:

- Authority Core is the only durable system of record. The edge node stores only its node credential, heartbeat/interval state, local retry queue, and capability hints needed to survive short outages.
- Every persisted operational record derived from an edge node must carry the authenticated scope: organization, and where applicable customer account, customer site, retail location, edge node id, capability, observed time, and source adapter. Scope comes from `resolveEdgeNodeAuth`, never from edge-submitted JSON.
- Raw adapter payloads (`rawData`, SNMP labels, controller metadata) need explicit retention classes: short-lived raw evidence, normalized inventory, and aggregate metrics. Do not project raw customer-site payloads into Grafana labels, logs, or alert annotations.
- Managed/SaaS observability export is not allowed by default for sovereign deployments. If a customer deliberately exports edge data to a third-party monitoring SaaS, that is a lower-assurance deployment choice recorded in the estate-sovereignty posture, not a hidden platform behavior.
- The estate-sovereignty program remains authoritative for per-element jurisdiction/operator fields. This topology must feed it with scoped edge facts; it must not invent a separate compliance register.

### 8A.2 Network boundary and authentication/authorization

The network rule is simple: remote nodes call home; Authority Core does not call into a customer LAN.

- Remote nodes use outbound HTTPS to `DPF_AUTHORITY_URL`. HTTP is acceptable only for a local development harness or an explicitly documented private-network bootstrap; production remote provisioning defaults to HTTPS and supports operator CA bundles.
- Generated commands must treat the bootstrap token as a visible secret. The portal shows it once, redacts it in audit/log output, gives it a short TTL, binds it to the intended scope, and records who issued it. Re-rendering means re-issuing a new token, not recovering the old one.
- `dpfboot_*` is one-time enrollment material. `dpfedge_*` is node credential material. Neither can authorize a human, a coworker, an MCP client, an A2A peer, or another node. Capability scopes remain the closed vocabulary in the binding edge-node spec.
- Authorization is per request and server-side: route handlers derive `edgeNodeId`, `principalId`, trust state, customer/site/location scope, and enabled capabilities from the authenticated node record. Request-body identity fields are rejected or ignored.
- Remote-control, remote-shell, reverse tunnel, MCP gateway, and A2A gateway capabilities are outside this topology slice. Adding them later requires consent, least-privilege capability flags, explicit audit rows, and a fresh security review.
- Quarantine must be effective at the route layer: quarantined nodes may heartbeat so operators can see them, but discovery/metrics/gateway submissions are rejected or diverted to a forensic holding path.

### 8A.3 Operational management and fleet scale

The Authority Core is the fan-in point. That is architecturally correct, but it becomes the bottleneck unless the fleet contract is explicit.

| Bottleneck | Failure mode | Required control |
| --- | --- | --- |
| Heartbeats | Thousands of nodes synchronize on the same interval and spike the portal/database. | Server-assigned intervals with jitter; per-scope concurrency caps; alert on missed heartbeat rate, not only per-node misses. |
| Discovery submissions | Large sweeps create write bursts and graph-projection lag. | Payload caps, `runKey` idempotency, per-node rate limits, async projection to Neo4j/Qdrant/reporting, and visible ingest backlog gauges. |
| Metrics cardinality | Per-interface/per-node labels explode Prometheus series count and slow Grafana dashboards. | Bounded label set; rollups by scope/version/status; high-cardinality details stay in queryable inventory tables, not metric labels. |
| Adapter credentials | Every trusted node polling every adapter duplicates work and leaks access across sites. | `targetEdgeNodeId` / customer / site filtering before decryption; fleet UI must show which node owns each adapter. |
| Upgrade/version drift | A fleet runs mixed binaries and wire-contract versions. | Signed releases, staged rollout by scope, version compatibility window, rollback path, and dashboarded version skew. |
| Offline/air-gapped queue | A site outage stores unbounded local data then floods Authority on recovery. | Bounded queue, drop-oldest policy by evidence class, recovery backoff, and operator-visible "data lost due to retention cap" evidence. |

Operationally, a node has a lifecycle independent of deployment: `created → pending → trusted → degraded → quarantined → revoked → retired`. "Degraded" is not a trust state in the current schema, but the UI/observability layer needs the concept for nodes that are trusted yet behind on version, missing capabilities, failing a collector, exceeding cardinality budget, or operating from stale policy.

### 8A.4 Prometheus and Grafana posture

DPF should keep Prometheus/Grafana where they are strongest: Authority-side platform and fleet observability. They are not the remote edge protocol.

- **Authority Core Prometheus** scrapes local/platform targets it can reach and may scrape an Authority-side exporter that exposes accepted edge fleet metrics. It must not require inbound scrape access to remote customer-site edge nodes.
- **Edge metrics ingestion** remains the authenticated push path: edge node → `/api/v1/edge/metrics` → Authority persistence/aggregation → optional Prometheus exporter/recording rules → Grafana dashboards.
- **No Pushgateway-as-event-store.** Discovery runs, lifecycle events, token issuance, approvals, quarantine, and support actions stay in Postgres/audit tables. Prometheus stores numeric time series and alerts on operational symptoms.
- **Grafana dashboards are views, not governance records.** Dashboards must be provisioned from version-controlled files, filtered by organization/customer/site/location/node scope, and backed by DPF authorization in the portal for operator actions. Grafana links may deep-link back to `/platform/edge-nodes`, but approval/quarantine/revoke happens in DPF.
- **Required dashboards/alerts:** fleet overview (trusted/pending/quarantined/revoked), missed-heartbeat rate by scope, ingest error rate, discovery payload rejection rate, metrics cardinality budget, version skew, stale pending tokens/nodes, token reuse attempts, quarantine attempts, and graph-projection lag.

Future support for a customer's existing Prometheus at a site can be additive: either the edge node summarizes selected local Prometheus data through the authenticated edge metrics endpoint, or a site-local Prometheus remote-writes to a governed Authority receiver. It must still carry DPF scope, encryption, authentication, cardinality limits, and sovereignty classification.

### 8A.5 Critical verdict

The topology is directionally right only if these constraints land with it. The weak version is "generate a command that starts agents." The strong version is "operate a scoped, sovereign, observable, upgradable fleet without opening customer networks or creating a parallel monitoring/control plane." This spec should be treated as the strong version.

---

## 9. SysML Description (G4)

The edge node is **not yet in the EA/SysML graph**; it is the planned Phase D "network topology bridge" of [EP-ARCH-GRAPH-LIVE] / [EP-PARITY-ENGINE]. This spec ships the **hand-authored SysML architecture note** now (architect judgment over current state) and defines how the later extractor projects live `EdgeNode` rows, so the two converge instead of competing.

- **Note (now):** [`docs/architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md`](../../architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md) — package `PKG-EDGE-TOPO`, requirements REQ-EDGE-1…14 (the opt-in/remote/footprint/fleet posture plus the §8A operational envelope: sovereignty/scope, network-auth boundary, fleet scale/backpressure, Authority-side observability), constraints CON-EDGE-1 (footprint + outbound-only + scope-from-token) and CON-EDGE-2 (observability cardinality + sovereignty redaction), parts for Authority Core / edge agent / enrollment / fleet registry / deploy-gate / provisioning / ingestion / fleet-ops / observability, interfaces (`/api/v1/edge/*` + provisioning + fleet-metrics exporter), state machines (deploy gate, trust lifecycle, enrollment, operational lifecycle incl. `degraded`), and verification cases mapped to §11.2. Follows the AI-cockpit note pattern (`[D]`/`[J]`, traceability, allocations to real code).
- **Extractor (later, Phase D):** a `buildEdgeTopologyModel(facts) → SysmlDesiredModel` extractor reads `EdgeNode`/`BootstrapToken`/`EdgeNodeCapability` and projects each node as a SysML `part_usage` with `layer="network"`, `refinementLevel="actual"`, `sysmlKey="runtime:edge-node:<nodeId>"`, allocated to the logical `PART-EDGE-agent` definition and `traces`-linked to its `prisma:model:EdgeNode` data element — exactly the cross-layer edge pattern PR #2073 established. Reuses the existing EA tables (no new EA substrate).

The note is the architect's source of truth until the extractor makes it self-maintaining; the extractor is filed against EP-ARCH-GRAPH-LIVE so it lands in that program, not as a parallel effort.

---

## 10. Research & Benchmarking (AGENTS.md §10)

Remote-agent enrollment + fleet management is a mature pattern; we benchmark the *provisioning UX* and *fleet scoping*, not feature lists.

- **Tailscale** (mesh agent). *Adopted:* one-line install that bakes an auth key into the command the control plane hands you — the model for §8's copy-paste artifact; pre-authorized vs. manual-approve keys map to our auto-approve (local) vs. pending (remote) trust gate. *Rejected:* a coordination server in the data path — DPF edge is outbound-only to the Authority, no relay.
- **NinjaOne / ConnectWise (RMM/PSA)** — already benchmarked in the customer/site-binding spec. *Adopted:* installer carries org/location target so the agent lands in the right scope; policy applies at org/location/device tiers. *Rejected:* endpoint self-asserting its organization — DPF binds scope in the authority-issued token, never the request body.
- **NetBox tenancy** — already benchmarked there. *Adopted:* customer ownership is a first-class relation, not a metadata label. *Rejected:* assigning every shared object to a tenant — DPF keeps organization-scoped nodes for the non-MSP/base case.
- **Prometheus node_exporter / Prometheus remote-write / Datadog Agent** (host metrics patterns). *Adopted:* a deliberately thin host agent/exporter with a tiny local footprint, stable labels, and a central observability view — validates §6 and §8A.4. *Rejected:* making remote customer-site nodes reachable scrape targets. DPF edge is push/outbound-only (FP1); Prometheus/Grafana visualize accepted Authority data, not unauthenticated remote endpoints.
- **HashiCorp Nomad/Consul client agents** (fleet-of-clients to one control plane). *Adopted:* the "one control plane, N thin clients, each scoped" mental model is exactly §7.1; clients hold only their own token + local state. *Rejected:* gossip between clients — DPF nodes never talk to each other, only to the Authority (smaller blast radius per FP1).

**External standards checked (2026-06-19):**

- [Prometheus overview](https://prometheus.io/docs/introduction/overview/) and [scrape configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/) confirm the normal scrape-target model and the need to configure target auth/TLS when scraping. DPF adopts this inside Authority Core where targets are reachable.
- [Prometheus pushing guidance](https://prometheus.io/docs/practices/pushing/) and the [Pushgateway project guidance](https://github.com/prometheus/pushgateway) reinforce that push paths are narrow and should not become event/audit storage. DPF keeps lifecycle and discovery events in Authority tables.
- [Prometheus remote-write specification](https://prometheus.io/docs/specs/prw/remote_write_spec/) is the relevant pattern if DPF later accepts metrics from a site-local Prometheus; any such receiver still needs DPF scope, auth, limits, and sovereignty classification.
- [Grafana provisioning documentation](https://grafana.com/docs/grafana/latest/administration/provisioning/) supports version-controlled dashboards/data sources; DPF should provision fleet dashboards rather than hand-create them per install.
- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/) and [configuration security best practices](https://opentelemetry.io/docs/security/config-best-practices/) are the reference if DPF introduces a generic telemetry collector: encryption and authentication are required, not optional.

**Anti-pattern identified:** shipping the *capability* (standalone compose, multi-host runbook) and calling remote deployment "supported" while the only path is a developer runbook. The benchmark across all five is that the control plane *generates the install artifact*; that is the gap §8 closes.

---

## 11. Data-Model Stewardship (AGENTS.md §11) & Verification (G6)

### 11.1 Stewardship

- **No new identity tables.** Reuse `EdgeNode`, `BootstrapToken`, `EdgeNodeCapability`; identity stays on `Principal`/`PrincipalAlias` (kernel: principal-convergence).
- **Reuse existing scope columns** (`customerAccountId`/`customerSiteId`/`scopePolicy`) for MSP. For **retail**, prefer extending the existing site concept rather than a new "location" table — substrate-audit before any schema add (file as a retail-fleet BI; do not pre-commit a table here).
- **`install-state.json`** gains an `edge` record (not a DB table) — the source of truth for whether *this install* runs a local node, read by both start scripts and surfaced in the portal.
- **Scope every operational record.** Discovery runs, adapter fetches, metrics envelopes, ingest failures, quarantine attempts, token issuance/consumption, and fleet actions must carry authenticated organization/customer/site/location/node scope where applicable. The edge request body cannot supply or override those fields.
- **Retain raw evidence deliberately.** `rawData`, SNMP labels, controller metadata, and generated logs may expose customer networks. Store short-lived raw evidence separately from normalized inventory and aggregate metrics; do not put raw payloads in Prometheus labels, Grafana annotations, or long-lived audit text.
- **Keep observability cardinality bounded.** Prometheus labels use stable, low-cardinality identifiers (scope ids, node id, capability, trust state, version family). High-cardinality details such as interface names, MACs, hostnames, VLAN labels, and controller object names stay in inventory/query tables.
- No change to the wire contract, ingestion controls, or token namespaces.

### 11.2 Verification matrix

| Topology | What we test | Substrate / harness `[D where it exists]` |
| --- | --- | --- |
| A — co-located opt-in | Default install runs **no** edge node; opting in adds one that enrolls + (chosen) auto-trusts | extend `verify-install-edge.sh`; assert absence by default |
| A — opt-out parity | Windows + bash agree via `install-state.json`; no hardcoded overlay | new cross-script test (CI compose-render policy check) |
| B — remote LAN (HTTP) | Node on a second host enrolls `pending`, approves, submits real LAN IPs | `verify-install-edge.sh` + multi-host runbook §6 (exists) |
| B — remote LAN (TLS) | Same over HTTPS with operator CA bundle | `-standalone-tls.yml` + `issue-authority-tls-cert.sh` (exists) |
| B — easy provisioning | Portal-generated command enrolls a node **without repo clone / file edit** | new test for the §8 flow (binary + container forms) |
| C — fleet scoping (MSP) | Two nodes under different customer/site scopes keep inventory/adapters/evidence separate | extend with customer/site-binding assertions |
| C — fleet scoping (retail) | Two nodes under different locations keep posture separate | new, after retail site model lands |
| Footprint FP1–FP7 | Outbound-only egress; state-only persistence; no LLM; no-clone install; no default scrape endpoint; redaction; bounded payloads/cardinality | `verify-edge-node-air-gap.sh` (egress) + image BoM inspection + §8 test |
| Network/auth boundary | Token is one-use/short-TTL/redacted; route auth derives identity/scope from token; quarantined node cannot submit discovery/metrics | lifecycle harness + route tests from binding edge-node spec |
| Scale / fan-in | Heartbeat jitter, per-node rate limits, payload caps, idempotent `runKey`, async graph/reporting projection, visible ingest backlog | new synthetic fleet load harness with 100/1,000-node profiles |
| Observability | Authority-side Prometheus exporter/dashboards show fleet health without scraping remote nodes; labels stay within budget | Prometheus rule test + Grafana provisioning smoke test |
| Sovereignty / scope leakage | Raw customer-site identifiers are absent from metric labels/logs; records carry authenticated scope; SaaS export is disabled by default | schema/query tests + log/metric redaction assertions |
| Air-gapped | Enroll + replay across an Authority outage, drop-oldest | `verify-edge-node-air-gap.sh` (exists) |

Each row maps to a verification case in the SysML note (§9). Runtime-bound rows run on the canonical install or the shared local-CI convergence sandbox (AGENTS.md §5), never a worktree harness.

---

## 12. Documentation Plan (G4)

| Artifact | Action | Role |
| --- | --- | --- |
| This spec | new | Single source of truth for the topology, posture, footprint, fleet, testability |
| SysML note (§9) | new | The architecture in SysML form |
| `docs/edge-node/deployment-topology.md` | new | Operator-facing "front door": local-opt-in vs remote vs fleet, footprint, decision guide |
| `deployment-contracts.md` Contract 5 | edit | Add opt-in default + minimal-footprint + fleet language to the doctrine |
| `2026-05-22-edge-node-customer-site-binding-design.md` | edit (xref) | Add a topology cross-reference; it remains authoritative for the MSP data boundary |
| `docs/personas/marisol-retail.md` | edit | Add the per-location edge-node consideration |
| `docs/install/edge-node-multi-host.md` | edit (note) | Point to the easy-provisioning flow as the operator path; this runbook is the developer substrate beneath it |
| `docs/user-guide/operations/infrastructure-discovery.md` | edit | Clarify Prometheus/Grafana role: Authority-side monitoring and dashboards over accepted edge data, not remote-node scraping |
| `docs/edge-node/fleet-operations.md` | new | Operator runbook for rollout, rotation, quarantine, decommission, missed heartbeat, ingest backlog, version skew |
| `docs/edge-node/security-and-sovereignty.md` | new | Token handling, redaction, raw evidence retention, customer/site/location scope, third-party observability export posture |

Every new artifact links the others (single-source-of-truth): docs → spec → SysML note → code/scripts.

---

## 13. Backlog & Sequencing

Proposed epic **EP-EDGE-TOPOLOGY** — "Edge Node Deployment Topology: opt-in local, easy remote, fleet-per-archetype." Check overlap before creating: it is distinct from EP-ESTATE-SOVEREIGNTY (compliance posture over edge), EP-ARCH-GRAPH-LIVE (SysML/graph projection — the SysML extractor BI links *there*), and EP-ARCH-8D4F2A (archetype model — the archetype-fleet BIs may link there). 

Candidate BIs:

1. **Opt-in default flip + cross-surface parity** — `install-dpf.sh`/`fresh-install.ps1` default off + `--with-edge`/`-WithEdge`; both `dpf-start.ps1` + `dpf-start.sh` read `install-state.json`; grandfather migration (§5.3). `workType=feature`.
2. **Setup + portal opt-in UX** — the setup choice and the `/platform/edge-nodes` "Add an edge node here" action (UX-fit reviewed). `workType=feature`.
3. **Easy remote provisioning flow** — portal "Add on another machine" → copy-paste command (binary default + container fallback), Authority-side token issuance. Depends on EP-BUILD-D78835. `workType=feature`.
4. **Minimal-footprint contract tests** — FP1–FP7 harness rows (§11). `workType=chore`.
5. **Edge node SysML extractor (Phase D)** — `buildEdgeTopologyModel` → EA graph; **link to EP-ARCH-GRAPH-LIVE**. `workType=feature`.
6. **Retail per-location fleet** — substrate-audit the retail site model; scope retail edge nodes by location; fleet-by-location view. `workType=feature` (may link EP-ARCH-8D4F2A).
7. **Docs** — deployment-topology operator doc + Contract 5 edit + persona/runbook xrefs (this spec ships the first cut). `workType=doc`.
8. **Fleet observability and Grafana/Prometheus posture** — Authority-side edge fleet exporter/recording rules, provisioned Grafana dashboards, alerts for missed heartbeat, ingest failures, version skew, stale pending nodes, and projection lag. `workType=feature`.
9. **Network/auth hardening tests** — token redaction, one-use/TTL enforcement, quarantine route matrix, request-body identity rejection, HTTPS/CA validation, no inbound listener assertions. `workType=chore`.
10. **Sovereignty and raw-evidence retention guards** — scope-required persistence, raw payload retention classes, metric/log redaction, SaaS export default-off posture linked to EP-ESTATE-SOVEREIGNTY. `workType=feature`.
11. **Synthetic fleet fan-in harness** — 100/1,000-node heartbeat + discovery + metrics load profiles with cardinality budget and backpressure evidence. `workType=tool`.

Sequence: 7 (this PR) → 1 → 9 → 2 → 3 → 8 → 10 → 11 → 5 → 4 → 6.

---

## 14. Open Risks

1. **Existing installs.** The default flip must grandfather running local nodes (§5.3) or it reads as "the upgrade deleted my edge node." Mitigated by the `install-state.json` record + one-time notice.
2. **"Reachable Authority URL" is the perennial remote footgun.** The standalone compose already `${VAR:?}`-guards it; the portal flow must resolve and validate a non-loopback URL before rendering a command, or operators get nodes that can never connect.
3. **Binary distribution + signing.** Making the Go binary the default remote artifact means a trustworthy download (checksum/signature) and platform-matched builds. Scope with the release-artifact contract (Contract 1), don't hand-roll.
4. **Retail site model gap.** Retail lacks MSP's customer/site scoping; §7.2 is `[J]` until a site/location model is audited and (if needed) extended. Do not assume a table — file the substrate audit first.
5. **SysML note vs. extractor drift.** The hand-authored note (§9) is correct only until the Phase D extractor lands; the note must be marked as the interim source and the extractor BI linked so it converges.
6. **Bootstrap-token exposure in generated commands.** A copy-paste install command is intentionally easy, but it can leak through shell history, screenshots, ticket comments, browser history, or logs. Mitigate with short TTL, one-use semantics, redaction, one-time display, and a "revoke/re-issue" path that is easier than recovering a token.
7. **Authority Core fan-in bottleneck.** A successful fleet can overload the portal database, graph projection, or observability layer. The synthetic fleet harness and backpressure controls are not optional before broad MSP/retail rollout.
8. **Prometheus cardinality blow-up.** Per-interface/per-host labels are tempting and can silently degrade the local monitoring stack. Keep high-cardinality details in inventory tables and expose only bounded rollups to Prometheus/Grafana.
9. **Sovereignty leakage through observability.** Metrics labels, alert annotations, screenshots, and support bundles can leak customer-site identifiers even when primary data storage is scoped correctly. Redaction and retention tests must cover observability outputs, not only API payloads.
10. **Remote-control scope creep.** Once an edge node exists, operators will ask for remote support, tunnels, MCP gatewaying, and remediation. Those are valid future capabilities, but they must not sneak into this topology under "provisioning"; each needs consent, least privilege, audit, and a security review.

---

## 15. Summary

The edge node is mature; its *deployment architecture* was undescribed and defaulted the wrong way. This spec makes the local node **opt-in**, defines the **easy remote provisioning** experience and the **minimal-footprint contract**, makes **"one Authority Core, a fleet of edge nodes across contexts"** a base-architecture concept specialized for **retail** (per location) and **MSP** (per customer × site), and describes the whole in **documentation, SysML, and specification** with a per-topology **verification matrix**. The critical addition is operational discipline: remote nodes stay outbound-only, Authority Core remains the auth/data/observability source of truth, Prometheus/Grafana visualize accepted scoped data rather than scrape customer LANs, and fleet scale is gated by backpressure, cardinality, sovereignty, and lifecycle controls — all on the existing substrate, no new identity tables.
