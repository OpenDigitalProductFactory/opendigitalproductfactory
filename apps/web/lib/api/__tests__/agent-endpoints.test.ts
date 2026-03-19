import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    agentThread: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    agentActionProposal: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from "@dpf/db";
import { authenticateRequest } from "../../api/auth-middleware.js";

import { POST as messageHandler } from "../../../app/api/v1/agent/message/route.js";
import { GET as threadHandler } from "../../../app/api/v1/agent/thread/route.js";
import { GET as streamHandler } from "../../../app/api/v1/agent/stream/route.js";
import { GET as proposalsHandler } from "../../../app/api/v1/agent/proposals/route.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_AUTH = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    type: "admin" as const,
    platformRole: "HR-000",
    isSuperuser: false,
    accountId: null,
    accountName: null,
    contactId: null,
  },
  capabilities: ["view_admin"],
};

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: "Bearer valid-jwt" },
  });
}

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: "Bearer valid-jwt", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// AGENT MESSAGE
// ===========================================================================
describe("POST /api/v1/agent/message", () => {
  it("creates a user message and returns it", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentThread.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "thread-1",
    });
    (prisma.agentMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg-1",
      role: "user",
      content: "Hello agent",
      agentId: null,
      routeContext: "/workspace",
      createdAt: new Date("2026-03-19T10:00:00Z"),
    });

    const res = await messageHandler(
      postRequest("/api/v1/agent/message", { content: "Hello agent" }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.content).toBe("Hello agent");
    expect(body.threadId).toBe("thread-1");
    expect(body.role).toBe("user");
  });

  it("returns 422 for empty content", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await messageHandler(
      postRequest("/api/v1/agent/message", { content: "" }),
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for missing content", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await messageHandler(
      postRequest("/api/v1/agent/message", {}),
    );

    expect(res.status).toBe(422);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await messageHandler(
      postRequest("/api/v1/agent/message", { content: "Hello" }),
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// AGENT THREAD
// ===========================================================================
describe("GET /api/v1/agent/thread", () => {
  it("returns thread with messages", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentThread.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "thread-1",
    });
    // Mock returns newest-first (desc order), route reverses to chronological
    (prisma.agentMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "msg-2",
        role: "assistant",
        content: "Hi there!",
        agentId: "agent-general",
        routeContext: "/workspace",
        createdAt: new Date("2026-03-19T10:00:01Z"),
      },
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
        agentId: null,
        routeContext: "/workspace",
        createdAt: new Date("2026-03-19T10:00:00Z"),
      },
    ]);

    const res = await threadHandler(getRequest("/api/v1/agent/thread"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.threadId).toBe("thread-1");
    expect(body.messages).toBeInstanceOf(Array);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[1].role).toBe("assistant");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await threadHandler(getRequest("/api/v1/agent/thread"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// AGENT STREAM (SSE STUB)
// ===========================================================================
describe("GET /api/v1/agent/stream", () => {
  it("returns SSE stream with connected event", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await streamHandler(getRequest("/api/v1/agent/stream"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");

    // Read the stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }

    expect(text).toContain("data:");
    expect(text).toContain('"type":"connected"');
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await streamHandler(getRequest("/api/v1/agent/stream"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// AGENT PROPOSALS
// ===========================================================================
describe("GET /api/v1/agent/proposals", () => {
  it("returns pending proposals", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentThread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "thread-1",
    });
    (prisma.agentActionProposal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prop-1",
        proposalId: "AP-ABC12",
        actionType: "create_backlog_item",
        parameters: { title: "New item" },
        status: "proposed",
        createdAt: new Date("2026-03-19T10:00:00Z"),
        message: {
          id: "msg-1",
          role: "assistant",
          content: "I'd like to create a backlog item",
          agentId: "agent-ops",
          routeContext: "/backlog",
          createdAt: new Date("2026-03-19T10:00:00Z"),
        },
      },
    ]);

    const res = await proposalsHandler(getRequest("/api/v1/agent/proposals"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proposals).toBeInstanceOf(Array);
    expect(body.proposals.length).toBe(1);
    expect(body.proposals[0].proposalId).toBe("AP-ABC12");
    expect(body.proposals[0].status).toBe("proposed");
    expect(body.proposals[0].message.content).toBe("I'd like to create a backlog item");
  });

  it("returns empty array when no thread exists", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentThread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await proposalsHandler(getRequest("/api/v1/agent/proposals"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proposals).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await proposalsHandler(getRequest("/api/v1/agent/proposals"));
    expect(res.status).toBe(401);
  });
});
