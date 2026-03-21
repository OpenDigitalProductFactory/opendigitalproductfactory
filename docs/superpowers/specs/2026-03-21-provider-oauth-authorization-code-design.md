# EP-OAUTH-001: Generic OAuth Authorization Code Flow for AI Providers

**Date:** 2026-03-21
**Status:** Draft
**Epic:** EP-OAUTH-001
**Scope:** Add OAuth 2.0 authorization code + PKCE as a generic auth method for AI providers, with OpenAI Codex as the first consumer
**Related specs:** EP-CODEX-001 (Codex provider integration), EP-AUTH-001 (Social identity sign-in)
**Dependencies:** Existing provider registry, CredentialEntry schema, ProviderDetailForm dual-auth support

## Problem Statement

The platform's provider credential system supports two authentication methods: API keys (`api_key`) and server-to-server OAuth (`oauth2_client_credentials`). A growing number of AI providers now offer subscription-based access via browser-based OAuth sign-in — notably OpenAI Codex, which lets ChatGPT subscribers use their subscription instead of pay-per-token API keys.

The current `anthropic-sub` provider works around this limitation with a manual `claude setup-token` CLI step that produces an OAuth token disguised as an API key (`sk-ant-oat`). This is fragile and provider-specific.

Multiple open-source AI tools (Roo Code, OpenClaw, term-llm) already implement Codex OAuth sign-in, confirming the flow is production-ready. The platform needs a generic authorization code + PKCE flow that any provider can opt into.

## Goals

- Add `oauth2_authorization_code` as a third generic auth method alongside `api_key` and `oauth2_client_credentials`
- Enable admin-initiated browser-based OAuth sign-in for provider credential setup
- Implement PKCE (Proof Key for Code Exchange) for security
- Support token refresh with encrypted refresh token storage
- Make the flow fully data-driven: providers declare `authorizeUrl`, `tokenUrl`, and `scopes` in the registry
- OpenAI Codex is the first provider to use it; others can adopt it by adding registry fields

## Non-Goals

- Per-user OAuth tokens — the admin signs in once, credential is platform-wide (same model as API keys)
- Migrating `anthropic-sub` to this flow in this spec (deferred; infrastructure will be ready)
- OpenAI application registration — uses the shared Codex CLI client ID (`app_EMoa…`) per community convention
- Device code flow — beta on OpenAI's side, worse UX, not generic enough
- NextAuth integration — provider OAuth is conceptually separate from user authentication

## Design

### 1. Schema Changes

#### `CredentialEntry` — add refresh token

```prisma
model CredentialEntry {
  id             String    @id @default(cuid())
  providerId     String    @unique
  secretRef      String?                         // API key (encrypted)
  clientId       String?                         // OAuth client ID (client_credentials flow)
  clientSecret   String?                         // OAuth client secret (encrypted)
  tokenEndpoint  String?                         // OAuth token URL (client_credentials flow)
  scope          String?                         // OAuth scope
  cachedToken    String?                         // Cached bearer token (encrypted)
  tokenExpiresAt DateTime?                       // Token expiry timestamp
  refreshToken   String?                         // NEW — encrypted refresh token (authorization code flow)
  status         String    @default("unconfigured")
  updatedAt      DateTime  @updatedAt
}
```

The `refreshToken` field is encrypted at rest using the existing `encryptSecret()` / `decryptSecret()` functions. Only used by the authorization code flow — `client_credentials` does not issue refresh tokens.

#### `ModelProvider` — add OAuth endpoint fields

Three new nullable columns on `ModelProvider`:

| Field | Type | Purpose |
|-------|------|---------|
| `authorizeUrl` | `String?` | OAuth authorize endpoint (e.g. `https://auth.openai.com/oauth/authorize`) |
| `tokenUrl` | `String?` | OAuth token endpoint (e.g. `https://auth.openai.com/oauth/token`) |
| `oauthClientId` | `String?` | Default client ID for the authorization code flow (e.g. Codex's shared `app_EMoa…`) |

These are persisted from the registry JSON during `syncProviderRegistry()`, same as `baseUrl`, `docsUrl`, etc.

`oauthClientId` is distinct from `CredentialEntry.clientId` (which is for the `client_credentials` flow). It represents a pre-configured client ID that the provider's OAuth flow expects. For providers that require per-app registration, the admin can override it in the UI.

#### New model: `OAuthPendingFlow`

Stores PKCE challenge state between the redirect and callback. Short-lived (10-minute TTL).

```prisma
model OAuthPendingFlow {
  id            String   @id @default(cuid())
  state         String   @unique
  codeVerifier  String
  providerId    String
  createdAt     DateTime @default(now())
}
```

- `state`: random UUID, sent as query param in the authorize redirect, validated on callback to prevent CSRF
- `codeVerifier`: PKCE verifier (32 random bytes, base64url-encoded), never sent to the provider — only the SHA-256 challenge is sent
- Records older than 10 minutes are deleted on each new flow start (lazy cleanup, no scheduled job)
- The `codeVerifier` is not encrypted — it is ephemeral (10-min TTL), server-side only, and deleted after use

### 2. Registry Changes

#### Type update: `RegistryProviderEntry`

The `authMethod` union type must be extended:

```typescript
authMethod: "api_key" | "oauth2_client_credentials" | "oauth2_authorization_code" | "none";
```

Three new optional fields added:

```typescript
export type RegistryProviderEntry = {
  // ... existing fields ...
  authorizeUrl?: string | null;      // OAuth authorize endpoint
  tokenUrl?: string | null;          // OAuth token endpoint
  oauthClientId?: string | null;     // Default client ID for the OAuth flow (provider-specific)
};
```

The same three fields are added to `ProviderRow` as `string | null`.

#### CODEX registry entry update

```json
{
  "providerId": "codex",
  "name": "OpenAI Codex",
  "category": "agent",
  "baseUrl": "https://api.openai.com/v1",
  "authMethod": "api_key",
  "supportedAuthMethods": ["api_key", "oauth2_authorization_code"],
  "authHeader": "Authorization",
  "authorizeUrl": "https://auth.openai.com/oauth/authorize",
  "tokenUrl": "https://auth.openai.com/oauth/token",
  "oauthClientId": "app_EMoaXYZ...",
  "costModel": "token",
  "families": ["codex-mini"],
  "inputPricePerMToken": 1.50,
  "outputPricePerMToken": 6.00,
  "docsUrl": "https://developers.openai.com/codex/",
  "consoleUrl": "https://platform.openai.com/settings/organization/billing",
  "billingLabel": "Pay-per-use (API key) or Subscription (ChatGPT plan)",
  "costPerformanceNotes": "Agentic coding specialist. ~3x cheaper than GPT-4o for code tasks. Runs in sandboxed environment with tool use and persistent threads.",
  "catalogVisibility": "visible"
}
```

Changes from existing entry:
- `supportedAuthMethods` gains `"oauth2_authorization_code"` — enables dual-auth dropdown
- `authorizeUrl`, `tokenUrl`, `oauthClientId` added — drives the generic flow
- All other fields unchanged

No other provider registry entries change in this spec. Future providers (including a potential `anthropic-sub` migration) can adopt the flow by adding the same three fields.

### 3. OAuth Authorization Code + PKCE Flow

#### Step-by-step

**Step 1 — Admin clicks "Sign in with {provider}"** on the provider detail page. Shown when `selectedAuthMethod === "oauth2_authorization_code"`.

**Step 2 — Client calls server action `startProviderOAuth(providerId)`** which:
1. Calls `requireManageProviders()` (same auth guard as `configureProvider()`)
2. Looks up `authorizeUrl` and `oauthClientId` from the `ModelProvider` record
3. Generates PKCE values:
   - `code_verifier`: 32 random bytes, base64url-encoded
   - `code_challenge`: SHA-256 hash of `code_verifier`, base64url-encoded
4. Generates `state`: random UUID
5. Cleans up expired `OAuthPendingFlow` records (createdAt > 10 minutes ago)
6. Creates new `OAuthPendingFlow` record with `{ state, codeVerifier, providerId }`
7. Returns the full authorize URL:
   ```
   {authorizeUrl}?
     response_type=code&
     client_id={oauthClientId}&
     redirect_uri={APP_URL}/api/v1/auth/provider-oauth/callback&
     code_challenge={code_challenge}&
     code_challenge_method=S256&
     state={state}&
     scope={scope if configured}
   ```

**Step 3 — Browser redirects** to the provider's authorize URL. Admin authenticates with their account (e.g. ChatGPT).

**Step 4 — Provider redirects back** to `{APP_URL}/api/v1/auth/provider-oauth/callback?code={code}&state={state}`

**Step 5 — Callback route handler** (`GET /api/v1/auth/provider-oauth/callback`):
1. Verifies admin session is authenticated (the callback is a browser redirect, so the session cookie is present — reject if not logged in)
2. Reads `code` and `state` from query params
3. Looks up `OAuthPendingFlow` by `state` — rejects if not found (CSRF / replay)
4. Retrieves `codeVerifier` and `providerId` from the pending record
5. Looks up `tokenUrl` and `oauthClientId` from the `ModelProvider` record
6. POSTs to `tokenUrl`:
   ```
   grant_type=authorization_code
   code={code}
   code_verifier={codeVerifier}
   client_id={oauthClientId}
   redirect_uri={APP_URL}/api/v1/auth/provider-oauth/callback
   ```
7. Receives response: `{ access_token, refresh_token, expires_in }`
8. Encrypts and stores in `CredentialEntry`:
   - `cachedToken` ← encrypted `access_token`
   - `refreshToken` ← encrypted `refresh_token`
   - `tokenExpiresAt` ← `now() + expires_in seconds`
   - `status` ← `"ok"`
9. Deletes the `OAuthPendingFlow` record
10. Redirects admin to `/platform/ai/providers/{providerId}?oauth=success`

**Error handling in callback:**
- Missing or invalid `state` → redirect to provider page with `?oauth=error&reason=invalid_state`
- Token exchange HTTP error → redirect with `?oauth=error&reason=token_exchange_failed`
- Missing `access_token` in response → redirect with `?oauth=error&reason=no_token`

#### Security properties

| Threat | Mitigation |
|--------|------------|
| CSRF | `state` parameter (random UUID, validated on callback) |
| Authorization code interception | PKCE with S256 challenge method |
| Token theft at rest | `cachedToken` and `refreshToken` encrypted via `encryptSecret()` |
| Replay attack | `OAuthPendingFlow` record deleted after use, 10-min TTL |
| Cross-provider confusion | `providerId` stored in pending flow, validated against callback context |

### 4. Token Refresh

`getProviderBearerToken()` in `ai-provider-internals.ts` is refactored to:
1. Internally look up the `ModelProvider` record (currently it only reads `CredentialEntry`)
2. Dispatch based on `provider.authMethod` — the existing `client_credentials` logic becomes one branch, and `authorization_code` becomes a second branch

`getDecryptedCredential()` must also be extended to decrypt `cachedToken` and `refreshToken` in addition to `secretRef` and `clientSecret`. Currently it only decrypts two fields — the authorization code flow stores encrypted tokens in both `cachedToken` and `refreshToken`.

**Note on `cachedToken` encryption consistency:** The existing `client_credentials` flow stores `cachedToken` in plaintext (no `encryptSecret()` call at line 116). The authorization code flow will encrypt it. During implementation, the `client_credentials` path should also be updated to encrypt `cachedToken` for consistency. The `getDecryptedCredential()` function should handle both encrypted and plaintext values gracefully during the transition (attempt decrypt, fall back to raw value).

```
function getProviderBearerToken(providerId):
  credential = getDecryptedCredential(providerId)  // now decrypts cachedToken + refreshToken too
  provider = getProvider(providerId)                // NEW: fetch ModelProvider record

  if provider.authMethod === "oauth2_client_credentials":
    // ... existing client_credentials flow unchanged ...

  if provider.authMethod === "oauth2_authorization_code":
    // 1. Return cached token if still valid (5-min buffer)
    if credential.cachedToken && credential.tokenExpiresAt > now() + 5min:
      return { token: credential.cachedToken }

    // 2. Attempt refresh if refresh token exists
    if credential.refreshToken && provider.tokenUrl:
      POST provider.tokenUrl with:
        grant_type=refresh_token
        refresh_token=credential.refreshToken
        client_id=provider.oauthClientId

      if success:
        update CredentialEntry with new cachedToken, refreshToken (if rotated), tokenExpiresAt
        return { token: newAccessToken }

      if failure (401/403):
        update CredentialEntry status to "expired"
        return { error: "OAuth token expired — admin must re-authenticate" }

    // 3. No refresh token or no token URL
    return { error: "Re-authentication required" }
```

**No background refresh job.** Tokens are refreshed on-demand when inference requests need them. This matches the existing `client_credentials` pattern and avoids unnecessary refresh cycles when the provider isn't actively used.

**Concurrent requests:** If multiple requests find an expired token simultaneously, each attempts a refresh. For access tokens, last writer wins — all tokens are equally valid. For refresh tokens, providers may use one-time-use rotation (per RFC 6749 Section 6), where a second concurrent refresh with the old token would fail.

**Mitigation:** The implementation should use optimistic concurrency on the `refreshToken` field — before writing the new refresh token, check that the stored value still matches the one used for the request. If it has changed (another request already refreshed), skip the write and re-read the fresh `cachedToken` instead. This is acceptable complexity given that concurrent refresh is rare (admin-level provider usage, not per-user).

### 5. Provider Status Transitions

| Event | Credential Status | Provider Status |
|-------|------------------|-----------------|
| OAuth sign-in succeeds | `"ok"` | `"ok"` |
| Token refresh succeeds | `"ok"` (unchanged) | unchanged |
| Token refresh fails (401/403) | `"expired"` | unchanged (stays `"ok"` — admin can switch to API key) |
| Admin disconnects | `"unconfigured"` | unchanged |
| Admin switches auth method | Previous credential fields cleared | unchanged |

When `getProviderBearerToken` returns an error for an `oauth2_authorization_code` provider, the routing layer treats it as an auth failure — the existing `InferenceError` with `code: "auth"` handles this. The router skips this provider and falls back to alternatives if available.

### 6. UI Changes

#### `CredentialRow` client-safe type extension

The existing `CredentialRow` type (client-safe, no secrets) must be extended with:
- `tokenExpiresAt: string | null` — ISO timestamp for displaying "token expires in X" in the UI
- `hasRefreshToken: boolean` — indicates whether auto-refresh is available (never exposes the actual token)

These fields enable the connection status display without sending any sensitive data to the client.

#### `ProviderDetailForm` — OAuth sign-in mode

When `selectedAuthMethod === "oauth2_authorization_code"`:

- **Hide:** API key field, clientId/secret/tokenEndpoint/scope fields (those are for `client_credentials`)
- **Show:** "Sign in with {provider.name}" button that calls `startProviderOAuth(providerId)` and opens the returned URL
- **Connection status** below the button:
  - Not connected: muted text "No account linked"
  - Connected: green dot + "Connected · token expires {relative time}"
  - Expired / failed refresh: amber warning "Token expired — sign in again"
- **Disconnect link** (when connected): clears `cachedToken`, `refreshToken`, sets status to `"unconfigured"`

#### Dual-auth dropdown

The dropdown already renders when `supportedAuthMethods.length > 1`. The label mapping must be extended — the existing code maps `api_key` → "API Key", `oauth2_client_credentials` → "OAuth2 Client Credentials", and falls through to "None" for unknown values. Add: `oauth2_authorization_code` → "OAuth (Sign in)". Admin selects between "API Key" and "OAuth (Sign in)". The form switches between the API key input and the sign-in button.

#### Callback landing

After the OAuth callback redirects back to `/platform/ai/providers/{providerId}?oauth=success`:
- Read `oauth` query param on page load
- Show transient toast/banner: "Successfully connected" (success) or "Connection failed: {reason}" (error)
- Same ephemeral feedback pattern as the existing `saveMessage` state

#### No changes to provider grid page

The provider cards, "Agent Providers" section, billing labels — all unchanged.

### 7. `syncProviderRegistry()` Changes

The existing sync function in `actions/ai-providers.ts` persists registry fields to `ModelProvider` rows. Extended to include:

- `authorizeUrl` → `ModelProvider.authorizeUrl`
- `tokenUrl` → `ModelProvider.tokenUrl`
- `oauthClientId` → `ModelProvider.oauthClientId`

Same upsert policy as existing fields: on re-sync, these values are overwritten from the registry. Admin overrides (if supported later) would need a separate mechanism.

### 8. `configureProvider()` Validation Update

The existing `configureProvider()` action validates OAuth fields: "if any OAuth field is provided, require clientId, clientSecret, and tokenEndpoint." This validation is specific to `client_credentials` and must be scoped accordingly — it should only trigger when `authMethod === "oauth2_client_credentials"`. The `oauth2_authorization_code` flow stores credentials via the callback route, not via `configureProvider()`. The save action for `oauth2_authorization_code` only needs to persist `authMethod` and `enabledFamilies`.

When `authMethod` changes via `configureProvider()`, fields belonging to the previous auth method should be nulled out. For example, switching from `oauth2_authorization_code` to `api_key` should clear `cachedToken`, `refreshToken`, and `tokenExpiresAt`. Switching from `api_key` to `oauth2_authorization_code` should clear `secretRef`.

### 9. `buildAuthHeaders()` in `ai-inference.ts`

The inference layer's `buildAuthHeaders()` function currently has branches for `api_key` and `oauth2_client_credentials`. A new branch is needed for `oauth2_authorization_code` — it calls `getProviderBearerToken()` (which handles the refresh internally) and sets `Authorization: Bearer {token}`. The logic is identical to the `client_credentials` branch — the difference is in how the token was obtained, which is handled by `getProviderBearerToken()`.

**Note:** The codebase currently has duplicate definitions of `getProviderBearerToken()` and `getDecryptedCredential()` in both `ai-provider-internals.ts` (canonical) and `ai-inference.ts`. The implementation should consolidate — `ai-inference.ts` should import from `ai-provider-internals.ts` rather than maintaining its own copy. This prevents the refactored function from being inconsistent across files.

## What Is NOT In Scope

- **Per-user OAuth tokens** — the credential is platform-wide, owned by the admin who signed in. Multi-tenant per-user token support would require a different architecture (token per user session, not per provider).
- **Migrating `anthropic-sub`** — the infrastructure will support it, but the Anthropic OAuth endpoints and client ID need separate research. Deferred to a follow-up.
- **OpenAI app registration** — the shared Codex CLI client ID is used per community convention. If OpenAI later requires per-app registration, the `oauthClientId` field in the registry (or admin-configurable override) handles it without code changes.
- **Device code flow** — beta on OpenAI's side, worse UX, not generic. Can be added as a fourth auth method later if needed.
- **Automatic provider switching** — if OAuth token expires and API key is also configured, the system does not auto-switch. Admin must choose their active auth method.
- **Consent/scope management UI** — scopes are defined in the registry. No admin-facing scope picker.

## Files to Create or Modify

### Create
- Prisma migration: `refreshToken` on `CredentialEntry`, `authorizeUrl`/`tokenUrl`/`oauthClientId` on `ModelProvider`, `OAuthPendingFlow` model
- `apps/web/lib/provider-oauth.ts` — PKCE generation, `startProviderOAuth()` logic, token exchange, refresh
- `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts` — callback route handler (with session auth guard)
- `apps/web/lib/actions/provider-oauth.ts` — server action wrapper for `startProviderOAuth()` (with `requireManageProviders()` guard)

### Modify
- `packages/db/prisma/schema.prisma` — new fields (`refreshToken`, `authorizeUrl`, `tokenUrl`, `oauthClientId`) + new `OAuthPendingFlow` model
- `packages/db/data/providers-registry.json` — CODEX entry updated with OAuth fields
- `apps/web/lib/ai-provider-types.ts` — extend `authMethod` union with `"oauth2_authorization_code"`, extend `RegistryProviderEntry` and `ProviderRow` with `authorizeUrl`, `tokenUrl`, `oauthClientId`; extend `CredentialRow` with `tokenExpiresAt` and `hasRefreshToken`
- `apps/web/lib/ai-provider-internals.ts` — refactor `getProviderBearerToken()` to look up provider record and dispatch by `authMethod`; extend `getDecryptedCredential()` to decrypt `cachedToken` and `refreshToken`; encrypt `cachedToken` consistently for both flows
- `apps/web/lib/ai-inference.ts` — add `oauth2_authorization_code` branch to `buildAuthHeaders()`
- `apps/web/lib/actions/ai-providers.ts` — `syncProviderRegistry()` persists new fields; scope OAuth validation in `configureProvider()` to `client_credentials` only
- `apps/web/components/platform/ProviderDetailForm.tsx` — OAuth sign-in button, connection status, disconnect, dropdown label for `oauth2_authorization_code`

### Test
- `apps/web/lib/ai-providers.test.ts` — PKCE generation, token refresh logic (success, failure, rotation), state validation, optimistic concurrency on refresh token
