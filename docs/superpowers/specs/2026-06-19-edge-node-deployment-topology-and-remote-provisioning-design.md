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

But the **deployment topology** around it is not yet described as one coherent, supportable, testable architecture, and its default posture is wrong for the product. The founder's direction names five concrete gaps:

1. **It is bundled and active by default; it must be opt-in.** Every install — `install-dpf.sh` and Windows `fresh-install.ps1` — bundles the edge-node container, **auto-issues a bootstrap token (`--auto-approve`)**, writes it to `.env`, and force-recreates the container so the local node **auto-enrolls and auto-trusts**. `[D]` This is silent default-on. Where the platform is installed, running an edge node should be a deliberate operator choice.
2. **There is no *easy* way to put an edge node on separate hardware and connect it to the portal.** The capability exists (`docker-compose.edge-standalone.yml`, the multi-host runbook), but the path requires cloning the whole monorepo onto the second host just for a compose file, hand-editing `.env`, copying a token out-of-band, and re-approving in the portal. `[D]` That is a developer runbook, not an operator experience.
3. **The edge install does not need everything the portal has — but that minimal footprint is not a described contract.** The standalone compose is already lean (no portal/postgres/neo4j/qdrant/LLM), and the Go binary is a single static executable. `[D]` Yet "what an edge node needs vs. what an Authority Core needs" is nowhere stated as a first-class footprint contract we can support and test against. `[J]`
4. **The architecture is not described uniformly across documentation, SysML, and specifications.** Docs exist but are scattered (multi-host, air-gapped, deployment-contracts Contract 5, user guide). The edge node is **not yet in the SysML/EA graph** (it is the planned-but-unbuilt "network topology bridge", Phase D of [EP-ARCH-GRAPH-LIVE]). `[D]` There is no single deployment-topology description tying local/remote/fleet together.
5. **Some archetypes deploy *many* edge nodes in different contexts, and that is not a base-architecture concept.** MSPs run an edge node per customer per site (the customer/site-binding spec already models the data boundary). Retail runs one per store/warehouse/HQ. `[D for MSP data model; J for the topology framing]` The "one Authority Core, a fleet of edge nodes across many contexts" pattern must be a base-architecture consideration and then specialized per archetype — not an MSP-only special case.

This spec consolidates the deployment topology, flips the default posture to opt-in, defines the easy-remote provisioning experience and the minimal-footprint contract, models the system in SysML, gives a per-topology verification matrix, and adds the multi-node fleet consideration to the base architecture and to the retail and MSP archetypes.

**This spec introduces no new identity-bearing tables.** It reuses `EdgeNode`, `BootstrapToken`, `EdgeNodeCapability`, and the `customerAccountId`/`customerSiteId` scope already on those models (Principal convergence preserved — §10). The work is posture, packaging, UX, description, and verification — not new substrate.

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
- G4. The architecture is described coherently in **documentation, SysML, and specification** form, each pointing to the others (single source of truth, §10).
- G5. "One Authority Core, a **fleet** of edge nodes across many contexts" is a **base-architecture** concept, specialized for **retail** (per location) and **MSP** (per customer × site).
- G6. A per-topology **verification matrix** lets us test each deployment shape on its real substrate.

**Non-Goals**

- No change to the edge wire contract, the `dpfboot_*`/`dpfedge_*` token model, or the discovery ingestion controls (the binding 2026-05-09 spec remains authoritative for those).
- No mTLS / client-cert work (that is the binding spec's Phase 1+ / T4 track).
- No new customer-estate modeling beyond the existing customer/site scope.
- No removal of the developer runbooks; they remain the substrate the easy flow wraps.

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

**Footprint contract (testable):**

- FP1. An edge node makes **only outbound** connections to `DPF_AUTHORITY_URL`; it opens no inbound listener. (Verified by the air-gap egress allow-list harness.)
- FP2. An edge node persists **only** `state.json` (node token + intervals + capabilities) — no relational/graph/vector store. (Verified by the lifecycle harness + image inspection.)
- FP3. An edge node performs **no LLM inference**. (Verified by image bill-of-materials: no model runtime, no provider keys required.)
- FP4. The remote artifact is installable **without a monorepo clone** — a single binary or a single compose file fetched by URL. (Verified by the remote-provisioning test, §11.)

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

## 9. SysML Description (G4)

The edge node is **not yet in the EA/SysML graph**; it is the planned Phase D "network topology bridge" of [EP-ARCH-GRAPH-LIVE] / [EP-PARITY-ENGINE]. This spec ships the **hand-authored SysML architecture note** now (architect judgment over current state) and defines how the later extractor projects live `EdgeNode` rows, so the two converge instead of competing.

- **Note (now):** [`docs/architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md`](../../architecture/2026-06-19-edge-node-deployment-sysml-architecture-note.md) — package `PKG-EDGE-TOPO`, requirements REQ-EDGE-1…10, constraint CON-EDGE-1 (footprint + outbound-only + scope-from-token), parts for Authority Core / edge agent / enrollment service / fleet registry, interfaces (`/api/v1/edge/*`), state machines (deploy gate, trust lifecycle), verification cases mapped to §11. Follows the AI-cockpit note pattern (`[D]`/`[J]`, traceability, allocations to real code).
- **Extractor (later, Phase D):** a `buildEdgeTopologyModel(facts) → SysmlDesiredModel` extractor reads `EdgeNode`/`BootstrapToken`/`EdgeNodeCapability` and projects each node as a SysML `part_usage` with `layer="network"`, `refinementLevel="actual"`, `sysmlKey="runtime:edge-node:<nodeId>"`, allocated to the logical `PART-EDGE-agent` definition and `traces`-linked to its `prisma:model:EdgeNode` data element — exactly the cross-layer edge pattern PR #2073 established. Reuses the existing EA tables (no new EA substrate).

The note is the architect's source of truth until the extractor makes it self-maintaining; the extractor is filed against EP-ARCH-GRAPH-LIVE so it lands in that program, not as a parallel effort.

---

## 10. Research & Benchmarking (AGENTS.md §10)

Remote-agent enrollment + fleet management is a mature pattern; we benchmark the *provisioning UX* and *fleet scoping*, not feature lists.

- **Tailscale** (mesh agent). *Adopted:* one-line install that bakes an auth key into the command the control plane hands you — the model for §8's copy-paste artifact; pre-authorized vs. manual-approve keys map to our auto-approve (local) vs. pending (remote) trust gate. *Rejected:* a coordination server in the data path — DPF edge is outbound-only to the Authority, no relay.
- **NinjaOne / ConnectWise (RMM/PSA)** — already benchmarked in the customer/site-binding spec. *Adopted:* installer carries org/location target so the agent lands in the right scope; policy applies at org/location/device tiers. *Rejected:* endpoint self-asserting its organization — DPF binds scope in the authority-issued token, never the request body.
- **NetBox tenancy** — already benchmarked there. *Adopted:* customer ownership is a first-class relation, not a metadata label. *Rejected:* assigning every shared object to a tenant — DPF keeps organization-scoped nodes for the non-MSP/base case.
- **Prometheus node_exporter / Datadog Agent** (host agents). *Adopted:* a deliberately thin host agent with a tiny local footprint and a single config surface — validates §6 (no DB, no UI, outbound to a collector). *Rejected:* a pull model where the server scrapes the agent (inbound to the host) — DPF edge is push/outbound-only (FP1), which is what makes it safe to drop into a customer site behind NAT.
- **HashiCorp Nomad/Consul client agents** (fleet-of-clients to one control plane). *Adopted:* the "one control plane, N thin clients, each scoped" mental model is exactly §7.1; clients hold only their own token + local state. *Rejected:* gossip between clients — DPF nodes never talk to each other, only to the Authority (smaller blast radius per FP1).

**Anti-pattern identified:** shipping the *capability* (standalone compose, multi-host runbook) and calling remote deployment "supported" while the only path is a developer runbook. The benchmark across all five is that the control plane *generates the install artifact*; that is the gap §8 closes.

---

## 11. Data-Model Stewardship (AGENTS.md §11) & Verification (G6)

### 11.1 Stewardship

- **No new identity tables.** Reuse `EdgeNode`, `BootstrapToken`, `EdgeNodeCapability`; identity stays on `Principal`/`PrincipalAlias` (kernel: principal-convergence).
- **Reuse existing scope columns** (`customerAccountId`/`customerSiteId`/`scopePolicy`) for MSP. For **retail**, prefer extending the existing site concept rather than a new "location" table — substrate-audit before any schema add (file as a retail-fleet BI; do not pre-commit a table here).
- **`install-state.json`** gains an `edge` record (not a DB table) — the source of truth for whether *this install* runs a local node, read by both start scripts and surfaced in the portal.
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
| Footprint FP1–FP4 | Outbound-only egress; state-only persistence; no LLM; no-clone install | `verify-edge-node-air-gap.sh` (egress) + image BoM inspection + §8 test |
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

Every new artifact links the others (single-source-of-truth): docs → spec → SysML note → code/scripts.

---

## 13. Backlog & Sequencing

Proposed epic **EP-EDGE-TOPOLOGY** — "Edge Node Deployment Topology: opt-in local, easy remote, fleet-per-archetype." Check overlap before creating: it is distinct from EP-ESTATE-SOVEREIGNTY (compliance posture over edge), EP-ARCH-GRAPH-LIVE (SysML/graph projection — the SysML extractor BI links *there*), and EP-ARCH-8D4F2A (archetype model — the archetype-fleet BIs may link there). 

Candidate BIs:

1. **Opt-in default flip + cross-surface parity** — `install-dpf.sh`/`fresh-install.ps1` default off + `--with-edge`/`-WithEdge`; both `dpf-start.ps1` + `dpf-start.sh` read `install-state.json`; grandfather migration (§5.3). `workType=feature`.
2. **Setup + portal opt-in UX** — the setup choice and the `/platform/edge-nodes` "Add an edge node here" action (UX-fit reviewed). `workType=feature`.
3. **Easy remote provisioning flow** — portal "Add on another machine" → copy-paste command (binary default + container fallback), Authority-side token issuance. Depends on EP-BUILD-D78835. `workType=feature`.
4. **Minimal-footprint contract tests** — FP1–FP4 harness rows (§11). `workType=test/chore`.
5. **Edge node SysML extractor (Phase D)** — `buildEdgeTopologyModel` → EA graph; **link to EP-ARCH-GRAPH-LIVE**. `workType=feature`.
6. **Retail per-location fleet** — substrate-audit the retail site model; scope retail edge nodes by location; fleet-by-location view. `workType=feature` (may link EP-ARCH-8D4F2A).
7. **Docs** — deployment-topology operator doc + Contract 5 edit + persona/runbook xrefs (this spec ships the first cut). `workType=doc`.

Sequence: 7 (this PR) → 1 → 2 → 3 → 5 → 4 → 6.

---

## 14. Open Risks

1. **Existing installs.** The default flip must grandfather running local nodes (§5.3) or it reads as "the upgrade deleted my edge node." Mitigated by the `install-state.json` record + one-time notice.
2. **"Reachable Authority URL" is the perennial remote footgun.** The standalone compose already `${VAR:?}`-guards it; the portal flow must resolve and validate a non-loopback URL before rendering a command, or operators get nodes that can never connect.
3. **Binary distribution + signing.** Making the Go binary the default remote artifact means a trustworthy download (checksum/signature) and platform-matched builds. Scope with the release-artifact contract (Contract 1), don't hand-roll.
4. **Retail site model gap.** Retail lacks MSP's customer/site scoping; §7.2 is `[J]` until a site/location model is audited and (if needed) extended. Do not assume a table — file the substrate audit first.
5. **SysML note vs. extractor drift.** The hand-authored note (§9) is correct only until the Phase D extractor lands; the note must be marked as the interim source and the extractor BI linked so it converges.

---

## 15. Summary

The edge node is mature; its *deployment architecture* was undescribed and defaulted the wrong way. This spec makes the local node **opt-in**, defines the **easy remote provisioning** experience and the **minimal-footprint contract**, makes **"one Authority Core, a fleet of edge nodes across contexts"** a base-architecture concept specialized for **retail** (per location) and **MSP** (per customer × site), and describes the whole in **documentation, SysML, and specification** with a per-topology **verification matrix** — all on the existing substrate, no new identity tables.
