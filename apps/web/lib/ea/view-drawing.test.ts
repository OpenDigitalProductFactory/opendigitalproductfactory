// EA view -> drawing spec (BI-4C17BF51, slice S8 of BI-815D40C6).
import { describe, expect, it } from "vitest";
import { LAYER_COLOURS } from "@/lib/ea-types";
import { validateRenderRequest } from "@/lib/documents/generation/spec";
import { EA_NODE_H, EA_NODE_W } from "./canvas-layout";
import {
  DRAWING_MARGIN_MM,
  MAX_DRAWING_EXTENT_MM,
  MM_PER_CANVAS_PX,
  buildEaViewDrawingSpec,
  type EaViewForDrawing,
  type DrawingTokens,
} from "./view-drawing";

const TOKENS: DrawingTokens = { accent: "#2563eb", text: "#1a1a2e" }; // style-drift-allow

type El = EaViewForDrawing["elements"][number];

function element(id: string, name: string, neoLabel: string, extra: Partial<El> = {}): El {
  return {
    viewElementId: id,
    parentViewElementId: null,
    orderIndex: null,
    rendererHint: null,
    mode: "new",
    proposedProperties: null,
    elementType: { slug: neoLabel.toLowerCase(), name: neoLabel.replace(/^[^_]+__/, ""), neoLabel },
    element: { name },
    ...extra,
  };
}

function edge(id: string, from: string, to: string, slug = "serves", name = "Serves") {
  return { id, fromViewElementId: from, toViewElementId: to, relationshipType: { slug, name } };
}

function view(partial: Partial<EaViewForDrawing>): EaViewForDrawing {
  return { name: "Order platform", elements: [], edges: [], canvasState: null, ...partial };
}

function build(input: EaViewForDrawing) {
  const result = buildEaViewDrawingSpec(input, TOKENS);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe("buildEaViewDrawingSpec", () => {
  it("places each node at its saved canvas position, shifted onto the page and scaled to millimetres", () => {
    const spec = build(
      view({
        elements: [
          element("ve-a", "Customer", "ArchiMate__BusinessActor"),
          element("ve-b", "Order Service", "ArchiMate__ApplicationComponent"),
        ],
        canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: { "ve-a": { x: -100, y: 50 }, "ve-b": { x: 140, y: 250 } } },
      }),
    );
    const [page] = spec.pages;
    const a = page!.shapes.find((shape) => shape.id === "ve-a")!;
    const b = page!.shapes.find((shape) => shape.id === "ve-b")!;
    expect(a.x).toBeCloseTo(DRAWING_MARGIN_MM);
    expect(a.y).toBeCloseTo(DRAWING_MARGIN_MM);
    expect(b.x).toBeCloseTo(DRAWING_MARGIN_MM + 240 * MM_PER_CANVAS_PX);
    expect(b.y).toBeCloseTo(DRAWING_MARGIN_MM + 200 * MM_PER_CANVAS_PX);
    expect(a.width).toBeCloseTo(EA_NODE_W * MM_PER_CANVAS_PX);
    expect(a.height).toBeCloseTo(EA_NODE_H * MM_PER_CANVAS_PX);
  });

  it("labels nodes with the element name, or the proposed name on a propose-mode node", () => {
    const spec = build(
      view({
        elements: [
          element("ve-a", "Customer", "ArchiMate__BusinessActor"),
          element("ve-b", "Old name", "ArchiMate__ApplicationComponent", { mode: "propose", proposedProperties: { name: "New name" } }),
        ],
      }),
    );
    const labels = Object.fromEntries(spec.pages[0]!.shapes.map((shape) => [shape.id, shape.label]));
    expect(labels).toEqual({ "ve-a": "Customer", "ve-b": "New name" });
  });

  it("colours nodes by ArchiMate layer with the canvas palette and the resolved text token", () => {
    const spec = build(
      view({
        elements: [
          element("ve-biz", "Customer", "ArchiMate__BusinessActor"),
          element("ve-app", "Order Service", "ArchiMate__ApplicationComponent"),
          element("ve-tech", "Database Server", "ArchiMate__Node"),
        ],
      }),
    );
    const byId = new Map(spec.pages[0]!.shapes.map((shape) => [shape.id, shape]));
    expect(byId.get("ve-biz")).toMatchObject({ fill: LAYER_COLOURS.business!.bg, stroke: LAYER_COLOURS.business!.border, textColour: TOKENS.text });
    expect(byId.get("ve-app")).toMatchObject({ fill: LAYER_COLOURS.application!.bg, stroke: LAYER_COLOURS.application!.border });
    expect(byId.get("ve-tech")).toMatchObject({ fill: LAYER_COLOURS.technology!.bg, stroke: LAYER_COLOURS.technology!.border });
  });

  it("marks a propose-mode node with the accent token as its outline", () => {
    const spec = build(view({ elements: [element("ve-p", "Draft", "ArchiMate__BusinessActor", { mode: "propose" })] }));
    expect(spec.pages[0]!.shapes[0]).toMatchObject({ stroke: TOKENS.accent });
  });

  it("turns relationships into labelled connectors in the accent token, merging duplicates and dropping self-loops", () => {
    const spec = build(
      view({
        elements: [
          element("ve-a", "Customer", "ArchiMate__BusinessActor"),
          element("ve-b", "Order Service", "ArchiMate__ApplicationComponent"),
          element("ve-c", "Orders DB", "ArchiMate__DataObject"),
        ],
        edges: [
          edge("r1", "ve-b", "ve-a"),
          edge("r2", "ve-a", "ve-b"), // reverse of r1: one bidirectional connector
          edge("r3", "ve-b", "ve-c", "accesses", "Accesses"),
          edge("r4", "ve-c", "ve-c"), // self-loop
        ],
      }),
    );
    expect(spec.pages[0]!.connectors).toEqual([
      { from: "ve-a", to: "ve-b", label: "Serves", stroke: TOKENS.accent },
      { from: "ve-b", to: "ve-c", label: "Accesses", stroke: TOKENS.accent },
    ]);
  });

  it("drops a relationship whose end is not drawn on the view", () => {
    const spec = build(view({ elements: [element("ve-a", "A", "ArchiMate__BusinessActor")], edges: [edge("r1", "ve-a", "ve-gone")] }));
    expect(spec.pages[0]!.connectors).toEqual([]);
  });

  it("lays out a view with no saved positions on a grid with no overlaps", () => {
    const elements = Array.from({ length: 9 }, (_, index) => element(`ve-${index}`, `Element ${index}`, "ArchiMate__ApplicationComponent"));
    const spec = build(view({ elements }));
    const shapes = spec.pages[0]!.shapes;
    for (const [i, left] of shapes.entries()) {
      for (const right of shapes.slice(i + 1)) {
        const overlaps =
          left.x < right.x + right.width && right.x < left.x + left.width && left.y < right.y + right.height && right.y < left.y + left.height;
        expect(overlaps, `${left.id} overlaps ${right.id}`).toBe(false);
      }
    }
  });

  it("draws a value stream band with its stages inside it, in order", () => {
    const spec = build(
      view({
        elements: [
          element("ve-vs", "Order to cash", "ArchiMate__ValueStream", { rendererHint: "nested_chevron_sequence" }),
          element("ve-s2", "Ship", "ArchiMate__ValueStreamStage", { parentViewElementId: "ve-vs", orderIndex: 2 }),
          element("ve-s1", "Take order", "ArchiMate__ValueStreamStage", { parentViewElementId: "ve-vs", orderIndex: 1 }),
        ],
        canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: { "ve-vs": { x: 0, y: 0 } } },
      }),
    );
    const byId = new Map(spec.pages[0]!.shapes.map((shape) => [shape.id, shape]));
    const band = byId.get("ve-vs")!;
    const first = byId.get("ve-s1")!;
    const second = byId.get("ve-s2")!;
    for (const stage of [first, second]) {
      expect(stage.x).toBeGreaterThan(band.x);
      expect(stage.x + stage.width).toBeLessThan(band.x + band.width);
      expect(stage.y + stage.height).toBeLessThanOrEqual(band.y + band.height);
    }
    expect(first.x).toBeLessThan(second.x);
    // The band is drawn first so its stages sit on top of it.
    expect(spec.pages[0]!.shapes.map((shape) => shape.id).indexOf("ve-vs")).toBe(0);
  });

  it("draws BPMN gateways as diamonds and events as ellipses", () => {
    const spec = build(
      view({
        elements: [
          element("ve-g", "Approved?", "BPMN__ExclusiveGateway", { elementType: { slug: "bpmn_exclusive_gateway", name: "Exclusive Gateway", neoLabel: "BPMN__ExclusiveGateway" } }),
          element("ve-e", "Start", "BPMN__StartEvent", { elementType: { slug: "bpmn_start_event", name: "Start Event", neoLabel: "BPMN__StartEvent" } }),
          element("ve-t", "Review", "BPMN__Task", { elementType: { slug: "bpmn_task", name: "Task", neoLabel: "BPMN__Task" } }),
        ],
      }),
    );
    const kinds = Object.fromEntries(spec.pages[0]!.shapes.map((shape) => [shape.id, shape.kind]));
    expect(kinds).toEqual({ "ve-g": "diamond", "ve-e": "ellipse", "ve-t": "rounded-rect" });
  });

  it("scales a very wide view down so every shape stays inside the drawing bounds", () => {
    const spec = build(
      view({
        elements: [element("ve-a", "A", "ArchiMate__BusinessActor"), element("ve-b", "B", "ArchiMate__BusinessActor")],
        canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: { "ve-a": { x: 0, y: 0 }, "ve-b": { x: 40_000, y: 9_000 } } },
      }),
    );
    for (const shape of spec.pages[0]!.shapes) {
      expect(shape.x + shape.width).toBeLessThanOrEqual(MAX_DRAWING_EXTENT_MM);
      expect(shape.y + shape.height).toBeLessThanOrEqual(MAX_DRAWING_EXTENT_MM);
    }
  });

  it("produces a spec the S6 renderer accepts for odg, svg and pdf, for a view of 20+ elements", () => {
    const elements = Array.from({ length: 24 }, (_, index) =>
      element(`ve-${index}`, `Component ${index}`, index % 2 ? "ArchiMate__ApplicationComponent" : "ArchiMate__BusinessProcess"),
    );
    const edges = elements.slice(1).map((target, index) => edge(`r-${index}`, elements[index]!.viewElementId, target.viewElementId));
    const spec = build(view({ elements, edges }));
    expect(spec.family).toBe("drawing");
    expect(spec.title).toBe("Order platform");
    expect(spec.pages[0]!.shapes).toHaveLength(24);
    expect(spec.pages[0]!.connectors).toHaveLength(23);
    const validated = validateRenderRequest({ content: spec, formats: ["odg", "svg", "pdf"] });
    expect(validated.ok, validated.ok ? "" : validated.error).toBe(true);
  });

  it("refuses a view larger than one drawing page can hold", () => {
    const elements = Array.from({ length: 501 }, (_, index) => element(`ve-${index}`, `E${index}`, "ArchiMate__Node"));
    const result = buildEaViewDrawingSpec(view({ elements }), TOKENS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/501 elements/);
  });

  it("refuses an empty view", () => {
    const result = buildEaViewDrawingSpec(view({}), TOKENS);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no elements/) });
  });
});
