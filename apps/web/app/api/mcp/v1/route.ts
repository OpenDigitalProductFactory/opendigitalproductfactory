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

import {
  resolveMcpApiToken,
  type McpTokenCapability,
  type McpTokenScope,
  type ResolvedMcpToken,
} from "@/lib/auth/mcp-api-token";
import { deriveCallerClient } from "@/lib/mcp/caller-client";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS, resolveAnnotations, type ToolDefinition } from "@/lib/mcp-tools";
import { submitRemoteCoworkerTask } from "@/lib/mcp-task-submit";
import { getQuiescenceConfig } from "@/lib/self-upgrade/quiescence";
import { getToolGrantMapping, expandGrants } from "@/lib/tak/agent-grants";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import { resolveEffectiveTier, selectToolsByTier, type McpToolTier } from "@/lib/mcp/tool-tier";
import { can, type CapabilityKey, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";

/** Resolved auth — either a persistent PAT or a short-lived internal session.
 * The route-side handlers consume this single shape; the only difference is
 * what `threadId`/`routeContext` populate audit rows with. */
type ResolvedAuth = ResolvedMcpToken & {
  threadId?: string | null;
  routeContext?: string | null;
  /** Where the auth came from — populates `ToolExecution.executionMode` so we can
   *  tell internal cli-adapter calls from external coding-agent calls. */
  source: "pat" | "session-jwt";
};

// Versions we can speak, newest first. We echo back the highest version the
// client supports so older clients (e.g. Claude Code pre-2025-11-25) connect.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-03-26", "2024-11-05"] as const;
const FALLBACK_PROTOCOL_VERSION = "2024-11-05";
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

type McpToolsCallResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
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

function scopeToCapability(scope: McpTokenScope): McpTokenCapability {
  return scope === "read" ? "read" : "write";
}

function normalizeTokenScope(token: Pick<ResolvedMcpToken, "scope" | "capability">): McpTokenScope {
  if (token.scope === "admin" || token.scope === "write" || token.scope === "read") {
    return token.scope;
  }
  return token.capability === "write" ? "write" : "read";
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
// the client actually connected to. We trust X-Forwarded-Proto only for the
// proxy's TLS termination signal. Host authorization for plain HTTP must use
// the actual Host/request URL because X-Forwarded-Host is caller-controlled in
// direct CLI/container traffic.
//
// MCP_INSECURE_INTERNAL_HOSTS — comma-separated hostnames that are trusted
// to call the MCP transport over plain HTTP. Required for sandbox→portal
// MCP traffic on the internal Docker bridge (`portal`, `host.docker.internal`,
// etc.) where TLS termination is not available. Operator opt-in: empty/unset
// means localhost-only. Bearer-token auth, origin check, scope/grant checks
// are all still enforced — this only relaxes the transport-layer TLS gate.
function isTransportAllowed(request: Request): boolean {
  const xfProto = request.headers.get("x-forwarded-proto");
  const url = new URL(request.url);
  const proto = (xfProto?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "")).toLowerCase();
  if (proto === "https") return true;

  const hostHeader = request.headers.get("host");
  const rawHost = (hostHeader || url.host).toLowerCase();
  // Strip port; bracketed IPv6 retains brackets after URL.host parsing.
  const hostname = rawHost.replace(/^\[(.+)\]:?\d*$/, "$1").replace(/:\d+$/, "");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  const internalAllowlist = process.env.MCP_INSECURE_INTERNAL_HOSTS;
  if (internalAllowlist) {
    const allowed = internalAllowlist
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0);
    if (allowed.includes(hostname)) return true;
  }
  return false;
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
  const requiredScope = requiredTokenScopeForTool(tool, required);
  if (!tokenScopeSatisfies(normalizeTokenScope(token), requiredScope)) {
    return false;
  }
  // Expand through GRANT_IMPLICATIONS so an implying grant (e.g. build_promote)
  // surfaces the finer-grant tools it implies (e.g. build_lifecycle). Mirrors
  // the call-time check below and the agent-grant layer.
  return required.some((g) => expandGrants(token.scopes).includes(g));
}

function requiredTokenScopeForTool(
  tool: ToolDefinition | undefined,
  requiredGrants: readonly string[],
): McpTokenScope {
  if (requiredGrants.some((grant) => grant.startsWith("admin_"))) return "admin";
  return tool?.sideEffect ? "write" : "read";
}

function tokenScopeSatisfies(actual: McpTokenScope, required: McpTokenScope): boolean {
  if (required === "read") return true;
  if (required === "write") return actual === "write" || actual === "admin";
  return actual === "admin";
}

const QUIESCENCE_SAFE_SIDE_EFFECT_TOOLS = new Set([
  // Releasing a lease is cleanup, and is what prevents quiescence-blocked
  // local-CI evidence writes from leaking scarce nonprod environments.
  "release_nonprod_environment_lease",
]);

function isToolAllowedDuringQuiescence(toolName: string, tool: ToolDefinition | undefined): boolean {
  if (toolName === "get_quiescence_status") return true;
  if (tool?.sideEffect === false) return true;
  return QUIESCENCE_SAFE_SIDE_EFFECT_TOOLS.has(toolName);
}

async function quiescenceRefusalResult(
  toolName: string,
  tool: ToolDefinition | undefined,
): Promise<McpToolsCallResult | null> {
  if (isToolAllowedDuringQuiescence(toolName, tool)) return null;
  const config = await getQuiescenceConfig();
  if (config.level === "normal") return null;

  const data = {
    error: "portal_quiescing",
    toolName,
    level: config.level,
    runId: config.runId,
    enteredAt: config.enteredAt,
    retryAfterSeconds: 30,
    retryable: true,
    writesRefused: true,
    readOperationsAllowed: true,
    cleanupOperationsAllowed: [...QUIESCENCE_SAFE_SIDE_EFFECT_TOOLS],
    implications:
      "Mutating MCP writes are refused while the portal is quiescing. Retry after quiescence clears; cleanup-safe lease release remains available.",
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            success: false,
            error: "portal_quiescing",
            message:
              `Mutating MCP write refused during ${config.level}. ` +
              `Run get_quiescence_status for blockers and retry after ${data.retryAfterSeconds}s.`,
            data,
          },
          null,
          2,
        ),
      },
    ],
    structuredContent: data,
    isError: true,
  };
}

function insufficientScopeResult(
  toolName: string,
  tokenScope: McpTokenScope,
  requiredScope: McpTokenScope,
  requiredGrants: readonly string[],
): McpToolsCallResult {
  return {
    content: [
      {
        type: "text",
        text:
          `${toolName} requires a ${requiredScope}-scoped MCP token. ` +
          `This token is ${tokenScope}. Issue a ${requiredScope} token in Admin > Platform Development > MCP, then retry.`,
      },
    ],
    structuredContent: {
      error: "insufficient_token_scope",
      toolName,
      requiredScope,
      tokenScope,
      requiredGrants,
      action: `Issue a ${requiredScope} MCP token in Admin > Platform Development > MCP.`,
    },
    isError: true,
  };
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

async function handleTasksSubmit(
  id: JsonRpcId,
  token: ResolvedAuth,
  params: Record<string, unknown> | undefined,
): Promise<Response> {
  const userContext = await loadUserContext(token.userId);
  const outcome = await submitRemoteCoworkerTask({
    token: {
      tokenId: token.tokenId,
      userId: token.userId,
      capability: scopeToCapability(normalizeTokenScope(token)),
      source: token.source,
    },
    userContext,
    params,
  });
  if (outcome.kind === "invalid_params") {
    return jsonRpcError(id, JSONRPC_INVALID_PARAMS, outcome.message);
  }
  return jsonRpcOk(id, outcome.result);
}

const BASE_MCP_INSTRUCTIONS =
  "Domain-level MCP surface for the Digital Product Factory. Use tools/list to discover the backlog and planning tools available to your token.";

async function handleInitialize(id: JsonRpcId, params?: Record<string, unknown>): Promise<Response> {
  const requested = typeof params?.["protocolVersion"] === "string" ? params["protocolVersion"] : null;
  const negotiated = SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ?? FALLBACK_PROTOCOL_VERSION;

  // BI-HDLEMP-02 (Seam 2): compose the org-identity context for external callers
  // so an agent carries the org's mission / archetype / locale / stance — and the
  // decisionDomain routing directive that activates BI-HDLEMP-01 — from connect,
  // instead of only a bare tool list. Fail-open: any compose error falls back to
  // the base note; initialize must never break.
  let instructions = BASE_MCP_INSTRUCTIONS;
  try {
    const [{ buildOrgContextBundle, formatOrgContextInstructions }, { prisma }] =
      await Promise.all([
        import("@/lib/mcp/org-context-bundle"),
        import("@dpf/db"),
      ]);
    const bundle = await buildOrgContextBundle(
      prisma as unknown as Parameters<typeof buildOrgContextBundle>[0],
    );
    instructions = formatOrgContextInstructions(BASE_MCP_INSTRUCTIONS, bundle);
  } catch (err) {
    console.warn("[mcp/initialize] org-context compose failed (fail-open):", err);
  }

  return jsonRpcOk(id, {
    protocolVersion: negotiated,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    instructions,
  });
}

async function handleToolsList(
  id: JsonRpcId,
  token: ResolvedAuth,
  tier: McpToolTier = "full",
): Promise<Response> {
  const userContext = await loadUserContext(token.userId);
  const grantMap = getToolGrantMapping();
  // Grant/capability/scope filter first (the authority), then the optional tier
  // narrowing (a context-economy lever, R3/P4). Tiering only affects discovery
  // here — tools/call still executes any granted tool by name — so core tier is
  // a pure token saving with no loss of capability.
  const granted = PLATFORM_TOOLS.filter((t) =>
    tokenCanUseTool(t, token, userContext, grantMap),
  );
  const tools = selectToolsByTier(granted, tier).map(annotateTool);
  return jsonRpcOk(id, { tools });
}

async function handleToolsCall(
  id: JsonRpcId,
  token: ResolvedAuth,
  params: Record<string, unknown> | undefined,
  callerClient?: string,
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
  const toolDef = PLATFORM_TOOLS.find((t) => t.name === toolName);
  const tokenScope = normalizeTokenScope(token);
  const requiredScope = requiredTokenScopeForTool(toolDef, required);
  if (!tokenScopeSatisfies(tokenScope, requiredScope)) {
    return jsonRpcOk(
      id,
      insufficientScopeResult(toolName, tokenScope, requiredScope, required),
    );
  }
  // Expand the token's scopes through GRANT_IMPLICATIONS before checking, so a
  // legacy implying-grant satisfies the finer grant it implies (e.g. a
  // `build_promote` token satisfies `build_lifecycle`). Without this expansion
  // the token layer rejected implying-grant tokens that the agent-grant layer
  // (isToolAllowedByGrants, which already expands) would accept — an
  // inconsistency that left valid tokens unable to reach refactored tools.
  const expandedScopes = expandGrants(token.scopes);
  const tokenAllowed = required.some((g) => expandedScopes.includes(g));
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

  const quiescenceRefusal = await quiescenceRefusalResult(toolName, toolDef);
  if (quiescenceRefusal) {
    return jsonRpcOk(id, quiescenceRefusal);
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
      threadId: token.threadId ?? undefined,
      routeContext: token.routeContext ?? undefined,
      callerClient,
      authSource: token.source,
    },
    source: token.source === "session-jwt" ? "internal-mcp-session" : "external-jsonrpc",
  });

  // Convert ToolResult into MCP tools/call response shape:
  //   - content[]: a single text block carrying a JSON serialization of the
  //     ToolResult so MCP clients see structured data without us inventing
  //     a non-standard return shape
  //   - isError: true on any non-success
  //   - structuredContent: the raw ToolResult.data when present, so clients
  //     that support structured content (per the 2025-11-25 spec) can use it
  //     directly without re-parsing the text block
  // Bound the model-facing payload (G1/P6, context-engineering-standards.md).
  // External CLIs have large windows, so the cap is generous — but the prior
  // behaviour dumped the *full* result.data into BOTH the text block and
  // structuredContent with no ceiling, a real context tax at scale. When data
  // exceeds the budget we substitute a bounded preview marker so both blocks
  // stay within budget AND remain valid JSON the client can still parse.
  let structured: unknown = result.data;
  let dataForText: unknown = result.data;
  if (result.data !== undefined) {
    let dataJson: string;
    try {
      dataJson = JSON.stringify(result.data);
    } catch {
      dataJson = '"[unserializable data]"';
    }
    if (dataJson.length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) {
      const marker = {
        _truncated: true,
        _note:
          "Result exceeded the per-call context budget; re-call with " +
          "filter/pagination/range parameters to narrow it.",
        _originalChars: dataJson.length,
        _preview: dataJson.slice(0, 2_000),
      };
      structured = marker;
      dataForText = marker;
    }
  }
  const text = JSON.stringify(
    {
      success: result.success,
      message: result.message,
      ...(result.entityId ? { entityId: result.entityId } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(dataForText !== undefined ? { data: dataForText } : {}),
    },
    null,
    2,
  );
  const responseBody: Record<string, unknown> = {
    content: [{ type: "text", text }],
    isError: !result.success,
  };
  if (structured !== undefined) {
    responseBody["structuredContent"] = structured;
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

  // Auth — two paths:
  //   X-MCP-Session: <jwt>      — short-lived internal session (Claude CLI
  //                                adapter, future internal callers). JWT
  //                                carries userId/agentId/threadId/scopes.
  //   Authorization: Bearer ... — persistent dpfmcp_* PAT for external
  //                                coding agents (Mark's laptop, VS Code).
  // Session JWT wins when both are present so the adapter's narrow per-call
  // scope cannot accidentally be widened by a stale operator PAT in the same
  // sandbox shell environment.
  const sessionHeader = request.headers.get("x-mcp-session");
  let token: ResolvedAuth;
  if (sessionHeader) {
    const session = await verifyMcpSessionToken(sessionHeader.trim());
    if (!session) {
      return unauthorizedResponse("invalid or expired MCP session");
    }
    token = {
      tokenId: `session:${session.userId}:${session.agentId ?? "no-agent"}`,
      userId: session.userId,
      agentId: session.agentId ?? null,
      scopes: session.scopes,
      scope: session.capability === "write" ? "write" : "read",
      capability: session.capability,
      threadId: session.threadId ?? null,
      routeContext: session.routeContext ?? null,
      source: "session-jwt",
    };
  } else {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return unauthorizedResponse("missing Bearer token or X-MCP-Session header");
    }
    const plaintext = authHeader.slice("bearer ".length).trim();
    const pat = await resolveMcpApiToken(plaintext);
    if (!pat) {
      return unauthorizedResponse("invalid or expired token");
    }
    token = { ...pat, source: "pat" };
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
        return await handleInitialize(body.id ?? null, body.params);

      case "notifications/initialized":
        return new Response(null, { status: 202 });

      case "tools/list":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsList(
          body.id ?? null,
          token,
          resolveEffectiveTier(
            new URL(request.url).searchParams.get("tier"),
            deriveCallerClient(request.headers.get("user-agent")),
          ),
        );

      case "tools/call":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsCall(
          body.id ?? null,
          token,
          body.params,
          deriveCallerClient(request.headers.get("user-agent")),
        );

      case "tasks/submit":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleTasksSubmit(body.id ?? null, token, body.params);

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
