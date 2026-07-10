import { beforeEach, describe, expect, it, vi } from "vitest";

const lease = vi.hoisted(() => ({
  listActiveNonprodEnvironmentLeases: vi.fn(),
  claimNonprodEnvironmentLease: vi.fn(),
  releaseNonprodEnvironmentLease: vi.fn(),
  renewNonprodEnvironmentLease: vi.fn(),
}));
vi.mock("@/lib/nonprod/environment-lease", () => lease);

import { nonprodLeasePack } from "./nonprod-lease-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "list_nonprod_environment_leases",
  "claim_nonprod_environment_lease",
  "release_nonprod_environment_lease",
  "renew_nonprod_environment_lease",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nonprod-lease pack — registration", () => {
  it("exposes exactly the four lease tools", () => {
    expect(nonprodLeasePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(nonprodLeasePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of nonprodLeasePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read tool needs read, mutating tools need write", () => {
    expect(nonprodLeasePack.grants.list_nonprod_environment_leases).toEqual(["work_capsule_read"]);
    for (const t of ["claim_nonprod_environment_lease", "release_nonprod_environment_lease", "renew_nonprod_environment_lease"]) {
      expect(nonprodLeasePack.grants[t]).toEqual(["work_capsule_write"]);
      expect(isToolAllowedByGrants(t, ["work_capsule_write"])).toBe(true);
    }
    expect(isToolAllowedByGrants("list_nonprod_environment_leases", ["work_capsule_read"])).toBe(true);
  });
});

describe("nonprod-lease pack — handler behavior (delegation preserved)", () => {
  it("list returns the active leases from the service", async () => {
    lease.listActiveNonprodEnvironmentLeases.mockResolvedValue([{ id: "L1" }]);
    const res = await nonprodLeasePack.handlers.list_nonprod_environment_leases({}, "u1");
    expect(res.success).toBe(true);
    expect(lease.listActiveNonprodEnvironmentLeases).toHaveBeenCalledOnce();
  });

  it("claim rejects an unsupported environmentKey without calling the service", async () => {
    const res = await nonprodLeasePack.handlers.claim_nonprod_environment_lease(
      {
        environmentKey: "bogus",
        ownerProvider: "claude",
        ownerSessionId: "s1",
        purpose: "test",
        url: "http://localhost:3001",
        ports: [3001],
        expiresAt: new Date("2026-07-10T12:00:00Z").toISOString(),
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_environment_key");
    expect(lease.claimNonprodEnvironmentLease).not.toHaveBeenCalled();
  });

  it("release delegates to the service with the leaseId", async () => {
    lease.releaseNonprodEnvironmentLease.mockResolvedValue({ id: "L1", status: "released" });
    const res = await nonprodLeasePack.handlers.release_nonprod_environment_lease({ leaseId: "L1" }, "u1");
    expect(res.success).toBe(true);
    expect(lease.releaseNonprodEnvironmentLease).toHaveBeenCalledWith({ leaseId: "L1" });
  });
});
