// POST /api/voice/synthesize
// Real-time TTS synthesis endpoint used by all three voice surfaces.
// Loads the stored reference audio for the voice profile and passes it
// inline to Chatterbox via /v1/audio/speech/upload (zero-shot cloning).
// Returns raw audio/wav binary — NOT stored, streamed directly.
//
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md §4.3

import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { synthesizeSpeech, VoiceSynthesisError } from "@/lib/voice-synthesis/voice-service"
import type { TTSProvider } from "@/lib/voice-synthesis/types"
import * as fs from "node:fs/promises"
import * as path from "node:path"

interface SynthesizeBody {
  text: string
  voiceProfileId?: string
}

function getStorageRoot(): string {
  return process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads"
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
  } | null = null

  try {
    if (voiceProfileId) {
      voiceProfile = await prisma.voiceProfile.findUnique({
        where: { profileId: voiceProfileId },
        select: { id: true, provider: true, providerVoiceId: true, status: true, language: true },
      })
    } else {
      voiceProfile = await prisma.voiceProfile.findFirst({
        where: { status: "ready", profile: { voiceEnabled: true } },
        select: { id: true, provider: true, providerVoiceId: true, status: true, language: true },
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

  // Synthesize — reference audio passed inline for zero-shot cloning
  try {
    const result = await synthesizeSpeech(text.trim(), {
      provider: voiceProfile.provider as TTSProvider,
      providerVoiceId: voiceProfile.providerVoiceId,
      language: voiceProfile.language,
      referenceAudioBuffer,
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
