import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsertThread: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({ create: vi.fn(), execute: vi.fn() }));
const records = vi.hoisted(() => ({ create: vi.fn() }));
const queue = vi.hoisted(() => ({ send: vi.fn() }));

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
    agentModelConfig: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: (...args: unknown[]) => autonomous.create(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  executeAutonomousWorkTool: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(),
  resolveAutonomousWorkTools: vi.fn(),
}));
vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: (...args: unknown[]) => records.create(...args),
}));
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: (...args: unknown[]) => queue.send(...args) },
}));

import {
  parseRemoteTaskSubmitParams,
  submitRemoteCoworkerTask,
} from "./mcp-task-submit";
import { DURABLE_INFERENCE_TASK_RECIPE_ID } from "./mcp-task-durable-inference-contract";

const params = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/research",
  title: "Durable bounded inference",
  objective: "Produce one durable answer.",
  prompt: "Produce one durable answer.",
  idempotencyKey: "durable:one-shot:1",
  riskClass: "read",
  authorityScope: [] as string[],
  recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DPF_EXTERNAL_MCP_TASK_ASYNC", "0");
  vi.stubEnv("MCP_TASKS_LIFECYCLE", "on");
  db.findFirst.mockResolvedValue(null);
  db.findUnique.mockResolvedValue(null);
  db.upsertThread.mockResolvedValue({ id: "thread-1" });
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  queue.send.mockResolvedValue({ ids: ["event-1"] });
  autonomous.create.mockImplementation(async (input: Record<string, unknown>) => {
    const deferred = input["deferredSubmission"] as { progressPayload?: unknown } | undefined;
    db.findUnique.mockResolvedValue({
      status: "submitted",
      updatedAt: new Date("2026-09-04T12:00:00.000Z"),
      progressPayload: deferred?.progressPayload ?? null,
    });
    return {
      id: "task-row-1",
      taskRunId: input["taskRunId"],
      contextId: "thread-1",
    };
  });
});

describe("tasks/submit closed durable inference mode", () => {
  it("accepts only the explicit no-tool read recipe", () => {
    expect(parseRemoteTaskSubmitParams(params)).toMatchObject({
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    });
    expect(parseRemoteTaskSubmitParams({
      ...params,
      recipeId: "durable-inference.unseeded.v1",
    })).toBe(`tasks/submit params.recipeId must be ${DURABLE_INFERENCE_TASK_RECIPE_ID}`);
    expect(parseRemoteTaskSubmitParams({ ...params, riskClass: "bounded-write" }))
      .toBe("tasks/submit durable-inference recipe requires params.riskClass read");
    expect(parseRemoteTaskSubmitParams({ ...params, authorityScope: ["tool:list_backlog_items"] }))
      .toBe("tasks/submit durable-inference recipe does not accept tool authority or initiative review bindings");
    expect(parseRemoteTaskSubmitParams({ ...params, operationId: "attacker-value" }))
      .toBe("tasks/submit durable-inference recipe does not accept params.operationId");
  });

  it("rejects unknown routing fields before creating a TaskRun", async () => {
    await expect(submitRemoteCoworkerTask({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "read", source: "pat" },
      userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
      params: { ...params, operationId: "attacker-value" },
    })).resolves.toEqual({
      kind: "invalid_params",
      message: "tasks/submit durable-inference recipe does not accept params.operationId",
    });
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("persists the immutable recipe and queues before inference even when generic background mode is off", async () => {
    const outcome = await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "read", source: "pat" },
      userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
      params,
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { status: "submitted", asynchronous: true, idempotentReplay: false },
    });
    expect(autonomous.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID },
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
      deferredSubmission: expect.objectContaining({
        content: params.prompt,
        metadata: {
          source: "mcp.tasks/submit",
          idempotencyKey: params.idempotencyKey,
          riskClass: "read",
          apiTokenId: "PAT-1",
        },
        progressPayload: {
          dispatch: expect.objectContaining({
            state: "pending",
            eventId: expect.stringMatching(/:execute:1$/u),
          }),
        },
      }),
    }));
    expect(records.create).not.toHaveBeenCalled();
    expect(queue.send).toHaveBeenCalledOnce();
    expect(autonomous.execute).not.toHaveBeenCalled();
  });

  it("rejects the durable recipe before TaskRun creation when lifecycle methods are disabled", async () => {
    vi.stubEnv("MCP_TASKS_LIFECYCLE", "off");

    await expect(submitRemoteCoworkerTask({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "read", source: "pat" },
      userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
      params,
    })).resolves.toEqual({
      kind: "invalid_params",
      message: "tasks/submit durable-inference recipe requires the MCP Tasks lifecycle surface",
    });
    expect(db.findFirst).not.toHaveBeenCalled();
    expect(autonomous.create).not.toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("rejects same-key replay on a different requested thread", async () => {
    const firstParams = { ...params, threadId: "thread-a" };
    await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "read", source: "pat" },
      userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
      params: firstParams,
    });
    const metadata = (autonomous.create.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    }).metadata;
    vi.clearAllMocks();
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-EXISTING",
      status: "completed",
      progressPayload: null,
      a2aMetadata: metadata,
    });

    const outcome = await submitRemoteCoworkerTask({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "read", source: "pat" },
      userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
      params: { ...params, threadId: "thread-b" },
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        isError: true,
        structuredContent: { error: "idempotency_conflict", taskRunId: "TR-MCP-EXISTING" },
      },
    });
    expect(autonomous.create).not.toHaveBeenCalled();
  });

  it("preserves a legacy digest only for its separately stored thread", async () => {
    const threadedParams = { ...params, threadId: "thread-a" };
    db.findFirst.mockResolvedValue({
      taskRunId: "TR-MCP-LEGACY",
      status: "completed",
      progressPayload: null,
      a2aMetadata: {
        idempotencyKey: params.idempotencyKey,
        apiTokenId: "PAT-1",
        requestedThreadId: "thread-a",
        requestDigest: createHash("sha256").update(JSON.stringify({
          agentId: params.agentId,
          routeContext: params.routeContext,
          title: params.title,
          objective: params.objective,
          prompt: params.prompt,
          riskClass: params.riskClass,
          authorityScope: [],
          collaborationKind: null,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        })).digest("hex"),
      },
    });

    await expect(submitRemoteCoworkerTask({
      token: { tokenId: "PAT-1", userId: "user-1", capability: "read", source: "pat" },
      userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
      params: threadedParams,
    })).resolves.toMatchObject({
      kind: "result",
      result: { taskRunId: "TR-MCP-LEGACY", idempotentReplay: true },
    });
  });
});
