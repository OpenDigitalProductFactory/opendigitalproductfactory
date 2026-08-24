import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  upsertThread: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));
const records = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findFirst: (...args: unknown[]) => db.findFirst(...args), update: (...args: unknown[]) => db.update(...args) },
    agentThread: { upsert: (...args: unknown[]) => db.upsertThread(...args) },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: (...args: unknown[]) => records.create(...args),
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

function submit(tokenId: string, params: Record<string, unknown> = immutableParams) {
  return submitRemoteCoworkerTask({
    token: { tokenId, userId: "user-1", capability: "write", source: "pat" },
    userContext,
    params,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findFirst.mockResolvedValue(null);
  db.upsertThread.mockResolvedValue({ id: "thread-external" });
  db.update.mockResolvedValue({});
  autonomous.create.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "task-internal",
    taskRunId: input["taskRunId"],
    contextId: "thread-external",
  }));
});

describe("submitRemoteCoworkerTask idempotency", () => {
  it("binds a deterministic TaskRun and immutable digest to token + requestKey", async () => {
    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({ kind: "result", result: { idempotentReplay: false } });
    const createInput = autonomous.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createInput["taskRunId"]).toMatch(/^TR-MCP-[A-F0-9]{12}$/);
    expect(createInput).toMatchObject({
      agentId: "AGT-WS-REVIEW",
      sourceRef: { kind: "mcp-token", id: "PAT-A" },
      metadata: {
        idempotencyKey: "initiative-review:BI-B131F357:544830a",
        collaborationKind: "summon",
        apiTokenId: "PAT-A",
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "user-1",
        AND: expect.arrayContaining([
          { a2aMetadata: { path: ["apiTokenId"], equals: "PAT-A" } },
        ]),
      }),
    }));
  });

  it("replays only the same immutable request", async () => {
    await submit("PAT-A");
    const metadata = (autonomous.create.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }).metadata;
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-EXISTING",
      status: "completed",
      progressPayload: { summary: "approved" },
      a2aMetadata: metadata,
    });

    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({
      kind: "result",
      result: { taskRunId: "TR-MCP-EXISTING", idempotentReplay: true },
    });
    expect(autonomous.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of a request key with a changed immutable packet", async () => {
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-EXISTING",
      status: "completed",
      progressPayload: null,
      a2aMetadata: { ...immutableParams, apiTokenId: "PAT-A", requestDigest: "0".repeat(64) },
    });

    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        isError: true,
        structuredContent: { error: "idempotency_conflict", taskRunId: "TR-MCP-EXISTING" },
      },
    });
    expect(autonomous.create).not.toHaveBeenCalled();
  });

  it("does not share task identity across tokens with the same request key", async () => {
    await submit("PAT-A");
    await submit("PAT-B");

    const firstId = (autonomous.create.mock.calls[0]?.[0] as Record<string, unknown>)["taskRunId"];
    const secondId = (autonomous.create.mock.calls[1]?.[0] as Record<string, unknown>)["taskRunId"];
    expect(firstId).not.toBe(secondId);
  });

  it("converts a concurrent deterministic-id collision into a replay", async () => {
    autonomous.create.mockRejectedValueOnce({ code: "P2002" });
    db.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        taskRunId: "TR-MCP-CONCURRENT",
        status: "working",
        progressPayload: null,
        // Rows from before request digests were introduced remain replayable,
        // but the lookup is still scoped to this exact PAT.
        a2aMetadata: { idempotencyKey: immutableParams.idempotencyKey, apiTokenId: "PAT-A" },
      });

    const outcome = await submit("PAT-A");

    expect(outcome).toMatchObject({
      kind: "result",
      result: { taskRunId: "TR-MCP-CONCURRENT", idempotentReplay: true },
    });
    expect(db.findFirst).toHaveBeenCalledTimes(2);
  });
});
