// POST /api/voice/reference
// Stores a reference audio clip for Chatterbox zero-shot voice cloning.
// The clip is saved to disk; providerVoiceId stores the relative path.
// On every synthesis call the stored clip is passed inline to dpf-tts
// via POST /v1/audio/speech/upload (multipart with voice_file field).
//
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md §4.2

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { resolveVoiceStorageRoot } from "@/lib/voice-synthesis/storage-root"
import { defaultProvider } from "@/lib/voice-synthesis/voice-service"
import type { TTSProvider } from "@/lib/voice-synthesis/types"
import * as fs from "node:fs/promises"
import * as path from "node:path"

// Health-check path per provider. The chatterbox server answers GET
// /v1/audio/voices; the mlx-audio server (Apple Silicon) returns 404 there but
// answers GET /v1/models. Using the wrong path leaves the profile stuck at
// pending_reference, so synthesis is rejected with voice_profile_not_ready.
function healthPath(provider: TTSProvider): string {
  return provider === "mlx" ? "/v1/models" : "/v1/audio/voices"
}

const MAX_BYTES = 50 * 1024 * 1024

function getStorageRoot(): string {
  return resolveVoiceStorageRoot()
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
    include: { consentRecord: { select: { expiresAt: true, revokedAt: true } } },
  })

  if (!voiceProfile) {
    return NextResponse.json({ error: "VoiceProfile not found" }, { status: 422 })
  }

  const consent = voiceProfile.consentRecord
  if (!consent || consent.revokedAt || new Date(consent.expiresAt) <= new Date()) {
    return NextResponse.json({ error: "Valid consent record required" }, { status: 422 })
  }

  // Determine extension from mime type
  const mimeType = audioEntry.type || "audio/wav"
  const ext = mimeType.includes("webm") ? "webm"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
    : mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp3") ? "mp3"
    : "wav"

  // Store reference audio to disk — this file is passed inline on every synthesis call.
  // Path: {storageRoot}/voices/{profileId}/reference.{ext}
  const relDir = `voices/${voiceProfileId}`
  const filename = `reference.${ext}`
  const storageKey = `${relDir}/${filename}`
  const absDir = path.join(getStorageRoot(), relDir)
  const absPath = path.join(getStorageRoot(), storageKey)

  try {
    await fs.mkdir(absDir, { recursive: true })
    const buf = await audioEntry.arrayBuffer()
    await fs.writeFile(absPath, Buffer.from(buf))
  } catch (err) {
    console.error("[tool-trace] voice.reference.storage.failed", { voiceProfileId, err: String(err) })
    return NextResponse.json({ error: "Failed to store reference audio" }, { status: 500 })
  }

  // Mark VoiceProfile ready; providerVoiceId is the relative path to the stored audio.
  await prisma.voiceProfile.update({
    where: { profileId: voiceProfileId },
    data: {
      provider: "chatterbox",
      providerVoiceId: storageKey,   // e.g. "voices/mark-dpf-platform/reference.webm"
      status: "ready",
      sampleCount: 1,
    },
  })

  console.info("[tool-trace] voice.reference.stored", { voiceProfileId, storageKey })
  return NextResponse.json({ storageKey, status: "ready" }, { status: 200 })
}
