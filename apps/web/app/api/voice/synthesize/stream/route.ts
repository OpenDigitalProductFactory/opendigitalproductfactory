// POST /api/voice/synthesize/stream
// Streaming TTS endpoint — proxies to the sidecar's /v1/audio/speech/stream.
// Response: application/octet-stream, chunked: [4B uint32 len][WAV bytes]…
// Each chunk is a complete WAV for one sentence; time-to-first-audio ≈ 1-2s.
//
// Auth, voice-profile resolution, and settings merge follow the same logic as
// /api/voice/synthesize (the one-shot sibling route).

import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { resolveVoiceStorageRoot } from "@/lib/voice-synthesis/storage-root"
import { defaultProvider } from "@/lib/voice-synthesis/voice-service"
import { resolveReferenceHostPath } from "@/lib/voice-synthesis/adapters/mlx"
import * as path from "node:path"

interface StreamBody {
  text: string
  voiceProfileId?: string
  settings?: {
    speed?: number
    exaggeration?: number
    cfgWeight?: number
    temperature?: number
  }
}

function getTtsStreamUrl(): string {
  const base = process.env.DPF_TTS_URL ?? "http://host.docker.internal:8770"
  return `${base}/v1/audio/speech/stream`
}

const clamp = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined

function resolveSettings(stored: unknown, override: StreamBody["settings"]) {
  const base = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const ov = (override ?? {}) as Record<string, unknown>
  const pick = (k: string) => (ov[k] !== undefined ? ov[k] : base[k])
  const out = {
    speed: clamp(pick("speed"), 0.5, 2.0),
    exaggeration: clamp(pick("exaggeration"), 0.25, 1.0),
    cfgWeight: clamp(pick("cfgWeight"), 0.2, 1.0),
    temperature: clamp(pick("temperature"), 0.2, 1.2),
  }
  return Object.values(out).some((v) => v !== undefined) ? out : undefined
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: StreamBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { text, voiceProfileId, settings: overrideSettings } = body
  if (!text?.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 })
  }

  // Resolve voice profile (same logic as the one-shot sibling route).
  let voiceProfile: {
    provider: string
    providerVoiceId: string | null
    status: string
    language: string
    voiceSettings: unknown
  } | null = null

  try {
    if (voiceProfileId) {
      voiceProfile = await prisma.voiceProfile.findUnique({
        where: { profileId: voiceProfileId },
        select: { provider: true, providerVoiceId: true, status: true, language: true, voiceSettings: true },
      })
    } else {
      voiceProfile = await prisma.voiceProfile.findFirst({
        where: { status: "ready", profile: { voiceEnabled: true } },
        select: { provider: true, providerVoiceId: true, status: true, language: true, voiceSettings: true },
        orderBy: { updatedAt: "desc" },
      })
    }
  } catch {
    return Response.json({ error: "Failed to resolve voice profile" }, { status: 500 })
  }

  if (!voiceProfile || voiceProfile.status !== "ready" || !voiceProfile.providerVoiceId) {
    return Response.json(
      { error: "No ready voice profile found.", code: "no_voice_profile" },
      { status: 422 },
    )
  }

  const settings = resolveSettings(voiceProfile.voiceSettings, overrideSettings)
  const provider = defaultProvider()

  // Build the body for the sidecar's streaming endpoint.
  const sidecarBody: Record<string, unknown> = {
    input: text.trim(),
    response_format: "wav",
    speed: settings?.speed ?? 1.0,
  }

  if (provider === "mlx") {
    const refPath = resolveReferenceHostPath(voiceProfile.providerVoiceId)
    if (refPath) {
      sidecarBody.ref_audio = refPath
      if (settings?.exaggeration !== undefined) sidecarBody.exaggeration = settings.exaggeration
      if (settings?.cfgWeight !== undefined) sidecarBody.cfg_weight = settings.cfgWeight
      sidecarBody.temperature = settings?.temperature ?? 0.6
    }
  }

  // Proxy to the sidecar's streaming endpoint and pass the response through.
  let sidecarRes: Response
  try {
    sidecarRes = await fetch(getTtsStreamUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sidecarBody),
    })
  } catch (err) {
    console.warn("[voice/stream] sidecar fetch failed:", err)
    return Response.json(
      { error: "Voice synthesis unavailable", code: "tts_unavailable" },
      { status: 503 },
    )
  }

  if (!sidecarRes.ok) {
    console.warn("[voice/stream] sidecar error:", sidecarRes.status)
    return Response.json(
      { error: "Voice synthesis unavailable", code: "tts_unavailable" },
      { status: 503 },
    )
  }

  // Stream the sidecar response directly to the client.
  return new Response(sidecarRes.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Sentence-Count": sidecarRes.headers.get("X-Sentence-Count") ?? "?",
    },
  })
}
