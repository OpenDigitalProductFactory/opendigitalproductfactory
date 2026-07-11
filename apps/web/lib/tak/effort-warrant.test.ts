import { describe, it, expect } from "vitest";
import {
  deriveEffortWarrant,
  EFFORT_ITERATION_CEILING,
  type EffortLevel,
} from "./effort-warrant";

const LEVELS: EffortLevel[] = ["minimal", "low", "medium", "high"];

describe("deriveEffortWarrant", () => {
  it("passes the content-classifier reasoningDepth straight through as the level", () => {
    for (const depth of LEVELS) {
      const w = deriveEffortWarrant({ reasoningDepth: depth });
      expect(w.level).toBe(depth);
      expect(w.reasoningDepth).toBe(depth);
      expect(w.signals).toContain(`depth:${depth}`);
    }
  });

  it("co-tunes every knob monotonically with the level", () => {
    const warrants = LEVELS.map((d) => deriveEffortWarrant({ reasoningDepth: d }));
    for (let i = 1; i < warrants.length; i++) {
      const lo = warrants[i - 1]!;
      const hi = warrants[i]!;
      expect(hi.maxIterations).toBeGreaterThanOrEqual(lo.maxIterations);
      expect(hi.maxDurationMs).toBeGreaterThanOrEqual(lo.maxDurationMs);
      expect(hi.toolBudgetTarget).toBeGreaterThanOrEqual(lo.toolBudgetTarget);
    }
  });

  it("a minimal turn is strictly leaner than a high turn on all knobs", () => {
    const min = deriveEffortWarrant({ reasoningDepth: "minimal" });
    const high = deriveEffortWarrant({ reasoningDepth: "high" });
    expect(min.maxIterations).toBeLessThan(high.maxIterations);
    expect(min.maxDurationMs).toBeLessThan(high.maxDurationMs);
    expect(min.toolBudgetTarget).toBeLessThan(high.toolBudgetTarget);
  });

  it("never exceeds the hard iteration safety ceiling", () => {
    for (const d of LEVELS) {
      const w = deriveEffortWarrant({ reasoningDepth: d });
      expect(w.maxIterations).toBeLessThanOrEqual(EFFORT_ITERATION_CEILING);
    }
    expect(deriveEffortWarrant({ reasoningDepth: "high" }).maxIterations).toBe(
      EFFORT_ITERATION_CEILING,
    );
  });

  it("floors the level at high when heavy build/plan tools are attached", () => {
    const w = deriveEffortWarrant({
      reasoningDepth: "minimal",
      availableToolNames: ["send_message", "generate_code"],
    });
    expect(w.level).toBe("high");
    expect(w.maxIterations).toBe(EFFORT_ITERATION_CEILING);
    expect(w.maxDurationMs).toBe(600_000);
    expect(w.signals).toContain("heavy-tools");
  });

  it("does not raise for ordinary (non-heavy) tools", () => {
    const w = deriveEffortWarrant({
      reasoningDepth: "minimal",
      availableToolNames: ["list_backlog_items", "get_backlog_item"],
    });
    expect(w.level).toBe("minimal");
  });

  it("falls back to a taskType proxy when reasoningDepth is absent", () => {
    expect(deriveEffortWarrant({ taskType: "conversation" }).level).toBe("minimal");
    expect(deriveEffortWarrant({ taskType: "build" }).level).toBe("high");
    expect(deriveEffortWarrant({ taskType: "analysis" }).level).toBe("medium");
    expect(deriveEffortWarrant({ taskType: "conversation" }).signals).toContain(
      "taskType:conversation",
    );
  });

  it("defaults to low when no signal is present", () => {
    const w = deriveEffortWarrant({});
    expect(w.level).toBe("low");
    expect(w.signals).toContain("default:low");
  });

  it("raises (never lowers) the level for a long input", () => {
    const raised = deriveEffortWarrant({ reasoningDepth: "low", messageChars: 4000 });
    expect(raised.level).toBe("medium");
    expect(raised.signals).toContain("long-input");
    // Already-high stays high; long input cannot push past the ceiling.
    expect(deriveEffortWarrant({ reasoningDepth: "high", messageChars: 4000 }).level).toBe("high");
    // A short high-effort turn is unaffected.
    expect(deriveEffortWarrant({ reasoningDepth: "minimal", messageChars: 10 }).level).toBe(
      "minimal",
    );
  });

  it("maps each level to a distinct context tier", () => {
    expect(deriveEffortWarrant({ reasoningDepth: "minimal" }).contextTier).toBe("basic");
    expect(deriveEffortWarrant({ reasoningDepth: "low" }).contextTier).toBe("adequate");
    expect(deriveEffortWarrant({ reasoningDepth: "medium" }).contextTier).toBe("strong");
    expect(deriveEffortWarrant({ reasoningDepth: "high" }).contextTier).toBe("frontier");
  });
});
