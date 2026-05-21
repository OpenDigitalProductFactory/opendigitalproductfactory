import { describe, it, expect } from "vitest"
import type {
  VoiceSynthesisConfig,
  SynthesisResult,
  VoiceTrainingSample,
  NarrationInput,
} from "./types"

describe("voice-synthesis types", () => {
  it("VoiceSynthesisConfig has required fields", () => {
    const config: VoiceSynthesisConfig = {
      provider: "cartesia",
      providerVoiceId: "voice-abc",
      language: "en",
      speed: 1.0,
    }
    expect(config.provider).toBe("cartesia")
  })

  it("SynthesisResult has audioStorageKey and durationMs", () => {
    const result: SynthesisResult = {
      audioStorageKey: "voice/DI-abc123/audio.mp3",
      durationMs: 4200,
      provider: "cartesia",
      ttsCostUnits: 312,
    }
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it("NarrationInput accepts outcomeType values", () => {
    const input: NarrationInput = {
      outcomeType: "recommend",
      confidenceScore: 0.82,
      rationale: "The plan is architecturally sound.",
      personaSystemPrompt: undefined,
    }
    expect(input.outcomeType).toBe("recommend")
  })
})
