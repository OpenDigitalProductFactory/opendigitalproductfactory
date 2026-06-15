# Local Multimodal Capability (Gemma 4 12B) — Spike Design

- **Status:** spike (evidence-gathering); BI **BI-7C8E3F8F** filed under `EP-ROUTING-11`
- **Date:** 2026-06-15
- **Author:** Claude (autonomous spike)
- **Epic:** EP-ROUTING-11 (Routing substrate + execution adapters)

## Summary

Register **Gemma 4 12B** (multimodal-IN / text-OUT, Apache 2.0, released 2026-06-03) as a
new **local vision capability** on the existing Docker Model Runner (DMR) substrate, without
disturbing the code-gen path (`qwen3-coder`) or the embeddings path (`nomic-embed-text`).
Prove it end-to-end on one high-value use case: **vision-based UI cognitive-load assessment
feeding the existing WWMD `human_cognitive_load` rubric** — closing the "structural ≠ functional"
gap on UI evaluation by giving the rubric *real visual input* for the first time.

## On-machine verification (done before scoping)

1. **DMR tag.** `ai/gemma4:12B` resolves directly in the Docker Hub `ai/` catalog at **7.54 GB**
   (≈Q4). `docker model pull ai/gemma4:12B` — no GGUF side-pull needed. Zero-click story holds.
   (Family also publishes E2B/E4B/4B/12B/26B/31B + `gemma4-safetensors`.)
2. **VRAM.** RTX 4090, 24564 MiB. Idle baseline 1353 MiB (qwen3-coder idle-unloaded — DMR
   load-on-demand confirmed). Measured: `gemma4:12B` resident ~14988 MiB; **gemma4 + qwen3-coder
   co-resident ~22525 MiB / 24564 MiB (both fit, ~1.6 GB headroom)**. Cold model load ~40 s;
   warm = no swap. Co-residency is better than predicted — common case needs no swap, but thin
   headroom means a large context window can still force an eviction. `docker model ps` shows a
   per-model idle TTL (auto-unload).
3. **Activation probe** (OpenAI-compatible `/v1/chat/completions`, base64 `image_url` blocks):
   - **Text:** works. Gemma 4 12B is a **reasoning model** — emits a separate `reasoning_content`
     field; with a low `max_tokens` the budget is consumed by reasoning before any `content`
     appears (empty content + `finish_reason:"length"`). With adequate budget, correct answers.
   - **Vision sanity:** "3 red squares, 2 blue circles" → `3 and 2` (correct).
   - **Cognitive-load discrimination:** clean single-action card → `{cognitive_load:0.1,
     visual_density:0.1, control_count_estimate:2}`; dense 24-card dashboard → `{cognitive_load:0.75,
     visual_density:0.85, control_count_estimate:33}` (actual controls: 9 + 24 = 33 — exact).
     Reasoning text was accurate ("dense grid of repetitive metric cards ... lack of visual
     hierarchy"). **Latency ~7–10 s/image** once warm.

## Substrate already present (verify-before-proposing-new)

- `ModelCardCapabilities` already has `imageInput`, `pdfInput`, `inputModalities`,
  `outputModalities` — `apps/web/lib/routing/model-card-types.ts:20-36,65-107`.
- The agent routing floor already enforces `imageInput` —
  `apps/web/lib/routing/agent-capability-types.ts:11-64`, `satisfiesMinimumCapabilities()`.
- `gemma4` already maps to the `adequate` quality tier — `apps/web/lib/routing/quality-tiers.ts`.
- Modality adapters already exist: `image-gen-adapter`, `transcription-adapter`,
  `embedding-adapter` registered in `apps/web/lib/inference/ai-inference.ts:34-37`.
- The WWMD cognitive-load rubric exists — `apps/web/lib/decision/ui-surface-features.ts`
  (`uiSurfaceFeatures()` / `scoreUiSurfaceChange()`), scoring axis `human_cognitive_load`
  in `packages/db/src/wiki-taxonomy.ts:144-160` (cost axis).
- `evaluate_page` already captures a screenshot — `apps/web/lib/mcp-tools.ts` (~11459).

## Gaps (the actual work — verified in source)

- **GAP 1 — seed never tags local vision capability.** `seedLocalModels()`
  (`packages/db/src/seed.ts:1684`) writes `capabilities: { streaming, embedding }` only.
  No `imageInput` / `inputModalities`, so a vision-capable local model is invisible to the
  `imageInput` routing floor. Fix in the **family-prior** (`local-model-capabilities.ts`) +
  seed, keyed on family — bootstrap prior, runtime eval still calibrates.
- **GAP 2 — inference layer can't carry an image.** `ContentBlock`
  (`ai-inference.ts:44-47`) is text/tool_use/tool_result only; `formatMessageForOpenAI`
  (line 330) `JSON.stringify`s array content, destroying image blocks. OpenAI's vision wire
  format wants the `[{type:text},{type:image_url,image_url:{url}}]` array passed through
  natively; Anthropic wants `{type:image,source:{type:base64,...}}`.
- **GAP 3 — `evaluate_page` screenshot is captured but never seen by a model.** The base64
  is returned unused. No pipeline from screenshot → vision model → `human_cognitive_load`
  score → `scoreUiSurfaceChange()`.
- **GAP 4 — reasoning-model token budget / `reasoning_content`.** Gemma 4 12B emits a separate
  `reasoning_content` channel; a too-small `max_tokens` yields empty `content`. The inference
  layer's OpenAI response handling must (a) allocate adequate output budget for vision/reasoning
  calls and (b) optionally surface/discard `reasoning_content`. Low-risk but must be handled or
  vision calls silently return empty.

## Approach (no provider pinning; capability-routed)

1. **Family prior + seed (GAP 1):** vision-aware prior for the gemma multimodal family;
   seed populates `imageInput: true` + `inputModalities: ["text","image"]`. Bootstrap only —
   activation eval still promotes confidence.
2. **Inference transport (GAP 2):** extend `ContentBlock` with an `image_url` block; pass
   array content through in `formatMessageForOpenAI`; convert to base64 source in
   `formatMessageForAnthropic`. Smallest enabling change; unblocks all multimodal use cases.
3. **Vision UI assessment (GAP 3):** route the captured screenshot to the vision-capable
   local model (capability-routed via `imageInput` floor — never pinned to "gemma4"), parse a
   structured cognitive-load score, merge into the rubric feature vector.

## Implementation status (PR A — enabling substrate)

GAP 1 + GAP 2 implemented directly in this worktree (BS re-architecture standing rule):
- `packages/db/src/local-model-capabilities.ts` — `supportsVision` prior + `detectLocalModelVision()`
  (orthogonal to family; embeddings never vision; bootstrap prior, eval still calibrates).
- `packages/db/src/seed.ts` — `seedLocalModels()` writes `capabilities.imageInput` +
  `inputModalities/outputModalities/supportedModalities` for vision-capable locals.
- `apps/web/lib/inference/ai-inference.ts` — `ContentBlock` `image_url` member; OpenAI formatter
  passes the vision array through (native wire format); Anthropic formatter converts to `image`
  base64/url source blocks.
- Unit tests: `packages/db/test/local-model-capabilities.test.ts`,
  `apps/web/lib/inference/ai-inference-toolcalls.test.ts`.

GAP 3 implemented (the use case, end-to-end through the platform code):
- `apps/web/lib/decision/visual-cognitive-load.ts` — `assessVisualCognitiveLoad()` builds a
  text+image_url multimodal message and calls `routeAndCall` with the `imageInput` capability
  floor (no provider pin), parses a structured `{cognitive_load, visual_density,
  control_count_estimate, reasoning}`; returns null gracefully when no vision endpoint exists.
- `apps/web/lib/decision/ui-surface-features.ts` — `UiSurfaceChange.visualCognitiveLoad` blends
  the measured visual load 50/50 into the heuristic `human_cognitive_load`.
- `apps/web/lib/mcp-tools.ts` — `evaluate_page` now feeds its captured screenshot to
  `assessVisualCognitiveLoad` (best-effort) and returns `visualCognitiveLoad`, so the structural
  tool emits a real visual signal for the rubric.
- Tests: `visual-cognitive-load.test.ts` (parse/clamp + multimodal message shape + graceful null),
  `ui-surface-features.test.ts` (visual-load blend both directions).

**Live end-to-end exercise** (real `assessVisualCognitiveLoad` → real Gemma 4 via DMR → real
`uiSurfaceFeatures`, 2026-06-15): clean card → `cognitiveLoad 0.10` (2 controls); cluttered
dashboard → `cognitiveLoad 0.45, density 0.80` (33 controls, exact). Rubric `human_cognitive_load`:
heuristic-only **0.470** → +clean visual **0.285** → +cluttered visual **0.460** — the measured
visual signal moves the real rubric (a clean UI buys the cost axis down; a cluttered one holds it
high). Routing-layer selection (`imageInput` floor) is unit-tested; exercising the *deployed*
`evaluate_page` MCP tool over a live browser screenshot is the operator-gated post-merge step
(self-upgrade deploy), per AGENTS.md §5.

GAP 4 (reasoning-token budget) handled at the call site by allocating adequate output budget for
the vision call; the assessment parser tolerates `reasoning_content`-heavy replies.

## Research & Benchmarking

- **Google guidance:** Gemma 4 + Docker Model Runner is the published ADK local-agent pattern —
  OpenAI-compatible serving on :12434 maps 1:1 onto DPF's existing `ai-inference.ts` chat path.
- **Wire format:** OpenAI Chat Completions vision (`content: [{type:text},{type:image_url,
  image_url:{url:"data:image/png;base64,..."}}]`) is the cross-engine standard (llama.cpp /
  vLLM / DMR). Anthropic uses `{type:image, source:{type:base64,media_type,data}}` — both covered.
- **vs. prior `evaluate_page` heuristic:** the structural/DOM-only path (axe-core findings +
  unused screenshot) cannot see visual density, whitespace, grouping, or information scent — the
  exact signals `human_cognitive_load` wants. The probe showed Gemma 4 scoring those correctly
  (clean 0.1 / cluttered 0.75), closing the structural≠functional gap on UI with a local,
  zero-egress model (data never leaves the machine).
