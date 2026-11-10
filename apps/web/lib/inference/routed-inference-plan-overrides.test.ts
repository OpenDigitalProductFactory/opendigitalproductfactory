import { describe, expect, it } from "vitest";
import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";
import { applyCallerExecutionPlanOverrides } from "./routed-inference-plan-overrides";

function plan(): RoutedExecutionPlan {
  return {
    providerId: "openai",
    modelId: "gpt-test",
    recipeId: null,
    contractFamily: "sync.review",
    executionAdapter: "chat",
    maxTokens: 1024,
    providerSettings: { temperatureSource: "recipe" },
    toolPolicy: { toolChoice: "auto", allowParallelToolCalls: false },
    responsePolicy: {},
  };
}

describe("applyCallerExecutionPlanOverrides", () => {
  it("clamps an output allowance without increasing a stricter existing plan", () => {
    expect(applyCallerExecutionPlanOverrides(plan(), { maxOutputTokens: 128 }).maxTokens).toBe(128);
    expect(applyCallerExecutionPlanOverrides(plan(), { maxOutputTokens: 4096 }).maxTokens).toBe(1024);
    expect(applyCallerExecutionPlanOverrides(plan(), {}).maxTokens).toBe(1024);
  });

  it.each([NaN, 0, -1, 1.5])("refuses invalid output allowance %s", value => {
    expect(() => applyCallerExecutionPlanOverrides(plan(), { maxOutputTokens: value })).toThrow();
  });

  it("overrides recipe auto tool choice after plan resolution", () => {
    expect(applyCallerExecutionPlanOverrides(plan(), { toolChoice: "required" })).toMatchObject({
      toolPolicy: { toolChoice: "required", allowParallelToolCalls: false },
    });
  });

  it("preserves caller effort and unrelated recipe policy", () => {
    expect(applyCallerExecutionPlanOverrides(plan(), { effort: "high" })).toMatchObject({
      providerSettings: { effort: "high", temperatureSource: "recipe" },
      toolPolicy: { toolChoice: "auto", allowParallelToolCalls: false },
    });
  });

  it("binds an explicitly delegated terminal writer without weakening tool choice", () => {
    expect(applyCallerExecutionPlanOverrides(plan(), {
      toolChoice: "required",
      terminalWriterToolName: "record_initiative_evidence",
    })).toMatchObject({
      toolPolicy: { toolChoice: "required", allowParallelToolCalls: false },
      responsePolicy: { terminalWriterToolName: "record_initiative_evidence" },
    });
  });
});
