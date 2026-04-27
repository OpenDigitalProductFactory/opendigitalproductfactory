// Real MCP JSON-RPC 2.0 transport for external coding agents (Claude Code,
// Codex CLI, VS Code MCP) on the user's host. Spec snapshot in
// docs/Reference/mcp/spec/ (version 2025-11-25).
//
// This is the canonical MCP endpoint. The bespoke REST endpoints at
// /api/mcp/tools and /api/mcp/call remain for in-portal coworker chat
// (which speaks its own contract, not MCP); this route is what an MCP
// client points at.
//
// Auth: Authorization: Bearer dpfmcp_<token>. Tokens are issued from
// /admin/platform-development. We do NOT implement OAuth 2.1 resource-
// server discovery (the GitHub-PAT pattern, intentionally) but we still
// return a WWW-Authenticate header on 401 so clients that perform
// discovery don't fail mysteriously.

import { resolveMcpApiToken, type ResolvedMcpToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS, resolveAnnotations, type ToolDefinition } from "@/lib/mcp-tools";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import { can, type CapabilityKey, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_NAME = "dpf-platform";
const SERVER_VERSION = "1.0.0";

// JSON-RPC 2.0 standard error codes
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: { code: number; message: string; data?: unknown };
    };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  httpStatus = 200,
): Response {
  const body: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  return jsonResponse(body, httpStatus);
}

function jsonRpcOk(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result } satisfies JsonRpcResponse);
}

function unauthorizedResponse(detail: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: JSONRPC_INVALID_REQUEST, message: `unauthorized: ${detail}` },
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="DPF MCP", error="invalid_token", error_description="${detail}"`,
      },
    },
  );
}

function forbiddenResponse(detail: string, host: string | null): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: JSONRPC_INVALID_REQUEST, message: `forbidden: ${detail}` },
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// Spec MUST: validate Origin header to prevent DNS rebinding attacks.
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // non-browser clients (Claude Code, Codex CLI) don't send Origin
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    // Same-host as the portal (when a browser-based MCP client is on the same domain).
    if (process.env.MCP_ALLOWED_ORIGIN_HOSTS) {
      const allowed = process.env.MCP_ALLOWED_ORIGIN_HOSTS.split(",").map((h) => h.trim().toLowerCase());
      if (allowed.includes(host)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Spec safety: refuse non-TLS requests except for localhost (Mode 1 / dev).
//
// When the portal runs behind a proxy or inside a container, `request.url`
// reflects the *internal* bind address (e.g. 0.0.0.0) and protocol, not what
// the client actually connected to. We must consult X-Forwarded-Proto and
// X-Forwarded-Host (or the Host header) to know the client's view.
function isTransportAllowed(request: Request): boolean {
  const xfProto = request.headers.get("x-forwarded-proto");
  const url = new URL(request.url);
  const proto = (xfProto?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "")).toLowerCase();
  if (proto === "https") return true;

  const xfHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const rawHost = (xfHost?.split(",")[0]?.trim() || hostHeader || url.host).toLowerCase();
  // Strip port; bracketed IPv6 retains brackets after URL.host parsing.
  const hostname = rawHost.replace(/^\[(.+)\]:?\d*$/, "$1").replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function loadUserContext(userId: string): Promise<UserContext> {
  const row = await prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        isSuperuser: true,
        groups: { include: { platformRole: true }, take: 1 },
      },
    })
    .catch(() => null);
  return {
    userId,
    platformRole: row?.groups[0]?.platformRole.roleId ?? null,
    isSuperuser: row?.isSuperuser ?? false,
  };
}

// Tool is included in tools/list iff:
//   1. The user has the tool's required capability (defense-in-depth)
//   2. The token's scopes intersect the tool's required grants
//   3. (When token is bound to an agent) the agent's grants permit it — but
//      the wrapper handles this on tools/call; for the listing we just use
//      the token scopes since the agent-grant filter is identical at runtime.
function tokenCanUseTool(
  tool: ToolDefinition,
  token: ResolvedMcpToken,
  userContext: UserContext,
  grantMap: Record<string, string[]>,
): boolean {
  if (tool.requiredCapability && !can(userContext, tool.requiredCapability as CapabilityKey)) {
    return false;
  }
  const required = grantMap[tool.name];
  if (!required) return false; // default-deny tools without a grant entry
  return required.some((g) => token.scopes.includes(g));
}

function annotateTool(tool: ToolDefinition) {
  const ann = resolveAnnotations(tool);
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.name.replace(/_/g, " "),
      readOnlyHint: ann.readOnlyHint,
      destructiveHint: ann.destructiveHint,
      idempotentHint: ann.idempotentHint,
      openWorldHint: ann.openWorldHint,
    },
  };
}

async function handleInitialize(id: JsonRpcId): Promise<Response> {
  return jsonRpcOk(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    instructions:
      "Domain-level MCP surface for the Digital Product Factory. Use tools/list to discover the backlog and planning tools available to your token.",
  });
}

async function handleToolsList(
  id: JsonRpcId,
  token: ResolvedMcpToken,
): Promise<Response> {
  const userContext = await loadUserContext(token.userId);
  const grantMap = getToolGrantMapping();
  const tools = PLATFORM_TOOLS.filter((t) =>
    tokenCanUseTool(t, token, userContext, grantMap),
  ).map(annotateTool);
  return jsonRpcOk(id, { tools });
}

async function handleToolsCall(
  id: JsonRpcId,
  token: ResolvedMcpToken,
  params: Record<string, unknown> | undefined,
): Promise<Response> {
  if (!params || typeof params["name"] !== "string") {
    return jsonRpcError(id, JSONRPC_INVALID_PARAMS, "tools/call requires params.name (string)");
  }
  const toolName = params["name"];
  const args = (params["arguments"] as Record<string, unknown> | undefined) ?? {};

  // Token-scope gate. The wrapper also rejects on grant mismatch when an
  // agentId is in context, but we want a fast pre-check here so an external
  // client gets a clear "your token can't do this" instead of a generic
  // forbidden_grant from the wrapper's agent-grant path.
  const grantMap = getToolGrantMapping();
  const required = grantMap[toolName];
  if (!required) {
    return jsonRpcOk(id, {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    });
  }
  const tokenAllowed = required.some((g) => token.scopes.includes(g));
  if (!tokenAllowed) {
    return jsonRpcOk(id, {
      content: [
        {
          type: "text",
          text: `Token lacks the required scope for ${toolName}. Required: one of ${required.join(", ")}; token has: ${token.scopes.join(", ")}.`,
        },
      ],
      isError: true,
    });
  }

  // Capability check on the tool's write-capable subset: read-capable tokens
  // can never invoke a side-effecting tool, regardless of token scopes.
  const toolDef = PLATFORM_TOOLS.find((t) => t.name === toolName);
  if (toolDef?.sideEffect && token.capability === "read") {
    return jsonRpcOk(id, {
      content: [
        {
          type: "text",
          text: `${toolName} is a side-effecting tool; this token is read-only. Re-issue a write-capable token to call it.`,
        },
      ],
      isError: true,
    });
  }

  const userContext = await loadUserContext(token.userId);
  const result = await governedExecuteTool({
    toolName,
    rawParams: args,
    userId: token.userId,
    userContext,
    context: {
      agentId: token.agentId ?? undefined,
      apiTokenId: token.tokenId,
    },
    source: "external-jsonrpc",
  });

  // Convert ToolResult into MCP tools/call response shape:
  //   - content[]: a single text block carrying a JSON serialization of the
  //     ToolResult so MCP clients see structured data without us inventing
  //     a non-standard return shape
  //   - isError: true on any non-success
  //   - structuredContent: the raw ToolResult.data when present, so clients
  //     that support structured content (per the 2025-11-25 spec) can use it
  //     directly without re-parsing the text block
  const text = JSON.stringify(
    {
      success: result.success,
      message: result.message,
      ...(result.entityId ? { entityId: result.entityId } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.data ? { data: result.data } : {}),
    },
    null,
    2,
  );
  const responseBody: Record<string, unknown> = {
    content: [{ type: "text", text }],
    isError: !result.success,
  };
  if (result.data !== undefined) {
    responseBody["structuredContent"] = result.data;
  }
  return jsonRpcOk(id, responseBody);
}

export async function POST(request: Request): Promise<Response> {
  // Transport guards
  if (!isTransportAllowed(request)) {
    return forbiddenResponse(
      "TLS required (HTTPS only outside localhost)",
      new URL(request.url).hostname,
    );
  }
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return forbiddenResponse(`Origin ${origin} not allowed`, origin);
  }

  // Auth
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return unauthorizedResponse("missing Bearer token");
  }
  const plaintext = authHeader.slice("bearer ".length).trim();
  const token = await resolveMcpApiToken(plaintext);
  if (!token) {
    return unauthorizedResponse("invalid or expired token");
  }

  // Parse JSON-RPC envelope
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, JSONRPC_PARSE_ERROR, "invalid JSON in request body");
  }
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError(
      body.id ?? null,
      JSONRPC_INVALID_REQUEST,
      "request must have jsonrpc='2.0' and method string",
    );
  }

  // Notifications (no id) — return 202 Accepted, no body, per spec.
  const isNotification = body.id === undefined;

  try {
    switch (body.method) {
      case "initialize":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleInitialize(body.id ?? null);

      case "notifications/initialized":
        return new Response(null, { status: 202 });

      case "tools/list":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsList(body.id ?? null, token);

      case "tools/call":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsCall(body.id ?? null, token, body.params);

      case "ping":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return jsonRpcOk(body.id ?? null, {});

      default:
        if (isNotification) {
          // Unknown notifications are silently accepted per JSON-RPC 2.0.
          return new Response(null, { status: 202 });
        }
        return jsonRpcError(body.id ?? null, JSONRPC_METHOD_NOT_FOUND, `unknown method: ${body.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown internal error";
    return jsonRpcError(
      body.id ?? null,
      JSONRPC_INTERNAL_ERROR,
      `internal error: ${message}`,
    );
  }
}

// GET on the MCP endpoint is reserved for SSE in the Streamable HTTP spec.
// We don't implement SSE (single-POST flow is sufficient for tool calls);
// clients that try GET should get a clean 405.
export function GET(): Response {
  return new Response("Method Not Allowed — use POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
