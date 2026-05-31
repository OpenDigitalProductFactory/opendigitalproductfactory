// MLX TTS adapter — host-native voice synthesis for Apple Silicon.
//
// On macOS, Docker Desktop has no Metal GPU passthrough, so cloning-grade TTS
// must run as a native host process. This adapter talks to a host-native sidecar
// (Chatterbox on :8771 by default, provisioned by setup-chatterbox-tts-macos.sh)
// via host.docker.internal — the same pattern DPF uses for Docker Model Runner.
//
// The "mlx" name is historical; the adapter is provider-agnostic: it POSTs to
// whichever OpenAI-compatible /v1/audio/speech server DPF_TTS_URL points at.
// The current recommended Mac sidecar is Chatterbox (MIT, ~7s/utterance via MPS,
// zero-shot cloning). CSM/mlx-audio is available as a fallback.
//
// Env:
//   DPF_TTS_URL                  sidecar URL — default http://host.docker.internal:8771
//                                (Chatterbox). Change to :8770 for CSM/mlx-audio.
//   DPF_TTS_MLX_MODEL            only used by CSM/mlx-audio path (ignored by Chatterbox)
//   DPF_TTS_MLX_VOICE            fallback named voice when no reference clip is set
//   DPF_TTS_REFERENCE_HOST_ROOT  host path of the voice storage root so the
//                                sidecar can read reference clips off disk
//
// Spec: docs/superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md

import path from "node:path"
import type { VoiceSynthesisConfig } from "../types"
import { VoiceSynthesisError, type RawSynthesisResult } from "./cartesia"

function getTtsUrl(): string {
  // Default to Chatterbox on :8771 (provisioned by setup-chatterbox-tts-macos.sh).
  // Use :8770 for the legacy CSM/mlx-audio sidecar (setup-mlx-tts-macos.sh).
  return process.env.DPF_TTS_URL ?? "http://host.docker.internal:8771"
}

function getModel(): string {
  return process.env.DPF_TTS_MLX_MODEL ?? "mlx-community/csm-1b"
}

function getFallbackVoice(): string {
  return process.env.DPF_TTS_MLX_VOICE ?? "af_heart"
}

// CSM (sesame) builds its generation context from the reference transcript and
// crashes with `IndexError: list index out of range` (sesame.py: context[0])
// when ref_audio is supplied with an empty ref_text. DPF does not yet transcribe
// the reference clip at registration, so until it does we send a neutral
// non-empty placeholder. Cloning still keys off ref_audio; an accurate
// transcript only improves prosody alignment.
export const DEFAULT_REF_TEXT =
  "This is a reference recording of my voice for the platform."

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

// CSM generation is stochastic: identical requests intermittently return empty
// or truncated audio (measured ~50% failure). The model's own docs say to
// "rerun generation" and tune the sampler. So we (a) set conservative sampler
// params and (b) retry until the output passes a validity check. A 24 kHz mono
// 16-bit WAV is ~48 KB/sec; real 1-2 sentence clips are >100 KB, while the
// failure mode is 0–~8 KB (empty / sub-0.2s). 16 KB (~0.33s) is a safe floor.
const MIN_VALID_AUDIO_BYTES = 16 * 1024
function getMaxAttempts(): number {
  const n = Number(process.env.DPF_TTS_MLX_MAX_ATTEMPTS)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 4
}

/**
 * Stream sentence-level WAV chunks from the sidecar's /v1/audio/speech/stream
 * endpoint. Each yielded ArrayBuffer is a complete, self-contained WAV clip
 * for one sentence — decode and play as they arrive for low time-to-first-audio.
 *
 * The response body is length-prefixed: [4-byte big-endian uint32][WAV bytes]…
 * Throws VoiceSynthesisError on connection failure or HTTP error.
 */
export async function* synthesizeWithMlxStream(
  text: string,
  config: MlxSynthesisConfig,
): AsyncGenerator<ArrayBuffer> {
  const baseUrl = getTtsUrl()
  const refPath = resolveReferenceHostPath(config.providerVoiceId)
  const s = config.settings ?? {}

  const body: Record<string, unknown> = {
    input: text,
    response_format: "wav",
    speed: s.speed ?? config.speed ?? 1.0,
  }

  if (refPath) {
    body.ref_audio = refPath
    body.ref_text = config.referenceText?.trim() || DEFAULT_REF_TEXT
    if (s.exaggeration !== undefined) body.exaggeration = s.exaggeration
    if (s.cfgWeight !== undefined) body.cfg_weight = s.cfgWeight
    body.temperature = s.temperature ?? 0.6
  } else {
    body.voice = getFallbackVoice()
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/v1/audio/speech/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new VoiceSynthesisError(String(err), "mlx")
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown")
    throw new VoiceSynthesisError(detail, "mlx", res.status)
  }

  if (!res.body) throw new VoiceSynthesisError("no response body", "mlx", 502)

  const reader = res.body.getReader()
  let buf = new Uint8Array(0)

  const append = (chunk: Uint8Array): void => {
    const next = new Uint8Array(buf.length + chunk.length)
    next.set(buf)
    next.set(chunk, buf.length)
    buf = next
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) append(value)
      if (done) break

      // Parse all complete length-prefixed WAV chunks out of the buffer.
      while (buf.length >= 4) {
        const length =
          (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]
        if (buf.length < 4 + length) break
        const wav = buf.slice(4, 4 + length).buffer as ArrayBuffer
        buf = buf.slice(4 + length)
        yield wav
      }
    }
    // Drain any final chunk after stream closes.
    while (buf.length >= 4) {
      const length = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]
      if (buf.length < 4 + length) break
      yield buf.slice(4, 4 + length).buffer as ArrayBuffer
      buf = buf.slice(4 + length)
    }
  } finally {
    reader.releaseLock()
  }
}

export async function synthesizeWithMlx(
  text: string,
  config: MlxSynthesisConfig,
): Promise<RawSynthesisResult> {
  const baseUrl = getTtsUrl()
  const refPath = resolveReferenceHostPath(config.providerVoiceId)

  // Per-profile tuning (set by the user on the voice page). Each field is only
  // sent when present so the sidecar/provider falls back to its own default.
  const s = config.settings ?? {}

  const body: Record<string, unknown> = {
    model: getModel(),
    input: text,
    response_format: "wav",
    speed: s.speed ?? config.speed ?? 1.0,
  }

  if (refPath) {
    // Zero-shot cloning from the stored reference clip on the host.
    // ref_text must be non-empty or CSM throws (see DEFAULT_REF_TEXT).
    body.ref_audio = refPath
    body.ref_text = config.referenceText?.trim() || DEFAULT_REF_TEXT
    // Expressiveness + pacing knobs (Chatterbox: exaggeration/cfg_weight; both
    // engines accept temperature). Conservative defaults curb CSM's degenerate
    // runs; per-profile settings override when present.
    if (s.exaggeration !== undefined) body.exaggeration = s.exaggeration
    if (s.cfgWeight !== undefined) body.cfg_weight = s.cfgWeight
    body.temperature = s.temperature ?? 0.6
    body.top_k = 50
  } else {
    // No host-visible reference → fixed named voice (non-cloning fallback).
    body.voice = getFallbackVoice()
  }

  const maxAttempts = getMaxAttempts()
  // Delay between retries so the loop outlasts a sidecar restart window.
  // The Chatterbox host sidecar takes ~6-12s to reload after a Jetsam kill;
  // 4s between each of 4 attempts covers 16s — enough to survive one restart.
  const RETRY_DELAY_MS = 4_000
  let lastErr: VoiceSynthesisError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
    let audioBuffer: ArrayBuffer
    try {
      const res = await fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => "unknown")
        lastErr = new VoiceSynthesisError(detail, "mlx", res.status)
        continue // transient server error — retry after delay
      }
      audioBuffer = await res.arrayBuffer()
    } catch (err) {
      // Network/abort (e.g. sidecar mid-restart) — wait then retry.
      lastErr = new VoiceSynthesisError(String(err), "mlx")
      continue
    }

    // Validity gate: reject empty/truncated output and regenerate.
    if (audioBuffer.byteLength >= MIN_VALID_AUDIO_BYTES) {
      return { audioBuffer, provider: "mlx", ttsCostUnits: text.length }
    }
    lastErr = new VoiceSynthesisError(
      `Output too short (${audioBuffer.byteLength} bytes) on attempt ${attempt}/${maxAttempts}`,
      "mlx",
      502,
    )
    // Non-cloning (named-voice) output is deterministic; if a short clip comes
    // back there, retrying won't help — surface it instead of looping.
    if (!refPath) break
  }

  throw lastErr ?? new VoiceSynthesisError("Synthesis failed", "mlx", 502)
}
