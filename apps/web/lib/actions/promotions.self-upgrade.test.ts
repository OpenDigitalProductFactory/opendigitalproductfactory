import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    changePromotion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    businessProfile: {
      findFirst: vi.fn(),
    },
    selfUpgradeRun: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: vi.fn(),
  lazyUtil: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/config", () => ({
  getSelfUpgradeConfig: vi.fn(),
  nextMaintenanceWindowStart: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/self-upgrade/support", () => ({
  readSelfUpgradeSupport: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/release-target", () => ({ loadReleaseInstallContext: vi.fn(), resolveReleaseUpgradeCandidate: vi.fn() }));

vi.mock("@/lib/self-upgrade/version", () => ({
  resolveTargetSha: vi.fn(),
  isShaFresh: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/completion", () => ({
  getDeployedSha: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/runtime-image-identity", () => ({ readCurrentContainerConfigDigest: vi.fn().mockResolvedValue(`sha256:${"a".repeat(64)}`) }));
vi.mock("@/lib/self-upgrade/run-store", () => ({
  createRun: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestSucceededRun: vi.fn(),
}));
vi.mock("@/lib/self-upgrade/admission", () => ({
  resolveCurrentSelfUpgradeTarget: vi.fn(),
  admitSelfUpgrade: vi.fn(),
}));
vi.mock("@/lib/self-upgrade/impact", () => ({
  getCurrentImpactSummaryId: vi.fn().mockResolvedValue(null),
  loadRunImpactDigest: vi.fn().mockResolvedValue(null),
  loadRunImpactDigests: vi.fn().mockResolvedValue(new Map()),
  loadRunImpactSummary: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/self-upgrade/window", () => ({
  isStoreOpen: vi.fn().mockReturnValue(false),
  isUpgradeWindowOpen: vi.fn().mockReturnValue(true),
  nextUpgradeWindowOpen: vi.fn().mockReturnValue(null),
}));

// 24/7 auto-window resolution (BI-A6382FB9). Default "operating-hours" so the
// existing (non-24/7) status tests are unaffected; the 24/7 tests override it.
vi.mock("@/lib/self-upgrade/auto-window", () => ({
  resolveAutoUpgradeWindow: vi.fn().mockReturnValue({ kind: "operating-hours" }),
  nextAutoWindowOpen: vi.fn().mockReturnValue(null),
  describeWindows: vi.fn().mockReturnValue("2:00 AM–4:00 AM"),
}));

// Operator blackout (BI-59591B14). Default null = no active blackout.
vi.mock("@/lib/self-upgrade/blackout", () => ({
  getActiveSelfUpgradeBlackout: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/operating-hours-read", () => ({
  resolveOperatingScheduleForSystem: vi
    .fn()
    .mockResolvedValue({ schedule: {}, timezone: "UTC", timezoneKnown: false, lowTrafficWindows: [] }),
}));

vi.mock("@/lib/self-upgrade/last-check", () => ({
  getLastCheckedAt: vi.fn().mockResolvedValue(null),
}));

// getSelfUpgradeStatus now reads live drain activity + cooldown for the panel;
// stub both so the status read stays hermetic (the @dpf/db mock above has no
// platformConfig / quiescenceRun models).
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceActivity: vi.fn().mockResolvedValue({
    level: "normal",
    runId: null,
    enteredAt: "1970-01-01T00:00:00.000Z",
    run: null,
    blockersCapturedAt: null,
    blockers: [],
  }),
}));

vi.mock("@/lib/self-upgrade/cooldown", () => ({
  getCooldownUntil: vi.fn().mockResolvedValue(null),
  // config.ts imports this default transitively (via the queue function module).
  DEFAULT_COOLDOWN_MINUTES: 30,
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
    // createFunction is called at module-init by self-upgrade.ts; stub it to avoid TypeError
    createFunction: vi.fn().mockReturnValue({ id: "mocked-fn" }),
  },
}));

vi.mock("@/lib/platform/version", () => ({
  loadPlatformVersion: async () => ({
    version: "1.0.0",
    publishedAt: new Date("2026-05-24T00:00:00.000Z"),
    gitSha: "abc1234",
    imageVersion: { raw: "abc1234", source: "git-sha" as const },
    note: "baseline",
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/rollback", () => {
  class SelfUpgradeRollbackError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SelfUpgradeRollbackError";
    }
  }
  class RestoreIntegrityError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RestoreIntegrityError";
    }
  }
  class RestoreLockedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RestoreLockedError";
    }
  }
  return {
    SELF_UPGRADE_ROLLBACK_CONFIRMATION_TEXT: "ROLLBACK",
    SelfUpgradeRollbackError,
    RestoreIntegrityError,
    RestoreLockedError,
    runSelfUpgradeRollback: vi.fn(),
  };
});

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { resolveTargetSha, isShaFresh } from "@/lib/self-upgrade/version";
import { getDeployedSha } from "@/lib/self-upgrade/completion";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import { loadReleaseInstallContext, resolveReleaseUpgradeCandidate } from "@/lib/self-upgrade/release-target";
import { createRun, getLatestRun, getLatestSucceededRun } from "@/lib/self-upgrade/run-store";
import {
  admitSelfUpgrade,
  resolveCurrentSelfUpgradeTarget,
} from "@/lib/self-upgrade/admission";
import {
  getCurrentImpactSummaryId,
  loadRunImpactDigests,
  loadRunImpactSummary,
} from "@/lib/self-upgrade/impact";
import { isUpgradeWindowOpen, nextUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { resolveAutoUpgradeWindow, nextAutoWindowOpen } from "@/lib/self-upgrade/auto-window";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import { getLastCheckedAt } from "@/lib/self-upgrade/last-check";
import { inngest } from "@/lib/queue/inngest-client";
import { revalidatePath } from "next/cache";
import { runSelfUpgradeRollback, SelfUpgradeRollbackError } from "@/lib/self-upgrade/rollback";
import { createSelfUpgradeTargetBinding } from "@/lib/self-upgrade/target-binding";
import {
  getSelfUpgradeRunImpact,
  getSelfUpgradeStatus,
  listSelfUpgradeRuns,
  rollbackSelfUpgrade,
  triggerSelfUpgrade,
} from "./promotions";
import { consumerReleaseContext, consumerReleaseSupport, mockConfig, mockRun, mockSession, mockRunRow1, mockRunRow2, recoverableRun } from "./promotions.self-upgrade.test-fixtures";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
  vi.mocked(readSelfUpgradeSupport).mockImplementation(async (configuredEnabled) => ({
    configuredEnabled,
    supported: true,
    enabled: configuredEnabled,
    targetKind: "git-source",
    reason: configuredEnabled ? "enabled" : "disabled-by-config",
    message: configuredEnabled
      ? null
      : "Automatic updates are turned off for this source-backed install.",
  }));
  vi.mocked(loadReleaseInstallContext).mockResolvedValue(null);
  vi.mocked(getLatestRun).mockResolvedValue(null);
  vi.mocked(getLatestSucceededRun).mockResolvedValue(null);
  vi.mocked(resolveCurrentSelfUpgradeTarget).mockResolvedValue({
    targetKind: "git-source",
    targetSha: "b".repeat(40),
    targetTag: null,
  });
  vi.mocked(admitSelfUpgrade).mockResolvedValue({
    admitted: true,
    disposition: "created",
    runId: "SUR-QUEUED1",
    dispatchStatus: "admission_pending",
  });
  vi.mocked(createRun).mockResolvedValue({
    ...mockRun,
    runId: "SUR-QUEUED1",
    status: "queued",
    trigger: "manual:user-ops-1",
    currentSha: null,
    targetSha: null,
    deployedSha: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-06-13T21:00:00Z"),
    updatedAt: new Date("2026-06-13T21:00:00Z"),
  } as never);
  vi.mocked(getCurrentImpactSummaryId).mockResolvedValue(null);
  vi.mocked(getLastCheckedAt).mockResolvedValue(null);
  vi.mocked(nextUpgradeWindowOpen).mockReturnValue(null);
  // Default the 24/7 resolver back to "operating-hours" each test (clearAllMocks
  // leaves return values intact, so a prior 24/7 test would otherwise leak).
  vi.mocked(resolveAutoUpgradeWindow).mockReturnValue({ kind: "operating-hours" });
  vi.mocked(nextAutoWindowOpen).mockReturnValue(null);
  vi.mocked(getActiveSelfUpgradeBlackout).mockResolvedValue(null); // no blackout by default
  // Default: treat triggers as in-window so dispatch tests exercise the happy
  // path. Tests that care about the window gate override this explicitly.
  vi.mocked(isUpgradeWindowOpen).mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ─── Permission Guard ─────────────────────────────────────────────────────────

describe("getSelfUpgradeStatus – access control", () => {
  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(getSelfUpgradeStatus()).rejects.toThrow("Unauthorized");
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(getSelfUpgradeStatus()).rejects.toThrow("Unauthorized");
  });

  it("checks view_operations permission with user role", async () => {
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue(null);
    vi.mocked(resolveTargetSha).mockResolvedValue(null);
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    await getSelfUpgradeStatus();

    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({
        platformRole: mockSession.user.platformRole,
        isSuperuser: mockSession.user.isSuperuser,
      }),
      "view_operations",
    );
  });
});

// ─── getSelfUpgradeStatus ─────────────────────────────────────────────────────

describe("getSelfUpgradeStatus", () => {
  it("uses the verified release stamp for a consumer without resolving Git", async () => {
    const sourceSha = "f".repeat(40);
    vi.mocked(readSelfUpgradeSupport).mockResolvedValue(consumerReleaseSupport);
    vi.mocked(loadReleaseInstallContext).mockResolvedValue(consumerReleaseContext);
    vi.mocked(resolveReleaseUpgradeCandidate).mockResolvedValue({ kind: "target", tag: "v2.0.0", sourceSha, channelDigest: `sha256:${"b".repeat(64)}`, platformManifestDigest: `sha256:${"d".repeat(64)}`, configDigest: `sha256:${"c".repeat(64)}`, platformOs: "linux", platformArchitecture: "amd64" });
    vi.mocked(getDeployedSha).mockResolvedValue("e".repeat(40));
    vi.mocked(isShaFresh).mockReturnValue(false);
    const result = await getSelfUpgradeStatus();
    expect(result).toMatchObject({ targetSha: sourceSha, targetTag: "v2.0.0", targetAvailability: "resolved" });
    expect(resolveTargetSha).not.toHaveBeenCalled();
  });

  it("returns config fields, window status, sha info, and latest run", async () => {
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(true);
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(mockRun as never);

    const result = await getSelfUpgradeStatus();

    expect(result.enabled).toBe(true);
    expect(result.channel).toBe("stable");
    expect(result.inMaintenanceWindow).toBe(true);
    expect(result.deployedSha).toBe("abc1234");
    expect(result.targetSha).toBe("def5678");
    expect(result.isFresh).toBe(false);
    expect(result.latestRun).toEqual(mockRun);
    expect(result.platformVersion.version).toBe("1.0.0");
    expect(result.platformVersion.publishedAt).toBe("2026-05-24T00:00:00.000Z");
    expect(result.platformVersion.gitSha).toBe("abc1234");
    expect(result.platformVersion.note).toBe("baseline");
    expect(result.nextScheduledCheckAt).toBeTruthy();
  });

  it("reports when the next scheduled check can run inside the current window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T17:21:00.000Z"));
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(true);
    vi.mocked(getLastCheckedAt).mockResolvedValue(new Date("2026-05-23T16:00:00.000Z"));
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.nextScheduledCheckAt).toBe("2026-05-24T18:00:00.000Z");
    vi.useRealTimers();
  });

  it("delays the scheduled check until the configured interval has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T17:21:00.000Z"));
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(true);
    vi.mocked(getLastCheckedAt).mockResolvedValue(new Date("2026-05-24T10:30:00.000Z"));
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.nextScheduledCheckAt).toBe("2026-05-25T11:00:00.000Z");
    vi.useRealTimers();
  });

  it("reports the first hourly tick after the next maintenance window opens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T16:10:00.000Z"));
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(nextUpgradeWindowOpen).mockReturnValue(new Date("2026-05-24T17:30:00.000Z"));
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.nextWindowStart).toBe("2026-05-24T17:30:00.000Z");
    expect(result.nextScheduledCheckAt).toBe("2026-05-24T18:00:00.000Z");
    vi.useRealTimers();
  });

  it("returns isFresh=true when deployed sha matches target", async () => {
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue("def5678");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(true);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.isFresh).toBe(true);
    expect(result.latestRun).toBeNull();
  });

  // Merge-mode regression: the deployed stamp is the merge-commit identity that
  // CONTAINS but never EQUALS the upstream target, so strict deployedSha==target
  // is a permanent false "Update available". The banner must instead read fresh
  // off the upstream lineage marker (latest succeeded run's targetSha), agreeing
  // with the worker skip-gate and the impact summary.
  it("returns isFresh=true via the lineage marker when the deployed merge-commit differs from the target", async () => {
    const UPSTREAM = "802224ba8308c641c3211e38e4d2036d8b11655f";
    const MERGE_COMMIT = "d7c7b200bcae825c454617ffe36a5353c2318e86";
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    // Running image identity is the merge commit, NOT the upstream target.
    vi.mocked(getDeployedSha).mockResolvedValue(MERGE_COMMIT);
    vi.mocked(resolveTargetSha).mockResolvedValue(UPSTREAM);
    // The latest succeeded run absorbed exactly that upstream target.
    vi.mocked(getLatestSucceededRun).mockResolvedValue({
      ...mockRun,
      targetSha: UPSTREAM,
      deployedSha: MERGE_COMMIT,
    } as never);
    // Real comparator semantics: equal-SHA ⇒ true. deployed≠target ⇒ false;
    // lineageMarker==target ⇒ true.
    vi.mocked(isShaFresh).mockImplementation(
      (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase(),
    );

    const result = await getSelfUpgradeStatus();

    expect(result.isFresh).toBe(true);
    expect(result.deployedSha).toBe(MERGE_COMMIT);
    expect(result.targetSha).toBe(UPSTREAM);
  });

  it("returns isFresh=false when the lineage marker is still behind the target (genuine update)", async () => {
    const NEW_TARGET = "ad7e7249cdc1e0a23e43c10b7266ed78457971f5";
    const OLD_UPSTREAM = "802224ba8308c641c3211e38e4d2036d8b11655f";
    const MERGE_COMMIT = "d7c7b200bcae825c454617ffe36a5353c2318e86";
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue(MERGE_COMMIT);
    vi.mocked(resolveTargetSha).mockResolvedValue(NEW_TARGET);
    // Last succeeded run absorbed an OLDER upstream than the now-resolved target.
    vi.mocked(getLatestSucceededRun).mockResolvedValue({
      ...mockRun,
      targetSha: OLD_UPSTREAM,
      deployedSha: MERGE_COMMIT,
    } as never);
    vi.mocked(isShaFresh).mockImplementation(
      (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase(),
    );

    const result = await getSelfUpgradeStatus();

    expect(result.isFresh).toBe(false);
  });

  it("returns isFresh=false and skips isShaFresh when targetSha is null", async () => {
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(mockConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue(null);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.isFresh).toBe(false);
    expect(result.targetSha).toBeNull();
    expect(isShaFresh).not.toHaveBeenCalled();
  });

  it("returns disabled status when self-upgrade is disabled", async () => {
    const disabledConfig = { ...mockConfig, enabled: false };
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(disabledConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue(null);
    vi.mocked(resolveTargetSha).mockResolvedValue(null);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.enabled).toBe(false);
  });

  it("evaluates the upgrade window from explicit windows + operating-hours schedule", async () => {
    const explicit = [{ dayOfWeek: [2], startTime: "02:00", endTime: "04:00" }];
    const windowConfig = { ...mockConfig, maintenanceWindows: explicit };
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(windowConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue(null);
    vi.mocked(resolveTargetSha).mockResolvedValue(null);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    // The window is derived (store-closed) with explicit windows as override.
    expect(isUpgradeWindowOpen).toHaveBeenCalledWith(
      expect.objectContaining({ explicitWindows: explicit, timeZone: "UTC" }),
    );
    expect(result.inMaintenanceWindow).toBe(false);
    // Explicit windows present → windowSource reflects the override.
    expect(result.windowSource).toBe("explicit");
  });

  // BI-A6382FB9 — a 24/7 store auto-picks an overnight window; the panel shows a
  // read-only schedule note and the next 02:00 local, not the dead-end "configured".
  it("auto-selects an overnight window for a 24/7 store (windowSource=auto-overnight)", async () => {
    const autoWindows = [
      { dayOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "02:00", endTime: "04:00" },
    ];
    vi.mocked(resolveAutoUpgradeWindow).mockReturnValue({
      kind: "auto-overnight",
      windows: autoWindows,
      source: "default",
    });
    vi.mocked(nextAutoWindowOpen).mockReturnValue(new Date("2026-05-26T02:00:00.000Z"));
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false); // not currently in the 2-4am window
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.windowSource).toBe("auto-overnight");
    expect(result.autoWindowSummary).toBe("2:00 AM–4:00 AM");
    // nextWindowStart comes from the auto window, not the (null) operating-hours derivation.
    expect(result.nextWindowStart).toBe("2026-05-26T02:00:00.000Z");
    // The gate is evaluated against the auto windows.
    expect(isUpgradeWindowOpen).toHaveBeenCalledWith(
      expect.objectContaining({ explicitWindows: autoWindows }),
    );
  });

  // BI-A6382FB9 — a 24/7 store with no derivable timezone prompts the operator
  // instead of guessing an overnight window in an unknown zone.
  it("prompts for a timezone on a 24/7 store with no known timezone (windowSource=needs-timezone)", async () => {
    vi.mocked(resolveAutoUpgradeWindow).mockReturnValue({ kind: "needs-timezone" });
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.windowSource).toBe("needs-timezone");
    expect(result.autoWindowSummary).toBeNull();
    expect(result.nextWindowStart).toBeNull();
    // No window is handed to the gate (24/7 + unknown tz → not auto-runnable).
    expect(isUpgradeWindowOpen).toHaveBeenCalledWith(
      expect.objectContaining({ explicitWindows: undefined }),
    );
  });

  // BI-59591B14 — surface an active operator blackout so the panel can explain a
  // paused schedule instead of leaving it opaque.
  it("surfaces an active operator blackout (blackoutUntil + blackoutName)", async () => {
    vi.mocked(getActiveSelfUpgradeBlackout).mockResolvedValue({
      name: "Launch week freeze",
      endAt: new Date("2026-07-08T00:00:00Z"),
    });
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue("def5678");
    vi.mocked(isShaFresh).mockReturnValue(false);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.blackoutUntil).toBe("2026-07-08T00:00:00.000Z");
    expect(result.blackoutName).toBe("Launch week freeze");
  });

  it("leaves blackout fields null when no blackout is active", async () => {
    vi.mocked(getDeployedSha).mockResolvedValue("abc1234");
    vi.mocked(resolveTargetSha).mockResolvedValue(null);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    const result = await getSelfUpgradeStatus();

    expect(result.blackoutUntil).toBeNull();
    expect(result.blackoutName).toBeNull();
  });

  it("passes channel and source config to resolveTargetSha", async () => {
    const betaConfig = { ...mockConfig, channel: "beta" };
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue(betaConfig as never);
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(getDeployedSha).mockResolvedValue(null);
    vi.mocked(resolveTargetSha).mockResolvedValue(null);
    vi.mocked(getLatestRun).mockResolvedValue(null);

    await getSelfUpgradeStatus();

    expect(resolveTargetSha).toHaveBeenCalledWith("beta", betaConfig);
  });
});

// ─── listSelfUpgradeRuns ──────────────────────────────────────────────────────

describe("listSelfUpgradeRuns – access control", () => {
  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(listSelfUpgradeRuns()).rejects.toThrow("Unauthorized");
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(listSelfUpgradeRuns()).rejects.toThrow("Unauthorized");
  });
});

describe("listSelfUpgradeRuns – pagination", () => {
  it("returns all items and null nextCursor when result is under limit", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow1, mockRunRow2] as never,
    );

    const result = await listSelfUpgradeRuns({ limit: 20 });

    expect(result.runs).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("returns limit items and nextCursor when more items exist", async () => {
    // Return limit+1 rows to signal there is a next page
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow1, mockRunRow2] as never,
    );

    const result = await listSelfUpgradeRuns({ limit: 1 });

    expect(result.runs).toHaveLength(1);
    expect(result.nextCursor).toBe(mockRunRow1.runId);
  });

  it("passes cursor and skip:1 to findMany when cursor is provided", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow2] as never,
    );

    await listSelfUpgradeRuns({ cursor: "SUR-AAAA0001", limit: 20 });

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { runId: "SUR-AAAA0001" },
        skip: 1,
      }),
    );
  });

  it("omits cursor args when no cursor is provided", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    const call = vi.mocked(prisma.selfUpgradeRun.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("cursor");
    expect(call).not.toHaveProperty("skip");
  });

  it("uses default limit of 20 (take=21) when no limit given", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21 }),
    );
  });

  it("caps limit at 50 (take=51) when a larger limit is requested", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns({ limit: 200 });

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }),
    );
  });

  it("orders by createdAt descending", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    expect(prisma.selfUpgradeRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });
});

// BI-F7A591AF: a history row identified only by a SHA pair could not answer
// "which upgrade introduced this?". Each row now carries the digest of the
// summary the run recorded — batched, never a query per row.
describe("listSelfUpgradeRuns – per-run impact digest", () => {
  it("attaches each run's own digest, keyed by its recorded summary id", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [
        { ...mockRunRow1, impactSummaryId: "UIS-1" },
        { ...mockRunRow2, impactSummaryId: null },
      ] as never,
    );
    vi.mocked(loadRunImpactDigests).mockResolvedValue(
      new Map([["UIS-1", { counts: { total: 4 }, headline: "Four changes." }]]) as never,
    );

    const result = await listSelfUpgradeRuns({ limit: 20 });

    expect(loadRunImpactDigests).toHaveBeenCalledTimes(1);
    expect(loadRunImpactDigests).toHaveBeenCalledWith(["UIS-1", null]);
    expect(result.runs[0]!.impact).toMatchObject({ headline: "Four changes." });
    // A run that recorded no summary reports null rather than borrowing another's.
    expect(result.runs[1]!.impact).toBeNull();
  });

  it("asks for digests only for the page it returns, not the lookahead row", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [
        { ...mockRunRow1, impactSummaryId: "UIS-1" },
        { ...mockRunRow2, impactSummaryId: "UIS-2" },
      ] as never,
    );
    vi.mocked(loadRunImpactDigests).mockResolvedValue(new Map() as never);

    await listSelfUpgradeRuns({ limit: 1 });

    expect(loadRunImpactDigests).toHaveBeenCalledWith(["UIS-1"]);
  });
});

describe("getSelfUpgradeRunImpact", () => {
  it("loads the full summary by the run's OWN recorded id", async () => {
    vi.mocked(prisma.selfUpgradeRun.findUnique).mockResolvedValue(
      { impactSummaryId: "UIS-9" } as never,
    );
    vi.mocked(loadRunImpactSummary).mockResolvedValue({ targetSha: "b" } as never);

    const out = await getSelfUpgradeRunImpact("SUR-AAAA0001");

    expect(loadRunImpactSummary).toHaveBeenCalledWith("UIS-9");
    expect(out).toMatchObject({ targetSha: "b" });
  });

  it("returns null for a run that recorded no summary", async () => {
    vi.mocked(prisma.selfUpgradeRun.findUnique).mockResolvedValue(
      { impactSummaryId: null } as never,
    );
    vi.mocked(loadRunImpactSummary).mockResolvedValue(null as never);

    expect(await getSelfUpgradeRunImpact("SUR-BBBB0002")).toBeNull();
    expect(loadRunImpactSummary).toHaveBeenCalledWith(null);
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(getSelfUpgradeRunImpact("SUR-AAAA0001")).rejects.toThrow("Unauthorized");
  });
});

describe("listSelfUpgradeRuns – DTO shape", () => {
  it("returns expected fields and excludes log", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue(
      [mockRunRow1] as never,
    );

    const result = await listSelfUpgradeRuns();
    const run = result.runs[0];

    expect(run.runId).toBe(mockRunRow1.runId);
    expect(run.status).toBe(mockRunRow1.status);
    expect(run.trigger).toBe(mockRunRow1.trigger);
    expect(run.currentSha).toBe(mockRunRow1.currentSha);
    expect(run.targetSha).toBe(mockRunRow1.targetSha);
    expect(run.deployedSha).toBe(mockRunRow1.deployedSha);
    expect(run.completionEvidence).toEqual(mockRunRow1.completionEvidence);
    expect(run.startedAt).toEqual(mockRunRow1.startedAt);
    expect(run.completedAt).toEqual(mockRunRow1.completedAt);
    expect(run.failureLog).toBeNull();
    expect(run.createdAt).toEqual(mockRunRow1.createdAt);
    expect(run).not.toHaveProperty("log");
    expect(run).not.toHaveProperty("triggeredBy");
    expect(run).not.toHaveProperty("fromVersion");
    expect(run).not.toHaveProperty("toVersion");
    expect(run).not.toHaveProperty("error");
  });

  it("selects only DTO fields from the database", async () => {
    vi.mocked(prisma.selfUpgradeRun.findMany).mockResolvedValue([] as never);

    await listSelfUpgradeRuns();

    const call = vi.mocked(prisma.selfUpgradeRun.findMany).mock.calls[0][0] as Record<string, unknown>;
    const select = call.select as Record<string, boolean>;
    expect(select.runId).toBe(true);
    expect(select.status).toBe(true);
    expect(select.trigger).toBe(true);
    expect(select.currentSha).toBe(true);
    expect(select.targetSha).toBe(true);
    expect(select.deployedSha).toBe(true);
    expect(select.reason).toBe(true);
    expect(select.completionEvidence).toBe(true);
    expect(select.startedAt).toBe(true);
    expect(select.completedAt).toBe(true);
    expect(select.failureLog).toBe(true);
    expect(select.createdAt).toBe(true);
    expect(select).not.toHaveProperty("log");
    expect(select).not.toHaveProperty("triggeredBy");
    expect(select).not.toHaveProperty("fromVersion");
    expect(select).not.toHaveProperty("toVersion");
    expect(select).not.toHaveProperty("error");
  });
});

// ─── rollbackSelfUpgrade ───────────────────────────────────────────────────────

describe("rollbackSelfUpgrade", () => {
  beforeEach(() => {
    vi.mocked(runSelfUpgradeRollback).mockResolvedValue({
      ok: true,
      status: "ok",
      runId: "SUR-AAAA0001",
      restores: [
        {
          target: "postgres",
          sourceBackupRunId: "BR-PG",
          restoreId: "RR-PG",
          status: "ok",
        },
      ],
    });
  });

  it("rejects callers without restore authority", async () => {
    vi.mocked(can).mockImplementation((_user, capability) => capability === "view_operations");

    const result = await rollbackSelfUpgrade("SUR-AAAA0001", "ROLLBACK");

    expect(result).toEqual({
      ok: false,
      error: "You do not have permission to restore upgrade recovery points.",
    });
    expect(runSelfUpgradeRollback).not.toHaveBeenCalled();
  });

  it("requires the exact rollback confirmation text", async () => {
    const result = await rollbackSelfUpgrade("SUR-AAAA0001", "restore");

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Confirmation text must be exactly "ROLLBACK"');
    expect(runSelfUpgradeRollback).not.toHaveBeenCalled();
  });

  it("runs the governed rollback and revalidates operations views", async () => {
    const result = await rollbackSelfUpgrade("SUR-AAAA0001", "ROLLBACK");

    expect(result).toMatchObject({ ok: true, status: "ok" });
    expect(runSelfUpgradeRollback).toHaveBeenCalledWith({
      runId: "SUR-AAAA0001",
      initiatedByUserId: mockSession.user.id,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/ops/self-upgrade");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/backups");
  });

  it("returns governed rollback errors as operator-safe messages", async () => {
    vi.mocked(runSelfUpgradeRollback).mockRejectedValue(
      new SelfUpgradeRollbackError("Self-upgrade run has no governed recovery point."),
    );

    const result = await rollbackSelfUpgrade("SUR-AAAA0001", "ROLLBACK");

    expect(result).toEqual({
      ok: false,
      error: "Self-upgrade run has no governed recovery point.",
    });
  });
});

// ─── triggerSelfUpgrade – access control ─────────────────────────────────────

describe("triggerSelfUpgrade – access control", () => {
  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(triggerSelfUpgrade()).rejects.toThrow("Unauthorized");
  });

  it("rejects users without view_operations permission", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(triggerSelfUpgrade()).rejects.toThrow("Unauthorized");
  });
});

describe("triggerSelfUpgrade – dispatch", () => {
  it("does not grant recovery authority to a plain failed-run retry", async () => {
    vi.mocked(getLatestRun).mockResolvedValue(recoverableRun as never);
    const result = await triggerSelfUpgrade();
    expect(admitSelfUpgrade).not.toHaveBeenCalled();
    expect(result).toMatchObject({ queued: false, reason: "recovery-binding-required", runId: "SUR-6B312E24" });
  });
  it.each([
    { dispatchAttemptCount: 1 },
    { dispatchAcknowledgedAt: new Date("2026-09-06T18:28:00Z") },
    { dispatchEventIds: ["dispatch-event"] },
  ])("admits a fresh run after a dispatched failure: %j", async (dispatch) => {
    vi.mocked(getLatestRun).mockResolvedValue({ ...recoverableRun, ...dispatch } as never);
    const result = await triggerSelfUpgrade();
    expect(result).toMatchObject({ queued: true, admitted: true });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      recoveryOfRunId: null, requestedForce: false,
    }));
  });
  it("uses the authenticated operator action as the sole typed recovery boundary", async () => {
    const releaseTarget = { targetKind: "release-artifact" as const, targetSha: "c137e6cdb1fe82d00565841ec683cec5c80710ab",
      targetTag: "v2026.08.29-source-free-upgrade-reconciliation.1" };
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", "test-target-binding-secret");
    vi.mocked(readSelfUpgradeSupport).mockResolvedValue(consumerReleaseSupport);
    vi.mocked(resolveCurrentSelfUpgradeTarget).mockResolvedValue(null);
    vi.mocked(getLatestRun).mockResolvedValue(recoverableRun as never);
    const result = await triggerSelfUpgrade({ targetBinding: createSelfUpgradeTargetBinding(releaseTarget) });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: "manual:user-ops-1", target: releaseTarget, recoveryOfRunId: "SUR-6B312E24",
    }));
    expect(result).toMatchObject({ queued: true, admitted: true, runId: "SUR-QUEUED1" });
  });
  it("preserves the rendered target on a fresh dispatched-failure retry", async () => {
    const target = { targetKind: "release-artifact" as const, targetSha: "c137e6cdb1fe82d00565841ec683cec5c80710ab", targetTag: "v2026.08.29-source-free-upgrade-reconciliation.1" };
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", "test-target-binding-secret");
    vi.mocked(readSelfUpgradeSupport).mockResolvedValue(consumerReleaseSupport);
    vi.mocked(getLatestRun).mockResolvedValue({ ...recoverableRun, dispatchAttemptCount: 1 } as never);
    vi.mocked(resolveCurrentSelfUpgradeTarget).mockResolvedValue(target);
    expect(await triggerSelfUpgrade({ targetBinding: createSelfUpgradeTargetBinding(target) })).toMatchObject({ queued: true });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({ target, recoveryOfRunId: null, requestedForce: false }));
  });
  it("refuses an incomplete failed run without fresh admission", async () => {
    vi.mocked(getLatestRun).mockResolvedValue({ ...recoverableRun, completedAt: null, dispatchAttemptCount: 1 } as never);
    expect(await triggerSelfUpgrade()).toMatchObject({ queued: false, reason: "recovery-predecessor-not-terminal" });
    expect(admitSelfUpgrade).not.toHaveBeenCalled();
  });
  it("attaches the reviewed impact summary to the run when one exists", async () => {
    vi.mocked(getCurrentImpactSummaryId).mockResolvedValueOnce("UIS-77");
    await triggerSelfUpgrade();
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: "manual:user-ops-1",
      impactSummaryId: "UIS-77",
    }));
  });
  it("binds the manual actor and force posture in admission", async () => {
    await triggerSelfUpgrade();
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: `manual:${mockSession.user.id}`,
      requestedForce: false,
    }));
  });
  it("passes dryRun: true when dryRun option is set", async () => {
    await triggerSelfUpgrade({ dryRun: true });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("returns { queued: true }", async () => {
    const result = await triggerSelfUpgrade();
    expect(result).toMatchObject({ queued: true, admitted: true, runId: "SUR-QUEUED1" });
  });

});

// ─── triggerSelfUpgrade – maintenance window gate + emergency override ─────────

describe("triggerSelfUpgrade – manual is not window-gated", () => {
  it("QUEUES even when the store is open — the operator chose now", async () => {
    // Manual trigger must run regardless of the (store-closed) window; the window
    // only governs the unattended scheduled poll. (BI-F0E4272B)
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);

    const result = await triggerSelfUpgrade();

    expect(result).toMatchObject({ queued: true, admitted: true, runId: "SUR-QUEUED1" });
    expect(admitSelfUpgrade).toHaveBeenCalled();
    // It doesn't even consult the window for a manual trigger.
    expect(vi.mocked(isUpgradeWindowOpen)).not.toHaveBeenCalled();
  });

  it("emergency override dispatches with force (bypasses the quiescence drain)", async () => {
    const result = await triggerSelfUpgrade({ force: true });

    expect(result).toMatchObject({ queued: true, admitted: true, runId: "SUR-QUEUED1" });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ requestedForce: true }),
    );
  });

  it("does not include force in the event for a normal manual trigger", async () => {
    await triggerSelfUpgrade();

    expect(admitSelfUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ requestedForce: false }),
    );
  });
});

// ─── triggerSelfUpgrade – guard: already-running ──────────────────────────────

describe("triggerSelfUpgrade – guard: already-running", () => {
  it("returns queued: false with reason already-running when a run is active", async () => {
    vi.mocked(getLatestRun).mockResolvedValue({
      ...mockRun,
      status: "running",
      runId: "SUR-RUNNING1",
    } as never);

    const result = await triggerSelfUpgrade();

    expect(result).toEqual(
      expect.objectContaining({ queued: false, reason: "already-running" }),
    );
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it("includes runId of the active run in the response", async () => {
    vi.mocked(getLatestRun).mockResolvedValue({
      ...mockRun,
      status: "running",
      runId: "SUR-RUNNING1",
    } as never);

    const result = await triggerSelfUpgrade() as { runId?: string };

    expect(result.runId).toBe("SUR-RUNNING1");
  });

  it("applies already-running guard even when dryRun is true", async () => {
    vi.mocked(getLatestRun).mockResolvedValue({
      ...mockRun,
      status: "running",
      runId: "SUR-RUNNING1",
    } as never);

    const result = await triggerSelfUpgrade({ dryRun: true });

    expect(result).toEqual(
      expect.objectContaining({ queued: false, reason: "already-running" }),
    );
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it("does not dispatch a duplicate event while the latest run is still queued", async () => {
    vi.mocked(getLatestRun).mockResolvedValue({
      ...mockRun,
      runId: "SUR-QUEUED1",
      status: "queued",
      startedAt: null,
      completedAt: null,
    } as never);

    const result = await triggerSelfUpgrade();

    expect(result).toMatchObject({
      queued: false,
      reason: "already-queued",
      runId: "SUR-QUEUED1",
    });
    expect(createRun).not.toHaveBeenCalled();
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });
});

// ─── triggerSelfUpgrade – guard: invalid-config ───────────────────────────────

describe("triggerSelfUpgrade – guard: invalid-config", () => {
  it("returns queued: false with reason disabled when config.enabled is false", async () => {
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue({
      ...mockConfig,
      enabled: false,
    } as never);

    const result = await triggerSelfUpgrade();

    expect(result).toEqual(
      expect.objectContaining({ queued: false, reason: "disabled" }),
    );
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it("dryRun bypasses the disabled guard and dispatches the event", async () => {
    vi.mocked(getSelfUpgradeConfig).mockResolvedValue({
      ...mockConfig,
      enabled: false,
    } as never);

    const result = await triggerSelfUpgrade({ dryRun: true });

    expect(result).toMatchObject({ queued: true, admitted: true, runId: "SUR-QUEUED1" });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});
