import { describe, it, expect } from "vitest";
import {
  BUILD_WIP_CAP,
  SHARED_LEASE_WIP_CAP,
  WIP_POOL_CAPACITY,
  wipCapReached,
  assertWipCapacity,
  assertUnifiedWipCapacity,
  decideUnifiedWip,
  BuildWipCapError,
} from "./wip-cap";

describe("wipCapReached", () => {
  it("is false under the cap, true at/over it", () => {
    expect(wipCapReached(BUILD_WIP_CAP - 1)).toBe(false);
    expect(wipCapReached(BUILD_WIP_CAP)).toBe(true);
    expect(wipCapReached(BUILD_WIP_CAP + 3)).toBe(true);
  });

  it("respects a custom cap", () => {
    expect(wipCapReached(0, 1)).toBe(false);
    expect(wipCapReached(1, 1)).toBe(true);
  });
});

describe("assertWipCapacity", () => {
  it("allows starting when under the cap", () => {
    expect(() => assertWipCapacity(BUILD_WIP_CAP - 1)).not.toThrow();
  });

  it("throws BuildWipCapError at the cap", () => {
    expect(() => assertWipCapacity(BUILD_WIP_CAP)).toThrow(BuildWipCapError);
  });

  it("error carries code, active count, cap, and a plain-English message", () => {
    try {
      assertWipCapacity(4, 3);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildWipCapError);
      const err = e as BuildWipCapError;
      expect(err.code).toBe("BUILD_WIP_CAP_REACHED");
      expect(err.active).toBe(4);
      expect(err.cap).toBe(3);
      expect(err.message).toContain("Finish or abandon one");
    }
  });

  it("guides toward a first-class external build when the BS sandbox is full (BI-937128F6)", () => {
    try {
      assertWipCapacity(5, 3);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as BuildWipCapError;
      expect(err.message).toMatch(/external .*build/i);
      expect(err.message).toContain("§17");
    }
  });
});

// ─── Unified, pool-aware WIP derivation (BI-937128F6) ────────────────────────

describe("WIP_POOL_CAPACITY (BI-937128F6)", () => {
  it("caps the bs-sandbox pool at BUILD_WIP_CAP — today's effective limit is preserved", () => {
    // Regression pin: the unified model MUST NOT change the live sandbox limit.
    expect(WIP_POOL_CAPACITY["bs-sandbox"]).toBe(BUILD_WIP_CAP);
    expect(WIP_POOL_CAPACITY["bs-sandbox"]).toBe(3);
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
  it("admits bs-sandbox work below the cap and blocks it at/over — same limit as the BS-only gate", () => {
    // Regression pin against the legacy assertWipCapacity/wipCapReached behavior:
    // for every pressure level, the bs-sandbox decision matches !wipCapReached(n).
    for (const pressure of [0, 1, 2, 3, 4, 7]) {
      const decision = decideUnifiedWip("bs-sandbox", pressure);
      expect(decision.capacity).toBe(BUILD_WIP_CAP);
      expect(decision.pressure).toBe(pressure);
      expect(decision.admitted).toBe(!wipCapReached(pressure, BUILD_WIP_CAP));
    }
    // Explicit boundary: admits at 2, blocks at 3.
    expect(decideUnifiedWip("bs-sandbox", 2).admitted).toBe(true);
    expect(decideUnifiedWip("bs-sandbox", 3).admitted).toBe(false);
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

describe("assertUnifiedWipCapacity (BI-937128F6)", () => {
  it("allows a new bs-sandbox unit below the cap", () => {
    expect(() => assertUnifiedWipCapacity("bs-sandbox", BUILD_WIP_CAP - 1)).not.toThrow();
  });

  it("throws BuildWipCapError at the bs-sandbox cap, carrying pressure + capacity", () => {
    try {
      assertUnifiedWipCapacity("bs-sandbox", BUILD_WIP_CAP);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildWipCapError);
      const err = e as BuildWipCapError;
      expect(err.code).toBe("BUILD_WIP_CAP_REACHED");
      expect(err.active).toBe(BUILD_WIP_CAP);
      expect(err.cap).toBe(BUILD_WIP_CAP);
    }
  });

  it("never throws for unbounded pools", () => {
    expect(() => assertUnifiedWipCapacity("host-worktree", 500)).not.toThrow();
    expect(() => assertUnifiedWipCapacity("none", 500)).not.toThrow();
  });
});
