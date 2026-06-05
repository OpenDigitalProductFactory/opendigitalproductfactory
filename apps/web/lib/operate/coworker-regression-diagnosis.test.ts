import { describe, expect, it } from "vitest";
import {
  buildCoworkerRegressionDiagnosis,
  type CoworkerRegressionDiagnosisInput,
} from "./coworker-regression-diagnosis";

/** A fully-populated, benign turn; override per case to trigger one rule. */
function baseInput(
  overrides: Partial<CoworkerRegressionDiagnosisInput> = {},
): CoworkerRegressionDiagnosisInput {
  return {
    routeContext: "/platform/ai",
    taskType: "conversation",
    dispatches: 1,
    nudges: 0,
    toolsAttached: false,
    executedTools: 0,
    totalMs: 5000,
    dispatchMs: 1000,
    providerId: "anthropic",
    modelId: "claude-x",
    ...overrides,
  };
}

describe("buildCoworkerRegressionDiagnosis", () => {
  describe("nudge-redispatch-loop", () => {
    it("fires when nudges > 0 and dispatches > 1", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({ nudges: 2, dispatches: 3 }),
      );
      expect(diagnosis.probableCause).toBe("nudge-redispatch-loop");
      expect(diagnosis.summary).toContain("nudge-redispatch-loop");
      expect(diagnosis.metrics.nudges).toBe(2);
      expect(diagnosis.metrics.dispatches).toBe(3);
    });

    it("wins over the tool-surface rule when both would match", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          nudges: 1,
          dispatches: 2,
          toolsAttached: true,
          executedTools: 0,
        }),
      );
      expect(diagnosis.probableCause).toBe("nudge-redispatch-loop");
    });

    it("does not fire on a single dispatch even with a nudge", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({ nudges: 1, dispatches: 1, dispatchMs: 4500 }),
      );
      expect(diagnosis.probableCause).not.toBe("nudge-redispatch-loop");
    });
  });

  describe("full-tool-surface-on-conversational-turn", () => {
    it("fires when tools attached, none executed, conversational, non-/build route", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          toolsAttached: true,
          executedTools: 0,
          taskType: "conversation",
          routeContext: "/platform/ai",
        }),
      );
      expect(diagnosis.probableCause).toBe(
        "full-tool-surface-on-conversational-turn",
      );
      expect(diagnosis.summary).toContain(
        "full-tool-surface-on-conversational-turn",
      );
    });

    it("fires when taskType is missing (null) on a non-/build route", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          toolsAttached: true,
          executedTools: 0,
          taskType: null,
          routeContext: "/platform/ai",
        }),
      );
      expect(diagnosis.probableCause).toBe(
        "full-tool-surface-on-conversational-turn",
      );
    });

    it("does NOT fire on a /build route (tools expected there)", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          toolsAttached: true,
          executedTools: 0,
          taskType: "conversation",
          routeContext: "/build/123",
          dispatchMs: 1000,
        }),
      );
      expect(diagnosis.probableCause).not.toBe(
        "full-tool-surface-on-conversational-turn",
      );
    });

    it("does NOT fire when a tool actually executed", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          toolsAttached: true,
          executedTools: 1,
          taskType: "conversation",
        }),
      );
      expect(diagnosis.probableCause).not.toBe(
        "full-tool-surface-on-conversational-turn",
      );
    });
  });

  describe("slow-provider-dispatch", () => {
    it("fires when dispatch dominates the turn duration and provider is known", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          totalMs: 10000,
          dispatchMs: 9000,
          providerId: "anthropic",
          modelId: "claude-x",
        }),
      );
      expect(diagnosis.probableCause).toBe("slow-provider-dispatch");
      expect(diagnosis.summary).toContain("slow-provider-dispatch");
      expect(diagnosis.summary).toContain("anthropic/claude-x");
    });

    it("does NOT fire when dispatch is not dominant", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({ totalMs: 10000, dispatchMs: 2000, executedTools: 0 }),
      );
      expect(diagnosis.probableCause).not.toBe("slow-provider-dispatch");
    });
  });

  describe("tool-call-exploration", () => {
    it("fires when executedTools is high and dispatch is not dominant", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          executedTools: 5,
          toolsAttached: true,
          totalMs: 10000,
          dispatchMs: 2000,
        }),
      );
      expect(diagnosis.probableCause).toBe("tool-call-exploration");
      expect(diagnosis.summary).toContain("tool-call-exploration");
      expect(diagnosis.metrics.executedTools).toBe(5);
    });

    it("yields slow-provider-dispatch (not tool-call-exploration) when dispatch dominates despite many tools", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          executedTools: 5,
          toolsAttached: true,
          totalMs: 10000,
          dispatchMs: 9000,
        }),
      );
      expect(diagnosis.probableCause).toBe("slow-provider-dispatch");
    });
  });

  describe("insufficient-evidence", () => {
    it("fires when the core turn surface is entirely missing", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis({
        routeContext: null,
        taskType: null,
        dispatches: null,
        nudges: null,
        toolsAttached: null,
        executedTools: null,
        totalMs: null,
        dispatchMs: null,
        providerId: null,
        modelId: null,
      });
      expect(diagnosis.probableCause).toBe("insufficient-evidence");
      expect(diagnosis.summary).toContain("Insufficient evidence");
      expect(diagnosis.metrics.dispatches).toBeNull();
    });

    it("fires as a fallthrough when facts exist but no positive rule matches", () => {
      const diagnosis = buildCoworkerRegressionDiagnosis(
        baseInput({
          dispatches: 1,
          nudges: 0,
          toolsAttached: false,
          executedTools: 0,
          totalMs: 10000,
          dispatchMs: 2000, // not dominant
          providerId: "anthropic",
          modelId: "claude-x",
        }),
      );
      expect(diagnosis.probableCause).toBe("insufficient-evidence");
    });
  });

  it("always echoes the provided metrics regardless of cause", () => {
    const diagnosis = buildCoworkerRegressionDiagnosis(
      baseInput({ nudges: 2, dispatches: 3 }),
    );
    expect(diagnosis.metrics).toEqual({
      dispatches: 3,
      nudges: 2,
      toolsAttached: false,
      executedTools: 0,
      totalMs: 5000,
      taskType: "conversation",
      providerId: "anthropic",
      modelId: "claude-x",
    });
  });
});
