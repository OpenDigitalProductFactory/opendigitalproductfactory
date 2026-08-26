import { describe, expect, it } from "vitest";
import { GOVERNED_LOCAL_REVIEWER } from "@/lib/routing/local-inference-runtime-policy";
import { LOCAL_MODEL_CATALOG } from "./local-model-catalog";

describe("local model catalog policy", () => {
  it("distinguishes the governed 27B reviewer from low-memory catalog choices", () => {
    const eightB = LOCAL_MODEL_CATALOG.find((model) => model.id === "ai/qwen3:8B-Q4_K_M");
    const reviewer = LOCAL_MODEL_CATALOG.find((model) => model.id === GOVERNED_LOCAL_REVIEWER.modelId);

    expect(eightB).not.toHaveProperty("recommended");
    expect(eightB?.governanceRole).toBeUndefined();
    expect(reviewer).toEqual(expect.objectContaining({ governanceRole: "high-trust-reviewer" }));
  });
});
