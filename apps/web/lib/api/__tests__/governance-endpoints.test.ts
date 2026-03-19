import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    agentThread: { findMany: vi.fn(), findUnique: vi.fn() },
    agentActionProposal: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    authorizationDecisionLog: { findMany: vi.fn() },
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

import { GET as approvalsListHandler } from "../../../app/api/v1/governance/approvals/route.js";
import { POST as approvalDecideHandler } from "../../../app/api/v1/governance/approvals/[id]/route.js";
import { GET as decisionsListHandler } from "../../../app/api/v1/governance/decisions/route.js";

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
// APPROVALS LIST
// ===========================================================================
describe("GET /api/v1/governance/approvals", () => {
  it("returns pending proposals for the user", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentThread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "thread-1" },
    ]);
    (prisma.agentActionProposal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prop-1",
        proposalId: "PROP-001",
        actionType: "create_epic",
        parameters: {},
        status: "proposed",
        proposedAt: new Date(),
        message: { id: "msg-1", role: "assistant", content: "Create epic?", agentId: "agent-1", createdAt: new Date() },
      },
    ]);

    const res = await approvalsListHandler(getRequest("/api/v1/governance/approvals"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(1);
    expect(body.data[0].proposalId).toBe("PROP-001");
  });

  it("returns empty when user has no threads", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentThread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await approvalsListHandler(getRequest("/api/v1/governance/approvals"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await approvalsListHandler(getRequest("/api/v1/governance/approvals"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// APPROVE / REJECT
// ===========================================================================
describe("POST /api/v1/governance/approvals/:id", () => {
  it("approves a proposal", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentActionProposal.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "prop-1",
      status: "proposed",
      parameters: { foo: "bar" },
      thread: { userId: "user-1" },
    });
    (prisma.agentActionProposal.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "prop-1",
      status: "approve",
      decidedById: "user-1",
    });

    const res = await approvalDecideHandler(
      postRequest("/api/v1/governance/approvals/prop-1", { decision: "approve", rationale: "Looks good" }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("approve");
  });

  it("rejects a proposal", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentActionProposal.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "prop-1",
      status: "proposed",
      parameters: {},
      thread: { userId: "user-1" },
    });
    (prisma.agentActionProposal.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "prop-1",
      status: "reject",
    });

    const res = await approvalDecideHandler(
      postRequest("/api/v1/governance/approvals/prop-1", { decision: "reject" }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );

    expect(res.status).toBe(200);
  });

  it("returns 422 for invalid decision", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await approvalDecideHandler(
      postRequest("/api/v1/governance/approvals/prop-1", { decision: "maybe" }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );

    expect(res.status).toBe(422);
  });

  it("returns 404 when proposal not found", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentActionProposal.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await approvalDecideHandler(
      postRequest("/api/v1/governance/approvals/nonexistent", { decision: "approve" }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when proposal belongs to another user", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.agentActionProposal.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "prop-1",
      status: "proposed",
      parameters: {},
      thread: { userId: "other-user" },
    });

    const res = await approvalDecideHandler(
      postRequest("/api/v1/governance/approvals/prop-1", { decision: "approve" }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await approvalDecideHandler(
      postRequest("/api/v1/governance/approvals/prop-1", { decision: "approve" }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// DECISIONS AUDIT LOG
// ===========================================================================
describe("GET /api/v1/governance/decisions", () => {
  it("returns paginated decisions for the user", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.authorizationDecisionLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "dec-1",
        decisionId: "DEC-001",
        actorType: "user",
        actorRef: "user-1",
        actionKey: "create_epic",
        decision: "allow",
        rationale: {},
        createdAt: new Date(),
      },
    ]);

    const res = await decisionsListHandler(getRequest("/api/v1/governance/decisions"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await decisionsListHandler(getRequest("/api/v1/governance/decisions"));
    expect(res.status).toBe(401);
  });
});
