import { describe, expect, it, vi } from "vitest";

import { recoverSandbox, type SandboxRecoveryDb } from "./sandbox-recovery";
import type { SandboxReadinessSnapshot } from "./sandbox-admin-types";

function snapshot(overrides: Partial<SandboxReadinessSnapshot> = {}): SandboxReadinessSnapshot {
  return {
    buildId: "FB-TEST",
    state: "stopped",
    canDeploy: false,
    canContribute: false,
    summary: "stopped",
    checks: [],
    recommendedActions: [],
    inspectedAt: "2026-05-22T12:00:00.000Z",
    runtimeTargetId: "runtime-target-row-1",
    containerId: "dpf-sandbox-1",
    branchName: "build/FB-TEST",
    ...overrides,
  };
}

function makeDb(overrides: Partial<SandboxRecoveryDb> = {}): SandboxRecoveryDb {
  return {
    buildActivity: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    buildPhaseRun: {
      updateMany: vi.fn(),
    },
    runtimeTarget: {
      updateMany: vi.fn(),
    },
    sandboxSlot: {
      updateMany: vi.fn(),
    },
    featureBuild: {
      update: vi.fn(),
    },
    ...overrides,
  };
}

describe("recoverSandbox", () => {
  it("blocks reset_from_main without confirmation", async () => {
    const result = await recoverSandbox({
      buildId: "FB-TEST",
      action: "reset_from_main",
      confirmation: null,
      diagnose: vi.fn().mockResolvedValue(snapshot({ state: "stale_source" })),
      runCommand: vi.fn(),
      recordActivity: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("confirmation");
  });

  it("starts a stopped owned sandbox", async () => {
    const runCommand = vi.fn().mockResolvedValue("");
    const result = await recoverSandbox({
      buildId: "FB-TEST",
      action: "start",
      confirmation: null,
      diagnose: vi.fn()
        .mockResolvedValueOnce(snapshot({ state: "stopped", containerId: "dpf-sandbox-1" }))
        .mockResolvedValueOnce(snapshot({ state: "healthy", canDeploy: true, canContribute: true, summary: "healthy" })),
      runCommand,
      recordActivity: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(runCommand).toHaveBeenCalledWith("docker", ["start", "dpf-sandbox-1"]);
    expect(result.snapshot?.state).toBe("healthy");
  });

  it("blocks stale slot release when the build is not abandoned for seven days", async () => {
    const latestActivity = { createdAt: new Date("2026-05-18T12:00:00.000Z") };
    const db = makeDb({
      buildActivity: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(latestActivity),
      },
    });

    const result = await recoverSandbox({
      buildId: "FB-TEST",
      action: "release_stale_slot",
      confirmation: { discardSandboxChanges: true, reason: "operator confirmed slot release" },
      diagnose: vi.fn().mockResolvedValue(snapshot({ state: "detached" })),
      runCommand: vi.fn(),
      db,
      now: new Date("2026-05-22T12:00:00.000Z"),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("slot is held by paused-but-not-abandoned build");
    expect(db.sandboxSlot?.updateMany).not.toHaveBeenCalled();
  });

  it("resets a stuck build phase only with structured acknowledgement", async () => {
    const db = makeDb();

    const result = await recoverSandbox({
      buildId: "FB-TEST",
      action: "reset_build_phase",
      confirmation: { acknowledgeReset: true, reason: "complete step had filesChanged:0" },
      diagnose: vi.fn()
        .mockResolvedValueOnce(snapshot({ state: "stuck_mid_phase" }))
        .mockResolvedValueOnce(snapshot({ state: "not_found", summary: "phase reset" })),
      runCommand: vi.fn(),
      db,
      now: new Date("2026-05-22T12:00:00.000Z"),
    });

    expect(result.success).toBe(true);
    expect(db.buildPhaseRun?.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ buildId: "FB-TEST", completedAt: null }),
      data: expect.objectContaining({ completedAt: new Date("2026-05-22T12:00:00.000Z") }),
    }));
    expect(db.buildActivity?.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        buildId: "FB-TEST",
        tool: "sandbox_recovery:reset_build_phase",
        summary: expect.stringContaining("operator_reset_after_stall"),
      }),
    }));
    expect(db.sandboxSlot?.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "FB-TEST" },
      data: expect.objectContaining({ status: "available", buildId: null }),
    }));
  });
});
