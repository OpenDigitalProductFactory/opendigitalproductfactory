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

import { JOB_DEFINITION_AXES } from "@dpf/db/coworker-job-definition";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/**
 * A complete job definition (BI-2D0063DF). Every axis answered, because the door
 * now refuses a coworker that has no job — which is what it used to create.
 */
const COMPLETE_JOB = {
  agentId: "field-safety-auditor",
  axes: Object.fromEntries(
    JOB_DEFINITION_AXES.map((axis) => [
      axis,
      { state: "satisfied" as const, evidence: `${axis} is answered by a named, checkable piece of substrate.` },
    ]),
  ),
};

const VALID_INPUT = {
  agentId: "field-safety-auditor",
  name: "Field Safety Auditor",
  description: "Audits field-service jobs for safety compliance.",
  grants: ["backlog_read", "registry_read"],
  jobDefinition: COMPLETE_JOB,
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

  // ── The contract the door now enforces (BI-2D0063DF) ──────────────────────

  it("refuses to establish a coworker with no job definition at all", async () => {
    const { jobDefinition: _omitted, ...noJob } = VALID_INPUT;
    const result = await establishCoworker(noJob as never, "usr-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("missing_job_definition");
    // The message must name the axes, so the caller learns the contract from
    // the refusal rather than having to go read it.
    expect(result.message).toContain("cadence");
    expect(result.message).toContain("measures");
  });

  it("refuses a partial job definition and names every unanswered axis at once", async () => {
    const result = await establishCoworker(
      {
        ...VALID_INPUT,
        jobDefinition: {
          agentId: "field-safety-auditor",
          axes: { purpose: { state: "satisfied", evidence: "Audits field jobs for safety compliance, per the archetype stage." } },
        },
      },
      "usr-1",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("incomplete_job_definition");
    // Eight remaining axes, all reported together — one round of findings, not
    // eight round trips.
    expect(result.message).toContain("accountabilities");
    expect(result.message).toContain("tailoring");
  });

  it("refuses an expired waiver rather than hiring against a lapsed decision", async () => {
    const axes = { ...COMPLETE_JOB.axes } as Record<string, unknown>;
    axes.cadence = { state: "waived", reason: "Deferred until the room that carries this drive exists.", reviewBy: "2020-01-01" };
    const result = await establishCoworker(
      { ...VALID_INPUT, jobDefinition: { agentId: "field-safety-auditor", axes: axes as never } },
      "usr-1",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("re-decide");
  });

  it("accepts a waived axis that is still in date", async () => {
    const axes = { ...COMPLETE_JOB.axes } as Record<string, unknown>;
    axes.cadence = { state: "waived", reason: "Advisory-only role; it answers when asked and holds no standing work.", reviewBy: "2099-01-01" };
    const result = await establishCoworker(
      { ...VALID_INPUT, jobDefinition: { agentId: "field-safety-auditor", axes: axes as never } },
      "usr-1",
    );

    expect(result.ok).toBe(true);
  });

  it("no longer tells the author the job is optional", async () => {
    const result = await establishCoworker(VALID_INPUT, "usr-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The line this replaced read "Optionally: curated golden journey,
    // service-catalog offer, COWORKER_SELF_TASKS entry." Making the job
    // optional is why the measure keeps finding wired, idle coworkers.
    expect(result.checklist.join("\n")).not.toContain("Optionally");
    expect(result.checklist.join("\n")).toContain("Land what the job definition promised");
  });
});
