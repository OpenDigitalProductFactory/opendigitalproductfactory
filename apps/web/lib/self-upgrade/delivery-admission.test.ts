import { beforeEach, describe, expect, it, vi } from "vitest";

const claimAdmittedRunForWorker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/self-upgrade/run-store", () => ({ claimAdmittedRunForWorker }));

import { rejectDuplicateSelfUpgradeDelivery } from "./delivery-admission";

describe("self-upgrade event admission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an auditable skip for a duplicate delivery", async () => {
    claimAdmittedRunForWorker.mockResolvedValue("duplicate");
    await expect(rejectDuplicateSelfUpgradeDelivery("SUR-ONE")).resolves.toEqual({
      skipped: true,
      reason: "duplicate-delivery",
      runId: "SUR-ONE",
    });
  });

  it.each(["claimed", "legacy"])("continues the %s worker path", async (claim) => {
    claimAdmittedRunForWorker.mockResolvedValue(claim);
    await expect(rejectDuplicateSelfUpgradeDelivery("SUR-ONE")).resolves.toBeNull();
  });
});
