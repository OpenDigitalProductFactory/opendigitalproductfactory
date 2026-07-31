import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  capsuleFindFirst: vi.fn(),
  evidenceFindMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    workCapsule: { findFirst: (...args: unknown[]) => db.capsuleFindFirst(...args) },
    externalEvidenceRecord: { findMany: (...args: unknown[]) => db.evidenceFindMany(...args) },
  },
}));

const recordExternalEvidence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence }));
const recordWorkCapsuleEvidence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence }));
const dispatchRoutedSemanticReview = vi.hoisted(() => vi.fn());
vi.mock("./routed-semantic-review", () => ({ dispatchRoutedSemanticReview }));

import { reviewBuildStudioAssembledChange } from "./build-studio-semantic-review";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DPF_SEMANTIC_CHANGE_REVIEW_MODE;
  db.capsuleFindFirst.mockResolvedValue({ id: "capsule-row", capsuleId: "WC-BUILD" });
  db.evidenceFindMany.mockResolvedValue([]);
  recordExternalEvidence.mockResolvedValue({ id: "evidence-1" });
  recordWorkCapsuleEvidence.mockResolvedValue({ id: "activity-1" });
  dispatchRoutedSemanticReview.mockResolvedValue({ decision: "pass", issues: [], summary: "Pass." });
});

describe("Build Studio assembled semantic review", () => {
  it("reviews and records the same receipt before verification", async () => {
    const result = await reviewBuildStudioAssembledChange({
      build: {
        id: "build-row",
        buildId: "FB-1",
        title: "Assembled change",
        createdById: "user-1",
        diffPatch: "diff --git a/apps/web/lib/a.ts b/apps/web/lib/a.ts",
        verificationOut: { testsPassed: 1, testsFailed: 0 },
      },
      sandboxState: {
        source: "sandbox-git",
        branch: "build/FB-1",
        headSha: "head",
        headAgeLabel: "now",
        commitsAhead: 1,
        sourceDiffstat: [{ path: "apps/web/lib/a.ts", additions: 1, deletions: 0 }],
        ignoredDiffstat: [],
        expectedPlanFiles: [],
        observedAt: new Date().toISOString(),
        unavailableReason: null,
        sourceCurrency: {
          source: "sandbox-git",
          status: "ahead",
          recommendedAction: "allow",
          workspace: "/workspace",
          branch: "build/FB-1",
          headSha: "head",
          headTreeSha: "b".repeat(40),
          targetRef: "origin/main",
          targetSha: "base",
          targetTreeSha: "a".repeat(40),
          mergeBaseSha: "base",
          aheadBy: 1,
          behindBy: 0,
          dirty: false,
          localSourceChangeCount: 1,
          checkedAt: new Date().toISOString(),
          reason: null,
        },
      },
    });

    expect(result.kind).toBe("reviewed");
    expect(dispatchRoutedSemanticReview).toHaveBeenCalledOnce();
    const externalReceipt = recordExternalEvidence.mock.calls[0]![0].details;
    const activityReceipt = recordWorkCapsuleEvidence.mock.calls[0]![0].evidence.result;
    expect(activityReceipt).toEqual(externalReceipt);
  });

  it("does not block an older build missing a stable tree while policy is shadow-only", async () => {
    const result = await reviewBuildStudioAssembledChange({
      build: {
        id: "build-row",
        buildId: "FB-OLD",
        title: "Old build",
        createdById: "user-1",
        diffPatch: null,
        verificationOut: null,
      },
      sandboxState: null,
    });

    expect(result).toMatchObject({ kind: "unavailable", mayContinue: true });
    expect(dispatchRoutedSemanticReview).not.toHaveBeenCalled();
  });
});
