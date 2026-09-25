// EA view -> S6 drawing spec (BI-4C17BF51, slice S8 of BI-815D40C6).
//
// The EA canvas stays model-first; this is the exchange edge around it. A view's
// laid-out nodes and relationships become a `drawing` content spec
// (lib/documents/generation/spec.ts), which renderDocument turns into .odg, .svg
// and .pdf, plus a PNG preview.
//
// The drawing mirrors what the canvas shows:
// - positions come from the view's saved canvas state, with the canvas's own
//   placement rules for nodes it has not saved (a grid for a fresh view,
//   neighbour-aware placement for a newly added node);
// - value-stream stages sit inside their band, laid out by the canvas's band
//   layout (components/ea/value-stream-layout.ts);
// - colours are the canvas's ArchiMate/BPMN layer palette (LAYER_COLOURS, their
//   one home), with the text and connector colours taken from the --dpf-* token
//   values resolved on the server (view-drawing-export.ts), not from a second
//   hand-copied palette;
// - relationships collapse the way the canvas collapses them
//   (dedupeRenderEdges): duplicates merge and self-loops are dropped.
//
// Pure: no database, no engine. Canvas pixels become millimetres at
// MM_PER_CANVAS_PX, and the whole drawing is shifted onto the page and, when
// it would overflow the spec's bounds, scaled down uniformly.

import { buildValueStreamGroupLayout } from "@/components/ea/value-stream-layout";
import { buildStructuredViewElements } from "@/lib/ea-structure";
import { LAYER_COLOURS, layerFromNeoLabel, type CanvasState, type SerializedEdge, type SerializedViewElement } from "@/lib/ea-types";
import { ok, type ActionResult } from "@/lib/shared/action-result";
import type { ContentSpec } from "@/lib/documents/generation/spec";
import { EA_NODE_H, EA_NODE_W, dedupeRenderEdges, placeIncremental, type EaLayoutEdge } from "./canvas-layout";

/** 0.4 mm per canvas pixel: a 170 x 80 px node is a 68 x 32 mm box, legible at Draw's default text size. */
export const MM_PER_CANVAS_PX = 0.4;
export const DRAWING_MARGIN_MM = 10;
/** The drawing spec's coordinate bound (spec.ts `coordinate`), less the page margin. */
export const MAX_DRAWING_EXTENT_MM = 4990;
/** One drawing page holds at most this many shapes (spec.ts). */
export const MAX_DRAWING_SHAPES = 500;
export const MAX_DRAWING_CONNECTORS = 1000;

/** Grid pitch the canvas uses for a view with no saved layout (EaCanvas buildNodeLayout). */
const GRID_STEP_X = 240;
const GRID_STEP_Y = 150;

/** The --dpf-* token values a drawing uses, resolved to #rrggbb on the server. */
export type DrawingTokens = {
  /** --dpf-accent: relationship lines and propose-mode outlines, as on the canvas. */
  accent: string;
  /** --dpf-text: label text on the light layer fills. */
  text: string;
};

export type EaViewForDrawing = {
  name: string;
  elements: Array<
    Pick<SerializedViewElement, "viewElementId" | "parentViewElementId" | "orderIndex" | "rendererHint" | "mode" | "proposedProperties"> & {
      elementType: Pick<SerializedViewElement["elementType"], "slug" | "name" | "neoLabel">;
      element: { name: string };
    }
  >;
  edges: Array<Pick<SerializedEdge, "id" | "fromViewElementId" | "toViewElementId"> & { relationshipType: { slug: string; name: string } }>;
  canvasState: CanvasState | null;
};

export type DrawingSpec = Extract<ContentSpec, { family: "drawing" }>;
type DrawingShape = DrawingSpec["pages"][number]["shapes"][number];
type DrawingConnector = DrawingSpec["pages"][number]["connectors"][number];
type Box = { x: number; y: number; width: number; height: number };
type ViewElement = EaViewForDrawing["elements"][number];

function shapeKind(element: ViewElement): DrawingShape["kind"] {
  const slug = element.elementType.slug;
  if (element.elementType.neoLabel.startsWith("BPMN__")) {
    if (slug.includes("gateway")) return "diamond";
    if (slug.includes("event")) return "ellipse";
    if (slug === "bpmn_pool" || slug === "bpmn_lane") return "rect";
  }
  if (element.rendererHint === "nested_chevron_sequence") return "rect";
  return "rounded-rect";
}

function label(element: ViewElement): string {
  const proposed = element.mode === "propose" ? element.proposedProperties?.["name"] : undefined;
  const text = (typeof proposed === "string" && proposed.trim() ? proposed : element.element.name).trim();
  return text.slice(0, 500);
}

function safeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64);
  return cleaned || "shape";
}

/** Top-level canvas positions: saved ones, else the canvas's placeholder grid / incremental placement. */
function topLevelPositions(ids: string[], saved: Record<string, { x: number; y: number }>, edges: EaLayoutEdge[]) {
  const known = ids.filter((id) => saved[id]);
  const allAtOrigin = known.length === ids.length && known.every((id) => saved[id]!.x === 0 && saved[id]!.y === 0);
  if (ids.length > 1 && (known.length === 0 || allAtOrigin)) {
    const cols = Math.ceil(Math.sqrt(ids.length));
    return Object.fromEntries(ids.map((id, index) => [id, { x: (index % cols) * GRID_STEP_X, y: Math.floor(index / cols) * GRID_STEP_Y }]));
  }
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of known) positions[id] = saved[id]!;
  const missing = ids.filter((id) => !positions[id]);
  if (missing.length > 0) Object.assign(positions, placeIncremental(positions, edges, missing));
  return positions;
}

/** Build the drawing spec for one EA view. Fails (never throws) for a view a drawing cannot hold. */
export function buildEaViewDrawingSpec(view: EaViewForDrawing, tokens: DrawingTokens): ActionResult<DrawingSpec> {
  if (view.elements.length === 0) return { ok: false, error: "This view has no elements to draw." };
  if (view.elements.length > MAX_DRAWING_SHAPES) {
    return { ok: false, error: `This view has ${view.elements.length} elements; a drawing page holds at most ${MAX_DRAWING_SHAPES}.` };
  }

  const byId = new Map(view.elements.map((element) => [element.viewElementId, element]));
  const roots = buildStructuredViewElements(
    view.elements.map((element) => ({
      viewElementId: element.viewElementId,
      elementId: element.viewElementId,
      elementTypeSlug: element.elementType.slug,
      parentViewElementId: element.parentViewElementId,
      orderIndex: element.orderIndex,
      rendererHint: element.rendererHint,
    })),
  );

  // Canvas pixel boxes, drawn in this order (a band before the stages on top of it).
  const boxes: Array<{ element: ViewElement; box: Box }> = [];
  const drawn = new Set<string>();
  const topIds = roots.map((root) => root.viewElementId);
  const layoutEdges: EaLayoutEdge[] = view.edges
    .filter((edge) => topIds.includes(edge.fromViewElementId) && topIds.includes(edge.toViewElementId))
    .map((edge) => ({ source: edge.fromViewElementId, target: edge.toViewElementId }));
  const saved = view.canvasState?.nodes ?? {};
  const positions = topLevelPositions(topIds, saved, layoutEdges);

  const place = (element: ViewElement, box: Box) => {
    boxes.push({ element, box });
    drawn.add(element.viewElementId);
  };
  for (const root of roots) {
    const element = byId.get(root.viewElementId)!;
    const origin = positions[root.viewElementId] ?? { x: 0, y: 0 };
    if (element.rendererHint === "nested_chevron_sequence" && root.childViewElements.length > 0) {
      const stages = root.childViewElements.map((child) => byId.get(child.viewElementId)!);
      const group = buildValueStreamGroupLayout({ origin, stageLabels: stages.map((stage) => stage.element.name) });
      place(element, group.band);
      stages.forEach((stage, index) => place(stage, group.stages[index]!));
      continue;
    }
    place(element, { ...origin, width: EA_NODE_W, height: EA_NODE_H });
  }
  // Nested children the canvas does not draw inside a band keep their own saved
  // position (or sit below the drawing), so an export never silently loses one.
  const bottom = Math.max(...boxes.map(({ box }) => box.y + box.height));
  let spill = 0;
  for (const element of view.elements) {
    if (drawn.has(element.viewElementId)) continue;
    const at = saved[element.viewElementId] ?? { x: spill++ * GRID_STEP_X, y: bottom + GRID_STEP_Y / 2 };
    place(element, { ...at, width: EA_NODE_W, height: EA_NODE_H });
  }

  // Canvas pixels -> page millimetres: shift to the margin, scale down if it would overflow.
  const minX = Math.min(...boxes.map(({ box }) => box.x));
  const minY = Math.min(...boxes.map(({ box }) => box.y));
  const spanPx = Math.max(...boxes.map(({ box }) => Math.max(box.x + box.width - minX, box.y + box.height - minY)));
  const scale = Math.min(MM_PER_CANVAS_PX, (MAX_DRAWING_EXTENT_MM - DRAWING_MARGIN_MM) / spanPx);
  const mm = (value: number) => Math.round(value * scale * 100) / 100;

  const ids = new Map<string, string>();
  const shapes: DrawingShape[] = boxes.map(({ element, box }) => {
    const id = safeId(element.viewElementId);
    ids.set(element.viewElementId, id);
    const colours = LAYER_COLOURS[layerFromNeoLabel(element.elementType.neoLabel)] ?? LAYER_COLOURS.application!;
    return {
      id,
      kind: shapeKind(element),
      x: DRAWING_MARGIN_MM + mm(box.x - minX),
      y: DRAWING_MARGIN_MM + mm(box.y - minY),
      width: Math.max(mm(box.width), 1),
      height: Math.max(mm(box.height), 1),
      label: label(element) || undefined,
      fill: colours.bg,
      stroke: element.mode === "propose" ? tokens.accent : colours.border,
      textColour: tokens.text,
    };
  });

  const connectors: DrawingConnector[] = dedupeRenderEdges(
    view.edges
      .filter((edge) => ids.has(edge.fromViewElementId) && ids.has(edge.toViewElementId))
      .map((edge) => ({ id: edge.id, from: edge.fromViewElementId, to: edge.toViewElementId, typeSlug: edge.relationshipType.slug })),
  )
    .slice(0, MAX_DRAWING_CONNECTORS)
    .map((rendered) => {
      const relationship = view.edges.find((edge) => edge.id === rendered.id)!;
      return {
        from: ids.get(rendered.source)!,
        to: ids.get(rendered.target)!,
        label: relationship.relationshipType.name.slice(0, 200) || undefined,
        stroke: tokens.accent,
      };
    });

  const title = view.name.trim().slice(0, 300) || "EA view";
  return ok({
    family: "drawing",
    title,
    subject: "Enterprise architecture view",
    pages: [{ name: title.slice(0, 100), shapes, connectors }],
  });
}
