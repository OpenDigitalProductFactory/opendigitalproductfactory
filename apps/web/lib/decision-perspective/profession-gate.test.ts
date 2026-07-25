import { describe, expect, it, vi } from "vitest";

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { resolveProfileMaterialForProfession } from "./material";
import { evaluateProfessionDecisionGate } from "./profession-gate";
import type {
  DecisionDomainClass,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
} from "./types";

const DOMAIN: DecisionDomainClass = "professional-practice";

function makeProfile(profileId: string): DecisionPerspectiveProfile {
  return { ...MARK_DPF_PLATFORM_PROFILE, profileId };
}

function makeEval(
  over: Partial<DecisionPerspectiveEvaluationResult> = {},
): DecisionPerspectiveEvaluationResult {
  return {
    outcomeType: "recommend",
    selectedProfileId: "wsid-data-architect",
    fallbackProfileId: null,
    profileVersionId: "wsid-data-architect-v1",
    confidenceBefore: 0.8,
    confidenceAfter: 0.8,
    confidenceScore: 0.8,
    coverageGap: false,
    principleConflict: false,
    domainClass: DOMAIN,
    resolvedProfileChain: ["wsid-data-architect"],
    materialCount: 1,
    freshnessDistribution: { current: 1, stale: 0, superseded: 0, contradicted: 0 },
    riskTier: "medium",
    question: "q",
    options: ["a", "b"],
    rationale: "the craft corpus supports it",
    materialScores: [],
    sources: [],
    ...over,
  };
}

function makeDb() {
  return {
    decisionInteraction: {
      create: vi
        .fn()
        .mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "row-1", ...args.data })),
    },
  };
}

function fakeResolver(over: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    selectedProfileId: "wsid-data-architect",
    selectedProfile: makeProfile("wsid-data-architect"),
    resolvedProfileChain: ["wsid-data-architect"],
    coverageGap: false,
    materials: [],
    professionProfileSelected: true,
    professionKey: "data-architect",
    ...over,
  });
}

const base = {
  agentIdentity: { agentId: "AGT-DATA-ARCH", slugId: "build-data-architect" },
  question: "Should this schema merge land behind a compatibility view?",
  options: ["Compatibility view", "Hard cutover"],
  domainClass: DOMAIN,
  riskTier: "medium" as const,
  routeContext: "/coworker",
};

describe("evaluateProfessionDecisionGate", () => {
  it("decides from the profession's own profile and records professionProfileSelected=true", async () => {
    const db = makeDb();
    const result = await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver() as never,
      evaluator: () => makeEval({ outcomeType: "recommend" }),
    });

    expect(result.professionProfileSelected).toBe(true);
    expect(result.professionKey).toBe("data-architect");
    expect(result.allowed).toBe(true);
    expect(result.operatorMessage).toMatch(/data-architect profession's recorded craft/);

    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.routeContext).toBe("/coworker");
    const payload = data.outcomePayload as {
      professionProfileSelected?: boolean;
      professionKey?: string;
    };
    expect(payload.professionProfileSelected).toBe(true);
    expect(payload.professionKey).toBe("data-architect");
    expect(data.gateKey).toBe("profession");
    expect(data.gateFallbackUsed).toBe(false);
  });

  const commandmentRow = {
    id: "c1",
    title: "Architecture Over Shortcuts",
    principleTier: "commandment",
    principleWeight: null,
    principleDimensionVector: { long_term_maintainability: 0.8, speed_to_value: -0.3 },
  };

  it("records a real recommendedOptionId + scoredOptions when the caller supplies option features and the verdict is a path forward (BI-6DCF772F)", async () => {
    const db = {
      ...makeDb(),
      wikiPage: { findMany: vi.fn().mockResolvedValue([commandmentRow]) },
    };
    const scoredOptions = [
      { id: "Compatibility view", description: "Compatibility view", features: { long_term_maintainability: 0.9, speed_to_value: 0.2 } },
      { id: "Hard cutover", description: "Hard cutover", features: { long_term_maintainability: 0.2, speed_to_value: 0.9 } },
    ];
    await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      scoredOptions,
      resolver: fakeResolver() as never,
      evaluator: (input) => makeEval({ outcomeType: "recommend", scoredOptions: input.scoredOptions }),
    });

    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    // Compatibility view wins: high long_term_maintainability (weighted +), low speed_to_value (weighted -).
    expect(data.recommendedOptionId).toBe("Compatibility view");
    expect(data.scoredOptions).toEqual(scoredOptions);
  });

  it("records NO recommendedOptionId for an escalate verdict even when option features are supplied", async () => {
    const db = {
      ...makeDb(),
      wikiPage: { findMany: vi.fn() },
    };
    await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      scoredOptions: [{ id: "a", description: "a", features: { long_term_maintainability: 1 } }],
      resolver: fakeResolver() as never,
      evaluator: (input) => makeEval({ outcomeType: "escalate", scoredOptions: input.scoredOptions }),
    });

    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.recommendedOptionId ?? null).toBeNull();
    // The commandment lookup is never even attempted when the verdict isn't a path forward.
    expect(db.wikiPage.findMany).not.toHaveBeenCalled();
  });

  it("falls back to platform as ADVISORY when the craft corpus is silent", async () => {
    const db = makeDb();
    const result = await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver({
        selectedProfileId: MARK_DPF_PLATFORM_PROFILE.profileId,
        selectedProfile: MARK_DPF_PLATFORM_PROFILE,
        resolvedProfileChain: ["wsid-data-architect", MARK_DPF_PLATFORM_PROFILE.profileId],
        professionProfileSelected: false,
      }) as never,
      evaluator: () => makeEval({ selectedProfileId: MARK_DPF_PLATFORM_PROFILE.profileId }),
    });

    expect(result.professionProfileSelected).toBe(false);
    expect(result.operatorMessage).toMatch(/platform defaults/);

    // BI-1BE30A9A: doctrine fell back to the platform profile, so tiering on
    // the resolved profile would have filed this WSID decision under WWMD and
    // left the WSID tier reading "never used". The gate key must survive the
    // fallback; gateFallbackUsed preserves the "not its own craft" signal.
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.profileId).toBe(MARK_DPF_PLATFORM_PROFILE.profileId);
    expect(data.gateKey).toBe("profession");
    expect(data.gateFallbackUsed).toBe(true);
  });

  it("coverage gap forces defer and is not allowed", async () => {
    const db = makeDb();
    const result = await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver({ coverageGap: true, professionProfileSelected: false }) as never,
      evaluator: () => makeEval({ outcomeType: "recommend" }),
    });
    expect(result.evaluation.outcomeType).toBe("defer");
    expect(result.evaluation.rationale).toMatch(/data-architect profession corpus/);
    expect(result.allowed).toBe(false);
  });

  it("fail-closed: a resolver error escalates and is still recorded", async () => {
    const db = makeDb();
    const result = await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      resolver: vi.fn().mockRejectedValue(new Error("db down")) as never,
    });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.outcomeType).toBe("escalate");
    expect(result.evaluation.rationale).toMatch(/fail-closed/);
    expect(db.decisionInteraction.create).toHaveBeenCalled();
    // Even the fail-closed row belongs to WSID — an escalation the operator
    // must see in the tier whose gate produced it.
    const data = db.decisionInteraction.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.gateKey).toBe("profession");
  });

  it("unbound coworker (no profession family) defers with the unbound message", async () => {
    const db = makeDb();
    const result = await evaluateProfessionDecisionGate({
      ...base,
      db: db as never,
      resolver: fakeResolver({
        coverageGap: true,
        professionProfileSelected: false,
        professionKey: null,
        selectedProfileId: null,
        selectedProfile: null,
      }) as never,
      evaluator: () => makeEval(),
    });
    expect(result.professionKey).toBeNull();
    expect(result.evaluation.outcomeType).toBe("defer");
    expect(result.evaluation.rationale).toMatch(/no profession family/);
  });
});

describe("resolveProfileMaterialForProfession", () => {
  function materialRow(profileId: string) {
    return {
      materialId: "m-1",
      profileId,
      sourceType: "wiki",
      sourceRef: {},
      summary: "s",
      domainClass: DOMAIN,
      direction: "support",
      domains: [],
      freshness: "current",
      evidenceGrade: "A",
      confidenceWeight: 1,
      reviewStatus: "approved",
      promotionState: "promoted",
      lastValidatedAt: null,
    };
  }

  function profileRow(profileId: string) {
    return {
      profileId,
      name: profileId,
      kind: "profession",
      scope: {},
      fallbackProfileId: null,
      defaultResolver: null,
      autonomyPolicy: null,
      currentVersion: { versionId: `${profileId}-v1`, versionNumber: 1 },
    };
  }

  it("enters at wsid-<key> for a registry-mapped coworker and flags professionProfileSelected", async () => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi.fn().mockImplementation(async (args: { where: { profileId: string } }) =>
          args.where.profileId === "wsid-data-architect" ? profileRow("wsid-data-architect") : null,
        ),
      },
      perspectiveMaterial: {
        findMany: vi.fn().mockResolvedValue([materialRow("wsid-data-architect")]),
      },
    };

    const resolved = await resolveProfileMaterialForProfession({
      db: db as never,
      // build-data-architect is in the data-architect family roles[] in
      // docs/professions/registry.json (the seed invariant).
      agentIdentity: { slugId: "build-data-architect" },
      domainClass: DOMAIN,
    });

    expect(resolved.professionKey).toBe("data-architect");
    expect(resolved.resolvedProfileChain[0]).toBe("wsid-data-architect");
    expect(resolved.professionProfileSelected).toBe(true);
    expect(resolved.coverageGap).toBe(false);
  });

  it("unbound identity enters at the platform fallback with professionProfileSelected=false", async () => {
    const db = {
      decisionPerspectiveProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      perspectiveMaterial: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const resolved = await resolveProfileMaterialForProfession({
      db: db as never,
      agentIdentity: { slugId: "not-a-real-role-xyz" },
      domainClass: DOMAIN,
    });

    expect(resolved.professionKey).toBeNull();
    expect(resolved.professionProfileSelected).toBe(false);
    expect(resolved.resolvedProfileChain[0]).toBe(MARK_DPF_PLATFORM_PROFILE.profileId);
  });

  it("mapped coworker with an empty craft corpus yields coverageGap, not a false selection", async () => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi.fn().mockImplementation(async (args: { where: { profileId: string } }) =>
          args.where.profileId === "wsid-data-architect" ? profileRow("wsid-data-architect") : null,
        ),
      },
      perspectiveMaterial: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const resolved = await resolveProfileMaterialForProfession({
      db: db as never,
      agentIdentity: { slugId: "build-data-architect" },
      domainClass: DOMAIN,
    });

    expect(resolved.professionKey).toBe("data-architect");
    expect(resolved.coverageGap).toBe(true);
    expect(resolved.professionProfileSelected).toBe(false);
  });
});
