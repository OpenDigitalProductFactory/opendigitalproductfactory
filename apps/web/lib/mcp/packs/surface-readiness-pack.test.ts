import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  prisma: {
    agentSurfaceReadiness: { upsert: vi.fn(), findMany: vi.fn() },
    agentToolchainObservation: { findMany: vi.fn() },
    scheduledAgentTask: { findUnique: vi.fn() },
    mcpApiToken: { findUnique: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => db);

const served = vi.hoisted(() => ({ getPublishedToolchain: vi.fn() }));
vi.mock("@/lib/agent-toolchain/served-toolchain", () => served);

import { surfaceReadinessPack } from "./surface-readiness-pack";

// BI-64795FD0: the updater's per-client CLI versions reach the store, and the
// fleet read names clients whose capabilities are unverified.

const record = surfaceReadinessPack.handlers.record_surface_readiness!;
const fleet = surfaceReadinessPack.handlers.get_fleet_readiness!;
const now = new Date();

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.agentSurfaceReadiness.upsert.mockResolvedValue({});
  db.prisma.agentSurfaceReadiness.findMany.mockResolvedValue([]);
  db.prisma.agentToolchainObservation.findMany.mockResolvedValue([]);
  db.prisma.scheduledAgentTask.findUnique.mockResolvedValue(null);
  served.getPublishedToolchain.mockReturnValue({
    packVersion: "0.3.0",
    packDigest: "ab".repeat(32),
    floor: { minPackVersion: null, graceStartsAt: null },
  });
});

describe("record_surface_readiness", () => {
  it("declares the updater's CLI versions as optional inputs", () => {
    const def = surfaceReadinessPack.definitions.find((d) => d.name === "record_surface_readiness")!;
    expect(def.inputSchema).toMatchObject({
      properties: { cliVersion: { type: "string" }, clientVersions: { type: "object" } },
    });
    expect((def.inputSchema as { required: string[] }).required).not.toContain("clientVersions");
  });

  it("persists the CLI versions in detail, bounded to known clients and strings", async () => {
    const result = await record({
      surfaceKey: "claude-code@host",
      clientKind: "claude-code",
      readinessState: "ready",
      mcpOk: true,
      cliVersion: "2.1.300 (Claude Code)",
      clientVersions: { "claude-code": "2.1.300 (Claude Code)", codex: "codex-cli 0.160.0", grok: null, other: "1.0.0", antigravity: 7 },
    }, "user-1", undefined);
    expect(result.success).toBe(true);
    const args = db.prisma.agentSurfaceReadiness.upsert.mock.calls[0]![0] as { update: { detail: unknown } };
    expect(args.update.detail).toEqual({
      cliVersion: "2.1.300 (Claude Code)",
      clientVersions: { "claude-code": "2.1.300 (Claude Code)", codex: "codex-cli 0.160.0", grok: null },
    });
  });

  it("keeps earlier versions when a heartbeat reports none", async () => {
    await record({ surfaceKey: "codex@host", clientKind: "codex", readinessState: "ready", mcpOk: true }, "user-1", undefined);
    const args = db.prisma.agentSurfaceReadiness.upsert.mock.calls[0]![0] as { update: Record<string, unknown>; create: Record<string, unknown> };
    expect("detail" in args.update).toBe(false);
    expect(args.create.detail).toBeNull();
  });
});

describe("get_fleet_readiness", () => {
  it("returns the toolchain section and the clients whose capabilities are unverified", async () => {
    db.prisma.agentToolchainObservation.findMany.mockResolvedValue([{
      credentialRef: "oauth:c1",
      loadedDigest: "abababababababab",
      clientKind: "claude-code",
      probableClient: null,
      loadedPackVersion: "0.3.0",
      authMode: "oauth",
      clientInfoName: "claude-code",
      clientInfoVersion: "2.1.300",
      lastObservedAt: now,
    }]);
    db.prisma.scheduledAgentTask.findUnique.mockResolvedValue({
      taskConfig: {
        clientCapability: {
          schemaVersion: 1,
          consecutiveFailedRuns: 1,
          notified: false,
          clients: { grok: { verificationStale: { reason: "https://docs.x.ai/build/overview: HTTP 503", at: "2026-10-13T04:17:00.000Z" }, passages: {} } },
        },
      },
    });

    const result = await fleet({}, "user-1", undefined);
    expect(result.success).toBe(true);
    const data = result.data as {
      toolchain: { release: { packVersion: string }; credentials: Array<{ verdict: string }> };
      capabilities: {
        unverifiedVersions: Array<{ clientKind: string; label: string }>;
        verificationStale: Array<{ clientKind: string; label: string }>;
      };
    };
    expect(data.toolchain.release.packVersion).toBe("0.3.0");
    expect(data.toolchain.credentials[0]!.verdict).toBe("current");
    expect(data.capabilities.unverifiedVersions).toEqual([
      expect.objectContaining({ clientKind: "claude-code", label: "capabilities unverified for 2.1.300" }),
    ]);
    expect(data.capabilities.verificationStale).toEqual([
      expect.objectContaining({ clientKind: "grok", label: "capabilities unverified" }),
    ]);
    expect(db.prisma.scheduledAgentTask.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: "client-capability-reverify-weekly" },
    }));
  });

  it("names CLI versions the updater reported newer than verified, before the client connects", async () => {
    db.prisma.agentSurfaceReadiness.findMany.mockResolvedValue([{
      surfaceKey: "codex@host",
      clientKind: "codex",
      readinessState: "ready",
      dpfPlatformVersion: null,
      mcpOk: true,
      mcpReason: null,
      detail: { clientVersions: { codex: "codex-cli 0.160.0", "claude-code": "2.1.295 (Claude Code)" } },
      reportedAt: now,
    }]);
    const result = await fleet({}, "user-1", undefined);
    const data = result.data as { capabilities: { unverifiedVersions: Array<{ clientKind: string; clientVersion: string }> } };
    expect(data.capabilities.unverifiedVersions).toEqual([
      expect.objectContaining({ clientKind: "codex", clientVersion: "0.160.0" }),
    ]);
  });
});
