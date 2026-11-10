// BI-DFC0270C — the floor is wired into the MCP route (AC-FLOOR-READONLY, AC-FLOOR-SCOPE).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishedMock, submitMock } = vi.hoisted(() => ({ publishedMock: vi.fn(), submitMock: vi.fn() }));

vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/mcp-task-submit", () => ({ submitRemoteCoworkerTask: submitMock }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: vi.fn(async () => ({ level: "normal", runId: null, enteredAt: null })),
}));
vi.mock("@/lib/agent-toolchain/served-toolchain", () => ({ getPublishedToolchain: publishedMock }));
vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    mcpApiToken: { findUnique: vi.fn(async () => ({ oauthClientId: null, kind: "operator", oauthClient: null })) },
    agentToolchainObservation: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { POST } from "./route";

const DIGEST = "ab".repeat(32);
const FLOORED = { packVersion: "0.3.1", packDigest: DIGEST, floor: { minPackVersion: "0.3.0", graceStartsAt: "2026-01-01T00:00:00Z" } };

function call(method: string, params: Record<string, unknown>, pack: string | null): Request {
  const query = pack ? `?dpf_pack=${pack}&dpf_digest=${DIGEST.slice(0, 16)}&dpf_client=claude-code` : "";
  return new Request(`http://localhost:3000/api/mcp/v1${query}`, {
    method: "POST",
    headers: { Authorization: "Bearer dpfmcp_WRITE", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method, params }),
  });
}

beforeEach(() => {
  vi.mocked(resolveMcpApiToken).mockResolvedValue({
    tokenId: "tok_floor",
    userId: "u1",
    agentId: null,
    scopes: ["sandbox_execute", "backlog_read"],
    capability: "write",
    scope: "write",
  } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    isSuperuser: true,
    isActive: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
  vi.mocked(governedExecuteTool).mockReset().mockResolvedValue({ success: true, message: "ok" } as never);
  submitMock.mockReset().mockResolvedValue({ kind: "error", message: "not reached in these tests" });
  publishedMock.mockReset().mockReturnValue(FLOORED);
});

describe("POST — toolchain floor", () => {
  it.each(["start_build", "write_sandbox_file", "run_sandbox_command"])("refuses %s from a below-floor client", async (name) => {
    const body = await (await POST(call("tools/call", { name, arguments: {} }, "0.2.9"))).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({
      error: "agent_toolchain_below_floor",
      writesRefused: true,
      repair: { manifestUrl: "http://localhost:3000/api/agent-toolchain/manifest" },
    });
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });

  it("refuses tasks/submit from a below-floor client", async () => {
    const body = await (await POST(call("tasks/submit", { coworker: "x", task: "y" }, "0.2.9"))).json();
    expect(body.error.data.error).toBe("agent_toolchain_below_floor");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("lets a below-floor client read", async () => {
    await POST(call("tools/call", { name: "list_backlog_items", arguments: {} }, "0.2.9"));
    expect(governedExecuteTool).toHaveBeenCalledOnce();
  });

  it("never refuses an undeclared caller", async () => {
    await POST(call("tools/call", { name: "start_build", arguments: {} }, null));
    expect(governedExecuteTool).toHaveBeenCalledOnce();
  });

  it("a bearer on a plain-http endpoint that requires one is not below the floor", async () => {
    await POST(call("tools/call", { name: "start_build", arguments: {} }, "0.3.0"));
    expect(governedExecuteTool).toHaveBeenCalledOnce();
  });

  it("enforces nothing while the release sets no floor", async () => {
    publishedMock.mockReturnValue({ ...FLOORED, floor: { minPackVersion: null, graceStartsAt: null } });
    await POST(call("tools/call", { name: "start_build", arguments: {} }, "0.2.9"));
    expect(governedExecuteTool).toHaveBeenCalledOnce();
  });
});
