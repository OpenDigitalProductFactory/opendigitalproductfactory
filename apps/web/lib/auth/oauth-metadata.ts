// OAuth discovery metadata for the MCP resource — RFC 9728 Protected Resource
// Metadata and RFC 8414 Authorization Server Metadata.
//
// This is the piece whose absence made a 401 a dead end: MCP `2025-11-25`
// (`authorization.mdx:63-64, 80-81`) makes PRM a server MUST, and Claude Code,
// Codex and VS Code all perform this discovery. Without it a client is told it
// is unauthorized and given nothing it can act on.
//
// Pure functions over an explicit origin — no request, no DB, no env reads
// beyond the configured base URL — so the documents are unit-testable and the
// route handlers stay thin.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.2

import { ADVERTISED_SCOPES, PUBLIC_SCOPES } from "@/lib/auth/oauth-scope-map";

/** The MCP transport path. The canonical resource URI is this path on the
 *  install's origin — RFC 8707 §2 requires clients to name it exactly. */
export const MCP_RESOURCE_PATH = "/api/mcp/v1";

/** Where the path-suffixed PRM document lives, per RFC 9728 §3.1: the
 *  well-known segment is inserted BEFORE the resource path. */
export const PRM_PATH_SUFFIXED = `/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
export const PRM_PATH_ROOT = "/.well-known/oauth-protected-resource";
export const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";

export const OAUTH_AUTHORIZE_PATH = "/api/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/api/oauth/token";
export const OAUTH_REGISTER_PATH = "/api/oauth/register";
export const OAUTH_REVOKE_PATH = "/api/oauth/revoke";

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return value.slice(0, end);
}

function hostnameOf(host: string): string {
  // Strip port; a bracketed IPv6 literal keeps its brackets after this.
  return host
    .toLowerCase()
    .replace(/^\[(.+)\]:?\d*$/, "$1")
    .replace(/:\d+$/, "");
}

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * The origin this install advertises as its own.
 *
 * EXPLICIT configuration wins. Note this deliberately does NOT use
 * `resolveAppBaseUrl()`: that helper returns a hardcoded
 * `http://localhost:3000` whenever NODE_ENV is not production, which is right
 * for building an email link and wrong here. A client that connects on
 * `127.0.0.1:3000` would be handed `localhost:3000` as its audience, and
 * `resourceMatches` would then refuse its own token forever — the same
 * localhost-vs-127.0.0.1 trap the MCP authorization runbook already warns
 * about for client config. Audience binding must reflect the address the
 * client actually reached, not a development default.
 *
 * Falling back to the request's own Host header is normally a header-injection
 * vector, so it is permitted ONLY when that host is loopback: a local install
 * legitimately has no configured public URL, and a loopback Host cannot be
 * forged by a remote caller into something that reaches anyone else. Any other
 * unconfigured host yields null, and the caller turns that into an honest 404
 * rather than advertising a guessed origin.
 */
export function resolveResourceOrigin(request: Request): string | null {
  const configured =
    process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_URL;
  if (configured && configured.trim()) return stripTrailingSlashes(configured.trim());

  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  if (!host) return null;
  if (!isLoopbackHostname(hostnameOf(host))) return null;

  const xfProto = request.headers.get("x-forwarded-proto");
  const proto = (xfProto?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "")).toLowerCase();
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/** The canonical resource URI clients must send as RFC 8707 `resource`. */
export function canonicalResourceUri(origin: string): string {
  return `${stripTrailingSlashes(origin)}${MCP_RESOURCE_PATH}`;
}

/**
 * Compare a client-supplied `resource` against the canonical URI.
 *
 * RFC 8707 §2 canonicalization: scheme and host are case-insensitive, the
 * default port for the scheme is equivalent to no port, and a trailing slash
 * on an otherwise-matching path is tolerated. Everything else must match
 * exactly — audience binding is what stops a token minted for one install
 * being replayed at another, so this is deliberately strict.
 */
export function resourceMatches(candidate: string, origin: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(candidate);
    b = new URL(canonicalResourceUri(origin));
  } catch {
    return false;
  }
  if (a.protocol !== b.protocol) return false;
  if (a.hostname.toLowerCase() !== b.hostname.toLowerCase()) return false;

  const defaultPort = a.protocol === "https:" ? "443" : "80";
  const portA = a.port || defaultPort;
  const portB = b.port || defaultPort;
  if (portA !== portB) return false;

  if (stripTrailingSlashes(a.pathname) !== stripTrailingSlashes(b.pathname)) return false;
  // A `resource` carrying a query or fragment is not the canonical URI.
  if (a.search || a.hash) return false;
  return true;
}

export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
  resource_documentation?: string;
};

/** RFC 9728 Protected Resource Metadata. `authorization_servers` points at
 *  this same install: the portal is its own authorization server, so a local
 *  install needs nothing external. If an identity edge later lands, this is
 *  the single value that changes — the indirection is the seam. */
export function buildProtectedResourceMetadata(origin: string): ProtectedResourceMetadata {
  return {
    resource: canonicalResourceUri(origin),
    authorization_servers: [stripTrailingSlashes(origin)],
    scopes_supported: [...ADVERTISED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "DPF MCP",
  };
}

export type AuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  registration_endpoint?: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  client_id_metadata_document_supported: boolean;
  resource_indicators_supported: boolean;
};

/**
 * RFC 8414 Authorization Server Metadata.
 *
 * `code_challenge_methods_supported` is S256 only — OAuth 2.1 removes `plain`,
 * and advertising it would invite a downgrade.
 *
 * `scopes_supported` here lists the WHOLE public vocabulary, unlike the PRM
 * document which advertises only the read floor. That asymmetry is deliberate
 * and spec-sanctioned (`authorization.mdx:108-118`): the PRM value drives what
 * a client requests by default, while the AS value tells it what may be
 * obtained at all through step-up.
 */
export function buildAuthorizationServerMetadata(
  origin: string,
  options: { registrationEnabled: boolean },
): AuthorizationServerMetadata {
  const base = stripTrailingSlashes(origin);
  const metadata: AuthorizationServerMetadata = {
    issuer: base,
    authorization_endpoint: `${base}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${base}${OAUTH_TOKEN_PATH}`,
    revocation_endpoint: `${base}${OAUTH_REVOKE_PATH}`,
    scopes_supported: [...PUBLIC_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    // False on purpose: this server does not FETCH a Client ID Metadata
    // Document (see oauth-clients.resolveCimdClient). Advertising support we
    // do not perform would send clients down a path that silently fails.
    client_id_metadata_document_supported: false,
    resource_indicators_supported: true,
  };
  if (options.registrationEnabled) {
    metadata.registration_endpoint = `${base}${OAUTH_REGISTER_PATH}`;
  }
  return metadata;
}

/**
 * The `WWW-Authenticate` value for an unauthenticated MCP request.
 *
 * The `resource_metadata` parameter is the whole point: it is what turns a
 * refusal into a flow. `scope` carries the read floor so a client requests
 * least privilege rather than guessing (`authorization.mdx:104-118`).
 */
export function buildUnauthorizedChallenge(origin: string | null, detail: string): string {
  const parts = [`realm="DPF MCP"`, `error="invalid_token"`, `error_description="${sanitize(detail)}"`];
  if (origin) {
    parts.push(`resource_metadata="${stripTrailingSlashes(origin)}${PRM_PATH_SUFFIXED}"`);
    parts.push(`scope="${ADVERTISED_SCOPES.join(" ")}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/**
 * The `WWW-Authenticate` value for a runtime scope refusal (403).
 *
 * Follows the spec's *recommended* inclusion strategy
 * (`authorization.mdx:520-524`): return the scopes already granted PLUS the
 * newly required ones, so re-authorization never costs the client ground it
 * already had.
 */
export function buildInsufficientScopeChallenge(
  origin: string | null,
  options: { granted: readonly string[]; required: readonly string[]; detail: string },
): string {
  const scopes = Array.from(new Set([...options.granted, ...options.required]));
  const parts = [
    `error="insufficient_scope"`,
    `scope="${scopes.join(" ")}"`,
    `error_description="${sanitize(options.detail)}"`,
  ];
  if (origin) {
    parts.push(`resource_metadata="${stripTrailingSlashes(origin)}${PRM_PATH_SUFFIXED}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/** Header values are quoted-strings: a stray quote, backslash, CR or LF would
 *  let a detail message break the header. Strip rather than escape — these are
 *  human-readable hints, not data. */
function sanitize(value: string): string {
  return value.replace(/[\r\n"\\]/g, " ").trim();
}
