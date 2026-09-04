import { describe, expect, it } from "vitest";

import { WORK_CAPSULE_WORKROOM_SHAPES } from "@/lib/work-capsules";

import { WORKROOM_SHAPE_KEYS } from "./room-shapes";

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
