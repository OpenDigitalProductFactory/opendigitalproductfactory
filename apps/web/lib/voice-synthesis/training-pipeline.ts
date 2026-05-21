import { prisma } from "@dpf/db"
import type { Prisma } from "@dpf/db"
import type { VoiceTrainingSample } from "./types"

export interface StartTrainingInput {
  voiceProfileId: string
  audioSamples: VoiceTrainingSample[]
  audioBuffers: Buffer[]
}

export async function startVoiceTrainingJob(input: StartTrainingInput): Promise<{ jobId: string }> {
  const vp = await prisma.voiceProfile.findUnique({
    where: { id: input.voiceProfileId },
    include: { consentRecord: true },
  })
  if (!vp) throw new Error("VoiceProfile not found")

  // Consent check (skip for synthetic)
  if (vp.consentType !== "not-required-synthetic") {
    if (!vp.consentRecord) throw new Error("Consent record missing")
    if (vp.consentRecord.expiresAt <= new Date()) throw new Error("Consent record is expired")
  }

  const job = await prisma.voiceTrainingJob.create({
    data: {
      voiceProfileId: vp.id,
      status: "pending",
      inputSamples: input.audioSamples as unknown as Prisma.InputJsonValue,
    },
  })

  // Dispatch to provider (currently Cartesia only)
  if (vp.provider === "cartesia") {
    await dispatchCartesiaTraining(vp, input, job.id)
  }

  return { jobId: job.id }
}

async function dispatchCartesiaTraining(
  vp: { id: string },
  input: StartTrainingInput,
  jobId: string,
) {
  const apiKey = process.env.CARTESIA_API_KEY
  if (!apiKey) throw new Error("CARTESIA_API_KEY not set")

  // Build multipart form for Cartesia clone API
  const form = new FormData()
  for (let i = 0; i < input.audioBuffers.length; i++) {
    form.append(
      "clip",
      new Blob([input.audioBuffers[i].buffer as ArrayBuffer], {
        type: input.audioSamples[i]?.mimeType ?? "audio/mp3",
      }),
    )
  }

  const res = await fetch("https://api.cartesia.ai/voices/clone/clip", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Cartesia-Version": "2025-04-16" },
    body: form,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "unknown")
    await prisma.voiceTrainingJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: detail },
    })
    throw new Error("Cartesia training API call failed")
  }

  const data = await res.json()
  await prisma.voiceTrainingJob.update({
    where: { id: jobId },
    data: { status: "processing", providerJobId: data.id },
  })
  await prisma.voiceProfile.update({
    where: { id: vp.id },
    data: { status: "training", providerVoiceId: data.id },
  })
}
