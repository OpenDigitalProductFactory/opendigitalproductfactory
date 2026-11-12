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
    taskRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    agentThread: { upsert: vi.fn() },
    taskMessage: { create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { POST } from "./route";
import { createAutonomousWorkRun } from "@/lib/tak/autonomous-work-run";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";

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
  it.each([true, false])("accepts an execution fence only from verified session authentication: %s", async (signed) => {
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: "admitted", dispatchClaim: "dispatch", authorityDigest: null, requestDigest: "9".repeat(64) };
    vi.mocked(verifyMcpSessionToken).mockResolvedValue({ userId: "u1", agentId: "AGT-CAPSULE", taskRunId: "TR-BOUND",
      scopes: ["work_capsule_write"], capability: "write", ...(signed ? { taskExecutionFence } : {}) });
    // This fixture verifies server-only carriage for a nonreview task. Held
    // bound-review execution is covered separately below.
    vi.mocked(prisma.taskRun.findUnique).mockResolvedValue({ userId: "u1", currentAgentId: "AGT-CAPSULE",
      status: "working", a2aMetadata: { initiativeReviewBinding: null }, progressPayload: {} } as never);
    const request = toolRequest({ name: "create_workroom", arguments: { ...ARGS, taskExecutionFence: { forged: true } },
      _meta: { taskExecutionFence: { forged: true } }, taskExecutionFence: { forged: true } });
    request.headers.set("x-mcp-session", "synthetic-test-session");
    await POST(request);
    expect(govMock).toHaveBeenCalledOnce();
    expect(govMock.mock.calls[0]?.[0].context?.taskExecutionFence).toEqual(signed ? taskExecutionFence : undefined);
  });
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

const reviewBinding = {
  itemId: "BI-REVIEW", gate: "spec-approval", writerToolName: "record_initiative_spec_approval",
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40),
    path: "docs/review.md", providerBlobId: "b".repeat(40) },
  workroomRef: { kind: "workroom-head", workroomId: "WC-REVIEW", repositoryFullName: "org/repo",
    branchName: "codex/review", headSha: "a".repeat(40) },
};

describe("POST — bound review callback containment", () => {
  it.each([
    ["tools/list", {}],
    ["tools/call", { name: "load_tools", arguments: { names: ["get_backlog_item"] } }],
    ["tasks/submit", { agentId: "AGT-CAPSULE", routeContext: "/build", objective: "child",
      prompt: "child", idempotencyKey: "held-child", riskClass: "read" }],
    ["tasks/cancel", { taskId: "TR-OTHER" }],
  ])("refuses %s before its transport handler for an uncertain legacy review", async (method, params) => {
    vi.mocked(verifyMcpSessionToken).mockResolvedValue({ userId: "u1", agentId: "AGT-CAPSULE",
      scopes: ["backlog_read", "initiative_evidence_write"], capability: "write",
      taskRunId: "TR-HELD-REVIEW", threadId: "thread-held", routeContext: "/build" });
    vi.mocked(prisma.taskRun.findUnique).mockResolvedValue({ userId: "u1", currentAgentId: "AGT-CAPSULE",
      status: "input-required", a2aMetadata: { initiativeReviewBinding: reviewBinding, requestDigest: "a".repeat(64) },
      progressPayload: { executionUncertainty: { settlement: "unknown" } } } as never);
    const request = toolRequest({});
    request.headers.set("x-mcp-session", "held-session");
    const response = await POST(new Request(request, { body: JSON.stringify({ jsonrpc: "2.0", id: 700, method, params }) }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.data.error).toBe("review_execution_authority_refused");
    expect(govMock).not.toHaveBeenCalled();
    expect(createAutonomousWorkRun).not.toHaveBeenCalled();
    expect(prisma.taskRun.updateMany).not.toHaveBeenCalled();
  });

  it("dispatches a current bound callback with its exact signed fence", async () => {
    const requestDigest = "a".repeat(64);
    const taskExecutionFence = captureTaskExecutionFence({}, requestDigest)!;
    vi.mocked(verifyMcpSessionToken).mockResolvedValue({ userId: "u1", agentId: "AGT-CAPSULE", taskRunId: "TR-CURRENT-REVIEW",
      scopes: ["work_capsule_write"], capability: "write", taskExecutionFence });
    vi.mocked(prisma.taskRun.findUnique).mockResolvedValue({ userId: "u1", currentAgentId: "AGT-CAPSULE",
      status: "working", a2aMetadata: { initiativeReviewBinding: reviewBinding, requestDigest }, progressPayload: {} } as never);
    const request = toolRequest({ name: "create_workroom", arguments: ARGS });
    request.headers.set("x-mcp-session", "current-session");
    await POST(request);
    expect(govMock).toHaveBeenCalledOnce();
    expect(govMock.mock.calls[0]?.[0].context?.taskExecutionFence).toEqual(taskExecutionFence);
  });
});
