// BI-0E216B0E: the swap step is the step its own promoter kills. The job engine
// retries it on the new portal, where boot reconciliation has already finalized
// the run (SUR-6D9543E6: reconciled succeeded, then the retry took a second
// backup, re-bound the handoff, hit the drain guard and failed the run).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/shared/action-result";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  recordPromoterReadiness: vi.fn(),
  recordRunRecoveryPoint: vi.fn(),
  loadInstallStateSigningContext: vi.fn(),
  refreshMigrationHandoffAfterDrain: vi.fn(),
  createSelfUpgradeRecoveryPoint: vi.fn(),
  recordCooldown: vi.fn(),
  clearCooldown: vi.fn(),
  emitUpgradeEvent: vi.fn(),
  failQuiescenceSwap: vi.fn(),
  signalSwapStarting: vi.fn(),
  signalSwapComplete: vi.fn(),
  guardAdmissionClosedForSwap: vi.fn(async () => ok({ reasserted: false })),
  runPromoter: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  getRun: mocks.getRun,
  completeRun: mocks.completeRun,
  failRun: mocks.failRun,
  recordPromoterReadiness: mocks.recordPromoterReadiness,
  recordRunRecoveryPoint: mocks.recordRunRecoveryPoint,
}));
vi.mock("@/lib/self-upgrade/preflight", () => ({
  loadInstallStateSigningContext: mocks.loadInstallStateSigningContext,
  refreshMigrationHandoffAfterDrain: mocks.refreshMigrationHandoffAfterDrain,
  resolveReadinessBackupHostPath: vi.fn(),
  runCandidatePreflight: vi.fn(),
}));
vi.mock("@/lib/self-upgrade/completion", () => ({ isFeatureBuildDeployed: vi.fn() }));
vi.mock("@/lib/self-upgrade/build-failure-classifier", () => ({ classifyBuildFailure: vi.fn(), formatClassifiedExcerpt: vi.fn() }));
vi.mock("@/lib/self-upgrade/cooldown", () => ({ recordCooldown: mocks.recordCooldown, clearCooldown: mocks.clearCooldown }));
vi.mock("@/lib/self-upgrade/notifications", () => ({ emitUpgradeEvent: mocks.emitUpgradeEvent }));
vi.mock("@/lib/self-upgrade/recovery-point", () => ({
  createSelfUpgradeRecoveryPoint: mocks.createSelfUpgradeRecoveryPoint,
  summarizeRecoveryPointDegradation: vi.fn(),
  summarizeRecoveryPointFailure: vi.fn(),
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  failQuiescenceSwap: mocks.failQuiescenceSwap,
  signalSwapStarting: mocks.signalSwapStarting,
  signalSwapComplete: mocks.signalSwapComplete,
}));
vi.mock("@/lib/self-upgrade/drain-admission", () => ({ guardAdmissionClosedForSwap: mocks.guardAdmissionClosedForSwap }));
vi.mock("@/lib/self-upgrade/promoter", () => ({ runPromoter: mocks.runPromoter }));

import { finishSelfUpgrade, type SelfUpgradeSwapContext } from "./self-upgrade-swap";

const ctx = {
  runId: "SUR-6D9543E6",
  quiescenceRunId: "QR-2026-10-14-9mj88tu2",
  cooldownMinutes: 60,
  builtStamp: "d317cb499fab936aa2a2fafc392bea0cc6f052be",
  promoter: { hostInstallPath: "/host/dpf", canonicalInstallPath: "/host/dpf", healthUrl: "http://portal/api/health" },
  preflight: {},
} as unknown as SelfUpgradeSwapContext;

describe("finishSelfUpgrade on a retried step (BI-0E216B0E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadInstallStateSigningContext.mockResolvedValue({ ok: false, reason: "stop-here" });
  });

  it.each(["succeeded", "failed", "cancelled", "skipped"])(
    "leaves a %s run alone: no backup, no re-bind, no swap, no failure record, no cooldown",
    async (status) => {
      mocks.getRun.mockResolvedValue({ runId: ctx.runId, status });
      const result = await finishSelfUpgrade(ctx);
      expect(result).toMatchObject({ status: "already-finalized", runId: ctx.runId, runStatus: status, ok: status === "succeeded" });
      for (const fn of [
        mocks.loadInstallStateSigningContext,
        mocks.createSelfUpgradeRecoveryPoint,
        mocks.refreshMigrationHandoffAfterDrain,
        mocks.guardAdmissionClosedForSwap,
        mocks.runPromoter,
        mocks.failRun,
        mocks.completeRun,
        mocks.failQuiescenceSwap,
        mocks.recordCooldown,
        mocks.emitUpgradeEvent,
      ]) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );

  it("still runs the swap for a run that is in flight", async () => {
    mocks.getRun.mockResolvedValue({ runId: ctx.runId, status: "running" });
    await finishSelfUpgrade(ctx);
    expect(mocks.loadInstallStateSigningContext).toHaveBeenCalled();
  });
});
