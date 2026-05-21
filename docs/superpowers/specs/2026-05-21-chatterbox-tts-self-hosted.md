# Chatterbox TTS — Self-Hosted Voice Synthesis

**Spec ID:** 2026-05-21-chatterbox-tts-self-hosted  
**Status:** draft  
**Author:** Mark Bodman  
**Date:** 2026-05-21  
**Supersedes / amends:** docs/superpowers/specs/2026-05-19-persona-voice-layer-wwtd-design.md §6 (provider layer)

---

## 1. Intent

Replace the Cartesia Sonic 3 external API with a self-hosted Chatterbox TTS instance running on DPF's own hardware. This aligns the voice synthesis layer with the platform's `prefer-self-hosted-infrastructure` principle and eliminates per-call API costs and external data routing.

Cartesia and Fish Audio remain as opt-in adapters for operators who prefer managed APIs, but the default out-of-the-box path is Chatterbox on `dpf-tts:8000`.

---

## 2. Background

The original voice layer spec (2026-05-19) used Cartesia Sonic 3 as the primary TTS provider because it offered the lowest latency (90ms) and a 3-second sample minimum. However, Cartesia requires:
- An external API key
- Per-character billing
- An explicit async training job before a cloned voice is usable
- Data routing through Cartesia's servers

Chatterbox (Resemble AI, MIT license) eliminates all four constraints:
- Runs locally on the same CUDA infrastructure as `dpf-stt`
- Zero marginal cost per inference
- **Zero-shot cloning** — pass a reference audio clip at synthesis time; no training job, no async status polling
- Data never leaves the Docker network

This is architecturally equivalent to how `dpf-stt` (speaches/faster-whisper) replaced OpenAI Whisper API for speech-to-text.

---

## 3. Chatterbox Architecture

### 3.1 Model variants

| Variant | Params | VRAM | Notes |
|---|---|---|---|
| Chatterbox (original) | 500M | ~6–8GB | English, emotion exaggeration, zero-shot cloning |
| Chatterbox Multilingual | 550M | ~7–8GB | 23 languages, voice cloning, emotion control |
| Chatterbox Turbo | 350M | ~5–6GB | 1-step diffusion decoder, fastest inference, paralinguistic tags |

**Default**: Chatterbox Turbo — fits comfortably alongside `dpf-stt` on an 8GB+ GPU, lowest latency.

### 3.2 Docker deployment

Self-hosted server: [`devnen/Chatterbox-TTS-Server`](https://github.com/devnen/Chatterbox-TTS-Server)
- OpenAI-compatible `/v1/audio/speech` endpoint
- Voice cloning via `voice_id` pointing to a stored reference audio file, or inline reference audio
- NVIDIA CUDA / AMD ROCm / CPU fallback
- Opt-in profile: `--profile tts`

### 3.3 Zero-shot cloning flow

```
upload reference audio → stored on dpf-tts volume
                              ↓
synthesis request: text + voice_id → dpf-tts:8000/v1/audio/speech
                              ↓
                        audio response (WAV/MP3)
```

No training step. No async job. No polling. The reference audio IS the voice profile.

---

## 4. Changes to the Voice Layer

### 4.1 What is removed

- `VoiceTrainingJob` model (no training step needed)
- `trainingJobs` relation on `VoiceProfile`
- `startVoiceTrainingJob()` in `training-pipeline.ts`
- `/api/voice/train` route (replaced by `/api/voice/reference` for storing the reference audio on the dpf-tts volume)
- `VoiceTrainingStatus` component usage in `VoiceProfileSetup` (replaced by immediate "ready" state after upload)

### 4.2 What changes

**Schema:**
- `VoiceProfile.status` logic: after reference audio upload → immediately `ready` (no `training` state needed)
- `VoiceProfile.providerVoiceId` stores the `voice_id` registered with `dpf-tts`

**Adapter:**
- New `apps/web/lib/voice-synthesis/adapters/chatterbox.ts` — calls `dpf-tts:8000/v1/audio/speech` with `voice_id` + text
- `voice-service.ts` default provider: `chatterbox` (env: `TTS_PROVIDER=chatterbox`)

**Docker Compose:**
- New `dpf-tts` service under `--profile tts`
- Image: `devnen/chatterbox-tts-server` (CUDA variant)
- Volume: `dpf-tts-voices` for persisting reference audio clips
- DNS: `dpf-tts:8000`

**Admin UX (`VoiceProfileSetup`):**
- Step 2 changes from "Upload → start training → wait for job" → "Upload reference audio → immediately ready"
- Remove `VoiceTrainingStatus` status-polling display
- On successful upload, status flips to `ready` synchronously

**Environment variables:**
```
TTS_PROVIDER=chatterbox          # default; alternatives: cartesia, fish-audio
DPF_TTS_URL=http://dpf-tts:8000  # internal Docker DNS
TTS_CHATTERBOX_MODEL=turbo       # or: original, multilingual
```

### 4.3 What stays the same

- `VoiceProfile`, `VoiceConsentRecord`, `DecisionInteractionVoiceOutput` models
- `VoiceConsentForm` and consent flow
- `runVoiceSynthesisJob()` post-gate async dispatch
- `buildNarrationText()` and `applyPersonaStyle()` (LLM persona pass)
- `audioStorageKeyToUrl()` and audio serving via `/api/voice/audio/[...path]`
- `VoiceRationalePlayer` component
- `/wiki/perspectives` admin UX (breadcrumbs, enable toggle)
- Cartesia and Fish Audio adapters (kept as opt-in fallbacks)

---

## 5. Database Migration

`VoiceTrainingJob` table drop requires a migration. Two options:

**Option A (clean):** Drop `VoiceTrainingJob` table and `trainingJobs` relation. Simpler schema going forward.

**Option B (soft):** Keep the table, stop writing to it. Avoids migration risk. Chosen for initial implementation — clean-up migration can follow.

Default: **Option A** — the table is new (migration landed in PR #889), no production data exists in it yet.

---

## 6. Hardware Requirements

| Service | VRAM | Notes |
|---|---|---|
| dpf-stt (speaches) | ~2–4GB | faster-distil-whisper-large-v3 |
| dpf-tts (Chatterbox Turbo) | ~5–6GB | can share GPU if total VRAM ≥ 10GB |

On a 12GB GPU (e.g. RTX 3060 12GB or better): both services fit simultaneously with headroom.  
On an 8GB GPU: run sequentially (TTS synthesizes after STT completes) or pin to separate GPUs if available.  
CPU fallback: supported by Chatterbox-TTS-Server but synthesis is ~10–30× slower.

---

## 7. Acceptance Criteria

- [ ] `docker compose --profile tts up` starts `dpf-tts` and it passes healthcheck
- [ ] Uploading a reference audio on `/wiki/perspectives/[profileId]/voice` immediately sets `voiceProfile.status = ready`
- [ ] A WWMD gate decision for a voice-enabled profile triggers `runVoiceSynthesisJob`, which calls `dpf-tts:8000`, and the resulting audio is playable via `VoiceRationalePlayer`
- [ ] Setting `TTS_PROVIDER=cartesia` routes to Cartesia adapter (existing behaviour preserved)
- [ ] `VoiceTrainingJob` table is dropped; no typecheck errors
- [ ] All existing voice synthesis tests pass

---

## 8. Out of Scope

- Streaming TTS (chunk-by-chunk audio delivery) — future slice
- Multi-language voice profiles — supported by Chatterbox Multilingual but not surfaced in UI yet
- Edge / CPU-only install path for TTS — whisper.cpp equivalent for TTS (e.g. `piper`) — future slice
