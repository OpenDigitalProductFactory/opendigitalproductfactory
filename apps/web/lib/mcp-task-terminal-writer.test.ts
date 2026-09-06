import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findModelConfig: vi.fn(),
  findEnvelope: vi.fn(),
  findToolExecution: vi.fn(),
  findToolExecutions: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsertThread: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  executeTool: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findFirst: (...args: unknown[]) => db.findFirst(...args),
      findUnique: (...args: unknown[]) => db.findUnique(...args),
      update: (...args: unknown[]) => db.update(...args),
      updateMany: (...args: unknown[]) => db.updateMany(...args),
    },
    coworkerActionEnvelope: { findFirst: (...args: unknown[]) => db.findEnvelope(...args) },
    toolExecution: {
      findFirst: (...args: unknown[]) => db.findToolExecution(...args),
      findMany: (...args: unknown[]) => db.findToolExecutions(...args),
    },
    agentThread: { upsert: (...args: unknown[]) => db.upsertThread(...args) },
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));

import { submitRemoteCoworkerTask } from "./mcp-task-submit";

const userContext = { platformRole: "developer", isSuperuser: false };
const params = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/platform/build",
  title: "Independent design review",
  objective: "Review the immutable artifact.",
  prompt: "Read the source and record the governed evidence.",
  idempotencyKey: "missing-writer-same-taskrun-resume",
  riskClass: "bounded-write",
  authorityScope: [
    "backlog-item:BI-F0715C9C",
    "tool:read_source_at_version",
    "tool:record_initiative_evidence",
  ],
  collaborationKind: "summon",
  initiativeReviewBinding: {
    writerToolName: "record_initiative_evidence",
    itemId: "BI-F0715C9C",
    gate: "research",
    artifactRef: {
      kind: "repo-blob-at-commit",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "d47536a552c7d588b2f963e478ae99369f720783",
      path: "docs/superpowers/specs/design.md",
      providerBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
    },
  },
};

const persistedReaderExecution = {
  id: "reader-1",
  toolName: "read_source_at_version",
  parameters: {
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    path: "docs/superpowers/specs/design.md",
    version: "d47536a552c7d588b2f963e478ae99369f720783",
    expectedBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
    startLine: 1,
    maxChars: 3_200,
  },
  result: {},
  success: true,
  createdAt: new Date("2026-08-28T15:30:31.190Z"),
};

function submit(tokenId: string, request = params) {
  return submitRemoteCoworkerTask({
    token: { tokenId, userId: "user-1", capability: "write", source: "pat" },
    userContext,
    params: request,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findFirst.mockResolvedValue(null);
  db.findUnique.mockResolvedValue({ status: "working" });
  db.findEnvelope.mockResolvedValue(null);
  db.findToolExecution.mockResolvedValue(null);
  db.findToolExecutions.mockResolvedValue([persistedReaderExecution]);
  db.findModelConfig.mockResolvedValue({
    minimumTier: "strong",
    budgetClass: "quality_first",
    pinnedProviderId: "local",
    pinnedModelId: "review-model",
  });
  db.upsertThread.mockResolvedValue({ id: "thread-external" });
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  autonomous.create.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "task-internal",
    taskRunId: input["taskRunId"],
    contextId: "thread-external",
  }));
  autonomous.resolveAgent.mockResolvedValue({
    agentId: "build-specialist",
    displayName: "Build Lead",
    systemPrompt: "Review the immutable artifact.",
    sensitivity: "internal",
  });
  autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  autonomous.execute.mockResolvedValue({ content: "Done.", executedTools: [] });
  autonomous.executeTool.mockResolvedValue({
    success: true,
    message: "Read design.md lines 1-3 of 3.",
    data: {
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      path: "docs/superpowers/specs/design.md",
      version: "d47536a552c7d588b2f963e478ae99369f720783",
      blobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
      content: "# Recovery design\n\nThe same TaskRun preserves its immutable authority binding.",
      startLine: 1,
      endLine: 3,
      totalLines: 3,
      hasMore: false,
      nextCursor: null,
    },
  });
});

async function persistedMetadata(tokenId: string, request = params) {
  await submit(tokenId, request);
  return (autonomous.create.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }).metadata;
}

describe("terminal writer resumption", () => {
  it("recovers the same completed review once when persisted evidence proves the route-exit defect", async () => {
    const metadata = await persistedMetadata("PAT-WRITER-ROUTE-EXIT");
    vi.clearAllMocks();
    const updatedAt = new Date("2026-08-28T09:27:00.000Z");
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-ROUTE-EXIT",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "completed",
      updatedAt,
      progressPayload: {
        summary: "The only eligible local model is busy with another background job.",
        executedToolCount: 1,
      },
      a2aMetadata: metadata,
    });
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecutions.mockResolvedValue([persistedReaderExecution]);
    db.findToolExecution.mockImplementation(async (query: { where?: { toolName?: unknown } }) => {
      const toolName = query.where?.toolName;
      if (toolName === "record_initiative_evidence") return null;
      return {
        id: "cmtcr47ow00ep01t9m6psmdgu",
        toolName: "read_source_at_version",
        success: true,
      };
    });
    db.updateMany.mockResolvedValue({ count: 1 });
    db.update.mockResolvedValue({});
    db.findUnique.mockResolvedValue({ status: "working" });
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "build-specialist",
      displayName: "Build Lead",
      systemPrompt: "Review the immutable artifact.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
    autonomous.execute.mockResolvedValue({
      content: "Receipt recorded.",
      executedTools: [{ name: "record_initiative_evidence", result: { success: true } }],
    });

    const outcome = await submit("PAT-WRITER-ROUTE-EXIT");

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-ROUTE-EXIT", status: "completed", updatedAt },
      data: {
        status: "working",
        lastHeartbeatAt: expect.any(Date),
        completedAt: null,
        progressPayload: expect.objectContaining({
          terminalWriterWait: expect.objectContaining({ attempt: 2 }),
          recoveredFromCompletedRouteExit: true,
          resumeReservedAt: expect.any(String),
        }),
      },
    });
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-ROUTE-EXIT",
      threadId: "thread-external",
    }));
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-ROUTE-EXIT",
        status: "completed",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
      },
    });
  });

  it("does not reopen a completed review without persisted successful reader evidence", async () => {
    const metadata = await persistedMetadata("PAT-WRITER-NO-EVIDENCE");
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-NO-EVIDENCE",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "completed",
      updatedAt: new Date("2026-08-28T09:28:00.000Z"),
      progressPayload: { summary: "Done.", executedToolCount: 0 },
      a2aMetadata: metadata,
    });
    db.findToolExecution.mockResolvedValue(null);
    db.findToolExecutions.mockResolvedValue([]);

    const outcome = await submit("PAT-WRITER-NO-EVIDENCE");

    expect(db.updateMany).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-NO-EVIDENCE",
        status: "completed",
        idempotentReplay: true,
      },
    });
  });

  it("resumes the same missing-writer TaskRun exactly once on an identical replay", async () => {
    const metadata = await persistedMetadata("PAT-WRITER-RESUME");
    vi.clearAllMocks();
    const updatedAt = new Date("2026-08-28T07:20:00.000Z");
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-SAME-WRITER-RUN",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "input-required",
      updatedAt,
      progressPayload: {
        summary: "No receipt was created.",
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-28T07:19:00.000Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecutions.mockResolvedValue([persistedReaderExecution]);
    db.findToolExecution.mockImplementation(async (query: { where?: { toolName?: unknown } }) => {
      const toolName = query.where?.toolName;
      if (toolName === "record_initiative_evidence") return null;
      return {
        id: "reader-1",
        toolName: "read_source_at_version",
        success: true,
      };
    });
    db.updateMany.mockResolvedValue({ count: 1 });
    db.update.mockResolvedValue({});
    db.findUnique.mockResolvedValue({ status: "working" });
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "build-specialist",
      displayName: "Build Lead",
      systemPrompt: "Review the immutable artifact.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
    autonomous.execute.mockResolvedValue({
      content: "Receipt recorded.",
      executedTools: [{ name: "record_initiative_evidence", result: { success: true } }],
    });

    const outcome = await submit("PAT-WRITER-RESUME");

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-SAME-WRITER-RUN", status: "input-required", updatedAt },
      data: {
        status: "working",
        lastHeartbeatAt: expect.any(Date),
        completedAt: null,
        progressPayload: expect.objectContaining({
          terminalWriterWait: expect.objectContaining({ attempt: 2 }),
          resumeReservedAt: expect.any(String),
        }),
      },
    });
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({ // guarded working transition (BI-D208E70C)
      where: expect.objectContaining({ taskRunId: "TR-MCP-SAME-WRITER-RUN" }),
      data: { status: "working", lastHeartbeatAt: expect.any(Date) },
    }));
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-SAME-WRITER-RUN",
      threadId: "thread-external",
    }));
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-SAME-WRITER-RUN",
        status: "completed",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
        executedToolCount: 1,
      },
    });
  });

  it("resumes an input-required correction after a schema-invalid writer attempt without an envelope", async () => {
    const correctionParams = { ...params, idempotencyKey: "invalid-writer-correction" };
    const metadata = await persistedMetadata("PAT-WRITER-CORRECTION", correctionParams);
    vi.clearAllMocks();
    const updatedAt = new Date("2026-09-06T15:50:56.680Z");
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-WRITER-CORRECTION",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "input-required",
      updatedAt,
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-09-06T15:50:56.679Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecutions.mockResolvedValue([persistedReaderExecution]);
    db.findToolExecution.mockImplementation(async (query: { where?: { toolName?: unknown; success?: unknown } }) => {
      if (query.where?.toolName !== "record_initiative_evidence" || query.where?.success === true) return null;
      return {
        id: "schema-invalid-writer",
        toolName: "record_initiative_evidence",
        success: false,
        result: {
          success: false,
          error: "Every proposal mapping must name each current objective and acceptance statement exactly once.",
        },
      };
    });
    db.updateMany.mockResolvedValue({ count: 1 });
    db.update.mockResolvedValue({});
    db.findUnique.mockResolvedValue({ status: "working" });
    autonomous.execute.mockResolvedValue({
      content: "Corrected proposal recorded.",
      executedTools: [{ name: "record_initiative_evidence", result: { success: true } }],
    });

    const outcome = await submit("PAT-WRITER-CORRECTION", correctionParams);

    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-MCP-WRITER-CORRECTION", status: "input-required", updatedAt },
      data: expect.objectContaining({
        status: "working",
        progressPayload: expect.objectContaining({
          terminalWriterWait: expect.objectContaining({ attempt: 2 }),
        }),
      }),
    }));
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-WRITER-CORRECTION",
      threadId: "thread-external",
    }));
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-WRITER-CORRECTION",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
      },
    });
  });

  it("bootstraps persisted immutable reader evidence when the resumable TaskRun has no reader rows", async () => {
    const metadata = await persistedMetadata("PAT-WRITER-ZERO-READER");
    vi.clearAllMocks();
    const updatedAt = new Date("2026-08-31T03:00:00.000Z");
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-ZERO-READER",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "input-required",
      updatedAt,
      progressPayload: {
        summary: "The required governed writer could not be dispatched.",
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-31T02:59:00.000Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecutions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([persistedReaderExecution]);
    db.findToolExecution.mockResolvedValue(null);
    db.updateMany.mockResolvedValue({ count: 1 });
    db.update.mockResolvedValue({});
    db.findUnique.mockResolvedValue({ status: "working" });
    autonomous.execute.mockResolvedValue({
      content: "Receipt recorded.",
      executedTools: [{ name: "record_initiative_evidence", result: { success: true } }],
    });

    const outcome = await submit("PAT-WRITER-ZERO-READER");

    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-MCP-ZERO-READER", status: "input-required", updatedAt },
    }));
    expect(autonomous.executeTool).toHaveBeenCalledTimes(2);
    expect(autonomous.executeTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "read_source_at_version",
      taskRunId: "TR-MCP-ZERO-READER",
      args: {
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        path: "docs/superpowers/specs/design.md",
        version: "d47536a552c7d588b2f963e478ae99369f720783",
        expectedBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
        startLine: 1,
        maxLines: 200,
        maxChars: 3_200,
      },
    }));
    expect(db.findToolExecutions).toHaveBeenCalledTimes(2);
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-ZERO-READER",
      threadId: "thread-external",
    }));
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-ZERO-READER",
        status: "completed",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
      },
    });
  });

  it("keeps a zero-reader TaskRun resumable when the governed bootstrap read fails", async () => {
    const metadata = await persistedMetadata("PAT-WRITER-ZERO-READER-FAIL");
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-ZERO-READER-FAIL",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "input-required",
      updatedAt: new Date("2026-08-31T03:05:00.000Z"),
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-31T03:04:00.000Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecutions.mockReset().mockResolvedValue([]);
    db.findToolExecution.mockResolvedValue(null);
    db.updateMany.mockResolvedValue({ count: 1 });
    db.update.mockResolvedValue({});
    autonomous.executeTool.mockResolvedValue({
      success: false,
      message: "The exact immutable source could not be read.",
      error: "provider-unavailable",
    });

    const outcome = await submit("PAT-WRITER-ZERO-READER-FAIL");

    expect(autonomous.executeTool).toHaveBeenCalledTimes(1);
    expect(db.findToolExecutions).toHaveBeenCalledTimes(1);
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-ZERO-READER-FAIL" },
      data: expect.objectContaining({
        status: "input-required",
        completedAt: null,
        progressPayload: expect.objectContaining({
          terminalWriterContextFailure: expect.objectContaining({
            code: "terminal_writer_context_reader_failed",
          }),
        }),
      }),
    });
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-ZERO-READER-FAIL",
        status: "input-required",
        idempotentReplay: true,
        resumable: true,
        waitReason: "terminal-writer-context-unavailable",
        structuredContent: { error: "terminal_writer_context_reader_failed" },
        isError: true,
      },
    });
  });

  it("stops replaying and returns a governed escalation after the third missing-writer attempt", async () => {
    const exhaustedParams = { ...params, idempotencyKey: "missing-writer-resume-exhausted" };
    const metadata = await persistedMetadata("PAT-WRITER-EXHAUSTED", exhaustedParams);
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-WRITER-EXHAUSTED",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "input-required",
      updatedAt: new Date("2026-08-28T07:25:00.000Z"),
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 2,
          observedAt: "2026-08-28T07:24:00.000Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.findEnvelope.mockImplementation(async (query: { where?: { status?: unknown } }) => {
      if (query.where?.status === "approved") return null;
      return {
        id: "cmtd7ltl200ac01qgk4ryw20x",
        manifestActionId: "record_initiative_evidence",
        status: "declined",
      };
    });
    db.findToolExecutions.mockResolvedValue([
      {
        id: "cmtd3z0ye00gz01rtjr503slt",
        toolName: "read_source_at_version",
        parameters: {
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          path: "docs/superpowers/specs/design.md",
          version: "d47536a552c7d588b2f963e478ae99369f720783",
          expectedBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
          startLine: 1,
          maxChars: 3_200,
        },
        result: {},
        success: true,
        createdAt: new Date("2026-08-28T15:30:31.190Z"),
      },
      {
        id: "cmtd3zymp00hh01rtpf9ukk8z",
        toolName: "read_source_at_version",
        parameters: {
          repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          path: "docs/superpowers/specs/design.md",
          version: "d47536a552c7d588b2f963e478ae99369f720783",
          expectedBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
          startLine: 1,
          maxLines: 200,
        },
        result: {},
        success: true,
        createdAt: new Date("2026-08-28T15:31:14.833Z"),
      },
    ]);
    db.findToolExecution.mockImplementation(async (query: { where?: { toolName?: unknown; success?: unknown } }) => {
      const toolName = query.where?.toolName;
      if (toolName === "record_initiative_evidence") {
        if (query.where?.success === true) return null;
        return {
          id: "cmtd7ltll00ad01qghtnykmo4",
          toolName: "record_initiative_evidence",
          success: false,
          result: {
            success: false,
            error: "approval_required",
            data: { envelopeId: "cmtd7ltl200ac01qgk4ryw20x" },
          },
        };
      }
      return {
        id: "cmtd3zymp00hh01rtpf9ukk8z",
        toolName: "read_source_at_version",
        success: true,
      };
    });
    autonomous.execute.mockResolvedValue({
      content: "The provider did not honor the required writer tool-call contract. No receipt was created.",
      executedTools: [],
      failure: {
        kind: "terminal-writer-missing",
        message: "The provider did not honor the required writer tool-call contract. No receipt was created.",
      },
    });

    const outcome = await submit("PAT-WRITER-EXHAUSTED", exhaustedParams);

    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-WRITER-EXHAUSTED",
      systemPrompt: expect.stringMatching(
        /Review the immutable artifact\.[\s\S]*The same TaskRun preserves its immutable authority binding\./,
      ),
      chatHistory: [{ role: "user", content: exhaustedParams.prompt }],
      terminalToolPolicy: expect.objectContaining({
        terminalPhase: "writer-only",
        persistedEvidenceAvailable: true,
      }),
    }));
    expect(autonomous.executeTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "read_source_at_version",
      taskRunId: "TR-MCP-WRITER-EXHAUSTED",
      args: expect.objectContaining({
        path: "docs/superpowers/specs/design.md",
        version: "d47536a552c7d588b2f963e478ae99369f720783",
        expectedBlobId: "fb57e087c19ce0a3c78b4d591bb5da63027c2b3b",
      }),
    }));
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-WRITER-EXHAUSTED",
        status: "input-required",
        idempotentReplay: true,
        requiresApproval: false,
        resumable: false,
        waitReason: "terminal-writer-retry-exhausted",
        structuredContent: {
          error: "terminal_writer_retry_exhausted",
          attempt: 3,
          writerToolName: "record_initiative_evidence",
          action: "select-different-reviewer-provider",
        },
      },
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-WRITER-EXHAUSTED" },
      data: expect.objectContaining({
        status: "input-required",
        progressPayload: expect.objectContaining({
          terminalWriterWait: expect.objectContaining({
            attempt: 3,
            dispatchContract: "required-tool-call",
            noncompliance: "prose-without-required-writer",
          }),
          terminalWriterEscalation: expect.objectContaining({
            schemaVersion: 1,
            code: "terminal_writer_retry_exhausted",
            attempt: 3,
            writerToolName: "record_initiative_evidence",
            action: "select-different-reviewer-provider",
          }),
        }),
      }),
    });
  });

  it("replays an exhausted terminal-writer escalation without starting another attempt", async () => {
    const exhaustedParams = { ...params, idempotencyKey: "missing-writer-already-escalated" };
    const metadata = await persistedMetadata("PAT-WRITER-ALREADY-ESCALATED", exhaustedParams);
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal", taskRunId: "TR-MCP-WRITER-ALREADY-ESCALATED",
      threadId: "thread-external", contextId: "thread-external", status: "input-required",
      updatedAt: new Date("2026-09-01T02:22:19.238Z"),
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1, kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence", resumeMode: "same-taskrun", attempt: 3,
          observedAt: "2026-09-01T02:22:19.237Z",
        },
        terminalWriterEscalation: {
          schemaVersion: 1, code: "terminal_writer_retry_exhausted",
          writerToolName: "record_initiative_evidence", attempt: 3,
          action: "select-different-reviewer-provider",
          observedAt: "2026-09-01T02:22:19.237Z",
        },
      },
      a2aMetadata: metadata,
    });

    const outcome = await submit("PAT-WRITER-ALREADY-ESCALATED", exhaustedParams);

    expect(db.updateMany).not.toHaveBeenCalled();
    expect(autonomous.executeTool).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-WRITER-ALREADY-ESCALATED",
        status: "input-required",
        idempotentReplay: true,
        requiresApproval: false,
        resumable: false,
        waitReason: "terminal-writer-retry-exhausted",
        structuredContent: {
          error: "terminal_writer_retry_exhausted",
          attempt: 3,
          writerToolName: "record_initiative_evidence",
          action: "select-different-reviewer-provider",
        },
      },
    });
  });

  it("turns a preserved bounded-hydration truncation into a concrete non-resumable escalation", async () => {
    const truncatedParams = { ...params, idempotencyKey: "terminal-writer-context-truncated" };
    const metadata = await persistedMetadata("PAT-WRITER-CONTEXT-TRUNCATED", truncatedParams);
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal", taskRunId: "TR-MCP-WRITER-CONTEXT-TRUNCATED",
      threadId: "thread-external", contextId: "thread-external", status: "input-required",
      updatedAt: new Date("2026-09-01T01:18:36.677Z"),
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1, kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence", resumeMode: "same-taskrun", attempt: 2,
          observedAt: "2026-09-01T01:18:33.353Z",
        },
        terminalWriterContextFailure: {
          code: "terminal_writer_context_truncated",
          message: "The immutable source remained truncated after the bounded hydration budget.",
          observedAt: "2026-09-01T01:18:36.676Z",
        },
      },
      a2aMetadata: metadata,
    });

    const outcome = await submit("PAT-WRITER-CONTEXT-TRUNCATED", truncatedParams);

    expect(db.updateMany).not.toHaveBeenCalled();
    expect(autonomous.executeTool).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-WRITER-CONTEXT-TRUNCATED",
        status: "input-required",
        idempotentReplay: true,
        requiresApproval: false,
        resumable: false,
        waitReason: "terminal-writer-context-exhausted",
        structuredContent: {
          error: "terminal_writer_context_truncated",
          attempt: 2,
          writerToolName: "record_initiative_evidence",
          action: "select-different-reviewer-provider",
        },
      },
    });
  });

  it("does not hydrate after an unrelated declined writer envelope", async () => {
    const exhaustedParams = { ...params, idempotencyKey: "unrelated-decline" };
    const metadata = await persistedMetadata("PAT-WRITER-UNRELATED-DECLINE", exhaustedParams);
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-WRITER-UNRELATED-DECLINE",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "input-required",
      updatedAt: new Date("2026-08-28T07:25:00.000Z"),
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 2,
          observedAt: "2026-08-28T07:24:00.000Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.findToolExecutions.mockResolvedValue([persistedReaderExecution]);
    db.findToolExecution.mockImplementation(async (query: { where?: { toolName?: unknown; success?: unknown } }) => {
      if (query.where?.toolName !== "record_initiative_evidence" || query.where?.success === true) return null;
      return {
        id: "writer-proposal",
        toolName: "record_initiative_evidence",
        success: false,
        result: {
          success: false,
          error: "approval_required",
          data: { envelopeId: "exact-envelope" },
        },
      };
    });
    db.findEnvelope.mockImplementation(async (query: { where?: { id?: unknown; status?: unknown } }) => {
      if (query.where?.status === "approved") return null;
      return {
        id: "unrelated-envelope",
        manifestActionId: "record_initiative_evidence",
        status: "declined",
      };
    });

    const outcome = await submit("PAT-WRITER-UNRELATED-DECLINE", exhaustedParams);

    expect(autonomous.executeTool).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-WRITER-UNRELATED-DECLINE",
        status: "input-required",
        idempotentReplay: true,
      },
    });
  });
});
