# EP-INF-011: NVIDIA Model Provider Integration

**Date:** 2026-03-22
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO / design partner)
**Epic:** EP-INF-011

**Prerequisites:**
- EP-INF-003 (Adaptive Contract-Based Model Routing) — routing pipeline
- EP-INF-005b (Execution Recipes) — recipe seeder
- EP-INF-008 (Specialized Model Capabilities) — model classification
- EP-INF-009c (Alternate Endpoint Adapters) — non-chat adapter support

---

## Problem Statement

The platform currently integrates with Anthropic, OpenAI, OpenRouter, Ollama, Gemini, and Cohere. NVIDIA operates one of the largest AI model ecosystems — over 100 models spanning chat, code, vision, embedding, and domain-specific tasks — available both as a hosted cloud API (build.nvidia.com / NIM microservices) and as self-hosted local containers (NVIDIA NIM on GPU hardware).

Small businesses need access to this breadth of capability without understanding deployment topology. A business with an NVIDIA GPU should be able to run models locally for sensitive data while transparently falling back to the cloud for everything else. The platform should make this seamless.

---

## Goals

1. Integrate NVIDIA's full model catalog via cloud API (build.nvidia.com) and local NIM endpoints.
2. Automatic discovery, profiling, and classification of all available NVIDIA models.
3. Sensitivity-driven routing — local NIM for confidential/restricted data, cloud for public/internal — with proactive warnings when data sovereignty risks apply.
4. Seamless admin experience — one "NVIDIA" configuration touchpoint, two underlying providers.
5. Minimal changes to the routing pipeline — one small generalization to support multiple local providers, otherwise NVIDIA providers are first-class citizens in the existing contract-based routing system.

## Non-Goals

1. **Data sovereignty policy engine** — cross-cutting concern for all providers. Separate Epic (EP-AUTH-002 or future EP-POLICY-001). This spec ensures NVIDIA provider entries carry correct `sensitivityClearance` metadata so the policy engine can act on it.
2. **Bundled NIM in Docker Compose** — Phase 2. NIM has its own container orchestration (NGC catalog, GPU passthrough). Initial integration connects to externally-running NIM instances.
3. **NVIDIA-specific UI beyond provider panel** — uses existing provider management patterns. Link to NVIDIA docs from the provider panel.
4. **Authentication layer hardening** — separate Epic (EP-AUTH-002). NVIDIA's auth is straightforward (API key for cloud, none for local).

---

## Architecture: Dual-Provider with Unified Facade

### Design Decision

Two `ModelProvider` entries under the hood (`nvidia-cloud`, `nvidia-nim`), presented as a single "NVIDIA" configuration experience in the admin UI.

**Why dual-provider, not unified?**
- The platform already has this pattern: `anthropic` (API key) vs. `anthropic-sub` (OAuth subscription) are distinct providers with different auth, cost models, and access constraints.
- The routing pipeline, discovery, profiling, and recipe systems all operate per-provider. A single provider with two deployment modes would require schema changes and complicate the routing layer.
- The facade is a UI concern — the admin sees "NVIDIA" and configures cloud key and/or local endpoint. The platform creates the appropriate provider entries.

### Provider Entries

| Field | `nvidia-cloud` | `nvidia-nim` |
|-------|----------------|--------------|
| `providerId` | `nvidia-cloud` | `nvidia-nim` |
| `name` | NVIDIA Cloud (build.nvidia.com) | NVIDIA NIM (Local) |
| `category` | `direct` | `direct` |
| `authMethod` | `api_key` | `none` |
| `authHeader` | `Authorization: Bearer` | — |
| `baseUrl` | `https://integrate.api.nvidia.com` | User-configured (e.g., `http://localhost:8000`) |
| `endpoint` | `/v1/chat/completions` | `/v1/chat/completions` |
| `costModel` | `token` | `compute` |
| `sensitivityClearance` | `["public", "internal", "confidential"]` | `["public", "internal", "confidential", "restricted"]` |
| `families` | Full NVIDIA catalog | Whatever models are deployed locally |
| `status` | `unconfigured` → `active` | `unconfigured` → `active` |
| `supportsToolUse` | `true` (model-dependent) | `true` (model-dependent) |
| `supportsStreaming` | `true` | `true` |
| `supportsStructuredOutput` | Model-dependent | Model-dependent |

### API Compatibility

Both NVIDIA cloud and NIM expose OpenAI-compatible APIs (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`). No new execution adapter is required — the existing OpenAI-compatible chat adapter path handles both.

**Metadata adapter:** The adapter registry (`adapter-registry.ts`) needs entries for both NVIDIA providers so that `extractModelCardWithFallback()` produces quality ModelCards rather than falling through to the low-fidelity fallback path. Since NVIDIA's `/v1/models` metadata format follows the OpenAI schema, register the existing OpenAI metadata adapter for both `nvidia-cloud` and `nvidia-nim`. If NVIDIA-specific metadata fields emerge later, a dedicated adapter can replace it.

---

## Model Discovery & Profiling

### Discovery Flow

Discovery uses the existing `discoverModelsInternal(providerId)` pipeline:

1. Call `/v1/models` on the provider's `baseUrl`
2. Parse response using the OpenAI-compatible parser (`{ data: [{ id: "..." }] }`)
3. Upsert `DiscoveredModel` records with full `rawMetadata`
4. Increment `missedDiscoveryCount` for models not seen (retirement detection)

**NVIDIA model ID format:** Namespaced as `org/model-name` (e.g., `nvidia/nemotron-4-340b-instruct`, `meta/llama-3.1-405b-instruct`, `snowflake/arctic-embed-l`). These IDs pass through to `DiscoveredModel.modelId` unchanged.

### Model Classification

The existing `model-classifier.ts` needs new patterns for NVIDIA models. **Important:** NVIDIA model IDs are namespaced as `org/model-name` (e.g., `nvidia/nemotron-4-340b-instruct`). Existing classifier patterns use `^` anchors (start of string), so patterns like `/^codellama/` will not match `meta/codellama-70b-instruct`. New patterns must match anywhere in the ID string, not just the start.

**New patterns to add:**

| Pattern (regex) | Class | Examples |
|---------|-------|----------|
| `/nemotron/i` | `chat` | `nvidia/nemotron-4-340b-instruct` |
| `/nv-embed\|arctic-embed/i` | `embedding` | `snowflake/arctic-embed-l`, `nvidia/nv-embed-v2` |
| `/codellama\|deepseek-coder\|starcoder/i` | `code` | `meta/codellama-70b-instruct` |
| `/stable-diffusion\|sdxl/i` | `image_gen` | `stabilityai/sdxl-turbo` |
| `/vlm\|llava\|fuyu/i` | `chat` (vision) | `adept/fuyu-8b` |

Existing patterns for `llama`, `mistral`, `mixtral`, `phi` should also be updated to match anywhere in the ID string (not just `^` anchored) so they work with namespaced IDs. This is a general improvement that benefits all providers using namespaced model IDs.

Models not matching known patterns default to `chat` and get profiled through the standard pipeline.

### Baseline Scores

New entries in `seed-model-baselines.ts` for NVIDIA-proprietary model families:

| Pattern | Reasoning | Codegen | Tool Fidelity | Instruction Following | Structured Output | Conversational | Context Retention |
|---------|-----------|---------|---------------|----------------------|-------------------|----------------|-------------------|
| `nemotron-4-340b` | 82 | 78 | 55 | 78 | 60 | 75 | 70 |
| `nemotron-4-15b` | 62 | 58 | 42 | 62 | 45 | 65 | 52 |
| `nemotron-mini` | 50 | 45 | 35 | 55 | 38 | 60 | 42 |

**Note:** These Nemotron baselines are provisional estimates based on model size relative to known benchmarks. They carry `profileConfidence: "low"` and will be refined through the champion/challenger pipeline as real usage data accumulates. This is consistent with how all baselines are seeded — initial estimates that the adaptive loop replaces with evidence.

Models hosted on NVIDIA that belong to existing families (Llama, Mistral, Phi, etc.) inherit their existing baselines. The profiling pipeline refines all scores through usage data via champion/challenger.

---

## Routing Integration

### Sensitivity-Driven Routing

The existing contract-based routing pipeline (EP-INF-005a) handles sensitivity-based provider filtering:

1. `RequestContract` carries a `sensitivityLevel` field
2. Feasibility filter checks `provider.sensitivityClearance` includes the request's sensitivity level
3. For `restricted` data → only `nvidia-nim` passes feasibility (if available)
4. For `public`/`internal`/`confidential` data → both `nvidia-cloud` and `nvidia-nim` are feasible
5. Scoring ranks by cost, latency, and capability scores
6. If the same model exists on both providers, local NIM wins on cost (compute-based pricing) when available

### Local Residency Generalization

**Required pipeline change:** The `residencyPolicy: "local_only"` check in `pipeline-v2.ts` is currently hardcoded to `ep.providerId !== "ollama"`. This must be generalized to support any local provider, not just Ollama. The fix:

- Introduce an `isLocalProvider(providerId)` helper in `provider-utils.ts` that returns `true` for `"ollama"` and `"nvidia-nim"`. This follows the established pattern used by `isAnthropic()` and `isOpenAI()` and works at the `EndpointManifest` level (which does not carry `costModel`). Replace the Ollama-specific check in `pipeline-v2.ts` with `!isLocalProvider(ep.providerId)`
- Update corresponding tests in `pipeline-v2.test.ts` to cover `nvidia-nim` as a valid local provider
- This is a small, targeted change — the routing architecture itself is unchanged

### Failover Behavior

Standard provider failover applies:

- `nvidia-nim` unreachable → fall back to `nvidia-cloud` (if sensitivity allows)
- `nvidia-cloud` rate-limited or down → fall back to `nvidia-nim` (if available)
- Both NVIDIA providers unavailable → fall back to other platform providers (Anthropic, OpenAI, etc.)
- Sensitivity constraint blocks all options → fail with clear error, never route sensitive data to a provider with insufficient clearance

### Data Sovereignty Warnings

**Not in scope for this Epic.** The data sovereignty policy engine is a separate cross-cutting concern (tied to business model/policy definition — not yet tightened up). This Epic ensures:

- `nvidia-cloud` carries `sensitivityClearance: ["public", "internal", "confidential"]` — matching other cloud providers. The routing system won't send restricted data to it
- `nvidia-nim` carries full clearance — local data stays local
- When the policy engine Epic lands, NVIDIA providers will benefit automatically because the metadata is already correct

---

## Execution Recipes

Seed recipes for both providers, starting with `chat` contract family:

```
nvidia-cloud / chat:
  executionAdapter: "chat"
  providerSettings: { temperature: 0.7 }
  toolPolicy: { toolChoice: "auto" }
  responsePolicy: { stream: true }
  status: "champion"
  origin: "seed"

nvidia-nim / chat:
  executionAdapter: "chat"
  providerSettings: { temperature: 0.7 }
  toolPolicy: { toolChoice: "auto" }
  responsePolicy: { stream: true }
  status: "champion"
  origin: "seed"
```

Additional recipes for embedding, code, and image_gen contract families are auto-generated by the recipe seeder when models of those classes are discovered.

**Tool use caveat:** Not all NVIDIA-hosted models support function calling. The discovery/profiling step must set `supportsToolUse` per model based on API metadata. Models without tool support get filtered out by contract-based routing when a `RequestContract` requires tools — no special handling needed.

**Recipe seeder note:** The recipe seeder (`recipe-seeder.ts`) has provider-specific branches (`isAnthropic()`, `isOpenAI()`) for thinking budgets, temperature maps, and reasoning effort. NVIDIA models will use the generic fallback path, which produces functional recipes. If Nemotron-specific parameters emerge (e.g., custom sampling controls), an `isNvidia()` branch can be added later. For initial integration, the generic path is sufficient.

---

## Admin UX

### Provider Panel

The existing provider management UI shows one "NVIDIA" card (not two separate entries). Implementation approach:

- Provider panel groups `nvidia-cloud` and `nvidia-nim` under a single "NVIDIA" heading
- Shows two sections within: **Cloud** and **Local**
- Cloud section: API key input, status indicator, model count
- Local section: endpoint URL input, status indicator, model count
- If only one is configured, only that section appears
- Link to NVIDIA build.nvidia.com / NIM documentation in the panel (existing provider link pattern)

### Health Checks

Follow existing patterns:

- **`nvidia-cloud`**: Periodic `/v1/models` call + API key validation. If reachable and unconfigured → set `active`. If unreachable and active → set `inactive`.
- **`nvidia-nim`**: Same pattern as Ollama health check — check endpoint reachability, set active/inactive. The current Ollama health check (`ollama.ts`) is hardcoded to `providerId: "ollama"`. For NIM, either generalize `checkBundledProviders()` to accept a provider ID parameter, or create a parallel `nim-health.ts` with the same logic. Generalization is preferred to avoid duplication. GPU hardware info can be detected via NIM's system endpoint if available.

---

## Phase 2: Bundled NIM (Future)

Not in scope for this Epic, but the architecture supports it:

- Add `nvidia-nim` as an optional service in `docker-compose.yml`
- Platform detects NVIDIA GPU hardware and offers NIM alongside/instead of Ollama
- Auto-creates `nvidia-nim` provider entry when bundled service is detected
- More robust, differentiated route to models and capabilities compared to Ollama

This becomes a differentiator — the platform manages NIM lifecycle, model downloads, and GPU allocation as a first-class capability.

---

## Recommended Follow-On Epic: Provider Authentication Hardening

**Epic:** EP-AUTH-002 — Provider Authentication Layer Hardening

**Problem:** The platform currently supports four auth methods (`api_key`, `oauth2_authorization_code`, `oauth2_client_credentials`, `none`), but debugging authentication across even two active providers (Anthropic API key, Anthropic subscription OAuth) is painful. As more providers come online (NVIDIA, Gemini, Cohere, Azure OpenAI, Vertex AI), the auth surface area grows and each provider has its own quirks.

**Scope:**
1. Audit every provider's actual authentication methods and requirements
2. Identify gaps (Azure AD-backed auth for Azure OpenAI, Google service accounts for Vertex AI, NGC API keys for NVIDIA, team/org API keys)
3. Design an extensible auth adapter pattern — each provider gets a typed auth handler with provider-specific validation, token refresh, and error classification
4. Fix current pain points in the Anthropic API key and OAuth flows
5. Standardize credential validation at configuration time (not first-request time)
6. Improve auth error UX — clear messages when credentials expire, are revoked, or lack required scopes

**Relationship to NVIDIA Epic:** NVIDIA's auth needs (API key, none) are simple and don't require EP-AUTH-002. But EP-AUTH-002 ensures the platform is ready for providers with more complex auth (Azure OpenAI, Vertex AI, enterprise SSO).

**Relationship to data sovereignty:** The data sovereignty policy engine (future Epic) will depend on business model/policy definition being tightened up. It applies across all providers, not just NVIDIA. This Epic ensures NVIDIA carries correct `sensitivityClearance` metadata so the policy engine benefits automatically when it lands.

---

## Implementation Scope

### Seeding Path

The full seeding path for a new provider:

1. Add provider entries in `seed-routing-profiles.ts` → creates `ModelProvider` rows with capability scores
2. Sync creates `CredentialEntry` rows (unconfigured until admin provides API key / endpoint)
3. Admin configures credentials → status transitions to `active`
4. `discoverModelsInternal(providerId)` runs → creates `DiscoveredModel` rows
5. `profileModelsInternal(providerId)` runs → creates `ModelProfile` rows using baselines from `seed-model-baselines.ts`
6. Recipe seeder generates `ExecutionRecipe` rows per discovered model + contract family

### Files to Create/Modify

| File | Change |
|------|--------|
| `packages/db/scripts/seed-routing-profiles.ts` | Add `nvidia-cloud` and `nvidia-nim` provider entries |
| `packages/db/scripts/seed-model-baselines.ts` | Add Nemotron family baselines (`profileConfidence: "low"`) |
| `apps/web/lib/routing/model-classifier.ts` | Add NVIDIA-specific patterns + fix `^` anchoring for namespaced IDs |
| `apps/web/lib/routing/provider-utils.ts` | Add `isNvidia()` and `isLocalProvider()` helpers |
| `apps/web/lib/routing/adapter-registry.ts` | Register OpenAI metadata adapter for `nvidia-cloud` and `nvidia-nim` |
| `apps/web/lib/routing/pipeline-v2.ts` | Generalize `residencyPolicy: "local_only"` check from Ollama-specific to `isLocalProvider()` |
| `apps/web/lib/routing/pipeline-v2.test.ts` | Add tests for `nvidia-nim` as valid local provider |
| Provider management UI components | Group nvidia-cloud/nvidia-nim under single NVIDIA card |
| `apps/web/lib/ollama.ts` or new `apps/web/lib/nim-health.ts` | NIM health check (generalize from Ollama pattern, parameterized by provider ID) |

### Files Unchanged

- `apps/web/lib/ai-inference.ts` — NVIDIA uses OpenAI-compatible API
- `apps/web/lib/routing/chat-adapter.ts` — existing OpenAI-compatible execution adapter works
- `packages/db/prisma/schema.prisma` — no schema changes
- Routing architecture (contract-based-selection, execution-recipes, scoring) — unchanged beyond the `local_only` generalization

### Testing

- Seed data validation: provider entries created correctly with full seeding path
- Discovery: mock `/v1/models` response with NVIDIA namespaced model IDs, verify parsing
- Classification: Nemotron, embedding, code models classified correctly despite `org/` prefix
- Routing: sensitivity-based feasibility filtering with both providers
- Residency: `local_only` requests route to `nvidia-nim` (not just Ollama)
- Failover: cloud↔local fallback respects sensitivity constraints
- Health check: NIM endpoint detection and status transitions
- Metadata: adapter registry produces quality ModelCards for NVIDIA models

---

## Epic Dependency Graph

```
EP-INF-003 (Routing Pipeline) ──────────┐
EP-INF-005b (Execution Recipes) ────────┤
EP-INF-008 (Model Capabilities) ────────┼──► EP-INF-011 (NVIDIA Integration)
EP-INF-009c (Alternate Adapters) ───────┘         │
                                                   │
                                                   ├──► Phase 2: Bundled NIM
                                                   │
EP-AUTH-002 (Auth Hardening) ──────────────────── independent, parallel
                                                   │
Future EP-POLICY-001 (Data Sovereignty) ────────── depends on business model definition
```
