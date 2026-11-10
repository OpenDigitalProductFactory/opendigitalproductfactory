import { beforeEach, describe, expect, it, vi } from "vitest";

const agentMock = vi.hoisted(() => vi.fn());
const directionDb = vi.hoisted(() => ({ org: null as { id: string } | null }));
vi.mock("@dpf/db", () => ({
  prisma: {
    agent: { findFirst: (...args: unknown[]) => agentMock(...args) },
    organization: { findFirst: async () => directionDb.org },
    businessContext: { findUnique: async () => ({ mission: "Serve MSPs", vision: null }) },
    instanceOutcome: { findMany: async () => [{ id: "o1", statement: "Ten partners", measure: null }] },
    instanceDirectionRevision: { findFirst: async () => ({ version: 3 }) },
  },
}));

const gateMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/decision-perspective/profession-gate", () => ({
  evaluateProfessionDecisionGate: (...args: unknown[]) => gateMock(...args),
}));

import { professionDecisionPack } from "./profession-decision-pack";

beforeEach(() => {
  vi.clearAllMocks();
  agentMock.mockResolvedValue({ agentId: "AGT-1", name: "Data Architect", slugId: "build-data-architect" });
  gateMock.mockResolvedValue({
    interactionId: "DI-1",
    allowed: true,
    evaluation: { outcomeType: "recommend", confidenceScore: 0.8, recommendedOptionId: "view", rationale: "ok" },
    professionKey: "data-architect",
    professionProfileSelected: true,
  });
});

describe("profession-decision pack — evaluate_profession_decision optionFeatures (BI-6DCF772F)", () => {
  it("rejects optionFeatures that don't align 1:1 with options, before invoking the gate", async () => {
    const res = await professionDecisionPack.handlers.evaluate_profession_decision!(
      {
        question: "Compatibility view or hard cutover?",
        options: ["view", "cutover"],
        optionFeatures: [{ long_term_maintainability: 0.9 }], // one, options has two
        domainClass: "professional-practice",
        riskTier: "medium",
      },
      "user-1",
      { agentId: "AGT-1" },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_params");
    expect(String(res.message)).toMatch(/aligned 1:1 with options/);
    expect(gateMock).not.toHaveBeenCalled();
  });

  it("threads caller-supplied optionFeatures into the gate as scoredOptions and surfaces recommendedOptionId", async () => {
    const res = await professionDecisionPack.handlers.evaluate_profession_decision!(
      {
        question: "Compatibility view or hard cutover?",
        options: ["view", "cutover"],
        optionFeatures: [{ long_term_maintainability: 0.9 }, { speed_to_value: 0.9 }],
        domainClass: "professional-practice",
        riskTier: "medium",
      },
      "user-1",
      { agentId: "AGT-1" },
    );

    expect(res.success).toBe(true);
    expect(gateMock).toHaveBeenCalledTimes(1);
    const gateArgs = gateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(gateArgs.scoredOptions).toEqual([
      { id: "view", description: "view", features: { long_term_maintainability: 0.9 } },
      { id: "cutover", description: "cutover", features: { speed_to_value: 0.9 } },
    ]);
    expect((res.data as Record<string, unknown>).recommendedOptionId).toBe("view");
  });

  it("omitting optionFeatures leaves scoredOptions undefined (coverage-only, backward compatible)", async () => {
    await professionDecisionPack.handlers.evaluate_profession_decision!(
      { question: "Q", options: ["a", "b"], domainClass: "professional-practice", riskTier: "medium" },
      "user-1",
      { agentId: "AGT-1" },
    );
    const gateArgs = gateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(gateArgs.scoredOptions).toBeUndefined();
  });

  it("requires an agent identity (profession decisions are coworker-scoped)", async () => {
    const res = await professionDecisionPack.handlers.evaluate_profession_decision!(
      { question: "Q", options: ["a", "b"], domainClass: "professional-practice", riskTier: "medium" },
      "user-1",
      undefined,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("no_agent_identity");
    expect(gateMock).not.toHaveBeenCalled();
  });
});

describe("profession-decision pack — instance direction on the WSID ledger (BI-8AB6B4F7)", () => {
  const params = { question: "q", options: ["a", "b"], domainClass: "professional-practice", riskTier: "medium" };

  it("records which direction refs the decision read", async () => {
    directionDb.org = { id: "org-1" };
    await professionDecisionPack.handlers.evaluate_profession_decision!(params, "user-1", { agentId: "AGT-1" });
    const gateArgs = gateMock.mock.calls[0]![0] as { outcomePayloadExtra?: Record<string, unknown> };
    expect(gateArgs.outcomePayloadExtra?.instanceDirection).toEqual({
      recorded: true,
      version: 3,
      refs: ["direction:mission@v3", "direction:outcome:o1@v3"],
      missing: ["vision"],
    });
  });

  it("says nothing was recorded when there is no organization, never a default", async () => {
    directionDb.org = null;
    await professionDecisionPack.handlers.evaluate_profession_decision!(params, "user-1", { agentId: "AGT-1" });
    const gateArgs = gateMock.mock.calls[0]![0] as { outcomePayloadExtra?: Record<string, unknown> };
    expect(gateArgs.outcomePayloadExtra?.instanceDirection).toMatchObject({ recorded: false, refs: [] });
  });
});
