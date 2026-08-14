import { describe, expect, it, vi } from "vitest";

import { runAlignmentSpecialistDelegation } from "./alignment-specialist-delegation";
import { composeAlignmentVerdicts } from "./alignment-tool-gate";

const alignment = {
  verdict: "approve" as const,
  criteria: {
    status: "complete" as const,
    criteria: {
      market: "b2b software / msp partner", segment: "b2b software",
      product: "self-host support subscription", motion: "partner channel",
      geography: null, customerType: "msp partner",
    },
    evidence: ["product=self-host support subscription", "motion=partner channel"],
    missing: ["geography" as const],
  },
  checks: [],
  veto: null,
};

function professionResult(over: Record<string, unknown> = {}) {
  return {
    allowed: true,
    interactionId: "DI-WSID",
    professionProfileSelected: true,
    professionKey: "portfolio-management",
    operatorMessage: "grounded in current craft",
    evaluation: {
      outcomeType: "recommend",
      recommendedOptionId: "aligned",
      coverageGap: false,
      materialCount: 2,
      freshnessDistribution: { current: 2, stale: 0, superseded: 0, contradicted: 0 },
      sources: [{ materialId: "mat-1" }],
    },
    ...over,
  };
}

describe("alignment specialist delegation", () => {
  it("intersects WWWD and WSID monotonically", () => {
    expect(composeAlignmentVerdicts("approve", "approve")).toBe("approve");
    expect(composeAlignmentVerdicts("approve", "escalate")).toBe("escalate");
    expect(composeAlignmentVerdicts("approve", "decline")).toBe("decline");
    expect(composeAlignmentVerdicts("decline", "approve")).toBe("decline");
  });

  it("routes product and GTM checks through their corpus owners and records custody", async () => {
    const evaluateProfession = vi.fn(async (input: { agentIdentity: { agentId: string } }) =>
      professionResult(input.agentIdentity.agentId === "marketing-specialist"
        ? { professionKey: "marketing", interactionId: "DI-GTM" }
        : {}),
    );
    const recordDelegation = vi.fn(async (input: { toAgentId: string }) => `CHAIN-${input.toAgentId}`);
    const result = await runAlignmentSpecialistDelegation({
      alignment, statement: "Offer self-host support through MSP partners",
      userId: "user-1", coordinatorAgentId: "AGT-COORD",
      evaluateProfession: evaluateProfession as never, recordDelegation,
    });

    expect(evaluateProfession).toHaveBeenCalledTimes(2);
    expect(evaluateProfession.mock.calls.map(([input]) => input.agentIdentity.agentId))
      .toEqual(["portfolio-backlog-agent", "marketing-specialist"]);
    expect(result.verdict).toBe("approve");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ corpus: "portfolio", qualification: "qualified", delegationChainId: "CHAIN-portfolio-backlog-agent" }),
      expect.objectContaining({ corpus: "gtm", qualification: "qualified", delegationChainId: "CHAIN-marketing-specialist" }),
    ]));
    expect(result.permissionGranted).toBe(false);
  });

  it.each([
    ["absent", { professionProfileSelected: false }],
    ["stale", { evaluation: { ...professionResult().evaluation, freshnessDistribution: { current: 1, stale: 1, superseded: 0, contradicted: 0 } } }],
    ["out-of-scope", { professionKey: "marketing" }],
  ])("fails closed for %s qualification", async (_label, over) => {
    const result = await runAlignmentSpecialistDelegation({
      alignment: { ...alignment, criteria: { ...alignment.criteria, criteria: { ...alignment.criteria.criteria, motion: null } } },
      statement: "Offer self-host support", userId: "user-1", coordinatorAgentId: "AGT-COORD",
      evaluateProfession: (async () => professionResult(over)) as never,
      recordDelegation: async () => "CHAIN-1",
    });
    expect(result.verdict).toBe("escalate");
    expect(result.checks[0]?.qualification).not.toBe("qualified");
    expect(result.permissionGranted).toBe(false);
  });

  it("lets a qualified WSID rejection veto while never turning qualification into permission", async () => {
    const result = await runAlignmentSpecialistDelegation({
      alignment: { ...alignment, criteria: { ...alignment.criteria, criteria: { ...alignment.criteria.criteria, motion: null } } },
      statement: "Offer an unsupported product", userId: "user-1", coordinatorAgentId: "AGT-COORD",
      evaluateProfession: (async () => professionResult({
        evaluation: { ...professionResult().evaluation, recommendedOptionId: "rejected" },
      })) as never,
      recordDelegation: async () => "CHAIN-1",
    });
    expect(result.verdict).toBe("decline");
    expect(result.permissionGranted).toBe(false);
  });
});
