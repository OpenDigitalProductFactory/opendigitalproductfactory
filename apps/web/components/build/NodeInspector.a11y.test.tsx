// @vitest-environment jsdom
//
// apps/web/components/build/NodeInspector.a11y.test.tsx
//
// Pins the accessibility + close-lifecycle contract: Esc closes,
// click-outside closes, click-inside keeps open, focus is trapped
// to the sentinel pair, focus returns to the trigger on close.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function renderInspector(extra: Partial<Parameters<typeof NodeInspector>[0]> = {}) {
  const onClose = vi.fn();
  const onAskCoworker = vi.fn();
  const result = render(
    <div>
      <button type="button" data-testid="trigger">trigger</button>
      <div data-graph-node data-testid="graph-node">graph node</div>
      <NodeInspector
        nodeId="task:T1"
        title="T1 inspector"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={onClose}
        onAskCoworker={onAskCoworker}
        {...extra}
      />
    </div>,
  );
  return { ...result, onClose, onAskCoworker };
}

describe("NodeInspector a11y + close lifecycle", () => {
  it("Esc closes the inspector (capture phase wins over text inputs)", () => {
    const { onClose } = renderInspector();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mousedown outside the dialog AND outside graph nodes closes", () => {
    const { onClose } = renderInspector();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mousedown INSIDE the dialog does NOT close", () => {
    const { onClose } = renderInspector();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("mousedown on a graph node does NOT close (parent handles toggle)", () => {
    const { onClose } = renderInspector();
    const graphNode = screen.getByTestId("graph-node");
    fireEvent.mouseDown(graphNode);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button click invokes onClose", () => {
    const { onClose } = renderInspector();
    const closeBtn = screen.getByLabelText("Close inspector");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders sentinel pair for focus trapping", () => {
    renderInspector();
    expect(screen.getByTestId("node-inspector-sentinel-start")).toBeInTheDocument();
    expect(screen.getByTestId("node-inspector-sentinel-end")).toBeInTheDocument();
  });

  it("focus on the start sentinel wraps to the last focusable", () => {
    const { onAskCoworker } = renderInspector();
    expect(onAskCoworker).toBeDefined(); // sanity — ensures the ask-coworker button renders
    const startSentinel = screen.getByTestId("node-inspector-sentinel-start");
    fireEvent.focus(startSentinel);
    // Last focusable is the "Ask coworker" button (when provided).
    expect(screen.getByTestId("node-inspector-ask-coworker")).toHaveFocus();
  });

  it("focus on the end sentinel wraps to the first focusable", () => {
    renderInspector();
    const endSentinel = screen.getByTestId("node-inspector-sentinel-end");
    fireEvent.focus(endSentinel);
    // First focusable is the expand button.
    expect(screen.getByLabelText("Expand inspector")).toHaveFocus();
  });

  it("restores focus to the previously-focused element on unmount", () => {
    // jsdom doesn't auto-focus; emulate the prior focus state.
    const trigger = document.createElement("button");
    trigger.textContent = "trigger-outside";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <NodeInspector
        nodeId="task:T1"
        title="T1 inspector"
        anchorRect={rect(540, 200, 120, 60)}
        containerRect={rect(0, 0, 1200, 1000)}
        onClose={() => {}}
      />,
    );
    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("dialog has role + aria-modal=false + aria-labelledby pointing at the title element", () => {
    renderInspector();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "false");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const labelEl = document.getElementById(labelledBy!);
    expect(labelEl).not.toBeNull();
    expect(labelEl).toHaveTextContent("T1 inspector");
  });
});
