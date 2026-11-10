import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  prisma: {
    agentSurfaceReadiness: { upsert: vi.fn(), findMany: vi.fn() },
    agentToolchainObservation: { findMany: vi.fn() },
    oAuthClient: { findMany: vi.fn(async () => []), create: vi.fn() },
    user: { findUnique: vi.fn() },
    agent: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    scheduledAgentTask: { findUnique: vi.fn() },
    mcpApiToken: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@dpf/db", () => db);
vi.mock("@/lib/auth/oauth-tokens", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/oauth-tokens")>(),
  prepareClientSecret: () => ({ plaintext: "dpfocs_fixture", hash: "fixture-hash", enc: "encrypted-fixture" }),
}));

const stance = vi.hoisted(() => ({ loadInstanceStance: vi.fn(), prismaInstanceStanceStore: vi.fn(() => ({})) }));
vi.mock("@/lib/install/instance-stance", () => stance);

const served = vi.hoisted(() => ({ getPublishedToolchain: vi.fn() }));
vi.mock("@/lib/agent-toolchain/served-toolchain", () => served);

import { surfaceReadinessPack } from "./surface-readiness-pack";
import { resolveCallConsequence } from "@/lib/tool-consequence";
import { grantsForPublicScopes } from "@/lib/auth/oauth-scope-map";
import { setGovernedToolAuditOverridesForTests, updateGovernedToolAudit, writeGovernedToolAudit } from "@/lib/governed-tool-audit";

// BI-64795FD0: the updater's per-client CLI versions reach the store, and the
// fleet read names clients whose capabilities are unverified.

const record = surfaceReadinessPack.handlers.record_surface_readiness!;
const fleet = surfaceReadinessPack.handlers.get_fleet_readiness!;
const now = new Date();

it("declares source credential issuance with authority consequence, existing build grant and secret redaction", () => {
  const definition = surfaceReadinessPack.definitions.find(d => d.name === "issue_source_credentials_client");
  expect(definition).toMatchObject({ sideEffect: true, consequence: "authority", requiredCapability: "view_platform", secretResultKeys: ["credentialsClient"] });
  expect(definition?.inputSchema).toMatchObject({ properties: {}, required: [], additionalProperties: false });
  expect(surfaceReadinessPack.grants.issue_source_credentials_client).toEqual(["sandbox_execute"]);
});

it("serializes the actual source issuer and binds the authenticated actor rather than supplied overrides", async () => {
  db.prisma.$transaction.mockImplementation(async run => run(db.prisma));
  db.prisma.user.findUnique.mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] });
  db.prisma.agent.findMany.mockResolvedValue([{ id: "agent-row", agentId: "AGT-EXT-CODEX", displayName: "Codex" }]);
  const result = await surfaceReadinessPack.handlers.issue_source_credentials_client!(
    { ownerUserId: "foreign", agentId: "AGT-OTHER", scopes: ["dpf.admin"] }, "human",
    { apiTokenId: "own-token", authSource: "oauth", tokenScope: "write", agentId: "AGT-EXT-CODEX",
      tokenGrantScopes: grantsForPublicScopes(["dpf.read", "dpf.work", "dpf.build"]) });
  expect(result.success).toBe(true);
  expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
  const lock = db.prisma.$executeRaw.mock.calls[0];
  expect(lock[0].join("")).toContain("pg_advisory_xact_lock");
  expect(lock[1]).toBe("source-credentials:human:AGT-EXT-CODEX");
  expect(db.prisma.agent.findMany.mock.calls[0][0].where.agentId).toBe("AGT-EXT-CODEX");
  expect(db.prisma.oAuthClient.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerUserId: "human", agentId: "agent-row" }) });
  expect(result.message).not.toContain("dpfocs_fixture");
});

it("redacts the actual source credential definition on initial and finalized audit writes", async () => {
  const definition = surfaceReadinessPack.definitions.find(d => d.name === "issue_source_credentials_client")!;
  const create = vi.fn(async (_row: Record<string, unknown>) => ({ id: "audit-row" }));
  const update = vi.fn(async (_id: string, _row: Record<string, unknown>) => ({}));
  const result = { success: true, message: "Issued fixture client.", data: { credentialsClient: { clientId: "dpfoc_fixture", clientSecret: "dpfocs_fixture" }, agentBound: true } };
  setGovernedToolAuditOverridesForTests({ create, update });
  try {
    await writeGovernedToolAudit({ toolName: definition.name, tool: definition, rawParams: {}, result, userId: "human", source: "external-jsonrpc", durationMs: 1 });
    await updateGovernedToolAudit("audit-row", result, 1, definition);
    expect(JSON.stringify(create.mock.calls)).not.toContain("dpfocs_fixture");
    expect(JSON.stringify(update.mock.calls)).not.toContain("dpfocs_fixture");
    expect(create.mock.calls[0][0]).toMatchObject({ result: { data: { credentialsClient: "[REDACTED]", agentBound: true } } });
    expect(result.data.credentialsClient.clientSecret).toBe("dpfocs_fixture");
  } finally { setGovernedToolAuditOverridesForTests({}); }
});

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


describe("own source credential approval classification", () => {
  const call = { toolName: "issue_source_credentials_client", params: {}, userId: "human", context: { agentId: "AGT-EXT-CODEX", authSource: "oauth" } };
  const definition = surfaceReadinessPack.definitions.find(d => d.name === call.toolName)!;
  it("removes the extra handoff only for a bound empty-input call under canonical DEV credential stance", async () => {
    stance.loadInstanceStance.mockResolvedValueOnce({ environmentClass: "development", primaryPurpose: "evolve-dpf", credentials: "local-permitted" });
    expect((await resolveCallConsequence(definition, call)).consequence).toBeNull();
    expect(stance.loadInstanceStance).toHaveBeenCalled();
    expect(definition.consequence).toBe("authority");
  });
  it.each([
    { environmentClass: "production", primaryPurpose: "evolve-dpf", credentials: "local-permitted" },
    { environmentClass: "development", primaryPurpose: "operate-business", credentials: "local-permitted" },
    { environmentClass: "development", primaryPurpose: "evolve-dpf", credentials: "operator-only" },
    {},
  ])("retains authority when canonical stance is not the declared DEV credential contract: %j", async profile => {
    stance.loadInstanceStance.mockResolvedValueOnce(profile);
    expect((await resolveCallConsequence(definition, call)).consequence).toBe("authority");
  });
  it("fails closed when the stance cannot be read", async () => {
    stance.loadInstanceStance.mockRejectedValueOnce(new Error("unavailable"));
    expect((await resolveCallConsequence(definition, call)).consequence).toBe("authority");
  });
  it.each([
    { ...call, params: { agentId: "AGT-OTHER" } },
    { ...call, context: undefined },
    { ...call, context: { authSource: "session-jwt", agentId: "AGT-EXT-CODEX" } },
    { ...call, userId: "" },
    { ...call, toolName: "issue_grok_credentials_client" },
  ])("does not narrow an unbound or overridden call: %j", async input => {
    stance.loadInstanceStance.mockReset();
    expect((await resolveCallConsequence(definition, input)).consequence).toBe("authority");
    expect(stance.loadInstanceStance).not.toHaveBeenCalled();
  });
});
