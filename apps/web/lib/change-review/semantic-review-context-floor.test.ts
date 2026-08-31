import { describe, expect, it } from "vitest";

import {
  SEMANTIC_REVIEW_HEADROOM_RATIO,
  SEMANTIC_REVIEW_MIN_CONTEXT_TOKENS,
  SEMANTIC_REVIEW_RESPONSE_RESERVE_TOKENS,
  semanticReviewMinimumContextTokens,
} from "./semantic-review-context-floor";

const CHARS_PER_TOKEN = 4;

/** Text whose ~chars/4 estimate is exactly `tokens`. */
function promptOf(tokens: number): string {
  return "x".repeat(tokens * CHARS_PER_TOKEN);
}

describe("semanticReviewMinimumContextTokens (BI-47ACE2C7)", () => {
  it("never returns less than the absolute floor for a tiny review", () => {
    const floor = semanticReviewMinimumContextTokens({
      systemPrompt: "review this",
      userPrompt: "- one line",
    });
    expect(floor).toBe(SEMANTIC_REVIEW_MIN_CONTEXT_TOKENS);
  });

  it("counts BOTH prompts, not just the user prompt", () => {
    const userOnly = semanticReviewMinimumContextTokens({
      systemPrompt: "",
      userPrompt: promptOf(20_000),
    });
    const both = semanticReviewMinimumContextTokens({
      systemPrompt: promptOf(20_000),
      userPrompt: promptOf(20_000),
    });
    expect(both).toBeGreaterThan(userOnly);
  });

  it("adds proportional headroom and the response reserve above the floor", () => {
    const promptTokens = 20_000;
    const expected =
      Math.ceil(promptTokens * (1 + SEMANTIC_REVIEW_HEADROOM_RATIO))
      + SEMANTIC_REVIEW_RESPONSE_RESERVE_TOKENS;
    expect(
      semanticReviewMinimumContextTokens({
        systemPrompt: "",
        userPrompt: promptOf(promptTokens),
      }),
    ).toBe(expected);
    expect(expected).toBeGreaterThan(promptTokens);
  });

  it("admits the local 24,576-token reviewer for a review that fits it", () => {
    // The regression: a ~4k-token review was excluded from a 24,576-token
    // endpoint by a flat 32,000 floor it never needed.
    const floor = semanticReviewMinimumContextTokens({
      systemPrompt: promptOf(1_000),
      userPrompt: promptOf(3_000),
    });
    expect(floor).toBeLessThanOrEqual(24_576);
    expect(floor).toBeLessThan(32_000);
  });

  it("still exceeds a small window when the diff genuinely is large, so the review fails closed", () => {
    const floor = semanticReviewMinimumContextTokens({
      systemPrompt: promptOf(1_000),
      userPrompt: promptOf(60_000),
    });
    expect(floor).toBeGreaterThan(24_576);
  });

  it("is monotonic in prompt size", () => {
    const small = semanticReviewMinimumContextTokens({
      systemPrompt: "",
      userPrompt: promptOf(30_000),
    });
    const large = semanticReviewMinimumContextTokens({
      systemPrompt: "",
      userPrompt: promptOf(30_001),
    });
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it("falls back to the defaults on non-finite or negative overrides", () => {
    const baseline = semanticReviewMinimumContextTokens({
      systemPrompt: "",
      userPrompt: promptOf(20_000),
    });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        semanticReviewMinimumContextTokens({
          systemPrompt: "",
          userPrompt: promptOf(20_000),
          responseReserveTokens: bad,
          headroomRatio: bad,
        }),
      ).toBe(baseline);
    }
  });
});
