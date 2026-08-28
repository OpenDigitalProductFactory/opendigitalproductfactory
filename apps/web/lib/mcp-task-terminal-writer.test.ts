import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findModelConfig: vi.fn(),
  findEnvelope: vi.fn(),
  findToolExecution: vi.fn(),
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
    toolExecution: { findFirst: (...args: unknown[]) => db.findToolExecution(...args) },
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
        status: "input-required",
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
        completedAt: null,
        progressPayload: expect.objectContaining({
          terminalWriterWait: expect.objectContaining({ attempt: 2 }),
          resumeReservedAt: expect.any(String),
        }),
      },
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-SAME-WRITER-RUN" },
      data: { status: "working", lastHeartbeatAt: expect.any(Date) },
    });
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

  it("keeps the same TaskRun resumable in a writer-only phase after attempt two", async () => {
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
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecution.mockImplementation(async (query: { where?: { toolName?: unknown } }) => {
      const toolName = query.where?.toolName;
      if (toolName === "record_initiative_evidence") return null;
      return {
        id: "cmtd3zymp00hh01rtpf9ukk8z",
        toolName: "read_source_at_version",
        success: true,
      };
    });
    autonomous.execute.mockResolvedValue({
      content: "The independent review stopped without recording a governed assessment. No receipt was created.",
      executedTools: [],
      failure: {
        kind: "terminal-writer-missing",
        message: "The independent review stopped without recording a governed assessment. No receipt was created.",
      },
    });

    const outcome = await submit("PAT-WRITER-EXHAUSTED", exhaustedParams);

    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-WRITER-EXHAUSTED",
      terminalToolPolicy: expect.objectContaining({
        terminalPhase: "writer-only",
        persistedEvidenceAvailable: true,
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
        resumable: true,
        waitReason: "missing-terminal-writer",
      },
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-MCP-WRITER-EXHAUSTED" },
      data: expect.objectContaining({
        status: "input-required",
        progressPayload: expect.objectContaining({
          terminalWriterWait: expect.objectContaining({ attempt: 3 }),
        }),
      }),
    });
  });
});
