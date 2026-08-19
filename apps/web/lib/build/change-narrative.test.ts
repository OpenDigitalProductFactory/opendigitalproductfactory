import { describe, it, expect } from "vitest";
import { parseChangeNarrative } from "./change-narrative";

// BI-D93CF6C0 — the model call is mocked away; we unit-test the pure parser,
// which is the part that must be defensive against real local-model output.

describe("parseChangeNarrative", () => {
  it("parses a well-formed narrative", () => {
    const n = parseChangeNarrative(
      JSON.stringify({
        headline: "Repeat customers now get 10% off.",
        bullets: ["Applies at checkout", "Shows on the receipt"],
        whyItMatters: "Rewards your regulars automatically.",
        openQuestions: ["Should it stack with coupons?"],
      }),
      "qwen3-coder",
    );
    expect(n).not.toBeNull();
    expect(n!.headline).toBe("Repeat customers now get 10% off.");
    expect(n!.bullets).toHaveLength(2);
    expect(n!.whyItMatters).toContain("regulars");
    expect(n!.openQuestions).toEqual(["Should it stack with coupons?"]);
    expect(n!.model).toBe("qwen3-coder");
    expect(typeof n!.generatedAt).toBe("string");
  });

  it("extracts JSON from code fences / surrounding prose", () => {
    const n = parseChangeNarrative(
      'Here you go:\n```json\n{"headline":"Did a thing","bullets":[],"whyItMatters":""}\n```\nHope that helps!',
      "m",
    );
    expect(n).not.toBeNull();
    expect(n!.headline).toBe("Did a thing");
  });

  it("returns null when there is no headline", () => {
    expect(parseChangeNarrative(JSON.stringify({ bullets: ["x"] }), "m")).toBeNull();
  });

  it("returns null on non-JSON output", () => {
    expect(parseChangeNarrative("the model refused to answer", "m")).toBeNull();
  });

  it("drops non-string entries and omits empty openQuestions", () => {
    const n = parseChangeNarrative(
      JSON.stringify({ headline: "h", bullets: ["ok", 5, ""], whyItMatters: "w", openQuestions: [] }),
      "m",
    );
    expect(n!.bullets).toEqual(["ok"]);
    expect(n!.openQuestions).toBeUndefined();
  });
});
