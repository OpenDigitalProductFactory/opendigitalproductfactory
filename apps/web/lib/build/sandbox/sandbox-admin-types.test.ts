import { describe, expect, it } from "vitest";

import {
  SANDBOX_READINESS_STATES,
  SANDBOX_RECOVERY_ACTIONS,
  isSandboxReadinessState,
  isSandboxRecoveryAction,
} from "./sandbox-admin-types";

describe("sandbox admin types", () => {
  it("accepts every supported readiness state", () => {
    expect(SANDBOX_READINESS_STATES).toEqual([
      "healthy",
      "stopped",
      "not_found",
      "detached",
      "mixed_compose_project",
      "branch_mismatch",
      "stale_source",
      "dirty_or_leaking",
      "verification_red",
      "stuck_mid_phase",
      "unrecoverable",
    ]);

    for (const state of SANDBOX_READINESS_STATES) {
      expect(isSandboxReadinessState(state)).toBe(true);
    }
  });

  it("rejects unknown readiness state strings", () => {
    expect(isSandboxReadinessState("running")).toBe(false);
    expect(isSandboxReadinessState("ready")).toBe(false);
  });

  it("accepts every supported recovery action", () => {
    expect(SANDBOX_RECOVERY_ACTIONS).toEqual([
      "start",
      "restart",
      "rebind_runtime_target",
      "release_stale_slot",
      "checkout_registered_branch",
      "reset_from_main",
      "quarantine_runtime_target",
      "reset_build_phase",
    ]);

    for (const action of SANDBOX_RECOVERY_ACTIONS) {
      expect(isSandboxRecoveryAction(action)).toBe(true);
    }
  });
});
