import { describe, it, expect, vi, beforeEach } from "vitest"

// Use vi.hoisted to ensure mock objects are available when vi.mock factories run
const mockPrisma = vi.hoisted(() => ({
  decisionInteraction: {
    findUnique: vi.fn(),
  },
  decisionPerspectiveProfile: {
    findUnique: vi.fn(),
  },
  voiceProfile: {
    findUnique: vi.fn(),
  },
  decisionInteractionVoiceOutput: {
    create: vi.fn(),
  },
}))

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }))
vi.mock("./persona-style", () => ({
  applyPersonaStyle: vi.fn().mockImplementation(async (input: { narrationText: string }) => input.narrationText),
}))
vi.mock("./voice-service", () => ({
  synthesizeSpeech: vi.fn().mockResolvedValue({
    audioBuffer: Buffer.from("AUDIO").buffer,
    provider: "cartesia",
    ttsCostUnits: 10,
  }),
  defaultProvider: vi.fn().mockReturnValue("chatterbox"),
  VoiceSynthesisError: class VoiceSynthesisError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "VoiceSynthesisError"
    }
  },
}))
vi.mock("./audio-storage", () => ({
  writeAudioBlob: vi.fn().mockResolvedValue({ storageKey: "voice/DI-abc/test.mp3" }),
  audioStorageKeyToUrl: vi.fn().mockReturnValue("/api/voice/audio/voice/DI-abc/test.mp3"),
}))

import { runVoiceSynthesisJob } from "./synthesis-job"
import { applyPersonaStyle } from "./persona-style"

describe("runVoiceSynthesisJob", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes DecisionInteractionVoiceOutput on success", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
      interactionId: "DI-abc",
      rationale: "Plan is ready.",
      outcomeType: "recommend",
      confidenceAfter: 0.82,
      profile: {
        voiceEnabled: true,
        personaConfig: null,
        voiceProfile: {
          id: "vp-1",
          providerVoiceId: "voice-xyz",
          provider: "cartesia",
          language: "en",
          status: "ready",
        },
      },
    })
    mockPrisma.decisionInteractionVoiceOutput.create.mockResolvedValue({ id: "vo-1" })

    await runVoiceSynthesisJob("DI-abc")

    expect(mockPrisma.decisionInteractionVoiceOutput.create).toHaveBeenCalledOnce()
    const { data } = mockPrisma.decisionInteractionVoiceOutput.create.mock.calls[0][0]
    expect(data.interactionId).toBe("DI-abc")
    expect(data.audioStorageKey).toBe("voice/DI-abc/test.mp3")
    expect(data.provider).toBe("cartesia")
  })

  it("returns early if voiceEnabled is false", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
      interactionId: "DI-abc",
      rationale: "Plan is ready.",
      outcomeType: "recommend",
      confidenceAfter: 0.7,
      profile: { voiceEnabled: false, personaConfig: null, voiceProfile: null },
    })

    await runVoiceSynthesisJob("DI-abc")

    expect(mockPrisma.decisionInteractionVoiceOutput.create).not.toHaveBeenCalled()
  })

  it("does not throw if synthesis fails — logs and returns", async () => {
    const { synthesizeSpeech } = await import("./voice-service")
    vi.mocked(synthesizeSpeech).mockRejectedValueOnce(new Error("API error"))
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
      interactionId: "DI-abc",
      rationale: "Plan is ready.",
      outcomeType: "recommend",
      confidenceAfter: 0.7,
      profile: {
        voiceEnabled: true,
        personaConfig: null,
        voiceProfile: { id: "vp-1", providerVoiceId: "v1", provider: "cartesia", language: "en", status: "ready" },
      },
    })

    await expect(runVoiceSynthesisJob("DI-abc")).resolves.toBeUndefined()
  })

  it("does not throw if persona styling fails - voice remains non-blocking enrichment", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(applyPersonaStyle).mockRejectedValueOnce(new Error("style model unavailable"))
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
      interactionId: "DI-abc",
      rationale: "Plan is ready.",
      outcomeType: "recommend",
      confidenceAfter: 0.7,
      profile: {
        voiceEnabled: true,
        personaConfig: { systemPrompt: "Speak warmly." },
        voiceProfile: { id: "vp-1", providerVoiceId: "v1", provider: "cartesia", language: "en", status: "ready" },
      },
    })

    await expect(runVoiceSynthesisJob("DI-abc")).resolves.toBeUndefined()
    expect(mockPrisma.decisionInteractionVoiceOutput.create).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-trace] voice.synthesis.style.failed",
      expect.objectContaining({ interactionId: "DI-abc" }),
    )
    errorSpy.mockRestore()
  })
})
