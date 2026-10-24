import { describe, expect, it, vi } from "vitest";
import { prepareCurrentArtifactObservation } from "./current-artifact-observation";

function fixture() {
  const binding = { kind: "bound" as const, itemRowId: "child-row", room: { capsuleId: "WC-CHILD" }, version: "original" };
  const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
  const load = vi.fn().mockImplementation(async () => binding);
  const read = vi.fn().mockResolvedValue("verified");
  const prepare = () => prepareCurrentArtifactObservation({ db, load, read,
    unbound: () => "not-applicable", unavailable: "unavailable", isUnavailable: value => value === "unavailable" });
  return { binding, db, load, read, prepare };
}

describe("current artifact observation admission", () => {
  it("reads once outside locks and rechecks after item and room locks", async () => {
    const f = fixture(); const prepared = await f.prepare();
    expect(prepared.evidence).toBe("verified");
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(await prepared.admissionGuard(f.db)).toBe("verified");
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.load).toHaveBeenCalledTimes(3);
    expect(f.db.$queryRaw.mock.calls.map(call => call[0].join("?")))
      .toEqual([expect.stringContaining("FOR UPDATE"), expect.stringContaining("FOR SHARE")]);
    expect(f.db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(f.load.mock.invocationCallOrder[2]!);
  });
  it("captures a fingerprint before provider awaits even for an in-process mutable binding", async () => {
    const f = fixture(); f.read.mockImplementation(async () => { f.binding.version = "changed"; return "verified"; });
    expect((await f.prepare()).evidence).toBe("unavailable");
  });
  it("rejects changes made while waiting for admission locks", async () => {
    const f = fixture(); const prepared = await f.prepare();
    f.db.$queryRaw.mockImplementation(async () => { f.binding.version = "changed"; return []; });
    expect(await prepared.admissionGuard(f.db)).toBe("unavailable");
  });
  it.each(["initial-load", "provider-read", "post-read-load", "lock", "admission-load"])(
    "keeps %s errors unavailable", async phase => {
      const f = fixture(); const failure = new Error("source unavailable");
      if (phase === "initial-load") f.load.mockRejectedValueOnce(failure);
      if (phase === "provider-read") f.read.mockRejectedValueOnce(failure);
      if (phase === "post-read-load") f.load.mockResolvedValueOnce(f.binding).mockRejectedValueOnce(failure);
      const prepared = await f.prepare();
      if (phase === "lock") f.db.$queryRaw.mockRejectedValueOnce(failure);
      if (phase === "admission-load") f.load.mockRejectedValueOnce(failure);
      expect(await prepared.admissionGuard(f.db)).toBe("unavailable");
      if (!["lock", "admission-load"].includes(phase)) expect(prepared.evidence).toBe("unavailable");
    });
});
