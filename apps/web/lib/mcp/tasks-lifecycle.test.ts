import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  createMessage: vi.fn(),
  findEnvelope: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findUnique: db.findUnique,
      findMany: db.findMany,
      update: db.update,
    },
    taskMessage: { create: db.createMessage },
    coworkerActionEnvelope: { findUnique: db.findEnvelope },
  },
}));

import {
  bindMcpTaskOwner,
  handleTasksCancel,
  handleTasksGet,
  handleTasksUpdate,
  isTerminalTaskStatus,
  mcpTaskStateForWire,
  shouldAdvertiseTasksCapability,
  tasksExtensionNegotiated,
  tasksLifecycleEnabled,
} from "./tasks-lifecycle";

const auth = { userId: "u1", tokenId: "tok-1", agentId: "AGT-CALLER" };
const row = {
  id: "row-1",
  taskRunId: "TR-1",
  userId: "u1",
  contextId: "ctx-1",
  initiatingAgentId: "AGT-CALLER",
  currentAgentId: "AGT-WORKER",
  mcpOwnerTokenId: "tok-1",
  title: "Long work",
  objective: "Complete the work",
  status: "working",
  progressPayload: null,
  cancellationRequestedAt: null,
  cancellationRequestedByUserId: null,
  createdAt: new Date("2026-08-08T12:00:00.000Z"),
  updatedAt: new Date("2026-08-08T12:00:01.000Z"),
  completedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.findUnique.mockResolvedValue(row);
  db.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...row,
    ...data,
    updatedAt: new Date("2026-08-08T12:00:02.000Z"),
  }));
  db.createMessage.mockResolvedValue({ id: "msg-1" });
});

describe("tasks-lifecycle state adapter", () => {
  it("maps DPF/A2A statuses to MCP extension spelling", () => {
    expect(mcpTaskStateForWire("submitted")).toBe("working");
    expect(mcpTaskStateForWire("working")).toBe("working");
    expect(mcpTaskStateForWire("input-required")).toBe("input_required");
    expect(mcpTaskStateForWire("auth-required")).toBe("input_required");
    expect(mcpTaskStateForWire("completed")).toBe("completed");
    expect(mcpTaskStateForWire("failed")).toBe("failed");
    expect(mcpTaskStateForWire("canceled")).toBe("cancelled");
    expect(mcpTaskStateForWire("rejected")).toBe("failed");
    expect(mcpTaskStateForWire("archived")).toBe("completed");
  });

  it("classifies terminal vs non-terminal statuses", () => {
    for (const status of ["completed", "failed", "canceled", "rejected", "archived"]) {
      expect(isTerminalTaskStatus(status)).toBe(true);
    }
    for (const status of ["submitted", "working", "input-required", "auth-required"]) {
      expect(isTerminalTaskStatus(status)).toBe(false);
    }
  });

  it("recognizes Tasks only from the current request capability map", () => {
    expect(tasksExtensionNegotiated({
      extensions: { "io.modelcontextprotocol/tasks": {} },
    })).toBe(true);
    expect(tasksExtensionNegotiated({ extensions: {} })).toBe(false);
    expect(tasksExtensionNegotiated({})).toBe(false);
  });

  it("is enabled unless MCP_TASKS_LIFECYCLE=off", () => {
    const previous = process.env.MCP_TASKS_LIFECYCLE;
    delete process.env.MCP_TASKS_LIFECYCLE;
    expect(tasksLifecycleEnabled()).toBe(true);
    process.env.MCP_TASKS_LIFECYCLE = "off";
    expect(tasksLifecycleEnabled()).toBe(false);
    if (previous === undefined) delete process.env.MCP_TASKS_LIFECYCLE;
    else process.env.MCP_TASKS_LIFECYCLE = previous;
  });
});

describe("official Tasks application service", () => {
  it("binds an existing durable TaskRun before returning a task handle", async () => {
    db.findUnique.mockResolvedValue({ ...row, mcpOwnerTokenId: null });
    const result = await bindMcpTaskOwner(auth, "TR-1");
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-1" },
      data: { mcpOwnerTokenId: "tok-1" },
    }));
    expect(result).toMatchObject({
      kind: "ok",
      value: {
        resultType: "task",
        taskId: "TR-1",
        status: "working",
        ttlMs: null,
        pollIntervalMs: 2_000,
      },
    });
  });

  it("returns detailed terminal state through tasks/get", async () => {
    db.findUnique.mockResolvedValue({
      ...row,
      status: "completed",
      completedAt: new Date("2026-08-08T12:01:00.000Z"),
      progressPayload: { summary: "Done." },
    });
    const result = await handleTasksGet(auth, { taskId: "TR-1" });
    expect(result).toMatchObject({
      kind: "ok",
      value: {
        resultType: "complete",
        taskId: "TR-1",
        status: "completed",
        result: {
          content: [{ type: "text", text: "Done." }],
          isError: false,
        },
      },
    });
  });

  it("denies a guessed task id from a different MCP caller binding", async () => {
    db.findUnique.mockResolvedValue({ ...row, mcpOwnerTokenId: "tok-other" });
    await expect(handleTasksGet(auth, { taskId: "TR-1" })).resolves.toMatchObject({
      kind: "forbidden",
    });
  });

  it("accepts only outstanding input keys and resumes after the final response", async () => {
    db.findUnique.mockResolvedValue({
      ...row,
      status: "input-required",
      progressPayload: {
        summary: "Waiting for a name",
        inputRequests: {
          name: { method: "elicitation/create", params: { mode: "form" } },
        },
        inputResponses: {},
      },
    });
    const result = await handleTasksUpdate(auth, {
      taskId: "TR-1",
      inputResponses: {
        name: { action: "accept", content: { input: "Luca" } },
        stale: { action: "accept" },
      },
    });
    expect(result).toEqual({ kind: "ok", value: {} });
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-1" },
      data: expect.objectContaining({ status: "working" }),
    }));
  });

  it("does not let an input response self-approve an authority envelope", async () => {
    db.findUnique.mockResolvedValue({
      ...row,
      status: "input-required",
      progressPayload: {
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: { mode: "form" },
            _meta: { approvalEnvelopeId: "CAE-1" },
          },
        },
      },
    });
    db.findEnvelope.mockResolvedValue({ status: "pending" });
    const result = await handleTasksUpdate(auth, {
      taskId: "TR-1",
      inputResponses: { approval: { action: "accept", content: { approved: true } } },
    });
    expect(result).toEqual({ kind: "ok", value: {} });
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("acknowledges cancellation intent without claiming a terminal state", async () => {
    const result = await handleTasksCancel(auth, { taskId: "TR-1" });
    expect(result).toEqual({ kind: "ok", value: {} });
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-1" },
      data: expect.objectContaining({
        cancellationRequestedByUserId: "u1",
        cancellationRequestedAt: expect.any(Date),
      }),
    }));
    expect(db.update.mock.calls[0]?.[0]?.data.status).toBeUndefined();
  });

  it("advertises tasks only on Tasks-aware protocol versions when the flag is on", () => {
    const prev = process.env.MCP_TASKS_LIFECYCLE;
    delete process.env.MCP_TASKS_LIFECYCLE;
    // Pre-Tasks clients (Grok Build 1.0.0 → 2025-06-18, older SDKs) — never advertise.
    expect(shouldAdvertiseTasksCapability("2024-11-05")).toBe(false);
    expect(shouldAdvertiseTasksCapability("2025-03-26")).toBe(false);
    expect(shouldAdvertiseTasksCapability("2025-06-18")).toBe(false);
    // Tasks-aware negotiation may advertise.
    expect(shouldAdvertiseTasksCapability("2025-11-25")).toBe(true);
    process.env.MCP_TASKS_LIFECYCLE = "off";
    expect(shouldAdvertiseTasksCapability("2025-11-25")).toBe(false);
    if (prev === undefined) delete process.env.MCP_TASKS_LIFECYCLE;
    else process.env.MCP_TASKS_LIFECYCLE = prev;
  });
});
