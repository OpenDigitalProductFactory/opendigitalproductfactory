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
}));
const autonomous = vi.hoisted(() => ({
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
    coworkerActionEnvelope: {
      findFirst: (...args: unknown[]) => db.findEnvelope(...args),
    },
    toolExecution: {
      findFirst: (...args: unknown[]) => db.findToolExecution(...args),
      findMany: (...args: unknown[]) => db.findToolExecutions(...args),
    },
    agentModelConfig: {
      findUnique: (...args: unknown[]) => db.findModelConfig(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: vi.fn(),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp-task-submit-approval-recovery", () => ({
  recoverStaleApprovalOnReplay: vi.fn(async () => null),
  resumeApprovedRemoteTask: vi.fn(async () => null),
}));

import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { submitRemoteCoworkerTask } from "./mcp-task-submit";

const params = {
  agentId: "AGT-WS-BUILD",
  routeContext: "/platform/build",
  title: "Independent research review",
  objective: "Review the immutable source and record research evidence.",
  prompt: "Read the exact source and record the governed evidence.",
  idempotencyKey: "terminal-writer-crossed-stale-threshold",
  riskClass: "bounded-write" as const,
  authorityScope: [
    "backlog-item:BI-E2B632D2",
    "tool:read_source_at_version",
    "tool:record_initiative_evidence",
  ],
  collaborationKind: "handoff" as const,
  initiativeReviewBinding: {
    writerToolName: "record_initiative_evidence",
    itemId: "BI-E2B632D2",
    gate: "research" as const,
    artifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "4100d18ad75cc29602f8857db0de2901f185effb",
      path: "apps/web/lib/mcp-task-submit.ts",
      providerBlobId: "f05787443eb00b0c22f22f7c7bc683cd81cfaf49",
    },
  },
};

const readerExecution = {
  id: "reader-1",
  toolName: "read_source_at_version",
  parameters: {
    repositoryFullName: params.initiativeReviewBinding.artifactRef.repositoryFullName,
    path: params.initiativeReviewBinding.artifactRef.path,
    version: params.initiativeReviewBinding.artifactRef.commitSha,
    expectedBlobId: params.initiativeReviewBinding.artifactRef.providerBlobId,
    startLine: 1,
    maxChars: 3_200,
  },
  result: {},
  success: true,
  createdAt: new Date("2026-09-01T04:11:43.124Z"),
};

describe("reaper-stalled terminal writer resumption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const updatedAt = new Date("2026-09-01T04:17:00.140Z");
    db.findFirst.mockResolvedValue({
      id: "task-internal",
      taskRunId: "TR-MCP-REAPER-STALLED",
      userId: "user-1",
      threadId: "thread-external",
      contextId: "thread-external",
      status: "stalled",
      lastHeartbeatAt: new Date("2026-09-01T04:16:32.587Z"),
      completedAt: updatedAt,
      updatedAt,
      progressPayload: {
        terminalWriterWait: {
          schemaVersion: 1,
          kind: "missing-terminal-writer",
          writerToolName: "record_initiative_evidence",
          resumeMode: "same-taskrun",
          attempt: 1,
          observedAt: "2026-09-01T04:12:32.612Z",
          dispatchContract: "required-tool-call",
        },
      },
      a2aMetadata: {
        requestDigest: remoteTaskRequestDigest(params),
        idempotencyKey: params.idempotencyKey,
        initiativeReviewBinding: params.initiativeReviewBinding,
      },
    });
    db.findEnvelope.mockResolvedValue(null);
    db.findToolExecution.mockResolvedValue(null);
    db.findToolExecutions.mockResolvedValue([readerExecution]);
    db.findModelConfig.mockResolvedValue({
      minimumTier: "strong",
      budgetClass: "quality_first",
      pinnedProviderId: "local",
      pinnedModelId: "review-model",
    });
    db.update.mockResolvedValue({});
    db.updateMany.mockResolvedValue({ count: 1 });
    db.findUnique.mockResolvedValue({ status: "working" });
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "build-specialist",
      displayName: "Build Lead",
      systemPrompt: "Review the immutable source.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({
      tools: [],
      toolsForProvider: [],
      deferredTools: [],
    });
    autonomous.execute.mockResolvedValue({
      content: "The governed local inference provider is still at capacity.",
      executedTools: [],
      failure: { kind: "capacity", message: "No local inference slot is available." },
    });
  });

  it("reserves and resumes the same exact-bound TaskRun after a reaper stall", async () => {
    const outcome = await submitRemoteCoworkerTask({
      token: {
        tokenId: "token-research",
        userId: "user-1",
        capability: "write",
        source: "pat",
      },
      userContext: { platformRole: "developer", isSuperuser: false },
      params,
    });

    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        taskRunId: "TR-MCP-REAPER-STALLED",
        status: "stalled",
        updatedAt: new Date("2026-09-01T04:17:00.140Z"),
      },
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
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-REAPER-STALLED",
      threadId: "thread-external",
      terminalToolPolicy: expect.objectContaining({
        terminalPhase: "writer-only",
        persistedEvidenceAvailable: true,
      }),
    }));
    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        taskRunId: "TR-MCP-REAPER-STALLED",
        idempotentReplay: true,
        resumedFromTerminalWriterWait: true,
      },
    });
  });
});
