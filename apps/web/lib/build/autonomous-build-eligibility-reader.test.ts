import { describe, expect, it, vi } from "vitest";

import {
  readAutonomousBuildEligibility,
  selectActiveWorkPatternAttribution,
} from "./autonomous-build-eligibility-reader";
import type { WorkPatternBindingRecord } from "@/lib/tak/work-pattern-binding-reader";

function binding(
  overrides: Partial<WorkPatternBindingRecord> = {},
): WorkPatternBindingRecord {
  return {
    bindingId: "AB-active",
    name: "Autonomous Build Method v2",
    status: "active",
    resourceRef: "autonomous-build@2",
    updatedAt: new Date("2026-07-27T12:00:00.000Z"),
    authorityScope: {
      schemaVersion: 1,
      activationLaneKey: "WPL-build-studio",
      bindingScopeKey: "same-install:build-studio",
      patternKey: "autonomous-build",
      patternVersion: 2,
      activityKey: "build-studio.delivery",
      riskClass: "internal-reversible",
      installScopes: ["dpf_dogfood"],
      organizationIds: [],
      taskCorpusKeys: ["build-studio-low-risk"],
      modelProfileIds: ["quality-first"],
      promotionPolicyKey: "governed-playbook",
      promotionPolicyVersion: 1,
      sourceExperimentTaskRunId: "TR-experiment",
      corroborationTaskRunIds: [],
      priorSafeBindingId: "AB-v1",
      evidenceFreshnessAt: "2026-07-27T12:30:00.000Z",
      evidenceOrigin: "customer-zero",
      scopeCeiling: "same-install",
      blockers: [],
    },
    ...overrides,
  };
}

describe("selectActiveWorkPatternAttribution", () => {
  it("selects the active binding only when every declared scope dimension matches", () => {
    expect(selectActiveWorkPatternAttribution([binding()], {
      activityKey: "build-studio.delivery",
      installScope: "dpf_dogfood",
      taskCorpusKey: "build-studio-low-risk",
      modelProfileId: "quality-first",
      now: new Date("2026-07-27T13:00:00.000Z"),
      freshnessWindowMs: 3_600_000,
    })).toEqual({
      bindingStatus: "active",
      patternVersion: 2,
      scopeMatches: true,
      evidenceFresh: true,
    });
  });

  it("does not treat an out-of-scope active binding as authority", () => {
    expect(selectActiveWorkPatternAttribution([binding()], {
      activityKey: "build-studio.delivery",
      installScope: "dpf_dogfood",
      taskCorpusKey: "another-corpus",
      modelProfileId: "quality-first",
      now: new Date("2026-07-27T13:00:00.000Z"),
      freshnessWindowMs: 3_600_000,
    })).toMatchObject({
      bindingStatus: "active",
      patternVersion: 2,
      scopeMatches: false,
    });
  });
});

describe("readAutonomousBuildEligibility", () => {
  it("reads binding evidence and delegates to the pure projection without writes", async () => {
    const listBindings = vi.fn().mockResolvedValue([binding()]);

    const result = await readAutonomousBuildEligibility({
      agentId: "build-specialist",
      bindingScope: {
        activityKey: "build-studio.delivery",
        installScope: "dpf_dogfood",
        taskCorpusKey: "build-studio-low-risk",
        modelProfileId: "quality-first",
        now: new Date("2026-07-27T13:00:00.000Z"),
        freshnessWindowMs: 3_600_000,
      },
      eligibility: {
        checkpoint: "intake",
        sensitivity: "low",
        workType: "feature",
        effortSize: "medium",
        gateOutcome: "recommend",
        oracles: "green",
        providerReady: true,
        sandboxState: "ready",
        regulatory: {
          ceiling: "autopilot",
          humanControlRequired: false,
        },
        recoveryBudgetExhausted: false,
        deliveryStatus: null,
      },
    }, { listBindings });

    expect(listBindings).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      eligible: true,
      activePatternVersion: 2,
      nextGovernedAction: "auto-start",
    });
  });
});
