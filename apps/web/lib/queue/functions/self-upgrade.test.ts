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

  it("accepts full payload", () => {
    const payload: SelfUpgradeRunEventData = { triggeredBy: "ops-bot", dryRun: false, buildId: "FB-123" };
    expect(payload).toEqual({ triggeredBy: "ops-bot", dryRun: false, buildId: "FB-123" });
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
};

describe("success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isInMaintenanceWindow.mockReturnValue(true);
    mocks.resolveTargetSha.mockResolvedValue("abc1234deadbeef");
    mocks.getDeployedSha.mockReturnValue("oldsha1");
    mocks.isShaFresh.mockReturnValue(false);
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
});

describe("failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isInMaintenanceWindow.mockReturnValue(true);
    mocks.resolveTargetSha.mockResolvedValue("abc1234deadbeef");
    mocks.getDeployedSha.mockReturnValue("oldsha1");
    mocks.isShaFresh.mockReturnValue(false);
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
});
