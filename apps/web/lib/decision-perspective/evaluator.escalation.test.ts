import { describe, expect, it, vi } from "vitest";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateDecisionPerspective, evaluatePerspectiveGate } from "./evaluator";
import type { DecisionPerspectiveEvaluationResult } from "./types";

const base = { question: "May this bounded step proceed?", options: ["proceed", "hold"],
  domainClass: "plan-readiness" as const, riskTier: "medium" as const,
  routeContext: "/build", recentOverrideCount: 0 };
function makeEval(overrides: Partial<DecisionPerspectiveEvaluationResult> = {}) {
  return { ...evaluateDecisionPerspective({ profile: MARK_DPF_PLATFORM_PROFILE, materials: [],
    question: base.question, options: base.options, questionDomain: base.domainClass, riskTier: base.riskTier }), ...overrides };
}
function fixture() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
  return { db: { decisionInteraction: { create } }, resolver: vi.fn(async () => ({
    selectedProfile: MARK_DPF_PLATFORM_PROFILE, orgProfileSelected: false, materials: [],
    resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId], coverageGap: false,
  })) };
}

describe("perspective gate uses recorded escalation", () => {
  it("routes uncertainty to independent review under the recorded interim", async () => {
    const f = fixture();
    const result = await evaluatePerspectiveGate({ ...base, ...f, evaluator: () => makeEval() });
    expect(result.evaluation.escalation?.route).toBe("independent-review");
    expect(result.allowed).toBe(true);
    expect(result.operatorMessage).toMatch(/independent review/i);
    expect(f.db.decisionInteraction.create.mock.calls[0]?.[0].data.escalationRoute).toBe("independent_review");
  });

  it("a threshold declaration wins over a confident recommendation", async () => {
    const result = await evaluatePerspectiveGate({ ...base, ...fixture(), declarations: { thresholdExceeded: true },
      evaluator: () => makeEval({ outcomeType: "recommend", confidenceScore: 0.99 }) });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.escalation?.reasonCode).toBe("damaging-threshold");
    expect(result.operatorMessage).toMatch(/threshold/i);
  });

  it("takes risk from the caller even if an evaluator returns a different tier", async () => {
    const result = await evaluatePerspectiveGate({ ...base, ...fixture(), riskTier: "critical",
      evaluator: () => makeEval({ outcomeType: "recommend", riskTier: "low" }) });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.escalation?.reasonCode).toBe("damaging-critical-risk");
  });

  it.each(["medium", "critical"] as const)("keeps caller risk during a resolver fault (%s)", async (riskTier) => {
    const f = fixture();
    f.resolver.mockRejectedValue(new Error("resolver unavailable"));
    const result = await evaluatePerspectiveGate({ ...base, ...f, riskTier });
    expect(result.evaluation.evaluationFault).toBe(true);
    expect(result.evaluation.escalation?.route).toBe(riskTier === "critical" ? "human" : "independent-review");
    expect(result.allowed).toBe(riskTier !== "critical");
  });

  it("records an evaluator fault without erasing a regulated declaration", async () => {
    const result = await evaluatePerspectiveGate({ ...base, ...fixture(), declarations: { regulated: true },
      evaluator: () => { throw new Error("evaluator unavailable"); } });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.escalation?.reasonCode).toBe("damaging-regulated");
  });
});
