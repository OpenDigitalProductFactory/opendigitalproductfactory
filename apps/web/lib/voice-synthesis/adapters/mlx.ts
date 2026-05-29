// MLX TTS adapter — native-host Apple Silicon voice synthesis via mlx-audio.
//
// Talks to an mlx-audio OpenAI-compatible server (POST /v1/audio/speech). On
// macOS that server runs on the HOST, not in a container: Docker Desktop on
// macOS has no Metal GPU passthrough, so cloning-grade neural TTS must run
// host-native and is reached from the portal container via host.docker.internal.
// This mirrors how DPF already runs local LLMs (Docker Model Runner).
//
// Unlike the chatterbox adapter, mlx-audio has NO multipart upload endpoint —
// it clones from a reference audio FILE PATH (ref_audio) that the server reads
// off disk. We therefore pass the host-visible path of the stored reference
// clip, computed from DPF_TTS_REFERENCE_HOST_ROOT + providerVoiceId. When that
// root is not configured (so the host cannot see the clip), we fall back to a
// fixed named voice (non-cloning) rather than failing.
//
// Env:
//   DPF_TTS_URL                  default http://host.docker.internal:8770
//   DPF_TTS_MLX_MODEL            default mlx-community/csm-1b (cloning model)
//   DPF_TTS_MLX_VOICE            default af_heart (fallback named voice)
//   DPF_TTS_REFERENCE_HOST_ROOT  host path where the voice storage root is
//                                visible to the mlx-audio process (enables cloning)
//
// Spec: docs/superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md

import path from "node:path"
import type { VoiceSynthesisConfig } from "../types"
import { VoiceSynthesisError, type RawSynthesisResult } from "./cartesia"

function getTtsUrl(): string {
  return process.env.DPF_TTS_URL ?? "http://host.docker.internal:8770"
}

function getModel(): string {
  return process.env.DPF_TTS_MLX_MODEL ?? "mlx-community/csm-1b"
}

function getFallbackVoice(): string {
  return process.env.DPF_TTS_MLX_VOICE ?? "af_heart"
}

export interface MlxSynthesisConfig extends VoiceSynthesisConfig {
  /**
   * Transcript of the reference clip. mlx-audio cloning models (e.g. CSM) use
   * this to align the cloned voice; fidelity is reduced without it. Optional —
   * populated once the reference is transcribed at registration (future slice).
   */
  referenceText?: string
}

/**
 * Resolve the reference clip path AS SEEN BY THE mlx-audio PROCESS. The portal
 * container and the host TTS process do not share a filesystem by default, so
 * DPF_TTS_REFERENCE_HOST_ROOT must point at the directory where the voice
 * storage root is visible to mlx-audio. Returns null when unset or when there
 * is no reference id (caller falls back to the default voice).
 */
export function resolveReferenceHostPath(providerVoiceId: string | undefined | null): string | null {
  const root = process.env.DPF_TTS_REFERENCE_HOST_ROOT
  if (!root || !providerVoiceId) return null
  return path.join(root, providerVoiceId)
}

export async function synthesizeWithMlx(
  text: string,
  config: MlxSynthesisConfig,
): Promise<RawSynthesisResult> {
  const baseUrl = getTtsUrl()
  const refPath = resolveReferenceHostPath(config.providerVoiceId)

  const body: Record<string, unknown> = {
    model: getModel(),
    input: text,
    response_format: "wav",
    speed: config.speed ?? 1.0,
  }

  if (refPath) {
    // Zero-shot cloning from the stored reference clip on the host.
    body.ref_audio = refPath
    if (config.referenceText) body.ref_text = config.referenceText
  } else {
    // No host-visible reference → fixed named voice (non-cloning fallback).
    body.voice = getFallbackVoice()
  }

  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown")
    throw new VoiceSynthesisError(detail, "mlx", res.status)
  }

  const audioBuffer = await res.arrayBuffer()
  return { audioBuffer, provider: "mlx", ttsCostUnits: text.length }
}
