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
