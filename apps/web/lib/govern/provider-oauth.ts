// apps/web/lib/provider-oauth.ts
// OAuth 2.0 authorization code + PKCE helpers for provider credential flows.
// Server-only — no "use server" directive (called by server actions and route handlers).

import { randomBytes, createHash } from "crypto";
import { prisma } from "@dpf/db";
import { encryptSecret, decryptSecret } from "@/lib/credential-crypto";
import { activeAccountCredentialWhere, assertActiveAccountSnapshot, matchesCredentialRevision, ACCOUNT_CHANGED, type ActiveAccountSnapshot } from "@/lib/inference/active-provider-account-verification";
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

class DefaultAccountOwnerConflict extends Error {}

/** Translate only a conditional owner write's expected conflicts; other DB failures stay failures. */
function rethrowDefaultAccountOwnerConflict(error: unknown): never {
  const failure = error as { code?: unknown; meta?: { target?: unknown } } | null;
  const target = failure?.meta?.target;
  const aliasConflict = failure?.code === "P2002" &&
    (Array.isArray(target) ? target.length === 1 && target[0] === "providerId" : target === "CredentialEntry_providerId_key");
  if (failure?.code === "P2025" || aliasConflict) throw new DefaultAccountOwnerConflict();
  throw error;
}

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
  } else {
    const siblingId = OPENAI_PAIR[flow.providerId];
    const sibling = siblingId && await prisma.modelProvider.findUnique({ where: { providerId: siblingId } });
    const providerIds = sibling ? [flow.providerId, siblingId] : [flow.providerId];
    const written = await prisma.$transaction(async (tx) => {
      // Validate every owner before replacing either shared default token.
      const owners = await Promise.all(providerIds.map(async (providerId) => {
        const connectionId = `provider-default-${providerId}`;
        const [connection, credential] = await Promise.all([
          tx.aiProviderConnection.findUnique({ where: { connectionId } }),
          tx.credentialEntry.findUnique({ where: { providerId }, select: { id: true, providerConnection: { select: { connectionId: true } } } }),
        ]);
        return { providerId, connectionId, connection, credential };
      }));
      if (owners.some(({ providerId, connectionId, connection, credential }) =>
        (connection && connection.providerId !== providerId) ||
        (credential?.providerConnection && credential.providerConnection.connectionId !== connectionId) ||
        (connection?.credentialEntryId && connection.credentialEntryId !== credential?.id))) return false;
      for (const { providerId, connectionId, connection, credential } of owners) {
        if (connection) {
          await invalidateProviderAccountProofs(tx, connection.id);
          await tx.aiProviderConnection.update({
            where: { connectionId, providerId, AND: { credentialEntryId: connection.credentialEntryId } },
            data: ACCOUNT_ACCESS_RESET,
          }).catch(rethrowDefaultAccountOwnerConflict);
        }
        await tx.credentialEntry.upsert({
          where: {
            providerId, ...(credential ? { id: credential.id } : {}),
            AND: { providerConnection: { is: credential?.providerConnection ? { connectionId } : null } },
          },
          create: { providerId, ...credentialUpdate, refreshToken: newRefreshToken },
          update: credentialUpdate,
        }).catch(rethrowDefaultAccountOwnerConflict);
      }
      return true;
    }).catch((error: unknown) => {
      if (error instanceof DefaultAccountOwnerConflict) return false;
      throw error;
    });
    if (!written) return { error: "account_changed" };
  }

  // Activate the provider: set status/clearance/authMethod, run model discovery,
  // activate linked MCP services, and sync the codex↔chatgpt sibling.
  // Replaces ad-hoc mutations — see PROVIDER-ACTIVATION-AUDIT.md §5 (F-01, F-03).
  if (!flow.connectionId) await activateProvider(flow.providerId, {
    trigger: "oauth_exchange",
    authMethod: "oauth2_authorization_code",
    activateLinked: true,
  });

  return { providerId: flow.providerId, ...(flow.connectionId ? { connectionId: flow.connectionId } : {}) };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

/** Internal selected-account renewal; token claims validate identity, never grants. */
export interface ScopedOAuthRefreshGuard {
  signal: AbortSignal;
  connection: { id: string; connectionId: string; providerId: string; authMethod: string; status: string; credentialEntryId: string | null; updatedAt: Date; organizationId?: string | null };
  credential: { id: string; updatedAt: Date; cachedToken: string | null; refreshToken: string | null };
  validateAccessToken: (token: string) => void;
}

class ScopedOAuthAccountChanged extends Error {}

async function isOAuthGrantRefusal(response: Response): Promise<boolean> {
  if (response.status === 401 || response.status === 403) return true;
  if (response.status !== 400) return false;
  const body = await response.json().catch(() => null) as { error?: string | { code?: string } } | null;
  return body?.error === "invalid_grant"
    || (typeof body?.error === "object" && body.error?.code === "invalid_grant");
}

export function matchesScopedOAuthConnection(current: ScopedOAuthRefreshGuard["connection"] | null, expected: ScopedOAuthRefreshGuard["connection"]) {
  return Boolean(current && current.id === expected.id && current.connectionId === expected.connectionId
    && current.providerId === expected.providerId && current.status === expected.status && current.status !== "disabled"
    && current.organizationId === expected.organizationId
    && current.credentialEntryId === expected.credentialEntryId && current.authMethod === expected.authMethod
    && current.updatedAt.getTime() === expected.updatedAt.getTime());
}

type OAuthCredential = NonNullable<Awaited<ReturnType<typeof findProviderCredential>>>;
type OAuthParticipant = { connection: ScopedOAuthRefreshGuard["connection"]; credential: OAuthCredential };

function matchesScopedOAuthCredential(current: ScopedOAuthRefreshGuard["credential"] | null, expected: ScopedOAuthRefreshGuard["credential"]) {
  return matchesCredentialRevision({ credentialEntryId: expected.id, credentialRevision: expected }, current);
}

function readOAuthTokenClaims(token: string | null): Record<string, unknown> | null {
  if (!token || token.split(".").length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch { return null; }
}

/** Claims identify an existing credential or reject its cached lifetime; they never grant authority. */
export function chatgptTokenIdentity(token: string | null): string | null {
  const auth = readOAuthTokenClaims(token)?.["https://api.openai.com/auth"] as { chatgpt_account_id?: unknown } | undefined;
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId : null;
}

export function oauthTokenExpiryMs(token: string): number | null {
  const exp = readOAuthTokenClaims(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp * 1000) ? exp * 1000 : null;
}

/** Private proof, never a provider-name assertion or a credential projection. */
async function readDefaultOAuthLineage(providerId: string, connectionId: string) {
  if (!["codex", "chatgpt"].includes(providerId) || connectionId !== `provider-default-${providerId}`) return null;
  const providers = ["codex", "chatgpt"];
  const rows = await Promise.all(providers.map((id) => prisma.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${id}` }, include: { credentialEntry: true } })));
  const participants: OAuthParticipant[] = [];
  for (let index = 0; index < providers.length; index++) {
    const row = rows[index], id = providers[index]!;
    if (!row || row.providerId !== id || row.connectionId !== `provider-default-${id}`
      || row.organizationId !== null || row.status === "disabled" || !["oauth", "oauth2_authorization_code"].includes(row.authMethod) || !row.credentialEntry
      || row.credentialEntry.id !== row.credentialEntryId || row.credentialEntry.providerId !== id) return null;
    participants.push({ connection: { ...row, updatedAt: new Date(row.updatedAt) }, credential: { ...row.credentialEntry, updatedAt: new Date(row.credentialEntry.updatedAt) } });
  }
  const accountIds = participants.map((entry) => chatgptTokenIdentity(entry.credential.cachedToken && decryptSecret(entry.credential.cachedToken)));
  const refreshTokens = participants.map((entry) => entry.credential.refreshToken && decryptSecret(entry.credential.refreshToken));
  if (!accountIds[0] || accountIds[0] !== accountIds[1] || !refreshTokens[0] || refreshTokens[0] !== refreshTokens[1]) return null;
  return { participants, accountId: accountIds[0] };
}

/** Server read model: an unproven default needs independent recovery. No secrets leave. */
export async function hasProvenDefaultOAuthLineage(providerId: string, connectionId: string): Promise<boolean> {
  return Boolean(await readDefaultOAuthLineage(providerId, connectionId));
}

export async function refreshOAuthToken(
  providerId: string,
  connectionId?: string,
  activeSnapshot?: ActiveAccountSnapshot,
  guard?: ScopedOAuthRefreshGuard,
): Promise<{ token: string } | { error: string }> {
  const activeCaller = activeSnapshot;
  activeSnapshot = activeSnapshot ? { ...activeSnapshot, updatedAt: new Date(activeSnapshot.updatedAt),
    credentialRevision: { ...activeSnapshot.credentialRevision, updatedAt: new Date(activeSnapshot.credentialRevision.updatedAt) } } : undefined;
  guard = guard ? { ...guard, connection: { ...guard.connection, updatedAt: new Date(guard.connection.updatedAt) },
    credential: { ...guard.credential, updatedAt: new Date(guard.credential.updatedAt) } } : undefined;
  if (activeSnapshot) {
    try { await assertActiveAccountSnapshot(activeSnapshot); }
    catch { return { error: ACCOUNT_CHANGED }; }
  }
  if (guard) {
    if (guard.signal.aborted || !connectionId || connectionId !== guard.connection.connectionId
      || providerId !== guard.connection.providerId || !["oauth", "oauth2_authorization_code"].includes(guard.connection.authMethod)
      || guard.connection.credentialEntryId !== guard.credential.id) return { error: "Selected account renewal is unavailable" };
    const current = await prisma.aiProviderConnection.findUnique({ where: { connectionId } });
    if (guard.signal.aborted || !matchesScopedOAuthConnection(current, guard.connection)) return { error: "Selected account changed during renewal" };
  }
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: connectionId && providerId === "chatgpt" ? "codex" : providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    return { error: "Provider missing tokenUrl or oauthClientId" };
  }

  const cred = await findProviderCredential(providerId, connectionId);
  if (activeSnapshot && (connectionId !== activeSnapshot.connectionId || providerId !== activeSnapshot.providerId
    || !matchesCredentialRevision(activeSnapshot, cred))) return { error: ACCOUNT_CHANGED };
  if (activeSnapshot && !guard && cred) {
    const selected = await prisma.aiProviderConnection.findUnique({ where: { connectionId: activeSnapshot.connectionId } });
    if (!selected || selected.credentialEntryId !== cred.id || selected.providerId !== providerId
      || selected.updatedAt.getTime() !== activeSnapshot.updatedAt.getTime() || selected.status !== "active"
      || selected.organizationId !== null || !["oauth", "oauth2_authorization_code"].includes(selected.authMethod)) return { error: ACCOUNT_CHANGED };
    const selectedIdentity = chatgptTokenIdentity(cred.cachedToken && decryptSecret(cred.cachedToken));
    guard = { signal: new AbortController().signal,
      connection: { ...selected, updatedAt: new Date(selected.updatedAt) },
      credential: { id: cred.id, updatedAt: new Date(cred.updatedAt), cachedToken: cred.cachedToken, refreshToken: cred.refreshToken },
      validateAccessToken: (token) => { if (!selectedIdentity || chatgptTokenIdentity(token) !== selectedIdentity) throw new Error("Selected default identity changed"); } };
  }
  if (guard && (guard.signal.aborted || !matchesScopedOAuthCredential(cred, guard.credential))) return { error: "Selected account credential changed" };
  const defaultConnection = connectionId && ["codex", "chatgpt"].includes(providerId) && connectionId === `provider-default-${providerId}`;
  const lineage = defaultConnection ? await readDefaultOAuthLineage(providerId, connectionId!) : null;
  if (lineage) {
    const selected = lineage.participants.find((entry) => entry.connection.connectionId === connectionId)!;
    if (!cred || !matchesScopedOAuthCredential(selected.credential, cred) || (guard && !matchesScopedOAuthConnection(selected.connection, guard.connection))) {
      return { error: "Selected default changed during renewal" };
    }
  }
  if (defaultConnection && !guard && cred) {
    const selected = await prisma.aiProviderConnection.findUnique({ where: { connectionId: connectionId! } });
    const identity = chatgptTokenIdentity(cred.cachedToken && decryptSecret(cred.cachedToken));
    if (!selected || selected.credentialEntryId !== cred.id || selected.providerId !== providerId || selected.authMethod !== "oauth" || selected.status === "disabled" || !identity) {
      return { error: "Default sign-in identity is unproven — recover this account independently" };
    }
    guard = { signal: new AbortController().signal, connection: { ...selected, updatedAt: new Date(selected.updatedAt) }, credential: { id: cred.id, updatedAt: new Date(cred.updatedAt), cachedToken: cred.cachedToken, refreshToken: cred.refreshToken },
      validateAccessToken: (token) => { if (chatgptTokenIdentity(token) !== identity) throw new Error("Default identity changed"); } };
  }
  const credentialWhere = connectionId && cred ? { id: cred.id } : { providerId };
  const renewalFailure = (error: unknown) => ({ error: error instanceof ScopedOAuthAccountChanged
    ? activeSnapshot ? ACCOUNT_CHANGED : "Selected account changed during renewal"
    : "Token refresh network error" });
  const expireCapturedActive = async () => {
    if (!activeSnapshot || !guard) return;
    const captured = activeSnapshot, expected = guard;
    await prisma.$transaction(async tx => {
      expected.signal.throwIfAborted();
      const owners = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AiProviderConnection" WHERE "connectionId" = ${expected.connection.connectionId} FOR UPDATE`;
      const current = await tx.aiProviderConnection.findUnique({ where: { connectionId: expected.connection.connectionId } });
      if (owners.length !== 1 || owners[0]!.id !== expected.connection.id || !matchesScopedOAuthConnection(current, expected.connection)) {
        throw new ScopedOAuthAccountChanged();
      }
      const expired = await tx.credentialEntry.updateMany({ where: activeAccountCredentialWhere(captured), data: { status: "expired" } });
      expected.signal.throwIfAborted();
      if (expired.count !== 1) throw new ScopedOAuthAccountChanged();
    });
  };
  if (!cred?.refreshToken) {
    // Nothing can renew this token. Once it is past expiry, say so on the row
    // (and its codex/chatgpt sibling, which holds the same token) instead of
    // leaving status "ok" on a dead credential.
    if (activeSnapshot && cred?.tokenExpiresAt && cred.tokenExpiresAt.getTime() <= Date.now()) {
      try { await expireCapturedActive(); } catch (error) { return renewalFailure(error); }
    } else if (!guard && cred?.tokenExpiresAt && cred.tokenExpiresAt.getTime() <= Date.now()) {
      const sibling = OPENAI_PAIR[providerId];
      await prisma.credentialEntry.updateMany({
        where: connectionId ? { id: cred.id } : { providerId: { in: sibling ? [providerId, sibling] : [providerId] } },
        data: { status: "expired" },
      });
    }
    return { error: "Re-authentication required" };
  }

  if (defaultConnection && !chatgptTokenIdentity(cred.cachedToken && decryptSecret(cred.cachedToken))) {
    return { error: "Default sign-in identity is unproven — recover this account independently" };
  }

  // Both proven defaults represent the existing Codex grant. Additional accounts
  // never enter this normalization and retain their exact selected credential.
  const refreshOwner = lineage?.participants.find((entry) => entry.connection.providerId === "codex")?.credential ?? cred;
  const decryptedRefresh = decryptSecret(refreshOwner.refreshToken!);
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
    guard?.signal.throwIfAborted();
    if (activeSnapshot) await assertActiveAccountSnapshot(activeSnapshot);
    if (guard) {
      const current = await prisma.aiProviderConnection.findUnique({ where: { connectionId: guard.connection.connectionId }, include: { credentialEntry: true } });
      const credential = current?.credentialEntry;
      if (!matchesScopedOAuthConnection(current, guard.connection) || !matchesScopedOAuthCredential(credential ?? null, guard.credential)) {
        return { error: activeSnapshot ? ACCOUNT_CHANGED : "Selected account changed during renewal" };
      }
    }
    if (lineage) {
      for (const participant of lineage.participants) {
        guard?.signal.throwIfAborted();
        const current = await prisma.aiProviderConnection.findUnique({ where: { connectionId: participant.connection.connectionId }, include: { credentialEntry: true } });
        if (!matchesScopedOAuthConnection(current, participant.connection)
          || !matchesScopedOAuthCredential(current?.credentialEntry ?? null, participant.credential)) throw new ScopedOAuthAccountChanged();
      }
    }
    guard?.signal.throwIfAborted();
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: refreshBody,
      signal: guard ? AbortSignal.any([guard.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (guard && !await isOAuthGrantRefusal(res)) {
        return { error: res.status === 429 || res.status >= 500
          ? `OAuth token renewal unavailable (HTTP ${res.status})`
          : `OAuth token renewal failed (HTTP ${res.status})` };
      }
      if (activeSnapshot) { await expireCapturedActive(); return { error: "Selected account re-authentication required" }; }
      if (guard) return { error: "Selected account re-authentication required" };
      await prisma.credentialEntry.update({
        where: credentialWhere,
        data: { status: "expired" },
      });
      return { error: "OAuth token expired — admin must re-authenticate" };
    }

    const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    if (guard) {
      guard.signal.throwIfAborted();
      if (typeof body.access_token !== "string" || !body.access_token.trim()
        || !Number.isFinite(body.expires_in) || body.expires_in <= 0
        || (body.refresh_token !== undefined && (typeof body.refresh_token !== "string" || !body.refresh_token.trim()))) {
        return { error: "Malformed selected account renewal" };
      }
      guard.validateAccessToken(body.access_token);
      if (lineage && chatgptTokenIdentity(body.access_token) !== lineage.accountId) return { error: "Shared default identity changed" };
    }
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    if (guard) {
      if (!Number.isFinite(expiresAt.getTime())) return { error: "Malformed selected account renewal" };
      const selectedRevision = await prisma.$transaction(async (tx) => {
        guard.signal.throwIfAborted();
        // Lock the owner row while checking and saving; a relation predicate
        // alone can observe ownership from an earlier statement snapshot.
        const participants: OAuthParticipant[] = lineage?.participants ?? [{ connection: guard.connection, credential: { ...cred!, updatedAt: guard.credential.updatedAt } }];
        participants.sort((a, b) => a.connection.connectionId.localeCompare(b.connection.connectionId));
        for (const participant of participants) {
          const ownerId = participant.connection.connectionId;
          const owners = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AiProviderConnection" WHERE "connectionId" = ${ownerId} FOR UPDATE`;
          guard.signal.throwIfAborted();
          const owner = await tx.aiProviderConnection.findUnique({ where: { connectionId: ownerId } });
          if (owners.length !== 1 || owners[0]!.id !== participant.connection.id || !matchesScopedOAuthConnection(owner, participant.connection)) throw new ScopedOAuthAccountChanged();
        }
        let selectedRevision: ActiveAccountSnapshot["credentialRevision"] | undefined;
        for (const { credential } of participants) {
          guard.signal.throwIfAborted();
          const revision = { updatedAt: new Date(), cachedToken: encryptSecret(body.access_token),
            refreshToken: body.refresh_token ? encryptSecret(body.refresh_token) : credential.refreshToken };
          const capturedWhere = { id: credential.id, updatedAt: credential.updatedAt,
            cachedToken: credential.cachedToken, refreshToken: credential.refreshToken };
          const selected = credential.id === guard.credential.id;
          const written = await tx.credentialEntry.updateMany({
            where: selected && activeSnapshot ? { AND: [capturedWhere, activeAccountCredentialWhere(activeSnapshot)] } : capturedWhere,
            data: { ...revision, tokenExpiresAt: expiresAt, status: "ok" },
          });
          if (selected) selectedRevision = revision;
          guard.signal.throwIfAborted();
          if (written.count !== 1) throw new ScopedOAuthAccountChanged();
        }
        if (!selectedRevision) throw new ScopedOAuthAccountChanged();
        return selectedRevision;
      });
      if (activeCaller) activeCaller.credentialRevision = selectedRevision;
      guard.signal.throwIfAborted();
      return { token: body.access_token };
    }

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
  } catch (error) {
    return renewalFailure(error);
  }
}
