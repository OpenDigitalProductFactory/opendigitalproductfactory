// apps/web/lib/build/node-inspector-placement.ts
//
// Pure helper: given a workflow-node rect, the graph-container rect, and the
// inspector dimensions, return where to position the anchored inspector inside
// the graph container.
//
// Authoritative bounds are the GRAPH CONTAINER, not the viewport — the
// inspector lives absolutely-positioned inside the workflow region (per
// docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md §2).
//
// Tie-break: when two or more sides have equal available space the resolver
// returns them in the deterministic priority order  below > above > right > left.

export type InspectorSide = "above" | "below" | "left" | "right";

export type PlacementInput = {
  /** Bounding rect of the clicked workflow node, in viewport coordinates. */
  nodeRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** Bounding rect of the graph container that wraps the inspector, in viewport coordinates. */
  containerRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** containerRef.scrollTop — added to top so the inspector tracks scroll inside the graph. */
  containerScrollTop: number;
  /** Compact inspector width in px. */
  inspectorW: number;
  /** Compact inspector height in px. */
  inspectorH: number;
  /** Gap between the node edge and the inspector edge in px. Defaults to 8. */
  gap?: number;
};

export type PlacementResult = {
  side: InspectorSide;
  /** Position relative to the container's top-left, in px. */
  top: number;
  left: number;
  /** Anchor point for the connector arrow, relative to container. */
  connector: { x: number; y: number };
};

/** Deterministic tie-break order — keep at module scope for testability. */
export const TIE_BREAK_PRIORITY: readonly InspectorSide[] = ["below", "above", "right", "left"] as const;

/**
 * Compute the best inspector placement.
 *
 * Algorithm (intentionally simple and deterministic):
 *   1. Compute available space in each direction (between node edge and container edge).
 *   2. Walk the qualifying sides in TIE_BREAK_PRIORITY order — return the first one
 *      that fits the inspector + gap. This makes placement predictable: "below" is
 *      always the first choice if it fits, then "above", "right", "left".
 *   3. If NO side fits, clamp the inspector inside the container with `gap`
 *      margin and use the highest-priority side ("below") for the connector geometry.
 *
 * Rationale for "first-fit by priority" over "side with most room":
 *   The reviewer flagged behavioral ambiguity. A deterministic priority cascade is
 *   easier to test, easier to reason about, and produces a consistent UX feel —
 *   the inspector keeps appearing in the same place relative to nodes across the
 *   canvas. Most-room would jump the inspector around as nodes shifted.
 *
 * The function never returns a position that escapes the container bounds —
 * out-of-bounds candidates are clamped to `[gap, containerSize - inspectorSize - gap]`.
 */
export function getInspectorPlacement(input: PlacementInput): PlacementResult {
  const gap = input.gap ?? 8;
  const { nodeRect, containerRect, containerScrollTop, inspectorW, inspectorH } = input;

  // Available space in each direction, in container-relative coordinates.
  const spaceBelow = containerRect.bottom - nodeRect.bottom - gap;
  const spaceAbove = nodeRect.top - containerRect.top - gap;
  const spaceRight = containerRect.right - nodeRect.right - gap;
  const spaceLeft = nodeRect.left - containerRect.left - gap;

  const required: Record<InspectorSide, number> = {
    below: inspectorH,
    above: inspectorH,
    right: inspectorW,
    left: inspectorW,
  };
  const spaces: Record<InspectorSide, number> = {
    below: spaceBelow,
    above: spaceAbove,
    right: spaceRight,
    left: spaceLeft,
  };

  // First-fit by priority order. If nothing fits, fall back to "below" + clamp.
  let chosen: InspectorSide = "below";
  for (const side of TIE_BREAK_PRIORITY) {
    if (spaces[side] >= required[side]) {
      chosen = side;
      break;
    }
  }

  // Compute container-relative position.
  // Base case: position the inspector to the chosen side of the node, then clamp.
  // All coordinates are container-relative; nodeRect is viewport-relative, so
  // subtract containerRect origin.
  const nodeLeftRel = nodeRect.left - containerRect.left;
  const nodeTopRel = nodeRect.top - containerRect.top + containerScrollTop;
  const nodeRightRel = nodeRect.right - containerRect.left;
  const nodeBottomRel = nodeRect.bottom - containerRect.top + containerScrollTop;

  let top: number;
  let left: number;
  switch (chosen) {
    case "below": {
      top = nodeBottomRel + gap;
      // center horizontally on node
      left = nodeLeftRel + (nodeRect.width - inspectorW) / 2;
      break;
    }
    case "above": {
      top = nodeTopRel - inspectorH - gap;
      left = nodeLeftRel + (nodeRect.width - inspectorW) / 2;
      break;
    }
    case "right": {
      left = nodeRightRel + gap;
      top = nodeTopRel + (nodeRect.height - inspectorH) / 2;
      break;
    }
    case "left": {
      left = nodeLeftRel - inspectorW - gap;
      top = nodeTopRel + (nodeRect.height - inspectorH) / 2;
      break;
    }
  }

  // Clamp to container bounds with `gap` margin.
  const maxLeft = containerRect.width - inspectorW - gap;
  const maxTop = containerRect.height + containerScrollTop - inspectorH - gap;
  left = Math.max(gap, Math.min(left, maxLeft));
  top = Math.max(gap, Math.min(top, maxTop));

  // Connector anchor: midpoint of the node edge facing the inspector,
  // container-relative.
  let connector: { x: number; y: number };
  switch (chosen) {
    case "below":
      connector = { x: nodeLeftRel + nodeRect.width / 2, y: nodeBottomRel };
      break;
    case "above":
      connector = { x: nodeLeftRel + nodeRect.width / 2, y: nodeTopRel };
      break;
    case "right":
      connector = { x: nodeRightRel, y: nodeTopRel + nodeRect.height / 2 };
      break;
    case "left":
      connector = { x: nodeLeftRel, y: nodeTopRel + nodeRect.height / 2 };
      break;
  }

  return { side: chosen, top, left, connector };
}
