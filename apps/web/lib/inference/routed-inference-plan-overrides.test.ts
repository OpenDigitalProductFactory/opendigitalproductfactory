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
