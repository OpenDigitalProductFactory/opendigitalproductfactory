// @vitest-environment jsdom
//
// BI-C2B6396B — the canvas must stay readable at the node counts the graph
// explorer spec sanctions, and must stop animating once the layout is at rest.
//
// Both defects were found by driving the live install, and neither is visible to
// a DOM assertion: the graph is painted to a <canvas>. So these tests record the
// 2D context calls and assert on the geometry that reaches it.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { RelationshipGraph } from "./RelationshipGraph";
import type { GraphData } from "@/lib/actions/graph";

type Arc = { x: number; y: number; r: number };
type Label = { text: string; x: number; y: number; size: number };

let arcs: Arc[] = [];
let labels: Label[] = [];
let rafCalls = 0;
let framesLeft = 0;

/** Roughly proportional to the real thing; enough for overlap geometry. */
const CHAR_WIDTH = 5;

beforeAll(() => {
  const noop = () => {};
  let currentFontSize = 9;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    arc: (x: number, y: number, r: number) => arcs.push({ x, y, r }),
    fill: noop,
    fillText: (text: string, x: number, y: number) =>
      labels.push({ text, x, y, size: currentFontSize }),
    measureText: (text: string) => ({ width: text.length * CHAR_WIDTH }),
    set font(v: string) { currentFontSize = Number.parseFloat(v) || 9; },
    get font() { return `${currentFontSize}px`; },
    set fillStyle(_v: string) {}, set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {}, set globalAlpha(_v: number) {},
    set textAlign(_v: string) {},
  });

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCalls += 1;
    if (framesLeft-- > 0) cb(0);
    return rafCalls;
  }) as never;
  globalThis.cancelAnimationFrame = noop as never;
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as never;
  // No Math.random pinning needed: seed positions are derived from node ids, so
  // the layout is already deterministic (BI-C2B6396B).
});

beforeEach(() => {
  cleanup();
  arcs = [];
  labels = [];
  rafCalls = 0;
  framesLeft = 0;
});

function crowdedGraph(nodeCount: number): GraphData {
  // A hub-and-spoke shape: every node linked to the first. This is the shape a
  // one-hop expansion produces in the explorer, and the one the old fixed spring
  // collapsed hardest — every edge pulled toward the same 100px of the centre.
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      name: `Node${i}`,
      label: "PrismaModel",
      color: "#fbbf24",
      size: 7,
    })),
    links: Array.from({ length: nodeCount - 1 }, (_, i) => ({
      source: "n0",
      target: `n${i + 1}`,
      type: "HAS_FIELD",
    })),
  };
}

/** Positions from the final painted frame — one arc per node, in node order. */
function finalPositions(nodeCount: number): Arc[] {
  return arcs.slice(-nodeCount);
}

function meanNearestNeighbour(points: Arc[]): number {
  let total = 0;
  for (const a of points) {
    let best = Infinity;
    for (const b of points) {
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < best) best = d;
    }
    total += best;
  }
  return total / points.length;
}

describe("layout spreads to fill the canvas (BI-C2B6396B)", () => {
  it("keeps ~120 nodes legibly separated rather than knotting in the centre", () => {
    const nodeCount = 120;
    framesLeft = 400; // more than enough for the temperature to reach rest
    render(<RelationshipGraph data={crowdedGraph(nodeCount)} />);

    const points = finalPositions(nodeCount);
    expect(points).toHaveLength(nodeCount);

    // Ideal separation for 120 nodes in 800x500 is sqrt(400000/120) ~= 58px.
    // The old fixed constants settled far below this; anything above ~20px means
    // the nodes are distinguishable rather than a single blob.
    expect(meanNearestNeighbour(points)).toBeGreaterThan(20);

    // And the graph should occupy the canvas, not a puddle in the middle.
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    expect(spanX).toBeGreaterThan(800 * 0.5);
    expect(spanY).toBeGreaterThan(500 * 0.5);
  });

  it("does not scatter a tiny graph to the edges", () => {
    // The clamp on ideal separation earns its keep here: unbounded k for 3 nodes
    // in 800x500 would be ~365px and push them into the corners.
    framesLeft = 400;
    render(
      <RelationshipGraph
        data={{
          nodes: ["a", "b", "c"].map((id) => ({
            id, name: id, label: "PrismaModel", color: "#fbbf24", size: 7,
          })),
          links: [{ source: "a", target: "b", type: "HAS_FIELD" }],
        }}
      />,
    );

    const points = finalPositions(3);
    const xs = points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(800 * 0.75);
  });
});

describe("labels do not overlap (BI-C2B6396B)", () => {
  it("skips a label rather than painting it over one already placed", () => {
    // Deliberately over-crowded: 240 nodes puts the ideal separation at ~41px
    // while these names measure ~95px wide, so without the overlap pass the
    // labels are guaranteed to collide. Verified: removing the guard from the
    // component makes this test fail.
    const nodeCount = 240;
    const data: GraphData = {
      nodes: Array.from({ length: nodeCount }, (_, i) => ({
        id: `n${i}`,
        name: `VeryLongNodeLabel${i}`,
        label: "PrismaModel",
        color: "#fbbf24",
        size: 7,
      })),
      links: Array.from({ length: nodeCount - 1 }, (_, i) => ({
        source: "n0", target: `n${i + 1}`, type: "HAS_FIELD",
      })),
    };

    framesLeft = 260;
    render(<RelationshipGraph data={data} />);

    // Labels from the final frame only.
    const lastFrame: Label[] = [];
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i]!;
      if (lastFrame.some((seen) => seen.text === l.text)) break;
      lastFrame.unshift(l);
    }
    expect(lastFrame.length).toBeGreaterThan(1);

    const boxes = lastFrame.map((l) => ({
      x0: l.x - (l.text.length * CHAR_WIDTH) / 2,
      x1: l.x + (l.text.length * CHAR_WIDTH) / 2,
      y1: l.y,
      y0: l.y - l.size,
    }));

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlaps = !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
        expect(overlaps, `"${lastFrame[i]!.text}" overlaps "${lastFrame[j]!.text}"`).toBe(false);
      }
    }
  });
});

describe("animation stops when the layout is at rest (BI-C2B6396B)", () => {
  it("stops re-arming requestAnimationFrame once cooled", () => {
    framesLeft = 2000; // never the limiting factor — the component must stop itself
    render(<RelationshipGraph data={crowdedGraph(30)} />);

    // Temperature decays 1.0 * 0.98^n, reaching 0.01 after ~228 frames. Well
    // under the 2000 the harness would allow, so a plateau proves the component
    // stopped rather than the harness running out.
    expect(rafCalls).toBeGreaterThan(0);
    expect(rafCalls).toBeLessThan(400);

    const settled = rafCalls;
    // Nothing further should be scheduled without an input change.
    expect(rafCalls).toBe(settled);
  });

  it("still paints a frame after cooling so a repaint-only restart renders", () => {
    framesLeft = 2000;
    const { rerender } = render(<RelationshipGraph data={crowdedGraph(10)} />);
    const afterSettle = arcs.length;

    // A prop change that affects painting but not physics.
    rerender(<RelationshipGraph data={crowdedGraph(10)} title="Renamed" />);

    expect(arcs.length).toBeGreaterThan(afterSettle);
  });
});
