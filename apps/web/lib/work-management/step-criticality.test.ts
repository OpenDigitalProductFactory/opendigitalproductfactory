import { describe, expect, it } from "vitest";

import { READINESS_SHAPES } from "@/lib/backlog/initiative-readiness/types";
import { DECISION_RISK_TIERS } from "@/lib/decision-perspective/types";
import {
  resolveStepCriticality,
  resolveStepReviewNeed,
  STEP_CRITICALITIES,
  type StepCriticalityInput,
} from "./step-criticality";

const routine: StepCriticalityInput = {
  effectiveShape: "small",
  advanceKind: "status-change",
  riskTier: "low",
  damaging: false,
};

describe("resolveStepCriticality", () => {
  it.each([
    ["break-fix", "routine"],
    ["small", "routine"],
    ["medium", "consequential"],
    ["large", "critical"],
    ["xlarge", "critical"],
  ] as const)("uses the effective %s shape floor", (effectiveShape, expected) => {
    expect(resolveStepCriticality({ ...routine, effectiveShape })).toBe(expected);
  });

  it("keeps a small governed advance consequential even at low transition risk", () => {
    expect(resolveStepCriticality({ ...routine, advanceKind: "governed-decision" }))
      .toBe("consequential");
  });

  it.each([
    ["low", "routine"],
    ["medium", "routine"],
    ["high", "consequential"],
    ["critical", "critical"],
  ] as const)("applies the %s transition risk floor", (riskTier, expected) => {
    expect(resolveStepCriticality({ ...routine, riskTier })).toBe(expected);
  });

  it("keeps explicit damage critical in a small repair", () => {
    expect(resolveStepCriticality({ ...routine, effectiveShape: "break-fix", damaging: true }))
      .toBe("critical");
  });

  it("can raise a stage's floor but cannot lower a large room or critical transition", () => {
    expect(resolveStepCriticality({ ...routine, declaredCriticality: "critical" })).toBe("critical");
    expect(resolveStepCriticality({ ...routine, effectiveShape: "large", declaredCriticality: "routine" }))
      .toBe("critical");
    expect(resolveStepCriticality({ ...routine, riskTier: "critical", declaredCriticality: "routine" }))
      .toBe("critical");
  });

  it("never lowers any recorded floor across all input combinations", () => {
    const rank = (value: string) => STEP_CRITICALITIES.indexOf(value as typeof STEP_CRITICALITIES[number]);
    for (const effectiveShape of READINESS_SHAPES) {
      for (const advanceKind of ["status-change", "governed-decision"] as const) {
        for (const riskTier of DECISION_RISK_TIERS) {
          for (const damaging of [false, true]) {
            for (const declaredCriticality of [undefined, ...STEP_CRITICALITIES]) {
              const combined = rank(resolveStepCriticality({ effectiveShape, advanceKind, riskTier, damaging, declaredCriticality }));
              const signals: StepCriticalityInput[] = [
                { ...routine, effectiveShape },
                { ...routine, advanceKind },
                { ...routine, riskTier },
                { ...routine, damaging },
                { ...routine, declaredCriticality },
              ];
              for (const signal of signals) {
                expect(combined, JSON.stringify({ effectiveShape, advanceKind, riskTier, damaging, declaredCriticality, signal }))
                  .toBeGreaterThanOrEqual(rank(resolveStepCriticality(signal)));
              }
            }
          }
        }
      }
    }
  });
});


describe("review need from the room and step", () => {
  it("draws different review depth for identical comment-only files in small and large rooms", () => {
    const changed = { ...routine, collaborationShape: "change-consequential" as const, impactedProfessions: ["ux-design"], requiredProfessions: [] };
    expect(resolveStepReviewNeed(changed)).toMatchObject({ criticality: "routine", authority: "advisory", requiredReviewProfessions: [] });
    const large = resolveStepReviewNeed({ ...changed, effectiveShape: "large" });
    expect(large).toMatchObject({ criticality: "critical", authority: "blocking" });
    expect(large.requiredReviewProfessions).toEqual(expect.arrayContaining(["ux-design", "enterprise-architecture"]));
  });
  it("retains every declared or impacted family beyond the old cap", () => {
    const need = resolveStepReviewNeed({ ...routine, effectiveShape: "medium", impactedProfessions: ["ux-design", "security", "finance", "data-architect"], requiredProfessions: ["release-service-management"] });
    expect(need.requiredReviewProfessions).toHaveLength(5);
    expect(need.authority).toBe("blocking");
  });
  it("keeps a declared craft obligation on a routine step and rejects invented families", () => {
    expect(resolveStepReviewNeed({ ...routine, impactedProfessions: [], requiredProfessions: ["ux-design"] }).requiredReviewProfessions).toContain("ux-design");
    expect(() => resolveStepReviewNeed({ ...routine, impactedProfessions: [], requiredProfessions: ["invented"] })).toThrow(/registered profession/i);
  });
  it("narrows stewardship review depth without lowering criticality or the damaging human boundary", () => {
    const input = { ...routine, effectiveShape: "large" as const, collaborationShape: "craft-stewardship" as const, impactedProfessions: ["ux-design"], requiredProfessions: [] };
    expect(resolveStepReviewNeed(input)).toMatchObject({ criticality: "critical", authority: "blocking", requiredReviewProfessions: ["ux-design"] });
    const damaging = resolveStepReviewNeed({ ...input, damaging: true });
    expect(damaging.authority).toBe("blocking-with-person");
    expect(damaging.requiredReviewProfessions).toContain("enterprise-architecture");
  });
});
