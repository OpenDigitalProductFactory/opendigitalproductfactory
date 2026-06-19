import { describe, it, expect } from "vitest";
import {
  createExecutionPlan,
  updateStepStatus,
  openSteps,
  isPlanComplete,
  nextOpenStep,
  planProgress,
  renderPlanReminder,
  renderNoPlanReminder,
  applyPlanToolCall,
  planCompletionGate,
  executionPlanProviderTools,
  EXECUTION_PLAN_TOOL_DEFS,
  EXECUTION_PLAN_TOOL_NAMES,
  RECORD_PLAN_TOOL,
  UPDATE_PLAN_STEP_TOOL,
  type ExecutionPlan,
} from "./execution-plan";

describe("createExecutionPlan", () => {
  it("builds a plan with deterministic step ids from string steps", () => {
    const plan = createExecutionPlan({ goal: "ship feature", steps: ["read code", "write code", "test"] }, 0);
    expect(plan).not.toBeNull();
    expect(plan!.goal).toBe("ship feature");
    expect(plan!.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(plan!.steps.every((s) => s.status === "pending")).toBe(true);
    expect(plan!.createdAtIteration).toBe(0);
  });

  it("accepts object steps with a description field", () => {
    const plan = createExecutionPlan({ goal: "g", steps: [{ description: "do a thing" }] }, 2);
    expect(plan!.steps[0]).toMatchObject({ id: "s1", description: "do a thing", status: "pending" });
  });

  it("drops empty step descriptions and renumbers remaining ids", () => {
    const plan = createExecutionPlan({ goal: "g", steps: ["", "  ", "real step"] }, 0);
    expect(plan!.steps).toHaveLength(1);
    expect(plan!.steps[0]!.id).toBe("s1");
  });

  it("returns null when there are no usable steps", () => {
    expect(createExecutionPlan({ goal: "g", steps: [] }, 0)).toBeNull();
    expect(createExecutionPlan({ goal: "g", steps: "not an array" }, 0)).toBeNull();
    expect(createExecutionPlan({ goal: "g", steps: ["", ""] }, 0)).toBeNull();
  });

  it("caps steps at the maximum", () => {
    const many = Array.from({ length: 40 }, (_, i) => `step ${i}`);
    const plan = createExecutionPlan({ goal: "g", steps: many }, 0);
    expect(plan!.steps.length).toBeLessThanOrEqual(25);
  });
});

describe("updateStepStatus + progress", () => {
  const base = createExecutionPlan({ goal: "g", steps: ["a", "b", "c"] }, 0)!;

  it("does not mutate the input plan", () => {
    const next = updateStepStatus(base, "s1", "done", 1);
    expect(base.steps[0]!.status).toBe("pending");
    expect(next.steps[0]!.status).toBe("done");
    expect(next.updatedAtIteration).toBe(1);
  });

  it("is a no-op clone for an unknown step id", () => {
    const next = updateStepStatus(base, "s99", "done", 5);
    expect(next.steps).toEqual(base.steps);
    expect(next.updatedAtIteration).toBe(base.updatedAtIteration);
  });

  it("computes open/done/total and completion", () => {
    expect(planProgress(base)).toEqual({ done: 0, total: 3, open: 3 });
    let p = updateStepStatus(base, "s1", "done", 1);
    p = updateStepStatus(p, "s2", "skipped", 2);
    expect(planProgress(p)).toEqual({ done: 2, total: 3, open: 1 });
    expect(isPlanComplete(p)).toBe(false);
    p = updateStepStatus(p, "s3", "done", 3);
    expect(isPlanComplete(p)).toBe(true);
    expect(openSteps(p)).toHaveLength(0);
  });

  it("nextOpenStep prefers in_progress then first pending", () => {
    expect(nextOpenStep(base)!.id).toBe("s1");
    const p = updateStepStatus(base, "s2", "in_progress", 1);
    expect(nextOpenStep(p)!.id).toBe("s2");
  });
});

describe("renderPlanReminder", () => {
  it("renders progress, glyphs, and a next-step footer", () => {
    let plan = createExecutionPlan({ goal: "do work", steps: ["a", "b"] }, 0)!;
    plan = updateStepStatus(plan, "s1", "done", 1);
    const text = renderPlanReminder(plan);
    expect(text).toContain("(1/2 complete)");
    expect(text).toContain("[x] s1");
    expect(text).toContain("[ ] s2");
    expect(text).toContain("Next open step: s2");
  });

  it("renders a final-summary footer when complete", () => {
    let plan = createExecutionPlan({ goal: "g", steps: ["a"] }, 0)!;
    plan = updateStepStatus(plan, "s1", "done", 1);
    expect(renderPlanReminder(plan)).toContain("All steps are done");
  });

  it("renderNoPlanReminder tells the model to record a plan", () => {
    expect(renderNoPlanReminder()).toContain(RECORD_PLAN_TOOL);
  });
});

describe("applyPlanToolCall", () => {
  it("records a plan from record_execution_plan", () => {
    const { plan, result } = applyPlanToolCall(null, RECORD_PLAN_TOOL, { goal: "g", steps: ["a", "b"] }, 0);
    expect(result.success).toBe(true);
    expect(plan!.steps).toHaveLength(2);
  });

  it("rejects record_execution_plan with no steps", () => {
    const { plan, result } = applyPlanToolCall(null, RECORD_PLAN_TOOL, { goal: "g", steps: [] }, 0);
    expect(result.success).toBe(false);
    expect(plan).toBeNull();
  });

  it("updates a step and normalises status variants", () => {
    const created = applyPlanToolCall(null, RECORD_PLAN_TOOL, { goal: "g", steps: ["a"] }, 0).plan!;
    const { plan, result } = applyPlanToolCall(created, UPDATE_PLAN_STEP_TOOL, { stepId: "s1", status: "completed" }, 1);
    expect(result.success).toBe(true);
    expect(plan!.steps[0]!.status).toBe("done");
  });

  it("rejects update before a plan exists", () => {
    const { result } = applyPlanToolCall(null, UPDATE_PLAN_STEP_TOOL, { stepId: "s1", status: "done" }, 0);
    expect(result.success).toBe(false);
    expect(result.error).toBe("no_plan");
  });

  it("rejects an unknown step id and lists valid ids", () => {
    const created = applyPlanToolCall(null, RECORD_PLAN_TOOL, { goal: "g", steps: ["a"] }, 0).plan!;
    const { result } = applyPlanToolCall(created, UPDATE_PLAN_STEP_TOOL, { stepId: "s9", status: "done" }, 1);
    expect(result.success).toBe(false);
    expect(result.message).toContain("s1");
  });

  it("rejects an invalid status", () => {
    const created = applyPlanToolCall(null, RECORD_PLAN_TOOL, { goal: "g", steps: ["a"] }, 0).plan!;
    const { result } = applyPlanToolCall(created, UPDATE_PLAN_STEP_TOOL, { stepId: "s1", status: "banana" }, 1);
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_update");
  });
});

describe("planCompletionGate", () => {
  const incomplete: ExecutionPlan = createExecutionPlan({ goal: "g", steps: ["a", "b"] }, 0)!;
  const complete = updateStepStatus(updateStepStatus(incomplete, "s1", "done", 1), "s2", "done", 1);

  it("completes when there is no plan", () => {
    expect(planCompletionGate({ plan: null, planNudges: 0, maxPlanNudges: 2 }).action).toBe("complete");
  });

  it("completes when the plan is fully closed", () => {
    expect(planCompletionGate({ plan: complete, planNudges: 0, maxPlanNudges: 2 }).action).toBe("complete");
  });

  it("nudges toward the next open step when steps remain", () => {
    const gate = planCompletionGate({ plan: incomplete, planNudges: 0, maxPlanNudges: 2 });
    expect(gate.action).toBe("nudge");
    expect(gate.nudge).toContain("s1");
  });

  it("stops nudging once the budget is spent (no infinite standoff)", () => {
    expect(planCompletionGate({ plan: incomplete, planNudges: 2, maxPlanNudges: 2 }).action).toBe("complete");
  });
});

describe("tool definitions", () => {
  it("exposes exactly the two intrinsic plan tools with no capability gate", () => {
    expect([...EXECUTION_PLAN_TOOL_NAMES].sort()).toEqual([RECORD_PLAN_TOOL, UPDATE_PLAN_STEP_TOOL].sort());
    for (const def of EXECUTION_PLAN_TOOL_DEFS) {
      expect(def.requiredCapability).toBeNull();
      expect(def.sideEffect).toBe(false);
      expect(def.executionMode).toBe("immediate");
    }
  });

  it("emits OpenAI-wire-format provider tools matching the defs", () => {
    const provider = executionPlanProviderTools();
    expect(provider).toHaveLength(2);
    expect(provider[0]).toMatchObject({ type: "function", function: { name: RECORD_PLAN_TOOL } });
    expect((provider[1] as { function: { name: string } }).function.name).toBe(UPDATE_PLAN_STEP_TOOL);
  });
});
