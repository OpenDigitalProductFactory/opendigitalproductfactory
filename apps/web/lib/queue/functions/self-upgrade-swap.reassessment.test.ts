import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfUpgradeSwapContext } from "./self-upgrade-swap";
const mocks = vi.hoisted(() => ({ compatibility: vi.fn(), runPromoter: vi.fn(), failRun: vi.fn(), failSwap: vi.fn(), guard: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/self-upgrade/preflight", () => ({
  loadInstallStateSigningContext: vi.fn(async () => ({ ok: true })),
  refreshMigrationHandoffAfterDrain: vi.fn(async () => ({ ok: true, data: { refreshed: false } })),
  resolveReadinessBackupHostPath: vi.fn(), runCandidatePreflight: vi.fn(() => { throw new Error("unchanged install-state must not trigger readiness"); }),
  runReassessmentCandidatePreflight: mocks.compatibility,
}));
vi.mock("@/lib/self-upgrade/promoter", () => ({ runPromoter: mocks.runPromoter }));
vi.mock("@/lib/self-upgrade/run-store", () => ({ getRun: vi.fn(async () => ({ runId: "SUR-COMPAT", status: "running", currentSha: "b".repeat(40) })), completeRun: vi.fn(), failRun: mocks.failRun, recordPromoterReadiness: vi.fn(), recordRunRecoveryPoint: vi.fn(), recordReassessmentCompatibility: mocks.record }));
vi.mock("@/lib/self-upgrade/completion", () => ({ getDeployedSha: vi.fn(async () => null), isFeatureBuildDeployed: vi.fn() }));
vi.mock("@/lib/self-upgrade/cooldown", () => ({ clearCooldown: vi.fn(), recordCooldown: vi.fn() }));
vi.mock("@/lib/self-upgrade/notifications", () => ({ emitUpgradeEvent: vi.fn() }));
vi.mock("@/lib/self-upgrade/recovery-point", () => ({ createSelfUpgradeRecoveryPoint: vi.fn(async () => ({ status: "ok" })), summarizeRecoveryPointDegradation: vi.fn(), summarizeRecoveryPointFailure: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ failQuiescenceSwap: mocks.failSwap, signalSwapComplete: vi.fn(), signalSwapStarting: vi.fn() }));
vi.mock("@/lib/self-upgrade/drain-admission", () => ({ guardAdmissionClosedForSwap: mocks.guard }));
import { finishSelfUpgrade } from "./self-upgrade-swap";

const context = (quiescenceRunId: string | null, force = false): SelfUpgradeSwapContext => ({
  runId: "SUR-COMPAT", quiescenceRunId, force, cooldownMinutes: 30, builtStamp: "a".repeat(40),
  promoter: { hostInstallPath: "/host", canonicalInstallPath: "/host", composeProject: "actual-project", healthUrl: "http://health" },
  preflight: { runId: "SUR-COMPAT", targetSha: "a".repeat(40), sourcePath: "/source", hostInstallPath: "/host", canonicalInstallPath: "/host", composeFiles: [], healthUrl: "http://health" },
});
beforeEach(() => { vi.clearAllMocks(); mocks.compatibility.mockReset().mockResolvedValue({ ok: true, proof: {} }); mocks.runPromoter.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }); mocks.guard.mockResolvedValue({ ok: true }); });

describe("unconditional final reassessment compatibility", () => {
  it.each([["QR-1", false], ["QR-1", true], [null, false], [null, true]] as const)("refuses incompatible bytes with quiescence=%s force=%s and unchanged handoff/no migration", async (qr, force) => {
    mocks.compatibility.mockResolvedValueOnce({ ok: false, reason: "reassessment-compatibility-unproven" });
    expect(await finishSelfUpgrade(context(qr, force))).toMatchObject({ ok: false, reason: "reassessment-compatibility-unproven" });
    expect(mocks.compatibility).toHaveBeenCalledWith(expect.objectContaining({ stage: "swap", targetSha: "a".repeat(40), composeProject: "actual-project", recordCompatibility: mocks.record }));
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    if (qr) expect(mocks.failSwap).toHaveBeenCalledWith(qr, "reassessment-compatibility-unproven");
  });
  it("probes the compatible candidate again immediately before launching the swap", async () => {
    expect(await finishSelfUpgrade(context("QR-1", true))).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.compatibility).toHaveBeenCalledOnce();
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.compatibility.mock.invocationCallOrder[0]!);
    expect(mocks.compatibility.mock.invocationCallOrder[0]).toBeLessThan(mocks.runPromoter.mock.invocationCallOrder[0]!);
  });
});
