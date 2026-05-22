import { describe, expect, it, vi } from "vitest";

import {
  diagnoseSandboxReadiness,
  normalizeSandboxPathForComparison,
  type SandboxAdminDb,
  type SandboxGitProbe,
} from "./sandbox-admin";
import type { DockerComposeContainerInfo } from "./docker-compose-inspector";

const healthyContainer: DockerComposeContainerInfo = {
  containerId: "sandbox-container-1",
  containerName: "dpf-sandbox-BI-123",
  status: "running",
  running: true,
  composeProjectName: "dpf-build-BI-123",
  composeServiceName: "sandbox",
  composeWorkingDir: "D:\\DPF\\.worktrees\\BI-123",
  composeConfigFiles: ["D:\\DPF\\.worktrees\\BI-123\\docker-compose.yml"],
  hostPorts: [3310],
};

const healthyGit: SandboxGitProbe = {
  branchName: "build/BI-123",
  dirty: false,
  sourceCurrencyStatus: "current",
  sourceCurrencySummary: "Sandbox source current.",
};

function makeBuild(overrides: Record<string, unknown> = {}) {
  return {
    id: "feature-build-row-1",
    buildId: "BI-123",
    sandboxId: "sandbox-container-1",
    sandboxPort: 3310,
    buildBranch: "build/BI-123",
    diffPatch: "diff --git a/file.ts b/file.ts",
    buildExecState: { phase: "build" },
    taskResults: { completedTasks: 1, totalTasks: 1, tasks: [{ outcome: "DONE" }] },
    verificationOut: { typecheckPassed: true, buildPassed: true, testsFailed: 0 },
    phase: "build",
    ...overrides,
  };
}

function makeRuntimeTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: "runtime-target-row-1",
    targetId: "RT-BI-123",
    status: "assigned",
    composeProjectName: "dpf-build-BI-123",
    serviceName: "sandbox",
    containerName: "dpf-sandbox-BI-123",
    port: 3310,
    featureBuildId: "feature-build-row-1",
    sandboxId: "sandbox-row-1",
    slotId: "slot-row-1",
    ...overrides,
  };
}

function makeDb(args: {
  build?: Record<string, unknown> | null;
  runtimeTarget?: Record<string, unknown> | null;
  phaseRun?: Record<string, unknown> | null;
} = {}): SandboxAdminDb {
  return {
    featureBuild: {
      findUnique: vi.fn().mockResolvedValue(args.build === undefined ? makeBuild() : args.build),
    },
    runtimeTarget: {
      findFirst: vi.fn().mockResolvedValue(
        args.runtimeTarget === undefined ? makeRuntimeTarget() : args.runtimeTarget,
      ),
    },
    buildPhaseRun: {
      findFirst: vi.fn().mockResolvedValue(args.phaseRun ?? null),
    },
  };
}

describe("diagnoseSandboxReadiness", () => {
  it("normalizes workspace paths with repeated trailing separators for safe comparison", () => {
    expect(normalizeSandboxPathForComparison(" D:\\DPF\\.worktrees\\BI-123////\\\\ ")).toBe(
      "d:/dpf/.worktrees/bi-123",
    );
    expect(normalizeSandboxPathForComparison("   ")).toBeNull();
  });

  it("marks a build without sandbox metadata as not found and non-deployable", async () => {
    const snapshot = await diagnoseSandboxReadiness({
      buildId: "BI-123",
      db: makeDb({ build: makeBuild({ sandboxId: null, sandboxPort: null }) }),
      inspectContainer: vi.fn(),
      inspectGit: vi.fn(),
      now: new Date("2026-05-22T12:00:00.000Z"),
    });

    expect(snapshot.state).toBe("not_found");
    expect(snapshot.canDeploy).toBe(false);
    expect(snapshot.canContribute).toBe(false);
    expect(snapshot.recommendedActions.map((item) => item.action)).toContain("restart");
    expect(snapshot.checks).toContainEqual(expect.objectContaining({
      id: "sandbox_metadata",
      status: "fail",
    }));
  });

  it("detects a detached compose project when the container belongs to a different worktree", async () => {
    const snapshot = await diagnoseSandboxReadiness({
      buildId: "BI-123",
      db: makeDb(),
      expectedWorkspaceRoot: "D:\\DPF\\.worktrees\\BI-123",
      inspectContainer: vi.fn().mockResolvedValue({
        ...healthyContainer,
        composeWorkingDir: "D:\\DPF-other-build",
      }),
      inspectGit: vi.fn().mockResolvedValue(healthyGit),
      now: new Date("2026-05-22T12:00:00.000Z"),
    });

    expect(snapshot.state).toBe("mixed_compose_project");
    expect(snapshot.canDeploy).toBe(false);
    expect(snapshot.canContribute).toBe(false);
    expect(snapshot.recommendedActions.map((item) => item.action)).toEqual([
      "rebind_runtime_target",
      "restart",
    ]);
    expect(snapshot.checks).toContainEqual(expect.objectContaining({
      id: "compose_working_dir",
      status: "fail",
      actual: "D:\\DPF-other-build",
    }));
  });

  it("marks a matching running sandbox as healthy and deployable", async () => {
    const snapshot = await diagnoseSandboxReadiness({
      buildId: "BI-123",
      db: makeDb(),
      expectedWorkspaceRoot: "D:\\DPF\\.worktrees\\BI-123",
      inspectContainer: vi.fn().mockResolvedValue(healthyContainer),
      inspectGit: vi.fn().mockResolvedValue(healthyGit),
      now: new Date("2026-05-22T12:00:00.000Z"),
    });

    expect(snapshot.state).toBe("healthy");
    expect(snapshot.canDeploy).toBe(true);
    expect(snapshot.canContribute).toBe(true);
    expect(snapshot.recommendedActions).toEqual([]);
    expect(snapshot.checks).toContainEqual(expect.objectContaining({
      id: "verification",
      status: "pass",
    }));
  });

  it("flags complete/no-diff builds as stuck mid phase instead of asking for a PR diff override", async () => {
    const snapshot = await diagnoseSandboxReadiness({
      buildId: "BI-123",
      db: makeDb({
        build: makeBuild({
          diffPatch: "",
          buildExecState: { phase: "ship", step: "complete" },
          taskResults: { completedTasks: 1, totalTasks: 1, tasks: [], filesChanged: 0 },
        }),
      }),
      expectedWorkspaceRoot: "D:\\DPF\\.worktrees\\BI-123",
      inspectContainer: vi.fn().mockResolvedValue(healthyContainer),
      inspectGit: vi.fn().mockResolvedValue(healthyGit),
      now: new Date("2026-05-22T12:00:00.000Z"),
    });

    expect(snapshot.state).toBe("stuck_mid_phase");
    expect(snapshot.canDeploy).toBe(false);
    expect(snapshot.recommendedActions.map((item) => item.action)).toContain("reset_build_phase");
    expect(snapshot.summary).toMatch(/finished without a releasable diff/i);
  });
});
