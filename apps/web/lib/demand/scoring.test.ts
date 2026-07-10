import { describe, expect, it } from "vitest";
import {
  classifyValueEffort,
  computeDemandScore,
  EFFORT_SIZE_TO_JOB_SIZE,
  resolveJobSize,
  resolveReach,
  type DemandScoreInputs,
} from "./scoring";

describe("computeDemandScore", () => {
  // Fixture 1 — RICE (the seeded default). (reach*impact*confidence)/jobSize.
  it("computes RICE from explicit inputs", () => {
    const inputs: DemandScoreInputs = { reach: 1000, impact: 2, confidence: 0.8, jobSize: 4 };
    const r = computeDemandScore(inputs, "rice");
    expect(r.score).toBe(400); // (1000*2*0.8)/4
    expect(r.missing).toEqual([]);
    expect(r.contributions).toMatchObject({ reach: 1000, impact: 2, confidence: 0.8, jobSize: 4 });
  });

  // Fixture 2 — WSJF. CoD=(bv+tc+ro); score=CoD/jobSize.
  it("computes WSJF (CoD / job size)", () => {
    const inputs: DemandScoreInputs = { businessValue: 8, timeCriticality: 5, riskOpportunity: 3, jobSize: 8 };
    const r = computeDemandScore(inputs, "wsjf");
    expect(r.score).toBe(2); // (8+5+3)/8
    expect(r.contributions.costOfDelay).toBe(16);
  });

  // Fixture 3 — value_effort (value/effort ratio; falls back impact->businessValue).
  it("computes value_effort using impact, else businessValue", () => {
    expect(computeDemandScore({ impact: 3, jobSize: 3 }, "value_effort").score).toBe(1);
    // impact absent -> businessValue used
    expect(computeDemandScore({ businessValue: 9, jobSize: 3 }, "value_effort").score).toBe(3);
  });

  // Fixture 4 — weighted (Σ weight*input, jobSize as a cost/negative term).
  it("computes a weighted sum with jobSize as a cost", () => {
    const inputs: DemandScoreInputs = { impact: 2, confidence: 1, jobSize: 3 };
    const r = computeDemandScore(inputs, "weighted", { impact: 2, confidence: 1, jobSize: 1 });
    // 2*2 (impact) + 1*1 (confidence) - 1*3 (jobSize) = 2
    expect(r.score).toBe(2);
    expect(r.contributions.jobSize).toBe(-3);
  });

  it("returns null (not 0) and lists missing inputs when required inputs absent", () => {
    const r = computeDemandScore({ reach: 100 }, "rice");
    expect(r.score).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining(["impact", "confidence", "jobSize"]));
  });

  it("never divides by a zero job size", () => {
    expect(computeDemandScore({ reach: 1, impact: 1, confidence: 1, jobSize: 0 }, "rice").score).toBeNull();
  });
});

describe("derivations from existing fields", () => {
  it("seeds reach from occurrenceCount when reach absent", () => {
    expect(resolveReach({ occurrenceCount: 7 })).toBe(7);
    expect(resolveReach({ reach: 3, occurrenceCount: 7 })).toBe(3); // explicit wins
    expect(resolveReach({})).toBeNull();
  });

  it("derives jobSize from the t-shirt effortSize map", () => {
    expect(resolveJobSize({ effortSize: "small" })).toBe(1);
    expect(resolveJobSize({ effortSize: "large" })).toBe(EFFORT_SIZE_TO_JOB_SIZE.large);
    expect(resolveJobSize({ jobSize: 5, effortSize: "xlarge" })).toBe(5); // explicit wins
    expect(resolveJobSize({})).toBeNull();
  });

  it("scores RICE end-to-end from occurrenceCount + effortSize fallbacks", () => {
    // reach<-occurrenceCount=500, jobSize<-effortSize=medium(3)
    const r = computeDemandScore({ occurrenceCount: 500, impact: 1, confidence: 1, effortSize: "medium" }, "rice");
    expect(r.score).toBe(round3((500 * 1 * 1) / 3));
  });
});

describe("classifyValueEffort", () => {
  it("labels the four quadrants around the midpoints", () => {
    expect(classifyValueEffort(10, 1, 5, 5)).toBe("quick_win"); // high value, low effort
    expect(classifyValueEffort(10, 9, 5, 5)).toBe("big_bet"); // high/high
    expect(classifyValueEffort(1, 1, 5, 5)).toBe("fill_in"); // low/low
    expect(classifyValueEffort(1, 9, 5, 5)).toBe("time_sink"); // low value, high effort
  });
});

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
