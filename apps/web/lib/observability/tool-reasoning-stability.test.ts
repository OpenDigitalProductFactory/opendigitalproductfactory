import { describe, expect, it } from "vitest";

import {
  MIN_RECURRENCE_TO_JUDGE,
  summarizeToolReasoningStability,
  type ToolReasoningSample,
} from "./tool-reasoning-stability";

function samples(
  over: { agentId?: string; toolName?: string; inputShape?: string },
  outputs: { outputDigest: string; success?: boolean }[],
): ToolReasoningSample[] {
  return outputs.map((o) => ({
    agentId: over.agentId ?? "agt",
    toolName: over.toolName ?? "tool",
    inputShape: over.inputShape ?? "shape",
    outputDigest: o.outputDigest,
    success: o.success ?? true,
  }));
}

function repeat(n: number, outputDigest: string, success = true) {
  return Array.from({ length: n }, () => ({ outputDigest, success }));
}

describe("summarizeToolReasoningStability", () => {
  it("returns insufficient-data below the recurrence floor", () => {
    const rows = summarizeToolReasoningStability(samples({}, repeat(MIN_RECURRENCE_TO_JUDGE - 1, "X")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("insufficient-data");
    expect(rows[0]!.recurrence).toBe(MIN_RECURRENCE_TO_JUDGE - 1);
  });

  it("flags a recurring, low-variance, high-success pattern as stabilized (codify candidate)", () => {
    const rows = summarizeToolReasoningStability(samples({}, repeat(20, "SAME")));
    expect(rows[0]!.verdict).toBe("stabilized");
    expect(rows[0]!.recurrence).toBe(20);
    expect(rows[0]!.distinctOutputs).toBe(1);
    expect(rows[0]!.varianceRatio).toBe(0.05);
    expect(rows[0]!.successRate).toBe(1);
  });

  it("keeps a high-variance pattern as variable (genuine AI judgment, don't codify)", () => {
    const outs = Array.from({ length: 20 }, (_, i) => ({ outputDigest: `O${i}` })); // all distinct → ratio 1.0
    const rows = summarizeToolReasoningStability(samples({}, outs));
    expect(rows[0]!.verdict).toBe("variable");
    expect(rows[0]!.varianceRatio).toBe(1);
  });

  it("keeps a consistent-but-failing pattern as variable (never codify broken reasoning)", () => {
    const outs = [...repeat(10, "SAME", true), ...repeat(10, "SAME", false)]; // 50% success
    const rows = summarizeToolReasoningStability(samples({}, outs));
    expect(rows[0]!.distinctOutputs).toBe(1);
    expect(rows[0]!.successRate).toBe(0.5);
    expect(rows[0]!.verdict).toBe("variable");
  });

  it("groups distinct (agent × tool × input-shape) signatures separately", () => {
    const rows = summarizeToolReasoningStability([
      ...samples({ agentId: "a1", toolName: "t1", inputShape: "s1" }, repeat(20, "SAME")),
      ...samples({ agentId: "a2", toolName: "t1", inputShape: "s1" }, repeat(5, "SAME")),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.agentId === "a1")!.verdict).toBe("stabilized");
    expect(rows.find((r) => r.agentId === "a2")!.verdict).toBe("insufficient-data");
  });

  it("orders codify candidates first", () => {
    const rows = summarizeToolReasoningStability([
      ...samples({ inputShape: "variable" }, Array.from({ length: 20 }, (_, i) => ({ outputDigest: `O${i}` }))),
      ...samples({ inputShape: "stable" }, repeat(20, "SAME")),
    ]);
    expect(rows[0]!.inputShape).toBe("stable");
    expect(rows[0]!.verdict).toBe("stabilized");
  });

  it("returns an empty array for no samples", () => {
    expect(summarizeToolReasoningStability([])).toEqual([]);
  });
});
