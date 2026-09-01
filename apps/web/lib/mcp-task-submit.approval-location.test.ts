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
vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: vi.fn(),
}));

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
    pinnedModelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
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

describe("submitRemoteCoworkerTask approval location", () => {
  it("attaches the pending envelope location when a governed writer pauses", async () => {
    db.findUnique.mockResolvedValue({ status: "input-required" });
    db.findEnvelope.mockResolvedValue({
      id: "cmthpk6kpfylj01lc5r5cealp",
      delegatingUserId: "user-1",
      taskRunId: "TR-MCP-VISIBLE",
      status: "proposed",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      rationale: "Record research evidence.",
      manifestActionId: "record_initiative_evidence",
    });

    const outcome = await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-A", userId: "user-1", capability: "write", source: "pat" },
      userContext,
      params: { ...immutableParams, riskClass: "bounded-write" },
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        status: "input-required",
        requiresApproval: true,
        approval: {
          envelopeId: "cmthpk6kpfylj01lc5r5cealp",
          delegatingUserId: "user-1",
          inboxHref: "/workspace/inbox",
          approveHref: "/api/agent/envelope/cmthpk6kpfylj01lc5r5cealp/approve",
        },
      },
    });
    expect(db.findEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        delegatingUserId: "user-1",
        status: "proposed",
      }),
    }));
  });
});
