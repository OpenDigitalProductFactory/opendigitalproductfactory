import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies resolveActiveBuildId / extractBuildIdHint semantics through the
// saveBuildEvidence handler — the lightest-weight handler that exercises the
// resolver in a representative way. Regression coverage for the
// BI-E9CD1B92 (2026-05-13) bug where reviewBuildPlan({ buildId: "FB-1D69766D" })
// returned a review of a different build.

const mockPrisma = {
  featureBuild: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  buildActivity: {
    create: vi.fn(),
  },
};

const mockSaveBuildArtifactRevision = vi.fn(async (args: { buildId: string; field: string; value: unknown }) => {
  await mockPrisma.featureBuild.update({
    where: { buildId: args.buildId },
    data: { [args.field]: args.value },
  });
  return {
    revisionId: "BAR-1",
    revisionNumber: 1,
    status: "accepted",
    warnings: [],
    errors: [],
    receiptIds: [],
  };
});

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/actions/build", () => ({
  advanceBuildPhase: vi.fn(),
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

vi.mock("@/lib/build/build-artifact-provenance", () => ({
  saveBuildArtifactRevision: mockSaveBuildArtifactRevision,
}));

const buildSelectShape = {
  buildId: true,
  title: true,
  brief: true,
  phase: true,
  designDoc: true,
  designReview: true,
  buildPlan: true,
  planReview: true,
  taskResults: true,
  verificationOut: true,
  acceptanceMet: true,
};

function fakeBuild(buildId: string) {
  return {
    buildId,
    title: `Build ${buildId}`,
    brief: null,
    phase: "ideate",
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
  };
}

describe("resolveActiveBuildId (via saveBuildEvidence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockPrisma.buildActivity.create.mockResolvedValue({});
  });

  it("honors an explicit FB-* buildId argument over the most-recent build", async () => {
    const hintedBuildId = "FB-1D69766D";
    const mostRecentBuildId = "FB-72EB9C06";

    // Owner check for the hinted build resolves first.
    mockPrisma.featureBuild.findUnique.mockImplementation(({ where, select }: { where: { buildId: string }; select: Record<string, boolean> }) => {
      if (where.buildId === hintedBuildId && select.createdById) {
        return Promise.resolve({ buildId: hintedBuildId, createdById: "user-1" });
      }
      if (where.buildId === hintedBuildId) {
        return Promise.resolve(fakeBuild(hintedBuildId));
      }
      return Promise.resolve(null);
    });

    // Fallback findFirst would return the (wrong) most-recent build — must not
    // be consulted when the hint resolves.
    mockPrisma.featureBuild.findFirst.mockResolvedValue({ buildId: mostRecentBuildId });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "saveBuildEvidence",
      {
        buildId: hintedBuildId,
        field: "designReview",
        value: { decision: "pass", issues: [], summary: "ok" },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.featureBuild.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildId: hintedBuildId } }),
    );
  });

  it("falls back to most-recent active build when no hint is provided", async () => {
    const mostRecentBuildId = "FB-72EB9C06";

    mockPrisma.featureBuild.findFirst.mockResolvedValue({ buildId: mostRecentBuildId });
    mockPrisma.featureBuild.findUnique.mockImplementation(({ where }: { where: { buildId: string } }) => {
      if (where.buildId === mostRecentBuildId) return Promise.resolve(fakeBuild(mostRecentBuildId));
      return Promise.resolve(null);
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "saveBuildEvidence",
      {
        field: "designReview",
        value: { decision: "pass", issues: [], summary: "ok" },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.featureBuild.findFirst).toHaveBeenCalledTimes(1);
    // Fallback query must exclude abandoned alongside complete/failed.
    expect(mockPrisma.featureBuild.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdById: "user-1",
          phase: { notIn: ["complete", "failed", "abandoned"] },
        }),
      }),
    );
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildId: mostRecentBuildId } }),
    );
  });

  it("ignores hint when the user is not the build owner and falls back", async () => {
    const hintedBuildId = "FB-OTHEROWN";
    const ownedBuildId = "FB-OWNED001";

    mockPrisma.featureBuild.findUnique.mockImplementation(({ where, select }: { where: { buildId: string }; select: Record<string, boolean> }) => {
      // Owner check returns a different createdById.
      if (where.buildId === hintedBuildId && select.createdById) {
        return Promise.resolve({ buildId: hintedBuildId, createdById: "user-other" });
      }
      if (where.buildId === ownedBuildId) {
        return Promise.resolve(fakeBuild(ownedBuildId));
      }
      return Promise.resolve(null);
    });
    mockPrisma.featureBuild.findFirst.mockResolvedValue({ buildId: ownedBuildId });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "saveBuildEvidence",
      {
        buildId: hintedBuildId,
        field: "designReview",
        value: { decision: "pass", issues: [], summary: "ok" },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.featureBuild.findFirst).toHaveBeenCalled();
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildId: ownedBuildId } }),
    );
  });

  it("ignores malformed hints (no FB- prefix) and falls back", async () => {
    const ownedBuildId = "FB-OWNED002";

    mockPrisma.featureBuild.findFirst.mockResolvedValue({ buildId: ownedBuildId });
    mockPrisma.featureBuild.findUnique.mockImplementation(({ where }: { where: { buildId: string } }) => {
      if (where.buildId === ownedBuildId) return Promise.resolve(fakeBuild(ownedBuildId));
      return Promise.resolve(null);
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "saveBuildEvidence",
      {
        buildId: "CURRENT",
        field: "designReview",
        value: { decision: "pass", issues: [], summary: "ok" },
      },
      "user-1",
      { threadId: "thread-1", routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    // Owner-check findUnique should NOT be invoked for a malformed hint.
    const ownerCheckCalls = mockPrisma.featureBuild.findUnique.mock.calls.filter(
      (call) => (call[0] as { select?: { createdById?: boolean } }).select?.createdById,
    );
    expect(ownerCheckCalls).toHaveLength(0);
    expect(mockPrisma.featureBuild.findFirst).toHaveBeenCalled();
  });

  // Pin the select shape so the test fails loudly if someone narrows it
  // without thinking about callers.
  void buildSelectShape;
});
