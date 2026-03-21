# EP-INF-008: Specialized Model Capabilities

**Date:** 2026-03-20
**Status:** Approved
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-008 (umbrella — 4 sub-epics)

**Prerequisites:**
- EP-INF-003 through EP-INF-006 (routing redesign) — implemented
- EP-INF-005b (Execution Recipes) — provides the recipe abstraction

---

## Problem Statement

The routing redesign built a comprehensive pipeline for chat and reasoning models. But providers ship models with fundamentally different APIs, execution patterns, and unique capabilities that the current pipeline cannot leverage. Every provider's specialized models are discovered, classified, and immediately retired because `callProvider()` only speaks one API dialect per provider.

The ModelCard captures what each model can do. The routing pipeline knows which models exist. The execution layer just can't use most of them.

---

## Architecture: Three Capability Patterns

Analysis of specialized models across all providers reveals three patterns:

### Pattern A: Same API, Different Tools/Config (80% of cases)

Most "specialized" capabilities use the provider's standard chat API with specific tool declarations:

| Capability | Provider | API | What's Different |
|---|---|---|---|
| Code Execution | Google Gemini | `generateContent` | Add `code_execution` tool declaration |
| Grounding (Web Search) | Google Gemini | `generateContent` | Add `google_search_retrieval` tool |
| Computer Use | Anthropic | `/messages` | Add `computer_20241022` tool type + screenshot loop |
| Extended Thinking | Anthropic | `/messages` | Add `thinking` parameter (already in recipes) |
| Structured Output (strict) | OpenAI | `/chat/completions` | Add `response_format: { type: "json_schema" }` |

**These don't need new adapters.** They need richer `ExecutionRecipe` tool configurations. The recipe's `providerSettings` and `toolPolicy` already have the structure — we just need to populate them correctly and update the routing to match tasks to these capabilities.

### Pattern B: Different HTTP Endpoint, Same Shape

| Capability | Provider | Endpoint | Pattern |
|---|---|---|---|
| Image Generation | OpenAI (DALL-E) | `POST /images/generations` | Text → image URL |
| Audio Transcription | OpenAI (Whisper) | `POST /audio/transcriptions` | Audio file → text |
| Text-to-Speech | OpenAI (TTS) | `POST /audio/speech` | Text → audio file |
| Embeddings | OpenAI/Google | `POST /embeddings` | Text → vector |

**One generic adapter** with configurable endpoint + request/response mapping handles all of these.

### Pattern C: Truly Different API

| Capability | Provider | API | Why Different |
|---|---|---|---|
| Deep Research | Google | Interactions API | Long-running (minutes), polling, multi-step |
| Realtime Voice | OpenAI | WebSocket | Bidirectional streaming, not request/response |

**Purpose-built adapters** required. These are fundamentally different execution models.

---

## Epic Decomposition

### EP-INF-008a: Execution Adapter Framework

**Scope:** The common infrastructure all adapters plug into.
- `ExecutionAdapter` type on `ExecutionRecipe`
- Adapter handler registry (maps adapter type → handler)
- Dispatch logic in `callProvider()` — select handler based on recipe's adapter
- Default `"chat"` adapter wraps current `callProvider()` behavior (backward compat)

**Size:** Small — mostly wiring and a registry pattern.

### EP-INF-008b: Tool-Based Capabilities (Pattern A)

**Scope:** Activate capabilities that work via the standard chat API + tool declarations.
- Gemini Code Execution — recipe adds `code_execution` tool
- Gemini Grounding — recipe adds `google_search_retrieval` tool
- Anthropic Computer Use — recipe adds computer use tools + screenshot/action loop
- Extend `RequestContract` with capability flags: `requiresCodeExecution`, `requiresWebSearch`, `requiresComputerUse`
- Extend `routeEndpointV2` to match capability requirements to model capabilities
- Seed recipes for models that support these capabilities

**Size:** Medium — mostly recipe configuration + routing extension. Highest value, least new code.

### EP-INF-008c: Alternate Endpoint Models (Pattern B)

**Scope:** Support models that use different HTTP endpoints but follow a simple request/response pattern.
- Generic endpoint adapter: configurable URL, request body template, response mapping
- Image generation adapter (DALL-E, Imagen)
- Audio transcription adapter (Whisper)
- Text-to-speech adapter
- Embedding adapter (if needed beyond current vector DB integration)
- Extend `modelClass` routing to send image requests to image models, audio to audio models

**Size:** Medium — one adapter pattern, multiple configurations.

### EP-INF-008d: Async/Long-Running Models (Pattern C)

**Scope:** Support models that take minutes, not seconds.
- Background execution with status polling
- Result storage and retrieval
- Progress callbacks / notification
- Google Deep Research via Interactions API
- Timeout handling for multi-minute operations
- UI integration — show "research in progress" state

**Size:** Large — new execution model, new UI state, new persistence.

---

## Recommended Order

```
EP-INF-008a (Framework)     → Small, foundation
    ↓
EP-INF-008b (Tool-Based)    → Highest value, builds on framework
    ↓
EP-INF-008c (Alt Endpoints) → Image/audio, builds on framework
    ↓
EP-INF-008d (Async/LR)      → Deep Research, most complex
```

EP-INF-008b should ship first after the framework — it unlocks Code Execution, Grounding, and Computer Use with minimal new code because the recipes already exist as a concept.

---

## What This Enables

| Task | Current | After EP-INF-008 |
|---|---|---|
| "Research competitor X deeply" | Chat model does web search tool calls | Deep Research model produces full report |
| "Run this code and verify output" | Chat model generates code text | Code Execution model runs code in sandbox |
| "Fill out this web form" | Not possible | Computer Use model controls browser |
| "Generate a product mockup" | External tool integration | Image gen model creates directly |
| "Transcribe this meeting" | External service | Audio model transcribes directly |
| "Search for recent news on Y" | Chat model with search tool | Grounded model with built-in web search |

---

## Relationship to Existing Architecture

- **ModelCard** (EP-INF-003) already captures capabilities — `codeExecution`, `imageInput`, etc.
- **RequestContract** (EP-INF-005a) already has `modality` and `interactionMode` — extend with capability flags
- **ExecutionRecipe** (EP-INF-005b) already has `providerSettings` and `toolPolicy` — extend with `executionAdapter`
- **Champion/Challenger** (EP-INF-006) works per-recipe — specialized recipes can have their own evolution

The routing redesign was designed for this. EP-INF-008 activates what the infrastructure was built to support.
