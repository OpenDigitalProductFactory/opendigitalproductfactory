import { describe, expect, it } from "vitest";

import {
  DPF_PRODUCT_DOCTRINE_PROFILE,
  MARK_DPF_PLATFORM_PROFILE,
} from "./default-profile";
import {
  evaluateDecisionPerspective,
  scorePerspectiveMaterial,
} from "./evaluator";
import type {
  DecisionPerspectiveProfile,
  PerspectiveMaterial,
} from "./types";
import { DECISION_DOMAIN_CLASSES, PLAN_READINESS_DOMAIN_CLASS } from "./types";

const DOMAIN = PLAN_READINESS_DOMAIN_CLASS;

function profile(overrides: Partial<DecisionPerspectiveProfile> = {}): DecisionPerspectiveProfile {
  return {
    profileId: "active-profile",
    name: "Active profile",
    kind: "platform",
    scope: { domains: [DOMAIN] },
    fallbackProfileId: null,
    defaultResolver: { type: "build-studio-owner" },
    autonomyPolicy: {
      allowRecommendation: true,
      allowArbitration: false,
      maxRiskForArbitration: "low",
      minimumConfidenceForRecommendation: 0.55,
      minimumConfidenceForArbitration: 0.85,
    },
    currentVersion: {
      versionId: "active-profile-v1",
      versionNumber: 1,
      materialFingerprint: "test-fingerprint",
      changeSummary: "Test snapshot",
      createdAt: new Date("2026-05-17T12:00:00.000Z"),
    },
    ...overrides,
  };
}

function material(overrides: Partial<PerspectiveMaterial> = {}): PerspectiveMaterial {
  return {
    materialId: "material-1",
    profileId: "active-profile",
    sourceType: "principle",
    sourceRef: { path: "docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md" },
    summary: "Prefer the architecture that preserves future autonomy over a tactical shortcut.",
    domainClass: DOMAIN,
    direction: "support",
    domains: [DOMAIN],
    freshness: "current",
    evidenceGrade: "A",
    confidenceWeight: 0.9,
    reviewStatus: "approved",
    promotionState: "promoted",
    lastValidatedAt: new Date("2026-05-17T12:00:00.000Z"),
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof evaluateDecisionPerspective>[0]> = {},
): Parameters<typeof evaluateDecisionPerspective>[0] {
  return {
    profile: profile(),
    fallbackProfiles: [],
    materials: [material()],
    question: "Should this reviewed Build Studio plan enter sandbox implementation now?",
    questionDomain: DOMAIN,
    options: ["Start implementation", "Revise the plan", "Escalate to the build owner"],
    riskTier: "medium" as const,
    evidence: [
      {
        label: "Plan review",
        sourceType: "build-studio-plan-review" as const,
        grade: "A" as const,
        summary: "Plan review passed with no critical issues.",
      },
    ],
    ...overrides,
  };
}

describe("evaluateDecisionPerspective", () => {
  it("defers when no profile in the fallback chain has applicable material", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        materials: [],
        fallbackProfiles: [DPF_PRODUCT_DOCTRINE_PROFILE],
      }),
    );

    expect(result.outcomeType).toBe("defer");
    expect(result.confidenceBefore).toBe(0);
    expect(result.gapReason).toBe("no-applicable-material");
    expect(result.rationale).toContain("coverage gap");
  });

  it("uses fallback profile material when the active profile lacks coverage", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        profile: {
          ...MARK_DPF_PLATFORM_PROFILE,
          fallbackProfileId: DPF_PRODUCT_DOCTRINE_PROFILE.profileId,
        },
        riskTier: "low",
        fallbackProfiles: [DPF_PRODUCT_DOCTRINE_PROFILE],
        materials: [
          material({
            materialId: "fallback-material",
            profileId: DPF_PRODUCT_DOCTRINE_PROFILE.profileId,
            confidenceWeight: 0.8,
          }),
        ],
      }),
    );

    expect(result.outcomeType).toBe("recommend");
    expect(result.selectedProfileId).toBe(DPF_PRODUCT_DOCTRINE_PROFILE.profileId);
    expect(result.fallbackProfileId).toBe(DPF_PRODUCT_DOCTRINE_PROFILE.profileId);
  });

  it("keeps current Grade A material above the recommendation threshold", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        riskTier: "low",
        materials: [
          material({ materialId: "source-1", confidenceWeight: 0.9 }),
          material({ materialId: "source-2", confidenceWeight: 0.8 }),
        ],
      }),
    );

    expect(result.outcomeType).toBe("recommend");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
    expect(result.coverageGap).toBe(false);
    expect(result.freshnessDistribution).toEqual({
      current: 2,
      stale: 0,
      superseded: 0,
      contradicted: 0,
    });
  });

  it("keeps stale Grade C material below the arbitration threshold", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        riskTier: "low",
        profile: profile({
          autonomyPolicy: {
            allowRecommendation: true,
            allowArbitration: true,
            maxRiskForArbitration: "low",
            minimumConfidenceForRecommendation: 0.4,
            minimumConfidenceForArbitration: 0.9,
          },
        }),
        materials: [
          material({ materialId: "stale-1", freshness: "stale", evidenceGrade: "C", confidenceWeight: 1 }),
          material({ materialId: "stale-2", freshness: "stale", evidenceGrade: "C", confidenceWeight: 1 }),
        ],
      }),
    );

    expect(result.outcomeType).toBe("escalate");
    expect(result.confidenceScore).toBeLessThan(0.9);
  });

  it("escalates principle conflict instead of synthesizing a recommendation", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        riskTier: "low",
        materials: [
          material({
            materialId: "principle-support",
            sourceType: "principle",
            direction: "support",
            confidenceWeight: 0.95,
          }),
          material({
            materialId: "principle-oppose",
            sourceType: "principle",
            direction: "oppose",
            confidenceWeight: 0.95,
          }),
        ],
      }),
    );

    expect(result.outcomeType).toBe("escalate");
    expect(result.principleConflict).toBe(true);
    expect(result.rationale).toContain("Principle conflict");
  });

  it("escalates high-risk decisions even when coverage is strong", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        riskTier: "high",
        materials: [material({ confidenceWeight: 0.95 })],
      }),
    );

    expect(result.outcomeType).toBe("escalate");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
    expect(result.rationale).toContain("high-risk");
  });

  it("recommends high-confidence medium-risk decisions when arbitration is not allowed", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        riskTier: "medium",
        materials: [material({ confidenceWeight: 1 })],
      }),
    );

    expect(result.outcomeType).toBe("recommend");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9);
  });

  it("arbitrates only when low risk, high confidence, and autonomy policy allow it", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        profile: profile({
          autonomyPolicy: {
            allowRecommendation: true,
            allowArbitration: true,
            maxRiskForArbitration: "low",
            minimumConfidenceForRecommendation: 0.55,
            minimumConfidenceForArbitration: 0.85,
          },
        }),
        riskTier: "low",
        materials: [material({ confidenceWeight: 0.92 })],
      }),
    );

    expect(result.outcomeType).toBe("arbitrate");
    expect(result.confidenceBefore).toBeGreaterThanOrEqual(0.85);
  });

  it("gives contradicted material zero effective weight", () => {
    const score = scorePerspectiveMaterial(
      material({
        freshness: "contradicted",
        confidenceWeight: 1,
      }),
    );

    expect(score.effectiveWeight).toBe(0);
    expect(score.exclusionReason).toBe("contradicted");
  });

  it("discounts stale and superseded material below current material", () => {
    const current = scorePerspectiveMaterial(material({ freshness: "current", confidenceWeight: 0.8 }));
    const stale = scorePerspectiveMaterial(material({ freshness: "stale", confidenceWeight: 0.8 }));
    const superseded = scorePerspectiveMaterial(material({ freshness: "superseded", confidenceWeight: 0.8 }));

    expect(stale.effectiveWeight).toBeLessThan(current.effectiveWeight);
    expect(superseded.effectiveWeight).toBeLessThan(stale.effectiveWeight);
  });

  it("accepts persona-real kind without throwing", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        profile: profile({ kind: "persona-real" }),
        riskTier: "medium",
        materials: [material({ confidenceWeight: 1 })],
      }),
    );
    expect(result.outcomeType).toBeDefined();
  });

  it("accepts persona-fictional kind without throwing", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        profile: profile({ kind: "persona-fictional" }),
        riskTier: "medium",
        materials: [material({ confidenceWeight: 1 })],
      }),
    );
    expect(result.outcomeType).toBeDefined();
  });

  it("accepts persona-synthetic kind without throwing", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        profile: profile({ kind: "persona-synthetic" }),
        riskTier: "medium",
        materials: [material({ confidenceWeight: 1 })],
      }),
    );
    expect(result.outcomeType).toBeDefined();
  });

  it("accepts profession kind without throwing", () => {
    const result = evaluateDecisionPerspective(
      baseInput({
        profile: profile({ kind: "profession" }),
        riskTier: "medium",
        materials: [material({ confidenceWeight: 1 })],
      }),
    );
    expect(result.outcomeType).toBeDefined();
  });

  it("professional-practice is a registered domain class", () => {
    expect(DECISION_DOMAIN_CLASSES).toContain("professional-practice");
    const result = evaluateDecisionPerspective(
      baseInput({
        questionDomain: "professional-practice",
        materials: [material({ confidenceWeight: 1 })],
      }),
    );
    expect(result.domainClass).toBe("professional-practice");
  });
});

// BI-7E1F128A: the WWWD evaluator must discriminate by decision CONTENT. With a
// per-material relevance map (computed upstream from question↔stance similarity),
// an off-mission decision (a relevant `oppose` stance) yields a confident DECLINE
// and an on-mission one (a relevant `support` stance) a confident APPROVE — where
// the legacy coverage path returned an identical confidence + escalate for both.
describe("content-aware directional scoring (BI-7E1F128A)", () => {
  const declineStance = material({
    materialId: "markets-we-decline",
    summary: "We decline off-mission consumer-hardware ventures outside our software focus.",
    direction: "oppose",
    confidenceWeight: 0.9,
  });
  const supportStance = material({
    materialId: "partner-network",
    summary: "We go to market through a certified reseller and MSP partner network.",
    direction: "support",
    confidenceWeight: 0.7,
  });
  const twoStances = baseInput({
    materials: [declineStance, supportStance],
    riskTier: "medium",
  });

  it("recommends DECLINING when the relevant stance opposes the decision", () => {
    const result = evaluateDecisionPerspective({
      ...twoStances,
      question: "Should we sell toasters to fishermen from kiosks on Alaskan docks?",
      relevanceByMaterialId: new Map([["markets-we-decline", 1], ["partner-network", 0]]),
      relevanceMethod: "semantic",
    });
    expect(result.stanceAlignment).toBe("decline");
    expect(result.outcomeType).toBe("recommend");
    expect(result.alignmentScore).toBeLessThan(0);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("recommends APPROVING when the relevant stance supports the decision", () => {
    const result = evaluateDecisionPerspective({
      ...twoStances,
      question: "Should we onboard an MSP as a certified reseller partner?",
      relevanceByMaterialId: new Map([["markets-we-decline", 0], ["partner-network", 1]]),
      relevanceMethod: "semantic",
    });
    expect(result.stanceAlignment).toBe("approve");
    expect(result.outcomeType).toBe("recommend");
    expect(result.alignmentScore).toBeGreaterThan(0);
  });

  it("produces OPPOSITE verdicts and different confidence for the two decisions (the core fix)", () => {
    const decline = evaluateDecisionPerspective({
      ...twoStances,
      relevanceByMaterialId: new Map([["markets-we-decline", 1], ["partner-network", 0]]),
    });
    const approve = evaluateDecisionPerspective({
      ...twoStances,
      relevanceByMaterialId: new Map([["markets-we-decline", 0], ["partner-network", 1]]),
    });
    expect(decline.stanceAlignment).toBe("decline");
    expect(approve.stanceAlignment).toBe("approve");
    expect(decline.confidenceScore).not.toEqual(approve.confidenceScore);
  });

  it("escalates when relevant support and oppose material conflict (mixed)", () => {
    const result = evaluateDecisionPerspective({
      ...twoStances,
      relevanceByMaterialId: new Map([["markets-we-decline", 1], ["partner-network", 1]]),
    });
    expect(result.stanceAlignment).toBe("mixed");
    expect(result.outcomeType).toBe("escalate");
  });

  it("escalates when no stance is relevant to the question", () => {
    const result = evaluateDecisionPerspective({
      ...twoStances,
      relevanceByMaterialId: new Map([["markets-we-decline", 0], ["partner-network", 0]]),
    });
    expect(result.outcomeType).toBe("defer");
  });

  it("LEGACY path (no relevance) returns the SAME confidence + escalate for both — the bug this fixes", () => {
    const a = evaluateDecisionPerspective({ ...twoStances, question: "off-mission?" });
    const b = evaluateDecisionPerspective({ ...twoStances, question: "on-mission?" });
    expect(a.confidenceScore).toEqual(b.confidenceScore);
    expect(a.outcomeType).toBe("escalate");
    expect(b.outcomeType).toBe("escalate");
    expect(a.stanceAlignment).toBeUndefined();
  });
});
