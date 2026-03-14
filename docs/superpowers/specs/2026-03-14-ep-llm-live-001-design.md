# EP-LLM-LIVE-001: Live LLM Conversations — Design Spec

**Date:** 2026-03-14
**Goal:** Replace canned responses in the co-worker panel with real AI inference via configured providers, with automatic failover through a priority-ranked provider list and capability-downgrade notifications.

**MVP Context:** This is the first of three MVP-critical epics. The platform must connect to real LLMs (cloud or local) so agents can have actual conversations. EP-DEPLOY-001 (Docker deployment) is independent and can be built in parallel. EP-AGENT-EXEC-001 (agent task execution) depends on this epic.

---

## 1. New Schema: PlatformConfig + AgentMessage Extension

### PlatformConfig (new model)

```prisma
model PlatformConfig {
  id        String   @id @default(cuid())
  key       String   @unique
  value     Json
  updatedAt DateTime @updatedAt
}
```

**Migration required.** This is a generic key-value store. Keys used by this epic:

| Key | Value Shape | Purpose |
|-----|------------|---------|
| `provider_priority` | `Array<{ providerId: string, modelId: string, rank: number, capabilityTier: string }>` | Ordered provider list set by weekly optimization agent |

### AgentMessage Extension

Add `providerId String?` to `AgentMessage` (same migration). This tracks which provider handled each assistant response, enabling per-message traceability without relying on `TokenUsage` correlation.

No special-casing of any provider by name. The priority system treats all providers uniformly — the only distinction is whether a provider is `status: "active"` and whether inference succeeds.

---

## 2. Inference Module: `callProvider`

**New file: `apps/web/lib/ai-inference.ts`** — a plain server-only module (NOT `"use server"`). Server actions in `actions/ai-providers.ts` and `actions/agent-coworker.ts` can import from it freely. Functions in this module are not callable from the client.

Extracted and generalized from the *private* `callProviderForProfiling` function in `lib/actions/ai-providers.ts` (line ~460). The original function remains as a thin wrapper that retains its model-selection logic (`getProfilingModel()`) and delegates only the HTTP call portion to the shared module.

### Types

```typescript
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
};
```

### `callProvider(providerId, modelId, messages, systemPrompt)`

Makes a single inference call to a specific provider and model. Handles 4 provider API formats:

| Provider Format | Endpoint | System Prompt Handling | Messages Format | Providers |
|----------------|----------|----------------------|----------------|-----------|
| **Anthropic** | `POST /messages` | Separate `system` param | `messages[]` with `role`/`content` | anthropic |
| **OpenAI-compatible** | `POST /chat/completions` | Prepended as `{ role: "system", content }` in messages array | `messages[]` with `role`/`content` | openai, azure-openai, ollama, groq, together, fireworks, xai, mistral, cohere (v2), deepseek, openrouter, litellm, portkey, martian |
| **Gemini** | `POST /models/{model}:generateContent` | First `contents` entry as user role | `contents[]` with `role`/`parts` | gemini |
| **Bedrock** | Not supported this epic | — | — | bedrock (remains `unconfigured`) |

**Note on Ollama:** The existing `callProviderForProfiling` routes Ollama through the OpenAI-compatible path (Ollama exposes `/v1/chat/completions`). This spec maintains that approach — no separate `/api/chat` branch is needed.

**Note on Cohere:** The registry points at `https://api.cohere.com/v2`. Cohere v2 uses the OpenAI-compatible `messages[]` array format with `role: "system"` support, NOT the v1 `message` + `chat_history` + `preamble` pattern. This spec routes Cohere through the OpenAI-compatible path, which is correct for v2.

**Note on Bedrock:** AWS Bedrock requires SigV4 signing (not bearer tokens or API keys). Supporting Bedrock is out of scope for this epic. Bedrock providers remain in the registry but will stay `status: "unconfigured"` and are excluded from the priority list.

### Auth helpers (extracted to shared module)

The following *private* functions from `lib/actions/ai-providers.ts` must be extracted to the shared `ai-inference.ts` module (or a new `lib/ai-provider-auth.ts` module) so `callProvider` can use them:

- `getProviderBearerToken(providerId)` — OAuth token exchange with caching (line ~230)
- `getDecryptedCredential(providerId)` — reads and decrypts `CredentialEntry` (used internally)
- `getProviderExtraHeaders(providerId)` — provider-specific headers like Anthropic `anthropic-version`

These functions are currently private in a `"use server"` file. Extracting them to a plain module avoids accidentally exposing them as server actions. The `"use server"` file retains thin wrappers for any server actions that need them.

**Auth handling summary:**
- `decryptSecret()` from `lib/credential-crypto.ts` for API key decryption
- Extracted `getProviderBearerToken()` for OAuth token exchange
- Extracted `getProviderExtraHeaders()` for provider-specific headers (Anthropic `anthropic-version`)

**Error handling:** Throws typed errors distinguishing:
- Network errors (provider unreachable)
- Auth errors (401/403 — credential expired or revoked)
- Rate limit errors (429)
- Model errors (404 — model not found on provider)
- Provider errors (500+ — provider-side failure)

These error types are used by `callWithFailover` to decide whether to cascade.

### `logTokenUsage(input)`

Also extracted from the *private* `logTokenUsage` in `lib/actions/ai-providers.ts` (line ~700) into this shared module and exported. Creates a `TokenUsage` record with agentId, providerId, contextKey, token counts, inferenceMs, and computed cost (using existing `computeTokenCost` / `computeComputeCost` helpers from `ai-provider-types.ts`).

---

## 3. Provider Priority & Failover: `callWithFailover`

**New file: `apps/web/lib/ai-provider-priority.ts`**

### Types

```typescript
type ProviderPriorityEntry = {
  providerId: string;
  modelId: string;
  rank: number;
  capabilityTier: string;
};

type FailoverResult = InferenceResult & {
  providerId: string;
  modelId: string;
  downgraded: boolean;       // true if capability tier is lower than top-ranked
  downgradeMessage: string | null; // human-readable notification if downgraded
};
```

### `getProviderPriority()`

Reads the `provider_priority` key from `PlatformConfig`. If no entry exists (first startup, before optimization agent has run), falls back to `buildBootstrapPriority()` — a new function that:
1. Queries all `ModelProvider` where `status: "active"`, sorted by `outputPricePerMToken` ascending
2. For each provider, finds the best chat-capable model from `ModelProfile` (filtering out non-chat models using the same skip patterns as `getProfilingModel` — excludes embedding, TTS, moderation, etc.)
3. If no `ModelProfile` exists, falls back to the first `DiscoveredModel` (also filtered for chat capability)
4. Constructs full `ProviderPriorityEntry` objects with `capabilityTier` from the selected model's profile (or `"unknown"` if no profile)

This replaces the earlier claim of directly reusing `rankProvidersByCost()`, which only returns `string[]` provider IDs without model or tier data.

### `callWithFailover(messages, systemPrompt)`

1. Read priority list via `getProviderPriority()`
2. Record the top-ranked entry's `capabilityTier` as the baseline
3. For each entry in rank order (max 5 cascade attempts to prevent pathologically slow responses):
   a. Attempt `callProvider(providerId, modelId, messages, systemPrompt)`
   b. If success: compare this entry's `capabilityTier` to the baseline
      - Same or higher tier -> `downgraded: false`
      - Lower tier -> `downgraded: true`, `downgradeMessage: "{ProviderName} is unavailable. Using {FallbackName} (lower capability) — results may be less accurate."`
   c. If failure: log the error, continue to next entry
4. If max cascade depth reached or all entries exhausted: throw `NoProvidersAvailableError`

**Cascading on all retriable errors** — network, rate limit, provider errors all trigger fallback. Auth errors also cascade (credential may be revoked). Model-not-found cascades (model may have been removed from provider).

### Weekly Optimization Agent

A new `ScheduledJob` entry: `provider-priority-optimizer` (schedule: `weekly`).

**Logic (run by `runScheduledJobNow` or weekly trigger):**
1. Query all `ModelProvider` where `status: "active"`
2. For each provider, find the best chat-capable model from `ModelProfile` — sort by `capabilityTier` descending, then `costTier` ascending (highest capability, cheapest within tier). Filter out non-chat models using skip patterns (embedding, TTS, moderation, image, audio models).
3. If no `ModelProfile` exists for a provider, use the first chat-capable `DiscoveredModel` as fallback (same filtering)
4. Rank the provider+model pairs: highest `capabilityTier` first, cheapest `costTier` as tiebreaker
5. Upsert the ranked list into `PlatformConfig` key `provider_priority`
6. Log completion

**No special-casing of local vs cloud providers.** Compute-priced providers (Ollama, vLLM, etc.) will naturally rank below cloud providers with higher capability tiers, but above cloud providers with lower capability. If a local provider has a capable model (e.g., `llama3:70b` on good hardware), it could rank above a cheap cloud provider. The ranking reflects actual capability and cost — the "safety net" behavior for local providers emerges from their always-available nature, not from hardcoded placement.

---

## 4. Agent System Prompts

**Modified types:**
- `RouteAgentEntry` in `agent-coworker-types.ts` gains `systemPrompt: string`
- `AgentInfo` (returned by `resolveAgentForRoute`) gains `systemPrompt: string`

**Prompt template** (populated per-agent):

```
You are {agentName}, an AI assistant in the Digital Product Factory portal.

Role: {agentDescription}

{agentSpecificContext}

Current context:
- Route: {routeContext} (injected at call time, not stored in map)
- User role: {platformRole} (injected at call time)

Guidelines:
- Be concise and helpful
- Reference specific platform features when relevant
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so
```

**`agentSpecificContext`** — role-specific paragraph per agent. Examples:
- **portfolio-advisor**: "You help navigate the portfolio structure with 4 root portfolios (foundational, manufacturing_and_delivery, for_employees, products_and_services_sold), taxonomy nodes, health metrics, budget allocations, and agent assignments."
- **ea-architect**: "You guide enterprise architecture modeling using ArchiMate 4 notation. You understand viewpoints, element types (business, application, technology layers), relationship rules, and structured value streams."
- **ops-coordinator**: "You help manage the backlog system with portfolio-type and product-type items, epic grouping, and lifecycle tracking (plan/design/build/production/retirement stages)."

**Prompts are static strings in code**, stored in `ROUTE_AGENT_MAP`. Version-controlled and testable. The number of agents is determined by the map contents — no hardcoded count.

**Route context and user role are injected at call time** in `sendMessage`, not baked into the stored prompt. This keeps prompts reusable across users and routes.

---

## 5. Wiring into `sendMessage`

**Modified file: `apps/web/lib/actions/agent-coworker.ts`**

Current flow: `resolveAgentForRoute` -> `generateCannedResponse` -> persist
New flow: `resolveAgentForRoute` -> build context -> `callWithFailover` -> persist

### Updated `sendMessage` logic:

1. Auth + thread ownership check (unchanged)
2. Validate input (unchanged)
3. Persist user message (unchanged)
4. Resolve agent via `resolveAgentForRoute` — now returns `systemPrompt`
5. **Build inference context:**
   - Fetch last 20 messages from thread (direct Prisma query, not React cache)
   - Format as `ChatMessage[]` array
   - Inject route context and user role into the system prompt template
6. **Call `callWithFailover(messages, populatedSystemPrompt)`**
7. **On success:**
   - Persist assistant message with `agentId` and `providerId` (new field on AgentMessage)
   - Call `logTokenUsage` with agentId, providerId, contextKey="coworker", token counts
   - If `downgraded === true`: also persist a system message with the `downgradeMessage`
   - Return type extended: `{ userMessage, agentMessage, systemMessage?: AgentMessageRow }` so the client can display all messages without polling
8. **On `NoProvidersAvailableError`:**
   - Fall back to `generateCannedResponse` (existing canned responses remain as ultimate fallback)
   - Persist a system message: *"AI providers are currently unavailable. Showing a pre-configured response."*
   - Return includes the system message in the extended return type

### Loading indicator

The existing `isPending` from `useTransition` in `AgentCoworkerPanel` already disables the input with "Sending..." placeholder. For longer inference times (local models on CPU can take 10-30 seconds):

- Add a **thinking bubble** in the messages area — a temporary assistant-styled bubble with animated dots that appears when `isPending` is true and disappears when the response arrives
- Renders in `AgentCoworkerPanel` below the last message, before `messagesEndRef`
- No new component needed — a conditional `<div>` with CSS animation

---

## 6. Backlog Items (Revised)

| Item | Title | Priority | Status |
|------|-------|----------|--------|
| BI-LLM-001 | PlatformConfig schema + AgentMessage providerId + callProvider inference module | 1 | open |
| BI-LLM-002 | Agent system prompts for all route agents | 2 | open |
| BI-LLM-003 | Provider priority system + weekly optimization scheduled job | 3 | open |
| BI-LLM-004 | callWithFailover + wire into sendMessage with downgrade notifications | 4 | open |
| BI-LLM-005 | Token usage logging wired into inference | 5 | open |
| BI-LLM-006 | Provider reliability tracking for optimization agent | 6 | open (deferred — backlog only, not implemented this epic) |

**BI-LLM-006 is explicitly deferred.** It adds error-rate tracking per provider to feed into the weekly optimization agent's ranking algorithm (factor C from the brainstorming). Seeded as `status: "open"` but not included in the implementation plan for this epic.

---

## 7. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<timestamp>_platform_config_and_message_provider/migration.sql` | PlatformConfig table + AgentMessage.providerId column |
| `apps/web/lib/ai-inference.ts` | `callProvider` (4 formats), exported `logTokenUsage`, error types, extracted auth helpers |
| `apps/web/lib/ai-provider-priority.ts` | `getProviderPriority`, `buildBootstrapPriority`, `callWithFailover`, `ProviderPriorityEntry` type |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `PlatformConfig` model; add `providerId String?` to `AgentMessage` |
| `apps/web/lib/agent-coworker-types.ts` | Add `systemPrompt: string` to `RouteAgentEntry` and `AgentInfo` |
| `apps/web/lib/agent-routing.ts` | Add system prompts to `ROUTE_AGENT_MAP`, return via `resolveAgentForRoute` |
| `apps/web/lib/actions/agent-coworker.ts` | Replace `generateCannedResponse` with `callWithFailover` in `sendMessage`; extend return type with optional `systemMessage` |
| `apps/web/lib/actions/ai-providers.ts` | Extract `callProviderForProfiling`, `logTokenUsage`, `getProviderBearerToken`, `getDecryptedCredential`, `getProviderExtraHeaders` to thin wrappers calling shared module (wrapper retains model-selection logic for profiling) |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Add thinking bubble during inference; handle extended `sendMessage` return with optional system message |
| `packages/db/src/seed.ts` | Seed `provider-priority-optimizer` scheduled job + update BI-LLM items |

---

## 8. Testing Strategy

- **Unit tests for `callProvider`**: Mock HTTP responses for each of the 4 provider formats (Anthropic, OpenAI-compatible, Gemini, plus error cases), verify correct request body construction and response parsing
- **Unit tests for `callWithFailover`**: Mock `callProvider` to simulate success, failure, cascade, and max-depth scenarios; verify downgrade detection logic
- **Unit tests for `buildBootstrapPriority`**: Verify active providers are ranked by capability then cost; verify non-chat models are filtered out
- **Unit tests for agent system prompts**: Verify each agent in the map has a non-empty `systemPrompt`, verify `resolveAgentForRoute` returns it
- **Unit tests for priority optimization**: Verify ranking logic (capability tier desc, cost tier asc) and non-chat model filtering
- **Integration test for `sendMessage`**: Verify end-to-end flow with a mock provider (canned response fallback when no providers active); verify system message returned on downgrade
- **No tests for actual LLM output** — response content is non-deterministic; tests verify the pipeline mechanics, not the AI quality
