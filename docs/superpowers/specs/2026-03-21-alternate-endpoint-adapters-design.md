# EP-INF-009c: Alternate Endpoint Adapters

**Date:** 2026-03-21
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-009c
**Prerequisites:** EP-INF-008a (Execution Adapter Framework), EP-INF-008b (Tool-Based Capabilities)
**Related:** EP-INF-003 (ModelCard), EP-INF-005a (RequestContract), EP-INF-005b (Execution Recipes)

---

## Problem Statement

The adapter framework (EP-INF-008a) established a pluggable dispatch pattern with the `ExecutionAdapterHandler` interface and a `chat` adapter. The `ModelClass` enum already includes `image_gen`, `embedding`, `audio`, `speech`, and others — and provider discovery populates `ModelProfile` rows with the correct `modelClass`. But those models are hard-filtered out at routing time (line 48-51 of `pipeline-v2.ts`):

```typescript
if (modelClass !== "chat" && modelClass !== "reasoning") {
  return `modelClass "${modelClass}" is not eligible for chat/reasoning tasks`;
}
```

Additionally, `NON_CHAT_PATTERN` in `ai-provider-priority.ts` uses regex on model IDs to exclude non-chat models from priority lists — a brittle approach that should be replaced by `modelClass`-based filtering.

No execution adapters exist beyond `chat`. Non-chat models are discovered, profiled, and immediately dead-ended.

---

## Design

### 1. New Adapters

Three new execution adapters, each following the `ExecutionAdapterHandler` interface:

#### 1a. `image_gen` Adapter

**API Pattern:** `POST /v1/images/generations` (OpenAI), `POST /models/{model}:generateContent` (Gemini with image output)

**Request:**
```typescript
// OpenAI-compatible
{
  model: modelId,
  prompt: lastUserMessage,      // extracted from messages array
  n: 1,
  size: plan.providerSettings.size ?? "1024x1024",
  quality: plan.providerSettings.quality ?? "auto",
  response_format: "url",       // or "b64_json" per providerSettings
}
```

**Response mapping:**
- `text` → image URL (or base64 data URI)
- `toolCalls` → empty
- `usage` → `{ inputTokens: 0, outputTokens: 0 }` (image gen is per-request priced)
- `raw` → full API response (includes `revised_prompt` for DALL-E)

**Providers:** OpenAI (DALL-E 3, gpt-image-1), Google (Imagen via Gemini API)

**Provider branching:** OpenAI uses `/v1/images/generations`. Gemini uses the `generateContent` endpoint with image output config. The adapter detects provider via `isOpenAI()` / `isGemini()`.

#### 1b. `embedding` Adapter

**API Pattern:** `POST /v1/embeddings` (OpenAI-compatible), `POST /models/{model}:embedContent` (Gemini)

**Request:**
```typescript
// OpenAI-compatible
{
  model: modelId,
  input: lastUserMessage,       // text to embed
  dimensions: plan.providerSettings.dimensions,  // optional
  encoding_format: "float",
}
```

**Response mapping:**
- `text` → empty string (embeddings aren't text)
- `toolCalls` → empty
- `usage` → `{ inputTokens: usage.prompt_tokens, outputTokens: 0 }`
- `raw` → `{ embedding: number[], dimensions: number }` (the vector)

**Providers:** OpenAI (text-embedding-3-small/large, text-embedding-ada-002), Google (text-embedding-004), Cohere (embed-v4)

**Note:** The platform already uses embeddings via the vector DB integration. This adapter enables direct embedding calls for cases like similarity comparison without storage, or embedding providers that aren't the vector DB backend.

#### 1c. `transcription` Adapter

**API Pattern:** `POST /v1/audio/transcriptions` (OpenAI Whisper)

**Request:**
```typescript
// multipart/form-data
{
  model: modelId,
  file: audioBlob,              // extracted from messages multimodal content
  language: plan.providerSettings.language,  // optional
  response_format: "json",
}
```

**Response mapping:**
- `text` → transcription text
- `toolCalls` → empty
- `usage` → `{ inputTokens: 0, outputTokens: 0 }` (audio is per-minute priced)
- `raw` → full API response (includes `segments` for timestamped output)

**Providers:** OpenAI (whisper-1, gpt-4o-transcribe)

**Note on multipart/form-data:** Unlike chat adapters that send JSON, this adapter sends `FormData`. The adapter constructs the form body internally. The `messages` array carries the audio as a content part with `type: "audio"` and a `data` field (base64 or URL).

### 2. AdapterResult — No Changes Needed

The existing `AdapterResult` interface already supports non-chat results:

- **Image gen:** URL goes in `text`, full response in `raw`
- **Embedding:** Vector goes in `raw.embedding`, `text` is empty
- **Transcription:** Transcribed text goes in `text`

The `raw` field was designed for this — it carries provider-specific structured data. Callers that need the vector or image URL read from `raw`.

### 3. RequestContract Extension

Add `requiredModelClass` to `RequestContract`:

```typescript
export interface RequestContract {
  // ... existing fields ...

  /** When set, only endpoints with this modelClass are eligible.
   *  When absent, defaults to chat/reasoning filter (current behavior). */
  requiredModelClass?: ModelClass;
}
```

New contract families for non-chat tasks:

| Contract Family | Task Type | Required Model Class |
|----------------|-----------|---------------------|
| `sync.image-gen` | `image-gen` | `image_gen` |
| `sync.embedding` | `embedding` | `embedding` |
| `sync.transcription` | `transcription` | `audio` |

`inferContract()` maps these task types to the appropriate `requiredModelClass`:

```typescript
const TASK_MODEL_CLASS: Record<string, ModelClass> = {
  "image-gen": "image_gen",
  "embedding": "embedding",
  "transcription": "audio",
};
```

### 4. V2 Pipeline Changes

#### `getExclusionReasonV2` — modelClass filter

Replace the current hard-coded chat/reasoning check:

```typescript
// Current (lines 48-51):
if (modelClass !== "chat" && modelClass !== "reasoning") {
  return `modelClass "${modelClass}" is not eligible for chat/reasoning tasks`;
}

// New:
if (contract.requiredModelClass) {
  // Specific model class requested — exact match
  if (modelClass !== contract.requiredModelClass) {
    return `modelClass "${modelClass}" does not match required "${contract.requiredModelClass}"`;
  }
} else {
  // Default: chat/reasoning only (preserves current behavior)
  if (modelClass !== "chat" && modelClass !== "reasoning") {
    return `modelClass "${modelClass}" is not eligible for chat/reasoning tasks`;
  }
}
```

#### `buildDefaultPlan` — adapter selection

When no recipe matches and the contract has `requiredModelClass`, the default plan must use the correct adapter:

```typescript
const MODEL_CLASS_ADAPTER: Record<string, string> = {
  chat: "chat",
  reasoning: "chat",
  image_gen: "image_gen",
  embedding: "embedding",
  audio: "transcription",
};

// In buildDefaultPlan:
executionAdapter: MODEL_CLASS_ADAPTER[contract.requiredModelClass ?? "chat"] ?? "chat",
```

### 5. Recipe Seeder Changes

`buildSeedRecipe()` gains model-class-aware adapter selection:

```typescript
// After existing provider settings logic:
const executionAdapter = MODEL_CLASS_ADAPTER[modelCard.modelClass] ?? "chat";
```

And the returned recipe includes the adapter:

```typescript
return { providerSettings, toolPolicy, responsePolicy, executionAdapter };
```

`seedAllRecipes()` in `ai-provider-internals.ts` currently iterates over 9 chat contract families. It should also seed non-chat contract families for models with matching `modelClass`:

| Model Class | Contract Families |
|------------|-------------------|
| `image_gen` | `sync.image-gen` |
| `embedding` | `sync.embedding` |
| `audio` | `sync.transcription` |

### 6. `routeAndCall()` Extension

Add `requiredModelClass` to `RouteAndCallOptions`:

```typescript
export interface RouteAndCallOptions {
  // ... existing fields ...
  /** Route to a specific model class (e.g., "image_gen", "embedding"). */
  requiredModelClass?: ModelClass;
}
```

Pass through to contract inference:

```typescript
const contract = await inferContract(taskType, messages, options?.tools, undefined, {
  // ... existing fields ...
  requiredModelClass: options?.requiredModelClass,
});
```

### 7. NON_CHAT_PATTERN Retirement

The regex `NON_CHAT_PATTERN` in `ai-provider-priority.ts` is used by the legacy `callWithFailover` path (now deprecated per EP-INF-009b). No changes needed — it dies with the legacy path. The V2 pipeline uses `modelClass` from `EndpointManifest` for proper type-based filtering.

### 8. Provider-Specific Endpoint Resolution

Non-chat adapters need different URLs than the chat adapter's `{baseUrl}/v1/chat/completions`. The adapter resolves endpoints internally:

| Adapter | OpenAI URL | Gemini URL |
|---------|-----------|------------|
| `image_gen` | `{baseUrl}/v1/images/generations` | `{baseUrl}/models/{model}:generateContent` (with image output config) |
| `embedding` | `{baseUrl}/v1/embeddings` | `{baseUrl}/models/{model}:embedContent` |
| `transcription` | `{baseUrl}/v1/audio/transcriptions` | N/A (Google uses multimodal chat for audio) |

The `AdapterRequest.provider.baseUrl` gives the provider's base URL. Each adapter appends the correct path.

---

## What This Enables

| Task | Current | After EP-INF-009c |
|------|---------|-------------------|
| "Generate a product mockup" | Not possible via routing | `routeAndCall(msgs, sys, "internal", { taskType: "image-gen", requiredModelClass: "image_gen" })` routes to DALL-E/Imagen |
| "Embed this text" | Direct vector DB call only | `routeAndCall(msgs, sys, "internal", { taskType: "embedding", requiredModelClass: "embedding" })` routes to embedding model |
| "Transcribe this audio" | External service | `routeAndCall(msgs, sys, "internal", { taskType: "transcription", requiredModelClass: "audio" })` routes to Whisper |

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/lib/routing/image-gen-adapter.ts` | `image_gen` execution adapter |
| `apps/web/lib/routing/embedding-adapter.ts` | `embedding` execution adapter |
| `apps/web/lib/routing/transcription-adapter.ts` | `transcription` execution adapter |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/lib/routing/request-contract.ts` | Add `requiredModelClass` to `RequestContract`, task→modelClass mapping in `inferContract()` |
| `apps/web/lib/routing/pipeline-v2.ts` | Update `getExclusionReasonV2` modelClass filter to support `requiredModelClass` |
| `apps/web/lib/routing/execution-plan.ts` | Update `buildDefaultPlan` to select adapter based on `requiredModelClass` |
| `apps/web/lib/routing/recipe-seeder.ts` | Return `executionAdapter` based on `modelCard.modelClass` |
| `apps/web/lib/routing/recipe-types.ts` | No changes — `executionAdapter` field already exists |
| `apps/web/lib/ai-provider-internals.ts` | `seedAllRecipes()` seeds non-chat contract families |
| `apps/web/lib/routed-inference.ts` | Add `requiredModelClass` to `RouteAndCallOptions`, pass to contract |
| `apps/web/lib/ai-inference.ts` | Import non-chat adapters to trigger registration |

## Tests

| Test | Coverage |
|------|----------|
| `image-gen-adapter.test.ts` | OpenAI DALL-E request format, Gemini image format, URL extraction, error handling |
| `embedding-adapter.test.ts` | OpenAI embedding request, dimension passthrough, vector extraction |
| `transcription-adapter.test.ts` | Whisper multipart request, text extraction |
| `pipeline-v2.test.ts` | `requiredModelClass` filter (exact match, default fallback to chat/reasoning) |
| `execution-plan.test.ts` | `buildDefaultPlan` selects correct adapter per modelClass |
| `recipe-seeder.test.ts` | Non-chat recipes get correct executionAdapter |

---

## What Is NOT In Scope

- **TTS (text-to-speech)** — No current platform use case. Can be added later with the same pattern.
- **Video generation** — Emerging API, not standardized across providers.
- **Realtime/WebSocket** — Fundamentally different execution model (EP-INF-009d scope).
- **Deep Research/Interactions API** — Async/polling pattern (EP-INF-009d scope).
- **UI for non-chat results** — Build Studio or workspace tiles that display images/audio. Separate UX epic.
- **Streaming for non-chat** — Image gen and embedding are single-shot. No streaming needed.
- **Provider registry changes** — Non-chat models are already discovered. No new registry entries needed.
