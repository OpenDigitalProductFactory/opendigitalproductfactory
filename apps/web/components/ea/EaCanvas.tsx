"use client";

import { useCallback, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, addEdge,
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
  saveCanvasState,
  getDefaultRelTypeIdForView,
} from "@/lib/actions/ea";

const NODE_TYPES = { eaElement: EaElementNode };
const EDGE_TYPES = { eaRelationship: EaRelationshipEdge };

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
  allElementTypes: ElementTypeOption[];  // all types for this notation
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

function buildEdges(edges: SerializedEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    // IMPORTANT: use viewElementId (EaViewElement.id), not elementId (EaElement.id).
    // React Flow node IDs are set to viewElementId in buildNodes.
    source: e.fromViewElementId,
    target: e.toViewElementId,
    type: "eaRelationship",
    data: { relationshipType: e.relationshipType },
  }));
}

export function EaCanvas({
  viewId, viewName, viewStatus, viewpoint, allElementTypes,
  initialElements, initialEdges, initialCanvasState, isReadOnly,
}: Props) {
  const paletteTypes = viewpoint
    ? allElementTypes.filter((et) => viewpoint.allowedElementTypeSlugs.includes(et.slug))
    : allElementTypes;

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(initialElements, initialCanvasState));
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(initialEdges));
  const [selectedViewElement, setSelectedViewElement] = useState<SerializedViewElement | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    elementId: string; name: string; typeName: string;
    lifecycleStage: string; lifecycleStatus: string;
    x: number; y: number;
  } | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCanvasStateRef = useRef<CanvasState>(
    initialCanvasState ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodes: {} }
  );

  function scheduleAutoSave(state: CanvasState) {
    latestCanvasStateRef.current = state;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void saveCanvasState({ viewId, canvasState: latestCanvasStateRef.current });
    }, 1500);
  }

  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    // Build updated positions from current nodes after change
    setNodes((nds) => {
      const updatedNodes: Record<string, { x: number; y: number }> = {};
      nds.forEach((n) => { updatedNodes[n.id] = n.position; });
      scheduleAutoSave({ ...latestCanvasStateRef.current, nodes: updatedNodes });
      return nds;
    });
  }, [onNodesChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback(async (connection: Connection) => {
    if (isReadOnly || !connection.source || !connection.target) return;

    // connection.source/target are EaViewElement.id (React Flow node IDs).
    // createEaRelationship needs EaElement.id, not EaViewElement.id.
    // Look up elementId from the node's data.
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return;
    const fromElementId = (sourceNode.data as SerializedViewElement).elementId;
    const toElementId = (targetNode.data as SerializedViewElement).elementId;

    // Resolve a relationship type that has a rule for this specific element pair.
    // Falls back to associated_with (or first allowed) if no specific rule matches.
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
    // createEaRelationship returns { error: string } on failure, void on success.
    if (result && "error" in result) {
      console.warn("createEaRelationship error:", result.error);
      return;
    }
    // On success, reload to get fresh server data including the new relationship.
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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // For net-new elements: directly add without popup
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
      // Reload page to get fresh server data (simple approach for now)
      window.location.reload();
    })();
  }

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    const ve = (node.data as SerializedViewElement);
    setSelectedViewElement(ve);
  }

  return (
    <div style={{ display: "flex", height: "100%", background: "#0f0f1a" }}>
      <ElementPalette
        elementTypes={paletteTypes}
        onDragStart={handleDragStart}
        onSearchExisting={() => { /* ExistingElementSearch deferred to Phase EA-3 — no-op for now */ }}
      />

      <div style={{ flex: 1, position: "relative" }}>
        {/* Status bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "#1a1a2e", borderBottom: "1px solid #2a2a40" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#555566", fontSize: 10 }}>EA /</span>
            <span style={{ color: "#e0e0ff", fontSize: 11, fontWeight: 600 }}>{viewName}</span>
            <span style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 3,
              background: viewStatus === "approved" ? "#1e3a2f" : "#1a1a2e",
              color: viewStatus === "approved" ? "#4ade80" : "#fbbf24",
              border: `1px solid ${viewStatus === "approved" ? "#4ade80" : "#fbbf24"}`,
            }}>
              {viewStatus.toUpperCase()}
            </span>
            {viewpoint && <span style={{ color: "#555566", fontSize: 9 }}>Viewpoint: {viewpoint.name}</span>}
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
            colorMode="dark"
            fitView
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

      {/* Phase EA-2: anchorEl is null because ExistingElementSearch (which provides the DOM ref
          for the ghost node) is deferred to Phase EA-3. The popup renders unanchored (near
          viewport centre via FloatingPortal default). This is acceptable for Phase EA-2. */}
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
