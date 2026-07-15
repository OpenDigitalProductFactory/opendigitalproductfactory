import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    agentToolGrant: { upsert: vi.fn() },
    agentToolGrantRevocation: { findMany: vi.fn() },
    agentModelConfig: { upsert: vi.fn() },
    assuranceRun: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/identity/principal-linking", () => ({
  syncAgentPrincipal: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@dpf/db";
import { establishCoworker, promoteCoworker, definitionChecklist } from "./establish-coworker";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const VALID_INPUT = {
  agentId: "field-safety-auditor",
  name: "Field Safety Auditor",
  description: "Audits field-service jobs for safety compliance.",
  grants: ["backlog_read", "registry_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agent.findFirst).mockResolvedValue(null);
  asMock(prisma.agent.create).mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "cuid-new",
    ...args.data,
  }));
  asMock(prisma.agentToolGrantRevocation.findMany).mockResolvedValue([]);
  asMock(prisma.agentToolGrant.upsert).mockResolvedValue({});
  asMock(prisma.agentModelConfig.upsert).mockResolvedValue({});
  asMock(prisma.assuranceRun.findMany).mockResolvedValue([]);
});

describe("establishCoworker (EP-COWORKER-LIFECYCLE Phase 3 factory door)", () => {
  it("creates a draft agent with grants, model floor, and returns the checklist", async () => {
    const result = await establishCoworker(VALID_INPUT, "usr-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stage).toBe("draft");
    expect(result.checklist.length).toBeGreaterThan(3);

    const createArgs = asMock(prisma.agent.create).mock.calls[0][0].data;
    expect(createArgs.lifecycleStage).toBe("draft");
    expect(createArgs.agentId).toBe("field-safety-auditor");
    expect(asMock(prisma.agentToolGrant.upsert)).toHaveBeenCalledTimes(2);
    expect(asMock(prisma.agentModelConfig.upsert).mock.calls[0][0].create.minimumTier).toBe(
      "adequate",
    );
  });

  it("rejects unknown grant keys (dead grants authorize nothing)", async () => {
    const result = await establishCoworker(
      { ...VALID_INPUT, grants: ["backlog_read", "grant_nobody_honors"] },
      "usr-1",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unknown_grant_keys");
    expect(asMock(prisma.agent.create)).not.toHaveBeenCalled();
  });

  it("rejects an agentId that already exists", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValue({
      agentId: "field-safety-auditor",
      lifecycleStage: "production",
    });
    const result = await establishCoworker(VALID_INPUT, "usr-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("already_exists");
  });

  it("collapses a P2002 slugId race onto already_exists (TOCTOU loser)", async () => {
    // findFirst sees nothing (both concurrent callers passed the guard), then
    // create trips Agent_slugId_key. The loser must resolve to already_exists,
    // not a raw unique-constraint crash.
    asMock(prisma.agent.findFirst).mockResolvedValue(null);
    asMock(prisma.agent.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["slugId"] },
      }),
    );
    const result = await establishCoworker(VALID_INPUT, "usr-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("already_exists");
  });

  it("re-throws non-P2002 create failures so genuine bugs surface", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValue(null);
    asMock(prisma.agent.create).mockRejectedValue(
      Object.assign(new Error("connection lost"), { code: "P1001" }),
    );
    await expect(establishCoworker(VALID_INPUT, "usr-1")).rejects.toThrow(/connection lost/);
  });

  it("rejects malformed agentIds and missing fields", async () => {
    expect((await establishCoworker({ ...VALID_INPUT, agentId: "Bad_ID!" }, "u")).ok).toBe(false);
    expect((await establishCoworker({ ...VALID_INPUT, name: " " }, "u")).ok).toBe(false);
    expect(
      (await establishCoworker({ ...VALID_INPUT, minimumTier: "galactic" }, "u")).ok,
    ).toBe(false);
  });

  it("honors revocation tombstones when writing grants", async () => {
    asMock(prisma.agentToolGrantRevocation.findMany).mockResolvedValue([
      { grantKey: "backlog_read" },
    ]);
    await establishCoworker(VALID_INPUT, "usr-1");
    const upsertedKeys = asMock(prisma.agentToolGrant.upsert).mock.calls.map(
      (c) => c[0].create.grantKey,
    );
    expect(upsertedKeys).toEqual(["registry_read"]);
  });
});

describe("promoteCoworker", () => {
  it("refuses a non-draft agent", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValue({
      agentId: "coo",
      lifecycleStage: "production",
    });
    const result = await promoteCoworker("coo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_draft");
  });

  it("refuses a draft whose definition has not landed in the roster", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValue({
      agentId: "field-safety-auditor",
      lifecycleStage: "draft",
    });
    const result = await promoteCoworker("field-safety-auditor");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_defined");
  });

  it("refuses a defined draft without a passing certification", async () => {
    // 'dispatcher' IS in COWORKER_AGENT_SEEDS — simulate it still being draft.
    asMock(prisma.agent.findFirst).mockResolvedValue({
      agentId: "dispatcher",
      lifecycleStage: "draft",
    });
    asMock(prisma.assuranceRun.findMany).mockResolvedValue([]);
    const result = await promoteCoworker("dispatcher");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_certified");
  });

  it("promotes a defined + certified draft to production", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValue({
      agentId: "dispatcher",
      lifecycleStage: "draft",
    });
    asMock(prisma.assuranceRun.findMany).mockResolvedValue([
      { scopeId: "dispatcher", status: "passed", startedAt: new Date() },
    ]);
    asMock(prisma.agent.update).mockResolvedValue({});

    const result = await promoteCoworker("dispatcher");
    expect(result.ok).toBe(true);
    expect(asMock(prisma.agent.update).mock.calls[0][0].data.lifecycleStage).toBe("production");
  });
});

describe("definitionChecklist", () => {
  it("names every code-side definition surface", () => {
    const checklist = definitionChecklist("x").join("\n");
    for (const surface of [
      "COWORKER_AGENT_SEEDS",
      "HARDCODED_COWORKER_GRANTS",
      "ROUTE_AGENT_MAP",
      "AGENT_MODEL_CONFIG_DEFAULTS",
      "docs/professions/registry.json",
    ]) {
      expect(checklist).toContain(surface);
    }
  });
});
