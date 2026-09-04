import { describe, expect, it, vi } from "vitest";

import {
  assertLocalProviderCapacityAvailable,
  assertProviderDispatchCapacity,
  inspectLocalProviderCapacity,
  LocalProviderCapacityDeferredError,
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

describe("the resident-model policy is untouched by the embedding exemption (BI-0AA939DF)", () => {
  const lease = (status: string) => ({ environmentKey: "local-integration-ci", status });

  it("still defers on an ACTIVE lease", async () => {
    // Exempting the short-call boundary must not narrow the boundary the
    // fail-closed rule was actually written for: starting a resident model.
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [lease("active")],
    });
    expect(status).toMatchObject({ available: false, reason: "local-ci-active-capacity-reservation" });
  });

  it("still defers on a QUEUED claim", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => [lease("queued")],
    });
    expect(status).toMatchObject({ available: false, reason: "local-ci-queued-capacity-reservation" });
  });

  it("still fails closed when capacity ownership cannot be proven", async () => {
    const status = await inspectLocalProviderCapacity({
      listCapacityLeases: async () => { throw new Error("db down"); },
    });
    expect(status).toMatchObject({ available: false, reason: "local-ci-capacity-reservation-unavailable" });
  });
});
