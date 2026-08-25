"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow, Background, Controls, ConnectionMode, MarkerType,
  useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type OnNodesChange, type ReactFlowInstance, type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SerializedViewElement, SerializedEdge, CanvasState, CanvasLayoutRevision } from "@/lib/ea-types";
import { buildStructuredViewElements, filterStructuredEdges } from "@/lib/ea-structure";
import {
  computeEaLayout,
  placeIncremental,
  computeContainmentLayout,
  pickAutoAlgorithm,
  dedupeRenderEdges,
  EA_LAYOUT_ALGORITHMS,
  EA_LAYOUT_LABELS,
  type EaLayoutAlgorithm,
  type EaLayoutEdge,
} from "@/lib/ea/canvas-layout";
import { EaContainerNode } from "./EaContainerNode";
import { EaElementNode } from "./EaElementNode";
import { EaRelationshipEdge } from "./EaRelationshipEdge";
import { ElementPalette } from "./ElementPalette";
import { ElementInspector } from "./ElementInspector";
import { ReferencePopup } from "./ReferencePopup";
import { buildOperationalValueStreamRows, OperationalValueStreamTable } from "./OperationalValueStreamTable";
import { EdgeVariantToggle, PresentationToggle, type EdgeVariant, type PresentationMode } from "./EaViewControls";
import {
  addElementToView,
  createEaRelationship,
  deleteEaRelationship,
  moveStructuredViewElement,
  saveCanvasState,
  getDefaultRelTypeIdForView,
} from "@/lib/actions/ea";
import { buildValueStreamGroupLayout, estimateStageWidth } from "./value-stream-layout";

const NODE_TYPES = { eaElement: EaElementNode, eaContainer: EaContainerNode };
const EDGE_TYPES = { eaRelationship: EaRelationshipEdge };

const DEFAULT_CANVAS_STATE: CanvasState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: {},
};

type ElementTypeOption = { id: string; slug: string; name: string; neoLabel: string };

type ViewpointInfo = {
  id: string;
  name: string;
  allowedElementTypeSlugs: string[];
  allowedRelTypeSlugs: string[];
};

type Props = {
  viewId: string;
  viewName: string;
  viewStatus: string;
  notationSlug: string;
  viewpoint: ViewpointInfo | null;
  allElementTypes: ElementTypeOption[];
  initialElements: SerializedViewElement[];
  initialEdges: SerializedEdge[];
  initialCanvasState: CanvasState | null;
  initialFocusElementId?: string | null;
  isReadOnly: boolean;
};
const MAX_LAYOUT_REVISIONS = 10;

function defaultLayoutAlgo(): EaLayoutAlgorithm {
  if (typeof window === "undefined") return "auto";
  const v = window.localStorage.getItem("ea-layout-algo");
  return v && (EA_LAYOUT_ALGORITHMS as string[]).includes(v) ? (v as EaLayoutAlgorithm) : "auto";
}

function makeRevisionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `rev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Append a restore point, dropping the oldest beyond the cap (bounded ring buffer).
function pushRevision(
  history: CanvasLayoutRevision[],
  label: string,
  nodes: Record<string, { x: number; y: number }>,
): CanvasLayoutRevision[] {
  const next = [...history, { id: makeRevisionId(), at: Date.now(), label, nodes }];
  return next.length > MAX_LAYOUT_REVISIONS ? next.slice(next.length - MAX_LAYOUT_REVISIONS) : next;
}

// Relationship edges remapped to top-level node ids (structured children collapse to their
// parent) — used for crossing-minimizing layout and neighbor-aware incremental placement.
function buildLayoutEdges(
  visibleElements: SerializedViewElement[],
  visibleEdges: SerializedEdge[],
): EaLayoutEdge[] {
  const parentOf = new Map<string, string | null>();
  for (const el of visibleElements) parentOf.set(el.viewElementId, el.parentViewElementId);
  const topAncestor = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (true) {
      const parent = parentOf.get(cur);
      if (!parent || seen.has(cur)) return cur;
      seen.add(cur);
      cur = parent;
    }
  };
  // Collapse parallel + bidirectional edges to ONE structural edge per unordered top-ancestor
  // pair. Duplicate/bidirectional relationships otherwise make ELK "see" a much denser graph
  // than exists and pull nodes together (BI-F1B5C04B).
  const out: EaLayoutEdge[] = [];
  const seen = new Set<string>();
  for (const e of visibleEdges) {
    const source = topAncestor(e.fromViewElementId);
    const target = topAncestor(e.toViewElementId);
    if (!source || !target || source === target) continue;
    const key = source < target ? `${source} ${target}` : `${target} ${source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, target });
  }
  return out;
}

function buildNodeLayout(
  elements: SerializedViewElement[],
  canvasState: CanvasState | null,
  layoutEdges: EaLayoutEdge[],
): {
  nodes: Record<string, { x: number; y: number }>;
  needsInitialAutoLayout: boolean;
  backfilled: boolean;
} {
  const savedNodes = canvasState?.nodes ?? {};
  const elementCount = elements.length;

  if (elementCount <= 1) {
    const single = elements[0];
    if (!single) return { nodes: {}, needsInitialAutoLayout: false, backfilled: false };
    return {
      nodes: { [single.viewElementId]: savedNodes[single.viewElementId] ?? { x: 0, y: 0 } },
      needsInitialAutoLayout: false,
      backfilled: false,
    };
  }

  const savedCount = elements.filter((ve) => Boolean(savedNodes[ve.viewElementId])).length;
  const allSavedAtOrigin =
    savedCount === elementCount &&
    elements.every((ve) => {
      const pos = savedNodes[ve.viewElementId];
      return pos != null && pos.x === 0 && pos.y === 0;
    });

  // Fresh / auto-generated view (nothing meaningful saved): lay out on a grid as a cheap,
  // SSR-safe placeholder. The canvas upgrades it to a real crossing-minimizing layout on mount.
  if (savedCount === 0 || allSavedAtOrigin) {
    const cols = Math.ceil(Math.sqrt(elementCount));
    const xStep = 240;
    const yStep = 150;
    const nodes: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < elementCount; i += 1) {
      const ve = elements[i];
      if (!ve) continue;
      nodes[ve.viewElementId] = { x: (i % cols) * xStep, y: Math.floor(i / cols) * yStep };
    }
    return { nodes, needsInitialAutoLayout: true, backfilled: false };
  }

  // Existing layout with new elements added: keep every saved position untouched and nestle
  // the new nodes next to their connected neighbors (minimal disruption), instead of re-gridding.
  const nodes = { ...savedNodes } as Record<string, { x: number; y: number }>;
  const missingIds = elements
    .filter((ve) => !nodes[ve.viewElementId])
    .map((ve) => ve.viewElementId);
  if (missingIds.length > 0) {
    const placed = placeIncremental(nodes, layoutEdges, missingIds);
    for (const [id, pos] of Object.entries(placed)) nodes[id] = pos;
  }
  return { nodes, needsInitialAutoLayout: false, backfilled: missingIds.length > 0 };
}

function buildNodes(
  elements: SerializedViewElement[],
  canvasState: CanvasState | null,
  layoutEdges: EaLayoutEdge[],
): {
  nodes: Node[];
  needsInitialAutoLayout: boolean;
  backfilled: boolean;
} {
  const structuredChildIds = new Set<string>();
  for (const element of elements) {
    for (const child of element.childViewElements ?? []) {
      structuredChildIds.add(child.viewElementId);
    }
  }

  const topLevelElements = elements.filter((element) => !structuredChildIds.has(element.viewElementId));
  const topLevelLayout = buildNodeLayout(topLevelElements, canvasState, layoutEdges);
  const nodes: Node[] = [];

  for (const element of topLevelElements) {
    const position = topLevelLayout.nodes[element.viewElementId] ?? { x: 0, y: 0 };

    if (element.rendererHint === "nested_chevron_sequence") {
      const childStages = [...(element.childViewElements ?? [])].sort((left, right) => {
        const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.viewElementId.localeCompare(right.viewElementId);
      });
      const groupLayout = buildValueStreamGroupLayout({
        origin: position,
        stageLabels: childStages.map((child) => child.element.name),
      });

      nodes.push({
        id: element.viewElementId,
        type: "eaElement",
        position,
        data: element,
      });

      childStages.forEach((child, index) => {
        const stageFrame = groupLayout.stages[index];
        if (!stageFrame) return;

        nodes.push({
          id: child.viewElementId,
          type: "eaElement",
          position: {
            x: stageFrame.x - groupLayout.band.x,
            y: stageFrame.y - groupLayout.band.y,
          },
          parentId: element.viewElementId,
          data: child,
        });
      });
      continue;
    }

    nodes.push({
      id: element.viewElementId,
      type: "eaElement",
      position,
      data: element,
    });
  }

  return {
    needsInitialAutoLayout: topLevelLayout.needsInitialAutoLayout,
    backfilled: topLevelLayout.backfilled,
    nodes,
  };
}

function buildStructuredProjection(elements: SerializedViewElement[]): {
  visibleElements: SerializedViewElement[];
  structuredRoots: ReturnType<typeof buildStructuredViewElements>;
} {
  const structuredRoots = buildStructuredViewElements(
    elements.map((element) => ({
      viewElementId: element.viewElementId,
      elementId: element.elementId,
      elementTypeSlug: element.elementType.slug,
      parentViewElementId: element.parentViewElementId,
      orderIndex: element.orderIndex,
      rendererHint: element.rendererHint,
    })),
  );
  const elementsByViewElementId = new Map(elements.map((element) => [element.viewElementId, element]));

  const hydrateStructuredElement = (
    structuredElement: (typeof structuredRoots)[number],
  ): SerializedViewElement => {
    const baseElement = elementsByViewElementId.get(structuredElement.viewElementId);
    if (!baseElement) {
      throw new Error(`Structured element ${structuredElement.viewElementId} was not found in the view payload`);
    }

    return {
      ...baseElement,
      parentViewElementId: structuredElement.parentViewElementId,
      orderIndex: structuredElement.orderIndex,
      rendererHint: structuredElement.rendererHint,
      childViewElements: structuredElement.childViewElements.map(hydrateStructuredElement),
    };
  };

  const hydratedRoots = structuredRoots.map(hydrateStructuredElement);
  const visibleElements: SerializedViewElement[] = [];
  const visit = (element: SerializedViewElement) => {
    visibleElements.push(element);
    (element.childViewElements ?? []).forEach(visit);
  };
  hydratedRoots.forEach(visit);

  return {
    visibleElements,
    structuredRoots,
  };
}

function buildEdges(edges: SerializedEdge[], onDelete: (id: string) => void, edgeVariant: EdgeVariant): Edge[] {
  const byId = new Map(edges.map((e) => [e.id, e]));
  const arrow = { type: MarkerType.ArrowClosed, color: "var(--dpf-accent)" };
  // Dedup parallel/exact-duplicate relationships and merge bidirectional pairs into a single
  // double-headed edge; self-loops are dropped (BI-F1B5C04B). IMPORTANT: source/target are
  // viewElementId (EaViewElement.id) — React Flow node IDs are set to viewElementId in buildNodes.
  return dedupeRenderEdges(
    edges.map((e) => ({ id: e.id, from: e.fromViewElementId, to: e.toViewElementId, typeSlug: e.relationshipType.slug })),
  ).map((d) => {
    const rep = byId.get(d.id)!;
    return {
      id: d.id,
      source: d.source,
      target: d.target,
      type: "eaRelationship",
      markerEnd: arrow,
      // Bidirectional A↔B → arrowheads on both ends instead of two stacked lines.
      ...(d.bidirectional ? { markerStart: arrow } : {}),
      data: {
        relationshipType: rep.relationshipType,
        // Delete removes only the representative row; the data-layer dedup (BI-8C121D30) clears
        // the redundant duplicates that this rendered edge also stands for.
        onDelete: () => onDelete(d.id),
        edgeVariant,
        bidirectional: d.bidirectional,
        mergedCount: d.mergedIds.length,
      },
    };
  });
}

// Containment (nested) view: derive the Package⊃Part hierarchy from "contains" edges, lay it
// out as nested boxes, and draw only the cross-cutting (non-contains) edges. (BI-9E5EA3FF)
async function buildNestedGraph(
  visibleElements: SerializedViewElement[],
  visibleEdges: SerializedEdge[],
  onDelete: (id: string) => void,
  edgeVariant: EdgeVariant,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const elementById = new Map(visibleElements.map((el) => [el.viewElementId, el]));
  const containsEdges = visibleEdges
    .filter((e) => e.relationshipType.slug === "contains")
    .map((e) => ({ parent: e.fromViewElementId, child: e.toViewElementId }));
  const crossEdges = visibleEdges.filter((e) => e.relationshipType.slug !== "contains");
  // Cross-cutting edges drive the ELK-compound layout of children INSIDE each container.
  const crossLayoutEdges = crossEdges.map((e) => ({ source: e.fromViewElementId, target: e.toViewElementId }));

  const layout = await computeContainmentLayout(
    visibleElements.map((el) => el.viewElementId),
    containsEdges,
    crossLayoutEdges,
  );

  const nodes: Node[] = layout.map((cn) => {
    const element = elementById.get(cn.id);
    const node: Node = {
      id: cn.id,
      type: cn.isContainer ? "eaContainer" : "eaElement",
      position: { x: cn.x, y: cn.y },
      data: (element ?? {}) as unknown as Record<string, unknown>,
    };
    if (cn.parentId) {
      node.parentId = cn.parentId;
      node.extent = "parent";
    }
    if (cn.isContainer) {
      node.style = { width: cn.width, height: cn.height };
    }
    return node;
  });

  return { nodes, edges: buildEdges(crossEdges, onDelete, edgeVariant) };
}

export function EaCanvas({
  viewId, viewName, viewStatus, notationSlug, viewpoint, allElementTypes,
  initialElements, initialEdges, initialCanvasState, initialFocusElementId, isReadOnly,
}: Props) {
  const paletteTypes = viewpoint
    ? allElementTypes.filter((et) => viewpoint.allowedElementTypeSlugs.includes(et.slug))
    : allElementTypes;

  // Always start with "bezier" to match the server render, then hydrate from localStorage.
  // Using localStorage in useState init causes a server/client style mismatch (hydration error).
  const [edgeVariant, setEdgeVariant] = useState<EdgeVariant>("bezier");

  useEffect(() => {
    const v = localStorage.getItem("ea-edge-variant");
    if (v === "straight" || v === "step") setEdgeVariant(v);
  }, []);

  const handleDeleteEdge = useCallback(async (relationshipId: string) => {
    if (isReadOnly) return;
    await deleteEaRelationship(relationshipId);
    window.location.reload();
  }, [isReadOnly]);

  const projection = buildStructuredProjection(initialElements);
  const visibleElements = projection.visibleElements.map((element) => ({
    ...element,
    isReadOnly,
    onMoveStructuredChild: async (input: { childViewElementId: string; targetOrderIndex: number }) => {
      if (isReadOnly) return;
      await moveStructuredViewElement({
        viewElementId: input.childViewElementId,
        targetParentViewElementId: element.viewElementId,
        targetOrderIndex: input.targetOrderIndex,
      });
      window.location.reload();
    },
    childViewElements: (element.childViewElements ?? []).map((child) => ({
      ...child,
      isReadOnly,
    })),
  }));
  const visibleEdgeIds = new Set(
    filterStructuredEdges(
      initialEdges.map((edge) => ({
        id: edge.id,
        fromViewElementId: edge.fromViewElementId,
        toViewElementId: edge.toViewElementId,
        relationshipTypeSlug: edge.relationshipType.slug,
      })),
      projection.structuredRoots,
    ).map((edge) => edge.id),
  );
  const visibleEdges = initialEdges.filter((edge) => visibleEdgeIds.has(edge.id));
  const hasOperationalTable = buildOperationalValueStreamRows(visibleElements).length > 0;

  const layoutEdges = buildLayoutEdges(visibleElements, visibleEdges);
  const initialNodeLayout = buildNodes(visibleElements, initialCanvasState, layoutEdges);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodeLayout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(visibleEdges, handleDeleteEdge, edgeVariant));
  const initialSelectedElement = visibleElements.find((element) => element.elementId === initialFocusElementId) ?? null;
  const [selectedViewElement, setSelectedViewElement] = useState<SerializedViewElement | null>(initialSelectedElement);
  const [isLayouting, setIsLayouting] = useState(false);
  const [revMenuOpen, setRevMenuOpen] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [nestedMode, setNestedMode] = useState(false);
  const [presentationMode, setPresentationMode] = useState<PresentationMode>("diagram");
  const [pendingDrop, setPendingDrop] = useState<{
    elementId: string; name: string; typeName: string;
    lifecycleStage: string; lifecycleStatus: string;
    x: number; y: number;
  } | null>(null);

  // Propagate edgeVariant changes to all existing edges
  useEffect(() => {
    setEdges((eds: Edge[]) => eds.map((e) => ({
      ...e,
      data: { ...e.data, edgeVariant },
    })));
  }, [edgeVariant, setEdges]);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCanvasStateRef = useRef<CanvasState>(
    initialCanvasState ?? DEFAULT_CANVAS_STATE
  );
  // Track live viewport (pan + zoom) so handleDrop can convert screen → flow coordinates.
  // Updated by onInit (after fitView) and onMove (during pan/zoom).
  const viewportRef = useRef(initialCanvasState?.viewport ?? { x: 0, y: 0, zoom: 1 });

  function scheduleAutoSave(state: CanvasState) {
    latestCanvasStateRef.current = state;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void saveCanvasState({ viewId, canvasState: latestCanvasStateRef.current });
    }, 1500);
  }

  const nodesRef = useRef<Node[]>(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const rfRef = useRef<ReactFlowInstance | null>(null);

  // Snapshot of every node's current position, keyed by React Flow node id.
  const currentNodesRecord = useCallback(
    () =>
      Object.fromEntries(nodesRef.current.map((n) => [n.id, n.position])) as Record<
        string,
        { x: number; y: number }
      >,
    [],
  );

  // Run an automatic layout: optionally snapshot the current arrangement (so it can be
  // restored later), reposition top-level nodes via the chosen engine, persist, and refit.
  const runAutoLayout = useCallback(
    async (algo: EaLayoutAlgorithm, opts?: { snapshot?: boolean; persist?: boolean }) => {
      const snapshot = opts?.snapshot ?? true;
      const persist = opts?.persist ?? !isReadOnly;
      setIsLayouting(true);
      try {
        const topLevelNodes = nodesRef.current.filter((n) => !n.parentId).map((n) => ({ id: n.id }));
        if (topLevelNodes.length < 2) return;
        const positions = await computeEaLayout(topLevelNodes, layoutEdges, { algorithm: algo });

        // Drive edge style from the layout: orthogonal layouts (layered/tree) read cleanest with
        // right-angle (step) edges; organic/radial with straight. Curved/bezier looks chaotic.
        const resolved = algo === "auto" ? pickAutoAlgorithm(topLevelNodes, layoutEdges) : algo;
        handleSetEdgeVariant(resolved === "layered" || resolved === "tree" ? "step" : "straight");

        const history = snapshot
          ? pushRevision(
              latestCanvasStateRef.current.history ?? [],
              `Before ${EA_LAYOUT_LABELS[algo].split(" · ")[0]} layout`,
              currentNodesRecord(),
            )
          : latestCanvasStateRef.current.history;

        setNodes((nds: Node[]) =>
          nds.map((n) => (n.parentId ? n : { ...n, position: positions[n.id] ?? n.position })),
        );

        const nextState: CanvasState = {
          ...latestCanvasStateRef.current,
          nodes: { ...currentNodesRecord(), ...positions },
          ...(history ? { history } : {}),
        };
        latestCanvasStateRef.current = nextState;
        if (persist) await saveCanvasState({ viewId, canvasState: nextState });

        requestAnimationFrame(() => rfRef.current?.fitView({ duration: 400, padding: 0.15 }));
      } finally {
        setIsLayouting(false);
        setLayoutMenuOpen(false);
      }
    },
    [isReadOnly, layoutEdges, viewId, setNodes, currentNodesRecord],
  );

  // Restore a previously captured layout revision (the "go back to a previous revision" path).
  const restoreRevision = useCallback(
    async (rev: CanvasLayoutRevision) => {
      setNodes((nds: Node[]) =>
        nds.map((n) => (rev.nodes[n.id] ? { ...n, position: rev.nodes[n.id]! } : n)),
      );
      const nextState: CanvasState = {
        ...latestCanvasStateRef.current,
        nodes: { ...currentNodesRecord(), ...rev.nodes },
      };
      latestCanvasStateRef.current = nextState;
      if (!isReadOnly) await saveCanvasState({ viewId, canvasState: nextState });
      setRevMenuOpen(false);
      requestAnimationFrame(() => rfRef.current?.fitView({ duration: 400, padding: 0.15 }));
    },
    [isReadOnly, viewId, setNodes, currentNodesRecord],
  );

  // Containment (nested) view — swap the node/edge set to nested boxes derived from
  // "contains" edges. Deterministic from data, so it isn't persisted (localStorage toggle only).
  const enterNested = useCallback(async () => {
    setNestedMode(true);
    try { window.localStorage.setItem("ea-nested-mode", "1"); } catch { /* ignore */ }
    // ELK compound routes orthogonally → right-angle (step) edges read cleanest.
    handleSetEdgeVariant("step");
    setIsLayouting(true);
    try {
      const g = await buildNestedGraph(visibleElements, visibleEdges, handleDeleteEdge, "step");
      setNodes(g.nodes);
      setEdges(g.edges);
    } finally {
      setIsLayouting(false);
    }
    setLayoutMenuOpen(false);
    requestAnimationFrame(() => rfRef.current?.fitView({ duration: 400, padding: 0.1 }));
  }, [visibleElements, visibleEdges, handleDeleteEdge, setNodes, setEdges]);

  const exitNested = useCallback(() => {
    setNestedMode(false);
    try { window.localStorage.setItem("ea-nested-mode", "0"); } catch { /* ignore */ }
    setNodes(buildNodes(visibleElements, latestCanvasStateRef.current, layoutEdges).nodes);
    setEdges(buildEdges(visibleEdges, handleDeleteEdge, edgeVariant));
    requestAnimationFrame(() => rfRef.current?.fitView({ duration: 400, padding: 0.1 }));
  }, [visibleElements, visibleEdges, layoutEdges, handleDeleteEdge, edgeVariant, setNodes, setEdges]);

  // Hydrate the nested-view toggle from localStorage once on mount.
  const didHydrateNestedRef = useRef(false);
  useEffect(() => {
    if (didHydrateNestedRef.current) return;
    didHydrateNestedRef.current = true;
    if (typeof window !== "undefined" && window.localStorage.getItem("ea-nested-mode") === "1") {
      void enterNested();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On first mount: upgrade an auto-generated grid placeholder to a real crossing-minimizing
  // layout, or persist the nestled positions of newly-added nodes. Runs exactly once.
  const didInitLayoutRef = useRef(false);
  useEffect(() => {
    if (didInitLayoutRef.current) return;
    didInitLayoutRef.current = true;
    // Nested view manages its own node set; skip the flat auto-layout.
    if (typeof window !== "undefined" && window.localStorage.getItem("ea-nested-mode") === "1") return;
    const topLevelCount = nodesRef.current.filter((n) => !n.parentId).length;
    if (initialNodeLayout.needsInitialAutoLayout) {
      if (topLevelCount > 1 && layoutEdges.length > 0) {
        void runAutoLayout(defaultLayoutAlgo(), { snapshot: false, persist: !isReadOnly });
      } else if (!isReadOnly) {
        void saveCanvasState({
          viewId,
          canvasState: { ...latestCanvasStateRef.current, nodes: currentNodesRecord() },
        });
      }
    } else if (initialNodeLayout.backfilled && !isReadOnly) {
      void saveCanvasState({
        viewId,
        canvasState: { ...latestCanvasStateRef.current, nodes: currentNodesRecord() },
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getAbsoluteNodePosition(node: Node, nodesById: Map<string, Node>): { x: number; y: number } {
    if (!node.parentId) {
      return node.position;
    }

    const parent = nodesById.get(node.parentId);
    if (!parent) {
      return node.position;
    }

    const parentPosition = getAbsoluteNodePosition(parent, nodesById);
    return {
      x: parentPosition.x + node.position.x,
      y: parentPosition.y + node.position.y,
    };
  }

  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    setNodes((nds: Node[]) => {
      const updatedNodes: Record<string, { x: number; y: number }> = {};
      nds.forEach((n) => { updatedNodes[n.id] = n.position; });
      scheduleAutoSave({ ...latestCanvasStateRef.current, nodes: updatedNodes });
      return nds;
    });
  }, [onNodesChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNodeDragStop = useCallback(async (_event: unknown, node: Node) => {
    if (isReadOnly) return;

    const movedElement = node.data as SerializedViewElement;
    if (movedElement.elementType.slug !== "value_stream_stage") return;

    const nodesById = new Map(nodes.map((entry) => [entry.id, entry]));
    const movedNode = nodesById.get(node.id) ?? node;
    const movedAbsolutePosition = getAbsoluteNodePosition(movedNode, nodesById);
    const movedWidth = estimateStageWidth(movedElement.element.name);
    const movedCenterX = movedAbsolutePosition.x + movedWidth / 2;
    const movedCenterY = movedAbsolutePosition.y + 46;

    const streamCandidates = nodes.filter((entry) => {
      const entryData = entry.data as SerializedViewElement;
      return entryData.rendererHint === "nested_chevron_sequence";
    });

    let targetParentNode: Node | null = null;
    for (const candidate of streamCandidates) {
      const candidateData = candidate.data as SerializedViewElement;
      const candidateLayout = buildValueStreamGroupLayout({
        origin: getAbsoluteNodePosition(candidate, nodesById),
        stageLabels: (candidateData.childViewElements ?? []).map((child) => child.element.name),
      });
      const withinHorizontal =
        movedCenterX >= candidateLayout.band.x &&
        movedCenterX <= candidateLayout.band.x + candidateLayout.band.width;
      const withinVertical =
        movedCenterY >= candidateLayout.band.y &&
        movedCenterY <= candidateLayout.band.y + candidateLayout.band.height;

      if (withinHorizontal && withinVertical) {
        targetParentNode = candidate;
        break;
      }
    }

    const targetParentViewElementId = targetParentNode?.id ?? null;

    if (targetParentViewElementId == null) {
      if (movedElement.parentViewElementId == null) return;
      await moveStructuredViewElement({
        viewElementId: movedElement.viewElementId,
        targetParentViewElementId: null,
        targetOrderIndex: null,
      });
      window.location.reload();
      return;
    }

    const siblingNodes = nodes
      .filter((entry) => {
        const entryData = entry.data as SerializedViewElement;
        return (
          entry.id !== movedElement.viewElementId &&
          entryData.elementType.slug === "value_stream_stage" &&
          entryData.parentViewElementId === targetParentViewElementId
        );
      })
      .sort((left, right) => {
        const leftPosition = getAbsoluteNodePosition(left, nodesById).x;
        const rightPosition = getAbsoluteNodePosition(right, nodesById).x;
        return leftPosition - rightPosition;
      });

    const targetOrderIndex = siblingNodes.filter((entry) => {
      const entryData = entry.data as SerializedViewElement;
      const entryPosition = getAbsoluteNodePosition(entry, nodesById);
      return entryPosition.x + estimateStageWidth(entryData.element.name) / 2 < movedCenterX;
    }).length;

    const normalizedCurrentOrder = movedElement.orderIndex ?? siblingNodes.length;
    if (
      movedElement.parentViewElementId === targetParentViewElementId &&
      normalizedCurrentOrder === targetOrderIndex
    ) {
      return;
    }

    await moveStructuredViewElement({
      viewElementId: movedElement.viewElementId,
      targetParentViewElementId,
      targetOrderIndex,
    });
    window.location.reload();
  }, [isReadOnly, nodes]);

  const handleConnect = useCallback(async (connection: Connection) => {
    if (isReadOnly || !connection.source || !connection.target) return;

    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return;
    const fromElementId = (sourceNode.data as SerializedViewElement).elementId;
    const toElementId = (targetNode.data as SerializedViewElement).elementId;

    const relTypeId = await getDefaultRelTypeIdForView(viewId, fromElementId, toElementId);
    if (!relTypeId) {
      console.warn("No allowed relationship types for this viewpoint");
      return;
    }

    const result = await createEaRelationship({
      fromElementId,
      toElementId,
      relationshipTypeId: relTypeId,
      viewId,
    });
    if (result && "error" in result) {
      console.warn("createEaRelationship error:", result.error);
      return;
    }
    window.location.reload();
  }, [isReadOnly, viewId, nodes]);

  function handleDragStart(e: React.DragEvent, elementTypeId: string, elementTypeName: string) {
    e.dataTransfer.setData("application/ea-element-type-id", elementTypeId);
    e.dataTransfer.setData("application/ea-element-type-name", elementTypeName);
  }

  function handleDrop(e: React.DragEvent) {
    if (isReadOnly) return;
    e.preventDefault();
    const typeId = e.dataTransfer.getData("application/ea-element-type-id");
    const typeName = e.dataTransfer.getData("application/ea-element-type-name");
    if (!typeId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { x: vpX, y: vpY, zoom } = viewportRef.current;
    // Convert screen pixel offset to React Flow canvas coordinates (inverse viewport transform).
    const x = (e.clientX - rect.left - vpX) / zoom;
    const y = (e.clientY - rect.top - vpY) / zoom;
    void (async () => {
      const result = await addElementToView({
        viewId,
        mode: "new",
        elementTypeId: typeId,
        name: typeName,
        initialX: x,
        initialY: y,
      });
      if ("error" in result) { console.warn("addElementToView error: %s", JSON.stringify(result.error)); return; }
      window.location.reload();
    })();
  }

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedViewElement(node.data as SerializedViewElement);
  }

  function handleSetEdgeVariant(v: EdgeVariant) {
    localStorage.setItem("ea-edge-variant", v);
    setEdgeVariant(v);
  }

  return (
    <div style={{ display: "flex", height: "100%", background: "var(--dpf-bg)" }}>
      {presentationMode === "diagram" && (
        <ElementPalette
          elementTypes={paletteTypes}
          onDragStart={handleDragStart}
          onSearchExisting={() => { /* ExistingElementSearch deferred to Phase EA-3 */ }}
        />
      )}

      <div style={{ flex: 1, position: "relative" }}>
        {/* Status bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "var(--dpf-surface-1)", borderBottom: "1px solid var(--dpf-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link href="/ea/views" style={{ color: "var(--dpf-muted)", fontSize: 11, textDecoration: "none" }}>← Views</Link>
            <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>/</span>
            <span style={{ color: "var(--dpf-text)", fontSize: 11, fontWeight: 600 }}>{viewName}</span>
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 3,
              background: viewStatus === "approved" ? "#1e3a2f" : "#1a1a2e",
              color: viewStatus === "approved" ? "var(--dpf-success)" : "var(--dpf-warning)",
              border: `1px solid ${viewStatus === "approved" ? "var(--dpf-success)" : "var(--dpf-warning)"}`,
            }}>
              {viewStatus.toUpperCase()}
            </span>
            {viewpoint && <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>Viewpoint: {viewpoint.name}</span>}
          </div>

          {/* Right-side controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {hasOperationalTable && (
              <PresentationToggle value={presentationMode} onChange={setPresentationMode} />
            )}
            {presentationMode === "diagram" && (
              <>
            <button
              onClick={() => { if (nestedMode) exitNested(); else void enterNested(); }}
              title="Containment view — nest Packages/Parts as boxes (from 'contains' relationships)"
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                background: nestedMode ? "#2a2a50" : "transparent",
                border: `1px solid ${nestedMode ? "var(--dpf-accent)" : "#2a2a40"}`,
                color: nestedMode ? "var(--dpf-accent)" : "var(--dpf-muted)",
              }}
            >
              ▦ Nest
            </button>
            {!isReadOnly && !nestedMode && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
                <button
                  onClick={() => {
                    try { window.localStorage.setItem("ea-layout-algo", "auto"); } catch { /* ignore */ }
                    void runAutoLayout("auto");
                  }}
                  disabled={isLayouting}
                  title="Auto-layout — picks the best arrangement for this view's shape"
                  style={{
                    fontSize: 10, padding: "2px 9px", borderRadius: 3,
                    cursor: isLayouting ? "wait" : "pointer", opacity: isLayouting ? 0.6 : 1,
                    background: "#2a2a50", border: "1px solid var(--dpf-accent)", color: "var(--dpf-accent)",
                  }}
                >
                  {isLayouting ? "Arranging…" : "⤢ Auto-layout"}
                </button>
                <button
                  onClick={() => setLayoutMenuOpen((o) => !o)}
                  disabled={isLayouting}
                  title="Choose a specific layout"
                  style={{
                    fontSize: 10, padding: "2px 6px", borderRadius: 3,
                    cursor: isLayouting ? "wait" : "pointer",
                    background: layoutMenuOpen ? "#2a2a50" : "transparent",
                    border: `1px solid ${layoutMenuOpen ? "var(--dpf-accent)" : "#2a2a40"}`,
                    color: "var(--dpf-muted)",
                  }}
                >
                  ▾
                </button>
                {layoutMenuOpen && (
                  <>
                    <div onClick={() => setLayoutMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41,
                      minWidth: 200, background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)",
                      borderRadius: 5, padding: 4, boxShadow: "0 6px 20px #0008",
                    }}>
                      {EA_LAYOUT_ALGORITHMS.map((algo) => (
                        <button
                          key={algo}
                          onClick={() => {
                            try { window.localStorage.setItem("ea-layout-algo", algo); } catch { /* ignore */ }
                            void runAutoLayout(algo);
                          }}
                          style={{
                            display: "block", width: "100%", textAlign: "left", fontSize: 10,
                            padding: "5px 7px", borderRadius: 3, cursor: "pointer",
                            background: "transparent", border: "none", color: "var(--dpf-text)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#2a2a50"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          {EA_LAYOUT_LABELS[algo]}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Revisions — restore a previous layout */}
                {(() => {
                  const revisions = latestCanvasStateRef.current.history ?? [];
                  const hasRevisions = revisions.length > 0;
                  return (
                    <>
                      <button
                        onClick={() => setRevMenuOpen((o) => !o)}
                        disabled={!hasRevisions}
                        title={hasRevisions ? "Restore a previous layout" : "No saved layouts yet"}
                        style={{
                          fontSize: 10, padding: "2px 7px", borderRadius: 3,
                          cursor: hasRevisions ? "pointer" : "default",
                          background: revMenuOpen ? "#2a2a50" : "transparent",
                          border: `1px solid ${revMenuOpen ? "var(--dpf-accent)" : "#2a2a40"}`,
                          color: hasRevisions ? "var(--dpf-text)" : "#3a3a4a",
                        }}
                      >
                        ↶ Revisions{hasRevisions ? ` (${revisions.length})` : ""}
                      </button>
                      {revMenuOpen && hasRevisions && (
                        <>
                          <div onClick={() => setRevMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                          <div style={{
                            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 41,
                            minWidth: 240, maxHeight: 300, overflowY: "auto",
                            background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)",
                            borderRadius: 5, padding: 4, boxShadow: "0 6px 20px #0008",
                          }}>
                            {[...revisions].reverse().map((rev) => (
                              <button
                                key={rev.id}
                                onClick={() => void restoreRevision(rev)}
                                style={{
                                  display: "block", width: "100%", textAlign: "left",
                                  fontSize: 10, padding: "5px 7px", borderRadius: 3, cursor: "pointer",
                                  background: "transparent", border: "none", color: "var(--dpf-text)",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#2a2a50"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                              >
                                <span style={{ color: "var(--dpf-accent)" }}>Restore</span> · {rev.label}
                                <span style={{ color: "var(--dpf-muted)", marginLeft: 4 }}>
                                  {new Date(rev.at).toLocaleTimeString()}
                                </span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Edge style toggle */}
            <EdgeVariantToggle value={edgeVariant} onChange={handleSetEdgeVariant} />
              </>
            )}
          </div>
        </div>

        {presentationMode === "table" ? (
          <div style={{ height: "calc(100% - 41px)" }}>
            <OperationalValueStreamTable elements={visibleElements} />
          </div>
        ) : (
          <div
            style={{ height: "calc(100% - 41px)" }}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <ReactFlow
            proOptions={{ hideAttribution: true }}
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            connectionMode={ConnectionMode.Loose}
            colorMode="dark"
            fitView
            minZoom={0.05}
            maxZoom={4}
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            translateExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
            onInit={(rf: ReactFlowInstance) => { rfRef.current = rf; viewportRef.current = rf.getViewport(); }}
            onMove={(_evt: unknown, vp: Viewport) => { viewportRef.current = vp; }}
          >
            <Background color="#2a2a40" gap={20} />
            <Controls style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }} />
            </ReactFlow>
          </div>
        )}
      </div>

      {presentationMode === "diagram" && (
        <ElementInspector
          selected={selectedViewElement}
          notationSlug={notationSlug}
          onUpdated={() => window.location.reload()}
        />
      )}

      {/* Phase EA-2: anchorEl is null because ExistingElementSearch is deferred to Phase EA-3. */}
      {pendingDrop && (
        <ReferencePopup
          element={pendingDrop}
          anchorEl={null}
          onConfirm={async (mode) => {
            const result = await addElementToView({
              viewId,
              mode,
              elementId: pendingDrop.elementId,
              initialX: pendingDrop.x,
              initialY: pendingDrop.y,
            });
            if ("error" in result) { console.warn(JSON.stringify(result.error)); }
            setPendingDrop(null);
            window.location.reload();
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}
