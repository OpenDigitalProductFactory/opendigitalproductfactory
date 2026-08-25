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

describe("a contributor preview must not reserve inference capacity", () => {
  it("ignores a queued dev-portal preview claim", async () => {
    // BI-D933A328: a preview client retrying a refused claim enqueues a new row
    // every ~31s, so this queue is never empty. Deferring on it made the
    // platform's own AI permanently unavailable.
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [
        {
          environmentKey: "local-integration-ci",
          status: "queued",
          claimKey: "dev-portal:dev-portal-39151:feat/some-branch",
        },
      ],
    });
    expect(status.available).toBe(true);
  });

  it("ignores an active dev-portal preview claim", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [
        {
          environmentKey: "local-integration-ci",
          status: "active",
          claimKey: "dev-portal:dev-portal-1:feat/x",
        },
      ],
    });
    expect(status.available).toBe(true);
  });

  it("still defers for a real CI gate, which does contend for the host", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [
        {
          environmentKey: "local-integration-ci",
          status: "active",
          claimKey: "local-ci:session-1:abc123",
        },
      ],
    });
    expect(status.available).toBe(false);
    expect(status.reason).toBe("local-ci-active-capacity-reservation");
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
      expectedFreeAt: null,
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
      expectedFreeAt: null,
    });
  });
});

// BI-94D44FDB. Measured over seven days on the live install: ~300 real gate
// runs holding the host ~195s each. Short enough to wait out, far too long to
// leave the owner staring at an unexplained failure — so the deferral carries
// the blocking claim's own expiry.
describe("a deferral reports when the host is due free", () => {
  const at = (iso: string) => new Date(iso);
  const ciLease = (status: string, expiresAt: Date | null) => ({
    environmentKey: "local-integration-ci",
    status,
    expiresAt,
  });

  it("carries the active claim's expiry on the resident path", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [ciLease("active", at("2026-08-23T20:17:00.000Z"))],
    });

    expect(status).toEqual({
      available: false,
      reason: "local-ci-active-capacity-reservation",
      expectedFreeAt: at("2026-08-23T20:17:00.000Z"),
    });
  });

  it("reports the SOONEST expiry when more than one claim is blocking", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [
        ciLease("active", at("2026-08-23T20:19:00.000Z")),
        ciLease("active", at("2026-08-23T20:16:00.000Z")),
      ],
    });

    expect(status.available).toBe(false);
    expect(status.expectedFreeAt).toEqual(at("2026-08-23T20:16:00.000Z"));
  });

  it("carries the queued claim's expiry too", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [ciLease("queued", at("2026-08-23T20:16:50.000Z"))],
    });

    expect(status.reason).toBe("local-ci-queued-capacity-reservation");
    expect(status.expectedFreeAt).toEqual(at("2026-08-23T20:16:50.000Z"));
  });

  it("reports no window rather than a wrong one when the claim has no expiry", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [ciLease("active", null)],
    });

    expect(status.expectedFreeAt).toBeNull();
  });

  it("has no window to report when capacity ownership could not be read at all", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => { throw new Error("db down"); },
    });

    expect(status).toEqual({
      available: false,
      reason: "local-ci-capacity-reservation-unavailable",
    });
  });

  it("puts the window on the thrown error, where the reply can reach it", async () => {
    await expect(
      assertLocalProviderCapacityAvailable({
        listCapacityLeases: async () => [ciLease("active", at("2026-08-23T20:17:00.000Z"))],
      }),
    ).rejects.toMatchObject({
      name: "LocalProviderCapacityDeferredError",
      reason: "local-ci-active-capacity-reservation",
      expectedFreeAt: at("2026-08-23T20:17:00.000Z"),
    });
  });

  // A dev-portal preview binds a port and runs no inference, so it must not
  // reserve the GPU and must not contribute a window either (BI-D933A328).
  // 998 of 1,006 expired claims over the measured week were dev-portal.
  it("ignores a preview claim entirely, window included", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [{
        environmentKey: "local-integration-ci",
        status: "active",
        claimKey: "dev-portal:abc",
        // Relative: the value is irrelevant here (the claim is ignored outright),
        // and a fixed future date would become a clock bomb.
        expiresAt: new Date(Date.now() + 3 * 60_000),
      }],
    });

    expect(status).toEqual({ available: true, reason: null });
  });
});
