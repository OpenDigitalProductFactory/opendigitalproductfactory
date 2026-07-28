import { describe, expect, it } from "vitest";

import {
  evaluateAutonomousBuildEligibility,
  type AutonomousBuildEligibilityInput,
} from "./autonomous-build-eligibility";

const BASE_INPUT: AutonomousBuildEligibilityInput = {
  checkpoint: "intake",
  sensitivity: "low",
  workType: "feature",
  effortSize: "medium",
  gateOutcome: "recommend",
  oracles: "green",
  attribution: {
    bindingStatus: "active",
    patternVersion: 2,
    scopeMatches: true,
    evidenceFresh: true,
  },
  providerReady: true,
  sandboxState: "ready",
  regulatory: {
    ceiling: "autopilot",
    humanControlRequired: false,
  },
  recoveryBudgetExhausted: false,
  deliveryStatus: null,
};

describe("evaluateAutonomousBuildEligibility", () => {
  it("allows a fully evidenced low-risk build to auto-start on the one-shot lane", () => {
    expect(evaluateAutonomousBuildEligibility(BASE_INPUT)).toEqual({
      eligible: true,
      lane: "one-shot",
      sensitivity: "low",
      activePatternVersion: 2,
      blockers: [],
      nextGovernedAction: "auto-start",
    });
  });

  it.each([
    {
      label: "missing attribution",
      patch: { attribution: null },
      blocker: "active_pattern_binding_missing",
      action: "escalate",
    },
    {
      label: "stale attribution",
      patch: {
        attribution: {
          ...BASE_INPUT.attribution!,
          evidenceFresh: false,
        },
      },
      blocker: "active_pattern_evidence_stale",
      action: "escalate",
    },
    {
      label: "binding mismatch",
      patch: {
        attribution: {
          ...BASE_INPUT.attribution!,
          scopeMatches: false,
        },
      },
      blocker: "active_pattern_scope_mismatch",
      action: "escalate",
    },
    {
      label: "provider incapability",
      patch: { providerReady: false },
      blocker: "provider_unavailable",
      action: "repair",
    },
    {
      label: "unavailable oracle",
      patch: { checkpoint: "review", oracles: "unavailable" },
      blocker: "oracles_unavailable",
      action: "repair",
    },
    {
      label: "high sensitivity",
      patch: { sensitivity: "high" },
      blocker: "high_sensitivity_requires_human",
      action: "escalate",
    },
    {
      label: "regulatory ceiling",
      patch: {
        regulatory: {
          ceiling: "supervised",
          humanControlRequired: true,
        },
      },
      blocker: "regulatory_ceiling_requires_human",
      action: "escalate",
    },
    {
      label: "invalid release state",
      patch: { checkpoint: "release", deliveryStatus: "closed" },
      blocker: "delivery_state_closed",
      action: "escalate",
    },
    {
      label: "exhausted budget",
      patch: { recoveryBudgetExhausted: true },
      blocker: "recovery_budget_exhausted",
      action: "escalate",
    },
  ] as const)("$label is fail-closed with a deterministic next action", ({
    patch,
    blocker,
    action,
  }) => {
    const result = evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      ...patch,
    } as AutonomousBuildEligibilityInput);

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain(blocker);
    expect(result.nextGovernedAction).toBe(action);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(BASE_INPUT);
    const before = structuredClone(input);

    evaluateAutonomousBuildEligibility(input);

    expect(input).toEqual(before);
  });

  it("keeps large work off one-shot while allowing the governed standard lane", () => {
    const result = evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      effortSize: "large",
    });

    expect(result).toMatchObject({
      eligible: true,
      lane: "standard",
      blockers: [],
      nextGovernedAction: "auto-start",
    });
  });

  it("maps each consequential checkpoint to its governed action", () => {
    expect(evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      checkpoint: "ship",
    }).nextGovernedAction).toBe("ship");
    expect(evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      checkpoint: "pr",
      deliveryStatus: "checking",
    }).nextGovernedAction).toBe("merge-queue");
    expect(evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      checkpoint: "release",
      deliveryStatus: "awaiting-release",
    }).nextGovernedAction).toBe("await-release");
  });

  it("does not treat a merge-queued PR as released", () => {
    expect(evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      checkpoint: "release",
      deliveryStatus: "queued",
    })).toMatchObject({
      eligible: false,
      blockers: ["delivery_state_not_merged"],
      nextGovernedAction: "escalate",
    });
  });

  it("classifies sandbox drift as governed repair, not a product escalation", () => {
    const result = evaluateAutonomousBuildEligibility({
      ...BASE_INPUT,
      checkpoint: "build",
      sandboxState: "drift",
    });

    expect(result).toMatchObject({
      eligible: false,
      blockers: ["blocked_sandbox_drift"],
      nextGovernedAction: "repair",
    });
  });
});
