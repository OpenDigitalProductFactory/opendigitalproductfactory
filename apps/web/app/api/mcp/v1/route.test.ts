import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import {
  createAutonomousWorkRun,
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { getAgentToolGrantsAsync } from "@/lib/tak/agent-grants";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { GET, POST } from "./route";
import { deriveCallerClient } from "@/lib/mcp/caller-client";

const resolveMock = resolveMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const verifySessionMock = verifyMcpSessionToken as unknown as ReturnType<typeof vi.fn>;
const govMock = governedExecuteTool as unknown as ReturnType<typeof vi.fn>;
const userMock = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const taskRunFindFirstMock = prisma.taskRun.findFirst as unknown as ReturnType<typeof vi.fn>;
const taskRunUpdateMock = prisma.taskRun.update as unknown as ReturnType<typeof vi.fn>;
const agentThreadUpsertMock = prisma.agentThread.upsert as unknown as ReturnType<typeof vi.fn>;
const createRunMock = createAutonomousWorkRun as unknown as ReturnType<typeof vi.fn>;
const executeLoopMock = executeAutonomousAgenticLoop as unknown as ReturnType<typeof vi.fn>;
const resolveAgentMock = resolveAutonomousWorkAgent as unknown as ReturnType<typeof vi.fn>;
const resolveToolsMock = resolveAutonomousWorkTools as unknown as ReturnType<typeof vi.fn>;
const createTaskMessageMock = createTaskMessage as unknown as ReturnType<typeof vi.fn>;
const agentFindFirstMock = prisma.agent.findFirst as unknown as ReturnType<typeof vi.fn>;
const agentGrantsMock = getAgentToolGrantsAsync as unknown as ReturnType<typeof vi.fn>;
const effectiveAuthMock = loadEffectiveAuthContext as unknown as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  vi.resetAllMocks();
  getQuiescenceConfigMock.mockResolvedValue({ level: "normal", runId: null, enteredAt: null });
  userMock.mockResolvedValue({
    isSuperuser: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
  taskRunFindFirstMock.mockResolvedValue(null);
  taskRunUpdateMock.mockResolvedValue({} as never);
  agentThreadUpsertMock.mockResolvedValue({ id: "thread-remote-1" } as never);
  createRunMock.mockResolvedValue({ id: "task-row-1", taskRunId: "TR-MCP-12345678", contextId: "thread-remote-1" } as never);
  resolveAgentMock.mockResolvedValue({
    agentId: "AGT-REMOTE",
    systemPrompt: "You are a governed autonomous coworker.",
    sensitivity: "internal",
    displayName: "Remote Coworker",
  } as never);
  resolveToolsMock.mockResolvedValue({ tools: [], toolsForProvider: [] } as never);
  executeLoopMock.mockResolvedValue({ content: "Done.", executedTools: [] } as never);
  createTaskMessageMock.mockResolvedValue(undefined as never);
  // Agent-bound listing-authority seams (BI-HDLEMP-04). Defaults are only
  // reached by agent-bound tokens; the agentId:null tests short-circuit before
  // touching them.
  agentFindFirstMock.mockResolvedValue({ sensitivity: "internal" } as never);
  agentGrantsMock.mockResolvedValue([] as never);
  effectiveAuthMock.mockResolvedValue({
    sensitivityClearance: ["public", "internal", "confidential"],
  } as never);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET", () => {
  it("requires the same authenticated transport as POST", async () => {
    const res = await GET(makeRequest({ method: "GET", bearer: null }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });

});

describe("POST — transport guards", () => {
  it("rejects HTTPS-required violations on non-localhost http URLs", async () => {
    const res = await POST(
      makeRequest({
        url: "http://evil.example.com/api/mcp/v1",
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/TLS required/i);
  });

  it("allows http on localhost (Mode 1)", async () => {
    resolveMock.mockResolvedValue(null); // pretend token is bad to short-circuit at auth
    const res = await POST(
      makeRequest({
        url: "http://localhost:3000/api/mcp/v1",
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(401); // got past TLS guard, failed at auth
  });

  it("rejects spoofed X-Forwarded-Host on plain HTTP", async () => {
    resolveMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        url: "http://0.0.0.0:3000/api/mcp/v1",
        bearer: "dpfmcp_X",
        forwardedHost: "localhost:3000",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows containerized request when X-Forwarded-Proto is https", async () => {
    resolveMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        url: "http://0.0.0.0:3000/api/mcp/v1",
        bearer: "dpfmcp_X",
        forwardedProto: "https",
        forwardedHost: "portal.example.com",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("falls back to Host header when no X-Forwarded-Host present", async () => {
    resolveMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        url: "http://0.0.0.0:3000/api/mcp/v1",
        bearer: "dpfmcp_X",
        hostHeader: "127.0.0.1:3000",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("still rejects http requests on non-localhost hosts (no proxy headers)", async () => {
    const res = await POST(
      makeRequest({
        url: "http://evil.example.com/api/mcp/v1",
        bearer: "dpfmcp_X",
        forwardedHost: "evil.example.com",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(403);
  });

  // Sandbox→portal MCP traffic on the internal Docker bridge cannot use TLS.
  // MCP_INSECURE_INTERNAL_HOSTS lets the operator opt the internal hostname
  // (`portal`, `host.docker.internal`, …) into the HTTP-allowed set without
  // dropping the gate for the public surface.
  describe("MCP_INSECURE_INTERNAL_HOSTS env opt-in", () => {
    const originalValue = process.env.MCP_INSECURE_INTERNAL_HOSTS;
    afterEach(() => {
      if (originalValue === undefined) {
        delete process.env.MCP_INSECURE_INTERNAL_HOSTS;
      } else {
        process.env.MCP_INSECURE_INTERNAL_HOSTS = originalValue;
      }
    });

    it("allows http on a hostname listed in MCP_INSECURE_INTERNAL_HOSTS", async () => {
      process.env.MCP_INSECURE_INTERNAL_HOSTS = "portal,host.docker.internal";
      resolveMock.mockResolvedValue(null);
      const res = await POST(
        makeRequest({
          url: "http://portal:3000/api/mcp/v1",
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(401); // past transport guard, failed at auth
    });

    it("does not allow hostnames absent from MCP_INSECURE_INTERNAL_HOSTS", async () => {
      process.env.MCP_INSECURE_INTERNAL_HOSTS = "portal";
      const res = await POST(
        makeRequest({
          url: "http://other-internal:3000/api/mcp/v1",
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("ignores empty/whitespace entries in the allowlist", async () => {
      process.env.MCP_INSECURE_INTERNAL_HOSTS = " , portal , ";
      resolveMock.mockResolvedValue(null);
      const res = await POST(
        makeRequest({
          url: "http://portal:3000/api/mcp/v1",
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("does not use X-Forwarded-Host to satisfy MCP_INSECURE_INTERNAL_HOSTS", async () => {
      process.env.MCP_INSECURE_INTERNAL_HOSTS = "portal";
      const res = await POST(
        makeRequest({
          url: "http://evil.example.com/api/mcp/v1",
          bearer: "dpfmcp_X",
          forwardedHost: "portal:3000",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  it("rejects requests with disallowed Origin", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        origin: "https://evil.example.com",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows requests with no Origin (CLI clients)", async () => {
    resolveMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        origin: null,
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(401); // past origin guard, fails at auth
  });
});

describe("POST — auth", () => {
  it("returns 401 with WWW-Authenticate when neither Authorization nor X-MCP-Session is present", async () => {
    const res = await POST(
      makeRequest({
        bearer: null,
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer realm="DPF MCP"/);
  });

  it("returns 401 when token resolves to null", async () => {
    resolveMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_BAD",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("invalid_token");
  });

  // X-MCP-Session JWT path — used by the Claude CLI execution adapter to
  // authenticate per-call without consuming a persistent dpfmcp_* PAT slot.
  describe("X-MCP-Session JWT", () => {
    it("returns 401 when session JWT verification fails", async () => {
      verifySessionMock.mockResolvedValue(null);
      const res = await POST(
        makeRequest({
          bearer: null,
          sessionJwt: "eyJ.invalid.jwt",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toMatch(/invalid or expired MCP session/);
    });

    it("accepts a valid session JWT and reaches initialize", async () => {
      verifySessionMock.mockResolvedValue({
        userId: "u1",
        agentId: "build-specialist",
        threadId: "thread-abc",
        routeContext: "/build",
        scopes: ["backlog_read", "build_plan_write"],
        capability: "write",
      });
      const res = await POST(
        makeRequest({
          bearer: null,
          sessionJwt: "eyJ.valid.jwt",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result?.serverInfo?.name).toMatch(/^dpf-/); // per-installation, BI-C7151B1B
    });

    it("session JWT wins over PAT bearer when both are present", async () => {
      // Session JWT is narrowly scoped per-call. If both headers arrive,
      // we prefer the session so a stale operator PAT in the same shell
      // can't widen the cli-adapter's effective scope.
      verifySessionMock.mockResolvedValue({
        userId: "u-session",
        agentId: "build-specialist",
        threadId: null,
        routeContext: null,
        scopes: ["backlog_read"],
        capability: "read",
      });
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_should_be_ignored",
          sessionJwt: "eyJ.valid.jwt",
          body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "query_backlog", arguments: { limit: 1 } } },
        }),
      );
      // PAT resolver should NOT have been consulted.
      expect(resolveMock).not.toHaveBeenCalled();
      expect(verifySessionMock).toHaveBeenCalledWith("eyJ.valid.jwt");
      expect(res.status).toBe(200);
    });

    it("forwards JWT threadId/routeContext into governedExecuteTool context", async () => {
      verifySessionMock.mockResolvedValue({
        userId: "u1",
        agentId: "build-specialist",
        threadId: "thread-xyz",
        routeContext: "/build",
        scopes: ["backlog_read"],
        capability: "read",
      });
      govMock.mockResolvedValue({
        success: true,
        message: "ok",
        data: { count: 0 },
      });
      const res = await POST(
        makeRequest({
          sessionJwt: "eyJ.valid.jwt",
          body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "query_backlog", arguments: { limit: 1 } } },
        }),
      );
      expect(res.status).toBe(200);
      expect(govMock).toHaveBeenCalledTimes(1);
      const callArgs = govMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs.userId).toBe("u1");
      expect(callArgs.source).toBe("internal-mcp-session");
      const ctx = callArgs.context as Record<string, unknown>;
      expect(ctx.agentId).toBe("build-specialist");
      expect(ctx.threadId).toBe("thread-xyz");
      expect(ctx.routeContext).toBe("/build");
    });

    it("trims whitespace from the X-MCP-Session header value", async () => {
      verifySessionMock.mockResolvedValue({
        userId: "u1",
        agentId: null,
        threadId: null,
        routeContext: null,
        scopes: ["backlog_read"],
        capability: "read",
      });
      const res = await POST(
        makeRequest({
          sessionJwt: "  eyJ.valid.jwt  ",
          body: { jsonrpc: "2.0", id: 1, method: "initialize" },
        }),
      );
      expect(res.status).toBe(200);
      expect(verifySessionMock).toHaveBeenCalledWith("eyJ.valid.jwt");
    });
  });
});

describe("POST — JSON-RPC envelope", () => {
  beforeEach(() => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read", "backlog_write"],
      capability: "write",
    });
  });

  it("returns -32700 parse error on invalid JSON body", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/mcp/v1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dpfmcp_X",
        },
        body: "not valid json{",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("returns -32600 invalid request when jsonrpc field is wrong", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "1.0", id: 1, method: "initialize" },
      }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("returns -32601 method not found for unknown methods", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 1, method: "totally_unknown_method" },
      }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("returns 202 Accepted with no body for notifications/initialized", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", method: "notifications/initialized" }, // no id = notification
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("returns 202 for unknown notifications (no id)", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", method: "some/random/notification" },
      }),
    );
    expect(res.status).toBe(202);
  });
});

describe("POST — initialize", () => {
  beforeEach(() => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
  });

  it("returns the protocol version, server info, and tools capability", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    // No protocolVersion in params → falls back to oldest supported version
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.serverInfo.name).toMatch(/^dpf-/); // per-installation, BI-C7151B1B
    expect(body.result.capabilities.tools).toBeDefined();
    // Pre-Tasks fallback must NOT advertise tasks (breaks Grok Build 1.0.0 etc.).
    expect(body.result.capabilities.tasks).toBeUndefined();
  });

  it("negotiates protocol version — echoes client version when supported", async () => {
    for (const version of ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]) {
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } },
        }),
      );
      const body = await res.json();
      expect(body.result.protocolVersion).toBe(version);
    }
  });

  it("omits capabilities.tasks on pre-Tasks protocol versions (client-compat)", async () => {
    // Includes Grok Build 1.0.0's negotiated version (2025-06-18).
    for (const version of ["2024-11-05", "2025-03-26", "2025-06-18"]) {
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: version },
          },
        }),
      );
      const body = await res.json();
      expect(body.result.protocolVersion).toBe(version);
      expect(body.result.capabilities.tools).toEqual({ listChanged: true });
      expect(body.result.capabilities.tasks).toBeUndefined();
    }
  });

  it("accepts MCP-Protocol-Version: 2025-06-18 on post-initialize calls (Grok)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_grok",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const req = new Request("https://localhost/api/mcp/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dpfmcp_X",
        "User-Agent": "grok/1.0.0",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it("negotiates protocol version — falls back when client version is unknown", async () => {
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } },
      }),
    );
    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2024-11-05");
    // Fallback is pre-Tasks — do not advertise tasks on the safe floor.
    expect(body.result.capabilities.tasks).toBeUndefined();
  });
});

describe("POST — tools/list", () => {
  it("returns only tools the token's scopes can use", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"], // read-only scope
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const toolNames = body.result.tools.map((t: { name: string }) => t.name);
    // Read-scoped tools should appear
    expect(toolNames).toContain("query_backlog");
    expect(toolNames).toContain("list_epics");
    // Write-scoped tools should NOT appear
    expect(toolNames).not.toContain("create_backlog_item");
    expect(toolNames).not.toContain("update_backlog_item_status");
  });

  it("initialize returns serverInfo.description and advertises the tasks capability (Slices 1/4)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_i",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } },
      }),
    );
    const body = await res.json();
    expect(typeof body.result.serverInfo.description).toBe("string");
    expect(body.result.serverInfo.description.length).toBeGreaterThan(0);
    // Spec shape: tasks.list/.cancel are `object`, not boolean (a boolean
    // fails strict client capability validation — Claude Code rejects init).
    expect(body.result.capabilities.tasks).toEqual({ list: {}, cancel: {} });
  });

  it("rejects an unsupported MCP-Protocol-Version header with 400 (Slice 1)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_p",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const req = new Request("https://localhost/api/mcp/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dpfmcp_X",
        "User-Agent": "codex/1.0",
        "MCP-Protocol-Version": "1999-01-01",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("emits outputSchema (2020-12) + title on query_backlog (Slice 2)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_m",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({ bearer: "dpfmcp_X", body: { jsonrpc: "2.0", id: 3, method: "tools/list" } }),
    );
    const body = await res.json();
    const qb = (body.result.tools as Array<{ name: string; title?: string; outputSchema?: { $schema?: string } }>).find(
      (t) => t.name === "query_backlog",
    );
    expect(qb?.title).toBe("Query backlog");
    expect(qb?.outputSchema?.$schema).toContain("2020-12");
  });

  it("includes annotations on every returned tool", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 3, method: "tools/list" },
      }),
    );
    const body = await res.json();
    for (const tool of body.result.tools) {
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint).toBe("boolean");
    }
  });

  it("appends the load_tools meta-tool to every tools/list (Phase 2 deferred loading, BI-D8101329)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_lt",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        userAgent: "codex/1.0", // full host catalog — load_tools must still be present
        body: { jsonrpc: "2.0", id: 42, method: "tools/list" },
      }),
    );
    const body = await res.json();
    const names = (body.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain("load_tools");
    const loadTools = (body.result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[]).find(
      (t) => t.name === "load_tools",
    );
    expect(loadTools?.inputSchema.properties).toHaveProperty("query");
    expect(loadTools?.inputSchema.properties).toHaveProperty("names");
  });

  it("gives lazy host registries the full catalog while generic hosts keep the lean core", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_c",
      userId: "u1",
      agentId: null,
      scopes: ["registry_read", "backlog_read"],
      capability: "read",
    });
    const names = async (req: Request) =>
      ((await (await POST(req)).json()).result.tools as { name: string }[]).map((t) => t.name);

    // Codex needs the full authorized server catalog so its own lazy registry
    // can search/attach deferred definitions without a mid-turn re-list.
    const codexNames = await names(
      makeRequest({
        bearer: "dpfmcp_X",
        userAgent: "codex/1.0",
        body: { jsonrpc: "2.0", id: 20, method: "tools/list" },
      }),
    );
    const codexCoreNames = await names(
      makeRequest({
        bearer: "dpfmcp_X",
        userAgent: "codex/1.0",
        url: "http://localhost:3000/api/mcp/v1?tier=core",
        body: { jsonrpc: "2.0", id: 21, method: "tools/list" },
      }),
    );
    expect(codexNames).toContain("wiki_query");
    expect(codexNames.length).toBeGreaterThan(codexCoreNames.length);

    // Grok has no proven host-side lazy registry, so it keeps the core floor.
    const grokNames = await names(
      makeRequest({
        bearer: "dpfmcp_X",
        userAgent: "grok/2.0",
        body: { jsonrpc: "2.0", id: 23, method: "tools/list" },
      }),
    );
    expect(grokNames).toContain("principle_decide");
    expect(grokNames).toContain("wiki_query");
    expect(grokNames).toEqual(codexCoreNames);

    // Claude Code also keeps the full surface for its native ToolSearch.
    const ccNames = await names(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 22, method: "tools/list" },
      }),
    );
    expect(ccNames).toContain("wiki_query");
    expect(ccNames).toEqual(codexNames);

    // Current Codex Streamable HTTP requests omit User-Agent. The bootstrap's
    // explicit tier therefore has to be sufficient on its own; without it an
    // unidentified client correctly retains the generic core default.
    const unidentifiedCoreNames = await names(
      makeRequest({
        bearer: "dpfmcp_X",
        userAgent: null,
        body: { jsonrpc: "2.0", id: 24, method: "tools/list" },
      }),
    );
    const explicitFullNames = await names(
      makeRequest({
        bearer: "dpfmcp_X",
        userAgent: null,
        url: "http://localhost:3000/api/mcp/v1?tier=full",
        body: { jsonrpc: "2.0", id: 25, method: "tools/list" },
      }),
    );
    expect(unidentifiedCoreNames).toEqual(codexCoreNames);
    expect(explicitFullNames).toEqual(codexNames);
  });

  // ─── BI-HDLEMP-04: agent-bound tools/list ⇄ tools/call authority parity ──
  describe("agent-bound token: list is filtered by agent grants + clearance", () => {
    const agentBoundToken = {
      tokenId: "tok_agent",
      userId: "u1",
      agentId: "AGT-EMP",
      scopes: ["backlog_read"],
      capability: "read" as const,
    };
    const listNames = async () => {
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 70, method: "tools/list" },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      return (body.result.tools as { name: string }[]).map((t) => t.name);
    };

    it("lists a token-scoped tool the agent's grants also cover", async () => {
      resolveMock.mockResolvedValue(agentBoundToken);
      agentGrantsMock.mockResolvedValue(["backlog_read"] as never); // agent covers it
      const names = await listNames();
      expect(names).toContain("query_backlog");
      expect(names).toContain("list_epics");
    });

    it("drops a token-scoped tool the agent's grants do NOT cover (list/call skew fix)", async () => {
      resolveMock.mockResolvedValue(agentBoundToken);
      agentGrantsMock.mockResolvedValue([] as never); // agent grants nothing
      const names = await listNames();
      expect(names).not.toContain("query_backlog");
      expect(names).not.toContain("list_epics");
      // The transport meta-tool is always present; only governed tools are gated.
      expect(names).toContain("load_tools");
    });

    it("drops the whole agent-bound surface when clearance excludes the agent's sensitivity", async () => {
      resolveMock.mockResolvedValue(agentBoundToken);
      agentGrantsMock.mockResolvedValue(["backlog_read"] as never); // grant would allow…
      agentFindFirstMock.mockResolvedValue({ sensitivity: "restricted" } as never);
      effectiveAuthMock.mockResolvedValue({
        sensitivityClearance: ["public", "internal", "confidential"], // …but no clearance
      } as never);
      const names = await listNames();
      expect(names).not.toContain("query_backlog");
      expect(names).toContain("load_tools");
    });

    it("drops the whole agent-bound surface when the acting agent cannot be resolved", async () => {
      resolveMock.mockResolvedValue(agentBoundToken);
      agentGrantsMock.mockResolvedValue(["backlog_read"] as never);
      agentFindFirstMock.mockResolvedValue(null as never); // agent not active/found
      const names = await listNames();
      expect(names).not.toContain("query_backlog");
      expect(names).toContain("load_tools");
    });
  });

  // ─── Principles-as-wiki-kind Phase 2 Task 2.8 ───────────────────────────
  describe("principle MCP tools are gated by registry_read scope", () => {
    it("exposes wiki_query and principle_decide to tokens with registry_read", async () => {
      resolveMock.mockResolvedValue({
        tokenId: "tok_p",
        userId: "u1",
        agentId: null,
        scopes: ["registry_read"],
        capability: "read",
      });
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 10, method: "tools/list" },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const toolNames = body.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain("wiki_query");
      expect(toolNames).toContain("principle_decide");
    });

    it("hides wiki_query and principle_decide from tokens without registry_read", async () => {
      resolveMock.mockResolvedValue({
        tokenId: "tok_p",
        userId: "u1",
        agentId: null,
        scopes: ["backlog_read"], // NOT registry_read
        capability: "read",
      });
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 11, method: "tools/list" },
        }),
      );
      const body = await res.json();
      const toolNames = body.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).not.toContain("wiki_query");
      expect(toolNames).not.toContain("principle_decide");
    });

    it("exposes the extended wiki_query input schema (tier, appliesTo, publicOnly, principle in pageKind enum)", async () => {
      resolveMock.mockResolvedValue({
        tokenId: "tok_p",
        userId: "u1",
        agentId: null,
        scopes: ["registry_read"],
        capability: "read",
      });
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 12, method: "tools/list" },
        }),
      );
      const body = await res.json();
      const wikiQuery = body.result.tools.find(
        (t: { name: string }) => t.name === "wiki_query",
      );
      expect(wikiQuery).toBeDefined();
      const props = wikiQuery.inputSchema.properties as Record<
        string,
        { enum?: string[] }
      >;
      // pageKind enum now includes "principle"
      expect(props.pageKind.enum).toContain("principle");
      // New principle filter fields are advertised
      expect(props.tier).toBeDefined();
      expect(props.tier.enum).toEqual(["commandment", "core", "contextual"]);
      expect(props.appliesTo).toBeDefined();
      expect(props.appliesTo.enum).toEqual([
        "in_platform_coworker",
        "external_coding_agent",
        "human",
      ]);
      expect(props.publicOnly).toBeDefined();
    });

    it("exposes principle_decide with the documented input shape (context, options, callingPopulation)", async () => {
      resolveMock.mockResolvedValue({
        tokenId: "tok_p",
        userId: "u1",
        agentId: null,
        scopes: ["registry_read"],
        capability: "read",
      });
      const res = await POST(
        makeRequest({
          bearer: "dpfmcp_X",
          body: { jsonrpc: "2.0", id: 13, method: "tools/list" },
        }),
      );
      const body = await res.json();
      const decide = body.result.tools.find(
        (t: { name: string }) => t.name === "principle_decide",
      );
      expect(decide).toBeDefined();
      expect(decide.inputSchema.required).toEqual(
        expect.arrayContaining(["context", "options", "callingPopulation"]),
      );
      expect(decide.annotations.readOnlyHint).toBe(true);
      expect(decide.annotations.destructiveHint).toBe(false);
      expect(decide.annotations.idempotentHint).toBe(true);
    });
  });
});

describe("POST — tools/call", () => {
  it("returns invalid_params when name is missing", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: {} },
      }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32602);
  });

  it("returns isError:true with helpful message for unknown tools", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "totally_made_up_tool" },
        },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Unknown tool");
  });

  it("rejects scope mismatch with isError:true and a clear message (does not call governedExecuteTool)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"], // no backlog_write
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "create_backlog_item", arguments: {} },
        },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({
      error: "insufficient_token_scope",
      requiredScope: "write",
      tokenScope: "read",
      toolName: "create_backlog_item",
    });
    expect(govMock).not.toHaveBeenCalled();
  });

  it("rejects side-effecting calls from read-capable tokens (defense-in-depth)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read", "backlog_write"], // scopes allow it
      capability: "read", // but token capability is read-only
      scope: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "create_backlog_item", arguments: {} },
        },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/write-scoped MCP token/i);
    expect(body.result.structuredContent).toMatchObject({
      error: "insufficient_token_scope",
      requiredScope: "write",
      tokenScope: "read",
      toolName: "create_backlog_item",
    });
    expect(govMock).not.toHaveBeenCalled();
  });

  it("returns requiredScope=write for read tokens that try create_workroom", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["work_capsule_write"],
      capability: "read",
      scope: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 71,
          method: "tools/call",
          params: {
            name: "create_workroom",
            arguments: {
              title: "Token scope test",
              objective: "Verify write-token requirement",
              source: "operator",
              idempotencyKey: "scope-test",
            },
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.requiredScope).toBe("write");
    expect(body.result.structuredContent.tokenScope).toBe("read");
    expect(govMock).not.toHaveBeenCalled();
  });

  it("accepts an implying grant for a finer required grant (build_promote → build_lifecycle)", async () => {
    // promote_to_build_studio requires `build_lifecycle`; a legacy
    // `build_promote` token implies it via GRANT_IMPLICATIONS. The token-scope
    // gate must expand before checking, mirroring the agent-grant layer.
    resolveMock.mockResolvedValue({
      tokenId: "tok_promote",
      userId: "u1",
      agentId: "AGT-BUILD",
      scopes: ["build_promote"], // NOT build_lifecycle directly
      capability: "write",
      scope: "write",
    });
    govMock.mockResolvedValue({
      success: true,
      message: "Promoted BI-SCOPE to Build Studio.",
      entityId: "BI-SCOPE",
      data: { buildId: "FB-SCOPE" },
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_PROMOTE",
        body: {
          jsonrpc: "2.0",
          id: 73,
          method: "tools/call",
          params: { name: "promote_to_build_studio", arguments: { itemId: "BI-SCOPE" } },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(govMock).toHaveBeenCalledOnce();
    expect(govMock.mock.calls[0]![0].toolName).toBe("promote_to_build_studio");
  });

  it("dispatches to governedExecuteTool with source=external-jsonrpc and apiTokenId", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_abc",
      userId: "u1",
      agentId: "AGT-100",
      scopes: ["backlog_read"],
      capability: "read",
    });
    govMock.mockResolvedValue({
      success: true,
      message: "ok",
      data: { items: [{ itemId: "BI-X", title: "X" }] },
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name: "list_backlog_items", arguments: { limit: 5 } },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(govMock).toHaveBeenCalledOnce();
    const call = govMock.mock.calls[0]![0];
    expect(call.toolName).toBe("list_backlog_items");
    expect(call.userId).toBe("u1");
    expect(call.context.agentId).toBe("AGT-100");
    expect(call.context.apiTokenId).toBe("tok_abc");
    expect(call.source).toBe("external-jsonrpc");

    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.content[0].text).toContain("ok");
    // structuredContent mirrors the ToolResult.data
    expect(body.result.structuredContent.items[0].itemId).toBe("BI-X");
  });

  it("returns isError:true and serialized failure when the tool returns success:false", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    govMock.mockResolvedValue({
      success: false,
      error: "not_found",
      message: "Item BI-NOPE not found",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "get_backlog_item", arguments: { itemId: "BI-NOPE" } },
        },
      }),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("not_found");
  });
});

describe("POST — ping", () => {
  it("returns empty object for ping", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
    });
    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: { jsonrpc: "2.0", id: 10, method: "ping" },
      }),
    );
    const body = await res.json();
    expect(body.result).toEqual({});
  });
});

describe("POST — tasks/submit", () => {
  it("returns invalid_params when idempotencyKey or riskClass is missing", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 11,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Investigate discovery backlog.",
            prompt: "Summarize discovery backlog.",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.error.code).toBe(-32602);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("rejects write-risk submissions from read-only tokens before creating a TaskRun", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_read",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 12,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Prepare a backlog update.",
            prompt: "Create a backlog item if needed.",
            idempotencyKey: "remote-read-denied-1",
            riskClass: "bounded-write",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/read-only/i);
    expect(body.result.structuredContent).toMatchObject({
      error: "insufficient_token_scope",
      requiredScope: "write",
      tokenScope: "read",
    });
    expect(createRunMock).not.toHaveBeenCalled();
    expect(executeLoopMock).not.toHaveBeenCalled();
  });

  it("replays an existing TaskRun for the same idempotencyKey without re-running the coworker", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read", "backlog_write"],
      capability: "write",
    });
    taskRunFindFirstMock.mockResolvedValue({
      taskRunId: "TR-MCP-OLD",
      status: "completed",
      progressPayload: { summary: "Already done." },
      a2aMetadata: { idempotencyKey: "remote-replay-1", riskClass: "read" },
    } as never);

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 13,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Summarize current state.",
            prompt: "Summarize current state.",
            idempotencyKey: "remote-replay-1",
            riskClass: "read",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.taskRunId).toBe("TR-MCP-OLD");
    expect(body.result.idempotentReplay).toBe(true);
    expect(createRunMock).not.toHaveBeenCalled();
    expect(executeLoopMock).not.toHaveBeenCalled();
  });

  it("creates an external-mcp TaskRun and returns its durable handle", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_read",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      capability: "read",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 14,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            title: "Remote discovery summary",
            objective: "Summarize discovery backlog.",
            prompt: "Summarize discovery backlog and cite what you used.",
            idempotencyKey: "remote-read-1",
            riskClass: "read",
          },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(createRunMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: "external-mcp",
      userId: "u1",
      agentId: "AGT-REMOTE",
      routeContext: "/platform/tools/discovery",
      sourceRef: { kind: "mcp-token", id: "tok_read" },
      metadata: expect.objectContaining({
        idempotencyKey: "remote-read-1",
        riskClass: "read",
        apiTokenId: "tok_read",
      }),
    }));
    expect(resolveToolsMock).not.toHaveBeenCalled();
    expect(executeLoopMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.result.taskRunId).toBe("TR-MCP-12345678");
    expect(body.result.idempotentReplay).toBe(false);
    expect(body.result.requiresApproval).toBe(false);
    expect(body.result.status).toBe("submitted");
  });

  it("pauses high-risk submissions before executing tools", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_write",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read", "backlog_write"],
      capability: "write",
    });

    const res = await POST(
      makeRequest({
        bearer: "dpfmcp_X",
        body: {
          jsonrpc: "2.0",
          id: 15,
          method: "tasks/submit",
          params: {
            agentId: "AGT-REMOTE",
            routeContext: "/platform/tools/discovery",
            objective: "Make broad production changes.",
            prompt: "Make broad production changes.",
            idempotencyKey: "remote-high-risk-1",
            riskClass: "high-risk",
          },
        },
      }),
    );

    const body = await res.json();
    expect(body.result.taskRunId).toBe("TR-MCP-12345678");
    expect(body.result.requiresApproval).toBe(true);
    expect(body.result.status).toBe("input-required");
    expect(taskRunUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-MCP-12345678" },
      data: expect.objectContaining({ status: "input-required" }),
    }));
    expect(executeLoopMock).not.toHaveBeenCalled();
  });
});

describe("deriveCallerClient (decision-ledger caller attribution)", () => {
  it("takes the first product token and strips platform detail", () => {
    expect(deriveCallerClient("claude-code/2.1 (darwin; arm64)")).toBe("claude-code/2.1");
    expect(deriveCallerClient("codex-cli/0.9.4")).toBe("codex-cli/0.9.4");
  });

  it("sanitizes hostile characters and caps the length", () => {
    expect(deriveCallerClient("<script>alert(1)</script>/1.0 x")).toBe("scriptalert1/script/1.0");
    expect(deriveCallerClient("a".repeat(200))).toHaveLength(64);
  });

  it("returns undefined for missing or empty user agents", () => {
    expect(deriveCallerClient(null)).toBeUndefined();
    expect(deriveCallerClient("   ")).toBeUndefined();
    expect(deriveCallerClient("!!!")).toBeUndefined();
  });
});
