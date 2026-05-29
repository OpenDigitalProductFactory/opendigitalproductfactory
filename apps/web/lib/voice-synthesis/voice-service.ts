import type { VoiceSynthesisConfig, TTSProvider } from "./types"
import { synthesizeWithCartesia, VoiceSynthesisError } from "./adapters/cartesia"
import { synthesizeWithFishAudio } from "./adapters/fish-audio"
import { synthesizeWithChatterbox, type ChatterboxSynthesisConfig } from "./adapters/chatterbox"
import { synthesizeWithMlx, type MlxSynthesisConfig } from "./adapters/mlx"

export interface SynthesisOutput {
  audioBuffer: ArrayBuffer
  provider: TTSProvider
  ttsCostUnits?: number
}

export { VoiceSynthesisError }

/** Read default provider from env; falls back to self-hosted Chatterbox. */
export function defaultProvider(): TTSProvider {
  const env = process.env.TTS_PROVIDER
  if (env === "cartesia" || env === "fish-audio" || env === "elevenlabs" || env === "xtts-v2" || env === "mlx") {
    return env
  }
  return "chatterbox"
}

export async function synthesizeSpeech(
  text: string,
  config: VoiceSynthesisConfig | ChatterboxSynthesisConfig,
): Promise<SynthesisOutput> {
  switch (config.provider) {
    case "chatterbox":
      return synthesizeWithChatterbox(text, config as ChatterboxSynthesisConfig) as Promise<SynthesisOutput>
    case "mlx":
      return synthesizeWithMlx(text, config as MlxSynthesisConfig) as Promise<SynthesisOutput>
    case "cartesia":
      return synthesizeWithCartesia(text, config) as Promise<SynthesisOutput>
    case "fish-audio":
      return synthesizeWithFishAudio(text, config) as Promise<SynthesisOutput>
    default:
      throw new VoiceSynthesisError(`Unsupported provider: ${config.provider}`, config.provider)
  }
}
