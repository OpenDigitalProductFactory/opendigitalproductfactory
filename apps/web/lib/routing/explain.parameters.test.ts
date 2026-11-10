// apps/web/lib/routing/explain.parameters.test.ts
//
// BI-B4081AA1: the explanation covered model choice only, so an operator could
// see why Qwen3 was picked and not that it was called at temperature 1.0.
import { describe, expect, it } from "vitest";
import { describeCallParameters } from "./explain";
import type { RouteDecision } from "./types";
import type { RoutedExecutionPlan } from "./recipe-types";

function decision(plan?: Partial<RoutedExecutionPlan>): RouteDecision {
  return {
    selectedEndpoint: "ep-1",
    selectedModelId: "qwen3.8-27b",
    reason: "",
    fitnessScore: 1,
    fallbackChain: [],
    candidates: [],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "code-gen",
    sensitivity: "internal",
    timestamp: new Date(),
    ...(plan
      ? {
          executionPlan: {
            providerId: "local",
            modelId: "qwen3.8-27b",
            recipeId: null,
            contractFamily: "sync.code_gen",
            executionAdapter: "chat",
            maxTokens: 4096,
            providerSettings: {},
            toolPolicy: {},
            responsePolicy: {},
            ...plan,
          } as RoutedExecutionPlan,
        }
      : {}),
  } as RouteDecision;
}

describe("describeCallParameters", () => {
  it("says nothing when there is no plan to describe", () => {
    expect(describeCallParameters(decision())).toBeNull();
  });

  it("names the temperature and why it is that value", () => {
    const text = describeCallParameters(
      decision({
        sampling: {
          values: { temperature: 0.6 },
          provenance: { temperature: "vendor" },
          mode: "thinking",
        },
      }),
    )!;
    expect(text).toContain("temperature 0.6");
    expect(text).toContain("the model's own published setting for reasoning mode");
  });

  it("reads a deterministic call in plain language", () => {
    const text = describeCallParameters(
      decision({
        sampling: { values: { temperature: 0 }, provenance: { temperature: "contract" }, mode: "default" },
      }),
    )!;
    expect(text).toContain("no variation");
    expect(text).toContain("what this kind of task needs");
  });

  it("reports extended reasoning when a provider expressed it", () => {
    const text = describeCallParameters(
      decision({ providerSettings: { thinkingConfig: { thinkingBudget: 4096 } } }),
    )!;
    expect(text).toContain("Extended reasoning was switched on");
  });

  it("states plainly when reasoning was asked for and could not be expressed", () => {
    const text = describeCallParameters(decision({ effortUnexpressed: true }))!;
    expect(text).toContain("no way to accept that instruction");
  });

  it("mentions constrained JSON decoding", () => {
    const text = describeCallParameters(decision({ responsePolicy: { strictSchema: true } }))!;
    expect(text).toContain("constrained to valid JSON");
  });

  it("accounts for settings the model refuses", () => {
    const text = describeCallParameters(
      decision({
        sampling: { values: {}, provenance: {}, mode: "default", dropped: ["temperature", "topP"] },
      }),
    )!;
    expect(text).toContain("2 setting(s) were left off");
  });

  it("falls back to the plan's top-level temperature when no sampling record exists", () => {
    const text = describeCallParameters(decision({ temperature: 0.9 }))!;
    expect(text).toContain("temperature 0.9");
    expect(text).toContain("deliberately varied");
  });
});
