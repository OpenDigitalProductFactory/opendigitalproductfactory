"use client"

import { useCallback, useRef, useState } from "react"

// Minimal valid silent WAV (44-byte header, zero samples). Used to "unlock" an
// HTMLAudioElement during the user gesture so a later play() — after the async
// synthesis fetch resolves — is not rejected by the browser autoplay policy.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="

export interface VoiceSynthHook {
  synthesize: (text: string, voiceProfileId?: string) => Promise<void>
  isPlaying: boolean
  isSynthesizing: boolean
  /** false when synthesis cannot run until service/configuration changes */
  available: boolean
  unavailableReason: string | null
  lastErrorCode: string | null
  stop: () => void
}

function getUnavailableReason(code: string | undefined): string | null {
  switch (code) {
    case "tts_unavailable":
      return "Text-to-speech service is not running."
    case "reference_missing":
      return "Reference voice sample is missing. Replace or re-register the voice sample."
    case "no_voice_profile":
    case "voice_profile_not_ready":
      return "No ready voice profile is available."
    default:
      return null
  }
}

/**
 * Calls /api/voice/synthesize and manages HTMLAudioElement playback state.
 *
 * - `available` starts true; flips false permanently for this mount if
 *   the endpoint reports an unavailable service or missing voice profile asset.
 * - Blob URLs are revoked as soon as playback ends.
 * - SSR-safe: audio is only created in the browser.
 */
export function useVoiceSynth(): VoiceSynthHook {
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [available, setAvailable] = useState(true)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const stop = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.src = ""
      audioRef.current = null
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const synthesize = useCallback(
    async (text: string, voiceProfileId?: string): Promise<void> => {
      // SSR guard
      if (typeof window === "undefined" || typeof Audio === "undefined") return

      // Stop any in-flight playback before starting a new request
      stop()

      // Unlock playback WITHIN the user-gesture call stack: create the audio
      // element now (synchronously, before the await below) and start it on a
      // silent clip. This grants the element user activation, so the real
      // play() after the multi-second synthesis fetch is not rejected by the
      // browser autoplay policy (Safari/Chrome). Without this, synthesis
      // succeeds but play() throws NotAllowedError and the speaker goes silent.
      const audio = new Audio()
      audioRef.current = audio
      audio.muted = true
      audio.src = SILENT_WAV
      void audio.play().catch(() => {})

      setIsSynthesizing(true)
      try {
        const res = await fetch("/api/voice/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, ...(voiceProfileId ? { voiceProfileId } : {}) }),
        })

        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          const code = (json as { code?: string }).code
          const reason = getUnavailableReason(code)
          setLastErrorCode(code ?? null)
          if (reason) {
            setAvailable(false)
            setUnavailableReason(reason)
          }
          // Graceful: don't throw, just log
          console.warn("[useVoiceSynth] synthesis failed", res.status, json)
          return
        }

        setAvailable(true)
        setUnavailableReason(null)
        setLastErrorCode(null)

        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url

        // Reuse the gesture-unlocked element from above; swap to the real clip.
        if (audioRef.current !== audio) {
          // stop() was called (e.g. user toggled off) — abort playback.
          URL.revokeObjectURL(url)
          blobUrlRef.current = null
          return
        }
        audio.muted = false
        audio.src = url

        audio.onended = () => {
          setIsPlaying(false)
          if (blobUrlRef.current === url) {
            URL.revokeObjectURL(url)
            blobUrlRef.current = null
          }
          audioRef.current = null
        }
        audio.onerror = () => {
          setIsPlaying(false)
          if (blobUrlRef.current === url) {
            URL.revokeObjectURL(url)
            blobUrlRef.current = null
          }
          audioRef.current = null
        }

        setIsPlaying(true)
        await audio.play().catch((e) => {
          // Autoplay policy may block this; treat as non-fatal
          console.warn("[useVoiceSynth] play() blocked:", e)
          setIsPlaying(false)
        })
      } catch (err) {
        console.warn("[useVoiceSynth] fetch error:", err)
      } finally {
        setIsSynthesizing(false)
      }
    },
    [stop],
  )

  return { synthesize, isPlaying, isSynthesizing, available, unavailableReason, lastErrorCode, stop }
}
