import { describe, expect, it, vi } from "vitest";

import { reconcileFirstBootProvider } from "./first-boot-provider-reconciliation";

describe("reconcileFirstBootProvider", () => {
  it("retries calibration after an interrupted boot left seed profiles behind", async () => {
    const discoverAndProfile = vi.fn();
    const queueUncalibratedEvals = vi.fn().mockResolvedValue(1);

    const result = await reconcileFirstBootProvider({
      countProfiles: async () => 1,
      discoverAndProfile,
      queueUncalibratedEvals,
    });

    expect(discoverAndProfile).not.toHaveBeenCalled();
    expect(queueUncalibratedEvals).toHaveBeenCalledOnce();
    expect(result.queued).toBe(1);
  });

  it("discovers an empty provider before queueing calibration", async () => {
    const order: string[] = [];
    await reconcileFirstBootProvider({
      countProfiles: async () => 0,
      discoverAndProfile: async () => {
        order.push("discover");
        return { discovered: 1, profiled: 1 };
      },
      queueUncalibratedEvals: async () => {
        order.push("queue");
        return 1;
      },
    });
    expect(order).toEqual(["discover", "queue"]);
  });
});
