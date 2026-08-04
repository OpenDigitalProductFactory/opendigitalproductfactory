import { describe, expect, it, vi } from "vitest";
import { captureComplianceScope } from "./capture-compliance-scope";

function fakeDb(existing: { id: string; dataHandling: string[]; employsIn: string[] } | null) {
  const update = vi.fn().mockResolvedValue({});
  const db = {
    businessContext: {
      findFirst: vi.fn().mockResolvedValue(existing),
      update,
    },
  } as unknown as Parameters<typeof captureComplianceScope>[1];
  return { db, update };
}

describe("captureComplianceScope", () => {
  it("union-merges new predicates with existing (never clobbers)", async () => {
    const { db, update } = fakeDb({ id: "bc1", dataHandling: ["processes-personal-data"], employsIn: ["us"] });
    const r = await captureComplianceScope({ dataHandling: ["sends-marketing"] }, db);
    expect(r.ok).toBe(true);
    expect(r.dataHandling.sort()).toEqual(["processes-personal-data", "sends-marketing"]);
    expect(r.employsIn).toEqual(["us"]); // untouched
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ complianceScopeCapturedAt: expect.any(Date) }),
      }),
    );
  });

  it("captures employsIn to drive HR/employment scope", async () => {
    const { db } = fakeDb({ id: "bc1", dataHandling: [], employsIn: [] });
    const r = await captureComplianceScope({ employsIn: ["us"] }, db);
    expect(r.ok).toBe(true);
    expect(r.employsIn).toEqual(["us"]);
  });

  it("drops values outside the closed predicate/jurisdiction sets", async () => {
    const { db } = fakeDb({ id: "bc1", dataHandling: [], employsIn: [] });
    const r = await captureComplianceScope(
      { dataHandling: ["processes-personal-data", "not-a-predicate"], employsIn: ["us", "mars"] },
      db,
    );
    expect(r.dataHandling).toEqual(["processes-personal-data"]);
    expect(r.employsIn).toEqual(["us"]);
  });

  it("is a no-op error when nothing valid is provided", async () => {
    const { db, update } = fakeDb({ id: "bc1", dataHandling: [], employsIn: [] });
    const r = await captureComplianceScope({ dataHandling: ["nope"] }, db);
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("fails cleanly when no business context exists yet", async () => {
    const { db } = fakeDb(null);
    const r = await captureComplianceScope({ dataHandling: ["processes-personal-data"] }, db);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/company setup/i);
  });
});
