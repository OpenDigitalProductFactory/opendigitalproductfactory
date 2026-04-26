import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/mcp-api-token", () => ({
  resolveMcpApiToken: vi.fn(),
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { GET, POST } from "./route";

const resolveMock = resolveMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const govMock = governedExecuteTool as unknown as ReturnType<typeof vi.fn>;
const userMock = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeRequest(opts: {
  url?: string;
  method?: string;
  bearer?: string | null;
  origin?: string | null;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.bearer !== null && opts.bearer !== undefined) {
    headers["Authorization"] = `Bearer ${opts.bearer}`;
  }
  if (opts.origin !== null && opts.origin !== undefined) {
    headers["Origin"] = opts.origin;
  }
  return new Request(opts.url ?? "http://localhost:3000/api/mcp/v1", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  userMock.mockResolvedValue({
    isSuperuser: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET", () => {
  it("returns 405 with Allow header", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
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
  it("returns 401 with WWW-Authenticate when Authorization header missing", async () => {
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
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo.name).toBe("dpf-platform");
    expect(body.result.capabilities.tools).toBeDefined();
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
    expect(body.result.content[0].text).toMatch(/lacks the required scope/i);
    expect(govMock).not.toHaveBeenCalled();
  });

  it("rejects side-effecting calls from read-capable tokens (defense-in-depth)", async () => {
    resolveMock.mockResolvedValue({
      tokenId: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read", "backlog_write"], // scopes allow it
      capability: "read", // but token capability is read-only
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
    expect(body.result.content[0].text).toMatch(/read-only/i);
    expect(govMock).not.toHaveBeenCalled();
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
