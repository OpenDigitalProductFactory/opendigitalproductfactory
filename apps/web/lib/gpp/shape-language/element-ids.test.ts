// Derived element ids — the shared-identifier contract (PR-3b-1, BI-6DA17863;
// AC-SHARED-ID, derivation half). Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §4.3 (sidecar), §9.1
// (ids); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1). Failing before:
// element-ids.ts did not exist.
//
// The property under test: an id changes exactly when the element's identity
// changes. Reorderings that keep identity (stages, triggers, tools, stops of
// different kinds, object keys) change no id; renames, version bumps and
// swapping two stops of the same kind (whose identity IS their ordinal) do.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import { GPP_DOCUMENT_ELEMENT_ID } from "./diagnostics";
import {
  elementIdsOf,
  elementsOf,
  elementsOfValue,
  infraCiKeyFor,
  nearestElementId,
  type GppElementKind,
} from "./element-ids";
import { gppLayoutSchema } from "./gpp-layout-schema";
import { gppShapeDocumentSchema, type GppShapeDocument } from "./gpp-shape-schema";

const FIXTURES = join(__dirname, "__fixtures__");
const WORKED_EXAMPLE = gppShapeDocumentSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, "inquiry-response-watch.worked-example.gpp.json"), "utf8")),
);
const WORKED_LAYOUT = gppLayoutSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, "inquiry-response-watch.worked-example.layout.json"), "utf8")),
);

const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
const CASES = ALL_DEFINITIONS.map((definition) => [`${definition.key}@${definition.version}`, decompile(definition).document] as const);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** mulberry32, so every permutation below is reproducible from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

function withShuffledKeys<T>(value: T, random: () => number): T {
  if (Array.isArray(value)) return value.map((item) => withShuffledKeys(item, random)) as T;
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const key of shuffle(Object.keys(value), random)) copy[key] = withShuffledKeys((value as Record<string, unknown>)[key], random);
    return copy as T;
  }
  return value;
}

/** Interleaves stops of different kinds in a new order, keeping the order within each kind. */
function interleaveStopKinds(stops: GppShapeDocument["stopConditions"], random: () => number): GppShapeDocument["stopConditions"] {
  const queues = new Map<string, typeof stops>();
  for (const stop of stops) queues.set(stop.kind, [...(queues.get(stop.kind) ?? []), stop]);
  const kindOrder = shuffle(stops.map((stop) => stop.kind), random);
  return kindOrder.map((kind) => queues.get(kind)!.shift()!);
}

/**
 * id → the JSON of the element's home, so "same id, same element" is
 * checkable. The shape's home is the whole document, which a reordering
 * changes by definition, so its id alone is compared; a stage's home is
 * compared with its tools as a set, because their order is what changed.
 */
function idToHome(document: GppShapeDocument): Map<string, string> {
  const map = new Map<string, string>();
  for (const element of elementsOf(document)) {
    if (element.kind === "shape") {
      map.set(element.id, "");
      continue;
    }
    let node: unknown = document;
    for (const segment of element.segments) node = (node as Record<string | number, unknown>)[segment];
    map.set(element.id, JSON.stringify(node, (key, value: unknown) => (key === "tools" && Array.isArray(value) ? [...value].sort() : value)));
  }
  return map;
}

const sorted = (ids: readonly string[]) => [...ids].sort();

describe("the §9.1 derivation on the spec's worked example", () => {
  it("derives every element, in document order", () => {
    expect(elementIdsOf(WORKED_EXAMPLE)).toEqual([
      "shape:inquiry-response-watch@1.0.0",
      "trigger:escalation",
      "trigger:cadence",
      "stage:draft",
      "tool:draft:list_storefront_activity",
      "tool:draft:list_customer_accounts",
      "stage:send",
      "gate:send",
      "stop:success:1",
      "stop:failure:1",
      "stop:budget:1",
    ]);
  });

  it("the §4.3 sidecar's ids are exactly the derived ids of the elements the canvas places as nodes", () => {
    // The shape is the canvas itself and a capability chip renders inside its
    // stage's box, so neither has a node of its own in the sidecar.
    const unplaced = new Set<GppElementKind>(["shape", "tool"]);
    const placed = elementsOf(WORKED_EXAMPLE)
      .filter((element) => !unplaced.has(element.kind))
      .map((element) => element.id);
    expect(sorted(Object.keys(WORKED_LAYOUT.nodes))).toEqual(sorted(placed));
    expect(Object.keys(WORKED_LAYOUT.nodes).every((id) => elementIdsOf(WORKED_EXAMPLE).includes(id))).toBe(true);
  });

  it("each element records the JSON Pointer of its home", () => {
    const pointers = Object.fromEntries(elementsOf(WORKED_EXAMPLE).map((element) => [element.id, element.pointer]));
    expect(pointers).toMatchObject({
      "shape:inquiry-response-watch@1.0.0": "",
      "trigger:cadence": "/triggers/1",
      "stage:send": "/stages/1",
      "gate:send": "/stages/1/advance/gate",
      "tool:draft:list_customer_accounts": "/stages/0/tools/1",
      "stop:budget:1": "/stopConditions/2",
    });
  });

  it("infraCiKeyFor is gpp:<key>:<elementId>", () => {
    expect(infraCiKeyFor("inquiry-response-watch", "gate:send")).toBe("gpp:inquiry-response-watch:gate:send");
  });
});

describe("stops, gates, bindings and flow", () => {
  it("stop ordinals are 1-based per kind, in document order", () => {
    const document = clone(WORKED_EXAMPLE);
    const [success, failure, budget] = document.stopConditions;
    document.stopConditions = [success, failure, { ...success, condition: "Second success." }, budget, { ...failure, condition: "Second failure." }];
    expect(elementIdsOf(document).filter((id) => id.startsWith("stop:"))).toEqual([
      "stop:success:1",
      "stop:failure:1",
      "stop:success:2",
      "stop:budget:1",
      "stop:failure:2",
    ]);
  });

  it("an untyped governed decision still has a gate element, homed on its advance", () => {
    const document = clone(WORKED_EXAMPLE);
    const advance = document.stages[1].advance;
    if (advance.kind === "governed-decision") delete advance.gate;
    expect(elementsOf(document).find((element) => element.id === "gate:send")?.pointer).toBe("/stages/1/advance");
  });

  it("a status-change stage has no gate", () => {
    expect(elementIdsOf(WORKED_EXAMPLE)).not.toContain("gate:draft");
  });

  it("bindings, flow nodes and flow edges", () => {
    const document = clone(WORKED_EXAMPLE);
    document.stages[0].binding = { id: "draft-reads", version: 2, enforcement: "shadow" };
    document.flow = {
      nodes: [{ id: "fork", type: "parallel-split" }],
      edges: [{ from: "draft", to: "send" }],
    };
    expect(elementIdsOf(document)).toEqual(expect.arrayContaining(["binding:draft-reads@2", "node:fork", "edge:draft->send"]));
  });
});

describe("ids are stable across reorderings that keep identity (every registered shape)", () => {
  it.each(CASES)("%s", (_id, document) => {
    const before = idToHome(document);
    expect(before.size, "ids are unique within the document").toBe(elementIdsOf(document).length);

    for (const seed of [1, 2, 3]) {
      const random = seededRandom(seed);
      const reordered = clone(document);
      reordered.triggers = shuffle(reordered.triggers, random);
      reordered.stages = shuffle(reordered.stages, random);
      for (const stage of reordered.stages) if (stage.tools) stage.tools = shuffle(stage.tools, random);
      reordered.stopConditions = interleaveStopKinds(reordered.stopConditions, random);

      // Same ids, and each id still names the same element.
      expect(idToHome(reordered)).toEqual(before);
      // Object key order changes nothing, not even the order of the list.
      expect(elementIdsOf(withShuffledKeys(document, random))).toEqual(elementIdsOf(document));
    }
  });
});

describe("ids change exactly when identity changes", () => {
  it("renaming a stage moves its stage, gate and tool ids, and no others", () => {
    const document = clone(WORKED_EXAMPLE);
    document.stages[1].key = "deliver";
    const changed = elementIdsOf(document).filter((id) => !elementIdsOf(WORKED_EXAMPLE).includes(id));
    const gone = elementIdsOf(WORKED_EXAMPLE).filter((id) => !elementIdsOf(document).includes(id));
    expect(changed).toEqual(["stage:deliver", "gate:deliver"]);
    expect(gone).toEqual(["stage:send", "gate:send"]);

    document.stages[0].key = "compose";
    expect(elementIdsOf(document)).toEqual(
      expect.arrayContaining(["tool:compose:list_storefront_activity", "tool:compose:list_customer_accounts"]),
    );
  });

  it("renaming a tool, bumping the shape version or a binding version changes that id", () => {
    const document = clone(WORKED_EXAMPLE);
    document.stages[0].tools = ["list_storefront_activity", "list_customer_accounts_v2"];
    document.version = "1.1.0";
    document.stages[0].binding = { id: "draft-reads", version: 1, enforcement: "shadow" };
    const ids = elementIdsOf(document);
    expect(ids).toContain("tool:draft:list_customer_accounts_v2");
    expect(ids).toContain("shape:inquiry-response-watch@1.1.0");
    expect(ids).toContain("binding:draft-reads@1");

    document.stages[0].binding = { id: "draft-reads", version: 2, enforcement: "shadow" };
    expect(elementIdsOf(document)).toContain("binding:draft-reads@2");
    expect(elementIdsOf(document)).not.toContain("binding:draft-reads@1");
  });

  it("swapping two stops of the same kind swaps which stop each ordinal names", () => {
    const document = clone(WORKED_EXAMPLE);
    const [success] = document.stopConditions;
    document.stopConditions.push({ ...success, condition: "Second success." });
    const before = idToHome(document);
    const swapped = clone(document);
    [swapped.stopConditions[0], swapped.stopConditions[3]] = [swapped.stopConditions[3], swapped.stopConditions[0]];
    const after = idToHome(swapped);
    expect(sorted([...after.keys()])).toEqual(sorted([...before.keys()]));
    expect(after.get("stop:success:1")).toBe(before.get("stop:success:2"));
    expect(after.get("stop:success:2")).toBe(before.get("stop:success:1"));
  });
});

describe("derivation over unvalidated input, and nearest-element lookup", () => {
  it("never throws on a value that is not a document", () => {
    for (const value of [null, 3, "x", [], {}, { stages: "nope" }, { stages: [null, { key: 4 }], stopConditions: [{ kind: 1 }] }]) {
      expect(elementsOfValue(value)).toEqual([]);
    }
  });

  it("finds the deepest enclosing element, or the document", () => {
    const elements = elementsOf(WORKED_EXAMPLE);
    expect(nearestElementId(elements, ["stages", 1, "advance", "gate", "mode"])).toBe("gate:send");
    expect(nearestElementId(elements, ["stages", 1, "advance", "condition"])).toBe("stage:send");
    expect(nearestElementId(elements, ["stages", 0, "tools", 0])).toBe("tool:draft:list_storefront_activity");
    expect(nearestElementId(elements, ["description"])).toBe("shape:inquiry-response-watch@1.0.0");
    expect(nearestElementId(elements, [])).toBe("shape:inquiry-response-watch@1.0.0");
    expect(nearestElementId([], ["stages", 0])).toBe(GPP_DOCUMENT_ELEMENT_ID);
    // A segment-wise prefix, not a string prefix: /stages/1 does not enclose /stages/10.
    expect(nearestElementId(elements, ["stages", 10])).toBe("shape:inquiry-response-watch@1.0.0");
  });
});
