import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockSendMessage,
  mockResolveAgentForRoute,
  mockAgentEventBus,
  mockPrisma,
  mockWake,
  mockAdmission,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSendMessage: vi.fn(),
  mockResolveAgentForRoute: vi.fn(),
  mockWake: vi.fn(),
  mockAdmission: vi.fn(),
  mockAgentEventBus: {
    clearCancel: vi.fn(),
    markActive: vi.fn(),
    markIdle: vi.fn(),
    emit: vi.fn(),
  },
  mockPrisma: {
    platformConfig: { findUnique: vi.fn() },
    agentMessage: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    agentThread: {
      findUnique: vi.fn(),
    },
    agentAttachment: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/jobs", () => ({ jobs: { send: mockWake } }));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));
vi.mock("@/lib/agent/foreground-work-admission", () => ({ admitForegroundWork: mockAdmission }));

vi.mock("@/lib/actions/agent-coworker", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: mockAgentEventBus,
}));

vi.mock("@/lib/agent-routing", () => ({
  resolveAgentForRoute: mockResolveAgentForRoute,
}));
vi.mock("@/lib/tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: (...args: unknown[]) => mockResolveAgentForRoute(...args),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

import { POST } from "./route";

describe("POST /api/agent/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmission.mockResolvedValue("TR-CHAT-test");
    mockWake.mockResolvedValue({});
    mockPrisma.agentMessage.findUnique.mockResolvedValue(null);
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);

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

  it("returns a retained job reference when a foreground request is accepted", async () => {
    // A saved chat message alone cannot tell the owner which accountable job
    // will complete the request after a recoverable provider hold.
    const response = await POST(sendRequest({ content: "Prepare an internal business checklist" }) as any);
    expect(response.status).toBe(200);
    const acknowledgement = await response.json();
    expect(acknowledgement.userMessageId).toBe("user-msg-1");
    expect(acknowledgement.taskRunId).toEqual(expect.any(String));
    expect(acknowledgement.taskRunId.length).toBeGreaterThan(0);
  });

  // BI-DEFA25EE: the panel marks the message "sent" on a 200, so a 200 must
  // mean the user row already exists — not that a background run will write it.
  it("persists the user message before acknowledging, and hands its id to the turn", async () => {
    let persistedBeforeTurn = false;
    mockWake.mockImplementation(async () => {
      persistedBeforeTurn = mockPrisma.agentMessage.create.mock.calls.some(
        (call) => (call[0] as { data: { role: string } }).data.role === "user",
      );
      return { error: "stop here" };
    });

    const response = await POST(sendRequest({ content: "  Build this  ", attachmentId: "att-1" }) as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "processing", userMessageId: "user-msg-1", taskRunId: "TR-CHAT-test" });
    // BI-BD0B0DCC AC-2: the server's share of message-ack, for the browser to read.
    expect(response.headers.get("Server-Timing")).toMatch(/^app;dur=\d+(\.\d)?$/);
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
    expect(mockWake).toHaveBeenCalledWith({ name: "agent/foreground-work.run", data: { taskRunId: "TR-CHAT-test" } });
  });

  it.each([null, { value: { enabled: false } }])("binds admission to the same saved unified policy as production execution (%j)", async (config) => {
    const routing = await vi.importActual<typeof import("@/lib/agent-routing")>("@/lib/agent-routing");
    const flags = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags");
    mockPrisma.platformConfig.findUnique.mockResolvedValue(config);
    mockResolveAgentForRoute.mockImplementation(routing.resolveAgentForRoute);
    const routeContext = "/finance/expense-claims";
    const expected = routing.resolveAgentForRoute(routeContext, { platformRole: "HR-000", isSuperuser: true }, await flags.isUnifiedCoworkerEnabled());
    expect((await POST(sendRequest({ routeContext }) as any)).status).toBe(200);
    expect(mockAdmission).toHaveBeenCalledWith(expect.objectContaining({ agentId: expected.agentId, routeContext }));
  });

  it("answers with an error and starts no turn when the message cannot be saved", async () => {
    mockPrisma.agentMessage.create.mockRejectedValue(new Error("db down"));

    const response = await POST(sendRequest({}) as any);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: "PERSIST_FAILED", message: expect.any(String) });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAgentEventBus.markActive).not.toHaveBeenCalled();
  });

  it("does not start execution if durable job admission fails", async () => {
    mockAdmission.mockRejectedValueOnce(new Error("admission unavailable"));
    const response = await POST(sendRequest({}) as any);
    expect(response.status).toBe(503);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAgentEventBus.markActive).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ userMessageId: "user-msg-1" });
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

  it("retains accepted work when its advisory wake cannot be delivered", async () => {
    mockWake.mockRejectedValueOnce(new Error("queue unavailable"));
    const response = await POST(sendRequest({}) as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ taskRunId: "TR-CHAT-test", userMessageId: "user-msg-1" });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
