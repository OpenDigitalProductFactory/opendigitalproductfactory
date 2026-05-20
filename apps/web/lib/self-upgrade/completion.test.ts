import { describe, expect, it, vi } from "vitest";

import {
  buildCompletionEvidence,
  buildCompletionFailureUpdate,
  getCompletionAttempts,
  MAX_COMPLETION_ATTEMPTS,
  resolveBuildHeadCandidates,
  completeMergedShipBuilds,
} from "./completion";

describe("resolveBuildHeadCandidates", () => {
  it("prefers recorded gitCommitHashes before falling back to branch refs", () => {
    expect(
      resolveBuildHeadCandidates({
        buildBranch: "build/FB-1",
        gitCommitHashes: ["1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222"],
      }),
    ).toEqual(["2222222222222222222222222222222222222222", "build/FB-1", "origin/build/FB-1"]);
  });
});

describe("buildCompletionEvidence", () => {
  it("records the production SHA and self-upgrade run id", () => {
    expect(
      buildCompletionEvidence({
        productionSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        buildBranchSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        selfUpgradeRunId: "SUR-123",
        confirmedAt: new Date("2026-05-20T03:00:00Z"),
      }),
    ).toEqual({
      productionSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      buildBranchSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ancestryConfirmed: true,
      confirmedAt: "2026-05-20T03:00:00.000Z",
      selfUpgradeRunId: "SUR-123",
    });
  });
});

describe("completion failure retry state", () => {
  it("increments completion attempts without failing the run until the cap", () => {
    const first = buildCompletionFailureUpdate({
      completionEvidence: { reason: "update-available" },
      message: "git unavailable",
      failedAt: new Date("2026-05-20T03:00:00Z"),
    });

    expect(first.completionAttempts).toBe(1);
    expect(first.exhausted).toBe(false);
    expect(first.data).toEqual(expect.objectContaining({
      status: "completing",
      reason: "completion-failed",
      failureLog: "git unavailable",
      completionEvidence: expect.objectContaining({
        reason: "update-available",
        completionAttempts: 1,
        lastCompletionError: "git unavailable",
        lastCompletionErrorAt: "2026-05-20T03:00:00.000Z",
      }),
    }));
  });

  it("marks the run failed when completion attempts reach the cap", () => {
    const final = buildCompletionFailureUpdate({
      completionEvidence: { completionAttempts: MAX_COMPLETION_ATTEMPTS - 1 },
      message: "still unavailable",
      failedAt: new Date("2026-05-20T04:00:00Z"),
    });

    expect(getCompletionAttempts(final.data.completionEvidence)).toBe(MAX_COMPLETION_ATTEMPTS);
    expect(final.exhausted).toBe(true);
    expect(final.data).toEqual(expect.objectContaining({
      status: "failed",
      reason: "completion-retries-exhausted",
      completedAt: new Date("2026-05-20T04:00:00Z"),
    }));
  });
});

describe("completeMergedShipBuilds", () => {
  it("marks only ship builds whose head is an ancestor of the running production SHA", async () => {
    const db = {
      featureBuild: {
        findMany: vi.fn().mockResolvedValue([
          { buildId: "FB-MERGED", buildBranch: "build/FB-MERGED", gitCommitHashes: ["1111111111111111111111111111111111111111"] },
          { buildId: "FB-OPEN", buildBranch: "build/FB-OPEN", gitCommitHashes: ["2222222222222222222222222222222222222222"] },
        ]),
        update: vi.fn(),
      },
      buildActivity: { create: vi.fn() },
    };
    const git = {
      isAncestor: vi.fn(async (candidate: string) => candidate.startsWith("1111")),
      resolveRef: vi.fn(async (candidate: string) => candidate),
    };

    const result = await completeMergedShipBuilds({
      db,
      git,
      productionSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      selfUpgradeRunId: "SUR-123",
    });

    expect(result.completedBuildIds).toEqual(["FB-MERGED"]);
    expect(db.featureBuild.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "FB-MERGED" },
      data: expect.objectContaining({ phase: "complete" }),
    }));
    expect(db.featureBuild.update).toHaveBeenCalledTimes(1);
  });
});
