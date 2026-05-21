// Chatterbox TTS adapter — self-hosted, zero-shot voice cloning.
// Calls devnen/Chatterbox-TTS-Server via OpenAI-compatible /v1/audio/speech.
// No API key required. Docker service: dpf-tts:8000 (--profile tts).
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md

import type { VoiceSynthesisConfig } from "../types"
import { VoiceSynthesisError, type RawSynthesisResult } from "./cartesia"

function getTtsUrl(): string {
  return process.env.DPF_TTS_URL ?? "http://dpf-tts:8000"
}

export async function synthesizeWithChatterbox(
  text: string,
  config: VoiceSynthesisConfig,
): Promise<RawSynthesisResult> {
  const url = `${getTtsUrl()}/v1/audio/speech`

  const body = {
    model: "tts-1",
    input: text,
    voice: config.providerVoiceId,
    response_format: "wav",
    speed: config.speed ?? 1.0,
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown")
    throw new VoiceSynthesisError(detail, "chatterbox", res.status)
  }

  const audioBuffer = await res.arrayBuffer()
  return { audioBuffer, provider: "chatterbox", ttsCostUnits: text.length }
}
