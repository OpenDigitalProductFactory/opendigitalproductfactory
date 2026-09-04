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
  db.findFirst.mockResolvedValue(null);
  db.findUnique.mockResolvedValue({ status: "submitted" });
  db.upsertThread.mockResolvedValue({ id: "thread-1" });
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  queue.send.mockResolvedValue({ ids: ["event-1"] });
  autonomous.create.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "task-row-1",
    taskRunId: input["taskRunId"],
    contextId: "thread-1",
  }));
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
    }));
    expect(queue.send).toHaveBeenCalledOnce();
    expect(autonomous.execute).not.toHaveBeenCalled();
  });
});
