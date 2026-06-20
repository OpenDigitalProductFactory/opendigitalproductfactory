# Single-generation-model policy for the bundled local runtime

**Date:** 2026-06-19
**Status:** Implemented (runtime surfaces + drift guard); install-script value reconciliation deferred
**Backlog:** BI-0B893092 (durable platform fix)
**Related:** `2026-06-10-local-llm-build-agent-design.md` (OpenCode local build agent)

## Problem

The bundled local AI runtime (Docker Model Runner on Docker Desktop; Ollama on
native Linux) loads **one `llama-server` process per model with no concurrency
cap**. On a real build host this accumulated **three** models for three jobs —
`gemma4:12B` (chat), `qwen3-coder` 30B (Build Studio codegen), `nomic-embed`
(embeddings) — and the two large generation models over-committed a 24 GB GPU
(18/24 GB resident; `qwen3-coder` alone ~16 GB), thrashing into system RAM.

Root cause: **model selection was duplicated across four mechanisms that drifted
out of sync**, and nothing enforced "one generation model at a time" or noticed
when two had accumulated:

1. `scripts/detect-hardware-host.ts` — install-time `selectedModel` (host profile)
2. `install-dpf.ps1` / `install-dpf.sh` — install-time pull
3. `apps/web/lib/inference/bootstrap-first-run.ts` — first-run auto-pull
4. `apps/web/components/platform/OllamaManagement.tsx` — browse/manage catalog

(The host that hit this had `selectedModel = ai/gemma4` from an older detector,
plus `qwen3-coder` pinned by Build Studio's dispatch config — two large models,
neither aware of the other.)

## Policy

- The local runtime keeps **at most ONE generation (chat/coder) model** resident,
  plus the small embedder. `MAX_CONCURRENT_GENERATION_MODELS = 1`.
- The **same** generation model serves both chat/reasoning fallback and Build
  Studio code generation — do not run a separate chat model and coder model.
- The embedder (`ai/nomic-embed-text-v1.5`) is always allowed alongside the one
  generation model (it is tiny and required for memory/RAG).

## Design — `apps/web/lib/inference/local-model-policy.ts`

A new **pure, client-safe** module is the single source of truth:

- `LOCAL_MODEL_TIERS` — canonical generation tiers (Qwen3 family, largest-first).
- `recommendGenerationModel(vramGb)` — largest tier that fits; `null` (undetectable)
  → 8B default, `0` (CPU-only) → 4B.
- `isEmbeddingModelId` / `classifyLocalModelRole` — generation vs embedder. The
  canonical `NON_CHAT_MODEL_RE` now lives here; `opencode-dispatch.ts` imports and
  re-exports it (was a second copy).
- `estimateModelVramGb(modelId)` — best-effort resident footprint for budgeting.
- `detectLocalModelOverCommit({ installedModelIds, vramGb })` — the **drift
  safety-net**: over-committed when more than one generation model is installed,
  or when the generation footprint exceeds detected VRAM. Returns the model to
  keep (prefers a coder model) and the ones to remove.

## Surfaces wired

- **Install / first-run** (`bootstrap-first-run.ts`): uses the shared tiers +
  `recommendGenerationModel` (deleted its private `MODEL_TIERS`), and runs a
  best-effort `detectLocalModelOverCommit` drift check after activation, logging
  a warning when a host already has more than one generation model.
- **Providers UX** (`OllamaManagement.tsx`): renders an over-commit warning banner
  (which model to keep, one-click Remove for the extras) and an "extra ·
  over-commit" badge on the redundant model rows. Uses the shared verdict; the
  duplicate local `normaliseModelId` was removed.
- **Codegen classifier** (`opencode-dispatch.ts`): `isEmbeddingModelId` /
  `NON_CHAT_MODEL_RE` now sourced from the policy module (dedupe).

## Headroom + architecture-aware recalibration (2026-06-20)

The original tiers sized each model to ≈ the card's whole VRAM (`minVramGb` ≈
model size), so a *recommended* model over-committed the moment it ran with a
real context window — even the first pull on a fresh install. Recalibrated:

- **Headroom:** selection now reserves `MODEL_HEADROOM_GB` (5 GB) on top of model
  WEIGHTS for the context KV cache + embedder + overhead. Grounded in on-box
  measurement (RTX 4090, 2026-06-20): qwen3-coder 30B (~16.5 GB weights) at a 24k
  build context used ~20.7 GB resident. So a 24 GB card now lands on the **30B**,
  not the 35B (which needs ~27 GB to run).
- **Architecture-aware budget** (`computeMemoryBudgetGb` / `recommendGenerationModelForHost`):
  discrete = dedicated VRAM; **unified (Apple Silicon) = total RAM × 0.75** (the
  GPU's share, leaving the OS + Docker stack the rest); cpu = RAM × 0.5. So a
  128 GB Mac runs the **80B MoE** (`ai/qwen3-coder-next`) where the 4090 runs the 30B.
- **New tiers:** added `ai/qwen3-coder` (30B, the 24 GB sweet spot, serves chat +
  code) and `ai/qwen3-coder-next` (80B MoE, big-unified / 64 GB+ discrete).
- **All three copies recalibrated together** — the canonical policy, the
  Mac/Linux detector (`detect-hardware-host.ts`, unified-aware), and the Windows
  installer (`install-dpf.ps1`) — resolving the prior 30B-vs-35B divergence.

Per-host result: 8 GB GPU → 4B, 12 GB → 8B, 24 GB → 30B, 27 GB+ → 35B, 53 GB+
discrete or 64 GB+ unified → 80B. None over-commit at build context.

## Auto-set build context on install (2026-06-20)

Right-sizing the *model* isn't enough — the served **context window** matters too.
A fresh DMR pull serves a small default (qwen3-coder = 4k), below OpenCode's 22k
build floor, so local builds silently truncate until an operator sets it by hand
in Build Runtime. `bootstrap-first-run` now auto-raises the GENERATION model's
served context to `RECOMMENDED_BUILD_CONTEXT_TOKENS` (24k) on install: read the
effective context from `/v1/models`, raise via `setServedContextTokens` only when
it is below target, persist to the `ModelProfile` row (the routing source of
truth), and leave the embedder alone. Best-effort — never blocks setup; 24k fits
inside the headroom the tier selection already reserves (~2.3 GB of KV cache).
The build preflight's existing "context too small" flag stays as the safety net
for later model swaps (and for the rare case DMR refuses to reconfigure an
already-active runner).

## Still out of scope (follow-ups under BI-0B893092)

- **Install-script tiers are mirrored, not imported** — shell / the
  `@dpf/db`-context detector cannot import the apps/web TS module, so the tiers +
  constants are duplicated (now consistent across all three, with pointer
  comments). The over-commit guard catches any future drift.
- **Real-time loaded-state in the UX:** `getOllamaRunningModels()` returns `[]` on
  DMR (it predates `docker model ps`); the over-commit check therefore runs on
  *installed* models, which is sufficient for the policy but does not show live
  VRAM. Wiring live loaded-state is a follow-up.
- **DMR concurrency cap / idle-TTL tuning** at the runtime level (vs. the
  model-set policy enforced here).

## Interim host remediation (already applied)

On the affected build host: removed `gemma4:12B` (qwen3-coder now serves chat +
codegen), reconciled `.env`/`.host-profile.json` `selectedModel → ai/qwen3-coder`,
unloaded resident models. VRAM 18 → 1.1 GB used; system RAM freed ~22 GB.
