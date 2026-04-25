import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  taskRunFindFirst: vi.fn(),
  busSubscribe: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findFirst: mocks.taskRunFindFirst,
    },
  },
}));

vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: {
    subscribe: mocks.busSubscribe,
  },
}));

import { GET as getTaskHandler } from "../../../app/api/internal/tasks/[taskId]/route.js";
import { GET as subscribeTaskHandler } from "../../../app/api/internal/tasks/[taskId]/subscribe/route.js";

describe("GET /api/internal/tasks/[taskId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.busSubscribe.mockImplementation((_threadId, handler) => {
      handler({
        type: "task:status",
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "working",
        sourceEvent: "brand:extract.progress",
        message: "Still working",
      });
      return vi.fn();
    });
  });

  it("returns the canonical task envelope with messages and artifacts", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });

    mocks.taskRunFindFirst.mockResolvedValue({
      taskRunId: "TR-123",
      contextId: "ctx-1",
      status: "working",
      title: "Provider setup handoff",
      objective: "Route provider setup to the finance coworker",
      routeContext: "/finance/providers",
      source: "coworker",
      initiatingAgentId: "agent-setup",
      currentAgentId: "agent-finance",
      parentTaskRunId: null,
      authorityScope: { approvalsRequired: true },
      a2aMetadata: { protocol: "internal-a2a" },
      progressPayload: {
        type: "brand:extract.progress",
        taskRunId: "TR-123",
      },
      startedAt: new Date("2026-04-24T10:00:00Z"),
      completedAt: null,
      createdAt: new Date("2026-04-24T10:00:00Z"),
      updatedAt: new Date("2026-04-24T10:05:00Z"),
      messages: [
        {
          messageId: "tm-1",
          contextId: "ctx-1",
          role: "user",
          parts: [{ type: "message", text: "Please review provider setup." }],
          metadata: { routeContext: "/finance/providers" },
          referenceTaskIds: [],
          createdAt: new Date("2026-04-24T10:00:00Z"),
        },
      ],
      artifacts: [
        {
          artifactId: "ta-1",
          name: "handoff-packet",
          description: "Structured handoff payload",
          parts: [{ type: "application/json", data: { ready: true } }],
          metadata: { handoff: true },
          producerAgentId: "agent-setup",
          producerNodeId: null,
          createdAt: new Date("2026-04-24T10:04:00Z"),
        },
      ],
    });

    const response = await getTaskHandler(
      new Request("http://localhost/api/internal/tasks/TR-123"),
      { params: Promise.resolve({ taskId: "TR-123" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.task).toEqual(
      expect.objectContaining({
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "working",
        title: "Provider setup handoff",
        messages: [
          expect.objectContaining({
            messageId: "tm-1",
            role: "user",
          }),
        ],
        artifacts: [
          expect.objectContaining({
            artifactId: "ta-1",
            name: "handoff-packet",
          }),
        ],
      }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await getTaskHandler(
      new Request("http://localhost/api/internal/tasks/TR-123"),
      { params: Promise.resolve({ taskId: "TR-123" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when the task is not visible to the current user", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });
    mocks.taskRunFindFirst.mockResolvedValue(null);

    const response = await getTaskHandler(
      new Request("http://localhost/api/internal/tasks/TR-404"),
      { params: Promise.resolve({ taskId: "TR-404" }) },
    );

    expect(response.status).toBe(404);
  });

  it("streams canonical task replay and live updates from the internal subscribe route", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });
    mocks.taskRunFindFirst.mockResolvedValue({
      taskRunId: "TR-123",
      threadId: "thread-1",
      contextId: "ctx-1",
      progressPayload: {
        type: "brand:extract.progress",
        taskRunId: "TR-123",
        stage: "scraping",
        message: "Reading source materials",
        percent: 25,
      },
      artifacts: [
        {
          artifactId: "ta-1",
          name: "handoff-packet",
          description: "Structured handoff payload",
          parts: [{ type: "application/json", data: { ready: true } }],
        },
      ],
    });

    const response = await subscribeTaskHandler(
      new Request("http://localhost/api/internal/tasks/TR-123/subscribe"),
      { params: Promise.resolve({ taskId: "TR-123" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const chunk = await reader.read();
      chunks.push(decoder.decode(chunk.value ?? new Uint8Array()));
    }
    await reader.cancel();

    const text = chunks.join("");
    expect(text).toContain('"type":"task:status"');
    expect(text).toContain('"taskId":"TR-123"');
    expect(text).toContain('"type":"task:artifact"');
  });
});
