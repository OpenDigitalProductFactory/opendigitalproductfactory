import { describe, expect, it, vi } from "vitest";

import {
  assertLocalProviderCapacityAvailable,
  assertProviderDispatchCapacity,
  inspectLocalProviderCapacity,
  LocalProviderCapacityDeferredError,
  inspectShortCallLocalCapacity,
} from "./local-provider-capacity";

describe("local provider capacity reservation", () => {
  it("permits local dispatch when governed local CI is inactive", async () => {
    const listCapacityLeases = vi.fn().mockResolvedValue([
      { environmentKey: "dev-portal", status: "active" },
    ]);

    await expect(
      inspectLocalProviderCapacity({ listCapacityLeases }),
    ).resolves.toEqual({ available: true, reason: null });
  });

  it("defers every local dispatch while governed local CI owns the host", async () => {
    const listCapacityLeases = vi.fn().mockResolvedValue([
      { environmentKey: "local-integration-ci", status: "active" },
    ]);

    await expect(
      assertLocalProviderCapacityAvailable({ listCapacityLeases }),
    ).rejects.toMatchObject({
      name: "LocalProviderCapacityDeferredError",
      reason: "local-ci-active-capacity-reservation",
    });
  });

  it("reserves the next safe admission window for an established local-CI queue", async () => {
    const listCapacityLeases = vi.fn().mockResolvedValue([
      { environmentKey: "local-integration-ci", status: "queued" },
    ]);

    await expect(
      assertLocalProviderCapacityAvailable({ listCapacityLeases }),
    ).rejects.toMatchObject({
      name: "LocalProviderCapacityDeferredError",
      reason: "local-ci-queued-capacity-reservation",
    });
  });

  it("fails closed for local dispatch when the lease registry is unavailable", async () => {
    const listCapacityLeases = vi.fn().mockRejectedValue(new Error("registry unavailable"));

    const rejection = assertLocalProviderCapacityAvailable({ listCapacityLeases });

    await expect(rejection).rejects.toBeInstanceOf(LocalProviderCapacityDeferredError);
    await expect(rejection).rejects.toMatchObject({
      reason: "local-ci-capacity-reservation-unavailable",
    });
  });

  it("does not consult the host registry for a cloud provider", async () => {
    const listCapacityLeases = vi.fn().mockRejectedValue(new Error("registry unavailable"));

    await expect(
      assertProviderDispatchCapacity("openai", { listCapacityLeases }),
    ).resolves.toBeUndefined();
    expect(listCapacityLeases).not.toHaveBeenCalled();
  });

  it("applies the reservation to every local provider alias", async () => {
    const listCapacityLeases = vi.fn().mockResolvedValue([
      { environmentKey: "local-integration-ci", status: "active" },
    ]);

    await expect(
      assertProviderDispatchCapacity("ollama", { listCapacityLeases }),
    ).rejects.toMatchObject({ reason: "local-ci-active-capacity-reservation" });
  });
});

describe("short-call capacity policy (BI-0AA939DF / DI-405E6765ED90)", () => {
  const lease = (status: string) => ({ environmentKey: "local-integration-ci", status });
  const noSleep = async () => {};

  it("proceeds while a claim is only QUEUED — a queued gate has not taken the host", () => {
    // The resident-model policy fails closed on queued. That is what turned a
    // rarely-empty queue on a one-slot pool into a near-permanent outage for
    // every embedding consumer on the install.
    return expect(
      inspectShortCallLocalCapacity({ listCapacityLeases: async () => [lease("queued")], sleep: noSleep }),
    ).resolves.toEqual({ available: true, reason: null });
  });

  it("still defers on an ACTIVE lease once the wait is exhausted", async () => {
    const status = await inspectShortCallLocalCapacity({
      listCapacityLeases: async () => [lease("active")],
      waitMs: 500,
      sleep: noSleep,
    });

    expect(status).toEqual({
      available: false,
      reason: "local-ci-active-capacity-reservation",
    });
  });

  it("waits for an active lease to clear rather than failing on the first look", async () => {
    // The whole point of the bounded wait: an active lease often clears within
    // a poll or two, and waiting beats reporting the corpus as empty.
    let look = 0;
    const status = await inspectShortCallLocalCapacity({
      listCapacityLeases: async () => (++look < 3 ? [lease("active")] : []),
      waitMs: 5_000,
      sleep: noSleep,
    });

    expect(status.available).toBe(true);
    expect(look).toBeGreaterThan(1);
  });

  it("is bounded — it gives up rather than hanging on a lease that never clears", async () => {
    let look = 0;
    await inspectShortCallLocalCapacity({
      listCapacityLeases: async () => { look += 1; return [lease("active")]; },
      waitMs: 1_000,
      sleep: noSleep,
    });

    // 1000ms / 250ms poll = 4 waits, so 5 looks. An unbounded wait would trade
    // a wrong answer for a hung request, which is not an improvement.
    expect(look).toBeLessThanOrEqual(6);
  });

  it("fails closed when capacity ownership cannot be proven", async () => {
    const status = await inspectShortCallLocalCapacity({
      listCapacityLeases: async () => { throw new Error("db down"); },
      sleep: noSleep,
    });

    expect(status).toEqual({
      available: false,
      reason: "local-ci-capacity-reservation-unavailable",
    });
  });

  it("leaves the resident-model policy alone — it still defers on queued", async () => {
    // Regression guard for the carve-out: narrowing the short-call boundary
    // must not narrow the boundary the fail-closed rule was written for.
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [lease("queued")],
    });

    expect(status).toEqual({
      available: false,
      reason: "local-ci-queued-capacity-reservation",
    });
  });
});
