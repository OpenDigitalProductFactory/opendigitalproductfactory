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
beforeEach(() => {
  // Auto-cleanup is not configured for this file, so renders would otherwise
  // accumulate and every query would match the previous test's DOM too.
  cleanup();
  framesLeft = 60;
});

beforeAll(() => {
  const noop = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    clearRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, fillText: noop,
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

  // Seed positions are `centre + (Math.random() - 0.5) * 300`. Pinning random to
  // 0.5 puts the node exactly at the canvas centre, so the click below is a
  // deterministic hit rather than a race with force-layout convergence.
  Math.random = () => 0.5;
});

const DATA: GraphData = {
  nodes: [
    { id: "source-code:prisma-model:BacklogItem", name: "BacklogItem", label: "PrismaModel", color: "#fbbf24", size: 9 },
  ],
  links: [],
};

/** Click the canvas at the node's simulated position to focus it. */
function focusTheNode(container: HTMLElement) {
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("canvas did not render");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 }) as DOMRect;
  // The single node settles at the centre of the default 800x500 canvas.
  fireEvent.click(canvas, { clientX: 400, clientY: 250 });
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
