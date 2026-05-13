// apps/web/lib/mcp/session-token.ts
//
// Short-lived JWT for internal MCP transport. Used by the Claude CLI execution
// adapter (and any future internal MCP clients) to authenticate against
// `/api/mcp/v1` as a specific user/agent/thread without consuming a persistent
// `dpfmcp_*` PAT slot in the operator's token list.
//
// Distinct from `lib/api/jwt.ts`: that helper is for the public mobile API
// access tokens. This helper is internal-only and tied to a different
// audience (`dpf-mcp-server`) so a mobile access-token can never be replayed
// against `/api/mcp/v1` and vice versa.

import { SignJWT, jwtVerify } from "jose";
import type { McpTokenCapability } from "@/lib/auth/mcp-api-token";

const ISSUER = "dpf-mcp-internal";
const AUDIENCE = "dpf-mcp-server";

/** 5 minutes — long enough for one CLI turn including model thinking, short
 * enough that a leaked token has minimal blast radius. */
export const MCP_SESSION_TTL_SECONDS = 5 * 60;

export type McpSessionPayload = {
  userId: string;
  agentId?: string | null;
  threadId?: string | null;
  routeContext?: string | null;
  /** Tool grants this session can exercise — same shape as `McpApiToken.scopes`.
   *  The route's existing scope-vs-tool gate runs identically against either. */
  scopes: string[];
  capability: McpTokenCapability;
};

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is required for MCP session tokens");
  }
  return new TextEncoder().encode(secret);
}

export async function createMcpSessionToken(payload: McpSessionPayload): Promise<string> {
  if (!payload.userId) {
    throw new Error("createMcpSessionToken: userId is required");
  }
  if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) {
    throw new Error("createMcpSessionToken: at least one scope is required");
  }
  if (payload.capability !== "read" && payload.capability !== "write") {
    throw new Error("createMcpSessionToken: capability must be 'read' or 'write'");
  }
  return new SignJWT({
    agentId: payload.agentId ?? null,
    threadId: payload.threadId ?? null,
    routeContext: payload.routeContext ?? null,
    scopes: payload.scopes,
    capability: payload.capability,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MCP_SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyMcpSessionToken(token: string): Promise<McpSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    const scopes = Array.isArray(payload.scopes) ? (payload.scopes as string[]) : null;
    const capability = payload.capability;
    if (!userId || !scopes || (capability !== "read" && capability !== "write")) {
      return null;
    }
    return {
      userId,
      agentId: typeof payload.agentId === "string" ? payload.agentId : null,
      threadId: typeof payload.threadId === "string" ? payload.threadId : null,
      routeContext: typeof payload.routeContext === "string" ? payload.routeContext : null,
      scopes,
      capability,
    };
  } catch {
    return null;
  }
}
