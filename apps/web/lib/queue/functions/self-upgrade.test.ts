import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSelfUpgradeConfig: vi.fn(),
  isInMaintenanceWindow: vi.fn(),
  resolveTargetSha: vi.fn(),
  isShaFresh: vi.fn(),
  getDeployedSha: vi.fn(),
  isFeatureBuildDeployed: vi.fn(),
  createRun: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  getLatestRun: vi.fn(),
  runPromoter: vi.fn(),
  emitUpgradeEvent: vi.fn(),
  // BI-QUIESCE-010 — caller API consumed by runSelfUpgrade.
  startQuiescence: vi.fn(),
  signalSwapStarting: vi.fn(),
  signalSwapComplete: vi.fn(),
  failQuiescenceSwap: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: mocks.getSelfUpgradeConfig,
  isInMaintenanceWindow: mocks.isInMaintenanceWindow,
}));

vi.mock("@/lib/self-upgrade/version", () => ({
  resolveTargetSha: mocks.resolveTargetSha,
  isShaFresh: mocks.isShaFresh,
}));

vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: mocks.getDeployedSha,
  isFeatureBuildDeployed: mocks.isFeatureBuildDeployed,
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  createRun: mocks.createRun,
  startRun: mocks.startRun,
  completeRun: mocks.completeRun,
  failRun: mocks.failRun,
  getLatestRun: mocks.getLatestRun,
}));

vi.mock("@/lib/self-upgrade/promoter", () => ({
  runPromoter: mocks.runPromoter,
}));

vi.mock("@/lib/self-upgrade/notifications", () => ({
  emitUpgradeEvent: mocks.emitUpgradeEvent,
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  startQuiescence: mocks.startQuiescence,
  signalSwapStarting: mocks.signalSwapStarting,
  signalSwapComplete: mocks.signalSwapComplete,
  failQuiescenceSwap: mocks.failQuiescenceSwap,
}));

import type { SelfUpgradeRunEventData } from "./self-upgrade";
import {
  SELF_UPGRADE_CRON,
  SELF_UPGRADE_FUNCTION_ID_SCHEDULED,
  SELF_UPGRADE_FUNCTION_ID_MANUAL,
  SELF_UPGRADE_EVENT,
  selfUpgradeScheduled,
  selfUpgradeManual,
  runSelfUpgrade,
} from "./self-upgrade";
import { allFunctions } from "./index";

/**
 * Helper to set up startQuiescence to return a successful ready-to-swap
 * outcome. Each test that wants the happy path calls this in its beforeEach.
 */
function setupQuiescenceReady(quiescenceRunId = "QR-2026-05-24-test1234"): void {
  mocks.startQuiescence.mockResolvedValue({
    runId: quiescenceRunId,
    awaitReady: () =>
      Promise.resolve({
        ok: true,
        outcome: "ready-to-swap",
        runId: quiescenceRunId,
        finalSnapshot: {
          capturedAt: new Date().toISOString(),
          thresholdMs: 300_000,
          totalBlockers: 0,
          hardBlockers: 0,
          softBlockers: 0,
          unobservableSurfaces: [],
          surfaces: [],
        },
      }),
  });
  mocks.signalSwapStarting.mockResolvedValue(undefined);
  mocks.signalSwapComplete.mockResolvedValue(undefined);
  mocks.failQuiescenceSwap.mockResolvedValue(undefined);
}

describe("cron metadata", () => {
  it("scheduled function id is ops/self-upgrade-scheduled", () => {
    expect(SELF_UPGRADE_FUNCTION_ID_SCHEDULED).toBe("ops/self-upgrade-scheduled");
  });

  it("cron runs hourly", () => {
    expect(SELF_UPGRADE_CRON).toBe("0 * * * *");
  });
});

describe("manual event name", () => {
  it("event name is ops/self-upgrade.run", () => {
    expect(SELF_UPGRADE_EVENT).toBe("ops/self-upgrade.run");
  });

  it("manual function id is ops/self-upgrade-manual", () => {
    expect(SELF_UPGRADE_FUNCTION_ID_MANUAL).toBe("ops/self-upgrade-manual");
  });
});

describe("manual payload schema", () => {
  it("accepts empty payload (all fields optional)", () => {
    const payload: SelfUpgradeRunEventData = {};
    expect(payload).toEqual({});
  });

  it("accepts triggeredBy string", () => {
    const payload: SelfUpgradeRunEventData = { triggeredBy: "user-abc" };
    expect(payload.triggeredBy).toBe("user-abc");
  });

  it("accepts dryRun boolean", () => {
    const payload: SelfUpgradeRunEventData = { dryRun: true };
    expect(payload.dryRun).toBe(true);
  });

  it("accepts buildId string", () => {
    const payload: SelfUpgradeRunEventData = { buildId: "FB-TESTBUILD" };
    expect(payload.buildId).toBe("FB-TESTBUILD");
  });

  it("accepts force boolean", () => {
    const payload: SelfUpgradeRunEventData = { force: true };
    expect(payload.force).toBe(true);
  });

  it("accepts budgetMs (BI-QUIESCE-010)", () => {
    const payload: SelfUpgradeRunEventData = { budgetMs: 600_000 };
    expect(payload.budgetMs).toBe(600_000);
  });
});

describe("function registration", () => {
  it("allFunctions includes selfUpgradeScheduled", () => {
    expect(allFunctions).toContain(selfUpgradeScheduled);
  });

  it("allFunctions includes selfUpgradeManual", () => {
    expect(allFunctions).toContain(selfUpgradeManual);
  });
});

const ENABLED_CONFIG = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  healthTarget: 100,
  maintenanceWindows: [],
  hostSourceMountPath: "/host-dpf",
  repositoryRemote: "origin",
  repositoryBranch: "main",
  healthUrl: "http://localhost:3000/api/health",
};

describe("success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isInMaintenanceWindow.mockReturnValue(true);
    mocks.resolveTargetSha.mockResolvedValue("abc1234deadbeef");
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    mocks.isShaFresh.mockReturnValue(false);
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-AAAABBBB" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "promoted", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
    mocks.isFeatureBuildDeployed.mockResolvedValue(true);
  });

  it("returns succeeded status when promoter exits 0", async () => {
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: true, status: "succeeded", runId: "SUR-AAAABBBB" });
    expect(mocks.completeRun).toHaveBeenCalledWith("SUR-AAAABBBB");
  });

  it("resolves the target SHA using the configured source checkout", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.resolveTargetSha).toHaveBeenCalledWith("stable", ENABLED_CONFIG);
  });

  it("runs the promoter with configured source, backup, and health paths", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.runPromoter).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: "/host-dpf",
        targetSha: "abc1234deadbeef",
        backupPath: "/backups/self-upgrade/SUR-AAAABBBB",
        healthUrl: "http://localhost:3000/api/health",
      }),
    );
  });

  it("emits upgrade.succeeded notification on promoter success", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.emitUpgradeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "upgrade.succeeded", runId: "SUR-AAAABBBB" }),
    );
  });

  it("calls isFeatureBuildDeployed with buildId when provided", async () => {
    const result = await runSelfUpgrade({ triggeredBy: "ops", buildId: "FB-TESTBUILD" });
    expect(mocks.isFeatureBuildDeployed).toHaveBeenCalledWith("FB-TESTBUILD");
    expect(result).toMatchObject({ deployed: true });
  });

  it("skips isFeatureBuildDeployed and returns deployed=null when buildId is absent", async () => {
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.isFeatureBuildDeployed).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deployed: null });
  });

  // BI-QUIESCE-010 success-path additions:

  it("starts quiescence with trigger=self-upgrade + triggerRefId=SelfUpgradeRun.runId", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.startQuiescence).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "self-upgrade",
        triggerRefId: "SUR-AAAABBBB",
      }),
    );
  });

  it("signals swap-starting before runPromoter (audit boundary)", async () => {
    const order: string[] = [];
    mocks.signalSwapStarting.mockImplementation(async () => {
      order.push("signalSwapStarting");
    });
    mocks.runPromoter.mockImplementation(async () => {
      order.push("runPromoter");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(order).toEqual(["signalSwapStarting", "runPromoter"]);
  });

  it("signals swap-complete after successful promoter (wakes suspended Inngest fns)", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.signalSwapComplete).toHaveBeenCalledWith("QR-2026-05-24-test1234");
    expect(mocks.failQuiescenceSwap).not.toHaveBeenCalled();
  });

  it("returns quiescenceRunId on success for caller audit linkage", async () => {
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ quiescenceRunId: "QR-2026-05-24-test1234" });
  });

  it("forwards force=true to startQuiescence as shipForce", async () => {
    await runSelfUpgrade({ triggeredBy: "ops", force: true });
    expect(mocks.startQuiescence).toHaveBeenCalledWith(
      expect.objectContaining({ shipForce: true }),
    );
  });

  it("forwards budgetMs to the coordinator", async () => {
    await runSelfUpgrade({ triggeredBy: "ops", budgetMs: 900_000 });
    expect(mocks.startQuiescence).toHaveBeenCalledWith(
      expect.objectContaining({ budgetMs: 900_000 }),
    );
  });

  it("bypasses quiescence entirely on dryRun", async () => {
    await runSelfUpgrade({ triggeredBy: "ops", dryRun: true });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.signalSwapComplete).not.toHaveBeenCalled();
  });
});

describe("failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isInMaintenanceWindow.mockReturnValue(true);
    mocks.resolveTargetSha.mockResolvedValue("abc1234deadbeef");
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    mocks.isShaFresh.mockReturnValue(false);
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-FAILTEST" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.failRun.mockResolvedValue({});
  });

  it("returns failed status when promoter exits non-zero", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "promote script failed" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: false, status: "failed", runId: "SUR-FAILTEST" });
  });

  it("includes excerpt from stderr in return value", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "some stdout", stderr: "fatal: deploy error" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ excerpt: "fatal: deploy error" });
  });

  it("falls back to stdout for excerpt when stderr is empty", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 2, stdout: "stdout only output", stderr: "" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ excerpt: "stdout only output" });
  });

  it("uses unknown error as excerpt when both stderr and stdout are empty", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ excerpt: "unknown error" });
  });

  it("calls failRun with runId and excerpt", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "promote script failed" });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.failRun).toHaveBeenCalledWith("SUR-FAILTEST", "promote script failed");
  });

  it("emits upgrade.failed notification on promoter failure", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "fatal error" });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.emitUpgradeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "upgrade.failed", runId: "SUR-FAILTEST" }),
    );
  });

  it("does not call completeRun on failure", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error" });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.completeRun).not.toHaveBeenCalled();
  });

  // BI-QUIESCE-010 failure-path additions:

  it("signals failQuiescenceSwap on promoter failure (level returns to normal)", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "fatal" });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.failQuiescenceSwap).toHaveBeenCalledWith("QR-2026-05-24-test1234", "fatal");
    expect(mocks.signalSwapComplete).not.toHaveBeenCalled();
  });
});

describe("quiescence-defer path (BI-QUIESCE-010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isInMaintenanceWindow.mockReturnValue(true);
    mocks.resolveTargetSha.mockResolvedValue("abc1234deadbeef");
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    mocks.isShaFresh.mockReturnValue(false);
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-DEFER" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.failRun.mockResolvedValue({});
  });

  it("returns deferred + does not run promoter when coordinator defers", async () => {
    mocks.startQuiescence.mockResolvedValue({
      runId: "QR-DEFER",
      awaitReady: () =>
        Promise.resolve({
          ok: false,
          outcome: "deferred",
          runId: "QR-DEFER",
          deferSurface: "build-studio.phase.build",
          finalSnapshot: null,
        }),
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled" });

    expect(result).toMatchObject({
      ok: false,
      status: "deferred",
      runId: "SUR-DEFER",
      quiescenceRunId: "QR-DEFER",
      reason: "deferred",
      deferSurface: "build-studio.phase.build",
    });
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    expect(mocks.failRun).toHaveBeenCalledWith(
      "SUR-DEFER",
      "quiescence-deferred: build-studio.phase.build",
    );
    expect(mocks.emitUpgradeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "upgrade.failed", runId: "SUR-DEFER" }),
    );
  });

  it("returns failed when coordinator transitions to failed", async () => {
    mocks.startQuiescence.mockResolvedValue({
      runId: "QR-FAIL",
      awaitReady: () =>
        Promise.resolve({
          ok: false,
          outcome: "failed",
          runId: "QR-FAIL",
          reason: "coordinator-crash",
        }),
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled" });

    expect(result).toMatchObject({
      ok: false,
      status: "deferred", // outer status is "deferred" for any non-ok coordinator outcome
      quiescenceRunId: "QR-FAIL",
      reason: "failed",
    });
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });

  it("returns aborted when operator aborts", async () => {
    mocks.startQuiescence.mockResolvedValue({
      runId: "QR-ABORT",
      awaitReady: () =>
        Promise.resolve({
          ok: false,
          outcome: "aborted",
          runId: "QR-ABORT",
          reason: "operator-abort",
        }),
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled" });

    expect(result).toMatchObject({
      ok: false,
      status: "deferred",
      reason: "aborted",
    });
  });
});
