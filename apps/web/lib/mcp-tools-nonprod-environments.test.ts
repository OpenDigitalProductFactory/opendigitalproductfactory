import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockListActiveNonprodEnvironmentLeases,
  mockClaimNonprodEnvironmentLease,
  mockReleaseNonprodEnvironmentLease,
} = vi.hoisted(() => ({
  mockListActiveNonprodEnvironmentLeases: vi.fn(),
  mockClaimNonprodEnvironmentLease: vi.fn(),
  mockReleaseNonprodEnvironmentLease: vi.fn(),
}));

vi.mock("@/lib/kernel/load-enforceable-principles", () => ({
  loadEnforceablePrinciples: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/nonprod/environment-lease", () => ({
  listActiveNonprodEnvironmentLeases: mockListActiveNonprodEnvironmentLeases,
  claimNonprodEnvironmentLease: mockClaimNonprodEnvironmentLease,
  releaseNonprodEnvironmentLease: mockReleaseNonprodEnvironmentLease,
}));

import { executeTool } from "./mcp-tools";

describe("nonproduction environment MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists active nonproduction environment leases", async () => {
    mockListActiveNonprodEnvironmentLeases.mockResolvedValue([
      { leaseId: "NPEL-1", environmentKey: "active-candidate", status: "active" },
    ]);

    const result = await executeTool("list_nonprod_environment_leases", {}, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(result.data?.leases).toEqual([
      { leaseId: "NPEL-1", environmentKey: "active-candidate", status: "active" },
    ]);
  });

  it("claims a shared nonproduction environment lease", async () => {
    mockClaimNonprodEnvironmentLease.mockResolvedValue({
      status: "claimed",
      lease: { leaseId: "NPEL-1", url: "http://localhost:53601" },
    });

    const result = await executeTool("claim_nonprod_environment_lease", {
      environmentKey: "active-candidate",
      ownerProvider: "codex",
      ownerSessionId: "session-1",
      purpose: "UX verification",
      url: "http://localhost:53601",
      ports: [53601],
      expiresAt: "2026-05-26T18:00:00.000Z",
      buildId: "FB-1",
      taskRunId: "TR-1",
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("NPEL-1");
    expect(mockClaimNonprodEnvironmentLease).toHaveBeenCalledWith(expect.objectContaining({
      environmentKey: "active-candidate",
      ownerProvider: "codex",
      ownerSessionId: "session-1",
      purpose: "UX verification",
      url: "http://localhost:53601",
      ports: [53601],
      expiresAt: new Date("2026-05-26T18:00:00.000Z"),
      buildId: "FB-1",
      taskRunId: "TR-1",
    }));
  });

  it("reports conflict when a shared nonproduction environment is already leased", async () => {
    mockClaimNonprodEnvironmentLease.mockResolvedValue({
      status: "conflict",
      active: { leaseId: "NPEL-ACTIVE", ownerProvider: "claude" },
    });

    const result = await executeTool("claim_nonprod_environment_lease", {
      environmentKey: "active-candidate",
      ownerProvider: "codex",
      ownerSessionId: "session-2",
      purpose: "Second server",
      url: "http://localhost:53602",
      ports: [53602],
      expiresAt: "2026-05-26T18:00:00.000Z",
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("lease_conflict");
    expect(result.data?.active).toEqual({ leaseId: "NPEL-ACTIVE", ownerProvider: "claude" });
  });

  it("releases a nonproduction environment lease", async () => {
    mockReleaseNonprodEnvironmentLease.mockResolvedValue({
      leaseId: "NPEL-1",
      status: "released",
    });

    const result = await executeTool("release_nonprod_environment_lease", {
      leaseId: "NPEL-1",
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("NPEL-1");
    expect(mockReleaseNonprodEnvironmentLease).toHaveBeenCalledWith({ leaseId: "NPEL-1" });
  });
});
