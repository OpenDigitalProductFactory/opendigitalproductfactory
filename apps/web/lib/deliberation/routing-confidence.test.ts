// apps/web/lib/deliberation/routing-confidence.test.ts
//
// BI-1A5204A0. The property that matters most: this axis can only ever ADD
// scrutiny. A confident route must never lower what stage or declared risk
// already require.
import { describe, expect, it } from "vitest";
import {
  describeRoutingConfidence,
  higherRisk,
  routingConfidenceRisk,
  LARGE_SHORTFALL,
} from "./routing-confidence";

describe("routingConfidenceRisk", () => {
  it("is low when routing was confident", () => {
    expect(routingConfidenceRisk({ candidateCount: 8 })).toBe("low");
    expect(routingConfidenceRisk(null)).toBe("low");
    expect(routingConfidenceRisk(undefined)).toBe("low");
  });

  it("is medium when the floor was relaxed at all", () => {
    expect(routingConfidenceRisk({ qualityFloorRelaxed: true, candidateCount: 4 })).toBe("medium");
  });

  it("is high when the winner is well short of the floor", () => {
    expect(
      routingConfidenceRisk({ qualityFloorRelaxed: true, floorShortfall: LARGE_SHORTFALL }),
    ).toBe("high");
  });

  it("is medium when only one candidate ranked — an outcome, not a choice", () => {
    // This is the observed 2026-09-18 incident: "8 endpoint(s) excluded;
    // 1 candidate(s) ranked" during a self-upgrade drain.
    expect(routingConfidenceRisk({ candidateCount: 1 })).toBe("medium");
  });

  it("is medium when the winner came from fallback rather than ranking", () => {
    expect(routingConfidenceRisk({ fallbackUsed: true, candidateCount: 5 })).toBe("medium");
  });

  it("never exceeds high — a weak answer is not a critical hazard", () => {
    const worst = routingConfidenceRisk({
      qualityFloorRelaxed: true,
      floorShortfall: 100,
      fallbackUsed: true,
      candidateCount: 1,
    });
    expect(worst).toBe("high");
  });
});

describe("higherRisk", () => {
  it("takes the higher of two levels, which is what makes the axis strengthen-only", () => {
    expect(higherRisk("low", "medium")).toBe("medium");
    expect(higherRisk("critical", "medium")).toBe("critical");
    expect(higherRisk("high", "high")).toBe("high");
  });

  it("cannot lower a declared critical risk however confident routing was", () => {
    expect(higherRisk("critical", routingConfidenceRisk({ candidateCount: 12 }))).toBe("critical");
  });
});

describe("describeRoutingConfidence", () => {
  it("explains an escalation in words an operator can act on", () => {
    expect(describeRoutingConfidence({ qualityFloorRelaxed: true })).toContain("quality bar");
    expect(
      describeRoutingConfidence({ qualityFloorRelaxed: true, floorShortfall: LARGE_SHORTFALL }),
    ).toContain("well short");
    expect(describeRoutingConfidence({ candidateCount: 1 })).toContain("only one model");
    expect(describeRoutingConfidence({ fallbackUsed: true })).toContain("fallback");
  });

  it("says nothing when there is nothing to explain", () => {
    expect(describeRoutingConfidence({ candidateCount: 6 })).toBeNull();
    expect(describeRoutingConfidence(null)).toBeNull();
  });
});
