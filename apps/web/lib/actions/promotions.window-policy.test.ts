// BI-2128872C — "nightly window only" on the portal's Upgrade now action.
// Split from promotions.self-upgrade.test.ts (module-size ratchet); the mock
// block mirrors that file so triggerSelfUpgrade runs against the same stubs.
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

// BI-2128872C: deferral bookkeeping + the automation persona identity.
vi.mock("@/lib/self-upgrade/deferred-request", () => ({
  recordDeferredUpgradeRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/govern/automation-sign-in", () => ({
  AUTOMATION_PERSONA_EMAIL: "automation@dpf.local",
}));
vi.mock("@/lib/self-upgrade/release-batch-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/self-upgrade/release-batch-status")>();
  return { ...actual, resolveReleaseBatchStatus: vi.fn(actual.resolveReleaseBatchStatus) };
});

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

vi.mock("@/lib/jobs", () => ({
  jobs: {
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
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { readSelfUpgradeSupport } from "@/lib/self-upgrade/support";
import { loadReleaseInstallContext } from "@/lib/self-upgrade/release-target";
import { createRun, getLatestRun, getLatestSucceededRun } from "@/lib/self-upgrade/run-store";
import {
  admitSelfUpgrade,
  resolveCurrentSelfUpgradeTarget,
} from "@/lib/self-upgrade/admission";
import { getCurrentImpactSummaryId } from "@/lib/self-upgrade/impact";
import { isUpgradeWindowOpen, nextUpgradeWindowOpen } from "@/lib/self-upgrade/window";
import { resolveAutoUpgradeWindow, nextAutoWindowOpen } from "@/lib/self-upgrade/auto-window";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import { getLastCheckedAt } from "@/lib/self-upgrade/last-check";
import { recordDeferredUpgradeRequest } from "@/lib/self-upgrade/deferred-request";
import { resolveReleaseBatchStatus } from "@/lib/self-upgrade/release-batch-status";
import { triggerSelfUpgrade } from "./promotions";
import { mockConfig, mockRun, mockSession } from "./promotions.self-upgrade.test-fixtures";

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

describe("triggerSelfUpgrade – operator outside the window (BI-2128872C)", () => {
  it("records no bypass when the operator runs inside the window", async () => {
    await triggerSelfUpgrade();

    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: `manual:${mockSession.user.id}`,
    }));
  });

  it("BI-2128872C AC-3: an urgent release deploys now outside the window via the emergency override", async () => {
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);

    const result = await triggerSelfUpgrade({ force: true });

    expect(result).toMatchObject({ queued: true, admitted: true });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: `manual:${mockSession.user.id}+outside-window`,
      requestedForce: true,
    }));
  });

});

// ─── triggerSelfUpgrade – agent browser sessions defer to the window ─────────

describe("triggerSelfUpgrade – automation persona (BI-2128872C)", () => {
  const automationSession = {
    user: { ...mockSession.user, id: "user-automation", email: "automation@dpf.local" },
  };

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(automationSession as never);
  });

  it("AC-1: queues an agent-driven click outside the window for the next window instead of running it", async () => {
    vi.mocked(isUpgradeWindowOpen).mockReturnValue(false);
    vi.mocked(nextUpgradeWindowOpen).mockReturnValue(new Date("2026-10-07T22:00:00.000Z"));

    const result = await triggerSelfUpgrade({ force: true });

    expect(result).toMatchObject({ queued: false, reason: "deferred-to-window" });
    expect((result as { runAt?: string | null }).runAt).toMatch(/^2026-10-07T22:00:00/);
    expect((result as { message?: string }).message).toContain("maintenance window");
    expect(admitSelfUpgrade).not.toHaveBeenCalled();
    expect(recordDeferredUpgradeRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestedBy: "manual:user-automation",
      runAt: expect.stringMatching(/^2026-10-07T22:00:00/),
    }));
  });

  it("runs an agent-driven click inside the window as a routine request", async () => {
    vi.mocked(resolveReleaseBatchStatus).mockResolvedValueOnce({ applicable: false, eligible: true } as never);

    const result = await triggerSelfUpgrade();

    expect(result).toMatchObject({ queued: true, admitted: true, runId: "SUR-QUEUED1" });
    expect(admitSelfUpgrade).toHaveBeenCalledWith(expect.objectContaining({
      triggeredBy: "manual:user-automation",
      routine: true,
      requestedForce: false,
    }));
  });
});
