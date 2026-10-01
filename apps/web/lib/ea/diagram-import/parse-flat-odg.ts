// Flat ODG -> candidate EA elements and relationships (BI-4C17BF51, slice S8 of
// BI-815D40C6, import half).
//
// The engine (dpf-convert --to fodg) turns a customer's .vsd, .vsdx or .odg into
// one flat OpenDocument drawing. This reads that XML and proposes, per page:
// - an ELEMENT for each labelled closed shape. LibreOffice's Visio import writes
//   a shape as a group of outline + text frame, so a group with a closed shape
//   counts once, with every text inside it as its label. Free text (titles,
//   notes) with no outline is not an element.
// - a RELATIONSHIP for each connector whose two ends reach two different
//   elements. A connector glued to shapes (draw:start-shape / draw:end-shape, as
//   Draw and DPF's own export write) is followed by id. An unglued line (the
//   Visio import) is matched by where its ends fall: inside, or within a few
//   millimetres of, a shape's box. Its label is the text on or grouped with it.
//
// These are proposals for a person to review, never model writes. The parser is
// pure and bounded: it only reads the XML string it is given.

import { XMLParser } from "fast-xml-parser";
import { LAYER_COLOURS } from "@/lib/ea-types";

export const MAX_IMPORT_ELEMENTS = 500;
export const MAX_IMPORT_RELATIONSHIPS = 1000;
/** How far outside a shape's box a loose line end may stop and still count as touching it. */
const TOUCH_TOLERANCE_MM = 3;
const MAX_LABEL = 200;

export type Box = { x: number; y: number; width: number; height: number };
export type CandidateElement = {
  key: string;
  label: string;
  box: Box;
  fill: string | null;
  /** The canvas layer whose fill this shape carries (a DPF export round trip), else null. */
  suggestedLayer: string | null;
};
export type CandidateRelationship = { fromKey: string; toKey: string; label: string | null };
export type ParsedDrawingPage = {
  name: string;
  elements: CandidateElement[];
  relationships: CandidateRelationship[];
  /** Connectors whose ends did not reach two different elements. */
  unattachedConnectors: number;
};
export type ParsedDrawing = { pages: ParsedDrawingPage[]; truncated: boolean };

type Node = Record<string, unknown>;
type Point = { x: number; y: number };

const CLOSED = new Set(["draw:custom-shape", "draw:rect", "draw:ellipse", "draw:circle", "draw:polygon", "draw:regular-polygon"]);
const LINES = new Set(["draw:line", "draw:connector", "draw:polyline", "draw:path"]);

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
});

function tagOf(node: Node): string | null {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text") ?? null;
}
function childrenOf(node: Node, tag = tagOf(node)): Node[] {
  return tag ? ((node[tag] as Node[] | undefined) ?? []) : [];
}
function attrs(node: Node): Record<string, string> {
  return (node[":@"] as Record<string, string> | undefined) ?? {};
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };
function length(value: string | undefined): number | null {
  const match = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/.exec(value ?? "");
  if (!match) return null;
  return Math.round(Number(match[1]) * UNIT_MM[match[2] ?? "mm"]! * 100) / 100;
}

/** All text under a node, paragraphs joined by spaces, whitespace collapsed. */
function textOf(node: Node): string {
  const parts: string[] = [];
  const walk = (current: Node) => {
    const tag = tagOf(current);
    if (tag === "draw:enhanced-geometry") return;
    if (typeof current["#text"] === "string" || typeof current["#text"] === "number") parts.push(String(current["#text"]));
    for (const child of childrenOf(current, tag)) walk(child);
    if (tag === "text:p" || tag === "text:h" || tag === "text:line-break") parts.push(" ");
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

function boxOf(node: Node): Box | null {
  const a = attrs(node);
  let x = length(a["svg:x"]);
  let y = length(a["svg:y"]);
  const width = length(a["svg:width"]);
  const height = length(a["svg:height"]);
  if ((x === null || y === null) && a["draw:transform"]) {
    const translate = /translate\s*\(\s*([^\s,)]+)[\s,]+([^\s,)]+)\s*\)/.exec(a["draw:transform"]);
    if (translate) {
      x = length(translate[1]);
      y = length(translate[2]);
    }
  }
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function union(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.round((right - left) * 100) / 100, height: Math.round((bottom - top) * 100) / 100 };
}

/** The two ends of a line-like shape, in millimetres on the page. */
function endsOf(node: Node): [Point, Point] | null {
  const a = attrs(node);
  const x1 = length(a["svg:x1"]);
  const y1 = length(a["svg:y1"]);
  const x2 = length(a["svg:x2"]);
  const y2 = length(a["svg:y2"]);
  if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const box = boxOf(node);
  const view = (a["svg:viewBox"] ?? "").trim().split(/[\s,]+/).map(Number);
  if (!box || view.length !== 4 || view.some((n) => !Number.isFinite(n)) || !view[2] || !view[3]) return null;
  const numbers = (a["draw:points"] ?? a["svg:d"] ?? "").match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
  if (numbers.length < 4) return null;
  const map = (px: number, py: number): Point => ({
    x: box.x + ((px - view[0]!) * box.width) / view[2]!,
    y: box.y + ((py - view[1]!) * box.height) / view[3]!,
  });
  return [map(numbers[0]!, numbers[1]!), map(numbers[numbers.length - 2]!, numbers[numbers.length - 1]!)];
}

function fillColours(root: Node[]): Map<string, string> {
  const fills = new Map<string, string>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === "style:style") {
        const name = attrs(node)["style:name"];
        const props = childrenOf(node).find((child) => tagOf(child) === "style:graphic-properties");
        const fill = props ? attrs(props)["draw:fill-color"] : undefined;
        if (name && fill) fills.set(name, fill.toLowerCase());
      } else if (tag && tag !== "office:body") {
        walk(childrenOf(node, tag));
      }
    }
  };
  walk(root);
  return fills;
}

const LAYER_BY_FILL = new Map(Object.entries(LAYER_COLOURS).map(([layer, colours]) => [colours.bg.toLowerCase(), layer]));

type RawShape = { ids: string[]; label: string; box: Box; fill: string | null };
type RawConnector = { start?: string; end?: string; ends: [Point, Point] | null; label: string };

function collect(nodes: Node[], fills: Map<string, string>, shapes: RawShape[], connectors: RawConnector[]) {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    const a = attrs(node);
    const ids = [a["draw:id"], a["xml:id"]].filter((id): id is string => Boolean(id));
    if (tag === "draw:g") {
      const members = childrenOf(node, tag);
      const closed = members.filter((member) => CLOSED.has(tagOf(member) ?? ""));
      const lines = members.filter((member) => LINES.has(tagOf(member) ?? ""));
      const label = members.map(textOf).filter(Boolean).join(" ").slice(0, MAX_LABEL);
      if (closed.length > 0) {
        const box = union(members.map(boxOf).filter((box): box is Box => box !== null));
        const memberIds = members.flatMap((member) => [attrs(member)["draw:id"], attrs(member)["xml:id"]]).filter((id): id is string => Boolean(id));
        const fill = fills.get(attrs(closed[0]!)["draw:style-name"] ?? "") ?? null;
        if (box && label) shapes.push({ ids: [...ids, ...memberIds], label, box, fill });
      } else if (lines.length > 0) {
        const line = lines[0]!;
        connectors.push({ start: attrs(line)["draw:start-shape"], end: attrs(line)["draw:end-shape"], ends: endsOf(line), label });
      } else {
        collect(members, fills, shapes, connectors);
      }
    } else if (CLOSED.has(tag)) {
      const box = boxOf(node);
      const label = textOf(node);
      if (box && label) shapes.push({ ids, label, box, fill: fills.get(a["draw:style-name"] ?? "") ?? null });
    } else if (LINES.has(tag)) {
      connectors.push({ start: a["draw:start-shape"], end: a["draw:end-shape"], ends: endsOf(node), label: textOf(node) });
    }
  }
}

function touching(point: Point, elements: CandidateElement[]): CandidateElement | null {
  let best: CandidateElement | null = null;
  let bestScore = Infinity;
  for (const element of elements) {
    const { x, y, width, height } = element.box;
    const dx = Math.max(x - point.x, 0, point.x - (x + width));
    const dy = Math.max(y - point.y, 0, point.y - (y + height));
    const distance = Math.hypot(dx, dy);
    if (distance > TOUCH_TOLERANCE_MM) continue;
    // Prefer the shape the point is inside (distance 0), then the smallest one.
    const score = distance * 1e6 + width * height;
    if (score < bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

/** Parse a flat ODF drawing (.fodg) into per-page candidates. Throws if it is not one. */
export function parseFlatOdg(xml: string): ParsedDrawing {
  const root = parser.parse(xml) as Node[];
  const document = root.find((node) => tagOf(node) === "office:document");
  const body = document ? childrenOf(document).find((node) => tagOf(node) === "office:body") : undefined;
  const drawing = body ? childrenOf(body).find((node) => tagOf(node) === "office:drawing") : undefined;
  if (!document || !drawing) throw new Error("The converted file is not a flat ODF drawing.");
  const fills = fillColours(childrenOf(document));

  let elementCount = 0;
  let relationshipCount = 0;
  let truncated = false;
  const pages: ParsedDrawingPage[] = [];
  for (const [pageIndex, page] of childrenOf(drawing).filter((node) => tagOf(node) === "draw:page").entries()) {
    const shapes: RawShape[] = [];
    const connectors: RawConnector[] = [];
    collect(childrenOf(page), fills, shapes, connectors);

    const room = MAX_IMPORT_ELEMENTS - elementCount;
    if (shapes.length > room) truncated = true;
    const elements: CandidateElement[] = shapes.slice(0, Math.max(room, 0)).map((shape, index) => ({
      key: `p${pageIndex + 1}-e${index + 1}`,
      label: shape.label,
      box: shape.box,
      fill: shape.fill,
      suggestedLayer: shape.fill ? LAYER_BY_FILL.get(shape.fill) ?? null : null,
    }));
    elementCount += elements.length;
    const byId = new Map<string, CandidateElement>();
    shapes.slice(0, elements.length).forEach((shape, index) => shape.ids.forEach((id) => byId.set(id, elements[index]!)));

    const relationships: CandidateRelationship[] = [];
    let unattachedConnectors = 0;
    for (const connector of connectors) {
      const from = (connector.start && byId.get(connector.start)) || (connector.ends && touching(connector.ends[0], elements)) || null;
      const to = (connector.end && byId.get(connector.end)) || (connector.ends && touching(connector.ends[1], elements)) || null;
      if (!from || !to || from === to) {
        unattachedConnectors += 1;
        continue;
      }
      if (relationshipCount >= MAX_IMPORT_RELATIONSHIPS) {
        truncated = true;
        break;
      }
      relationships.push({ fromKey: from.key, toKey: to.key, label: connector.label || null });
      relationshipCount += 1;
    }
    pages.push({ name: attrs(page)["draw:name"] || `Page ${pageIndex + 1}`, elements, relationships, unattachedConnectors });
  }
  return { pages, truncated };
}
