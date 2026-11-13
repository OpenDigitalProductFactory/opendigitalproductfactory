import { describe, expect, it, vi } from "vitest";
import {
  refreshReviewBuildAfterGauntletNotRun,
  REVIEW_SOURCE_REFRESH_RETRY_MS,
  REVIEW_SOURCE_REFRESH_MAX_PER_DAY,
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
    attemptsSince: vi.fn(async () => 0),
    refresh: vi.fn(async () => ({ status: "refreshed" as const, headSha: "a".repeat(40), clientSha: "b".repeat(40) })),
    queueReview: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    routeConflictToRepair: vi.fn(async () => "repair-queued" as const),
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

  // BI-E3C5C7E4: 33 builds re-ran the crashing gauntlet hourly for a week.
  it("stops re-queuing review once a day's refresh budget is spent, and says why", async () => {
    const d = deps({ attemptsSince: vi.fn(async () => REVIEW_SOURCE_REFRESH_MAX_PER_DAY) });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-202D4508", REASON, d)).resolves.toBe("refresh-exhausted");
    expect(d.refresh).not.toHaveBeenCalled();
    expect(d.queueReview).not.toHaveBeenCalled();
    expect(vi.mocked(d.record).mock.calls[0]?.[1]).toMatch(/not base drift, so review is not re-queued/);
  });

  // BI-2CCD5C0E: live on 2026-11-11, ten review builds re-crashed the gauntlet
  // every few minutes because their refresh conflicted and they "stayed in
  // review" with the old base's guard scripts forever.
  it("hands a conflicted refresh back to the coding agent with the files named, instead of leaving it in review", async () => {
    const file = "apps/web/lib/coworker-self-assessment/assessment-service.ts";
    const d = deps({ refresh: vi.fn(async () => ({ status: "conflict" as const, files: [file], ontoRef: "client/abc" })) });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-F11D52E8", REASON, d)).resolves.toBe("conflict-repair-queued");
    expect(d.queueReview).not.toHaveBeenCalled();
    expect(d.routeConflictToRepair).toHaveBeenCalledWith("FB-F11D52E8", expect.objectContaining({
      source: "conflict",
      ontoRef: "client/abc",
      findings: [expect.objectContaining({ description: expect.stringContaining(file) })],
    }));
    const summary = vi.mocked(d.record).mock.calls[0]?.[1] ?? "";
    expect(summary).toMatch(/conflicts in apps\/web\/lib\/coworker-self-assessment/);
    expect(summary).not.toMatch(/stays in review/);
  });

  it("names the escalation when the conflict hand-backs are spent, so the loop ends with an owner decision", async () => {
    const d = deps({
      refresh: vi.fn(async () => ({ status: "conflict" as const, files: ["a.ts"] })),
      routeConflictToRepair: vi.fn(async () => "escalated" as const),
    });
    await expect(refreshReviewBuildAfterGauntletNotRun("FB-1", REASON, d)).resolves.toBe("conflict-escalated");
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
