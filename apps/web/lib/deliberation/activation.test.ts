// apps/web/lib/deliberation/activation.test.ts
// Task 4 — Activation policy tests (spec §7).
//
// Covers:
//   - explicit invocation overrides stage default
//   - risk escalation upgrades review to debate
//   - no pattern for low-risk / no stage default work
//   - explicit invocation can strengthen but not weaken required policy

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the registry so activation is pure policy logic under test.
vi.mock("./registry", () => ({
  getPattern: vi.fn(),
  listPatterns: vi.fn(),
}));

import { getPattern, listPatterns } from "./registry";
import { resolve } from "./activation";
import type { ResolvedDeliberationPattern } from "./registry";

const mockGetPattern = vi.mocked(getPattern);
const mockListPatterns = vi.mocked(listPatterns);

function makePattern(
  slug: string,
  overrides: Partial<ResolvedDeliberationPattern> = {},
): ResolvedDeliberationPattern {
  return {
    patternId: `pattern-${slug}`,
    slug,
    name: slug,
    status: "active",
    purpose: `purpose for ${slug}`,
    defaultRoles: [],
    topologyTemplate: {},
    activationPolicyHints: {},
    evidenceRequirements: {},
    outputContract: {},
    providerStrategyHints: {},
    source: "db",
    ...overrides,
  };
}

describe("deliberation activation.resolve", () => {
  beforeEach(() => {
    mockGetPattern.mockReset();
    mockListPatterns.mockReset();
    // Default: both core patterns are known to the registry.
    mockGetPattern.mockImplementation(async (slug: string) => {
      if (slug === "review" || slug === "debate") {
        return makePattern(slug);
      }
      return null;
    });
    mockListPatterns.mockResolvedValue([
      makePattern("review"),
      makePattern("debate"),
    ]);
  });

  describe("explicit invocation", () => {
    it("uses the explicitly requested pattern when risk/stage do not force a stronger one", async () => {
      const result = await resolve({
        stage: "ideate",
        riskLevel: "low",
        explicitPatternSlug: "review",
        artifactType: "spec",
      });
      expect(result).not.toBeNull();
      expect(result!.patternSlug).toBe("review");
      expect(result!.triggerSource).toBe("explicit");
      expect(result!.reason).toMatch(/explicit/i);
    });

    it("returns null when the requested explicit pattern is unknown", async () => {
      const result = await resolve({
        stage: "ideate",
        riskLevel: "low",
        explicitPatternSlug: "nope-not-real",
        artifactType: "spec",
      });
      expect(result).toBeNull();
    });

    it("overrides stage default when explicit is same or stronger", async () => {
      // Stage default would be review, explicit asks for debate — debate wins.
      const result = await resolve({
        stage: "plan",
        riskLevel: "low",
        explicitPatternSlug: "debate",
        artifactType: "architecture-decision",
      });
      expect(result!.patternSlug).toBe("debate");
      expect(result!.triggerSource).toBe("explicit");
    });
  });

  describe("risk escalation", () => {
    it("escalates to debate when risk is high even with no stage", async () => {
      const result = await resolve({
        riskLevel: "high",
        artifactType: "architecture-decision",
      });
      expect(result).not.toBeNull();
      expect(result!.patternSlug).toBe("debate");
      expect(result!.triggerSource).toBe("risk");
      expect(result!.activatedRiskLevel).toBe("high");
      expect(result!.reason).toMatch(/high/i);
    });

    it("escalates to debate when risk is critical", async () => {
      const result = await resolve({
        stage: "plan",
        riskLevel: "critical",
        artifactType: "code-change",
      });
      expect(result!.patternSlug).toBe("debate");
      expect(result!.triggerSource).toBe("risk");
      expect(result!.activatedRiskLevel).toBe("critical");
    });

    it("adds review when risk is medium and no stage default applies", async () => {
      const result = await resolve({
        riskLevel: "medium",
        artifactType: "spec",
      });
      expect(result).not.toBeNull();
      expect(result!.patternSlug).toBe("review");
      expect(result!.triggerSource).toBe("risk");
      expect(result!.activatedRiskLevel).toBe("medium");
    });
  });

  describe("stage defaults", () => {
    it("applies review as default for ideate stage", async () => {
      const result = await resolve({
        stage: "ideate",
        riskLevel: "low",
        artifactType: "spec",
      });
      expect(result).not.toBeNull();
      expect(result!.patternSlug).toBe("review");
      expect(result!.triggerSource).toBe("stage");
    });

    it("applies review as default for plan stage", async () => {
      const result = await resolve({
        stage: "plan",
        riskLevel: "low",
        artifactType: "plan",
      });
      expect(result!.patternSlug).toBe("review");
      expect(result!.triggerSource).toBe("stage");
    });

    it("applies review as default for review stage", async () => {
      const result = await resolve({
        stage: "review",
        riskLevel: "low",
        artifactType: "code-change",
      });
      expect(result!.patternSlug).toBe("review");
      expect(result!.triggerSource).toBe("stage");
    });
  });

  describe("no deliberation", () => {
    it("returns null for low risk with no stage default (build)", async () => {
      const result = await resolve({
        stage: "build",
        riskLevel: "low",
        artifactType: "code-change",
      });
      expect(result).toBeNull();
    });

    it("returns null for low risk with no stage supplied", async () => {
      const result = await resolve({
        riskLevel: "low",
        artifactType: "spec",
      });
      expect(result).toBeNull();
    });

    it("returns null for ship stage with low risk", async () => {
      const result = await resolve({
        stage: "ship",
        riskLevel: "low",
        artifactType: "code-change",
      });
      expect(result).toBeNull();
    });
  });

  describe("strengthen but not weaken", () => {
    it("keeps debate when risk requires it and user asks for review", async () => {
      // High risk requires debate; explicit review is weaker — cannot weaken.
      const result = await resolve({
        stage: "plan",
        riskLevel: "high",
        explicitPatternSlug: "review",
        artifactType: "architecture-decision",
      });
      expect(result!.patternSlug).toBe("debate");
      // Triggered by both — explicit attempted, risk overruled.
      expect(result!.triggerSource).toBe("combined");
      expect(result!.reason.toLowerCase()).toContain("high");
    });

    it("respects explicit debate when risk only requires review", async () => {
      // Medium risk would trigger review; explicit debate strengthens it — accept.
      const result = await resolve({
        riskLevel: "medium",
        explicitPatternSlug: "debate",
        artifactType: "architecture-decision",
      });
      expect(result!.patternSlug).toBe("debate");
      expect(result!.triggerSource).toBe("combined");
    });

    it("reports combined trigger when explicit matches stage default", async () => {
      // Stage default is review, explicit is review — still explicit wins (combined).
      const result = await resolve({
        stage: "plan",
        riskLevel: "low",
        explicitPatternSlug: "review",
        artifactType: "spec",
      });
      expect(result!.patternSlug).toBe("review");
      // Explicit should be honored as the trigger when both match.
      expect(["explicit", "combined"]).toContain(result!.triggerSource);
    });
  });

  describe("output shape", () => {
    it("populates strategyProfile and diversityMode from pattern hints", async () => {
      mockGetPattern.mockImplementation(async (slug: string) => {
        if (slug === "review") {
          return makePattern("review", {
            providerStrategyHints: {
              preferredDiversityMode: "multi-model-same-provider",
              strategyProfile: "balanced",
            },
          });
        }
        return null;
      });

      const result = await resolve({
        stage: "plan",
        riskLevel: "low",
        artifactType: "plan",
      });
      expect(result!.strategyProfile).toBe("balanced");
      expect(result!.diversityMode).toBe("multi-model-same-provider");
    });

    it("falls back to safe defaults when pattern has no strategy hints", async () => {
      mockGetPattern.mockImplementation(async (slug: string) => {
        if (slug === "review") {
          return makePattern("review", { providerStrategyHints: {} });
        }
        return null;
      });

      const result = await resolve({
        stage: "plan",
        riskLevel: "low",
        artifactType: "plan",
      });
      expect(result!.strategyProfile).toBe("balanced");
      expect(result!.diversityMode).toBe("single-model-multi-persona");
    });

    it("reason is a single sentence", async () => {
      const result = await resolve({
        stage: "plan",
        riskLevel: "low",
        artifactType: "plan",
      });
      expect(result!.reason).toBeTruthy();
      // One sentence: no period-newline splits producing >1 chunk.
      const sentences = result!.reason
        .split(/[.!?]\s+/)
        .filter((s) => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(1);
    });
  });
});

// BI-1A5204A0 — routing confidence as an activation axis.
//
// The regression this guards is the observed 2026-09-18 incident: a route that
// resolved with one candidate and a relaxed floor ran below the bar and nothing
// happened, because qualityFloorRelaxed was concatenated into a sentence that
// nothing read.
describe("resolve — routing confidence", () => {
  it("activates a review when the floor was relaxed on otherwise low-risk work", async () => {
    const run = await resolve({
      riskLevel: "low",
      artifactType: "code-change",
      routingConfidence: { qualityFloorRelaxed: true, candidateCount: 1 },
    });
    expect(run?.patternSlug).toBe("review");
    expect(run?.routingConfidenceEscalated).toBe(true);
    expect(run?.reason).toContain("quality bar");
  });

  it("escalates to debate when the winner is well short of the floor on work that is not already low-risk", async () => {
    // From medium: the one-rung bound (BI-2A67FAE2) permits medium -> high, and
    // high means debate. From low the same signal is capped at review, which is
    // the bound doing its job rather than the signal being ignored.
    const run = await resolve({
      riskLevel: "medium",
      artifactType: "code-change",
      routingConfidence: { qualityFloorRelaxed: true, floorShortfall: 40 },
    });
    expect(run?.patternSlug).toBe("debate");
    expect(run?.reason).toContain("well short");
  });

  it("activates on a single ranked candidate — no choice was made, only an outcome", async () => {
    const run = await resolve({
      riskLevel: "low",
      artifactType: "code-change",
      routingConfidence: { candidateCount: 1 },
    });
    expect(run?.patternSlug).toBe("review");
    expect(run?.reason).toContain("only one model");
  });

  it("changes nothing when routing was confident — the byte-identical guard", async () => {
    const withSignal = await resolve({
      riskLevel: "low",
      artifactType: "code-change",
      routingConfidence: { candidateCount: 9, qualityFloorRelaxed: false },
    });
    const without = await resolve({ riskLevel: "low", artifactType: "code-change" });
    expect(withSignal).toEqual(without);
  });

  it("never weakens what declared risk already requires", async () => {
    const run = await resolve({
      riskLevel: "critical",
      artifactType: "code-change",
      routingConfidence: { candidateCount: 12 },
    });
    expect(run?.patternSlug).toBe("debate");
    expect(run?.activatedRiskLevel).toBe("critical");
    expect(run?.routingConfidenceEscalated).toBeUndefined();
  });

  it("does not claim an escalation it did not cause", async () => {
    // Risk already demands debate; confidence would only have asked for review.
    const run = await resolve({
      riskLevel: "high",
      artifactType: "code-change",
      routingConfidence: { qualityFloorRelaxed: true },
    });
    expect(run?.patternSlug).toBe("debate");
    expect(run?.routingConfidenceEscalated).toBeUndefined();
    expect(run?.reason).not.toContain("Raised because");
  });
});

// BI-2A67FAE2 — the cost bound, through the resolver.
describe("resolve — escalation cost bound", () => {
  it("caps a confidence escalation at one step on low-risk work", async () => {
    const run = await resolve({
      riskLevel: "low",
      artifactType: "code-change",
      // Well short of the floor infers "high", which would mean debate.
      routingConfidence: { qualityFloorRelaxed: true, floorShortfall: 40 },
      costPosture: "balanced",
    });
    expect(run?.patternSlug).toBe("review");
  });

  it("does not escalate at all under an economy posture", async () => {
    const run = await resolve({
      riskLevel: "low",
      artifactType: "code-change",
      routingConfidence: { qualityFloorRelaxed: true, floorShortfall: 40 },
      costPosture: "economy",
    });
    expect(run).toBeNull();
  });

  it("economy still honours a stage default — it is a cost choice, not a policy dodge", async () => {
    const run = await resolve({
      stage: "review",
      riskLevel: "low",
      artifactType: "code-change",
      routingConfidence: { qualityFloorRelaxed: true },
      costPosture: "economy",
    });
    expect(run?.patternSlug).toBe("review");
  });
});

// BI-0FC71985 — the resolved run states what its review is worth.
describe("resolve — reviewer independence", () => {
  it("grades every activated run, so independence is never assumed", async () => {
    const run = await resolve({
      stage: "review",
      riskLevel: "low",
      artifactType: "code-change",
      reviewerPool: { providerCount: 3, modelCount: 8 },
    });
    expect(run?.independence?.mode).toBeTruthy();
    expect(run?.independence?.note).toBeTruthy();
  });

  it("reports the weakest grade on a single-model install rather than claiming more", async () => {
    const run = await resolve({
      stage: "review",
      riskLevel: "low",
      artifactType: "code-change",
      reviewerPool: { providerCount: 1, modelCount: 1 },
    });
    expect(run?.independence?.mode).toBe("single-model-multi-persona");
    expect(run?.diversityMode).toBe("single-model-multi-persona");
    expect(run?.independence?.note).toContain("not systematic bias");
  });

  it("marks the grade unverified when no pool was reported", async () => {
    const run = await resolve({ stage: "review", riskLevel: "low", artifactType: "code-change" });
    expect(run?.independence?.verified).toBe(false);
    expect(run?.independence?.note).toContain("Not verified");
  });
});
