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

describe("disposition correction", () => {
  it("BI-31159978 resumes a rejected second-turn disposition on the same immutable TaskRun", async () => {
    const metadata = await persistedMetadata("PAT-DISPOSITION-RECOVERY");
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      id: "task-internal", taskRunId: "TR-MCP-DISPOSITION", threadId: "thread-external", contextId: "thread-external",
      status: "input-required", updatedAt: new Date("2026-09-06T10:00:00Z"), a2aMetadata: metadata,
      progressPayload: { terminalWriterWait: {
        schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: "record_initiative_evidence",
        resumeMode: "same-taskrun", attempt: 2, observedAt: "2026-09-06T10:00:00Z",
      } },
    });
    db.findToolExecutions.mockResolvedValue([persistedReaderExecution]);
    db.findToolExecution.mockImplementation(async (query: { where?: { success?: boolean } }) => query.where?.success
      ? null : { id: "rejected-writer", success: false, result: {
        success: false, error: "malformed-receipt", message: "A passing spec approval cannot introduce findings.",
      } });
    db.findEnvelope.mockResolvedValue(null);
    db.findUnique.mockResolvedValue({ status: "working" });
    const outcome = await submit("PAT-DISPOSITION-RECOVERY");
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-DISPOSITION",
      systemPrompt: expect.stringContaining("A passing spec approval cannot introduce findings."),
    }));
    expect(outcome).toMatchObject({ kind: "result", result: { taskRunId: "TR-MCP-DISPOSITION" } });
  });

});
