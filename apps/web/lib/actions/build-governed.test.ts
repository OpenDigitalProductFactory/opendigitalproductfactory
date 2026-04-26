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

const { mockIsSandboxAvailable, mockStartBuildBranch } = vi.hoisted(() => ({
  mockIsSandboxAvailable: vi.fn(),
  mockStartBuildBranch: vi.fn(),
}));

const { mockQueueBuildReviewVerification } = vi.hoisted(() => ({
  mockQueueBuildReviewVerification: vi.fn(),
}));

const { mockListReleasableSandboxFiles } = vi.hoisted(() => ({
  mockListReleasableSandboxFiles: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/integrate/sandbox/build-branch", () => ({
  isSandboxAvailable: mockIsSandboxAvailable,
  startBuildBranch: mockStartBuildBranch,
}));

vi.mock("@/lib/build-review-verification-trigger", () => ({
  queueBuildReviewVerification: mockQueueBuildReviewVerification,
}));

vi.mock("@/lib/integrate/sandbox/sandbox", () => ({
  listReleasableSandboxFiles: mockListReleasableSandboxFiles,
}));

import { approveBuildStart, advanceBuildPhase, recordBuildAcceptance, resumeBuildImplementation, runBuildReviewVerification } from "./build";

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
    mockIsSandboxAvailable.mockResolvedValue(false);
    mockStartBuildBranch.mockResolvedValue(undefined);
    mockQueueBuildReviewVerification.mockResolvedValue(undefined);
    mockListReleasableSandboxFiles.mockResolvedValue(["apps/web/components/build/BuildStudio.tsx"]);
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

  it("resumeBuildImplementation reopens review builds with flagged task results", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "review",
      taskResultsVersion: 2,
      threadId: null,
      taskResults: {
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { title: "Layout fix", specialist: "frontend-engineer", outcome: "DONE_WITH_CONCERNS" },
          { title: "Verification", specialist: "qa-engineer", outcome: "DONE_WITH_CONCERNS" },
        ],
      },
      verificationOut: {
        typecheckPassed: false,
        testsPassed: 0,
        testsFailed: 1,
      },
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await resumeBuildImplementation("FB-123");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({
          phase: "build",
          verificationOut: null,
          taskResultsVersion: { increment: 1 },
          taskResults: expect.objectContaining({
            completedTasks: 0,
            tasks: [
              expect.objectContaining({ title: "Layout fix", outcome: "BLOCKED" }),
              expect.objectContaining({ title: "Verification", outcome: "BLOCKED" }),
            ],
          }),
        }),
      }),
    );
  });

  it("resumeBuildImplementation prepares a clean sandbox branch when the sandbox is available", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "build",
      taskResultsVersion: 4,
      threadId: null,
      taskResults: {
        completedTasks: 3,
        totalTasks: 6,
        tasks: [
          { title: "Layout fix", specialist: "frontend-engineer", outcome: "DONE" },
          { title: "Panel normalization", specialist: "frontend-engineer", outcome: "BLOCKED" },
        ],
      },
      verificationOut: null,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockIsSandboxAvailable.mockResolvedValue(true);

    await resumeBuildImplementation("FB-456");

    expect(mockIsSandboxAvailable).toHaveBeenCalledTimes(1);
    expect(mockStartBuildBranch).toHaveBeenCalledWith("FB-456");
  });

  it("resumeBuildImplementation reopens ship builds when release preparation found no releasable source diff", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "ship",
      sandboxId: "dpf-sandbox-1",
      diffPatch: null,
      diffSummary: null,
      taskResultsVersion: 5,
      threadId: null,
      taskResults: {
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { title: "Stabilize workflow shell", specialist: "frontend-engineer", outcome: "DONE" },
          { title: "Run verification", specialist: "qa-engineer", outcome: "DONE" },
        ],
      },
      verificationOut: {
        typecheckPassed: true,
        testsPassed: 2,
        testsFailed: 0,
      },
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockIsSandboxAvailable.mockResolvedValue(true);
    mockListReleasableSandboxFiles.mockResolvedValue([]);

    await resumeBuildImplementation("FB-789");

    expect(mockListReleasableSandboxFiles).toHaveBeenCalledWith("dpf-sandbox-1");
    expect(mockStartBuildBranch).toHaveBeenCalledWith("FB-789");
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-789" },
        data: expect.objectContaining({
          phase: "build",
          diffPatch: null,
          diffSummary: null,
          verificationOut: null,
          taskResultsVersion: { increment: 1 },
          taskResults: expect.objectContaining({
            completedTasks: 0,
            tasks: [
              expect.objectContaining({ title: "Stabilize workflow shell", outcome: "BLOCKED" }),
              expect.objectContaining({ title: "Run verification", outcome: "BLOCKED" }),
            ],
          }),
        }),
      }),
    );
  });

  it("advanceBuildPhase enqueues UX verification when moving into review", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-1",
      phase: "build",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Fix overlap" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: null,
      brief: { acceptanceCriteria: ["Header does not overlap content."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix overlap" }],
        tasks: [{ title: "Fix overlap", testFirst: "Reproduce", implement: "Patch layout", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ok", issues: [] },
      taskResults: { completedTasks: 1, totalTasks: 1, tasks: [{ title: "Fix overlap", outcome: "DONE" }] },
      verificationOut: { typecheckPassed: true, testsFailed: 0, testsPassed: 0 },
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
      threadId: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await advanceBuildPhase("FB-123", "review");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "review" }),
      }),
    );
    expect(mockQueueBuildReviewVerification).toHaveBeenCalledWith("FB-123");
  });

  it("runBuildReviewVerification resets UX evidence and enqueues a fresh review pass", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "review",
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await runBuildReviewVerification("FB-789");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-789" },
        data: expect.objectContaining({
          uxVerificationStatus: null,
          uxTestResults: null,
        }),
      }),
    );
    expect(mockQueueBuildReviewVerification).toHaveBeenCalledWith("FB-789");
  });

  it("recordBuildAcceptance persists met acceptance evidence once review checks are complete", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      createdById: "user-1",
      phase: "review",
      brief: {
        acceptanceCriteria: [
          "The workflow header no longer overlaps content.",
          "The operator can continue from review into release.",
        ],
      },
      designDoc: null,
      verificationOut: {
        typecheckPassed: true,
        testsPassed: 1,
        testsFailed: 7,
      },
      uxVerificationStatus: "complete",
      uxTestResults: [
        { step: "Header remains visible", passed: true },
        { step: "Continue action stays in view", passed: true },
      ],
    });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    await recordBuildAcceptance("FB-321");

    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-321" },
        data: expect.objectContaining({
          acceptanceMet: [
            expect.objectContaining({
              criterion: "The workflow header no longer overlaps content.",
              met: true,
            }),
            expect.objectContaining({
              criterion: "The operator can continue from review into release.",
              met: true,
            }),
          ],
        }),
      }),
    );
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-321",
          tool: "record_acceptance",
        }),
      }),
    );
  });

  it("advanceBuildPhase blocks review to ship when the sandbox has no releasable source diff", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "build-row-ship-1",
      phase: "review",
      createdById: "user-1",
      originatingBacklogItemId: "backlog-row-1",
      draftApprovedAt: new Date("2026-04-25T13:00:00Z"),
      designDoc: { problemStatement: "Fix overlap" },
      designReview: { decision: "pass", summary: "ok", issues: [] },
      plan: null,
      brief: { acceptanceCriteria: ["Header does not overlap content."] },
      buildPlan: {
        fileStructure: [{ path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Fix overlap" }],
        tasks: [{ title: "Fix overlap", testFirst: "Reproduce", implement: "Patch layout", verify: "Run checks" }],
      },
      planReview: { decision: "pass", summary: "ok", issues: [] },
      taskResults: { completedTasks: 1, totalTasks: 1, tasks: [{ title: "Fix overlap", outcome: "DONE" }] },
      verificationOut: { typecheckPassed: true, testsFailed: 0, testsPassed: 4 },
      acceptanceMet: [{ criterion: "Header does not overlap content.", met: true }],
      uxTestResults: [{ step: "Header remains visible", passed: true }],
      uxVerificationStatus: "complete",
      sandboxId: "dpf-sandbox-1",
      threadId: null,
    });
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true,
    });
    mockListReleasableSandboxFiles.mockResolvedValue([]);

    await expect(advanceBuildPhase("FB-123", "ship")).rejects.toThrow(
      "No releasable source changes are present in the sandbox. Resume implementation and make a real code change before continuing to release.",
    );

    expect(mockPrisma.featureBuild.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-123" },
        data: expect.objectContaining({ phase: "ship" }),
      }),
    );
  });
});
