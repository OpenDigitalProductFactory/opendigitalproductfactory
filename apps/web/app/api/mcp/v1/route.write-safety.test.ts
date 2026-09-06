import { beforeEach, describe, expect, it, vi } from "vitest";

const { getQuiescenceConfigMock } = vi.hoisted(() => ({
  getQuiescenceConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: getQuiescenceConfigMock,
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: vi.fn(),
  executeAutonomousAgenticLoop: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(),
  resolveAutonomousWorkTools: vi.fn(),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    taskRun: { findFirst: vi.fn(), update: vi.fn() },
    agentThread: { upsert: vi.fn() },
    taskMessage: { create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { POST } from "./route";

const resolveMock = vi.mocked(resolveMcpApiToken);
const govMock = vi.mocked(governedExecuteTool);
const userMock = vi.mocked(prisma.user.findUnique);

function toolRequest(name: string, args: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST",
    headers: {
      Authorization: "Bearer dpfmcp_WRITE",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 74,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getQuiescenceConfigMock.mockResolvedValue({
    level: "normal",
    runId: null,
    enteredAt: null,
  });
  userMock.mockResolvedValue({
    isSuperuser: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
});

describe("POST — mutating tool safety", () => {
  it("rejects tasks/cancel from a read token before any TaskRun mutation", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_read",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
      scope: "read",
    });

    const res = await POST(new Request("http://localhost:3000/api/mcp/v1", {
      method: "POST",
      headers: {
        Authorization: "Bearer dpfmcp_READ",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 701,
        method: "tasks/cancel",
        params: { taskId: "TR-MCP-DURABLE" },
      }),
    }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: -32600,
        message: expect.stringContaining("write-scoped MCP token"),
        data: {
          error: "insufficient_token_scope",
          method: "tasks/cancel",
          requiredScope: "write",
          tokenScope: "read",
        },
      },
    });
    expect(prisma.taskRun.update).not.toHaveBeenCalled();
  });

  it("allows write-scoped tokens to call create_workroom", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-CAPSULE",
      scopes: ["work_capsule_write"],
      capability: "write",
      scope: "write",
    });
    govMock.mockResolvedValue({
      success: true,
      message: "Work Capsule WC-SCOPE created.",
      entityId: "WC-SCOPE",
      data: { capsuleId: "WC-SCOPE" },
    });

    const res = await POST(
      toolRequest("create_workroom", {
        title: "Token scope test",
        objective: "Verify write-token acceptance",
        source: "operator",
        idempotencyKey: "scope-write-test",
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toEqual({ capsuleId: "WC-SCOPE" });
    expect(govMock).toHaveBeenCalledOnce();
    expect(govMock.mock.calls[0]![0]).toMatchObject({
      toolName: "create_workroom",
      context: { apiTokenId: "tok_write" },
      source: "external-jsonrpc",
    });
  });

  it("refuses mutating tools during quiescence with retry and cleanup details", async () => {
    getQuiescenceConfigMock.mockResolvedValue({
      level: "draining",
      runId: "QR-MCP-DRAIN",
      enteredAt: "2026-07-24T14:00:00.000Z",
    });
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-CI",
      scopes: ["backlog_write"],
      capability: "write",
      scope: "write",
    });

    const res = await POST(
      toolRequest("record_local_integration_result", {
        branch: "feat/topic",
        sha: "abc123",
        status: "passed",
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({
      error: "portal_quiescing",
      level: "draining",
      runId: "QR-MCP-DRAIN",
      retryAfterSeconds: 30,
      writesRefused: true,
      cleanupOperationsAllowed: ["release_nonprod_environment_lease"],
    });
    expect(body.result.content[0].text).toContain("Mutating MCP write refused");
    expect(govMock).not.toHaveBeenCalled();
  });

  it("allows cleanup-safe lease release during quiescence", async () => {
    getQuiescenceConfigMock.mockResolvedValue({
      level: "draining",
      runId: "QR-MCP-DRAIN",
      enteredAt: "2026-07-24T14:00:00.000Z",
    });
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-CI",
      scopes: ["work_capsule_write"],
      capability: "write",
      scope: "write",
    });
    govMock.mockResolvedValue({
      success: true,
      message: "Released lease NPEL-TEST.",
      entityId: "NPEL-TEST",
      data: { leaseId: "NPEL-TEST" },
    });

    const res = await POST(
      toolRequest("release_nonprod_environment_lease", {
        leaseId: "NPEL-TEST",
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.leaseId).toBe("NPEL-TEST");
    expect(govMock).toHaveBeenCalledOnce();
  });
});
