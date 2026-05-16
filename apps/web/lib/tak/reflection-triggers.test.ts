import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  taskRunFindUnique,
  taskRunCreate,
  taskRunUpdate,
  pirFindMany,
  submitAssessment,
  createOrTouchSignal,
} = vi.hoisted(() => ({
  taskRunFindUnique: vi.fn(),
  taskRunCreate: vi.fn(),
  taskRunUpdate: vi.fn(),
  pirFindMany: vi.fn(),
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
    platformIssueReport: { findMany: pirFindMany },
  },
}));

vi.mock("@/lib/coworker-self-assessment/assessment-service", () => ({
  submitCoworkerSelfAssessment: submitAssessment,
}));

vi.mock("@/lib/improvement-flywheel/signals", () => ({
  createOrTouchImprovementSignal: createOrTouchSignal,
}));

import {
  getReflectionDepth,
  isReflectionRun,
  processRuntimeIssueReflection,
} from "./reflection-triggers";

function makeIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    reportId: "PIR-AB12C",
    title: "Coworker repeated create_backlog_item",
    description: "details",
    routeContext: "/customer",
    agentId: "AGT-1",
    threadId: "thread-1",
    taskRunId: "run-1",
    ...overrides,
  };
}

describe("getReflectionDepth + isReflectionRun", () => {
  it("returns 0 when a2aMetadata is missing or non-object", () => {
    expect(getReflectionDepth(null)).toBe(0);
    expect(getReflectionDepth({ a2aMetadata: null })).toBe(0);
    expect(getReflectionDepth({ a2aMetadata: "string" as never })).toBe(0);
    expect(getReflectionDepth({ a2aMetadata: [] as never })).toBe(0);
  });

  it("reads reflectionDepth off a2aMetadata", () => {
    expect(getReflectionDepth({ a2aMetadata: { reflectionDepth: 2 } })).toBe(2);
  });

  it("isReflectionRun matches source proactive + reflection-title prefix", () => {
    expect(isReflectionRun({ source: "proactive", title: "Skill reflection: x" })).toBe(true);
    expect(isReflectionRun({ source: "coworker", title: "Skill reflection: x" })).toBe(false);
    expect(isReflectionRun({ source: "proactive", title: "other" })).toBe(false);
  });
});

describe("processRuntimeIssueReflection", () => {
  beforeEach(() => {
    taskRunFindUnique.mockReset();
    taskRunCreate.mockReset();
    taskRunUpdate.mockReset();
    pirFindMany.mockReset();
    submitAssessment.mockReset();
    createOrTouchSignal.mockReset();

    taskRunCreate.mockResolvedValue({ id: "rfl-id", taskRunId: "TR-RFL-12345678" });
    taskRunUpdate.mockResolvedValue({});
    submitAssessment.mockResolvedValue({ assessmentId: "CWSA-1", needIds: ["CWN-1"] });
    createOrTouchSignal.mockResolvedValue({ signalId: "IS-1", isNew: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("skips entirely when the parent run is itself a reflection (layer 1)", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "proactive",
      title: "Skill reflection: x",
      a2aMetadata: { reflectionDepth: 1 },
    });

    const result = await processRuntimeIssueReflection({
      taskRunId: "run-rfl",
      userId: "u",
      agentId: "AGT-1",
      threadId: "t",
      routeContext: "/customer",
      since: new Date(0),
    });

    expect(result).toEqual({ processed: 0, skippedReason: "reflection-loop-guard" });
    expect(pirFindMany).not.toHaveBeenCalled();
    expect(taskRunCreate).not.toHaveBeenCalled();
  });

  it("skips when parent depth >= 1 even if not titled as a reflection (layer 2)", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: { reflectionDepth: 1 },
    });

    const result = await processRuntimeIssueReflection({
      taskRunId: "run-x",
      userId: "u",
      agentId: "AGT-1",
      threadId: "t",
      routeContext: "/customer",
      since: new Date(0),
    });

    expect(result.skippedReason).toBe("reflection-loop-guard");
  });

  it("filters PlatformIssueReport by taskRunId when present", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: null,
    });
    pirFindMany.mockResolvedValue([makeIssueRow()]);

    await processRuntimeIssueReflection({
      taskRunId: "run-1",
      userId: "u",
      agentId: "AGT-1",
      threadId: "t",
      routeContext: "/customer",
      since: new Date("2026-05-15"),
    });

    const where = pirFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.type).toBe("agent_stuck");
    expect(where.source).toBe("coworker_runtime");
    expect(where.taskRunId).toBe("run-1");
  });

  it("falls back to agent/route correlation when no parent taskRunId (logged warn)", async () => {
    pirFindMany.mockResolvedValue([]);

    await processRuntimeIssueReflection({
      taskRunId: null,
      userId: "u",
      agentId: "AGT-1",
      threadId: "t",
      routeContext: "/customer",
      since: new Date("2026-05-15"),
    });

    const where = pirFindMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.taskRunId).toBeUndefined();
    expect(where.agentId).toBe("AGT-1");
    expect(where.routeContext).toBe("/customer");
  });

  it("emits a proactive TaskRun + assessment + need + signal per issue", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: null,
    });
    pirFindMany.mockResolvedValue([makeIssueRow()]);

    const result = await processRuntimeIssueReflection({
      taskRunId: "run-1",
      userId: "u-1",
      agentId: "AGT-1",
      threadId: "thread-1",
      routeContext: "/customer",
      since: new Date(0),
    });

    expect(result.processed).toBe(1);

    expect(taskRunCreate).toHaveBeenCalledTimes(1);
    const trData = taskRunCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(trData.source).toBe("proactive");
    expect(trData.title).toBe("Skill reflection: repeated tool use");
    expect((trData.taskRunId as string).startsWith("TR-RFL-")).toBe(true);
    const a2a = trData.a2aMetadata as Record<string, unknown>;
    expect(a2a.reflectionDepth).toBe(1);
    expect(a2a.platformIssueReportId).toBe("PIR-AB12C");

    expect(submitAssessment).toHaveBeenCalledTimes(1);
    const assessmentArg = submitAssessment.mock.calls[0]?.[0] as {
      verdict: string;
      confidence: string;
      needs: Array<{ kind: string; severity: string; evidenceJson: { platformIssueReportId: string } }>;
    };
    expect(assessmentArg.verdict).toBe("gaps");
    expect(assessmentArg.confidence).toBe("medium");
    expect(assessmentArg.needs[0]?.kind).toBe("skill");
    expect(assessmentArg.needs[0]?.severity).toBe("important");
    expect(assessmentArg.needs[0]?.evidenceJson.platformIssueReportId).toBe("PIR-AB12C");

    expect(createOrTouchSignal).toHaveBeenCalledTimes(1);
    const signalArg = createOrTouchSignal.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(signalArg.sourceType).toBe("platform_issue_report");
    expect(signalArg.sourceId).toBe("PIR-AB12C");
    expect(signalArg.suspectedRootCause).toBe("repeated-tool-call");

    expect(taskRunUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = taskRunUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { status: string; completedAt: Date };
    };
    expect(updateArgs.where).toEqual({ id: "rfl-id" });
    expect(updateArgs.data.status).toBe("completed");
  });

  it("never updates SkillDefinition", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: null,
    });
    pirFindMany.mockResolvedValue([makeIssueRow()]);

    await processRuntimeIssueReflection({
      taskRunId: "run-1",
      userId: "u",
      agentId: "AGT-1",
      threadId: null,
      routeContext: "/customer",
      since: new Date(0),
    });

    // Only TaskRun (create + update for completion), assessment, and signal
    // are called. No skill mutation paths are mocked, so any attempt to
    // touch SkillDefinition would surface as a missing-mock error from Vitest.
    expect(taskRunCreate).toHaveBeenCalledTimes(1);
    expect(taskRunUpdate).toHaveBeenCalledTimes(1);
  });

  it("continues processing remaining rows when one row throws", async () => {
    taskRunFindUnique.mockResolvedValue({
      source: "coworker",
      title: "Ordinary run",
      a2aMetadata: null,
    });
    pirFindMany.mockResolvedValue([makeIssueRow({ reportId: "PIR-1" }), makeIssueRow({ reportId: "PIR-2" })]);
    submitAssessment.mockRejectedValueOnce(new Error("transient db hiccup"));

    const result = await processRuntimeIssueReflection({
      taskRunId: "run-1",
      userId: "u",
      agentId: "AGT-1",
      threadId: null,
      routeContext: "/customer",
      since: new Date(0),
    });

    expect(result.processed).toBe(1);
  });
});
