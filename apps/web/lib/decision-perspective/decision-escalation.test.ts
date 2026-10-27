import { describe, expect, it } from "vitest";
import { decisionAllowsStep, decisionBasisFor, withDecisionEscalation } from "./decision-escalation";

const unresolved = { outcomeType: "escalate", riskTier: "medium" } as const;

describe("decision escalation consumption", () => {
  it.each([
    [{ evaluationFault: true }, "evaluation-fault"],
    [{ policyLimitExceeded: true }, "policy-limit"],
    [{ relevanceMethod: "lexical" }, "capability-gap"],
    [{ stanceAlignment: "mixed" }, "vector-gap"],
    [{ principleConflict: true }, "vector-gap"],
    [{ coverageGap: true }, "corpus-gap"],
    [{ gapReason: "material-below-confidence" }, "corpus-gap"],
  ] as const)("classifies recorded facts without parsing rationale (%j)", (facts, expected) => {
    expect(decisionBasisFor({ ...unresolved, ...facts })).toBe(expected);
  });

  it("allows the current non-damaging review interim and records outstanding review", () => {
    const original = { ...unresolved, evaluationFault: true };
    const result = withDecisionEscalation(original, {});
    expect(result.escalation).toMatchObject({ route: "independent-review", followOn: "evaluation-fault" });
    expect(result.heldForIndependentReview).toBe(true);
    expect(decisionAllowsStep(result)).toBe(true);
    expect(original).not.toHaveProperty("escalation");
  });

  it("retains caller damage when the evaluator failed", () => {
    const result = withDecisionEscalation({ ...unresolved, evaluationFault: true }, { regulated: true });
    expect(result.escalation).toMatchObject({ route: "human", reasonCode: "damaging-regulated" });
    expect(decisionAllowsStep(result)).toBe(false);
  });

  it.each(["recommend", "arbitrate", "decline"] as const)("records a decisive %s without manufacturing review", (outcomeType) => {
    const result = withDecisionEscalation({ ...unresolved, outcomeType });
    expect(result.escalation.route).toBe("decided");
    expect(decisionAllowsStep(result)).toBe(outcomeType !== "decline");
  });

  it("does not permit an action that a current recorded stance recommends declining", () => {
    const result = withDecisionEscalation({ ...unresolved, outcomeType: "recommend", stanceAlignment: "decline" } as const);
    expect(result.escalation.route).toBe("decided");
    expect(decisionAllowsStep(result)).toBe(false);
  });

  it("never infers new permission on an unresolved legacy replay", () => {
    expect(decisionAllowsStep(unresolved)).toBe(false);
    expect(decisionAllowsStep({ ...unresolved, outcomeType: "defer" })).toBe(false);
    expect(decisionAllowsStep({ ...unresolved, outcomeType: "recommend" })).toBe(true);
  });

  it("damage overrides even a confident recommendation", () => {
    const result = withDecisionEscalation({ ...unresolved, outcomeType: "recommend", riskTier: "critical" });
    expect(result.escalation.route).toBe("human");
    expect(decisionAllowsStep(result)).toBe(false);
  });
});
