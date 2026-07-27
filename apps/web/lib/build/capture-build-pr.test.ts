import { describe, expect, it, vi } from "vitest";

import { captureBuildPrOntoCapsule } from "./capture-build-pr";

function mkDb(count = 1) {
  const findMany = vi.fn().mockResolvedValue(
    Array.from({ length: count }, (_, index) => ({
      id: `capsule-${index + 1}`,
      workspaceState: { retained: true },
    })),
  );
  const update = vi.fn().mockResolvedValue({});
  return { db: { workCapsule: { findMany, update } }, findMany, update };
}

describe("captureBuildPrOntoCapsule (delivery visibility — PR capture onto the WorkCapsule)", () => {
  it("stamps url + number onto the build's capsule(s), keyed by featureBuildId (the cuid)", async () => {
    const { db, update } = mkDb(1);
    const out = await captureBuildPrOntoCapsule({
      db,
      featureBuildId: "ckcuid123",
      prNumber: 2145,
      prUrl: "https://github.com/o/r/pull/2145",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "capsule-1" },
      data: expect.objectContaining({
        pullRequestUrl: "https://github.com/o/r/pull/2145",
        pullRequestNumber: 2145,
        workspaceState: expect.objectContaining({
          retained: true,
          buildStudio: expect.objectContaining({
            delivery: expect.objectContaining({
              schemaVersion: 1,
              status: "created",
              repository: "o/r",
              prNumber: 2145,
            }),
          }),
        }),
      }),
    });
    expect(out).toEqual({ captured: 1 });
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
