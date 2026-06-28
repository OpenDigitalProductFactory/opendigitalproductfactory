import { describe, expect, it, vi } from "vitest";
import {
  runDueWorkPatternProfileReviews,
  runWorkPatternProfileReview,
  type WorkPatternProfileReviewDb,
} from "./work-pattern-profile-review";
import type {
  PatternObserverEnvelope,
  PatternObserverToolExecution,
  PatternObserverTurnMetric,
} from "./pattern-observer";

function makeDb(overrides?: {
  toolExecutions?: PatternObserverToolExecution[];
  turnMetrics?: PatternObserverTurnMetric[];
  envelopes?: PatternObserverEnvelope[];
  dueTargets?: Array<{ agentId: string; routeContext?: string | null }>;
}): WorkPatternProfileReviewDb {
  return {
    createTaskRun: vi.fn(async () => ({ taskRunId: "TR-SCHED-REVIEW" })),
    completeTaskRun: vi.fn(async () => undefined),
    listToolExecutions: vi.fn(async () => overrides?.toolExecutions ?? []),
    listTurnMetrics: vi.fn(async () => overrides?.turnMetrics ?? []),
    listTaskRuns: vi.fn(async () => []),
    listEnvelopes: vi.fn(async () => overrides?.envelopes ?? []),
    listPriorNeeds: vi.fn(async () => []),
    listDueReviewTargets: vi.fn(async () => overrides?.dueTargets ?? []),
  };
}

describe("runWorkPatternProfileReview", () => {
  it("creates an attributable review TaskRun and files observed needs", async () => {
    const db = makeDb({
      toolExecutions: [
        {
          id: "tool-1",
          toolName: "export_archimate",
          success: false,
          summary: "forbidden_grant: ea_graph_read required",
          result: { error: "forbidden_grant: ea_graph_read required" },
          taskRunId: "TR-WORK-1",
        },
        {
          id: "tool-2",
          toolName: "export_archimate",
          success: false,
          summary: "forbidden_grant: ea_graph_read required",
          result: { error: "forbidden_grant: ea_graph_read required" },
          taskRunId: "TR-WORK-2",
        },
      ],
    });
    const submitSelfAssessment = vi.fn(async () => ({
      assessmentId: "CWSA-1",
      needIds: ["CWN-1"],
      backlogItemIds: [],
    }));

    const result = await runWorkPatternProfileReview(
      {
        agentId: "AGT-OPS",
        routeContext: "/ops",
        now: new Date("2026-06-27T14:00:00Z"),
      },
      {
        db,
        resolveOwnerUserId: async () => "user-owner",
        submitSelfAssessment,
      },
    );

    expect(result).toEqual({
      taskRunId: "TR-SCHED-REVIEW",
      observedPatterns: 1,
      needsFiled: 1,
    });
    expect(db.createTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-owner",
        initiatingAgentId: "AGT-OPS",
        currentAgentId: "AGT-OPS",
        routeContext: "/ops",
        source: "proactive",
        status: "working",
      }),
    );
    expect(submitSelfAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "AGT-OPS",
        trigger: "work-pattern-profile-review",
        needs: [expect.objectContaining({ kind: "grant" })],
      }),
    );
    expect(db.completeTaskRun).toHaveBeenCalledWith(
      "TR-SCHED-REVIEW",
      expect.objectContaining({
        status: "completed",
        progressPayload: expect.objectContaining({
          type: "work-pattern-profile-review",
          agentId: "AGT-OPS",
          routeContext: "/ops",
          windowDays: 7,
          observedPatterns: 1,
          needsFiled: 1,
        }),
      }),
    );
  });

  it("marks the review completed even when no needs are found", async () => {
    const db = makeDb();
    const submitSelfAssessment = vi.fn();

    const result = await runWorkPatternProfileReview(
      { agentId: "AGT-BUILD", now: new Date("2026-06-27T14:00:00Z") },
      {
        db,
        resolveOwnerUserId: async () => "user-owner",
        submitSelfAssessment,
      },
    );

    expect(result).toEqual({
      taskRunId: "TR-SCHED-REVIEW",
      observedPatterns: 0,
      needsFiled: 0,
    });
    expect(submitSelfAssessment).not.toHaveBeenCalled();
    expect(db.completeTaskRun).toHaveBeenCalledWith(
      "TR-SCHED-REVIEW",
      expect.objectContaining({ status: "completed" }),
    );
  });
});

describe("runDueWorkPatternProfileReviews", () => {
  it("runs due targets through the same review path", async () => {
    const db = makeDb({
      dueTargets: [
        { agentId: "AGT-OPS", routeContext: "/ops" },
        { agentId: "AGT-BUILD", routeContext: "/build" },
      ],
    });

    const result = await runDueWorkPatternProfileReviews({
      db,
      resolveOwnerUserId: async () => "user-owner",
      now: () => new Date("2026-06-27T14:00:00Z"),
    });

    expect(result.reviewed).toBe(2);
    expect(db.listDueReviewTargets).toHaveBeenCalledWith(
      expect.objectContaining({ windowDays: 7, minCompletedRuns: 10 }),
    );
    expect(db.createTaskRun).toHaveBeenCalledTimes(2);
  });
});
