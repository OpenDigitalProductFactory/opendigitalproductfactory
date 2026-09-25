import { describe, expect, it } from "vitest";

import * as aiResource from "./ai-resource";
import { addAiUse, aiLatencyText, aiSpendText, aiTokensText, NO_AI_USE } from "./ai-resource";

describe("AI beside points (BI-0CA5DA2B, design §5.7)", () => {
  it("labels subscription use as subscription, never as zero cost (AC-BUDGET-7)", () => {
    // Live shape on this install, 2026-09-25: 116 runs, 1.58M tokens, no cost recorded.
    const use = { runs: 116, tokens: 1_575_886, recordedUsd: null, subscriptionTokens: 1_575_886, durationMs: 116 * 240_000 };
    expect(aiSpendText(use)).toBe("subscription: $0 recorded, 1.6M tokens");
    expect(aiSpendText(use)).not.toMatch(/^\$0/);
    expect(aiTokensText(use)).toBe("1.6M tokens");
    expect(aiLatencyText(use)).toBe("116 run(s), 4 min average");
  });

  it("states recorded spend and a missing cost plainly", () => {
    expect(aiSpendText({ runs: 2, tokens: 5000, recordedUsd: 1.5, subscriptionTokens: 0, durationMs: 0 })).toBe("$1.50 recorded");
    expect(aiSpendText({ runs: 1, tokens: 900, recordedUsd: null, subscriptionTokens: 0, durationMs: 0 })).toBe("no cost recorded for 900 tokens");
    expect(aiSpendText(NO_AI_USE)).toBe("No AI runs traced");
  });

  it("adds use without turning an unrecorded cost into zero", () => {
    expect(addAiUse(NO_AI_USE, NO_AI_USE).recordedUsd).toBeNull();
    expect(addAiUse(NO_AI_USE, { ...NO_AI_USE, runs: 1, recordedUsd: 2 }).recordedUsd).toBe(2);
  });

  it("exports no conversion between AI resource and investment points", () => {
    expect(Object.keys(aiResource).filter((name) => /point/i.test(name))).toEqual([]);
  });
});
