// @exposure public — RFC 6749 token endpoint. Callers authenticate with a code+PKCE verifier or client credentials, not with a DPF session.
// POST /api/oauth/token — the token endpoint.
//
// Three grants, ONE authorization server (design §2.1):
//   authorization_code  browser flow, PKCE verifier required
//   refresh_token       silent renewal, rotating
//   client_credentials  headless callers — CI, cron, containers. This is what
//                       replaces the dpfmcp_ PAT. It is a grant type, not a
//                       second credential system: same scope vocabulary, same
//                       token table, same revocation surface, same audit.


// Error bodies here are RFC 6749 §5.2 shaped ({ error, error_description }),
// NOT the platform apiErrorResponse shape ({ code, message }). An OAuth client
// parses `error` to decide what to do next — re-authorize, step up, or give up —
// so emitting `code` instead would break the protocol for every conformant
// client. This is the one place the house error contract must yield to the wire
// contract; the raw-route-error baseline records it deliberately.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { findClientByClientId, touchClient } from "@/lib/auth/oauth-clients";
import { canonicalResourceUri, resolveResourceOrigin, resourceMatches } from "@/lib/auth/oauth-metadata";
import { clientCredentialsTtlSeconds } from "@/lib/auth/oauth-policy";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  markRefreshRotated,
  secretMatches,
} from "@/lib/auth/oauth-tokens";
import {
  formatScopeParam,
  parseScopeParam,
  type PublicScope,
} from "@/lib/auth/oauth-scope-map";

export const dynamic = "force-dynamic";

/** RFC 6749 §5.2 error shape. `no-store` matters: a cached token response is a
 *  credential sitting in a proxy. */
function oauthError(error: string, detail: string, status = 400): Response {
  return NextResponse.json(
    { error, error_description: detail },
    { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

function tokenResponse(body: Record<string, unknown>): Response {
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

/** Client authentication: `client_secret_basic` (Authorization header) or
 *  `client_secret_post` (body). Public clients send neither and are
 *  authenticated by PKCE instead. */
function readClientCredentials(
  request: Request,
  form: URLSearchParams,
): { clientId: string; clientSecret: string | null } {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, idx)),
          clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
        };
      }
    } catch {
      // Fall through to body credentials rather than failing outright.
    }
  }
  return {
    clientId: form.get("client_id")?.trim() ?? "",
    clientSecret: form.get("client_secret")?.trim() || null,
  };
}

export async function POST(request: Request) {
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    return oauthError("temporarily_unavailable", "No resolvable public URL.", 503);
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request", "Body must be form-encoded.");
  }

  const grantType = form.get("grant_type")?.trim() ?? "";
  const { clientId, clientSecret } = readClientCredentials(request, form);
  if (!clientId) return oauthError("invalid_client", "client_id is required.");

  const client = await findClientByClientId(clientId);
  if (!client) return oauthError("invalid_client", "Unknown or revoked client.");

  // A confidential client MUST prove itself. A public client holds no secret
  // and must not be allowed to authenticate by sending an empty one.
  if (client.clientSecretHash) {
    if (!clientSecret || !secretMatches(clientSecret, client.clientSecretHash)) {
      return oauthError("invalid_client", "Client authentication failed.", 401);
    }
  } else if (clientSecret) {
    return oauthError("invalid_client", "Public client must not send a secret.", 401);
  }

  const rawResource = form.get("resource")?.trim() || null;
  if (rawResource && !resourceMatches(rawResource, origin)) {
    return oauthError("invalid_target", "resource is not this install's MCP endpoint.");
  }

  switch (grantType) {
    case "authorization_code":
      return handleAuthorizationCode(form, client, origin, rawResource);
    case "refresh_token":
      return handleRefresh(form, client, origin);
    case "client_credentials":
      return handleClientCredentials(form, client, origin);
    default:
      return oauthError(
        "unsupported_grant_type",
        "Supported: authorization_code, refresh_token, client_credentials.",
      );
  }
}

async function handleAuthorizationCode(
  form: URLSearchParams,
  client: NonNullable<Awaited<ReturnType<typeof findClientByClientId>>>,
  origin: string,
  rawResource: string | null,
): Promise<Response> {
  const code = form.get("code")?.trim() ?? "";
  const redirectUri = form.get("redirect_uri")?.trim() ?? "";
  const codeVerifier = form.get("code_verifier")?.trim() ?? "";
  if (!code) return oauthError("invalid_request", "code is required.");
  if (!redirectUri) return oauthError("invalid_request", "redirect_uri is required.");
  if (!codeVerifier) return oauthError("invalid_request", "code_verifier is required.");

  const consumed = await consumeAuthorizationCode(code, {
    oauthClientRowId: client.rowId,
    redirectUri,
    codeVerifier,
    resource: rawResource,
  });
  if (!consumed.accepted) return oauthError(consumed.error, consumed.detail);

  const issued = await issueAccessToken({
    userId: consumed.userId,
    agentId: client.agentId,
    oauthClientRowId: client.rowId,
    clientLabel: client.clientName,
    publicScopes: consumed.scopes,
    origin,
  });
  const refresh = await issueRefreshToken({
    userId: consumed.userId,
    agentId: client.agentId,
    oauthClientRowId: client.rowId,
    publicScopes: consumed.scopes,
    origin,
  });

  touchClient(client.rowId);
  return tokenResponse({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expiresIn,
    refresh_token: refresh,
    scope: formatScopeParam(issued.publicScopes),
  });
}

async function handleRefresh(
  form: URLSearchParams,
  client: NonNullable<Awaited<ReturnType<typeof findClientByClientId>>>,
  origin: string,
): Promise<Response> {
  const presented = form.get("refresh_token")?.trim() ?? "";
  if (!presented) return oauthError("invalid_request", "refresh_token is required.");

  const consumed = await consumeRefreshToken(presented, origin);
  if (!consumed.accepted) return oauthError(consumed.error, consumed.detail);
  if (consumed.oauthClientRowId !== client.rowId) {
    return oauthError("invalid_grant", "Refresh token belongs to another client.");
  }

  // A refresh may narrow scope but never widen it (RFC 6749 §6).
  const requested = parseScopeParam(form.get("scope")).granted;
  const scopes: PublicScope[] =
    requested.length > 0 ? consumed.scopes.filter((s) => requested.includes(s)) : consumed.scopes;
  if (scopes.length === 0) {
    return oauthError("invalid_scope", "Requested scopes exceed the granted set.");
  }

  const issued = await issueAccessToken({
    userId: consumed.userId,
    agentId: consumed.agentId,
    oauthClientRowId: client.rowId,
    clientLabel: client.clientName,
    publicScopes: scopes,
    origin,
  });
  const rotated = await issueRefreshToken({
    userId: consumed.userId,
    agentId: consumed.agentId,
    oauthClientRowId: client.rowId,
    publicScopes: scopes,
    origin,
  });
  // Link old → new so a later presentation of the old one is a detectable
  // replay rather than an accepted renewal.
  await markRefreshRotated(presented, rotated);

  touchClient(client.rowId);
  return tokenResponse({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expiresIn,
    refresh_token: rotated,
    scope: formatScopeParam(issued.publicScopes),
  });
}

/**
 * client_credentials — the headless path.
 *
 * There is no browser and therefore no consent screen, so authority cannot be
 * granted at request time. It is granted ONCE, by an operator, when the client
 * is created in Admin > Platform Development: `allowedScopes` is the grant, and
 * `ownerUserId` is the human whose role caps it. A request may narrow that set
 * and can never exceed it.
 */
async function handleClientCredentials(
  form: URLSearchParams,
  client: NonNullable<Awaited<ReturnType<typeof findClientByClientId>>>,
  origin: string,
): Promise<Response> {
  if (client.registrationKind !== "credentials") {
    return oauthError(
      "unauthorized_client",
      "Client is not registered for client_credentials.",
    );
  }
  if (!client.clientSecretHash) {
    return oauthError("invalid_client", "client_credentials client must be confidential.");
  }
  if (!client.ownerUserId) {
    return oauthError(
      "invalid_client",
      "Client has no owning user to act under.",
    );
  }
  if (client.allowedScopes.length === 0) {
    return oauthError("invalid_scope", "Client has been granted no scopes.");
  }

  const requested = parseScopeParam(form.get("scope")).granted;
  const scopes =
    requested.length > 0
      ? client.allowedScopes.filter((s) => requested.includes(s))
      : client.allowedScopes;
  if (scopes.length === 0) {
    return oauthError("invalid_scope", "No requested scope is granted.");
  }

  const issued = await issueAccessToken({
    userId: client.ownerUserId,
    agentId: client.agentId,
    oauthClientRowId: client.rowId,
    clientLabel: client.clientName,
    publicScopes: scopes,
    origin,
    ttlSeconds: clientCredentialsTtlSeconds(),
  });

  await prisma.oAuthClient
    .update({ where: { id: client.rowId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  // No refresh token: the client already holds durable credentials and can
  // simply ask again. Issuing one would be a second long-lived secret for no
  // benefit — exactly the shape this work is retiring.
  return tokenResponse({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expiresIn,
    scope: formatScopeParam(issued.publicScopes),
    resource: canonicalResourceUri(origin),
  });
}
