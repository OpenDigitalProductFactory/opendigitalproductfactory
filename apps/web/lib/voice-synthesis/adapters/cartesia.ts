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
