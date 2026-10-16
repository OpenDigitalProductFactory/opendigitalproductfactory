import { describe, expect, it } from "vitest";

import { READINESS_SHAPES } from "@/lib/backlog/initiative-readiness/types";
import { DECISION_RISK_TIERS } from "@/lib/decision-perspective/types";
import {
  resolveStepCriticality,
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
