import { describe, it, expect } from "vitest";
import {
  estimateToolDefinitionTokens,
  assessToolSurface,
  computeToolSelectionAccuracy,
  resolveLocalToolCeiling,
  LOCAL_TOOL_SELECTION_CLIFF,
} from "./context-economy-metrics";

describe("resolveLocalToolCeiling", () => {
  it("falls back to the selection cliff without measured evidence", () => {
    expect(resolveLocalToolCeiling(null)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
    expect(resolveLocalToolCeiling(undefined)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
    expect(resolveLocalToolCeiling(0)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
    expect(resolveLocalToolCeiling(-5)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
    expect(resolveLocalToolCeiling(Number.NaN)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
    expect(resolveLocalToolCeiling(Number.POSITIVE_INFINITY)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
  });

  it("follows a positive measured ceiling, floored", () => {
    expect(resolveLocalToolCeiling(30)).toBe(30);
    expect(resolveLocalToolCeiling(30.9)).toBe(30);
    expect(resolveLocalToolCeiling(1)).toBe(1);
  });

  it("is the ONE derivation the budget and the routing gate share (BI-A8BFEFCE)", () => {
    // The attachment budget and callWithFallbackChain both call this. When they
    // derived the ceiling separately the budget honoured measured fidelity and
    // the gate hardcoded the cliff, so a budgeted surface could be refused for
    // exceeding a limit nothing else applied.
    expect(resolveLocalToolCeiling(null)).toBe(LOCAL_TOOL_SELECTION_CLIFF);
    expect(LOCAL_TOOL_SELECTION_CLIFF).toBe(15);
  });
});

describe("estimateToolDefinitionTokens", () => {
  it("is 0 for an empty/absent surface", () => {
    expect(estimateToolDefinitionTokens([])).toBe(0);
    expect(estimateToolDefinitionTokens(null)).toBe(0);
    expect(estimateToolDefinitionTokens(undefined)).toBe(0);
  });

  it("scales ~chars/4 with the serialized definitions", () => {
    const tools = [{ function: { name: "x", description: "y".repeat(396) } }];
    const est = estimateToolDefinitionTokens(tools);
    // JSON is ~ 400+ chars → ~100+ tokens; assert the order of magnitude.
    expect(est).toBeGreaterThan(100);
    expect(est).toBeLessThan(200);
  });
});

describe("assessToolSurface", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ function: { name: `t${i}`, description: "d" } }));

  it("a lean surface under the cliff is zone=lean", () => {
    const a = assessToolSurface({ tools: mk(8) });
    expect(a.toolCount).toBe(8);
    expect(a.exceedsLocalCliff).toBe(false);
    expect(a.zone).toBe("lean");
    expect(a.windowShare).toBeNull();
  });

  it("cautions as the count approaches the cliff", () => {
    expect(assessToolSurface({ tools: mk(12) }).zone).toBe("caution");
  });

  it("overloads once past the local selection cliff", () => {
    const a = assessToolSurface({ tools: mk(LOCAL_TOOL_SELECTION_CLIFF + 1) });
    expect(a.exceedsLocalCliff).toBe(true);
    expect(a.zone).toBe("overload");
  });

  it("overloads when definitions eat a large share of a known window", () => {
    // 5 tools (under the cliff) but a tiny window → big windowShare → overload.
    const a = assessToolSurface({ tools: mk(5), windowTokens: 200 });
    expect(a.exceedsLocalCliff).toBe(false);
    expect(a.windowShare).not.toBeNull();
    expect(a.zone).toBe("overload");
  });

  it("a known LARGE window supersedes the raw-count cliff (BI-3346DC28)", () => {
    // 20 tools (past the cliff) but they occupy a trivial share of a big cloud
    // window → genuinely lean for the model that serves it, NOT overload.
    const a = assessToolSurface({ tools: mk(LOCAL_TOOL_SELECTION_CLIFF + 5), windowTokens: 200_000 });
    expect(a.exceedsLocalCliff).toBe(true); // still reported for observability
    expect(a.windowShare).toBeLessThan(0.15);
    expect(a.zone).toBe("lean");
  });

  it("the same surface in a SMALL window is still overload (via windowShare)", () => {
    const a = assessToolSurface({ tools: mk(LOCAL_TOOL_SELECTION_CLIFF + 5), windowTokens: 600 });
    expect(a.windowShare).toBeGreaterThanOrEqual(0.25);
    expect(a.zone).toBe("overload");
  });
});

describe("computeToolSelectionAccuracy", () => {
  it("is 1.0 (nothing failed) when there were no calls", () => {
    expect(computeToolSelectionAccuracy([]).accuracy).toBe(1);
    expect(computeToolSelectionAccuracy(null).total).toBe(0);
  });

  it("computes overall and per-tool accuracy", () => {
    const acc = computeToolSelectionAccuracy([
      { toolName: "search_knowledge", success: true },
      { toolName: "search_knowledge", success: false },
      { toolName: "query_backlog", success: true },
    ]);
    expect(acc.total).toBe(3);
    expect(acc.succeeded).toBe(2);
    expect(acc.accuracy).toBeCloseTo(2 / 3);
    expect(acc.perTool["search_knowledge"]).toEqual({ total: 2, succeeded: 1, accuracy: 0.5 });
    expect(acc.perTool["query_backlog"]).toEqual({ total: 1, succeeded: 1, accuracy: 1 });
  });

  it("ignores malformed samples", () => {
    const acc = computeToolSelectionAccuracy([
      { toolName: "ok", success: true },
      // @ts-expect-error intentional malformed sample
      { success: true },
    ]);
    expect(acc.total).toBe(1);
  });
});
