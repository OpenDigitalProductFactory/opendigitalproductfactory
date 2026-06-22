import { describe, it, expect } from "vitest";
import {
  RISK_POSTURES,
  DEFAULT_RISK_POSTURE,
  isRiskPosture,
  isRiskPostureSource,
  deriveRiskPostureDefault,
  resolveRiskEnvelope,
  riskEnvelopeToAutonomyPolicy,
} from "./risk-posture";

describe("risk posture enum guards", () => {
  it("exposes the three canonical postures", () => {
    expect(RISK_POSTURES).toEqual(["conservative", "balanced", "progressive"]);
    expect(DEFAULT_RISK_POSTURE).toBe("balanced");
  });

  it("validates postures and sources", () => {
    expect(isRiskPosture("conservative")).toBe(true);
    expect(isRiskPosture("balanced")).toBe(true);
    expect(isRiskPosture("aggressive")).toBe(false);
    expect(isRiskPosture(null)).toBe(false);
    expect(isRiskPostureSource("operator")).toBe(true);
    expect(isRiskPostureSource("industry-default")).toBe(true);
    expect(isRiskPostureSource("guessed")).toBe(false);
  });
});

describe("deriveRiskPostureDefault", () => {
  it("returns conservative for regulated archetype categories", () => {
    for (const cat of [
      "banking-financial-services",
      "healthcare-wellness",
      "public-sector",
      "professional-services",
    ]) {
      expect(deriveRiskPostureDefault({ archetypeCategory: cat })).toEqual({
        posture: "conservative",
        source: "industry-default",
      });
    }
  });

  it("resolves freeform industry aliases through the shared normalizer", () => {
    expect(deriveRiskPostureDefault({ industry: "legal" }).posture).toBe("conservative");
    expect(deriveRiskPostureDefault({ industry: "financial" }).posture).toBe("conservative");
    expect(deriveRiskPostureDefault({ industry: "medical" }).posture).toBe("conservative");
    expect(deriveRiskPostureDefault({ industry: "Healthcare" }).posture).toBe("conservative");
  });

  it("defaults to balanced for unregulated or unknown industries", () => {
    expect(deriveRiskPostureDefault({ archetypeCategory: "retail-goods" }).posture).toBe("balanced");
    expect(deriveRiskPostureDefault({ industry: "coffee shop" }).posture).toBe("balanced");
    expect(deriveRiskPostureDefault({}).posture).toBe("balanced");
    expect(deriveRiskPostureDefault({ archetypeCategory: null, industry: null }).posture).toBe("balanced");
    expect(deriveRiskPostureDefault({ archetypeCategory: "" }).posture).toBe("balanced");
  });

  it("prefers the canonical archetype category over freeform industry", () => {
    expect(
      deriveRiskPostureDefault({ archetypeCategory: "retail-goods", industry: "banking" }).posture,
    ).toBe("balanced");
  });

  it("nudges a balanced default to conservative when card payments are handled, never the reverse", () => {
    expect(deriveRiskPostureDefault({ archetypeCategory: "retail-goods", handlesCardPayments: true }).posture).toBe(
      "conservative",
    );
    // already conservative stays conservative
    expect(
      deriveRiskPostureDefault({ archetypeCategory: "healthcare-wellness", handlesCardPayments: true }).posture,
    ).toBe("conservative");
  });

  it("always reports industry-default provenance", () => {
    expect(deriveRiskPostureDefault({ archetypeCategory: "retail-goods" }).source).toBe("industry-default");
  });
});

describe("resolveRiskEnvelope", () => {
  it("maps each posture to its envelope", () => {
    expect(resolveRiskEnvelope("conservative")).toMatchObject({
      posture: "conservative",
      hitlDefault: "all-consequential",
      selfUpgradeWindow: "narrow",
      capabilityAutoActivate: false,
      outboundConfirmation: "always",
      edgeDeployDefault: false,
      autonomyCeiling: "low",
      maturationRate: "slow",
    });
    expect(resolveRiskEnvelope("balanced")).toMatchObject({
      posture: "balanced",
      hitlDefault: "selective",
      capabilityAutoActivate: false,
      autonomyCeiling: "moderate",
    });
    // only progressive auto-activates recommended capabilities
    expect(resolveRiskEnvelope("conservative").capabilityAutoActivate).toBe(false);
    expect(resolveRiskEnvelope("progressive").capabilityAutoActivate).toBe(true);
    expect(resolveRiskEnvelope("progressive")).toMatchObject({
      posture: "progressive",
      hitlDefault: "minimal",
      selfUpgradeWindow: "flexible",
      edgeDeployDefault: true,
      autonomyCeiling: "high",
      maturationRate: "fast",
    });
  });

  it("fails open to the balanced default for unset or invalid input", () => {
    expect(resolveRiskEnvelope(null).posture).toBe("balanced");
    expect(resolveRiskEnvelope(undefined).posture).toBe("balanced");
    // an unrecognized value falls through the guard to the balanced default
    expect(resolveRiskEnvelope("aggressive").posture).toBe("balanced");
  });
});

describe("riskEnvelopeToAutonomyPolicy", () => {
  it("BALANCED is the identity — exactly the org profile's seeded default (no regression)", () => {
    // Must equal seed-org-wwwd-corpus DEFAULT_AUTONOMY_POLICY. If this ever
    // changes, existing installs would silently shift autonomy — keep it pinned.
    expect(riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope("balanced"))).toEqual({
      allowRecommendation: true,
      allowArbitration: false,
      maxRiskForArbitration: "low",
      minimumConfidenceForRecommendation: 0.55,
      minimumConfidenceForArbitration: 0.9,
    });
  });

  it("conservative only tightens — never arbitrates, higher confidence floors", () => {
    const c = riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope("conservative"));
    expect(c.allowArbitration).toBe(false);
    expect(c.maxRiskForArbitration).toBe("low");
    expect(c.minimumConfidenceForArbitration).toBeGreaterThanOrEqual(0.9);
    expect(c.minimumConfidenceForRecommendation).toBeGreaterThanOrEqual(0.55);
  });

  it("progressive loosens within bounds — arbitrates low+medium risk at high confidence", () => {
    const p = riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope("progressive"));
    expect(p.allowArbitration).toBe(true);
    expect(p.maxRiskForArbitration).toBe("medium");
    // even progressive demands high confidence to arbitrate; high/critical risk
    // still always escalates (an unconditional rule in the evaluator).
    expect(p.minimumConfidenceForArbitration).toBeGreaterThanOrEqual(0.8);
  });

  it("autonomy is monotonic across postures (conservative <= balanced <= progressive)", () => {
    const c = riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope("conservative"));
    const b = riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope("balanced"));
    const p = riskEnvelopeToAutonomyPolicy(resolveRiskEnvelope("progressive"));
    // tighter posture => higher arbitration confidence floor
    expect(c.minimumConfidenceForArbitration).toBeGreaterThanOrEqual(b.minimumConfidenceForArbitration);
    expect(b.minimumConfidenceForArbitration).toBeGreaterThanOrEqual(p.minimumConfidenceForArbitration);
    // only progressive unlocks arbitration
    expect([c.allowArbitration, b.allowArbitration]).toEqual([false, false]);
    expect(p.allowArbitration).toBe(true);
  });
});
