# Local AI stack — GPU/VRAM tiering and idle-unload policy

- **Date:** 2026-08-05
- **Status:** draft (design)
- **Origin:** founder observation — "why does Docker eat so much memory?" resolved to a GPU-VRAM constraint, not system RAM.

## Problem

On a single-GPU install, one card's VRAM is shared by every resident model **and** the whole host desktop. Measured on the reference install (2026-08-05):

- **GPU:** NVIDIA RTX 4090, **24 GiB total, 23.4 GiB used (95%), 773 MiB free.**
- **System RAM:** WSL2 VM at ~35% — abundant headroom.
- Sharing the 24 GiB: the local LLM (`qwen3-coder`, ~16 GiB via Docker Model Runner), the TTS model (Chatterbox `turbo`, GPU by default), STT (whisper — already CPU by default), embeddings (`nomic-embed` via DMR), **and** a heavy host desktop (ChatGPT, Copilot, Claude, Codex, Adobe, Steam, Edge webviews all hold GPU contexts).

So the binding constraint is **GPU VRAM, not system memory** — and the current per-service device defaults are **uncoordinated**: TTS defaults to CUDA (`docker-compose.yml` TTS tier 2), STT defaults to CPU (tier 1), the LLM + embeddings sit on the DMR-managed GPU. Nothing budgets VRAM across them, and nothing coordinates idle-unload (the DMR llama-server self-unloads on idle; TTS exposes `/api/unload` but nothing calls it; there is no shared view of headroom).

The risk: with the LLM (~16 GiB) + TTS (~several GiB) + embeddings all resident on a 95%-full card, a larger model or a second concurrent local inference flirts with **GPU OOM**, while system RAM sits half-empty.

## Principle

**Scarce resource earns priority; abundant resource absorbs the overflow.** On a single-GPU box, VRAM is scarce and system RAM is abundant, so:

1. The **latency-critical, VRAM-heavy primary** (the LLM) earns GPU residence.
2. **Latency-tolerant secondary services** (TTS, STT, embeddings) default to **CPU** (system RAM) unless the install has measured VRAM headroom to spare — the "memory vs GPU memory" trade, made **per service**, not everything-on-GPU-by-default.
3. Whatever is GPU-resident must **idle-unload**, so a 95%-full card is not held hostage by a model nobody is using.

This mirrors the Reduction Gear idea: don't spend the scarce ring (VRAM) on work that a cheaper ring (CPU/system RAM) can carry acceptably.

## Current state (as-built)

| Service | Model | Device default | Idle behavior | VRAM |
|---|---|---|---|---|
| LLM | qwen3-coder (DMR) | GPU | **self-unloads on idle** ✓ | ~16 GiB when loaded |
| Embeddings | nomic-embed (DMR) | GPU | DMR-managed | small |
| TTS | Chatterbox turbo | **GPU** (tier 2) | none (has `/api/unload`, uncalled) | ~several GiB + ~1.5 GiB RAM |
| STT | whisper base | **CPU** (tier 1) | n/a | ~0.14 GiB RAM |

The STT tier-1-CPU default is already the right shape; TTS is the outlier.

## Design

### 1. Coordinated per-service device tiers
A single documented knob per service (`DEVICE=cpu|cuda|auto`) with defaults chosen for the **single-GPU common case**:
- LLM/embeddings: GPU (DMR), unchanged.
- STT: CPU, unchanged.
- **TTS: CPU by default on single-GPU installs**, with `cuda` opt-in for installs that have measured VRAM headroom (a multi-GPU or dedicated-inference box). `auto` resolves to CPU when the GPU is above a headroom threshold.

### 2. Idle-unload for every GPU resident
- LLM: already self-unloads.
- TTS (if on GPU): an idle-unload driver in the voice adapter posts `/api/unload` after an idle window; the next request lazy-reloads (accept one warm-up). Note the known upstream partial-VRAM-free bug (BI-635CB133) — measure actual freed VRAM.

### 3. VRAM headroom is observable before it is enforced
Surface GPU total/used/free and per-endpoint VRAM (`EndpointTaskPerformance.peakVramMbAvg` already persists this) on the runtime-health / Right Now surfaces, so an operator can see the 95% wall and the tiering decision is evidence-based. **Reliability → observability → enforcement**: never auto-tier on a signal that is not yet surfaced and trusted.

### 4. Optional auto-tiering (later)
Once headroom is observable and the manual tiers are proven, `auto` can demote secondary services to CPU when measured free VRAM drops below a threshold — but only after phases 1–3 are trusted.

## Non-goals
- Cloud TTS/STT fallback (conflicts with fully-local-by-choice; a separate provider decision).
- Reducing the host desktop's GPU use (out of platform scope).
- Multi-GPU scheduling.

## Phased delivery (reliability → observability → enforcement)
1. **Observe** — surface GPU VRAM headroom + per-endpoint VRAM on runtime-health / Right Now.
2. **Policy** — documented per-service device tiers + single-GPU defaults (TTS→CPU); measure the voice-latency cost of CPU TTS as the evidence for the default.
3. **Idle-unload** — TTS idle-unload driver; verify freed VRAM against the upstream partial-free caveat.
4. **Auto-tier (optional)** — demote secondary services to CPU under measured VRAM pressure.

## Evidence to capture before enforcing
- CPU-TTS vs GPU-TTS: first-call + steady-state latency, VRAM freed, system-RAM cost.
- GPU free-VRAM headroom over a normal working day (does the LLM alone already fill it?).
