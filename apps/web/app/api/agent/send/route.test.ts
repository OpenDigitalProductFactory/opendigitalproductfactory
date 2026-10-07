import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockSendMessage,
  mockResolveAgentForRoute,
  mockAgentEventBus,
  mockPrisma,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSendMessage: vi.fn(),
  mockResolveAgentForRoute: vi.fn(),
  mockAgentEventBus: {
    clearCancel: vi.fn(),
    markActive: vi.fn(),
    markIdle: vi.fn(),
    emit: vi.fn(),
  },
  mockPrisma: {
    agentMessage: {
      create: vi.fn(),
    },
    agentThread: {
      findUnique: vi.fn(),
    },
    agentAttachment: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/actions/agent-coworker", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: mockAgentEventBus,
}));

vi.mock("@/lib/agent-routing", () => ({
  resolveAgentForRoute: mockResolveAgentForRoute,
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

import { POST } from "./route";

describe("POST /api/agent/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockResolveAgentForRoute.mockReturnValue({
      agentId: "build-specialist",
    });
    mockPrisma.agentThread.findUnique.mockResolvedValue({ userId: "user-1" });
    mockPrisma.agentMessage.create.mockImplementation(
      async ({ data }: { data: { role: string } }) =>
        data.role === "user"
          ? { id: "user-msg-1" }
          : {
              id: "sys-1",
              role: "system",
              content: "background failed",
              agentId: "build-specialist",
              routeContext: "/build",
              createdAt: new Date("2026-04-04T18:00:00.000Z"),
            },
    );
    mockSendMessage.mockResolvedValue({ error: "stop here" });
  });

  function sendRequest(body: Record<string, unknown>) {
    return new Request("http://localhost/api/agent/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "thread-1", content: "Build this", routeContext: "/build", ...body }),
    });
  }

  // BI-DEFA25EE: the panel marks the message "sent" on a 200, so a 200 must
  // mean the user row already exists — not that a background run will write it.
  it("persists the user message before acknowledging, and hands its id to the turn", async () => {
    let persistedBeforeTurn = false;
    mockSendMessage.mockImplementation(async () => {
      persistedBeforeTurn = mockPrisma.agentMessage.create.mock.calls.some(
        (call) => (call[0] as { data: { role: string } }).data.role === "user",
      );
      return { error: "stop here" };
    });

    const response = await POST(sendRequest({ content: "  Build this  ", attachmentId: "att-1" }) as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "processing", userMessageId: "user-msg-1" });
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: { threadId: "thread-1", role: "user", content: "Build this", routeContext: "/build" },
      select: { id: true },
    });
    expect(mockPrisma.agentAttachment.update).toHaveBeenCalledWith({
      where: { id: "att-1" },
      data: { messageId: "user-msg-1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persistedBeforeTurn).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", acceptedUserMessageId: "user-msg-1" }),
    );
  });

  it("answers with an error and starts no turn when the message cannot be saved", async () => {
    mockPrisma.agentMessage.create.mockRejectedValue(new Error("db down"));

    const response = await POST(sendRequest({}) as any);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAgentEventBus.markActive).not.toHaveBeenCalled();
  });

  it("refuses a conversation the caller does not own without writing anything", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue({ userId: "someone-else" });

    const response = await POST(sendRequest({}) as any);

    expect(response.status).toBe(404);
    expect(mockPrisma.agentMessage.create).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only message before touching the database", async () => {
    const response = await POST(sendRequest({ content: "   " }) as any);

    expect(response.status).toBe(400);
    expect(mockPrisma.agentThread.findUnique).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("persists a visible system message when background execution throws", async () => {
    mockSendMessage.mockRejectedValue(new Error("All endpoints failed"));

    const request = new Request("http://localhost/api/agent/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        content: "Build this",
        routeContext: "/build",
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPrisma.agentMessage.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        threadId: "thread-1",
        role: "system",
        routeContext: "/build",
        agentId: "build-specialist",
      }),
      select: expect.any(Object),
    });
    expect(mockAgentEventBus.emit).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ type: "done", error: "Agent execution failed" }),
    );
  });
});
