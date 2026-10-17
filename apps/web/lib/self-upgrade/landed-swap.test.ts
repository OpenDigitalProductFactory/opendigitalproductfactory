import { beforeEach, describe, expect, it, vi } from "vitest";
import { healLandedSwapFalseFailures, LANDED_SWAP_FALSE_FAILURE_REASON } from "./landed-swap";

const clearCooldown = vi.fn();
vi.mock("@/lib/self-upgrade/cooldown", () => ({
  clearCooldown: (...args: unknown[]) => clearCooldown(...args),
}));

const row = {
  runId: "SUR-8F1389F9",
  currentSha: "old-sha",
  deployedSha: "target-sha",
  targetSha: "target-sha",
};

describe("healLandedSwapFalseFailures", () => {
  beforeEach(() => {
    clearCooldown.mockReset().mockResolvedValue(undefined);
  });

  it("completes a failed row whose target is the running image and clears cooldown", async () => {
    const completeRun = vi.fn().mockResolvedValue({ status: "succeeded" });
    const findFailedRuns = vi.fn().mockResolvedValue([row]);
    const healed = await healLandedSwapFalseFailures({
      deployedSha: "target-sha",
      completeRun,
      logger: { log: vi.fn(), error: vi.fn() },
      findFailedRuns,
    });
    expect(healed).toBe(1);
    expect(findFailedRuns).toHaveBeenCalledWith(LANDED_SWAP_FALSE_FAILURE_REASON);
    expect(completeRun).toHaveBeenCalledWith("SUR-8F1389F9");
    expect(clearCooldown).toHaveBeenCalledOnce();
  });

  it("leaves a row alone when this portal is not the target", async () => {
    const completeRun = vi.fn();
    const healed = await healLandedSwapFalseFailures({
      deployedSha: "other-sha",
      completeRun,
      logger: { log: vi.fn(), error: vi.fn() },
      findFailedRuns: async () => [row],
    });
    expect(healed).toBe(0);
    expect(completeRun).not.toHaveBeenCalled();
    expect(clearCooldown).not.toHaveBeenCalled();
  });

  it("still counts the heal when clearing cooldown throws", async () => {
    clearCooldown.mockRejectedValueOnce(new Error("config down"));
    const logger = { log: vi.fn(), error: vi.fn() };
    const healed = await healLandedSwapFalseFailures({
      deployedSha: "TARGET-SHA",
      completeRun: vi.fn().mockResolvedValue({}),
      logger,
      findFailedRuns: async () => [row],
    });
    expect(healed).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it("treats a missing query result as no rows", async () => {
    const healed = await healLandedSwapFalseFailures({
      deployedSha: "target-sha",
      completeRun: vi.fn(),
      logger: { log: vi.fn(), error: vi.fn() },
      findFailedRuns: async () => undefined,
    });
    expect(healed).toBe(0);
    expect(clearCooldown).not.toHaveBeenCalled();
  });
});
