import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  observeWorkPatternsAfterRun,
  type PatternObserverParentRun,
  type PatternObserverServiceDb,
  type PatternObserverServiceDeps,
} from "./pattern-observer-service";
import type {
  PatternObserverEnvelope,
  PatternObserverToolExecution,
  PatternObserverTurnMetric,
} from "./pattern-observer";

function makeDeps(overrides?: {
  taskRun?: PatternObserverParentRun | null;
  toolExecutions?: PatternObserverToolExecution[];
  turnMetrics?: PatternObserverTurnMetric[];
  envelopes?: PatternObserverEnvelope[];
  priorNeeds?: Array<{ evidenceJson?: unknown; readinessJson?: unknown }>;
  getTaskRun?: () => Promise<PatternObserverParentRun | null>;
}): PatternObserverServiceDeps & { db: PatternObserverServiceDb } {
  const db: PatternObserverServiceDb = {
    getTaskRun: vi.fn(
      overrides?.getTaskRun ??
        (async () =>
          overrides?.taskRun ?? {
            taskRunId: "TR-1",
            source: "coworker",
            title: "Do the work",
            a2aMetadata: { keep: true },
          }),
    ),
    updateTaskRun: vi.fn(async () => undefined),
    listToolExecutions: vi.fn(async () => overrides?.toolExecutions ?? []),
    listTurnMetrics: vi.fn(async () => overrides?.turnMetrics ?? []),
    listTaskRuns: vi.fn(async () => []),
    listEnvelopes: vi.fn(async () => overrides?.envelopes ?? []),
    listPriorNeeds: vi.fn(async () => overrides?.priorNeeds ?? []),
  };
  return {
    db,
    submitSelfAssessment: vi.fn(async () => ({
      assessmentId: "CWSA-1",
      needIds: ["CWN-1"],
      backlogItemIds: [],
    })),
    touchImprovementSignal: vi.fn(async () => ({ signalId: "IS-1", isNew: true })),
  };
}

function input() {
  return {
    taskRunId: "TR-1",
    userId: "user-1",
    agentId: "AGT-OPS",
    threadId: "thread-1",
    routeContext: "/ops",
    since: new Date("2026-06-27T12:00:00Z"),
  };
}

describe("observeWorkPatternsAfterRun", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("stamps the parent TaskRun and emits assessment plus improvement signal", async () => {
    const deps = makeDeps({
      toolExecutions: [
        {
          id: "tool-1",
          toolName: "export_archimate",
          success: false,
          summary: "forbidden_grant: ea_graph_read required",
          result: { error: "forbidden_grant: ea_graph_read required" },
          taskRunId: "TR-1",
        },
        {
          id: "tool-2",
          toolName: "export_archimate",
          success: false,
          summary: "forbidden_grant: ea_graph_read required",
          result: { error: "forbidden_grant: ea_graph_read required" },
          taskRunId: "TR-1",
        },
      ],
    });

    const result = await observeWorkPatternsAfterRun(input(), deps);

    expect(result).toEqual({ processed: 1 });
    expect(deps.db.listToolExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "TR-1",
        agentId: "AGT-OPS",
        routeContext: "/ops",
      }),
    );
    expect(deps.db.updateTaskRun).toHaveBeenCalledWith(
      "TR-1",
      expect.objectContaining({
        repeatedPatternKey: expect.stringContaining("grant-denial"),
        a2aMetadata: expect.objectContaining({
          keep: true,
          workPattern: expect.objectContaining({
            status: "observed",
            candidate: expect.objectContaining({ kind: "grant" }),
          }),
        }),
      }),
    );
    expect(deps.submitSelfAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "AGT-OPS",
        trigger: "work-pattern-observer",
        routeContext: "/ops",
        verdict: "gaps",
        needs: [expect.objectContaining({ kind: "grant" })],
      }),
    );
    expect(deps.touchImprovementSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "work_pattern_observer",
        sourceId: expect.stringContaining("grant-denial"),
        agentId: "AGT-OPS",
        threadId: "thread-1",
      }),
    );
  });

  it("skips reflection runs and does not load evidence", async () => {
    const deps = makeDeps({
      taskRun: {
        taskRunId: "TR-REFLECT",
        source: "proactive",
        title: "Skill reflection: repeated tool use",
        a2aMetadata: { reflectionDepth: 1 },
      },
    });

    await expect(
      observeWorkPatternsAfterRun({ ...input(), taskRunId: "TR-REFLECT" }, deps),
    ).resolves.toEqual({ processed: 0, skippedReason: "reflection-loop-guard" });

    expect(deps.db.listToolExecutions).not.toHaveBeenCalled();
    expect(deps.submitSelfAssessment).not.toHaveBeenCalled();
  });

  it("returns no-signals when the classifier finds nothing", async () => {
    const deps = makeDeps();

    await expect(observeWorkPatternsAfterRun(input(), deps)).resolves.toEqual({
      processed: 0,
      skippedReason: "no-signals",
    });

    expect(deps.db.updateTaskRun).not.toHaveBeenCalled();
  });

  it("fails open and logs when evidence loading fails", async () => {
    const deps = makeDeps({
      getTaskRun: async () => {
        throw new Error("db unavailable");
      },
    });

    await expect(observeWorkPatternsAfterRun(input(), deps)).resolves.toEqual({
      processed: 0,
      skippedReason: "observer-error",
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});
