// apps/web/lib/provider-oauth.ts
// OAuth 2.0 authorization code + PKCE helpers for provider credential flows.
// Server-only — no "use server" directive (called by server actions and route handlers).

import { randomBytes, createHash } from "crypto";
import { prisma } from "@dpf/db";
import { encryptSecret, decryptSecret } from "@/lib/credential-crypto";

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
  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  // Providers whose OAuth clients restrict redirect URIs to short localhost/callback paths
  if (provider.authorizeUrl && LOCALHOST_RESTRICTED_HOSTS.some(h => provider.authorizeUrl!.includes(h))) {
    return `${appUrl}/callback`;
  }
  return `${appUrl}/api/v1/auth/provider-oauth/callback`;
}

export async function createOAuthFlow(providerId: string): Promise<{ authorizeUrl: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { error: "Provider not found" };
  if (!provider.authorizeUrl || !provider.oauthClientId) {
    return { error: "Provider does not support OAuth sign-in (missing authorizeUrl or oauthClientId)" };
  }

  // Clean up expired flows
  await prisma.oAuthPendingFlow.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - FLOW_TTL_MS) } },
  });

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = crypto.randomUUID();

  await prisma.oAuthPendingFlow.create({
    data: { state, codeVerifier, providerId },
  });

  const redirectUri = getOAuthRedirectUri(provider as { oauthRedirectUri?: string | null; authorizeUrl?: string | null });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: provider.oauthClientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    scope: "openid profile email offline_access",
  });

  // Provider-specific params (e.g. OpenAI's codex_cli_simplified_flow)
  if (provider.authorizeUrl.includes("auth.openai.com")) {
    params.set("codex_cli_simplified_flow", "true");
  }

  // Override scope from credential entry if configured
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (cred?.scope) params.set("scope", cred.scope);

  return { authorizeUrl: `${provider.authorizeUrl}?${params.toString()}` };
}

// ─── Token exchange (callback) ────────────────────────────────────────────────

export async function exchangeOAuthCode(
  state: string,
  code: string,
): Promise<{ providerId: string } | { error: string }> {
  const flow = await prisma.oAuthPendingFlow.findUnique({ where: { state } });
  if (!flow) return { error: "invalid_state" };

  if (Date.now() - flow.createdAt.getTime() > FLOW_TTL_MS) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "flow_expired" };
  }

  const provider = await prisma.modelProvider.findUnique({ where: { providerId: flow.providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "provider_misconfigured" };
  }

  const redirectUri = getOAuthRedirectUri(provider as { oauthRedirectUri?: string | null; authorizeUrl?: string | null });

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: flow.codeVerifier,
    client_id: provider.oauthClientId,
    redirect_uri: redirectUri,
    state,
  });

  let tokenResponse: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[oauth] Token exchange failed: HTTP ${res.status} ${errBody.slice(0, 500)}`);
      console.error(`[oauth] Request: POST ${provider.tokenUrl} | redirect_uri=${redirectUri} | client_id=${provider.oauthClientId?.substring(0, 8)}...`);
      await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
      return { error: "token_exchange_failed" };
    }
    tokenResponse = await res.json() as typeof tokenResponse;
  } catch {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "token_exchange_failed" };
  }

  if (!tokenResponse.access_token) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "no_token" };
  }

  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
  await prisma.credentialEntry.upsert({
    where: { providerId: flow.providerId },
    create: {
      providerId: flow.providerId,
      cachedToken: encryptSecret(tokenResponse.access_token),
      refreshToken: tokenResponse.refresh_token ? encryptSecret(tokenResponse.refresh_token) : null,
      tokenExpiresAt: expiresAt,
      status: "ok",
    },
    update: {
      cachedToken: encryptSecret(tokenResponse.access_token),
      refreshToken: tokenResponse.refresh_token ? encryptSecret(tokenResponse.refresh_token) : null,
      tokenExpiresAt: expiresAt,
      status: "ok",
    },
  });

  // Switch the provider's active auth method — the admin initiated OAuth sign-in,
  // so this is now the active credential method (not api_key).
  await prisma.modelProvider.update({
    where: { providerId: flow.providerId },
    data: { authMethod: "oauth2_authorization_code" },
  });

  await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
  return { providerId: flow.providerId };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshOAuthToken(
  providerId: string,
): Promise<{ token: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    return { error: "Provider missing tokenUrl or oauthClientId" };
  }

  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!cred?.refreshToken) return { error: "Re-authentication required" };

  const decryptedRefresh = decryptSecret(cred.refreshToken);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptedRefresh,
    client_id: provider.oauthClientId,
  });

  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      await prisma.credentialEntry.update({
        where: { providerId },
        data: { status: "expired" },
      });
      return { error: "OAuth token expired — admin must re-authenticate" };
    }

    const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    // Optimistic concurrency: only write if refreshToken hasn't changed
    const currentCred = await prisma.credentialEntry.findUnique({ where: { providerId } });
    if (currentCred?.refreshToken === cred.refreshToken) {
      await prisma.credentialEntry.update({
        where: { providerId },
        data: {
          cachedToken: encryptSecret(body.access_token),
          refreshToken: body.refresh_token ? encryptSecret(body.refresh_token) : cred.refreshToken,
          tokenExpiresAt: expiresAt,
          status: "ok",
        },
      });
    }

    return { token: body.access_token };
  } catch {
    return { error: "Token refresh network error" };
  }
}
