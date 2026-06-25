// GET /api/voice/service-status
// Lightweight liveness of the active TTS provider so the UI can show an honest
// "voice service offline" state instead of a "ready" profile whose Preview only
// fails after a click. No synthesis. The probe itself lives in the shared
// lib/voice-synthesis/service-status helper (which also feeds the
// dpf_voice_tts_* Prometheus gauges).

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveTtsServiceUp } from "@/lib/voice-synthesis/service-status"

export const dynamic = "force-dynamic"

interface ServiceStatus {
  available: boolean
  provider: string
  reason: string | null
}

export async function GET(): Promise<NextResponse<ServiceStatus | { error: string }>> {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const status = await resolveTtsServiceUp()
  return NextResponse.json({
    available: status.up,
    provider: status.provider,
    reason: status.reason,
  })
}
