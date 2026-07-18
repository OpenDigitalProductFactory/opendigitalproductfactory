import { describe, expect, it, vi } from "vitest";
import { drainPostmarkCallbackBatch, PostmarkCallbackDispatchRetryableError } from "./marketing-scheduler-dispatch";

describe("Postmark callback batch", () => {
  it("attempts every receipt then throws a typed retryable error when any drain fails", async () => {
    const drain = vi.fn(async (receipt: { deliveryKey: string }) => ({
      claimedOrCompleted: receipt.deliveryKey !== "failed",
      retryableFailure: receipt.deliveryKey === "failed",
    }));
    await expect(drainPostmarkCallbackBatch([
      { deliveryKey: "failed", domainEntityId: "in-1" },
      { deliveryKey: "healthy", domainEntityId: "in-2" },
    ], drain)).rejects.toBeInstanceOf(PostmarkCallbackDispatchRetryableError);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("returns the attempted count when all drains complete", async () => {
    const drain = vi.fn(async () => ({ claimedOrCompleted: true, retryableFailure: false }));
    await expect(drainPostmarkCallbackBatch([
      { deliveryKey: "one", domainEntityId: "in-1" },
      { deliveryKey: "two", domainEntityId: null },
    ], drain)).resolves.toEqual({ attempted: 1 });
  });
});
