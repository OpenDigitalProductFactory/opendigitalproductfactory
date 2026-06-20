import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  advanceStrandedBuildToReview,
  reconcileDeployedShipBuilds,
  areOptionalStartupTasksEnabled,
  isInngestSelfSyncOnBootEnabled,
  isStartupModelRevalidationEnabled,
  reconcileSelfUpgradeRunsOnBoot,
  recoverContradictoryBuildExecStatesOnBoot,
  resumeStrandedBuildsOnBoot,
  scheduleInitialCodeGraphBootstrap,
  warnIfLegacyHiveTokenEnvSet,
  syncPlatformVersionOnBoot,
} from "./instrumentation";

const syncPlatformVersionConfigMock = vi.fn();
const getDeployedShaMock = vi.fn();
const completeRunMock = vi.fn();
const failRunMock = vi.fn();
const selfUpgradeRunFindManyMock = vi.fn();
const featureBuildFindManyMock = vi.fn();
const featureBuildFindUniqueMock = vi.fn();
const featureBuildUpdateMock = vi.fn();
const featureBuildUpdateManyMock = vi.fn();
const buildActivityCreateMock = vi.fn();
const getScopedVerificationForBuildMock = vi.fn();
const queueBuildReviewVerificationMock = vi.fn();
const productVersionFindManyMock = vi.fn();
const changePromotionUpdateManyMock = vi.fn();
const isFeatureBuildDeployedMock = vi.fn();
const reconcileBuildCompletionMock = vi.fn();

vi.mock("@/lib/platform/version-config", () => ({
  syncPlatformVersionConfig: (...args: unknown[]) => syncPlatformVersionConfigMock(...args),
}));

vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: () => getDeployedShaMock(),
  isFeatureBuildDeployed: (...args: unknown[]) => isFeatureBuildDeployedMock(...args),
}));

vi.mock("@/lib/build-flow-state", () => ({
  reconcileBuildCompletion: (...args: unknown[]) => reconcileBuildCompletionMock(...args),
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  completeRun: (...args: unknown[]) => completeRunMock(...args),
  failRun: (...args: unknown[]) => failRunMock(...args),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    selfUpgradeRun: {
      findMany: (...args: unknown[]) => selfUpgradeRunFindManyMock(...args),
    },
    featureBuild: {
      findMany: (...args: unknown[]) => featureBuildFindManyMock(...args),
      findUnique: (...args: unknown[]) => featureBuildFindUniqueMock(...args),
      update: (...args: unknown[]) => featureBuildUpdateMock(...args),
      updateMany: (...args: unknown[]) => featureBuildUpdateManyMock(...args),
    },
    buildActivity: {
      create: (...args: unknown[]) => buildActivityCreateMock(...args),
    },
    productVersion: {
      findMany: (...args: unknown[]) => productVersionFindManyMock(...args),
    },
    changePromotion: {
      updateMany: (...args: unknown[]) => changePromotionUpdateManyMock(...args),
    },
  },
  // Sentinels — the reconcilers only need identity equality, not real Prisma.
  Prisma: { DbNull: { __dbnull: true }, JsonNull: { __jsonnull: true } },
}));

vi.mock("@/lib/build/scoped-verification", () => ({
  getScopedVerificationForBuild: (...args: unknown[]) => getScopedVerificationForBuildMock(...args),
}));

vi.mock("@/lib/build-review-verification-trigger", () => ({
  queueBuildReviewVerification: (...args: unknown[]) => queueBuildReviewVerificationMock(...args),
}));

beforeEach(() => {
  getDeployedShaMock.mockReset();
  completeRunMock.mockReset();
  failRunMock.mockReset();
  selfUpgradeRunFindManyMock.mockReset();
  featureBuildFindManyMock.mockReset();
  featureBuildFindUniqueMock.mockReset();
  featureBuildUpdateMock.mockReset();
  featureBuildUpdateManyMock.mockReset();
  buildActivityCreateMock.mockReset();
  getScopedVerificationForBuildMock.mockReset();
  queueBuildReviewVerificationMock.mockReset();
  productVersionFindManyMock.mockReset();
  changePromotionUpdateManyMock.mockReset();
  isFeatureBuildDeployedMock.mockReset();
  reconcileBuildCompletionMock.mockReset();
  featureBuildUpdateMock.mockResolvedValue({});
  featureBuildUpdateManyMock.mockResolvedValue({ count: 1 });
  buildActivityCreateMock.mockResolvedValue({});
  queueBuildReviewVerificationMock.mockResolvedValue(undefined);
  productVersionFindManyMock.mockResolvedValue([]);
  changePromotionUpdateManyMock.mockResolvedValue({ count: 0 });
  reconcileBuildCompletionMock.mockResolvedValue(false);
  delete process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS;
});

describe("reconcileDeployedShipBuilds — autonomous ship→complete (flag-gated)", () => {
  afterEach(() => {
    delete process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS;
  });

  it("is a no-op (returns null) when the auto-complete flag is off", async () => {
    delete process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS;
    const result = await reconcileDeployedShipBuilds({ log: vi.fn(), error: vi.fn() });
    expect(result).toBeNull();
    expect(featureBuildFindManyMock).not.toHaveBeenCalled();
  });

  it("completes a ship-phase build once its merged code is live, marking the promotion deployed", async () => {
    process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS = "1";
    featureBuildFindManyMock.mockResolvedValue([{ id: "fb-1", buildId: "FB-1" }]);
    isFeatureBuildDeployedMock.mockResolvedValue(true);
    productVersionFindManyMock.mockResolvedValue([{ id: "pv-1" }]);
    changePromotionUpdateManyMock.mockResolvedValue({ count: 1 });
    reconcileBuildCompletionMock.mockResolvedValue(true);

    const result = await reconcileDeployedShipBuilds({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ completed: 1 });
    expect(changePromotionUpdateManyMock).toHaveBeenCalledTimes(1);
    const updateArg = changePromotionUpdateManyMock.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(updateArg.data.status).toBe("deployed");
    expect(reconcileBuildCompletionMock).toHaveBeenCalledWith("FB-1");
  });

  it("skips a ship-phase build whose merged code is not live yet", async () => {
    process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS = "on";
    featureBuildFindManyMock.mockResolvedValue([{ id: "fb-2", buildId: "FB-2" }]);
    isFeatureBuildDeployedMock.mockResolvedValue(false);

    const result = await reconcileDeployedShipBuilds({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ completed: 0 });
    expect(changePromotionUpdateManyMock).not.toHaveBeenCalled();
    expect(reconcileBuildCompletionMock).not.toHaveBeenCalled();
  });
});

describe("warnIfLegacyHiveTokenEnvSet", () => {
  let originalEnvToken: string | undefined;

  beforeEach(() => {
    originalEnvToken = process.env.HIVE_CONTRIBUTION_TOKEN;
  });

  afterEach(() => {
    if (originalEnvToken === undefined) delete process.env.HIVE_CONTRIBUTION_TOKEN;
    else process.env.HIVE_CONTRIBUTION_TOKEN = originalEnvToken;
  });

  it("does nothing when the env var is unset", () => {
    delete process.env.HIVE_CONTRIBUTION_TOKEN;
    const warn = vi.fn();
    const fired = warnIfLegacyHiveTokenEnvSet({ warn });
    expect(fired).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("emits a deprecation warning when the env var is set", () => {
    process.env.HIVE_CONTRIBUTION_TOKEN = "ghp_legacy";
    const warn = vi.fn();
    const fired = warnIfLegacyHiveTokenEnvSet({ warn });
    expect(fired).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain("[deprecation]");
    expect(message).toContain("HIVE_CONTRIBUTION_TOKEN");
    expect(message).toContain("Admin > Platform Development");
    expect(message).toContain("60 days");
  });
});

describe("syncPlatformVersionOnBoot", () => {
  beforeEach(() => {
    syncPlatformVersionConfigMock.mockReset();
  });

  it("returns true and logs success when sync completes", async () => {
    syncPlatformVersionConfigMock.mockResolvedValueOnce(undefined);
    const log = vi.fn();
    const error = vi.fn();

    const result = await syncPlatformVersionOnBoot({ log, error });

    expect(result).toBe(true);
    expect(syncPlatformVersionConfigMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("[platform-version]");
    expect(log.mock.calls[0]![0]).toContain("Synced");
    expect(error).not.toHaveBeenCalled();
  });

  it("returns false and logs error when sync throws", async () => {
    const boom = new Error("db is offline");
    syncPlatformVersionConfigMock.mockRejectedValueOnce(boom);
    const log = vi.fn();
    const error = vi.fn();

    const result = await syncPlatformVersionOnBoot({ log, error });

    expect(result).toBe(false);
    expect(syncPlatformVersionConfigMock).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("[platform-version]");
    expect(error.mock.calls[0]![0]).toContain("Failed");
    expect(error.mock.calls[0]![1]).toBe(boom);
  });
});

describe("reconcileSelfUpgradeRunsOnBoot", () => {
  it("marks an upstream-mode run succeeded when deployed SHA matches expected deployed merge SHA", async () => {
    getDeployedShaMock.mockResolvedValueOnce("merge-sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([
      { runId: "SUR-MERGE", deployedSha: "merge-sha", targetSha: "upstream-sha" },
    ]);
    completeRunMock.mockResolvedValueOnce({});
    const log = vi.fn();
    const error = vi.fn();

    const result = await reconcileSelfUpgradeRunsOnBoot({ log, error });

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(completeRunMock).toHaveBeenCalledWith("SUR-MERGE");
    expect(failRunMock).not.toHaveBeenCalled();
  });

  it("falls back to targetSha for legacy/local rows without deployedSha", async () => {
    getDeployedShaMock.mockResolvedValueOnce("same-sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([
      { runId: "SUR-LOCAL", deployedSha: null, targetSha: "same-sha" },
    ]);
    completeRunMock.mockResolvedValueOnce({});

    const result = await reconcileSelfUpgradeRunsOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    expect(completeRunMock).toHaveBeenCalledWith("SUR-LOCAL");
  });

  it("fails an orphaned run with deployed, expected, and target evidence", async () => {
    getDeployedShaMock.mockResolvedValueOnce("actual-sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([
      { runId: "SUR-ORPHAN", deployedSha: "expected-sha", targetSha: "upstream-sha" },
    ]);
    failRunMock.mockResolvedValueOnce({});

    const result = await reconcileSelfUpgradeRunsOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    expect(failRunMock).toHaveBeenCalledWith(
      "SUR-ORPHAN",
      expect.stringContaining("deployed=actual-sha expected=expected-sha target=upstream-sha"),
    );
  });

  it("on boot (no staleAfterMs) reconciles every running row with no startedAt filter", async () => {
    getDeployedShaMock.mockResolvedValueOnce("sha");
    selfUpgradeRunFindManyMock.mockResolvedValueOnce([]);

    await reconcileSelfUpgradeRunsOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(selfUpgradeRunFindManyMock.mock.calls[0][0].where).toEqual({ status: "running" });
  });

  it("in periodic mode (staleAfterMs > 0) only touches runs stuck past the window, labelled watchdog-reaped", async () => {
    getDeployedShaMock.mockResolvedValueOnce("actual-sha");
    selfUpgradeRunFindManyMock
      .mockResolvedValueOnce([
        { runId: "SUR-STUCK", deployedSha: "expected-sha", targetSha: "upstream-sha" },
      ])
      .mockResolvedValueOnce([]); // 2nd query: no stale queued/pending runs
    failRunMock.mockResolvedValueOnce({});
    const now = () => new Date("2026-06-14T01:00:00.000Z");

    const result = await reconcileSelfUpgradeRunsOnBoot(
      { log: vi.fn(), error: vi.fn() },
      { staleAfterMs: 30 * 60 * 1000, now },
    );

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    // Scoped so an in-flight upgrade (started < 30m ago) is never reconciled.
    const where = selfUpgradeRunFindManyMock.mock.calls[0][0].where;
    expect(where.status).toBe("running");
    expect(where.startedAt.lt.getTime()).toBe(now().getTime() - 30 * 60 * 1000);
    expect(failRunMock).toHaveBeenCalledWith(
      "SUR-STUCK",
      expect.stringContaining('watchdog (stuck "running" > 30m)'),
    );
  });

  it("in periodic mode also fails never-dispatched runs stuck queued/pending", async () => {
    getDeployedShaMock.mockResolvedValueOnce("sha");
    selfUpgradeRunFindManyMock
      .mockResolvedValueOnce([]) // no stuck "running"
      .mockResolvedValueOnce([{ runId: "SUR-QUEUED", status: "queued" }]);
    failRunMock.mockResolvedValueOnce({});
    const now = () => new Date("2026-06-14T01:00:00.000Z");

    const result = await reconcileSelfUpgradeRunsOnBoot(
      { log: vi.fn(), error: vi.fn() },
      { staleAfterMs: 30 * 60 * 1000, now },
    );

    expect(result).toEqual({ succeeded: 0, failed: 1 });
    // 2nd query targets never-started queued/pending rows older than the window.
    const where = selfUpgradeRunFindManyMock.mock.calls[1][0].where;
    expect(where.status).toEqual({ in: ["queued", "pending"] });
    expect(where.startedAt).toBeNull();
    expect(where.createdAt.lt.getTime()).toBe(now().getTime() - 30 * 60 * 1000);
    expect(failRunMock).toHaveBeenCalledWith(
      "SUR-QUEUED",
      expect.stringContaining("dispatch never started"),
    );
  });
});

describe("isStartupModelRevalidationEnabled", () => {
  it("requires explicit opt-in before startup revalidation runs", () => {
    expect(isStartupModelRevalidationEnabled({})).toBe(false);
    expect(
      isStartupModelRevalidationEnabled({
        DPF_STARTUP_MODEL_REVALIDATION_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      isStartupModelRevalidationEnabled({
        DPF_STARTUP_MODEL_REVALIDATION_ENABLED: "true",
      }),
    ).toBe(true);
  });
});

describe("isInngestSelfSyncOnBootEnabled", () => {
  it("requires explicit opt-in before the portal self-registers with Inngest on boot", () => {
    expect(isInngestSelfSyncOnBootEnabled({})).toBe(false);
    expect(
      isInngestSelfSyncOnBootEnabled({
        DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      isInngestSelfSyncOnBootEnabled({
        DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED: "true",
      }),
    ).toBe(true);
  });
});

describe("areOptionalStartupTasksEnabled", () => {
  it("requires explicit opt-in before nonessential startup maintenance runs", () => {
    expect(areOptionalStartupTasksEnabled({})).toBe(false);
    expect(
      areOptionalStartupTasksEnabled({
        DPF_OPTIONAL_STARTUP_TASKS_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      areOptionalStartupTasksEnabled({
        DPF_OPTIONAL_STARTUP_TASKS_ENABLED: "true",
      }),
    ).toBe(true);
  });
});

// ─── Build Studio engine reliability (spec §3.1 engine-first / FB-78E967D4) ───

describe("recoverContradictoryBuildExecStatesOnBoot (FIX 1)", () => {
  it("coerces an error-without-fail checkpoint to `failed` so Retry can resume", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      {
        buildId: "BLD-ERR",
        buildExecState: { step: "complete", error: "threw mid-run", containerId: "c-1" },
        verificationOut: null,
      },
    ]);

    const log = vi.fn();
    const result = await recoverContradictoryBuildExecStatesOnBoot({ log, error: vi.fn() });

    expect(result).toEqual({ recovered: 1, cleared: 0, failedCoerced: 1 });
    expect(featureBuildUpdateMock).toHaveBeenCalledTimes(1);
    const updateArg = featureBuildUpdateMock.mock.calls[0]![0] as {
      where: { buildId: string };
      data: { buildExecState: { step: string; containerId: string } };
    };
    expect(updateArg.where.buildId).toBe("BLD-ERR");
    expect(updateArg.data.buildExecState.step).toBe("failed");
    // Live pointers preserved so retry reuses the sandbox.
    expect(updateArg.data.buildExecState.containerId).toBe("c-1");
    expect(buildActivityCreateMock).toHaveBeenCalledTimes(1);
  });

  it("clears a missing-step checkpoint (SQL NULL) for a clean restart", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      { buildId: "BLD-NOSTEP", buildExecState: { sourceCurrency: { a: 1 } }, verificationOut: null },
    ]);

    const result = await recoverContradictoryBuildExecStatesOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ recovered: 1, cleared: 1, failedCoerced: 0 });
    const updateArg = featureBuildUpdateMock.mock.calls[0]![0] as {
      data: { buildExecState: unknown };
    };
    // DbNull sentinel from the mocked Prisma.
    expect(updateArg.data.buildExecState).toEqual({ __dbnull: true });
  });

  it("clears a complete-no-verify checkpoint for a clean restart", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      { buildId: "BLD-NOVERIFY", buildExecState: { step: "complete" }, verificationOut: null },
    ]);

    const result = await recoverContradictoryBuildExecStatesOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ recovered: 1, cleared: 1, failedCoerced: 0 });
  });

  it("leaves healthy and already-failed rows untouched (idempotent)", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      { buildId: "BLD-OK", buildExecState: { step: "deps_installed" }, verificationOut: null },
      { buildId: "BLD-DONE", buildExecState: { step: "complete" }, verificationOut: { typecheckPassed: true } },
      { buildId: "BLD-FAILED", buildExecState: { step: "failed", failedAt: "db_ready", error: "x" }, verificationOut: null },
    ]);

    const result = await recoverContradictoryBuildExecStatesOnBoot({ log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ recovered: 0, cleared: 0, failedCoerced: 0 });
    expect(featureBuildUpdateMock).not.toHaveBeenCalled();
  });

  it("is non-fatal: returns null and logs when the query throws", async () => {
    featureBuildFindManyMock.mockRejectedValueOnce(new Error("db down"));
    const error = vi.fn();

    const result = await recoverContradictoryBuildExecStatesOnBoot({ log: vi.fn(), error });

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("[build-exec-recover]");
  });
});

describe("resumeStrandedBuildsOnBoot (FIX 2)", () => {
  it("re-dispatches a stranded, internally-consistent mid-step build", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      { buildId: "BLD-STRANDED", phase: "build", buildExecState: { step: "deps_installed" }, verificationOut: null },
    ]);
    const dispatch = vi.fn();

    const result = await resumeStrandedBuildsOnBoot({ dispatch }, { log: vi.fn(), error: vi.fn() });

    expect(result).toEqual({ resumed: 1, flagged: 0, advanced: 0 });
    expect(dispatch).toHaveBeenCalledWith("BLD-STRANDED");
    expect(buildActivityCreateMock).toHaveBeenCalledTimes(1);
  });

  it("skips contradictory shapes (owned by FIX 1) and terminal/null steps", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      // contradictory: error-without-fail
      { buildId: "BLD-CONTRA", phase: "build", buildExecState: { step: "complete", error: "x" }, verificationOut: null },
      // verified-complete but gate-blocked → build->review advancer is consulted, declines
      { buildId: "BLD-COMPLETE", phase: "build", buildExecState: { step: "complete" }, verificationOut: { typecheckPassed: true } },
      { buildId: "BLD-FAILED", phase: "build", buildExecState: { step: "failed", failedAt: "db_ready", error: "x" }, verificationOut: null },
      // missing step (contradictory)
      { buildId: "BLD-NOSTEP", phase: "build", buildExecState: { sourceCurrency: { a: 1 } }, verificationOut: null },
    ]);
    const dispatch = vi.fn();
    const advanceToReview = vi.fn().mockResolvedValue(false);

    const result = await resumeStrandedBuildsOnBoot(
      { dispatch, advanceToReview },
      { log: vi.fn(), error: vi.fn() },
    );

    expect(result).toEqual({ resumed: 0, flagged: 0, advanced: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    // Only the non-contradictory verified-complete row reaches the advancer.
    expect(advanceToReview).toHaveBeenCalledTimes(1);
    expect(advanceToReview).toHaveBeenCalledWith("BLD-COMPLETE");
    // Gate-blocked → no phase flip, no activity row.
    expect(buildActivityCreateMock).not.toHaveBeenCalled();
  });

  // BI-9257CF19: pre-build phases (ideate/plan/review) now AUTO-RESUME via the
  // canonical generator/reviewer re-fire instead of merely flagging for
  // operator rescue, so an in-flight build survives a self-upgrade swap. The
  // `build`-phase step-machine resume is untouched.
  it("auto-resumes ideate/plan/review strands without using the build-phase dispatch", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      { buildId: "BLD-IDEATE", phase: "ideate", buildExecState: null, verificationOut: null, createdById: "user-1" },
      { buildId: "BLD-PLAN", phase: "plan", buildExecState: { step: "deps_installed" }, verificationOut: null, createdById: "user-2" },
      { buildId: "BLD-REVIEW", phase: "review", buildExecState: null, verificationOut: null, createdById: "user-3" },
    ]);
    const dispatch = vi.fn();
    const resumePreBuild = vi.fn();

    const result = await resumeStrandedBuildsOnBoot(
      { dispatch, resumePreBuild },
      { log: vi.fn(), error: vi.fn() },
    );

    expect(result).toEqual({ resumed: 0, flagged: 3, advanced: 0 });
    expect(dispatch).not.toHaveBeenCalled(); // build-phase step-machine only
    // Each pre-build strand is handed to the canonical resumer with its actor.
    expect(resumePreBuild).toHaveBeenCalledTimes(3);
    expect(resumePreBuild).toHaveBeenCalledWith({ buildId: "BLD-IDEATE", phase: "ideate", userId: "user-1" });
    expect(resumePreBuild).toHaveBeenCalledWith({ buildId: "BLD-PLAN", phase: "plan", userId: "user-2" });
    expect(resumePreBuild).toHaveBeenCalledWith({ buildId: "BLD-REVIEW", phase: "review", userId: "user-3" });
    expect(buildActivityCreateMock).toHaveBeenCalledTimes(3); // one resume signal each
  });

  it("queries all non-terminal pre-ship phases with a staleAfter cutoff", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([]);
    const dispatch = vi.fn();

    await resumeStrandedBuildsOnBoot({ staleAfterMs: 60_000, dispatch }, { log: vi.fn(), error: vi.fn() });

    const where = (featureBuildFindManyMock.mock.calls[0]![0] as {
      where: { phase: { in: string[] }; updatedAt: { lt: Date } };
    }).where;
    expect(where.phase).toEqual({ in: ["ideate", "plan", "build", "review"] });
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
  });

  // This fix: a build stranded at the build->review TRANSITION (phase=build,
  // step=complete, verification populated, but the auto-advance never fired —
  // interrupted by a swap, or fired before a gate fix deployed) is advanced to
  // review via the injectable advancer. Mirrors live case FB-69231490.
  it("advances a build-phase strand stuck at the build→review transition (gate passes)", async () => {
    featureBuildFindManyMock.mockResolvedValueOnce([
      {
        buildId: "BLD-AT-GATE",
        phase: "build",
        buildExecState: { step: "complete" },
        verificationOut: { typecheckPassed: true, testsFailed: 0 },
      },
    ]);
    const dispatch = vi.fn();
    const advanceToReview = vi.fn().mockResolvedValue(true);
    const log = vi.fn();

    const result = await resumeStrandedBuildsOnBoot(
      { dispatch, advanceToReview },
      { log, error: vi.fn() },
    );

    expect(result).toEqual({ resumed: 0, flagged: 0, advanced: 1 });
    expect(advanceToReview).toHaveBeenCalledWith("BLD-AT-GATE");
    expect(dispatch).not.toHaveBeenCalled(); // not a step-machine re-dispatch
    expect(buildActivityCreateMock).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.some((c) => String(c[0]).includes("build→review transition"))).toBe(true);
  });

  it("is non-fatal: returns null and logs when the query throws", async () => {
    featureBuildFindManyMock.mockRejectedValueOnce(new Error("db down"));
    const error = vi.fn();

    const result = await resumeStrandedBuildsOnBoot({ dispatch: vi.fn() }, { log: vi.fn(), error });

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("[build-resume]");
  });
});

describe("advanceStrandedBuildToReview (build→review transition resume)", () => {
  it("advances a build whose SCOPED verification clears the gate", async () => {
    featureBuildFindUniqueMock.mockResolvedValueOnce({
      buildId: "FB-69231490",
      phase: "build",
      verificationOut: { typecheckPassed: true, testsFailed: 0 },
    });
    // Scoped view: build's OWN files are clean.
    getScopedVerificationForBuildMock.mockResolvedValueOnce({
      buildScoped: { typecheckPassed: true, testsFailed: 0 },
    });

    const advanced = await advanceStrandedBuildToReview("FB-69231490");

    expect(advanced).toBe(true);
    // Phase flip guarded on still-`build`.
    expect(featureBuildUpdateManyMock).toHaveBeenCalledWith({
      where: { buildId: "FB-69231490", phase: "build" },
      data: { phase: "review" },
    });
    expect(queueBuildReviewVerificationMock).toHaveBeenCalledWith("FB-69231490");
  });

  it("treats an OUT-of-scope failure (null scoped typecheck) as a pass and advances", async () => {
    featureBuildFindUniqueMock.mockResolvedValueOnce({
      buildId: "BLD-NOISE",
      phase: "build",
      // Raw verification shows a failure, but it's elsewhere in the repo.
      verificationOut: { typecheckPassed: false, testsFailed: 3 },
    });
    getScopedVerificationForBuildMock.mockResolvedValueOnce({
      buildScoped: { typecheckPassed: null, testsFailed: null },
    });

    const advanced = await advanceStrandedBuildToReview("BLD-NOISE");

    expect(advanced).toBe(true);
    expect(featureBuildUpdateManyMock).toHaveBeenCalled();
  });

  it("does NOT advance a build with an IN-scope failure (gate stays blocked)", async () => {
    featureBuildFindUniqueMock.mockResolvedValueOnce({
      buildId: "BLD-BROKEN",
      phase: "build",
      verificationOut: { typecheckPassed: false, testsFailed: 2 },
    });
    // The failure is in the build's OWN changed files.
    getScopedVerificationForBuildMock.mockResolvedValueOnce({
      buildScoped: { typecheckPassed: false, testsFailed: 2 },
    });

    const advanced = await advanceStrandedBuildToReview("BLD-BROKEN");

    expect(advanced).toBe(false);
    expect(featureBuildUpdateManyMock).not.toHaveBeenCalled();
    expect(queueBuildReviewVerificationMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the row already left the build phase", async () => {
    featureBuildFindUniqueMock.mockResolvedValueOnce({
      buildId: "BLD-PAST",
      phase: "review",
      verificationOut: { typecheckPassed: true, testsFailed: 0 },
    });

    const advanced = await advanceStrandedBuildToReview("BLD-PAST");

    expect(advanced).toBe(false);
    expect(getScopedVerificationForBuildMock).not.toHaveBeenCalled();
    expect(featureBuildUpdateManyMock).not.toHaveBeenCalled();
  });

  it("no-ops when the guarded phase flip loses the race (count=0)", async () => {
    featureBuildFindUniqueMock.mockResolvedValueOnce({
      buildId: "BLD-RACE",
      phase: "build",
      verificationOut: { typecheckPassed: true, testsFailed: 0 },
    });
    getScopedVerificationForBuildMock.mockResolvedValueOnce({
      buildScoped: { typecheckPassed: true, testsFailed: 0 },
    });
    featureBuildUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const advanced = await advanceStrandedBuildToReview("BLD-RACE");

    expect(advanced).toBe(false);
    expect(queueBuildReviewVerificationMock).not.toHaveBeenCalled();
  });
});

describe("scheduleInitialCodeGraphBootstrap", () => {
  it("schedules a delayed one-shot initializer", async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const error = vi.fn();
    let callback: (() => void) | null = null;
    const setTimer = vi.fn((cb: () => void, delayMs: number) => {
      callback = cb;
      return undefined;
    });

    scheduleInitialCodeGraphBootstrap({
      delayMs: 123,
      ensure,
      logger: { log, error },
      setTimer,
    });

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 123);
    (callback as (() => void) | null)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[code-graph] Initial graph bootstrap complete or already present");
    expect(error).not.toHaveBeenCalled();
  });

  it("logs initializer failures without throwing", async () => {
    const boom = new Error("neo4j unavailable");
    const ensure = vi.fn().mockRejectedValue(boom);
    const log = vi.fn();
    const error = vi.fn();
    let callback: (() => void) | null = null;

    scheduleInitialCodeGraphBootstrap({
      ensure,
      logger: { log, error },
      setTimer(cb) {
        callback = cb;
      },
    });

    (callback as (() => void) | null)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[code-graph] Initial graph bootstrap failed:", boom);
  });
});
