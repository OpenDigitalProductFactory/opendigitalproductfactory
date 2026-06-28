import { describe, expect, it, vi } from "vitest";

import {
  PERIODIC_PATTERN_REVIEW_MIN_COMPLETED_RUNS,
  PERIODIC_PATTERN_REVIEW_WINDOW_MS,
  runPeriodicPatternReview,
  type PeriodicPatternReviewDb,
} from "./periodic-review";

function makeDb(overrides?: {
  parentTaskRun?: Awaited<ReturnType<PeriodicPatternReviewDb["getTaskRun"]>>;
  completedRuns?: number;
  recentReview?: Awaited<ReturnType<PeriodicPatternReviewDb["findRecentReview"]>>;
}): PeriodicPatternReviewDb {
  return {
    getTaskRun: vi.fn(async () => overrides?.parentTaskRun ?? null),
    countCompletedRuns: vi.fn(async () => overrides?.completedRuns ?? PERIODIC_PATTERN_REVIEW_MIN_COMPLETED_RUNS),
    findRecentReview: vi.fn(async () => overrides?.recentReview ?? null),
    createTaskRun: vi.fn(async () => ({ taskRunId: "TR-GAP-REVIEW" })),
    completeTaskRun: vi.fn(async () => undefined),
  };
}

describe("runPeriodicPatternReview", () => {
  it("creates an attributable proactive review and observes coworker patterns", async () => {
    const db = makeDb();
    const observeCoworkerPatterns = vi.fn(async () => ({ processed: 2, submitted: true }));
    const now = new Date("2026-06-27T18:00:00.000Z");

    const result = await runPeriodicPatternReview(
      {
        agentId: "agent-build",
        routeContext: "/build",
      },
      {
        db,
        resolveOwnerUserId: async () => "user-super",
        observeCoworkerPatterns,
        now: () => now,
      },
    );

    expect(result).toEqual({
      reviewed: true,
      taskRunId: "TR-GAP-REVIEW",
      observedNeeds: 2,
    });
    expect(db.countCompletedRuns).toHaveBeenCalledWith({
      agentId: "agent-build",
      routeContext: "/build",
      since: new Date(now.getTime() - PERIODIC_PATTERN_REVIEW_WINDOW_MS),
      until: now,
    });
    expect(db.createTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-super",
        initiatingAgentId: "agent-build",
        currentAgentId: "agent-build",
        source: "proactive",
        status: "working",
        routeContext: "/build",
        a2aMetadata: expect.objectContaining({
          trigger: "periodic-pattern-review",
          reflectionDepth: 0,
        }),
      }),
    );
    expect(observeCoworkerPatterns).toHaveBeenCalledWith({
      agentId: "agent-build",
      routeContext: "/build",
      since: new Date(now.getTime() - PERIODIC_PATTERN_REVIEW_WINDOW_MS),
      until: now,
      windowMs: PERIODIC_PATTERN_REVIEW_WINDOW_MS,
    });
    expect(db.completeTaskRun).toHaveBeenCalledWith(
      "TR-GAP-REVIEW",
      expect.objectContaining({
        status: "completed",
        completedAt: now,
        progressPayload: expect.objectContaining({
          type: "periodic-pattern-review",
          observedNeeds: 2,
        }),
      }),
    );
  });

  it("skips agents reviewed within the cadence window", async () => {
    const db = makeDb({ recentReview: { taskRunId: "TR-RECENT" } });
    const observeCoworkerPatterns = vi.fn();

    await expect(
      runPeriodicPatternReview(
        { agentId: "agent-build", routeContext: "/build" },
        {
          db,
          resolveOwnerUserId: async () => "user-super",
          observeCoworkerPatterns,
          now: () => new Date("2026-06-27T18:00:00.000Z"),
        },
      ),
    ).resolves.toEqual({
      reviewed: false,
      skippedReason: "recently-reviewed",
    });

    expect(db.createTaskRun).not.toHaveBeenCalled();
    expect(observeCoworkerPatterns).not.toHaveBeenCalled();
  });

  it("skips agents below the completed-run threshold", async () => {
    const db = makeDb({ completedRuns: PERIODIC_PATTERN_REVIEW_MIN_COMPLETED_RUNS - 1 });
    const observeCoworkerPatterns = vi.fn();

    await expect(
      runPeriodicPatternReview(
        { agentId: "agent-build", routeContext: "/build" },
        {
          db,
          resolveOwnerUserId: async () => "user-super",
          observeCoworkerPatterns,
          now: () => new Date("2026-06-27T18:00:00.000Z"),
        },
      ),
    ).resolves.toEqual({
      reviewed: false,
      skippedReason: "below-run-count",
    });

    expect(db.createTaskRun).not.toHaveBeenCalled();
    expect(observeCoworkerPatterns).not.toHaveBeenCalled();
  });

  it("respects reflection loop guards before creating a review", async () => {
    const db = makeDb({
      parentTaskRun: {
        source: "proactive",
        title: "Skill reflection: repeated tool use",
        a2aMetadata: { reflectionDepth: 1 },
      },
    });

    await expect(
      runPeriodicPatternReview(
        {
          agentId: "agent-build",
          routeContext: "/build",
          parentTaskRunId: "TR-RFL-1",
        },
        {
          db,
          resolveOwnerUserId: async () => "user-super",
          observeCoworkerPatterns: vi.fn(),
          now: () => new Date("2026-06-27T18:00:00.000Z"),
        },
      ),
    ).resolves.toEqual({
      reviewed: false,
      skippedReason: "reflection-loop-guard",
    });

    expect(db.createTaskRun).not.toHaveBeenCalled();
  });
});
