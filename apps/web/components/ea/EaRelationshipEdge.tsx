"use client";

import { useMemo } from "react";
import {
  BaseEdge, EdgeLabelRenderer,
  getBezierPath, getStraightPath, getSmoothStepPath,
  useNodes, useEdges, Position,
  type EdgeProps,
} from "@xyflow/react";
import type { SerializedEdge } from "@/lib/ea-types";

type EaEdgeData = Pick<SerializedEdge, "relationshipType"> & {
  onDelete?: () => void;
  edgeVariant?: "straight" | "bezier" | "step";
};

type XYPos = { x: number; y: number };

// Lightweight node geometry — derived from useNodes() which fires on every position change.
type NodeInfo = { x: number; y: number; cx: number; cy: number; w: number; h: number };

/**
 * Which side of `node` does the edge exit from when going toward `other`?
 * Determined by which boundary the center-to-center line hits first.
 * Prefers horizontal sides (Right/Left) on an exact diagonal tie.
 */
function getSideOfExit(node: NodeInfo, other: NodeInfo): Position {
  const dx = other.cx - node.cx;
  const dy = other.cy - node.cy;
  if (dx === 0 && dy === 0) return Position.Right;
  const tx = Math.abs(dx) > 0 ? (node.w / 2) / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 0 ? (node.h / 2) / Math.abs(dy) : Infinity;
  if (tx <= ty) return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

/**
 * Sort key for edge siblings along a shared side.
 * Horizontal sides → sort by other node's centre X; vertical sides → sort by centre Y.
 * Matching spatial order to attachment order prevents edge crossings.
 */
function getSideSortKey(side: Position, other: NodeInfo): number {
  return (side === Position.Top || side === Position.Bottom) ? other.cx : other.cy;
}

/**
 * All edges (both outgoing and incoming) that exit/enter `nodeId` from `side`.
 * Combining both directions ensures an outgoing and incoming edge on the same side
 * each receive distinct evenly-spaced attachment points rather than both landing at centre.
 */
function getEdgesOnNodeSide(
  nodeId: string,
  nodeInfo: NodeInfo,
  side: Position,
  allEdges: ReturnType<typeof useEdges>,
  allNodeInfo: Map<string, NodeInfo>,
): Array<{ edgeId: string; otherInfo: NodeInfo }> {
  const result: Array<{ edgeId: string; otherInfo: NodeInfo }> = [];
  for (const e of allEdges) {
    if (e.source === nodeId) {
      const tn = allNodeInfo.get(e.target);
      if (tn && getSideOfExit(nodeInfo, tn) === side) result.push({ edgeId: e.id, otherInfo: tn });
    } else if (e.target === nodeId) {
      const sn = allNodeInfo.get(e.source);
      if (sn && getSideOfExit(nodeInfo, sn) === side) result.push({ edgeId: e.id, otherInfo: sn });
    }
  }
  return result.sort((a, b) => {
    const diff = getSideSortKey(side, a.otherInfo) - getSideSortKey(side, b.otherInfo);
    return diff !== 0 ? diff : a.edgeId.localeCompare(b.edgeId);
  });
}

/**
 * Attachment point for this edge, evenly distributed among `total` siblings on `side`.
 * t = (index+1)/(total+1): one edge → centre; two → 1/3 and 2/3; etc.
 */
function getSpacedPoint(node: NodeInfo, side: Position, index: number, total: number): XYPos {
  const t = (index + 1) / (total + 1);
  switch (side) {
    case Position.Top:    return { x: node.x + node.w * t, y: node.y };
    case Position.Bottom: return { x: node.x + node.w * t, y: node.y + node.h };
    case Position.Left:   return { x: node.x,              y: node.y + node.h * t };
    case Position.Right:  return { x: node.x + node.w,     y: node.y + node.h * t };
    default:              return { x: node.x + node.w * t, y: node.y };
  }
}

// No memo — must re-render whenever sibling edge targets or node positions change.
// useNodes() fires on every position change, making spacing fully reactive.
export function EaRelationshipEdge({ id, source, target, selected, data, markerEnd }: EdgeProps) {
  const edgeData = data as EaEdgeData | undefined;
  const variant = edgeData?.edgeVariant ?? "bezier";

  // useNodes() returns a new array reference whenever any node moves → triggers re-render.
  const nodes = useNodes();
  const allEdges = useEdges();

  // Build nodeInfo map once per nodes update.
  const nodeInfo = useMemo(() => {
    const map = new Map<string, NodeInfo>();
    for (const n of nodes) {
      const w = n.measured?.width ?? 150;
      const h = n.measured?.height ?? 60;
      map.set(n.id, {
        x: n.position.x, y: n.position.y,
        cx: n.position.x + w / 2, cy: n.position.y + h / 2,
        w, h,
      });
    }
    return map;
  }, [nodes]);

  const srcInfo = nodeInfo.get(source);
  const tgtInfo = nodeInfo.get(target);
  if (!srcInfo || !tgtInfo) return null;

  const sourceSide = getSideOfExit(srcInfo, tgtInfo);
  const targetSide = getSideOfExit(tgtInfo, srcInfo);

  // All edges (in + out) sharing the same side of the source node, sorted spatially.
  const sourceGroup = getEdgesOnNodeSide(source, srcInfo, sourceSide, allEdges, nodeInfo);
  // All edges (in + out) sharing the same side of the target node, sorted spatially.
  const targetGroup = getEdgesOnNodeSide(target, tgtInfo, targetSide, allEdges, nodeInfo);

  const sourceIndex = Math.max(sourceGroup.findIndex((e) => e.edgeId === id), 0);
  const targetIndex = Math.max(targetGroup.findIndex((e) => e.edgeId === id), 0);

  const sp = getSpacedPoint(srcInfo, sourceSide, sourceIndex, sourceGroup.length);
  const tp = getSpacedPoint(tgtInfo,  targetSide, targetIndex, targetGroup.length);

  const pathProps = {
    sourceX: sp.x, sourceY: sp.y, sourcePosition: sourceSide,
    targetX: tp.x, targetY: tp.y, targetPosition: targetSide,
  };

  const [edgePath, labelX, labelY] =
    variant === "straight" ? getStraightPath({ sourceX: sp.x, sourceY: sp.y, targetX: tp.x, targetY: tp.y }) :
    variant === "step"     ? getSmoothStepPath(pathProps) :
                             getBezierPath(pathProps);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: selected ? "#a5b4fc" : "var(--dpf-accent)", strokeWidth: selected ? 2 : 1.5 }}
        {...(markerEnd !== undefined && { markerEnd })}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            display: "flex", alignItems: "center", gap: 4,
            pointerEvents: selected ? "all" : "none",
          }}
          className="nodrag nopan"
        >
          {edgeData?.relationshipType.name && (
            <span style={{
              fontSize: 10,
              color: selected ? "#a5b4fc" : "var(--dpf-accent)",
              background: "var(--dpf-bg)",
              padding: "1px 3px",
              borderRadius: 2,
            }}>
              {edgeData.relationshipType.name.toLowerCase()}
            </span>
          )}
          {selected && edgeData?.onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); edgeData.onDelete?.(); }}
              title="Delete relationship"
              style={{
                width: 16, height: 16, borderRadius: "50%",
                background: "var(--dpf-error)", border: "none", color: "var(--dpf-text)",
                fontSize: 10, lineHeight: 1, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
