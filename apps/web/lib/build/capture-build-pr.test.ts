import { describe, expect, it, vi } from "vitest";

import { createBuildPrDeliveryState } from "./build-pr-delivery-state";
import { captureBuildPrOntoCapsule, persistBuildPrDeliveryStateForBuild } from "./capture-build-pr";

function mkDb(count = 1) {
  const findMany = vi.fn().mockResolvedValue(
    Array.from({ length: count }, (_, index) => ({
      id: `capsule-${index + 1}`,
      workspaceState: { retained: true },
      updatedAt: new Date("2026-07-27T00:00:00Z"),
    })),
  );
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return { db: { workroom: { findMany, updateMany } }, findMany, updateMany };
}

describe("captureBuildPrOntoCapsule (delivery visibility — PR capture onto the Workroom)", () => {
  it("stamps url + number onto the build's capsule(s), keyed by featureBuildId (the cuid)", async () => {
    const { db, updateMany } = mkDb(1);
    const out = await captureBuildPrOntoCapsule({
      db,
      featureBuildId: "ckcuid123",
      prNumber: 2145,
      prUrl: "https://github.com/o/r/pull/2145",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "capsule-1", updatedAt: new Date("2026-07-27T00:00:00Z") },
      data: expect.objectContaining({
        pullRequestUrl: "https://github.com/o/r/pull/2145",
        pullRequestNumber: 2145,
        workspaceState: expect.objectContaining({
          retained: true,
          // BI-88341B5D: one room-generic PR delivery record for every room.
          prDelivery: expect.objectContaining({
            schemaVersion: 1,
            status: "created",
            repository: "o/r",
            prNumber: 2145,
          }),
        }),
      }),
    });
    expect(out).toEqual({ captured: 1 });
  });

  // BI-ECA50241: a Build Studio PR is an API-minted commit, never the sandbox
  // commit the gauntlet stamped on the room; the poller skips a room whose head
  // differs from its PR, so the capture binds the room to the published head.
  it("binds the room's head to the commit the PR was published at", async () => {
    const { db, updateMany } = mkDb(1);
    await captureBuildPrOntoCapsule({
      db, featureBuildId: "ckcuid123", prNumber: 7, prUrl: "https://github.com/o/r/pull/7", headSha: "f".repeat(40),
    });
    expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({ headSha: "f".repeat(40) });
  });

  it("prefers the observed PR head over the published one, and never erases a head it does not know", async () => {
    const observed = { ...createBuildPrDeliveryState({ repository: "o/r", prNumber: 7, prUrl: "u" }), lastObservedHeadSha: "e".repeat(40) };
    const a = mkDb(1);
    await persistBuildPrDeliveryStateForBuild({ db: a.db, featureBuildId: "c", delivery: observed, publishedHeadSha: "f".repeat(40) });
    expect(a.updateMany.mock.calls[0]?.[0]?.data.headSha).toBe("e".repeat(40));
    const b = mkDb(1);
    await persistBuildPrDeliveryStateForBuild({ db: b.db, featureBuildId: "c", delivery: createBuildPrDeliveryState({ repository: "o/r", prNumber: 7, prUrl: "u" }) });
    expect(b.updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty("headSha");
  });

  it("reports captured 0 (not an error) when the build has no capsule yet", async () => {
    const { db } = mkDb(0);
    const out = await captureBuildPrOntoCapsule({ db, featureBuildId: "c", prNumber: 5, prUrl: "u" });
    expect(out).toEqual({ captured: 0 });
  });

  it("is a no-op (no DB write) when featureBuildId is blank", async () => {
    const { db, findMany } = mkDb();
    const out = await captureBuildPrOntoCapsule({ db, featureBuildId: "", prNumber: 5, prUrl: "u" });
    expect(findMany).not.toHaveBeenCalled();
    expect(out).toEqual({ captured: 0 });
  });

  it("is a no-op when prUrl is empty", async () => {
    const { db, findMany } = mkDb();
    const out = await captureBuildPrOntoCapsule({ db, featureBuildId: "c", prNumber: 5, prUrl: "" });
    expect(findMany).not.toHaveBeenCalled();
    expect(out).toEqual({ captured: 0 });
  });

  it("is a no-op when prNumber is not a positive finite number", async () => {
    const { db, findMany } = mkDb();
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = await captureBuildPrOntoCapsule({ db, featureBuildId: "c", prNumber: bad, prUrl: "u" });
      expect(out).toEqual({ captured: 0 });
    }
    expect(findMany).not.toHaveBeenCalled();
  });
});
