import { beforeEach, describe, expect, it, vi } from "vitest";

// The approval now writes the seed file post-commit (BI-5798BBA3). Mock `fs` so
// the unit tests exercise that path without touching a real checkout.
const { existsSyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn((_path?: unknown) => false),
  writeFileSyncMock: vi.fn(),
}));

// PR emission is an external effect with its own test file
// (seed-pull-request.test.ts); these tests are about proposal semantics.
vi.mock("./seed-pull-request", () => ({
  emitSeedPullRequest: vi.fn(async () => ({
    status: "no-token",
    prUrl: null,
    branchName: null,
    reason: "stubbed in unit tests",
  })),
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
  writeFileSync: writeFileSyncMock,
  readFileSync: vi.fn(),
}));

// In-memory state for the mock transaction so atomicity can be exercised
// without a live database. Each test resets it via the beforeEach hook.
const state = vi.hoisted(() => {
  return {
    skills: new Map<string, { skillId: string; category: string; skillMdContent: string }>(),
    proposals: new Map<string, Record<string, unknown>>(),
    revisions: new Map<string, Record<string, unknown>>(),
    revisionRows: [] as Array<Record<string, unknown>>,
    // Optional injection hook used by the atomicity test
    failOnNthCreateRevision: null as number | null,
    createRevisionCallCount: 0,
  };
});

const buildPrismaMock = () => {
  const skillDefinition = {
    findUnique: vi.fn(async ({ where, select }: { where: { skillId: string }; select?: Record<string, boolean> }) => {
      const s = state.skills.get(where.skillId);
      if (!s) return null;
      if (select?.skillMdContent) return { ...s };
      return { skillId: s.skillId };
    }),
    update: vi.fn(
      async ({ where, data }: { where: { skillId: string }; data: { skillMdContent: string } }) => {
        const s = state.skills.get(where.skillId);
        if (!s) throw new Error("skill not found");
        s.skillMdContent = data.skillMdContent;
        return s;
      },
    ),
  };

  const improvementProposal = {
    findUnique: vi.fn(async ({ where }: { where: { proposalId: string } }) => {
      return state.proposals.get(where.proposalId) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
      state.proposals.set(data.proposalId as string, row);
      return row;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { proposalId: string }; data: Record<string, unknown> }) => {
        const p = state.proposals.get(where.proposalId);
        if (!p) throw new Error("proposal not found");
        Object.assign(p, data);
        return p;
      },
    ),
  };

  const skillRevision = {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { skillId_version: { skillId: string; version: number } };
      }) => {
        return (
          state.revisionRows.find(
            (r) =>
              r.skillId === where.skillId_version.skillId &&
              r.version === where.skillId_version.version,
          ) ?? null
        );
      },
    ),
    findFirst: vi.fn(async ({ where }: { where: { skillId: string } }) => {
      const rows = state.revisionRows
        .filter((r) => r.skillId === where.skillId)
        .sort((a, b) => (b.version as number) - (a.version as number));
      return rows[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: { skillId: string } }) => {
      return state.revisionRows
        .filter((r) => r.skillId === where.skillId)
        .sort((a, b) => (b.version as number) - (a.version as number));
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.createRevisionCallCount++;
      if (
        state.failOnNthCreateRevision !== null &&
        state.createRevisionCallCount === state.failOnNthCreateRevision
      ) {
        throw new Error("simulated transient DB failure");
      }
      const row = {
        ...data,
        createdAt: new Date(),
      };
      state.revisions.set(data.revisionId as string, row);
      state.revisionRows.push(row);
      return row;
    }),
  };

  const prisma = {
    skillDefinition,
    improvementProposal,
    skillRevision,
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      // Naive transaction emulator: snapshot state, call fn(tx); on throw,
      // restore the snapshot. Adequate for atomicity verification without
      // a real engine.
      const snapshot = {
        skills: new Map(state.skills),
        proposals: new Map(state.proposals),
        revisions: new Map(state.revisions),
        revisionRows: [...state.revisionRows],
      };
      try {
        return await fn(prisma);
      } catch (err) {
        state.skills = snapshot.skills;
        state.proposals = snapshot.proposals;
        state.revisions = snapshot.revisions;
        state.revisionRows = snapshot.revisionRows;
        throw err;
      }
    }),
  };

  return prisma;
};

const mockPrisma = vi.hoisted(() => ({ value: null as ReturnType<typeof buildPrismaMock> | null }));

vi.mock("@dpf/db", () => ({
  get prisma() {
    return mockPrisma.value;
  },
}));

import {
  approveSkillImprovementProposal,
  listSkillProposals,
  listSkillRevisions,
  rejectSkillImprovementProposal,
  rollbackSkillToRevision,
  submitSkillImprovementProposal,
} from "./proposals";

beforeEach(() => {
  mockPrisma.value = buildPrismaMock();
  state.skills.clear();
  state.proposals.clear();
  state.revisions.clear();
  state.revisionRows.length = 0;
  state.failOnNthCreateRevision = null;
  state.createRevisionCallCount = 0;
  state.skills.set("build-page", {
    category: "build",
    skillId: "build-page",
    skillMdContent: "v0 body — original",
  });
});

describe("submitSkillImprovementProposal", () => {
  it("rejects unknown skill id", async () => {
    await expect(
      submitSkillImprovementProposal({
        skillId: "missing",
        proposedContent: "x",
        title: "t",
        description: "d",
        submittedById: "u",
        agentId: "a",
        routeContext: "/r",
      }),
    ).rejects.toThrow(/unknown skillId/);
  });

  it("rejects empty proposed content", async () => {
    await expect(
      submitSkillImprovementProposal({
        skillId: "build-page",
        proposedContent: "",
        title: "t",
        description: "d",
        submittedById: "u",
        agentId: "a",
        routeContext: "/r",
      }),
    ).rejects.toThrow(/non-empty string/);
  });

  it("creates an ImprovementProposal with category=skill and targetSkillId", async () => {
    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1 proposed body",
      title: "Tighten build-page intro",
      description: "Replace the rambling intro with two clear sentences.",
      submittedById: "user-1",
      agentId: "AGT-1",
      routeContext: "/customer",
      threadId: "thread-1",
      observedFriction: "Users repeatedly ask what the skill is for.",
    });

    const row = state.proposals.get(proposalId);
    expect(row).toBeDefined();
    expect(row?.category).toBe("skill");
    expect(row?.targetSkillId).toBe("build-page");
    expect(row?.status).toBe("proposed");
    expect(row?.conversationExcerpt).toBe("v1 proposed body");
    expect(row?.severity).toBe("medium");
    expect((proposalId).startsWith("IP-SKL-")).toBe(true);
  });
});

describe("approveSkillImprovementProposal — atomicity", () => {
  it("writes snapshot + applied revisions and updates SkillDefinition atomically", async () => {
    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1 proposed body",
      title: "t",
      description: "d",
      submittedById: "user-1",
      agentId: "AGT-1",
      routeContext: "/r",
    });

    const result = await approveSkillImprovementProposal({
      proposalId,
      reviewerId: "reviewer-1",
    });

    expect(result.newVersion).toBe(2);

    // SkillDefinition.skillMdContent is updated to the proposed body.
    expect(state.skills.get("build-page")?.skillMdContent).toBe("v1 proposed body");

    // Two revisions exist: snapshot (v1, original body) + applied (v2, new body).
    const revisions = state.revisionRows
      .filter((r) => r.skillId === "build-page")
      .sort((a, b) => (a.version as number) - (b.version as number));
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.version).toBe(1);
    expect(revisions[0]?.content).toBe("v0 body — original");
    expect(revisions[0]?.changeReason).toBe("pre-approval snapshot");
    expect(revisions[1]?.version).toBe(2);
    expect(revisions[1]?.content).toBe("v1 proposed body");
    expect(revisions[1]?.proposalId).toBe(proposalId);

    // Proposal moves to reviewed + verifiedAt.
    const p = state.proposals.get(proposalId);
    expect(p?.status).toBe("reviewed");
    expect(p?.reviewedById).toBe("reviewer-1");
    expect(p?.verifiedAt).toBeInstanceOf(Date);
  });

  it("rolls back the whole transaction when any inner write fails", async () => {
    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1 proposed body",
      title: "t",
      description: "d",
      submittedById: "user-1",
      agentId: "AGT-1",
      routeContext: "/r",
    });

    // Fail on the second skillRevision.create (the applied revision) so the
    // snapshot is already written but the SkillDefinition update has not
    // happened. The transaction must restore the snapshot.
    state.failOnNthCreateRevision = 2;

    await expect(
      approveSkillImprovementProposal({ proposalId, reviewerId: "reviewer-1" }),
    ).rejects.toThrow(/simulated transient DB failure/);

    // SkillDefinition body must be unchanged.
    expect(state.skills.get("build-page")?.skillMdContent).toBe("v0 body — original");
    // No revisions persisted.
    expect(state.revisionRows.filter((r) => r.skillId === "build-page")).toHaveLength(0);
    // Proposal status unchanged.
    expect(state.proposals.get(proposalId)?.status).toBe("proposed");
  });

  it("refuses to approve a non-skill proposal", async () => {
    state.proposals.set("IP-OTHER-1", {
      proposalId: "IP-OTHER-1",
      category: "ux_friction",
      status: "proposed",
      targetSkillId: null,
    });
    await expect(
      approveSkillImprovementProposal({ proposalId: "IP-OTHER-1", reviewerId: "r" }),
    ).rejects.toThrow(/not category="skill"/);
  });

  it("refuses to re-approve an already-reviewed proposal", async () => {
    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1",
      title: "t",
      description: "d",
      submittedById: "u",
      agentId: "a",
      routeContext: "/r",
    });
    await approveSkillImprovementProposal({ proposalId, reviewerId: "r" });
    await expect(
      approveSkillImprovementProposal({ proposalId, reviewerId: "r" }),
    ).rejects.toThrow(/is not in status="proposed"/);
  });
});

describe("rejectSkillImprovementProposal", () => {
  it("requires a non-empty rejection reason", async () => {
    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1",
      title: "t",
      description: "d",
      submittedById: "u",
      agentId: "a",
      routeContext: "/r",
    });
    await expect(
      rejectSkillImprovementProposal({ proposalId, reviewerId: "r", rejectionReason: " " }),
    ).rejects.toThrow(/required/);
  });

  it("marks the proposal rejected with reason and creates no revision", async () => {
    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1",
      title: "t",
      description: "d",
      submittedById: "u",
      agentId: "a",
      routeContext: "/r",
    });
    await rejectSkillImprovementProposal({
      proposalId,
      reviewerId: "r",
      rejectionReason: "introduces a regression",
    });
    const p = state.proposals.get(proposalId);
    expect(p?.status).toBe("rejected");
    expect(p?.rejectionReason).toBe("introduces a regression");
    expect(state.revisionRows).toHaveLength(0);
    // SkillDefinition body unchanged.
    expect(state.skills.get("build-page")?.skillMdContent).toBe("v0 body — original");
  });
});

describe("rollbackSkillToRevision", () => {
  it("writes a NEW revision with the target content and updates SkillDefinition", async () => {
    // Seed a couple of revisions (simulate an earlier approve cycle).
    state.revisionRows.push({
      revisionId: "SREV-1",
      skillId: "build-page",
      version: 1,
      content: "v0 body — original",
      changeReason: "snapshot",
    });
    state.revisionRows.push({
      revisionId: "SREV-2",
      skillId: "build-page",
      version: 2,
      content: "v1 body",
      changeReason: "applied",
    });
    state.skills.get("build-page")!.skillMdContent = "v1 body";

    const result = await rollbackSkillToRevision({
      skillId: "build-page",
      targetVersion: 1,
      reviewerId: "reviewer-1",
    });

    expect(result.newVersion).toBe(3);
    expect(result.restoredFromVersion).toBe(1);
    expect(state.skills.get("build-page")?.skillMdContent).toBe("v0 body — original");
    const revs = state.revisionRows.filter((r) => r.skillId === "build-page");
    expect(revs).toHaveLength(3);
    expect(revs[2]?.version).toBe(3);
    expect(revs[2]?.content).toBe("v0 body — original");
    expect(revs[2]?.changeReason).toBe("rollback to v1");
  });

  it("rejects rollback to a version that does not exist", async () => {
    await expect(
      rollbackSkillToRevision({ skillId: "build-page", targetVersion: 99, reviewerId: "r" }),
    ).rejects.toThrow(/revision not found/);
  });
});

describe("listSkillRevisions / listSkillProposals", () => {
  it("returns revisions newest-first with serialised createdAt", async () => {
    state.revisionRows.push({
      revisionId: "SREV-A",
      skillId: "build-page",
      version: 1,
      content: "x",
      changeReason: "a",
      changedBy: "u",
      proposalId: null,
      createdAt: new Date("2026-05-10T00:00:00Z"),
    });
    state.revisionRows.push({
      revisionId: "SREV-B",
      skillId: "build-page",
      version: 2,
      content: "y",
      changeReason: "b",
      changedBy: "u",
      proposalId: "IP-SKL-1",
      createdAt: new Date("2026-05-11T00:00:00Z"),
    });
    const out = await listSkillRevisions("build-page");
    expect(out.map((r) => r.version)).toEqual([2, 1]);
    expect(out[0]?.proposalId).toBe("IP-SKL-1");
    expect(typeof out[0]?.createdAt).toBe("string");
  });

  it("returns proposals filtered by category=skill + targetSkillId", async () => {
    await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1",
      title: "t",
      description: "d",
      submittedById: "u",
      agentId: "a",
      routeContext: "/r",
    });
    // Add a non-skill proposal to confirm filtering.
    state.proposals.set("IP-X", {
      proposalId: "IP-X",
      category: "ux_friction",
      targetSkillId: null,
      title: "n",
      description: "n",
      severity: "low",
      submittedById: "u",
      agentId: "a",
      threadId: null,
      observedFriction: null,
      conversationExcerpt: null,
      status: "proposed",
      reviewedById: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
    });
    // The mock's findMany is generic — emulate the where filter the action passes.
    const findMany = mockPrisma.value!.improvementProposal as unknown as {
      findMany: ReturnType<typeof vi.fn>;
    };
    findMany.findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      const allRows = [...state.proposals.values()];
      return allRows.filter((r) => {
        if (args.where.category && r.category !== args.where.category) return false;
        if (args.where.targetSkillId && r.targetSkillId !== args.where.targetSkillId) return false;
        return true;
      });
    });

    const out = await listSkillProposals("build-page");
    expect(out).toHaveLength(1);
    expect(out[0]?.proposedContent).toBe("v1");
  });
});

describe("approveSkillImprovementProposal — seed propagation (BI-5798BBA3)", () => {
  it("reports propagation when the seed file was written", async () => {
    process.env.DPF_REPO_ROOT = "/repo";
    const seed = "/repo/skills/build/build-page.skill.md";
    existsSyncMock.mockImplementation((p: unknown) => {
      const n = String(p).replace(/\\/g, "/");
      return n === "/repo" || n === seed;
    });

    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1 body — proposed",
      title: "t",
      description: "d",
      submittedById: "user-1",
      agentId: "AGT-1",
      routeContext: "/r",
    });

    const result = await approveSkillImprovementProposal({
      proposalId,
      reviewerId: "reviewer-1",
    });

    expect(result.propagation.status).toBe("written");
    expect(result.propagation.path?.replace(/\\/g, "/")).toBe(seed);
    expect(writeFileSyncMock).toHaveBeenCalled();
    const [, body] = writeFileSyncMock.mock.calls[0];
    expect(body).toBe("v1 body — proposed");
    existsSyncMock.mockImplementation(() => false);
    writeFileSyncMock.mockReset();
  });

  it("still commits the approval when the seed cannot be written, and says so", async () => {
    process.env.DPF_REPO_ROOT = "/repo";
    // Repo present, but this skill has no seed file in either corpus.
    existsSyncMock.mockImplementation(
      (p: unknown) => String(p).replace(/\\/g, "/") === "/repo",
    );

    const { proposalId } = await submitSkillImprovementProposal({
      skillId: "build-page",
      proposedContent: "v1 body — proposed",
      title: "t",
      description: "d",
      submittedById: "user-1",
      agentId: "AGT-1",
      routeContext: "/r",
    });

    const result = await approveSkillImprovementProposal({
      proposalId,
      reviewerId: "reviewer-1",
    });

    // The DB half is durable regardless of the filesystem outcome.
    expect(result.newVersion).toBeGreaterThan(0);
    expect(state.skills.get("build-page")?.skillMdContent).toBe("v1 body — proposed");
    // ...and the caller is told the approval did NOT reach what ships.
    expect(result.propagation.status).toBe("no-seed-file");
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    existsSyncMock.mockImplementation(() => false);
  });
});
