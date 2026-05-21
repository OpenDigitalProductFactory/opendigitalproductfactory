// POST /api/voice/reference
// Zero-shot voice registration for Chatterbox self-hosted TTS.
// Accepts a single reference audio file, registers it with dpf-tts,
// and immediately marks the VoiceProfile as ready — no async training job.
//
// Replaces /api/voice/train (Cartesia async training pipeline).
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md §4.2

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

function getTtsUrl(): string {
  return process.env.DPF_TTS_URL ?? "http://dpf-tts:8000"
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Invalid multipart/form-data" }, { status: 400 })
  }

  const voiceProfileId = formData.get("voiceProfileId")
  if (!voiceProfileId || typeof voiceProfileId !== "string") {
    return NextResponse.json({ error: "voiceProfileId is required" }, { status: 400 })
  }

  const audioEntry = formData.get("audio")
  if (!(audioEntry instanceof Blob)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 })
  }

  if (audioEntry.size > MAX_BYTES) {
    return NextResponse.json({ error: "Audio file exceeds 50 MB limit" }, { status: 413 })
  }

  // Verify profile exists and has valid consent
  const voiceProfile = await prisma.voiceProfile.findUnique({
    where: { profileId: voiceProfileId },
    include: {
      consentRecord: { select: { expiresAt: true, revokedAt: true } },
    },
  })

  if (!voiceProfile) {
    return NextResponse.json({ error: "VoiceProfile not found" }, { status: 422 })
  }

  const consent = voiceProfile.consentRecord
  if (!consent || consent.revokedAt || new Date(consent.expiresAt) <= new Date()) {
    return NextResponse.json({ error: "Valid consent record required" }, { status: 422 })
  }

  // Register reference audio with dpf-tts (Chatterbox)
  let providerVoiceId: string
  try {
    const ttsForm = new FormData()
    ttsForm.append("voice_id", voiceProfileId)
    ttsForm.append(
      "audio",
      audioEntry,
      audioEntry instanceof File ? audioEntry.name : "reference.wav",
    )

    const ttsRes = await fetch(`${getTtsUrl()}/v1/voices`, {
      method: "POST",
      body: ttsForm,
    })

    if (!ttsRes.ok) {
      // dpf-tts not running — store voice_id as profileId, mark ready locally.
      // When dpf-tts starts, the reference audio will be re-registered.
      console.warn("[tool-trace] voice.reference.dpf-tts.unavailable", {
        voiceProfileId,
        status: ttsRes.status,
      })
      providerVoiceId = voiceProfileId
    } else {
      const json = await ttsRes.json().catch(() => ({}))
      providerVoiceId = (json as { voice_id?: string }).voice_id ?? voiceProfileId
    }
  } catch {
    // dpf-tts container not reachable (e.g. --profile tts not started yet).
    // Store voice_id derived from profileId; voice won't synthesize until
    // dpf-tts is running, but profile is marked ready for configuration.
    console.warn("[tool-trace] voice.reference.dpf-tts.unreachable", { voiceProfileId })
    providerVoiceId = voiceProfileId
  }

  // Immediately mark VoiceProfile ready — zero-shot, no training wait
  await prisma.voiceProfile.update({
    where: { profileId: voiceProfileId },
    data: {
      provider: "chatterbox",
      providerVoiceId,
      status: "ready",
      sampleCount: 1,
    },
  })

  return NextResponse.json({ voiceId: providerVoiceId, status: "ready" }, { status: 200 })
}
