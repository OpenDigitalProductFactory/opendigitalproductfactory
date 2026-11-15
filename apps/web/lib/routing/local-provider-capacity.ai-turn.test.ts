import { describe, expect, it, vi } from "vitest";
import { assertLocalProviderCapacityAvailable, LocalProviderCapacityDeferredError } from "./local-provider-capacity";

// BI-218A4555: a local AI dispatch deferred by an active gate holds a turn in
// the overseer queue; the next dispatch that finds the host free settles it.
// Bookkeeping never changes whether inference may run.

const book = () => ({ recordDemand: vi.fn(async () => undefined), settle: vi.fn(async () => undefined) });
const gate = { environmentKey: "local-integration-ci", status: "active", claimKey: "gate:abc", expiresAt: new Date(Date.now() + 60_000) };
const turn = { environmentKey: "local-integration-ci", status: "queued", claimKey: "inference-turn:local:NPEL-T" };

describe("local AI turn bookkeeping", () => {
  it("records demand when an active gate defers local AI work", async () => {
    const aiTurnBook = book();
    await expect(assertLocalProviderCapacityAvailable({ listCapacityLeases: async () => [gate], aiTurnBook }))
      .rejects.toBeInstanceOf(LocalProviderCapacityDeferredError);
    expect(aiTurnBook.recordDemand).toHaveBeenCalledOnce();
    expect(aiTurnBook.settle).not.toHaveBeenCalled();
  });

  it("settles a waiting turn when the host is free and the dispatch proceeds", async () => {
    const aiTurnBook = book();
    await expect(assertLocalProviderCapacityAvailable({ listCapacityLeases: async () => [turn], aiTurnBook })).resolves.toBeUndefined();
    expect(aiTurnBook.settle).toHaveBeenCalledOnce();
    expect(aiTurnBook.recordDemand).not.toHaveBeenCalled();
  });

  it("writes nothing when no turn waits and the host is free", async () => {
    const aiTurnBook = book();
    await assertLocalProviderCapacityAvailable({ listCapacityLeases: async () => [], aiTurnBook });
    expect(aiTurnBook.settle).not.toHaveBeenCalled();
    expect(aiTurnBook.recordDemand).not.toHaveBeenCalled();
  });

  it("does not record demand when capacity cannot be observed", async () => {
    const aiTurnBook = book();
    await expect(assertLocalProviderCapacityAvailable({
      listCapacityLeases: async () => { throw new Error("db down"); }, aiTurnBook,
    })).rejects.toMatchObject({ reason: "local-ci-capacity-reservation-unavailable" });
    expect(aiTurnBook.recordDemand).not.toHaveBeenCalled();
  });

  it("never lets a bookkeeping failure change the dispatch decision", async () => {
    const failing = { recordDemand: vi.fn(async () => { throw new Error("x"); }), settle: vi.fn(async () => { throw new Error("y"); }) };
    await expect(assertLocalProviderCapacityAvailable({ listCapacityLeases: async () => [turn], aiTurnBook: failing })).resolves.toBeUndefined();
    await expect(assertLocalProviderCapacityAvailable({ listCapacityLeases: async () => [gate], aiTurnBook: failing }))
      .rejects.toBeInstanceOf(LocalProviderCapacityDeferredError);
  });
});
