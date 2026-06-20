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

## Deliberately out of scope (follow-ups under BI-0B893092)

- **Install-script values are still mirrored, not imported** — shell / the
  `@dpf/db`-context detector cannot import the apps/web TS module, so
  `LOCAL_MODEL_TIERS` is duplicated there with a pointer comment. The over-commit
  guard catches any resulting drift.
- **Known tier-value divergence:** the detector's discrete top tier is `qwen3:30B-A3B`
  (~16 GB, safe headroom on a 24 GB card) while the canonical/bootstrap top tier
  is `qwen3.6:35B-A3B` (~22 GB, which itself nearly fills a 24 GB card). The tier
  *headroom* (floor ≈ model size, leaving little for KV cache + embedder) should be
  recalibrated as a separate change so a recommended model never over-commits.
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
