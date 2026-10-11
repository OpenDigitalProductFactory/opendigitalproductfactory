// apps/web/lib/provider-oauth.ts
// OAuth 2.0 authorization code + PKCE helpers for provider credential flows.
// Server-only — no "use server" directive (called by server actions and route handlers).

import { randomBytes, createHash } from "crypto";
import { prisma } from "@dpf/db";
import { encryptSecret, decryptSecret } from "@/lib/credential-crypto";
import { activateProvider } from "@/lib/govern/activate-provider";
import { getStablePortalUrl } from "@/lib/portal-url";
import { findProviderCredential } from "@/lib/inference/provider-account-credentials";
import { ACCOUNT_ACCESS_RESET, invalidateProviderAccountProofs } from "@/lib/inference/provider-account-management";

/** Called only by capability-checked actions or the governed tool executor. */
export async function disconnectProviderOAuthInternal(providerId: string, connectionId?: string): Promise<{ error?: string }> {
  if (connectionId !== undefined) {
    const connection = await prisma.aiProviderConnection.findUnique({ where: { connectionId } });
    if (!connection || connection.providerId !== providerId || !connection.credentialEntryId) return { error: "Provider account not found" };
    await prisma.$transaction(async (tx) => {
      await tx.credentialEntry.update({ where: { id: connection.credentialEntryId! }, data: { cachedToken: null, refreshToken: null, tokenExpiresAt: null, status: "unconfigured" } });
      await tx.aiProviderConnection.update({ where: { connectionId }, data: { status: "disconnected" } });
      await tx.oAuthPendingFlow.deleteMany({ where: { connectionId } });
    });
    return {};
  }
  await prisma.credentialEntry.upsert({
    where: { providerId },
    create: { providerId, status: "unconfigured" },
    update: {
      cachedToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      status: "unconfigured",
    },
  });

  // Deactivate linked MCP services when provider disconnects
  const linkedServers = await prisma.mcpServer.findMany({
    where: { config: { path: ["linkedProviderId"], equals: providerId } },
  });
  for (const server of linkedServers) {
    await prisma.mcpServer.update({ where: { id: server.id }, data: { status: "inactive" } });
    await prisma.modelProvider.updateMany({
      where: { providerId: server.serverId, status: "active" },
      data: { status: "inactive" },
    });
  }

  return {};
}

// ─── Host-match helper ────────────────────────────────────────────────────────
// CodeQL alerts #64-#67 (js/incomplete-url-substring-sanitization): the
// previous code used `url.includes("anthropic.com")` to detect Anthropic
// providers. Substring match is too loose — "anthropic.com.evil.example"
// includes "anthropic.com". URL parsing + hostname equality is the right
// check, and it's the pattern CodeQL recognises as a host sanitizer.
function isAnthropicHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host === "anthropic.com" || host.endsWith(".anthropic.com") ||
      host === "claude.com" || host.endsWith(".claude.com")
    );
  } catch {
    return false;
  }
}

// OpenAI issues a refresh token only when the authorize request asks for
// offline_access (BI-46461599). The codex/chatgpt providers use the Codex CLI's
// public client, whose own login requests
// "openid profile email offline_access api.connectors.read api.connectors.invoke"
// (codex-cli 0.130.0); DPF needs none of the connector scopes. Exact-host match,
// same reasoning as isAnthropicHost above.
const OPENAI_AUTH_HOST = "auth.openai.com";
const OPENAI_DEFAULT_OAUTH_SCOPE = "openid profile email offline_access";

function defaultOAuthScope(authorizeUrl: string): string | null {
  try {
    return new URL(authorizeUrl).hostname.toLowerCase() === OPENAI_AUTH_HOST
      ? OPENAI_DEFAULT_OAUTH_SCOPE
      : null;
  } catch {
    return null;
  }
}

// codex and chatgpt share one OpenAI OAuth token.
const OPENAI_PAIR: Record<string, string> = { codex: "chatgpt", chatgpt: "codex" };

// ─── PKCE ─────────────────────────────────────────────────────────────────────

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const verifierBytes = randomBytes(32);
  const codeVerifier = base64url(verifierBytes);
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

// ─── Flow start ───────────────────────────────────────────────────────────────

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Determine the OAuth redirect URI for a provider.
 *  1. Explicit override (escape hatch for unusual providers)
 *  2. Localhost-restricted providers → short /callback path
 *  3. Default → our full API callback route */
const LOCALHOST_RESTRICTED_HOSTS = ["claude.ai"];

function getOAuthRedirectUri(provider: { oauthRedirectUri?: string | null; authorizeUrl?: string | null }): string {
  if (provider.oauthRedirectUri) return provider.oauthRedirectUri;
  // OAuth callback URIs must be STABLE — the provider only accepts the exact
  // pre-registered URL. Use the env-driven helper, not the request-scoped one.
  // (A LAN client and a localhost client must both send the same redirect_uri.)
  const appUrl = getStablePortalUrl();
  // Providers whose OAuth clients restrict redirect URIs to short localhost/callback paths
  if (provider.authorizeUrl && LOCALHOST_RESTRICTED_HOSTS.some(h => provider.authorizeUrl!.includes(h))) {
    return `${appUrl}/callback`;
  }
  return `${appUrl}/api/v1/auth/provider-oauth/callback`;
}

export async function createOAuthFlow(providerId: string, connectionId?: string): Promise<{ authorizeUrl: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { error: "Provider not found" };
  if (!provider.authorizeUrl || !provider.oauthClientId) {
    return { error: "Provider does not support OAuth sign-in (missing authorizeUrl or oauthClientId)" };
  }
  const cred = await findProviderCredential(providerId, connectionId);
  if (connectionId && !cred) return { error: "Account credential not found" };

  // Clean up expired flows
  await prisma.oAuthPendingFlow.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - FLOW_TTL_MS) } },
  });

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = crypto.randomUUID();

  await prisma.oAuthPendingFlow.create({
    data: { state, codeVerifier, providerId, ...(connectionId ? { connectionId } : {}) },
  });

  const redirectUri = getOAuthRedirectUri(provider as { oauthRedirectUri?: string | null; authorizeUrl?: string | null });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: provider.oauthClientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  const scope = cred?.scope || defaultOAuthScope(provider.authorizeUrl);
  if (scope) params.set("scope", scope);

  return { authorizeUrl: `${provider.authorizeUrl}?${params.toString()}` };
}

export async function findPendingOAuthProviderId(
  state: string | null | undefined,
): Promise<string | null> {
  return (await findPendingOAuthContext(state))?.providerId ?? null;
}

export async function findPendingOAuthContext(state: string | null | undefined): Promise<{ providerId: string; connectionId: string | null } | null> {
  if (!state) return null;
  const flow = await prisma.oAuthPendingFlow.findUnique({
    where: { state },
    select: { providerId: true, connectionId: true },
  });
  return flow ? { providerId: flow.providerId, connectionId: flow.connectionId ?? null } : null;
}

export function buildProviderOAuthErrorPath(
  providerId: string | null | undefined,
  reason: string,
  connectionId?: string | null,
): string {
  const encodedReason = encodeURIComponent(reason);
  return providerId
    ? `/platform/ai/providers/${providerId}?oauth=error&reason=${encodedReason}${connectionId ? `&account=${encodeURIComponent(connectionId)}` : ""}`
    : `/platform/ai?oauth=error&reason=${encodedReason}`;
}

// ─── Token exchange (callback) ────────────────────────────────────────────────

export async function exchangeOAuthCode(
  state: string,
  code: string,
): Promise<{ providerId: string; connectionId?: string } | { error: string }> {
  const flow = await prisma.oAuthPendingFlow.findUnique({ where: { state } });
  if (!flow) return { error: "invalid_state" };
  // Claim the single-use state before an upstream request; concurrent callbacks cannot both exchange it.
  const consumed = await prisma.oAuthPendingFlow.deleteMany({ where: { id: flow.id, state } });
  if (consumed.count !== 1) return { error: "invalid_state" };
  const accountCredential = flow.connectionId ? await findProviderCredential(flow.providerId, flow.connectionId) : null;
  if (flow.connectionId && !accountCredential) return { error: "account_credential_missing" };

  if (Date.now() - flow.createdAt.getTime() > FLOW_TTL_MS) {
    return { error: "flow_expired" };
  }

  const provider = await prisma.modelProvider.findUnique({ where: { providerId: flow.providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    return { error: "provider_misconfigured" };
  }

  const redirectUri = getOAuthRedirectUri(provider as { oauthRedirectUri?: string | null; authorizeUrl?: string | null });

  // Anthropic requires JSON + state; OpenAI requires form-encoded without state
  const isAnthropicToken = isAnthropicHost(provider.tokenUrl);
  const tokenData: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    code_verifier: flow.codeVerifier,
    client_id: provider.oauthClientId,
    redirect_uri: redirectUri,
  };
  if (isAnthropicToken) tokenData.state = state;

  const contentType = isAnthropicToken ? "application/json" : "application/x-www-form-urlencoded";
  const body = isAnthropicToken ? JSON.stringify(tokenData) : new URLSearchParams(tokenData).toString();

  let tokenResponse: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[oauth] Token exchange failed: HTTP ${res.status} ${errBody.slice(0, 500)}`);
      console.error(`[oauth] Request: POST ${provider.tokenUrl} | redirect_uri=${redirectUri} | client_id=${provider.oauthClientId?.substring(0, 8)}...`);
      return { error: "token_exchange_failed" };
    }
    tokenResponse = await res.json() as typeof tokenResponse;
  } catch {
    return { error: "token_exchange_failed" };
  }

  if (!tokenResponse.access_token) {
    return { error: "no_token" };
  }

  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
  // A response without a refresh token must not erase one already stored.
  const newRefreshToken = tokenResponse.refresh_token ? encryptSecret(tokenResponse.refresh_token) : null;
  const credentialUpdate = {
    cachedToken: encryptSecret(tokenResponse.access_token),
    ...(newRefreshToken ? { refreshToken: newRefreshToken } : {}),
    tokenExpiresAt: expiresAt,
    status: "ok",
  };
  if (flow.connectionId && accountCredential) {
    const connectionId = flow.connectionId;
    const written = await prisma.$transaction(async (tx) => {
      const connection = await tx.aiProviderConnection.findUnique({ where: { connectionId } });
      if (!connection || connection.credentialEntryId !== accountCredential.id) return false;
      await invalidateProviderAccountProofs(tx, connection.id);
      await tx.credentialEntry.upsert({ where: { id: accountCredential.id }, create: { id: accountCredential.id, providerId: null, ...credentialUpdate }, update: credentialUpdate });
      await tx.aiProviderConnection.update({ where: { connectionId }, data: { ...ACCOUNT_ACCESS_RESET, authMethod: "oauth" } });
      // A callback finishing after Disable must not enable the account again.
      await tx.aiProviderConnection.updateMany({ where: { connectionId, status: { not: "disabled" } }, data: { status: "active" } });
      return true;
    });
    if (!written) return { error: "account_changed" };
  } else await prisma.credentialEntry.upsert({
    where: { providerId: flow.providerId },
    create: {
      providerId: flow.providerId,
      cachedToken: encryptSecret(tokenResponse.access_token),
      refreshToken: newRefreshToken,
      tokenExpiresAt: expiresAt,
      status: "ok",
    },
    update: credentialUpdate,
  });

  // Activate the provider: set status/clearance/authMethod, run model discovery,
  // activate linked MCP services, and sync the codex↔chatgpt sibling.
  // Replaces ad-hoc mutations — see PROVIDER-ACTIVATION-AUDIT.md §5 (F-01, F-03).
  if (!flow.connectionId) await activateProvider(flow.providerId, {
    trigger: "oauth_exchange",
    authMethod: "oauth2_authorization_code",
    activateLinked: true,
  });

  // Bidirectional credential sync: codex and chatgpt share the same OpenAI OAuth
  // token. The credential upsert stays here because activateProvider doesn't
  // handle credential storage (that's the caller's responsibility).
  const sibling = !flow.connectionId && OPENAI_PAIR[flow.providerId];
  if (sibling) {
    const siblingProvider = await prisma.modelProvider.findUnique({ where: { providerId: sibling } });
    if (siblingProvider) {
      await prisma.credentialEntry.upsert({
        where: { providerId: sibling },
        create: {
          providerId: sibling,
          cachedToken: encryptSecret(tokenResponse.access_token),
          refreshToken: newRefreshToken,
          tokenExpiresAt: expiresAt,
          status: "ok",
        },
        update: credentialUpdate,
      });
      // Sibling's status/clearance/discovery already handled by activateLinked
    }
  }

  return { providerId: flow.providerId, ...(flow.connectionId ? { connectionId: flow.connectionId } : {}) };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshOAuthToken(
  providerId: string,
  connectionId?: string,
): Promise<{ token: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: connectionId && providerId === "chatgpt" ? "codex" : providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    return { error: "Provider missing tokenUrl or oauthClientId" };
  }

  const cred = await findProviderCredential(providerId, connectionId);
  const credentialWhere = connectionId && cred ? { id: cred.id } : { providerId };
  if (!cred?.refreshToken) {
    // Nothing can renew this token. Once it is past expiry, say so on the row
    // (and its codex/chatgpt sibling, which holds the same token) instead of
    // leaving status "ok" on a dead credential.
    if (cred?.tokenExpiresAt && cred.tokenExpiresAt.getTime() <= Date.now()) {
      const sibling = OPENAI_PAIR[providerId];
      await prisma.credentialEntry.updateMany({
        where: connectionId ? { id: cred.id } : { providerId: { in: sibling ? [providerId, sibling] : [providerId] } },
        data: { status: "expired" },
      });
    }
    return { error: "Re-authentication required" };
  }

  const decryptedRefresh = decryptSecret(cred.refreshToken);
  if (!decryptedRefresh) return { error: "Re-authentication required — credential key may have changed" };

  const isAnthropicToken = isAnthropicHost(provider.tokenUrl);
  const refreshData: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: decryptedRefresh,
    client_id: provider.oauthClientId,
  };
  const contentType = isAnthropicToken ? "application/json" : "application/x-www-form-urlencoded";
  const refreshBody = isAnthropicToken ? JSON.stringify(refreshData) : new URLSearchParams(refreshData).toString();

  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: refreshBody,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      await prisma.credentialEntry.update({
        where: credentialWhere,
        data: { status: "expired" },
      });
      return { error: "OAuth token expired — admin must re-authenticate" };
    }

    const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    // Optimistic concurrency: only write if refreshToken hasn't changed
    const currentCred = await prisma.credentialEntry.findUnique({ where: credentialWhere });
    if (currentCred?.refreshToken === cred.refreshToken) {
      await prisma.credentialEntry.update({
        where: credentialWhere,
        data: {
          cachedToken: encryptSecret(body.access_token),
          refreshToken: body.refresh_token ? encryptSecret(body.refresh_token) : cred.refreshToken,
          tokenExpiresAt: expiresAt,
          status: "ok",
        },
      });
    }

    // Sync refreshed token to chatgpt provider (shares Codex OAuth)
    if (!connectionId && providerId === "codex") {
      const chatgptCred = await prisma.credentialEntry.findUnique({ where: { providerId: "chatgpt" } });
      if (chatgptCred) {
        await prisma.credentialEntry.update({
          where: { providerId: "chatgpt" },
          data: {
            cachedToken: encryptSecret(body.access_token),
            refreshToken: body.refresh_token ? encryptSecret(body.refresh_token) : chatgptCred.refreshToken,
            tokenExpiresAt: expiresAt,
            status: "ok",
          },
        });
      }
    }

    return { token: body.access_token };
  } catch {
    return { error: "Token refresh network error" };
  }
}
