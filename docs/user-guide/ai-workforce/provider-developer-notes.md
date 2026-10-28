---
title: "Provider Integration — Developer Notes"
area: ai-workforce
order: 10
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
- OAuth scope: `openid profile email offline_access`, defaulted in `createOAuthFlow()` for any `auth.openai.com` authorize URL when `CredentialEntry.scope` is empty (a configured scope wins). Without `offline_access` OpenAI issues no refresh token. The Codex CLI's own login additionally requests `api.connectors.read api.connectors.invoke`; DPF does not need them. Never send `api.responses.write` (invalid, removed in e8a1551799b).
- A token response without a refresh token never overwrites a stored one; when a credential has no refresh token and is past expiry, `refreshOAuthToken()` marks it and its codex/chatgpt sibling `expired`.
- Has linked MCP service (`codex-agent`) that auto-activates on OAuth connect
- The `/auth/callback` route does NOT require session auth (runs on different port, session cookie not available)

### Docker Model Runner / Ollama

The existing `run_endpoint_tests` MCP operation also supports `fidelityOnly: true`
with explicit `endpointId`, `modelId`, `providerConnectionId` and
`fidelityObservationIndex`. Ask the coworker
to run this mode for one configured local account/model; it cannot be combined
with ordinary probes, scenarios, concurrency tests or exhaustive scopes.
Start at index `0`. Each request performs at most one observation and returns a
server-issued `runId` with `checkpoint.nextIndex` and `checkpoint.state`. Continue
by supplying that `fidelityRunId` and the next index explicitly. Nine golden
prompts at each surface (8/15/24/32/48) require 45 distinct continuations; a
request does not promise to run that matrix automatically. Selection and actual
governed-read results remain separate in the existing test-run history.
It changes no model ratings, confidence or production tool limits.

Replaying a completed index returns its stored observation without running the
next case. The database checkpoint survives a disconnected caller or portal
restart; a currently authorized executor must request continuation. A started
case whose execution is unknown becomes `held` and is never stolen or retried.
Stop on `held`, `busy` or unknown execution; retain its history for diagnosis.
Legacy matrix runs remain immutable and cannot be resumed with this protocol.

Each step uses the existing origin's finite admission budget and the selected
model's canonical execution policy, bounded by any real inherited deadline or
cancellation. Acquiring capacity starts the execution window; it does not prove
that provider bytes were dispatched. Timing reports waiting, after-acquisition
or unknown phase separately. A canceled or expired observation stays incomplete,
and a late worker cannot overwrite its checkpoint or qualify a cohort. Current
human, token, agent, room, catalog and runtime authority is checked again before
inference dispatch and before recording a successful governed read. The drain
registry conservatively covers one patient step; it grants no extra authority.

This mode needs positive served-source and observed model/runtime identity.
Its initial identity reader reuses the existing audited DMR parser/template
proof; unsupported engines or model templates remain unrun rather than inheriting
another model's results. A changed identity, missing permissions, invalid tool
arguments or incomplete response cannot qualify a cohort. Three observations
per task class do not meet the five-observation class-specific minimum.
The result's `runtimeAcceptance` remains unverified until independently accepted.
An expired turn cannot start a read or qualify from late audit verification.
Ordinary OAuth clients can use this mode without a conversation thread.

- Auth method: `none`
- Auto-activates when reachable
- `getTestUrl()` returns `/v1/models` when baseUrl contains `/v1` (Docker Model Runner), falls back to `/api/tags` for legacy Ollama
- Full sensitivity clearance granted automatically (data stays local)
- Model discovery + profiling runs at seed time AND on providers page visit

#### Runner configuration the platform keeps in place

Docker Model Runner stores runtime settings per model and mode through
`/engines/_configure`. It forgets them on restart, and each configure call
replaces the model's whole stored config. The local-model reconcile
(`apps/web/lib/inference/local-model-context-reconcile.ts`) runs on boot and
every 20 minutes, and keeps three things in place:

- **Context window:** the served `context-size` for the generation model.
- **Residency:** `keep_alive: "-1"` for the generation model (BI-34F71E9D).
  Docker Model Runner ignores the `keep_alive` field in an OpenAI chat request
  body; only the stored setting counts. Without it, the model unloads after five
  idle minutes. Each reload re-reads the whole GGUF from disk and discards every
  slot's prompt cache. A resident runner is still unloaded under memory pressure.
- **Embedder placement:** the installed embedder runs CPU-only
  (`runtime-flags: ["--device", "none"]`) and stays loaded (BI-B60AFE7B). On the
  GPU beside a generation model that fills the card, each embedder load
  overcommitted VRAM. Windows then spilled to shared memory, and generation
  decode on a 24 GB RTX 4090 fell to about 0.02 tok/s for minutes. The embedder's
  completion mode is also pinned CPU-only and set to unload at once, because
  every configure call preloads the model through `/v1/chat/completions`.

Every context or residency write carries any other stored key (for example
`runtime-flags` or `speculative`) back with it, so the reconcile never removes
an operator's or a qualification run's setting. Local thinking-budget evidence
accepts `context-size` and `keep_alive` only, because neither can change the
chat template or parser. Any other stored key leaves that evidence unknown.

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
- **Deployed source identity** — after changing `provider-oauth.ts`, use the qualified canonical release and governed self-upgrade path. Confirm the served source contains the change.
