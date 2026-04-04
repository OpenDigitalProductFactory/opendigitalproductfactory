# Topology Graph Views: Context-Driven Layout Engine

| Field | Value |
|-------|-------|
| **Epic** | EP-GRAPH-VIEW-001 |
| **IT4IT Alignment** | S5.7 Operate (impact analysis, CMDB), S5.2 Explore (dependency awareness), S6.1 Enterprise Architecture FC |
| **Depends On** | EP-GRAPH-TOPO-001 (network topology discovery), discovery-inference.ts, neo4j-graph.ts |
| **Status** | Draft |
| **Created** | 2026-04-03 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

The inventory graph shows all entities and relationships as a single force-directed blob with raw relationship type filters (HOSTS, MEMBER_OF, ROUTES_THROUGH). This is not how anyone thinks about infrastructure:

- When looking at **network management** in the taxonomy, the user wants a **network topology view** -- hierarchical, gateway at top, hosts below, like HP NNMI or Datadog Device Topology Map.
- When looking at a **specific product**, the user wants a **dependency audit** -- what does this product depend on, all the way down to the network layer.
- When investigating a **potential failure**, the user wants an **impact blast radius** -- what breaks if this thing goes down.
- When looking at **container infrastructure**, the user wants a **hosting stack** -- Docker host at the top, runtime below, containers at the bottom.
- When exploring freely, the force-directed graph is fine -- but it should be the fallback, not the only option.

Commercial tools (ServiceNow CMDB Workspace, Datadog, NNMI, Grafana Node Graph) solve this with **named views** that bundle a layout algorithm + data filter + visual style. The user doesn't pick "HOSTS edges" -- they pick "Network Topology" and the system handles the rest.

## 2. Design

### 2.1 Taxonomy-Driven View Selection

The taxonomy tree already organizes infrastructure by domain. The graph view should auto-select based on which taxonomy node the user is browsing:

| Taxonomy Path Pattern | Auto-Selected View | Layout | Why |
|---|---|---|---|
| `*/network_management/**` | Network Topology | Hierarchical top-down | Gateway at root, subnets/hosts branch downward -- the NNMI pattern |
| `*/container_platform/**` | Hosting Stack | Hierarchical top-down | Docker host -> runtime -> containers |
| `*/compute/**` or `*/servers/**` | Hosting Stack | Hierarchical top-down | Physical/virtual compute hierarchy |
| `*/observability_platform/**` | Exploration (future: Monitoring Map) | Force-directed | Monitoring topology; radial layout from Prometheus is a future Phase 4 enhancement when MONITORS edges are populated |
| `*/platform_services/**` | Hosting Stack | Hierarchical top-down | Platform services are hosted infrastructure; same layout as container/compute views |
| Product detail page | Dependency Audit | Swimlane by OSI layer | Full-stack view from product (L7) down to network (L3) |
| "What if?" action on any node | Impact Blast Radius | Radial from selected node | Everything affected radiating outward by hop distance |
| Everything else / manual override | Exploration | Force-directed | General-purpose freeform graph |

The user can always override with a view switcher dropdown. The taxonomy just picks the smart default.

**Matching algorithm:** The taxonomy path patterns use `String.includes()` against the taxonomy `nodeId` string, checked in order from most specific to least specific. First match wins. For example, `foundational/platform_services/container_platform` matches `*/container_platform/**` before `*/platform_services/**`.

### 2.2 Named Views

Five named views, each combining a layout algorithm, data query, edge filter, and visual style:

#### View 1: Network Topology

**Layout:** Hierarchical top-down (dagre, direction=TB)
**Data:** `getNetworkTopologyAtLayer(3)` + gateway/subnet/host entities
**Edges shown:** HOSTS, MEMBER_OF, ROUTES_THROUGH, CONNECTS_TO, PEER_OF
**Edges hidden:** DEPENDS_ON, CLASSIFIED_AS, BELONGS_TO, PARENT_OF
**Node style:** Larger icons for gateways (at top), medium for subnets, smaller for hosts/interfaces. Color by status (green=operational, yellow=degraded, red=offline).
**Root detection:** Find gateway nodes (itemType=gateway) and place them at the top tier. Subnets at second tier. Hosts/interfaces at third tier.

#### View 2: Hosting Stack

**Layout:** Hierarchical top-down (dagre, direction=TB)
**Data:** Docker host + runtime + containers filtered by taxonomy subtree
**Edges shown:** HOSTS, RUNS_ON, MEMBER_OF
**Edges hidden:** ROUTES_THROUGH, MONITORS, DEPENDS_ON, taxonomy/portfolio edges
**Node style:** Docker host large at top, runtime medium, containers as a row at the bottom. Color by container health.
**Root detection:** Find docker_host or host nodes and place at top.

#### View 3: Impact Blast Radius

**Layout:** Radial tree from selected fault node
**Data:** `getDownstreamImpact(ciId)` -- everything affected by this node failing
**Edges shown:** All infrastructure types (the impact traversal covers all)
**Edges hidden:** Taxonomy/portfolio edges
**Node style:** Fault node large and red at center. Rings represent hop distance. Color shifts from red (direct) to orange (2 hops) to yellow (3+ hops).
**Trigger:** "Analyze Impact" action on any InfraCI node.

#### View 4: Dependency Audit (Full-Stack)

**Layout:** Layered with OSI partition bands (ELK.js with `elk.partitioning`)
**Data:** `getLayeredDependencyStack(productId)` -- all dependencies grouped by OSI layer
**Edges shown:** DEPENDS_ON, HOSTS, RUNS_ON, LISTENS_ON, MEMBER_OF, ROUTES_THROUGH
**Edges hidden:** MONITORS, taxonomy/portfolio edges
**Node style:** Horizontal bands labeled by OSI layer (L7 Application at top, L3 Network at bottom). Nodes positioned within their layer band. Edges flow vertically between bands.
**Context:** Shown on product detail pages and when a DigitalProduct is focused.

#### View 5: Exploration

**Layout:** Force-directed (current d3-force simulation, improved)
**Data:** `getFullGraphData()` -- everything
**Edges shown:** All (user toggles via filter buttons)
**Edges hidden:** User-controlled
**Node style:** Current implementation with colored nodes by type, hover highlighting, focus + hop filtering.
**Context:** Default fallback. Always available via view switcher.

### 2.3 View Switcher UI

Replace the current flat filter buttons with a toolbar that has:

```
[View: Network Topology v]  [Focus: Gateway 172.18.0.1 x]  [Hops: All 1 2 3]
```

- **View dropdown** -- Lists all 5 views. Current auto-selected view is shown. Selecting a different view overrides the auto-selection.
- **Focus selector** -- Click any node to focus. For Impact Blast Radius, this becomes the fault node. For Dependency Audit, this is the product.
- **Hop control** -- Already implemented; works across all views.
- **Node type toggles** -- Move below the toolbar as a secondary row, showing only types relevant to the current view.
- **Edge type toggles** -- Remove as primary UI. The view handles edge selection. Power users can still toggle individual types via a "..." overflow menu.

### 2.4 Layout Engine Architecture

A `useGraphLayout` hook that computes node positions based on the selected view:

```typescript
type LayoutAlgorithm = "force" | "hierarchical" | "radial" | "swimlane";

// Extends the existing GraphData type from apps/web/lib/actions/graph.ts.
// Input uses the established { nodes, links } shape. Output adds (x, y) positions.
type PositionedNode = GraphData["nodes"][0] & { x: number; y: number };

type LayoutResult = {
  nodes: PositionedNode[];
  links: GraphData["links"];  // pass-through; uses "links" (not "edges") to match GraphData
};

function useGraphLayout(
  data: GraphData,
  algorithm: LayoutAlgorithm,
  options: LayoutOptions,
): LayoutResult;
```

**Type contracts:** The hook consumes `GraphData` (as defined in `apps/web/lib/actions/graph.ts`, with `nodes` and `links` arrays) and produces `LayoutResult` which adds `(x, y)` coordinates to each node. The Neo4j types (`GraphNode`, `GraphEdge`) from `@dpf/db` are adapted to `GraphData` shape inside the server actions, not in the hook.

**Edge direction convention:** `DEPENDS_ON` edges point from consumer to provider (`A -[:DEPENDS_ON]-> B` means A depends on B). `HOSTS` edges point from parent to child (`DockerHost -[:HOSTS]-> Runtime`). Impact analysis via `getDownstreamImpact` traverses incoming edges (finding nodes that point toward the fault) -- this correctly identifies everything that depends on the failing node.

**Implementation strategy:**

- **Force** -- Keep the existing canvas-based simulation (already works). Improve with d3-force proper for better separation and link distance tuning.
- **Hierarchical** -- Use dagre (30KB). Compute positions, then render statically on canvas. No simulation needed.
- **Radial** -- Compute positions using a BFS from the root node, placing each depth ring at increasing radius. No external library needed for this -- it's a simple polar coordinate transform of a BFS tree.
- **Swimlane** -- Use ELK.js (400KB, async). Assign `elk.partitioning.partition` per node based on `osiLayer`. ELK computes positions respecting the partition constraints.

**Rendering:** All layouts render on the same Canvas element. The canvas renderer already handles nodes, edges, labels, hover, and click. Layout engines only compute `(x, y)` positions -- the renderer is shared.

### 2.5 Data Queries by View

Each view needs its own server action to fetch the right subset of graph data:

| View | Server Action | Neo4j Query |
|---|---|---|
| Network Topology | `getNetworkTopologyData(taxonomyNodeId?)` | InfraCI nodes at L3 + their edges, optionally filtered by taxonomy subtree |
| Hosting Stack | `getHostingStackData(taxonomyNodeId?)` | Docker host + runtime + containers + HOSTS/RUNS_ON edges |
| Impact Blast Radius | `getImpactData(ciId)` | Wraps `getDownstreamImpact(ciId)` from `@dpf/db` (Neo4j query implemented; server action wrapper needed) |
| Dependency Audit | `getDependencyAuditData(productId)` | Wraps `getLayeredDependencyStack(productId)` from `@dpf/db` (Neo4j query implemented; server action wrapper needed) |
| Exploration | `getFullGraphData()` | All nodes and edges -- server action already implemented |

### 2.6 Integration Points

**Portfolio page (`/portfolio/[[...slug]]`):**
When viewing a taxonomy node, the page already shows products and child nodes. Add a graph panel below the product list. The graph auto-selects the view based on the taxonomy path (Section 2.1 mapping).

**Inventory page (`/inventory`):**
Replace the current `RelationshipGraph` with the new multi-view graph component. Default to Exploration view. If the user navigates from a taxonomy node, inherit the context.

**Product detail page (`/portfolio/product/[id]`):**
Add a "Dependencies" tab or section with the Dependency Audit view pre-focused on that product.

**"Analyze Impact" action:**
Any InfraCI node in any view gets a context action (right-click or button) to open the Impact Blast Radius view centered on that node.

## 3. Dependencies

| Dependency | Size | Purpose |
|---|---|---|
| `dagre` | ~30KB | Hierarchical DAG layout for Network Topology and Hosting Stack views. Note: `dagre-d3-es` is already in the dependency tree (via EA canvas); evaluate reusing its bundled dagre module before adding a separate package. |
| `elkjs` | ~400KB (async, web worker capable) | Swimlane layout with OSI layer partitioning for Dependency Audit view |

Both are well-maintained, widely used, and have no transitive dependencies that conflict with the existing stack.

**Note on `dagre-d3-es`:** The project already depends on `dagre-d3-es@7.0.14` which bundles dagre internally. Phase 1 should evaluate whether the dagre layout engine can be imported from `dagre-d3-es/src/dagre` to avoid adding a duplicate dependency. If not, standalone `dagre` is acceptable.

## 4. Implementation Phases

### Phase 1: Layout Engine + View Switcher

1. Install dagre and elkjs
2. Create `useGraphLayout` hook with force, hierarchical, and radial algorithms
3. Create `GraphViewSwitcher` component with the 5 named views
4. Replace raw edge filter buttons with the view-aware toolbar
5. Wire dagre hierarchical layout for Network Topology view
6. Wire radial layout for Impact Blast Radius view

### Phase 2: Taxonomy-Driven Auto-Selection

1. Add taxonomy path → view mapping logic
2. Integrate graph panel into portfolio page with auto-view selection
3. Add server actions for view-specific data queries
4. Wire ELK.js swimlane layout for Dependency Audit view

### Phase 3: Product Integration + Polish

1. Add Dependency Audit view to product detail page
2. Add "Analyze Impact" context action on InfraCI nodes
3. Status-aware node coloring (green/yellow/red by operational status)
4. Edge labels on hover (show relationship type)
5. Node detail sidebar on click (show entity properties)

## 5. Non-Goals

- Real-time streaming updates (the graph refreshes on page load or manual refresh)
- 3D visualization
- Saved/custom layouts with drag-to-position
- Print/export to image (can be added later)
- L1-L2 physical topology views (no data source yet -- future SNMP/LLDP collectors)

## 6. Success Criteria

1. Navigating to `foundational/network_management` in the portfolio tree shows a hierarchical network topology graph with gateways at top and hosts below -- not a force-directed blob
2. Clicking "Analyze Impact" on the Docker host shows a radial blast radius of every container and product affected
3. Viewing a product's detail page shows its full dependency stack in OSI-layer swimlanes
4. The view auto-selects based on taxonomy context but can always be manually overridden
5. The force-directed exploration view remains available and continues to work as before
