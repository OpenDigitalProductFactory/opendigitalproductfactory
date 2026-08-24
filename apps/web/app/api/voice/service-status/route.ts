// GET /api/voice/service-status
// Lightweight liveness of the active TTS provider so the UI can show an honest
// "voice service offline" state instead of a "ready" profile whose Preview only
// fails after a click. No synthesis. The probe itself lives in the shared
// lib/voice-synthesis/service-status helper (which also feeds the
// dpf_voice_tts_* Prometheus gauges).

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveVoicePlaybackCapability, type VoicePlaybackCapability } from "@/lib/voice-synthesis/service-status"

export const dynamic = "force-dynamic"

export async function GET(request?: Request): Promise<NextResponse<VoicePlaybackCapability | { error: string }>> {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const purpose = request && new URL(request.url).searchParams.get("purpose") === "preview"
    ? "preview"
    : "coworker"
  return NextResponse.json(await resolveVoicePlaybackCapability({ purpose }))
}
