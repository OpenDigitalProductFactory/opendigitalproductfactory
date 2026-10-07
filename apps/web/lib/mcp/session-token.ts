// apps/web/lib/mcp/session-token.ts
//
// Short-lived JWT for internal MCP transport. Used by the Claude CLI execution
// adapter (and any future internal MCP clients) to authenticate against
// `/api/mcp/v1` as a specific user/agent/thread without consuming a persistent
// `dpfmcp_*` PAT slot in the operator's token list.
//
// Distinct from `lib/api/jwt.ts`: that helper is for the public mobile API
// access tokens. This helper is internal-only and tied to a different
// issuer and audience (`dpf-mcp-internal` / `dpf-mcp-server`). Both directions
// are refused (BI-7B4B5F5D): this verifier refuses a mobile access token
// (`aud=dpf-mobile-api`), and `verifyAccessToken` requires the mobile issuer,
// audience and `at+jwt` type, so a session token from this module gets a 401
// on the mobile API. Social-login temp tokens and automation sign-in links,
// also signed with AUTH_SECRET, carry their own audiences and are refused by
// both.
//
// Lifetime (BI-44D9B67B): a valid signature is not enough. The verifier requires
// `exp` and `iat`, refuses an `iat` in the future beyond the clock skew, and
// refuses any token whose declared lifetime (`exp - iat`) or age exceeds
// MCP_SESSION_TTL_SECONDS, the same constant the minter uses.

import { SignJWT, jwtVerify } from "jose";
import type { McpTokenCapability } from "@/lib/auth/mcp-api-token";

const ISSUER = "dpf-mcp-internal";
const AUDIENCE = "dpf-mcp-server";

/** 5 minutes — long enough for one CLI turn including model thinking, short
 * enough that a leaked token has minimal blast radius. */
export const MCP_SESSION_TTL_SECONDS = 5 * 60;

/** Clock-skew allowance for `exp`, `iat` and token age. Minter and verifier run
 *  in the same portal process, so this only absorbs small drift. */
export const MCP_SESSION_CLOCK_SKEW_SECONDS = 30;

/** Why a correctly signed session token was refused for its lifetime claims.
 *  Logged on the server only; the client always sees the same 401. */
type McpSessionLifetimeRefusal = "lifetime_exceeds_cap" | "iat_in_future" | "missing_iat" | "missing_exp";

function logLifetimeRefusal(reason: McpSessionLifetimeRefusal): void {
  // No token content, subject or claims: the reason only.
  console.warn(`[mcp-session-token] refused: ${reason} (BI-44D9B67B)`);
}

/** Map a jose claim-validation failure on exp/iat to a refusal reason, or null
 *  when the error is something else (signature, issuer, audience, expiry). */
function lifetimeRefusalFromJoseError(err: unknown): McpSessionLifetimeRefusal | null {
  if (!err || typeof err !== "object") return null;
  const { claim, reason } = err as { claim?: unknown; reason?: unknown };
  // "invalid" is a present but non-numeric claim, treated as absent.
  if (claim === "exp" && (reason === "missing" || reason === "invalid")) return "missing_exp";
  if (claim === "iat" && (reason === "missing" || reason === "invalid")) return "missing_iat";
  if (claim === "iat" && reason === "check_failed") {
    // jose raises JWTExpired for "too far in the past" and a plain claim
    // failure for "it should be in the past".
    const code = (err as { code?: unknown }).code;
    return code === "ERR_JWT_EXPIRED" ? "lifetime_exceeds_cap" : "iat_in_future";
  }
  return null;
}

export type McpSessionPayload = {
  userId: string;
  agentId?: string | null;
  threadId?: string | null;
  routeContext?: string | null;
  /** BI-B949993E: governed TaskRun identity; the route derives the review binding from it. */
  taskRunId?: string | null;
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
    taskRunId: payload.taskRunId ?? null,
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
      requiredClaims: ["exp", "iat"],
      maxTokenAge: MCP_SESSION_TTL_SECONDS,
      clockTolerance: MCP_SESSION_CLOCK_SKEW_SECONDS,
    });
    // maxTokenAge bounds age since iat, not the declared lifetime: a freshly
    // issued token claiming exp a year out would pass it. Cap exp - iat too.
    if (typeof payload.exp !== "number") {
      logLifetimeRefusal("missing_exp");
      return null;
    }
    if (typeof payload.iat !== "number") {
      logLifetimeRefusal("missing_iat");
      return null;
    }
    if (payload.exp - payload.iat > MCP_SESSION_TTL_SECONDS) {
      logLifetimeRefusal("lifetime_exceeds_cap");
      return null;
    }
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
      taskRunId: typeof payload.taskRunId === "string" ? payload.taskRunId : null,
      scopes,
      capability,
    };
  } catch (err) {
    const refusal = lifetimeRefusalFromJoseError(err);
    if (refusal) logLifetimeRefusal(refusal);
    return null;
  }
}
