import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  getConfig: vi.fn(),
  captureBlockers: vi.fn(),
  buildPreview: vi.fn(),
  readHistory: vi.fn(),
  backup: vi.fn(),
  trial: vi.fn(),
  backupFind: vi.fn(),
  startQuiescence: vi.fn(),
  signalStarting: vi.fn(),
  signalComplete: vi.fn(),
  failSwap: vi.fn(),
  ensurePromoter: vi.fn(),
  dispatch: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/self-upgrade/config", () => ({ getSelfUpgradeConfig: mocks.getConfig }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  captureActiveSessionBlockers: mocks.captureBlockers,
  startQuiescence: mocks.startQuiescence,
  signalSwapStarting: mocks.signalStarting,
  signalSwapComplete: mocks.signalComplete,
  failQuiescenceSwap: mocks.failSwap,
}));
vi.mock("@/lib/teardown/preview", () => ({
  buildTeardownPreview: mocks.buildPreview,
  readTeardownEvidenceHistory: mocks.readHistory,
}));
vi.mock("@/lib/operate/backups/postgres-backup-runner", () => ({ runPostgresBackup: mocks.backup }));
vi.mock("@/lib/operate/backups/postgres-trial-restore-runner", () => ({ runPostgresTrialRestore: mocks.trial }));
vi.mock("@dpf/db", () => ({ prisma: { backupRun: { findUnique: mocks.backupFind } } }));
vi.mock("@/lib/self-upgrade/promoter", () => ({ ensurePromoterImage: mocks.ensurePromoter }));
vi.mock("@/lib/teardown/dispatcher", () => ({ dispatchTeardown: mocks.dispatch }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));

import { executeInstallationTeardown, previewInstallationTeardown } from "./teardown";

const preview = (scope = "everything", runId = "TDR-ABC12345") => ({
  runId,
  scope,
  installPath: "D:\\DPF",
  backupsPath: "D:\\DPF-backups",
  composeProject: "dpf",
  composeFiles: ["docker-compose.yml"],
  sourceEvidenceSafe: true,
  recoveryRequired: scope === "everything" || scope === "volumes",
  salvageRequired: scope === "everything" || scope === "source",
  salvage: { path: "/host-dpf", atRisk: false, dirtyPaths: 0, stashes: 0, unreachableCommits: 0, branches: [] },
  salvageDigest: "b".repeat(64),
  blockers: [],
  previewDigest: "a".repeat(64),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.requireCapability.mockResolvedValue({ userId: "user-1" });
  mocks.getConfig.mockResolvedValue({ composeProject: "dpf" });
  mocks.captureBlockers.mockResolvedValue({ surfaces: [] });
  mocks.readFile.mockResolvedValue("s".repeat(64));
  mocks.buildPreview.mockImplementation(async ({ scope, runId }: { scope: string; runId?: string }) => preview(scope, runId));
  mocks.ensurePromoter.mockResolvedValue({ ok: true, alreadyPresent: true, built: false });
  mocks.backup.mockResolvedValue({ runId: "backup-1", status: "ok" });
  mocks.backupFind.mockResolvedValue({ sha256: "c".repeat(64) });
  mocks.trial.mockResolvedValue({ status: "ok", restoreId: "restore-1" });
  mocks.startQuiescence.mockResolvedValue({ runId: "QUI-1", awaitReady: async () => ({ ok: true }) });
  mocks.signalStarting.mockResolvedValue(undefined);
  mocks.signalComplete.mockResolvedValue(undefined);
  mocks.dispatch.mockResolvedValue({ containerId: "d".repeat(64), containerName: "dpf-teardown" });
  process.env.DPF_STATE_DIR_HOST = "C:\\Users\\operator\\.dpf";
});

describe("installation teardown actions", () => {
  it("requires manage_platform before previewing", async () => {
    const result = await previewInstallationTeardown("containers");
    expect(result.ok).toBe(true);
    expect(mocks.requireCapability).toHaveBeenCalledWith("manage_platform");
  });

  it("rejects a malformed challenge before backup, quiescence, or dispatch", async () => {
    const result = await executeInstallationTeardown("not-a-challenge");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("teardown_challenge_malformed") });
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("binds the exact backup trial receipt before detached dispatch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
    const reviewed = await previewInstallationTeardown("everything");
    expect(reviewed.ok).toBe(true);
    vi.setSystemTime(new Date("2026-08-22T12:00:03.000Z"));
    const result = await executeInstallationTeardown(reviewed.ok ? reviewed.data.challenge : "");
    expect(result).toMatchObject({ ok: true, data: { runId: "TDR-ABC12345", disconnectExpected: true } });
    expect(mocks.backup).toHaveBeenCalledWith(expect.objectContaining({ trigger: "pre-teardown-recovery" }));
    expect(mocks.trial).toHaveBeenCalledWith({ sourceBackupRunId: "backup-1" });
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({ recovery: expect.objectContaining({ backupRunId: "backup-1", trialRestoreId: "restore-1" }) }),
    }));
    expect(mocks.signalStarting).toHaveBeenCalledWith("QUI-1");
    expect(mocks.signalComplete).toHaveBeenCalledWith("QUI-1");
  });
});
