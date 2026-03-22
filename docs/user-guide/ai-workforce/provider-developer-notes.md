---
title: "Provider Integration — Developer Notes"
area: ai-workforce
order: 10
lastUpdated: "2026-03-22"
updatedBy: "Claude (COO)"
---

## Overview

This page documents the technical internals of the AI provider OAuth integration for developers maintaining or extending the platform. For user-facing setup guides, see the individual provider pages.

## OAuth Architecture

### Core Files

- `apps/web/lib/provider-oauth.ts` — PKCE flow, token exchange, token refresh
- `apps/web/lib/actions/provider-oauth.ts` — Server actions (startProviderOAuth, disconnectProviderOAuth)
- `apps/web/app/callback/route.ts` — OAuth callback for localhost-restricted providers (Anthropic)
- `apps/web/app/auth/callback/route.ts` — OAuth callback for port-specific providers (Codex on port 1455)
- `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts` — OAuth callback for standard providers

### Flow

1. Admin clicks "Sign in" on provider detail page
2. `createOAuthFlow()` generates PKCE challenge, stores `OAuthPendingFlow` record, returns authorize URL
3. Browser redirects to provider's authorize endpoint
4. User authenticates, provider redirects back to callback route
5. `exchangeOAuthCode()` exchanges code for token, stores encrypted in `CredentialEntry`
6. Provider `authMethod` switches to `oauth2_authorization_code`
7. Linked MCP services auto-activate

### Redirect URI Handling

Different providers restrict redirect URIs differently:

| Provider | Authorize URL | Redirect URI | Callback Route |
|---|---|---|---|
| Anthropic | claude.ai/oauth/authorize | http://localhost:3000/callback | /callback |
| Codex | auth.openai.com/oauth/authorize | http://localhost:1455/auth/callback | /auth/callback (port 1455 mapped in docker-compose) |
| Others | varies | http://localhost:3000/api/v1/auth/provider-oauth/callback | /api/v1/auth/provider-oauth/callback |

The `getOAuthRedirectUri()` function in `provider-oauth.ts` detects localhost-restricted providers by checking `authorizeUrl` against `LOCALHOST_RESTRICTED_HOSTS` (currently: `claude.ai`). Codex uses an explicit `oauthRedirectUri` field on the `ModelProvider` record.

Port is derived from `NEXTAUTH_URL` or `APP_URL` env var — never hardcoded.

### Token Exchange Format

Providers have different token endpoint requirements:

| Provider | Content-Type | Includes `state` param |
|---|---|---|
| Anthropic (claude.com) | application/json | Yes |
| OpenAI (auth.openai.com) | application/x-www-form-urlencoded | No (rejects unknown params) |

Detection is by `tokenUrl` host in `exchangeOAuthCode()`.

### Token Refresh

The `refreshOAuthToken()` function handles automatic token refresh. It uses the same provider-aware format (JSON for Anthropic, form-encoded for OpenAI). Tokens are encrypted at rest using `CREDENTIAL_ENCRYPTION_KEY`.

## Provider-Specific Behaviors

### Anthropic OAuth

- Client ID: UUID `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (shared Claude Code client)
- Requires `anthropic-beta: oauth-2025-04-20` header on ALL inference calls
- Requires `anthropic-version: 2023-06-01` header (set by `getProviderExtraHeaders`)
- OAuth scope: `user:inference user:profile` (seeded in `CredentialEntry`)
- CAN discover models via /v1/models with OAuth token
- Test connection uses /messages endpoint (not /models)

### Codex OAuth

- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (shared Codex CLI client)
- Redirect URI fixed to `http://localhost:1455/auth/callback` via `oauthRedirectUri` field
- Port 1455 must be mapped in docker-compose.yml
- Category: `agent` — different behavior from `direct` providers
- CANNOT discover models via /v1/models with subscription token (different backend)
- Test connection: credential status check only (no API call)
- Has linked MCP service (`codex-agent`) that auto-activates on OAuth connect
- The `/auth/callback` route does NOT require session auth (runs on different port, session cookie not available)

### Docker Model Runner / Ollama

- Auth method: `none`
- Auto-activates when reachable
- `getTestUrl()` returns `/v1/models` when baseUrl contains `/v1` (Docker Model Runner), falls back to `/api/tags` for legacy Ollama
- Full sensitivity clearance granted automatically (data stays local)
- Model discovery + profiling runs at seed time AND on providers page visit

## Adding a New OAuth Provider

1. Add the provider to `packages/db/data/providers-registry.json` with `authorizeUrl`, `tokenUrl`, `oauthClientId`, and `supportedAuthMethods` including `oauth2_authorization_code`
2. If the provider restricts redirect URIs to localhost paths, either:
   - Add the host to `LOCALHOST_RESTRICTED_HOSTS` in `provider-oauth.ts` (uses `/callback` route)
   - Or set `oauthRedirectUri` on the registry entry and ensure a matching route and port mapping exist
3. Test the token exchange format — if the provider rejects form-encoded or requires JSON, add detection in `exchangeOAuthCode()` and `refreshOAuthToken()` by `tokenUrl` host
4. If the provider requires special headers at inference time, add them in `buildAuthHeaders()` (`ai-inference.ts`), `testProviderAuth()` (`ai-providers.ts`), and `discoverModelsInternal()` (`ai-provider-internals.ts`)
5. If the provider has a linked MCP service, set `linkedProviderId` in the MCP server seed config — auto-activation is handled by `exchangeOAuthCode()`
6. Seed any required `CredentialEntry` fields (e.g., `scope`) in `packages/db/src/seed.ts`

## Common Pitfalls

- **Changing redirect URIs breaks existing providers** — the `redirect_uri` in the token exchange must exactly match what was sent in the authorize request. Both use `getOAuthRedirectUri()`.
- **Different token exchange formats** — Anthropic needs JSON + state, OpenAI needs form-encoded without state. Always check when adding a new provider.
- **Session cookies don't cross ports** — callback routes on different ports (e.g., 1455 for Codex) can't use `auth()` for session verification. Use the `OAuthPendingFlow.state` for CSRF protection instead.
- **Docker redirects use 0.0.0.0** — inside Docker, `request.url` resolves to `http://0.0.0.0:3000`. Callback routes must use `appBase()` helper for redirect URLs.
- **Build cache** — after changing `provider-oauth.ts`, always verify the new code is deployed with a clean build (`docker compose build --no-cache portal`). Stale builds are a common source of confusion.
