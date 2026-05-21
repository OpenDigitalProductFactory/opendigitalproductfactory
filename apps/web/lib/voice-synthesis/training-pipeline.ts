// training-pipeline.ts
// Legacy Cartesia training pipeline — retained for opt-in use when
// TTS_PROVIDER=cartesia. Default provider is now Chatterbox (zero-shot);
// see /api/voice/reference for the standard registration path.
//
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md §4.1

import { prisma } from "@dpf/db"
import type { VoiceTrainingSample } from "./types"

export interface StartTrainingInput {
  voiceProfileId: string
  audioSamples: VoiceTrainingSample[]
  audioBuffers: Buffer[]
}

/**
 * Cartesia-specific training job — only called when TTS_PROVIDER=cartesia.
 * For the default Chatterbox path use POST /api/voice/reference instead.
 */
export async function startVoiceTrainingJob(input: StartTrainingInput): Promise<{ jobId: string }> {
  const vp = await prisma.voiceProfile.findUnique({
    where: { id: input.voiceProfileId },
    include: { consentRecord: true },
  })
  if (!vp) throw new Error("VoiceProfile not found")

  if (vp.consentType !== "not-required-synthetic") {
    if (!vp.consentRecord) throw new Error("Consent record missing")
    if (vp.consentRecord.expiresAt <= new Date()) throw new Error("Consent record is expired")
  }

  // Dispatch to Cartesia clone API
  const apiKey = process.env.CARTESIA_API_KEY
  if (!apiKey) throw new Error("CARTESIA_API_KEY not set")

  const form = new FormData()
  for (let i = 0; i < input.audioBuffers.length; i++) {
    form.append(
      "clip",
      new Blob([input.audioBuffers[i].buffer as ArrayBuffer], {
        type: input.audioSamples[i]?.mimeType ?? "audio/mp3",
      }),
    )
  }

  const res = await fetch("https://api.cartesia.ai/voices/clone/clip", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Cartesia-Version": "2025-04-16" },
    body: form,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown")
    console.error("[tool-trace] voice.cartesia.training.failed", { voiceProfileId: vp.id, detail })
    throw new Error("Cartesia training API call failed")
  }

  const data = await res.json()
  await prisma.voiceProfile.update({
    where: { id: vp.id },
    data: { status: "training", providerVoiceId: data.id },
  })

  // Return the Cartesia voice id as jobId for backwards compat
  return { jobId: data.id }
}
