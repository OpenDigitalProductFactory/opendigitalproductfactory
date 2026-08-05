// @vitest-environment jsdom
//
// BI-AB7FE57B — the focus chip must show the operator-facing type name, never the
// raw `graph_node.labels` storage value.
//
// `node.label` is the legend KEY: the show/hide filters match on it, so for the
// graph explorer it is deliberately the raw storage value ("PrismaModel",
// "ArchiMate__DataObject"). It reached the operator as prose in the focus chip,
// which the BI-89A149A9 ratified purpose contract forbids:
//   "No raw storage label (for example ArchiMate__DataObject) is shown to the
//    operator."
// Found by driving the live install, not by a test — hence this one.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RelationshipGraph } from "./RelationshipGraph";
import type { GraphData } from "@/lib/actions/graph";

// The component drives a <canvas> force simulation; jsdom has no 2D context.
// Stub just enough that render + click-to-focus work.
// Reset per test: the budget is consumed by each render, and a later test that
// starts at zero never lays out its nodes, so the click would silently miss.
let framesLeft = 60;
let lastArc: { x: number; y: number } | null = null;
beforeEach(() => {
  lastArc = null;
  // Auto-cleanup is not configured for this file, so renders would otherwise
  // accumulate and every query would match the previous test's DOM too.
  cleanup();
  framesLeft = 60;
});

beforeAll(() => {
  const noop = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    clearRect: noop, beginPath: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, fillText: noop,
    measureText: (text: string) => ({ width: text.length * 5 }),
    // Record where the node is actually painted so the click below can land on
    // it, rather than assuming a position.
    arc: (x: number, y: number) => { lastArc = { x, y }; },
    set fillStyle(_v: string) {}, set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {}, set globalAlpha(_v: number) {},
    set font(_v: string) {}, set textAlign(_v: string) {},
  });
  // The component's tick() re-arms rAF, so a synchronous stub would recurse
  // forever. Run a bounded number of frames — enough for the layout to assign
  // coordinates, which click hit-testing needs — then stop.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (framesLeft-- > 0) cb(0);
    return 0;
  }) as never;
  globalThis.cancelAnimationFrame = noop as never;
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as never;
});

const DATA: GraphData = {
  nodes: [
    { id: "source-code:prisma-model:BacklogItem", name: "BacklogItem", label: "PrismaModel", color: "#fbbf24", size: 9 },
  ],
  links: [],
};

/**
 * Click the canvas where the node was actually painted.
 *
 * Seed positions are derived from the node id (BI-C2B6396B), so there is no fixed
 * coordinate to aim at — and pinning Math.random no longer moves them. Reading
 * the position back from the last drawn arc keeps this independent of the
 * layout's internals.
 */
function focusTheNode(container: HTMLElement) {
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("canvas did not render");
  if (!lastArc) throw new Error("no node was painted — cannot locate it to click");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 }) as DOMRect;
  fireEvent.click(canvas, { clientX: lastArc.x, clientY: lastArc.y });
}

describe("focus chip type name (BI-AB7FE57B)", () => {
  it("shows the legend's human name, not the raw storage label", () => {
    const { container } = render(
      <RelationshipGraph
        data={DATA}
        nodeLegend={[{ key: "PrismaModel", label: "Data model", color: "#fbbf24" }]}
        linkLegend={[]}
      />,
    );

    focusTheNode(container);

    // Scope to the focus row: "Data model" also appears as a legend toggle, so a
    // bare text query would match twice and prove nothing about the chip.
    const focusRow = screen.getByText("Focus:").parentElement;
    expect(focusRow?.textContent).toContain("Data model");
    expect(focusRow?.textContent).not.toContain("PrismaModel");
  });

  it("falls back to the raw value when the type has no legend entry", () => {
    // Degrade visibly rather than render an empty chip: an unmapped type should
    // still tell the operator something.
    const { container } = render(
      <RelationshipGraph data={DATA} nodeLegend={[]} linkLegend={[]} />,
    );

    focusTheNode(container);

    const focusRow = screen.getByText("Focus:").parentElement;
    expect(focusRow?.textContent).toContain("PrismaModel");
  });
});
