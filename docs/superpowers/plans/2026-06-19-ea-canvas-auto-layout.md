# EA Canvas Auto-Layout — Implementation Plan

**BI:** BI-D9F9B34F · **Epic:** EP-ARCH-GRAPH-LIVE · **Date:** 2026-06-19 · **Mode:** direct (BS re-architecture override)

## Goal (operator /goal)

On the EA views/viewpoints canvas (`EaCanvas`, React Flow), replace the naive sqrt-grid with **automatic layout that minimizes edge crossings**, **save** it, keep **manual editing** afterward, add **revision history / undo** (restore a prior layout if the automatic one looks worse), and **nestle newly-added auto-generated nodes** into the existing layout instead of grid-backfilling.

## Substrate reused (verified — not rebuilt)

- `apps/web/lib/graph/` layout engines (render-agnostic, take `GraphData`→positioned nodes):
  - `computeHierarchicalLayout` (dagre, crossing-aware) — **hierarchical**
  - `computeRadialLayout` (BFS rings) — **radial** (matches the founder's hand-built hub-and-spoke)
  - `computeSwimLaneLayout` (ELK `layered`) — **layered** (gold-standard crossing minimization)
- `dagre`@0.8.5 + `elkjs`@0.11.1 already in `apps/web` deps; already used client-side by `TopologyGraph`.
- `EaView.canvasState` + `saveCanvasState` persistence; manual drag→1.5s autosave already works.
- Original EA-2 spec already drew an "Auto-layout button" and chose React Flow for ELK — never built.

## Changes

1. **`apps/web/lib/graph/layout-swimlane.ts`** — additive optional `nodeWidth/nodeHeight/layerSpacing/nodeSpacing` options (defaults preserve current TopologyGraph behavior). Lets the EA adapter request realistic ~170×80 node spacing.
2. **`apps/web/lib/ea/canvas-layout.ts`** (new, pure, unit-tested):
   - `computeEaLayout(nodes, edges, {algorithm})` → `Record<viewElementId,{x,y}>`, adapting EA elements/edges → `GraphData`, calling the existing engines, normalizing each engine's coordinate convention to React Flow top-left.
   - `placeIncremental(existing, edges, newIds)` → centroid-of-placed-neighbors + collision-avoidance (fallback: parked at bbox edge).
3. **`apps/web/lib/explore/ea-types.ts`** — extend `CanvasState` with optional bounded `history: CanvasLayoutRevision[]` (restore points). Backward-compatible; `saveCanvasState`/`addElementToView` already round-trip the whole JSON, so no server change.
4. **`apps/web/components/ea/EaCanvas.tsx`**:
   - "Auto-layout ▾" control (algorithm picker, remembers last via localStorage) — snapshots current layout into `history` (cap 10), runs `computeEaLayout`, repositions top-level nodes, persists.
   - "Revisions ▾" menu — list snapshots newest-first; Restore applies a snapshot's positions and persists.
   - On first mount of a view with no meaningful saved layout, run the default layout (replaces the grid) — SSR-safe (grid placeholder → upgrade on mount); persists only for editors.
   - Incremental backfill in `buildNodeLayout` uses `placeIncremental` instead of grid-fill.

Layout repositions **top-level** nodes only; structured value-stream children follow their parent (relative positions unchanged).

## Tests

- `apps/web/lib/ea/canvas-layout.test.ts`: each algorithm returns a position per node, no NaN, deterministic for fixed input; `placeIncremental` places a new node near its single neighbor, avoids overlap, and parks an unconnected node clear of the bbox; empty/single-node guards.

## Verification

Local: vitest on the adapter; full web suite before push. CI green. Functional: load an auto-generated EA view, click each algorithm, drag a node, reload (persisted), restore a revision, add an element and confirm it nestles by its neighbor.

---

## Addendum — 2026-06-20: shape-aware layouts for large models + 2 UX fixes (BI-20F95B0E)

Live review of the deployed #2151 surfaced that the layouts sprawl into hairballs on large views, plus two UX bugs. Two research passes (web + live-DB) found: the big views are **trees/forests stored as flat "contains" edges** (Application Routes 615n/614e tree; Code Structure 343n star; Data Model 424n/1262e/57 isolated), and the layered path **never set `elk.separateConnectedComponents`**, so disconnected nodes spread. `EaViewElement.parentViewElementId` (containment nesting) is schema-supported but never populated by the generators.

**Shipped (no new dependency — ELK already installed):**
- Rewrote `apps/web/lib/ea/canvas-layout.ts` to call ELK directly (dropping the swimlane-partitioner detour) with `separateConnectedComponents=true` + component spacing + aspect ratio on every ELK path.
- Algorithm set is now **`auto` (default) · `organic` (ELK stress, capped iterations) · `tree` (ELK mrtree) · `layered` (ELK, tuned) · `radial` (BFS)** — replaces the old layered/radial/hierarchical trio.
- `pickAutoAlgorithm` + `computeMetrics` (union-find components + cycle detection + degree stats): tree/forest→tree, star→radial, dense/disconnected→organic, else layered.
- `EaCanvas` picker → an **Auto-layout** primary button + a layout menu (`▾`) for specific algorithms.
- **UX fix B:** `proOptions={{ hideAttribution: true }}` removes the React Flow badge (@xyflow/react is MIT).
- **UX fix C:** added a `← Views` back link (→ `/ea/views`) to the EA top bar, matching the sibling-detail-page pattern.

**Deferred follow-ups (file separately):** populate `parentViewElementId` from "contains" edges + render containment as nested groups (`elk.hierarchyHandling: INCLUDE_CHILDREN` + React Flow parent nodes) — biggest structural ceiling; and move ELK to a Web Worker for 600-node perf.

---

## Addendum — 2026-06-20: containment (nested) view (BI-9E5EA3FF)

Operator /goal "do as recommended with the container view" — built the deferred containment nesting. Rather than the generator/migration route, derive nesting **client-side from `contains` edges** (the dominant relationship: 1887 live; directed parent→child) so it works on existing views with no schema/data change. Custom recursive shelf-packer chosen over ELK compound — simpler + predictable for the pure-`contains` trees that dominate (ELK `INCLUDE_CHILDREN` noted as a future enhancement for cross-edge-heavy containment).

- `apps/web/lib/ea/canvas-layout.ts`: `computeContainmentLayout(nodeIds, containsEdges)` — builds the forest, packs each container's children into a wrapped grid, sizes the container to fit; returns `{id, parentId, x, y (parent-relative), width, height, isContainer, depth}` (parents before children for React Flow ordering). Guards: first-parent-wins (forest), cycle/in-progress, unknown-node, and a cycle-fallback so no node is dropped. Unit-tested.
- `apps/web/components/ea/EaContainerNode.tsx` (new): titled translucent box, layer-coloured; children render inside via React Flow `parentId`.
- `apps/web/components/ea/EaCanvas.tsx`: a **▦ Nest** toggle (localStorage-persisted, available to read-only too since nothing is saved) swaps the node/edge set to nested boxes (containers + nested leaves; only cross-cutting edges drawn — `contains` becomes nesting). Flat layout controls hidden while nested; flat auto-layout mount-effect guarded.

Tests: 30 adapter (6 containment) + 16 EA component + 52 graph/actions/topology pass; web typecheck clean.

---

## Addendum — 2026-06-20: fix nested-view edge detachment

Live-review regression on the containment view: cross-cutting edges detached from the boxes (bunched near the canvas origin) and didn't follow a container when moved. Cause: the floating `EaRelationshipEdge` built node geometry from `node.position`, which for nested children is **relative to the container** — fine in flat mode (all nodes top-level) but wrong when nested. Fix: new pure `apps/web/lib/ea/node-geometry.ts` `resolveAbsolutePositions` (sums the parent chain, cycle-guarded, unit-tested); `EaRelationshipEdge` now anchors edges on absolute positions, so they stay attached and track container moves (`useNodes()` re-fires on drag). Tests: +5 node-geometry; web typecheck clean.

---

## Addendum — 2026-06-20: crossing-minimizing layouts + relationship-aware nesting (BI-6333C6BC)

Live review (research-backed): "organic" stays chaotic, and the nested view's inner layout ignored sibling relationships.

- **Crossing minimization (flat):** research confirmed ELK `stress` ("organic") optimizes distance, not crossings; **ELK `layered` (Sugiyama) is the crossing minimizer** and handles cyclic graphs via cycle-breaking. `pickAutoAlgorithm` now routes any non-forest (dependency mesh) to **layered** (not organic); layered tuned with `crossingMinimization.strategy=LAYER_SWEEP`, `nodePlacement=BRANDES_KOEPF`+`bk.edgeStraightening`, `cycleBreaking=GREEDY`, `edgeRouting=ORTHOGONAL`, and `thoroughness` restored to 7 (4 only for n>400). "Organic" relabeled honestly and kept as a manual option.
- **Edge style from layout:** layered/tree → step (right-angle), organic/radial → straight — driven automatically when a layout runs (curved/bezier looked chaotic on dense graphs).
- **Relationship-aware nesting (compound):** `computeContainmentLayout` now uses ELK compound (`hierarchyHandling: INCLUDE_CHILDREN`) — children are laid out INSIDE their container by their cross-cutting edges (crossing-minimized; e.g. MCP Tool Authority's 271 Traces among 308 children), containers sized to fit. ELK's parent-relative coords + sizes map straight onto React Flow `parentId`/`extent`/`style`. The shelf packer is retained as a resilient fallback (and for the pure-cycle case). Nested edges render orthogonally (step).
- **Deferred follow-up:** persist nested manual edits (drag) across reload (canvasState nesting schema) — nodes are draggable in-session today.

Tests: 33 adapter (incl. compound + dense→layered) + 40 component/graph; web typecheck clean. No new dependency.
