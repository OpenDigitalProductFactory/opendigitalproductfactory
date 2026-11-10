import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/mcp-task-submit", () => ({ submitRemoteCoworkerTask: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceConfig: vi.fn() }));
vi.mock("@/lib/identity/load-effective-auth-context", () => ({ loadEffectiveAuthContext: vi.fn() }));
vi.mock("@/lib/tak/agent-grants", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/tak/agent-grants")>()),
  getAgentToolGrantsAsync: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  user: { findUnique: vi.fn() }, agent: { findFirst: vi.fn() },
  mcpToolSession: { findUnique: vi.fn(), upsert: vi.fn() },
} }));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { getQuiescenceConfig } from "@/lib/self-upgrade/quiescence";
import { getAgentToolGrantsAsync } from "@/lib/tak/agent-grants";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { POST } from "./route";

const resolveMock = vi.mocked(resolveMcpApiToken);
const agentGrantsMock = vi.mocked(getAgentToolGrantsAsync);
const govMock = vi.mocked(governedExecuteTool);
function makeRequest({ bearer, body }: { bearer: string; body: unknown }) {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getQuiescenceConfig).mockResolvedValue({ level: "normal", runId: null, enteredAt: null } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true, isActive: true, groups: [] } as never);
  vi.mocked(prisma.agent.findFirst).mockResolvedValue({ sensitivity: "internal" } as never);
  vi.mocked(loadEffectiveAuthContext).mockResolvedValue({ sensitivityClearance: ["public", "internal", "confidential"] } as never);
});


describe("intent load authority boundary", () => {
  it.each([false, true])("query discovery preserves coworker grants (allowed=%s)", async (allowed) => {
    resolveMock.mockResolvedValue({ tokenId: "tok-disclosure", userId: "u1", agentId: "AGT-REMOTE", scopes: ["registry_read"], capability: "read" } as never);
    agentGrantsMock.mockResolvedValue(allowed ? ["registry_read"] : []);
    const res = await POST(makeRequest({ bearer: "dpfmcp_X", body: {
      jsonrpc: "2.0", id: 77, method: "tools/call",
      params: { name: "load_tools", arguments: { query: "wiki query" } },
    } }));
    expect(res.status).toBe(200);
    const data = (await res.json()).result.structuredContent;
    const entry = data.status.find((item: { name: string }) => item.name === "wiki_query");
    expect(entry).toMatchObject({ callableByName: allowed, agentGranted: allowed });
    expect(data.newlyLoaded.some((item: { name: string }) => item.name === "wiki_query")).toBe(allowed);
    if (!allowed) {
      expect(entry.reason).toBe("agent-grant-missing");
      expect(entry).not.toHaveProperty("inputSchema");
      expect(data.noMatch.reason).toBe("not-granted");
    }
    expect(govMock).not.toHaveBeenCalled();
  });
});
