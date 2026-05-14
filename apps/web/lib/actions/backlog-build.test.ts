import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma, mockPromote } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    backlogItem: {
      findUnique: vi.fn(),
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
  });
});
