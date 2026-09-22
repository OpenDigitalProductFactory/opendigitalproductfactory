---
status: draft
---

# Situational LLM Call Parameterization

**Date:** 2026-09-18
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)

**Supersedes:** [EP-INF-005b Execution Recipes](2026-03-20-execution-recipes-design.md) §3 (Provider-Specific Parameter Construction) and §2 (`buildDefaultPlan` parameter defaults). Everything else in EP-INF-005b — the `ModelRecipe` table, `RoutedExecutionPlan` shape, recipe lookup, `RouteDecision` extension — stands and is extended here.

**Related (unchanged, read for context):**
- [EP-INF-005a Contract-Based Selection](2026-03-20-contract-based-selection-design.md) — owns `RequestContract`, including `reasoningDepth` and `budgetClass`.
- [AI Routing Architecture Explainability](2026-07-26-ai-routing-architecture-explainability-design.md) — owns the operator-facing routing explanation this design extends.
- [Local Model Policy: Single Generation](2026-06-19-local-model-policy-single-generation.md), [Local Model Management](2026-08-24-local-model-management-design.md), [Local AI Stack GPU/VRAM Tiering](2026-08-05-local-ai-stack-gpu-vram-tiering.md) — own local model lifecycle and served context. This design adds the *sampling* layer they do not cover.
- [Local Fallback Eligibility Invariant](2026-08-26-local-fallback-eligibility-invariant-design.md) — the precedent for "a degraded posture leaves a trace", applied here to preferences.
- Kernel: [`no-provider-pinning`](../../founder-kernel/wiki/principles/no-provider-pinning.md) (core).

---

## Problem Statement

DPF selects the right model well. It then calls that model with parameters that are mostly absent, and where present, keyed off the wrong thing.

EP-INF-005b anticipated this exactly — its own problem statement says `callProvider()` "never sets `temperature`, `reasoning_effort`, `thinking` budgets". It then built the mechanism and a parameter policy that was reasonable in March 2026 and has since been outrun by the model landscape. **The gaps below are defects in that spec, faithfully implemented. This is a supersession, not a bug report.**

### D-1 — The parameter logic is off the live path

All per-situation parameter construction lives in `buildProviderSettings` ([recipe-seeder.ts:113](../../../apps/web/lib/routing/recipe-seeder.ts)). Its only caller is [model-card-maintenance.ts:105](../../../apps/web/lib/inference/model-card-maintenance.ts), a maintenance job that writes *champion* recipes per contract family.

When no recipe row matches the selected endpoint, [pipeline-v2.ts:723](../../../apps/web/lib/routing/pipeline-v2.ts) falls through to `buildDefaultPlan`, which sets `maxTokens: 4096, providerSettings: {}`. EP-INF-005b §2 describes this as "the backward-compatible fallback". In practice it is the path any non-champion winner takes: no temperature, no thinking budget, no reasoning effort — provider defaults.

### D-2 — Temperature is keyed off budget, not task

`OPENAI_CHAT_TEMPERATURE` ([recipe-seeder.ts:37](../../../apps/web/lib/routing/recipe-seeder.ts)) maps `minimize_cost → 0.3`, `balanced → 0.7`, `quality_first → 1.0`.

Budget class says how much we are willing to *spend*. Temperature governs how much we are willing to *vary*. They are unrelated axes, and the mapping is actively inverted for the most common high-value case: a deterministic field extraction run on a `quality_first` budget gets **temperature 1.0** — maximum variance on the task that most needs none.

### D-3 — Reasoning depth is discarded for most providers

`buildProviderSettings` branches on Anthropic and OpenAI, then falls to `// Generic fallback: just max_tokens`. Gemini, OpenRouter, DeepSeek, xAI, Mistral and Z.ai all land there. `thinkingBudget` / `thinkingConfig` appears nowhere in the tree — verified by grep across `apps/web`.

So `contract.reasoningDepth` is computed, carried through the whole pipeline, and then dropped on the floor for every provider except two. Thinking budgets are also fixed constants (4096/8192) regardless of input size.

### D-4 — Local models run at engine defaults

For local, `buildProviderSettings` sets exactly one key: `keep_alive: -1`. No sampling parameters at all.

This is the sharpest defect because local is not a fallback on this install — it is the primary path. A live `resolve_model_selection` dry-run on 2026-09-18 returned all five build phases on `local · huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M`, 131,072 served context, "8 endpoint(s) excluded; 1 candidate(s) ranked".

Qwen3 publishes **required** sampling settings — temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 in thinking mode, 0.7 / 0.8 / 20 otherwise — and documents that running at engine defaults (temp ~0.8–1.0, top_k 40, repeat_penalty 1.1) produces repetition loops and degraded reasoning. DeepSeek-R1 documents 0.6 / 0.95 for the same reason. We are running the documented failure configuration on our primary workhorse.

Compounding it: local calls go through the OpenAI-compatible `/v1/chat/completions` branch ([chat-adapter.ts:387](../../../apps/web/lib/routing/chat-adapter.ts)), which cannot express Ollama's `options` block, its `think` toggle, or `format: <json-schema>` grammar-constrained decoding.

### D-5 — Pins that a non-technical operator cannot undo

The routing layer's preference handling is already correct. [preference-finalization.ts](../../../apps/web/lib/routing/preference-finalization.ts) applies preferences only *within* the fenced ranked set; an unavailable preference falls back to the canonical winner, an unavailable model pin walks to its family successor, and the outcome is recorded as `RoutePreferenceResolution { requested, applied, unavailable, fallbackUsed }`. `no-provider-pinning` is doctrine, and the UI offers "Auto-route (no pin)" and "Clear pin".

Three leaks defeat that:

1. **A pin in source has no Clear button.** [agent-routing.ts:427](../../../apps/web/lib/tak/agent-routing.ts) hardcodes `preferredProviderId: "anthropic"` for `/compliance`. The same hardcode was removed from `/build` with a comment citing this exact principle ([agent-routing.ts:630](../../../apps/web/lib/tak/agent-routing.ts)) after the 2026-05-12 "Pinned provider 'codex' not available" incident. The cleanup stopped at one route.
2. **One control, two decisions.** [mcp-task-execution.ts:118](../../../apps/web/lib/mcp-task-execution.ts): `pinnedProviderId === "local"` *also* sets `residencyPolicy: "local_only"` — a hard fence. Clearing a routing preference from a dropdown silently relaxes a data-residency guarantee; setting one silently imposes it.
3. **The platform recommends the thing doctrine forbids.** The live `resolve_model_selection` response ends: *"pin the OpenCode model in Build Runtime to make the choice explicit."*

### D-6 — Parameters are not in the explanation

`RouteDecision` carries `executionPlan` ([types.ts:212](../../../apps/web/lib/routing/types.ts)), so the data exists. But `formatDecisionForUser` ([explain.ts:11](../../../apps/web/lib/routing/explain.ts)) explains *model choice* only. An operator can see why Qwen3 was picked and cannot see that it was called at temperature 1.0. "Set the parameters transparently" requires the transparency half.

---

## Goals

1. Every dispatch carries deliberate parameters — including the `buildDefaultPlan` path.
2. Sampling parameters follow the **model** (vendor requirements) and the **task** (contract family), never the budget.
3. Reasoning depth reaches every provider that can express it.
4. Local calls can express sampling, thinking and schema-constrained decoding.
5. New models arrive with correct parameters via discovery, not via a code change.
6. No preference is ever unclearable, and none silently changes a safety policy.
7. The parameters used are visible wherever the model choice is visible.

## Non-Goals

1. Replacing model *selection* — EP-INF-005a's ranking is unchanged.
2. A learned/semantic router. Evaluated below; rejected for now.
3. Local serving-engine changes (speculative decoding, KV quantization). Separate concern, separate spec.
4. Per-user parameter tuning UI. Operators get visibility and an override escape hatch, not a mixing desk.

---

## Section 1 — `ModelCardSampling` (D-1, D-4, and the "keep up continuously" requirement)

The thing that goes stale as DeepSeek, Qwen, Hermes and the rest iterate is the **per-model recommended parameter set**. It therefore belongs on the model card as discovered/curated metadata, next to `capabilities`, `pricing` and `dimensionScores` — not in a constant table in TypeScript.

```typescript
export interface ModelCardSampling {
  /** Vendor-recommended defaults for this model's normal (non-thinking) mode. */
  default: SamplingProfile | null;
  /** Vendor-recommended defaults when the model is reasoning/thinking. */
  thinking: SamplingProfile | null;
  /** Parameters this model rejects outright (e.g. Anthropic: temperature with thinking on). */
  unsupported: string[];
  /** Where these values came from — same provenance ladder as profileSource. */
  source: "catalog" | "discovered" | "operator" | "seed";
}

export interface SamplingProfile {
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  minP: number | null;
  repeatPenalty: number | null;
}
```

**Provenance follows the existing ladder.** `source: "seed"` is a placeholder, exactly as `profileSource: "seed"` already is for dimension scores ([provider-routing-rollup.ts:61](../../../apps/web/lib/inference/provider-routing-rollup.ts) — "a seed row is a placeholder, not a measurement"). Curated catalog values overwrite seed; operator values overwrite catalog; discovery refreshes catalog.

**Seed values** for the families we serve, from vendor documentation:

| Family | Default | Thinking |
|---|---|---|
| Qwen3 / Qwen3-Coder | 0.7 / 0.8 / 20 / — | 0.6 / 0.95 / 20 / 0 |
| DeepSeek-R1 (+ distills) | — | 0.6 / 0.95 / — / — |
| Hermes 4 | 0.7 / 0.8 / 20 / — | 0.6 / 0.95 / 20 / — |
| Gemma | 1.0 / 0.95 / 64 / — | — |
| Llama 3.x | 0.6 / 0.9 / — / — | — |

*(temperature / top_p / top_k / min_p; `—` = leave unset)*

This is the one table that needs a curation cadence. It is small, it is data, and it lives where discovery can refresh it — per `commons-are-curated-not-just-appended`.

### Decision D1 — `resolveSamplingProfile` runs on every path

A single pure function composes the final parameter set, and **both** `buildPlanFromRecipe` and `buildDefaultPlan` call it:

```
modelCard.sampling[mode]          ← vendor floor (what the model requires)
  ⊕ contractFamilyProfile(family)  ← task intent (§2), clamped to vendor range
  ⊕ recipe.providerSettings        ← champion/challenger learning
  ⊕ operator override              ← explicit, recorded, expiring
  ⊖ modelCard.sampling.unsupported ← drop what this model rejects
```

Later layers may narrow within the vendor's documented range; none may leave it. `buildDefaultPlan` stops being "no parameters" and becomes "vendor + contract parameters, no recipe learning" — which is the correct meaning of a default.

---

## Section 2 — Contract-family temperature (D-2)

`OPENAI_CHAT_TEMPERATURE` is deleted. Temperature is a property of the **contract family**, which `RequestContract` already carries and which already names the task shape (`sync.tool_action`, `sync.code_gen`, …):

| Contract family | Temperature intent |
|---|---|
| extraction, classification, schema-bound output | 0.0 — one right answer |
| tool_action, code_gen | 0.2 — correctness over variety |
| analysis, review, reasoning | vendor thinking-mode default (typically 0.6) |
| conversation, drafting | 0.7 |
| ideation, naming, creative | 0.9 |

Budget class keeps its real job: choosing the model and capping spend. It no longer touches sampling.

Where a model publishes a thinking-mode profile and the contract asks for reasoning, the vendor profile wins over the table — the vendor knows its model; the table encodes our intent.

---

## Section 3 — Reasoning depth reaches every provider (D-3)

`applyAnthropicSettings` / `applyOpenAIReasoningSettings` are generalized into one `resolveEffort(contract, modelCard)` producing a provider-neutral effort decision, which each adapter then expresses in its own dialect:

| Provider | Expression |
|---|---|
| Anthropic | `thinking: {type: "enabled", budget_tokens}` / `{type: "adaptive"}`; `max_tokens` raised by the budget; temperature dropped |
| OpenAI reasoning | `reasoning_effort` |
| Gemini | `generationConfig.thinkingConfig.thinkingBudget` **(new)** |
| OpenRouter | `reasoning: {effort}` **(new)** |
| DeepSeek / xAI / Z.ai | provider-native reasoning field **(new)** |
| Local | `think: true` on native transport (§4) **(new)** |
| No support | no-op, recorded as `effortUnexpressed` in the trace |

**Thinking budgets become proportional**, not constant: derived from `contract.estimatedInputTokens` and depth, clamped to the model's output ceiling. A one-line classification and a 40k-token architecture review should not both get 8192 thinking tokens.

`modelCard.capabilities.effortLevels` (already on the card, currently unused) gates what each model will accept.

---

## Section 4 — Native local transport (D-4)

Add a `local-native` execution adapter that talks to Ollama's `/api/chat` instead of the OpenAI-compatible shim, selected when the endpoint advertises the native API and falling back to `/v1/chat/completions` when it does not.

It gains three things the shim cannot express:

1. **`options`** — `temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `num_predict`, `num_ctx`. `num_ctx` is **read from the existing served-context reconciler** ([local-model-context-reconcile.ts](../../../apps/web/lib/inference/local-model-context-reconcile.ts)), never invented here — that module already computes a VRAM-aware ceiling and is the single source of truth for the served window.
2. **`think`** — the reasoning toggle, driven by §3.
3. **`format: <json-schema>`** — grammar-constrained decoding when `contract.requiresStrictSchema`. This makes malformed JSON mechanically impossible for single-digit-percent token overhead, and is the highest-leverage local reliability fix after sampling.

`keep_alive: -1` survives unchanged.

---

## Section 5 — Preferences, not pins (D-5)

**A preference is a dated, reasoned request that routing honours when it can and reports when it cannot. It is never a constraint.** Constraints are expressed as contract requirements — residency, sensitivity, tool fidelity, minimum dimensions — which are inspectable, explain themselves, and cannot be created accidentally from a dropdown.

The routing-layer mechanism already implements this. The work is closing the leaks:

- **D5-a — Remove the source pin.** Delete `preferredProviderId: "anthropic"` from `/compliance`. Encode what that route actually needs (`minimumDimensions`, `qualityTier`, reasoning floor) the way `no-provider-pinning` §"How To Apply" prescribes. Add a lint/test that fails on any literal `preferredProviderId` / `pinnedProviderId` in route config — the cleanup stopped at one route last time because nothing prevented the next one.
- **D5-b — Split residency from preference.** `residencyPolicy: "local_only"` becomes its own explicit field on `AgentModelConfig`, set deliberately and shown as a policy, never inferred from `pinnedProviderId === "local"`. Migration: existing rows with a `local` pin get `residencyPolicy: "local_only"` written explicitly, preserving today's behaviour while making it visible.
- **D5-c — Surface the unhonoured preference.** `fallbackUsed: true` already exists on `RoutePreferenceResolution` and is already surfaced structurally. Route it to the operator as a resolved, clearable event: *"Compliance ran on Claude Opus 5. Your preference for Codex has been unavailable since Tuesday. Keep preferring it, or clear it?"* — one click either way. This is the [local-fallback-eligibility-invariant](2026-08-26-local-fallback-eligibility-invariant-design.md) `OBJ-VISIBLE-DEGRADE` objective applied to preferences.
- **D5-d — Stop recommending pins.** The `embedding-model-first` remediation text in `resolve_model_selection` tells operators to pin. Replace with the ordering fix, which is the actual remedy.

**Answering "what happens when a pinned route is unavailable":** route by contract, run the work, record the preference as unhonoured, and tell the operator once with a one-click clear. Never fail the turn. Never silently walk the fallback chain — that is the 2026-04-20 build-specialist incident (`codex → … → local Gemma`, Build Studio stalled for hours) that produced the doctrine.

---

## Section 6 — Transparency (D-6)

The execution plan is already on `RouteDecision`. Extend the explanation, not the data:

- `formatDecisionForUser` gains a parameter line: *"Called at temperature 0.0, thinking off — this is a schema-bound extraction."* Layman-readable, per §12 "hide complexity from layman users": intent first, numbers second.
- The routing page ([platform/ai/routing](../../../apps/web/app/(shell)/platform/ai/routing/page.tsx)) shows resolved parameters and **their provenance layer** — vendor / contract / recipe / operator. Provenance is the point: an operator seeing "temperature 0.6 (vendor: Qwen3 thinking)" understands it is not our arbitrary choice.
- `effortUnexpressed` and preference `fallbackUsed` are shown, not just stored.

---

## Research & Benchmarking

Per AGENTS.md §7. Three comparators, chosen because each solves a piece of this differently.

**vLLM Semantic Router** (open source, ~2026) — learned classifier routes per-query across a model pool. *Adopt:* the framing that routing decisions belong in one place with a measured latency budget. *Reject for now:* a learned classifier adds 50–200ms per call versus ~11µs for a compiled gateway, and DPF's deterministic `RequestContract` inference already captures task shape without inference cost. Revisit when we have production reward data to train on — `production-feedback.ts` and `reward.ts` are the substrate that would make it possible.

**Claude Code / Codex agent controls** (2026) — the current state of the art in coding harnesses is per-turn difficulty routing (published figures: 60–80% of agent turns are routine and produce identical output on a cheap model) and *per-subagent model plus reasoning budget*. *Adopt:* effort is a per-call dial, not a session setting — this is exactly §3's proportional budgets. DPF already classifies per call and spends the classification only on model choice; extending it to effort is the cheap half of the win. *Reject:* their pattern of exposing model choice to the end user; DPF's operators are non-technical and the platform should decide.

**Ollama / llama.cpp structured output** — schema-to-grammar compilation, mandatory-parameter tables per model. *Adopt:* both, in §4 and §1. *Note:* the vendor-parameter table is precisely what we must track continuously, which is why §1 puts it on the model card under discovery rather than in code.

**What we do that they do not:** none of the three carries provenance for a parameter, and none can explain a call to a non-technical operator. The `source` field in §1 and the provenance display in §6 are DPF's differentiator, and they fall out of substrate (`profileSource`, `RouteDecision`) that already exists.

---

## Testing Strategy

Pure-function first, per `dpf-tdd`.

- `sampling-profile.test.ts` — vendor floor wins over contract table; contract narrows within vendor range; `unsupported` strips rejected keys; operator override is recorded; **`buildDefaultPlan` produces a populated profile** (the D-1 regression guard).
- `contract-family-temperature.test.ts` — extraction → 0.0 regardless of budget class (the D-2 regression guard, stated as the inverted case: `quality_first` extraction must not be 1.0).
- `effort-expression.test.ts` — one effort decision expressed correctly per provider dialect; Gemini emits `thinkingBudget`; unsupported providers no-op and record `effortUnexpressed`; budgets scale with input size and clamp to the output ceiling.
- `local-native-adapter.test.ts` — `options` carries sampling; `num_ctx` comes from the reconciler and is never invented; `format` set when `requiresStrictSchema`; graceful fallback to `/v1` when native is absent.
- `no-literal-pins.test.ts` — the guard that keeps D5-a from regressing a third time.
- `preference-resolution.test.ts` — unavailable preference routes by contract, never fails the turn, always records `fallbackUsed`.
- Migration test — `local` pin rows gain explicit `residencyPolicy`, behaviour unchanged.

**Runtime verification** (§4 gate): a live dispatch on the install, confirming Qwen3 is called at 0.6/0.95/20/0 in thinking mode, and that the routing page shows the parameters with provenance.

---

## Files

**New:** `routing/sampling-profile.ts`, `routing/contract-family-sampling.ts`, `routing/effort-expression.ts`, `routing/adapter-local-native.ts`, plus tests.

**Modified:** `routing/model-card-types.ts` (+`ModelCardSampling`), `routing/recipe-seeder.ts` (parameter construction moves out), `routing/execution-plan.ts` (both builders resolve sampling), `routing/chat-adapter.ts` (Gemini thinking, generic effort), `routing/explain.ts` (+parameter line), `inference/known-model-seeding.ts` (+seed sampling), `tak/agent-routing.ts` (−pin), `mcp-task-execution.ts` (residency split), `platform/ai/routing/page.tsx` (+provenance display).

**Migration:** `ModelCard.sampling` JSON column; `AgentModelConfig.residencyPolicy` with backfill.

---

## Open Questions

1. **Operator override expiry.** §1 allows an operator sampling override. Should it expire by default (say 90 days) the way a stale preference should? Leaning yes — an override is a workaround with a shelf life, and permanent overrides recreate pinning one layer down.
2. **Challenger scope.** Should champion/challenger explore *parameters* as well as models? It is the natural way to learn the contract-family table from production rather than assert it. Deferred — needs the §1 plumbing landed first to have anything to vary.
