// apps/web/lib/routing/sampling-profile.test.ts
//
// BI-1F5DAABC / BI-40DA6D05. The two regression guards this file exists for:
//   * buildDefaultPlan must produce parameters (it used to send {}),
//   * a quality_first extraction must be deterministic (it used to be 1.0).
import { describe, expect, it } from "vitest";
import { resolveSamplingProfile, toWireSampling, vendorProfileFor } from "./sampling-profile";
import { vendorSamplingForFamily, effectiveSampling } from "./vendor-sampling-catalog";
import { contractFamilyTemperature, resolveSamplingIntent } from "./contract-family-sampling";
import type { ModelCardSampling } from "./model-card-types";

const qwen = vendorSamplingForFamily("qwen3.8-27b")!;

describe("vendor sampling catalog", () => {
  it("publishes Qwen3's thinking-mode requirements", () => {
    expect(qwen.thinking).toEqual({
      temperature: 0.6, topP: 0.95, topK: 20, minP: 0, repeatPenalty: null,
    });
    expect(qwen.default).toMatchObject({ temperature: 0.7, topP: 0.8, topK: 20 });
    expect(qwen.source).toBe("catalog");
  });

  it("prefers the longest matching family so a distill is not shadowed", () => {
    expect(vendorSamplingForFamily("deepseek-r1-distill-qwen-32b")?.thinking?.temperature).toBe(0.6);
  });

  it("resolves a namespaced, tagged local model id", () => {
    expect(vendorSamplingForFamily("huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M")).not.toBeNull();
  });

  it("returns null for an unknown family rather than guessing", () => {
    expect(vendorSamplingForFamily("some-model-nobody-documented")).toBeNull();
  });

  it("treats a seed placeholder on the card as carrying nothing", () => {
    const seeded: ModelCardSampling = { default: null, thinking: null, unsupported: [], source: "seed" };
    const resolved = effectiveSampling({ modelId: "qwen3.8-27b", modelFamily: "qwen3", sampling: seeded });
    expect(resolved?.source).toBe("catalog");
  });

  it("lets a discovered or operator value outrank the catalog", () => {
    const operator: ModelCardSampling = {
      default: { temperature: 0.11, topP: null, topK: null, minP: null, repeatPenalty: null },
      thinking: null, unsupported: [], source: "operator",
    };
    const resolved = effectiveSampling({ modelId: "qwen3.8-27b", modelFamily: "qwen3", sampling: operator });
    expect(resolved?.source).toBe("operator");
    expect(resolved?.default?.temperature).toBe(0.11);
  });
});

describe("resolveSamplingProfile — composition order", () => {
  it("carries the vendor floor when the contract says nothing", () => {
    const r = resolveSamplingProfile({ sampling: qwen, contractFamily: "sync.unknown_family" });
    expect(r.values).toMatchObject({ temperature: 0.7, topP: 0.8, topK: 20 });
    expect(r.provenance.temperature).toBe("vendor");
  });

  it("lets the task narrow a vendor DEFAULT temperature", () => {
    const r = resolveSamplingProfile({ sampling: qwen, contractFamily: "sync.extraction" });
    expect(r.values.temperature).toBe(0);
    expect(r.provenance.temperature).toBe("contract");
    // The rest of the vendor profile still applies — only temperature narrowed.
    expect(r.values.topP).toBe(0.8);
    expect(r.provenance.topP).toBe("vendor");
  });

  it("honours a vendor THINKING temperature over the contract table", () => {
    const r = resolveSamplingProfile({
      sampling: qwen, contractFamily: "sync.analysis", thinking: true,
    });
    expect(r.mode).toBe("thinking");
    expect(r.values.temperature).toBe(0.6);
    expect(r.provenance.temperature).toBe("vendor");
    expect(r.values.minP).toBe(0);
  });

  it("applies recipe learning over vendor and contract", () => {
    const r = resolveSamplingProfile({
      sampling: qwen, contractFamily: "sync.extraction",
      recipeSettings: { temperature: 0.15 },
    });
    expect(r.values.temperature).toBe(0.15);
    expect(r.provenance.temperature).toBe("recipe");
  });

  it("applies an operator override over everything below it", () => {
    const r = resolveSamplingProfile({
      sampling: qwen, contractFamily: "sync.extraction",
      recipeSettings: { temperature: 0.15 },
      operatorOverride: { temperature: 0.42 },
    });
    expect(r.values.temperature).toBe(0.42);
    expect(r.provenance.temperature).toBe("operator");
  });

  it("drops parameters the model rejects, under either naming convention", () => {
    const claude = vendorSamplingForFamily("claude-opus-4-5")!;
    const r = resolveSamplingProfile({
      sampling: claude, contractFamily: "sync.conversation",
      recipeSettings: { temperature: 0.9, top_p: 0.5 },
    });
    expect(r.values.temperature).toBeUndefined();
    expect(r.values.topP).toBeUndefined();
    expect(r.dropped).toEqual(expect.arrayContaining(["temperature", "topP"]));
  });

  it("asserts nothing when the model publishes nothing and the family is unknown", () => {
    const r = resolveSamplingProfile({ sampling: null, contractFamily: "sync.mystery" });
    expect(r.values).toEqual({});
  });

  it("forces determinism for a schema-bound response whatever the task is", () => {
    const r = resolveSamplingProfile({
      sampling: qwen, contractFamily: "sync.ideation", strictSchema: true,
    });
    expect(r.values.temperature).toBe(0);
  });

  it("emits provider wire names", () => {
    const r = resolveSamplingProfile({ sampling: qwen, contractFamily: "sync.analysis", thinking: true });
    expect(toWireSampling(r)).toEqual({
      temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0,
    });
  });

  it("falls back to the default profile when a model has no thinking guidance", () => {
    const gemma = vendorSamplingForFamily("gemma4")!;
    expect(vendorProfileFor(gemma, true).mode).toBe("default");
  });
});

describe("contract family temperature (BI-40DA6D05)", () => {
  it("is deterministic for extraction — regardless of budget class", () => {
    // The superseded rule keyed temperature off budget: quality_first gave 1.0,
    // so the most determinism-sensitive task got maximum variance. Budget is not
    // an input here at all, which is the fix.
    expect(contractFamilyTemperature("sync.extraction")).toBe(0);
    expect(contractFamilyTemperature("background.classification")).toBe(0);
  });

  it("keeps code and tool work precise, prose warmer, ideation divergent", () => {
    expect(contractFamilyTemperature("sync.code_gen")).toBe(0.2);
    expect(contractFamilyTemperature("sync.tool_action")).toBe(0.2);
    expect(contractFamilyTemperature("sync.conversation")).toBe(0.7);
    expect(contractFamilyTemperature("sync.ideation")).toBe(0.9);
  });

  it("returns null for an unknown family instead of defaulting to chat", () => {
    expect(contractFamilyTemperature("sync.something_new")).toBeNull();
    expect(resolveSamplingIntent("sync.something_new")).toBeNull();
  });

  it("treats a background or batch variant as the same intent", () => {
    expect(contractFamilyTemperature("batch.extraction")).toBe(
      contractFamilyTemperature("sync.extraction"),
    );
  });
});
