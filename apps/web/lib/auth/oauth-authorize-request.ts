// Validation for an OAuth authorization request.
//
// Three surfaces consume this — the GET that starts the flow, the consent page
// that renders it, and the POST that records the decision — and they MUST
// agree. A consent screen that shows one scope set while the POST grants
// another is not a bug you find in review; it is a bug you find in an audit.
// So the parsing lives here once and each surface calls it.
//
// The request is carried through the flow in the URL rather than a pending-
// request table, and every surface re-validates from scratch. Nothing is
// trusted because an earlier step said so: the client must still exist, the
// redirect must still be registered, the resource must still be ours.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.5

import {
  findClientByClientId,
  isRedirectUriAllowed,
  resolveCimdClient,
  type RegisteredClient,
} from "@/lib/auth/oauth-clients";
import { canonicalResourceUri, resourceMatches } from "@/lib/auth/oauth-metadata";
import { ADVERTISED_SCOPES, parseScopeParam, type PublicScope } from "@/lib/auth/oauth-scope-map";

export type AuthorizeRequest = {
  client: RegisteredClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  scopes: PublicScope[];
};

/** An error the client is allowed to see. Two shapes matter and they are NOT
 *  interchangeable:
 *   - `redirect` errors go back to the client's redirect_uri as query params,
 *     per RFC 6749 §4.1.2.1 — the client can then show the user something.
 *   - `direct` errors must be rendered by US, because the redirect_uri itself
 *     is untrustworthy. Bouncing an error to an unvalidated redirect would
 *     make this endpoint an open redirector. */
export type AuthorizeError =
  | { mode: "direct"; error: string; detail: string }
  | { mode: "redirect"; redirectUri: string; state: string | null; error: string; detail: string };

export type ParseResult =
  | { valid: true; request: AuthorizeRequest }
  | { valid: false; failure: AuthorizeError };

function direct(error: string, detail: string): ParseResult {
  return { valid: false, failure: { mode: "direct", error, detail } };
}

export async function parseAuthorizeRequest(
  params: URLSearchParams,
  origin: string,
): Promise<ParseResult> {
  const clientId = params.get("client_id")?.trim() ?? "";
  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  const state = params.get("state");

  if (!clientId) return direct("invalid_request", "client_id is required.");

  // A URL-shaped client_id is a Client ID Metadata Document. Resolving it may
  // require an outbound fetch, which a local install cannot do — that failure
  // surfaces as an unknown client, which is the honest outcome.
  const client = clientId.startsWith("https://")
    ? await resolveCimdClient(clientId)
    : await findClientByClientId(clientId);
  if (!client) {
    return direct("invalid_client", "Unknown or revoked client_id.");
  }

  if (!redirectUri) return direct("invalid_request", "redirect_uri is required.");
  // Validated BEFORE any error is allowed to travel to it — see AuthorizeError.
  if (!isRedirectUriAllowed(client, redirectUri)) {
    return direct(
      "invalid_request",
      "redirect_uri is not registered for this client. This is refused rather than redirected, because redirecting to an unregistered URI would make this an open redirector.",
    );
  }

  // From here on the redirect_uri is trusted, so errors may travel to it.
  const fail = (error: string, detail: string): ParseResult => ({
    valid: false,
    failure: { mode: "redirect", redirectUri, state, error, detail },
  });

  if (params.get("response_type") !== "code") {
    return fail("unsupported_response_type", "Only the authorization code flow is supported.");
  }

  const method = params.get("code_challenge_method");
  const codeChallenge = params.get("code_challenge")?.trim() ?? "";
  if (!codeChallenge) {
    return fail("invalid_request", "code_challenge is required (PKCE is mandatory).");
  }
  if (method !== "S256") {
    // OAuth 2.1 removes `plain`. Accepting a missing method as an implicit
    // `plain` — the OAuth 2.0 default — would be a silent downgrade.
    return fail("invalid_request", "code_challenge_method must be S256.");
  }
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeChallenge)) {
    return fail("invalid_request", "code_challenge is not a valid base64url S256 challenge.");
  }

  // RFC 8707: the client names the resource it intends to use the token with.
  // The spec says clients MUST send it; a client that omits it gets our
  // canonical URI rather than a refusal, so an older client still works and
  // still ends up audience-bound.
  const rawResource = params.get("resource");
  const resource = rawResource?.trim() ? rawResource.trim() : canonicalResourceUri(origin);
  if (!resourceMatches(resource, origin)) {
    return fail(
      "invalid_target",
      "The requested resource is not this installation's MCP endpoint.",
    );
  }

  const { granted, unknown } = parseScopeParam(params.get("scope"));
  if (unknown.length > 0) {
    return fail("invalid_scope", `Unknown scope(s): ${unknown.join(", ")}.`);
  }
  // No scope parameter means the client did not choose; give it the advertised
  // read floor rather than everything (`authorization.mdx:340-343`).
  const requested = granted.length > 0 ? granted : [...ADVERTISED_SCOPES];

  // A pre-registered or credentials client may be capped by the operator.
  // An empty allowedScopes means "not capped" — DCR/CIMD clients register with
  // no scopes because consent, not registration, is where authority is granted.
  const capped =
    client.allowedScopes.length > 0
      ? requested.filter((s) => client.allowedScopes.includes(s))
      : requested;
  if (capped.length === 0) {
    return fail("invalid_scope", "No requested scope is permitted for this client.");
  }

  return {
    valid: true,
    request: { client, redirectUri, state, codeChallenge, resource, scopes: capped },
  };
}

/** Build the RFC 6749 §4.1.2.1 error redirect. */
export function buildErrorRedirect(failure: Extract<AuthorizeError, { mode: "redirect" }>): string {
  const url = new URL(failure.redirectUri);
  url.searchParams.set("error", failure.error);
  url.searchParams.set("error_description", failure.detail);
  if (failure.state) url.searchParams.set("state", failure.state);
  return url.toString();
}

/** Build the success redirect carrying the authorization code. */
export function buildCodeRedirect(
  redirectUri: string,
  code: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
