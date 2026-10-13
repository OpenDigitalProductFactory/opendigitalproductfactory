import { describe, expect, it, vi } from "vitest";
import { reconcileAcceptanceUpgradeWakeup } from "./acceptance-upgrade-wakeup";

const sha = "a".repeat(40);
const run = { id: "upgrade-row", runId: "SUR-FIRST", status: "succeeded", dryRun: false,
  deployedSha: sha, completedAt: new Date("2026-10-12T18:00:00Z") };
function ports() {
  return {
    readServedIdentity: vi.fn().mockResolvedValue(sha),
    readLatestUpgrade: vi.fn().mockResolvedValue(run),
    taskEnabled: vi.fn().mockResolvedValue(true),
    wake: vi.fn().mockResolvedValue(undefined),
  };
}
describe("acceptance upgrade wakeup reconciliation", () => {
  it("recovers a missed event using the persisted successful upgrade and actual served identity", async () => {
    const p = ports();
    await expect(reconcileAcceptanceUpgradeWakeup(p)).resolves.toEqual({ outcome: "reconciled", runId: run.runId });
    expect(p.wake).toHaveBeenCalledWith({ runId: run.runId, rowId: run.id, completedAt: run.completedAt.toISOString() });
  });
  it.each([
    { status: "failed" }, { dryRun: true }, { deployedSha: "b".repeat(40) }, { completedAt: null },
  ])("does not admit an unproven upgrade %j", async change => {
    const p = ports();
    p.readLatestUpgrade.mockResolvedValue({ ...run, ...change });
    await expect(reconcileAcceptanceUpgradeWakeup(p)).resolves.toEqual({ outcome: "unproven" });
    expect(p.wake).toHaveBeenCalledWith(null);
  });
  it("does not re-enable disabled tasks", async () => {
    const p = ports(); p.taskEnabled.mockResolvedValue(false);
    await expect(reconcileAcceptanceUpgradeWakeup(p)).resolves.toEqual({ outcome: "disabled-or-missing" });
    expect(p.wake).not.toHaveBeenCalled();
  });
  it("keeps an unavailable served identity unproven", async () => {
    const p = ports(); p.readServedIdentity.mockResolvedValue(null);
    await expect(reconcileAcceptanceUpgradeWakeup(p)).resolves.toEqual({ outcome: "unproven" });
    expect(p.wake).toHaveBeenCalledWith(null);
  });
});
