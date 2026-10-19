import { describe, expect, it } from "vitest";

import { deriveLocalModelCapabilityPrior } from "./local-model-capabilities";

describe("fresh-install local model priors", () => {
  it("keeps the bundled Qwen 3.8 27B routable while calibration is pending", () => {
    const prior = deriveLocalModelCapabilityPrior("huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M");
    expect(prior.reasoning).toBeGreaterThanOrEqual(85);
    expect(prior.codegen).toBeGreaterThanOrEqual(85);
    expect(prior.supportsToolUse).toBe(true);
  });

  // BI-3CF78C8E / DI-3F200ED58DFF. The bundled prior claimed toolFidelity 85 —
  // above the qwen family's own 80 — on the strength of a phase-2 measurement
  // that ran with THINKING DISABLED and, by its own plan text, could not see
  // task completion. The model ships thinking-ON. These two bounds are the
  // evidence, and a future edit has to argue with the evidence to move them.
  it("does not claim the bundled Qwen 3.8 is a best-in-class tool caller", () => {
    const bundled = deriveLocalModelCapabilityPrior("huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M");
    const family = deriveLocalModelCapabilityPrior("ai/qwen3:14B-Q6_K");

    // Upper bound: nothing measured agentic completion, so the bundled model
    // must not outrank the generic qwen family it belongs to.
    expect(bundled.toolFidelity).toBeLessThanOrEqual(family.toolFidelity);
    expect(bundled.bestFor).not.toContain("tool-use");
    expect(bundled.avoidFor).toContain("agentic-tasks");
  });

  it("still ranks the bundled Qwen 3.8 as a genuine tool caller, well clear of the fabricate line", () => {
    const bundled = deriveLocalModelCapabilityPrior("huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M");
    const magistral = deriveLocalModelCapabilityPrior("ai/magistral-small-3.2:latest");

    // Lower bound: tool SELECTION at 15 attached tools measured 100%. This is a
    // model that calls tools; it must stay clear of eval-runner's
    // TOOL_USE_MIN_FIDELITY (35) and rank above the reasoning model that
    // narrates instead of calling. Over-correcting is as wrong as the 85 was.
    expect(bundled.toolFidelity).toBeGreaterThan(magistral.toolFidelity);
    expect(bundled.toolFidelity).toBeGreaterThanOrEqual(50);
    expect(bundled.avoidFor).not.toContain("tool-use");
  });

  it("does not promote every Qwen model to the bundled 27B prior", () => {
    const prior = deriveLocalModelCapabilityPrior("ai/qwen3:4B-UD-Q4_K_XL");
    expect(prior.reasoning).toBeLessThan(85);
  });
});
