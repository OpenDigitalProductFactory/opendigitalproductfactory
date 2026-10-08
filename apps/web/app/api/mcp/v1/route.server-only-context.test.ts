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

const META_KEY = "com.opendigitalproductfactory/authorization-handle";

function toolRequest(params: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST",
    headers: { Authorization: "Bearer dpfmcp_WRITE", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/call", params }),
  });
}

const ARGS = {
  title: "Permit carriage",
  objective: "Verify the permit handle reaches the monitor",
  source: "operator",
  idempotencyKey: "permit-meta-test",
};

beforeEach(() => {
  vi.resetAllMocks();
  getQuiescenceConfigMock.mockResolvedValue({ level: "normal", runId: null, enteredAt: null });
  userMock.mockResolvedValue({
    isSuperuser: true,
    isActive: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
  resolveMock.mockResolvedValue({
    tokenId: "tok_write",
    userId: "u1",
    agentId: "AGT-CAPSULE",
    scopes: ["work_capsule_write"],
    capability: "write",
    scope: "write",
  });
  govMock.mockResolvedValue({ success: true, message: "ok", data: { capsuleId: "WC-1" } });
});

// Approval convergence A3 (BI-C8EC05C9; AC-TRANSPORT): the v1 MCP route reads
// only the permit handle from _meta. proposeBoundary, approvalCompletion and
// chatMessageId are server-only governed context, whatever a client sends.
const SERVER_ONLY = { proposeBoundary: true, approvalCompletion: "platform", chatMessageId: "MSG-FORGED" };

describe("POST tools/call — server-only approval context", () => {
  it("never maps client input into proposeBoundary, approvalCompletion or chatMessageId", async () => {
    await POST(toolRequest({
      name: "create_workroom",
      arguments: { ...ARGS, ...SERVER_ONLY },
      _meta: { ...SERVER_ONLY, "com.opendigitalproductfactory/proposeBoundary": true },
      ...SERVER_ONLY,
    }));
    expect(govMock).toHaveBeenCalledOnce();
    const context = govMock.mock.calls[0]![0].context ?? {};
    for (const key of Object.keys(SERVER_ONLY)) expect(context).not.toHaveProperty(key);
  });
});
