# EP-INF-003: Provider Model Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8-field metadata extractor with a comprehensive ModelCard system that captures everything providers publish about their models, fixing model classification, pricing gaps, and the endpoint identity bug.

**Architecture:** Per-provider adapter pattern. Each adapter deterministically maps a provider's raw API response to a unified `ModelCard` schema. Adapters run at discovery time and persist structured data to `ModelProfile`. The routing pipeline reads pre-computed data — no per-request metadata parsing.

**Tech Stack:** TypeScript, Prisma (SQLite), Vitest, Node.js crypto (SHA-256)

**Spec:** `docs/superpowers/specs/2026-03-20-provider-model-registry-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/model-card-types.ts` | ModelCard, ModelCardCapabilities, ModelCardPricing, ModelClass types |
| `apps/web/lib/routing/adapter-interface.ts` | ProviderAdapter interface |
| `apps/web/lib/routing/adapter-anthropic.ts` | Anthropic adapter (Models API capabilities) |
| `apps/web/lib/routing/adapter-openrouter.ts` | OpenRouter adapter (30+ field extraction) |
| `apps/web/lib/routing/adapter-openai.ts` | OpenAI adapter (minimal API + classification) |
| `apps/web/lib/routing/adapter-gemini.ts` | Gemini adapter (moderate metadata) |
| `apps/web/lib/routing/adapter-ollama.ts` | Ollama adapter (minimal, inferred) |
| `apps/web/lib/routing/model-classifier.ts` | `classifyModel()` — modality + ID-based classification |
| `apps/web/lib/routing/metadata-hash.ts` | Deterministic JSON hash for drift detection |
| `apps/web/lib/routing/adapter-registry.ts` | Maps providerId → adapter, orchestrates extraction pipeline |
| `apps/web/lib/routing/__fixtures__/anthropic-models-response.json` | Real Anthropic API fixture |
| `apps/web/lib/routing/__fixtures__/openrouter-models-response.json` | Real OpenRouter API fixture |
| `apps/web/lib/routing/__fixtures__/openai-models-response.json` | Real OpenAI API fixture |
| `apps/web/lib/routing/__fixtures__/gemini-models-response.json` | Real Gemini API fixture |
| `apps/web/lib/routing/__fixtures__/ollama-tags-response.json` | Real Ollama API fixture |
| `apps/web/lib/routing/model-classifier.test.ts` | Classification tests |
| `apps/web/lib/routing/adapter-anthropic.test.ts` | Anthropic adapter tests |
| `apps/web/lib/routing/adapter-openrouter.test.ts` | OpenRouter adapter tests |
| `apps/web/lib/routing/adapter-openai.test.ts` | OpenAI adapter tests |
| `apps/web/lib/routing/adapter-gemini.test.ts` | Gemini adapter tests |
| `apps/web/lib/routing/adapter-ollama.test.ts` | Ollama adapter tests |
| `apps/web/lib/routing/adapter-registry.test.ts` | Registry + hash + drift tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` (line 763) | Add ~18 new columns to ModelProfile |
| `apps/web/lib/routing/types.ts` (line 12) | Expand EndpointManifest with ModelCard fields |
| `apps/web/lib/routing/loader.ts` (line 19) | Update loadEndpointManifests() — fix id bug, read new fields |
| `apps/web/lib/routing/pipeline.ts` (line 115) | Add modelClass + modality filters to getExclusionReason() |
| `apps/web/lib/ai-provider-internals.ts` (line 246) | Replace extractModelMetadata call with adapter pipeline |
| `apps/web/lib/ai-provider-types.ts` (line 182) | Remove parseModelsResponse() (moved to adapters) |
| `apps/web/lib/routing/index.ts` | Export new types and adapter registry |

### Unchanged Files (Verify Backward Compatibility)

| File | Why unchanged |
|---|---|
| `apps/web/lib/routing/scoring.ts` | Still reads same dimension score fields |
| `apps/web/lib/routing/fallback.ts` | Still dispatches with fallback chain |
| `apps/web/lib/routing/explain.ts` | Still formats routing decisions |
| `apps/web/lib/routing/golden-tests.ts` | Eval realignment deferred to EP-INF-006 |
| `apps/web/lib/routing/eval-runner.ts` | No changes in this epic |
| `apps/web/lib/routing/family-baselines.ts` | Retained as fallback, no code changes |

---

## Task 1: ModelCard Types

**Files:**
- Create: `apps/web/lib/routing/model-card-types.ts`

- [ ] **Step 1: Create the type definitions file**

```typescript
// apps/web/lib/routing/model-card-types.ts

/**
 * EP-INF-003: Canonical model metadata schema.
 * Captures everything providers publish about their models.
 */

export type ModelClass =
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

export interface ModelCardCapabilities {
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
  effortLevels: string[] | null;
}

export interface ModelCardPricing {
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
  /** OpenRouter discount multiplier (0.0-1.0, e.g., 0.5 = 50% off) */
  discount: number | null;
}

export interface ModelCardDimensionScores {
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  custom: Record<string, number>;
}

export interface ModelCard {
  providerId: string;
  modelId: string;
  displayName: string;
  description: string;
  createdAt: Date | null;

  modelFamily: string | null;
  modelClass: ModelClass;

  maxInputTokens: number | null;
  maxOutputTokens: number | null;

  inputModalities: string[];
  outputModalities: string[];

  capabilities: ModelCardCapabilities;
  pricing: ModelCardPricing;

  supportedParameters: string[];
  defaultParameters: Record<string, unknown> | null;
  instructType: string | null;

  trainingDataCutoff: string | null;
  reliableKnowledgeCutoff: string | null;

  status: "active" | "degraded" | "deprecated" | "retired" | "preview";
  deprecationDate: Date | null;
  retiredAt: Date | null;

  perRequestLimits: {
    promptTokens: number | null;
    completionTokens: number | null;
  } | null;

  metadataSource: "api" | "curated" | "inferred";
  metadataConfidence: "high" | "medium" | "low";
  lastMetadataRefresh: Date;
  rawMetadataHash: string;

  dimensionScores: ModelCardDimensionScores;
  dimensionScoreSource: "provider" | "family_baseline" | "evaluated" | "production";
}

/** Empty capabilities — all null. */
export const EMPTY_CAPABILITIES: ModelCardCapabilities = {
  toolUse: null,
  structuredOutput: null,
  streaming: null,
  batch: null,
  citations: null,
  codeExecution: null,
  imageInput: null,
  pdfInput: null,
  thinking: null,
  adaptiveThinking: null,
  contextManagement: null,
  promptCaching: null,
  effortLevels: null,
};

/** Empty pricing — all null. */
export const EMPTY_PRICING: ModelCardPricing = {
  inputPerMToken: null,
  outputPerMToken: null,
  cacheReadPerMToken: null,
  cacheWritePerMToken: null,
  imageInputPerMToken: null,
  imageOutputPerUnit: null,
  audioInputPerMToken: null,
  audioOutputPerMToken: null,
  reasoningPerMToken: null,
  requestFixed: null,
  webSearchPerRequest: null,
  discount: null,
};

/** Default dimension scores — neutral 50 for all. */
export const DEFAULT_DIMENSION_SCORES: ModelCardDimensionScores = {
  reasoning: 50,
  codegen: 50,
  toolFidelity: 50,
  instructionFollowing: 50,
  structuredOutput: 50,
  conversational: 50,
  contextRetention: 50,
  custom: {},
};
```

- [ ] **Step 2: Verify types compile**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors related to model-card-types

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/model-card-types.ts
git commit -m "feat(routing): EP-INF-003 ModelCard type definitions"
```

---

## Task 2: Model Classifier

**Files:**
- Create: `apps/web/lib/routing/model-classifier.ts`
- Create: `apps/web/lib/routing/model-classifier.test.ts`

- [ ] **Step 1: Write failing tests for classification**

```typescript
// apps/web/lib/routing/model-classifier.test.ts
import { describe, expect, it } from "vitest";
import { classifyModel } from "./model-classifier";

describe("classifyModel", () => {
  // Modality-based classification
  it("classifies embedding-only output as embedding", () => {
    expect(classifyModel("text-embedding-3-small", {
      input: ["text"], output: ["embeddings"],
    })).toBe("embedding");
  });

  it("classifies image-only output as image_gen", () => {
    expect(classifyModel("dall-e-3", {
      input: ["text"], output: ["image"],
    })).toBe("image_gen");
  });

  it("classifies audio-only output as speech", () => {
    expect(classifyModel("tts-1", {
      input: ["text"], output: ["audio"],
    })).toBe("speech");
  });

  it("classifies video output as video", () => {
    expect(classifyModel("sora-2", {
      input: ["text"], output: ["video"],
    })).toBe("video");
  });

  // ID-based fallbacks (for providers with minimal modality data)
  it("classifies o1-* as reasoning from ID", () => {
    expect(classifyModel("o1-preview", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies o3-mini as reasoning from ID", () => {
    expect(classifyModel("o3-mini", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies o4-mini as reasoning from ID", () => {
    expect(classifyModel("o4-mini", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies deepseek-r1 as reasoning from ID", () => {
    expect(classifyModel("deepseek-r1", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies text-embedding-* as embedding from ID", () => {
    expect(classifyModel("text-embedding-ada-002", {
      input: ["text"], output: ["text"],
    })).toBe("embedding");
  });

  it("classifies dall-e-* as image_gen from ID", () => {
    expect(classifyModel("dall-e-2", {
      input: ["text"], output: ["text"],
    })).toBe("image_gen");
  });

  it("classifies tts-* as speech from ID", () => {
    expect(classifyModel("tts-1-hd", {
      input: ["text"], output: ["text"],
    })).toBe("speech");
  });

  it("classifies whisper-* as audio from ID", () => {
    expect(classifyModel("whisper-1", {
      input: ["text"], output: ["text"],
    })).toBe("audio");
  });

  it("classifies omni-moderation-* as moderation from ID", () => {
    expect(classifyModel("omni-moderation-latest", {
      input: ["text"], output: ["text"],
    })).toBe("moderation");
  });

  it("classifies codex-* as code from ID", () => {
    expect(classifyModel("codex-mini-latest", {
      input: ["text"], output: ["text"],
    })).toBe("code");
  });

  // Default to chat
  it("defaults to chat for standard text models", () => {
    expect(classifyModel("gpt-4o", {
      input: ["text"], output: ["text"],
    })).toBe("chat");
  });

  it("defaults to chat for claude models", () => {
    expect(classifyModel("claude-opus-4-6", {
      input: ["text"], output: ["text"],
    })).toBe("chat");
  });

  it("defaults to chat for multimodal text+image input", () => {
    expect(classifyModel("gpt-4o", {
      input: ["text", "image"], output: ["text"],
    })).toBe("chat");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/routing/model-classifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/web/lib/routing/model-classifier.ts
import type { ModelClass } from "./model-card-types";

/**
 * EP-INF-003: Classify a model by type based on modalities and ID patterns.
 * Modality-based rules take priority over ID-based fallbacks.
 */
export function classifyModel(
  modelId: string,
  modalities: { input: string[]; output: string[] },
): ModelClass {
  const out = modalities.output;

  // Modality-based (authoritative when available)
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
  if (/^codex/i.test(modelId)) return "code";

  return "chat";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/routing/model-classifier.test.ts`
Expected: All 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/model-classifier.ts apps/web/lib/routing/model-classifier.test.ts
git commit -m "feat(routing): EP-INF-003 model classifier with TDD"
```

---

## Task 3: Metadata Hash Utility

**Files:**
- Create: `apps/web/lib/routing/metadata-hash.ts`
- Test inline with adapter-registry tests (Task 10)

- [ ] **Step 1: Write the hash utility**

```typescript
// apps/web/lib/routing/metadata-hash.ts
import { createHash } from "crypto";

/**
 * EP-INF-003: Compute deterministic SHA-256 hash of raw metadata.
 * Keys are sorted to ensure equivalent objects produce identical hashes
 * regardless of key ordering in the source JSON.
 */
export function computeMetadataHash(rawMetadata: unknown): string {
  const serialized = JSON.stringify(rawMetadata, sortReplacer);
  return createHash("sha256").update(serialized).digest("hex");
}

/** JSON.stringify replacer that sorts object keys for deterministic output. */
function sortReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/routing/metadata-hash.ts
git commit -m "feat(routing): EP-INF-003 deterministic metadata hash"
```

---

## Task 4: Adapter Interface

**Files:**
- Create: `apps/web/lib/routing/adapter-interface.ts`

- [ ] **Step 1: Write the interface**

```typescript
// apps/web/lib/routing/adapter-interface.ts
import type { ModelCard, ModelClass } from "./model-card-types";

export interface DiscoveredModelEntry {
  modelId: string;
  rawMetadata: Record<string, unknown>;
}

/**
 * EP-INF-003: Per-provider adapter that maps raw API responses to ModelCard.
 */
export interface ProviderAdapter {
  readonly providerId: string;

  /** Parse the provider's discovery API response into individual model entries. */
  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[];

  /** Extract a ModelCard from a single model's raw metadata. */
  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard;

  /** Classify the model by type. */
  classifyModel(modelId: string, rawMetadata: unknown): ModelClass;

  /** Overall confidence based on how much the provider API reveals. */
  metadataConfidence(rawMetadata: unknown): "high" | "medium" | "low";
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/routing/adapter-interface.ts
git commit -m "feat(routing): EP-INF-003 ProviderAdapter interface"
```

---

## Task 5: Capture API Response Fixtures

Before writing adapters, capture real API response fixtures. These are the foundation for all adapter tests.

**Files:**
- Create: `apps/web/lib/routing/__fixtures__/anthropic-models-response.json`
- Create: `apps/web/lib/routing/__fixtures__/openrouter-models-response.json`
- Create: `apps/web/lib/routing/__fixtures__/openai-models-response.json`
- Create: `apps/web/lib/routing/__fixtures__/gemini-models-response.json`
- Create: `apps/web/lib/routing/__fixtures__/ollama-tags-response.json`

- [ ] **Step 1: Capture Anthropic fixture**

Call the live Anthropic Models API and save the response. If no API key is available, construct a fixture based on the documented schema from `GET /v1/models`. The fixture must include at least one model with a full `capabilities` object.

**IMPORTANT:** Verify the actual field paths (`capabilities.structured_outputs.supported`, `capabilities.thinking.types.adaptive.supported`, etc.) match the live response. Update the spec if paths differ.

- [ ] **Step 2: Capture OpenRouter fixture**

Call `GET https://openrouter.ai/api/v1/models` and save 3-5 representative models (one chat, one reasoning, one embedding, one image). Ensure the fixture includes `pricing`, `supported_parameters`, `default_parameters`, `per_request_limits`, `architecture`, `top_provider`, and `expiration_date` fields.

**Verify:** Does `top_provider.max_completion_tokens` actually exist in the response? The existing extractor returns null with a comment saying it doesn't. Update the spec if incorrect.

- [ ] **Step 3: Capture OpenAI fixture**

Call `GET /v1/models` and save a sample. This will be minimal (`id`, `object`, `created`, `owned_by`). Include representatives: one `gpt-*`, one `o4-*`, one `text-embedding-*`, one `dall-e-*`, one `tts-*`.

- [ ] **Step 4: Capture Gemini fixture**

Call `GET /v1beta/models` and save a sample including `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`.

- [ ] **Step 5: Capture Ollama fixture**

Call `GET /api/tags` on a local Ollama instance. Include 2-3 models.

- [ ] **Step 6: Commit fixtures**

```bash
git add apps/web/lib/routing/__fixtures__/
git commit -m "feat(routing): EP-INF-003 provider API response fixtures"
```

---

## Task 6: OpenRouter Adapter (Richest Metadata)

Start with OpenRouter because it has the richest structured data — most fields are directly mapped.

**Files:**
- Create: `apps/web/lib/routing/adapter-openrouter.ts`
- Create: `apps/web/lib/routing/adapter-openrouter.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should load the OpenRouter fixture and verify extraction of every ModelCard field. Test:
- Full ModelCard extraction from a chat model
- Multi-tier pricing extraction (all 12 pricing fields)
- Modality extraction from `architecture.input_modalities`/`output_modalities`
- `supported_parameters` → capabilities mapping (tools, structured_outputs, stream)
- `per_request_limits` extraction
- `expiration_date` → deprecationDate mapping
- `default_parameters` extraction
- Classification of embedding vs chat vs image_gen models
- `parseDiscoveryResponse()` returns correct model count
- Missing/null fields produce null (not zero, not crash)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/routing/adapter-openrouter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OpenRouter adapter**

Key implementation details:
- `parseDiscoveryResponse()`: expects `{ data: [{ id, ... }] }` format
- Pricing conversion: multiply OpenRouter per-token string values by 1,000,000 to get per-million-tokens
- Capabilities: check `supported_parameters` array for `"tools"`, `"structured_outputs"`, `"stream"`
- Classification: use `architecture.output_modalities` with `classifyModel()`
- `metadataConfidence`: return `"high"` (OpenRouter provides comprehensive data)
- Hash: use `computeMetadataHash()` from Task 3
- Dimension scores: set to `DEFAULT_DIMENSION_SCORES` with `dimensionScoreSource: "inferred"`. Do NOT call `getBaselineForModel()` in the adapter — the registry handles the baseline cascade.
- Export: `export const openRouterAdapter: ProviderAdapter = { ... }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/routing/adapter-openrouter.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/adapter-openrouter.ts apps/web/lib/routing/adapter-openrouter.test.ts
git commit -m "feat(routing): EP-INF-003 OpenRouter adapter with TDD"
```

---

## Task 7: Anthropic Adapter

**Files:**
- Create: `apps/web/lib/routing/adapter-anthropic.ts`
- Create: `apps/web/lib/routing/adapter-anthropic.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should load the Anthropic fixture and verify:
- `max_input_tokens` → maxInputTokens, `max_tokens` → maxOutputTokens
- Full capabilities object mapping (structured_outputs, batch, citations, code_execution, image_input, pdf_input, thinking, adaptive thinking, effort levels, context_management)
- `capabilities.toolUse` set to `true` (curated, not from API)
- `capabilities.streaming` set to `true` (curated)
- `parseDiscoveryResponse()` handles `{ data: [{ id, ... }] }` format
- `modelClass` is always "chat" for Anthropic
- `metadataConfidence` is "high"
- Missing capabilities degrade gracefully (null, not crash)

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/adapter-anthropic.test.ts`

- [ ] **Step 3: Implement Anthropic adapter**

Key details:
- `parseDiscoveryResponse()`: expects `{ data: [{ id, display_name, ... }] }` format (different from current `/models` probe — this calls the Models API)
- Capabilities: map from nested `capabilities` object paths. Use optional chaining throughout since paths may not exist on older models.
- Pricing: not in API — return `EMPTY_PRICING` (curated data added later)
- `toolUse: true`, `streaming: true` — curated values for all Anthropic chat models
- Dimension scores: set to `DEFAULT_DIMENSION_SCORES` with `dimensionScoreSource: "inferred"`. Do NOT call `getBaselineForModel()` — the registry handles this.
- Export: `export const anthropicAdapter: ProviderAdapter = { ... }`

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/adapter-anthropic.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/adapter-anthropic.ts apps/web/lib/routing/adapter-anthropic.test.ts
git commit -m "feat(routing): EP-INF-003 Anthropic adapter with TDD"
```

---

## Task 8: OpenAI, Gemini, and Ollama Adapters

These three have minimal API metadata. Simpler adapters.

**Files:**
- Create: `apps/web/lib/routing/adapter-openai.ts`
- Create: `apps/web/lib/routing/adapter-openai.test.ts`
- Create: `apps/web/lib/routing/adapter-gemini.ts`
- Create: `apps/web/lib/routing/adapter-gemini.test.ts`
- Create: `apps/web/lib/routing/adapter-ollama.ts`
- Create: `apps/web/lib/routing/adapter-ollama.test.ts`

- [ ] **Step 1: Write failing tests for all three**

OpenAI tests:
- `parseDiscoveryResponse()` handles `{ data: [{ id, object, created, owned_by }] }`
- Classification from model ID: `gpt-4o` → chat, `o4-mini` → reasoning, `text-embedding-3-small` → embedding, `dall-e-3` → image_gen, `tts-1` → speech, `whisper-1` → audio, `omni-moderation-latest` → moderation
- `metadataConfidence` is "low"
- All capabilities null (nothing from API)

Gemini tests:
- `parseDiscoveryResponse()` handles `{ models: [{ name: "models/gemini-2.0-flash", ... }] }` — strips `models/` prefix
- `inputTokenLimit` → maxInputTokens, `outputTokenLimit` → maxOutputTokens
- `"generateContent" in supportedGenerationMethods` → toolUse approximation
- `"embedContent"` → embedding classification
- `metadataConfidence` is "medium"

Ollama tests:
- `parseDiscoveryResponse()` handles `{ models: [{ name: "llama3.1:latest", ... }] }`
- All pricing zero (local inference)
- `metadataConfidence` is "low"
- Family baseline integration for capabilities

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/adapter-openai.test.ts lib/routing/adapter-gemini.test.ts lib/routing/adapter-ollama.test.ts`

- [ ] **Step 3: Implement all three adapters**

Follow the same pattern as OpenRouter/Anthropic. Each adapter:
- Implements `ProviderAdapter` interface
- Uses `classifyModel()` from model-classifier.ts
- Uses `computeMetadataHash()` from metadata-hash.ts
- Uses `EMPTY_CAPABILITIES` / `EMPTY_PRICING` / `DEFAULT_DIMENSION_SCORES` defaults from model-card-types.ts
- Sets `dimensionScoreSource: "inferred"` — do NOT call `getBaselineForModel()` in adapters
- Export named singletons: `export const openAIAdapter`, `export const geminiAdapter`, `export const ollamaAdapter`

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/adapter-openai.test.ts lib/routing/adapter-gemini.test.ts lib/routing/adapter-ollama.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/adapter-openai.ts apps/web/lib/routing/adapter-openai.test.ts \
        apps/web/lib/routing/adapter-gemini.ts apps/web/lib/routing/adapter-gemini.test.ts \
        apps/web/lib/routing/adapter-ollama.ts apps/web/lib/routing/adapter-ollama.test.ts
git commit -m "feat(routing): EP-INF-003 OpenAI, Gemini, Ollama adapters with TDD"
```

---

## Task 9: Adapter Registry

Orchestrates: providerId → adapter lookup, extraction pipeline, hash computation.

**Files:**
- Create: `apps/web/lib/routing/adapter-registry.ts`
- Create: `apps/web/lib/routing/adapter-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Test:
- `getAdapter("openrouter")` returns OpenRouter adapter
- `getAdapter("anthropic")` returns Anthropic adapter (also matches `"anthropic-sub"`)
- `getAdapter("openai")` returns OpenAI adapter
- `getAdapter("gemini")` returns Gemini adapter
- `getAdapter("ollama")` returns Ollama adapter
- `getAdapter("unknown-provider")` returns a generic fallback adapter
- `extractModelCardWithFallback()` calls adapter, then fills gaps from family baselines
- `extractModelCardWithFallback()` produces a fully-populated `dimensionScores` (no nulls)
- Hash is deterministic: same input → same hash, different key order → same hash
- Hash changes when metadata changes

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/adapter-registry.test.ts`

- [ ] **Step 3: Implement registry**

```typescript
// apps/web/lib/routing/adapter-registry.ts
import type { ProviderAdapter } from "./adapter-interface";
import type { ModelCard } from "./model-card-types";
import { DEFAULT_DIMENSION_SCORES } from "./model-card-types";
import { getBaselineForModel } from "./family-baselines";
import { computeMetadataHash } from "./metadata-hash";
import { anthropicAdapter } from "./adapter-anthropic";
import { openRouterAdapter } from "./adapter-openrouter";
import { openAIAdapter } from "./adapter-openai";
import { geminiAdapter } from "./adapter-gemini";
import { ollamaAdapter } from "./adapter-ollama";

const ADAPTERS: Record<string, ProviderAdapter> = {
  openrouter: openRouterAdapter,
  anthropic: anthropicAdapter,
  "anthropic-sub": anthropicAdapter,
  openai: openAIAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

export function getAdapter(providerId: string): ProviderAdapter | null {
  return ADAPTERS[providerId] ?? null;
}

/**
 * Extract ModelCard using the appropriate adapter, then fill gaps
 * from family baselines. Dimension scores are always fully populated.
 */
export function extractModelCardWithFallback(
  providerId: string,
  modelId: string,
  rawMetadata: unknown,
): ModelCard {
  const adapter = getAdapter(providerId);
  const card = adapter
    ? adapter.extractModelCard(modelId, rawMetadata)
    : buildFallbackCard(providerId, modelId, rawMetadata);

  // Fill dimension scores from family baseline if adapter left them at defaults.
  // Adapters set dimensionScoreSource: "inferred" with DEFAULT_DIMENSION_SCORES.
  // The registry is the single place that applies the baseline cascade.
  const baseline = getBaselineForModel(modelId);
  if (baseline && card.dimensionScoreSource === "inferred") {
    card.dimensionScores = { ...baseline.scores, custom: {} };
    card.dimensionScoreSource = "family_baseline";
    if (card.metadataConfidence === "low" && baseline.confidence === "medium") {
      card.metadataConfidence = "medium";
    }
  }

  return card;
}
```

(Implement `buildFallbackCard()` that returns a ModelCard with safe defaults and `metadataConfidence: "low"`)

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/adapter-registry.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/adapter-registry.ts apps/web/lib/routing/adapter-registry.test.ts
git commit -m "feat(routing): EP-INF-003 adapter registry with fallback pipeline"
```

---

## Task 10: Prisma Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (line 763, ModelProfile)

- [ ] **Step 1: Add new columns to ModelProfile**

Add after existing fields (before `provider` relation):

```prisma
  // EP-INF-003: ModelCard fields
  modelFamily               String?
  modelClass                String    @default("chat")
  maxInputTokens            Int?
  inputModalities           Json      @default("[\"text\"]")
  outputModalities          Json      @default("[\"text\"]")
  capabilities              Json      @default("{}")
  pricing                   Json      @default("{}")
  supportedParameters       Json      @default("[]")
  defaultParameters         Json?
  instructType              String?
  trainingDataCutoff        String?
  reliableKnowledgeCutoff   String?
  deprecationDate           DateTime?
  perRequestLimits          Json?
  metadataSource            String    @default("inferred")
  metadataConfidence        String    @default("low")
  lastMetadataRefresh       DateTime?
  rawMetadataHash           String?
```

- [ ] **Step 2: Generate and run migration**

Run: `cd packages/db && npx prisma migrate dev --name ep-inf-003-model-card-fields`
Expected: Migration creates new columns with defaults. Existing data preserved.

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd packages/db && npx prisma generate`
Expected: Prisma client regenerated with new ModelProfile fields. This makes the new columns available as typed properties — no `(mp as any)` casts needed in subsequent tasks.

- [ ] **Step 4: Verify migration**

Run: `cd packages/db && npx prisma migrate status`
Expected: All migrations applied, no pending.

**Note:** `maxOutputTokens Int?` already exists on ModelProfile (line 790). It is NOT re-added in this migration. The new `maxInputTokens` column is added alongside the existing `maxContextTokens` — both coexist during transition.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): EP-INF-003 add ModelCard columns to ModelProfile"
```

---

## Task 11: Update EndpointManifest Type & Loader

**Files:**
- Modify: `apps/web/lib/routing/types.ts` (line 12)
- Modify: `apps/web/lib/routing/loader.ts` (line 19)

- [ ] **Step 1: Expand EndpointManifest type**

Add to `EndpointManifest` interface in `types.ts` after `retiredAt`:

```typescript
  // EP-INF-003: ModelCard fields
  modelClass: string;
  modelFamily: string | null;
  inputModalities: string[];
  outputModalities: string[];
  capabilities: import("./model-card-types").ModelCardCapabilities;
  pricing: import("./model-card-types").ModelCardPricing;
  supportedParameters: string[];
  deprecationDate: Date | null;
  metadataSource: string;
  metadataConfidence: string;
  perRequestLimits: { promptTokens: number | null; completionTokens: number | null } | null;
```

- [ ] **Step 2: Update loadEndpointManifests() in loader.ts**

Fix the `id` bug and add new field mappings. Change `id: mp.providerId` to `id: mp.id`. Add new fields from the ModelProfile query result. Since Task 10 already ran `prisma migrate dev` + `prisma generate`, the new columns are fully typed — no casts needed:

```typescript
    // EP-INF-003: Fix identity bug — use ModelProfile PK, not providerId
    id: mp.id,
    // ... existing fields ...
    // EP-INF-003: ModelCard fields
    modelClass: mp.modelClass ?? "chat",
    modelFamily: mp.modelFamily ?? null,
    inputModalities: (mp.inputModalities as string[]) ?? ["text"],
    outputModalities: (mp.outputModalities as string[]) ?? ["text"],
    capabilities: (mp.capabilities as ModelCardCapabilities) ?? EMPTY_CAPABILITIES,
    pricing: (mp.pricing as ModelCardPricing) ?? EMPTY_PRICING,
    supportedParameters: (mp.supportedParameters as string[]) ?? [],
    deprecationDate: mp.deprecationDate ?? null,
    metadataSource: mp.metadataSource ?? "inferred",
    metadataConfidence: mp.metadataConfidence ?? "low",
    perRequestLimits: mp.perRequestLimits as any ?? null,
    // Backward compat: derive old fields from new
    supportsToolUse: (mp.capabilities as any)?.toolUse ?? mp.supportsToolUse ?? false,
    costPerOutputMToken: (mp.pricing as any)?.outputPerMToken ?? mp.outputPricePerMToken ?? mp.provider.outputPricePerMToken,
```

Import `ModelCardCapabilities`, `ModelCardPricing`, `EMPTY_CAPABILITIES`, `EMPTY_PRICING` from `./model-card-types` at the top of `loader.ts`.

- [ ] **Step 3: Run existing pipeline tests to verify backward compatibility**

Run: `cd apps/web && npx vitest run lib/routing/pipeline.test.ts`
Expected: All existing tests still PASS. The `makeEndpoint()` helper in tests sets fields explicitly, so the new fields defaulting to undefined/null won't break anything.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/routing/types.ts apps/web/lib/routing/loader.ts
git commit -m "feat(routing): EP-INF-003 expand EndpointManifest, fix id bug"
```

---

## Task 12: Add modelClass and Modality Filters to Pipeline

**Files:**
- Modify: `apps/web/lib/routing/pipeline.ts` (line 115, `getExclusionReason()`)
- Modify: `apps/web/lib/routing/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for new filters**

Add to `pipeline.test.ts`:

```typescript
describe("filterHard – EP-INF-003 modelClass filter", () => {
  it("excludes embedding models from chat routing", () => {
    const embedding = makeEndpoint({
      id: "embed-1", modelId: "text-embedding-3-small", modelClass: "embedding",
    });
    const chat = makeEndpoint({
      id: "chat-1", modelId: "gpt-4o", modelClass: "chat",
    });
    const result = filterHard([embedding, chat], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].modelId).toBe("gpt-4o");
    expect(result.excluded[0].excludedReason).toContain("modelClass");
  });

  it("excludes image_gen models from chat routing", () => {
    const imageGen = makeEndpoint({
      id: "img-1", modelId: "dall-e-3", modelClass: "image_gen",
    });
    const result = filterHard([imageGen], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(0);
  });
});
```

**Prerequisites:** Update the `makeEndpoint()` helper in `pipeline.test.ts` to include defaults for all new `EndpointManifest` fields:
```typescript
modelClass: "chat",
modelFamily: null,
inputModalities: ["text"],
outputModalities: ["text"],
capabilities: EMPTY_CAPABILITIES,
pricing: EMPTY_PRICING,
supportedParameters: [],
deprecationDate: null,
metadataSource: "inferred",
metadataConfidence: "low",
perRequestLimits: null,
```
Import `EMPTY_CAPABILITIES` and `EMPTY_PRICING` from `./model-card-types`.

- [ ] **Step 2: Run tests, verify fail**

Run: `cd apps/web && npx vitest run lib/routing/pipeline.test.ts`
Expected: New tests FAIL (modelClass not checked yet)

- [ ] **Step 3: Add modelClass check to getExclusionReason()**

In `pipeline.ts`, inside `getExclusionReason()`, add near the top (before status check):

```typescript
  // EP-INF-003: Model class must be compatible with task
  // Chat/reasoning tasks only accept chat and reasoning models
  const modelClass = (ep as any).modelClass ?? "chat";
  if (modelClass !== "chat" && modelClass !== "reasoning") {
    return `modelClass "${modelClass}" is not eligible for chat/reasoning tasks`;
  }
```

- [ ] **Step 4: Run all pipeline tests**

Run: `cd apps/web && npx vitest run lib/routing/pipeline.test.ts`
Expected: All tests PASS (new and existing)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/pipeline.ts apps/web/lib/routing/pipeline.test.ts
git commit -m "feat(routing): EP-INF-003 add modelClass filter to pipeline"
```

---

## Task 13: Update Discovery Pipeline

Replace `extractModelMetadata` call in `ai-provider-internals.ts` with adapter registry.

**Files:**
- Modify: `apps/web/lib/ai-provider-internals.ts` (line 246, `profileModelsInternal()`)

- [ ] **Step 1: Update the import**

Replace:
```typescript
import { extractModelMetadata } from "./routing/metadata-extractor";
```
With:
```typescript
import { extractModelCardWithFallback } from "./routing/adapter-registry";
```

- [ ] **Step 2: Update profileModelsInternal() function**

At line 261, replace:
```typescript
const metadata = extractModelMetadata(providerId, m.rawMetadata as Record<string, unknown>);
```
With:
```typescript
const card = extractModelCardWithFallback(providerId, m.modelId, m.rawMetadata);
```

Update the `prisma.modelProfile.upsert()` call to write new ModelCard fields. Add these fields to BOTH the `create` and `update` branches of the existing upsert (the current code has separate `create` and `update` objects — retain all existing fields like `friendlyName`, `summary`, `bestFor`, `avoidFor`, `generatedBy` in `create`, and merge the new fields into both branches):

```typescript
  // EP-INF-003: Write ModelCard fields (add to BOTH create and update)
  modelFamily: card.modelFamily,
  modelClass: card.modelClass,
  maxInputTokens: card.maxInputTokens,
  maxOutputTokens: card.maxOutputTokens,
  inputModalities: card.inputModalities,
  outputModalities: card.outputModalities,
  capabilities: card.capabilities,
  pricing: card.pricing,
  supportedParameters: card.supportedParameters,
  defaultParameters: card.defaultParameters,
  instructType: card.instructType,
  trainingDataCutoff: card.trainingDataCutoff,
  reliableKnowledgeCutoff: card.reliableKnowledgeCutoff,
  deprecationDate: card.deprecationDate,
  perRequestLimits: card.perRequestLimits,
  metadataSource: card.metadataSource,
  metadataConfidence: card.metadataConfidence,
  lastMetadataRefresh: new Date(),
  rawMetadataHash: card.rawMetadataHash,
  // Backward compat: still write old fields
  maxContextTokens: card.maxInputTokens,
  inputPricePerMToken: card.pricing.inputPerMToken,
  outputPricePerMToken: card.pricing.outputPerMToken,
  supportsToolUse: card.capabilities.toolUse ?? false,
  // Dimension scores
  reasoning: card.dimensionScores.reasoning,
  codegen: card.dimensionScores.codegen,
  toolFidelity: card.dimensionScores.toolFidelity,
  instructionFollowingScore: card.dimensionScores.instructionFollowing,
  structuredOutputScore: card.dimensionScores.structuredOutput,
  conversational: card.dimensionScores.conversational,
  contextRetention: card.dimensionScores.contextRetention,
  // Map dimensionScoreSource to existing profileSource enum values:
  // "family_baseline" → "seed", "inferred" → "seed", "evaluated" → "evaluated",
  // "production" → "production", "provider" → "seed" (no separate value yet)
  profileSource: ((): string => {
    switch (card.dimensionScoreSource) {
      case "family_baseline": return "seed";
      case "inferred": return "seed";
      case "provider": return "seed";
      case "evaluated": return "evaluated";
      case "production": return "production";
      default: return "seed";
    }
  })(),
  profileConfidence: card.metadataConfidence,
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts
git commit -m "feat(routing): EP-INF-003 wire adapter registry into discovery pipeline"
```

---

## Task 14: Update Exports

**Files:**
- Modify: `apps/web/lib/routing/index.ts`

**Note:** `parseModelsResponse()` in `ai-provider-types.ts` is retained — it is still used by `discoverModelsInternal()` (line 171) and has its own test suite in `ai-providers.test.ts`. Migrating discovery to use adapter `parseDiscoveryResponse()` is deferred to a future task. The adapters' `parseDiscoveryResponse()` exists for when that migration happens.

- [ ] **Step 1: Add exports to routing/index.ts**

Add exports for new public types and the adapter registry:
```typescript
export type { ModelCard, ModelCardCapabilities, ModelCardPricing, ModelClass, ModelCardDimensionScores } from "./model-card-types";
export { EMPTY_CAPABILITIES, EMPTY_PRICING, DEFAULT_DIMENSION_SCORES } from "./model-card-types";
export type { ProviderAdapter, DiscoveredModelEntry } from "./adapter-interface";
export { getAdapter, extractModelCardWithFallback } from "./adapter-registry";
export { classifyModel } from "./model-classifier";
export { computeMetadataHash } from "./metadata-hash";
```

- [ ] **Step 3: Verify full test suite passes**

Run: `cd apps/web && npx vitest run`
Expected: All existing tests pass. No regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/routing/index.ts apps/web/lib/ai-provider-types.ts
git commit -m "feat(routing): EP-INF-003 update exports, delegate parseModelsResponse to adapters"
```

---

## Task 15: Backfill Existing ModelProfiles

Existing ModelProfile rows have the new columns at defaults. Run adapters against existing DiscoveredModel data.

**Files:**
- No new files — uses existing adapter-registry and Prisma client

- [ ] **Step 1: Write a backfill script/action**

In `ai-provider-internals.ts`, add a function `backfillModelCards()`:
```typescript
export async function backfillModelCards(): Promise<number> {
  const discovered = await prisma.discoveredModel.findMany();
  let updated = 0;
  for (const dm of discovered) {
    const card = extractModelCardWithFallback(dm.providerId, dm.modelId, dm.rawMetadata);
    await prisma.modelProfile.updateMany({
      where: { providerId: dm.providerId, modelId: dm.modelId },
      data: {
        modelFamily: card.modelFamily,
        modelClass: card.modelClass,
        maxInputTokens: card.maxInputTokens,
        inputModalities: card.inputModalities,
        outputModalities: card.outputModalities,
        capabilities: card.capabilities as any,
        pricing: card.pricing as any,
        supportedParameters: card.supportedParameters,
        metadataSource: card.metadataSource,
        metadataConfidence: card.metadataConfidence,
        lastMetadataRefresh: new Date(),
        rawMetadataHash: card.rawMetadataHash,
      },
    });
    updated++;
  }
  return updated;
}
```

- [ ] **Step 2: Run the backfill**

Call `backfillModelCards()` once (from a server action or seed script). Verify by checking a few ModelProfile rows have populated `modelClass`, `capabilities`, and `pricing` fields.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts
git commit -m "feat(routing): EP-INF-003 backfill existing ModelProfiles with ModelCard data"
```

---

## Task 16: Drift Detection Logging

The hash is stored. Now add comparison logic on re-discovery.

**Files:**
- Modify: `apps/web/lib/ai-provider-internals.ts` (in `profileModelsInternal()`)

- [ ] **Step 1: Add drift detection after ModelCard extraction**

In `profileModelsInternal()`, after extracting the card and before the upsert, check the existing hash:

```typescript
  // EP-INF-003: Drift detection
  const existingProfile = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId, modelId: m.modelId } },
    select: { rawMetadataHash: true },
  });
  if (existingProfile?.rawMetadataHash && existingProfile.rawMetadataHash !== card.rawMetadataHash) {
    console.log(
      `[drift] Provider metadata changed for ${providerId}/${m.modelId} — hash ${existingProfile.rawMetadataHash.slice(0, 8)}→${card.rawMetadataHash.slice(0, 8)}`
    );
    // Future: diff old vs new card, log specific changes, trigger recipe re-evaluation (EP-INF-006)
  }
```

This is minimal drift logging for now. Structured drift event storage and operator alerts are deferred to EP-INF-006 when the adaptive loop needs them.

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts
git commit -m "feat(routing): EP-INF-003 basic drift detection on metadata hash change"
```

---

## Task 17: Run Full Test Suite & Verify

- [ ] **Step 1: Run all routing tests**

Run: `cd apps/web && npx vitest run lib/routing/`
Expected: All tests pass — new adapter tests + all existing pipeline/scoring/eval tests.

- [ ] **Step 2: Run full app test suite**

Run: `cd apps/web && npx vitest run`
Expected: No regressions anywhere.

- [ ] **Step 3: Run type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(routing): EP-INF-003 address test suite issues"
```
