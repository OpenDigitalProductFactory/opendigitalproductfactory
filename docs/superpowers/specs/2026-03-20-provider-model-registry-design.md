# EP-INF-003: Provider Model Registry

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-003

**Prerequisites:**
- EP-INF-001 (AI endpoint routing and profiling) — partially implemented
- EP-INF-002 (model-level routing profiles) — design complete, implementation incomplete

**Supersedes:**
- `family-baselines.ts` as primary source of dimension scores (demoted to fallback)
- `metadata-extractor.ts` 8-field ExtractedMetadata interface (replaced by ModelCard)
- LLM-based model profiling in discovery pipeline (replaced by deterministic adapters)

**Related:**
- [2026-03-20-adaptive-model-routing-design.md](2026-03-20-adaptive-model-routing-design.md) — master vision for contract-based routing (EP-INF-003 through EP-INF-006)
- [2026-03-18-ai-routing-and-profiling-design.md](2026-03-18-ai-routing-and-profiling-design.md) — EP-INF-001 foundation
- [2026-03-19-model-level-routing-profiles-design.md](2026-03-19-model-level-routing-profiles-design.md) — EP-INF-002 model-level profiles
- [2026-03-19-eval-loop-design.md](2026-03-19-eval-loop-design.md) — eval loop (realigned in EP-INF-006)

---

## Problem Statement

The platform discovers models from providers but captures only ~25% of what providers publish. The remaining 75% — capabilities, rate limits, pricing tiers, deprecation dates, default parameters, prompting constraints — is either guessed (family baselines), reinvented (golden tests), or ignored entirely.

Verified problems:

1. **Providers publish rich structured metadata that we ignore.** Anthropic's Models API returns a `capabilities` object with boolean flags for batch, citations, code execution, context management, effort levels, image input, PDF input, structured output, and thinking types. We extract none of it.

2. **OpenRouter publishes 30+ fields per model.** Including `supported_parameters`, `default_parameters`, `per_request_limits`, `architecture.instruct_type`, `expiration_date`, and 12+ pricing tiers (prompt, completion, cache read/write, image, audio, reasoning, web search, per-request fee). Our extractor captures 8 fields.

3. **The current `ExtractedMetadata` interface has 8 fields.** `maxContextTokens`, `maxOutputTokens`, `inputPricePerMToken`, `outputPricePerMToken`, `supportsToolUse`, `supportsStructuredOutput`, `inputModalities`, `outputModalities`. That's it.

4. **Family baselines are the primary source of routing scores.** ~20 hardcoded model-family patterns assign capability scores (0-100) based on name matching. These are educated guesses, not provider data.

5. **Golden tests try to measure what providers already declare.** ~70 hand-authored test prompts attempt to score capabilities that providers publish as structured metadata.

6. **Embedding, image, audio, and moderation models share the chat candidate pool.** The live DB shows OpenAI's chat, reasoning, embedding, image, audio, video, moderation, and speech models all as routing candidates. There is no model classification filter.

7. **Null pricing is treated as zero cost.** Models with unknown pricing look free to the cost optimizer, biasing routing toward unpriced models.

8. **Rate limits are discovered by hitting them.** No pre-flight capacity awareness exists. The system dispatches requests until it gets a 429, then marks the provider degraded.

### What Providers Actually Publish vs. What We Capture

| Data Point | Anthropic API | OpenRouter API | Current Extractor |
|---|---|---|---|
| Context window | `max_input_tokens` | `context_length` | Captured |
| Max output tokens | `max_tokens` | `top_provider.max_completion_tokens` | Partial |
| Pricing (input/output) | Docs only | `pricing.prompt/completion` | Captured (basic) |
| Capabilities object | 12+ boolean flags | — | **Not captured** |
| Supported parameters | Beta headers list | `supported_parameters` array | **Not captured** |
| Default parameters | — | `default_parameters` object | **Not captured** |
| Input/output modalities | Boolean flags per type | `input_modalities`/`output_modalities` | Partial |
| Deprecation/expiration | Docs (retirement dates) | `expiration_date` | **Not captured** |
| Rate limits | By tier (docs) | `per_request_limits` | **Not captured** |
| Cache pricing | — | `pricing.input_cache_read/write` | **Not captured** |
| Audio/image/video pricing | — | Separate pricing tiers | **Not captured** |
| Instruct type | — | `architecture.instruct_type` | **Not captured** |
| Reasoning effort levels | `capabilities.effort` | — | **Not captured** |

---

## Goals

1. Replace the 8-field `ExtractedMetadata` with a comprehensive `ModelCard` that captures everything providers publish.
2. Build per-provider adapters that deterministically map API responses to the unified ModelCard schema.
3. Store the full ModelCard in `ModelProfile` so the routing pipeline has authoritative data.
4. Classify models by type (chat, reasoning, embedding, image_gen, etc.) to prevent cross-type contamination in routing.
5. Demote family baselines from primary source to last-resort fallback.
6. Detect metadata drift when provider data changes between discoveries.
7. Treat null as "unknown" throughout — never as zero or supported.

## Non-Goals

1. Rate limit enforcement or request shaping (EP-INF-004).
2. Prompt formatting or parameter construction (EP-INF-005).
3. Changes to golden tests or evaluation scoring (EP-INF-006).
4. Changes to the routing pipeline ranking logic — the pipeline already consumes `EndpointManifest`; this epic fills it with real data.
5. Shadow mode or production validation gates (production deployment concern, not dev).

---

## Section 1: ModelCard Schema

The `ModelCard` is the canonical representation of what the platform knows about a specific model at a specific provider. Every field is either provider-sourced, curated from documentation, or explicitly marked as inferred.

```typescript
interface ModelCard {
  // ── Identity ───────────────────────────────────────────────────
  providerId: string;
  modelId: string;
  displayName: string;
  description: string;
  createdAt: Date | null;

  // ── Classification ─────────────────────────────────────────────
  modelFamily: string;           // "gpt-4o", "claude-opus-4", "llama-3.1"
  modelClass: ModelClass;

  // ── Context & Output Limits ────────────────────────────────────
  maxInputTokens: number | null;
  maxOutputTokens: number | null;

  // ── Modalities ─────────────────────────────────────────────────
  inputModalities: string[];     // ["text", "image", "audio", "file", "video"]
  outputModalities: string[];    // ["text", "image", "audio", "tool_call", "embeddings"]

  // ── Capabilities (boolean declarations from provider) ──────────
  capabilities: ModelCardCapabilities;

  // ── Pricing (multi-tier, per million tokens unless noted) ──────
  pricing: ModelCardPricing;

  // ── Provider Parameters ────────────────────────────────────────
  supportedParameters: string[];
  defaultParameters: Record<string, unknown> | null;
  instructType: string | null;

  // ── Knowledge ──────────────────────────────────────────────────
  trainingDataCutoff: string | null;
  reliableKnowledgeCutoff: string | null;

  // ── Lifecycle ──────────────────────────────────────────────────
  status: "active" | "degraded" | "deprecated" | "retired" | "preview";
  deprecationDate: Date | null;
  retiredAt: Date | null;

  // ── Rate Limits (seed for EP-INF-004) ──────────────────────────
  perRequestLimits: {
    promptTokens: number | null;
    completionTokens: number | null;
  } | null;

  // ── Provenance ─────────────────────────────────────────────────
  metadataSource: "api" | "curated" | "inferred";
  metadataConfidence: "high" | "medium" | "low";
  lastMetadataRefresh: Date;
  rawMetadataHash: string;

  // ── Routing Dimension Scores (retained, demoted) ───────────────
  dimensionScores: ModelCardDimensionScores;
  dimensionScoreSource: "provider" | "family_baseline" | "evaluated" | "production";
}

type ModelClass =
  | "chat"
  | "reasoning"
  | "embedding"
  | "image_gen"
  | "audio"
  | "video"
  | "moderation"
  | "speech"
  | "realtime"
  | "code";

interface ModelCardCapabilities {
  toolUse: boolean | null;
  structuredOutput: boolean | null;
  streaming: boolean | null;
  batch: boolean | null;
  citations: boolean | null;
  codeExecution: boolean | null;
  imageInput: boolean | null;
  pdfInput: boolean | null;
  thinking: boolean | null;
  adaptiveThinking: boolean | null;
  contextManagement: boolean | null;
  promptCaching: boolean | null;
  effortLevels: string[] | null;   // ["low","medium","high","max"]
}

interface ModelCardPricing {
  inputPerMToken: number | null;
  outputPerMToken: number | null;
  cacheReadPerMToken: number | null;
  cacheWritePerMToken: number | null;
  imageInputPerMToken: number | null;
  imageOutputPerUnit: number | null;
  audioInputPerMToken: number | null;
  audioOutputPerMToken: number | null;
  reasoningPerMToken: number | null;
  requestFixed: number | null;
  webSearchPerRequest: number | null;
  discount: number | null;
}

interface ModelCardDimensionScores {
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  custom: Record<string, number>;
}
```

### Key Design Decisions

1. **Capabilities are booleans, not scores.** "Does this model support tool use?" is a yes/no from the provider. "How good is it at tool use?" is a score from evaluation. The current system conflates these.

2. **Pricing is multi-tier.** The current 2-field pricing misses cache pricing, reasoning tokens, image/audio pricing, per-request fees, and discounts. Cost-per-success calculation (EP-INF-005) needs the full picture.

3. **Model class is a hard routing filter.** Embedding models never compete with chat models. This eliminates the "everything in one pool" problem.

4. **Null means unknown, not zero.** Unknown pricing must not make models appear free. Unknown capabilities must not satisfy hard requirements.

5. **Dimension scores are retained but demoted.** Still needed for the current routing pipeline until EP-INF-005 replaces them with cost-per-success. Their source is tracked — "provider" and "evaluated" are authoritative, "family_baseline" is secondary.

6. **Metadata source tracks provenance.** "api" = parsed from provider API. "curated" = from provider docs. "inferred" = family baseline or heuristic. Replaces the vague `profileSource`.

---

## Section 2: Provider Adapters

The current `metadata-extractor.ts` is a single function with format-sniffing. This is replaced by a per-provider adapter that maps each provider's API response to the ModelCard schema.

### Adapter Interface

```typescript
interface ProviderAdapter {
  providerId: string;

  /** Parse raw API response into discovered models */
  parseDiscoveryResponse(json: unknown): DiscoveredModel[];

  /** Extract a ModelCard from a single model's raw metadata */
  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard;

  /** Classify the model type */
  classifyModel(modelId: string, rawMetadata: unknown): ModelClass;

  /** Confidence level based on how much the provider API actually tells us */
  metadataConfidence(rawMetadata: unknown): "high" | "medium" | "low";
}
```

### Anthropic Adapter

Richest capabilities data of any provider. The Models API (`GET /v1/models`) returns a structured `capabilities` object.

| ModelCard Field | Source | API Mapping |
|---|---|---|
| maxInputTokens | API | `model.max_input_tokens` |
| maxOutputTokens | API | `model.max_tokens` |
| capabilities.structuredOutput | API | `capabilities.structured_outputs.supported` |
| capabilities.batch | API | `capabilities.batch.supported` |
| capabilities.citations | API | `capabilities.citations.supported` |
| capabilities.codeExecution | API | `capabilities.code_execution.supported` |
| capabilities.imageInput | API | `capabilities.image_input.supported` |
| capabilities.pdfInput | API | `capabilities.pdf_input.supported` |
| capabilities.thinking | API | `capabilities.thinking.supported` |
| capabilities.adaptiveThinking | API | `capabilities.thinking.types.adaptive.supported` |
| capabilities.effortLevels | API | Collect keys from `capabilities.effort` where `.supported === true` |
| capabilities.contextManagement | API | `capabilities.context_management.supported` |
| pricing | Curated | From pricing page — not in API response |
| trainingDataCutoff | Curated | From model overview page |
| modelClass | Inferred | All current Anthropic models are "chat" |
| metadataConfidence | — | "high" |

**Implementation note:** Discovery should call `GET /v1/models` (which returns the capabilities object) instead of or in addition to the current `/models` connectivity probe.

### OpenRouter Adapter

Widest model coverage, good structured metadata.

| ModelCard Field | Source | API Mapping |
|---|---|---|
| maxInputTokens | API | `context_length` |
| maxOutputTokens | API | `top_provider.max_completion_tokens` |
| inputModalities | API | `architecture.input_modalities` |
| outputModalities | API | `architecture.output_modalities` |
| capabilities.toolUse | API | `"tools" in supported_parameters` |
| capabilities.structuredOutput | API | `"structured_outputs" in supported_parameters` |
| capabilities.streaming | API | `"stream" in supported_parameters` |
| pricing.inputPerMToken | API | `pricing.prompt` (× 1e6 for per-M conversion) |
| pricing.outputPerMToken | API | `pricing.completion` (× 1e6) |
| pricing.cacheReadPerMToken | API | `pricing.input_cache_read` (× 1e6) |
| pricing.cacheWritePerMToken | API | `pricing.input_cache_write` (× 1e6) |
| pricing.imageInputPerMToken | API | `pricing.image_token` (× 1e6) |
| pricing.imageOutputPerUnit | API | `pricing.image_output` |
| pricing.audioInputPerMToken | API | `pricing.audio` (× 1e6) |
| pricing.audioOutputPerMToken | API | `pricing.audio_output` (× 1e6) |
| pricing.reasoningPerMToken | API | `pricing.internal_reasoning` (× 1e6) |
| pricing.requestFixed | API | `pricing.request` |
| pricing.webSearchPerRequest | API | `pricing.web_search` |
| pricing.discount | API | `pricing.discount` |
| supportedParameters | API | `supported_parameters` |
| defaultParameters | API | `default_parameters` |
| instructType | API | `architecture.instruct_type` |
| deprecationDate | API | `expiration_date` |
| perRequestLimits | API | `per_request_limits` |
| metadataConfidence | — | "high" for pricing/context, "medium" for capabilities |

### OpenAI Adapter

Limited metadata from API — the `/models` endpoint returns only `id`, `object`, `created`, `owned_by`.

| ModelCard Field | Source | Notes |
|---|---|---|
| maxInputTokens | Curated | Not in API response |
| capabilities.* | Curated | Not in API response |
| pricing | Curated | Not in API response |
| modelClass | Inferred | From model ID pattern: `gpt-*` → chat, `o1-*`/`o3-*`/`o4-*` → reasoning, `text-embedding-*` → embedding, `dall-e-*` → image_gen, `tts-*` → speech, `whisper-*` → audio, `omni-moderation-*` → moderation |
| metadataConfidence | — | "low" for API-only, "medium" with curation |

**Cross-reference opportunity:** When a model is available through both OpenAI direct and OpenRouter, OpenRouter's metadata is richer. The adapter can merge: OpenAI API for identity/availability + OpenRouter for capabilities/pricing when the same `modelId` is found.

### Gemini Adapter

Moderate metadata from API.

| ModelCard Field | Source | API Mapping |
|---|---|---|
| maxInputTokens | API | `inputTokenLimit` |
| maxOutputTokens | API | `outputTokenLimit` |
| capabilities.toolUse | API | `"generateContent" in supportedGenerationMethods` |
| modelClass | Inferred | `"embedContent" in supportedGenerationMethods` → embedding, else chat |
| pricing | Curated | Not in API response |
| metadataConfidence | — | "medium" |

### Ollama Adapter

Minimal metadata — local models with no pricing and unreliable capability data.

| ModelCard Field | Source | Notes |
|---|---|---|
| maxInputTokens | Inferred | From model family pattern (llama3.1 → 128k) |
| pricing | Known | All zeros — local inference |
| capabilities.* | Inferred | From model family (llama3.1 supports tools, etc.) |
| modelClass | Inferred | From model ID pattern and family |
| metadataConfidence | — | "low" |

### Model Classification Rules

```typescript
function classifyModel(
  modelId: string,
  modalities: { input: string[]; output: string[] },
): ModelClass {
  const out = modalities.output;
  if (out.includes("embeddings") && out.length === 1) return "embedding";
  if (out.includes("image") && !out.includes("text")) return "image_gen";
  if (out.includes("audio") && !out.includes("text")) return "speech";
  if (out.includes("video")) return "video";

  // ID-based fallbacks for providers with poor modality data
  if (/^(o1|o3|o4|deepseek-r1)/i.test(modelId)) return "reasoning";
  if (/^text-embedding/i.test(modelId)) return "embedding";
  if (/^dall-e/i.test(modelId)) return "image_gen";
  if (/^tts-/i.test(modelId)) return "speech";
  if (/^whisper/i.test(modelId)) return "audio";
  if (/^omni-moderation/i.test(modelId)) return "moderation";

  return "chat";
}
```

---

## Section 3: Discovery Pipeline Change

### Current Flow

```
Provider API → parseModelsResponse() → store DiscoveredModel(rawMetadata)
                                      → LLM-based profiling (generateModelProfile)
                                      → store ModelProfile(guessed fields)
```

### New Flow

```
Provider API → parseModelsResponse() → store DiscoveredModel(rawMetadata)
                                      → providerAdapter.extractModelCard(rawMetadata)
                                      → providerAdapter.classifyModel()
                                      → fill gaps from family baselines (fallback only)
                                      → store ModelProfile(structured ModelCard fields)
                                      → compute rawMetadataHash for drift detection
```

**Key change:** LLM-based profiling (`generateModelProfile`) is replaced by deterministic adapter extraction. No LLM call needed to know that `claude-opus-4-6` supports structured output — the API says so. Faster, cheaper, more reliable, auditable.

LLM-based profiling is retained only for generating `friendlyName` and `summary` for display purposes — fields that benefit from natural language but don't affect routing.

### Priority Cascade for Field Population

```
1. Provider API response  (metadataSource: "api",      confidence: "high")
2. Curated provider docs  (metadataSource: "curated",   confidence: "medium")
3. Family baseline match  (metadataSource: "inferred",  confidence: "low")
4. Safe defaults          (metadataSource: "inferred",  confidence: "low")
```

Each level only fills fields left null by the level above.

---

## Section 4: Database Migration

### Migration Strategy

**Phase 1: Add new columns alongside old ones.** No breaking changes. Old columns still populated, new columns populated by adapters. Both coexist.

**Phase 2: Backfill.** Run provider adapters against all existing `DiscoveredModel.rawMetadata` to populate new columns for already-discovered models. Inline in the same Prisma migration.

**Phase 3: Routing reads new columns.** Update `loadEndpointManifests()` to read structured fields. `EndpointManifest` gains ModelCard fields. Pipeline gets richer data with zero logic changes.

**Phase 4: Remove deprecated columns.** Later migration (EP-INF-005 timeframe) drops old freetext columns once nothing reads them.

### New and Modified Columns on ModelProfile

**New columns:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `modelFamily` | String? | null | Model family grouping |
| `modelClass` | String | "chat" | Hard routing filter |
| `maxInputTokens` | Int? | null | Replaces `maxContextTokens` naming |
| `inputModalities` | Json | `["text"]` | Structured input modality list |
| `outputModalities` | Json | `["text"]` | Structured output modality list |
| `capabilities` | Json | `{}` | `ModelCardCapabilities` object |
| `pricing` | Json | `{}` | `ModelCardPricing` object |
| `supportedParameters` | Json | `[]` | Provider parameter list |
| `defaultParameters` | Json? | null | Provider default parameter values |
| `instructType` | String? | null | OpenRouter instruct type |
| `trainingDataCutoff` | String? | null | Training data date |
| `reliableKnowledgeCutoff` | String? | null | Reliable knowledge date |
| `deprecationDate` | DateTime? | null | Provider deprecation date |
| `perRequestLimits` | Json? | null | Seed rate limit data |
| `metadataSource` | String | "inferred" | "api"\|"curated"\|"inferred" |
| `metadataConfidence` | String | "low" | "high"\|"medium"\|"low" |
| `lastMetadataRefresh` | DateTime? | null | Last adapter run time |
| `rawMetadataHash` | String? | null | SHA-256 for drift detection |

**Deprecated columns (retained in Phase 1, removed in Phase 4):**

| Column | Replaced By |
|---|---|
| `capabilityTier` | `modelClass` + `capabilities` |
| `costTier` | `pricing` object |
| `bestFor` | `capabilities` + `modelClass` |
| `avoidFor` | `capabilities` + `modelClass` |
| `contextWindow` (String) | `maxInputTokens` (Int) |
| `speedRating` | Actual latency measurements |
| `supportsToolUse` (Boolean) | `capabilities.toolUse` |
| `codingCapability` | `codegen` score + capabilities |
| `instructionFollowing` (String) | `instructionFollowingScore` (Int) |
| `inputPricePerMToken` | `pricing.inputPerMToken` |
| `outputPricePerMToken` | `pricing.outputPerMToken` |
| `supportedModalities` | `inputModalities` + `outputModalities` |

---

## Section 5: Family Baseline Demotion

### Current Role

`family-baselines.ts` is the primary source of dimension scores. ~20 hardcoded model-family patterns assign capability scores based on name matching. These scores drive routing decisions.

### New Role

Family baselines become the last-resort fallback for models where:
- The provider API returns no capability data (e.g., Ollama)
- The model is too new to have been seen by the adapter
- No curated data has been entered

### What Changes

- `family-baselines.ts` retained as-is (no code deletion)
- Called only when the adapter returns null for a field
- `metadataSource` and `metadataConfidence` distinguish which path filled each value
- Over time, as adapters get richer, baselines fire less often

### Routing Implications

- `metadataConfidence: "high"` — provider-declared capabilities, routing trusts them
- `metadataConfidence: "low"` — inferred capabilities, routing is conservative (unknowns disqualify for hard requirements, per adaptive routing doc principle)

---

## Section 6: Drift Detection

When discovery runs and `rawMetadata` has changed (detected by `rawMetadataHash` comparison):

1. Re-run the provider adapter to produce an updated ModelCard
2. Diff old vs. new ModelCard
3. Log material changes as drift events:
   - **Pricing change** → log, update immediately
   - **Capability added** → log, update immediately
   - **Capability removed** → log, flag for review (may affect active recipes in EP-INF-005)
   - **Context window changed** → log, update immediately
   - **Model deprecated** → log, set `deprecationDate`, alert operator
4. Update `lastMetadataRefresh` and `rawMetadataHash`

This is upstream drift detection — catching provider changes before they affect routing. Complements the behavioral drift detection in `eval-runner.ts` which catches score degradation from golden test results.

---

## Section 7: Integration with Routing Pipeline

### EndpointManifest Expansion

The `EndpointManifest` type gains new fields from ModelCard. The existing fields are preserved for backward compatibility.

New fields added to EndpointManifest:
- `modelClass` — hard filter in `filterHard()`
- `modelFamily`
- `inputModalities` / `outputModalities`
- `capabilities: ModelCardCapabilities`
- `pricing: ModelCardPricing`
- `supportedParameters`
- `deprecationDate`
- `metadataSource` / `metadataConfidence`
- `perRequestLimits`

Backward-compatible derivations in `loadEndpointManifests()`:
- `supportsToolUse = capabilities.toolUse ?? false`
- `supportsStructuredOutput = capabilities.structuredOutput ?? false`
- `costPerOutputMToken = pricing.outputPerMToken`

### Immediate Routing Wins (No Pipeline Logic Changes)

1. **`filterHard()` gains modelClass filter.** One line: if task requires chat, exclude non-chat models. Fixes "embeddings in the chat pool."
2. **`filterHard()` gains modality filter.** If task needs image input, exclude models where `capabilities.imageInput !== true`.
3. **Null pricing is no longer zero.** Multi-tier pricing populated, cost calculations become real.
4. **Deprecation awareness.** `filterHard()` can exclude models approaching deprecation.

### No Changes Required To

- `scoring.ts` — still reads the same dimension score fields
- `pipeline.ts` — still runs filter → score → rank → select
- `fallback.ts` — still dispatches with fallback chain
- `explain.ts` — still formats routing decisions

---

## Section 8: Testing Strategy

### Per-Adapter Unit Tests

One test file per provider with real API response fixtures:

```
adapter-anthropic.test.ts
adapter-openrouter.test.ts
adapter-openai.test.ts
adapter-gemini.test.ts
adapter-ollama.test.ts
```

Per adapter, test:
- Parses real API response fixture → produces correct ModelCard
- Handles missing/null fields gracefully
- Classifies models correctly (embedding ≠ chat ≠ image_gen)
- Computes correct metadataConfidence
- Computes deterministic rawMetadataHash
- Handles unknown model IDs (falls through to family baseline → safe defaults)

**Fixtures:** Real provider API responses stored as JSON in `__fixtures__/` directory, version-controlled.

### Integration Tests

- Discovery → adapter → ModelProfile stored correctly (end-to-end)
- Re-discovery with changed metadata → drift event logged, ModelProfile updated
- Re-discovery with unchanged metadata → no-op (hash match)
- `loadEndpointManifests()` returns manifests with new fields populated
- `filterHard()` excludes non-chat models from chat routing
- `filterHard()` excludes models missing required capabilities
- Backward compatibility: existing pipeline tests pass unchanged

### Not Tested in This Epic

- Rate limit enforcement (EP-INF-004)
- Recipe selection or cost-per-success ranking (EP-INF-005)
- Champion/challenger promotion (EP-INF-006)
- Golden test scoring changes (EP-INF-006)

---

## Section 9: Relationship to Subsequent Epics

| This Epic Delivers | Next Epic Consumes It |
|---|---|
| `capabilities` booleans | EP-INF-005: feasibility filtering in RequestContract matching |
| `pricing` multi-tier object | EP-INF-005: cost-per-success calculation |
| `supportedParameters` array | EP-INF-005: ExecutionRecipe parameter validation |
| `perRequestLimits` | EP-INF-004: seed data for rate limit tracking |
| `deprecationDate` | EP-INF-004: capacity planning |
| `modelClass` hard filter | EP-INF-005: RequestContract.modality matching |
| `metadataConfidence` | EP-INF-006: decide whether golden tests needed (high → skip, low → eval) |
| Drift detection events | EP-INF-006: trigger recipe re-evaluation |

### Epic Dependency Chain

```
EP-INF-003 (this spec)    → Provider Model Registry
    ↓
EP-INF-004                → Rate Limits & Capacity Management
    ↓
EP-INF-005                → Contract-Based Routing (RequestContract, ExecutionRecipe, cost-per-success)
    ↓
EP-INF-006                → Adaptive Loop & Evaluation Realignment (champion/challenger, golden test demotion)
```

Each epic is independently valuable. Each builds on the previous.

---

## Section 10: EP-INF-004 through EP-INF-006 Summaries

These epics will receive their own full specs when reached. The summaries below establish scope boundaries and dependencies.

### EP-INF-004: Rate Limits & Capacity Management

**Problem:** Rate limits are discovered by hitting them.

**Delivers:**
1. Declarative rate limit registry per model — seeded from provider APIs and refined by observed 429 patterns
2. Pre-flight capacity check before dispatching requests
3. Token budget tracking — per-model sliding-window counters (RPM, TPM, RPD), runtime state
4. Backpressure signals to routing — capacity near limits → fitness penalty; at limits → hard exclude
5. Graceful degradation — "throttled" status between active and degraded

**Does not deliver:** Request queuing, cost budgets, multi-tenant isolation.

**Depends on:** EP-INF-003 (ModelCard provides seed rate limit data)

### EP-INF-005: Contract-Based Routing

**Problem:** Routing uses regex task classification and weighted dimension scores. The adaptive routing design (2026-03-20) defines a richer model.

**Delivers:**
1. `RequestContract` — replaces `TaskRequirementContract` with modality, interaction mode, reasoning depth, budget class, residency policy
2. Contract inference — deterministic extraction from route context, LLM-assisted only when needed
3. `ExecutionRecipe` table — per provider/model/contract-family invocation strategies
4. Cost-per-success ranking — replaces weighted dimension scoring
5. `RoutedExecutionPlan` output — concrete execution plan, not provider preference hint

**Does not deliver:** Champion/challenger exploration, recipe mutation, automated improvement.

**Depends on:** EP-INF-003 (capabilities, pricing, parameters), EP-INF-004 (capacity signals)

### EP-INF-006: Adaptive Loop & Evaluation Realignment

**Problem:** Golden tests measure what providers declare. Feedback is fragmented. No mechanism for the system to learn over time.

**Delivers:**
1. `RouteOutcome` recording — unified outcome record per execution
2. `RecipePerformance` table — per-recipe stats feeding ranking
3. Champion/challenger system — bounded exploration, promotion gates, anti-thrash
4. Golden test realignment — from "primary authority" to "validation of provider claims"
5. Family baseline deprecation — no longer needed for most models
6. Anti-thrash guardrails — max one promotion per 24h, minimum sample size, cooldown, emergency freeze

**Depends on:** EP-INF-005 (ExecutionRecipe, RequestContract, cost-per-success)

---

## Appendix A: Provider Documentation Sources

These sources inform the adapter field mappings and should be referenced during implementation:

- Anthropic Models API: `GET /v1/models` — capabilities object, token limits
- Anthropic model overview: pricing, training cutoffs, feature comparison tables
- OpenRouter `GET /api/v1/models` — full model metadata including 12+ pricing tiers
- OpenRouter rate limits documentation
- OpenAI `/v1/models` — minimal metadata (id, created, owned_by only)
- Gemini `models.list` — inputTokenLimit, outputTokenLimit, supportedGenerationMethods
- Ollama `/api/tags` — model names and basic info only

## Appendix B: Relationship to Adaptive Routing Design

The [2026-03-20-adaptive-model-routing-design.md](2026-03-20-adaptive-model-routing-design.md) is the master vision document covering EP-INF-003 through EP-INF-006. That document assumes a rich model registry exists but does not design it. This spec fills that gap.

Specifically, that document's:
- Section 1 (Routing Target) — derived from the ModelCard this spec produces
- Section 3 (Feasibility Filter) — consumes capabilities and modelClass from this spec
- Section 4 (Provider-Guided Execution) — uses supportedParameters and defaultParameters from this spec
- Section 6 (Drift) — uses rawMetadataHash and drift detection from this spec
