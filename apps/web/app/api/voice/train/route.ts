import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { startVoiceTrainingJob } from "@/lib/voice-synthesis/training-pipeline"
import type { VoiceTrainingSample } from "@/lib/voice-synthesis/types"

// Max audio upload size: 50 MB
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

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

  const audioEntries = formData.getAll("audio")
  if (audioEntries.length === 0) {
    return NextResponse.json({ error: "At least one audio file is required" }, { status: 400 })
  }

  const audioBuffers: Buffer[] = []
  const audioSamples: VoiceTrainingSample[] = []
  let totalBytes = 0

  for (const entry of audioEntries) {
    if (!(entry instanceof Blob)) {
      return NextResponse.json({ error: "Audio entries must be files" }, { status: 400 })
    }

    const bytes = await entry.arrayBuffer()
    totalBytes += bytes.byteLength

    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: "Total audio size exceeds 50 MB limit" },
        { status: 413 },
      )
    }

    const filename =
      entry instanceof File ? entry.name : `audio-${audioBuffers.length}.mp3`
    const mimeType = entry.type || "audio/mp3"

    audioBuffers.push(Buffer.from(bytes))
    audioSamples.push({
      filename,
      mimeType,
      durationMs: 0, // Duration is determined server-side by the provider
    })
  }

  try {
    const { jobId } = await startVoiceTrainingJob({
      voiceProfileId,
      audioSamples,
      audioBuffers,
    })

    return NextResponse.json({ jobId }, { status: 202 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"

    if (
      message === "Consent record is expired" ||
      message === "Consent record missing" ||
      message === "VoiceProfile not found"
    ) {
      return NextResponse.json({ error: message }, { status: 422 })
    }

    console.error("[tool-trace] voice.train.route.failed", { voiceProfileId, error: message })
    return NextResponse.json({ error: "Training request failed" }, { status: 500 })
  }
}
