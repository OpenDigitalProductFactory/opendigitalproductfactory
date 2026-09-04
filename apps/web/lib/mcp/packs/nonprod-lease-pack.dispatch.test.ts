import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockListActiveNonprodEnvironmentLeases,
  mockListQueuedNonprodEnvironmentLeases,
  mockClaimNonprodEnvironmentLease,
  mockReleaseNonprodEnvironmentLease,
  mockRenewNonprodEnvironmentLease,
  mockRecordLocalIntegrationResult,
  mockCheckpointNonprodLeaseWait,
  mockSettleNonprodLeaseWait,
} = vi.hoisted(() => ({
  mockListActiveNonprodEnvironmentLeases: vi.fn(),
  mockListQueuedNonprodEnvironmentLeases: vi.fn(),
  mockClaimNonprodEnvironmentLease: vi.fn(),
  mockReleaseNonprodEnvironmentLease: vi.fn(),
  mockRenewNonprodEnvironmentLease: vi.fn(),
  mockRecordLocalIntegrationResult: vi.fn(),
  mockCheckpointNonprodLeaseWait: vi.fn(),
  mockSettleNonprodLeaseWait: vi.fn(),
}));

vi.mock("@/lib/kernel/load-enforceable-principles", () => ({
  loadEnforceablePrinciples: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/nonprod/environment-lease", async (importOriginal) => ({
  // Spread the real module so non-mocked exports (e.g. NONPROD_OWNER_PROVIDERS,
  // now read by claimNonprodEnvironmentLeaseHandler) remain defined; override
  // only the DB-touching functions with mocks.
  ...(await importOriginal<typeof import("@/lib/nonprod/environment-lease")>()),
  listActiveNonprodEnvironmentLeases: mockListActiveNonprodEnvironmentLeases,
  listQueuedNonprodEnvironmentLeases: mockListQueuedNonprodEnvironmentLeases,
  claimNonprodEnvironmentLease: mockClaimNonprodEnvironmentLease,
  releaseNonprodEnvironmentLease: mockReleaseNonprodEnvironmentLease,
  renewNonprodEnvironmentLease: mockRenewNonprodEnvironmentLease,
}));

vi.mock("@/lib/nonprod/local-integration", () => ({
  recordLocalIntegrationResult: mockRecordLocalIntegrationResult,
}));

vi.mock("@/lib/nonprod/durable-wait", () => ({
  checkpointNonprodLeaseWait: mockCheckpointNonprodLeaseWait,
  settleNonprodLeaseWait: mockSettleNonprodLeaseWait,
}));

import { executeTool } from "@/lib/mcp-tools";

describe("nonproduction environment MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckpointNonprodLeaseWait.mockResolvedValue({ taskRunId: "TR-NONPROD-WAIT" });
  });

  it("lists active nonproduction environment leases", async () => {
    mockListActiveNonprodEnvironmentLeases.mockResolvedValue([
      { leaseId: "NPEL-1", environmentKey: "active-candidate", status: "active" },
    ]);
    mockListQueuedNonprodEnvironmentLeases.mockResolvedValue([]);

    const result = await executeTool("list_nonprod_environment_leases", {}, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(result.data?.leases).toEqual([
      { leaseId: "NPEL-1", environmentKey: "active-candidate", status: "active" },
    ]);
  });

  it("claims a shared nonproduction environment lease", async () => {
    mockClaimNonprodEnvironmentLease.mockResolvedValue({
      status: "admitted",
      lease: { leaseId: "NPEL-1", url: "http://localhost:53601" },
      slotKey: "slot-0",
      waitAgeMs: 0,
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

  it("returns a stable queue position when the shared environment is occupied", async () => {
    mockClaimNonprodEnvironmentLease.mockResolvedValue({
      status: "queued",
      lease: { leaseId: "NPEL-WAIT", ownerProvider: "codex" },
      queuePosition: 1,
      waitAgeMs: 125,
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

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("NPEL-WAIT");
    expect(result.data?.admission).toEqual({
      status: "queued",
      queuePosition: 1,
      waitAgeMs: 125,
      resumeMode: "durable-task",
      taskRunId: "TR-NONPROD-WAIT",
    });
    expect(mockCheckpointNonprodLeaseWait).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      queuePosition: 1,
    }));
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

  it("renews an owned nonproduction environment lease (heartbeat)", async () => {
    mockRenewNonprodEnvironmentLease.mockResolvedValue({
      status: "renewed",
      lease: { leaseId: "NPEL-1" },
    });

    const result = await executeTool("renew_nonprod_environment_lease", {
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      ttlMinutes: 10,
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("NPEL-1");
    expect(mockRenewNonprodEnvironmentLease).toHaveBeenCalledWith({
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      ttlMs: 600000,
    });
  });

  it("reports lease_lost when a renewal target is expired or not owned", async () => {
    mockRenewNonprodEnvironmentLease.mockResolvedValue({ status: "lost", reason: "expired" });

    const result = await executeTool("renew_nonprod_environment_lease", {
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("lease_lost");
    expect(result.data?.reason).toBe("expired");
  });

  it("records a local integration result", async () => {
    mockRecordLocalIntegrationResult.mockResolvedValue({ id: "external-1" });

    const result = await executeTool("record_local_integration_result", {
      provider: "codex",
      externalSessionId: "codex-session-1",
      routeContext: "/build",
      buildId: "FB-1",
      taskRunId: "TR-1",
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      status: "passed",
      summary: "Merged-code gate passed.",
      evidence: { commands: ["pnpm --filter web typecheck"] },
    }, "user-1", { routeContext: "/build" });

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("external-1");
    expect(mockRecordLocalIntegrationResult).toHaveBeenCalledWith({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-session-1",
      routeContext: "/build",
      buildId: "FB-1",
      taskRunId: "TR-1",
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      status: "passed",
      summary: "Merged-code gate passed.",
      evidence: { commands: ["pnpm --filter web typecheck"] },
    });
  });
});
