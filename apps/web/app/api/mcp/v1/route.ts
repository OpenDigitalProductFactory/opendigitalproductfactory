// Canonical MCP JSON-RPC transport for external agents. It composes the
// governed tool/task services; the in-portal /api/mcp/* REST seam is separate.
// Auth is a DPF PAT or a short-lived internal MCP session token.

import {
  resolveMcpApiToken,
  type McpTokenCapability,
  type McpTokenScope,
  type ResolvedMcpToken,
} from "@/lib/auth/mcp-api-token";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS, resolveAnnotations, type ToolDefinition } from "@/lib/mcp-tools";
import { getQuiescenceConfig } from "@/lib/self-upgrade/quiescence";
import { getToolGrantMapping, expandGrants } from "@/lib/tak/agent-grants";
import {
  resolveListingAuthorityForToken,
  filterListableTools,
} from "@/lib/mcp/listing-authority-resolver";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import {
  resolveEffectiveTier,
  selectToolsForListing,
  resolveLoadToolsSelection,
  LOAD_TOOLS_TOOL_NAME,
  type McpToolTier,
} from "@/lib/mcp/tool-tier";
import { getLoadedToolNames, loadToolsForSession } from "@/lib/mcp/tool-session-store";
import {
  shouldAdvertiseTasksCapability,
  tasksLifecycleEnabled,
  tasksExtensionNegotiated,
  bindMcpTaskOwner,
} from "@/lib/mcp/tasks-lifecycle";
import {
  LOAD_TOOLS_LISTED,
  MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS,
  buildLoadToolsResult,
  buildUnknownToolResult,
  loadToolsSseResponse,
} from "@/lib/mcp/load-tools";
import { cacheableCompleteResult, type ModernMcpRequestMetadata } from "@/lib/mcp/protocol-2026";
import {
  buildMcpInstructions,
  buildServerDiscoveryResult,
  validateModernRouteRequest,
} from "@/lib/mcp/route-modern";
import {
  jsonResponse,
  jsonRpcError,
  jsonRpcOk,
  type JsonRpcId,
} from "@/lib/mcp/route-jsonrpc";
import { withMcpRouteTelemetry } from "@/lib/mcp/route-telemetry";
import {
  dispatchMcpTaskLifecycle,
  submitMcpTask,
  type McpTaskRouteAuth,
} from "@/lib/mcp/route-task-dispatch";
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

// Versions we can speak, newest first. We echo back the version the client
// requested when it is in this list so older clients connect. Include every
// wire revision clients actually send — Grok Build 1.0.0 negotiates
// `2025-06-18` and re-sends it as `MCP-Protocol-Version` on tools/list; omitting
// it made initialize fall back but then 400'd subsequent calls.
// Tasks capability is ONLY advertised on 2025-11-25 (see shouldAdvertiseTasksCapability).
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const FALLBACK_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "dpf-platform";
const SERVER_VERSION = "1.0.0";
const BASE_MCP_INSTRUCTIONS = MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS;

// JSON-RPC 2.0 standard error codes
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type McpToolsCallResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
};

function scopeToCapability(scope: McpTokenScope): McpTokenCapability {
  return scope === "read" ? "read" : "write";
}

function normalizeTokenScope(token: Pick<ResolvedMcpToken, "scope" | "capability">): McpTokenScope {
  if (token.scope === "admin" || token.scope === "write" || token.scope === "read") {
    return token.scope;
  }
  return token.capability === "write" ? "write" : "read";
}

function taskRouteAuth(token: ResolvedAuth): McpTaskRouteAuth {
  return {
    tokenId: token.tokenId,
    userId: token.userId,
    agentId: token.agentId,
    scopes: token.scopes,
    capability: scopeToCapability(normalizeTokenScope(token)),
    source: token.source,
  };
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
        // ALL groups, not `take: 1`: a human in more than one group has their
        // platform role under-determined by the first row (which may even carry
        // a null platformRole). Resolve it exactly as the web session does
        // (resolveWorkforcePlatformRole — first group with a non-null role) so
        // the agent's role matches what the human sees logged in.
        groups: { include: { platformRole: true } },
      },
    })
    .catch(() => null);
  return {
    userId,
    platformRole: row ? resolveWorkforcePlatformRole(row.groups) : null,
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
  // MCP 2025-11-25 optional metadata: emit top-level title/icons/outputSchema
  // only when the tool defines them. outputSchema is stamped with the 2020-12
  // dialect ($schema) unless the tool already declared one.
  const outputSchema = tool.outputSchema
    ? { $schema: "https://json-schema.org/draft/2020-12/schema", ...tool.outputSchema }
    : undefined;
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(tool.icons ? { icons: tool.icons } : {}),
    annotations: {
      title: tool.title ?? tool.name.replace(/_/g, " "),
      readOnlyHint: ann.readOnlyHint,
      destructiveHint: ann.destructiveHint,
      idempotentHint: ann.idempotentHint,
      openWorldHint: ann.openWorldHint,
    },
  };
}

// load_tools: mark the requested GRANTED tools loaded for this token's session
// so the next tools/list appends them (append-not-swap). Candidates come from
// the SAME grant filter as tools/list, so a model can never load a tool it isn't
// granted; execution still gates on grants at tools/call. Presentation + SSE
// framing live in lib/mcp/load-tools.ts to keep this transport module lean.
async function handleLoadTools(
  id: JsonRpcId,
  token: ResolvedAuth,
  args: Record<string, unknown>,
  acceptsEventStream: boolean,
  modern = false,
): Promise<Response> {
  const userContext = await loadUserContext(token.userId);
  const grantMap = getToolGrantMapping();
  const granted = PLATFORM_TOOLS.filter((t) => tokenCanUseTool(t, token, userContext, grantMap));
  // Same authority filter as tools/list: a token can never load (and so never
  // call) a tool the agent's grants / the human's clearance would reject.
  const authorized = filterListableTools(
    granted,
    await resolveListingAuthorityForToken(token, userContext),
  );
  const selected = resolveLoadToolsSelection(authorized, args);
  const loadedToolNames = await loadToolsForSession(
    token.tokenId,
    selected.map((t) => t.name),
  );
  const result = buildLoadToolsResult(
    selected.map((t) => ({ name: t.name, description: t.description })),
    loadedToolNames,
  );
  return acceptsEventStream && selected.length > 0
    ? loadToolsSseResponse(id, result)
    : jsonRpcOk(id, result, modern);
}

async function handleInitialize(id: JsonRpcId, params?: Record<string, unknown>): Promise<Response> {
  const requested = typeof params?.["protocolVersion"] === "string" ? params["protocolVersion"] : null;
  const negotiated = SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ?? FALLBACK_PROTOCOL_VERSION;

  // BI-HDLEMP-02 (Seam 2): compose the org-identity context for external callers
  // so an agent carries the org's mission / archetype / locale / stance — and the
  // decisionDomain routing directive that activates BI-HDLEMP-01 — from connect,
  // instead of only a bare tool list. Fail-open: any compose error falls back to
  // the base note; initialize must never break.
  const instructions = await buildMcpInstructions(MCP_PROGRESSIVE_DISCLOSURE_INSTRUCTIONS);
  return jsonRpcOk(id, {
    protocolVersion: negotiated,
    capabilities: {
      // listChanged: load_tools emits notifications/tools/list_changed (over an
      // SSE response on the load_tools POST for clients that Accept it); clients
      // that ignore it still work — the lean core tier is always the floor.
      tools: { listChanged: true },
      // Standard MCP Tasks (Phase 0, read-only): tasks/get|result|list|cancel
      // over the durable TaskRun substrate. Advertise ONLY when the negotiated
      // protocol is Tasks-aware (2025-11-25+) AND the feature flag is on.
      // Advertising on 2024-11-05 / 2025-03-26 breaks clients that reject
      // unknown capability keys at initialize (Grok Build 1.0.0 → CustomResult
      // handshake failure). Methods remain routable; discovery is gated.
      // Value shape is spec-load-bearing: tasks.list/.cancel are `object`
      // (present-if-supported), NOT boolean. A boolean fails strict client
      // capability validation — Claude Code rejects the whole initialize and
      // loads zero tools. Empty object = supported (cf. logging/completions).
      ...(shouldAdvertiseTasksCapability(negotiated)
        ? { tasks: { list: {}, cancel: {} } }
        : {}),
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description:
        "Digital Product Factory MCP transport — governed backlog, planning, coworker, and build tools for external coding agents.",
    },
    instructions,
  });
}

async function handleServerDiscover(id: JsonRpcId): Promise<Response> {
  return jsonRpcOk(id, await buildServerDiscoveryResult(BASE_MCP_INSTRUCTIONS), true);
}

async function handleToolsList(
  id: JsonRpcId,
  token: ResolvedAuth,
  tier: McpToolTier = "full",
  modern = false,
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
  // Unify the list with the call path's coworker-authority gate for agent-bound
  // tokens: drop tools the acting agent's grants don't cover (list/call skew),
  // and — when the acting human's clearance doesn't cover the agent's data
  // sensitivity — drop the whole agent-bound surface (every call would be denied
  // sensitivity-clearance-denied). A non-agent-bound token is unaffected.
  const authorized = filterListableTools(
    granted,
    await resolveListingAuthorityForToken(token, userContext),
  );
  // Phase 2 (deferred loading): the tier surface is the FLOOR; append any tools
  // this token pulled in via load_tools, then the load_tools meta-tool itself.
  // Append-not-swap keeps the lean core for clients that ignore list_changed and
  // preserves the cached prompt prefix (tools are only ever added, never
  // removed/reordered).
  const loadedNames = new Set(await getLoadedToolNames(token.tokenId));
  const listed = selectToolsForListing(authorized, tier, loadedNames).map(annotateTool);
  const result = { tools: [...listed, LOAD_TOOLS_LISTED] };
  return jsonRpcOk(
    id,
    modern ? cacheableCompleteResult(result, 0, "private") : result,
    modern,
  );
}

async function handleToolsCall(
  id: JsonRpcId,
  token: ResolvedAuth,
  params: Record<string, unknown> | undefined,
  callerClient?: string,
  acceptsEventStream: boolean = false,
  modern = false,
  modernMetadata: ModernMcpRequestMetadata | null = null,
): Promise<Response> {
  if (!params || typeof params["name"] !== "string") {
    return jsonRpcError(id, JSONRPC_INVALID_PARAMS, "tools/call requires params.name (string)");
  }
  const toolName = params["name"];
  const args = (params["arguments"] as Record<string, unknown> | undefined) ?? {};

  // load_tools is a transport-level meta-tool, not a governed domain tool:
  // handle it inline (it manages per-token discovery state) and never route it
  // to governedExecuteTool.
  if (toolName === LOAD_TOOLS_TOOL_NAME) {
    return await handleLoadTools(id, token, args, acceptsEventStream, modern);
  }

  // Token-scope gate. The wrapper also rejects on grant mismatch when an
  // agentId is in context, but we want a fast pre-check here so an external
  // client gets a clear "your token can't do this" instead of a generic
  // forbidden_grant from the wrapper's agent-grant path.
  const grantMap = getToolGrantMapping();
  const required = grantMap[toolName];
  if (!required) {
    return jsonRpcOk(id, buildUnknownToolResult(toolName), modern);
  }
  const toolDef = PLATFORM_TOOLS.find((t) => t.name === toolName);
  const tokenScope = normalizeTokenScope(token);
  const requiredScope = requiredTokenScopeForTool(toolDef, required);
  if (!tokenScopeSatisfies(tokenScope, requiredScope)) {
    return jsonRpcOk(
      id,
      insufficientScopeResult(toolName, tokenScope, requiredScope, required),
      modern,
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
    }, modern);
  }

  const quiescenceRefusal = await quiescenceRefusalResult(toolName, toolDef);
  if (quiescenceRefusal) {
    return jsonRpcOk(id, quiescenceRefusal, modern);
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
      tokenScope, tokenGrantScopes: expandedScopes,
    },
    source: token.source === "session-jwt" ? "internal-mcp-session" : "external-jsonrpc",
  });

  if (
    modern &&
    result.success &&
    toolDef?.taskAugmented &&
    tasksExtensionNegotiated(modernMetadata?.clientCapabilities ?? {}) &&
    typeof result.data === "object" &&
    result.data !== null &&
    !Array.isArray(result.data) &&
    typeof (result.data as Record<string, unknown>)["taskRunId"] === "string"
  ) {
    const task = await bindMcpTaskOwner(
      { userId: token.userId, tokenId: token.tokenId, agentId: token.agentId },
      (result.data as Record<string, unknown>)["taskRunId"] as string,
    );
    if (task.kind === "ok") return jsonRpcOk(id, task.value, true);
    return jsonRpcError(id, JSONRPC_INVALID_PARAMS, task.message);
  }

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
  return jsonRpcOk(id, responseBody, modern);
}

async function handlePost(request: Request): Promise<Response> {
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

  // Dual-era dispatch happens at the transport boundary. A modern request is
  // self-describing and independently validated; legacy requests retain the
  // initialize-era compatibility behavior below.
  const protocolHeader = request.headers.get("mcp-protocol-version");
  const modernValidation = validateModernRouteRequest(request, body);
  if ("error" in modernValidation) {
    return jsonRpcError(
      body.id ?? null,
      modernValidation.error.code,
      modernValidation.error.message,
      modernValidation.error.data,
      modernValidation.error.httpStatus,
    );
  }
  const { modern, metadata: modernMetadata, callerClient } = modernValidation;
  if (!modern &&
    protocolHeader &&
    body.method !== "initialize" &&
    !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)
  ) {
    return jsonRpcError(
      body.id ?? null,
      JSONRPC_INVALID_REQUEST,
      `unsupported MCP-Protocol-Version: ${protocolHeader}; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      undefined,
      400,
    );
  }

  try {
    switch (body.method) {
      case "initialize":
        if (modern) {
          return jsonRpcError(
            body.id ?? null,
            JSONRPC_METHOD_NOT_FOUND,
            "initialize is not part of MCP 2026-07-28; use server/discover or call a method directly",
            undefined,
            404,
          );
        }
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleInitialize(body.id ?? null, body.params);

      case "notifications/initialized":
        return new Response(null, { status: 202 });

      case "server/discover":
        if (!modern) {
          return jsonRpcError(body.id ?? null, JSONRPC_METHOD_NOT_FOUND, "unknown method: server/discover");
        }
        if (isNotification) return new Response(null, { status: 202 });
        return await handleServerDiscover(body.id ?? null);

      case "tools/list":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsList(
          body.id ?? null,
          token,
          resolveEffectiveTier(
            new URL(request.url).searchParams.get("tier"),
            callerClient,
          ),
          modern,
        );

      case "tools/call":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsCall(
          body.id ?? null,
          token,
          body.params,
          callerClient,
          (request.headers.get("accept") ?? "").includes("text/event-stream"),
          modern,
          modernMetadata,
        );

      case "tasks/submit":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        {
          const outcome = await submitMcpTask(taskRouteAuth(token), body.params);
          return outcome.kind === "ok"
            ? jsonRpcOk(body.id ?? null, outcome.value)
            : jsonRpcError(body.id ?? null, outcome.code, outcome.message, outcome.data, outcome.httpStatus);
        }

      case "tasks/get":
      case "tasks/update":
      case "tasks/result":
      case "tasks/list":
      case "tasks/cancel":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        {
          const outcome = await dispatchMcpTaskLifecycle({
            method: body.method,
            token: taskRouteAuth(token),
            params: body.params,
            modern,
            clientCapabilities: modernMetadata?.clientCapabilities ?? {},
          });
          return outcome.kind === "ok"
            ? jsonRpcOk(body.id ?? null, outcome.value, modern)
            : jsonRpcError(body.id ?? null, outcome.code, outcome.message, outcome.data, outcome.httpStatus);
        }

      case "ping":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return jsonRpcOk(body.id ?? null, {}, modern);

      default:
        if (isNotification) {
          // Unknown notifications are silently accepted per JSON-RPC 2.0.
          return new Response(null, { status: 202 });
        }
        return jsonRpcError(
          body.id ?? null,
          JSONRPC_METHOD_NOT_FOUND,
          `unknown method: ${body.method}`,
          undefined,
          modern ? 404 : 200,
        );
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

/**
 * Privacy-safe compatibility observation wraps the canonical handler rather
 * than leaking telemetry concerns into every dispatch branch. Request and
 * response bodies are inspected only transiently by the bounded projector;
 * prompts, tool arguments, auth material, task IDs, and agent identities are
 * never persisted.
 */
export async function POST(request: Request): Promise<Response> {
  return withMcpRouteTelemetry(request, handlePost);
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
