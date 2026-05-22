// POST /api/voice/synthesize
// Real-time TTS synthesis endpoint used by all three voice surfaces.
// Returns raw audio/wav binary — NOT stored, streamed directly.
//
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md §4.3

import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { synthesizeSpeech, VoiceSynthesisError } from "@/lib/voice-synthesis/voice-service"
import type { TTSProvider } from "@/lib/voice-synthesis/types"

interface SynthesizeBody {
  text: string
  voiceProfileId?: string
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

  // Resolve voice profile: either from explicit ID or first ready + voice-enabled profile
  let voiceProfile: {
    id: string
    provider: string
    providerVoiceId: string | null
    status: string
    language: string
  } | null = null

  try {
    if (voiceProfileId) {
      voiceProfile = await prisma.voiceProfile.findUnique({
        where: { profileId: voiceProfileId },
        select: { id: true, provider: true, providerVoiceId: true, status: true, language: true },
      })
    } else {
      // Find the first ready VoiceProfile whose linked DecisionPerspectiveProfile has voiceEnabled = true
      voiceProfile = await prisma.voiceProfile.findFirst({
        where: {
          status: "ready",
          profile: { voiceEnabled: true },
        },
        select: { id: true, provider: true, providerVoiceId: true, status: true, language: true },
        orderBy: { updatedAt: "desc" },
      })
    }
  } catch {
    return Response.json({ error: "Failed to resolve voice profile" }, { status: 500 })
  }

  if (!voiceProfile) {
    return Response.json(
      { error: "No ready voice profile found. Configure one in Admin > Voice.", code: "no_voice_profile" },
      { status: 422 },
    )
  }

  if (voiceProfile.status !== "ready") {
    return Response.json(
      { error: "Voice profile is not ready", code: "voice_profile_not_ready" },
      { status: 422 },
    )
  }

  if (!voiceProfile.providerVoiceId) {
    return Response.json(
      { error: "Voice profile has no provider voice ID", code: "voice_profile_not_ready" },
      { status: 422 },
    )
  }

  // Synthesize
  try {
    const result = await synthesizeSpeech(text.trim(), {
      provider: voiceProfile.provider as TTSProvider,
      providerVoiceId: voiceProfile.providerVoiceId,
      language: voiceProfile.language,
    })

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
      // dpf-tts not running or unreachable
      if (status >= 500 || err.message.toLowerCase().includes("econnrefused") || err.message.toLowerCase().includes("fetch failed")) {
        console.warn("[tool-trace] voice.synthesize.tts_unavailable", { message: err.message })
        return Response.json(
          { error: "Voice synthesis unavailable — dpf-tts not running", code: "tts_unavailable" },
          { status: 503 },
        )
      }
      return Response.json({ error: err.message, code: "synthesis_error" }, { status })
    }
    // Network errors from fetch (ECONNREFUSED, etc.) surface as TypeError
    if (err instanceof TypeError || (err instanceof Error && err.message.includes("fetch"))) {
      console.warn("[tool-trace] voice.synthesize.tts_unreachable", { message: (err as Error).message })
      return Response.json(
        { error: "Voice synthesis unavailable — dpf-tts not running", code: "tts_unavailable" },
        { status: 503 },
      )
    }
    console.error("[tool-trace] voice.synthesize.error", err)
    return Response.json({ error: "Internal error during synthesis", code: "internal_error" }, { status: 500 })
  }
}
