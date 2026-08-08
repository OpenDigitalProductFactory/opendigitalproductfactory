# App-Integration Topology (L7) — Design Specification

**Date:** 2026-08-08
**Status:** Draft for architecture + UX-fit review; no implementation in this branch
**Companion:** [Federated A2A Coordination with GAID](2026-08-08-federated-a2a-gaid-coordination-design.md) (#4124/#4125) — this spec renders, graphically, the layered model that design defines (§7) and the operator surfaces it lists (§12).
**Backlog (staged — file when the DPF MCP reconnects):** slice under `EP-MSP-FEDERATION`, cross-referencing the A2A adoption program (`EP-E1F1DB58`) and the demand observability read-model BI `BI-3C662E7B`.

## 1. Problem

DPF already visualizes the **lower layers** of a running estate — installs, edge nodes, routing — through the operations topology (`OperationsTopologyCanvas` + `operations-topology-layout`). It has **no visualization of the app-integration layer**: which enduring agents (GAIDs) live on which sovereign installs, how they coordinate (demand exchange today; A2A tasks next), and under which organization/environment and authority they act.

Framed as an OSI-style stack, the operations topology answers the **transport/network** question ("which boxes, which routes?"). This spec answers the **application-integration** question ("which agents, which organizations, which flows, under which trust?"). The A2A design's **§7 layered table** is precisely that stack:

| Layer | Canonical value | Rendered as |
| --- | --- | --- |
| Link | `FederationLink` + mutual token | edge (relationship) |
| Device | `did_…` + pinned Ed25519 key | edge trust badge |
| Installation | `inst_…` | node |
| Agent | GAID + signed AIDoc/card | sub-node inside an install |
| Organization | canonical Organization ref | node group (outer) |
| Environment | prod / dev / staging class | node group (inner), visually distinct |
| Authority | TAK / delegation / projection | edge/flow eligibility |

The operator wants to **see** this — summarized to org/install level, expandable to agents and individual flows — and it must express the **archetype shape** of the estate and scale as future installs join (the DPF vision of a growing federation of sovereign installs).

## 1.1 Core design principle — independent layers, traversable, with fault propagation

This is the load-bearing driver, not a feature: the layers must be legible **independently**, **traversable** between, and — the hard part — a fault in a **lower** layer must surface as **derived impairment** in the **higher** layers, so an operator can start from a higher-layer symptom and traverse *down* to root cause (and from a lower-layer fault, see *up* to what it impairs). Seeing layers separately is easy; keeping them independent yet traversable, with honest fault propagation, is the part enterprise-architecture and service-management platforms have historically struggled to get right. DPF does not need every OSI layer, but this end-to-end stance shapes the whole design.

**Canonical motivating case (lived, 2026-08):** a Link-layer fault (`link:mismatch` in the CloudEvent guard) and then a transport-layer fault (delivery dead-letter made terminal) **silently stranded** higher-layer demand and would have stranded agent coordination. The scalar symptom ("nothing is syncing") lived at the top; the cause lived two layers down; nothing connected them for the operator. The topology's primary job is to make exactly that connection **visible and traversable**.

Three requirements follow, and they bind the engine (§4) and acceptance (§9):

1. **Independent legibility** — each layer (Link / Device / Installation / Agent / Organization / Environment / Authority) can be viewed on its own, without the others' noise.
2. **Derived health, propagated upward** — every node/edge carries a health derived from the **lowest failing layer** beneath it. A dead-lettered flow (transport) marks its edge degraded, which marks the agent coordination it carried impaired, which marks the install/org summary "needs attention" — with the reason attributed to the layer that actually broke, never a generic red.
3. **Traversal both ways** — an operator can drill from an impaired higher-layer element to the root-cause layer, and from a lower-layer fault see the set of higher-layer things it impairs. The path down and the blast-radius up are both first-class.

## 2. Scope

### 2.1 In scope

- A **shared topology engine** (data model + layout + provenance rendering) that assembles an app-integration graph from existing substrate, with **two entry points**: a layer/mode on the operations map, and a focused view on Platform → Connections.
- Nodes = sovereign installs, grouped **Organization → Environment**; expandable to **agents (GAIDs)**.
- Edges = `FederationLink`s carrying **typed flows**: demand (live today) and A2A tasks (as the A2A slice lands), each with a provenance chip following the `organization → environment/install → agent GAID` hierarchy (A2A design §12.1).
- **Archetype-driven layout shapes**: same-org = mesh; MSP / Founder-Hub = hub-and-spoke; customer → reseller → vendor = directed chain; community-peer = mesh.
- **Summarize / expand** at three depths: org/install summary → agents → individual flows.
- **Environment distinction**: production vs development traffic visually and programmatically distinct (A2A design §11.1).

### 2.2 Out of scope

- New authoritative tables for topology (the graph is a **read model** over existing substrate).
- A second graph-layout library or a fork of the operations topology.
- Cross-organization data beyond what the deny-by-default sharing gate already permits (§5).
- The A2A coordination mechanism itself (owned by the companion spec); this renders its provenance.
- Implementation code in this design branch.

## 3. Verified substrate (reuse targets, not new build)

Confirmed on `origin/main` @ `8e350d1de`:

- **Layout + canvas**: [`operations-topology-layout.ts`](../../../apps/web/components/platform/operations-topology-layout.ts) already exports `OperationsTopologyLayout`, `TopologyProviderNode`, **`A2aArcLayout`**, `CoworkerSpineRow`, `ProviderRouteLaneLayout`, and `TOPOLOGY_LAYOUT_CONSTANTS`; [`OperationsTopologyCanvas.tsx`](../../../apps/web/components/platform/OperationsTopologyCanvas.tsx) renders it. The engine already has an A2A-arc and coworker-spine concept — this spec generalizes it to the cross-install app-integration graph rather than inventing a canvas.
- **Layout libs**: `dagre` + `elkjs` are already dependencies (graph layout); `--dpf-*` topology style tokens in `operations-topology-style.ts`.
- **Demand data spine**: [`demand-activity.ts`](../../../apps/web/lib/federation/demand-activity.ts) (`mapDemandSyncActivity`, origin/direction/status, `BI-3C662E7B`) is the per-flow read model — the tabular tier this map summarizes graphically.
- **Federation substrate**: `FederationLink` (installs, links, roles, environment), `FederatedRecordMirror` (flows), and — as the A2A slice lands — GAID/AIDoc via `principal-linking.ts` + the signed Agent Card.

## 4. The shared engine

A pure, dependency-free assembler (testable like `demand-activity.ts`) that produces a typed `AppIntegrationTopology` graph:

- **`TopologyOrg` → `TopologyInstall` → `TopologyAgent`** node hierarchy, each carrying its canonical id (`Organization`, `inst_…`, GAID) and environment class.
- **`TopologyFlowEdge`** per `FederationLink`, summarizing its flows (demand counts by `DemandSyncStatus` from `demand-activity`; A2A task counts later), direction, trust/readiness (A2A design §12.1), and the archetype-derived relationship preset.
- An **`archetypeShape`** classifier that maps each link/role to `mesh | hub-and-spoke | chain` so the layout adapter can choose the right dagre/elk arrangement.
- A **`collapse`/`expand`** projection so the same graph renders at org, install, agent, or flow depth without a second query.
- A **layer-health model (§1.1)**: each element carries a `derivedHealth` computed from the **lowest failing layer** beneath it (`layerOfFault`), plus the human reason attributed to *that* layer — not a generic red. Health propagates strictly upward: flow → edge → agent → install → org. This is a pure derivation over the same read model (demand `DemandSyncStatus`, link readiness, device-pin/verification state), so it is exhaustively unit-testable.
- A **traversal index**: for any element, `rootCausePath` (down to `layerOfFault`) and `impactSet` (the higher-layer elements a given lower-layer fault impairs). Both directions are first-class so the presentation layers can drill down to cause and up to blast radius.

Two thin presentation adapters consume it: (a) an **app-integration layer** toggle within `OperationsTopologyCanvas`; (b) a **focused Connections view**. Both use the shared engine + existing style tokens; neither forks the layout.

## 5. Privacy

Cross-organization nodes/edges show **only what the deny-by-default sharing gate already permits** (`cross-org-sharing.ts`, `mayShareDemandCrossOrg`): platform demand and public items surface; a customer's internal-domain agents/flows do not cross into a reseller/vendor's topology. Same-organization (e.g. the operator's prod ↔ dev) shows in full. The map never becomes a side channel around the egress gate — it reads the same mirrors, subject to the same classification.

## 6. Architecture review (advisory, inline)

- **Alignment: aligned.** The graph is a read model over `FederationLink` / `FederatedRecordMirror` / GAID projections; it introduces **no parallel authoritative table** (`schema-audit-before-features`, `single-source-of-truth`). The layered model has one home — the A2A design §7 — and this renders it, not re-defines it.
- **Extend, don't fork** (`architecture-over-shortcuts`): reuse `operations-topology-layout` + `OperationsTopologyCanvas` + dagre/elk; the engine generalizes the existing `A2aArcLayout`/`CoworkerSpineRow` rather than adding a second canvas.
- **Escalate to kernel** (when MCP reconnects): the layout-arrangement choice per archetype shape, and whether the collapse/expand state is per-viewer ephemeral or persisted, are 2–4-option decisions for `dpf-decision-via-kernel`.

## 7. UX-fit review (advisory, inline)

- **Owning area:** Platform (Connections + Operations map). **Personas:** operator/founder.
- **Navigation:** a layer toggle (Operations map) + a section view (Connections) — no new global destination.
- **Reuse/convergence:** topology primitives + report-kit for the tabular drill-down; no new metric/badge dialect.
- **AI boundary:** nodes/edges/flows are informational; clicking a remote agent may *offer* to start a coworker but only through the existing `AgentWorkLauncher` preview+confirm path (A2A design §12.2). No click sends a prompt.
- **Empty/failure:** a single-install estate shows itself and an invitation to connect; an unreachable/quarantined link renders a degraded edge with the safe next action (A2A design §12.1), never a silent gap.
- **Evidence before merge (build gate):** a **measured** `docs/ux-fit/*.ux-fit.json` for each UI-impacting slice (the reason BI-3C662E7B's panel awaits a served portal); route tests; theme scan; light/dark; narrow layout; reduced-motion.

## 8. Decomposition (staged BIs — file via MCP on reconnect)

1. **Slice 1 — shared engine (no UI surface).** `app-integration-topology.ts` read model + pure layout classifier (`archetypeShape`, collapse/expand) + unit tests. Feeds both entry points. No ux-fit gate (no UI). *Ships first; unblocks the rest.*
2. **Slice 2 — Connections view.** Focused topology on Platform → Connections; the "Sync activity" panel (`BI-3C662E7B`) becomes its tabular drill-down. Measured ux-fit manifest.
3. **Slice 3 — Operations-map layer.** App-integration layer toggle on `OperationsTopologyCanvas`. Measured ux-fit manifest.
4. **Slice 4 — A2A flows.** Extend edges with A2A task flows + provenance chips once the A2A coordination slice lands (companion spec). Sequenced after it.

Each slice cross-references the A2A epic and `BI-3C662E7B`.

## 9. Acceptance criteria

- The shared engine assembles org→install→agent nodes and typed flow edges from live substrate, at all four depths, with unit coverage for archetype-shape classification and collapse/expand.
- Both entry points render the same graph from the shared engine (no divergent data path).
- Prod vs dev is visually and programmatically distinct; cross-org shows only gate-permitted content.
- **Layer independence, propagation, and traversal (§1.1):** each layer is viewable independently; a lower-layer fault propagates `derivedHealth` upward with the reason attributed to `layerOfFault`; and both `rootCausePath` (down to cause) and `impactSet` (up to blast radius) are traversable. A regression that replays the lived case — a dead-lettered flow marks its edge/agent/install impaired, attributed to the transport layer, and drills to the stranded flow — is required unit coverage.
- Each UI slice lands with a measured ux-fit manifest, route tests, and theme/a11y/narrow-layout evidence.
