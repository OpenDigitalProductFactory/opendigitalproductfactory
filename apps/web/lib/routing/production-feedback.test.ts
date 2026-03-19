import { describe, expect, it } from "vitest";
import {
  getDimensionsForTask,
  computeObservationDelta,
} from "./production-feedback";

describe("getDimensionsForTask", () => {
  it("returns reasoning for reasoning task", () => {
    const dims = getDimensionsForTask("reasoning");
    expect(dims).toEqual([{ dimension: "reasoning", weight: 1.0 }]);
  });
  it("returns primary + secondary for code-gen", () => {
    const dims = getDimensionsForTask("code-gen");
    expect(dims).toEqual([
      { dimension: "codegen", weight: 1.0 },
      { dimension: "instructionFollowing", weight: 0.5 },
    ]);
  });
  it("returns empty for unknown task type", () => {
    expect(getDimensionsForTask("unknown")).toEqual([]);
  });
  it("returns empty for undefined", () => {
    expect(getDimensionsForTask(undefined as unknown as string)).toEqual([]);
  });
});

describe("computeObservationDelta", () => {
  it("returns +8 for orchestrator score 5", () => {
    expect(computeObservationDelta(5)).toBe(8);
  });
  it("returns 0 for score 3 (neutral)", () => {
    expect(computeObservationDelta(3)).toBe(0);
  });
  it("returns -8 for score 1", () => {
    expect(computeObservationDelta(1)).toBe(-8);
  });
  it("returns -4 for score 2", () => {
    expect(computeObservationDelta(2)).toBe(-4);
  });
});
