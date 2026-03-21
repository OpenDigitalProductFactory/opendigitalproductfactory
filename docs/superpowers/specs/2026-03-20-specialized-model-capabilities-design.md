# EP-INF-008: Specialized Model Capabilities

**Date:** 2026-03-20
**Status:** Proposed
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-008

**Prerequisites:**
- EP-INF-003 through EP-INF-006 (routing redesign) — implemented
- EP-INF-005b (Execution Recipes) — provides the recipe abstraction for different execution strategies

---

## Problem Statement

The routing redesign (EP-INF-003 through EP-INF-006) built a comprehensive pipeline for chat and reasoning models. But providers are shipping models with fundamentally different APIs, execution patterns, and capabilities that the current pipeline cannot leverage:

1. **Google Deep Research** — uses the Interactions API (not `generateContent`). Takes minutes, not seconds. Produces research reports by browsing the web and synthesizing sources. Currently retired because it 400s on our standard API path.

2. **Google Grounding & Code Execution** — models with built-in web search and sandboxed code execution. Available via `generateContent` but require specific tool declarations we don't send.

3. **Anthropic Computer Use** — models that can control a browser or desktop. Requires a tool-use loop with screenshot/action cycles.

4. **OpenAI Codex / Agent Models** — agentic coding models with their own execution API. Already registered as `codex-agent` but unused by routing.

5. **Realtime Models** — OpenAI's Realtime API for voice/streaming. WebSocket-based, not HTTP request/response.

6. **Image/Audio/Video Generation** — DALL-E, Sora, TTS, etc. Different input/output modalities and API endpoints.

The `ModelCard` from EP-INF-003 already captures capabilities (tool use, code execution, thinking, etc.) and `modelClass` already classifies models into types. But the routing pipeline only serves `chat` and `reasoning` — everything else is excluded in `getExclusionReasonV2()`.

### What We're Missing

Every provider publishes unique capabilities that could serve platform tasks better than generic chat:
- A "research this competitor" task could use Google Deep Research instead of a chat model doing web search
- A "execute this code and verify the output" task could use Gemini Code Execution or Anthropic Computer Use
- A "generate a product image" task could use DALL-E instead of requiring an external tool
- A "transcribe this meeting recording" task could use Whisper

The routing system knows these models exist (from discovery) and knows what they can do (from the ModelCard). It just can't use them because `callProvider()` only speaks one API dialect per provider.

---

## Goals

1. Extend the execution layer to support multiple API types per provider, not just `generateContent`/`/messages`/`/chat/completions`.
2. Route specialized requests to specialized models when available and appropriate.
3. Handle async/long-running model executions (Deep Research takes minutes).
4. Make specialized capabilities discoverable and auditable — operators should see what unique capabilities each provider offers.

## Proposed Scope

### Phase 1: Execution Adapter Registry

Extend the `ExecutionRecipe` concept with an `executionAdapter` field that specifies which API to use:

```typescript
type ExecutionAdapter =
  | "chat"              // standard: /messages, /chat/completions, generateContent
  | "deep_research"     // Google Interactions API
  | "code_execution"    // Gemini code execution tool
  | "computer_use"      // Anthropic computer use tool loop
  | "image_generation"  // DALL-E, Imagen
  | "audio_transcription" // Whisper
  | "audio_generation"  // TTS
  | "realtime"          // WebSocket-based streaming
  | "agent"             // Codex agent, multi-step agentic
```

Each adapter implements a common interface:
```typescript
interface ExecutionAdapterHandler {
  readonly adapterId: ExecutionAdapter;
  canHandle(plan: RoutedExecutionPlan): boolean;
  execute(plan: RoutedExecutionPlan, input: AdapterInput): Promise<AdapterOutput>;
}
```

### Phase 2: RequestContract Capability Matching

Extend `RequestContract` with capability requirements that map to specialized models:
- `requiresWebResearch: true` → prefer Deep Research models
- `requiresCodeExecution: true` → prefer Code Execution models
- `requiresImageGeneration: true` → route to image models
- `requiresAudioTranscription: true` → route to audio models

### Phase 3: Background/Async Execution

Some models (Deep Research) take minutes. The execution layer needs:
- Fire-and-forget dispatch with status polling
- Progress callbacks or webhook-based notification
- Timeout handling for long-running tasks
- Result storage and retrieval

### Phase 4: Provider Capability Discovery Enhancement

Extend the adapter-based discovery to extract provider-specific capabilities that go beyond the standard `ModelCardCapabilities` booleans:
- Google: grounding sources, code execution languages, Interactions API support
- Anthropic: computer use tool types, supported screen resolutions
- OpenAI: realtime voice models, supported audio formats

---

## What This Changes

| Current State | After EP-INF-008 |
|---|---|
| `callProvider()` speaks one API per provider | Multiple execution adapters per provider |
| Non-chat models are retired | Non-chat models are routed to appropriate adapters |
| `modelClass` is a filter (exclude non-chat) | `modelClass` is a routing signal (match to adapter) |
| Only sync request/response | Sync + async/background execution |
| One `ExecutionRecipe` format | Recipes specify which adapter to use |

---

## Relationship to Existing Epics

- **EP-INF-003** provided ModelCard capabilities — this epic uses them for adapter selection
- **EP-INF-005a** provided RequestContract — this epic extends it with capability requirements
- **EP-INF-005b** provided ExecutionRecipe — this epic adds `executionAdapter` field
- **EP-INF-006** provided champion/challenger — specialized adapters can have their own recipes

---

## Next Steps

This epic needs research before spec:
1. Document each provider's specialized APIs (endpoints, auth, request/response formats)
2. Identify which platform task types would benefit from specialized models
3. Prioritize: which adapter delivers the most value first? (likely Deep Research or Code Execution)
4. Design the async execution pattern for long-running models

This should be broken into sub-epics per adapter type, with Deep Research or Code Execution as the first implementation.
