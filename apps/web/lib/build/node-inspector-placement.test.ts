// apps/web/lib/build/node-inspector-placement.test.ts
//
// Verifies the deterministic placement contract for the anchored
// WorkflowNodeInspector. The reviewer flagged ambiguous tie-break behavior
// in the prior plan iteration; these tests pin the priority order
// (below > above > right > left) and the clamp behavior when no side fits.

import { describe, expect, it } from "vitest";
import { getInspectorPlacement, TIE_BREAK_PRIORITY, type PlacementInput } from "./node-inspector-placement";

const INSPECTOR_W = 340;
const INSPECTOR_H = 380;
const GAP = 8;

function makeRect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function baseInput(overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    nodeRect: makeRect(500, 300, 120, 60),
    containerRect: makeRect(0, 0, 1200, 800),
    containerScrollTop: 0,
    inspectorW: INSPECTOR_W,
    inspectorH: INSPECTOR_H,
    gap: GAP,
    ...overrides,
  };
}

describe("getInspectorPlacement", () => {
  it("exports the canonical tie-break order", () => {
    expect(TIE_BREAK_PRIORITY).toEqual(["below", "above", "right", "left"]);
  });

  it("places below a centered node that has room everywhere (priority first-fit)", () => {
    // Container is large enough that all four sides qualify; below wins by priority.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(540, 200, 120, 60),
        containerRect: makeRect(0, 0, 1200, 1000),
      })
    );
    expect(result.side).toBe("below");
    // Centered horizontally on the node — left = node.left + (node.w - inspector.w)/2.
    expect(result.left).toBeCloseTo(540 + (120 - INSPECTOR_W) / 2, 0);
    // Top sits gap below the node bottom.
    expect(result.top).toBeCloseTo(200 + 60 + GAP, 0);
  });

  it("places above-left when node is in the bottom-right corner", () => {
    // Bottom-right node: only above + left fit. Tie-break => above (then horizontally clamped left).
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(1050, 720, 120, 60),
        containerRect: makeRect(0, 0, 1200, 800),
      })
    );
    expect(result.side).toBe("above");
    // top should be node.top - inspectorH - gap = 720 - 380 - 8 = 332
    expect(result.top).toBe(720 - INSPECTOR_H - GAP);
    // left would be 1050 + (120 - 340)/2 = 940, but clamp to maxLeft = 1200 - 340 - 8 = 852.
    expect(result.left).toBe(1200 - INSPECTOR_W - GAP);
  });

  it("places below-right when node is in the top-left corner", () => {
    // Top-left node: only below + right fit. Tie-break => below.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(20, 20, 120, 60),
        containerRect: makeRect(0, 0, 1200, 800),
      })
    );
    expect(result.side).toBe("below");
    // top = nodeBottom + gap = 80 + 8 = 88
    expect(result.top).toBe(80 + GAP);
    // left = nodeLeft + (nodeW - inspectorW)/2 = 20 + (120 - 340)/2 = -90 → clamp to gap (8).
    expect(result.left).toBe(GAP);
  });

  it("prefers below over above when both fit and below has more space", () => {
    // Node high up: space below = 800 - 100 - 8 = 692; space above = 50 - 0 - 8 = 42.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(540, 50, 120, 50),
        containerRect: makeRect(0, 0, 1200, 800),
      })
    );
    expect(result.side).toBe("below");
  });

  it("prefers below over right when both fit and they have equal space (tie-break)", () => {
    // Engineer the geometry so spaceBelow === spaceRight and both >= required.
    // spaceBelow = container.bottom - node.bottom - gap
    // spaceRight = container.right - node.right - gap
    // Make them equal: container.bottom - node.bottom = container.right - node.right.
    // With container 1200x800: pick node so 800-nodeBottom = 1200-nodeRight.
    // Put nodeBottom = 400, nodeRight = 800 → spaceBelow = 800-400-8 = 392, spaceRight = 1200-800-8 = 392.
    // Required below = 380, required right = 340; both fit; below tie-break wins.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(680, 340, 120, 60),
        containerRect: makeRect(0, 0, 1200, 800),
      })
    );
    expect(result.side).toBe("below");
  });

  it("prefers right over left when only right + left fit and right has more space", () => {
    // Tall narrow node centered vertically; above and below clipped.
    // container 1200x420, node 120x400 at (left=540, top=10): spaceAbove=2, spaceBelow=2, both fail.
    // spaceLeft = 540 - 0 - 8 = 532. spaceRight = 1200 - 660 - 8 = 532. Tie → right (priority below>above>right>left).
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(540, 10, 120, 400),
        containerRect: makeRect(0, 0, 1200, 420),
      })
    );
    expect(result.side).toBe("right");
  });

  it("clamps inside container with gap margin when no side has enough room", () => {
    // Container barely bigger than the inspector — no side fits the full size.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(50, 50, 100, 80),
        containerRect: makeRect(0, 0, 360, 400),
      })
    );
    expect(result.side).toBe("below"); // default tie-break
    // left/top must be >= gap and not exceed container - inspector - gap
    expect(result.left).toBeGreaterThanOrEqual(GAP);
    expect(result.top).toBeGreaterThanOrEqual(GAP);
    expect(result.left).toBeLessThanOrEqual(360 - INSPECTOR_W - GAP);
    expect(result.top).toBeLessThanOrEqual(400 - INSPECTOR_H - GAP);
  });

  it("uses container bounds, NOT viewport, for clamping", () => {
    // Node and container off-screen relative to the viewport — placement must
    // operate in container-relative coordinates only.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(2000, 1500, 120, 60),
        containerRect: makeRect(1800, 1200, 1200, 800),
      })
    );
    // Coordinates are container-relative, so values should still be 0..containerSize.
    expect(result.left).toBeGreaterThanOrEqual(GAP);
    expect(result.left).toBeLessThanOrEqual(1200 - INSPECTOR_W - GAP);
    expect(result.top).toBeGreaterThanOrEqual(GAP);
    expect(result.top).toBeLessThanOrEqual(800 - INSPECTOR_H - GAP);
  });

  it("accounts for containerScrollTop when computing top", () => {
    // Same node, but the user has scrolled the container down.
    const noScroll = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(540, 50, 120, 50),
        containerRect: makeRect(0, 0, 1200, 800),
        containerScrollTop: 0,
      })
    );
    const scrolled = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(540, 50, 120, 50),
        containerRect: makeRect(0, 0, 1200, 800),
        containerScrollTop: 240,
      })
    );
    // Below placement: top = nodeBottomRel + gap, and nodeBottomRel includes scrollTop.
    expect(scrolled.top - noScroll.top).toBe(240);
  });

  it("places the connector anchor at the node edge facing the inspector", () => {
    // Below placement (room everywhere): connector at the bottom-center of the node.
    const result = getInspectorPlacement(
      baseInput({
        nodeRect: makeRect(540, 200, 120, 60),
        containerRect: makeRect(0, 0, 1200, 1000),
      })
    );
    expect(result.side).toBe("below");
    expect(result.connector).toEqual({ x: 540 + 60, y: 260 });
  });
});
