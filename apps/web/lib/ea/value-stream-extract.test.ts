import { describe, expect, it } from "vitest";
import { buildValueStreamModel, VALUE_STREAM_PACKAGE_KEY, type ValueStreamRow } from "./value-stream-extract";

const ROWS: ValueStreamRow[] = [
  { kind: "value_stream", slug: "strategy-to-portfolio", name: "Strategy to Portfolio", parentSlug: null },
  { kind: "value_stream_stage", slug: "s2p-evaluate", name: "Evaluate", parentSlug: "strategy-to-portfolio" },
  { kind: "value_stream_stage", slug: "orphan-stage", name: "Orphan", parentSlug: "nonexistent" },
];

describe("buildValueStreamModel", () => {
  const model = buildValueStreamModel(ROWS);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("maps value streams to part_definitions and stages to part_usages", () => {
    expect(byKey.get(VALUE_STREAM_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("vstream:vs:strategy-to-portfolio")?.typeSlug).toBe("part_definition");
    expect(byKey.get("vstream:stage:s2p-evaluate")?.typeSlug).toBe("part_usage");
    expect(model.elements).toHaveLength(4); // pkg + 1 stream + 2 stages
  });

  it("contains a stage under its parent stream when the parent is known", () => {
    expect(model.relationships).toContainEqual({
      fromKey: "vstream:vs:strategy-to-portfolio",
      toKey: "vstream:stage:s2p-evaluate",
      relSlug: "contains",
    });
  });

  it("falls back to the package when a stage's parent stream is unknown", () => {
    expect(model.relationships).toContainEqual({
      fromKey: VALUE_STREAM_PACKAGE_KEY,
      toKey: "vstream:stage:orphan-stage",
      relSlug: "contains",
    });
  });

  it("declares the element/relationship types and soft-remove prefix it needs", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition", "part_usage"]);
    expect(model.relTypeSlugs).toEqual(["contains"]);
    expect(model.softRemovePrefix).toBe("vstream:");
  });
});
