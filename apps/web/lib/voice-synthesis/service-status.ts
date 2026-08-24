// Shared TTS service-health probe + Prometheus gauge refresh.
//
// Used by:
//  - GET /api/voice/service-status (UI fail-loud state, BI-107833AC)
//  - the /api/metrics scrape (dpf_voice_tts_* gauges + VoiceServiceDown, BI-B2E777EB)
//
// dpf-tts (Chatterbox) and the mlx host sidecar expose only /health (no
// Prometheus /metrics), so they can't be scrape targets — ContainerDown (up==0)
// can't see them. This probe is the portal-side bridge that makes "TTS down"
// observable both to the user and to monitoring.

import { prisma } from "@dpf/db"
import { defaultProvider } from "./voice-service"
import { voiceTtsUp, voiceTtsEnabled } from "@/lib/metrics"

const HEALTH_TIMEOUT_MS = 3000

export interface TtsServiceStatus {
  provider: string
  up: boolean
  reason: string | null
}

export type VoicePlaybackState =
  | "ready"
  | "preference_disabled"
  | "profile_missing"
  | "service_unavailable"

export interface VoicePlaybackCapability {
  available: boolean
  state: VoicePlaybackState
  provider: string
  reason: string | null
}

/** Health URL for self-hosted sidecars, or null for providers we don't probe. */
function selfHostedHealthUrl(provider: string): string | null {
  if (provider === "chatterbox") {
    return `${process.env.DPF_TTS_URL ?? "http://dpf-tts:8000"}/health`
  }
  if (provider === "mlx") {
    return `${process.env.DPF_TTS_URL ?? "http://host.docker.internal:8771"}/health`
  }
  return null
}

/**
 * Probe the active TTS provider's liveness. No synthesis. Managed/hosted
 * providers (cartesia / fish-audio / elevenlabs) are reported up — a call would
 * incur cost and a bad key surfaces at synth time with its own message.
 */
export async function resolveTtsServiceUp(): Promise<TtsServiceStatus> {
  const provider = defaultProvider()
  const healthUrl = selfHostedHealthUrl(provider)
  if (!healthUrl) return { provider, up: true, reason: null }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    let res = await fetch(healthUrl, { signal: controller.signal })
    if (res.status === 404) {
      // Sidecars provisioned before /health existed serve their health check
      // at "/" only (BI-7988DAD8). A 404 means "reachable but wrong path",
      // not "down" — retry at the base URL instead of firing a phantom
      // VoiceServiceDown on a healthy service.
      res = await fetch(new URL("/", healthUrl), { signal: controller.signal })
    }
    if (!res.ok) {
      return { provider, up: false, reason: "The text-to-speech service is reachable but not ready." }
    }
    // Chatterbox / mlx return { status, model_loaded, ... }; a present-and-false
    // model_loaded means it is still warming up after start.
    const body = (await res.json().catch(() => ({}))) as { model_loaded?: boolean }
    if (body.model_loaded === false) {
      return { provider, up: false, reason: "The text-to-speech model is still loading. Try again shortly." }
    }
    return { provider, up: true, reason: null }
  } catch {
    return { provider, up: false, reason: "The text-to-speech service is not running." }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * True when at least one voice profile has narration enabled — so monitoring
 * only flags a down TTS service when it is actually expected to work (no noise
 * on installs that never turned voice on).
 */
export async function isVoiceNarrationEnabled(): Promise<boolean> {
  const n = await prisma.voiceProfile.count({
    where: { status: "ready", profile: { voiceEnabled: true } },
  })
  return n > 0
}

export async function resolveVoicePlaybackCapability(
  options: { purpose?: "coworker" | "preview" } = {},
): Promise<VoicePlaybackCapability> {
  const provider = defaultProvider()
  const profiles = await prisma.voiceProfile.findMany({
    where: { status: "ready", providerVoiceId: { not: null } },
    select: { profile: { select: { voiceEnabled: true } } },
    take: 20,
  })
  if (profiles.length === 0) {
    return { available: false, state: "profile_missing", provider, reason: "No ready voice profile is available." }
  }
  if (options.purpose !== "preview" && !profiles.some((entry) => entry.profile.voiceEnabled)) {
    return { available: false, state: "preference_disabled", provider, reason: "Voice narration is off for this coworker." }
  }
  const service = await resolveTtsServiceUp()
  if (!service.up) {
    return { available: false, state: "service_unavailable", provider: service.provider, reason: service.reason }
  }
  return { available: true, state: "ready", provider: service.provider, reason: null }
}

/**
 * Refresh the dpf_voice_tts_* gauges from a live probe + the enabled check.
 * Fully guarded — never throws, so a probe or DB hiccup cannot break the
 * /api/metrics scrape.
 */
export async function refreshVoiceTtsMetrics(): Promise<void> {
  try {
    const status = await resolveTtsServiceUp()
    voiceTtsUp.set(status.up ? 1 : 0)
  } catch {
    voiceTtsUp.set(0)
  }
  try {
    voiceTtsEnabled.set((await isVoiceNarrationEnabled()) ? 1 : 0)
  } catch {
    /* leave the previous value rather than asserting a state we couldn't read */
  }
}
