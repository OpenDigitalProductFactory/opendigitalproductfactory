# Plan: Chatterbox Self-Hosted TTS Adapter

**Plan ID:** 2026-05-21-chatterbox-tts-self-hosted  
**Spec:** docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md  
**Branch:** feat/chatterbox-tts-adapter  
**Worktree:** D:\DPF-chatterbox

---

## Overview

Swap the default TTS provider from Cartesia → self-hosted Chatterbox.  
Remove the `VoiceTrainingJob` table (zero-shot: no training step needed).  
Add `dpf-tts` Docker Compose service (opt-in `--profile tts`).  
Keep Cartesia + Fish Audio as opt-in adapters behind the existing interface.

TDD: failing test → implement → passing → commit (DCO `git commit -s`).

---

## Tasks

### Task 1 — Drop `VoiceTrainingJob` schema + migration

**Files:**
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260521140000_drop_voice_training_job/migration.sql`

**Steps:**
1. Remove `VoiceTrainingJob` model from schema.prisma
2. Remove `trainingJobs VoiceTrainingJob[]` relation from `VoiceProfile`
3. Remove `voiceTrainingJob VoiceTrainingJob?` from `DecisionInteractionVoiceOutput` if present
4. Write migration SQL: `DROP TABLE IF EXISTS "VoiceTrainingJob";`
5. Run `D:\DPF\node_modules\.bin\prisma generate --schema packages/db/prisma/schema.prisma`
6. Verify: `pnpm --filter @dpf/db typecheck` passes (or DPF_SKIP_TYPECHECK=1 commit)

**Commit:** `feat(db): drop VoiceTrainingJob — replaced by zero-shot Chatterbox cloning`

---

### Task 2 — Add Chatterbox adapter

**File:** `apps/web/lib/voice-synthesis/adapters/chatterbox.ts`

**Test first:** `apps/web/lib/voice-synthesis/adapters/chatterbox.test.ts`
```ts
// Test: synthesizeWithChatterbox returns SynthesisResult with audioData
// Test: throws on non-2xx response
// Test: passes voice_id and text to correct endpoint
// Mock: fetch
```

**Implementation:**
```ts
export async function synthesizeWithChatterbox(
  input: NarrationInput,
  config: VoiceSynthesisConfig
): Promise<SynthesisResult>
```
- POST to `${DPF_TTS_URL}/v1/audio/speech`
- Body: `{ model: "tts-1", input: text, voice: providerVoiceId, response_format: "wav" }`
- OpenAI-compatible endpoint — same shape as OpenAI TTS API
- Env: `DPF_TTS_URL` (default: `http://dpf-tts:8000`)

**Commit:** `feat(voice): Chatterbox TTS adapter`

---

### Task 3 — Wire Chatterbox as default provider in voice-service.ts

**File:** `apps/web/lib/voice-synthesis/voice-service.ts`

**Steps:**
1. Add `chatterbox` to the `TTSProvider` union in `types.ts`
2. Add `case "chatterbox": return synthesizeWithChatterbox(input, config)` to `synthesizeSpeech()`
3. Read `TTS_PROVIDER` env var; default to `"chatterbox"` when unset
4. Update `VoiceSynthesisConfig` default provider

**Commit:** `feat(voice): default TTS provider → chatterbox`

---

### Task 4 — Reference audio upload API route

**File:** `apps/web/app/api/voice/reference/route.ts`

Replaces `/api/voice/train`. Accepts multipart upload, stores reference audio on the dpf-tts volume (or local storage), calls `dpf-tts` registration endpoint to register the voice_id, then sets `VoiceProfile.status = "ready"` and `VoiceProfile.providerVoiceId = voiceId` synchronously (no async job).

**Steps:**
1. Write `POST /api/voice/reference` — 50MB limit, audio/* accept
2. Store reference audio via `audio-storage.ts`
3. POST reference audio to `dpf-tts:8000/v1/voices` (Chatterbox voice registration)
4. Update `VoiceProfile`: `status: "ready"`, `providerVoiceId: voiceId`
5. Return `{ voiceId, status: "ready" }`

**Commit:** `feat(voice): reference audio upload route — zero-shot Chatterbox registration`

---

### Task 5 — Remove training pipeline, simplify training-pipeline.ts

**File:** `apps/web/lib/voice-synthesis/training-pipeline.ts`

Replace `startVoiceTrainingJob()` with `registerReferenceAudio()` that does the same work as the API route (for server-side use). Remove all `VoiceTrainingJob` DB writes.

**Commit:** `refactor(voice): replace training pipeline with zero-shot reference registration`

---

### Task 6 — Update VoiceProfileSetup client component

**File:** `apps/web/components/wiki/VoiceProfileSetup.tsx`

**Steps:**
1. Replace `TrainingUploadForm` POST target: `/api/voice/train` → `/api/voice/reference`
2. Remove `VoiceTrainingStatus` import and render (no job to poll)
3. On successful upload response `{ status: "ready" }` → call `window.location.reload()` immediately
4. Step 2 heading: "Voice sample" (was "Voice samples")
5. Step 2 description: "Upload 3–30 seconds of clean audio or video. Chatterbox will clone the voice immediately — no training wait."

**Commit:** `feat(wiki): simplify VoiceProfileSetup for zero-shot Chatterbox flow`

---

### Task 7 — Remove VoiceTrainingStatus from VoiceProfileSetup

Already handled in Task 6. Verify `VoiceTrainingStatus` is still used elsewhere (it has its own test file — keep the component, just stop using it in `VoiceProfileSetup`).

---

### Task 8 — Add dpf-tts Docker Compose service

**File:** `apps/web/.next/standalone/docker-compose.yml`

**Steps:**
1. Add `dpf-tts` service under `profiles: ["tts"]` following the `dpf-stt` pattern:
```yaml
dpf-tts:
  image: ${DPF_TTS_IMAGE:-devnen/chatterbox-tts-server:latest-cuda}
  profiles: ["tts"]
  environment:
    TTS_MODEL: ${TTS_CHATTERBOX_MODEL:-turbo}
  healthcheck:
    test: ["CMD", "curl", "-fsS", "http://localhost:8000/v1/models"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 90s
  ports:
    - "127.0.0.1:8766:8000"
  volumes:
    - dpf-tts-voices:/app/voices
```
2. Add `dpf-tts-voices:` to the volumes section
3. Add `DPF_TTS_URL=http://dpf-tts:8000` and `TTS_PROVIDER=chatterbox` to the portal service environment

**Commit:** `feat(docker): add dpf-tts service — Chatterbox self-hosted TTS`

---

### Task 9 — Update integration test

**File:** `apps/web/lib/voice-synthesis/integration.test.ts`

Update the test cases that reference Cartesia as the default provider to expect Chatterbox. Add a test case covering the zero-shot path (no training job).

**Commit:** `test(voice): update integration tests for Chatterbox default provider`

---

### Task 10 — Update spec cross-reference in voice/page.tsx

**File:** `apps/web/app/(shell)/wiki/perspectives/[profileId]/voice/page.tsx`

Update the spec comment reference from `2026-05-19-persona-voice-layer-wwtd-design.md` to also reference `2026-05-21-chatterbox-tts-self-hosted.md`.

**Commit:** `docs: update spec cross-reference in voice admin page`

---

## Verification

After all tasks:
1. `DPF_SKIP_TYPECHECK=1 pnpm --filter @dpf/db build` — no DB type errors
2. `D:\DPF\node_modules\.bin\vitest run apps/web/lib/voice-synthesis` — all tests pass
3. Portal running: navigate to `/wiki/perspectives/mark-dpf-platform/voice` → upload a reference audio clip → status immediately shows "Voice profile ready" (no training spinner)
4. WWMD gate decision on a voice-enabled profile → audio file written to storage → playable in `VoiceRationalePlayer`

## Push + PR

After verification: `git push -u origin feat/chatterbox-tts-adapter` + `gh pr create`
