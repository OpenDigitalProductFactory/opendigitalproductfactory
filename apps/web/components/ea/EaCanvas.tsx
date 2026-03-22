"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, ConnectionMode, MarkerType,
  useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type OnNodesChange, type ReactFlowInstance, type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SerializedViewElement, SerializedEdge, CanvasState } from "@/lib/ea-types";
import { buildStructuredViewElements, filterStructuredEdges } from "@/lib/ea-structure";
import { EaElementNode } from "./EaElementNode";
import { EaRelationshipEdge } from "./EaRelationshipEdge";
import { ElementPalette } from "./ElementPalette";
import { ElementInspector } from "./ElementInspector";
import { ReferencePopup } from "./ReferencePopup";
import {
  addElementToView,
  createEaRelationship,
  deleteEaRelationship,
  moveStructuredViewElement,
  saveCanvasState,
  getDefaultRelTypeIdForView,
} from "@/lib/actions/ea";
import { buildValueStreamGroupLayout, estimateStageWidth } from "./value-stream-layout";

const NODE_TYPES = { eaElement: EaElementNode };
const EDGE_TYPES = { eaRelationship: EaRelationshipEdge };

const DEFAULT_CANVAS_STATE: CanvasState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: {},
};

type EdgeVariant = "straight" | "bezier" | "step";

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
  viewpoint: ViewpointInfo | null;
  allElementTypes: ElementTypeOption[];
  initialElements: SerializedViewElement[];
  initialEdges: SerializedEdge[];
  initialCanvasState: CanvasState | null;
  isReadOnly: boolean;
};

function buildNodeLayout(
  elements: SerializedViewElement[],
  canvasState: CanvasState | null,
): {
  nodes: Record<string, { x: number; y: number }>;
  shouldPersist: boolean;
} {
  const savedNodes = canvasState?.nodes ?? {};
  const elementCount = elements.length;

  if (elementCount <= 1) {
    const single = elements[0];
    if (!single) return { nodes: {}, shouldPersist: false };
    return {
      nodes: { [single.viewElementId]: savedNodes[single.viewElementId] ?? { x: 0, y: 0 } },
      shouldPersist: false,
    };
  }

  const allSavedPresent = elements.every((ve) => Boolean(savedNodes[ve.viewElementId]));
  const allSavedAtOrigin = allSavedPresent
    ? elements.every((ve) => {
        const pos = savedNodes[ve.viewElementId];
        return pos != null && pos.x === 0 && pos.y === 0;
      })
    : false;

  const shouldLayoutAll = !allSavedPresent || allSavedAtOrigin;

  if (shouldLayoutAll) {
    const cols = Math.ceil(Math.sqrt(elementCount));
    const xStep = 240;
    const yStep = 150;
    const nodes: Record<string, { x: number; y: number }> = {};

    for (let i = 0; i < elementCount; i += 1) {
      const ve = elements[i];
      if (!ve) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes[ve.viewElementId] = { x: col * xStep, y: row * yStep };
    }

    return { nodes, shouldPersist: true };
  }

  // Keep existing saved coordinates, but backfill any missing node positions.
  const used = new Set<string>();
  const nodes = { ...savedNodes } as Record<string, { x: number; y: number }>;
  for (const pos of Object.values(savedNodes)) {
    used.add(`${pos.x},${pos.y}`);
  }

  const cols = Math.ceil(Math.sqrt(elementCount));
  const xStep = 240;
  const yStep = 150;
  let fillIndex = 0;

  for (const ve of elements) {
    if (nodes[ve.viewElementId]) continue;
    while (true) {
      const candidate = { x: (fillIndex % cols) * xStep, y: Math.floor(fillIndex / cols) * yStep };
      const key = `${candidate.x},${candidate.y}`;
      fillIndex += 1;
      if (used.has(key)) continue;
      nodes[ve.viewElementId] = candidate;
      used.add(key);
      break;
    }
  }

  return { nodes, shouldPersist: false };
}

function buildNodes(elements: SerializedViewElement[], canvasState: CanvasState | null): {
  nodes: Node[];
  shouldPersist: boolean;
} {
  const structuredChildIds = new Set<string>();
  for (const element of elements) {
    for (const child of element.childViewElements ?? []) {
      structuredChildIds.add(child.viewElementId);
    }
  }

  const topLevelElements = elements.filter((element) => !structuredChildIds.has(element.viewElementId));
  const topLevelLayout = buildNodeLayout(topLevelElements, canvasState);
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
    shouldPersist: topLevelLayout.shouldPersist,
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
  return edges.map((e) => ({
    id: e.id,
    // IMPORTANT: use viewElementId (EaViewElement.id), not elementId (EaElement.id).
    // React Flow node IDs are set to viewElementId in buildNodes.
    source: e.fromViewElementId,
    target: e.toViewElementId,
    type: "eaRelationship",
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--dpf-accent)" },
    data: { relationshipType: e.relationshipType, onDelete: () => onDelete(e.id), edgeVariant },
  }));
}

const EDGE_VARIANT_LABELS: Record<EdgeVariant, string> = {
  straight: "━ Straight",
  bezier:   "⌒ Curved",
  step:     "⌐ Angled",
};

export function EaCanvas({
  viewId, viewName, viewStatus, viewpoint, allElementTypes,
  initialElements, initialEdges, initialCanvasState, isReadOnly,
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

  const initialNodeLayout = buildNodes(visibleElements, initialCanvasState);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodeLayout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(visibleEdges, handleDeleteEdge, edgeVariant));
  const [selectedViewElement, setSelectedViewElement] = useState<SerializedViewElement | null>(null);
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

  useEffect(() => {
    if (!initialNodeLayout.shouldPersist) return;
    const nodesRecord = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    scheduleAutoSave({ ...latestCanvasStateRef.current, nodes: nodesRecord });
  }, [nodes, initialNodeLayout.shouldPersist]);

  function scheduleAutoSave(state: CanvasState) {
    latestCanvasStateRef.current = state;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void saveCanvasState({ viewId, canvasState: latestCanvasStateRef.current });
    }, 1500);
  }

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
      if ("error" in result) { console.warn("addElementToView error:", result.error); return; }
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
      <ElementPalette
        elementTypes={paletteTypes}
        onDragStart={handleDragStart}
        onSearchExisting={() => { /* ExistingElementSearch deferred to Phase EA-3 */ }}
      />

      <div style={{ flex: 1, position: "relative" }}>
        {/* Status bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "var(--dpf-surface-1)", borderBottom: "1px solid var(--dpf-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>EA /</span>
            <span style={{ color: "var(--dpf-text)", fontSize: 11, fontWeight: 600 }}>{viewName}</span>
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 3,
              background: viewStatus === "approved" ? "#1e3a2f" : "#1a1a2e",
              color: viewStatus === "approved" ? "#4ade80" : "#fbbf24",
              border: `1px solid ${viewStatus === "approved" ? "#4ade80" : "#fbbf24"}`,
            }}>
              {viewStatus.toUpperCase()}
            </span>
            {viewpoint && <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>Viewpoint: {viewpoint.name}</span>}
          </div>

          {/* Edge style toggle */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["straight", "bezier", "step"] as EdgeVariant[]).map((v) => (
              <button
                key={v}
                onClick={() => handleSetEdgeVariant(v)}
                title={v.charAt(0).toUpperCase() + v.slice(1)}
                style={{
                  fontSize: 10, padding: "2px 7px", borderRadius: 3, cursor: "pointer",
                  background: edgeVariant === v ? "#2a2a50" : "transparent",
                  border: `1px solid ${edgeVariant === v ? "#7c8cf8" : "#2a2a40"}`,
                  color: edgeVariant === v ? "#7c8cf8" : "#8888a0",
                }}
              >
                {EDGE_VARIANT_LABELS[v]}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{ height: "calc(100% - 41px)" }}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <ReactFlow
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
            onInit={(rf: ReactFlowInstance) => { viewportRef.current = rf.getViewport(); }}
            onMove={(_evt: unknown, vp: Viewport) => { viewportRef.current = vp; }}
          >
            <Background color="#2a2a40" gap={20} />
            <Controls style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }} />
          </ReactFlow>
        </div>
      </div>

      <ElementInspector
        selected={selectedViewElement}
        onUpdated={() => window.location.reload()}
      />

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
            if ("error" in result) { console.warn(result.error); }
            setPendingDrop(null);
            window.location.reload();
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </div>
  );
}
