import { describe, it, expect } from "vitest";
import {
  GOLDEN_TESTS,
  getTestsForDimension,
  getTestsForTaskType,
  GOLDEN_TEST_TASK_TYPES,
} from "./golden-tests";

describe("getTestsForTaskType (per-archetype golden sets)", () => {
  it("returns the codegen + instruction-following tests for code-gen, primary dimension first", () => {
    const tests = getTestsForTaskType("code-gen");
    expect(tests.length).toBeGreaterThan(0);
    // code-gen maps to codegen (1.0) then instructionFollowing (0.5).
    const dims = tests.map((t) => t.dimension);
    expect(dims).toContain("codegen");
    expect(dims).toContain("instructionFollowing");
    // primary (codegen) tests precede the secondary ones.
    expect(dims.indexOf("codegen")).toBeLessThan(dims.lastIndexOf("instructionFollowing"));
  });

  it("returns only the reasoning tests for the reasoning archetype", () => {
    const tests = getTestsForTaskType("reasoning");
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.every((t) => t.dimension === "reasoning")).toBe(true);
    expect(tests).toEqual(getTestsForDimension("reasoning"));
  });

  it("de-duplicates when two dimensions would surface the same test", () => {
    const tests = getTestsForTaskType("creative"); // conversational + reasoning
    const ids = tests.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns an empty set for an unknown task type (caller falls back to full sweep)", () => {
    expect(getTestsForTaskType("totally-unknown")).toEqual([]);
    expect(getTestsForTaskType("")).toEqual([]);
  });

  it("every known task type resolves to at least one golden test", () => {
    for (const taskType of GOLDEN_TEST_TASK_TYPES) {
      expect(getTestsForTaskType(taskType).length, taskType).toBeGreaterThan(0);
    }
  });

  it("only draws from the canonical GOLDEN_TESTS registry", () => {
    const allIds = new Set(GOLDEN_TESTS.map((t) => t.id));
    for (const taskType of GOLDEN_TEST_TASK_TYPES) {
      for (const t of getTestsForTaskType(taskType)) {
        expect(allIds.has(t.id)).toBe(true);
      }
    }
  });
});
