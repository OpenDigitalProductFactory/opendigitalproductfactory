import { beforeEach, vi } from "vitest";

const db = vi.hoisted(() => ({
  persisted: {} as Record<string, unknown>,
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

vi.mock("@dpf/db", async () => ({
  prisma: {
    taskRun: (await import("./task-run-state")).taskRunState(db),
    coworkerActionEnvelope: { findFirst: (...args: unknown[]) => db.findEnvelope(...args) },
    toolExecution: {
      findFirst: (...args: unknown[]) => db.findToolExecution(...args),
      findMany: (...args: unknown[]) => db.findToolExecutions(...args),
    },
    agentThread: { upsert: (...args: unknown[]) => db.upsertThread(...args) },
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tak/autonomous-work-run")>(),
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: (...args: unknown[]) => autonomous.executeTool(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("../coworker-service-catalog/engagement-read-provenance", () => ({ persistEngagementRead: vi.fn() }));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("../mcp-task-review-outcome", () => ({
  loadTaskInitiativeReviewOutcome: vi.fn().mockResolvedValue(null),
  loadInitiativeReviewOutcome: vi.fn().mockResolvedValue({ receiptId: "receipt-1", summary: "Receipt persisted; readiness still requires plan coverage." }),
}));

import { submitRemoteCoworkerTask } from "../mcp-task-submit";

export const userContext = { platformRole: "developer", isSuperuser: false };
export const params = {
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

export const persistedReaderExecution = {
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

export function submit(tokenId: string, request = params) {
  return submitRemoteCoworkerTask({
    token: { tokenId, userId: "user-1", capability: "write", source: "pat" },
    userContext,
    params: request,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.persisted = {};
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
  autonomous.execute.mockResolvedValue({ content: "Done.", providerId: "local", executedTools: [] });
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

export async function persistedMetadata(tokenId: string, request = params) {
  await submit(tokenId, request);
  return (autonomous.create.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }).metadata;
}


export { db, autonomous };
