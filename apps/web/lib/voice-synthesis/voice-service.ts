import type { VoiceSynthesisConfig, TTSProvider } from "./types"
import { synthesizeWithCartesia, VoiceSynthesisError } from "./adapters/cartesia"
import { synthesizeWithFishAudio } from "./adapters/fish-audio"

export interface SynthesisOutput {
  audioBuffer: ArrayBuffer
  provider: TTSProvider
  ttsCostUnits?: number
}

export { VoiceSynthesisError }

export async function synthesizeSpeech(
  text: string,
  config: VoiceSynthesisConfig,
): Promise<SynthesisOutput> {
  switch (config.provider) {
    case "cartesia":
      return synthesizeWithCartesia(text, config) as Promise<SynthesisOutput>
    case "fish-audio":
      return synthesizeWithFishAudio(text, config) as Promise<SynthesisOutput>
    default:
      throw new VoiceSynthesisError(`Unsupported provider: ${config.provider}`, config.provider)
  }
}
