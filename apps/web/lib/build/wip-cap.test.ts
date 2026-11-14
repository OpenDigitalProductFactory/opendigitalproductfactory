import { describe, it, expect } from "vitest";
import * as wipCap from "./wip-cap";
import {
  ACTIVE_BUILD_WHERE,
  SHARED_LEASE_WIP_CAP,
  TERMINAL_BUILD_PHASES,
  WAITING_ON_OWNER_WHERE,
  WIP_POOL_CAPACITY,
  decideUnifiedWip,
  isBuildWaitingOnOwner,
  isActiveBuild,
  sandboxPoolSize,
} from "./wip-cap";
import { TERMINAL_BUILD_PHASES as TOOL_HELPER_TERMINAL_BUILD_PHASES } from "@/lib/mcp/build-tool-helpers";

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

describe("one definition of an active build (BI-B6894001)", () => {
  const parked = { phase: "ideate", abandonedAt: null, waitingOnOwnerSince: new Date("2026-11-14T00:00:00Z") };
  const live = { phase: "ideate", abandonedAt: null, waitingOnOwnerSince: null };
  const abandoned = { phase: "abandoned", abandonedAt: new Date("2026-11-14T00:00:00Z"), waitingOnOwnerSince: null };

  it("excludes abandoned and owner-parked builds", () => {
    expect(ACTIVE_BUILD_WHERE).toEqual({ abandonedAt: null, waitingOnOwnerSince: null });
    expect(isActiveBuild(live)).toBe(true);
    expect(isActiveBuild(parked)).toBe(false);
    expect(isActiveBuild(abandoned)).toBe(false);
  });

  it("names the parked builds a read model must still show", () => {
    expect(WAITING_ON_OWNER_WHERE).toEqual({ abandonedAt: null, waitingOnOwnerSince: { not: null } });
    expect(isBuildWaitingOnOwner(parked)).toBe(true);
    expect(isBuildWaitingOnOwner(live)).toBe(false);
    expect(isBuildWaitingOnOwner({ waitingOnOwnerSince: "2026-11-14T00:00:00Z" })).toBe(true);
  });

  it("keeps a parked build in its real phase, so it is never terminal", () => {
    expect(TERMINAL_BUILD_PHASES).not.toContain(parked.phase);
  });

  it("has a single TERMINAL_BUILD_PHASES vocabulary", () => {
    expect([...TERMINAL_BUILD_PHASES]).toEqual(["complete", "failed", "abandoned"]);
    expect(TOOL_HELPER_TERMINAL_BUILD_PHASES).toBe(TERMINAL_BUILD_PHASES);
  });
});
