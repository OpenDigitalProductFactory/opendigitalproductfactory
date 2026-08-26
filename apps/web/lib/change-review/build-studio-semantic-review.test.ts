import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  capsuleFindFirst: vi.fn(),
  evidenceFindMany: vi.fn(),
  evidenceFindUnique: vi.fn(),
  taskRunFindMany: vi.fn(),
  taskRunFindUnique: vi.fn(),
  taskRunCreate: vi.fn(),
  taskRunUpdate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    workroom: { findFirst: (...args: unknown[]) => db.capsuleFindFirst(...args) },
    externalEvidenceRecord: {
      findMany: (...args: unknown[]) => db.evidenceFindMany(...args),
      findUnique: (...args: unknown[]) => db.evidenceFindUnique(...args),
    },
    taskRun: {
      findMany: (...args: unknown[]) => db.taskRunFindMany(...args),
      findUnique: (...args: unknown[]) => db.taskRunFindUnique(...args),
      create: (...args: unknown[]) => db.taskRunCreate(...args),
      update: (...args: unknown[]) => db.taskRunUpdate(...args),
    },
  },
}));

const recordExternalEvidence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence }));
const recordWorkCapsuleEvidence = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence }));
const dispatchRoutedSemanticReview = vi.hoisted(() => vi.fn());
vi.mock("./routed-semantic-review", () => ({ dispatchRoutedSemanticReview }));

import { reviewBuildStudioAssembledChange } from "./build-studio-semantic-review";

const taskRows: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  taskRows.length = 0;
  delete process.env.DPF_SEMANTIC_CHANGE_REVIEW_MODE;
  db.capsuleFindFirst.mockResolvedValue({ id: "capsule-row", capsuleId: "WC-BUILD" });
  db.evidenceFindMany.mockResolvedValue([]);
  db.evidenceFindUnique.mockResolvedValue(null);
  db.taskRunFindMany.mockImplementation(async ({ where }) =>
    taskRows.filter((row) => row.repeatedPatternKey === where.repeatedPatternKey));
  db.taskRunFindUnique.mockImplementation(async ({ where }) =>
    taskRows.find((row) => row.taskRunId === where.taskRunId) ?? null);
  db.taskRunCreate.mockImplementation(async ({ data }) => {
    if (taskRows.some((row) => row.taskRunId === data.taskRunId)) {
      throw Object.assign(new Error("duplicate TaskRun"), { code: "P2002" });
    }
    const row = { ...data, progressPayload: null, createdAt: new Date() };
    taskRows.push(row);
    return row;
  });
  db.taskRunUpdate.mockImplementation(async ({ where, data }) => {
    const row = taskRows.find((candidate) => candidate.taskRunId === where.taskRunId);
    if (!row) throw new Error("missing TaskRun");
    Object.assign(row, data);
    return row;
  });
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
