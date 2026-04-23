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
