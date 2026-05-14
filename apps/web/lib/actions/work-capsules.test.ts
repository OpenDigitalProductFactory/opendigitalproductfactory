import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockCan,
  mockGetWorktreeDirtySummary,
  mockPrisma,
  mockScanGitWorktrees,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockGetWorktreeDirtySummary: vi.fn(),
  mockPrisma: {
    workCapsule: {
      findMany: vi.fn(),
    },
  },
  mockScanGitWorktrees: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/work-capsules/git-scanner", () => ({
  getWorktreeDirtySummary: mockGetWorktreeDirtySummary,
  scanGitWorktrees: mockScanGitWorktrees,
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
