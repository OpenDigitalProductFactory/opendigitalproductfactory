// GET /api/voice/audio/status?interactionId={id}
// Returns the stored voice output for a DecisionInteraction, if any.
// Used by BuildStudioWorkflowActionCard to poll for gate-panel audio.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const interactionId = searchParams.get("interactionId")

  if (!interactionId) {
    return NextResponse.json({ error: "interactionId is required" }, { status: 400 })
  }

  const voiceOutput = await prisma.decisionInteractionVoiceOutput.findUnique({
    where: { interactionId },
    select: { audioStorageKey: true, durationMs: true },
  })

  if (!voiceOutput) {
    return NextResponse.json(null, { status: 200 })
  }

  return NextResponse.json(voiceOutput, { status: 200 })
}
