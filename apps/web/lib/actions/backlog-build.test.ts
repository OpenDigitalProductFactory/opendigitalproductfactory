import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma, mockPromote } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    backlogItem: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockPromote: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/governed-backlog-tee-up", () => ({
  promoteBacklogItemToBuildDraft: mockPromote,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { startBacklogBuild } from "@/lib/actions/backlog-build";

describe("startBacklogBuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
  });

  it("promotes the semantic backlog item id through the governed Build Studio helper", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-123",
      activeBuild: null,
    });
    mockPromote.mockResolvedValue({
      kind: "success",
      build: { id: "feature-build-row-1", buildId: "FB-12345678" },
      backlogItemId: "BI-123",
    });

    await expect(startBacklogBuild("BI-123")).resolves.toEqual({
      status: "created",
      buildId: "FB-12345678",
      href: "/build?buildId=FB-12345678",
    });

    expect(mockPromote).toHaveBeenCalledWith({
      tx: mockPrisma,
      itemId: "BI-123",
      userId: "user-1",
      governedBacklogEnabled: true,
      activity: {
        tool: "backlog_row_start_build",
        summary: "Build Studio draft created from backlog row BI-123.",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/ops");
    expect(revalidatePath).toHaveBeenCalledWith("/build");
  });

  it("opens the existing active build instead of creating a duplicate draft", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-123",
      activeBuild: { buildId: "FB-EXISTING", phase: "plan" },
    });

    await expect(startBacklogBuild("BI-123")).resolves.toEqual({
      status: "existing",
      buildId: "FB-EXISTING",
      href: "/build?buildId=FB-EXISTING",
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPromote).not.toHaveBeenCalled();
    // A live build must never have its link cleared.
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });

  // BI-08AE51DC: a terminal (complete/failed/abandoned) activeBuild previously
  // wedged the item — Start-build routed to the corpse forever. It must instead
  // detach the stale 1:1 link and create a fresh draft.
  it("re-promotes a fresh draft when the active build is terminal/abandoned", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-123",
      activeBuild: { buildId: "FB-ABANDONED", phase: "abandoned" },
    });
    mockPrisma.backlogItem.update.mockResolvedValue({});
    mockPromote.mockResolvedValue({
      kind: "success",
      build: { id: "row-2", buildId: "FB-NEW" },
      backlogItemId: "BI-123",
    });

    await expect(startBacklogBuild("BI-123")).resolves.toEqual({
      status: "created",
      buildId: "FB-NEW",
      href: "/build?buildId=FB-NEW",
    });

    // The stale terminal link is cleared inside the promote transaction, before
    // promote (which refuses when activeBuildId is set) runs.
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith({
      where: { itemId: "BI-123" },
      data: { activeBuildId: null },
    });
    expect(mockPromote).toHaveBeenCalled();
  });

  it("treats a completed build as re-promotable too", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-123",
      activeBuild: { buildId: "FB-DONE", phase: "complete" },
    });
    mockPrisma.backlogItem.update.mockResolvedValue({});
    mockPromote.mockResolvedValue({
      kind: "success",
      build: { id: "row-3", buildId: "FB-FRESH" },
      backlogItemId: "BI-123",
    });

    const res = await startBacklogBuild("BI-123");
    expect(res.status).toBe("created");
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith({
      where: { itemId: "BI-123" },
      data: { activeBuildId: null },
    });
  });
});
