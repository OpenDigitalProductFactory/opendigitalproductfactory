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
  findTaskMessage: vi.fn(),
  findMcpToken: vi.fn(),
  findUser: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  executeTool: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));
const records = vi.hoisted(() => ({ create: vi.fn() }));

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
    taskMessage: { findFirst: (...args: unknown[]) => db.findTaskMessage(...args) },
    mcpApiToken: { findUnique: (...args: unknown[]) => db.findMcpToken(...args) },
    user: { findUnique: (...args: unknown[]) => db.findUser(...args) },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: (...args: unknown[]) => records.create(...args),
}));

import { resumeRemoteCoworkerTaskById } from "./mcp-task-capacity-resume";
import { submitRemoteCoworkerTask } from "./mcp-task-submit";

const userContext = { platformRole: "developer", isSuperuser: false };
const immutableParams = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/platform/build",
  title: "Independent design review",
  objective: "Review BI-B131F357 at immutable commit 544830a.",
  prompt: "Review BI-B131F357 at immutable commit 544830a.",
  idempotencyKey: "initiative-review:BI-B131F357:544830a",
  riskClass: "high-risk",
  authorityScope: ["initiative_design_review"],
  collaborationKind: "summon",
};

function submit(tokenId: string, params: Record<string, unknown> = immutableParams) {
  return submitRemoteCoworkerTask({
    token: { tokenId, userId: "user-1", capability: "write", source: "pat" },
    userContext,
    params,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DPF_EXTERNAL_MCP_TASK_ASYNC", "0");
  db.findFirst.mockResolvedValue(null);
  db.findUnique.mockResolvedValue({ status: "working" });
  db.findEnvelope.mockResolvedValue(null);
  db.findToolExecution.mockResolvedValue(null);
  db.findModelConfig.mockResolvedValue({
    minimumTier: "strong",
    budgetClass: "quality_first",
    pinnedProviderId: "local",
    pinnedModelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
  });
  db.findTaskMessage.mockResolvedValue(null);
  db.findMcpToken.mockResolvedValue(null);
  db.findUser.mockResolvedValue({ isSuperuser: false, groups: [] });
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
  autonomous.resolveTools.mockResolvedValue({
    tools: [],
    toolsForProvider: [],
    deferredTools: [],
  });
  autonomous.execute.mockResolvedValue({ content: "Done.", executedTools: [] });
  autonomous.executeTool.mockResolvedValue({ success: true, message: "Receipt recorded.", entityId: "REC-1" });
});

describe("submitRemoteCoworkerTask capacity recovery", () => {
  it.each(["capacity", "busy"] as const)(
    "keeps a zero-tool %s result waiting on the original TaskRun",
    async (failureKind) => {
      autonomous.execute.mockResolvedValue({
        content: `Provider ${failureKind}.`,
        executedTools: [],
        failure: { kind: failureKind, message: `Provider ${failureKind}.` },
      });

      const outcome = await submit("PAT-CAPACITY", {
        ...immutableParams,
        riskClass: "bounded-write",
      });

      expect(db.update).toHaveBeenLastCalledWith({
        where: { taskRunId: expect.stringMatching(/^TR-MCP-/) },
        data: {
          status: "submitted",
          completedAt: null,
          progressPayload: {
            summary: `Provider ${failureKind}.`,
            riskClass: "bounded-write",
            executedToolCount: 0,
            resourceWait: {
              schemaVersion: 1,
              kind: "provider-capacity",
              failureKind,
              resumeMode: "same-taskrun",
              attempt: 1,
              observedAt: expect.any(String),
            },
          },
        },
      });
      expect(outcome).toMatchObject({
        kind: "result",
        result: {
          status: "submitted",
          idempotentReplay: false,
          requiresApproval: false,
          executedToolCount: 0,
          resumable: true,
          waitReason: "provider-capacity",
          isError: false,
        },
      });
    },
  );

  it("resumes the exact waiting TaskRun without changing its immutable identity", async () => {
    const params = {
      ...immutableParams,
      riskClass: "bounded-write",
      idempotencyKey: "same-taskrun-capacity-resume",
    };
    autonomous.execute.mockResolvedValueOnce({
      content: "Provider busy.",
      executedTools: [],
      failure: { kind: "busy", message: "Provider busy." },
    });
    await submit("PAT-RESUME", params);
    const metadata = (autonomous.create.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    }).metadata;

    vi.clearAllMocks();
    const updatedAt = new Date("2026-08-28T01:00:00.000Z");
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-SAME-RUN",
      userId: "user-1",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "submitted",
      updatedAt,
      progressPayload: {
        summary: "Provider busy.",
        riskClass: "bounded-write",
        executedToolCount: 0,
        resourceWait: {
          schemaVersion: 1,
          kind: "provider-capacity",
          failureKind: "busy",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-28T00:59:00.000Z",
        },
      },
      a2aMetadata: metadata,
    });
    db.updateMany.mockResolvedValue({ count: 1 });
    db.findUnique.mockResolvedValue({ status: "working" });
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "build-specialist",
      displayName: "Build Lead",
      systemPrompt: "Review the immutable artifact.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
    autonomous.execute.mockResolvedValue({ content: "Receipt recorded.", executedTools: [{ name: "record_initiative_evidence" }] });

    const outcome = await submit("PAT-RESUME", params);

    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        taskRunId: "TR-MCP-SAME-RUN",
        status: "submitted",
        updatedAt,
      },
      data: {
        status: "working",
        lastHeartbeatAt: expect.any(Date),
        completedAt: null,
        progressPayload: expect.objectContaining({
          resourceWait: expect.objectContaining({ attempt: 1 }),
          resumeReservedAt: expect.any(String),
        }),
      },
    });
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-SAME-RUN",
      threadId: "thread-external",
    }));
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-SAME-RUN",
        status: "completed",
        idempotentReplay: true,
        resumedFromCapacity: true,
        executedToolCount: 1,
      },
    });
  });

  it("lets only one exact replay reserve a waiting TaskRun", async () => {
    const params = {
      ...immutableParams,
      riskClass: "bounded-write",
      idempotencyKey: "same-taskrun-capacity-cas-loss",
    };
    await submit("PAT-RESUME-LOSER", params);
    const metadata = (autonomous.create.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    }).metadata;

    vi.clearAllMocks();
    const waiting = {
      id: "task-internal",
      taskRunId: "TR-MCP-SAME-RUN",
      userId: "user-1",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "submitted",
      updatedAt: new Date("2026-08-28T01:00:00.000Z"),
      progressPayload: {
        resourceWait: {
          schemaVersion: 1,
          kind: "provider-capacity",
          failureKind: "capacity",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-08-28T00:59:00.000Z",
        },
      },
      a2aMetadata: metadata,
    };
    db.findFirst.mockResolvedValue(waiting);
    db.updateMany.mockResolvedValue({ count: 0 });
    db.findUnique.mockResolvedValue({
      ...waiting,
      status: "working",
      updatedAt: new Date("2026-08-28T01:00:01.000Z"),
    });

    const outcome = await submit("PAT-RESUME-LOSER", params);

    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-SAME-RUN",
        status: "working",
        idempotentReplay: true,
      },
    });
  });

  it("lets a trusted capacity event resume by TaskRun ID from server-owned immutable state", async () => {
    const params = {
      ...immutableParams,
      riskClass: "bounded-write",
      idempotencyKey: "server-owned-capacity-resume",
      authorityScope: [
        "backlog-item:BI-42CE2CE7",
        "tool:read_source_at_version",
        "tool:record_initiative_evidence",
      ],
    };
    autonomous.execute.mockResolvedValueOnce({
      content: "Provider busy.",
      executedTools: [],
      failure: { kind: "busy", message: "Provider busy." },
    });
    await submit("PAT-EVENT", params);
    const createInput = autonomous.create.mock.calls[0]?.[0] as {
      taskRunId: string;
      metadata: Record<string, unknown>;
      authorityScope: string[];
    };

    vi.clearAllMocks();
    const updatedAt = new Date("2026-08-28T01:10:00.000Z");
    db.findUnique
      .mockResolvedValueOnce({
        id: "task-internal",
        taskRunId: createInput.taskRunId,
        userId: "user-1",
        threadId: "thread-external",
        contextId: "thread-external",
        initiatingAgentId: params.agentId,
        routeContext: params.routeContext,
        title: params.title,
        objective: params.objective,
        authorityScope: createInput.authorityScope,
        status: "submitted",
        updatedAt,
        progressPayload: {
          resourceWait: {
            schemaVersion: 1,
            kind: "provider-capacity",
            failureKind: "busy",
            resumeMode: "same-taskrun",
            attempt: 1,
            observedAt: "2026-08-28T01:09:00.000Z",
          },
        },
        a2aMetadata: createInput.metadata,
      })
      .mockResolvedValue({ status: "working" });
    db.findTaskMessage.mockResolvedValue({
      parts: [{ type: "message", text: params.prompt }],
    });
    db.findMcpToken.mockResolvedValue({
      userId: "user-1",
      capability: "write",
      revokedAt: null,
      expiresAt: null,
    });
    db.findUser.mockResolvedValue({ isSuperuser: false, groups: [] });
    db.updateMany.mockResolvedValue({ count: 1 });
    db.update.mockResolvedValue({});
    db.findModelConfig.mockResolvedValue({
      minimumTier: "strong",
      budgetClass: "quality_first",
      pinnedProviderId: "local",
      pinnedModelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
    });
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "build-specialist",
      displayName: "Build Lead",
      systemPrompt: "Review the immutable artifact.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
    autonomous.execute.mockResolvedValue({ content: "Receipt recorded.", executedTools: [] });

    const outcome = await resumeRemoteCoworkerTaskById(createInput.taskRunId);

    expect(db.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { taskRunId: createInput.taskRunId },
    }));
    expect(db.findMcpToken).toHaveBeenCalledWith({
      where: { id: "PAT-EVENT" },
      select: {
        userId: true,
        capability: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: createInput.taskRunId,
      threadId: "thread-external",
      userId: "user-1",
      chatHistory: [{ role: "user", content: params.prompt }],
    }));
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: createInput.taskRunId,
        status: "completed",
        idempotentReplay: true,
        resumedFromCapacity: true,
      },
    });
  });

  it("refuses an event resume when the original durable request is missing", async () => {
    db.findUnique.mockResolvedValue(null);

    const outcome = await resumeRemoteCoworkerTaskById("TR-MCP-MISSING");

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-MISSING",
        isError: true,
        structuredContent: { error: "stored_resume_state_incomplete" },
      },
    });
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
  });

  it.each([
    { failureKind: "unknown", executedTools: [] },
    { failureKind: "busy", executedTools: [{ name: "read_source_at_version" }] },
  ])(
    "keeps $failureKind with $executedTools.length prior tools terminal and fail-closed",
    async ({ failureKind, executedTools }) => {
      autonomous.execute.mockResolvedValue({
        content: "Execution could not finish.",
        executedTools,
        failure: { kind: failureKind, message: "Execution could not finish." },
      });

      const outcome = await submit("PAT-TERMINAL", {
        ...immutableParams,
        riskClass: "bounded-write",
      });

      expect(db.update).toHaveBeenLastCalledWith({
        where: { taskRunId: expect.stringMatching(/^TR-MCP-/) },
        data: {
          status: "failed",
          completedAt: expect.any(Date),
          progressPayload: {
            summary: "Execution could not finish.",
            riskClass: "bounded-write",
            executedToolCount: executedTools.length,
            failureKind,
          },
        },
      });
      expect(outcome).toMatchObject({
        kind: "result",
        result: {
          status: "failed",
          isError: true,
          resumable: false,
          executedToolCount: executedTools.length,
        },
      });
    },
  );

});
