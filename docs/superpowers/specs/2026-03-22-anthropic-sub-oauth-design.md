# EP-OAUTH-002: Wire `anthropic-sub` to OAuth Authorization Code Flow

**Date:** 2026-03-22
**Status:** Draft
**Epic:** EP-OAUTH-002
**Scope:** Connect the `anthropic-sub` provider to the existing generic OAuth 2.0 authorization code + PKCE flow, and unify the localhost callback handling for all OAuth providers
**Related specs:** EP-OAUTH-001 (Generic OAuth Authorization Code Flow), EP-CODEX-001 (Codex provider integration)
**Dependencies:** Existing `provider-oauth.ts` flow, `OAuthPendingFlow` model, `ProviderDetailForm` OAuth UI

## Problem Statement

The platform has a fully implemented OAuth 2.0 authorization code + PKCE flow (`provider-oauth.ts`) that was built for OpenAI Codex as the first consumer (EP-OAUTH-001). The `anthropic-sub` provider — which provides Claude models via a Max subscription — was explicitly deferred in that spec pending research on Anthropic's OAuth endpoints.

Currently, `anthropic-sub` uses a manual workaround: the admin runs `claude setup-token` in a terminal, copies the resulting `sk-ant-oat...` token, and pastes it as an API key. The code detects the `sk-ant-oat` prefix at inference time and switches from `x-api-key` to `Bearer` auth with the required `anthropic-beta: oauth-2025-04-20` header. A secondary fallback reads the live token directly from Claude Code's credentials file on disk (`~/.claude/.credentials.json`).

This approach is fragile: tokens expire, the file-read fallback only works in dev mode (not Docker), and the UX is indistinguishable from entering a standard API key.

Separately, the Codex OAuth integration required a per-provider redirect URI hack (`oauthRedirectUri` field) to accommodate providers whose OAuth clients restrict redirects to short `localhost/callback` paths. This per-provider override is fragile and doesn't scale.

## Goals

- Wire `anthropic-sub` to the existing OAuth authorization code + PKCE flow — admin clicks "Sign in", authenticates via Anthropic's OAuth server, token + refresh token stored in DB
- Unify localhost OAuth callback handling — one short `/callback` route replaces per-provider redirect URI hacks
- Remove dead workaround code: `sk-ant-oat` detection in the `api_key` inference path, `getClaudeCodeOAuthToken()` file-read fallback
- Ensure inference adds the required `anthropic-beta` header for OAuth tokens on Anthropic providers

## Non-Goals

- Removing the `api_key` option from `anthropic-sub` — it remains as a fallback for users who prefer manual token entry
- Changing the `anthropic` (API Key) provider — that provider continues to use standard `x-api-key` auth
- Per-user OAuth tokens — the credential remains platform-wide (admin signs in once)
- Dynamic client registration with Anthropic — we use the shared Claude Code client ID

## Design

### 1. Anthropic OAuth Endpoints

Confirmed from Claude Code's source and the public client metadata endpoint:

| Field | Value |
|---|---|
| Authorize URL | `https://claude.ai/oauth/authorize` |
| Token URL | `https://platform.claude.com/v1/oauth/token` |
| Client ID | `https://claude.ai/oauth/claude-code-client-metadata` (URL-based, RFC 7591) |
| Allowed redirect URIs | `http://localhost/callback`, `http://127.0.0.1/callback` |
| Grant types | `authorization_code`, `refresh_token` |
| Token endpoint auth | `none` (public client — PKCE only, no client secret) |
| Required scopes | `user:inference user:profile` (minimum for API access) |

The client metadata is publicly available at `https://claude.ai/oauth/claude-code-client-metadata` and confirms `"token_endpoint_auth_method": "none"` — compatible with our existing PKCE-only flow.

### 2. Unified OAuth Callback Route

**Problem:** OAuth providers like Anthropic and OpenAI restrict redirect URIs to short `localhost/callback` paths. Our existing callback route at `/api/v1/auth/provider-oauth/callback` doesn't match. The Codex spec worked around this with a per-provider `oauthRedirectUri` override — this doesn't scale.

**Solution:** Add a single new route at `app/callback/route.ts` that maps to `http://localhost:3000/callback`.

Per RFC 8252 Section 7.3, OAuth authorization servers must accept any port for loopback redirect URIs. Both Anthropic (`http://localhost/callback`) and OpenAI (`http://localhost/callback`) will accept `http://localhost:3000/callback`.

**Updated `getOAuthRedirectUri()` logic:**

```
1. If provider has explicit oauthRedirectUri set → use it (escape hatch)
2. If provider's authorizeUrl indicates a localhost-restricted OAuth server → use http://localhost:3000/callback
3. Otherwise → use the existing /api/v1/auth/provider-oauth/callback route
```

The step 2 detection is simple: if `authorizeUrl` contains `claude.ai`, `auth.openai.com`, or other known localhost-restricted providers, use the short callback. This is a conservative allowlist, not a blocklist.

The new `/callback` route handler is identical to the existing callback route: verify admin session, extract `code` and `state` params, call `exchangeOAuthCode()`, redirect to provider detail page.

The existing `/api/v1/auth/provider-oauth/callback` route remains for providers that accept arbitrary redirect URIs.

### 3. Registry Changes

Update `anthropic-sub` in `providers-registry.json`:

```json
{
  "providerId": "anthropic-sub",
  "authorizeUrl": "https://claude.ai/oauth/authorize",
  "tokenUrl": "https://platform.claude.com/v1/oauth/token",
  "oauthClientId": "https://claude.ai/oauth/claude-code-client-metadata",
  "oauthRedirectUri": null,
  "supportedAuthMethods": ["api_key", "oauth2_authorization_code"],
  "authMethod": "api_key"
}
```

Notes:
- `authMethod` remains `api_key` as the default — the OAuth callback auto-switches it to `oauth2_authorization_code` on successful token exchange (existing behavior from EP-OAUTH-001)
- `oauthRedirectUri` is null — the unified callback logic handles it via the `authorizeUrl` allowlist
- `supportedAuthMethods` now includes both options — the UI renders an auth method selector

Also update the Codex registry entry: set `oauthRedirectUri` to `null` (remove any hardcoded override) — the unified callback handles it.

### 4. Scope Handling

The `createOAuthFlow()` function defaults to `openid profile email offline_access` scopes. Anthropic uses different scopes: `user:inference user:profile`.

The existing flow already supports per-provider scope override: it reads `scope` from the `CredentialEntry` if set. The seed creates a `CredentialEntry` for `anthropic-sub` with `scope: "user:inference user:profile"`.

No schema changes needed.

### 5. Inference Changes

#### Add `anthropic-beta` header for OAuth Anthropic providers

In `buildAuthHeaders()` in `ai-inference.ts`, the `oauth2_authorization_code` path currently sets `Authorization: Bearer` but doesn't add the `anthropic-beta: oauth-2025-04-20` header. Anthropic requires this header for all OAuth token inference calls.

```typescript
} else if (authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
}
```

#### Remove dead `sk-ant-oat` workaround from `api_key` path

The `api_key` path currently detects `sk-ant-oat` tokens and switches to Bearer auth + beta headers. Once `anthropic-sub` uses `oauth2_authorization_code`, this workaround is dead code. Remove it — if someone still enters an `sk-ant-oat` token as an API key, the auth method is `api_key` and it should be treated as one (it will fail, correctly guiding them to use OAuth instead).

#### Remove `getClaudeCodeOAuthToken()` file-read fallback

The `getClaudeCodeOAuthToken()` function reads Claude Code's credentials file on disk as a fallback token source. With proper OAuth token storage and refresh in the DB, this is unnecessary. Remove it from `ai-provider-internals.ts` and all call sites.

Keep `isAnthropicOAuthToken()` and `ANTHROPIC_OAUTH_BETA_HEADERS` — they're still referenced from `testProviderAuth()` and the inference path.

### 6. Test Path Changes

`testProviderAuth()` in `ai-providers.ts` has a special case: when it detects an `sk-ant-oat` API key for Anthropic providers, it tests via a minimal `/messages` call instead of `/models` (subscription tokens can't list models).

This logic needs to also apply when `authMethod === "oauth2_authorization_code"` and the provider is Anthropic. The condition becomes:

```typescript
if (isAnthropicProvider(providerId) && (
    headers["anthropic-beta"]?.includes("oauth") ||
    provider.authMethod === "oauth2_authorization_code"
)) {
    // Test via /messages instead of /models
}
```

### 7. UI Behavior

No new components needed. The existing `ProviderDetailForm` already handles `oauth2_authorization_code`:

- **Auth method selector**: When `supportedAuthMethods` includes both `api_key` and `oauth2_authorization_code`, the form renders a selector. The admin chooses "OAuth (Sign in)" or "API Key".
- **OAuth selected**: Shows "Sign in" button, "Connected" status with token expiry, "Disconnect" button — all existing UI from EP-OAUTH-001.
- **API Key selected**: Shows the existing manual token paste field with `sk-ant-oat` guidance — unchanged, available as fallback.

The Anthropic-specific guidance block (green "Claude Code / Max Subscription" box with `claude setup-token` instructions) remains visible when API Key is selected. When OAuth is selected, the standard OAuth connection UI replaces it.

## Files Changed

| File | Change |
|---|---|
| `packages/db/data/providers-registry.json` | Add OAuth fields to `anthropic-sub`; clear `oauthRedirectUri` from Codex |
| `apps/web/app/callback/route.ts` | **New** — short OAuth callback route for localhost-restricted providers |
| `apps/web/lib/provider-oauth.ts` | Update `getOAuthRedirectUri()` with localhost-provider allowlist |
| `apps/web/lib/ai-inference.ts` | Add `anthropic-beta` header in `oauth2_authorization_code` path; remove `sk-ant-oat` workaround |
| `apps/web/lib/ai-provider-internals.ts` | Remove `getClaudeCodeOAuthToken()` |
| `apps/web/lib/actions/ai-providers.ts` | Extend `testProviderAuth()` Anthropic special case to cover OAuth auth method |
| `packages/db/src/seed.ts` | Seed `CredentialEntry` for `anthropic-sub` with `scope: "user:inference user:profile"` |

## What Is NOT In Scope

- **Removing the `api_key` fallback** — some users may prefer manual token entry. Both auth methods remain available.
- **Changing the `anthropic` (API Key) provider** — unaffected by this spec.
- **Per-user OAuth tokens** — the credential is platform-wide, same as API keys.
- **Dynamic client registration** — we use the shared Claude Code client ID. If Anthropic later requires per-app registration, the `oauthClientId` field supports admin override.
- **Removing `isAnthropicOAuthToken()`** — still used by `testProviderAuth()` to handle the case where someone has an existing `sk-ant-oat` token configured as an API key.
