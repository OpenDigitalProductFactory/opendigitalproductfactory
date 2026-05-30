// POST /api/voice/synthesize
// Real-time TTS synthesis endpoint used by all three voice surfaces.
// Loads the stored reference audio for the voice profile and passes it
// inline to Chatterbox via /v1/audio/speech/upload (zero-shot cloning).
// Returns raw audio/wav binary — NOT stored, streamed directly.
//
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md §4.3

import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { resolveVoiceStorageRoot } from "@/lib/voice-synthesis/storage-root"
import { synthesizeSpeech, VoiceSynthesisError, defaultProvider } from "@/lib/voice-synthesis/voice-service"
import type { TTSProvider } from "@/lib/voice-synthesis/types"
import * as fs from "node:fs/promises"
import * as path from "node:path"

interface SynthesizeBody {
  text: string
  voiceProfileId?: string
  // Optional live-preview overrides from the voice page sliders. When present
  // they win over the stored VoiceProfile.voiceSettings so the user hears the
  // change before saving. Not persisted by this route.
  settings?: {
    speed?: number
    exaggeration?: number
    cfgWeight?: number
    temperature?: number
  }
}

function getStorageRoot(): string {
  return resolveVoiceStorageRoot()
}

const clamp = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined

/**
 * Merge stored per-profile voiceSettings with optional live-preview overrides
 * (overrides win) and clamp each field to a safe range. Returns undefined when
 * nothing usable is set, so the provider keeps its own defaults.
 */
function resolveVoiceSettings(
  stored: unknown,
  override: SynthesizeBody["settings"],
): import("@/lib/voice-synthesis/types").VoiceSettings | undefined {
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

  let body: SynthesizeBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { text, voiceProfileId } = body

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return Response.json({ error: "text is required" }, { status: 400 })
  }

  // Resolve voice profile
  let voiceProfile: {
    id: string
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
        select: { id: true, provider: true, providerVoiceId: true, status: true, language: true, voiceSettings: true },
      })
    } else {
      voiceProfile = await prisma.voiceProfile.findFirst({
        where: { status: "ready", profile: { voiceEnabled: true } },
        select: { id: true, provider: true, providerVoiceId: true, status: true, language: true, voiceSettings: true },
        orderBy: { updatedAt: "desc" },
      })
    }
  } catch {
    return Response.json({ error: "Failed to resolve voice profile" }, { status: 500 })
  }

  if (!voiceProfile) {
    return Response.json(
      { error: "No ready voice profile found. Configure one in Wiki > Decision Perspectives.", code: "no_voice_profile" },
      { status: 422 },
    )
  }

  if (voiceProfile.status !== "ready" || !voiceProfile.providerVoiceId) {
    return Response.json(
      { error: "Voice profile is not ready", code: "voice_profile_not_ready" },
      { status: 422 },
    )
  }

  // Load the stored reference audio from disk.
  // providerVoiceId is a relative path like "voices/mark-dpf-platform/reference.webm"
  let referenceAudioBuffer: Buffer | undefined
  try {
    const absPath = path.join(getStorageRoot(), voiceProfile.providerVoiceId)
    referenceAudioBuffer = await fs.readFile(absPath)
  } catch (err) {
    console.error("[tool-trace] voice.synthesize.reference.read-failed", {
      providerVoiceId: voiceProfile.providerVoiceId,
      err: String(err),
    })
    return Response.json(
      { error: "Reference audio not found — please re-register your voice sample.", code: "reference_missing" },
      { status: 422 },
    )
  }

  // Synthesize — reference audio passed inline for zero-shot cloning.
  // Prefer the deployment-configured provider (TTS_PROVIDER env) over the value
  // stored on the profile at registration time. A profile registered as
  // "chatterbox" must still route to "mlx" when the install switched providers
  // (e.g. Apple Silicon hosts where dpf-tts can't run). defaultProvider()
  // falls back to "chatterbox" when the env is unset, preserving prior behaviour.
  const provider = defaultProvider()
  // Resolve tuning: live-preview overrides from the request win over the stored
  // per-profile settings; both clamped to safe ranges.
  const settings = resolveVoiceSettings(voiceProfile.voiceSettings, body.settings)
  try {
    const result = await synthesizeSpeech(text.trim(), {
      provider,
      providerVoiceId: voiceProfile.providerVoiceId,
      language: voiceProfile.language,
      referenceAudioBuffer,
      settings,
    } as Parameters<typeof synthesizeSpeech>[1])

    return new Response(result.audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Voice-Provider": result.provider,
      },
    })
  } catch (err) {
    if (err instanceof VoiceSynthesisError) {
      const status = err.statusCode ?? 502
      if (status >= 500 || err.message.toLowerCase().includes("econnrefused") || err.message.toLowerCase().includes("fetch failed")) {
        console.warn("[tool-trace] voice.synthesize.tts_unavailable", { message: err.message })
        return Response.json(
          { error: "Voice synthesis unavailable — dpf-tts not running", code: "tts_unavailable" },
          { status: 503 },
        )
      }
      return Response.json({ error: err.message, code: "synthesis_error" }, { status })
    }
    if (err instanceof TypeError || (err instanceof Error && err.message.includes("fetch"))) {
      return Response.json(
        { error: "Voice synthesis unavailable — dpf-tts not running", code: "tts_unavailable" },
        { status: 503 },
      )
    }
    console.error("[tool-trace] voice.synthesize.error", err)
    return Response.json({ error: "Internal error during synthesis", code: "internal_error" }, { status: 500 })
  }
}
