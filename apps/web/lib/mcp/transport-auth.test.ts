import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifySessionMock } = vi.hoisted(() => ({ verifySessionMock: vi.fn() }));

vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: verifySessionMock }));
vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ resolveOAuthAccessToken: vi.fn() }));
vi.mock("@/lib/auth/oauth-policy", () => ({ isPatResolutionDisabled: vi.fn(() => false) }));
vi.mock("@/lib/auth/oauth-metadata", () => ({
  buildUnauthorizedChallenge: vi.fn(() => "Bearer"),
  resolveResourceOrigin: vi.fn(() => "http://localhost:3000"),
}));

import { authenticateMcpRequest } from "./transport-auth";

function sessionRequest(): Request {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST",
    headers: { "x-mcp-session": "eyJ.valid.jwt", "content-type": "application/json" },
    body: "{}",
  });
}

describe("authenticateMcpRequest — session JWT (BI-B949993E)", () => {
  beforeEach(() => verifySessionMock.mockReset());

  it("carries the governed TaskRun id from the JWT onto the resolved token", async () => {
    verifySessionMock.mockResolvedValue({
      userId: "u1", agentId: "AGT-WS-REVIEW", threadId: "thread-xyz", routeContext: "/build",
      taskRunId: "TR-MCP-abc-123", scopes: ["backlog_read"], capability: "write",
    });
    const result = await authenticateMcpRequest(sessionRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.source).toBe("session-jwt");
    expect(result.token.taskRunId).toBe("TR-MCP-abc-123");
    expect(result.token.threadId).toBe("thread-xyz");
  });

  it("resolves a JWT without a TaskRun to a null taskRunId, unchanged from before", async () => {
    verifySessionMock.mockResolvedValue({
      userId: "u1", agentId: null, threadId: null, routeContext: null, scopes: ["backlog_read"], capability: "read",
    });
    const result = await authenticateMcpRequest(sessionRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.taskRunId).toBeNull();
  });
});
