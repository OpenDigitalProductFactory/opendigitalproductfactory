import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANDED_SWAP_FALSE_FAILURE_REASON as diagnostic } from "./landed-swap-identity";
const state = vi.hoisted(() => ({ rows: [] as any[], update: vi.fn(), publish: vi.fn(), clear: vi.fn() }));
vi.mock("@dpf/db", () => ({ Prisma: { DbNull: null }, prisma: { selfUpgradeRun: { findMany: vi.fn(async () => state.rows), update: state.update } } }));
vi.mock("./run-store", () => ({ publishRunCompletion: state.publish }));
vi.mock("./cooldown", () => ({ clearCooldown: state.clear }));
import { healLandedSwapFalseFailures } from "./landed-swap";
const logger = { log: vi.fn(), error: vi.fn() };
const succeededAt = "2026-10-22T23:18:09.753Z";
function row() {
  return {
    runId: "SUR-90C34FAC", status: "failed", currentSha: "before", targetSha: "target", deployedSha: "target",
    dryRun: false, reason: diagnostic, failureLog: diagnostic,
    startedAt: new Date("2026-10-22T23:00:00Z"), completedAt: new Date("2026-10-22T23:22:54.002Z"),
    completionEvidence: { recoveryPoint: { retained: true } }, changeRequestId: "rfc-row",
    changeRequest: { id: "rfc-row", status: "closed", outcome: "succeeded",
      impactReport: { source: "self-upgrade", runId: "SUR-90C34FAC", fromSha: "before", toSha: "target" },
      postChangeVerification: { deployedSha: "target", completedAt: succeededAt } },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); state.rows = [row()];
  state.update.mockImplementation(async ({ where, data }) => {
    const current = state.rows.find((r) => r.runId === where.runId);
    if (!current || current.status !== where.status || current.reason !== where.reason || current.failureLog !== where.failureLog) throw Object.assign(new Error("changed"), { code: "P2025" });
    Object.assign(current, data); return current;
  });
});
describe("landed swap false-failure recovery", () => {
  it("recovers a prior release from its own immutable successful change record after a newer upgrade", async () => {
    expect(await healLandedSwapFalseFailures({ deployedSha: "newer-release", logger })).toBe(1);
    expect(state.rows[0]).toMatchObject({ status: "succeeded", completedAt: new Date(succeededAt), reason: null, failureLog: null,
      completionEvidence: { recoveryPoint: { retained: true }, landedSwapRecovery: { source: "change-record", previousFailure: { reason: diagnostic, failureLog: diagnostic } } } });
    expect(state.update.mock.calls[0][0].where.changeRequest.is).toMatchObject({ id: "rfc-row", status: "closed", outcome: "succeeded" });
    expect(state.publish).toHaveBeenCalledOnce();
    expect(await healLandedSwapFalseFailures({ deployedSha: "newer-release", logger })).toBe(0);
  });
  it("allows exact observed runtime identity when the successful change record is missing", async () => {
    state.rows[0].changeRequest = null; state.rows[0].changeRequestId = null;
    expect(await healLandedSwapFalseFailures({ deployedSha: "TARGET", logger })).toBe(1);
    expect(state.rows[0].completionEvidence.landedSwapRecovery.source).toBe("running-image");
  });
  it.each(["reason", "failureLog", "status", "dryRun"])("does not heal when %s no longer identifies this exact failure", async (field) => {
    state.rows[0][field] = field === "status" ? "cancelled" : field === "dryRun" ? true : "genuine failure";
    expect(await healLandedSwapFalseFailures({ deployedSha: "target", logger })).toBe(0);
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each(["runId", "fromSha", "toSha", "source"])("rejects a change record with mismatched %s", async (field) => {
    state.rows[0].changeRequest.impactReport[field] = "wrong";
    expect(await healLandedSwapFalseFailures({ deployedSha: "newer-release", logger })).toBe(0);
  });
  it.each(["deployedSha", "completedAt"])("rejects invalid successful verification %s", async (field) => {
    state.rows[0].changeRequest.postChangeVerification[field] = field === "completedAt" ? "2026-10-23T00:00:00Z" : "wrong";
    expect(await healLandedSwapFalseFailures({ deployedSha: "newer-release", logger })).toBe(0);
  });
  it("does not repair a different image without successful historical proof", async () => {
    state.rows[0].changeRequest = null;
    expect(await healLandedSwapFalseFailures({ deployedSha: "newer-release", logger })).toBe(0);
    expect(state.clear).not.toHaveBeenCalled();
  });
  it("preserves a newer genuine failure and its global cooldown while correcting history", async () => {
    state.rows.push({ ...row(), runId: "SUR-NEWER", reason: "health-check-failed", failureLog: "health-check-failed" });
    expect(await healLandedSwapFalseFailures({ deployedSha: "newer-release", logger })).toBe(1);
    expect(state.rows[1].status).toBe("failed");
    expect(state.clear).not.toHaveBeenCalled();
  });
  it("does not publish recovery or clear cooldown when the conditional update loses", async () => {
    state.update.mockRejectedValueOnce(Object.assign(new Error("changed"), { code: "P2025" }));
    expect(await healLandedSwapFalseFailures({ deployedSha: "target", logger })).toBe(0);
    expect(state.publish).not.toHaveBeenCalled(); expect(state.clear).not.toHaveBeenCalled();
  });
});
