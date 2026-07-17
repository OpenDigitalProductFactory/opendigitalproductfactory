import { describe, it, expect } from "vitest";
import { measureToolFidelity, GOLDEN_CASES, type RunTurnFn } from "./tool-fidelity-harness";
import { deriveMeasuredToolCeiling } from "./tool-fidelity-policy";

describe("measureToolFidelity", () => {
  it("has a non-empty golden set covering the taxonomy", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThan(0);
    expect(new Set(GOLDEN_CASES.map((c) => c.taskClass)).size).toBeGreaterThanOrEqual(3);
  });

  it("produces a fidelity curve that locates a model's cliff", async () => {
    // Fake model: selects the correct tool reliably at <=24 tools, then collapses
    // (picks nothing) above 24 — a realistic small-local-model cliff.
    const runTurn: RunTurnFn = async ({ surfaceSize, taskClass }) => {
      if (surfaceSize <= 24) {
        const correct = GOLDEN_CASES.find((c) => c.taskClass === taskClass)!.correctToolNames[0];
        return { calledTool: correct };
      }
      return { calledTool: null };
    };
    const samples = await measureToolFidelity({ surfaceSizes: [15, 24, 32, 48], runTurn });
    expect(samples.find((s) => s.surfaceSize === 15)!.accuracy).toBe(1);
    expect(samples.find((s) => s.surfaceSize === 24)!.accuracy).toBe(1);
    expect(samples.find((s) => s.surfaceSize === 32)!.accuracy).toBe(0);
    // The derived ceiling from this curve is the cliff (24), not the window.
    expect(deriveMeasuredToolCeiling(samples, { minSampleCount: 1 })).toBe(24);
  });

  it("scores a wrong-tool selection as incorrect", async () => {
    const runTurn: RunTurnFn = async () => ({ calledTool: "some_unrelated_tool" });
    const samples = await measureToolFidelity({ surfaceSizes: [15], runTurn });
    expect(samples[0]!.accuracy).toBe(0);
  });
});
