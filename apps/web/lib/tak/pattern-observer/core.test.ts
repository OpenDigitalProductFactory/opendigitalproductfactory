import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskRunFindUnique,
  taskRunCreate,
  taskRunUpdate,
  submitAssessment,
  createOrTouchSignal,
} = vi.hoisted(() => ({
  taskRunFindUnique: vi.fn(),
  taskRunCreate: vi.fn(),
  taskRunUpdate: vi.fn(),
  submitAssessment: vi.fn(),
  createOrTouchSignal: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findUnique: taskRunFindUnique,
      create: taskRunCreate,
      update: taskRunUpdate,
    },
  },
}));

vi.mock("@/lib/coworker-self-assessment/assessment-service", () => ({
  submitCoworkerSelfAssessment: submitAssessment,
}));

vi.mock("@/lib/improvement-flywheel/signals", () => ({
  createOrTouchImprovementSignal: createOrTouchSignal,
}));

import { getReflectionDepth, isReflectionRun, runObservation } from "./core";

const baseInput = {
  parentTaskRunId: "run-parent",
  userId: "user-1",
  agentId: "AGT-1",
  threadId: "thread-1",
  routeContext: "/customer",
  sourceTitle: "Repeated create_backlog_item call",
  sourceDescription: "The coworker repeated the same tool call.",
  spec: {
    title: "Skill reflection: repeated tool use",
    trigger: "runtime-issue-reflection",
    verdict: "blocked",
    confidence: "high",
    sourceType: "platform_issue_report",
    sourceId: "PIR-123",
    suspectedRootCause: "tool-loop",
    needs: [
      {
        kind: "prompt",
        severity: "blocker",
        need: "Teach the coworker to stop after repeated tool failures.",
        blocks: "Repeated create_backlog_item call",
        evidenceJson: { source: "test" },
      },
    ],
  },
} as const;

describe("pattern observer core", () => {
  beforeEach(() => {
    taskRunFindUnique.mockReset();
    taskRunCreate.mockReset();
    taskRunUpdate.mockReset();
    submitAssessment.mockReset();
    createOrTouchSignal.mockReset();

    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: { reflectionDepth: 0 },
    });
    taskRunCreate.mockResolvedValue({ id: "created-id", taskRunId: "TR-RFL-ABCDEFGH" });
    taskRunUpdate.mockResolvedValue({});
    submitAssessment.mockResolvedValue({ assessmentId: "CWSA-1", needIds: ["CWN-1"] });
    createOrTouchSignal.mockResolvedValue({ signalId: "IS-1", isNew: true });
  });

  it("reads reflection metadata helpers from TaskRun-shaped rows", () => {
    expect(getReflectionDepth(null)).toBe(0);
    expect(getReflectionDepth({ a2aMetadata: "bad" as never })).toBe(0);
    expect(getReflectionDepth({ a2aMetadata: { reflectionDepth: 3 } })).toBe(3);

    expect(isReflectionRun({ source: "proactive", title: "Skill reflection: anything" })).toBe(
      true,
    );
    expect(isReflectionRun({ source: "coworker", title: "Skill reflection: anything" })).toBe(
      false,
    );
  });

  it("creates a proactive TaskRun with supplied title, trigger, and incremented reflectionDepth", async () => {
    const result = await runObservation(baseInput);

    expect(result).toEqual({ processed: 1 });
    expect(taskRunCreate).toHaveBeenCalledTimes(1);
    const data = taskRunCreate.mock.calls[0]?.[0]?.data as {
      source: string;
      title: string;
      a2aMetadata: Record<string, unknown>;
      parentTaskRunId: string;
    };
    expect(data.source).toBe("proactive");
    expect(data.title).toBe("Skill reflection: repeated tool use");
    expect(data.parentTaskRunId).toBe("run-parent");
    expect(data.a2aMetadata.reflectionDepth).toBe(1);
    expect(data.a2aMetadata.trigger).toBe("runtime-issue-reflection");
  });

  it("returns reflection-loop-guard when the parent is itself a reflection run", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "proactive",
      title: "Skill reflection: repeated tool use",
      a2aMetadata: { reflectionDepth: 0 },
    });

    const result = await runObservation(baseInput);

    expect(result).toEqual({ processed: 0, skippedReason: "reflection-loop-guard" });
    expect(taskRunCreate).not.toHaveBeenCalled();
    expect(submitAssessment).not.toHaveBeenCalled();
    expect(createOrTouchSignal).not.toHaveBeenCalled();
  });

  it("returns reflection-loop-guard when parent reflectionDepth is already at least one", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: { reflectionDepth: 1 },
    });

    const result = await runObservation(baseInput);

    expect(result).toEqual({ processed: 0, skippedReason: "reflection-loop-guard" });
    expect(taskRunCreate).not.toHaveBeenCalled();
  });

  it("emits a self-assessment with supplied verdict, confidence, and needs", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: null,
    });

    await runObservation(baseInput);

    expect(submitAssessment).toHaveBeenCalledTimes(1);
    const assessment = submitAssessment.mock.calls[0]?.[0] as {
      trigger: string;
      verdict: string;
      confidence: string;
      needs: Array<{ kind: string; severity: string; need: string; evidenceJson: unknown }>;
    };
    expect(assessment.trigger).toBe("runtime-issue-reflection");
    expect(assessment.verdict).toBe("blocked");
    expect(assessment.confidence).toBe("high");
    expect(assessment.needs).toHaveLength(1);
    expect(assessment.needs[0]).toMatchObject({
      kind: "prompt",
      severity: "blocker",
      need: "Teach the coworker to stop after repeated tool failures.",
      evidenceJson: { source: "test" },
    });
  });

  it("touches an ImprovementSignal with supplied source and root-cause fields", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: null,
    });

    await runObservation(baseInput);

    expect(createOrTouchSignal).toHaveBeenCalledTimes(1);
    expect(createOrTouchSignal.mock.calls[0]?.[0]).toMatchObject({
      sourceType: "platform_issue_report",
      sourceId: "PIR-123",
      suspectedRootCause: "tool-loop",
      title: "Repeated create_backlog_item call",
      description: "The coworker repeated the same tool call.",
    });
  });
});
