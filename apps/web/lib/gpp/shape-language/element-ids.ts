// apps/web/lib/gpp/shape-language/element-ids.ts
//
// Derived element ids — the shared-identifier contract (GPP V-3). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §9.1; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1, BI-6DA17863;
// AC-SHARED-ID, id derivation only — the EA projection and room-view halves
// are Phase 4).
//
// Ids are DERIVED from identity, never stored in the document, so the same id
// exists in the document, the emitted definition, the EA projection
// (`EaElement.infraCiKey = "gpp:<key>:<elementId>"`) and the runtime receipts
// (which already carry `stageKey`):
//
//   shape:<key>@<version>   trigger:<class>        stage:<stageKey>
//   gate:<stageKey>         tool:<stageKey>:<tool> binding:<id>@<version>
//   stop:<kind>:<n>         node:<id>              edge:<from>-><to>
//
// `n` is the 1-based ordinal among stops of that kind, in document order.
// Consequences of deriving from identity:
// - reordering stages, triggers, tools, flow nodes or edges, or stops of
//   different kinds, changes no id;
// - renaming a stage, tool, binding or node, bumping a binding version or the
//   shape version, or reordering two stops of the SAME kind, changes the id —
//   because that is a change of identity.
//
// A gate element exists for every governed-decision advance, typed `gate`
// block or not: the decision is a gate in the design view either way (§5
// construct 4), and an unratified scope still needs an element to attach its
// finding to.
//
// Derivation is total over UNVALIDATED input (`elementsOfValue`), because the
// schema step maps each Zod issue to the nearest element of a document that
// has, by definition, failed validation. A piece with the wrong type simply
// yields no element; findings under it land on the nearest enclosing one.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { GPP_DOCUMENT_ELEMENT_ID, toJsonPointer } from "./diagnostics";
import type { GppShapeDocument } from "./gpp-shape-schema";

export const GPP_ELEMENT_KINDS = ["shape", "trigger", "stage", "gate", "tool", "binding", "stop", "node", "edge"] as const;
export type GppElementKind = (typeof GPP_ELEMENT_KINDS)[number];

export type GppElement = {
  id: string;
  kind: GppElementKind;
  /** RFC 6901 JSON Pointer to the element's home in the document. */
  pointer: string;
  /** The same pointer as segments, for prefix matching. */
  segments: ReadonlyArray<string | number>;
};

export const shapeElementId = (key: string, version: string) => `shape:${key}@${version}`;
export const triggerElementId = (triggerClass: string) => `trigger:${triggerClass}`;
export const stageElementId = (stageKey: string) => `stage:${stageKey}`;
export const gateElementId = (stageKey: string) => `gate:${stageKey}`;
export const toolElementId = (stageKey: string, toolName: string) => `tool:${stageKey}:${toolName}`;
export const bindingElementId = (bindingId: string, version: number | string) => `binding:${bindingId}@${version}`;
export const stopElementId = (kind: string, ordinal: number) => `stop:${kind}:${ordinal}`;
export const flowNodeElementId = (nodeId: string) => `node:${nodeId}`;
export const flowEdgeElementId = (from: string, to: string) => `edge:${from}->${to}`;

/** The EA projection's `infraCiKey` for an element (spec §9.1). Phase 4 writes it. */
export function infraCiKeyFor(shapeKey: string, elementId: string): string {
  return `gpp:${shapeKey}:${elementId}`;
}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const arrayAt = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Every derivable element of a value that may or may not be a valid shape
 * document, in document order: shape, triggers, stages (each stage, its gate,
 * its tools, its binding), flow nodes and edges, stops.
 */
export function elementsOfValue(value: unknown): GppElement[] {
  const elements: GppElement[] = [];
  const add = (id: string, kind: GppElementKind, segments: Array<string | number>) => {
    elements.push({ id, kind, pointer: toJsonPointer(segments), segments });
  };
  if (!isObject(value)) return elements;

  if (isString(value.key) && isString(value.version)) add(shapeElementId(value.key, value.version), "shape", []);

  arrayAt(value.triggers).forEach((trigger, index) => {
    if (isString(trigger)) add(triggerElementId(trigger), "trigger", ["triggers", index]);
  });

  arrayAt(value.stages).forEach((stage, index) => {
    if (!isObject(stage) || !isString(stage.key)) return;
    const base = ["stages", index];
    add(stageElementId(stage.key), "stage", base);
    const advance = stage.advance;
    if (isObject(advance) && advance.kind === "governed-decision") {
      add(gateElementId(stage.key), "gate", "gate" in advance ? [...base, "advance", "gate"] : [...base, "advance"]);
    }
    arrayAt(stage.tools).forEach((tool, toolIndex) => {
      if (isString(tool)) add(toolElementId(stage.key as string, tool), "tool", [...base, "tools", toolIndex]);
    });
    const binding = stage.binding;
    if (isObject(binding) && isString(binding.id) && (typeof binding.version === "number" || isString(binding.version))) {
      add(bindingElementId(binding.id, binding.version), "binding", [...base, "binding"]);
    }
  });

  if (isObject(value.flow)) {
    arrayAt(value.flow.nodes).forEach((node, index) => {
      if (isObject(node) && isString(node.id)) add(flowNodeElementId(node.id), "node", ["flow", "nodes", index]);
    });
    arrayAt(value.flow.edges).forEach((edge, index) => {
      if (isObject(edge) && isString(edge.from) && isString(edge.to)) {
        add(flowEdgeElementId(edge.from, edge.to), "edge", ["flow", "edges", index]);
      }
    });
  }

  const ordinals = new Map<string, number>();
  arrayAt(value.stopConditions).forEach((stop, index) => {
    if (!isObject(stop) || !isString(stop.kind)) return;
    const ordinal = (ordinals.get(stop.kind) ?? 0) + 1;
    ordinals.set(stop.kind, ordinal);
    add(stopElementId(stop.kind, ordinal), "stop", ["stopConditions", index]);
  });

  return elements;
}

/** Every element of a valid document, in document order. */
export function elementsOf(document: GppShapeDocument): GppElement[] {
  return elementsOfValue(document);
}

/** Every derived element id of a valid document, in document order (plan PR-3b-1). */
export function elementIdsOf(document: GppShapeDocument): string[] {
  return elementsOf(document).map((element) => element.id);
}

function isPrefix(prefix: ReadonlyArray<string | number>, path: ReadonlyArray<string | number>): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => String(segment) === String(path[index]));
}

/**
 * The element whose home most closely encloses `path` (the longest pointer
 * that is a segment-wise prefix of it), or GPP_DOCUMENT_ELEMENT_ID when no
 * element encloses it (for example, the document's `key` is itself invalid).
 */
export function nearestElementId(elements: readonly GppElement[], path: ReadonlyArray<string | number>): string {
  let best: GppElement | null = null;
  for (const element of elements) {
    if (!isPrefix(element.segments, path)) continue;
    if (!best || element.segments.length > best.segments.length) best = element;
  }
  return best ? best.id : GPP_DOCUMENT_ELEMENT_ID;
}
