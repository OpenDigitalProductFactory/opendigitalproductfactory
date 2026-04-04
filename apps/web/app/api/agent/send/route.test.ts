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
    mockPrisma.agentMessage.create.mockResolvedValue({
      id: "sys-1",
      role: "system",
      content: "background failed",
      agentId: "build-specialist",
      routeContext: "/build",
      createdAt: new Date("2026-04-04T18:00:00.000Z"),
    });
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

    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
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
