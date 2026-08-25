import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { configureReleaseUpgradeTest, registerCoreSelfUpgradeSuccessTest, registerInstallStateHandoffTests, registerSelfUpgradeFunctionTests } from "./self-upgrade-handoff.test-support";

const TEST_INSTALL_STATE = JSON.stringify({ platform: "linux", arch: "amd64" });
const TEST_INSTALL_STATE_HASH = createHash("sha256").update(TEST_INSTALL_STATE).digest("hex");

const mocks = vi.hoisted(() => ({
  getSelfUpgradeConfig: vi.fn(),
  readSelfUpgradeSupport: vi.fn(),
  isUpgradeWindowOpen: vi.fn(),
  resolveOperatingScheduleForSystem: vi.fn().mockResolvedValue({ schedule: {}, timezone: "UTC" }),
  getLastCheckedAt: vi.fn().mockResolvedValue(null),
  recordCheckedAt: vi.fn().mockResolvedValue(undefined),
  isCheckIntervalElapsed: vi.fn().mockReturnValue(true),
  defaultGitRunner: vi.fn(),
  prepareUpgradeSource: vi.fn(),
  getDeployedSha: vi.fn(),
  readCurrentContainerConfigDigest: vi.fn().mockResolvedValue(`sha256:${"a".repeat(64)}`),
  isFeatureBuildDeployed: vi.fn(),
  createRun: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  skipRun: vi.fn(),
  updateRunPlan: vi.fn(),
  recordRunRecoveryPoint: vi.fn(),
  recordPromoterReadiness: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestSucceededRun: vi.fn(),
  runPromoter: vi.fn(),
  isPromoterAvailable: vi.fn().mockResolvedValue(true),
  ensurePromoterImage: vi
    .fn()
    .mockResolvedValue({ ok: true, alreadyPresent: false, built: true }),
  buildCandidatePromoterImage: vi.fn().mockResolvedValue("dpf-promoter:abc1234deadbeef"),
  resolvePromoterArtifact: vi.fn(),
  runPromoterReadiness: vi.fn(),
  getCooldownUntil: vi.fn().mockResolvedValue(null),
  recordCooldown: vi.fn().mockResolvedValue(undefined),
  clearCooldown: vi.fn().mockResolvedValue(undefined),
  evaluateHostMemoryGuard: vi.fn().mockResolvedValue({ defer: false }),
  emitUpgradeEvent: vi.fn(),
  createSelfUpgradeRecoveryPoint: vi.fn(),
  summarizeRecoveryPointFailure: vi.fn(),
  startQuiescence: vi.fn(),
  signalSwapStarting: vi.fn(),
  signalSwapComplete: vi.fn(),
  failQuiescenceSwap: vi.fn(),
  captureActiveSessionBlockers: vi.fn().mockResolvedValue({ surfaces: [] }),
  resolveAutoUpgradeWindow: vi.fn().mockReturnValue({ kind: "operating-hours" }),
  getActiveSelfUpgradeBlackout: vi.fn().mockResolvedValue(null),
  readFile: vi.fn(async (path: string) => path.endsWith("install-state.json") ? '{"platform":"linux","arch":"amd64"}' : "s".repeat(32)),
  resolveSelfUpgradeHostIdentity: vi.fn(() => ({ platform: "linux", arch: "amd64", provenance: "explicit" })),
  readRegistryReleaseCandidate: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: mocks.getSelfUpgradeConfig,
  resolveSelfUpgradeHostIdentity: mocks.resolveSelfUpgradeHostIdentity,
}));

vi.mock("@/lib/self-upgrade/support", () => ({
  readSelfUpgradeSupport: mocks.readSelfUpgradeSupport,
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));

vi.mock("@/lib/self-upgrade/registry-release", () => ({ readRegistryReleaseCandidate: mocks.readRegistryReleaseCandidate }));

vi.mock("@/lib/self-upgrade/window", () => ({
  isUpgradeWindowOpen: mocks.isUpgradeWindowOpen,
}));

vi.mock("@/lib/operating-hours-read", () => ({
  resolveOperatingScheduleForSystem: mocks.resolveOperatingScheduleForSystem,
}));

vi.mock("@/lib/self-upgrade/auto-window", () => ({
  resolveAutoUpgradeWindow: mocks.resolveAutoUpgradeWindow,
}));

vi.mock("@/lib/self-upgrade/blackout", () => ({
  getActiveSelfUpgradeBlackout: mocks.getActiveSelfUpgradeBlackout,
}));

vi.mock("@/lib/self-upgrade/last-check", () => ({
  getLastCheckedAt: mocks.getLastCheckedAt,
  recordCheckedAt: mocks.recordCheckedAt,
  isCheckIntervalElapsed: mocks.isCheckIntervalElapsed,
}));

vi.mock("@/lib/self-upgrade/version", () => ({
  buildFetchCommand: (i: { hostSourcePath: string; remote: string; branch: string }) => [
    "git",
    "-C",
    i.hostSourcePath,
    "fetch",
    i.remote,
    i.branch,
  ],
  buildRemoteHeadCommand: (i: { hostSourcePath: string; remote: string; branch: string }) => [
    "git",
    "-C",
    i.hostSourcePath,
    "rev-parse",
    `${i.remote}/${i.branch}`,
  ],
}));

vi.mock("@/lib/self-upgrade/prepare-source", () => ({
  prepareUpgradeSource: mocks.prepareUpgradeSource,
  defaultGitRunner: mocks.defaultGitRunner,
}));

vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: mocks.getDeployedSha,
  isFeatureBuildDeployed: mocks.isFeatureBuildDeployed,
}));

vi.mock("@/lib/self-upgrade/runtime-image-identity", () => ({ readCurrentContainerConfigDigest: mocks.readCurrentContainerConfigDigest }));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  createRun: mocks.createRun,
  startRun: mocks.startRun,
  completeRun: mocks.completeRun,
  failRun: mocks.failRun,
  skipRun: mocks.skipRun,
  updateRunPlan: mocks.updateRunPlan,
  recordRunRecoveryPoint: mocks.recordRunRecoveryPoint,
  recordPromoterReadiness: mocks.recordPromoterReadiness,
  getLatestRun: mocks.getLatestRun,
  getLatestSucceededRun: mocks.getLatestSucceededRun,
}));

vi.mock("@/lib/self-upgrade/promoter", async (importOriginal) => ({
  // Keep the real pure exports (constants like PROMOTER_ALREADY_RUNNING_EXIT_CODE
  // that the orchestrator imports statically) and mock only the spawn-heavy fns.
  ...(await importOriginal<typeof import("@/lib/self-upgrade/promoter")>()),
  runPromoter: mocks.runPromoter,
  isPromoterAvailable: mocks.isPromoterAvailable,
  ensurePromoterImage: mocks.ensurePromoterImage,
  buildCandidatePromoterImage: mocks.buildCandidatePromoterImage,
  resolvePromoterArtifact: mocks.resolvePromoterArtifact,
  runPromoterReadiness: mocks.runPromoterReadiness,
}));

vi.mock("@/lib/self-upgrade/cooldown", () => ({
  getCooldownUntil: mocks.getCooldownUntil,
  recordCooldown: mocks.recordCooldown,
  clearCooldown: mocks.clearCooldown,
  isInCooldown: (until: Date | null, now: Date) =>
    !!until && now.getTime() < until.getTime(),
  DEFAULT_COOLDOWN_MINUTES: 30,
}));

// BI-EFA383AA: override only evaluateHostMemoryGuard (real impl reads os.freemem);
// keep every other export real via importActual so formatGiB / checkHostMemoryHeadroom
// / constants are unaffected.
vi.mock("@/lib/self-upgrade/host-memory-preflight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/self-upgrade/host-memory-preflight")>()),
  evaluateHostMemoryGuard: mocks.evaluateHostMemoryGuard,
}));

vi.mock("@/lib/self-upgrade/notifications", () => ({
  emitUpgradeEvent: mocks.emitUpgradeEvent,
}));

vi.mock("@/lib/self-upgrade/recovery-point", () => ({
  createSelfUpgradeRecoveryPoint: mocks.createSelfUpgradeRecoveryPoint,
  summarizeRecoveryPointFailure: mocks.summarizeRecoveryPointFailure,
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  startQuiescence: mocks.startQuiescence,
  signalSwapStarting: mocks.signalSwapStarting,
  signalSwapComplete: mocks.signalSwapComplete,
  failQuiescenceSwap: mocks.failQuiescenceSwap,
  captureActiveSessionBlockers: mocks.captureActiveSessionBlockers,
}));

import {
  selfUpgradeScheduled,
  selfUpgradeManual,
  runSelfUpgrade,
} from "./self-upgrade";
import { allFunctions } from "./index";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "@/lib/self-upgrade/promoter";

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

function setupSourceReady(stamp = "abc1234deadbeef"): void {
  mocks.defaultGitRunner.mockImplementation(async (args: string[]) =>
    args.includes("rev-parse")
      ? { stdout: `${stamp}\n`, stderr: "", code: 0 }
      : { stdout: "", stderr: "", code: 0 },
  );
  mocks.getLatestSucceededRun.mockResolvedValue(null);
  mocks.prepareUpgradeSource.mockResolvedValue({
    ok: true,
    mode: "upstream",
    stamp,
    upstreamSha: stamp,
  });
}

const OK_RECOVERY_POINT = {
  schemaVersion: 1,
  status: "ok",
  trigger: "pre-upgrade-recovery",
  selfUpgradeRunId: "SUR-AAAABBBB",
  createdAt: "2026-06-01T00:00:00.000Z",
  members: [
    { target: "postgres", runId: "BR-PG", status: "ok" },
    { target: "neo4j", runId: "BR-N4J", status: "ok" },
    { target: "qdrant", runId: "BR-QD", status: "ok" },
  ],
};

beforeEach(() => {
  mocks.readSelfUpgradeSupport.mockImplementation(async (configuredEnabled: boolean) => ({
    configuredEnabled,
    supported: true,
    enabled: configuredEnabled,
    targetKind: "git-source",
    reason: configuredEnabled ? "enabled" : "disabled-by-config",
    message: configuredEnabled ? null : "Automatic updates are turned off.",
  }));
  mocks.readFile.mockImplementation(async (path: string) => path.endsWith("install-state.json") ? TEST_INSTALL_STATE : "s".repeat(32));
  mocks.resolveSelfUpgradeHostIdentity.mockReturnValue({ platform: "linux", arch: "amd64", provenance: "explicit" });
  mocks.createSelfUpgradeRecoveryPoint.mockResolvedValue(OK_RECOVERY_POINT);
  mocks.recordRunRecoveryPoint.mockResolvedValue({});
  const artifact = { digest: `sha256:${"d".repeat(64)}`, sourceSha: "abc1234deadbeef", contractSchema: 1, contractDigest: `sha256:${"c".repeat(64)}`, callerProtocol: { min: 1, max: 1 } };
  mocks.resolvePromoterArtifact.mockResolvedValue(artifact);
  mocks.runPromoterReadiness.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ stage: "preflight", result: "ready", failures: [], sourceHash: TEST_INSTALL_STATE_HASH, projectionHash: "b".repeat(64), fromSchemaVersion: 1, toSchemaVersion: 2 }), stderr: "" });
  mocks.recordPromoterReadiness.mockResolvedValue({});
  mocks.summarizeRecoveryPointFailure.mockReturnValue(
    "recovery-point-failed: postgres BR-PG",
  );
});

registerSelfUpgradeFunctionTests({ allFunctions, scheduled: selfUpgradeScheduled, manual: selfUpgradeManual });

const ENABLED_CONFIG = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  batchMinPendingPrs: 10,
  batchMaxWaitHours: 168,
  healthTarget: 100,
  maintenanceWindows: [],
  hostInstallPath: "/Users/me/dpf",
  hostSourceMountPath: "/host-dpf",
  promoterImage: "dpf-promoter",
  repositoryRemote: "origin",
  repositoryBranch: "main",
  healthUrl: "http://localhost:3000/api/health",
  sourceMode: "upstream" as const,
  installBranch: "dpf/install",
};

describe("success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captureActiveSessionBlockers.mockReset();
    mocks.captureActiveSessionBlockers.mockResolvedValue({ surfaces: [] });
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-AAAABBBB" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "promoted", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
    mocks.isFeatureBuildDeployed.mockResolvedValue(true);
  });

  registerCoreSelfUpgradeSuccessTest({ mocks, runSelfUpgrade });

  it("classifies a source-free consumer at the verified release as up to date without Git", async () => {
    const sourceSha = "a".repeat(40);
    const releaseState = JSON.stringify({ installMode: "consumer", imageTag: "v2.0.0", installPath: "/opt/dpf", composeFiles: ["docker-compose.yml", "docker-compose.release.yml"] });
    mocks.getDeployedSha.mockResolvedValue(sourceSha);
    const configDigest = `sha256:${"a".repeat(64)}`;
    configureReleaseUpgradeTest({ mocks, installState: releaseState, sourceSha, currentConfigDigest: configDigest, targetConfigDigest: configDigest });
    try {
      const result = await runSelfUpgrade({ triggeredBy: "ops" });
      expect(result).toMatchObject({ skipped: true, reason: "up-to-date", releaseTag: "v2.0.0" });
      expect(mocks.defaultGitRunner).not.toHaveBeenCalled();
      expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
      expect(mocks.evaluateHostMemoryGuard).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands the frozen release config digest through to promotion", async () => {
    const sourceSha = "abc1234deadbeef";
    const targetConfigDigest = `sha256:${"c".repeat(64)}`;
    configureReleaseUpgradeTest({ mocks, installState: TEST_INSTALL_STATE, sourceSha, currentConfigDigest: `sha256:${"a".repeat(64)}`, targetConfigDigest });
    try {
      const result = await runSelfUpgrade({ triggeredBy: "ops" });
      expect(result).toMatchObject({ ok: true, status: "succeeded" });
      expect(mocks.runPromoter).toHaveBeenCalledWith(expect.objectContaining({
        release: {
          tag: "v2.0.0",
          ghcrOwner: "opendigitalproductfactory",
          channelDigest: `sha256:${"b".repeat(64)}`, platformManifestDigest: `sha256:${"c".repeat(64)}`,
          configDigest: targetConfigDigest, platformOs: "linux", platformArchitecture: "amd64",
        },
      }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["artifact resolution", "resolve"],
    ["readiness dependency", "readiness"],
  ])("fails before drain, recovery, and promotion on %s failure", async (_label, failure) => {
    if (failure === "resolve") mocks.resolvePromoterArtifact.mockRejectedValue(new Error("source SHA mismatch"));
    else mocks.runPromoterReadiness.mockResolvedValue({ exitCode: 78, stdout: '{"failures":[{"code":"state_mount_unreadable","message":"Repair the state mount"}]}', stderr: "" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: false, reason: "promoter-readiness-failed" });
    expect(mocks.recordPromoterReadiness).toHaveBeenCalled();
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.createSelfUpgradeRecoveryPoint).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });
  registerInstallStateHandoffTests({ mocks, runSelfUpgrade, installState: TEST_INSTALL_STATE, installStateHash: TEST_INSTALL_STATE_HASH });
  it("claims a pre-created queued run instead of creating a second run", async () => {
    mocks.updateRunPlan.mockResolvedValue({ runId: "SUR-QUEUED1" });

    const result = await runSelfUpgrade({ triggeredBy: "ops", runId: "SUR-QUEUED1" });

    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.updateRunPlan).toHaveBeenCalledWith("SUR-QUEUED1", {
      fromVersion: "oldsha1",
      toVersion: "abc1234deadbeef",
      expectedDeployedSha: "abc1234deadbeef",
    });
    expect(mocks.startRun).toHaveBeenCalledWith("SUR-QUEUED1");
    expect(result).toMatchObject({ ok: true, status: "succeeded", runId: "SUR-QUEUED1" });
  });
  it("creates and records a recovery point after quiescence and before swap starts", async () => {
    const order: string[] = [];
    mocks.createSelfUpgradeRecoveryPoint.mockImplementation(async () => {
      order.push("createSelfUpgradeRecoveryPoint");
      return OK_RECOVERY_POINT;
    });
    mocks.recordRunRecoveryPoint.mockImplementation(async () => {
      order.push("recordRunRecoveryPoint");
      return {};
    });
    mocks.startQuiescence.mockImplementation(async () => {
      order.push("startQuiescence");
      return {
        runId: "QR-2026-05-24-test1234",
        awaitReady: () =>
          Promise.resolve({
            ok: true,
            outcome: "ready-to-swap",
            runId: "QR-2026-05-24-test1234",
            finalSnapshot: null,
          }),
      };
    });
    mocks.signalSwapStarting.mockImplementation(async () => {
      order.push("signalSwapStarting");
    });

    await runSelfUpgrade({ triggeredBy: "ops" });

    expect(mocks.createSelfUpgradeRecoveryPoint).toHaveBeenCalledWith({
      runId: "SUR-AAAABBBB",
      dryRun: undefined,
    });
    expect(mocks.recordRunRecoveryPoint).toHaveBeenCalledWith(
      "SUR-AAAABBBB",
      OK_RECOVERY_POINT,
    );
    expect(order).toEqual([
      "startQuiescence",
      "createSelfUpgradeRecoveryPoint",
      "recordRunRecoveryPoint",
      "signalSwapStarting",
    ]);
  });

  it("prepares the upgrade source with the configured mode/remote/branch/install branch", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.prepareUpgradeSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMode: "upstream",
        remote: "origin",
        branch: "main",
        installBranch: "dpf/install",
      }),
      expect.any(Function),
    );
  });

  it("skips only when both upstream lineage and deployed identity match", async () => {
    mocks.getLatestSucceededRun.mockResolvedValue({ targetSha: "abc1234deadbeef" });
    mocks.getDeployedSha.mockResolvedValue("abc1234deadbeef");
    const result = await runSelfUpgrade({ triggeredBy: "scheduled" });
    expect(result).toMatchObject({ skipped: true, reason: "up-to-date" });
    expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    vi.clearAllMocks();
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestSucceededRun.mockResolvedValue({ targetSha: "abc1234deadbeef" });
    mocks.getDeployedSha.mockResolvedValue("synthetic-local-merge-sha");
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.prepareUpgradeSource).toHaveBeenCalled();
    expect(mocks.runPromoter).toHaveBeenCalled();
  });

  it("skips BEFORE draining when activity is in flight — no drain/defer/cooldown cycle (BI-F36E7510)", async () => {
    // Build Studio work in flight: the activity precheck must skip cleanly
    // instead of flipping the portal to draining and burning the full budget
    // waiting for a BuildPhaseRun that outlasts it (the periodic bad-state bug).
    mocks.captureActiveSessionBlockers.mockResolvedValueOnce({
      surfaces: [{ surface: "build-studio.phase.plan", kind: "hard" }],
    });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ skipped: true, reason: "activity-in-flight" });
    // The whole point: no drain, no cooldown — the portal never refuses actions.
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
  });

  it("force bypasses the activity precheck and proceeds to drain", async () => {
    mocks.captureActiveSessionBlockers.mockResolvedValueOnce({
      surfaces: [{ surface: "build-studio.phase.plan", kind: "hard" }],
    });
    await runSelfUpgrade({ triggeredBy: "ops", force: true });
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });

  // BI-CC82B9A8 — a manual operator "Upgrade now" must not silently no-op on the
  // operator's OWN session. Soft blockers (e.g. request.recent-tool-execution,
  // which fires on the very clicks that drove this trigger) must NOT early-skip a
  // manual trigger; it proceeds into the drain, which converges when no hard work
  // is running. Without this, a routine deploy is un-runnable without Emergency
  // override while the operator is driving the portal.
  it("manual trigger does NOT early-skip on a soft blocker — proceeds to drain (BI-CC82B9A8)", async () => {
    mocks.captureActiveSessionBlockers.mockResolvedValueOnce({
      surfaces: [{ surface: "request.recent-tool-execution", kind: "soft" }],
    });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).not.toMatchObject({ reason: "activity-in-flight" });
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });

  it("manual trigger STILL early-skips on a hard blocker (BI-F36E7510 preserved)", async () => {
    mocks.captureActiveSessionBlockers.mockResolvedValueOnce({
      surfaces: [
        { surface: "coworker.reasoning-loop", kind: "hard" },
        { surface: "request.recent-tool-execution", kind: "soft" },
      ],
    });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ skipped: true, reason: "activity-in-flight" });
    // Only the hard surface is reported as the blocker; the soft one is filtered.
    expect(result).toMatchObject({ surfaces: ["coworker.reasoning-loop"] });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });

  it("scheduled poll keeps the conservative 'any surface skips' behavior on a soft blocker (BI-F36E7510)", async () => {
    mocks.captureActiveSessionBlockers.mockResolvedValueOnce({
      surfaces: [{ surface: "request.recent-tool-execution", kind: "soft" }],
    });
    const result = await runSelfUpgrade({ triggeredBy: "cron", scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "activity-in-flight" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });
  it("runs the promoter with the host install path, backup, image, and health paths", async () => {
    vi.stubEnv("DPF_STATE_DIR_HOST", "/Users/me/.dpf");
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.runPromoter).toHaveBeenCalledWith(
      expect.objectContaining({
        // Promoter mounts daemon-resolved host paths, never portal paths.
        hostInstallPath: "/Users/me/dpf",
        targetSha: "abc1234deadbeef",
        backupPath: "/backups/self-upgrade/SUR-AAAABBBB",
        healthUrl: "http://localhost:3000/api/health",
        promoterImage: `sha256:${"d".repeat(64)}`,
        stateDirHostPath: "/Users/me/.dpf",
      }),
    );
    vi.unstubAllEnvs();
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
    expect(mocks.createSelfUpgradeRecoveryPoint).toHaveBeenCalledWith({
      runId: "SUR-AAAABBBB",
      dryRun: true,
    });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.signalSwapComplete).not.toHaveBeenCalled();
  });
});

describe("pre-upgrade recovery point gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-RECOVERY" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.failRun.mockResolvedValue({});
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mocks.createSelfUpgradeRecoveryPoint.mockResolvedValue({
      ...OK_RECOVERY_POINT,
      status: "failed",
      selfUpgradeRunId: "SUR-RECOVERY",
      members: [
        { target: "postgres", runId: "BR-PG", status: "failed" },
        { target: "neo4j", runId: "BR-N4J", status: "ok" },
        { target: "qdrant", runId: "BR-QD", status: "ok" },
      ],
    });
    mocks.summarizeRecoveryPointFailure.mockReturnValue(
      "recovery-point-failed: postgres BR-PG",
    );
  });

  it("fails after quiescence and before promoter when the recovery point fails", async () => {
    const result = await runSelfUpgrade({ triggeredBy: "ops" });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      runId: "SUR-RECOVERY",
      quiescenceRunId: "QR-2026-05-24-test1234",
      reason: "recovery-point-failed",
      excerpt: "recovery-point-failed: postgres BR-PG",
    });
    expect(mocks.recordRunRecoveryPoint).toHaveBeenCalled();
    expect(mocks.failRun).toHaveBeenCalledWith(
      "SUR-RECOVERY",
      "recovery-point-failed: postgres BR-PG",
    );
    expect(mocks.startQuiescence).toHaveBeenCalled();
    expect(mocks.failQuiescenceSwap).toHaveBeenCalledWith(
      "QR-2026-05-24-test1234",
      "recovery-point-failed: postgres BR-PG",
    );
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    expect(mocks.emitUpgradeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upgrade.failed",
        runId: "SUR-RECOVERY",
        payload: { reason: "recovery-point-failed: postgres BR-PG" },
      }),
    );
  });
});

describe("maintenance window gate + emergency override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default the 24/7 resolver back to "operating-hours" (clearAllMocks leaves a
    // prior describe's return value / one-shot queue intact); the 24/7 tests below
    // override per-call with mockReturnValueOnce.
    mocks.resolveAutoUpgradeWindow.mockReturnValue({ kind: "operating-hours" });
    mocks.getActiveSelfUpgradeBlackout.mockResolvedValue(null); // no blackout by default
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-FORCE001" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "promoted", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
  });

  it("SCHEDULED run skips with outside-window when the store is open", async () => {
    mocks.isUpgradeWindowOpen.mockReturnValue(false);
    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "outside-window" });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });

  it("MANUAL run is NOT window-gated — runs even when the store is open", async () => {
    mocks.isUpgradeWindowOpen.mockReturnValue(false);
    const result = await runSelfUpgrade({ triggeredBy: "manual:ops" }); // scheduled unset
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.runPromoter).toHaveBeenCalled();
    // a manual trigger doesn't even consult the window gate
    expect(mocks.isUpgradeWindowOpen).not.toHaveBeenCalled();
  });

  it("force=true bypasses the window gate on the scheduled path too", async () => {
    mocks.isUpgradeWindowOpen.mockReturnValue(false);
    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true, force: true });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.runPromoter).toHaveBeenCalled();
  });

  // BI-A6382FB9 — a 24/7 store has no derived "closed" window. With a known
  // timezone the scheduled gate evaluates against the auto-selected overnight
  // window instead of the (never-open) operating-hours derivation, so scheduled
  // upgrades actually run.
  it("SCHEDULED run on a 24/7 store evaluates the auto-selected overnight window", async () => {
    const autoWindows = [
      { dayOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "02:00", endTime: "04:00" },
    ];
    mocks.resolveAutoUpgradeWindow.mockReturnValueOnce({
      kind: "auto-overnight",
      windows: autoWindows,
      source: "default",
    });
    mocks.isUpgradeWindowOpen.mockReturnValue(true); // currently inside the overnight window

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    // The gate evaluates the AUTO windows, not the empty operating-hours derivation.
    expect(mocks.isUpgradeWindowOpen).toHaveBeenCalledWith(
      expect.objectContaining({ explicitWindows: autoWindows }),
    );
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
  });

  // BI-A6382FB9 — a 24/7 store with no derivable timezone can't be scheduled
  // safely. It skips cleanly (no drain, no run, no cooldown) with a distinct
  // reason; the Upgrade Center prompts for a timezone rather than guessing.
  it("SCHEDULED run on a 24/7 store with no known timezone skips with no-window-needs-timezone", async () => {
    mocks.resolveAutoUpgradeWindow.mockReturnValueOnce({ kind: "needs-timezone" });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(result).toMatchObject({ skipped: true, reason: "no-window-needs-timezone" });
    // Never consults the window gate, never drains, never creates a run.
    expect(mocks.isUpgradeWindowOpen).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });

  // BI-59591B14 — an operator-declared blackout pauses the unattended scheduled
  // upgrade. Clean no-op: the blackout gate runs FIRST, so no window check, no
  // drain, no run. It resumes automatically once the blackout ends. (force, tested
  // above, bypasses the whole scheduled-gate block including this.)
  it("SCHEDULED run skips with blackout-period during an active operator blackout", async () => {
    mocks.getActiveSelfUpgradeBlackout.mockResolvedValueOnce({
      name: "Launch week freeze",
      endAt: new Date("2026-07-08T00:00:00Z"),
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(result).toMatchObject({
      skipped: true,
      reason: "blackout-period",
      blackoutUntil: "2026-07-08T00:00:00.000Z",
    });
    expect(mocks.isUpgradeWindowOpen).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });
});

describe("failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
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

  it("defers (does NOT fail) when a promoter for this run is already building (SUR-E2BF265E)", async () => {
    // runPromoter's idempotency guard declines to launch a duplicate and reports
    // the sentinel. The orchestrator must leave run state untouched — no failRun,
    // no cooldown — so a healthy in-flight build is never recorded as failed.
    mocks.runPromoter.mockResolvedValue({
      exitCode: PROMOTER_ALREADY_RUNNING_EXIT_CODE,
      stdout: "",
      stderr: "[promoter-already-running] deferring to it",
    });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: true, status: "already-in-flight", runId: "SUR-FAILTEST" });
    expect(mocks.failRun).not.toHaveBeenCalled();
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
  });

  // The failure excerpt now LEADS with a build-failure classification and
  // PRESERVES the raw log beneath it (BI-E4CBC7C1), so the BLOCKED reason an
  // agent reads downstream carries an actionable class, not a raw log.
  it("includes the raw stderr in the classified excerpt and a class header", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "some stdout", stderr: "fatal: deploy error" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({
      excerpt: expect.stringContaining("fatal: deploy error"),
      failureClass: "unknown",
    });
    expect(result.excerpt).toMatch(/^\[build-failure-class\]/);
  });

  it("falls back to stdout for the raw log when stderr is empty", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 2, stdout: "stdout only output", stderr: "" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ excerpt: expect.stringContaining("stdout only output") });
  });

  it("uses unknown error as the raw log when both stderr and stdout are empty", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ excerpt: expect.stringContaining("unknown error") });
  });

  it("calls failRun with runId and the classified excerpt", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "promote script failed" });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.failRun).toHaveBeenCalledWith(
      "SUR-FAILTEST",
      expect.stringContaining("promote script failed"),
    );
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
    expect(mocks.failQuiescenceSwap).toHaveBeenCalledWith(
      "QR-2026-05-24-test1234",
      expect.stringContaining("fatal"),
    );
    expect(mocks.signalSwapComplete).not.toHaveBeenCalled();
  });
});

describe("checkIntervalHours throttle (scheduled only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-INTERVAL" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
  });

  it("skips a scheduled run when the check interval has not elapsed", async () => {
    mocks.isCheckIntervalElapsed.mockReturnValue(false);
    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "interval-not-elapsed" });
    expect(mocks.recordCheckedAt).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });

  it("proceeds (and resets the clock) when the interval has elapsed", async () => {
    mocks.isCheckIntervalElapsed.mockReturnValue(true);
    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.recordCheckedAt).toHaveBeenCalledTimes(1);
  });

  it("does NOT throttle a manual run even when the interval has not elapsed", async () => {
    mocks.isCheckIntervalElapsed.mockReturnValue(false);
    const result = await runSelfUpgrade({ triggeredBy: "manual:ops" }); // scheduled unset
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.recordCheckedAt).toHaveBeenCalledTimes(1);
  });
});

describe("release-batch gate (routine triggers)", () => {
  // A lineage marker that DIFFERS from the resolved upstream stamp, so the
  // up-to-date gate does not short-circuit before the batch gate is reached.
  const LINEAGE = "0ldl1neage00000";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.isCheckIntervalElapsed.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    mocks.captureActiveSessionBlockers.mockResolvedValue({ surfaces: [] });
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.getLatestSucceededRun.mockResolvedValue({ targetSha: LINEAGE });
    mocks.prepareUpgradeSource.mockResolvedValue({
      ok: true,
      mode: "upstream",
      stamp: "abc1234deadbeef",
      upstreamSha: "abc1234deadbeef",
    });
    mocks.createRun.mockResolvedValue({ runId: "SUR-BATCH" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
  });

  /** Recent committer-epoch (seconds), so the max-wait valve does not fire. */
  function recentEpochs(count: number): string {
    const nowSec = Math.floor(Date.now() / 1000);
    return (
      Array.from({ length: count }, (_, i) => String(nowSec - (count - i) * 60)).join("\n") +
      "\n"
    );
  }

  /** git runner: rev-parse => upstream stamp; log => `pendingLines` %ct lines. */
  function gitWithPending(pendingLines: string): void {
    mocks.defaultGitRunner.mockImplementation(async (args: string[]) => {
      if (args.includes("rev-parse")) {
        return { stdout: "abc1234deadbeef\n", stderr: "", code: 0 };
      }
      if (args.includes("log")) {
        return { stdout: pendingLines, stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });
  }

  it("skips a scheduled run below the batch threshold without draining", async () => {
    gitWithPending(recentEpochs(3)); // 3 pending < 10, all recent
    const result = await runSelfUpgrade({ triggeredBy: "cron", scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "batch-below-threshold" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
  });

  it("skips an agent routine run below the batch threshold", async () => {
    gitWithPending(recentEpochs(1)); // 1 pending < 10, recent
    const result = await runSelfUpgrade({ triggeredBy: "mcp:codex", routine: true });
    expect(result).toMatchObject({ skipped: true, reason: "batch-below-threshold" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });

  it("proceeds once the batch threshold is met", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => String(1700000000 + i)).join("\n");
    gitWithPending(`${lines}\n`); // 10 pending >= 10
    const result = await runSelfUpgrade({ triggeredBy: "cron", scheduled: true });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });

  it("does NOT batch-gate a manual (non-routine) trigger", async () => {
    gitWithPending("1700000000\n"); // 1 pending — would block a routine run
    const result = await runSelfUpgrade({ triggeredBy: "manual:ops" });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
  });

  it("does NOT batch-gate a forced run", async () => {
    gitWithPending("1700000000\n");
    const result = await runSelfUpgrade({ triggeredBy: "ops", scheduled: true, force: true });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
  });

  it("fails open and proceeds when the pending tally is uncomputable (shallow clone)", async () => {
    // log fails, deepen fails => null tally => eligible.
    mocks.defaultGitRunner.mockImplementation(async (args: string[]) => {
      if (args.includes("rev-parse")) {
        return { stdout: "abc1234deadbeef\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "shallow", code: 128 };
    });
    const result = await runSelfUpgrade({ triggeredBy: "cron", scheduled: true });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
  });
});

describe("merge-conflict defer (source prep, §5.0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-CONFLICT" });
    mocks.failRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
  });

  it("defers without draining or promoting when the upstream merge conflicts", async () => {
    mocks.prepareUpgradeSource.mockResolvedValue({
      ok: false,
      reason: "merge-conflict",
      conflictFiles: ["apps/web/a.ts", "apps/web/b.ts"],
      upstreamSha: "abc1234deadbeef",
      message: "upstream merge conflicts in 2 file(s)",
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled" });

    expect(result).toMatchObject({
      ok: false,
      status: "deferred-conflict",
      reason: "merge-conflict",
      conflictFiles: ["apps/web/a.ts", "apps/web/b.ts"],
    });
    // The running build is untouched: no drain, no swap.
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    expect(mocks.failRun).toHaveBeenCalledWith(
      "SUR-CONFLICT",
      "merge-conflict: apps/web/a.ts, apps/web/b.ts",
    );
  });
});

describe("quiescence-defer path (BI-QUIESCE-010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
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

// ── Skip-before-drain guards (this fix) ─────────────────────────────────────
// The portal must NEVER enter `draining` when there's nothing to swap to or no
// promoter to do the swap — those were the live runs with empty targetBundleHash
// that cycled the portal unusable.
describe("skip-before-drain guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    // clearAllMocks resets call history but NOT implementations, so re-assert
    // the gate defaults each test (a prior describe can leave them flipped).
    mocks.isCheckIntervalElapsed.mockReturnValue(true);
    // The precheck ALWAYS rebuilds the promoter (ensurePromoterImage) before a swap, so the
    // happy-path default is a successful rebuild; individual tests override to a failure.
    mocks.isPromoterAvailable.mockResolvedValue(true);
    mocks.ensurePromoterImage.mockResolvedValue({
      ok: true,
      alreadyPresent: false,
      built: true,
    });
    mocks.getCooldownUntil.mockResolvedValue(null);
    mocks.recordCooldown.mockResolvedValue(undefined);
    mocks.clearCooldown.mockResolvedValue(undefined);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-GUARD" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
  });

  it("skips with promoter-unavailable BEFORE draining when the promoter cannot be built", async () => {
    mocks.getSelfUpgradeConfig.mockResolvedValue({ ...ENABLED_CONFIG, readinessMode: "legacy-bootstrap", readinessOwner: "unavailable" });
    // The precheck always rebuilds the promoter; the skip survives only when that build fails
    // (or a custom/registry image is configured that we cannot synthesise locally).
    mocks.ensurePromoterImage.mockResolvedValue({
      ok: false,
      alreadyPresent: false,
      built: false,
      skipReason: "build-failed",
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(mocks.ensurePromoterImage).toHaveBeenCalledWith("dpf-promoter");
    expect(result).toMatchObject({ skipped: true, reason: "promoter-unavailable" });
    // Never drained, never prepared a source, never created a run.
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    // A clean no-op sets no cooldown — the next tick re-checks immediately.
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
  });

  it("builds a candidate promoter and proceeds without skipping", async () => {
    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(mocks.buildCandidatePromoterImage).toHaveBeenCalled();
    // Not a promoter-unavailable skip — the run advances past the precheck.
    expect(result).not.toMatchObject({ reason: "promoter-unavailable" });
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });

  it("marks a pre-created queued run skipped when a pre-drain guard stops the attempt", async () => {
    mocks.getSelfUpgradeConfig.mockResolvedValue({ ...ENABLED_CONFIG, readinessMode: "legacy-bootstrap", readinessOwner: "unavailable" });
    // The promoter rebuild fails → the pre-drain promoter-unavailable guard stops the attempt.
    mocks.ensurePromoterImage.mockResolvedValue({
      ok: false,
      alreadyPresent: false,
      built: false,
      skipReason: "build-failed",
    });

    const result = await runSelfUpgrade({
      triggeredBy: "manual:ops",
      runId: "SUR-QUEUED1",
    });

    expect(result).toMatchObject({
      skipped: true,
      reason: "promoter-unavailable",
      runId: "SUR-QUEUED1",
    });
    expect(mocks.skipRun).toHaveBeenCalledWith(
      "SUR-QUEUED1",
      "promoter-unavailable: dpf-promoter",
    );
    expect(mocks.recordCheckedAt).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("rebuilds the promoter against the configured image", async () => {
    await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });
    expect(mocks.buildCandidatePromoterImage).toHaveBeenCalledWith(expect.objectContaining({ promoterImage: "dpf-promoter" }));
  });

  it("does NOT touch the promoter on a dryRun (it never swaps)", async () => {
    await runSelfUpgrade({ triggeredBy: "ops", dryRun: true });
    expect(mocks.ensurePromoterImage).not.toHaveBeenCalled();
  });

  it("skips with up-to-date (no drain) when the built stamp already matches the deployed SHA", async () => {
    // Built identity equals the running runtime identity → nothing to swap.
    mocks.getDeployedSha.mockResolvedValue("abc1234deadbeef");
    setupSourceReady("abc1234deadbeef");

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(result).toMatchObject({ skipped: true, reason: "up-to-date" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
  });

  it("force overrides the nothing-newer guard (operator asked to re-deploy)", async () => {
    mocks.getDeployedSha.mockResolvedValue("abc1234deadbeef");
    setupSourceReady("abc1234deadbeef");

    const result = await runSelfUpgrade({ triggeredBy: "ops", force: true });

    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });

  it("stamps the QuiescenceRun with the real target identity (never empty)", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.startQuiescence).toHaveBeenCalledWith(
      expect.objectContaining({
        targetVersion: "abc1234deadbeef",
        targetBundleHash: "abc1234deadbeef",
      }),
    );
  });

  // BI-EFA383AA: host-memory defer path, driven by the mocked guard so the
  // assertion is host-independent (the real guard reads os.freemem and would
  // otherwise flip this test on macOS/low-memory hosts). Defers BEFORE draining
  // and records a cooldown so the next tick retries once memory recovers.
  it("defers with host-memory-pressure BEFORE draining and records a cooldown", async () => {
    mocks.evaluateHostMemoryGuard.mockResolvedValueOnce({
      defer: true,
      reason: "host memory 1.50GiB < required 2.00GiB",
      extra: { availableBytes: 1_610_612_736, requiredBytes: 2_147_483_648, memorySource: "os-freemem" },
    });

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(result).toMatchObject({ skipped: true, reason: "host-memory-pressure" });
    expect(mocks.recordCooldown).toHaveBeenCalled();
    // Deferred before the drain — the guard sits right before startQuiescence.
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });

  it("proceeds to drain when the host-memory guard reports enough headroom", async () => {
    // Default mock is { defer: false }; the happy path must reach the drain.
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.evaluateHostMemoryGuard).toHaveBeenCalled();
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });
});

// ── Cooldown backoff (this fix) ─────────────────────────────────────────────
// After a deferred/failed drain, the next attempt must wait — otherwise the
// portal re-drains within seconds and refuses work in a tight loop.
describe("cooldown backoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSelfUpgradeConfig.mockResolvedValue(ENABLED_CONFIG);
    mocks.isUpgradeWindowOpen.mockReturnValue(true);
    // clearAllMocks resets call history but NOT implementations — re-assert the
    // gate defaults so a prior describe's flipped value can't leak in.
    mocks.isCheckIntervalElapsed.mockReturnValue(true);
    mocks.isPromoterAvailable.mockResolvedValue(true);
    mocks.getCooldownUntil.mockResolvedValue(null);
    mocks.recordCooldown.mockResolvedValue(undefined);
    mocks.clearCooldown.mockResolvedValue(undefined);
    mocks.getDeployedSha.mockResolvedValue("oldsha1");
    setupSourceReady();
    setupQuiescenceReady();
    mocks.getLatestRun.mockResolvedValue(null);
    mocks.createRun.mockResolvedValue({ runId: "SUR-COOL" });
    mocks.startRun.mockResolvedValue({});
    mocks.emitUpgradeEvent.mockResolvedValue(undefined);
    mocks.failRun.mockResolvedValue({});
    mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mocks.completeRun.mockResolvedValue({});
  });

  it("skips with reason=cooldown while a cooldown is active (no drain, no source prep)", async () => {
    mocks.getCooldownUntil.mockResolvedValue(new Date(Date.now() + 20 * 60 * 1000));

    const result = await runSelfUpgrade({ triggeredBy: "scheduled", scheduled: true });

    expect(result).toMatchObject({ skipped: true, reason: "cooldown" });
    expect(mocks.isPromoterAvailable).not.toHaveBeenCalled();
    expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });

  it("skips a manual event-triggered run too while cooling down (loop-stopper)", async () => {
    mocks.getCooldownUntil.mockResolvedValue(new Date(Date.now() + 20 * 60 * 1000));
    const result = await runSelfUpgrade({ triggeredBy: "manual:autonomous" }); // scheduled unset
    expect(result).toMatchObject({ skipped: true, reason: "cooldown" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
  });

  it("force bypasses an active cooldown (operator override)", async () => {
    mocks.getCooldownUntil.mockResolvedValue(new Date(Date.now() + 20 * 60 * 1000));
    const result = await runSelfUpgrade({ triggeredBy: "ops", force: true });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.startQuiescence).toHaveBeenCalled();
  });

  it("records a cooldown when the coordinator defers", async () => {
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

    await runSelfUpgrade({ triggeredBy: "scheduled" });

    expect(mocks.recordCooldown).toHaveBeenCalledTimes(1);
  });

  it("records a cooldown when the promoter fails", async () => {
    mocks.runPromoter.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "boom" });
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.recordCooldown).toHaveBeenCalledTimes(1);
  });

  it("clears the cooldown after a successful swap", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.clearCooldown).toHaveBeenCalledTimes(1);
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
  });
});
