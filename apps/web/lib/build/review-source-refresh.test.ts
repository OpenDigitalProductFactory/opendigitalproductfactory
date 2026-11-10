import { describe, expect, it, vi } from "vitest";
import {
  refreshReviewBuildAfterGauntletNotRun,
  REVIEW_SOURCE_REFRESH_RETRY_MS,
  type ReviewSourceRefreshDeps,
} from "./review-source-refresh";

const NOW = new Date("2026-11-05T09:00:00Z");
// The live refusal on FB-38E92712 (2026-11-05): the base commit's guard scripts
// carried the stale-root-clone defect fixed in #6909.
const REASON = "The guard gauntlet exited 88 without naming a failing guard, which is a crash rather than a finding.";

function deps(overrides: Partial<ReviewSourceRefreshDeps> = {}) {
  const base: ReviewSourceRefreshDeps = {
    loadPhase: vi.fn(async () => "review"),
    lastAttemptAt: vi.fn(async () => null),
    refresh: vi.fn(async () => ({ status: "refreshed" as const, headSha: "a".repeat(40), clientSha: "b".repeat(40) })),
    queueReview: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    now: () => NOW,
  };
  return { ...base, ...overrides };
}

describe("refreshReviewBuildAfterGauntletNotRun", () => {
  it("rebases the build onto upstream main and re-queues review, so the grader runs current guard scripts", async () => {
    const d = deps();
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-38E92712", REASON, d)).resolves.toBe("refreshed");
    expect(d.refresh).toHaveBeenCalledWith("FB-38E92712");
    expect(d.queueReview).toHaveBeenCalledWith("FB-38E92712");
    expect(vi.mocked(d.record).mock.calls[0]?.[1]).toMatch(/gauntlet could not run.*exited 88.*now aaaaaaaaa/);
  });

  it("does nothing for a build that has left review", async () => {
    const d = deps({ loadPhase: vi.fn(async () => "ship") });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-1", REASON, d)).resolves.toBe("not-review");
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("refreshes at most once per retry window, so a not-run that survives a refresh does not rebase every sweep", async () => {
    const recent = new Date(NOW.getTime() - REVIEW_SOURCE_REFRESH_RETRY_MS + 1000);
    const d = deps({ lastAttemptAt: vi.fn(async () => recent) });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-1", REASON, d)).resolves.toBe("recently-attempted");
    expect(d.refresh).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("never resolves a conflict: it records the files and leaves review to its normal sweep", async () => {
    const d = deps({ refresh: vi.fn(async () => ({ status: "conflict" as const, files: ["apps/web/x.ts"] })) });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-1", REASON, d)).resolves.toBe("conflict");
    expect(d.queueReview).not.toHaveBeenCalled();
    expect(vi.mocked(d.record).mock.calls[0]?.[1]).toMatch(/conflicts in apps\/web\/x\.ts/);
  });

  it("records a refresh that could not run, and a throw, without re-queuing", async () => {
    const unsupported = deps({ refresh: vi.fn(async () => ({ status: "unsupported" as const, reason: "needs clones" })) });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-1", REASON, unsupported)).resolves.toBe("not-refreshed");
    expect(vi.mocked(unsupported.record).mock.calls[0]?.[1]).toMatch(/needs clones/);

    const threw = deps({ refresh: vi.fn(async () => { throw new Error("git unavailable"); }) });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-1", REASON, threw)).resolves.toBe("not-refreshed");
    expect(threw.queueReview).not.toHaveBeenCalled();
  });
});
