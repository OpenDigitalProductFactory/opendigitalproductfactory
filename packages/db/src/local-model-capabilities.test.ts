import { describe, expect, it } from "vitest";

import { deriveLocalModelCapabilityPrior } from "./local-model-capabilities";

describe("fresh-install local model priors", () => {
  it("keeps the bundled Qwen 3.8 27B routable while calibration is pending", () => {
    const prior = deriveLocalModelCapabilityPrior("huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M");
    expect(prior.reasoning).toBeGreaterThanOrEqual(85);
    expect(prior.codegen).toBeGreaterThanOrEqual(85);
    expect(prior.toolFidelity).toBeGreaterThanOrEqual(85);
  });

  it("does not promote every Qwen model to the bundled 27B prior", () => {
    const prior = deriveLocalModelCapabilityPrior("ai/qwen3:4B-UD-Q4_K_XL");
    expect(prior.reasoning).toBeLessThan(85);
  });
});
