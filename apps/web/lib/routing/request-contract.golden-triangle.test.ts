/**
 * EP-GOLDEN-TRIANGLE Slice 3 — `inferContract()` caller-override extensions for
 * the Golden Triangle posture compiler. The overrides are additive: when the
 * caller supplies none, behaviour is identical to before (asserted below).
 */
import { describe, expect, it } from "vitest";
import { inferContract } from "./request-contract";

const MESSAGES = [{ role: "user", content: "hello" }];

describe("inferContract – Golden Triangle posture overrides", () => {
  it("caller reasoningDepth override wins over the task default", async () => {
    const base = await inferContract("greeting", MESSAGES);
    const overridden = await inferContract("greeting", MESSAGES, undefined, undefined, {
      reasoningDepth: "high",
    });
    expect(base.reasoningDepth).not.toBe("high"); // sanity: default is not "high"
    expect(overridden.reasoningDepth).toBe("high");
  });

  it("caller minimumTier raises the dimension floor", async () => {
    const contract = await inferContract("greeting", MESSAGES, undefined, undefined, {
      minimumTier: "frontier",
    });
    expect(contract.minimumDimensions?.reasoning).toBe(85);
    expect(contract.minimumDimensions?.codegen).toBe(85);
    expect(contract.minimumDimensions?.toolFidelity).toBe(85);
  });

  it("caller minimumDimensions merge with stricter (max) wins", async () => {
    const contract = await inferContract("greeting", MESSAGES, undefined, undefined, {
      minimumDimensions: { reasoning: 99 },
    });
    expect(contract.minimumDimensions?.reasoning).toBe(99);
  });

  it("is additive: no override leaves reasoningDepth at the task default", async () => {
    const base = await inferContract("greeting", MESSAGES);
    const noOverride = await inferContract("greeting", MESSAGES, undefined, undefined, {
      sensitivity: "internal",
    });
    expect(noOverride.reasoningDepth).toBe(base.reasoningDepth);
  });

  it("budgetClass caller override still wins (pre-existing slot, unchanged)", async () => {
    const contract = await inferContract("greeting", MESSAGES, undefined, undefined, {
      budgetClass: "quality_first",
    });
    expect(contract.budgetClass).toBe("quality_first");
  });
});
