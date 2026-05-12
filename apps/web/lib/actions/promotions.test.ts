import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCan, mockRevalidatePath, mockPrisma } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockPrisma: {
    $transaction: vi.fn(),
    gitPromotionCandidate: {
      findUnique: vi.fn(),
    },
    digitalProduct: {
      findUnique: vi.fn(),
    },
    changeItem: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("./change-management", () => ({
  generateRfcId: vi.fn(() => "RFC-2026-GITGATE"),
}));

import { createPromotionReviewFromGitCandidate } from "./promotions";

const session = {
  user: {
    id: "user-1",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

function verifiedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-db-1",
    candidateId: "GPC-ABC123",
    provider: "github",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    repositoryCloneUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
    branch: "main",
    beforeSha: "before-sha",
    afterSha: "abcdef1234567890",
    status: "sandbox-verification-complete",
    statusReason: null,
    sandboxProviderId: "local-docker",
    sandboxId: "sandbox-1",
    verificationStartedAt: new Date("2026-05-11T10:00:00Z"),
    verificationCompletedAt: new Date("2026-05-11T10:05:00Z"),
    verificationResult: {
      exitCode: 0,
      stdout: "typecheck passed\nnext build passed",
      durationMs: 300000,
    },
    payload: { delivery: "delivery-1" },
    createdAt: new Date("2026-05-11T09:55:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockCan.mockReturnValue(true);
  mockPrisma.digitalProduct.findUnique.mockResolvedValue({ id: "dp-odpf" });
});

describe("createPromotionReviewFromGitCandidate", () => {
  it("creates a pending ChangePromotion and RFC from a sandbox-verified candidate", async () => {
    mockPrisma.gitPromotionCandidate.findUnique.mockResolvedValue(verifiedCandidate());
    mockPrisma.changeItem.findFirst.mockResolvedValue(null);

    const tx = {
      productVersion: {
        create: vi.fn().mockResolvedValue({ id: "pv-1" }),
      },
      changePromotion: {
        create: vi.fn().mockResolvedValue({ id: "cp-1" }),
      },
      changeRequest: {
        create: vi.fn().mockResolvedValue({ id: "cr-1" }),
      },
      changeItem: {
        create: vi.fn().mockResolvedValue({ id: "ci-1" }),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (txClient: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await createPromotionReviewFromGitCandidate("GPC-ABC123");

    expect(result).toEqual({
      created: true,
      promotionId: expect.stringMatching(/^CP-/),
      rfcId: "RFC-2026-GITGATE",
    });
    expect(tx.productVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        digitalProductId: "dp-odpf",
        version: "git-gpc-abc123",
        gitTag: "git-main-abcdef123456",
        gitCommitHash: "abcdef1234567890",
        shippedBy: "user-1",
        changeSummary: expect.stringContaining("Sandbox-verified Git update"),
      }),
      select: { id: true },
    });
    expect(tx.changePromotion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productVersionId: "pv-1",
        status: "pending",
        requestedBy: "user-1",
        deploymentLog: expect.stringContaining("sandbox-1"),
      }),
      select: { id: true },
    });
    expect(tx.changeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rfcId: "RFC-2026-GITGATE",
        status: "draft",
        scope: "platform",
        impactReport: expect.objectContaining({
          source: "git-promotion-candidate",
          candidateId: "GPC-ABC123",
          sandbox: expect.objectContaining({ id: "sandbox-1" }),
          verificationResult: expect.objectContaining({ exitCode: 0 }),
        }),
      }),
      select: { id: true },
    });
    expect(tx.changeItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeRequestId: "cr-1",
        changePromotionId: "cp-1",
        itemType: "promotion",
        externalSystemRef: "git-promotion-candidate:GPC-ABC123",
        status: "pending",
      }),
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ops/promotions");
  });

  it("rejects candidates that have not completed sandbox verification", async () => {
    mockPrisma.gitPromotionCandidate.findUnique.mockResolvedValue(verifiedCandidate({ status: "queued" }));

    await expect(createPromotionReviewFromGitCandidate("GPC-ABC123")).rejects.toThrow(
      "Only sandbox-verified Git candidates can enter promotion review.",
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns the existing review instead of creating duplicates", async () => {
    mockPrisma.gitPromotionCandidate.findUnique.mockResolvedValue(verifiedCandidate());
    mockPrisma.changeItem.findFirst.mockResolvedValue({
      changePromotion: { promotionId: "CP-EXISTING" },
      changeRequest: { rfcId: "RFC-EXISTING" },
    });

    const result = await createPromotionReviewFromGitCandidate("GPC-ABC123");

    expect(result).toEqual({
      created: false,
      promotionId: "CP-EXISTING",
      rfcId: "RFC-EXISTING",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
