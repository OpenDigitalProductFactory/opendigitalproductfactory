// apps/web/lib/routing/call-parameter-receipt.test.ts
//
// BI-B4081AA1. Two properties matter here: an absent plan must produce NO receipt
// (so "not recorded" never reads as "called with nothing"), and the receipt must
// carry no request content.
import { describe, expect, it } from "vitest";
import {
  buildCallParameterReceipt,
  describeProvenance,
  describeVariability,
} from "./call-parameter-receipt";
import type { RoutedExecutionPlan } from "./recipe-types";

function plan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "local",
    modelId: "qwen3.8-27b",
    recipeId: null,
    contractFamily: "sync.code_gen",
    executionAdapter: "chat",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  } as RoutedExecutionPlan;
}

describe("buildCallParameterReceipt", () => {
  it("returns undefined with no plan, so an absent receipt is not a claim", () => {
    expect(buildCallParameterReceipt(undefined)).toBeUndefined();
  });

  it("carries the resolved values, their provenance and the vendor mode", () => {
    const receipt = buildCallParameterReceipt(
      plan({
        sampling: {
          values: { temperature: 0.6, topP: 0.95, topK: 20, minP: 0 },
          provenance: { temperature: "vendor", topP: "vendor", topK: "vendor", minP: "vendor" },
          mode: "thinking",
        },
      }),
    )!;
    expect(receipt.sampling).toEqual({ temperature: 0.6, topP: 0.95, topK: 20, minP: 0 });
    expect(receipt.provenance.temperature).toBe("vendor");
    expect(receipt.mode).toBe("thinking");
  });

  it("falls back to a plan's top-level temperature when no sampling record exists", () => {
    expect(buildCallParameterReceipt(plan({ temperature: 0.9 }))!.sampling.temperature).toBe(0.9);
  });

  it("names how each provider expressed effort", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ thinking: { type: "enabled", budget_tokens: 8192 } }, "thinking:enabled"],
      [{ thinking: { type: "adaptive" } }, "thinking:adaptive"],
      [{ thinkingConfig: { thinkingBudget: 4096 } }, "thinkingConfig.thinkingBudget"],
      [{ reasoning: { effort: "high" } }, "reasoning.effort"],
      [{ reasoning_effort: "high" }, "reasoning_effort"],
      [{ think: true }, "think"],
    ];
    for (const [providerSettings, expected] of cases) {
      expect(buildCallParameterReceipt(plan({ providerSettings }))!.effort?.expressedAs).toBe(expected);
    }
  });

  it("carries the thinking budget where the provider takes one", () => {
    const receipt = buildCallParameterReceipt(
      plan({ providerSettings: { thinkingConfig: { thinkingBudget: 4096 } } }),
    )!;
    expect(receipt.effort?.budgetTokens).toBe(4096);
  });

  it("records an unexpressed effort rather than omitting it", () => {
    expect(buildCallParameterReceipt(plan({ effortUnexpressed: true }))!.effortUnexpressed).toBe(true);
  });

  it("records constrained decoding and dropped parameters", () => {
    const receipt = buildCallParameterReceipt(
      plan({
        responsePolicy: { strictSchema: true },
        sampling: { values: {}, provenance: {}, mode: "default", dropped: ["temperature"] },
      }),
    )!;
    expect(receipt.constrainedDecoding).toBe(true);
    expect(receipt.dropped).toEqual(["temperature"]);
  });

  it("contains no request content — only numbers, provenance and shapes", () => {
    const receipt = buildCallParameterReceipt(
      plan({
        sampling: { values: { temperature: 0.2 }, provenance: { temperature: "contract" }, mode: "default" },
        providerSettings: { thinking: { type: "enabled", budget_tokens: 2048 } },
      }),
    )!;
    const serialized = JSON.stringify(receipt);
    for (const key of ["prompt", "messages", "content", "systemPrompt", "tool"]) {
      expect(serialized).not.toContain(key);
    }
  });
});

describe("plain-language helpers", () => {
  it("reads a temperature the way an operator would", () => {
    expect(describeVariability(0)).toBe("no variation");
    expect(describeVariability(0.2)).toBe("little variation");
    expect(describeVariability(0.6)).toBe("some variation");
    expect(describeVariability(0.95)).toBe("deliberately varied");
  });

  it("explains provenance without exposing the source enum", () => {
    expect(describeProvenance("vendor", true)).toContain("reasoning mode");
    expect(describeProvenance("vendor", false)).toBe("the model's published setting");
    expect(describeProvenance("contract", false)).toBe("what this kind of task needs");
    expect(describeProvenance("recipe", false)).toContain("measured best");
    expect(describeProvenance("operator", false)).toContain("override");
  });
});
