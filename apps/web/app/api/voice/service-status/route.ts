// GET /api/voice/service-status
// Lightweight liveness probe for the active TTS provider, so the UI can show an
// honest "voice service offline" state instead of presenting a "ready" profile
// whose Preview button only reveals the failure AFTER a click (the click-to-
// discover latch in useVoiceSynth). No synthesis is performed.
//
// Self-hosted providers (chatterbox / mlx) are probed via their sidecar /health.
// Managed providers (cartesia / fish-audio / elevenlabs) are not proactively
// probed — a call would incur cost, and a bad key surfaces at synth time with
// its own message — so they are reported available and left to call-time errors.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { defaultProvider } from "@/lib/voice-synthesis/voice-service"

export const dynamic = "force-dynamic"

const HEALTH_TIMEOUT_MS = 3000

interface ServiceStatus {
  available: boolean
  provider: string
  reason: string | null
}

/** Health-check URL for self-hosted sidecars, or null for providers we don't probe. */
function selfHostedHealthUrl(provider: string): string | null {
  if (provider === "chatterbox") {
    return `${process.env.DPF_TTS_URL ?? "http://dpf-tts:8000"}/health`
  }
  if (provider === "mlx") {
    return `${process.env.DPF_TTS_URL ?? "http://host.docker.internal:8771"}/health`
  }
  return null
}

export async function GET(): Promise<NextResponse<ServiceStatus | { error: string }>> {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const provider = defaultProvider()
  const healthUrl = selfHostedHealthUrl(provider)

  // Managed / hosted providers: not proactively probed (see file header).
  if (!healthUrl) {
    return NextResponse.json({ available: true, provider, reason: null })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(healthUrl, { signal: controller.signal })
    if (!res.ok) {
      return NextResponse.json({
        available: false,
        provider,
        reason: "The text-to-speech service is reachable but not ready.",
      })
    }
    // Chatterbox / mlx return { status, model_loaded, ... }. A present-and-false
    // model_loaded means the model is still warming up after start.
    const body = (await res.json().catch(() => ({}))) as { model_loaded?: boolean }
    if (body.model_loaded === false) {
      return NextResponse.json({
        available: false,
        provider,
        reason: "The text-to-speech model is still loading. Try again shortly.",
      })
    }
    return NextResponse.json({ available: true, provider, reason: null })
  } catch {
    // Unreachable (sidecar not running) or timed out.
    return NextResponse.json({
      available: false,
      provider,
      reason: "The text-to-speech service is not running.",
    })
  } finally {
    clearTimeout(timer)
  }
}
