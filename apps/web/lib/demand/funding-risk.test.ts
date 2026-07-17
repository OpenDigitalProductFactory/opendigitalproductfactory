import { describe, expect, it } from "vitest";

import { fundedItemRiskClass, fundingRiskTier, riskTierToRiskClass } from "./funding-risk";

describe("fundingRiskTier", () => {
  it("rates transform bets and xlarge work highest", () => {
    expect(fundingRiskTier("transform", "small")).toBe("high");
    expect(fundingRiskTier("grow", "xlarge")).toBe("high");
  });

  it("rates large work medium", () => {
    expect(fundingRiskTier("grow", "large")).toBe("medium");
    expect(fundingRiskTier(null, "large")).toBe("medium");
  });

  it("rates everything else low", () => {
    expect(fundingRiskTier("run", "small")).toBe("low");
    expect(fundingRiskTier(null, null)).toBe("low");
  });
});

describe("riskTierToRiskClass", () => {
  it("maps the tier onto the governed risk class (high = the kernel floor)", () => {
    expect(riskTierToRiskClass("high")).toBe("outbound-or-floor");
    expect(riskTierToRiskClass("medium")).toBe("internal-irreversible");
    expect(riskTierToRiskClass("low")).toBe("internal-reversible");
  });
});

describe("fundedItemRiskClass", () => {
  it("composes tier + class so a transform bet lands at the floor and a small run is reversible", () => {
    expect(fundedItemRiskClass("transform", "medium")).toBe("outbound-or-floor");
    expect(fundedItemRiskClass("grow", "large")).toBe("internal-irreversible");
    expect(fundedItemRiskClass("run", "small")).toBe("internal-reversible");
  });
});
