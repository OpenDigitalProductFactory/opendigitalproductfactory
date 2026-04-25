import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    featureBuild: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

import { approveBuildStart, advanceBuildPhase } from "./build";

describe("governed build start approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockPrisma.buildActivity.create.mockResolvedValue({});
  });

  it("approveBuildStart stamps draftApprovedAt for governed backlog drafts", async () => {
    const buildRow = {
      createdById: "user-1",
      phase: "ideate",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: null,
    };

    mockPrisma.featureBuild.findUnique.mockResolvedValue(buildRow);
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    const result = await approveBuildStart("FB-123");

    expect(result.approvedAt).toBeInstanceOf(Date);
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({
          draftApprovedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("advanceBuildPhase blocks ideate to plan when governed drafts are not approved", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "ideate",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: null,
      designDoc: null,
      designReview: null,
      plan: null,
      brief: null,
      buildPlan: null,
      planReview: null,
      taskResults: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });

    await expect(advanceBuildPhase("FB-123", "plan")).rejects.toThrow(
      "Approve Start before moving this governed backlog draft into planning.",
    );
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });
});
