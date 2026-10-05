import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findModelConfig: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsertThread: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
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
    coworkerActionEnvelope: { findFirst: vi.fn() },
    toolExecution: { findFirst: vi.fn() },
    agentThread: { upsert: (...args: unknown[]) => db.upsertThread(...args) },
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: vi.fn(),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));

import { submitRemoteCoworkerTask } from "./mcp-task-submit";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DPF_EXTERNAL_MCP_TASK_ASYNC", "0");
  db.findFirst.mockResolvedValue(null);
  db.findUnique.mockResolvedValue({ status: "working" });
  db.findModelConfig.mockResolvedValue({
    minimumTier: "strong",
    budgetClass: "quality_first",
    pinnedProviderId: "local",
    pinnedModelId: "local-model",
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
    agentId: "reviewer",
    displayName: "Reviewer",
    systemPrompt: "Review the request.",
    sensitivity: "internal",
  });
  autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  autonomous.execute.mockResolvedValue({ content: "Done.", executedTools: [] });
});

describe("remote TaskRun request packet", () => {
  it("replays the saved review after an additive grant without reviving a canceled task", async () => {
    const params = parseRemoteTaskSubmitParams({
      agentId: "AGT-WS-REVIEW", routeContext: "/build", title: "Review",
      objective: "Review design", prompt: "Review design", riskClass: "bounded-write", idempotencyKey: "review:stable",
      authorityScope: ["initiative_design_review", "backlog-item:BI-TEST", "tool:record_initiative_design_review", "tool:read_source_at_version"],
      initiativeReviewBinding: { writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "spec-approval",
        artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) } },
    });
    if (typeof params === "string") throw new Error(params);
    db.findFirst.mockResolvedValue({ taskRunId: "task-original", status: "canceled",
      authorityScope: params.authorityScope, progressPayload: {},
      a2aMetadata: { requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(params) } });
    const outcome = await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-REPLAY", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      params: { ...params, authorityScope: [...params.authorityScope!, "payables_read"] },
    });
    expect(outcome).toMatchObject({ kind: "result", result: { taskRunId: "task-original", status: "canceled", idempotentReplay: true, resumable: false } });
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("persists the complete normalized objective in server-owned metadata", async () => {
    const objective = `Review the complete remote request packet. ${"evidence ".repeat(150)}`.trim();

    await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-LONG", userId: "user-1", capability: "write", source: "pat" },
      userContext: { platformRole: "developer", isSuperuser: false },
      params: {
        agentId: "AGT-WS-REVIEW",
        routeContext: "/platform/build",
        title: "Long immutable request",
        objective,
        prompt: "Review the complete packet.",
        idempotencyKey: "remote-packet:long-objective",
        riskClass: "bounded-write",
        authorityScope: [],
      },
    });

    expect(objective.length).toBeGreaterThan(1_000);
    expect(autonomous.create).toHaveBeenCalledWith(expect.objectContaining({
      objective,
      metadata: expect.objectContaining({ requestObjective: objective }),
    }));
  });
});
