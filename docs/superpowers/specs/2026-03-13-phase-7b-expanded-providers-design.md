# Phase 7B: Expanded Provider Registry, OAuth & AI Model Profiles

**Date:** 2026-03-13
**Status:** Implemented — extended by EP-INF-003 (provider model registry) + EP-OAUTH-001 (generic OAuth)
**Depends on:** Phase 7A (AI Provider Registry & Token Spend)

---

## Problem

The Phase 7A provider registry ships with 6 providers and API-key-only auth. The real AI landscape has 15+ direct providers, several routers/gateways, and enterprise auth requirements (Azure Entra ID, Google Vertex AI) that use OAuth2. Models change constantly — providers add and deprecate models monthly — and most users don't understand the technical differences between them.

The platform needs to:
1. Cover the providers people actually use (including xAI/Grok, Mistral, DeepSeek, Groq, routers like OpenRouter)
2. Support OAuth2 for enterprise providers
3. Discover models dynamically from active providers
4. Describe models in plain English so non-technical users can make informed cost/capability decisions

## Design

### 1. Expanded Provider Registry

The `providers-registry.json` grows from 6 to 17 entries, organized by category.

**Direct providers (13):**

| Provider | providerId | baseUrl | authMethod | authHeader | costModel |
|---|---|---|---|---|---|
| Anthropic | `anthropic` | `https://api.anthropic.com/v1` | `api_key` | `x-api-key` | token |
| OpenAI | `openai` | `https://api.openai.com/v1` | `api_key` | `Authorization` | token |
| Azure OpenAI | `azure-openai` | _(custom endpoint)_ | `api_key` | `api-key` | token |
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `api_key` | `x-goog-api-key` | token |
| AWS Bedrock | `bedrock` | _(custom endpoint)_ | `api_key` | `Authorization` | token |
| Ollama (local) | `ollama` | `http://localhost:11434` | `none` | _(none)_ | compute |
| xAI (Grok) | `xai` | `https://api.x.ai/v1` | `api_key` | `Authorization` | token |
| Mistral AI | `mistral` | `https://api.mistral.ai/v1` | `api_key` | `Authorization` | token |
| Cohere | `cohere` | `https://api.cohere.com/v2` | `api_key` | `Authorization` | token |
| DeepSeek | `deepseek` | `https://api.deepseek.com` | `api_key` | `Authorization` | token |
| Groq | `groq` | `https://api.groq.com/openai/v1` | `api_key` | `Authorization` | token |
| Together AI | `together` | `https://api.together.xyz/v1` | `api_key` | `Authorization` | token |
| Fireworks AI | `fireworks` | `https://api.fireworks.ai/inference/v1` | `api_key` | `Authorization` | token |

**Routers & gateways (4):**

| Router | providerId | baseUrl | authMethod | authHeader | costModel |
|---|---|---|---|---|---|
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | `api_key` | `Authorization` | token |
| LiteLLM | `litellm` | _(custom endpoint)_ | `api_key` | `Authorization` | token |
| Portkey | `portkey` | `https://api.portkey.ai/v1` | `api_key` | `x-portkey-api-key` | token |
| Martian | `martian` | `https://api.withmartian.com/v1` | `api_key` | `Authorization` | token |

**Note on Azure OpenAI and AWS Bedrock:** Both are registered as `api_key` providers in the registry. Azure OpenAI can be switched to `oauth2_client_credentials` by the admin during configuration (see Section 2). AWS Bedrock's SigV4 authentication is complex; for this phase, Bedrock works through a proxy/gateway (e.g., LiteLLM or a custom endpoint) that handles SigV4 internally and exposes a standard API-key interface. Native SigV4 support is deferred.

**Note on LiteLLM:** Registered with `authMethod: api_key` by default. Self-hosted instances with no auth can be switched to `none` during configuration.

#### New registry fields

Each entry gains:
- **`category`**: `"direct"` or `"router"` — used for UI grouping
- **`baseUrl`**: the provider's API root — used for model discovery and auth testing
- **`authMethod`**: `"api_key"` | `"oauth2_client_credentials"` | `"none"` — default auth method; admin can change during configuration
- **`supportedAuthMethods`**: `string[]` — all auth methods this provider supports (e.g. `["api_key", "oauth2_client_credentials"]` for Azure OpenAI). The admin picks one during configuration, which is stored as `ModelProvider.authMethod`.

#### `baseUrl` replaces `authEndpoint`

The existing `authEndpoint` field is replaced by `baseUrl`. The auth test endpoint is derived as `${baseUrl}/models` for most providers. Provider-specific overrides:
- Ollama: `${baseUrl}/api/tags`
- Providers with `baseUrl: null` (Azure, Bedrock): use `${endpoint}/models` where `endpoint` is the admin-configured custom endpoint

The `authEndpoint` column is dropped from `ModelProvider` in the migration. The `testProviderAuth` function is updated to construct the test URL from `baseUrl` (or `endpoint` for custom-endpoint providers).

#### Registry JSON type update

```typescript
export type RegistryProviderEntry = {
  providerId: string;
  name: string;
  families: string[];
  category: "direct" | "router";
  baseUrl: string | null;
  authMethod: "api_key" | "oauth2_client_credentials" | "none";
  supportedAuthMethods: string[];
  authHeader: string | null;
  costModel: string;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  computeWatts?: number;
  electricityRateKwh?: number;
};
```

#### Sync logic update

`syncProviderRegistry()` upserts the new fields (`category`, `baseUrl`, `supportedAuthMethods`) from the registry JSON. On update, these fields ARE overwritten (like `name` and `families`). Fields that reflect admin choices (`status`, `enabledFamilies`, `endpoint`, `authMethod`) are NOT overwritten — the registry's `authMethod` is only used as the default on initial insert.

#### UI changes

The `/platform/ai` page groups provider cards under two headings: **Direct Providers** and **Routers & Gateways**, based on the `category` field.

### 2. Auth Method Expansion

#### Three auth methods

**`api_key`** (most providers): Current behavior. User enters an API key directly. The key is stored in `CredentialEntry.secretRef` as the actual key value (not an env var name).

**`oauth2_client_credentials`** (Azure Entra ID; Google Vertex AI deferred to a future phase): Server-to-server OAuth2. The credential stores `clientId`, `clientSecret`, `tokenEndpoint`, and `scope` — all as actual values, same security posture as API keys. The platform exchanges these for a short-lived bearer token (~1 hour), caches it, and auto-refreshes on expiry. Encryption-at-rest for secrets is deferred to a future security hardening phase.

**`none`** (Ollama, self-hosted LiteLLM): No credentials needed — just endpoint configuration.

#### `authMethod` ownership

**`authMethod` lives on `ModelProvider` only** — it is a property of the provider, not the credential. The `CredentialEntry` does NOT have an `authMethod` field. The form reads `provider.authMethod` to determine which credential fields to render.

This replaces the existing `authHeader !== null` discriminator. All code that currently checks `provider.authHeader !== null` to determine "is this provider keyed?" must be refactored to check `provider.authMethod !== "none"` instead.

#### Dual-auth providers

Some providers support multiple auth methods (e.g., Azure OpenAI supports both `api_key` and `oauth2_client_credentials`). The registry JSON includes a `supportedAuthMethods` array listing all options. The `ModelProvider.authMethod` field stores the admin's chosen method, set during configuration. The `ProviderDetailForm` shows a selector when `supportedAuthMethods.length > 1`.

#### CredentialEntry schema

```prisma
model CredentialEntry {
  id             String    @id @default(cuid())
  providerId     String    @unique
  secretRef      String?                         // API key (api_key method)
  clientId       String?                         // OAuth client ID
  clientSecret   String?                         // OAuth client secret
  tokenEndpoint  String?                         // OAuth token URL
  scope          String?                         // OAuth scope
  cachedToken    String?                         // cached bearer token (not in UI)
  tokenExpiresAt DateTime?                       // token expiry
  status         String    @default("unconfigured")
  updatedAt      DateTime  @updatedAt
}
```

#### ModelProvider schema (updated fields)

```prisma
model ModelProvider {
  // ... existing fields (minus authEndpoint, which is dropped) ...
  category             String  @default("direct")
  baseUrl              String?
  authMethod           String  @default("api_key")
  supportedAuthMethods Json    @default("[\"api_key\"]")
}
```

#### ProviderDetailForm adaptation

The form renders different credential fields based on `provider.authMethod`:
- `api_key` → API Key input (current behavior)
- `oauth2_client_credentials` → Client ID, Client Secret, Token Endpoint, Scope inputs
- `none` → no credential fields, endpoint config only

When `provider.supportedAuthMethods` has multiple entries, a dropdown appears at the top of the credential section allowing the admin to switch auth method. Changing the method clears the previous credential fields.

#### OAuth token exchange

A new `getProviderBearerToken(providerId)` function:
1. Reads the provider and credential entry
2. If `cachedToken` exists and `tokenExpiresAt` is in the future (with 5-minute buffer), returns cached token
3. Otherwise, POSTs to `tokenEndpoint` with `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`
4. Stores the new token and expiry in the credential entry
5. Returns the bearer token

Concurrent calls that both find an expired token will both perform the exchange. This is harmless — the second call simply overwrites the cached token with an equally valid one.

"Test Connection" for OAuth providers performs the full token exchange and then hits the provider's models endpoint.

#### Updated TypeScript types

```typescript
export type ProviderRow = {
  id: string;
  providerId: string;
  name: string;
  families: string[];
  enabledFamilies: string[];
  status: string;
  costModel: string;
  category: string;
  baseUrl: string | null;
  authMethod: string;
  supportedAuthMethods: string[];
  authHeader: string | null;
  endpoint: string | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  computeWatts: number | null;
  electricityRateKwh: number | null;
};

export type CredentialRow = {
  providerId: string;
  secretRef: string | null;
  clientId: string | null;
  clientSecret: string | null;
  tokenEndpoint: string | null;
  scope: string | null;
  status: string;
};
```

#### Updated `configureProvider` input

```typescript
export async function configureProvider(input: {
  providerId: string;
  enabledFamilies: string[];
  authMethod?: string;          // switch auth method (dual-auth providers)
  secretRef?: string;           // API key
  clientId?: string;            // OAuth
  clientSecret?: string;        // OAuth
  tokenEndpoint?: string;       // OAuth
  scope?: string;               // OAuth
  endpoint?: string;            // custom endpoint
  computeWatts?: number;
  electricityRateKwh?: number;
}): Promise<{ error?: string }>
```

### 3. Dynamic Model Discovery

When a provider's connection is verified, the platform fetches its live model catalog.

#### Discovery triggers

- **After successful "Test Connection"** — auto-discover models
- **"Refresh Models" button** on the provider detail page — manual trigger
- Models are NOT discovered on every page load (too expensive/slow)

#### DiscoveredModel table

```prisma
model DiscoveredModel {
  id           String   @id @default(cuid())
  providerId   String
  modelId      String
  rawMetadata  Json
  discoveredAt DateTime @default(now())
  lastSeenAt   DateTime @default(now())  @updatedAt

  @@unique([providerId, modelId])
}
```

`rawMetadata` stores whatever the provider's API returns — context window, capabilities, pricing, etc. This varies by provider.

`lastSeenAt` is updated on every upsert, so stale models (removed by the provider) can be identified by comparing `lastSeenAt` to the most recent discovery run.

#### Provider-specific parsing

A `discoverModels(providerId)` function:
1. Reads the provider config and active credential
2. Constructs the test URL: `${baseUrl}/models` (or `${baseUrl}/api/tags` for Ollama, or `${endpoint}/models` for custom-endpoint providers)
3. Calls the endpoint with appropriate auth headers
4. Normalizes the response via `parseModelsResponse(providerId, json)` into `{ modelId, rawMetadata }[]`
5. Upserts into `DiscoveredModel` (updates `lastSeenAt` for existing models)
6. Returns `{ discovered: number, new: number, error?: string }`

Provider-specific response formats:
- Most providers: `GET /models` → `{ data: [{ id, ... }] }` (OpenAI-compatible)
- Cohere: `GET /models` → `{ models: [{ name, ... }] }` (v2 format)
- Ollama: `GET /api/tags` → `{ models: [{ name, ... }] }`

For routers like OpenRouter (500+ models), the full catalog is stored.

#### Model staleness

When models are refreshed, models NOT present in the latest response are considered stale. Stale models are not deleted — they remain in the database with their old `lastSeenAt`. The UI shows stale models (where `lastSeenAt` is older than the provider's most recent discovery) with a dimmed appearance and a "Last seen: [date]" note. This prevents data loss if a provider has a temporary API issue.

#### Discovery error handling

If the `/models` endpoint fails during discovery:
- Log the error
- Leave existing `DiscoveredModel` rows untouched
- Show an error message inline on the provider detail page: "Model discovery failed: [error]"
- Do NOT block the connection test result — auth success and model discovery are independent operations

### 4. AI-Generated Model Profiles

The core innovation: every discovered model gets an AI-generated, plain-English profile that non-technical users can understand.

#### ModelProfile table

```prisma
model ModelProfile {
  id             String   @id @default(cuid())
  providerId     String
  modelId        String
  friendlyName   String                          // "Deep Thinker", "Fast Worker"
  summary        String                          // one-line plain-English description
  capabilityTier String                          // deep-thinker | fast-worker | specialist | budget | embedding
  costTier       String                          // $ | $$ | $$$ | $$$$
  bestFor        Json                            // ["complex writing", "legal analysis"]
  avoidFor       Json                            // ["simple lookups", "batch tasks"]
  contextWindow  String?                         // "Large (200K tokens)"
  speedRating    String?                         // "Fast", "Moderate", "Slow"
  generatedBy    String                          // model that produced this profile
  generatedAt    DateTime @default(now())

  @@unique([providerId, modelId])
}
```

#### Profiling logic

A `profileModels(providerId, modelIds)` function:
1. Selects the cheapest active AI provider for the profiling task (see provider selection below)
2. Batches models (up to 20 per prompt to minimize API calls)
3. Sends a structured prompt with model IDs, raw metadata, provider name, and known pricing
4. Parses the structured JSON response into `ModelProfile` records
5. Logs all token usage under `agentId: "system:model-profiler"`

#### Profiling prompt

The prompt instructs the profiling model to produce non-technical descriptions:

> "You are helping non-technical business users understand AI models. For each model below, produce a JSON profile with: friendlyName (a memorable 2-3 word name like 'Deep Thinker' or 'Fast Worker'), summary (one plain-English sentence), capabilityTier, costTier, bestFor (3-5 use cases), avoidFor (2-3 anti-patterns), contextWindow (human-friendly), speedRating. Use language a non-technical manager would understand. No jargon."

#### Automatic profiling

- After a successful "Test Connection" discovers models, any unprofiled models are automatically queued for profiling
- After a "Refresh Models" discovers new models, same behavior
- **Cold start:** if no AI provider is active yet, models show as "Not yet profiled." The "Profile Now" button is visible but disabled, with tooltip: "Configure and test at least one AI provider first"
- **Rate limiting for large catalogs:** routers with 500+ models are profiled in batches of 20 per prompt. Before profiling >50 models, show a confirmation: "Profile [N] models? Estimated cost: ~$[X] using [provider]." The user can confirm or cancel.

#### Profiling error handling

- On JSON parse failure from the profiling model, retry once with a stricter prompt ("respond ONLY with valid JSON, no markdown")
- If still failing, mark those models as `status: "profiling_failed"` in the batch result and proceed with models that parsed successfully
- Failed models show in the UI as "Profiling failed — [Re-profile]" with a manual retry button
- All attempts (success and failure) are logged to `TokenUsage`

#### Re-profiling

Individual models can be re-profiled via a "Re-profile" button on the model card. A "Re-profile All" button on the provider detail page re-profiles all models for that provider. Re-profiling overwrites the existing `ModelProfile` record.

#### Provider selection for profiling (fallback strategy)

The platform picks the cheapest capable active provider:

1. Rank all active providers by output token cost (ascending)
2. Try the cheapest one
3. If it fails (rate limit, timeout, error), fall back to the next cheapest
4. Log every attempt — success or failure — to `TokenUsage` with `agentId: "system:model-profiler"`

This ensures profiling is cost-efficient under normal conditions but resilient when a cheap provider is rate-limited or down.

#### Profiling permissions

All profiling actions (automatic and manual) require `manage_provider_connections` — the same permission used for other provider write operations.

#### UI: Model cards on provider detail page

Below the connection config, a "Models" section displays discovered models. Client-side pagination with 20 models per page, with a search box that filters on `friendlyName` and `modelId`.

**Profiled model:**
> **Deep Thinker** (claude-opus-4-6)
> Best for complex analysis, writing, and reasoning. The most capable model but slower and more expensive.
> Good for: legal review, architecture design, research
> Avoid for: simple lookups, high-volume batch jobs
> Cost: $$$$ · Speed: Moderate · Context: Large (200K)
> [Re-profile]

**Unprofiled model (cold start):**
> **claude-opus-4-6** — _Not yet profiled_
> [Profile Now] _(disabled if no active provider)_

**Failed profile:**
> **claude-opus-4-6** — _Profiling failed_
> [Re-profile]

**Stale model (removed by provider):**
> _(dimmed)_ **old-model-v1** — Deep Thinker
> Last seen: 2026-03-10
> [Remove]

### 5. Token Usage Logging

All AI profiling calls are logged to the existing `TokenUsage` table:
- `agentId`: `"system:model-profiler"`
- `providerId`: whichever provider handled the profiling
- `inputTokens`, `outputTokens`, `costUsd`: actual usage

This shows up in the Token Spend dashboard alongside agent usage, so the monthly bill clearly separates operational AI costs (profiling) from agent work.

### 6. Seeding

The seed does not populate providers directly. It creates the `provider-registry-sync` scheduled job (already done in Phase 7A). On first page load, the auto-sync reads `providers-registry.json` and populates all providers. A fresh database will show "0 providers registered" until the first page load triggers the sync.

## File Changes Summary

### Modified files
- **`packages/db/prisma/schema.prisma`** — expand ModelProvider (add `category`, `baseUrl`, `authMethod`, `supportedAuthMethods`; drop `authEndpoint`), expand CredentialEntry (add OAuth fields), add DiscoveredModel, add ModelProfile
- **`packages/db/data/providers-registry.json`** — expand from 6 to ~19 providers with new fields
- **`apps/web/lib/ai-provider-types.ts`** — updated `RegistryProviderEntry`, `ProviderRow`, `CredentialRow` types; new types for `DiscoveredModelRow`, `ModelProfileRow`
- **`apps/web/lib/ai-provider-data.ts`** — new fetchers for discovered models and profiles
- **`apps/web/lib/actions/ai-providers.ts`** — model discovery, OAuth token exchange, expanded sync with new fields, updated `configureProvider` input, updated `testProviderAuth` to use `authMethod` discriminator and derive test URL from `baseUrl`
- **`apps/web/components/platform/ProviderDetailForm.tsx`** — adaptive auth fields based on `provider.authMethod`, auth method selector for dual-auth providers, models section with profile cards
- **`apps/web/app/(shell)/platform/ai/page.tsx`** — category grouping (Direct Providers / Routers & Gateways)

### New files
- **`apps/web/lib/ai-profiling.ts`** — profiling prompt, batch logic, provider selection/fallback strategy, JSON parse with retry
- **`apps/web/components/platform/ModelCard.tsx`** — reusable card component for profiled/unprofiled/failed/stale models

## Non-goals (deferred)

- Agent-to-model matching and recommendations
- Model benchmarking or live performance tracking
- OAuth2 Authorization Code / PKCE flow (user-facing "bring your own key")
- Auto-profiling on a schedule (profiling only triggers on user actions or test/refresh)
- Secrets encryption at rest (security hardening phase)
- Native AWS SigV4 authentication (use proxy/gateway for Bedrock)
- Google Vertex AI as a separate provider entry (use Gemini direct API for now)
