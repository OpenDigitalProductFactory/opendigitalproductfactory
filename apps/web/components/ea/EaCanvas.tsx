"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, ConnectionMode, MarkerType,
  useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SerializedViewElement, SerializedEdge, CanvasState } from "@/lib/ea-types";
import { EaElementNode } from "./EaElementNode";
import { EaRelationshipEdge } from "./EaRelationshipEdge";
import { ElementPalette } from "./ElementPalette";
import { ElementInspector } from "./ElementInspector";
import { ReferencePopup } from "./ReferencePopup";
import {
  addElementToView,
  createEaRelationship,
  deleteEaRelationship,
  saveCanvasState,
  getDefaultRelTypeIdForView,
} from "@/lib/actions/ea";

const NODE_TYPES = { eaElement: EaElementNode };
const EDGE_TYPES = { eaRelationship: EaRelationshipEdge };

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

function buildNodes(elements: SerializedViewElement[], canvasState: CanvasState | null): Node[] {
  return elements.map((ve) => ({
    id: ve.viewElementId,
    type: "eaElement",
    position: canvasState?.nodes[ve.viewElementId] ?? { x: 0, y: 0 },
    data: ve,
  }));
}

function buildEdges(edges: SerializedEdge[], onDelete: (id: string) => void, edgeVariant: EdgeVariant): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    // IMPORTANT: use viewElementId (EaViewElement.id), not elementId (EaElement.id).
    // React Flow node IDs are set to viewElementId in buildNodes.
    source: e.fromViewElementId,
    target: e.toViewElementId,
    type: "eaRelationship",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#7c8cf8" },
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

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(initialElements, initialCanvasState));
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(initialEdges, handleDeleteEdge, edgeVariant));
  const [selectedViewElement, setSelectedViewElement] = useState<SerializedViewElement | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    elementId: string; name: string; typeName: string;
    lifecycleStage: string; lifecycleStatus: string;
    x: number; y: number;
  } | null>(null);

  // Propagate edgeVariant changes to all existing edges
  useEffect(() => {
    setEdges((eds) => eds.map((e) => ({
      ...e,
      data: { ...e.data, edgeVariant },
    })));
  }, [edgeVariant, setEdges]);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCanvasStateRef = useRef<CanvasState>(
    initialCanvasState ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodes: {} }
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

  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    setNodes((nds) => {
      const updatedNodes: Record<string, { x: number; y: number }> = {};
      nds.forEach((n) => { updatedNodes[n.id] = n.position; });
      scheduleAutoSave({ ...latestCanvasStateRef.current, nodes: updatedNodes });
      return nds;
    });
  }, [onNodesChange]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ display: "flex", height: "100%", background: "#0f0f1a" }}>
      <ElementPalette
        elementTypes={paletteTypes}
        onDragStart={handleDragStart}
        onSearchExisting={() => { /* ExistingElementSearch deferred to Phase EA-3 */ }}
      />

      <div style={{ flex: 1, position: "relative" }}>
        {/* Status bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "#1a1a2e", borderBottom: "1px solid #2a2a40" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#8888a0", fontSize: 10 }}>EA /</span>
            <span style={{ color: "#e0e0ff", fontSize: 11, fontWeight: 600 }}>{viewName}</span>
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 3,
              background: viewStatus === "approved" ? "#1e3a2f" : "#1a1a2e",
              color: viewStatus === "approved" ? "#4ade80" : "#fbbf24",
              border: `1px solid ${viewStatus === "approved" ? "#4ade80" : "#fbbf24"}`,
            }}>
              {viewStatus.toUpperCase()}
            </span>
            {viewpoint && <span style={{ color: "#8888a0", fontSize: 10 }}>Viewpoint: {viewpoint.name}</span>}
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
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            connectionMode={ConnectionMode.Loose}
            colorMode="dark"
            fitView
            onInit={(rf) => { viewportRef.current = rf.getViewport(); }}
            onMove={(_evt, vp) => { viewportRef.current = vp; }}
          >
            <Background color="#2a2a40" gap={20} />
            <Controls style={{ background: "#1a1a2e", border: "1px solid #2a2a40" }} />
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
