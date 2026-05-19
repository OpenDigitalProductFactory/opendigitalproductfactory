# Persona Voice Layer & WWTD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add TTS voice output to the WWMD Decision Perspective gate and extend the profile model to support WWTD personas (real, fictional, synthetic) with per-profile generation style and cloned voice.

**Architecture:** An async `VoiceSynthesisJob` fires after each `DecisionInteraction` is persisted (non-blocking), calls a swappable `VoiceService` abstraction (Cartesia Sonic 3 primary, Fish Audio S2 fallback), stores audio to the existing local blob storage, and writes a `DecisionInteractionVoiceOutput` row. The `DecisionPerspectiveGatePanel` polls for that row and renders an inline audio player. WWTD profiles extend `DecisionPerspectiveProfile` with two new JSON fields (`personaConfig`, `voiceConfig`) and three new `kind` values. Voice training is gated behind a `VoiceConsentRecord` and runs as a separate upload + provider API flow.

**Tech Stack:** TypeScript, Prisma, Next.js App Router (server actions + API routes), React, native `HTMLAudioElement`, Cartesia Sonic 3 REST API, Fish Audio S2 REST API, FFmpeg (server-side audio extraction), existing local blob storage (`writeDocumentBlob` pattern).

---

## Reference files (read before starting)

| What | Path |
|---|---|
| Spec | `docs/superpowers/specs/2026-05-19-persona-voice-layer-wwtd-design.md` |
| WWMD gate | `apps/web/lib/decision-perspective/build-studio-gate.ts` |
| WWMD persistence | `apps/web/lib/decision-perspective/persistence.ts` |
| WWMD types | `apps/web/lib/decision-perspective/types.ts` |
| Gate panel UI | `apps/web/components/build/DecisionPerspectiveGatePanel.tsx` |
| STT voice lib | `apps/web/lib/voice/transcribe.ts` |
| STT endpoint resolution | `apps/web/lib/voice/endpoint-resolution.ts` |
| Blob storage | `apps/web/lib/documents/blob-storage.ts` |
| File upload | `apps/web/lib/file-upload.ts` |
| Prisma schema | `packages/db/prisma/schema.prisma` |
| Recent migration | `packages/db/prisma/migrations/20260519153000_add_epic_priority/migration.sql` |

---

## Task 1: Schema — extend DecisionPerspectiveProfile + add voice tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260519200000_voice_layer_v1/migration.sql`

- [ ] **Step 1:** Open `packages/db/prisma/schema.prisma`. Find the `DecisionPerspectiveProfile` model. Add two fields after `status`:
  ```prisma
  personaConfig    Json?    // { systemPrompt: string, cadence?: string }
  voiceEnabled     Boolean  @default(false)
  ```
  Add relation at the bottom of the model:
  ```prisma
  voiceProfile     VoiceProfile?
  ```

- [ ] **Step 2:** After the `DeferralCapture` model, append the four new models:
  ```prisma
  model VoiceConsentRecord {
    id                      String    @id @default(cuid())
    subjectName             String
    subjectEmail            String?
    consentMethod           String    // "recorded-statement" | "signed-document" | "witnessed-verbal"
    authorizedUseCases      String[]
    authorizedLanguages     String[]  @default(["en"])
    authorizedTerritories   String[]  @default(["global"])
    expiresAt               DateTime
    capturedByPrincipalId   String
    evidenceRef             String?
    revokedAt               DateTime?
    createdAt               DateTime  @default(now())
    voiceProfiles           VoiceProfile[]
    @@index([capturedByPrincipalId])
  }

  model VoiceProfile {
    id                    String    @id @default(cuid())
    profileId             String    @unique
    provider              String    // "cartesia" | "fish-audio" | "elevenlabs" | "xtts-v2"
    providerVoiceId       String?
    status                String    @default("pending") // "pending"|"training"|"ready"|"failed"|"revoked"
    consentType           String    // "explicit-recorded"|"explicit-signed"|"not-required-synthetic"
    consentRecordId       String?
    sampleCount           Int       @default(0)
    totalSampleDurationMs Int       @default(0)
    qualityScore          Float?
    language              String    @default("en")
    createdAt             DateTime  @default(now())
    updatedAt             DateTime  @updatedAt
    profile               DecisionPerspectiveProfile @relation(fields: [profileId], references: [profileId], onDelete: Cascade)
    consentRecord         VoiceConsentRecord?        @relation(fields: [consentRecordId], references: [id])
    trainingJobs          VoiceTrainingJob[]
    @@index([status])
  }

  model VoiceTrainingJob {
    id              String    @id @default(cuid())
    voiceProfileId  String
    status          String    @default("pending") // "pending"|"processing"|"ready"|"failed"
    providerJobId   String?
    inputSamples    Json      @default("[]")
    errorMessage    String?
    startedAt       DateTime?
    completedAt     DateTime?
    createdAt       DateTime  @default(now())
    voiceProfile    VoiceProfile @relation(fields: [voiceProfileId], references: [id], onDelete: Cascade)
    @@index([voiceProfileId, status])
  }

  model DecisionInteractionVoiceOutput {
    id              String    @id @default(cuid())
    interactionId   String    @unique
    audioStorageKey String
    narrationText   String    @db.Text
    durationMs      Int
    provider        String
    voiceProfileId  String
    ttsCostUnits    Int?
    generatedAt     DateTime  @default(now())
    interaction     DecisionInteraction @relation(fields: [interactionId], references: [interactionId], onDelete: Cascade)
    @@index([voiceProfileId])
  }
  ```

- [ ] **Step 3:** Add the reverse relation to `DecisionInteraction` (find the model, add after existing relations):
  ```prisma
  voiceOutput      DecisionInteractionVoiceOutput?
  ```

- [ ] **Step 4:** Create the migration file `packages/db/prisma/migrations/20260519200000_voice_layer_v1/migration.sql`:
  ```sql
  -- Add voice fields to DecisionPerspectiveProfile
  ALTER TABLE "DecisionPerspectiveProfile"
    ADD COLUMN "personaConfig" JSONB,
    ADD COLUMN "voiceEnabled"  BOOLEAN NOT NULL DEFAULT false;

  -- VoiceConsentRecord
  CREATE TABLE "VoiceConsentRecord" (
    "id"                    TEXT NOT NULL PRIMARY KEY,
    "subjectName"           TEXT NOT NULL,
    "subjectEmail"          TEXT,
    "consentMethod"         TEXT NOT NULL,
    "authorizedUseCases"    TEXT[] NOT NULL DEFAULT '{}',
    "authorizedLanguages"   TEXT[] NOT NULL DEFAULT '{en}',
    "authorizedTerritories" TEXT[] NOT NULL DEFAULT '{global}',
    "expiresAt"             TIMESTAMP(3) NOT NULL,
    "capturedByPrincipalId" TEXT NOT NULL,
    "evidenceRef"           TEXT,
    "revokedAt"             TIMESTAMP(3),
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX "VoiceConsentRecord_capturedByPrincipalId_idx"
    ON "VoiceConsentRecord"("capturedByPrincipalId");

  -- VoiceProfile
  CREATE TABLE "VoiceProfile" (
    "id"                    TEXT NOT NULL PRIMARY KEY,
    "profileId"             TEXT NOT NULL UNIQUE,
    "provider"              TEXT NOT NULL,
    "providerVoiceId"       TEXT,
    "status"                TEXT NOT NULL DEFAULT 'pending',
    "consentType"           TEXT NOT NULL,
    "consentRecordId"       TEXT,
    "sampleCount"           INTEGER NOT NULL DEFAULT 0,
    "totalSampleDurationMs" INTEGER NOT NULL DEFAULT 0,
    "qualityScore"          DOUBLE PRECISION,
    "language"              TEXT NOT NULL DEFAULT 'en',
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VoiceProfile_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE,
    CONSTRAINT "VoiceProfile_consentRecordId_fkey"
      FOREIGN KEY ("consentRecordId") REFERENCES "VoiceConsentRecord"("id")
  );
  CREATE INDEX "VoiceProfile_status_idx" ON "VoiceProfile"("status");

  -- VoiceTrainingJob
  CREATE TABLE "VoiceTrainingJob" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "voiceProfileId" TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "providerJobId"  TEXT,
    "inputSamples"   JSONB NOT NULL DEFAULT '[]',
    "errorMessage"   TEXT,
    "startedAt"      TIMESTAMP(3),
    "completedAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceTrainingJob_voiceProfileId_fkey"
      FOREIGN KEY ("voiceProfileId") REFERENCES "VoiceProfile"("id") ON DELETE CASCADE
  );
  CREATE INDEX "VoiceTrainingJob_voiceProfileId_status_idx"
    ON "VoiceTrainingJob"("voiceProfileId", "status");

  -- DecisionInteractionVoiceOutput
  CREATE TABLE "DecisionInteractionVoiceOutput" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "interactionId"   TEXT NOT NULL UNIQUE,
    "audioStorageKey" TEXT NOT NULL,
    "narrationText"   TEXT NOT NULL,
    "durationMs"      INTEGER NOT NULL,
    "provider"        TEXT NOT NULL,
    "voiceProfileId"  TEXT NOT NULL,
    "ttsCostUnits"    INTEGER,
    "generatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DecisionInteractionVoiceOutput_interactionId_fkey"
      FOREIGN KEY ("interactionId") REFERENCES "DecisionInteraction"("interactionId") ON DELETE CASCADE
  );
  CREATE INDEX "DecisionInteractionVoiceOutput_voiceProfileId_idx"
    ON "DecisionInteractionVoiceOutput"("voiceProfileId");
  ```

- [ ] **Step 5:** Run `pnpm --filter @repo/db db:generate` (or equivalent) and confirm no Prisma schema errors.

- [ ] **Step 6:** Commit:
  ```
  feat(voice): schema migration for voice layer v1
  
  Adds voiceEnabled + personaConfig to DecisionPerspectiveProfile.
  New tables: VoiceConsentRecord, VoiceProfile, VoiceTrainingJob,
  DecisionInteractionVoiceOutput.
  ```

---

## Task 2: TypeScript types for voice synthesis

**Files:**
- Create: `apps/web/lib/voice-synthesis/types.ts`
- Create: `apps/web/lib/voice-synthesis/types.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/types.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest"
  import type {
    VoiceSynthesisConfig,
    SynthesisResult,
    VoiceTrainingSample,
    NarrationInput,
  } from "./types"

  describe("voice-synthesis types", () => {
    it("VoiceSynthesisConfig has required fields", () => {
      const config: VoiceSynthesisConfig = {
        provider: "cartesia",
        providerVoiceId: "voice-abc",
        language: "en",
        speed: 1.0,
      }
      expect(config.provider).toBe("cartesia")
    })

    it("SynthesisResult has audioStorageKey and durationMs", () => {
      const result: SynthesisResult = {
        audioStorageKey: "voice/DI-abc123/audio.mp3",
        durationMs: 4200,
        provider: "cartesia",
        ttsCostUnits: 312,
      }
      expect(result.durationMs).toBeGreaterThan(0)
    })

    it("NarrationInput accepts outcomeType values", () => {
      const input: NarrationInput = {
        outcomeType: "recommend",
        confidenceScore: 0.82,
        rationale: "The plan is architecturally sound.",
        personaSystemPrompt: undefined,
      }
      expect(input.outcomeType).toBe("recommend")
    })
  })
  ```

- [ ] **Step 2:** Run `pnpm test apps/web/lib/voice-synthesis/types.test.ts` — expect failures (file missing).

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/types.ts`:
  ```ts
  export type TTSProvider = "cartesia" | "fish-audio" | "elevenlabs" | "xtts-v2"

  export type VoiceConsentType =
    | "explicit-recorded"
    | "explicit-signed"
    | "not-required-synthetic"

  export interface VoiceSynthesisConfig {
    provider: TTSProvider
    providerVoiceId: string
    language: string
    speed?: number           // 0.5–2.0; default 1.0
    emotionNotes?: string    // passed to provider as style hint
  }

  export interface SynthesisResult {
    audioStorageKey: string  // relative path in local blob storage
    durationMs: number
    provider: TTSProvider
    ttsCostUnits?: number
  }

  export interface VoiceTrainingSample {
    filename: string
    mimeType: string
    durationMs: number
    qualityFlag?: "ok" | "noisy" | "short"
  }

  export type NarrationOutcomeType = "recommend" | "arbitrate" | "escalate" | "defer"

  export interface NarrationInput {
    outcomeType: NarrationOutcomeType
    confidenceScore: number
    rationale: string
    personaSystemPrompt?: string
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): TypeScript types for voice synthesis layer
  ```

---

## Task 3: Narration text builder

**Files:**
- Create: `apps/web/lib/voice-synthesis/narration-builder.ts`
- Create: `apps/web/lib/voice-synthesis/narration-builder.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/narration-builder.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest"
  import { buildNarrationText } from "./narration-builder"

  describe("buildNarrationText", () => {
    it("removes markdown formatting", () => {
      const result = buildNarrationText({
        outcomeType: "recommend",
        confidenceScore: 0.82,
        rationale: "The plan is **sound**. Sources: [architecture-over-shortcuts].",
        personaSystemPrompt: undefined,
      })
      expect(result).not.toContain("**")
      expect(result).not.toContain("[")
    })

    it("converts confidence number to spoken phrase", () => {
      const result = buildNarrationText({
        outcomeType: "recommend",
        confidenceScore: 0.82,
        rationale: "Plan looks ready.",
        personaSystemPrompt: undefined,
      })
      expect(result).toMatch(/high confidence/i)
    })

    it("opens with outcome phrase for recommend", () => {
      const result = buildNarrationText({
        outcomeType: "recommend",
        confidenceScore: 0.75,
        rationale: "Good plan.",
        personaSystemPrompt: undefined,
      })
      expect(result).toMatch(/^My recommendation is to proceed/i)
    })

    it("opens with escalation phrase for escalate", () => {
      const result = buildNarrationText({
        outcomeType: "escalate",
        confidenceScore: 0.3,
        rationale: "Ambiguous scope.",
        personaSystemPrompt: undefined,
      })
      expect(result).toMatch(/need a human decision/i)
    })

    it("opens with arbitration phrase for arbitrate", () => {
      const result = buildNarrationText({
        outcomeType: "arbitrate",
        confidenceScore: 0.9,
        rationale: "Clear path forward.",
        personaSystemPrompt: undefined,
      })
      expect(result).toMatch(/I.m deciding to proceed/i)
    })

    it("opens with deferral phrase for defer", () => {
      const result = buildNarrationText({
        outcomeType: "defer",
        confidenceScore: 0.1,
        rationale: "No coverage.",
        personaSystemPrompt: undefined,
      })
      expect(result).toMatch(/not enough guidance/i)
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/narration-builder.ts`:
  ```ts
  import type { NarrationInput } from "./types"

  const OUTCOME_OPENERS: Record<string, string> = {
    recommend: "My recommendation is to proceed.",
    arbitrate: "I'm deciding to proceed.",
    escalate: "I need a human decision on this one.",
    defer:    "I don't have enough guidance to weigh in here.",
  }

  function confidencePhrase(score: number): string {
    if (score >= 0.85) return "high confidence"
    if (score >= 0.55) return "moderate confidence"
    return "low confidence"
  }

  function stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, "$1")  // bold
      .replace(/\*(.*?)\*/g, "$1")       // italic
      .replace(/\[([^\]]+)\]/g, "$1")    // link text / citation labels
      .replace(/\(https?:\/\/[^)]+\)/g, "") // link URLs
      .replace(/#{1,6}\s/g, "")           // headings
      .replace(/`[^`]+`/g, (m) => m.replace(/`/g, "")) // inline code
      .trim()
  }

  export function buildNarrationText(input: NarrationInput): string {
    const opener = OUTCOME_OPENERS[input.outcomeType] ?? "Here is the perspective."
    const conf   = confidencePhrase(input.confidenceScore)
    const body   = stripMarkdown(input.rationale)

    return `${opener} With ${conf}: ${body}`
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): narration text builder (pure function)
  ```

---

## Task 4: VoiceService abstraction + Cartesia adapter

**Files:**
- Create: `apps/web/lib/voice-synthesis/voice-service.ts`
- Create: `apps/web/lib/voice-synthesis/adapters/cartesia.ts`
- Create: `apps/web/lib/voice-synthesis/adapters/fish-audio.ts`
- Create: `apps/web/lib/voice-synthesis/voice-service.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/voice-service.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"
  import { synthesizeSpeech } from "./voice-service"
  import type { VoiceSynthesisConfig } from "./types"

  // Mock fetch for Cartesia API
  const mockFetch = vi.fn()
  vi.stubGlobal("fetch", mockFetch)

  const MOCK_AUDIO = Buffer.from("FAKE_AUDIO_BYTES")

  function makeFakeCartesiaResponse() {
    return {
      ok: true,
      arrayBuffer: async () => MOCK_AUDIO.buffer,
      headers: new Headers({ "content-type": "audio/mp3" }),
    }
  }

  describe("synthesizeSpeech (Cartesia)", () => {
    beforeEach(() => vi.clearAllMocks())

    it("calls Cartesia API with correct payload", async () => {
      process.env.CARTESIA_API_KEY = "test-key"
      mockFetch.mockResolvedValueOnce(makeFakeCartesiaResponse())

      const config: VoiceSynthesisConfig = {
        provider: "cartesia",
        providerVoiceId: "voice-abc123",
        language: "en",
        speed: 1.0,
      }
      const result = await synthesizeSpeech("Hello world.", config)

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toContain("cartesia.ai")
      const body = JSON.parse(init.body)
      expect(body.voice.id).toBe("voice-abc123")
      expect(body.transcript).toBe("Hello world.")
      expect(result.audioBuffer.byteLength).toBeGreaterThan(0)
      expect(result.provider).toBe("cartesia")
    })

    it("throws VoiceSynthesisError when API returns non-200", async () => {
      process.env.CARTESIA_API_KEY = "test-key"
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })

      await expect(
        synthesizeSpeech("Hello.", { provider: "cartesia", providerVoiceId: "v1", language: "en" })
      ).rejects.toThrow("VoiceSynthesisError")
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/adapters/cartesia.ts`:
  ```ts
  import type { VoiceSynthesisConfig } from "../types"

  export interface RawSynthesisResult {
    audioBuffer: ArrayBuffer
    provider: string
    ttsCostUnits?: number
  }

  export class VoiceSynthesisError extends Error {
    constructor(
      message: string,
      public readonly provider: string,
      public readonly statusCode?: number,
    ) {
      super(`VoiceSynthesisError [${provider}]: ${message}`)
      this.name = "VoiceSynthesisError"
    }
  }

  export async function synthesizeWithCartesia(
    text: string,
    config: VoiceSynthesisConfig,
  ): Promise<RawSynthesisResult> {
    const apiKey = process.env.CARTESIA_API_KEY
    if (!apiKey) throw new VoiceSynthesisError("CARTESIA_API_KEY not set", "cartesia")

    const body = {
      model_id: "sonic-2",
      transcript: text,
      voice: { mode: "id", id: config.providerVoiceId },
      output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100 },
      language: config.language ?? "en",
      speed: config.speed ?? 1.0,
    }

    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2025-04-16",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => "unknown")
      throw new VoiceSynthesisError(detail, "cartesia", res.status)
    }

    const audioBuffer = await res.arrayBuffer()
    return { audioBuffer, provider: "cartesia", ttsCostUnits: text.length }
  }
  ```

- [ ] **Step 4:** Create `apps/web/lib/voice-synthesis/adapters/fish-audio.ts` (stub — returns placeholder):
  ```ts
  import type { VoiceSynthesisConfig } from "../types"
  import type { RawSynthesisResult } from "./cartesia"
  import { VoiceSynthesisError } from "./cartesia"

  export async function synthesizeWithFishAudio(
    text: string,
    config: VoiceSynthesisConfig,
  ): Promise<RawSynthesisResult> {
    const apiKey = process.env.FISH_AUDIO_API_KEY
    if (!apiKey) throw new VoiceSynthesisError("FISH_AUDIO_API_KEY not set", "fish-audio")

    // Fish Audio S2 REST API
    const body = {
      text,
      reference_id: config.providerVoiceId,
      format: "mp3",
      mp3_bitrate: 128,
      latency: "balanced",
    }

    const res = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => "unknown")
      throw new VoiceSynthesisError(detail, "fish-audio", res.status)
    }

    const audioBuffer = await res.arrayBuffer()
    return { audioBuffer, provider: "fish-audio", ttsCostUnits: text.length }
  }
  ```

- [ ] **Step 5:** Create `apps/web/lib/voice-synthesis/voice-service.ts`:
  ```ts
  import type { VoiceSynthesisConfig, TTSProvider } from "./types"
  import { synthesizeWithCartesia, VoiceSynthesisError } from "./adapters/cartesia"
  import { synthesizeWithFishAudio } from "./adapters/fish-audio"

  export interface SynthesisOutput {
    audioBuffer: ArrayBuffer
    provider: TTSProvider
    ttsCostUnits?: number
  }

  export { VoiceSynthesisError }

  export async function synthesizeSpeech(
    text: string,
    config: VoiceSynthesisConfig,
  ): Promise<SynthesisOutput> {
    switch (config.provider) {
      case "cartesia":
        return synthesizeWithCartesia(text, config) as Promise<SynthesisOutput>
      case "fish-audio":
        return synthesizeWithFishAudio(text, config) as Promise<SynthesisOutput>
      default:
        throw new VoiceSynthesisError(`Unsupported provider: ${config.provider}`, config.provider)
    }
  }
  ```

- [ ] **Step 6:** Run the test — expect all passing.

- [ ] **Step 7:** Commit:
  ```
  feat(voice): VoiceService abstraction + Cartesia/Fish Audio adapters
  ```

---

## Task 5: Audio blob storage for synthesized output

**Files:**
- Create: `apps/web/lib/voice-synthesis/audio-storage.ts`
- Create: `apps/web/lib/voice-synthesis/audio-storage.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/audio-storage.test.ts`:
  ```ts
  import { describe, it, expect, vi } from "vitest"
  import { writeAudioBlob, audioStorageKeyToUrl } from "./audio-storage"
  import * as fs from "node:fs/promises"

  vi.mock("node:fs/promises")
  const mockFs = vi.mocked(fs)

  describe("writeAudioBlob", () => {
    it("writes audio buffer and returns storageKey with interactionId prefix", async () => {
      mockFs.mkdir = vi.fn().mockResolvedValue(undefined)
      mockFs.writeFile = vi.fn().mockResolvedValue(undefined)
      mockFs.rename = vi.fn().mockResolvedValue(undefined)

      const buf = Buffer.from("FAKE_AUDIO").buffer
      const result = await writeAudioBlob({
        interactionId: "DI-abc123",
        audioBuffer: buf,
        ext: "mp3",
        storageRoot: "/tmp/uploads",
      })

      expect(result.storageKey).toMatch(/^voice\/DI-abc123\//)
      expect(result.storageKey).toMatch(/\.mp3$/)
      expect(mockFs.writeFile).toHaveBeenCalled()
    })
  })

  describe("audioStorageKeyToUrl", () => {
    it("converts storageKey to /api/voice/audio/ URL", () => {
      const url = audioStorageKeyToUrl("voice/DI-abc/file.mp3")
      expect(url).toBe("/api/voice/audio/voice/DI-abc/file.mp3")
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/audio-storage.ts`:
  ```ts
  import * as fs from "node:fs/promises"
  import * as path from "node:path"
  import { randomUUID } from "node:crypto"

  export interface WriteAudioBlobInput {
    interactionId: string
    audioBuffer: ArrayBuffer
    ext: string         // e.g. "mp3"
    storageRoot?: string
  }

  export interface WriteAudioBlobResult {
    storageKey: string  // relative path: voice/<interactionId>/<uuid>.mp3
  }

  function getStorageRoot(override?: string): string {
    return override ?? process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads"
  }

  export async function writeAudioBlob(input: WriteAudioBlobInput): Promise<WriteAudioBlobResult> {
    const storageRoot = getStorageRoot(input.storageRoot)
    const relativeDir = `voice/${input.interactionId}`
    const filename    = `${randomUUID()}.${input.ext}`
    const storageKey  = `${relativeDir}/${filename}`

    const absoluteDir  = path.join(storageRoot, relativeDir)
    const absolutePath = path.join(storageRoot, storageKey)
    const tmpPath      = `${absolutePath}.${process.pid}.tmp`

    await fs.mkdir(absoluteDir, { recursive: true })
    await fs.writeFile(tmpPath, Buffer.from(input.audioBuffer))
    await fs.rename(tmpPath, absolutePath)

    return { storageKey }
  }

  export function audioStorageKeyToUrl(storageKey: string): string {
    return `/api/voice/audio/${storageKey}`
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): audio blob storage helper
  ```

---

## Task 6: VoiceSynthesisJob — async post-gate synthesis

**Files:**
- Create: `apps/web/lib/voice-synthesis/synthesis-job.ts`
- Create: `apps/web/lib/voice-synthesis/synthesis-job.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/synthesis-job.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"
  import { runVoiceSynthesisJob } from "./synthesis-job"

  const mockPrisma = {
    decisionInteraction: {
      findUnique: vi.fn(),
    },
    decisionPerspectiveProfile: {
      findUnique: vi.fn(),
    },
    voiceProfile: {
      findUnique: vi.fn(),
    },
    decisionInteractionVoiceOutput: {
      create: vi.fn(),
    },
  }

  vi.mock("@repo/db", () => ({ prisma: mockPrisma }))
  vi.mock("./voice-service", () => ({
    synthesizeSpeech: vi.fn().mockResolvedValue({
      audioBuffer: Buffer.from("AUDIO").buffer,
      provider: "cartesia",
      ttsCostUnits: 10,
    }),
  }))
  vi.mock("./audio-storage", () => ({
    writeAudioBlob: vi.fn().mockResolvedValue({ storageKey: "voice/DI-abc/test.mp3" }),
    audioStorageKeyToUrl: vi.fn().mockReturnValue("/api/voice/audio/voice/DI-abc/test.mp3"),
  }))

  describe("runVoiceSynthesisJob", () => {
    beforeEach(() => vi.clearAllMocks())

    it("writes DecisionInteractionVoiceOutput on success", async () => {
      mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
        interactionId: "DI-abc",
        rationale: "Plan is ready.",
        outcomeType: "recommend",
        confidenceAfter: 0.82,
        profile: {
          voiceEnabled: true,
          personaConfig: null,
          voiceProfile: {
            id: "vp-1",
            providerVoiceId: "voice-xyz",
            provider: "cartesia",
            language: "en",
            status: "ready",
          },
        },
      })
      mockPrisma.decisionInteractionVoiceOutput.create.mockResolvedValue({ id: "vo-1" })

      await runVoiceSynthesisJob("DI-abc")

      expect(mockPrisma.decisionInteractionVoiceOutput.create).toHaveBeenCalledOnce()
      const { data } = mockPrisma.decisionInteractionVoiceOutput.create.mock.calls[0][0]
      expect(data.interactionId).toBe("DI-abc")
      expect(data.audioStorageKey).toBe("voice/DI-abc/test.mp3")
      expect(data.provider).toBe("cartesia")
    })

    it("returns early if voiceEnabled is false", async () => {
      mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
        interactionId: "DI-abc",
        rationale: "Plan is ready.",
        outcomeType: "recommend",
        confidenceAfter: 0.7,
        profile: { voiceEnabled: false, personaConfig: null, voiceProfile: null },
      })

      await runVoiceSynthesisJob("DI-abc")

      expect(mockPrisma.decisionInteractionVoiceOutput.create).not.toHaveBeenCalled()
    })

    it("does not throw if synthesis fails — logs and returns", async () => {
      const { synthesizeSpeech } = await import("./voice-service")
      vi.mocked(synthesizeSpeech).mockRejectedValueOnce(new Error("API error"))
      mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
        interactionId: "DI-abc",
        rationale: "Plan is ready.",
        outcomeType: "recommend",
        confidenceAfter: 0.7,
        profile: {
          voiceEnabled: true,
          personaConfig: null,
          voiceProfile: { id: "vp-1", providerVoiceId: "v1", provider: "cartesia", language: "en", status: "ready" },
        },
      })

      await expect(runVoiceSynthesisJob("DI-abc")).resolves.toBeUndefined()
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/synthesis-job.ts`:
  ```ts
  import { prisma } from "@repo/db"
  import { buildNarrationText } from "./narration-builder"
  import { synthesizeSpeech, VoiceSynthesisError } from "./voice-service"
  import { writeAudioBlob } from "./audio-storage"
  import type { NarrationOutcomeType } from "./types"

  const TRACE = "[tool-trace] voice.synthesis"

  export async function runVoiceSynthesisJob(interactionId: string): Promise<void> {
    let interaction: Awaited<ReturnType<typeof fetchInteraction>>
    try {
      interaction = await fetchInteraction(interactionId)
    } catch (err) {
      console.error(`${TRACE}.fetch.failed`, { interactionId, error: String(err) })
      return
    }

    if (!interaction) {
      console.warn(`${TRACE}.interaction.not-found`, { interactionId })
      return
    }

    const { profile } = interaction
    if (!profile?.voiceEnabled || !profile?.voiceProfile) {
      console.debug(`${TRACE}.skipped.voice-disabled`, { interactionId })
      return
    }

    const vp = profile.voiceProfile
    if (vp.status !== "ready" || !vp.providerVoiceId) {
      console.warn(`${TRACE}.skipped.voice-not-ready`, { interactionId, status: vp.status })
      return
    }

    const narrationText = buildNarrationText({
      outcomeType: interaction.outcomeType as NarrationOutcomeType,
      confidenceScore: interaction.confidenceAfter ?? 0,
      rationale: interaction.rationale ?? "",
      personaSystemPrompt: (profile.personaConfig as { systemPrompt?: string } | null)?.systemPrompt,
    })

    try {
      const synthesis = await synthesizeSpeech(narrationText, {
        provider: vp.provider as any,
        providerVoiceId: vp.providerVoiceId,
        language: vp.language,
      })

      const { storageKey } = await writeAudioBlob({
        interactionId,
        audioBuffer: synthesis.audioBuffer,
        ext: "mp3",
      })

      // Estimate duration: ~150 words/min at 1.0x speed
      const wordCount = narrationText.split(/\s+/).length
      const durationMs = Math.round((wordCount / 150) * 60 * 1000)

      await prisma.decisionInteractionVoiceOutput.create({
        data: {
          interactionId,
          audioStorageKey: storageKey,
          narrationText,
          durationMs,
          provider: synthesis.provider,
          voiceProfileId: vp.id,
          ttsCostUnits: synthesis.ttsCostUnits ?? null,
        },
      })

      console.info(`${TRACE}.completed`, { interactionId, durationMs, provider: synthesis.provider })
    } catch (err) {
      const tag = err instanceof VoiceSynthesisError ? "synthesis.failed" : "storage.failed"
      console.error(`${TRACE}.${tag}`, { interactionId, error: String(err) })
      // Do NOT rethrow — voice is non-blocking enrichment
    }
  }

  async function fetchInteraction(interactionId: string) {
    return prisma.decisionInteraction.findUnique({
      where: { interactionId },
      select: {
        interactionId: true,
        rationale: true,
        outcomeType: true,
        confidenceAfter: true,
        profile: {
          select: {
            voiceEnabled: true,
            personaConfig: true,
            voiceProfile: {
              select: { id: true, providerVoiceId: true, provider: true, language: true, status: true },
            },
          },
        },
      },
    })
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): VoiceSynthesisJob — async post-gate TTS synthesis
  ```

---

## Task 7: Wire synthesis job into build-studio-gate.ts

**Files:**
- Modify: `apps/web/lib/decision-perspective/build-studio-gate.ts`
- Modify: `apps/web/lib/decision-perspective/build-studio-gate.test.ts`

- [ ] **Step 1:** Open `apps/web/lib/decision-perspective/build-studio-gate.test.ts`. Add a test that confirms the gate returns its result before the synthesis job resolves (i.e., the job is non-blocking):
  ```ts
  // Add to existing test file
  it("fires voice synthesis job after returning gate result (non-blocking)", async () => {
    const synthesisJobMock = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 500))
    )
    vi.doMock("../../voice-synthesis/synthesis-job", () => ({
      runVoiceSynthesisJob: synthesisJobMock,
    }))

    const start = Date.now()
    const result = await evaluateBuildStudioPlanAdvancementGate({ /* valid inputs */ })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(200)          // gate returned before 500ms job resolved
    expect(result.interactionId).toBeDefined()
    // synthesis job was fired
    await vi.runAllTimersAsync()
    expect(synthesisJobMock).toHaveBeenCalledWith(result.interactionId)
  })
  ```

- [ ] **Step 2:** Run the new test — expect failure (job not yet wired).

- [ ] **Step 3:** In `build-studio-gate.ts`, after the line that calls `persistDecisionInteraction` and obtains `interactionId`, add the non-blocking dispatch:
  ```ts
  import { runVoiceSynthesisJob } from "../voice-synthesis/synthesis-job"

  // After: const { interactionId } = await persistDecisionInteraction(...)
  setImmediate(() => {
    runVoiceSynthesisJob(interactionId).catch((err: unknown) => {
      console.error("[tool-trace] wwmd.voice.dispatch.failed", { interactionId, error: String(err) })
    })
  })
  ```

- [ ] **Step 4:** Run the full `decision-perspective` test suite — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): wire VoiceSynthesisJob into build-studio-gate (non-blocking)
  ```

---

## Task 8: API route to serve audio files

**Files:**
- Create: `apps/web/app/api/voice/audio/[...path]/route.ts`
- Create: `apps/web/app/api/voice/audio/[...path]/route.test.ts`

- [ ] **Step 1:** Write the failing test:
  ```ts
  import { describe, it, expect, vi } from "vitest"
  import { GET } from "./route"
  import * as fs from "node:fs/promises"

  vi.mock("node:fs/promises")

  describe("GET /api/voice/audio/[...path]", () => {
    it("returns 200 with audio/mp3 content-type for existing file", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("FAKE_AUDIO"))
      const req = new Request("http://localhost/api/voice/audio/voice/DI-abc/file.mp3")
      const res = await GET(req, { params: { path: ["voice", "DI-abc", "file.mp3"] } })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("audio/mpeg")
    })

    it("returns 404 for missing file", async () => {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      vi.mocked(fs.readFile).mockRejectedValue(err)
      const req = new Request("http://localhost/api/voice/audio/voice/DI-abc/missing.mp3")
      const res = await GET(req, { params: { path: ["voice", "DI-abc", "missing.mp3"] } })
      expect(res.status).toBe(404)
    })

    it("rejects path traversal attempts", async () => {
      const req = new Request("http://localhost/api/voice/audio/../../etc/passwd")
      const res = await GET(req, { params: { path: ["..", "..", "etc", "passwd"] } })
      expect(res.status).toBe(400)
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/app/api/voice/audio/[...path]/route.ts`:
  ```ts
  import * as fs from "node:fs/promises"
  import * as path from "node:path"
  import { NextResponse } from "next/server"

  const CONTENT_TYPES: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
  }

  function getStorageRoot(): string {
    return process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads"
  }

  export async function GET(
    _req: Request,
    { params }: { params: { path: string[] } },
  ): Promise<NextResponse> {
    const joined = (params.path ?? []).join("/")

    // Reject path traversal
    if (joined.includes("..") || path.isAbsolute(joined)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 })
    }

    const absolutePath = path.join(getStorageRoot(), joined)
    const ext = path.extname(joined).slice(1).toLowerCase()
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream"

    try {
      const buf = await fs.readFile(absolutePath)
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=86400",
        },
      })
    } catch (err: any) {
      if (err?.code === "ENOENT") return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ error: "Server error" }, { status: 500 })
    }
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): API route to serve synthesized audio files
  ```

---

## Task 9: Audio player component

**Files:**
- Create: `apps/web/components/build/VoiceRationalePlayer.tsx`
- Create: `apps/web/components/build/VoiceRationalePlayer.test.tsx`

- [ ] **Step 1:** Write the failing test `apps/web/components/build/VoiceRationalePlayer.test.tsx`:
  ```tsx
  import { render, screen, fireEvent } from "@testing-library/react"
  import { describe, it, expect, vi } from "vitest"
  import { VoiceRationalePlayer } from "./VoiceRationalePlayer"

  describe("VoiceRationalePlayer", () => {
    it("shows loading indicator when audioUrl is undefined", () => {
      render(<VoiceRationalePlayer audioUrl={undefined} durationMs={undefined} />)
      expect(screen.getByRole("status")).toBeInTheDocument()
    })

    it("shows play button when audioUrl is provided", () => {
      render(<VoiceRationalePlayer audioUrl="/api/voice/audio/voice/DI-abc/f.mp3" durationMs={4200} />)
      expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument()
    })

    it("shows formatted duration", () => {
      render(<VoiceRationalePlayer audioUrl="/api/voice/audio/voice/DI-abc/f.mp3" durationMs={65000} />)
      expect(screen.getByText("1:05")).toBeInTheDocument()
    })

    it("renders nothing when voiceEnabled is false", () => {
      const { container } = render(
        <VoiceRationalePlayer audioUrl={undefined} durationMs={undefined} voiceEnabled={false} />
      )
      expect(container.firstChild).toBeNull()
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/components/build/VoiceRationalePlayer.tsx`:
  ```tsx
  "use client"

  import { useRef, useState } from "react"

  interface Props {
    audioUrl?: string
    durationMs?: number
    voiceEnabled?: boolean
  }

  function formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  export function VoiceRationalePlayer({ audioUrl, durationMs, voiceEnabled = true }: Props) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)

    if (!voiceEnabled) return null

    if (!audioUrl) {
      return (
        <div role="status" aria-label="Preparing audio" className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
          <span className="animate-pulse">●</span>
          <span>Preparing audio…</span>
        </div>
      )
    }

    const toggle = () => {
      const el = audioRef.current
      if (!el) return
      if (playing) { el.pause(); setPlaying(false) }
      else { el.play(); setPlaying(true) }
    }

    return (
      <div className="flex items-center gap-2 py-1">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="rounded-full p-1 hover:bg-muted transition-colors"
        >
          {playing ? "⏸" : "▶"}
        </button>
        {durationMs !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(durationMs)}
          </span>
        )}
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setPlaying(false)}
          preload="metadata"
        />
      </div>
    )
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): VoiceRationalePlayer component
  ```

---

## Task 10: Wire audio player into DecisionPerspectiveGatePanel

**Files:**
- Modify: `apps/web/components/build/DecisionPerspectiveGatePanel.tsx`
- Modify: `apps/web/components/build/DecisionPerspectiveGatePanel.test.tsx`

- [ ] **Step 1:** Open `DecisionPerspectiveGatePanel.test.tsx`. Add a test:
  ```tsx
  it("renders VoiceRationalePlayer when voiceOutput is provided", () => {
    render(
      <DecisionPerspectiveGatePanel
        interaction={mockInteraction}
        voiceOutput={{ audioStorageKey: "voice/DI-abc/f.mp3", durationMs: 4200 }}
      />
    )
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument()
  })

  it("renders loading voice player when voiceOutput is null and voiceEnabled is true", () => {
    render(
      <DecisionPerspectiveGatePanel
        interaction={{ ...mockInteraction, profile: { voiceEnabled: true } }}
        voiceOutput={null}
      />
    )
    expect(screen.getByRole("status")).toBeInTheDocument()
  })
  ```

- [ ] **Step 2:** Run new tests — expect failures.

- [ ] **Step 3:** In `DecisionPerspectiveGatePanel.tsx`:
  - Add `voiceOutput?: { audioStorageKey: string; durationMs: number } | null` to the component props
  - Import `VoiceRationalePlayer`
  - After the rationale text block, add:
    ```tsx
    {(profile?.voiceEnabled) && (
      <VoiceRationalePlayer
        audioUrl={voiceOutput ? `/api/voice/audio/${voiceOutput.audioStorageKey}` : undefined}
        durationMs={voiceOutput?.durationMs}
      />
    )}
    ```

- [ ] **Step 4:** Run the full panel test suite — expect all passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): wire VoiceRationalePlayer into DecisionPerspectiveGatePanel
  ```

---

## Task 11: Consent capture server action + form

**Files:**
- Create: `apps/web/lib/actions/voice-consent.ts`
- Create: `apps/web/lib/actions/voice-consent.test.ts`
- Create: `apps/web/components/admin/VoiceConsentForm.tsx`

- [ ] **Step 1:** Write the failing test `apps/web/lib/actions/voice-consent.test.ts`:
  ```ts
  import { describe, it, expect, vi } from "vitest"
  import { createVoiceConsentRecord } from "./voice-consent"

  const mockCreate = vi.fn().mockResolvedValue({ id: "vcr-1" })
  vi.mock("@repo/db", () => ({
    prisma: { voiceConsentRecord: { create: mockCreate } },
  }))

  describe("createVoiceConsentRecord", () => {
    it("creates a VoiceConsentRecord with required fields", async () => {
      const result = await createVoiceConsentRecord({
        subjectName: "Jane Doe",
        consentMethod: "recorded-statement",
        authorizedUseCases: ["build-studio-gate"],
        expiresAt: new Date("2027-01-01"),
        capturedByPrincipalId: "user-abc",
      })
      expect(result.id).toBe("vcr-1")
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ subjectName: "Jane Doe" }),
      })
    })

    it("throws if expiresAt is in the past", async () => {
      await expect(
        createVoiceConsentRecord({
          subjectName: "Old Record",
          consentMethod: "signed-document",
          authorizedUseCases: [],
          expiresAt: new Date("2020-01-01"),
          capturedByPrincipalId: "user-abc",
        })
      ).rejects.toThrow("expiresAt must be in the future")
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/actions/voice-consent.ts`:
  ```ts
  "use server"

  import { prisma } from "@repo/db"

  export interface CreateVoiceConsentInput {
    subjectName: string
    subjectEmail?: string
    consentMethod: "recorded-statement" | "signed-document" | "witnessed-verbal"
    authorizedUseCases: string[]
    authorizedLanguages?: string[]
    authorizedTerritories?: string[]
    expiresAt: Date
    capturedByPrincipalId: string
    evidenceRef?: string
  }

  export async function createVoiceConsentRecord(input: CreateVoiceConsentInput) {
    if (input.expiresAt <= new Date()) {
      throw new Error("expiresAt must be in the future")
    }

    return prisma.voiceConsentRecord.create({
      data: {
        subjectName: input.subjectName,
        subjectEmail: input.subjectEmail ?? null,
        consentMethod: input.consentMethod,
        authorizedUseCases: input.authorizedUseCases,
        authorizedLanguages: input.authorizedLanguages ?? ["en"],
        authorizedTerritories: input.authorizedTerritories ?? ["global"],
        expiresAt: input.expiresAt,
        capturedByPrincipalId: input.capturedByPrincipalId,
        evidenceRef: input.evidenceRef ?? null,
      },
    })
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Create `apps/web/components/admin/VoiceConsentForm.tsx` — a form that calls `createVoiceConsentRecord`. Minimal implementation with fields: subject name, consent method select, use cases checkboxes, expiry date, submit button. Return `consentRecordId` to parent on success via `onSuccess` callback prop.

- [ ] **Step 6:** Commit:
  ```
  feat(voice): consent capture server action and form component
  ```

---

## Task 12: Voice training upload API route

**Files:**
- Create: `apps/web/app/api/voice/train/route.ts`
- Create: `apps/web/app/api/voice/train/route.test.ts`
- Create: `apps/web/lib/voice-synthesis/training-pipeline.ts`
- Create: `apps/web/lib/voice-synthesis/training-pipeline.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/training-pipeline.test.ts`:
  ```ts
  import { describe, it, expect, vi } from "vitest"
  import { startVoiceTrainingJob } from "./training-pipeline"

  const mockPrisma = {
    voiceProfile: { findUnique: vi.fn(), update: vi.fn() },
    voiceTrainingJob: { create: vi.fn(), update: vi.fn() },
  }
  vi.mock("@repo/db", () => ({ prisma: mockPrisma }))

  const mockFetch = vi.fn()
  vi.stubGlobal("fetch", mockFetch)

  describe("startVoiceTrainingJob", () => {
    it("creates a VoiceTrainingJob with pending status and calls Cartesia training API", async () => {
      process.env.CARTESIA_API_KEY = "test-key"
      mockPrisma.voiceProfile.findUnique.mockResolvedValue({
        id: "vp-1", provider: "cartesia", consentType: "explicit-recorded",
        consentRecord: { expiresAt: new Date(Date.now() + 86400000) },
      })
      mockPrisma.voiceTrainingJob.create.mockResolvedValue({ id: "vtj-1" })
      mockPrisma.voiceProfile.update.mockResolvedValue({})
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "cartesia-job-abc", status: "running" }),
      })

      const result = await startVoiceTrainingJob({
        voiceProfileId: "vp-1",
        audioSamples: [{ filename: "voice.mp3", mimeType: "audio/mp3", durationMs: 30000 }],
        audioBuffers: [Buffer.from("FAKE")],
      })

      expect(result.jobId).toBe("vtj-1")
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it("throws if consent is expired", async () => {
      mockPrisma.voiceProfile.findUnique.mockResolvedValue({
        id: "vp-1", provider: "cartesia", consentType: "explicit-recorded",
        consentRecord: { expiresAt: new Date("2020-01-01") },
      })
      await expect(
        startVoiceTrainingJob({ voiceProfileId: "vp-1", audioSamples: [], audioBuffers: [] })
      ).rejects.toThrow("Consent record is expired")
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/training-pipeline.ts`:
  ```ts
  import { prisma } from "@repo/db"
  import type { VoiceTrainingSample } from "./types"

  export interface StartTrainingInput {
    voiceProfileId: string
    audioSamples: VoiceTrainingSample[]
    audioBuffers: Buffer[]
  }

  export async function startVoiceTrainingJob(input: StartTrainingInput): Promise<{ jobId: string }> {
    const vp = await prisma.voiceProfile.findUnique({
      where: { id: input.voiceProfileId },
      include: { consentRecord: true },
    })
    if (!vp) throw new Error("VoiceProfile not found")

    // Consent check (skip for synthetic)
    if (vp.consentType !== "not-required-synthetic") {
      if (!vp.consentRecord) throw new Error("Consent record missing")
      if (vp.consentRecord.expiresAt <= new Date()) throw new Error("Consent record is expired")
    }

    const job = await prisma.voiceTrainingJob.create({
      data: {
        voiceProfileId: vp.id,
        status: "pending",
        inputSamples: input.audioSamples,
      },
    })

    // Dispatch to provider (currently Cartesia only)
    if (vp.provider === "cartesia") {
      await dispatchCartesiaTraining(vp, input, job.id)
    }

    return { jobId: job.id }
  }

  async function dispatchCartesiaTraining(
    vp: { id: string },
    input: StartTrainingInput,
    jobId: string,
  ) {
    const apiKey = process.env.CARTESIA_API_KEY
    if (!apiKey) throw new Error("CARTESIA_API_KEY not set")

    // Build multipart form for Cartesia clone API
    const form = new FormData()
    for (let i = 0; i < input.audioBuffers.length; i++) {
      form.append("clip", new Blob([input.audioBuffers[i]], { type: input.audioSamples[i]?.mimeType ?? "audio/mp3" }))
    }

    const res = await fetch("https://api.cartesia.ai/voices/clone/clip", {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Cartesia-Version": "2025-04-16" },
      body: form,
    })

    if (!res.ok) {
      await prisma.voiceTrainingJob.update({ where: { id: jobId }, data: { status: "failed", errorMessage: await res.text() } })
      throw new Error("Cartesia training API call failed")
    }

    const data = await res.json()
    await prisma.voiceTrainingJob.update({ where: { id: jobId }, data: { status: "processing", providerJobId: data.id } })
    await prisma.voiceProfile.update({ where: { id: vp.id }, data: { status: "training", providerVoiceId: data.id } })
  }
  ```

- [ ] **Step 4:** Run the test — expect all passing.

- [ ] **Step 5:** Create `apps/web/app/api/voice/train/route.ts` — accepts multipart form-data (audio files + voiceProfileId), calls `startVoiceTrainingJob`, returns `{ jobId }`. Max file size 50 MB. Validate auth via existing session check pattern.

- [ ] **Step 6:** Commit:
  ```
  feat(voice): voice training pipeline + upload API route
  ```

---

## Task 13: WWTD profile kind + personaConfig admin support

**Files:**
- Modify: `apps/web/lib/decision-perspective/types.ts`
- Modify: `apps/web/lib/decision-perspective/evaluator.ts`
- Modify: `apps/web/lib/decision-perspective/evaluator.test.ts`

- [ ] **Step 1:** In `apps/web/lib/decision-perspective/evaluator.test.ts`, add:
  ```ts
  it("accepts persona-real kind without throwing", async () => {
    const result = evaluateDecisionPerspective({
      ...validInput,
      profile: { ...validInput.profile, kind: "persona-real" },
    })
    expect(result.outcomeType).toBeDefined()
  })
  ```

- [ ] **Step 2:** Run — expect failure.

- [ ] **Step 3:** In `apps/web/lib/decision-perspective/types.ts`, extend the `kind` union:
  ```ts
  // Before: "platform" | "organization" | "customer" | "team"
  // After:
  export type DecisionPerspectiveProfileKind =
    | "platform"
    | "organization"
    | "customer"
    | "team"
    | "persona-real"
    | "persona-fictional"
    | "persona-synthetic"
  ```
  Update any `kind` string literals in the evaluator and gate to use or accept this type.

- [ ] **Step 4:** In `evaluator.ts` look for any `kind` switch/validation and extend it to pass through the new kinds without throwing.

- [ ] **Step 5:** Run evaluator tests — expect all passing.

- [ ] **Step 6:** Commit:
  ```
  feat(voice): WWTD persona profile kind values + personaConfig types
  ```

---

## Task 14: Persona generation style pass (LLM rephrase)

**Files:**
- Create: `apps/web/lib/voice-synthesis/persona-style.ts`
- Create: `apps/web/lib/voice-synthesis/persona-style.test.ts`

- [ ] **Step 1:** Write the failing test `apps/web/lib/voice-synthesis/persona-style.test.ts`:
  ```ts
  import { describe, it, expect, vi } from "vitest"
  import { applyPersonaStyle } from "./persona-style"

  vi.mock("../../lib/llm-call", () => ({
    callLLM: vi.fn().mockResolvedValue({ text: "Styled narration output." }),
  }))

  describe("applyPersonaStyle", () => {
    it("returns original text unchanged when personaSystemPrompt is undefined", async () => {
      const result = await applyPersonaStyle({
        narrationText: "Original text.",
        personaSystemPrompt: undefined,
      })
      expect(result).toBe("Original text.")
    })

    it("calls LLM with persona system prompt when provided", async () => {
      const { callLLM } = await import("../../lib/llm-call")
      const result = await applyPersonaStyle({
        narrationText: "Plan is ready.",
        personaSystemPrompt: "Write in a calm, measured tone.",
      })
      expect(callLLM).toHaveBeenCalledOnce()
      expect(result).toBe("Styled narration output.")
    })
  })
  ```

- [ ] **Step 2:** Run test — expect failures.

- [ ] **Step 3:** Create `apps/web/lib/voice-synthesis/persona-style.ts`:
  ```ts
  // Find the project's LLM call utility — check apps/web/lib/ for callLLM / agentLLMCall / etc.
  // Use the same pattern used in deliberation/consensus.ts or build-studio-gate.ts for LLM calls.
  // Replace the import path below with the correct project path.
  import { callLLM } from "../../lib/llm-call" // adjust to actual path

  export interface PersonaStyleInput {
    narrationText: string
    personaSystemPrompt?: string
  }

  export async function applyPersonaStyle(input: PersonaStyleInput): Promise<string> {
    if (!input.personaSystemPrompt) return input.narrationText

    const result = await callLLM({
      systemPrompt: input.personaSystemPrompt,
      userMessage: `Rephrase the following narration in your voice and style. Keep the same meaning and facts. Return only the rephrased text, no preamble:\n\n${input.narrationText}`,
      maxTokens: 400,
    })

    return result.text?.trim() || input.narrationText
  }
  ```

  > **Note:** Find the actual LLM call utility in the project before implementing. Search `apps/web/lib/` for the function used in `deliberation/consensus.ts` or `mcp-tools-deliberation.ts` to identify the correct import path and call signature. Adjust the import and call accordingly.

- [ ] **Step 4:** Wire `applyPersonaStyle` into `synthesis-job.ts`: call it between `buildNarrationText` and `synthesizeSpeech`. Pass `personaConfig?.systemPrompt` if present.

- [ ] **Step 5:** Run all voice-synthesis tests — expect passing.

- [ ] **Step 6:** Commit:
  ```
  feat(voice): persona generation style pass via LLM rephrase
  ```

---

## Task 15: Voice training status UI (admin)

**Files:**
- Create: `apps/web/components/admin/VoiceTrainingStatus.tsx`
- Create: `apps/web/components/admin/VoiceTrainingStatus.test.tsx`

- [ ] **Step 1:** Write the failing test:
  ```tsx
  import { render, screen } from "@testing-library/react"
  import { describe, it, expect } from "vitest"
  import { VoiceTrainingStatus } from "./VoiceTrainingStatus"

  describe("VoiceTrainingStatus", () => {
    it("shows 'Training in progress' for processing status", () => {
      render(<VoiceTrainingStatus status="training" qualityScore={undefined} />)
      expect(screen.getByText(/training in progress/i)).toBeInTheDocument()
    })

    it("shows quality score for ready status", () => {
      render(<VoiceTrainingStatus status="ready" qualityScore={0.91} />)
      expect(screen.getByText(/91%/)).toBeInTheDocument()
    })

    it("shows error message for failed status", () => {
      render(<VoiceTrainingStatus status="failed" qualityScore={undefined} errorMessage="Rate limited" />)
      expect(screen.getByText(/rate limited/i)).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 2:** Run — expect failures.

- [ ] **Step 3:** Create the minimal `VoiceTrainingStatus.tsx` component with status indicator, quality score display, and error message.

- [ ] **Step 4:** Run tests — expect passing.

- [ ] **Step 5:** Commit:
  ```
  feat(voice): voice training status display component
  ```

---

## Task 16: End-to-end smoke test + final wiring check

**Files:**
- Create: `apps/web/lib/voice-synthesis/integration.test.ts`

- [ ] **Step 1:** Write an integration test that wires the full job path with mocked provider and DB:
  ```ts
  import { describe, it, expect, vi } from "vitest"

  // Mock Cartesia API + DB + storage
  // 1. Create a fake DecisionInteraction with voiceEnabled profile
  // 2. Call runVoiceSynthesisJob()
  // 3. Assert DecisionInteractionVoiceOutput was written
  // 4. Assert audio file path follows voice/<interactionId>/<uuid>.mp3 pattern
  ```

- [ ] **Step 2:** Run — iterate until passing.

- [ ] **Step 3:** Run the full test suite: `pnpm test` from repo root. Fix any new failures.

- [ ] **Step 4:** Commit:
  ```
  test(voice): end-to-end synthesis job integration test
  ```

- [ ] **Step 5:** Push branch and open PR:
  ```
  feat(voice): persona voice layer v1 — TTS output + WWTD profiles
  ```

---

## Environment variables required

Add to `.env.example` and deployment docs:

```env
# TTS providers (at least one required for voice output)
CARTESIA_API_KEY=          # Primary TTS provider (Cartesia Sonic 3)
FISH_AUDIO_API_KEY=        # Fallback TTS provider (Fish Audio S2)

# Storage (already used by blob-storage; no new vars needed if default is acceptable)
UPLOAD_STORAGE_PATH=./data/uploads   # Already in use
```
