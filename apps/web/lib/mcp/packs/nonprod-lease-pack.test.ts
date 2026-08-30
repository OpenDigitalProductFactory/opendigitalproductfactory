import { beforeEach, describe, expect, it, vi } from "vitest";

const lease = vi.hoisted(() => ({
  NONPROD_OWNER_PROVIDERS: ["build-studio", "claude", "codex", "grok", "antigravity", "coworker"],
  listActiveNonprodEnvironmentLeases: vi.fn(),
  listQueuedNonprodEnvironmentLeases: vi.fn(),
  claimNonprodEnvironmentLease: vi.fn(),
  releaseNonprodEnvironmentLease: vi.fn(),
  renewNonprodEnvironmentLease: vi.fn(),
}));
vi.mock("@/lib/nonprod/environment-lease", () => lease);
const durableWait = vi.hoisted(() => ({
  checkpointNonprodLeaseWait: vi.fn(),
  settleNonprodLeaseWait: vi.fn(),
}));
vi.mock("@/lib/nonprod/durable-wait", () => durableWait);

import { nonprodLeasePack } from "./nonprod-lease-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { deriveGateKey } from "@/lib/gates/gate-run-identity";

const EXPECTED_TOOLS = [
  "list_nonprod_environment_leases",
  // BI-3A34D7A9: read-only PR/change -> client+thread attribution lookup.
  "lookup_change_origin",
  "claim_nonprod_environment_lease",
  "release_nonprod_environment_lease",
  "renew_nonprod_environment_lease",
];

beforeEach(() => {
  vi.clearAllMocks();
  durableWait.checkpointNonprodLeaseWait.mockResolvedValue({
    taskRunId: "TR-NONPROD-1",
    wait: { state: "waiting" },
  });
});

describe("nonprod-lease pack — registration", () => {
  it("exposes exactly the lease + origin-lookup tools", () => {
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
    // Origin lookup is read-only: attribution must never require write scope.
    expect(nonprodLeasePack.grants.lookup_change_origin).toEqual(["work_capsule_read"]);
    expect(isToolAllowedByGrants("lookup_change_origin", ["work_capsule_read"])).toBe(true);
  });

  it("origin lookup refuses a call with neither a SHA nor a branch", async () => {
    const res = await nonprodLeasePack.handlers.lookup_change_origin!({}, "user-1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_required");
  });

  it("declares slot capability, host pressure, and assigned-slot binding in the existing tools", () => {
    const claim = nonprodLeasePack.definitions.find((d) => d.name === "claim_nonprod_environment_lease");
    const renew = nonprodLeasePack.definitions.find((d) => d.name === "renew_nonprod_environment_lease");
    expect(claim?.inputSchema.properties).toHaveProperty("slotManifestVersion");
    expect(claim?.inputSchema.properties).toHaveProperty("hostPressure");
    expect(claim?.inputSchema.properties).toHaveProperty("resourceClass");
    expect(claim?.inputSchema.properties).toHaveProperty("hostResource");
    expect(claim?.inputSchema.properties).toHaveProperty("ownerProcessIdentity");
    expect(renew?.inputSchema.properties).toHaveProperty("slotBinding");
    expect(renew?.inputSchema.properties).toHaveProperty("hostPressure");
  });
});

describe("nonprod-lease pack — handler behavior (delegation preserved)", () => {
  it("list returns admitted and queued leases from the service", async () => {
    lease.listActiveNonprodEnvironmentLeases.mockResolvedValue([{ id: "L1" }]);
    lease.listQueuedNonprodEnvironmentLeases.mockResolvedValue([{ id: "L2" }]);
    const res = await nonprodLeasePack.handlers.list_nonprod_environment_leases({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      leases: [{ id: "L1" }],
      queued: [{ id: "L2" }],
    });
    expect(lease.listActiveNonprodEnvironmentLeases).toHaveBeenCalledOnce();
    expect(lease.listQueuedNonprodEnvironmentLeases).toHaveBeenCalledOnce();
  });

  it("returns a durable queued admission without reporting a conflict", async () => {
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "queued",
      lease: {
        id: "lease-row-1",
        leaseId: "NPEL-Q1",
        claimKey: "local-ci:s1:abc",
        environmentKey: "local-integration-ci",
        ownerProvider: "codex",
        ownerSessionId: "s1",
        worktreePath: null,
        branchName: null,
        taskRunId: null,
      },
      queuePosition: 2,
      waitAgeMs: 1200,
    });
    const res = await nonprodLeasePack.handlers.claim_nonprod_environment_lease(
      {
        environmentKey: "local-integration-ci",
        ownerProvider: "codex",
        ownerSessionId: "s1",
        claimKey: "local-ci:s1:abc",
        purpose: "test",
        url: "http://localhost:3010",
        ports: [3010],
        expiresAt: new Date("2026-07-28T22:00:00Z").toISOString(),
      },
      "u1",
    );

    expect(res).toMatchObject({
      success: true,
      entityId: "NPEL-Q1",
      data: {
        admission: {
          status: "queued",
          queuePosition: 2,
          waitAgeMs: 1200,
          resumeMode: "durable-task",
          taskRunId: "TR-NONPROD-1",
        },
      },
    });
    expect(lease.claimNonprodEnvironmentLease).toHaveBeenCalledWith(
      expect.objectContaining({ claimKey: "local-ci:s1:abc" }),
    );
    expect(durableWait.checkpointNonprodLeaseWait).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        queuePosition: 2,
        waitDeadlineAt: expect.any(Date),
      }),
    );
  });

  it("settles the same durable TaskRun when a fresh claim is admitted", async () => {
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "admitted",
      lease: {
        leaseId: "NPEL-Q1", taskRunId: "TR-NONPROD-1", status: "active",
        environmentKey: "local-integration-ci",
      },
      slotKey: "slot-0",
      waitAgeMs: 5_000,
      poolPolicy: {},
    });
    const res = await nonprodLeasePack.handlers.claim_nonprod_environment_lease({
      environmentKey: "local-integration-ci", ownerProvider: "codex", ownerSessionId: "s1",
      claimKey: "local-ci:s1:abc", purpose: "test", url: "http://localhost:3010", ports: [3010],
      expiresAt: "2026-07-28T22:00:00Z",
    }, "u1");

    expect(res.success).toBe(true);
    expect(durableWait.settleNonprodLeaseWait).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-NONPROD-1", leaseId: "NPEL-Q1", state: "admitted",
    }));
  });

  it("returns admitted slot metadata", async () => {
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "admitted",
      lease: { leaseId: "NPEL-A1" },
      slotKey: "slot-0",
      waitAgeMs: 2500,
    });
    const res = await nonprodLeasePack.handlers.claim_nonprod_environment_lease(
      {
        environmentKey: "local-integration-ci",
        ownerProvider: "codex",
        ownerSessionId: "s1",
        claimKey: "local-ci:s1:abc",
        purpose: "test",
        url: "http://localhost:3010",
        ports: [3010],
        expiresAt: new Date("2026-07-28T22:00:00Z").toISOString(),
      },
      "u1",
    );

    expect(res).toMatchObject({
      success: true,
      data: {
        admission: {
          status: "admitted",
          slotKey: "slot-0",
          waitAgeMs: 2500,
        },
      },
    });
  });

  it("derives the immutable local-CI claim key on the server and projects subscribers", async () => {
    const gateIdentity = {
      repository: "OpenDigitalProductFactory/OpenDigitalProductFactory",
      integrationTreeSha: "a".repeat(40),
      evidencePlanDigest: "b".repeat(64),
      toolchainFingerprint: "c".repeat(64),
      gateKind: "local-integration-ci" as const,
    };
    const gateKey = deriveGateKey(gateIdentity);
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "subscribed",
      lease: { leaseId: "NPEL-WINNER", ownerSessionId: "winner" },
      executionStatus: "admitted",
      poolPolicy: { effectiveCapacity: 1 },
    });

    const res = await nonprodLeasePack.handlers.claim_nonprod_environment_lease({
      environmentKey: "local-integration-ci",
      ownerProvider: "codex",
      ownerSessionId: "subscriber",
      claimKey: "caller-must-not-control-this",
      gateIdentity,
      purpose: "test",
      url: "http://localhost:3010",
      ports: [3010],
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    }, "u1");

    expect(lease.claimNonprodEnvironmentLease).toHaveBeenCalledWith(
      expect.objectContaining({ claimKey: `gate:${gateKey}` }),
    );
    expect(res).toMatchObject({
      success: true,
      entityId: "NPEL-WINNER",
      data: {
        gateKey,
        admission: { status: "subscribed", executionStatus: "admitted" },
      },
    });
  });

  it("projects reusable terminal gate evidence without another admission", async () => {
    const gateIdentity = {
      repository: "opendigitalproductfactory/opendigitalproductfactory",
      integrationTreeSha: "a".repeat(40),
      evidencePlanDigest: "b".repeat(64),
      toolchainFingerprint: "c".repeat(64),
      gateKind: "local-integration-ci" as const,
    };
    const gateKey = deriveGateKey(gateIdentity);
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "reused",
      lease: { leaseId: "NPEL-DONE" },
      evidenceRecordId: "EXT-DONE",
      resultClass: "pass",
    });

    const res = await nonprodLeasePack.handlers.claim_nonprod_environment_lease({
      environmentKey: "local-integration-ci",
      ownerProvider: "codex",
      ownerSessionId: "later-caller",
      gateIdentity,
      purpose: "test",
      url: "http://localhost:3010",
      ports: [3010],
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    }, "u1");

    expect(res).toMatchObject({
      success: true,
      entityId: "EXT-DONE",
      data: {
        gateKey,
        admission: { status: "reused", resultClass: "pass" },
      },
    });
  });

  it("passes a slot-aware claim and recent host observation to durable admission", async () => {
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "queued",
      lease: { leaseId: "NPEL-Q2" },
      queuePosition: 1,
      waitAgeMs: 50,
      poolPolicy: { effectiveCapacity: 2 },
    });
    const hostPressure = {
      observedAt: "2026-07-30T05:00:00.000Z",
      availableMemoryBytes: 12_000_000_000,
      sustainedCpuPercent: 20,
      diskFreeBytes: 100_000_000_000,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    };

    await nonprodLeasePack.handlers.claim_nonprod_environment_lease({
      environmentKey: "local-integration-ci",
      ownerProvider: "codex",
      ownerSessionId: "s2",
      purpose: "pilot",
      url: "http://localhost:3010",
      ports: [3010, 15432],
      expiresAt: new Date("2026-07-30T05:02:00Z").toISOString(),
      slotManifestVersion: 1,
      hostPressure,
    }, "u1");

    expect(lease.claimNonprodEnvironmentLease).toHaveBeenCalledWith(
      expect.objectContaining({ slotManifestVersion: 1, hostPressure }),
    );
  });

  it("passes a typed host resource claim and serializes BigInt lease metadata", async () => {
    lease.claimNonprodEnvironmentLease.mockResolvedValue({
      status: "admitted",
      lease: {
        leaseId: "NPEL-HOST",
        expectedMemoryBytes: BigInt(8 * 1024 ** 3),
        resourceClass: "vitest",
        ownerProcessIdentity: "win32:638917704000000000",
      },
      slotKey: "slot-0",
      waitAgeMs: 0,
      poolPolicy: { source: "host-resource-profile", effectiveCapacity: 1 },
    });
    const hostResource = {
      totalMemoryBytes: 64 * 1024 ** 3,
      availableMemoryBytes: 30 * 1024 ** 3,
      inferenceResident: true,
      ungovernedProcesses: [],
    };

    const result = await nonprodLeasePack.handlers.claim_nonprod_environment_lease({
      environmentKey: "host-heavy-resource",
      ownerProvider: "codex",
      ownerSessionId: "s-host",
      claimKey: "host-resource:s-host:42",
      purpose: "host-resource:vitest",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      resourceClass: "vitest",
      expectedMemoryBytes: 8 * 1024 ** 3,
      ownerProcessId: 42,
      ownerProcessIdentity: "win32:638917704000000000",
      hostResource,
    }, "u1");

    expect(lease.claimNonprodEnvironmentLease).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentKey: "host-heavy-resource",
        url: "host://localhost",
        ports: [],
        resourceClass: "vitest",
        ownerProcessIdentity: "win32:638917704000000000",
        hostResource,
      }),
    );
    expect(result).toMatchObject({
      success: true,
      data: { lease: { expectedMemoryBytes: 8 * 1024 ** 3 } },
    });
    expect(result.data?.lease).not.toHaveProperty("ownerProcessIdentity");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("binds only the server-assigned slot through the existing renewal tool", async () => {
    lease.renewNonprodEnvironmentLease.mockResolvedValue({
      status: "renewed",
      lease: { leaseId: "NPEL-A2", slotKey: "slot-1", phase: "running" },
    });
    const slotBinding = {
      manifestVersion: 1,
      slotKey: "slot-1",
      url: "http://localhost:3011",
      ports: [3011, 15433],
      cleanupCommand: "node scripts/local-ci-slot-cleanup.mjs --slot-key slot-1",
    };

    const result = await nonprodLeasePack.handlers.renew_nonprod_environment_lease({
      leaseId: "NPEL-A2",
      ownerSessionId: "s2",
      ttlMinutes: 2,
      slotBinding,
    }, "u1");

    expect(result.success).toBe(true);
    expect(lease.renewNonprodEnvironmentLease).toHaveBeenCalledWith(
      expect.objectContaining({ slotBinding }),
    );
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
    lease.releaseNonprodEnvironmentLease.mockResolvedValue({
      id: "L1",
      leaseId: "L1",
      status: "released",
      expectedMemoryBytes: BigInt(8 * 1024 ** 3),
    });
    const res = await nonprodLeasePack.handlers.release_nonprod_environment_lease({ leaseId: "L1" }, "u1");
    expect(res.success).toBe(true);
    expect(() => JSON.stringify(res)).not.toThrow();
    expect(lease.releaseNonprodEnvironmentLease).toHaveBeenCalledWith({ leaseId: "L1" });
  });
});
