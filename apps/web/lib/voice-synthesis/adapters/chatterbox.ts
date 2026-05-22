// Chatterbox TTS adapter — self-hosted, zero-shot voice cloning.
// Uses /v1/audio/speech/upload (multipart) to pass the stored reference
// audio inline on every synthesis call — no pre-registration needed.
// No API key required. Docker service: dpf-tts:8000 (--profile tts).
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md

import type { VoiceSynthesisConfig } from "../types"
import { VoiceSynthesisError, type RawSynthesisResult } from "./cartesia"

function getTtsUrl(): string {
  return process.env.DPF_TTS_URL ?? "http://dpf-tts:8000"
}

export interface ChatterboxSynthesisConfig extends VoiceSynthesisConfig {
  /**
   * Raw bytes of the reference audio clip. When provided, the adapter
   * POSTs to /v1/audio/speech/upload (multipart) so Chatterbox clones
   * the voice from this sample. Without it, dpf-tts uses its built-in
   * default voice.
   */
  referenceAudioBuffer?: Buffer
}

export async function synthesizeWithChatterbox(
  text: string,
  config: ChatterboxSynthesisConfig,
): Promise<RawSynthesisResult> {
  const baseUrl = getTtsUrl()

  if (config.referenceAudioBuffer && config.referenceAudioBuffer.length > 0) {
    // Zero-shot cloning: pass reference audio inline via multipart upload
    const form = new FormData()
    form.append("input", text)
    form.append("response_format", "wav")
    form.append(
      "voice_file",
      new Blob([config.referenceAudioBuffer], { type: "audio/wav" }),
      "reference.wav",
    )

    const res = await fetch(`${baseUrl}/v1/audio/speech/upload`, {
      method: "POST",
      body: form,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => "unknown")
      throw new VoiceSynthesisError(detail, "chatterbox", res.status)
    }

    const audioBuffer = await res.arrayBuffer()
    return { audioBuffer, provider: "chatterbox", ttsCostUnits: text.length }
  }

  // Fallback: no reference audio — uses dpf-tts default voice (for testing only)
  const body = {
    model: "tts-1",
    input: text,
    voice: "default",
    response_format: "wav",
    speed: config.speed ?? 1.0,
  }

  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
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
