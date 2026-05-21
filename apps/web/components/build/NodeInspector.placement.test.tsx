// @vitest-environment jsdom
//
// apps/web/components/build/NodeInspector.placement.test.tsx
//
// Verifies that NodeInspector's inline position style derives from
// getInspectorPlacement() and uses CONTAINER bounds (not viewport).
// Re-render with a different rect must re-position.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NodeInspector } from "./NodeInspector";

afterEach(cleanup);

function rect(left: number, top: number, w: number, h: number) {
  return {
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
  };
}

describe("NodeInspector placement", () => {
  it("renders role='dialog' with aria-modal='false' and an accessible name", () => {
    render(
      <NodeInspector
        nodeId="phase:plan"
        title="Plan phase"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Plan phase" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
  });

  it("anchors below a centered node with room everywhere (first-fit by priority)", () => {
    render(
      <NodeInspector
        nodeId="phase:plan"
        title="Plan phase"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-side", "below");
    // top = nodeBottom + gap = 260 + 8 = 268
    expect((dialog as HTMLElement).style.top).toBe("268px");
  });

  it("anchors above when the node is in the bottom-right corner", () => {
    render(
      <NodeInspector
        nodeId="phase:ship"
        title="Ship"
        anchorRect={rect(1050, 720, 120, 60)}
        containerRect={rect(0, 0, 1200, 800)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-side", "above");
  });

  it("uses container bounds — placement values are container-relative, not viewport", () => {
    // Node + container both offset off-screen. The inspector's top/left must
    // still be inside the container (not the viewport).
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(2000, 1500, 120, 60)}
        containerRect={rect(1800, 1200, 1200, 800)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog") as HTMLElement;
    const topPx = parseInt(dialog.style.top, 10);
    const leftPx = parseInt(dialog.style.left, 10);
    expect(topPx).toBeGreaterThanOrEqual(0);
    expect(leftPx).toBeGreaterThanOrEqual(0);
    expect(leftPx).toBeLessThanOrEqual(1200);
    expect(topPx).toBeLessThanOrEqual(800);
  });

  it("re-positions when the anchor rect changes (re-anchor on prop update)", () => {
    const { rerender } = render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const dialog1 = screen.getByRole("dialog") as HTMLElement;
    const initialTop = dialog1.style.top;

    rerender(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 400, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const dialog2 = screen.getByRole("dialog") as HTMLElement;
    expect(dialog2.style.top).not.toBe(initialTop);
  });

  it("respects containerScrollTop in top calculation", () => {
    const { rerender } = render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        containerScrollTop={0}
        onClose={() => {}}
      />,
    );
    const noScrollTop = parseInt((screen.getByRole("dialog") as HTMLElement).style.top, 10);

    rerender(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        containerScrollTop={120}
        onClose={() => {}}
      />,
    );
    const scrolledTop = parseInt((screen.getByRole("dialog") as HTMLElement).style.top, 10);
    expect(scrolledTop - noScrollTop).toBe(120);
  });

  it("emits data-side reflecting the chosen placement", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", "below");
  });

  it("renders the children body content", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      >
        <p data-testid="body">Step details</p>
      </NodeInspector>,
    );
    expect(screen.getByTestId("body")).toHaveTextContent("Step details");
  });
});
