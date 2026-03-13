# Phase 7B: Expanded Provider Registry, OAuth & AI Model Profiles

**Date:** 2026-03-13
**Status:** Design approved
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

The `providers-registry.json` grows from 6 to ~19 entries, organized by category.

**Direct providers (13):**

| Provider | providerId | baseUrl | authMethod | authHeader | costModel |
|---|---|---|---|---|---|
| Anthropic | `anthropic` | `https://api.anthropic.com/v1` | `api_key` | `x-api-key` | token |
| OpenAI | `openai` | `https://api.openai.com/v1` | `api_key` | `Authorization` | token |
| Azure OpenAI | `azure-openai` | _(custom endpoint)_ | `api_key` / `oauth2_client_credentials` | `api-key` / `Authorization` | token |
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
| LiteLLM | `litellm` | _(custom endpoint)_ | `api_key` / `none` | `Authorization` | token |
| Portkey | `portkey` | `https://api.portkey.ai/v1` | `api_key` | `x-portkey-api-key` | token |
| Martian | `martian` | `https://api.withmartian.com/v1` | `api_key` | `Authorization` | token |

#### New registry fields

Each entry gains:
- **`category`**: `"direct"` or `"router"` — used for UI grouping
- **`baseUrl`**: the provider's API root — used for model discovery and auth testing
- **`authMethod`**: `"api_key"` | `"oauth2_client_credentials"` | `"none"` — determines credential UI

#### UI changes

The `/platform/ai` page groups provider cards under two headings: **Direct Providers** and **Routers & Gateways**.

### 2. Auth Method Expansion

#### Three auth methods

**`api_key`** (most providers): Current behavior. User enters an API key directly. The key is stored in `CredentialEntry.secretRef`.

**`oauth2_client_credentials`** (Azure Entra ID, Google Vertex AI): Server-to-server OAuth2. The credential stores `clientId`, `clientSecret`, `tokenEndpoint`, and `scope`. The platform exchanges these for a short-lived bearer token (~1 hour), caches it, and auto-refreshes on expiry.

**`none`** (Ollama, self-hosted LiteLLM): No credentials needed — just endpoint configuration.

#### CredentialEntry schema expansion

```prisma
model CredentialEntry {
  id             String    @id @default(cuid())
  providerId     String    @unique
  authMethod     String    @default("api_key")
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

#### ProviderDetailForm adaptation

The form renders different credential fields based on `authMethod`:
- `api_key` → API Key input (current behavior)
- `oauth2_client_credentials` → Client ID, Client Secret, Token Endpoint, Scope inputs
- `none` → no credential fields, endpoint config only

#### OAuth token exchange

A new `getProviderBearerToken(providerId)` function:
1. Reads the credential entry
2. If `cachedToken` exists and `tokenExpiresAt` is in the future (with 5-minute buffer), returns cached token
3. Otherwise, POSTs to `tokenEndpoint` with `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`
4. Stores the new token and expiry in the credential entry
5. Returns the bearer token

"Test Connection" for OAuth providers performs the full token exchange and then hits the provider's models endpoint.

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

  @@unique([providerId, modelId])
}
```

`rawMetadata` stores whatever the provider's API returns — context window, capabilities, pricing, etc. This varies by provider.

#### Provider-specific parsing

A `discoverModels(providerId)` function:
1. Reads the provider config and active credential
2. Calls `GET {baseUrl}/models` (or provider-specific endpoint)
3. Normalizes the response via `parseModelsResponse(providerId, json)` into `{ modelId, rawMetadata }[]`
4. Upserts into `DiscoveredModel`

Provider-specific endpoints:
- Most providers: `GET {baseUrl}/models` (OpenAI-compatible)
- Anthropic: `GET {baseUrl}/models`
- Cohere: `GET {baseUrl}/models` (v2 format)
- Ollama: `GET {baseUrl}/api/tags`

For routers like OpenRouter (500+ models), the full catalog is stored. The UI paginates and supports search.

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
- If no AI provider is active yet (cold start), models show as "Not yet profiled" with a manual "Profile Now" button
- Rate limiting: routers with 500+ models are profiled in batches of 20 per request

#### Provider selection for profiling (fallback strategy)

The platform picks the cheapest capable active provider:

1. Rank all active providers by output token cost (ascending)
2. Try the cheapest one
3. If it fails (rate limit, timeout, error), fall back to the next cheapest
4. Log every attempt — success or failure — to `TokenUsage` with `agentId: "system:model-profiler"`

This ensures profiling is cost-efficient under normal conditions but resilient when a cheap provider is rate-limited or down.

#### UI: Model cards on provider detail page

Below the connection config, a "Models" section displays discovered models as cards:

**Profiled model:**
> **Deep Thinker** (claude-opus-4-6)
> Best for complex analysis, writing, and reasoning. The most capable model but slower and more expensive.
> Good for: legal review, architecture design, research
> Avoid for: simple lookups, high-volume batch jobs
> Cost: $$$$ · Speed: Moderate · Context: Large (200K)

**Unprofiled model (cold start only):**
> **claude-opus-4-6** — _Not yet profiled_
> [Profile Now]

### 5. Token Usage Logging

All AI profiling calls are logged to the existing `TokenUsage` table:
- `agentId`: `"system:model-profiler"`
- `providerId`: whichever provider handled the profiling
- `inputTokens`, `outputTokens`, `costUsd`: actual usage

This shows up in the Token Spend dashboard alongside agent usage, so the monthly bill clearly separates operational AI costs (profiling) from agent work.

### 6. ModelProvider Schema Changes

The existing `ModelProvider` model gains three new fields:

```prisma
model ModelProvider {
  // ... existing fields ...
  category    String  @default("direct")    // "direct" | "router"
  baseUrl     String?                        // API base for model discovery
  authMethod  String  @default("api_key")   // "api_key" | "oauth2_client_credentials" | "none"
}
```

## File Changes Summary

### Modified files
- **`packages/db/prisma/schema.prisma`** — expand ModelProvider, CredentialEntry; add DiscoveredModel, ModelProfile
- **`packages/db/data/providers-registry.json`** — expand from 6 to ~19 providers with new fields
- **`apps/web/lib/ai-provider-types.ts`** — new types for DiscoveredModel, ModelProfile, auth methods, provider selection
- **`apps/web/lib/ai-provider-data.ts`** — new fetchers for discovered models and profiles
- **`apps/web/lib/actions/ai-providers.ts`** — model discovery, OAuth token exchange, AI profiling with fallback, expanded sync
- **`apps/web/components/platform/ProviderDetailForm.tsx`** — adaptive auth fields, models section with profile cards
- **`apps/web/app/(shell)/platform/ai/page.tsx`** — category grouping (Direct Providers / Routers & Gateways)
- **`packages/db/src/seed.ts`** — no change needed (sync populates providers)

### New files
- **`apps/web/lib/ai-profiling.ts`** — profiling prompt, batch logic, provider selection/fallback strategy
- **`apps/web/components/platform/ModelCard.tsx`** — reusable card component for profiled/unprofiled models

## Non-goals (deferred)

- Agent-to-model matching and recommendations
- Model benchmarking or live performance tracking
- OAuth2 Authorization Code / PKCE flow (user-facing "bring your own key")
- Auto-profiling on a schedule (profiling only triggers on user actions)
