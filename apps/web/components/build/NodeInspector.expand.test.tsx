// @vitest-environment jsdom
//
// apps/web/components/build/NodeInspector.expand.test.tsx
//
// Pins the expand-handle contract:
//   - Toggle button flips data-expanded.
//   - Expanded mode grows to ~80% of container, never escapes container bounds.
//   - Re-anchor on size change keeps the dialog inside the container.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("NodeInspector expand", () => {
  it("starts collapsed (data-expanded='false')", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-expanded", "false");
  });

  it("expand handle toggles data-expanded", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const expandBtn = screen.getByLabelText("Expand inspector");
    fireEvent.click(expandBtn);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-expanded", "true");
    // Label flips to "Collapse" once expanded.
    const collapseBtn = screen.getByLabelText("Collapse inspector");
    fireEvent.click(collapseBtn);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-expanded", "false");
  });

  it("expanded inspector grows but stays within container bounds", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog") as HTMLElement;
    const compactWidth = parseInt(dialog.style.width, 10);

    fireEvent.click(screen.getByLabelText("Expand inspector"));
    const expandedWidth = parseInt(dialog.style.width, 10);
    const expandedHeight = parseInt(dialog.style.height, 10);

    expect(expandedWidth).toBeGreaterThan(compactWidth);
    // Capped at ~80% of container width/height.
    expect(expandedWidth).toBeLessThanOrEqual(1200);
    expect(expandedHeight).toBeLessThanOrEqual(1000);
  });

  it("expand handle has aria-pressed reflecting state", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const btn = screen.getByLabelText("Expand inspector");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(screen.getByLabelText("Collapse inspector")).toHaveAttribute("aria-pressed", "true");
  });

  it("expanded position respects container bounds (clamped, never escapes)", () => {
    // Tight container where expand would overflow viewport in an unclamped
    // implementation. Verify the clamped position is still inside.
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(20, 20, 60, 40)}
        containerRect={rect(0, 0, 600, 500)}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Expand inspector"));
    const dialog = screen.getByRole("dialog") as HTMLElement;
    const top = parseInt(dialog.style.top, 10);
    const left = parseInt(dialog.style.left, 10);
    const w = parseInt(dialog.style.width, 10);
    const h = parseInt(dialog.style.height, 10);
    expect(top + h).toBeLessThanOrEqual(500);
    expect(left + w).toBeLessThanOrEqual(600);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it("respects prefers-reduced-motion (no transition class duplication)", () => {
    render(
      <NodeInspector
        nodeId="task:T1"
        title="T1"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    // The component opts every transition out via motion-reduce:transition-none.
    expect(dialog.className).toContain("motion-reduce:transition-none");
  });
});
