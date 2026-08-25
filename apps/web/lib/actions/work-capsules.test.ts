import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockCan,
  mockCreateWorkCapsule,
  mockGetWorktreeDirtySummary,
  mockListLocalBranches,
  mockPlanCapsuleWorkspace,
  mockPrisma,
  mockScanGitWorktrees,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockCreateWorkCapsule: vi.fn(),
  mockGetWorktreeDirtySummary: vi.fn(),
  mockListLocalBranches: vi.fn(),
  mockPlanCapsuleWorkspace: vi.fn(),
  mockPrisma: {
    workroom: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    featureBuild: { findMany: vi.fn() },
  },
  mockScanGitWorktrees: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/work-capsules/git-scanner", () => ({
  getWorktreeDirtySummary: mockGetWorktreeDirtySummary,
  listLocalBranches: mockListLocalBranches,
  scanGitWorktrees: mockScanGitWorktrees,
}));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({
  createWorkCapsule: mockCreateWorkCapsule,
  planCapsuleWorkspace: mockPlanCapsuleWorkspace,
}));

afterEach(() => {
  delete process.env.DPF_WORK_CONTROL_REPO_ROOT;
});

describe("getWorkControlData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DPF_WORK_CONTROL_REPO_ROOT;
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-100", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockPrisma.workroom.findMany.mockResolvedValue([]);
    mockPrisma.featureBuild.findMany.mockResolvedValue([]);
    mockScanGitWorktrees.mockResolvedValue([]);
    mockGetWorktreeDirtySummary.mockResolvedValue({ modifiedCount: 0, untrackedCount: 0 });
  });

  it("rejects unauthorized callers", async () => {
    mockCan.mockReturnValue(false);

    const { getWorkControlData } = await import("./work-capsules");

    await expect(getWorkControlData()).rejects.toThrow(/unauthorized/i);
  });

  it("filters scanner output by already-adopted branches", async () => {
    mockPrisma.workroom.findMany.mockResolvedValue([
      {
        capsuleId: "WC-1",
        title: "Already adopted",
        status: "working",
        source: "external-adoption",
        executorKind: null,
        decisionScope: "wwmd",
        portfolioRole: "manufactureAndDeliver",
        servedPersona: "platform-team",
        activityKind: "improvement",
        outcomeAnchor: { kind: "backlog-item", id: "BI-1" },
        servesPortfolioRoles: ["manufactureAndDeliver"],
        dependsOnPortfolioRoles: ["foundational"],
        headBranch: "feat/already-adopted",
        worktreePath: "D:/DPF-adopted",
        pullRequestUrl: null,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        lastSyncedAt: null,
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
    ]);
    mockScanGitWorktrees.mockResolvedValue([
      { path: "D:/DPF-adopted", branch: "feat/already-adopted", headSha: "h1" },
      { path: "D:/DPF-orphan", branch: "fix/orphan", headSha: "h2" },
    ]);
    mockGetWorktreeDirtySummary.mockResolvedValue({ modifiedCount: 3, untrackedCount: 1 });

    const { getWorkControlData } = await import("./work-capsules");
    const data = await getWorkControlData();

    expect(data.capsules).toEqual([
      expect.objectContaining({
        capsuleId: "WC-1",
        branch: "feat/already-adopted",
        scope: expect.objectContaining({
          decisionScopeLabel: "WWMD",
          portfolioRoleLabel: "Manufacture & Deliver",
        }),
      }),
    ]);
    expect(data.adoptable).toEqual([
      expect.objectContaining({
        branch: "fix/orphan",
        modifiedCount: 3,
        untrackedCount: 1,
      }),
    ]);
    expect(mockGetWorktreeDirtySummary).toHaveBeenCalledWith("D:/DPF-orphan");
    expect(mockPrisma.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.any(Array),
      }),
      select: expect.objectContaining({
        decisionScope: true,
        portfolioRole: true,
        servedPersona: true,
        activityKind: true,
        outcomeAnchor: true,
        servesPortfolioRoles: true,
        dependsOnPortfolioRoles: true,
      }),
    }));
  });

  it("returns only truly live development workrooms and a truthful summary", async () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    mockPrisma.workroom.findMany.mockResolvedValue([
      {
        capsuleId: "WC-LIVE", title: "Live branch", status: "working", source: "external-adoption",
        executorKind: "codex-desktop", decisionScope: null, portfolioRole: "foundational",
        servedPersona: null, activityKind: "improvement", outcomeAnchor: {}, servesPortfolioRoles: [],
        dependsOnPortfolioRoles: [], headBranch: "feat/live", worktreePath: "D:/live",
        pullRequestUrl: null, pullRequestNumber: null, leaseExpiresAt: future, lastSyncedAt: null,
        updatedAt: new Date(), featureBuildId: null,
      },
      {
        capsuleId: "WC-DEAD", title: "Expired branch", status: "working", source: "external-adoption",
        executorKind: "codex-desktop", decisionScope: null, portfolioRole: "foundational",
        servedPersona: null, activityKind: "improvement", outcomeAnchor: {}, servesPortfolioRoles: [],
        dependsOnPortfolioRoles: [], headBranch: "feat/dead", worktreePath: "D:/dead",
        pullRequestUrl: null, pullRequestNumber: null, leaseExpiresAt: past, lastSyncedAt: null,
        updatedAt: new Date(), featureBuildId: null,
      },
    ]);

    const { getWorkControlData } = await import("./work-capsules");
    const data = await getWorkControlData();

    expect(data.capsules.map((row) => row.capsuleId)).toEqual(["WC-LIVE"]);
    expect(data.livenessSummary).toEqual(expect.objectContaining({ scanned: 2, live: 1, reapable: 1 }));
  });

  it("does not present the release main worktree as adoptable work", async () => {
    mockScanGitWorktrees.mockResolvedValue([
      { path: "D:/DPF", branch: "main", headSha: "main-sha" },
      { path: "D:/DPF-feature", branch: "feat/real-work", headSha: "feature-sha" },
    ]);

    const { getWorkControlData } = await import("./work-capsules");
    const data = await getWorkControlData();

    expect(data.adoptable).toEqual([
      expect.objectContaining({ path: "D:/DPF-feature", branch: "feat/real-work" }),
    ]);
    expect(mockGetWorktreeDirtySummary).not.toHaveBeenCalledWith("D:/DPF");
  });

  it("uses the route-sweep work-control fixture instead of the ambient checkout", async () => {
    process.env.DPF_WORK_CONTROL_REPO_ROOT = "D:/ux-sweep-fixture";

    const { getWorkControlData } = await import("./work-capsules");
    await getWorkControlData();

    expect(mockScanGitWorktrees).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]ux-sweep-fixture$/),
    );
  });
});

describe("createGovernedWorkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-100", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockListLocalBranches.mockResolvedValue(new Set<string>());
    mockCreateWorkCapsule.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-CREATED",
      title: "x",
    });
    mockPlanCapsuleWorkspace.mockResolvedValue({
      capsuleId: "WC-CREATED",
      headBranch: "feat/x",
      worktreePath: "D:\\DPF-x",
    });
  });

  it("rejects an unauthorized caller via the write capability gate", async () => {
    mockCan.mockReturnValue(false);
    const { createGovernedWorkAction } = await import("./work-capsules");

    await expect(
      createGovernedWorkAction({ title: "x", objective: "y", taxonomy: "feat", idempotencyKey: "k" }),
    ).rejects.toThrow(/unauthorized/i);
    expect(mockCan).toHaveBeenCalledWith(expect.objectContaining({ platformRole: "HR-100" }), "manage_backlog");
  });

  it("rejects an invalid taxonomy", async () => {
    const { createGovernedWorkAction } = await import("./work-capsules");

    await expect(
      createGovernedWorkAction({ title: "x", objective: "y", taxonomy: "wat" as any, idempotencyKey: "k" }),
    ).rejects.toThrow(/taxonomy/i);
  });

  it("creates the capsule then plans the workspace and returns both", async () => {
    const { createGovernedWorkAction } = await import("./work-capsules");
    const result = await createGovernedWorkAction({
      title: "Provider routing tool capability",
      objective: "Phase 2 verification",
      taxonomy: "feat",
      idempotencyKey: "stable-key-1",
    });

    expect(result.capsuleId).toBe("WC-CREATED");
    expect(result.headBranch).toBe("feat/x");
    expect(mockCreateWorkCapsule).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ idempotencyKey: "stable-key-1" }),
    }));
    expect(mockPlanCapsuleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-CREATED",
      taxonomy: "feat",
    }));
  });
});

describe("getCapsuleDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-100", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
  });

  it("loads a capsule and recent activity for the detail route", async () => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
      capsuleId: "WC-DETAIL",
      title: "Detail",
      activities: [],
    });

    const { getCapsuleDetail } = await import("./work-capsules");
    const result = await getCapsuleDetail("WC-DETAIL");

    expect(result).toEqual(expect.objectContaining({ capsuleId: "WC-DETAIL" }));
    expect(mockPrisma.workroom.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-DETAIL" },
    }));
  });
});
