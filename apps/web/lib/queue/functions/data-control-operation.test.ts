import { describe, expect, it, vi } from "vitest";

import {
  DATA_CONTROL_OPERATION_RECOVERY_CRON,
  runDataControlOperationRecovery,
} from "./data-control-operation";

describe("data control operation recovery queue", () => {
  it("uses a staggered five-minute recovery cadence", () => {
    expect(DATA_CONTROL_OPERATION_RECOVERY_CRON).toBe("4,9,14,19,24,29,34,39,44,49,54,59 * * * *");
  });

  it("processes a bounded operation set and reports adapter-blocked targets", async () => {
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({ status: "reconciled", blockedTargets: [] })
      .mockResolvedValueOnce({ status: "executing", blockedTargets: ["archive"] });
    const result = await runDataControlOperationRecovery({
      workerId: "test-worker",
      limit: 10,
      listIds: vi.fn(async () => ["DCO-1", "DCO-2"]),
      reconcile,
    });

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      inspected: 2,
      reconciled: 1,
      partial: 0,
      compensated: 0,
      blockedTargets: 1,
    });
  });
});
