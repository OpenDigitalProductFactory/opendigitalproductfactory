import { beforeEach, describe, expect, it, vi } from "vitest";

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
    workCapsule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
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

describe("getWorkControlData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-100", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockPrisma.workCapsule.findMany.mockResolvedValue([]);
    mockScanGitWorktrees.mockResolvedValue([]);
    mockGetWorktreeDirtySummary.mockResolvedValue({ modifiedCount: 0, untrackedCount: 0 });
  });

  it("rejects unauthorized callers", async () => {
    mockCan.mockReturnValue(false);

    const { getWorkControlData } = await import("./work-capsules");

    await expect(getWorkControlData()).rejects.toThrow(/unauthorized/i);
  });

  it("filters scanner output by already-adopted branches", async () => {
    mockPrisma.workCapsule.findMany.mockResolvedValue([
      {
        capsuleId: "WC-1",
        title: "Already adopted",
        status: "working",
        source: "external-adoption",
        executorKind: null,
        headBranch: "feat/already-adopted",
        worktreePath: "D:/DPF-adopted",
        pullRequestUrl: null,
        leaseExpiresAt: null,
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
      expect.objectContaining({ capsuleId: "WC-1", branch: "feat/already-adopted" }),
    ]);
    expect(data.adoptable).toEqual([
      expect.objectContaining({
        branch: "fix/orphan",
        modifiedCount: 3,
        untrackedCount: 1,
      }),
    ]);
    expect(mockGetWorktreeDirtySummary).toHaveBeenCalledWith("D:/DPF-orphan");
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
    mockPrisma.workCapsule.findUnique.mockResolvedValue({
      capsuleId: "WC-DETAIL",
      title: "Detail",
      activities: [],
    });

    const { getCapsuleDetail } = await import("./work-capsules");
    const result = await getCapsuleDetail("WC-DETAIL");

    expect(result).toEqual(expect.objectContaining({ capsuleId: "WC-DETAIL" }));
    expect(mockPrisma.workCapsule.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-DETAIL" },
    }));
  });
});
