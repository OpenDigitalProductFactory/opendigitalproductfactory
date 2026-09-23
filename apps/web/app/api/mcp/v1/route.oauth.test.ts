import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/mcp-api-token", () => ({
  resolveMcpApiToken: vi.fn(),
}));

vi.mock("@/lib/mcp/session-token", () => ({
  verifyMcpSessionToken: vi.fn(),
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

const { getQuiescenceConfigMock } = vi.hoisted(() => ({
  getQuiescenceConfigMock: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: getQuiescenceConfigMock,
}));

vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: vi.fn(),
  executeAutonomousAgenticLoop: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(),
  resolveAutonomousWorkTools: vi.fn(),
}));

vi.mock("@/lib/tak/task-records", () => ({
  createTaskMessage: vi.fn(),
}));
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ["event-1"] }) },
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    agent: { findFirst: vi.fn() },
    taskRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    agentThread: { upsert: vi.fn() },
    taskMessage: { create: vi.fn() },
    mcpToolSession: { findUnique: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  },
}));

// BI-HDLEMP-04: the agent-bound tools/list authority filter resolves the acting
// agent's grants and the acting human's clearance. Override only those two seams
// — keep the REAL grant mapping / expansion so the token-scope tests are
// unaffected — and stub the effective-auth loader (it makes its own DB reads the
// mock above doesn't model).
vi.mock("@/lib/tak/agent-grants", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/tak/agent-grants")>()),
  getAgentToolGrantsAsync: vi.fn(),
}));
vi.mock("@/lib/identity/load-effective-auth-context", () => ({
  loadEffectiveAuthContext: vi.fn(),
}));

vi.mock("@/lib/auth/oauth-tokens", () => ({ resolveOAuthAccessToken: vi.fn() }));
import { resolveOAuthAccessToken } from "@/lib/auth/oauth-tokens";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { POST } from "./route";
const govMock = vi.mocked(governedExecuteTool);
beforeEach(() => vi.resetAllMocks());
function makeRequest(opts: {
  url?: string;
  method?: string;
  bearer?: string | null;
  sessionJwt?: string | null;
  origin?: string | null;
  body?: unknown;
  forwardedProto?: string;
  forwardedHost?: string;
  hostHeader?: string;
  userAgent?: string | null;
}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Default the caller to Claude Code so tools/list returns the FULL granted
  // surface. Claude Code and Codex defer attachment host-side; the client-aware
  // default is covered explicitly below and in tool-tier.test.ts. Pass
  // userAgent to exercise a different client.
  if (opts.userAgent !== null) {
    headers["User-Agent"] = opts.userAgent ?? "claude-code/2.1 (test)";
  }
  if (opts.bearer !== null && opts.bearer !== undefined) {
    headers["Authorization"] = `Bearer ${opts.bearer}`;
  }
  if (opts.sessionJwt !== null && opts.sessionJwt !== undefined) {
    headers["X-MCP-Session"] = opts.sessionJwt;
  }
  if (opts.origin !== null && opts.origin !== undefined) {
    headers["Origin"] = opts.origin;
  }
  if (opts.forwardedProto) headers["X-Forwarded-Proto"] = opts.forwardedProto;
  if (opts.forwardedHost) headers["X-Forwarded-Host"] = opts.forwardedHost;
  if (opts.hostHeader) headers["Host"] = opts.hostHeader;
  return new Request(opts.url ?? "http://localhost:3000/api/mcp/v1", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}


describe("OAuth setup recovery", () => {
  it.each(["get_my_coworker_profile", "create_workroom", "read_room_messages"])(
    "returns a clear setup result for an unbound OAuth connection calling %s", async (name) => {
      vi.mocked(resolveOAuthAccessToken).mockResolvedValue({ resolved: {
        tokenId: "old-oauth", userId: "u1", agentId: null, scope: "write", capability: "write",
        scopes: ["registry_read", "work_capsule_write", "work_room_read"],
      }, publicScopes: ["dpf.read", "dpf.work"], clientId: "client", identitySetupRequired: true });
      const res = await POST(makeRequest({ bearer: "dpfoat_old", body: {
        jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} },
      } }));
      expect(await res.json()).toMatchObject({ result: { isError: true,
        structuredContent: { error: "oauth_setup_required", recovery: { action: "reconnect" } },
      } });
      expect(govMock).not.toHaveBeenCalled();
    },
  );
});
