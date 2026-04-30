import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveBuildArtifactRevision } from "./build-artifact-provenance";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
    artifactReceiptUsage: {
      createMany: vi.fn(),
    },
    buildArtifactRevision: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    featureBuild: {
      update: vi.fn(),
    },
    toolExecutionReceipt: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({
  Prisma: {},
  prisma: mockPrisma,
}));

describe("saveBuildArtifactRevision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (db: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma),
    );
    mockPrisma.artifactReceiptUsage.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.buildArtifactRevision.create.mockResolvedValue({
      id: "rev-3",
      revisionNumber: 3,
      status: "accepted",
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockPrisma.toolExecutionReceipt.findMany.mockResolvedValue([
      {
        id: "receipt-1",
        buildId: "FB-1",
        executionStatus: "succeeded",
        receiptKind: "sandbox-test-run",
      },
    ]);
  });

  it("persists a verification revision with inferred receipts", async () => {
    mockPrisma.buildArtifactRevision.findFirst.mockImplementation(async (args: { where?: { field?: string; status?: string } }) => {
      if (args.where?.status === "accepted") {
        return null;
      }
      return { revisionNumber: 2 };
    });

    const result = await saveBuildArtifactRevision({
      buildId: "FB-1",
      field: "verificationOut",
      savedByUserId: "user-1",
      value: { testsFailed: 0, testsPassed: 4, typecheckPassed: true },
    });

    expect(mockPrisma.buildArtifactRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-1",
          field: "verificationOut",
          revisionNumber: 3,
          savedByUserId: "user-1",
          status: "accepted",
        }),
      }),
    );
    expect(mockPrisma.artifactReceiptUsage.createMany).toHaveBeenCalledWith({
      data: [{ artifactRevisionId: "rev-3", receiptId: "receipt-1" }],
      skipDuplicates: true,
    });
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-1" },
      data: {
        verificationOut: { testsFailed: 0, testsPassed: 4, typecheckPassed: true },
      },
    });
    expect(result.receiptIds).toEqual(["receipt-1"]);
    expect(result.status).toBe("accepted");
  });

  it("fails in enforce mode when acceptanceMet has no accepted verification revision", async () => {
    mockPrisma.buildArtifactRevision.findFirst.mockResolvedValue(null);

    await expect(
      saveBuildArtifactRevision({
        buildId: "FB-2",
        enforcementMode: "enforce",
        field: "acceptanceMet",
        savedByUserId: "user-1",
        value: [{ criterion: "Header remains visible", met: true }],
      }),
    ).rejects.toThrow(
      "acceptanceMet requires an accepted verificationOut artifact",
    );

    expect(mockPrisma.buildArtifactRevision.create).not.toHaveBeenCalled();
    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalled();
  });
});
