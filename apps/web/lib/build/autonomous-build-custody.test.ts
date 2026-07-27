import { describe, expect, it } from "vitest";

import { projectAutonomousBuildCustody } from "./autonomous-build-custody";

function state(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    autonomousCustody: {
      checkpoint: "build",
      mode: "enforce",
      evaluatedAt: "2026-07-27T12:00:00.000Z",
      heartbeatAt: "2026-07-27T12:00:00.000Z",
      eligibility: {
        eligible: true,
        blockers: [],
        nextGovernedAction: "continue",
      },
      executionProfileRef: {
        method: "governed-playbook",
        patternVersion: 3,
        providerId: "provider",
        modelId: "model",
      },
      ...patch,
    },
    autonomousRecovery: { attempts: { provider_failure: 1 } },
  };
}

describe("projectAutonomousBuildCustody", () => {
  it("projects working custody with provenance behind the engineer seam", () => {
    expect(projectAutonomousBuildCustody({
      phase: "build",
      buildExecState: state(),
      now: new Date("2026-07-27T12:05:00.000Z"),
    })).toMatchObject({
      state: "working",
      title: "Build Studio is working",
      attentionRequired: false,
      engineer: {
        method: "governed-playbook",
        patternVersion: 3,
        recoveryAttempts: { provider_failure: 1 },
      },
    });
  });

  it("shows bounded recovery without asking for routine intervention", () => {
    expect(projectAutonomousBuildCustody({
      phase: "build",
      buildExecState: state({
        eligibility: {
          eligible: false,
          blockers: ["blocked_sandbox_drift"],
          nextGovernedAction: "repair",
        },
      }),
    })).toMatchObject({
      state: "recovering",
      title: "Build Studio is recovering",
      attentionRequired: false,
      detail: expect.stringContaining("verification environment"),
    });
  });

  it("makes authority ceilings and stale heartbeats explicit attention states", () => {
    expect(projectAutonomousBuildCustody({
      phase: "ship",
      buildExecState: state({
        eligibility: {
          eligible: false,
          blockers: ["high_sensitivity_requires_human"],
          nextGovernedAction: "escalate",
        },
      }),
    })).toMatchObject({ state: "needs-decision", attentionRequired: true });

    expect(projectAutonomousBuildCustody({
      phase: "build",
      buildExecState: state(),
      now: new Date("2026-07-27T12:11:00.000Z"),
    })).toMatchObject({
      title: "Build Studio may be stalled",
      attentionRequired: true,
    });
  });

  it("distinguishes shadow, release wait, and deployed completion", () => {
    expect(projectAutonomousBuildCustody({
      phase: "build",
      buildExecState: state({ mode: "shadow" }),
    })?.state).toBe("shadow");
    expect(projectAutonomousBuildCustody({
      phase: "ship",
      buildExecState: state({ checkpoint: "release" }),
      now: new Date("2026-07-27T12:05:00.000Z"),
    })?.title).toBe("Waiting for governed release");
    expect(projectAutonomousBuildCustody({
      phase: "complete",
      buildExecState: state({ checkpoint: "release" }),
    })?.title).toBe("Live and complete");
  });

  it("renders no autonomy claim for legacy/off builds", () => {
    expect(projectAutonomousBuildCustody({
      phase: "build",
      buildExecState: null,
    })).toBeNull();
  });
});
