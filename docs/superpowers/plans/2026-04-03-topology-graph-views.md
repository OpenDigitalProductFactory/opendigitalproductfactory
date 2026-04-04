# Topology Graph Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single force-directed graph with five named views (Network Topology, Hosting Stack, Impact Blast Radius, Dependency Audit, Exploration) that auto-select based on taxonomy context and use domain-appropriate layout algorithms.

**Architecture:** A `useGraphLayout` hook dispatches to layout engines (dagre for hierarchical, BFS for radial, ELK for swimlane, existing force simulation for exploration). A shared canvas renderer draws all layouts. Server actions provide view-specific data. A view switcher toolbar replaces the raw relationship type filters.

**Tech Stack:** dagre (via existing `dagre-d3-es`), `elkjs` (new), Canvas 2D rendering (existing), Next.js server actions, Neo4j Cypher

**Spec:** `docs/superpowers/specs/2026-04-03-topology-graph-views-design.md` (EP-GRAPH-VIEW-001)

---

### Task 1: Install elkjs + Create Layout Type Contracts

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/graph/types.ts`
- Create: `apps/web/lib/graph/view-config.ts`

- [ ] **Step 1: Install elkjs** — `pnpm --filter web add elkjs`
- [ ] **Step 2: Create type contracts** — Create `apps/web/lib/graph/types.ts` with:

```typescript
import type { GraphData } from "@/lib/actions/graph";

export type GraphViewName =
  | "network-topology"
  | "hosting-stack"
  | "impact-blast-radius"
  | "dependency-audit"
  | "exploration";

export type LayoutAlgorithm = "force" | "hierarchical" | "radial" | "swimlane";

export type PositionedNode = GraphData["nodes"][0] & {
  x: number;
  y: number;
  osiLayer?: number | null;
};

export type LayoutResult = {
  nodes: PositionedNode[];
  links: GraphData["links"];
};

export type ViewConfig = {
  name: GraphViewName;
  label: string;
  layout: LayoutAlgorithm;
  direction?: "TB" | "LR";
  edgesShown: Set<string>;
  nodeTypesShown: Set<string>;
  rootDetection: "gateway" | "docker_host" | "focus" | "product" | "none";
  description: string;
};
```

- [ ] **Step 3: Create view config map** — Create `apps/web/lib/graph/view-config.ts` with the 5 view configs:

```typescript
import type { GraphViewName, ViewConfig } from "./types";

export const VIEW_CONFIGS: Record<GraphViewName, ViewConfig> = {
  "network-topology": {
    name: "network-topology",
    label: "Network Topology",
    layout: "hierarchical",
    direction: "TB",
    edgesShown: new Set(["HOSTS", "MEMBER_OF", "ROUTES_THROUGH", "CONNECTS_TO", "PEER_OF"]),
    nodeTypesShown: new Set(["InfraCI"]),
    rootDetection: "gateway",
    description: "Hierarchical network view: gateways at top, subnets and hosts below",
  },
  "hosting-stack": {
    name: "hosting-stack",
    label: "Hosting Stack",
    layout: "hierarchical",
    direction: "TB",
    edgesShown: new Set(["HOSTS", "RUNS_ON", "MEMBER_OF"]),
    nodeTypesShown: new Set(["InfraCI"]),
    rootDetection: "docker_host",
    description: "Docker host to runtime to containers",
  },
  "impact-blast-radius": {
    name: "impact-blast-radius",
    label: "Impact Analysis",
    layout: "radial",
    edgesShown: new Set(["HOSTS", "RUNS_ON", "MONITORS", "MEMBER_OF", "ROUTES_THROUGH", "DEPENDS_ON", "LISTENS_ON", "CARRIED_BY", "CONNECTS_TO", "PEER_OF"]),
    nodeTypesShown: new Set(["InfraCI", "DigitalProduct"]),
    rootDetection: "focus",
    description: "What breaks if this node fails? Radial blast radius from selected node.",
  },
  "dependency-audit": {
    name: "dependency-audit",
    label: "Dependency Audit",
    layout: "swimlane",
    direction: "TB",
    edgesShown: new Set(["DEPENDS_ON", "HOSTS", "RUNS_ON", "LISTENS_ON", "MEMBER_OF", "ROUTES_THROUGH"]),
    nodeTypesShown: new Set(["InfraCI", "DigitalProduct"]),
    rootDetection: "product",
    description: "Full-stack dependency view grouped by OSI layer",
  },
  "exploration": {
    name: "exploration",
    label: "Exploration",
    layout: "force",
    edgesShown: new Set(["BELONGS_TO", "CLASSIFIED_AS", "PARENT_OF", "DEPENDS_ON", "HOSTS", "MEMBER_OF", "ROUTES_THROUGH", "RUNS_ON", "MONITORS", "PEER_OF"]),
    nodeTypesShown: new Set(["Portfolio", "TaxonomyNode", "DigitalProduct", "InfraCI"]),
    rootDetection: "none",
    description: "Force-directed freeform exploration of all entities",
  },
};

/** Map taxonomy nodeId patterns to views, most specific first. */
const TAXONOMY_VIEW_RULES: Array<{ pattern: string; view: GraphViewName }> = [
  { pattern: "network_management", view: "network-topology" },
  { pattern: "container_platform", view: "hosting-stack" },
  { pattern: "servers", view: "hosting-stack" },
  { pattern: "compute", view: "hosting-stack" },
  { pattern: "observability_platform", view: "exploration" },
  { pattern: "platform_services", view: "hosting-stack" },
];

export function resolveViewForTaxonomy(nodeId: string | null): GraphViewName {
  if (!nodeId) return "exploration";
  for (const rule of TAXONOMY_VIEW_RULES) {
    if (nodeId.includes(rule.pattern)) return rule.view;
  }
  return "exploration";
}
```

- [ ] **Step 4: Commit** — `feat(graph): layout type contracts and view configuration`

---

### Task 2: Hierarchical Layout Engine (dagre)

**Files:**
- Create: `apps/web/lib/graph/layout-hierarchical.ts`
- Test: `apps/web/lib/graph/layout-hierarchical.test.ts`

- [ ] **Step 1: Write failing test** — Test that `computeHierarchicalLayout` accepts `GraphData` + options and returns `LayoutResult` with `(x, y)` on every node. Test with a simple 3-node chain (gateway → subnet → host).
- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter web exec vitest run layout-hierarchical.test.ts`
- [ ] **Step 3: Implement** — Use `dagre-d3-es/src/dagre/index.js` for `layout` and `dagre-d3-es/src/graphlib/index.js` for `Graph`:

```typescript
import { Graph } from "dagre-d3-es/src/graphlib/index.js";
import { layout } from "dagre-d3-es/src/dagre/index.js";
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

type HierarchicalOptions = {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  rootIds?: string[];  // Nodes to force to the top tier
};

export function computeHierarchicalLayout(
  data: GraphData,
  options: HierarchicalOptions = {},
): LayoutResult {
  const { direction = "TB", nodeWidth = 60, nodeHeight = 30, rankSep = 80, nodeSep = 40 } = options;

  const g = new Graph({ directed: true, compound: false, multigraph: false });
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of data.nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight, label: node.name });
  }

  for (const link of data.links) {
    if (data.nodes.some((n) => n.id === link.source) && data.nodes.some((n) => n.id === link.target)) {
      g.setEdge(link.source, link.target);
    }
  }

  layout(g);

  const nodes: PositionedNode[] = data.nodes.map((node) => {
    const gNode = g.node(node.id);
    return { ...node, x: gNode?.x ?? 0, y: gNode?.y ?? 0 };
  });

  return { nodes, links: data.links };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(graph): hierarchical layout engine using dagre`

---

### Task 3: Radial Layout Engine (BFS)

**Files:**
- Create: `apps/web/lib/graph/layout-radial.ts`
- Test: `apps/web/lib/graph/layout-radial.test.ts`

- [ ] **Step 1: Write failing test** — Test that `computeRadialLayout` places the root node at center and neighbors in concentric rings by hop distance.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement** — BFS from root, assign each node a ring (depth) and angle (evenly distributed among siblings):

```typescript
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

type RadialOptions = {
  rootId: string;
  ringSpacing?: number;
  centerX?: number;
  centerY?: number;
};

export function computeRadialLayout(
  data: GraphData,
  options: RadialOptions,
): LayoutResult {
  const { rootId, ringSpacing = 120, centerX = 400, centerY = 300 } = options;

  // BFS to get depth of each node
  const adjacency = new Map<string, string[]>();
  for (const link of data.links) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, []);
    if (!adjacency.has(link.target)) adjacency.set(link.target, []);
    adjacency.get(link.source)!.push(link.target);
    adjacency.get(link.target)!.push(link.source);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [rootId];
  depth.set(rootId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current)!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, currentDepth + 1);
        queue.push(neighbor);
      }
    }
  }

  // Group by ring
  const rings = new Map<number, string[]>();
  for (const [nodeId, d] of depth) {
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(nodeId);
  }

  // Position: root at center, each ring at increasing radius
  const positionMap = new Map<string, { x: number; y: number }>();
  positionMap.set(rootId, { x: centerX, y: centerY });

  for (const [ring, nodeIds] of rings) {
    if (ring === 0) continue;
    const radius = ring * ringSpacing;
    nodeIds.forEach((nodeId, i) => {
      const angle = (2 * Math.PI * i) / nodeIds.length - Math.PI / 2;
      positionMap.set(nodeId, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });
  }

  const nodes: PositionedNode[] = data.nodes.map((node) => {
    const pos = positionMap.get(node.id) ?? { x: centerX, y: centerY };
    return { ...node, ...pos };
  });

  return { nodes, links: data.links };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(graph): radial BFS layout engine for impact analysis`

---

### Task 4: Swimlane Layout Engine (ELK.js)

**Files:**
- Create: `apps/web/lib/graph/layout-swimlane.ts`
- Test: `apps/web/lib/graph/layout-swimlane.test.ts`

- [ ] **Step 1: Write failing test** — Test that `computeSwimLaneLayout` places nodes with `osiLayer=7` above nodes with `osiLayer=3`, and returns positions for all nodes.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement** — Use ELK.js with partitioning:

```typescript
import ELK from "elkjs/lib/elk.bundled.js";
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

const elk = new ELK();

export async function computeSwimLaneLayout(
  data: GraphData,
  getOsiLayer: (nodeId: string) => number | null,
): Promise<LayoutResult> {
  const children = data.nodes.map((node) => {
    const layer = getOsiLayer(node.id);
    return {
      id: node.id,
      width: 60,
      height: 30,
      layoutOptions: layer != null
        ? { "elk.partitioning.partition": String(7 - layer) }
        : {},
    };
  });

  const edges = data.links
    .filter((l) => data.nodes.some((n) => n.id === l.source) && data.nodes.some((n) => n.id === l.target))
    .map((link, i) => ({
      id: `e${i}`,
      sources: [link.source],
      targets: [link.target],
    }));

  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.spacing.nodeNode": "30",
    },
    children,
    edges,
  });

  const posMap = new Map<string, { x: number; y: number }>();
  for (const child of graph.children ?? []) {
    posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const nodes: PositionedNode[] = data.nodes.map((node) => {
    const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
    return { ...node, ...pos, osiLayer: getOsiLayer(node.id) };
  });

  return { nodes, links: data.links };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(graph): ELK.js swimlane layout with OSI partitioning`

---

### Task 5: `useGraphLayout` Hook

**Files:**
- Create: `apps/web/lib/graph/use-graph-layout.ts`

- [ ] **Step 1: Implement the dispatch hook** — Calls the right layout engine based on `ViewConfig.layout`:

```typescript
import { useState, useEffect } from "react";
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, ViewConfig } from "./types";
import { computeHierarchicalLayout } from "./layout-hierarchical";
import { computeRadialLayout } from "./layout-radial";
import { computeSwimLaneLayout } from "./layout-swimlane";

export function useGraphLayout(
  data: GraphData,
  view: ViewConfig,
  focusNodeId: string | null,
  dimensions: { width: number; height: number },
): LayoutResult | null {
  const [result, setResult] = useState<LayoutResult | null>(null);

  useEffect(() => {
    // Filter data by view config
    const filteredNodes = data.nodes.filter((n) => view.nodeTypesShown.has(n.label));
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = data.links.filter(
      (l) => view.edgesShown.has(l.type) && filteredNodeIds.has(l.source) && filteredNodeIds.has(l.target),
    );
    const filtered: GraphData = { nodes: filteredNodes, links: filteredLinks };

    if (filtered.nodes.length === 0) {
      setResult({ nodes: [], links: [] });
      return;
    }

    switch (view.layout) {
      case "hierarchical": {
        const roots = detectRoots(filtered, view);
        setResult(computeHierarchicalLayout(filtered, { direction: view.direction, rootIds: roots }));
        break;
      }
      case "radial": {
        const rootId = focusNodeId ?? filtered.nodes[0]?.id ?? "";
        setResult(computeRadialLayout(filtered, {
          rootId,
          centerX: dimensions.width / 2,
          centerY: dimensions.height / 2,
        }));
        break;
      }
      case "swimlane": {
        const osiMap = new Map(filtered.nodes.map((n) => [n.id, (n as Record<string, unknown>).osiLayer as number | null ?? null]));
        computeSwimLaneLayout(filtered, (id) => osiMap.get(id) ?? null).then(setResult);
        break;
      }
      case "force":
      default:
        // Return null to signal the existing force simulation should be used
        setResult(null);
        break;
    }
  }, [data, view, focusNodeId, dimensions]);

  return result;
}

function detectRoots(data: GraphData, view: ViewConfig): string[] {
  switch (view.rootDetection) {
    case "gateway":
      return data.nodes.filter((n) => n.name.toLowerCase().includes("gateway") || n.name.toLowerCase().includes("gw ")).map((n) => n.id);
    case "docker_host":
      return data.nodes.filter((n) => n.name.toLowerCase().includes("docker") && n.name.toLowerCase().includes("host")).map((n) => n.id);
    default:
      return [];
  }
}
```

- [ ] **Step 2: Commit** — `feat(graph): useGraphLayout dispatch hook`

---

### Task 6: View-Specific Server Actions

**Files:**
- Modify: `apps/web/lib/actions/graph.ts`

- [ ] **Step 1: Add `getNetworkTopologyData` and `getHostingStackData` server actions** — Query InfraCI nodes filtered by ciType and their edges. Add `osiLayer` to the GraphData node shape.
- [ ] **Step 2: Add `getImpactData` server action** — Wraps `getDownstreamImpact` from `@dpf/db` and converts to `GraphData` shape.
- [ ] **Step 3: Add `getDependencyAuditData` server action** — Wraps `getLayeredDependencyStack` from `@dpf/db` and converts to `GraphData` shape with `osiLayer` on each node.
- [ ] **Step 4: Extend `GraphData` type** — Add optional `osiLayer` and `status` to node type:

```typescript
export type GraphData = {
  nodes: Array<{
    id: string;
    name: string;
    label: string;
    color: string;
    size: number;
    osiLayer?: number | null;
    status?: string | null;
    ciType?: string | null;
  }>;
  links: Array<{
    source: string;
    target: string;
    type: string;
  }>;
};
```

- [ ] **Step 5: Commit** — `feat(graph): view-specific server actions for all five views`

---

### Task 7: Multi-View Graph Component

**Files:**
- Create: `apps/web/components/inventory/TopologyGraph.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`

- [ ] **Step 1: Create `TopologyGraph` component** — Combines the view switcher toolbar, `useGraphLayout` hook, and the canvas renderer. For `force` layout, reuse the existing force simulation from `RelationshipGraph.tsx`. For positioned layouts (hierarchical, radial, swimlane), render nodes at computed `(x, y)` with no simulation.

The component accepts:
```typescript
type Props = {
  data: GraphData;
  defaultView?: GraphViewName;
  taxonomyNodeId?: string | null;
  focusNodeId?: string | null;
};
```

The toolbar shows:
- View dropdown (auto-selected from `taxonomyNodeId` via `resolveViewForTaxonomy`)
- Focus node display + clear button
- Hop depth control (for exploration view)

- [ ] **Step 2: Replace `RelationshipGraph` usage on inventory page** — Update `apps/web/app/(shell)/inventory/page.tsx` to use `TopologyGraph` instead, passing `getFullGraphData()` result.

- [ ] **Step 3: Commit** — `feat(graph): multi-view TopologyGraph component with view switcher`

---

### Task 8: Portfolio Page Integration

**Files:**
- Modify: `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`
- Modify: `apps/web/components/portfolio/PortfolioNodeDetail.tsx`

- [ ] **Step 1: Add graph panel to portfolio node detail** — When viewing a taxonomy node, fetch the appropriate graph data (network topology for network nodes, hosting stack for compute nodes, exploration for others) and render `TopologyGraph` with the auto-selected view.
- [ ] **Step 2: Pass `taxonomyNodeId` to TopologyGraph** — So it auto-selects the right view based on the taxonomy path.
- [ ] **Step 3: Commit** ��� `feat(graph): taxonomy-driven graph views on portfolio pages`

---

### Task 9: Impact Analysis Action

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`

- [ ] **Step 1: Add "Analyze Impact" to node right-click/context menu** — When user clicks an InfraCI node and selects "Analyze Impact", switch to Impact Blast Radius view with that node as the focus.
- [ ] **Step 2: Fetch impact data** — Call `getImpactData(ciId)` server action and pass result to the radial layout.
- [ ] **Step 3: Commit** — `feat(graph): analyze impact action on InfraCI nodes`

---

### Task 10: Status-Aware Coloring + Edge Labels

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`

- [ ] **Step 1: Color nodes by operational status** — For InfraCI nodes: green=operational, yellow=degraded, red=offline. Use `status` property from `GraphData`.
- [ ] **Step 2: Show edge type labels on hover** — When hovering an edge, display the relationship type (e.g., "HOSTS", "MEMBER_OF") as a tooltip near the edge midpoint.
- [ ] **Step 3: Node detail on click** — When a node is focused, show a small info panel below the graph with the node's name, type, status, OSI layer, and properties.
- [ ] **Step 4: Commit** — `feat(graph): status coloring, edge labels, and node detail panel`
