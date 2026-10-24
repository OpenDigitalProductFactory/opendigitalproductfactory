import { describe, it, expect } from "vitest";
import * as wipCap from "./wip-cap";
import { SHARED_LEASE_WIP_CAP, WIP_POOL_CAPACITY, decideUnifiedWip, sandboxPoolSize } from "./wip-cap";

describe("the count cap is retired (BI-3430B3A4)", () => {
  it("exports no BUILD_WIP_CAP or count-limit helpers for a caller to read", () => {
    for (const name of ["BUILD_WIP_CAP", "wipCapReached", "assertWipCapacity", "assertUnifiedWipCapacity", "BuildWipCapError"]) {
      expect(name in wipCap, name).toBe(false);
    }
  });
});

describe("sandboxPoolSize: the machine's physical limit", () => {
  it("reads DPF_SANDBOX_POOL_SIZE, defaulting to one sandbox", () => {
    expect(sandboxPoolSize({})).toBe(1);
    expect(sandboxPoolSize({ DPF_SANDBOX_POOL_SIZE: "3" })).toBe(3);
    expect(sandboxPoolSize({ DPF_SANDBOX_POOL_SIZE: "nonsense" })).toBe(1);
  });
});

describe("WIP_POOL_CAPACITY (BI-937128F6)", () => {
  it("sizes the bs-sandbox pool by the physical sandbox pool, not a build count", () => {
    expect(WIP_POOL_CAPACITY["bs-sandbox"]).toBe(sandboxPoolSize());
  });

  it("documents the shared-lease singleton arity as a named constant", () => {
    expect(WIP_POOL_CAPACITY["shared-lease"]).toBe(SHARED_LEASE_WIP_CAP);
    expect(SHARED_LEASE_WIP_CAP).toBe(1);
  });

  it("leaves host-worktree and non-resource-bound work ungated (unbounded)", () => {
    expect(WIP_POOL_CAPACITY["host-worktree"]).toBe(Number.POSITIVE_INFINITY);
    expect(WIP_POOL_CAPACITY["none"]).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("decideUnifiedWip (BI-937128F6)", () => {
  it("reports the bs-sandbox pool against the sandbox pool size", () => {
    const size = sandboxPoolSize();
    expect(decideUnifiedWip("bs-sandbox", size - 1)).toMatchObject({ capacity: size, admitted: true });
    expect(decideUnifiedWip("bs-sandbox", size)).toMatchObject({ capacity: size, admitted: false });
  });

  it("gates the shared-lease pool at its singleton capacity", () => {
    expect(decideUnifiedWip("shared-lease", 0).admitted).toBe(true);
    expect(decideUnifiedWip("shared-lease", 1).admitted).toBe(false);
  });

  it("reports the same resolved local-CI capacity that durable admission uses", () => {
    const pilot = { sharedLeaseCapacity: 2 };
    expect(decideUnifiedWip("shared-lease", 1, pilot)).toEqual({
      pool: "shared-lease",
      pressure: 1,
      capacity: 2,
      admitted: true,
    });
    expect(decideUnifiedWip("shared-lease", 2, pilot).admitted).toBe(false);

    const rolledBack = { sharedLeaseCapacity: 1 };
    expect(decideUnifiedWip("shared-lease", 1, rolledBack).admitted).toBe(false);
  });

  it("never blocks unbounded pools (host-worktree / none) no matter the pressure", () => {
    expect(decideUnifiedWip("host-worktree", 999).admitted).toBe(true);
    expect(decideUnifiedWip("none", 999).admitted).toBe(true);
  });
});
