import { prisma } from "@dpf/db"
import { buildNarrationText } from "./narration-builder"
import { applyPersonaStyle } from "./persona-style"
import { synthesizeSpeech, defaultProvider } from "./voice-service"
import { writeAudioBlob } from "./audio-storage"
import type { NarrationOutcomeType } from "./types"

const TRACE = "[tool-trace] voice.synthesis"

export async function runVoiceSynthesisJob(interactionId: string): Promise<void> {
  let interaction: Awaited<ReturnType<typeof fetchInteraction>>
  try {
    interaction = await fetchInteraction(interactionId)
  } catch (err) {
    console.error(`${TRACE}.fetch.failed`, { interactionId, error: String(err) })
    return
  }

  if (!interaction) {
    console.warn(`${TRACE}.interaction.not-found`, { interactionId })
    return
  }

  const { profile } = interaction
  if (!profile?.voiceEnabled || !profile?.voiceProfile) {
    console.debug(`${TRACE}.skipped.voice-disabled`, { interactionId })
    return
  }

  const vp = profile.voiceProfile
  if (vp.status !== "ready" || !vp.providerVoiceId) {
    console.warn(`${TRACE}.skipped.voice-not-ready`, { interactionId, status: vp.status })
    return
  }

  let stage: "style" | "synthesis" | "storage" = "style"
  try {
    const personaSystemPrompt = (profile.personaConfig as { systemPrompt?: string } | null)?.systemPrompt

    const rawNarrationText = buildNarrationText({
      outcomeType: interaction.outcomeType as NarrationOutcomeType,
      confidenceScore: interaction.confidenceAfter ?? 0,
      rationale: interaction.rationale ?? "",
      personaSystemPrompt,
    })

    const narrationText = await applyPersonaStyle({
      narrationText: rawNarrationText,
      personaSystemPrompt,
    })

    stage = "synthesis"
    // Honor the deployment-configured provider (TTS_PROVIDER env), not the
    // value stored on the profile at registration time — same reasoning as
    // /api/voice/synthesize. defaultProvider() falls back to "chatterbox".
    const synthesis = await synthesizeSpeech(narrationText, {
      provider: defaultProvider(),
      providerVoiceId: vp.providerVoiceId,
      language: vp.language,
    })

    stage = "storage"
    const { storageKey } = await writeAudioBlob({
      interactionId,
      audioBuffer: synthesis.audioBuffer,
      ext: "mp3",
    })

    // Estimate duration: ~150 words/min at 1.0x speed
    const wordCount = narrationText.split(/\s+/).length
    const durationMs = Math.round((wordCount / 150) * 60 * 1000)

    await prisma.decisionInteractionVoiceOutput.create({
      data: {
        interactionId,
        audioStorageKey: storageKey,
        narrationText,
        durationMs,
        provider: synthesis.provider,
        voiceProfileId: vp.id,
        ttsCostUnits: synthesis.ttsCostUnits ?? null,
      },
    })

    console.info(`${TRACE}.completed`, { interactionId, durationMs, provider: synthesis.provider })
  } catch (err) {
    console.error(`${TRACE}.${stage}.failed`, { interactionId, error: String(err) })
    // Do NOT rethrow — voice is non-blocking enrichment
  }
}

async function fetchInteraction(interactionId: string) {
  return prisma.decisionInteraction.findUnique({
    where: { interactionId },
    select: {
      interactionId: true,
      rationale: true,
      outcomeType: true,
      confidenceAfter: true,
      profile: {
        select: {
          voiceEnabled: true,
          personaConfig: true,
          voiceProfile: {
            select: { id: true, providerVoiceId: true, provider: true, language: true, status: true },
          },
        },
      },
    },
  })
}
