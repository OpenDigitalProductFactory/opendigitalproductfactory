> **⚠️ SUPERSEDED** — this design doc captures an earlier iteration of routing. See [2026-04-20-routing-architecture-current.md](./2026-04-20-routing-architecture-current.md) for the current authoritative architecture.

# EP-INF-002: Model-Level Routing Profiles

**Date:** 2026-03-19
**Status:** Superseded by EP-INF-003 (provider model registry with model-level profiles, 2026-03-20)
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic:** EP-INF-002

**Prerequisites:**
- EP-INF-001 (manifest-based routing pipeline) — complete but profiles are on wrong table

---

## Problem Statement

The AI routing profiles are on the wrong table. `ModelProvider` represents a provider-level product offering (e.g., "openrouter"), but a provider like OpenRouter has 109+ models with vastly different capabilities. A single set of capability scores for "openrouter" is meaningless — Claude Sonnet via OpenRouter has completely different capabilities than Llama 3.1 8B via OpenRouter.

This has been implemented three times and is still not correct:

1. **First attempt** — legacy `capabilityTier` string on `ModelProfile`. Single coarse tier per model. LLM-generated with wrong values (Haiku tagged `deep-thinker`).
2. **Second attempt** — EP-INF-001 put 7 dimension scores on `ModelProvider`. Correct dimensionality, wrong granularity. One score set per provider, not per model.
3. **Third attempt** — this spec. Scores on `ModelProfile` (provider + model). Correct dimensionality AND correct granularity.

Additionally:
- The "Profile Models" button uses an LLM to guess capabilities from model names. Provider APIs already return structured metadata (context length, tool support, pricing) that is captured in `DiscoveredModel.rawMetadata` but never extracted.
- Models disappear from providers with no detection. A model removed from the `/models` endpoint weeks ago still appears in the UI and could be routed to.
- Provider documentation about model capabilities is not imported or used.

---

## Terminology

- **Model** — a specific AI model accessible through a provider. Identified by the `(providerId, modelId)` pair on `ModelProfile`. Examples: `("openrouter", "anthropic/claude-sonnet-4-5")`, `("ollama", "llama3.1:latest")`.
- **Provider** — a product offering that hosts models. The `ModelProvider` row. Has auth config, sensitivity clearance, and status that apply to ALL models from that provider.
- **Routing Profile** — the 7 capability dimension scores (0–100) plus hard constraint flags that determine how a model is selected for tasks. Lives on `ModelProfile`.
- **Family Baseline** — a static registry of known capability scores for model families (e.g., all `claude-sonnet-*` models share a baseline). Used to seed profiles when a model is first discovered.
- **Metadata Extraction** — parsing structured fields (context window, tool support, pricing) from the provider API response stored in `DiscoveredModel.rawMetadata`.

---

## Design Summary

Move routing profiles from `ModelProvider` (one per provider) to `ModelProfile` (one per provider + model). The routing pipeline selects a specific `(providerId, modelId)` pair, not just a provider. Profiles are seeded from a family baseline registry and refined from extracted provider metadata, then validated by golden test evaluations.

### Key Principles

- **The atomic routing unit is provider + model** — not provider alone. A provider is a container. A model is the thing with capabilities.
- **Provider-level properties are inherited** — sensitivity clearance, auth method, status, enabled/disabled apply to all models from that provider. They don't duplicate per model.
- **Profiles come from data, not guessing** — structured metadata extraction first, family baselines second, LLM guessing never.
- **Models have lifecycles** — they're discovered, profiled, used, and eventually retired. The system tracks this explicitly.

---

## Section 1: Schema Changes

### ModelProfile — Add Routing Fields

Add to the existing `ModelProfile` model:

```prisma
  // ── Relation to parent provider ──
  provider                 ModelProvider @relation(fields: [providerId], references: [providerId])
  // (Add `modelProfiles ModelProfile[]` to ModelProvider model)

  // ── Routing Profile: Hard Constraints ──
  maxContextTokens         Int?
  maxOutputTokens          Int?
  inputPricePerMToken      Float?
  outputPricePerMToken     Float?
  supportedModalities      Json       @default("{\"input\":[\"text\"],\"output\":[\"text\"]}")

  // ── Routing Profile: Capability Scores (0-100) ──
  reasoning                Int        @default(50)
  codegen                  Int        @default(50)
  toolFidelity             Int        @default(50)
  instructionFollowingScore Int       @default(50)
  structuredOutputScore    Int        @default(50)
  conversational           Int        @default(50)
  contextRetention         Int        @default(50)
  customScores             Json       @default("{}")

  // ── Routing Profile: Provenance ──
  profileSource            String     @default("seed")
  profileConfidence        String     @default("low")
  evalCount                Int        @default(0)
  lastEvalAt               DateTime?

  // ── Lifecycle ──
  status                   String     @default("active")
  retiredAt                DateTime?
  retiredReason            String?
  lastSeenAt               DateTime?
```

Note: `instructionFollowingScore` and `structuredOutputScore` use distinct names to avoid collision with the existing `instructionFollowing` string field (`"excellent" | "adequate" | "insufficient"`) which is still used by the legacy test runner. The old string fields are retained until the legacy profiling code is removed.

### ModelProvider — What Stays, What Goes

**Stays on ModelProvider** (provider-level properties):
- `status`, `authMethod`, `authHeader`, `baseUrl` — auth and connectivity
- `sensitivityClearance` — data classification applies to all models from this provider
- `endpointType`, `category` — provider classification
- `supportsToolUse`, `supportsStructuredOutput`, `supportsStreaming` — provider-level capability flags (some providers don't support tool-calling at the API level regardless of model)
- `catalogVisibility`, `catalogEntry` — marketplace display

**Moves to ModelProfile** (model-level properties):
- `reasoning`, `codegen`, `toolFidelity`, `instructionFollowing` (score), `structuredOutput` (score), `conversational`, `contextRetention` — capability scores
- `customScores` — extensible scores
- `profileSource`, `profileConfidence`, `evalCount`, `lastEvalAt` — provenance
- `maxContextTokens`, `maxOutputTokens` — these vary per model, not per provider
- Cost fields — pricing is per model (OpenRouter charges differently for each model)

**Retained on ModelProvider temporarily** — the dimension score fields added in EP-INF-001 stay until the migration is complete and verified. They become dead columns that are ignored by the routing pipeline.

### DiscoveredModel — Add lastSeenAt Tracking

The existing `lastSeenAt` field (using `@updatedAt`) already tracks when a model was last seen during discovery. Add:

```prisma
  missedDiscoveryCount     Int        @default(0)
```

This counts consecutive discoveries where the model was NOT in the provider's `/models` response. Reset to 0 when the model is seen. When it reaches the retirement threshold, the model is retired.

**Retirement thresholds by provider type:**
- Cloud providers (OpenRouter, Anthropic, OpenAI, etc.): 2 missed discoveries → retired. Cloud model lists are authoritative.
- Local providers (Ollama): **skip disappearance detection entirely**. Ollama's `/api/tags` only shows models loaded in memory, not all downloaded models. A model evicted from VRAM is still on disk and fully functional. Ollama models are only retired manually or when the model file is deleted.

---

## Section 2: Routing Pipeline Refactor

### EndpointManifest Now Represents a Model

The `EndpointManifest` type gains a `modelId` field. The `id` remains the `providerId` for backward compatibility with existing `EndpointTaskPerformance` and `RouteDecisionLog` records. A new `modelId` field is added:

```typescript
interface EndpointManifest {
  id: string;          // providerId — backward compatible with existing records
  providerId: string;  // from ModelProvider
  modelId: string;     // from ModelProfile — NEW
  name: string;        // ModelProfile.friendlyName or modelId
  // ... all existing fields (dimension scores now from ModelProfile, not ModelProvider)
}
```

### Endpoint Identity Strategy

**`EndpointTaskPerformance`** and **`RouteDecisionLog`** currently key on `endpointId` as a plain `providerId`. Rather than changing the key format (which would orphan all existing data), add a `modelId` column to both tables:

- `EndpointTaskPerformance`: add `modelId String?`. The `@@unique` constraint stays on `[endpointId, taskType]` for now — a future migration can add `modelId` to the constraint once all records have it populated.
- `RouteDecisionLog`: add `selectedModelId String?` (already noted in Section 1).

New records are written with both `endpointId` (providerId) and `modelId`. Historical records have `modelId: null` — they predate model-level routing.

### BUILTIN_DIMENSIONS Name Mapping

The `BUILTIN_DIMENSIONS` array uses `"instructionFollowing"` and `"structuredOutput"`. The `ModelProfile` DB fields use `instructionFollowingScore` and `structuredOutputScore` (to avoid collision with existing string fields). The **loader** maps DB names to manifest names:

```typescript
// In loadEndpointManifests:
instructionFollowing: mp.instructionFollowingScore,
structuredOutput: mp.structuredOutputScore,
```

`BUILTIN_DIMENSIONS` and `EndpointManifest` field names stay unchanged — the mapping happens at the DB boundary only.

### loadEndpointManifests() — Join Provider + Model

The loader now produces one manifest entry per `ModelProfile` row, with hard constraints inherited from the parent `ModelProvider`:

```
SELECT mp.providerId, mp.modelId, mp.reasoning, mp.codegen, ...
       prov.sensitivityClearance, prov.status, prov.authMethod, ...
FROM ModelProfile mp
JOIN ModelProvider prov ON mp.providerId = prov.providerId
WHERE prov.status IN ('active', 'degraded')
  AND mp.modelStatus = 'active'
  AND mp.retiredAt IS NULL
```

Provider-level fields (sensitivity, auth, streaming support) are inherited. Model-level fields (scores, context window, pricing) come from the `ModelProfile` row.

### callWithFallbackChain — No More resolveModelId

The router now returns a `RouteDecision` with both `providerId` and `modelId`. The `callWithFallbackChain` function receives these directly — no need for the `resolveModelId()` helper that guesses which model to use. The fallback chain is also provider + model pairs.

### RouteDecision — Model-Aware

```typescript
interface RouteDecision {
  selectedEndpoint: string | null;  // providerId (backward compatible)
  selectedModelId: string | null;   // modelId from ModelProfile
  // ... rest unchanged
}
```

Note: `selectedEndpoint` stays as plain `providerId` for backward compatibility with existing `EndpointTaskPerformance` and `RouteDecisionLog` records. The compound key format (`"${providerId}::${modelId}"`) was considered but rejected to avoid orphaning historical data.

The `RouteDecisionLog` table gains a `selectedModelId` column.

---

## Section 3: Metadata Extraction Pipeline

Replace LLM-based profiling with structured metadata extraction from provider APIs.

### Extraction During Discovery

When `discoverModelsInternal` runs, after upserting `DiscoveredModel` records, run metadata extraction for each model:

```typescript
function extractModelMetadata(providerId: string, modelId: string, rawMetadata: unknown): ExtractedMetadata {
  // Provider-specific extractors
  switch (detectProviderFormat(rawMetadata)) {
    case "openrouter":
      return extractOpenRouterMetadata(rawMetadata);
    case "gemini":
      return extractGeminiMetadata(rawMetadata);
    case "ollama":
      return extractOllamaMetadata(rawMetadata);
    default:
      return extractGenericMetadata(rawMetadata);
  }
}
```

### What Gets Extracted

| Field | OpenRouter | Gemini | Ollama | Generic |
|---|---|---|---|---|
| `maxContextTokens` | `context_length` | `inputTokenLimit` | Infer from size | — |
| `maxOutputTokens` | — | `outputTokenLimit` | — | — |
| `inputPricePerMToken` | `pricing.prompt × 1e6` | — | `0` (local) | — |
| `outputPricePerMToken` | `pricing.completion × 1e6` | — | `0` (local) | — |
| `supportsToolUse` | `"tools" in supported_parameters` | `"generateContent" in methods` | Pattern match on model name | — |
| `supportsStructuredOutput` | `"structured_outputs" in supported_parameters` | — | `false` | — |
| `supportedModalities` | `architecture.modality` parsed | — | Pattern match (vision models) | `{input:["text"],output:["text"]}` |

Extracted fields are written directly to `ModelProfile` — they're factual data from the provider, not guesses.

### Family Baseline Registry

For capability dimension scores (reasoning, codegen, etc.), a static registry maps model name patterns to known baselines:

```typescript
const MODEL_FAMILY_BASELINES: Array<{
  pattern: RegExp;
  scores: Partial<Record<BuiltinDimension, number>>;
  confidence: "low" | "medium";
}> = [
  // Anthropic
  { pattern: /claude.*opus/i,   scores: { reasoning: 95, codegen: 92, toolFidelity: 90, instructionFollowingScore: 92, structuredOutputScore: 88, conversational: 90, contextRetention: 88 }, confidence: "medium" },
  { pattern: /claude.*sonnet/i, scores: { reasoning: 88, codegen: 91, toolFidelity: 85, instructionFollowingScore: 88, structuredOutputScore: 82, conversational: 85, contextRetention: 80 }, confidence: "medium" },
  { pattern: /claude.*haiku/i,  scores: { reasoning: 65, codegen: 60, toolFidelity: 62, instructionFollowingScore: 70, structuredOutputScore: 68, conversational: 72, contextRetention: 60 }, confidence: "medium" },

  // OpenAI
  { pattern: /gpt-4o(?!-mini)/i,  scores: { reasoning: 88, codegen: 85, toolFidelity: 88, instructionFollowingScore: 85, structuredOutputScore: 82, conversational: 85, contextRetention: 78 }, confidence: "medium" },
  { pattern: /gpt-4o-mini/i,      scores: { reasoning: 68, codegen: 62, toolFidelity: 65, instructionFollowingScore: 68, structuredOutputScore: 65, conversational: 70, contextRetention: 58 }, confidence: "medium" },
  { pattern: /gpt-4-turbo/i,      scores: { reasoning: 82, codegen: 80, toolFidelity: 82, instructionFollowingScore: 80, structuredOutputScore: 78, conversational: 80, contextRetention: 72 }, confidence: "medium" },
  { pattern: /(?:^|\/)?o[134]-/i,  scores: { reasoning: 95, codegen: 88, toolFidelity: 75, instructionFollowingScore: 82, structuredOutputScore: 75, conversational: 70, contextRetention: 80 }, confidence: "medium" },

  // Meta Llama
  { pattern: /llama.*3\.1.*405b/i, scores: { reasoning: 80, codegen: 75, toolFidelity: 60, instructionFollowingScore: 72, structuredOutputScore: 55, conversational: 75, contextRetention: 65 }, confidence: "low" },
  { pattern: /llama.*3\.1.*70b/i,  scores: { reasoning: 72, codegen: 68, toolFidelity: 50, instructionFollowingScore: 65, structuredOutputScore: 48, conversational: 70, contextRetention: 55 }, confidence: "low" },
  { pattern: /llama.*3\.1.*8b/i,   scores: { reasoning: 55, codegen: 50, toolFidelity: 40, instructionFollowingScore: 52, structuredOutputScore: 35, conversational: 58, contextRetention: 45 }, confidence: "low" },

  // Google
  { pattern: /gemini.*2\.0.*flash/i, scores: { reasoning: 75, codegen: 72, toolFidelity: 70, instructionFollowingScore: 75, structuredOutputScore: 70, conversational: 72, contextRetention: 68 }, confidence: "low" },
  { pattern: /gemini.*1\.5.*pro/i,   scores: { reasoning: 82, codegen: 78, toolFidelity: 75, instructionFollowingScore: 80, structuredOutputScore: 75, conversational: 78, contextRetention: 85 }, confidence: "low" },

  // Mistral
  { pattern: /mistral.*large/i,  scores: { reasoning: 78, codegen: 72, toolFidelity: 68, instructionFollowingScore: 75, structuredOutputScore: 65, conversational: 72, contextRetention: 65 }, confidence: "low" },
  { pattern: /mixtral/i,         scores: { reasoning: 65, codegen: 60, toolFidelity: 50, instructionFollowingScore: 62, structuredOutputScore: 48, conversational: 65, contextRetention: 55 }, confidence: "low" },

  // DeepSeek
  { pattern: /deepseek.*v3/i,     scores: { reasoning: 82, codegen: 85, toolFidelity: 65, instructionFollowingScore: 72, structuredOutputScore: 60, conversational: 68, contextRetention: 70 }, confidence: "low" },
  { pattern: /deepseek.*coder/i,  scores: { reasoning: 60, codegen: 88, toolFidelity: 55, instructionFollowingScore: 65, structuredOutputScore: 55, conversational: 55, contextRetention: 58 }, confidence: "low" },
];
```

When a model is discovered and has no existing profile scores, the registry is checked. First match wins. No match → all 50s with `profileConfidence: "low"`.

### The New "Sync Profiles" Flow

The current "Profile Models" button becomes "Sync Profiles":

1. Run discovery (fetch `/models` from provider)
2. For each discovered model:
   a. Extract structured metadata from `rawMetadata` → write to `ModelProfile`
   b. If no dimension scores exist, apply family baseline → write to `ModelProfile`
   c. If dimension scores already exist from evals, don't overwrite (evals are authoritative)
3. Run model reconciliation (see Section 4)
4. Report: N models synced, M new, K retired

No LLM calls. Fast, free, deterministic, repeatable.

**New model handling:** When a `DiscoveredModel` exists but no `ModelProfile` row exists (new model, never profiled), the sync creates a `ModelProfile` with:
- `friendlyName`: the modelId (e.g., "claude-sonnet-4-5")
- `summary`: "Auto-profiled from provider metadata"
- `capabilityTier`: mapped from family baseline (`reasoning >= 80` → "deep-thinker", `>= 60` → "fast-worker", else "budget")
- `costTier`: mapped from extracted pricing
- `bestFor` / `avoidFor`: empty arrays (populated by evals later)
- `generatedBy`: "metadata-extraction"
- All routing dimension scores from family baseline or defaults (50s)

---

## Section 4: Model Lifecycle — Disappearance Detection

### During Discovery Reconciliation

After upserting discovered models, check for gone models:

1. Query all `DiscoveredModel` records for this provider
2. Build a set of model IDs from the fresh API response
3. For each DB model NOT in the fresh set:
   - Increment `missedDiscoveryCount`
   - If `missedDiscoveryCount == 1`: log "model not in latest discovery, may be transient"
   - If `missedDiscoveryCount >= 2`: retire the model
4. For each DB model that IS in the fresh set:
   - Reset `missedDiscoveryCount` to 0
   - Update `lastSeenAt`

### Retirement

When a model is retired:
- Set `ModelProfile.status = "retired"`, `retiredAt = now()`, `retiredReason = "Model no longer listed by provider after N discovery cycles"`
- The routing pipeline's `filterHard` already excludes retired models
- Show "Retired" badge in the UI
- Do NOT delete the `ModelProfile` or `DiscoveredModel` records — they're audit evidence

### Re-appearance

If a retired model appears again in a future discovery:
- Reset `missedDiscoveryCount` to 0
- Set `ModelProfile.status = "active"`, clear `retiredAt` and `retiredReason`
- Log "Model reappeared after retirement"
- Existing profile scores are preserved — the model picks up where it left off

---

## Section 5: Eval Loop Update

### Golden Tests Target Models

The eval runner (`runDimensionEval`) currently takes `endpointId` (a `providerId`). It now takes `(providerId, modelId)`:

```typescript
export async function runDimensionEval(
  providerId: string,
  modelId: string,
  triggeredBy: string,
): Promise<EvalRunResult>
```

Scores are written to `ModelProfile` dimension fields, not `ModelProvider`.

### Production Observation Feedback Targets Models

`updateEndpointDimensionScores` currently writes to `ModelProvider`. It now writes to `ModelProfile`:

```typescript
export async function updateEndpointDimensionScores(
  providerId: string,
  modelId: string,
  taskType: string,
  orchestratorScore: number,
): Promise<void>
```

The orchestrator-evaluator already knows the `modelId` (it's in the `FailoverResult` / `FallbackResult`).

### "Evaluate All" Iterates Models

`runAllDimensionEvals` now queries `ModelProfile` (active, non-retired) and evaluates each:

```typescript
const models = await prisma.modelProfile.findMany({
  where: { modelStatus: "active", retiredAt: null },
  include: { provider: { select: { status: true } } },
});
// Filter to providers that are active
const eligible = models.filter(m => m.provider.status === "active" || m.provider.status === "degraded");
```

---

## Section 6: UI Changes

### Provider Detail Page — Per-Model Profiles

The `RoutingProfilePanel` currently shows one set of scores for the provider. Change it to show a **list of models**, each with their own scores:

- Model name and ID
- 7 dimension score bars
- Profile confidence, source, eval count
- Hard constraints (context window, tool support, pricing)
- "Run Evaluation" button per model
- Status badge (active/retired)
- Retired models shown greyed out at the bottom

### Provider List — Score Pills Per Model

The compact score pills on the provider list currently show provider-level scores. Change to show the **top model's** scores (highest average dimension score), with a count of how many models are profiled:

```
Reasoning: 92 | Codegen: 90 | Tools: 88  (23 models profiled)
```

### "Profile Models" → "Sync Profiles"

Rename the button. Update the UI to show what sync does:
- "Syncs model metadata from the provider API and applies capability baselines. No AI calls. Fast and free."

---

## Section 7: Migration Path

### Phase 1 — Schema

- Add routing fields to `ModelProfile`
- Add `missedDiscoveryCount` to `DiscoveredModel`
- Add `selectedModelId` to `RouteDecisionLog`
- Migration: for each existing `ModelProfile`, copy dimension scores from its parent `ModelProvider` (if they exist and are non-default). This preserves the EP-INF-001 seed data at the model level.

### Phase 2 — Metadata Extraction + Family Baselines

- Build the extraction functions (per-provider parsers)
- Build the family baseline registry
- Run extraction + baseline seeding for all existing discovered models
- The "Sync Profiles" button calls this

### Phase 3 — Routing Pipeline

- Refactor `loadEndpointManifests` to join ModelProfile + ModelProvider
- Add `modelId` to `EndpointManifest` and `RouteDecision`
- Remove `resolveModelId` from `callWithFallbackChain`
- Update `callWithFallbackChain` to use the model ID from the route decision

### Phase 4 — Eval Loop

- Update `runDimensionEval` to target `(providerId, modelId)`
- Update `updateEndpointDimensionScores` to write to `ModelProfile`
- Update production feedback accumulation to key on `(providerId, modelId)`

### Phase 5 — Discovery Reconciliation

- Add gone-model detection to `discoverModelsInternal`
- Retirement and re-appearance logic

### Phase 6 — UI

- Refactor `RoutingProfilePanel` to show per-model profiles
- Update provider list score pills
- Rename "Profile Models" → "Sync Profiles"

### Phase 7 — Cleanup

- Remove dimension score fields from `ModelProvider` (they're on `ModelProfile` now)
- Remove old LLM profiling code (`buildProfilingPrompt`, `parseProfilingResponse`)
- Remove `resolveModelId` from `fallback.ts`
- Remove the old `capabilityTier` string field from `ModelProfile` (replaced by dimension scores)
- Remove old `instructionFollowing` and `codingCapability` string fields from `ModelProfile`

---

## Files Affected

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add routing fields to ModelProfile, missedDiscoveryCount to DiscoveredModel, selectedModelId to RouteDecisionLog |
| `apps/web/lib/routing/types.ts` | Add `modelId` to EndpointManifest, RouteDecision |
| `apps/web/lib/routing/loader.ts` | Refactor loadEndpointManifests to join ModelProfile + ModelProvider |
| `apps/web/lib/routing/pipeline.ts` | Route returns providerId + modelId pair |
| `apps/web/lib/routing/fallback.ts` | Remove resolveModelId, use modelId from RouteDecision |
| `apps/web/lib/routing/eval-runner.ts` | Target (providerId, modelId) pairs |
| `apps/web/lib/routing/production-feedback.ts` | Write to ModelProfile, not ModelProvider |
| `apps/web/lib/routing/metadata-extractor.ts` | **New** — per-provider metadata extraction functions |
| `apps/web/lib/routing/family-baselines.ts` | **New** — model family baseline registry |
| `apps/web/lib/ai-provider-internals.ts` | Add discovery reconciliation (gone-model detection) |
| `apps/web/lib/ai-provider-types.ts` | Update parseModelsResponse to pass through more metadata |
| `apps/web/lib/actions/endpoint-performance.ts` | Update server actions for per-model evals |
| `apps/web/lib/actions/ai-providers.ts` | Update sync/profile actions |
| `apps/web/components/platform/RoutingProfilePanel.tsx` | Show per-model profiles |
| `apps/web/components/platform/ServiceRow.tsx` | Update score pills to show top model |
| `apps/web/components/platform/ModelSection.tsx` | Rename "Profile" → "Sync Profiles" |
| `apps/web/lib/orchestrator-evaluator.ts` | Pass modelId to production feedback |
| `apps/web/lib/actions/agent-coworker.ts` | Pass modelId through routing path |
| `apps/web/lib/agentic-loop.ts` | FallbackResult carries modelId from RouteDecision |
