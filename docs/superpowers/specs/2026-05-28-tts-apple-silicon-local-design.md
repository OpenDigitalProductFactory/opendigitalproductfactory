# Local TTS on Apple Silicon — Native-Host MLX Sidecar

**Spec ID:** 2026-05-28-tts-apple-silicon-local
**Status:** draft
**Author:** Mark Bodman (research + PoC by Claude)
**Date:** 2026-05-28
**Amends:** `docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md` §8 (the deferred "Edge / CPU-only install path for TTS" slice)

---

## 1. Intent

Make self-hosted, voice-cloning TTS work on Apple Silicon Macs (and other non-NVIDIA hosts), where the shipped `dpf-tts` sidecar cannot run. This closes the gap surfaced by DPF's first real macOS run: coworker voice playback fails because `dpf-tts` (`travisvn/chatterbox-tts-api`) is **amd64-only** and its compose service **hard-reserves an NVIDIA GPU** — neither is satisfiable on an M-series Mac.

The core feature — **zero-shot voice cloning** (narrate WWMD decisions in the user's cloned voice) — must be preserved, not dropped.

---

## 2. The load-bearing constraint (verified)

**Docker Desktop on macOS has no GPU passthrough.** Containers run in a Linux VM that exposes virtual CPU/memory but **no virtual GPU** — no Metal/MPS, no Neural Engine. Verified 3-0 against Docker's own engineering blog, which runs `vllm-metal` *natively on the host* for exactly this reason ("Metal GPU access requires direct hardware access and there is no GPU passthrough for Metal in containers"), corroborated by independent sources.

Consequence: a cloning-grade neural TTS model **cannot** be usefully GPU-accelerated inside a container on a Mac. It must run as a **native macOS host process**, reached by the portal container via `host.docker.internal`.

**This is not a new architectural compromise — it is the pattern DPF already uses.** Local LLM inference already runs host-native via **Docker Model Runner** (`LLM_BASE_URL=http://model-runner.docker.internal/v1`; qwen3 30B/8B run on the host with Metal). The TTS sidecar should mirror it. (Note: DMR itself serves only LLMs+embeddings, not TTS; Ollama TTS is proposal-only; llama.cpp's `tts` tool offers OuteTTS default voices with no cloning and no OpenAI endpoint — so none of the existing runners can host cloning TTS, and a dedicated host-native TTS server is required.)

---

## 3. Decision: native-host `mlx-audio` sidecar

Adopt **architecture (B): a native-host MLX TTS server**, not a CPU-only Docker container.

**Engine: [`Blaizzy/mlx-audio`](https://github.com/Blaizzy/mlx-audio)** — MIT-licensed framework, Apple-Silicon-native (Apple MLX/Metal), ships an OpenAI-compatible `POST /v1/audio/speech` server, supports zero-shot cloning via CSM / Qwen3-TTS / LongCat-AudioDiT, and can also serve the fast non-cloning fallback (Kokoro).

### 3.1 Proof-of-concept (run 2026-05-28 on an Apple M5 Max, 128 GB)

Installed via `uv` (Python 3.12 venv) and exercised the running server. All outputs were valid 24 kHz mono PCM WAV. **All faster than real-time.**

| Path | Model | Warm latency | RTF | Cloning |
|---|---|---|---|---|
| Non-cloning fallback | `mlx-community/Kokoro-82M-bf16` | 0.14 s (2 sentences) | 0.02 (~43× RT) | no |
| Clone — 1 sentence | `mlx-community/csm-1b` | 0.99 s | 0.69 | **yes** |
| Clone — 2 sentences | `mlx-community/csm-1b` | 4.2 s | 0.64 | **yes** |

One-time costs observed: ~26 s first-call pipeline init (Kokoro G2P/spaCy load); ~4 min CSM model download; 1 GB venv + ~6.5 GB Hugging Face model cache. Cold per-utterance generation (model resident) is the warm number above.

Caveat: the PoC reference clip was ~6 s of synthetic Kokoro audio, so this validates the **pipeline and latency**, not cloning *fidelity*. CSM cloning quality reportedly improves with ~30 s of real reference speech; fidelity on a genuine human reference is an open item (§6).

### 3.2 Integration contract — needs a thin new `mlx` adapter (not a pure drop-in)

`mlx-audio`'s `/v1/audio/speech` takes JSON `{model, input, voice, ref_audio, ref_text, response_format}`. **Cloning is driven by `ref_audio` = a server-side file PATH** (the server checks `os.path.exists`) plus a `ref_text` transcript — there is **no multipart reference-upload endpoint** (its only `UploadFile` routes are for transcription/separation, not TTS).

DPF's existing `chatterbox` adapter uploads the reference WAV inline via `/v1/audio/speech/upload`. So `mlx-audio` is **not** a drop-in for that path. However, DPF already stores reference audio on disk (`/api/voice/synthesize` reads `referenceAudioBuffer` from `resolveVoiceStorageRoot()/providerVoiceId`). The clean integration is:

- New adapter `apps/web/lib/voice-synthesis/adapters/mlx.ts` that POSTs JSON to `${DPF_TTS_URL}/v1/audio/speech` with `ref_audio` set to the **absolute path of the stored reference clip on a volume the host TTS process can read**, and `ref_text` set to the reference transcript (stored, or derived once via the existing `dpf-stt`).
- New `TTS_PROVIDER=mlx` value wired into `voice-service.ts`.
- `DPF_TTS_URL=http://host.docker.internal:8770/v1` (or chosen port) for the macOS path.
- Shared reference-clip directory: the host TTS process and the portal container must agree on the reference path. Either bind-mount the voice storage root to a host path the sidecar reads, or have the adapter write the clip to a host-visible temp path per request.

---

## 4. Install / lifecycle (the new work)

Unlike `docker compose up`, a native-host sidecar needs host install + supervision:

1. **Provision** a managed Python env on the host (recommend `uv`-managed 3.12 venv; avoids touching system Python 3.9). Deps confirmed by the PoC: `mlx-audio uvicorn fastapi python-multipart webrtcvad "setuptools<81" "misaki[en]"`.
2. **Supervise** the server (`python -m mlx_audio.server --host 127.0.0.1 --port 8770`) via a macOS `launchd` LaunchAgent so it starts on login and restarts on failure — the host analogue of `restart: unless-stopped`.
3. **Wire** the portal container to reach it: `DPF_TTS_URL=http://host.docker.internal:8770/v1`, `TTS_PROVIDER=mlx`. Add `host.docker.internal:host-gateway` (already present in compose).
4. **Health** surfacing: the portal's voice-availability check (`useVoiceSynth` → `tts_unavailable`) should report the macOS sidecar status, and the installer/health UI should detect a missing/stopped host sidecar (distinct from the Linux/GPU `dpf-tts` container path).

The Linux/NVIDIA `dpf-tts` container path remains the default where a CUDA GPU exists; this spec adds a parallel macOS/host path selected by platform.

---

## 5. Research & Benchmarking (per AGENTS.md §10)

Sourced from a 27-source, adversarially-verified deep-research pass (23/25 claims confirmed 3-0).

**Adopted:** native-host MLX server pattern (mirrors DMR); `mlx-audio` as the OpenAI-compatible host engine; Kokoro (Apache-2.0) as the no-clone fallback.

**Evaluated and rejected:**
- **Coqui XTTS-v2** — cloning-capable but **disqualified**: Coqui Public Model License is non-commercial, and Coqui (the company) shut down Jan 2024, so no commercial license is purchasable.
- **OpenAudio / Fish S1-mini** — **disqualified**: weights are CC-BY-NC-SA-4.0 (non-commercial), despite an Apache-2.0 codebase.
- **Piper / Kokoro** — fast and clean-licensed but **no zero-shot cloning** (predefined voices only); usable only as fallback/default voice.
- **CPU-only Docker TTS** — rejected for cloning models: too slow without Metal, per §2.

**Runner-up engine:** [`lucasnewman/f5-tts-mlx`](https://github.com/lucasnewman/f5-tts-mlx) — MLX-native zero-shot cloning, ~4 s/sentence on M3 Max. ⚠️ License **unresolved** (an "MIT" claim was refuted 0-3) — must be cleared before adoption.

**Other permissively-licensed cloning candidates to keep in view:** Dia 1.6B (Apache-2.0), CSM-1B (Sesame), NeuTTS Air.

---

## 6. Open questions

1. **Per-model weight licenses** for commercial self-hosting — clear CSM-1B (Sesame), Qwen3-TTS, LongCat-AudioDiT individually. `mlx-audio`'s MIT covers only the framework. (Top candidate for the cloning model is whichever is both permissively licensed and best quality/latency.)
2. **Cloning fidelity** of CSM vs Qwen3-TTS vs LongCat on a *real* human reference clip (not the synthetic PoC clip), at DPF's 1–2 sentence narration length, on a baseline (non-Max) M-series.
3. **`f5-tts-mlx` license** resolution.
4. **Reference-path sharing** mechanism between the host sidecar and the portal container (bind-mount vs per-request temp write).
5. **Installer integration** — how the DPF macOS installer provisions and registers the `launchd` sidecar, and how host health is surfaced.

---

## 7. Acceptance criteria

- [ ] `TTS_PROVIDER=mlx` + `mlx.ts` adapter route synthesis to a host `mlx-audio` server and return playable WAV.
- [ ] A voice-enabled coworker message auto-narrates in the **cloned** voice on an Apple Silicon Mac, with per-utterance latency within real-time for 1–2 sentences.
- [ ] Reference clips stored by `/api/voice/reference` are readable by the host sidecar without manual copying.
- [ ] A `launchd` LaunchAgent starts/restarts the sidecar; the portal health UI reports its status (no silent `tts_unavailable` flash).
- [ ] The selected cloning model's weight license is cleared for commercial use and recorded in `approved_tools_registry.json`.
- [ ] The Linux/NVIDIA `dpf-tts` container path is unchanged where a CUDA GPU exists.

---

## 8. Out of scope

- Streaming/chunked TTS delivery (inherited from the parent spec).
- Windows/Linux non-NVIDIA host acceleration (DirectML / ROCm) — separate slice; the CPU-Docker fallback (Kokoro/Piper, no cloning) covers those hosts for now.
