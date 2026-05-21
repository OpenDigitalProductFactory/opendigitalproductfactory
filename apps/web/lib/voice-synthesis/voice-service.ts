import type { VoiceSynthesisConfig, TTSProvider } from "./types"
import { synthesizeWithCartesia, VoiceSynthesisError } from "./adapters/cartesia"
import { synthesizeWithFishAudio } from "./adapters/fish-audio"
import { synthesizeWithChatterbox } from "./adapters/chatterbox"

export interface SynthesisOutput {
  audioBuffer: ArrayBuffer
  provider: TTSProvider
  ttsCostUnits?: number
}

export { VoiceSynthesisError }

/** Read default provider from env; falls back to self-hosted Chatterbox. */
export function defaultProvider(): TTSProvider {
  const env = process.env.TTS_PROVIDER
  if (env === "cartesia" || env === "fish-audio" || env === "elevenlabs" || env === "xtts-v2") {
    return env
  }
  return "chatterbox"
}

export async function synthesizeSpeech(
  text: string,
  config: VoiceSynthesisConfig,
): Promise<SynthesisOutput> {
  switch (config.provider) {
    case "chatterbox":
      return synthesizeWithChatterbox(text, config) as Promise<SynthesisOutput>
    case "cartesia":
      return synthesizeWithCartesia(text, config) as Promise<SynthesisOutput>
    case "fish-audio":
      return synthesizeWithFishAudio(text, config) as Promise<SynthesisOutput>
    default:
      throw new VoiceSynthesisError(`Unsupported provider: ${config.provider}`, config.provider)
  }
}
