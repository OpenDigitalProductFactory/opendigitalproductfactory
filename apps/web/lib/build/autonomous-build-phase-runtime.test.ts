import { describe, expect, it, vi } from "vitest";

import {
  resolveAutonomousBuildPhaseEligibility,
  type AutonomousBuildPhaseRuntimeDeps,
} from "./autonomous-build-phase-runtime";

function deps(
  overrides: Partial<AutonomousBuildPhaseRuntimeDeps> = {},
): AutonomousBuildPhaseRuntimeDeps {
  return {
    loadBuild: vi.fn().mockResolvedValue({
      title: "Add a compact status band",
      description: "Show the existing delivery state.",
      kind: "feature",
      plan: {
        processSize: "medium",
        deliverableSensitivity: "low",
      },
      verificationOut: {
        typecheckPassed: true,
        testsPassed: 8,
        testsFailed: 0,
      },
      buildExecState: {},
      workspaceState: null,
    }),
    getMode: vi.fn().mockReturnValue("enforce"),
    getSelection: vi.fn().mockResolvedValue({
      status: "selected",
      selected: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    }),
    getRegulatory: vi.fn().mockResolvedValue({
      ceiling: "autopilot",
      humanControlRequired: false,
    }),
    getSandboxState: vi.fn().mockResolvedValue("ready"),
    listBindings: vi.fn().mockResolvedValue([{
      bindingId: "AB-active",
      name: "Build implementation v2",
      status: "active",
      resourceRef: "build-review@2",
      updatedAt: new Date("2026-07-27T12:00:00.000Z"),
      authorityScope: {
        schemaVersion: 1,
        activationLaneKey: "WPL-build",
        bindingScopeKey: "dogfood-build",
        patternKey: "build-review",
        patternVersion: 2,
        activityKey: "build.implement",
        riskClass: "internal-reversible",
        installScopes: ["dpf_dogfood"],
        organizationIds: [],
        taskCorpusKeys: ["dpf-repository"],
        modelProfileIds: ["frontier-coding"],
        promotionPolicyKey: "governed-build-playbook-promotion",
        promotionPolicyVersion: 1,
        sourceExperimentTaskRunId: "TR-experiment",
        corroborationTaskRunIds: [],
        priorSafeBindingId: "AB-v1",
        evidenceFreshnessAt: "2026-07-27T12:00:00.000Z",
        evidenceOrigin: "customer-zero",
        scopeCeiling: "same-install",
        blockers: [],
      },
    }]),
    recordEvaluation: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-07-27T13:00:00.000Z"),
    ...overrides,
  };
}

describe("resolveAutonomousBuildPhaseEligibility", () => {
  it("rechecks live evidence and records the compact resolved profile", async () => {
    const runtime = deps();
    const result = await resolveAutonomousBuildPhaseEligibility({
      buildId: "FB-TEST",
      checkpoint: "ship",
      gateOutcome: "recommend",
    }, runtime);

    expect(result.eligibility).toMatchObject({
      eligible: true,
      activePatternVersion: 2,
      nextGovernedAction: "ship",
    });
    expect(result.executionProfileRef).toMatchObject({
      bindingId: "AB-active",
      patternKey: "build-review",
      patternVersion: 2,
      providerId: "openai",
      modelId: "gpt-5",
      recoveryPolicyVersion: "autonomous-build-recovery/v1",
    });
    expect(runtime.recordEvaluation).toHaveBeenCalledWith(
      "FB-TEST",
      expect.objectContaining({
        checkpoint: "ship",
        eligibility: expect.objectContaining({ eligible: true }),
      }),
    );
  });

  it("honors changed phase evidence instead of trusting prior eligibility", async () => {
    const runtime = deps({
      getRegulatory: vi.fn().mockResolvedValue({
        ceiling: "supervised",
        humanControlRequired: true,
      }),
    });

    const result = await resolveAutonomousBuildPhaseEligibility({
      buildId: "FB-TEST",
      checkpoint: "ship",
      gateOutcome: "recommend",
    }, runtime);

    expect(result.eligibility).toMatchObject({
      eligible: false,
      nextGovernedAction: "escalate",
      blockers: expect.arrayContaining([
        "regulatory_ceiling_requires_human",
      ]),
    });
    expect(result.executionProfileRef).toBeNull();
  });

  it("records shadow decisions without returning actuation authority", async () => {
    const runtime = deps({
      getMode: vi.fn().mockReturnValue("shadow"),
    });

    const result = await resolveAutonomousBuildPhaseEligibility({
      buildId: "FB-TEST",
      checkpoint: "build",
      gateOutcome: "recommend",
    }, runtime);

    expect(result.observationEligible).toBe(true);
    expect(result.mayAct).toBe(false);
  });

  it("fails closed when build state is missing", async () => {
    const runtime = deps({
      loadBuild: vi.fn().mockResolvedValue(null),
    });

    await expect(resolveAutonomousBuildPhaseEligibility({
      buildId: "FB-MISSING",
      checkpoint: "build",
      gateOutcome: "recommend",
    }, runtime)).rejects.toThrow("autonomous_build_missing");
  });
});
