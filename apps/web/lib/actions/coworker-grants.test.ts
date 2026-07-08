import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentToolGrant: { upsert: vi.fn(), deleteMany: vi.fn() },
    agentToolGrantRevocation: { upsert: vi.fn(), deleteMany: vi.fn() },
    skillAssignment: { upsert: vi.fn(), deleteMany: vi.fn() },
    skillDefinition: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import {
  grantCoworkerTool,
  revokeCoworkerTool,
  grantCoworkerSkill,
  revokeCoworkerSkill,
} from "./coworker-grants";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  asMock(auth).mockResolvedValue({ user: { id: "user_1", platformRole: "admin", isSuperuser: true } });
  asMock(can).mockReturnValue(true);
  asMock(prisma.skillDefinition.findUnique).mockResolvedValue({ skillId: "code-runner" });
});

// ─── Auth gate (every action checks manage_platform FIRST) ───────────────────

describe("coworker-grants — auth gate", () => {
  it("throws Unauthorized and never writes when the capability is absent", async () => {
    asMock(can).mockReturnValue(false);
    await expect(grantCoworkerTool("agent-cuid", "registry_read", "build-specialist", null)).rejects.toThrow(
      /unauthorized/i,
    );
    expect(prisma.agentToolGrant.upsert).not.toHaveBeenCalled();
  });

  it("throws Unauthorized for an unauthenticated session", async () => {
    asMock(auth).mockResolvedValueOnce(null);
    await expect(grantCoworkerSkill("build-specialist", "code-runner", null)).rejects.toThrow(/unauthorized/i);
    expect(prisma.skillAssignment.upsert).not.toHaveBeenCalled();
  });
});

// ─── Tool grants (AgentToolGrant, keyed by Agent.id cuid) ────────────────────

describe("grantCoworkerTool", () => {
  it("upserts on the agentId_grantKey compound key with grantedBy and revalidates", async () => {
    const res = await grantCoworkerTool("agent-cuid", "backlog_write", "build-specialist", "build-specialist");
    expect(res).toEqual({ ok: true });
    expect(prisma.agentToolGrant.upsert).toHaveBeenCalledWith({
      where: { agentId_grantKey: { agentId: "agent-cuid", grantKey: "backlog_write" } },
      update: {},
      create: { agentId: "agent-cuid", grantKey: "backlog_write", grantedBy: "user_1" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/platform/ai/agent/build-specialist");
  });

  it("rejects a grant key outside the closed vocabulary", async () => {
    const res = await grantCoworkerTool("agent-cuid", "not_a_real_grant", "build-specialist", null);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/unknown grant key/i) });
    expect(prisma.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
});

describe("revokeCoworkerTool", () => {
  it("deletes by agentId + grantKey (no-throw when absent)", async () => {
    asMock(prisma.agentToolGrant.deleteMany).mockResolvedValue({ count: 0 });
    const res = await revokeCoworkerTool("agent-cuid", "backlog_write", "build-specialist", null);
    expect(res).toEqual({ ok: true });
    expect(prisma.agentToolGrant.deleteMany).toHaveBeenCalledWith({
      where: { agentId: "agent-cuid", grantKey: "backlog_write" },
    });
  });
});

// ─── Catalog skills (SkillAssignment, keyed by business agentId) ─────────────

describe("grantCoworkerSkill", () => {
  it("validates the skill exists then upserts on skillId_agentId with the business agentId", async () => {
    const res = await grantCoworkerSkill("build-specialist", "code-runner", null);
    expect(res).toEqual({ ok: true });
    expect(prisma.skillDefinition.findUnique).toHaveBeenCalledWith({
      where: { skillId: "code-runner" },
      select: { skillId: true },
    });
    expect(prisma.skillAssignment.upsert).toHaveBeenCalledWith({
      where: { skillId_agentId: { skillId: "code-runner", agentId: "build-specialist" } },
      update: { enabled: true },
      create: { skillId: "code-runner", agentId: "build-specialist", enabled: true, assignedBy: "user_1" },
    });
  });

  it("rejects an unknown skillId", async () => {
    asMock(prisma.skillDefinition.findUnique).mockResolvedValueOnce(null);
    const res = await grantCoworkerSkill("build-specialist", "ghost-skill", null);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/unknown skill/i) });
    expect(prisma.skillAssignment.upsert).not.toHaveBeenCalled();
  });
});

describe("revokeCoworkerSkill", () => {
  it("deletes by skillId + business agentId", async () => {
    asMock(prisma.skillAssignment.deleteMany).mockResolvedValue({ count: 1 });
    const res = await revokeCoworkerSkill("build-specialist", "code-runner", null);
    expect(res).toEqual({ ok: true });
    expect(prisma.skillAssignment.deleteMany).toHaveBeenCalledWith({
      where: { skillId: "code-runner", agentId: "build-specialist" },
    });
  });
});
