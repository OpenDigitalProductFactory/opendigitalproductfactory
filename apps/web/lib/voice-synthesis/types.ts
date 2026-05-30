export type TTSProvider = "chatterbox" | "cartesia" | "fish-audio" | "elevenlabs" | "xtts-v2" | "mlx"

export type VoiceConsentType =
  | "explicit-recorded"
  | "explicit-signed"
  | "not-required-synthetic"

/**
 * Per-profile TTS tuning the user adjusts on the voice page. All optional; a
 * missing field means "use the provider/deployment default". Stored as JSON on
 * VoiceProfile.voiceSettings and applied on every synthesis.
 */
export interface VoiceSettings {
  speed?: number          // playback pace multiplier; ~0.5–2.0, default 1.0
  exaggeration?: number   // expressiveness/enthusiasm; ~0.25–1.0, default 0.5
  cfgWeight?: number      // lower = faster, looser pacing; ~0.2–1.0, default 0.5
  temperature?: number    // variability; ~0.2–1.2, default 0.8
}

export interface VoiceSynthesisConfig {
  provider: TTSProvider
  providerVoiceId: string
  language: string
  speed?: number           // 0.5–2.0; default 1.0
  emotionNotes?: string    // passed to provider as style hint
  settings?: VoiceSettings // per-profile tuning (forwarded to the TTS engine)
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
