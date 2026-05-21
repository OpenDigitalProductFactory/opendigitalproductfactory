import { describe, it, expect, vi, beforeEach } from "vitest"

// Use vi.hoisted so mock objects are available when vi.mock factories run
const mockPrisma = vi.hoisted(() => ({
  decisionInteraction: {
    findUnique: vi.fn(),
  },
  decisionInteractionVoiceOutput: {
    create: vi.fn(),
  },
}))

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }))

vi.mock("./voice-service", () => ({
  synthesizeSpeech: vi.fn().mockResolvedValue({
    audioBuffer: Buffer.from("AUDIO").buffer,
    provider: "cartesia",
    ttsCostUnits: 10,
  }),
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

vi.mock("./persona-style", () => ({
  applyPersonaStyle: vi.fn().mockImplementation(async (input: { narrationText: string }) => input.narrationText),
}))

import { runVoiceSynthesisJob } from "./synthesis-job"

const fakeInteractionVoiceEnabled = {
  interactionId: "DI-abc",
  rationale: "The plan is architecturally sound.",
  outcomeType: "recommend",
  confidenceAfter: 0.85,
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
}

describe("Voice Synthesis End-to-End Integration", () => {
  beforeEach(() => vi.clearAllMocks())

  it("full job path: writes DecisionInteractionVoiceOutput with correct interactionId and audioStorageKey", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(fakeInteractionVoiceEnabled)
    mockPrisma.decisionInteractionVoiceOutput.create.mockResolvedValue({ id: "vo-1" })

    await runVoiceSynthesisJob("DI-abc")

    expect(mockPrisma.decisionInteractionVoiceOutput.create).toHaveBeenCalledOnce()
    const { data } = mockPrisma.decisionInteractionVoiceOutput.create.mock.calls[0][0]
    expect(data.interactionId).toBe("DI-abc")
    expect(data.audioStorageKey).toBe("voice/DI-abc/test.mp3")
  })

  it("skips synthesis when voiceEnabled is false", async () => {
    mockPrisma.decisionInteraction.findUnique.mockResolvedValue({
      interactionId: "DI-abc",
      rationale: "The plan is ready.",
      outcomeType: "recommend",
      confidenceAfter: 0.7,
      profile: { voiceEnabled: false, personaConfig: null, voiceProfile: null },
    })

    await runVoiceSynthesisJob("DI-abc")

    expect(mockPrisma.decisionInteractionVoiceOutput.create).not.toHaveBeenCalled()
  })

  it("does not throw when synthesizeSpeech fails — voice is non-blocking enrichment", async () => {
    const { synthesizeSpeech } = await import("./voice-service")
    vi.mocked(synthesizeSpeech).mockRejectedValueOnce(new Error("Provider unavailable"))

    mockPrisma.decisionInteraction.findUnique.mockResolvedValue(fakeInteractionVoiceEnabled)

    await expect(runVoiceSynthesisJob("DI-abc")).resolves.toBeUndefined()
    expect(mockPrisma.decisionInteractionVoiceOutput.create).not.toHaveBeenCalled()
  })
})
