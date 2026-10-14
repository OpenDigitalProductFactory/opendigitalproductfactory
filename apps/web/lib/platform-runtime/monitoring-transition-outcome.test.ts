import { describe, expect, it } from "vitest";

import { mapMonitoringTransitionError, mapMonitoringTransitionOutcome } from "./monitoring-transition-outcome";

describe("mapMonitoringTransitionOutcome", () => {
  it.each([
    [{ status: "succeeded" }, "success", "monitoringSettings.outcome.succeeded"],
    [{ status: "host_applied_pending_verification" }, "warning", "monitoringSettings.outcome.pendingVerification"],
    [{ status: "transition_in_progress" }, "neutral", "monitoringSettings.outcome.inProgress"],
    [{ status: "drain_required", blockingCounts: { builds: 2 } }, "warning", "monitoringSettings.outcome.drainRequired"],
    [{ status: "already_terminal", transitionStatus: "succeeded" }, "neutral", "monitoringSettings.outcome.alreadyTerminal"],
    [{ status: "failed", failure: "promoter_unavailable" }, "critical", "monitoringSettings.outcome.failed"],
    [{ status: "rolled_back", failure: "required_health_failed" }, "warning", "monitoringSettings.outcome.rolledBack"],
    [{ status: "rollback_failed", failure: "x" }, "critical", "monitoringSettings.outcome.rollbackFailed"],
  ] as const)("maps %o", (result, tone, messageKey) => {
    expect(mapMonitoringTransitionOutcome(result, "RCT-abc")).toMatchObject({ tone, messageKey });
  });

  it("carries the failure reason and transition id for the failure kinds", () => {
    expect(mapMonitoringTransitionOutcome({ status: "failed", failure: "promoter_unavailable" }, "RCT-abc")).toEqual({
      tone: "critical",
      messageKey: "monitoringSettings.outcome.failed",
      failure: "promoter_unavailable",
      transitionId: "RCT-abc",
    });
  });

  it("treats an unknown result as a failure rather than success", () => {
    expect(mapMonitoringTransitionOutcome({ status: "something_new" }, "RCT-abc").tone).toBe("critical");
    expect(mapMonitoringTransitionOutcome(null, "RCT-abc").messageKey).toBe("monitoringSettings.outcome.unknown");
  });
});

describe("mapMonitoringTransitionError", () => {
  it("maps admission refusals to plain copy", () => {
    expect(mapMonitoringTransitionError(new Error("runtime_capability_reconciliation_in_progress"), "RCT-a").messageKey).toBe("monitoringSettings.outcome.inProgress");
    expect(mapMonitoringTransitionError(new Error("runtime_capability_recovery_required"), "RCT-a").messageKey).toBe("monitoringSettings.outcome.recoveryRequired");
    expect(mapMonitoringTransitionError(new Error("capability_state_stale:runtime:build"), "RCT-a").messageKey).toBe("monitoringSettings.outcome.unreconciled");
    expect(mapMonitoringTransitionError(new Error("boom"), "RCT-a")).toMatchObject({ tone: "critical", messageKey: "monitoringSettings.outcome.failed", failure: "boom" });
  });
});
