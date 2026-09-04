"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { VoicePlaybackState } from "@/lib/voice-synthesis/service-status"

// Minimal valid silent WAV (44-byte header, zero samples). Used to unlock the
// AudioContext within the user-gesture call stack so scheduled playback is not
// blocked by the browser autoplay policy.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="

export interface VoiceSynthSettings {
  speed?: number
  exaggeration?: number
  cfgWeight?: number
  temperature?: number
}

export interface VoiceSynthOptions {
  purpose?: "coworker" | "preview"
}

export interface VoiceSynthHook {
  synthesize: (text: string, voiceProfileId?: string, settings?: VoiceSynthSettings) => Promise<void>
  isPlaying: boolean
  isSynthesizing: boolean
  available: boolean
  checking: boolean
  readinessState: VoicePlaybackState | "checking"
  unavailableReason: string | null
  lastErrorCode: string | null
  stop: () => void
}

function getUnavailableReason(code: string | undefined): string | null {
  switch (code) {
    case "tts_unavailable":
      return "Text-to-speech is unavailable."
    case "reference_missing":
      return "Reference voice sample is missing. Replace it."
    case "no_voice_profile":
    case "voice_profile_not_ready":
      return "No ready voice profile."
    default:
      return null
  }
}

/**
 * Parse one complete WAV ArrayBuffer from the beginning of a Uint8Array buffer
 * that uses the sidecar's length-prefix framing:
 *   [4-byte big-endian uint32 length][WAV bytes]
 *
 * Returns { wav, rest } when a complete chunk is available, null otherwise.
 */
function parseNextChunk(buf: Uint8Array<ArrayBuffer>): { wav: ArrayBuffer; rest: Uint8Array<ArrayBuffer> } | null {
  if (buf.length < 4) return null
  const length = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]
  if (buf.length < 4 + length) return null
  // Slice into a fresh ArrayBuffer (not a view of a SharedArrayBuffer)
  // so decodeAudioData accepts it without a TypeScript error.
  const wavBuf = new ArrayBuffer(length)
  new Uint8Array(wavBuf).set(buf.slice(4, 4 + length))
  const restBuf = new ArrayBuffer(buf.length - 4 - length)
  new Uint8Array(restBuf).set(buf.slice(4 + length))
  return { wav: wavBuf, rest: new Uint8Array(restBuf) }
}

/**
 * Streaming voice synthesis using the Web Audio API.
 *
 * Architecture:
 * - Calls /api/voice/synthesize/stream which proxies to the sidecar's
 *   /v1/audio/speech/stream endpoint.
 * - The response body is a chunked stream of length-prefixed WAV clips, one
 *   per sentence.
 * - Each WAV is decoded via AudioContext.decodeAudioData and scheduled as an
 *   AudioBufferSourceNode immediately after the previous chunk, giving
 *   gapless playback with low time-to-first-audio (~1-2s for the first sentence).
 *
 * Autoplay unlock: AudioContext.resume() is called synchronously within the
 * user-gesture call stack before any await, satisfying Safari/Chrome policy.
 */
export function useVoiceSynth(options: VoiceSynthOptions = {}): VoiceSynthHook {
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [available, setAvailable] = useState(false)
  const [checking, setChecking] = useState(true)
  const [readinessState, setReadinessState] = useState("checking" as VoicePlaybackState | "checking")
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null)

  // AudioContext is shared across calls; created lazily inside a gesture.
  const ctxRef = useRef<AudioContext | null>(null)
  // Track all scheduled source nodes so stop() can cancel them.
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  // Next scheduled start time in AudioContext seconds.
  const nextStartRef = useRef<number>(0)
  // AbortController for the current fetch stream.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const statusUrl = options.purpose === "preview"
      ? "/api/voice/service-status?purpose=preview"
      : "/api/voice/service-status"
    void fetch(statusUrl, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((status: { available: boolean; state: VoicePlaybackState; reason: string | null }) => {
        setAvailable(status.available)
        setReadinessState(status.state)
        setUnavailableReason(status.reason)
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return
        setAvailable(false)
        setReadinessState("service_unavailable")
        setUnavailableReason(getUnavailableReason("tts_unavailable"))
      })
      .finally(() => setChecking(false))
    return () => controller.abort()
  }, [options.purpose])

  const stop = useCallback(() => {
    // Cancel the in-flight fetch.
    abortRef.current?.abort()
    abortRef.current = null
    // Stop all scheduled audio nodes.
    for (const src of sourcesRef.current) {
      try { src.stop() } catch { /* already stopped */ }
    }
    sourcesRef.current = []
    nextStartRef.current = 0
    setIsPlaying(false)
    setIsSynthesizing(false)
  }, [])

  const synthesize = useCallback(
    async (text: string, voiceProfileId?: string, settings?: VoiceSynthSettings): Promise<void> => {
      if (typeof window === "undefined" || typeof AudioContext === "undefined") return

      // Cancel any in-flight synthesis before starting a new one.
      stop()

      // ── Autoplay unlock (must happen synchronously within the gesture) ─────
      // Resume/create AudioContext here, before any await, so the browser
      // autoplay policy treats subsequent scheduled playback as user-activated.
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext()
      }
      const ctx = ctxRef.current
      if (ctx.state === "suspended") {
        void ctx.resume()
      }
      // Play a silent buffer to warm the context (Safari requires this).
      const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate)
      const silentSrc = ctx.createBufferSource()
      silentSrc.buffer = silentBuf
      silentSrc.connect(ctx.destination)
      silentSrc.start()
      // ── end autoplay unlock ────────────────────────────────────────────────

      const abort = new AbortController()
      abortRef.current = abort
      nextStartRef.current = ctx.currentTime

      setIsSynthesizing(true)

      try {
        const res = await fetch("/api/voice/synthesize/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({
            text,
            ...(voiceProfileId ? { voiceProfileId } : {}),
            ...(settings ? { settings } : {}),
          }),
        })

        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          const code = (json as { code?: string }).code
          const reason = getUnavailableReason(code)
          setLastErrorCode(code ?? null)
          if (reason) {
            setAvailable(false)
            setReadinessState(code === "no_voice_profile" || code === "voice_profile_not_ready" ? "profile_missing" : "service_unavailable")
            setUnavailableReason(reason)
          }
          console.warn("[useVoiceSynth] stream synthesis failed", res.status, json)
          return
        }

        setAvailable(true)
        setReadinessState("ready")
        setUnavailableReason(null)
        setLastErrorCode(null)

        if (!res.body) {
          console.warn("[useVoiceSynth] no response body")
          return
        }

        const reader = res.body.getReader()
        let accum: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0))
        let firstChunk = true

        const readLoop = async (): Promise<void> => {
          while (true) {
            const { done, value } = await reader.read()
            if (value) {
              // Append incoming bytes to accumulator.
              const nextBuf = new ArrayBuffer(accum.length + value.length)
              const next = new Uint8Array(nextBuf)
              next.set(accum, 0)
              next.set(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)), accum.length)
              accum = next as Uint8Array<ArrayBuffer>
            }

            // Parse and schedule all complete chunks.
            let parsed = parseNextChunk(accum)
            while (parsed) {
              accum = parsed.rest
              const { wav } = parsed

              // Decode WAV → AudioBuffer.
              let audioBuf: AudioBuffer
              try {
                audioBuf = await ctx.decodeAudioData(wav)
              } catch (e) {
                console.warn("[useVoiceSynth] decodeAudioData failed:", e)
                parsed = parseNextChunk(accum)
                continue
              }

              if (abort.signal.aborted) return

              // Schedule this chunk to play immediately after the previous.
              const startAt = Math.max(ctx.currentTime, nextStartRef.current)
              const src = ctx.createBufferSource()
              src.buffer = audioBuf
              src.connect(ctx.destination)
              src.start(startAt)
              nextStartRef.current = startAt + audioBuf.duration
              sourcesRef.current.push(src)

              if (firstChunk) {
                firstChunk = false
                setIsSynthesizing(false)
                setIsPlaying(true)
              }

              // When the last scheduled source ends, mark playback complete.
              src.onended = () => {
                sourcesRef.current = sourcesRef.current.filter((s) => s !== src)
                if (sourcesRef.current.length === 0) {
                  setIsPlaying(false)
                }
              }

              parsed = parseNextChunk(accum)
            }

            if (done) break
          }
        }

        await readLoop()
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return // user called stop()
        console.warn("[useVoiceSynth] stream error:", err)
      } finally {
        if (abortRef.current === abort) abortRef.current = null
        setIsSynthesizing(false)
      }
    },
    [stop],
  )

  return { synthesize, isPlaying, isSynthesizing, available, checking, readinessState, unavailableReason, lastErrorCode, stop }
}
