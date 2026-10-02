import { describe, expect, it } from "vitest";

import { WORK_CAPSULE_WORKROOM_SHAPES } from "@/lib/work-capsules";

import { GENERATED_WORK_SHAPES } from "./generated/index.generated";
import { WORKROOM_SHAPE_KEYS } from "./room-shapes";
import { getWorkShape, listWorkShapes } from "./work-shapes";

// EP-WORK-POSTURE (BI-8C54B216). The shape keys are declared twice on purpose:
// work-capsules is the lower layer and must not import from work-management, so
// the MCP write path mirrors the list rather than importing it. A mirror that
// can drift silently is a defect waiting to happen — a shape addable through
// one door and unknown to the other would be accepted at convene and then
// resolve to nothing. This test is the reason the mirror is safe.

describe("workroom shape key parity", () => {
  it("the write-path list and the definition list are identical, in the same order", () => {
    expect([...WORK_CAPSULE_WORKROOM_SHAPES]).toEqual([...WORKROOM_SHAPE_KEYS]);
  });

  it("neither list has duplicates", () => {
    expect(new Set(WORK_CAPSULE_WORKROOM_SHAPES).size).toBe(WORK_CAPSULE_WORKROOM_SHAPES.length);
    expect(new Set(WORKROOM_SHAPE_KEYS).size).toBe(WORKROOM_SHAPE_KEYS.length);
  });
});

// GPP Phase 3b (PR-3b-6, BI-6DA17863; design
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.5). A work shape is either hand-declared in a family file or compiled
// from a shape document, never both: a migrated shape's family file references
// its generated constant in place of the deleted literal, so the registry holds
// the generated object itself, once.
describe("work-shape keys: hand-declared xor generated", () => {
  it("no work-shape key is both hand-declared and generated", () => {
    const generatedKeys = new Set(GENERATED_WORK_SHAPES.map((shape) => shape.key));
    const handDeclared = listWorkShapes().filter((shape) => !GENERATED_WORK_SHAPES.includes(shape));
    expect(handDeclared.filter((shape) => generatedKeys.has(shape.key)).map((shape) => shape.key)).toEqual([]);
  });

  it("every generated shape is registered exactly once", () => {
    for (const generated of GENERATED_WORK_SHAPES) {
      expect(listWorkShapes().filter((shape) => shape === generated), generated.key).toHaveLength(1);
      expect(listWorkShapes().filter((shape) => shape.key === generated.key), generated.key).toHaveLength(1);
      expect(getWorkShape(generated.key)).toBe(generated);
    }
    expect(new Set(GENERATED_WORK_SHAPES.map((shape) => shape.key)).size).toBe(GENERATED_WORK_SHAPES.length);
  });
});
