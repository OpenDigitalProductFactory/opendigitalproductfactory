# EP-LLM-LIVE-001: Live LLM Conversations — Design Spec

**Date:** 2026-03-14
**Goal:** Replace canned responses in the co-worker panel with real AI inference via configured providers, with automatic failover through a priority-ranked provider list and capability-downgrade notifications.

**MVP Context:** This is the first of three MVP-critical epics. The platform must connect to real LLMs (cloud or local) so agents can have actual conversations. EP-DEPLOY-001 (Docker deployment) is independent and can be built in parallel. EP-AGENT-EXEC-001 (agent task execution) depends on this epic.

---

## 1. New Schema: PlatformConfig

New Prisma model for platform-level settings:

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

No special-casing of any provider by name. The priority system treats all providers uniformly — the only distinction is whether a provider is `status: "active"` and whether inference succeeds.

---

## 2. Inference Module: `callProvider`

**New file: `apps/web/lib/ai-inference.ts`**

Extracted and generalized from the *private* `callProviderForProfiling` function in `lib/actions/ai-providers.ts` (line ~460). The original function remains as a thin wrapper calling the shared module so model profiling continues to work.

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

Makes a single inference call to a specific provider and model. Handles 5 provider API formats:

| Provider Format | Endpoint | System Prompt Handling | Messages Format |
|----------------|----------|----------------------|----------------|
| **Anthropic** | `POST /messages` | Separate `system` param | `messages[]` with `role`/`content` |
| **OpenAI-compatible** (OpenAI, Azure, Groq, Together, Fireworks, etc.) | `POST /chat/completions` | Prepended as `{ role: "system", content }` in messages array | `messages[]` with `role`/`content` |
| **Ollama** | `POST /api/chat` | Prepended as `{ role: "system", content }` in messages array | `messages[]` with `role`/`content` |
| **Gemini** | `POST /models/{model}:generateContent` | First `contents` entry as user role | `contents[]` with `role`/`parts` |
| **Cohere** | `POST /chat` | Separate `preamble` param | `message` (latest) + `chat_history[]` |

**Auth handling:** Reuses existing infrastructure:
- `decryptSecret()` from `lib/credential-crypto.ts` for API keys
- `getProviderBearerToken()` from `lib/actions/ai-providers.ts` for OAuth token exchange
- Anthropic-specific `anthropic-version` header (already handled in profiling code)

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

Reads the `provider_priority` key from `PlatformConfig`. If no entry exists (first startup, before optimization agent has run), falls back to `rankProvidersByCost()` from `lib/ai-profiling.ts` as a bootstrap — queries all active providers sorted by `outputPricePerMToken` ascending, pairs each with its best discovered model.

### `callWithFailover(messages, systemPrompt)`

1. Read priority list via `getProviderPriority()`
2. Record the top-ranked entry's `capabilityTier` as the baseline
3. For each entry in rank order:
   a. Attempt `callProvider(providerId, modelId, messages, systemPrompt)`
   b. If success: compare this entry's `capabilityTier` to the baseline
      - Same or higher tier → `downgraded: false`
      - Lower tier → `downgraded: true`, `downgradeMessage: "{ProviderName} is unavailable. Using {FallbackName} (lower capability) — results may be less accurate."`
   c. If failure: log the error, continue to next entry
4. If all entries exhausted: throw `NoProvidersAvailableError`

**Cascading on all retriable errors** — network, rate limit, provider errors all trigger fallback. Auth errors also cascade (credential may be revoked). Model-not-found cascades (model may have been removed from provider).

### Weekly Optimization Agent

A new `ScheduledJob` entry: `provider-priority-optimizer` (schedule: `weekly`).

**Logic (run by `runScheduledJobNow` or weekly trigger):**
1. Query all `ModelProvider` where `status: "active"`
2. For each provider, find the best model from `ModelProfile` — sort by `capabilityTier` descending, then `costTier` ascending (highest capability, cheapest within tier)
3. If no `ModelProfile` exists for a provider, use the first `DiscoveredModel` as fallback
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
- **portfolio-advisor**: "You help navigate the portfolio structure with 4 root portfolios (foundational, manufacturing_and_delivery, for_employees, products_and_services_sold), 481 taxonomy nodes, health metrics, budget allocations, and agent assignments."
- **ea-architect**: "You guide enterprise architecture modeling using ArchiMate 4 notation. You understand viewpoints, element types (business, application, technology layers), relationship rules, and structured value streams."
- **ops-coordinator**: "You help manage the backlog system with portfolio-type and product-type items, epic grouping, and lifecycle tracking (plan/design/build/production/retirement stages)."

**Prompts are static strings in code**, stored in `ROUTE_AGENT_MAP`. Version-controlled and testable. The number of agents is determined by the map contents — no hardcoded count.

**Route context and user role are injected at call time** in `sendMessage`, not baked into the stored prompt. This keeps prompts reusable across users and routes.

---

## 5. Wiring into `sendMessage`

**Modified file: `apps/web/lib/actions/agent-coworker.ts`**

Current flow: `resolveAgentForRoute` → `generateCannedResponse` → persist
New flow: `resolveAgentForRoute` → build context → `callWithFailover` → persist

### Updated `sendMessage` logic:

1. Auth + thread ownership check (unchanged)
2. Validate input (unchanged)
3. Persist user message (unchanged)
4. Resolve agent via `resolveAgentForRoute` — now returns `systemPrompt`
5. **Build inference context:**
   - Fetch last 20 messages from thread (reuse existing `getRecentMessages` pattern but with direct Prisma query, not React cache)
   - Format as `ChatMessage[]` array
   - Inject route context and user role into the system prompt template
6. **Call `callWithFailover(messages, populatedSystemPrompt)`**
7. **On success:**
   - Persist assistant message with `agentId` and the `providerId` that handled it
   - Call `logTokenUsage` with agentId, providerId, contextKey="coworker", token counts
   - If `downgraded === true`: also persist a system message with the `downgradeMessage`
8. **On `NoProvidersAvailableError`:**
   - Fall back to `generateCannedResponse` (existing canned responses remain as ultimate fallback)
   - Persist a system message: *"AI providers are currently unavailable. Showing a pre-configured response."*

### Loading indicator

The existing `isPending` from `useTransition` in `AgentCoworkerPanel` already disables the input with "Sending..." placeholder. For longer inference times (Ollama on CPU can take 10-30 seconds):

- Add a **thinking bubble** in the messages area — a temporary assistant-styled bubble with animated dots that appears when `isPending` is true and disappears when the response arrives
- Renders in `AgentCoworkerPanel` below the last message, before `messagesEndRef`
- No new component needed — a conditional `<div>` with CSS animation

---

## 6. Backlog Items (Revised)

| Item | Title | Priority | Status |
|------|-------|----------|--------|
| BI-LLM-001 | PlatformConfig schema + callProvider inference module | 1 | open |
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
| `packages/db/prisma/migrations/<timestamp>_platform_config/migration.sql` | PlatformConfig table |
| `apps/web/lib/ai-inference.ts` | `callProvider` (5 formats), exported `logTokenUsage`, error types |
| `apps/web/lib/ai-provider-priority.ts` | `getProviderPriority`, `callWithFailover`, `ProviderPriorityEntry` type |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `PlatformConfig` model |
| `apps/web/lib/agent-coworker-types.ts` | Add `systemPrompt: string` to `RouteAgentEntry` and `AgentInfo` |
| `apps/web/lib/agent-routing.ts` | Add system prompts to `ROUTE_AGENT_MAP`, return via `resolveAgentForRoute` |
| `apps/web/lib/actions/agent-coworker.ts` | Replace `generateCannedResponse` with `callWithFailover` in `sendMessage` |
| `apps/web/lib/actions/ai-providers.ts` | Extract `callProviderForProfiling` and `logTokenUsage` to thin wrappers calling shared module |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Add thinking bubble during inference |
| `packages/db/src/seed.ts` | Seed `provider-priority-optimizer` scheduled job + update BI-LLM items |

---

## 8. Testing Strategy

- **Unit tests for `callProvider`**: Mock HTTP responses for each of the 5 provider formats, verify correct request body construction and response parsing
- **Unit tests for `callWithFailover`**: Mock `callProvider` to simulate success, failure, and cascade scenarios; verify downgrade detection logic
- **Unit tests for agent system prompts**: Verify each agent in the map has a non-empty `systemPrompt`, verify `resolveAgentForRoute` returns it
- **Unit tests for priority optimization**: Verify ranking logic (capability tier desc, cost tier asc)
- **Integration test for `sendMessage`**: Verify end-to-end flow with a mock provider (canned response fallback when no providers active)
- **No tests for actual LLM output** — response content is non-deterministic; tests verify the pipeline mechanics, not the AI quality
