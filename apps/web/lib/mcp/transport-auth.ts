import {
  resolveMcpApiToken,
  type ResolvedMcpToken,
} from "@/lib/auth/mcp-api-token";
import { verifyMcpSessionToken } from "@/lib/mcp/session-token";
import { buildUnauthorizedChallenge, resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { resolveOAuthAccessToken } from "@/lib/auth/oauth-tokens";
import { isPatResolutionDisabled } from "@/lib/auth/oauth-policy";
import type { PublicScope } from "@/lib/auth/oauth-scope-map";
import type { McpAuthSource } from "@/lib/mcp/tool-tier";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

export type ResolvedMcpTransportAuth = ResolvedMcpToken & {
  threadId?: string | null;
  routeContext?: string | null;
  source: McpAuthSource;
};

export type McpAuthenticationResult =
  | (ActionSuccess & { token: ResolvedMcpTransportAuth; oauthGrantedScopes: PublicScope[] })
  | { ok: false; response: Response };

function unauthorizedResponse(detail: string, request: Request): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: `unauthorized: ${detail}` },
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

function forbiddenResponse(detail: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: `forbidden: ${detail}` },
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

// MCP spec MUST: reject untrusted browser origins to prevent DNS rebinding.
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const allowed = process.env.MCP_ALLOWED_ORIGIN_HOSTS
      ?.split(",")
      .map((candidate) => candidate.trim().toLowerCase())
      .filter(Boolean) ?? [];
    return allowed.includes(host);
  } catch {
    return false;
  }
}

// Plain HTTP is restricted to loopback or an explicit internal-host allowlist.
function isTransportAllowed(request: Request): boolean {
  const xfProto = request.headers.get("x-forwarded-proto");
  const url = new URL(request.url);
  const protocol = (xfProto?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "")).toLowerCase();
  if (protocol === "https") return true;

  const rawHost = (request.headers.get("host") || url.host).toLowerCase();
  const hostname = rawHost.replace(/^\[(.+)\]:?\d*$/, "$1").replace(/:\d+$/, "");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  const allowed = process.env.MCP_INSECURE_INTERNAL_HOSTS
    ?.split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean) ?? [];
  return allowed.includes(hostname);
}

/** One transport/authentication boundary shared by POST and the GET SSE lane. */
export async function authenticateMcpRequest(request: Request): Promise<McpAuthenticationResult> {
  if (!isTransportAllowed(request)) {
    return { ok: false, response: forbiddenResponse("TLS required (HTTPS only outside localhost)") };
  }
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return { ok: false, response: forbiddenResponse(`Origin ${origin} not allowed`) };
  }

  const sessionHeader = request.headers.get("x-mcp-session");
  if (sessionHeader) {
    const session = await verifyMcpSessionToken(sessionHeader.trim());
    if (!session) {
      return { ok: false, response: unauthorizedResponse("invalid or expired MCP session", request) };
    }
    return {
      ...ok(),
      token: {
        tokenId: `session:${session.userId}:${session.agentId ?? "no-agent"}`,
        userId: session.userId,
        agentId: session.agentId ?? null,
        scopes: session.scopes,
        scope: session.capability === "write" ? "write" : "read",
        capability: session.capability,
        threadId: session.threadId ?? null,
        routeContext: session.routeContext ?? null,
        source: "session-jwt",
      },
      oauthGrantedScopes: [],
    };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: unauthorizedResponse("missing Bearer token or X-MCP-Session header", request),
    };
  }
  const plaintext = authHeader.slice("bearer ".length).trim();
  const oauth = await resolveOAuthAccessToken(plaintext, resolveResourceOrigin(request));
  if (oauth) {
    return {
      ...ok(),
      token: { ...oauth.resolved, source: "oauth" },
      oauthGrantedScopes: oauth.publicScopes,
    };
  }
  if (isPatResolutionDisabled()) {
    return {
      ok: false,
      response: unauthorizedResponse(
        "personal access tokens are retired on this install; connect over OAuth",
        request,
      ),
    };
  }
  const pat = await resolveMcpApiToken(plaintext);
  if (!pat) {
    return { ok: false, response: unauthorizedResponse("invalid or expired token", request) };
  }
  return { ...ok(), token: { ...pat, source: "pat" }, oauthGrantedScopes: [] };
}
