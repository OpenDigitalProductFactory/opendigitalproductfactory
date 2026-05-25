/**
 * Tests for the MCP tool wait-budget registry (BI-QUIESCE-005).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  TOOL_WAIT_BUDGETS,
  DEFAULT_TOOL_BUDGET,
  _resetWarnedTools,
  getToolBudget,
  sumWaitBudgets,
} from "./tool-timeouts";

beforeEach(() => {
  _resetWarnedTools();
});

describe("TOOL_WAIT_BUDGETS registry", () => {
  it("includes start_build as killable:false (spec §6.6 example)", () => {
    expect(TOOL_WAIT_BUDGETS.start_build.killable).toBe(false);
  });

  it("includes start_deliberation as killable:true with multi-minute max", () => {
    const b = TOOL_WAIT_BUDGETS.start_deliberation;
    expect(b.killable).toBe(true);
    expect(b.maxMs).toBeGreaterThanOrEqual(60_000);
  });

  it("marks long batch jobs (discovery sweep, hive scout) as killable:false", () => {
    expect(TOOL_WAIT_BUDGETS.ops_full_discovery_sweep.killable).toBe(false);
    expect(TOOL_WAIT_BUDGETS.run_hive_scout_ingest.killable).toBe(false);
  });

  it("every entry has typicalMs <= maxMs (sanity invariant)", () => {
    for (const [name, b] of Object.entries(TOOL_WAIT_BUDGETS)) {
      expect(b.typicalMs, `${name} typicalMs <= maxMs`).toBeLessThanOrEqual(b.maxMs);
    }
  });

  it("every entry has positive durations (sanity)", () => {
    for (const [name, b] of Object.entries(TOOL_WAIT_BUDGETS)) {
      expect(b.typicalMs, `${name} typicalMs > 0`).toBeGreaterThan(0);
      expect(b.maxMs, `${name} maxMs > 0`).toBeGreaterThan(0);
    }
  });
});

describe("getToolBudget", () => {
  it("returns the registered budget for known tools", () => {
    expect(getToolBudget("start_build")).toEqual(TOOL_WAIT_BUDGETS.start_build);
  });

  it("returns DEFAULT_TOOL_BUDGET for unknown tools", () => {
    expect(getToolBudget("totally-fake-tool-name")).toEqual(DEFAULT_TOOL_BUDGET);
  });

  it("warns once per unknown tool (registry gap signal)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getToolBudget("brand-new-tool");
    getToolBudget("brand-new-tool"); // second call: no warning
    getToolBudget("another-new-tool"); // different name: warns
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("sumWaitBudgets", () => {
  it("sums typical + max correctly", () => {
    const out = sumWaitBudgets(["start_build", "start_deliberation"]);
    expect(out.typicalMs).toBe(
      TOOL_WAIT_BUDGETS.start_build.typicalMs + TOOL_WAIT_BUDGETS.start_deliberation.typicalMs,
    );
    expect(out.maxMs).toBe(
      TOOL_WAIT_BUDGETS.start_build.maxMs + TOOL_WAIT_BUDGETS.start_deliberation.maxMs,
    );
  });

  it("flags anyKillableFalse when at least one tool is non-killable", () => {
    expect(sumWaitBudgets(["start_build"]).anyKillableFalse).toBe(true);
    expect(sumWaitBudgets(["start_deliberation"]).anyKillableFalse).toBe(false);
    expect(sumWaitBudgets(["start_build", "start_deliberation"]).anyKillableFalse).toBe(true);
  });

  it("handles empty list", () => {
    const out = sumWaitBudgets([]);
    expect(out.typicalMs).toBe(0);
    expect(out.maxMs).toBe(0);
    expect(out.anyKillableFalse).toBe(false);
  });

  it("treats unknown tools as killable per DEFAULT_TOOL_BUDGET", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = sumWaitBudgets(["unknown-tool"]);
    expect(out.anyKillableFalse).toBe(false);
    expect(out.maxMs).toBe(DEFAULT_TOOL_BUDGET.maxMs);
    warn.mockRestore();
  });
});
