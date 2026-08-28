// Real MCP JSON-RPC 2.0 transport for external coding agents (Claude Code,
// Codex CLI, VS Code MCP) on the user's host. Spec snapshot in
// docs/Reference/mcp/spec/ (version 2025-11-25).
//
// This is the canonical MCP endpoint. The bespoke REST endpoints at
// /api/mcp/tools and /api/mcp/call remain for in-portal coworker chat
// (which speaks its own contract, not MCP); this route is what an MCP
// client points at.
//
// Auth: ONE authorization server, two grant types — not two credential
// systems (design 2026-08-26 §2.1).
//
//   authorization_code + PKCE  anything with a browser. The client discovers
//                              the AS from the 401's `resource_metadata`, a
//                              human consents once, and the client refreshes
//                              silently thereafter. This is the default door.
//   client_credentials         headless callers — CI, cron, containers. Same
//                              AS, same scope vocabulary, same revocation
//                              surface. A grant type, not a side door.
//
// This file previously read: "We do NOT implement OAuth 2.1 resource-server
// discovery (the GitHub-PAT pattern, intentionally)." That was right for a
// single-operator loopback surface and stopped being right once (a) five
// external clients connect and all of them perform RFC 9728 discovery,
// (b) `2025-11-25` made Protected Resource Metadata a server MUST while we
// advertise that revision on the wire, and (c) consumer installs have no
// operator with a portal habit to mint a token by hand.
//
// The `dpfmcp_` PAT still resolves, and every configured client keeps working.
// It is on a deprecation horizon: issuance closes first, resolution survives
// until the operator sets the horizon (DPF_MCP_PAT_RESOLUTION_DISABLED). Two
// permanent credential systems would mean two resolution paths, two revocation
// surfaces and two audit shapes — and the second is the one nobody keeps
// current.
import {
  resolveMcpApiToken,
  type McpTokenCapability,
  type McpTokenScope,
  type ResolvedMcpToken,
} from "@/lib/auth/mcp-api-token";
import { deriveCallerClient } from "@/lib/mcp/caller-client";
import { buildMcpInitializeResult } from "@/lib/mcp/initialize";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { buildUnauthorizedChallenge, resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { resolveOAuthAccessToken } from "@/lib/auth/oauth-tokens";
import { isPatResolutionDisabled } from "@/lib/auth/oauth-policy";
import { type PublicScope } from "@/lib/auth/oauth-scope-map";
import { buildStepUpChallenge, type StepUpContext } from "@/lib/auth/oauth-step-up";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS, resolveAnnotations, type ToolDefinition } from "@/lib/mcp-tools";
import { submitRemoteCoworkerTask } from "@/lib/mcp-task-submit";
import { getQuiescenceConfig } from "@/lib/self-upgrade/quiescence";
import { getToolGrantMapping, expandGrants } from "@/lib/tak/agent-grants";
import {
  resolveListingAuthorityForToken,
  filterListableTools,
} from "@/lib/mcp/listing-authority-resolver";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import {
  resolveEffectiveTierForAuthSource,
  selectToolsForListing,
  resolveLoadToolsSelection,
  mergeLoadedToolNames,
  LOAD_TOOLS_TOOL_NAME,
  type McpToolTier,
  type McpAuthSource,
} from "@/lib/mcp/tool-tier";
import { getLoadedToolNames, loadToolsForSession } from "@/lib/mcp/tool-session-store";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@/lib/mcp/protocol-versions";
import {
  tasksLifecycleEnabled,
  handleTasksGet,
  handleTasksResult,
  handleTasksList,
  handleTasksCancel,
  type TaskLifecycleResult,
} from "@/lib/mcp/tasks-lifecycle";
import { LOAD_TOOLS_LISTED, buildLoadToolsResult, buildUnknownToolResult, loadToolsSseResponse } from "@/lib/mcp/load-tools";
import { can, type CapabilityKey, type UserContext } from "@/lib/permissions";
import { prisma } from "@dpf/db";

/** Resolved auth — either a persistent PAT or a short-lived internal session.
 * The route-side handlers consume this single shape; the only difference is
 * what `threadId`/`routeContext` populate audit rows with. */
type ResolvedAuth = ResolvedMcpToken & {
  threadId?: string | null;
  routeContext?: string | null;
  /** Where the auth came from — populates `ToolExecution.executionMode` so we can
   *  tell internal cli-adapter calls from external coding-agent calls.
   *  `oauth` is the default external door; `pat` is on a deprecation horizon. */
  source: McpAuthSource;
};

// Protocol revisions: the governed N/N-1 window + grandfathered set, declared
// ONLY in @/lib/mcp/protocol-versions.ts (W12, BI-EE64547B; guard-enforced).
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

// The 401 is the entry point to the whole authorization flow, not just a
// refusal: `resource_metadata` tells a conformant client where to discover the
// authorization server, and `scope` tells it the least-privilege floor to ask
// for. Without those two parameters a client that performs RFC 9728 discovery
// — Claude Code, Codex and VS Code all do — has nothing to act on, which is
// exactly why connecting used to require a human minting a token by hand.
function unauthorizedResponse(detail: string, request: Request): Response {
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
        "WWW-Authenticate": buildUnauthorizedChallenge(resolveResourceOrigin(request), detail),
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
  // W12 (BI-EE64547B): internal session-JWT calls are per-call stateless — the
  // result still carries the selected definitions inline, but no per-token
  // session row is written (internal lists are full-tier; nothing to append).
  const loadedToolNames =
    token.source === "session-jwt"
      ? mergeLoadedToolNames([], selected.map((t) => t.name))
      : await loadToolsForSession(token.tokenId, selected.map((t) => t.name));
  const result = buildLoadToolsResult(
    selected.map((t) => ({ name: t.name, description: t.description })),
    loadedToolNames,
  );
  return acceptsEventStream && selected.length > 0
    ? loadToolsSseResponse(id, result)
    : jsonRpcOk(id, result);
}

// Standard MCP Tasks Phase-0 read surface: route tasks/get|result|list|cancel to
// the tasks-lifecycle module (auth-context bound over the TaskRun substrate) and
// map its typed result to a JSON-RPC response. Cross-context / bad-id → -32602.
async function handleTasksLifecycle(
  method: string,
  id: JsonRpcId,
  token: ResolvedAuth,
  params: Record<string, unknown> | undefined,
): Promise<Response> {
  if (!tasksLifecycleEnabled()) {
    return jsonRpcError(id, JSONRPC_METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
  let result: TaskLifecycleResult;
  switch (method) {
    case "tasks/get":
      result = await handleTasksGet(token.userId, params);
      break;
    case "tasks/result":
      result = await handleTasksResult(token.userId, params);
      break;
    case "tasks/list":
      result = await handleTasksList(token.userId, params);
      break;
    case "tasks/cancel":
      result = await handleTasksCancel(token.userId, params);
      break;
    default:
      return jsonRpcError(id, JSONRPC_METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
  if (result.kind === "ok") return jsonRpcOk(id, result.value);
  return jsonRpcError(id, JSONRPC_INVALID_PARAMS, result.message);
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

async function handleInitialize(
  id: JsonRpcId,
  token: ResolvedAuth,
  params?: Record<string, unknown>,
): Promise<Response> {
  return jsonRpcOk(
    id,
    await buildMcpInitializeResult({
      params,
      authority: {
        scope: normalizeTokenScope(token),
        scopes: token.scopes,
      },
    }),
  );
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
  // removed/reordered). W12 (BI-EE64547B): the internal path (session-jwt) is
  // per-call stateless — it never reads the store (its synthesized tokenId is
  // shared by concurrent runs of one coworker, so reads would bleed one run's
  // load_tools into another's listing); it lists full-tier every call instead.
  const loadedNames = new Set(
    token.source === "session-jwt" ? [] : await getLoadedToolNames(token.tokenId),
  );
  const listed = selectToolsForListing(authorized, tier, loadedNames).map(annotateTool);
  return jsonRpcOk(id, { tools: [...listed, LOAD_TOOLS_LISTED] });
}

async function handleToolsCall(
  id: JsonRpcId,
  token: ResolvedAuth,
  params: Record<string, unknown> | undefined,
  callerClient?: string,
  acceptsEventStream: boolean = false,
  stepUp?: StepUpContext,
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
    return await handleLoadTools(id, token, args, acceptsEventStream);
  }

  // Token-scope gate. The wrapper also rejects on grant mismatch when an
  // agentId is in context, but we want a fast pre-check here so an external
  // client gets a clear "your token can't do this" instead of a generic
  // forbidden_grant from the wrapper's agent-grant path.
  const grantMap = getToolGrantMapping();
  const required = grantMap[toolName];
  if (!required) {
    return jsonRpcOk(id, buildUnknownToolResult(toolName));
  }
  const toolDef = PLATFORM_TOOLS.find((t) => t.name === toolName);
  const tokenScope = normalizeTokenScope(token);
  const requiredScope = requiredTokenScopeForTool(toolDef, required);
  if (!tokenScopeSatisfies(tokenScope, requiredScope)) {
    const challenge = buildStepUpChallenge(stepUp, required, toolName, requiredScope);
    if (challenge) {
      // OAuth caller: a 403 carrying `error="insufficient_scope"` and the
      // scope set needed is a FLOW, not a halt — the client re-authorizes,
      // the human approves exactly the named additional authority, and the
      // call is retried. This is the moment the scope-escalation rule stops
      // being a human interrupt.
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: JSONRPC_INVALID_REQUEST,
            message: `insufficient_scope: ${toolName} requires ${requiredScope}`,
            data: challenge.data,
          },
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", "WWW-Authenticate": challenge.header },
        },
      );
    }
    // PAT and session-JWT callers keep the pre-existing contract byte-for-byte:
    // HTTP 200 with an isError tool result carrying
    // structuredContent.error = "insufficient_token_scope". Anything reading
    // that contract must not break while the PAT is still resolvable.
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
      tokenScope, tokenGrantScopes: expandedScopes,
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
  // Public scopes actually consented for an OAuth caller. Empty for PAT and
  // session-JWT callers, which is what keeps the step-up 403 scoped to OAuth
  // and leaves the existing insufficient_token_scope contract byte-identical
  // for everyone else.
  let oauthGrantedScopes: PublicScope[] = [];
  if (sessionHeader) {
    const session = await verifyMcpSessionToken(sessionHeader.trim());
    if (!session) {
      return unauthorizedResponse("invalid or expired MCP session", request);
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
      return unauthorizedResponse("missing Bearer token or X-MCP-Session header", request);
    }
    const plaintext = authHeader.slice("bearer ".length).trim();

    // OAuth access token first — it is the default door. Audience binding is
    // enforced inside the resolver: a token minted for another install's
    // canonical resource URI is refused here rather than honoured, which is
    // what stops cross-install replay (`authorization.mdx:469-483`).
    const oauth = await resolveOAuthAccessToken(plaintext, resolveResourceOrigin(request));
    if (oauth) {
      token = { ...oauth.resolved, source: "oauth" };
      oauthGrantedScopes = oauth.publicScopes;
    } else {
      // Falling back to the dpfmcp_ PAT. This path is on a deprecation
      // horizon (design §9.5): issuance closes first, resolution survives
      // until the operator sets the horizon, so no configured client breaks
      // mid-flight.
      if (isPatResolutionDisabled()) {
        return unauthorizedResponse(
          "personal access tokens are retired on this install; connect over OAuth",
          request,
        );
      }
      const pat = await resolveMcpApiToken(plaintext);
      if (!pat) {
        return unauthorizedResponse("invalid or expired token", request);
      }
      token = { ...pat, source: "pat" };
    }
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

  // MCP 2025-11-25 protocol negotiation: a non-initialize request MAY carry an
  // MCP-Protocol-Version header. When present it must be a version we speak;
  // when absent the caller inherits the version negotiated at initialize. An
  // explicit unsupported value is a 400 (lenient on absence, strict on mismatch).
  const protocolHeader = request.headers.get("mcp-protocol-version");
  if (
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
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleInitialize(body.id ?? null, token, body.params);

      case "notifications/initialized":
        return new Response(null, { status: 202 });

      case "tools/list":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleToolsList(
          body.id ?? null,
          token,
          resolveEffectiveTierForAuthSource(
            new URL(request.url).searchParams.get("tier"),
            deriveCallerClient(request.headers.get("user-agent")),
            token.source,
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
          (request.headers.get("accept") ?? "").includes("text/event-stream"),
          token.source === "oauth"
            ? { granted: oauthGrantedScopes, origin: resolveResourceOrigin(request) }
            : undefined,
        );

      case "tasks/submit":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleTasksSubmit(body.id ?? null, token, body.params);

      case "tasks/get":
      case "tasks/result":
      case "tasks/list":
      case "tasks/cancel":
        if (isNotification) {
          return new Response(null, { status: 202 });
        }
        return await handleTasksLifecycle(body.method, body.id ?? null, token, body.params);

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
