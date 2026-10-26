// BI-0E216B0E: the swap step is the step its own promoter kills. The job engine
// retries it on the new portal, where boot reconciliation has already finalized
// the run (SUR-6D9543E6: reconciled succeeded, then the retry took a second
// backup, re-bound the handoff, hit the drain guard and failed the run).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  recordPromoterReadiness: vi.fn(),
  recordRunRecoveryPoint: vi.fn(),
  recordReassessmentCompatibility: vi.fn(),
  runReassessmentCandidatePreflight: vi.fn(async () => ({ ok: true, proof: {} })),
  loadInstallStateSigningContext: vi.fn(),
  refreshMigrationHandoffAfterDrain: vi.fn(),
  createSelfUpgradeRecoveryPoint: vi.fn(),
  recordCooldown: vi.fn(),
  clearCooldown: vi.fn(),
  emitUpgradeEvent: vi.fn(),
  failQuiescenceSwap: vi.fn(),
  signalSwapStarting: vi.fn(),
  signalSwapComplete: vi.fn(),
  guardAdmissionClosedForSwap: vi.fn(async (): Promise<ActionResult<{ reasserted: boolean }>> => ok({ reasserted: false })),
  runPromoter: vi.fn(),
  getDeployedSha: vi.fn(),
  readQuiescenceOutcome: vi.fn(),
  readDrainControl: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/run-store", () => ({
  getRun: mocks.getRun,
  completeRun: mocks.completeRun,
  failRun: mocks.failRun,
  recordPromoterReadiness: mocks.recordPromoterReadiness,
  recordRunRecoveryPoint: mocks.recordRunRecoveryPoint,
  recordReassessmentCompatibility: mocks.recordReassessmentCompatibility,
}));
vi.mock("@/lib/self-upgrade/preflight", () => ({
  loadInstallStateSigningContext: mocks.loadInstallStateSigningContext,
  refreshMigrationHandoffAfterDrain: mocks.refreshMigrationHandoffAfterDrain,
  resolveReadinessBackupHostPath: vi.fn(),
  runCandidatePreflight: vi.fn(),
  runReassessmentCandidatePreflight: mocks.runReassessmentCandidatePreflight,
}));
vi.mock("@/lib/self-upgrade/completion", () => ({ isFeatureBuildDeployed: vi.fn(), getDeployedSha: mocks.getDeployedSha }));
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

vi.mock("@/lib/self-upgrade/drain-wait", () => ({ readQuiescenceOutcome: mocks.readQuiescenceOutcome, readDrainControl: mocks.readDrainControl, QUIESCENCE_READY_EVENT: "ready" }));
import { runSelfUpgradeInSteps } from "./self-upgrade-steps";
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
    mocks.readDrainControl.mockResolvedValue({ status: "completed" });
    mocks.getDeployedSha.mockResolvedValue(null);
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
        mocks.runReassessmentCandidatePreflight,
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

  it("records success when the retry is already running the target and the row is still open (SUR-8F1389F9)", async () => {
    mocks.getRun.mockResolvedValue({ runId: ctx.runId, status: "running", currentSha: "oldsha" });
    mocks.getDeployedSha.mockResolvedValue(ctx.builtStamp.toUpperCase());
    mocks.completeRun.mockResolvedValue({ status: "succeeded" });
    const result = await finishSelfUpgrade(ctx);
    expect(result).toMatchObject({ ok: true, status: "succeeded", reason: "already-deployed" });
    expect(mocks.completeRun).toHaveBeenCalledWith(ctx.runId);
    expect(mocks.clearCooldown).toHaveBeenCalled();
    expect(mocks.signalSwapComplete).toHaveBeenCalledWith(ctx.quiescenceRunId);
    expect(mocks.emitUpgradeEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "upgrade.succeeded", runId: ctx.runId }));
    for (const fn of [
      mocks.loadInstallStateSigningContext,
      mocks.createSelfUpgradeRecoveryPoint,
      mocks.guardAdmissionClosedForSwap,
      mocks.runPromoter,
      mocks.failRun,
      mocks.recordCooldown,
      mocks.failQuiescenceSwap,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("does not resurrect an unrelated failed run merely because this portal is the target", async () => {
    mocks.getRun.mockResolvedValue({ runId: ctx.runId, status: "failed", currentSha: "oldsha" });
    mocks.getDeployedSha.mockResolvedValue(ctx.builtStamp);
    mocks.completeRun.mockResolvedValue({ status: "succeeded" });
    const result = await finishSelfUpgrade(ctx);
    expect(result).toMatchObject({ ok: false, status: "already-finalized", runStatus: "failed" });
    expect(mocks.completeRun).not.toHaveBeenCalled();
    expect(mocks.failRun).not.toHaveBeenCalled();
  });

  it("does not treat the pre-swap portal as already deployed", async () => {
    mocks.getRun.mockResolvedValue({ runId: ctx.runId, status: "running", currentSha: "oldsha" });
    mocks.getDeployedSha.mockResolvedValue("oldsha");
    await finishSelfUpgrade(ctx);
    expect(mocks.completeRun).not.toHaveBeenCalled();
    expect(mocks.loadInstallStateSigningContext).toHaveBeenCalled();
  });

  it("does not record a cooldown when the drain guard loses to a reconciliation that already succeeded", async () => {
    mocks.getRun.mockResolvedValue({ runId: ctx.runId, status: "running", currentSha: "oldsha" });
    mocks.getDeployedSha.mockResolvedValue("oldsha");
    mocks.loadInstallStateSigningContext.mockResolvedValue({ ok: true, runtimeTransitionSecret: "s", hostIdentity: {} });
    mocks.createSelfUpgradeRecoveryPoint.mockResolvedValue({ status: "ok" });
    mocks.refreshMigrationHandoffAfterDrain.mockResolvedValue({ ok: true, data: { refreshed: false } });
    mocks.guardAdmissionClosedForSwap.mockResolvedValue(err("the drain already ended (completed)"));
    mocks.failRun.mockResolvedValue({ status: "succeeded", runId: ctx.runId });
    const result = await finishSelfUpgrade(ctx);
    expect(result).toMatchObject({ ok: true, status: "already-finalized", runStatus: "succeeded" });
    expect(mocks.recordCooldown).not.toHaveBeenCalled();
    expect(mocks.failQuiescenceSwap).not.toHaveBeenCalled();
    expect(mocks.emitUpgradeEvent).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });
});



describe("durable swap replay after process replacement", () => {
  it("reuses persisted preparation and returns boot success when the original swap never acknowledged", async () => {
    vi.clearAllMocks();
    let row = { runId: ctx.runId, status: "running", currentSha: "old" };
    mocks.getRun.mockImplementation(async () => row);
    mocks.getDeployedSha.mockResolvedValue("old");
    mocks.loadInstallStateSigningContext.mockResolvedValue({ ok: true, runtimeTransitionSecret: "s", hostIdentity: {} });
    mocks.createSelfUpgradeRecoveryPoint.mockResolvedValue({ status: "ok" });
    mocks.refreshMigrationHandoffAfterDrain.mockResolvedValue({ ok: true, data: { refreshed: false } });
    mocks.guardAdmissionClosedForSwap.mockResolvedValue(ok({ reasserted: false }));
    mocks.readQuiescenceOutcome.mockResolvedValue({ ok: true, outcome: "ready-to-swap" });
    let entered!: () => void;
    const swapping = new Promise<void>((resolve) => { entered = resolve; });
    mocks.runPromoter.mockImplementation(() => { entered(); return new Promise(() => {}); });
    // Like the engine, persist only callback results. Portal replacement kills
    // the first callback while the promoter is running, so swap has no result.
    const saved = new Map<string, unknown>();
    const step = {
      run: async (id: string, work: () => Promise<unknown>) => {
        if (saved.has(id)) return saved.get(id);
        const output = await work(); saved.set(id, output); return output;
      }, waitForEvent: vi.fn(),
    } as unknown as Parameters<typeof runSelfUpgradeInSteps>[0];
    const phases = { begin: vi.fn(async () => ({ draining: ctx })), settle: vi.fn(async () => null), finish: finishSelfUpgrade };
    void runSelfUpgradeInSteps(step, { triggeredBy: "scheduled" }, phases);
    await swapping;
    expect(saved.has("self-upgrade-swap")).toBe(false);
    row = { ...row, status: "succeeded" }; // new portal's boot reconciliation
    mocks.getDeployedSha.mockResolvedValue(ctx.builtStamp);
    mocks.readQuiescenceOutcome.mockResolvedValue({ ok: true, outcome: "completed" });
    const result = await runSelfUpgradeInSteps(step, { triggeredBy: "scheduled" }, phases);
    expect(result).toMatchObject({ ok: true, status: "already-finalized", runStatus: "succeeded" });
    expect(phases.begin).toHaveBeenCalledOnce(); expect(phases.settle).toHaveBeenCalledOnce();
    expect(mocks.runPromoter).toHaveBeenCalledOnce(); expect(mocks.createSelfUpgradeRecoveryPoint).toHaveBeenCalledOnce();
    expect(mocks.runReassessmentCandidatePreflight).toHaveBeenCalledOnce();
    expect(mocks.refreshMigrationHandoffAfterDrain).toHaveBeenCalledOnce();
    for (const fn of [mocks.failRun, mocks.failQuiescenceSwap, mocks.recordCooldown, mocks.emitUpgradeEvent]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("terminal drain handshake retry", () => {
  it.each(["succeeded", "failed"])("retries an unsent %s handshake without replaying swap work", async (status) => {
    vi.clearAllMocks();
    mocks.getRun.mockResolvedValue({ status, failureLog: "original failure" });
    mocks.readDrainControl.mockResolvedValue({ status: "ready-to-swap" });
    const signal = status === "succeeded" ? mocks.signalSwapComplete : mocks.failQuiescenceSwap;
    signal.mockRejectedValueOnce(new Error("job transport unavailable")).mockResolvedValue(undefined);
    await expect(finishSelfUpgrade(ctx)).rejects.toThrow("job transport unavailable");
    await expect(finishSelfUpgrade(ctx)).resolves.toMatchObject({ status: "already-finalized", runStatus: status });
    expect(signal).toHaveBeenCalledTimes(2);
    for (const fn of [mocks.loadInstallStateSigningContext, mocks.createSelfUpgradeRecoveryPoint, mocks.runPromoter, mocks.failRun, mocks.completeRun, mocks.recordCooldown]) expect(fn).not.toHaveBeenCalled();
  });
});
