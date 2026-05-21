export type TTSProvider = "chatterbox" | "cartesia" | "fish-audio" | "elevenlabs" | "xtts-v2"

export type VoiceConsentType =
  | "explicit-recorded"
  | "explicit-signed"
  | "not-required-synthetic"

export interface VoiceSynthesisConfig {
  provider: TTSProvider
  providerVoiceId: string
  language: string
  speed?: number           // 0.5–2.0; default 1.0
  emotionNotes?: string    // passed to provider as style hint
}

export interface SynthesisResult {
  audioStorageKey: string  // relative path in local blob storage
  durationMs: number
  provider: TTSProvider
  ttsCostUnits?: number
}

export interface VoiceTrainingSample {
  filename: string
  mimeType: string
  durationMs: number
  qualityFlag?: "ok" | "noisy" | "short"
}

export type NarrationOutcomeType = "recommend" | "arbitrate" | "escalate" | "defer"

export interface NarrationInput {
  outcomeType: NarrationOutcomeType
  confidenceScore: number
  rationale: string
  personaSystemPrompt?: string
}
